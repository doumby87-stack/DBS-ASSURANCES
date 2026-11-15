#!/usr/bin/env bash
# Restaure une sauvegarde chiffrée et la vérifie (docs/securite/sauvegardes-et-reprise.md) :
#   restaurer.sh FICHIER.dump.age [BASE_CIBLE] [--conserver] [--remplacer]
# Par défaut, la base « dbs_essai_restauration » est créée sur le même serveur, vérifiée, puis supprimée (test
# mensuel). Avec --conserver, elle reste en place (reprise après incident : mise-en-service.md, « Restaurer »).
# Une base existante dont le nom ne commence pas par « dbs_essai » n'est jamais écrasée sans --remplacer : une
# erreur de commande sur le serveur en service ne doit pas effacer la base de production.
# Le serveur cible doit avoir les rôles de la base (database/initialisation/01_roles_et_base.sql).
# Vérifications :
#   · empreinte SHA-256 du fichier, déchiffrement, restauration sans aucune erreur ;
#   · réglages de la base reposés comme à l'installation (droits de connexion, heure d'Abidjan) ;
#   · audit.verifier_chaine() sans anomalie, et l'empreinte notée hors de la base au moment de cette sauvegarde
#     présente dans le journal restauré (la chaîne n'a pas été tronquée) ;
#   · quelques totaux, notés au registre des tests (registre-restaurations.log) avec la durée.
# Variables : DATABASE_URL_SAUVEGARDE (administrateur), SAUVEGARDE_CLE_PRIVEE (/run/secrets/age_identite par défaut),
# SAUVEGARDE_DOSSIER (/sauvegardes par défaut : registre et empreintes notées).
set -euo pipefail

fichier=""
base=dbs_essai_restauration
conserver=non
remplacer=non
for argument in "$@"; do
  case "$argument" in
    --conserver) conserver=oui ;;
    --remplacer) remplacer=oui ;;
    *) if [[ -z "$fichier" ]]; then fichier="$argument"; else base="$argument"; fi ;;
  esac
done
[[ -n "$fichier" && -f "$fichier" ]] || { echo "Usage : restaurer.sh FICHIER.dump.age [BASE_CIBLE] [--conserver] [--remplacer]" >&2; exit 1; }
[[ "$base" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "Nom de base invalide : $base" >&2; exit 1; }
: "${DATABASE_URL_SAUVEGARDE:?compte administrateur de la base}"
identite="${SAUVEGARDE_CLE_PRIVEE:-/run/secrets/age_identite}"
DOSSIER="${SAUVEGARDE_DOSSIER:-/sauvegardes}"
mkdir -p "$DOSSIER"
registre="$DOSSIER/registre-restaurations.log"
nom=$(basename "$fichier")
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

debut=$(date +%s)
resultat="ÉCHEC"
etape="démarrage"
details=""
noter() {
  [[ "$resultat" == "OK" ]] || details="étape en échec : $etape"
  printf '%s %s %s %s %ss %s\n' "$(date -u +%Y%m%dT%H%M%SZ)" "$nom" "$base" "$resultat" "$(( $(date +%s) - debut ))" "$details" >>"$registre"
}
trap noter EXIT

# Adresse de la base cible : même serveur et même compte, autre nom de base (paramètres ?… conservés)
sans_parametres="${DATABASE_URL_SAUVEGARDE%%\?*}"
parametres="${DATABASE_URL_SAUVEGARDE#"$sans_parametres"}"
cible="${sans_parametres%/*}/$base$parametres"

etape="base cible libre"
if [[ "$base" != dbs_essai* && "$remplacer" != oui ]] \
   && [[ -n "$(psql "$DATABASE_URL_SAUVEGARDE" -X -At -c "SELECT 1 FROM pg_database WHERE datname = '$base'")" ]]; then
  echo "La base $base existe déjà : elle ne sera écrasée qu'avec --remplacer (reprise après incident)." >&2
  exit 1
fi

etape="empreinte du fichier"
echo "1. $etape"
(cd "$(dirname "$fichier")" && sha256sum -c "$nom.sha256" >/dev/null)

etape="création de la base $base"
echo "2. $etape"
"${PSQL[@]}" "$DATABASE_URL_SAUVEGARDE" \
  -c "DROP DATABASE IF EXISTS $base WITH (FORCE)" \
  -c "CREATE DATABASE $base OWNER dbs_proprietaire ENCODING 'UTF8'" \
  -c "REVOKE ALL ON DATABASE $base FROM PUBLIC" \
  -c "GRANT CONNECT ON DATABASE $base TO dbs_api, dbs_audit" \
  -c "ALTER DATABASE $base SET timezone TO 'Africa/Abidjan'"

etape="déchiffrement et restauration"
echo "3. $etape"
age -d -i "$identite" "$fichier" | pg_restore -d "$cible" --exit-on-error

etape="journal d'audit"
echo "4. $etape"
read -r lignes anomalie empreinte <<<"$(psql "$cible" -X -At -F ' ' -v ON_ERROR_STOP=1 \
  -c "SELECT lignes_verifiees, coalesce(premiere_anomalie::text, 'aucune'), coalesce(derniere_empreinte, 'vide') FROM audit.verifier_chaine()")"
if [[ "$anomalie" != "aucune" ]]; then
  etape="journal d'audit : anomalie à la ligne $anomalie"
  exit 1
fi
# L'empreinte notée juste avant l'export doit figurer dans le journal restauré (des lignes ont pu s'ajouter après)
horodatage=$(sed -nE 's/^dbs-([0-9]{8}T[0-9]{6}Z)\.dump\.age$/\1/p' <<<"$nom")
notee=$(awk -v h="$horodatage" '$1 == h { print $4 }' "$DOSSIER/empreintes/journal-audit.log" 2>/dev/null | tail -n 1)
if [[ -n "$notee" && "$notee" != "vide" ]]; then
  [[ "$notee" =~ ^[0-9a-f]{64}$ ]] || { etape="empreinte notée illisible"; exit 1; }
  presente=$(psql "$cible" -X -At -c "SELECT count(*) FROM audit.journal WHERE empreinte = decode('$notee', 'hex')")
  if [[ "$presente" != "1" ]]; then
    etape="journal d'audit : l'empreinte notée à la sauvegarde ($notee) est absente"
    exit 1
  fi
fi

etape="totaux"
echo "5. $etape"
read -r clients contrats encaisse <<<"$(psql "$cible" -X -At -F ' ' -v ON_ERROR_STOP=1 -c "SELECT
  (SELECT count(*) FROM app.clients), (SELECT count(*) FROM app.contrats),
  (SELECT coalesce(sum(montant), 0) FROM app.encaissements WHERE encaisse_le >= date_trunc('month', now()))")"
fuseau=$(psql "$cible" -X -At -c "SHOW timezone")
details="audit : $lignes lignes ; clients : $clients ; contrats : $contrats ; encaissé ce mois : $encaisse F CFA ; heure : $fuseau"
resultat="OK"
echo "Restauration vérifiée : $details"

if [[ "$conserver" == "non" ]]; then
  "${PSQL[@]}" "$DATABASE_URL_SAUVEGARDE" -c "DROP DATABASE $base WITH (FORCE)"
  echo "Base d'essai supprimée."
else
  echo "Base $base conservée."
fi
