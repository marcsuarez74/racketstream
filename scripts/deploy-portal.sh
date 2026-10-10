#!/usr/bin/env bash
# Publie le portail et l'overlay OBS (pages statiques) sur le VPS, servis par
# Caddy sur racket-stream-portal.marc-suarez.fr (/ et /overlay/).
# Ne touche ni l'API ni Caddy.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${HOST:-racketstream-vps}"
DEST=/var/www/racketstream-portal

# Portail = page + fichiers de l'app installable (manifeste, service worker, icônes),
# scoreur sans montre (moteur de score JS, sans ses tests) et page publique club.
PORTAL_FILES=(index.html manifest.webmanifest sw.js icons scoreur.html club.html engine vendor)
COPYFILE_DISABLE=1 tar --no-xattrs --exclude='*_test.js' -C portal -czf - "${PORTAL_FILES[@]}" | ssh "$HOST" "rm -rf /tmp/rs-portal && mkdir -p /tmp/rs-portal && tar -C /tmp/rs-portal -xzf -"
scp -q overlay/index.html "$HOST:/tmp/rs-overlay-index.html"
ssh "$HOST" "set -e
  sudo install -d -m 755 -o root -g root $DEST $DEST/icons $DEST/engine $DEST/vendor $DEST/overlay
  cd /tmp/rs-portal
  for f in \$(find . -type f); do sudo install -m 644 -o root -g root \"\$f\" \"$DEST/\$f\"; done
  sudo install -m 644 -o root -g root /tmp/rs-overlay-index.html $DEST/overlay/index.html
  rm -rf /tmp/rs-portal /tmp/rs-overlay-index.html"
echo "portail : https://racket-stream-portal.marc-suarez.fr/"
echo "overlay : https://racket-stream-portal.marc-suarez.fr/overlay/?channel=marc"
