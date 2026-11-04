#!/usr/bin/env bash
# Démarre un vrai démon ClamAV de test sur 127.0.0.1:PORT (3310 par défaut), avec une seule signature :
# le fichier de test EICAR. Aucune base de signatures n'est téléchargée. Paquet requis : clamav-daemon.
#   ./tests/antivirus/demarrer-clamd.sh [port]
# Puis : ANTIVIRUS_ADRESSE_TEST=127.0.0.1:3310 npm run test -w @dbs/api
set -euo pipefail

PORT="${1:-3310}"
DOSSIER="$(mktemp -d)"
mkdir -p "$DOSSIER/signatures"
SIGNATURE="$(printf 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE' | od -An -tx1 | tr -d ' \n')"
printf 'Test.Eicar-Signature:0:*:%s\n' "$SIGNATURE" > "$DOSSIER/signatures/eicar.ndb"
cat > "$DOSSIER/clamd.conf" <<CONF
TCPSocket $PORT
TCPAddr 127.0.0.1
DatabaseDirectory $DOSSIER/signatures
LogFile $DOSSIER/clamd.log
PidFile $DOSSIER/clamd.pid
StreamMaxLength 10M
Foreground no
CONF
if [ "$(id -u)" = "0" ]; then echo "User root" >> "$DOSSIER/clamd.conf"; fi

clamd -c "$DOSSIER/clamd.conf"
for _ in $(seq 1 30); do
  if exec 3<>"/dev/tcp/127.0.0.1/$PORT" 2>/dev/null; then
    printf 'zPING\0' >&3
    reponse="$(tr -d '\0' <&3 || true)"
    exec 3<&-
    if [ "$reponse" = "PONG" ]; then
      echo "ClamAV prêt sur 127.0.0.1:$PORT (journal : $DOSSIER/clamd.log)"
      exit 0
    fi
  fi
  sleep 1
done
echo "ClamAV n'a pas démarré :" >&2
cat "$DOSSIER/clamd.log" >&2 || true
exit 1
