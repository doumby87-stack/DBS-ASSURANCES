-- =====================================================================
-- Tests de la migration 0018 : demande de devis adaptée à l'assurance (réponses au questionnaire, plusieurs pièces).
-- S'exécute après 01 à 15. Transports Bamba (+2250716000001) demande un devis pour sa flotte.
-- Contenus chiffrés simulés : 29 octets d'en-tête + la taille annoncée.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '62. Devis pour une flotte : réponses au questionnaire et plusieurs documents, dans l''ordre d''envoi'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT numero >= 1 FROM app.enregistrer_demande_site(
  'flotte', 'entreprise', 'Transports Bamba', '+2250716000001', NULL, 'Yopougon', 'Renouvellement en mars',
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, sha256('adresse-flotte'),
  '{"nombreVehicules": 12, "typesVehicules": ["tracteurs", "semi_remorques"], "zones": ["abidjan", "interieur"]}'::jsonb,
  ARRAY['80000000-0000-4000-8000-000000001801', '80000000-0000-4000-8000-000000001802', '80000000-0000-4000-8000-000000001803']::uuid[],
  ARRAY['liste_vehicules', 'carte_grise', 'attestation_precedente'],
  ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'application/pdf'],
  ARRAY[3, 4, 2],
  ARRAY[('\x01' || repeat('00', 31))::bytea, ('\x01' || repeat('00', 32))::bytea, ('\x01' || repeat('00', 30))::bytea],
  ARRAY[sha256('liste'), sha256('carte'), sha256('attestation')])),
  'la demande reçoit un numéro');
COMMIT;

SELECT tests.verifier((SELECT details->>'nombreVehicules' = '12' AND details->'typesVehicules' ? 'tracteurs'
                       FROM app.demandes_site WHERE telephone = '+2250716000001'),
                      'les réponses au questionnaire sont gardées avec la demande');
SELECT tests.verifier((SELECT string_agg(p.nature || ':' || p.rang, ',' ORDER BY p.rang)
                       FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
                       WHERE d.telephone = '+2250716000001') = 'liste_vehicules:1,carte_grise:2,attestation_precedente:3',
                      'les trois documents sont rattachés, dans l''ordre d''envoi');

-- Réponses vides : rien n'est gardé ; l'ancienne signature (une carte grise) fonctionne toujours
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT count(*) FROM app.enregistrer_demande_site(
  'autre', 'particulier', 'Sans détail', '+2250716000002', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, sha256('adresse-vide'),
  '{}'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL)) = 1, 'demande sans réponse ni pièce');
COMMIT;
SELECT tests.verifier((SELECT details IS NULL FROM app.demandes_site WHERE telephone = '+2250716000002'),
                      'un questionnaire vide n''est pas gardé');

\echo
\echo '63. Contrôles : forme des réponses, natures, classeur, nombre et poids des pièces'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('flotte', 'entreprise', 'Test', '+2250716000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-c'),
  '["une liste"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL)$q$, 'demandes_site_details_forme');
SELECT tests.doit_echouer(format($q$SELECT app.enregistrer_demande_site('flotte', 'entreprise', 'Test', '+2250716000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-c'),
  %L::jsonb, NULL, NULL, NULL, NULL, NULL, NULL)$q$, jsonb_build_object('precisions', repeat('x', 4000))), 'demandes_site_details_forme');
-- Une carte grise en classeur Excel
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('flotte', 'entreprise', 'Test', '+2250716000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-c'), NULL,
  ARRAY[gen_random_uuid()], ARRAY['carte_grise'], ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ARRAY[3], ARRAY[('\x01' || repeat('00', 31))::bytea], ARRAY[sha256('x')])$q$, 'pieces_demandes_site_classeur');
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('flotte', 'entreprise', 'Test', '+2250716000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-c'), NULL,
  ARRAY[gen_random_uuid()], ARRAY['passeport_du_chien'], ARRAY['image/png'],
  ARRAY[3], ARRAY[('\x01' || repeat('00', 31))::bytea], ARRAY[sha256('x')])$q$, 'pieces_demandes_site_nature');
-- Tableaux de longueurs différentes
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('flotte', 'entreprise', 'Test', '+2250716000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-c'), NULL,
  ARRAY[gen_random_uuid(), gen_random_uuid()], ARRAY['carte_grise'], ARRAY['image/png'],
  ARRAY[3], ARRAY[('\x01' || repeat('00', 31))::bytea], ARRAY[sha256('x')])$q$, 'Pièces jointes incomplètes');
-- Sept pièces
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('flotte', 'entreprise', 'Test', '+2250716000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-c'), NULL,
  array_fill(NULL::uuid, ARRAY[7]), array_fill('carte_grise'::text, ARRAY[7]), array_fill('image/png'::text, ARRAY[7]),
  array_fill(3, ARRAY[7]), array_fill(('\x01' || repeat('00', 31))::bytea, ARRAY[7]), array_fill(sha256('x'), ARRAY[7]))$q$,
  'pièces jointes au plus par demande');
-- Cinq pièces de 5 Mo : 25 Mo, au-delà des 20 Mo permis
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('flotte', 'entreprise', 'Test', '+2250716000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-c'), NULL,
  array_fill(NULL::uuid, ARRAY[5]), array_fill('carte_grise'::text, ARRAY[5]), array_fill('image/png'::text, ARRAY[5]),
  array_fill(5 * 1024 * 1024, ARRAY[5]), array_fill('\x00'::bytea, ARRAY[5]), array_fill(sha256('x'), ARRAY[5]))$q$,
  'dépassent ensemble');
ROLLBACK;
-- Réponses : seulement pour un devis (pas pour un rappel d'échéance ni un appel d'offres)
SELECT tests.doit_echouer($q$INSERT INTO app.demandes_site (numero, branche, profil, nom, telephone, accord_traitement, empreinte_ip,
  nature, echeance_actuelle, details)
  VALUES (999999, 'automobile', 'particulier', 'Test', '+2250716000004', 'J''accepte que DBS-ASSURANCES garde ces informations.',
          sha256('adresse-d'), 'rappel_echeance', app.aujourdhui() + 60, '{"puissance": 7}')$q$, 'demandes_site_details_devis');

\echo
\echo '64. Les réponses ne se modifient pas et ne vont pas au journal d''audit'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.doit_echouer($q$UPDATE app.demandes_site SET details = '{}'::jsonb WHERE telephone = '+2250716000001'$q$,
  'permission denied');
ROLLBACK;
SELECT tests.doit_echouer($q$UPDATE app.demandes_site SET details = '{"nombreVehicules": 1}'::jsonb WHERE telephone = '+2250716000001'$q$,
  'ne se modifie pas');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM audit.journal WHERE table_nom = 'demandes_site' AND apres ? 'details'),
                      'les réponses du visiteur ne vont pas au journal d''audit');
SELECT tests.verifier((SELECT premiere_anomalie IS NULL FROM audit.verifier_chaine()), 'journal d''audit toujours intègre');

\echo
\echo 'Tests des devis adaptés à l''assurance passés.'
