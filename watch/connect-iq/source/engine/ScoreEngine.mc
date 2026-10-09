import Toybox.Lang;
import Toybox.System;
import Toybox.Time;

// Moteur de score PUR (aucun import Graphics/WatchUi, spec §6.2).
// Event-sourcing : l'état est le replay du journal ; les mutations poussent
// des événements puis rejouent. État = replay(base + journal) — la base porte
// l'effet des événements purgés (§7.2).
class ScoreEngine {

    var mConfig;      // MatchConfig
    var mEvents;      // Array de tableaux positionnels

    // État dérivé (replay)
    var mPhase;             // ScorePhase.PLAYING / SET_RESULT / MATCH_FINISHED
    var mScoreMe;           // set courant
    var mScoreOpp;
    var mSetsMe;            // sets gagnés
    var mSetsOpp;
    var mSetNumber;         // 1-based
    var mLastSetScoreMe;    // score final du dernier set terminé (SET_RESULT)
    var mLastSetScoreOpp;
    var mMatchId;       // id du match — préfixe des ids d'événements (§7.1)
    var mLastSequence;  // compteur monotone : jamais réutilisé, même après undo (D-2)

    // État de base (§7.2) : état produit par les événements PURGÉS du journal.
    // replay() = base + journal. Rien de purgé → base = état initial ; après purge → base avancée.
    var mBasePhase;
    var mBaseScoreMe;
    var mBaseScoreOpp;
    var mBaseSetsMe;
    var mBaseSetsOpp;
    var mBaseSetNumber;
    var mBaseLastSetScoreMe;
    var mBaseLastSetScoreOpp;
    var mStartedAtMs;               // début du match (epoch ms) — ordonnancement cloud

    function initialize(config, matchId) {
        mConfig = config;
        mMatchId = matchId;
        mStartedAtMs = Time.now().value() * 1000l;   // fallback restore ; MatchView remet la valeur persistée
        mEvents = [];
        mLastSequence = 0;
        resetBase();
        replay();
    }

    function getStartedAtMs() as Long { return mStartedAtMs; }
    function setStartedAtMs(ms as Long) as Void { mStartedAtMs = ms; }

    // ---- mutations ----

    function pointMe() as Void {
        if (mPhase != ScorePhase.PLAYING) { return; }
        appendEvent([ScoreEvent.TYPE_POINT_ME]);
        checkAutoSetFinish(0);
    }

    function pointOpponent() as Void {
        if (mPhase != ScorePhase.PLAYING) { return; }
        appendEvent([ScoreEvent.TYPE_POINT_OPPONENT]);
        checkAutoSetFinish(1);
    }

    // Transition « set suivant » : depuis SET_RESULT (fin auto, set déjà crédité)
    // ou depuis PLAYING (changement manuel confirmé — leader strict crédité, §4.4).
    function changeSet() as Void {
        if (mPhase == ScorePhase.MATCH_FINISHED) { return; }
        var winner = -1;
        if (mPhase == ScorePhase.PLAYING) {
            if (mScoreMe > mScoreOpp) { winner = 0; }
            else if (mScoreOpp > mScoreMe) { winner = 1; }
        }
        appendEvent([ScoreEvent.TYPE_SET_CHANGED, winner]);
        if (mPhase == ScorePhase.MATCH_FINISHED) {
            appendEvent([ScoreEvent.TYPE_MATCH_FINISHED]);
        }
    }

    // Nouveau match (menu Réinitialiser/Changer de format ou DOWN sur MATCH_FINISHED).
    // Nouveau matchId : nouvelle espace de séquences.
    function newMatch(config, matchId) as Void {
        mConfig = config;
        mMatchId = matchId;
        mStartedAtMs = Time.now().value() * 1000l;
        mEvents = [];
        mLastSequence = 0;
        resetBase();
        replay();
    }

    // UNDO (§4.5/D7) : retire le dernier événement du journal (quel qu'il
    // soit) puis rejoue. MATCH_FINISHED ne s'annule jamais (verrou) ;
    // journal vide → sans effet. slice() plutôt que remove() (par valeur).
    function undo() as Void {
        if (mEvents.size() == 0) { return; }
        var last = mEvents[mEvents.size() - 1];
        if (last[0] == ScoreEvent.TYPE_MATCH_FINISHED) { return; }
        mEvents = mEvents.slice(0, mEvents.size() - 1);
        replay();
    }

    // « Annuler le dernier point » (phase 9, maquette) : retire d'abord les
    // fins de set/match automatiques puis le point (ou le « set suivant » /
    // changement manuel) qui les a provoquées. Lève le verrou MATCH_FINISHED
    // de undo() : l'écran de fin de match propose l'annulation.
    function undoPoint() as Void {
        while (mEvents.size() > 0) {
            var t = mEvents[mEvents.size() - 1][0];
            if (t != ScoreEvent.TYPE_MATCH_FINISHED && t != ScoreEvent.TYPE_SET_FINISHED) { break; }
            mEvents = mEvents.slice(0, mEvents.size() - 1);
        }
        if (mEvents.size() > 0) {
            mEvents = mEvents.slice(0, mEvents.size() - 1);
        }
        replay();
    }

    // Sets terminés (cf. MatchStats.rallySetRows), t0 = début du match.
    function setRows(t0 as Number) as Array {
        return MatchStats.rallySetRows(mEvents, t0);
    }

    // ---- journal + replay ----

    // Journal positionnel compact (§7.2) : [type, arg, seq, ts, prevMe, prevOpp].
    // prev = état dérivé AVANT l'event (append précède replay).
    function appendEvent(e) as Void {
        var arg = e.size() > 1 ? e[1] : 0;
        mLastSequence += 1;
        mEvents.add([e[0], arg, mLastSequence, System.getTimer(), mScoreMe, mScoreOpp]);
        replay();
    }

    function replay() as Void {
        copyBaseToDerived();
        for (var i = 0; i < mEvents.size(); i += 1) {
            applyEvent(mEvents[i]);
        }
    }

    // ---- état de base (Phase 3, §7.2) ----

    function resetBase() as Void {
        mBasePhase = ScorePhase.PLAYING;
        mBaseScoreMe = 0;
        mBaseScoreOpp = 0;
        mBaseSetsMe = 0;
        mBaseSetsOpp = 0;
        mBaseSetNumber = 1;
        mBaseLastSetScoreMe = 0;
        mBaseLastSetScoreOpp = 0;
    }

    function copyBaseToDerived() as Void {
        mPhase = mBasePhase;
        mScoreMe = mBaseScoreMe;
        mScoreOpp = mBaseScoreOpp;
        mSetsMe = mBaseSetsMe;
        mSetsOpp = mBaseSetsOpp;
        mSetNumber = mBaseSetNumber;
        mLastSetScoreMe = mBaseLastSetScoreMe;
        mLastSetScoreOpp = mBaseLastSetScoreOpp;
    }

    function copyDerivedToBase() as Void {
        mBasePhase = mPhase;
        mBaseScoreMe = mScoreMe;
        mBaseScoreOpp = mScoreOpp;
        mBaseSetsMe = mSetsMe;
        mBaseSetsOpp = mSetsOpp;
        mBaseSetNumber = mSetNumber;
        mBaseLastSetScoreMe = mLastSetScoreMe;
        mBaseLastSetScoreOpp = mLastSetScoreOpp;
    }

    function applyEvent(e) as Void {
        switch (e[0]) {
        case ScoreEvent.TYPE_POINT_ME:
            mScoreMe += 1;
            break;
        case ScoreEvent.TYPE_POINT_OPPONENT:
            mScoreOpp += 1;
            break;
        case ScoreEvent.TYPE_SET_FINISHED:
            mLastSetScoreMe = mScoreMe;
            mLastSetScoreOpp = mScoreOpp;
            if (e[1] == 0) { mSetsMe += 1; } else { mSetsOpp += 1; }
            if (mSetsMe >= mConfig.mSetsToWin || mSetsOpp >= mConfig.mSetsToWin) {
                mPhase = ScorePhase.MATCH_FINISHED;
            } else {
                mPhase = ScorePhase.SET_RESULT;
            }
            break;
        case ScoreEvent.TYPE_SET_CHANGED:
            if (e[1] == 0) { mSetsMe += 1; }
            else if (e[1] == 1) { mSetsOpp += 1; }
            mSetNumber += 1;
            mScoreMe = 0;
            mScoreOpp = 0;
            if (mSetsMe >= mConfig.mSetsToWin || mSetsOpp >= mConfig.mSetsToWin) {
                mPhase = ScorePhase.MATCH_FINISHED;
            } else {
                mPhase = ScorePhase.PLAYING;
            }
            break;
        case ScoreEvent.TYPE_MATCH_FINISHED:
            mPhase = ScorePhase.MATCH_FINISHED;
            break;
        }
    }

    // Fin de set automatique après un point : pousse SET_FINISHED puis,
    // si le match est gagné, MATCH_FINISHED (verrou §4.5).
    function checkAutoSetFinish(winner as Number) as Void {
        if (!Rules.isSetOver(mConfig, mScoreMe, mScoreOpp)) { return; }
        appendEvent([ScoreEvent.TYPE_SET_FINISHED, winner]);
        if (mPhase == ScorePhase.MATCH_FINISHED) {
            appendEvent([ScoreEvent.TYPE_MATCH_FINISHED]);
        }
    }

    // ---- lectures pour l'UI ----

    function getPhase() as Number { return mPhase; }
    function getScoreMe() as Number { return mScoreMe; }
    function getScoreOpp() as Number { return mScoreOpp; }
    function getSetsMe() as Number { return mSetsMe; }
    function getSetsOpp() as Number { return mSetsOpp; }
    function getSetNumber() as Number { return mSetNumber; }
    function getLastSetScoreMe() as Number { return mLastSetScoreMe; }
    function getLastSetScoreOpp() as Number { return mLastSetScoreOpp; }
    function getConfig() as MatchConfig { return mConfig; }
    function getEvents() as Array { return mEvents; }

    // ---- protocole (§7.1/§8.2) ----
    function getEvent(i as Number) as Array { return mEvents[i]; }
    function getEventId(i as Number) as String { return mMatchId + ":" + mEvents[i][2]; }

    // Restauration (§7.2) : base = état produit par les événements absents du
    // journal ; events = journal conservé (6 slots). Ordre base :
    // [phase, scoreMe, scoreOpp, setsMe, setsOpp, setNumber, lastSetMe, lastSetOpp].
    // La séquence poursuit après restauration : le dernier event du journal
    // porte toujours mLastSequence (invariant appendEvent).
    function restore(base as Array, events as Array) as Void {
        mBasePhase = base[0];
        mBaseScoreMe = base[1];
        mBaseScoreOpp = base[2];
        mBaseSetsMe = base[3];
        mBaseSetsOpp = base[4];
        mBaseSetNumber = base[5];
        mBaseLastSetScoreMe = base[6];
        mBaseLastSetScoreOpp = base[7];
        mEvents = events;
        mLastSequence = events.size() > 0 ? events[events.size() - 1][2] : mLastSequence;
        replay();
    }

    // Purge §7.2 : historique borné — au-delà de maxKeep, retire les plus
    // anciens et avance la base de leur effet. Jamais le dernier event.
    function trimEvents(maxKeep as Number) as Void {
        var size = mEvents.size();
        if (size <= maxKeep) { return; }
        if (maxKeep < 1) { maxKeep = 1; }
        var drop = size - maxKeep;
        copyBaseToDerived();
        for (var i = 0; i < drop; i += 1) {
            applyEvent(mEvents[i]);
        }
        copyDerivedToBase();
        mEvents = mEvents.slice(drop, size);
        replay();
    }

    function getBaseState() as Array {
        return [mBasePhase, mBaseScoreMe, mBaseScoreOpp, mBaseSetsMe, mBaseSetsOpp,
            mBaseSetNumber, mBaseLastSetScoreMe, mBaseLastSetScoreOpp];
    }

    function getMatchId() as String { return mMatchId; }
    function getLastSequence() as Number { return mLastSequence; }

    // Filet D-2 : le compteur ne peut qu'augmenter (l'undo ne décrémente jamais).
    // Utilisé au restore depuis la meta "ls" (Task 3) : le dernier event
    // journalisé peut avoir une seq < mLastSequence après un undo.
    function setLastSequence(seq as Number) as Void {
        if (seq > mLastSequence) { mLastSequence = seq; }
    }
}
