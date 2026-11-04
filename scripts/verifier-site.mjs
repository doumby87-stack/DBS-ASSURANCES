#!/usr/bin/env node
// Vérifie le site vitrine construit (apps/site-vitrine/dist) avant publication. Aucune dépendance :
//   npm run build -w @dbs/site-vitrine && node scripts/verifier-site.mjs [dossier construit]
//
// Contrôles, sur les fichiers réellement publiés :
//  1. chaque lien interne (page, fichier, #ancre) mène à quelque chose qui existe ;
//  2. chaque image a un texte alternatif (alt) et des dimensions (width/height) ;
//  3. chaque lien qui ouvre un nouvel onglet porte rel="noopener" ;
//  4. rien ne serait bloqué par la politique de sécurité du contenu (_headers) : ni script ou style inline,
//     ni attribut style="…" ou onclick="…", ni ressource chargée depuis un autre site ; un formulaire relié
//     à l'API (data-api, tâche 7) n'est accepté que si _headers autorise cette API (connect-src) ;
//  5. chaque page a un titre, une description, une langue et un seul titre principal (h1) ;
//  6. aucun fichier publié ne contient de secret évident (clé d'API, mot de passe, clé privée).

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE_DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = resolve(RACINE_DEPOT, process.argv[2] ?? join("apps", "site-vitrine", "dist"));

if (!existsSync(join(SITE, "index.html"))) {
  console.error("✗ Site vitrine non construit. Lancez d'abord : npm run build -w @dbs/site-vitrine");
  process.exit(1);
}

const erreurs = [];
const signaler = (fichier, message) => erreurs.push(`${relative(RACINE_DEPOT, fichier)} : ${message}`);

function fichiers(dossier) {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name);
    return e.isDirectory() ? fichiers(chemin) : [chemin];
  });
}

const tous = fichiers(SITE);
const pages = tous.filter((f) => f.endsWith(".html"));

function attribut(balise, nom) {
  const m = balise.match(new RegExp(`\\s${nom}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
}

function idsDe(html) {
  return new Set([...html.matchAll(/\sid\s*=\s*"?([^"\s>]+)"?/g)].map((m) => m[1]));
}

const enTetes = existsSync(join(SITE, "_headers")) ? readFileSync(join(SITE, "_headers"), "utf8") : "";
if (!/Content-Security-Policy:/.test(enTetes)) signaler(join(SITE, "_headers"), "fichier absent ou sans Content-Security-Policy");
const empreintesAutorisees = new Set([...enTetes.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((m) => m[1]));

/** Fichier publié correspondant à une adresse du site (« /devis/ » → dist/devis/index.html). */
function fichierCible(page, chemin) {
  const brut = decodeURI(chemin.split("?")[0]);
  if (!brut) return page;
  let fichier = brut.startsWith("/") ? join(SITE, brut) : join(dirname(page), brut);
  if (existsSync(fichier) && statSync(fichier).isDirectory()) fichier = join(fichier, "index.html");
  return existsSync(fichier) ? fichier : null;
}

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const ids = idsDe(html);

  // 1. Liens internes et 4. ressources tierces
  for (const m of html.matchAll(/<(a|link|img|script|source|iframe)\b[^>]*>/gi)) {
    const balise = m[0];
    const type = m[1].toLowerCase();
    const cible = attribut(balise, "href") ?? attribut(balise, "src");
    if (!cible) continue;
    if (/^(https?:)?\/\//i.test(cible)) {
      // Un lien <a> peut pointer ailleurs ; une ressource chargée par la page, non (CSP « 'self' »)
      const estRessource = type !== "a" && !(type === "link" && /^(canonical|alternate)$/i.test(attribut(balise, "rel") ?? ""));
      if (estRessource) signaler(page, `ressource chargée depuis un autre site, bloquée par la CSP : ${balise.slice(0, 100)}…`);
      continue;
    }
    if (/^(mailto:|tel:|data:)/i.test(cible)) continue;
    const [chemin, ancre] = cible.split("#");
    const fichier = fichierCible(page, chemin);
    if (!fichier) {
      signaler(page, `lien cassé vers « ${cible} »`);
      continue;
    }
    if (ancre && fichier.endsWith(".html")) {
      const cibleIds = fichier === page ? ids : idsDe(readFileSync(fichier, "utf8"));
      if (!cibleIds.has(ancre)) signaler(page, `ancre introuvable « ${cible} »`);
    }
  }

  // 2. Images
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const balise = m[0];
    if (attribut(balise, "alt") === null) signaler(page, `image sans attribut alt : ${balise.slice(0, 80)}…`);
    if (!attribut(balise, "width") || !attribut(balise, "height")) signaler(page, `image sans width/height : ${balise.slice(0, 80)}…`);
  }

  // 3. Nouvel onglet
  for (const m of html.matchAll(/<a\b[^>]*target\s*=\s*"?_blank"?[^>]*>/gi)) {
    if (!/noopener|noreferrer/.test(attribut(m[0], "rel") ?? "")) signaler(page, `lien target="_blank" sans rel="noopener" : ${m[0].slice(0, 80)}…`);
  }

  // 4. Politique de sécurité du contenu (CSP)
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? "";
    if (/\ssrc\s*=/.test(attrs) || /application\/ld\+json/.test(attrs)) continue;
    const empreinte = "sha256-" + createHash("sha256").update(m[2], "utf8").digest("base64");
    if (!empreintesAutorisees.has(empreinte)) {
      signaler(page, `script inline bloqué par la CSP : placez-le dans src/scripts/ et importez-le depuis un composant`);
    }
  }
  if (/<style[\s>]/i.test(html)) signaler(page, `balise <style> inline bloquée par la CSP (style-src 'self') : utilisez src/styles/global.css`);
  if (/\sstyle\s*=\s*["']/i.test(html)) signaler(page, `attribut style="…" bloqué par la CSP : utilisez une classe de src/styles/global.css`);
  if (/<[^>]+\son[a-z]+\s*=\s*["']/i.test(html)) signaler(page, `gestionnaire d'événement inline (onclick=…) bloqué par la CSP : utilisez un script de src/scripts/`);
  for (const m of html.matchAll(/\sdata-api="([^"]+)"/g)) {
    const origine = new URL(m[1]).origin;
    if (!new RegExp(`connect-src [^;]*${origine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(;|\\s|$)`, "m").test(enTetes)) {
      signaler(page, `le formulaire envoie à ${origine}, que _headers n'autorise pas (connect-src) : il serait bloqué en ligne`);
    }
  }

  // 5. Référencement et accessibilité de base
  if (!/<html[^>]*\slang="fr"/i.test(html)) signaler(page, `langue de la page absente (<html lang="fr">)`);
  if (!/<title>[^<]{10,}<\/title>/i.test(html)) signaler(page, `titre de page (<title>) absent ou trop court`);
  if (!/<meta name="description" content="[^"]{50,}"/i.test(html)) signaler(page, `description (meta description) absente ou trop courte`);
  const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (h1 !== 1) signaler(page, `${h1} titres principaux (h1) au lieu d'un seul`);
}

// 6. Secrets
const MOTIFS_SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "clé privée"],
  [/\b(sk|pk)_(live|test)_[A-Za-z0-9]{16,}/, "clé d'API de paiement"],
  [/\bAKIA[0-9A-Z]{16}\b/, "clé d'accès AWS"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "clé d'API Google"],
  [/\bEAA[A-Za-z0-9]{40,}/, "jeton d'accès Meta (WhatsApp)"],
  [/\b(api[_-]?key|apikey|secret|password|mot_de_passe|token|jeton)\b\s*[:=]\s*["'][^"']{8,}["']/i, "secret en clair"],
];
for (const f of tous.filter((f) => /\.(html|js|css|txt|json|xml|md|svg)$/.test(f) || f.endsWith("_headers"))) {
  const contenu = readFileSync(f, "utf8");
  for (const [motif, nom] of MOTIFS_SECRETS) if (motif.test(contenu)) signaler(f, `${nom} détecté(e) : un secret ne doit jamais être publié avec le site`);
}

if (erreurs.length) {
  console.error(`✗ ${erreurs.length} problème(s) sur le site vitrine :\n- ` + erreurs.join("\n- "));
  process.exit(1);
}
console.log(`✓ Site vitrine vérifié : ${pages.length} pages, liens, images, CSP, référencement et secrets.`);
