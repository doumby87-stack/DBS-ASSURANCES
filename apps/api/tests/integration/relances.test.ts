// Relances : consentements, planification et envoi, notifications de WhatsApp, annulation, rôle par rôle.
// L'envoi passe par une messagerie de test : rien ne part vers WhatsApp.

import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResultatEnvoi } from "../../src/integrations/envoi.js";
import { executerCycle } from "../../src/modules/relances/cycle.js";
import type { MessageAEnvoyer, Messagerie } from "../../src/modules/relances/messagerie.js";
import { connecter, creerCompte, demarrer, envoyer, type Contexte } from "./outils.js";

const WHATSAPP = {
  WHATSAPP_JETON: "jeton-de-test",
  WHATSAPP_IDENTIFIANT_NUMERO: "106540352242922",
  WHATSAPP_SECRET_APPLICATION: "secret-du-test",
  WHATSAPP_JETON_VERIFICATION: "verif-du-test",
};

let ctx: Contexte;
const cookies: Record<string, string> = {};

/** Messagerie de test : garde chaque message, répond ce qu'on lui dit (succès par défaut). */
const envois: { message: MessageAEnvoyer; resultat: ResultatEnvoi }[] = [];
let repondre: (message: MessageAEnvoyer) => ResultatEnvoi | Promise<ResultatEnvoi> = () => ({
  ok: true, identifiant: `wamid.test-${envois.length + 1}`,
});
const messagerie: Messagerie = {
  canaux: ["whatsapp", "sms"],
  simulation: false,
  async envoyer(message) {
    const resultat = await repondre(message);
    envois.push({ message, resultat });
    return resultat;
  },
};

let suite = 0;
function telephoneUnique(): string {
  suite += 1;
  return `01${String((Date.now() + suite) % 100_000_000).padStart(8, "0")}`;
}

function aujourdHuiPlus(jours: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** Client avec un contrat en vigueur (prime payée au guichet) dont l'échéance tombe dans `jours` jours. */
async function clientAvecContrat(nom: string, jours: number): Promise<{ id: string; telephone: string; contratId: string }> {
  const client = await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele, corps: { type: "particulier", nom, telephone: telephoneUnique() } });
  expect(client.statusCode).toBe(201);
  const { id, telephone } = client.json().client;
  const contrat = await envoyer(ctx, {
    url: "/contrats", cookie: cookies.charge_clientele,
    corps: { clientId: id, branche: "automobile", numeroPolice: `POL-${Date.now()}-${suite}`, dateEffet: aujourdHuiPlus(jours - 365), dateEcheance: aujourdHuiPlus(jours), primeTtc: 30000 },
  });
  expect(contrat.statusCode).toBe(201);
  const contratId = contrat.json().contrat.id;
  const paiement = await envoyer(ctx, { url: "/encaissements", cookie: cookies.caissier, corps: { contratId, montant: 30000, mode: "especes" } });
  expect(paiement.statusCode).toBe(201);
  return { id, telephone, contratId };
}

async function consentir(clientId: string, canal: "whatsapp" | "sms", accorde = true) {
  const reponse = await envoyer(ctx, {
    url: `/clients/${clientId}/consentements`, cookie: cookies.charge_clientele,
    corps: { canal, accorde, preuve: "Accord oral au guichet" },
  });
  expect(reponse.statusCode).toBe(201);
}

async function relancesDe(clientId: string) {
  const fiche = await envoyer(ctx, { url: `/clients/${clientId}`, cookie: cookies.gerant });
  return fiche.json().relances as { id: string; type: string; canal: string; statut: string; motif: string | null; texte: string }[];
}

function notificationSignee(valeur: object, secret = WHATSAPP.WHATSAPP_SECRET_APPLICATION) {
  const corps = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: WHATSAPP.WHATSAPP_IDENTIFIANT_NUMERO }, ...valeur } }] }],
  });
  return { corps, signature: `sha256=${createHmac("sha256", secret).update(corps).digest("hex")}` };
}

beforeAll(async () => {
  ctx = await demarrer({ env: { ...WHATSAPP, RELANCES_HEURES_ENVOI: "0-24" }, messagerie });
  for (const role of ["gerant", "charge_clientele", "caissier", "commercial", "apporteur", "auditeur"] as const) {
    cookies[role] = await connecter(ctx, await creerCompte(ctx, role));
  }
});
afterAll(async () => {
  await ctx.fermer();
});

describe("Consentements", () => {
  it("notés avec leur preuve par qui tient les fiches clients, visibles sur la fiche", async () => {
    const { id } = await clientAvecContrat("Aya Consentement", 90);
    const reponse = await envoyer(ctx, {
      url: `/clients/${id}/consentements`, cookie: cookies.commercial,
      corps: { canal: "whatsapp", accorde: true, preuve: "  Formulaire de souscription signé " },
    });
    expect(reponse.statusCode).toBe(201);
    expect(reponse.json().consentement).toMatchObject({
      canal: "whatsapp", accorde: true, source: "agence", preuve: "Formulaire de souscription signé", enregistrePar: "Test commercial",
    });
    const fiche = await envoyer(ctx, { url: `/clients/${id}`, cookie: cookies.caissier });
    expect(fiche.json().consentements).toEqual([expect.objectContaining({ canal: "whatsapp", accorde: true })]);
  });

  it("refusés à la caisse et à l'apporteur, sans preuve, ou pour un client inconnu", async () => {
    const { id } = await clientAvecContrat("Aya Refus", 90);
    const corps = { canal: "sms", accorde: true, preuve: "Accord oral" };
    for (const role of ["caissier", "apporteur", "auditeur"]) {
      expect((await envoyer(ctx, { url: `/clients/${id}/consentements`, cookie: cookies[role], corps })).statusCode).toBe(403);
    }
    expect((await envoyer(ctx, { url: `/clients/${id}/consentements`, cookie: cookies.charge_clientele, corps: { ...corps, preuve: "ok" } })).statusCode).toBe(400);
    const vide = await envoyer(ctx, { url: `/clients/${id}/consentements`, cookie: cookies.charge_clientele, corps: { ...corps, preuve: "  a  " } });
    expect(vide.statusCode).toBe(422);
    expect(vide.json().code).toBe("preuve_obligatoire");
    const inconnu = await envoyer(ctx, {
      url: "/clients/00000000-0000-4000-8000-000000000000/consentements", cookie: cookies.charge_clientele, corps,
    });
    expect(inconnu.statusCode).toBe(404);
  });
});

describe("Planification et envoi", () => {
  let whatsapp: Awaited<ReturnType<typeof clientAvecContrat>>;
  let sms: Awaited<ReturnType<typeof clientAvecContrat>>;
  let muet: Awaited<ReturnType<typeof clientAvecContrat>>;

  beforeAll(async () => {
    whatsapp = await clientAvecContrat("Koné WhatsApp", 20);
    sms = await clientAvecContrat("Bamba SMS", 5);
    muet = await clientAvecContrat("Diallo Sans Accord", 10);
    await consentir(whatsapp.id, "whatsapp");
    await consentir(sms.id, "whatsapp", false);
    await consentir(sms.id, "sms");
  });

  it("seul le gérant lance un cycle", async () => {
    expect((await envoyer(ctx, { url: "/relances/cycle", cookie: cookies.charge_clientele, corps: {} })).statusCode).toBe(403);
  });

  it("relance chaque client sur le canal qu'il a accepté, une seule fois", async () => {
    const avant = envois.length;
    const cycle = await envoyer(ctx, { url: "/relances/cycle", cookie: cookies.gerant, corps: {} });
    expect(cycle.statusCode).toBe(200);
    expect(cycle.json().bilan).toEqual({ dejaEnCours: false, planifiees: 2, horsHeures: false, envoyees: 2, erreurs: 0 });

    const nouveaux = envois.slice(avant).map((e) => e.message);
    expect(nouveaux).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "echeance_j30", canal: "whatsapp", destinataire: whatsapp.telephone,
        parametres: expect.objectContaining({ nom: "Koné WhatsApp", branche: "automobile", dateEcheance: aujourdHuiPlus(20) }) }),
      expect.objectContaining({ type: "echeance_j7", canal: "sms", destinataire: sms.telephone }),
    ]));
    expect(nouveaux.some((m) => m.destinataire === muet.telephone)).toBe(false);

    const second = await envoyer(ctx, { url: "/relances/cycle", cookie: cookies.gerant, corps: {} });
    expect(second.json().bilan).toMatchObject({ planifiees: 0, envoyees: 0 });
    expect(envois.length).toBe(avant + 2);
  });

  it("montre les relances envoyées, et celles à faire à la main faute d'accord", async () => {
    const reponse = await envoyer(ctx, { url: "/relances", cookie: cookies.gerant });
    expect(reponse.statusCode).toBe(200);
    const donnees = reponse.json();
    expect(donnees.configuration).toEqual({ canaux: ["whatsapp", "sms"], simulation: false, heuresEnvoi: { debut: 0, fin: 24 } });
    expect(donnees.resume.envoyee).toBeGreaterThanOrEqual(2);
    const envoyee = donnees.relances.find((r: { clientId: string }) => r.clientId === whatsapp.id);
    expect(envoyee).toMatchObject({ type: "echeance_j30", canal: "whatsapp", statut: "envoyee", clientNom: "Koné WhatsApp" });
    expect(envoyee.texte).toContain("Bonjour Koné WhatsApp, votre assurance automobile (police POL-");
    const aLaMain = donnees.aFaireALaMain.find((r: { clientId: string }) => r.clientId === muet.id);
    expect(aLaMain).toMatchObject({ type: "echeance_j15", clientNom: "Diallo Sans Accord", telephone: muet.telephone });
    expect(aLaMain.texte).toContain("arrive à échéance le");

    const filtre = await envoyer(ctx, { url: "/relances?statut=echec", cookie: cookies.auditeur });
    expect(filtre.statusCode).toBe(200);
    expect(filtre.json().relances.every((r: { statut: string }) => r.statut === "echec")).toBe(true);
    expect((await envoyer(ctx, { url: "/relances?statut=inconnu", cookie: cookies.gerant })).statusCode).toBe(400);
  });

  it("la caisse et l'apporteur ne suivent pas les relances", async () => {
    expect((await envoyer(ctx, { url: "/relances", cookie: cookies.caissier })).statusCode).toBe(403);
    expect((await envoyer(ctx, { url: "/relances", cookie: cookies.apporteur })).statusCode).toBe(403);
    const fiche = await envoyer(ctx, { url: `/clients/${whatsapp.id}`, cookie: cookies.caissier });
    expect(fiche.json().relances).toEqual([]);
    expect(await relancesDe(whatsapp.id)).toEqual([expect.objectContaining({ type: "echeance_j30", statut: "envoyee" })]);
  });

  describe("Notifications de WhatsApp", () => {
    it("répond au défi de vérification seulement avec le bon jeton", async () => {
      const ok = await ctx.app.inject({
        method: "GET",
        url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verif-du-test&hub.challenge=1158201444",
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toBe("1158201444");
      const refus = await ctx.app.inject({
        method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=devine&hub.challenge=1158201444",
      });
      expect(refus.statusCode).toBe(403);
      expect(refus.body).not.toContain("1158201444");
    });

    it("refuse une notification sans signature ou mal signée", async () => {
      const { corps, signature } = notificationSignee({ statuses: [] });
      // Dernier chiffre changé à coup sûr : la signature ne correspond plus
      const alteree = signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");
      for (const enTetes of [{}, { "x-hub-signature-256": alteree }, { "x-hub-signature-256": notificationSignee({}, "autre").signature }]) {
        const reponse = await ctx.app.inject({
          method: "POST", url: "/webhooks/whatsapp", payload: corps, headers: { "content-type": "application/json", ...enTetes },
        });
        expect(reponse.statusCode).toBe(401);
        expect(reponse.json().code).toBe("signature_invalide");
      }
    });

    it("enregistre la remise et la lecture, puis retire l'accord du client qui répond STOP", async () => {
      const identifiant = envois.find((e) => e.message.destinataire === whatsapp.telephone)!.resultat;
      expect(identifiant.ok).toBe(true);
      const { corps, signature } = notificationSignee({
        statuses: [
          { id: identifiant.ok && identifiant.identifiant, status: "delivered", timestamp: "1", recipient_id: whatsapp.telephone.slice(1) },
          { id: identifiant.ok && identifiant.identifiant, status: "read", timestamp: "2", recipient_id: whatsapp.telephone.slice(1) },
        ],
        messages: [{ from: whatsapp.telephone.slice(1), id: "wamid.recu", timestamp: "3", type: "text", text: { body: "Stop" } }],
      });
      // Aucun en-tête Origin, ou celui d'un autre site : c'est la signature qui compte
      const reponse = await ctx.app.inject({
        method: "POST", url: "/webhooks/whatsapp", payload: corps,
        headers: { "content-type": "application/json", "x-hub-signature-256": signature, origin: "https://autre-site.example" },
      });
      expect(reponse.statusCode).toBe(200);

      expect(await relancesDe(whatsapp.id)).toEqual([expect.objectContaining({ statut: "lue" })]);
      const fiche = await envoyer(ctx, { url: `/clients/${whatsapp.id}`, cookie: cookies.charge_clientele });
      expect(fiche.json().consentements).toEqual([
        expect.objectContaining({ canal: "whatsapp", accorde: false, source: "reponse_client", enregistrePar: null }),
      ]);
    });
  });
});

describe("Erreurs d'envoi et annulation", () => {
  it("réessaie une erreur passagère ; le chargé de clientèle peut annuler avant l'envoi", async () => {
    const { id } = await clientAvecContrat("Ouattara Panne", 3);
    await consentir(id, "whatsapp");
    repondre = () => ({ ok: false, erreur: "WhatsApp injoignable (réseau ou délai dépassé)", definitif: false });
    try {
      const cycle = await envoyer(ctx, { url: "/relances/cycle", cookie: cookies.gerant, corps: {} });
      expect(cycle.json().bilan).toMatchObject({ planifiees: 1, envoyees: 0, erreurs: 1 });
    } finally {
      repondre = () => ({ ok: true, identifiant: `wamid.test-${envois.length + 1}` });
    }
    const [relance] = await relancesDe(id);
    expect(relance).toMatchObject({ type: "echeance_j7", statut: "a_envoyer", motif: "WhatsApp injoignable (réseau ou délai dépassé)" });

    expect((await envoyer(ctx, { url: `/relances/${relance!.id}/annulation`, cookie: cookies.commercial, corps: {} })).statusCode).toBe(403);
    const annulation = await envoyer(ctx, { url: `/relances/${relance!.id}/annulation`, cookie: cookies.charge_clientele, corps: {} });
    expect(annulation.statusCode).toBe(200);
    expect(annulation.json().relance.statut).toBe("annulee");

    // Le prochain essai n'enverra rien : la relance est annulée
    const cycle = await envoyer(ctx, { url: "/relances/cycle", cookie: cookies.gerant, corps: {} });
    expect(cycle.json().bilan.envoyees).toBe(0);
  });

  it("met en échec une erreur définitive, et refuse d'annuler ce qui est parti", async () => {
    const { id } = await clientAvecContrat("Yao Sans WhatsApp", 1);
    await consentir(id, "whatsapp");
    repondre = () => ({ ok: false, erreur: "WhatsApp : numéro sans compte WhatsApp ou message non distribuable (code 131026, HTTP 400)", definitif: true });
    try {
      await envoyer(ctx, { url: "/relances/cycle", cookie: cookies.gerant, corps: {} });
    } finally {
      repondre = () => ({ ok: true, identifiant: `wamid.test-${envois.length + 1}` });
    }
    const [relance] = await relancesDe(id);
    expect(relance).toMatchObject({ statut: "echec", motif: expect.stringContaining("numéro sans compte WhatsApp") });

    const refus = await envoyer(ctx, { url: `/relances/${relance!.id}/annulation`, cookie: cookies.gerant, corps: {} });
    expect(refus.statusCode).toBe(422);
    expect(refus.json().message).toBe("Seule une relance pas encore envoyée peut être annulée");
    const inconnue = await envoyer(ctx, { url: "/relances/00000000-0000-4000-8000-000000000000/annulation", cookie: cookies.gerant, corps: {} });
    expect(inconnue.statusCode).toBe(404);
  });
});

describe("Cycle : heures d'envoi et verrou", () => {
  it("hors des heures d'envoi, planifie sans envoyer ; un seul cycle à la fois", async () => {
    const { id } = await clientAvecContrat("Traoré Nuit", 25);
    await consentir(id, "whatsapp");

    const nuit = await executerCycle(ctx.pool, messagerie, {
      heuresEnvoi: { debut: 8, fin: 20 }, maintenant: () => new Date("2026-11-04T23:30:00Z"),
    });
    expect(nuit).toEqual({ dejaEnCours: false, planifiees: 1, horsHeures: true, envoyees: 0, erreurs: 0 });
    expect(await relancesDe(id)).toEqual([expect.objectContaining({ statut: "a_envoyer" })]);

    // Un premier cycle est bloqué en plein envoi : le second ne fait rien
    let liberer: () => void = () => {};
    const bloque = new Promise<void>((resolve) => {
      liberer = resolve;
    });
    let envoiCommence: () => void = () => {};
    const commence = new Promise<void>((resolve) => {
      envoiCommence = resolve;
    });
    repondre = async () => {
      envoiCommence();
      await bloque;
      return { ok: true, identifiant: `wamid.test-${envois.length + 1}` };
    };
    try {
      const premier = executerCycle(ctx.pool, messagerie, { heuresEnvoi: { debut: 0, fin: 24 } });
      await commence;
      const second = await executerCycle(ctx.pool, messagerie, { heuresEnvoi: { debut: 0, fin: 24 } });
      expect(second.dejaEnCours).toBe(true);
      liberer();
      expect(await premier).toMatchObject({ dejaEnCours: false, envoyees: 1 });
    } finally {
      repondre = () => ({ ok: true, identifiant: `wamid.test-${envois.length + 1}` });
    }
    expect(await relancesDe(id)).toEqual([expect.objectContaining({ statut: "envoyee" })]);
  });
});
