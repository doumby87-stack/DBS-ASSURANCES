// Lecteur de documents (tâche 14, ADR 0015) : il reçoit l'image ou le PDF d'un document et rend ses champs, que le
// back-office propose ensuite à une personne. Deux lecteurs :
//   · « anthropic » : un modèle Claude par l'API d'Anthropic (SDK officiel), sortie structurée selon le schéma du
//     document, repli automatique sur un autre modèle si le premier refuse ;
//   · « simulation » : valeurs d'exemple fixes, pour la démonstration et les tests (refusé en production).
// Rien d'autre que le fichier et des consignes générales ne part : ni nom de client, ni numéro de dossier. Les
// valeurs reçues ne sont ni journalisées ni enregistrées ici.

import Anthropic from "@anthropic-ai/sdk";
import type { Configuration } from "../../config/configuration.js";
import type { TypePiece } from "../../modules/demandes-site/piece.js";
import { CONSIGNES, DEMANDES, nettoyer, SCHEMAS, type Champs, type TypeDocument } from "./documents.js";

export type ResultatLecture =
  | { ok: true; champs: Champs }
  | { ok: false; raison: "refus" | "illisible" | "indisponible" | "configuration"; message: string };

export interface LecteurDocuments {
  nom: "anthropic" | "simulation";
  lire(document: TypeDocument, fichier: { contenu: Buffer; type: TypePiece }): Promise<ResultatLecture>;
}

const MESSAGES = {
  refus: "Le service de lecture n'a pas voulu lire ce document. Saisissez les champs à la main.",
  illisible: "Le document n'a pas pu être lu. Essayez avec une photo plus nette, bien cadrée et sans reflet, ou saisissez les champs à la main.",
  indisponible: "Le service de lecture ne répond pas pour l'instant. Réessayez dans quelques minutes, ou saisissez les champs à la main.",
  configuration: "La lecture automatique est mal configurée (clé de l'API refusée). Prévenez la personne qui administre l'outil.",
} as const;
const echec = (raison: keyof typeof MESSAGES): ResultatLecture => ({ ok: false, raison, message: MESSAGES[raison] });

/** `fetch` et `maxRetries` : remplaçables dans les tests (aucun appel réseau, pas d'attente entre les essais) */
export function creerLecteur(
  config: Configuration["lecture"], options: { fetch?: typeof fetch; maxRetries?: number } = {},
): LecteurDocuments | null {
  if (!config) return null;
  if (config.prestataire === "simulation") return lecteurSimulation();
  return lecteurAnthropic(config.cleApi, config.modele, options);
}

// ---------------------------------------------------------------------------------------------------------
// Claude, par l'API d'Anthropic
// ---------------------------------------------------------------------------------------------------------
function lecteurAnthropic(cleApi: string, modele: string, options: { fetch?: typeof fetch; maxRetries?: number }): LecteurDocuments {
  const client = new Anthropic({
    apiKey: cleApi, maxRetries: options.maxRetries ?? 2, timeout: 120_000, ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    nom: "anthropic",
    async lire(document, fichier) {
      const source = { type: "base64" as const, data: fichier.contenu.toString("base64") };
      const piece = fichier.type === "application/pdf"
        ? { type: "document" as const, source: { ...source, media_type: "application/pdf" as const } }
        : { type: "image" as const, source: { ...source, media_type: fichier.type } };
      try {
        const reponse = await client.beta.messages.create({
          model: modele,
          max_tokens: 16000,
          // Si le modèle refuse (classificateurs de sécurité), l'API relance la même demande sur le modèle de repli conseillé
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: CONSIGNES,
          messages: [{ role: "user", content: [piece, { type: "text", text: DEMANDES[document] }] }],
          output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMAS[document] } },
        });
        if (reponse.stop_reason === "refusal") return echec("refus");
        if (reponse.stop_reason === "max_tokens") return echec("illisible");
        const texte = reponse.content.find((bloc) => bloc.type === "text");
        if (!texte || texte.type !== "text") return echec("illisible");
        const brut: unknown = JSON.parse(texte.text);
        if (typeof brut !== "object" || brut === null || Array.isArray(brut)) return echec("illisible");
        return { ok: true, champs: nettoyer(document, brut as Record<string, unknown>) };
      } catch (erreur) {
        if (erreur instanceof SyntaxError) return echec("illisible");
        if (erreur instanceof Anthropic.AuthenticationError || erreur instanceof Anthropic.PermissionDeniedError) return echec("configuration");
        // Fichier refusé par l'API (trop lourd, format, image illisible)
        if (erreur instanceof Anthropic.BadRequestError) return echec("illisible");
        if (erreur instanceof Anthropic.RateLimitError || erreur instanceof Anthropic.InternalServerError
            || erreur instanceof Anthropic.APIConnectionError || erreur instanceof Anthropic.APIError) return echec("indisponible");
        throw erreur;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Simulation : valeurs d'exemple, inventées
// ---------------------------------------------------------------------------------------------------------
const EXEMPLES: Record<TypeDocument, Record<string, unknown>> = {
  carte_grise: {
    documentReconnu: true, lisibilite: "bonne", remarques: null,
    immatriculation: "4521 KM 01", numeroChassis: "JTDBR32E720123456", marque: "Toyota", modele: "Corolla", genre: "Voiture particulière",
    energie: "Essence", puissanceFiscale: 8, placesAssises: 5, datePremiereMiseEnCirculation: "2019-03-14", proprietaire: "Koné Mariam",
    usage: "Promenade et affaires",
  },
  piece_identite: {
    documentReconnu: true, lisibilite: "bonne", remarques: null,
    typePiece: "passeport", numero: "L898902C3", nom: "ERIKSSON", prenoms: "ANNA MARIA", dateNaissance: "1974-08-12", lieuNaissance: null,
    sexe: "F", nationalite: "Utopienne", dateDelivrance: null, dateExpiration: "2034-04-15",
    // Spécimen de la norme ICAO 9303 (pays fictif « UTO »), date d'expiration ajustée et chiffres de contrôle recalculés
    mrz: ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F3404159ZE184226B<<<<<16"],
  },
  constat_amiable: {
    documentReconnu: true, lisibilite: "partielle", remarques: "Écriture manuscrite difficile à lire dans la partie observations.",
    date: "2026-10-28", heure: "08:40", lieu: "Carrefour de la Siporex, Yopougon", blesses: false, degatsAutres: false, temoins: null,
    vehicules: [
      { lettre: "A", conducteur: "Koné Mariam", assure: "Koné Mariam", assureur: "SanlamAllianz", numeroPolice: "AUTO-KM-2026", numeroAttestation: null,
        immatriculation: "2024 KM 01", marque: "Toyota Yaris", circonstances: [8], pointDeChoc: "Arrière", degatsApparents: "Pare-chocs arrière enfoncé",
        observations: null },
      { lettre: "B", conducteur: "Traoré Ali", assure: "Traoré Ali", assureur: "Autre compagnie", numeroPolice: null, numeroAttestation: null,
        immatriculation: "7712 GH 01", marque: "Nissan Sunny", circonstances: [8], pointDeChoc: "Avant", degatsApparents: "Capot", observations: null },
    ],
    croquis: "Le véhicule B, roulant derrière A sur la même voie, l'a heurté à l'arrière à l'arrêt au feu.",
  },
};

function lecteurSimulation(): LecteurDocuments {
  return {
    nom: "simulation",
    async lire(document) {
      return { ok: true, champs: nettoyer(document, structuredClone(EXEMPLES[document])) };
    },
  };
}
