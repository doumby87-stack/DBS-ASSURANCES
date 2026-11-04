// Assemblage de l'API. Séparé du démarrage (serveur.ts) pour être testé sans réseau.

import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "./base-de-donnees/connexion.js";
import { transactionSysteme } from "./base-de-donnees/connexion.js";
import { erreurs, gestionnaireErreurs } from "./commun/erreurs.js";
import type { Configuration } from "./config/configuration.js";
import { routesClients } from "./modules/clients/routes.js";
import { routesContrats } from "./modules/contrats/routes.js";
import { routesDevis } from "./modules/devis/routes.js";
import { routesUtilisateurs } from "./modules/utilisateurs/routes.js";
import { routesVehicules } from "./modules/vehicules/routes.js";
import { creerGardes } from "./securite/gardes.js";
import { creerVerificateurFuite, type VerificateurFuite } from "./securite/mots-de-passe.js";
import { enregistrerProtections } from "./securite/protection.js";
import { routesAuthentification } from "./securite/routes-authentification.js";

export interface DependancesApplication {
  config: Configuration;
  pool: Pool;
  /** Horloge des codes à usage unique (remplaçable dans les tests). */
  horloge?: () => number;
  /** Vérification des mots de passe divulgués (remplaçable dans les tests). */
  verifierFuite?: VerificateurFuite | null;
  journal?: boolean;
}

export async function construireApplication(dependances: DependancesApplication): Promise<FastifyInstance> {
  const { config, pool } = dependances;

  const app = Fastify({
    logger:
      dependances.journal === false
        ? false
        : {
            level: config.niveauJournal,
            // Jamais de cookie, d'en-tête d'autorisation ni de mot de passe dans les journaux
            redact: {
              paths: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]', "*.motDePasse", "*.actuel", "*.nouveau"],
              censor: "[masqué]",
            },
          },
    // Adresse IP réelle : seuls les N premiers proxys devant l'API sont crus
    trustProxy: (_adresse: string, saut: number) => saut < config.proxysDeConfiance,
    bodyLimit: 64 * 1024,
    // L'identifiant de requête est toujours généré par le serveur, jamais repris du client
    requestIdHeader: false,
    return503OnClosing: true,
    // Un champ inattendu est refusé, pas ignoré en silence ; aucune conversion de type implicite
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false } },
  });

  // JSON uniquement : un formulaire HTML d'un autre site ne peut pas imiter une requête de l'API
  app.removeContentTypeParser("text/plain");

  await app.register(cookie);
  app.decorateRequest("utilisateur", null);
  app.setErrorHandler(gestionnaireErreurs);
  app.setNotFoundHandler(async () => {
    throw erreurs.introuvable();
  });
  enregistrerProtections(app, config);

  const gardes = creerGardes(pool);
  const verifierFuite =
    dependances.verifierFuite !== undefined
      ? dependances.verifierFuite
      : config.verifierMotsDePasseDivulgues
        ? creerVerificateurFuite()
        : null;

  app.get("/sante", async (_requete, reponse) => {
    try {
      await transactionSysteme(pool, (client) => client.query("SELECT 1"));
      return { statut: "ok" };
    } catch {
      return reponse.status(503).send({ statut: "base_indisponible" });
    }
  });

  await app.register(routesAuthentification, {
    config,
    pool,
    gardes,
    horloge: dependances.horloge ?? Date.now,
    verifierFuite,
  });
  await app.register(routesUtilisateurs, { pool, gardes });
  await app.register(routesClients, { pool, gardes });
  await app.register(routesContrats, { pool, gardes });
  await app.register(routesVehicules, { pool, gardes });
  await app.register(routesDevis, { pool, gardes });

  return app;
}
