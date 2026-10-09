import Toybox.Application;
import Toybox.Lang;
import Toybox.Test;

// ---- MatchStore : persistance §7.2 (Phase 3) ----

(:test)
function test_store_roundtrip(logger as Logger) as Boolean {
    MatchStore.clearMatch();               // état propre avant test
    var e = new ScoreEngine(MatchPresets.get(2), "mP");
    enginePoints(e, 21, 19);
    e.changeSet();                         // 42 events, set 2, 0-0, sets 1-0
    MatchStore.saveMatch(e, Sports.BADMINTON, 0, 0);
    var loaded = MatchStore.loadMatch();
    Test.assertEqualMessage(loaded != null, true, "meta presente apres save");
    Test.assertEqualMessage("mP", loaded["mid"], "matchId restaure");
    Test.assertEqualMessage(Sports.BADMINTON, loaded["sp"], "sport restaure");
    Test.assertEqualMessage(0, loaded["fi"], "format restaure");
    Test.assertEqualMessage(30, (loaded["cfg"] as MatchConfig).mCap, "config restauree");
    Test.assertEqualMessage(42, loaded["ls"], "lastSequence restaure");
    Test.assertEqualMessage(42, loaded["events"].size(), "42 events restaures");
    var e2 = new ScoreEngine(MatchPresets.get(2), loaded["mid"]);
    e2.restore(loaded["base"], loaded["events"]);
    Test.assertEqualMessage(0, e2.getPhase(), "restore : PLAYING (set 2)");
    Test.assertEqualMessage(2, e2.getSetNumber(), "restore : set 2");
    Test.assertEqualMessage(1, e2.getSetsMe(), "restore : sets 1-0");
    MatchStore.clearMatch();
    Test.assertEqualMessage(MatchStore.loadMatch() == null, true, "clear : plus de meta");
    return true;
}

(:test)
function test_store_chunks_41_events(logger as Logger) as Boolean {
    MatchStore.clearMatch();
    var e = new ScoreEngine(MatchPresets.get(2), "m1");
    enginePoints(e, 21, 19);               // 41 events (40 POINT + SET_FINISHED)
    MatchStore.saveMatch(e, Sports.BADMINTON, 0, 0);            // 41 > 30 : au moins 2 lots
    var loaded = MatchStore.loadMatch();
    Test.assertEqualMessage(41, loaded["events"].size(), "41 events via plusieurs lots");
    Test.assertEqualMessage(41, loaded["events"][40][2], "dernier event : seq 41");
    Test.assertEqualMessage(ScoreEvent.TYPE_SET_FINISHED, loaded["events"][40][0], "dernier = SET_FINISHED");
    MatchStore.clearMatch();
    return true;
}

(:test)
function test_store_orphan_chunks(logger as Logger) as Boolean {
    MatchStore.clearMatch();
    var e = new ScoreEngine(MatchPresets.get(2), "m1");
    enginePoints(e, 21, 19);               // 41 events → 2 lots (30 + 11)
    MatchStore.saveMatch(e, Sports.BADMINTON, 0, 0);
    var e2 = new ScoreEngine(MatchPresets.get(0), "m2");   // nouveau match plus court, MÊME storage
    enginePoints(e2, 5, 3);                // 8 events → 1 lot seulement
    MatchStore.saveMatch(e2, Sports.BADMINTON, 0, 0);           // le lot 1 (11 events du match 1) doit être purgé
    var loaded = MatchStore.loadMatch();
    Test.assertEqualMessage("m2", loaded["mid"], "meta du match 2");
    Test.assertEqualMessage(8, loaded["events"].size(), "8 events — pas d'orphelin relu");
    Test.assertEqualMessage(8, loaded["events"][7][2], "dernier event : seq 8");
    MatchStore.clearMatch();
    return true;
}

(:test)
function test_store_prefs(logger as Logger) as Boolean {
    MatchStore.savePrefs([Sports.SQUASH, 1, 3, 2]);
    var p = MatchStore.loadPrefs();
    Test.assertEqualMessage(Sports.SQUASH, p[0], "prefs : sport memorise");
    Test.assertEqualMessage(3, p[2], "prefs : format padel memorise");
    MatchStore.savePrefs([7, 9, -1, 2]);   // corruption : clamp
    p = MatchStore.loadPrefs();
    Test.assertEqualMessage(Sports.BADMINTON, p[0], "prefs : sport hors bornes -> badminton");
    Test.assertEqualMessage(0, p[1], "prefs : format hors bornes -> 0");
    Test.assertEqualMessage(2, p[3], "prefs : format squash garde");
    Application.Storage.deleteValue("racket_prefs_v2");
    return true;
}

// Migration 0.2.x : meta v1 (badminton, "pi") relue en v2.
(:test)
function test_store_migration_meta_v1(logger as Logger) as Boolean {
    MatchStore.clearMatch();
    Application.Storage.setValue("badminton_meta_v1", { "v" => 1, "mid" => "OLD1", "pi" => 1, "pf" => 1, "ls" => 0,
        "base" => [0, 0, 0, 0, 0, 1, 0, 0] });
    var l = MatchStore.loadMatch();
    Test.assertEqualMessage(Sports.BADMINTON, l["sp"], "v1 : badminton");
    Test.assertEqualMessage(1, l["fi"], "v1 : 15 pts -> 3 x 15");
    Test.assertEqualMessage(21, (l["cfg"] as MatchConfig).mCap, "v1 : config 15/21");
    MatchStore.clearMatch();
    return true;
}

// Padel : config (mode d'égalité, super tie-break) et base d'état persistées.
(:test)
function test_store_padel_roundtrip(logger as Logger) as Boolean {
    MatchStore.clearMatch();
    var e = new PadelEngine(Sports.config(Sports.PADEL, 3), "PAD1");
    padelGames(e, 6, 0);                   // 1er set 6-0
    e.changeSet();
    padelPoints(e, 2, 1);
    MatchStore.saveMatch(e, Sports.PADEL, 3, 0);
    var l = MatchStore.loadMatch();
    var c = l["cfg"] as MatchConfig;
    Test.assertEqualMessage(Sports.PADEL, c.mSport, "padel : sport");
    Test.assertEqualMessage(true, c.mSuperTB, "padel : super tie-break");
    var e2 = new PadelEngine(c, l["mid"]);
    e2.restore(l["base"], l["events"]);
    Test.assertEqualMessage(1, e2.getSetsMe(), "padel restore : 1 set");
    Test.assertEqualMessage(2, e2.getScoreMe(), "padel restore : 30-15");
    Test.assertEqualMessage(2, e2.getSetNumber(), "padel restore : set 2");
    MatchStore.clearMatch();
    return true;
}

// ---- sync (Phase 4a) : pointeur d'acquittement pf ----

(:test)
function test_store_pf_default_et_ack(logger as Logger) as Boolean {
    MatchStore.clearMatch();               // état propre avant test
    var engine = new ScoreEngine(MatchPresets.get(2), "PFX");
    engine.pointMe();
    MatchStore.saveMatch(engine, Sports.BADMINTON, 0, 0);
    Test.assertEqualMessage(1, MatchStore.getPendingFrom(), "pf défaut = 1");
    MatchStore.ackUntil(1);
    Test.assertEqualMessage(2, MatchStore.getPendingFrom(), "pf=2 après ack");
    MatchStore.ackUntil(1);                // un ack plus ancien ne recule pas pf
    Test.assertEqualMessage(2, MatchStore.getPendingFrom(), "pf ne recule pas");
    MatchStore.clearMatch();
    return true;
}

(:test)
function test_store_pf_preserve_apres_save(logger as Logger) as Boolean {
    MatchStore.clearMatch();
    var engine = new ScoreEngine(MatchPresets.get(2), "PFX");
    engine.pointMe();
    MatchStore.saveMatch(engine, Sports.BADMINTON, 0, 0);
    MatchStore.ackUntil(3);                // ack hypothétique au-delà du journal → pf=4
    engine.pointMe();
    MatchStore.saveMatch(engine, Sports.BADMINTON, 0, 0);       // re-save du MÊME match
    Test.assertEqualMessage(4, MatchStore.getPendingFrom(), "pf doit être préservé");
    MatchStore.clearMatch();
    return true;
}

(:test)
function test_store_pf_reset_nouveau_match(logger as Logger) as Boolean {
    MatchStore.clearMatch();
    var engine = new ScoreEngine(MatchPresets.get(2), "PFX");
    engine.pointMe();
    MatchStore.saveMatch(engine, Sports.BADMINTON, 0, 0);
    MatchStore.ackUntil(1);
    var other = new ScoreEngine(MatchPresets.get(2), "PF2");
    other.pointMe();
    MatchStore.saveMatch(other, Sports.BADMINTON, 0, 0);        // matchId différent → pf repart à 1
    Test.assertEqualMessage(1, MatchStore.getPendingFrom(), "pf reset nouveau match");
    MatchStore.clearMatch();
    return true;
}
