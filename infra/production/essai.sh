#!/usr/bin/env bash
# Essai de bout en bout de la pile de production (tâche 11) : construit les images, prépare une base neuve avec les
# outils de production (initialisation, migrations), démarre tout, puis vérifie depuis l'extérieur :
#   · HTTPS et les en-têtes de sécurité de la gestion et de l'espace client ;
#   · l'API derrière /api, et l'application monopage (une adresse inconnue rend la page d'entrée) ;
#   · la base et l'API ne sont joignables d'aucun port du serveur ;
#   · le premier gérant reçoit son mot de passe provisoire, comme le décrit infra/production/README.md ;
#   · une sauvegarde chiffrée réussit et s'inscrit dans le journal d'exploitation ;
#   · le test de restauration mensuel la restaure, vérifie la chaîne d'audit, et son résultat s'inscrit depuis le
#     serveur.
# Tout est fictif et jetable : réglages tirés au hasard, volumes supprimés à la fin.
#   ./infra/production/essai.sh            (ESSAI_SANS_CONSTRUCTION=oui pour réutiliser des images déjà construites)
set -euo pipefail
cd "$(dirname "$0")"

compose=(docker compose -p dbs-essai -f compose.yml -f compose.essai.yml)
alea() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | cut -c1-32; }
command -v age-keygen >/dev/null || { echo "Installez age (apt install age) : il fabrique la clé jetable des sauvegardes" >&2; exit 1; }
dossier_cle="$(mktemp -d)"
cle_age="$dossier_cle/cle.txt"
# À la fin : tout arrêter et supprimer (les réglages sont encore là pour que Compose les lise), puis les effacer
trap '"${compose[@]}" --profile base-locale --profile outils down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$dossier_cle" .env api.env' EXIT

[[ -e .env || -e api.env ]] && { echo "infra/production/.env ou api.env existe déjà : l'essai ne les écrase pas" >&2; exit 1; }
age-keygen -o "$cle_age" 2>/dev/null
# Clé jetable, lue par le compte postgres du conteneur de sauvegarde pendant le test de restauration
chmod 755 "$dossier_cle" && chmod 644 "$cle_age"
mdp_application="$(alea)"
mdp_proprietaire="$(alea)"
mdp_super="$(alea)"
cat > .env <<VARS
DOMAINE_GESTION=gestion.localhost
DOMAINE_CLIENT=client.localhost
ACME_EMAIL=essai@exemple.ci
POSTGRES_PASSWORD=$mdp_super
PROPRIETAIRE_MOT_DE_PASSE_BASE=$mdp_proprietaire
APPLICATION_MOT_DE_PASSE_BASE=$mdp_application
SAUVEGARDE_MOT_DE_PASSE_BASE=$(alea)
SAUVEGARDE_CLE_PUBLIQUE=$(sed -n 's/^# public key: //p' "$cle_age")
VERSION=essai
VARS
cat > api.env <<VARS
DATABASE_URL=postgresql://dbs_application:$mdp_application@base:5432/dbs
CLE_CHIFFREMENT_DONNEES=$(head -c 32 /dev/urandom | base64)
URL_BACK_OFFICE=https://gestion.localhost
LECTURE_PRESTATAIRE=local
VARS
chmod 600 .env api.env

[[ "${ESSAI_SANS_CONSTRUCTION:-non}" == "oui" ]] || "${compose[@]}" --profile base-locale build
"${compose[@]}" --profile base-locale up -d --wait base
"${compose[@]}" --profile outils run --rm initialisation
"${compose[@]}" --profile outils run --rm migrations
"${compose[@]}" --profile base-locale up -d --wait web api clamav sauvegarde \
  || { "${compose[@]}" logs --tail 60 api clamav web sauvegarde; exit 1; }

echec=0
# verifier LIBELLÉ CONDITION [SORTIE À AFFICHER EN CAS D'ÉCHEC]
verifier() { if eval "$2"; then echo "✓ $1"; else echo "✗ $1"; echec=1; if [[ -n "${3:-}" ]]; then echo "$3"; fi; fi; }
requete() { curl -sk --resolve "$1:8443:127.0.0.1" "https://$1:8443$2" "${@:3}"; }
entetes="$(requete gestion.localhost / -D - -o /dev/null)"
verifier "la gestion répond en HTTPS" '[[ "$entetes" == *"HTTP/2 200"* ]]'
verifier "politique de sécurité du contenu stricte" '[[ "$entetes" == *"default-src '"'"'none'"'"'; script-src '"'"'self'"'"'"* ]]'
verifier "HSTS, nosniff, pas d'intégration dans un cadre" '[[ "$entetes" == *"strict-transport-security: max-age=31536000"* && "$entetes" == *"x-content-type-options: nosniff"* && "$entetes" == *"x-frame-options: DENY"* ]]'
verifier "le serveur ne dit pas son nom" '[[ "$entetes" != *"server: Caddy"* ]]'
verifier "l'API répond derrière /api" '[[ "$(requete gestion.localhost /api/sante)" == *"\"statut\":\"ok\""* ]]'
verifier "une adresse de l'application rend la page d'entrée" '[[ "$(requete gestion.localhost /clients/123 -o /dev/null -w "%{http_code} %{content_type}")" == "200 text/html"* ]]'
verifier "l'espace client répond aussi, avec son API" '[[ "$(requete client.localhost /api/sante)" == *"\"statut\":\"ok\""* ]]'
verifier "une session inventée est refusée" '[[ "$(requete gestion.localhost /api/clients -o /dev/null -w "%{http_code}")" == "401" ]]'
verifier "ni la base ni l'API n'ont de port ouvert sur le serveur" '! "${compose[@]}" ps --format "{{.Ports}}" base api | grep -q "0.0.0.0"'
verifier "la base n'a pas accès à Internet" '! "${compose[@]}" exec -T base sh -c "wget -q -T 5 -O /dev/null http://example.com" 2>/dev/null'
sql() { "${compose[@]}" exec -T base psql -U postgres -d dbs -Atc "$1"; }

# Premier gérant (README, étape 6)
"${compose[@]}" --profile outils run --rm --entrypoint psql migrations -X -q -v ON_ERROR_STOP=1 \
  -v email=gerant.essai@exemple.ci -v nom="Gérant de l'essai" -f /database/initialisation/02_premier_gerant.sql >/dev/null
premier_acces="$("${compose[@]}" run --rm --no-deps \
  -e DATABASE_URL_PROPRIETAIRE="postgresql://dbs_proprietaire:$mdp_proprietaire@base:5432/dbs" \
  api node apps/api/dist/outils/premier-acces.js gerant.essai@exemple.ci 2>&1 || true)"
verifier "le premier gérant reçoit un mot de passe provisoire" '[[ "$premier_acces" == *"Mot de passe provisoire (affiché une seule fois) : "* ]]' \
  "$premier_acces"

# Sauvegarde de la nuit, lancée à la main
sortie="$("${compose[@]}" exec -T sauvegarde sauvegarder.sh 2>&1 || true)"
verifier "une sauvegarde chiffrée s'inscrit dans le journal d'exploitation" \
  '[[ "$(sql "SELECT reussie AND NOT audit_raccourci AND anomalie_audit IS NULL FROM exploitation.sauvegardes ORDER BY id DESC LIMIT 1")" == "t" ]]' \
  "$sortie"

# Test de restauration (README des sauvegardes) : ici dans l'image de sauvegarde, avec le serveur de l'essai comme
# serveur de test ; en vrai, sur un autre poste, avec la clé privée qui ne va jamais sur le serveur
fichier="$(sql "SELECT fichier FROM exploitation.sauvegardes WHERE reussie ORDER BY id DESC LIMIT 1")"
sortie="$("${compose[@]}" run --rm --no-deps -v "$(cd ../.. && pwd):/depot:ro" -v "$dossier_cle:/cle:ro" \
  -e PGUSER=postgres -e PGPASSWORD="$mdp_super" -e SAUVEGARDE_CLE_PRIVEE_FICHIER=/cle/cle.txt -e EFFECTUE_PAR="Essai automatique" \
  --entrypoint /depot/infra/sauvegardes/restaurer-et-verifier.sh sauvegarde "/sauvegardes/$fichier" 2>&1 || true)"
sortie+=$'\n'"$("${compose[@]}" exec -T sauvegarde cat "/sauvegardes/$fichier.resultat" 2>&1 \
  | "${compose[@]}" exec -T sauvegarde inscrire-test-restauration.sh 2>&1 || true)"
verifier "le test de restauration réussit, chaîne d'audit intacte, et s'inscrit depuis le serveur" \
  '[[ "$(sql "SELECT reussi AND chaine_audit_intacte AND (totaux ->> '"'"'journal_audit'"'"')::int > 0 FROM exploitation.tests_restauration ORDER BY id DESC LIMIT 1")" == "t" ]]' \
  "$sortie"
exit "$echec"
