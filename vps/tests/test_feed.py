"""Tests du flux temps réel du renderer VPS (/api/stream, SSE).

Le serveur pousse l'état du match dès qu'une sync de la montre aboutit : le
renderer n'attend plus le polling. Contrat :
  - sse_rows ne garde que les lignes `data:` JSON (pings et messages corrompus
    ignorés)
  - le thread met à jour holder[0] à chaque message reçu
  - flux coupé/refusé → repli sur /api/score, puis reconnexion
  - API totalement injoignable → la dernière ligne est GARDÉE
  - evaluate réapplique la règle actif + frais (anti-fantôme) à chaque image
"""

import io
import threading
import time

from renderer import evaluate, sse_rows, start_score_feed, stream_url


def ms_ago(seconds):
    return int((time.time() - seconds) * 1000)


def row(score_me=5, status="active", seconds_ago=1):
    return {
        "status": status, "updated_at": ms_ago(seconds_ago), "current_set": 1,
        "score_me": score_me, "score_opp": 3, "sets_me": 0, "sets_opp": 0,
        "config": {"setsToWin": 2},
    }


def wait_for(cond, timeout=2.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False


class FakeStream(io.BytesIO):
    """Réponse SSE : itérable en lignes bytes, gestionnaire de contexte."""


def sse(*rows):
    import json
    return b"".join(b": ping\n\n" + b"data: " + json.dumps(r).encode() + b"\n\n" for r in rows)


def test_stream_url():
    assert stream_url("http://127.0.0.1:8790", "marc") == "http://127.0.0.1:8790/api/stream?channel=marc"


def test_sse_rows_ignore_pings_et_messages_corrompus():
    lines = [b": ping\n", b"\n", b"data: {\"a\": 1}\n", b"data: {pas du json\n", b"data: null\n"]
    assert list(sse_rows(lines)) == [{"a": 1}, None]


def test_le_flux_met_a_jour_le_holder():
    holder = [None]
    stop = threading.Event()
    opened = []

    def opener(url):
        opened.append(url)
        if len(opened) == 1:
            return FakeStream(sse(row(5), row(6)))
        stop.wait(5)
        raise OSError("fin du test")

    start_score_feed("marc", "http://x", holder, opener=opener,
                     fetch=lambda url: row(6), retry_s=0.01, stop=stop)
    assert wait_for(lambda: holder[0] is not None and holder[0]["score_me"] == 6)
    assert opened[0] == "http://x/api/stream?channel=marc"
    stop.set()


def test_flux_refuse_repli_sur_api_score():
    holder = [None]
    stop = threading.Event()
    fetched = []

    def opener(url):
        raise OSError("503 trop de connexions")

    def fetch(url):
        fetched.append(url)
        return row(9)

    start_score_feed("marc", "http://x", holder, opener=opener, fetch=fetch,
                     retry_s=0.01, stop=stop)
    assert wait_for(lambda: holder[0] is not None and holder[0]["score_me"] == 9)
    assert fetched[0] == "http://x/api/score?channel=marc"
    stop.set()


def test_api_injoignable_garde_la_derniere_ligne():
    holder = [row(7)]
    stop = threading.Event()
    calls = []

    def boom(url):
        calls.append(url)
        raise OSError("réseau coupé")

    start_score_feed("marc", "http://x", holder, opener=boom, fetch=boom,
                     retry_s=0.01, stop=stop)
    assert wait_for(lambda: len(calls) >= 4)
    stop.set()
    assert holder[0]["score_me"] == 7


def test_evaluate_actif_frais():
    assert evaluate(row(5))["score_me"] == 5


def test_evaluate_fantome_termine_ou_vide():
    assert evaluate(row(seconds_ago=601), stale_s=600) is None
    assert evaluate(row(status="match_finished", seconds_ago=301)) is None
    assert evaluate(row(status="archived")) is None
    assert evaluate(None) is None
    assert evaluate({"status": "active", "updated_at": "pas une date"}) is None
