# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Le projet est entièrement en français (code commenté, docs, messages de commit au format `type(scope): description` — ex. `feat(portal): …`, `fix(watch): …`). Garder cette langue.

## Vue d'ensemble

RacketStream : app Garmin Connect IQ de score (badminton, padel) dont chaque point est synchronisé vers un backend sur VPS, puis affiché en direct (portail PWA, overlay OBS, widget StreamElements, incrustation vidéo VPS) et annoncé dans le chat Twitch.

```
Montre (score local, offline-first) ──HTTP batch──► API VPS (Deno + SQLite) ──► racket-stream.marc-suarez.fr
   ├─ portal/index.html        (PWA : /api/score + SSE /api/stream ; register, names)
   ├─ overlay/index.html       (/api/score + SSE /api/stream)
   ├─ overlay/se-widget/       (polling /api/score, Custom Widget StreamElements)
   ├─ vps/renderer.py          (SSE /api/stream → frames RGBA sur stdout → ffmpeg → Twitch)
   └─ annonce chat StreamElements (déclenchée par sync, ou chat-announce)
```

**Le score vit dans la montre** ; le serveur ne fait que recevoir. Lecture publique (`/api/*`, `names` en GET), écritures authentifiées dans les handlers (clé device hashée SHA-256 → canal).

## Composants

- **`watch/connect-iq/`** (Monkey C) — `source/engine/` moteur de score pur (règles, formats, undo), `source/ui/` vue + delegate (`MatchView.mc` : écrans `Scr.*`, `press()` = binding des boutons), `source/services/` sync. `SyncCore.mc` est volontairement sans import `Communications`/`Timer` pour rester testable ; `SyncService.mc` fait les appels HTTP. Journal d'events = tableau plat `[type, arg, seq, ts, prevMe, prevOpp]`. Envoi par batchs (≤ 5 events, créneau minimal de 2 s entre envois) — contrainte du lien BT. Depuis 0.3.2 : un nouveau match est envoyé à 0-0 dès son lancement, et `stop` (fin de séance / Supprimer) fait passer le match en `archived` → `/api/score` renvoie `null`, tout se vide.
- **`server/`** (Deno + `node:sqlite`) — l'API de production. `main.ts` **importe les handlers de `supabase/functions/*/handler.ts`** (pas de duplication) et les câble sur les implémentations SQLite de `stores.ts` (interfaces `Db` injectées) ; ajoute `/api/score`, `/api/stream` (SSE via `hub.ts`, publié après chaque sync 200) et `/healthz`. Routes de la montre conservées sous `/functions/v1/…` (compatibilité URL). `pickScore` (stores.ts) = choix du match à afficher côté serveur. Schéma : `schema.sql` (appliqué si `user_version = 0`). Env : `RS_DB`, `RS_HOST`, `RS_PORT` (8790), `CHAT_ANNOUNCE_KEY`, `SE_JWT`. Unités systemd dans `server/deploy/` (API + sauvegarde quotidienne).
- **`supabase/functions/`** — source des handlers, chacun découpé en `handler.ts` (logique pure, `Db` injectée), `index.ts` (câblage supabase-js, ancien backend), `handler_test.ts` (Db en mémoire). `sync` : idempotence `UNIQUE(match_id, sequence)`, un nouveau match passe les autres matchs actifs du device en `finished`. `_shared/announce.ts` : annonce StreamElements (JWT par canal `devices.se_jwt`, sinon `SE_JWT`). Le projet Supabase est **en sursis** (anciennes versions store) : sa mise en pause est une décision de l'utilisateur. `SyncService.mc` réécrit automatiquement une URL `supabase.co` vers le VPS.
- **`portal/`** — PWA en une page HTML sans build (`index.html`, `sw.js` avec nom de cache versionné à incrémenter, `manifest.webmanifest`), publiée sur `https://racket-stream-portal.marc-suarez.fr/` avec `overlay/` (Caddy `file_server`, plus GitHub Pages). Design « sportif » validé au pixel près, breakpoint desktop 1024 px.
- **`vps/renderer.py`** — Python + Pillow. Doit reproduire **à l'identique** le design de `overlay/index.html` (palette dupliquée en constantes). Contrat : pas de match actif *frais* (`updated_at` > `--stale`, 600 s) → frame transparente (anti-« fantôme ») ; API injoignable → garder la dernière frame. Noms du canal relus toutes les 60 s. Lancé à la main sur le VPS (voir `docs/tuto-relais-rtmp-vps.md`).
- **`prototypes/`** — POC des phases 0-1, non maintenus.

La logique de « pick » du match à afficher (match actif le plus récent du canal, fraîcheur 10 min) existe côté serveur (`pickScore`) et côté clients (portail, overlay, widget SE, renderer) : une modification doit être répercutée partout.

## Commandes

```bash
# Tests backend (Deno) — tout (c'est ce que lance deploy-vps.sh)
deno test --allow-all server/ supabase/functions/
deno test --allow-all supabase/functions/sync/handler_test.ts --filter "nom du test"
deno test --allow-all server/main_test.ts --filter "nom du test"

# Tests renderer VPS (pytest, conftest ajoute vps/ au path)
python3 -m pytest vps/tests
python3 -m pytest vps/tests/test_pick.py -k <motif>
python3 vps/renderer.py --channel marc --png /tmp/bug.png   # aperçu visuel du scorebug

# Tests montre (Run No Evil, annotations (:test) dans source/tests/)
SDK="$(cat "$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg")"
"$SDK/bin/monkeyc" -d epix2pro51mm -f watch/connect-iq/monkey.jungle \
  -o /tmp/test.prg -y ~/keys/developer_key_personal.der -w -t
"$SDK/bin/monkeydo" /tmp/test.prg epix2pro51mm -t          # refaire avec fr55

# Portail en local (servir depuis portal/, puis http://localhost:8931/#match)
cd portal && python3 -m http.server 8931

# Déploiement (ssh racketstream-vps)
scripts/deploy-vps.sh       # API : tests, rsync server/ + supabase/functions/, systemd restart, /healthz
scripts/deploy-portal.sh    # portail + overlay/index.html (ne touche ni l'API ni Caddy)
scripts/backup-vps-to-mac.sh

# Builds montre
scripts/build-release.sh            # sideload marc (epix2pro51mm + fr55) → watch/connect-iq/sideload/
FRIEND=1 scripts/build-release.sh   # build ami (fr55, clé device dédiée)
STORE=1 scripts/build-release.sh    # build store : URL cuite, DEVICE_KEY vide (clé via réglages GCM)
scripts/build-store-iq.sh           # paquet .iq pour le store → beta-store/v-<version du manifest>/
```

## Pièges connus

- **Secrets** : `.secrets/` (`phase-4a.env` : `SUPABASE_URL`, `DEVICE_KEY` ; `phase-4a-friend.env`), non commités. `build-release.sh` « cuit » l'URL et la clé dans les consts vides de `source/services/BackendConfig.mc` sur une **copie temporaire** de l'arbre — ne jamais committer ce fichier avec des valeurs. Les consts doivent rester exactement `const BACKEND_URL = "";` / `const DEVICE_KEY = "";` (le script fait un `assert`).
- **Fuite de clé dans les builds store** (incident du 21/09) : les `.mir`/`.prg` des builds sideload contiennent le BackendConfig cuit ; les scripts les purgent avant compilation. Conserver cette purge et la réassignation `DEVICE_KEY=""` après le `source` du `.env`.
- La page Réglages d'une app sideloadée fait rebooter la montre (bug GCM 5.29) → d'où la config cuite dans le code plutôt que via Properties pour les sideloads.
- **Version réellement installée** : GCM peut afficher la nouvelle version avant que la montre l'ait téléchargée (forcer une synchro). Vérification côté serveur : en ≥ 0.3.2, un match apparaît dans `matches` ~1 s après `started_at` avec 0 event ; sinon seulement au premier point.
- **VPS** : ne jamais afficher `/etc/racketstream/*.env` ; Caddy = sauvegarde, `caddy validate` puis `reload` (jamais `restart`) ; ne pas redéployer l'API pendant un live (le restart coupe les flux SSE). Base : `/var/lib/racketstream-api/racketstream.db` (lecture via `sqlite3 -readonly`).
- Le simulateur Connect IQ refuse le `http://` (code -1001) même si la requête part : pour tester la sync contre un faux serveur local, le prendre en compte.
- `docs/local/` (IP réelles, docs d'exploitation) est gitignoré ; ne rien y référencer depuis les docs commitées.
- `README.md` décrit encore l'architecture Supabase/GitHub Pages (obsolète côté backend) ; ce fichier et `docs/superpowers/plans/2026-10-09-phase-8-backend-vps.md` font foi.

## Docs

- `docs/superpowers/specs/` (designs), `plans/` (plans d'implémentation par phase), `notes/` (résultats et constats de chaque phase — à consulter avant de toucher la sync ou les builds).
- `docs/guide-utilisateur.md` : guide utilisateur de référence (fiche store) — à mettre à jour quand un comportement visible change.
- `docs/tuto-relais-rtmp-vps.md` : relais téléphone → VPS (ffmpeg + renderer) → Twitch, avec la liste des pièges rencontrés en conditions réelles.
