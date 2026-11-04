// Accès à PostgreSQL. Toute requête passe par une transaction ouverte ici :
//   · transactionUtilisateur : déclare l'utilisateur authentifié à la base, qui applique alors
//     ses droits ligne par ligne (database/README.md) ;
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

async function transaction<T>(pool: Pool, utilisateurId: string | null, travail: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let connexionCassee = false;
  try {
    await client.query("BEGIN");
    if (utilisateurId) {
      // true : la valeur ne vaut que pour cette transaction, jamais pour la suivante sur la même connexion
      await client.query("SELECT set_config('app.utilisateur_id', $1, true)", [utilisateurId]);
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
  return transaction(pool, utilisateurId, travail);
}

export function transactionSysteme<T>(pool: Pool, travail: (client: Client) => Promise<T>): Promise<T> {
  return transaction(pool, null, travail);
}
