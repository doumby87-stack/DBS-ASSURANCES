// Formulaire de devis relié à l'API de l'agence (tâche 7), sur la version construite avec URL_API
// (tests/construire.mjs). L'API est simulée : on vérifie ce que le navigateur envoie, que la politique de
// sécurité du contenu l'autorise, et ce que voit le visiteur dans chaque cas (succès, refus, coupure).

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.use({ baseURL: "http://localhost:4322" });

const ACCORD = "J'accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.";
// Plus petit PNG valide (1 × 1 pixel)
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

type Reponse = { statut: number; corps: object } | "coupure";

/** API simulée : répond à la requête préalable (CORS) et garde chaque demande reçue. */
async function simulerApi(context: BrowserContext, reponse: Reponse = { statut: 201, corps: { numero: 42 } }) {
  const recues: Record<string, unknown>[] = [];
  await context.route("**/site/demandes-devis", async (route) => {
    const requete = route.request();
    const origine = (await requete.headerValue("origin")) ?? "";
    const cors = { "access-control-allow-origin": origine, vary: "Origin" };
    if (requete.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { ...cors, "access-control-allow-methods": "POST", "access-control-allow-headers": "Content-Type" } });
      return;
    }
    recues.push(requete.postDataJSON());
    if (reponse === "coupure") return route.abort("internetdisconnected");
    await route.fulfill({ status: reponse.statut, headers: cors, contentType: "application/json", body: JSON.stringify(reponse.corps) });
  });
  return recues;
}

function surveillerErreurs(page: Page): string[] {
  const erreurs: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) erreurs.push(m.text());
  });
  page.on("pageerror", (e) => erreurs.push(e.message));
  return erreurs;
}

async function remplirJusquAuxCoordonnees(page: Page, assurance = "automobile") {
  await page.goto(`/devis/?assurance=${assurance}`);
  await page.locator('[data-etape="1"] [data-suivant]').click();
}

async function remplirCoordonnees(page: Page) {
  await page.getByLabel(/Nom et prénoms/).fill("Awa Koné");
  await page.getByLabel(/Téléphone/).fill("07 12 34 56 78");
  await page.getByRole("checkbox", { name: /utilise ces informations/ }).check();
}

test("la demande est enregistrée avec ses réponses, la carte grise et l'accord WhatsApp, puis confirmée", async ({ page, context }) => {
  const erreurs = surveillerErreurs(page);
  const recues = await simulerApi(context);
  const reponse = await page.goto("/devis/?assurance=automobile");
  expect(reponse?.headers()["content-security-policy"]).toContain("connect-src http://api.dbs.test");

  await page.locator('[data-etape="1"] [data-suivant]').click();
  await expect(page.getByLabel(/^Carte grise/)).toBeVisible();
  await page.locator("[data-questionnaire]:visible").getByLabel(/Marque et modèle/).fill("Toyota Corolla");
  await page.getByLabel(/Autres précisions/).fill("Achat récent");
  await page.getByLabel(/^Carte grise/).setInputFiles({ name: "carte-grise.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[data-etape="2"] [data-suivant]').click();

  await remplirCoordonnees(page);
  await page.getByRole("checkbox", { name: /rappels de l'agence/ }).check();
  await page.getByRole("button", { name: "Envoyer ma demande" }).click();

  const confirmation = page.locator("[data-confirmation]");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toBeFocused();
  await expect(confirmation.getByRole("heading")).toHaveText("Demande n° 42 enregistrée");
  await expect(confirmation.getByRole("link", { name: /Écrire à l'agence/ })).toHaveAttribute("href", /demande%20de%20devis%20n%C2%B0%2042/);
  await expect(page.locator("[data-etape]:visible")).toHaveCount(0);

  expect(recues).toHaveLength(1);
  expect(recues[0]).toEqual({
    assurance: "automobile",
    profil: "particulier",
    nom: "Awa Koné",
    telephone: "07 12 34 56 78",
    besoin: "Achat récent",
    details: { marqueModele: "Toyota Corolla" },
    accordTraitement: ACCORD,
    accordWhatsApp: expect.stringMatching(/^J'accepte de recevoir sur WhatsApp les rappels de l'agence/),
    pieces: [{ nature: "carte_grise", type: "image/png", contenu: PNG.toString("base64") }],
  });

  const analyse = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(analyse.violations.map((v) => v.id)).toEqual([]);
  expect(erreurs).toEqual([]);
});

test("flotte : les questions et les documents d'un parc, réponses obligatoires comprises", async ({ page, context }) => {
  const erreurs = surveillerErreurs(page);
  const recues = await simulerApi(context);
  await page.goto("/devis/?assurance=flotte");
  await expect(page.locator('input[name="profil"][value="Entreprise"]')).toBeChecked();
  await page.locator('[data-etape="1"] [data-suivant]').click();

  // Les questions d'une flotte, et ses documents : la liste des véhicules d'abord
  const etape = page.locator('[data-etape="2"]');
  await expect(page.locator("[data-questionnaire=\"automobile\"]")).toBeHidden();
  await expect(page.locator("[data-questionnaire=\"flotte\"]")).toBeVisible();
  await expect(etape.locator("[data-piece]:visible label")).toHaveText([
    "Liste des véhicules", "Carte grise (un ou plusieurs fichiers)", "Attestation ou contrat d'assurance actuel",
    "Registre de commerce (RCCM)", "Carte de transport",
  ]);
  const analyse = await new AxeBuilder({ page }).include('[data-etape="2"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(analyse.violations.map((v) => v.id)).toEqual([]);

  // Deux réponses obligatoires
  await etape.locator("[data-suivant]").click();
  await expect(page.locator("#erreur-q-flotte-nombreVehicules")).toHaveText("Répondez à cette question.");
  await expect(page.locator("#erreur-q-flotte-typesVehicules")).toHaveText("Cochez au moins une réponse.");
  await expect(page.getByLabel(/Nombre de véhicules/)).toBeFocused();
  await page.getByLabel(/Nombre de véhicules/).fill("1");
  await etape.locator("[data-suivant]").click();
  await expect(page.locator("#erreur-q-flotte-nombreVehicules")).toHaveText("Indiquez un nombre entier entre 2 et 5 000.");
  await page.getByLabel(/Nombre de véhicules/).fill("12");
  await expect(page.locator("#erreur-q-flotte-nombreVehicules")).toBeEmpty();
  await etape.getByText("Tracteurs routiers").click();
  await etape.getByText("Semi-remorques et remorques").click();
  await expect(page.locator("#erreur-q-flotte-typesVehicules")).toBeEmpty();
  await etape.getByText("Transport pour le compte d'autrui (transporteur)").click();
  await etape.getByText("Pays voisins (CEDEAO)").click();

  // La liste en Excel, deux cartes grises
  await page.getByLabel("Liste des véhicules").setInputFiles({ name: "parc.xlsx", mimeType: XLSX, buffer: Buffer.from("PK classeur") });
  await page.getByLabel(/^Carte grise/).setInputFiles([
    { name: "camion-1.png", mimeType: "image/png", buffer: PNG },
    { name: "camion-2.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(page.locator("[data-pieces-total]")).toContainText("3 documents choisis");
  await etape.locator("[data-suivant]").click();

  const recapitulatif = page.locator("[data-recapitulatif]");
  await expect(recapitulatif).toContainText("Entreprise");
  await expect(recapitulatif).toContainText("Nombre de véhicules12");
  await expect(recapitulatif).toContainText("Types de véhiculesTracteurs routiers, Semi-remorques et remorques");
  await expect(recapitulatif).toContainText("Documents jointsListe des véhicules, Carte grise, Carte grise");
  await remplirCoordonnees(page);
  await page.getByRole("button", { name: "Envoyer ma demande" }).click();
  await expect(page.locator("[data-confirmation]")).toBeVisible();

  expect(recues[0]).toMatchObject({
    assurance: "flotte",
    profil: "entreprise",
    details: { nombreVehicules: 12, typesVehicules: ["tracteurs", "remorques"], usage: "compte_autrui", zones: ["international"] },
    pieces: [
      { nature: "liste_vehicules", type: XLSX, contenu: Buffer.from("PK classeur").toString("base64") },
      { nature: "carte_grise", type: "image/png", contenu: PNG.toString("base64") },
      { nature: "carte_grise", type: "image/png", contenu: PNG.toString("base64") },
    ],
  });
  expect(erreurs).toEqual([]);
});

test("les documents dépendent de l'assurance, et sont vérifiés avant l'envoi", async ({ page }) => {
  await remplirJusquAuxCoordonnees(page, "habitation");
  await expect(page.getByLabel(/^Carte grise/)).toBeHidden();
  await expect(page.getByLabel("Photos du bien, des locaux ou du matériel (un ou plusieurs fichiers)")).toBeVisible();

  await remplirJusquAuxCoordonnees(page, "deux_roues");
  await page.getByLabel(/^Carte grise/).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("texte") });
  await expect(page.locator("#erreur-piece-carte_grise")).toHaveText("Choisissez une photo (JPEG ou PNG) ou un PDF.");
  await page.locator('[data-etape="2"] [data-suivant]').click();
  await expect(page.locator('[data-etape="2"]')).toBeVisible();

  // Un classeur Excel n'est pas une carte grise
  await page.getByLabel(/^Carte grise/).setInputFiles({ name: "liste.xlsx", mimeType: XLSX, buffer: Buffer.from("PK") });
  await expect(page.locator("#erreur-piece-carte_grise")).toHaveText("Choisissez une photo (JPEG ou PNG) ou un PDF.");

  await page.getByLabel(/^Carte grise/).setInputFiles({ name: "lourde.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(page.locator("#erreur-piece-carte_grise")).toContainText("dépasse 5 Mo");

  // Six documents au plus
  await page.getByLabel(/^Carte grise/).setInputFiles(Array.from({ length: 7 }, (_, i) => ({ name: `carte-${i}.png`, mimeType: "image/png", buffer: PNG })));
  await expect(page.locator("#erreur-pieces")).toHaveText("6 documents au plus : retirez-en quelques-uns.");
  await page.locator('[data-etape="2"] [data-suivant]').click();
  await expect(page.locator('[data-etape="2"]')).toBeVisible();

  await page.getByLabel(/^Carte grise/).setInputFiles([]);
  await expect(page.locator("#erreur-pieces")).toBeEmpty();
  await page.locator('[data-etape="2"] [data-suivant]').click();
  await expect(page.locator('[data-etape="3"]')).toBeVisible();
});

test("refus de l'API : le message est affiché, avec WhatsApp en repli", async ({ page, context }) => {
  await simulerApi(context, { statut: 429, corps: { code: "trop_de_demandes", message: "Vous avez déjà envoyé plusieurs demandes. Réessayez dans une heure, ou écrivez-nous sur WhatsApp." } });
  await remplirJusquAuxCoordonnees(page);
  await page.locator('[data-etape="2"] [data-suivant]').click();
  await remplirCoordonnees(page);
  await page.getByRole("button", { name: "Envoyer ma demande" }).click();

  const etat = page.locator("[data-statut-envoi]");
  await expect(etat).toContainText("Vous avez déjà envoyé plusieurs demandes.");
  await expect(etat).toHaveClass(/etat-envoi--erreur/);
  await expect(etat.getByRole("link", { name: /sur WhatsApp/ })).toHaveAttribute("href", /^https:\/\/wa\.me\/2250749360702\?text=/);
  await expect(page.locator('[data-etape="3"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Envoyer ma demande" })).toBeEnabled();
});

test("coupure de connexion : le visiteur est prévenu et peut réessayer", async ({ page, context }) => {
  await simulerApi(context, "coupure");
  await remplirJusquAuxCoordonnees(page);
  await page.locator('[data-etape="2"] [data-suivant]').click();
  await remplirCoordonnees(page);
  await page.getByRole("button", { name: "Envoyer ma demande" }).click();
  await expect(page.locator("[data-statut-envoi]")).toContainText("vérifiez votre connexion");
  await expect(page.locator("[data-confirmation]")).toBeHidden();
});

test("WhatsApp reste proposé à qui préfère écrire lui-même", async ({ page, context }) => {
  const recues = await simulerApi(context);
  await context.route("https://wa.me/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>WhatsApp</title>" }));
  await remplirJusquAuxCoordonnees(page);
  await page.locator('[data-etape="2"] [data-suivant]').click();
  await remplirCoordonnees(page);
  const [fenetre] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Envoyer plutôt sur WhatsApp" }).click()]);
  expect(new URL(fenetre.url()).searchParams.get("text")).toContain("• Nom : Awa Koné");
  expect(recues).toHaveLength(0);
});

test("les mentions légales décrivent l'enregistrement des demandes", async ({ page }) => {
  await page.goto("/mentions-legales/");
  const donnees = page.locator("#donnees + p + dl");
  await expect(donnees).toContainText("enregistrée dans l'outil de gestion de l'agence");
  await expect(donnees).toContainText("empreinte de votre adresse IP");
  await expect(donnees).toContainText("supprimée, avec ses documents, 12 mois après son classement");
  await expect(donnees).toContainText("liste des véhicules");
  await expect(donnees).not.toContainText("n'enregistre rien");
});
