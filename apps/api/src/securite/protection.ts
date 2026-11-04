// Protections appliquées à toutes les requêtes :
//   · contre les requêtes forcées depuis un autre site (CSRF) : toute requête qui modifie des données
//     doit venir de l'origine du back-office (en plus des cookies SameSite=Strict). Seule exception, les
//     routes ouvertes au site vitrine : elles n'acceptent que l'origine du site, et aucune session ; celles
//     du portail des entreprises n'acceptent que l'origine du portail ;
//   · en-têtes de sécurité sur toutes les réponses.

import type { FastifyInstance } from "fastify";
import type { Configuration } from "../config/configuration.js";
import { erreurs } from "../commun/erreurs.js";

const METHODES_SANS_EFFET = new Set(["GET", "HEAD", "OPTIONS"]);

declare module "fastify" {
  interface FastifyContextConfig {
    /**
     * Route appelée par un service extérieur (notifications de WhatsApp), jamais par le back-office :
     * pas de contrôle d'origine, la route vérifie elle-même la signature de chaque requête et la refuse sans elle.
     */
    authentifieeParSignature?: boolean;
    /**
     * Route publique appelée par le formulaire du site vitrine (demande de devis) : seule l'origine du site
     * est acceptée, y compris pour la requête préalable du navigateur (OPTIONS). La route n'utilise aucune session.
     */
    appeleeParLeSite?: boolean;
    /**
     * Route du portail des entreprises : les requêtes qui modifient des données ne sont acceptées que depuis
     * l'origine du portail, jamais depuis celle du back-office (et inversement pour les routes du personnel).
     */
    appeleeParLePortail?: boolean;
  }
}

export function enregistrerProtections(app: FastifyInstance, config: Configuration): void {
  app.addHook("onRequest", async (requete) => {
    if (requete.routeOptions.config?.appeleeParLeSite === true) {
      if (!config.origineSite || requete.headers.origin !== config.origineSite) throw erreurs.origineRefusee();
      return;
    }
    if (METHODES_SANS_EFFET.has(requete.method)) return;
    if (requete.routeOptions.config?.authentifieeParSignature === true) return;
    if (requete.routeOptions.config?.appeleeParLePortail === true) {
      if (!config.originePortail || requete.headers.origin !== config.originePortail) throw erreurs.origineRefusee();
      return;
    }
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
