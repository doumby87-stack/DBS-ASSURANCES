-- =====================================================================
-- Tests de la migration 0005 : reçus, clôtures de caisse, bordereaux, commissions.
-- S'exécute après 01, 02 et 03, dont il réutilise le personnel, les clients et les contrats :
--   · contrat 30…05 (renouvellement, 52 000 F CFA, automobile) encore impayé ;
--   · contrat 30…02 (flotte, 300 000 F CFA), 100 000 F CFA déjà encaissés.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '18. Reçus numérotés sans trou, jamais au-delà du reste à payer, mise en vigueur automatique'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.doit_echouer('SELECT count(*) FROM app.compteurs', 'permission denied');
SELECT tests.doit_echouer($q$SELECT app.numero_suivant('recus')$q$, 'permission denied');
SELECT tests.verifier((SELECT count(*) = max(numero_recu) AND min(numero_recu) = 1 FROM app.encaissements),
                      'reçus numérotés de 1 à N sans trou, malgré les paiements refusés et les transactions annulées');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe)
  VALUES ('30000000-0000-4000-8000-000000000005', 60000, 'mobile_money', 'MM-TROP')$q$, 'reste à payer : 52000');
INSERT INTO app.encaissements (id, contrat_id, montant, mode, reference_externe, numero_recu)
VALUES ('40000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000005', 20000, 'mobile_money', 'MM-0101', 999999);
SELECT tests.verifier((SELECT numero_recu FROM app.encaissements WHERE id = '40000000-0000-4000-8000-000000000010')
                      = (SELECT max(numero_recu) FROM app.encaissements WHERE id <> '40000000-0000-4000-8000-000000000010') + 1,
                      'le numéro suit le précédent : celui fourni par l''application est ignoré, le paiement refusé n''en a pas consommé');
SELECT tests.verifier((SELECT statut FROM app.contrats WHERE id = '30000000-0000-4000-8000-000000000005') = 'en_attente_paiement',
                      'paiement partiel : le contrat attend le solde');
INSERT INTO app.encaissements (id, contrat_id, montant, mode)
VALUES ('40000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000005', 32000, 'especes');
SELECT tests.verifier((SELECT statut FROM app.contrats WHERE id = '30000000-0000-4000-8000-000000000005') = 'en_vigueur',
                      'prime soldée : le contrat entre en vigueur sans autre action (Code CIMA, art. 13)');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
INSERT INTO app.encaissements (contrat_id, montant, mode, annule_encaissement_id, motif)
VALUES ('30000000-0000-4000-8000-000000000005', -32000, 'especes', '40000000-0000-4000-8000-000000000011',
        'Billet contrefait détecté');
SELECT tests.verifier((SELECT statut FROM app.contrats WHERE id = '30000000-0000-4000-8000-000000000005') = 'en_attente_paiement',
                      'une contre-passation qui rend la prime incomplète remet le contrat en attente de paiement');
SELECT tests.verifier((SELECT caissier_id FROM app.v_mouvements_caisse WHERE montant = -32000)
                      = '10000000-0000-4000-8000-000000000003',
                      'la contre-passation compte dans la caisse de la personne qui avait encaissé, pas dans celle du gérant');
ROLLBACK;

\echo
\echo '19. Clôture de caisse : la base calcule, la personne compte, un gérant vise'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.doit_echouer($q$INSERT INTO app.clotures_caisse (especes_comptees) VALUES (0)$q$, 'clotures_ecart_justifie');
SELECT tests.doit_echouer($q$INSERT INTO app.clotures_caisse (especes_comptees, billetage) VALUES (5000, '{"10000": 1}')$q$,
                          'billetage .* ne correspond pas');
SELECT tests.doit_echouer($q$INSERT INTO app.clotures_caisse (especes_comptees, billetage) VALUES (3000, '{"3000": 1}')$q$,
                          'Billetage invalide');
SELECT tests.doit_echouer($q$INSERT INTO app.clotures_caisse (especes_comptees, billetage) VALUES (500, '{"500": 0.5}')$q$,
                          'Billetage invalide');
-- Espèces comptées égales aux espèces attendues, billets de 10 000 et le reste en pièces de 1 F
INSERT INTO app.clotures_caisse (id, especes_comptees, especes_attendues, billetage)
SELECT '70000000-0000-4000-8000-000000000001', t.especes, 0, jsonb_build_object('10000', t.especes / 10000, '1', t.especes % 10000)
FROM (SELECT sum(montant)::bigint AS especes FROM app.v_mouvements_caisse
      WHERE caissier_id = '10000000-0000-4000-8000-000000000003' AND mode = 'especes') t;
SELECT tests.verifier((SELECT c.ecart = 0 AND c.debut IS NULL AND c.caissier_id = '10000000-0000-4000-8000-000000000003'
                              AND c.nombre_encaissements = (SELECT count(*) FROM app.v_mouvements_caisse
                                                            WHERE caissier_id = '10000000-0000-4000-8000-000000000003')
                              AND c.total_mobile_money = 520000
                       FROM app.clotures_caisse c WHERE c.id = '70000000-0000-4000-8000-000000000001'),
                      'la base calcule elle-même les espèces attendues (valeur fournie ignorée), les totaux par mode et le nombre de reçus');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, encaisse_le)
  VALUES ('30000000-0000-4000-8000-000000000002', 1000, 'especes', now() - interval '1 hour')$q$, 'Caisse clôturée');
INSERT INTO app.encaissements (id, contrat_id, montant, mode)
VALUES ('40000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000002', 5000, 'especes');
SELECT tests.verifier(true, 'après la clôture, les nouveaux encaissements ouvrent la période suivante');
SELECT tests.doit_echouer($q$UPDATE app.clotures_caisse SET especes_comptees = 0$q$, 'permission denied');
DO $$
DECLARE n integer;
BEGIN
  UPDATE app.clotures_caisse SET visee_le = now() WHERE id = '70000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM tests.verifier(n = 0, 'la personne qui clôture ne vise pas sa propre clôture');
END
$$;
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.clotures_caisse (id, especes_comptees, commentaire)
VALUES ('70000000-0000-4000-8000-000000000002', 4000, 'Manque 1 000 F : monnaie rendue en trop');
SELECT tests.verifier((SELECT c.debut = p.fin AND c.especes_attendues = 5000 AND c.ecart = -1000 AND c.nombre_encaissements = 1
                       FROM app.clotures_caisse c, app.clotures_caisse p
                       WHERE c.id = '70000000-0000-4000-8000-000000000002' AND p.id = '70000000-0000-4000-8000-000000000001'),
                      'la clôture suivante commence où la précédente s''arrête ; un écart justifié est accepté');
SELECT tests.verifier((SELECT numero FROM app.clotures_caisse WHERE id = '70000000-0000-4000-8000-000000000002')
                      = (SELECT numero FROM app.clotures_caisse WHERE id = '70000000-0000-4000-8000-000000000001') + 1,
                      'clôtures numérotées sans trou');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
SELECT tests.doit_echouer($q$UPDATE app.clotures_caisse SET visee_par = '10000000-0000-4000-8000-000000000002'
  WHERE id = '70000000-0000-4000-8000-000000000002'$q$, 'permission denied');
UPDATE app.clotures_caisse SET visee_le = '2000-01-01' WHERE id = '70000000-0000-4000-8000-000000000002';
SELECT tests.verifier((SELECT visee_par = '10000000-0000-4000-8000-000000000001' AND visee_le > now() - interval '1 minute'
                       FROM app.clotures_caisse WHERE id = '70000000-0000-4000-8000-000000000002'),
                      'le visa est attribué au gérant connecté, à l''heure du serveur');
SELECT tests.doit_echouer($q$UPDATE app.clotures_caisse SET visee_le = now()
  WHERE id = '70000000-0000-4000-8000-000000000002'$q$, 'déjà visée');
INSERT INTO app.clotures_caisse (id, especes_comptees) VALUES ('70000000-0000-4000-8000-000000000003', 0);
SELECT tests.verifier((SELECT especes_attendues = 0 FROM app.clotures_caisse WHERE id = '70000000-0000-4000-8000-000000000003'),
                      'la contre-passation de test 5 n''apparaît pas dans la caisse du gérant');
SELECT tests.doit_echouer($q$UPDATE app.clotures_caisse SET visee_le = now()
  WHERE id = '70000000-0000-4000-8000-000000000003'$q$, 'clotures_quatre_yeux');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.verifier((SELECT count(*) FROM app.clotures_caisse) = 2, 'le caissier ne voit que ses propres clôtures');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000008', true);  -- auditeur
SELECT tests.verifier((SELECT count(*) FROM app.clotures_caisse) = 3, 'l''auditeur voit toutes les clôtures');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.verifier((SELECT count(*) FROM app.clotures_caisse) = 0, 'le commercial ne voit pas la caisse');
SELECT tests.doit_echouer($q$INSERT INTO app.clotures_caisse (especes_comptees) VALUES (0)$q$, 'row-level security');
ROLLBACK;

\echo
\echo '20. Bordereaux : numérotés par la base, annulables seulement avant validation'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.reversements (id, numero_bordereau, periode_debut, periode_fin)
VALUES ('50000000-0000-4000-8000-000000000010', 'MON-NUMERO', current_date - 30, current_date);
SELECT tests.verifier((SELECT numero_bordereau ~ '^BR-[0-9]{4}-[0-9]{4}$' FROM app.reversements
                       WHERE id = '50000000-0000-4000-8000-000000000010'),
                      'numéro de bordereau attribué par la base (BR-année-numéro), celui de l''application est ignoré');
UPDATE app.encaissements SET reversement_id = '50000000-0000-4000-8000-000000000010' WHERE reversement_id IS NULL;
SELECT tests.doit_echouer($q$UPDATE app.reversements SET annule_le = now() WHERE id = '50000000-0000-4000-8000-000000000010'$q$,
                          'permission denied');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.doit_echouer($q$SELECT app.annuler_bordereau('50000000-0000-4000-8000-000000000010', 'Erreur de période')$q$,
                          'Seul un gérant');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.doit_echouer($q$SELECT app.annuler_bordereau('50000000-0000-4000-8000-000000000010', 'non')$q$,
                          'reversements_annulation_complete');
SELECT app.annuler_bordereau('50000000-0000-4000-8000-000000000010', 'Période erronée, à refaire');
SELECT tests.verifier((SELECT annule_par = '10000000-0000-4000-8000-000000000003' AND annule_le IS NOT NULL
                       FROM app.reversements WHERE id = '50000000-0000-4000-8000-000000000010'),
                      'la personne qui a préparé le bordereau l''annule avant validation');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.encaissements WHERE reversement_id = '50000000-0000-4000-8000-000000000010'),
                      'ses encaissements redeviennent à reverser');
SELECT tests.doit_echouer($q$UPDATE app.encaissements SET reversement_id = '50000000-0000-4000-8000-000000000010'
  WHERE id = '40000000-0000-4000-8000-000000000012'$q$, 'Bordereau annulé');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
SELECT tests.doit_echouer($q$UPDATE app.reversements SET valide_le = now() WHERE id = '50000000-0000-4000-8000-000000000010'$q$,
                          'Bordereau annulé');
SELECT tests.doit_echouer($q$SELECT app.annuler_bordereau('50000000-0000-4000-8000-000000000001', 'Tentative tardive')$q$,
                          'déjà validé');
INSERT INTO app.reversements (id, numero_bordereau, periode_debut, periode_fin)
VALUES ('50000000-0000-4000-8000-000000000011', 'X', current_date, current_date);
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.doit_echouer($q$SELECT app.annuler_bordereau('50000000-0000-4000-8000-000000000011', 'Pas le mien')$q$,
                          'Seul un gérant');
ROLLBACK;

\echo
\echo '21. Commissions : taux datés, prime nette, rapprochement avec le relevé de la compagnie'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
INSERT INTO app.taux_commission (branche, taux, applicable_du) VALUES ('automobile', 12.5, '2000-01-01');
SELECT tests.doit_echouer($q$INSERT INTO app.taux_commission (branche, taux, applicable_du) VALUES ('habitation', 60, '2000-01-01')$q$,
                          'taux_commission_bornes');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
SELECT tests.doit_echouer($q$INSERT INTO app.taux_commission (branche, taux, applicable_du) VALUES ('habitation', 15, '2000-01-01')$q$,
                          'row-level security');
UPDATE app.contrats SET prime_nette = 40000 WHERE id = '30000000-0000-4000-8000-000000000005';
SELECT tests.doit_echouer($q$UPDATE app.contrats SET prime_nette = 60000 WHERE id = '30000000-0000-4000-8000-000000000005'$q$,
                          'contrats_prime_nette');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
-- Contrat 30…05 : 20 000 + 32 000 F CFA encaissés, prime nette 40 000 sur 52 000, taux 12,50 %
--   20 000 × 40 000 / 52 000 × 12,5 % = 1 923,07 → 1 923 ; 32 000 × … = 3 076,92 → 3 076 ; total 4 999
SELECT tests.verifier((SELECT commission_attendue = 4999 AND encaissements_incomplets > 0
                       FROM app.v_commissions_mensuelles WHERE mois = date_trunc('month', current_date)::date),
                      'commission attendue calculée sur la prime nette, encaissements sans prime nette signalés');
INSERT INTO app.releves_commissions (mois, montant_declare, reference)
VALUES (date_trunc('month', current_date)::date, 5200, 'REL-TEST');
SELECT tests.verifier((SELECT ecart = 201 FROM app.v_commissions_mensuelles WHERE mois = date_trunc('month', current_date)::date),
                      'écart entre le relevé de la compagnie et la commission attendue');
SELECT tests.doit_echouer($q$INSERT INTO app.releves_commissions (mois, montant_declare)
  VALUES (date_trunc('month', current_date)::date + 14, 100)$q$, 'releves_mois_premier_jour');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.verifier((SELECT count(*) FROM app.taux_commission) = 0 AND (SELECT count(*) FROM app.releves_commissions) = 0,
                      'la caisse ne voit pas les commissions');
DO $$
DECLARE n integer;
BEGIN
  UPDATE app.releves_commissions SET montant_declare = 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM tests.verifier(n = 0, 'la caisse ne modifie pas un relevé de commissions');
END
$$;
ROLLBACK;

\echo
\echo 'Tests de la caisse, des reversements et des commissions passés.'
