// Devis : de la demande à l'acceptation ou au refus (avec son motif).

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { erreurs } from "../../commun/erreurs.js";
import { BRANCHES, montant, parametreId, texteCourt, type Branche } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { exigerClientVisible } from "../clients/visibilite.js";

const STATUTS = ["nouveau", "en_cotation", "envoye", "accepte", "refuse", "sans_suite"] as const;
const ORIGINES = ["agence", "telephone", "whatsapp", "email", "site", "apporteur"] as const;
const COLONNES = `d.id, d.client_id AS "clientId", d.branche, d.origine, d.description, d.prime_proposee AS "primeProposee",
  d.statut, d.motif_refus AS "motifRefus", d.cree_le AS "creeLe", d.modifie_le AS "modifieLe"`;

export async function routesDevis(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;

  app.post<{
    Params: { id: string };
    Body: { branche: Branche; origine?: (typeof ORIGINES)[number]; description?: string; primeProposee?: number };
  }>(
    "/clients/:id/devis",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial", "apporteur"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["branche"],
          additionalProperties: false,
          properties: {
            branche: { type: "string", enum: BRANCHES },
            origine: { type: "string", enum: ORIGINES },
            description: texteCourt(2000),
            primeProposee: montant,
          },
        },
      },
    },
    async (requete, reponse) => {
      const moi = utilisateurDe(requete);
      const d = requete.body;
      const { rows } = await transactionUtilisateur(pool, moi.id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        return client.query(
          `INSERT INTO app.devis AS d (client_id, branche, origine, description, prime_proposee)
           VALUES ($1, $2, $3, nullif(btrim($4), ''), $5)
           RETURNING ${COLONNES}`,
          [requete.params.id, d.branche, d.origine ?? (moi.role === "apporteur" ? "apporteur" : "agence"),
           d.description ?? null, d.primeProposee ?? null],
        );
      });
      return reponse.status(201).send({ devis: rows[0] });
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { statut?: (typeof STATUTS)[number]; primeProposee?: number; motifRefus?: string; description?: string };
  }>(
    "/devis/:id",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            statut: { type: "string", enum: STATUTS },
            primeProposee: montant,
            motifRefus: texteCourt(500),
            description: texteCourt(2000),
          },
        },
      },
    },
    async (requete) => {
      const d = requete.body;
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `UPDATE app.devis AS d SET
             statut = coalesce($2, statut), prime_proposee = coalesce($3, prime_proposee),
             motif_refus = coalesce(nullif(btrim($4), ''), motif_refus), description = coalesce(nullif(btrim($5), ''), description)
           WHERE d.id = $1
           RETURNING ${COLONNES}`,
          [requete.params.id, d.statut ?? null, d.primeProposee ?? null, d.motifRefus ?? null, d.description ?? null],
        ),
      );
      if (!rows[0]) throw erreurs.introuvable();
      return { devis: rows[0] };
    },
  );
}
