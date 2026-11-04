// API WhatsApp Cloud de Meta (ADR 0007) :
//   · envoi des modèles de message validés par Meta (seul moyen d'écrire en premier à un client) ;
//   · vérification de la signature des notifications reçues (accusés de remise et de lecture, réponses) ;
//   · lecture de ces notifications, et reconnaissance d'une demande de désinscription (« STOP »).
// Documentation : https://developers.facebook.com/docs/whatsapp/cloud-api

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ConfigurationWhatsApp } from "../../config/configuration.js";
import type { ResultatEnvoi } from "../envoi.js";

export interface ModeleWhatsApp {
  /** Nom du modèle validé par Meta. */
  nom: string;
  /** Valeurs de {{1}}, {{2}}… dans le corps du modèle, dans l'ordre. */
  parametres: string[];
}

const DELAI_MS = 10_000;

/** Erreurs fréquentes de l'API Cloud, expliquées pour l'écran des relances. */
const ERREURS_CONNUES: Record<number, string> = {
  190: "jeton d'accès WhatsApp expiré ou révoqué",
  368: "compte WhatsApp temporairement restreint par Meta",
  130429: "limite de débit de WhatsApp atteinte",
  131026: "numéro sans compte WhatsApp ou message non distribuable",
  131030: "numéro pas autorisé (compte WhatsApp encore en test)",
  131031: "compte WhatsApp Business bloqué par Meta",
  131047: "conversation fermée depuis plus de 24 heures",
  131048: "limite d'envoi atteinte après des signalements",
  131049: "message non distribué par WhatsApp (limite d'engagement)",
  131050: "le client a bloqué les messages de l'agence sur WhatsApp",
  131056: "trop de messages envoyés à ce numéro en peu de temps",
  132000: "nombre de paramètres différent du modèle validé",
  132001: "modèle inexistant ou pas encore validé par Meta",
  132015: "modèle suspendu par Meta",
};

/** Erreurs passagères : un nouvel essai peut réussir (configuration corrigée, limite levée…). */
const ERREURS_PASSAGERES = new Set([190, 368, 130429, 131031, 131048, 131056]);

function decrireErreur(statutHttp: number, code: number | null): string {
  const explication = code !== null ? ERREURS_CONNUES[code] : undefined;
  const reference = code !== null ? `code ${code}, HTTP ${statutHttp}` : `HTTP ${statutHttp}`;
  return `WhatsApp : ${explication ?? "envoi refusé"} (${reference})`;
}

function estDefinitive(statutHttp: number, code: number | null): boolean {
  if (statutHttp === 429 || statutHttp >= 500) return false;
  if (code !== null && ERREURS_PASSAGERES.has(code)) return false;
  return true;
}

/** Un paramètre ne contient ni saut de ligne, ni tabulation, ni plus de quatre espaces de suite (règle de Meta). */
export function nettoyerParametre(valeur: string): string {
  return valeur.replace(/\s+/g, " ").trim().slice(0, 200);
}

export function creerClientWhatsApp(config: ConfigurationWhatsApp, recuperer: typeof fetch = fetch) {
  const adresse = `https://graph.facebook.com/${config.versionApi}/${config.identifiantNumero}/messages`;

  return {
    async envoyerModele(destinataire: string, modele: ModeleWhatsApp): Promise<ResultatEnvoi> {
      const corps = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: destinataire.replace(/^\+/, ""),
        type: "template",
        template: {
          name: modele.nom,
          language: { code: "fr" },
          components: [
            { type: "body", parameters: modele.parametres.map((texte) => ({ type: "text", text: nettoyerParametre(texte) })) },
          ],
        },
      };

      let reponse: Response;
      try {
        reponse = await recuperer(adresse, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.jeton}`, "Content-Type": "application/json" },
          body: JSON.stringify(corps),
          signal: AbortSignal.timeout(DELAI_MS),
        });
      } catch {
        return { ok: false, erreur: "WhatsApp injoignable (réseau ou délai dépassé)", definitif: false };
      }

      const donnees = (await reponse.json().catch(() => null)) as {
        messages?: { id?: unknown }[];
        error?: { code?: unknown };
      } | null;
      const identifiant = donnees?.messages?.[0]?.id;
      if (reponse.ok && typeof identifiant === "string" && identifiant.length > 0) {
        return { ok: true, identifiant };
      }
      const code = typeof donnees?.error?.code === "number" ? donnees.error.code : null;
      return { ok: false, erreur: decrireErreur(reponse.status, code), definitif: estDefinitive(reponse.status, code) };
    },
  };
}

/**
 * Signature d'une notification : en-tête X-Hub-Signature-256 = « sha256= » + HMAC-SHA256 du corps
 * exact reçu, avec le secret de l'application. Comparaison en temps constant.
 */
export function signatureValide(corps: Buffer, entete: string | undefined, secret: string): boolean {
  if (typeof entete !== "string" || !entete.startsWith("sha256=")) return false;
  const recue = Buffer.from(entete.slice("sha256=".length), "hex");
  const attendue = createHmac("sha256", secret).update(corps).digest();
  return recue.length === attendue.length && timingSafeEqual(recue, attendue);
}

export interface AccuseWhatsApp {
  identifiant: string;
  statut: "remise" | "lue" | "echec";
  erreur: string | null;
}

export interface MessageRecu {
  /** Numéro de l'expéditeur, au format E.164. */
  telephone: string;
  texte: string;
}

const STATUTS: Record<string, AccuseWhatsApp["statut"]> = { delivered: "remise", read: "lue", failed: "echec" };

function objet(valeur: unknown): Record<string, unknown> {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : {};
}

function liste(valeur: unknown): unknown[] {
  return Array.isArray(valeur) ? valeur : [];
}

function texteDe(message: Record<string, unknown>): string | null {
  const candidats = [objet(message.text).body, objet(message.button).text, objet(objet(message.interactive).button_reply).title];
  const texte = candidats.find((c): c is string => typeof c === "string");
  return texte ? texte.slice(0, 500) : null;
}

/**
 * Accusés et messages d'une notification, pour le numéro de l'agence seulement : ce qui concerne un autre
 * numéro du même compte, ou n'a pas la forme attendue, est ignoré.
 */
export function lireNotification(corps: unknown, identifiantNumero: string): { accuses: AccuseWhatsApp[]; messages: MessageRecu[] } {
  const accuses: AccuseWhatsApp[] = [];
  const messages: MessageRecu[] = [];
  for (const entree of liste(objet(corps).entry)) {
    for (const changement of liste(objet(entree).changes)) {
      const valeur = objet(objet(changement).value);
      if (objet(valeur.metadata).phone_number_id !== identifiantNumero) continue;

      for (const brut of liste(valeur.statuses)) {
        const accuse = objet(brut);
        const statut = typeof accuse.status === "string" ? STATUTS[accuse.status] : undefined;
        if (!statut || typeof accuse.id !== "string" || accuse.id.length > 200) continue;
        const code = objet(liste(accuse.errors)[0]).code;
        const erreur = statut === "echec"
          ? `WhatsApp : ${(typeof code === "number" && ERREURS_CONNUES[code]) || "message non remis"}${typeof code === "number" ? ` (code ${code})` : ""}`
          : null;
        accuses.push({ identifiant: accuse.id, statut, erreur });
      }

      for (const brut of liste(valeur.messages)) {
        const message = objet(brut);
        const texte = texteDe(message);
        if (typeof message.from !== "string" || !/^[1-9][0-9]{7,14}$/.test(message.from) || texte === null) continue;
        messages.push({ telephone: `+${message.from}`, texte });
      }
    }
  }
  return { accuses, messages };
}

const DESINSCRIPTION = new Set([
  "stop", "arret", "arreter", "arretez", "desinscription", "desinscrire", "desabonner", "desabonnement",
  "unsubscribe", "ne plus recevoir",
]);

/** « STOP », « Arrêt », « stop merci », bouton « Ne plus recevoir »… ; pas une phrase où « stop » est noyé. */
export function demandeDesinscription(texte: string): boolean {
  const mots = texte
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  if (DESINSCRIPTION.has(mots)) return true;
  const decoupe = mots.split(" ");
  return decoupe.length <= 3 && DESINSCRIPTION.has(decoupe[0] ?? "");
}
