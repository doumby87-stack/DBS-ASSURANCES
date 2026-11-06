// Identification des clients (lutte contre le blanchiment, tâche 12) : fiche, pièce d'identité, dirigeants et
// bénéficiaires effectifs, justificatifs, vérification de l'original. La base tient l'état de la fiche et refuse
// la souscription d'un client à risque élevé mal identifié (database/migrations/0014).
//   · le numéro de pièce est chiffré ici, avant la base (donnée « très sensible ») ; il ne s'affiche en entier
//     que sur demande du gérant ou du chargé de clientèle, et chaque affichage est consigné ;
//   · les autres rôles ne voient que l'état de la fiche (complète, à compléter, à revoir), jamais son contenu.

import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Client, Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { date, parametreId, texteCourt } from "../../commun/schemas.js";
import { nomDeFichier } from "../../commun/zip.js";
import type { Antivirus } from "../../integrations/antivirus/clamav.js";
import { chiffrer, dechiffrer } from "../../securite/chiffrement.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { consignerEvenement } from "../../securite/limitation.js";
import { exigerClientVisible } from "../clients/visibilite.js";
import { EXTENSIONS, LONGUEUR_BASE64_MAX, TYPES_PIECE, type TypePiece, verifierPiece } from "../demandes-site/piece.js";
import { nomAffiche } from "../sinistres/pieces.js";

export const TYPES_PIECE_IDENTITE = ["cni", "passeport", "carte_sejour", "carte_consulaire", "permis_conduire", "attestation_identite"] as const;
export const NATURES_JUSTIFICATIF = ["piece_identite", "justificatif_domicile", "rccm", "statuts", "liste_beneficiaires", "autre"] as const;
const NIVEAUX_RISQUE = ["faible", "normal", "eleve"] as const;

const contexteNumero = (clientId: string) => `identite:${clientId}`;
const contexteJustificatif = (id: string) => `justificatif-identification:${id}`;

/** N° de pièce normalisé : majuscules, lettres et chiffres seulement. */
export function normaliserNumeroPiece(saisie: string): string {
  return saisie.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

interface Fiche {
  niveauRisque: string;
  motifRisque: string | null;
  personnePolitiquementExposee: boolean;
  typePiece: string | null;
  numeroPieceFin: string | null;
  pieceExpireLe: string | null;
  dateNaissance: string | null;
  nationalite: string | null;
  activite: string | null;
  adresse: string | null;
  numeroContribuable: string | null;
  formeJuridique: string | null;
  origineFonds: string | null;
  verifieeLe: string | null;
  verifieePar: string | null;
  prochaineRevue: string | null;
}

async function lireEtat(client: Client, clientId: string) {
  const { rows } = await client.query<{ statut: string; niveauRisque: string; manques: string[]; prochaineRevue: string | null }>(
    `SELECT statut, niveau_risque AS "niveauRisque", manques, prochaine_revue AS "prochaineRevue"
     FROM app.etat_identification($1)`,
    [clientId],
  );
  return rows[0]!;
}

export async function routesIdentification(
  app: FastifyInstance,
  options: { pool: Pool; gardes: Gardes; cleChiffrement: Buffer; antivirus: Antivirus },
): Promise<void> {
  const { pool, gardes, cleChiffrement, antivirus } = options;
  const gestion = gardes.roles("gerant", "charge_clientele");
  const tousLesRoles = gardes.roles("gerant", "charge_clientele", "caissier", "commercial", "apporteur", "auditeur");

  // État de la fiche pour tous ceux qui voient le client ; son contenu pour le gérant, le chargé et l'auditeur
  app.get<{ Params: { id: string } }>(
    "/clients/:id/identification",
    { preHandler: tousLesRoles, schema: { params: parametreId } },
    async (requete) => {
      return transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        const etat = await lireEtat(client, requete.params.id);
        const { rows: fiches } = await client.query<Fiche>(
          `SELECT f.niveau_risque AS "niveauRisque", f.motif_risque AS "motifRisque",
                  f.personne_politiquement_exposee AS "personnePolitiquementExposee", f.type_piece AS "typePiece",
                  f.numero_piece_fin AS "numeroPieceFin", f.piece_expire_le AS "pieceExpireLe", f.date_naissance AS "dateNaissance",
                  f.nationalite, f.activite, f.adresse, f.numero_contribuable AS "numeroContribuable",
                  f.forme_juridique AS "formeJuridique", f.origine_fonds AS "origineFonds", f.verifiee_le AS "verifieeLe",
                  u.nom AS "verifieePar", f.prochaine_revue AS "prochaineRevue"
           FROM app.identifications_clients f LEFT JOIN app.utilisateurs u ON u.id = f.verifiee_par
           WHERE f.client_id = $1`,
          [requete.params.id],
        );
        const { rows: personnes } = await client.query(
          `SELECT id, nom, est_dirigeant AS "estDirigeant", est_beneficiaire_effectif AS "estBeneficiaireEffectif",
                  part_capital::float8 AS "partCapital", nationalite, date_naissance AS "dateNaissance",
                  personne_politiquement_exposee AS "personnePolitiquementExposee"
           FROM app.dirigeants_beneficiaires WHERE client_id = $1 AND retire_le IS NULL ORDER BY cree_le`,
          [requete.params.id],
        );
        const { rows: justificatifs } = await client.query(
          `SELECT j.id, j.nature, j.nom_fichier AS nom, j.type_contenu AS type, j.taille, j.etat_analyse AS "etatAnalyse",
                  j.depose_le AS "deposeLe", u.nom AS "deposePar"
           FROM app.justificatifs_identification j JOIN app.utilisateurs u ON u.id = j.depose_par
           WHERE j.client_id = $1 ORDER BY j.depose_le DESC`,
          [requete.params.id],
        );
        return { etat, fiche: fiches[0] ?? null, dirigeants: personnes, justificatifs };
      });
    },
  );

  app.put<{
    Params: { id: string };
    Body: {
      niveauRisque: (typeof NIVEAUX_RISQUE)[number]; motifRisque?: string; personnePolitiquementExposee: boolean;
      typePiece?: (typeof TYPES_PIECE_IDENTITE)[number]; numeroPiece?: string; pieceExpireLe?: string; dateNaissance?: string;
      nationalite?: string; activite?: string; adresse?: string; numeroContribuable?: string; formeJuridique?: string;
      origineFonds?: string;
    };
  }>(
    "/clients/:id/identification",
    {
      preHandler: gestion,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["niveauRisque", "personnePolitiquementExposee"],
          additionalProperties: false,
          properties: {
            niveauRisque: { type: "string", enum: [...NIVEAUX_RISQUE] },
            motifRisque: texteCourt(500, 0),
            personnePolitiquementExposee: { type: "boolean" },
            typePiece: { type: "string", enum: [...TYPES_PIECE_IDENTITE] },
            numeroPiece: texteCourt(40, 4),
            pieceExpireLe: date,
            dateNaissance: date,
            nationalite: texteCourt(60, 0),
            activite: texteCourt(120, 0),
            adresse: texteCourt(300, 0),
            numeroContribuable: texteCourt(30, 0),
            formeJuridique: texteCourt(60, 0),
            origineFonds: texteCourt(500, 0),
          },
        },
      },
    },
    async (requete) => {
      const d = requete.body;
      const texte = (valeur: string | undefined) => (valeur?.trim() ? valeur.trim() : null);
      let numeroChiffre: Buffer | null = null;
      let numeroFin: string | null = null;
      if (d.numeroPiece !== undefined) {
        const numero = normaliserNumeroPiece(d.numeroPiece);
        if (numero.length < 4) throw new ErreurApi(422, "numero_invalide", "N° de pièce invalide : 4 lettres ou chiffres au moins.");
        if (!d.typePiece) throw new ErreurApi(422, "type_piece", "Indiquez le type de la pièce.");
        numeroChiffre = chiffrer(cleChiffrement, Buffer.from(numero, "utf8"), contexteNumero(requete.params.id));
        numeroFin = numero.slice(-4);
      }
      return transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        // Le numéro n'est remplacé que s'il est fourni : il ne revient jamais en clair vers le navigateur
        await client.query(
          `INSERT INTO app.identifications_clients AS f (client_id, niveau_risque, motif_risque, personne_politiquement_exposee,
             type_piece, numero_piece_chiffre, numero_piece_fin, piece_expire_le, date_naissance, nationalite, activite, adresse,
             numero_contribuable, forme_juridique, origine_fonds)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (client_id) DO UPDATE SET
             niveau_risque = EXCLUDED.niveau_risque, motif_risque = EXCLUDED.motif_risque,
             personne_politiquement_exposee = EXCLUDED.personne_politiquement_exposee,
             type_piece = coalesce(EXCLUDED.type_piece, f.type_piece),
             numero_piece_chiffre = coalesce(EXCLUDED.numero_piece_chiffre, f.numero_piece_chiffre),
             numero_piece_fin = coalesce(EXCLUDED.numero_piece_fin, f.numero_piece_fin),
             piece_expire_le = EXCLUDED.piece_expire_le, date_naissance = EXCLUDED.date_naissance,
             nationalite = EXCLUDED.nationalite, activite = EXCLUDED.activite, adresse = EXCLUDED.adresse,
             numero_contribuable = EXCLUDED.numero_contribuable, forme_juridique = EXCLUDED.forme_juridique,
             origine_fonds = EXCLUDED.origine_fonds`,
          [requete.params.id, d.niveauRisque, texte(d.motifRisque), d.personnePolitiquementExposee, d.typePiece ?? null,
            numeroChiffre, numeroFin, d.pieceExpireLe ?? null, d.dateNaissance ?? null, texte(d.nationalite), texte(d.activite),
            texte(d.adresse), texte(d.numeroContribuable), texte(d.formeJuridique), texte(d.origineFonds)],
        );
        return { etat: await lireEtat(client, requete.params.id) };
      });
    },
  );

  // L'original de la pièce a été vu par la personne connectée
  app.post<{ Params: { id: string } }>(
    "/clients/:id/identification/verification",
    { preHandler: gestion, schema: { params: parametreId } },
    async (requete) => {
      return transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        await client.query("SELECT app.verifier_identification($1)", [requete.params.id]);
        return { etat: await lireEtat(client, requete.params.id) };
      });
    },
  );

  // N° de pièce en entier : action volontaire, consignée au journal de sécurité
  app.post<{ Params: { id: string } }>(
    "/clients/:id/identification/numero",
    { preHandler: gestion, schema: { params: parametreId } },
    async (requete) => {
      const moi = utilisateurDe(requete);
      return transactionUtilisateur(pool, moi.id, async (client) => {
        const { rows } = await client.query<{ chiffre: Buffer | null; nom: string }>(
          `SELECT f.numero_piece_chiffre AS chiffre, c.nom FROM app.identifications_clients f
           JOIN app.clients c ON c.id = f.client_id WHERE f.client_id = $1`,
          [requete.params.id],
        );
        const ligne = rows[0];
        if (!ligne?.chiffre) throw erreurs.introuvable();
        const numero = dechiffrer(cleChiffrement, ligne.chiffre, contexteNumero(requete.params.id)).toString("utf8");
        await consignerEvenement(client, "donnee_sensible_consultee", { utilisateurId: moi.id, ip: requete.ip, objet: `N° de pièce de ${ligne.nom}` });
        return { numero };
      });
    },
  );

  // Dirigeants et bénéficiaires effectifs
  app.post<{
    Params: { id: string };
    Body: {
      nom: string; estDirigeant: boolean; estBeneficiaireEffectif: boolean; partCapital?: number; nationalite?: string;
      dateNaissance?: string; personnePolitiquementExposee?: boolean;
    };
  }>(
    "/clients/:id/dirigeants",
    {
      preHandler: gestion,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["nom", "estDirigeant", "estBeneficiaireEffectif"],
          additionalProperties: false,
          properties: {
            nom: texteCourt(160, 2),
            estDirigeant: { type: "boolean" },
            estBeneficiaireEffectif: { type: "boolean" },
            partCapital: { type: "number", minimum: 0, maximum: 100 },
            nationalite: texteCourt(60, 0),
            dateNaissance: date,
            personnePolitiquementExposee: { type: "boolean" },
          },
        },
      },
    },
    async (requete, reponse) => {
      const d = requete.body;
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        return client.query(
          `INSERT INTO app.dirigeants_beneficiaires (client_id, nom, est_dirigeant, est_beneficiaire_effectif, part_capital, nationalite,
             date_naissance, personne_politiquement_exposee)
           VALUES ($1, btrim($2), $3, $4, $5, nullif(btrim($6), ''), $7, $8)
           RETURNING id, nom, est_dirigeant AS "estDirigeant", est_beneficiaire_effectif AS "estBeneficiaireEffectif",
                     part_capital::float8 AS "partCapital", personne_politiquement_exposee AS "personnePolitiquementExposee"`,
          [requete.params.id, d.nom, d.estDirigeant, d.estBeneficiaireEffectif, d.partCapital ?? null, d.nationalite ?? null,
            d.dateNaissance ?? null, d.personnePolitiquementExposee ?? false],
        );
      });
      return reponse.status(201).send({ dirigeant: rows[0] });
    },
  );

  app.delete<{ Params: { id: string; personneId: string } }>(
    "/clients/:id/dirigeants/:personneId",
    {
      preHandler: gestion,
      schema: {
        params: {
          type: "object",
          required: ["id", "personneId"],
          properties: { id: { type: "string", format: "uuid" }, personneId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (requete, reponse) => {
      const { rowCount } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query("UPDATE app.dirigeants_beneficiaires SET retire_le = now() WHERE id = $1 AND client_id = $2 AND retire_le IS NULL",
          [requete.params.personneId, requete.params.id]),
      );
      if (!rowCount) throw erreurs.introuvable();
      return reponse.status(204).send();
    },
  );

  // Justificatifs : contenu reconnu, antivirus, chiffrement
  app.post<{ Params: { id: string }; Body: { nature: (typeof NATURES_JUSTIFICATIF)[number]; nom: string; type: TypePiece; fichier: string } }>(
    "/clients/:id/justificatifs",
    {
      preHandler: gestion,
      bodyLimit: LONGUEUR_BASE64_MAX + 4096,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["nature", "nom", "type", "fichier"],
          additionalProperties: false,
          properties: {
            nature: { type: "string", enum: [...NATURES_JUSTIFICATIF] },
            nom: texteCourt(200),
            type: { type: "string", enum: [...TYPES_PIECE] },
            fichier: texteCourt(LONGUEUR_BASE64_MAX, 4),
          },
        },
      },
    },
    async (requete, reponse) => {
      const piece = verifierPiece(requete.body.type, requete.body.fichier);
      if (!piece.ok) {
        throw new ErreurApi(422, "piece_invalide", piece.raison === "trop_volumineuse" ? "Fichier trop lourd (5 Mo au plus)."
          : piece.raison === "type_refuse" ? "Envoyez une photo (JPEG ou PNG) ou un PDF." : "Le fichier n'a pas pu être lu.");
      }
      let etat: "saine" | "a_analyser" = "a_analyser";
      if (antivirus.configure) {
        const verdict = await antivirus.analyser(piece.contenu);
        if (verdict.etat === "infectee") {
          requete.log.warn({ signature: verdict.signature }, "justificatif infecté refusé au dépôt");
          throw new ErreurApi(422, "fichier_infecte", "Ce fichier contient un virus : il a été refusé.");
        }
        if (verdict.etat === "indisponible") {
          throw new ErreurApi(503, "antivirus_indisponible", "Analyse antivirus momentanément impossible : réessayez dans quelques minutes.");
        }
        etat = "saine";
      }
      const id = randomUUID();
      const nom = nomAffiche(requete.body.nom);
      await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        await client.query(
          `INSERT INTO app.justificatifs_identification (id, client_id, nature, nom_fichier, type_contenu, taille, contenu_chiffre, empreinte, etat_analyse)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, requete.params.id, requete.body.nature, nom, piece.type, piece.contenu.length,
            chiffrer(cleChiffrement, piece.contenu, contexteJustificatif(id)), createHash("sha256").update(piece.contenu).digest(), etat],
        );
      });
      return reponse.status(201).send({ justificatif: { id, nature: requete.body.nature, nom, type: piece.type, taille: piece.contenu.length } });
    },
  );

  app.get<{ Params: { id: string; justificatifId: string } }>(
    "/clients/:id/justificatifs/:justificatifId",
    {
      preHandler: gestion,
      schema: {
        params: {
          type: "object",
          required: ["id", "justificatifId"],
          properties: { id: { type: "string", format: "uuid" }, justificatifId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (requete, reponse) => {
      const moi = utilisateurDe(requete);
      const fichier = await transactionUtilisateur(pool, moi.id, async (client) => {
        const { rows } = await client.query<{ nom: string; type: string; contenu_chiffre: Buffer; empreinte: Buffer; etat_analyse: string; client: string }>(
          `SELECT j.nom_fichier AS nom, j.type_contenu AS type, j.contenu_chiffre, j.empreinte, j.etat_analyse, c.nom AS client
           FROM app.justificatifs_identification j JOIN app.clients c ON c.id = j.client_id
           WHERE j.id = $1 AND j.client_id = $2`,
          [requete.params.justificatifId, requete.params.id],
        );
        const ligne = rows[0];
        if (!ligne) throw erreurs.introuvable();
        if (ligne.etat_analyse !== "saine") throw new ErreurApi(503, "analyse_en_attente", "Document pas encore analysé par l'antivirus.");
        const contenu = dechiffrer(cleChiffrement, ligne.contenu_chiffre, contexteJustificatif(requete.params.justificatifId));
        if (!createHash("sha256").update(contenu).digest().equals(ligne.empreinte)) throw new Error("Empreinte du justificatif incorrecte");
        await consignerEvenement(client, "piece_telechargee", { utilisateurId: moi.id, ip: requete.ip, objet: `Justificatif de ${ligne.client} : ${ligne.nom}` });
        return { contenu, type: ligne.type, nom: `${nomDeFichier(ligne.nom.replace(/\.[A-Za-z0-9]{1,5}$/, "")).slice(0, 60)}.${EXTENSIONS[ligne.type as TypePiece] ?? "bin"}` };
      });
      return reponse.type(fichier.type).header("Content-Disposition", `attachment; filename="${fichier.nom}"`).send(fichier.contenu);
    },
  );

  // Clients en relation dont la fiche est absente, incomplète ou à revoir
  app.get("/identifications/a-completer", { preHandler: gardes.roles("gerant", "charge_clientele", "auditeur") }, async (requete) => {
    const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
      client.query(
        `SELECT client_id AS "clientId", nom, type, statut, niveau_risque AS "niveauRisque", manques,
                prochaine_revue AS "prochaineRevue", contrats_en_cours AS "contratsEnCours"
         FROM app.v_identifications_a_completer
         ORDER BY (niveau_risque = 'eleve') DESC, (statut = 'absente') DESC, nom
         LIMIT 500`,
      ),
    );
    return { clients: rows };
  });
}
