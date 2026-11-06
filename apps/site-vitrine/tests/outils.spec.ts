// Outils du site (tâche 13) : rappel d'échéance, assistant « appel d'offres », demande de rendez-vous.
// Sans API (dist/) : contrôles, dossier calculé, fichier d'agenda, message WhatsApp pré-rempli.
// Avec API (dist-avec-api/, API simulée) : ce que le navigateur envoie, et la confirmation affichée.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const FETES = ["01-01", "05-01", "08-07", "08-15", "11-01", "11-15", "12-25"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dans = (jours: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + jours);
};
/** Premier jour ouvré à partir de dans(n) */
function jourOuvre(n: number): string {
  for (let i = n; ; i += 1) {
    const d = dans(i);
    if (d.getDay() >= 1 && d.getDay() <= 5 && !FETES.includes(iso(d).slice(5))) return iso(d);
  }
}
function dimanche(): string {
  for (let i = 1; ; i += 1) if (dans(i).getDay() === 0) return iso(dans(i));
}

function surveillerErreurs(page: Page): string[] {
  const erreurs: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erreurs.push(m.text());
  });
  page.on("pageerror", (e) => erreurs.push(e.message));
  return erreurs;
}

async function coordonnees(page: Page) {
  await page.getByLabel(/Nom et prénoms/).fill("Awa Koné");
  await page.getByLabel(/Téléphone/).fill("07 12 34 56 78");
  await page.getByRole("checkbox", { name: /J'accepte que DBS-ASSURANCES/ }).check();
}

async function messageWhatsApp(page: Page, context: BrowserContext): Promise<string> {
  await context.route("https://wa.me/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>WhatsApp</title>" }));
  const [fenetre] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Envoyer sur WhatsApp" }).click()]);
  const adresse = new URL(fenetre.url());
  expect(adresse.origin + adresse.pathname).toBe("https://wa.me/2250749360702");
  return adresse.searchParams.get("text") ?? "";
}

test.describe("sans API : tout se prépare dans le navigateur", () => {
  test("rendez-vous : jour ouvré exigé, visite réservée aux professionnels, puis message WhatsApp", async ({ page, context }) => {
    const erreurs = surveillerErreurs(page);
    await page.goto("/rendez-vous/?motif=sinistre");
    await expect(page.getByLabel("C'est pour *")).toHaveValue("sinistre");
    await page.getByLabel("Jour souhaité *").fill(dimanche());
    await page.getByText("Dans vos locaux ou sur votre chantier", { exact: true }).click();
    await coordonnees(page);
    await page.getByRole("button", { name: "Envoyer sur WhatsApp" }).click();
    await expect(page.locator("#erreur-jour")).toContainText("du lundi au vendredi");
    await expect(page.locator("#erreur-mode")).toContainText("professionnels");
    await expect(page.getByLabel("Jour souhaité *")).toBeFocused();

    const jour = jourOuvre(3);
    await page.getByLabel("Jour souhaité *").fill(jour);
    await page.locator("fieldset").filter({ hasText: "Vous êtes" }).getByText("Une entreprise").click();
    await page.getByText("L'après-midi").click();
    await page.getByLabel(/Quelques mots/).fill("Accident d'un camion de livraison.");
    const message = await messageWhatsApp(page, context);
    expect(message).toContain("Je souhaite un rendez-vous pour un sinistre.");
    expect(message).toContain("l'après-midi");
    expect(message).toContain("• Où : Dans vos locaux ou sur votre chantier");
    expect(message).toContain("• Profil : Une entreprise");
    expect(message).toContain("Accident d'un camion de livraison.");
    expect(erreurs).toEqual([]);
  });

  test("appel d'offres : le dossier à préparer et la date pour l'envoyer suivent la saisie", async ({ page, context }) => {
    const erreurs = surveillerErreurs(page);
    await page.goto("/appel-offres/");
    const dossier = page.locator("[data-dossier]");
    await expect(dossier).toBeHidden();
    await page.getByRole("button", { name: "Envoyer sur WhatsApp" }).click();
    await expect(page.locator("#erreur-garanties")).toContainText("Cochez au moins une assurance");
    await expect(page.locator("#erreur-dateLimite")).not.toBeEmpty();

    await page.getByLabel(/Qui lance l'appel d'offres/).fill("Mairie de Bouaké");
    await page.getByLabel(/Objet du marché/).fill("Réfection de la voirie");
    await page.getByLabel(/Montant estimé/).fill("150 000 000");
    await page.getByLabel(/Date limite de dépôt/).fill(iso(dans(40)));
    await page.getByRole("checkbox", { name: /Tous risques chantier/ }).check();
    await expect(dossier).toBeVisible();
    await expect(dossier).toContainText("Envoyez-nous votre dossier au plus tard le");
    await expect(dossier).toContainText("Montant et nature des travaux (Tous risques chantier (TRC))");
    await expect(dossier).toContainText("RCCM et compte contribuable");

    await page.getByLabel(/Date limite de dépôt/).fill(iso(dans(2)));
    await expect(dossier).toContainText("Délai serré : appelez-nous aujourd'hui");

    await coordonnees(page);
    const message = await messageWhatsApp(page, context);
    expect(message).toContain("• Maître d'ouvrage : Mairie de Bouaké");
    expect(message).toContain("• Montant estimé : 150 000 000 F CFA");
    expect(message).toContain("• Assurances demandées : Tous risques chantier (TRC)");
    expect(erreurs).toEqual([]);
  });

  test("rappel : l'échéance s'ajoute à l'agenda du visiteur, sans rien envoyer", async ({ page }) => {
    const erreurs = surveillerErreurs(page);
    await page.goto("/rappel-echeance/");
    await page.getByRole("button", { name: "Ajouter le rappel à mon agenda" }).click();
    await expect(page.locator("#erreur-echeance")).not.toBeEmpty();
    await page.getByLabel("Date d'échéance *").fill(iso(dans(100)));
    const [telechargement] = await Promise.all([
      page.waitForEvent("download"), page.getByRole("button", { name: "Ajouter le rappel à mon agenda" }).click(),
    ]);
    expect(telechargement.suggestedFilename()).toBe("rappel-echeance-assurance.ics");
    const contenu = await (await telechargement.createReadStream()).toArray();
    const ics = Buffer.concat(contenu).toString("utf8");
    expect(ics).toContain(`DTSTART;VALUE=DATE:${iso(dans(70)).replace(/-/g, "")}`);
    expect(ics).toContain("SUMMARY:Renouveler mon assurance automobile");
    await expect(page.locator("[data-statut-envoi]")).toContainText("Rappel ajouté à votre agenda");
    expect(erreurs).toEqual([]);
  });
});

test.describe("avec l'API de l'agence", () => {
  test.use({ baseURL: "http://localhost:4322" });

  /** API simulée pour une route : répond à la requête préalable (CORS) et garde chaque demande reçue */
  async function simulerApi(context: BrowserContext, chemin: string, corps: object) {
    const recues: Record<string, unknown>[] = [];
    await context.route(`**${chemin}`, async (route) => {
      const requete = route.request();
      const cors = { "access-control-allow-origin": (await requete.headerValue("origin")) ?? "", vary: "Origin" };
      if (requete.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: { ...cors, "access-control-allow-methods": "POST", "access-control-allow-headers": "Content-Type" } });
        return;
      }
      recues.push(requete.postDataJSON());
      await route.fulfill({ status: 201, headers: cors, contentType: "application/json", body: JSON.stringify(corps) });
    });
    return recues;
  }

  test("rappel d'échéance enregistré, avec la date du rappel", async ({ page, context }) => {
    const erreurs = surveillerErreurs(page);
    const recues = await simulerApi(context, "/site/rappels-echeance", { numero: 77, aTraiterLe: iso(dans(70)) });
    await page.goto("/rappel-echeance/?assurance=habitation");
    await page.getByLabel("Date d'échéance *").fill(iso(dans(100)));
    await coordonnees(page);
    await page.getByRole("checkbox", { name: /rappels de l'agence/ }).check();
    await page.getByRole("button", { name: "Programmer mon rappel" }).click();
    const confirmation = page.locator("[data-confirmation]");
    await expect(confirmation).toBeFocused();
    await expect(confirmation.getByRole("heading")).toHaveText("Rappel programmé (n° 77)");
    await expect(confirmation.locator("[data-confirmation-date]")).not.toHaveText(/mois précédant/);
    expect(recues).toEqual([{
      profil: "particulier", nom: "Awa Koné", telephone: "07 12 34 56 78", assurance: "habitation", echeance: iso(dans(100)),
      accordTraitement: "J'accepte que DBS-ASSURANCES garde ces informations jusqu'à mon échéance, pour me rappeler et me proposer un devis.",
      accordWhatsApp: "J'accepte de recevoir sur WhatsApp les rappels de l'agence (échéances, suivi de mon dossier). Je pourrai répondre STOP à tout moment.",
    }]);
    expect(erreurs).toEqual([]);
  });

  test("appel d'offres et rendez-vous enregistrés tels que saisis", async ({ page, context }) => {
    const erreurs = surveillerErreurs(page);
    const appels = await simulerApi(context, "/site/appels-offres", { numero: 78 });
    await page.goto("/appel-offres/");
    await page.getByLabel(/Type de marché/).selectOption("fournitures");
    await page.getByLabel(/Qui lance l'appel d'offres/).fill("Ministère de la Santé");
    await page.getByLabel(/Objet du marché/).fill("Fourniture de lits");
    await page.getByLabel(/Durée, en mois/).fill("6");
    await page.getByLabel(/Date limite de dépôt/).fill(iso(dans(30)));
    await page.getByRole("checkbox", { name: /Transport des fournitures/ }).check();
    await page.getByRole("checkbox", { name: /responsabilité civile professionnelle/i }).check();
    await coordonnees(page);
    await page.getByRole("button", { name: "Envoyer à l'agence" }).click();
    await expect(page.locator("[data-confirmation]").getByRole("heading")).toHaveText("Demande enregistrée (n° 78)");
    expect(appels).toEqual([{
      profil: "entreprise", nom: "Awa Koné", telephone: "07 12 34 56 78",
      accordTraitement: "J'accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.",
      dateLimite: iso(dans(30)),
      marche: { typeMarche: "fournitures", maitreOuvrage: "Ministère de la Santé", objet: "Fourniture de lits", dureeMois: 6 },
      garanties: ["rc_pro", "transport"],
    }]);

    const rendezVous = await simulerApi(context, "/site/rendez-vous", { numero: 79 });
    const jour = jourOuvre(2);
    await page.goto("/rendez-vous/");
    await page.getByLabel("Jour souhaité *").fill(jour);
    await coordonnees(page);
    await page.getByRole("button", { name: "Demander ce rendez-vous" }).click();
    await expect(page.locator("[data-confirmation]").getByRole("heading")).toHaveText("Demande de rendez-vous reçue (n° 79)");
    expect(rendezVous).toEqual([{
      profil: "particulier", nom: "Awa Koné", telephone: "07 12 34 56 78",
      accordTraitement: "J'accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.",
      motif: "devis", mode: "agence", jour, creneau: "matin",
    }]);
    expect(erreurs).toEqual([]);
  });
});
