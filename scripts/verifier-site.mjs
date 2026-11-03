#!/usr/bin/env node
// Vérifie le site vitrine avant publication. Aucune dépendance : `node scripts/verifier-site.mjs`.
//
// Contrôles :
//  1. chaque lien interne (page, fichier, #ancre) mène à quelque chose qui existe ;
//  2. chaque image a un texte alternatif (alt) et des dimensions (width/height) ;
//  3. chaque lien qui ouvre un nouvel onglet porte rel="noopener" ;
//  4. chaque script inline est autorisé par son empreinte dans _headers (sinon il serait bloqué en ligne) ;
//  5. aucun fichier du site ne contient de secret évident (clé d'API, mot de passe, clé privée).

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE_DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(RACINE_DEPOT, "apps", "site-vitrine");

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
  const m = balise.match(new RegExp(`\\s${nom}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[2] ?? m[3]) : null;
}

function idsDe(html) {
  return new Set([...html.matchAll(/\sid\s*=\s*"([^"]+)"/g)].map((m) => m[1]));
}

const empreintesAutorisees = new Set(
  [...readFileSync(join(SITE, "_headers"), "utf8").matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((m) => m[1])
);

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const ids = idsDe(html);
  // La page 404 est servie à n'importe quelle adresse : ses liens sont absolus (/…)
  const base = page.endsWith("404.html") ? SITE : dirname(page);

  // 1. Liens internes
  for (const m of html.matchAll(/<(a|link|img|script|use)\b[^>]*>/gi)) {
    const balise = m[0];
    const cible = attribut(balise, "href") ?? attribut(balise, "src");
    if (!cible || /^(https?:|mailto:|tel:|data:)/i.test(cible)) continue;
    const [chemin, ancre] = cible.split("#");
    let fichier = page;
    if (chemin) {
      fichier = chemin.startsWith("/") ? join(SITE, chemin) : join(base, chemin);
      if (existsSync(fichier) && statSync(fichier).isDirectory()) fichier = join(fichier, "index.html");
      if (!existsSync(fichier)) { signaler(page, `lien cassé vers « ${cible} »`); continue; }
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
  for (const m of html.matchAll(/<a\b[^>]*target\s*=\s*"_blank"[^>]*>/gi)) {
    if (!/noopener|noreferrer/.test(attribut(m[0], "rel") ?? "")) signaler(page, `lien target="_blank" sans rel="noopener" : ${m[0].slice(0, 80)}…`);
  }

  // 4. Scripts inline et politique de sécurité (CSP)
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? "";
    if (/\ssrc\s*=/.test(attrs) || /application\/ld\+json/.test(attrs)) continue;
    const empreinte = "sha256-" + createHash("sha256").update(m[2], "utf8").digest("base64");
    if (!empreintesAutorisees.has(empreinte)) {
      signaler(page, `script inline non autorisé par apps/site-vitrine/_headers. Ajoutez '${empreinte}' à script-src (et retirez l'ancienne empreinte).`);
    }
  }
  if (/\sstyle\s*=\s*"/i.test(html)) signaler(page, `attribut style="…" interdit par la CSP (style-src 'self') : déplacez-le dans style.css`);
  if (/\son[a-z]+\s*=\s*"/i.test(html)) signaler(page, `gestionnaire d'événement inline (onclick=…) interdit par la CSP : utilisez main.js`);
}

// 5. Secrets
const MOTIFS_SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "clé privée"],
  [/\b(sk|pk)_(live|test)_[A-Za-z0-9]{16,}/, "clé d'API de paiement"],
  [/\bAKIA[0-9A-Z]{16}\b/, "clé d'accès AWS"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "clé d'API Google"],
  [/\b(api[_-]?key|apikey|secret|password|mot_de_passe)\b\s*[:=]\s*["'][^"']{8,}["']/i, "secret en clair"],
];
for (const f of tous.filter((f) => /\.(html|js|css|txt|json|xml|md)$/.test(f) || f.endsWith("_headers"))) {
  const contenu = readFileSync(f, "utf8");
  for (const [motif, nom] of MOTIFS_SECRETS) if (motif.test(contenu)) signaler(f, `${nom} détecté(e) : un secret ne doit jamais être publié avec le site`);
}

if (erreurs.length) {
  console.error(`✗ ${erreurs.length} problème(s) sur le site vitrine :\n- ` + erreurs.join("\n- "));
  process.exit(1);
}
console.log(`✓ Site vitrine vérifié : ${pages.length} pages, liens, images, CSP et secrets.`);
