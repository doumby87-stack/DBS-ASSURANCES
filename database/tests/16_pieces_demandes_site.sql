-- =====================================================================
-- Tests de la migration 0019 : plusieurs pièces jointes par demande du site, selon leur nature.
-- S'exécute après 01 à 15. Les contenus chiffrés sont simulés (29 octets d'en-tête + 3 octets).
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '65. Pièces jointes : plusieurs documents par demande, chacun avec sa nature'
BEGIN;
SET LOCAL ROLE dbs_api;
-- Une flotte joint sa liste de véhicules (classeur Excel), une carte grise (photo) et son attestation (PDF)
SELECT tests.verifier((SELECT numero >= 1 FROM app.enregistrer_demande_site(
  'flotte', 'entreprise', 'Transports Bamba', '+2250716000001', NULL, 'Abidjan', '12 camions et 3 pick-up',
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, sha256('pieces-a'),
  ARRAY['80000000-0000-4000-8000-000000001601'::uuid, '80000000-0000-4000-8000-000000001602', '80000000-0000-4000-8000-000000001603'],
  ARRAY['liste_vehicules', 'carte_grise', 'attestation_precedente'],
  ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'application/pdf'],
  ARRAY[3, 3, 3],
  ARRAY[('\x01' || repeat('00', 31))::bytea, ('\x01' || repeat('11', 31))::bytea, ('\x01' || repeat('22', 31))::bytea],
  ARRAY[sha256('xlsx'), sha256('jpeg'), sha256('pdf')])),
  'une flotte joint sa liste de véhicules, une carte grise et son attestation');
-- Sans aucune pièce, ou avec des tableaux vides : comme avant
SELECT tests.verifier((SELECT count(*) FROM app.enregistrer_demande_site(
  'habitation', 'particulier', 'Sans pièce', '+2250716000002', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, sha256('pieces-b'))) = 1,
  'une demande sans pièce reste possible');
SELECT tests.verifier((SELECT count(*) FROM app.enregistrer_demande_site(
  'habitation', 'particulier', 'Tableaux vides', '+2250716000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, sha256('pieces-c'),
  ARRAY[]::uuid[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::integer[], ARRAY[]::bytea[], ARRAY[]::bytea[])) = 1,
  'des tableaux vides valent « aucune pièce »');
COMMIT;

SELECT tests.verifier((SELECT count(*) = 3 AND bool_and(p.etat_analyse = 'a_analyser' AND p.analysee_le IS NULL)
                       FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
                       WHERE d.telephone = '+2250716000001'),
                      'les trois pièces sont rattachées à la demande, en attente d''analyse');
SELECT tests.verifier((SELECT array_agg(p.nature ORDER BY p.rang) FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
                       WHERE d.telephone = '+2250716000001') = '{liste_vehicules,carte_grise,attestation_precedente}'
                      AND (SELECT array_agg(p.rang ORDER BY p.id) FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
                           WHERE d.telephone = '+2250716000001') = '{1,2,3}',
                      'chaque pièce garde sa nature et son rang, dans l''ordre d''envoi');
SELECT tests.verifier((SELECT rang = 1 FROM app.pieces_demandes_site WHERE id = '80000000-0000-4000-8000-000000000701'),
                      'la carte grise reçue seule (test 06) est au rang 1');
SELECT tests.verifier((SELECT count(*) FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
                       WHERE d.telephone IN ('+2250716000002', '+2250716000003')) = 0,
                      'les demandes sans pièce n''en ont aucune');

\echo
\echo '66. Limites : 4 pièces et 12 Mo au plus, tableaux cohérents, natures et types connus'
BEGIN;
SET LOCAL ROLE dbs_api;
-- Cinq pièces
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('flotte', 'entreprise', 'Trop', '+2250716000004', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('pieces-d'),
  ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()],
  ARRAY['carte_grise', 'carte_grise', 'carte_grise', 'carte_grise', 'carte_grise'],
  ARRAY['image/jpeg', 'image/jpeg', 'image/jpeg', 'image/jpeg', 'image/jpeg'], ARRAY[3, 3, 3, 3, 3],
  ARRAY[('\x01' || repeat('00', 31))::bytea, ('\x01' || repeat('00', 31))::bytea, ('\x01' || repeat('00', 31))::bytea,
        ('\x01' || repeat('00', 31))::bytea, ('\x01' || repeat('00', 31))::bytea],
  ARRAY[sha256('a'), sha256('b'), sha256('c'), sha256('d'), sha256('e')])$q$, '4 pièces jointes au plus');
-- Trois pièces de 4,5 Mo : 13,5 Mo en tout (le poids total est contrôlé avant tout enregistrement)
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('flotte', 'entreprise', 'Lourd', '+2250716000004', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('pieces-d'),
  ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()], ARRAY['carte_grise', 'carte_grise', 'carte_grise'],
  ARRAY['image/jpeg', 'image/jpeg', 'image/jpeg'], ARRAY[4718592, 4718592, 4718592],
  ARRAY[('\x01' || repeat('00', 31))::bytea, ('\x01' || repeat('00', 31))::bytea, ('\x01' || repeat('00', 31))::bytea],
  ARRAY[sha256('a'), sha256('b'), sha256('c')])$q$, 'dépassent ensemble');
-- Deux identifiants, une seule nature
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('automobile', 'particulier', 'Bancal', '+2250716000004', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('pieces-d'),
  ARRAY[gen_random_uuid(), gen_random_uuid()], ARRAY['carte_grise'], ARRAY['image/jpeg', 'image/jpeg'], ARRAY[3, 3],
  ARRAY[('\x01' || repeat('00', 31))::bytea, ('\x01' || repeat('00', 31))::bytea], ARRAY[sha256('a'), sha256('b')])$q$,
  'Pièces jointes incomplètes');
-- Nature inconnue
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('automobile', 'particulier', 'Inconnu', '+2250716000004', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('pieces-d'),
  ARRAY[gen_random_uuid()], ARRAY['passeport'], ARRAY['image/jpeg'], ARRAY[3], ARRAY[('\x01' || repeat('00', 31))::bytea],
  ARRAY[sha256('a')])$q$, 'pieces_demandes_site_nature');
-- Un classeur Excel ne se joint que comme liste : pas comme carte grise
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('automobile', 'particulier', 'Classeur', '+2250716000004', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('pieces-d'),
  ARRAY[gen_random_uuid()], ARRAY['carte_grise'], ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ARRAY[3], ARRAY[('\x01' || repeat('00', 31))::bytea], ARRAY[sha256('a')])$q$, 'pieces_demandes_site_classeur');
-- Quatre pièces de 3 Mo : 12 Mo tout rond, accepté
SELECT tests.verifier((SELECT count(*) FROM app.enregistrer_demande_site('agricole', 'professionnel', 'Juste', '+2250716000004',
  NULL, NULL, NULL, 'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('pieces-d'),
  ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()],
  ARRAY['liste_materiel', 'photos_bien', 'photos_bien', 'autre'],
  ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png', 'application/pdf'],
  ARRAY[3145728, 3145728, 3145728, 3145728],
  ARRAY[decode(repeat('00', 3145757), 'hex'), decode(repeat('00', 3145757), 'hex'), decode(repeat('00', 3145757), 'hex'),
        decode(repeat('00', 3145757), 'hex')],
  ARRAY[sha256('a'), sha256('b'), sha256('c'), sha256('d')])) = 1,
  'quatre pièces de 3 Mo (12 Mo en tout) sont acceptées');
-- Le rattachement direct des pièces est réservé aux fonctions d'enregistrement
SELECT tests.doit_echouer($q$SELECT app.joindre_pieces_demande_site(gen_random_uuid(), ARRAY[gen_random_uuid()], ARRAY['autre'],
  ARRAY['image/png'], ARRAY[3], ARRAY[('\x01' || repeat('00', 31))::bytea], ARRAY[sha256('a')])$q$, 'permission denied');
ROLLBACK;

\echo
\echo '67. Rappel d''échéance et appel d''offres : des pièces aussi'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT a_traiter_le = current_date + 60 FROM app.enregistrer_rappel_echeance(
  'automobile', 'particulier', 'Rappel avec attestation', '+2250716000005', NULL, current_date + 90,
  'J''accepte que DBS-ASSURANCES garde ces informations pour me rappeler avant mon échéance.', NULL, sha256('pieces-e'),
  ARRAY['80000000-0000-4000-8000-000000001611'::uuid], ARRAY['attestation_precedente'], ARRAY['application/pdf'], ARRAY[3],
  ARRAY[('\x01' || repeat('00', 31))::bytea], ARRAY[sha256('attestation')])),
  'un rappel d''échéance reçoit l''attestation actuelle');
SELECT tests.verifier((SELECT numero >= 1 FROM app.enregistrer_appel_offres(
  'flotte', 'entreprise', 'BTP Ivoire SARL', '+2250716000006', NULL, 'Abidjan', 'Marché de 18 mois', current_date + 20,
  '{"acheteur": "Port autonome", "garanties": ["flotte", "rc"]}',
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, sha256('pieces-f'),
  ARRAY['80000000-0000-4000-8000-000000001621'::uuid, '80000000-0000-4000-8000-000000001622'],
  ARRAY['cahier_des_charges', 'registre_commerce'], ARRAY['application/pdf', 'image/jpeg'], ARRAY[3, 3],
  ARRAY[('\x01' || repeat('00', 31))::bytea, ('\x01' || repeat('11', 31))::bytea], ARRAY[sha256('cdc'), sha256('rccm')])),
  'un appel d''offres reçoit le cahier des charges et le registre de commerce');
-- Les mêmes règles qu'en 0015 s'appliquent toujours
SELECT tests.doit_echouer($q$SELECT app.enregistrer_appel_offres('flotte', 'particulier', 'Particulier', '+2250716000007', NULL, NULL, NULL,
  current_date + 20, '{}', 'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('pieces-g'))$q$,
  'professionnels et aux entreprises');
COMMIT;

SELECT tests.verifier((SELECT count(*) FROM app.pieces_demandes_site WHERE id IN ('80000000-0000-4000-8000-000000001611')) = 1
                      AND (SELECT count(*) FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
                           WHERE d.nature = 'appel_offres' AND d.telephone = '+2250716000006') = 2,
                      'les pièces du rappel et de l''appel d''offres sont rattachées à leur demande');

\echo
\echo '68. Lecture par rôle, analyse pièce par pièce, purge de toutes les pièces d''une demande'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.verifier((SELECT count(*) FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
                       WHERE d.telephone = '+2250716000001') = 3, 'le commercial voit les trois pièces de la flotte');
SELECT tests.verifier(app.enregistrer_analyse_piece('80000000-0000-4000-8000-000000001601', true, NULL)
                      AND app.enregistrer_analyse_piece('80000000-0000-4000-8000-000000001602', false, 'Win.Test.EICAR_HDB-1'),
                      'chaque pièce reçoit son propre verdict');
SELECT tests.verifier((SELECT array_agg(p.etat_analyse::text ORDER BY p.id) FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
                       WHERE d.telephone = '+2250716000001') = '{saine,infectee,a_analyser}',
                      'une pièce saine, une infectée (contenu effacé), une à analyser, sur la même demande');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000008', true);  -- auditeur
SELECT tests.verifier((SELECT count(*) FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
                       WHERE d.telephone = '+2250716000001') = 0, 'l''auditeur ne voit aucune pièce');
ROLLBACK;

-- Mise en situation : la demande de la flotte est classée sans suite il y a plus de 12 mois
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
UPDATE app.demandes_site SET statut = 'sans_suite', motif = 'Test purge' WHERE telephone = '+2250716000001';
COMMIT;
SET session_replication_role = replica;
UPDATE app.demandes_site SET recue_le = now() - interval '14 months', traitee_le = now() - interval '13 months'
WHERE telephone = '+2250716000001';
SET session_replication_role = origin;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.purger_demandes_site() = 1, 'la demande classée depuis plus de 12 mois est purgée');
COMMIT;
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.pieces_demandes_site
                                  WHERE id IN ('80000000-0000-4000-8000-000000001601', '80000000-0000-4000-8000-000000001602',
                                               '80000000-0000-4000-8000-000000001603')),
                      'ses trois pièces sont parties avec elle');
SELECT tests.verifier((SELECT premiere_anomalie IS NULL FROM audit.verifier_chaine()), 'journal d''audit toujours intègre');

\echo
\echo 'Tests des pièces jointes des demandes du site passés.'
