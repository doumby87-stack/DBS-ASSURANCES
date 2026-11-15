// Prime d'un contrat flotte payée en plusieurs fois : échéancier défini par l'agence, mise en vigueur à la
// première échéance, suivi au tableau de bord, et côté portail : échéancier visible, échéance payée en ligne.

import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EnvoiCodes } from "../../src/modules/portail/connexion.js";
import { connecter, creerCompte, demarrer, envoyer, type Contexte } from "./outils.js";

const ORIGINE_PORTAIL = "https://espace.test.ci";
const NOM_COOKIE_PORTAIL = "__Host-dbs_portail";

let ctx: Contexte;
const cookies: Record<string, string> = {};
const codes: { telephone: string; code: string }[] = [];
const envoiCodes: EnvoiCodes = {
  disponible: true,
  async envoyer(telephone, code) {
    codes.push({ telephone, code });
    return { ok: true, identifiant: `test-${codes.length}` };
  },
};

let suite = 0;
function unique(): string {
  suite += 1;
  return String((Date.now() + suite * 7) % 100_000_000).padStart(8, "0");
}

function aujourdHuiPlus(jours: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

let adresse = 0;
function portail(chemin: string, options: { cookie?: string; corps?: object } = {}): Promise<LightMyRequestResponse> {
  adresse += 1;
  return envoyer(ctx, {
    ip: `203.0.113.${(adresse % 250) + 1}`, url: chemin, origine: ORIGINE_PORTAIL,
    ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.corps ? { corps: options.corps } : {}),
  });
}

async function nouveauContrat(branche: "flotte" | "automobile", primeTtc: number, dateEffet = aujourdHuiPlus(0)) {
  const client = await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele, corps: { type: "entreprise", nom: `Transports ${unique()}`, telephone: `05${unique()}` } });
  const contrat = await envoyer(ctx, {
    url: "/contrats", cookie: cookies.charge_clientele,
    corps: { clientId: client.json().client.id, branche, numeroPolice: `FLT-${unique()}`, dateEffet, dateEcheance: aujourdHuiPlus(360), primeTtc },
  });
  expect(contrat.statusCode).toBe(201);
  return { clientId: client.json().client.id as string, contratId: contrat.json().contrat.id as string };
}

const quatreEcheances = [
  { exigibleLe: aujourdHuiPlus(0), montant: 300_000 },
  { exigibleLe: aujourdHuiPlus(90), montant: 300_000 },
  { exigibleLe: aujourdHuiPlus(180), montant: 300_000 },
  { exigibleLe: aujourdHuiPlus(270), montant: 300_000 },
];

beforeAll(async () => {
  ctx = await demarrer({ env: { URL_PORTAIL: ORIGINE_PORTAIL, PAIEMENT_PRESTATAIRE: "simulation" }, envoiCodes });
  for (const role of ["gerant", "charge_clientele", "commercial", "caissier", "auditeur"] as const) {
    cookies[role] = await connecter(ctx, await creerCompte(ctx, role));
  }
});

afterAll(async () => {
  await ctx?.fermer();
});

describe("Échéancier défini par l'agence", () => {
  it("le chargé de clientèle découpe la prime d'une flotte ; le commercial ne peut pas, une automobile non plus", async () => {
    const { contratId } = await nouveauContrat("flotte", 1_200_000);
    expect((await envoyer(ctx, { url: `/contrats/${contratId}/echeancier`, cookie: cookies.commercial, corps: { echeances: quatreEcheances } })).statusCode).toBe(403);
    const faux = await envoyer(ctx, {
      url: `/contrats/${contratId}/echeancier`, cookie: cookies.charge_clientele,
      corps: { echeances: [{ exigibleLe: aujourdHuiPlus(0), montant: 500_000 }, { exigibleLe: aujourdHuiPlus(90), montant: 500_000 }] },
    });
    expect(faux.json()).toMatchObject({ code: "regle_metier", message: expect.stringContaining("doit être égal à la prime") });

    const defini = await envoyer(ctx, { url: `/contrats/${contratId}/echeancier`, cookie: cookies.charge_clientele, corps: { echeances: quatreEcheances } });
    expect(defini.statusCode).toBe(200);
    expect(defini.json().echeancier).toMatchObject({
      aPayerMaintenant: 300_000,
      prochaine: { rang: 1, reste: 300_000, etat: "bientot" },
    });
    expect(defini.json().echeancier.echeances).toHaveLength(4);

    const auto = await nouveauContrat("automobile", 90_000);
    const refus = await envoyer(ctx, {
      url: `/contrats/${auto.contratId}/echeancier`, cookie: cookies.charge_clientele,
      corps: { echeances: [{ exigibleLe: aujourdHuiPlus(0), montant: 45_000 }, { exigibleLe: aujourdHuiPlus(90), montant: 45_000 }] },
    });
    expect(refus.json().message).toContain("réservé aux contrats flotte");
  });

  it("la première échéance payée met le contrat en vigueur ; la caisse voit ce qui est dû et la suite", async () => {
    const { contratId } = await nouveauContrat("flotte", 1_200_000);
    await envoyer(ctx, { url: `/contrats/${contratId}/echeancier`, cookie: cookies.charge_clientele, corps: { echeances: quatreEcheances } });
    const paiement = await envoyer(ctx, { url: "/encaissements", cookie: cookies.caissier, corps: { contratId, montant: 300_000, mode: "virement", reference: `VIR-${unique()}` } });
    expect(paiement.statusCode).toBe(201);
    expect(paiement.json().contrat.statut).toBe("en_vigueur");

    const situation = (await envoyer(ctx, { url: `/contrats/${contratId}/paiements`, cookie: cookies.auditeur })).json();
    expect(situation.echeancier).toMatchObject({ aPayerMaintenant: 0, prochaine: { rang: 2, exigibleLe: aujourdHuiPlus(90), reste: 300_000 } });
    expect(situation.contrat.resteAPayer).toBe(900_000);

    // Une fois un paiement reçu, seul le gérant renégocie
    const parLeCharge = await envoyer(ctx, { url: `/contrats/${contratId}/echeancier`, cookie: cookies.charge_clientele, corps: { echeances: quatreEcheances } });
    expect(parLeCharge.statusCode).toBe(403);
    const renegociation = await envoyer(ctx, {
      url: `/contrats/${contratId}/echeancier`, cookie: cookies.gerant,
      corps: { echeances: [{ exigibleLe: aujourdHuiPlus(0), montant: 300_000 }, { exigibleLe: aujourdHuiPlus(120), montant: 1_000_000 }], primeTtc: 1_300_000 },
    });
    expect(renegociation.statusCode).toBe(200);
    expect(renegociation.json().contrat).toMatchObject({ statut: "en_vigueur", primeTtc: 1_300_000 });
  });

  it("le tableau de bord signale une échéance en retard à la caisse, pas au commercial", async () => {
    const { contratId } = await nouveauContrat("flotte", 900_000, aujourdHuiPlus(-60));
    await envoyer(ctx, {
      url: `/contrats/${contratId}/echeancier`, cookie: cookies.charge_clientele,
      corps: { echeances: [
        { exigibleLe: aujourdHuiPlus(-60), montant: 300_000 }, { exigibleLe: aujourdHuiPlus(-3), montant: 300_000 },
        { exigibleLe: aujourdHuiPlus(100), montant: 300_000 },
      ] },
    });
    await envoyer(ctx, { url: "/encaissements", cookie: cookies.caissier, corps: { contratId, montant: 300_000, mode: "especes" } });
    const pourLaCaisse = (await envoyer(ctx, { url: "/echeances", cookie: cookies.caissier })).json();
    expect(pourLaCaisse.paiements.find((p: { contratId: string }) => p.contratId === contratId))
      .toMatchObject({ rang: 2, nombre: 3, etat: "en_retard", jours: -3, reste: 300_000 });
    const pourLeCommercial = (await envoyer(ctx, { url: "/echeances", cookie: cookies.commercial })).json();
    expect(pourLeCommercial.paiements).toEqual([]);
  });
});

describe("Échéancier côté portail", () => {
  it("l'entreprise voit son échéancier et paie l'échéance due en ligne ; le contrat entre en vigueur", async () => {
    const { clientId, contratId } = await nouveauContrat("flotte", 1_200_000);
    await envoyer(ctx, { url: `/contrats/${contratId}/echeancier`, cookie: cookies.charge_clientele, corps: { echeances: quatreEcheances } });
    const telephone = `07${unique()}`;
    const acces = await envoyer(ctx, { url: `/clients/${clientId}/acces-portail`, cookie: cookies.charge_clientele, corps: { nom: "Awa Gestion", telephone, role: "titulaire" } });
    expect(acces.statusCode).toBe(201);
    const numero = acces.json().acces.telephone as string;
    expect((await portail("/portail/connexion/code", { corps: { telephone: numero } })).statusCode).toBe(202);
    const code = codes.findLast((c) => c.telephone === numero)!.code;
    const connexion = await portail("/portail/connexion", { corps: { telephone: numero, code } });
    expect(connexion.statusCode).toBe(200);
    const cookie = `${NOM_COOKIE_PORTAIL}=${connexion.cookies.find((c) => c.name === NOM_COOKIE_PORTAIL)!.value}`;

    const flotte = (await portail("/portail/flotte", { cookie })).json();
    const contrat = flotte.contrats.find((k: { id: string }) => k.id === contratId);
    expect(contrat.echeancier).toMatchObject({ aPayerMaintenant: 300_000, prochaine: { rang: 1, montant: 300_000 } });
    expect(contrat.echeancier.echeances.map((e: { etat: string }) => e.etat)).toEqual(["bientot", "a_venir", "a_venir", "a_venir"]);

    const ouverture = await portail("/portail/paiements", { cookie, corps: { contratId, montant: 300_000 } });
    expect(ouverture.statusCode).toBe(201);
    const id = ouverture.json().paiement.id as string;
    const resultat = await portail(`/portail/paiements/${id}/simulation`, { cookie, corps: { accepte: true } });
    expect(resultat.json().paiement).toMatchObject({ statut: "accepte", statutContrat: "en_vigueur" });

    const apres = (await portail("/portail/flotte", { cookie })).json().contrats.find((k: { id: string }) => k.id === contratId);
    expect(apres.echeancier).toMatchObject({ aPayerMaintenant: 0, prochaine: { rang: 2, reste: 300_000 } });
  });
});
