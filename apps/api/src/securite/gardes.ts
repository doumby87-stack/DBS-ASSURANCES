// Gardes des routes : chaque route déclare le niveau de session et les rôles qu'elle exige.
// Une route sans garde n'est accessible qu'aux routes publiques prévues (connexion, santé).

import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { Pool } from "../base-de-donnees/connexion.js";
import { erreurs } from "../commun/erreurs.js";
import { lireSession, type Role, type SessionUtilisateur } from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    utilisateur: SessionUtilisateur | null;
  }
}

/** Utilisateur authentifié de la requête (après une garde). */
export function utilisateurDe(requete: FastifyRequest): SessionUtilisateur {
  if (!requete.utilisateur) throw erreurs.nonAuthentifie();
  return requete.utilisateur;
}

export interface Gardes {
  /** Mot de passe vérifié, deuxième facteur attendu. */
  sessionPartielle: preHandlerAsyncHookHandler;
  /** Connexion complète ; le mot de passe provisoire doit avoir été changé, sauf autorisation explicite. */
  sessionComplete: (options?: { autoriserMotDePasseProvisoire?: boolean }) => preHandlerAsyncHookHandler;
  /** Connexion complète et rôle parmi ceux indiqués. */
  roles: (...roles: Role[]) => preHandlerAsyncHookHandler;
}

export function creerGardes(pool: Pool): Gardes {
  async function charger(requete: FastifyRequest): Promise<SessionUtilisateur> {
    requete.utilisateur ??= await lireSession(pool, requete);
    if (!requete.utilisateur) throw erreurs.nonAuthentifie();
    return requete.utilisateur;
  }

  async function exigerComplete(requete: FastifyRequest, autoriserMotDePasseProvisoire = false): Promise<SessionUtilisateur> {
    const session = await charger(requete);
    if (session.niveau !== "complet") throw erreurs.nonAuthentifie();
    if (session.motDePasseProvisoire && !autoriserMotDePasseProvisoire) throw erreurs.motDePasseAChanger();
    return session;
  }

  return {
    sessionPartielle: async (requete) => {
      const session = await charger(requete);
      if (session.niveau !== "mot_de_passe") throw erreurs.nonAuthentifie();
    },
    sessionComplete: (options = {}) => async (requete) => {
      await exigerComplete(requete, options.autoriserMotDePasseProvisoire);
    },
    roles: (...roles) => async (requete) => {
      const session = await exigerComplete(requete);
      if (!roles.includes(session.role)) throw erreurs.accesRefuse();
    },
  };
}
