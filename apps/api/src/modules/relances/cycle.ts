// Cycle des relances, lancé toutes les 15 minutes par l'API (ou à la demande du gérant) :
//   1. planifier ce qui est dû aujourd'hui, pour les clients qui ont accepté un canal disponible ;
//   2. aux heures d'envoi seulement, envoyer par lots et enregistrer chaque résultat.
// Il travaille sans utilisateur connecté, par les seules fonctions que la base lui ouvre
// (database/migrations/0006_relances_consentements.sql). Un verrou de la base garantit qu'un seul
// cycle tourne à la fois, même si plusieurs instances de l'API sont démarrées.

import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionSysteme } from "../../base-de-donnees/connexion.js";
import type { ResultatEnvoi } from "../../integrations/envoi.js";
import type { Canal, Messagerie } from "./messagerie.js";
import { ErreurRedaction, type ParametresRelance, type TypeRelance } from "./modeles.js";

export interface OptionsCycle {
  /** Heures d'envoi, heure d'Abidjan (UTC, sans heure d'été) : début inclus, fin exclue. */
  heuresEnvoi: { debut: number; fin: number };
  maintenant?: () => Date;
  tailleLot?: number;
  lotsMax?: number;
}

export interface BilanCycle {
  /** Un autre cycle tournait déjà : rien n'a été fait. */
  dejaEnCours: boolean;
  planifiees: number;
  /** Hors des heures d'envoi : planifiées, elles partiront à la reprise. */
  horsHeures: boolean;
  envoyees: number;
  erreurs: number;
}

const VERROU = "dbs:relances";

export function dansLesHeuresDEnvoi(instant: Date, heures: { debut: number; fin: number }): boolean {
  const heure = instant.getUTCHours();
  return heure >= heures.debut && heure < heures.fin;
}

interface RelanceReservee {
  id: string;
  type: TypeRelance;
  canal: Canal;
  destinataire: string;
  parametres: ParametresRelance;
}

async function envoyerUne(messagerie: Messagerie, relance: RelanceReservee): Promise<ResultatEnvoi> {
  try {
    return await messagerie.envoyer(relance);
  } catch (erreur) {
    if (erreur instanceof ErreurRedaction) return { ok: false, erreur: erreur.message, definitif: true };
    return { ok: false, erreur: "Erreur inattendue pendant l'envoi", definitif: false };
  }
}

export async function executerCycle(pool: Pool, messagerie: Messagerie, options: OptionsCycle): Promise<BilanCycle> {
  const bilan: BilanCycle = { dejaEnCours: false, planifiees: 0, horsHeures: false, envoyees: 0, erreurs: 0 };
  const canaux = messagerie.canaux;
  if (canaux.length === 0) return bilan;

  const verrou = await pool.connect();
  // Une connexion qui n'a pas pu rendre le verrou est fermée, pas remise dans le pool : sinon elle le garderait
  let connexionAFermer = false;
  try {
    const { rows } = await verrou.query<{ obtenu: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS obtenu", [VERROU]);
    if (!rows[0]?.obtenu) return { ...bilan, dejaEnCours: true };
    try {
      bilan.planifiees = await transactionSysteme(pool, async (client) => {
        const resultat = await client.query<{ nombre: number }>(
          "SELECT app.planifier_relances($1::app.canal_relance[]) AS nombre", [canaux],
        );
        return resultat.rows[0]?.nombre ?? 0;
      });

      if (!dansLesHeuresDEnvoi((options.maintenant ?? (() => new Date()))(), options.heuresEnvoi)) {
        bilan.horsHeures = true;
        return bilan;
      }

      for (let lot = 0; lot < (options.lotsMax ?? 10); lot += 1) {
        const relances = await transactionSysteme(pool, async (client) => {
          const resultat = await client.query<RelanceReservee>(
            `SELECT id, type, canal, destinataire, parametres
             FROM app.prendre_relances_a_envoyer($1::app.canal_relance[], $2)`,
            [canaux, options.tailleLot ?? 20],
          );
          return resultat.rows;
        });
        if (relances.length === 0) break;

        for (const relance of relances) {
          const resultat = await envoyerUne(messagerie, relance);
          await transactionSysteme(pool, (client) =>
            client.query("SELECT app.enregistrer_envoi($1, $2, $3, $4)", [
              relance.id,
              resultat.ok ? resultat.identifiant : null,
              resultat.ok ? null : resultat.erreur,
              resultat.ok ? false : resultat.definitif,
            ]),
          );
          if (resultat.ok) bilan.envoyees += 1;
          else bilan.erreurs += 1;
        }
      }
      return bilan;
    } finally {
      try {
        await verrou.query("SELECT pg_advisory_unlock(hashtext($1))", [VERROU]);
      } catch {
        connexionAFermer = true;
      }
    }
  } catch (erreur) {
    connexionAFermer = true;
    throw erreur;
  } finally {
    verrou.release(connexionAFermer);
  }
}

const INTERVALLE_MS = 15 * 60_000;

/** Lance les cycles toutes les 15 minutes (premier cycle peu après le démarrage). Renvoie la fonction d'arrêt. */
export function demarrerRelancesPeriodiques(
  pool: Pool,
  messagerie: Messagerie,
  options: OptionsCycle,
  journal: FastifyBaseLogger,
): () => void {
  if (messagerie.canaux.length === 0) {
    journal.warn("relances actives, mais aucun canal configuré (WhatsApp) : rien ne sera envoyé");
  }
  let enCours = false;
  const tourner = async () => {
    if (enCours) return;
    enCours = true;
    try {
      const bilan = await executerCycle(pool, messagerie, options);
      // Des nombres seulement : jamais de nom ni de numéro dans les journaux
      if (bilan.planifiees || bilan.envoyees || bilan.erreurs) journal.info({ relances: bilan }, "cycle de relances");
    } catch (erreur) {
      journal.error({ err: erreur }, "cycle de relances en erreur");
    } finally {
      enCours = false;
    }
  };
  const premier = setTimeout(() => void tourner(), 10_000);
  const minuterie = setInterval(() => void tourner(), INTERVALLE_MS);
  premier.unref();
  minuterie.unref();
  return () => {
    clearTimeout(premier);
    clearInterval(minuterie);
  };
}
