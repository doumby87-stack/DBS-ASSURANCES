#!/usr/bin/env bash
# Planificateur du conteneur « sauvegarde » (infra/production/compose.yml), à l'heure d'Abidjan (TZ) :
#   · SAUVEGARDE_HORAIRES       sauvegardes (sauvegarder.sh), « 01:30 » par défaut ; plusieurs heures séparées par
#                               des espaces, par exemple « 01:30 08:00 12:30 17:30 » avec la base locale (ADR 0017)
#   · 03 h 00 le 1er du mois    test de restauration (tester-restauration.sh)
#   · tous les quarts d'heure   contrôles rapides (surveillance/controler.sh rapide)
#   · 06 h 15 chaque jour       contrôles du jour (surveillance/controler.sh quotidien)
# Une simple boucle plutôt que crond : les tâches héritent des variables du conteneur, et leur sortie va au journal
# du conteneur (docker compose logs sauvegarde). Une tâche encore en cours n'est pas relancée par-dessus.
set -uo pipefail
OUTILS="$(cd "$(dirname "$0")/.." && pwd)"
VERROUS="${TMPDIR:-/tmp}"

lancer() {
  local nom="$1"
  shift
  (
    flock -n 9 || { echo "$(date +'%F %T') $nom : encore en cours, non relancé"; exit 0; }
    echo "$(date +'%F %T') $nom : début"
    "$@"
    echo "$(date +'%F %T') $nom : fin (code $?)"
  ) 9>"$VERROUS/verrou-$nom" &
}

for horaire in ${SAUVEGARDE_HORAIRES:-01:30}; do
  [[ "$horaire" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "SAUVEGARDE_HORAIRES : « $horaire » n'est pas une heure HH:MM" >&2; exit 1; }
done
echo "$(date +'%F %T') planificateur démarré (fuseau ${TZ:-UTC}, sauvegardes à ${SAUVEGARDE_HORAIRES:-01:30})"
precedente=""
while true; do
  maintenant=$(date +%H:%M)
  if [[ "$maintenant" != "$precedente" ]]; then
    precedente="$maintenant"
    for horaire in ${SAUVEGARDE_HORAIRES:-01:30}; do
      if [[ "$maintenant" == "$horaire" ]]; then
        lancer sauvegarde "$OUTILS/sauvegardes/sauvegarder.sh"
      fi
    done
    if [[ "$maintenant" == "03:00" && "$(date +%d)" == "01" ]]; then
      lancer restauration "$OUTILS/sauvegardes/tester-restauration.sh"
    fi
    case "${maintenant#*:}" in
      00|15|30|45) lancer controle-rapide "$OUTILS/surveillance/controler.sh" rapide ;;
    esac
    if [[ "$maintenant" == "06:15" ]]; then
      lancer controle-quotidien "$OUTILS/surveillance/controler.sh" quotidien
    fi
  fi
  sleep 20
done
