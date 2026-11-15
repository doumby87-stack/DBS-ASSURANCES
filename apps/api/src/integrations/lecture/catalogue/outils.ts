// Outils communs au catalogue des documents lus (ADR 0015, étendu par l'ADR 0018) : schémas JSON de la sortie
// structurée, nettoyage des valeurs reçues et contrôles. Chaque document du catalogue se décrit en un seul endroit
// (catalogue/<document>.ts) avec `definir` : ce qu'il faut demander, comment le reconnaître, comment nettoyer et
// contrôler ce qui est lu, et des valeurs d'exemple pour la simulation.

export type Brut = Record<string, unknown>;

/** Champs présents dans chaque lecture, quel que soit le document */
export interface Commun {
  /** Le document montré est bien du type demandé */
  documentReconnu: boolean;
  lisibilite: "bonne" | "partielle" | "mauvaise";
  remarques: string | null;
  /** Champs dont la valeur lue est douteuse (écriture peu lisible, caractère ambigu) : surlignés pour la personne */
  champsIncertains: string[];
}

export interface Controle {
  /** Champ concerné, ou null pour le document entier */
  champ: string | null;
  niveau: "ok" | "attention";
  message: string;
}

export interface Definition<C extends Commun = Commun> {
  libelle: string;
  /** À quoi on reconnaît ce document parmi d'autres (reconnaissance automatique) */
  signes: string;
  /** Ce que l'on demande au lecteur pour ce document */
  demande: string;
  /** Schéma JSON de la sortie structurée */
  schema: Record<string, unknown>;
  /** Champs propres au document (hors champs communs), dans l'ordre du schéma */
  champs: string[];
  nettoyer(brut: Brut): C;
  controler(champs: C, aujourdhui: Date): Controle[];
  /** Valeurs d'exemple, inventées, rendues par le lecteur de simulation */
  exemple: Brut;
  /** Réponse potentiellement longue (une ligne par véhicule) : lue en flux, avec plus de place */
  sortieLongue?: boolean;
}

// ---------------------------------------------------------------------------------------------------------
// Schémas JSON (sortie structurée) : chaque champ est présent, null s'il est absent ou illisible
// ---------------------------------------------------------------------------------------------------------
export const texte = { type: "string" } as const;
export const ouNul = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
export const date = { type: "string", format: "date" } as const;
export const entierSchema = { type: "integer" } as const;
export const booleenSchema = { type: "boolean" } as const;
export const liste = (items: object) => ({ type: "array", items });

export function objet(proprietes: Record<string, object>, descriptions: Record<string, string> = {}) {
  const avecDescriptions = Object.fromEntries(
    Object.entries(proprietes).map(([nom, schema]) => [nom, descriptions[nom] ? { ...schema, description: descriptions[nom] } : schema]),
  );
  return { type: "object", properties: avecDescriptions, required: Object.keys(proprietes), additionalProperties: false };
}

const COMMUNS = {
  documentReconnu: booleenSchema,
  lisibilite: { type: "string", enum: ["bonne", "partielle", "mauvaise"] },
  remarques: ouNul(texte),
  champsIncertains: liste(texte),
};
const DESCRIPTIONS_COMMUNES = {
  documentReconnu: "true seulement si le document montré est bien du type demandé",
  lisibilite: "lisibilité d'ensemble de la photo ou du fichier",
  remarques: "ce qui gêne la lecture (reflet, partie coupée, rature), en une phrase ; null sinon",
  champsIncertains: "noms des champs dont tu as recopié la valeur sans en être sûr (caractère ambigu, écriture peu lisible) ; liste vide sinon",
};

// ---------------------------------------------------------------------------------------------------------
// Nettoyage des valeurs reçues : types vérifiés, longueurs bornées, dates valides
// ---------------------------------------------------------------------------------------------------------
export function chaine(valeur: unknown, max = 200): string | null {
  if (typeof valeur !== "string") return null;
  const propre = valeur.replace(/\s+/g, " ").trim();
  return propre ? propre.slice(0, max) : null;
}
export function entier(valeur: unknown, min: number, max: number): number | null {
  return typeof valeur === "number" && Number.isInteger(valeur) && valeur >= min && valeur <= max ? valeur : null;
}
export function dateValide(valeur: unknown): string | null {
  if (typeof valeur !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return null;
  const [a, m, j] = valeur.split("-").map(Number);
  const d = new Date(Date.UTC(a!, m! - 1, j!));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m! - 1 && d.getUTCDate() === j && a! >= 1900 && a! <= 2100 ? valeur : null;
}
export function booleen(valeur: unknown): boolean | null {
  return typeof valeur === "boolean" ? valeur : null;
}
export function parmi<T extends string>(valeur: unknown, valeurs: readonly T[]): T | null {
  return typeof valeur === "string" && (valeurs as readonly string[]).includes(valeur) ? (valeur as T) : null;
}
/** Immatriculation : majuscules, espaces simples */
export function immatriculation(valeur: unknown): string | null {
  return chaine(valeur, 20)?.toUpperCase() ?? null;
}
/** Numéro de châssis (VIN) : majuscules, sans espaces */
export function chassis(valeur: unknown): string | null {
  return chaine(valeur, 30)?.replace(/\s/g, "").toUpperCase() ?? null;
}
/** Éléments d'un tableau reçu qui sont des objets, au plus `max` */
export function objets(valeur: unknown, max: number): Brut[] {
  return Array.isArray(valeur) ? valeur.filter((v): v is Brut => typeof v === "object" && v !== null && !Array.isArray(v)).slice(0, max) : [];
}
/** Textes d'un tableau reçu, nettoyés, sans doublon, au plus `max` */
export function textes(valeur: unknown, max: number, longueur = 120): string[] {
  if (!Array.isArray(valeur)) return [];
  return [...new Set(valeur.map((v) => chaine(v, longueur)).filter((v): v is string => v !== null))].slice(0, max);
}

// ---------------------------------------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------------------------------------
export const jour = (d: Date) => d.toISOString().slice(0, 10);

/** Écart en jours entre deux dates AAAA-MM-JJ (positif si `b` est après `a`) */
export function joursEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const REGEX_VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
export const REGEX_IMMATRICULATION = /^[A-Z0-9][A-Z0-9 -]{2,14}$/;

export function controleImmatriculation(champ: string, valeur: string | null, document: string): Controle[] {
  return valeur && !REGEX_IMMATRICULATION.test(valeur)
    ? [{ champ, niveau: "attention", message: `Immatriculation inhabituelle : vérifiez-la sur ${document}.` }]
    : [];
}
export function controleChassis(champ: string, valeur: string | null, document: string): Controle[] {
  return valeur && !REGEX_VIN.test(valeur)
    ? [{ champ, niveau: "attention", message: `Un numéro de châssis (VIN) compte 17 caractères, sans les lettres I, O et Q : vérifiez-le sur ${document}.` }]
    : [];
}
export function controleDatePassee(champ: string, valeur: string | null, aujourdhui: Date, message: string): Controle[] {
  return valeur && valeur < jour(aujourdhui) ? [{ champ, niveau: "attention", message }] : [];
}
export function controleDateFuture(champ: string, valeur: string | null, aujourdhui: Date, message: string): Controle[] {
  return valeur && valeur > jour(aujourdhui) ? [{ champ, niveau: "attention", message }] : [];
}

// ---------------------------------------------------------------------------------------------------------
// Définition d'un document
// ---------------------------------------------------------------------------------------------------------
export function definir<C extends Commun>(d: {
  libelle: string;
  signes: string;
  demande: string;
  proprietes: Record<string, object>;
  descriptions?: Record<string, string>;
  nettoyer: (brut: Brut) => Omit<C, keyof Commun>;
  controler?: (champs: C, aujourdhui: Date) => Controle[];
  exemple: Brut;
  sortieLongue?: boolean;
}): Definition<C> {
  const champs = Object.keys(d.proprietes);
  return {
    libelle: d.libelle,
    signes: d.signes,
    demande: d.demande,
    schema: objet({ ...COMMUNS, ...d.proprietes }, { ...DESCRIPTIONS_COMMUNES, ...d.descriptions }),
    champs,
    nettoyer: (brut) => ({
      documentReconnu: brut.documentReconnu === true,
      lisibilite: parmi(brut.lisibilite, ["bonne", "partielle", "mauvaise"] as const) ?? "mauvaise",
      remarques: chaine(brut.remarques, 300),
      // Seuls les noms de champs du document sont gardés : le reste ne veut rien dire pour le formulaire
      champsIncertains: Array.isArray(brut.champsIncertains)
        ? [...new Set(brut.champsIncertains.filter((c): c is string => typeof c === "string" && champs.includes(c)))]
        : [],
      ...d.nettoyer(brut),
    }) as C,
    controler: d.controler ?? (() => []),
    exemple: d.exemple,
    ...(d.sortieLongue ? { sortieLongue: true } : {}),
  };
}
