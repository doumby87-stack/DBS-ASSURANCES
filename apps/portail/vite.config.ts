import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Comme le back-office : le portail et l'API sont servis sous la même adresse, l'API derrière /api
// (apps/portail/README.md). Ici, Vite joue ce rôle de proxy et retire le préfixe /api.
const api = process.env.API_URL ?? "http://127.0.0.1:3000";
const proxy = {
  "/api": { target: api, rewrite: (chemin: string) => chemin.replace(/^\/api/, "") },
};

// Mêmes en-têtes qu'en production (apps/portail/README.md), appliqués à la version construite (vite preview)
const enTetesSecurite = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

// Démonstration (demo/lanceur.mjs) : l'API n'accepte les connexions que depuis une seule adresse (URL_BACK_OFFICE,
// URL_PORTAIL). Avec ADRESSE_PUBLIQUE, une autre adresse du même ordinateur (http://127.0.0.1:…) y est renvoyée.
const adressePublique = process.env.ADRESSE_PUBLIQUE ? new URL(process.env.ADRESSE_PUBLIQUE) : null;
const redirectionAdressePublique: Plugin = {
  name: "dbs:adresse-publique",
  configurePreviewServer(serveur) {
    if (!adressePublique) return;
    serveur.middlewares.use((requete, reponse, suite) => {
      if (requete.headers.host === adressePublique.host) return suite();
      const chemin = requete.url?.startsWith("/") ? requete.url : "/";
      reponse.writeHead(307, { Location: `${adressePublique.origin}${chemin}` }).end();
    });
  },
};

export default defineConfig({
  plugins: [react(), redirectionAdressePublique],
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 4174, strictPort: true, proxy, headers: enTetesSecurite },
  build: { sourcemap: false, assetsInlineLimit: 0 },
});
