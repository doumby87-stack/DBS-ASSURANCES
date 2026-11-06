// Démarrage de l'API.

import { construireApplication } from "./application.js";
import { creerPool } from "./base-de-donnees/connexion.js";
import { chargerConfiguration, ErreurConfiguration } from "./config/configuration.js";
import { creerAntivirus } from "./integrations/antivirus/clamav.js";
import { creerPrestataire } from "./integrations/paiement/prestataire.js";
import { demarrerMaintenancePeriodique } from "./modules/demandes-site/maintenance.js";
import { demarrerRelancesPeriodiques } from "./modules/relances/cycle.js";
import { creerMessagerie } from "./modules/relances/messagerie.js";

async function demarrer(): Promise<void> {
  let config;
  try {
    config = chargerConfiguration();
  } catch (erreur) {
    if (erreur instanceof ErreurConfiguration) {
      console.error(erreur.message);
      process.exit(1);
    }
    throw erreur;
  }

  const pool = creerPool(config.urlBaseDeDonnees);
  const messagerie = creerMessagerie(config.relances);
  const antivirus = creerAntivirus(config.antivirus);
  // Un seul prestataire de paiement, pour les routes et pour la maintenance qui vérifie les paiements en attente
  const prestatairePaiement = creerPrestataire(config.paiement);
  const app = await construireApplication({ config, pool, messagerie, antivirus, prestatairePaiement });
  const arreterRelances = config.relances.actives
    ? demarrerRelancesPeriodiques(pool, messagerie, { heuresEnvoi: config.relances.heuresEnvoi }, app.log)
    : () => {};
  // Expiration des contrats échus, purge des demandes du site à 12 mois et analyse des pièces en attente :
  // toujours active
  const arreterMaintenance = demarrerMaintenancePeriodique(pool, antivirus, config.cleChiffrement, app.log, prestatairePaiement);

  const arreter = async (signal: string) => {
    app.log.info({ signal }, "arrêt de l'API");
    arreterRelances();
    arreterMaintenance();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void arreter("SIGTERM"));
  process.once("SIGINT", () => void arreter("SIGINT"));

  await app.listen({ host: config.hote, port: config.port });
}

await demarrer();
