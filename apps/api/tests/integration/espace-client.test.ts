// Espace client (tâche 9) : ouverture automatique pour un particulier, paiement d'une prime en ligne (prestataire
// simulé), régularisation par le gérant, déclaration d'un sinistre avec ses photos, suivi par l'agence ;
// isolement entre deux clients et origines séparées.

import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerPrestataireSimulation, type DemandePaiement } from "../../src/integrations/paiement/prestataire.js";
import { executerMaintenance } from "../../src/modules/demandes-site/maintenance.js";
import type { EnvoiCodes } from "../../src/modules/portail/connexion.js";
import { connecter, creerCompte, demarrer, envoyer, ORIGINE, type Contexte } from "./outils.js";

const ORIGINE_PORTAIL = "https://espace.test.ci";
const NOM_COOKIE_PORTAIL = "__Host-dbs_portail";

let ctx: Contexte;
const cookies: Record<string, string> = {};
const codesEnvoyes: { telephone: string; code: string }[] = [];
let suite = 0;

const envoiCodes: EnvoiCodes = {
  disponible: true,
  async envoyer(telephone, code) {
    codesEnvoyes.push({ telephone, code });
    return { ok: true, identifiant: `test-${codesEnvoyes.length}` };
  },
};

// Prestataire simulé, avec une panne réglable et les demandes reçues
const simulation = creerPrestataireSimulation();
const initierSimulation = simulation.initier;
const prestataire = Object.assign(simulation, { enPanne: false, demandes: [] as DemandePaiement[] });
prestataire.initier = async (demande) => {
  prestataire.demandes.push(demande);
  if (prestataire.enPanne) return { ok: false, erreur: "Service indisponible (test)" };
  return initierSimulation(demande);
};

function unique(): string {
  suite += 1;
  return String((Date.now() + suite) % 100_000_000).padStart(8, "0");
}

function aujourdHuiPlus(jours: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("photo du choc")]);

let adresse = 0;
function portail(chemin: string, options: { cookie?: string; corps?: object; methode?: "GET" | "POST" | "DELETE"; origine?: string } = {}) {
  adresse += 1;
  return envoyer(ctx, {
    ip: `198.51.100.${(adresse % 250) + 1}`,
    url: chemin,
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.corps ? { corps: options.corps } : {}),
    ...(options.methode ? { methode: options.methode } : {}),
    origine: options.origine ?? ORIGINE_PORTAIL,
  });
}

function cookiePortail(reponse: LightMyRequestResponse): string {
  const cookie = reponse.cookies.find((c) => c.name === NOM_COOKIE_PORTAIL);
  expect(cookie?.value).toBeTruthy();
  return `${NOM_COOKIE_PORTAIL}=${cookie!.value}`;
}

async function seConnecter(telephone: string): Promise<LightMyRequestResponse> {
  const avant = codesEnvoyes.length;
  expect((await portail("/portail/connexion/code", { corps: { telephone } })).statusCode).toBe(202);
  const code = codesEnvoyes.slice(avant).find((c) => c.telephone === telephone)?.code;
  expect(code).toMatch(/^\d{6}$/);
  const connexion = await portail("/portail/connexion", { corps: { telephone, code } });
  expect(connexion.statusCode).toBe(200);
  return connexion;
}

/** Particulier assuré pour sa voiture (contrat en attente de paiement) : son espace s'ouvre avec son numéro. */
async function particulierAssure(nom: string, primeTtc = 100_003) {
  const telephone = `+22507${unique()}`;
  const client = await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele, corps: { type: "particulier", nom, telephone } });
  expect(client.statusCode).toBe(201);
  const clientId = client.json().client.id as string;
  const vehiculeId = (await envoyer(ctx, {
    url: `/clients/${clientId}/vehicules`, cookie: cookies.charge_clientele, corps: { immatriculation: `${unique().slice(-4)} PA 01` },
  })).json().vehicule.id as string;
  const contrat = await envoyer(ctx, {
    url: "/contrats", cookie: cookies.charge_clientele,
    corps: { clientId, branche: "automobile", numeroPolice: `AUTO-${unique()}`, dateEffet: aujourdHuiPlus(-5), dateEcheance: aujourdHuiPlus(360), primeTtc },
  });
  expect(contrat.statusCode).toBe(201);
  const contratId = contrat.json().contrat.id as string;
  expect((await envoyer(ctx, { url: `/contrats/${contratId}/vehicules`, cookie: cookies.charge_clientele, corps: { vehiculeId } })).statusCode).toBe(201);
  const cookie = cookiePortail(await seConnecter(telephone));
  return { clientId, contratId, vehiculeId, telephone, cookie };
}

async function payerEnLigne(cookie: string, contratId: string, montant: number) {
  const reponse = await portail("/portail/paiements", { cookie, corps: { contratId, montant } });
  expect(reponse.statusCode).toBe(201);
  return reponse.json().paiement as { id: string; reference: string; urlPaiement: string };
}

beforeAll(async () => {
  ctx = await demarrer({ env: { URL_PORTAIL: ORIGINE_PORTAIL, PAIEMENT_PRESTATAIRE: "simulation" }, envoiCodes, prestatairePaiement: prestataire });
  for (const role of ["gerant", "charge_clientele", "commercial", "caissier", "auditeur"] as const) {
    cookies[role] = await connecter(ctx, await creerCompte(ctx, role));
  }
});

afterAll(async () => {
  await ctx?.fermer();
});

describe("espace client d'un particulier", () => {
  it("s'ouvre au numéro enregistré par l'agence ; la session dit le type de client ; pas de collaborateurs", async () => {
    const awa = await particulierAssure("Koné Awa Espace");
    const session = await portail("/portail/session", { cookie: awa.cookie });
    expect(session.json().session).toEqual({ nom: "Koné Awa Espace", role: "titulaire", entreprise: "Koné Awa Espace", telephone: awa.telephone, typeClient: "particulier" });

    const tableau = await portail("/portail/flotte", { cookie: awa.cookie });
    expect(tableau.statusCode).toBe(200);
    expect(tableau.json()).toMatchObject({ typeClient: "particulier", paiementEnLigne: true, resume: { vehicules: 1, resteAPayer: 100_003 } });
    expect(tableau.json().contrats).toEqual([expect.objectContaining({ id: awa.contratId, statut: "en_attente_paiement", paiementEnCours: null })]);
    expect(tableau.json().vehicules[0]).toMatchObject({ contratId: awa.contratId });

    const ajout = await portail("/portail/gestionnaires", { cookie: awa.cookie, corps: { nom: "Son frère", telephone: `07${unique()}` } });
    expect(ajout.statusCode).toBe(422);
    expect(ajout.json().message).toContain("réservés aux entreprises");

    // L'agence voit l'accès ouvert automatiquement, sans auteur du personnel
    const acces = await envoyer(ctx, { url: `/clients/${awa.clientId}/acces-portail`, cookie: cookies.charge_clientele });
    expect(acces.json().acces).toEqual([expect.objectContaining({ role: "titulaire", actif: true, creePar: null })]);
  });
});

describe("paiement d'une prime en ligne", () => {
  it("préparation contrôlée, résultat vérifié auprès du prestataire, encaissement sans caissier, contrat mis en vigueur", async () => {
    const awa = await particulierAssure("Koné Awa Paiement");

    // Montants refusés par la base : pas un multiple de 5, au-delà du reste ; par l'API : au-delà du plafond
    for (const montant of [1001, 100_100]) {
      const refus = await portail("/portail/paiements", { cookie: awa.cookie, corps: { contratId: awa.contratId, montant } });
      expect(refus.statusCode).toBe(422);
      expect(refus.json().message).toContain("multiple de 5");
    }
    expect((await portail("/portail/paiements", { cookie: awa.cookie, corps: { contratId: awa.contratId, montant: 3_000_000 } })).statusCode).toBe(400);
    // Depuis le back-office : refusé
    expect((await portail("/portail/paiements", { cookie: awa.cookie, corps: { contratId: awa.contratId, montant: 40_000 }, origine: ORIGINE })).statusCode).toBe(403);

    const premier = await payerEnLigne(awa.cookie, awa.contratId, 40_000);
    expect(premier.reference).toMatch(/^DBS-\d{8}$/);
    expect(premier.urlPaiement).toBe(`${ORIGINE_PORTAIL}/paiements/${premier.id}`);
    expect(prestataire.demandes.at(-1)).toMatchObject({
      reference: premier.reference, montant: 40_000, telephone: awa.telephone, nomClient: "Koné Awa Paiement",
      urlNotification: `${ORIGINE_PORTAIL}/api/paiements/notifications/simulation`,
    });
    const enCours = await portail("/portail/paiements", { cookie: awa.cookie, corps: { contratId: awa.contratId, montant: 5_000 } });
    expect(enCours.statusCode).toBe(422);
    expect(enCours.json().message).toContain("déjà en cours");
    expect((await portail("/portail/flotte", { cookie: awa.cookie })).json().contrats[0].paiementEnCours).toBe(premier.id);

    const attente = await portail(`/portail/paiements/${premier.id}`, { cookie: awa.cookie });
    expect(attente.json()).toMatchObject({ paiement: { statut: "en_attente", montant: 40_000 }, simulation: true });

    const accepte = await portail(`/portail/paiements/${premier.id}/simulation`, { cookie: awa.cookie, corps: { accepte: true, moyen: "ORANGE_MONEY" } });
    expect(accepte.statusCode).toBe(200);
    expect(accepte.json().paiement).toMatchObject({ statut: "accepte", moyen: "ORANGE_MONEY", resteAPayer: 60_003, statutContrat: "en_attente_paiement" });
    // Rejouer ne change rien
    expect((await portail(`/portail/paiements/${premier.id}/simulation`, { cookie: awa.cookie, corps: { accepte: false } })).statusCode).toBe(422);

    // Le solde, arrondi au multiple de 5 supérieur (60 005 pour 60 003) : le contrat passe en vigueur
    const solde = await payerEnLigne(awa.cookie, awa.contratId, 60_005);
    const fin = await portail(`/portail/paiements/${solde.id}/simulation`, { cookie: awa.cookie, corps: { accepte: true } });
    expect(fin.json().paiement).toMatchObject({ statut: "accepte", moyen: "WAVE", resteAPayer: -2, statutContrat: "en_vigueur" });
    const paye = await portail("/portail/paiements", { cookie: awa.cookie, corps: { contratId: awa.contratId, montant: 100 } });
    expect(paye.statusCode).toBe(422);
    expect(paye.json().message).toContain("entièrement payé");

    // Côté agence : deux encaissements Mobile Money, « Paiement en ligne », référence du prestataire
    const situation = await envoyer(ctx, { url: `/contrats/${awa.contratId}/paiements`, cookie: cookies.caissier });
    expect(situation.statusCode).toBe(200);
    expect(JSON.stringify(situation.json())).toContain("Paiement en ligne");
    const liste = await envoyer(ctx, { url: "/paiements-en-ligne?statut=accepte", cookie: cookies.caissier });
    expect(liste.json().paiements).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: premier.reference, montant: 40_000, client: "Koné Awa Paiement", encaissementId: expect.any(String) }),
    ]));
    expect((await envoyer(ctx, { url: "/paiements-en-ligne", cookie: cookies.commercial })).statusCode).toBe(403);

    const historique = await portail("/portail/paiements", { cookie: awa.cookie });
    expect(historique.json().paiements.map((p: { statut: string }) => p.statut)).toEqual(["accepte", "accepte"]);
  });

  it("refus, panne du prestataire, montant différent à régulariser par le gérant", async () => {
    const bakary = await particulierAssure("Bakary Paiement", 50_000);

    const refuse = await payerEnLigne(bakary.cookie, bakary.contratId, 50_000);
    const reponse = await portail(`/portail/paiements/${refuse.id}/simulation`, { cookie: bakary.cookie, corps: { accepte: false } });
    expect(reponse.json().paiement).toMatchObject({ statut: "refuse", resteAPayer: 50_000 });

    // Prestataire en panne : erreur claire, et le paiement est abandonné (un nouvel essai reste possible)
    prestataire.enPanne = true;
    const panne = await portail("/portail/paiements", { cookie: bakary.cookie, corps: { contratId: bakary.contratId, montant: 50_000 } });
    prestataire.enPanne = false;
    expect(panne.statusCode).toBe(502);
    expect(panne.json().code).toBe("paiement_indisponible");
    expect((await portail("/portail/paiements", { cookie: bakary.cookie })).json().paiements[0].statut).toBe("abandonne");

    // Le prestataire confirme un autre montant que celui demandé : rien n'est encaissé, l'agence régularise
    const ecart = await payerEnLigne(bakary.cookie, bakary.contratId, 50_000);
    prestataire.simuler(ecart.reference, true, 45_000);
    const lu = await portail(`/portail/paiements/${ecart.id}`, { cookie: bakary.cookie });
    expect(lu.json().paiement).toMatchObject({ statut: "a_regulariser", resteAPayer: 50_000 });
    expect(lu.json().paiement).not.toHaveProperty("motif");

    const aRegulariser = await envoyer(ctx, { url: "/paiements-en-ligne?statut=a_regulariser", cookie: cookies.gerant });
    const ligne = aRegulariser.json().paiements.find((p: { id: string }) => p.id === ecart.id);
    expect(ligne.motif).toContain("45000 F CFA");
    const parCaissier = await envoyer(ctx, { url: `/paiements-en-ligne/${ecart.id}/regularisation`, cookie: cookies.caissier, corps: { motif: "Remboursé au client" } });
    expect(parCaissier.statusCode).toBe(403);
    const parGerant = await envoyer(ctx, { url: `/paiements-en-ligne/${ecart.id}/regularisation`, cookie: cookies.gerant, corps: { motif: "Remboursé au client par Wave" } });
    expect(parGerant.statusCode).toBe(204);
    expect((await envoyer(ctx, { url: `/paiements-en-ligne/${ecart.id}/regularisation`, cookie: cookies.gerant, corps: { motif: "Deuxième fois" } })).statusCode).toBe(404);
  });

  it("chacun ses paiements ; notifications non authentifiées refusées ; abandon après un jour", async () => {
    const un = await particulierAssure("Client Un Isolement");
    const deux = await particulierAssure("Client Deux Isolement");
    const paiement = await payerEnLigne(un.cookie, un.contratId, 10_000);

    expect((await portail(`/portail/paiements/${paiement.id}`, { cookie: deux.cookie })).statusCode).toBe(404);
    expect((await portail(`/portail/paiements/${paiement.id}/simulation`, { cookie: deux.cookie, corps: { accepte: true } })).statusCode).toBe(404);
    expect((await portail("/portail/paiements", { cookie: deux.cookie, corps: { contratId: un.contratId, montant: 10_000 } })).statusCode).toBe(404);
    expect((await portail("/portail/paiements", { cookie: deux.cookie })).json().paiements).toEqual([]);

    const notification = await envoyer(ctx, { url: "/paiements/notifications/simulation", corps: { reference: paiement.reference }, origine: null });
    expect(notification.statusCode).toBe(401);
    expect((await envoyer(ctx, { url: "/paiements/notifications/autre", corps: { reference: paiement.reference }, origine: null })).statusCode).toBe(404);

    await ctx.base.query("UPDATE app.paiements_en_ligne SET cree_le = now() - interval '2 days' WHERE id = $1", [paiement.id]);
    const bilan = await executerMaintenance(ctx.pool, ctx.antivirus, ctx.cleChiffrement);
    expect(bilan.paiementsAbandonnes).toBeGreaterThanOrEqual(1);
    expect((await portail(`/portail/paiements/${paiement.id}`, { cookie: un.cookie })).json().paiement.statut).toBe("abandonne");
  });
});

describe("déclaration d'un sinistre en ligne", () => {
  it("déclaration, photos analysées et chiffrées, suivi par l'agence", async () => {
    const awa = await particulierAssure("Koné Awa Sinistre");
    const declaration = {
      contratId: awa.contratId, vehiculeId: awa.vehiculeId, survenuLe: aujourdHuiPlus(-1), nature: "materiel",
      lieu: "Carrefour de la Riviera 2", circonstances: "Un taxi a heurté l'arrière de ma voiture au feu rouge.",
    };
    expect((await portail("/portail/sinistres", { cookie: awa.cookie, corps: { ...declaration, circonstances: "Choc" } })).statusCode).toBe(400);
    const future = await portail("/portail/sinistres", { cookie: awa.cookie, corps: { ...declaration, survenuLe: aujourdHuiPlus(2) } });
    expect(future.statusCode).toBe(422);
    expect((await portail("/portail/sinistres", { cookie: awa.cookie, corps: declaration, origine: ORIGINE })).statusCode).toBe(403);

    const cree = await portail("/portail/sinistres", { cookie: awa.cookie, corps: declaration });
    expect(cree.statusCode).toBe(201);
    const sinistreId = cree.json().sinistre.id as string;

    const photo = await portail(`/portail/sinistres/${sinistreId}/pieces`, {
      cookie: awa.cookie, corps: { nom: "C:\\Photos\\choc arrière.png", type: "image/png", fichier: PNG.toString("base64") },
    });
    expect(photo.statusCode).toBe(201);
    expect(photo.json().piece).toMatchObject({ nom: "choc arrière.png", type: "image/png", taille: PNG.length });
    const faux = await portail(`/portail/sinistres/${sinistreId}/pieces`, {
      cookie: awa.cookie, corps: { nom: "constat.pdf", type: "application/pdf", fichier: PNG.toString("base64") },
    });
    expect(faux.statusCode).toBe(422);
    expect(faux.json().code).toBe("piece_invalide");
    const virus = await portail(`/portail/sinistres/${sinistreId}/pieces`, {
      cookie: awa.cookie,
      corps: { nom: "virus.pdf", type: "application/pdf", fichier: Buffer.from("%PDF-1.4 EICAR-STANDARD-ANTIVIRUS-TEST-FILE").toString("base64") },
    });
    expect(virus.statusCode).toBe(422);
    expect(virus.json().code).toBe("fichier_infecte");
    ctx.antivirus.disponible = false;
    const sansAntivirus = await portail(`/portail/sinistres/${sinistreId}/pieces`, {
      cookie: awa.cookie, corps: { nom: "photo.png", type: "image/png", fichier: PNG.toString("base64") },
    });
    ctx.antivirus.disponible = true;
    expect(sansAntivirus.statusCode).toBe(503);

    const liste = await portail("/portail/sinistres", { cookie: awa.cookie });
    expect(liste.json().sinistres).toEqual([expect.objectContaining({
      id: sinistreId, statut: "declare", declareEnLigne: true, pieces: 1, piecesAcceptees: true, lieu: declaration.lieu,
      circonstances: declaration.circonstances,
    })]);
    expect(liste.json().sinistres[0]).not.toHaveProperty("description");
    const detail = await portail(`/portail/sinistres/${sinistreId}`, { cookie: awa.cookie });
    expect(detail.json().pieces).toEqual([expect.objectContaining({ nom: "choc arrière.png", taille: PNG.length })]);

    // Un autre client ne voit ni ne complète cette déclaration
    const autre = await particulierAssure("Autre Client Sinistre");
    expect((await portail(`/portail/sinistres/${sinistreId}`, { cookie: autre.cookie })).statusCode).toBe(404);
    expect((await portail(`/portail/sinistres/${sinistreId}/pieces`, {
      cookie: autre.cookie, corps: { nom: "photo.png", type: "image/png", fichier: PNG.toString("base64") },
    })).statusCode).toBe(404);
    expect((await portail("/portail/sinistres", { cookie: autre.cookie, corps: { ...declaration, vehiculeId: autre.vehiculeId } })).statusCode).toBe(404);

    // L'agence : en tête de la liste à traiter, avec le récit, le déclarant et la photo
    const aTraiter = await envoyer(ctx, { url: "/sinistres", cookie: cookies.charge_clientele });
    expect(aTraiter.statusCode).toBe(200);
    expect(aTraiter.json().sinistres.find((s: { id: string }) => s.id === sinistreId)).toMatchObject({
      client: "Koné Awa Sinistre", declareEnLigne: true, pieces: 1, statut: "declare",
    });
    expect((await envoyer(ctx, { url: "/sinistres", cookie: cookies.caissier })).statusCode).toBe(403);
    const fiche = await envoyer(ctx, { url: `/sinistres/${sinistreId}`, cookie: cookies.auditeur });
    expect(fiche.json().sinistre).toMatchObject({ circonstances: declaration.circonstances, declarePar: "Koné Awa Sinistre", telephoneDeclarant: awa.telephone });
    const pieceId = fiche.json().pieces[0].id as string;
    expect(fiche.json().pieces[0]).toMatchObject({ etatAnalyse: "saine", deposePar: "Koné Awa Sinistre" });

    const telechargement = await envoyer(ctx, { url: `/sinistres/${sinistreId}/pieces/${pieceId}`, cookie: cookies.charge_clientele });
    expect(telechargement.statusCode).toBe(200);
    expect(telechargement.headers["content-type"]).toBe("image/png");
    expect(telechargement.headers["content-disposition"]).toBe('attachment; filename="choc-arriere.png"');
    expect(telechargement.rawPayload.equals(PNG)).toBe(true);
    expect((await envoyer(ctx, { url: `/sinistres/${sinistreId}/pieces/${pieceId}`, cookie: cookies.auditeur })).statusCode).toBe(403);
    expect((await envoyer(ctx, { url: `/sinistres/${awa.contratId}/pieces/${pieceId}`, cookie: cookies.gerant })).statusCode).toBe(404);

    // L'agence fait avancer le dossier ; le client voit le statut, pas la note interne
    await envoyer(ctx, { methode: "PATCH", url: `/sinistres/${sinistreId}`, cookie: cookies.charge_clientele,
      corps: { statut: "transmis_compagnie", referenceCompagnie: "CIE-2026-77", description: "Note interne de l'agence" } });
    const suivi = (await portail("/portail/sinistres", { cookie: awa.cookie })).json().sinistres[0];
    expect(suivi).toMatchObject({ statut: "transmis_compagnie", referenceCompagnie: "CIE-2026-77" });
    expect(JSON.stringify(suivi)).not.toContain("Note interne");
  });
});
