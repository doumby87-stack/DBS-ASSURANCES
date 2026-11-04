// Les assurances proposées, telles que le site les présente. L'identifiant de chaque offre est celui
// de la branche dans la base de données (app.branche) : une demande de devis arrive déjà classée.
// Toutes les garanties citées sont souscrites auprès de SanlamAllianz Côte d'Ivoire ; la formule exacte
// est établie au devis.

import type { NomIcone } from "./icones";

export type Public = "particuliers" | "professionnels" | "flottes";

export interface Offre {
  id: string;
  titre: string;
  icone: NomIcone;
  publics: Public[];
  resume: string;
  garanties: string[];
  /** Ce qu'il est utile de préciser pour le devis */
  aPreciser: string;
  /** Documents qui aident à établir le devis */
  documents?: string[];
}

export const OFFRES: Offre[] = [
  {
    id: "automobile",
    titre: "Automobile",
    icone: "voiture",
    publics: ["particuliers", "professionnels"],
    resume: "Voitures et utilitaires : la responsabilité civile obligatoire, puis les garanties de votre choix.",
    garanties: [
      "Responsabilité civile obligatoire (Code CIMA, art. 200)",
      "Vol et incendie",
      "Bris de glace",
      "Dommages au véhicule",
      "Attestation digitale ASACI, vérifiable par QR code",
    ],
    aPreciser: "marque, modèle, année, puissance fiscale (CV), usage (personnel, professionnel, transport…), valeur du véhicule et garanties souhaitées.",
    documents: ["Carte grise du véhicule", "Pièce d'identité du propriétaire"],
  },
  {
    id: "deux_roues",
    titre: "Moto et cyclomoteur",
    icone: "moto",
    publics: ["particuliers", "professionnels"],
    resume: "Motos personnelles ou de livraison : couvertes au minimum en responsabilité civile, et plus si vous le souhaitez.",
    garanties: ["Responsabilité civile obligatoire", "Vol et incendie", "Dommages", "Usage personnel ou professionnel (livraison)"],
    aPreciser: "marque, modèle, cylindrée, usage (personnel ou livraison) et valeur de la moto.",
    documents: ["Carte grise", "Pièce d'identité"],
  },
  {
    id: "habitation",
    titre: "Multirisque habitation",
    icone: "maison",
    publics: ["particuliers"],
    resume: "Propriétaire ou locataire : votre logement et vos biens protégés, avec la responsabilité civile de la famille.",
    garanties: ["Incendie", "Dégâts des eaux", "Vol", "Responsabilité civile de la famille"],
    aPreciser: "propriétaire ou locataire, type de logement (appartement, villa…), nombre de pièces, commune et valeur approximative de vos biens.",
  },
  {
    id: "responsabilite_civile",
    titre: "Responsabilité civile",
    icone: "bouclier",
    publics: ["particuliers", "professionnels"],
    resume: "Les dommages que vous, votre activité ou vos employés pouvez causer à autrui, pris en charge.",
    garanties: ["Responsabilité civile familiale", "Responsabilité civile professionnelle", "Dommages corporels et matériels causés à autrui"],
    aPreciser: "activité concernée, nombre d'employés, chiffre d'affaires approximatif, ou responsabilité civile familiale.",
  },
  {
    id: "individuelle_accident",
    titre: "Individuelle accident",
    icone: "coeur",
    publics: ["particuliers", "professionnels"],
    resume: "Un capital et des frais médicaux en cas d'accident, pour vous, vos proches, vos employés ou vos chauffeurs.",
    garanties: ["Capital en cas d'accident", "Frais médicaux", "Vous, votre famille, vos employés ou vos chauffeurs"],
    aPreciser: "personnes à couvrir (vous, votre famille, vos employés, vos chauffeurs) et capitaux souhaités.",
  },
  {
    id: "multirisque_professionnelle",
    titre: "Multirisque professionnelle",
    icone: "boutique",
    publics: ["professionnels"],
    resume: "Boutique, atelier, bureau ou magasin : vos locaux, votre matériel et vos marchandises dans un même contrat.",
    garanties: ["Locaux", "Matériel et équipements", "Marchandises et stock", "Responsabilité civile de l'activité"],
    aPreciser: "activité, adresse et surface des locaux, valeur du matériel et du stock.",
  },
  {
    id: "incendie_risques_divers",
    titre: "Incendie et risques divers",
    icone: "flamme",
    publics: ["professionnels"],
    resume: "Bâtiments, entrepôts, stocks et équipements protégés contre l'incendie et les événements imprévus.",
    garanties: ["Bâtiments et entrepôts", "Stocks", "Équipements", "Incendie et événements imprévus"],
    aPreciser: "biens à assurer (bâtiment, entrepôt, stock, équipements), adresse et valeurs.",
  },
  {
    id: "transport_marchandises",
    titre: "Transport de marchandises",
    icone: "colis",
    publics: ["professionnels", "flottes"],
    resume: "Vos marchandises couvertes pendant leur acheminement, du chargement à la livraison.",
    garanties: ["Du chargement à la livraison", "Trajets réguliers ou ponctuels"],
    aPreciser: "nature des marchandises, trajets habituels et valeur moyenne transportée.",
  },
  {
    id: "flotte",
    titre: "Flotte et transport routier",
    icone: "camion",
    publics: ["flottes"],
    resume: "Tracteurs, semi-remorques, remorques, véhicules de service et motos de livraison, suivis dans un même dossier.",
    garanties: [
      "Cotation SanlamAllianz de toute la flotte",
      "Une attestation digitale ASACI par véhicule, éditée en lot",
      "Facture détaillée véhicule par véhicule",
      "Échéances suivies et renouvellements anticipés",
    ],
    aPreciser: "nombre et types de véhicules (tracteurs, semi-remorques, remorques, motos…), usage et zones de circulation. Vous pourrez ensuite nous envoyer la liste complète en fichier Excel.",
    documents: ["Liste des véhicules (un fichier Excel suffit)", "Cartes grises"],
  },
  {
    id: "chantier_construction",
    titre: "Chantier et construction",
    icone: "chantier",
    publics: ["professionnels"],
    resume: "Pour vos chantiers et vos appels d'offres : des garanties étudiées sur questionnaire par SanlamAllianz.",
    garanties: [
      "Tous risques chantier, bâtiment et routes",
      "Tous risques montage-essais",
      "Garantie décennale",
      "Responsabilité civile des entreprises de travaux",
      "Responsabilité civile des bureaux d'études et d'ingénierie",
    ],
    aPreciser: "nature et montant des travaux, maître d'ouvrage, lieu et durée du chantier, garanties demandées dans l'appel d'offres.",
  },
  {
    id: "industrie_bris_de_machines",
    titre: "Industrie, PME/PMI et bris de machines",
    icone: "usine",
    publics: ["professionnels"],
    resume: "Locaux, machines et responsabilités de votre entreprise, étudiés sur questionnaire.",
    garanties: [
      "Multirisque professionnelle et PME / PMI",
      "Multirisque protection immobilière",
      "Bris de machines",
      "Responsabilité civile des entreprises industrielles et commerciales",
      "Globale de banque, contre le vol et la fraude",
    ],
    aPreciser: "activité, adresse et surface des locaux, valeur des bâtiments, des machines et du stock.",
  },
  {
    id: "agricole",
    titre: "Assurance agricole",
    icone: "pousse",
    publics: ["professionnels"],
    resume: "Assurance des plantations, étudiée selon le type de culture, la superficie et la localisation de l'exploitation.",
    garanties: ["Plantations", "Étude selon la culture, la superficie et la localisation"],
    aPreciser: "type de culture, superficie en hectares et localisation de la plantation.",
  },
  {
    id: "evenementiel",
    titre: "Événementiel",
    icone: "billet",
    publics: ["professionnels"],
    resume: "Responsabilité civile de l'organisateur de concerts, salons, cérémonies ou compétitions.",
    garanties: ["Responsabilité civile de l'organisateur", "Selon l'activité et le nombre de participants"],
    aPreciser: "type d'événement, date, lieu et nombre de participants attendus.",
  },
];

/** Choix « autre » du formulaire de devis */
export const AUTRE_BESOIN = {
  id: "autre",
  titre: "Autre besoin",
  aPreciser: "décrivez votre situation, nous vous orientons vers la bonne solution.",
} as const;

export function offresPour(publicVise: Public): Offre[] {
  return OFFRES.filter((o) => o.publics.includes(publicVise));
}

export function lienDevis(idOffre?: string): string {
  return idOffre ? `/devis/?assurance=${idOffre}` : "/devis/";
}
