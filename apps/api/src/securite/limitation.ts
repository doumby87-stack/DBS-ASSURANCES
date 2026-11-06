// Limitation des tentatives et journal de sécurité (securite.evenements).
//   · par compte : 5 échecs consécutifs (mot de passe ou deuxième facteur) bloquent le compte 15 minutes,
//     puis deux fois plus longtemps à chaque nouvel échec, 24 heures au plus ; le compteur ne revient
//     à zéro qu'après une connexion complète (deuxième facteur compris) ;
//   · par adresse IP : 20 échecs en 15 minutes suspendent les tentatives depuis cette adresse.

import type { Client } from "../base-de-donnees/connexion.js";
import { fermerSessionsUtilisateur } from "./sessions.js";

export const ECHECS_AVANT_BLOCAGE = 5;
export const ECHECS_PAR_IP_MAX = 20;

export type TypeEvenement =
  | "connexion_reussie" | "connexion_echouee" | "mfa_echoue" | "compte_bloque" | "mfa_active"
  | "mot_de_passe_modifie" | "acces_reinitialise" | "compte_cree" | "compte_modifie" | "deconnexion"
  | "export_donnees" | "piece_telechargee" | "donnee_sensible_consultee";

export async function consignerEvenement(
  client: Client,
  type: TypeEvenement,
  details: { utilisateurId?: string | null; email?: string | null; ip?: string | null; auteurId?: string | null; objet?: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO securite.evenements (type, utilisateur_id, email, adresse_ip, auteur_id, objet)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      type, details.utilisateurId ?? null, details.email?.slice(0, 254) ?? null, details.ip ?? null, details.auteurId ?? null,
      details.objet?.slice(0, 120) ?? null,
    ],
  );
}

export async function adresseSuspendue(client: Client, ip: string): Promise<boolean> {
  const { rows } = await client.query<{ echecs: number }>(
    `SELECT count(*)::int AS echecs FROM securite.evenements
     WHERE adresse_ip = $1 AND type IN ('connexion_echouee', 'mfa_echoue')
       AND horodatage > now() - interval '15 minutes'`,
    [ip],
  );
  return (rows[0]?.echecs ?? 0) >= ECHECS_PAR_IP_MAX;
}

/** Compte un échec ; au seuil, bloque le compte et ferme toutes ses sessions. */
export async function enregistrerEchec(client: Client, utilisateurId: string, ip: string): Promise<void> {
  const { rows } = await client.query<{ echecs_consecutifs: number }>(
    `UPDATE securite.identifiants
     SET echecs_consecutifs = echecs_consecutifs + 1,
         bloque_jusqu_a = CASE
           WHEN echecs_consecutifs + 1 >= $2
             THEN now() + least(interval '15 minutes' * power(2, echecs_consecutifs + 1 - $2), interval '24 hours')
           ELSE bloque_jusqu_a
         END
     WHERE utilisateur_id = $1
     RETURNING echecs_consecutifs`,
    [utilisateurId, ECHECS_AVANT_BLOCAGE],
  );
  if ((rows[0]?.echecs_consecutifs ?? 0) >= ECHECS_AVANT_BLOCAGE) {
    await fermerSessionsUtilisateur(client, utilisateurId);
    await consignerEvenement(client, "compte_bloque", { utilisateurId, ip });
  }
}

export async function compteBloque(client: Client, utilisateurId: string): Promise<boolean> {
  const { rows } = await client.query<{ bloque: boolean }>(
    `SELECT coalesce(bloque_jusqu_a > now(), false) AS bloque FROM securite.identifiants WHERE utilisateur_id = $1`,
    [utilisateurId],
  );
  return rows[0]?.bloque ?? true;
}
