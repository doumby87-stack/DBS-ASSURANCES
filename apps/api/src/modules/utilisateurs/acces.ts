// Création d'un accès provisoire : mot de passe à changer à la première connexion,
// deuxième facteur à configurer. Utilisé par le gérant (création, réinitialisation)
// et par l'outil d'installation du premier gérant.

import type pg from "pg";
import { genererMotDePasseProvisoire, hacherMotDePasse } from "../../securite/mots-de-passe.js";

export interface AccesProvisoire {
  motDePasse: string;
  empreinte: string;
}

export async function preparerAccesProvisoire(): Promise<AccesProvisoire> {
  const motDePasse = genererMotDePasseProvisoire();
  return { motDePasse, empreinte: await hacherMotDePasse(motDePasse) };
}

/** Premier accès d'un compte actif qui n'en a pas encore (installation). Renvoie son identifiant, ou null. */
export async function initialiserPremierAcces(client: pg.ClientBase, email: string, acces: AccesProvisoire): Promise<string | null> {
  const { rows } = await client.query<{ utilisateur_id: string }>(
    `INSERT INTO securite.identifiants (utilisateur_id, hash_mot_de_passe)
     SELECT u.id, $2 FROM app.utilisateurs u
     WHERE u.email = lower(btrim($1)) AND u.actif
       AND NOT EXISTS (SELECT 1 FROM securite.identifiants i WHERE i.utilisateur_id = u.id)
     RETURNING utilisateur_id`,
    [email, acces.empreinte],
  );
  const utilisateurId = rows[0]?.utilisateur_id ?? null;
  if (utilisateurId) {
    await client.query("INSERT INTO securite.evenements (type, utilisateur_id) VALUES ('compte_cree', $1)", [utilisateurId]);
  }
  return utilisateurId;
}
