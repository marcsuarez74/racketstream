# Espace club multi-terrains et scoreur sans montre — conception

- **Date** : 2026-10-10
- **Statut** : validée le 2026-10-10, chantier lancé (branche `phase-10-clubs`). Fait suite à l'[idée prioritaire de l'offre clubs](2026-10-09-idees-offre-clubs.md) (« la feature banger »), réunie ici avec le « scoreur sans montre » de la même liste.
- **Principe** : **le terrain est au centre, la source du score est interchangeable.** Un terrain a une clé ; tout appareil qui la détient (montre Garmin ou téléphone/tablette) peut y saisir le score. Le serveur et les affichages ne font aucune différence entre les deux.

---

## 1. Pourquoi

- Un club veut diffuser plusieurs terrains à la fois (interclubs, tournois, finales).
- Une montre Garmin par terrain est une contrainte : tout le monde n'en a pas, et un club ne va pas en acheter. Il faut un autre moyen de saisir le score, **sans retirer la montre** : les deux doivent rester possibles, y compris sur un même terrain d'un match à l'autre.

## 2. Ce qui existe (rappel)

- `devices` = 1 clé (hash SHA-256) = 1 canal (`channel`, regex `^[A-Za-z0-9_-]{1,32}$`), avec `label`, noms et format, config StreamElements. Pas de propriétaire au-dessus, pas de compte.
- `register` crée un canal sans authentification (beta privée) et renvoie la clé une seule fois. Le portail garde `{channel, key}` dans le `localStorage`.
- `sync` : la montre envoie `config`, `snapshot` (état calculé **par le client**), `events` (≤ 10), `stop`. Idempotence `UNIQUE(match_id, sequence)`. Un nouveau match passe les autres matchs actifs du même `owner_id` en `finished`.
- Les affichages (portail, overlay, widget SE, renderer, annonce chat) lisent `/api/score` et `/api/stream` par canal.

Conséquence clé : **le score est calculé côté client**. Un scoreur web doit donc embarquer les règles du score (aujourd'hui uniquement en Monkey C).

## 3. Vue d'ensemble

```
Club « bcparis » (clé club : gestion uniquement)
 ├─ Terrain 1  canal bcparis-t1  (clé terrain) ◄── montre Garmin  ─┐
 ├─ Terrain 2  canal bcparis-t2  (clé terrain) ◄── téléphone (web) ├─► sync (inchangé) ─► affichages (inchangés)
 └─ Terrain 3  canal bcparis-t3  (clé terrain) ◄── tablette (web)  ─┘
Page publique : /#club/bcparis → tous les terrains en direct
```

- **Clé club** : sert à gérer le club (créer/renommer des terrains, régénérer leurs clés). Elle **n'envoie jamais de score**.
- **Clé terrain** : c'est l'actuelle clé device, inchangée. Elle seule permet d'envoyer des points. On peut la confier à un bénévole (lien ou QR) sans exposer la gestion du club.

## 4. Modèle de données (migration `user_version` 1 → 2)

```sql
CREATE TABLE clubs (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,      -- ^[a-z0-9-]{2,20}$, préfixe des canaux
  name          TEXT NOT NULL,             -- « BC Paris 15 », 1-48 caractères
  club_key_hash TEXT NOT NULL UNIQUE,      -- SHA-256, comme device_key_hash
  created_at    INTEGER NOT NULL
);
ALTER TABLE devices ADD COLUMN club_id  INTEGER REFERENCES clubs(id);  -- NULL = canal perso (cas actuel)
ALTER TABLE devices ADD COLUMN position INTEGER;                       -- ordre des terrains dans le club
CREATE INDEX devices_club ON devices(club_id, position);
```

- `schema.sql` n'est appliqué que si `user_version = 0` : il faut une **étape de migration** 1 → 2 dans `stores.ts` (et mettre `schema.sql` à jour pour les bases neuves). Sauvegarde de la base avant déploiement.
- On garde le nom `devices` (une ligne = un canal/terrain) pour ne pas toucher `sync` ni les handlers existants.
- Canal d'un terrain : `<slug>-t<n>` (ex. `bcparis-t1`), compatible avec la regex actuelle ; le nom affiché (« Terrain 1 », « Court central ») va dans `label`.
- Les canaux perso existants (`marc`, l'ami) restent tels quels, `club_id = NULL`.

## 5. API

Nouveau handler `supabase/functions/clubs/handler.ts` (logique pure, `Db` injectée, `handler_test.ts` en mémoire), câblé dans `server/main.ts` sous `/api/clubs…`, comme les autres.

| Route | Auth | Effet |
|---|---|---|
| `POST /api/clubs` `{slug, name, invite}` | code d'invitation à usage unique | crée le club, renvoie `{slug, clubKey}` une seule fois ; 403 si invitation invalide ou déjà utilisée ; 409 si `slug` pris |
| `GET /api/clubs/:slug` | public | `{name, terrains: [{channel, label, position}]}` |
| `POST /api/clubs/:slug/terrains` `{label}` | `X-Club-Key` | crée le terrain (canal `<slug>-t<n>`), renvoie `{channel, key}` une seule fois |
| `PATCH /api/clubs/:slug/terrains/:channel` `{label?, position?}` | `X-Club-Key` | renomme / réordonne |
| `POST /api/clubs/:slug/terrains/:channel/key` | `X-Club-Key` | **régénère la clé du terrain** (montre perdue, QR qui a circulé) ; l'ancienne ne marche plus |
| `GET /api/clubs/:slug/stream` | public | SSE : les mises à jour de tous les terrains du club (le `hub` publie déjà par canal) |

- Les clés ne sont stockées que hachées : le serveur ne peut jamais les réafficher. Le portail de l'admin les garde en local ; sur un autre appareil, on régénère.
- `names` reste par terrain, avec sa clé terrain (inchangé).
- Pas de suppression de terrain en v1 (renommer suffit ; la suppression pose la question de l'historique des matchs).

## 6. Deux appareils sur le même terrain

Comme la clé est partagée, une montre et un téléphone peuvent saisir sur le même terrain. Règle voulue : **le match démarré le plus récemment est celui qui s'affiche.**

**Défaut actuel à corriger (vérifié dans `sync/handler.ts` et `stores.ts`)** : `finishOtherActiveMatches` n'est appelé qu'au premier envoi d'un nouveau match, mais `upsertMatch` réécrit `status` à chaque envoi. Si l'ancien appareil continue d'envoyer, son match redevient `active`. Tant que le nouveau match est actif, l'affichage reste correct (le pick prend le `started_at` le plus récent). Mais dès que le nouveau match est arrêté (`stop` → `archived`) ou terminé, **l'ancien match revient à l'écran**.

Correction : un match qui n'est plus le plus récent du canal (un match plus récent existe pour le même `owner_id`) ne peut plus redevenir `active` : ses envois sont acceptés (points enregistrés, idempotence inchangée) mais son statut reste `finished` (ou `archived` sur `stop`). Tests dédiés dans `sync/handler_test.ts` et `server/main_test.ts`.

## 7. Scoreur web (sans montre)

Une page du portail, `#scorer`, utilisable sur téléphone ou tablette, installable (PWA existante).

**Accès** : par un lien qui contient la clé du terrain dans le fragment d'URL (`…/#scorer/bcparis-t1?k=<clé>`, le fragment n'est jamais envoyé au serveur ni aux logs). Ce lien sert aussi de **QR code** à afficher dans l'espace club (à imprimer et coller au poteau). Ou, plus simplement, depuis le menu des canaux du portail quand la clé y est déjà.

**Écrans** (même logique que la montre, en tactile) :
1. Préparation : sport (badminton, squash), format, noms des joueurs (pré-remplis via `names`).
2. Score : deux grandes zones « point équipe A / point équipe B », « annuler », indication du serveur, bouton « inverser les côtés » (changement de côté).
3. Fin : récap, « nouveau match » ou « terminer » (envoie `stop` → archivé, l'affichage se vide comme avec la montre).

**Envoi** : exactement le contrat `sync` de la montre (`deviceId` = UUID propre au navigateur, `match_id` UUID, `sequence`, `snapshot`, `stop`). Pas de contrainte Bluetooth : chaque point part tout de suite (lots ≤ 10, limite serveur). File d'attente dans le `localStorage` si le réseau coupe, renvoi au retour du réseau (l'idempotence côté serveur évite les doublons). Écran maintenu allumé (Wake Lock).

**Sports couverts : badminton et squash** (le même moteur `ScoreEngine` sur la montre). **Le padel est exclu** de ce chantier : il sera traité avec le tennis, dans un chantier commun « sports à jeux » qui comprendra aussi le padel côté stream (reporté en fin de phase 9). Une montre peut toujours lancer un match padel sur un terrain de club : il s'affiche comme aujourd'hui (points bruts).

**Règles du score : le gros du travail.** Elles n'existent qu'en Monkey C (`ScoreEngine.mc`, `Sports.mc`, `MatchConfig.mc`, `Rules.mc`, ~470 lignes). Plan :
- Port en JavaScript sans build : modules ES dans `portal/engine/`, importables par la page et par `deno test`.
- **Parité** : chaque test Monkey C du moteur (`source/tests/`) est porté à l'identique en test Deno, plus des scénarios complets (prolongations à 29-29/30, undo en changement de set, squash) dont on compare le `snapshot` final à celui de la montre.
- Toute modification future des règles devra être faite des deux côtés (à ajouter dans `CLAUDE.md`, comme pour la logique de « pick »).

## 8. Espace club dans le portail

Nouvelle section (même design « sportif ») :
- **Créer un club** (nom + identifiant court) → affiche la clé club une fois, avec la consigne de la noter.
- **Ajouter un club existant** avec sa clé club.
- **Liste des terrains** avec, pour chacun : statut en direct, renommer, « clé pour la montre » (affichée à la création ou après régénération), « QR scoreur », lien overlay OBS (`overlay/?channel=bcparis-t1`), régénérer la clé.
- Le menu déroulant des canaux montre les terrains du club regroupés sous son nom.

## 9. Page publique du club

`#club/<slug>` : grille de tous les terrains (nom, joueurs, score en direct, « en attente » si aucun match frais), alimentée par `GET /api/clubs/:slug` + `/api/clubs/:slug/stream`. Même règle de fraîcheur (10 min) que les autres affichages. Lien à partager aux parents, à afficher sur une TV du club.

## 10. Ce qui ne change pas

- La montre : aucune nouvelle version nécessaire. On lui donne une clé terrain (cuite pour un sideload, via les réglages GCM pour le store).
- `sync` (hors correction du § 6), overlay, widget SE, renderer VPS, annonce chat : ils travaillent déjà par canal.

## 11. Découpage proposé

| Lot | Contenu | Dépend de |
|---|---|---|
| 1 | Serveur : table `clubs`, migration 1 → 2, routes clubs/terrains, correction « ping-pong » (§ 6), tests | — |
| 2 | Portail : espace club (créer, terrains, clés, liens overlay) | 1 |
| 3 | Moteur JS + tests de parité avec la montre | — |
| 4 | Scoreur web (écrans, envoi, file hors ligne, QR) | 1, 3 |
| 5 | Page publique du club | 1 |

Les lots 1 et 3 sont indépendants et peuvent avancer en parallèle.

**Plus tard** (hors de cette conception) : tennis et padel (scoreur web + rendu côté stream),  logo et couleurs du club sur le bandeau, matchs de tournoi prévus par terrain, nom du terrain sur l'overlay, paiement (Stripe) et création de club réservée aux clubs abonnés, comptes email, YouTube.

## 12. Questions ouvertes

1. ~~Clé club ou compte email ?~~ **Décidé (2026-10-10) : clé club.** Clé perdue → régénération à la main sur le VPS (`server/admin.ts club-key`).
2. ~~Création ouverte ou sur invitation ?~~ **Décidé (2026-10-10) : sur invitation**, codes à usage unique générés par Marc (`scripts/club-invite.sh`), stockés hachés (table `club_invites`).
3. **Prix** : par club ou par terrain ? (voir la note offre clubs) — n'impacte pas le code v1.
4. **Validation terrain** : la note offre clubs prévoyait de montrer l'overlay à un ou deux clubs avant de coder. Le scoreur web rend la démo plus facile (un téléphone suffit).
