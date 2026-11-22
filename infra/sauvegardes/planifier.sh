#!/usr/bin/env bash
# Lance sauvegarder.sh chaque jour à l'heure SAUVEGARDE_HEURE (HH:MM, heure d'Abidjan, 02:00 par défaut), et une
# première fois au démarrage si SAUVEGARDE_AU_DEMARRAGE=oui. Une sauvegarde en échec n'arrête pas la planification :
# l'échec est inscrit dans la base et le gérant le voit dans le back-office (page Exploitation).
set -uo pipefail

HEURE="${SAUVEGARDE_HEURE:-02:00}"
if [[ ! "$HEURE" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  echo "SAUVEGARDE_HEURE doit ressembler à 02:00" >&2
  exit 1
fi
export TZ=Africa/Abidjan

lancer() {
  echo "$(date -Iseconds) début de la sauvegarde"
  /usr/local/bin/sauvegarder.sh
  echo "$(date -Iseconds) fin de la sauvegarde (code $?)"
}

[[ "${SAUVEGARDE_AU_DEMARRAGE:-non}" == "oui" ]] && lancer
while true; do
  maintenant="$(date +%s)"
  prochaine="$(date -d "$(date +%F) $HEURE" +%s)"
  (( prochaine <= maintenant )) && prochaine="$(date -d "$(date -d tomorrow +%F) $HEURE" +%s)"
  sleep $(( prochaine - maintenant ))
  lancer
done
