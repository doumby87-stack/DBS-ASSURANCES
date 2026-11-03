-- =====================================================================
-- 0003 · Authentification du personnel
--
-- Identifiants (mot de passe haché, deuxième facteur chiffré), sessions et journal de
-- sécurité. Utilisé par l'API (apps/api/src/securite), conformément à l'ADR 0005.
--
-- La connexion a lieu AVANT que l'utilisateur soit connu : ces tables ne peuvent donc pas
-- être filtrées par utilisateur comme les tables métier. En contrepartie :
--   · aucune donnée n'y est stockée en clair : mots de passe hachés (Argon2id, contrôlé ici),
--     secrets du deuxième facteur chiffrés par l'API, jetons de session réduits à leur empreinte ;
--   · une fois un utilisateur déclaré dans la transaction, seul un gérant peut toucher
--     aux identifiants d'un autre ;
--   · le journal de sécurité est en ajout seul.
-- =====================================================================

CREATE TABLE securite.identifiants (
  utilisateur_id           uuid PRIMARY KEY REFERENCES app.utilisateurs (id),
  hash_mot_de_passe        text NOT NULL,
  -- Mot de passe donné par le gérant : à changer avant tout accès aux données
  mot_de_passe_provisoire  boolean NOT NULL DEFAULT true,
  mot_de_passe_modifie_le  timestamptz NOT NULL DEFAULT now(),
  -- Secret TOTP chiffré par l'API (AES-256-GCM, lié à l'utilisateur)
  totp_secret_chiffre      bytea,
  totp_active              boolean NOT NULL DEFAULT false,
  -- Dernier pas de temps TOTP accepté : un même code ne sert jamais deux fois
  totp_dernier_pas         bigint,
  echecs_consecutifs       integer NOT NULL DEFAULT 0,
  bloque_jusqu_a           timestamptz,
  CONSTRAINT identifiants_hash_argon2id CHECK (hash_mot_de_passe LIKE '$argon2id$%'),
  CONSTRAINT identifiants_totp_coherent CHECK (NOT totp_active OR totp_secret_chiffre IS NOT NULL),
  CONSTRAINT identifiants_echecs CHECK (echecs_consecutifs >= 0)
);
COMMENT ON TABLE securite.identifiants IS 'Jamais de mot de passe ni de secret en clair. Pas de journal d''audit sur cette table (il exposerait les empreintes) : les événements vont dans securite.evenements.';

CREATE TABLE securite.sessions (
  -- SHA-256 du jeton envoyé au navigateur : une copie de la base ne permet pas d'usurper une session
  empreinte          bytea PRIMARY KEY,
  utilisateur_id     uuid NOT NULL REFERENCES app.utilisateurs (id),
  -- 'mot_de_passe' : seul le deuxième facteur reste possible ; 'complet' : accès selon le rôle
  niveau             text NOT NULL,
  cree_le            timestamptz NOT NULL DEFAULT now(),
  derniere_activite  timestamptz NOT NULL DEFAULT now(),
  expire_le          timestamptz NOT NULL,
  fermee_le          timestamptz,
  adresse_ip         inet,
  agent_utilisateur  text,
  CONSTRAINT sessions_empreinte_longueur CHECK (octet_length(empreinte) = 32),
  CONSTRAINT sessions_niveau CHECK (niveau IN ('mot_de_passe', 'complet')),
  CONSTRAINT sessions_agent_longueur CHECK (agent_utilisateur IS NULL OR char_length(agent_utilisateur) <= 300)
);
CREATE INDEX sessions_ouvertes_idx ON securite.sessions (utilisateur_id) WHERE fermee_le IS NULL;

CREATE TABLE securite.evenements (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  horodatage      timestamptz NOT NULL DEFAULT now(),
  type            text NOT NULL,
  utilisateur_id  uuid REFERENCES app.utilisateurs (id),
  -- Adresse saisie lors d'une tentative de connexion (utile même si elle ne correspond à aucun compte)
  email           text,
  adresse_ip      inet,
  -- Qui a déclenché l'action quand ce n'est pas l'utilisateur lui-même (gérant)
  auteur_id       uuid REFERENCES app.utilisateurs (id),
  CONSTRAINT evenements_type CHECK (type IN (
    'connexion_reussie', 'connexion_echouee', 'mfa_echoue', 'compte_bloque', 'mfa_active',
    'mot_de_passe_modifie', 'acces_reinitialise', 'compte_cree', 'compte_modifie', 'deconnexion'
  )),
  CONSTRAINT evenements_email_longueur CHECK (email IS NULL OR char_length(email) <= 254)
);
CREATE INDEX evenements_echecs_ip_idx ON securite.evenements (adresse_ip, horodatage)
  WHERE type IN ('connexion_echouee', 'mfa_echoue');
CREATE INDEX evenements_utilisateur_idx ON securite.evenements (utilisateur_id, horodatage);

-- ---------------------------------------------------------------------
-- Garde-fous
-- ---------------------------------------------------------------------
CREATE FUNCTION securite.controler_identifiants() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v text := current_setting('app.utilisateur_id', true);
BEGIN
  -- Pendant la connexion, personne n'est encore déclaré. Ensuite, seul un gérant
  -- crée ou modifie les identifiants d'un autre utilisateur.
  IF v IS NOT NULL AND v <> '' AND v::uuid <> NEW.utilisateur_id
     AND securite.role_courant() <> 'gerant' THEN
    RAISE EXCEPTION 'Seul un gérant peut modifier les identifiants d''un autre utilisateur'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER b_controle BEFORE INSERT OR UPDATE ON securite.identifiants
  FOR EACH ROW EXECUTE FUNCTION securite.controler_identifiants();

CREATE FUNCTION securite.interdire_modification() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Le journal de sécurité est en ajout seul : % interdit', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER evenements_ajout_seul BEFORE UPDATE OR DELETE ON securite.evenements
  FOR EACH ROW EXECUTE FUNCTION securite.interdire_modification();
CREATE TRIGGER evenements_pas_de_vidage BEFORE TRUNCATE ON securite.evenements
  FOR EACH STATEMENT EXECUTE FUNCTION securite.interdire_modification();

-- ---------------------------------------------------------------------
-- Fonctions de lecture utilisées avant que l'utilisateur soit déclaré
-- (SECURITY DEFINER : la table des utilisateurs est filtrée par utilisateur)
-- ---------------------------------------------------------------------

-- Identifiants d'un compte ACTIF, à partir de l'adresse saisie à la connexion
CREATE FUNCTION securite.lire_identifiants(p_email text)
RETURNS TABLE (
  utilisateur_id uuid, hash_mot_de_passe text, mot_de_passe_provisoire boolean, totp_active boolean,
  echecs_consecutifs integer, bloque_jusqu_a timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT i.utilisateur_id, i.hash_mot_de_passe, i.mot_de_passe_provisoire, i.totp_active,
         i.echecs_consecutifs, i.bloque_jusqu_a
  FROM securite.identifiants i
  JOIN app.utilisateurs u ON u.id = i.utilisateur_id
  WHERE u.email = lower(btrim(p_email)) AND u.actif
$$;

-- Session valide (ouverte, non expirée, utilisée récemment, compte actif) : la prolonge
-- et renvoie l'utilisateur. Aucune ligne = session refusée.
CREATE FUNCTION securite.lire_session(p_empreinte bytea, p_inactivite interval)
RETURNS TABLE (
  utilisateur_id uuid, niveau text, expire_le timestamptz, email text, nom text,
  role app.role_utilisateur, mot_de_passe_provisoire boolean, totp_active boolean
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  UPDATE securite.sessions s
  SET derniere_activite = now()
  FROM app.utilisateurs u, securite.identifiants i
  WHERE s.empreinte = p_empreinte
    AND s.fermee_le IS NULL
    AND s.expire_le > now()
    AND s.derniere_activite > now() - p_inactivite
    AND u.id = s.utilisateur_id AND u.actif
    AND i.utilisateur_id = s.utilisateur_id
  RETURNING s.utilisateur_id, s.niveau, s.expire_le, u.email, u.nom, u.role,
            i.mot_de_passe_provisoire, i.totp_active
$$;

-- ---------------------------------------------------------------------
-- Droits : lecture, ajout et modification de colonnes précises. Jamais de suppression.
-- ---------------------------------------------------------------------
REVOKE ALL ON securite.identifiants, securite.sessions, securite.evenements FROM PUBLIC;

GRANT SELECT, INSERT ON securite.identifiants TO dbs_api;
GRANT UPDATE (hash_mot_de_passe, mot_de_passe_provisoire, mot_de_passe_modifie_le, totp_secret_chiffre,
              totp_active, totp_dernier_pas, echecs_consecutifs, bloque_jusqu_a)
  ON securite.identifiants TO dbs_api;

GRANT SELECT, INSERT ON securite.sessions TO dbs_api;
GRANT UPDATE (derniere_activite, fermee_le) ON securite.sessions TO dbs_api;

GRANT SELECT, INSERT ON securite.evenements TO dbs_api;

GRANT EXECUTE ON FUNCTION securite.lire_identifiants(text), securite.lire_session(bytea, interval) TO dbs_api;

-- Le rôle d'audit lit le journal de sécurité, rien d'autre dans ce schéma
GRANT USAGE ON SCHEMA securite TO dbs_audit;
GRANT SELECT ON securite.evenements TO dbs_audit;
