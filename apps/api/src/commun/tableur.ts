// Lecture d'un tableau envoyé par l'agence ou un transporteur : classeur Excel (.xlsx) ou CSV.
//
// Sans dépendance : un .xlsx est une archive ZIP de fichiers XML (format Office Open XML, ISO/IEC 29500).
// On n'en lit que la première feuille et ses textes partagés, cellule par cellule, en valeurs (jamais en
// formules : seule la valeur calculée par Excel est reprise, aucune formule n'est évaluée).
//
// Protections : taille du fichier, taille décompressée de chaque élément et de l'ensemble (bombe de
// décompression), nombre de lignes et de colonnes, aucune entité XML externe (le XML est lu par motifs,
// jamais par un analyseur qui irait chercher des ressources).

import { inflateRawSync } from "node:zlib";

export const TAILLE_FICHIER_MAX = 2 * 1024 * 1024;
const TAILLE_ELEMENT_MAX = 20 * 1024 * 1024;
const TAILLE_TOTALE_MAX = 40 * 1024 * 1024;
export const LIGNES_MAX = 2000;
const COLONNES_MAX = 60;

export class ErreurTableur extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurTableur";
  }
}

export interface Tableau {
  /** Lignes de cellules, en texte ; une cellule vide vaut "" */
  lignes: string[][];
  /** Classeur Excel : les nombres des colonnes de dates sont des numéros de série Excel */
  format: "xlsx" | "csv";
  /** Classeur au calendrier de 1904 (Excel pour Mac ancien) */
  calendrier1904: boolean;
}

const SIGNATURE_ZIP = 0x04034b50;

export function lireTableau(contenu: Buffer): Tableau {
  if (contenu.length === 0) throw new ErreurTableur("Le fichier est vide.");
  if (contenu.length > TAILLE_FICHIER_MAX) throw new ErreurTableur("Le fichier dépasse 2 Mo : découpez la liste en plusieurs fichiers.");
  if (contenu.length >= 4 && contenu.readUInt32LE(0) === SIGNATURE_ZIP) return lireXlsx(contenu);
  // Ancien format Excel (.xls, binaire) : non lu
  if (contenu.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw new ErreurTableur("Ancien format Excel (.xls) : enregistrez le fichier au format « Classeur Excel (.xlsx) » ou « CSV UTF-8 ».");
  }
  return { lignes: lireCsv(contenu), format: "csv", calendrier1904: false };
}

/* ---------- CSV ---------- */

/** CSV en UTF-8 (avec ou sans BOM), séparé par des points-virgules, des virgules ou des tabulations. */
export function lireCsv(contenu: Buffer): string[][] {
  let texte = contenu.toString("utf8");
  if (texte.includes("�")) texte = contenu.toString("latin1"); // CSV enregistré en « Windows-1252 »
  texte = texte.replace(/^﻿/, "");
  const premiereLigne = texte.slice(0, texte.search(/\r?\n|$/));
  const separateur = [";", "\t", ","].reduce((meilleur, candidat) =>
    premiereLigne.split(candidat).length > premiereLigne.split(meilleur).length ? candidat : meilleur, ";");

  const lignes: string[][] = [];
  let ligne: string[] = [];
  let cellule = "";
  let guillemets = false;
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte[i]!;
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') {
        cellule += '"';
        i += 1;
      } else if (c === '"') {
        guillemets = false;
      } else {
        cellule += c;
      }
    } else if (c === '"' && cellule === "") {
      guillemets = true;
    } else if (c === separateur) {
      ligne.push(cellule);
      cellule = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i += 1;
      ligne.push(cellule);
      lignes.push(ligne);
      ligne = [];
      cellule = "";
      if (lignes.length > LIGNES_MAX + 1) throw new ErreurTableur(`Plus de ${LIGNES_MAX} lignes : découpez la liste.`);
    } else {
      cellule += c;
    }
  }
  if (cellule !== "" || ligne.length > 0) {
    ligne.push(cellule);
    lignes.push(ligne);
  }
  return lignes.map((l) => l.slice(0, COLONNES_MAX));
}

/* ---------- XLSX : archive ZIP ---------- */

interface ElementZip {
  nom: string;
  methode: number;
  tailleCompressee: number;
  tailleReelle: number;
  decalage: number;
}

function lireArchive(zip: Buffer): Map<string, ElementZip> {
  // Fin du répertoire central : dans les 64 Ko de la fin (commentaire d'archive compris)
  const debutRecherche = Math.max(0, zip.length - 65_557);
  let fin = -1;
  for (let i = zip.length - 22; i >= debutRecherche; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new ErreurTableur("Classeur illisible : archive incomplète ou endommagée.");
  const nombre = zip.readUInt16LE(fin + 10);
  let position = zip.readUInt32LE(fin + 16);
  if (nombre > 2000) throw new ErreurTableur("Classeur illisible : trop d'éléments dans l'archive.");

  const elements = new Map<string, ElementZip>();
  for (let n = 0; n < nombre; n += 1) {
    if (position + 46 > zip.length || zip.readUInt32LE(position) !== 0x02014b50) {
      throw new ErreurTableur("Classeur illisible : répertoire de l'archive endommagé.");
    }
    const drapeaux = zip.readUInt16LE(position + 8);
    const methode = zip.readUInt16LE(position + 10);
    const tailleCompressee = zip.readUInt32LE(position + 20);
    const tailleReelle = zip.readUInt32LE(position + 24);
    const longueurNom = zip.readUInt16LE(position + 28);
    const longueurExtra = zip.readUInt16LE(position + 30);
    const longueurCommentaire = zip.readUInt16LE(position + 32);
    const decalage = zip.readUInt32LE(position + 42);
    const nom = zip.subarray(position + 46, position + 46 + longueurNom).toString("utf8");
    if (drapeaux & 0x1) throw new ErreurTableur("Classeur protégé par un mot de passe : enregistrez-en une copie sans mot de passe.");
    elements.set(nom, { nom, methode, tailleCompressee, tailleReelle, decalage });
    position += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }
  return elements;
}

function extraire(zip: Buffer, element: ElementZip, budget: { restant: number }): string {
  const entete = element.decalage;
  if (entete + 30 > zip.length || zip.readUInt32LE(entete) !== SIGNATURE_ZIP) {
    throw new ErreurTableur("Classeur illisible : élément de l'archive endommagé.");
  }
  const debut = entete + 30 + zip.readUInt16LE(entete + 26) + zip.readUInt16LE(entete + 28);
  const donnees = zip.subarray(debut, debut + element.tailleCompressee);
  const plafond = Math.min(TAILLE_ELEMENT_MAX, budget.restant);
  let contenu: Buffer;
  try {
    if (element.methode === 0) contenu = Buffer.from(donnees);
    else if (element.methode === 8) contenu = inflateRawSync(donnees, { maxOutputLength: plafond });
    else throw new ErreurTableur("Classeur illisible : compression non prise en charge.");
  } catch (erreur) {
    if (erreur instanceof ErreurTableur) throw erreur;
    throw new ErreurTableur("Classeur illisible ou trop volumineux une fois décompressé.");
  }
  if (contenu.length > plafond) throw new ErreurTableur("Classeur trop volumineux une fois décompressé.");
  budget.restant -= contenu.length;
  return contenu.toString("utf8");
}

/* ---------- XLSX : XML ---------- */

function decoderXml(texte: string): string {
  return texte.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_tout, entite: string) => {
    switch (entite) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: {
        const code = entite.startsWith("#x") ? Number.parseInt(entite.slice(2), 16) : Number.parseInt(entite.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
    }
  });
}

function attribut(balise: string, nom: string): string | undefined {
  return new RegExp(`\\s${nom}="([^"]*)"`).exec(balise)?.[1];
}

/** Texte d'un élément riche (<si> ou <is>) : concaténation de ses <t>, sans les annotations phonétiques. */
function texteRiche(xml: string): string {
  const sansPhonetique = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  return [...sansPhonetique.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => decoderXml(m[1] ?? "")).join("");
}

/** « C12 » → 2 (colonne C, de 0) */
function indexColonne(reference: string): number {
  const lettres = /^([A-Z]+)/.exec(reference)?.[1] ?? "A";
  let index = 0;
  for (const lettre of lettres) index = index * 26 + (lettre.charCodeAt(0) - 64);
  return index - 1;
}

function lireXlsx(zip: Buffer): Tableau {
  const elements = lireArchive(zip);
  const budget = { restant: TAILLE_TOTALE_MAX };
  const lire = (nom: string) => {
    const element = elements.get(nom);
    return element ? extraire(zip, element, budget) : null;
  };

  // Première feuille du classeur, d'après le classeur et ses relations
  const classeur = lire("xl/workbook.xml");
  if (!classeur) throw new ErreurTableur("Ce fichier n'est pas un classeur Excel (.xlsx).");
  const calendrier1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/.test(classeur);
  const premiereFeuille = /<sheet\b[^>]*>/.exec(classeur)?.[0];
  const idRelation = premiereFeuille ? attribut(premiereFeuille, "r:id") : undefined;
  let cheminFeuille = "xl/worksheets/sheet1.xml";
  const relations = lire("xl/_rels/workbook.xml.rels");
  if (idRelation && relations) {
    const relation = [...relations.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attribut(r, "Id") === idRelation);
    const cible = relation ? attribut(relation, "Target") : undefined;
    if (cible) cheminFeuille = cible.startsWith("/") ? cible.slice(1) : `xl/${cible.replace(/^\.\//, "")}`;
  }

  const textes = lire("xl/sharedStrings.xml");
  const partages = textes ? [...textes.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => texteRiche(m[1] ?? "")) : [];

  const feuille = lire(cheminFeuille);
  if (!feuille) throw new ErreurTableur("Classeur sans feuille de calcul lisible.");

  const lignes: string[][] = [];
  for (const ligneXml of feuille.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const numero = Number(attribut(ligneXml[0], "r") ?? lignes.length + 1);
    if (!Number.isInteger(numero) || numero < 1) continue;
    if (numero > LIGNES_MAX + 1) throw new ErreurTableur(`Plus de ${LIGNES_MAX} lignes : découpez la liste.`);
    const cellules: string[] = [];
    for (const celluleXml of (ligneXml[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributs = celluleXml[1] ?? "";
      const reference = /\sr="([A-Z]+\d+)"/.exec(` ${attributs}`)?.[1];
      const colonne = reference ? indexColonne(reference) : cellules.length;
      if (colonne >= COLONNES_MAX) continue;
      const type = /\st="([^"]*)"/.exec(` ${attributs}`)?.[1] ?? "n";
      const interieur = celluleXml[2] ?? "";
      const valeur = /<v>([\s\S]*?)<\/v>/.exec(interieur)?.[1];
      let texte = "";
      if (type === "s") texte = partages[Number(valeur)] ?? "";
      else if (type === "inlineStr") texte = texteRiche(/<is>([\s\S]*?)<\/is>/.exec(interieur)?.[1] ?? "");
      else if (type === "b") texte = valeur === "1" ? "VRAI" : valeur === "0" ? "FAUX" : "";
      else if (type === "e") texte = "";
      else texte = decoderXml(valeur ?? "");
      while (cellules.length < colonne) cellules.push("");
      cellules[colonne] = texte;
    }
    while (lignes.length < numero - 1) lignes.push([]);
    lignes[numero - 1] = cellules;
  }
  return { lignes, format: "xlsx", calendrier1904 };
}

/* ---------- Valeurs ---------- */

/** Numéro de série Excel → « 2026-11-29 » (calendrier 1900, ou 1904) */
export function dateExcel(serie: number, calendrier1904 = false): string | null {
  if (!Number.isFinite(serie) || serie < 1 || serie > 2_958_465) return null;
  const origine = calendrier1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(origine + Math.floor(serie) * 86_400_000).toISOString().slice(0, 10);
}
