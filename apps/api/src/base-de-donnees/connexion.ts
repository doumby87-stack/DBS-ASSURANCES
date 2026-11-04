// Accès à PostgreSQL. Toute requête passe par une transaction ouverte ici :
//   · transactionUtilisateur : déclare l'utilisateur authentifié à la base, qui applique alors
//     ses droits ligne par ligne (database/README.md) ;
//   · transactionPortail : personne connectée au portail des entreprises, sous le rôle dbs_portail ;
//   · transactionSysteme : réservée aux étapes où personne n'est encore authentifié (connexion).
// Requêtes toujours paramétrées ($1, $2…) : jamais de texte saisi concaténé dans du SQL.

import pg from "pg";

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

// bigint (int8) en nombre JavaScript : nos valeurs (montants en F CFA, pas TOTP) restent très en deçà de 2^53
pg.types.setTypeParser(pg.types.builtins.INT8, (valeur) => Number(valeur));
// Dates sans heure (échéances) gardées telles quelles, « 2026-11-29 » : aucun décalage de fuseau horaire
pg.types.setTypeParser(pg.types.builtins.DATE, (valeur) => valeur);

export function creerPool(url: string): Pool {
  return new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "dbs-api",
  });
}

type Identite = { utilisateurId: string } | { gestionnaireId: string } | null;

async function transaction<T>(pool: Pool, identite: Identite, travail: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let connexionCassee = false;
  try {
    await client.query("BEGIN");
    // set_config(…, true) et SET LOCAL : la valeur ne vaut que pour cette transaction, jamais pour la suivante
    // sur la même connexion
    if (identite && "utilisateurId" in identite) {
      await client.query("SELECT set_config('app.utilisateur_id', $1, true)", [identite.utilisateurId]);
    } else if (identite) {
      // Portail : rôle restreint à l'entreprise de la personne connectée (database/migrations/0012)
      await client.query("SET LOCAL ROLE dbs_portail");
      await client.query("SELECT set_config('app.gestionnaire_id', $1, true)", [identite.gestionnaireId]);
    }
    const resultat = await travail(client);
    await client.query("COMMIT");
    return resultat;
  } catch (erreur) {
    try {
      await client.query("ROLLBACK");
    } catch {
      connexionCassee = true;
    }
    throw erreur;
  } finally {
    client.release(connexionCassee);
  }
}

export function transactionUtilisateur<T>(pool: Pool, utilisateurId: string, travail: (client: Client) => Promise<T>): Promise<T> {
  return transaction(pool, { utilisateurId }, travail);
}

/** Requête d'une personne connectée au portail : la base ne lui montre que son entreprise. */
export function transactionPortail<T>(pool: Pool, gestionnaireId: string, travail: (client: Client) => Promise<T>): Promise<T> {
  return transaction(pool, { gestionnaireId }, travail);
}

export function transactionSysteme<T>(pool: Pool, travail: (client: Client) => Promise<T>): Promise<T> {
  return transaction(pool, null, travail);
}
