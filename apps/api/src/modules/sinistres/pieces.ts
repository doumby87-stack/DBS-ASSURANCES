// Photos et documents joints à un sinistre déclaré en ligne (constat amiable, photos des dégâts, procès-verbal) :
// même contrôle que les cartes grises du site (type reconnu d'après le contenu, 5 Mo au plus), même chiffrement
// (AES-256-GCM, clé de l'API), avec un contexte propre à chaque pièce.

import { createHash } from "node:crypto";
import { chiffrer, dechiffrer } from "../../securite/chiffrement.js";
import { nomDeFichier } from "../../commun/zip.js";
import { EXTENSIONS, type TypePiece } from "../demandes-site/piece.js";

export { LONGUEUR_BASE64_MAX, TYPES_PIECE, verifierPiece } from "../demandes-site/piece.js";

export const MESSAGES_PIECE_SINISTRE = {
  illisible: "Le fichier n'a pas pu être lu. Réessayez.",
  trop_volumineuse: "Fichier trop lourd (5 Mo au plus). Envoyez une photo moins lourde.",
  type_refuse: "Envoyez une photo (JPEG ou PNG) ou un PDF.",
} as const;

const contexte = (id: string) => `piece-sinistre:${id}`;

export function chiffrerPieceSinistre(cle: Buffer, id: string, contenu: Buffer) {
  return {
    contenuChiffre: chiffrer(cle, contenu, contexte(id)),
    empreinte: createHash("sha256").update(contenu).digest(),
  };
}

export function dechiffrerPieceSinistre(cle: Buffer, id: string, contenuChiffre: Buffer, empreinte: Buffer): Buffer {
  const contenu = dechiffrer(cle, contenuChiffre, contexte(id));
  if (!createHash("sha256").update(contenu).digest().equals(empreinte)) throw new Error("Empreinte de la pièce incorrecte");
  return contenu;
}

/** Nom affiché : celui du fichier envoyé, sans chemin ni caractère de contrôle. */
export function nomAffiche(nom: string): string {
  const propre = nom.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  return propre || "document";
}

/** Nom de téléchargement : sûr pour un en-tête HTTP, avec l'extension du type réel. */
export function nomDeTelechargement(nom: string, type: string): string {
  const base = nomDeFichier(nom.replace(/\.[A-Za-z0-9]{1,5}$/, "")).slice(0, 60);
  return `${base}.${EXTENSIONS[type as TypePiece] ?? "bin"}`;
}
