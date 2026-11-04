// Parcours complet dans un vrai navigateur : première connexion du gérant (deuxième facteur, mot de passe),
// création d'un client et d'un contrat, encaissement et reçu, accord du client pour les rappels et relance
// automatique (en simulation), relance et renouvellement depuis le tableau des échéances, clôture de caisse,
// bordereau de reversement, demande de devis reçue du site, commissions, flotte d'un transporteur (import,
// avenants d'incorporation et de retrait au prorata, annulation, attestation, sinistre, accès au portail),
// création d'un compte.
// Aucune violation de la politique de sécurité du contenu n'est tolérée.

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { codeTotp, decoderBase32, pasDeTemps } from "../../../api/src/securite/totp";

const acces = JSON.parse(readFileSync(new URL("../../.e2e/acces.json", import.meta.url), "utf8"));
const NOUVEAU_MOT_DE_PASSE = "La mangue verte du marché d'Adjamé 2026";

function dans(jours: number): string {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  return d.toISOString().slice(0, 10);
}

function surveillerCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  page.on("pageerror", (erreur) => violations.push(`Erreur JavaScript : ${erreur.message}`));
  return violations;
}

test("parcours du gérant, de la première connexion à la caisse et au reversement", async ({ page }) => {
  // Long parcours : toutes les tâches du back-office, l'une après l'autre
  test.setTimeout(120_000);
  const violations = surveillerCsp(page);

  // --- Première connexion : mot de passe provisoire
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Espace de gestion" })).toBeVisible();
  await page.getByLabel("Adresse e-mail").fill(acces.gerant.email);
  await page.getByLabel("Mot de passe").fill("mauvais mot de passe");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("alert")).toContainText("E-mail ou mot de passe incorrect");
  await page.getByLabel("Mot de passe").fill(acces.gerant.motDePasse);
  await page.getByRole("button", { name: "Continuer" }).click();

  // --- Deuxième facteur : QR code dessiné localement, clé lisible
  await expect(page.getByRole("heading", { name: "Protégez votre compte" })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  const secret = decoderBase32((await page.locator("code.secret").textContent()) ?? "");
  await page.getByLabel(/Code à 6 chiffres/).fill(codeTotp(secret, pasDeTemps(Date.now())));
  await page.getByRole("button", { name: "Activer et continuer" }).click();

  // --- Mot de passe personnel obligatoire
  await expect(page.getByText("Dernière étape")).toBeVisible();
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill(NOUVEAU_MOT_DE_PASSE);
  await page.getByLabel("Confirmez le nouveau mot de passe").fill(NOUVEAU_MOT_DE_PASSE);
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(page.getByRole("heading", { name: "Échéances" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toContainText("Personnel");

  // --- Nouveau client, avec un numéro saisi comme au guichet
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: "Nouveau client" }).click();
  await page.getByLabel("Nom et prénoms ou raison sociale").fill("Transports Kouamé & Fils");
  await page.getByLabel("Téléphone").fill("07 11 22 33 44");
  await page.getByLabel("Commune (facultatif)").fill("Yopougon");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await expect(page.getByRole("heading", { name: "Transports Kouamé & Fils" })).toBeVisible();
  await expect(page.getByRole("link", { name: "07 11 22 33 44" })).toHaveAttribute("href", "tel:+2250711223344");

  // --- Contrat qui arrive à échéance dans 5 jours
  await page.getByRole("button", { name: "Nouveau contrat" }).click();
  await page.getByLabel("N° de police (facultatif)").fill("SA-2026-0042");
  await page.getByLabel("Date d'effet").fill(dans(-360));
  await page.getByLabel("Échéance").fill(dans(5));
  await page.getByLabel("Prime TTC (F CFA)").fill("185000");
  await page.getByRole("button", { name: "Créer le contrat" }).click();
  const ligneContrat = page.getByRole("row", { name: /SA-2026-0042/ });
  await expect(ligneContrat).toContainText("En attente de paiement");
  await expect(ligneContrat).toContainText("185 000");

  // --- Échange noté sur la fiche
  await page.getByLabel("Résumé de l'échange").fill("Appelé pour confirmer la liste des véhicules");
  await page.getByRole("button", { name: "Noter" }).click();
  await expect(page.getByText("Appelé pour confirmer la liste des véhicules")).toBeVisible();

  // --- Encaissement au guichet : le reçu s'ouvre, le contrat entre en vigueur de lui-même
  await ligneContrat.getByRole("link", { name: "Encaisser" }).click();
  await expect(page.getByRole("heading", { name: /SA-2026-0042/ })).toBeVisible();
  await expect(page.getByLabel("Montant (F CFA)")).toHaveValue("185000");
  await page.getByLabel("Mode de paiement").selectOption("mobile_money");
  await page.getByRole("button", { name: "Encaisser et imprimer le reçu" }).click();
  expect(await page.getByLabel("Référence").evaluate((champ) => (champ as HTMLInputElement).validity.valueMissing)).toBe(true);
  await page.getByLabel("Mode de paiement").selectOption("especes");
  await page.getByRole("button", { name: "Encaisser et imprimer le reçu" }).click();
  await expect(page.getByRole("heading", { name: "Reçu n° 000001" })).toBeVisible();
  await expect(page.getByText("cent quatre-vingt-cinq mille francs CFA")).toBeVisible();
  await expect(page.getByRole("link", { name: "Envoyer la confirmation sur WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/2250711223344/);
  await page.getByRole("link", { name: "Retour au contrat" }).click();
  await expect(page.getByText("Prime entièrement payée : le contrat est en vigueur.")).toBeVisible();
  await expect(page.getByRole("row", { name: /N° 1/ })).toContainText("185 000");

  // --- Relances : sans accord du client, la relance est à faire à la main ; avec, elle part toute seule
  await page.getByRole("link", { name: "Relances", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Relances", level: 1 })).toBeVisible();
  await expect(page.getByText(/Mode simulation/)).toBeVisible();
  const aFaireALaMain = page.locator("section", { has: page.getByRole("heading", { name: "À faire à la main" }) });
  const relanceManuelle = aFaireALaMain.getByRole("row", { name: /Transports Kouamé & Fils/ });
  await expect(relanceManuelle).toContainText("Échéance dans 7 jours");
  await expect(relanceManuelle.getByRole("link", { name: "Relancer sur WhatsApp" }))
    .toHaveAttribute("href", /^https:\/\/wa\.me\/2250711223344\?text=.*arrive%20%C3%A0%20%C3%A9ch%C3%A9ance/);
  await relanceManuelle.getByRole("link", { name: "Transports Kouamé & Fils" }).click();

  const rappels = page.locator("section", { has: page.getByRole("heading", { name: "Rappels automatiques" }) });
  await expect(rappels.getByRole("listitem").filter({ hasText: "WhatsApp" })).toContainText("Pas encore demandé");
  await rappels.getByLabel("Comment le client l'a exprimé").fill("Accord oral au guichet");
  await rappels.getByRole("button", { name: "Enregistrer son choix" }).click();
  await expect(rappels.getByRole("listitem").filter({ hasText: "WhatsApp" })).toContainText("Accepté");
  await expect(rappels.getByRole("listitem").filter({ hasText: "WhatsApp" })).toContainText("Accord oral au guichet");

  await page.getByRole("link", { name: "Relances", exact: true }).click();
  await page.getByRole("button", { name: "Lancer les relances maintenant" }).click();
  await expect(page.getByText("1 relance planifiée, 1 message envoyé.")).toBeVisible();
  await expect(aFaireALaMain.getByRole("row", { name: /Transports Kouamé & Fils/ })).toHaveCount(0);
  const relanceEnvoyee = page.getByRole("row", { name: /Transports Kouamé & Fils/ });
  await expect(relanceEnvoyee).toContainText("Envoyée");
  await expect(relanceEnvoyee).toContainText("votre assurance automobile (police SA-2026-0042) arrive à échéance le");

  await page.getByRole("link", { name: "Échéances" }).click();
  await expect(page.getByRole("button", { name: /Dans 7 jours/ })).toContainText("1");
  const ligneEcheance = page.getByRole("row", { name: /Transports Kouamé & Fils/ });
  await expect(ligneEcheance).toContainText("dans 5 j");
  const relance = ligneEcheance.getByRole("link", { name: "Relancer sur WhatsApp" });
  await expect(relance).toHaveAttribute("href", /^https:\/\/wa\.me\/2250711223344\?text=.*SA-2026-0042/);
  await expect(relance).toHaveAttribute("rel", /noopener/);

  await ligneEcheance.getByRole("button", { name: "Renouveler" }).click();
  await expect(page.getByText(/Renouvellement préparé pour Transports Kouamé & Fils/)).toBeVisible();
  await expect(page.getByRole("row", { name: /Transports Kouamé & Fils/ })).toHaveCount(0);
  await expect(page.getByText(/de primes à reverser à SanlamAllianz/)).toBeVisible();

  // --- Clôture de caisse avec billetage : 18 billets de 10 000 et 1 de 5 000
  await page.getByRole("link", { name: "Caisse", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ma caisse", exact: true })).toBeVisible();
  const formulaireCloture = page.getByRole("form", { name: "Clôturer ma caisse" });
  await formulaireCloture.getByLabel(/^10\s000 F$/).fill("18");
  await expect(formulaireCloture.getByLabel("Explication de l'écart")).toBeVisible();
  await formulaireCloture.getByLabel(/^5\s000 F$/).fill("1");
  await expect(formulaireCloture.getByLabel("Explication de l'écart")).toHaveCount(0);
  await formulaireCloture.getByRole("button", { name: "Clôturer la caisse" }).click();
  await expect(page.getByText(/Caisse clôturée \(clôture n° 1\)/)).toBeVisible();
  const clotures = page.locator("section", { has: page.getByRole("heading", { name: "Clôtures de caisse" }) });
  await expect(clotures.getByRole("row").nth(1)).toContainText("À viser");

  // --- Bordereau de reversement : préparé par le gérant, il doit être validé par quelqu'un d'autre
  await page.getByRole("link", { name: "Reversements", exact: true }).click();
  await page.getByRole("button", { name: "Préparer le bordereau" }).click();
  await expect(page.getByRole("heading", { name: /^Bordereau BR-\d{4}-0001$/ })).toBeVisible();
  await expect(page.getByText("une autre personne doit le valider")).toBeVisible();
  await expect(page.getByRole("button", { name: "Valider le bordereau" })).toHaveCount(0);
  const telechargement = page.getByRole("link", { name: "Télécharger pour Excel" });
  const csv = await page.evaluate(async (adresse) => {
    const reponse = await fetch(adresse!);
    return { type: reponse.headers.get("content-type"), texte: await reponse.text() };
  }, await telechargement.getAttribute("href"));
  expect(csv.type).toBe("text/csv; charset=utf-8");
  expect(csv.texte).toContain("Transports Kouamé & Fils");

  // --- Demande de devis reçue du site (tâche 7) : carte grise téléchargée, puis client et devis créés
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const envoiSite = await page.request.post("http://127.0.0.1:3100/site/demandes-devis", {
    headers: { Origin: "http://localhost:4321" },
    data: {
      assurance: "automobile", profil: "particulier", nom: "Mariam Traoré", telephone: "07 08 09 10 11",
      besoin: "Suzuki Swift 2021, usage personnel", accordTraitement: "J'accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.",
      accordWhatsApp: "J'accepte de recevoir sur WhatsApp les rappels de l'agence.",
      piece: { type: "image/png", contenu: png.toString("base64") },
    },
  });
  expect(envoiSite.status()).toBe(201);
  expect(envoiSite.headers()["access-control-allow-origin"]).toBe("http://localhost:4321");
  await page.getByRole("link", { name: "Demandes du site" }).click();
  await expect(page.getByRole("button", { name: "À traiter (1)" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Mariam Traoré/ })).toContainText("Carte grise jointe");
  await page.getByRole("link", { name: /^n° \d+$/ }).click();
  await expect(page.getByRole("heading", { name: /^Demande n° \d+$/ })).toBeVisible();
  // Analysée par l'antivirus à la réception, puis de nouveau au téléchargement
  await expect(page.getByText(/Aucune menace trouvée par l'antivirus/)).toBeVisible();
  const [carteGrise] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Télécharger/ }).click()]);
  expect(carteGrise.suggestedFilename()).toMatch(/^carte-grise-demande-\d+\.png$/);
  expect(readFileSync(await carteGrise.path()).equals(png)).toBe(true);
  await page.getByRole("button", { name: "Créer le client et le devis" }).click();
  await expect(page.getByRole("heading", { name: "Mariam Traoré" })).toBeVisible();
  await expect(page.getByText("demande reçue par le site")).toBeVisible();
  await expect(page.locator(".consentements li", { hasText: "WhatsApp" })).toContainText(/Accepté.*Case « rappels WhatsApp » cochée sur le site/);

  // --- Commissions : taux de la branche automobile
  await page.getByRole("link", { name: "Commissions", exact: true }).click();
  await page.getByLabel("Taux (%)").fill("12,5");
  await page.getByRole("button", { name: "Ajouter le taux" }).click();
  await expect(page.getByRole("row", { name: /Automobile/ })).toContainText("12,50 %");

  // --- Flotte d'un transporteur (tâche 8) : import contrôlé, échéances, export, contrat, avenants au prorata
  const jj = (jours: number) => dans(jours).split("-").reverse().join("/");
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: "Nouveau client" }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("entreprise");
  await page.getByLabel("Nom et prénoms ou raison sociale").fill("Transports Flotte Express");
  await page.getByLabel("Téléphone").fill("07 22 33 44 55");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await expect(page.getByRole("heading", { name: "Transports Flotte Express" })).toBeVisible();
  await page.getByRole("link", { name: "Flotte : import, échéances, avenants" }).click();
  await expect(page.getByRole("heading", { name: "Flotte de Transports Flotte Express" })).toBeVisible();

  const fichierFlotte = (lignes: string[]) => ({
    name: "flotte.csv", mimeType: "text/csv",
    buffer: Buffer.from(["Immatriculation;Marque;Genre;CV;Visite technique;Vignette", ...lignes].join("\n")),
  });
  // Premier essai : une plaque en double et une date impossible, rien n'est importé
  await page.getByLabel("Fichier de la flotte").setInputFiles(fichierFlotte([
    `7001 FE 01;Renault Trucks;Tracteur routier;12;${jj(10)};${jj(-5)}`,
    "7001-fe-01;Isuzu;Camion;9;31/02/2027;",
  ]));
  const erreursImport = page.getByRole("row", { name: /Véhicule déjà présent à la ligne 2 du fichier/ });
  await expect(erreursImport).toContainText("3");
  await expect(page.getByRole("row", { name: /Date invalide/ })).toContainText("Visite technique");
  await expect(page.getByRole("button", { name: /^Importer \d/ })).toHaveCount(0);
  // Fichier corrigé : aperçu, puis import
  await page.getByLabel("Fichier de la flotte").setInputFiles(fichierFlotte([
    `7001 FE 01;Renault Trucks;Tracteur routier;12;${jj(10)};${jj(-5)}`,
    `7002 FE 01;Isuzu;Camion;9;${jj(200)};${jj(150)}`,
    `7003 FE 01;Toyota;Camionnette;8;${jj(300)};${jj(250)}`,
  ]));
  await expect(page.getByText("3 véhicule(s) à ajouter, 0 à mettre à jour.")).toBeVisible();
  await page.getByRole("button", { name: "Importer 3 véhicule(s)" }).click();
  await expect(page.getByText("Import terminé : 3 véhicule(s) ajouté(s), 0 mis à jour.")).toBeVisible();
  const premierCamion = page.getByRole("row", { name: /7001 FE 01/ });
  await expect(premierCamion).toContainText("10 j");
  await expect(premierCamion).toContainText("échue");
  const exportFlotte = await page.evaluate(async (adresse) => {
    const reponse = await fetch(adresse!);
    return { type: reponse.headers.get("content-type"), texte: await reponse.text() };
  }, await page.getByRole("link", { name: "Exporter pour la cotation" }).getAttribute("href"));
  expect(exportFlotte.type).toBe("text/csv; charset=utf-8");
  expect(exportFlotte.texte).toContain("7003 FE 01;;Toyota;;Camionnette;;8;");

  // Contrat flotte de 365 jours commencé il y a 100 jours : deux camions au départ (un troisième, rattaché
  // par erreur, est détaché avant le paiement), payé par virement
  await page.getByRole("link", { name: "Transports Flotte Express" }).click();
  await page.getByRole("button", { name: "Nouveau contrat" }).click();
  await page.getByLabel("Branche").first().selectOption("flotte");
  await page.getByLabel("N° de police (facultatif)").fill("FLT-2026-0007");
  await page.getByLabel("Date d'effet").fill(dans(-100));
  await page.getByLabel("Échéance").fill(dans(265));
  await page.getByLabel("Prime TTC (F CFA)").fill("900000");
  await page.getByRole("button", { name: "Créer le contrat" }).click();
  await expect(page.getByRole("row", { name: /FLT-2026-0007/ })).toContainText("En attente de paiement");
  await page.getByRole("link", { name: "Flotte : import, échéances, avenants" }).click();
  const rattachement = page.getByRole("form", { name: "Rattacher un véhicule de départ" });
  for (const plaque of ["7001 FE 01", "7002 FE 01", "7003 FE 01"]) {
    await rattachement.getByLabel("Véhicule de départ").selectOption({ label: plaque });
    await rattachement.getByLabel(/Prime du véhicule/).fill("450000");
    await rattachement.getByRole("button", { name: "Rattacher au contrat" }).click();
    await expect(page.getByRole("button", { name: `Détacher ${plaque} du contrat` })).toBeVisible();
  }
  await page.getByRole("button", { name: "Détacher 7003 FE 01 du contrat" }).click();
  await expect(page.getByRole("button", { name: "Détacher 7003 FE 01 du contrat" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Détacher / })).toHaveCount(2);
  await page.getByRole("link", { name: "Paiements" }).click();
  await page.getByLabel("Mode de paiement").selectOption("virement");
  await page.getByLabel("Référence").fill("VIR-FLT-0007");
  await page.getByRole("button", { name: "Encaisser et imprimer le reçu" }).click();
  await expect(page.getByRole("heading", { name: /^Reçu n° / })).toBeVisible();

  // Avenant n° 1 : le troisième camion est incorporé aujourd'hui, 365 000 × 265 jours restants / 365 = 265 000 F CFA
  await page.goto(page.url().replace(/\/recus\/.*$/, "/clients"));
  await page.getByRole("link", { name: "Transports Flotte Express" }).click();
  await page.getByRole("link", { name: "Flotte : import, échéances, avenants" }).click();
  const avenant = page.getByRole("form", { name: "Nouvel avenant" });
  await expect(avenant.getByRole("button", { name: /Calculer le prorata/ })).toBeDisabled();
  await avenant.getByRole("checkbox", { name: "Incorporer 7003 FE 01" }).check();
  await avenant.getByLabel("Prime de 7003 FE 01 pour la période (F CFA)").fill("365000");
  await avenant.getByRole("button", { name: "Calculer le prorata (1 véhicule)" }).click();
  await expect(avenant.getByRole("status")).toContainText(/Total de l'avenant : 265\s000\sF CFA à encaisser/);
  await avenant.getByRole("button", { name: "Enregistrer l'avenant" }).click();
  await expect(page.getByText(/Avenant n° 1 enregistré : 265\s000\sF CFA à encaisser\./)).toBeVisible();
  const ligneAvenant = page.getByRole("row", { name: /Incorporation de 7003 FE 01/ });
  await expect(ligneAvenant).toContainText("À encaisser");
  await expect(ligneAvenant).toContainText("× 265 / 365 j");

  // Avenant n° 2 : retrait saisi par erreur, puis annulé par l'avenant n° 3 (motif obligatoire, effet affiché)
  await avenant.getByRole("checkbox", { name: "Retirer 7002 FE 01" }).check();
  await avenant.getByRole("button", { name: /Calculer le prorata/ }).click();
  await expect(avenant.getByRole("status")).toContainText(/ristourne de 326\s712\sF CFA/);
  await avenant.getByRole("button", { name: "Enregistrer l'avenant" }).click();
  await expect(page.getByText(/Avenant n° 2 enregistré : ristourne de 326\s712\sF CFA\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Annuler l'avenant n° 1" })).toBeVisible();
  await page.getByRole("button", { name: "Annuler l'avenant n° 2" }).click();
  const annulation = page.getByRole("form", { name: "Annuler l'avenant n° 2" });
  await expect(annulation.getByRole("button", { name: "Voir l'effet" })).toBeDisabled();
  await annulation.getByLabel("Motif de l'annulation").fill("Erreur : 7002 FE 01 roule toujours");
  await annulation.getByRole("button", { name: "Voir l'effet" }).click();
  await expect(annulation.getByRole("status")).toContainText(/Effet de l'annulation : 326\s712\sF CFA à encaisser/);
  await annulation.getByRole("button", { name: "Confirmer l'annulation" }).click();
  await expect(page.getByRole("row", { name: /Retrait de 7002 FE 01/ })).toContainText("Annulé (n° 3)");
  await expect(page.getByRole("row", { name: /Annulation de l'avenant n° 2/ })).toContainText("Erreur : 7002 FE 01 roule toujours");
  await expect(page.getByRole("button", { name: /^Annuler l'avenant/ })).toHaveCount(1);

  // Attestation du premier camion (PDF de l'ASACI), analysée puis disponible sur le portail de l'entreprise
  await page.getByText(/^Attestations : 0 déposée\(s\) sur 3 véhicule\(s\)/).click();
  await page.getByLabel("N° d'attestation de 7001 FE 01").fill("ASACI-E2E-7001");
  await page.getByLabel("PDF de l'attestation de 7001 FE 01").setInputFiles({
    name: "attestation-7001-FE-01.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% attestation de test\n%%EOF\n"),
  });
  await page.getByRole("button", { name: "Déposer 1 attestation(s)" }).click();
  await expect(page.getByText("1 attestation(s) déposée(s) sur 1.")).toBeVisible();
  const lienAttestation = page.getByRole("link", { name: "Attestation ASACI-E2E-7001 de 7001 FE 01 (PDF)" });
  await expect(lienAttestation).toBeVisible();
  expect(await page.evaluate(async (adresse) => (await fetch(adresse!)).headers.get("content-type"), await lienAttestation.getAttribute("href")))
    .toBe("application/pdf");

  // Sinistre sur ce camion, puis suivi de son statut : il rejoint l'historique du véhicule
  await page.getByText("Déclarer un sinistre").click();
  const declaration = page.getByRole("form", { name: "Déclarer un sinistre" });
  await declaration.getByLabel("Véhicule concerné").selectOption({ label: "7001 FE 01" });
  await declaration.getByLabel("Nature").selectOption("bris_de_glace");
  await declaration.getByRole("button", { name: "Enregistrer le sinistre" }).click();
  const statutSinistre = page.getByLabel(/^Statut du sinistre de 7001 FE 01/);
  await expect(statutSinistre).toHaveValue("declare");
  await statutSinistre.selectOption("transmis_compagnie");
  await expect(page.getByRole("row", { name: /^7001 FE 01 Renault Trucks/ })).toContainText("dernier le");
  await expect(page.getByLabel(/^Statut du sinistre de 7001 FE 01/)).toHaveValue("transmis_compagnie");

  // Accès du transporteur à son portail, depuis sa fiche
  await page.getByRole("link", { name: "Transports Flotte Express" }).first().click();
  const nouvelAcces = page.getByRole("form", { name: "Nouvel accès au portail" });
  await nouvelAcces.getByLabel("Nom et prénoms").fill("Awa Flotte");
  await nouvelAcces.getByLabel("Numéro WhatsApp").fill("07 11 22 33 44");
  await nouvelAcces.getByRole("button", { name: "Créer l'accès" }).click();
  await expect(page.getByText(/Accès créé pour Awa Flotte/)).toBeVisible();
  await expect(page.getByRole("row", { name: /Awa Flotte/ })).toContainText("Titulaire");
  await expect(page.getByRole("row", { name: /Awa Flotte/ })).toContainText("Jamais");

  // --- Nouveau compte : mot de passe provisoire affiché une seule fois
  await page.getByRole("link", { name: "Personnel" }).click();
  await page.getByLabel("Nom et prénoms").fill("Koffi Caissier");
  await page.getByLabel("Adresse e-mail").fill("caisse.e2e@dbs-assurances.test");
  await page.getByLabel("Rôle").selectOption("caissier");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page.getByText(/Mot de passe provisoire de/)).toBeVisible();
  await expect(page.locator("code.secret")).toHaveText(/^\w{5}-\w{5}-\w{5}-\w{5}$/);
  await expect(page.getByRole("row", { name: /Koffi Caissier/ })).toContainText("Actif");

  // --- Déconnexion
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByRole("heading", { name: "Espace de gestion" })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch("/api/auth/session")).status)).toBe(401);

  expect(violations).toEqual([]);
});

test("les en-têtes de sécurité sont envoyés et rien n'est gardé dans le navigateur", async ({ page }) => {
  const reponse = await page.goto("/");
  const enTetes = reponse!.headers();
  expect(enTetes["content-security-policy"]).toContain("script-src 'self'");
  expect(enTetes["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(enTetes["x-frame-options"]).toBe("DENY");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
