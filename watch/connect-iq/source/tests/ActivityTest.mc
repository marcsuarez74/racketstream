import Toybox.Lang;
import Toybox.Test;

// ---- phase 9 : sports, undoPoint, stats de match et de séance ----

(:test)
function test_sports_catalogue(logger as Logger) as Boolean {
    var c = Sports.config(Sports.BADMINTON, 2);
    Test.assertEqualMessage(1, c.mSetsToWin, "set unique 21");
    Test.assertEqualMessage(Sports.BADMINTON, c.mSport, "sport porté par la config");
    c = Sports.config(Sports.SQUASH, 0);
    Test.assertEqualMessage(3, c.mSetsToWin, "squash 3 jeux gagnants");
    Test.assertEqualMessage(0, c.mCap, "squash sans plafond");
    Test.assertEqualMessage(4, Sports.formatCount(Sports.PADEL), "4 formats padel");
    Test.assertEqualMessage(0, Sports.clampFormat(Sports.SQUASH, 3), "format hors bornes");
    Test.assertEqualMessage(8, Sports.sideAt(Sports.BADMINTON, 1), "côté à 8 en 3 x 15");
    return true;
}

(:test)
function test_engine_undo_point_fin_de_set(logger as Logger) as Boolean {
    var e = new ScoreEngine(Sports.config(Sports.BADMINTON, 0), "U1");
    enginePoints(e, 21, 19);               // set 1 fini (SET_RESULT)
    e.undoPoint();
    Test.assertEqualMessage(ScorePhase.PLAYING, e.getPhase(), "undo : set repris");
    Test.assertEqualMessage(20, e.getScoreMe(), "undo : 20-19");
    e.pointMe();
    e.changeSet();                         // set suivant
    e.undoPoint();
    Test.assertEqualMessage(ScorePhase.SET_RESULT, e.getPhase(), "undo du set suivant : fin de set");
    return true;
}

(:test)
function test_engine_undo_point_fin_de_match(logger as Logger) as Boolean {
    var e = new ScoreEngine(Sports.config(Sports.BADMINTON, 2), "U2");   // set unique
    enginePoints(e, 21, 10);
    Test.assertEqualMessage(ScorePhase.MATCH_FINISHED, e.getPhase(), "match fini");
    e.undo();
    Test.assertEqualMessage(ScorePhase.MATCH_FINISHED, e.getPhase(), "undo() garde le verrou");
    e.undoPoint();
    Test.assertEqualMessage(ScorePhase.PLAYING, e.getPhase(), "undoPoint lève le verrou");
    Test.assertEqualMessage(20, e.getScoreMe(), "undoPoint : 20-10");
    return true;
}

(:test)
function test_match_stats_points_et_series(logger as Logger) as Boolean {
    var ev = [[0, 0, 1, 1000, 0, 0], [0, 0, 2, 3000, 1, 0], [1, 0, 3, 5000, 2, 0],
              [0, 0, 4, 7000, 2, 1], [0, 0, 5, 9000, 3, 1], [0, 0, 6, 11000, 4, 1]];
    var p = MatchStats.points(ev);
    Test.assertEqualMessage(5, p[0], "5 gagnés");
    Test.assertEqualMessage(6, p[1], "6 joués");
    Test.assertEqualMessage(3, p[2], "série en cours 3");
    Test.assertEqualMessage(3, p[3], "meilleure série 3");
    Test.assertEqualMessage(2000, p[4], "2 s par point");
    return true;
}

(:test)
function test_match_stats_sets(logger as Logger) as Boolean {
    var e = new ScoreEngine(Sports.config(Sports.BADMINTON, 0), "S1");
    enginePoints(e, 21, 15);
    e.changeSet();
    enginePoints(e, 5, 3);
    e.changeSet();                         // changement manuel à 5-3
    var rows = e.setRows(0);
    Test.assertEqualMessage(2, rows.size(), "2 sets");
    Test.assertEqualMessage("21-15", MatchStats.setText(rows[0]), "set 1");
    Test.assertEqualMessage("5-3", MatchStats.setText(rows[1]), "set manuel");
    Test.assertEqualMessage(0, rows[1][2], "manuel : leader crédité");
    Test.assertEqualMessage("21-15 · 5-3", MatchStats.setsLine(rows, " · "), "ligne des sets");
    return true;
}

(:test)
function test_session_stats_zones_et_courbe(logger as Logger) as Boolean {
    var s = new SessionStats([100, 120, 140, 160, 180, 200], 0);
    Test.assertEqualMessage(1, s.zoneOf(90), "sous Z1 : zone 1");
    Test.assertEqualMessage(3, s.zoneOf(145), "145 : zone 3");
    Test.assertEqualMessage(5, s.zoneOf(190), "190 : zone 5");
    for (var t = 0; t < 600; t += 1) { s.addSample(t * 1000, t < 300 ? 130 : 170); }
    Test.assertEqualMessage(150, s.hrAvg(), "FC moyenne");
    Test.assertEqualMessage(300, s.zoneSeconds()[1], "300 s en zone 2");
    Test.assertEqualMessage(300, s.zoneSeconds()[3], "300 s en zone 4");
    Test.assertEqualMessage(true, s.bucketCount() <= 96, "courbe bornée");
    Test.assertEqualMessage(10000, s.bucketStep(), "1 compaction (600 s / 5 s > 96)");
    Test.assertEqualMessage(130, s.hrAvgBetween(0, 200000), "FC du 1er tiers");
    s.addSample(1000, null);               // pas de mesure : ignoré
    Test.assertEqualMessage(150, s.hrAvg(), "null ignoré");
    return true;
}

(:test)
function test_session_stats_zones_profil_invalide(logger as Logger) as Boolean {
    var s = new SessionStats([0, 0, 0, 0, 0, 0], 0);
    Test.assertEqualMessage(190, s.getZones()[5], "zones par défaut");
    s = new SessionStats(null, 0);
    Test.assertEqualMessage(95, s.getZones()[0], "zones nulles : défaut");
    return true;
}

(:test)
function test_session_stats_archive_match(logger as Logger) as Boolean {
    var s = new SessionStats(null, 0);
    for (var t = 0; t < 100; t += 1) { s.addSample(t * 1000, 140); }
    s.archiveMatch([[21, 10, 0, 0, 50000, 0]], [21, 31, 0, 6, 1000]);
    var rows = s.allRows([[3, 1, 0, 50000, 90000, 0]]);
    Test.assertEqualMessage(2, rows.size(), "sets archivés + courants");
    Test.assertEqualMessage(140, rows[0][6], "FC moyenne du set");
    var tp = s.totalPoints([4, 4, 4, 9, 0]);
    Test.assertEqualMessage(25, tp[0], "points gagnés de la séance");
    Test.assertEqualMessage(9, tp[2], "meilleure série de la séance");
    Test.assertEqualMessage(1, s.matchCount(), "1 match archivé");
    return true;
}
