-- =====================================================================
-- Tests de la base : contrôle d'accès, règles métier, journal d'audit.
-- Lancés par database/tests/executer.sh sur une base neuve, avec un superutilisateur
-- (il endosse tour à tour le rôle de l'application et de chaque utilisateur).
-- Chaque vérification affiche « ok — … » ; la première qui échoue arrête tout.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE SCHEMA tests;
GRANT USAGE ON SCHEMA tests TO PUBLIC;

-- La requête doit être refusée avec un message contenant « motif »
CREATE FUNCTION tests.doit_echouer(requete text, motif text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE requete;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~* motif THEN
      RAISE EXCEPTION 'ÉCHEC : refus attendu (« % »), mais erreur différente : %', motif, SQLERRM;
    END IF;
    RAISE NOTICE 'ok — refusé : %', SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'ÉCHEC : cette requête aurait dû être refusée : %', requete;
END
$$;

CREATE FUNCTION tests.verifier(condition boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC : %', message;
  END IF;
  RAISE NOTICE 'ok — %', message;
END
$$;

-- Personnel de test (créé ici par le superutilisateur, comme le premier gérant à l'installation)
INSERT INTO app.utilisateurs (id, email, nom, role) VALUES
  ('10000000-0000-4000-8000-000000000001', 'gerant@test.ci',      'Gérant Test',      'gerant'),
  ('10000000-0000-4000-8000-000000000002', 'gerant2@test.ci',     'Second Gérant',    'gerant'),
  ('10000000-0000-4000-8000-000000000003', 'caisse@test.ci',      'Caissier Test',    'caissier'),
  ('10000000-0000-4000-8000-000000000004', 'charge@test.ci',      'Chargé Test',      'charge_clientele'),
  ('10000000-0000-4000-8000-000000000005', 'commercial@test.ci',  'Commercial Test',  'commercial'),
  ('10000000-0000-4000-8000-000000000006', 'apporteur@test.ci',   'Apporteur Test',   'apporteur'),
  ('10000000-0000-4000-8000-000000000007', 'apporteur2@test.ci',  'Apporteur Deux',   'apporteur'),
  ('10000000-0000-4000-8000-000000000008', 'auditeur@test.ci',    'Auditeur Test',    'auditeur');

\echo
\echo '1. Sans utilisateur authentifié, rien n''est accessible'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.doit_echouer($q$INSERT INTO app.clients (type, nom, telephone) VALUES ('particulier', 'Anonyme', '+2250700000000')$q$,
                          'Aucun utilisateur authentifié');
SELECT tests.doit_echouer('SELECT count(*) FROM audit.journal', 'permission denied');
ROLLBACK;

\echo
\echo '2. Clients et contrats : l''auteur est toujours l''utilisateur authentifié'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
-- Tentative d'écrire au nom du gérant : ignorée
INSERT INTO app.clients (id, type, nom, telephone, cree_par)
VALUES ('20000000-0000-4000-8000-000000000001', 'particulier', 'Client Un', '+2250700000001',
        '10000000-0000-4000-8000-000000000001');
SELECT tests.verifier((SELECT cree_par FROM app.clients WHERE id = '20000000-0000-4000-8000-000000000001')
                      = '10000000-0000-4000-8000-000000000004', 'l''auteur fourni par l''application est remplacé par l''utilisateur authentifié');
INSERT INTO app.clients (id, type, nom, telephone, apporteur_id)
VALUES ('20000000-0000-4000-8000-000000000002', 'entreprise', 'Transports Deux', '+2250700000002',
        '10000000-0000-4000-8000-000000000006');
SELECT tests.doit_echouer($q$INSERT INTO app.clients (type, nom, telephone) VALUES ('particulier', 'Mauvais Numéro', '0749360702')$q$,
                          'clients_telephone_format');
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc) VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'POL-001', 'automobile',
   current_date, current_date + 365, 1500000),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'POL-002', 'flotte',
   current_date, current_date + 20, 300000);
SELECT tests.doit_echouer($q$INSERT INTO app.contrats (client_id, branche, date_effet, date_echeance, prime_ttc, statut)
  VALUES ('20000000-0000-4000-8000-000000000001', 'habitation', current_date, current_date + 365, 50000, 'en_vigueur')$q$,
  'art. 13');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode)
  VALUES ('30000000-0000-4000-8000-000000000001', 1000, 'especes')$q$, 'row-level security');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.doit_echouer('SELECT count(*) FROM app.clients', 'Aucun utilisateur authentifié');
SELECT tests.verifier(true, 'une fois des clients enregistrés, leur lecture sans utilisateur authentifié échoue aussi');
ROLLBACK;

\echo
\echo '3. Caisse : plafond des espèces, références obligatoires, aucune modification'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (id, contrat_id, montant, mode)
VALUES ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 600000, 'especes');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode)
  VALUES ('30000000-0000-4000-8000-000000000001', 500000, 'especes')$q$, 'Plafond des espèces dépassé');
INSERT INTO app.encaissements (id, contrat_id, montant, mode)
VALUES ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 400000, 'especes');
SELECT tests.verifier(true, 'exactement 1 000 000 F CFA en espèces sur une police : accepté');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode)
  VALUES ('30000000-0000-4000-8000-000000000001', 1, 'especes')$q$, 'Plafond des espèces dépassé');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode)
  VALUES ('30000000-0000-4000-8000-000000000001', 500000, 'mobile_money')$q$, 'encaissements_reference');
INSERT INTO app.encaissements (id, contrat_id, montant, mode, reference_externe)
VALUES ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 500000, 'mobile_money', 'MP-0001');
-- Même transaction Mobile Money présentée une seconde fois, même sur un autre contrat : refusée
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe)
  VALUES ('30000000-0000-4000-8000-000000000002', 1000, 'mobile_money', 'MP-0001')$q$, 'encaissements_reference_unique');
SELECT tests.doit_echouer($q$UPDATE app.encaissements SET montant = 1 WHERE id = '40000000-0000-4000-8000-000000000001'$q$,
                          'permission denied');
SELECT tests.doit_echouer($q$DELETE FROM app.encaissements WHERE id = '40000000-0000-4000-8000-000000000001'$q$,
                          'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, annule_encaissement_id, motif)
  VALUES ('30000000-0000-4000-8000-000000000001', -600000, 'especes', '40000000-0000-4000-8000-000000000001', 'Erreur de saisie')$q$,
  'row-level security');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, encaisse_le)
  VALUES ('30000000-0000-4000-8000-000000000002', 1000, 'especes', now() + interval '1 day')$q$, 'futur');
SELECT tests.verifier((SELECT count(DISTINCT numero_recu) FROM app.encaissements) = 3, 'chaque encaissement a son numéro de reçu');
COMMIT;

\echo
\echo '4. Un contrat n''est en vigueur qu''une fois la prime entièrement payée (Code CIMA, art. 13)'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
UPDATE app.contrats SET statut = 'en_vigueur' WHERE id = '30000000-0000-4000-8000-000000000001';
SELECT tests.verifier((SELECT statut FROM app.contrats WHERE id = '30000000-0000-4000-8000-000000000001') = 'en_vigueur',
                      'prime payée (1 500 000 F CFA) : contrat mis en vigueur');
SELECT tests.doit_echouer($q$UPDATE app.contrats SET statut = 'en_vigueur' WHERE id = '30000000-0000-4000-8000-000000000002'$q$,
                          'art. 13');
SELECT tests.doit_echouer($q$UPDATE app.contrats SET prime_ttc = 2000000 WHERE id = '30000000-0000-4000-8000-000000000001'$q$,
                          'art. 13');
COMMIT;

\echo
\echo '5. Contre-passation : réservée au gérant, exacte et unique'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, annule_encaissement_id, motif)
  VALUES ('30000000-0000-4000-8000-000000000001', -500000, 'especes', '40000000-0000-4000-8000-000000000001', 'Montant partiel')$q$,
  'Contre-passation invalide');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, annule_encaissement_id)
  VALUES ('30000000-0000-4000-8000-000000000001', -600000, 'especes', '40000000-0000-4000-8000-000000000001')$q$,
  'encaissements_montant');
INSERT INTO app.encaissements (contrat_id, montant, mode, annule_encaissement_id, motif)
VALUES ('30000000-0000-4000-8000-000000000001', -600000, 'especes', '40000000-0000-4000-8000-000000000001',
        'Erreur de saisie du montant');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, annule_encaissement_id, motif)
  VALUES ('30000000-0000-4000-8000-000000000001', -600000, 'especes', '40000000-0000-4000-8000-000000000001', 'Deuxième fois')$q$,
  'encaissements_annulation_unique');
SELECT tests.verifier((SELECT total_encaisse FROM app.v_soldes_contrats WHERE contrat_id = '30000000-0000-4000-8000-000000000001') = 900000,
                      'le solde tient compte de la contre-passation');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (id, contrat_id, montant, mode)
VALUES ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', 600000, 'especes');
SELECT tests.verifier(true, 'après annulation, les espèces annulées ne comptent plus dans le plafond');
COMMIT;

\echo
\echo '6. Cloisonnement : chacun ne voit que ce que son rôle permet'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000006', true);  -- apporteur
SELECT tests.verifier((SELECT array_agg(nom) FROM app.clients) = ARRAY['Transports Deux'], 'l''apporteur ne voit que ses clients');
SELECT tests.verifier((SELECT count(*) FROM app.contrats) = 1, 'l''apporteur ne voit que les contrats de ses clients');
SELECT tests.verifier((SELECT count(*) FROM app.encaissements) = 0, 'l''apporteur ne voit pas la caisse');
SELECT tests.doit_echouer($q$INSERT INTO app.clients (type, nom, telephone, apporteur_id)
  VALUES ('particulier', 'Client Détourné', '+2250700000009', '10000000-0000-4000-8000-000000000007')$q$, 'row-level security');
INSERT INTO app.clients (type, nom, telephone, apporteur_id)
VALUES ('particulier', 'Prospect Apporté', '+2250700000003', '10000000-0000-4000-8000-000000000006');
SELECT tests.verifier(true, 'l''apporteur enregistre ses propres prospects');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.verifier((SELECT count(*) FROM app.clients) = 2, 'le commercial voit tous les clients');
SELECT tests.verifier((SELECT count(*) FROM app.encaissements) = 0, 'le commercial ne voit pas la caisse');
SELECT tests.verifier((SELECT count(*) FROM app.reversements) = 0, 'le commercial ne voit pas les reversements');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000008', true);  -- auditeur
SELECT tests.verifier((SELECT count(*) FROM app.encaissements) = 5, 'l''auditeur lit la caisse');
DO $$
DECLARE n integer;
BEGIN
  UPDATE app.clients SET nom = 'Modifié par l''auditeur';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM tests.verifier(n = 0, 'l''auditeur ne modifie rien');
END
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.doit_echouer($q$INSERT INTO app.utilisateurs (email, nom, role) VALUES ('pirate@test.ci', 'Faux Gérant', 'gerant')$q$,
                          'row-level security');
DO $$
DECLARE n integer;
BEGIN
  UPDATE app.utilisateurs SET role = 'gerant' WHERE id = '10000000-0000-4000-8000-000000000003';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM tests.verifier(n = 0, 'le caissier ne peut pas s''attribuer le rôle de gérant');
END
$$;
ROLLBACK;

\echo
\echo '7. Un utilisateur désactivé perd immédiatement l''accès'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
UPDATE app.utilisateurs SET actif = false WHERE id = '10000000-0000-4000-8000-000000000007';
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000007', true);  -- apporteur désactivé
SELECT tests.doit_echouer('SELECT count(*) FROM app.clients', 'désactivé');
ROLLBACK;

\echo
\echo '8. Reversement à la compagnie : préparé par l''un, validé par un autre'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.reversements (id, numero_bordereau, periode_debut, periode_fin)
VALUES ('50000000-0000-4000-8000-000000000001', 'BRD-2026-001', current_date - 30, current_date);
UPDATE app.encaissements SET reversement_id = '50000000-0000-4000-8000-000000000001'
WHERE contrat_id = '30000000-0000-4000-8000-000000000001';
DO $$
DECLARE n integer;
BEGIN
  UPDATE app.reversements SET valide_le = now() WHERE id = '50000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM tests.verifier(n = 0, 'le caissier ne valide pas son propre bordereau');
END
$$;
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
SELECT tests.doit_echouer($q$UPDATE app.reversements SET valide_par = '10000000-0000-4000-8000-000000000002'
  WHERE id = '50000000-0000-4000-8000-000000000001'$q$, 'permission denied');
UPDATE app.reversements SET valide_le = now() WHERE id = '50000000-0000-4000-8000-000000000001';
SELECT tests.verifier((SELECT valide_par FROM app.reversements WHERE id = '50000000-0000-4000-8000-000000000001')
                      = '10000000-0000-4000-8000-000000000001', 'la validation est attribuée à l''utilisateur authentifié');
SELECT tests.doit_echouer($q$UPDATE app.encaissements SET reversement_id = NULL
  WHERE id = '40000000-0000-4000-8000-000000000001'$q$, 'ne se modifie pas');
SELECT tests.doit_echouer($q$UPDATE app.reversements SET verse_le = current_date
  WHERE id = '50000000-0000-4000-8000-000000000001'$q$, 'reversements_reference_versement');
UPDATE app.reversements SET verse_le = current_date, reference_virement = 'VIR-2026-0001'
WHERE id = '50000000-0000-4000-8000-000000000001';
SELECT tests.doit_echouer($q$UPDATE app.reversements SET reference_virement = 'AUTRE'
  WHERE id = '50000000-0000-4000-8000-000000000001'$q$, 'déjà versé');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
INSERT INTO app.reversements (id, numero_bordereau, periode_debut, periode_fin)
VALUES ('50000000-0000-4000-8000-000000000002', 'BRD-2026-002', current_date, current_date);
SELECT tests.doit_echouer($q$UPDATE app.reversements SET valide_le = now()
  WHERE id = '50000000-0000-4000-8000-000000000002'$q$, 'Bordereau vide');
INSERT INTO app.encaissements (id, contrat_id, montant, mode, reference_externe)
VALUES ('40000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000002', 100000, 'cheque', 'CHQ-778899');
UPDATE app.encaissements SET reversement_id = '50000000-0000-4000-8000-000000000002'
WHERE id = '40000000-0000-4000-8000-000000000006';
SELECT tests.doit_echouer($q$UPDATE app.reversements SET valide_le = now()
  WHERE id = '50000000-0000-4000-8000-000000000002'$q$, 'reversements_quatre_yeux');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000002', true);  -- second gérant
UPDATE app.reversements SET valide_le = now() WHERE id = '50000000-0000-4000-8000-000000000002';
SELECT tests.verifier((SELECT valide_par FROM app.reversements WHERE id = '50000000-0000-4000-8000-000000000002')
                      = '10000000-0000-4000-8000-000000000002', 'un autre gérant valide le bordereau préparé par le premier');
ROLLBACK;

\echo
\echo '9. Échéances et délais'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (contrat_id, montant, mode, encaisse_le)
VALUES ('30000000-0000-4000-8000-000000000002', 100000, 'especes', now() - interval '29 days');
SELECT tests.verifier((SELECT jours_restants FROM app.v_encaissements_a_reverser
                       WHERE contrat_id = '30000000-0000-4000-8000-000000000002') = 1,
                      'encaissement d''il y a 29 jours : 1 jour pour le reverser');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.v_encaissements_a_reverser
                                  WHERE contrat_id = '30000000-0000-4000-8000-000000000001'),
                      'les encaissements versés à la compagnie sortent de la liste');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, encaisse_le)
  VALUES ('30000000-0000-4000-8000-000000000002', 1000, 'especes', now() - interval '31 days')$q$, 'saisie tardive');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.vehicules (client_id, immatriculation, genre, echeance_visite_technique)
VALUES ('20000000-0000-4000-8000-000000000002', '1234 AB 01', 'tracteur routier', current_date + 10);
SELECT tests.verifier((SELECT jours_restants FROM app.v_echeances_vehicules WHERE document = 'visite_technique') = 10,
                      'visite technique dans 10 jours : signalée');
SELECT tests.doit_echouer($q$INSERT INTO app.vehicules (client_id, immatriculation)
  VALUES ('20000000-0000-4000-8000-000000000002', '1234 AB 01')$q$, 'vehicules_immatriculation_unique');
INSERT INTO app.sinistres (contrat_id, survenu_le, nature, dommages_corporels)
VALUES ('30000000-0000-4000-8000-000000000001', current_date - 3, 'corporel', true);
SELECT tests.verifier((SELECT delai_declaration_jours FROM app.v_sinistres_suivi) = 3
                      AND (SELECT limite_offre_indicative FROM app.v_sinistres_suivi) = (current_date - 3 + interval '6 months')::date,
                      'sinistre corporel : délai de déclaration et limite indicative de l''offre calculés');
SELECT tests.doit_echouer($q$INSERT INTO app.sinistres (contrat_id, survenu_le, nature)
  VALUES ('30000000-0000-4000-8000-000000000001', current_date + 1, 'vol')$q$, 'futur');
COMMIT;

\echo
\echo '10. Journal d''audit'
SELECT tests.verifier((SELECT premiere_anomalie FROM audit.verifier_chaine()) IS NULL, 'chaîne d''empreintes intègre');
SELECT tests.verifier((SELECT count(*) FROM audit.journal) >= 20, 'chaque écriture est journalisée');
SELECT tests.verifier(EXISTS (SELECT 1 FROM audit.journal
                              WHERE table_nom = 'app.reversements' AND operation = 'UPDATE'
                                AND utilisateur_id = '10000000-0000-4000-8000-000000000001'),
                      'le journal indique qui a validé le bordereau');
SELECT tests.doit_echouer($q$UPDATE audit.journal SET apres = '{}'$q$, 'ajout seul');
SELECT tests.doit_echouer('DELETE FROM audit.journal', 'ajout seul');
SELECT tests.doit_echouer('TRUNCATE audit.journal', 'ajout seul');

BEGIN;
SET LOCAL ROLE dbs_audit;
SELECT tests.verifier((SELECT lignes_verifiees FROM audit.verifier_chaine()) >= 20, 'le rôle d''audit vérifie la chaîne');
SELECT tests.doit_echouer('SELECT count(*) FROM app.clients', 'permission denied');
ROLLBACK;

-- Un administrateur qui contourne la protection pour falsifier une ligne est démasqué
BEGIN;
ALTER TABLE audit.journal DISABLE TRIGGER journal_ajout_seul;
UPDATE audit.journal SET apres = jsonb_set(apres, '{montant}', '1')
WHERE id = (SELECT min(id) FROM audit.journal WHERE table_nom = 'app.encaissements');
SELECT tests.verifier((SELECT premiere_anomalie FROM audit.verifier_chaine()) IS NOT NULL,
                      'une ligne falsifiée est détectée par la vérification de la chaîne');
ROLLBACK;

\echo
\echo 'Tous les tests de la base sont passés.'
