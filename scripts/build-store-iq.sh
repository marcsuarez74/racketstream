#!/usr/bin/env bash
# Export du package .iq pour soumission au store Connect IQ (beta/production).
# Généré depuis l'arbre repo SANS cuisson : BackendConfig consts vides (la clé
# device vient des réglages GCM) + défaut settings.xml (URL publique).
# Sortie : beta-store/ (package + rien d'autre — dossier gitigné).
#
# Notes 21/09 :
# - `monkeyc -e` compile par FAMILLE (écran+API), pas par produit listé :
#   epix2pro51mm → les 3 square-280x280 (42/47/51mm), fr55 → 3 round-208x208.
#   Les appareils publiés se choisissent dans le wizard d'upload.
# - Le .iq est une archive 7z → audit via bsdtar (pas unzip).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
KEY_PATH="${DEV_KEY_PATH:-$HOME/keys/developer_key_personal.der}"
SDK="$(cat "$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg")"

# Version lue dans le manifest → sortie versionnée : beta-store/v-0.1.1/…
APP_VERSION="$(sed -n 's/.*iq:application[^>]* version="\([^"]*\)".*/\1/p' "$REPO/watch/connect-iq/manifest.xml" | head -1)"
OUT="$REPO/beta-store/v-$APP_VERSION"
mkdir -p "$OUT"

# Arbre propre : purge des artefacts de builds précédents (.mir/.prg contiennent
# le BackendConfig cuit des builds sideload → fuite si réembarqués, cf. 21/09).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R "$REPO/watch/connect-iq" "$TMP/app"
find "$TMP/app" -type d \( -name 'external-mir' -o -name 'internal-mir' -o -name 'gen' \) -prune -exec rm -rf {} +
find "$TMP/app" \( -name '*.mir' -o -name '*.prg' -o -name '*.prg.*' \) -delete

"$SDK/bin/monkeyc" -e -f "$TMP/app/monkey.jungle" \
    -o "$OUT/badmintonscore.iq" -y "$KEY_PATH" -w -r
echo "OK : $OUT/badmintonscore.iq"

# Audit secret : extraction réelle du 7z (un grep binaire ne verrait rien,
# contenu compressé). La clé device ne doit figurer dans AUCUN fichier.
if [ -f "$REPO/.secrets/phase-4a.env" ]; then
    KEY="$(grep '^DEVICE_KEY=' "$REPO/.secrets/phase-4a.env" | cut -d= -f2)"
    AUDIT="$TMP/audit"
    mkdir -p "$AUDIT"
    bsdtar -xf "$OUT/badmintonscore.iq" -C "$AUDIT"
    NFILES="$(find "$AUDIT" -type f | wc -l | tr -d ' ')"
    HITS="$(grep -rl "$KEY" "$AUDIT" 2>/dev/null | wc -l | tr -d ' ' || true)"
    if [ "$HITS" != "0" ]; then
        echo "AUDIT ÉCHEC : clé device présente dans le package !" >&2
        exit 1
    fi
    NBIN="$(find "$AUDIT" -name '*.prg' | wc -l | tr -d ' ')"
    echo "Audit secret : OK ($HITS occurrence de la clé sur $NFILES fichiers)"
    echo "Binaires embarqués : $NBIN (familles écran, cf. note en tête)"
fi
echo "Prêt à uploader sur https://apps.garmin.com/en-US/developer/upload"
echo "Dans le wizard : cocher les montres de <iq:products> du manifest (validées au simulateur le 12/10)."
