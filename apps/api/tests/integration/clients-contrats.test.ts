// Clients, contrats, véhicules, devis, échanges et tableau des échéances, rôle par rôle.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connecter, creerCompte, demarrer, envoyer, type Contexte } from "./outils.js";

let ctx: Contexte;
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

/** Téléphone unique pour chaque test : jamais de doublon involontaire entre deux exécutions. */
let suite = 0;
function telephoneUnique(): string {
  suite += 1;
  const n = String((Date.now() + suite) % 100_000_000).padStart(8, "0");
  return `05 ${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)}`;
}

function aujourdHuiPlus(jours: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  ctx = await demarrer();
  for (const role of ["gerant", "charge_clientele", "caissier", "commercial", "apporteur", "auditeur"] as const) {
    const compte = await creerCompte(ctx, role);
    ids[role] = compte.id;
    cookies[role] = await connecter(ctx, compte);
  }
});
afterAll(async () => {
  await ctx.fermer();
});

async function creerClient(role: string, nom: string, telephone = telephoneUnique()) {
  const reponse = await envoyer(ctx, { url: "/clients", cookie: cookies[role], corps: { type: "particulier", nom, telephone } });
  return reponse;
}

/** Paiement au guichet, par le caissier. */
async function payer(contratId: string, montant: number) {
  const reponse = await envoyer(ctx, { url: "/encaissements", cookie: cookies.caissier, corps: { contratId, montant, mode: "especes" } });
  expect(reponse.statusCode).toBe(201);
  return reponse.json().contrat as { statut: string };
}

describe("Clients", () => {
  it("normalise le téléphone au format international", async () => {
    const reponse = await creerClient("charge_clientele", "Kouassi Aya", "07 49 36 07 99");
    expect([201, 409]).toContain(reponse.statusCode);
    const refus = await creerClient("charge_clientele", "Numéro faux", "49 36 07");
    expect(refus.statusCode).toBe(422);
    expect(refus.json().code).toBe("telephone_invalide");
  });

  it("signale un doublon possible par le téléphone, puis crée si l'on confirme", async () => {
    const telephone = telephoneUnique();
    const premier = await creerClient("charge_clientele", "Traoré Moussa", telephone);
    expect(premier.statusCode).toBe(201);
    const doublon = await creerClient("commercial", "Moussa Traoré", telephone);
    expect(doublon.statusCode).toBe(409);
    expect(doublon.json()).toMatchObject({ code: "doublon_possible", doublons: [{ nom: "Traoré Moussa" }] });
    const confirme = await envoyer(ctx, {
      url: "/clients", cookie: cookies.commercial,
      corps: { type: "particulier", nom: "Moussa Traoré", telephone, confirmerDoublon: true },
    });
    expect(confirme.statusCode).toBe(201);
  });

  it("recherche par nom ou par numéro, sans que % ou _ servent de joker", async () => {
    const telephone = telephoneUnique();
    await creerClient("charge_clientele", "Transports Bamba & Fils", telephone);
    const parNom = await envoyer(ctx, { url: "/clients?recherche=bamba", cookie: cookies.charge_clientele });
    expect(parNom.json().clients.some((c: { nom: string }) => c.nom === "Transports Bamba & Fils")).toBe(true);
    const parNumero = await envoyer(ctx, { url: `/clients?recherche=${encodeURIComponent(telephone.slice(-5))}`, cookie: cookies.charge_clientele });
    expect(parNumero.json().clients.some((c: { nom: string }) => c.nom === "Transports Bamba & Fils")).toBe(true);
    const joker = await envoyer(ctx, { url: "/clients?recherche=%25", cookie: cookies.charge_clientele });
    expect(joker.json().clients).toEqual([]);
  });

  it("le caissier et l'auditeur consultent sans créer ; l'apporteur ne voit que ses clients", async () => {
    expect((await creerClient("caissier", "Interdit Caisse")).statusCode).toBe(403);
    expect((await creerClient("auditeur", "Interdit Audit")).statusCode).toBe(403);

    const apporte = await creerClient("apporteur", "Client Apporté");
    expect(apporte.statusCode).toBe(201);
    expect(apporte.json().client.apporteurId).toBe(ids.apporteur);
    const liste = await envoyer(ctx, { url: "/clients", cookie: cookies.apporteur });
    expect(liste.json().clients.map((c: { nom: string }) => c.nom)).toEqual(["Client Apporté"]);

    const autre = (await creerClient("charge_clientele", "Client de l'agence")).json().client;
    expect((await envoyer(ctx, { url: `/clients/${autre.id}`, cookie: cookies.apporteur })).statusCode).toBe(404);
    expect((await envoyer(ctx, { url: `/clients/${autre.id}`, cookie: cookies.caissier })).statusCode).toBe(200);
  });

  it("la fiche réunit contrats, véhicules, devis et échanges ; inconnue ou mal formée : 404 ou 400", async () => {
    const client = (await creerClient("charge_clientele", "Fiche Complète")).json().client;
    const vehicule = await envoyer(ctx, {
      url: `/clients/${client.id}/vehicules`, cookie: cookies.charge_clientele,
      corps: { immatriculation: ` ${Date.now() % 10000} ab 01`, genre: "Voiture", echeanceVisiteTechnique: aujourdHuiPlus(10) },
    });
    expect(vehicule.statusCode).toBe(201);
    expect(vehicule.json().vehicule.immatriculation).toMatch(/^\d+ AB 01$/);
    const doublonVehicule = await envoyer(ctx, {
      url: `/clients/${client.id}/vehicules`, cookie: cookies.charge_clientele, corps: { immatriculation: vehicule.json().vehicule.immatriculation },
    });
    expect(doublonVehicule.statusCode).toBe(409);

    await envoyer(ctx, { url: `/clients/${client.id}/echanges`, cookie: cookies.caissier, corps: { canal: "visite", resume: "Venu à l'agence" } });
    await envoyer(ctx, { url: `/clients/${client.id}/echanges`, cookie: cookies.commercial, corps: { canal: "appel", resume: "Rappel prévu" } });
    await envoyer(ctx, { url: `/clients/${client.id}/devis`, cookie: cookies.commercial, corps: { branche: "automobile" } });

    const fiche = (await envoyer(ctx, { url: `/clients/${client.id}`, cookie: cookies.charge_clientele })).json();
    expect(fiche.client.nom).toBe("Fiche Complète");
    expect(fiche.vehicules).toHaveLength(1);
    expect(fiche.devis).toHaveLength(1);
    expect(fiche.echanges.map((e: { resume: string }) => e.resume)).toEqual(["Rappel prévu", "Venu à l'agence"]);
    expect(fiche.echanges[1].auteur).toBe("Test caissier");

    // Le caissier voit la fiche, sans les devis
    expect((await envoyer(ctx, { url: `/clients/${client.id}`, cookie: cookies.caissier })).json().devis).toEqual([]);

    expect((await envoyer(ctx, { url: "/clients/00000000-0000-4000-8000-000000000000", cookie: cookies.gerant })).statusCode).toBe(404);
    expect((await envoyer(ctx, { url: "/clients/pas-un-identifiant", cookie: cookies.gerant })).statusCode).toBe(400);
    expect((await envoyer(ctx, {
      url: "/clients/00000000-0000-4000-8000-000000000000/echanges", cookie: cookies.gerant, corps: { canal: "note", resume: "Fantôme" },
    })).statusCode).toBe(404);
  });
});

describe("Contrats et échéances", () => {
  it("un contrat n'est en vigueur qu'une fois payé (Code CIMA, art. 13)", async () => {
    const client = (await creerClient("charge_clientele", "Contrat Impayé")).json().client;
    const contrat = await envoyer(ctx, {
      url: "/contrats", cookie: cookies.charge_clientele,
      corps: { clientId: client.id, branche: "automobile", dateEffet: aujourdHuiPlus(0), dateEcheance: aujourdHuiPlus(365), primeTtc: 85000 },
    });
    expect(contrat.statusCode).toBe(201);
    expect(contrat.json().contrat).toMatchObject({ statut: "en_attente_paiement", dateEffet: aujourdHuiPlus(0), primeTtc: 85000 });
    const enVigueur = await envoyer(ctx, {
      methode: "PATCH", url: `/contrats/${contrat.json().contrat.id}`, cookie: cookies.charge_clientele, corps: { statut: "en_vigueur" },
    });
    expect(enVigueur.statusCode).toBe(422);
    expect(enVigueur.json()).toMatchObject({ code: "regle_metier", message: expect.stringContaining("art. 13") });
  });

  it("refuse une période incohérente, et le commercial ne crée pas de contrat", async () => {
    const client = (await creerClient("charge_clientele", "Période Fausse")).json().client;
    const corps = { clientId: client.id, branche: "habitation", dateEffet: aujourdHuiPlus(10), dateEcheance: aujourdHuiPlus(5), primeTtc: 20000 };
    expect((await envoyer(ctx, { url: "/contrats", cookie: cookies.charge_clientele, corps })).json().code).toBe("periode_invalide");
    expect((await envoyer(ctx, { url: "/contrats", cookie: cookies.commercial, corps })).statusCode).toBe(403);
  });

  it("le tableau des échéances classe les contrats, et un renouvellement les en retire", async () => {
    const client = (await creerClient("charge_clientele", "Échéance Proche")).json().client;
    const contrat = (await envoyer(ctx, {
      url: "/contrats", cookie: cookies.charge_clientele,
      corps: { clientId: client.id, branche: "automobile", numeroPolice: `POL-${Date.now()}`,
               dateEffet: aujourdHuiPlus(-360), dateEcheance: aujourdHuiPlus(5), primeTtc: 60000 },
    })).json().contrat;
    // Prime payée : le contrat entre en vigueur de lui-même (Code CIMA, art. 13)
    expect((await payer(contrat.id, 60000)).statut).toBe("en_vigueur");

    const echeances = (await envoyer(ctx, { url: "/echeances", cookie: cookies.commercial })).json();
    const ligne = echeances.contrats.find((c: { contratId: string }) => c.contratId === contrat.id);
    expect(ligne).toMatchObject({ clientNom: "Échéance Proche", joursRestants: 5, categorie: "j7", dateEcheance: aujourdHuiPlus(5) });
    expect(echeances.resume.j7).toBeGreaterThanOrEqual(1);

    const renouvellement = await envoyer(ctx, { url: `/contrats/${contrat.id}/renouveler`, cookie: cookies.charge_clientele, corps: {} });
    expect(renouvellement.statusCode).toBe(201);
    expect(renouvellement.json().contrat).toMatchObject({
      statut: "en_attente_paiement", dateEffet: aujourdHuiPlus(5), dateEcheance: aujourdHuiPlus(370), primeTtc: 60000, renouvelleId: contrat.id,
    });
    const apres = (await envoyer(ctx, { url: "/echeances", cookie: cookies.commercial })).json();
    expect(apres.contrats.some((c: { contratId: string }) => c.contratId === contrat.id)).toBe(false);

    const deuxieme = await envoyer(ctx, { url: `/contrats/${contrat.id}/renouveler`, cookie: cookies.charge_clientele, corps: {} });
    expect(deuxieme.statusCode).toBe(409);
  });

  it("le tableau signale aussi les documents des véhicules à renouveler", async () => {
    const client = (await creerClient("charge_clientele", "Transporteur Visite")).json().client;
    await envoyer(ctx, {
      url: `/clients/${client.id}/vehicules`, cookie: cookies.charge_clientele,
      corps: { immatriculation: `TR ${Date.now() % 100000}`, echeanceCarteTransport: aujourdHuiPlus(12) },
    });
    const echeances = (await envoyer(ctx, { url: "/echeances", cookie: cookies.gerant })).json();
    expect(echeances.vehicules.find((v: { clientNom: string }) => v.clientNom === "Transporteur Visite"))
      .toMatchObject({ document: "carte_de_transport", joursRestants: 12, categorie: "j15" });
  });
});

describe("Devis", () => {
  it("un refus exige son motif ; l'apporteur crée des devis mais ne les fait pas avancer", async () => {
    const client = (await creerClient("apporteur", "Prospect Devis")).json().client;
    const devis = await envoyer(ctx, { url: `/clients/${client.id}/devis`, cookie: cookies.apporteur, corps: { branche: "flotte" } });
    expect(devis.statusCode).toBe(201);
    expect(devis.json().devis).toMatchObject({ statut: "nouveau", origine: "apporteur" });
    const id = devis.json().devis.id;

    expect((await envoyer(ctx, { methode: "PATCH", url: `/devis/${id}`, cookie: cookies.apporteur, corps: { statut: "envoye" } })).statusCode).toBe(403);
    const sansMotif = await envoyer(ctx, { methode: "PATCH", url: `/devis/${id}`, cookie: cookies.commercial, corps: { statut: "refuse" } });
    expect(sansMotif.statusCode).toBe(422);
    const avecMotif = await envoyer(ctx, {
      methode: "PATCH", url: `/devis/${id}`, cookie: cookies.commercial, corps: { statut: "refuse", motifRefus: "Assuré ailleurs" },
    });
    expect(avecMotif.json().devis).toMatchObject({ statut: "refuse", motifRefus: "Assuré ailleurs" });
  });
});
