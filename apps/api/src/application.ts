// Assemblage de l'API. Séparé du démarrage (serveur.ts) pour être testé sans réseau.

import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "./base-de-donnees/connexion.js";
import { transactionSysteme } from "./base-de-donnees/connexion.js";
import { erreurs, gestionnaireErreurs } from "./commun/erreurs.js";
import type { Configuration } from "./config/configuration.js";
import { routesClients } from "./modules/clients/routes.js";
import { routesCommissions } from "./modules/commissions/routes.js";
import { routesContrats } from "./modules/contrats/routes.js";
import { routesDevis } from "./modules/devis/routes.js";
import { routesDemandesSiteBackOffice } from "./modules/demandes-site/routes.js";
import { routesDemandesSite } from "./modules/demandes-site/routes-site.js";
import { creerAntivirus, type Antivirus } from "./integrations/antivirus/clamav.js";
import { routesNotificationsWhatsApp } from "./integrations/whatsapp/notifications.js";
import { routesCaisse } from "./modules/encaissements/caisse.js";
import { routesEncaissements } from "./modules/encaissements/routes.js";
import { routesFlottes } from "./modules/flottes/routes.js";
import { creerPrestataire, type PrestatairePaiement } from "./integrations/paiement/prestataire.js";
import { routesNotificationsPaiement, routesPaiementsEnLigne } from "./modules/paiements/routes.js";
import { routesPaiementsPortail } from "./modules/paiements/routes-portail.js";
import { creerEnvoiCodes, type EnvoiCodes } from "./modules/portail/connexion.js";
import { routesPortail } from "./modules/portail/routes.js";
import { routesPortailAgence } from "./modules/portail/routes-agence.js";
import { creerMessagerie, type Messagerie } from "./modules/relances/messagerie.js";
import { routesRelances } from "./modules/relances/routes.js";
import { routesReversements } from "./modules/reversements/routes.js";
import { routesSinistres } from "./modules/sinistres/routes.js";
import { routesSinistresPortail } from "./modules/sinistres/routes-portail.js";
import { routesExportDonnees } from "./modules/clients/export-donnees.js";
import { routesIdentification } from "./modules/conformite/identification.js";
import { routesRegistres } from "./modules/conformite/registres.js";
import { routesReclamations, routesReclamationsPortail } from "./modules/reclamations/routes.js";
import { routesRendezVous } from "./modules/rendez-vous/routes.js";
import { routesStatistiques } from "./modules/statistiques/routes.js";
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
  /** Envoi des relances (remplaçable dans les tests) ; sinon, d'après la configuration. */
  messagerie?: Messagerie;
  /** Analyse antivirus des pièces jointes (remplaçable dans les tests) ; sinon, d'après la configuration. */
  antivirus?: Antivirus;
  /** Envoi des codes de connexion au portail (remplaçable dans les tests) ; sinon, d'après la configuration. */
  envoiCodes?: EnvoiCodes;
  /** Prestataire de paiement en ligne (le même que celui de la maintenance) ; sinon, d'après la configuration. */
  prestatairePaiement?: PrestatairePaiement | null;
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
  app.decorateRequest("gestionnaire", null);
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
  await app.register(routesFlottes, { pool, gardes });
  await app.register(routesDevis, { pool, gardes });
  await app.register(routesSinistres, { pool, gardes, cleChiffrement: config.cleChiffrement });
  const antivirus = dependances.antivirus ?? creerAntivirus(config.antivirus);
  await app.register(routesDemandesSiteBackOffice, { pool, gardes, cleChiffrement: config.cleChiffrement, antivirus });
  // Formulaire du site : seulement si l'adresse du site est configurée (sinon le site garde l'envoi par WhatsApp)
  if (config.origineSite) {
    await app.register(routesDemandesSite, { pool, cleChiffrement: config.cleChiffrement, origineSite: config.origineSite, antivirus });
  }
  // Portail (espace client) : accès et attestations gérés par l'agence ; le portail lui-même seulement si son
  // adresse est configurée, et le paiement en ligne seulement si un prestataire l'est aussi
  await app.register(routesPortailAgence, { pool, gardes, cleChiffrement: config.cleChiffrement, antivirus });
  await app.register(routesPaiementsEnLigne, { pool, gardes });
  const prestataire = config.paiement ? (dependances.prestatairePaiement ?? creerPrestataire(config.paiement)) : null;
  if (config.originePortail) {
    await app.register(routesPortail, {
      pool,
      cleChiffrement: config.cleChiffrement,
      envoiCodes: dependances.envoiCodes ?? creerEnvoiCodes(config.relances),
      paiementEnLigne: prestataire !== null,
    });
    await app.register(routesSinistresPortail, { pool, cleChiffrement: config.cleChiffrement, antivirus });
    await app.register(routesReclamationsPortail, { pool });
    if (prestataire && config.paiement) {
      await app.register(routesPaiementsPortail, {
        pool, prestataire, originePortail: config.originePortail, montantMax: config.paiement.montantMax,
      });
    }
  }
  if (prestataire) await app.register(routesNotificationsPaiement, { pool, prestataire });
  await app.register(routesEncaissements, { pool, gardes });
  await app.register(routesCaisse, { pool, gardes });
  await app.register(routesReversements, { pool, gardes });
  await app.register(routesCommissions, { pool, gardes });
  // Conformité et pilotage (tâche 12)
  await app.register(routesIdentification, { pool, gardes, cleChiffrement: config.cleChiffrement, antivirus });
  await app.register(routesRegistres, { pool, gardes });
  await app.register(routesReclamations, { pool, gardes });
  await app.register(routesStatistiques, { pool, gardes });
  await app.register(routesRendezVous, { pool, gardes });
  await app.register(routesExportDonnees, { pool, gardes });
  await app.register(routesRelances, {
    pool,
    gardes,
    messagerie: dependances.messagerie ?? creerMessagerie(config.relances),
    cycle: { heuresEnvoi: config.relances.heuresEnvoi },
  });
  // Notifications de WhatsApp : seulement si l'accès à WhatsApp est configuré
  if (config.relances.whatsapp) {
    await app.register(routesNotificationsWhatsApp, { pool, config: config.relances.whatsapp });
  }

  return app;
}
