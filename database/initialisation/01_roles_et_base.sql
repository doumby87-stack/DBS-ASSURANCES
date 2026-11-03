-- =====================================================================
-- Initialisation : rôles et base de données
--
-- À exécuter UNE SEULE FOIS, par l'administrateur du serveur PostgreSQL,
-- connecté à la base « postgres » :
--
--   psql -v base=dbs -f database/initialisation/01_roles_et_base.sql
--
-- Aucun mot de passe n'est écrit ici. Définissez-les ensuite, par exemple :
--   \password dbs_proprietaire
--   \password dbs_application
-- et rangez-les dans le gestionnaire de secrets (docs/securite/gestion-des-secrets.md).
--
-- Rôles (principe du moindre privilège, voir docs/securite/controle-des-acces.md) :
--   dbs_proprietaire  possède les tables ; sert UNIQUEMENT aux migrations.
--   dbs_api           groupe sans connexion : droits de l'application, filtrés ligne par ligne.
--   dbs_application   compte de connexion de l'API ; hérite de dbs_api, rien de plus.
--   dbs_audit         groupe sans connexion : lecture et vérification du journal d'audit.
-- =====================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dbs_proprietaire') THEN
    CREATE ROLE dbs_proprietaire LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dbs_api') THEN
    CREATE ROLE dbs_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dbs_audit') THEN
    CREATE ROLE dbs_audit NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dbs_application') THEN
    CREATE ROLE dbs_application LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      CONNECTION LIMIT 40 IN ROLE dbs_api;
  END IF;
END
$$;

-- Garde-fous du compte applicatif : une requête bloquée ou une transaction oubliée ne paralyse pas la base
ALTER ROLE dbs_application SET statement_timeout = '15s';
ALTER ROLE dbs_application SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE dbs_application SET lock_timeout = '5s';

SELECT format('CREATE DATABASE %I OWNER dbs_proprietaire ENCODING ''UTF8''', :'base')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'base') \gexec

-- Personne ne se connecte à la base sans y être autorisé explicitement
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'base') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO dbs_api, dbs_audit', :'base') \gexec
-- Dates et échéances calculées à l'heure d'Abidjan
SELECT format('ALTER DATABASE %I SET timezone TO %L', :'base', 'Africa/Abidjan') \gexec
