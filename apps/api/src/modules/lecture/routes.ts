// Lecture automatique d'un document (tâche 14, ADR 0015) : carte grise, pièce d'identité ou constat amiable.
// Le document vient d'une photo envoyée à l'instant, ou d'une pièce déjà enregistrée (justificatif d'identité,
// photo jointe à un sinistre, carte grise jointe à une demande du site). Il est analysé par l'antivirus, lu, puis
// les valeurs sont contrôlées et renvoyées pour pré-remplir un formulaire : rien n'est enregistré, la personne
// vérifie chaque champ avec le document. Chaque lecture est consignée au journal de sécurité, sans les valeurs,
// et chacun est limité à 30 lectures par heure (coût et abus).

import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { texteCourt } from "../../commun/schemas.js";
import type { Antivirus } from "../../integrations/antivirus/clamav.js";
import { controler } from "../../integrations/lecture/controles.js";
import { DOCUMENTS, LIBELLES_DOCUMENTS, type TypeDocument } from "../../integrations/lecture/documents.js";
import type { LecteurDocuments } from "../../integrations/lecture/lecteur.js";
import { dechiffrer } from "../../securite/chiffrement.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { consignerEvenement } from "../../securite/limitation.js";
import type { Role } from "../../securite/sessions.js";
import { dechiffrerPiece, LONGUEUR_BASE64_MAX, TYPES_PIECE, verifierPiece, type TypePiece } from "../demandes-site/piece.js";
import { dechiffrerPieceSinistre } from "../sinistres/pieces.js";

export const LECTURES_PAR_HEURE_MAX = 30;

/** Qui peut faire lire quel document : ceux qui saisissent les fiches correspondantes */
const ROLES: Record<TypeDocument, Role[]> = {
  carte_grise: ["gerant", "charge_clientele", "commercial"],
  piece_identite: ["gerant", "charge_clientele"],
  constat_amiable: ["gerant", "charge_clientele"],
};

const MESSAGES_FICHIER = {
  illisible: "Le fichier n'a pas pu être lu. Envoyez une photo (JPEG ou PNG) ou un PDF.",
  trop_volumineuse: "Le fichier dépasse 5 Mo. Envoyez une photo moins lourde.",
  type_refuse: "Le fichier doit être une photo (JPEG ou PNG) ou un PDF.",
} as const;

interface Corps {
  document: TypeDocument;
  fichier?: { type: TypePiece; contenu: string };
  justificatifId?: string;
  pieceSinistreId?: string;
  demandeSiteId?: string;
}

const enAttente = () => new ErreurApi(503, "analyse_en_attente", "Ce document n'a pas encore été analysé par l'antivirus. Réessayez dans quelques minutes.");
const infecte = () => new ErreurApi(422, "piece_infectee", "L'antivirus a refusé ce fichier : il ne sera pas lu.");

export async function routesLecture(
  app: FastifyInstance,
  options: { pool: Pool; gardes: Gardes; cleChiffrement: Buffer; antivirus: Antivirus; lecteur: LecteurDocuments | null },
): Promise<void> {
  const { pool, gardes, cleChiffrement, antivirus, lecteur } = options;

  // Le back-office n'affiche les boutons de lecture que si elle est disponible
  app.get("/lecture-automatique", { preHandler: gardes.sessionComplete() }, async () => ({
    disponible: lecteur !== null, prestataire: lecteur?.nom ?? null,
  }));

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
            document: { type: "string", enum: DOCUMENTS },
            fichier: {
              type: "object",
              required: ["type", "contenu"],
              additionalProperties: false,
              properties: { type: { type: "string", enum: TYPES_PIECE }, contenu: texteCourt(LONGUEUR_BASE64_MAX, 4) },
            },
            justificatifId: { type: "string", format: "uuid" },
            pieceSinistreId: { type: "string", format: "uuid" },
            demandeSiteId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (requete) => {
      const moi = utilisateurDe(requete);
      const d = requete.body;
      if (!lecteur) throw new ErreurApi(503, "lecture_indisponible", "La lecture automatique n'est pas activée : saisissez les champs à la main.");
      if (!ROLES[d.document].includes(moi.role)) throw erreurs.accesRefuse();
      const sources = [d.fichier, d.justificatifId, d.pieceSinistreId, d.demandeSiteId].filter((s) => s !== undefined);
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
        const libelle = LIBELLES_DOCUMENTS[d.document];

        if (d.fichier) {
          const verifiee = verifierPiece(d.fichier.type, d.fichier.contenu);
          if (!verifiee.ok) throw new ErreurApi(422, "fichier_invalide", MESSAGES_FICHIER[verifiee.raison]);
          return { fichier: { contenu: verifiee.contenu, type: verifiee.type, aAnalyser: true }, objet: `${libelle} (photo envoyée)` };
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
        const { rows } = await client.query<{ id: string; contenu_chiffre: Buffer | null; empreinte: Buffer; type: TypePiece; etat_analyse: string; numero: number }>(
          `SELECT p.id, p.contenu_chiffre, p.empreinte, p.type_contenu AS type, p.etat_analyse, d.numero
           FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id WHERE p.demande_id = $1`,
          [d.demandeSiteId],
        );
        const p = rows[0];
        if (!p) throw erreurs.introuvable();
        if (p.etat_analyse === "infectee" || !p.contenu_chiffre) throw infecte();
        if (p.etat_analyse !== "saine") throw enAttente();
        return {
          fichier: { contenu: dechiffrerPiece(cleChiffrement, p.id, p.contenu_chiffre, p.empreinte), type: p.type, aAnalyser: false },
          objet: `${libelle}, demande du site n° ${p.numero}`,
        };
      });

      // Une photo envoyée à l'instant passe d'abord par l'antivirus ; les pièces enregistrées l'ont déjà été
      if (fichier.aAnalyser) {
        const verdict = await antivirus.analyser(fichier.contenu);
        if (verdict.etat === "infectee") throw infecte();
        if (verdict.etat !== "saine") throw enAttente();
      }

      await transactionUtilisateur(pool, moi.id, (client) =>
        consignerEvenement(client, "lecture_automatique", { utilisateurId: moi.id, ip: requete.ip, objet }),
      );
      const debut = Date.now();
      const resultat = await lecteur.lire(d.document, { contenu: fichier.contenu, type: fichier.type });
      // Jamais les valeurs lues dans le journal de l'application : seulement le document, l'issue et la durée
      requete.log.info({ document: d.document, prestataire: lecteur.nom, issue: resultat.ok ? "lu" : resultat.raison, duree: Date.now() - debut },
        "lecture automatique");
      if (!resultat.ok) {
        const statut = resultat.raison === "indisponible" || resultat.raison === "configuration" ? 503 : 422;
        throw new ErreurApi(statut, `lecture_${resultat.raison}`, resultat.message);
      }
      return {
        document: d.document,
        prestataire: lecteur.nom,
        champs: resultat.champs,
        controles: controler(d.document, resultat.champs),
        avertissement: "Valeurs lues automatiquement : vérifiez chacune avec le document avant d'enregistrer.",
      };
    },
  );
}
