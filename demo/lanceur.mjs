// Démonstration locale de DBS-ASSURANCES : tout le projet, sur votre ordinateur, avec des données fictives.
//
//   · base PostgreSQL préparée comme en production (rôles, migrations), puis remplie de données inventées ;
//   · API, back-office (gestion), espace client et site vitrine démarrés ensemble ;
//   · page d'accueil (http://localhost:8080) : liens, comptes de démonstration, codes de connexion en direct.
//
// Rien ne sort de l'ordinateur : les codes de l'espace client s'affichent sur la page d'accueil au lieu de partir
// sur WhatsApp, le paiement Mobile Money est simulé, les relances et la lecture automatique des documents aussi
// (valeurs d'exemple), et un antivirus de démonstration remplace
// ClamAV (il refuse seulement le fichier de test EICAR). Les clés et mots de passe ci-dessous sont publics : ils ne
// servent qu'à cette démonstration et ne doivent jamais être utilisés ailleurs.
//
// Lancement normal : par Docker (demo/compose.yml, guide DEMARRER.md), où la base est préparée avant par
// demo/preparer-base.sh. À la main, sous Linux ou macOS, avec psql, bash, un PostgreSQL de test (PGHOST, PGPORT,
// PGUSER superutilisateur, PGPASSWORD) et le projet construit (site avec URL_API=http://localhost:3000) :
//   node demo/lanceur.mjs [--reinitialiser]

import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (process.env.NODE_ENV === "production") {
  console.error("La démonstration ne tourne jamais en production : ses clés et mots de passe sont publics.");
  process.exit(1);
}

const RACINE = fileURLToPath(new URL("../", import.meta.url));
const dist = (chemin) => import(`${RACINE}apps/api/dist/${chemin}`);

// ---------------------------------------------------------------------------------------------------------
// Réglages de la démonstration (publics, fictifs)
// ---------------------------------------------------------------------------------------------------------
const BASE = "dbs_demo";
const MOT_DE_PASSE = "Demo DBS Assurances 2026";
const CLE = createHmac("sha256", "demonstration DBS-ASSURANCES").update("cle-de-chiffrement").digest(); // 32 octets
// Mot de passe du compte de l'application, posé par demo/preparer-base.sh
const MDP_APPLICATION = "demo-application";
const ADRESSES = {
  accueil: "http://localhost:8080",
  gestion: "http://localhost:4173",
  espaceClient: "http://localhost:4174",
  site: "http://localhost:4321",
  api: "http://localhost:3000",
};
const PERSONNEL = [
  { role: "gerant", libelle: "Gérante", nom: "Aya Kouamé", email: "gerante@demo.dbs-assurances.test" },
  { role: "charge_clientele", libelle: "Chargé de clientèle", nom: "Koffi Brou", email: "charge@demo.dbs-assurances.test" },
  { role: "caissier", libelle: "Caissière", nom: "Adjoua N'Guessan", email: "caisse@demo.dbs-assurances.test" },
  { role: "commercial", libelle: "Commercial", nom: "Moussa Traoré", email: "commercial@demo.dbs-assurances.test" },
  { role: "auditeur", libelle: "Auditrice (lecture seule)", nom: "Awa Diabaté", email: "auditrice@demo.dbs-assurances.test" },
];
const CLIENTS_ESPACE = [
  { nom: "Awa Kouassi", qualite: "Titulaire de l'espace de Transports Kouassi & Fils (flotte de 3 camions)", telephone: "+2250701020304" },
  { nom: "Yao Konan", qualite: "Chef de parc chez Transports Kouassi & Fils", telephone: "+2250701020305" },
  { nom: "Koné Mariam", qualite: "Particulière : prime automobile à payer, espace ouvert à sa première demande de code", telephone: "+2250708091011" },
];
/** Secret du deuxième facteur de chaque compte : fixe, pour afficher le code en direct sur la page d'accueil */
const secretTotp = (email) => createHmac("sha256", "demonstration DBS-ASSURANCES").update(`totp:${email}`).digest().subarray(0, 20);

const journal = (message) => console.log(`[démonstration] ${message}`);

// ---------------------------------------------------------------------------------------------------------
// Base de données
// ---------------------------------------------------------------------------------------------------------
const pgHote = process.env.PGHOST ?? "localhost";
const pgPort = process.env.PGPORT ?? "5432";
const superUtilisateur = process.env.PGUSER ?? "postgres";
const url = (utilisateur, motDePasse, base = BASE) => {
  const adresse = new URL(`postgres://localhost/${base}`);
  adresse.hostname = pgHote;
  adresse.port = pgPort;
  adresse.username = encodeURIComponent(utilisateur);
  adresse.password = encodeURIComponent(motDePasse);
  return adresse.toString();
};
const urlSuper = (base) => url(superUtilisateur, process.env.PGPASSWORD ?? "", base);
async function attendreBase() {
  for (let essai = 0; essai < 60; essai += 1) {
    const client = new pg.Client({ connectionString: urlSuper("postgres") });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("La base de données ne répond pas.");
}

async function demoPrete() {
  const client = new pg.Client({ connectionString: urlSuper("postgres") });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [BASE]);
    if (rows.length === 0) return false;
  } finally {
    await client.end();
  }
  const base = new pg.Client({ connectionString: urlSuper(BASE) });
  await base.connect();
  try {
    const { rows } = await base.query("SELECT to_regclass('app.utilisateurs') IS NOT NULL AS ok");
    if (!rows[0].ok) return false;
    const { rows: comptes } = await base.query("SELECT count(*)::int AS n FROM app.utilisateurs WHERE email = $1", [PERSONNEL[0].email]);
    return comptes[0].n === 1;
  } finally {
    await base.end();
  }
}

/** Rôles, base et migrations, avec les scripts de production (demo/preparer-base.sh) */
function preparerBase(reinitialiser) {
  execFileSync("bash", [`${RACINE}demo/preparer-base.sh`], {
    env: { ...process.env, PGHOST: pgHote, PGPORT: pgPort, DEMO_REINITIALISER: reinitialiser ? "oui" : "non" },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

/** Données fictives : personnel, clients, contrats, flotte, demandes du site, rendez-vous, réclamation */
async function remplir() {
  const { hacherMotDePasse } = await dist("securite/mots-de-passe.js");
  const { chiffrer } = await dist("securite/chiffrement.js");
  const empreinteMotDePasse = await hacherMotDePasse(MOT_DE_PASSE);
  const base = new pg.Client({ connectionString: urlSuper(BASE) });
  await base.connect();
  const jour = (decalage) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + decalage);
    return d.toISOString().slice(0, 10);
  };
  const ip = (n) => Buffer.alloc(32, n);
  try {
    await base.query("BEGIN");
    // Personnel : mot de passe définitif et deuxième facteur déjà configuré
    const ids = {};
    for (const p of PERSONNEL) {
      const { rows: [u] } = await base.query("INSERT INTO app.utilisateurs (email, nom, role) VALUES ($1, $2, $3) RETURNING id", [p.email, p.nom, p.role]);
      ids[p.role] = u.id;
      await base.query(
        `INSERT INTO securite.identifiants (utilisateur_id, hash_mot_de_passe, mot_de_passe_provisoire, totp_secret_chiffre, totp_active)
         VALUES ($1, $2, false, $3, true)`,
        [u.id, empreinteMotDePasse, chiffrer(CLE, secretTotp(p.email), `totp:${u.id}`)],
      );
    }
    const commeUtilisateur = (role) => base.query("SELECT set_config('app.utilisateur_id', $1, true)", [ids[role]]);
    await commeUtilisateur("charge_clientele");

    // Transports Kouassi & Fils : flotte de trois camions, payée, une attestation, un sinistre, un espace client
    const { rows: [transport] } = await base.query(
      `INSERT INTO app.clients (type, nom, telephone, email, commune, rccm)
       VALUES ('entreprise', 'Transports Kouassi & Fils', '+2250701020300', 'contact@kouassi-transports.test', 'Yopougon', 'CI-ABJ-2024-B-0042') RETURNING id`);
    const camions = [];
    for (const [immatriculation, marque, visite, vignette] of [
      ["1001 KF 01", "Renault Trucks", jour(10), jour(200)],
      ["1002 KF 01", "Isuzu", jour(150), jour(-4)],
      ["1003 KF 01", "Toyota Dyna", jour(300), jour(250)],
    ]) {
      const { rows: [v] } = await base.query(
        `INSERT INTO app.vehicules (client_id, immatriculation, marque, echeance_visite_technique, echeance_vignette)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`, [transport.id, immatriculation, marque, visite, vignette]);
      camions.push(v.id);
    }
    const { rows: [flotte] } = await base.query(
      `INSERT INTO app.contrats (client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
       VALUES ($1, 'FLT-KF-2026', 'flotte', $2, $3, 900000) RETURNING id`, [transport.id, jour(-30), jour(335)]);
    const lignes = [];
    for (const camion of camions) {
      const { rows: [l] } = await base.query(
        "INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le, prime_vehicule) VALUES ($1, $2, $3, 300000) RETURNING id",
        [flotte.id, camion, jour(-30)]);
      lignes.push(l.id);
    }
    await base.query("INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe) VALUES ($1, 900000, 'virement', 'VIR-KF-2026')", [flotte.id]);
    const attestation = Buffer.from("%PDF-1.4\n% Attestation de demonstration (fictive) - 1001 KF 01\n%%EOF\n");
    await base.query("UPDATE app.contrats_vehicules SET numero_attestation = 'ASACI-DEMO-0001' WHERE id = $1", [lignes[0]]);
    await base.query(
      `INSERT INTO app.attestations_vehicules (contrat_vehicule_id, contenu_chiffre, empreinte, taille, etat_analyse)
       VALUES ($1, $2, sha256($3), $4, 'saine')`,
      [lignes[0], chiffrer(CLE, attestation, `attestation:${lignes[0]}`), attestation, attestation.length]);
    await base.query(
      `INSERT INTO app.sinistres (contrat_id, vehicule_id, survenu_le, nature, statut, reference_compagnie, description)
       VALUES ($1, $2, $3, 'materiel', 'transmis_compagnie', 'SAN-DEMO-0457', 'Accrochage au carrefour de la Siporex. Note interne de l''agence.')`,
      [flotte.id, camions[1], jour(-5)]);
    await base.query(
      `INSERT INTO app.gestionnaires_portail (client_id, nom, telephone, role) VALUES ($1, $2, $3, 'titulaire'), ($1, $4, $5, 'gestionnaire')`,
      [transport.id, CLIENTS_ESPACE[0].nom, CLIENTS_ESPACE[0].telephone, CLIENTS_ESPACE[1].nom, CLIENTS_ESPACE[1].telephone]);

    // Koné Mariam : contrat automobile à payer ; son espace s'ouvre à sa première demande de code
    const { rows: [mariam] } = await base.query(
      "INSERT INTO app.clients (type, nom, telephone, commune) VALUES ('particulier', $1, $2, 'Cocody') RETURNING id",
      [CLIENTS_ESPACE[2].nom, CLIENTS_ESPACE[2].telephone]);
    const { rows: [yaris] } = await base.query(
      "INSERT INTO app.vehicules (client_id, immatriculation, marque) VALUES ($1, '2024 KM 01', 'Toyota Yaris') RETURNING id", [mariam.id]);
    const { rows: [auto] } = await base.query(
      `INSERT INTO app.contrats (client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
       VALUES ($1, 'AUTO-KM-2026', 'automobile', $2, $3, 150000) RETURNING id`, [mariam.id, jour(-2), jour(363)]);
    await base.query("INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le) VALUES ($1, $2, $3)", [auto.id, yaris.id, jour(-2)]);

    // Diallo Fanta : habitation payée, échéance dans 20 jours (elle apparaît dans « Échéances »)
    const { rows: [fanta] } = await base.query(
      "INSERT INTO app.clients (type, nom, telephone, commune) VALUES ('particulier', 'Diallo Fanta', '+2250707070707', 'Marcory') RETURNING id");
    const { rows: [habitation] } = await base.query(
      `INSERT INTO app.contrats (client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
       VALUES ($1, 'HAB-DF-2025', 'habitation', $2, $3, 85000) RETURNING id`, [fanta.id, jour(-345), jour(20)]);
    await base.query(
      "INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe) VALUES ($1, 85000, 'mobile_money', 'WAVE-DEMO-8841')", [habitation.id]);

    // Boutique Bamba : multirisque professionnelle payée en partie, et un devis en attente de réponse
    const { rows: [boutique] } = await base.query(
      "INSERT INTO app.clients (type, nom, telephone, commune) VALUES ('professionnel', 'Boutique Bamba', '+2250505050505', 'Adjamé') RETURNING id");
    const { rows: [mrp] } = await base.query(
      `INSERT INTO app.contrats (client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
       VALUES ($1, 'MRP-BB-2026', 'multirisque_professionnelle', $2, $3, 240000) RETURNING id`, [boutique.id, jour(-60), jour(305)]);
    await base.query(
      "INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe) VALUES ($1, 120000, 'mobile_money', 'OM-DEMO-5512')", [mrp.id]);
    await base.query(
      "INSERT INTO app.devis (client_id, branche, origine, description, prime_proposee) VALUES ($1, 'automobile', 'agence', 'Tricycle de livraison', 95000)",
      [boutique.id]);

    // Réclamation reçue au guichet, à traiter
    await base.query(
      `INSERT INTO app.reclamations (client_id, nom, telephone, canal, objet, description, contrat_id)
       VALUES ($1, 'Diallo Fanta', '+2250707070707', 'guichet', 'attestation', 'Je n''ai pas reçu mon attestation après le paiement.', $2)`,
      [fanta.id, habitation.id]);
    await base.query("COMMIT");

    // Demandes arrivées par le site, comme si un visiteur les avait envoyées (fonctions publiques de la base)
    const accord = "J'accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.";
    await base.query(
      `SELECT app.enregistrer_demande_site('habitation', 'particulier', 'Séka Paul', '+2250102030405', NULL, 'Bingerville',
        'Maison de 4 pièces, je voudrais une assurance habitation.', $1, NULL, $2, NULL, NULL, NULL, NULL, NULL)`, [accord, ip(1)]);
    await base.query(
      `SELECT app.enregistrer_appel_offres('chantier_construction', 'entreprise', 'BTP Lagunes SARL', '+2250102030406', NULL, 'Cocody',
        NULL, $1, $2, $3, NULL, $4)`,
      [jour(25), JSON.stringify({ typeMarche: "travaux", maitreOuvrage: "Mairie de Cocody", objet: "Construction d'un marché couvert",
        montant: 350000000, dureeMois: 10, garanties: ["trc", "decennale"] }), accord, ip(2)]);
    await base.query(
      `SELECT app.enregistrer_rappel_echeance('automobile', 'particulier', 'Kouadio Jean', '+2250102030407', NULL, $1,
        'J''accepte que DBS-ASSURANCES garde ces informations jusqu''à mon échéance, pour me rappeler et me proposer un devis.', NULL, $2)`,
      [jour(100), ip(3)]);
    await base.query(
      `SELECT app.demander_rendez_vous('renouvellement', 'agence', 'particulier', 'Aïcha Bamba', '+2250102030408', NULL,
        'Je voudrais comparer avant de renouveler.', app.ajouter_jours_ouvres(app.aujourdhui(), 2), 'matin', $1, NULL, $2)`, [accord, ip(4)]);
  } catch (erreur) {
    await base.query("ROLLBACK").catch(() => {});
    throw erreur;
  } finally {
    await base.end();
  }
}

// ---------------------------------------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------------------------------------
/** Codes de connexion à l'espace client : affichés sur la page d'accueil au lieu de partir sur WhatsApp */
const codesRecus = new Map();

async function demarrerApi() {
  const { chargerConfiguration } = await dist("config/configuration.js");
  const { construireApplication } = await dist("application.js");
  const { creerPool } = await dist("base-de-donnees/connexion.js");
  const { creerAntivirus } = await dist("integrations/antivirus/clamav.js");
  const { creerPrestataire } = await dist("integrations/paiement/prestataire.js");
  const { demarrerMaintenancePeriodique } = await dist("modules/demandes-site/maintenance.js");
  const { creerMessagerie } = await dist("modules/relances/messagerie.js");
  const { creerClamdFactice } = await import(`${RACINE}apps/api/tests/antivirus/clamd-factice.mjs`);

  await new Promise((resoudre) => creerClamdFactice().listen(3311, "127.0.0.1", resoudre));
  const config = chargerConfiguration({
    NODE_ENV: "development",
    DATABASE_URL: url("dbs_application", MDP_APPLICATION),
    CLE_CHIFFREMENT_DONNEES: CLE.toString("base64"),
    URL_BACK_OFFICE: ADRESSES.gestion,
    URL_PORTAIL: ADRESSES.espaceClient,
    URL_SITE_VITRINE: ADRESSES.site,
    ANTIVIRUS_ADRESSE: "127.0.0.1:3311",
    PAIEMENT_PRESTATAIRE: "simulation",
    LECTURE_PRESTATAIRE: "simulation",
    RELANCES_SIMULATION: "true",
    VERIFIER_MOTS_DE_PASSE_DIVULGUES: "false",
    HOST: "0.0.0.0",
    PORT: "3000",
    NIVEAU_JOURNAL: "warn",
  });
  const pool = creerPool(config.urlBaseDeDonnees);
  const antivirus = creerAntivirus(config.antivirus);
  const prestatairePaiement = creerPrestataire(config.paiement);
  const envoiCodes = {
    disponible: true,
    envoyer: async (telephone, code) => {
      codesRecus.set(telephone, { code, recuLe: Date.now() });
      return { ok: true, identifiant: "demonstration" };
    },
  };
  const app = await construireApplication({
    config, pool, antivirus, prestatairePaiement, envoiCodes, messagerie: creerMessagerie(config.relances),
  });
  demarrerMaintenancePeriodique(pool, antivirus, config.cleChiffrement, app.log, prestatairePaiement);
  await app.listen({ host: config.hote, port: config.port });
}

const enfants = [];
function lancer(nom, commande, args, options) {
  const enfant = spawn(commande, args, { stdio: ["ignore", "ignore", "pipe"], ...options });
  enfant.stderr.on("data", (d) => process.stderr.write(`[${nom}] ${d}`));
  enfant.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`[démonstration] ${nom} s'est arrêté (code ${code}).`);
      process.exit(1);
    }
  });
  enfants.push(enfant);
}

function demarrerApplications() {
  const vite = `${RACINE}node_modules/vite/bin/vite.js`;
  lancer("gestion", process.execPath, [vite, "preview", "--host", "0.0.0.0"], { cwd: `${RACINE}apps/admin` });
  lancer("espace client", process.execPath, [vite, "preview", "--host", "0.0.0.0"], { cwd: `${RACINE}apps/portail` });
  lancer("site", process.execPath, [`${RACINE}apps/site-vitrine/tests/serveur.mjs`, "4321", "dist"], {
    cwd: `${RACINE}apps/site-vitrine`, env: { ...process.env, HOTE: "0.0.0.0" },
  });
}

// ---------------------------------------------------------------------------------------------------------
// Page d'accueil de la démonstration
// ---------------------------------------------------------------------------------------------------------
async function demarrerAccueil() {
  const { codeTotp, pasDeTemps, PERIODE_SECONDES } = await dist("securite/totp.js");
  const page = readFileSync(`${RACINE}demo/accueil.html`, "utf8")
    .replaceAll("{{MOT_DE_PASSE}}", MOT_DE_PASSE)
    .replaceAll("{{GESTION}}", ADRESSES.gestion)
    .replaceAll("{{ESPACE_CLIENT}}", ADRESSES.espaceClient)
    .replaceAll("{{SITE}}", ADRESSES.site);
  const fichiers = {
    "/": { type: "text/html; charset=utf-8", contenu: page },
    "/accueil.js": { type: "text/javascript; charset=utf-8", contenu: readFileSync(`${RACINE}demo/accueil.js`, "utf8") },
    "/accueil.css": { type: "text/css; charset=utf-8", contenu: readFileSync(`${RACINE}demo/accueil.css`, "utf8") },
  };
  const enTetes = {
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
  createServer((requete, reponse) => {
    const chemin = new URL(requete.url ?? "/", "http://localhost").pathname;
    if (chemin === "/etat.json") {
      const maintenant = Date.now();
      const etat = {
        resteSecondes: PERIODE_SECONDES - Math.floor(maintenant / 1000) % PERIODE_SECONDES,
        personnel: PERSONNEL.map((p) => ({ ...p, code: codeTotp(secretTotp(p.email), pasDeTemps(maintenant)) })),
        clients: CLIENTS_ESPACE.map((c) => {
          const recu = codesRecus.get(c.telephone);
          // Un code de l'espace client vaut 10 minutes
          return { ...c, code: recu && maintenant - recu.recuLe < 10 * 60_000 ? recu.code : null };
        }),
      };
      reponse.writeHead(200, { ...enTetes, "Content-Type": "application/json; charset=utf-8" });
      return reponse.end(JSON.stringify(etat));
    }
    const fichier = fichiers[chemin];
    if (!fichier) {
      reponse.writeHead(404, { ...enTetes, "Content-Type": "text/plain; charset=utf-8" });
      return reponse.end("Page introuvable");
    }
    reponse.writeHead(200, { ...enTetes, "Content-Type": fichier.type });
    reponse.end(fichier.contenu);
  }).listen(8080, "0.0.0.0");
}

// ---------------------------------------------------------------------------------------------------------
try {
  journal("connexion à la base de données…");
  await attendreBase();
  // Dans Docker, le conteneur PostgreSQL a déjà préparé la base (demo/compose.yml)
  if (process.env.DEMO_BASE_PREPAREE !== "oui") preparerBase(process.argv.includes("--reinitialiser"));
  if (!(await demoPrete())) {
    journal("données fictives…");
    await remplir();
  }
  journal("démarrage de l'API, de la gestion, de l'espace client et du site…");
  await demarrerApi();
  demarrerApplications();
  await demarrerAccueil();
  journal(`prête : ouvrez ${ADRESSES.accueil}`);
} catch (erreur) {
  console.error("[démonstration] échec du démarrage :", erreur instanceof Error ? erreur.message : erreur);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    for (const enfant of enfants) enfant.kill("SIGTERM");
    process.exit(0);
  });
}
