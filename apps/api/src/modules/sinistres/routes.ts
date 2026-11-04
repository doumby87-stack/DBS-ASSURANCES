// Sinistres, côté agence : déclaration d'un sinistre sur un contrat (et, pour une flotte, sur le véhicule
// concerné, couvert ce jour-là : la base le vérifie), puis suivi de son statut et de la référence de la
// compagnie. Chaque changement de statut est annoncé au client qui l'a accepté (relances, tâche 6) et
// alimente l'historique des sinistres du véhicule, visible sur le portail des entreprises (tâche 10).

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { erreurs } from "../../commun/erreurs.js";
import { date, parametreId, texteCourt } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";

export const NATURES_SINISTRE = ["materiel", "corporel", "vol", "incendie", "bris_de_glace", "degat_des_eaux", "autre"] as const;
export const STATUTS_SINISTRE = [
  "declare", "transmis_compagnie", "expertise", "offre_recue", "regle", "refuse", "classe_sans_suite",
] as const;

const COLONNES = `s.id, s.contrat_id AS "contratId", s.vehicule_id AS "vehiculeId", s.survenu_le AS "survenuLe",
  s.declare_le AS "declareLe", s.nature, s.dommages_corporels AS "dommagesCorporels", s.description, s.statut,
  s.reference_compagnie AS "referenceCompagnie"`;

export async function routesSinistres(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;
  const gestionnaires = gardes.roles("gerant", "charge_clientele");

  app.post<{
    Params: { id: string };
    Body: { vehiculeId?: string; survenuLe: string; nature: string; dommagesCorporels?: boolean; description?: string };
  }>(
    "/contrats/:id/sinistres",
    {
      preHandler: gestionnaires,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["survenuLe", "nature"],
          additionalProperties: false,
          properties: {
            vehiculeId: { type: "string", format: "uuid" },
            survenuLe: date,
            nature: { type: "string", enum: [...NATURES_SINISTRE] },
            dommagesCorporels: { type: "boolean" },
            description: texteCourt(4000, 0),
          },
        },
      },
    },
    async (requete, reponse) => {
      const s = requete.body;
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const contrat = await client.query("SELECT 1 FROM app.contrats WHERE id = $1", [requete.params.id]);
        if (!contrat.rowCount) throw erreurs.introuvable();
        return client.query(
          `INSERT INTO app.sinistres AS s (contrat_id, vehicule_id, survenu_le, nature, dommages_corporels, description)
           VALUES ($1, $2, $3, $4, $5, nullif(btrim($6), '')) RETURNING ${COLONNES}`,
          [requete.params.id, s.vehiculeId ?? null, s.survenuLe, s.nature, s.dommagesCorporels ?? s.nature === "corporel", s.description ?? null],
        );
      });
      return reponse.status(201).send({ sinistre: rows[0] });
    },
  );

  app.patch<{ Params: { id: string }; Body: { statut?: string; referenceCompagnie?: string; description?: string } }>(
    "/sinistres/:id",
    {
      preHandler: gestionnaires,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            statut: { type: "string", enum: [...STATUTS_SINISTRE] },
            referenceCompagnie: texteCourt(60, 0),
            description: texteCourt(4000, 0),
          },
        },
      },
    },
    async (requete) => {
      const { statut, referenceCompagnie, description } = requete.body;
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `UPDATE app.sinistres AS s SET statut = coalesce($2::app.statut_sinistre, statut),
             reference_compagnie = CASE WHEN $3::text IS NULL THEN reference_compagnie ELSE nullif(btrim($3), '') END,
             description = CASE WHEN $4::text IS NULL THEN description ELSE nullif(btrim($4), '') END
           WHERE s.id = $1 RETURNING ${COLONNES}`,
          [requete.params.id, statut ?? null, referenceCompagnie ?? null, description ?? null],
        ),
      );
      if (!rows[0]) throw erreurs.introuvable();
      return { sinistre: rows[0] };
    },
  );
}
