-- =====================================================================
-- Tests de la migration 0013 : espace client des particuliers (ouverture automatique), paiement en ligne
-- (préparation, conclusion vérifiée, régularisation), déclaration des sinistres et de leurs pièces.
-- S'exécute après 01 à 10.
--   · Koné Awa (+2250717000001), particulière avec un contrat ; Koné Bis (+2250717000002) sans contrat ;
--     deux clients qui partagent le +2250717000003 ; Transports Delta (+2250717000004), entreprise.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '44. Espace client : ouvert automatiquement au numéro que l''agence a enregistré'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.clients (id, type, nom, telephone) VALUES
  ('20000000-0000-4000-8000-000000001101', 'particulier', 'Koné Awa', '+2250717000001'),
  ('20000000-0000-4000-8000-000000001102', 'particulier', 'Koné Bis', '+2250717000002'),
  ('20000000-0000-4000-8000-000000001103', 'particulier', 'Homonyme Un', '+2250717000003'),
  ('20000000-0000-4000-8000-000000001104', 'particulier', 'Homonyme Deux', '+2250717000003'),
  ('20000000-0000-4000-8000-000000001105', 'entreprise', 'Transports Delta', '+2250717000004');
INSERT INTO app.vehicules (id, client_id, immatriculation) VALUES
  ('40000000-0000-4000-8000-000000001101', '20000000-0000-4000-8000-000000001101', '1101 KA 01');
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc) VALUES
  ('30000000-0000-4000-8000-000000001101', '20000000-0000-4000-8000-000000001101', 'AUTO-1101', 'automobile',
   current_date - 10, current_date + 355, 100003),
  ('30000000-0000-4000-8000-000000001103', '20000000-0000-4000-8000-000000001103', 'AUTO-1103', 'automobile',
   current_date - 10, current_date + 355, 50000),
  ('30000000-0000-4000-8000-000000001105', '20000000-0000-4000-8000-000000001105', 'FLT-1105', 'flotte',
   current_date - 10, current_date + 355, 80000);
INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le) VALUES
  ('30000000-0000-4000-8000-000000001101', '40000000-0000-4000-8000-000000001101', current_date - 10);
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT statut = 'envoyer' AND nom = 'Koné Awa'
                       FROM portail.preparer_code('+2250717000001', sha256('100001'), '203.0.113.40', interval '10 minutes')),
                      'particulière avec un contrat : son espace s''ouvre à la première demande de code');
SELECT tests.verifier((SELECT statut = 'inconnu' FROM portail.preparer_code('+2250717000002', sha256('100002'), '203.0.113.41', interval '10 minutes')),
                      'sans contrat : pas d''espace');
SELECT tests.verifier((SELECT statut = 'inconnu' FROM portail.preparer_code('+2250717000003', sha256('100003'), '203.0.113.42', interval '10 minutes')),
                      'numéro partagé par deux clients : pas d''ouverture automatique, l''agence décide');
SELECT tests.verifier((SELECT statut = 'inconnu' FROM portail.preparer_code('+2250717000004', sha256('100004'), '203.0.113.43', interval '10 minutes')),
                      'entreprise : les accès se créent à l''agence (ses représentants, pas le standard)');
COMMIT;
SELECT tests.verifier((SELECT role = 'titulaire' AND cree_automatiquement AND cree_par IS NULL AND actif
                       FROM app.gestionnaires_portail WHERE client_id = '20000000-0000-4000-8000-000000001101'),
                      'l''accès créé automatiquement est celui du titulaire, sans auteur du personnel');
SELECT id AS acces_awa FROM app.gestionnaires_portail WHERE client_id = '20000000-0000-4000-8000-000000001101' \gset

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT portail.ouvrir_session(:'acces_awa', sha256('session-awa-particuliere'), interval '12 hours', '203.0.113.40', 'navigateur');
SELECT tests.verifier((SELECT type_client = 'particulier' AND entreprise = 'Koné Awa'
                       FROM portail.lire_session(sha256('session-awa-particuliere'), interval '30 minutes')),
                      'la session dit le type de client : l''espace s''adapte');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', :'acces_awa', true);
SELECT tests.doit_echouer($q$SELECT portail.ajouter_gestionnaire('Son cousin', '+2250717000099', '203.0.113.40')$q$,
  'réservés aux entreprises');
ROLLBACK;

-- Un accès retiré par l'agence ne se rouvre pas tout seul
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);
UPDATE app.gestionnaires_portail SET actif = false WHERE client_id = '20000000-0000-4000-8000-000000001101';
SELECT tests.verifier((SELECT statut = 'inconnu' FROM portail.preparer_code('+2250717000001', sha256('100005'), '203.0.113.44', interval '10 minutes')),
                      'accès retiré par l''agence : pas de réouverture automatique');
ROLLBACK;

\echo
\echo '45. Paiement en ligne : préparé par le portail, encaissé seulement après confirmation vérifiée'
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', :'acces_awa', true);
SELECT tests.doit_echouer($q$SELECT * FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001105', 80000, 'simulation')$q$,
  'Contrat introuvable');
SELECT tests.doit_echouer($q$SELECT * FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001101', 100003, 'simulation')$q$,
  'multiple de 5');
SELECT tests.doit_echouer($q$SELECT * FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001101', 100010, 'simulation')$q$,
  'Montant invalide');
SELECT tests.doit_echouer($q$SELECT * FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001101', 50, 'simulation')$q$,
  'Montant invalide');
SELECT id AS paiement_1, reference AS reference_1 FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001101', 40000, 'simulation') \gset
SELECT tests.doit_echouer($q$SELECT * FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001101', 40000, 'simulation')$q$,
  'déjà en cours');
SELECT portail.lier_paiement(:'paiement_1', 'https://espace.test.ci/paiements/simulation', NULL);
SELECT tests.verifier((SELECT statut = 'en_attente' AND reference ~ '^DBS-[0-9]{8}$' FROM app.paiements_en_ligne WHERE id = :'paiement_1'),
                      'paiement en attente, avec sa référence pour le prestataire');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe)
  VALUES ('30000000-0000-4000-8000-000000001101', 40000, 'mobile_money', 'faux')$q$, 'permission denied');
COMMIT;

-- Conclusion vérifiée (sans utilisateur connecté, comme l'API à réception de la confirmation du prestataire)
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.conclure_paiement_en_ligne(:'reference_1', 'accepte', 40000, 'WAVE', 'OP-778899') = 'accepte',
                      'paiement accepté pour le montant demandé : encaissé');
SELECT tests.verifier(app.conclure_paiement_en_ligne(:'reference_1', 'accepte', 40000, 'WAVE', 'OP-778899') = 'accepte',
                      'la même confirmation reçue deux fois ne change rien');
COMMIT;
SELECT tests.verifier((SELECT count(*) = 1 AND bool_and(e.encaisse_par IS NULL AND e.mode = 'mobile_money' AND e.montant = 40000
                              AND e.reference_externe = 'simulation:' || :'reference_1')
                       FROM app.encaissements e WHERE e.paiement_en_ligne_id = :'paiement_1'),
                      'un seul encaissement, sans caissier, référencé par le prestataire');
SELECT tests.verifier((SELECT p.statut = 'accepte' AND p.moyen = 'WAVE' AND p.encaissement_id IS NOT NULL
                       FROM app.paiements_en_ligne p WHERE p.id = :'paiement_1'), 'paiement accepté, relié à son encaissement');
SELECT tests.verifier((SELECT caissier_id IS NULL FROM app.v_mouvements_caisse m JOIN app.encaissements e ON e.id = m.encaissement_id
                       WHERE e.paiement_en_ligne_id = :'paiement_1'), 'il n''entre dans la caisse d''aucun caissier');
SELECT tests.verifier((SELECT statut = 'en_attente_paiement' FROM app.contrats WHERE id = '30000000-0000-4000-8000-000000001101'),
                      'prime pas encore soldée : contrat toujours en attente de paiement');

-- Solde au multiple de 5 supérieur : 60 003 F CFA restent, 60 005 payés (2 F CFA de trop-perçu admis)
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', :'acces_awa', true);
SELECT id AS paiement_2, reference AS reference_2 FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001101', 60005, 'simulation') \gset
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.conclure_paiement_en_ligne(:'reference_2', 'accepte', 60005, 'ORANGE_MONEY', 'OP-112233') = 'accepte',
                      'solde payé au multiple de 5 supérieur');
COMMIT;
SELECT tests.verifier((SELECT statut = 'en_vigueur' FROM app.contrats WHERE id = '30000000-0000-4000-8000-000000001101')
                      AND (SELECT reste_a_payer = -2 FROM app.v_soldes_contrats WHERE contrat_id = '30000000-0000-4000-8000-000000001101'),
                      'prime soldée : contrat en vigueur (2 F CFA de trop-perçu, à rendre ou déduire)');

-- Paiement refusé, puis paiement reçu mais impossible à encaisser : à régulariser par le gérant
UPDATE app.contrats SET prime_ttc = 150000, statut = 'en_attente_paiement' WHERE id = '30000000-0000-4000-8000-000000001101';
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', :'acces_awa', true);
SELECT id AS paiement_3, reference AS reference_3 FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001101', 49995, 'simulation') \gset
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.conclure_paiement_en_ligne(:'reference_3', 'refuse', NULL, 'MTN_MOMO', NULL) = 'refuse', 'paiement refusé : rien n''est encaissé');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', :'acces_awa', true);
SELECT id AS paiement_4, reference AS reference_4 FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001101', 49995, 'simulation') \gset
COMMIT;
-- Entre-temps, le client règle le même reste au guichet
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (contrat_id, montant, mode) VALUES ('30000000-0000-4000-8000-000000001101', 49995, 'especes');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.conclure_paiement_en_ligne(:'reference_4', 'accepte', 49995, 'WAVE', 'OP-445566') = 'a_regulariser',
                      'paiement reçu alors que la prime est déjà soldée : à régulariser, rien n''est perdu');
SELECT tests.verifier(app.conclure_paiement_en_ligne(:'reference_4', 'accepte', 49995, 'WAVE', 'OP-445566') = 'a_regulariser',
                      'rejouer la confirmation ne change rien');
COMMIT;
SELECT tests.verifier((SELECT motif LIKE 'Paiement reçu mais non encaissé%' AND encaissement_id IS NULL FROM app.paiements_en_ligne
                       WHERE id = :'paiement_4'), 'le motif explique pourquoi');
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.doit_echouer(format($q$SELECT app.regulariser_paiement_en_ligne(%L, 'Remboursé par Wave')$q$, :'paiement_4'), 'Seul le gérant');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
SELECT app.regulariser_paiement_en_ligne(:'paiement_4', 'Remboursé par Wave le jour même');
COMMIT;
SELECT tests.verifier((SELECT statut = 'refuse' AND motif LIKE '%Régularisé par % : Remboursé par Wave le jour même'
                       FROM app.paiements_en_ligne WHERE id = :'paiement_4'), 'régularisation tracée, au nom du gérant');

-- Montant confirmé différent du montant demandé
UPDATE app.contrats SET prime_ttc = 200000, statut = 'en_attente_paiement' WHERE id = '30000000-0000-4000-8000-000000001101';
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', :'acces_awa', true);
SELECT id AS paiement_5, reference AS reference_5 FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001101', 10000, 'simulation') \gset
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.conclure_paiement_en_ligne(:'reference_5', 'accepte', 100, 'WAVE', 'OP-1') = 'a_regulariser',
                      'montant confirmé différent : à régulariser, jamais encaissé tel quel');
COMMIT;

-- Cinq paiements commencés dans l'heure : le sixième attend
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', :'acces_awa', true);
SELECT tests.doit_echouer($q$SELECT * FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001101', 10000, 'simulation')$q$,
  'Trop de paiements commencés en une heure');
ROLLBACK;
UPDATE app.paiements_en_ligne SET cree_le = cree_le - interval '2 hours' WHERE contrat_id = '30000000-0000-4000-8000-000000001101';

-- Paiement resté sans réponse plus d'un jour : abandonné
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', :'acces_awa', true);
SELECT id AS paiement_6 FROM portail.preparer_paiement('30000000-0000-4000-8000-000000001101', 10000, 'simulation') \gset
COMMIT;
UPDATE app.paiements_en_ligne SET cree_le = now() - interval '25 hours' WHERE id = :'paiement_6';
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.abandonner_paiements_en_ligne() = 1, 'paiement sans réponse depuis un jour : abandonné par la maintenance');
COMMIT;

-- Lecture : le portail voit ses paiements, pas ceux d'un autre ; le caissier les voit tous
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', :'acces_awa', true);
SELECT tests.verifier((SELECT count(*) FROM app.paiements_en_ligne) = 6, 'la particulière voit ses six paiements');
SELECT tests.doit_echouer($q$SELECT motif FROM app.paiements_en_ligne$q$, 'permission denied');
ROLLBACK;
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', '70000000-0000-4000-8000-000000001003', true);  -- Transports Beta (10)
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.paiements_en_ligne), 'une autre entreprise ne voit aucun de ses paiements');
ROLLBACK;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);
SELECT tests.verifier((SELECT count(*) FROM app.paiements_en_ligne WHERE contrat_id = '30000000-0000-4000-8000-000000001101') = 6,
                      'le caissier suit tous les paiements en ligne');
ROLLBACK;

\echo
\echo '46. Déclaration d''un sinistre depuis l''espace client, avec ses photos'
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', :'acces_awa', true);
SELECT tests.doit_echouer($q$SELECT portail.declarer_sinistre('30000000-0000-4000-8000-000000001105', NULL, current_date, 'vol', false, NULL,
  'Véhicule volé devant le marché')$q$, 'Contrat introuvable');
SELECT tests.doit_echouer($q$SELECT portail.declarer_sinistre('30000000-0000-4000-8000-000000001101', NULL, current_date + 1, 'vol', false, NULL,
  'Véhicule volé devant le marché')$q$, 'Date du sinistre invalide');
SELECT tests.doit_echouer($q$SELECT portail.declarer_sinistre('30000000-0000-4000-8000-000000001101', NULL, current_date, 'vol', false, NULL, 'Volé')$q$,
  'Décrivez ce qui s''est passé');
SELECT tests.doit_echouer($q$SELECT portail.declarer_sinistre('30000000-0000-4000-8000-000000001101', '40000000-0000-4000-8000-000000001001',
  current_date, 'vol', false, NULL, 'Véhicule volé devant le marché')$q$, 'pas couvert par ce contrat');
SELECT portail.declarer_sinistre('30000000-0000-4000-8000-000000001101', '40000000-0000-4000-8000-000000001101', current_date - 1,
  'bris_de_glace', false, 'Carrefour de la Siporex, Yopougon', 'Un caillou projeté par un camion a fissuré le pare-brise.') AS sinistre_awa \gset
SELECT portail.joindre_piece_sinistre('80000000-0000-4000-8000-000000001101', :'sinistre_awa', 'pare-brise.jpg', 'image/jpeg', 4,
  '\x0102', sha256('photo'), 'saine');
SELECT tests.doit_echouer($q$SELECT contenu_chiffre FROM app.pieces_sinistres$q$, 'permission denied');
SELECT tests.verifier((SELECT nom_fichier = 'pare-brise.jpg' FROM app.pieces_sinistres), 'la particulière voit la liste de ses pièces');
SELECT tests.verifier((SELECT circonstances LIKE 'Un caillou%' AND lieu LIKE 'Carrefour%' FROM app.sinistres WHERE id = :'sinistre_awa'),
                      'elle relit son récit');
COMMIT;
SELECT tests.verifier((SELECT cree_par IS NULL AND declare_par_gestionnaire = :'acces_awa' AND statut = 'declare' AND declare_le = current_date
                       FROM app.sinistres WHERE id = :'sinistre_awa'), 'déclaration au nom de la personne connectée, statut « déclaré »');
SELECT tests.verifier(EXISTS (SELECT 1 FROM app.v_relances_dues WHERE sinistre_id = :'sinistre_awa'),
                      'l''accusé de réception de la déclaration part avec les relances (si elle l''a accepté)');
SELECT tests.doit_echouer(format($q$UPDATE app.pieces_sinistres SET nom_fichier = 'x' WHERE id = %L$q$, '80000000-0000-4000-8000-000000001101'),
  'ne se modifie pas');

BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', '70000000-0000-4000-8000-000000001003', true);  -- Transports Beta
SELECT tests.doit_echouer(format($q$SELECT portail.joindre_piece_sinistre(gen_random_uuid(), %L, 'x.jpg', 'image/jpeg', 1, '\x01',
  sha256('x'), 'saine')$q$, :'sinistre_awa'), 'Sinistre introuvable');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.pieces_sinistres), 'ni les pièces d''un autre client');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
SELECT tests.verifier((SELECT count(*) FROM app.pieces_sinistres p WHERE p.sinistre_id = :'sinistre_awa') = 1,
                      'l''agence lit les pièces de la déclaration');
SELECT tests.doit_echouer(format($q$INSERT INTO app.pieces_sinistres (id, sinistre_id, nom_fichier, type_contenu, taille, contenu_chiffre,
  empreinte, etat_analyse, depose_par) VALUES (gen_random_uuid(), %L, 'x.pdf', 'application/pdf', 1, '\x01', sha256('x'), 'saine',
  '10000000-0000-4000-8000-000000000004')$q$, :'sinistre_awa'), 'permission denied');
UPDATE app.sinistres SET statut = 'transmis_compagnie', reference_compagnie = 'SAN-AWA-1' WHERE id = :'sinistre_awa';
COMMIT;
SELECT tests.verifier((SELECT premiere_anomalie IS NULL FROM audit.verifier_chaine()), 'journal d''audit toujours intègre');

\echo
\echo 'Tests de l''espace client passés.'
