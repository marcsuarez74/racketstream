# Infrastructure pour 100 clubs en simultané

Note du 2026-10-10 (phase 10). Objectif : savoir ce qu'il faudrait pour que **100 clubs jouent en même temps**, avec leurs terrains en direct. Ce sont des **estimations** à confirmer par un test de charge (voir § 6).

## En bref

| Ce qu'on veut servir | Verdict | Ce qu'il faut |
|---|---|---|
| **Score en direct** : montres, scoreurs web, portail, pages publiques, overlays OBS | ✅ Facile | Un VPS dédié modeste (4 vCPU, 8 Go), plus 6 réglages dans le code (§ 4). |
| **Vidéo incrustée par le VPS** (relais téléphone → VPS → Twitch) | ❌ Pas à cette échelle | Environ 1 cœur et 9 Mbit/s **par live**. 100 lives, c'est une autre infrastructure (§ 5). |

Le score coûte très peu : quelques centaines d'octets par point. La vidéo coûte cher : un ré-encodage continu par live. **Pour 100 clubs, l'incrustation doit se faire chez le club (OBS + overlay)**, pas sur notre serveur.

## 1. Infrastructure actuelle

- **VPS partagé** avec d'autres sites perso (Caddy, Docker, MediaMTX).
  - **2 vCPU** (AMD EPYC Genoa), **4 Go** de RAM, dont environ 2,6 Go disponibles.
  - Disque de 58 Go, **rempli à 79 %** (13 Go libres).
- **API** : un seul processus Deno + SQLite (WAL, `busy_timeout` à 5 s).
  - Le service systemd est plafonné à **`MemoryMax=256M`**. Il en consomme environ 90 Mo aujourd'hui.
- **Flux en direct (SSE)** : le hub accepte **200 connexions au plus** (`Hub(max = 200)`, dans `server/hub.ts`). Au-delà, l'API répond 503.
- **Un club peut avoir 16 terrains au plus** (`MAX_TERRAINS`).

## 2. Hypothèses de charge (100 clubs)

| Paramètre | Hypothèse | Pire cas |
|---|---|---|
| Terrains en match par club | 4 → **400 terrains** | 16 → 1 600 |
| Fréquence des points (badminton, squash) | 1 point / 12 s / terrain | 1 point / 6 s |
| Personnes qui regardent un club (TV de la salle, téléphones, portail, overlays) | 30 → **3 000 connexions SSE** | 100 → 10 000 |
| Terrains filmés avec l'overlay OBS (chez le club) | 1 par club → 100 | 400 |
| Widgets StreamElements (relance toutes les 2 s) | 100 | 400 |
| Heures de jeu par jour | 3 h | 10 h |

## 3. Ce que ça donne, poste par poste

**Écritures (envois de points)**

- 400 terrains ÷ 12 s ≈ **35 envois/s** (70 envois/s en pointe).
- Chaque envoi fait quelques petites écritures SQLite en transaction.
- SQLite en WAL encaisse des milliers de petites écritures par seconde : **pas de souci**.
- Un seul processus écrit : c'est le bon modèle pour SQLite.

**Flux en direct (SSE)**

- Chaque point est diffusé aux abonnés du terrain et à ceux du club.
- 35 points/s × environ 30 abonnés, de 300 octets chacun, font environ **1 000 messages/s**, soit environ 300 Ko/s, environ 2,5 Mbit/s : **négligeable**.
- **Le vrai blocage, c'est la limite de 200 connexions.** Il faut tenir au moins 3 000 connexions, et viser 10 000.
- Une connexion SSE ouverte coûte quelques dizaines de Ko dans Deno, plus un descripteur de fichier. 3 000 à 10 000 connexions demandent donc de 150 à 500 Mo de RAM, et une limite `LimitNOFILE` relevée.

**Lectures régulières (polling)**

- Widgets StreamElements : 100 à 400 × 0,5 requête/s = **50 à 200 requêtes/s** sur `/api/score`.
- Noms relus toutes les 60 s par chaque page publique : 3 000 pages × 4 terrains ÷ 60 s ≈ **200 requêtes/s** sur `names`.
- Total : environ 400 requêtes/s de lectures simples (une requête indexée chacune). C'est tenable pour Deno et SQLite sur 4 vCPU, mais **c'est le premier poste à optimiser** (§ 4).

**Disque**

- Un event, c'est environ 250 octets en comptant l'index.
- Cas de base : 400 terrains × 300 points/h × 3 h ≈ 360 000 events/jour, soit **~90 Mo/jour, ~3 Go/mois**.
- Pire cas (10 h/jour) : ~300 Mo/jour.
- **Avec 13 Go libres et sans purge, le disque est plein en quelques mois.** Les sauvegardes quotidiennes de la base complète grossissent au même rythme.

**Réseau**

- Score seul : quelques Mbit/s.
- Le débit compris dans l'offre de l'hébergeur est à vérifier, mais le score seul n'en a pas besoin de beaucoup.

## 4. Palier « score pour 100 clubs » : ce qu'il faut faire

**Machine**

- **Un VPS dédié à RacketStream** : 4 vCPU, 8 Go de RAM, au moins 80 Go de SSD.
- Il doit être séparé des sites perso, pour qu'un pic d'un côté ne gêne pas l'autre.
- Caddy reste en frontal.

**Réglages et code**

| # | Changement | Où |
|---|---|---|
| 1 | Limite SSE de 200 à **10 000** (variable d'env `RS_SSE_MAX`) | `server/hub.ts`, `main.ts` |
| 2 | `MemoryMax` de 256M à **1G** ; `LimitNOFILE=65536` | `server/deploy/racketstream-api.service` |
| 3 | **Noms des joueurs inclus dans le flux du club** et dans `GET /api/clubs/:slug` : la page publique ne relit plus `names` toutes les 60 s (environ −200 requêtes/s) | `server/main.ts`, `portal/club.html` |
| 4 | Widget StreamElements : passer au SSE, ou relancer toutes les 5 s au lieu de 2 s | `overlay/se-widget/` |
| 5 | **Purge** : supprimer les events des matchs archivés ou terminés depuis plus de 30 jours (garder `match_state` et `matches` pour l'historique), puis `VACUUM` mensuel | nouvelle commande `server/admin.ts` + timer systemd |
| 6 | Index sur `match_state(match_id)` et `events(match_id, sequence)` à vérifier sous charge (`EXPLAIN QUERY PLAN`) | `server/migrations/` |

**Exploitation**

- **Surveillance** : sonde externe sur `/healthz` toutes les minutes, avec alerte par e-mail ou téléphone.
- **Alerte disque** au-delà de 80 %.
- **Sauvegardes hors du VPS, automatiques** : aujourd'hui `backup-vps-to-mac.sh` se lance à la main. Il faudrait une copie quotidienne vers un stockage objet.
- **Déploiements** : avec 100 clubs, il y aura presque toujours un live en cours. Le redémarrage de l'API coupe les flux SSE quelques secondes.
  - Les clients se reconnectent seuls (`EventSource`), et les montres ou scoreurs renvoient leurs points (file d'envoi, idempotence).
  - **C'est donc acceptable**, à condition de déployer aux heures creuses et de vérifier que chaque client se reconnecte.
  - La règle actuelle « ne pas redéployer pendant un live » devient impossible à tenir. On la remplace par « déployer aux heures creuses ».
- **Un seul serveur reste un point de panne unique.**
  - Pour 100 clubs payants, c'est acceptable si la remise en route est rapide : sauvegarde récente, script d'installation, DNS court.
  - Au-delà, il faudra un second serveur en secours, avec une réplication SQLite de type Litestream.

**Ce qu'on garde** : SQLite et un seul processus Deno suffisent largement à ce palier. Pas besoin de Postgres, de Redis ni de plusieurs serveurs avant plusieurs centaines de clubs.

## 5. Vidéo incrustée par le VPS : pourquoi ça ne passe pas à 100

Le relais actuel (`docs/tuto-relais-rtmp-vps.md`) suit ce chemin : le téléphone filme et envoie le flux au VPS (MediaMTX). Le VPS incruste le scorebug du renderer (Pillow, 2 i/s), **ré-encode** en x264 720p (`veryfast`, **4,5 Mbit/s**), puis publie sur Twitch.

Pour **un** live, il faut :
- **CPU** : environ 1 à 1,5 vCPU pour l'encodage x264 720p.
- **Réseau** : environ 4,5 Mbit/s en entrée et 4,5 Mbit/s en sortie.

| Lives simultanés | CPU | Réseau |
|---|---|---|
| 1 (aujourd'hui) | ~1 vCPU | ~9 Mbit/s |
| 10 | ~10 à 15 vCPU | ~90 Mbit/s |
| 100 | ~100 à 150 vCPU | **~0,9 Gbit/s soutenu** |

Il y a trois façons d'en sortir :

1. **Recommandé : l'incrustation se fait chez le club.**
   - Le club filme avec OBS, ou avec une appli mobile qui accepte une source navigateur, et ajoute l'overlay `overlay/?channel=<terrain>`.
   - Coût serveur : nul (un flux SSE de plus).
   - C'est déjà prêt : chaque terrain a son lien OBS dans l'onglet Club.
2. **Option payante en plus, à nombre limité** : garder le relais VPS pour quelques clubs, sur des serveurs séparés de l'API. Il faudrait 1 VPS de 8 vCPU pour environ 5 lives, ou une machine avec encodage matériel (GPU NVENC), qui encaisse plusieurs dizaines de flux 720p. À chiffrer selon l'hébergeur.
3. **Service vidéo tiers** (relais ou incrustation dans le cloud) : il est facturé à la minute. À étudier seulement si la demande de lives incrustés est forte.

Dans tous les cas, le relais vidéo ne doit **jamais tourner sur la même machine que l'API de score** : un pic d'encodage ralentirait tous les scores.

## 6. Avant de s'engager : test de charge

1. Écrire un petit script (Deno) qui simule 400 terrains, chacun envoyant un point toutes les 12 s sur des canaux d'essai, et ouvre 3 000 connexions SSE de clubs.
2. Le lancer contre une **copie** de l'API sur le futur VPS, jamais contre la production.
3. Mesurer :
   - le délai entre l'envoi d'un point et sa réception par un abonné SSE (objectif : moins de 0,5 s) ;
   - le CPU et la RAM de l'API ;
   - les erreurs et la taille de la base.
4. Relancer le test au pire cas (1 600 terrains, 10 000 connexions) pour connaître la marge.

## 7. Ordre conseillé

1. Purge des events (§ 4, n° 5) : utile dès maintenant, le disque est à 79 %.
2. Noms dans le flux du club (n° 3) et limite SSE en variable d'environnement (n° 1).
3. Test de charge (§ 6).
4. Migration vers un VPS dédié, surveillance, sauvegardes hors site, au moment où les premiers clubs payants arrivent.
5. Décision commerciale sur la vidéo incrustée (§ 5) : la proposer comme option limitée ou y renoncer au profit d'OBS.
