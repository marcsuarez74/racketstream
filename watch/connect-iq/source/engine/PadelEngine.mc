import Toybox.Lang;
import Toybox.System;
import Toybox.Time;

// Règles du padel (phase 9, maquette) : jeux en 0/15/30/40, trois modes
// d'égalité, set en 6 jeux avec 2 d'écart, tie-break à 7 à 6-6, super
// tie-break à 10 en option à la place du 3e set.
module PadelRules {
    const DEUCE_ADV = 1;      // avantages classiques
    const DEUCE_GOLDEN = 2;   // point en or à 40-40
    const DEUCE_STAR = 3;     // Star Point (FIP 2026) : 3e égalité = point décisif

    // Formats de Sports.formatLabel(PADEL, f). targetScore/winBy/cap décrivent
    // le set en jeux (6, écart 2, 7 avec tie-break) pour le backend.
    function config(f as Number) as MatchConfig {
        var c = new MatchConfig(6, 2, 7, 2);
        if (f == 0) { c.mDeuce = DEUCE_STAR; }
        else if (f == 2) { c.mDeuce = DEUCE_ADV; }
        else { c.mDeuce = DEUCE_GOLDEN; }
        c.mSuperTB = (f == 3);
        return c;
    }

    // Jeu gagné ? (points du jeu en cours, hors tie-break)
    function gameWon(deuce as Number, a as Number, b as Number) as Boolean {
        var mx = a > b ? a : b;
        var d = a > b ? a - b : b - a;
        if (deuce == DEUCE_GOLDEN) { return mx >= 4; }
        if (deuce == DEUCE_STAR) { return (mx >= 4 && d >= 2) || mx >= 6; }
        return mx >= 4 && d >= 2;
    }

    // Libellés [moi, adv, bandeau] du jeu en cours. tb : 0 jeu, 1 tie-break,
    // 2 super tie-break.
    function labels(deuce as Number, tb as Number, a as Number, b as Number) as Array {
        if (tb > 0) {
            return [a + "", b + "", tb == 2 ? "SUPER TIE-BREAK" : "TIE-BREAK"];
        }
        var pts = ["0", "15", "30", "40"];
        if (a >= 3 && b >= 3) {
            if (a == b) {
                if (deuce == DEUCE_GOLDEN) { return ["40", "40", "POINT EN OR"]; }
                if (deuce == DEUCE_STAR) {
                    var n = a - 2;
                    return ["40", "40", n >= 3 ? "STAR POINT" : "ÉGALITÉ " + n + "/2"];
                }
                return ["40", "40", "ÉGALITÉ"];
            }
            return a > b ? ["AV", "40", "AVANTAGE"] : ["40", "AV", "AVANTAGE"];
        }
        return [pts[a], pts[b], ""];
    }
}

// Moteur de score padel PUR, même contrat que ScoreEngine (journal plat
// [type, arg, seq, ts, prevMe, prevOpp], base + replay, undo, purge) pour
// que la vue, la persistance et la sync le manipulent à l'identique.
// Seuls les points font avancer l'état ; SET_FINISHED / MATCH_FINISHED sont
// journalisés pour le backend mais n'ont pas d'effet au rejeu.
class PadelEngine {
    // Index de l'état (tableau, copiable en base)
    const PHASE = 0;
    const ME = 1;          // points du jeu (ou du tie-break) en cours
    const OPP = 2;
    const GME = 3;         // jeux du set en cours
    const GOPP = 4;
    const SME = 5;         // sets gagnés
    const SOPP = 6;
    const SETNO = 7;       // 1-based
    const TB = 8;          // 0 jeu normal, 1 tie-break, 2 super tie-break
    const SERVER = 9;      // 0 moi, 1 adversaire
    const STBNEXT = 10;    // le prochain set est un super tie-break
    const SETSTART = 11;   // ts du début du set en cours
    const SETS = 12;       // sets terminés : [jeuxMoi, jeuxAdv, gagnant, début, fin, tb]
    const GAMEWON = 13;    // jeu conclu par le dernier point : 0 moi, 1 adv, -1 non
    const SIZE = 14;

    var mConfig;
    var mEvents;
    var mS;                // état dérivé
    var mBase;             // état produit par les events purgés
    var mMatchId;
    var mLastSequence;
    var mStartedAtMs;

    function initialize(config, matchId) {
        mConfig = config;
        mMatchId = matchId;
        mStartedAtMs = Time.now().value() * 1000l;
        mEvents = [];
        mLastSequence = 0;
        mBase = initialState(System.getTimer());
        replay();
    }

    function initialState(t0) as Array {
        var s = [] as Array;
        for (var i = 0; i < SIZE; i += 1) { s.add(0); }
        s[SETNO] = 1;
        s[SETSTART] = t0;
        s[SETS] = [];
        s[GAMEWON] = -1;
        return s;
    }

    function copyState(s as Array) as Array {
        var c = new [SIZE];
        for (var i = 0; i < SIZE; i += 1) { c[i] = s[i]; }
        c[SETS] = (s[SETS] as Array).slice(0, null);
        return c;
    }

    // ---- mutations ----

    function pointMe() as Void { point(0); }
    function pointOpponent() as Void { point(1); }

    function point(w as Number) as Void {
        if (mS[PHASE] != ScorePhase.PLAYING) { return; }
        appendEvent(w == 0 ? ScoreEvent.TYPE_POINT_ME : ScoreEvent.TYPE_POINT_OPPONENT, 0);
        var phase = mS[PHASE];
        if (phase != ScorePhase.PLAYING) {
            var rows = mS[SETS] as Array;
            appendEvent(ScoreEvent.TYPE_SET_FINISHED, (rows[rows.size() - 1] as Array)[2]);
            if (phase == ScorePhase.MATCH_FINISHED) {
                appendEvent(ScoreEvent.TYPE_MATCH_FINISHED, 0);
            }
        }
    }

    // « Set suivant » depuis l'écran de fin de set. Au padel les sets se
    // terminent toujours seuls : pas de changement manuel.
    function changeSet() as Void {
        if (mS[PHASE] != ScorePhase.SET_RESULT) { return; }
        appendEvent(ScoreEvent.TYPE_SET_CHANGED, -1);
    }

    function newMatch(config, matchId) as Void {
        mConfig = config;
        mMatchId = matchId;
        mStartedAtMs = Time.now().value() * 1000l;
        mEvents = [];
        mLastSequence = 0;
        mBase = initialState(System.getTimer());
        replay();
    }

    // Retire le dernier événement (contrat ScoreEngine.undo, sans verrou).
    function undo() as Void {
        if (mEvents.size() == 0) { return; }
        mEvents = mEvents.slice(0, mEvents.size() - 1);
        replay();
    }

    // « Annuler le dernier point » : retire les fins de set/match dérivées
    // puis le point (ou le « set suivant ») qui les précède.
    function undoPoint() as Void {
        while (mEvents.size() > 0) {
            var t = (mEvents[mEvents.size() - 1] as Array)[0];
            if (t != ScoreEvent.TYPE_MATCH_FINISHED && t != ScoreEvent.TYPE_SET_FINISHED) { break; }
            mEvents = mEvents.slice(0, mEvents.size() - 1);
        }
        undo();
    }

    // ---- journal + replay ----

    function appendEvent(type as Number, arg as Number) as Void {
        mLastSequence += 1;
        mEvents.add([type, arg, mLastSequence, System.getTimer(), mS[ME], mS[OPP]]);
        replay();
    }

    function replay() as Void {
        mS = copyState(mBase);
        for (var i = 0; i < mEvents.size(); i += 1) {
            applyEvent(mS, mEvents[i]);
        }
    }

    function applyEvent(s as Array, e as Array) as Void {
        var t = e[0];
        s[GAMEWON] = -1;
        if (t == ScoreEvent.TYPE_SET_CHANGED) {
            if (s[PHASE] != ScorePhase.SET_RESULT) { return; }
            s[PHASE] = ScorePhase.PLAYING;
            s[SETNO] += 1;
            s[SETSTART] = e[3];
            if (s[STBNEXT] == 1) {
                s[TB] = 2;
                s[STBNEXT] = 0;
            }
            return;
        }
        if (t != ScoreEvent.TYPE_POINT_ME && t != ScoreEvent.TYPE_POINT_OPPONENT) { return; }
        if (s[PHASE] != ScorePhase.PLAYING) { return; }
        if (t == ScoreEvent.TYPE_POINT_ME) { s[ME] += 1; } else { s[OPP] += 1; }
        var a = s[ME];
        var b = s[OPP];
        var mx = a > b ? a : b;
        var d = a > b ? a - b : b - a;
        var lead = a > b ? 0 : 1;
        if (s[TB] > 0) {
            // Tie-break : service changé après le 1er point puis tous les 2.
            if ((a + b) % 2 == 1) { s[SERVER] = 1 - s[SERVER]; }
            var target = (s[TB] == 2) ? 10 : 7;
            if (mx >= target && d >= 2) {
                if (s[TB] == 2) {
                    endSet(s, lead, a, b, -1, e[3]);
                } else {
                    var lo = a < b ? a : b;
                    endSet(s, lead, lead == 0 ? 7 : 6, lead == 0 ? 6 : 7, lo + 1, e[3]);
                }
            }
            return;
        }
        if (!PadelRules.gameWon(mConfig.mDeuce, a, b)) { return; }
        if (lead == 0) { s[GME] += 1; } else { s[GOPP] += 1; }
        s[ME] = 0;
        s[OPP] = 0;
        s[SERVER] = 1 - s[SERVER];
        s[GAMEWON] = lead;
        var gm = s[GME];
        var go = s[GOPP];
        var gd = gm > go ? gm - go : go - gm;
        if ((gm >= 6 || go >= 6) && gd >= 2) {
            endSet(s, gm > go ? 0 : 1, gm, go, 0, e[3]);
        } else if (gm == 6 && go == 6) {
            s[TB] = 1;
        }
    }

    function endSet(s as Array, winner as Number, sm as Number, so as Number, tb as Number, ts as Number) as Void {
        (s[SETS] as Array).add([sm, so, winner, s[SETSTART], ts, tb]);
        if (winner == 0) { s[SME] += 1; } else { s[SOPP] += 1; }
        s[ME] = 0;
        s[OPP] = 0;
        s[GME] = 0;
        s[GOPP] = 0;
        s[TB] = 0;
        if (s[SME] >= mConfig.mSetsToWin || s[SOPP] >= mConfig.mSetsToWin) {
            s[PHASE] = ScorePhase.MATCH_FINISHED;
        } else {
            s[PHASE] = ScorePhase.SET_RESULT;
            s[STBNEXT] = (mConfig.mSuperTB && s[SME] == s[SOPP] && s[SME] == mConfig.mSetsToWin - 1) ? 1 : 0;
        }
    }

    // Reprise (MatchStore) : base persistée (null = état initial) + journal.
    function restore(base, events as Array) as Void {
        if (base != null && base instanceof Array && (base as Array).size() == SIZE) {
            mBase = copyState(base);
        } else {
            mBase = initialState(System.getTimer());
        }
        mEvents = events;
        mLastSequence = 0;
        for (var i = 0; i < events.size(); i += 1) {
            var seq = (events[i] as Array)[2];
            if (seq > mLastSequence) { mLastSequence = seq; }
        }
        replay();
    }

    // Purge par le début : les events retirés sont intégrés à la base.
    function trimEvents(maxKeep as Number) as Void {
        if (mEvents.size() <= maxKeep) { return; }
        var drop = mEvents.size() - maxKeep;
        for (var i = 0; i < drop; i += 1) {
            applyEvent(mBase, mEvents[i]);
        }
        mEvents = mEvents.slice(drop, null);
        replay();
    }

    function getBaseState() as Array { return copyState(mBase); }

    // ---- lectures (contrat ScoreEngine) ----
    function getPhase() as Number { return mS[PHASE]; }
    function getScoreMe() as Number { return mS[ME]; }
    function getScoreOpp() as Number { return mS[OPP]; }
    function getSetsMe() as Number { return mS[SME]; }
    function getSetsOpp() as Number { return mS[SOPP]; }
    function getSetNumber() as Number { return mS[SETNO]; }
    function getLastSetScoreMe() as Number { return lastSet(0); }
    function getLastSetScoreOpp() as Number { return lastSet(1); }
    function getConfig() as MatchConfig { return mConfig; }
    function getEvents() as Array { return mEvents; }
    function getMatchId() as String { return mMatchId; }
    function getLastSequence() as Number { return mLastSequence; }
    function setLastSequence(seq as Number) as Void { if (seq > mLastSequence) { mLastSequence = seq; } }
    function getStartedAtMs() as Long { return mStartedAtMs; }
    function setStartedAtMs(ms as Long) as Void { mStartedAtMs = ms; }

    // ---- lectures padel ----
    function getGamesMe() as Number { return mS[GME]; }
    function getGamesOpp() as Number { return mS[GOPP]; }
    function getTieBreak() as Number { return mS[TB]; }
    function getServer() as Number { return mS[SERVER]; }
    function getGameWon() as Number { return mS[GAMEWON]; }
    function isSuperTBNext() as Boolean { return mS[STBNEXT] == 1; }
    function labels() as Array { return PadelRules.labels(mConfig.mDeuce, mS[TB], mS[ME], mS[OPP]); }

    // Sets terminés (format MatchStats.rallySetRows) ; t0 ignoré (le début
    // de set est dans l'état).
    function setRows(t0 as Number) as Array { return mS[SETS]; }

    function lastSet(i as Number) as Number {
        var rows = mS[SETS] as Array;
        if (rows.size() == 0) { return 0; }
        return (rows[rows.size() - 1] as Array)[i];
    }
}
