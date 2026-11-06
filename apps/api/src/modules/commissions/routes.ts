// Commissions : taux par branche (datés), relevés envoyés par la compagnie, rapprochement mensuel
// avec la commission attendue (calculée par la base sur la prime nette de chaque encaissement), et facture
// FNE de l'agence pour chaque mois (tâche 12).
// Réservé au gérant ; l'auditeur lit.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi } from "../../commun/erreurs.js";
import { BRANCHES, date, texteCourt, type Branche } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";

export async function routesCommissions(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;

  app.get("/commissions", { preHandler: gardes.roles("gerant", "auditeur") }, async (requete) =>
    transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
      const taux = await client.query(
        `SELECT t.id, t.branche, t.taux::float8 AS taux, t.applicable_du AS "applicableDu", u.nom AS "creePar",
                t.applicable_du = (SELECT max(x.applicable_du) FROM app.taux_commission x
                                   WHERE x.branche = t.branche AND x.applicable_du <= (now() AT TIME ZONE 'Africa/Abidjan')::date)
                  AS "enVigueur"
         FROM app.taux_commission t JOIN app.utilisateurs u ON u.id = t.cree_par
         ORDER BY t.branche, t.applicable_du DESC`,
      );
      const rapprochement = await client.query(
        `SELECT to_char(m.mois, 'YYYY-MM') AS mois, m.primes_encaissees AS "primesEncaissees",
                m.commission_attendue AS "commissionAttendue", m.encaissements_incomplets AS "encaissementsIncomplets",
                m.montant_declare AS "montantDeclare", m.reference, m.ecart,
                f.numero_fne AS "numeroFne", f.montant_ttc AS "montantFne"
         FROM app.v_commissions_mensuelles m
         LEFT JOIN app.factures_fne f ON f.mois = m.mois AND f.objet = 'commissions' AND f.annulee_le IS NULL
         ORDER BY m.mois DESC LIMIT 12`,
      );
      // Contrats payés dont la prime nette manque : sans elle, la commission attendue reste inconnue
      const aCompleter = await client.query(
        `SELECT k.id, k.numero_police AS "numeroPolice", k.branche, k.prime_ttc AS "primeTtc", c.id AS "clientId", c.nom AS "clientNom"
         FROM app.contrats k JOIN app.clients c ON c.id = k.client_id
         WHERE k.prime_nette IS NULL AND EXISTS (SELECT 1 FROM app.encaissements e WHERE e.contrat_id = k.id)
         ORDER BY k.cree_le DESC LIMIT 50`,
      );
      return { taux: taux.rows, rapprochement: rapprochement.rows, contratsSansPrimeNette: aCompleter.rows };
    }),
  );

  app.post<{ Body: { branche: Branche; taux: number; applicableDu: string } }>(
    "/commissions/taux",
    {
      preHandler: gardes.roles("gerant"),
      schema: {
        body: {
          type: "object",
          required: ["branche", "taux", "applicableDu"],
          additionalProperties: false,
          properties: {
            branche: { type: "string", enum: BRANCHES },
            taux: { type: "number", minimum: 0, maximum: 50 },
            applicableDu: date,
          },
        },
      },
    },
    async (requete, reponse) => {
      const { branche, applicableDu } = requete.body;
      const taux = Math.round(requete.body.taux * 100) / 100;
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `INSERT INTO app.taux_commission (branche, taux, applicable_du) VALUES ($1, $2, $3)
           RETURNING id, branche, taux::float8 AS taux, applicable_du AS "applicableDu"`,
          [branche, taux.toFixed(2), applicableDu],
        ),
      );
      return reponse.status(201).send({ taux: rows[0] });
    },
  );

  // Relevé de la compagnie pour un mois : créé, ou corrigé s'il existe déjà (chaque version reste au journal d'audit)
  app.post<{ Body: { mois: string; montantDeclare: number; reference?: string; commentaire?: string } }>(
    "/commissions/releves",
    {
      preHandler: gardes.roles("gerant"),
      schema: {
        body: {
          type: "object",
          required: ["mois", "montantDeclare"],
          additionalProperties: false,
          properties: {
            mois: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" },
            montantDeclare: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
            reference: texteCourt(80),
            commentaire: texteCourt(1000),
          },
        },
      },
    },
    async (requete) => {
      const { mois, montantDeclare } = requete.body;
      const premierJour = `${mois}-01`;
      const moisCourant = new Date().toISOString().slice(0, 7);
      if (mois > moisCourant) throw new ErreurApi(422, "mois_futur", "Ce mois n'a pas encore commencé.");
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `INSERT INTO app.releves_commissions AS r (mois, montant_declare, reference, commentaire)
           VALUES ($1, $2, nullif(btrim($3), ''), nullif(btrim($4), ''))
           ON CONFLICT (mois) DO UPDATE
             SET montant_declare = EXCLUDED.montant_declare, reference = EXCLUDED.reference, commentaire = EXCLUDED.commentaire
           RETURNING r.id, to_char(r.mois, 'YYYY-MM') AS mois, r.montant_declare AS "montantDeclare", r.reference, r.commentaire`,
          [premierJour, montantDeclare, requete.body.reference ?? null, requete.body.commentaire ?? null],
        ),
      );
      return { releve: rows[0] };
    },
  );
}
