// Paiement en plusieurs fois d'un contrat flotte : lecture de l'échéancier (back-office et portail),
// définition par le chargé de clientèle ou le gérant. Les règles (total égal à la prime, dates, mise en
// vigueur à la première échéance, renégociation par le gérant seul) sont dans la base : app.definir_echeancier
// (database/migrations/0018).

import type { FastifyInstance } from "fastify";
import type { Client, Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { date, montant, parametreId } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";

export type EtatEcheance = "payee" | "en_retard" | "bientot" | "a_venir";

export interface EcheancePaiement {
  id: string;
  rang: number;
  exigibleLe: string;
  montant: number;
  paye: number;
  reste: number;
  etat: EtatEcheance;
  /** Jours avant l'échéance (négatif : en retard depuis tant de jours) */
  jours: number;
}

export interface Echeancier {
  echeances: EcheancePaiement[];
  /** Ce qui est dû aujourd'hui (échéances passées non payées, avenants) ; null sans échéancier */
  aPayerMaintenant: number | null;
  /** Première échéance pas encore soldée */
  prochaine: EcheancePaiement | null;
}

interface LigneVue extends EcheancePaiement {
  avenantsImpayes: number;
}

/** Résumé d'un échéancier lu dans app.v_echeances_paiement (lignes dans l'ordre des rangs). */
export function resumerEcheancier(lignes: LigneVue[]): Echeancier {
  if (lignes.length === 0) return { echeances: [], aPayerMaintenant: null, prochaine: null };
  const echeances = lignes.map(({ avenantsImpayes: _avenants, ...echeance }) => echeance);
  const echues = echeances.filter((e) => e.jours <= 0).reduce((total, e) => total + e.reste, 0);
  return {
    echeances,
    aPayerMaintenant: echues + lignes[0]!.avenantsImpayes,
    prochaine: echeances.find((e) => e.reste > 0) ?? null,
  };
}

const COLONNES = `e.id, e.rang, e.exigible_le AS "exigibleLe", e.montant, e.paye, e.reste, e.etat, e.jours,
  e.avenants_impayes AS "avenantsImpayes"`;

/** Échéancier d'un contrat, avec les droits de la personne connectée (personnel ou portail). */
export async function lireEcheancier(client: Client, contratId: string): Promise<Echeancier> {
  const { rows } = await client.query<LigneVue>(
    `SELECT ${COLONNES} FROM app.v_echeances_paiement e WHERE e.contrat_id = $1 ORDER BY e.rang`,
    [contratId],
  );
  return resumerEcheancier(rows);
}

/** Échéanciers de plusieurs contrats d'un coup (tableau de bord du portail). */
export async function lireEcheanciers(client: Client, contratIds: string[]): Promise<Map<string, Echeancier>> {
  const resultat = new Map<string, Echeancier>();
  if (contratIds.length === 0) return resultat;
  const { rows } = await client.query<LigneVue & { contratId: string }>(
    `SELECT e.contrat_id AS "contratId", ${COLONNES} FROM app.v_echeances_paiement e
     WHERE e.contrat_id = ANY ($1::uuid[]) ORDER BY e.contrat_id, e.rang`,
    [contratIds],
  );
  const parContrat = new Map<string, LigneVue[]>();
  for (const { contratId, ...ligne } of rows) parContrat.set(contratId, [...(parContrat.get(contratId) ?? []), ligne]);
  for (const [contratId, lignes] of parContrat) resultat.set(contratId, resumerEcheancier(lignes));
  return resultat;
}

export async function routesEcheancier(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;

  // Définit, redéfinit (gérant, une fois un paiement reçu) ou retire (tableau vide, avant tout paiement)
  // l'échéancier d'un contrat flotte ; la prime peut changer en même temps
  app.post<{ Params: { id: string }; Body: { echeances: { exigibleLe: string; montant: number }[]; primeTtc?: number } }>(
    "/contrats/:id/echeancier",
    {
      preHandler: gardes.roles("gerant", "charge_clientele"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["echeances"],
          additionalProperties: false,
          properties: {
            echeances: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                required: ["exigibleLe", "montant"],
                additionalProperties: false,
                properties: { exigibleLe: date, montant },
              },
            },
            primeTtc: montant,
          },
        },
      },
    },
    async (requete) => {
      const { echeances, primeTtc } = requete.body;
      return transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await client.query("SELECT app.definir_echeancier($1, $2::jsonb, $3)", [
          requete.params.id,
          JSON.stringify(echeances.map((e) => ({ exigible_le: e.exigibleLe, montant: e.montant }))),
          primeTtc ?? null,
        ]);
        const contrat = await client.query<{ statut: string; primeTtc: number }>(
          `SELECT statut, prime_ttc AS "primeTtc" FROM app.contrats WHERE id = $1`, [requete.params.id]);
        return { contrat: contrat.rows[0], echeancier: await lireEcheancier(client, requete.params.id) };
      });
    },
  );
}

/** Échéances de paiement en retard ou dues dans les 15 jours, pour le tableau de bord de l'agence. */
export async function lireEcheancesPaiementAgence(client: Client) {
  const { rows } = await client.query(
    `SELECT e.id, e.contrat_id AS "contratId", k.client_id AS "clientId", c.nom AS "clientNom", c.telephone,
            k.numero_police AS "numeroPolice", e.rang, (SELECT count(*)::int FROM app.echeances_paiement x WHERE x.contrat_id = k.id) AS nombre,
            e.exigible_le AS "exigibleLe", e.reste, e.etat, e.jours
     FROM app.v_echeances_paiement e
     JOIN app.contrats k ON k.id = e.contrat_id
     JOIN app.clients c ON c.id = k.client_id
     WHERE e.reste > 0 AND e.etat IN ('en_retard', 'bientot') AND k.statut IN ('en_attente_paiement', 'en_vigueur', 'suspendu')
     ORDER BY e.exigible_le, c.nom`,
  );
  return rows;
}
