-- =====================================================================
-- Tests de la migration 0006 : consentements et relances automatiques.
-- S'exécute après 01 à 04, dont il réutilise le personnel. Ses clients (+2250711…) sont neufs :
--   · Client WhatsApp (accord WhatsApp) : contrat à J-20, contrat expiré depuis 3 jours, sinistre déclaré ;
--   · Client SMS (accord SMS seulement) : contrat à J-5 ;
--   · Client Muet (aucun accord) : contrat à J-10 ;
--   · Client Devis (accord WhatsApp) : devis envoyé il y a 5 jours.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

-- Préparation : clients et contrats en vigueur (chargé de clientèle, puis paiement au guichet)
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.clients (id, type, nom, telephone) VALUES
  ('20000000-0000-4000-8000-000000000601', 'particulier', 'Client WhatsApp', '+2250711000001'),
  ('20000000-0000-4000-8000-000000000602', 'particulier', 'Client SMS', '+2250711000002'),
  ('20000000-0000-4000-8000-000000000603', 'particulier', 'Client Muet', '+2250711000003'),
  ('20000000-0000-4000-8000-000000000604', 'professionnel', 'Client Devis', '+2250711000004');
INSERT INTO app.contrats (id, client_id, numero_police, branche, date_effet, date_echeance, prime_ttc) VALUES
  ('30000000-0000-4000-8000-000000000601', '20000000-0000-4000-8000-000000000601', 'POL-601', 'automobile',
   current_date - 345, current_date + 20, 50000),
  ('30000000-0000-4000-8000-000000000602', '20000000-0000-4000-8000-000000000601', 'POL-602', 'habitation',
   current_date - 368, current_date - 3, 50000),
  ('30000000-0000-4000-8000-000000000603', '20000000-0000-4000-8000-000000000602', 'POL-603', 'deux_roues',
   current_date - 360, current_date + 5, 50000),
  ('30000000-0000-4000-8000-000000000604', '20000000-0000-4000-8000-000000000603', NULL, 'automobile',
   current_date - 355, current_date + 10, 50000),
  ('30000000-0000-4000-8000-000000000605', '20000000-0000-4000-8000-000000000601', 'POL-605', 'responsabilite_civile',
   current_date, current_date + 90, 50000);
INSERT INTO app.devis (id, client_id, branche, statut, prime_proposee) VALUES
  ('60000000-0000-4000-8000-000000000601', '20000000-0000-4000-8000-000000000604', 'multirisque_professionnelle', 'envoye', 120000);
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
INSERT INTO app.encaissements (contrat_id, montant, mode)
SELECT id, 50000, 'especes' FROM unnest(ARRAY[
  '30000000-0000-4000-8000-000000000601', '30000000-0000-4000-8000-000000000602', '30000000-0000-4000-8000-000000000603',
  '30000000-0000-4000-8000-000000000604', '30000000-0000-4000-8000-000000000605']::uuid[]) AS id;
COMMIT;

-- Le devis a été envoyé il y a 5 jours (préparation directe : la base date elle-même chaque modification)
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE app.devis SET modifie_le = now() - interval '5 days' WHERE id = '60000000-0000-4000-8000-000000000601';
COMMIT;

\echo
\echo '22. Consentements : notés par qui tient les fiches, en ajout seul, avec leur preuve'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.consentements (client_id, canal, accorde, preuve) VALUES
  ('20000000-0000-4000-8000-000000000601', 'whatsapp', true, 'Accord oral au guichet'),
  ('20000000-0000-4000-8000-000000000602', 'whatsapp', false, 'Pas de WhatsApp sur son téléphone'),
  ('20000000-0000-4000-8000-000000000602', 'sms', true, 'Formulaire de souscription signé'),
  ('20000000-0000-4000-8000-000000000604', 'whatsapp', true, 'Accord donné par téléphone');
SELECT tests.verifier((SELECT bool_and(enregistre_par = '10000000-0000-4000-8000-000000000004' AND source = 'agence'
                                       AND enregistre_le IS NOT NULL)
                       FROM app.consentements WHERE client_id = '20000000-0000-4000-8000-000000000601'),
                      'le consentement porte le nom et l''heure de la personne qui l''a noté');
SELECT tests.doit_echouer($q$INSERT INTO app.consentements (client_id, canal, accorde, preuve, enregistre_par)
  VALUES ('20000000-0000-4000-8000-000000000603', 'whatsapp', true, 'Noté au nom du gérant', '10000000-0000-4000-8000-000000000001')$q$,
  'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO app.consentements (client_id, canal, accorde, preuve, source)
  VALUES ('20000000-0000-4000-8000-000000000603', 'whatsapp', true, 'Je me fais passer pour le client', 'reponse_client')$q$,
  'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO app.consentements (client_id, canal, accorde, preuve)
  VALUES ('20000000-0000-4000-8000-000000000603', 'whatsapp', true, 'ok')$q$, 'consentements_preuve_longueur');
SELECT tests.doit_echouer($q$UPDATE app.consentements SET accorde = false$q$, 'permission denied');
SELECT tests.doit_echouer($q$DELETE FROM app.consentements$q$, 'permission denied');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.doit_echouer($q$INSERT INTO app.consentements (client_id, canal, accorde, preuve)
  VALUES ('20000000-0000-4000-8000-000000000603', 'sms', true, 'Accord au guichet')$q$, 'row-level security');
SELECT tests.verifier((SELECT count(*) FROM app.v_consentements WHERE client_id = '20000000-0000-4000-8000-000000000602') = 2,
                      'le caissier voit les choix des clients (dernier choix par canal), sans pouvoir les noter');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000006', true);  -- apporteur
SELECT tests.doit_echouer($q$INSERT INTO app.consentements (client_id, canal, accorde, preuve)
  VALUES ('20000000-0000-4000-8000-000000000002', 'sms', true, 'Accord de mon client')$q$, 'row-level security');
SELECT tests.verifier((SELECT count(*) FROM app.consentements WHERE client_id = '20000000-0000-4000-8000-000000000601') = 0,
                      'l''apporteur ne voit pas les choix des clients qui ne sont pas les siens');
ROLLBACK;

-- Même le propriétaire de la base ne réécrit pas une preuve
SELECT tests.doit_echouer($q$UPDATE app.consentements SET accorde = NOT accorde$q$, 'est une preuve');
SELECT tests.doit_echouer($q$DELETE FROM app.consentements$q$, 'est une preuve');

\echo
\echo '23. Planification : une relance par étape, seulement aux clients qui ont accepté le canal'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
SELECT tests.doit_echouer($q$INSERT INTO app.relances (cle, type, client_id, contrat_id, canal, destinataire, parametres)
  VALUES ('echeance_j30:x', 'echeance_j30', '20000000-0000-4000-8000-000000000603', '30000000-0000-4000-8000-000000000604',
          'whatsapp', '+2250711000003', '{}')$q$, 'permission denied');
SELECT tests.verifier((SELECT count(*) FROM app.v_relances_dues WHERE client_id IN (
                         '20000000-0000-4000-8000-000000000601', '20000000-0000-4000-8000-000000000602',
                         '20000000-0000-4000-8000-000000000603', '20000000-0000-4000-8000-000000000604')) = 5,
                      'relances dues : J-30, contrat expiré, J-7, J-15 et devis sans réponse (pas le contrat à J-90)');
ROLLBACK;

-- Le planificateur travaille sans utilisateur connecté, avec le seul compte de l'application
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.planifier_relances('{whatsapp}') = 3,
                      'WhatsApp seul actif : J-30 et contrat expiré du client WhatsApp, devis du client Devis');
SELECT tests.verifier(app.planifier_relances('{whatsapp}') = 0, 'planifier une seconde fois n''ajoute rien');
SELECT tests.verifier(app.planifier_relances('{whatsapp,sms}') = 1, 'le SMS activé, le client SMS est relancé par SMS');
COMMIT;

SELECT tests.verifier((SELECT canal = 'whatsapp' AND destinataire = '+2250711000001' AND statut = 'a_envoyer'
                              AND parametres ->> 'nom' = 'Client WhatsApp' AND parametres ->> 'numeroPolice' = 'POL-601'
                              AND parametres ->> 'dateEcheance' = (current_date + 20)::text
                       FROM app.relances WHERE cle = 'echeance_j30:30000000-0000-4000-8000-000000000601'),
                      'la relance J-30 part sur WhatsApp au numéro du client, avec de quoi rédiger le message');
SELECT tests.verifier((SELECT type FROM app.relances WHERE contrat_id = '30000000-0000-4000-8000-000000000602') = 'contrat_expire',
                      'contrat échu depuis 3 jours et pas renouvelé : « vous n''êtes plus couvert »');
SELECT tests.verifier((SELECT canal FROM app.relances WHERE contrat_id = '30000000-0000-4000-8000-000000000603') = 'sms'
                      AND (SELECT type FROM app.relances WHERE contrat_id = '30000000-0000-4000-8000-000000000603') = 'echeance_j7',
                      'client qui a refusé WhatsApp et accepté le SMS : relancé par SMS');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.relances WHERE client_id = '20000000-0000-4000-8000-000000000603')
                      AND EXISTS (SELECT 1 FROM app.v_relances_dues WHERE contrat_id = '30000000-0000-4000-8000-000000000604'),
                      'sans consentement, rien n''est envoyé : la relance reste due, à faire par l''agence');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM app.relances WHERE contrat_id = '30000000-0000-4000-8000-000000000605'),
                      'contrat à J-90 : pas encore de relance');

-- Sinistre déclaré : le client en est informé, puis à chaque changement de statut, une fois
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.sinistres (id, contrat_id, survenu_le, nature, statut_modifie_le)
VALUES ('70000000-0000-4000-8000-000000000601', '30000000-0000-4000-8000-000000000601', current_date - 1, 'bris_de_glace',
        now() - interval '1 year');
SELECT tests.verifier((SELECT statut_modifie_le > now() - interval '1 minute' FROM app.sinistres
                       WHERE id = '70000000-0000-4000-8000-000000000601'),
                      'la date du dernier changement de statut est posée par la base');
UPDATE app.sinistres SET description = 'Pare-brise fissuré' WHERE id = '70000000-0000-4000-8000-000000000601';
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.planifier_relances('{whatsapp,sms}') = 1, 'déclaration du sinistre annoncée au client');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
UPDATE app.sinistres SET statut = 'transmis_compagnie' WHERE id = '70000000-0000-4000-8000-000000000601';
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.planifier_relances('{whatsapp,sms}') = 1, 'nouveau statut du sinistre : nouvelle relance');
SELECT tests.verifier(app.planifier_relances('{whatsapp,sms}') = 0, 'chaque statut n''est annoncé qu''une fois');
COMMIT;

SELECT tests.verifier((SELECT array_agg(parametres ->> 'statut' ORDER BY planifiee_le, cle) FROM app.relances
                       WHERE sinistre_id = '70000000-0000-4000-8000-000000000601') = '{declare,transmis_compagnie}',
                      'les relances du sinistre suivent ses statuts');

\echo
\echo '24. Envoi : lot réservé, essais comptés, consentement revérifié, accusés du fournisseur'
-- Le client Devis répond « STOP » sur WhatsApp avant l'envoi
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.enregistrer_desinscription('+2250711000004', 'whatsapp', E'  Stop\n merci ') = 1,
                      'réponse « STOP » : consentement retiré pour la fiche de ce numéro');
COMMIT;
SELECT tests.verifier((SELECT NOT accorde AND source = 'reponse_client' AND enregistre_par IS NULL
                              AND preuve LIKE 'Message « Stop merci » reçu le %'
                       FROM app.v_consentements WHERE client_id = '20000000-0000-4000-8000-000000000604' AND canal = 'whatsapp'),
                      'le retrait garde le message reçu et l''heure comme preuve');

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.doit_echouer($q$SELECT app.enregistrer_desinscription('+2250711000001', 'whatsapp', 'STOP')$q$, 'consentements_auteur');
ROLLBACK;

CREATE TEMPORARY TABLE lot AS
SELECT * FROM app.prendre_relances_a_envoyer('{whatsapp}', 10);
GRANT SELECT ON lot TO dbs_api;
SELECT tests.verifier((SELECT count(*) FROM lot) = 4 AND (SELECT bool_and(tentatives = 1) FROM lot)
                      AND NOT EXISTS (SELECT 1 FROM lot WHERE canal <> 'whatsapp'),
                      'lot WhatsApp : 4 relances réservées, essai compté (le SMS attend son canal)');
SELECT tests.verifier((SELECT statut = 'annulee' AND annulee_par IS NULL AND motif = 'Consentement retiré avant l''envoi'
                       FROM app.relances WHERE devis_id = '60000000-0000-4000-8000-000000000601'),
                      'le devis n''est pas relancé : le client a dit « STOP » entre-temps');
SELECT tests.verifier((SELECT count(*) FROM app.prendre_relances_a_envoyer('{whatsapp}', 10)) = 0,
                      'une relance réservée n''est pas reprise avant son prochain essai');

-- Résultats : J-30 et déclaration du sinistre partis ; numéro sans WhatsApp pour le contrat expiré ;
-- service indisponible pour le sinistre transmis
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT app.enregistrer_envoi(id, 'wamid.TEST-' || row_number() OVER (ORDER BY type), NULL, false)
FROM lot WHERE type = 'echeance_j30' OR parametres ->> 'statut' = 'declare';
SELECT app.enregistrer_envoi(id, NULL, 'Numéro sans compte WhatsApp (131026)', true)
FROM lot WHERE type = 'contrat_expire';
SELECT app.enregistrer_envoi(id, NULL, 'Service momentanément indisponible (503)', false)
FROM lot WHERE parametres ->> 'statut' = 'transmis_compagnie';
COMMIT;
SELECT tests.verifier((SELECT count(*) FROM app.relances WHERE statut = 'envoyee' AND identifiant_fournisseur LIKE 'wamid.TEST-%'
                       AND envoyee_le IS NOT NULL) = 2, 'envoi réussi : statut « envoyée » et identifiant du fournisseur');
SELECT tests.verifier((SELECT statut = 'echec' AND tentatives = 1 AND motif LIKE 'Numéro sans compte%' FROM app.relances
                       WHERE contrat_id = '30000000-0000-4000-8000-000000000602'),
                      'erreur définitive (numéro sans WhatsApp) : échec dès le premier essai');
SELECT tests.verifier((SELECT statut = 'a_envoyer' AND motif LIKE 'Service momentanément%' AND prochaine_tentative > now()
                       FROM app.relances WHERE parametres ->> 'statut' = 'transmis_compagnie'),
                      'erreur passagère : la relance attend un nouvel essai');

-- Les essais s'épuisent : à la troisième erreur passagère, la relance est en échec
UPDATE app.relances SET prochaine_tentative = now() WHERE parametres ->> 'statut' = 'transmis_compagnie';
SELECT app.enregistrer_envoi(id, NULL, 'Erreur 503', false) FROM app.prendre_relances_a_envoyer('{whatsapp}', 10);
SELECT tests.verifier((SELECT statut = 'a_envoyer' AND tentatives = 2 FROM app.relances
                       WHERE parametres ->> 'statut' = 'transmis_compagnie'), 'deuxième essai sans succès : encore un essai');
UPDATE app.relances SET prochaine_tentative = now() WHERE parametres ->> 'statut' = 'transmis_compagnie';
SELECT app.enregistrer_envoi(id, NULL, 'Erreur 503', false) FROM app.prendre_relances_a_envoyer('{whatsapp}', 10);
SELECT tests.verifier((SELECT statut = 'echec' AND tentatives = 3 FROM app.relances
                       WHERE parametres ->> 'statut' = 'transmis_compagnie'),
                      'trois essais sans succès : la relance est en échec');

-- Accusés de WhatsApp (TEST-1 : échéance J-30, TEST-2 : déclaration du sinistre)
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.enregistrer_statut_fournisseur('wamid.TEST-1', 'remise', NULL), 'accusé de remise enregistré');
SELECT tests.verifier(app.enregistrer_statut_fournisseur('wamid.TEST-1', 'lue', NULL), 'accusé de lecture enregistré');
SELECT tests.verifier(app.enregistrer_statut_fournisseur('wamid.TEST-1', 'remise', NULL), 'accusé de remise arrivé en retard');
SELECT tests.verifier(app.enregistrer_statut_fournisseur('wamid.TEST-2', 'echec', 'Message non distribuable (131049)'),
                      'échec signalé après l''envoi');
SELECT tests.verifier(NOT app.enregistrer_statut_fournisseur('wamid.INCONNU', 'lue', NULL), 'identifiant inconnu : rien ne change');
COMMIT;
SELECT tests.verifier((SELECT statut = 'lue' AND remise_le IS NOT NULL AND lue_le IS NOT NULL AND type = 'echeance_j30'
                       FROM app.relances WHERE identifiant_fournisseur = 'wamid.TEST-1'),
                      'un accusé en retard ne fait pas reculer le statut');
SELECT tests.verifier((SELECT statut = 'echec' AND motif LIKE 'Message non distribuable%' FROM app.relances
                       WHERE identifiant_fournisseur = 'wamid.TEST-2'), 'échec signalé par WhatsApp, avec sa raison');

-- Une relance qui n'a pas pu partir en 48 heures est abandonnée (le message serait périmé)
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE app.relances SET planifiee_le = now() - interval '3 days'
WHERE contrat_id = '30000000-0000-4000-8000-000000000603';
COMMIT;
SELECT tests.verifier((SELECT count(*) FROM app.prendre_relances_a_envoyer('{whatsapp,sms}', 10)) = 0,
                      'aucune relance périmée n''est envoyée');
SELECT tests.verifier((SELECT statut = 'annulee' AND motif = 'Pas envoyée dans les 48 heures' FROM app.relances
                       WHERE contrat_id = '30000000-0000-4000-8000-000000000603'),
                      'la relance SMS restée en attente plus de 48 heures est abandonnée, avec son motif');

\echo
\echo '25. Relances : lues par qui suit les clients, annulées avant l''envoi seulement, jamais réécrites'
-- Une nouvelle relance à annuler : le client Muet donne son accord par SMS
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
INSERT INTO app.consentements (client_id, canal, accorde, preuve)
VALUES ('20000000-0000-4000-8000-000000000603', 'sms', true, 'Accord oral lors d''une visite');
COMMIT;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.planifier_relances('{whatsapp,sms}') = 1, 'accord donné : la relance due part à la planification suivante');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.verifier((SELECT count(*) FROM app.relances WHERE client_id = '20000000-0000-4000-8000-000000000603') = 1,
                      'le commercial suit les relances');
UPDATE app.relances SET statut = 'annulee' WHERE client_id = '20000000-0000-4000-8000-000000000603';
SELECT tests.verifier((SELECT statut FROM app.relances WHERE client_id = '20000000-0000-4000-8000-000000000603') = 'a_envoyer',
                      'le commercial n''annule pas une relance');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.verifier((SELECT count(*) FROM app.relances) = 0, 'la caisse ne voit pas les relances');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
SELECT tests.doit_echouer($q$UPDATE app.relances SET statut = 'envoyee' WHERE identifiant_fournisseur = 'wamid.TEST-2'$q$,
                          'pas encore envoyée');
SELECT tests.doit_echouer($q$UPDATE app.relances SET statut = 'annulee' WHERE identifiant_fournisseur = 'wamid.TEST-2'$q$,
                          'pas encore envoyée');
SELECT tests.doit_echouer($q$UPDATE app.relances SET destinataire = '+2250799999999'$q$, 'permission denied');
SELECT tests.doit_echouer($q$DELETE FROM app.relances$q$, 'permission denied');
UPDATE app.relances SET statut = 'annulee' WHERE client_id = '20000000-0000-4000-8000-000000000603';
SELECT tests.verifier((SELECT annulee_par = '10000000-0000-4000-8000-000000000004' AND annulee_le IS NOT NULL
                       FROM app.relances WHERE client_id = '20000000-0000-4000-8000-000000000603'),
                      'annulée avant l''envoi par le chargé de clientèle, qui en porte le nom');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT count(*) FROM app.prendre_relances_a_envoyer('{whatsapp,sms}', 10)) = 0,
                      'une relance annulée ne part pas');
COMMIT;

-- Même le propriétaire de la base ne réécrit pas une relance ni ne revient sur son statut
SELECT tests.doit_echouer($q$UPDATE app.relances SET parametres = '{}' WHERE identifiant_fournisseur = 'wamid.TEST-2'$q$,
                          'ne se modifie pas');
SELECT tests.doit_echouer($q$UPDATE app.relances SET statut = 'a_envoyer' WHERE identifiant_fournisseur = 'wamid.TEST-2'$q$,
                          'ne peut pas passer');
SELECT tests.doit_echouer($q$DELETE FROM app.relances$q$, 'ne se supprime pas');

SELECT tests.verifier((SELECT count(*) FROM audit.journal WHERE table_nom = 'app.relances' AND utilisateur_id IS NULL) > 0
                      AND (SELECT count(*) FROM audit.journal WHERE table_nom = 'app.consentements') >= 6,
                      'relances et consentements consignés au journal d''audit, y compris le travail du planificateur');
SELECT tests.verifier((SELECT premiere_anomalie IS NULL FROM audit.verifier_chaine()), 'journal d''audit toujours intègre');

\echo
\echo 'Tests des relances et des consentements passés.'
