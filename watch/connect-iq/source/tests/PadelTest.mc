import Toybox.Lang;
import Toybox.Test;

// ---- PadelEngine (phase 9) ----

function padelPoints(e, nMe as Number, opp as Number) as Void {
    for (var i = 0; i < nMe; i += 1) { e.pointMe(); }
    for (var j = 0; j < opp; j += 1) { e.pointOpponent(); }
}

// Jeux blancs : gMe jeux pour moi puis gOpp pour l'adversaire.
function padelGames(e, gMe as Number, gOpp as Number) as Void {
    for (var i = 0; i < gMe; i += 1) { padelPoints(e, 4, 0); }
    for (var j = 0; j < gOpp; j += 1) { padelPoints(e, 0, 4); }
}

(:test)
function test_padel_jeu_et_libelles(logger as Logger) as Boolean {
    var e = new PadelEngine(Sports.config(Sports.PADEL, 2), "P1");   // avantages
    padelPoints(e, 2, 1);
    var l = e.labels();
    Test.assertEqualMessage("30", l[0], "30-15 : moi");
    Test.assertEqualMessage("15", l[1], "30-15 : adv");
    padelPoints(e, 1, 2);                  // 40-40
    Test.assertEqualMessage("ÉGALITÉ", e.labels()[2], "avantages : égalité");
    e.pointMe();
    Test.assertEqualMessage("AV", e.labels()[0], "avantage moi");
    e.pointOpponent();
    e.pointMe();
    e.pointMe();                           // jeu
    Test.assertEqualMessage(1, e.getGamesMe(), "jeu moi");
    Test.assertEqualMessage(0, e.getScoreMe(), "points remis à 0");
    Test.assertEqualMessage(1, e.getServer(), "service change après le jeu");
    Test.assertEqualMessage(0, e.getGameWon(), "dernier point = jeu moi");
    return true;
}

(:test)
function test_padel_point_en_or(logger as Logger) as Boolean {
    var e = new PadelEngine(Sports.config(Sports.PADEL, 1), "P2");
    padelPoints(e, 3, 3);
    Test.assertEqualMessage("POINT EN OR", e.labels()[2], "40-40 = point en or");
    e.pointOpponent();
    Test.assertEqualMessage(1, e.getGamesOpp(), "point en or : jeu adv direct");
    return true;
}

(:test)
function test_padel_star_point(logger as Logger) as Boolean {
    var e = new PadelEngine(Sports.config(Sports.PADEL, 0), "P3");
    padelPoints(e, 3, 3);
    Test.assertEqualMessage("ÉGALITÉ 1/2", e.labels()[2], "1re égalité");
    padelPoints(e, 1, 1);
    Test.assertEqualMessage("ÉGALITÉ 2/2", e.labels()[2], "2e égalité");
    padelPoints(e, 1, 1);
    Test.assertEqualMessage("STAR POINT", e.labels()[2], "3e égalité = star point");
    e.pointMe();
    Test.assertEqualMessage(1, e.getGamesMe(), "star point gagné = jeu");
    return true;
}

(:test)
function test_padel_set_et_tie_break(logger as Logger) as Boolean {
    var e = new PadelEngine(Sports.config(Sports.PADEL, 1), "P4");
    padelGames(e, 5, 5);
    padelGames(e, 1, 1);                   // 6-6
    Test.assertEqualMessage(1, e.getTieBreak(), "6-6 : tie-break");
    padelPoints(e, 3, 3);
    padelPoints(e, 4, 0);                  // TB 7-3
    Test.assertEqualMessage(ScorePhase.SET_RESULT, e.getPhase(), "set terminé");
    Test.assertEqualMessage(7, e.getLastSetScoreMe(), "set 7-6");
    Test.assertEqualMessage(6, e.getLastSetScoreOpp(), "set 7-6");
    var row = e.setRows(0)[0];
    Test.assertEqualMessage("7-6 (3)", MatchStats.setText(row), "texte du set avec TB");
    var ev = e.getEvents();
    Test.assertEqualMessage(ScoreEvent.TYPE_SET_FINISHED, ev[ev.size() - 1][0], "SET_FINISHED journalisé");
    e.pointMe();                           // ignoré hors jeu
    Test.assertEqualMessage(0, e.getScoreMe(), "point ignoré en fin de set");
    e.changeSet();
    Test.assertEqualMessage(2, e.getSetNumber(), "set 2");
    Test.assertEqualMessage(ScorePhase.PLAYING, e.getPhase(), "set 2 en jeu");
    return true;
}

(:test)
function test_padel_super_tie_break(logger as Logger) as Boolean {
    var e = new PadelEngine(Sports.config(Sports.PADEL, 3), "P5");
    padelGames(e, 6, 0);
    e.changeSet();
    padelGames(e, 0, 6);
    Test.assertEqualMessage(true, e.isSuperTBNext(), "1-1 : super tie-break annoncé");
    e.changeSet();
    Test.assertEqualMessage(2, e.getTieBreak(), "3e set = super tie-break");
    padelPoints(e, 9, 9);
    Test.assertEqualMessage(ScorePhase.PLAYING, e.getPhase(), "9-9 : continue");
    padelPoints(e, 2, 0);                  // 11-9
    Test.assertEqualMessage(ScorePhase.MATCH_FINISHED, e.getPhase(), "match fini");
    Test.assertEqualMessage("[11-9]", MatchStats.setText(e.setRows(0)[2]), "texte super TB");
    var ev = e.getEvents();
    Test.assertEqualMessage(ScoreEvent.TYPE_MATCH_FINISHED, ev[ev.size() - 1][0], "MATCH_FINISHED journalisé");
    return true;
}

(:test)
function test_padel_undo_point_fin_de_match(logger as Logger) as Boolean {
    var e = new PadelEngine(Sports.config(Sports.PADEL, 1), "P6");
    padelGames(e, 6, 0);
    e.changeSet();
    padelGames(e, 5, 0);
    padelPoints(e, 4, 0);                  // 6-0 6-0
    Test.assertEqualMessage(ScorePhase.MATCH_FINISHED, e.getPhase(), "match fini");
    e.undoPoint();
    Test.assertEqualMessage(ScorePhase.PLAYING, e.getPhase(), "undo : match repris");
    Test.assertEqualMessage(5, e.getGamesMe(), "undo : 5-0");
    Test.assertEqualMessage(3, e.getScoreMe(), "undo : 40-0");
    return true;
}

(:test)
function test_padel_purge_garde_l_etat(logger as Logger) as Boolean {
    var e = new PadelEngine(Sports.config(Sports.PADEL, 2), "P7");
    padelGames(e, 4, 4);
    padelGames(e, 2, 0);                   // 6-4
    e.changeSet();
    padelGames(e, 2, 1);
    padelPoints(e, 1, 0);
    e.trimEvents(10);
    Test.assertEqualMessage(10, e.getEvents().size(), "journal purgé");
    Test.assertEqualMessage(1, e.getSetsMe(), "sets conservés");
    Test.assertEqualMessage(2, e.getGamesMe(), "jeux conservés");
    Test.assertEqualMessage("6-4", MatchStats.setText(e.setRows(0)[0]), "historique des sets conservé");
    var e2 = new PadelEngine(e.getConfig(), "P7");
    e2.restore(e.getBaseState(), e.getEvents());
    Test.assertEqualMessage(1, e2.getScoreMe(), "restore après purge : 15-0");
    Test.assertEqualMessage(2, e2.getGamesMe(), "restore après purge : 2-1");
    return true;
}
