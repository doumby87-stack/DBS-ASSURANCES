// Notifications de WhatsApp (webhook) : accusés de remise et de lecture, réponses des clients.
//   · GET : Meta vérifie l'adresse avec le jeton choisi par l'agence, une fois, à l'activation ;
//   · POST : chaque notification est signée avec le secret de l'application. Cette signature remplace
//     le contrôle d'origine du back-office (protection.ts) : sans elle, la requête est refusée.
// Route publique, sans session : elle ne lit rien et ne fait qu'enregistrer accusés et désinscriptions,
// par les fonctions que la base lui ouvre.

import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionSysteme } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import type { ConfigurationWhatsApp } from "../../config/configuration.js";
import { demandeDesinscription, lireNotification, signatureValide } from "./whatsapp.js";

function memesTextes(a: string, b: string): boolean {
  const ta = Buffer.from(a);
  const tb = Buffer.from(b);
  return ta.length === tb.length && timingSafeEqual(ta, tb);
}

export async function routesNotificationsWhatsApp(
  app: FastifyInstance,
  options: { pool: Pool; config: ConfigurationWhatsApp },
): Promise<void> {
  const { pool, config } = options;

  // Le corps est gardé tel quel : la signature porte sur les octets exacts reçus
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 256 * 1024 }, (_requete, corps, fini) => {
    fini(null, corps);
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/webhooks/whatsapp", async (requete, reponse) => {
    const mode = requete.query["hub.mode"];
    const jeton = requete.query["hub.verify_token"] ?? "";
    const defi = requete.query["hub.challenge"] ?? "";
    if (mode === "subscribe" && memesTextes(jeton, config.jetonVerification) && /^[A-Za-z0-9_-]{1,100}$/.test(defi)) {
      return reponse.type("text/plain").send(defi);
    }
    throw erreurs.accesRefuse();
  });

  app.post("/webhooks/whatsapp", { config: { authentifieeParSignature: true } }, async (requete) => {
    const corps = requete.body;
    const signature = requete.headers["x-hub-signature-256"];
    if (!Buffer.isBuffer(corps) || !signatureValide(corps, typeof signature === "string" ? signature : undefined, config.secretApplication)) {
      requete.log.warn("notification WhatsApp refusée : signature absente ou invalide");
      throw erreurs.signatureInvalide();
    }

    let donnees: unknown;
    try {
      donnees = JSON.parse(corps.toString("utf8"));
    } catch {
      throw new ErreurApi(400, "requete_invalide", "Requête invalide.");
    }
    const { accuses, messages } = lireNotification(donnees, config.identifiantNumero);
    const desinscriptions = messages.filter((m) => demandeDesinscription(m.texte));

    // En cas d'erreur, la réponse n'est pas 200 : WhatsApp renverra la notification plus tard
    await transactionSysteme(pool, async (client) => {
      for (const accuse of accuses) {
        await client.query("SELECT app.enregistrer_statut_fournisseur($1, $2, $3)", [accuse.identifiant, accuse.statut, accuse.erreur]);
      }
      for (const message of desinscriptions) {
        await client.query("SELECT app.enregistrer_desinscription($1, 'whatsapp', $2)", [message.telephone, message.texte]);
      }
    });
    // Des nombres seulement : ni numéro ni contenu de message dans les journaux
    requete.log.info({ accuses: accuses.length, messages: messages.length, desinscriptions: desinscriptions.length }, "notification WhatsApp");
    return { recu: true };
  });
}
