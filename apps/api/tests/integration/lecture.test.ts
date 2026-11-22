// Lecture automatique (tâche 14) : route de l'agence, avec le vrai lecteur local (Tesseract) sur les documents fictifs
// de tests/donnees/lecture. Sources (photo envoyée, justificatif enregistré), antivirus, droits par document, journal
// de sécurité sans les valeurs, limite par heure.

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chiffrerPiece } from "../../src/modules/demandes-site/piece.js";
import { connecter, creerCompte, demarrer, envoyer, type Compte, type Contexte } from "./outils.js";

const exemple = (nom: string) => readFileSync(new URL(`../donnees/lecture/${nom}`, import.meta.url));
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const jpeg = (nom: string) => ({ type: "image/jpeg", contenu: exemple(nom).toString("base64") });
const carteGrise = [jpeg("carte-grise-2023-recto.jpg"), jpeg("carte-grise-2023-verso.jpg")];
const passeport = [jpeg("passeport-photo.jpg")];
const photo = [jpeg("carte-grise-photo.jpg")];

let ctx: Contexte;
const cookies: Record<string, string> = {};
const comptes: Record<string, Compte> = {};

beforeAll(async () => {
  ctx = await demarrer({ env: { LECTURE_PRESTATAIRE: "local" } });
  for (const role of ["gerant", "charge_clientele", "commercial", "caissier"] as const) {
    comptes[role] = await creerCompte(ctx, role);
    cookies[role] = await connecter(ctx, comptes[role]);
  }
});

afterAll(async () => {
  await ctx?.fermer();
});

const lire = (cookie: string | undefined, corps: object) => envoyer(ctx, { url: "/lecture-automatique", cookie, corps });

describe("lecture automatique", () => {
  it("se signale disponible, et lit une carte grise envoyée en photo, avec les contrôles", async () => {
    expect((await envoyer(ctx, { url: "/lecture-automatique", cookie: cookies.commercial })).json()).toEqual({ disponible: true, prestataire: "local" });
    const reponse = await lire(cookies.commercial, { document: "carte_grise", fichiers: carteGrise });
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toMatchObject({
      document: "carte_grise", prestataire: "local",
      champs: { immatriculation: "CD-123-EF-01", numeroChassis: "WDB9634031L123456", puissanceFiscale: 26 },
      controles: [],
      avertissement: expect.stringContaining("vérifiez chacune avec le document"),
    });
  });

  it("pièce d'identité : la zone lisible par machine confirme le numéro et les dates", async () => {
    const reponse = await lire(cookies.charge_clientele, { document: "piece_identite", fichiers: passeport });
    expect(reponse.json().controles).toContainEqual(expect.objectContaining({ champ: "numero", niveau: "ok" }));
  });

  it("chacun ne fait lire que les documents des fiches qu'il saisit", async () => {
    expect((await lire(cookies.commercial, { document: "piece_identite", fichiers: photo })).statusCode).toBe(403);
    expect((await lire(cookies.caissier, { document: "carte_grise", fichiers: photo })).statusCode).toBe(403);
    expect((await lire(cookies.commercial, { document: "constat_amiable", fichiers: photo })).statusCode).toBe(403);
  });

  it("un seul document à la fois, deux faces au plus ; un fichier inattendu ou infecté n'est pas lu", async () => {
    expect((await lire(cookies.gerant, { document: "carte_grise" })).statusCode).toBe(400);
    expect((await lire(cookies.gerant, { document: "carte_grise", fichiers: [] })).statusCode).toBe(400);
    expect((await lire(cookies.gerant, { document: "carte_grise", fichiers: [...photo, ...photo, ...photo] })).statusCode).toBe(400);
    expect((await lire(cookies.gerant, { document: "carte_grise", fichiers: photo, demandeSiteId: "00000000-0000-4000-8000-000000000000" })).statusCode).toBe(400);
    const texte = await lire(cookies.gerant, { document: "carte_grise", fichiers: [{ type: "image/png", contenu: Buffer.from("bonjour").toString("base64") }] });
    expect(texte.statusCode).toBe(422);
    const pdfPiege = Buffer.from(`%PDF-1.4\n${EICAR}\n%%EOF\n`, "latin1").toString("base64");
    // Une seule face infectée suffit à refuser la lecture des deux
    const infecte = await lire(cookies.gerant, {
      document: "constat_amiable", fichiers: [photo[0], { type: "application/pdf", contenu: pdfPiege }],
    });
    expect(infecte.statusCode).toBe(422);
    expect(infecte.json().code).toBe("piece_infectee");
  });

  it("lit une carte grise précise parmi les documents d'une demande du site, jamais un classeur", async () => {
    // Demande d'une flotte : une liste (classeur), puis deux cartes grises, analysées saines
    const pieces = [
      { nature: "liste_vehicules", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contenu: Buffer.from("PK classeur") },
      { nature: "carte_grise", type: "image/jpeg", contenu: exemple("carte-grise-2023-recto.jpg") },
      { nature: "carte_grise", type: "image/jpeg", contenu: exemple("carte-grise-2023-verso.jpg") },
    ].map((p) => ({ ...p, ...chiffrerPiece(ctx.cleChiffrement, p.contenu) }));
    const { rows: [demande] } = await ctx.base.query<{ id: string; numero: number }>(
      `SELECT * FROM app.enregistrer_demande_site('flotte', 'entreprise', 'Flotte Lecture', '+2250101019999', NULL, NULL, NULL,
         'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('lecture'), NULL,
         $1::uuid[], $2::text[], $3::text[], $4::int[], $5::bytea[], $6::bytea[])`,
      [pieces.map((p) => p.id), pieces.map((p) => p.nature), pieces.map((p) => p.type), pieces.map((p) => p.contenu.length),
       pieces.map((p) => p.contenuChiffre), pieces.map((p) => p.empreinte)],
    );
    for (const p of pieces) await ctx.base.query("SELECT app.enregistrer_analyse_piece($1, true, NULL)", [p.id]);

    expect((await lire(cookies.commercial, { document: "carte_grise", pieceDemandeSiteId: pieces[2]!.id })).statusCode).toBe(200);
    expect((await lire(cookies.commercial, { document: "carte_grise", demandeSiteId: demande!.id })).statusCode).toBe(200);
    expect((await lire(cookies.commercial, { document: "carte_grise", pieceDemandeSiteId: pieces[0]!.id })).statusCode).toBe(404);
    expect((await lire(cookies.caissier, { document: "carte_grise", pieceDemandeSiteId: pieces[1]!.id })).statusCode).toBe(403);
    const { rows: [journal] } = await ctx.base.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM securite.evenements WHERE type = 'lecture_automatique' AND objet = $1",
      [`Carte grise, demande du site n° ${demande!.numero}`],
    );
    expect(journal!.n).toBe(2);
  });

  it("lit un justificatif déjà enregistré sur la fiche, et consigne la lecture sans les valeurs lues", async () => {
    const client = await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele, corps: { type: "particulier", nom: "Lecture Test", telephone: "0101010101" } });
    expect(client.statusCode).toBe(201);
    const clientId = client.json().client.id as string;
    const depot = await envoyer(ctx, {
      url: `/clients/${clientId}/justificatifs`, cookie: cookies.charge_clientele,
      corps: { nature: "piece_identite", nom: "passeport.png", type: "image/png", fichier: exemple("passeport.png").toString("base64") },
    });
    expect(depot.statusCode).toBe(201);
    const reponse = await lire(cookies.charge_clientele, { document: "piece_identite", justificatifId: depot.json().justificatif.id });
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().champs.numero).toBe("L898902C3");

    const { rows } = await ctx.base.query<{ objet: string }>(
      "SELECT objet FROM securite.evenements WHERE type = 'lecture_automatique' AND utilisateur_id = $1 ORDER BY horodatage",
      [comptes.charge_clientele!.id],
    );
    expect(rows.map((r) => r.objet)).toEqual(["Pièce d'identité (photo envoyée)", "Pièce d'identité, justificatif de Lecture Test"]);
    const parCommercial = await ctx.base.query<{ objet: string }>(
      "SELECT objet FROM securite.evenements WHERE type = 'lecture_automatique' AND utilisateur_id = $1", [comptes.commercial!.id],
    );
    expect(parCommercial.rows.map((r) => r.objet)).toContain("Carte grise (2 photos envoyées)");
    expect(rows.some((r) => r.objet.includes("L898902C3"))).toBe(false);
    expect((await lire(cookies.charge_clientele, { document: "piece_identite", justificatifId: "00000000-0000-4000-8000-000000000000" })).statusCode).toBe(404);
  });

  it("30 lectures par heure et par personne au plus", async () => {
    await ctx.base.query(
      "INSERT INTO securite.evenements (type, utilisateur_id, objet) SELECT 'lecture_automatique', $1, 'Remplissage du test' FROM generate_series(1, 30)",
      [comptes.gerant!.id],
    );
    const reponse = await lire(cookies.gerant, { document: "carte_grise", fichiers: photo });
    expect(reponse.statusCode).toBe(429);
    expect(reponse.json().code).toBe("trop_de_lectures");
  });

  it("sans lecteur configuré : indisponible, tout se saisit à la main", async () => {
    const sansLecteur = await demarrer();
    try {
      const compte = await creerCompte(sansLecteur, "gerant");
      const cookie = await connecter(sansLecteur, compte);
      expect((await envoyer(sansLecteur, { url: "/lecture-automatique", cookie })).json()).toEqual({ disponible: false, prestataire: null });
      const reponse = await envoyer(sansLecteur, { url: "/lecture-automatique", cookie, corps: { document: "carte_grise", fichiers: photo } });
      expect(reponse.statusCode).toBe(503);
    } finally {
      await sansLecteur.fermer();
    }
  });
});
