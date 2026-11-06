-- =====================================================================
-- Tests de la migration 0014 : identification des clients (lutte contre le blanchiment), alertes, formations,
-- réclamations (délais en jours ouvrés, espace client), factures FNE.
-- S'exécute après 01 à 11.
--   · Diallo Fanta (+2250718000001), particulière ; Transports Epsilon (+2250718000002), entreprise ;
--     Bamba Koffi (+2250718000003), particulier pour les alertes.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '47. Identification des clients : fiche, justificatifs, vérification de l''original, état de la fiche'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.clients (id, type, nom, telephone, rccm) VALUES
  ('20000000-0000-4000-8000-000000001201', 'particulier', 'Diallo Fanta', '+2250718000001', NULL),
  ('20000000-0000-4000-8000-000000001202', 'entreprise', 'Transports Epsilon', '+2250718000002', 'CI-ABJ-2026-B-1202'),
  ('20000000-0000-4000-8000-000000001203', 'particulier', 'Bamba Koffi', '+2250718000003', NULL);
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc) VALUES
  ('30000000-0000-4000-8000-000000001201', '20000000-0000-4000-8000-000000001201', 'AUTO-1201', 'automobile',
   current_date - 5, current_date + 360, 90000);
SELECT tests.verifier((SELECT statut = 'absente' AND manques = ARRAY['Fiche d''identification'] FROM app.etat_identification('20000000-0000-4000-8000-000000001201')),
                      'sans fiche : état « absente »');
SELECT tests.verifier((SELECT count(*) = 1 FROM app.v_identifications_a_completer WHERE client_id = '20000000-0000-4000-8000-000000001201'),
                      'client avec un contrat en cours et sans fiche : à compléter');
SELECT tests.doit_echouer($q$INSERT INTO app.identifications_clients (client_id, verifiee_le) VALUES ('20000000-0000-4000-8000-000000001201', current_date)$q$,
  'permission denied');
INSERT INTO app.identifications_clients (client_id, type_piece, numero_piece_chiffre, numero_piece_fin, piece_expire_le,
                                         date_naissance, nationalite, activite, adresse)
VALUES ('20000000-0000-4000-8000-000000001201', 'cni', '\x0102030405', '4821', current_date + 700,
        DATE '1988-03-14', 'Ivoirienne', 'Commerçante', 'Cocody, Riviera 2');
SELECT tests.verifier((SELECT statut = 'incomplete' AND manques = ARRAY['Copie de la pièce d''identité', 'Original vu par l''agence']
                       FROM app.etat_identification('20000000-0000-4000-8000-000000001201')),
                      'fiche remplie, sans copie ni vérification : incomplète, avec ce qui manque');
INSERT INTO app.justificatifs_identification (id, client_id, nature, nom_fichier, type_contenu, taille, contenu_chiffre, empreinte, etat_analyse)
VALUES (gen_random_uuid(), '20000000-0000-4000-8000-000000001201', 'piece_identite', 'cni.pdf', 'application/pdf', 4, '\x01', '\x02', 'saine');
SELECT tests.verifier(app.verifier_identification('20000000-0000-4000-8000-000000001201') = (current_date + interval '2 years')::date,
                      'original vu : prochaine revue dans 2 ans (risque normal)');
SELECT tests.verifier((SELECT statut = 'complete' AND manques = '{}' FROM app.etat_identification('20000000-0000-4000-8000-000000001201')),
                      'fiche complète');
SELECT tests.verifier((SELECT verifiee_par = '10000000-0000-4000-8000-000000000004' AND verifiee_le = current_date
                       FROM app.identifications_clients WHERE client_id = '20000000-0000-4000-8000-000000001201'),
                      'vérification au nom de la personne connectée, datée du jour');
SELECT tests.doit_echouer($q$UPDATE app.identifications_clients SET verifiee_le = current_date - 400 WHERE client_id = '20000000-0000-4000-8000-000000001201'$q$,
  'permission denied');
UPDATE app.identifications_clients SET nationalite = 'Malienne' WHERE client_id = '20000000-0000-4000-8000-000000001201';
SELECT tests.verifier((SELECT statut = 'incomplete' AND manques = ARRAY['Original vu par l''agence']
                       FROM app.etat_identification('20000000-0000-4000-8000-000000001201')),
                      'identité modifiée : la vérification tombe, l''original doit être revu');
UPDATE app.identifications_clients SET activite = 'Commerçante en gros' WHERE client_id = '20000000-0000-4000-8000-000000001201';
SELECT app.verifier_identification('20000000-0000-4000-8000-000000001201');
UPDATE app.identifications_clients SET adresse = 'Cocody, Riviera 3' WHERE client_id = '20000000-0000-4000-8000-000000001201';
SELECT tests.verifier((SELECT statut = 'complete' FROM app.etat_identification('20000000-0000-4000-8000-000000001201')),
                      'une adresse modifiée ne fait pas tomber la vérification de la pièce');
SELECT tests.doit_echouer($q$UPDATE app.justificatifs_identification SET nom_fichier = 'autre.pdf'$q$, 'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO app.identifications_clients (client_id, niveau_risque) VALUES ('20000000-0000-4000-8000-000000001203', 'faible')$q$,
  'identifications_motif');
COMMIT;

-- Ce que voient les autres rôles : l'état de la fiche, jamais son contenu
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.verifier((SELECT statut = 'complete' FROM app.etat_identification('20000000-0000-4000-8000-000000001201')),
                      'le commercial voit que la fiche est complète');
SELECT tests.verifier((SELECT count(*) = 0 FROM app.identifications_clients), 'mais ne lit aucune fiche');
SELECT tests.verifier((SELECT count(*) = 0 FROM app.v_identifications_a_completer), 'ni la liste des fiches à compléter');
SELECT tests.doit_echouer($q$INSERT INTO app.identifications_clients (client_id) VALUES ('20000000-0000-4000-8000-000000001203')$q$,
  'row-level security');
ROLLBACK;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000006', true);  -- apporteur
SELECT tests.doit_echouer($q$SELECT * FROM app.etat_identification('20000000-0000-4000-8000-000000001201')$q$, 'Client introuvable');
ROLLBACK;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000008', true);  -- auditeur
SELECT tests.verifier((SELECT count(*) = 1 FROM app.identifications_clients WHERE client_id = '20000000-0000-4000-8000-000000001201'),
                      'l''auditeur lit la fiche (le numéro reste chiffré)');
SELECT tests.doit_echouer($q$SELECT app.verifier_identification('20000000-0000-4000-8000-000000001201')$q$, 'Seuls le gérant et le chargé');
ROLLBACK;

-- Revue périodique due
BEGIN;
SELECT set_config('app.verification_identite', 'oui', true);
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
UPDATE app.identifications_clients SET verifiee_le = current_date - 800 WHERE client_id = '20000000-0000-4000-8000-000000001201';
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.verifier((SELECT statut = 'a_revoir' AND manques = ARRAY['Revue périodique due'] FROM app.etat_identification('20000000-0000-4000-8000-000000001201')),
                      'vérifiée il y a plus de 2 ans : à revoir');
SELECT app.verifier_identification('20000000-0000-4000-8000-000000001201');
COMMIT;

\echo
\echo '48. Entreprise : dirigeants, bénéficiaires effectifs, risque élevé et souscription'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
INSERT INTO app.identifications_clients (client_id, forme_juridique, numero_contribuable, adresse)
VALUES ('20000000-0000-4000-8000-000000001202', 'SARL', '1902345A', 'Zone 4, Marcory');
SELECT tests.verifier((SELECT manques = ARRAY['Dirigeant', 'Bénéficiaire effectif', 'Copie du RCCM', 'Original vu par l''agence']
                       FROM app.etat_identification('20000000-0000-4000-8000-000000001202')),
                      'entreprise : dirigeant, bénéficiaire effectif et copie du RCCM exigés');
INSERT INTO app.dirigeants_beneficiaires (client_id, nom, est_dirigeant, est_beneficiaire_effectif, part_capital)
VALUES ('20000000-0000-4000-8000-000000001202', 'Kouamé Epsilon', true, true, 60) RETURNING id AS dirigeant \gset
INSERT INTO app.justificatifs_identification (id, client_id, nature, nom_fichier, type_contenu, taille, contenu_chiffre, empreinte, etat_analyse)
VALUES (gen_random_uuid(), '20000000-0000-4000-8000-000000001202', 'rccm', 'rccm.pdf', 'application/pdf', 4, '\x01', '\x02', 'saine');
SELECT app.verifier_identification('20000000-0000-4000-8000-000000001202');
SELECT tests.verifier((SELECT statut = 'complete' FROM app.etat_identification('20000000-0000-4000-8000-000000001202')), 'entreprise identifiée');

-- Un bénéficiaire politiquement exposé : la fiche doit passer en risque élevé, et les souscriptions s'arrêtent
INSERT INTO app.dirigeants_beneficiaires (client_id, nom, est_beneficiaire_effectif, part_capital, personne_politiquement_exposee)
VALUES ('20000000-0000-4000-8000-000000001202', 'Député Associé', true, 30, true);
SELECT tests.verifier((SELECT statut = 'incomplete' AND 'Risque élevé (personne politiquement exposée parmi les dirigeants ou bénéficiaires)' = ANY (manques)
                       FROM app.etat_identification('20000000-0000-4000-8000-000000001202')),
                      'personne politiquement exposée parmi les bénéficiaires : risque élevé exigé');
SELECT tests.doit_echouer($q$INSERT INTO app.contrats (client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
  VALUES ('20000000-0000-4000-8000-000000001202', 'FLT-1202', 'flotte', current_date, current_date + 365, 500000)$q$,
  'risque élevé');
UPDATE app.identifications_clients SET niveau_risque = 'eleve', motif_risque = 'Associé député'
WHERE client_id = '20000000-0000-4000-8000-000000001202';
SELECT tests.verifier((SELECT manques = ARRAY['Origine des fonds (risque élevé)'] FROM app.etat_identification('20000000-0000-4000-8000-000000001202')),
                      'risque élevé : origine des fonds exigée');
UPDATE app.identifications_clients SET origine_fonds = 'Chiffre d''affaires du transport de marchandises'
WHERE client_id = '20000000-0000-4000-8000-000000001202';
SELECT tests.verifier((SELECT prochaine_revue = (verifiee_le + interval '1 year')::date FROM app.identifications_clients
                       WHERE client_id = '20000000-0000-4000-8000-000000001202'),
                      'risque élevé : revue chaque année');
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
VALUES ('30000000-0000-4000-8000-000000001202', '20000000-0000-4000-8000-000000001202', 'FLT-1202', 'flotte', current_date, current_date + 365, 500000);
SELECT tests.verifier(true, 'fiche complète et à jour : la souscription passe');

-- Une personne se retire une fois ; elle ne se modifie pas
UPDATE app.dirigeants_beneficiaires SET retire_le = now() WHERE id = :'dirigeant';
SELECT tests.verifier((SELECT retire_par = '10000000-0000-4000-8000-000000000004' FROM app.dirigeants_beneficiaires
                       WHERE id = :'dirigeant'), 'retrait signé par la base');
SELECT tests.doit_echouer($q$UPDATE app.dirigeants_beneficiaires SET nom = 'Autre nom' WHERE client_id = '20000000-0000-4000-8000-000000001202' AND retire_le IS NULL$q$,
  'permission denied');
SELECT tests.doit_echouer($q$UPDATE app.dirigeants_beneficiaires SET retire_le = now() WHERE client_id = '20000000-0000-4000-8000-000000001202' AND retire_le IS NOT NULL$q$,
  'ne se modifie pas');
SELECT tests.verifier((SELECT manques = ARRAY['Dirigeant'] FROM app.etat_identification('20000000-0000-4000-8000-000000001202')),
                      'dirigeant retiré : il en faut un autre');

-- Particulier politiquement exposé : risque élevé d'office
INSERT INTO app.identifications_clients (client_id, personne_politiquement_exposee)
VALUES ('20000000-0000-4000-8000-000000001203', true);
SELECT tests.verifier((SELECT niveau_risque = 'eleve' AND motif_risque = 'Personne politiquement exposée'
                       FROM app.identifications_clients WHERE client_id = '20000000-0000-4000-8000-000000001203'),
                      'personne politiquement exposée : risque élevé d''office');
SELECT tests.doit_echouer($q$INSERT INTO app.contrats (client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
  VALUES ('20000000-0000-4000-8000-000000001203', 'AUTO-1203', 'automobile', current_date, current_date + 365, 2000000)$q$,
  'risque élevé');
UPDATE app.identifications_clients SET personne_politiquement_exposee = false, niveau_risque = 'normal', motif_risque = NULL
WHERE client_id = '20000000-0000-4000-8000-000000001203';
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc)
VALUES ('30000000-0000-4000-8000-000000001203', '20000000-0000-4000-8000-000000001203', 'AUTO-1203', 'automobile',
        current_date - 20, current_date + 345, 2000000);
SELECT tests.verifier(true, 'risque normal : la souscription passe, la fiche incomplète est signalée');
COMMIT;

\echo
\echo '49. Alertes : espèces proches du plafond, paiement par un tiers, fractionnement, résiliation rapide'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (contrat_id, montant, mode) VALUES
  ('30000000-0000-4000-8000-000000001203', 300000, 'especes'),
  ('30000000-0000-4000-8000-000000001203', 300000, 'especes'),
  ('30000000-0000-4000-8000-000000001203', 250000, 'especes');
INSERT INTO app.encaissements (id, contrat_id, montant, mode, reference_externe, payeur_tiers)
VALUES ('50000000-0000-4000-8000-000000001201', '30000000-0000-4000-8000-000000001203', 100000, 'virement', 'VIR-1203', 'Société Tierce SARL');
SELECT tests.doit_echouer($q$INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe, payeur_tiers)
  VALUES ('30000000-0000-4000-8000-000000001203', 1000, 'virement', 'VIR-1203-B', 'X')$q$, 'encaissements_payeur_tiers');
SELECT tests.verifier((SELECT count(*) = 0 FROM app.v_alertes), 'le caissier ne voit aucune alerte');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé
SELECT tests.verifier((SELECT count(*) = 0 FROM app.v_alertes), 'le chargé de clientèle non plus');
UPDATE app.contrats SET statut = 'resilie' WHERE id = '30000000-0000-4000-8000-000000001203';
SELECT tests.verifier((SELECT resilie_le = current_date FROM app.contrats WHERE id = '30000000-0000-4000-8000-000000001203'),
                      'date de résiliation tenue par la base');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
SELECT tests.verifier((SELECT array_agg(type ORDER BY type) FROM app.v_alertes WHERE contrat_id = '30000000-0000-4000-8000-000000001203')
                        = ARRAY['especes_plafond', 'fractionnement', 'paiement_tiers', 'resiliation_rapide'],
                      'le gérant voit les quatre alertes du contrat');
SELECT tests.verifier((SELECT detail = '850000 F CFA payés en espèces sur ce contrat (plafond : 1 000 000 F CFA)'
                       FROM app.v_alertes WHERE cle = 'especes_plafond:30000000-0000-4000-8000-000000001203'),
                      'le détail dit pourquoi');
INSERT INTO app.traitements_alertes (cle, decision, motif)
VALUES ('especes_plafond:30000000-0000-4000-8000-000000001203', 'sans_suite', 'Commerçant connu, recettes en espèces habituelles');
SELECT tests.verifier((SELECT decision = 'sans_suite' AND traite_par = '10000000-0000-4000-8000-000000000001'
                       FROM app.v_alertes WHERE cle = 'especes_plafond:30000000-0000-4000-8000-000000001203'),
                      'décision du gérant, signée par la base');
SELECT tests.doit_echouer($q$INSERT INTO app.traitements_alertes (cle, decision, motif)
  VALUES ('especes_plafond:30000000-0000-4000-8000-000000001203', 'transmise_correspondant', 'Revirement')$q$, 'duplicate key');
SELECT tests.doit_echouer($q$UPDATE app.traitements_alertes SET motif = 'Réécrit après coup'$q$, 'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO app.traitements_alertes (cle, decision, motif) VALUES ('inventee:1', 'sans_suite', 'Clé inventée')$q$,
  'traitements_cle');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000008', true);  -- auditeur
SELECT tests.verifier((SELECT count(*) = 0 FROM app.traitements_alertes), 'les décisions restent au gérant');
ROLLBACK;

\echo
\echo '50. Formations du personnel'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
INSERT INTO app.formations_personnel (utilisateur_id, theme, suivie_le, commentaire)
VALUES ('10000000-0000-4000-8000-000000000003', 'lbc_ft', current_date - 10, 'Rappel annuel, support de SanlamAllianz');
SELECT tests.doit_echouer($q$INSERT INTO app.formations_personnel (utilisateur_id, theme, suivie_le)
  VALUES ('10000000-0000-4000-8000-000000000003', 'hameconnage', current_date + 3)$q$, 'une fois suivie');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.verifier((SELECT NOT a_refaire FROM app.v_formations_a_jour
                       WHERE utilisateur_id = '10000000-0000-4000-8000-000000000003' AND theme = 'lbc_ft'),
                      'formation LBC/FT suivie il y a 10 jours : à jour');
SELECT tests.verifier((SELECT a_refaire FROM app.v_formations_a_jour
                       WHERE utilisateur_id = '10000000-0000-4000-8000-000000000003' AND theme = 'hameconnage'),
                      'jamais suivie : à faire');
SELECT tests.doit_echouer($q$INSERT INTO app.formations_personnel (utilisateur_id, theme, suivie_le)
  VALUES ('10000000-0000-4000-8000-000000000003', 'hameconnage', current_date)$q$, 'row-level security');
ROLLBACK;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.verifier((SELECT count(*) = 0 FROM app.formations_personnel), 'chacun ne lit que ses formations');
ROLLBACK;

\echo
\echo '51. Réclamations : registre, délais en jours ouvrés, traitement étape par étape'
SELECT tests.verifier(app.ajouter_jours_ouvres(DATE '2026-11-06', 2) = DATE '2026-11-10', 'vendredi + 2 jours ouvrés = mardi');
SELECT tests.verifier(app.ajouter_jours_ouvres(DATE '2026-12-24', 1) = DATE '2026-12-28', 'Noël n''est pas un jour ouvré');
SELECT tests.verifier(app.ajouter_jours_ouvres(DATE '2026-08-06', 1) = DATE '2026-08-10', 'ni la fête de l''Indépendance (7 août)');
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier, au guichet
INSERT INTO app.reclamations (id, client_id, canal, objet, description, contrat_id)
VALUES ('70000000-0000-4000-8000-000000001201', '20000000-0000-4000-8000-000000001201', 'guichet', 'attestation',
        'Attestation toujours pas reçue alors que la prime est payée.', '30000000-0000-4000-8000-000000001201');
SELECT tests.verifier((SELECT reference ~ ('^REC-' || to_char(app.aujourdhui(), 'YYYY') || '-[0-9]{4}$') AND nom = 'Diallo Fanta'
                         AND telephone = '+2250718000001' AND statut = 'recue' AND cree_par = '10000000-0000-4000-8000-000000000003'
                         AND echeance_accuse = app.ajouter_jours_ouvres(app.aujourdhui(), 2)
                         AND echeance_reponse = app.ajouter_jours_ouvres(app.aujourdhui(), 10)
                       FROM app.reclamations WHERE id = '70000000-0000-4000-8000-000000001201'),
                      'numéro, nom, téléphone, état et échéances fixés par la base');
SELECT tests.doit_echouer($q$INSERT INTO app.reclamations (nom, canal, objet, description, statut)
  VALUES ('Passant', 'guichet', 'autre', 'Une réclamation déjà close ?', 'close')$q$, 'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO app.reclamations (client_id, canal, objet, description, contrat_id)
  VALUES ('20000000-0000-4000-8000-000000001203', 'guichet', 'contrat', 'Un contrat qui n''est pas le sien.', '30000000-0000-4000-8000-000000001201')$q$,
  'pas celui du client');
SELECT tests.verifier((SELECT count(*) = 1 FROM app.reclamations), 'le caissier relit celle qu''il a enregistrée');
SELECT tests.doit_echouer($q$SELECT app.traiter_reclamation('70000000-0000-4000-8000-000000001201', 'accuser', NULL, NULL, NULL)$q$,
  'Seuls le gérant et le chargé');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé
SELECT tests.verifier(app.traiter_reclamation('70000000-0000-4000-8000-000000001201', 'accuser', NULL, NULL, NULL) = 'en_cours',
                      'accusé de réception : en cours');
SELECT tests.doit_echouer($q$SELECT app.traiter_reclamation('70000000-0000-4000-8000-000000001201', 'accuser', NULL, NULL, NULL)$q$, 'déjà noté');
SELECT tests.doit_echouer($q$SELECT app.traiter_reclamation('70000000-0000-4000-8000-000000001201', 'clore', NULL, NULL, NULL)$q$,
  'Répondez au client avant de clore');
SELECT tests.doit_echouer($q$SELECT app.traiter_reclamation('70000000-0000-4000-8000-000000001201', 'repondre', 'Vu.', 'fondee', NULL)$q$,
  '10 caractères');
SELECT tests.verifier(app.traiter_reclamation('70000000-0000-4000-8000-000000001201', 'repondre',
                        'Attestation déposée dans votre espace client ce jour, avec nos excuses pour le retard.', 'fondee', NULL) = 'repondue',
                      'réponse donnée, avec son issue');
SELECT tests.verifier(app.traiter_reclamation('70000000-0000-4000-8000-000000001201', 'escalader', NULL, NULL, 'compagnie') = 'repondue',
                      'recours auprès de la compagnie noté');
SELECT tests.doit_echouer($q$SELECT app.traiter_reclamation('70000000-0000-4000-8000-000000001201', 'escalader', NULL, NULL, 'compagnie')$q$,
  'déjà noté');
SELECT app.traiter_reclamation('70000000-0000-4000-8000-000000001201', 'escalader', NULL, NULL, 'direction_assurances');
SELECT tests.verifier(app.traiter_reclamation('70000000-0000-4000-8000-000000001201', 'clore', NULL, NULL, NULL) = 'close', 'close');
SELECT tests.doit_echouer($q$SELECT app.traiter_reclamation('70000000-0000-4000-8000-000000001201', 'repondre', 'Une seconde réponse ?', 'non_fondee', NULL)$q$,
  'close');
SELECT tests.verifier((SELECT accuse_par = '10000000-0000-4000-8000-000000000004' AND repondue_par = '10000000-0000-4000-8000-000000000004'
                         AND escalade = 'direction_assurances' AND close_le IS NOT NULL
                       FROM app.reclamations WHERE id = '70000000-0000-4000-8000-000000001201'),
                      'chaque étape datée et signée par la base');
SELECT tests.doit_echouer($q$UPDATE app.reclamations SET reponse = 'Réécrite' WHERE id = '70000000-0000-4000-8000-000000001201'$q$,
  'permission denied');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.verifier((SELECT count(*) = 0 FROM app.reclamations), 'le commercial ne lit pas le registre des autres');
ROLLBACK;

-- Depuis l'espace client
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
INSERT INTO app.gestionnaires_portail (id, client_id, nom, telephone, role)
VALUES ('80000000-0000-4000-8000-000000001201', '20000000-0000-4000-8000-000000001201', 'Diallo Fanta', '+2250718000001', 'titulaire');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_portail;
SELECT set_config('app.gestionnaire_id', '80000000-0000-4000-8000-000000001201', true);
SELECT reference AS reference_portail FROM portail.deposer_reclamation('sinistre', 'Mon dossier de sinistre n''avance pas.', NULL, NULL) \gset
SELECT tests.verifier((SELECT canal = 'espace_client' AND statut = 'recue' FROM app.reclamations WHERE reference = :'reference_portail'),
                      'réclamation déposée en ligne');
SELECT tests.verifier((SELECT count(*) = 2 FROM app.reclamations), 'la cliente voit ses deux réclamations, celle du guichet comprise');
SELECT tests.verifier((SELECT reponse LIKE 'Attestation déposée%' FROM app.reclamations WHERE id = '70000000-0000-4000-8000-000000001201'),
                      'et la réponse de l''agence');
SELECT tests.doit_echouer($q$SELECT cree_par FROM app.reclamations$q$, 'permission denied');
SELECT tests.doit_echouer($q$SELECT * FROM portail.deposer_reclamation('contrat', 'Le contrat d''un autre client.', '30000000-0000-4000-8000-000000001203', NULL)$q$,
  'pas celui du client');
SELECT portail.deposer_reclamation('autre', 'Deuxième réclamation du jour.', NULL, NULL);
SELECT portail.deposer_reclamation('autre', 'Troisième réclamation du jour.', NULL, NULL);
SELECT portail.deposer_reclamation('autre', 'Quatrième réclamation du jour.', NULL, NULL);
SELECT portail.deposer_reclamation('autre', 'Cinquième réclamation du jour.', NULL, NULL);
SELECT tests.doit_echouer($q$SELECT portail.deposer_reclamation('autre', 'Sixième réclamation du jour.', NULL, NULL)$q$, 'Cinq réclamations par jour');
COMMIT;

\echo
\echo '52. Factures FNE de l''agence'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
INSERT INTO app.factures_fne (id, numero_fne, emise_le, objet, mois, destinataire, montant_ttc)
VALUES ('90000000-0000-4000-8000-000000001201', 'FNE-2026-000123', current_date, 'commissions', date_trunc('month', current_date - 31)::date,
        'SanlamAllianz Côte d''Ivoire', 150000);
SELECT tests.doit_echouer($q$INSERT INTO app.factures_fne (numero_fne, emise_le, objet, mois, destinataire, montant_ttc)
  VALUES ('FNE-2026-000124', current_date, 'commissions', date_trunc('month', current_date - 31)::date, 'SanlamAllianz Côte d''Ivoire', 150000)$q$,
  'factures_fne_mois_unique');
SELECT tests.doit_echouer($q$INSERT INTO app.factures_fne (numero_fne, emise_le, objet, destinataire, montant_ttc)
  VALUES ('FNE-2026-000123', current_date, 'frais', 'Client', 5000)$q$, 'factures_fne_numero_unique');
SELECT tests.doit_echouer($q$INSERT INTO app.factures_fne (numero_fne, emise_le, objet, destinataire, montant_ttc)
  VALUES ('FNE-2026-000125', current_date + 2, 'frais', 'Client', 5000)$q$, 'dans le futur');
SELECT tests.doit_echouer($q$UPDATE app.factures_fne SET montant_ttc = 160000 WHERE id = '90000000-0000-4000-8000-000000001201'$q$,
  'permission denied');
SELECT tests.doit_echouer($q$UPDATE app.factures_fne SET annulee_le = now(), motif_annulation = 'Non' WHERE id = '90000000-0000-4000-8000-000000001201'$q$,
  'factures_fne_annulation');
UPDATE app.factures_fne SET annulee_le = now(), motif_annulation = 'Montant erroné : avoir FNE émis'
WHERE id = '90000000-0000-4000-8000-000000001201';
SELECT tests.verifier((SELECT annulee_par = '10000000-0000-4000-8000-000000000001' FROM app.factures_fne
                       WHERE id = '90000000-0000-4000-8000-000000001201'), 'annulation signée par la base');
SELECT tests.doit_echouer($q$UPDATE app.factures_fne SET annulee_le = now(), motif_annulation = 'Encore une fois' WHERE id = '90000000-0000-4000-8000-000000001201'$q$,
  'ne se modifie pas');
INSERT INTO app.factures_fne (numero_fne, emise_le, objet, mois, destinataire, montant_ttc)
VALUES ('FNE-2026-000126', current_date, 'commissions', date_trunc('month', current_date - 31)::date, 'SanlamAllianz Côte d''Ivoire', 145000);
SELECT tests.verifier(true, 'facture annulée : la bonne se saisit pour le même mois');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.verifier((SELECT count(*) = 0 FROM app.factures_fne), 'le caissier ne lit pas les factures');
SELECT tests.doit_echouer($q$INSERT INTO app.factures_fne (numero_fne, emise_le, objet, destinataire, montant_ttc)
  VALUES ('FNE-X-1', current_date, 'frais', 'Client', 5000)$q$, 'row-level security');
ROLLBACK;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000008', true);  -- auditeur
SELECT tests.verifier((SELECT count(*) = 2 FROM app.factures_fne), 'l''auditeur lit les factures, annulées comprises');
ROLLBACK;

\echo
\echo '53. Registres en ajout seul, même pour le propriétaire des tables, et journal'
SELECT tests.doit_echouer($q$UPDATE app.justificatifs_identification SET nom_fichier = 'autre.pdf'$q$, 'ajout seul');
SELECT tests.doit_echouer($q$DELETE FROM app.traitements_alertes$q$, 'ajout seul');
SELECT tests.doit_echouer($q$DELETE FROM app.formations_personnel$q$, 'ajout seul');
SELECT tests.doit_echouer($q$DELETE FROM app.factures_fne$q$, 'ajout seul');
SELECT tests.doit_echouer($q$UPDATE app.dirigeants_beneficiaires SET nom = 'Réécrit' WHERE retire_le IS NULL$q$, 'ne se modifie pas');
INSERT INTO securite.evenements (type, utilisateur_id, objet)
VALUES ('donnee_sensible_consultee', '10000000-0000-4000-8000-000000000004', 'N° de pièce de Diallo Fanta');
SELECT tests.verifier(true, 'consultation d''une donnée très sensible consignée');
SELECT tests.verifier((SELECT premiere_anomalie IS NULL FROM audit.verifier_chaine()), 'journal d''audit toujours intègre');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM audit.journal WHERE table_nom = 'identifications_clients' AND apres ? 'numero_piece_chiffre'),
                      'le numéro de pièce chiffré n''est jamais recopié au journal d''audit');

\echo
\echo 'Tests de conformité passés.'
