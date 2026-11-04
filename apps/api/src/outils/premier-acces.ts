// Installation : donne un mot de passe provisoire au premier gérant, créé par
// database/initialisation/02_premier_gerant.sql. Ensuite, tous les accès sont créés depuis l'application.
//
//   DATABASE_URL_PROPRIETAIRE=postgres://dbs_proprietaire@…/dbs \
//     npm run premier-acces -w @dbs/api -- prenom.nom@exemple.ci
//
// Le mot de passe s'affiche une seule fois : remettez-le en main propre. À la première connexion,
// la personne configure son deuxième facteur puis choisit son propre mot de passe.

import pg from "pg";
import { initialiserPremierAcces, preparerAccesProvisoire } from "../modules/utilisateurs/acces.js";

const email = process.argv[2];
const url = process.env.DATABASE_URL_PROPRIETAIRE;
if (!email || !url) {
  console.error("Usage : DATABASE_URL_PROPRIETAIRE=… npm run premier-acces -w @dbs/api -- adresse@exemple.ci");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, application_name: "dbs-premier-acces" });
await client.connect();
try {
  const acces = await preparerAccesProvisoire();
  await client.query("BEGIN");
  const utilisateurId = await initialiserPremierAcces(client, email, acces);
  await client.query("COMMIT");
  if (!utilisateurId) {
    console.error("Aucun compte actif sans accès pour cette adresse. Le compte existe-t-il (02_premier_gerant.sql) ? A-t-il déjà un accès ?");
    process.exitCode = 1;
  } else {
    console.log(`Mot de passe provisoire (affiché une seule fois) : ${acces.motDePasse}`);
  }
} catch (erreur) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw erreur;
} finally {
  await client.end();
}
