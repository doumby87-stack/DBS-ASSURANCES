// Zone lisible par machine (MRZ) des pièces d'identité, norme ICAO 9303 : cartes au format TD1 (3 lignes de 30
// caractères) et passeports au format TD3 (2 lignes de 44). Ses chiffres de contrôle permettent de vérifier, sans
// rien envoyer à personne, que le numéro et les dates lus sont exacts : une erreur de lecture d'un seul caractère
// fait échouer le contrôle.

export interface ResultatMrz {
  format: "TD1" | "TD3";
  /** Tous les chiffres de contrôle sont justes */
  valide: boolean;
  erreurs: string[];
  numero: string;
  nationalite: string;
  dateNaissance: string | null;
  dateExpiration: string | null;
  sexe: "F" | "M" | null;
  nom: string;
  prenoms: string;
}

const POIDS = [7, 3, 1];

/** Chiffre de contrôle ICAO : chiffres, lettres (A = 10 … Z = 35) et « < » (0), pondérés 7, 3, 1 */
export function chiffreControle(texte: string): number {
  let somme = 0;
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte[i]!;
    const valeur = c === "<" ? 0 : /\d/.test(c) ? Number(c) : /[A-Z]/.test(c) ? c.charCodeAt(0) - 55 : NaN;
    if (Number.isNaN(valeur)) return -1;
    somme += valeur * POIDS[i % 3]!;
  }
  return somme % 10;
}

function controle(champ: string, chiffre: string): boolean {
  return /\d/.test(chiffre) && chiffreControle(champ) === Number(chiffre);
}

/** AAMMJJ → AAAA-MM-JJ ; le siècle se déduit de la nature de la date */
function dateMrz(aammjj: string, nature: "naissance" | "expiration", aujourdhui = new Date()): string | null {
  if (!/^\d{6}$/.test(aammjj)) return null;
  const aa = Number(aammjj.slice(0, 2));
  const anneeCourante = aujourdhui.getUTCFullYear() % 100;
  const siecle = nature === "naissance" ? (aa > anneeCourante ? 1900 : 2000) : (aa < 70 ? 2000 : 1900);
  const annee = siecle + aa;
  const mois = Number(aammjj.slice(2, 4));
  const jour = Number(aammjj.slice(4, 6));
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  if (d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) return null;
  return `${annee}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

function noms(zone: string): { nom: string; prenoms: string } {
  const [nom = "", prenoms = ""] = zone.split("<<");
  return { nom: nom.replace(/</g, " ").trim(), prenoms: prenoms.replace(/</g, " ").trim() };
}

const sexe = (c: string): "F" | "M" | null => (c === "F" || c === "M" ? c : null);

/** Lit et contrôle une MRZ ; null si les lignes ne ressemblent à aucun format connu */
export function analyserMrz(lignesBrutes: string[], aujourdhui = new Date()): ResultatMrz | null {
  const lignes = lignesBrutes.map((l) => l.replace(/\s/g, "").toUpperCase()).filter(Boolean);
  if (lignes.some((l) => !/^[A-Z0-9<]+$/.test(l))) return null;

  if (lignes.length === 3 && lignes.every((l) => l.length === 30)) {
    const [l1, l2, l3] = lignes as [string, string, string];
    const erreurs: string[] = [];
    // Numéro de document : 9 caractères, prolongé dans la zone facultative s'il est plus long
    let numero = l1.slice(5, 14);
    let numeroValide: boolean;
    if (l1[14] === "<" && l1.slice(15).replace(/<+$/, "").length > 0) {
      const suite = l1.slice(15).replace(/<+$/, "");
      numero = numero + suite.slice(0, -1);
      numeroValide = controle(numero, suite.slice(-1));
    } else {
      numeroValide = controle(l1.slice(5, 14), l1[14]!);
    }
    if (!numeroValide) erreurs.push("numéro du document");
    if (!controle(l2.slice(0, 6), l2[6]!)) erreurs.push("date de naissance");
    if (!controle(l2.slice(8, 14), l2[14]!)) erreurs.push("date d'expiration");
    if (!controle(l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29), l2[29]!)) erreurs.push("contrôle d'ensemble");
    return {
      format: "TD1", valide: erreurs.length === 0, erreurs, numero: numero.replace(/</g, ""),
      nationalite: l2.slice(15, 18).replace(/</g, ""),
      dateNaissance: dateMrz(l2.slice(0, 6), "naissance", aujourdhui), dateExpiration: dateMrz(l2.slice(8, 14), "expiration", aujourdhui),
      sexe: sexe(l2[7]!), ...noms(l3),
    };
  }

  if (lignes.length === 2 && lignes.every((l) => l.length === 44)) {
    const [l1, l2] = lignes as [string, string];
    const erreurs: string[] = [];
    if (!controle(l2.slice(0, 9), l2[9]!)) erreurs.push("numéro du document");
    if (!controle(l2.slice(13, 19), l2[19]!)) erreurs.push("date de naissance");
    if (!controle(l2.slice(21, 27), l2[27]!)) erreurs.push("date d'expiration");
    // Numéro personnel facultatif : chiffre de contrôle « < » ou 0 quand il est vide
    if (l2.slice(28, 42).replace(/</g, "") !== "" && !controle(l2.slice(28, 42), l2[42]!)) erreurs.push("numéro personnel");
    if (!controle(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43), l2[43]!)) erreurs.push("contrôle d'ensemble");
    return {
      format: "TD3", valide: erreurs.length === 0, erreurs, numero: l2.slice(0, 9).replace(/</g, ""),
      nationalite: l2.slice(10, 13).replace(/</g, ""),
      dateNaissance: dateMrz(l2.slice(13, 19), "naissance", aujourdhui), dateExpiration: dateMrz(l2.slice(21, 27), "expiration", aujourdhui),
      sexe: sexe(l2[20]!), ...noms(l1.slice(5)),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Retrouver la zone dans un texte reconnu, et corriger les confusions habituelles de la reconnaissance
// ---------------------------------------------------------------------------------------------------------

/** Ce que contient chaque position : a = lettre ou « < », n = chiffre, d = chiffre ou « < », s = sexe, x = tout */
const MASQUES: Record<"TD1" | "TD3", string[]> = {
  TD1: ["a".repeat(5) + "x".repeat(9) + "d" + "x".repeat(15), "n".repeat(7) + "s" + "n".repeat(7) + "aaa" + "x".repeat(11) + "n", "a".repeat(30)],
  TD3: ["a".repeat(44), "x".repeat(9) + "n" + "aaa" + "n".repeat(7) + "s" + "n".repeat(7) + "x".repeat(14) + "dn"],
};
const VERS_CHIFFRE: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", G: "6", T: "7", B: "8" };
const VERS_LETTRE: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "4": "A", "5": "S", "6": "G", "7": "T", "8": "B" };
/** Caractères que la reconnaissance confond, dans les champs qui mêlent lettres et chiffres */
const SOSIES: Record<string, string[]> = {
  "0": ["O", "D", "Q"], O: ["0"], D: ["0"], Q: ["0"], "1": ["I", "L"], I: ["1"], L: ["1"], "2": ["Z"], Z: ["2"], "5": ["S"], S: ["5"],
  "6": ["G"], G: ["6"], "8": ["B"], B: ["8"],
};

function appliquerMasque(ligne: string, masque: string): string {
  let resultat = "";
  for (let i = 0; i < masque.length; i += 1) {
    const c = ligne[i] ?? "<";
    const m = masque[i];
    if (m === "n") resultat += VERS_CHIFFRE[c] ?? c;
    else if (m === "d") resultat += c === "<" ? c : VERS_CHIFFRE[c] ?? c;
    else if (m === "a") resultat += VERS_LETTRE[c] ?? c;
    else if (m === "s") resultat += c === "H" ? "M" : c;
    else resultat += c;
  }
  return resultat;
}

/** Variantes d'un champ obtenues en échangeant ses caractères sosies (8 positions au plus) */
function variantes(champ: string): string[] {
  let resultats = [champ];
  const positions = [...champ].flatMap((c, i) => (SOSIES[c] ? [i] : [])).slice(0, 8);
  for (const p of positions) {
    resultats = resultats.flatMap((v) => [v, ...SOSIES[champ[p]!]!.map((autre) => v.slice(0, p) + autre + v.slice(p + 1))]);
  }
  return resultats;
}

/**
 * Le numéro du document mêle lettres et chiffres. Parmi les variantes que son chiffre de contrôle accepte, on garde
 * celle que confirme le numéro imprimé ailleurs sur le document ; à défaut, celle qui change le moins de
 * caractères, si elle est seule dans ce cas (sinon, on ne devine pas).
 */
function corrigerNumero(lignes: string[], format: "TD1" | "TD3", indices: string[]): string[] {
  const [ligne, debut] = format === "TD3" ? [1, 0] : [0, 5];
  const courant = lignes[ligne]!;
  const numero = courant.slice(debut, debut + 9);
  const chiffre = courant[debut + 9]!;
  if (!/\d/.test(chiffre)) return lignes;
  const ecarts = (v: string) => [...v].filter((c, i) => c !== numero[i]).length;
  const justes = variantes(numero).filter((v) => chiffreControle(v) === Number(chiffre));
  const imprimes = new Set(indices.map((i) => i.replace(/[^A-Z0-9]/gi, "").toUpperCase().padEnd(9, "<").slice(0, 9)));
  const confirmee = justes.filter((v) => imprimes.has(v));
  // Un L lu 1 (ou l'inverse) en tête de numéro ne change pas le chiffre de contrôle : le numéro imprimé tranche
  if (chiffreControle(numero) === Number(chiffre) && (imprimes.has(numero) || confirmee.length !== 1)) return lignes;
  const minimum = Math.min(...justes.map(ecarts));
  const meilleures = confirmee.length === 1 ? confirmee : justes.filter((v) => ecarts(v) === minimum);
  if (meilleures.length !== 1) return lignes;
  const copie = [...lignes];
  copie[ligne] = courant.slice(0, debut) + meilleures[0] + courant.slice(debut + 9);
  return copie;
}

/**
 * Retrouve la zone lisible par machine parmi les lignes reconnues (elle est en bas du document), remet chaque
 * caractère dans la catégorie attendue à sa position (un O dans une date devient 0, un 0 dans un nom devient O),
 * puis corrige le numéro d'après son chiffre de contrôle et, s'il y en a, les numéros imprimés ailleurs sur le
 * document (`indices`). Rend null s'il n'y a pas de zone.
 */
export function extraireMrz(lignesLues: string[], indices: string[] = []): string[] | null {
  // Les traits et les points parasites autour de la zone (bord de la carte, reflet) ne sont pas des caractères
  const propres = lignesLues.map((l) => l.toUpperCase().replace(/[«‹(\[{]/g, "<").replace(/[^A-Z0-9<]/g, ""));
  const candidates = propres.map((l) => /^[A-Z0-9<]{26,48}$/.test(l) && l.includes("<"));
  // Dernier groupe de lignes candidates consécutives
  const fin = candidates.lastIndexOf(true);
  if (fin < 0) return null;
  let debut = fin;
  while (debut > 0 && candidates[debut - 1]) debut -= 1;
  const groupe = propres.slice(debut, fin + 1);

  const ajuster = (l: string, longueur: number) => (l.length > longueur ? l.slice(0, longueur) : l.padEnd(longueur, "<"));
  if (groupe.length >= 3 && groupe.slice(-3).every((l) => l.length >= 27 && l.length <= 33)) {
    const lignes = groupe.slice(-3).map((l, i) => appliquerMasque(ajuster(l, 30), MASQUES.TD1[i]!));
    return corrigerNumero(lignes, "TD1", indices);
  }
  if (groupe.length >= 2 && groupe.slice(-2).every((l) => l.length >= 40 && l.length <= 48)) {
    const lignes = groupe.slice(-2).map((l, i) => appliquerMasque(ajuster(l, 44), MASQUES.TD3[i]!));
    return corrigerNumero(lignes, "TD3", indices);
  }
  return null;
}
