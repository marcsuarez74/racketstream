#!/usr/bin/env bash
# Import Supabase → SQLite, contrôles, puis remplacement de la base du VPS
# (service arrêté le temps de la copie ; l'ancienne base est gardée à côté).
# Clé lue dans .secrets/supabase-service.env (jamais affichée).
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${HOST:-racketstream-vps}"
D=/var/lib/racketstream-api
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

set -a; . .secrets/supabase-service.env; set +a
deno run --allow-net=bzdbnptnubkkagmmxhyi.supabase.co --allow-read=server,"$TMP" --allow-write="$TMP" \
  --allow-env=SUPABASE_SERVICE_ROLE_KEY,SUPABASE_SOURCE_URL server/tools/import-supabase.ts "$TMP/import.db"
sqlite3 "$TMP/import.db" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
[ "$(sqlite3 "$TMP/import.db" 'PRAGMA integrity_check;')" = ok ]

scp -q "$TMP/import.db" "$HOST:/tmp/rs-import.db"
ssh "$HOST" 'set -e
  D='"$D"'
  sudo systemctl stop racketstream-api
  if sudo test -f $D/racketstream.db; then sudo mv $D/racketstream.db $D/racketstream.db.avant-import-$(date +%Y%m%d-%H%M%S); fi
  sudo rm -f $D/racketstream.db-wal $D/racketstream.db-shm
  sudo install -o rs-api -g rs-api -m 640 /tmp/rs-import.db $D/racketstream.db
  rm -f /tmp/rs-import.db
  sudo systemctl start racketstream-api
  for i in $(seq 1 20); do curl -fsS http://127.0.0.1:8790/healthz >/dev/null 2>&1 && break; sleep 0.5; done
  printf "service : "; systemctl is-active racketstream-api'

for ch in marc paul; do
  printf "%-5s " "$ch"; curl -fsS "https://racket-stream.marc-suarez.fr/functions/v1/score-text?channel=$ch"; echo
done
