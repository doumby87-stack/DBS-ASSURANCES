// Demande de devis du site : les questions et les documents propres à chaque assurance.
//
// Ce fichier existe en deux exemplaires identiques, octet pour octet : l'un est lu par le site pour construire le
// formulaire (apps/site-vitrine/src/donnees/devis-par-assurance.ts), l'autre par l'API qui contrôle ce qu'elle
// reçoit (apps/api/src/modules/demandes-site/devis-par-assurance.ts). Un test de l'API vérifie qu'ils le restent :
// modifiez l'un, puis recopiez-le sur l'autre. Données seules, sans dépendance.

/**
 * Condition d'une question : elle n'est posée que si la réponse à une question précédente (un choix ou des cases
 * cochées) contient l'une de ces valeurs. Exemple : le loyer mensuel, seulement pour un locataire.
 */
export interface Condition { cle: string; valeurs: readonly string[] }

/** Une question du formulaire. La clé est celle de la réponse enregistrée avec la demande. */
export type Question = (
  | { cle: string; libelle: string; type: "texte"; max: number; exemple?: string; obligatoire?: boolean }
  | { cle: string; libelle: string; type: "nombre"; min: number; max: number; unite?: string; obligatoire?: boolean }
  | { cle: string; libelle: string; type: "date"; obligatoire?: boolean }
  | { cle: string; libelle: string; type: "choix"; options: Record<string, string>; obligatoire?: boolean }
  | { cle: string; libelle: string; type: "plusieurs"; options: Record<string, string>; obligatoire?: boolean }
) & { si?: Condition };

/** La question est-elle posée, au vu des réponses déjà données ? (toujours, si elle n'a pas de condition) */
export function questionPosee(q: Question, reponses: Readonly<Record<string, unknown>>): boolean {
  if (!q.si) return true;
  const { valeurs } = q.si;
  const reponse = reponses[q.si.cle];
  return (Array.isArray(reponse) ? reponse : [reponse]).some((v) => typeof v === "string" && valeurs.includes(v));
}

const MONTANT_MAX = 100_000_000_000;

const GARANTIES_VEHICULE: Question = {
  cle: "garanties", libelle: "Garanties souhaitées", type: "choix", options: {
    rc: "Responsabilité civile seule (le minimum obligatoire)",
    rc_vol_incendie: "Responsabilité civile, vol et incendie",
    tous_risques: "Tous risques",
    conseil: "Je souhaite être conseillé",
  },
};
const ASSUREUR_ACTUEL: Question = { cle: "assureurActuel", libelle: "Assureur actuel", type: "texte", max: 80, exemple: "Aucun, ou le nom de l'assureur" };
const ECHEANCE_ACTUELLE: Question = { cle: "echeanceActuelle", libelle: "Échéance du contrat actuel", type: "date" };
const OUI_NON = { oui: "Oui", non: "Non" };
const CONSEIL = "Je ne sais pas, conseillez-moi";

/** Questions posées pour chaque assurance (identifiants des branches de la base) */
export const QUESTIONNAIRES: Record<string, readonly Question[]> = {
  automobile: [
    { cle: "marqueModele", libelle: "Marque et modèle", type: "texte", max: 80, exemple: "Toyota Corolla" },
    { cle: "annee", libelle: "Année de première mise en circulation", type: "nombre", min: 1950, max: 2100 },
    { cle: "puissance", libelle: "Puissance fiscale", type: "nombre", min: 1, max: 200, unite: "CV" },
    { cle: "energie", libelle: "Énergie", type: "choix", options: { essence: "Essence", gasoil: "Gasoil", hybride_electrique: "Hybride ou électrique" } },
    { cle: "usage", libelle: "Usage", type: "choix", options: {
      personnel: "Personnel (promenade, trajets)", professionnel: "Professionnel (déplacements pour le travail)",
      taxi_vtc: "Taxi ou VTC", marchandises: "Transport de marchandises",
    } },
    { cle: "valeur", libelle: "Valeur actuelle du véhicule", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    GARANTIES_VEHICULE,
    ASSUREUR_ACTUEL,
    ECHEANCE_ACTUELLE,
  ],
  deux_roues: [
    { cle: "marqueModele", libelle: "Marque et modèle", type: "texte", max: 80, exemple: "Yamaha Crypton" },
    { cle: "cylindree", libelle: "Cylindrée", type: "nombre", min: 1, max: 3000, unite: "cm³" },
    { cle: "usage", libelle: "Usage", type: "choix", options: { personnel: "Personnel", livraison: "Livraison", taxi_moto: "Taxi-moto" } },
    { cle: "valeur", libelle: "Valeur actuelle de la moto", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    GARANTIES_VEHICULE,
  ],
  flotte: [
    { cle: "nombreVehicules", libelle: "Nombre de véhicules", type: "nombre", min: 2, max: 5000, obligatoire: true },
    { cle: "typesVehicules", libelle: "Types de véhicules", type: "plusieurs", obligatoire: true, options: {
      voitures: "Voitures et véhicules de service", utilitaires: "Camionnettes et pick-up", camions: "Camions porteurs",
      tracteurs: "Tracteurs routiers", remorques: "Semi-remorques et remorques", cars: "Cars, minicars et gbakas",
      taxis: "Taxis", deux_roues: "Motos et tricycles",
    } },
    { cle: "usage", libelle: "Usage principal", type: "choix", options: {
      propre_compte: "Transport pour votre propre compte", compte_autrui: "Transport pour le compte d'autrui (transporteur)",
      personnes: "Transport de personnes", service: "Véhicules de service ou de fonction",
    } },
    { cle: "zones", libelle: "Zones de circulation", type: "plusieurs", options: {
      abidjan: "Abidjan", interieur: "Intérieur du pays", international: "Pays voisins (CEDEAO)",
    } },
    GARANTIES_VEHICULE,
    { cle: "chauffeurs", libelle: "Couvrir aussi les chauffeurs (individuelle accident)", type: "choix", options: { oui: "Oui", non: "Non" } },
    ASSUREUR_ACTUEL,
    ECHEANCE_ACTUELLE,
  ],
  habitation: [
    { cle: "statut", libelle: "Vous êtes", type: "choix", options: { proprietaire: "Propriétaire", locataire: "Locataire" } },
    { cle: "logement", libelle: "Type de logement", type: "choix", options: {
      appartement: "Appartement", villa: "Villa", maison_basse: "Maison basse ou cour commune",
    } },
    { cle: "pieces", libelle: "Nombre de pièces", type: "nombre", min: 1, max: 100 },
    { cle: "valeurBiens", libelle: "Valeur de vos biens (meubles, appareils, vêtements…)", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "valeurLogement", libelle: "Valeur du logement, si vous êtes propriétaire", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
  ],
  multirisque_professionnelle: [
    { cle: "activite", libelle: "Activité", type: "texte", max: 120, exemple: "Boutique de vêtements, pharmacie, atelier…", obligatoire: true },
    { cle: "statutLocaux", libelle: "Vos locaux", type: "choix", options: { proprietaire: "Vous en êtes propriétaire", locataire: "Vous êtes locataire" } },
    { cle: "loyerMensuel", libelle: "Loyer mensuel", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA", si: { cle: "statutLocaux", valeurs: ["locataire"] } },
    { cle: "valeurBatiment", libelle: "Valeur du bâtiment", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA", si: { cle: "statutLocaux", valeurs: ["proprietaire"] } },
    { cle: "surface", libelle: "Surface des locaux", type: "nombre", min: 1, max: 1_000_000, unite: "m²" },
    { cle: "valeurMateriel", libelle: "Valeur du matériel et des équipements (mobilier, informatique compris)", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "valeurStock", libelle: "Valeur du stock de marchandises", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "chiffreAffaires", libelle: "Chiffre d'affaires annuel", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "employes", libelle: "Nombre d'employés", type: "nombre", min: 0, max: 100_000 },
    { cle: "garantiesOptionnelles", libelle: "Garanties à ajouter", type: "plusieurs", options: {
      vol: "Vol des marchandises et du matériel", especes: "Vol des espèces (caisse, coffre-fort, trajet vers la banque)",
      bris_glaces: "Bris de glaces", degats_eaux: "Dégâts des eaux", dommages_electriques: "Dommages électriques",
      informatique: "Tous risques informatique", bris_machines: "Bris de machines", pertes_exploitation: "Pertes d'exploitation",
      rc_exploitation: "Responsabilité civile d'exploitation",
    } },
    ASSUREUR_ACTUEL,
    ECHEANCE_ACTUELLE,
  ],
  incendie_risques_divers: [
    { cle: "biens", libelle: "Biens à assurer", type: "plusieurs", obligatoire: true, options: {
      batiments: "Bâtiments", entrepots: "Entrepôts", stocks: "Stocks", equipements: "Équipements",
    } },
    { cle: "activite", libelle: "Activité", type: "texte", max: 120 },
    { cle: "valeurBatiments", libelle: "Valeur des bâtiments", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "valeurContenu", libelle: "Valeur des stocks et des équipements", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "violencePolitique", libelle: "Couvrir aussi les émeutes, le terrorisme et la violence politique", type: "choix", options: { ...OUI_NON, conseil: CONSEIL } },
    ASSUREUR_ACTUEL,
    ECHEANCE_ACTUELLE,
  ],
  responsabilite_civile: [
    { cle: "type", libelle: "Responsabilité civile", type: "choix", obligatoire: true, options: {
      familiale: "Familiale (vous et votre famille)", professionnelle: "Professionnelle (votre activité)",
    } },
    { cle: "typesProfessionnelle", libelle: "Ce que vous voulez couvrir", type: "plusieurs", si: { cle: "type", valeurs: ["professionnelle"] }, options: {
      exploitation: "Les dommages causés pendant votre activité (exploitation)",
      apres_livraison: "Les dommages causés après une livraison ou des travaux",
      entreprise_travaux: "Une entreprise du bâtiment ou des travaux publics",
      bureau_etudes: "Un bureau d'études ou d'ingénierie",
      evenement: "L'organisation d'un événement",
      conseil: CONSEIL,
    } },
    { cle: "activite", libelle: "Activité", type: "texte", max: 120, si: { cle: "type", valeurs: ["professionnelle"] } },
    { cle: "employes", libelle: "Nombre d'employés", type: "nombre", min: 0, max: 100_000, si: { cle: "type", valeurs: ["professionnelle"] } },
    { cle: "chiffreAffaires", libelle: "Chiffre d'affaires annuel", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA", si: { cle: "type", valeurs: ["professionnelle"] } },
    { cle: "zone", libelle: "Zone d'activité", type: "choix", si: { cle: "type", valeurs: ["professionnelle"] }, options: {
      cote_ivoire: "Côte d'Ivoire", cedeao: "Côte d'Ivoire et pays de la CEDEAO", monde: "Monde entier, sauf États-Unis et Canada",
    } },
    ASSUREUR_ACTUEL,
    ECHEANCE_ACTUELLE,
  ],
  individuelle_accident: [
    { cle: "personnes", libelle: "Personnes à couvrir", type: "plusieurs", obligatoire: true, options: {
      moi: "Moi-même", famille: "Ma famille", employes: "Mes employés", chauffeurs: "Mes chauffeurs",
    } },
    { cle: "nombrePersonnes", libelle: "Nombre de personnes", type: "nombre", min: 1, max: 100_000 },
    { cle: "capital", libelle: "Capital souhaité par personne", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
  ],
  transport_marchandises: [
    { cle: "marchandises", libelle: "Nature des marchandises", type: "texte", max: 120, exemple: "Cacao, ciment, produits frais…", obligatoire: true },
    { cle: "trajets", libelle: "Trajets", type: "plusieurs", options: {
      abidjan: "Dans Abidjan", interieur: "Vers l'intérieur du pays", international: "Vers les pays voisins", import_export: "Importation ou exportation (mer, air)",
    } },
    { cle: "valeurVoyage", libelle: "Valeur moyenne transportée par voyage", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "voyagesParMois", libelle: "Nombre de voyages par mois", type: "nombre", min: 1, max: 10_000 },
    ASSUREUR_ACTUEL,
    ECHEANCE_ACTUELLE,
  ],
  chantier_construction: [
    { cle: "produits", libelle: "Assurance recherchée", type: "plusieurs", options: {
      trc_batiment: "Tous risques chantier : bâtiment", trc_routes: "Tous risques chantier : routes et ouvrages d'art",
      montage: "Tous risques montage-essais (installation de machines)", decennale: "Garantie décennale",
      rc_travaux: "Responsabilité civile de l'entreprise de travaux", rc_bureau_etudes: "Responsabilité civile du bureau d'études",
      conseil: CONSEIL,
    } },
    { cle: "natureTravaux", libelle: "Nature des travaux", type: "texte", max: 120, exemple: "Immeuble R+4, route bitumée, forage…", obligatoire: true },
    { cle: "typeOuvrage", libelle: "Type d'ouvrage", type: "choix", options: {
      logements: "Logements (immeuble ou maisons)", bureaux_commerces: "Bureaux ou commerces",
      etablissement_public: "Hôpital, école ou bâtiment recevant du public", industriel: "Bâtiment industriel ou agricole",
      route: "Route, pont ou ouvrage d'art", montage: "Montage d'équipements industriels", autre: "Autre",
    } },
    { cle: "construction", libelle: "Travaux", type: "choix", options: { neuf: "Construction neuve", rehabilitation: "Réhabilitation, extension ou rénovation" } },
    { cle: "montantTravaux", libelle: "Montant des travaux", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "dateDebut", libelle: "Date d'ouverture du chantier", type: "date" },
    { cle: "dureeMois", libelle: "Durée du chantier", type: "nombre", min: 1, max: 240, unite: "mois" },
    { cle: "etages", libelle: "Nombre d'étages au-dessus du rez-de-chaussée", type: "nombre", min: 0, max: 200 },
    { cle: "bureauControle", libelle: "Bureau de contrôle désigné", type: "choix", options: OUI_NON },
    { cle: "milieuUrbain", libelle: "Chantier en ville, au milieu d'autres constructions", type: "choix", options: OUI_NON },
    { cle: "maitreOuvrage", libelle: "Maître d'ouvrage", type: "texte", max: 120 },
    { cle: "lieu", libelle: "Lieu du chantier", type: "texte", max: 120 },
    // Les deux responsabilités civiles portent sur l'entreprise, pas sur un chantier
    { cle: "chiffreAffaires", libelle: "Chiffre d'affaires annuel de l'entreprise", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA", si: { cle: "produits", valeurs: ["rc_travaux", "rc_bureau_etudes"] } },
    { cle: "employes", libelle: "Nombre d'employés", type: "nombre", min: 0, max: 100_000, si: { cle: "produits", valeurs: ["rc_travaux", "rc_bureau_etudes"] } },
    { cle: "corpsEtat", libelle: "Corps d'état ou missions exercés", type: "texte", max: 120, exemple: "Gros œuvre, électricité, études de structure…", si: { cle: "produits", valeurs: ["rc_travaux", "rc_bureau_etudes"] } },
    { cle: "partSousTraitee", libelle: "Part des travaux sous-traitée", type: "nombre", min: 0, max: 100, unite: "%", si: { cle: "produits", valeurs: ["rc_travaux", "rc_bureau_etudes"] } },
    { cle: "travauxRisque", libelle: "Travaux à risque", type: "plusieurs", si: { cle: "produits", valeurs: ["rc_travaux", "rc_bureau_etudes"] }, options: {
      demolition: "Démolition", explosifs: "Explosifs", soudure: "Soudure ou travaux par point chaud",
      souterrains: "Travaux souterrains", maritimes: "Travaux maritimes ou fluviaux",
    } },
    ASSUREUR_ACTUEL,
    ECHEANCE_ACTUELLE,
  ],
  industrie_bris_de_machines: [
    { cle: "produits", libelle: "Assurance recherchée", type: "plusieurs", options: {
      multirisque_pme: "Multirisque des PME et PMI (locaux, matériel, marchandises)",
      immeuble: "Multirisque immeuble (propriétaire, copropriété, syndic)", bris_machines: "Bris de machines",
      rc_industrielle: "Responsabilité civile d'exploitation, après travaux ou après livraison",
      globale_banque: "Globale de banque (banques et établissements financiers)", conseil: CONSEIL,
    } },
    { cle: "activite", libelle: "Activité", type: "texte", max: 120, exemple: "Boulangerie industrielle, imprimerie…", obligatoire: true },
    { cle: "statutLocaux", libelle: "Vos locaux", type: "choix", options: { proprietaire: "Vous en êtes propriétaire", locataire: "Vous êtes locataire" } },
    { cle: "valeurBatiments", libelle: "Valeur des bâtiments", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "valeurMachines", libelle: "Valeur des machines", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "valeurStock", libelle: "Valeur du stock", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "chiffreAffaires", libelle: "Chiffre d'affaires annuel", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "employes", libelle: "Nombre d'employés", type: "nombre", min: 0, max: 100_000 },
    { cle: "entretienMachines", libelle: "Contrat d'entretien des machines", type: "choix", options: OUI_NON },
    ASSUREUR_ACTUEL,
    ECHEANCE_ACTUELLE,
  ],
  agricole: [
    { cle: "culture", libelle: "Culture", type: "texte", max: 80, exemple: "Cacao, hévéa, anacarde, palmier…", obligatoire: true },
    { cle: "risques", libelle: "Risques à couvrir", type: "plusieurs", options: {
      incendie: "Incendie et foudre", tempete: "Tempête", inondation: "Inondation", grele: "Grêle", gel: "Gel", conseil: CONSEIL,
    } },
    { cle: "superficie", libelle: "Superficie totale", type: "nombre", min: 1, max: 1_000_000, unite: "hectares" },
    { cle: "superficieCultivee", libelle: "Superficie cultivée", type: "nombre", min: 1, max: 1_000_000, unite: "hectares" },
    { cle: "anneePlantation", libelle: "Année de mise en place des plants", type: "nombre", min: 1900, max: 2100 },
    { cle: "irrigation", libelle: "Plantation irriguée", type: "choix", options: OUI_NON },
    { cle: "productionAnnuelle", libelle: "Production annuelle", type: "nombre", min: 1, max: 10_000_000, unite: "tonnes" },
    { cle: "sommeAssuree", libelle: "Somme à assurer", type: "nombre", min: 1, max: MONTANT_MAX, unite: "F CFA" },
    { cle: "localisation", libelle: "Localisation de la plantation", type: "texte", max: 120 },
    ASSUREUR_ACTUEL,
  ],
  evenementiel: [
    { cle: "evenement", libelle: "Type d'événement", type: "texte", max: 120, exemple: "Concert, salon, mariage, compétition…", obligatoire: true },
    { cle: "date", libelle: "Date de l'événement", type: "date" },
    { cle: "jours", libelle: "Durée de l'événement", type: "nombre", min: 1, max: 365, unite: "jours" },
    { cle: "lieu", libelle: "Lieu", type: "texte", max: 120 },
    { cle: "participants", libelle: "Nombre de participants attendus", type: "nombre", min: 1, max: 10_000_000 },
    { cle: "securite", libelle: "Mesures de sécurité prévues", type: "texte", max: 200, exemple: "Agents de sécurité, secouristes, pompiers, barrières…" },
    { cle: "dejaAssure", libelle: "Déjà assuré pour ce type d'événement", type: "choix", options: OUI_NON },
  ],
  autre: [],
};

/** Ce que le visiteur peut joindre */
export const NATURES_PIECE = [
  "carte_grise", "attestation_precedente", "liste_vehicules", "carte_transport", "registre_commerce",
  "photos_bien", "devis_travaux", "liste_materiel", "liste_personnes", "cahier_des_charges", "questionnaire_compagnie",
  "rapport_sol_controle", "planning_plans", "plan_plantation", "autre",
] as const;
export type NaturePiece = (typeof NATURES_PIECE)[number];

export const LIBELLES_NATURE: Record<NaturePiece, string> = {
  carte_grise: "Carte grise",
  attestation_precedente: "Attestation ou contrat d'assurance actuel",
  liste_vehicules: "Liste des véhicules",
  carte_transport: "Carte de transport",
  registre_commerce: "Registre de commerce (RCCM)",
  photos_bien: "Photos du bien, des locaux ou du matériel",
  devis_travaux: "Devis, marché ou permis de construire",
  liste_materiel: "Liste du matériel, avec sa valeur",
  liste_personnes: "Liste des personnes à couvrir",
  cahier_des_charges: "Cahier des charges",
  questionnaire_compagnie: "Questionnaire de la compagnie, rempli",
  rapport_sol_controle: "Rapport de sol ou du bureau de contrôle",
  planning_plans: "Planning et plans du chantier",
  plan_plantation: "Carte ou plan de la plantation",
  autre: "Autre document utile",
};

/** Pourquoi chaque document aide, affiché sous le champ */
export const AIDES_NATURE: Record<NaturePiece, string> = {
  carte_grise: "Photo nette ou PDF : marque, puissance et date de mise en circulation y figurent.",
  attestation_precedente: "Nous y lisons vos garanties et votre échéance, pour comparer à garanties égales.",
  liste_vehicules: "Un tableau Excel (.xlsx), une photo ou un PDF : immatriculation, marque, genre et usage de chaque véhicule.",
  carte_transport: "Votre carte de transporteur ou votre agrément.",
  registre_commerce: "L'activité exacte et la raison sociale, telles qu'elles figureront sur le contrat.",
  photos_bien: "Quelques photos de l'intérieur et de l'extérieur.",
  devis_travaux: "Le montant et la durée des travaux fixent la prime du chantier.",
  liste_materiel: "Un tableau Excel (.xlsx), une photo ou un PDF : pour chaque machine, la marque, les caractéristiques, l'année, la valeur d'achat et la valeur actuelle.",
  liste_personnes: "Un tableau Excel (.xlsx), une photo ou un PDF : nom, date de naissance et fonction de chacun.",
  cahier_des_charges: "La clause « assurances » dit ce que le maître d'ouvrage exige.",
  questionnaire_compagnie: "Si nous vous l'avons déjà envoyé : une photo ou un PDF des pages remplies et signées.",
  rapport_sol_controle: "Le rapport géotechnique, ou le rapport initial du contrôleur technique, s'ils existent.",
  planning_plans: "Le planning des travaux et le plan d'ensemble (plans et coupes pour une garantie décennale).",
  plan_plantation: "Une carte, un plan ou une capture d'écran avec les coordonnées GPS des parcelles.",
  autre: "Tout ce qui vous semble utile : ancien devis, plan, procès-verbal…",
};

/** Natures qui acceptent aussi un classeur Excel (.xlsx), en plus des photos et des PDF */
export const NATURES_AVEC_CLASSEUR: readonly NaturePiece[] = ["liste_vehicules", "liste_materiel", "liste_personnes"];

/** Documents proposés pour chaque assurance, le plus utile d'abord */
export const PIECES_PAR_BRANCHE: Record<string, readonly NaturePiece[]> = {
  automobile: ["carte_grise", "attestation_precedente"],
  deux_roues: ["carte_grise", "attestation_precedente"],
  flotte: ["liste_vehicules", "carte_grise", "attestation_precedente", "registre_commerce", "carte_transport"],
  habitation: ["photos_bien", "attestation_precedente"],
  multirisque_professionnelle: ["registre_commerce", "photos_bien", "attestation_precedente", "questionnaire_compagnie"],
  incendie_risques_divers: ["photos_bien", "registre_commerce", "attestation_precedente", "questionnaire_compagnie"],
  responsabilite_civile: ["registre_commerce", "attestation_precedente", "questionnaire_compagnie"],
  individuelle_accident: ["liste_personnes", "attestation_precedente"],
  transport_marchandises: ["carte_transport", "registre_commerce", "attestation_precedente"],
  chantier_construction: [
    "devis_travaux", "cahier_des_charges", "planning_plans", "rapport_sol_controle", "questionnaire_compagnie", "registre_commerce",
  ],
  industrie_bris_de_machines: ["liste_materiel", "photos_bien", "registre_commerce", "attestation_precedente", "questionnaire_compagnie"],
  agricole: ["plan_plantation", "photos_bien", "questionnaire_compagnie", "autre"],
  evenementiel: ["questionnaire_compagnie", "autre"],
  autre: ["autre"],
};

/** Limites, comme la base : 6 documents, 5 Mo chacun (2 Mo pour un classeur), 20 Mo en tout */
export const PIECES_MAX = 6;
export const TAILLE_PIECE_MAX = 5 * 1024 * 1024;
export const TAILLE_CLASSEUR_MAX = 2 * 1024 * 1024;
export const TAILLE_PIECES_TOTAL_MAX = 20 * 1024 * 1024;
export const TYPE_CLASSEUR = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
