// Deuxième facteur par code temporaire (TOTP, RFC 6238), compatible avec Google Authenticator,
// Microsoft Authenticator, Aegis, 2FAS… Codes de 6 chiffres, renouvelés toutes les 30 secondes.
// Écrit sans dépendance extérieure ; vérifié par les vecteurs de test de la RFC 6238.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PERIODE_SECONDES = 30;
export const CHIFFRES = 6;
const ALPHABET_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encoderBase32(octets: Buffer): string {
  let bits = 0;
  let valeur = 0;
  let resultat = "";
  for (const octet of octets) {
    valeur = (valeur << 8) | octet;
    bits += 8;
    while (bits >= 5) {
      resultat += ALPHABET_BASE32[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) resultat += ALPHABET_BASE32[(valeur << (5 - bits)) & 31];
  return resultat;
}

export function decoderBase32(texte: string): Buffer {
  const propre = texte.toUpperCase().replace(/[\s=-]/g, "");
  const octets: number[] = [];
  let bits = 0;
  let valeur = 0;
  for (const caractere of propre) {
    const index = ALPHABET_BASE32.indexOf(caractere);
    if (index === -1) throw new Error("Caractère base32 invalide");
    valeur = (valeur << 5) | index;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(octets);
}

/** Secret de 160 bits, la taille recommandée par la RFC 4226 pour HMAC-SHA1. */
export function genererSecretTotp(): Buffer {
  return randomBytes(20);
}

export function pasDeTemps(maintenantMs: number): number {
  return Math.floor(maintenantMs / 1000 / PERIODE_SECONDES);
}

export function codeTotp(secret: Buffer, pas: number, chiffres = CHIFFRES): string {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(pas));
  const hmac = createHmac("sha1", secret).update(compteur).digest();
  const decalage = hmac[hmac.length - 1]! & 0x0f;
  const binaire =
    ((hmac[decalage]! & 0x7f) << 24) |
    (hmac[decalage + 1]! << 16) |
    (hmac[decalage + 2]! << 8) |
    hmac[decalage + 3]!;
  return String(binaire % 10 ** chiffres).padStart(chiffres, "0");
}

/**
 * Vérifie un code saisi. Tolère un décalage d'horloge d'un pas (±30 secondes).
 * Refuse tout pas déjà utilisé ou antérieur : un code intercepté ne sert pas une seconde fois.
 * Renvoie le pas accepté, à enregistrer, ou null.
 */
export function verifierCodeTotp(
  secret: Buffer,
  code: string,
  maintenantMs: number,
  dernierPasAccepte: number | null,
): number | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const actuel = pasDeTemps(maintenantMs);
  let accepte: number | null = null;
  for (const pas of [actuel - 1, actuel, actuel + 1]) {
    if (dernierPasAccepte !== null && pas <= dernierPasAccepte) continue;
    // Comparaison à temps constant ; toutes les fenêtres sont testées
    if (timingSafeEqual(Buffer.from(codeTotp(secret, pas)), Buffer.from(code)) && accepte === null) {
      accepte = pas;
    }
  }
  return accepte;
}

/** Adresse à afficher en QR code pour enregistrer le compte dans l'application d'authentification. */
export function uriOtpauth(secret: Buffer, compte: string, emetteur = "DBS-ASSURANCES"): string {
  const libelle = encodeURIComponent(`${emetteur}:${compte}`);
  const parametres = new URLSearchParams({
    secret: encoderBase32(secret),
    issuer: emetteur,
    algorithm: "SHA1",
    digits: String(CHIFFRES),
    period: String(PERIODE_SECONDES),
  });
  return `otpauth://totp/${libelle}?${parametres.toString()}`;
}
