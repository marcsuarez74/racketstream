#!/usr/bin/env bash
# Publie le portail et l'overlay OBS (pages statiques) sur le VPS, servis par
# Caddy sur racket-stream-portal.marc-suarez.fr (/ et /overlay/).
# Ne touche ni l'API ni Caddy.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${HOST:-racketstream-vps}"
DEST=/var/www/racketstream-portal

scp -q portal/index.html "$HOST:/tmp/rs-portal-index.html"
scp -q overlay/index.html "$HOST:/tmp/rs-overlay-index.html"
ssh "$HOST" "set -e
  sudo install -d -m 755 -o root -g root $DEST
  sudo install -m 644 -o root -g root /tmp/rs-portal-index.html $DEST/index.html
  sudo install -d -m 755 -o root -g root $DEST/overlay
  sudo install -m 644 -o root -g root /tmp/rs-overlay-index.html $DEST/overlay/index.html
  rm -f /tmp/rs-portal-index.html /tmp/rs-overlay-index.html"
echo "portail : https://racket-stream-portal.marc-suarez.fr/"
echo "overlay : https://racket-stream-portal.marc-suarez.fr/overlay/?channel=marc"
