#!/bin/sh
# Efface tout ce qui a été saisi dans la démonstration et repart des données d'exemple.
cd "$(dirname "$0")" || exit 1
echo
echo "  Tout ce que vous avez saisi dans la démonstration sera effacé,"
echo "  et les données d'exemple reviendront."
printf "\n  Continuer ? Tapez o puis Entrée : "
read -r reponse
if [ "$reponse" != "o" ] && [ "$reponse" != "O" ]; then
  echo "  Rien n'a été effacé."
  exit 0
fi
docker compose -f compose.yml down -v
exec sh ./demarrer.command
