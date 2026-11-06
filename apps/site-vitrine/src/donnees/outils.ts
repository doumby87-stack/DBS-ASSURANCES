// Outils du site (tâche 13) : rappel d'échéance gratuit, assistant « appel d'offres », prise de rendez-vous.
// Sans l'adresse de l'API (URL_API, voir formulaire.ts), chaque outil prépare un message WhatsApp ou e-mail,
// comme le formulaire de devis ; avec elle, la demande est enregistrée par l'agence.
// Les identifiants (garanties, motifs, modes…) sont ceux de l'API : apps/api/src/modules/demandes-site/outils-site.ts.

import { adresseApi } from "./formulaire";

export const ADRESSE_RAPPELS = adresseApi("/site/rappels-echeance");
export const ADRESSE_APPELS_OFFRES = adresseApi("/site/appels-offres");
export const ADRESSE_RENDEZ_VOUS = adresseApi("/site/rendez-vous");

/** Texte de la case du rappel, enregistré tel quel avec la demande (preuve de l'accord) */
export const ACCORD_RAPPEL =
  "J'accepte que DBS-ASSURANCES garde ces informations jusqu'à mon échéance, pour me rappeler et me proposer un devis.";

/** Le rappel arrive à l'agence ce nombre de jours avant l'échéance (comme app.rappel_echeance_avance) */
export const AVANCE_RAPPEL_JOURS = 30;

/** Assurances proposées pour un rappel : celles qui se renouvellent chaque année */
export const ASSURANCES_RAPPEL = [
  { id: "automobile", titre: "Automobile" },
  { id: "deux_roues", titre: "Moto et deux-roues" },
  { id: "habitation", titre: "Habitation" },
  { id: "multirisque_professionnelle", titre: "Multirisque professionnelle" },
  { id: "flotte", titre: "Flotte de véhicules" },
  { id: "responsabilite_civile", titre: "Responsabilité civile" },
  { id: "individuelle_accident", titre: "Individuelle accident" },
  { id: "autre", titre: "Autre assurance" },
] as const;

/**
 * Délai conseillé pour envoyer le dossier d'un appel d'offres à l'agence, en jours ouvrés avant la date limite de
 * dépôt : le temps d'étudier le cahier des charges, d'obtenir la proposition de SanlamAllianz et d'établir
 * l'attestation. À confirmer avec la compagnie ; un seul endroit à modifier.
 */
export const DELAI_DOSSIER_APPEL_OFFRES = 10;

export const TYPES_MARCHE = [
  { id: "travaux", titre: "Travaux (bâtiment, voirie, génie civil…)" },
  { id: "fournitures", titre: "Fournitures (livraison de matériel, de denrées…)" },
  { id: "services", titre: "Services (gardiennage, nettoyage, transport…)" },
  { id: "prestations_intellectuelles", titre: "Prestations intellectuelles (études, conseil…)" },
] as const;

/** Assurances qu'un cahier des charges exige souvent, et ce qu'il faut préparer pour chacune */
export const GARANTIES_APPEL_OFFRES = [
  {
    id: "trc", titre: "Tous risques chantier (TRC)",
    aide: "Dommages à l'ouvrage en cours de construction et responsabilité pendant le chantier.",
    aPreparer: ["Montant et nature des travaux", "Planning et lieu du chantier", "Nom du maître d'ouvrage"],
  },
  {
    id: "decennale", titre: "Responsabilité civile décennale",
    aide: "Dix ans de garantie après la réception de l'ouvrage.",
    aPreparer: ["Nature de l'ouvrage et procédés de construction", "Qualifications et références de l'entreprise"],
  },
  {
    id: "rc_pro", titre: "Responsabilité civile professionnelle ou d'exploitation",
    aide: "Dommages causés à d'autres pendant l'exécution du marché.",
    aPreparer: ["Activité et chiffre d'affaires", "Effectif", "Sinistres des trois dernières années"],
  },
  {
    id: "flotte", titre: "Véhicules et engins affectés au marché",
    aide: "Responsabilité civile automobile et garanties des véhicules utilisés.",
    aPreparer: ["Liste des véhicules : immatriculation, usage, valeur", "Cartes grises"],
  },
  {
    id: "engins", titre: "Bris de machines et engins",
    aide: "Pannes et casses accidentelles des machines et engins de chantier.",
    aPreparer: ["Liste des machines ou engins, avec valeur et année"],
  },
  {
    id: "transport", titre: "Transport des fournitures ou marchandises",
    aide: "Pertes et dommages pendant le transport.",
    aPreparer: ["Nature et valeur des marchandises", "Trajets et moyens de transport"],
  },
  {
    id: "personnel", titre: "Individuelle accident du personnel",
    aide: "Indemnités en cas d'accident des personnes affectées au marché.",
    aPreparer: ["Effectif et fonctions", "Capitaux souhaités"],
  },
  {
    id: "a_determiner", titre: "Je ne sais pas encore",
    aide: "Envoyez-nous le cahier des charges : nous repérons les assurances exigées.",
    aPreparer: [],
  },
] as const;

/** À joindre dans tous les cas */
export const DOSSIER_APPEL_OFFRES = [
  "Le dossier d'appel d'offres, en particulier la clause sur les assurances",
  "RCCM et compte contribuable de l'entreprise",
];

export const MOTIFS_RENDEZ_VOUS = [
  { id: "devis", titre: "Un devis" },
  { id: "renouvellement", titre: "Le renouvellement d'un contrat" },
  { id: "sinistre", titre: "Un sinistre" },
  { id: "flotte", titre: "Une flotte de véhicules" },
  { id: "appel_offres", titre: "Un appel d'offres" },
  { id: "autre", titre: "Autre chose" },
] as const;

export const MODES_RENDEZ_VOUS = [
  { id: "agence", titre: "À l'agence, à Yopougon", icone: "immeuble" },
  { id: "telephone", titre: "Par téléphone", icone: "telephone" },
  { id: "chez_le_client", titre: "Dans vos locaux ou sur votre chantier", icone: "boutique" },
] as const;

/** Un rendez-vous se demande de demain à 60 jours, du lundi au vendredi (comme la base) */
export const HORIZON_RENDEZ_VOUS_JOURS = 60;

/** Fêtes à date fixe où l'agence est fermée, comme dans la base (app.ajouter_jours_ouvres) : « MM-JJ » */
export const FETES_FIXES = ["01-01", "05-01", "08-07", "08-15", "11-01", "11-15", "12-25"];
