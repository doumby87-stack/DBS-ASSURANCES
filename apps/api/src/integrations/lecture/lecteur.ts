// Lecteur de documents (tâche 14, ADR 0015) : il reçoit l'image ou le PDF d'un document et rend ses champs, que le
// back-office propose ensuite à une personne. Deux lecteurs, gratuits, qui travaillent sur les serveurs de l'agence :
//   · « local » : reconnaissance de caractères (Tesseract) dans l'API, puis analyse du texte : libellés, formes
//     connues (immatriculation, châssis, dates), zone lisible par machine corrigée par ses chiffres de contrôle ;
//   · « ollama » : un modèle de vision ouvert, installé avec Ollama sur une machine de l'agence ; il lit aussi
//     l'écriture à la main (constat), avec une sortie structurée selon le schéma du document.
// Rien ne part chez un tiers. Les valeurs lues ne sont ni journalisées ni enregistrées ici.

import type { Configuration } from "../../config/configuration.js";
import type { TypePiece } from "../../modules/demandes-site/piece.js";
import { analyserTexte, fusionner } from "./analyse-locale.js";
import { CONSIGNES, DEMANDES, nettoyer, SCHEMAS, type Champs, type ChampsPieceIdentite, type TypeDocument } from "./documents.js";
import { analyserMrz, extraireMrz } from "./mrz.js";
import { creerOcr, dimensions, imageDuPdf, PIXELS_MAX, type Ocr } from "./ocr.js";

export type ResultatLecture =
  | { ok: true; champs: Champs }
  | { ok: false; raison: "illisible" | "indisponible" | "configuration"; message: string };

export interface FichierLu {
  contenu: Buffer;
  type: TypePiece;
}

/** Faces d'un même document lues ensemble : recto et verso d'une carte grise ou d'une carte d'identité */
export const FACES_MAX = 2;

export interface LecteurDocuments {
  nom: "local" | "ollama";
  lire(document: TypeDocument, fichiers: FichierLu[]): Promise<ResultatLecture>;
  fermer(): Promise<void>;
}

const MESSAGES = {
  illisible: "Le document n'a pas pu être lu. Essayez avec une photo plus nette, bien cadrée et sans reflet, ou saisissez les champs à la main.",
  pdf: "Ce PDF ne contient pas de photo du document. Envoyez plutôt une photo (JPEG ou PNG), ou saisissez les champs à la main.",
  geante: "Cette image est trop grande pour être lue. Envoyez une photo plus petite (moins de 60 millions de pixels).",
  indisponible: "Le service de lecture ne répond pas pour l'instant. Réessayez dans quelques minutes, ou saisissez les champs à la main.",
  configuration: "La lecture automatique est mal configurée (modèle introuvable sur le serveur de lecture). Prévenez la personne qui administre l'outil.",
} as const;
const echec = (raison: "illisible" | "indisponible" | "configuration", message: string = MESSAGES[raison]): ResultatLecture => ({ ok: false, raison, message });

/** Images à lire : chaque photo envoyée, ou celle que contient chaque PDF ; refusées si l'une est démesurée */
function images(fichiers: FichierLu[]): Buffer[] | ResultatLecture {
  const photos: Buffer[] = [];
  for (const fichier of fichiers.slice(0, FACES_MAX)) {
    const photo = fichier.type === "application/pdf" ? imageDuPdf(fichier.contenu) : fichier.contenu;
    if (!photo) return echec("illisible", MESSAGES.pdf);
    const taille = dimensions(photo);
    if (taille && taille.largeur * taille.hauteur > PIXELS_MAX) return echec("illisible", MESSAGES.geante);
    photos.push(photo);
  }
  return photos.length > 0 ? photos : echec("illisible");
}

/** Une zone lisible par machine mal reconnue se corrige souvent d'après ses chiffres de contrôle */
function corrigerZone(champs: Champs, aujourdhui: Date): Champs {
  const piece = champs as ChampsPieceIdentite;
  if (!piece.mrz) return champs;
  const corrigee = extraireMrz(piece.mrz);
  return corrigee && analyserMrz(corrigee, aujourdhui)?.valide ? { ...piece, mrz: corrigee } : champs;
}

/** `ocr` et `fetch` : remplaçables dans les tests */
export function creerLecteur(
  config: Configuration["lecture"], options: { ocr?: Ocr; fetch?: typeof fetch; aujourdhui?: () => Date } = {},
): LecteurDocuments | null {
  if (!config) return null;
  const aujourdhui = options.aujourdhui ?? (() => new Date());
  if (config.prestataire === "local") return lecteurLocal(options.ocr ?? creerOcr(), aujourdhui);
  return lecteurOllama(config.adresse, config.modele, options.fetch ?? fetch, aujourdhui);
}

// ---------------------------------------------------------------------------------------------------------
// Local : Tesseract dans l'API
// ---------------------------------------------------------------------------------------------------------
function lecteurLocal(ocr: Ocr, aujourdhui: () => Date): LecteurDocuments {
  return {
    nom: "local",
    async lire(document, fichiers) {
      const photos = images(fichiers);
      if (!Array.isArray(photos)) return photos;
      const date = aujourdhui();
      const faces = [];
      for (const photo of photos) {
        let lu;
        try {
          // La carte grise écrit aussi en blanc sur fond gris (immatriculation, dates) : seconde lecture inversée
          lu = await ocr.lire(photo, { texteClair: document === "carte_grise" });
        } catch {
          // Image que le moteur ne sait pas décoder
          return echec("illisible");
        }
        if (lu.lignes.length > 0 || lu.lignesClaires.some((l) => l.length > 0)) faces.push(analyserTexte(document, lu, date));
      }
      if (faces.length === 0) return echec("illisible");
      return { ok: true, champs: nettoyer(document, fusionner(faces)) };
    },
    fermer: () => ocr.fermer(),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Ollama : modèle de vision ouvert sur une machine de l'agence
// ---------------------------------------------------------------------------------------------------------
/** Un modèle de vision sur un processeur sans carte graphique peut prendre plusieurs minutes par image */
const DELAI_OLLAMA_MS = 5 * 60_000;

function lecteurOllama(adresse: string, modele: string, appeler: typeof fetch, aujourdhui: () => Date): LecteurDocuments {
  return {
    nom: "ollama",
    async lire(document, fichiers) {
      const photos = images(fichiers);
      if (!Array.isArray(photos)) return photos;
      let reponse: Response;
      try {
        reponse = await appeler(new URL("/api/chat", adresse), {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(DELAI_OLLAMA_MS),
          body: JSON.stringify({
            model: modele,
            stream: false,
            format: SCHEMAS[document],
            options: { temperature: 0 },
            messages: [
              { role: "system", content: CONSIGNES },
              { role: "user", content: DEMANDES[document], images: photos.map((photo) => photo.toString("base64")) },
            ],
          }),
        });
      } catch {
        return echec("indisponible");
      }
      if (reponse.status === 404) return echec("configuration");
      if (reponse.status === 400) return echec("illisible");
      if (!reponse.ok) return echec("indisponible");
      try {
        const corps = (await reponse.json()) as { message?: { content?: unknown }; done_reason?: unknown };
        if (corps.done_reason === "length" || typeof corps.message?.content !== "string") return echec("illisible");
        const brut: unknown = JSON.parse(corps.message.content);
        if (typeof brut !== "object" || brut === null || Array.isArray(brut)) return echec("illisible");
        return { ok: true, champs: corrigerZone(nettoyer(document, brut as Record<string, unknown>), aujourdhui()) };
      } catch {
        return echec("illisible");
      }
    },
    fermer: async () => {},
  };
}
