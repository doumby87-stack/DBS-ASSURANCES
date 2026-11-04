// Parcours complet dans un vrai navigateur : première connexion du gérant (deuxième facteur, mot de passe),
// création d'un client et d'un contrat, encaissement et reçu, relance et renouvellement depuis le tableau
// des échéances, clôture de caisse, bordereau de reversement, commissions, création d'un compte.
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

  // --- Commissions : taux de la branche automobile
  await page.getByRole("link", { name: "Commissions", exact: true }).click();
  await page.getByLabel("Taux (%)").fill("12,5");
  await page.getByRole("button", { name: "Ajouter le taux" }).click();
  await expect(page.getByRole("row", { name: /Automobile/ })).toContainText("12,50 %");

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
