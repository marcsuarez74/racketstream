# RacketStream

RacketStream — app Garmin Connect IQ de score pour sports de raquette
(badminton aujourd'hui, padel/tennis/squash en route), synchronisée en temps
réel vers un overlay OBS pour stream. De la montre au stream, sans aucune
manipulation.

```
Montre (score local) ──sync──► Supabase ──Realtime──► Overlay OBS ──capture──► Stream
```

## Fonctionnalités

- **Score point par point** sur la montre (START = mon point, BACK = point adverse)
- **Undo** (UP), **changement de set** avec confirmation (DOWN), détection de fin de set/match
- **Formats** : 11/15/21 points, win-by, cap, 1 à 3 sets gagnants
- **Menu inline** (UP long) : Reprendre / Format / Reset / Quitter
- **Sync temps réel** : chaque point est poussé vers Supabase (idempotent, reprise après coupure)
- **Overlay OBS** : scorebug compact mis à jour en <1 s via Supabase Realtime

## Appareils compatibles (sideload)

| Appareil | Fichier |
|---|---|
| epix 2 Pro 51 mm | `badmintonscore-epix2pro51mm.prg` |
| Forerunner 55 | `badmintonscore-fr55.prg` |

Installation : copier le `.prg` dans `GARMIN/Apps/` de la montre via USB, puis redémarrer.
Les builds signés sont générés par `scripts/build-release.sh` (clés dans `.secrets/`,
non committé). Pour une montre tierce : `FRIEND=1 scripts/build-release.sh` → build
avec une clé device dédiée (canal `ami`).

## Binding des boutons (écran SCORE)

| Bouton | Action |
|---|---|
| START | mon point |
| BACK | point adverse |
| UP | annuler le dernier point |
| DOWN | confirmer le set → « TERMINER SET ? » (DOWN = oui, BACK = non) |
| UP long | menu (Reprendre / Format / Reset / Quitter — Quitter abandonne le match : purge + fermeture) |

## Overlay OBS

URL : **https://racket-stream-portal.marc-suarez.fr/overlay/?channel=marc**

Dans OBS : Sources → + → **Navigateur** → coller l'URL, 1280×200, « Effacer le
fond » inutile (la page est déjà transparente). L'overlay suit automatiquement
le match actif du canal — rien à mettre à jour entre les matchs.

Paramètres d'URL :

| Paramètre | Défaut | Rôle |
|---|---|---|
| `channel` | `marc` | canal du device (`marc`, `ami`) |
| `name1` / `name2` | `MOI` / `LUI` | noms affichés |
| `scale` | `1` | taille globale de la barre |
| `bg` | `1` | `bg=0` : sans fond, texte avec halo |

### Latence de la sync

La montre envoie les points **par batchs** (≤ 5 points, **≥ 5 s entre deux
envois**) — une contrainte du lien Bluetooth de la montre (débit partagé avec
GCM, batterie). Conséquence : si vous marquez plusieurs points en rafale,
l'overlay les suit par paliers de 5 à 10 s. Dans un vrai match (un rallye
toutes les 10-30 s), chaque point arrive en **1 à 3 s**. Une fois la donnée
dans le cloud, l'overlay l'affiche en <1,5 s.

Sur l'écran score de la montre, un **point en haut à droite** indique l'état
de la sync : vert = synchro OK · gris = envoi en cours · rouge = erreur
(reprise automatique) · sombre = sync non configurée.

### Variante : Custom Widget StreamElements

Le même scorebug existe en **widget StreamElements** (`overlay/se-widget/`),
à intégrer directement dans un overlay StreamElements (un seul browser source
dans OBS avec vos alerts).

Installation (une fois) :

1. Ouvrez les 4 fichiers de `overlay/se-widget/` : `html.txt`, `css.css`,
   `js.js`, `fields.json`
2. Sur streamelements.com : **Overlays** → nouveau/éditer → **Add widget →
   Custom Widget** (offert par le plan payant) → collez chaque bloc dans
   l'onglet correspondant (HTML, CSS, JS, Fields)
3. Redimensionnez le widget dans l'éditeur, copiez l'URL de l'overlay
   StreamElements dans OBS

Réglages (onglet Fields du widget) : canal (`marc`/`ami`), noms des joueurs,
échelle, fond sombre on/off. Le widget sonde Supabase toutes les 2 s — le
score s'affiche ≤ 2 s après chaque point.

`sim.html` est un simulateur local de l'environnement StreamElements
(`python3 -m http.server` puis `http://localhost:8000/sim.html`), utilisé
pour les tests playwright.

## Architecture

- **Montre** — `watch/connect-iq/` (Monkey C) : moteur de score local, UI, sync HTTP.
  Le score vit dans la montre ; le cloud ne fait que recevoir (lecture seule côté web).
- **Backend** — `supabase/` : Edge Function `sync` (auth par clé device hashée,
  idempotence `UNIQUE(match_id, sequence)`), 4 tables (`matches`, `events`,
  `match_state`, `devices` avec canal par montre), RLS : lecture publique,
  écriture via la fonction uniquement.
- **Overlay** — `overlay/index.html` : page unique sans build, Realtime
  (Postgres Changes), auto-follow du match actif, reconnexion automatique.

## Développement

```bash
# Tests montre (Robo Noise Engine, 55 tests × 2 profils)
SDK="$HOME/Library/Application Support/Garmin/ConnectIQ/Sdks/<version>"
"$SDK/bin/monkeyc" -d epix2pro51mm -f watch/connect-iq/monkey.jungle \
  -o /tmp/test.prg -y ~/keys/developer_key.der -w -t
"$SDK/bin/monkeydo" /tmp/test.prg epix2pro51mm -t

# Tests backend (Deno)
deno test --allow-all supabase/functions/sync/handler_test.ts

# Migrations + déploiement fonction
supabase db push && supabase functions deploy sync

# Builds sideload (injecte URL backend + clé device)
scripts/build-release.sh
```

Structure : `watch/connect-iq/source/{engine,ui,sync,tests}` · `supabase/{migrations,functions/sync}` ·
`overlay/` · `scripts/` · docs de phases dans `docs/superpowers/`.

## Roadmap

- [x] Phase 4a — sync backend (Edge Function + Supabase + RNE)
- [x] Phase 4b — UI « Garmin natif » (design validé, chord-aware)
- [x] Phase 4c — identité : wordmark, icône (zéro licence)
- [x] Renommage — **BadScore → RacketStream** (repositionnement sports de raquette + streaming)
- [x] Multi-device — clé par montre, canal par device, build ami
- [x] Phase 5 — overlay OBS temps réel
- [ ] Phase 6 — indicateur de service (évolution app + DB)
- [ ] Phase 7 — bot Twitch (annonces de score en chat)
