// Relances : suivi dans le back-office, lancement à la demande, annulation ; consentements des clients.
// Les relances elles-mêmes ne sont créées que par le planificateur (cycle.ts), jamais par une requête.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { parametreId, texteCourt } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { exigerClientVisible } from "../clients/visibilite.js";
import { executerCycle, type OptionsCycle } from "./cycle.js";
import type { Canal, Messagerie } from "./messagerie.js";
import { texteRelance, type ParametresRelance, type TypeRelance } from "./modeles.js";

const STATUTS = ["a_envoyer", "envoyee", "remise", "lue", "echec", "annulee"] as const;
const CANAUX = ["whatsapp", "sms"] as const;

export async function routesRelances(
  app: FastifyInstance,
  options: { pool: Pool; gardes: Gardes; messagerie: Messagerie; cycle: OptionsCycle },
): Promise<void> {
  const { pool, gardes, messagerie } = options;

  app.get<{ Querystring: { statut?: (typeof STATUTS)[number] } }>(
    "/relances",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial", "auditeur"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { statut: { type: "string", enum: STATUTS } },
        },
      },
    },
    async (requete) => {
      const canaux: Canal[] = messagerie.canaux;
      const donnees = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const resume = await client.query<{ statut: string; nombre: number }>(
          `SELECT statut, count(*)::integer AS nombre FROM app.relances
           WHERE planifiee_le > now() - interval '30 days' GROUP BY statut`,
        );
        const relances = await client.query<{ type: TypeRelance; parametres: ParametresRelance }>(
          `SELECT r.id, r.type, r.canal, r.statut, r.client_id AS "clientId", c.nom AS "clientNom", r.destinataire,
                  r.parametres, r.motif, r.tentatives, r.planifiee_le AS "planifieeLe", r.envoyee_le AS "envoyeeLe",
                  r.remise_le AS "remiseLe", r.lue_le AS "lueLe", r.annulee_le AS "annuleeLe", u.nom AS "annuleePar"
           FROM app.relances r
           JOIN app.clients c ON c.id = r.client_id
           LEFT JOIN app.utilisateurs u ON u.id = r.annulee_par
           WHERE ($1::app.statut_relance IS NULL OR r.statut = $1)
           ORDER BY r.planifiee_le DESC
           LIMIT 200`,
          [requete.query.statut ?? null],
        );
        // Dues aujourd'hui mais sans canal accepté par le client : à faire à la main (ou recueillir son accord)
        const aLaMain = await client.query<{ type: TypeRelance; parametres: ParametresRelance }>(
          `SELECT d.cle, d.type, d.client_id AS "clientId", d.parametres ->> 'nom' AS "clientNom",
                  d.telephone, d.parametres
           FROM app.v_relances_dues d
           WHERE NOT EXISTS (SELECT 1 FROM app.v_consentements v
                             WHERE v.client_id = d.client_id AND v.accorde AND v.canal = ANY ($1::app.canal_relance[]))
           ORDER BY d.type, d.parametres ->> 'nom'
           LIMIT 200`,
          [canaux],
        );
        return { resume: resume.rows, relances: relances.rows, aLaMain: aLaMain.rows };
      });

      return {
        configuration: {
          canaux,
          simulation: messagerie.simulation,
          heuresEnvoi: options.cycle.heuresEnvoi,
        },
        resume: Object.fromEntries(STATUTS.map((s) => [s, donnees.resume.find((r) => r.statut === s)?.nombre ?? 0])),
        relances: donnees.relances.map((r) => ({ ...r, texte: texteRelance(r.type, r.parametres) })),
        aFaireALaMain: donnees.aLaMain.map((r) => ({ ...r, texte: texteRelance(r.type, r.parametres) })),
      };
    },
  );

  // Lancer un cycle sans attendre les 15 minutes (après avoir recueilli des accords, par exemple)
  app.post("/relances/cycle", { preHandler: gardes.roles("gerant") }, async () => {
    if (messagerie.canaux.length === 0) {
      throw new ErreurApi(
        422, "aucun_canal",
        "Aucun canal d'envoi n'est configuré : il faut d'abord brancher WhatsApp Business (voir la documentation des relances).",
      );
    }
    return { bilan: await executerCycle(pool, messagerie, options.cycle) };
  });

  app.post<{ Params: { id: string } }>(
    "/relances/:id/annulation",
    { preHandler: gardes.roles("gerant", "charge_clientele"), schema: { params: parametreId } },
    async (requete) => {
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `UPDATE app.relances SET statut = 'annulee' WHERE id = $1
           RETURNING id, statut, annulee_le AS "annuleeLe"`,
          [requete.params.id],
        ),
      );
      if (!rows[0]) throw erreurs.introuvable();
      return { relance: rows[0] };
    },
  );

  // Accord ou refus du client, avec la façon dont il a été exprimé (preuve)
  app.post<{ Params: { id: string }; Body: { canal: Canal; accorde: boolean; preuve: string } }>(
    "/clients/:id/consentements",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["canal", "accorde", "preuve"],
          additionalProperties: false,
          properties: {
            canal: { type: "string", enum: CANAUX },
            accorde: { type: "boolean" },
            preuve: texteCourt(300, 3),
          },
        },
      },
    },
    async (requete, reponse) => {
      const { canal, accorde, preuve } = requete.body;
      if (preuve.trim().length < 3) {
        throw new ErreurApi(422, "preuve_obligatoire", "Indiquez comment le client a exprimé son choix (au moins 3 caractères).");
      }
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        return client.query(
          `WITH nouveau AS (
             INSERT INTO app.consentements (client_id, canal, accorde, preuve) VALUES ($1, $2, $3, btrim($4))
             RETURNING canal, accorde, source, preuve, enregistre_le, enregistre_par
           )
           SELECT n.canal, n.accorde, n.source, n.preuve, n.enregistre_le AS "enregistreLe", u.nom AS "enregistrePar"
           FROM nouveau n LEFT JOIN app.utilisateurs u ON u.id = n.enregistre_par`,
          [requete.params.id, canal, accorde, preuve],
        );
      });
      return reponse.status(201).send({ consentement: rows[0] });
    },
  );
}
