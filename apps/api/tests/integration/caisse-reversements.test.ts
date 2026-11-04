// Caisse : encaissements, reçus, contre-passations, clôtures ; reversements à la compagnie ; commissions.
// Les étapes se suivent dans l'ordre d'une journée à l'agence.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connecter, creerCompte, demarrer, envoyer, type Contexte } from "./outils.js";

let ctx: Contexte;
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

let suite = 0;
function telephoneUnique(): string {
  suite += 1;
  const n = String((Date.now() + suite * 7919) % 100_000_000).padStart(8, "0");
  return `01 ${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)}`;
}

function aujourdHuiPlus(jours: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

async function nouveauContrat(nom: string, primeTtc: number, primeNette?: number): Promise<string> {
  const client = await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele, corps: { type: "particulier", nom, telephone: telephoneUnique() } });
  expect(client.statusCode).toBe(201);
  const contrat = await envoyer(ctx, {
    url: "/contrats", cookie: cookies.charge_clientele,
    corps: {
      clientId: client.json().client.id, branche: "automobile", dateEffet: aujourdHuiPlus(0), dateEcheance: aujourdHuiPlus(365),
      primeTtc, ...(primeNette ? { primeNette } : {}),
    },
  });
  expect(contrat.statusCode).toBe(201);
  return contrat.json().contrat.id;
}

function encaisser(role: string, corps: Record<string, unknown>) {
  return envoyer(ctx, { url: "/encaissements", cookie: cookies[role], corps });
}

beforeAll(async () => {
  ctx = await demarrer();
  for (const [nom, role] of [
    ["gerant", "gerant"], ["gerant2", "gerant"], ["caissier", "caissier"], ["charge_clientele", "charge_clientele"],
    ["commercial", "commercial"], ["auditeur", "auditeur"],
  ] as const) {
    const compte = await creerCompte(ctx, role);
    ids[nom] = compte.id;
    cookies[nom] = await connecter(ctx, compte);
  }
});
afterAll(async () => {
  await ctx.fermer();
});

const etat: Record<string, string> = {};

describe("Encaissements et reçus", () => {
  it("encaisse une partie de la prime et imprime un reçu avec le montant en lettres", async () => {
    etat.contrat = await nouveauContrat("Yao Konan", 150_000);
    const reponse = await encaisser("caissier", { contratId: etat.contrat, montant: 50_000, mode: "especes" });
    expect(reponse.statusCode).toBe(201);
    const { encaissement, contrat } = reponse.json();
    expect(encaissement).toMatchObject({ montant: 50_000, mode: "especes", contrePasse: false });
    expect(encaissement.numeroRecu).toBeGreaterThan(0);
    expect(contrat).toMatchObject({ statut: "en_attente_paiement", resteAPayer: 100_000, especes: 50_000 });
    etat.premier = encaissement.id;

    const recu = await envoyer(ctx, { url: `/encaissements/${encaissement.id}/recu`, cookie: cookies.charge_clientele });
    expect(recu.statusCode).toBe(200);
    expect(recu.json().recu).toMatchObject({
      numeroRecu: encaissement.numeroRecu,
      montantEnLettres: "cinquante mille francs CFA",
      resteAPayer: 100_000,
      clientNom: "Yao Konan",
      agence: { codeAgence: "2623" },
    });
    expect((await envoyer(ctx, { url: `/encaissements/${encaissement.id}/recu`, cookie: cookies.commercial })).statusCode).toBe(403);
  });

  it("refuse un montant supérieur au reste à payer, une référence manquante, et le commercial", async () => {
    const trop = await encaisser("caissier", { contratId: etat.contrat, montant: 200_000, mode: "especes" });
    expect(trop.statusCode).toBe(422);
    expect(trop.json()).toMatchObject({ code: "reste_a_payer", message: expect.stringMatching(/100\s000 F CFA/) });

    const sansReference = await encaisser("caissier", { contratId: etat.contrat, montant: 10_000, mode: "mobile_money" });
    expect(sansReference.json().code).toBe("reference_obligatoire");

    expect((await encaisser("commercial", { contratId: etat.contrat, montant: 10_000, mode: "especes" })).statusCode).toBe(403);
    expect((await encaisser("charge_clientele", { contratId: etat.contrat, montant: 10_000, mode: "especes" })).statusCode).toBe(403);
  });

  it("met le contrat en vigueur dès que la prime est soldée, et refuse une référence déjà utilisée", async () => {
    etat.referenceMm = `MP${Date.now()}`;
    const solde = await encaisser("caissier", { contratId: etat.contrat, montant: 100_000, mode: "mobile_money", reference: etat.referenceMm });
    expect(solde.statusCode).toBe(201);
    expect(solde.json().contrat).toMatchObject({ statut: "en_vigueur", resteAPayer: 0 });

    const autre = await nouveauContrat("Doublon Mobile Money", 30_000);
    const doublon = await encaisser("caissier", { contratId: autre, montant: 30_000, mode: "mobile_money", reference: etat.referenceMm });
    expect(doublon.statusCode).toBe(409);
    expect(doublon.json().code).toBe("reference_deja_utilisee");

    const paye = await encaisser("caissier", { contratId: etat.contrat, montant: 1, mode: "especes" });
    expect(paye.json()).toMatchObject({ code: "reste_a_payer", message: "Ce contrat est déjà entièrement payé." });
  });

  it("applique le plafond de 1 000 000 F CFA d'espèces par police", async () => {
    const contrat = await nouveauContrat("Grande Flotte", 1_800_000);
    expect((await encaisser("caissier", { contratId: contrat, montant: 1_000_000, mode: "especes" })).statusCode).toBe(201);
    const plafond = await encaisser("caissier", { contratId: contrat, montant: 1, mode: "especes" });
    expect(plafond.statusCode).toBe(422);
    expect(plafond.json()).toMatchObject({ code: "plafond_especes", message: expect.stringContaining("SanlamAllianz") });
    const situation = await envoyer(ctx, { url: `/contrats/${contrat}/paiements`, cookie: cookies.auditeur });
    expect(situation.json().contrat).toMatchObject({ especesPossibles: 0, resteAPayer: 800_000 });
  });

  it("contre-passation : réservée au gérant, motif obligatoire, une seule fois, et le contrat repasse en attente", async () => {
    const corps = { motif: "Erreur de montant au guichet" };
    expect((await envoyer(ctx, { url: `/encaissements/${etat.premier}/contre-passation`, cookie: cookies.caissier, corps })).statusCode).toBe(403);
    const sansMotif = await envoyer(ctx, { url: `/encaissements/${etat.premier}/contre-passation`, cookie: cookies.gerant, corps: { motif: "        " } });
    expect(sansMotif.json().code).toBe("motif_obligatoire");

    const annulation = await envoyer(ctx, { url: `/encaissements/${etat.premier}/contre-passation`, cookie: cookies.gerant, corps });
    expect(annulation.statusCode).toBe(201);
    expect(annulation.json().encaissement).toMatchObject({ montant: -50_000, mode: "especes", annuleEncaissementId: etat.premier });
    expect(annulation.json().contrat).toMatchObject({ statut: "en_attente_paiement", resteAPayer: 50_000 });

    const recu = (await envoyer(ctx, { url: `/encaissements/${annulation.json().encaissement.id}/recu`, cookie: cookies.gerant })).json().recu;
    expect(recu.montantEnLettres).toBe("moins cinquante mille francs CFA");
    expect(recu.motif).toBe("Erreur de montant au guichet");

    const deuxieme = await envoyer(ctx, { url: `/encaissements/${etat.premier}/contre-passation`, cookie: cookies.gerant, corps });
    expect(deuxieme.statusCode).toBe(409);
    expect(deuxieme.json().code).toBe("deja_contre_passe");

    // Le client repaie le bon montant
    expect((await encaisser("caissier", { contratId: etat.contrat, montant: 50_000, mode: "especes" })).json().contrat.statut).toBe("en_vigueur");
  });

  it("la fiche client montre le reste à payer à la caisse, pas au commercial", async () => {
    const paiements = (await envoyer(ctx, { url: `/contrats/${etat.contrat}/paiements`, cookie: cookies.caissier })).json();
    const clientId = paiements.contrat.clientId;
    const pourCaisse = (await envoyer(ctx, { url: `/clients/${clientId}`, cookie: cookies.caissier })).json();
    expect(pourCaisse.contrats[0]).toMatchObject({ resteAPayer: 0 });
    const pourCommercial = (await envoyer(ctx, { url: `/clients/${clientId}`, cookie: cookies.commercial })).json();
    expect(pourCommercial.contrats[0].resteAPayer).toBeNull();
    expect((await envoyer(ctx, { url: `/contrats/${etat.contrat}/paiements`, cookie: cookies.commercial })).statusCode).toBe(403);
  });
});

describe("Clôture de caisse", () => {
  it("la caisse du caissier contient ses encaissements et la contre-passation du gérant", async () => {
    const caisse = (await envoyer(ctx, { url: "/caisse", cookie: cookies.caissier })).json();
    expect(caisse.depuis).toBeNull();
    // 50 000 - 50 000 + 1 000 000 + 50 000 en espèces ; 100 000 en Mobile Money
    expect(caisse.totaux).toMatchObject({ especes: 1_050_000, mobile_money: 100_000 });
    expect(caisse.mouvements.some((m: { montant: number }) => m.montant === -50_000)).toBe(true);
    const caisseGerant = (await envoyer(ctx, { url: "/caisse", cookie: cookies.gerant })).json();
    expect(caisseGerant.totaux.nombre).toBe(0);
    expect((await envoyer(ctx, { url: "/caisse", cookie: cookies.commercial })).statusCode).toBe(403);
  });

  it("refuse un billetage incohérent et un écart non justifié, puis clôture", async () => {
    const billetageFaux = await envoyer(ctx, {
      url: "/caisse/clotures", cookie: cookies.caissier, corps: { especesComptees: 1_050_000, billetage: { "10000": 100 } },
    });
    expect(billetageFaux.json().code).toBe("billetage_incoherent");
    const coupureInconnue = await envoyer(ctx, {
      url: "/caisse/clotures", cookie: cookies.caissier, corps: { especesComptees: 3000, billetage: { "3000": 1 } },
    });
    expect(coupureInconnue.statusCode).toBe(400);
    const ecart = await envoyer(ctx, { url: "/caisse/clotures", cookie: cookies.caissier, corps: { especesComptees: 1_049_000 } });
    expect(ecart.json().code).toBe("ecart_a_justifier");

    const cloture = await envoyer(ctx, {
      url: "/caisse/clotures", cookie: cookies.caissier,
      corps: { especesComptees: 1_049_000, billetage: { "10000": 104, "5000": 1, "2000": 2 }, commentaire: "Il manque 1 000 F, monnaie rendue" },
    });
    expect(cloture.statusCode).toBe(201);
    expect(cloture.json().cloture).toMatchObject({
      especesAttendues: 1_050_000, especesComptees: 1_049_000, ecart: -1000, totalMobileMoney: 100_000, viseeLe: null,
    });
    etat.cloture = cloture.json().cloture.id;
    const apres = (await envoyer(ctx, { url: "/caisse", cookie: cookies.caissier })).json();
    expect(apres.totaux.nombre).toBe(0);
    expect(apres.depuis).not.toBeNull();
  });

  it("le visa revient à un gérant, une seule fois", async () => {
    expect((await envoyer(ctx, { url: `/caisse/clotures/${etat.cloture}/visa`, cookie: cookies.caissier, corps: {} })).statusCode).toBe(403);
    const visa = await envoyer(ctx, { url: `/caisse/clotures/${etat.cloture}/visa`, cookie: cookies.gerant, corps: {} });
    expect(visa.statusCode).toBe(200);
    expect(visa.json().cloture.viseeLe).not.toBeNull();
    expect((await envoyer(ctx, { url: `/caisse/clotures/${etat.cloture}/visa`, cookie: cookies.gerant2, corps: {} })).json().code).toBe("deja_visee");

    const propre = await envoyer(ctx, { url: "/caisse/clotures", cookie: cookies.gerant, corps: { especesComptees: 0 } });
    expect(propre.statusCode).toBe(201);
    const autoVisa = await envoyer(ctx, { url: `/caisse/clotures/${propre.json().cloture.id}/visa`, cookie: cookies.gerant, corps: {} });
    expect(autoVisa.json().code).toBe("quatre_yeux");

    const historique = (await envoyer(ctx, { url: "/caisse/clotures", cookie: cookies.caissier })).json().clotures;
    expect(historique.every((c: { caissierId: string }) => c.caissierId === ids.caissier)).toBe(true);
  });
});

describe("Reversements à la compagnie", () => {
  it("affiche les primes à reverser avec le compte à rebours de 30 jours", async () => {
    const aReverser = (await envoyer(ctx, { url: "/reversements/a-reverser", cookie: cookies.caissier })).json();
    expect(aReverser.resume.nombreNonRattache).toBeGreaterThan(0);
    const ligne = aReverser.encaissements.find((e: { id: string }) => e.id === etat.premier);
    expect(ligne).toMatchObject({ joursRestants: 30, enRetard: false, dateLimite: aujourdHuiPlus(30) });
    expect((await envoyer(ctx, { url: "/reversements/a-reverser", cookie: cookies.charge_clientele })).statusCode).toBe(403);
  });

  it("le caissier prépare un bordereau ; il ne peut pas le valider, un gérant oui", async () => {
    const futur = await envoyer(ctx, { url: "/reversements", cookie: cookies.caissier, corps: { jusquAu: aujourdHuiPlus(1) } });
    expect(futur.json().code).toBe("date_future");

    const preparation = await envoyer(ctx, { url: "/reversements", cookie: cookies.caissier, corps: { jusquAu: aujourdHuiPlus(0) } });
    expect(preparation.statusCode).toBe(201);
    const { bordereau, lignes, totaux } = preparation.json();
    expect(bordereau).toMatchObject({ statut: "prepare", periodeFin: aujourdHuiPlus(0) });
    expect(bordereau.numero).toMatch(/^BR-\d{4}-\d{4}$/);
    expect(lignes.some((l: { id: string }) => l.id === etat.premier)).toBe(true);
    expect(totaux.total).toBe(lignes.reduce((s: number, l: { montant: number }) => s + l.montant, 0));
    etat.bordereau = bordereau.id;

    const rien = await envoyer(ctx, { url: "/reversements", cookie: cookies.caissier, corps: { jusquAu: aujourdHuiPlus(0) } });
    expect(rien.json().code).toBe("rien_a_reverser");

    expect((await envoyer(ctx, { url: `/reversements/${etat.bordereau}/validation`, cookie: cookies.caissier, corps: {} })).statusCode).toBe(403);
    const avantValidation = await envoyer(ctx, {
      url: `/reversements/${etat.bordereau}/versement`, cookie: cookies.gerant, corps: { verseLe: aujourdHuiPlus(0), referenceVirement: "VIR-0001" },
    });
    expect(avantValidation.json().code).toBe("bordereau_non_valide");

    const validation = await envoyer(ctx, { url: `/reversements/${etat.bordereau}/validation`, cookie: cookies.gerant, corps: {} });
    expect(validation.statusCode).toBe(200);
    expect(validation.json().bordereau).toMatchObject({ statut: "valide", validePar: "Test gerant" });

    const annulation = await envoyer(ctx, { url: `/reversements/${etat.bordereau}/annulation`, cookie: cookies.gerant, corps: { motif: "Trop tard pour annuler" } });
    expect(annulation.json()).toMatchObject({ code: "regle_metier", message: expect.stringContaining("déjà validé") });
  });

  it("un gérant ne valide pas le bordereau qu'il a préparé (quatre yeux)", async () => {
    const contrat = await nouveauContrat("Bordereau Gérant", 40_000);
    await encaisser("gerant", { contratId: contrat, montant: 40_000, mode: "cheque", reference: `CHQ${Date.now()}` });
    const preparation = await envoyer(ctx, { url: "/reversements", cookie: cookies.gerant, corps: { jusquAu: aujourdHuiPlus(0) } });
    expect(preparation.statusCode).toBe(201);
    const id = preparation.json().bordereau.id;
    const refus = await envoyer(ctx, { url: `/reversements/${id}/validation`, cookie: cookies.gerant, corps: {} });
    expect(refus.statusCode).toBe(403);
    expect(refus.json().code).toBe("quatre_yeux");

    // Annulé par la personne qui l'a préparé : les encaissements redeviennent à reverser
    const annulation = await envoyer(ctx, { url: `/reversements/${id}/annulation`, cookie: cookies.gerant, corps: { motif: "Période à revoir" } });
    expect(annulation.json().bordereau).toMatchObject({ statut: "annule", nombre: 0 });
    const nouveau = await envoyer(ctx, { url: "/reversements", cookie: cookies.gerant, corps: { jusquAu: aujourdHuiPlus(0) } });
    expect(nouveau.statusCode).toBe(201);
    const validation = await envoyer(ctx, { url: `/reversements/${nouveau.json().bordereau.id}/validation`, cookie: cookies.gerant2, corps: {} });
    expect(validation.json().bordereau.statut).toBe("valide");
  });

  it("enregistre le versement, puis fige le bordereau", async () => {
    const versement = await envoyer(ctx, {
      url: `/reversements/${etat.bordereau}/versement`, cookie: cookies.gerant, corps: { verseLe: aujourdHuiPlus(0), referenceVirement: "VIR-2026-0042" },
    });
    expect(versement.statusCode).toBe(200);
    expect(versement.json().bordereau).toMatchObject({ statut: "verse", referenceVirement: "VIR-2026-0042" });
    const encore = await envoyer(ctx, {
      url: `/reversements/${etat.bordereau}/versement`, cookie: cookies.gerant, corps: { verseLe: aujourdHuiPlus(0), referenceVirement: "AUTRE" },
    });
    expect(encore.statusCode).toBe(403);
    const aReverser = (await envoyer(ctx, { url: "/reversements/a-reverser", cookie: cookies.gerant })).json();
    expect(aReverser.encaissements.some((e: { id: string }) => e.id === etat.premier)).toBe(false);
  });

  it("exporte le bordereau en CSV pour Excel, sans formule exécutable", async () => {
    const contrat = await nouveauContrat("=HYPERLINK(\"http://piege\")", 20_000);
    await encaisser("caissier", { contratId: contrat, montant: 20_000, mode: "especes" });
    const bordereau = (await envoyer(ctx, { url: "/reversements", cookie: cookies.caissier, corps: { jusquAu: aujourdHuiPlus(0) } })).json().bordereau;
    const csv = await envoyer(ctx, { url: `/reversements/${bordereau.id}/export.csv`, cookie: cookies.auditeur });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(csv.headers["content-disposition"]).toBe(`attachment; filename="bordereau-${bordereau.numero}.csv"`);
    expect(csv.body.startsWith("﻿")).toBe(true);
    expect(csv.body).toContain(`Bordereau de reversement ${bordereau.numero}`);
    expect(csv.body).toContain("\"'=HYPERLINK(\"\"http://piege\"\")\"");
    expect(csv.body).not.toMatch(/;=HYPERLINK/);
  });
});

describe("Commissions", () => {
  it("le gérant fixe les taux et saisit le relevé ; l'écart avec la commission attendue apparaît", async () => {
    const taux = await envoyer(ctx, { url: "/commissions/taux", cookie: cookies.gerant, corps: { branche: "automobile", taux: 10, applicableDu: "2000-01-01" } });
    expect(taux.statusCode).toBe(201);
    expect(taux.json().taux).toMatchObject({ branche: "automobile", taux: 10 });
    const doublon = await envoyer(ctx, { url: "/commissions/taux", cookie: cookies.gerant, corps: { branche: "automobile", taux: 12, applicableDu: "2000-01-01" } });
    expect(doublon.statusCode).toBe(409);
    expect((await envoyer(ctx, { url: "/commissions/taux", cookie: cookies.caissier, corps: { branche: "automobile", taux: 12, applicableDu: "2001-01-01" } })).statusCode).toBe(403);

    // Prime nette 80 000 sur 100 000 TTC, entièrement payée : commission attendue 100 000 × 80 % × 10 % = 8 000
    const contrat = await nouveauContrat("Commission Calculée", 100_000);
    const primeNetteTrop = await envoyer(ctx, { methode: "PATCH", url: `/contrats/${contrat}`, cookie: cookies.charge_clientele, corps: { primeNette: 120_000 } });
    expect(primeNetteTrop.json().code).toBe("prime_nette_invalide");
    const primeNette = await envoyer(ctx, { methode: "PATCH", url: `/contrats/${contrat}`, cookie: cookies.charge_clientele, corps: { primeNette: 80_000 } });
    expect(primeNette.json().contrat).toMatchObject({ primeNette: 80_000 });

    const avant = (await envoyer(ctx, { url: "/commissions", cookie: cookies.gerant })).json();
    const moisCourant = aujourdHuiPlus(0).slice(0, 7);
    const attendueAvant = avant.rapprochement.find((m: { mois: string }) => m.mois === moisCourant)?.commissionAttendue ?? 0;
    await encaisser("caissier", { contratId: contrat, montant: 100_000, mode: "virement", reference: `VIR${Date.now()}` });

    const releve = await envoyer(ctx, {
      url: "/commissions/releves", cookie: cookies.gerant, corps: { mois: moisCourant, montantDeclare: attendueAvant + 7_500, reference: "REL-TEST" },
    });
    expect(releve.statusCode).toBe(200);
    const apres = (await envoyer(ctx, { url: "/commissions", cookie: cookies.auditeur })).json();
    const mois = apres.rapprochement.find((m: { mois: string }) => m.mois === moisCourant);
    expect(mois).toMatchObject({ commissionAttendue: attendueAvant + 8_000, montantDeclare: attendueAvant + 7_500, ecart: -500 });
    expect(mois.encaissementsIncomplets).toBeGreaterThan(0);
    expect(apres.taux.find((t: { branche: string }) => t.branche === "automobile")).toMatchObject({ taux: 10, enVigueur: true });
    expect(apres.contratsSansPrimeNette.length).toBeGreaterThan(0);

    const correction = await envoyer(ctx, {
      url: "/commissions/releves", cookie: cookies.gerant, corps: { mois: moisCourant, montantDeclare: attendueAvant + 8_000 },
    });
    expect(correction.json().releve).toMatchObject({ montantDeclare: attendueAvant + 8_000, reference: null });
    expect((await envoyer(ctx, { url: "/commissions", cookie: cookies.caissier })).statusCode).toBe(403);
    const futur = await envoyer(ctx, { url: "/commissions/releves", cookie: cookies.gerant, corps: { mois: "2999-01", montantDeclare: 1 } });
    expect(futur.json().code).toBe("mois_futur");
  });
});
