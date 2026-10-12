import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;

// Écrans dessinés de la maquette phase 9 (repère 454 px, cf. Ui). `v` est
// la MatchView : ces fonctions ne font que lire son état.
module Pages {
    const WHITE = 0xFFFFFF;

    // ---- prêt / reprise ----

    function ready(dc as Dc, v) as Void {
        if (Ui.mSmall) { PagesS.ready(dc, v); return; }
        var sp = v.mSport;
        var hr = v.mAct.heartRate();
        Ui.t(dc, Sports.name(sp).toUpper(), 227, 110, 52, Sports.color(sp), null);
        if (v.mResumed) {
            Ui.t(dc, "Reprise du match", 227, 165, 36, WHITE, null);
            Ui.t(dc, setsLabel(v) + "  ·  " + v.scoreLine(), 227, 205, 28, Ui.C_SOFT, null);
        } else {
            Ui.t(dc, Sports.formatLabel(sp, v.mFormat), 227, 165, 36, WHITE, null);
        }
        var blink = (System.getTimer() / 1000) % 2 == 0;
        Ui.heart(dc, 167, 255, 26, hr != null ? 0x33C46B : (blink ? 0x8E96A3 : Ui.C_LINE));
        Ui.t(dc, hr != null ? "FC  " + hr : "Recherche FC...", 192, 255, 34, hr != null ? WHITE : Ui.C_LABEL, Ui.LEFT);
        Ui.t(dc, v.mResumed ? "START pour reprendre" : "START pour démarrer", 227, 320, 32, WHITE, null);
        Ui.t(dc, v.mResumed ? "BACK  abandonner le match" : "Intérieur · sans GPS", 227, 365, 24, Ui.C_FAINT, null);
    }

    function setsLabel(v) as String {
        return Sports.setsWord(v.mSport) + " " + v.mEngine.getSetsMe() + "-" + v.mEngine.getSetsOpp();
    }

    // ---- activité en cours ----

    function act(dc as Dc, v) as Void {
        var p = v.mPage;
        if (p == 0) {
            if (v.mEngine.getPhase() == ScorePhase.SET_RESULT) { setOver(dc, v); } else { score(dc, v); }
        } else if (p == 1) {
            cardio(dc, v);
        } else if (p == 2) {
            effort(dc, v);
        } else {
            matchStats(dc, v);
        }
        Ui.pageDots(dc, 4, p);
        if (v.mPaused) {
            if (Ui.mSmall) {
                Ui.rrect(dc, 140, 36, 174, 56, 10, 0xF5C542);
                Ui.t(dc, "PAUSE", 227, 64, 22, 0x111111, null);
            } else {
                Ui.rrect(dc, 150, 8, 154, 34, 8, 0xF5C542);
                Ui.t(dc, "PAUSE", 227, 26, 26, 0x111111, null);
            }
        }
    }

    function miniHeader(dc as Dc, v) as Void {
        var hr = v.mAct.heartRate();
        Ui.t(dc, Ui.fmt(v.mAct.elapsedSec()), 189, 58, 32, Ui.C_SOFT, null);
        Ui.heart(dc, 257, 58, 16, Ui.C_RED);
        Ui.t(dc, hr != null ? hr : "--", 271, 58, 32, Ui.C_SOFT, Ui.LEFT);
    }

    function score(dc as Dc, v) as Void {
        if (Ui.mSmall) { PagesS.score(dc, v); return; }
        var e = v.mEngine;
        var sp = v.mSport;
        var col = Sports.color(sp);
        var rows = e.setRows(v.mT0);
        miniHeader(dc, v);
        Ui.t(dc, Sports.name(sp).toUpper() + " · " + Sports.setWord(sp) + " " + e.getSetNumber(), 227, 100, 24, col, null);
        Ui.t(dc, "MOI", 150, 140, 24, Ui.C_LABEL, null);
        Ui.t(dc, "ADV", 304, 140, 24, Ui.C_LABEL, null);
        Ui.circle(dc, v.server() == 0 ? 112 : 266, 140, 7, col);
        Ui.line(dc, 227, 165, 227, 300, Ui.C_LINE, 2);
        var setsText = MatchStats.setsLine(rows, "  ·  ");
        if (v.isPadel()) {
            var l = e.labels();
            Ui.n(dc, l[0], 150, 225, l[0].length() > 2 ? 96 : 120, WHITE, null);
            Ui.n(dc, l[1], 304, 225, l[1].length() > 2 ? 96 : 120, WHITE, null);
            if (l[2] != null) {
                Ui.t(dc, l[2], 227, 318, 26, l[2].find("STAR") != null ? 0xF5C542 : col, null);
            }
            Ui.t(dc, "JEUX  " + e.getGamesMe() + " - " + e.getGamesOpp(), 227, 355, 34, WHITE, null);
            Ui.t(dc, setsText.length() > 0 ? setsText : "1er set", 227, 395, 24, 0x8B949E, null);
        } else {
            var a = e.getScoreMe();
            var b = e.getScoreOpp();
            var cfg = e.getConfig();
            Ui.n(dc, a, 150, 228, 140, WHITE, null);
            Ui.n(dc, b, 304, 228, 140, WHITE, null);
            var hi = a > b ? a : b;
            var d = a > b ? a - b : b - a;
            var info = null;
            if (hi >= cfg.mTargetScore - 1 && d >= 1) { info = a > b ? "SET BALL MOI" : "SET BALL ADV"; }
            if (a == b && a >= cfg.mTargetScore - 1) {
                info = "ÉCART DE 2" + (cfg.mCap > 0 ? " · PLAFOND " + cfg.mCap : "");
            }
            if (info != null) { Ui.t(dc, info, 227, 318, 24, col, null); }
            Ui.t(dc, Sports.setsWord(sp) + "  " + e.getSetsMe() + " - " + e.getSetsOpp(), 227, 355, 34, WHITE, null);
            Ui.t(dc, setsText.length() > 0 ? setsText : Sports.formatLabel(sp, v.mFormat), 227, 395, 24, 0x8B949E, null);
        }
    }

    function setOver(dc as Dc, v) as Void {
        if (Ui.mSmall) { PagesS.setOver(dc, v); return; }
        var e = v.mEngine;
        var rows = e.setRows(v.mT0);
        var last = rows.size() > 0 ? rows[rows.size() - 1] : [0, 0, -1, 0, 0, 0];
        var w = last[2];
        Ui.t(dc, Sports.setWord(v.mSport) + " " + rows.size() + " TERMINÉ", 227, 110, 34, Ui.C_LABEL, null);
        Ui.t(dc, w == 0 ? "GAGNÉ" : (w == 1 ? "PERDU" : "NON CRÉDITÉ"), 227, 165, 40, w == 0 ? Ui.C_WIN : Ui.C_RED, null);
        Ui.n(dc, MatchStats.setText(last), 227, 240, 96, WHITE, null);
        Ui.t(dc, "Total " + e.getSetsMe() + " - " + e.getSetsOpp(), 227, 310, 32, Ui.C_SOFT, null);
        var stb = v.isPadel() && e.isSuperTBNext();
        Ui.t(dc, "START · " + (stb ? "super tie-break" : Sports.setWord(v.mSport).toLower() + " suivant"), 227, 365, 28, Sports.color(v.mSport), null);
    }

    function cardio(dc as Dc, v) as Void {
        if (Ui.mSmall) { PagesS.cardio(dc, v); return; }
        var hr = v.mAct.heartRate();
        var st = v.mAct.getStats();
        var zc = Ui.zones();
        var a0 = Math.PI * 0.75;
        var span = Math.PI * 1.5;
        var z = (hr != null && st != null) ? st.zoneOf(hr) : 0;
        for (var i = 0; i < 5; i += 1) {
            var s0 = a0 + span * i / 5 + 0.012;
            var s1 = a0 + span * (i + 1) / 5 - 0.012;
            Ui.arc(dc, 227, 227, 205, s0, s1, i + 1 == z ? zc[i] : Ui.dim(zc[i], 35), 20);
        }
        if (hr != null && st != null) {
            var zb = st.getZones();
            var f = (hr - zb[0]).toFloat() / (zb[5] - zb[0]);
            if (f < 0) { f = 0.0; }
            if (f > 1) { f = 1.0; }
            var ap = a0 + span * f;
            Ui.circle(dc, 227 + Math.cos(ap) * 205, 227 + Math.sin(ap) * 205, 13, WHITE);
        }
        Ui.t(dc, v.scoreLine(), 227, 95, 30, Ui.C_LABEL, null);
        Ui.heart(dc, 227, 150, 26, Ui.C_RED);
        Ui.n(dc, hr != null ? hr : "--", 227, 225, 130, WHITE, null);
        if (z > 0) { Ui.t(dc, "ZONE " + z, 227, 305, 34, zc[z - 1], null); }
        if (st != null) { Ui.t(dc, "moy " + st.hrAvg() + "   max " + st.hrMax(), 227, 350, 28, Ui.C_SOFT, null); }
    }

    function effort(dc as Dc, v) as Void {
        if (Ui.mSmall) { PagesS.effort(dc, v); return; }
        var st = v.mAct.getStats();
        Ui.line(dc, 60, 190, 394, 190, Ui.C_LINE, 2);
        Ui.line(dc, 40, 300, 414, 300, Ui.C_LINE, 2);
        Ui.line(dc, 227, 190, 227, 300, Ui.C_LINE, 2);
        Ui.t(dc, "CHRONO", 227, 80, 22, Ui.C_LABEL, null);
        Ui.n(dc, Ui.fmt(v.mAct.elapsedSec()), 227, 135, 78, WHITE, null);
        Ui.t(dc, "CALORIES", 127, 215, 22, Ui.C_LABEL, null);
        Ui.n(dc, v.mAct.calories(), 127, 262, 60, WHITE, null);
        Ui.t(dc, "FC MOY", 327, 215, 22, Ui.C_LABEL, null);
        Ui.n(dc, st != null ? st.hrAvg() : 0, 327, 262, 60, WHITE, null);
        Ui.t(dc, "SCORE", 227, 325, 22, Ui.C_LABEL, null);
        Ui.t(dc, v.scoreLine(), 227, 370, 44, Sports.color(v.mSport), null);
    }

    function matchStats(dc as Dc, v) as Void {
        if (Ui.mSmall) { PagesS.matchStats(dc, v); return; }
        var p = MatchStats.points(v.mEngine.getEvents());
        var won = p[0];
        var n = p[1];
        Ui.t(dc, "MATCH", 227, 72, 28, Ui.C_LABEL, null);
        Ui.t(dc, "Points gagnés", 227, 120, 26, Ui.C_SOFT, null);
        Ui.rect(dc, 80, 145, 294, 16, Ui.C_LINE);
        if (won > 0) { Ui.rect(dc, 80, 145, 294 * won / n, 16, Sports.color(v.mSport)); }
        Ui.t(dc, won + " / " + n + "  ·  " + (n > 0 ? won * 100 / n : 0) + " %", 227, 192, 40, WHITE, null);
        // Polices larges (fr265…) : libellés courts s'ils ne tiennent pas.
        var full = Ui.fits(dc, "Meilleure série", 180);
        Ui.fit(dc, full ? "Série en cours" : "Série", 132, 245, 22, Ui.C_LABEL, null, 180);
        Ui.n(dc, p[2], 132, 285, 52, WHITE, null);
        Ui.fit(dc, full ? "Meilleure série" : "Record", 322, 245, 22, Ui.C_LABEL, null, 180);
        Ui.n(dc, p[3], 322, 285, 52, WHITE, null);
        Ui.t(dc, "Temps moyen par point", 227, 335, 22, Ui.C_LABEL, null);
        Ui.n(dc, n > 1 ? Ui.fmt(p[4] / 1000) : "-", 227, 372, 40, WHITE, null);
    }

    // ---- fin de match ----

    function matchEnd(dc as Dc, v) as Void {
        if (Ui.mSmall) { PagesS.matchEnd(dc, v); return; }
        var e = v.mEngine;
        var win = e.getSetsMe() > e.getSetsOpp();
        var col = Sports.color(v.mSport);
        var items = ["Enregistrer l'activité", "Nouveau match", "Annuler le dernier point"];
        var idx = v.mListIdx;
        Ui.t(dc, win ? "VICTOIRE" : "DÉFAITE", 227, 82, 44, win ? Ui.C_WIN : Ui.C_RED, null);
        Ui.n(dc, e.getSetsMe() + " - " + e.getSetsOpp(), 227, 150, 84, WHITE, null);
        Ui.t(dc, MatchStats.setsLine(e.setRows(v.mT0), "  ·  "), 227, 205, 26, Ui.C_SOFT, null);
        Ui.rrect(dc, 50, 250, 354, 64, 12, Ui.C_BOX);
        Ui.rect(dc, 50, 257, 7, 50, col);
        Ui.t(dc, items[idx], 227, 282, 36, WHITE, null);
        Ui.t(dc, items[(idx + 1) % 3], 227, 345, 26, Ui.C_FAINT, null);
        Ui.t(dc, "UP / DOWN  ·  START", 227, 395, 22, Ui.C_FAINT, null);
    }

    // ---- récap de séance (5 pages) ----

    function summary(dc as Dc, v) as Void {
        // Récap 2/5 en deux colonnes : trop étroit pour les polices larges
        // (fr265…), version compacte à la place.
        if (Ui.mSmall || (v.mSumPage == 1 && !Ui.fits(dc, "Meilleure série", 160))) {
            PagesS.summary(dc, v);
            return;
        }
        var pg = v.mSumPage;
        var e = v.mEngine;
        var sp = v.mSport;
        var st = v.mAct.getStats();
        var rows = e.setRows(v.mT0);
        var pts = MatchStats.points(e.getEvents());
        Ui.t(dc, "RÉCAP  " + (pg + 1) + "/5", 227, 58, 24, Ui.C_LABEL, null);
        Ui.pageDots(dc, 5, pg);
        if (st == null) { return; }
        if (pg == 0) {
            var win = e.getSetsMe() > e.getSetsOpp();
            Ui.t(dc, Sports.name(sp) + " · " + Sports.formatLabel(sp, v.mFormat), 227, 105, 28, Sports.color(sp), null);
            Ui.t(dc, win ? "VICTOIRE" : "DÉFAITE", 227, 150, 40, win ? Ui.C_WIN : Ui.C_RED, null);
            Ui.n(dc, e.getSetsMe() + " - " + e.getSetsOpp(), 227, 220, 90, WHITE, null);
            Ui.t(dc, MatchStats.setsLine(rows, "  ·  "), 227, 290, 28, Ui.C_SOFT, null);
            Ui.t(dc, Ui.fmt(v.mEndSec) + "  ·  " + v.mEndKcal + " kcal", 227, 335, 26, Ui.C_LABEL, null);
            var nm = st.matchCount() + 1;
            if (nm > 1) { Ui.t(dc, nm + " matchs dans la séance", 227, 372, 22, Ui.C_LABEL, null); }
        } else if (pg == 1) {
            var tp = st.totalPoints(pts);
            var pct = tp[1] > 0 ? tp[0] * 100 / tp[1] : 0;
            var lines = [["Durée", Ui.fmt(v.mEndSec)], ["Calories", v.mEndKcal + " kcal"],
                ["FC moy / max", st.hrAvg() + " / " + st.hrMax()], ["Points gagnés", tp[0] + "/" + tp[1] + " · " + pct + "%"],
                ["Meilleure série", tp[2]]];
            Ui.t(dc, "Séance", 227, 100, 30, WHITE, null);
            for (var i = 0; i < lines.size(); i += 1) {
                var y = 148 + i * 50;
                // Demi-corde du cadran à cette hauteur, moins une marge :
                // les polices larges (fr265…) débordaient du rond.
                var half = Math.sqrt(227 * 227 - (y - 227) * (y - 227)) - 16;
                Ui.fit(dc, lines[i][0], 215, y, 26, Ui.C_LABEL, Ui.RIGHT, half - 12);
                Ui.fit(dc, lines[i][1], 239, y, 32, WHITE, Ui.LEFT, half - 12);
            }
        } else if (pg == 2) {
            hrCurve(dc, v, st, rows);
        } else if (pg == 3) {
            Ui.t(dc, "Zones FC", 227, 100, 30, WHITE, null);
            var zs = st.zoneSeconds();
            var zc = Ui.zones();
            var tot = 0;
            for (var k = 0; k < 5; k += 1) { tot += zs[k]; }
            if (tot == 0) { tot = 1; }
            for (var z = 4; z >= 0; z -= 1) {
                var zy = 145 + (4 - z) * 48;
                Ui.t(dc, "Z" + (z + 1), 80, zy, 26, zc[z], Ui.LEFT);
                Ui.rect(dc, 118, zy - 12, 190, 24, 0x262B33);
                if (zs[z] > 0) { Ui.rect(dc, 118, zy - 12, 190 * zs[z] / tot, 24, zc[z]); }
                Ui.t(dc, Ui.fmt(zs[z]), 320, zy, 26, WHITE, Ui.LEFT);
            }
        } else {
            setsPage(dc, v, st.allRows(rows));
        }
    }

    // Courbe FC de la séance, sets en bandes alternées, segments colorés
    // par zone.
    function hrCurve(dc as Dc, v, st, rows as Array) as Void {
        Ui.t(dc, "Fréquence cardiaque", 227, 100, 30, WHITE, null);
        var cnt = st.bucketCount();
        var step = st.bucketStep();
        var t0 = st.startTime();
        var tot = cnt * step;
        if (tot <= 0) {
            Ui.t(dc, "Pas de données FC", 227, 230, 26, Ui.C_LABEL, null);
            return;
        }
        var x0 = 58;
        var x1 = 396;
        var all = st.allRows(rows);
        var unit = v.mSport == Sports.SQUASH ? "J" : "S";
        for (var i = 0; i < all.size(); i += 1) {
            var a = (all[i][3] - t0).toFloat() / tot;
            var b = (all[i][4] - t0).toFloat() / tot;
            if (a < 0) { a = 0.0; }
            if (b > 1) { b = 1.0; }
            if (b <= a) { continue; }
            Ui.rect(dc, x0 + (x1 - x0) * a, 140, (x1 - x0) * (b - a), 178, i % 2 == 1 ? 0x14191F : 0x1F262F);
            if (all.size() <= 6) { Ui.t(dc, unit + (i + 1), x0 + (x1 - x0) * (a + b) / 2, 336, 18, 0x7D8691, null); }
        }
        var px = null;
        var py = null;
        for (var k = 0; k < cnt; k += 1) {
            var h = st.bucketHr(k);
            if (h <= 0) { continue; }
            var x = x0 + (x1 - x0) * (k + 0.5) / cnt;
            var f = (h - 80).toFloat() / 110;
            if (f < 0) { f = 0.0; }
            if (f > 1) { f = 1.0; }
            var y = 318 - 178 * f;
            if (px != null) { Ui.line(dc, px, py, x, y, Ui.zones()[st.zoneOf(h) - 1], 3); }
            px = x;
            py = y;
        }
        Ui.t(dc, "moy " + st.hrAvg() + "   ·   max " + st.hrMax(), 227, 368, 28, Ui.C_SOFT, null);
    }

    function setsPage(dc as Dc, v, all as Array) as Void {
        var squash = v.mSport == Sports.SQUASH;
        Ui.t(dc, (squash ? "Jeux" : "Sets") + " · 1 tour chacun", 227, 100, 30, WHITE, null);
        if (all.size() == 0) {
            Ui.t(dc, "Aucun set terminé", 227, 220, 28, Ui.C_LABEL, null);
            return;
        }
        var from = all.size() > 5 ? all.size() - 5 : 0;
        for (var i = from; i < all.size(); i += 1) {
            var r = all[i];
            var y = 148 + (i - from) * 50;
            var dur = r[4] - r[3];
            Ui.t(dc, (squash ? "J" : "S") + (i + 1), 70, y, 26, Ui.C_LABEL, Ui.LEFT);
            Ui.t(dc, MatchStats.setText(r), 112, y, 30, r[2] == 0 ? Ui.C_WIN : WHITE, Ui.LEFT);
            Ui.t(dc, dur >= 0 ? Ui.fmt(dur / 1000) : "-", 262, y, 26, Ui.C_SOFT, Ui.LEFT);
            Ui.heart(dc, 336, y, 14, Ui.C_RED);
            Ui.t(dc, r[6] > 0 ? r[6] : "-", 348, y, 26, Ui.C_SOFT, Ui.LEFT);
        }
    }

    function done(dc as Dc) as Void {
        if (Ui.mSmall) { PagesS.done(dc); return; }
        Ui.circle(dc, 227, 170, 56, 0x17804B);
        Ui.line(dc, 201, 170, 221, 190, WHITE, 10);
        Ui.line(dc, 221, 190, 255, 150, WHITE, 10);
        Ui.t(dc, "Activité enregistrée", 227, 270, 40, WHITE, null);
        Ui.t(dc, "Envoi vers Garmin Connect", 227, 315, 26, Ui.C_LABEL, null);
        Ui.t(dc, "au prochain sync", 227, 345, 26, Ui.C_LABEL, null);
    }
}
