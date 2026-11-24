// Demandes de devis du site (tâche 7) : route publique (origine, CORS, contrôles, limites, piège à robots,
// carte grise chiffrée), puis traitement au back-office rôle par rôle.

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executerMaintenance } from "../../src/modules/demandes-site/maintenance.js";
import { connecter, creerCompte, demarrer, envoyer, ORIGINE, type Contexte } from "./outils.js";

const SITE = "https://www.site.test.ci";
const CHEMIN = "/site/demandes-devis";
const ACCORD = "J'accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.";
const ACCORD_WHATSAPP = "J'accepte de recevoir sur WhatsApp les rappels de l'agence.";

// Plus petit PNG valide (1 × 1 pixel)
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const PDF_PIEGE = Buffer.from(`%PDF-1.4\n${EICAR}\n%%EOF\n`, "latin1");

let ctx: Contexte;
const cookies: Record<string, string> = {};
let suite = 0;

function telephoneUnique(): string {
  suite += 1;
  return `05${String((Date.now() + suite) % 100_000_000).padStart(8, "0")}`;
}

let adresse = 0;
/** Une adresse IP par test : la limite par adresse ne déborde pas d'un test sur l'autre */
function ipUnique(): string {
  adresse += 1;
  return `203.0.113.${adresse}`;
}

function demande(champs: Record<string, unknown> = {}) {
  return {
    assurance: "automobile", profil: "particulier", nom: "Visiteur Test", telephone: telephoneUnique(),
    accordTraitement: ACCORD, ...champs,
  };
}

function envoyerDemande(corps: object, options: { origine?: string | null; ip?: string } = {}) {
  return envoyer(ctx, { url: CHEMIN, corps, origine: options.origine === undefined ? SITE : options.origine, ip: options.ip ?? ipUnique() });
}

async function idDe(numero: number): Promise<string> {
  const { rows } = await ctx.base.query<{ id: string }>("SELECT id FROM app.demandes_site WHERE numero = $1", [numero]);
  return rows[0]!.id;
}

beforeAll(async () => {
  ctx = await demarrer({ env: { URL_SITE_VITRINE: SITE } });
  for (const role of ["gerant", "charge_clientele", "commercial", "caissier", "auditeur"] as const) {
    cookies[role] = await connecter(ctx, await creerCompte(ctx, role));
  }
});

afterAll(async () => {
  await ctx?.fermer();
});

describe("route publique du site", () => {
  it("n'existe pas tant que l'adresse du site n'est pas configurée", async () => {
    const sansSite = await demarrer();
    try {
      const reponse = await envoyer(sansSite, { url: CHEMIN, corps: demande(), origine: SITE });
      expect([403, 404]).toContain(reponse.statusCode);
    } finally {
      await sansSite.fermer();
    }
  });

  it("n'accepte que l'origine du site, y compris pour la requête préalable du navigateur", async () => {
    expect((await envoyerDemande(demande(), { origine: null })).statusCode).toBe(403);
    expect((await envoyerDemande(demande(), { origine: ORIGINE })).statusCode).toBe(403);
    expect((await envoyerDemande(demande(), { origine: "https://imitation.exemple" })).statusCode).toBe(403);

    const prealable = await ctx.app.inject({ method: "OPTIONS", url: CHEMIN, headers: { origin: SITE } });
    expect(prealable.statusCode).toBe(204);
    expect(prealable.headers["access-control-allow-origin"]).toBe(SITE);
    expect(prealable.headers["access-control-allow-methods"]).toBe("POST");
    expect(prealable.headers["access-control-allow-headers"]).toBe("Content-Type");
    const autre = await ctx.app.inject({ method: "OPTIONS", url: CHEMIN, headers: { origin: "https://imitation.exemple" } });
    expect(autre.statusCode).toBe(403);
    expect(autre.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("enregistre la demande et sa carte grise chiffrée, sans garder l'adresse IP", async () => {
    const telephone = telephoneUnique();
    const reponse = await envoyerDemande(demande({
      telephone, email: " Visiteur@Exemple.CI ", commune: "Yopougon", besoin: "Toyota Corolla 2019",
      accordWhatsApp: ACCORD_WHATSAPP, piece: { type: "image/png", contenu: PNG.toString("base64") },
    }), { ip: "203.0.113.200" });
    expect(reponse.statusCode).toBe(201);
    expect(reponse.headers["access-control-allow-origin"]).toBe(SITE);
    expect(reponse.json().numero).toBeGreaterThan(0);

    const { rows } = await ctx.base.query(
      `SELECT d.telephone, d.email, d.accord_whatsapp, d.empreinte_ip, p.taille, p.type_contenu, p.contenu_chiffre
       FROM app.demandes_site d JOIN app.pieces_demandes_site p ON p.demande_id = d.id WHERE d.numero = $1`,
      [reponse.json().numero],
    );
    const ligne = rows[0];
    expect(ligne.telephone).toBe(`+225${telephone}`);
    expect(ligne.email).toBe("visiteur@exemple.ci");
    expect(ligne.accord_whatsapp).toBe(ACCORD_WHATSAPP);
    expect(ligne.empreinte_ip).toHaveLength(32);
    expect(ligne.empreinte_ip.toString("latin1")).not.toContain("203.0.113.200");
    expect(ligne.taille).toBe(PNG.length);
    expect(ligne.type_contenu).toBe("image/png");
    expect(ligne.contenu_chiffre.includes(PNG.subarray(0, 8))).toBe(false);
  });

  it("refuse les données invalides, avec un message lisible par le site", async () => {
    const telephone = await envoyerDemande(demande({ telephone: "07 12 34 5" }));
    expect(telephone.statusCode).toBe(422);
    expect(telephone.json().code).toBe("telephone_invalide");
    expect(telephone.headers["access-control-allow-origin"]).toBe(SITE);

    expect((await envoyerDemande(demande({ email: "visiteur@" }))).json().code).toBe("email_invalide");
    expect((await envoyerDemande(demande({ accordTraitement: undefined }))).statusCode).toBe(400);
    expect((await envoyerDemande(demande({ role: "gerant" }))).statusCode).toBe(400);
    expect((await envoyerDemande(demande({ assurance: "vie" }))).statusCode).toBe(400);
  });

  it("vérifie la carte grise d'après son contenu, pas d'après le type annoncé", async () => {
    const annonceeJpeg = await envoyerDemande(demande({ piece: { type: "image/jpeg", contenu: PNG.toString("base64") } }));
    expect(annonceeJpeg.statusCode).toBe(422);
    expect(annonceeJpeg.json().code).toBe("piece_invalide");

    const page = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    expect((await envoyerDemande(demande({ piece: { type: "application/pdf", contenu: page } }))).json().code).toBe("piece_invalide");
    expect((await envoyerDemande(demande({ piece: { type: "image/png", contenu: "pas du base64!" } }))).json().code).toBe("piece_invalide");

    const habitation = await envoyerDemande(demande({ assurance: "habitation", piece: { type: "image/png", contenu: PNG.toString("base64") } }));
    expect(habitation.json().code).toBe("piece_inattendue");
  });

  it("fait semblant d'accepter une demande de robot, sans l'enregistrer", async () => {
    const telephone = telephoneUnique();
    const reponse = await envoyerDemande(demande({ telephone, siteWeb: "https://spam.exemple" }));
    expect(reponse.statusCode).toBe(201);
    expect(reponse.json().numero).toBeNull();
    const { rowCount } = await ctx.base.query("SELECT 1 FROM app.demandes_site WHERE telephone = $1", [`+225${telephone}`]);
    expect(rowCount).toBe(0);
  });

  it("limite les envois depuis une même adresse, sans gêner les autres", async () => {
    const ip = "198.51.100.77";
    for (let i = 0; i < 5; i += 1) {
      expect((await envoyerDemande(demande({ assurance: "habitation" }), { ip })).statusCode).toBe(201);
    }
    const sixieme = await envoyerDemande(demande({ assurance: "habitation" }), { ip });
    expect(sixieme.statusCode).toBe(429);
    expect(sixieme.json().code).toBe("trop_de_demandes");
    expect((await envoyerDemande(demande({ assurance: "habitation" }), { ip: "198.51.100.78" })).statusCode).toBe(201);
  });
});

describe("devis adapté à l'assurance : réponses et documents", () => {
  const XLSX = readFileSync(new URL("../fixtures/flotte-libreoffice.xlsx", import.meta.url));
  const TYPE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const PNG_2 = Buffer.concat([PNG, Buffer.from("seconde carte grise")]);
  const flotte = (champs: Record<string, unknown> = {}) => demande({
    assurance: "flotte", profil: "entreprise", nom: "Transports Test",
    details: { nombreVehicules: 12, typesVehicules: ["tracteurs", "remorques"], zones: ["abidjan", "international"], assureurActuel: "  Autre Assureur  " },
    pieces: [
      { nature: "liste_vehicules", type: TYPE_XLSX, contenu: XLSX.toString("base64") },
      { nature: "carte_grise", type: "image/png", contenu: PNG.toString("base64") },
      { nature: "carte_grise", type: "image/png", contenu: PNG_2.toString("base64") },
    ],
    ...champs,
  });

  it("une flotte : réponses, liste des véhicules en Excel et cartes grises, de la réception au devis", async () => {
    const recue = await envoyerDemande(flotte({ besoin: "Renouvellement en mars" }));
    expect(recue.statusCode).toBe(201);
    const numero = recue.json().numero as number;
    const id = await idDe(numero);

    const { rows: [enBase] } = await ctx.base.query("SELECT details FROM app.demandes_site WHERE id = $1", [id]);
    expect(enBase.details).toEqual({ nombreVehicules: 12, typesVehicules: ["tracteurs", "remorques"], zones: ["abidjan", "international"], assureurActuel: "Autre Assureur" });

    const liste = await envoyer(ctx, { url: "/demandes-site", cookie: cookies.commercial });
    const dansLaListe = liste.json().demandes.find((d: { id: string }) => d.id === id);
    expect(dansLaListe.naturesPieces).toEqual(["liste_vehicules", "carte_grise", "carte_grise"]);
    expect(dansLaListe.details[0]).toEqual({ libelle: "Nombre de véhicules", valeur: "12" });

    const vue = (await envoyer(ctx, { url: `/demandes-site/${id}`, cookie: cookies.commercial })).json();
    expect(vue.demande.details).toEqual([
      { libelle: "Nombre de véhicules", valeur: "12" },
      { libelle: "Types de véhicules", valeur: "Tracteurs routiers, Semi-remorques et remorques" },
      { libelle: "Zones de circulation", valeur: "Abidjan, Pays voisins (CEDEAO)" },
      { libelle: "Assureur actuel", valeur: "Autre Assureur" },
    ]);
    expect(vue.pieces.map((p: { rang: number; libelle: string; type: string; etatAnalyse: string }) => [p.rang, p.libelle, p.type, p.etatAnalyse])).toEqual([
      [1, "Liste des véhicules", TYPE_XLSX, "saine"], [2, "Carte grise", "image/png", "saine"], [3, "Carte grise", "image/png", "saine"],
    ]);
    expect(vue.piece.rang).toBe(2);

    // Chaque document se télécharge à part, intact, sous un nom qui dit ce qu'il est
    const tableur = await envoyer(ctx, { url: `/demandes-site/${id}/pieces/${vue.pieces[0].id}`, cookie: cookies.commercial });
    expect(tableur.headers["content-type"]).toBe(TYPE_XLSX);
    expect(tableur.headers["content-disposition"]).toBe(`attachment; filename="liste-des-vehicules-demande-${numero}.xlsx"`);
    expect(tableur.rawPayload.equals(XLSX)).toBe(true);
    const seconde = await envoyer(ctx, { url: `/demandes-site/${id}/pieces/${vue.pieces[2].id}`, cookie: cookies.commercial });
    expect(seconde.headers["content-disposition"]).toBe(`attachment; filename="carte-grise-demande-${numero}-3.png"`);
    expect(seconde.rawPayload.equals(PNG_2)).toBe(true);
    expect((await envoyer(ctx, { url: `/demandes-site/${id}/pieces/${vue.pieces[0].id}`, cookie: cookies.auditeur })).statusCode).toBe(403);
    // Un document d'une autre demande n'est pas servi par celle-ci
    const autre = await idDe((await envoyerDemande(demande({ piece: { type: "image/png", contenu: PNG.toString("base64") } }))).json().numero);
    expect((await envoyer(ctx, { url: `/demandes-site/${autre}/pieces/${vue.pieces[0].id}`, cookie: cookies.commercial })).statusCode).toBe(404);
    const { rows: [journal] } = await ctx.base.query(
      "SELECT count(*)::int AS n FROM securite.evenements WHERE type = 'piece_telechargee' AND objet = $1",
      [`Liste des véhicules, demande du site n° ${numero}`],
    );
    expect(journal.n).toBe(1);

    // Le devis créé reprend les réponses
    const conversion = await envoyer(ctx, { url: `/demandes-site/${id}/conversion`, cookie: cookies.commercial, corps: { confirmerNouveauClient: true } });
    expect(conversion.statusCode).toBe(201);
    const { rows: [devis] } = await ctx.base.query("SELECT branche, description FROM app.devis WHERE id = $1", [conversion.json().devisId]);
    expect(devis.branche).toBe("flotte");
    expect(devis.description).toBe("Nombre de véhicules : 12.\nTypes de véhicules : Tracteurs routiers, Semi-remorques et remorques.\n"
      + "Zones de circulation : Abidjan, Pays voisins (CEDEAO).\nAssureur actuel : Autre Assureur.\nRenouvellement en mars");
  });

  it("un chantier : produits recherchés, questions de l'entreprise pour une responsabilité civile, questionnaire et rapport de sol", async () => {
    const recue = await envoyerDemande(demande({
      assurance: "chantier_construction", profil: "entreprise", nom: "BTP Test",
      details: {
        produits: ["trc_batiment", "rc_travaux"], natureTravaux: "Immeuble R+4", typeOuvrage: "logements", dateDebut: "2027-02-01",
        bureauControle: "oui", chiffreAffaires: 900_000_000, travauxRisque: ["soudure"], assureurActuel: "Autre Assureur",
      },
      pieces: [
        { nature: "questionnaire_compagnie", type: "application/pdf", contenu: Buffer.from("%PDF-1.4\nquestionnaire\n%%EOF\n").toString("base64") },
        { nature: "rapport_sol_controle", type: "image/png", contenu: PNG.toString("base64") },
      ],
    }));
    expect(recue.statusCode).toBe(201);
    const id = await idDe(recue.json().numero as number);
    const vue = (await envoyer(ctx, { url: `/demandes-site/${id}`, cookie: cookies.commercial })).json();
    expect(vue.demande.details).toEqual([
      { libelle: "Assurance recherchée", valeur: "Tous risques chantier : bâtiment, Responsabilité civile de l'entreprise de travaux" },
      { libelle: "Nature des travaux", valeur: "Immeuble R+4" },
      { libelle: "Type d'ouvrage", valeur: "Logements (immeuble ou maisons)" },
      { libelle: "Date d'ouverture du chantier", valeur: "01/02/2027" },
      { libelle: "Bureau de contrôle désigné", valeur: "Oui" },
      { libelle: "Chiffre d'affaires annuel de l'entreprise", valeur: "900 000 000 F CFA" },
      { libelle: "Travaux à risque", valeur: "Soudure ou travaux par point chaud" },
      { libelle: "Assureur actuel", valeur: "Autre Assureur" },
    ]);
    expect(vue.pieces.map((p: { libelle: string }) => p.libelle)).toEqual(["Questionnaire de la compagnie, rempli", "Rapport de sol ou du bureau de contrôle"]);
  });

  it("refuse une réponse inattendue, mal formée ou obligatoire oubliée, avec un message pour le visiteur", async () => {
    const reponses = async (details: Record<string, unknown>, assurance = "flotte") => {
      const reponse = await envoyerDemande(flotte({ assurance, details, pieces: undefined }));
      return [reponse.statusCode, reponse.json().code, reponse.json().message];
    };
    expect(await reponses({ nombreVehicules: 3, typesVehicules: ["taxis"], couleur: "rouge" })).toEqual([422, "details_invalides", expect.stringContaining("réponse inattendue")]);
    expect(await reponses({ nombreVehicules: 1, typesVehicules: ["taxis"] })).toEqual([422, "details_invalides", "« Nombre de véhicules » : indiquez un nombre entier entre 2 et 5000."]);
    expect(await reponses({ nombreVehicules: 3 })).toEqual([422, "details_invalides", "« Types de véhicules » : réponse obligatoire."]);
    expect(await reponses({ nombreVehicules: 3, typesVehicules: ["fusees"] })).toEqual([422, "details_invalides", "« Types de véhicules » : choix invalide."]);
    expect(await reponses({ nombreVehicules: 3 }, "habitation")).toEqual([422, "details_invalides", expect.stringContaining("réponse inattendue")]);
    expect((await envoyerDemande(flotte({ details: { nombreVehicules: { $gt: 1 } } }))).statusCode).toBe(400);
  });

  it("ne prend que les documents prévus pour l'assurance, et un classeur Excel seulement pour une liste", async () => {
    const code = async (pieces: object[], assurance = "flotte") => {
      const reponse = await envoyerDemande(flotte({ assurance, details: undefined, pieces }));
      return [reponse.statusCode, reponse.json().code, reponse.json().message];
    };
    const png = (nature: string) => ({ nature, type: "image/png", contenu: PNG.toString("base64") });
    expect(await code([png("carte_grise")], "habitation")).toEqual([422, "piece_inattendue", "« Carte grise » ne se joint pas à une demande pour cette assurance."]);
    expect(await code([{ nature: "carte_grise", type: TYPE_XLSX, contenu: XLSX.toString("base64") }]))
      .toEqual([422, "piece_invalide", "« Carte grise » doit être une photo (JPEG ou PNG) ou un PDF."]);
    expect(await code([{ nature: "liste_vehicules", type: TYPE_XLSX, contenu: PNG.toString("base64") }]))
      .toEqual([422, "piece_invalide", expect.stringContaining("n'est pas un classeur Excel lisible")]);
    const macro = Buffer.concat([XLSX, Buffer.from("xl/vbaProject.bin")]);
    expect((await code([{ nature: "liste_vehicules", type: TYPE_XLSX, contenu: macro.toString("base64") }]))[2]).toContain("macros");
    expect((await code(Array.from({ length: 7 }, () => png("carte_grise"))))[0]).toBe(400);
    // Cinq photos d'un peu plus de 4 Mo : plus de 20 Mo en tout
    const lourde = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(4 * 1024 * 1024 + 8 * 1024)]).toString("base64");
    expect(await code(Array.from({ length: 5 }, () => ({ nature: "carte_grise", type: "image/png", contenu: lourde }))))
      .toEqual([422, "pieces_trop_volumineuses", expect.stringContaining("20 Mo")]);
    // Infectée : toute la demande est refusée, rien n'est gardé
    const telephone = telephoneUnique();
    const infectee = await envoyerDemande(flotte({ telephone, pieces: [png("carte_grise"), { nature: "attestation_precedente", type: "application/pdf", contenu: PDF_PIEGE.toString("base64") }] }));
    expect(infectee.json().code).toBe("piece_infectee");
    const { rows } = await ctx.base.query("SELECT count(*)::int AS n FROM app.demandes_site WHERE telephone = $1", [`+225${telephone}`]);
    expect(rows[0].n).toBe(0);
  });
});

describe("traitement au back-office", () => {
  it("liste et détail : réservés à qui traite les demandes, pièce jointe exclue pour l'auditeur", async () => {
    const recue = await envoyerDemande(demande({ piece: { type: "image/png", contenu: PNG.toString("base64") } }));
    const id = await idDe(recue.json().numero);

    expect((await envoyer(ctx, { url: "/demandes-site", cookie: cookies.caissier })).statusCode).toBe(403);
    const liste = await envoyer(ctx, { url: "/demandes-site", cookie: cookies.auditeur });
    expect(liste.statusCode).toBe(200);
    expect(liste.json().nouvelles).toBeGreaterThan(0);
    expect(liste.json().demandes.some((d: { id: string }) => d.id === id)).toBe(true);

    const vueAuditeur = await envoyer(ctx, { url: `/demandes-site/${id}`, cookie: cookies.auditeur });
    expect(vueAuditeur.json().piece).toBeNull();
    expect((await envoyer(ctx, { url: `/demandes-site/${id}/piece`, cookie: cookies.auditeur })).statusCode).toBe(403);

    const vueCommercial = await envoyer(ctx, { url: `/demandes-site/${id}`, cookie: cookies.commercial });
    expect(vueCommercial.json().piece).toMatchObject({ type: "image/png", taille: PNG.length, etatAnalyse: "saine", signatureDetectee: null });
    expect(vueCommercial.json().demande).not.toHaveProperty("empreinteIp");
  });

  it("la carte grise se télécharge intacte, en pièce jointe, et chaque téléchargement est consigné", async () => {
    const recue = await envoyerDemande(demande({ piece: { type: "image/png", contenu: PNG.toString("base64") } }));
    const numero = recue.json().numero as number;
    const id = await idDe(numero);

    const fichier = await envoyer(ctx, { url: `/demandes-site/${id}/piece`, cookie: cookies.commercial });
    expect(fichier.statusCode).toBe(200);
    expect(fichier.headers["content-type"]).toBe("image/png");
    expect(fichier.headers["content-disposition"]).toBe(`attachment; filename="carte-grise-demande-${numero}.png"`);
    expect(fichier.headers["x-content-type-options"]).toBe("nosniff");
    expect(fichier.rawPayload.equals(PNG)).toBe(true);

    const { rows } = await ctx.base.query(
      "SELECT count(*)::int AS n FROM securite.evenements WHERE type = 'piece_telechargee' AND objet = $1",
      [`Carte grise, demande du site n° ${numero}`],
    );
    expect(rows[0].n).toBe(1);
  });

  it("conversion : nouveau client, devis « site » et accord WhatsApp avec sa preuve, une seule fois", async () => {
    const telephone = telephoneUnique();
    const recue = await envoyerDemande(demande({ telephone, profil: "professionnel", besoin: "Hilux de livraison", accordWhatsApp: ACCORD_WHATSAPP }));
    const numero = recue.json().numero as number;
    const id = await idDe(numero);

    expect((await envoyer(ctx, { url: `/demandes-site/${id}/conversion`, cookie: cookies.auditeur, corps: {} })).statusCode).toBe(403);
    const conversion = await envoyer(ctx, { url: `/demandes-site/${id}/conversion`, cookie: cookies.commercial, corps: {} });
    expect(conversion.statusCode).toBe(201);
    const { clientId, devisId, accordWhatsApp } = conversion.json();
    expect(accordWhatsApp).toBe(true);

    const fiche = await envoyer(ctx, { url: `/clients/${clientId}`, cookie: cookies.gerant });
    expect(fiche.json().client).toMatchObject({ type: "professionnel", nom: "Visiteur Test", telephone: `+225${telephone}` });
    expect(fiche.json().devis).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: devisId, origine: "site", branche: "automobile", description: "Hilux de livraison" }),
    ]));
    const { rows } = await ctx.base.query("SELECT accorde, preuve FROM app.consentements WHERE client_id = $1", [clientId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].accorde).toBe(true);
    expect(rows[0].preuve).toMatch(new RegExp(`^Case « rappels WhatsApp » cochée sur le site, demande n° ${numero} du \\d{2}/\\d{2}/\\d{4}$`));

    const encore = await envoyer(ctx, { url: `/demandes-site/${id}/conversion`, cookie: cookies.gerant, corps: {} });
    expect(encore.statusCode).toBe(409);
    expect(encore.json().code).toBe("deja_traitee");
  });

  it("même numéro qu'un client existant : rattachement à sa fiche plutôt qu'un doublon", async () => {
    const telephone = telephoneUnique();
    const existant = await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele, corps: { type: "particulier", nom: "Client Existant", telephone } });
    const clientId = existant.json().client.id as string;
    const id = await idDe((await envoyerDemande(demande({ telephone, assurance: "autre" }))).json().numero);

    const detail = await envoyer(ctx, { url: `/demandes-site/${id}`, cookie: cookies.charge_clientele });
    expect(detail.json().clientsMemeNumero).toEqual([{ id: clientId, nom: "Client Existant", type: "particulier" }]);

    const doublon = await envoyer(ctx, { url: `/demandes-site/${id}/conversion`, cookie: cookies.charge_clientele, corps: {} });
    expect(doublon.statusCode).toBe(409);
    expect(doublon.json().code).toBe("doublon_possible");

    const rattachee = await envoyer(ctx, {
      url: `/demandes-site/${id}/conversion`, cookie: cookies.charge_clientele, corps: { clientId, branche: "habitation" },
    });
    expect(rattachee.statusCode).toBe(201);
    expect(rattachee.json()).toMatchObject({ clientId, accordWhatsApp: false });
    const { rows } = await ctx.base.query("SELECT branche, origine FROM app.devis WHERE id = $1", [rattachee.json().devisId]);
    expect(rows[0]).toEqual({ branche: "habitation", origine: "site" });
  });

  it("classement sans suite avec un motif, qui clôt la demande", async () => {
    const id = await idDe((await envoyerDemande(demande())).json().numero);
    expect((await envoyer(ctx, { url: `/demandes-site/${id}/sans-suite`, cookie: cookies.gerant, corps: { motif: "" } })).statusCode).toBe(400);
    const classee = await envoyer(ctx, { url: `/demandes-site/${id}/sans-suite`, cookie: cookies.gerant, corps: { motif: "Numéro injoignable" } });
    expect(classee.statusCode).toBe(200);

    const liste = await envoyer(ctx, { url: "/demandes-site?statut=sans_suite", cookie: cookies.gerant });
    expect(liste.json().demandes.find((d: { id: string }) => d.id === id)).toMatchObject({ motif: "Numéro injoignable", statut: "sans_suite" });
    expect((await envoyer(ctx, { url: `/demandes-site/${id}/conversion`, cookie: cookies.gerant, corps: {} })).statusCode).toBe(409);
  });
});

describe("antivirus et durée de conservation", () => {
  async function pieceDe(numero: number) {
    const { rows } = await ctx.base.query(
      `SELECT p.etat_analyse, p.signature_detectee, p.contenu_chiffre IS NULL AS vide
       FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id WHERE d.numero = $1`,
      [numero],
    );
    return rows[0] as { etat_analyse: string; signature_detectee: string | null; vide: boolean } | undefined;
  }

  it("refuse dès la réception une carte grise infectée, sans rien enregistrer", async () => {
    const telephone = telephoneUnique();
    const reponse = await envoyerDemande(demande({ telephone, piece: { type: "application/pdf", contenu: PDF_PIEGE.toString("base64") } }));
    expect(reponse.statusCode).toBe(422);
    expect(reponse.json().code).toBe("piece_infectee");
    const { rowCount } = await ctx.base.query("SELECT 1 FROM app.demandes_site WHERE telephone = $1", [`+225${telephone}`]);
    expect(rowCount).toBe(0);
  });

  it("une carte grise saine est notée comme analysée dès la réception", async () => {
    const numero = (await envoyerDemande(demande({ piece: { type: "image/png", contenu: PNG.toString("base64") } }))).json().numero;
    expect(await pieceDe(numero)).toMatchObject({ etat_analyse: "saine", vide: false });
  });

  it("antivirus en panne : la demande est reçue, la pièce attend son analyse et ne sort pas avant", async () => {
    ctx.antivirus.disponible = false;
    try {
      const numero = (await envoyerDemande(demande({ piece: { type: "image/png", contenu: PNG.toString("base64") } }))).json().numero;
      expect(numero).toBeGreaterThan(0);
      expect(await pieceDe(numero)).toMatchObject({ etat_analyse: "a_analyser" });
      const id = await idDe(numero);

      const bloquee = await envoyer(ctx, { url: `/demandes-site/${id}/piece`, cookie: cookies.commercial });
      expect(bloquee.statusCode).toBe(503);
      expect(bloquee.json().code).toBe("analyse_en_attente");

      // La maintenance réessaie quand l'antivirus revient
      expect((await executerMaintenance(ctx.pool, ctx.antivirus, ctx.cleChiffrement)).enAttente).toBeGreaterThan(0);
      ctx.antivirus.disponible = true;
      const bilan = await executerMaintenance(ctx.pool, ctx.antivirus, ctx.cleChiffrement);
      expect(bilan.analysees).toBeGreaterThan(0);
      expect(await pieceDe(numero)).toMatchObject({ etat_analyse: "saine" });
      expect((await envoyer(ctx, { url: `/demandes-site/${id}/piece`, cookie: cookies.commercial })).statusCode).toBe(200);
    } finally {
      ctx.antivirus.disponible = true;
    }
  });

  it("une pièce saine est analysée de nouveau à chaque téléchargement : infectée, elle est supprimée", async () => {
    const numero = (await envoyerDemande(demande({ piece: { type: "image/png", contenu: PNG.toString("base64") } }))).json().numero;
    const id = await idDe(numero);
    ctx.antivirus.toutEstInfecte = true;
    try {
      const reponse = await envoyer(ctx, { url: `/demandes-site/${id}/piece`, cookie: cookies.charge_clientele });
      expect(reponse.statusCode).toBe(409);
      expect(reponse.json().code).toBe("piece_infectee");
    } finally {
      ctx.antivirus.toutEstInfecte = false;
    }
    expect(await pieceDe(numero)).toEqual({ etat_analyse: "infectee", signature_detectee: "Eicar-Test-Signature", vide: true });
    const detail = await envoyer(ctx, { url: `/demandes-site/${id}`, cookie: cookies.charge_clientele });
    expect(detail.json().piece).toMatchObject({ etatAnalyse: "infectee", signatureDetectee: "Eicar-Test-Signature" });
    expect((await envoyer(ctx, { url: `/demandes-site/${id}/piece`, cookie: cookies.charge_clientele })).statusCode).toBe(409);
    const { rows } = await ctx.base.query(
      "SELECT count(*)::int AS n FROM securite.evenements WHERE type = 'piece_telechargee' AND objet = $1",
      [`Carte grise, demande du site n° ${numero}`],
    );
    expect(rows[0].n).toBe(0);
  });

  it("purge : une demande sans suite depuis plus de 12 mois disparaît avec sa carte grise, pas une demande convertie", async () => {
    const sansSuite = await idDe((await envoyerDemande(demande({ piece: { type: "image/png", contenu: PNG.toString("base64") } }))).json().numero);
    const convertie = await idDe((await envoyerDemande(demande())).json().numero);
    expect((await envoyer(ctx, { url: `/demandes-site/${sansSuite}/sans-suite`, cookie: cookies.gerant, corps: { motif: "Injoignable" } })).statusCode).toBe(200);
    expect((await envoyer(ctx, { url: `/demandes-site/${convertie}/conversion`, cookie: cookies.gerant, corps: {} })).statusCode).toBe(201);

    // On vieillit les deux demandes de 13 mois (sans passer par les gardiens de la base, réservé aux tests)
    const client = await ctx.base.connect();
    try {
      await client.query("SET session_replication_role = replica");
      await client.query(
        `UPDATE app.demandes_site SET recue_le = recue_le - interval '13 months', traitee_le = traitee_le - interval '13 months'
         WHERE id = ANY($1)`,
        [[sansSuite, convertie]],
      );
      await client.query("SET session_replication_role = origin");
    } finally {
      client.release();
    }

    const bilan = await executerMaintenance(ctx.pool, ctx.antivirus, ctx.cleChiffrement);
    expect(bilan.purgees).toBeGreaterThanOrEqual(1);
    const { rows } = await ctx.base.query("SELECT id FROM app.demandes_site WHERE id = ANY($1)", [[sansSuite, convertie]]);
    expect(rows.map((r) => r.id)).toEqual([convertie]);
    expect((await envoyer(ctx, { url: `/demandes-site/${sansSuite}`, cookie: cookies.gerant })).statusCode).toBe(404);
  });
});
