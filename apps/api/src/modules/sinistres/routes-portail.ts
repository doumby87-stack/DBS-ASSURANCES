// Déclaration d'un sinistre depuis l'espace client (tâche 9) : le client (particulier ou entreprise) décrit ce
// qui s'est passé, puis joint ses photos et documents, analysés par l'antivirus et chiffrés. L'agence reçoit la
// déclaration dans sa liste des sinistres à traiter et la transmet à la compagnie, comme une déclaration au
// guichet. La base vérifie le contrat, le véhicule couvert ce jour-là et les limites (database/migrations/0013).

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionPortail } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { date, parametreId, texteCourt } from "../../commun/schemas.js";
import type { Antivirus } from "../../integrations/antivirus/clamav.js";
import { gardePortail, gestionnaireDe } from "../portail/connexion.js";
import {
  chiffrerPieceSinistre, LONGUEUR_BASE64_MAX, MESSAGES_PIECE_SINISTRE, nomAffiche, TYPES_PIECE, verifierPiece,
} from "./pieces.js";
import { NATURES_SINISTRE } from "./routes.js";

const COLONNES = `s.id, s.survenu_le AS "survenuLe", s.declare_le AS "declareLe", s.nature, s.statut,
  s.dommages_corporels AS "dommagesCorporels", s.lieu, s.circonstances, s.reference_compagnie AS "referenceCompagnie",
  s.declare_par_gestionnaire IS NOT NULL AS "declareEnLigne", k.id AS "contratId", k.numero_police AS "numeroPolice",
  v.immatriculation,
  (SELECT count(*)::int FROM app.pieces_sinistres p WHERE p.sinistre_id = s.id) AS pieces,
  s.declare_le > (now() AT TIME ZONE 'Africa/Abidjan')::date - 7 AS "piecesAcceptees"`;

const DEPUIS = `FROM app.sinistres s JOIN app.contrats k ON k.id = s.contrat_id LEFT JOIN app.vehicules v ON v.id = s.vehicule_id`;

export async function routesSinistresPortail(
  app: FastifyInstance,
  options: { pool: Pool; cleChiffrement: Buffer; antivirus: Antivirus },
): Promise<void> {
  const { pool, cleChiffrement, antivirus } = options;
  const garde = gardePortail(pool);
  const config = { appeleeParLePortail: true };

  app.get("/portail/sinistres", { preHandler: garde }, async (requete) => {
    const moi = gestionnaireDe(requete);
    const { rows } = await transactionPortail(pool, moi.gestionnaireId, (client) =>
      client.query(`SELECT ${COLONNES} ${DEPUIS} WHERE k.client_id = $1 ORDER BY s.survenu_le DESC, s.declare_le DESC LIMIT 100`,
        [moi.clientId]),
    );
    return { sinistres: rows };
  });

  app.get<{ Params: { id: string } }>("/portail/sinistres/:id", { preHandler: garde, schema: { params: parametreId } }, async (requete) => {
    const moi = gestionnaireDe(requete);
    return transactionPortail(pool, moi.gestionnaireId, async (client) => {
      const { rows } = await client.query(`SELECT ${COLONNES} ${DEPUIS} WHERE s.id = $1`, [requete.params.id]);
      if (!rows[0]) throw erreurs.introuvable();
      const { rows: pieces } = await client.query(
        `SELECT id, nom_fichier AS nom, type_contenu AS type, taille, depose_le AS "deposeLe"
         FROM app.pieces_sinistres WHERE sinistre_id = $1 ORDER BY depose_le`,
        [requete.params.id],
      );
      return { sinistre: rows[0], pieces };
    });
  });

  app.post<{
    Body: {
      contratId: string; vehiculeId?: string; survenuLe: string; nature: string; dommagesCorporels?: boolean;
      lieu?: string; circonstances: string;
    };
  }>(
    "/portail/sinistres",
    {
      preHandler: garde,
      config,
      schema: {
        body: {
          type: "object",
          required: ["contratId", "survenuLe", "nature", "circonstances"],
          additionalProperties: false,
          properties: {
            contratId: { type: "string", format: "uuid" },
            vehiculeId: { type: "string", format: "uuid" },
            survenuLe: date,
            nature: { type: "string", enum: [...NATURES_SINISTRE] },
            dommagesCorporels: { type: "boolean" },
            lieu: texteCourt(200, 0),
            circonstances: texteCourt(4000, 10),
          },
        },
      },
    },
    async (requete, reponse) => {
      const moi = gestionnaireDe(requete);
      const d = requete.body;
      const id = await transactionPortail(pool, moi.gestionnaireId, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          "SELECT portail.declarer_sinistre($1, $2, $3, $4, $5, $6, $7) AS id",
          [d.contratId, d.vehiculeId ?? null, d.survenuLe, d.nature, d.dommagesCorporels ?? null, d.lieu ?? null, d.circonstances],
        );
        return rows[0]!.id;
      });
      requete.log.info({ sinistre: id }, "sinistre déclaré depuis le portail");
      return reponse.status(201).send({ sinistre: { id } });
    },
  );

  app.post<{ Params: { id: string }; Body: { nom: string; type: (typeof TYPES_PIECE)[number]; fichier: string } }>(
    "/portail/sinistres/:id/pieces",
    {
      preHandler: garde,
      config,
      bodyLimit: LONGUEUR_BASE64_MAX + 4096,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["nom", "type", "fichier"],
          additionalProperties: false,
          properties: {
            nom: texteCourt(200),
            type: { type: "string", enum: [...TYPES_PIECE] },
            fichier: texteCourt(LONGUEUR_BASE64_MAX, 4),
          },
        },
      },
    },
    async (requete, reponse) => {
      const moi = gestionnaireDe(requete);
      const piece = verifierPiece(requete.body.type, requete.body.fichier);
      if (!piece.ok) throw new ErreurApi(422, "piece_invalide", MESSAGES_PIECE_SINISTRE[piece.raison]);

      // Analyse avant tout enregistrement : un fichier infecté n'entre jamais dans la base
      let etat: "saine" | "a_analyser" = "a_analyser";
      if (antivirus.configure) {
        const verdict = await antivirus.analyser(piece.contenu);
        if (verdict.etat === "infectee") {
          requete.log.warn({ signature: verdict.signature }, "pièce de sinistre infectée refusée au dépôt");
          throw new ErreurApi(422, "fichier_infecte", "Ce fichier contient un virus : il a été refusé.");
        }
        if (verdict.etat === "indisponible") {
          throw new ErreurApi(503, "antivirus_indisponible", "Envoi des documents momentanément impossible : réessayez dans quelques minutes.");
        }
        etat = "saine";
      }

      const id = randomUUID();
      const nom = nomAffiche(requete.body.nom);
      const { contenuChiffre, empreinte } = chiffrerPieceSinistre(cleChiffrement, id, piece.contenu);
      await transactionPortail(pool, moi.gestionnaireId, (client) =>
        client.query("SELECT portail.joindre_piece_sinistre($1, $2, $3, $4, $5, $6, $7, $8)",
          [id, requete.params.id, nom, piece.type, piece.contenu.length, contenuChiffre, empreinte, etat]));
      return reponse.status(201).send({ piece: { id, nom, type: piece.type, taille: piece.contenu.length } });
    },
  );
}
