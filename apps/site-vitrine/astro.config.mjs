// Construction du site vitrine (ADR 0008) : des pages HTML statiques, sans script ni style inline,
// pour que la politique de sécurité du contenu (public/_headers) reste stricte.

import { defineConfig } from "astro/config";

// Adresse publique du site : canonique, aperçus de liens, plan du site.
// URL_SITE l'impose ; sur Netlify, l'adresse principale du site est fournie automatiquement.
const site = process.env.URL_SITE || (process.env.NETLIFY === "true" ? process.env.URL : undefined) || undefined;

export default defineConfig({
  site,
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
