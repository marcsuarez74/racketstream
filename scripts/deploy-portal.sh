#!/usr/bin/env bash
# Publie le portail (page statique unique) sur le VPS, servi par Caddy sur
# racket-stream-portal.marc-suarez.fr. Ne touche ni l'API ni Caddy.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${HOST:-racketstream-vps}"
DEST=/var/www/racketstream-portal

scp -q portal/index.html "$HOST:/tmp/rs-portal-index.html"
ssh "$HOST" "set -e
  sudo install -d -m 755 -o root -g root $DEST
  sudo install -m 644 -o root -g root /tmp/rs-portal-index.html $DEST/index.html
  rm -f /tmp/rs-portal-index.html"
echo "portail publié : https://racket-stream-portal.marc-suarez.fr/"
