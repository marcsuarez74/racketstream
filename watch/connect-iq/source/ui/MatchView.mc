import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
using Toybox.WatchUi;

// Écrans de l'app (phase 9, maquette « activité Garmin »).
module Scr {
    const SPORT = 0;       // choix du sport
    const FORMAT = 1;      // choix du format
    const READY = 2;       // prêt à démarrer (accroche FC) ou reprise d'un match
    const ACT = 3;         // activité en cours : pages Score / Cardio / Effort / Match
    const MENU = 4;        // menu de l'activité (maintien UP)
    const MATCHEND = 5;    // match terminé, séance en cours
    const ENDMENU = 6;     // terminer l'activité : Reprendre / Enregistrer / Supprimer
    const CONFIRM = 7;     // confirmation de suppression
    const SAVING = 8;      // enregistrement FIT
    const SUMMARY = 9;     // récap de la séance (5 pages)
    const DONE = 10;       // activité enregistrée
}

// Codes des entrées du menu d'activité.
module MenuItem {
    const RESUME = 0;
    const PAUSE = 1;
    const RESTART = 2;
    const CHANGE_SET = 3;
    const END = 4;
}

// Machine à états des boutons = press() de la maquette. START = point pour
// moi, BACK = point adverse, UP = annuler, DOWN = page suivante, maintien
// UP = menu. Le score vit dans le moteur (ScoreEngine ou PadelEngine),
// sauvegardé et synchronisé après chaque mutation (§7.2, sync §7).
class MatchView extends WatchUi.View {
    const PAGES = 4;
    const SUM_PAGES = 5;

    var mScr = Scr.SPORT;
    var mPrefs;               // [sport, format badminton, format padel, format squash]
    var mSport = Sports.BADMINTON;
    var mFormat = 0;
    var mListIdx = 0;
    var mPage = 0;
    var mSumPage = 0;
    var mMenuItems = [];
    var mPaused = false;
    var mResumed = false;     // READY : reprise d'un match persisté
    var mToast = null;
    var mToastUntil = 0;
    var mSavingAt = 0;
    var mSaved = false;
    var mEndSec = 0;          // chrono et calories figés à l'enregistrement
    var mEndKcal = 0;

    var mEngine = null;
    var mMatchId = "";
    var mT0 = 0;              // début du match courant (getTimer)
    var mAct;
    var mSync;
    var mTimer;
    var mFast = false;

    function initialize() {
        View.initialize();
        mPrefs = MatchStore.loadPrefs();
        mSport = mPrefs[0];
        mAct = new ActivityService();
        mSync = new SyncService(DeviceId.getOrCreate());
        var saved = MatchStore.loadMatch();
        if (saved != null) {
            // Match persisté (app fermée en cours de séance) : écran de reprise.
            mSport = saved["sp"];
            mFormat = saved["fi"];
            mMatchId = saved["mid"];
            mT0 = saved["t0"] != null ? saved["t0"] : System.getTimer();
            mEngine = newEngine(saved["cfg"]);
            mEngine.restore(saved["base"], saved["events"]);
            mEngine.setLastSequence(saved["ls"]);
            if (saved["ts"] != null) { mEngine.setStartedAtMs(saved["ts"].toLong()); }
            mResumed = true;
            mScr = Scr.READY;
            mSync.trigger(mEngine);   // reprend le drain des events non acquittés
        }
        mTimer = new Timer.Timer();
        mTimer.start(method(:onTick), 1000, true);
    }

    function newEngine(cfg) {
        if (Sports.kind(mSport) == Sports.KIND_PADEL) { return new PadelEngine(cfg, mMatchId); }
        return new ScoreEngine(cfg, mMatchId);
    }

    function isPadel() as Boolean { return Sports.kind(mSport) == Sports.KIND_PADEL; }

    // ---- horloge : chrono, FC, toasts, écran d'enregistrement ----

    function onTick() as Void {
        mAct.tick();
        if (mScr == Scr.SAVING) {
            if (!mSaved) {
                mAct.save();          // après le 1er affichage de « Enregistrement »
                mSaved = true;
            } else if (System.getTimer() - mSavingAt >= 1600) {
                mScr = Scr.SUMMARY;
                setFast(false);
            }
        }
        WatchUi.requestUpdate();
    }

    function setFast(on as Boolean) as Void {
        if (on == mFast) { return; }
        mFast = on;
        mTimer.stop();
        mTimer.start(method(:onTick), on ? 100 : 1000, true);
    }

    function toast(text as String) as Void {
        mToast = text;
        mToastUntil = System.getTimer() + 1400;
    }

    // ---- boutons (délégué) ----

    function onSelect() as Boolean { return press(:start); }
    function onBack() as Boolean { return press(:back); }
    function onUp() as Boolean { return press(:up); }
    function onDown() as Boolean { return press(:down); }
    function onMenuButton() as Boolean { return press(:menu); }

    function press(b as Symbol) as Boolean {
        var scr = mScr;
        if (scr == Scr.SPORT) {
            if (b == :back) { return false; }          // BACK ferme l'app
            if (b == :up) { mSport = (mSport + Sports.COUNT - 1) % Sports.COUNT; }
            else if (b == :down) { mSport = (mSport + 1) % Sports.COUNT; }
            else if (b == :start) {
                mFormat = Sports.clampFormat(mSport, mPrefs[1 + mSport]);
                mScr = Scr.FORMAT;
            }
        } else if (scr == Scr.FORMAT) {
            var n = Sports.formatCount(mSport);
            if (b == :up) { mFormat = (mFormat + n - 1) % n; }
            else if (b == :down) { mFormat = (mFormat + 1) % n; }
            else if (b == :start) { mScr = Scr.READY; }
            else if (b == :back) { mScr = Scr.SPORT; }
        } else if (scr == Scr.READY) {
            if (b == :start) { startActivity(); }
            else if (b == :back) {
                if (mResumed) {
                    clearMatch();     // match persisté abandonné
                    mScr = Scr.SPORT;
                } else {
                    mScr = Scr.FORMAT;
                }
            }
        } else if (scr == Scr.ACT) {
            pressAct(b);
        } else if (scr == Scr.MENU) {
            var n = mMenuItems.size();
            if (b == :up) { mListIdx = (mListIdx + n - 1) % n; }
            else if (b == :down) { mListIdx = (mListIdx + 1) % n; }
            else if (b == :back) { mScr = Scr.ACT; }
            else if (b == :start) { menuSelect(mMenuItems[mListIdx]); }
        } else if (scr == Scr.MATCHEND) {
            if (b == :up) { mListIdx = (mListIdx + 2) % 3; }
            else if (b == :down) { mListIdx = (mListIdx + 1) % 3; }
            else if (b == :start) {
                if (mListIdx == 0) { finishSave(); }
                else if (mListIdx == 1) { nextMatch(); }
                else { undo(); }
            }
        } else if (scr == Scr.ENDMENU) {
            if (b == :up) { mListIdx = (mListIdx + 2) % 3; }
            else if (b == :down) { mListIdx = (mListIdx + 1) % 3; }
            else if (b == :back || (b == :start && mListIdx == 0)) { resumeActivity(); }
            else if (b == :start) {
                if (mListIdx == 1) { finishSave(); } else { mScr = Scr.CONFIRM; }
            }
        } else if (scr == Scr.CONFIRM) {
            if (b == :start) {
                mAct.discard();
                clearMatch();
                mScr = Scr.SPORT;
                toast("SUPPRIMÉE");
            } else if (b == :back) {
                mScr = Scr.ENDMENU;
            }
        } else if (scr == Scr.SUMMARY) {
            if (b == :down) { mSumPage = mSumPage < SUM_PAGES - 1 ? mSumPage + 1 : mSumPage; }
            else if (b == :up) { mSumPage = mSumPage > 0 ? mSumPage - 1 : 0; }
            else if (b == :start || b == :back) { mScr = Scr.DONE; }
        } else if (scr == Scr.DONE) {
            if (b == :start || b == :back) {
                clearMatch();
                mAct.reset();
                mScr = Scr.SPORT;
            }
        }
        WatchUi.requestUpdate();
        return true;
    }

    function pressAct(b as Symbol) as Void {
        if (b == :menu) {
            mMenuItems = [MenuItem.RESUME, mPaused ? MenuItem.RESTART : MenuItem.PAUSE];
            if (!isPadel()) { mMenuItems.add(MenuItem.CHANGE_SET); }
            mMenuItems.add(MenuItem.END);
            mListIdx = 0;
            mScr = Scr.MENU;
            return;
        }
        if (mPaused) {
            if (b == :start) { setPaused(false); }
            else if (b == :back) { mListIdx = 0; mScr = Scr.ENDMENU; }
            else if (b == :down) { mPage = (mPage + 1) % PAGES; }
            else if (b == :up) { mPage = (mPage + PAGES - 1) % PAGES; }
            return;
        }
        if (b == :down) { mPage = (mPage + 1) % PAGES; return; }
        if (b == :up) { undo(); return; }
        var ph = mEngine.getPhase();
        if (ph == ScorePhase.SET_RESULT) {
            if (b == :start) { nextSet(); }
            return;
        }
        if (ph == ScorePhase.MATCH_FINISHED) {
            mListIdx = 0;
            mScr = Scr.MATCHEND;
            return;
        }
        if (b == :start) { point(0); } else if (b == :back) { point(1); }
    }

    function menuLabel(code as Number) as String {
        if (code == MenuItem.RESUME) { return "Reprendre"; }
        if (code == MenuItem.PAUSE) { return "Pause"; }
        if (code == MenuItem.RESTART) { return "Relancer le chrono"; }
        if (code == MenuItem.CHANGE_SET) { return "Changer de " + Sports.setWord(mSport).toLower(); }
        return "Terminer l'activité";
    }

    function menuSelect(code as Number) as Void {
        mScr = Scr.ACT;
        if (code == MenuItem.PAUSE) { setPaused(true); }
        else if (code == MenuItem.RESTART) { setPaused(false); }
        else if (code == MenuItem.CHANGE_SET) {
            if (mEngine.getPhase() == ScorePhase.PLAYING) {
                mEngine.changeSet();      // leader crédité (§4.4)
                committed();
                if (mEngine.getPhase() == ScorePhase.MATCH_FINISHED) {
                    mListIdx = 0;
                    mScr = Scr.MATCHEND;
                } else {
                    mAct.lap();
                }
            }
        } else if (code == MenuItem.END) {
            setPaused(true);
            mListIdx = 0;
            mScr = Scr.ENDMENU;
        }
    }

    // ---- séance et match ----

    function setPaused(on as Boolean) as Void {
        mPaused = on;
        if (on) { mAct.pause(); } else { mAct.resume(); }
    }

    function startActivity() as Void {
        mAct.start(mSport);
        mPaused = false;
        mPage = 0;
        if (mResumed) {
            mResumed = false;
            mScr = mEngine.getPhase() == ScorePhase.MATCH_FINISHED ? Scr.MATCHEND : Scr.ACT;
            mListIdx = 0;
            return;
        }
        mPrefs[0] = mSport;
        mPrefs[1 + mSport] = mFormat;
        MatchStore.savePrefs(mPrefs);
        newMatch();
        mScr = Scr.ACT;
    }

    function newMatch() as Void {
        mMatchId = MatchIds.generate();
        mT0 = System.getTimer();
        mEngine = newEngine(Sports.config(mSport, mFormat));
        committed();                  // kill avant le 1er point → reprise 0-0
    }

    // « Nouveau match » dans la même séance : nouveau tour FIT.
    function nextMatch() as Void {
        var st = mAct.getStats();
        if (st != null) { st.archiveMatch(mEngine.setRows(mT0), MatchStats.points(mEngine.getEvents())); }
        mAct.lap();
        newMatch();
        mPage = 0;
        mScr = Scr.ACT;
    }

    function resumeActivity() as Void {
        setPaused(false);
        mScr = mEngine.getPhase() == ScorePhase.MATCH_FINISHED ? Scr.MATCHEND : Scr.ACT;
    }

    function finishSave() as Void {
        mSync.stop(mEngine);          // fin de séance : l'overlay se vide
        setPaused(true);
        mEndSec = mAct.elapsedSec();
        mEndKcal = mAct.calories();
        mSaved = false;
        mSavingAt = System.getTimer();
        mSumPage = 0;
        mScr = Scr.SAVING;
        setFast(true);
    }

    // Après chaque mutation : sauvegarde synchrone puis drain de la sync.
    function committed() as Void {
        MatchStore.saveMatch(mEngine, mSport, mFormat, mT0);
        mSync.trigger(mEngine);
    }

    function clearMatch() as Void {
        mSync.stop(mEngine);          // abandon (sans effet si déjà arrêté)
        MatchStore.clearMatch();
        mEngine = null;
        mSync.trigger(null);
        mResumed = false;
    }

    function point(w as Number) as Void {
        if (w == 0) { mEngine.pointMe(); } else { mEngine.pointOpponent(); }
        committed();
        var ph = mEngine.getPhase();
        if (ph == ScorePhase.MATCH_FINISHED) {
            mListIdx = 0;
            mScr = Scr.MATCHEND;
            return;
        }
        if (ph == ScorePhase.SET_RESULT) { return; }
        if (isPadel()) {
            var gw = mEngine.getGameWon();
            if (gw >= 0) {
                var gm = mEngine.getGamesMe();
                var go = mEngine.getGamesOpp();
                toast((gw == 0 ? "JEU MOI  " : "JEU ADV  ") + gm + "-" + go + ((gm + go) % 2 == 1 ? " · côté" : ""));
                return;
            }
        } else {
            var side = Sports.sideAt(mSport, mFormat);
            var last = mEngine.getConfig().mSetsToWin - 1;
            var a = mEngine.getScoreMe();
            var bb = mEngine.getScoreOpp();
            var hi = a > bb ? a : bb;
            var lo = a > bb ? bb : a;
            if (side > 0 && mEngine.getSetsMe() == last && mEngine.getSetsOpp() == last && hi == side && lo < side) {
                toast("CHANGEMENT DE CÔTÉ");
                return;
            }
        }
        if (mPage != 0) { toast(scoreLine()); }
    }

    function nextSet() as Void {
        mEngine.changeSet();
        committed();
        mAct.lap();                   // un tour FIT par set
    }

    function undo() as Void {
        if (mEngine.getEvents().size() == 0) { return; }
        mEngine.undoPoint();
        committed();
        var ph = mEngine.getPhase();
        if (mScr == Scr.MATCHEND && ph != ScorePhase.MATCH_FINISHED) { mScr = Scr.ACT; }
        toast("ANNULÉ  " + (ph == ScorePhase.PLAYING ? scoreLine() : ""));
    }

    function scoreLine() as String {
        if (isPadel()) {
            var l = mEngine.labels();
            return l[0] + " - " + l[1] + "  ·  " + mEngine.getGamesMe() + "-" + mEngine.getGamesOpp();
        }
        return mEngine.getScoreMe() + " - " + mEngine.getScoreOpp();
    }

    // Serveur au badminton/squash : gagnant du dernier échange (moi au départ).
    function server() as Number {
        if (isPadel()) { return mEngine.getServer(); }
        var ev = mEngine.getEvents();
        for (var i = ev.size() - 1; i >= 0; i -= 1) {
            var t = ev[i][0];
            if (t == ScoreEvent.TYPE_SET_CHANGED) { return 0; }
            if (t == ScoreEvent.TYPE_POINT_ME) { return 0; }
            if (t == ScoreEvent.TYPE_POINT_OPPONENT) { return 1; }
        }
        return 0;
    }

    // Filet App.onStop : match sauvegardé, séance FIT enregistrée.
    function persist() as Void {
        if (mEngine != null) { MatchStore.saveMatch(mEngine, mSport, mFormat, mT0); }
        mAct.saveIfActive();
    }

    // ---- dessin ----

    function onUpdate(dc as Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        if (!Ui.mReady) { Ui.init(dc); }
        var scr = mScr;
        var color = Sports.color(mSport);
        if (scr == Scr.SPORT) {
            Ui.list(dc, "ACTIVITÉ", [Sports.name(0), Sports.name(1), Sports.name(2)], mSport, color, null);
        } else if (scr == Scr.FORMAT) {
            var labels = [];
            for (var i = 0; i < Sports.formatCount(mSport); i += 1) { labels.add(Sports.formatLabel(mSport, i)); }
            Ui.list(dc, Sports.name(mSport).toUpper(), labels, mFormat, color, Sports.formatDetail(mSport, mFormat));
        } else if (scr == Scr.READY) {
            Pages.ready(dc, self);
        } else if (scr == Scr.ACT) {
            Pages.act(dc, self);
        } else if (scr == Scr.MENU) {
            var items = [];
            for (var j = 0; j < mMenuItems.size(); j += 1) { items.add(menuLabel(mMenuItems[j])); }
            Ui.list(dc, "MENU", items, mListIdx, color, null);
        } else if (scr == Scr.MATCHEND) {
            Pages.matchEnd(dc, self);
        } else if (scr == Scr.ENDMENU) {
            Ui.list(dc, "ACTIVITÉ", ["Reprendre", "Enregistrer", "Supprimer"], mListIdx,
                mListIdx == 2 ? Ui.C_RED : color, "Chrono " + Ui.fmt(mAct.elapsedSec()));
        } else if (scr == Scr.CONFIRM) {
            Ui.t(dc, "Supprimer", 227, 160, 48, 0xFFFFFF, null);
            Ui.t(dc, "l'activité ?", 227, 225, 48, 0xFFFFFF, null);
            Ui.t(dc, "START  oui", 227, 300, 30, Ui.C_RED, null);
            Ui.t(dc, "BACK  non", 227, 345, 30, Ui.C_LABEL, null);
        } else if (scr == Scr.SAVING) {
            var a = (System.getTimer() % 1257) / 200.0;
            Ui.arc(dc, 227, 190, 46, a, a + 4.4, Ui.C_BLUE, 10);
            Ui.fit(dc, "Enregistrement...", 227, 290, 40, 0xFFFFFF, null, 400);
        } else if (scr == Scr.SUMMARY) {
            Pages.summary(dc, self);
        } else if (scr == Scr.DONE) {
            Pages.done(dc);
        }
        if (mToast != null) {
            if (System.getTimer() < mToastUntil) { Ui.toast(dc, mToast); } else { mToast = null; }
        }
        if (scr != Scr.MENU && scr != Scr.ENDMENU && scr != Scr.CONFIRM) { drawSyncBorder(dc, dc.getWidth(), dc.getHeight()); }
    }

    // Liseré périphérique : SYNC_ST_SEND = vert, SYNC_ST_ERR = rouge, rien
    // sinon (OK ou off). Anneau sur écran rond, 4 bandes sinon. Ne touche
    // jamais au scoring : le réseau reste non-bloquant (spec sync §7).
    function drawSyncBorder(dc as Dc, w as Number, h as Number) as Void {
        var st = mSync.getStatus();
        var color = null;
        if (st == SYNC_ST_SEND) { color = 0x2FE05C; }
        else if (st == SYNC_ST_ERR) { color = 0xE5484D; }
        else { return; }
        var t = h / 90;
        if (t < 2) { t = 2; }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        // Code d'erreur en haut-centre : "401", "404", "t/o"… (cf. guide, FAQ).
        if (st == SYNC_ST_ERR) {
            var err = mSync.getLastError();
            dc.drawText(w / 2, h / 12, Graphics.FONT_XTINY, "sync " + (err == -1 ? "t/o" : err), Graphics.TEXT_JUSTIFY_CENTER);
        }
        if (System.getDeviceSettings().screenShape == System.SCREEN_SHAPE_ROUND) {
            var r = w / 2 - t / 2 - 1;
            for (var i = 0; i < t; i += 1) { dc.drawCircle(w / 2, h / 2, r - i); }
        } else {
            dc.fillRectangle(0, 0, w, t);
            dc.fillRectangle(0, h - t, w, t);
            dc.fillRectangle(0, 0, t, h);
            dc.fillRectangle(w - t, 0, t, h);
        }
    }
}
