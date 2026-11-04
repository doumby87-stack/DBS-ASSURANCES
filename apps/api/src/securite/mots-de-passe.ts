// Mots de passe du personnel : hachage Argon2id, politique, mots de passe provisoires,
// vérification contre les fuites connues.

import { hash, verify, type Algorithm, type Options } from "@node-rs/argon2";
import { createHash, randomBytes, randomInt } from "node:crypto";

// Paramètres minimaux recommandés par l'OWASP pour Argon2id : 19 Mio de mémoire, 2 passes, 1 fil.
const PARAMETRES: Options = {
  algorithm: 2 as Algorithm, // Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
const MARQUEUR_PARAMETRES = "$m=19456,t=2,p=1$";

export const LONGUEUR_MIN = 12;
export const LONGUEUR_MAX = 128;

export function hacherMotDePasse(motDePasse: string): Promise<string> {
  return hash(motDePasse, PARAMETRES);
}

export async function verifierMotDePasse(empreinte: string, motDePasse: string): Promise<boolean> {
  try {
    return await verify(empreinte, motDePasse);
  } catch {
    return false;
  }
}

/** Vrai si l'empreinte a été calculée avec d'anciens paramètres : à recalculer à la prochaine connexion. */
export function doitEtreRehache(empreinte: string): boolean {
  return !empreinte.startsWith("$argon2id$") || !empreinte.includes(MARQUEUR_PARAMETRES);
}

// Empreinte d'un mot de passe aléatoire, vérifiée quand l'adresse saisie ne correspond à aucun compte :
// la réponse prend le même temps, et ne révèle donc pas si le compte existe.
let empreinteLeurre: Promise<string> | undefined;
export function verifierLeurre(motDePasse: string): Promise<boolean> {
  empreinteLeurre ??= hacherMotDePasse(randomBytes(32).toString("base64"));
  return empreinteLeurre.then((empreinte) => verifierMotDePasse(empreinte, motDePasse));
}

/** Renvoie la raison du refus, ou null si le mot de passe est acceptable. */
export function controlerPolitique(motDePasse: string, email: string): string | null {
  const longueur = [...motDePasse].length;
  if (longueur < LONGUEUR_MIN) return `Le mot de passe doit contenir au moins ${LONGUEUR_MIN} caractères.`;
  if (longueur > LONGUEUR_MAX) return `Le mot de passe doit contenir au plus ${LONGUEUR_MAX} caractères.`;
  if (new Set(motDePasse).size < 5) return "Le mot de passe est trop répétitif.";
  const identifiant = email.split("@")[0]?.toLowerCase() ?? "";
  if (identifiant.length >= 4 && motDePasse.toLowerCase().includes(identifiant)) {
    return "Le mot de passe ne doit pas contenir votre adresse e-mail.";
  }
  return null;
}

// Sans caractères ambigus (0/O, 1/l/I) : il est dicté ou recopié par la personne.
const ALPHABET_PROVISOIRE = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/** Mot de passe provisoire remis par le gérant, à changer à la première connexion (environ 114 bits). */
export function genererMotDePasseProvisoire(): string {
  const groupes: string[] = [];
  for (let g = 0; g < 4; g += 1) {
    let groupe = "";
    for (let i = 0; i < 5; i += 1) groupe += ALPHABET_PROVISOIRE[randomInt(ALPHABET_PROVISOIRE.length)];
    groupes.push(groupe);
  }
  return groupes.join("-");
}

export type VerificateurFuite = (motDePasse: string) => Promise<boolean | null>;

/**
 * Le mot de passe figure-t-il dans une fuite connue ? Service Have I Been Pwned, par « k-anonymat » :
 * seuls les 5 premiers caractères de l'empreinte SHA-1 quittent le serveur, jamais le mot de passe.
 * Renvoie null si le service ne répond pas (le changement est alors accepté, et l'incident journalisé).
 */
export function creerVerificateurFuite(requete: typeof fetch = fetch, delaiMs = 3_000): VerificateurFuite {
  return async (motDePasse) => {
    const empreinte = createHash("sha1").update(motDePasse, "utf8").digest("hex").toUpperCase();
    const prefixe = empreinte.slice(0, 5);
    const suffixe = empreinte.slice(5);
    try {
      const reponse = await requete(`https://api.pwnedpasswords.com/range/${prefixe}`, {
        headers: { "Add-Padding": "true", "User-Agent": "dbs-assurances-api" },
        signal: AbortSignal.timeout(delaiMs),
      });
      if (!reponse.ok) return null;
      const corps = await reponse.text();
      return corps.split("\n").some((ligne) => {
        const [suite, nombre] = ligne.trim().split(":");
        return suite === suffixe && Number(nombre) > 0;
      });
    } catch {
      return null;
    }
  };
}
