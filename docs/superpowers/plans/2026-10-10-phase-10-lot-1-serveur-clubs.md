# Phase 10 — Lot 1 : serveur clubs et terrains — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le serveur VPS sait gérer des clubs : création sur invitation, terrains (un canal + une clé par terrain), renommage, régénération de clé, lecture publique du club et flux SSE de tous ses terrains. Une montre ou n'importe quel client `sync` envoie déjà sur un terrain sans changement.

**Conception de référence :** [`specs/2026-10-10-espace-club-multi-terrains-design.md`](../specs/2026-10-10-espace-club-multi-terrains-design.md) (§ 4, 5, 6).

**Décisions (validées par Marc le 2026-10-10) :**
- **D-1** : accès club par **clé club** (48 hex, hachée SHA-256), pas de compte email. Clé perdue → régénération à la main sur le VPS (`server/admin.ts club-key`).
- **D-2** : création de club **sur invitation** : codes à usage unique générés par Marc (`scripts/club-invite.sh`), stockés hachés.
- **D-3** : pas de câblage Supabase (`index.ts`) pour les nouveaux handlers : le projet Supabase est en sursis, seul le VPS sert les clubs. Le handler reste pur (`Db` injectée) et testé en mémoire comme les autres.
- **D-4** : on garde la table `devices` (une ligne = un canal/terrain) : `sync`, `names` et l'annonce chat ne changent pas.
- **D-5** : le padel n'est pas concerné (reporté au chantier tennis/padel).

**Branche :** `phase-10-clubs`. Commit à chaque tâche, messages `feat(server): …`, `fix(sync): …`, `test(server): …`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `server/migrations/002_clubs.sql` | **créé** — tables `clubs`, `club_invites`, colonnes `devices.club_id`, `devices.position` |
| `server/db.ts` | migrations séquentielles après le schéma de base |
| `server/db_test.ts` | base neuve → v2 ; base v1 existante → v2 sans perte |
| `supabase/functions/_shared/keys.ts` | **créé** — `newKey()` (24 octets → 48 hex) et `sha256Hex` partagés |
| `supabase/functions/register/handler.ts` | utilise `_shared/keys.ts` (aucun changement de comportement) |
| `supabase/functions/sync/handler.ts` (+ test) | match supplanté ne redevient pas `active` (§ 6) |
| `supabase/functions/clubs/handler.ts` | **créé** — routes clubs/terrains, logique pure |
| `supabase/functions/clubs/handler_test.ts` | **créé** — Db en mémoire |
| `server/stores.ts` (+ `stores_test.ts`) | `sqliteClubsDb`, `newerMatchExists` |
| `server/main.ts` (+ `main_test.ts`) | routes `/api/clubs…`, SSE club, CORS (`X-Club-Key`, `PATCH`) |
| `server/admin.ts` (+ `admin_test.ts`) | **créé** — CLI `invite` et `club-key <slug>`, lancée sur le VPS |
| `scripts/club-invite.sh`, `scripts/club-key.sh` | **créés** — enveloppes `ssh racketstream-vps` |
| `CLAUDE.md` | clubs, migrations, commandes admin |

---

## Tâche 1 — Migrations de schéma (v1 → v2)

Aujourd'hui `db.ts` n'applique `schema.sql` que si `user_version = 0`. On garde `schema.sql` tel quel (base v1) et on ajoute des migrations numérotées appliquées dans l'ordre.

- [ ] **Test d'abord** (`server/db_test.ts`) :
  - base `:memory:` neuve → `user_version = 2`, tables `clubs` et `club_invites` présentes, `devices` a `club_id` et `position` ;
  - base créée avec le seul `schema.sql` (v1) + une ligne `devices` + un match → après `openDb`, `user_version = 2`, ligne et match intacts, `club_id IS NULL` ;
  - double ouverture : la migration ne se rejoue pas.
- [ ] `server/migrations/002_clubs.sql` :

```sql
-- Phase 10 : clubs multi-terrains. Un club possède des canaux (devices).
CREATE TABLE clubs (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  club_key_hash TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);
-- Codes d'invitation à usage unique (hachés). used_at/club_id remplis à l'usage.
CREATE TABLE club_invites (
  code_hash  TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  used_at    INTEGER,
  club_id    INTEGER REFERENCES clubs(id)
);
ALTER TABLE devices ADD COLUMN club_id  INTEGER REFERENCES clubs(id);
ALTER TABLE devices ADD COLUMN position INTEGER;
CREATE INDEX devices_club ON devices(club_id, position);
PRAGMA user_version = 2;
```

- [ ] `db.ts` : après le `SCHEMA` éventuel, boucle sur `MIGRATIONS = [[2, "002_clubs.sql"]]` ; pour chaque version > `user_version`, `BEGIN; exec; COMMIT` (ROLLBACK si erreur, et on lève : le service ne démarre pas sur une base à moitié migrée).
- [ ] `deno test --allow-all server/` vert. Commit `feat(server): migrations de schéma, tables clubs (v2)`.

## Tâche 2 — Match supplanté (§ 6)

- [ ] **Test d'abord** (`sync/handler_test.ts`, Db en mémoire étendue) : match A démarré à t0, puis match B démarré à t1 > t0 sur la même clé ; A renvoie un point → A reste `finished`, B `active`. B envoie `stop` → B `archived`, A toujours `finished`. Cas témoin : undo après `match_finished` sur le match le plus récent → redevient `active` (comportement actuel conservé).
- [ ] Interface `Db` : `newerMatchExists(ownerId: number, matchId: string, startedAt: number | null): Promise<{ newer: boolean; error: string | null }>`.
- [ ] `handleSync` : si le match existe déjà et que le statut calculé est `active`, appeler `newerMatchExists` ; si `newer`, statut `finished`. `stop` → `archived` inchangé.
- [ ] `stores.ts` :

```sql
SELECT EXISTS (
  SELECT 1 FROM matches o
  WHERE o.owner_id = ? AND o.match_id <> ?
    AND o.started_at > COALESCE((SELECT started_at FROM matches WHERE match_id = ?), ?)
) AS newer
```
  (`started_at` inconnu des deux côtés → pas plus récent : comportement actuel.)
- [ ] Test bout en bout dans `main_test.ts` : après `stop` de B, `/api/score?channel=marc` renvoie `null` (et pas A).
- [ ] Commit `fix(sync): un match supplanté ne redevient plus actif`.

## Tâche 3 — Clés partagées

- [ ] `supabase/functions/_shared/keys.ts` : `newKey(): string` (24 octets aléatoires → 48 hex) et réexport de `sha256Hex` depuis `sync/handler.ts`.
- [ ] `register/handler.ts` l'utilise (supprimer sa copie locale de `sha256Hex`). `register/handler_test.ts` inchangé et vert.
- [ ] Commit `refactor(register): génération de clé partagée`.

## Tâche 4 — Handler clubs (logique pure)

`supabase/functions/clubs/handler.ts`, une fonction `handleClubs(req, db): Promise<Response>` qui route sur `URL.pathname` (préfixe `/api/clubs`).

Interface :

```ts
export interface Terrain { channel: string; label: string; position: number }
export interface ClubsDb {
  // Consomme le code s'il est valide et libre, crée le club : atomique.
  createClub(slug: string, name: string, keyHash: string, inviteHash: string):
    Promise<{ error: null | "invite" | "taken" | string }>;
  getClub(slug: string): Promise<{ id: number; name: string; terrains: Terrain[] } | null>;
  clubIdByKey(slug: string, keyHash: string): Promise<number | null>;
  // Canal <slug>-t<n> avec n libre ; position = dernière + 1.
  createTerrain(clubId: number, slug: string, label: string, keyHash: string):
    Promise<{ channel: string | null; error: string | null }>;
  updateTerrain(clubId: number, channel: string, f: { label?: string; position?: number }): Promise<{ found: boolean }>;
  setTerrainKey(clubId: number, channel: string, keyHash: string): Promise<{ found: boolean }>;
}
```

Règles de validation (constantes en tête de fichier) :
- `slug` : `^[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])$` (2-20 caractères) ; `name` : 1-48 caractères après `trim` ; `label` : 1-24 caractères ; `invite` : 1-64 caractères.
- Au plus **16 terrains** par club (409 `limite` au-delà).
- `X-Club-Key` absent → 401 ; clé fausse ou club inconnu → 401 (même réponse, pas d'indice sur l'existence).

| Requête | Réponses |
|---|---|
| `POST /api/clubs` `{slug, name, invite}` | 200 `{slug, clubKey}` · 400 champ · 403 `invite` · 409 `slug` |
| `GET /api/clubs/:slug` | 200 `{slug, name, terrains:[{channel,label,position}]}` (tri `position`) · 404 |
| `POST /api/clubs/:slug/terrains` `{label}` | 200 `{channel, label, key}` · 400 · 401 · 409 `limite` |
| `PATCH /api/clubs/:slug/terrains/:channel` `{label?, position?}` | 200 `{ok:true}` · 400 · 401 · 404 (terrain d'un autre club inclus) |
| `POST /api/clubs/:slug/terrains/:channel/key` | 200 `{channel, key}` · 401 · 404 |
| autre méthode / chemin | 405 / 404 |

- [ ] **Tests d'abord** (`handler_test.ts`, Db en mémoire) : chaque ligne du tableau, plus : invitation déjà utilisée → 403 ; la clé renvoyée n'est jamais stockée en clair (seul son hash arrive dans la Db) ; la régénération change le hash ; un terrain d'un autre club → 404 ; corps non JSON → 400.
- [ ] Implémentation. Le `GET` public ne renvoie ni hash ni id interne.
- [ ] Commit `feat(clubs): handler clubs et terrains`.

## Tâche 5 — `sqliteClubsDb` (stores.ts)

- [ ] **Tests d'abord** (`stores_test.ts`) : création consomme l'invitation (deuxième usage → `invite`) ; `slug` pris → `taken` sans consommer l'invitation (transaction) ; `createTerrain` saute un canal existant (canal perso `bcparis-t1` déjà pris → `bcparis-t2`) ; terrains triés par `position` ; `updateTerrain` / `setTerrainKey` refusent le terrain d'un autre club ; après `setTerrainKey`, l'ancienne clé ne passe plus `getDeviceHash` (sync 401) et la nouvelle oui.
- [ ] `createClub` dans `store.atomic` : `UPDATE club_invites SET used_at = ? WHERE code_hash = ? AND used_at IS NULL` (0 ligne → `invite`), `INSERT INTO clubs`, puis `UPDATE club_invites SET club_id`. Violation `UNIQUE(slug)` → `taken` (ROLLBACK : invitation rendue).
- [ ] `createTerrain` : `n` = 1 + nombre de terrains du club, on incrémente tant que `<slug>-t<n>` existe dans `devices` ; `INSERT INTO devices (channel, device_key_hash, label, club_id, position)`.
- [ ] Commit `feat(server): stockage SQLite des clubs`.

## Tâche 6 — Câblage HTTP et SSE club (main.ts)

- [ ] `CORS` : `Access-Control-Allow-Headers: X-Device-Key, X-Club-Key, Content-Type`, `Allow-Methods: GET, POST, PATCH, OPTIONS`.
- [ ] `path.startsWith("/api/clubs/") || path === "/api/clubs"` → `handleClubs(req, clubsDb)`, sauf `GET /api/clubs/:slug/stream`.
- [ ] Réponse `GET /api/clubs/:slug` enrichie côté serveur : chaque terrain reçoit `score: pickScore(store, channel)` (la page publique n'a besoin que d'une requête).
- [ ] **SSE club** `GET /api/clubs/:slug/stream` : abonnement au sujet `club:<slug>` du `Hub` (même plafond global) ; message initial `{channel, score}` pour chaque terrain ; ping 25 s. Dans la route `sync`, après `hub.publish(channel, …)`, si le canal appartient à un club (`SELECT c.slug FROM devices d JOIN clubs c ON c.id = d.club_id WHERE d.channel = ?`), `hub.publish("club:" + slug, {channel, score})`. Un terrain créé après la connexion n'apparaît qu'à la reconnexion (acceptable en v1, à noter dans le code).
- [ ] **Tests bout en bout** (`main_test.ts`) : invitation insérée en base → `POST /api/clubs` → `POST …/terrains` → `sync` avec la clé du terrain → `GET /api/score?channel=<slug>-t1` reflète le score, et `GET /api/clubs/<slug>` aussi ; SSE club reçoit l'état initial puis le point en < 1 s ; `OPTIONS` renvoie les nouveaux en-têtes.
- [ ] `deno test --allow-all server/ supabase/functions/` vert. Commit `feat(server): routes clubs et flux SSE par club`.

## Tâche 7 — Commandes d'administration

`server/admin.ts` (déployé avec `server/`, lancé sur le VPS avec la même base) :
- `invite [n]` : génère `n` codes (défaut 1) lisibles, 12 caractères sans ambiguïté (`abcdefghjkmnpqrstuvwxyz23456789`, groupés `xxxx-xxxx-xxxx`), stocke leur hash, **affiche les codes une seule fois**.
- `club-key <slug>` : régénère la clé club (club qui a perdu sa clé), l'affiche une fois.
- Base lue dans `RS_DB` (comme le service).

- [ ] **Tests d'abord** (`admin_test.ts`) sur `:memory:` : code généré accepté une fois par `createClub` ; `club-key` sur slug inconnu → code de sortie 1 ; après `club-key`, l'ancienne clé club est refusée.
- [ ] `scripts/club-invite.sh` et `scripts/club-key.sh` : `ssh racketstream-vps "sudo -u rs-api env RS_DB=/var/lib/racketstream-api/racketstream.db /usr/local/bin/deno run --allow-read --allow-write --allow-env /opt/racketstream-api/server/admin.ts invite"`. Le normaliseur du code accepte majuscules et tirets absents.
- [ ] Commit `feat(server): commandes invite et club-key`.

## Tâche 8 — Docs

- [ ] `CLAUDE.md` : clubs dans la vue d'ensemble et `server/` (migrations numérotées, `server/admin.ts`), commandes `scripts/club-invite.sh` / `club-key.sh`, nouvelle règle « une règle de score modifiée doit l'être côté Monkey C et côté JS » (pour le lot 3).
- [ ] Spec : cocher le lot 1 au § 11.
- [ ] Commit `docs: lot 1 clubs (serveur)`.

## Tâche 9 — Déploiement (avec l'accord de Marc, hors live)

- [ ] Vérifier qu'aucun live n'est en cours (le restart coupe les flux SSE).
- [ ] Sauvegarde : `scripts/backup-vps-to-mac.sh` (la migration v2 modifie le schéma).
- [ ] `scripts/deploy-vps.sh` (tests, rsync, restart, `/healthz`).
- [ ] Contrôle : `sqlite3 -readonly … "PRAGMA user_version"` → 2 ; `GET /api/clubs/inconnu` → 404 ; canal `marc` : `/api/score` toujours correct.
- [ ] Essai réel : `scripts/club-invite.sh` → créer un club de test avec `curl`, un terrain, un point envoyé avec la clé du terrain → visible sur `/api/score`. (Le club de test pourra servir pour les lots 2 à 5.)

## Hors de ce lot

Portail (lot 2), moteur JS et scoreur web (lots 3-4), page publique (lot 5), suppression de terrain, nom du terrain sur l'overlay, paiement.
