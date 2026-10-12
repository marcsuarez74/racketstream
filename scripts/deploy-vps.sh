#!/usr/bin/env bash
# Déploie le backend (server/ + handlers supabase/functions/) sur le VPS et
# redémarre UNIQUEMENT racketstream-api. Ne touche ni Caddy ni MediaMTX.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${HOST:-racketstream-vps}"
DEST=/opt/racketstream-api

deno test --allow-all server/ supabase/functions/ portal/engine/ >/dev/null

# Options compatibles avec l'openrsync de macOS (pas de --chmod D/F ni --relative).
ssh "$HOST" "sudo install -d -m 755 $DEST/server $DEST/supabase/functions"
for dir in server supabase/functions; do
  rsync -rlt --delete --rsync-path="sudo rsync" \
    --exclude '*_test.ts' --exclude 'test_util.ts' --exclude '*.db*' \
    "$dir/" "$HOST:$DEST/$dir/"
done

ssh "$HOST" 'set -e
  sudo chown -R root:root /opt/racketstream-api
  sudo chmod -R u=rwX,go=rX /opt/racketstream-api
  for f in racketstream-api.service racketstream-backup.service racketstream-backup.timer racketstream-purge.service racketstream-purge.timer; do
    sudo install -m 644 /opt/racketstream-api/server/deploy/$f /etc/systemd/system/$f
  done
  sudo systemctl daemon-reload
  sudo systemctl enable --now racketstream-backup.timer racketstream-purge.timer >/dev/null
  sudo systemctl enable racketstream-api >/dev/null 2>&1
  sudo systemctl restart racketstream-api
  for i in $(seq 1 20); do curl -fsS http://127.0.0.1:8790/healthz >/dev/null 2>&1 && break; sleep 0.5; done
  curl -fsS http://127.0.0.1:8790/healthz; echo " — racketstream-api OK"'
