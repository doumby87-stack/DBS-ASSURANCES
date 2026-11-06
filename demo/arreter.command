#!/bin/sh
# Arrête la démonstration DBS-ASSURANCES ; les données sont gardées pour la prochaine fois.
cd "$(dirname "$0")" || exit 1
echo
echo "  Arrêt de la démonstration DBS-ASSURANCES..."
docker compose -f compose.yml down
echo
echo "  C'est arrêté. Les données sont gardées pour la prochaine fois."
echo
