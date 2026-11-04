// Attestations d'assurance (PDF de l'ASACI) : contrôle du fichier, chiffrement, lecture.
// Chiffrées comme les cartes grises (AES-256-GCM, clé de l'API), avec un contexte propre à chaque
// période de véhicule : une attestation recopiée sur une autre ligne ne se déchiffre pas.

import { createHash } from "node:crypto";
import { chiffrer, dechiffrer } from "../../securite/chiffrement.js";
import { decoderBase64, typeReel } from "../demandes-site/piece.js";

/** Une attestation de l'ASACI pèse quelques centaines de Ko ; 2 Mo laissent de la marge. */
export const TAILLE_ATTESTATION_MAX = 2 * 1024 * 1024;
export const LONGUEUR_BASE64_ATTESTATION_MAX = Math.ceil(TAILLE_ATTESTATION_MAX / 3) * 4;
/** N° d'attestation : lettres, chiffres, espaces, tirets et barres obliques. */
export const FORMAT_NUMERO_ATTESTATION = "^[A-Za-z0-9][A-Za-z0-9 /-]{2,39}$";

const contexte = (ligneId: string) => `attestation:${ligneId}`;

/** PDF décodé et vérifié (contenu réel, pas l'extension), ou la raison du refus. */
export function lireAttestation(base64: string): { ok: true; contenu: Buffer } | { ok: false; message: string } {
  const contenu = decoderBase64(base64);
  if (!contenu || contenu.length === 0) return { ok: false, message: "Le fichier n'a pas pu être lu. Réessayez." };
  if (contenu.length > TAILLE_ATTESTATION_MAX) return { ok: false, message: "Attestation trop lourde (2 Mo au plus)." };
  if (typeReel(contenu) !== "application/pdf") return { ok: false, message: "L'attestation doit être un fichier PDF." };
  return { ok: true, contenu };
}

export function chiffrerAttestation(cle: Buffer, ligneId: string, contenu: Buffer) {
  return {
    contenuChiffre: chiffrer(cle, contenu, contexte(ligneId)),
    empreinte: createHash("sha256").update(contenu).digest(),
  };
}

export function dechiffrerAttestation(cle: Buffer, ligneId: string, contenuChiffre: Buffer, empreinte: Buffer): Buffer {
  const contenu = dechiffrer(cle, contenuChiffre, contexte(ligneId));
  if (!createHash("sha256").update(contenu).digest().equals(empreinte)) throw new Error("Empreinte de l'attestation incorrecte");
  return contenu;
}
