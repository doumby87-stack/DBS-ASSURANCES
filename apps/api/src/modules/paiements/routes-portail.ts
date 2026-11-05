// Paiement d'une prime depuis l'espace client (tâche 9), par Mobile Money, chez le prestataire de l'agence :
//   1. le portail demande un paiement : la base vérifie le contrat, le montant et les limites, et donne une
//      référence unique (portail.preparer_paiement) ;
//   2. l'API transmet la demande au prestataire, qui renvoie l'adresse de sa page de paiement (Wave, Orange
//      Money, MTN MoMo, Moov Money) ; le client y est envoyé ;
//   3. au retour (et à chaque notification du prestataire), l'API demande le résultat au prestataire lui-même
//      et le fait enregistrer par la base : encaissement, contrat en vigueur s'il est soldé.
// Aucune donnée de carte ni code secret Mobile Money ne passe par l'agence : tout se saisit chez le prestataire.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionPortail } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { parametreId } from "../../commun/schemas.js";
import { estSimulation, type PrestatairePaiement } from "../../integrations/paiement/prestataire.js";
import { gardePortail, gestionnaireDe } from "../portail/connexion.js";
import { creerLimiteVerifications, type StatutPaiementEnLigne, verifierEtConclure } from "./conclusion.js";

export const MOYENS_MOBILE_MONEY = ["WAVE", "ORANGE_MONEY", "MTN_MOMO", "MOOV_MONEY"] as const;

const COLONNES = `p.id, p.reference, p.montant, p.statut, p.moyen, p.cree_le AS "creeLe", p.modifie_le AS "modifieLe",
  p.contrat_id AS "contratId", k.numero_police AS "numeroPolice"`;

interface PaiementPortail {
  id: string;
  reference: string;
  montant: number;
  statut: StatutPaiementEnLigne;
  [cle: string]: unknown;
}

export async function routesPaiementsPortail(
  app: FastifyInstance,
  options: { pool: Pool; prestataire: PrestatairePaiement; originePortail: string; montantMax: number },
): Promise<void> {
  const { pool, prestataire, originePortail, montantMax } = options;
  const garde = gardePortail(pool);
  const config = { appeleeParLePortail: true };
  const peutVerifier = creerLimiteVerifications();

  const lire = (gestionnaireId: string, id: string) =>
    transactionPortail(pool, gestionnaireId, async (client) => {
      const { rows } = await client.query<PaiementPortail>(
        `SELECT ${COLONNES}, s.reste_a_payer AS "resteAPayer", s.statut AS "statutContrat"
         FROM app.paiements_en_ligne p
         JOIN app.contrats k ON k.id = p.contrat_id
         JOIN app.v_soldes_contrats s ON s.contrat_id = k.id
         WHERE p.id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });

  /** Adresse de la page de paiement : en https, ou celle du portail lui-même (simulation). */
  const adresseAcceptable = (adresse: string) => {
    try {
      const url = new URL(adresse);
      return url.protocol === "https:" || url.origin === originePortail;
    } catch {
      return false;
    }
  };

  app.post<{ Body: { contratId: string; montant: number } }>(
    "/portail/paiements",
    {
      preHandler: garde,
      config,
      schema: {
        body: {
          type: "object",
          required: ["contratId", "montant"],
          additionalProperties: false,
          properties: {
            contratId: { type: "string", format: "uuid" },
            montant: { type: "integer", minimum: 100, maximum: montantMax },
          },
        },
      },
    },
    async (requete, reponse) => {
      const moi = gestionnaireDe(requete);
      const paiement = await transactionPortail(pool, moi.gestionnaireId, async (client) => {
        // La fonction seule dans sa requête : elle s'exécute toujours (et refuse un contrat d'un autre client)
        const { rows } = await client.query<{ id: string; reference: string }>(
          "SELECT id, reference FROM portail.preparer_paiement($1, $2, $3)",
          [requete.body.contratId, requete.body.montant, prestataire.nom],
        );
        const police = await client.query<{ numeroPolice: string }>(
          `SELECT numero_police AS "numeroPolice" FROM app.contrats WHERE id = $1`, [requete.body.contratId]);
        return { ...rows[0]!, numeroPolice: police.rows[0]!.numeroPolice };
      });

      // Appel au prestataire hors transaction : la référence est déjà enregistrée, un échec ne la perd pas
      let lien: { url: string | null; motif: string | null };
      try {
        const resultat = await prestataire.initier({
          reference: paiement.reference,
          montant: requete.body.montant,
          description: `Prime d'assurance, contrat ${paiement.numeroPolice}`,
          telephone: moi.telephone,
          nomClient: moi.entreprise,
          urlRetour: `${originePortail}/paiements/${paiement.id}`,
          urlNotification: `${originePortail}/api/paiements/notifications/${prestataire.nom}`,
        });
        if (resultat.ok && adresseAcceptable(resultat.urlPaiement)) lien = { url: resultat.urlPaiement, motif: null };
        else lien = { url: null, motif: resultat.ok ? "Adresse de paiement refusée" : resultat.erreur };
      } catch (erreur) {
        requete.log.error({ err: erreur }, "prestataire de paiement injoignable");
        lien = { url: null, motif: "Prestataire injoignable" };
      }
      await transactionPortail(pool, moi.gestionnaireId, (client) =>
        client.query("SELECT portail.lier_paiement($1, $2, $3)", [paiement.id, lien.url, lien.motif]));
      if (!lien.url) {
        requete.log.warn({ motif: lien.motif, reference: paiement.reference }, "paiement en ligne non ouvert");
        throw new ErreurApi(502, "paiement_indisponible", "Le paiement en ligne est momentanément indisponible : réessayez plus tard, ou payez à l'agence.");
      }
      return reponse.status(201).send({ paiement: { id: paiement.id, reference: paiement.reference, urlPaiement: lien.url } });
    },
  );

  // Page de retour : le résultat est demandé au prestataire tant que le paiement est en attente
  app.get<{ Params: { id: string } }>("/portail/paiements/:id", { preHandler: garde, schema: { params: parametreId } }, async (requete) => {
    const moi = gestionnaireDe(requete);
    const paiement = await lire(moi.gestionnaireId, requete.params.id);
    if (!paiement) throw erreurs.introuvable();
    if ((paiement.statut === "initie" || paiement.statut === "en_attente") && peutVerifier(paiement.id)) {
      try {
        if (await verifierEtConclure(pool, prestataire, paiement.reference)) {
          const conclu = await lire(moi.gestionnaireId, paiement.id);
          return { paiement: conclu, simulation: false };
        }
      } catch (erreur) {
        requete.log.warn({ err: erreur, reference: paiement.reference }, "vérification du paiement en ligne impossible");
      }
    }
    return { paiement, simulation: estSimulation(prestataire) && paiement.statut === "en_attente" };
  });

  app.get("/portail/paiements", { preHandler: garde }, async (requete) => {
    const moi = gestionnaireDe(requete);
    const { rows } = await transactionPortail(pool, moi.gestionnaireId, (client) =>
      client.query(
        `SELECT ${COLONNES} FROM app.paiements_en_ligne p JOIN app.contrats k ON k.id = p.contrat_id
         WHERE k.client_id = $1 ORDER BY p.cree_le DESC LIMIT 50`,
        [moi.clientId],
      ),
    );
    return { paiements: rows };
  });

  // Simulation seulement (jamais en production) : la « page du prestataire » est celle du portail
  if (estSimulation(prestataire)) {
    app.post<{ Params: { id: string }; Body: { accepte: boolean; moyen?: (typeof MOYENS_MOBILE_MONEY)[number] } }>(
      "/portail/paiements/:id/simulation",
      {
        preHandler: garde,
        config,
        schema: {
          params: parametreId,
          body: {
            type: "object",
            required: ["accepte"],
            additionalProperties: false,
            properties: { accepte: { type: "boolean" }, moyen: { type: "string", enum: [...MOYENS_MOBILE_MONEY] } },
          },
        },
      },
      async (requete) => {
        const moi = gestionnaireDe(requete);
        const paiement = await lire(moi.gestionnaireId, requete.params.id);
        if (!paiement) throw erreurs.introuvable();
        if (paiement.statut !== "en_attente") throw new ErreurApi(422, "regle_metier", "Ce paiement est déjà terminé.");
        prestataire.simuler(paiement.reference, requete.body.accepte, paiement.montant, requete.body.moyen);
        await verifierEtConclure(pool, prestataire, paiement.reference);
        return { paiement: await lire(moi.gestionnaireId, paiement.id), simulation: false };
      },
    );
  }
}
