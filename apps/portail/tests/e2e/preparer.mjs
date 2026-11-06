// Prépare le test de bout en bout du portail : base PostgreSQL neuve (rôles, migrations), puis une entreprise
// assurée par l'agence comme en vrai : trois véhicules sur un contrat flotte payé, une attestation PDF
// déposée (chiffrée avec la clé de l'API, comme le ferait l'API), un sinistre suivi, deux accès au portail ;
// une autre entreprise, que le portail ne doit jamais montrer ; une particulière assurée pour sa voiture, prime
// à payer, dont l'espace s'ouvre à sa première demande de code. Écrit les accès dans .e2e/acces.json.
//
// Variables : PGHOST (adresse TCP), PGPORT, PGUSER (superutilisateur) et PGPASSWORD d'un serveur DE TEST.

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RACINE = fileURLToPath(new URL("../../../../", import.meta.url));
const PORTAIL = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "dbs_e2e_portail";
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
psql("-d", BASE, "-v", "email=gerante.portail@dbs-assurances.test", "-v", "nom=Aya Gérante",
  "-f", `${RACINE}database/initialisation/02_premier_gerant.sql`);

const cleChiffrement = randomBytes(32);
const { chiffrer } = await import(`${RACINE}apps/api/dist/securite/chiffrement.js`);
const urlSuperutilisateur = url(process.env.PGUSER ?? "postgres", process.env.PGPASSWORD ?? "");
const base = new pg.Client({ connectionString: urlSuperutilisateur });
await base.connect();

const jour = (decalage) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + decalage);
  return d.toISOString().slice(0, 10);
};
const titulaire = { nom: "Awa Kouassi", telephone: "+2250701020304" };
const particuliere = { nom: "Koné Mariam", telephone: "+2250708091011" };
const pdf = Buffer.from("%PDF-1.4\n% Attestation digitale ASACI de test, 1001 KF 01\n%%EOF\n");

try {
  await base.query("BEGIN");
  const { rows: [gerante] } = await base.query("SELECT id FROM app.utilisateurs WHERE role = 'gerant'");
  await base.query("SELECT set_config('app.utilisateur_id', $1, true)", [gerante.id]);
  const { rows: [client] } = await base.query(
    "INSERT INTO app.clients (type, nom, telephone) VALUES ('entreprise', 'Transports Kouassi & Fils', '+2250701020300') RETURNING id");
  const { rows: [autre] } = await base.query(
    "INSERT INTO app.clients (type, nom, telephone) VALUES ('entreprise', 'Autre Transport', '+2250701029999') RETURNING id");
  const vehicules = [];
  for (const [immatriculation, marque, vt, vignette] of [
    ["1001 KF 01", "Renault Trucks", jour(10), jour(200)],
    ["1002 KF 01", "Isuzu", jour(150), jour(-4)],
    ["1003 KF 01", "Toyota", jour(300), jour(250)],
  ]) {
    const { rows: [v] } = await base.query(
      `INSERT INTO app.vehicules (client_id, immatriculation, marque, echeance_visite_technique, echeance_vignette)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`, [client.id, immatriculation, marque, vt, vignette]);
    vehicules.push(v.id);
  }
  await base.query("INSERT INTO app.vehicules (client_id, immatriculation, marque) VALUES ($1, '9999 AT 01', 'Ailleurs')", [autre.id]);
  const { rows: [contrat] } = await base.query(
    `INSERT INTO app.contrats (client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
     VALUES ($1, 'FLT-KF-2026', 'flotte', $2, $3, 900000) RETURNING id`, [client.id, jour(-30), jour(335)]);
  const lignes = [];
  for (const vehiculeId of vehicules) {
    const { rows: [l] } = await base.query(
      `INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le, prime_vehicule) VALUES ($1, $2, $3, 300000) RETURNING id`,
      [contrat.id, vehiculeId, jour(-30)]);
    lignes.push(l.id);
  }
  await base.query(
    "INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe) VALUES ($1, 900000, 'virement', 'VIR-KF-2026')",
    [contrat.id]);
  await base.query("UPDATE app.contrats_vehicules SET numero_attestation = 'ASACI-KF-0001' WHERE id = $1", [lignes[0]]);
  await base.query(
    `INSERT INTO app.attestations_vehicules (contrat_vehicule_id, contenu_chiffre, empreinte, taille, etat_analyse)
     VALUES ($1, $2, $3, $4, 'saine')`,
    [lignes[0], chiffrer(cleChiffrement, pdf, `attestation:${lignes[0]}`), createHash("sha256").update(pdf).digest(), pdf.length]);
  await base.query(
    `INSERT INTO app.sinistres (contrat_id, vehicule_id, survenu_le, nature, statut, reference_compagnie, description)
     VALUES ($1, $2, $3, 'materiel', 'transmis_compagnie', 'SAN-2026-0457', 'Note interne : ne pas montrer')`,
    [contrat.id, vehicules[1], jour(-5)]);
  await base.query(
    `INSERT INTO app.gestionnaires_portail (client_id, nom, telephone, role) VALUES ($1, $2, $3, 'titulaire'),
       ($1, 'Yao Chef de parc', '+2250701020305', 'gestionnaire')`,
    [client.id, titulaire.nom, titulaire.telephone]);
  // Particulière : un contrat automobile en attente de paiement, aucun accès créé par l'agence
  const { rows: [mariam] } = await base.query(
    "INSERT INTO app.clients (type, nom, telephone) VALUES ('particulier', $1, $2) RETURNING id", [particuliere.nom, particuliere.telephone]);
  const { rows: [voiture] } = await base.query(
    "INSERT INTO app.vehicules (client_id, immatriculation, marque) VALUES ($1, '2024 KM 01', 'Toyota Yaris') RETURNING id", [mariam.id]);
  const { rows: [auto] } = await base.query(
    `INSERT INTO app.contrats (client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
     VALUES ($1, 'AUTO-KM-2026', 'automobile', $2, $3, 150003) RETURNING id`, [mariam.id, jour(-2), jour(363)]);
  await base.query("INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le) VALUES ($1, $2, $3)", [auto.id, voiture.id, jour(-2)]);
  await base.query("COMMIT");
} finally {
  await base.end();
}

mkdirSync(`${PORTAIL}.e2e`, { recursive: true });
writeFileSync(
  `${PORTAIL}.e2e/acces.json`,
  JSON.stringify({
    urlApplication: url("dbs_application", mdpApplication),
    urlSuperutilisateur,
    cleChiffrement: cleChiffrement.toString("base64"),
    titulaire,
    particuliere,
    attestation: pdf.toString("base64"),
  }),
  { mode: 0o600 },
);
console.log("Base de bout en bout du portail prête.");
