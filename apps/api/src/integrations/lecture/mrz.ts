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
