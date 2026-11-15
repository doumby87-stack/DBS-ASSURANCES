// Lecteur de documents (tâche 14, ADR 0015 ; étendu par l'ADR 0018) : il reçoit l'image ou le PDF d'un document et
// rend ses champs, que le back-office propose ensuite à une personne. Il sait aussi reconnaître de quel document du
// catalogue il s'agit, quand la personne ne le dit pas. Deux lecteurs :
//   · « anthropic » : un modèle Claude par l'API d'Anthropic (SDK officiel), sortie structurée selon le schéma du
//     document, repli automatique sur un autre modèle si le premier refuse ;
//   · « simulation » : valeurs d'exemple fixes, pour la démonstration et les tests (refusé en production).
// Une liste de véhicules en classeur Excel se lit sans modèle (classeur.ts), quel que soit le lecteur.
// Rien d'autre que le fichier et des consignes générales ne part : ni nom de client, ni numéro de dossier. Les
// valeurs reçues ne sont ni journalisées ni enregistrées ici.

import Anthropic from "@anthropic-ai/sdk";
import type { Configuration } from "../../config/configuration.js";
import { TYPE_CLASSEUR, type TypePiece } from "../../modules/demandes-site/piece.js";
import { lireClasseurVehicules } from "./classeur.js";
import {
  CATALOGUE, CONSIGNES, DOCUMENTS, demandeReconnaissance, nettoyer, nettoyerReconnaissance, schemaReconnaissance,
  type Champs, type Reconnaissance, type TypeDocument,
} from "./documents.js";

type Echec = { ok: false; raison: "refus" | "illisible" | "indisponible" | "configuration"; message: string };
export type ResultatLecture =
  /** `classeur` : liste lue cellule par cellule dans un classeur Excel, sans modèle */
  | { ok: true; champs: Champs; classeur?: true }
  | Echec;
export type ResultatReconnaissance = { ok: true; reconnaissance: Reconnaissance } | Echec;

export interface Fichier {
  contenu: Buffer;
  type: TypePiece;
}

export interface LecteurDocuments {
  nom: "anthropic" | "simulation";
  lire(document: TypeDocument, fichier: Fichier): Promise<ResultatLecture>;
  /** Quel document du catalogue est-ce, parmi les candidats ? */
  reconnaitre(fichier: Fichier, candidats: readonly TypeDocument[]): Promise<ResultatReconnaissance>;
}

const MESSAGES = {
  refus: "Le service de lecture n'a pas voulu lire ce document. Saisissez les champs à la main.",
  illisible: "Le document n'a pas pu être lu. Essayez avec une photo plus nette, bien cadrée et sans reflet, ou saisissez les champs à la main.",
  indisponible: "Le service de lecture ne répond pas pour l'instant. Réessayez dans quelques minutes, ou saisissez les champs à la main.",
  configuration: "La lecture automatique est mal configurée (clé de l'API refusée). Prévenez la personne qui administre l'outil.",
} as const;
const echec = (raison: keyof typeof MESSAGES): Echec => ({ ok: false, raison, message: MESSAGES[raison] });

/** `fetch` et `maxRetries` : remplaçables dans les tests (aucun appel réseau, pas d'attente entre les essais) */
export function creerLecteur(
  config: Configuration["lecture"], options: { fetch?: typeof fetch; maxRetries?: number } = {},
): LecteurDocuments | null {
  if (!config) return null;
  return avecClasseurs(config.prestataire === "simulation" ? lecteurSimulation() : lecteurAnthropic(config.cleApi, config.modele, options));
}

/** Un classeur Excel n'est pas une image : une liste de véhicules s'y lit cellule par cellule, rien d'autre ne s'y lit */
function avecClasseurs(lecteur: LecteurDocuments): LecteurDocuments {
  return {
    nom: lecteur.nom,
    async lire(document, fichier) {
      if (fichier.type !== TYPE_CLASSEUR) return lecteur.lire(document, fichier);
      if (document !== "liste_vehicules") return echec("illisible");
      const lu = lireClasseurVehicules(fichier.contenu);
      return lu.ok ? { ok: true, champs: lu.champs, classeur: true } : echec("illisible");
    },
    async reconnaitre(fichier, candidats) {
      if (fichier.type !== TYPE_CLASSEUR) return lecteur.reconnaitre(fichier, candidats);
      return {
        ok: true,
        reconnaissance: candidats.includes("liste_vehicules")
          ? { document: "liste_vehicules", confiance: "haute", description: "Classeur Excel" }
          : { document: null, confiance: "haute", description: "Classeur Excel" },
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Claude, par l'API d'Anthropic
// ---------------------------------------------------------------------------------------------------------
function lecteurAnthropic(cleApi: string, modele: string, options: { fetch?: typeof fetch; maxRetries?: number }): LecteurDocuments {
  const client = new Anthropic({
    apiKey: cleApi, maxRetries: options.maxRetries ?? 2, timeout: 120_000, ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  /** Envoie le fichier et une demande ; rend l'objet JSON reçu, conforme au schéma, ou l'échec */
  async function appeler(
    fichier: Fichier, demande: string, schema: Record<string, unknown>,
    reglages: { effort: "low" | "medium"; maxTokens: number; enFlux: boolean },
  ): Promise<{ ok: true; brut: Record<string, unknown> } | Echec> {
    const source = { type: "base64" as const, data: fichier.contenu.toString("base64") };
    const piece = fichier.type === "application/pdf"
      ? { type: "document" as const, source: { ...source, media_type: "application/pdf" as const } }
      : { type: "image" as const, source: { ...source, media_type: fichier.type as "image/jpeg" | "image/png" } };
    const parametres = {
      model: modele,
      max_tokens: reglages.maxTokens,
      // Si le modèle refuse (classificateurs de sécurité), l'API relance la même demande sur le modèle de repli conseillé
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
      system: CONSIGNES,
      messages: [{ role: "user" as const, content: [piece, { type: "text" as const, text: demande }] }],
      output_config: { effort: reglages.effort, format: { type: "json_schema" as const, schema } },
    };
    try {
      // Une longue liste se lit en flux : la réponse peut dépasser le délai d'une requête simple
      const reponse = reglages.enFlux
        ? await client.beta.messages.stream(parametres).finalMessage()
        : await client.beta.messages.create(parametres);
      if (reponse.stop_reason === "refusal") return echec("refus");
      if (reponse.stop_reason === "max_tokens") return echec("illisible");
      const texte = reponse.content.find((bloc) => bloc.type === "text");
      if (!texte || texte.type !== "text") return echec("illisible");
      const brut: unknown = JSON.parse(texte.text);
      if (typeof brut !== "object" || brut === null || Array.isArray(brut)) return echec("illisible");
      return { ok: true, brut: brut as Record<string, unknown> };
    } catch (erreur) {
      if (erreur instanceof SyntaxError) return echec("illisible");
      if (erreur instanceof Anthropic.AuthenticationError || erreur instanceof Anthropic.PermissionDeniedError) return echec("configuration");
      // Fichier refusé par l'API (trop lourd, format, image illisible)
      if (erreur instanceof Anthropic.BadRequestError) return echec("illisible");
      if (erreur instanceof Anthropic.RateLimitError || erreur instanceof Anthropic.InternalServerError
          || erreur instanceof Anthropic.APIConnectionError || erreur instanceof Anthropic.APIError) return echec("indisponible");
      throw erreur;
    }
  }

  return {
    nom: "anthropic",
    async lire(document, fichier) {
      const definition = CATALOGUE[document];
      const reponse = await appeler(fichier, definition.demande, definition.schema, definition.sortieLongue
        ? { effort: "medium", maxTokens: 64_000, enFlux: true }
        : { effort: "medium", maxTokens: 16_000, enFlux: false });
      return reponse.ok ? { ok: true, champs: nettoyer(document, reponse.brut) } : reponse;
    },
    async reconnaitre(fichier, candidats) {
      const reponse = await appeler(fichier, demandeReconnaissance(candidats), schemaReconnaissance(candidats),
        { effort: "low", maxTokens: 2_000, enFlux: false });
      return reponse.ok ? { ok: true, reconnaissance: nettoyerReconnaissance(reponse.brut, candidats) } : reponse;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Simulation : valeurs d'exemple, inventées (catalogue/<document>.ts)
// ---------------------------------------------------------------------------------------------------------
function lecteurSimulation(): LecteurDocuments {
  return {
    nom: "simulation",
    async lire(document) {
      return { ok: true, champs: nettoyer(document, structuredClone(CATALOGUE[document].exemple)) };
    },
    // La simulation ne regarde pas le fichier : elle « reconnaît » le premier candidat, dans l'ordre du catalogue
    async reconnaitre(_fichier, candidats) {
      const document = DOCUMENTS.find((d) => candidats.includes(d)) ?? null;
      return { ok: true, reconnaissance: { document, confiance: "haute", description: document ? `${CATALOGUE[document].libelle} (exemple)` : null } };
    },
  };
}
