// Prépare une base PostgreSQL neuve pour les tests d'intégration, comme en production :
// rôles et base (database/initialisation), puis migrations avec le compte propriétaire.
//
// Variables : PGHOST (adresse TCP), PGPORT, PGUSER (superutilisateur), PGPASSWORD d'un serveur DE TEST.
// La base « dbs_api_tests » est supprimée puis recréée.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

const RACINE = fileURLToPath(new URL("../../../../", import.meta.url));
const BASE = "dbs_api_tests";

function url(utilisateur: string, motDePasse: string, base: string): string {
  const adresse = new URL(`postgres://localhost/${base}`);
  adresse.hostname = process.env.PGHOST ?? "localhost";
  adresse.port = process.env.PGPORT ?? "5432";
  adresse.username = encodeURIComponent(utilisateur);
  adresse.password = encodeURIComponent(motDePasse);
  return adresse.toString();
}

export default function preparer(projet: TestProject): void {
  if (!process.env.PGHOST || process.env.PGHOST.startsWith("/")) {
    throw new Error(
      "Tests d'intégration : définissez PGHOST (adresse TCP), PGPORT, PGUSER (superutilisateur) et PGPASSWORD d'un serveur PostgreSQL de test.",
    );
  }
  const psql = (...args: string[]) =>
    execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", "postgres", ...args], { stdio: ["ignore", "ignore", "inherit"] });

  psql("-c", `DROP DATABASE IF EXISTS ${BASE} WITH (FORCE)`);
  psql("-v", `base=${BASE}`, "-f", join(RACINE, "database/initialisation/01_roles_et_base.sql"));

  // Mots de passe jetables, propres à cette exécution
  const mdpProprietaire = randomBytes(18).toString("base64url");
  const mdpApplication = randomBytes(18).toString("base64url");
  psql("-c", `ALTER ROLE dbs_proprietaire PASSWORD '${mdpProprietaire}'`);
  psql("-c", `ALTER ROLE dbs_application PASSWORD '${mdpApplication}'`);

  execFileSync("bash", [join(RACINE, "database/migrer.sh")], {
    env: { ...process.env, PGUSER: "dbs_proprietaire", PGPASSWORD: mdpProprietaire, PGDATABASE: BASE },
    stdio: ["ignore", "ignore", "inherit"],
  });

  projet.provide("urlApplication", url("dbs_application", mdpApplication, BASE));
  projet.provide("urlSuperutilisateur", url(process.env.PGUSER ?? "postgres", process.env.PGPASSWORD ?? "", BASE));
}
