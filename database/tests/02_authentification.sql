-- =====================================================================
-- Tests de la migration 0003 : identifiants, sessions, journal de sécurité.
-- S'exécute après 01_securite_et_regles.sql, dont il réutilise le personnel de test.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

-- Empreinte Argon2id factice (format seulement : ces tests ne vérifient pas de mot de passe)
\set hash_factice '$argon2id$v=19$m=19456,t=2,p=1$c2VsZGV0ZXN0$aGFzaGRldGVzdGFhYWFhYWFhYWFhYWFhYWFhYWFhYWE'

\echo
\echo '11. Identifiants : jamais en clair, et seul un gérant touche à ceux des autres'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
INSERT INTO securite.identifiants (utilisateur_id, hash_mot_de_passe) VALUES
  ('10000000-0000-4000-8000-000000000001', :'hash_factice'),
  ('10000000-0000-4000-8000-000000000003', :'hash_factice'),
  ('10000000-0000-4000-8000-000000000007', :'hash_factice');
SELECT tests.verifier(true, 'le gérant crée les identifiants des membres du personnel');
SELECT tests.doit_echouer($q$INSERT INTO securite.identifiants (utilisateur_id, hash_mot_de_passe)
  VALUES ('10000000-0000-4000-8000-000000000004', 'motdepasse-en-clair')$q$, 'identifiants_hash_argon2id');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
UPDATE securite.identifiants SET mot_de_passe_provisoire = false
WHERE utilisateur_id = '10000000-0000-4000-8000-000000000003';
SELECT tests.verifier(true, 'chacun modifie ses propres identifiants');
SELECT tests.doit_echouer($q$UPDATE securite.identifiants SET echecs_consecutifs = 0, bloque_jusqu_a = NULL
  WHERE utilisateur_id = '10000000-0000-4000-8000-000000000001'$q$, 'Seul un gérant');
SELECT tests.doit_echouer($q$INSERT INTO securite.identifiants (utilisateur_id, hash_mot_de_passe)
  VALUES ('10000000-0000-4000-8000-000000000005', '$argon2id$v=19$m=19456,t=2,p=1$abc$def')$q$, 'Seul un gérant');
SELECT tests.doit_echouer($q$DELETE FROM securite.identifiants$q$, 'permission denied');
ROLLBACK;

\echo
\echo '12. Lecture des identifiants à la connexion : comptes actifs seulement'
BEGIN;
SET LOCAL ROLE dbs_api;  -- aucun utilisateur déclaré, comme au moment de la connexion
SELECT tests.verifier((SELECT utilisateur_id FROM securite.lire_identifiants('  CAISSE@test.ci '))
                      = '10000000-0000-4000-8000-000000000003', 'adresse retrouvée sans tenir compte des majuscules ni des espaces');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM securite.lire_identifiants('apporteur2@test.ci')),
                      'un compte désactivé ne peut pas se connecter');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM securite.lire_identifiants('inconnu@test.ci')),
                      'adresse inconnue : aucune ligne');
ROLLBACK;

\echo
\echo '13. Sessions : ouvertes, récentes, non expirées, compte actif'
BEGIN;
SET LOCAL ROLE dbs_api;
INSERT INTO securite.sessions (empreinte, utilisateur_id, niveau, expire_le) VALUES
  (sha256('jeton-valide'), '10000000-0000-4000-8000-000000000003', 'complet', now() + interval '8 hours'),
  (sha256('jeton-inactif'), '10000000-0000-4000-8000-000000000003', 'complet', now() + interval '8 hours'),
  (sha256('jeton-expire'), '10000000-0000-4000-8000-000000000003', 'complet', now() - interval '1 second'),
  (sha256('jeton-ferme'), '10000000-0000-4000-8000-000000000003', 'complet', now() + interval '8 hours'),
  (sha256('jeton-desactive'), '10000000-0000-4000-8000-000000000007', 'complet', now() + interval '8 hours');
SELECT tests.doit_echouer($q$INSERT INTO securite.sessions (empreinte, utilisateur_id, niveau, expire_le)
  VALUES ('\x01', '10000000-0000-4000-8000-000000000003', 'complet', now())$q$, 'sessions_empreinte_longueur');
UPDATE securite.sessions SET fermee_le = now() WHERE empreinte = sha256('jeton-ferme');
COMMIT;
-- Simule 20 minutes d'inactivité
UPDATE securite.sessions SET derniere_activite = now() - interval '20 minutes' WHERE empreinte = sha256('jeton-inactif');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT role FROM securite.lire_session(sha256('jeton-valide'), '15 minutes')) = 'caissier',
                      'session valide : utilisateur et rôle renvoyés');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM securite.lire_session(sha256('jeton-inactif'), '15 minutes')),
                      'session inactive depuis 20 minutes : refusée');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM securite.lire_session(sha256('jeton-expire'), '15 minutes')),
                      'session expirée : refusée');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM securite.lire_session(sha256('jeton-ferme'), '15 minutes')),
                      'session fermée : refusée');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM securite.lire_session(sha256('jeton-desactive'), '15 minutes')),
                      'session d''un compte désactivé : refusée');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM securite.lire_session(sha256('jeton-inconnu'), '15 minutes')),
                      'jeton inconnu : refusé');
SELECT tests.doit_echouer($q$DELETE FROM securite.sessions$q$, 'permission denied');
SELECT tests.doit_echouer($q$UPDATE securite.sessions SET expire_le = now() + interval '1 year'$q$, 'permission denied');
ROLLBACK;

\echo
\echo '14. Journal de sécurité : en ajout seul'
BEGIN;
SET LOCAL ROLE dbs_api;
INSERT INTO securite.evenements (type, email, adresse_ip) VALUES ('connexion_echouee', 'inconnu@test.ci', '192.0.2.10');
SELECT tests.doit_echouer($q$UPDATE securite.evenements SET type = 'connexion_reussie'$q$, 'permission denied');
SELECT tests.doit_echouer($q$DELETE FROM securite.evenements$q$, 'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO securite.evenements (type) VALUES ('evenement_invente')$q$, 'evenements_type');
COMMIT;
SELECT tests.doit_echouer($q$UPDATE securite.evenements SET type = 'connexion_reussie'$q$, 'ajout seul');
SELECT tests.doit_echouer($q$TRUNCATE securite.evenements$q$, 'ajout seul');

BEGIN;
SET LOCAL ROLE dbs_audit;
SELECT tests.verifier((SELECT count(*) FROM securite.evenements) >= 1, 'le rôle d''audit lit le journal de sécurité');
SELECT tests.doit_echouer('SELECT count(*) FROM securite.identifiants', 'permission denied');
SELECT tests.doit_echouer('SELECT count(*) FROM securite.sessions', 'permission denied');
ROLLBACK;

\echo
\echo 'Tests d''authentification de la base passés.'
