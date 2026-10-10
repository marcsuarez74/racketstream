#!/usr/bin/env bash
# Régénère la clé d'un club (clé perdue) sur le VPS et l'affiche une seule fois.
# L'ancienne clé ne marche plus. Usage : scripts/club-key.sh <identifiant du club>
set -euo pipefail
HOST="${HOST:-racketstream-vps}"
SLUG="${1:-}"
[[ "$SLUG" =~ ^[a-z0-9-]{2,20}$ ]] || { echo "usage : $0 <identifiant du club>" >&2; exit 2; }
ssh "$HOST" "sudo -u rs-api env RS_DB=/var/lib/racketstream-api/racketstream.db \
  DENO_DIR=/var/lib/racketstream-api/deno DENO_NO_UPDATE_CHECK=1 \
  /usr/local/bin/deno run --no-prompt \
  --allow-read=/opt/racketstream-api,/var/lib/racketstream-api \
  --allow-write=/var/lib/racketstream-api --allow-env=RS_DB \
  /opt/racketstream-api/server/admin.ts club-key $SLUG"
