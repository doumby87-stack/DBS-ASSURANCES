// Outils du site (tâche 13) : rappel d'échéance, assistant « appel d'offres », demande de rendez-vous (routes
// publiques), puis leur traitement au back-office : demandes à traiter ou à venir, conversion, agenda.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connecter, creerCompte, demarrer, envoyer, type Compte, type Contexte } from "./outils.js";

const SITE = "https://www.site.test.ci";
const ACCORD = "J'accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.";

let ctx: Contexte;
const cookies: Record<string, string> = {};
const comptes: Record<string, Compte> = {};
let suite = 0;
let adresse = 0;

function telephoneUnique(): string {
  suite += 1;
  return `01${String((Date.now() + suite) % 100_000_000).padStart(8, "0")}`;
}
/** Une adresse IP par test : la limite par adresse ne déborde pas d'un test sur l'autre */
function ipUnique(): string {
  adresse += 1;
  return `192.0.2.${adresse}`;
}
/** Jour d'Abidjan (UTC toute l'année) dans n jours */
function jourDans(jours: number): string {
  return new Date(Date.now() + jours * 86_400_000).toISOString().slice(0, 10);
}
async function jourOuvreDans(jours: number): Promise<string> {
  const { rows } = await ctx.base.query<{ jour: string }>("SELECT app.ajouter_jours_ouvres(app.aujourdhui(), $1)::text AS jour", [jours]);
  return rows[0]!.jour;
}
async function dimancheProchain(): Promise<string> {
  const { rows } = await ctx.base.query<{ jour: string }>(
    "SELECT d::date::text AS jour FROM generate_series(app.aujourdhui() + 1, app.aujourdhui() + 7, interval '1 day') d WHERE extract(isodow FROM d) = 7",
  );
  return rows[0]!.jour;
}

function poster(url: string, corps: object, options: { origine?: string; ip?: string } = {}) {
  return envoyer(ctx, { url, corps, origine: options.origine ?? SITE, ip: options.ip ?? ipUnique() });
}

const rappel = (champs: Record<string, unknown> = {}) => ({
  assurance: "automobile", profil: "particulier", nom: "Visiteuse Rappel", telephone: telephoneUnique(),
  echeance: jourDans(100), accordTraitement: ACCORD, ...champs,
});
const appelOffres = (champs: Record<string, unknown> = {}) => ({
  profil: "entreprise", nom: "BTP Test SARL", telephone: telephoneUnique(), dateLimite: jourDans(25),
  marche: { typeMarche: "travaux", maitreOuvrage: "Mairie de Test", objet: "Réfection d'une école", montant: 150_000_000, dureeMois: 8 },
  garanties: ["rc_pro", "trc"], accordTraitement: ACCORD, ...champs,
});
const rendezVous = (jour: string, champs: Record<string, unknown> = {}) => ({
  motif: "devis", mode: "agence", profil: "particulier", nom: "Visiteur Rendez-vous", telephone: telephoneUnique(),
  jour, creneau: "matin", message: "Pour ma nouvelle voiture.", accordTraitement: ACCORD, ...champs,
});

beforeAll(async () => {
  ctx = await demarrer({ env: { URL_SITE_VITRINE: SITE } });
  for (const role of ["gerant", "charge_clientele", "commercial", "caissier", "auditeur"] as const) {
    comptes[role] = await creerCompte(ctx, role);
    cookies[role] = await connecter(ctx, comptes[role]);
  }
});

afterAll(async () => {
  await ctx?.fermer();
});

describe("routes publiques des outils du site", () => {
  it("n'acceptent que l'origine du site, avec les en-têtes CORS", async () => {
    const prealable = await ctx.app.inject({ method: "OPTIONS", url: "/site/rendez-vous", headers: { origin: SITE } });
    expect(prealable.statusCode).toBe(204);
    expect(prealable.headers["access-control-allow-origin"]).toBe(SITE);
    expect((await poster("/site/rappels-echeance", rappel(), { origine: "https://pirate.test" })).statusCode).toBe(403);
    const reponse = await poster("/site/rappels-echeance", rappel());
    expect(reponse.statusCode).toBe(201);
    expect(reponse.headers["access-control-allow-origin"]).toBe(SITE);
  });

  it("rappel d'échéance : à traiter un mois avant, dates contrôlées par la base, piège à robots", async () => {
    const telephone = telephoneUnique();
    const reponse = await poster("/site/rappels-echeance", rappel({ telephone, email: " Awa@Exemple.CI " }));
    expect(reponse.statusCode).toBe(201);
    expect(reponse.json()).toEqual({ numero: expect.any(Number), aTraiterLe: jourDans(70) });

    const passee = await poster("/site/rappels-echeance", rappel({ echeance: jourDans(-1) }));
    expect(passee.statusCode).toBe(422);
    expect(passee.json().message).toContain("13 prochains mois");
    expect((await poster("/site/rappels-echeance", rappel({ echeance: "15/12/2026" }))).statusCode).toBe(400);
    expect((await poster("/site/rappels-echeance", rappel({ telephone: "12" }))).statusCode).toBe(400);

    const robot = await poster("/site/rappels-echeance", rappel({ telephone: "0700000099", siteWeb: "http://spam.test" }));
    expect(robot.statusCode).toBe(201);
    expect(robot.json().numero).toBeNull();
    const { rows } = await ctx.base.query("SELECT 1 FROM app.demandes_site WHERE telephone = '+2250700000099'");
    expect(rows).toHaveLength(0);
  });

  it("appel d'offres : professionnels seulement, branche déduite des garanties, marché gardé tel quel", async () => {
    expect((await poster("/site/appels-offres", appelOffres({ profil: "particulier" }))).statusCode).toBe(400);
    expect((await poster("/site/appels-offres", appelOffres({ garanties: [] }))).statusCode).toBe(400);
    expect((await poster("/site/appels-offres", appelOffres({ garanties: ["trc", "inconnue"] }))).statusCode).toBe(400);
    const tardive = await poster("/site/appels-offres", appelOffres({ dateLimite: jourDans(-2) }));
    expect(tardive.statusCode).toBe(422);
    expect(tardive.json().message).toContain("date limite");

    const reponse = await poster("/site/appels-offres", appelOffres({ commune: "Bouaké" }));
    expect(reponse.statusCode).toBe(201);
    const { rows } = await ctx.base.query(
      "SELECT nature, branche, appel_offres, date_limite_offre::text AS limite FROM app.demandes_site WHERE numero = $1",
      [reponse.json().numero],
    );
    expect(rows[0]).toMatchObject({ nature: "appel_offres", branche: "chantier_construction", limite: jourDans(25) });
    expect(rows[0].appel_offres).toEqual({
      typeMarche: "travaux", maitreOuvrage: "Mairie de Test", objet: "Réfection d'une école", montant: 150_000_000, dureeMois: 8,
      garanties: ["trc", "rc_pro"],
    });
  });

  it("rendez-vous : un jour ouvré, de demain à deux mois ; visite sur place pour les professionnels", async () => {
    const reponse = await poster("/site/rendez-vous", rendezVous(await jourOuvreDans(2)));
    expect(reponse.statusCode).toBe(201);
    expect(reponse.json().numero).toEqual(expect.any(Number));

    const dimanche = await poster("/site/rendez-vous", rendezVous(await dimancheProchain()));
    expect(dimanche.statusCode).toBe(422);
    expect(dimanche.json().message).toContain("du lundi au vendredi");
    const visite = await poster("/site/rendez-vous", rendezVous(await jourOuvreDans(3), { mode: "chez_le_client" }));
    expect(visite.statusCode).toBe(422);
    expect(visite.json().message).toContain("professionnels");
    const entreprise = await poster("/site/rendez-vous", rendezVous(await jourOuvreDans(3), { mode: "chez_le_client", profil: "entreprise", motif: "flotte" }));
    expect(entreprise.statusCode).toBe(201);
  });

  it("partagent les limites des demandes de devis : 5 envois par heure depuis une même adresse", async () => {
    const ip = ipUnique();
    const jour = await jourOuvreDans(4);
    for (const [url, corps] of [
      ["/site/rappels-echeance", rappel()], ["/site/appels-offres", appelOffres()], ["/site/rendez-vous", rendezVous(jour)],
      ["/site/rappels-echeance", rappel()], ["/site/rendez-vous", rendezVous(jour)],
    ] as const) {
      expect((await poster(url, corps, { ip })).statusCode).toBe(201);
    }
    const sixieme = await envoyer(ctx, {
      url: "/site/demandes-devis", origine: SITE, ip,
      corps: { assurance: "automobile", profil: "particulier", nom: "Visiteur", telephone: telephoneUnique(), accordTraitement: ACCORD },
    });
    expect(sixieme.statusCode).toBe(429);
  });
});

describe("au back-office", () => {
  it("un rappel attend son heure ; un appel d'offres se traite tout de suite et se convertit avec son marché", async () => {
    const lointain = (await poster("/site/rappels-echeance", rappel({ nom: "Rappel Lointain" }))).json().numero as number;
    const proche = (await poster("/site/rappels-echeance", rappel({ nom: "Rappel Proche", echeance: jourDans(12) }))).json().numero as number;
    const marche = (await poster("/site/appels-offres", appelOffres({ nom: "Entreprise Marché", besoin: "Le cahier des charges est prêt." })))
      .json().numero as number;

    const aTraiter = (await envoyer(ctx, { url: "/demandes-site", cookie: cookies.commercial })).json();
    const numeros = aTraiter.demandes.map((d: { numero: number }) => d.numero);
    expect(numeros).toEqual(expect.arrayContaining([proche, marche]));
    expect(numeros).not.toContain(lointain);
    expect(aTraiter.aVenir).toBeGreaterThanOrEqual(1);
    // Les appels d'offres passent devant, date limite la plus proche d'abord
    expect(aTraiter.demandes[0].nature).toBe("appel_offres");

    const aVenir = (await envoyer(ctx, { url: "/demandes-site?statut=a_venir", cookie: cookies.commercial })).json();
    const rappelAVenir = aVenir.demandes.find((d: { numero: number }) => d.numero === lointain);
    expect(rappelAVenir).toMatchObject({ nature: "rappel_echeance", echeanceActuelle: jourDans(100), aTraiterLe: jourDans(70) });

    const demande = aTraiter.demandes.find((d: { numero: number }) => d.numero === marche);
    expect(demande).toMatchObject({ dateLimiteOffre: jourDans(25), appelOffres: { maitreOuvrage: "Mairie de Test" } });
    const conversion = await envoyer(ctx, { url: `/demandes-site/${demande.id}/conversion`, cookie: cookies.charge_clientele, corps: {} });
    expect(conversion.statusCode).toBe(201);
    const { rows } = await ctx.base.query("SELECT branche, description FROM app.devis WHERE id = $1", [conversion.json().devisId]);
    expect(rows[0].branche).toBe("chantier_construction");
    expect(rows[0].description).toContain("Appel d'offres (Travaux) de Mairie de Test : Réfection d'une école.");
    expect(rows[0].description).toContain("Montant estimé : 150 000 000 F CFA ; durée : 8 mois.");
    expect(rows[0].description).toContain("Garanties demandées : Tous risques chantier, Responsabilité civile professionnelle ou d'exploitation.");
    expect(rows[0].description).toContain("Le cahier des charges est prêt.");

    const procheId = aTraiter.demandes.find((d: { numero: number }) => d.numero === proche).id;
    const conversionRappel = await envoyer(ctx, { url: `/demandes-site/${procheId}/conversion`, cookie: cookies.commercial, corps: {} });
    const devisRappel = await ctx.base.query("SELECT description FROM app.devis WHERE id = $1", [conversionRappel.json().devisId]);
    const [annee, mois, jour] = jourDans(12).split("-");
    expect(devisRappel.rows[0].description).toBe(`Rappel d'échéance demandé sur le site : contrat actuel à échéance le ${jour}/${mois}/${annee}.`);
  });

  it("agenda : confirmer une demande du site, refuser un chevauchement, annuler, noter qu'il a eu lieu", async () => {
    const jour = await jourOuvreDans(5);
    const numero = (await poster("/site/rendez-vous", rendezVous(jour, { nom: "Visiteuse Agenda" }))).json().numero as number;

    expect((await envoyer(ctx, { url: "/rendez-vous", cookie: cookies.caissier })).statusCode).toBe(403);
    const agenda = (await envoyer(ctx, { url: "/rendez-vous", cookie: cookies.commercial })).json();
    const demande = agenda.demandes.find((r: { numero: number }) => r.numero === numero);
    expect(demande).toMatchObject({ statut: "demande", souhaiteLe: jour, creneauSouhaite: "matin", origine: "site" });
    expect(agenda.personnes.map((p: { id: string }) => p.id)).toEqual(
      expect.arrayContaining([comptes.charge_clientele!.id, comptes.commercial!.id]),
    );
    expect(agenda.personnes.map((p: { id: string }) => p.id)).not.toContain(comptes.auditeur!.id);

    const url = `/rendez-vous/${demande.id}/traitement`;
    const incomplet = await envoyer(ctx, { url, cookie: cookies.commercial, corps: { action: "confirmer", jour } });
    expect(incomplet.statusCode).toBe(422);
    const avec = comptes.charge_clientele!.id;
    const confirme = await envoyer(ctx, { url, cookie: cookies.commercial, corps: { action: "confirmer", jour, heure: "09:00", dureeMinutes: 30, avec } });
    expect(confirme.statusCode).toBe(200);
    expect(confirme.json()).toEqual({ statut: "confirme" });
    const aVenir = (await envoyer(ctx, { url: "/rendez-vous", cookie: cookies.auditeur })).json().aVenir;
    expect(aVenir.find((r: { numero: number }) => r.numero === numero)).toMatchObject({
      debut: `${jour}T09:00:00.000Z`, dureeMinutes: 30, avec, nomAvec: "Test charge_clientele",
    });

    const fixe = { motif: "renouvellement", mode: "telephone", nom: "Client Téléphone", telephone: "07 11 22 33 44", jour, dureeMinutes: 30, avec };
    const chevauchement = await envoyer(ctx, { url: "/rendez-vous", cookie: cookies.charge_clientele, corps: { ...fixe, heure: "09:15" } });
    expect(chevauchement.statusCode).toBe(422);
    expect(chevauchement.json().message).toBe("Test charge_clientele a déjà un rendez-vous à cette heure-là.");
    const soir = await envoyer(ctx, { url: "/rendez-vous", cookie: cookies.charge_clientele, corps: { ...fixe, heure: "19:45" } });
    expect(soir.statusCode).toBe(422);
    expect(soir.json().message).toContain("entre 7 h et 20 h");
    expect((await envoyer(ctx, { url: "/rendez-vous", cookie: cookies.auditeur, corps: { ...fixe, heure: "10:00" } })).statusCode).toBe(403);
    const cree = await envoyer(ctx, { url: "/rendez-vous", cookie: cookies.charge_clientele, corps: { ...fixe, heure: "10:00" } });
    expect(cree.statusCode).toBe(201);

    const tropTot = await envoyer(ctx, { url: `/rendez-vous/${cree.json().id}/traitement`, cookie: cookies.gerant, corps: { action: "honore" } });
    expect(tropTot.statusCode).toBe(422);
    const annule = await envoyer(ctx, {
      url: `/rendez-vous/${cree.json().id}/traitement`, cookie: cookies.gerant, corps: { action: "annuler", motifAnnulation: "Renouvelé par téléphone" },
    });
    expect(annule.json()).toEqual({ statut: "annule" });
    const recents = (await envoyer(ctx, { url: "/rendez-vous", cookie: cookies.gerant })).json().recents;
    expect(recents.find((r: { id: string }) => r.id === cree.json().id)).toMatchObject({ statut: "annule", motifAnnulation: "Renouvelé par téléphone" });
    const introuvable = await envoyer(ctx, {
      url: "/rendez-vous/00000000-0000-4000-8000-000000000000/traitement", cookie: cookies.gerant, corps: { action: "annuler", motifAnnulation: "Essai" },
    });
    expect(introuvable.statusCode).toBe(404);
  });
});
