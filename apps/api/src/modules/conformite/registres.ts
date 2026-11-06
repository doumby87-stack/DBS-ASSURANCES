// Registres de conformité (tâche 12) :
//   · alertes sur les situations inhabituelles (lutte contre le blanchiment) et décision du gérant, seul à les
//     voir : elles ne doivent jamais parvenir au client ;
//   · formations du personnel (rappel annuel), enregistrées par le gérant ;
//   · factures FNE de l'agence : numéro attribué par la plateforme de la DGI, saisi ici ; annulation motivée.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { date, montant, parametreId, texteCourt } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";

export const THEMES_FORMATION = ["lbc_ft", "hameconnage", "mots_de_passe", "procedure_incident", "donnees_personnelles"] as const;
const FORMAT_CLE_ALERTE = "^(especes_plafond|paiement_tiers|fractionnement|resiliation_rapide):[0-9a-f-]{36}$";

export async function routesRegistres(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;
  const gerant = gardes.roles("gerant");

  // --- Alertes ---------------------------------------------------------------------------------------

  app.get<{ Querystring: { toutes?: "oui" } }>(
    "/alertes",
    {
      preHandler: gerant,
      schema: { querystring: { type: "object", additionalProperties: false, properties: { toutes: { type: "string", enum: ["oui"] } } } },
    },
    async (requete) => {
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `SELECT a.cle, a.type, a.contrat_id AS "contratId", a.numero_police AS "numeroPolice", a.client_id AS "clientId",
                  a.client_nom AS client, a.detectee_le AS "detecteeLe", a.montant, a.detail, a.decision, a.motif,
                  a.traite_le AS "traiteLe", u.nom AS "traitePar"
           FROM app.v_alertes a LEFT JOIN app.utilisateurs u ON u.id = a.traite_par
           WHERE $1 OR a.decision IS NULL
           ORDER BY (a.decision IS NULL) DESC, a.detectee_le DESC
           LIMIT 500`,
          [requete.query.toutes === "oui"],
        ),
      );
      return { alertes: rows };
    },
  );

  app.post<{ Body: { cle: string; decision: "sans_suite" | "transmise_correspondant"; motif: string } }>(
    "/alertes/traitements",
    {
      preHandler: gerant,
      schema: {
        body: {
          type: "object",
          required: ["cle", "decision", "motif"],
          additionalProperties: false,
          properties: {
            cle: { type: "string", pattern: FORMAT_CLE_ALERTE, maxLength: 80 },
            decision: { type: "string", enum: ["sans_suite", "transmise_correspondant"] },
            motif: texteCourt(1000, 5),
          },
        },
      },
    },
    async (requete, reponse) => {
      const { cle, decision, motif } = requete.body;
      await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const existe = await client.query("SELECT 1 FROM app.v_alertes WHERE cle = $1", [cle]);
        if (!existe.rowCount) throw erreurs.introuvable();
        await client.query("INSERT INTO app.traitements_alertes (cle, decision, motif) VALUES ($1, $2, btrim($3))", [cle, decision, motif]);
      });
      return reponse.status(201).send({ traitement: { cle, decision } });
    },
  );

  // --- Formations ------------------------------------------------------------------------------------

  // Le gérant et l'auditeur voient tout le personnel ; chacun voit ses propres formations
  app.get("/formations", { preHandler: gardes.sessionComplete() }, async (requete) => {
    const moi = utilisateurDe(requete);
    const tout = moi.role === "gerant" || moi.role === "auditeur";
    return transactionUtilisateur(pool, moi.id, async (client) => {
      const { rows: etat } = await client.query(
        `SELECT utilisateur_id AS "utilisateurId", nom, role, theme, derniere, a_refaire AS "aRefaire"
         FROM app.v_formations_a_jour WHERE $1 OR utilisateur_id = $2 ORDER BY nom, theme`,
        [tout, moi.id],
      );
      const { rows: historique } = await client.query(
        `SELECT f.id, f.utilisateur_id AS "utilisateurId", u.nom, f.theme, f.suivie_le AS "suivieLe", f.commentaire,
                e.nom AS "enregistrePar"
         FROM app.formations_personnel f JOIN app.utilisateurs u ON u.id = f.utilisateur_id
         JOIN app.utilisateurs e ON e.id = f.enregistre_par
         ORDER BY f.suivie_le DESC LIMIT 200`,
      );
      return { etat, historique };
    });
  });

  app.post<{ Body: { utilisateurIds: string[]; theme: (typeof THEMES_FORMATION)[number]; suivieLe: string; commentaire?: string } }>(
    "/formations",
    {
      preHandler: gerant,
      schema: {
        body: {
          type: "object",
          required: ["utilisateurIds", "theme", "suivieLe"],
          additionalProperties: false,
          properties: {
            utilisateurIds: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: { type: "string", format: "uuid" } },
            theme: { type: "string", enum: [...THEMES_FORMATION] },
            suivieLe: date,
            commentaire: texteCourt(300, 0),
          },
        },
      },
    },
    async (requete, reponse) => {
      const { utilisateurIds, theme, suivieLe } = requete.body;
      const commentaire = requete.body.commentaire?.trim() || null;
      await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        for (const utilisateurId of utilisateurIds) {
          await client.query(
            "INSERT INTO app.formations_personnel (utilisateur_id, theme, suivie_le, commentaire) VALUES ($1, $2, $3, $4)",
            [utilisateurId, theme, suivieLe, commentaire],
          );
        }
      });
      return reponse.status(201).send({ enregistrees: utilisateurIds.length });
    },
  );

  // --- Factures FNE ----------------------------------------------------------------------------------

  app.get("/factures-fne", { preHandler: gardes.roles("gerant", "auditeur") }, async (requete) => {
    const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
      client.query(
        `SELECT f.id, f.numero_fne AS "numeroFne", f.emise_le AS "emiseLe", f.objet, to_char(f.mois, 'YYYY-MM') AS mois,
                f.destinataire, f.montant_ttc AS "montantTtc", f.commentaire, s.nom AS "saisiePar", f.annulee_le AS "annuleeLe",
                f.motif_annulation AS "motifAnnulation"
         FROM app.factures_fne f JOIN app.utilisateurs s ON s.id = f.saisie_par
         ORDER BY f.emise_le DESC, f.saisie_le DESC LIMIT 200`,
      ),
    );
    return { factures: rows };
  });

  app.post<{
    Body: { numeroFne: string; emiseLe: string; objet: "commissions" | "frais" | "autre"; mois?: string; destinataire: string;
      montantTtc: number; commentaire?: string };
  }>(
    "/factures-fne",
    {
      preHandler: gerant,
      schema: {
        body: {
          type: "object",
          required: ["numeroFne", "emiseLe", "objet", "destinataire", "montantTtc"],
          additionalProperties: false,
          properties: {
            numeroFne: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9/._-]{2,59}$" },
            emiseLe: date,
            objet: { type: "string", enum: ["commissions", "frais", "autre"] },
            mois: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" },
            destinataire: texteCourt(160, 2),
            montantTtc: montant,
            commentaire: texteCourt(500, 0),
          },
        },
      },
    },
    async (requete, reponse) => {
      const d = requete.body;
      if ((d.objet === "commissions") !== (d.mois !== undefined)) {
        throw new ErreurApi(422, "mois_commissions", "Une facture de commissions porte sur un mois (et seulement elle).");
      }
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `INSERT INTO app.factures_fne (numero_fne, emise_le, objet, mois, destinataire, montant_ttc, commentaire)
           VALUES ($1, $2, $3, $4, btrim($5), $6, nullif(btrim($7), ''))
           RETURNING id, numero_fne AS "numeroFne", objet, to_char(mois, 'YYYY-MM') AS mois, montant_ttc AS "montantTtc"`,
          [d.numeroFne, d.emiseLe, d.objet, d.mois ? `${d.mois}-01` : null, d.destinataire, d.montantTtc, d.commentaire ?? null],
        ),
      );
      return reponse.status(201).send({ facture: rows[0] });
    },
  );

  app.post<{ Params: { id: string }; Body: { motif: string } }>(
    "/factures-fne/:id/annulation",
    {
      preHandler: gerant,
      schema: {
        params: parametreId,
        body: { type: "object", required: ["motif"], additionalProperties: false, properties: { motif: texteCourt(300, 5) } },
      },
    },
    async (requete, reponse) => {
      const { rowCount } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query("UPDATE app.factures_fne SET annulee_le = now(), motif_annulation = btrim($2) WHERE id = $1",
          [requete.params.id, requete.body.motif]),
      );
      if (!rowCount) throw erreurs.introuvable();
      return reponse.status(204).send();
    },
  );
}
