// Lecture automatique (tâches 14 et ADR 0018) : route de l'agence, avec le lecteur simulé. Sources (fichier envoyé,
// justificatif enregistré, pièce d'une demande du site), reconnaissance du document, liste de véhicules en classeur
// Excel, rapprochement avec les fiches, mise à jour proposée des échéances d'un véhicule, antivirus, droits par
// document, journal de sécurité sans les valeurs, limite par heure.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TYPE_CLASSEUR } from "../../src/modules/demandes-site/piece.js";
import { classeurMinimal } from "../fixtures/zip.js";
import { connecter, creerCompte, demarrer, envoyer, type Compte, type Contexte } from "./outils.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const photo = { type: "image/png", contenu: PNG.toString("base64") };
const SITE = "https://www.site.test.ci";

let ctx: Contexte;
const cookies: Record<string, string> = {};
const comptes: Record<string, Compte> = {};

beforeAll(async () => {
  ctx = await demarrer({ env: { LECTURE_PRESTATAIRE: "simulation", URL_SITE_VITRINE: SITE } });
  for (const role of ["gerant", "charge_clientele", "commercial", "caissier"] as const) {
    comptes[role] = await creerCompte(ctx, role);
    cookies[role] = await connecter(ctx, comptes[role]);
  }
});

afterAll(async () => {
  await ctx?.fermer();
});

const lire = (cookie: string | undefined, corps: object) => envoyer(ctx, { url: "/lecture-automatique", cookie, corps });

let telephones = 0;
async function nouveauClient(nom: string): Promise<string> {
  telephones += 1;
  const telephone = `07${String(70_000_000 + telephones)}`;
  const reponse = await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele, corps: { type: "entreprise", nom, telephone } });
  expect(reponse.statusCode).toBe(201);
  return reponse.json().client.id as string;
}

describe("lecture automatique", () => {
  it("se signale disponible, et lit une carte grise envoyée en photo, avec les contrôles", async () => {
    const disponibilite = (await envoyer(ctx, { url: "/lecture-automatique", cookie: cookies.commercial })).json();
    expect(disponibilite).toMatchObject({ disponible: true, prestataire: "simulation" });
    // Le commercial ne voit que les documents qu'il peut faire lire (ni pièce d'identité ni constat)
    expect(disponibilite.documents.map((d: { document: string }) => d.document)).toEqual([
      "carte_grise", "attestation_assurance", "registre_commerce", "carte_transport", "visite_technique", "liste_vehicules",
    ]);
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
    expect(rows.map((r) => r.objet)).toEqual(["Pièce d'identité (fichier envoyé)", "Pièce d'identité, justificatif de Lecture Test"]);
    expect(rows.some((r) => r.objet.includes("L898902C3"))).toBe(false);
    expect((await lire(cookies.charge_clientele, { document: "piece_identite", justificatifId: "00000000-0000-4000-8000-000000000000" })).statusCode).toBe(404);
  });

  it("carte grise : rapprochée des fiches (véhicule déjà enregistré, assuré ou non, titulaire différent du client)", async () => {
    const proprietaire = await nouveauClient("KONÉ Mariam");
    const autre = await nouveauClient("Société Rapprochement Test");
    const vehicule = await envoyer(ctx, { url: `/clients/${proprietaire}/vehicules`, cookie: cookies.charge_clientele, corps: { immatriculation: "4521-km-01" } });
    expect(vehicule.statusCode).toBe(201);

    // Depuis la fiche d'un autre client : le véhicule est ailleurs, et le titulaire n'est pas ce client
    const depuisAutre = (await lire(cookies.commercial, { document: "carte_grise", fichier: photo, clientId: autre })).json();
    expect(depuisAutre.rapprochements).toEqual(expect.arrayContaining([
      expect.objectContaining({ niveau: "attention", lien: { type: "client", id: proprietaire }, message: expect.stringContaining("déjà enregistré chez KONÉ Mariam") }),
      expect.objectContaining({ niveau: "attention", message: expect.stringContaining("Le titulaire de la carte grise (Koné Mariam) n'est pas le client du dossier") }),
    ]));

    // Depuis la fiche du propriétaire : rien d'anormal ; sans dossier : le titulaire est reconnu comme client
    const depuisProprietaire = (await lire(cookies.commercial, { document: "carte_grise", fichier: photo, clientId: proprietaire })).json();
    expect(depuisProprietaire.rapprochements.filter((r: { niveau: string }) => r.niveau === "attention")).toEqual([]);
    expect(depuisProprietaire.rapprochements).toContainEqual(expect.objectContaining({ message: expect.stringContaining("sur la fiche de ce client") }));
    const sansDossier = (await lire(cookies.commercial, { document: "carte_grise", fichier: photo })).json();
    expect(sansDossier.rapprochements).toContainEqual(expect.objectContaining({
      niveau: "info", lien: { type: "client", id: proprietaire }, message: "Le titulaire de la carte grise est déjà client de l'agence : KONÉ Mariam.",
    }));
  });

  it("reconnaît le document quand on ne le dit pas, et propose la nouvelle échéance au véhicule, que l'on met à jour", async () => {
    const transporteur = await nouveauClient("Transports Exemple Lagunaires");
    const cree = await envoyer(ctx, {
      url: `/clients/${transporteur}/vehicules`, cookie: cookies.commercial,
      corps: { immatriculation: "7310 HJ 01", echeanceCarteTransport: "2026-06-30" },
    });
    const vehiculeId = cree.json().vehicule.id as string;

    // Le lecteur simulé « reconnaît » le premier candidat dans l'ordre du catalogue : la carte de transport
    const reponse = await lire(cookies.commercial, { document: "auto", parmi: ["visite_technique", "carte_transport"], fichier: photo, clientId: transporteur });
    expect(reponse.statusCode).toBe(200);
    const lu = reponse.json();
    expect(lu).toMatchObject({ document: "carte_transport", libelle: "Carte de transport", reconnaissance: { confiance: "haute" } });
    const proposition = lu.rapprochements.find((r: { proposition?: object }) => r.proposition)?.proposition;
    expect(proposition).toEqual({
      type: "echeances_vehicule", vehiculeId, clientId: transporteur, immatriculation: "7310 HJ 01",
      valeurs: { echeanceCarteTransport: "2027-01-31" },
    });

    // La personne applique la mise à jour ; une seconde lecture la trouve à jour
    expect((await envoyer(ctx, { methode: "PATCH", url: `/vehicules/${vehiculeId}`, cookie: cookies.caissier, corps: proposition.valeurs })).statusCode).toBe(403);
    expect((await envoyer(ctx, { methode: "PATCH", url: `/vehicules/${vehiculeId}`, cookie: cookies.commercial, corps: {} })).statusCode).toBe(400);
    expect((await envoyer(ctx, { methode: "PATCH", url: `/vehicules/${vehiculeId}`, cookie: cookies.commercial, corps: { immatriculation: "0000 AA 01" } })).statusCode).toBe(400);
    expect((await envoyer(ctx, { methode: "PATCH", url: "/vehicules/00000000-0000-4000-8000-000000000000", cookie: cookies.commercial, corps: proposition.valeurs })).statusCode).toBe(404);
    const maj = await envoyer(ctx, { methode: "PATCH", url: `/vehicules/${vehiculeId}`, cookie: cookies.commercial, corps: proposition.valeurs });
    expect(maj.statusCode).toBe(200);
    expect(maj.json().vehicule).toMatchObject({ immatriculation: "7310 HJ 01", echeanceCarteTransport: "2027-01-31", echeanceVisiteTechnique: null });
    const relu = (await lire(cookies.commercial, { document: "carte_transport", fichier: photo, clientId: transporteur })).json();
    expect(relu.rapprochements.some((r: { proposition?: object }) => r.proposition)).toBe(false);
    expect(relu.rapprochements).toContainEqual(expect.objectContaining({ message: expect.stringContaining("déjà à jour") }));

    // La visite technique relue propose son échéance à son tour ; une lecture « auto » réservée à d'autres est refusée
    const visite = (await lire(cookies.commercial, { document: "visite_technique", fichier: photo })).json();
    expect(visite.rapprochements.find((r: { proposition?: object }) => r.proposition)?.proposition.valeurs).toEqual({ echeanceVisiteTechnique: "2027-03-11" });
    expect((await lire(cookies.commercial, { document: "auto", parmi: ["piece_identite", "constat_amiable"], fichier: photo })).statusCode).toBe(403);
  });

  it("une liste de véhicules en classeur Excel se lit sans modèle ; un classeur n'est rien d'autre qu'une liste", async () => {
    const classeur = classeurMinimal([
      ["Immatriculation", "Marque", "Visite technique"], ["7311 HJ 01", "Isuzu", "02/12/2026"], ["7311-hj-01", "Isuzu", ""], ["7312 HJ 01", "Hino", ""],
    ]);
    const fichier = { type: TYPE_CLASSEUR, contenu: classeur.toString("base64") };
    const reponse = await lire(cookies.commercial, { document: "auto", fichier });
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toMatchObject({
      document: "liste_vehicules", prestataire: "classeur",
      champs: {
        documentReconnu: true, lisibilite: "partielle", nombreVehiculesDocument: 2,
        vehicules: [
          expect.objectContaining({ immatriculation: "7311 HJ 01", marque: "Isuzu", echeanceVisiteTechnique: "2026-12-02" }),
          expect.objectContaining({ immatriculation: "7312 HJ 01", marque: "Hino" }),
        ],
        remarques: expect.stringContaining("ligne 3, Immatriculation : Véhicule déjà présent à la ligne 2 du fichier."),
      },
      rapprochements: [expect.objectContaining({ message: "2 véhicule(s) inconnu(s) de l'agence." })],
    });
    const carte = await lire(cookies.commercial, { document: "carte_grise", fichier });
    expect(carte.statusCode).toBe(422);
    expect(carte.json().code).toBe("lecture_illisible");
  });

  it("lit chaque pièce jointe à une demande du site, selon sa nature", async () => {
    const recue = await envoyer(ctx, {
      url: "/site/demandes-devis", origine: SITE, ip: "203.0.113.200",
      corps: {
        assurance: "flotte", profil: "entreprise", nom: "Visiteur Lecture", telephone: "0577001122",
        accordTraitement: "J'accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.",
        pieces: [
          { nature: "liste_vehicules", type: TYPE_CLASSEUR, contenu: classeurMinimal().toString("base64") },
          { nature: "attestation_precedente", type: "image/png", contenu: PNG.toString("base64") },
        ],
      },
    });
    expect(recue.statusCode).toBe(201);
    const { rows: pieces } = await ctx.base.query<{ id: string; nature: string }>(
      `SELECT p.id, p.nature FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
       WHERE d.numero = $1 ORDER BY p.rang`,
      [recue.json().numero],
    );
    const attestation = await lire(cookies.commercial, { document: "attestation_assurance", pieceDemandeSiteId: pieces[1]!.id });
    expect(attestation.statusCode).toBe(200);
    expect(attestation.json()).toMatchObject({
      champs: { assureur: "Compagnie Exemple Assurances", dateEcheance: "2026-12-31", garanties: expect.arrayContaining(["Vol"]), champsIncertains: ["numeroAttestation"] },
      controles: expect.arrayContaining([{ champ: "numeroAttestation", niveau: "attention", message: expect.stringContaining("Lecture douteuse") }]),
    });
    const liste = await lire(cookies.commercial, { document: "liste_vehicules", pieceDemandeSiteId: pieces[0]!.id });
    expect(liste.json()).toMatchObject({ prestataire: "classeur", champs: { vehicules: [expect.objectContaining({ immatriculation: "AB-123-CD" })] } });
    expect((await lire(cookies.commercial, { document: "auto", pieceDemandeSiteId: "00000000-0000-4000-8000-000000000000" })).statusCode).toBe(404);

    const { rows } = await ctx.base.query<{ objet: string }>(
      "SELECT objet FROM securite.evenements WHERE type = 'lecture_automatique' AND objet LIKE '%demande du site n° ' || $1",
      [recue.json().numero],
    );
    expect(rows.map((r) => r.objet).sort()).toEqual([
      `Attestation d'assurance, demande du site n° ${recue.json().numero}`, `Liste de véhicules, demande du site n° ${recue.json().numero}`,
    ]);
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
      expect((await envoyer(sansLecteur, { url: "/lecture-automatique", cookie })).json()).toEqual({ disponible: false, prestataire: null, documents: [] });
      const reponse = await envoyer(sansLecteur, { url: "/lecture-automatique", cookie, corps: { document: "carte_grise", fichier: photo } });
      expect(reponse.statusCode).toBe(503);
    } finally {
      await sansLecteur.fermer();
    }
  });
});
