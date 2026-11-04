// Connexion au portail des entreprises (tâche 10) : un code à usage unique envoyé sur WhatsApp, puis une
// session conservée côté serveur (portail.sessions), distincte de celle du personnel (autre cookie, autre
// table, autres règles). Le code n'est jamais enregistré : la base n'en garde qu'un HMAC, calculé ici avec
// une clé dérivée de CLE_CHIFFREMENT_DONNEES, que la base ne connaît pas.

import { createHmac, hkdfSync, randomInt } from "node:crypto";
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionSysteme } from "../../base-de-donnees/connexion.js";
import { erreurs } from "../../commun/erreurs.js";
import type { ConfigurationRelances } from "../../config/configuration.js";
import type { ResultatEnvoi } from "../../integrations/envoi.js";
import { creerClientWhatsApp } from "../../integrations/whatsapp/whatsapp.js";
import { empreinteJeton } from "../../securite/jetons.js";

// Préfixe __Host- : cookie limité à l'adresse du portail, en HTTPS ; il n'est jamais envoyé au back-office
export const NOM_COOKIE_PORTAIL = "__Host-dbs_portail";
export const DUREE_CODE = "10 minutes";
export const DUREE_SESSION_PORTAIL = "12 hours";
export const INACTIVITE_PORTAIL = "30 minutes";

export type RoleGestionnaire = "titulaire" | "gestionnaire";

export interface SessionPortail {
  gestionnaireId: string;
  clientId: string;
  nom: string;
  telephone: string;
  role: RoleGestionnaire;
  entreprise: string;
  expireLe: Date;
  empreinte: Buffer;
}

declare module "fastify" {
  interface FastifyRequest {
    gestionnaire: SessionPortail | null;
  }
}

/** Envoi des codes de connexion : WhatsApp (modèle d'authentification), ou simulation hors production. */
export interface EnvoiCodes {
  disponible: boolean;
  envoyer(telephone: string, code: string): Promise<ResultatEnvoi>;
}

export function creerEnvoiCodes(config: ConfigurationRelances, recuperer?: typeof fetch): EnvoiCodes {
  if (config.simulation) {
    return { disponible: true, envoyer: async () => ({ ok: true, identifiant: "simulation" }) };
  }
  const whatsapp = config.whatsapp ? creerClientWhatsApp(config.whatsapp, recuperer) : null;
  return {
    disponible: whatsapp !== null,
    envoyer: async (telephone, code) =>
      whatsapp ? whatsapp.envoyerCodeConnexion(telephone, code)
        : { ok: false, erreur: "Aucun canal configuré pour les codes de connexion", definitif: false },
  };
}

/** Six chiffres tirés au hasard (générateur cryptographique). */
export function genererCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** HMAC du code, lié au numéro : le même code pour un autre numéro donne une autre empreinte. */
export function creerEmpreinteCode(cleChiffrement: Buffer): (telephone: string, code: string) => Buffer {
  const cle = Buffer.from(hkdfSync("sha256", cleChiffrement, Buffer.alloc(0), "dbs:code-portail", 32));
  return (telephone, code) => createHmac("sha256", cle).update(`${telephone}:${code}`, "utf8").digest();
}

/** Session valide correspondant au cookie du portail, ou null. */
export async function lireSessionPortail(pool: Pool, requete: FastifyRequest): Promise<SessionPortail | null> {
  const empreinte = empreinteJeton(requete.cookies[NOM_COOKIE_PORTAIL]);
  if (!empreinte) return null;
  const { rows } = await transactionSysteme(pool, (client) =>
    client.query<{
      gestionnaire_id: string; client_id: string; nom: string; telephone: string; role: RoleGestionnaire;
      entreprise: string; expire_le: Date;
    }>("SELECT * FROM portail.lire_session($1, $2)", [empreinte, INACTIVITE_PORTAIL]),
  );
  const ligne = rows[0];
  if (!ligne) return null;
  return {
    gestionnaireId: ligne.gestionnaire_id,
    clientId: ligne.client_id,
    nom: ligne.nom,
    telephone: ligne.telephone,
    role: ligne.role,
    entreprise: ligne.entreprise,
    expireLe: ligne.expire_le,
    empreinte,
  };
}

export function poserCookiePortail(reponse: FastifyReply, jeton: string, expireLe: Date): void {
  reponse.setCookie(NOM_COOKIE_PORTAIL, jeton, { path: "/", httpOnly: true, secure: true, sameSite: "strict", expires: expireLe });
}

export function effacerCookiePortail(reponse: FastifyReply): void {
  reponse.clearCookie(NOM_COOKIE_PORTAIL, { path: "/", httpOnly: true, secure: true, sameSite: "strict" });
}

/** Garde des routes du portail : une session du portail valide. */
export function gardePortail(pool: Pool): preHandlerAsyncHookHandler {
  return async (requete) => {
    requete.gestionnaire ??= await lireSessionPortail(pool, requete);
    if (!requete.gestionnaire) throw erreurs.nonAuthentifie();
  };
}

/** Personne connectée au portail (après la garde). */
export function gestionnaireDe(requete: FastifyRequest): SessionPortail {
  if (!requete.gestionnaire) throw erreurs.nonAuthentifie();
  return requete.gestionnaire;
}
