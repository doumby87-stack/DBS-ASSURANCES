// Paiements en ligne, côté prestataire et côté agence :
//   · notifications du prestataire : authentifiées par le prestataire (signature), elles ne font que déclencher
//     la vérification du résultat auprès de lui ;
//   · liste des paiements en ligne pour la caisse et le suivi, régularisation par le gérant d'un paiement reçu
//     mais non encaissé (montant différent, prime déjà soldée entre-temps).

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi } from "../../commun/erreurs.js";
import { parametreId, texteCourt } from "../../commun/schemas.js";
import type { PrestatairePaiement } from "../../integrations/paiement/prestataire.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { verifierEtConclure } from "./conclusion.js";

export const STATUTS_PAIEMENT_EN_LIGNE = ["initie", "en_attente", "accepte", "refuse", "abandonne", "a_regulariser"] as const;

/** Notifications du prestataire (enregistrées seulement si le paiement en ligne est configuré). */
export async function routesNotificationsPaiement(
  app: FastifyInstance,
  options: { pool: Pool; prestataire: PrestatairePaiement },
): Promise<void> {
  const { pool, prestataire } = options;

  app.post<{ Params: { prestataire: string } }>(
    "/paiements/notifications/:prestataire",
    {
      config: { authentifieeParSignature: true },
      schema: { params: { type: "object", required: ["prestataire"], properties: { prestataire: texteCourt(30) } } },
    },
    async (requete, reponse) => {
      if (requete.params.prestataire !== prestataire.nom) throw new ErreurApi(404, "introuvable", "Élément introuvable.");
      const notification = prestataire.lireNotification(requete.body, requete.headers);
      if (!notification) {
        requete.log.warn("notification de paiement non authentifiée, ignorée");
        throw new ErreurApi(401, "signature_invalide", "Notification refusée.");
      }
      try {
        const statut = await verifierEtConclure(pool, prestataire, notification.reference);
        requete.log.info({ reference: notification.reference, statut }, "notification de paiement traitée");
      } catch (erreur) {
        // Référence inconnue ou résultat illisible : le prestataire n'a pas à réessayer indéfiniment
        requete.log.warn({ err: erreur, reference: notification.reference }, "notification de paiement sans suite");
      }
      return reponse.status(200).send({ recu: true });
    },
  );
}

/** Suivi des paiements en ligne par l'agence. */
export async function routesPaiementsEnLigne(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;

  app.get<{ Querystring: { statut?: string } }>(
    "/paiements-en-ligne",
    {
      preHandler: gardes.roles("gerant", "caissier", "charge_clientele", "auditeur"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { statut: { type: "string", enum: [...STATUTS_PAIEMENT_EN_LIGNE] } },
        },
      },
    },
    async (requete) => {
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `SELECT p.id, p.reference, p.montant, p.statut, p.prestataire, p.moyen, p.reference_operateur AS "referenceOperateur",
                  p.motif, p.cree_le AS "creeLe", p.modifie_le AS "modifieLe", p.encaissement_id AS "encaissementId",
                  k.id AS "contratId", k.numero_police AS "numeroPolice", c.id AS "clientId", c.nom AS client,
                  g.nom AS "payePar"
           FROM app.paiements_en_ligne p
           JOIN app.contrats k ON k.id = p.contrat_id
           JOIN app.clients c ON c.id = k.client_id
           LEFT JOIN app.gestionnaires_portail g ON g.id = p.gestionnaire_id
           WHERE ($1::app.statut_paiement_en_ligne IS NULL OR p.statut = $1)
           ORDER BY (p.statut = 'a_regulariser') DESC, p.cree_le DESC
           LIMIT 200`,
          [requete.query.statut ?? null],
        ),
      );
      return { paiements: rows };
    },
  );

  app.post<{ Params: { id: string }; Body: { motif: string } }>(
    "/paiements-en-ligne/:id/regularisation",
    {
      preHandler: gardes.roles("gerant"),
      schema: {
        params: parametreId,
        body: { type: "object", required: ["motif"], additionalProperties: false, properties: { motif: texteCourt(300, 5) } },
      },
    },
    async (requete, reponse) => {
      await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query("SELECT app.regulariser_paiement_en_ligne($1, $2)", [requete.params.id, requete.body.motif]));
      return reponse.status(204).send();
    },
  );
}
