-- =====================================================================
-- Tests de la migration 0016 : lecture automatique consignée au journal de sécurité.
-- S'exécute après 01 à 13.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '58. Lecture automatique : consignée au journal de sécurité, sans les valeurs lues'
INSERT INTO securite.evenements (type, utilisateur_id, objet)
VALUES ('lecture_automatique', '10000000-0000-4000-8000-000000000004', 'Carte grise (photo envoyée)');
SELECT tests.verifier((SELECT count(*) = 1 FROM securite.evenements WHERE type = 'lecture_automatique'),
                      'une lecture automatique se consigne au journal de sécurité');
SELECT tests.doit_echouer($q$INSERT INTO securite.evenements (type, utilisateur_id) VALUES ('lecture_inconnue', '10000000-0000-4000-8000-000000000004')$q$,
  'evenements_type');
SELECT tests.verifier((SELECT count(*) = 1 FROM pg_indexes WHERE indexname = 'evenements_lectures_idx'),
                      'les lectures récentes d''une personne se comptent par un index dédié');

\echo
\echo 'Tests de la lecture automatique passés.'
