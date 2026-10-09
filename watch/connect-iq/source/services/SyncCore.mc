import Toybox.Lang;

// Cœur pur de la synchronisation (Phase 4a, spec sync §7/§13) — aucun import
// Communications/Timer : testable Run No Evil. Le format des events est le
// journal plat de la montre [type, arg, seq, ts, prevMe, prevOpp] (§7.2).
class SyncCore {

    // Batch d'events à envoyer : ≤ max events de séquence ≥ fromSeq, clampé à
    // la 1re séquence du journal (un event acquitté peut avoir été purgé —
    // §7.2 : jamais un event non acquitté ; les events fantômes après undo
    // sont assumés, décision D-3).
    function batchSlice(events as Array, fromSeq as Number, max as Number) as Array {
        if (events == null || events.size() == 0) { return []; }
        var start = 0;
        while (start < events.size()) {
            var seq = (events[start] as Array)[2];   // séquence = index 2 (§7.2)
            if (seq >= fromSeq) { break; }
            start += 1;
        }
        var stop = start + max;
        if (stop > events.size()) { stop = events.size(); }
        var batch = [];
        for (var i = start; i < stop; i += 1) { batch.add(events[i]); }
        return batch;
    }

    function serializeEvent(e as Array) as Dictionary {
        return { "type" => e[0], "arg" => e[1], "sequence" => e[2], "ts" => e[3], "prevMe" => e[4], "prevOpp" => e[5] };
    }

    // Payload complet du POST (spec sync §13). La montre (source de vérité)
    // fournit le snapshot : le backend ne recalcule jamais le score (ADR-007).
    // Phase 9 : config.sport (+ mode d'égalité au padel) et snapshot.padel
    // (jeux, tie-break, service, sets) — champs ignorés par les backends 0.2.x.
    function buildBody(engine, deviceId as String, batch as Array) as Dictionary {
        var cfg = engine.getConfig();
        var evts = [];
        for (var i = 0; i < batch.size(); i += 1) { evts.add(serializeEvent(batch[i])); }
        var config = { "targetScore" => cfg.mTargetScore, "winBy" => cfg.mWinBy, "cap" => cfg.mCap, "setsToWin" => cfg.mSetsToWin,
            "sport" => Sports.key(cfg.mSport) };
        var snapshot = {
            "status" => statusString(engine.getPhase()),
            "currentSet" => engine.getSetNumber(),
            "scoreMe" => engine.getScoreMe(),
            "scoreOpp" => engine.getScoreOpp(),
            "setsMe" => engine.getSetsMe(),
            "setsOpp" => engine.getSetsOpp(),
            "lastSequence" => engine.getLastSequence()
        };
        if (cfg.mSport == Sports.PADEL) {
            config["deuce"] = cfg.mDeuce;
            config["superTB"] = cfg.mSuperTB;
            var rows = engine.setRows(0);
            var sets = [];
            for (var j = 0; j < rows.size(); j += 1) {
                var r = rows[j] as Array;
                sets.add([r[0], r[1], r[5]]);
            }
            snapshot["padel"] = {
                "gamesMe" => engine.getGamesMe(),
                "gamesOpp" => engine.getGamesOpp(),
                "tieBreak" => engine.getTieBreak(),
                "server" => engine.getServer(),
                "sets" => sets
            };
        }
        return {
            "deviceId" => deviceId,
            "config" => config,
            "snapshot" => snapshot,
            "startedAt" => engine.getStartedAtMs(),
            "events" => evts
        };
    }

    // Phase moteur → statut match_state (check DB : active|set_result|match_finished).
    function statusString(phase as Number) as String {
        if (phase == ScorePhase.MATCH_FINISHED) { return "match_finished"; }
        if (phase == ScorePhase.SET_RESULT) { return "set_result"; }
        return "active";
    }

    // Backoff exponentiel 10 s → cap 2 min (§9.3 de la spec principale).
    function nextBackoffMs(errors as Number) as Long {
        var ms = 10000l;
        for (var i = 0; i < errors; i += 1) {
            ms = ms * 2;
            if (ms >= 120000l) { return 120000l; }
        }
        return ms;
    }

    // Conditions d'envoi : pas de requête en vol, backoff écoulé, ≥ 2 s entre
    // débuts de requêtes (débit BLE 400-800 o/s tient largement : un batch de
    // 5 points ≈ 200 o / 2 s ; §9.6 de la spec principale).
    function shouldSend(nowMs as Long, lastAttemptMs as Long, inFlight as Boolean, backoffUntilMs as Long) as Boolean {
        if (inFlight) { return false; }
        if (nowMs < backoffUntilMs) { return false; }
        if (lastAttemptMs != 0l && nowMs - lastAttemptMs < 2000l) { return false; }
        return true;
    }
}
