// WhatsApp : appel de l'API Cloud, classement des erreurs, signature et lecture des notifications, « STOP ».

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ConfigurationWhatsApp } from "../../src/config/configuration.js";
import {
  creerClientWhatsApp, demandeDesinscription, lireNotification, nettoyerParametre, signatureValide,
} from "../../src/integrations/whatsapp/whatsapp.js";

const config: ConfigurationWhatsApp = {
  jeton: "jeton-de-test",
  identifiantNumero: "106540352242922",
  secretApplication: "secret-de-test",
  jetonVerification: "verif-du-test",
  versionApi: "v23.0",
};

function faux(statut: number, corps: unknown) {
  const appels: { url: string; init: RequestInit }[] = [];
  const recuperer = (async (url: string | URL | Request, init?: RequestInit) => {
    appels.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { appels, recuperer };
}

describe("Envoi d'un modèle", () => {
  it("appelle l'API Cloud avec le jeton, le modèle validé, la langue et les paramètres", async () => {
    const { appels, recuperer } = faux(200, { messaging_product: "whatsapp", messages: [{ id: "wamid.HBgM" }] });
    const resultat = await creerClientWhatsApp(config, recuperer).envoyerModele("+2250749360702", {
      nom: "dbs_echeance_contrat",
      parametres: ["Kouassi  Aya", "automobile\n(police 12)", "29/11/2026"],
    });
    expect(resultat).toEqual({ ok: true, identifiant: "wamid.HBgM" });
    expect(appels[0]!.url).toBe("https://graph.facebook.com/v23.0/106540352242922/messages");
    expect(new Headers(appels[0]!.init.headers).get("authorization")).toBe("Bearer jeton-de-test");
    const corps = JSON.parse(String(appels[0]!.init.body));
    expect(corps).toMatchObject({
      messaging_product: "whatsapp",
      to: "2250749360702",
      type: "template",
      template: { name: "dbs_echeance_contrat", language: { code: "fr" } },
    });
    // Ni saut de ligne ni espaces multiples : Meta refuserait le message
    expect(corps.template.components[0].parameters.map((p: { text: string }) => p.text))
      .toEqual(["Kouassi Aya", "automobile (police 12)", "29/11/2026"]);
  });

  it("explique l'erreur et ne réessaie pas une erreur définitive", async () => {
    const { recuperer } = faux(400, { error: { code: 132001, message: "Template name does not exist in the translation" } });
    const resultat = await creerClientWhatsApp(config, recuperer).envoyerModele("+2250749360702", { nom: "x", parametres: [] });
    expect(resultat).toEqual({
      ok: false,
      erreur: "WhatsApp : modèle inexistant ou pas encore validé par Meta (code 132001, HTTP 400)",
      definitif: true,
    });
  });

  it("réessaie plus tard une limite de débit, une panne ou un jeton expiré", async () => {
    for (const [statut, corps] of [
      [429, { error: { code: 130429 } }],
      [503, {}],
      [401, { error: { code: 190 } }],
    ] as const) {
      const { recuperer } = faux(statut, corps);
      const resultat = await creerClientWhatsApp(config, recuperer).envoyerModele("+2250749360702", { nom: "x", parametres: [] });
      expect(resultat.ok).toBe(false);
      expect(resultat.ok === false && resultat.definitif).toBe(false);
    }
  });

  it("réessaie plus tard si WhatsApp est injoignable", async () => {
    const recuperer = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const resultat = await creerClientWhatsApp(config, recuperer).envoyerModele("+2250749360702", { nom: "x", parametres: [] });
    expect(resultat).toEqual({ ok: false, erreur: "WhatsApp injoignable (réseau ou délai dépassé)", definitif: false });
  });

  it("refuse une réponse sans identifiant de message", async () => {
    const { recuperer } = faux(200, { messages: [] });
    const resultat = await creerClientWhatsApp(config, recuperer).envoyerModele("+2250749360702", { nom: "x", parametres: [] });
    expect(resultat.ok).toBe(false);
  });

  it("nettoie un paramètre trop long", () => {
    expect(nettoyerParametre("a".repeat(500))).toHaveLength(200);
  });
});

describe("Signature des notifications", () => {
  const corps = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
  const signature = `sha256=${createHmac("sha256", config.secretApplication).update(corps).digest("hex")}`;

  it("accepte la signature calculée avec le secret de l'application", () => {
    expect(signatureValide(corps, signature, config.secretApplication)).toBe(true);
  });

  it("refuse une signature absente, mal formée, d'un autre secret ou d'un autre corps", () => {
    expect(signatureValide(corps, undefined, config.secretApplication)).toBe(false);
    expect(signatureValide(corps, "sha1=abc", config.secretApplication)).toBe(false);
    expect(signatureValide(corps, "sha256=zz", config.secretApplication)).toBe(false);
    expect(signatureValide(corps, signature, "autre-secret")).toBe(false);
    expect(signatureValide(Buffer.concat([corps, Buffer.from(" ")]), signature, config.secretApplication)).toBe(false);
  });
});

describe("Lecture des notifications", () => {
  function notification(numero: string, valeur: object) {
    return {
      object: "whatsapp_business_account",
      entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: numero }, ...valeur } }] }],
    };
  }

  it("lit les accusés de remise, de lecture et d'échec, et les réponses des clients", () => {
    const { accuses, messages } = lireNotification(notification(config.identifiantNumero, {
      statuses: [
        { id: "wamid.1", status: "sent" },
        { id: "wamid.1", status: "delivered" },
        { id: "wamid.2", status: "read" },
        { id: "wamid.3", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] },
      ],
      messages: [
        { from: "2250749360702", type: "text", text: { body: "STOP" } },
        { from: "2250749360703", type: "button", button: { text: "Ne plus recevoir", payload: "x" } },
        { from: "pas-un-numero", type: "text", text: { body: "STOP" } },
        { from: "2250749360704", type: "image", image: { id: "1" } },
      ],
    }), config.identifiantNumero);
    expect(accuses).toEqual([
      { identifiant: "wamid.1", statut: "remise", erreur: null },
      { identifiant: "wamid.2", statut: "lue", erreur: null },
      { identifiant: "wamid.3", statut: "echec", erreur: "WhatsApp : numéro sans compte WhatsApp ou message non distribuable (code 131026)" },
    ]);
    expect(messages).toEqual([
      { telephone: "+2250749360702", texte: "STOP" },
      { telephone: "+2250749360703", texte: "Ne plus recevoir" },
    ]);
  });

  it("ignore ce qui concerne un autre numéro du compte, ou n'a pas la forme attendue", () => {
    expect(lireNotification(notification("999", { statuses: [{ id: "wamid.1", status: "read" }] }), config.identifiantNumero))
      .toEqual({ accuses: [], messages: [] });
    expect(lireNotification(null, config.identifiantNumero)).toEqual({ accuses: [], messages: [] });
    expect(lireNotification({ entry: "n'importe quoi" }, config.identifiantNumero)).toEqual({ accuses: [], messages: [] });
  });
});

describe("Demande de désinscription", () => {
  it("reconnaît STOP, Arrêt, le bouton et les variantes courtes", () => {
    for (const texte of ["STOP", " stop. ", "Stop merci", "ARRÊT", "Arrêter", "Désinscription", "Ne plus recevoir", "unsubscribe"]) {
      expect(demandeDesinscription(texte), texte).toBe(true);
    }
  });

  it("ne prend pas une phrase ordinaire pour une désinscription", () => {
    for (const texte of ["Bonjour", "Je veux renouveler", "stop ou encore je ne sais pas", "Arrêt de travail du chauffeur hier", "OK"]) {
      expect(demandeDesinscription(texte), texte).toBe(false);
    }
  });
});
