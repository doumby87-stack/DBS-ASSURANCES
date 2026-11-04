// Import de la liste des véhicules d'un client (classeur Excel ou CSV) : chaque ligne est contrôlée et les
// erreurs sont rendues toutes ensemble, ligne et colonne comprises, pour être corrigées dans le fichier.
// Rien n'est enregistré tant qu'il reste une erreur (tout ou rien).

import { normaliserImmatriculation } from "../../commun/formats.js";
import { dateExcel, type Tableau } from "../../commun/tableur.js";

export interface VehiculeImporte {
  immatriculation: string;
  numeroChassis: string | null;
  marque: string | null;
  modele: string | null;
  genre: string | null;
  usage: string | null;
  puissanceFiscale: number | null;
  valeurVenale: number | null;
  echeanceVisiteTechnique: string | null;
  echeanceVignette: string | null;
  echeanceCarteTransport: string | null;
}

export interface ErreurLigne {
  /** Numéro de ligne dans le fichier, comme l'affiche Excel (l'en-tête est la ligne 1) */
  ligne: number;
  colonne: string;
  valeur: string;
  message: string;
}

export interface LigneImportee {
  ligne: number;
  vehicule: VehiculeImporte;
}

type Champ = keyof VehiculeImporte;

/** Colonnes reconnues : en-têtes possibles, sans accents ni ponctuation, en minuscules */
const COLONNES: { champ: Champ; libelle: string; entetes: string[] }[] = [
  { champ: "immatriculation", libelle: "Immatriculation", entetes: ["immatriculation", "immat", "numero dimmatriculation", "plaque"] },
  { champ: "numeroChassis", libelle: "N° de châssis", entetes: ["numero de chassis", "n de chassis", "no de chassis", "chassis", "vin"] },
  { champ: "marque", libelle: "Marque", entetes: ["marque"] },
  { champ: "modele", libelle: "Modèle", entetes: ["modele", "type"] },
  { champ: "genre", libelle: "Genre", entetes: ["genre", "categorie", "nature"] },
  { champ: "usage", libelle: "Usage", entetes: ["usage", "utilisation"] },
  { champ: "puissanceFiscale", libelle: "Puissance fiscale (CV)", entetes: ["puissance fiscale", "puissance fiscale cv", "puissance", "cv", "chevaux fiscaux"] },
  { champ: "valeurVenale", libelle: "Valeur vénale", entetes: ["valeur venale", "valeur", "valeur a neuf", "valeur du vehicule"] },
  { champ: "echeanceVisiteTechnique", libelle: "Visite technique", entetes: ["visite technique", "echeance visite technique", "fin visite technique", "vt"] },
  { champ: "echeanceVignette", libelle: "Vignette", entetes: ["vignette", "echeance vignette", "fin vignette"] },
  { champ: "echeanceCarteTransport", libelle: "Carte de transport", entetes: ["carte de transport", "carte transport", "echeance carte de transport", "fin carte de transport"] },
];

const LONGUEURS: Partial<Record<Champ, number>> = { numeroChassis: 40, marque: 40, modele: 40, genre: 60, usage: 60 };
const DATES: Champ[] = ["echeanceVisiteTechnique", "echeanceVignette", "echeanceCarteTransport"];

/** Même plaque, quelle que soit l'écriture : « 1234-AB-01 » et « 1234 AB 01 » donnent « 1234AB01 » */
export function cleImmatriculation(immatriculation: string): string {
  return immatriculation.toUpperCase().replace(/[\s-]/g, "");
}

/** « Puissance fiscale (CV) » → « puissance fiscale cv » */
export function normaliserEntete(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[°º]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** « 24/11/2026 », « 24-11-2026 », « 2026-11-24 » ou numéro de série Excel → « 2026-11-24 » */
export function lireDate(texte: string, tableau: Pick<Tableau, "format" | "calendrier1904">): string | null {
  const valeur = texte.trim();
  let annee: number;
  let mois: number;
  let jour: number;
  let correspondance = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(valeur);
  if (correspondance) {
    [jour, mois, annee] = [Number(correspondance[1]), Number(correspondance[2]), Number(correspondance[3])];
  } else if ((correspondance = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(valeur))) {
    [annee, mois, jour] = [Number(correspondance[1]), Number(correspondance[2]), Number(correspondance[3])];
  } else if (tableau.format === "xlsx" && /^\d+(\.\d+)?$/.test(valeur)) {
    return dateExcel(Number(valeur), tableau.calendrier1904);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  if (annee < 1990 || annee > 2100 || date.getUTCMonth() !== mois - 1 || date.getUTCDate() !== jour) return null;
  return date.toISOString().slice(0, 10);
}

/** « 45 000 000 », « 45.000.000 », « 45000000 F CFA » → 45000000 ; null si ce n'est pas un entier positif */
export function lireEntier(texte: string): number | null {
  const valeur = texte.replace(/[\s  ]|f\s*cfa|fcfa|xof|cv/gi, "").replace(/\.(?=\d{3}(\D|$))/g, "");
  if (!/^\d+([.,]0+)?$/.test(valeur)) return null;
  const nombre = Number(valeur.replace(/[.,]0+$/, ""));
  return Number.isSafeInteger(nombre) ? nombre : null;
}

export interface ResultatAnalyse {
  lignes: LigneImportee[];
  erreurs: ErreurLigne[];
  /** Colonnes reconnues, dans l'ordre du fichier */
  colonnes: string[];
  /** Colonnes du fichier qui ne correspondent à rien (ignorées) */
  ignorees: string[];
}

/** Contrôle le tableau ; la première ligne non vide est l'en-tête. */
export function analyserTableau(tableau: Tableau): ResultatAnalyse {
  const indexEntete = tableau.lignes.findIndex((l) => l.some((c) => c.trim() !== ""));
  const erreurs: ErreurLigne[] = [];
  if (indexEntete < 0) {
    return { lignes: [], erreurs: [{ ligne: 1, colonne: "", valeur: "", message: "Le fichier ne contient aucune ligne." }], colonnes: [], ignorees: [] };
  }

  const entete = tableau.lignes[indexEntete]!;
  const correspondances = new Map<number, (typeof COLONNES)[number]>();
  const ignorees: string[] = [];
  entete.forEach((texte, index) => {
    if (!texte.trim()) return;
    const normalise = normaliserEntete(texte);
    const colonne = COLONNES.find((c) => c.entetes.includes(normalise));
    if (colonne && ![...correspondances.values()].includes(colonne)) correspondances.set(index, colonne);
    else ignorees.push(texte.trim());
  });
  if (![...correspondances.values()].some((c) => c.champ === "immatriculation")) {
    return {
      lignes: [],
      erreurs: [{ ligne: indexEntete + 1, colonne: "", valeur: "", message: "Colonne « Immatriculation » introuvable dans la première ligne du fichier." }],
      colonnes: [...correspondances.values()].map((c) => c.libelle),
      ignorees,
    };
  }

  const lignes: LigneImportee[] = [];
  const vues = new Map<string, number>();
  for (let i = indexEntete + 1; i < tableau.lignes.length; i += 1) {
    const cellules = tableau.lignes[i] ?? [];
    if (!cellules.some((c) => c.trim() !== "")) continue;
    const numero = i + 1;
    const vehicule: VehiculeImporte = {
      immatriculation: "", numeroChassis: null, marque: null, modele: null, genre: null, usage: null,
      puissanceFiscale: null, valeurVenale: null, echeanceVisiteTechnique: null, echeanceVignette: null, echeanceCarteTransport: null,
    };
    const erreur = (colonne: string, valeur: string, message: string) => erreurs.push({ ligne: numero, colonne, valeur: valeur.slice(0, 60), message });

    for (const [index, colonne] of correspondances) {
      const brut = (cellules[index] ?? "").trim();
      if (colonne.champ === "immatriculation") {
        const immatriculation = normaliserImmatriculation(brut);
        if (!brut) erreur(colonne.libelle, brut, "Immatriculation manquante.");
        else if (!immatriculation) erreur(colonne.libelle, brut, "Immatriculation invalide (lettres, chiffres, espaces et tirets, 3 à 15 caractères).");
        else if (vues.has(cleImmatriculation(immatriculation))) {
          erreur(colonne.libelle, brut, `Véhicule déjà présent à la ligne ${vues.get(cleImmatriculation(immatriculation))} du fichier.`);
        } else {
          vehicule.immatriculation = immatriculation;
          vues.set(cleImmatriculation(immatriculation), numero);
        }
        continue;
      }
      if (!brut) continue;
      if (DATES.includes(colonne.champ)) {
        const date = lireDate(brut, tableau);
        if (!date) erreur(colonne.libelle, brut, "Date invalide : écrivez-la sous la forme 24/11/2026.");
        else (vehicule[colonne.champ] as string | null) = date;
      } else if (colonne.champ === "puissanceFiscale") {
        const puissance = lireEntier(brut);
        if (puissance === null || puissance < 1 || puissance > 99) erreur(colonne.libelle, brut, "Puissance fiscale invalide : un nombre entier de 1 à 99.");
        else vehicule.puissanceFiscale = puissance;
      } else if (colonne.champ === "valeurVenale") {
        const valeur = lireEntier(brut);
        if (valeur === null || valeur > 1_000_000_000_000) erreur(colonne.libelle, brut, "Valeur invalide : un montant en F CFA, sans décimales.");
        else vehicule.valeurVenale = valeur;
      } else {
        const longueur = LONGUEURS[colonne.champ] ?? 60;
        if (brut.length > longueur) erreur(colonne.libelle, brut, `Texte trop long (${longueur} caractères au plus).`);
        else (vehicule[colonne.champ] as string | null) = colonne.champ === "numeroChassis" ? brut.toUpperCase() : brut.replace(/\s+/g, " ");
      }
    }
    if (vehicule.immatriculation) lignes.push({ ligne: numero, vehicule });
  }

  if (lignes.length === 0 && erreurs.length === 0) {
    erreurs.push({ ligne: indexEntete + 2, colonne: "", valeur: "", message: "Aucun véhicule dans le fichier, sous la ligne d'en-tête." });
  }
  return {
    lignes,
    erreurs,
    colonnes: [...correspondances.entries()].sort(([a], [b]) => a - b).map(([, c]) => c.libelle),
    ignorees,
  };
}

/** En-têtes du modèle à remplir, dans l'ordre */
export const ENTETES_MODELE = COLONNES.map((c) => c.libelle);
