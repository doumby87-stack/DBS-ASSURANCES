#!/usr/bin/env bash
# Essai complet de la production (infra/production), sur une machine de test, jamais sur le serveur de production :
# toute la pile démarre avec la base locale et des domaines en .localhost (certificats internes de Caddy), puis on
# installe le premier gérant comme à la mise en service, et on vérifie :
#   · HTTPS, redirection depuis HTTP, en-têtes de sécurité, pages des deux applications ;
#   · API derrière /api : santé, contrôle d'origine, connexion du premier gérant ;
#   · aucun port ouvert hormis 80 et 443, base sans accès à Internet, API sans privilège et en lecture seule ;
#   · sauvegarde chiffrée et restauration vérifiée, dans le conteneur des sauvegardes.
# Prérequis : Docker avec Compose, curl, ports 80 et 443 libres.
#   infra/tests/production.sh                    construit les images puis teste
#   SANS_CONSTRUCTION=oui infra/tests/production.sh    images déjà construites (dbs-essai-api, -web, -sauvegarde)
set -euo pipefail

RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
PRODUCTION="$RACINE/infra/production"
travail=$(mktemp -d)
PROJET=dbs-essai
GESTION=gestion.localhost
PORTAIL=espace.localhost
compose() {
  docker compose --project-name "$PROJET" --project-directory "$PRODUCTION" --env-file "$travail/.env" \
    -f "$PRODUCTION/compose.yml" -f "$PRODUCTION/compose.base-locale.yml" "$@"
}
nettoyer() {
  if [[ "${GARDER:-non}" != "oui" ]]; then
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$travail"
  fi
}
trap nettoyer EXIT

echecs=0
verifier() {
  if eval "$1"; then echo "✓ $2"; else echo "✗ $2"; echecs=$((echecs + 1)); fi
}

# --- Variables et secrets jetables -------------------------------------------------------------------------
mkdir -p "$travail/secrets"
: >"$travail/secrets/rclone.conf"
hex() { od -An -tx1 -N "$1" /dev/urandom | tr -d ' \n'; }
cat >"$travail/.env" <<ENV
DOMAINE_GESTION=$GESTION
DOMAINE_PORTAIL=$PORTAIL
ADRESSE_ACME=exploitation@dbs-assurances.test
POSTGRES_PASSWORD=$(hex 24)
MDP_PROPRIETAIRE=$(hex 24)
MDP_APPLICATION=$(hex 24)
CLE_CHIFFREMENT_DONNEES=$(head -c 32 /dev/urandom | base64)
VERIFIER_MOTS_DE_PASSE_DIVULGUES=false
DOSSIER_SECRETS=$travail/secrets
ENV

# --- Construction, clé des sauvegardes (générée par l'image des sauvegardes elle-même), démarrage ----------
if [[ "${SANS_CONSTRUCTION:-non}" != "oui" ]]; then
  compose build
fi
docker run --rm --entrypoint age-keygen "$PROJET-sauvegarde" 2>/dev/null >"$travail/secrets/age-identite.txt"
echo "SAUVEGARDE_CLE_PUBLIQUE=$(grep -o 'age1[0-9a-z]*' "$travail/secrets/age-identite.txt" | head -n 1)" >>"$travail/.env"
compose up -d --no-build
echo "Attente de l'API (migrations, puis démarrage)…"
for essai in $(seq 1 90); do
  curl -fsS --max-time 5 --resolve "$GESTION:443:127.0.0.1" -k "https://$GESTION/api/sante" >/dev/null 2>&1 && break
  if [[ $essai -eq 90 ]]; then
    compose ps
    compose logs --no-color migrations api web | tail -n 80
    echo "L'API n'a pas répondu à temps." >&2
    exit 1
  fi
  sleep 2
done

# Autorité interne de Caddy : on vérifie les certificats au lieu de les ignorer
compose cp web:/data/caddy/pki/authorities/local/root.crt "$travail/racine.crt" >/dev/null
https() { curl -sS --max-time 10 --cacert "$travail/racine.crt" --resolve "$GESTION:443:127.0.0.1" --resolve "$PORTAIL:443:127.0.0.1" "$@"; }

echo "== HTTPS et en-têtes"
entetes=$(https -D - -o /dev/null "https://$GESTION/")
verifier 'grep -qi "^HTTP/[0-9.]* 200" <<<"$entetes"' "back-office servi en HTTPS, certificat valide"
verifier 'grep -qi "^strict-transport-security: max-age=31536000; includeSubDomains" <<<"$entetes"' "HSTS"
verifier 'grep -qi "^content-security-policy: default-src '"'"'none'"'"'; script-src '"'"'self'"'"'" <<<"$entetes"' "politique de sécurité du contenu"
verifier 'grep -qi "^x-frame-options: DENY" <<<"$entetes" && grep -qi "^x-content-type-options: nosniff" <<<"$entetes"' "X-Frame-Options et nosniff"
verifier '! grep -qi "^server:" <<<"$entetes" && ! grep -qi "^via:" <<<"$(https -D - -o /dev/null "https://$GESTION/api/sante")"' "aucun nom de logiciel annoncé (Server, Via)"
verifier 'https -o /dev/null -w "%{http_code}" "https://$GESTION/clients/123" | grep -q 200' "routes de l'application servies par index.html"
verifier 'https "https://$PORTAIL/" | grep -q "id=\"racine\""' "espace client servi sur son propre domaine"
redirection=$(curl -sS --max-time 10 --resolve "$GESTION:80:127.0.0.1" -o /dev/null -w "%{http_code} %{redirect_url}" "http://$GESTION/")
verifier '[[ "$redirection" =~ ^30[18]\ https://$GESTION/ ]]' "HTTP redirigé vers HTTPS ($redirection)"

echo "== API"
verifier 'https "https://$GESTION/api/sante" | grep -q "\"statut\":\"ok\""' "santé de l'API et de la base"
verifier '[[ "$(https -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "{}" "https://$GESTION/api/auth/connexion")" == 403 ]]' "requête sans l'origine du back-office refusée"

# Premier gérant, comme à la mise en service (mise-en-service.md)
compose exec -T base psql -X -q -U dbs_proprietaire -d dbs -v email=gerant@dbs-assurances.test -v nom='Gérant ESSAI' \
  -f /depot/database/initialisation/02_premier_gerant.sql >/dev/null
sortie=$(compose run --rm --no-deps -T \
  -e DATABASE_URL_PROPRIETAIRE="postgres://dbs_proprietaire:$(grep ^MDP_PROPRIETAIRE "$travail/.env" | cut -d= -f2)@base:5432/dbs" \
  api node apps/api/dist/outils/premier-acces.js gerant@dbs-assurances.test)
mot_de_passe=$(sed -n 's/^Mot de passe provisoire (affiché une seule fois) : //p' <<<"$sortie")
verifier '[[ -n "$mot_de_passe" ]]' "mot de passe provisoire du premier gérant"
connexion=$(https -H "Origin: https://$GESTION" -H "Content-Type: application/json" \
  -d "{\"email\":\"gerant@dbs-assurances.test\",\"motDePasse\":\"$mot_de_passe\"}" "https://$GESTION/api/auth/connexion")
verifier 'grep -q "configuration_mfa" <<<"$connexion"' "première connexion : configuration du deuxième facteur demandée"

echo "== Isolement"
publies=$(docker ps --filter "label=com.docker.compose.project=$PROJET" --format '{{.Names}} {{.Ports}}' | grep -- "->" || true)
verifier '[[ "$(grep -v -- "-web-" <<<"$publies" | grep -c -- "->" || true)" == 0 ]]' "seul le serveur web publie des ports"
verifier '! grep -E -- "-web-" <<<"$publies" | grep -oE "[0-9]+->" | grep -qvE "^(80|443)->"' "le serveur web ne publie que 80 et 443"
verifier '! compose exec -T base wget -q -T 5 -O /dev/null https://www.google.com 2>/dev/null' "la base n'a aucun accès à Internet"
verifier '[[ "$(compose exec -T api id -u | tr -d "\r")" != 0 ]]' "l'API ne tourne pas en root"
verifier '! compose exec -T api sh -c "touch /app/essai" 2>/dev/null' "le système de fichiers de l'API est en lecture seule"

echo "== Sauvegarde et restauration"
compose exec -T sauvegarde /outils/sauvegardes/sauvegarder.sh
fichier=$(compose exec -T sauvegarde sh -c 'ls -1 /sauvegardes/quotidiennes/dbs-*.dump.age | tail -n 1' | tr -d '\r')
verifier '[[ -n "$fichier" ]]' "sauvegarde chiffrée faite"
verifier 'compose exec -T sauvegarde /outils/sauvegardes/restaurer.sh "$fichier" >/dev/null' "sauvegarde restaurée et vérifiée"
verifier 'compose exec -T sauvegarde tail -n 1 /sauvegardes/registre-restaurations.log | grep -q " OK "' "test noté au registre des restaurations"
# Les domaines .localhost ne désignent pas le serveur web depuis l'intérieur d'un conteneur : contrôle de l'API interne
verifier 'compose exec -T -e DOMAINE_GESTION= -e DOMAINE_PORTAIL= sauvegarde /outils/surveillance/controler.sh rapide >/dev/null 2>&1' "surveillance : API joignable, sans alerte"

echo
if [[ $echecs -gt 0 ]]; then
  compose logs --no-color api web | tail -n 40
  echo "$echecs vérification(s) en échec."
  exit 1
fi
echo "Production vérifiée : HTTPS, en-têtes, API, premier gérant, isolement, sauvegarde et restauration."
