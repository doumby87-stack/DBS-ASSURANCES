-- =====================================================================
-- Tests de la migration 0004 : devis, échanges, renouvellement des contrats.
-- S'exécute après 01 et 02, dont il réutilise le personnel, les clients et les contrats.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '15. Devis : motif de refus obligatoire, et chacun selon son rôle'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.devis (id, client_id, branche, origine, description)
VALUES ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'habitation', 'whatsapp',
        'Villa 4 pièces à Cocody');
SELECT tests.doit_echouer($q$UPDATE app.devis SET statut = 'refuse' WHERE id = '60000000-0000-4000-8000-000000000001'$q$,
                          'devis_motif_refus');
UPDATE app.devis SET statut = 'refuse', motif_refus = 'Prime jugée trop élevée'
WHERE id = '60000000-0000-4000-8000-000000000001';
SELECT tests.verifier((SELECT modifie_le >= cree_le FROM app.devis WHERE id = '60000000-0000-4000-8000-000000000001'),
                      'la date de dernière modification suit les changements de statut');
SELECT tests.doit_echouer($q$INSERT INTO app.devis (client_id, branche, prime_proposee)
  VALUES ('20000000-0000-4000-8000-000000000001', 'automobile', 0)$q$, 'devis_prime_positive');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.verifier((SELECT count(*) FROM app.devis) = 0, 'le caissier ne voit pas les devis');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000006', true);  -- apporteur
INSERT INTO app.devis (client_id, branche, origine) VALUES ('20000000-0000-4000-8000-000000000002', 'flotte', 'apporteur');
SELECT tests.verifier(true, 'l''apporteur enregistre un devis pour son client');
SELECT tests.doit_echouer($q$INSERT INTO app.devis (client_id, branche) VALUES ('20000000-0000-4000-8000-000000000001', 'automobile')$q$,
                          'row-level security');
SELECT tests.verifier((SELECT count(*) FROM app.devis) = 1, 'l''apporteur ne voit que les devis de ses clients');
ROLLBACK;

\echo
\echo '16. Échanges : en ajout seul, jamais datés dans le futur'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.echanges (client_id, canal, resume)
VALUES ('20000000-0000-4000-8000-000000000001', 'visite', 'Passé à l''agence régler sa prime en espèces');
SELECT tests.verifier((SELECT cree_par FROM app.echanges LIMIT 1) = '10000000-0000-4000-8000-000000000003',
                      'l''échange porte le nom de la personne qui l''a noté');
SELECT tests.doit_echouer($q$UPDATE app.echanges SET resume = 'Modifié'$q$, 'permission denied');
SELECT tests.doit_echouer($q$DELETE FROM app.echanges$q$, 'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO app.echanges (client_id, canal, resume, survenu_le)
  VALUES ('20000000-0000-4000-8000-000000000001', 'appel', 'Appel de demain', now() + interval '1 day')$q$, 'futur');
SELECT tests.doit_echouer($q$INSERT INTO app.echanges (client_id, canal, resume)
  VALUES ('20000000-0000-4000-8000-000000000001', 'note', ' ')$q$, 'echanges_resume_longueur');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000008', true);  -- auditeur
SELECT tests.verifier((SELECT count(*) FROM app.echanges) = 1, 'l''auditeur lit l''historique');
SELECT tests.doit_echouer($q$INSERT INTO app.echanges (client_id, canal, resume)
  VALUES ('20000000-0000-4000-8000-000000000001', 'note', 'Note de l''auditeur')$q$, 'row-level security');
ROLLBACK;

\echo
\echo '17. Renouvellement : un contrat renouvelé sort du tableau des échéances'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
VALUES ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'POL-004', 'automobile',
        current_date - 340, current_date + 25, 50000);
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (contrat_id, montant, mode) VALUES ('30000000-0000-4000-8000-000000000004', 50000, 'especes');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
UPDATE app.contrats SET statut = 'en_vigueur' WHERE id = '30000000-0000-4000-8000-000000000004';
SELECT tests.verifier((SELECT jours_restants FROM app.v_echeances_contrats WHERE contrat_id = '30000000-0000-4000-8000-000000000004') = 25,
                      'contrat qui expire dans 25 jours : dans le tableau des échéances');

SELECT tests.doit_echouer($q$INSERT INTO app.contrats (client_id, branche, date_effet, date_echeance, prime_ttc, renouvelle_id)
  VALUES ('20000000-0000-4000-8000-000000000002', 'automobile', current_date + 25, current_date + 390, 50000,
          '30000000-0000-4000-8000-000000000004')$q$, 'Renouvellement invalide');
INSERT INTO app.contrats (id, client_id, branche, date_effet, date_echeance, prime_ttc, renouvelle_id)
VALUES ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 'automobile',
        current_date + 25, current_date + 390, 52000, '30000000-0000-4000-8000-000000000004');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.v_echeances_contrats WHERE contrat_id = '30000000-0000-4000-8000-000000000004'),
                      'une fois renouvelé, le contrat sort du tableau des échéances');
SELECT tests.doit_echouer($q$INSERT INTO app.contrats (client_id, branche, date_effet, date_echeance, prime_ttc, renouvelle_id)
  VALUES ('20000000-0000-4000-8000-000000000001', 'automobile', current_date + 25, current_date + 390, 52000,
          '30000000-0000-4000-8000-000000000004')$q$, 'contrats_renouvellement_unique');
SELECT tests.doit_echouer($q$UPDATE app.contrats SET renouvelle_id = NULL WHERE id = '30000000-0000-4000-8000-000000000005'$q$,
                          'permission denied');
COMMIT;

\echo
\echo 'Tests des devis, échanges et renouvellements passés.'
