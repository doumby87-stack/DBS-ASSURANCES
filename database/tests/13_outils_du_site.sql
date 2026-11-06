-- =====================================================================
-- Tests de la migration 0015 : rappel d'échéance gratuit, assistant « appel d'offres », prise de rendez-vous.
-- S'exécute après 01 à 12.
--   · Koné Awa (+2250719000001), visiteuse du site ; BTP Ivoire (+2250719000002), entreprise ;
--     Yao Serge (+2250719000003), client de l'agence pour les rendez-vous fixés au guichet.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '54. Rappel d''échéance gratuit : à traiter un mois avant l''échéance'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT a_traiter_le = current_date + 70 FROM app.enregistrer_rappel_echeance(
  'automobile', 'particulier', 'Koné Awa', '+2250719000001', NULL, current_date + 100,
  'J''accepte que DBS-ASSURANCES garde ces informations pour me rappeler avant mon échéance.', NULL, decode(repeat('a1', 32), 'hex'))),
  'échéance dans 100 jours : à traiter 30 jours avant');
SELECT tests.verifier((SELECT a_traiter_le = current_date FROM app.enregistrer_rappel_echeance(
  'habitation', 'particulier', 'Koné Awa', '+2250719000001', ' AWA@Exemple.ci ', current_date + 10,
  'J''accepte que DBS-ASSURANCES garde ces informations pour me rappeler avant mon échéance.', NULL, decode(repeat('a1', 32), 'hex'))),
  'échéance dans 10 jours : à traiter tout de suite');
SELECT tests.doit_echouer($q$SELECT app.enregistrer_rappel_echeance('automobile', 'particulier', 'Koné Awa', '+2250719000001', NULL,
  current_date - 1, 'J''accepte que DBS-ASSURANCES garde ces informations.', NULL, decode(repeat('a2', 32), 'hex'))$q$,
  'comprise entre aujourd''hui et les 13 prochains mois');
SELECT tests.doit_echouer($q$SELECT app.enregistrer_rappel_echeance('automobile', 'particulier', 'Koné Awa', '+2250719000001', NULL,
  current_date + 500, 'J''accepte que DBS-ASSURANCES garde ces informations.', NULL, decode(repeat('a2', 32), 'hex'))$q$,
  'comprise entre aujourd''hui et les 13 prochains mois');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.verifier((SELECT nature = 'rappel_echeance' AND echeance_actuelle = current_date + 100 AND email IS NULL AND statut = 'nouvelle'
                       FROM app.demandes_site WHERE telephone = '+2250719000001' AND branche = 'automobile'),
                      'le rappel est une demande du site, avec l''échéance donnée');
SELECT tests.verifier((SELECT email = 'awa@exemple.ci' FROM app.demandes_site WHERE telephone = '+2250719000001' AND branche = 'habitation'),
                      'adresse e-mail nettoyée');
SELECT app.enregistrer_demande_site(
  'deux_roues', 'particulier', 'Koné Awa', '+2250719000001', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, decode(repeat('a3', 32), 'hex'),
  NULL, NULL, NULL, NULL, NULL);
SELECT tests.verifier((SELECT nature = 'devis' AND a_traiter_le = current_date FROM app.demandes_site
                       WHERE telephone = '+2250719000001' AND branche = 'deux_roues'),
  'une demande de devis reste à traiter dès sa réception');
SELECT tests.doit_echouer($q$UPDATE app.demandes_site SET echeance_actuelle = current_date WHERE telephone = '+2250719000001'$q$,
  'permission denied');
-- Le rappel se traite comme un devis : converti ou classé sans suite
UPDATE app.demandes_site SET statut = 'sans_suite', motif = 'Déjà assurée ailleurs' WHERE telephone = '+2250719000001' AND branche = 'habitation';
SELECT tests.verifier((SELECT traitee_par = '10000000-0000-4000-8000-000000000005' FROM app.demandes_site
                       WHERE telephone = '+2250719000001' AND branche = 'habitation'), 'rappel classé sans suite par le commercial');
COMMIT;
SELECT tests.doit_echouer($q$UPDATE app.demandes_site SET a_traiter_le = current_date WHERE telephone = '+2250719000001' AND branche = 'automobile'$q$,
  'ne se modifie pas');
SELECT tests.doit_echouer($q$INSERT INTO app.demandes_site (numero, nature, branche, profil, nom, telephone, accord_traitement, empreinte_ip)
  VALUES (990001, 'rappel_echeance', 'automobile', 'particulier', 'Sans Échéance', '+2250719000009', 'J''accepte le traitement.', decode(repeat('a4', 32), 'hex'))$q$,
  'demandes_site_rappel');

\echo
\echo '55. Assistant « appel d''offres » : date limite et description du marché'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT numero >= 1 FROM app.enregistrer_appel_offres(
  'chantier_construction', 'entreprise', 'BTP Ivoire SARL', '+2250719000002', NULL, 'Bouaké', 'Le cahier des charges demande une TRC.',
  current_date + 20,
  '{"typeMarche": "travaux", "maitreOuvrage": "Mairie de Bouaké", "objet": "Réfection de voirie", "garanties": ["trc", "rc_pro"]}',
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, decode(repeat('a1', 32), 'hex'))),
  'appel d''offres enregistré');
SELECT tests.doit_echouer($q$SELECT app.enregistrer_appel_offres('chantier_construction', 'particulier', 'Koné Awa', '+2250719000001', NULL, NULL, NULL,
  current_date + 20, '{"garanties": []}', 'J''accepte le traitement.', NULL, decode(repeat('a5', 32), 'hex'))$q$,
  'professionnels et aux entreprises');
SELECT tests.doit_echouer($q$SELECT app.enregistrer_appel_offres('chantier_construction', 'entreprise', 'BTP Ivoire SARL', '+2250719000002', NULL, NULL, NULL,
  current_date - 1, '{"garanties": []}', 'J''accepte le traitement.', NULL, decode(repeat('a5', 32), 'hex'))$q$,
  'date limite de dépôt');
SELECT tests.doit_echouer($q$SELECT app.enregistrer_appel_offres('chantier_construction', 'entreprise', 'BTP Ivoire SARL', '+2250719000002', NULL, NULL, NULL,
  current_date + 20, '["trc"]', 'J''accepte le traitement.', NULL, decode(repeat('a5', 32), 'hex'))$q$,
  'demandes_site_appel_offres_forme');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
SELECT tests.verifier((SELECT nature = 'appel_offres' AND date_limite_offre = current_date + 20 AND a_traiter_le = current_date
                              AND appel_offres->>'maitreOuvrage' = 'Mairie de Bouaké' AND commune = 'Bouaké'
                       FROM app.demandes_site WHERE telephone = '+2250719000002'),
                      'la date limite et le marché sont lisibles par l''agence');
COMMIT;

\echo
\echo '56. Rendez-vous : demande du site, confirmation, agenda, clôture'
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT numero >= 1 FROM app.demander_rendez_vous(
  'devis', 'agence', 'particulier', 'Koné Awa', '+2250719000001', NULL, 'Pour assurer ma nouvelle voiture.',
  app.ajouter_jours_ouvres(current_date, 2), 'matin',
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, decode(repeat('a1', 32), 'hex'))),
  'demande de rendez-vous enregistrée depuis le site');
SELECT tests.doit_echouer($q$SELECT app.demander_rendez_vous('devis', 'agence', 'particulier', 'Koné Awa', '+2250719000001', NULL, NULL,
  current_date, 'matin', 'J''accepte le traitement.', NULL, decode(repeat('a6', 32), 'hex'))$q$, 'entre demain');
SELECT tests.doit_echouer($q$SELECT app.demander_rendez_vous('devis', 'agence', 'particulier', 'Koné Awa', '+2250719000001', NULL, NULL,
  current_date + 90, 'matin', 'J''accepte le traitement.', NULL, decode(repeat('a6', 32), 'hex'))$q$, 'deux prochains mois');
SELECT tests.doit_echouer(format($q$SELECT app.demander_rendez_vous('devis', 'agence', 'particulier', 'Koné Awa', '+2250719000001', NULL, NULL,
  %L, 'matin', 'J''accepte le traitement.', NULL, decode(repeat('a6', 32), 'hex'))$q$,
  (SELECT d::date FROM generate_series(current_date + 1, current_date + 7, interval '1 day') d WHERE extract(isodow FROM d) = 7)),
  'du lundi au vendredi');
SELECT tests.doit_echouer($q$SELECT app.demander_rendez_vous('flotte', 'chez_le_client', 'particulier', 'Koné Awa', '+2250719000001', NULL, NULL,
  app.ajouter_jours_ouvres(current_date, 2), 'matin', 'J''accepte le traitement.', NULL, decode(repeat('a6', 32), 'hex'))$q$,
  'réservée aux professionnels');
SELECT tests.verifier((SELECT numero >= 1 FROM app.demander_rendez_vous(
  'appel_offres', 'chez_le_client', 'entreprise', 'BTP Ivoire SARL', '+2250719000002', NULL, NULL,
  app.ajouter_jours_ouvres(current_date, 3), 'apres_midi',
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, decode(repeat('a1', 32), 'hex'))),
  'visite sur place demandée par une entreprise');
-- Cinq demandes depuis la même adresse en une heure (rappels, appel d'offres, rendez-vous confondus) : la sixième est refusée
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('automobile', 'particulier', 'Koné Awa', '+2250719000001', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, decode(repeat('a1', 32), 'hex'), NULL, NULL, NULL, NULL, NULL)$q$,
  'Trop de demandes');
SELECT tests.doit_echouer($q$INSERT INTO app.rendez_vous (numero, origine, motif, mode, nom, telephone, statut)
  VALUES (990001, 'agence', 'devis', 'agence', 'Direct', '+2250719000009', 'demande')$q$, 'permission denied');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.verifier((SELECT count(*) = 0 FROM app.rendez_vous), 'le caissier ne voit pas l''agenda');
SELECT tests.doit_echouer($q$SELECT app.traiter_rendez_vous((SELECT id FROM app.rendez_vous LIMIT 1), 'annuler', NULL, NULL, NULL, NULL, 'Essai', NULL)$q$,
  'Seuls le gérant');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.verifier((SELECT statut = 'demande' AND souhaite_le = app.ajouter_jours_ouvres(current_date, 2) AND debut IS NULL
                       FROM app.rendez_vous WHERE telephone = '+2250719000001'), 'la demande attend sa confirmation');
SELECT tests.doit_echouer($q$UPDATE app.rendez_vous SET statut = 'confirme' WHERE telephone = '+2250719000001'$q$, 'permission denied');
SELECT tests.verifier(app.traiter_rendez_vous(
  (SELECT id FROM app.rendez_vous WHERE telephone = '+2250719000001'), 'confirmer',
  (app.ajouter_jours_ouvres(current_date, 2) + time '09:00') AT TIME ZONE 'Africa/Abidjan', 30,
  '10000000-0000-4000-8000-000000000004', NULL, NULL, NULL) = 'confirme', 'rendez-vous confirmé à 9 h avec le chargé de clientèle');
SELECT tests.verifier((SELECT confirme_par = '10000000-0000-4000-8000-000000000005' AND avec = '10000000-0000-4000-8000-000000000004'
                              AND mode = 'agence' AND confirme_le IS NOT NULL
                       FROM app.rendez_vous WHERE telephone = '+2250719000001'), 'confirmation datée et signée par le commercial');
COMMIT;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
INSERT INTO app.clients (id, type, nom, telephone) VALUES
  ('20000000-0000-4000-8000-000000001301', 'particulier', 'Yao Serge', '+2250719000003');
SELECT tests.doit_echouer($q$SELECT app.fixer_rendez_vous('renouvellement', 'agence', 'Yao Serge', '+2250719000003', NULL, NULL,
  '20000000-0000-4000-8000-000000001301', (app.ajouter_jours_ouvres(current_date, 2) + time '09:15') AT TIME ZONE 'Africa/Abidjan', 30,
  '10000000-0000-4000-8000-000000000004')$q$, 'a déjà un rendez-vous à cette heure-là');
SELECT tests.doit_echouer($q$SELECT app.fixer_rendez_vous('renouvellement', 'agence', 'Yao Serge', '+2250719000003', NULL, NULL,
  '20000000-0000-4000-8000-000000001301', (app.ajouter_jours_ouvres(current_date, 2) + time '19:45') AT TIME ZONE 'Africa/Abidjan', 30,
  '10000000-0000-4000-8000-000000000004')$q$, 'entre 7 h et 20 h');
SELECT tests.doit_echouer($q$SELECT app.fixer_rendez_vous('renouvellement', 'agence', 'Yao Serge', '+2250719000003', NULL, NULL,
  '20000000-0000-4000-8000-000000001301', (app.ajouter_jours_ouvres(current_date, 2) + time '11:00') AT TIME ZONE 'Africa/Abidjan', 30,
  '10000000-0000-4000-8000-000000000008')$q$, 'ne peut pas recevoir');
SELECT tests.doit_echouer($q$SELECT app.fixer_rendez_vous('renouvellement', 'agence', 'Yao Serge', '+2250719000003', NULL, NULL,
  '20000000-0000-4000-8000-000000001301', now() - interval '1 day', 30, '10000000-0000-4000-8000-000000000004')$q$, 'à venir');
SELECT tests.verifier((SELECT numero >= 1 FROM app.fixer_rendez_vous('renouvellement', 'telephone', 'Yao Serge', '+2250719000003', NULL, NULL,
  '20000000-0000-4000-8000-000000001301', (app.ajouter_jours_ouvres(current_date, 2) + time '09:30') AT TIME ZONE 'Africa/Abidjan', 20,
  '10000000-0000-4000-8000-000000000004')), 'rendez-vous fixé juste après le précédent');
SELECT tests.verifier((SELECT origine = 'agence' AND statut = 'confirme' AND cree_par = '10000000-0000-4000-8000-000000000004'
                              AND client_id = '20000000-0000-4000-8000-000000001301'
                       FROM app.rendez_vous WHERE telephone = '+2250719000003'), 'fixé par l''agence, pour son client, déjà confirmé');
SELECT tests.doit_echouer($q$SELECT app.traiter_rendez_vous((SELECT id FROM app.rendez_vous WHERE telephone = '+2250719000003'), 'honore',
  NULL, NULL, NULL, NULL, NULL, NULL)$q$, 'une fois son heure passée');
SELECT tests.doit_echouer($q$SELECT app.traiter_rendez_vous((SELECT id FROM app.rendez_vous WHERE telephone = '+2250719000003'), 'annuler',
  NULL, NULL, NULL, NULL, ' ', NULL)$q$, 'motif de l''annulation');
SELECT tests.verifier(app.traiter_rendez_vous((SELECT id FROM app.rendez_vous WHERE telephone = '+2250719000003'), 'annuler',
  NULL, NULL, NULL, NULL, 'Le client a renouvelé par téléphone', NULL) = 'annule', 'rendez-vous annulé avec son motif');
SELECT tests.doit_echouer($q$SELECT app.traiter_rendez_vous((SELECT id FROM app.rendez_vous WHERE telephone = '+2250719000003'), 'confirmer',
  (app.ajouter_jours_ouvres(current_date, 2) + time '15:00') AT TIME ZONE 'Africa/Abidjan', 30, '10000000-0000-4000-8000-000000000004',
  NULL, NULL, NULL)$q$, 'est clos');
-- Déplacer un rendez-vous confirmé : il ne se heurte pas à lui-même
SELECT tests.verifier(app.traiter_rendez_vous((SELECT id FROM app.rendez_vous WHERE telephone = '+2250719000001'), 'confirmer',
  (app.ajouter_jours_ouvres(current_date, 2) + time '09:10') AT TIME ZONE 'Africa/Abidjan', 30, '10000000-0000-4000-8000-000000000004',
  'telephone', NULL, NULL) = 'confirme', 'rendez-vous déplacé de dix minutes, et passé au téléphone');
SELECT tests.verifier(app.traiter_rendez_vous((SELECT id FROM app.rendez_vous WHERE telephone = '+2250719000001'), 'rattacher',
  NULL, NULL, NULL, NULL, NULL, '20000000-0000-4000-8000-000000001301') = 'confirme', 'rendez-vous rattaché à une fiche client');
COMMIT;

-- Un rendez-vous dont l'heure est passée (créé ici directement par le propriétaire des tables)
INSERT INTO app.rendez_vous (id, numero, origine, motif, mode, nom, telephone, client_id, debut, duree_minutes, avec, statut,
                             cree_par, confirme_le, confirme_par)
VALUES ('91000000-0000-4000-8000-000000000001', 990101, 'agence', 'sinistre', 'agence', 'Yao Serge', '+2250719000003',
        '20000000-0000-4000-8000-000000001301', now() - interval '2 hours', 30, '10000000-0000-4000-8000-000000000004',
        'confirme', '10000000-0000-4000-8000-000000000004', now() - interval '1 day', '10000000-0000-4000-8000-000000000004');
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);
SELECT tests.verifier(app.traiter_rendez_vous('91000000-0000-4000-8000-000000000001', 'honore', NULL, NULL, NULL, NULL, NULL, NULL) = 'honore',
                      'rendez-vous passé : noté comme honoré');
SELECT tests.verifier((SELECT clos_par = '10000000-0000-4000-8000-000000000004' AND clos_le IS NOT NULL
                       FROM app.rendez_vous WHERE id = '91000000-0000-4000-8000-000000000001'), 'clôture datée et signée');
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000008', true);  -- auditeur
SELECT tests.verifier((SELECT count(*) >= 4 FROM app.rendez_vous), 'l''auditeur consulte l''agenda');
SELECT tests.doit_echouer($q$SELECT app.traiter_rendez_vous('91000000-0000-4000-8000-000000000001', 'manque', NULL, NULL, NULL, NULL, NULL, NULL)$q$,
  'Seuls le gérant');
COMMIT;

\echo
\echo '57. Rendez-vous et demandes : ni modification hors des fonctions, ni suppression hors de la purge ; journal'
SELECT tests.doit_echouer($q$UPDATE app.rendez_vous SET nom = 'Réécrit' WHERE telephone = '+2250719000001'$q$,
  'app.traiter_rendez_vous');
SELECT tests.doit_echouer($q$DELETE FROM app.rendez_vous WHERE telephone = '+2250719000001'$q$, 'ne se supprime pas');

-- Données anciennes, vieillies sans passer par les gardiens de la base (réservé aux tests)
INSERT INTO app.rendez_vous (id, numero, origine, motif, mode, profil, nom, telephone, souhaite_le, creneau_souhaite, statut,
                             motif_annulation, accord_traitement, empreinte_ip, cree_le, clos_le, clos_par)
VALUES
  ('91000000-0000-4000-8000-000000000002', 990102, 'site', 'devis', 'agence', 'particulier', 'Ancien Prospect', '+2250719000011',
   current_date - 420, 'matin', 'annule', 'Injoignable', 'J''accepte le traitement.', decode(repeat('b1', 32), 'hex'),
   now() - interval '14 months', now() - interval '13 months', '10000000-0000-4000-8000-000000000004'),
  ('91000000-0000-4000-8000-000000000003', 990103, 'site', 'devis', 'agence', 'particulier', 'Prospect Récent', '+2250719000012',
   current_date - 60, 'matin', 'annule', 'Injoignable', 'J''accepte le traitement.', decode(repeat('b1', 32), 'hex'),
   now() - interval '14 months', now() - interval '2 months', '10000000-0000-4000-8000-000000000004');
SET session_replication_role = replica;
UPDATE app.rendez_vous SET cree_le = now() - interval '14 months', debut = now() - interval '13 months', confirme_le = now() - interval '14 months',
  clos_le = now() - interval '13 months', clos_par = avec
WHERE id = '91000000-0000-4000-8000-000000000001';                         -- ancien, mais rattaché à un client : gardé
INSERT INTO app.demandes_site (numero, nature, branche, profil, nom, telephone, accord_traitement, empreinte_ip, recue_le,
                               echeance_actuelle, a_traiter_le)
VALUES
  (990201, 'rappel_echeance', 'automobile', 'particulier', 'Rappel Échu', '+2250719000021', 'J''accepte le traitement.',
   decode(repeat('b2', 32), 'hex'), now() - interval '26 months', current_date - 400, current_date - 430),
  (990202, 'rappel_echeance', 'automobile', 'particulier', 'Rappel Lointain', '+2250719000022', 'J''accepte le traitement.',
   decode(repeat('b2', 32), 'hex'), now() - interval '14 months', current_date - 30, current_date - 60);
SET session_replication_role = origin;
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier(app.purger_rendez_vous() = 1, 'un rendez-vous supprimé : celui d''un prospect, clos depuis plus de 12 mois');
SELECT tests.verifier(app.purger_rendez_vous() = 0, 'une seconde purge ne trouve plus rien');
SELECT tests.verifier(app.purger_demandes_site() = 1, 'un rappel supprimé : jamais traité, échéance passée depuis plus de 12 mois');
COMMIT;
SELECT tests.verifier((SELECT array_agg(numero ORDER BY numero) = ARRAY[990101, 990103]::bigint[] FROM app.rendez_vous WHERE numero >= 990000),
                      'restent le rendez-vous du client et celui clos récemment');
SELECT tests.verifier((SELECT array_agg(numero) = ARRAY[990202]::bigint[] FROM app.demandes_site WHERE numero >= 990000),
                      'reste le rappel reçu il y a 14 mois mais dont l''échéance est récente');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM audit.journal WHERE table_nom = 'rendez_vous'
                                    AND (apres ? 'nom' OR apres ? 'telephone' OR apres ? 'message' OR avant ? 'nom')),
                      'les coordonnées des rendez-vous ne vont pas au journal d''audit');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM audit.journal WHERE table_nom = 'demandes_site' AND apres ? 'appel_offres'),
                      'la description d''un appel d''offres ne va pas au journal d''audit');
SELECT tests.verifier((SELECT premiere_anomalie IS NULL FROM audit.verifier_chaine()), 'journal d''audit toujours intègre');

\echo
\echo 'Tests des outils du site passés.'
