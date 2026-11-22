#!/usr/bin/env bash
# Inscrit dans le journal d'exploitation de la production le résultat d'un test de restauration (tâche 11, ADR 0016).
# Le test se fait sur un autre poste (restaurer-et-verifier.sh), qui ne peut pas joindre la base de production :
# il écrit son résultat dans un fichier « …dump.age.resultat », lu ici sur l'entrée standard, depuis le serveur :
#
#   ssh serveur 'cd /opt/dbs && docker compose -f infra/production/compose.yml exec -T sauvegarde inscrire-test-restauration.sh' \
#     < dbs-20261201T020000Z.dump.age.resultat
#
# Connexion : JOURNAL_URL si elle est donnée, sinon PGHOST, PGUSER… (dans le conteneur de sauvegarde : le compte
# dbs_sauvegarde). Les valeurs passent par des variables psql, et la base vérifie chacune.
set -euo pipefail

declare -A v=()
while IFS= read -r ligne || [[ -n "$ligne" ]]; do
  [[ -z "$ligne" ]] && continue
  cle="${ligne%%=*}"
  case "$cle" in
    fichier | reussi | duree | lignes | intacte | totaux | par | remarque) v[$cle]="${ligne#*=}" ;;
    *) echo "Ligne inattendue dans le résultat : ${cle:0:40}" >&2; exit 1 ;;
  esac
done
for cle in fichier reussi duree intacte totaux par; do
  [[ -n "${v[$cle]:-}" ]] || { echo "Valeur manquante dans le résultat : $cle" >&2; exit 1; }
done
[[ "${v[reussi]}" =~ ^(true|false)$ && "${v[intacte]}" =~ ^(true|false)$ && "${v[duree]}" =~ ^[0-9]{1,9}$ \
   && "${v[lignes]:-}" =~ ^[0-9]{0,18}$ ]] || { echo "Résultat mal formé" >&2; exit 1; }

connexion=()
[[ -n "${JOURNAL_URL:-}" ]] && connexion=("$JOURNAL_URL")
psql -X -q -At -v ON_ERROR_STOP=1 "${connexion[@]}" -v fichier="${v[fichier]}" -v reussi="${v[reussi]}" -v duree="${v[duree]}" \
  -v lignes="${v[lignes]:-}" -v intacte="${v[intacte]}" -v totaux="${v[totaux]}" -v par="${v[par]}" \
  -v remarque="${v[remarque]:-}" >/dev/null <<'SQL'
BEGIN READ WRITE;
SELECT exploitation.enregistrer_test_restauration(:'fichier', :'reussi'::boolean, :'duree'::integer, nullif(:'lignes', '')::bigint,
                                                  :'intacte'::boolean, :'totaux'::jsonb, :'par', nullif(:'remarque', ''));
COMMIT;
SQL
echo "Test de restauration de ${v[fichier]} inscrit dans le journal d'exploitation : le back-office l'affiche (page Exploitation)."
