// Jetons de session : 256 bits aléatoires remis au navigateur dans un cookie.
// La base n'en garde que l'empreinte SHA-256 : une copie de la base ne permet pas d'usurper une session.

import { createHash, randomBytes } from "node:crypto";

const FORMAT_JETON = /^[A-Za-z0-9_-]{43}$/;

export interface Jeton {
  jeton: string;
  empreinte: Buffer;
}

export function genererJeton(): Jeton {
  const jeton = randomBytes(32).toString("base64url");
  return { jeton, empreinte: empreinteJeton(jeton)! };
}

/** Empreinte d'un jeton reçu, ou null si sa forme est invalide (rien n'est alors demandé à la base). */
export function empreinteJeton(jeton: string | undefined): Buffer | null {
  if (!jeton || !FORMAT_JETON.test(jeton)) return null;
  return createHash("sha256").update(jeton, "utf8").digest();
}
