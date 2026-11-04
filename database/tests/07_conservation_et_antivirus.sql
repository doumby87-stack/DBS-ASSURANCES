-- =====================================================================
-- Tests de la migration 0008 : journal sans données personnelles des prospects, purge des demandes
-- à 12 mois, analyse antivirus des pièces. S'exécute après 06, dont il réutilise les demandes.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '28. Journal d''audit : qui a fait quoi, sans le nom ni le téléphone du prospect'
SELECT tests.verifier((SELECT count(*) FROM audit.journal WHERE table_nom = 'app.demandes_site') > 0
                      AND NOT EXISTS (SELECT 1 FROM audit.journal WHERE table_nom = 'app.demandes_site'
                                      AND (apres ?| ARRAY['nom', 'telephone', 'email', 'commune', 'besoin', 'empreinte_ip']
                                           OR avant ?| ARRAY['nom', 'telephone', 'email', 'commune', 'besoin', 'empreinte_ip'])),
                      'les demandes sont journalisées sans leurs données personnelles');
SELECT tests.verifier((SELECT count(*) FROM audit.journal WHERE table_nom = 'app.demandes_site' AND apres ? 'statut'
                       AND apres ? 'numero') > 0, 'le journal garde le numéro, le statut et l''auteur du traitement');
SELECT tests.verifier((SELECT count(*) FROM audit.journal WHERE table_nom = 'app.clients' AND apres ? 'telephone') > 0,
                      'les autres tables restent journalisées en entier');

\echo
\echo '29. Analyse antivirus : verdict enregistré par la seule fonction prévue, infection définitive'
-- Trois demandes avec carte grise (contenu chiffré simulé : 29 octets d'en-tête + 3 octets)
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT app.enregistrer_demande_site('automobile', 'particulier', 'Pièce ' || n, '+225071300000' || n, NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256(convert_to('analyse-' || n, 'UTF8')),
  ('80000000-0000-4000-8000-00000000080' || n)::uuid, 'application/pdf', 3, ('\x01' || repeat('00', 31))::bytea, sha256('pdf'))
FROM generate_series(1, 3) AS n;
COMMIT;

SELECT tests.verifier((SELECT bool_and(etat_analyse = 'a_analyser' AND analysee_le IS NULL) FROM app.pieces_demandes_site
                       WHERE id::text LIKE '80000000-0000-4000-8000-00000000080_'),
                      'une pièce reçue attend son analyse');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT count(*) FROM app.pieces_a_analyser(50)
                       WHERE id::text LIKE '80000000-0000-4000-8000-00000000080_') = 3,
                      'la maintenance de l''API retrouve les pièces à analyser, sans utilisateur connecté');
SELECT tests.doit_echouer($q$UPDATE app.pieces_demandes_site SET etat_analyse = 'saine'$q$, 'permission denied');
SELECT set_config('app.analyse_piece_site', 'oui', true);
SELECT tests.doit_echouer($q$UPDATE app.pieces_demandes_site SET etat_analyse = 'saine'$q$, 'permission denied');
SELECT tests.verifier(app.enregistrer_analyse_piece('80000000-0000-4000-8000-000000000801', true, NULL),
                      'pièce saine');
SELECT tests.verifier(app.enregistrer_analyse_piece('80000000-0000-4000-8000-000000000802', false, 'Win.Test.EICAR_HDB-1'),
                      'pièce infectée');
SELECT tests.verifier(NOT app.enregistrer_analyse_piece('80000000-0000-4000-8000-000000000802', true, NULL),
                      'une pièce infectée ne redevient jamais saine');
SELECT tests.verifier(NOT app.enregistrer_analyse_piece(gen_random_uuid(), true, NULL), 'pièce inconnue : rien ne change');
COMMIT;

SELECT tests.verifier((SELECT etat_analyse = 'saine' AND analysee_le IS NOT NULL AND contenu_chiffre IS NOT NULL
                       FROM app.pieces_demandes_site WHERE id = '80000000-0000-4000-8000-000000000801'),
                      'la pièce saine garde son contenu et la date de son analyse');
SELECT tests.verifier((SELECT etat_analyse = 'infectee' AND contenu_chiffre IS NULL AND signature_detectee = 'Win.Test.EICAR_HDB-1'
                       FROM app.pieces_demandes_site WHERE id = '80000000-0000-4000-8000-000000000802'),
                      'la pièce infectée perd son contenu, la menace est notée');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.enregistrer_analyse_piece('80000000-0000-4000-8000-000000000801', false, ''),
                      'une pièce saine peut se révéler infectée à une analyse suivante (signatures à jour)');
ROLLBACK;

-- Même avec le réglage, le propriétaire ne change ni le fichier ni le type d'une pièce
BEGIN;
SELECT set_config('app.analyse_piece_site', 'oui', true);
SELECT tests.doit_echouer($q$UPDATE app.pieces_demandes_site SET type_contenu = 'image/png'
  WHERE id = '80000000-0000-4000-8000-000000000801'$q$, 'ne se modifie pas');
SELECT tests.doit_echouer($q$UPDATE app.pieces_demandes_site SET contenu_chiffre = ('\x01' || repeat('11', 31))::bytea
  WHERE id = '80000000-0000-4000-8000-000000000801'$q$, 'ne se modifie pas');
SELECT tests.doit_echouer($q$UPDATE app.pieces_demandes_site SET etat_analyse = 'saine', signature_detectee = NULL,
  contenu_chiffre = ('\x01' || repeat('00', 31))::bytea WHERE id = '80000000-0000-4000-8000-000000000802'$q$, 'ne se modifie pas');
ROLLBACK;
SELECT tests.doit_echouer($q$UPDATE app.pieces_demandes_site SET analysee_le = now()
  WHERE id = '80000000-0000-4000-8000-000000000801'$q$, 'ne se modifie pas');

\echo
\echo '30. Purge : demandes sans suite ou jamais traitées depuis plus de 12 mois, jamais les autres'
-- Mise en situation : on vieillit quatre demandes (sans passer par les gardiens, réservé aux tests)
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT app.enregistrer_demande_site('habitation', 'particulier', 'Ancienne ' || n, '+225071400000' || n, NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256(convert_to('purge-' || n, 'UTF8')),
  CASE WHEN n = 1 THEN '80000000-0000-4000-8000-000000000901'::uuid END, CASE WHEN n = 1 THEN 'image/png' END,
  CASE WHEN n = 1 THEN 3 END, CASE WHEN n = 1 THEN ('\x01' || repeat('00', 31))::bytea END,
  CASE WHEN n = 1 THEN sha256('png') END)
FROM generate_series(1, 5) AS n;
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
UPDATE app.demandes_site SET statut = 'sans_suite', motif = 'Injoignable' WHERE telephone IN ('+2250714000001', '+2250714000004');
INSERT INTO app.clients (id, type, nom, telephone)
VALUES ('20000000-0000-4000-8000-000000000801', 'particulier', 'Ancienne 3', '+2250714000003');
INSERT INTO app.devis (id, client_id, branche, origine)
VALUES ('60000000-0000-4000-8000-000000000801', '20000000-0000-4000-8000-000000000801', 'habitation', 'site');
UPDATE app.demandes_site SET statut = 'convertie', client_id = '20000000-0000-4000-8000-000000000801',
  devis_id = '60000000-0000-4000-8000-000000000801' WHERE telephone = '+2250714000003';
COMMIT;

SET session_replication_role = replica;
UPDATE app.demandes_site SET recue_le = now() - interval '14 months', traitee_le = now() - interval '13 months'
WHERE telephone IN ('+2250714000001', '+2250714000003');                         -- sans suite et convertie, anciennes
UPDATE app.demandes_site SET recue_le = now() - interval '13 months' WHERE telephone = '+2250714000002';  -- jamais traitée
UPDATE app.demandes_site SET recue_le = now() - interval '14 months', traitee_le = now() - interval '11 months'
WHERE telephone = '+2250714000004';                                              -- classée il y a moins de 12 mois
UPDATE app.demandes_site SET recue_le = now() - interval '11 months' WHERE telephone = '+2250714000005';  -- récente
SET session_replication_role = origin;

-- L'application n'a aucun droit de suppression, même en imitant la purge
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.purge_demandes_site', 'oui', true);
SELECT tests.doit_echouer($q$DELETE FROM app.demandes_site WHERE telephone = '+2250714000005'$q$, 'permission denied');
SELECT tests.doit_echouer($q$DELETE FROM app.pieces_demandes_site$q$, 'permission denied');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.purger_demandes_site() = 2, 'deux demandes supprimées : sans suite et jamais traitée, depuis plus de 12 mois');
SELECT tests.verifier(app.purger_demandes_site() = 0, 'une seconde purge ne trouve plus rien');
COMMIT;

SELECT tests.verifier((SELECT array_agg(telephone ORDER BY telephone) FROM app.demandes_site WHERE telephone LIKE '+22507140000%')
                      = '{+2250714000003,+2250714000004,+2250714000005}',
                      'restent la demande convertie, celle classée il y a 11 mois et la récente');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.pieces_demandes_site WHERE id = '80000000-0000-4000-8000-000000000901'),
                      'la carte grise de la demande purgée est supprimée avec elle');
SELECT tests.verifier((SELECT count(*) FROM audit.journal WHERE table_nom = 'app.demandes_site' AND operation = 'DELETE'
                       AND utilisateur_id IS NULL AND NOT (avant ? 'telephone')) = 2,
                      'la purge est journalisée, sans données personnelles');
SELECT tests.doit_echouer($q$DELETE FROM app.demandes_site WHERE telephone = '+2250714000005'$q$, 'ne se supprime pas');
SELECT tests.verifier((SELECT premiere_anomalie IS NULL FROM audit.verifier_chaine()), 'journal d''audit toujours intègre');

\echo
\echo 'Tests de la conservation et de l''analyse antivirus passés.'
