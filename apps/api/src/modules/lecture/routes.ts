// Lecture automatique d'un document (tâche 14, ADR 0015 ; étendue à tout l'outil par l'ADR 0018). Un seul point
// d'entrée pour tous les écrans : carte grise, pièce d'identité, constat amiable, attestation d'assurance, RCCM,
// carte de transport, visite technique, liste de véhicules, ou « auto » quand on ne sait pas encore ce que c'est.
//
// Le document vient d'une photo envoyée à l'instant, ou d'une pièce déjà enregistrée (justificatif d'identité,
// photo jointe à un sinistre, pièce jointe à une demande du site). Il est analysé par l'antivirus, reconnu au
// besoin, lu, puis les valeurs sont contrôlées et rapprochées des fiches de l'agence (véhicule déjà connu, contrat,
// client, échéance à mettre à jour) : rien n'est enregistré, la personne vérifie chaque champ avec le document.
// Chaque lecture est consignée au journal de sécurité, sans les valeurs, et chacun est limité à 30 lectures par
// heure (coût et abus).

import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { texteCourt } from "../../commun/schemas.js";
import type { Antivirus } from "../../integrations/antivirus/clamav.js";
import { controler, type Controle } from "../../integrations/lecture/controles.js";
import { DOCUMENTS, LIBELLES_DOCUMENTS, type Reconnaissance, type TypeDocument } from "../../integrations/lecture/documents.js";
import type { LecteurDocuments } from "../../integrations/lecture/lecteur.js";
import { dechiffrer } from "../../securite/chiffrement.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { consignerEvenement } from "../../securite/limitation.js";
import type { Role } from "../../securite/sessions.js";
import { dechiffrerPiece, LONGUEUR_BASE64_MAX, TYPES_PIECE_SITE, verifierPiece, type TypePiece } from "../demandes-site/piece.js";
import { LIBELLES_NATURE, type NaturePiece } from "../demandes-site/pieces-site.js";
import { dechiffrerPieceSinistre } from "../sinistres/pieces.js";
import { rapprocher } from "./rapprochements.js";

export const LECTURES_PAR_HEURE_MAX = 30;

/** Qui peut faire lire quel document : ceux qui saisissent les fiches correspondantes */
export const ROLES: Record<TypeDocument, Role[]> = {
  carte_grise: ["gerant", "charge_clientele", "commercial"],
  piece_identite: ["gerant", "charge_clientele"],
  constat_amiable: ["gerant", "charge_clientele"],
  attestation_assurance: ["gerant", "charge_clientele", "commercial"],
  registre_commerce: ["gerant", "charge_clientele", "commercial"],
  carte_transport: ["gerant", "charge_clientele", "commercial"],
  visite_technique: ["gerant", "charge_clientele", "commercial"],
  liste_vehicules: ["gerant", "charge_clientele", "commercial"],
};

/** Pièce jointe à une demande du site : le document du catalogue qui y correspond (le back-office s'en sert) */
export const DOCUMENT_PAR_NATURE: Partial<Record<NaturePiece, TypeDocument>> = {
  carte_grise: "carte_grise",
  attestation_precedente: "attestation_assurance",
  liste_vehicules: "liste_vehicules",
  carte_transport: "carte_transport",
  registre_commerce: "registre_commerce",
};

const MESSAGES_FICHIER = {
  illisible: "Le fichier n'a pas pu être lu. Envoyez une photo (JPEG ou PNG), un PDF ou, pour une liste de véhicules, un classeur Excel (.xlsx).",
  trop_volumineuse: "Le fichier dépasse 5 Mo. Envoyez une photo moins lourde.",
  type_refuse: "Le fichier doit être une photo (JPEG ou PNG), un PDF ou, pour une liste de véhicules, un classeur Excel (.xlsx).",
  classeur_illisible: "Ce classeur Excel n'est pas lisible : enregistrez-le au format .xlsx, sans macro ni mot de passe.",
} as const;

interface Corps {
  /** « auto » : le document est d'abord reconnu, parmi `parmi` (par défaut : tous ceux que la personne peut lire) */
  document: TypeDocument | "auto";
  parmi?: TypeDocument[];
  fichier?: { type: TypePiece; contenu: string };
  justificatifId?: string;
  pieceSinistreId?: string;
  /** Carte grise jointe à une demande du site (compatibilité ; préférer pieceDemandeSiteId) */
  demandeSiteId?: string;
  pieceDemandeSiteId?: string;
  /** Client du dossier, pour rapprocher les valeurs lues de sa fiche */
  clientId?: string;
}

const enAttente = () => new ErreurApi(503, "analyse_en_attente", "Ce document n'a pas encore été analysé par l'antivirus. Réessayez dans quelques minutes.");
const infecte = () => new ErreurApi(422, "piece_infectee", "L'antivirus a refusé ce fichier : il ne sera pas lu.");

function erreurLecture(resultat: { raison: string; message: string }): ErreurApi {
  const statut = resultat.raison === "indisponible" || resultat.raison === "configuration" ? 503 : 422;
  return new ErreurApi(statut, `lecture_${resultat.raison}`, resultat.message);
}

export async function routesLecture(
  app: FastifyInstance,
  options: { pool: Pool; gardes: Gardes; cleChiffrement: Buffer; antivirus: Antivirus; lecteur: LecteurDocuments | null },
): Promise<void> {
  const { pool, gardes, cleChiffrement, antivirus, lecteur } = options;

  // Le back-office n'affiche les boutons de lecture que si elle est disponible, et seulement les documents permis
  app.get("/lecture-automatique", { preHandler: gardes.sessionComplete() }, async (requete) => {
    const moi = utilisateurDe(requete);
    return {
      disponible: lecteur !== null,
      prestataire: lecteur?.nom ?? null,
      documents: lecteur ? DOCUMENTS.filter((d) => ROLES[d].includes(moi.role)).map((d) => ({ document: d, libelle: LIBELLES_DOCUMENTS[d] })) : [],
    };
  });

  app.post<{ Body: Corps }>(
    "/lecture-automatique",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial"),
      bodyLimit: LONGUEUR_BASE64_MAX + 4096,
      schema: {
        body: {
          type: "object",
          required: ["document"],
          additionalProperties: false,
          properties: {
            document: { type: "string", enum: [...DOCUMENTS, "auto"] },
            parmi: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: DOCUMENTS } },
            fichier: {
              type: "object",
              required: ["type", "contenu"],
              additionalProperties: false,
              properties: { type: { type: "string", enum: TYPES_PIECE_SITE }, contenu: texteCourt(LONGUEUR_BASE64_MAX, 4) },
            },
            justificatifId: { type: "string", format: "uuid" },
            pieceSinistreId: { type: "string", format: "uuid" },
            demandeSiteId: { type: "string", format: "uuid" },
            pieceDemandeSiteId: { type: "string", format: "uuid" },
            clientId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (requete) => {
      const moi = utilisateurDe(requete);
      const d = requete.body;
      if (!lecteur) throw new ErreurApi(503, "lecture_indisponible", "La lecture automatique n'est pas activée : saisissez les champs à la main.");
      const permis = (d.document === "auto" ? d.parmi ?? DOCUMENTS : [d.document]).filter((doc) => ROLES[doc].includes(moi.role));
      if (permis.length === 0) throw erreurs.accesRefuse();
      const sources = [d.fichier, d.justificatifId, d.pieceSinistreId, d.demandeSiteId, d.pieceDemandeSiteId].filter((s) => s !== undefined);
      if (sources.length !== 1) throw new ErreurApi(400, "source_invalide", "Indiquez un seul document à lire.");

      // Document à lire, et ce qui sera consigné au journal (jamais son contenu)
      const { fichier, objet } = await transactionUtilisateur(pool, moi.id, async (client) => {
        const { rows: [compte] } = await client.query<{ lectures: number }>(
          `SELECT count(*)::int AS lectures FROM securite.evenements
           WHERE type = 'lecture_automatique' AND utilisateur_id = $1 AND horodatage > now() - interval '1 hour'`,
          [moi.id],
        );
        if ((compte?.lectures ?? 0) >= LECTURES_PAR_HEURE_MAX) {
          throw new ErreurApi(429, "trop_de_lectures", `${LECTURES_PAR_HEURE_MAX} lectures par heure au plus : réessayez plus tard, ou saisissez les champs à la main.`);
        }
        const libelle = d.document === "auto" ? "Document à reconnaître" : LIBELLES_DOCUMENTS[d.document];

        if (d.fichier) {
          const verifiee = verifierPiece(d.fichier.type, d.fichier.contenu);
          if (!verifiee.ok) throw new ErreurApi(422, "fichier_invalide", MESSAGES_FICHIER[verifiee.raison]);
          return { fichier: { contenu: verifiee.contenu, type: verifiee.type, aAnalyser: true }, objet: `${libelle} (fichier envoyé)` };
        }
        if (d.justificatifId) {
          const { rows } = await client.query<{ contenu_chiffre: Buffer | null; empreinte: Buffer; type: TypePiece; etat_analyse: string; client: string }>(
            `SELECT j.contenu_chiffre, j.empreinte, j.type_contenu AS type, j.etat_analyse, c.nom AS client
             FROM app.justificatifs_identification j JOIN app.clients c ON c.id = j.client_id WHERE j.id = $1`,
            [d.justificatifId],
          );
          const j = rows[0];
          if (!j) throw erreurs.introuvable();
          if (j.etat_analyse === "infectee" || !j.contenu_chiffre) throw infecte();
          if (j.etat_analyse !== "saine") throw enAttente();
          const contenu = dechiffrer(cleChiffrement, j.contenu_chiffre, `justificatif-identification:${d.justificatifId}`);
          if (!createHash("sha256").update(contenu).digest().equals(j.empreinte)) throw new Error("Empreinte du justificatif incorrecte");
          return { fichier: { contenu, type: j.type, aAnalyser: false }, objet: `${libelle}, justificatif de ${j.client}` };
        }
        if (d.pieceSinistreId) {
          const { rows } = await client.query<{ contenu_chiffre: Buffer | null; empreinte: Buffer; type: TypePiece; etat_analyse: string; police: string | null }>(
            `SELECT p.contenu_chiffre, p.empreinte, p.type_contenu AS type, p.etat_analyse, k.numero_police AS police
             FROM app.pieces_sinistres p JOIN app.sinistres s ON s.id = p.sinistre_id JOIN app.contrats k ON k.id = s.contrat_id
             WHERE p.id = $1`,
            [d.pieceSinistreId],
          );
          const p = rows[0];
          if (!p) throw erreurs.introuvable();
          if (p.etat_analyse === "infectee" || !p.contenu_chiffre) throw infecte();
          if (p.etat_analyse !== "saine") throw enAttente();
          return {
            fichier: { contenu: dechiffrerPieceSinistre(cleChiffrement, d.pieceSinistreId, p.contenu_chiffre, p.empreinte), type: p.type, aAnalyser: false },
            objet: `${libelle}, sinistre du contrat ${p.police ?? "sans numéro"}`,
          };
        }
        // Pièce jointe à une demande du site : une pièce précise, ou la carte grise de la demande
        const { rows } = await client.query<{
          id: string; contenu_chiffre: Buffer | null; empreinte: Buffer; type: TypePiece; etat_analyse: string; numero: number; nature: NaturePiece;
        }>(
          d.pieceDemandeSiteId
            ? `SELECT p.id, p.contenu_chiffre, p.empreinte, p.type_contenu AS type, p.etat_analyse, d.numero, p.nature
               FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id WHERE p.id = $1`
            : `SELECT p.id, p.contenu_chiffre, p.empreinte, p.type_contenu AS type, p.etat_analyse, d.numero, p.nature
               FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
               WHERE p.demande_id = $1 AND p.nature = 'carte_grise' ORDER BY p.rang LIMIT 1`,
          [d.pieceDemandeSiteId ?? d.demandeSiteId],
        );
        const p = rows[0];
        if (!p) throw erreurs.introuvable();
        if (p.etat_analyse === "infectee" || !p.contenu_chiffre) throw infecte();
        if (p.etat_analyse !== "saine") throw enAttente();
        return {
          fichier: { contenu: dechiffrerPiece(cleChiffrement, p.id, p.contenu_chiffre, p.empreinte), type: p.type, aAnalyser: false },
          objet: `${libelle}, demande du site n° ${p.numero}${d.document === "auto" ? ` (pièce « ${LIBELLES_NATURE[p.nature]} »)` : ""}`,
        };
      });

      // Un fichier envoyé à l'instant passe d'abord par l'antivirus ; les pièces enregistrées l'ont déjà été
      if (fichier.aAnalyser) {
        const verdict = await antivirus.analyser(fichier.contenu);
        if (verdict.etat === "infectee") throw infecte();
        if (verdict.etat !== "saine") throw enAttente();
      }

      await transactionUtilisateur(pool, moi.id, (client) =>
        consignerEvenement(client, "lecture_automatique", { utilisateurId: moi.id, ip: requete.ip, objet }),
      );
      const debut = Date.now();
      const piece = { contenu: fichier.contenu, type: fichier.type };

      // Quel document est-ce ? (seulement si la personne ne l'a pas dit)
      let document: TypeDocument;
      let reconnaissance: Reconnaissance | null = null;
      if (d.document === "auto") {
        const reconnu = await lecteur.reconnaitre(piece, permis);
        if (!reconnu.ok) throw erreurLecture(reconnu);
        reconnaissance = reconnu.reconnaissance;
        if (!reconnaissance.document) {
          requete.log.info({ document: "auto", prestataire: lecteur.nom, issue: "non_reconnu", duree: Date.now() - debut }, "lecture automatique");
          throw new ErreurApi(422, "document_non_reconnu", `Ce document n'est pas l'un de ceux que l'outil sait lire${
            reconnaissance.description ? ` (il semble s'agir de : ${reconnaissance.description})` : ""}. Choisissez son type, ou saisissez les champs à la main.`);
        }
        document = reconnaissance.document;
      } else {
        document = d.document;
      }

      const resultat = await lecteur.lire(document, piece);
      // Jamais les valeurs lues dans le journal de l'application : seulement le document, l'issue et la durée
      requete.log.info({ document, reconnu: reconnaissance !== null, prestataire: lecteur.nom, issue: resultat.ok ? "lu" : resultat.raison, duree: Date.now() - debut },
        "lecture automatique");
      if (!resultat.ok) throw erreurLecture(resultat);

      const aujourdhui = new Date();
      const controles: Controle[] = controler(document, resultat.champs, aujourdhui);
      if (reconnaissance && reconnaissance.confiance !== "haute") {
        controles.unshift({
          champ: null, niveau: "attention",
          message: `Type de document reconnu sans certitude : vérifiez qu'il s'agit bien de : ${LIBELLES_DOCUMENTS[document].toLowerCase()}.`,
        });
      }
      const rapprochements = await transactionUtilisateur(pool, moi.id, (client) =>
        rapprocher(client, document, resultat.champs, { clientId: d.clientId, aujourdhui: aujourdhui.toISOString().slice(0, 10) }),
      );
      return {
        document,
        libelle: LIBELLES_DOCUMENTS[document],
        reconnaissance: reconnaissance && { confiance: reconnaissance.confiance, description: reconnaissance.description },
        prestataire: resultat.classeur ? "classeur" : lecteur.nom,
        champs: resultat.champs,
        controles,
        rapprochements,
        avertissement: resultat.classeur
          ? "Liste lue dans le classeur Excel : l'aperçu de l'import la contrôle ligne par ligne avant tout enregistrement."
          : "Valeurs lues automatiquement : vérifiez chacune avec le document avant d'enregistrer.",
      };
    },
  );
}
