// Documents joints à une demande de devis du site, selon l'assurance (devis-par-assurance.ts) : carte grise, liste
// des véhicules d'une flotte, attestation actuelle, registre de commerce… Chaque pièce est vérifiée (type reconnu
// d'après son contenu, taille), analysée par l'antivirus, puis chiffrée, comme la carte grise de la tâche 7.
// Un classeur Excel n'est accepté que pour une liste, et seulement s'il se lit comme un vrai .xlsx sans macro.

import type { FastifyBaseLogger } from "fastify";
import { ErreurApi } from "../../commun/erreurs.js";
import type { Branche } from "../../commun/schemas.js";
import { ErreurTableur, lireTableau } from "../../commun/tableur.js";
import type { Antivirus } from "../../integrations/antivirus/clamav.js";
import {
  LIBELLES_NATURE, NATURES_AVEC_CLASSEUR, NATURES_PIECE, PIECES_MAX, PIECES_PAR_BRANCHE, TAILLE_CLASSEUR_MAX,
  TAILLE_PIECE_MAX, TAILLE_PIECES_TOTAL_MAX, TYPE_CLASSEUR, type NaturePiece,
} from "./devis-par-assurance.js";
import { chiffrerPiece, decoderBase64, EXTENSIONS, LONGUEUR_BASE64_MAX, TYPES_PIECE, verifierPiece } from "./piece.js";

export const TYPES_PIECE_SITE = [...TYPES_PIECE, TYPE_CLASSEUR] as const;
export type TypePieceSite = (typeof TYPES_PIECE_SITE)[number];

export const EXTENSIONS_SITE: Record<TypePieceSite, string> = { ...EXTENSIONS, [TYPE_CLASSEUR]: "xlsx" };

/** Corps maximal d'une demande : toutes les pièces permises en base64, et les champs du formulaire */
export const TAILLE_CORPS_MAX = Math.ceil(TAILLE_PIECES_TOTAL_MAX / 3) * 4 + 64 * 1024;

export interface PieceEnvoyee {
  nature: NaturePiece;
  type: TypePieceSite;
  /** Contenu en base64 */
  contenu: string;
}

export interface PiecePrete {
  id: string;
  nature: NaturePiece;
  type: TypePieceSite;
  taille: number;
  contenuChiffre: Buffer;
  empreinte: Buffer;
  /** Déclarée saine par l'antivirus à la réception (sinon : à analyser plus tard, par la maintenance) */
  saine: boolean;
}

export const schemaPieces = {
  type: "array",
  maxItems: PIECES_MAX,
  items: {
    type: "object",
    required: ["nature", "type", "contenu"],
    additionalProperties: false,
    properties: {
      nature: { type: "string", enum: NATURES_PIECE },
      type: { type: "string", enum: TYPES_PIECE_SITE },
      contenu: { type: "string", minLength: 4, maxLength: LONGUEUR_BASE64_MAX },
    },
  },
} as const;

export function piecesPermises(branche: Branche): readonly NaturePiece[] {
  return PIECES_PAR_BRANCHE[branche] ?? [];
}

type Verification =
  | { ok: true; contenu: Buffer; type: TypePieceSite }
  | { ok: false; message: string };

/** Un classeur Excel (.xlsx) lisible, sans macro, de 2 Mo au plus */
function verifierClasseur(base64: string): Verification {
  const contenu = decoderBase64(base64);
  if (!contenu || contenu.length === 0) return { ok: false, message: "n'a pas pu être lu." };
  if (contenu.length > TAILLE_CLASSEUR_MAX) return { ok: false, message: "dépasse 2 Mo : enregistrez la liste en PDF, ou découpez-la." };
  if (contenu.includes("vbaProject.bin")) return { ok: false, message: "contient des macros : enregistrez-le en « Classeur Excel (.xlsx) »." };
  try {
    if (lireTableau(contenu).format !== "xlsx") throw new ErreurTableur("pas un classeur");
  } catch {
    return { ok: false, message: "n'est pas un classeur Excel lisible : enregistrez-le au format .xlsx, ou envoyez une photo ou un PDF." };
  }
  return { ok: true, contenu, type: TYPE_CLASSEUR };
}

function verifierPieceSite(piece: PieceEnvoyee): Verification {
  if (piece.type === TYPE_CLASSEUR) {
    if (!NATURES_AVEC_CLASSEUR.includes(piece.nature)) return { ok: false, message: "doit être une photo (JPEG ou PNG) ou un PDF." };
    return verifierClasseur(piece.contenu);
  }
  const verifiee = verifierPiece(piece.type, piece.contenu);
  if (verifiee.ok) return verifiee;
  return {
    ok: false,
    message: {
      illisible: "n'a pas pu être lu. Envoyez une photo (JPEG ou PNG) ou un PDF.",
      trop_volumineuse: `dépasse ${TAILLE_PIECE_MAX / 1024 / 1024} Mo : envoyez une photo moins lourde.`,
      type_refuse: NATURES_AVEC_CLASSEUR.includes(piece.nature)
        ? "doit être une photo (JPEG ou PNG), un PDF ou un classeur Excel (.xlsx)."
        : "doit être une photo (JPEG ou PNG) ou un PDF.",
    }[verifiee.raison],
  };
}

/**
 * Vérifie, analyse et chiffre les pièces d'une demande de devis : documents proposés pour cette assurance, type réel,
 * taille, nombre et poids total. Une pièce infectée fait refuser l'envoi ; si l'antivirus ne répond pas, elle est
 * gardée « à analyser ». Rend les pièces prêtes pour la base, dans l'ordre d'envoi.
 */
export async function preparerPieces(
  pieces: PieceEnvoyee[],
  branche: Branche,
  options: { antivirus: Antivirus; cleChiffrement: Buffer; journal: Pick<FastifyBaseLogger, "warn"> },
): Promise<PiecePrete[]> {
  if (pieces.length > PIECES_MAX) throw new ErreurApi(422, "trop_de_pieces", `${PIECES_MAX} documents au plus par demande.`);
  const permises = piecesPermises(branche);
  const pretes: PiecePrete[] = [];
  let total = 0;
  for (const piece of pieces) {
    const libelle = LIBELLES_NATURE[piece.nature];
    if (!permises.includes(piece.nature)) {
      throw new ErreurApi(422, "piece_inattendue", `« ${libelle} » ne se joint pas à une demande pour cette assurance.`);
    }
    const verifiee = verifierPieceSite(piece);
    if (!verifiee.ok) throw new ErreurApi(422, "piece_invalide", `« ${libelle} » ${verifiee.message}`);
    total += verifiee.contenu.length;
    if (total > TAILLE_PIECES_TOTAL_MAX) {
      throw new ErreurApi(422, "pieces_trop_volumineuses",
        `Vos documents dépassent ensemble ${TAILLE_PIECES_TOTAL_MAX / 1024 / 1024} Mo : envoyez des photos moins lourdes, ou moins de documents.`);
    }
    const verdict = await options.antivirus.analyser(verifiee.contenu);
    if (verdict.etat === "infectee") {
      options.journal.warn({ signature: verdict.signature, nature: piece.nature }, "pièce d'une demande du site refusée par l'antivirus");
      throw new ErreurApi(422, "piece_infectee",
        `« ${libelle} » a été refusé par notre antivirus. Envoyez un autre fichier, ou envoyez votre demande sans lui.`);
    }
    if (verdict.etat === "indisponible") {
      options.journal.warn({ raison: verdict.raison, nature: piece.nature }, "pièce d'une demande du site gardée en attente d'analyse antivirus");
    }
    pretes.push({
      ...chiffrerPiece(options.cleChiffrement, verifiee.contenu),
      nature: piece.nature, type: verifiee.type, taille: verifiee.contenu.length, saine: verdict.etat === "saine",
    });
  }
  return pretes;
}

/** Les six tableaux de app.enregistrer_demande_site (null s'il n'y a aucune pièce) */
export function tableauxPourLaBase(pieces: PiecePrete[]) {
  if (pieces.length === 0) return [null, null, null, null, null, null] as const;
  return [
    pieces.map((p) => p.id), pieces.map((p) => p.nature), pieces.map((p) => p.type),
    pieces.map((p) => p.taille), pieces.map((p) => p.contenuChiffre), pieces.map((p) => p.empreinte),
  ] as const;
}

/** « liste-des-vehicules » : pour le nom d'un fichier téléchargé */
export function slugNature(nature: string): string {
  const libelle = LIBELLES_NATURE[nature as NaturePiece] ?? nature;
  return libelle.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
