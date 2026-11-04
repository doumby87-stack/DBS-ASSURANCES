// Contrats : création, modification, renouvellement ; tableau des échéances.
// La base refuse un contrat « en vigueur » dont la prime n'est pas entièrement payée (Code CIMA, art. 13).

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { BRANCHES, date, montant, parametreId, texteCourt, type Branche } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { exigerClientVisible } from "../clients/visibilite.js";

const STATUTS = ["en_attente_paiement", "en_vigueur", "suspendu", "resilie", "expire"] as const;
const COLONNES = `k.id, k.client_id AS "clientId", k.numero_police AS "numeroPolice", k.branche,
  k.date_effet AS "dateEffet", k.date_echeance AS "dateEcheance", k.prime_ttc AS "primeTtc",
  k.prime_nette AS "primeNette", k.statut, k.renouvelle_id AS "renouvelleId"`;

interface CorpsContrat {
  clientId: string;
  branche: Branche;
  numeroPolice?: string;
  dateEffet: string;
  dateEcheance: string;
  primeTtc: number;
  primeNette?: number;
}

function primeNetteValide(primeNette: number | undefined, primeTtc: number | undefined): void {
  if (primeNette !== undefined && primeTtc !== undefined && primeNette > primeTtc) {
    throw new ErreurApi(422, "prime_nette_invalide", "La prime nette doit être positive et ne pas dépasser la prime TTC.");
  }
}

/** Catégorie d'échéance affichée au tableau de bord. */
export function categorieEcheance(joursRestants: number): "expire" | "j7" | "j15" | "j30" | "j60" {
  if (joursRestants < 0) return "expire";
  if (joursRestants <= 7) return "j7";
  if (joursRestants <= 15) return "j15";
  if (joursRestants <= 30) return "j30";
  return "j60";
}

function periodeValide(dateEffet: string, dateEcheance: string): void {
  if (dateEcheance <= dateEffet) {
    throw new ErreurApi(422, "periode_invalide", "La date d'échéance doit être postérieure à la date d'effet.");
  }
}

export async function routesContrats(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;
  const gestionnaires = gardes.roles("gerant", "charge_clientele");

  app.post<{ Body: CorpsContrat }>(
    "/contrats",
    {
      preHandler: gestionnaires,
      schema: {
        body: {
          type: "object",
          required: ["clientId", "branche", "dateEffet", "dateEcheance", "primeTtc"],
          additionalProperties: false,
          properties: {
            clientId: { type: "string", format: "uuid" },
            branche: { type: "string", enum: BRANCHES },
            numeroPolice: texteCourt(40),
            dateEffet: date,
            dateEcheance: date,
            primeTtc: montant,
            primeNette: montant,
          },
        },
      },
    },
    async (requete, reponse) => {
      const c = requete.body;
      periodeValide(c.dateEffet, c.dateEcheance);
      primeNetteValide(c.primeNette, c.primeTtc);
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, c.clientId);
        return client.query(
          `INSERT INTO app.contrats AS k (client_id, branche, numero_police, date_effet, date_echeance, prime_ttc, prime_nette)
           VALUES ($1, $2, nullif(btrim($3), ''), $4, $5, $6, $7)
           RETURNING ${COLONNES}`,
          [c.clientId, c.branche, c.numeroPolice ?? null, c.dateEffet, c.dateEcheance, c.primeTtc, c.primeNette ?? null],
        );
      });
      return reponse.status(201).send({ contrat: rows[0] });
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      numeroPolice?: string; dateEffet?: string; dateEcheance?: string; primeTtc?: number; primeNette?: number;
      statut?: (typeof STATUTS)[number];
    };
  }>(
    "/contrats/:id",
    {
      preHandler: gestionnaires,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            numeroPolice: texteCourt(40),
            dateEffet: date,
            dateEcheance: date,
            primeTtc: montant,
            primeNette: montant,
            statut: { type: "string", enum: STATUTS },
          },
        },
      },
    },
    async (requete) => {
      const c = requete.body;
      primeNetteValide(c.primeNette, c.primeTtc);
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `UPDATE app.contrats AS k SET
             numero_police = coalesce(nullif(btrim($2), ''), numero_police),
             date_effet = coalesce($3, date_effet), date_echeance = coalesce($4, date_echeance),
             prime_ttc = coalesce($5, prime_ttc), statut = coalesce($6, statut), prime_nette = coalesce($7, prime_nette)
           WHERE k.id = $1
           RETURNING ${COLONNES}`,
          [
            requete.params.id, c.numeroPolice ?? null, c.dateEffet ?? null, c.dateEcheance ?? null, c.primeTtc ?? null,
            c.statut ?? null, c.primeNette ?? null,
          ],
        ),
      );
      if (!rows[0]) throw erreurs.introuvable();
      return { contrat: rows[0] };
    },
  );

  // Renouvellement : nouveau contrat qui commence à l'échéance de l'ancien, pour la même durée par défaut.
  // Il est « en attente de paiement » jusqu'au règlement de la prime ; l'ancien sort du tableau des échéances.
  // Les véhicules encore couverts à l'échéance (toute une flotte, avec la prime de chacun) sont repris comme
  // véhicules de départ du nouveau contrat ; ceux sortis en cours de contrat ne le sont pas.
  app.post<{ Params: { id: string }; Body: { dateEcheance?: string; primeTtc?: number } }>(
    "/contrats/:id/renouveler",
    {
      preHandler: gestionnaires,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          additionalProperties: false,
          properties: { dateEcheance: date, primeTtc: montant },
        },
      },
    },
    async (requete, reponse) => {
      const { dateEcheance, primeTtc } = requete.body ?? {};
      const { rows, vehiculesRepris } = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const nouveau = await client.query<{ id: string }>(
          `INSERT INTO app.contrats AS k (client_id, branche, date_effet, date_echeance, prime_ttc, prime_nette, renouvelle_id)
           SELECT a.client_id, a.branche, a.date_echeance,
                  coalesce($2::date, a.date_echeance + (a.date_echeance - a.date_effet)),
                  coalesce($3, a.prime_ttc),
                  -- Même prime nette seulement si la prime TTC ne change pas
                  CASE WHEN $3::bigint IS NULL THEN a.prime_nette END,
                  a.id
           FROM app.contrats a WHERE a.id = $1
           RETURNING ${COLONNES}`,
          [requete.params.id, dateEcheance ?? null, primeTtc ?? null],
        );
        if (!nouveau.rows[0]) throw erreurs.introuvable();
        const repris = await client.query(
          `INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le, prime_vehicule)
           SELECT $2, cv.vehicule_id, k.date_effet, cv.prime_vehicule
           FROM app.contrats_vehicules cv JOIN app.contrats k ON k.id = $2
           WHERE cv.contrat_id = $1 AND cv.retire_le IS NULL`,
          [requete.params.id, nouveau.rows[0].id],
        );
        return { rows: nouveau.rows, vehiculesRepris: repris.rowCount ?? 0 };
      });
      return reponse.status(201).send({ contrat: rows[0], vehiculesRepris });
    },
  );

  // Tableau des échéances : contrats à renouveler et documents de véhicules à renouveler, dans les 60 jours
  app.get("/echeances", { preHandler: gardes.sessionComplete() }, async (requete) => {
    const { contrats, vehicules } = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
      const contrats = await client.query<{ joursRestants: number }>(
        `SELECT e.contrat_id AS "contratId", e.client_id AS "clientId", c.nom AS "clientNom", c.telephone,
                e.numero_police AS "numeroPolice", e.branche, e.date_echeance AS "dateEcheance",
                e.jours_restants AS "joursRestants"
         FROM app.v_echeances_contrats e JOIN app.clients c ON c.id = e.client_id
         ORDER BY e.date_echeance, c.nom`,
      );
      const vehicules = await client.query<{ joursRestants: number }>(
        `SELECT e.vehicule_id AS "vehiculeId", e.client_id AS "clientId", c.nom AS "clientNom", c.telephone,
                e.immatriculation, e.document, e.echeance, e.jours_restants AS "joursRestants"
         FROM app.v_echeances_vehicules e JOIN app.clients c ON c.id = e.client_id
         ORDER BY e.echeance, c.nom`,
      );
      return { contrats: contrats.rows, vehicules: vehicules.rows };
    });
    const avecCategorie = <T extends { joursRestants: number }>(lignes: T[]) =>
      lignes.map((ligne) => ({ ...ligne, categorie: categorieEcheance(ligne.joursRestants) }));
    const lignes = avecCategorie(contrats);
    const compter = (categorie: string) => lignes.filter((l) => l.categorie === categorie).length;
    return {
      resume: { expire: compter("expire"), j7: compter("j7"), j15: compter("j15"), j30: compter("j30"), j60: compter("j60") },
      contrats: lignes,
      vehicules: avecCategorie(vehicules),
    };
  });
}
