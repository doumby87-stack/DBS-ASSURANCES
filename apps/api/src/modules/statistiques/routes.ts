// Statistiques du gérant (tâche 12) : production, encaissements, portefeuille, renouvellements, sinistres,
// réclamations, demandes du site et paiements en ligne, pour une année. Calculées à la demande par la base,
// sous les droits de la personne connectée (gérant et auditeur).

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";

const DANS_L_ANNEE = (colonne: string) => `${colonne} >= $1::date AND ${colonne} < ($1::date + interval '1 year')`;
const JOUR_ABIDJAN = (colonne: string) => `(${colonne} AT TIME ZONE 'Africa/Abidjan')::date`;

export async function routesStatistiques(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;

  app.get<{ Querystring: { annee?: string } }>(
    "/statistiques",
    {
      preHandler: gardes.roles("gerant", "auditeur"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { annee: { type: "string", pattern: "^20[2-9][0-9]$" } },
        },
      },
    },
    async (requete) => {
      // Les paramètres de requête arrivent en texte (aucune conversion implicite) : vérifiés par le schéma, convertis ici
      const annee = requete.query.annee ? Number(requete.query.annee) : new Date().getUTCFullYear();
      const debut = `${annee}-01-01`;
      return transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const { rows: mois } = await client.query(
          `SELECT to_char(m, 'YYYY-MM') AS mois,
                  (SELECT count(*)::int FROM app.contrats k WHERE k.date_effet >= m AND k.date_effet < m + interval '1 month') AS "contratsSouscrits",
                  (SELECT coalesce(sum(k.prime_ttc), 0)::bigint FROM app.contrats k
                   WHERE k.date_effet >= m AND k.date_effet < m + interval '1 month') AS "primesEmises",
                  (SELECT coalesce(sum(e.montant), 0)::bigint FROM app.encaissements e
                   WHERE ${JOUR_ABIDJAN("e.encaisse_le")} >= m AND ${JOUR_ABIDJAN("e.encaisse_le")} < m + interval '1 month') AS encaisse,
                  (SELECT count(*)::int FROM app.sinistres s WHERE s.declare_le >= m AND s.declare_le < m + interval '1 month') AS sinistres
           FROM generate_series($1::date, $1::date + interval '11 months', interval '1 month') AS m
           ORDER BY m`,
          [debut],
        );

        const { rows: branches } = await client.query(
          `SELECT k.branche,
                  count(*) FILTER (WHERE ${DANS_L_ANNEE("k.date_effet")})::int AS souscrits,
                  coalesce(sum(k.prime_ttc) FILTER (WHERE ${DANS_L_ANNEE("k.date_effet")}), 0)::bigint AS primes,
                  count(*) FILTER (WHERE k.statut = 'en_vigueur')::int AS "enVigueur"
           FROM app.contrats k GROUP BY k.branche
           HAVING count(*) FILTER (WHERE ${DANS_L_ANNEE("k.date_effet")} OR k.statut = 'en_vigueur') > 0
           ORDER BY primes DESC, k.branche`,
          [debut],
        );

        const { rows: modes } = await client.query(
          `SELECT e.mode, count(*) FILTER (WHERE e.montant > 0)::int AS nombre, coalesce(sum(e.montant), 0)::bigint AS montant,
                  coalesce(sum(e.montant) FILTER (WHERE e.paiement_en_ligne_id IS NOT NULL), 0)::bigint AS "enLigne"
           FROM app.encaissements e WHERE ${DANS_L_ANNEE(JOUR_ABIDJAN("e.encaisse_le"))}
           GROUP BY e.mode ORDER BY montant DESC`,
          [debut],
        );

        const { rows: [portefeuille] } = await client.query(
          `SELECT (SELECT count(*)::int FROM app.clients) AS clients,
                  (SELECT count(DISTINCT k.client_id)::int FROM app.contrats k WHERE k.statut = 'en_vigueur') AS "clientsAssures",
                  (SELECT count(*)::int FROM app.contrats k WHERE k.statut = 'en_vigueur') AS "contratsEnVigueur",
                  (SELECT coalesce(sum(greatest(s.reste_a_payer, 0)), 0)::bigint FROM app.v_soldes_contrats s
                   WHERE s.statut IN ('en_attente_paiement', 'en_vigueur')) AS "resteARecouvrer"`,
        );

        // Renouvellements : contrats arrivés à échéance cette année (jusqu'à aujourd'hui), renouvelés ou non
        const { rows: [renouvellement] } = await client.query(
          `SELECT count(*)::int AS echus,
                  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM app.contrats r WHERE r.renouvelle_id = k.id))::int AS renouveles
           FROM app.contrats k
           WHERE ${DANS_L_ANNEE("k.date_echeance")} AND k.date_echeance <= app.aujourdhui() AND k.statut <> 'resilie'`,
          [debut],
        );

        const { rows: [sinistres] } = await client.query(
          `SELECT count(*)::int AS declares,
                  count(*) FILTER (WHERE s.declare_par_gestionnaire IS NOT NULL)::int AS "enLigne",
                  count(*) FILTER (WHERE s.statut NOT IN ('regle', 'refuse', 'classe_sans_suite'))::int AS "enCours",
                  round(avg(s.declare_le - s.survenu_le), 1)::float8 AS "delaiDeclaration"
           FROM app.sinistres s WHERE ${DANS_L_ANNEE("s.declare_le")}`,
          [debut],
        );

        const { rows: [reclamations] } = await client.query(
          `SELECT count(*)::int AS recues,
                  count(*) FILTER (WHERE r.statut <> 'close')::int AS ouvertes,
                  count(*) FILTER (WHERE r.repondue_le IS NOT NULL)::int AS repondues,
                  count(*) FILTER (WHERE ${JOUR_ABIDJAN("r.repondue_le")} <= r.echeance_reponse)::int AS "dansLesDelais",
                  count(*) FILTER (WHERE r.issue IN ('fondee', 'partiellement_fondee'))::int AS fondees,
                  round(avg(${JOUR_ABIDJAN("r.repondue_le")} - ${JOUR_ABIDJAN("r.recue_le")}), 1)::float8 AS "delaiReponse"
           FROM app.reclamations r WHERE ${DANS_L_ANNEE(JOUR_ABIDJAN("r.recue_le"))}`,
          [debut],
        );

        const { rows: [demandesSite] } = await client.query(
          `SELECT count(*)::int AS recues, count(*) FILTER (WHERE d.statut = 'convertie')::int AS converties
           FROM app.demandes_site d WHERE ${DANS_L_ANNEE(JOUR_ABIDJAN("d.recue_le"))}`,
          [debut],
        );

        // Production par personne de l'agence (contrats saisis) et par apporteur
        const { rows: production } = await client.query(
          `SELECT u.id, u.nom, u.role, count(*)::int AS contrats, coalesce(sum(k.prime_ttc), 0)::bigint AS primes
           FROM app.contrats k JOIN app.utilisateurs u ON u.id = k.cree_par
           WHERE ${DANS_L_ANNEE("k.date_effet")}
           GROUP BY u.id, u.nom, u.role ORDER BY primes DESC LIMIT 20`,
          [debut],
        );
        const { rows: apporteurs } = await client.query(
          `SELECT u.id, u.nom, count(*)::int AS contrats, coalesce(sum(k.prime_ttc), 0)::bigint AS primes
           FROM app.contrats k JOIN app.clients c ON c.id = k.client_id JOIN app.utilisateurs u ON u.id = c.apporteur_id
           WHERE ${DANS_L_ANNEE("k.date_effet")}
           GROUP BY u.id, u.nom ORDER BY primes DESC LIMIT 20`,
          [debut],
        );

        return { annee, mois, branches, modes, portefeuille, renouvellement, sinistres, reclamations, demandesSite, production, apporteurs };
      });
    },
  );
}
