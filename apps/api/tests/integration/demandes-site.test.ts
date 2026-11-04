// Demandes de devis du site (tâche 7) : route publique (origine, CORS, contrôles, limites, piège à robots,
// carte grise chiffrée), puis traitement au back-office rôle par rôle.

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
