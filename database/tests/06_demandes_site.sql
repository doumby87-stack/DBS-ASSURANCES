-- =====================================================================
-- Tests de la migration 0007 : demandes de devis reçues par le site.
-- S'exécute après 01 à 05, dont il réutilise le personnel. Les demandes arrivent sans utilisateur
-- connecté, comme depuis la route publique de l'API.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\echo
\echo '26. Réception : une seule porte d''entrée, sans compte, avec ses limites'
-- Le site n'a aucun compte : l'application n'insère rien directement
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.doit_echouer($q$INSERT INTO app.demandes_site (numero, branche, profil, nom, telephone, accord_traitement, empreinte_ip)
  VALUES (999, 'automobile', 'particulier', 'Intrus', '+2250700000000', 'J''accepte tout ce qu''on veut', sha256('x'))$q$,
  'permission denied');
SELECT tests.doit_echouer($q$INSERT INTO app.pieces_demandes_site (id, demande_id, type_contenu, taille, contenu_chiffre, empreinte)
  VALUES (gen_random_uuid(), gen_random_uuid(), 'image/png', 1, '\x00', sha256('x'))$q$, 'permission denied');
ROLLBACK;

-- Demande avec carte grise (contenu chiffré simulé : 29 octets d'en-tête + 3 octets)
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT numero >= 1 FROM app.enregistrer_demande_site(
  'automobile', 'particulier', '  Awa Koné  ', '+2250712000001', ' Awa@Exemple.CI ', 'Yopougon',
  'Toyota Corolla 2019, usage personnel', 'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.',
  'J''accepte de recevoir sur WhatsApp les rappels de l''agence.', sha256('adresse-a'),
  '80000000-0000-4000-8000-000000000701', 'image/jpeg', 3, ('\x01' || repeat('00', 31))::bytea, sha256('abc'))),
  'la demande reçoit un numéro, à communiquer au visiteur');
COMMIT;

SELECT tests.verifier((SELECT nom = 'Awa Koné' AND email = 'awa@exemple.ci' AND statut = 'nouvelle' AND traitee_le IS NULL
                              AND recue_le > now() - interval '1 minute'
                       FROM app.demandes_site WHERE telephone = '+2250712000001'),
                      'nom et e-mail nettoyés, demande « nouvelle », heure de réception posée par la base');
SELECT tests.verifier((SELECT p.taille = 3 AND p.type_contenu = 'image/jpeg' AND p.nature = 'carte_grise'
                       FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
                       WHERE d.telephone = '+2250712000001'),
                      'la carte grise est rattachée à la demande');

-- Sans pièce jointe, pour un besoin non listé
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.verifier((SELECT count(*) FROM app.enregistrer_demande_site(
  'autre', 'entreprise', 'Société Test', '+2250712000002', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations pour répondre à ma demande.', NULL, sha256('adresse-b'),
  NULL, NULL, NULL, NULL, NULL)) = 1, 'demande sans pièce jointe ni e-mail');
COMMIT;

-- Contrôles de format et de taille
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('automobile', 'particulier', 'Test', '0712000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-c'), NULL, NULL, NULL, NULL, NULL)$q$,
  'demandes_site_telephone_format');
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('automobile', 'particulier', 'Test', '+2250712000003', NULL, NULL, NULL,
  'oui', NULL, sha256('adresse-c'), NULL, NULL, NULL, NULL, NULL)$q$, 'demandes_site_accords_longueur');
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('automobile', 'particulier', 'Test', '+2250712000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-c'),
  gen_random_uuid(), 'text/html', 3, ('\x01' || repeat('00', 31))::bytea, sha256('abc'))$q$, 'pieces_demandes_site_type');
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('automobile', 'particulier', 'Test', '+2250712000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-c'),
  gen_random_uuid(), 'application/pdf', 6000000, decode(repeat('00', 6000029), 'hex'), sha256('abc'))$q$,
  'pieces_demandes_site_taille');
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('automobile', 'particulier', 'Test', '+2250712000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-c'),
  gen_random_uuid(), 'application/pdf', 3, '\x0102', sha256('abc'))$q$, 'pieces_demandes_site_chiffre');
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('automobile', 'particulier', 'Test', '+2250712000003', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, '\x01', NULL, NULL, NULL, NULL, NULL)$q$,
  'demandes_site_empreinte_ip');
ROLLBACK;

-- Cinq demandes par heure depuis une même adresse ; les autres adresses ne sont pas gênées
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT app.enregistrer_demande_site('habitation', 'particulier', 'Visiteur ' || n, '+225071200010' || n, NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-d'), NULL, NULL, NULL, NULL, NULL)
FROM generate_series(1, 5) AS n;
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('habitation', 'particulier', 'Visiteur 6', '+2250712000106',
  NULL, NULL, NULL, 'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-d'),
  NULL, NULL, NULL, NULL, NULL)$q$, 'Trop de demandes envoyées depuis cette adresse');
SELECT tests.verifier((SELECT count(*) FROM app.enregistrer_demande_site('habitation', 'particulier', 'Voisin', '+2250712000107',
  NULL, NULL, NULL, 'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('adresse-e'),
  NULL, NULL, NULL, NULL, NULL)) = 1, 'une autre adresse peut toujours envoyer sa demande');
ROLLBACK;

-- Plafond du jour, toutes adresses confondues (rafale venue de nombreuses adresses)
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT app.enregistrer_demande_site('habitation', 'particulier', 'Robot', '+2250712009999', NULL, NULL, NULL,
  'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256(convert_to('robot-' || n, 'UTF8')), NULL, NULL, NULL, NULL, NULL)
FROM generate_series(1, app.demandes_site_par_jour_max() - 2) AS n;
SELECT tests.doit_echouer($q$SELECT app.enregistrer_demande_site('habitation', 'particulier', 'Robot', '+2250712009999',
  NULL, NULL, NULL, 'J''accepte que DBS-ASSURANCES utilise ces informations.', NULL, sha256('robot-dernier'),
  NULL, NULL, NULL, NULL, NULL)$q$, 'Nombre de demandes du jour atteint');
ROLLBACK;

\echo
\echo '27. Traitement : par qui crée les clients et les devis, une seule fois, jamais réécrit'
-- Lecture : l'empreinte de l'adresse IP n'est jamais lue par l'application ; pièces réservées
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000005', true);  -- commercial
SELECT tests.verifier((SELECT count(*) FROM app.demandes_site WHERE telephone LIKE '+22507120000%') = 2,
                      'le commercial voit les demandes du site');
SELECT tests.doit_echouer($q$SELECT empreinte_ip FROM app.demandes_site$q$, 'permission denied');
SELECT tests.verifier((SELECT count(*) FROM app.pieces_demandes_site) = 1, 'il peut ouvrir la carte grise jointe');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000008', true);  -- auditeur
SELECT tests.verifier((SELECT count(*) FROM app.demandes_site WHERE telephone LIKE '+22507120000%') = 2,
                      'l''auditeur consulte les demandes');
SELECT tests.verifier((SELECT count(*) FROM app.pieces_demandes_site) = 0, 'mais pas les pièces jointes');
WITH m AS (UPDATE app.demandes_site SET statut = 'sans_suite', motif = 'Test auditeur' RETURNING 1)
SELECT tests.verifier((SELECT count(*) FROM m) = 0, 'l''auditeur ne peut traiter aucune demande');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000003', true);  -- caissier
SELECT tests.verifier((SELECT count(*) FROM app.demandes_site) = 0, 'le caissier ne voit pas les demandes');
ROLLBACK;

BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000006', true);  -- apporteur
SELECT tests.verifier((SELECT count(*) FROM app.demandes_site) = 0, 'l''apporteur non plus : ce ne sont pas ses clients');
ROLLBACK;

-- Conversion par le chargé de clientèle : client, devis « site », puis demande convertie
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000004', true);  -- chargé de clientèle
SELECT tests.doit_echouer($q$UPDATE app.demandes_site SET nom = 'Autre nom' WHERE telephone = '+2250712000001'$q$,
                          'permission denied');
SELECT tests.doit_echouer($q$UPDATE app.demandes_site SET statut = 'sans_suite', motif = 'ok' WHERE telephone = '+2250712000001'$q$,
                          'demandes_site_motif');
INSERT INTO app.clients (id, type, nom, telephone, email, commune)
VALUES ('20000000-0000-4000-8000-000000000701', 'particulier', 'Awa Koné', '+2250712000001', 'awa@exemple.ci', 'Yopougon');
INSERT INTO app.devis (id, client_id, branche, origine, description) VALUES
  ('60000000-0000-4000-8000-000000000701', '20000000-0000-4000-8000-000000000701', 'automobile', 'site', 'Toyota Corolla 2019'),
  ('60000000-0000-4000-8000-000000000702', '20000000-0000-4000-8000-000000000701', 'automobile', 'agence', 'Saisi au guichet');
SELECT tests.doit_echouer($q$UPDATE app.demandes_site SET statut = 'convertie', client_id = '20000000-0000-4000-8000-000000000701',
  devis_id = '60000000-0000-4000-8000-000000000702' WHERE telephone = '+2250712000001'$q$, 'venir du site');
SELECT tests.doit_echouer($q$UPDATE app.demandes_site SET statut = 'convertie', client_id = '20000000-0000-4000-8000-000000000701'
  WHERE telephone = '+2250712000001'$q$, 'Le devis doit concerner');
UPDATE app.demandes_site SET statut = 'convertie', client_id = '20000000-0000-4000-8000-000000000701',
  devis_id = '60000000-0000-4000-8000-000000000701' WHERE telephone = '+2250712000001';
SELECT tests.verifier((SELECT statut = 'convertie' AND traitee_par = '10000000-0000-4000-8000-000000000004'
                              AND traitee_le > now() - interval '1 minute'
                       FROM app.demandes_site WHERE telephone = '+2250712000001'),
                      'demande convertie, avec le nom et l''heure de la personne qui l''a traitée');
SELECT tests.doit_echouer($q$UPDATE app.demandes_site SET statut = 'sans_suite', motif = 'Changement d''avis'
  WHERE telephone = '+2250712000001'$q$, 'déjà été traitée');
COMMIT;

-- Classement sans suite par le gérant, avec un motif
BEGIN;
SET LOCAL ROLE dbs_api;
SELECT set_config('app.utilisateur_id', '10000000-0000-4000-8000-000000000001', true);  -- gérant
UPDATE app.demandes_site SET statut = 'sans_suite', motif = 'Numéro injoignable après trois appels'
WHERE telephone = '+2250712000002';
SELECT tests.verifier((SELECT statut = 'sans_suite' AND client_id IS NULL AND traitee_par = '10000000-0000-4000-8000-000000000001'
                       FROM app.demandes_site WHERE telephone = '+2250712000002'), 'demande classée sans suite, motif gardé');
SELECT tests.doit_echouer($q$DELETE FROM app.demandes_site$q$, 'permission denied');
COMMIT;

-- Même le propriétaire de la base ne réécrit ni ne supprime une demande ou une pièce
SELECT tests.doit_echouer($q$UPDATE app.demandes_site SET besoin = 'Réécrit' WHERE telephone = '+2250712000001'$q$, 'ne se modifie pas');
SELECT tests.doit_echouer($q$DELETE FROM app.demandes_site WHERE telephone = '+2250712000002'$q$, 'ne se supprime pas');
SELECT tests.doit_echouer($q$UPDATE app.pieces_demandes_site SET type_contenu = 'image/png'$q$, 'ne se modifie pas');
SELECT tests.doit_echouer($q$DELETE FROM app.pieces_demandes_site$q$, 'ne se modifie pas');

SELECT tests.verifier((SELECT count(*) FROM audit.journal WHERE table_nom = 'app.demandes_site' AND utilisateur_id IS NULL) >= 2
                      AND (SELECT count(*) FROM audit.journal WHERE table_nom = 'app.demandes_site' AND operation = 'UPDATE') = 2,
                      'réception (sans utilisateur) et traitements consignés au journal d''audit');
SELECT tests.verifier(NOT EXISTS (SELECT 1 FROM audit.journal WHERE table_nom = 'app.pieces_demandes_site'),
                      'le fichier n''est pas recopié dans le journal d''audit');
SELECT tests.verifier((SELECT premiere_anomalie IS NULL FROM audit.verifier_chaine()), 'journal d''audit toujours intègre');

\echo
\echo 'Tests des demandes reçues par le site passés.'
