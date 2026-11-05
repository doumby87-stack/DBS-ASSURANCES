// Maintenance de l'agence, sans utilisateur connecté, toutes les heures :
//   · expiration des contrats en vigueur dont l'échéance est passée (database/migrations/0011) ;
//   · abandon des paiements en ligne restés sans réponse plus d'un jour (database/migrations/0013) ;
//   · purge des demandes du site qui ne sont pas devenues un devis, 12 mois après leur classement sans suite
//     (ou leur réception si personne ne les a traitées), avec leur carte grise ;
//   · analyse des cartes grises reçues pendant que l'antivirus ne répondait pas.
// Toutes passent par les fonctions que la base réserve à cet usage (database/migrations/0008 et 0011).

import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionSysteme } from "../../base-de-donnees/connexion.js";
import type { Antivirus } from "../../integrations/antivirus/clamav.js";
import { dechiffrerPiece } from "./piece.js";

export interface BilanMaintenance {
  contratsExpires: number;
  paiementsAbandonnes: number;
  purgees: number;
  analysees: number;
  infectees: number;
  enAttente: number;
}

const LOT_ANALYSES = 20;

export async function executerMaintenance(
  pool: Pool,
  antivirus: Antivirus,
  cleChiffrement: Buffer,
  journal?: Pick<FastifyBaseLogger, "warn" | "error">,
): Promise<BilanMaintenance> {
  const contratsExpires = await transactionSysteme(pool, async (client) => {
    const { rows } = await client.query<{ nombre: number }>("SELECT app.expirer_contrats() AS nombre");
    return rows[0]?.nombre ?? 0;
  });
  const paiementsAbandonnes = await transactionSysteme(pool, async (client) => {
    const { rows } = await client.query<{ nombre: number }>("SELECT app.abandonner_paiements_en_ligne() AS nombre");
    return rows[0]?.nombre ?? 0;
  });
  const purgees = await transactionSysteme(pool, async (client) => {
    const { rows } = await client.query<{ nombre: number }>("SELECT app.purger_demandes_site() AS nombre");
    // Codes de connexion au portail de plus d'un jour et sessions expirées (database/migrations/0012)
    await client.query("SELECT portail.purger()");
    return rows[0]?.nombre ?? 0;
  });

  const bilan: BilanMaintenance = { contratsExpires, paiementsAbandonnes, purgees, analysees: 0, infectees: 0, enAttente: 0 };
  if (!antivirus.configure) return bilan;

  const pieces = await transactionSysteme(pool, async (client) => {
    const { rows } = await client.query<{ id: string; contenu_chiffre: Buffer; empreinte: Buffer }>(
      "SELECT id, contenu_chiffre, empreinte FROM app.pieces_a_analyser($1)",
      [LOT_ANALYSES],
    );
    return rows;
  });

  for (const [rang, piece] of pieces.entries()) {
    let contenu: Buffer;
    try {
      contenu = dechiffrerPiece(cleChiffrement, piece.id, piece.contenu_chiffre, piece.empreinte);
    } catch (erreur) {
      journal?.error({ err: erreur, piece: piece.id }, "carte grise indéchiffrable : clé changée ou contenu altéré");
      bilan.enAttente += 1;
      continue;
    }
    const verdict = await antivirus.analyser(contenu);
    if (verdict.etat === "indisponible") {
      journal?.warn({ raison: verdict.raison }, "antivirus indisponible : analyse des cartes grises reportée");
      bilan.enAttente += pieces.length - rang;
      break;
    }
    await transactionSysteme(pool, (client) =>
      client.query("SELECT app.enregistrer_analyse_piece($1, $2, $3)", [
        piece.id, verdict.etat === "saine", verdict.etat === "infectee" ? verdict.signature : null,
      ]),
    );
    if (verdict.etat === "infectee") {
      bilan.infectees += 1;
      journal?.warn({ signature: verdict.signature }, "carte grise infectée découverte par la maintenance : contenu supprimé");
    } else {
      bilan.analysees += 1;
    }
  }
  return bilan;
}

/** Lance la maintenance une minute après le démarrage, puis toutes les heures. Renvoie de quoi l'arrêter. */
export function demarrerMaintenancePeriodique(
  pool: Pool,
  antivirus: Antivirus,
  cleChiffrement: Buffer,
  journal: Pick<FastifyBaseLogger, "info" | "warn" | "error">,
  intervalleMs = 60 * 60 * 1000,
): () => void {
  let enCours = false;
  const lancer = async () => {
    if (enCours) return;
    enCours = true;
    try {
      const bilan = await executerMaintenance(pool, antivirus, cleChiffrement, journal);
      if (Object.values(bilan).some(Boolean)) journal.info({ bilan }, "maintenance de l'agence");
    } catch (erreur) {
      journal.error({ err: erreur }, "maintenance de l'agence en échec");
    } finally {
      enCours = false;
    }
  };
  const premier = setTimeout(() => void lancer(), 60_000);
  const periodique = setInterval(() => void lancer(), intervalleMs);
  premier.unref();
  periodique.unref();
  return () => {
    clearTimeout(premier);
    clearInterval(periodique);
  };
}
