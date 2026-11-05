// Portail des entreprises (tâche 10) : accès créés par l'agence, connexion par code WhatsApp, tableau de bord
// de la flotte, sinistres par véhicule, attestations une à une et en lot, collaborateurs gérés par le titulaire,
// isolement entre deux entreprises, origines et cookies séparés du back-office.

import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

function unique(): string {
  suite += 1;
  return String((Date.now() + suite) % 100_000_000).padStart(8, "0");
}

function aujourdHuiPlus(jours: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

const pdf = (texte: string) => Buffer.from(`%PDF-1.4\n% ${texte}\n%%EOF\n`);

let adresse = 0;
function portail(chemin: string, options: { cookie?: string; corps?: object; methode?: "GET" | "POST" | "DELETE"; origine?: string } = {}) {
  // Une adresse par requête : les limites par adresse sont testées en base (database/tests/10_portail.sql)
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

/** Demande un code, le lit dans la boîte d'envoi de test, se connecte : rend le cookie du portail. */
async function seConnecter(telephone: string): Promise<string> {
  const avant = codesEnvoyes.length;
  expect((await portail("/portail/connexion/code", { corps: { telephone } })).statusCode).toBe(202);
  const code = codesEnvoyes.slice(avant).find((c) => c.telephone === telephone)?.code;
  expect(code).toMatch(/^\d{6}$/);
  const connexion = await portail("/portail/connexion", { corps: { telephone, code } });
  expect(connexion.statusCode).toBe(200);
  return cookiePortail(connexion);
}

/** Entreprise avec une flotte assurée (contrat payé) : rend ses identifiants. */
async function entrepriseAssuree(nom: string) {
  const client = await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele, corps: { type: "entreprise", nom, telephone: `05${unique()}` } });
  const clientId = client.json().client.id as string;
  const plaques = [0, 1].map((n) => `${unique().slice(-4)} P${n} 01`);
  const vehicules: string[] = [];
  for (const [n, immatriculation] of plaques.entries()) {
    const vehicule = await envoyer(ctx, {
      url: `/clients/${clientId}/vehicules`, cookie: cookies.charge_clientele,
      corps: { immatriculation, ...(n === 0 ? { echeanceVisiteTechnique: aujourdHuiPlus(12) } : {}) },
    });
    vehicules.push(vehicule.json().vehicule.id);
  }
  const contratId = (await envoyer(ctx, {
    url: "/contrats", cookie: cookies.charge_clientele,
    corps: { clientId, branche: "flotte", numeroPolice: `FLT-${unique()}`, dateEffet: aujourdHuiPlus(-30), dateEcheance: aujourdHuiPlus(335), primeTtc: 600000 },
  })).json().contrat.id as string;
  for (const vehiculeId of vehicules) {
    await envoyer(ctx, { url: `/contrats/${contratId}/vehicules`, cookie: cookies.charge_clientele, corps: { vehiculeId, primeVehicule: 300000 } });
  }
  return { clientId, contratId, vehicules, plaques };
}

async function payer(contratId: string, montant: number) {
  const reponse = await envoyer(ctx, { url: "/encaissements", cookie: cookies.caissier, corps: { contratId, montant, mode: "virement", reference: `VIR-${unique()}` } });
  expect(reponse.statusCode).toBe(201);
}

beforeAll(async () => {
  ctx = await demarrer({ env: { URL_PORTAIL: ORIGINE_PORTAIL }, envoiCodes });
  for (const role of ["gerant", "charge_clientele", "commercial", "caissier", "auditeur"] as const) {
    cookies[role] = await connecter(ctx, await creerCompte(ctx, role));
  }
});

afterAll(async () => {
  await ctx?.fermer();
});

describe("accès au portail, côté agence", () => {
  it("plusieurs accès par entreprise, un numéro par accès ; un seul accès, le sien, pour un particulier", async () => {
    const { clientId } = await entrepriseAssuree("Transports Accès");
    const titulaire = await envoyer(ctx, {
      url: `/clients/${clientId}/acces-portail`, cookie: cookies.charge_clientele,
      corps: { nom: "Awa Titulaire", telephone: `07 ${unique().slice(0, 8)}`, role: "titulaire" },
    });
    expect(titulaire.statusCode).toBe(201);
    expect(titulaire.json().acces).toMatchObject({ role: "titulaire", actif: true });
    const doublon = await envoyer(ctx, {
      url: `/clients/${clientId}/acces-portail`, cookie: cookies.gerant,
      corps: { nom: "Doublon", telephone: titulaire.json().acces.telephone, role: "gestionnaire" },
    });
    expect(doublon.statusCode).toBe(409);
    expect(doublon.json().code).toBe("telephone_deja_utilise");
    expect((await envoyer(ctx, {
      url: `/clients/${clientId}/acces-portail`, cookie: cookies.commercial,
      corps: { nom: "Par un commercial", telephone: `07${unique()}`, role: "gestionnaire" },
    })).statusCode).toBe(403);

    const particulier = (await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele,
      corps: { type: "particulier", nom: "Particulier Portail", telephone: `05${unique()}` } })).json().client.id;
    const collaborateur = await envoyer(ctx, { url: `/clients/${particulier}/acces-portail`, cookie: cookies.charge_clientele,
      corps: { nom: "Particulier", telephone: `07${unique()}`, role: "gestionnaire" } });
    expect(collaborateur.statusCode).toBe(422);
    expect(collaborateur.json().message).toContain("un seul accès, le sien");
    expect((await envoyer(ctx, { url: `/clients/${particulier}/acces-portail`, cookie: cookies.charge_clientele,
      corps: { nom: "Particulier", telephone: `07${unique()}`, role: "titulaire" } })).statusCode).toBe(201);
    const second = await envoyer(ctx, { url: `/clients/${particulier}/acces-portail`, cookie: cookies.charge_clientele,
      corps: { nom: "Autre numéro", telephone: `07${unique()}`, role: "titulaire" } });
    expect(second.statusCode).toBe(422);
    expect(second.json().message).toContain("déjà un accès");

    const liste = await envoyer(ctx, { url: `/clients/${clientId}/acces-portail`, cookie: cookies.auditeur });
    expect(liste.json().acces).toEqual([expect.objectContaining({ nom: "Awa Titulaire", creePar: expect.any(String), derniereConnexionLe: null })]);
  });
});

describe("connexion au portail par code", () => {
  it("même réponse pour un numéro inconnu ; code unique, lié au numéro ; origine du portail exigée", async () => {
    const { clientId } = await entrepriseAssuree("Transports Connexion");
    const telephone = `+22507${unique()}`;
    await envoyer(ctx, { url: `/clients/${clientId}/acces-portail`, cookie: cookies.charge_clientele, corps: { nom: "Koffi", telephone, role: "titulaire" } });

    const inconnu = await portail("/portail/connexion/code", { corps: { telephone: `+22507${unique()}` } });
    const connu = await portail("/portail/connexion/code", { corps: { telephone } });
    expect(inconnu.statusCode).toBe(202);
    expect(connu.statusCode).toBe(202);
    expect(inconnu.json()).toEqual(connu.json());
    expect(codesEnvoyes.filter((c) => c.telephone === telephone)).toHaveLength(1);

    // Depuis le back-office ou un autre site : refusé
    expect((await portail("/portail/connexion/code", { corps: { telephone }, origine: ORIGINE })).statusCode).toBe(403);
    expect((await portail("/portail/connexion/code", { corps: { telephone }, origine: "https://pirate.example" })).statusCode).toBe(403);

    const code = codesEnvoyes.filter((c) => c.telephone === telephone).at(-1)!.code;
    const faux = code === "000000" ? "111111" : "000000";
    const refus = await portail("/portail/connexion", { corps: { telephone, code: faux } });
    expect(refus.statusCode).toBe(401);
    expect(refus.json().code).toBe("code_invalide");
    const connexion = await portail("/portail/connexion", { corps: { telephone, code } });
    expect(connexion.statusCode).toBe(200);
    expect(connexion.json().session).toEqual({ nom: "Koffi", role: "titulaire", entreprise: "Transports Connexion", telephone, typeClient: "entreprise" });
    const cookie = connexion.cookies.find((c) => c.name === NOM_COOKIE_PORTAIL)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/" });
    expect((await portail("/portail/connexion", { corps: { telephone, code } })).statusCode).toBe(401);

    const session = await portail("/portail/session", { cookie: cookiePortail(connexion) });
    expect(session.json().session.entreprise).toBe("Transports Connexion");

    // Cookies séparés : celui du portail n'ouvre rien au back-office, celui du personnel rien au portail
    expect((await portail("/clients", { cookie: cookiePortail(connexion) })).statusCode).toBe(401);
    expect((await envoyer(ctx, { url: "/portail/flotte", cookie: cookies.gerant })).statusCode).toBe(401);

    const deconnexion = await portail("/portail/deconnexion", { cookie: cookiePortail(connexion), methode: "POST" });
    expect(deconnexion.statusCode).toBe(204);
    expect((await portail("/portail/session", { cookie: cookiePortail(connexion) })).statusCode).toBe(401);
  });

  it("au-delà de trois demandes en 15 minutes pour un numéro, la suivante attend", async () => {
    const telephone = `+22507${unique()}`;
    for (let i = 0; i < 3; i += 1) expect((await portail("/portail/connexion/code", { corps: { telephone }, origine: ORIGINE_PORTAIL })).statusCode).toBe(202);
    const quatrieme = await portail("/portail/connexion/code", { corps: { telephone } });
    expect(quatrieme.statusCode).toBe(429);
  });
});

describe("tableau de bord, sinistres et attestations", () => {
  it("la flotte de l'entreprise connectée, et seulement elle", async () => {
    const alpha = await entrepriseAssuree("Transports Alpha Portail");
    const beta = await entrepriseAssuree("Transports Beta Portail");
    const telAlpha = `+22507${unique()}`;
    const telBeta = `+22507${unique()}`;
    await envoyer(ctx, { url: `/clients/${alpha.clientId}/acces-portail`, cookie: cookies.charge_clientele, corps: { nom: "Awa", telephone: telAlpha, role: "titulaire" } });
    await envoyer(ctx, { url: `/clients/${beta.clientId}/acces-portail`, cookie: cookies.charge_clientele, corps: { nom: "Bamba", telephone: telBeta, role: "titulaire" } });

    // Sinistre déclaré par l'agence sur le premier camion d'Alpha ; refusé sur un véhicule non couvert
    const sinistre = await envoyer(ctx, { url: `/contrats/${alpha.contratId}/sinistres`, cookie: cookies.charge_clientele,
      corps: { vehiculeId: alpha.vehicules[0], survenuLe: aujourdHuiPlus(-2), nature: "materiel", description: "Note interne" } });
    expect(sinistre.statusCode).toBe(201);
    const horsContrat = await envoyer(ctx, { url: `/contrats/${alpha.contratId}/sinistres`, cookie: cookies.charge_clientele,
      corps: { vehiculeId: beta.vehicules[0], survenuLe: aujourdHuiPlus(-2), nature: "vol" } });
    expect(horsContrat.statusCode).toBe(422);
    expect((await envoyer(ctx, { url: `/sinistres/${sinistre.json().sinistre.id}`, cookie: cookies.gerant,
      corps: { statut: "transmis_compagnie", referenceCompagnie: "SAN-2026-4411" }, methode: "PATCH" })).json().sinistre)
      .toMatchObject({ statut: "transmis_compagnie", referenceCompagnie: "SAN-2026-4411" });

    // Attestation du premier camion d'Alpha : pas avant le paiement de la prime ; puis PDF analysé et chiffré
    await payer(alpha.contratId, 400000);
    const tropTot = await envoyer(ctx, { url: `/contrats/${alpha.contratId}/vehicules/${alpha.vehicules[0]}/attestation`, cookie: cookies.charge_clientele,
      corps: { numero: "ASACI-2026-000123", fichier: pdf("attestation Alpha 1").toString("base64") } });
    expect(tropTot.statusCode).toBe(422);
    expect(tropTot.json().message).toContain("une fois la prime payée");
    await payer(alpha.contratId, 200000);
    await payer(beta.contratId, 600000);
    const depot = await envoyer(ctx, { url: `/contrats/${alpha.contratId}/vehicules/${alpha.vehicules[0]}/attestation`, cookie: cookies.charge_clientele,
      corps: { numero: "asaci-2026-000123", fichier: pdf("attestation Alpha 1").toString("base64") } });
    expect(depot.statusCode).toBe(201);
    expect(depot.json().attestation).toMatchObject({ numero: "ASACI-2026-000123", etatAnalyse: "saine" });

    const cookieAlpha = await seConnecter(telAlpha);
    const flotte = await portail("/portail/flotte", { cookie: cookieAlpha });
    expect(flotte.statusCode).toBe(200);
    expect(flotte.json().vehicules.map((v: { immatriculation: string }) => v.immatriculation)).toEqual([...alpha.plaques].sort());
    const camion = flotte.json().vehicules.find((v: { id: string }) => v.id === alpha.vehicules[0]);
    expect(camion).toMatchObject({ numeroAttestation: "ASACI-2026-000123", attestationDisponible: true, sinistres: 1, sinistresEnCours: 1 });
    expect(flotte.json().resume).toMatchObject({ vehicules: 2, vehiculesAssures: 2, documentsARenouveler: 1, sinistresEnCours: 1, resteAPayer: 0 });
    expect(flotte.json().contrats[0]).toMatchObject({ statut: "en_vigueur", primeDue: 600000, resteAPayer: 0, vehicules: 2 });
    expect(JSON.stringify(flotte.json())).not.toContain("prime_nette");

    const detail = await portail(`/portail/vehicules/${alpha.vehicules[0]}`, { cookie: cookieAlpha });
    expect(detail.json().sinistres).toEqual([expect.objectContaining({ nature: "materiel", statut: "transmis_compagnie", referenceCompagnie: "SAN-2026-4411" })]);
    expect(detail.json().sinistres[0]).not.toHaveProperty("description");
    expect(detail.json().periodes[0]).toMatchObject({ numeroAttestation: "ASACI-2026-000123", attestationDisponible: true, retire: false });

    // Bamba (Beta) : ni la flotte, ni le véhicule, ni l'attestation d'Alpha
    const cookieBeta = await seConnecter(telBeta);
    const flotteBeta = await portail("/portail/flotte", { cookie: cookieBeta });
    expect(flotteBeta.json().vehicules.map((v: { immatriculation: string }) => v.immatriculation)).toEqual([...beta.plaques].sort());
    expect((await portail(`/portail/vehicules/${alpha.vehicules[0]}`, { cookie: cookieBeta })).statusCode).toBe(404);
    const ligneAlpha = camion.ligneId as string;
    expect((await portail(`/portail/attestations/${ligneAlpha}`, { cookie: cookieBeta })).statusCode).toBe(404);
    expect((await portail("/portail/attestations.zip", { cookie: cookieBeta })).statusCode).toBe(404);

    // Alpha : une attestation, puis toutes en lot, puis la liste en CSV ; chaque téléchargement est consigné
    const une = await portail(`/portail/attestations/${ligneAlpha}`, { cookie: cookieAlpha });
    expect(une.statusCode).toBe(200);
    expect(une.headers["content-type"]).toBe("application/pdf");
    expect(une.rawPayload.equals(pdf("attestation Alpha 1"))).toBe(true);
    const lot = await portail("/portail/attestations.zip", { cookie: cookieAlpha });
    expect(lot.headers["content-type"]).toBe("application/zip");
    expect(lot.rawPayload.includes(pdf("attestation Alpha 1"))).toBe(true);
    expect(lot.rawPayload.toString("latin1")).toContain(`attestation-${alpha.plaques[0]!.replace(/ /g, "-")}-ASACI-2026-000123.pdf`);
    const csv = await portail("/portail/flotte.csv", { cookie: cookieAlpha });
    expect(csv.body).toContain("ASACI-2026-000123");
    const { rows: journal } = await ctx.base.query(
      `SELECT type FROM portail.evenements e JOIN app.gestionnaires_portail g ON g.id = e.gestionnaire_id
       WHERE g.telephone = $1 ORDER BY e.id`, [telAlpha]);
    expect(journal.map((e) => e.type)).toEqual(
      ["code_envoye", "connexion_reussie", "attestation_telechargee", "attestations_telechargees", "export_flotte"]);
  });

  it("dépôt d'une attestation : PDF seulement, analysé par l'antivirus, numéro unique", async () => {
    const gamma = await entrepriseAssuree("Transports Gamma Portail");
    await payer(gamma.contratId, 600000);
    const url = (vehiculeId: string) => `/contrats/${gamma.contratId}/vehicules/${vehiculeId}/attestation`;
    const corps = (numero: string, contenu: Buffer) => ({ numero, fichier: contenu.toString("base64") });

    const image = await envoyer(ctx, { url: url(gamma.vehicules[0]!), cookie: cookies.charge_clientele, corps: corps("ASACI-G-1", Buffer.from("\x89PNG\r\n\x1a\nxxxx")) });
    expect(image.statusCode).toBe(422);
    expect(image.json().message).toContain("PDF");
    const virus = await envoyer(ctx, { url: url(gamma.vehicules[0]!), cookie: cookies.charge_clientele,
      corps: corps("ASACI-G-1", pdf("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")) });
    expect(virus.statusCode).toBe(422);
    expect(virus.json().code).toBe("fichier_infecte");
    ctx.antivirus.disponible = false;
    try {
      expect((await envoyer(ctx, { url: url(gamma.vehicules[0]!), cookie: cookies.charge_clientele, corps: corps("ASACI-G-1", pdf("g1")) })).statusCode).toBe(503);
    } finally {
      ctx.antivirus.disponible = true;
    }
    expect((await envoyer(ctx, { url: url(gamma.vehicules[0]!), cookie: cookies.commercial, corps: corps("ASACI-G-1", pdf("g1")) })).statusCode).toBe(403);
    expect((await envoyer(ctx, { url: url(gamma.vehicules[0]!), cookie: cookies.charge_clientele, corps: corps("ASACI-G-1", pdf("g1")) })).statusCode).toBe(201);
    const doublon = await envoyer(ctx, { url: url(gamma.vehicules[1]!), cookie: cookies.charge_clientele, corps: corps("ASACI-G-1", pdf("g2")) });
    expect(doublon.statusCode).toBe(409);
    expect(doublon.json().code).toBe("attestation_deja_enregistree");
    const { rows } = await ctx.base.query("SELECT etat_analyse, taille FROM app.attestations_vehicules a JOIN app.contrats_vehicules cv ON cv.id = a.contrat_vehicule_id WHERE cv.contrat_id = $1", [gamma.contratId]);
    expect(rows).toEqual([{ etat_analyse: "saine", taille: pdf("g1").length }]);
  });
});

describe("collaborateurs gérés par le titulaire", () => {
  it("le titulaire ajoute et retire ; un collaborateur ne le peut pas ; l'agence coupe un accès", async () => {
    const { clientId } = await entrepriseAssuree("Transports Équipe");
    const telTitulaire = `+22507${unique()}`;
    await envoyer(ctx, { url: `/clients/${clientId}/acces-portail`, cookie: cookies.charge_clientele, corps: { nom: "Titulaire Équipe", telephone: telTitulaire, role: "titulaire" } });
    const cookieTitulaire = await seConnecter(telTitulaire);

    const telCollaborateur = `+22507${unique()}`;
    const ajout = await portail("/portail/gestionnaires", { cookie: cookieTitulaire, corps: { nom: "Chef de parc", telephone: telCollaborateur } });
    expect(ajout.statusCode).toBe(201);
    expect((await portail("/portail/gestionnaires", { cookie: cookieTitulaire, corps: { nom: "Depuis le back-office", telephone: `+22507${unique()}` }, origine: ORIGINE })).statusCode).toBe(403);

    const cookieCollaborateur = await seConnecter(telCollaborateur);
    const refus = await portail("/portail/gestionnaires", { cookie: cookieCollaborateur, corps: { nom: "Intrus", telephone: `+22507${unique()}` } });
    expect(refus.statusCode).toBe(403);
    const liste = await portail("/portail/gestionnaires", { cookie: cookieCollaborateur });
    expect(liste.json().gestionnaires.map((g: { nom: string; role: string }) => [g.nom, g.role]))
      .toEqual([["Titulaire Équipe", "titulaire"], ["Chef de parc", "gestionnaire"]]);
    const moi = liste.json().gestionnaires.find((g: { moi: boolean }) => g.moi);
    expect(moi.nom).toBe("Chef de parc");

    expect((await portail(`/portail/gestionnaires/${ajout.json().gestionnaire.id}`, { cookie: cookieTitulaire, methode: "DELETE" })).statusCode).toBe(204);
    expect((await portail("/portail/flotte", { cookie: cookieCollaborateur })).statusCode).toBe(401);

    // L'agence coupe l'accès du titulaire (départ du gérant de l'entreprise) : sa session tombe aussitôt
    const acces = (await envoyer(ctx, { url: `/clients/${clientId}/acces-portail`, cookie: cookies.gerant })).json().acces;
    const titulaire = acces.find((a: { telephone: string }) => a.telephone === telTitulaire);
    expect(titulaire.derniereConnexionLe).not.toBeNull();
    const coupe = await envoyer(ctx, { url: `/acces-portail/${titulaire.id}`, cookie: cookies.gerant, corps: { actif: false }, methode: "PATCH" });
    expect(coupe.json().acces).toMatchObject({ actif: false });
    expect((await portail("/portail/flotte", { cookie: cookieTitulaire })).statusCode).toBe(401);
  });
});
