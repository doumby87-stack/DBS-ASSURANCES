// Encaissements : paiement d'une prime, reçu, contre-passation, journal.
// La base reste la gardienne des règles (plafond des espèces, reste à payer, références, numéros sans trou,
// mise en vigueur du contrat) ; l'API vérifie d'abord pour donner un message précis au guichet.

import type { FastifyInstance } from "fastify";
import type { Client, Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { AGENCE } from "../../commun/agence.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { formaterMontant } from "../../commun/formats.js";
import { montantEnLettres } from "../../commun/montant-en-lettres.js";
import { date, montant, parametreId, texteCourt } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";

export const MODES = ["especes", "cheque", "mobile_money", "virement"] as const;
export type Mode = (typeof MODES)[number];

/** Rôles qui voient la caisse (base : politique encaissements_lecture). */
export const ROLES_LECTURE_CAISSE = ["gerant", "caissier", "charge_clientele", "auditeur"] as const;

interface SoldeContrat {
  id: string;
  clientId: string;
  clientNom: string;
  numeroPolice: string | null;
  branche: string;
  statut: string;
  dateEffet: string;
  dateEcheance: string;
  primeTtc: number;
  primeNette: number | null;
  encaisse: number;
  especes: number;
  plafondEspeces: number;
}

/** Contrat et ce qui a déjà été payé dessus, ou 404. */
export async function lireSolde(client: Client, contratId: string): Promise<SoldeContrat & { resteAPayer: number; especesPossibles: number }> {
  const { rows } = await client.query<SoldeContrat>(
    `SELECT k.id, k.client_id AS "clientId", c.nom AS "clientNom", k.numero_police AS "numeroPolice", k.branche, k.statut,
            k.date_effet AS "dateEffet", k.date_echeance AS "dateEcheance",
            k.prime_ttc AS "primeTtc", k.prime_nette AS "primeNette",
            coalesce((SELECT sum(e.montant) FROM app.encaissements e WHERE e.contrat_id = k.id), 0)::bigint AS encaisse,
            coalesce((SELECT sum(e.montant) FROM app.encaissements e WHERE e.contrat_id = k.id AND e.mode = 'especes'), 0)::bigint AS especes,
            app.plafond_especes_par_police() AS "plafondEspeces"
     FROM app.contrats k JOIN app.clients c ON c.id = k.client_id
     WHERE k.id = $1`,
    [contratId],
  );
  const solde = rows[0];
  if (!solde) throw erreurs.introuvable();
  return {
    ...solde,
    resteAPayer: Math.max(solde.primeTtc - solde.encaisse, 0),
    especesPossibles: Math.max(Math.min(solde.plafondEspeces - solde.especes, solde.primeTtc - solde.encaisse), 0),
  };
}

const COLONNES_ENCAISSEMENT = `e.id, e.numero_recu AS "numeroRecu", e.contrat_id AS "contratId", e.montant, e.mode,
  e.reference_externe AS "reference", e.motif, e.encaisse_le AS "encaisseLe", e.annule_encaissement_id AS "annuleEncaissementId",
  e.reversement_id AS "reversementId", u.nom AS "encaissePar",
  EXISTS (SELECT 1 FROM app.encaissements x WHERE x.annule_encaissement_id = e.id) AS "contrePasse"`;

export async function routesEncaissements(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;
  const lecteurs = gardes.roles(...ROLES_LECTURE_CAISSE);

  // Situation de paiement d'un contrat : ce qui reste à payer, ce qui peut encore être réglé en espèces
  app.get<{ Params: { id: string } }>(
    "/contrats/:id/paiements",
    { preHandler: lecteurs, schema: { params: parametreId } },
    async (requete) =>
      transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const contrat = await lireSolde(client, requete.params.id);
        const { rows } = await client.query(
          `SELECT ${COLONNES_ENCAISSEMENT}
           FROM app.encaissements e JOIN app.utilisateurs u ON u.id = e.encaisse_par
           WHERE e.contrat_id = $1 ORDER BY e.numero_recu`,
          [requete.params.id],
        );
        return { contrat, encaissements: rows };
      }),
  );

  app.post<{ Body: { contratId: string; montant: number; mode: Mode; reference?: string } }>(
    "/encaissements",
    {
      preHandler: gardes.roles("gerant", "caissier"),
      schema: {
        body: {
          type: "object",
          required: ["contratId", "montant", "mode"],
          additionalProperties: false,
          properties: {
            contratId: { type: "string", format: "uuid" },
            montant,
            mode: { type: "string", enum: MODES },
            reference: texteCourt(60, 3),
          },
        },
      },
    },
    async (requete, reponse) => {
      const { contratId, montant: valeur, mode } = requete.body;
      const reference = requete.body.reference?.trim() || null;
      if (mode !== "especes" && !reference) {
        throw new ErreurApi(422, "reference_obligatoire", "Indiquez la référence du paiement (n° de transaction, de chèque ou de virement).");
      }
      const resultat = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const solde = await lireSolde(client, contratId);
        if (valeur > solde.resteAPayer) {
          throw new ErreurApi(
            422, "reste_a_payer",
            solde.resteAPayer === 0
              ? "Ce contrat est déjà entièrement payé."
              : `Montant supérieur au reste à payer (${formaterMontant(solde.resteAPayer)}).`,
          );
        }
        if (mode === "especes" && solde.especes + valeur > solde.plafondEspeces) {
          throw new ErreurApi(
            422, "plafond_especes",
            `Plafond des espèces : ${formaterMontant(solde.especes)} déjà réglés en espèces sur cette police, ` +
              `${formaterMontant(solde.plafondEspeces)} au plus. Le reste se règle par chèque à l'ordre de ` +
              `${AGENCE.compagnie}, par Mobile Money ou par virement.`,
          );
        }
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [contratId, valeur, mode, reference],
        );
        const id = rows[0]!.id;
        const apres = await lireSolde(client, contratId);
        const encaissement = await client.query(
          `SELECT ${COLONNES_ENCAISSEMENT} FROM app.encaissements e JOIN app.utilisateurs u ON u.id = e.encaisse_par WHERE e.id = $1`,
          [id],
        );
        return { encaissement: encaissement.rows[0], contrat: apres };
      });
      return reponse.status(201).send(resultat);
    },
  );

  // Contre-passation : annule exactement un encaissement erroné (réservée au gérant, motif obligatoire)
  app.post<{ Params: { id: string }; Body: { motif: string } }>(
    "/encaissements/:id/contre-passation",
    {
      preHandler: gardes.roles("gerant"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["motif"],
          additionalProperties: false,
          properties: { motif: texteCourt(300, 5) },
        },
      },
    },
    async (requete, reponse) => {
      const motif = requete.body.motif.trim();
      if (motif.length < 5) throw new ErreurApi(422, "motif_obligatoire", "Expliquez en quelques mots pourquoi l'encaissement est annulé.");
      const resultat = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const { rows } = await client.query<{ contratId: string; montant: number; mode: Mode }>(
          `SELECT e.contrat_id AS "contratId", e.montant, e.mode FROM app.encaissements e WHERE e.id = $1`,
          [requete.params.id],
        );
        const origine = rows[0];
        if (!origine) throw erreurs.introuvable();
        if (origine.montant < 0) throw new ErreurApi(422, "contre_passation", "Une contre-passation ne se contre-passe pas.");
        const insertion = await client.query<{ id: string }>(
          `INSERT INTO app.encaissements (contrat_id, montant, mode, annule_encaissement_id, motif)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [origine.contratId, -origine.montant, origine.mode, requete.params.id, motif],
        );
        const encaissement = await client.query(
          `SELECT ${COLONNES_ENCAISSEMENT} FROM app.encaissements e JOIN app.utilisateurs u ON u.id = e.encaisse_par WHERE e.id = $1`,
          [insertion.rows[0]!.id],
        );
        return { encaissement: encaissement.rows[0], contrat: await lireSolde(client, origine.contratId) };
      });
      return reponse.status(201).send(resultat);
    },
  );

  // Reçu : tout ce qui s'imprime, y compris le montant en lettres et le reste à payer après ce paiement
  app.get<{ Params: { id: string } }>(
    "/encaissements/:id/recu",
    { preHandler: lecteurs, schema: { params: parametreId } },
    async (requete) => {
      const recu = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const { rows } = await client.query<{ montant: number; primeTtc: number; totalADate: number }>(
          `SELECT e.id, e.numero_recu AS "numeroRecu", e.montant, e.mode, e.reference_externe AS "reference", e.motif,
                  e.encaisse_le AS "encaisseLe", u.nom AS "encaissePar",
                  c.nom AS "clientNom", c.telephone AS "clientTelephone",
                  k.id AS "contratId", k.numero_police AS "numeroPolice", k.branche, k.date_effet AS "dateEffet",
                  k.date_echeance AS "dateEcheance", k.prime_ttc AS "primeTtc",
                  (SELECT coalesce(sum(x.montant), 0) FROM app.encaissements x
                   WHERE x.contrat_id = e.contrat_id AND x.numero_recu <= e.numero_recu)::bigint AS "totalADate",
                  o.numero_recu AS "annuleRecu",
                  (SELECT x.numero_recu FROM app.encaissements x WHERE x.annule_encaissement_id = e.id) AS "contrePasseParRecu"
           FROM app.encaissements e
           JOIN app.utilisateurs u ON u.id = e.encaisse_par
           JOIN app.contrats k ON k.id = e.contrat_id
           JOIN app.clients c ON c.id = k.client_id
           LEFT JOIN app.encaissements o ON o.id = e.annule_encaissement_id
           WHERE e.id = $1`,
          [requete.params.id],
        );
        return rows[0];
      });
      if (!recu) throw erreurs.introuvable();
      const { totalADate, ...reste } = recu;
      return {
        recu: {
          ...reste,
          montantEnLettres: montantEnLettres(recu.montant),
          resteAPayer: Math.max(recu.primeTtc - totalADate, 0),
          agence: AGENCE,
        },
      };
    },
  );

  // Journal des encaissements d'une période (par défaut : aujourd'hui), toutes caisses confondues
  app.get<{ Querystring: { du?: string; au?: string } }>(
    "/encaissements",
    {
      preHandler: lecteurs,
      schema: {
        querystring: { type: "object", additionalProperties: false, properties: { du: date, au: date } },
      },
    },
    async (requete) => {
      const { du, au } = requete.query;
      if (du && au && au < du) throw new ErreurApi(422, "periode_invalide", "La fin de la période précède son début.");
      const lignes = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const { rows } = await client.query<{ montant: number; mode: Mode }>(
          `SELECT ${COLONNES_ENCAISSEMENT}, c.nom AS "clientNom", c.id AS "clientId", k.numero_police AS "numeroPolice", k.branche
           FROM app.encaissements e
           JOIN app.utilisateurs u ON u.id = e.encaisse_par
           JOIN app.contrats k ON k.id = e.contrat_id
           JOIN app.clients c ON c.id = k.client_id
           WHERE (e.encaisse_le AT TIME ZONE 'Africa/Abidjan')::date
                 BETWEEN coalesce($1::date, (now() AT TIME ZONE 'Africa/Abidjan')::date)
                     AND coalesce($2::date, $1::date, (now() AT TIME ZONE 'Africa/Abidjan')::date)
           ORDER BY e.numero_recu DESC
           LIMIT 1000`,
          [du ?? null, au ?? null],
        );
        return rows;
      });
      return { encaissements: lignes, totaux: totauxParMode(lignes) };
    },
  );
}

export function totauxParMode(lignes: { montant: number; mode: Mode }[]) {
  const totaux = { especes: 0, cheque: 0, mobile_money: 0, virement: 0, total: 0, nombre: lignes.length };
  for (const ligne of lignes) {
    totaux[ligne.mode] += ligne.montant;
    totaux.total += ligne.montant;
  }
  return totaux;
}
