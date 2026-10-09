import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;

// Primitives de dessin de la maquette phase 9. Les coordonnées et tailles
// sont celles de la maquette (cadran 454 px) : elles sont mises à l'échelle
// de l'écran réel. Les polices système sont choisies par hauteur (la
// maquette donne une taille CSS, une police Garmin fait ~1,3 × sa taille).
module Ui {
    const C_LABEL = 0x9AA3AE;
    const C_SOFT = 0xC9D1DA;
    const C_FAINT = 0x6B737D;
    const C_LINE = 0x333333;
    const C_BOX = 0x1A1F26;
    const C_RED = 0xE8453C;
    const C_WIN = 0x3DD68C;
    const C_BLUE = 0x4DABF7;

    const LEFT = 1;
    const RIGHT = 2;

    var mK = 1.0;        // échelle maquette → écran
    var mOx = 0;
    var mOy = 0;
    var mText = [];      // [police, hauteur] du plus grand au plus petit
    var mNum = [];
    var mReady = false;
    var mSmall = false;  // petit écran (fr55…) : mises en page compactes (PagesS)

    function init(dc as Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var side = w < h ? w : h;
        mK = side / 454.0;
        mSmall = mK < 0.6;
        mOx = (w - side) / 2;
        mOy = (h - side) / 2;
        mText = fontTable(dc, [Graphics.FONT_LARGE, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY]);
        mNum = fontTable(dc, [Graphics.FONT_NUMBER_THAI_HOT, Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD]);
        mReady = true;
    }

    function fontTable(dc as Dc, fonts as Array) as Array {
        var t = [];
        for (var i = 0; i < fonts.size(); i += 1) { t.add([fonts[i], dc.getFontHeight(fonts[i])]); }
        return t;
    }

    function zones() as Array {
        return [0x8E96A3, 0x3B8BEB, 0x33C46B, 0xF2A02B, 0xE8453C];
    }

    function x(v) as Number { return mOx + (v * mK).toNumber(); }
    function y(v) as Number { return mOy + (v * mK).toNumber(); }
    function s(v) as Number {
        var r = (v * mK).toNumber();
        return r < 1 ? 1 : r;
    }

    // Plus grande police dont la hauteur tient dans la taille demandée
    // (null si aucune : seulement pour les polices chiffres).
    function pick(table as Array, size) {
        var max = size * mK * 1.3;
        for (var i = 0; i < table.size(); i += 1) {
            if (table[i][1] <= max) { return table[i][0]; }
        }
        return null;
    }

    function tf(size) {
        var f = pick(mText, size);
        return f == null ? Graphics.FONT_XTINY : f;
    }

    // Police chiffres (plus grande) si le texte n'a que des chiffres, sinon
    // police texte.
    function nf(size, str as String) {
        var chars = str.toCharArray();
        for (var i = 0; i < chars.size(); i += 1) {
            var c = chars[i];
            if (!((c >= '0' && c <= '9') || c == '-' || c == ':')) { return tf(size); }
        }
        var f = pick(mNum, size);
        return f == null ? tf(size) : f;
    }

    function justify(align) as Number {
        if (align == LEFT) { return Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER; }
        if (align == RIGHT) { return Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER; }
        return Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
    }

    // Texte centré verticalement sur (px, py) (repère maquette).
    function t(dc as Dc, str, px, py, size, color as Number, align) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x(px), y(py), tf(size), str.toString(), justify(align));
    }

    // Grand nombre (score, FC, chrono) : police chiffres quand c'est possible.
    function n(dc as Dc, str, px, py, size, color as Number, align) as Void {
        var st = str.toString();
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x(px), y(py), nf(size, st), st, justify(align));
    }

    // Texte qui doit tenir dans maxw (repère maquette) : police réduite d'un
    // cran tant que ça déborde ; en dernier recours, coupé avant « · ».
    function fit(dc as Dc, str, px, py, size, color as Number, align, maxw) as Void {
        var st = str.toString();
        var mw = s(maxw);
        var f = tf(size);
        var i = 0;
        while (i < mText.size() && mText[i][0] != f) { i += 1; }
        while (dc.getTextWidthInPixels(st, f) > mw && i < mText.size() - 1) {
            i += 1;
            f = mText[i][0];
        }
        if (dc.getTextWidthInPixels(st, f) > mw) {
            var k = st.find(" · ");
            if (k != null) { st = st.substring(0, k); }
        }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x(px), y(py), f, st, justify(align));
    }

    // « libellé valeur » centré sur une ligne, deux couleurs.
    function pair(dc as Dc, label as String, value, py, size, lc as Number, vc as Number) as Void {
        var f = tf(size);
        var vs = value.toString();
        var gap = s(14);
        var wl = dc.getTextWidthInPixels(label, f);
        var x0 = x(227) - (wl + gap + dc.getTextWidthInPixels(vs, f)) / 2;
        var j = Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER;
        dc.setColor(lc, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x0, y(py), f, label, j);
        dc.setColor(vc, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x0 + wl + gap, y(py), f, vs, j);
    }

    // Largeur d'un texte, en unités maquette.
    function wu(dc as Dc, str as String, size) as Number {
        return (dc.getTextWidthInPixels(str, tf(size)) / mK).toNumber();
    }

    function circle(dc as Dc, px, py, r, color as Number) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(x(px), y(py), s(r));
    }

    function line(dc as Dc, x1, y1, x2, y2, color as Number, w) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(s(w));
        dc.drawLine(x(x1), y(y1), x(x2), y(y2));
        dc.setPenWidth(1);
    }

    function rect(dc as Dc, px, py, pw, ph, color as Number) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(x(px), y(py), s(pw), s(ph));
    }

    function rrect(dc as Dc, px, py, pw, ph, r, color as Number) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(x(px), y(py), s(pw), s(ph), s(r));
    }

    // Cœur : deux lobes + pointe (sz = largeur maquette ~ 2 × sz/16 × 14).
    function heart(dc as Dc, px, py, sz, color as Number) as Void {
        var u = sz / 16.0;
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        var r = s(5 * u);
        dc.fillCircle(x(px - 5 * u), y(py - 5 * u), r);
        dc.fillCircle(x(px + 5 * u), y(py - 5 * u), r);
        dc.fillPolygon([[x(px - 10 * u), y(py - 3 * u)], [x(px + 10 * u), y(py - 3 * u)], [x(px), y(py + 7 * u)]]);
    }

    // Arc (repère canvas : angle en radians, sens horaire depuis 3 h).
    function arc(dc as Dc, px, py, r, a0, a1, color as Number, w) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(s(w));
        var d0 = deg(-a0);
        var d1 = deg(-a1);
        dc.drawArc(x(px), y(py), s(r), Graphics.ARC_CLOCKWISE, d0, d1);
        dc.setPenWidth(1);
    }

    function deg(rad) as Number {
        var d = (rad * 180.0 / Math.PI).toNumber() % 360;
        return d < 0 ? d + 360 : d;
    }

    // Couleur assombrie (opacité simulée sur fond noir), pct 0..100.
    function dim(c as Number, pct as Number) as Number {
        var r = ((c >> 16) & 0xFF) * pct / 100;
        var g = ((c >> 8) & 0xFF) * pct / 100;
        var b = (c & 0xFF) * pct / 100;
        return (r << 16) | (g << 8) | b;
    }

    // Points de pagination sur le bord gauche (9 h).
    function pageDots(dc as Dc, cnt as Number, idx as Number) as Void {
        for (var k = 0; k < cnt; k += 1) {
            var a = Math.PI + (k - (cnt - 1) / 2.0) * 0.09;
            var on = (k == idx);
            circle(dc, 227 + Math.cos(a) * 212, 227 + Math.sin(a) * 212, on ? 6 : 4, on ? 0xFFFFFF : 0x555555);
        }
    }

    // Liste façon Garmin : précédent, élément courant encadré, suivant.
    function list(dc as Dc, title as String, items as Array, idx as Number, color as Number, sub) as Void {
        var cnt = items.size();
        t(dc, title, 227, 70, 30, C_LABEL, null);
        if (cnt > 2) { fit(dc, items[(idx + cnt - 1) % cnt], 227, 150, 34, C_FAINT, null, 340); }
        rrect(dc, 40, 190, 374, 74, 12, C_BOX);
        rect(dc, 40, 198, 7, 58, color);
        fit(dc, items[idx], 232, 227, 48, 0xFFFFFF, null, 350);
        if (sub != null) { fit(dc, sub, 227, 290, 24, C_LABEL, null, 400); }
        if (cnt > 1) { fit(dc, items[(idx + 1) % cnt], 227, sub != null ? 345 : 310, 34, C_FAINT, null, 330); }
    }

    function toast(dc as Dc, str as String) as Void {
        var f = tf(34);
        var w = dc.getTextWidthInPixels(str, f) + s(44);
        if (w > s(400)) { w = s(400); }
        dc.setColor(0x1E242C, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(x(227) - w / 2, y(192), w, s(70), s(14));
        t(dc, str, 227, 227, 34, 0xFFFFFF, null);
    }

    // Durée en secondes → « m:ss » ou « h:mm:ss ».
    function fmt(sec) as String {
        if (sec == null || sec < 0) { return "-"; }
        var h = sec / 3600;
        var m = (sec % 3600) / 60;
        var ss = sec % 60;
        if (h > 0) { return h + ":" + m.format("%02d") + ":" + ss.format("%02d"); }
        return m + ":" + ss.format("%02d");
    }
}
