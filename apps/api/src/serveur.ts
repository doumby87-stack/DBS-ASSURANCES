// Démarrage de l'API.

import { construireApplication } from "./application.js";
import { creerPool } from "./base-de-donnees/connexion.js";
import { chargerConfiguration, ErreurConfiguration } from "./config/configuration.js";

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
  const app = await construireApplication({ config, pool });

  const arreter = async (signal: string) => {
    app.log.info({ signal }, "arrêt de l'API");
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void arreter("SIGTERM"));
  process.once("SIGINT", () => void arreter("SIGINT"));

  await app.listen({ host: config.hote, port: config.port });
}

await demarrer();
