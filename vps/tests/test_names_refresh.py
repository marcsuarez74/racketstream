"""Tests du rafraîchissement périodique des noms (renderer VPS).

Les noms des joueurs vivent dans Supabase (canal → edge `names`). Ils sont
chargés au démarrage du composite — mais un changement dans le portail doit
apparaître tout seul pendant un stream, sans relance : un thread daemon
relit les noms toutes les ~60 s et met à jour la cellule partagée.

Contrat :
  - le holder (cellule [noms]) est mis à jour après le premier tick de période
  - une erreur réseau pendant un refresh GARDE les noms actuels (jamais de
    crash, jamais de noms vides)
  - le thread est daemon (il ne bloque pas la sortie du processus)
"""

import threading
import time

from renderer import start_names_refresh


def test_refresh_met_a_jour_les_noms():
    """Après une période, le holder contient les noms renvoyés par le fetch."""
    holder = [("VIEUX", "NOMS")]
    calls = []

    def fake_fetch(channel):
        calls.append(channel)
        return ("NOUVEAU", "NOMS")

    stop = threading.Event()
    start_names_refresh("marc", holder, period=0.05, fetch=fake_fetch, stop=stop)
    time.sleep(0.4)
    stop.set()

    assert calls, "le fetch n'a jamais été appelé"
    assert "marc" in calls
    assert holder[0] == ("NOUVEAU", "NOMS")


def test_erreur_reseau_garde_les_noms_actuels():
    """Le fetch échoue → les noms précédents restent (pas de crash, pas de vide)."""
    holder = [("GARDE", "MOI")]
    state = {"n": 0}

    def fake_fetch(channel):
        state["n"] += 1
        raise OSError("réseau indisponible")

    stop = threading.Event()
    start_names_refresh("marc", holder, period=0.05, fetch=fake_fetch, stop=stop)
    time.sleep(0.4)
    stop.set()

    assert state["n"] > 0, "le fetch n'a jamais été tenté"
    assert holder[0] == ("GARDE", "MOI")


def test_thread_daemon_ne_bloque_pas_la_sortie():
    """Le thread de refresh est daemon : le processus peut sortir normalement."""
    holder = [("A", "B")]

    def slow_fetch(channel):
        time.sleep(5)
        return ("C", "D")

    stop = threading.Event()
    t = start_names_refresh("marc", holder, period=0.01, fetch=slow_fetch, stop=stop)
    assert t.daemon is True
    stop.set()
