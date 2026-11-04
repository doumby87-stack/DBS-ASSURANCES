// Mise en forme pour l'écran : montants, dates, numéros, libellés.

export function montant(valeur: number | null | undefined): string {
  if (valeur === null || valeur === undefined) return "—";
  return `${new Intl.NumberFormat("fr-FR").format(valeur)} F CFA`;
}

export function dateCourte(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [annee, mois, jour] = iso.slice(0, 10).split("-");
  return `${jour}/${mois}/${annee}`;
}

export function dateHeure(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Abidjan" }).format(new Date(iso));
}

export function telephone(e164: string): string {
  const local = e164.startsWith("+225") ? e164.slice(4) : e164;
  return local.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}

/** Aujourd'hui à Abidjan (UTC+0), au format 2026-11-04 */
export function aujourdHui(): string {
  return new Date().toISOString().slice(0, 10);
}

export function joursAvant(iso: string): number {
  return Math.round((Date.parse(iso) - Date.parse(aujourdHui())) / 86_400_000);
}

export const BRANCHES: Record<string, string> = {
  automobile: "Automobile", deux_roues: "Deux-roues", flotte: "Flotte", habitation: "Multirisque habitation",
  multirisque_professionnelle: "Multirisque professionnelle", incendie_risques_divers: "Incendie et risques divers",
  responsabilite_civile: "Responsabilité civile", individuelle_accident: "Individuelle accident",
  transport_marchandises: "Transport de marchandises", chantier_construction: "Chantier et construction",
  industrie_bris_de_machines: "Industrie, bris de machines", agricole: "Agricole", evenementiel: "Événementiel", autre: "Autre",
};

export const STATUTS_CONTRAT: Record<string, string> = {
  en_attente_paiement: "En attente de paiement", en_vigueur: "En vigueur", suspendu: "Suspendu", resilie: "Résilié", expire: "Expiré",
};

export const NATURES_SINISTRE: Record<string, string> = {
  materiel: "Dommages matériels", corporel: "Dommages corporels", vol: "Vol", incendie: "Incendie",
  bris_de_glace: "Bris de glace", degat_des_eaux: "Dégât des eaux", autre: "Autre",
};

export const STATUTS_SINISTRE: Record<string, string> = {
  declare: "Déclaré à l'agence", transmis_compagnie: "Transmis à la compagnie", expertise: "En expertise", offre_recue: "Offre reçue",
  regle: "Réglé", refuse: "Refusé", classe_sans_suite: "Classé sans suite",
};

export const TELEPHONE_AGENCE = "07 49 36 07 02";
export const WHATSAPP_AGENCE = "https://wa.me/2250749360702";
