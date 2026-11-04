// Construit les deux versions du site testées dans le navigateur, puis vérifie chacune :
//   · dist/           le site tel qu'il est publié aujourd'hui (formulaire par WhatsApp ou e-mail) ;
//   · dist-avec-api/  le site relié à une API fictive, pour le formulaire qui enregistre les demandes (tâche 7).
//   node tests/construire.mjs

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../", import.meta.url));
const VERIFICATEUR = fileURLToPath(new URL("../../../scripts/verifier-site.mjs", import.meta.url));
const API_DE_TEST = "http://api.dbs.test/api";
const ASTRO = join(dirname(createRequire(import.meta.url).resolve("astro/package.json")), "bin", "astro.mjs");

const construire = (env) =>
  execFileSync(process.execPath, [ASTRO, "build"], {
    cwd: SITE, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, ...env },
  });

const { URL_API: _ignoree, ...sansApi } = process.env;
construire({ ...sansApi, URL_API: "", DOSSIER_SORTIE: "./dist" });
execFileSync(process.execPath, [VERIFICATEUR], { stdio: "inherit" });
construire({ URL_API: API_DE_TEST, DOSSIER_SORTIE: "./dist-avec-api" });
execFileSync(process.execPath, [VERIFICATEUR, "apps/site-vitrine/dist-avec-api"], { stdio: "inherit" });
