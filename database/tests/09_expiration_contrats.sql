-- =====================================================================
-- Tests de la migration 0011 (expiration des contrats) et du suivi des véhicules (0010) : plus de contrat
-- « en vigueur » après son échéance, plus de rappel de documents pour un véhicule vendu ou un client parti.
-- S'exécute après 01 à 08, dont il réutilise le personnel.
--   · Client Parti (+2250715000011) : contrat échu il y a 5 jours, non renouvelé ;
--   · Client Fidèle (+2250715000012) : contrat échu il y a 3 jours, renouvelé ; un camion vendu en cours
--     de contrat ; un véhicule pas encore assuré.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '35. Expiration des contrats : un contrat échu n''est plus présenté comme en vigueur'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.clients (id, type, nom, telephone) VALUES
  ('20000000-0000-4000-8000-000000000911', 'entreprise', 'Client Parti', '+2250715000011'),
  ('20000000-0000-4000-8000-000000000912', 'entreprise', 'Client Fidèle', '+2250715000012');
INSERT INTO app.vehicules (id, client_id, immatriculation, echeance_visite_technique, echeance_vignette) VALUES
  ('40000000-0000-4000-8000-000000000921', '20000000-0000-4000-8000-000000000911', '9101 EX 01', current_date + 5, NULL),
  ('40000000-0000-4000-8000-000000000922', '20000000-0000-4000-8000-000000000912', '9102 EX 01', NULL, current_date + 5),
  ('40000000-0000-4000-8000-000000000923', '20000000-0000-4000-8000-000000000912', '9103 EX 01', current_date + 5, NULL),
  ('40000000-0000-4000-8000-000000000924', '20000000-0000-4000-8000-000000000912', '9104 EX 01', current_date + 6, NULL);
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc) VALUES
  ('30000000-0000-4000-8000-000000000921', '20000000-0000-4000-8000-000000000911', 'EXP-921', 'automobile',
   current_date - 370, current_date - 5, 100000),
  ('30000000-0000-4000-8000-000000000922', '20000000-0000-4000-8000-000000000912', 'EXP-922', 'flotte',
   current_date - 368, current_date - 3, 200000),
  -- Jamais payé : il n'a jamais couvert, il n'expire pas
  ('30000000-0000-4000-8000-000000000923', '20000000-0000-4000-8000-000000000911', 'EXP-923', 'automobile',
   current_date - 400, current_date - 35, 50000);
INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le, prime_vehicule) VALUES
  ('30000000-0000-4000-8000-000000000921', '40000000-0000-4000-8000-000000000921', current_date - 370, 100000),
  ('30000000-0000-4000-8000-000000000922', '40000000-0000-4000-8000-000000000922', current_date - 368, 100000),
  ('30000000-0000-4000-8000-000000000922', '40000000-0000-4000-8000-000000000923', current_date - 368, 100000);
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe) VALUES
  ('30000000-0000-4000-8000-000000000921', 100000, 'virement', 'VIR-EXP-921'),
  ('30000000-0000-4000-8000-000000000922', 200000, 'virement', 'VIR-EXP-922');
COMMIT;

-- Camion vendu en cours de contrat, puis renouvellement du contrat flotte avec le camion restant
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000922', current_date - 60,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000923", "mouvement": "retrait"}]', 'Camion vendu', true);
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc, renouvelle_id) VALUES
  ('30000000-0000-4000-8000-000000000924', '20000000-0000-4000-8000-000000000912', 'EXP-924', 'flotte',
   current_date - 3, current_date + 362, 100000, '30000000-0000-4000-8000-000000000922');
INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le, prime_vehicule) VALUES
  ('30000000-0000-4000-8000-000000000924', '40000000-0000-4000-8000-000000000922', current_date - 3, 100000);
COMMIT;

SELECT tests.verifier((SELECT array_agg(statut::text ORDER BY numero_police) FROM app.contrats WHERE numero_police LIKE 'EXP-%')
                      = ARRAY['en_vigueur', 'en_vigueur', 'en_attente_paiement', 'en_attente_paiement'],
                      'avant la maintenance : les contrats échus apparaissent encore en vigueur');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.expirer_contrats() >= 2, 'la maintenance fait expirer les contrats échus');
SELECT tests.verifier(app.expirer_contrats() = 0, 'une seconde passe ne trouve plus rien');
COMMIT;

SELECT tests.verifier((SELECT array_agg(statut::text ORDER BY numero_police) FROM app.contrats WHERE numero_police LIKE 'EXP-%')
                      = ARRAY['expire', 'expire', 'en_attente_paiement', 'en_attente_paiement'],
                      'contrats échus expirés ; jamais payé et renouvellement en attente : inchangés');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.contrats WHERE statut = 'en_vigueur'
                                  AND date_echeance < (now() AT TIME ZONE 'Africa/Abidjan')::date),
                      'plus aucun contrat en vigueur après son échéance');
SELECT tests.verifier((SELECT statut = 'en_vigueur' FROM app.contrats WHERE numero_police = 'FLT-901'),
                      'un contrat dont l''échéance n''est pas passée reste en vigueur');
SELECT tests.verifier(EXISTS (SELECT 1 FROM audit.journal WHERE table_nom = 'app.contrats' AND operation = 'UPDATE'
                              AND apres ->> 'id' = '30000000-0000-4000-8000-000000000921' AND apres ->> 'statut' = 'expire'),
                      'l''expiration est consignée au journal d''audit');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.verifier((SELECT array_agg(numero_police ORDER BY numero_police) FROM app.v_echeances_contrats
                       WHERE numero_police LIKE 'EXP-%') = ARRAY['EXP-921'],
                      'tableau des échéances : le contrat expiré non renouvelé y reste, le renouvelé en sort');
SELECT tests.verifier(EXISTS (SELECT 1 FROM app.v_relances_dues WHERE cle = 'contrat_expire:30000000-0000-4000-8000-000000000921'),
                      'le rappel « vous n''êtes plus couvert » reste dû après l''expiration');
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000922', current_date - 30,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000924", "mouvement": "incorporation", "primeVehicule": 100000}]', NULL, false)$q$,
  'que sur un contrat en vigueur');
ROLLBACK;

\echo
\echo '36. Suivi des véhicules : aucun rappel pour un véhicule vendu ou un client parti'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.verifier(NOT app.vehicule_suivi('40000000-0000-4000-8000-000000000921')
                      AND app.vehicule_suivi('40000000-0000-4000-8000-000000000922')
                      AND NOT app.vehicule_suivi('40000000-0000-4000-8000-000000000923')
                      AND app.vehicule_suivi('40000000-0000-4000-8000-000000000924'),
                      'suivis : véhicule repris au renouvellement et véhicule pas encore assuré ; pas le camion vendu ni le véhicule du client parti');
SELECT tests.verifier((SELECT array_agg(immatriculation ORDER BY immatriculation) FROM app.v_echeances_vehicules
                       WHERE immatriculation LIKE '% EX 01') = ARRAY['9102 EX 01', '9104 EX 01'],
                      'tableau des échéances : documents des seuls véhicules suivis');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.v_relances_dues WHERE type = 'documents_vehicules'
                                  AND client_id = '20000000-0000-4000-8000-000000000911'),
                      'aucun rappel de documents au client parti');
SELECT tests.verifier((SELECT array_agg(d ->> 'immatriculation' ORDER BY d ->> 'immatriculation')
                       FROM app.v_relances_dues r, jsonb_array_elements(r.parametres -> 'documents') d
                       WHERE r.type = 'documents_vehicules' AND r.client_id = '20000000-0000-4000-8000-000000000912')
                      = ARRAY['9102 EX 01', '9104 EX 01'],
                      'le client fidèle n''est pas relancé pour le camion vendu');
ROLLBACK;
SELECT tests.verifier((SELECT premiere_anomalie IS NULL FROM audit.verifier_chaine()), 'journal d''audit toujours intègre');

\echo
\echo 'Tests de l''expiration des contrats et du suivi des véhicules passés.'
