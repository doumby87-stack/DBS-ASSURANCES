// Conformité et pilotage (tâche 12) : fiche d'identification (numéro chiffré, affichage consigné, justificatifs,
// vérification), blocage d'un client à risque élevé, alertes réservées au gérant, formations, registre des
// réclamations (agence et espace client), factures FNE dans le rapprochement des commissions, statistiques.

import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EnvoiCodes } from "../../src/modules/portail/connexion.js";
import { connecter, creerCompte, demarrer, envoyer, type Compte, type Contexte } from "./outils.js";

const ORIGINE_PORTAIL = "https://espace.test.ci";
const NOM_COOKIE_PORTAIL = "__Host-dbs_portail";

let ctx: Contexte;
const cookies: Record<string, string> = {};
const comptes: Record<string, Compte> = {};
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

async function nouveauClient(type: "particulier" | "entreprise", nom: string) {
  const telephone = `+22507${unique()}`;
  const reponse = await envoyer(ctx, { url: "/clients", cookie: cookies.charge_clientele, corps: { type, nom, telephone } });
  expect(reponse.statusCode).toBe(201);
  return { id: reponse.json().client.id as string, telephone };
}

async function nouveauContrat(clientId: string, primeTtc = 100_000) {
  return envoyer(ctx, {
    url: "/contrats", cookie: cookies.charge_clientele,
    corps: { clientId, branche: "automobile", numeroPolice: `AUTO-${unique()}`, dateEffet: aujourdHuiPlus(-3), dateEcheance: aujourdHuiPlus(362), primeTtc },
  });
}

function portail(chemin: string, options: { cookie?: string; corps?: object } = {}) {
  return envoyer(ctx, {
    ip: `198.51.100.${(suite % 250) + 1}`, url: chemin, origine: ORIGINE_PORTAIL,
    ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.corps ? { corps: options.corps } : {}),
  });
}

function cookiePortail(reponse: LightMyRequestResponse): string {
  const cookie = reponse.cookies.find((c) => c.name === NOM_COOKIE_PORTAIL);
  return `${NOM_COOKIE_PORTAIL}=${cookie!.value}`;
}

beforeAll(async () => {
  ctx = await demarrer({ env: { URL_PORTAIL: ORIGINE_PORTAIL }, envoiCodes });
  for (const role of ["gerant", "charge_clientele", "commercial", "caissier", "auditeur"] as const) {
    comptes[role] = await creerCompte(ctx, role);
    cookies[role] = await connecter(ctx, comptes[role]);
  }
});

afterAll(async () => {
  await ctx?.fermer();
});

describe("fiche d'identification", () => {
  it("numéro chiffré, affiché en entier sur demande et consigné ; justificatif ; vérification de l'original", async () => {
    const fanta = await nouveauClient("particulier", "Diallo Fanta Conformité");
    const vide = await envoyer(ctx, { url: `/clients/${fanta.id}/identification`, cookie: cookies.commercial });
    expect(vide.json()).toMatchObject({ etat: { statut: "absente" }, fiche: null });

    const fiche = {
      niveauRisque: "normal", personnePolitiquementExposee: false, typePiece: "cni", numeroPiece: "ci 0123-4567",
      pieceExpireLe: aujourdHuiPlus(900), dateNaissance: "1988-03-14", nationalite: "Ivoirienne", activite: "Commerçante",
      adresse: "Cocody, Riviera 2",
    };
    expect((await envoyer(ctx, { methode: "PUT", url: `/clients/${fanta.id}/identification`, cookie: cookies.commercial, corps: fiche })).statusCode).toBe(403);
    const enregistree = await envoyer(ctx, { methode: "PUT", url: `/clients/${fanta.id}/identification`, cookie: cookies.charge_clientele, corps: fiche });
    expect(enregistree.statusCode).toBe(200);
    expect(enregistree.json().etat).toMatchObject({ statut: "incomplete", manques: ["Copie de la pièce d'identité", "Original vu par l'agence"] });

    const copie = await envoyer(ctx, {
      url: `/clients/${fanta.id}/justificatifs`, cookie: cookies.charge_clientele,
      corps: { nature: "piece_identite", nom: "cni recto-verso.pdf", type: "application/pdf", fichier: pdf("CNI de Fanta").toString("base64") },
    });
    expect(copie.statusCode).toBe(201);
    const virus = await envoyer(ctx, {
      url: `/clients/${fanta.id}/justificatifs`, cookie: cookies.charge_clientele,
      corps: { nature: "autre", nom: "virus.pdf", type: "application/pdf", fichier: pdf("EICAR-STANDARD-ANTIVIRUS-TEST-FILE").toString("base64") },
    });
    expect(virus.statusCode).toBe(422);
    const verification = await envoyer(ctx, { url: `/clients/${fanta.id}/identification/verification`, cookie: cookies.charge_clientele, corps: {} });
    const dansDeuxAns = `${new Date().getUTCFullYear() + 2}${new Date().toISOString().slice(4, 10)}`;
    expect(verification.json().etat).toMatchObject({ statut: "complete", manques: [], prochaineRevue: dansDeuxAns });

    // Le chargé lit la fiche : le numéro n'y figure pas, seulement ses 4 derniers caractères
    const lue = await envoyer(ctx, { url: `/clients/${fanta.id}/identification`, cookie: cookies.charge_clientele });
    expect(lue.json().fiche).toMatchObject({ typePiece: "cni", numeroPieceFin: "4567", verifieePar: "Test charge_clientele" });
    expect(JSON.stringify(lue.json())).not.toContain("01234567");
    const { rows: [stocke] } = await ctx.base.query<{ chiffre: Buffer }>(
      "SELECT numero_piece_chiffre AS chiffre FROM app.identifications_clients WHERE client_id = $1", [fanta.id]);
    expect(stocke!.chiffre.includes(Buffer.from("CI01234567"))).toBe(false);

    const numero = await envoyer(ctx, { url: `/clients/${fanta.id}/identification/numero`, cookie: cookies.charge_clientele, corps: {} });
    expect(numero.json()).toEqual({ numero: "CI01234567" });
    const { rows: evenements } = await ctx.base.query(
      "SELECT 1 FROM securite.evenements WHERE type = 'donnee_sensible_consultee' AND objet = $1", ["N° de pièce de Diallo Fanta Conformité"]);
    expect(evenements).toHaveLength(1);
    expect((await envoyer(ctx, { url: `/clients/${fanta.id}/identification/numero`, cookie: cookies.auditeur, corps: {} })).statusCode).toBe(403);

    // Les autres rôles : l'état seulement
    const parCommercial = await envoyer(ctx, { url: `/clients/${fanta.id}/identification`, cookie: cookies.commercial });
    expect(parCommercial.json()).toMatchObject({ etat: { statut: "complete" }, fiche: null, dirigeants: [], justificatifs: [] });

    const justificatifId = lue.json().justificatifs[0].id as string;
    const telecharge = await envoyer(ctx, { url: `/clients/${fanta.id}/justificatifs/${justificatifId}`, cookie: cookies.charge_clientele });
    expect(telecharge.statusCode).toBe(200);
    expect(telecharge.rawPayload.equals(pdf("CNI de Fanta"))).toBe(true);
    expect(telecharge.headers["content-disposition"]).toBe('attachment; filename="cni-recto-verso.pdf"');

    // Droit d'accès : toutes ses données en un fichier, sans aucun contenu chiffré ; export consigné, gérant seulement
    const exportDonnees = await envoyer(ctx, { url: `/clients/${fanta.id}/donnees.json`, cookie: cookies.gerant });
    expect(exportDonnees.statusCode).toBe(200);
    expect(exportDonnees.headers["content-disposition"]).toBe('attachment; filename="donnees-diallo-fanta-conformite.json"');
    const donnees = exportDonnees.json();
    expect(donnees.client).toMatchObject({ nom: "Diallo Fanta Conformité", telephone: fanta.telephone });
    expect(donnees.identification[0]).toMatchObject({ numero_piece_fin: "4567", nationalite: "Ivoirienne" });
    expect(donnees.identification[0]).not.toHaveProperty("numero_piece_chiffre");
    expect(donnees.justificatifs[0]).toMatchObject({ nom_fichier: "cni recto-verso.pdf" });
    expect(donnees.justificatifs[0]).not.toHaveProperty("contenu_chiffre");
    expect((await ctx.base.query("SELECT 1 FROM securite.evenements WHERE type = 'export_donnees' AND objet = $1",
      ["Données personnelles de Diallo Fanta Conformité"])).rowCount).toBe(1);
    expect((await envoyer(ctx, { url: `/clients/${fanta.id}/donnees.json`, cookie: cookies.charge_clientele })).statusCode).toBe(403);

    // Changer la date de naissance fait tomber la vérification ; le numéro, omis, est conservé
    const modifiee = await envoyer(ctx, { methode: "PUT", url: `/clients/${fanta.id}/identification`, cookie: cookies.charge_clientele,
      corps: { ...fiche, numeroPiece: undefined, dateNaissance: "1988-03-15" } });
    expect(modifiee.json().etat).toMatchObject({ statut: "incomplete", manques: ["Original vu par l'agence"] });
    expect((await envoyer(ctx, { url: `/clients/${fanta.id}/identification/numero`, cookie: cookies.gerant, corps: {} })).json().numero).toBe("CI01234567");
  });

  it("entreprise à risque élevé : dirigeants et bénéficiaires exigés, souscription bloquée tant que la fiche est incomplète", async () => {
    const epsilon = await nouveauClient("entreprise", "Transports Epsilon Conformité");
    await envoyer(ctx, { methode: "PUT", url: `/clients/${epsilon.id}/identification`, cookie: cookies.charge_clientele,
      corps: { niveauRisque: "eleve", motifRisque: "Activité à forte circulation d'espèces", personnePolitiquementExposee: false,
        formeJuridique: "SARL", numeroContribuable: "1902345A", adresse: "Zone 4, Marcory" } });
    const refus = await nouveauContrat(epsilon.id);
    expect(refus.statusCode).toBe(422);
    expect(refus.json().message).toContain("risque élevé");

    const dirigeant = await envoyer(ctx, { url: `/clients/${epsilon.id}/dirigeants`, cookie: cookies.charge_clientele,
      corps: { nom: "Kouamé Epsilon", estDirigeant: true, estBeneficiaireEffectif: true, partCapital: 70 } });
    expect(dirigeant.statusCode).toBe(201);
    const etat = await envoyer(ctx, { url: `/clients/${epsilon.id}/identification`, cookie: cookies.charge_clientele });
    expect(etat.json().etat.manques).toEqual(["N° RCCM", "Copie du RCCM", "Origine des fonds (risque élevé)", "Original vu par l'agence"]);
    expect(etat.json().dirigeants).toEqual([expect.objectContaining({ nom: "Kouamé Epsilon", partCapital: 70 })]);

    const aCompleter = await envoyer(ctx, { url: "/identifications/a-completer", cookie: cookies.charge_clientele });
    expect(aCompleter.statusCode).toBe(200);
    expect((await envoyer(ctx, { url: "/identifications/a-completer", cookie: cookies.caissier })).statusCode).toBe(403);

    const retrait = await envoyer(ctx, { methode: "DELETE", url: `/clients/${epsilon.id}/dirigeants/${dirigeant.json().dirigeant.id}`, cookie: cookies.charge_clientele });
    expect(retrait.statusCode).toBe(204);
    expect((await envoyer(ctx, { methode: "DELETE", url: `/clients/${epsilon.id}/dirigeants/${dirigeant.json().dirigeant.id}`, cookie: cookies.charge_clientele })).statusCode).toBe(404);
  });
});

describe("alertes, réservées au gérant", () => {
  it("paiement par un tiers signalé, décision du gérant, liste des alertes à traiter", async () => {
    const bamba = await nouveauClient("particulier", "Bamba Alerte");
    const contratId = (await nouveauContrat(bamba.id, 300_000)).json().contrat.id as string;
    const paiement = await envoyer(ctx, { url: "/encaissements", cookie: cookies.caissier,
      corps: { contratId, montant: 100_000, mode: "virement", reference: `VIR-${unique()}`, payeurTiers: "Société Tierce SARL" } });
    expect(paiement.statusCode).toBe(201);

    expect((await envoyer(ctx, { url: "/alertes", cookie: cookies.charge_clientele })).statusCode).toBe(403);
    expect((await envoyer(ctx, { url: "/alertes", cookie: cookies.auditeur })).statusCode).toBe(403);
    const alertes = await envoyer(ctx, { url: "/alertes", cookie: cookies.gerant });
    const alerte = alertes.json().alertes.find((a: { contratId: string; type: string }) => a.contratId === contratId && a.type === "paiement_tiers");
    expect(alerte).toMatchObject({ client: "Bamba Alerte", montant: 100_000, decision: null });
    expect(alerte.detail).toContain("Société Tierce SARL");

    const traitement = await envoyer(ctx, { url: "/alertes/traitements", cookie: cookies.gerant,
      corps: { cle: alerte.cle, decision: "transmise_correspondant", motif: "Paiement par une société sans lien connu avec le client" } });
    expect(traitement.statusCode).toBe(201);
    expect((await envoyer(ctx, { url: "/alertes/traitements", cookie: cookies.gerant,
      corps: { cle: alerte.cle, decision: "sans_suite", motif: "Revirement" } })).statusCode).toBe(409);
    expect((await envoyer(ctx, { url: "/alertes/traitements", cookie: cookies.gerant,
      corps: { cle: `paiement_tiers:${contratId}`, decision: "sans_suite", motif: "Alerte inventée" } })).statusCode).toBe(404);
    const restantes = await envoyer(ctx, { url: "/alertes", cookie: cookies.gerant });
    expect(restantes.json().alertes.some((a: { cle: string }) => a.cle === alerte.cle)).toBe(false);
    const toutes = await envoyer(ctx, { url: "/alertes?toutes=oui", cookie: cookies.gerant });
    expect(toutes.json().alertes.find((a: { cle: string }) => a.cle === alerte.cle)).toMatchObject({ decision: "transmise_correspondant", traitePar: "Test gerant" });
  });
});

describe("formations du personnel", () => {
  it("enregistrées par le gérant ; chacun voit les siennes", async () => {
    const enregistrement = await envoyer(ctx, { url: "/formations", cookie: cookies.gerant,
      corps: { utilisateurIds: [comptes.caissier!.id, comptes.commercial!.id], theme: "lbc_ft", suivieLe: aujourdHuiPlus(-2), commentaire: "Rappel annuel" } });
    expect(enregistrement.statusCode).toBe(201);
    expect((await envoyer(ctx, { url: "/formations", cookie: cookies.caissier,
      corps: { utilisateurIds: [comptes.caissier!.id], theme: "hameconnage", suivieLe: aujourdHuiPlus(-1) } })).statusCode).toBe(403);
    const parCaissier = (await envoyer(ctx, { url: "/formations", cookie: cookies.caissier })).json();
    expect(new Set(parCaissier.etat.map((e: { utilisateurId: string }) => e.utilisateurId))).toEqual(new Set([comptes.caissier!.id]));
    expect(parCaissier.etat.find((e: { theme: string }) => e.theme === "lbc_ft")).toMatchObject({ aRefaire: false });
    expect(parCaissier.etat.find((e: { theme: string }) => e.theme === "hameconnage")).toMatchObject({ aRefaire: true, derniere: null });
    const parGerant = (await envoyer(ctx, { url: "/formations", cookie: cookies.gerant })).json();
    expect(parGerant.etat.some((e: { utilisateurId: string }) => e.utilisateurId === comptes.commercial!.id)).toBe(true);
  });
});

describe("registre des réclamations", () => {
  it("au guichet et dans l'espace client ; traitement étape par étape ; export consigné", async () => {
    const koffi = await nouveauClient("particulier", "Koffi Réclamant");
    const contratId = (await nouveauContrat(koffi.id)).json().contrat.id as string;

    const guichet = await envoyer(ctx, { url: "/reclamations", cookie: cookies.caissier,
      corps: { clientId: koffi.id, canal: "guichet", objet: "attestation", description: "Attestation toujours pas reçue.", contratId } });
    expect(guichet.statusCode).toBe(201);
    expect(guichet.json().reclamation.reference).toMatch(/^REC-\d{4}-\d{4}$/);
    const id = guichet.json().reclamation.id as string;
    expect((await envoyer(ctx, { url: "/reclamations", cookie: cookies.caissier,
      corps: { canal: "telephone", objet: "autre", description: "Sans nom ni client, impossible." } })).statusCode).toBe(422);
    expect((await envoyer(ctx, { url: `/reclamations/${id}/traitement`, cookie: cookies.caissier, corps: { action: "accuser" } })).statusCode).toBe(403);

    const accuse = await envoyer(ctx, { url: `/reclamations/${id}/traitement`, cookie: cookies.charge_clientele, corps: { action: "accuser" } });
    expect(accuse.json().reclamation).toMatchObject({ statut: "en_cours", accuseEnRetard: false, reponseEnRetard: false, numeroPolice: expect.any(String) });
    const prematuree = await envoyer(ctx, { url: `/reclamations/${id}/traitement`, cookie: cookies.charge_clientele, corps: { action: "clore" } });
    expect(prematuree.statusCode).toBe(422);
    const reponse = await envoyer(ctx, { url: `/reclamations/${id}/traitement`, cookie: cookies.charge_clientele,
      corps: { action: "repondre", reponse: "Attestation déposée dans votre espace client, avec nos excuses.", issue: "fondee" } });
    expect(reponse.json().reclamation).toMatchObject({ statut: "repondue", issue: "fondee" });

    // Le client la suit depuis son espace, et y dépose la sienne
    const avant = codesEnvoyes.length;
    expect((await portail("/portail/connexion/code", { corps: { telephone: koffi.telephone } })).statusCode).toBe(202);
    const code = codesEnvoyes.slice(avant).find((c) => c.telephone === koffi.telephone)!.code;
    const cookie = cookiePortail(await portail("/portail/connexion", { corps: { telephone: koffi.telephone, code } }));
    const enLigne = await portail("/portail/reclamations", { cookie, corps: { objet: "prime_paiement", description: "Mon paiement n'apparaît pas encore." } });
    expect(enLigne.statusCode).toBe(201);
    const suivies = (await portail("/portail/reclamations", { cookie })).json().reclamations;
    expect(suivies).toHaveLength(2);
    expect(suivies.find((r: { id: string }) => r.id === id)).toMatchObject({ statut: "repondue", reponse: expect.stringContaining("Attestation déposée") });
    expect(JSON.stringify(suivies)).not.toContain("Test caissier");

    // Le registre : le commercial ne voit pas celles des autres ; l'export est consigné
    const parCommercial = (await envoyer(ctx, { url: "/reclamations?toutes=oui", cookie: cookies.commercial })).json().reclamations;
    expect(parCommercial.some((r: { id: string }) => r.id === id)).toBe(false);
    const ouvertes = (await envoyer(ctx, { url: "/reclamations", cookie: cookies.gerant })).json().reclamations;
    expect(ouvertes.find((r: { reference: string }) => r.reference === enLigne.json().reclamation.reference)).toMatchObject({ canal: "espace_client", enregistrePar: "Koffi Réclamant" });
    const csv = await envoyer(ctx, { url: "/reclamations.csv", cookie: cookies.gerant });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain(guichet.json().reclamation.reference);
    expect((await envoyer(ctx, { url: "/reclamations.csv", cookie: cookies.charge_clientele })).statusCode).toBe(403);
  });
});

describe("factures FNE et statistiques", () => {
  it("la facture du mois apparaît dans le rapprochement des commissions ; annulée, elle en disparaît", async () => {
    const mois = new Date().toISOString().slice(0, 7);
    expect((await envoyer(ctx, { url: "/commissions/releves", cookie: cookies.gerant, corps: { mois, montantDeclare: 25_000 } })).statusCode).toBe(200);
    const numeroFne = `FNE-${unique()}`;
    const facture = await envoyer(ctx, { url: "/factures-fne", cookie: cookies.gerant,
      corps: { numeroFne, emiseLe: aujourdHuiPlus(0), objet: "commissions", mois, destinataire: "SanlamAllianz Côte d'Ivoire", montantTtc: 25_000 } });
    expect(facture.statusCode).toBe(201);
    expect((await envoyer(ctx, { url: "/factures-fne", cookie: cookies.gerant,
      corps: { numeroFne: `FNE-${unique()}`, emiseLe: aujourdHuiPlus(0), objet: "frais", mois, destinataire: "Client", montantTtc: 5_000 } })).statusCode).toBe(422);
    expect((await envoyer(ctx, { url: "/factures-fne", cookie: cookies.caissier,
      corps: { numeroFne: `FNE-${unique()}`, emiseLe: aujourdHuiPlus(0), objet: "frais", destinataire: "Client", montantTtc: 5_000 } })).statusCode).toBe(403);

    const ligne = (await envoyer(ctx, { url: "/commissions", cookie: cookies.auditeur })).json().rapprochement.find((m: { mois: string }) => m.mois === mois);
    expect(ligne).toMatchObject({ numeroFne, montantFne: 25_000 });
    const annulation = await envoyer(ctx, { url: `/factures-fne/${facture.json().facture.id}/annulation`, cookie: cookies.gerant, corps: { motif: "Montant erroné, avoir émis" } });
    expect(annulation.statusCode).toBe(204);
    const apres = (await envoyer(ctx, { url: "/commissions", cookie: cookies.gerant })).json().rapprochement.find((m: { mois: string }) => m.mois === mois);
    expect(apres.numeroFne).toBeNull();
    expect((await envoyer(ctx, { url: "/factures-fne", cookie: cookies.auditeur })).json().factures
      .find((f: { numeroFne: string }) => f.numeroFne === numeroFne)).toMatchObject({ motifAnnulation: "Montant erroné, avoir émis" });
  });

  it("statistiques de l'année pour le gérant et l'auditeur", async () => {
    const annee = new Date().getUTCFullYear();
    const stats = await envoyer(ctx, { url: `/statistiques?annee=${annee}`, cookie: cookies.gerant });
    expect(stats.statusCode).toBe(200);
    const corps = stats.json();
    expect(corps.annee).toBe(annee);
    expect(corps.mois).toHaveLength(12);
    expect(corps.mois[0].mois).toBe(`${annee}-01`);
    expect(corps.portefeuille.clients).toBeGreaterThan(0);
    expect(corps.reclamations.recues).toBeGreaterThanOrEqual(2);
    expect(corps.production.length).toBeGreaterThan(0);
    expect((await envoyer(ctx, { url: "/statistiques", cookie: cookies.auditeur })).statusCode).toBe(200);
    expect((await envoyer(ctx, { url: "/statistiques", cookie: cookies.caissier })).statusCode).toBe(403);
    expect((await envoyer(ctx, { url: "/statistiques?annee=19", cookie: cookies.gerant })).statusCode).toBe(400);
  });
});
