// Pièces jointes aux demandes du site : ce qu'un visiteur peut joindre selon l'assurance qui l'intéresse
// (carte grise, attestation actuelle, liste des véhicules, RCCM, photos…), pour que l'agence puisse coter
// sans le rappeler. Le même vocabulaire est repris mot pour mot par le site (apps/site-vitrine/src/donnees/pieces.ts,
// un test vérifie que les deux restent identiques). Chaque pièce est vérifiée (type réel, taille), analysée
// par l'antivirus, puis chiffrée, comme la carte grise de la tâche 7 (piece.ts).

import type { FastifyBaseLogger } from "fastify";
import { ErreurApi } from "../../commun/erreurs.js";
import type { Branche } from "../../commun/schemas.js";
import type { Antivirus } from "../../integrations/antivirus/clamav.js";
import {
  chiffrerPiece, LONGUEUR_BASE64_MAX, TAILLE_PIECE_MAX, TYPE_CLASSEUR, TYPES_PIECE_SITE, verifierPiece, type TypePiece,
} from "./piece.js";

export const NATURES_PIECE = [
  "carte_grise", "attestation_precedente", "liste_vehicules", "carte_transport", "registre_commerce",
  "photos_bien", "devis_travaux", "liste_materiel", "cahier_des_charges", "autre",
] as const;
export type NaturePiece = (typeof NATURES_PIECE)[number];

/** Libellés, pour les noms de fichiers, le journal de sécurité et le back-office */
export const LIBELLES_NATURE: Record<NaturePiece, string> = {
  carte_grise: "Carte grise",
  attestation_precedente: "Attestation ou contrat d'assurance actuel",
  liste_vehicules: "Liste des véhicules",
  carte_transport: "Carte de transport",
  registre_commerce: "Registre de commerce (RCCM) ou patente",
  photos_bien: "Photos du bien, des locaux ou du matériel",
  devis_travaux: "Devis, marché ou permis de construire",
  liste_materiel: "Liste du matériel ou des équipements, avec leur valeur",
  cahier_des_charges: "Cahier des charges ou avis d'appel d'offres",
  autre: "Autre document utile",
};

/** Natures qui acceptent, en plus des photos et des PDF, un classeur Excel (.xlsx) */
export const NATURES_AVEC_CLASSEUR: readonly NaturePiece[] = ["liste_vehicules", "liste_materiel"];

/** Pièces proposées pour une demande de devis, par assurance (la première est la plus utile) */
export const PIECES_PAR_BRANCHE: Record<Branche, readonly NaturePiece[]> = {
  automobile: ["carte_grise", "attestation_precedente", "autre"],
  deux_roues: ["carte_grise", "attestation_precedente", "autre"],
  flotte: ["liste_vehicules", "carte_grise", "attestation_precedente", "autre"],
  transport_marchandises: ["carte_transport", "liste_vehicules", "carte_grise", "attestation_precedente", "autre"],
  habitation: ["photos_bien", "attestation_precedente", "autre"],
  multirisque_professionnelle: ["registre_commerce", "photos_bien", "attestation_precedente", "autre"],
  incendie_risques_divers: ["registre_commerce", "photos_bien", "attestation_precedente", "autre"],
  responsabilite_civile: ["registre_commerce", "attestation_precedente", "autre"],
  individuelle_accident: ["attestation_precedente", "autre"],
  chantier_construction: ["devis_travaux", "registre_commerce", "autre"],
  industrie_bris_de_machines: ["liste_materiel", "photos_bien", "registre_commerce", "autre"],
  agricole: ["liste_materiel", "photos_bien", "autre"],
  evenementiel: ["photos_bien", "autre"],
  autre: ["autre"],
};

/** Rappel d'échéance : l'attestation actuelle donne la date exacte et les garanties à reprendre */
export const PIECES_RAPPEL: readonly NaturePiece[] = ["attestation_precedente"];
/** Appel d'offres : le cahier des charges (clause « assurances »), le parc, l'entreprise et son assureur actuel */
export const PIECES_APPEL_OFFRES: readonly NaturePiece[] = [
  "cahier_des_charges", "liste_vehicules", "registre_commerce", "attestation_precedente", "autre",
];

/** Pièces au plus par demande, et poids total (comme app.pieces_site_max et app.taille_pieces_site_total_max) */
export const PIECES_MAX = 4;
export const TAILLE_PIECES_TOTAL_MAX = 12 * 1024 * 1024;
/**
 * Corps maximal d'une demande : quatre pièces en base64 et les champs du formulaire. Plus large que le poids total
 * permis, pour que le visiteur qui le dépasse reçoive le message explicite plutôt qu'un refus brut (413).
 */
export const TAILLE_CORPS_MAX = PIECES_MAX * LONGUEUR_BASE64_MAX + 32 * 1024;

export interface PieceEnvoyee {
  nature: NaturePiece;
  type: TypePiece;
  /** Contenu en base64 */
  contenu: string;
}

export interface PiecePrete {
  id: string;
  nature: NaturePiece;
  type: TypePiece;
  taille: number;
  contenuChiffre: Buffer;
  empreinte: Buffer;
  /** Déclarée saine par l'antivirus à la réception (sinon : à analyser plus tard) */
  saine: boolean;
}

/** Schéma JSON du tableau « pieces » d'une demande du site */
export function schemaPieces(longueurBase64Max: number) {
  return {
    type: "array",
    maxItems: PIECES_MAX,
    items: {
      type: "object",
      required: ["nature", "type", "contenu"],
      additionalProperties: false,
      properties: {
        nature: { type: "string", enum: NATURES_PIECE },
        type: { type: "string", enum: TYPES_PIECE_SITE },
        contenu: { type: "string", minLength: 4, maxLength: longueurBase64Max },
      },
    },
  } as const;
}

/** « liste-des-vehicules », pour un nom de fichier */
export function slugNature(nature: NaturePiece): string {
  return LIBELLES_NATURE[nature]
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const MESSAGES_REFUS = {
  illisible: "n'a pas pu être lu(e). Envoyez une photo (JPEG ou PNG) ou un PDF.",
  trop_volumineuse: `dépasse ${TAILLE_PIECE_MAX / 1024 / 1024} Mo. Envoyez une photo moins lourde.`,
  type_refuse: "doit être une photo (JPEG ou PNG) ou un PDF.",
  classeur_illisible: "n'est pas un classeur Excel lisible : enregistrez-le au format .xlsx, sans macro ni mot de passe.",
} as const;

/**
 * Vérifie, analyse et chiffre les pièces d'une demande : natures permises pour cette demande, type réel du
 * fichier, taille, nombre et poids total ; une pièce infectée fait refuser l'envoi ; antivirus muet, la pièce
 * est gardée « à analyser » (reprise par la maintenance). Rend les pièces prêtes pour la base.
 */
export async function preparerPieces(
  pieces: PieceEnvoyee[] | undefined,
  naturesPermises: readonly NaturePiece[],
  options: { antivirus: Antivirus; cleChiffrement: Buffer; journal: Pick<FastifyBaseLogger, "warn"> },
): Promise<PiecePrete[]> {
  if (!pieces || pieces.length === 0) return [];
  if (pieces.length > PIECES_MAX) {
    throw new ErreurApi(422, "trop_de_pieces", `${PIECES_MAX} documents au plus par demande.`);
  }
  const pretes: PiecePrete[] = [];
  let total = 0;
  for (const piece of pieces) {
    const libelle = LIBELLES_NATURE[piece.nature];
    if (!naturesPermises.includes(piece.nature)) {
      throw new ErreurApi(422, "piece_inattendue", `« ${libelle} » ne se joint pas à ce type de demande.`);
    }
    if (piece.type === TYPE_CLASSEUR && !NATURES_AVEC_CLASSEUR.includes(piece.nature)) {
      throw new ErreurApi(422, "piece_invalide", `« ${libelle} » doit être une photo (JPEG ou PNG) ou un PDF.`);
    }
    const verifiee = verifierPiece(piece.type, piece.contenu);
    if (!verifiee.ok) throw new ErreurApi(422, "piece_invalide", `« ${libelle} » ${MESSAGES_REFUS[verifiee.raison]}`);
    total += verifiee.contenu.length;
    if (total > TAILLE_PIECES_TOTAL_MAX) {
      throw new ErreurApi(422, "pieces_trop_volumineuses",
        `L'ensemble des documents dépasse ${TAILLE_PIECES_TOTAL_MAX / 1024 / 1024} Mo. Envoyez des photos moins lourdes, ou moins de documents.`);
    }
    const verdict = await options.antivirus.analyser(verifiee.contenu);
    if (verdict.etat === "infectee") {
      options.journal.warn({ signature: verdict.signature, nature: piece.nature }, "pièce d'une demande du site refusée par l'antivirus");
      throw new ErreurApi(422, "piece_infectee",
        `« ${libelle} » a été refusé(e) par notre antivirus. Envoyez un autre fichier, ou envoyez votre demande sans lui.`);
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

/** Les six tableaux attendus par app.enregistrer_demande_site et consœurs (null s'il n'y a aucune pièce) */
export function tableauxPourLaBase(pieces: PiecePrete[]): [string[] | null, string[] | null, string[] | null, number[] | null, Buffer[] | null, Buffer[] | null] {
  if (pieces.length === 0) return [null, null, null, null, null, null];
  return [
    pieces.map((p) => p.id), pieces.map((p) => p.nature), pieces.map((p) => p.type),
    pieces.map((p) => p.taille), pieces.map((p) => p.contenuChiffre), pieces.map((p) => p.empreinte),
  ];
}
