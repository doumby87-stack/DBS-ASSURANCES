// Protections appliquées à toutes les requêtes :
//   · contre les requêtes forcées depuis un autre site (CSRF) : toute requête qui modifie des données
//     doit venir de l'origine du back-office (en plus des cookies SameSite=Strict) ;
//   · en-têtes de sécurité sur toutes les réponses.

import type { FastifyInstance } from "fastify";
import type { Configuration } from "../config/configuration.js";
import { erreurs } from "../commun/erreurs.js";

const METHODES_SANS_EFFET = new Set(["GET", "HEAD", "OPTIONS"]);

export function enregistrerProtections(app: FastifyInstance, config: Configuration): void {
  app.addHook("onRequest", async (requete) => {
    if (METHODES_SANS_EFFET.has(requete.method)) return;
    if (requete.headers.origin !== config.origineBackOffice) throw erreurs.origineRefusee();
  });

  app.addHook("onSend", async (_requete, reponse, charge) => {
    reponse.header("Cache-Control", "no-store");
    reponse.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    reponse.header("X-Content-Type-Options", "nosniff");
    reponse.header("X-Frame-Options", "DENY");
    reponse.header("Referrer-Policy", "no-referrer");
    reponse.header("Cross-Origin-Resource-Policy", "same-origin");
    if (config.environnement === "production") {
      reponse.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return charge;
  });
}
