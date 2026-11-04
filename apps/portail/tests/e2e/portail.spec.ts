// Parcours d'un transporteur sur son espace entreprise, dans un vrai navigateur : connexion par code,
// tableau de bord de la flotte, attestation et attestations en lot, historique des sinistres d'un véhicule,
// accès de l'équipe, affichage sur téléphone, déconnexion. Aucune violation de la politique de sécurité du
// contenu n'est tolérée, et la flotte d'une autre entreprise n'apparaît jamais.

import { expect, test, type Page } from "@playwright/test";
import { createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const acces = JSON.parse(readFileSync(new URL("../../.e2e/acces.json", import.meta.url), "utf8"));
const CODE = "482915";

function surveillerCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  page.on("pageerror", (erreur) => violations.push(`Erreur JavaScript : ${erreur.message}`));
  return violations;
}

/**
 * Les codes partent sur WhatsApp ; ici l'API simule l'envoi. Le test remplace donc l'empreinte du dernier code
 * demandé par celle d'un code connu, calculée comme l'API (HMAC-SHA256, clé dérivée de CLE_CHIFFREMENT_DONNEES).
 */
async function poserCode(telephone: string, code: string): Promise<void> {
  const cle = Buffer.from(hkdfSync("sha256", Buffer.from(acces.cleChiffrement, "base64"), Buffer.alloc(0), "dbs:code-portail", 32));
  const empreinte = createHmac("sha256", cle).update(`${telephone}:${code}`, "utf8").digest();
  const base = new pg.Client({ connectionString: acces.urlSuperutilisateur });
  await base.connect();
  try {
    const { rowCount } = await base.query(
      `UPDATE portail.codes_connexion SET empreinte = $2
       WHERE id = (SELECT c.id FROM portail.codes_connexion c JOIN app.gestionnaires_portail g ON g.id = c.gestionnaire_id
                   WHERE g.telephone = $1 AND c.utilise_le IS NULL AND c.annule_le IS NULL ORDER BY c.cree_le DESC LIMIT 1)`,
      [telephone, empreinte],
    );
    expect(rowCount).toBe(1);
  } finally {
    await base.end();
  }
}

test("parcours du titulaire d'une entreprise sur son espace", async ({ page }) => {
  const violations = surveillerCsp(page);
  await page.goto("/");

  // --- Connexion : numéro WhatsApp, puis code
  await expect(page.getByRole("heading", { name: "Espace entreprise" })).toBeVisible();
  await page.getByLabel("Votre numéro WhatsApp").fill("07 01 02 03 04");
  await page.getByRole("button", { name: "Recevoir mon code" }).click();
  await expect(page.getByRole("status")).toContainText("Si ce numéro a un accès au portail");
  await poserCode(acces.titulaire.telephone, CODE);
  await page.getByLabel("Code reçu sur WhatsApp").fill("000000");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("alert")).toContainText("Code incorrect ou expiré");
  await page.getByLabel("Code reçu sur WhatsApp").fill(CODE);
  await page.getByRole("button", { name: "Se connecter" }).click();

  // --- Tableau de bord de la flotte
  await expect(page.getByRole("heading", { name: "Votre flotte" })).toBeVisible();
  await expect(page.getByText("Transports Kouassi & Fils")).toBeVisible();
  await expect(page.locator(".carte").filter({ hasText: "Véhicules assurés" })).toContainText("3 / 3");
  await expect(page.locator(".carte").filter({ hasText: "Documents à renouveler" })).toContainText("2");
  await expect(page.locator(".carte").filter({ hasText: "Sinistres en cours" })).toContainText("1");
  await expect(page.locator(".carte").filter({ hasText: "Reste à payer" })).toContainText(/0\sF CFA/);
  await expect(page.getByRole("row", { name: /FLT-KF-2026 · Flotte/ })).toContainText("Payé");
  const camion = page.getByRole("row", { name: /1001 KF 01/ });
  await expect(camion).toContainText("ASACI-KF-0001");
  await expect(camion).toContainText("dans 10 j");
  await expect(page.getByRole("row", { name: /1002 KF 01/ })).toContainText("dépassée");
  await expect(page.getByText("9999 AT 01")).toHaveCount(0);

  // Recherche dans la flotte
  await page.getByLabel("Rechercher un véhicule").fill("1003");
  await expect(page.getByRole("row", { name: /KF 01/ })).toHaveCount(1);
  await page.getByLabel("Rechercher un véhicule").fill("");

  // --- Attestation, puis toutes les attestations en lot, puis la liste pour Excel
  const telecharger = (selecteur: string) => page.evaluate(async (adresse) => {
    const reponse = await fetch(adresse!);
    const octets = new Uint8Array(await reponse.arrayBuffer());
    return { statut: reponse.status, type: reponse.headers.get("content-type"), debut: String.fromCharCode(...octets.slice(0, 8)), taille: octets.length };
  }, selecteur);
  const attestation = await telecharger((await page.getByRole("link", { name: /Attestation ASACI-KF-0001 de 1001 KF 01/ }).getAttribute("href"))!);
  expect(attestation).toMatchObject({ statut: 200, type: "application/pdf", debut: "%PDF-1.4", taille: Buffer.from(acces.attestation, "base64").length });
  const lot = await telecharger((await page.getByRole("link", { name: "Télécharger toutes les attestations (ZIP)" }).getAttribute("href"))!);
  expect(lot).toMatchObject({ statut: 200, type: "application/zip" });
  expect(lot.debut.startsWith("PK\u0003\u0004")).toBe(true);
  const csv = await page.evaluate(async (adresse) => (await fetch(adresse!)).text(),
    await page.getByRole("link", { name: "Exporter la liste des véhicules (Excel)" }).getAttribute("href"));
  expect(csv).toContain("1001 KF 01;Renault Trucks;;;FLT-KF-2026;ASACI-KF-0001");

  // --- Historique des sinistres d'un véhicule
  await page.getByRole("row", { name: /1002 KF 01/ }).getByRole("link", { name: "1 dont 1 en cours" }).click();
  await expect(page.getByRole("heading", { name: "1002 KF 01" })).toBeVisible();
  const historique = page.getByRole("region", { name: "Historique des sinistres" });
  await expect(historique).toContainText("Dommages matériels");
  await expect(historique).toContainText("Transmis à la compagnie");
  await expect(historique).toContainText("SAN-2026-0457");
  await expect(page.getByText("Note interne")).toHaveCount(0);
  await page.getByRole("link", { name: "Votre flotte" }).click();

  // --- Accès de l'équipe : le titulaire ajoute puis retire un collaborateur
  await page.getByRole("link", { name: "Accès de l'équipe" }).click();
  await expect(page.getByRole("row", { name: /Awa Kouassi \(vous\)/ })).toContainText("Titulaire");
  await expect(page.getByRole("row", { name: /Yao Chef de parc/ })).toContainText("Jamais");
  const ajout = page.getByRole("form", { name: "Ajouter un collaborateur" });
  await ajout.getByLabel("Nom et prénoms").fill("Fanta Comptable");
  await ajout.getByLabel("Numéro WhatsApp").fill("05 06 07 08 09");
  await ajout.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByText("Fanta Comptable peut maintenant se connecter")).toBeVisible();
  await expect(page.getByRole("row", { name: /Fanta Comptable/ })).toContainText("05 06 07 08 09");
  await page.getByRole("button", { name: "Retirer l'accès de Fanta Comptable" }).click();
  await expect(page.getByText("L'accès de Fanta Comptable est retiré")).toBeVisible();
  await expect(page.getByRole("row", { name: /Fanta Comptable/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Retirer l'accès de Awa/ })).toHaveCount(0);

  // --- Sur téléphone : rien ne déborde, le tableau de bord reste lisible
  await page.setViewportSize({ width: 360, height: 780 });
  await page.getByRole("link", { name: "Ma flotte" }).click();
  await expect(page.getByRole("heading", { name: "Votre flotte" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  // --- Déconnexion : retour à l'écran de connexion, plus aucune session
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByRole("heading", { name: "Espace entreprise" })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch("/api/portail/session")).status)).toBe(401);

  expect(violations).toEqual([]);
});

test("les en-têtes de sécurité sont envoyés et rien n'est gardé dans le navigateur", async ({ page }) => {
  const reponse = await page.goto("/");
  const enTetes = reponse!.headers();
  expect(enTetes["content-security-policy"]).toContain("default-src 'none'");
  expect(enTetes["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(enTetes["x-frame-options"]).toBe("DENY");
  expect(enTetes["referrer-policy"]).toBe("no-referrer");
  const stockage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie }));
  expect(stockage).toEqual({ local: 0, session: 0, cookies: "" });
  // Depuis une autre origine, l'API refuse la demande de code
  const autreOrigine = await page.request.post("/api/portail/connexion/code", {
    headers: { origin: "https://pirate.example" }, data: { telephone: acces.titulaire.telephone },
  });
  expect(autreOrigine.status()).toBe(403);
});
