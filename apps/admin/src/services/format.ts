// Libellés et formats d'affichage, en français.

import type { Role } from "./api";

export const ROLES: Record<Role, string> = {
  gerant: "Gérant",
  charge_clientele: "Chargé de clientèle",
  caissier: "Caissier",
  commercial: "Commercial",
  apporteur: "Apporteur d'affaires",
  auditeur: "Auditeur",
};

export const BRANCHES: Record<string, string> = {
  automobile: "Automobile",
  deux_roues: "Deux-roues",
  flotte: "Flotte",
  habitation: "Multirisque habitation",
  multirisque_professionnelle: "Multirisque professionnelle",
  incendie_risques_divers: "Incendie et risques divers",
  responsabilite_civile: "Responsabilité civile",
  individuelle_accident: "Individuelle accident",
  transport_marchandises: "Transport de marchandises",
  chantier_construction: "Chantier et construction",
  industrie_bris_de_machines: "Industrie, bris de machines",
  agricole: "Agricole",
  evenementiel: "Événementiel",
  autre: "Autre",
};

export const STATUTS_CONTRAT: Record<string, string> = {
  en_attente_paiement: "En attente de paiement",
  en_vigueur: "En vigueur",
  suspendu: "Suspendu",
  resilie: "Résilié",
  expire: "Expiré",
};

export const STATUTS_DEVIS: Record<string, string> = {
  nouveau: "Nouveau",
  en_cotation: "En cotation",
  envoye: "Envoyé au client",
  accepte: "Accepté",
  refuse: "Refusé",
  sans_suite: "Sans suite",
};

export const CANAUX: Record<string, string> = {
  appel: "Appel",
  whatsapp: "WhatsApp",
  email: "E-mail",
  sms: "SMS",
  visite: "Visite à l'agence",
  note: "Note",
};

export const TYPES_CLIENT: Record<string, string> = {
  particulier: "Particulier",
  professionnel: "Professionnel",
  entreprise: "Entreprise",
};

export const TYPES_RELANCE: Record<string, string> = {
  echeance_j30: "Échéance dans 30 jours",
  echeance_j15: "Échéance dans 15 jours",
  echeance_j7: "Échéance dans 7 jours",
  echeance_jour: "Échéance aujourd'hui",
  contrat_expire: "Contrat expiré",
  devis_sans_reponse: "Devis sans réponse",
  sinistre_avancement: "Avancement d'un sinistre",
  documents_vehicules: "Documents des véhicules",
  echeance_paiement: "Échéance d'une prime en plusieurs fois",
};

export const STATUTS_RELANCE: Record<string, string> = {
  a_envoyer: "À envoyer",
  envoyee: "Envoyée",
  remise: "Remise",
  lue: "Lue",
  echec: "En échec",
  annulee: "Annulée",
};

export const CANAUX_RELANCE: Record<string, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
};

export const DOCUMENTS_VEHICULE: Record<string, string> = {
  visite_technique: "Visite technique",
  vignette: "Vignette",
  carte_de_transport: "Carte de transport",
};

const nombre = new Intl.NumberFormat("fr-FR");

export const NATURES_SINISTRE: Record<string, string> = {
  materiel: "Dommages matériels", corporel: "Dommages corporels", vol: "Vol", incendie: "Incendie",
  bris_de_glace: "Bris de glace", degat_des_eaux: "Dégât des eaux", autre: "Autre",
};

export const STATUTS_SINISTRE: Record<string, string> = {
  declare: "Déclaré", transmis_compagnie: "Transmis à la compagnie", expertise: "En expertise", offre_recue: "Offre reçue",
  regle: "Réglé", refuse: "Refusé", classe_sans_suite: "Classé sans suite",
};

export const STATUTS_PAIEMENT_EN_LIGNE: Record<string, string> = {
  initie: "Commencé", en_attente: "En attente du prestataire", accepte: "Encaissé", refuse: "Refusé",
  abandonne: "Non abouti", a_regulariser: "À régulariser",
};

export const MOYENS_MOBILE_MONEY: Record<string, string> = {
  WAVE: "Wave", ORANGE_MONEY: "Orange Money", MTN_MOMO: "MTN MoMo", MOOV_MONEY: "Moov Money",
};

export function montant(valeur: number | null | undefined): string {
  return valeur === null || valeur === undefined ? "—" : `${nombre.format(valeur)} F CFA`;
}

/** « 2026-11-29 » → « 29/11/2026 » */
export function dateCourte(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [annee, mois, jour] = iso.slice(0, 10).split("-");
  return `${jour}/${mois}/${annee}`;
}

export function dateHeure(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Abidjan" });
}

/** « +2250749360702 » → « 07 49 36 07 02 » ; les numéros étrangers restent tels quels. */
export function telephone(e164: string): string {
  if (e164.startsWith("+225") && e164.length === 14) return e164.slice(4).replace(/(\d{2})(?=\d)/g, "$1 ");
  return e164;
}

export function joursRestants(jours: number): string {
  if (jours < 0) return `expiré depuis ${-jours} j`;
  if (jours === 0) return "aujourd'hui";
  return `dans ${jours} j`;
}

/** Lien WhatsApp avec un message de relance déjà rédigé. */
export function lienWhatsApp(e164: string, message: string): string {
  return `https://wa.me/${e164.replace(/^\+/, "")}?text=${encodeURIComponent(message)}`;
}

export function aujourdHui(decalageJours = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + decalageJours);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const MODES_PAIEMENT: Record<string, string> = {
  especes: "Espèces",
  cheque: "Chèque",
  mobile_money: "Mobile Money",
  virement: "Virement",
};

/** Ce qu'il faut noter comme référence, selon le mode de paiement. */
export const AIDE_REFERENCE: Record<string, string> = {
  especes: "Facultatif",
  cheque: "Banque et n° du chèque, à l'ordre de SanlamAllianz Côte d'Ivoire",
  mobile_money: "N° de transaction (Wave, Orange Money, MTN MoMo, Moov Money)",
  virement: "Référence du virement",
};

export const STATUTS_BORDEREAU: Record<string, string> = {
  prepare: "À valider",
  valide: "Validé, à verser",
  verse: "Versé",
  annule: "Annulé",
};

/** Coupures en circulation (BCEAO), de la plus grande à la plus petite ; billets et pièces de 500 F ensemble. */
export const COUPURES = [10000, 5000, 2000, 1000, 500, 250, 200, 100, 50, 25, 10, 5, 1] as const;

/** « 2026-11 » → « novembre 2026 » */
export function moisEnLettres(mois: string): string {
  const [annee, numero] = mois.split("-").map(Number);
  return new Date(Date.UTC(annee!, numero! - 1, 1)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

// ---------- Outils du site (tâche 13) ----------
export const NATURES_DEMANDE_SITE: Record<string, string> = {
  devis: "Devis", rappel_echeance: "Rappel d'échéance", appel_offres: "Appel d'offres",
};
export const GARANTIES_APPEL_OFFRES: Record<string, string> = {
  trc: "Tous risques chantier",
  decennale: "Responsabilité civile décennale",
  rc_pro: "Responsabilité civile professionnelle ou d'exploitation",
  flotte: "Véhicules et engins affectés au marché",
  engins: "Bris de machines et engins",
  transport: "Transport des fournitures ou marchandises",
  personnel: "Individuelle accident du personnel",
  a_determiner: "À déterminer d'après le cahier des charges",
};
export const TYPES_MARCHE: Record<string, string> = {
  travaux: "Travaux", fournitures: "Fournitures", services: "Services", prestations_intellectuelles: "Prestations intellectuelles",
};
export const MOTIFS_RENDEZ_VOUS: Record<string, string> = {
  devis: "Devis", renouvellement: "Renouvellement", sinistre: "Sinistre", appel_offres: "Appel d'offres", flotte: "Flotte", autre: "Autre",
};
export const MODES_RENDEZ_VOUS: Record<string, string> = {
  agence: "À l'agence", telephone: "Au téléphone", chez_le_client: "Sur place, chez le client",
};
export const CRENEAUX: Record<string, string> = { matin: "le matin", apres_midi: "l'après-midi" };

/** Nombre de jours entre aujourd'hui et une date « AAAA-MM-JJ » (négatif si elle est passée) */
export function ecartEnJours(iso: string): number {
  const [annee, mois, jour] = iso.slice(0, 10).split("-").map(Number);
  const cible = Date.UTC(annee!, mois! - 1, jour!);
  const [a, m, j] = aujourdHui().split("-").map(Number);
  return Math.round((cible - Date.UTC(a!, m! - 1, j!)) / 86_400_000);
}

/** Heure d'Abidjan d'un instant : « 09:30 » */
export function heure(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Abidjan" });
}

/** Jour d'Abidjan d'un instant : « 2026-11-10 » */
export function jourAbidjan(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Abidjan" });
}
