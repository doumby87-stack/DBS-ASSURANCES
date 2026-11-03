#!/usr/bin/env node
// Vérifie les liens internes de toute la documentation Markdown du dépôt :
// chaque [texte](chemin) et [texte](chemin#titre) doit mener à un fichier et à un titre qui existent.
// Aucune dépendance : `node scripts/verifier-liens-docs.mjs`.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORES = new Set([".git", "node_modules", "dist", "build", "coverage"]);

function fichiersMarkdown(dossier) {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    if (IGNORES.has(e.name)) return [];
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) return fichiersMarkdown(chemin);
    return e.name.endsWith(".md") ? [chemin] : [];
  });
}

// Même règle que GitHub pour les ancres des titres
function ancre(titre) {
  return titre
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

function ancresDe(fichier) {
  const texte = readFileSync(fichier, "utf8").replace(/```[\s\S]*?```/g, "");
  return new Set([...texte.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) => ancre(m[1].replace(/[`*_]/g, ""))));
}

const erreurs = [];
const fichiers = fichiersMarkdown(RACINE);

for (const fichier of fichiers) {
  const texte = readFileSync(fichier, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const m of texte.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const cible = m[1];
    if (/^(https?:|mailto:|tel:)/i.test(cible)) continue;
    const [chemin, fragment] = cible.split("#");
    let destination = chemin ? resolve(dirname(fichier), decodeURIComponent(chemin)) : fichier;
    if (!existsSync(destination)) {
      erreurs.push(`${relative(RACINE, fichier)} : lien cassé vers « ${cible} »`);
      continue;
    }
    if (statSync(destination).isDirectory()) continue;
    if (fragment && destination.endsWith(".md") && !ancresDe(destination).has(decodeURIComponent(fragment))) {
      erreurs.push(`${relative(RACINE, fichier)} : titre introuvable « ${cible} »`);
    }
  }
}

if (erreurs.length) {
  console.error(`✗ ${erreurs.length} lien(s) cassé(s) dans la documentation :\n- ` + erreurs.join("\n- "));
  process.exit(1);
}
console.log(`✓ Documentation vérifiée : ${fichiers.length} fichiers Markdown, tous les liens internes sont valides.`);
