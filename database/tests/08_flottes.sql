-- =====================================================================
-- Tests des migrations 0009 et 0010 : flottes (composition, avenants au prorata, prime due) et relances
-- groupées des documents des véhicules. S'exécute après 01 à 07, dont il réutilise le personnel.
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
  ('40000000-0000-4000-8000-000000000909', '20000000-0000-4000-8000-000000000902', '9009 FL 01');
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc) VALUES
  ('30000000-0000-4000-8000-000000000901', '20000000-0000-4000-8000-000000000901', 'FLT-901', 'flotte',
   current_date - 100, current_date + 265, 900000);
INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le, prime_vehicule) VALUES
  ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000901', current_date - 100, 450000),
  ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000902', current_date - 100, 450000);
SELECT tests.doit_echouer($q$INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000903', current_date)$q$,
  'ajoutez-le à la date d''effet du contrat');
SELECT tests.doit_echouer($q$INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000909', current_date - 100)$q$,
  'n''appartient pas au client');
SELECT tests.doit_echouer($q$INSERT INTO app.avenants_flotte (contrat_id, vehicule_id, nature, date_effet, prime_vehicule)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000903', 'ajout', current_date, 365000)$q$,
  'que sur un contrat en vigueur');
COMMIT;

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
  'ajoutez le véhicule par un avenant');
SELECT tests.doit_echouer($q$UPDATE app.contrats_vehicules SET retire_le = current_date
  WHERE vehicule_id = '40000000-0000-4000-8000-000000000901'$q$, 'permission denied');
SELECT tests.doit_echouer($q$UPDATE app.contrats_vehicules SET numero_attestation = 'ATT-1', ajoute_le = current_date
  WHERE vehicule_id = '40000000-0000-4000-8000-000000000901'$q$, 'permission denied');
ROLLBACK;

\echo
\echo '32. Avenants : prime calculée par la base au prorata des jours restants, ajout seul'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.doit_echouer($q$INSERT INTO app.avenants_flotte (contrat_id, vehicule_id, nature, date_effet, prime_vehicule)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000903', 'ajout', current_date, 365000)$q$,
  'row-level security');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
SELECT tests.doit_echouer($q$INSERT INTO app.avenants_flotte (contrat_id, vehicule_id, nature, date_effet, prime_vehicule, montant)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000903', 'ajout', current_date, 365000, 1)$q$,
  'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO app.avenants_flotte (contrat_id, vehicule_id, nature, date_effet, prime_vehicule)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000903', 'ajout', current_date + 300, 365000)$q$,
  'hors du contrat');
SELECT tests.doit_echouer($q$INSERT INTO app.avenants_flotte (contrat_id, vehicule_id, nature, date_effet, prime_vehicule)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000901', 'ajout', current_date, 450000)$q$,
  'figure déjà sur ce contrat');
INSERT INTO app.avenants_flotte (contrat_id, vehicule_id, nature, date_effet, prime_vehicule)
VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000903', 'ajout', current_date, 365000);
COMMIT;

SELECT tests.verifier((SELECT jours_periode = 365 AND jours_restants = 265 AND montant = 265000 AND numero >= 1
                              AND cree_par = '10000000-0000-4000-8000-000000000004'
                       FROM app.avenants_flotte WHERE vehicule_id = '40000000-0000-4000-8000-000000000903'),
                      'ajout : 365 000 F CFA × 265 jours restants ÷ 365 = 265 000 F CFA, au nom du chargé de clientèle');
SELECT tests.verifier((SELECT ajoute_le = current_date AND prime_vehicule = 365000 AND retire_le IS NULL
                       FROM app.contrats_vehicules WHERE vehicule_id = '40000000-0000-4000-8000-000000000903'),
                      'le véhicule ajouté figure sur le contrat à la date de l''avenant');
SELECT tests.verifier((SELECT primes_avenants = 265000 AND prime_due = 1165000 AND reste_a_payer = 265000
                       FROM app.v_soldes_contrats WHERE contrat_id = '30000000-0000-4000-8000-000000000901'),
                      'la prime due inclut l''avenant : 265 000 F CFA restent à payer');
SELECT tests.verifier((SELECT NOT regle FROM app.v_avenants_flotte WHERE vehicule_id = '40000000-0000-4000-8000-000000000903'),
                      'avenant pas encore réglé');
SELECT tests.verifier((SELECT statut = 'en_vigueur' FROM app.contrats WHERE id = '30000000-0000-4000-8000-000000000901'),
                      'le contrat reste en vigueur pour les véhicules déjà payés');

-- Règlement de l'avenant au guichet : jamais plus que la prime due
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe)
  VALUES ('30000000-0000-4000-8000-000000000901', 300000, 'virement', 'VIR-AV-TROP')$q$, 'restent à régler');
INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe)
VALUES ('30000000-0000-4000-8000-000000000901', 265000, 'virement', 'VIR-AV-1');
COMMIT;
SELECT tests.verifier((SELECT regle FROM app.v_avenants_flotte WHERE vehicule_id = '40000000-0000-4000-8000-000000000903')
                      AND (SELECT reste_a_payer = 0 FROM app.v_soldes_contrats WHERE contrat_id = '30000000-0000-4000-8000-000000000901'),
                      'avenant réglé, plus rien à payer');

-- Retrait d'un véhicule : ristourne au prorata, prime du véhicule reprise du rattachement
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
SELECT tests.doit_echouer($q$INSERT INTO app.avenants_flotte (contrat_id, vehicule_id, nature, date_effet, prime_vehicule)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000903', 'retrait', current_date, 1)$q$,
  'doit suivre l''ajout');
INSERT INTO app.avenants_flotte (contrat_id, vehicule_id, nature, date_effet, prime_vehicule)
VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000901', 'retrait', current_date + 65, 1);
SELECT tests.doit_echouer($q$INSERT INTO app.avenants_flotte (contrat_id, vehicule_id, nature, date_effet, prime_vehicule)
  VALUES ('30000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000901', 'retrait', current_date + 70, 450000)$q$,
  'n''est pas couvert par ce contrat');
COMMIT;

SELECT tests.verifier((SELECT prime_vehicule = 450000 AND jours_restants = 200 AND montant = -246575
                       FROM app.avenants_flotte WHERE vehicule_id = '40000000-0000-4000-8000-000000000901'),
                      'retrait : ristourne de 450 000 × 200 ÷ 365 = 246 575 F CFA (prime reprise du rattachement)');
SELECT tests.verifier((SELECT retire_le = current_date + 65 FROM app.contrats_vehicules
                       WHERE vehicule_id = '40000000-0000-4000-8000-000000000901'),
                      'le véhicule sort du contrat à la date de l''avenant');
SELECT tests.verifier((SELECT reste_a_payer = -246575 FROM app.v_soldes_contrats WHERE contrat_id = '30000000-0000-4000-8000-000000000901'),
                      'prime déjà payée : la ristourne apparaît comme un trop-perçu à rembourser');

-- Un avenant ne se réécrit pas, même par le propriétaire de la base
SELECT tests.doit_echouer($q$UPDATE app.avenants_flotte SET montant = 0$q$, 'ne se modifie pas');
SELECT tests.doit_echouer($q$DELETE FROM app.avenants_flotte$q$, 'ne se modifie pas');
SELECT tests.verifier((SELECT count(*) FROM audit.journal WHERE table_nom = 'app.avenants_flotte') = 2,
                      'les avenants sont consignés au journal d''audit');

-- Lecture : qui voit le contrat voit ses avenants ; un apporteur ne voit pas ceux des autres
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000006', true);  -- apporteur
SELECT tests.verifier((SELECT count(*) FROM app.avenants_flotte) = 0, 'l''apporteur ne voit pas les avenants des autres clients');
ROLLBACK;

\echo
\echo '33. Documents des véhicules : un message par client et par étape, chaque document annoncé une fois'
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
