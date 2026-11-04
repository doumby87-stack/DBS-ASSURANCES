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

export const DOCUMENTS_VEHICULE: Record<string, string> = {
  visite_technique: "Visite technique",
  vignette: "Vignette",
  carte_de_transport: "Carte de transport",
};

const nombre = new Intl.NumberFormat("fr-FR");

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
