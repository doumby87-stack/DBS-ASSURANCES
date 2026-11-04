// Connexion du personnel (ADR 0005) :
//   1. POST /auth/connexion          e-mail + mot de passe → session partielle (5 min)
//   2. POST /auth/mfa/configuration  première fois : création du secret du deuxième facteur (QR code)
//      POST /auth/mfa/activation     première fois : premier code → connexion complète
//      POST /auth/mfa                ensuite : code à 6 chiffres → connexion complète
//   3. POST /auth/mot-de-passe       obligatoire si le mot de passe est provisoire
//   GET /auth/session, POST /auth/deconnexion
//
// Les échecs sont enregistrés AVANT de répondre : la transaction est validée, puis l'erreur renvoyée.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Configuration } from "../config/configuration.js";
import type { Pool } from "../base-de-donnees/connexion.js";
import { transactionSysteme, transactionUtilisateur } from "../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../commun/erreurs.js";
import { chiffrer, dechiffrer } from "./chiffrement.js";
import type { Gardes } from "./gardes.js";
import { utilisateurDe } from "./gardes.js";
import { adresseSuspendue, compteBloque, consignerEvenement, enregistrerEchec } from "./limitation.js";
import type { VerificateurFuite } from "./mots-de-passe.js";
import {
  controlerPolitique, doitEtreRehache, hacherMotDePasse, LONGUEUR_MAX, verifierLeurre, verifierMotDePasse,
} from "./mots-de-passe.js";
import {
  effacerCookieSession, fermerSession, fermerSessionsUtilisateur, lireSession, ouvrirSession, poserCookieSession,
} from "./sessions.js";
import { encoderBase32, genererSecretTotp, uriOtpauth, verifierCodeTotp } from "./totp.js";

export interface OptionsAuthentification {
  config: Configuration;
  pool: Pool;
  gardes: Gardes;
  horloge: () => number;
  verifierFuite: VerificateurFuite | null;
}

const schemaCode = {
  type: "object",
  required: ["code"],
  additionalProperties: false,
  properties: { code: { type: "string", pattern: "^[0-9]{6}$" } },
} as const;

/** Contexte de chiffrement du secret TOTP : lié à son propriétaire. */
const contexteTotp = (utilisateurId: string) => `totp:${utilisateurId}`;

export async function routesAuthentification(app: FastifyInstance, options: OptionsAuthentification): Promise<void> {
  const { config, pool, gardes, horloge, verifierFuite } = options;

  /** Remplace la session courante par une session complète (nouveau jeton). */
  async function terminerConnexion(requete: FastifyRequest, reponse: FastifyReply, ancienne: Buffer, utilisateurId: string) {
    const { jeton, expireLe } = await transactionUtilisateur(pool, utilisateurId, async (client) => {
      await fermerSession(client, ancienne);
      await consignerEvenement(client, "connexion_reussie", { utilisateurId, ip: requete.ip });
      return ouvrirSession(client, utilisateurId, "complet", requete);
    });
    poserCookieSession(reponse, jeton, expireLe);
  }

  app.post<{ Body: { email: string; motDePasse: string } }>(
    "/auth/connexion",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "motDePasse"],
          additionalProperties: false,
          properties: {
            email: { type: "string", minLength: 3, maxLength: 254 },
            motDePasse: { type: "string", minLength: 1, maxLength: LONGUEUR_MAX },
          },
        },
      },
    },
    async (requete, reponse) => {
      const email = requete.body.email.trim().toLowerCase();
      const { motDePasse } = requete.body;
      const ip = requete.ip;

      const resultat = await transactionSysteme(pool, async (client) => {
        if (await adresseSuspendue(client, ip)) return { statut: "suspendu" as const };

        const { rows } = await client.query<{
          utilisateur_id: string; hash_mot_de_passe: string; totp_active: boolean; bloque: boolean;
        }>(
          `SELECT utilisateur_id, hash_mot_de_passe, totp_active, coalesce(bloque_jusqu_a > now(), false) AS bloque
           FROM securite.lire_identifiants($1)`,
          [email],
        );
        const compte = rows[0];

        // Compte inconnu, désactivé ou bloqué : même réponse, même durée de calcul
        if (!compte || compte.bloque) {
          await verifierLeurre(motDePasse);
          await consignerEvenement(client, "connexion_echouee", { utilisateurId: compte?.utilisateur_id, email, ip });
          return { statut: "refuse" as const };
        }
        if (!(await verifierMotDePasse(compte.hash_mot_de_passe, motDePasse))) {
          await enregistrerEchec(client, compte.utilisateur_id, ip);
          await consignerEvenement(client, "connexion_echouee", { utilisateurId: compte.utilisateur_id, email, ip });
          return { statut: "refuse" as const };
        }
        if (doitEtreRehache(compte.hash_mot_de_passe)) {
          await client.query("UPDATE securite.identifiants SET hash_mot_de_passe = $2 WHERE utilisateur_id = $1", [
            compte.utilisateur_id, await hacherMotDePasse(motDePasse),
          ]);
        }
        const session = await ouvrirSession(client, compte.utilisateur_id, "mot_de_passe", requete);
        return { statut: "accepte" as const, session, totpActive: compte.totp_active };
      });

      if (resultat.statut === "suspendu") throw erreurs.tropDeTentatives();
      if (resultat.statut === "refuse") throw erreurs.identifiantsInvalides();
      poserCookieSession(reponse, resultat.session.jeton, resultat.session.expireLe);
      return { etape: resultat.totpActive ? "mfa" : "configuration_mfa" };
    },
  );

  app.post("/auth/mfa/configuration", { preHandler: gardes.sessionPartielle }, async (requete) => {
    const utilisateur = utilisateurDe(requete);
    if (utilisateur.totpActive) throw new ErreurApi(409, "mfa_deja_active", "Le deuxième facteur est déjà activé.");
    const secret = genererSecretTotp();
    await transactionUtilisateur(pool, utilisateur.id, (client) =>
      client.query(
        "UPDATE securite.identifiants SET totp_secret_chiffre = $2 WHERE utilisateur_id = $1 AND NOT totp_active",
        [utilisateur.id, chiffrer(config.cleChiffrement, secret, contexteTotp(utilisateur.id))],
      ),
    );
    // Affiché une seule fois, pour être scanné ; jamais renvoyé ensuite
    return { secret: encoderBase32(secret), uri: uriOtpauth(secret, utilisateur.email) };
  });

  /** Vérifie le code ; en cas de succès, enregistre le pas utilisé (anti-rejeu) et remet le compteur à zéro. */
  async function verifierCode(requete: FastifyRequest, code: string, activation: boolean): Promise<void> {
    const utilisateur = utilisateurDe(requete);
    const resultat = await transactionUtilisateur(pool, utilisateur.id, async (client) => {
      if (await compteBloque(client, utilisateur.id)) return "refuse";
      const { rows } = await client.query<{ totp_secret_chiffre: Buffer | null; totp_dernier_pas: number | null; totp_active: boolean }>(
        "SELECT totp_secret_chiffre, totp_dernier_pas, totp_active FROM securite.identifiants WHERE utilisateur_id = $1 FOR UPDATE",
        [utilisateur.id],
      );
      const ligne = rows[0];
      if (!ligne?.totp_secret_chiffre || ligne.totp_active === activation) return "non_configure";

      const secret = dechiffrer(config.cleChiffrement, ligne.totp_secret_chiffre, contexteTotp(utilisateur.id));
      const pas = verifierCodeTotp(secret, code, horloge(), ligne.totp_dernier_pas);
      if (pas === null) {
        await enregistrerEchec(client, utilisateur.id, requete.ip);
        await consignerEvenement(client, "mfa_echoue", { utilisateurId: utilisateur.id, ip: requete.ip });
        return "refuse";
      }
      await client.query(
        `UPDATE securite.identifiants
         SET totp_active = true, totp_dernier_pas = $2, echecs_consecutifs = 0, bloque_jusqu_a = NULL
         WHERE utilisateur_id = $1`,
        [utilisateur.id, pas],
      );
      if (activation) await consignerEvenement(client, "mfa_active", { utilisateurId: utilisateur.id, ip: requete.ip });
      return "accepte";
    });
    if (resultat === "non_configure") {
      throw activation
        ? new ErreurApi(409, "mfa_non_configuree", "Commencez par configurer le deuxième facteur.")
        : new ErreurApi(409, "mfa_non_active", "Le deuxième facteur n'est pas encore activé.");
    }
    if (resultat === "refuse") throw erreurs.codeInvalide();
  }

  app.post<{ Body: { code: string } }>(
    "/auth/mfa/activation",
    { preHandler: gardes.sessionPartielle, schema: { body: schemaCode } },
    async (requete, reponse) => {
      const utilisateur = utilisateurDe(requete);
      await verifierCode(requete, requete.body.code, true);
      await terminerConnexion(requete, reponse, utilisateur.empreinte, utilisateur.id);
      return { etape: "terminee", motDePasseProvisoire: utilisateur.motDePasseProvisoire };
    },
  );

  app.post<{ Body: { code: string } }>(
    "/auth/mfa",
    { preHandler: gardes.sessionPartielle, schema: { body: schemaCode } },
    async (requete, reponse) => {
      const utilisateur = utilisateurDe(requete);
      await verifierCode(requete, requete.body.code, false);
      await terminerConnexion(requete, reponse, utilisateur.empreinte, utilisateur.id);
      return { etape: "terminee", motDePasseProvisoire: utilisateur.motDePasseProvisoire };
    },
  );

  app.get("/auth/session", { preHandler: gardes.sessionComplete({ autoriserMotDePasseProvisoire: true }) }, async (requete) => {
    const u = utilisateurDe(requete);
    return {
      utilisateur: { id: u.id, email: u.email, nom: u.nom, role: u.role },
      motDePasseProvisoire: u.motDePasseProvisoire,
      expireLe: u.expireLe.toISOString(),
    };
  });

  app.post<{ Body: { actuel: string; nouveau: string } }>(
    "/auth/mot-de-passe",
    {
      preHandler: gardes.sessionComplete({ autoriserMotDePasseProvisoire: true }),
      schema: {
        body: {
          type: "object",
          required: ["actuel", "nouveau"],
          additionalProperties: false,
          properties: {
            actuel: { type: "string", minLength: 1, maxLength: LONGUEUR_MAX },
            nouveau: { type: "string", minLength: 1, maxLength: LONGUEUR_MAX },
          },
        },
      },
    },
    async (requete, reponse) => {
      const utilisateur = utilisateurDe(requete);
      const { actuel, nouveau } = requete.body;

      const refus = controlerPolitique(nouveau, utilisateur.email);
      if (refus) throw new ErreurApi(422, "mot_de_passe_trop_faible", refus);
      if (nouveau === actuel) throw new ErreurApi(422, "mot_de_passe_identique", "Choisissez un mot de passe différent de l'actuel.");
      if (verifierFuite) {
        const divulgue = await verifierFuite(nouveau);
        if (divulgue === null) requete.log.warn("vérification des mots de passe divulgués indisponible");
        if (divulgue) {
          throw new ErreurApi(422, "mot_de_passe_divulgue",
            "Ce mot de passe figure dans des fuites de données connues. Choisissez-en un autre.");
        }
      }
      const nouvelleEmpreinte = await hacherMotDePasse(nouveau);

      const resultat = await transactionUtilisateur(pool, utilisateur.id, async (client) => {
        const { rows } = await client.query<{ hash_mot_de_passe: string }>(
          "SELECT hash_mot_de_passe FROM securite.identifiants WHERE utilisateur_id = $1 FOR UPDATE",
          [utilisateur.id],
        );
        if (!rows[0] || !(await verifierMotDePasse(rows[0].hash_mot_de_passe, actuel))) {
          await enregistrerEchec(client, utilisateur.id, requete.ip);
          await consignerEvenement(client, "connexion_echouee", { utilisateurId: utilisateur.id, ip: requete.ip });
          return null;
        }
        await client.query(
          `UPDATE securite.identifiants
           SET hash_mot_de_passe = $2, mot_de_passe_provisoire = false, mot_de_passe_modifie_le = now()
           WHERE utilisateur_id = $1`,
          [utilisateur.id, nouvelleEmpreinte],
        );
        await consignerEvenement(client, "mot_de_passe_modifie", { utilisateurId: utilisateur.id, ip: requete.ip });
        // Toutes les autres sessions sont fermées ; la session courante reçoit un nouveau jeton
        await fermerSessionsUtilisateur(client, utilisateur.id);
        return ouvrirSession(client, utilisateur.id, "complet", requete);
      });
      if (!resultat) {
        throw new ErreurApi(400, "mot_de_passe_actuel_incorrect", "Le mot de passe actuel est incorrect.");
      }
      poserCookieSession(reponse, resultat.jeton, resultat.expireLe);
      return { motDePasseProvisoire: false };
    },
  );

  app.post("/auth/deconnexion", async (requete, reponse) => {
    const session = await lireSession(pool, requete);
    if (session) {
      await transactionUtilisateur(pool, session.id, async (client) => {
        await fermerSession(client, session.empreinte);
        await consignerEvenement(client, "deconnexion", { utilisateurId: session.id, ip: requete.ip });
      });
    }
    effacerCookieSession(reponse);
    return reponse.status(204).send();
  });
}
