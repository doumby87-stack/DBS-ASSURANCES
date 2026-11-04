// Outils communs aux tests d'intégration : application branchée sur la base de test,
// création de comptes, connexion complète (mot de passe + deuxième facteur).

import { randomBytes } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { expect, inject } from "vitest";
import { construireApplication } from "../../src/application.js";
import type { Antivirus, Verdict } from "../../src/integrations/antivirus/clamav.js";
import { creerPool, type Pool } from "../../src/base-de-donnees/connexion.js";
import { chargerConfiguration } from "../../src/config/configuration.js";
import type { EnvoiCodes } from "../../src/modules/portail/connexion.js";
import type { Messagerie } from "../../src/modules/relances/messagerie.js";
import { initialiserPremierAcces, preparerAccesProvisoire } from "../../src/modules/utilisateurs/acces.js";
import type { VerificateurFuite } from "../../src/securite/mots-de-passe.js";
import { NOM_COOKIE, type Role } from "../../src/securite/sessions.js";
import { codeTotp, decoderBase32, pasDeTemps } from "../../src/securite/totp.js";

declare module "vitest" {
  export interface ProvidedContext {
    urlApplication: string;
    urlSuperutilisateur: string;
  }
}

export const ORIGINE = "https://gestion.test.ci";

/** Antivirus de test : infecté si le fichier contient la chaîne EICAR ; réglable pour simuler une panne ou de nouvelles signatures. */
export interface AntivirusDeTest extends Antivirus {
  disponible: boolean;
  toutEstInfecte: boolean;
}

export function antivirusDeTest(): AntivirusDeTest {
  const antivirus: AntivirusDeTest = {
    configure: true,
    disponible: true,
    toutEstInfecte: false,
    async analyser(contenu: Buffer): Promise<Verdict> {
      if (!antivirus.disponible) return { etat: "indisponible", raison: "Antivirus injoignable (test)" };
      if (antivirus.toutEstInfecte || contenu.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
        return { etat: "infectee", signature: "Eicar-Test-Signature" };
      }
      return { etat: "saine" };
    },
  };
  return antivirus;
}

export interface Contexte {
  app: FastifyInstance;
  antivirus: AntivirusDeTest;
  cleChiffrement: Buffer;
  pool: Pool;
  /** Accès direct à la base de test, pour préparer ou vérifier une situation. */
  base: Pool;
  /** Horloge des codes à usage unique : avancer de 30 s donne un nouveau code. */
  horloge: { ms: number };
  fermer(): Promise<void>;
}

export async function demarrer(
  options: {
    verifierFuite?: VerificateurFuite | null; env?: Record<string, string>; messagerie?: Messagerie; envoiCodes?: EnvoiCodes;
  } = {},
): Promise<Contexte> {
  const antivirus = antivirusDeTest();
  const config = chargerConfiguration({
    NODE_ENV: "test",
    DATABASE_URL: inject("urlApplication"),
    CLE_CHIFFREMENT_DONNEES: randomBytes(32).toString("base64"),
    URL_BACK_OFFICE: ORIGINE,
    ...options.env,
  });
  const pool = creerPool(config.urlBaseDeDonnees);
  const base = creerPool(inject("urlSuperutilisateur"));
  const horloge = { ms: Date.now() };
  const app = await construireApplication({
    config, pool, journal: false, horloge: () => horloge.ms, verifierFuite: options.verifierFuite ?? null, antivirus,
    ...(options.messagerie ? { messagerie: options.messagerie } : {}),
    ...(options.envoiCodes ? { envoiCodes: options.envoiCodes } : {}),
  });
  return {
    app, antivirus, cleChiffrement: config.cleChiffrement, pool, base, horloge,
    async fermer() {
      await app.close();
      await pool.end();
      await base.end();
    },
  };
}

let compteur = 0;
export function adresseUnique(prefixe: string): string {
  compteur += 1;
  return `${prefixe}.${process.pid}.${Date.now()}.${compteur}@test.ci`;
}

export interface Compte {
  id: string;
  email: string;
  motDePasse: string;
  secret?: Buffer;
}

/** Crée un compte comme à l'installation (database/initialisation + outil premier-acces). */
export async function creerCompte(ctx: Contexte, role: Role, email = adresseUnique(role)): Promise<Compte> {
  const acces = await preparerAccesProvisoire();
  const client = await ctx.base.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO app.utilisateurs (email, nom, role) VALUES ($1, $2, $3) RETURNING id",
      [email, `Test ${role}`, role],
    );
    const id = await initialiserPremierAcces(client, email, acces);
    expect(id).toBe(rows[0]!.id);
    return { id: id!, email, motDePasse: acces.motDePasse };
  } finally {
    client.release();
  }
}

interface Envoi {
  methode?: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  cookie?: string | undefined;
  corps?: object;
  /** null : aucun en-tête Origin */
  origine?: string | null;
  ip?: string;
  enTetes?: Record<string, string>;
}

export function envoyer(ctx: Contexte, envoi: Envoi): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { ...envoi.enTetes };
  if (envoi.cookie) headers.cookie = envoi.cookie;
  if (envoi.origine !== null) headers.origin = envoi.origine ?? ORIGINE;
  return ctx.app.inject({
    method: envoi.methode ?? (envoi.corps ? "POST" : "GET"),
    url: envoi.url,
    headers,
    ...(envoi.corps ? { payload: envoi.corps } : {}),
    remoteAddress: envoi.ip ?? "198.51.100.1",
  });
}

/** Cookie de session posé par une réponse, prêt à renvoyer. */
export function cookieDe(reponse: LightMyRequestResponse): string | undefined {
  const cookie = reponse.cookies.find((c) => c.name === NOM_COOKIE);
  return cookie?.value ? `${NOM_COOKIE}=${cookie.value}` : undefined;
}

export function codeCourant(ctx: Contexte, compte: Compte): string {
  ctx.horloge.ms += 30_000; // un nouveau pas : jamais le même code que la fois précédente
  return codeTotp(compte.secret!, pasDeTemps(ctx.horloge.ms));
}

/** Connexion complète ; configure le deuxième facteur et remplace le mot de passe provisoire si nécessaire. */
export async function connecter(ctx: Contexte, compte: Compte, options: { changerMotDePasse?: boolean } = {}): Promise<string> {
  const connexion = await envoyer(ctx, { url: "/auth/connexion", corps: { email: compte.email, motDePasse: compte.motDePasse } });
  expect(connexion.statusCode).toBe(200);
  const partielle = cookieDe(connexion);

  let reponse: LightMyRequestResponse;
  if (connexion.json().etape === "configuration_mfa") {
    const configuration = await envoyer(ctx, { methode: "POST", url: "/auth/mfa/configuration", cookie: partielle });
    expect(configuration.statusCode).toBe(200);
    compte.secret = decoderBase32(configuration.json().secret);
    reponse = await envoyer(ctx, { url: "/auth/mfa/activation", cookie: partielle, corps: { code: codeCourant(ctx, compte) } });
  } else {
    reponse = await envoyer(ctx, { url: "/auth/mfa", cookie: partielle, corps: { code: codeCourant(ctx, compte) } });
  }
  expect(reponse.statusCode).toBe(200);
  let cookie = cookieDe(reponse)!;

  if (reponse.json().motDePasseProvisoire && options.changerMotDePasse !== false) {
    const nouveau = `Mangue verte ${randomBytes(4).toString("hex")} au marché`;
    const changement = await envoyer(ctx, { url: "/auth/mot-de-passe", cookie, corps: { actuel: compte.motDePasse, nouveau } });
    expect(changement.statusCode).toBe(200);
    compte.motDePasse = nouveau;
    cookie = cookieDe(changement)!;
  }
  return cookie;
}
