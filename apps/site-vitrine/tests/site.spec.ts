// Le site vitrine dans le navigateur : chaque page s'affiche sans erreur ni violation de la politique de
// sécurité (CSP), respecte les règles d'accessibilité WCAG 2.1 AA (axe-core), tient dans un écran de
// téléphone, et le formulaire de devis prépare le bon message.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PAGES = [
  "/",
  "/particuliers/",
  "/professionnels/",
  "/flottes/",
  "/sinistre/",
  "/agence/",
  "/questions-frequentes/",
  "/devis/",
  "/mentions-legales/",
];

/** Erreurs de la console (dont les violations de CSP) et exceptions JavaScript de la page. */
function surveillerErreurs(page: Page): string[] {
  const erreurs: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") erreurs.push(message.text());
  });
  page.on("pageerror", (erreur) => erreurs.push(erreur.message));
  return erreurs;
}

test.describe("chaque page", () => {
  for (const chemin of PAGES) {
    test(`${chemin} s'affiche, sans erreur ni défaut d'accessibilité`, async ({ page }) => {
      const erreurs = surveillerErreurs(page);
      const reponse = await page.goto(chemin);
      expect(reponse?.status()).toBe(200);
      expect(reponse?.headers()["content-security-policy"]).toContain("default-src 'none'");
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page).toHaveTitle(/DBS-ASSURANCES/);

      const analyse = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const violations = analyse.violations.map((v) => `${v.id} (${v.impact}) : ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
      expect(violations).toEqual([]);
      expect(erreurs).toEqual([]);
    });
  }

  test("une adresse inconnue renvoie la page 404, non référencée", async ({ page }) => {
    const reponse = await page.goto("/cette-page-n-existe-pas/");
    expect(reponse?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });
});

test("aucune page ne déborde horizontalement sur un petit téléphone (360 px)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const chemin of PAGES) {
    await page.goto(chemin);
    const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(largeur, chemin).toBeLessThanOrEqual(360);
  }
});

test("le menu mobile s'ouvre, garde le focus et se ferme avec Échap", async ({ page, isMobile }) => {
  test.skip(!isMobile, "menu réservé aux petits écrans");
  await page.goto("/");
  const bouton = page.locator("[data-bouton-menu]");
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#menu-mobile")).toBeVisible();
  await expect(page.locator("#menu-mobile a").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#menu-mobile")).toBeHidden();
  await expect(bouton).toBeFocused();
});

test.describe("formulaire de devis", () => {
  test("l'assurance et le profil sont présélectionnés depuis une page d'offre", async ({ page }) => {
    await page.goto("/particuliers/");
    await page.locator('a[href="/devis/?assurance=habitation"]').first().click();
    await expect(page).toHaveURL(/\/devis\/\?assurance=habitation$/);
    await expect(page.locator('input[name="assurance"][value="habitation"]')).toBeChecked();
    await page.goto("/devis/?assurance=flotte&profil=entreprise");
    await expect(page.locator('input[name="assurance"][value="flotte"]')).toBeChecked();
    await expect(page.locator('input[name="profil"][value="Entreprise"]')).toBeChecked();
  });

  test("parcours complet jusqu'au message WhatsApp pré-rempli", async ({ page, context }) => {
    const erreurs = surveillerErreurs(page);
    await context.route("https://wa.me/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>WhatsApp</title>" }));
    await page.goto("/devis/");
    const etape = (n: number) => page.locator(`[data-etape="${n}"]`);

    // Étape 1 : il faut choisir une assurance
    await expect(etape(2)).toBeHidden();
    await etape(1).getByRole("button", { name: "Continuer" }).click();
    await expect(page.locator("#erreur-assurance")).toHaveText(/Choisissez l'assurance/);
    await etape(1).getByText("Automobile", { exact: true }).click();
    await expect(page.locator("#erreur-assurance")).toBeEmpty();
    await etape(1).getByText("Un professionnel").click();
    await etape(1).getByRole("button", { name: "Continuer" }).click();

    // Étape 2 : l'aide dépend de l'assurance choisie
    await expect(etape(2)).toBeVisible();
    await expect(etape(2)).toBeFocused();
    await expect(page.locator("[data-aide-besoin]")).toContainText("puissance fiscale");
    await page.getByLabel("Votre besoin").fill("Toyota Corolla 2019, livraisons.");
    await page.getByLabel("Commune ou ville").fill("Yopougon");
    await etape(2).getByRole("button", { name: "Continuer" }).click();

    // Étape 3 : récapitulatif, puis coordonnées vérifiées
    await expect(page.locator("[data-recapitulatif]")).toContainText("Automobile");
    await expect(page.locator("[data-recapitulatif]")).toContainText("Professionnel");
    await page.getByRole("button", { name: "Envoyer sur WhatsApp" }).click();
    await expect(page.locator("#erreur-nom")).not.toBeEmpty();
    await expect(page.locator("#erreur-telephone")).not.toBeEmpty();
    await expect(page.locator("#erreur-consentement")).not.toBeEmpty();
    await expect(page.getByLabel(/Nom et prénoms/)).toBeFocused();

    await page.getByLabel(/Nom et prénoms/).fill("Exemple Transport");
    await page.getByLabel(/Téléphone/).fill("07 12");
    await page.getByLabel(/^E-mail/).fill("exemple@");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Envoyer sur WhatsApp" }).click();
    await expect(page.locator("#erreur-telephone")).toContainText("10 chiffres");
    await expect(page.locator("#erreur-email")).toContainText("incomplète");

    await page.getByLabel(/Téléphone/).fill("+225 07 00 00 00 00");
    await page.getByLabel(/^E-mail/).fill("");
    const [fenetre] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Envoyer sur WhatsApp" }).click()]);
    const adresse = new URL(fenetre.url());
    expect(adresse.origin + adresse.pathname).toBe("https://wa.me/2250749360702");
    const message = adresse.searchParams.get("text") ?? "";
    expect(message).toContain("• Assurance : Automobile");
    expect(message).toContain("• Profil : Professionnel");
    expect(message).toContain("• Nom : Exemple Transport");
    expect(message).toContain("• Téléphone : +225 07 00 00 00 00");
    expect(message).toContain("• Commune / ville : Yopougon");
    expect(message).toContain("Toyota Corolla 2019, livraisons.");
    expect(message).not.toContain("E-mail");
    await expect(page.locator("[data-statut-envoi]")).toContainText("WhatsApp s'ouvre");
    expect(erreurs).toEqual([]);
  });

  test("Retour et Modifier ramènent aux étapes précédentes sans perdre la saisie", async ({ page }) => {
    await page.goto("/devis/?assurance=agricole");
    await page.locator('[data-etape="1"] [data-suivant]').click();
    await page.getByLabel("Votre besoin").fill("Cacao, 12 hectares");
    await page.locator('[data-etape="2"] [data-suivant]').click();
    await page.getByRole("button", { name: "Modifier" }).click();
    await expect(page.locator('[data-etape="1"]')).toBeVisible();
    await expect(page.locator('input[value="agricole"]')).toBeChecked();
    await page.locator('[data-etape="1"] [data-suivant]').click();
    await expect(page.getByLabel("Votre besoin")).toHaveValue("Cacao, 12 hectares");
    await page.locator('[data-etape="2"] [data-precedent]').click();
    await expect(page.locator('[data-etape="1"]')).toBeVisible();
  });
});

test.describe("sans JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("le formulaire de devis laisse place aux coordonnées directes", async ({ page }) => {
    await page.goto("/devis/");
    await expect(page.locator("[data-etape]:visible")).toHaveCount(0);
    // Playwright ignore le texte des balises <noscript> dans getByText : on cible le bloc lui-même
    await expect(page.locator(".sans-js h2")).toHaveText("Ce formulaire a besoin de JavaScript");
    await expect(page.locator(".sans-js a[href^='tel:']")).toBeVisible();
  });

  test("les questions fréquentes restent lisibles", async ({ page }) => {
    await page.goto("/questions-frequentes/");
    await page.locator("summary").first().click();
    await expect(page.locator("details").first()).toHaveAttribute("open", "");
  });
});
