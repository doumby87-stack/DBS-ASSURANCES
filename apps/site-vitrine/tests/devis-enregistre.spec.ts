// Formulaire de devis relié à l'API de l'agence (tâche 7), sur la version construite avec URL_API
// (tests/construire.mjs). L'API est simulée : on vérifie ce que le navigateur envoie, que la politique de
// sécurité du contenu l'autorise, et ce que voit le visiteur dans chaque cas (succès, refus, coupure).

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.use({ baseURL: "http://localhost:4322" });

const ACCORD = "J'accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.";
// Plus petit PNG valide (1 × 1 pixel)
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

test("la demande est enregistrée avec la carte grise et l'accord WhatsApp, puis confirmée", async ({ page, context }) => {
  const erreurs = surveillerErreurs(page);
  const recues = await simulerApi(context);
  const reponse = await page.goto("/devis/?assurance=automobile");
  expect(reponse?.headers()["content-security-policy"]).toContain("connect-src http://api.dbs.test");

  await page.locator('[data-etape="1"] [data-suivant]').click();
  await expect(page.getByLabel(/Carte grise/)).toBeVisible();
  await page.getByLabel("Votre besoin").fill("Toyota Corolla 2019");
  await page.getByLabel(/Carte grise/).setInputFiles({ name: "carte-grise.png", mimeType: "image/png", buffer: PNG });
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
    besoin: "Toyota Corolla 2019",
    accordTraitement: ACCORD,
    accordWhatsApp: expect.stringMatching(/^J'accepte de recevoir sur WhatsApp les rappels de l'agence/),
    piece: { type: "image/png", contenu: PNG.toString("base64") },
  });

  const analyse = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(analyse.violations.map((v) => v.id)).toEqual([]);
  expect(erreurs).toEqual([]);
});

test("la carte grise n'est proposée que pour un véhicule, et vérifiée avant l'envoi", async ({ page }) => {
  await remplirJusquAuxCoordonnees(page, "habitation");
  await expect(page.getByLabel(/Carte grise/)).toBeHidden();

  await remplirJusquAuxCoordonnees(page, "deux_roues");
  await page.getByLabel(/Carte grise/).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("texte") });
  await expect(page.locator("#erreur-carte-grise")).toHaveText("Choisissez une photo (JPEG ou PNG) ou un PDF.");
  await page.locator('[data-etape="2"] [data-suivant]').click();
  await expect(page.locator('[data-etape="2"]')).toBeVisible();

  await page.getByLabel(/Carte grise/).setInputFiles({ name: "lourde.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(page.locator("#erreur-carte-grise")).toContainText("dépasse 5 Mo");
  await page.getByLabel(/Carte grise/).setInputFiles([]);
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
  await expect(donnees).toContainText("supprimée, avec sa carte grise, 12 mois après son classement");
  await expect(donnees).not.toContainText("n'enregistre rien");
});
