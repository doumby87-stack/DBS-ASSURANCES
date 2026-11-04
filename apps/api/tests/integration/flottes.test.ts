// Flottes (tâche 8) : import contrôlé, export pour la cotation, composition et avenants au prorata, reste à
// payer avec les avenants, rappels groupés des documents des véhicules.

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connecter, creerCompte, demarrer, envoyer, type Contexte } from "./outils.js";

let ctx: Contexte;
const cookies: Record<string, string> = {};
let suite = 0;

function unique(): string {
  suite += 1;
  return String((Date.now() + suite) % 100_000_000).padStart(8, "0");
}

function aujourdHuiPlus(jours: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** « 2026-11-24 » → « 24/11/2026 » */
const francais = (iso: string) => iso.split("-").reverse().join("/");

async function nouveauClient(nom: string): Promise<string> {
  const reponse = await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele, corps: { type: "entreprise", nom, telephone: `05${unique()}` } });
  expect(reponse.statusCode).toBe(201);
  return reponse.json().client.id;
}

function importer(clientId: string, contenu: Buffer, confirmer = false, cookie = cookies.charge_clientele) {
  return envoyer(ctx, { url: `/clients/${clientId}/vehicules/import`, cookie, corps: { fichier: contenu.toString("base64"), confirmer } });
}

beforeAll(async () => {
  ctx = await demarrer();
  for (const role of ["gerant", "charge_clientele", "commercial", "caissier", "auditeur"] as const) {
    cookies[role] = await connecter(ctx, await creerCompte(ctx, role));
  }
});

afterAll(async () => {
  await ctx?.fermer();
});

describe("import de la liste des véhicules", () => {
  it("aperçu : chaque ligne contrôlée, toutes les erreurs rendues, rien d'enregistré", async () => {
    const clientId = await nouveauClient("Transports Aperçu");
    const plaque = `${unique().slice(0, 4)} AP 01`;
    const csv = Buffer.from([
      "Immatriculation;Marque;CV;Visite technique",
      `${plaque};Toyota;9;24/11/2026`,
      "X;Isuzu;150;31/02/2027",
    ].join("\n"));

    const apercu = await importer(clientId, csv);
    expect(apercu.statusCode).toBe(200);
    expect(apercu.json()).toMatchObject({ enregistre: false, resume: { creations: 1, misesAJour: 0 } });
    expect(apercu.json().erreurs.map((e: { ligne: number; colonne: string }) => [e.ligne, e.colonne])).toEqual([
      [3, "Immatriculation"], [3, "Puissance fiscale (CV)"], [3, "Visite technique"],
    ]);

    const refuse = await importer(clientId, csv, true);
    expect(refuse.statusCode).toBe(422);
    expect(refuse.json().code).toBe("import_invalide");
    const { rowCount } = await ctx.base.query("SELECT 1 FROM app.vehicules WHERE client_id = $1", [clientId]);
    expect(rowCount).toBe(0);
  });

  it("un vrai classeur Excel s'importe ; un nouvel import complète les fiches sans effacer", async () => {
    const clientId = await nouveauClient("Transports Excel");
    const xlsx = readFileSync(new URL("../fixtures/flotte-libreoffice.xlsx", import.meta.url));

    const importe = await importer(clientId, xlsx, true);
    expect(importe.statusCode).toBe(201);
    expect(importe.json()).toMatchObject({ enregistre: true, erreurs: [], resume: { creations: 2, misesAJour: 0 } });

    const flotte = await envoyer(ctx, { url: `/clients/${clientId}/flotte`, cookie: cookies.auditeur });
    expect(flotte.statusCode).toBe(200);
    expect(flotte.json().vehicules).toEqual([
      expect.objectContaining({
        immatriculation: "1234 AB 01", marque: "Renault & Trucks", puissanceFiscale: 12, valeurVenale: 45000000,
        echeanceVisiteTechnique: "2026-11-24", echeanceVignette: null, echeanceCarteTransport: "2027-01-31",
      }),
      expect.objectContaining({ immatriculation: "5678 CD 01", echeanceVisiteTechnique: "2027-03-05", echeanceVignette: "2026-12-15" }),
    ]);

    // Mise à jour : même plaque écrite autrement, nouvelle vignette ; la marque vide ne l'efface pas
    const maj = await importer(clientId, Buffer.from("Immatriculation;Marque;Vignette\n1234-ab-01;;30/06/2027\n"), true);
    expect(maj.statusCode).toBe(201);
    expect(maj.json().resume).toEqual({ creations: 0, misesAJour: 1 });
    const { rows } = await ctx.base.query("SELECT immatriculation, marque, echeance_vignette::text AS vignette FROM app.vehicules WHERE client_id = $1 ORDER BY 1", [clientId]);
    expect(rows[0]).toEqual({ immatriculation: "1234 AB 01", marque: "Renault & Trucks", vignette: "2027-06-30" });
  });

  it("refuse un véhicule d'un autre client, un fichier illisible, et l'import par le caissier", async () => {
    const proprietaire = await nouveauClient("Transports Propriétaire");
    const autre = await nouveauClient("Transports Autre");
    const plaque = `${unique().slice(0, 4)} PR 01`;
    expect((await importer(proprietaire, Buffer.from(`Immatriculation\n${plaque}\n`), true)).statusCode).toBe(201);

    const conflit = await importer(autre, Buffer.from(`Immatriculation\n${plaque}\n`));
    expect(conflit.json().erreurs).toEqual([
      { ligne: 2, colonne: "Immatriculation", valeur: plaque, message: "Véhicule déjà enregistré pour un autre client de l'agence." },
    ]);
    const xls = await importer(autre, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]));
    expect(xls.statusCode).toBe(422);
    expect(xls.json().code).toBe("fichier_illisible");
    expect((await importer(autre, Buffer.from("Immatriculation\nAA 11\n"), false, cookies.caissier)).statusCode).toBe(403);
  });

  it("le modèle à remplir et l'export pour la cotation, consigné au journal de sécurité", async () => {
    const modele = await envoyer(ctx, { url: "/flottes/modele-import.csv", cookie: cookies.commercial });
    expect(modele.statusCode).toBe(200);
    expect(modele.body.split("\r\n")[0]).toBe(
      "﻿Immatriculation;N° de châssis;Marque;Modèle;Genre;Usage;Puissance fiscale (CV);Valeur vénale;Visite technique;Vignette;Carte de transport",
    );

    const clientId = await nouveauClient("Transports Export");
    const plaque = `${unique().slice(0, 4)} EX 01`;
    await importer(clientId, Buffer.from(`Immatriculation;Marque;Usage;Vignette\n${plaque};=HYPERLINK("x");Livraison;31/03/2027\n`), true);

    const exportCsv = await envoyer(ctx, { url: `/clients/${clientId}/flotte/export.csv`, cookie: cookies.commercial });
    expect(exportCsv.statusCode).toBe(200);
    expect(exportCsv.headers["content-disposition"]).toBe('attachment; filename="flotte-transports-export.csv"');
    const lignes = exportCsv.body.split("\r\n");
    expect(lignes[0]).toContain(";Contrat en cours");
    // Une formule tapée dans une cellule ressort neutralisée (apostrophe) : Excel ne l'exécutera pas
    expect(lignes[1]).toBe(`${plaque};;"'=HYPERLINK(""x"")";;;Livraison;;;;31/03/2027;;`);
    expect((await envoyer(ctx, { url: `/clients/${clientId}/flotte/export.csv`, cookie: cookies.auditeur })).statusCode).toBe(403);
    const { rows } = await ctx.base.query(
      "SELECT count(*)::int AS n FROM securite.evenements WHERE type = 'export_donnees' AND objet = 'Flotte de Transports Export (1 véhicules)'",
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("contrat flotte : composition, avenants au prorata, reste à payer", () => {
  it("composition de départ, paiement, ajout et retrait au prorata, réglés au guichet", async () => {
    const clientId = await nouveauClient("Transports Prorata");
    const plaques = [0, 1, 2].map((n) => `${unique().slice(0, 4)} P${n} 01`);
    await importer(clientId, Buffer.from(`Immatriculation\n${plaques.join("\n")}\n`), true);
    const { rows: vehicules } = await ctx.base.query<{ id: string; immatriculation: string }>(
      "SELECT id, immatriculation FROM app.vehicules WHERE client_id = $1 ORDER BY immatriculation", [clientId]);
    const [v1, v2, v3] = plaques.map((p) => vehicules.find((v) => v.immatriculation === p)!.id);

    const contrat = await envoyer(ctx, {
      url: "/contrats", cookie: cookies.charge_clientele,
      corps: { clientId, branche: "flotte", numeroPolice: `FLT-${unique()}`, dateEffet: aujourdHuiPlus(-100), dateEcheance: aujourdHuiPlus(265), primeTtc: 900000 },
    });
    expect(contrat.statusCode).toBe(201);
    const contratId = contrat.json().contrat.id as string;

    for (const vehiculeId of [v1, v2]) {
      const rattache = await envoyer(ctx, { url: `/contrats/${contratId}/vehicules`, cookie: cookies.charge_clientele, corps: { vehiculeId, primeVehicule: 450000 } });
      expect(rattache.statusCode).toBe(201);
      expect(rattache.json().vehicule.ajouteLe).toBe(aujourdHuiPlus(-100));
    }
    const tropTot = await envoyer(ctx, { url: `/contrats/${contratId}/avenants`, cookie: cookies.charge_clientele,
      corps: { vehiculeId: v3, nature: "ajout", dateEffet: aujourdHuiPlus(0), primeVehicule: 365000 } });
    expect(tropTot.statusCode).toBe(422);
    expect(tropTot.json().message).toContain("contrat en vigueur");

    expect((await envoyer(ctx, { url: "/encaissements", cookie: cookies.caissier,
      corps: { contratId, montant: 900000, mode: "virement", reference: `VIR-${unique()}` } })).statusCode).toBe(201);

    // Aperçu, puis avenant : 365 000 × 265 ÷ 365 = 265 000 F CFA
    const corps = { vehiculeId: v3, nature: "ajout", dateEffet: aujourdHuiPlus(0), primeVehicule: 365000 };
    const apercu = await envoyer(ctx, { url: `/contrats/${contratId}/avenants/apercu`, cookie: cookies.charge_clientele, corps });
    expect(apercu.json().apercu).toEqual({ primeVehicule: 365000, joursPeriode: 365, joursRestants: 265, montant: 265000 });
    expect((await envoyer(ctx, { url: `/contrats/${contratId}/avenants`, cookie: cookies.commercial, corps })).statusCode).toBe(403);
    const ajout = await envoyer(ctx, { url: `/contrats/${contratId}/avenants`, cookie: cookies.charge_clientele, corps });
    expect(ajout.statusCode).toBe(201);
    expect(ajout.json().avenant).toMatchObject({ nature: "ajout", montant: 265000, joursRestants: 265, regle: false, immatriculation: plaques[2] });

    const paiements = await envoyer(ctx, { url: `/contrats/${contratId}/paiements`, cookie: cookies.caissier });
    expect(paiements.json().contrat).toMatchObject({ primeTtc: 900000, primesAvenants: 265000, primeDue: 1165000, resteAPayer: 265000 });
    const fiche = await envoyer(ctx, { url: `/clients/${clientId}`, cookie: cookies.gerant });
    expect(fiche.json().contrats[0]).toMatchObject({ statut: "en_vigueur", resteAPayer: 265000 });

    const regle = await envoyer(ctx, { url: "/encaissements", cookie: cookies.caissier,
      corps: { contratId, montant: 265000, mode: "especes" } });
    expect(regle.statusCode).toBe(201);
    const recu = await envoyer(ctx, { url: `/encaissements/${regle.json().encaissement.id}/recu`, cookie: cookies.caissier });
    expect(recu.json().recu.resteAPayer).toBe(0);

    // Retrait : ristourne de 450 000 × 200 ÷ 365 = 246 575 F CFA, prime reprise du rattachement
    const retrait = await envoyer(ctx, { url: `/contrats/${contratId}/avenants`, cookie: cookies.gerant,
      corps: { vehiculeId: v1, nature: "retrait", dateEffet: aujourdHuiPlus(65) } });
    expect(retrait.statusCode).toBe(201);
    expect(retrait.json().avenant).toMatchObject({ nature: "retrait", montant: -246575, primeVehicule: 450000, regle: null });

    const flotte = await envoyer(ctx, { url: `/clients/${clientId}/flotte`, cookie: cookies.charge_clientele });
    const contratFlotte = flotte.json().contrats[0];
    expect(contratFlotte.primesAvenants).toBe(265000 - 246575);
    expect(contratFlotte.avenants.map((a: { nature: string; regle: boolean | null }) => [a.nature, a.regle])).toEqual([["retrait", null], ["ajout", true]]);
    expect(contratFlotte.vehicules.find((v: { vehiculeId: string }) => v.vehiculeId === v1).retireLe).toBe(aujourdHuiPlus(65));
    const apres = await envoyer(ctx, { url: `/contrats/${contratId}/paiements`, cookie: cookies.caissier });
    expect(apres.json().contrat).toMatchObject({ resteAPayer: 0, aRembourser: 246575 });
  });
});

describe("rappels des documents des véhicules", () => {
  it("à faire à la main sans accord du client, avec un seul message pour toute sa flotte", async () => {
    const clientId = await nouveauClient("Transports Rappels");
    const plaques = [0, 1].map((n) => `${unique().slice(0, 4)} R${n} 01`);
    await importer(clientId, Buffer.from([
      "Immatriculation;Visite technique;Vignette",
      `${plaques[0]};${francais(aujourdHuiPlus(20))};${francais(aujourdHuiPlus(25))}`,
      `${plaques[1]};${francais(aujourdHuiPlus(12))};`,
    ].join("\n")), true);

    const relances = await envoyer(ctx, { url: "/relances", cookie: cookies.gerant });
    const message = relances.json().aFaireALaMain.filter((r: { clientId: string }) => r.clientId === clientId);
    expect(message).toHaveLength(1);
    expect(message[0].type).toBe("documents_vehicules");
    expect(message[0].texte).toBe(
      `Bonjour Transports Rappels, 3 documents de vos véhicules arrivent à échéance, le premier le ${francais(aujourdHuiPlus(12))} : `
      + `visite technique ${plaques[1]} le ${francais(aujourdHuiPlus(12)).slice(0, 5)}, `
      + `visite technique ${plaques[0]} le ${francais(aujourdHuiPlus(20)).slice(0, 5)}, `
      + `vignette ${plaques[0]} le ${francais(aujourdHuiPlus(25)).slice(0, 5)}. `
      + "Pour rouler en règle, pensez à les renouveler à temps. Pour toute question, répondez à ce message ou appelez DBS-ASSURANCES au 07 49 36 07 02.",
    );
  });
});
