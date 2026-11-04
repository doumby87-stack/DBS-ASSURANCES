// Prépare le test de bout en bout : base PostgreSQL neuve (rôles, migrations), premier gérant
// avec son mot de passe provisoire (outil premier-acces de l'API). Écrit les accès dans .e2e/acces.json,
// lu par playwright.config.ts. Mots de passe jetables, propres à cette exécution.
//
// Variables : PGHOST (adresse TCP), PGPORT, PGUSER (superutilisateur) et PGPASSWORD d'un serveur DE TEST.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RACINE = fileURLToPath(new URL("../../../../", import.meta.url));
const ADMIN = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "dbs_e2e";
const hote = process.env.PGHOST;
const port = process.env.PGPORT ?? "5432";
if (!hote || hote.startsWith("/")) {
  console.error("Définissez PGHOST (adresse TCP), PGPORT, PGUSER (superutilisateur) et PGPASSWORD d'un serveur PostgreSQL de test.");
  process.exit(1);
}

const url = (utilisateur, motDePasse) => {
  const adresse = new URL(`postgres://localhost/${BASE}`);
  adresse.hostname = hote;
  adresse.port = port;
  adresse.username = encodeURIComponent(utilisateur);
  adresse.password = encodeURIComponent(motDePasse);
  return adresse.toString();
};
const psql = (...args) =>
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], { stdio: ["ignore", "ignore", "inherit"] });

psql("-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${BASE} WITH (FORCE)`);
psql("-d", "postgres", "-v", `base=${BASE}`, "-f", `${RACINE}database/initialisation/01_roles_et_base.sql`);
const mdpProprietaire = randomBytes(18).toString("base64url");
const mdpApplication = randomBytes(18).toString("base64url");
psql("-d", "postgres", "-c", `ALTER ROLE dbs_proprietaire PASSWORD '${mdpProprietaire}'`);
psql("-d", "postgres", "-c", `ALTER ROLE dbs_application PASSWORD '${mdpApplication}'`);
execFileSync("bash", [`${RACINE}database/migrer.sh`], {
  env: { ...process.env, PGUSER: "dbs_proprietaire", PGPASSWORD: mdpProprietaire, PGDATABASE: BASE },
  stdio: ["ignore", "ignore", "inherit"],
});

const gerant = { email: "gerante.e2e@dbs-assurances.test", nom: "Aya Gérante" };
psql("-d", BASE, "-v", `email=${gerant.email}`, "-v", `nom=${gerant.nom}`,
  "-f", `${RACINE}database/initialisation/02_premier_gerant.sql`);
const sortie = execFileSync("node", [`${RACINE}apps/api/dist/outils/premier-acces.js`, gerant.email], {
  env: { ...process.env, DATABASE_URL_PROPRIETAIRE: url("dbs_proprietaire", mdpProprietaire) },
  encoding: "utf8",
});
const motDePasse = /: (\S+)\s*$/.exec(sortie)?.[1];
if (!motDePasse) throw new Error("Mot de passe provisoire introuvable dans la sortie de premier-acces");

mkdirSync(`${ADMIN}.e2e`, { recursive: true });
writeFileSync(
  `${ADMIN}.e2e/acces.json`,
  JSON.stringify({
    urlApplication: url("dbs_application", mdpApplication),
    urlSuperutilisateur: url(process.env.PGUSER ?? "postgres", process.env.PGPASSWORD ?? ""),
    cleChiffrement: randomBytes(32).toString("base64"),
    gerant: { ...gerant, motDePasse },
  }),
  { mode: 0o600 },
);
console.log("Base de bout en bout prête.");
