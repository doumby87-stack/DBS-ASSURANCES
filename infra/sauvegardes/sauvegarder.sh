#!/usr/bin/env bash
# Sauvegarde complète de la base (docs/securite/sauvegardes-et-reprise.md) :
#   1. intégrité du journal d'audit (audit.verifier_chaine()) et dernière empreinte, notées hors de la base
#      (empreintes/journal-audit.log, jamais supprimé) ;
#   2. export pg_dump (format personnalisé, compressé), chiffré avec age pour la clé publique de l'agence : seul le
#      détenteur de la clé privée peut le relire ; empreinte SHA-256 à côté ;
#   3. une copie mensuelle (la première du mois) ; rotation locale : 30 jours de quotidiennes, 12 mensuelles ;
#   4. copie hors site par rclone (« copy », jamais « sync » : rien n'est effacé là-bas depuis ce serveur ; le
#      stockage hors site est en écriture unique, avec sa propre durée de conservation).
# Variables : DATABASE_URL_SAUVEGARDE (administrateur du serveur PostgreSQL : il lit tout, même ce que la sécurité
# ligne par ligne cache), SAUVEGARDE_CLE_PUBLIQUE (age1…), SAUVEGARDE_DISTANT (facultatif, « remote:chemin »),
# RCLONE_CONFIG (/run/secrets/rclone_conf par défaut), SAUVEGARDE_DOSSIER (/sauvegardes par défaut).
# Code de sortie : 0 réussie ; 1 échec (rien d'utilisable n'est laissé sous un nom définitif) ; 2 sauvegarde faite,
# mais le journal d'audit présente une anomalie (la sauvegarde en garde la preuve).
set -euo pipefail

: "${DATABASE_URL_SAUVEGARDE:?compte administrateur de la base}"
: "${SAUVEGARDE_CLE_PUBLIQUE:?clé publique age}"
DOSSIER="${SAUVEGARDE_DOSSIER:-/sauvegardes}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/run/secrets/rclone_conf}"
mkdir -p "$DOSSIER/quotidiennes" "$DOSSIER/mensuelles" "$DOSSIER/empreintes"

debut=$(date +%s)
horodatage=$(date -u +%Y%m%dT%H%M%SZ)
nom="dbs-$horodatage.dump.age"
fichier="$DOSSIER/quotidiennes/$nom"
etat="$DOSSIER/derniere.json"

echec() {
  rm -f "$fichier.partiel"
  printf '{"date":"%s","ok":false,"message":"%s"}\n' "$horodatage" "$1" >"$etat"
  echo "Sauvegarde en échec : $1" >&2
  exit 1
}

# 1. Journal d'audit : lignes vérifiées, première anomalie (ou « aucune »), dernière empreinte (ou « vide »)
lecture=$(psql "$DATABASE_URL_SAUVEGARDE" -X -At -F ' ' -v ON_ERROR_STOP=1 \
  -c "SELECT lignes_verifiees, coalesce(premiere_anomalie::text, 'aucune'), coalesce(derniere_empreinte, 'vide') FROM audit.verifier_chaine()") \
  || echec "base injoignable, ou audit.verifier_chaine() en erreur"
read -r lignes anomalie empreinte <<<"$lecture"
printf '%s %s %s %s\n' "$horodatage" "$lignes" "$anomalie" "$empreinte" >>"$DOSSIER/empreintes/journal-audit.log"

# 2. Export chiffré, sous un nom provisoire puis renommé : jamais de fichier incomplet sous un nom définitif
pg_dump -d "$DATABASE_URL_SAUVEGARDE" --format=custom --compress=6 | age -r "$SAUVEGARDE_CLE_PUBLIQUE" -o "$fichier.partiel" \
  || echec "pg_dump ou chiffrement en échec"
taille=$(wc -c <"$fichier.partiel" | tr -d ' ')
[[ "$taille" -gt 1024 ]] || echec "export anormalement petit ($taille octets)"
mv "$fichier.partiel" "$fichier"
# Empreinte sur le seul nom du fichier : vérifiable où que la sauvegarde soit recopiée
(cd "$DOSSIER/quotidiennes" && sha256sum "$nom" >"$nom.sha256")

# 3. Mensuelle : la première sauvegarde réussie du mois
mois=$(date -u +%Y%m)
if ! compgen -G "$DOSSIER/mensuelles/dbs-$mois*.dump.age" >/dev/null; then
  cp "$fichier" "$fichier.sha256" "$DOSSIER/mensuelles/"
fi
find "$DOSSIER/quotidiennes" -name 'dbs-*' -mtime +30 -delete
ls -1 "$DOSSIER/mensuelles"/dbs-*.dump.age 2>/dev/null | sort -r | tail -n +13 | while read -r ancienne; do
  rm -f "$ancienne" "$ancienne.sha256"
done

# 4. Hors site
hors_site=false
if [[ -n "${SAUVEGARDE_DISTANT:-}" ]]; then
  rclone copy --config "$RCLONE_CONFIG" --include 'quotidiennes/**' --include 'mensuelles/**' --include 'empreintes/**' \
    "$DOSSIER" "$SAUVEGARDE_DISTANT" || echec "copie hors site en échec (rclone)"
  hors_site=true
fi

duree=$(( $(date +%s) - debut ))
printf '{"date":"%s","ok":true,"fichier":"%s","taille":%s,"duree_secondes":%s,"lignes_audit":%s,"anomalie_audit":"%s","empreinte_audit":"%s","hors_site":%s}\n' \
  "$horodatage" "$nom" "$taille" "$duree" "$lignes" "$anomalie" "$empreinte" "$hors_site" >"$etat"
echo "Sauvegarde faite : $nom ($taille octets, ${duree} s), journal d'audit : $lignes lignes, hors site : $hors_site."

if [[ "$anomalie" != "aucune" ]]; then
  echo "ALERTE : audit.verifier_chaine() signale une anomalie à la ligne $anomalie (docs/securite/reponse-aux-incidents.md)" >&2
  exit 2
fi
