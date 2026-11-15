// Lecture automatique (tâche 14) : route de l'agence, avec le lecteur simulé. Sources (photo envoyée, justificatif
// enregistré), antivirus, droits par document, journal de sécurité sans les valeurs, limite par heure.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connecter, creerCompte, demarrer, envoyer, type Compte, type Contexte } from "./outils.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const photo = { type: "image/png", contenu: PNG.toString("base64") };

let ctx: Contexte;
const cookies: Record<string, string> = {};
const comptes: Record<string, Compte> = {};

beforeAll(async () => {
  ctx = await demarrer({ env: { LECTURE_PRESTATAIRE: "simulation" } });
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
    expect((await envoyer(ctx, { url: "/lecture-automatique", cookie: cookies.commercial })).json()).toEqual({ disponible: true, prestataire: "simulation" });
    const reponse = await lire(cookies.commercial, { document: "carte_grise", fichier: photo });
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toMatchObject({
      document: "carte_grise", prestataire: "simulation",
      champs: { immatriculation: "4521 KM 01", numeroChassis: "JTDBR32E720123456", puissanceFiscale: 8 },
      controles: [],
      avertissement: expect.stringContaining("vérifiez chacune avec le document"),
    });
  });

  it("pièce d'identité : la zone lisible par machine confirme le numéro et les dates", async () => {
    const reponse = await lire(cookies.charge_clientele, { document: "piece_identite", fichier: photo });
    expect(reponse.json().controles).toContainEqual(expect.objectContaining({ champ: "numero", niveau: "ok" }));
  });

  it("chacun ne fait lire que les documents des fiches qu'il saisit", async () => {
    expect((await lire(cookies.commercial, { document: "piece_identite", fichier: photo })).statusCode).toBe(403);
    expect((await lire(cookies.caissier, { document: "carte_grise", fichier: photo })).statusCode).toBe(403);
    expect((await lire(cookies.commercial, { document: "constat_amiable", fichier: photo })).statusCode).toBe(403);
  });

  it("un seul document à la fois ; un fichier inattendu ou infecté n'est pas lu", async () => {
    expect((await lire(cookies.gerant, { document: "carte_grise" })).statusCode).toBe(400);
    expect((await lire(cookies.gerant, { document: "carte_grise", fichier: photo, demandeSiteId: "00000000-0000-4000-8000-000000000000" })).statusCode).toBe(400);
    const texte = await lire(cookies.gerant, { document: "carte_grise", fichier: { type: "image/png", contenu: Buffer.from("bonjour").toString("base64") } });
    expect(texte.statusCode).toBe(422);
    const pdfPiege = Buffer.from(`%PDF-1.4\n${EICAR}\n%%EOF\n`, "latin1").toString("base64");
    const infecte = await lire(cookies.gerant, { document: "constat_amiable", fichier: { type: "application/pdf", contenu: pdfPiege } });
    expect(infecte.statusCode).toBe(422);
    expect(infecte.json().code).toBe("piece_infectee");
  });

  it("lit un justificatif déjà enregistré sur la fiche, et consigne la lecture sans les valeurs lues", async () => {
    const client = await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele, corps: { type: "particulier", nom: "Lecture Test", telephone: "0101010101" } });
    expect(client.statusCode).toBe(201);
    const clientId = client.json().client.id as string;
    const depot = await envoyer(ctx, {
      url: `/clients/${clientId}/justificatifs`, cookie: cookies.charge_clientele,
      corps: { nature: "piece_identite", nom: "passeport.png", type: "image/png", fichier: PNG.toString("base64") },
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
    expect(rows.some((r) => r.objet.includes("L898902C3"))).toBe(false);
    expect((await lire(cookies.charge_clientele, { document: "piece_identite", justificatifId: "00000000-0000-4000-8000-000000000000" })).statusCode).toBe(404);
  });

  it("30 lectures par heure et par personne au plus", async () => {
    await ctx.base.query(
      "INSERT INTO securite.evenements (type, utilisateur_id, objet) SELECT 'lecture_automatique', $1, 'Remplissage du test' FROM generate_series(1, 30)",
      [comptes.gerant!.id],
    );
    const reponse = await lire(cookies.gerant, { document: "carte_grise", fichier: photo });
    expect(reponse.statusCode).toBe(429);
    expect(reponse.json().code).toBe("trop_de_lectures");
  });

  it("sans lecteur configuré : indisponible, tout se saisit à la main", async () => {
    const sansLecteur = await demarrer();
    try {
      const compte = await creerCompte(sansLecteur, "gerant");
      const cookie = await connecter(sansLecteur, compte);
      expect((await envoyer(sansLecteur, { url: "/lecture-automatique", cookie })).json()).toEqual({ disponible: false, prestataire: null });
      const reponse = await envoyer(sansLecteur, { url: "/lecture-automatique", cookie, corps: { document: "carte_grise", fichier: photo } });
      expect(reponse.statusCode).toBe(503);
    } finally {
      await sansLecteur.fermer();
    }
  });
});
