import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 4174, strictPort: true, proxy, headers: enTetesSecurite },
  build: { sourcemap: false, assetsInlineLimit: 0 },
});
