#!/usr/bin/env bash
# Effacement sur demande (droits RGPD) : supprime un canal ou un club avec
# tous ses matchs et points. Irréversible (hors sauvegardes de 14 jours).
#   scripts/rgpd-delete.sh channel <canal>
#   scripts/rgpd-delete.sh club <identifiant du club>
set -euo pipefail
HOST="${HOST:-racketstream-vps}"
KIND="${1:-}"; NAME="${2:-}"
case "$KIND" in channel) CMD=delete-channel ;; club) CMD=delete-club ;; *) KIND="" ;; esac
[[ -n "$KIND" && "$NAME" =~ ^[A-Za-z0-9_-]{1,40}$ ]] || { echo "usage : $0 channel <canal> | club <identifiant>" >&2; exit 2; }
read -r -p "Supprimer définitivement le $KIND « $NAME » ? (oui/non) " ok
[ "$ok" = "oui" ] || { echo "annulé"; exit 1; }
ssh "$HOST" "sudo -u rs-api env RS_DB=/var/lib/racketstream-api/racketstream.db \
  DENO_DIR=/var/lib/racketstream-api/deno DENO_NO_UPDATE_CHECK=1 \
  /usr/local/bin/deno run --no-prompt \
  --allow-read=/opt/racketstream-api,/var/lib/racketstream-api \
  --allow-write=/var/lib/racketstream-api --allow-env=RS_DB \
  /opt/racketstream-api/server/admin.ts $CMD $NAME"
