"""RacketStream renderer VPS — incruste le scorebug dans la vidéo streamée.

Reçoit l'état du match poussé par l'API VPS (/api/stream, SSE — le serveur
envoie chaque point dès la sync ; repli /api/score si le flux tombe ; pick fait
côté serveur, le même que l'overlay), dessine le scorebug (design phase 5,
inchangé) en RGBA 1280x720 à --fps images/s sur stdout : ffmpeg-relay
l'incruste dans la vidéo et publie vers Twitch (même --fps des deux côtés).

Contrat (spec 2026-09-21 §3, ajusté 2026-09-24) :
  - aucun match ACTIF FRAIS → frame entièrement TRANSPARENTE
    (un match quitté reste « active » dans la base : sans sync depuis
    stale_s il est un « fantôme » et ne doit plus s'afficher)
  - API injoignable → garde la dernière frame connue (on_error=KEEP)
  - changement d'état → redessine au prochain tick
"""

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------- constantes

BASE_DIR = Path(__file__).resolve().parent
FONT_PATH = BASE_DIR / "fonts" / "Archivo[wdth,wght].ttf"

# API publique (lecture seule). Sur le VPS : --url http://127.0.0.1:8790
# (sans passer par Caddy).
API_URL = "https://racket-stream.marc-suarez.fr"

FRAME_W, FRAME_H = 1280, 720
FPS = 2                         # défaut ; doit valoir le -r de ffmpeg-relay

# Palette phase 5 — identique à overlay/index.html (rgba → alpha 0-255)
BG = (10, 12, 14, 168)          # rgba(10,12,14,0.66)
BORDER = (255, 255, 255, 20)    # rgba(255,255,255,0.08)
TXT = (255, 255, 255, 255)
MUTED = (255, 255, 255, 133)    # rgba(255,255,255,0.52)
PIP_BORDER = (255, 255, 255, 89)  # rgba(255,255,255,0.35)
SEP = (255, 255, 255, 31)       # rgba(255,255,255,0.12)
TEAM1 = (47, 224, 92, 255)      # #2FE05C
TEAM2 = (229, 72, 77, 255)      # #E5484D

POSITIONS = ("topright", "topleft", "topcenter")
MARGIN = 16                     # marge du bug dans la frame (aligné ffmpeg overlay)

KEEP = object()                 # sentinelle : API injoignable → garder la frame

NAMES_REFRESH_S = 60.0          # relecture des noms du canal (portail) pendant un stream

# Dimensions du design (cf. overlay/index.html)
PAD_X, PAD_Y = 18, 9
NAME_SIZE, PTS_SIZE, COLON_SIZE, SETLAB_SIZE = 23, 54, 40, 16
PIP, PIP_GAP, PIP_RADIUS = 8, 5, 2
NAME_COL_GAP = 3
PTS_MINW = 46
MID_PAD = 20                    # .mid padding horizontal
COLON_PAD = 8                   # .colon padding horizontal
SEP_M = 16                      # .sep marge horizontale
NAME_MAXW = 190
RADIUS = 12


def load_font(size, weight=600):
    f = ImageFont.truetype(str(FONT_PATH), size)
    f.set_variation_by_axes([weight, 100])   # axes fvar : Weight, Width
    return f


# --------------------------------------------------------------------- pick

def make_url(base, channel):
    return f"{base}/api/score?channel={urllib.parse.quote(channel, safe='')}"


def stream_url(base, channel):
    return f"{base}/api/stream?channel={urllib.parse.quote(channel, safe='')}"


def fetch_json(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def normalize(row):
    cfg = row.get("config") or {}
    return {
        "score_me": row["score_me"],
        "score_opp": row["score_opp"],
        "sets_me": row["sets_me"],
        "sets_opp": row["sets_opp"],
        "current_set": row["current_set"],
        "sets_to_win": int(cfg.get("setsToWin") or 2),
    }


def _age_s(raw):
    """Âge en secondes d'un updated_at : epoch ms (API VPS) ou ISO 8601."""
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        updated = datetime.fromtimestamp(raw / 1000, timezone.utc)
    else:
        updated = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - updated).total_seconds()


def pick(channel, base, fetch=fetch_json, on_error=None, stale_s=600):
    """Match à afficher (règle commune `evaluate`), via /api/score.

    /api/score renvoie le match en cours le plus récent, sinon le plus récent
    tout statut. Un match quitté reste « active » dans la
    base (la montre purge localement sans prévenir) : sans sync depuis stale_s,
    c'est un « fantôme » — l'overlay doit disparaître. On_error (None ou KEEP)
    si le réseau échoue.
    """
    try:
        row = fetch(make_url(base, channel))
    except Exception:
        return on_error
    return evaluate(row, stale_s)


FINISHED_S = 300   # score final affiché 5 min (ou jusqu'au match suivant / « Terminer »)


def evaluate(row, stale_s=600):
    """Ligne de l'API (/api/score ou message /api/stream) → état normalisé, ou
    None. Règle commune à tous les affichages : match en cours (« active » ou
    « set_result » entre deux sets) synchronisé depuis ≤ stale_s ; match
    terminé (« match_finished ») pendant FINISHED_S. Réévaluée à chaque image :
    un match qui ne synchronise plus devient fantôme sans nouveau message."""
    status = row.get("status") if isinstance(row, dict) else None
    limit = stale_s if status in ("active", "set_result") else FINISHED_S if status == "match_finished" else None
    if limit is not None:
        try:
            if _age_s(row.get("updated_at")) <= limit:
                return normalize(row)
        except (TypeError, ValueError, OverflowError, KeyError, OSError):
            pass   # updated_at absent/corrompu → traité comme fantôme
    return None


def sse_rows(lines):
    """Messages JSON d'un flux SSE (lignes `data: …` ; pings `: …` ignorés)."""
    for raw in lines:
        line = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
        line = line.rstrip("\r\n")
        if line.startswith("data:"):
            try:
                yield json.loads(line[5:].strip())
            except ValueError:
                continue   # message corrompu : on attend le suivant


def open_stream(url, timeout=60):
    """Réponse HTTP itérable ligne par ligne. Le serveur pingue toutes les 25 s :
    au-delà de `timeout` sans rien recevoir, la connexion est jugée morte."""
    req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
    return urllib.request.urlopen(req, timeout=timeout)


def start_score_feed(channel, base, holder, opener=open_stream, fetch=fetch_json,
                     retry_s=2.0, stop=None):
    """Thread daemon : holder[0] = dernière ligne reçue (None avant la première).

    Abonné à /api/stream, le renderer apprend un point dès que la montre l'a
    synchronisé (plus d'attente de polling). Flux coupé ou refusé : repli sur
    un /api/score puis reconnexion après retry_s — en panne réseau totale, on
    GARDE la dernière ligne (contrat KEEP).
    """
    stop = stop or threading.Event()

    def _loop():
        while not stop.is_set():
            try:
                with opener(stream_url(base, channel)) as resp:
                    for row in sse_rows(resp):
                        holder[0] = row
                        if stop.is_set():
                            return
            except Exception:
                pass
            try:
                holder[0] = fetch(make_url(base, channel))
            except Exception:
                pass   # injoignable : garder la dernière ligne
            stop.wait(retry_s)

    t = threading.Thread(target=_loop, daemon=True)
    t.start()
    return t


def fetch_names(channel, base=API_URL):
    """Noms du canal via la route names de l'API (défauts MOI/LUI sinon)."""
    try:
        url = f"{base}/functions/v1/names?channel={urllib.parse.quote(channel)}"
        with urllib.request.urlopen(url, timeout=10) as r:
            n = json.loads(r.read().decode("utf-8"))
        team = lambda a, b: f"{a}/{b}" if b else a
        return (team(n.get("name1") or "MOI", n.get("name1b")),
                team(n.get("name2") or "LUI", n.get("name2b")))
    except Exception:
        return ("MOI", "LUI")

# ------------------------------------------------------------------- layout

def _text_w(draw, txt, font):
    if not txt:
        return 0
    return draw.textlength(txt, font=font)


def _pts_slot(draw, value, f_pts):
    """Largeur du slot score : stable par nombre de chiffres (tabular-nums).

    Chaque chiffre occupe la largeur du « 0 » — les chiffres ne sautent pas
    au tick, comme font-variant-numeric: tabular-nums dans le CSS.
    """
    digit_w = draw.textlength("0", font=f_pts)
    return max(PTS_MINW, int(round(len(str(value)) * digit_w)))


def compute_bug_layout(state, names, position, draw=None):
    """Boîte (x, y, w, h) du scorebug dans la frame 1280x720."""
    if position not in POSITIONS:
        raise ValueError(f"position invalide: {position}")
    probe = draw or ImageDraw.Draw(Image.new("RGBA", (8, 8)))

    n1, n2 = names
    f_name = load_font(NAME_SIZE, 600)
    f_pts = load_font(PTS_SIZE, 700)
    f_colon = load_font(COLON_SIZE, 600)
    f_set = load_font(SETLAB_SIZE, 600)

    pip_total = max(2, state["sets_to_win"])
    pipsw = pip_total * PIP + (pip_total - 1) * PIP_GAP

    t1w = max(_text_w(probe, n1.upper(), f_name), pipsw, 0)
    t2w = max(_text_w(probe, n2.upper(), f_name), pipsw, 0)

    pts1w = _pts_slot(probe, state["score_me"], f_pts)
    pts2w = _pts_slot(probe, state["score_opp"], f_pts)
    colonw = _text_w(probe, ":", f_colon)
    midw = pts1w + 2 * COLON_PAD + colonw + 2 * COLON_PAD + pts2w

    setlab = f"SET {state['current_set']}"
    setw = _text_w(probe, setlab, f_set)

    w = (2 * PAD_X + t1w + 2 * MID_PAD + midw + 2 * MID_PAD + t2w
         + 2 * SEP_M + 1 + 2 * SEP_M + setw)

    content_h = PTS_SIZE                     # les chiffres dominent la hauteur
    h = content_h + 2 * PAD_Y

    w = int(round(w))
    if position == "topright":
        x = FRAME_W - MARGIN - w
    elif position == "topleft":
        x = MARGIN
    else:
        x = (FRAME_W - w) // 2
    return int(x), MARGIN, int(w), int(h)

# -------------------------------------------------------------------- draw

def _pips(d, x, y, won, total, color):
    for i in range(total):
        px = x + i * (PIP + PIP_GAP)
        box = (px, y, px + PIP, y + PIP)
        if i < won:
            d.rounded_rectangle(box, radius=PIP_RADIUS, fill=color, outline=color, width=1)
        else:
            d.rounded_rectangle(box, radius=PIP_RADIUS, outline=PIP_BORDER, width=1)


def draw_frame(state, names=("MOI", "LUI"), position="topright", size=(FRAME_W, FRAME_H)):
    """Frame RGBA : transparente partout sauf le scorebug semi-transparent."""
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    if state is None:
        return img
    d = ImageDraw.Draw(img)

    x, y, w, h = compute_bug_layout(state, names, position, draw=d)

    # barre translucide bordée (design phase 5 — pas d'ombre : le composite
    # alpha de la vidéo donne le rendu exact du CSS rgba(10,12,14,0.66))
    d.rounded_rectangle((x, y, x + w, y + h), radius=RADIUS, fill=BG,
                        outline=BORDER, width=1)

    n1, n2 = names
    f_name = load_font(NAME_SIZE, 600)
    f_pts = load_font(PTS_SIZE, 700)
    f_colon = load_font(COLON_SIZE, 600)
    f_set = load_font(SETLAB_SIZE, 600)

    pip_total = max(2, state["sets_to_win"])
    pipsw = pip_total * PIP + (pip_total - 1) * PIP_GAP

    base_y = y + PAD_Y + PTS_SIZE              # baseline des chiffres

    # camp 1
    t1w = max(d.textlength(n1.upper(), font=f_name), pipsw)
    d.text((x + PAD_X, base_y - PIP - NAME_COL_GAP - NAME_SIZE), n1.upper(),
           font=f_name, fill=TXT, anchor="ls")
    _pips(d, x + PAD_X, base_y - PIP, state["sets_me"], pip_total, TEAM1)

    # milieu : p1 : p2
    pts1w = _pts_slot(d, state["score_me"], f_pts)
    pts2w = _pts_slot(d, state["score_opp"], f_pts)
    mx = x + PAD_X + t1w + MID_PAD
    d.text((mx + pts1w / 2, base_y), str(state["score_me"]), font=f_pts, fill=TXT, anchor="ms")
    cx = mx + pts1w + COLON_PAD
    d.text((cx + d.textlength(":", font=f_colon) / 2, base_y), ":", font=f_colon, fill=MUTED, anchor="ms")
    d.text((cx + 2 * COLON_PAD + d.textlength(":", font=f_colon) + pts2w / 2, base_y),
           str(state["score_opp"]), font=f_pts, fill=TXT, anchor="ms")

    # camp 2
    t2x = cx + 2 * COLON_PAD + d.textlength(":", font=f_colon) + pts2w + MID_PAD
    t2w = max(d.textlength(n2.upper(), font=f_name), pipsw)
    d.text((t2x, base_y - PIP - NAME_COL_GAP - NAME_SIZE), n2.upper(),
           font=f_name, fill=TXT, anchor="ls")
    _pips(d, t2x, base_y - PIP, state["sets_opp"], pip_total, TEAM2)

    # séparateur + SET n
    sx = t2x + t2w + SEP_M
    d.rectangle((sx, y + PAD_Y + 2, sx + 1, y + h - PAD_Y - 2), fill=SEP)
    labx = sx + 1 + SEP_M
    d.text((labx, y + h / 2), f"SET {state['current_set']}", font=f_set, fill=MUTED, anchor="lm")

    return img

# --------------------------------------------------------------------- main

def start_names_refresh(channel, holder, period=NAMES_REFRESH_S, fetch=None, stop=None):
    """Démarre un thread daemon qui rafraîchit holder[0] toutes les `period` s.

    Les noms vivent côté API (portail) : un changement doit apparaître
    tout seul pendant un stream, sans relance du composite. Une erreur réseau
    garde les noms actuels (jamais de crash, jamais de noms vides). Le thread
    est daemon : il ne bloque pas la sortie du processus.
    """
    fetch = fetch or fetch_names
    stop = stop or threading.Event()

    def _loop():
        while not stop.wait(period):
            try:
                holder[0] = fetch(channel)
            except Exception:
                pass   # hors ligne : garder les noms actuels

    t = threading.Thread(target=_loop, daemon=True)
    t.start()
    return t


def frame_bytes(img):
    return img.tobytes()   # RGBA brut, ordre raster


def main(argv=None):
    ap = argparse.ArgumentParser(description="RacketStream scorebug renderer (RGBA brut sur stdout)")
    ap.add_argument("--channel", required=True)
    ap.add_argument("--interval", type=float, default=2.0,
                    help="délai (s) avant reconnexion du flux, avec relecture de /api/score")
    ap.add_argument("--fps", type=float, default=FPS,
                    help="images/s écrites (= le -r de l'entrée rawvideo dans ffmpeg-relay)")
    ap.add_argument("--stale", type=int, default=600,
                    help="durée max (s) sans sync avant de considérer le match fantôme")
    ap.add_argument("--position", default="topright", choices=POSITIONS)
    ap.add_argument("--name1", help="forcer le nom du camp 1 (sinon réglages du canal)")
    ap.add_argument("--name2", help="forcer le nom du camp 2")
    ap.add_argument("--url", default=API_URL, help="base de l'API (VPS : http://127.0.0.1:8790)")
    ap.add_argument("--png", help="écrire un PNG d'aperçu et quitter (validation visuelle)")
    args = ap.parse_args(argv)

    if args.name1 and args.name2:
        names = (args.name1, args.name2)
    else:
        auto = fetch_names(args.channel, args.url)
        names = (args.name1 or auto[0], args.name2 or auto[1])
    names_cell = [names]
    if not (args.name1 and args.name2):
        # noms du canal : relus toutes les NAMES_REFRESH_S — un changement dans
        # le portail apparaît tout seul pendant un stream, sans relance.
        start_names_refresh(args.channel, names_cell, fetch=lambda ch: fetch_names(ch, args.url))

    if args.png:
        state = pick(args.channel, args.url, stale_s=args.stale)
        draw_frame(state, names=names, position=args.position).save(args.png)
        print(f"PNG écrit: {args.png} (state={'aucun' if state is None else 'match'})")
        return

    row_cell = [None]
    start_score_feed(args.channel, args.url, row_cell, retry_s=args.interval)

    out = sys.stdout.buffer
    frame_period = 1.0 / args.fps
    key, frame = None, None
    while True:
        t0 = time.monotonic()
        state = evaluate(row_cell[0], args.stale)
        cur = (repr(state), tuple(names_cell[0]))
        if cur != key:   # redessin seulement si le score ou les noms changent
            key = cur
            frame = frame_bytes(draw_frame(state, names=cur[1], position=args.position))
        out.write(frame)
        out.flush()
        elapsed = time.monotonic() - t0
        time.sleep(max(0.0, frame_period - elapsed))

if __name__ == "__main__":
    main()
