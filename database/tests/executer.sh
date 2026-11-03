#!/usr/bin/env bash
# Crée une base neuve, y applique les migrations, puis lance les tests.
#
# Variables : PGHOST, PGPORT et un superutilisateur dans PGUSER (postgres par défaut).
# Le serveur doit être un serveur de test : la base « dbs_tests » est supprimée et recréée.
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=… ./database/tests/executer.sh
set -euo pipefail

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${BASE_TESTS:-dbs_tests}"
SUPER="${PGUSER:-postgres}"

psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d postgres -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE)"
psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d postgres -v base="$BASE" -f "$RACINE/initialisation/01_roles_et_base.sql" >/dev/null

# Les migrations tournent avec le compte propriétaire, sans privilège de superutilisateur,
# comme en production. En test, il reçoit un mot de passe jetable.
MDP_TEST="test-$(date +%s)-$RANDOM"
psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d postgres -c "ALTER ROLE dbs_proprietaire PASSWORD '$MDP_TEST'"
PGUSER=dbs_proprietaire PGPASSWORD="$MDP_TEST" PGDATABASE="$BASE" "$RACINE/migrer.sh"

for fichier in "$RACINE"/tests/[0-9]*.sql; do
  echo "== $(basename "$fichier")"
  psql -X -q -v ON_ERROR_STOP=1 -o /dev/null -U "$SUPER" -d "$BASE" -f "$fichier" 2>&1 \
    | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR|WARNING):  //'
done
