#!/usr/bin/env bash
# Première installation de la base (tâche 11) : rôles, base et mots de passe des trois comptes de connexion.
# Lancé une fois par l'outil « initialisation » de compose.yml, avec le superutilisateur du serveur PostgreSQL
# (ou le compte d'administration de la base gérée). Relançable sans risque : il ne fait que ce qui manque, et
# remet les mots de passe donnés.
set -euo pipefail
: "${BASE:?}" "${PROPRIETAIRE_MOT_DE_PASSE_BASE:?}" "${APPLICATION_MOT_DE_PASSE_BASE:?}" "${SAUVEGARDE_MOT_DE_PASSE_BASE:?}"
for mot in "$PROPRIETAIRE_MOT_DE_PASSE_BASE" "$APPLICATION_MOT_DE_PASSE_BASE" "$SAUVEGARDE_MOT_DE_PASSE_BASE"; do
  if (( ${#mot} < 24 )); then
    echo "Chaque mot de passe de la base doit compter au moins 24 caractères (openssl rand -hex 32)" >&2
    exit 1
  fi
done
until pg_isready -q; do sleep 1; done
psql -X -q -v ON_ERROR_STOP=1 -v base="$BASE" -f /database/initialisation/01_roles_et_base.sql
# Les mots de passe passent par des variables psql : ils n'apparaissent pas dans la liste des processus, et le
# serveur n'en garde que l'empreinte SCRAM. (N'activez pas la journalisation des requêtes, log_statement, pendant
# cette étape : elle les écrirait en clair.)
psql -X -q -v ON_ERROR_STOP=1 -v proprietaire="$PROPRIETAIRE_MOT_DE_PASSE_BASE" -v application="$APPLICATION_MOT_DE_PASSE_BASE" \
  -v sauvegarde="$SAUVEGARDE_MOT_DE_PASSE_BASE" <<'SQL'
SET password_encryption = 'scram-sha-256';
ALTER ROLE dbs_proprietaire PASSWORD :'proprietaire';
ALTER ROLE dbs_application PASSWORD :'application';
ALTER ROLE dbs_sauvegarde PASSWORD :'sauvegarde';
SQL
echo "Base « $BASE » prête : lancez maintenant les migrations (outil « migrations »)."
