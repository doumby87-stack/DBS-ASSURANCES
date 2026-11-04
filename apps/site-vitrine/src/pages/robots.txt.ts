// robots.txt : tout est indexable ; le plan du site n'est annoncé que si l'adresse du site est connue.
import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const lignes = ["User-agent: *", "Allow: /"];
  if (site) lignes.push("", `Sitemap: ${new URL("/sitemap.xml", site).href}`);
  return new Response(`${lignes.join("\n")}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
