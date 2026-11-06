#!/usr/bin/env bash
# Prépare la base de la démonstration avec les mêmes scripts qu'en production (database/) : rôles, base,
# migrations. Garde la base d'une fois sur l'autre ; la remet à neuf si on le demande (DEMO_REINITIALISER=oui)
# ou si une migration déjà appliquée a changé depuis (version de travail du projet).
#
# Lancé par demo/compose.yml dans le conteneur PostgreSQL (psql et bash y sont), ou par demo/lanceur.mjs.
# Variables : PGHOST, PGPORT, PGUSER (superutilisateur), PGPASSWORD d'un serveur de démonstration ou de test.
# Mots de passe publics : uniquement pour cette démonstration, jamais ailleurs.
set -euo pipefail

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
BASE=dbs_demo
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="-c client_min_messages=warning"

until pg_isready -q; do sleep 1; done

creer() {
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE)"
  "${PSQL[@]}" -d postgres -v base="$BASE" -f "$RACINE/database/initialisation/01_roles_et_base.sql" >/dev/null
  "${PSQL[@]}" -d postgres -c "ALTER ROLE dbs_proprietaire PASSWORD 'demo-proprietaire'"
  "${PSQL[@]}" -d postgres -c "ALTER ROLE dbs_application PASSWORD 'demo-application'"
}

migrer() {
  PGUSER=dbs_proprietaire PGPASSWORD=demo-proprietaire PGDATABASE="$BASE" bash "$RACINE/database/migrer.sh"
}

if [[ "${DEMO_REINITIALISER:-non}" == "oui" ]] \
   || [[ -z "$("${PSQL[@]}" -At -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$BASE'")" ]]; then
  echo "Base de démonstration neuve."
  creer
fi

if ! sortie="$(migrer 2>&1)"; then
  if grep -q "a été modifiée" <<<"$sortie"; then
    echo "Le schéma a changé depuis la dernière démonstration : base remise à neuf."
    creer
    migrer >/dev/null
  else
    echo "$sortie" >&2
    exit 1
  fi
fi
echo "Base de démonstration à jour."
