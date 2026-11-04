// Plan du site pour les moteurs de recherche. Il exige des adresses complètes : sans adresse du site
// connue (astro.config.mjs), il reste vide et n'est pas annoncé dans robots.txt.
import type { APIRoute } from "astro";

const PAGES = ["/", "/particuliers/", "/professionnels/", "/flottes/", "/sinistre/", "/devis/", "/agence/", "/questions-frequentes/", "/mentions-legales/"];

export const GET: APIRoute = ({ site }) => {
  const urls = site ? PAGES.map((page) => `  <url><loc>${new URL(page, site).href}</loc></url>`) : [];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
