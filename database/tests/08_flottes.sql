-- =====================================================================
-- Tests des migrations 0009 et 0010 : flottes (composition, avenants d'incorporation, de retrait et
-- d'annulation au prorata, réintégration, prime due) et relances groupées des documents des véhicules.
-- S'exécute après 01 à 07, dont il réutilise le personnel.
--   · Transports Test (+2250715000001) : contrat flotte de 365 jours commencé il y a 100 jours ;
--   · Transports Docs (+2250715000002, accord WhatsApp) : documents de véhicules à échéance ;
--   · Transports Muets (+2250715000003, aucun accord) : un document à échéance.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '31. Composition d''un contrat flotte : véhicules de départ tant que la prime n''est pas payée'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.clients (id, type, nom, telephone) VALUES
  ('20000000-0000-4000-8000-000000000901', 'entreprise', 'Transports Test', '+2250715000001'),
  ('20000000-0000-4000-8000-000000000902', 'entreprise', 'Transports Docs', '+2250715000002'),
  ('20000000-0000-4000-8000-000000000903', 'entreprise', 'Transports Muets', '+2250715000003');
INSERT INTO app.vehicules (id, client_id, immatriculation) VALUES
  ('40000000-0000-4000-8000-000000000901', '20000000-0000-4000-8000-000000000901', '9001 FL 01'),
  ('40000000-0000-4000-8000-000000000902', '20000000-0000-4000-8000-000000000901', '9002 FL 01'),
  ('40000000-0000-4000-8000-000000000903', '20000000-0000-4000-8000-000000000901', '9003 FL 01'),
  ('40000000-0000-4000-8000-000000000904', '20000000-0000-4000-8000-000000000901', '9004 FL 01'),
  ('40000000-0000-4000-8000-000000000905', '20000000-0000-4000-8000-000000000901', '9005 FL 01'),
  ('40000000-0000-4000-8000-000000000909', '20000000-0000-4000-8000-000000000902', '9009 FL 01');
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc) VALUES
  ('30000000-0000-4000-8000-000000000901', '20000000-0000-4000-8000-000000000901', 'FLT-901', 'flotte',
   current_date - 100, current_date + 265, 900000);
INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le, prime_vehicule) VALUES
  ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000901', current_date - 100, 450000),
  ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000902', current_date - 100, 450000),
  ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000903', current_date - 100, 365000);
SELECT tests.doit_echouer($q$INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000904', current_date)$q$,
  'ajoutez-le à la date d''effet du contrat');
SELECT tests.doit_echouer($q$INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000909', current_date - 100)$q$,
  'n''appartient pas au client');
SELECT tests.doit_echouer($q$INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000901', current_date - 100)$q$,
  'contrats_vehicules_en_cours_unique');
SELECT tests.doit_echouer($q$INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le, incorpore_par)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000904', current_date - 100,
          gen_random_uuid())$q$, 'ajoutez-le à la date d''effet du contrat');
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000904", "mouvement": "incorporation", "primeVehicule": 365000}]', NULL, true)$q$,
  'que sur un contrat en vigueur');
-- Véhicule rattaché par erreur : il se détache tant que la prime n'est pas payée
DELETE FROM app.contrats_vehicules WHERE vehicule_id = '40000000-0000-4000-8000-000000000903';
COMMIT;
SELECT tests.verifier((SELECT count(*) FROM app.contrats_vehicules WHERE contrat_id = '30000000-0000-4000-8000-000000000901') = 2,
                      'avant le paiement, un véhicule rattaché par erreur se détache (composition de départ : 2 véhicules)');
SELECT tests.verifier(EXISTS (SELECT 1 FROM audit.journal WHERE table_nom = 'app.contrats_vehicules' AND operation = 'DELETE'),
                      'le détachement est consigné au journal d''audit');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
DELETE FROM app.contrats_vehicules WHERE vehicule_id = '40000000-0000-4000-8000-000000000901';
SELECT tests.verifier(EXISTS (SELECT 1 FROM app.contrats_vehicules WHERE vehicule_id = '40000000-0000-4000-8000-000000000901'),
                      'un commercial ne détache aucun véhicule');
ROLLBACK;

-- Prime de départ payée au guichet : le contrat entre en vigueur
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe)
VALUES ('30000000-0000-4000-8000-000000000901', 900000, 'virement', 'VIR-FLT-901');
COMMIT;
SELECT tests.verifier((SELECT statut = 'en_vigueur' FROM app.contrats WHERE id = '30000000-0000-4000-8000-000000000901'),
                      'prime de départ payée : contrat flotte en vigueur');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.doit_echouer($q$INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000903', current_date - 100)$q$,
  'incorporez le véhicule par un avenant');
SELECT tests.doit_echouer($q$UPDATE app.contrats_vehicules SET retire_le = current_date
  WHERE vehicule_id = '40000000-0000-4000-8000-000000000901'$q$, 'permission denied');
SELECT tests.doit_echouer($q$UPDATE app.contrats_vehicules SET numero_attestation = 'ATT-1', ajoute_le = current_date
  WHERE vehicule_id = '40000000-0000-4000-8000-000000000901'$q$, 'permission denied');
SELECT tests.doit_echouer($q$DELETE FROM app.contrats_vehicules WHERE vehicule_id = '40000000-0000-4000-8000-000000000901'$q$,
  'retirez le véhicule par un avenant');
ROLLBACK;

\echo
\echo '32. Avenants : incorporation et retrait au prorata, plusieurs véhicules à la fois, calculés par la base'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000903", "mouvement": "incorporation", "primeVehicule": 365000}]', NULL, true)$q$,
  'Seuls le gérant et les chargés de clientèle');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
-- Jamais d'écriture directe : seul le calcul de la base fait foi
SELECT tests.doit_echouer($q$INSERT INTO app.avenants_flotte (numero, contrat_id, nature, date_effet, montant)
  VALUES (999, '30000000-0000-4000-8000-000000000901', 'mouvement', current_date, 1)$q$, 'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO app.avenants_flotte_lignes (avenant_id, vehicule_id, mouvement, prime_vehicule,
  jours_restants, jours_periode, montant) VALUES (gen_random_uuid(), '40000000-0000-4000-8000-000000000903',
  'incorporation', 1, 1, 1, 1)$q$, 'permission denied');
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date + 300,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000903", "mouvement": "incorporation", "primeVehicule": 365000}]', NULL, true)$q$,
  'hors du contrat');
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date - 100,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000903", "mouvement": "incorporation", "primeVehicule": 365000}]', NULL, true)$q$,
  'hors du contrat');
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000901", "mouvement": "incorporation", "primeVehicule": 450000}]', NULL, true)$q$,
  '9001 FL 01 figure déjà sur ce contrat');
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000909", "mouvement": "incorporation", "primeVehicule": 450000}]', NULL, true)$q$,
  'n''appartient pas au client');
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000903", "mouvement": "incorporation", "primeVehicule": 365000},
    {"vehiculeId": "40000000-0000-4000-8000-000000000903", "mouvement": "incorporation", "primeVehicule": 365000}]', NULL, true)$q$,
  'deux fois');
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date, '[]', NULL, true)$q$,
  '1 à 200 véhicules');
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000903", "mouvement": "incorporation"}]', NULL, true)$q$,
  'Indiquez la prime de 9003 FL 01');
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000904", "mouvement": "retrait"}]', NULL, true)$q$,
  '9004 FL 01 n''est pas couvert par ce contrat');
COMMIT;

-- Aperçu : même calcul, rien d'écrit, aucun numéro consommé
SELECT coalesce((SELECT valeur FROM app.compteurs WHERE nom = 'avenants'), 0) AS compteur_avant \gset
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.verifier((SELECT r ->> 'id' IS NULL AND (r -> 'montant')::bigint = 795000 AND (r -> 'joursRestants')::int = 265
                              AND (r -> 'joursPeriode')::int = 365 AND jsonb_array_length(r -> 'lignes') = 2
                              AND (r #> '{lignes,1,montant}')::bigint = 530000
                       FROM app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date,
                         '[{"vehiculeId": "40000000-0000-4000-8000-000000000903", "mouvement": "incorporation", "primeVehicule": 365000},
                           {"vehiculeId": "40000000-0000-4000-8000-000000000904", "mouvement": "incorporation", "primeVehicule": 730000}]',
                         NULL, false) r),
                      'aperçu : 265 000 + 530 000 = 795 000 F CFA pour 265 jours restants sur 365');
COMMIT;
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.avenants_flotte)
                      AND coalesce((SELECT valeur FROM app.compteurs WHERE nom = 'avenants'), 0) = :compteur_avant,
                      'l''aperçu n''écrit rien et ne consomme aucun numéro');

-- Avenant A : deux véhicules incorporés à la même date, un seul numéro
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000903", "mouvement": "incorporation", "primeVehicule": 365000},
    {"vehiculeId": "40000000-0000-4000-8000-000000000904", "mouvement": "incorporation", "primeVehicule": 730000}]',
  'Deux tracteurs achetés en octobre', true);
COMMIT;
SELECT id AS avenant_a, numero AS numero_a FROM app.avenants_flotte \gset
SELECT tests.verifier((SELECT nature = 'mouvement' AND montant = 795000 AND numero = :compteur_avant + 1
                              AND motif = 'Deux tracteurs achetés en octobre'
                              AND cree_par = '10000000-0000-4000-8000-000000000004'
                       FROM app.avenants_flotte),
                      'avenant n° 1 : 795 000 F CFA, au nom du chargé de clientèle');
SELECT tests.verifier((SELECT count(*) = 2 AND sum(montant) = 795000 AND bool_and(jours_restants = 265 AND jours_periode = 365)
                       FROM app.avenants_flotte_lignes WHERE avenant_id = :'avenant_a'),
                      'une ligne par véhicule, dont la somme fait le montant de l''avenant');
SELECT tests.verifier((SELECT count(*) = 2 AND bool_and(ajoute_le = current_date AND retire_le IS NULL
                                                         AND incorpore_par = :'avenant_a')
                       FROM app.contrats_vehicules WHERE vehicule_id IN ('40000000-0000-4000-8000-000000000903',
                                                                          '40000000-0000-4000-8000-000000000904')),
                      'les véhicules incorporés figurent sur le contrat à la date de l''avenant, liés à lui');
SELECT tests.verifier((SELECT primes_avenants = 795000 AND prime_due = 1695000 AND reste_a_payer = 795000
                       FROM app.v_soldes_contrats WHERE contrat_id = '30000000-0000-4000-8000-000000000901'),
                      'la prime due inclut l''avenant : 795 000 F CFA restent à payer');
SELECT tests.verifier((SELECT NOT regle FROM app.v_avenants_flotte WHERE id = :'avenant_a'),
                      'avenant pas encore réglé');
SELECT tests.verifier((SELECT statut = 'en_vigueur' FROM app.contrats WHERE id = '30000000-0000-4000-8000-000000000901'),
                      'le contrat reste en vigueur pour les véhicules déjà payés');

-- Règlement de l'avenant au guichet : jamais plus que la prime due
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe)
  VALUES ('30000000-0000-4000-8000-000000000901', 800000, 'virement', 'VIR-AV-TROP')$q$, 'restent à régler');
INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe)
VALUES ('30000000-0000-4000-8000-000000000901', 795000, 'virement', 'VIR-AV-1');
COMMIT;
SELECT tests.verifier((SELECT regle FROM app.v_avenants_flotte WHERE id = :'avenant_a')
                      AND (SELECT reste_a_payer = 0 FROM app.v_soldes_contrats WHERE contrat_id = '30000000-0000-4000-8000-000000000901'),
                      'avenant réglé, plus rien à payer');

-- Avenants B et C : retraits, ristourne au prorata, prime du véhicule reprise de son entrée dans le contrat
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000903", "mouvement": "retrait"}]', NULL, true)$q$,
  'doit suivre son entrée dans le contrat');
SELECT tests.verifier((SELECT (r -> 'montant')::bigint = -246575 AND (r #>> '{lignes,0,primeVehicule}')::bigint = 450000
                       FROM app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date + 65,
                         '[{"vehiculeId": "40000000-0000-4000-8000-000000000901", "mouvement": "retrait", "primeVehicule": 1}]',
                         'Camion vendu', true) r),
                      'retrait : ristourne de 450 000 × 200 ÷ 365 = 246 575 F CFA (prime reprise de l''entrée, pas celle saisie)');
SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date + 30,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000904", "mouvement": "retrait"}]', NULL, true);
COMMIT;
SELECT tests.verifier((SELECT retire_le = current_date + 65 FROM app.contrats_vehicules
                       WHERE vehicule_id = '40000000-0000-4000-8000-000000000901'),
                      'le véhicule sort du contrat à la date de l''avenant');
SELECT tests.verifier((SELECT reste_a_payer = -716575 FROM app.v_soldes_contrats WHERE contrat_id = '30000000-0000-4000-8000-000000000901'),
                      'prime déjà payée : les ristournes (246 575 + 470 000) apparaissent comme un trop-perçu à rembourser');

\echo
\echo '33. Annulation d''un avenant saisi par erreur, réintégration d''un véhicule sorti'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.doit_echouer(format($q$SELECT app.annuler_avenant_flotte(%L, 'Erreur de saisie', true)$q$, :'avenant_a'),
  'porte depuis sur les mêmes véhicules : annulez-le d''abord');
SELECT tests.doit_echouer(format($q$SELECT app.annuler_avenant_flotte(id, 'Non', true) FROM app.avenants_flotte WHERE numero = %s$q$,
                                 :numero_a + 2), 'motif de l''annulation');
SELECT tests.verifier((SELECT (r -> 'montant')::bigint = 470000 AND r ->> 'id' IS NULL
                       FROM app.avenants_flotte a, app.annuler_avenant_flotte(a.id, 'Erreur de véhicule', false) r
                       WHERE a.numero = :numero_a + 2),
                      'aperçu de l''annulation du retrait de 9004 FL 01 : +470 000 F CFA, rien d''écrit');
SELECT app.annuler_avenant_flotte(id, 'Erreur de véhicule : 9004 FL 01 roule toujours', true)
FROM app.avenants_flotte WHERE numero = :numero_a + 2;
COMMIT;
SELECT tests.verifier((SELECT retire_le IS NULL AND retire_par IS NULL FROM app.contrats_vehicules
                       WHERE vehicule_id = '40000000-0000-4000-8000-000000000904'),
                      'retrait annulé : 9004 FL 01 est de nouveau couvert, sans interruption');
SELECT tests.verifier((SELECT nature = 'annulation' AND montant = 470000 AND date_effet = current_date + 30
                              AND annule_numero = :numero_a + 2
                       FROM app.v_avenants_flotte WHERE numero = :numero_a + 3),
                      'l''avenant d''annulation reprend la date d''effet et le montant opposé de l''avenant annulé');
SELECT tests.verifier((SELECT annule_par_numero = :numero_a + 3 AND regle IS NULL
                       FROM app.v_avenants_flotte WHERE numero = :numero_a + 2),
                      'l''avenant annulé indique par quel avenant');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.doit_echouer(format($q$SELECT app.annuler_avenant_flotte(id, 'Encore une fois', true) FROM app.avenants_flotte WHERE numero = %s$q$,
                                 :numero_a + 2), 'déjà annulé');
SELECT tests.doit_echouer(format($q$SELECT app.annuler_avenant_flotte(id, 'Annuler l''annulation', true) FROM app.avenants_flotte WHERE numero = %s$q$,
                                 :numero_a + 3), 'ne s''annule pas');
-- Un véhicule incorporé qui a déjà servi (attestation, sinistre) ne s'annule plus : on le retire
UPDATE app.contrats_vehicules SET numero_attestation = 'ATT-9003' WHERE vehicule_id = '40000000-0000-4000-8000-000000000903';
SELECT tests.doit_echouer(format($q$SELECT app.annuler_avenant_flotte(%L, 'Erreur de saisie', true)$q$, :'avenant_a'),
  '9003 FL 01 .attestation ATT-9003 émise');
ROLLBACK;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
INSERT INTO app.sinistres (contrat_id, vehicule_id, survenu_le, nature)
VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000904', current_date, 'materiel');
SELECT tests.doit_echouer(format($q$SELECT app.annuler_avenant_flotte(%L, 'Erreur de saisie', true)$q$, :'avenant_a'),
  '9004 FL 01 .sinistre déclaré');
ROLLBACK;

-- Réintégration de 9001 FL 01, sorti à J+65 : pas avant sa sortie ; prime précédente reprise
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.doit_echouer($q$SELECT app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date + 60,
  '[{"vehiculeId": "40000000-0000-4000-8000-000000000901", "mouvement": "incorporation"}]', NULL, true)$q$,
  'ne peut y revenir qu''à partir de cette date');
SELECT tests.verifier((SELECT (r -> 'montant')::bigint = 203425
                       FROM app.avenant_flotte('30000000-0000-4000-8000-000000000901', current_date + 100,
                         '[{"vehiculeId": "40000000-0000-4000-8000-000000000901", "mouvement": "incorporation"}]',
                         'Camion racheté', true) r),
                      'réintégration : 450 000 × 165 ÷ 365 = 203 425 F CFA, prime précédente reprise');
COMMIT;
SELECT tests.verifier((SELECT array_agg(ajoute_le - current_date ORDER BY ajoute_le) = ARRAY[-100, 100]
                              AND array_agg(retire_le - current_date ORDER BY ajoute_le)::text = '{65,NULL}'
                       FROM app.contrats_vehicules WHERE vehicule_id = '40000000-0000-4000-8000-000000000901'),
                      '9001 FL 01 a deux périodes sur le contrat, sans chevauchement');

-- Annulation de la réintégration, puis du retrait : on revient à la situation d'origine
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
SELECT tests.doit_echouer(format($q$SELECT app.annuler_avenant_flotte(id, 'Erreur de saisie', true) FROM app.avenants_flotte WHERE numero = %s$q$,
                                 :numero_a + 1), 'annulez-le d''abord');
SELECT app.annuler_avenant_flotte(id, 'Rachat finalement abandonné', true) FROM app.avenants_flotte WHERE numero = :numero_a + 4;
SELECT app.annuler_avenant_flotte(id, 'Vente du camion annulée', true) FROM app.avenants_flotte WHERE numero = :numero_a + 1;
COMMIT;
SELECT tests.verifier((SELECT count(*) = 1 AND bool_and(retire_le IS NULL AND ajoute_le = current_date - 100)
                       FROM app.contrats_vehicules WHERE vehicule_id = '40000000-0000-4000-8000-000000000901'),
                      'annulations successives : 9001 FL 01 retrouve sa période d''origine');
SELECT tests.verifier((SELECT primes_avenants = 795000 AND reste_a_payer = 0
                       FROM app.v_soldes_contrats WHERE contrat_id = '30000000-0000-4000-8000-000000000901'),
                      'prime due revenue à 1 695 000 F CFA, entièrement payée');

-- Un avenant ne se réécrit pas, même par le propriétaire de la base
SELECT tests.doit_echouer($q$UPDATE app.avenants_flotte SET montant = 0$q$, 'ne se modifie pas');
SELECT tests.doit_echouer($q$DELETE FROM app.avenants_flotte$q$, 'ne se modifie pas');
SELECT tests.doit_echouer($q$UPDATE app.avenants_flotte_lignes SET montant = 0$q$, 'ne se modifie pas');
SELECT tests.verifier((SELECT count(*) FROM audit.journal WHERE table_nom = 'app.avenants_flotte') = 7,
                      'les sept avenants (dont trois annulations) sont consignés au journal d''audit');

-- Lecture : qui voit le contrat voit ses avenants ; un apporteur ne voit pas ceux des autres
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000006', true);  -- apporteur
SELECT tests.verifier((SELECT count(*) FROM app.avenants_flotte) = 0 AND (SELECT count(*) FROM app.avenants_flotte_lignes) = 0,
                      'l''apporteur ne voit pas les avenants des autres clients');
SELECT tests.doit_echouer(format($q$SELECT app.annuler_avenant_flotte(%L, 'Erreur de saisie', true)$q$, :'avenant_a'),
  'Seuls le gérant et les chargés de clientèle');
ROLLBACK;
\echo
\echo '34. Documents des véhicules : un message par client et par étape, chaque document annoncé une fois'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
INSERT INTO app.vehicules (id, client_id, immatriculation, echeance_visite_technique, echeance_vignette, echeance_carte_transport) VALUES
  ('40000000-0000-4000-8000-000000000911', '20000000-0000-4000-8000-000000000902', '9011 DOC 01', current_date + 20, current_date + 25, NULL),
  ('40000000-0000-4000-8000-000000000912', '20000000-0000-4000-8000-000000000902', '9012 DOC 01', NULL, NULL, current_date + 5),
  ('40000000-0000-4000-8000-000000000913', '20000000-0000-4000-8000-000000000902', '9013 DOC 01', current_date - 3, NULL, NULL),
  ('40000000-0000-4000-8000-000000000914', '20000000-0000-4000-8000-000000000902', '9014 DOC 01', current_date + 45, NULL, NULL),
  ('40000000-0000-4000-8000-000000000915', '20000000-0000-4000-8000-000000000903', '9015 DOC 01', current_date + 6, NULL, NULL);
INSERT INTO app.consentements (client_id, canal, accorde, preuve)
VALUES ('20000000-0000-4000-8000-000000000902', 'whatsapp', true, 'Accord du gérant de la société au guichet');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.verifier((SELECT array_agg(cle ORDER BY cle) FROM app.v_relances_dues WHERE client_id = '20000000-0000-4000-8000-000000000902')
                      = ARRAY['documents_vehicules:20000000-0000-4000-8000-000000000902:echu:' || to_char((now() AT TIME ZONE 'Africa/Abidjan')::date, 'YYYY-MM-DD'),
                              'documents_vehicules:20000000-0000-4000-8000-000000000902:j30:' || to_char((now() AT TIME ZONE 'Africa/Abidjan')::date, 'YYYY-MM-DD'),
                              'documents_vehicules:20000000-0000-4000-8000-000000000902:j7:' || to_char((now() AT TIME ZONE 'Africa/Abidjan')::date, 'YYYY-MM-DD')],
                      'trois messages dus : documents échus, à J-30 et à J-7 (pas le document à J-45)');
SELECT tests.verifier((SELECT parametres -> 'nombre' = '2' AND parametres ->> 'premiereEcheance' = (current_date + 20)::text
                              AND parametres #>> '{documents,0,document}' = 'visite_technique'
                              AND parametres #>> '{documents,1,document}' = 'vignette'
                              AND parametres #>> '{documents,0,immatriculation}' = '9011 DOC 01'
                              AND parametres ->> 'nom' = 'Transports Docs'
                       FROM app.v_relances_dues WHERE cle LIKE 'documents_vehicules:20000000-0000-4000-8000-000000000902:j30:%'),
                      'le message à J-30 liste les deux documents, par date d''échéance');
SELECT tests.verifier(EXISTS (SELECT 1 FROM app.v_relances_dues WHERE client_id = '20000000-0000-4000-8000-000000000903'),
                      'sans accord, le rappel reste dû : à faire par l''agence');
ROLLBACK;

-- L'objet d'une relance de documents : le client seul
SELECT tests.doit_echouer($q$INSERT INTO app.relances (cle, type, client_id, contrat_id, canal, destinataire, parametres)
  VALUES ('documents_vehicules:x', 'documents_vehicules', '20000000-0000-4000-8000-000000000902',
          '30000000-0000-4000-8000-000000000901', 'whatsapp', '+2250715000002', '{}')$q$, 'relances_objet');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT app.planifier_relances('{whatsapp}');
COMMIT;
SELECT tests.verifier((SELECT count(*) FROM app.relances WHERE client_id = '20000000-0000-4000-8000-000000000902'
                       AND type = 'documents_vehicules' AND canal = 'whatsapp') = 3,
                      'trois messages WhatsApp planifiés pour le transporteur, pas un par véhicule');
SELECT tests.verifier((SELECT count(*) FROM app.annonces_documents a JOIN app.vehicules v ON v.id = a.vehicule_id
                       WHERE v.client_id = '20000000-0000-4000-8000-000000000902') = 4,
                      'chaque document annoncé est noté avec son étape');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.relances WHERE client_id = '20000000-0000-4000-8000-000000000903'),
                      'aucun envoi automatique au client qui n''a pas donné son accord');

-- Un document qui entre dans une étape après l'envoi du jour sera annoncé le lendemain, seul
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
UPDATE app.vehicules SET echeance_vignette = current_date + 10 WHERE id = '40000000-0000-4000-8000-000000000914';
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.planifier_relances('{whatsapp}') = 0, 'le message à J-30 du jour est déjà parti : rien de plus aujourd''hui');
COMMIT;
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.annonces_documents WHERE vehicule_id = '40000000-0000-4000-8000-000000000914'),
                      'la nouvelle vignette n''est pas comptée comme annoncée');
SELECT tests.verifier((SELECT premiere_anomalie IS NULL FROM audit.verifier_chaine()), 'journal d''audit toujours intègre');

\echo
\echo 'Tests des flottes et des documents des véhicules passés.'
