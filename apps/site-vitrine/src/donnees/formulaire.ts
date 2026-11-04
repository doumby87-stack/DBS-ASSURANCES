// Enregistrement des demandes de devis par l'API de l'agence (tâche 7, ADR 0009).
//
// Actif seulement si l'adresse de l'API est donnée à la construction du site (variable URL_API, par exemple
// https://gestion.exemple.ci/api), une fois la déclaration à l'ARTCI faite. Sans elle, le formulaire prépare
// un message WhatsApp ou e-mail, comme avant, et rien n'est enregistré.

function lireAdresseApi(): URL | null {
  const brut = process.env.URL_API?.trim();
  if (!brut) return null;
  const url = new URL(brut);
  // HTTPS obligatoire, sauf pour les essais sur l'ordinateur et les tests
  const essai = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".test");
  if (url.protocol !== "https:" && !essai) throw new Error("URL_API doit commencer par https://");
  return url;
}

const API = lireAdresseApi();

/** Adresse où le formulaire envoie la demande, ou null si l'enregistrement n'est pas activé. */
export const ADRESSE_DEMANDES = API ? `${API.origin}${API.pathname.replace(/\/$/, "")}/site/demandes-devis` : null;
/** Origine de l'API, ajoutée à la politique de sécurité du contenu (connect-src) par astro.config.mjs. */
export const ORIGINE_API = API?.origin ?? null;

/** Texte des cases, enregistré tel quel avec la demande : la preuve de ce que le visiteur a accepté. */
export const ACCORD_TRAITEMENT = "J'accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.";
export const ACCORD_WHATSAPP =
  "J'accepte de recevoir sur WhatsApp les rappels de l'agence (échéances, suivi de mon dossier). Je pourrai répondre STOP à tout moment.";

/** Assurances pour lesquelles on peut joindre la carte grise (comme l'API). */
export const ASSURANCES_AVEC_CARTE_GRISE = ["automobile", "deux_roues", "flotte"];
