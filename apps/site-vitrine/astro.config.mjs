// Construction du site vitrine (ADR 0008) : des pages HTML statiques, sans script ni style inline,
// pour que la politique de sécurité du contenu (public/_headers) reste stricte.

import { readFile, writeFile } from "node:fs/promises";
import { defineConfig } from "astro/config";

// Adresse publique du site : canonique, aperçus de liens, plan du site.
// URL_SITE l'impose ; sur Netlify, l'adresse principale du site est fournie automatiquement.
const site = process.env.URL_SITE || (process.env.NETLIFY === "true" ? process.env.URL : undefined) || undefined;

// Adresse de l'API qui enregistre les demandes de devis (tâche 7, src/donnees/formulaire.ts). Le site
// construit n'a le droit de contacter qu'elle : son origine est ajoutée à connect-src dans dist/_headers.
const origineApi = process.env.URL_API?.trim() ? new URL(process.env.URL_API.trim()).origin : null;

/** Ajoute « connect-src <API> » à la politique de sécurité du contenu du site construit. */
const autoriserApi = {
  name: "dbs:autoriser-api",
  hooks: {
    "astro:build:done": async ({ dir }) => {
      if (!origineApi) return;
      const fichier = new URL("_headers", dir);
      const enTetes = await readFile(fichier, "utf8");
      if (!enTetes.includes("default-src 'none';")) throw new Error("_headers : politique de sécurité du contenu introuvable");
      await writeFile(fichier, enTetes.replace("default-src 'none';", `default-src 'none'; connect-src ${origineApi};`));
    },
  },
};

export default defineConfig({
  site,
  // Dossier de sortie : dist/ (publié) ; un autre pour les tests du formulaire relié à l'API
  outDir: process.env.DOSSIER_SORTIE || "./dist",
  integrations: [autoriserApi],
  output: "static",
  trailingSlash: "always",
  compressHTML: true,
  devToolbar: { enabled: false },
  build: {
    format: "directory",
    // Feuilles de style toujours en fichiers : un <style> inline serait bloqué par la CSP
    inlineStylesheets: "never",
    assets: "ressources",
  },
  vite: {
    // Aucune ressource transformée en data: dans le code, sauf les images (img-src autorise data:)
    build: { assetsInlineLimit: 0 },
  },
});
