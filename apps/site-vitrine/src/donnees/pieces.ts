// Pièces à joindre aux demandes du site (devis, rappel d'échéance, appel d'offres) : ce que le visiteur peut
// envoyer pour que l'agence puisse coter sans le rappeler. Ce vocabulaire est celui de l'API
// (apps/api/src/modules/demandes-site/pieces-site.ts) : un test de l'API vérifie que les deux restent identiques.
// Fichier sans dépendance : il est lu par les pages Astro, par le script du navigateur et par ce test.

export const NATURES_PIECE = [
  "carte_grise", "attestation_precedente", "liste_vehicules", "carte_transport", "registre_commerce",
  "photos_bien", "devis_travaux", "liste_materiel", "cahier_des_charges", "autre",
] as const;
export type NaturePiece = (typeof NATURES_PIECE)[number];

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

/** Pourquoi chaque document aide : affiché sous le champ */
export const AIDES_NATURE: Record<NaturePiece, string> = {
  carte_grise: "Une photo nette ou un PDF : marque, puissance et date de mise en circulation y sont.",
  attestation_precedente: "Nous y lisons vos garanties actuelles et votre échéance, pour comparer à prime égale.",
  liste_vehicules: "Un tableau Excel (.xlsx), une photo ou un PDF : immatriculation, marque, type et usage de chaque véhicule.",
  carte_transport: "Votre carte de transporteur ou votre agrément : la nature des marchandises et les trajets.",
  registre_commerce: "L'activité exacte et la raison sociale, telles qu'elles figureront sur le contrat.",
  photos_bien: "Quelques photos de l'intérieur et de l'extérieur : le type de construction et les biens à couvrir.",
  devis_travaux: "Le montant et la durée des travaux fixent la prime du chantier.",
  liste_materiel: "Un tableau Excel (.xlsx), une photo ou un PDF : chaque machine, son année et sa valeur.",
  cahier_des_charges: "La clause « assurances » dit exactement ce que le maître d'ouvrage exige.",
  autre: "Tout ce qui vous semble utile : ancien devis, procès-verbal d'expertise, plan…",
};

/** Natures qui acceptent, en plus des photos et des PDF, un classeur Excel (.xlsx) */
export const NATURES_AVEC_CLASSEUR: readonly NaturePiece[] = ["liste_vehicules", "liste_materiel"];

/** Pièces proposées pour une demande de devis, par assurance (la première est la plus utile) */
export const PIECES_PAR_BRANCHE: Record<string, readonly NaturePiece[]> = {
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

/** Limites de l'API : 4 pièces au plus, 5 Mo chacune, 12 Mo en tout */
export const PIECES_MAX = 4;
export const TAILLE_PIECE_MAX = 5 * 1024 * 1024;
export const TAILLE_PIECES_TOTAL_MAX = 12 * 1024 * 1024;

export const TYPE_CLASSEUR = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Type envoyé à l'API d'après le type ou l'extension du fichier choisi (l'API vérifie ensuite le contenu) */
export const TYPES_FICHIER: Record<string, string> = {
  "image/jpeg": "image/jpeg", "image/png": "image/png", "application/pdf": "application/pdf", [TYPE_CLASSEUR]: TYPE_CLASSEUR,
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf", xlsx: TYPE_CLASSEUR,
};

/** Attribut « accept » du champ de fichier d'une nature */
export function formatsAcceptes(nature: NaturePiece): string {
  const base = "image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf";
  return NATURES_AVEC_CLASSEUR.includes(nature) ? `${base},${TYPE_CLASSEUR},.xlsx` : base;
}
