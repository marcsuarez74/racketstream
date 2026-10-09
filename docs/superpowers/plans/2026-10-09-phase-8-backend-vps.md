# Phase 8 — Backend sur le VPS (sortie de Supabase) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tout le backend (sync montre, noms, création de canal, annonce chat, lecture du score) tourne sur le VPS sous `https://racket-stream.marc-suarez.fr`, avec une base SQLite locale. Supabase n'est plus utilisé par aucun client à jour, et l'ancien backend reste en lecture/écriture le temps que les montres du store passent à la nouvelle version.

**Architecture:**
```
Montre ──POST /functions/v1/sync/matches/:id/events──► Caddy (TLS) ──► Deno 127.0.0.1:8790 ──► SQLite (WAL)
   overlay (SSE /api/stream)  ◄────────────────────────────────┘        │
   widget SE (polling /api/score) · renderer VPS (http://127.0.0.1:8790/api/score)
   portail (/functions/v1/register, /functions/v1/names)        └──► StreamElements (annonce chat)
```
- **Les `handler.ts` ne changent pas de rôle** : ils restent purs et dépendent d'une interface `Db` injectée. Seul le câblage change : `supabase-js` est remplacé par des implémentations SQLite (`node:sqlite`, intégré à Deno 2.9, sans dépendance). Les tests `handler_test.ts` existants restent la référence.
- **Chemins conservés** : `/functions/v1/<fonction>` est servi à l'identique. Pour la montre, le portail et les noms, seule l'URL de base change.
- **Lecture du score** : nouvelle route `GET /api/score?channel=` qui fait le *pick* côté serveur (match actif le plus récent du canal, sinon le plus récent tout statut, avec `updated_at`). Overlay, widget SE et renderer ne dupliquent plus la requête PostgREST : la logique de pick n'existe plus qu'à un seul endroit.
- **Temps réel** : `GET /api/stream?channel=` en Server-Sent Events. Le serveur pousse le résultat du pick à chaque sync accepté sur ce canal, plus un ping toutes les 25 s. Ça remplace Realtime `postgres_changes`.
- **Un seul processus** : SQLite est synchrone et Deno mono-thread, les écritures sont donc sérialisées naturellement. Le sync est enveloppé dans une transaction (`BEGIN IMMEDIATE … COMMIT`). L'annonce StreamElements se fait **après** le commit.

**Tech Stack:** Deno 2.9.7 (`Deno.serve`, `node:sqlite`, SQLite 3.53), Caddy (déjà en place, TLS Let's Encrypt), systemd, Ubuntu 26.04 (VPS Infomaniak partagé).

**Décisions :**
- **D-1** : pas de framework HTTP, un routeur maison d'environ 50 lignes (`URLPattern`).
- **D-2** : SQLite plutôt que Postgres local. Un seul écrivain, quelques Ko par match, sauvegarde par simple copie `.backup`.
- **D-3** : on garde les chemins `/functions/v1/*`. Ça évite de toucher `SyncService.mc` : le build ne change que `BACKEND_URL`.
- **D-4** : coexistence. Supabase n'est pas éteint tant que la version store qui cuit l'ancienne URL est encore utilisée (voir tâche 11).

**Failles corrigées au passage :**
1. **`deviceId` non lié à la clé.** Aujourd'hui, la propriété d'un match est vérifiée sur le `deviceId` envoyé dans le corps, que n'importe quelle clé valide peut fournir. Désormais, `getDeviceHash` renvoie aussi `devices.id`. Le match stocke `owner_id`, et le contrôle `403 owner` porte sur `owner_id`. Le `deviceId` du corps reste stocké, à titre informatif seulement.
2. **Unicité des canaux.** `UNIQUE(channel)` et `UNIQUE(device_key_hash)` sur `devices`. `register` traite la violation de contrainte comme un `409`, ce qui supprime la course entre `channelTaken` et l'insert.
3. **Sync non atomique.** Le sync passe en transaction (voir Architecture).
4. **`chat-announce` ouvert si `CHAT_ANNOUNCE_KEY` est absente.** La clé devient obligatoire : sans elle, la route répond `503`.

**Secrets (jamais dans git, jamais affichés)** :
- `/etc/racketstream/api.env` (root:racketstream, 0640) contient `SE_JWT` et `CHAT_ANNOUNCE_KEY`. Il est distinct de `/etc/racketstream/env` existant, auquel on ne touche pas.
- La service role Supabase sert uniquement à l'import (tâche 6). Elle est lue depuis `.secrets/supabase-service.env` en local.

**Branche de travail** : `phase-8-backend-vps` créée depuis `main`, après commit du travail en cours (JWT SE par canal, migration `20261004000001_devices_se_jwt.sql`). Commit à chaque tâche.

## Fichiers créés/modifiés (vue d'ensemble)

| Fichier | Rôle |
|---|---|
| `server/schema.sql` | Schéma SQLite (équivalent des migrations Supabase, avec les contraintes ajoutées) |
| `server/db.ts` | Ouverture de la base (WAL, `foreign_keys`, `busy_timeout`) et application du schéma |
| `server/stores.ts` | Implémentations SQLite de `Db` (sync), `Db` (score-text), `AnnounceDb`, `NamesDb`, `RegisterDb` et `pickScore()` |
| `server/hub.ts` | Abonnés SSE par canal, `publish(channel)` |
| `server/main.ts` | Routeur, CORS, limite de taille de corps, `Deno.serve` sur `127.0.0.1:8790` |
| `server/*_test.ts` | Tests des stores (`:memory:`), du routeur et du SSE |
| `server/tools/import-supabase.ts` | Import ponctuel `devices` / `matches` / `events` / `match_state` / `chat_announce` |
| `server/deploy/racketstream-api.service`, `racketstream-backup.{service,timer}` | Unités systemd |
| `scripts/deploy-vps.sh` | rsync vers `/opt/racketstream-api`, restart du service, smoke test |
| `supabase/functions/sync/handler.ts` | `owner_id`, transaction optionnelle via `db.atomic` |
| `supabase/functions/register/handler.ts` | 409 sur violation d'unicité |
| `supabase/functions/chat-announce/handler.ts` | 503 si pas de clé configurée, côté serveur VPS uniquement |
| `overlay/index.html`, `overlay/se-widget/js.js`, `vps/renderer.py`, `portal/index.html` | Nouvelle URL, `/api/score` et `/api/stream` |
| `.secrets/phase-4a*.env` (local) | `SUPABASE_URL` → `https://racket-stream.marc-suarez.fr` |
| `CLAUDE.md`, `docs/guide-utilisateur.md`, `docs/tuto-relais-rtmp-vps.md` | Architecture, commandes, pièges |

---

## Tâche 1 — Schéma SQLite et ouverture de la base

- [ ] `server/schema.sql` : reprendre les tables `matches`, `events`, `match_state`, `devices` et `chat_announce` avec les types SQLite. Correspondances :
  - `jsonb` devient `TEXT` (JSON sérialisé) ;
  - `timestamptz` devient `INTEGER` (ms epoch) ;
  - `devices.id` devient `INTEGER PRIMARY KEY`.
  
  Ajouts :
  - `matches.owner_id INTEGER REFERENCES devices(id)` ;
  - `UNIQUE(devices.channel)` et `UNIQUE(devices.device_key_hash)` ;
  - index `matches(channel, started_at DESC)`.
  
  Garder les `CHECK` (status, type 0..5, sequence > 0) et `UNIQUE(match_id, sequence)`. Le fichier commence par `PRAGMA user_version = 1` pour les futures migrations.
- [ ] `server/db.ts` : `openDb(path)` applique `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, puis exécute le schéma si `user_version = 0`.
- [ ] Test : ouvrir `:memory:` deux fois de suite, vérifier qu'un second insert `devices` avec le même `channel` lève une erreur de contrainte.
- [ ] Commit `feat(server): schéma SQLite du backend VPS`

## Tâche 2 — Store « sync » et transaction

- [ ] Dans `sync/handler.ts` : `getDeviceHash` renvoie `{ deviceRowId, channel, error }`. `getMatchDevice` est remplacé par `getMatchOwner(matchId) → { ownerId }`, et `upsertMatch` reçoit `ownerId`.
- [ ] Dans `sync/handler.ts` : méthode optionnelle `atomic?<T>(fn: () => Promise<T>): Promise<T>` sur `Db`. Le handler l'utilise pour la séquence upsertMatch → finishOther → upsertEvents → upsertState. L'annonce reste hors transaction.
- [ ] Mettre à jour `handler_test.ts` : nouveau cas « clé B valide mais match créé par la clé A → 403 owner ». Le cas existant « deviceId différent dans le corps » doit maintenant passer en 200.
- [ ] Garder `sync/index.ts` (Supabase) compilable : mapper `owner_id` sur la colonne existante `device_id` côté Supabase. Pas de migration Postgres, le backend Supabase est en sursis.
- [ ] `server/stores.ts` : `SqliteSyncDb`.
  - `events` : `INSERT … ON CONFLICT(match_id, sequence) DO NOTHING`.
  - `match_state` : upsert avec `updated_at = Date.now()`.
  - `matches.updated_at` est mis à jour à chaque sync (aujourd'hui il ne l'est jamais).
  - `atomic` = `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`.
- [ ] Tests `server/stores_test.ts` :
  - rejouer le même batch deux fois, vérifier qu'il n'y a pas de doublon et que l'ACK est identique ;
  - un nouveau match termine l'ancien match actif du même device ;
  - une exception au milieu de l'`atomic` entraîne un rollback complet.
- [ ] `deno test --allow-all supabase/functions/ server/` au vert.
- [ ] Commit `feat(server): store SQLite du sync, propriété du match liée à la clé`

## Tâche 3 — Stores score-text, chat-announce, names, register et pick

- [ ] `pickScore(db, channel)` : match actif le plus récent du canal, sinon le plus récent tout statut. Tri `started_at DESC NULLS LAST`. Renvoie `{ status, current_set, score_me, score_opp, sets_me, sets_opp, config, updated_at }` ou `null`. C'est **l'unique** implémentation du pick : `latestMatch` (score-text, chat-announce) s'appuie dessus.
- [ ] `RegisterDb.createChannel` : intercepter `SQLITE_CONSTRAINT_UNIQUE` et renvoyer `{ error: "taken" }`. Le handler répond 409. Test associé.
- [ ] `NamesDb`, `AnnounceDb.channels()`, `lastAnnounced` / `saveAnnounced` : équivalents directs des requêtes de `index.ts`.
- [ ] Tests :
  - `pickScore` avec un actif ancien et un terminé récent : l'actif gagne ;
  - `pickScore` sans actif : le plus récent est renvoyé ;
  - `pickScore` avec `started_at` null : placé en dernier ;
  - noms : GET puis POST, aller-retour.
- [ ] Commit `feat(server): stores SQLite score/noms/canaux/annonce + pick unique`

## Tâche 4 — Serveur HTTP, SSE et CORS

- [x] Routes de `server/main.ts` :

  | Route | Comportement |
  |---|---|
  | `POST /functions/v1/sync/matches/:id/events` | `handleSync` |
  | `GET /functions/v1/score-text` | `handleScoreText` |
  | `GET\|POST /functions/v1/chat-announce` | `handleChatAnnounce`, 503 si `CHAT_ANNOUNCE_KEY` absente |
  | `GET\|POST /functions/v1/names` | GET : `handleNamesGet` ; POST : `handleNamesPost` |
  | `POST /functions/v1/register` | `handleRegisterPost` |
  | `GET /api/score?channel=` | JSON `pickScore` (ou `null`), `Cache-Control: no-store` |
  | `GET /api/stream?channel=` | SSE : envoie l'état courant à l'ouverture, puis `publish` à chaque sync 200 du canal, `: ping` toutes les 25 s |
  | `GET /healthz` | `ok` + `SELECT 1` |

  `channel` est validé partout avec `^[A-Za-z0-9_-]{1,32}$`.
- [ ] CORS global : preflight `OPTIONS` en 204, `Access-Control-Allow-Origin: *`, `Allow-Headers: X-Device-Key, Content-Type`.
- [ ] Limites :
  - corps de requête de 64 Ko maximum (413 au-delà) ;
  - 200 connexions SSE maximum par processus (503 au-delà) ;
  - nettoyage d'un abonné SSE sur `request.signal` abort.
- [ ] Config par env :
  - `RS_DB` (défaut `./racketstream.db`) ;
  - `RS_PORT` (défaut 8790) ;
  - `RS_HOST` (défaut 127.0.0.1) ;
  - `SE_JWT` et `CHAT_ANNOUNCE_KEY` (optionnelles).
- [ ] Tests `server/main_test.ts` : serveur sur un port éphémère avec base `:memory:`.
  - Sync complet avec clé seedée, puis `/api/score` qui reflète le score.
  - Ouvrir `/api/stream`, faire un sync, vérifier qu'un événement `data:` est reçu en moins d'une seconde.
  - Preflight `OPTIONS /functions/v1/names` : 204 avec les en-têtes attendus.
  - Corps de 100 Ko : 413.
- [ ] Lancement local : `deno run --allow-net=127.0.0.1:8790,api.streamelements.com --allow-read=. --allow-write=. --allow-env=RS_DB,RS_PORT,RS_HOST,SE_JWT,CHAT_ANNOUNCE_KEY server/main.ts`
- [ ] Commit `feat(server): serveur HTTP Deno (routes functions/v1, /api/score, SSE)`

## Tâche 5 — Déploiement sur le VPS

Le VPS est **partagé** (autres sites Caddy, Docker, MediaMTX). Règles de cette tâche :
- ne jamais faire `restart caddy`, seulement `validate` puis `reload` ;
- ne pas toucher à MediaMTX ;
- ne rien afficher de `/etc/racketstream/`.

- [x] Installer Deno **2.9.7** dans `/usr/local/bin/deno` (zip officiel, SHA-256 vérifiée).
- [x] Préparer le système :
  - compte dédié **`rs-api`** (système, `nologin`, sans sudo). Le compte `racketstream` existant fait tourner MediaMTX et le relais ffmpeg et il est sudoer : on ne l'utilise pas ;
  - code dans `/opt/racketstream-api` (root:root, lecture seule pour le service ; `/opt/racketstream` reste au renderer) ;
  - données dans `/var/lib/racketstream-api` (`StateDirectory`, 0750) ;
  - `/etc/racketstream/api.env` en root:rs-api 0640.
- [x] Unités `server/deploy/racketstream-api.service`, `racketstream-backup.{service,timer}`, installées par `scripts/deploy-vps.sh`.
- [ ] Sauvegardes : `racketstream-backup.timer`, une fois par jour à 04:00. Il lance `sqlite3 racketstream.db ".backup …"` vers `/var/lib/racketstream-api/backups/` et garde 14 jours. Le disque est à 78 %, mais la base pèse quelques Mo.
- [ ] Copie vers le Mac (demande utilisateur) : `scripts/backup-vps-to-mac.sh` récupère la dernière sauvegarde du jour (`ssh racketstream-vps sudo cat …/backups/<dernier>.db`) vers `~/Backups/racketstream/`, en gardant 30 copies, puis vérifie `PRAGMA integrity_check`. Lancement manuel, ou quotidien via un agent `launchd` (`~/Library/LaunchAgents/`), qui se rattrape au réveil du Mac.
- [ ] `scripts/deploy-vps.sh` :
  1. rsync de `server/` et `supabase/functions/` (les handlers sont importés) vers `/opt/racketstream-api` ;
  2. `systemctl restart racketstream-api` (ne concerne que ce service) ;
  3. `curl -fsS http://127.0.0.1:8790/healthz`.
- [ ] Caddy :
  1. sauvegarder le Caddyfile ;
  2. remplacer `respond "…en construction"` par `reverse_proxy 127.0.0.1:8790 { flush_interval -1 }` (indispensable pour le SSE) ;
  3. `caddy validate` puis `systemctl reload caddy` ;
  4. vérifier que les autres sites répondent toujours (budget 200, rituel 200, what-shall-we-play 307).
- [ ] Vérification depuis le Mac : `curl https://racket-stream.marc-suarez.fr/healthz` renvoie `ok`.
- [x] **[USER ACTION]** Renseigner les deux secrets du serveur, que Claude ne lit pas :
  1. `ssh racketstream-vps`, puis `sudoedit /etc/racketstream/api.env` ;
  2. ajouter `SE_JWT=<jeton>` (StreamElements → Account → Channels → Show secrets → JWT Token ; jeton de secours, utilisé si le canal n'a pas son propre `se_jwt`) ;
  3. ajouter `CHAT_ANNOUNCE_KEY=<clé>` (la valeur de `?key=` de l'appel `chat-announce` ; reprendre l'actuelle ou en générer une avec `openssl rand -hex 16`) ;
  4. `sudo systemctl restart racketstream-api`.

  Ghostty : le VPS ne connaît pas `xterm-ghostty` → `TERM=xterm-256color`, ou `sudo sh -c 'cat >> …/api.env'` puis Ctrl+D.
- [ ] Commit `feat(server): déploiement systemd + Caddy sur le VPS`

## Tâche 6 — Import des données Supabase

- [ ] **[USER ACTION]** Créer `.secrets/supabase-service.env` avec `SUPABASE_SERVICE_ROLE_KEY=…` (Dashboard → Settings → API). Fichier non commité.
- [ ] `server/tools/import-supabase.ts` :
  - lit les tables via PostgREST avec la service role, paginé par 1000 ;
  - écrit un fichier `.db` local dans une transaction ;
  - `owner_id` est déduit de `matches.channel` → `devices.channel` ;
  - idempotent : `INSERT OR REPLACE`.
- [ ] Contrôles affichés : nombre de lignes par table côté Supabase et côté SQLite, et nombre de canaux en doublon. Si un doublon existe, **l'import s'arrête** et le cas est soumis à l'utilisateur.
- [ ] Copier la base sur le VPS (`scp` puis `install -o racketstream`, service arrêté), puis relancer le service.
- [ ] Vérification : `curl …/api/score?channel=marc` et `…/functions/v1/names?channel=marc` donnent les mêmes valeurs que Supabase.
- [ ] Commit `feat(server): outil d'import Supabase → SQLite`

## Tâche 7 — Overlay OBS et widget StreamElements

- [ ] `overlay/index.html` :
  - suppression de supabase-js et de la clé anon ;
  - `EventSource(BASE + "/api/stream?channel=")` ;
  - polling `/api/score` toutes les 10 s en filet de sécurité, plus au retour d'onglet ;
  - noms via `BASE + "/functions/v1/names"`.
  
  Paramètre URL `&api=` pour pointer ailleurs, utile en local.
- [ ] Anti-fantôme web, aligné sur le renderer : si `updated_at` date de plus de 600 s et que le match est encore actif, l'overlay est masqué.
- [ ] `overlay/se-widget/js.js` : polling `/api/score` toutes les 2 s (StreamElements n'autorise pas forcément `EventSource`, on garde donc le polling). Suppression des en-têtes `apikey`.
- [ ] Mettre à jour `sim.html` et le test Playwright : la réponse mockée prend le format `/api/score`.
- [ ] Commit `feat(overlay): lecture du score via l'API VPS (SSE + /api/score)`

## Tâche 8 — Renderer VPS et portail

- [ ] `vps/renderer.py` :
  - nouvelle option `--url` (défaut `https://racket-stream.marc-suarez.fr`). Sur le VPS, utiliser `--url http://127.0.0.1:8790`, sans passer par Caddy ;
  - `make_url` pointe vers `/api/score?channel=` ;
  - la fraîcheur (`--stale`) et le comportement « Supabase injoignable → dernière frame » restent identiques (le libellé devient « API injoignable ») ;
  - suppression de la clé anon.
  
  Adapter `vps/tests/test_pick.py`, puis lancer `python3 -m pytest vps/tests`.
- [ ] Redémarrer le renderer sur le VPS. **Confirmer avec l'utilisateur au préalable : pas de live en cours.**
- [ ] `portal/index.html` : `SUPABASE` devient `API = "https://racket-stream.marc-suarez.fr"`. Les chemins sont inchangés.
- [ ] Tests manuels du portail :
  - créer un canal de test : la clé est affichée ;
  - enregistrer des noms ;
  - les relire.
  
  Supprimer ensuite le canal de test en SQL sur le VPS.
- [ ] Commit `feat(vps,portal): renderer et portail branchés sur l'API VPS`

## Tâche 9 — Builds montre (sideload)

- [ ] **[USER ACTION]** Dans `.secrets/phase-4a.env` et `phase-4a-friend.env`, remplacer `SUPABASE_URL=https://racket-stream.marc-suarez.fr`. Les clés device ne changent pas : leurs hashs ont été importés.
- [ ] `scripts/build-release.sh` (marc), puis `FRIEND=1 scripts/build-release.sh`. Vérifier que `BackendConfig.mc` du dépôt reste vide (`git diff --exit-code watch/connect-iq/source/services/BackendConfig.mc`).
- [ ] Test en conditions réelles sur l'epix avec GCM :
  - jouer 5 points, le score s'affiche dans l'overlay en moins de 2 s ;
  - undo ;
  - nouveau match : l'ancien passe à `finished` ;
  - annonce dans le chat.
- [ ] Noter les résultats dans `docs/superpowers/notes/2026-10-xx-phase-8-backend-vps.md`.

## Tâche 10 — Build store

- [ ] `STORE=1 scripts/build-release.sh` puis `scripts/build-store-iq.sh`, avec l'URL cuite VPS et `DEVICE_KEY` vide. La purge des `.mir`/`.prg` est conservée.
- [ ] Incrémenter la version du manifest et ajouter une note de version : « nouveau serveur, aucune action requise ».
- [ ] **[USER ACTION]** Dépôt sur le Connect IQ Store.

## Tâche 11 — Coexistence puis arrêt de Supabase

> État au 09/10/2026 : l'app est en **beta** sur le store et aucun live n'est en cours. La coexistence est donc courte : peu d'installations à faire migrer.

- [ ] Pendant la transition, les anciennes versions store continuent d'écrire sur Supabase. Les canaux créés côté Supabase après l'import (tâche 6) seraient alors absents du VPS. Pour l'éviter :
  - bandeau dans le portail GitHub Pages (déjà basculé sur le VPS) : les nouveaux canaux sont créés sur le VPS ;
  - à J+7, relancer `import-supabase.ts` en mode `--devices-only` pour rattraper les canaux.
- [ ] Critère d'arrêt : aucun sync sur Supabase depuis 14 jours (`select max(updated_at) from match_state`).
- [ ] Ensuite :
  - passer les Edge Functions en réponse `410 Gone` ;
  - exporter un dump final dans `docs/local/` (gitignoré) ;
  - mettre le projet Supabase en pause.
  
  **Décision de l'utilisateur, à ne pas prendre seul.**

## Tâche 12 — Documentation

- [ ] `CLAUDE.md` :
  - schéma d'architecture ;
  - section « Composants » : `server/` et le pick désormais **unique** côté serveur (supprimer la règle « répercuter partout ») ;
  - commandes : tests serveur, `scripts/deploy-vps.sh`, logs (`journalctl -u racketstream-api`) ;
  - pièges : `flush_interval -1`, VPS partagé.
- [ ] `docs/tuto-relais-rtmp-vps.md` : `--url http://127.0.0.1:8790` pour le renderer.
- [ ] `docs/guide-utilisateur.md` : URL de l'overlay inchangée, portail inchangé. Mentionner la mise à jour de l'app.
- [ ] Commit `docs: backend VPS (architecture, déploiement, exploitation)`

---

## Risques et parades

| Risque | Parade |
|---|---|
| Panne du VPS = plus de sync | La montre est offline-first : le journal attend et se renvoie. L'overlay garde la dernière frame. Supervision : `/healthz` en vérification externe gratuite (UptimeRobot), à décider. |
| Perte de la base | Sauvegarde quotidienne locale. **Recommandé** : copie hors VPS (rsync vers le Mac ou un stockage objet), à décider en tâche 5. |
| SSE coupé par un proxy | `flush_interval -1` dans Caddy, ping toutes les 25 s, polling de secours toutes les 10 s dans l'overlay. |
| Saturation du VPS partagé | `MemoryMax=256M`, plafond de connexions SSE, limite de corps à 64 Ko. |
| Canal créé sur Supabase après l'import | Second import des `devices` à J+7 (tâche 11). |
