import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.Lang;
import Toybox.Sensor;
import Toybox.System;
import Toybox.UserProfile;

// Séance Garmin (phase 9) : enregistrement FIT (ActivityRecording), cardio,
// calories, chrono actif et tours. Chaque appel est protégé par `has` : sur
// une montre sans ActivityRecording la séance reste « virtuelle » (chrono
// et stats tenus par l'app, rien d'écrit dans Garmin Connect).
class ActivityService {
    var mSession = null;
    var mRunning = false;      // chrono en marche (pas en pause)
    var mElapsedMs = 0;        // chrono actif cumulé
    var mLastTick = 0;
    var mStats = null;         // SessionStats de la séance en cours

    function initialize() {
        // Cardio poignet allumé dès l'écran « Prêt » (accroche FC).
        if (Toybox has :Sensor) {
            Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        }
    }

    function heartRate() {
        var info = Activity.getActivityInfo();
        if (info != null && info.currentHeartRate != null) { return info.currentHeartRate; }
        if (Toybox has :Sensor) {
            var s = Sensor.getInfo();
            if (s != null && s has :heartRate && s.heartRate != null) { return s.heartRate; }
        }
        return null;
    }

    function calories() as Number {
        var info = Activity.getActivityInfo();
        if (info != null && info.calories != null) { return info.calories; }
        return 0;
    }

    function zones() {
        if (Toybox has :UserProfile && UserProfile has :getHeartRateZones) {
            return UserProfile.getHeartRateZones(UserProfile.HR_ZONE_SPORT_GENERIC);
        }
        return null;
    }

    // Démarre l'enregistrement : SPORT_RACKET + sous-sport sur les montres
    // qui le connaissent (CIQ ≥ 4.1.6), sinon SPORT_GENERIC.
    function start(sport as Number) as Void {
        var now = System.getTimer();
        mStats = new SessionStats(zones(), now);
        mElapsedMs = 0;
        mLastTick = now;
        mRunning = true;
        if (Toybox has :ActivityRecording) {
            var sp = Activity.SPORT_GENERIC;
            var sub = Activity.SUB_SPORT_GENERIC;
            if (Activity has :SPORT_RACKET) {
                sp = 64;
                sub = Sports.subSport(sport);
            }
            mSession = ActivityRecording.createSession({
                :name => Sports.name(sport),
                :sport => sp,
                :subSport => sub
            });
            mSession.start();
        }
    }

    function isActive() as Boolean { return mStats != null; }
    function isRunning() as Boolean { return mRunning; }
    function getStats() { return mStats; }

    // Appelé chaque seconde par la vue : chrono actif + échantillon FC.
    function tick() as Void {
        if (!mRunning) { return; }
        var now = System.getTimer();
        mElapsedMs += now - mLastTick;
        mLastTick = now;
        mStats.addSample(now, heartRate());
    }

    function elapsedSec() as Number {
        if (mRunning) {
            return (mElapsedMs + System.getTimer() - mLastTick) / 1000;
        }
        return mElapsedMs / 1000;
    }

    function pause() as Void {
        if (!mRunning) { return; }
        tick();
        mRunning = false;
        if (mSession != null && mSession.isRecording()) { mSession.stop(); }
    }

    function resume() as Void {
        if (mRunning || mStats == null) { return; }
        mRunning = true;
        mLastTick = System.getTimer();
        if (mSession != null && !mSession.isRecording()) { mSession.start(); }
    }

    // Un tour FIT par set (posé au « set suivant » et au nouveau match).
    // Irréversible : un undo ne retire pas le tour.
    function lap() as Void {
        if (mSession != null && mSession.isRecording()) { mSession.addLap(); }
    }

    function save() as Void {
        pause();
        if (mSession != null) {
            mSession.save();
            mSession = null;
        }
    }

    function discard() as Void {
        pause();
        if (mSession != null) {
            mSession.discard();
            mSession = null;
        }
        mStats = null;
    }

    // Fin de séance consultée (récap fermé) : on oublie les stats.
    function reset() as Void {
        mStats = null;
        mElapsedMs = 0;
        mRunning = false;
    }

    // Filet App.onStop : une séance en cours est enregistrée plutôt que
    // perdue (fermeture forcée de l'app).
    function saveIfActive() as Void {
        if (mSession != null) { save(); }
    }
}
