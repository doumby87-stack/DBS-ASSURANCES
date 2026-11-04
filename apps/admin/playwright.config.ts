// Test de bout en bout : la vraie API et la version construite du back-office, avec ses en-têtes
// de sécurité, contre une base PostgreSQL de test préparée par tests/e2e/preparer.mjs.
//   npm run test:e2e -w @dbs/admin   (PGHOST, PGPORT, PGUSER, PGPASSWORD d'un serveur de test)

import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

const FICHIER_ACCES = new URL("./.e2e/acces.json", import.meta.url);
const acces = existsSync(FICHIER_ACCES) ? JSON.parse(readFileSync(FICHIER_ACCES, "utf8")) : null;
const PORT_API = 3100;
const ADRESSE = "http://localhost:4173";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: ADRESSE, trace: "retain-on-failure", locale: "fr-FR", timezoneId: "Africa/Abidjan" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: acces
    ? [
        {
          command: "node ../api/dist/serveur.js",
          url: `http://127.0.0.1:${PORT_API}/sante`,
          reuseExistingServer: false,
          env: {
            NODE_ENV: "test",
            PORT: String(PORT_API),
            DATABASE_URL: acces.urlApplication,
            CLE_CHIFFREMENT_DONNEES: acces.cleChiffrement,
            URL_BACK_OFFICE: ADRESSE,
            VERIFIER_MOTS_DE_PASSE_DIVULGUES: "false",
            NIVEAU_JOURNAL: "warn",
          },
        },
        {
          command: "npx vite preview",
          url: ADRESSE,
          reuseExistingServer: false,
          env: { API_URL: `http://127.0.0.1:${PORT_API}` },
        },
      ]
    : [],
});
