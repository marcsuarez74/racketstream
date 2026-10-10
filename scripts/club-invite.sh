#!/usr/bin/env bash
# Génère des codes d'invitation club à usage unique sur le VPS et les affiche
# (une seule fois : seul leur hash est stocké). Usage : scripts/club-invite.sh [n]
set -euo pipefail
HOST="${HOST:-racketstream-vps}"
N="${1:-1}"
[[ "$N" =~ ^[0-9]+$ ]] || { echo "usage : $0 [nombre de codes]" >&2; exit 2; }
ssh "$HOST" "sudo -u rs-api env RS_DB=/var/lib/racketstream-api/racketstream.db \
  DENO_DIR=/var/lib/racketstream-api/deno DENO_NO_UPDATE_CHECK=1 \
  /usr/local/bin/deno run --no-prompt \
  --allow-read=/opt/racketstream-api,/var/lib/racketstream-api \
  --allow-write=/var/lib/racketstream-api --allow-env=RS_DB \
  /opt/racketstream-api/server/admin.ts invite $N"
