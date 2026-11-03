-- =====================================================================
-- 0001 · Socle de sécurité
--
-- Schémas cloisonnés, utilisateurs et rôles métier, identité de l'utilisateur
-- dans chaque transaction, journal d'audit chaîné et en ajout seul.
-- Exécutée par dbs_proprietaire (database/migrer.sh).
-- Conception : docs/architecture/adr/0004-securite-dans-la-base.md
-- =====================================================================

-- Rien n'est accessible par défaut : chaque droit est accordé explicitement plus bas
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE SCHEMA app;       -- données métier
CREATE SCHEMA securite;  -- identité de l'utilisateur courant, fonctions de contrôle
CREATE SCHEMA audit;     -- journal d'audit, invisible pour l'application
REVOKE ALL ON SCHEMA app, securite, audit FROM PUBLIC;
GRANT USAGE ON SCHEMA app, securite TO dbs_api;
GRANT USAGE ON SCHEMA audit TO dbs_audit;

-- ---------------------------------------------------------------------
-- Utilisateurs de l'agence et rôles métier
-- (identifiants de connexion et secrets MFA : gérés par l'API, hors de cette table)
-- ---------------------------------------------------------------------
CREATE TYPE app.role_utilisateur AS ENUM (
  'gerant',            -- tous les droits, valide les reversements et les annulations
  'charge_clientele',  -- clients, contrats, sinistres
  'caissier',          -- encaissements et préparation des reversements
  'commercial',        -- prospects et clients, sans accès à la caisse
  'apporteur',         -- uniquement les clients qu'il apporte
  'auditeur'           -- lecture seule
);

CREATE TABLE app.utilisateurs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email     text NOT NULL,
  nom       text NOT NULL,
  role      app.role_utilisateur NOT NULL,
  actif     boolean NOT NULL DEFAULT true,
  cree_le   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT utilisateurs_email_unique UNIQUE (email),
  CONSTRAINT utilisateurs_email_format CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  CONSTRAINT utilisateurs_nom_longueur CHECK (char_length(btrim(nom)) BETWEEN 2 AND 120)
);
COMMENT ON TABLE app.utilisateurs IS 'Personnel de l''agence. Un utilisateur désactivé perd immédiatement tout accès, même avec une session ouverte.';

-- ---------------------------------------------------------------------
-- Identité de l'utilisateur courant
-- L'API, après avoir authentifié la personne (mot de passe + MFA), ouvre chaque
-- transaction par : SELECT set_config('app.utilisateur_id', '<uuid>', true);
-- Sans cette valeur, toute lecture ou écriture métier échoue (fermeture par défaut).
-- ---------------------------------------------------------------------
CREATE FUNCTION securite.utilisateur_courant() RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v text := current_setting('app.utilisateur_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'Aucun utilisateur authentifié dans cette transaction (app.utilisateur_id absent)'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  RETURN v::uuid;
END
$$;

-- SECURITY DEFINER : lit la table des utilisateurs sans dépendre des droits de l'appelant.
-- search_path figé pour qu'aucun objet homonyme ne puisse être substitué.
CREATE FUNCTION securite.role_courant() RETURNS app.role_utilisateur
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  r app.role_utilisateur;
BEGIN
  SELECT u.role INTO r
  FROM app.utilisateurs u
  WHERE u.id = securite.utilisateur_courant() AND u.actif;
  IF r IS NULL THEN
    RAISE EXCEPTION 'Utilisateur inconnu ou désactivé'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  RETURN r;
END
$$;

CREATE FUNCTION securite.a_le_role(VARIADIC roles app.role_utilisateur[]) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$ SELECT securite.role_courant() = ANY (roles) $$;

GRANT EXECUTE ON FUNCTION securite.utilisateur_courant(), securite.role_courant(),
  securite.a_le_role(app.role_utilisateur[]) TO dbs_api;

-- Renseigne l'auteur (et la date) d'une ligne à partir de l'utilisateur authentifié :
-- l'application ne peut pas écrire au nom de quelqu'un d'autre.
-- Arguments : nom de la colonne auteur, puis (facultatif) nom de la colonne date.
CREATE FUNCTION securite.renseigner_auteur() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], securite.utilisateur_courant()));
  IF TG_NARGS > 1 THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[1], now()));
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------
-- Journal d'audit
-- Chaque écriture métier y est consignée (avant / après, auteur, date).
-- Chaque ligne contient l'empreinte SHA-256 de la précédente : modifier ou
-- supprimer une ligne du milieu casse la chaîne, ce que audit.verifier_chaine() détecte.
-- ---------------------------------------------------------------------
CREATE TABLE audit.journal (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  horodatage            timestamptz NOT NULL,
  utilisateur_id        uuid,
  role_bd               text NOT NULL,
  operation             text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  table_nom             text NOT NULL,
  ligne_id              text,
  avant                 jsonb,
  apres                 jsonb,
  empreinte_precedente  bytea,
  empreinte             bytea NOT NULL
);
CREATE INDEX journal_ligne_idx ON audit.journal (table_nom, ligne_id);

-- Chaque champ est préfixé par sa longueur : impossible de déplacer une frontière entre deux champs.
CREATE FUNCTION audit.calculer_empreinte(
  precedente bytea, horodatage timestamptz, utilisateur_id uuid, role_bd text,
  operation text, table_nom text, ligne_id text, avant jsonb, apres jsonb
) RETURNS bytea
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT sha256(convert_to(
    (SELECT string_agg(length(v)::text || ':' || v, '' ORDER BY i)
     FROM unnest(ARRAY[
       coalesce(encode(precedente, 'hex'), ''),
       extract(epoch FROM horodatage)::text,
       coalesce(utilisateur_id::text, ''),
       role_bd, operation, table_nom,
       coalesce(ligne_id, ''),
       coalesce(avant::text, ''),
       coalesce(apres::text, '')
     ]) WITH ORDINALITY AS t(v, i)),
    'UTF8'))
$$;

CREATE FUNCTION audit.journaliser() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_utilisateur uuid := nullif(current_setting('app.utilisateur_id', true), '')::uuid;
  v_avant jsonb;
  v_apres jsonb;
  v_ligne text;
  v_precedente bytea;
  v_horodatage timestamptz;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_avant := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_apres := to_jsonb(NEW); END IF;
  v_ligne := coalesce(v_apres, v_avant) ->> 'id';

  -- Une écriture à la fois dans le journal, jusqu'à la fin de la transaction : la chaîne reste linéaire
  PERFORM pg_advisory_xact_lock(hashtext('audit.journal'));
  v_horodatage := clock_timestamp();
  SELECT j.empreinte INTO v_precedente FROM audit.journal j ORDER BY j.id DESC LIMIT 1;

  INSERT INTO audit.journal (horodatage, utilisateur_id, role_bd, operation, table_nom, ligne_id,
                             avant, apres, empreinte_precedente, empreinte)
  VALUES (v_horodatage, v_utilisateur, session_user, TG_OP, TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, v_ligne,
          v_avant, v_apres, v_precedente,
          audit.calculer_empreinte(v_precedente, v_horodatage, v_utilisateur, session_user, TG_OP,
                                   TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, v_ligne, v_avant, v_apres));
  RETURN NULL;
END
$$;

CREATE FUNCTION audit.interdire_modification() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit est en ajout seul : % interdit', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER journal_ajout_seul BEFORE UPDATE OR DELETE ON audit.journal
  FOR EACH ROW EXECUTE FUNCTION audit.interdire_modification();
CREATE TRIGGER journal_pas_de_vidage BEFORE TRUNCATE ON audit.journal
  FOR EACH STATEMENT EXECUTE FUNCTION audit.interdire_modification();

-- Parcourt la chaîne et renvoie la première ligne dont l'empreinte ne correspond pas
-- (premiere_anomalie vide : journal intègre). La suppression des dernières lignes n'est
-- pas détectable ainsi : la dernière empreinte est donc copiée chaque jour hors de la base
-- (docs/securite/journalisation-et-audit.md).
CREATE FUNCTION audit.verifier_chaine()
RETURNS TABLE (lignes_verifiees bigint, premiere_anomalie bigint, derniere_empreinte text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  r audit.journal;
  v_precedente bytea := NULL;
  n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit.journal ORDER BY id LOOP
    IF r.empreinte_precedente IS DISTINCT FROM v_precedente
       OR r.empreinte IS DISTINCT FROM audit.calculer_empreinte(
            r.empreinte_precedente, r.horodatage, r.utilisateur_id, r.role_bd, r.operation,
            r.table_nom, r.ligne_id, r.avant, r.apres) THEN
      lignes_verifiees := n;
      premiere_anomalie := r.id;
      derniere_empreinte := encode(v_precedente, 'hex');
      RETURN NEXT;
      RETURN;
    END IF;
    v_precedente := r.empreinte;
    n := n + 1;
  END LOOP;
  lignes_verifiees := n;
  premiere_anomalie := NULL;
  derniere_empreinte := encode(v_precedente, 'hex');
  RETURN NEXT;
END
$$;

REVOKE ALL ON audit.journal FROM PUBLIC;
GRANT SELECT ON audit.journal TO dbs_audit;
GRANT EXECUTE ON FUNCTION audit.verifier_chaine() TO dbs_audit;

-- ---------------------------------------------------------------------
-- Droits sur les utilisateurs
-- Le premier gérant est créé par dbs_proprietaire (database/initialisation/02_premier_gerant.sql).
-- ---------------------------------------------------------------------
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.utilisateurs
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

ALTER TABLE app.utilisateurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY utilisateurs_lecture ON app.utilisateurs FOR SELECT TO dbs_api
  USING ((SELECT securite.role_courant()) IS NOT NULL);
CREATE POLICY utilisateurs_creation ON app.utilisateurs FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant')));
CREATE POLICY utilisateurs_modification ON app.utilisateurs FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant')))
  WITH CHECK ((SELECT securite.a_le_role('gerant')));

GRANT SELECT, INSERT ON app.utilisateurs TO dbs_api;
GRANT UPDATE (nom, role, actif) ON app.utilisateurs TO dbs_api;
