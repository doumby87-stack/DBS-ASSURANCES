// Sinistres, côté agence : déclaration d'un sinistre sur un contrat (et, pour une flotte, sur le véhicule
// concerné, couvert ce jour-là : la base le vérifie), puis suivi de son statut et de la référence de la
// compagnie. Chaque changement de statut est annoncé au client qui l'a accepté (relances, tâche 6) et
// alimente l'historique des sinistres du véhicule, visible sur le portail (tâche 10).
// Liste des sinistres à traiter, dont ceux déclarés par les clients depuis leur espace (tâche 9), avec leurs
// photos et documents.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { date, parametreId, texteCourt } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { consignerEvenement } from "../../securite/limitation.js";
import { dechiffrerPieceSinistre, nomDeTelechargement } from "./pieces.js";

export const NATURES_SINISTRE = ["materiel", "corporel", "vol", "incendie", "bris_de_glace", "degat_des_eaux", "autre"] as const;
export const STATUTS_SINISTRE = [
  "declare", "transmis_compagnie", "expertise", "offre_recue", "regle", "refuse", "classe_sans_suite",
] as const;

const COLONNES = `s.id, s.contrat_id AS "contratId", s.vehicule_id AS "vehiculeId", s.survenu_le AS "survenuLe",
  s.declare_le AS "declareLe", s.nature, s.dommages_corporels AS "dommagesCorporels", s.description, s.statut,
  s.reference_compagnie AS "referenceCompagnie"`;

const STATUTS_CLOS = ["regle", "refuse", "classe_sans_suite"];

export async function routesSinistres(
  app: FastifyInstance,
  options: { pool: Pool; gardes: Gardes; cleChiffrement: Buffer },
): Promise<void> {
  const { pool, gardes, cleChiffrement } = options;
  const gestionnaires = gardes.roles("gerant", "charge_clientele");
  const lecteurs = gardes.roles("gerant", "charge_clientele", "commercial", "auditeur");

  // Sinistres en cours (par défaut) ou tous, les déclarations à traiter en premier
  app.get<{ Querystring: { tous?: "oui" } }>(
    "/sinistres",
    {
      preHandler: lecteurs,
      schema: { querystring: { type: "object", additionalProperties: false, properties: { tous: { type: "string", enum: ["oui"] } } } },
    },
    async (requete) => {
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `SELECT ${COLONNES}, s.lieu, s.declare_par_gestionnaire IS NOT NULL AS "declareEnLigne",
                  k.numero_police AS "numeroPolice", c.id AS "clientId", c.nom AS client, v.immatriculation,
                  (SELECT count(*)::int FROM app.pieces_sinistres p WHERE p.sinistre_id = s.id) AS pieces
           FROM app.sinistres s
           JOIN app.contrats k ON k.id = s.contrat_id
           JOIN app.clients c ON c.id = k.client_id
           LEFT JOIN app.vehicules v ON v.id = s.vehicule_id
           WHERE $1 OR s.statut::text <> ALL ($2)
           ORDER BY (s.statut = 'declare') DESC, s.declare_le DESC, s.survenu_le DESC
           LIMIT 300`,
          [requete.query.tous === "oui", STATUTS_CLOS],
        ),
      );
      return { sinistres: rows };
    },
  );

  app.get<{ Params: { id: string } }>("/sinistres/:id", { preHandler: lecteurs, schema: { params: parametreId } }, async (requete) => {
    return transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
      const { rows } = await client.query(
        `SELECT ${COLONNES}, s.lieu, s.circonstances, s.declare_par_gestionnaire IS NOT NULL AS "declareEnLigne",
                g.nom AS "declarePar", g.telephone AS "telephoneDeclarant",
                k.numero_police AS "numeroPolice", c.id AS "clientId", c.nom AS client, v.immatriculation
         FROM app.sinistres s
         JOIN app.contrats k ON k.id = s.contrat_id
         JOIN app.clients c ON c.id = k.client_id
         LEFT JOIN app.vehicules v ON v.id = s.vehicule_id
         LEFT JOIN app.gestionnaires_portail g ON g.id = s.declare_par_gestionnaire
         WHERE s.id = $1`,
        [requete.params.id],
      );
      if (!rows[0]) throw erreurs.introuvable();
      const { rows: pieces } = await client.query(
        `SELECT p.id, p.nom_fichier AS nom, p.type_contenu AS type, p.taille, p.etat_analyse AS "etatAnalyse",
                p.depose_le AS "deposeLe", coalesce(g.nom, u.nom) AS "deposePar"
         FROM app.pieces_sinistres p
         LEFT JOIN app.gestionnaires_portail g ON g.id = p.depose_par_gestionnaire
         LEFT JOIN app.utilisateurs u ON u.id = p.depose_par
         WHERE p.sinistre_id = $1 ORDER BY p.depose_le`,
        [requete.params.id],
      );
      return { sinistre: rows[0], pieces };
    });
  });

  // Une photo ou un document joint : déchiffré, contrôlé, consigné
  app.get<{ Params: { id: string; pieceId: string } }>(
    "/sinistres/:id/pieces/:pieceId",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial"),
      schema: {
        params: {
          type: "object",
          required: ["id", "pieceId"],
          properties: { id: { type: "string", format: "uuid" }, pieceId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (requete, reponse) => {
      const moi = utilisateurDe(requete);
      const fichier = await transactionUtilisateur(pool, moi.id, async (client) => {
        // Jointure sur le sinistre : la pièce n'est lue que si son sinistre est visible pour cette personne
        const { rows } = await client.query<{
          nom: string; type: string; contenu_chiffre: Buffer; empreinte: Buffer; etat_analyse: string;
        }>(
          `SELECT p.nom_fichier AS nom, p.type_contenu AS type, p.contenu_chiffre, p.empreinte, p.etat_analyse
           FROM app.pieces_sinistres p JOIN app.sinistres s ON s.id = p.sinistre_id JOIN app.contrats k ON k.id = s.contrat_id
           WHERE p.id = $1 AND p.sinistre_id = $2`,
          [requete.params.pieceId, requete.params.id],
        );
        const piece = rows[0];
        if (!piece) throw erreurs.introuvable();
        if (piece.etat_analyse !== "saine") throw new ErreurApi(503, "analyse_en_attente", "Document pas encore analysé par l'antivirus.");
        await consignerEvenement(client, "piece_telechargee", { utilisateurId: moi.id, ip: requete.ip, objet: `Pièce de sinistre ${piece.nom}` });
        return {
          contenu: dechiffrerPieceSinistre(cleChiffrement, requete.params.pieceId, piece.contenu_chiffre, piece.empreinte),
          type: piece.type,
          nom: nomDeTelechargement(piece.nom, piece.type),
        };
      });
      return reponse
        .type(fichier.type)
        .header("Content-Disposition", `attachment; filename="${fichier.nom}"`)
        .send(fichier.contenu);
    },
  );

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
