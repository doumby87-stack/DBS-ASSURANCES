// Coordonnées et identité de l'agence : le SEUL endroit à modifier quand une information change
// (téléphone, e-mail, adresse, horaires…). Toutes les pages du site les reprennent d'ici.

export const AGENCE = {
  nom: "DBS-ASSURANCES",
  raisonSociale: "DOUM BUSINESS SERVICES-ASSURANCES",
  qualite: "Agent Général SanlamAllianz Côte d'Ivoire",
  codeAgence: "2623",
  compagnie: "SanlamAllianz Côte d'Ivoire Assurances",

  telephone: {
    /** Tel qu'on l'écrit en Côte d'Ivoire */
    affichage: "07 49 36 07 02",
    international: "+225 07 49 36 07 02",
    /** Format des liens tel: */
    e164: "+2250749360702",
  },
  /** Numéro WhatsApp, sans le + (format des liens wa.me) */
  whatsapp: "2250749360702",
  email: "dbs.conseils1@gmail.com",

  adresse: {
    rue: "Yopougon Palais, Lot 1695, Îlot 124",
    commune: "Yopougon",
    ville: "Abidjan",
    pays: "Côte d'Ivoire",
    boitePostale: "21 BP M 1335 Abidjan 21",
  },
  carte: "https://www.google.com/maps/search/?api=1&query=Yopougon%20Palais%2C%20Lot%201695%2C%20Abidjan",

  /** Horaires d'ouverture, à compléter, par exemple ["Lundi au vendredi : 8 h – 17 h", "Samedi : 9 h – 13 h"] */
  horaires: [] as string[],

  juridique: {
    forme: "SARL unipersonnelle",
    capital: "1 000 000 F CFA",
    siege: "Abidjan Yopougon Palais, Lot 1695, Îlot 124 — 21 BP M 1335 Abidjan 21, Côte d'Ivoire",
    rccm: "CI-ABJ-03-2025-B13-11712",
    compteContribuable: "2506904 P",
    directeurPublication: "DOUMBIA Brahima, Gérant",
    /** N° d'agrément ou de carte professionnelle d'intermédiaire : à compléter avant la mise en ligne */
    agrement: "",
    /** Nom, adresse et téléphone de l'hébergeur du site : à compléter à la mise en ligne */
    hebergeur: "",
  },
} as const;

/** Lien WhatsApp vers l'agence, avec un message déjà rédigé. */
export function lienWhatsApp(message = "Bonjour DBS-ASSURANCES, "): string {
  return `https://wa.me/${AGENCE.whatsapp}?text=${encodeURIComponent(message)}`;
}

export const LIEN_TELEPHONE = `tel:${AGENCE.telephone.e164}`;
export const LIEN_EMAIL = `mailto:${AGENCE.email}`;
