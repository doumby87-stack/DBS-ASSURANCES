// Sessions du personnel, conservées côté serveur (securite.sessions).
//   · niveau « mot_de_passe » : mot de passe vérifié, seul le deuxième facteur reste possible (5 minutes) ;
//   · niveau « complet » : accès selon le rôle, 15 minutes d'inactivité et 8 heures au maximum.
// Un nouveau jeton est remis à chaque changement de niveau et de mot de passe.

import type { FastifyReply, FastifyRequest } from "fastify";
import type { Client, Pool } from "../base-de-donnees/connexion.js";
import { transactionSysteme } from "../base-de-donnees/connexion.js";
import { empreinteJeton, genererJeton } from "./jetons.js";

/**
 * Cookie de session : son nom et l'attribut Secure dépendent de l'adresse de l'application.
 *   · en HTTPS (toujours en production, imposé par la configuration) : préfixe __Host- et Secure, le navigateur
 *     n'accepte alors ce cookie qu'en HTTPS, pour ce seul domaine, sur tout le site ;
 *   · sur http://localhost (démonstration, essais sur l'ordinateur) : ni préfixe ni Secure, car Safari refuse
 *     ces cookies hors HTTPS, même sur localhost. HttpOnly et SameSite=Strict restent.
 * L'API ne lit que le nom attendu pour son adresse : jamais un cookie sans préfixe quand elle est en HTTPS.
 */
export interface CookieDeSession {
  nom: string;
  securise: boolean;
}

export function cookieDeSession(origine: string, nom: string): CookieDeSession {
  const securise = new URL(origine).protocol === "https:";
  return { nom: securise ? `__Host-${nom}` : nom, securise };
}

/** Nom du cookie de session du personnel en HTTPS */
export const NOM_COOKIE = "__Host-dbs_session";
export const DUREE_SESSION_PARTIELLE_MS = 5 * 60 * 1000;
export const DUREE_SESSION_COMPLETE_MS = 8 * 60 * 60 * 1000;
export const INACTIVITE_MAX = "15 minutes";

export type NiveauSession = "mot_de_passe" | "complet";
export type Role = "gerant" | "charge_clientele" | "caissier" | "commercial" | "apporteur" | "auditeur";

export interface SessionUtilisateur {
  id: string;
  email: string;
  nom: string;
  role: Role;
  niveau: NiveauSession;
  motDePasseProvisoire: boolean;
  totpActive: boolean;
  expireLe: Date;
  empreinte: Buffer;
}

export async function ouvrirSession(
  client: Client,
  utilisateurId: string,
  niveau: NiveauSession,
  requete: FastifyRequest,
): Promise<{ jeton: string; expireLe: Date }> {
  const { jeton, empreinte } = genererJeton();
  const duree = niveau === "complet" ? DUREE_SESSION_COMPLETE_MS : DUREE_SESSION_PARTIELLE_MS;
  const agent = requete.headers["user-agent"]?.slice(0, 300) ?? null;
  const { rows } = await client.query<{ expire_le: Date }>(
    `INSERT INTO securite.sessions (empreinte, utilisateur_id, niveau, expire_le, adresse_ip, agent_utilisateur)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5, $6)
     RETURNING expire_le`,
    [empreinte, utilisateurId, niveau, duree / 1000, requete.ip, agent],
  );
  return { jeton, expireLe: rows[0]!.expire_le };
}

/** Session valide correspondant au cookie de la requête, ou null. */
export async function lireSession(pool: Pool, requete: FastifyRequest, cookie: CookieDeSession): Promise<SessionUtilisateur | null> {
  const empreinte = empreinteJeton(requete.cookies[cookie.nom]);
  if (!empreinte) return null;
  const { rows } = await transactionSysteme(pool, (client) =>
    client.query<{
      utilisateur_id: string; niveau: NiveauSession; expire_le: Date; email: string; nom: string;
      role: Role; mot_de_passe_provisoire: boolean; totp_active: boolean;
    }>("SELECT * FROM securite.lire_session($1, $2)", [empreinte, INACTIVITE_MAX]),
  );
  const ligne = rows[0];
  if (!ligne) return null;
  return {
    id: ligne.utilisateur_id,
    email: ligne.email,
    nom: ligne.nom,
    role: ligne.role,
    niveau: ligne.niveau,
    motDePasseProvisoire: ligne.mot_de_passe_provisoire,
    totpActive: ligne.totp_active,
    expireLe: ligne.expire_le,
    empreinte,
  };
}

export async function fermerSession(client: Client, empreinte: Buffer): Promise<void> {
  await client.query("UPDATE securite.sessions SET fermee_le = now() WHERE empreinte = $1 AND fermee_le IS NULL", [empreinte]);
}

/** Ferme toutes les sessions d'un utilisateur (désactivation, réinitialisation, blocage, changement de mot de passe). */
export async function fermerSessionsUtilisateur(client: Client, utilisateurId: string, sauf?: Buffer): Promise<void> {
  await client.query(
    `UPDATE securite.sessions SET fermee_le = now()
     WHERE utilisateur_id = $1 AND fermee_le IS NULL AND ($2::bytea IS NULL OR empreinte <> $2)`,
    [utilisateurId, sauf ?? null],
  );
}

export function poserCookieSession(reponse: FastifyReply, cookie: CookieDeSession, jeton: string, expireLe: Date): void {
  reponse.setCookie(cookie.nom, jeton, {
    path: "/",
    httpOnly: true,
    secure: cookie.securise,
    sameSite: "strict",
    expires: expireLe,
  });
}

export function effacerCookieSession(reponse: FastifyReply, cookie: CookieDeSession): void {
  reponse.clearCookie(cookie.nom, { path: "/", httpOnly: true, secure: cookie.securise, sameSite: "strict" });
}
