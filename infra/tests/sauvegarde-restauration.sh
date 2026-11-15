#!/usr/bin/env bash
# Test des sauvegardes, de la restauration et de la surveillance (infra/sauvegardes, infra/surveillance), contre
# une base de test déjà migrée et remplie (database/tests/executer.sh, base « dbs_tests »).
#   PGHOST=… PGPORT=… PGUSER=postgres PGPASSWORD=… infra/tests/sauvegarde-restauration.sh
# Dans le conteneur des sauvegardes (outils en /outils) : OUTILS=/outils. Outils nécessaires : psql, pg_dump,
# pg_restore (version du serveur), age, age-keygen, sha256sum, curl, flock.
# Le serveur doit être un serveur DE TEST : la base « dbs_essai_restauration » y est créée puis supprimée.
set -euo pipefail

OUTILS="${OUTILS:-$(cd "$(dirname "$0")/.." && pwd)}"
BASE="${BASE_TESTS:-dbs_tests}"
travail=$(mktemp -d)
trap 'rm -rf "$travail"' EXIT

encoder() { printf '%s' "$1" | od -An -tx1 | tr -d ' \n' | sed 's/../%&/g'; }
adresse="postgres://$(encoder "${PGUSER:-postgres}")"
[[ -n "${PGPASSWORD:-}" ]] && adresse+=":$(encoder "$PGPASSWORD")"
adresse+="@${PGHOST:-localhost}:${PGPORT:-5432}/$BASE"
export DATABASE_URL_SAUVEGARDE="$adresse"
export SAUVEGARDE_DOSSIER="$travail/sauvegardes"
export SAUVEGARDE_CLE_PRIVEE="$travail/age-identite.txt"
unset SAUVEGARDE_DISTANT ALERTE_COMMANDE

echecs=0
verifier() {
  if eval "$1"; then echo "✓ $2"; else echo "✗ $2"; echecs=$((echecs + 1)); fi
}

age-keygen -o "$SAUVEGARDE_CLE_PRIVEE" 2>/dev/null
export SAUVEGARDE_CLE_PUBLIQUE
SAUVEGARDE_CLE_PUBLIQUE=$(age-keygen -y "$SAUVEGARDE_CLE_PRIVEE")

echo "== Sauvegarde"
"$OUTILS/sauvegardes/sauvegarder.sh"
fichier=$(ls -1 "$SAUVEGARDE_DOSSIER"/quotidiennes/dbs-*.dump.age | tail -n 1)
verifier '[[ -f "$fichier" && -f "$fichier.sha256" ]]' "export chiffré et son empreinte"
verifier '[[ -f "$SAUVEGARDE_DOSSIER/mensuelles/$(basename "$fichier")" ]]' "première sauvegarde du mois gardée aussi comme mensuelle"
verifier '[[ "$(head -c 5 "$fichier")" != "PGDMP" ]] && head -c 30 "$fichier" | grep -q "age-encryption.org"' "le fichier est chiffré (pas un export PostgreSQL lisible)"
verifier '! age -d -i <(age-keygen 2>/dev/null) "$fichier" >/dev/null 2>&1' "illisible avec une autre clé"
verifier 'grep -q "\"ok\":true" "$SAUVEGARDE_DOSSIER/derniere.json"' "état de la dernière sauvegarde : réussie"
verifier '[[ $(wc -l <"$SAUVEGARDE_DOSSIER/empreintes/journal-audit.log") -eq 1 ]]' "empreinte du journal d'audit notée hors de la base"

echo "== Restauration"
"$OUTILS/sauvegardes/restaurer.sh" "$fichier"
verifier 'tail -n 1 "$SAUVEGARDE_DOSSIER/registre-restaurations.log" | grep -q " OK "' "restauration vérifiée et notée au registre"
verifier '[[ -z "$(psql "$DATABASE_URL_SAUVEGARDE" -X -At -c "SELECT 1 FROM pg_database WHERE datname = '"'"'dbs_essai_restauration'"'"'")" ]]' "base d'essai supprimée après le test"

"$OUTILS/sauvegardes/restaurer.sh" "$fichier" dbs_essai_restauration --conserver >/dev/null
cible="${DATABASE_URL_SAUVEGARDE%/*}/dbs_essai_restauration"
verifier '[[ "$(psql "$cible" -X -At -c "SHOW timezone")" == "Africa/Abidjan" ]]' "heure d'Abidjan reposée sur la base restaurée"
verifier '[[ "$(psql "$cible" -X -At -c "SELECT count(*) FROM app.clients")" == "$(psql "$DATABASE_URL_SAUVEGARDE" -X -At -c "SELECT count(*) FROM app.clients")" ]]' "mêmes clients que la base d'origine"
verifier '[[ "$(psql "$cible" -X -At -c "SELECT tableowner FROM pg_tables WHERE schemaname = '"'"'app'"'"' AND tablename = '"'"'contrats'"'"'")" == "dbs_proprietaire" ]]' "tables rendues à leur propriétaire"
verifier '[[ "$(psql "$cible" -X -At -c "SELECT relrowsecurity FROM pg_class WHERE oid = '"'"'app.clients'"'"'::regclass")" == "t" ]]' "sécurité ligne par ligne restaurée"
verifier '[[ "$(psql "$cible" -X -At -c "SELECT has_database_privilege('"'"'dbs_api'"'"', current_database(), '"'"'CONNECT'"'"')")" == "t" ]]' "droit de connexion de l'application reposé"

echo "== Refus attendus"
verifier '! "$OUTILS/sauvegardes/restaurer.sh" "$fichier" "$BASE" --conserver >/dev/null 2>&1' "une base existante n'est pas écrasée sans --remplacer"
verifier '[[ "$(psql "$DATABASE_URL_SAUVEGARDE" -X -At -c "SELECT count(*) > 0 FROM app.clients")" == t ]]' "la base d'origine est intacte"
cp "$fichier" "$travail/altere.dump.age"
(cd "$(dirname "$fichier")" && sed "s/$(basename "$fichier")/altere.dump.age/" "$(basename "$fichier").sha256") >"$travail/altere.dump.age.sha256"
printf '\x00' | dd of="$travail/altere.dump.age" bs=1 seek=200 conv=notrunc 2>/dev/null
verifier '! "$OUTILS/sauvegardes/restaurer.sh" "$travail/altere.dump.age" >/dev/null 2>&1' "un fichier altéré est refusé"
verifier 'tail -n 1 "$SAUVEGARDE_DOSSIER/registre-restaurations.log" | grep -q "ÉCHEC.*empreinte du fichier"' "et l'échec est noté au registre"

# Journal tronqué : dans la base restaurée (gardée), on supprime la dernière ligne du journal d'audit, sans les
# gardiens (réservé aux tests), puis on en refait une sauvegarde : la restauration ne doit plus retrouver
# l'empreinte notée par la première sauvegarde.
psql "$cible" -X -q -c "SET session_replication_role = replica" -c "DELETE FROM audit.journal WHERE id = (SELECT max(id) FROM audit.journal)"
horodatage=$(basename "$fichier" | sed -E 's/^dbs-(.*)\.dump\.age$/\1/')
tronque="$travail/dbs-$horodatage.dump.age"
pg_dump -d "$cible" --format=custom | age -r "$SAUVEGARDE_CLE_PUBLIQUE" -o "$tronque"
(cd "$travail" && sha256sum "$(basename "$tronque")" >"$(basename "$tronque").sha256")
verifier '! "$OUTILS/sauvegardes/restaurer.sh" "$tronque" dbs_essai_tronque >/dev/null 2>&1' "un journal d'audit tronqué est détecté à la restauration"
verifier 'tail -n 1 "$SAUVEGARDE_DOSSIER/registre-restaurations.log" | grep -q "absente"' "et noté au registre"
psql "$DATABASE_URL_SAUVEGARDE" -X -q -c "DROP DATABASE IF EXISTS dbs_essai_restauration WITH (FORCE)" -c "DROP DATABASE IF EXISTS dbs_essai_tronque WITH (FORCE)"

echo "== Surveillance"
alertes="$travail/alertes.txt"
export ALERTE_COMMANDE="cat >>'$alertes'"
export API_INTERNE="http://127.0.0.1:9"
unset DOMAINE_GESTION DOMAINE_PORTAIL
code=0
"$OUTILS/surveillance/controler.sh" quotidien 2>/dev/null || code=$?
verifier '[[ $code -eq 1 ]]' "API injoignable : le contrôle signale une alerte"
verifier 'grep -q "API injoignable" "$alertes"' "alerte envoyée à la commande prévue"
verifier '! grep -q "sauvegarde\|Journal d.audit" "$alertes"' "sauvegarde du jour et journal d'audit sans alerte"
avant=$(wc -l <"$alertes")
"$OUTILS/surveillance/controler.sh" quotidien >/dev/null 2>&1 || true
verifier '[[ $(wc -l <"$alertes") -eq $avant ]]' "une alerte inchangée n'est pas renvoyée"
echo '{"date":"x","ok":false,"message":"essai"}' >"$SAUVEGARDE_DOSSIER/derniere.json"
"$OUTILS/surveillance/controler.sh" quotidien >/dev/null 2>&1 || true
verifier 'grep -q "Dernière sauvegarde en échec" "$alertes"' "une sauvegarde en échec déclenche une alerte"

echo
if [[ $echecs -gt 0 ]]; then
  echo "$echecs vérification(s) en échec."
  exit 1
fi
echo "Sauvegardes, restauration et surveillance vérifiées."
