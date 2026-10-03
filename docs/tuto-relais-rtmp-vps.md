# Tuto — Le relais VPS : streamer depuis le seul téléphone, overlay incrusté

- **Date** : 2026-09-23 · **Révision 2026-10-03**
- **Statut** : installée et validée en conditions réelles (P1→P4 de la spec [`2026-09-21-relais-rtmp-vps-overlay-design.md`](superpowers/specs/2026-09-21-relais-rtmp-vps-overlay-design.md))
- **Révision 2026-10-03** : trois pannes réelles diagnostiquées et corrigées — auto-ban
  fail2ban (piège n°10), ffmpeg 8 supprime `-rw_timeout` (piège n°11), fantôme Twitch
  v2 (piège n°12) + le piège du canal silencieux (piège n°13).
- **Ce que ça fait** : le téléphone streame sa caméra vers un petit VPS ; le VPS incruste le scorebug RacketStream dans la vidéo et republie vers Twitch. Aucun ordinateur pendant le match.
- **Ce que ça coûte** : ~7,7 €/mois (le VPS) + 0 € (MediaMTX, renderer, ffmpeg, Supabase free tier).

> ⚠️ **Ce tuto ne contient aucune donnée personnelle** : tout est en placeholders.
> `203.0.113.10` = l'IP fictive (bloc doc RFC 5737). Remplace tout ce qui est entre `<...>`.

---

## 0. L'architecture

```
Téléphone (VDO.Ninja, WebRTC/WHIP)
   │  http://203.0.113.10:8889/live/<VPS_KEY>/whip
   ▼
┌─────────────────────────────────────────────────────────┐
│ VPS Ubuntu 24.04+                                       │
│                                                         │
│  MediaMTX (:1935 RTMP, :8554 RTSP, :8889 WHIP,          │
│   metrics localhost)                                    │
│   └─ runOnInit : lance le composite à la publication,   │
│      le tue à la déconnexion                            │
│                                                         │
│  ffmpeg-relay                                           │
│   ├─ entrée 1 : rtsp://127.0.0.1:8554/live/<VPS_KEY>    │
│   │            (TCP — le RTMP interne rejette l'Opus)   │
│   ├─ entrée 2 : le renderer (frames RGBA 2 fps, pipe)   │
│   ├─ filter_complex : pillarbox + overlay=0:0           │
│   └─ sortie : Twitch (libx264 720p30 ~4500k,            │
│      audio Opus -> AAC 128k)                            │
│                                                         │
│  renderer (Python + Pillow, fichier vps/renderer.py)    │
│   ├─ lit le match sur Supabase (REST anon, 1 s)         │
│   └─ dessine le scorebug en RGBA 1280x720               │
└─────────────────────────────────────────────────────────┘
   │  RTMP sortant (~6 Mb/s)
   ▼
Twitch → viewers (latence totale ~15-25 s après le point)
```

Les secrets vivent uniquement dans `/etc/racketstream/env` (chmod 640, jamais dans le repo) :

```
VPS_KEY=<64 caractères hex — la clé d'ingest, générée avec openssl rand -hex 32>
TWITCH_KEY=<ta clé stream Twitch>
RENDER_INTERVAL=1          # période de polling Supabase (s)
RENDER_STALE_S=600         # sans sync depuis X s, le match est « fantôme » : l'overlay disparaît
# RENDER_CHANNEL=<CHANNEL> # si plusieurs canaux — ⚠️ piège n°13 : un mauvais
#   canal ici ne provoque AUCUNE erreur, l'overlay reste simplement transparent
# RENDER_POSITION=topright # topright | topleft | topcenter
```

---

## 1. Sécuriser le VPS (10 min)

> Action fournisseur : commander un VPS (2 vCPU, 4 Go, Ubuntu 24.04+). Tu reçois une clé SSH.

```bash
# 1. L'utilisateur dédié (minuscules !), sudo, ta clé SSH
sudo adduser --disabled-password --gecos "" stream
sudo usermod -aG sudo stream
echo "stream ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/stream
sudo chmod 440 /etc/sudoers.d/stream
sudo install -d -m 700 -o stream -g stream /home/stream/.ssh
# colle TA clé publique (~/.ssh/id_ed25519.pub) dans authorized_keys :
sudo tee /home/stream/.ssh/authorized_keys >/dev/null
sudo chmod 600 /home/stream/.ssh/authorized_keys
sudo chown stream:stream /home/stream/.ssh/authorized_keys

# 2. Clé uniquement, root interdit
sudo tee /etc/ssh/sshd_config.d/99-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
PermitRootLogin prohibit-password
KbdInteractiveAuthentication no
EOF
sudo sshd -t && sudo systemctl restart ssh

# 3. Pare-feu local
sudo ufw allow OpenSSH && sudo ufw allow 1935/tcp && sudo ufw allow 8889/tcp && sudo ufw allow 8188/udp
echo "y" | sudo ufw enable

# 4. Updates auto
sudo apt-get install -y unattended-upgrades
```

> 🔴 **Le piège n°10 — l'auto-ban fail2ban** : si tu installes fail2ban (recommandé,
> le SSH est martelé en permanence), trois réglages t'évitent de te couper toi-même
> (vécu le 2026-10-02 : 5 déconnexions SSH pré-auth de l'IP maison en 13 s → ban
> permanent → WHIP/WebRTC refusés au téléphone en wifi = **même IP publique** que le
> Mac → « rien sur Twitch » pendant 25 h, sans aucune erreur côté serveur) :
> - `ignoreip = 127.0.0.1/8 ::1 <IP_DE_LA_MAISON>` dans `jail.local`
> - `bantime = 1d` (et non `-1`) : un faux positif se lève tout seul
> - `banaction = ufw[application="OpenSSH"]` : un ban ne bloque que SSH, **jamais
>   le streaming** (WHIP :8889, WebRTC :8188, RTMP :1935 restent intouchables)
>
> Diagnostic : `sudo fail2ban-client banned` · lever un ban :
> `sudo fail2ban-client set sshd unbanip <IP>`.

> 🔴 **Le piège n°1** : beaucoup de fournisseurs ont **un firewall amont** (dans leur dashboard)
> qui bloque tout sauf le 22. Les ports n'y sont ouverts QUE depuis l'interface du fournisseur.
> **Diagnostic** : [check-host.net](https://check-host.net/check-tcp?host=203.0.113.10:1935) sonde
> ton port depuis l'étranger — si des nœuds externes voient fermé alors que `ufw` est bon,
> c'est le firewall amont. Ajoute-y : **TCP 1935** (RTMP), **TCP 8889** (WHIP), **UDP 8188** (WebRTC).

---

## 2. Installer MediaMTX (5 min)

```bash
sudo apt-get install -y ffmpeg                      # utile plus tard, autant le faire
V=$(curl -s https://api.github.com/repos/bluenviron/mediamtx/releases/latest | grep -o '"tag_name": "v[^"]*"' | cut -d'"' -f4 | tr -d v)
curl -sL "https://github.com/bluenviron/mediamtx/releases/download/v$V/mediamtx_v${V}_linux_amd64.tar.gz" -o /tmp/mm.tar.gz
sudo mkdir -p /etc/mediamtx /etc/racketstream
sudo tar -xzf /tmp/mm.tar.gz -C /tmp mediamtx && sudo mv /tmp/mediamtx /usr/local/bin/
sudo chmod 755 /usr/local/bin/mediamtx
KEY=$(openssl rand -hex 32)                          # ← la clé d'ingest, garde-la précieusement
sudo tee /etc/racketstream/env >/dev/null <<EOF
VPS_KEY=$KEY
RENDER_INTERVAL=1
EOF
sudo chown root:stream /etc/racketstream/env
sudo chmod 640 /etc/racketstream/env                 # ⚠️ 640 : sans ça, le composite ne peut pas lire
```

> 🔴 **Le piège n°2** : `/etc/racketstream/env` doit appartenir à `root:<groupe du user>`
> en mode **640**. En `600`, le runOnInit de MediaMTX échoue avec `Permission denied`.

La configuration `/etc/mediamtx/mediamtx.yml` :

```yaml
logLevel: info
api: no
metrics: yes
metricsAddress: 127.0.0.1:9998
rtsp: yes
rtmp: yes
rtmpAddress: :1935
hls: no
srt: no

webrtc: yes
webrtcAddress: :8889
webrtcICEUDPMuxAddress: :8188

paths:
  live/<VPS_KEY>:
    runOnInit: /usr/local/bin/ffmpeg-relay
    runOnInitRestart: yes
    runOnUnavailable: /usr/local/bin/kill-composite   # anti-fantôme, cf. §4 (piège n°12)
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now mediamtx
```

> 🔴 **Le piège n°3** : `runOnInitRestart: yes` relance le composite tant que la session vit —
> mais si le composite ne meurt **pas** à la déconnexion (zombie), le suivant ne démarre jamais.
> Le script du §4 gère ça avec un `trap` qui tue tout le groupe de processus.

---

## 3. Installer le renderer (2 min)

Les fichiers sont dans ce repo : [`vps/renderer.py`](../vps/renderer.py) + [`vps/fonts/`](../vps/fonts/) (Archivo, licence OFL incluse).

```bash
sudo mkdir -p /opt/racketstream/fonts
scp vps/renderer.py <USER>@203.0.113.10:/tmp/
scp "vps/fonts/Archivo[wdth,wght].ttf" vps/fonts/OFL.txt <USER>@203.0.113.10:/tmp/
# sur le VPS :
sudo mv /tmp/renderer.py /opt/racketstream/
sudo mv "/tmp/Archivo[wdth,wght].ttf" /tmp/OFL.txt /opt/racketstream/fonts/
sudo apt-get install -y python3-pil
# test :
sudo python3 /opt/racketstream/renderer.py --channel <CHANNEL> --png /tmp/scorebug.png
```

L'aperçu `/tmp/scorebug.png` (fond transparent) doit contenir le scorebug — ou rien si aucun match actif n'est **frais** (un match quitté reste « active » dans la base : sans sync depuis `RENDER_STALE_S` s, il est un fantôme et l'overlay disparaît tout seul ; l'edge `sync` rafraîchit `updated_at` à chaque synchronisation). Le renderer réutilise la clé anon publique déjà présente dans l'overlay.

---

## 4. Le composite ffmpeg-relay (5 min)

`/usr/local/bin/ffmpeg-relay` :

```bash
#!/bin/bash
# RacketStream composite : vidéo téléphone + scorebug renderer -> destination RTMP
# Cycle de vie : MediaMTX envoie TERM à la déconnexion -> on tue tout le groupe
# (le renderer + ffmpeg), sinon les zombies bloquent la session suivante.
set -uo pipefail
source /etc/racketstream/env
: "${RTMP_OUT:=rtmp://cdg.contribute.live-video.net/app/${TWITCH_KEY:-}}"
if [ -z "$RTMP_OUT" ]; then
  echo "ffmpeg-relay: RTMP_OUT ou TWITCH_KEY requis" >&2
  exit 1
fi
CHANNEL="${RENDER_CHANNEL:-<CHANNEL>}"
cleanup() { kill 0 2>/dev/null; sleep 1; kill -9 0 2>/dev/null; }
trap cleanup TERM INT
while true; do
python3 /opt/racketstream/renderer.py --channel "$CHANNEL" --interval "${RENDER_INTERVAL:-2}" --stale "${RENDER_STALE_S:-600}" 2>>/tmp/racketstream-renderer.log | ffmpeg -hide_banner -loglevel warning \
  -rtsp_transport tcp -timeout 5000000 -i "rtsp://127.0.0.1:8554/live/$VPS_KEY" \
  -f rawvideo -pix_fmt rgba -s 1280x720 -r 2 -i - \
  -filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,setsar=1,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p[v0];[v0][1:v]overlay=0:0:format=auto[out]" \
  -map "[out]" -map 0:a \
  -c:v libx264 -preset veryfast -tune zerolatency -b:v 4500k -maxrate 4500k -bufsize 4500k \
  -g 30 -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  -f flv "$RTMP_OUT"
sleep 2
done
```

```bash
sudo chmod 755 /usr/local/bin/ffmpeg-relay
sudo systemctl restart mediamtx
```

> 🔴 **Le piège n°5** : VDO.Ninja publie la vidéo **H264** mais l'audio en **Opus**, et le RTMP
> **rejette l'Opus** (`skipping track 2 (Opus)` → le composite meurt). D'où l'entrée
> **RTSP** (`rtsp: yes` + `-rtsp_transport tcp`) avec transcodage audio **AAC** : le RTSP
> interne accepte l'Opus, ffmpeg le convertit en AAC pour Twitch. Sans `-rtsp_transport tcp`,
> ffmpeg négocie le RTSP en UDP et **bloque silencieusement** (0 octet consommé).
>
> 💡 **Le pillarbox** : `force_original_aspect_ratio=decrease` + `pad` : si le téléphone tourne
> en portrait, l'image garde ses proportions centrée sur fond noir au lieu d'être déformée.
> Le scorebug reste en haut à droite dans tous les cas.
>
> 🔴 **Le piège n°8 — la boucle de relance** : le path étant statique, MediaMTX relance le
> composite dès qu'il meurt, même sans flux : un composite qui échoue (404 RTSP avant le
> publish) = une relance par seconde, 24h/24. D'où la **boucle interne** `while true` du
> script : le composite reste vivant et retente lui-même toutes les 2 s ; MediaMTX n'a plus
> qu'à le tuer/le laisser vivre.
>
> 🔴 **Le piège n°9 — le fantôme Twitch** : sur un path statique, MediaMTX **ne tue pas** le
> runOnInit quand la publication s'arrête. Sans protection, le ffmpeg reste branché à Twitch
> **indéfiniment** après ton Stop — le direct reste « live » avec une image figée.
> Deux protections **cumulées** :
> 1. `-timeout 5000000` dans le script (cf. piège n°11 : l'ancien `-rw_timeout` n'existe plus)
> 2. le **watchdog** `runOnUnavailable` (cf. piège n°12) : quand la source disparaît,
>    MediaMTX lance `kill-composite` qui tue le composite → Twitch passe offline
>
> 💡 Pour tester **sans Twitch** : ajoute temporairement `RTMP_OUT=/tmp/test.flv` dans
> `/etc/racketstream/env`, streame, puis extrais une frame :
> `ffmpeg -y -ss 3 -i /tmp/test.flv -frames:v 1 -update 1 frame.png`
> ⚠️ **Le piège n°4** : ne décode jamais un `.flv` **pendant** qu'il s'écrit (erreurs NAL) —
> attends la fin du stream, ou copie le fichier d'abord.

**Le watchdog anti-fantôme** (`/usr/local/bin/kill-composite`) — obligatoire depuis
ffmpeg 8 : quand le téléphone disparaît, MediaMTX ferme le RTSP **proprement** (EOF,
pas une erreur) et ffmpeg 8 **continue de streame l'image figée** tant qu'une de ses
entrées vit — le renderer est une pipe infinie à 2 fps. Ni `-timeout`, ni
`shortest=1` du filtre overlay n'y suffisent (testé le 2026-10-03). MediaMTX sait
exactement quand la source disparaît → on lui fait tuer le composite lui-même :

```bash
#!/bin/sh
# RacketStream watchdog (pièges n°9/12) : appelé par MediaMTX runOnUnavailable
# quand la source disparaît — tue le composite (bash + renderer + ffmpeg) pour
# que Twitch passe offline au lieu de diffuser une image figée indéfiniment.
LOOP=$(pgrep -f "^/bin/bash /usr/local/bin/ffmpeg-relay$" | head -1)
[ -z "$LOOP" ] && exit 0
for p in $(pgrep -P "$LOOP"); do kill -9 "$p" 2>/dev/null; done
kill -9 "$LOOP" 2>/dev/null
exit 0
```

```bash
sudo chmod 755 /usr/local/bin/kill-composite
# + la ligne runOnUnavailable dans /etc/mediamtx/mediamtx.yml (cf. §2)
```

> 🔴 **Le piège n°11 — ffmpeg 8 supprime `-rw_timeout`** : avec ffmpeg 8.0 (Ubuntu
> 26.04, arrivé par unattended-upgrades), le composite meurt en boucle avec
> `Option rw_timeout not found`. Remplacement : `-timeout 5000000` (µs, même
> sémantique : abandon après 5 s sans I/O socket → Twitch offline entre les sessions).
>
> 🔴 **Le piège n°12 — l'EOF ne tue pas ffmpeg 8** : un input qui finit en EOF n'arrête
> pas un ffmpeg qui a d'autres entrées vivantes (ici le renderer). Le kill doit venir
> de l'extérieur : le hook `runOnUnavailable` de MediaMTX (détection ~9-10 s après la
> déconnexion, délai de session RTSP) → kill du groupe → Twitch offline.

---

## 5. Brancher Twitch (2 min)

1. Twitch → Creator Dashboard → Settings → Stream → copie la **Primary Stream Key**
2. Sur le VPS (sans jamais l'afficher) :

```bash
# upload silencieux depuis ta machine :
scp twitch-key.txt <USER>@203.0.113.10:/tmp/tk
# sur le VPS :
sudo bash -c 'echo "TWITCH_KEY=$(tr -d "[:space:]" < /tmp/tk)" >> /etc/racketstream/env'
sudo rm -f /tmp/tk
```

3. Toujours sur Twitch : **Low latency mode = ON** (gros gain perçu pour le score).

La clé ne doit **jamais** être collée dans un commit, un chat ou une capture.

---

## 6. Le téléphone (5 min)

**L'app : [VDO.Ninja](https://docs.vdo.ninja/steves-helper-apps/native-mobile-app.md)** (iOS + Android, gratuit, zéro watermark).

1. *Publishing settings* → **Enable WHIP output**
2. **WHIP URL** : `http://203.0.113.10:8889/live/<VPS_KEY>/whip` (Stream Key : **vide** — la clé est dans l'URL)
3. Mode : **WHIP only**, caméra **arrière**
4. Lance : la caméra arrive sur le VPS, le composite démarre tout seul, Twitch passe « live » ~20 s plus tard.

> 🔴 **Le piège n°6 — l'image figée** : quand l'écran du téléphone s'éteint ou que l'app passe
> en arrière-plan, **Android fige la capture caméra** (économie de batterie) tout en gardant la
> session WebRTC vivante : le direct continue de diffuser la même image. Pendant un match :
> **écran allumé, app en premier plan, téléphone au chargeur**, économiseur de batterie désactivé,
> rotation verrouillée en **paysage**.
>
> 🔴 **Le piège n°7 — le canal occupé** : si tu relances VDO.Ninja sans avoir réussi à couper
> l'ancienne session, le nouveau flux est **refusé** (le path est déjà pris) et le direct
> diffuse l'ancien. Symptôme : « la source ne change pas ». Fix radical côté VPS :
> `sudo systemctl restart mediamtx` (éjecte toutes les sessions), puis relance l'app.

> ℹ️ **Pourquoi VDO.Ninja et pas Larix Broadcaster ?** Larix est excellent mais son modèle
> gratuit inclut un watermark périodique incrusté dans la vidéo, une limite de 30 min, et le
> Premium coûte 9,99 $/**mois** (abonnement). VDO.Ninja publie en WebRTC/WHIP, gratuit et sans
> watermark. MediaMTX accepte les deux (RTMP :1935, WHIP :8889) si tu veux tester les deux.

---

## 7. La checklist d'un match

| # | Étape | Vérification |
|---|---|---|
| 1 | Créer le match dans l'app montre | l'overlay OBS/le portail l'affichent |
| 2 | VDO.Ninja → bouton Start | Twitch passe « live » ~20 s |
| 3 | Le score apparaît dans la vidéo | ~15-25 s après le point (cf. §8) |
| 4 | `!score` dans le chat | réponse immédiate (le chat n'a pas la latence vidéo) |
| 5 | Fin : Stop dans VDO.Ninja | Twitch passe offline ~30 s, aucun zombie |

---

## 8. La latence : à quoi s'attendre

| Étape | Délai |
|---|---|
| Point → montre → cloud (sync BLE) | ~2-5 s |
| Renderer (poll 1 s) | ~0,5-1 s |
| Composite + encode | ~0,5-1 s (bufsize 4500k = 1 s de tampon max) |
| Twitch ingest → viewer | 10-20 s (incompressible) |
| **Total point → viewer** | **~15-25 s** |

Le score apparaît **en même temps** que l'image du point chez le viewer — c'est le décalage
entre ta montre (le vrai temps) et le direct qui se remarque. Partage équitable :
Twitch prend la moitié, on travaille sur les 2-3 premières secondes (créneau de sync + polling).

---

## 9. Le dépannage

| Symptôme | Cause probable | Fix |
|---|---|---|
| Le téléphone streame, rien sur Twitch | firewall amont du fournisseur (sortie/entrée) | check-host.net + le dashboard fournisseur |
| `Permission denied` sur `/etc/racketstream/env` dans le journal | mode 600 au lieu de 640 | `sudo chmod 640 /etc/racketstream/env` |
| Le composite ne se relance pas à la re-publication | zombie (renderer/ffmpeg orphelins) | `sudo pkill -9 -f ffmpeg-relay` — le trap du §4 prévient |
| `skipping track 2 (Opus)` dans le journal, composite mort | entrée RTMP (rejette l'Opus) | entrée RTSP + `-c:a aac` (cf. piège n°5) |
| Composite actif mais 0 octet consommé (`outbound_bytes=0`) | RTSP négocié en UDP | `-rtsp_transport tcp` avant le `-i` RTSP |
| Le direct affiche une image figée | écran du téléphone éteint / app en fond (piège n°6) | écran allumé, app en premier plan, chargeur |
| La « source » du direct ne change pas après relance | ancienne session toujours accrochée (piège n°7) | `sudo systemctl restart mediamtx`, relancer l'app |
| `404 Not Found` RTSP au lancement du composite | composite démarré avant le flux du téléphone | bénin : `runOnInitRestart` le relance quand la source arrive |
| Le direct reste « live »/figé après le Stop | ffmpeg survit au SIGTERM (accroché au réseau) | trap durci : TERM puis `kill -9` 1 s après (cf. §4) — sinon `sudo pkill -9 -f "ffmpeg -hide"` |
| Erreurs NAL au décodage du test | lecture du `.flv` pendant l'écriture | copier le fichier, ou attendre la fin |
| Direct noir sur Twitch, composite actif | clé Twitch refusée | le journal : `journalctl -u mediamtx -f` — vérifie la clé |
| L'app WHIP refuse `http://` | policy https de l'app | ajoute un reverse-proxy TLS (Caddy) devant :8889 |
| Le port 1935/8889 n'écoute pas | MediaMTX mort | `journalctl -u mediamtx -n 50` |
| SSH « Connection refused » instantané chez toi + rien sur Twitch, services pourtant actifs | auto-ban fail2ban de l'IP maison (piège n°10) | `sudo fail2ban-client banned` → `set sshd unbanip <IP>` + `ignoreip` + ban SSH-only (cf. §1) |
| Journal composite : `Option rw_timeout not found` en boucle | ffmpeg 8 a supprimé l'option (piège n°11) | `-rw_timeout 5000000` → `-timeout 5000000` dans `/usr/local/bin/ffmpeg-relay` |
| Direct « live » avec image figée après Stop, malgré `-timeout` | ffmpeg 8 vit tant qu'une entrée vit (renderer infini) (piège n°12) | watchdog `runOnUnavailable` → `kill-composite` (cf. §4) |
| Direct OK, aucune erreur, mais le scorebug n'apparaît jamais | `RENDER_CHANNEL` ≠ canal de la montre (piège n°13) | `RENDER_CHANNEL=<canal>` dans `/etc/racketstream/env`, puis kill du loop bash (relance auto) |

---

## 10. Maintenir

- **Logs** : `journalctl -u mediamtx -f` (les erreurs du composite apparaissent dedans)
- **fail2ban** : `sudo fail2ban-client banned` · lever un ban : `sudo fail2ban-client set sshd unbanip <IP>`
- **Supervision** : `curl http://127.0.0.1:9998/metrics | grep -E "inbound|outbound"` (localhost seulement)
- **Mettre à jour MediaMTX** : refaire le §2 (binaire remplacé, conf conservée)
- **Plusieurs canaux** : `RENDER_CHANNEL` dans `/etc/racketstream/env` ; un VPS par canal
- **Coûts** : Lite 3 ~7,7 €/mois, résiliable. Le 1080p : la ressource VPS en plus, pas de change de conf
