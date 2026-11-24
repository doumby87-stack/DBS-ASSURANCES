-- =====================================================================
-- Tests de la migration 0019 : quatre documents de plus, d'après les questionnaires des compagnies.
-- S'exécute après 01 à 16. BTP Kouassi (+2250717000001) demande un devis pour un chantier.
-- Contenus chiffrés simulés : 29 octets d'en-tête + la taille annoncée.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '65. Chantier : questionnaire rempli, rapport de sol, planning et plans ; plan d''une plantation'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT numero >= 1 FROM app.enregistrer_demande_site(
  'chantier_construction', 'entreprise', 'BTP Kouassi', '+2250717000001', NULL, 'Cocody', NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, sha256('adresse-chantier'),
  '{"produits": ["trc_batiment", "decennale"], "natureTravaux": "Immeuble R+4", "bureauControle": "oui"}'::jsonb,
  ARRAY['80000000-0000-4000-8000-000000001901', '80000000-0000-4000-8000-000000001902', '80000000-0000-4000-8000-000000001903']::uuid[],
  ARRAY['questionnaire_compagnie', 'rapport_sol_controle', 'planning_plans'],
  ARRAY['application/pdf', 'application/pdf', 'image/jpeg'],
  ARRAY[3, 4, 2],
  ARRAY[('\x01' || repeat('00', 31))::bytea, ('\x01' || repeat('00', 32))::bytea, ('\x01' || repeat('00', 30))::bytea],
  ARRAY[sha256('questionnaire'), sha256('rapport'), sha256('planning')])),
  'la demande et ses trois documents sont acceptés');
SELECT tests.verifier((SELECT count(*) FROM app.enregistrer_demande_site(
  'agricole', 'particulier', 'Plantation Yao', '+2250717000002', NULL, 'Soubré', NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, sha256('adresse-plantation'),
  '{"culture": "Cacao", "risques": ["incendie"]}'::jsonb,
  ARRAY[gen_random_uuid()], ARRAY['plan_plantation'], ARRAY['image/png'],
  ARRAY[3], ARRAY[('\x01' || repeat('00', 31))::bytea], ARRAY[sha256('plan')])) = 1,
  'le plan de la plantation est accepté');
COMMIT;

SELECT tests.verifier((SELECT string_agg(p.nature || ':' || p.rang, ',' ORDER BY p.rang)
                       FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
                       WHERE d.telephone = '+2250717000001') = 'questionnaire_compagnie:1,rapport_sol_controle:2,planning_plans:3',
                      'les documents du chantier sont rattachés, dans l''ordre d''envoi');

\echo
\echo '66. Ces documents ne sont jamais des classeurs Excel'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('chantier_construction', 'entreprise', 'Test', '+2250717000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-e'), NULL,
  ARRAY[gen_random_uuid()], ARRAY['questionnaire_compagnie'], ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ARRAY[3], ARRAY[('\x01' || repeat('00', 31))::bytea], ARRAY[sha256('x')])$q$, 'pieces_demandes_site_classeur');
ROLLBACK;

\echo
\echo 'Tests des documents des questionnaires passés.'
