// Sert le site construit (dist/) comme l'hébergeur : mêmes en-têtes de sécurité (dist/_headers),
// pages en dossiers, page 404. Pour l'aperçu local et les tests du navigateur, sans dépendance.
//   node tests/serveur.mjs [port] [dossier]   (dossier construit, dist par défaut)

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(fileURLToPath(new URL(`../${process.argv[3] ?? "dist"}/`, import.meta.url)));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4321);
// 127.0.0.1 par défaut ; 0.0.0.0 dans le conteneur de la démonstration (demo/compose.yml), publié sur 127.0.0.1 seulement
const HOTE = process.env.HOTE ?? "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".json": "application/json",
};

/** En-têtes du bloc « /* » de _headers (format Netlify et Cloudflare Pages). */
function enTetes() {
  const fichier = join(DIST, "_headers");
  if (!existsSync(fichier)) return {};
  const resultat = {};
  let dansLeBloc = false;
  for (const ligne of readFileSync(fichier, "utf8").split("\n")) {
    if (/^\S/.test(ligne) && !ligne.startsWith("#")) dansLeBloc = ligne.trim() === "/*";
    else if (dansLeBloc && /^\s+[\w-]+:/.test(ligne)) {
      const [nom, ...valeur] = ligne.trim().split(":");
      resultat[nom] = valeur.join(":").trim();
    }
  }
  return resultat;
}

createServer((requete, reponse) => {
  const chemin = decodeURIComponent(new URL(requete.url ?? "/", "http://localhost").pathname);
  let fichier = normalize(join(DIST, chemin));
  if (fichier !== DIST && !fichier.startsWith(DIST + sep)) fichier = join(DIST, "404.html");
  if (existsSync(fichier) && statSync(fichier).isDirectory()) fichier = join(fichier, "index.html");
  let statut = 200;
  if (!existsSync(fichier)) {
    statut = 404;
    fichier = join(DIST, "404.html");
  }
  reponse.writeHead(statut, { ...enTetes(), "Content-Type": TYPES[extname(fichier)] ?? "application/octet-stream" });
  reponse.end(readFileSync(fichier));
}).listen(PORT, HOTE, () => console.log(`Site servi sur http://${HOTE}:${PORT}`));
