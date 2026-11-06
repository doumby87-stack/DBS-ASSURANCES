// Registre des réclamations (tâche 12) : enregistrées au guichet, au téléphone ou par écrit, ou déposées par le
// client dans son espace. La base numérote, date et fixe les échéances (accusé de réception sous 2 jours ouvrés,
// réponse sous 10) ; le gérant ou le chargé de clientèle traite chaque étape (database/migrations/0014).
// Le registre s'exporte pour la compagnie et la Direction des Assurances.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionPortail, transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { documentCsv } from "../../commun/csv.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { normaliserTelephone } from "../../commun/formats.js";
import { parametreId, texteCourt } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { consignerEvenement } from "../../securite/limitation.js";
import { gardePortail, gestionnaireDe } from "../portail/connexion.js";

export const CANAUX_RECLAMATION = ["guichet", "telephone", "whatsapp", "email", "courrier"] as const;
export const OBJETS_RECLAMATION = [
  "contrat", "prime_paiement", "sinistre", "attestation", "accueil_service", "donnees_personnelles", "autre",
] as const;
const ISSUES = ["fondee", "partiellement_fondee", "non_fondee"] as const;

const COLONNES = `r.id, r.reference, r.client_id AS "clientId", r.nom, r.telephone, r.canal, r.objet, r.description,
  r.contrat_id AS "contratId", k.numero_police AS "numeroPolice", r.sinistre_id AS "sinistreId", r.statut,
  r.recue_le AS "recueLe", r.echeance_accuse AS "echeanceAccuse", r.echeance_reponse AS "echeanceReponse",
  r.accuse_le AS "accuseLe", r.reponse, r.issue, r.repondue_le AS "repondueLe", r.escalade, r.escalade_le AS "escaladeLe",
  r.close_le AS "closeLe", coalesce(u.nom, g.nom) AS "enregistrePar",
  (r.accuse_le IS NULL AND r.statut <> 'close' AND app.aujourdhui() > r.echeance_accuse) AS "accuseEnRetard",
  (r.reponse IS NULL AND r.statut <> 'close' AND app.aujourdhui() > r.echeance_reponse) AS "reponseEnRetard"`;

const DEPUIS = `FROM app.reclamations r
  LEFT JOIN app.contrats k ON k.id = r.contrat_id
  LEFT JOIN app.utilisateurs u ON u.id = r.cree_par
  LEFT JOIN app.gestionnaires_portail g ON g.id = r.cree_par_gestionnaire`;

const LIBELLES_OBJET: Record<string, string> = {
  contrat: "Contrat", prime_paiement: "Prime ou paiement", sinistre: "Sinistre", attestation: "Attestation",
  accueil_service: "Accueil et service", donnees_personnelles: "Données personnelles", autre: "Autre",
};
const jourHeure = (valeur: Date | null) =>
  valeur ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Abidjan" }).format(valeur) : "";

export async function routesReclamations(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;
  const personnel = gardes.roles("gerant", "charge_clientele", "caissier", "commercial", "auditeur");

  app.get<{ Querystring: { toutes?: "oui"; clientId?: string } }>(
    "/reclamations",
    {
      preHandler: personnel,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { toutes: { type: "string", enum: ["oui"] }, clientId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (requete) => {
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `SELECT ${COLONNES} ${DEPUIS}
           WHERE ($1 OR r.statut <> 'close') AND ($2::uuid IS NULL OR r.client_id = $2)
           ORDER BY (r.statut = 'close'), r.recue_le DESC LIMIT 500`,
          [requete.query.toutes === "oui" || requete.query.clientId !== undefined, requete.query.clientId ?? null],
        ),
      );
      return { reclamations: rows };
    },
  );

  app.get<{ Params: { id: string } }>("/reclamations/:id", { preHandler: personnel, schema: { params: parametreId } }, async (requete) => {
    const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
      client.query(`SELECT ${COLONNES} ${DEPUIS} WHERE r.id = $1`, [requete.params.id]));
    if (!rows[0]) throw erreurs.introuvable();
    return { reclamation: rows[0] };
  });

  app.post<{
    Body: {
      clientId?: string; nom?: string; telephone?: string; canal: (typeof CANAUX_RECLAMATION)[number];
      objet: (typeof OBJETS_RECLAMATION)[number]; description: string; contratId?: string; sinistreId?: string;
    };
  }>(
    "/reclamations",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "caissier", "commercial"),
      schema: {
        body: {
          type: "object",
          required: ["canal", "objet", "description"],
          additionalProperties: false,
          properties: {
            clientId: { type: "string", format: "uuid" },
            nom: texteCourt(160, 2),
            telephone: texteCourt(30, 8),
            canal: { type: "string", enum: [...CANAUX_RECLAMATION] },
            objet: { type: "string", enum: [...OBJETS_RECLAMATION] },
            description: texteCourt(4000, 10),
            contratId: { type: "string", format: "uuid" },
            sinistreId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (requete, reponse) => {
      const d = requete.body;
      if (!d.clientId && !d.nom) throw new ErreurApi(422, "nom_obligatoire", "Indiquez le client, ou au moins le nom de la personne.");
      let telephone: string | null = null;
      if (d.telephone) {
        telephone = normaliserTelephone(d.telephone);
        if (!telephone) throw new ErreurApi(400, "telephone_invalide", "Numéro de téléphone invalide.");
      }
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query<{ id: string; reference: string }>(
          `INSERT INTO app.reclamations (client_id, nom, telephone, canal, objet, description, contrat_id, sinistre_id)
           VALUES ($1, coalesce(btrim($2), ''), $3, $4, $5, btrim($6), $7, $8) RETURNING id, reference`,
          [d.clientId ?? null, d.nom ?? null, telephone, d.canal, d.objet, d.description, d.contratId ?? null, d.sinistreId ?? null],
        ),
      );
      return reponse.status(201).send({ reclamation: rows[0] });
    },
  );

  // Une étape du traitement : accusé de réception, réponse (avec son issue), recours, clôture
  app.post<{
    Params: { id: string };
    Body: { action: "accuser" | "repondre" | "escalader" | "clore"; reponse?: string; issue?: (typeof ISSUES)[number];
      escalade?: "compagnie" | "direction_assurances" };
  }>(
    "/reclamations/:id/traitement",
    {
      preHandler: gardes.roles("gerant", "charge_clientele"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["action"],
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["accuser", "repondre", "escalader", "clore"] },
            reponse: texteCourt(4000, 10),
            issue: { type: "string", enum: [...ISSUES] },
            escalade: { type: "string", enum: ["compagnie", "direction_assurances"] },
          },
        },
      },
    },
    async (requete) => {
      const d = requete.body;
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await client.query("SELECT app.traiter_reclamation($1, $2, $3, $4, $5)",
          [requete.params.id, d.action, d.reponse ?? null, d.issue ?? null, d.escalade ?? null]);
        return client.query(`SELECT ${COLONNES} ${DEPUIS} WHERE r.id = $1`, [requete.params.id]);
      });
      return { reclamation: rows[0] };
    },
  );

  // Registre complet, pour la compagnie et la Direction des Assurances (export consigné)
  app.get("/reclamations.csv", { preHandler: gardes.roles("gerant", "auditeur") }, async (requete, reponse) => {
    const moi = utilisateurDe(requete);
    const lignes = await transactionUtilisateur(pool, moi.id, async (client) => {
      const { rows } = await client.query<{
        reference: string; recueLe: Date; nom: string; canal: string; objet: string; description: string; numeroPolice: string | null;
        accuseLe: Date | null; repondueLe: Date | null; reponse: string | null; issue: string | null; escalade: string | null;
        closeLe: Date | null; statut: string;
      }>(`SELECT ${COLONNES} ${DEPUIS} ORDER BY r.numero`);
      await consignerEvenement(client, "export_donnees", { utilisateurId: moi.id, ip: requete.ip, objet: `Registre des réclamations (${rows.length})` });
      return rows;
    });
    const entetes = ["Référence", "Reçue le", "Réclamant", "Canal", "Objet", "Description", "Contrat", "Accusé de réception", "Réponse le",
      "Réponse", "Issue", "Recours", "Close le", "État"];
    const csv = documentCsv([entetes, ...lignes.map((r) => [r.reference, jourHeure(r.recueLe), r.nom, r.canal, LIBELLES_OBJET[r.objet] ?? r.objet,
      r.description, r.numeroPolice, jourHeure(r.accuseLe), jourHeure(r.repondueLe), r.reponse, r.issue, r.escalade, jourHeure(r.closeLe), r.statut])]);
    return reponse
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="registre-des-reclamations.csv"')
      .send(csv);
  });
}

/** Réclamations depuis l'espace client : déposer, suivre (la réponse de l'agence comprise). */
export async function routesReclamationsPortail(app: FastifyInstance, options: { pool: Pool }): Promise<void> {
  const { pool } = options;
  const garde = gardePortail(pool);

  app.get("/portail/reclamations", { preHandler: garde }, async (requete) => {
    const moi = gestionnaireDe(requete);
    const { rows } = await transactionPortail(pool, moi.gestionnaireId, (client) =>
      client.query(
        `SELECT r.id, r.reference, r.objet, r.description, r.statut, r.canal, r.recue_le AS "recueLe",
                r.echeance_reponse AS "echeanceReponse", r.accuse_le AS "accuseLe", r.reponse, r.repondue_le AS "repondueLe",
                r.close_le AS "closeLe", k.numero_police AS "numeroPolice"
         FROM app.reclamations r LEFT JOIN app.contrats k ON k.id = r.contrat_id
         WHERE r.client_id = $1 ORDER BY r.recue_le DESC LIMIT 100`,
        [moi.clientId],
      ),
    );
    return { reclamations: rows };
  });

  app.post<{ Body: { objet: (typeof OBJETS_RECLAMATION)[number]; description: string; contratId?: string; sinistreId?: string } }>(
    "/portail/reclamations",
    {
      preHandler: garde,
      config: { appeleeParLePortail: true },
      schema: {
        body: {
          type: "object",
          required: ["objet", "description"],
          additionalProperties: false,
          properties: {
            objet: { type: "string", enum: [...OBJETS_RECLAMATION] },
            description: texteCourt(4000, 10),
            contratId: { type: "string", format: "uuid" },
            sinistreId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (requete, reponse) => {
      const moi = gestionnaireDe(requete);
      const d = requete.body;
      const { rows } = await transactionPortail(pool, moi.gestionnaireId, (client) =>
        client.query<{ id: string; reference: string }>(
          "SELECT id, reference FROM portail.deposer_reclamation($1, $2, $3, $4)",
          [d.objet, d.description, d.contratId ?? null, d.sinistreId ?? null],
        ),
      );
      return reponse.status(201).send({ reclamation: rows[0] });
    },
  );
}
