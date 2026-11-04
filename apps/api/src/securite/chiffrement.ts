// Chiffrement des données très sensibles (secrets du deuxième facteur, numéros de pièces d'identité)
// avant leur entrée en base : AES-256-GCM, authentifié.
//
// Le « contexte » lie le texte chiffré à son usage et à son propriétaire (par exemple
// « totp:<identifiant utilisateur> ») : recopier la valeur chiffrée d'un utilisateur sur un
// autre la rend indéchiffrable.
//
// Format : version (1 octet) | vecteur d'initialisation (12) | étiquette d'authentification (16) | texte chiffré

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;
const LONGUEUR_IV = 12;
const LONGUEUR_ETIQUETTE = 16;

export function chiffrer(cle: Buffer, clair: Buffer, contexte: string): Buffer {
  const iv = randomBytes(LONGUEUR_IV);
  const chiffreur = createCipheriv("aes-256-gcm", cle, iv, { authTagLength: LONGUEUR_ETIQUETTE });
  chiffreur.setAAD(Buffer.from(contexte, "utf8"));
  const chiffre = Buffer.concat([chiffreur.update(clair), chiffreur.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, chiffreur.getAuthTag(), chiffre]);
}

/** Lève une erreur si la donnée a été modifiée, si la clé ou le contexte ne correspondent pas. */
export function dechiffrer(cle: Buffer, donnees: Buffer, contexte: string): Buffer {
  if (donnees.length < 1 + LONGUEUR_IV + LONGUEUR_ETIQUETTE || donnees[0] !== VERSION) {
    throw new Error("Donnée chiffrée illisible");
  }
  const iv = donnees.subarray(1, 1 + LONGUEUR_IV);
  const etiquette = donnees.subarray(1 + LONGUEUR_IV, 1 + LONGUEUR_IV + LONGUEUR_ETIQUETTE);
  const chiffre = donnees.subarray(1 + LONGUEUR_IV + LONGUEUR_ETIQUETTE);
  const dechiffreur = createDecipheriv("aes-256-gcm", cle, iv, { authTagLength: LONGUEUR_ETIQUETTE });
  dechiffreur.setAAD(Buffer.from(contexte, "utf8"));
  dechiffreur.setAuthTag(etiquette);
  return Buffer.concat([dechiffreur.update(chiffre), dechiffreur.final()]);
}
