// Pièce jointe d'une demande du site (carte grise) : décodage strict, type reconnu d'après le contenu du
// fichier (jamais d'après son nom ni le type annoncé par le navigateur), chiffrement avant la base.

import { createHash, randomUUID } from "node:crypto";
import { chiffrer, dechiffrer } from "../../securite/chiffrement.js";

export const TYPES_PIECE = ["image/jpeg", "image/png", "application/pdf"] as const;
export type TypePiece = (typeof TYPES_PIECE)[number];

/** 5 Mo, comme app.taille_piece_site_max() */
export const TAILLE_PIECE_MAX = 5 * 1024 * 1024;
/** Longueur maximale du texte base64 correspondant */
export const LONGUEUR_BASE64_MAX = Math.ceil(TAILLE_PIECE_MAX / 3) * 4;

export const EXTENSIONS: Record<TypePiece, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Type réel du fichier d'après ses premiers octets, ou null s'il n'est ni JPEG, ni PNG, ni PDF. */
export function typeReel(contenu: Buffer): TypePiece | null {
  if (contenu.length >= 3 && contenu[0] === 0xff && contenu[1] === 0xd8 && contenu[2] === 0xff) return "image/jpeg";
  if (contenu.length >= 8 && contenu.subarray(0, 8).equals(SIGNATURE_PNG)) return "image/png";
  if (contenu.length >= 5 && contenu.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

/** Base64 standard, complet et sans caractère parasite ; sinon null (Node ignorerait les caractères invalides). */
export function decoderBase64(texte: string): Buffer | null {
  if (texte.length === 0 || texte.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(texte)) return null;
  return Buffer.from(texte, "base64");
}

export type ResultatPiece =
  | { ok: true; contenu: Buffer; type: TypePiece }
  | { ok: false; raison: "illisible" | "trop_volumineuse" | "type_refuse" };

/** Vérifie la pièce envoyée : décodable, pas trop lourde, et du type annoncé. */
export function verifierPiece(typeAnnonce: TypePiece, base64: string): ResultatPiece {
  const contenu = decoderBase64(base64);
  if (!contenu || contenu.length === 0) return { ok: false, raison: "illisible" };
  if (contenu.length > TAILLE_PIECE_MAX) return { ok: false, raison: "trop_volumineuse" };
  const type = typeReel(contenu);
  if (!type || type !== typeAnnonce) return { ok: false, raison: "type_refuse" };
  return { ok: true, contenu, type };
}

/** Contexte de chiffrement : un contenu recopié d'une pièce sur une autre devient indéchiffrable. */
const contexte = (id: string) => `piece-site:${id}`;

export function chiffrerPiece(cle: Buffer, contenu: Buffer) {
  const id = randomUUID();
  return {
    id,
    contenuChiffre: chiffrer(cle, contenu, contexte(id)),
    empreinte: createHash("sha256").update(contenu).digest(),
  };
}

/** Déchiffre et contrôle l'empreinte : lève une erreur si la pièce a été altérée. */
export function dechiffrerPiece(cle: Buffer, id: string, contenuChiffre: Buffer, empreinte: Buffer): Buffer {
  const contenu = dechiffrer(cle, contenuChiffre, contexte(id));
  if (!createHash("sha256").update(contenu).digest().equals(empreinte)) throw new Error("Empreinte de la pièce incorrecte");
  return contenu;
}
