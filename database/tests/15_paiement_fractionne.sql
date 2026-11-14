-- =====================================================================
-- Tests de la migration 0018 : prime d'un contrat flotte payée en plusieurs fois.
-- Réutilise le personnel et le client « Transports Deux » (20…02) des tests 01.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '60. Échéancier : réservé aux contrats flotte, défini d''un bloc, total égal à la prime'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc) VALUES
  ('31000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'FLT-001', 'flotte',
   current_date, current_date + 365, 1200000),
  ('31000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'AUTO-FR', 'automobile',
   current_date, current_date + 365, 90000);
SELECT tests.doit_echouer($q$SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000002',
  jsonb_build_array(jsonb_build_object('exigible_le', current_date, 'montant', 45000),
                    jsonb_build_object('exigible_le', current_date + 180, 'montant', 45000)))$q$, 'réservé aux contrats flotte');
SELECT tests.doit_echouer($q$SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('exigible_le', current_date, 'montant', 1200000)))$q$, 'de 2 à 12 échéances');
SELECT tests.doit_echouer($q$SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('exigible_le', current_date, 'montant', 600000),
                    jsonb_build_object('exigible_le', current_date + 180, 'montant', 500000)))$q$, 'doit être égal à la prime');
SELECT tests.doit_echouer($q$SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('exigible_le', current_date, 'montant', 600000),
                    jsonb_build_object('exigible_le', current_date, 'montant', 600000)))$q$, 'se suivent dans le temps');
SELECT tests.doit_echouer($q$SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('exigible_le', current_date + 10, 'montant', 600000),
                    jsonb_build_object('exigible_le', current_date + 180, 'montant', 600000)))$q$, 'au plus tard à la date d''effet');
SELECT tests.doit_echouer($q$SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('exigible_le', current_date, 'montant', 600000),
                    jsonb_build_object('exigible_le', current_date + 400, 'montant', 600000)))$q$, 'après la fin du contrat');
SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000001', jsonb_build_array(
  jsonb_build_object('exigible_le', current_date, 'montant', 300000),
  jsonb_build_object('exigible_le', current_date + 90, 'montant', 300000),
  jsonb_build_object('exigible_le', current_date + 180, 'montant', 300000),
  jsonb_build_object('exigible_le', current_date + 270, 'montant', 300000)));
SELECT tests.verifier(app.montant_requis_vigueur('31000000-0000-4000-8000-000000000001') = 300000,
                      'avec quatre échéances, la prise d''effet demande la première (300 000 F CFA), pas toute la prime');
SELECT tests.verifier(app.montant_requis_vigueur('31000000-0000-4000-8000-000000000002') = 90000,
                      'sans échéancier, rien ne change : toute la prime');
SELECT tests.verifier((SELECT cree_par FROM app.echeances_paiement WHERE contrat_id = '31000000-0000-4000-8000-000000000001' AND rang = 1)
                      = '10000000-0000-4000-8000-000000000004', 'l''échéancier porte le nom de la personne qui l''a défini');
SELECT tests.doit_echouer($q$INSERT INTO app.echeances_paiement (contrat_id, rang, exigible_le, montant)
  VALUES ('31000000-0000-4000-8000-000000000001', 5, current_date + 300, 1)$q$, 'permission denied');
SELECT tests.doit_echouer($q$UPDATE app.contrats SET prime_ttc = 1300000 WHERE id = '31000000-0000-4000-8000-000000000001'$q$,
                          'redéfinissant son échéancier');
SELECT tests.doit_echouer($q$UPDATE app.contrats SET statut = 'en_vigueur' WHERE id = '31000000-0000-4000-8000-000000000001'$q$,
                          'art. 13');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.doit_echouer($q$SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000001', '[]'::jsonb)$q$,
                          'Seuls le gérant et le chargé');
COMMIT;

\echo
\echo '61. Mise en vigueur à la première échéance payée, suivi des échéances, renégociation par le gérant'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (contrat_id, montant, mode)
VALUES ('31000000-0000-4000-8000-000000000001', 300000, 'especes');
SELECT tests.verifier((SELECT statut FROM app.contrats WHERE id = '31000000-0000-4000-8000-000000000001') = 'en_vigueur',
                      'première échéance payée : le contrat entre en vigueur (Code CIMA, art. 13)');
INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe)
VALUES ('31000000-0000-4000-8000-000000000001', 100000, 'mobile_money', 'MM-FRACT-1');
SELECT tests.verifier((SELECT array_agg(etat || ':' || paye ORDER BY rang) FROM app.v_echeances_paiement
                       WHERE contrat_id = '31000000-0000-4000-8000-000000000001')
                      = ARRAY['payee:300000', 'a_venir:100000', 'a_venir:0', 'a_venir:0'],
                      'les paiements soldent les échéances dans l''ordre ; un acompte s''impute sur la suivante');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
SELECT tests.doit_echouer($q$SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000001', jsonb_build_array(
  jsonb_build_object('exigible_le', current_date, 'montant', 600000),
  jsonb_build_object('exigible_le', current_date + 180, 'montant', 600000)))$q$, 'seul le gérant renégocie');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
SELECT tests.doit_echouer($q$SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000001', '[]'::jsonb)$q$,
                          'garde un échéancier');
SELECT tests.doit_echouer($q$SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000001', jsonb_build_array(
  jsonb_build_object('exigible_le', current_date, 'montant', 700000),
  jsonb_build_object('exigible_le', current_date + 180, 'montant', 500000)))$q$, 'ne peut pas dépasser ce qui est payé');
SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000001', jsonb_build_array(
  jsonb_build_object('exigible_le', current_date, 'montant', 300000),
  jsonb_build_object('exigible_le', current_date + 120, 'montant', 500000),
  jsonb_build_object('exigible_le', current_date + 240, 'montant', 500000)), 1300000);
SELECT tests.verifier((SELECT prime_ttc = 1300000 AND statut = 'en_vigueur' FROM app.contrats
                       WHERE id = '31000000-0000-4000-8000-000000000001')
                      AND (SELECT count(*) FROM app.echeances_paiement WHERE contrat_id = '31000000-0000-4000-8000-000000000001') = 3,
                      'le gérant renégocie : nouvelle prime et nouvel échéancier ensemble, le contrat reste en vigueur');
COMMIT;

\echo
\echo '62. Échéance en retard : signalée et relancée, sans suspension automatique'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
VALUES ('31000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'FLT-002', 'flotte',
        current_date - 100, current_date + 265, 1200000);
SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000003', jsonb_build_array(
  jsonb_build_object('exigible_le', current_date - 100, 'montant', 400000),
  jsonb_build_object('exigible_le', current_date - 5, 'montant', 400000),
  jsonb_build_object('exigible_le', current_date + 5, 'montant', 400000)));
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (id, contrat_id, montant, mode, reference_externe)
VALUES ('41000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000003', 400000, 'cheque', 'CHQ-FRACT-1');
SELECT tests.verifier((SELECT array_agg(etat || ':' || jours ORDER BY rang) FROM app.v_echeances_paiement
                       WHERE contrat_id = '31000000-0000-4000-8000-000000000003')
                      = ARRAY['payee:-100', 'en_retard:-5', 'bientot:5'],
                      'échéance passée non payée : en retard ; échéance dans 5 jours : bientôt');
SELECT tests.verifier((SELECT statut FROM app.contrats WHERE id = '31000000-0000-4000-8000-000000000003') = 'en_vigueur',
                      'un retard ne suspend pas le contrat de lui-même : la suspension suit une mise en demeure');
COMMIT;

SELECT tests.verifier((SELECT array_agg(parametres ->> 'etape' ORDER BY parametres ->> 'etape') FROM app.v_relances_dues
                       WHERE type = 'echeance_paiement' AND contrat_id = '31000000-0000-4000-8000-000000000003')
                      = ARRAY['j7', 'retard'], 'relances prévues : l''échéance dans 5 jours, et celle en retard');
SELECT tests.verifier((SELECT (parametres ->> 'montant')::bigint = 400000 AND parametres ->> 'nom' = 'Transports Deux'
                       FROM app.v_relances_dues
                       WHERE type = 'echeance_paiement' AND contrat_id = '31000000-0000-4000-8000-000000000003'
                         AND parametres ->> 'etape' = 'retard'),
                      'le message annonce le montant restant de l''échéance et le nom du client');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
INSERT INTO app.encaissements (contrat_id, montant, mode, annule_encaissement_id, motif)
VALUES ('31000000-0000-4000-8000-000000000003', -400000, 'cheque', '41000000-0000-4000-8000-000000000001', 'Chèque impayé');
SELECT tests.verifier((SELECT statut FROM app.contrats WHERE id = '31000000-0000-4000-8000-000000000003') = 'en_attente_paiement',
                      'chèque impayé de la première échéance : le contrat revient en attente de paiement');
ROLLBACK;

\echo
\echo '63. Retour au paiement en une fois, tant que rien n''est encaissé'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.contrats (id, client_id, branche, date_effet, date_echeance, prime_ttc)
VALUES ('31000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 'flotte',
        current_date, current_date + 365, 500000);
SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000004', jsonb_build_array(
  jsonb_build_object('exigible_le', current_date, 'montant', 250000),
  jsonb_build_object('exigible_le', current_date + 180, 'montant', 250000)));
SELECT app.definir_echeancier('31000000-0000-4000-8000-000000000004', '[]'::jsonb);
SELECT tests.verifier(app.montant_requis_vigueur('31000000-0000-4000-8000-000000000004') = 500000,
                      'échéancier retiré avant tout paiement : la prime entière redevient due à la prise d''effet');
ROLLBACK;

\echo
\echo 'Tests du paiement en plusieurs fois passés.'
