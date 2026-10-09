#!/usr/bin/env bash
# Copie la dernière sauvegarde quotidienne de la base du VPS vers le Mac,
# vérifie son intégrité et garde les 30 plus récentes.
set -euo pipefail
HOST="${HOST:-racketstream-vps}"
DIR="${BACKUP_DIR:-$HOME/Backups/racketstream}"
mkdir -p "$DIR"

latest=$(ssh "$HOST" 'sudo sh -c "ls -1t /var/lib/racketstream-api/backups/racketstream-*.db 2>/dev/null | head -1"')
[ -n "$latest" ] || { echo "aucune sauvegarde sur le VPS" >&2; exit 1; }
out="$DIR/$(basename "$latest")"
tmp="$out.part"
ssh "$HOST" "sudo cat '$latest'" > "$tmp"
check=$(sqlite3 "$tmp" "PRAGMA integrity_check;")
[ "$check" = "ok" ] || { echo "intégrité KO : $check" >&2; rm -f "$tmp"; exit 1; }
mv "$tmp" "$out"
ls -1t "$DIR"/racketstream-*.db | tail -n +31 | while read -r f; do rm -f "$f"; done
echo "copie OK : $out ($(du -h "$out" | cut -f1))"
