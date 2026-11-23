// Réponses au questionnaire de l'assurance choisie, dans une demande de devis du site (devis-par-assurance.ts).
// L'API ne garde que des réponses attendues pour cette assurance, de la bonne forme ; le back-office et le devis
// créé les reçoivent avec leurs libellés.

import { ErreurApi } from "../../commun/erreurs.js";
import type { Branche } from "../../commun/schemas.js";
import { QUESTIONNAIRES, type Question } from "./devis-par-assurance.js";

export type Reponse = string | number | string[];
export type Details = Record<string, Reponse>;

/** Forme générale des réponses (le détail est contrôlé par validerDetails) */
export const schemaDetails = {
  type: "object",
  maxProperties: 20,
  additionalProperties: {
    anyOf: [
      { type: "string", maxLength: 200 },
      { type: "integer" },
      { type: "array", maxItems: 20, items: { type: "string", maxLength: 40 } },
    ],
  },
} as const;

/** Taille maximale des réponses en JSON, comme la base (demandes_site_details_forme) */
const TAILLE_MAX = 4000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const refus = (message: string) => new ErreurApi(422, "details_invalides", message);

export function questionsDe(branche: Branche): readonly Question[] {
  return QUESTIONNAIRES[branche] ?? [];
}

function dateValide(texte: string): boolean {
  const m = DATE.exec(texte);
  if (!m) return false;
  const jour = new Date(`${texte}T00:00:00Z`);
  return !Number.isNaN(jour.getTime()) && jour.toISOString().startsWith(texte) && Number(m[1]) >= 2000 && Number(m[1]) <= 2100;
}

/**
 * Réponses nettoyées (textes rognés, réponses vides retirées), ou refus avec un message pour le visiteur :
 * question inconnue pour cette assurance, réponse de la mauvaise forme, question obligatoire sans réponse.
 */
export function validerDetails(branche: Branche, details: Record<string, unknown>): Details {
  const questions = new Map(questionsDe(branche).map((q) => [q.cle, q]));
  const propres: Details = {};
  for (const [cle, brute] of Object.entries(details)) {
    const q = questions.get(cle);
    if (!q) throw refus("Le formulaire a envoyé une réponse inattendue pour cette assurance : rechargez la page et réessayez.");
    const nomme = `« ${q.libelle} »`;
    switch (q.type) {
      case "texte": {
        if (typeof brute !== "string") throw refus(`${nomme} : réponse invalide.`);
        const texte = brute.trim();
        if (texte.length > q.max) throw refus(`${nomme} : ${q.max} caractères au plus.`);
        if (texte) propres[cle] = texte;
        break;
      }
      case "nombre": {
        if (typeof brute !== "number" || !Number.isInteger(brute) || brute < q.min || brute > q.max) {
          throw refus(`${nomme} : indiquez un nombre entier entre ${q.min} et ${q.max}.`);
        }
        propres[cle] = brute;
        break;
      }
      case "date": {
        if (typeof brute !== "string" || !dateValide(brute)) throw refus(`${nomme} : date invalide.`);
        propres[cle] = brute;
        break;
      }
      case "choix": {
        if (typeof brute !== "string" || !(brute in q.options)) throw refus(`${nomme} : choix invalide.`);
        propres[cle] = brute;
        break;
      }
      case "plusieurs": {
        if (!Array.isArray(brute) || brute.some((v) => typeof v !== "string" || !(v in q.options))) {
          throw refus(`${nomme} : choix invalide.`);
        }
        const choisis = [...new Set(brute as string[])];
        if (choisis.length > 0) propres[cle] = choisis;
        break;
      }
    }
  }
  for (const q of questions.values()) {
    if (q.obligatoire && propres[q.cle] === undefined) throw refus(`« ${q.libelle} » : réponse obligatoire.`);
  }
  if (JSON.stringify(propres).length > TAILLE_MAX) throw refus("Vos réponses sont trop longues : raccourcissez-les.");
  return propres;
}

const enChiffres = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/\s/g, " ");

/** Une réponse, en texte lisible : « 12 », « 7 CV », « Tracteurs routiers, Taxis », « 15/03/2027 » */
function valeurLisible(q: Question, reponse: Reponse): string {
  switch (q.type) {
    case "nombre":
      return typeof reponse === "number" ? `${enChiffres(reponse)}${q.unite ? ` ${q.unite}` : ""}` : String(reponse);
    case "date":
      return typeof reponse === "string" ? reponse.split("-").reverse().join("/") : String(reponse);
    case "choix":
      return typeof reponse === "string" ? (q.options[reponse] ?? reponse) : String(reponse);
    case "plusieurs":
      return (Array.isArray(reponse) ? reponse : [String(reponse)]).map((v) => q.options[v] ?? v).join(", ");
    default:
      return String(reponse);
  }
}

/** Réponses dans l'ordre du formulaire, avec leurs libellés (une clé inconnue reste visible, sous son nom) */
export function detailsLisibles(branche: Branche, details: Details | null): { libelle: string; valeur: string }[] {
  if (!details) return [];
  const questions = questionsDe(branche);
  const connues = questions.filter((q) => details[q.cle] !== undefined)
    .map((q) => ({ libelle: q.libelle, valeur: valeurLisible(q, details[q.cle]!) }));
  const inconnues = Object.entries(details).filter(([cle]) => !questions.some((q) => q.cle === cle))
    .map(([cle, v]) => ({ libelle: cle, valeur: Array.isArray(v) ? v.join(", ") : String(v) }));
  return [...connues, ...inconnues];
}
