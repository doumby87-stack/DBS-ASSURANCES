#!/bin/sh
# Démonstration DBS-ASSURANCES (macOS et Linux) : double-cliquez sur ce fichier, ou lancez « sh demarrer.command ».
cd "$(dirname "$0")" || exit 1
echo
echo "  Démonstration DBS-ASSURANCES"
echo "  ============================"
echo
if ! docker info >/dev/null 2>&1; then
  echo "  Docker Desktop n'est pas ouvert, ou pas encore prêt."
  echo "  Ouvrez Docker Desktop, attendez qu'il indique « Engine running », puis recommencez."
  printf "\n  Appuyez sur Entrée pour fermer. "; read -r _
  exit 1
fi
echo "  Préparation en cours. La première fois, comptez 5 à 15 minutes ; ensuite, une minute environ."
echo
if ! docker compose -f compose.yml up -d --build --wait; then
  echo
  echo "  Le démarrage a échoué. Ouvrez le guide DEMARRER.md, partie « En cas de problème »."
  printf "\n  Appuyez sur Entrée pour fermer. "; read -r _
  exit 1
fi
open http://localhost:8080 2>/dev/null || xdg-open http://localhost:8080 >/dev/null 2>&1
echo
echo "  C'est prêt : ouvrez http://localhost:8080 si la page ne s'est pas ouverte toute seule."
echo "  Pour arrêter la démonstration : double-cliquez sur arreter.command"
echo
