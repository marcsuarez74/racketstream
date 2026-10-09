import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;

// Mises en page compactes des écrans (Ui.mSmall : fr55 et autres petits
// cadrans). La plus petite police système y fait ~48 unités maquette (contre
// ~29 prévues) : moins de lignes, libellés courts, positions recalculées sur
// les hauteurs réelles (XTINY 48, SMALL 59, MEDIUM 74, NUMBER_MEDIUM 172).
// Même repère 454 que Pages.
module PagesS {
    const WHITE = 0xFFFFFF;

    function ready(dc as Dc, v) as Void {
        var sp = v.mSport;
        var hr = v.mAct.heartRate();
        Ui.t(dc, Sports.name(sp).toUpper(), 227, 100, 52, Sports.color(sp), null);
        if (v.mResumed) {
            Ui.fit(dc, "Reprise du match", 227, 155, 36, WHITE, null, 400);
            Ui.fit(dc, v.scoreLine(), 227, 205, 28, Ui.C_SOFT, null, 400);
        } else {
            Ui.fit(dc, Sports.formatLabel(sp, v.mFormat), 227, 160, 36, WHITE, null, 400);
        }
        var blink = (System.getTimer() / 1000) % 2 == 0;
        var txt = hr != null ? "FC " + hr : "Recherche FC";
        var w = Ui.wu(dc, txt, 30);
        Ui.heart(dc, 227 - (w + 40) / 2 + 13, 258, 26, hr != null ? 0x33C46B : (blink ? 0x8E96A3 : Ui.C_LINE));
        Ui.t(dc, txt, 227 - (w + 40) / 2 + 40, 258, 30, hr != null ? WHITE : Ui.C_LABEL, Ui.LEFT);
        Ui.fit(dc, v.mResumed ? "START reprendre" : "START démarrer", 227, 318, 30, WHITE, null, 380);
        if (v.mResumed) { Ui.fit(dc, "BACK abandon", 227, 370, 24, Ui.C_FAINT, null, 300); }
    }

    function miniHeader(dc as Dc, v) as Void {
        var hr = v.mAct.heartRate();
        Ui.t(dc, Ui.fmt(v.mAct.elapsedSec()), 210, 66, 24, Ui.C_SOFT, Ui.RIGHT);
        Ui.heart(dc, 236, 66, 16, Ui.C_RED);
        Ui.t(dc, hr != null ? hr : "--", 256, 66, 24, Ui.C_SOFT, Ui.LEFT);
    }

    function score(dc as Dc, v) as Void {
        var e = v.mEngine;
        var sp = v.mSport;
        var col = Sports.color(sp);
        var padel = v.isPadel();
        miniHeader(dc, v);
        var top = Sports.setWord(sp) + " " + e.getSetNumber() + " · " +
            (padel ? "JEUX " + e.getGamesMe() + "-" + e.getGamesOpp() : e.getSetsMe() + "-" + e.getSetsOpp());
        Ui.fit(dc, top, 227, 114, 24, col, null, 380);
        var wl = Ui.wu(dc, "MOI", 24);
        Ui.t(dc, "MOI", 125, 162, 24, Ui.C_LABEL, null);
        Ui.t(dc, "ADV", 329, 162, 24, Ui.C_LABEL, null);
        Ui.circle(dc, (v.server() == 0 ? 125 : 329) - wl / 2 - 18, 162, 8, col);
        Ui.line(dc, 227, 190, 227, 330, Ui.C_LINE, 2);
        var rows = e.setRows(v.mT0);
        var bottom = MatchStats.setsLine(rows, " · ");
        var bc = 0x8B949E;
        if (padel) {
            var l = e.labels();
            Ui.n(dc, l[0], 125, 270, 140, WHITE, null);
            Ui.n(dc, l[1], 329, 270, 140, WHITE, null);
            if (l[2] != null && l[2].length() > 0) {
                bottom = l[2];
                bc = l[2].find("STAR") != null ? 0xF5C542 : col;
            } else if (bottom.length() == 0) {
                bottom = "SETS " + e.getSetsMe() + "-" + e.getSetsOpp();
            }
        } else {
            var a = e.getScoreMe();
            var b = e.getScoreOpp();
            var cfg = e.getConfig();
            Ui.n(dc, a, 125, 270, 140, WHITE, null);
            Ui.n(dc, b, 329, 270, 140, WHITE, null);
            var hi = a > b ? a : b;
            var d = a > b ? a - b : b - a;
            if (hi >= cfg.mTargetScore - 1 && d >= 1) { bottom = a > b ? "SET BALL MOI" : "SET BALL ADV"; bc = col; }
            if (a == b && a >= cfg.mTargetScore - 1) { bottom = "ÉCART DE 2"; bc = col; }
            if (bottom.length() == 0) { bottom = Sports.formatLabel(sp, v.mFormat); }
        }
        Ui.fit(dc, bottom, 227, 382, 24, bc, null, 280);
    }

    function setOver(dc as Dc, v) as Void {
        var e = v.mEngine;
        var rows = e.setRows(v.mT0);
        var last = rows.size() > 0 ? rows[rows.size() - 1] : [0, 0, -1, 0, 0, 0];
        var w = last[2];
        var stb = v.isPadel() && e.isSuperTBNext();
        Ui.fit(dc, Sports.setWord(v.mSport) + " " + rows.size() + " TERMINÉ", 227, 95, 30, Ui.C_LABEL, null, 320);
        Ui.fit(dc, w == 0 ? "GAGNÉ" : (w == 1 ? "PERDU" : "NON CRÉDITÉ"), 227, 152, 60, w == 0 ? Ui.C_WIN : Ui.C_RED, null, 400);
        Ui.n(dc, MatchStats.setText(last), 227, 268, 140, WHITE, null);
        Ui.fit(dc, stb ? "START super TB" : "START suivant", 227, 382, 24, Sports.color(v.mSport), null, 280);
    }

    function cardio(dc as Dc, v) as Void {
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
        Ui.fit(dc, v.scoreLine(), 227, 102, 24, Ui.C_LABEL, null, 240);
        Ui.heart(dc, 227, 150, 26, Ui.C_RED);
        Ui.n(dc, hr != null ? hr : "--", 227, 245, 150, WHITE, null);
        var low = st != null ? "moy " + st.hrAvg() : "";
        if (z > 0) { low = "Z" + z + " · " + low; }
        Ui.fit(dc, low, 227, 358, 24, z > 0 ? zc[z - 1] : Ui.C_SOFT, null, 240);
    }

    function effort(dc as Dc, v) as Void {
        var st = v.mAct.getStats();
        Ui.line(dc, 50, 192, 404, 192, Ui.C_LINE, 2);
        Ui.line(dc, 40, 322, 414, 322, Ui.C_LINE, 2);
        Ui.line(dc, 227, 192, 227, 322, Ui.C_LINE, 2);
        Ui.t(dc, "CHRONO", 227, 82, 22, Ui.C_LABEL, null);
        Ui.n(dc, Ui.fmt(v.mAct.elapsedSec()), 227, 140, 110, WHITE, null);
        Ui.t(dc, "KCAL", 127, 222, 22, Ui.C_LABEL, null);
        Ui.n(dc, v.mAct.calories(), 127, 280, 60, WHITE, null);
        Ui.t(dc, "FC MOY", 327, 222, 22, Ui.C_LABEL, null);
        Ui.n(dc, st != null ? st.hrAvg() : 0, 327, 280, 60, WHITE, null);
        Ui.fit(dc, v.scoreLine(), 227, 362, 44, Sports.color(v.mSport), null, 290);
    }

    function matchStats(dc as Dc, v) as Void {
        var p = MatchStats.points(v.mEngine.getEvents());
        var won = p[0];
        var n = p[1];
        Ui.t(dc, "Points gagnés", 227, 80, 22, Ui.C_SOFT, null);
        Ui.rect(dc, 80, 114, 294, 14, Ui.C_LINE);
        if (won > 0) { Ui.rect(dc, 80, 114, 294 * won / n, 14, Sports.color(v.mSport)); }
        Ui.fit(dc, won + "/" + n + " · " + (n > 0 ? won * 100 / n : 0) + "%", 227, 170, 46, WHITE, null, 380);
        Ui.t(dc, "Série", 132, 232, 22, Ui.C_LABEL, null);
        Ui.n(dc, p[2], 132, 292, 60, WHITE, null);
        Ui.t(dc, "Record", 322, 232, 22, Ui.C_LABEL, null);
        Ui.n(dc, p[3], 322, 292, 60, WHITE, null);
        Ui.fit(dc, (n > 1 ? Ui.fmt(p[4] / 1000) : "-") + " par point", 227, 368, 22, Ui.C_SOFT, null, 300);
    }

    function matchEnd(dc as Dc, v) as Void {
        var e = v.mEngine;
        var win = e.getSetsMe() > e.getSetsOpp();
        var items = ["Enregistrer", "Nouveau match", "Annuler point"];
        var idx = v.mListIdx;
        Ui.t(dc, win ? "VICTOIRE" : "DÉFAITE", 227, 95, 60, win ? Ui.C_WIN : Ui.C_RED, null);
        Ui.n(dc, e.getSetsMe() + "-" + e.getSetsOpp(), 227, 172, 100, WHITE, null);
        Ui.fit(dc, MatchStats.setsLine(e.setRows(v.mT0), " · "), 227, 240, 24, Ui.C_SOFT, null, 410);
        Ui.rrect(dc, 30, 280, 394, 62, 12, Ui.C_BOX);
        Ui.rect(dc, 30, 287, 7, 48, Sports.color(v.mSport));
        Ui.fit(dc, items[idx], 232, 311, 36, WHITE, null, 360);
        Ui.fit(dc, items[(idx + 1) % 3], 227, 374, 24, Ui.C_FAINT, null, 300);
    }

    // ---- récap (5 pages) ----

    function summary(dc as Dc, v) as Void {
        var pg = v.mSumPage;
        var e = v.mEngine;
        var sp = v.mSport;
        var st = v.mAct.getStats();
        var rows = e.setRows(v.mT0);
        Ui.t(dc, "RÉCAP " + (pg + 1) + "/5", 227, 62, 22, Ui.C_LABEL, null);
        Ui.pageDots(dc, 5, pg);
        if (st == null) { return; }
        if (pg == 0) {
            var win = e.getSetsMe() > e.getSetsOpp();
            Ui.fit(dc, Sports.name(sp) + " · " + Sports.formatLabel(sp, v.mFormat), 227, 112, 24, Sports.color(sp), null, 380);
            Ui.t(dc, win ? "VICTOIRE" : "DÉFAITE", 227, 166, 60, win ? Ui.C_WIN : Ui.C_RED, null);
            Ui.n(dc, e.getSetsMe() + "-" + e.getSetsOpp(), 227, 244, 100, WHITE, null);
            Ui.fit(dc, MatchStats.setsLine(rows, " · "), 227, 310, 24, Ui.C_SOFT, null, 410);
            Ui.fit(dc, Ui.fmt(v.mEndSec) + " · " + v.mEndKcal + " kcal", 227, 362, 24, Ui.C_LABEL, null, 320);
        } else if (pg == 1) {
            var tp = st.totalPoints(MatchStats.points(e.getEvents()));
            var pct = tp[1] > 0 ? tp[0] * 100 / tp[1] : 0;
            var lines = [["Durée", Ui.fmt(v.mEndSec)], ["Kcal", v.mEndKcal],
                ["FC", st.hrAvg() + " / " + st.hrMax()], ["Points", tp[0] + "/" + tp[1] + " " + pct + "%"],
                ["Série", tp[2]]];
            for (var i = 0; i < lines.size(); i += 1) {
                Ui.pair(dc, lines[i][0], lines[i][1], 120 + i * 52, 24, Ui.C_LABEL, WHITE);
            }
        } else if (pg == 2) {
            hrCurve(dc, v, st, rows);
        } else if (pg == 3) {
            var zs = st.zoneSeconds();
            var zc = Ui.zones();
            var tot = 0;
            for (var k = 0; k < 5; k += 1) { tot += zs[k]; }
            if (tot == 0) { tot = 1; }
            for (var z = 4; z >= 0; z -= 1) {
                var zy = 125 + (4 - z) * 52;
                Ui.t(dc, "Z" + (z + 1), 62, zy, 22, zc[z], Ui.LEFT);
                Ui.rect(dc, 115, zy - 11, 160, 22, 0x262B33);
                if (zs[z] > 0) { Ui.rect(dc, 115, zy - 11, 160 * zs[z] / tot, 22, zc[z]); }
                Ui.t(dc, Ui.fmt(zs[z]), 288, zy, 22, WHITE, Ui.LEFT);
            }
        } else {
            setsPage(dc, v, st.allRows(rows));
        }
    }

    function hrCurve(dc as Dc, v, st, rows as Array) as Void {
        var cnt = st.bucketCount();
        var step = st.bucketStep();
        var t0 = st.startTime();
        var tot = cnt * step;
        if (tot <= 0) {
            Ui.t(dc, "Pas de données FC", 227, 230, 22, Ui.C_LABEL, null);
            return;
        }
        var x0 = 50;
        var x1 = 404;
        var top = 105;
        var bot = 290;
        var all = st.allRows(rows);
        var unit = v.mSport == Sports.SQUASH ? "J" : "S";
        for (var i = 0; i < all.size(); i += 1) {
            var a = (all[i][3] - t0).toFloat() / tot;
            var b = (all[i][4] - t0).toFloat() / tot;
            if (a < 0) { a = 0.0; }
            if (b > 1) { b = 1.0; }
            if (b <= a) { continue; }
            Ui.rect(dc, x0 + (x1 - x0) * a, top, (x1 - x0) * (b - a), bot - top, i % 2 == 1 ? 0x14191F : 0x1F262F);
            if (all.size() <= 4) { Ui.t(dc, unit + (i + 1), x0 + (x1 - x0) * (a + b) / 2, 318, 18, 0x7D8691, null); }
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
            var y = bot - (bot - top) * f;
            if (px != null) { Ui.line(dc, px, py, x, y, Ui.zones()[st.zoneOf(h) - 1], 4); }
            px = x;
            py = y;
        }
        Ui.fit(dc, "moy " + st.hrAvg() + "  max " + st.hrMax(), 227, 370, 24, Ui.C_SOFT, null, 300);
    }

    function setsPage(dc as Dc, v, all as Array) as Void {
        var squash = v.mSport == Sports.SQUASH;
        if (all.size() == 0) {
            Ui.t(dc, squash ? "Aucun jeu" : "Aucun set", 227, 220, 24, Ui.C_LABEL, null);
            return;
        }
        var from = all.size() > 5 ? all.size() - 5 : 0;
        for (var i = from; i < all.size(); i += 1) {
            var r = all[i];
            var y = 120 + (i - from) * 52;
            var dur = r[4] - r[3];
            Ui.t(dc, (squash ? "J" : "S") + (i + 1), 62, y, 22, Ui.C_LABEL, Ui.LEFT);
            Ui.t(dc, MatchStats.setText(r), 120, y, 24, r[2] == 0 ? Ui.C_WIN : WHITE, Ui.LEFT);
            Ui.t(dc, dur >= 0 ? Ui.fmt(dur / 1000) : "-", 392, y, 22, Ui.C_SOFT, Ui.RIGHT);
        }
    }

    function done(dc as Dc) as Void {
        Ui.circle(dc, 227, 150, 52, 0x17804B);
        Ui.line(dc, 203, 150, 221, 168, WHITE, 10);
        Ui.line(dc, 221, 168, 253, 132, WHITE, 10);
        Ui.fit(dc, "Activité enregistrée", 227, 258, 40, WHITE, null, 410);
        Ui.fit(dc, "Envoi Garmin Connect", 227, 312, 24, Ui.C_LABEL, null, 400);
        Ui.fit(dc, "au prochain sync", 227, 360, 24, Ui.C_LABEL, null, 330);
    }
}
