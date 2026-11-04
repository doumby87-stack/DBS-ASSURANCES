-- =====================================================================
-- Tests de la migration 0012 : portail des entreprises (gestionnaires, connexion par code, sessions,
-- isolement des entreprises par le rôle dbs_portail, attestations). S'exécute après 01 à 09.
--   · Transports Alpha et Transports Beta : deux entreprises, chacune sa flotte ;
--   · Particulier Gamma : pas d'accès au portail.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '38. Gestionnaires : plusieurs accès par entreprise, créés par l''agence'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.clients (id, type, nom, telephone) VALUES
  ('20000000-0000-4000-8000-000000001001', 'entreprise', 'Transports Alpha', '+2250716000101'),
  ('20000000-0000-4000-8000-000000001002', 'entreprise', 'Transports Beta', '+2250716000102'),
  ('20000000-0000-4000-8000-000000001003', 'particulier', 'Particulier Gamma', '+2250716000103');
INSERT INTO app.vehicules (id, client_id, immatriculation, echeance_visite_technique) VALUES
  ('40000000-0000-4000-8000-000000001001', '20000000-0000-4000-8000-000000001001', '1001 AL 01', current_date + 20),
  ('40000000-0000-4000-8000-000000001002', '20000000-0000-4000-8000-000000001001', '1002 AL 01', NULL),
  ('40000000-0000-4000-8000-000000001003', '20000000-0000-4000-8000-000000001002', '1003 BE 01', NULL);
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc, prime_nette) VALUES
  ('30000000-0000-4000-8000-000000001001', '20000000-0000-4000-8000-000000001001', 'ALP-1', 'flotte',
   current_date - 30, current_date + 335, 600000, 480000),
  ('30000000-0000-4000-8000-000000001002', '20000000-0000-4000-8000-000000001002', 'BET-1', 'flotte',
   current_date - 30, current_date + 335, 300000, 240000);
INSERT INTO app.contrats_vehicules (id, contrat_id, vehicule_id, ajoute_le, prime_vehicule, numero_attestation) VALUES
  ('50000000-0000-4000-8000-000000001001', '30000000-0000-4000-8000-000000001001', '40000000-0000-4000-8000-000000001001', current_date - 30, 300000, NULL),
  ('50000000-0000-4000-8000-000000001002', '30000000-0000-4000-8000-000000001001', '40000000-0000-4000-8000-000000001002', current_date - 30, 300000, NULL),
  ('50000000-0000-4000-8000-000000001003', '30000000-0000-4000-8000-000000001002', '40000000-0000-4000-8000-000000001003', current_date - 30, 300000, NULL);
INSERT INTO app.sinistres (id, contrat_id, vehicule_id, survenu_le, nature, description) VALUES
  ('60000000-0000-4000-8000-000000001001', '30000000-0000-4000-8000-000000001001', '40000000-0000-4000-8000-000000001001',
   current_date - 3, 'materiel', 'Note interne de l''agence');
INSERT INTO app.gestionnaires_portail (id, client_id, nom, telephone, role) VALUES
  ('70000000-0000-4000-8000-000000001001', '20000000-0000-4000-8000-000000001001', 'Awa Alpha', '+2250716000001', 'titulaire'),
  ('70000000-0000-4000-8000-000000001002', '20000000-0000-4000-8000-000000001001', 'Koné Alpha', '+2250716000002', 'gestionnaire'),
  ('70000000-0000-4000-8000-000000001003', '20000000-0000-4000-8000-000000001002', 'Bamba Beta', '+2250716000003', 'titulaire');
SELECT tests.doit_echouer($q$INSERT INTO app.gestionnaires_portail (client_id, nom, telephone)
  VALUES ('20000000-0000-4000-8000-000000001003', 'Gamma', '+2250716000009')$q$, 'réservé aux entreprises');
SELECT tests.doit_echouer($q$INSERT INTO app.gestionnaires_portail (client_id, nom, telephone)
  VALUES ('20000000-0000-4000-8000-000000001002', 'Doublon', '+2250716000001')$q$, 'gestionnaires_portail_telephone_unique');
SELECT tests.doit_echouer($q$INSERT INTO app.gestionnaires_portail (client_id, nom, telephone)
  VALUES ('20000000-0000-4000-8000-000000001002', 'Mauvais numéro', '0716000004')$q$, 'gestionnaires_portail_telephone');
SELECT tests.doit_echouer($q$UPDATE app.gestionnaires_portail SET derniere_connexion_le = now()$q$, 'permission denied');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe) VALUES
  ('30000000-0000-4000-8000-000000001001', 600000, 'virement', 'VIR-ALP-1'),
  ('30000000-0000-4000-8000-000000001002', 100000, 'virement', 'VIR-BET-1');
SELECT tests.verifier((SELECT count(*) FROM app.gestionnaires_portail) = 0, 'le caissier ne voit pas les accès au portail');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.doit_echouer($q$INSERT INTO app.gestionnaires_portail (client_id, nom, telephone)
  VALUES ('20000000-0000-4000-8000-000000001002', 'Par un commercial', '+2250716000005')$q$, 'row-level security');
ROLLBACK;
SELECT tests.verifier((SELECT cree_par = '10000000-0000-4000-8000-000000000004' AND actif AND desactive_le IS NULL
                       FROM app.gestionnaires_portail WHERE id = '70000000-0000-4000-8000-000000001001'),
                      'l''accès porte le nom de qui l''a créé');

\echo
\echo '39. Connexion par code : empreinte seule, un code valable à la fois, essais et demandes limités'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT statut = 'inconnu' AND gestionnaire_id IS NULL
                       FROM portail.preparer_code('+2250716000099', sha256('000000'), '203.0.113.10', interval '10 minutes')),
                      'numéro sans accès : rien n''est envoyé (l''API répond comme pour un numéro connu)');
SELECT tests.verifier((SELECT statut = 'envoyer' AND gestionnaire_id = '70000000-0000-4000-8000-000000001001' AND nom = 'Awa Alpha'
                       FROM portail.preparer_code('+2250716000001', sha256('111111'), '203.0.113.10', interval '10 minutes')),
                      'numéro connu : code enregistré, à envoyer');
SELECT tests.verifier((SELECT statut = 'envoyer'
                       FROM portail.preparer_code('+2250716000001', sha256('222222'), '203.0.113.10', interval '10 minutes')),
                      'nouvelle demande : nouveau code');
COMMIT;
SELECT tests.verifier((SELECT count(*) FILTER (WHERE annule_le IS NULL) = 1 AND count(*) = 2
                       FROM portail.codes_connexion WHERE gestionnaire_id = '70000000-0000-4000-8000-000000001001'),
                      'le nouveau code remplace le précédent');
SELECT tests.verifier((SELECT bool_and(expire_le <= now() + interval '10 minutes' AND tentatives = 0)
                       FROM portail.codes_connexion WHERE gestionnaire_id = '70000000-0000-4000-8000-000000001001'),
                      'le code expire au bout de 10 minutes');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT statut = 'invalide' FROM portail.verifier_code('+2250716000001', sha256('111111'), '203.0.113.10')),
                      'l''ancien code ne marche plus');
SELECT tests.verifier((SELECT statut = 'valide' AND gestionnaire_id = '70000000-0000-4000-8000-000000001001'
                       FROM portail.verifier_code('+2250716000001', sha256('222222'), '203.0.113.10')),
                      'le bon code ouvre l''accès');
SELECT tests.verifier((SELECT statut = 'invalide' FROM portail.verifier_code('+2250716000001', sha256('222222'), '203.0.113.10')),
                      'un code ne sert qu''une fois');
SELECT tests.verifier((SELECT statut = 'envoyer'
                       FROM portail.preparer_code('+2250716000001', sha256('333333'), '203.0.113.11', interval '10 minutes')),
                      'troisième demande en 15 minutes : encore acceptée');
SELECT tests.verifier((SELECT statut = 'trop_de_demandes'
                       FROM portail.preparer_code('+2250716000001', sha256('344444'), '203.0.113.11', interval '10 minutes')),
                      'quatrième demande en 15 minutes pour ce numéro : elle attend, même depuis une autre adresse');
SELECT tests.verifier((SELECT statut = 'trop_de_demandes'
                       FROM portail.preparer_code('+2250716000098', sha256('333333'), '203.0.113.10', interval '10 minutes'))
                      IS FALSE, 'un autre numéro depuis la même adresse reste possible');
COMMIT;
SELECT tests.verifier((SELECT derniere_connexion_le IS NOT NULL FROM app.gestionnaires_portail
                       WHERE id = '70000000-0000-4000-8000-000000001001'), 'la dernière connexion est notée');

-- Cinq essais au plus par code
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT statut FROM portail.preparer_code('+2250716000002', sha256('444444'), '203.0.113.12', interval '10 minutes');
SELECT (portail.verifier_code('+2250716000002', sha256('999999'), '203.0.113.12')).statut FROM generate_series(1, 5);
SELECT tests.verifier((SELECT statut = 'invalide' FROM portail.verifier_code('+2250716000002', sha256('444444'), '203.0.113.12')),
                      'après cinq erreurs, même le bon code est refusé : il faut en demander un autre');
COMMIT;
SELECT tests.verifier((SELECT count(*) FROM portail.evenements WHERE type = 'code_echoue' AND adresse_ip = '203.0.113.12') = 6,
                      'chaque échec est consigné au journal du portail');

-- Code expiré
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT statut FROM portail.preparer_code('+2250716000003', sha256('555555'), '203.0.113.13', interval '-1 second');
SELECT tests.verifier((SELECT statut = 'invalide' FROM portail.verifier_code('+2250716000003', sha256('555555'), '203.0.113.13')),
                      'un code expiré est refusé');
ROLLBACK;

\echo
\echo '40. Sessions du portail : durée, inactivité, coupure à la désactivation de l''accès'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT portail.ouvrir_session('70000000-0000-4000-8000-000000001001', sha256('session-awa'), interval '12 hours', '203.0.113.10', 'navigateur');
SELECT portail.ouvrir_session('70000000-0000-4000-8000-000000001002', sha256('session-kone'), interval '12 hours', '203.0.113.12', 'navigateur');
SELECT tests.verifier((SELECT entreprise = 'Transports Alpha' AND role = 'titulaire' AND client_id = '20000000-0000-4000-8000-000000001001'
                       FROM portail.lire_session(sha256('session-awa'), interval '30 minutes')),
                      'la session donne la personne et son entreprise');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM portail.lire_session(sha256('inconnue'), interval '30 minutes')),
                      'jeton inconnu : aucune session');
COMMIT;
UPDATE portail.sessions SET derniere_activite_le = now() - interval '31 minutes' WHERE empreinte = sha256('session-kone');
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM portail.lire_session(sha256('session-kone'), interval '30 minutes')),
                      'au-delà de 30 minutes d''inactivité, la session est close');
SELECT tests.doit_echouer($q$SELECT * FROM portail.sessions$q$, 'permission denied');
SELECT tests.doit_echouer($q$SELECT * FROM portail.codes_connexion$q$, 'permission denied');
COMMIT;

\echo
\echo '41. Rôle dbs_portail : l''entreprise de la personne connectée, et rien d''autre'
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT tests.doit_echouer($q$SELECT count(*) FROM app.vehicules$q$, 'Aucune personne connectée au portail');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', '70000000-0000-4000-8000-000000001001', true);  -- Awa, Transports Alpha
SELECT tests.verifier((SELECT array_agg(nom) FROM app.clients) = ARRAY['Transports Alpha'], 'une seule entreprise visible : la sienne');
SELECT tests.verifier((SELECT array_agg(immatriculation ORDER BY immatriculation) FROM app.vehicules) = ARRAY['1001 AL 01', '1002 AL 01'],
                      'ses véhicules seulement');
SELECT tests.verifier((SELECT array_agg(numero_police) FROM app.contrats) = ARRAY['ALP-1'], 'ses contrats seulement');
SELECT tests.verifier((SELECT count(*) FROM app.contrats_vehicules) = 2, 'la composition de ses contrats seulement');
SELECT tests.verifier((SELECT count(*) = 1 AND bool_and(nature = 'materiel') FROM app.sinistres
                       WHERE vehicule_id = '40000000-0000-4000-8000-000000001001'), 'l''historique des sinistres de son véhicule');
SELECT tests.verifier((SELECT reste_a_payer = 0 AND prime_due = 600000 FROM app.v_soldes_contrats), 'le reste à payer de ses contrats');
SELECT tests.verifier((SELECT count(*) FROM app.gestionnaires_portail) = 2, 'les accès de son entreprise');
SELECT tests.doit_echouer($q$SELECT prime_nette FROM app.contrats$q$, 'permission denied');
SELECT tests.doit_echouer($q$SELECT description FROM app.sinistres$q$, 'permission denied');
SELECT tests.doit_echouer($q$SELECT reference_externe FROM app.encaissements$q$, 'permission denied');
SELECT tests.doit_echouer($q$SELECT telephone FROM app.clients$q$, 'permission denied');
SELECT tests.doit_echouer($q$SELECT * FROM app.utilisateurs$q$, 'permission denied');
SELECT tests.doit_echouer($q$SELECT * FROM app.relances$q$, 'permission denied');
SELECT tests.doit_echouer($q$SELECT * FROM app.demandes_site$q$, 'permission denied');
SELECT tests.doit_echouer($q$SELECT * FROM portail.evenements$q$, 'permission denied');
SELECT tests.doit_echouer($q$UPDATE app.vehicules SET marque = 'X'$q$, 'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO app.gestionnaires_portail (client_id, nom, telephone) VALUES
  ('20000000-0000-4000-8000-000000001001', 'Intrus', '+2250716000077')$q$, 'permission denied');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', '70000000-0000-4000-8000-000000001003', true);  -- Bamba, Transports Beta
SELECT tests.verifier((SELECT array_agg(immatriculation) FROM app.vehicules) = ARRAY['1003 BE 01'], 'Transports Beta ne voit que sa flotte');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.sinistres), 'ni les sinistres de Transports Alpha');
SELECT tests.verifier((SELECT reste_a_payer = 200000 FROM app.v_soldes_contrats), 'son propre reste à payer');
ROLLBACK;

\echo
\echo '42. Le titulaire gère les accès de ses collaborateurs'
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', '70000000-0000-4000-8000-000000001002', true);  -- Koné, simple gestionnaire
SELECT tests.doit_echouer($q$SELECT portail.ajouter_gestionnaire('Nouvel employé', '+2250716000004', '203.0.113.12')$q$,
  'Seul le titulaire');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', '70000000-0000-4000-8000-000000001001', true);  -- Awa, titulaire
SELECT portail.ajouter_gestionnaire('Yao Alpha', '+2250716000004', '203.0.113.10') AS nouvel_acces \gset
SELECT tests.doit_echouer($q$SELECT portail.desactiver_gestionnaire('70000000-0000-4000-8000-000000001001', '203.0.113.10')$q$,
  'L''accès d''un titulaire se retire en le demandant à l''agence');
SELECT tests.doit_echouer($q$SELECT portail.desactiver_gestionnaire('70000000-0000-4000-8000-000000001003', '203.0.113.10')$q$,
  'Accès introuvable');
SELECT portail.desactiver_gestionnaire('70000000-0000-4000-8000-000000001002', '203.0.113.10');
COMMIT;
SELECT tests.verifier((SELECT role = 'gestionnaire' AND cree_par IS NULL AND cree_par_gestionnaire = '70000000-0000-4000-8000-000000001001'
                       FROM app.gestionnaires_portail WHERE id = :'nouvel_acces'),
                      'l''accès ajouté par le titulaire porte son nom');
SELECT tests.verifier((SELECT NOT actif AND desactive_le IS NOT NULL FROM app.gestionnaires_portail
                       WHERE id = '70000000-0000-4000-8000-000000001002')
                      AND NOT EXISTS (SELECT 1 FROM portail.sessions WHERE gestionnaire_id = '70000000-0000-4000-8000-000000001002'),
                      'l''accès retiré est désactivé et ses sessions coupées');
SELECT tests.verifier((SELECT count(*) FROM portail.evenements WHERE type IN ('gestionnaire_ajoute', 'gestionnaire_desactive')) = 2,
                      'ajouts et retraits consignés au journal du portail');
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', '70000000-0000-4000-8000-000000001002', true);
SELECT tests.doit_echouer($q$SELECT count(*) FROM app.vehicules$q$, 'inconnu ou désactivé');
ROLLBACK;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT statut = 'inconnu'
                       FROM portail.preparer_code('+2250716000002', sha256('666666'), '203.0.113.14', interval '10 minutes')),
                      'un accès désactivé ne reçoit plus de code');
COMMIT;

\echo
\echo '43. Attestations : déposées par l''agence avec leur numéro, lues par l''entreprise concernée seulement'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.doit_echouer($q$INSERT INTO app.attestations_vehicules (contrat_vehicule_id, contenu_chiffre, empreinte, taille, etat_analyse)
  VALUES ('50000000-0000-4000-8000-000000001001', '\x01', sha256('pdf'), 3, 'saine')$q$, 'numéro de l''attestation');
UPDATE app.contrats_vehicules SET numero_attestation = 'ASACI-1001' WHERE id = '50000000-0000-4000-8000-000000001001';
INSERT INTO app.attestations_vehicules (contrat_vehicule_id, contenu_chiffre, empreinte, taille, etat_analyse)
VALUES ('50000000-0000-4000-8000-000000001001', '\x01', sha256('pdf'), 3, 'saine');
SELECT tests.doit_echouer($q$UPDATE app.attestations_vehicules SET etat_analyse = 'infectee'$q$, 'attestations_vehicules_etat');
COMMIT;
SELECT tests.verifier((SELECT depose_par = '10000000-0000-4000-8000-000000000004' FROM app.attestations_vehicules),
                      'l''attestation porte le nom de qui l''a déposée');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM audit.journal WHERE table_nom = 'app.attestations_vehicules' AND apres ? 'contenu_chiffre'),
                      'le journal d''audit ne garde pas le contenu chiffré');
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
UPDATE app.attestations_vehicules SET taille = 4;
SELECT tests.verifier((SELECT taille = 3 FROM app.attestations_vehicules), 'un commercial ne remplace pas une attestation');
ROLLBACK;
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', '70000000-0000-4000-8000-000000001001', true);
SELECT tests.verifier((SELECT count(*) FROM app.attestations_vehicules) = 1, 'Transports Alpha lit son attestation');
SELECT portail.consigner('attestation_telechargee', 'Attestation ASACI-1001 (1001 AL 01)', '203.0.113.10');
SELECT tests.doit_echouer($q$SELECT portail.consigner('connexion_reussie', 'faux', '203.0.113.10')$q$, 'non consignable');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', '70000000-0000-4000-8000-000000001003', true);
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.attestations_vehicules), 'Transports Beta ne lit pas celle d''Alpha');
ROLLBACK;
SELECT tests.verifier(EXISTS (SELECT 1 FROM portail.evenements WHERE type = 'attestation_telechargee'
                              AND gestionnaire_id = '70000000-0000-4000-8000-000000001001'),
                      'le téléchargement est consigné au nom de la personne connectée');

-- Ménage horaire des codes et des sessions
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);
SELECT tests.verifier((SELECT portail.purger() >= 0), 'le ménage des codes et des sessions tourne');
ROLLBACK;
SELECT tests.verifier((SELECT premiere_anomalie IS NULL FROM audit.verifier_chaine()), 'journal d''audit toujours intègre');

\echo
\echo 'Tests du portail des entreprises passés.'
