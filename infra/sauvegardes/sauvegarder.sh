#!/usr/bin/env bash
# Sauvegarde chiffrée de la base de production (tâche 11, ADR 0016).
#
#   1. note la dernière empreinte du journal d'audit ;
#   2. sauvegarde toute la base (pg_dump, format personnalisé) et la chiffre au fil de l'eau avec la CLÉ PUBLIQUE
#      age : rien n'est jamais écrit en clair sur le disque, et le serveur ne peut pas relire ses propres
#      sauvegardes (la clé privée est rangée hors ligne, docs/securite/gestion-des-secrets.md) ;
#   3. envoie le fichier et l'empreinte hors site, si une destination rclone est configurée (stockage en écriture
#      unique, réglé chez le fournisseur) ;
#   4. inscrit le compte rendu dans la base (exploitation.sauvegardes), avec la vérification complète de la
#      chaîne d'audit ; le gérant le voit dans le back-office (page Exploitation) ;
#   5. ne garde en local que les dernières copies.
#
# Variables :
#   PGHOST, PGPORT, PGDATABASE      la base de production
#   PGUSER, PGPASSWORD (ou PGPASSFILE) le compte dbs_sauvegarde, jamais un autre
#   SAUVEGARDE_CLE_PUBLIQUE         clé publique age (age1…)
#   SAUVEGARDE_DOSSIER              dossier des copies locales (défaut : /sauvegardes)
#   SAUVEGARDE_CONSERVATION_JOURS   copies locales gardées (défaut : 7) ; la conservation hors site (30 jours,
#                                   puis 12 mois) se règle chez le fournisseur de stockage
#   SAUVEGARDE_DESTINATION          destination rclone hors site, par exemple « horssite:dbs-sauvegardes »
#                                   (facultatif : sans elle, la sauvegarde reste locale et le back-office le dit)
#   SAUVEGARDE_SIGNAL_URL           facultatif : adresse d'un service de surveillance « battement de cœur », appelée
#                                   seulement quand tout va bien (sauvegarde réussie, copiée hors site, journal
#                                   d'audit intact). Sans signal pendant 26 heures, ce service prévient le gérant
#                                   par e-mail ou SMS (infra/surveillance/README.md)
#
# Code de sortie : 0 si tout va bien ; 1 si la sauvegarde a échoué ; 2 si elle a réussi mais que la chaîne
# d'audit présente une anomalie, ou que ses dernières lignes ont disparu depuis la sauvegarde précédente (à traiter comme un incident : docs/securite/reponse-aux-incidents.md).
set -euo pipefail
umask 077

: "${SAUVEGARDE_CLE_PUBLIQUE:?Clé publique age (SAUVEGARDE_CLE_PUBLIQUE) manquante}"
DOSSIER="${SAUVEGARDE_DOSSIER:-/sauvegardes}"
CONSERVATION="${SAUVEGARDE_CONSERVATION_JOURS:-7}"
DESTINATION="${SAUVEGARDE_DESTINATION:-}"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)

if [[ ! "$SAUVEGARDE_CLE_PUBLIQUE" =~ ^age1[02-9ac-hj-np-z]{58}$ ]]; then
  echo "SAUVEGARDE_CLE_PUBLIQUE doit être une clé publique age (age1…), jamais la clé privée" >&2
  exit 1
fi
if [[ ! "$CONSERVATION" =~ ^[0-9]{1,3}$ ]]; then
  echo "SAUVEGARDE_CONSERVATION_JOURS doit être un nombre de jours" >&2
  exit 1
fi

debut="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
nom="dbs-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
mkdir -p "$DOSSIER"
temporaire="$(mktemp -d "$DOSSIER/.en-cours.XXXXXX")"
trap 'rm -rf "$temporaire"' EXIT

# Compte rendu dans la base : le compte est en lecture seule par défaut, il repasse en écriture pour cette seule
# transaction. Les valeurs passent par des variables psql, jamais collées dans le texte de la requête.
enregistrer() {
  local reussie="$1" fichier="$2" taille="$3" empreinte="$4" hors_site="$5" message="$6"
  "${PSQL[@]}" -F ';' -v debut="$debut" -v reussie="$reussie" -v fichier="$fichier" -v taille="$taille" \
    -v empreinte="$empreinte" -v hors_site="$hors_site" -v message="$message" <<'SQL'
BEGIN READ WRITE;
SELECT coalesce(lignes_audit::text, ''), coalesce(anomalie_audit::text, ''), audit_raccourci
FROM exploitation.enregistrer_sauvegarde(:'debut', :'reussie'::boolean, nullif(:'fichier', ''), nullif(:'taille', '')::bigint,
                                         nullif(:'empreinte', ''), :'hors_site'::boolean, nullif(:'message', ''));
COMMIT;
SQL
}

echec() {
  local message="$1"
  echo "Sauvegarde en échec : $message" >&2
  enregistrer false "" "" "" false "${message:0:500}" >/dev/null || echo "Le compte rendu n'a pas pu être inscrit dans la base" >&2
  exit 1
}

# 1. Dernière empreinte du journal d'audit avant la sauvegarde : le test de restauration vérifiera qu'elle s'y trouve
empreinte_audit="$("${PSQL[@]}" -c "SELECT coalesce(encode(empreinte, 'hex'), '') FROM audit.journal ORDER BY id DESC LIMIT 1")" \
  || echec "lecture du journal d'audit impossible (connexion à la base ?)"

# 2. Sauvegarde chiffrée au fil de l'eau
if ! pg_dump --format=custom --compress=6 --no-password | age --encrypt --recipient "$SAUVEGARDE_CLE_PUBLIQUE" --output "$temporaire/$nom"; then
  echec "pg_dump ou le chiffrement a échoué"
fi
taille="$(stat -c %s "$temporaire/$nom")"
empreinte="$(sha256sum "$temporaire/$nom" | cut -d' ' -f1)"
printf 'fichier=%s\nsha256=%s\nderniere_empreinte_audit=%s\n' "$nom" "$empreinte" "$empreinte_audit" > "$temporaire/$nom.empreinte"
mv "$temporaire/$nom" "$temporaire/$nom.empreinte" "$DOSSIER/"

# 3. Copie hors site
hors_site=false
if [[ -n "$DESTINATION" ]]; then
  if rclone copyto --immutable "$DOSSIER/$nom" "$DESTINATION/$nom" && rclone copyto --immutable "$DOSSIER/$nom.empreinte" "$DESTINATION/$nom.empreinte"; then
    hors_site=true
  else
    echo "Envoi hors site en échec : la copie locale est gardée, le back-office le signale" >&2
  fi
fi

# 4. Compte rendu, avec la vérification de toute la chaîne d'audit
message=""
[[ -z "$DESTINATION" ]] && message="Aucune destination hors site configurée"
[[ -n "$DESTINATION" && "$hors_site" == false ]] && message="Envoi hors site en échec"
resultat="$(enregistrer true "$nom" "$taille" "$empreinte" "$hors_site" "$message")" || echec "compte rendu impossible à inscrire"
IFS=';' read -r lignes_audit anomalie_audit audit_raccourci <<<"$resultat"

# 5. Copies locales anciennes
find "$DOSSIER" -maxdepth 1 -type f \( -name 'dbs-*.dump.age' -o -name 'dbs-*.dump.age.empreinte' \) -mtime "+$CONSERVATION" -delete

echo "Sauvegarde $nom : $taille octets, hors site : $hors_site, journal d'audit : $lignes_audit lignes vérifiées"
if [[ -n "$anomalie_audit" ]]; then
  echo "ANOMALIE dans le journal d'audit à la ligne $anomalie_audit : suivez la procédure d'incident" >&2
  exit 2
fi
if [[ "$audit_raccourci" == t ]]; then
  echo "ANOMALIE : les dernières lignes du journal d'audit vues à la sauvegarde précédente ont disparu : suivez la procédure d'incident" >&2
  exit 2
fi

# 6. Tout va bien, copie hors site comprise : signal au service de surveillance (son silence déclenche l'alerte)
if [[ -n "${SAUVEGARDE_SIGNAL_URL:-}" && "$hors_site" == true ]]; then
  wget -q -T 15 -O /dev/null "$SAUVEGARDE_SIGNAL_URL" || echo "Signal au service de surveillance non envoyé" >&2
fi
