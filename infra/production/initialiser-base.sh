#!/usr/bin/env bash
# Premier démarrage de la base locale (compose.base-locale.yml) : lancé une seule fois par l'image PostgreSQL,
# quand son volume est vide. Crée les comptes et la base avec les scripts du dépôt, puis donne aux deux comptes qui
# se connectent les mots de passe de .env (MDP_PROPRIETAIRE, MDP_APPLICATION). Rien d'autre : le schéma est appliqué
# par le service « migrations », le premier gérant est créé à la main (mise-en-service.md).
set -euo pipefail
: "${MDP_PROPRIETAIRE:?}" "${MDP_APPLICATION:?}"
psql -X -q -v ON_ERROR_STOP=1 --username postgres -d postgres -v base=dbs -f /depot/database/initialisation/01_roles_et_base.sql
# Mots de passe passés en variables psql (jamais interpolés dans le texte de la requête)
psql -X -q -v ON_ERROR_STOP=1 --username postgres -d postgres -v mdp_proprietaire="$MDP_PROPRIETAIRE" -v mdp_application="$MDP_APPLICATION" <<'SQL'
ALTER ROLE dbs_proprietaire PASSWORD :'mdp_proprietaire';
ALTER ROLE dbs_application PASSWORD :'mdp_application';
SQL
echo "Comptes et base « dbs » créés."
