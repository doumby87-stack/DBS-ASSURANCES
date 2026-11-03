-- =====================================================================
-- Création du premier gérant, après les migrations
--
-- Seul dbs_proprietaire peut le faire (personne n'existe encore pour valider) :
--   psql -U dbs_proprietaire -d dbs -v email=prenom.nom@exemple.ci -v nom='Prénom NOM' \
--        -f database/initialisation/02_premier_gerant.sql
-- Ensuite, tous les comptes sont créés depuis l'application par un gérant, et tracés au journal d'audit.
-- =====================================================================
\set ON_ERROR_STOP on

INSERT INTO app.utilisateurs (email, nom, role)
SELECT lower(:'email'), :'nom', 'gerant'
WHERE NOT EXISTS (SELECT 1 FROM app.utilisateurs WHERE role = 'gerant')
RETURNING id, email, role;
