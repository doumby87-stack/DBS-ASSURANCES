#!/usr/bin/env bash
# Test mensuel : restaure la dernière sauvegarde dans une base isolée, la vérifie, puis la supprime (restaurer.sh).
# Une sauvegarde jamais restaurée n'est pas une sauvegarde. Résultat au registre (registre-restaurations.log) ;
# en cas d'échec, alerte par ALERTE_COMMANDE.
set -euo pipefail
DOSSIER="${SAUVEGARDE_DOSSIER:-/sauvegardes}"
derniere=$(ls -1 "$DOSSIER"/quotidiennes/dbs-*.dump.age 2>/dev/null | sort | tail -n 1)
if [[ -z "$derniere" ]]; then
  echo "Aucune sauvegarde à tester" >&2
  exit 1
fi
if sortie=$("$(dirname "$0")/restaurer.sh" "$derniere" 2>&1); then
  echo "$sortie"
else
  echo "$sortie" >&2
  if [[ -n "${ALERTE_COMMANDE:-}" ]]; then
    printf 'DBS-ASSURANCES : le test de restauration de %s a échoué.\n\n%s\n' "$(basename "$derniere")" "$sortie" \
      | bash -c "$ALERTE_COMMANDE" || echo "Envoi de l'alerte en échec" >&2
  fi
  exit 1
fi
