#!/usr/bin/env bash
# Applique les migrations de database/migrations dans l'ordre, une seule fois chacune.
#
# Connexion : variables standard de PostgreSQL (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
# ou fichier ~/.pgpass), avec le compte dbs_proprietaire. Jamais avec le compte de l'application.
#
# Une migration déjà appliquée ne doit plus jamais être modifiée : son empreinte SHA-256 est
# enregistrée et le script s'arrête si le fichier a changé. Pour corriger, écrivez une nouvelle migration.
set -euo pipefail

DOSSIER="$(cd "$(dirname "$0")" && pwd)/migrations"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" <<'SQL'
SET client_min_messages = warning;
CREATE SCHEMA IF NOT EXISTS migrations;
REVOKE ALL ON SCHEMA migrations FROM PUBLIC;
CREATE TABLE IF NOT EXISTS migrations.appliquees (
  version       text PRIMARY KEY,
  empreinte     text NOT NULL,
  appliquee_le  timestamptz NOT NULL DEFAULT now()
);
SQL

for fichier in "$DOSSIER"/*.sql; do
  version="$(basename "$fichier" .sql)"
  if [[ ! "$version" =~ ^[0-9]{4}_[a-z0-9_]+$ ]]; then
    echo "Nom de migration invalide : $version (attendu : 0003_description_courte.sql)" >&2
    exit 1
  fi
  empreinte="$(sha256sum "$fichier" | cut -d' ' -f1)"
  connue="$("${PSQL[@]}" -At -c "SELECT empreinte FROM migrations.appliquees WHERE version = '$version'")"

  if [[ -z "$connue" ]]; then
    echo "→ $version"
    "${PSQL[@]}" --single-transaction -f "$fichier" \
      -c "INSERT INTO migrations.appliquees (version, empreinte) VALUES ('$version', '$empreinte')"
  elif [[ "$connue" != "$empreinte" ]]; then
    echo "La migration $version a été modifiée après avoir été appliquée. Écrivez une nouvelle migration." >&2
    exit 1
  fi
done
echo "Base à jour."
