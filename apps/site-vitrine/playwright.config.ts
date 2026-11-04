// Tests du site vitrine dans un vrai navigateur, sur la version construite (dist/) servie avec ses
// en-têtes de sécurité (tests/serveur.mjs) : toute violation de la CSP apparaît comme une erreur.
//   npm run test:navigateur -w @dbs/site-vitrine   (construit les deux versions, puis lance les tests)
// CHEMIN_CHROMIUM permet d'utiliser un Chromium déjà installé au lieu de « npx playwright install ».

import { defineConfig, devices } from "@playwright/test";

const PORT = 4321;
const chromium = process.env.CHEMIN_CHROMIUM ? { launchOptions: { executablePath: process.env.CHEMIN_CHROMIUM } } : {};

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "fr-FR", trace: "retain-on-failure", ...chromium },
  projects: [
    { name: "ordinateur", use: { ...devices["Desktop Chrome"], ...chromium } },
    { name: "telephone", use: { ...devices["Pixel 7"], ...chromium } },
  ],
  // dist/ : le site publié ; dist-avec-api/ : formulaire relié à une API fictive (tests/construire.mjs)
  webServer: [
    { command: `node tests/serveur.mjs ${PORT}`, url: `http://localhost:${PORT}/`, reuseExistingServer: false },
    { command: `node tests/serveur.mjs ${PORT + 1} dist-avec-api`, url: `http://localhost:${PORT + 1}/`, reuseExistingServer: false },
  ],
});
