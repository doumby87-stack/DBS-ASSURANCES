#!/usr/bin/env bash
# Surveillance (infra/surveillance/README.md) : contrôles « rapide » (tous les quarts d'heure) et « quotidien ».
#   controler.sh rapide     API joignable (en interne et par le domaine public), échecs de connexion répétés
#   controler.sh quotidien  + certificats, sauvegarde de la nuit, journal d'audit, exports de la veille,
#                             primes encaissées non reversées à la date limite
# Chaque alerte est écrite sur la sortie d'erreur et envoyée à ALERTE_COMMANDE (texte sur l'entrée standard),
# une seule fois tant qu'elle ne change pas. Code de sortie 1 s'il y a au moins une alerte.
# Variables : DATABASE_URL_SAUVEGARDE, DOMAINE_GESTION, DOMAINE_PORTAIL, ALERTE_COMMANDE, SAUVEGARDE_DOSSIER,
# API_INTERNE (http://api:3000 par défaut).
set -uo pipefail

mode="${1:-rapide}"
: "${DATABASE_URL_SAUVEGARDE:?compte administrateur de la base}"
DOSSIER="${SAUVEGARDE_DOSSIER:-/sauvegardes}"
mkdir -p "$DOSSIER/surveillance"
alertes=()
alerter() { alertes+=("$1"); }
sql() { psql "$DATABASE_URL_SAUVEGARDE" -X -At -F ' ' -c "$1" 2>/dev/null; }

# --- Rapide ---------------------------------------------------------------------------------------------
# API joignable depuis le réseau interne, et par son adresse publique (serveur web et certificat compris)
API_INTERNE="${API_INTERNE:-http://api:3000}"
curl -fsS --max-time 10 "$API_INTERNE/sante" >/dev/null 2>&1 || alerter "API injoignable en interne ($API_INTERNE/sante)"
for domaine in "${DOMAINE_GESTION:-}" "${DOMAINE_PORTAIL:-}"; do
  [[ -n "$domaine" ]] || continue
  curl -fsS --max-time 15 "https://$domaine/api/sante" >/dev/null 2>&1 || alerter "https://$domaine/api/sante ne répond pas"
done
# Échecs de connexion répétés : 5 en 15 minutes sur un même compte
echecs=$(sql "SELECT string_agg(coalesce(email, '?') || ' (' || n || ')', ', ') FROM (
  SELECT email, count(*) AS n FROM securite.evenements
  WHERE type IN ('connexion_echouee', 'mfa_echoue') AND horodatage > now() - interval '15 minutes'
  GROUP BY email HAVING count(*) >= 5) e")
[[ -z "$echecs" ]] || alerter "Échecs de connexion répétés : $echecs"

# --- Quotidien --------------------------------------------------------------------------------------------
if [[ "$mode" == "quotidien" ]]; then
  # Certificats : alerte 30 jours avant l'expiration
  for domaine in "${DOMAINE_GESTION:-}" "${DOMAINE_PORTAIL:-}"; do
    [[ -n "$domaine" ]] || continue
    certificat=$(openssl s_client -connect "$domaine:443" -servername "$domaine" </dev/null 2>/dev/null | openssl x509 2>/dev/null)
    if [[ -z "$certificat" ]]; then
      alerter "Certificat de $domaine illisible"
    elif ! printf '%s' "$certificat" | openssl x509 -noout -checkend $((30 * 86400)) >/dev/null; then
      alerter "Certificat de $domaine : expire dans moins de 30 jours"
    fi
  done

  # Sauvegarde de la nuit : faite, réussie, il y a moins de 26 heures
  etat="$DOSSIER/derniere.json"
  if [[ ! -f "$etat" ]]; then
    alerter "Aucune sauvegarde enregistrée"
  else
    age_secondes=$(( $(date +%s) - $(stat -c %Y "$etat") ))
    grep -q '"ok":true' "$etat" || alerter "Dernière sauvegarde en échec : $(cat "$etat")"
    [[ "$age_secondes" -lt $((26 * 3600)) ]] || alerter "Dernière sauvegarde datée de plus de 26 heures"
  fi

  # Journal d'audit : chaîne intègre, et l'empreinte notée la veille toujours présente (sinon des lignes ont été supprimées)
  lecture=$(sql "SELECT lignes_verifiees, coalesce(premiere_anomalie::text, 'aucune'), coalesce(derniere_empreinte, 'vide') FROM audit.verifier_chaine()")
  if [[ -z "$lecture" ]]; then
    alerter "audit.verifier_chaine() injoignable"
  else
    read -r _ anomalie _ <<<"$lecture"
    [[ "$anomalie" == "aucune" ]] || alerter "Journal d'audit : anomalie à la ligne $anomalie (docs/securite/reponse-aux-incidents.md)"
    # Dernière empreinte notée par la sauvegarde de la nuit
    precedente=$(tail -n 1 "$DOSSIER/empreintes/journal-audit.log" 2>/dev/null | awk '{ print $4 }')
    if [[ "$precedente" =~ ^[0-9a-f]{64}$ ]]; then
      presente=$(sql "SELECT 1 FROM audit.journal WHERE empreinte = decode('$precedente', 'hex')")
      [[ "$presente" == "1" ]] || alerter "Journal d'audit : l'empreinte notée par la dernière sauvegarde ($precedente) n'existe plus : des lignes ont-elles été supprimées ?"
    fi
  fi

  # Exports de données de la veille : à signaler au gérant, chaque fois
  exports=$(sql "SELECT count(*) FROM securite.evenements WHERE type = 'export_donnees'
    AND horodatage >= date_trunc('day', now() - interval '1 day') AND horodatage < date_trunc('day', now())")
  [[ "${exports:-0}" == "0" ]] || alerter "Exports de données hier : $exports (à vérifier par le gérant)"

  # Primes encaissées non reversées à la date limite
  retard=$(sql "SELECT count(*) || ' encaissement(s), ' || coalesce(sum(montant), 0) || ' F CFA' FROM app.v_encaissements_a_reverser WHERE en_retard")
  [[ "$retard" == 0* ]] || alerter "Primes non reversées à la date limite : $retard"
fi

# --- Résultat ---------------------------------------------------------------------------------------------
if [[ ${#alertes[@]} -eq 0 ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) contrôle $mode : rien à signaler"
  rm -f "$DOSSIER/surveillance/alertes-$mode.txt"
  exit 0
fi
rapport=$(printf 'DBS-ASSURANCES, contrôle %s du %s :\n' "$mode" "$(date +'%d/%m/%Y %H:%M')"; printf -- '- %s\n' "${alertes[@]}")
echo "$rapport" >&2
# Une alerte identique à la précédente n'est pas renvoyée
memoire="$DOSSIER/surveillance/alertes-$mode.txt"
if [[ -n "${ALERTE_COMMANDE:-}" ]] && ! printf -- '%s\n' "${alertes[@]}" | cmp -s - "$memoire" 2>/dev/null; then
  printf '%s\n' "$rapport" | bash -c "$ALERTE_COMMANDE" || echo "Envoi de l'alerte en échec" >&2
fi
printf -- '%s\n' "${alertes[@]}" >"$memoire"
exit 1
