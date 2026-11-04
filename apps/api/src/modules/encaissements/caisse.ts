// Caisse de chaque personne qui encaisse : mouvements depuis la dernière clôture, clôture avec billetage,
// visa d'un gérant. Les totaux attendus sont calculés par la base, jamais repris du navigateur.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { formaterMontant } from "../../commun/formats.js";
import { parametreId, texteCourt } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { totauxParMode, type Mode } from "./routes.js";

/** Coupures en circulation (BCEAO) ; billets et pièces de 500 F se comptent ensemble. */
export const COUPURES = [10000, 5000, 2000, 1000, 500, 250, 200, 100, 50, 25, 10, 5, 1] as const;

export function totalBilletage(billetage: Record<string, number>): number {
  return Object.entries(billetage).reduce((total, [coupure, quantite]) => total + Number(coupure) * quantite, 0);
}

const COLONNES_CLOTURE = `cl.id, cl.numero, cl.caissier_id AS "caissierId", u.nom AS "caissier", cl.debut, cl.fin,
  cl.nombre_encaissements AS "nombreEncaissements", cl.especes_attendues AS "especesAttendues",
  cl.total_cheques AS "totalCheques", cl.total_mobile_money AS "totalMobileMoney", cl.total_virements AS "totalVirements",
  cl.especes_comptees AS "especesComptees", cl.billetage, cl.ecart, cl.commentaire,
  cl.visee_le AS "viseeLe", v.nom AS "viseePar"`;
const JOINTURES_CLOTURE = `FROM app.clotures_caisse cl
  JOIN app.utilisateurs u ON u.id = cl.caissier_id
  LEFT JOIN app.utilisateurs v ON v.id = cl.visee_par`;

export async function routesCaisse(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;
  const quiEncaisse = gardes.roles("gerant", "caissier");

  // Ma caisse : ce qui a été encaissé depuis ma dernière clôture (contre-passations de mes reçus comprises)
  app.get("/caisse", { preHandler: quiEncaisse }, async (requete) => {
    const moi = utilisateurDe(requete).id;
    return transactionUtilisateur(pool, moi, async (client) => {
      const derniere = await client.query(
        `SELECT ${COLONNES_CLOTURE} ${JOINTURES_CLOTURE} WHERE cl.caissier_id = $1 ORDER BY cl.fin DESC LIMIT 1`,
        [moi],
      );
      const derniereCloture = derniere.rows[0] ?? null;
      const { rows } = await client.query<{ montant: number; mode: Mode }>(
        `SELECT m.encaissement_id AS id, m.numero_recu AS "numeroRecu", m.montant, m.mode, m.reference_externe AS "reference",
                m.encaisse_le AS "encaisseLe", m.annule_encaissement_id AS "annuleEncaissementId",
                c.nom AS "clientNom", k.numero_police AS "numeroPolice"
         FROM app.v_mouvements_caisse m
         JOIN app.contrats k ON k.id = m.contrat_id
         JOIN app.clients c ON c.id = k.client_id
         WHERE m.caissier_id = $1 AND ($2::timestamptz IS NULL OR m.encaisse_le > $2::timestamptz)
         ORDER BY m.numero_recu`,
        [moi, derniereCloture?.fin ?? null],
      );
      return { depuis: derniereCloture?.fin ?? null, mouvements: rows, totaux: totauxParMode(rows), derniereCloture };
    });
  });

  app.post<{ Body: { especesComptees: number; billetage?: Record<string, number>; commentaire?: string } }>(
    "/caisse/clotures",
    {
      preHandler: quiEncaisse,
      schema: {
        body: {
          type: "object",
          required: ["especesComptees"],
          additionalProperties: false,
          properties: {
            especesComptees: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
            billetage: {
              type: "object",
              additionalProperties: false,
              properties: Object.fromEntries(COUPURES.map((c) => [String(c), { type: "integer", minimum: 0, maximum: 1_000_000 }])),
            },
            commentaire: texteCourt(1000),
          },
        },
      },
    },
    async (requete, reponse) => {
      const { especesComptees, billetage } = requete.body;
      const commentaire = requete.body.commentaire?.trim() || null;
      if (billetage && totalBilletage(billetage) !== especesComptees) {
        throw new ErreurApi(
          422, "billetage_incoherent",
          `Le billetage fait ${formaterMontant(totalBilletage(billetage))}, pas ${formaterMontant(especesComptees)}.`,
        );
      }
      const cloture = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO app.clotures_caisse (especes_comptees, billetage, commentaire) VALUES ($1, $2, $3) RETURNING id`,
          [especesComptees, billetage ?? null, commentaire],
        );
        const lue = await client.query(`SELECT ${COLONNES_CLOTURE} ${JOINTURES_CLOTURE} WHERE cl.id = $1`, [rows[0]!.id]);
        return lue.rows[0];
      });
      return reponse.status(201).send({ cloture });
    },
  );

  // Historique : chacun voit ses clôtures, le gérant et l'auditeur toutes (droits appliqués par la base)
  app.get("/caisse/clotures", { preHandler: gardes.roles("gerant", "caissier", "auditeur") }, async (requete) => {
    const clotures = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
      const { rows } = await client.query(`SELECT ${COLONNES_CLOTURE} ${JOINTURES_CLOTURE} ORDER BY cl.fin DESC LIMIT 100`);
      return rows;
    });
    return { clotures };
  });

  app.post<{ Params: { id: string } }>(
    "/caisse/clotures/:id/visa",
    { preHandler: gardes.roles("gerant"), schema: { params: parametreId } },
    async (requete) => {
      const moi = utilisateurDe(requete).id;
      const cloture = await transactionUtilisateur(pool, moi, async (client) => {
        const existante = await client.query<{ caissierId: string; viseeLe: string | null }>(
          `SELECT caissier_id AS "caissierId", visee_le AS "viseeLe" FROM app.clotures_caisse WHERE id = $1`,
          [requete.params.id],
        );
        const ligne = existante.rows[0];
        if (!ligne) throw erreurs.introuvable();
        if (ligne.caissierId === moi) {
          throw new ErreurApi(403, "quatre_yeux", "Principe des quatre yeux : un autre gérant doit viser votre clôture de caisse.");
        }
        if (ligne.viseeLe) throw new ErreurApi(409, "deja_visee", "Cette clôture est déjà visée.");
        await client.query("UPDATE app.clotures_caisse SET visee_le = now() WHERE id = $1", [requete.params.id]);
        const lue = await client.query(`SELECT ${COLONNES_CLOTURE} ${JOINTURES_CLOTURE} WHERE cl.id = $1`, [requete.params.id]);
        return lue.rows[0];
      });
      return { cloture };
    },
  );
}
