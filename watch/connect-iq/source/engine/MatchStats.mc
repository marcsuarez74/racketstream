import Toybox.Lang;

// Statistiques PURES dérivées du journal (phase 9, pages « Match » et récap).
// Journal plat [type, arg, seq, ts, prevMe, prevOpp], ts = System.getTimer().
module MatchStats {

    // [gagnés, joués, série en cours, meilleure série, temps moyen par point (ms)]
    function points(events as Array) as Array {
        var won = 0;
        var n = 0;
        var run = 0;
        var best = 0;
        var firstTs = 0;
        var lastTs = 0;
        for (var i = 0; i < events.size(); i += 1) {
            var e = events[i] as Array;
            var t = e[0];
            if (t != ScoreEvent.TYPE_POINT_ME && t != ScoreEvent.TYPE_POINT_OPPONENT) { continue; }
            if (n == 0) { firstTs = e[3]; }
            lastTs = e[3];
            n += 1;
            if (t == ScoreEvent.TYPE_POINT_ME) {
                won += 1;
                run += 1;
                if (run > best) { best = run; }
            } else {
                run = 0;
            }
        }
        var avg = (n > 1) ? (lastTs - firstTs) / (n - 1) : 0;
        if (avg < 0) { avg = 0; }    // horodatages d'un autre démarrage (reprise)
        return [won, n, run, best, avg];
    }

    // Sets terminés d'un match à points : [moi, adv, gagnant (-1 = non
    // crédité), début ts, fin ts, 0]. Début du 1er set = t0 (lancement du
    // match). Un SET_CHANGED juste après un SET_FINISHED = « set suivant ».
    function rallySetRows(events as Array, t0 as Number) as Array {
        var rows = [];
        var start = t0;
        var afterFinish = false;
        for (var i = 0; i < events.size(); i += 1) {
            var e = events[i] as Array;
            if (e[0] == ScoreEvent.TYPE_SET_FINISHED) {
                rows.add([e[4], e[5], e[1], start, e[3], 0]);
                afterFinish = true;
            } else if (e[0] == ScoreEvent.TYPE_SET_CHANGED) {
                if (!afterFinish) {
                    rows.add([e[4], e[5], e[1], start, e[3], 0]);   // changement manuel
                }
                start = e[3];
                afterFinish = false;
            } else if (e[0] != ScoreEvent.TYPE_MATCH_FINISHED) {
                afterFinish = false;
            }
        }
        return rows;
    }

    // Texte d'un set : « 21-18 », tie-break padel « 7-6 (4) », super
    // tie-break « [10-8] » (row[5] : 0 normal, >0 points du perdant du TB + 1,
    // -1 super tie-break).
    function setText(row as Array) as String {
        var s = row[0] + "-" + row[1];
        if (row[5] > 0) { return s + " (" + (row[5] - 1) + ")"; }
        if (row[5] < 0) { return "[" + s + "]"; }
        return s;
    }

    function setsLine(rows as Array, sep as String) as String {
        var s = "";
        for (var i = 0; i < rows.size(); i += 1) {
            if (i > 0) { s += sep; }
            s += setText(rows[i]);
        }
        return s;
    }
}
