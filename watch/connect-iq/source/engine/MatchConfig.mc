import Toybox.Lang;

// Paramétrage complet d'un match (spec §4.1 — aucun chiffre codé en dur ailleurs).
class MatchConfig {
    var mTargetScore;   // points pour gagner un set (si écart suffisant)
    var mWinBy;         // écart minimal requis en fin de set
    var mCap;           // plafond optionnel (0 = sans plafond)
    var mSetsToWin;     // sets gagnants pour le match (best-of-3 => 2)
    var mSport = 0;     // Sports.* (phase 9) — 0 = badminton (configs 0.2.x)
    var mDeuce = 0;     // padel : mode d'égalité (PadelRules.DEUCE_*), 0 = sport à points
    var mSuperTB = false;   // padel : 3e set remplacé par un super tie-break à 10

    function initialize(targetScore, winBy, cap, setsToWin) {
        mTargetScore = targetScore;
        mWinBy = winBy;
        mCap = cap;
        mSetsToWin = setsToWin;
    }
}

// Presets §4.1 : 11 pts (sans plafond), 15 pts (cap 21), 21 pts (cap 30).
module MatchPresets {
    function count() as Number {
        return 3;
    }

    // Index 0 = 11 pts, 1 = 15 pts, 2 = 21 pts (ordre du Setup : UP/DOWN naviguent).
    function get(index as Number) as MatchConfig {
        if (index == 0) { return new MatchConfig(11, 2, 0, 2); }
        if (index == 1) { return new MatchConfig(15, 2, 21, 2); }
        return new MatchConfig(21, 2, 30, 2);
    }

    function label(index as Number) as String {
        if (index == 0) { return "11 POINTS"; }
        if (index == 1) { return "15 POINTS"; }
        return "21 POINTS";
    }

    // Label compact pour le footer de l'écran SCORE (zone basse étroite sur rond).
    function shortLabel(index as Number) as String {
        if (index == 0) { return "11 PTS"; }
        if (index == 1) { return "15 PTS"; }
        return "21 PTS";
    }
}
