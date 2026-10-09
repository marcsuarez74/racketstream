#!/usr/bin/env bash
# Build release avec injection de la configuration backend (contournement
# du bug GCM 5.29 : la page Réglages d'une app CIQ sideloadée reboot la
# montre — cf. docs/superpowers/notes/phase-4a-sync-results.md).
#
# Usage : scripts/build-release.sh                 (builds marc : epix + fr55)
#         FRIEND=1 scripts/build-release.sh        (build ami : fr55 seulement)
#         STORE=1 scripts/build-release.sh         (build store beta : URL cuite,
#                                                   DEVICE_KEY vide → GCM)
# Prérequis : .secrets/phase-4a.env (API_URL ; DEVICE_KEY requis sauf
#             STORE=1, ou .secrets/phase-4a-friend.env en mode FRIEND=1),
#             SDK Connect IQ installé, clé ~/keys/developer_key_personal.der
#             (surchargeable : DEV_KEY_PATH=... scripts/build-release.sh)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
STORE_MODE=0
if [ "${STORE:-0}" = "1" ]; then STORE_MODE=1; fi
if [ "$STORE_MODE" = "1" ]; then
    SECRETS="$REPO/.secrets/phase-4a.env"  # pour API_URL uniquement
    SUFFIX="-store"
    DEVICES="epix2pro51mm fr55"
    DEVICE_KEY=""                           # jamais de clé dans un build store
elif [ "${FRIEND:-0}" = "1" ]; then
    SECRETS="$REPO/.secrets/phase-4a-friend.env"
    SUFFIX="-ami"
    DEVICES="fr55"
else
    SECRETS="$REPO/.secrets/phase-4a.env"
    SUFFIX=""
    DEVICES="epix2pro51mm fr55"
fi
if [ ! -f "$SECRETS" ]; then
    echo "Erreur : $SECRETS absent (voir docs/superpowers/plans/2026-09-19-phase-4a-sync.md Task 4)" >&2
    exit 1
fi
# shellcheck disable=SC1090
source "$SECRETS"
# STORE : réassignation APRÈS le source — le .env écraserait sinon la valeur
# vide et cuirait la clé device dans le build store (bug du 21/09, repéré
# par la présence de la clé dans la string table du .prg store).
if [ "$STORE_MODE" = "1" ]; then DEVICE_KEY=""; fi
: "${API_URL:?API_URL manquant dans $SECRETS (ex. https://racket-stream.marc-suarez.fr)}"
if [ "$STORE_MODE" = "0" ]; then
    : "${DEVICE_KEY:?DEVICE_KEY manquant dans .secrets/phase-4a.env}"
fi
BACKEND_URL="$API_URL/functions/v1/sync"
KEY_PATH="${DEV_KEY_PATH:-$HOME/keys/developer_key_personal.der}"
SDK="$(cat "$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R "$REPO/watch/connect-iq" "$TMP/app"
# Purge des artefacts de builds précédents : monkeyc dépose des .mir
# (représentation intermédiaire du BackendConfig CUIT, donc avec la clé des
# builds sideload) à côté du .prg de sortie. S'ils restent dans l'arbre
# copié, le linker les réembarque → fuite de la clé dans le build store
# (constaté 21/09 : clé présente dans la string table du .prg store).
find "$TMP/app" -type d \( -name 'external-mir' -o -name 'internal-mir' -o -name 'gen' \) -prune -exec rm -rf {} +
find "$TMP/app" \( -name '*.mir' -o -name '*.prg' -o -name '*.prg.*' \) -delete

# NB : pas d'injection settings.xml ici — depuis PR #22 les défauts vivent
# dans le settings.xml du repo (URL publique + deviceKey vide). Le build
# store réutilise donc ces défauts tels quels (double filet avec BackendConfig).

# Cuisson de la config dans le CODE (BackendConfig.mc) : les consts
# compilées sont fiables sur matériel. STORE=1 laisse DEVICE_KEY vide →
# SyncService retombe sur Properties (réglages GCM, chemin supporté store).
python3 - "$TMP/app/source/services/BackendConfig.mc" "$BACKEND_URL" "$DEVICE_KEY" <<'EOF'
import sys
path, url, key = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
assert 'const BACKEND_URL = "";' in s and 'const DEVICE_KEY = "";' in s
s = s.replace('const BACKEND_URL = "";', 'const BACKEND_URL = "' + url + '";')
s = s.replace('const DEVICE_KEY = "";', 'const DEVICE_KEY = "' + key + '";')
open(path, 'w').write(s)
EOF

OUT="$REPO/watch/connect-iq/sideload"
if [ "$STORE_MODE" = "1" ]; then OUT="$REPO/watch/connect-iq/store"; fi
mkdir -p "$OUT"
for DEV in $DEVICES; do
    "$SDK/bin/monkeyc" -d "$DEV" -f "$TMP/app/monkey.jungle" \
        -o "$OUT/racketstream-$DEV$SUFFIX.prg" -y "$KEY_PATH" -w -r
    echo "OK : $OUT/racketstream-$DEV$SUFFIX.prg"
done
if [ "$STORE_MODE" = "1" ]; then
    # Paquet store (.iq) : toutes les montres du manifest, même config cuite
    # (DEVICE_KEY vide, BACKEND_URL cuit) — le dépôt Connect IQ Store.
    "$SDK/bin/monkeyc" -e -f "$TMP/app/monkey.jungle" \
        -o "$OUT/racketstream.iq" -y "$KEY_PATH" -w -r
    echo "OK : $OUT/racketstream.iq (paquet store)"
fi
echo "Prêt à sideloader : copie le .prg dans GARMIN/Apps/ de la montre."
