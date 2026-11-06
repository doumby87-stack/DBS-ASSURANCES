// Agenda de l'agence (tâche 13, ADR 0014) : demandes de rendez-vous reçues par le site, rendez-vous à venir, à
// clôturer, et rendez-vous fixés au guichet ou au téléphone. Le gérant, le chargé de clientèle et le commercial
// le tiennent ; l'auditeur le consulte. Chaque étape passe par une fonction de la base, qui la date et la signe.
// Les heures sont celles d'Abidjan : l'API reçoit le jour et l'heure séparément, et la base les assemble.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi } from "../../commun/erreurs.js";
import { normaliserTelephone } from "../../commun/formats.js";
import { date, parametreId, texteCourt } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { MODES_RENDEZ_VOUS, MOTIFS_RENDEZ_VOUS } from "../demandes-site/outils-site.js";

const ACTIONS = ["confirmer", "honore", "manque", "annuler", "rattacher"] as const;
const heure = { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" } as const;
const duree = { type: "integer", minimum: 10, maximum: 480 } as const;

const COLONNES = `r.id, r.numero, r.origine, r.motif, r.mode, r.profil, r.nom, r.telephone, r.email, r.message,
  r.client_id AS "clientId", c.nom AS "nomClient", to_char(r.souhaite_le, 'YYYY-MM-DD') AS "souhaiteLe",
  r.creneau_souhaite AS "creneauSouhaite", r.debut, r.duree_minutes AS "dureeMinutes", r.avec, a.nom AS "nomAvec", r.statut,
  r.motif_annulation AS "motifAnnulation", r.accord_whatsapp IS NOT NULL AS "accordWhatsApp", r.cree_le AS "creeLe",
  r.clos_le AS "closLe"`;
const DEPUIS = `FROM app.rendez_vous r LEFT JOIN app.utilisateurs a ON a.id = r.avec LEFT JOIN app.clients c ON c.id = r.client_id`;

export async function routesRendezVous(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;
  const gestion = gardes.roles("gerant", "charge_clientele", "commercial");

  // L'agenda en une fois : demandes à confirmer, rendez-vous à venir, à clôturer, et clos depuis 30 jours
  app.get("/rendez-vous", { preHandler: gardes.roles("gerant", "charge_clientele", "commercial", "auditeur") }, async (requete) =>
    transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
      const lire = async (condition: string, ordre: string) =>
        (await client.query(`SELECT ${COLONNES} ${DEPUIS} WHERE ${condition} ORDER BY ${ordre} LIMIT 200`)).rows;
      const demandes = await lire("r.statut = 'demande'", "r.souhaite_le, r.creneau_souhaite, r.cree_le");
      const aVenir = await lire("r.statut = 'confirme' AND r.debut >= now()", "r.debut");
      const aCloturer = await lire("r.statut = 'confirme' AND r.debut < now()", "r.debut");
      const recents = await lire("r.statut IN ('honore', 'manque', 'annule') AND r.clos_le > now() - interval '30 days'", "r.clos_le DESC");
      // Qui peut recevoir un rendez-vous (pour le choix « avec qui »)
      const { rows: personnes } = await client.query(
        "SELECT id, nom FROM app.utilisateurs WHERE actif AND role NOT IN ('apporteur', 'auditeur') ORDER BY nom",
      );
      return { demandes, aVenir, aCloturer, recents, personnes };
    }),
  );

  // Rendez-vous fixé par l'agence, pour un client (fiche) ou un prospect (nom et téléphone)
  app.post<{
    Body: {
      motif: (typeof MOTIFS_RENDEZ_VOUS)[number]; mode: (typeof MODES_RENDEZ_VOUS)[number]; nom: string; telephone: string;
      email?: string; message?: string; clientId?: string; jour: string; heure: string; dureeMinutes: number; avec: string;
    };
  }>(
    "/rendez-vous",
    {
      preHandler: gestion,
      schema: {
        body: {
          type: "object",
          required: ["motif", "mode", "nom", "telephone", "jour", "heure", "dureeMinutes", "avec"],
          additionalProperties: false,
          properties: {
            motif: { type: "string", enum: MOTIFS_RENDEZ_VOUS },
            mode: { type: "string", enum: MODES_RENDEZ_VOUS },
            nom: texteCourt(160, 2),
            telephone: texteCourt(25, 8),
            email: texteCourt(254, 0),
            message: texteCourt(1000, 0),
            clientId: { type: "string", format: "uuid" },
            jour: date,
            heure,
            dureeMinutes: duree,
            avec: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (requete, reponse) => {
      const d = requete.body;
      const telephone = normaliserTelephone(d.telephone);
      if (!telephone) throw new ErreurApi(422, "telephone_invalide", "Numéro invalide : 10 chiffres, ou numéro étranger commençant par +.");
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query<{ id: string; numero: number }>(
          `SELECT id, numero FROM app.fixer_rendez_vous($1, $2, $3, $4, $5, $6, $7,
             ($8::date + $9::time) AT TIME ZONE 'Africa/Abidjan', $10, $11)`,
          [d.motif, d.mode, d.nom, telephone, d.email?.trim() || null, d.message ?? null, d.clientId ?? null, d.jour, d.heure,
           d.dureeMinutes, d.avec],
        ),
      );
      return reponse.status(201).send(rows[0]);
    },
  );

  // Traitement : confirmer ou déplacer, noter s'il a eu lieu, annuler, rattacher à une fiche client
  app.post<{
    Params: { id: string };
    Body: {
      action: (typeof ACTIONS)[number]; jour?: string; heure?: string; dureeMinutes?: number; avec?: string;
      mode?: (typeof MODES_RENDEZ_VOUS)[number]; motifAnnulation?: string; clientId?: string;
    };
  }>(
    "/rendez-vous/:id/traitement",
    {
      preHandler: gestion,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["action"],
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ACTIONS },
            jour: date,
            heure,
            dureeMinutes: duree,
            avec: { type: "string", format: "uuid" },
            mode: { type: "string", enum: MODES_RENDEZ_VOUS },
            motifAnnulation: texteCourt(300, 3),
            clientId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (requete) => {
      const d = requete.body;
      if (d.action === "confirmer" && (!d.jour || !d.heure || !d.dureeMinutes || !d.avec)) {
        throw new ErreurApi(422, "horaire_incomplet", "Indiquez le jour, l'heure, la durée et la personne de l'agence.");
      }
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query<{ statut: string }>(
          `SELECT app.traiter_rendez_vous($1, $2,
             CASE WHEN $3::date IS NULL THEN NULL ELSE ($3::date + $4::time) AT TIME ZONE 'Africa/Abidjan' END,
             $5, $6, $7, $8, $9) AS statut`,
          [requete.params.id, d.action, d.jour ?? null, d.heure ?? null, d.dureeMinutes ?? null, d.avec ?? null, d.mode ?? null,
           d.motifAnnulation ?? null, d.clientId ?? null],
        ),
      );
      return { statut: rows[0]?.statut };
    },
  );
}
