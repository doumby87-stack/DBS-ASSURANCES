// Comptes du personnel. Lecture pour tous ; création, modification et réinitialisation par un gérant.
// Les mêmes règles sont appliquées par la base (politiques sur app.utilisateurs, garde-fou sur les identifiants).

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { consignerEvenement } from "../../securite/limitation.js";
import { fermerSessionsUtilisateur, type Role } from "../../securite/sessions.js";
import { preparerAccesProvisoire } from "./acces.js";

const ROLES: Role[] = ["gerant", "charge_clientele", "caissier", "commercial", "apporteur", "auditeur"];
const COLONNES = "id, email, nom, role, actif, cree_le AS \"creeLe\"";

interface Utilisateur {
  id: string;
  email: string;
  nom: string;
  role: Role;
  actif: boolean;
  creeLe: Date;
}

const schemaParametres = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

const actionSurSoi = () =>
  new ErreurApi(422, "action_sur_soi_interdite", "Pour vos propres droits ou votre accès, adressez-vous à un autre gérant.");

export async function routesUtilisateurs(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;

  app.get("/utilisateurs", { preHandler: gardes.sessionComplete() }, async (requete) => {
    const moi = utilisateurDe(requete);
    const { rows } = await transactionUtilisateur(pool, moi.id, (client) =>
      client.query<Utilisateur>(`SELECT ${COLONNES} FROM app.utilisateurs ORDER BY nom`),
    );
    return { utilisateurs: rows };
  });

  app.post<{ Body: { email: string; nom: string; role: Role } }>(
    "/utilisateurs",
    {
      preHandler: gardes.roles("gerant"),
      schema: {
        body: {
          type: "object",
          required: ["email", "nom", "role"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            nom: { type: "string", minLength: 2, maxLength: 120 },
            role: { type: "string", enum: ROLES },
          },
        },
      },
    },
    async (requete, reponse) => {
      const moi = utilisateurDe(requete);
      const acces = await preparerAccesProvisoire();
      const utilisateur = await transactionUtilisateur(pool, moi.id, async (client) => {
        const { rows } = await client.query<Utilisateur>(
          `INSERT INTO app.utilisateurs (email, nom, role) VALUES (lower(btrim($1)), btrim($2), $3) RETURNING ${COLONNES}`,
          [requete.body.email, requete.body.nom, requete.body.role],
        );
        const cree = rows[0]!;
        await client.query("INSERT INTO securite.identifiants (utilisateur_id, hash_mot_de_passe) VALUES ($1, $2)", [
          cree.id, acces.empreinte,
        ]);
        await consignerEvenement(client, "compte_cree", { utilisateurId: cree.id, auteurId: moi.id, ip: requete.ip });
        return cree;
      });
      // Le mot de passe provisoire n'est montré qu'ici, une seule fois, au gérant qui le remet en main propre
      return reponse.status(201).send({ utilisateur, motDePasseProvisoire: acces.motDePasse });
    },
  );

  app.patch<{ Params: { id: string }; Body: { nom?: string; role?: Role; actif?: boolean } }>(
    "/utilisateurs/:id",
    {
      preHandler: gardes.roles("gerant"),
      schema: {
        params: schemaParametres,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            nom: { type: "string", minLength: 2, maxLength: 120 },
            role: { type: "string", enum: ROLES },
            actif: { type: "boolean" },
          },
        },
      },
    },
    async (requete) => {
      const moi = utilisateurDe(requete);
      const { id } = requete.params;
      const { nom, role, actif } = requete.body;
      // Un gérant ne retire pas ses propres droits : l'agence ne doit jamais se retrouver sans gérant
      if (id === moi.id && ((role !== undefined && role !== "gerant") || actif === false)) throw actionSurSoi();

      const utilisateur = await transactionUtilisateur(pool, moi.id, async (client) => {
        const { rows } = await client.query<Utilisateur>(
          `UPDATE app.utilisateurs
           SET nom = coalesce(btrim($2), nom), role = coalesce($3, role), actif = coalesce($4, actif)
           WHERE id = $1
           RETURNING ${COLONNES}`,
          [id, nom ?? null, role ?? null, actif ?? null],
        );
        const modifie = rows[0];
        if (!modifie) return null;
        // Désactivation ou changement de rôle : les sessions ouvertes sont fermées sur-le-champ
        if (actif === false || role !== undefined) await fermerSessionsUtilisateur(client, id);
        await consignerEvenement(client, "compte_modifie", { utilisateurId: id, auteurId: moi.id, ip: requete.ip });
        return modifie;
      });
      if (!utilisateur) throw erreurs.introuvable();
      return { utilisateur };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/utilisateurs/:id/reinitialiser-acces",
    { preHandler: gardes.roles("gerant"), schema: { params: schemaParametres } },
    async (requete) => {
      const moi = utilisateurDe(requete);
      const { id } = requete.params;
      if (id === moi.id) throw actionSurSoi();
      const acces = await preparerAccesProvisoire();
      const trouve = await transactionUtilisateur(pool, moi.id, async (client) => {
        const { rowCount } = await client.query(
          `UPDATE securite.identifiants
           SET hash_mot_de_passe = $2, mot_de_passe_provisoire = true, mot_de_passe_modifie_le = now(),
               totp_secret_chiffre = NULL, totp_active = false, totp_dernier_pas = NULL,
               echecs_consecutifs = 0, bloque_jusqu_a = NULL
           WHERE utilisateur_id = $1`,
          [id, acces.empreinte],
        );
        if (!rowCount) return false;
        await fermerSessionsUtilisateur(client, id);
        await consignerEvenement(client, "acces_reinitialise", { utilisateurId: id, auteurId: moi.id, ip: requete.ip });
        return true;
      });
      if (!trouve) throw erreurs.introuvable();
      return { motDePasseProvisoire: acces.motDePasse };
    },
  );
}
