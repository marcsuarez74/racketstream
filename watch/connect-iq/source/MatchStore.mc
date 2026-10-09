import Toybox.Application.Storage;
import Toybox.Lang;

// Persistance du match (spec §7.2, Phase 3). Application.Storage : 8 Ko/valeur,
// 128 Ko au total — découpage en meta + lots plats de 30 events (6 Numbers par
// event, jamais d'imbrication). Écriture à chaque mutation (setValue synchrone).
module MatchStore {
    const META_KEY = "badminton_meta_v1";
    const EVT_PREFIX = "badminton_events_v1.";
    const PREFS_KEY = "badminton_prefs_v1";
    const CHUNK = 30;         // events par lot (~1,5 Ko < 8 Ko)
    const KEEP = 175;         // events conservés après purge (§7.2 : borné 200, purge par lots)

    // ---- préférences (§5 : sport et format mémorisés, un format par sport) ----

    const PREFS2_KEY = "racket_prefs_v2";   // [sport, format badminton, padel, squash]

    function loadPrefs() as Array {
        var v = Storage.getValue(PREFS2_KEY);
        if (v instanceof Array && (v as Array).size() == 1 + Sports.COUNT) {
            var p = v as Array;
            var sp = p[0];
            if (!(sp instanceof Number) || sp < 0 || sp >= Sports.COUNT) { sp = Sports.BADMINTON; }
            var out = [sp];
            for (var i = 0; i < Sports.COUNT; i += 1) { out.add(Sports.clampFormat(i, p[1 + i])); }
            return out;
        }
        // Migration 0.2.x : ancien preset badminton (0 = 11 pts, 1 = 15, 2 = 21).
        var old = Storage.getValue(PREFS_KEY);
        return [Sports.BADMINTON, (old == 1) ? 1 : 0, 0, 0];
    }

    function savePrefs(prefs as Array) as Void {
        Storage.setValue(PREFS2_KEY, prefs);
    }

    // ---- match ----

    // Sauvegarde synchrone : purge éventuelle, lots d'events, meta. Le
    // moteur est un ScoreEngine ou un PadelEngine (même contrat). t0 =
    // getTimer du lancement du match (durées des sets).
    function saveMatch(engine, sport as Number, format as Number, t0 as Number) as Void {
        engine.trimEvents(KEEP);           // no-op si journal ≤ KEEP (§7.2)
        var events = engine.getEvents();
        var chunk = 0;
        var i = 0;
        while (i < events.size()) {
            var flat = [];
            var stop = i + CHUNK;
            if (stop > events.size()) { stop = events.size(); }
            for (var j = i; j < stop; j += 1) {
                var ev = events[j];
                for (var k = 0; k < 6; k += 1) {
                    flat.add(ev[k]);
                }
            }
            Storage.setValue(EVT_PREFIX + chunk, flat);
            chunk += 1;
            i = stop;
        }
        // supprime les lots orphelins (journal rétréci / nouveau match)
        while (Storage.getValue(EVT_PREFIX + chunk) != null) {
            Storage.deleteValue(EVT_PREFIX + chunk);
            chunk += 1;
        }
        // pendingFrom préservé si c'est toujours le même match (sinon 1) —
        // les ACK ne doivent pas être perdus à chaque save (§7 sync).
        var prevMeta = Storage.getValue(META_KEY) as Dictionary;
        var pf = 1;
        if (prevMeta != null && prevMeta["mid"] != null && prevMeta["pf"] != null
                && prevMeta["mid"].toString().equals(engine.getMatchId())) {
            pf = prevMeta["pf"];
        }
        var cfg = engine.getConfig();
        var meta = {
            "v" => 2,
            "mid" => engine.getMatchId(),
            "sp" => sport,
            "fi" => format,
            "cfg" => [cfg.mTargetScore, cfg.mWinBy, cfg.mCap, cfg.mSetsToWin, cfg.mDeuce, cfg.mSuperTB ? 1 : 0],
            "t0" => t0,
            "pf" => pf,                    // pendingFrom : 1re séquence non acquittée (§7 sync)
            "ls" => engine.getLastSequence(),
            "ts" => engine.getStartedAtMs(),
            "base" => engine.getBaseState()
        };
        Storage.setValue(META_KEY, meta);
    }

    // Retourne null si aucun match persisté, sinon
    // { "mid", "sp", "fi", "cfg" (MatchConfig), "t0", "ls", "ts", "base",
    // "events" } — events = Array de 6-slots. Meta v1 (0.2.x, badminton
    // seul, "pi" = preset 11/15/21) migrée à la lecture.
    function loadMatch() as Dictionary or Null {
        var meta = Storage.getValue(META_KEY) as Dictionary;
        if (meta == null) { return null; }
        var events = [];
        var chunk = 0;
        while (true) {
            var flat = Storage.getValue(EVT_PREFIX + chunk);
            if (flat == null) { break; }
            // queue non multiple de 6 = donnée corrompue → ignorée (mieux vaut
            // tronquer que propager ; non productible via l'API publique)
            for (var i = 0; i + 5 < flat.size(); i += 6) {
                events.add([flat[i], flat[i + 1], flat[i + 2], flat[i + 3], flat[i + 4], flat[i + 5]]);
            }
            chunk += 1;
        }
        var sp = meta["sp"];
        var fi = meta["fi"];
        var config = null;
        var c = meta["cfg"];
        if (sp instanceof Number && sp >= 0 && sp < Sports.COUNT && c instanceof Array && (c as Array).size() == 6) {
            config = new MatchConfig(c[0], c[1], c[2], c[3]);
            config.mDeuce = c[4];
            config.mSuperTB = (c[5] == 1);
            config.mSport = sp;
            fi = Sports.clampFormat(sp, fi);
        } else {
            var pi = meta["pi"];
            if (!(pi instanceof Number) || pi < 0 || pi > 2) { pi = 2; }   // clamp anti-corruption (M-1)
            sp = Sports.BADMINTON;
            config = MatchPresets.get(pi);
            fi = (pi == 1) ? 1 : 0;        // 21 → 3 × 21, 15 → 3 × 15 ; 11 garde sa config
        }
        return {
            "mid" => meta["mid"],
            "sp" => sp,
            "fi" => fi,
            "cfg" => config,
            "t0" => meta["t0"],
            "ls" => meta["ls"],
            "ts" => meta["ts"],
            "base" => meta["base"],
            "events" => events
        };
    }

    function clearMatch() as Void {
        Storage.deleteValue(META_KEY);
        var chunk = 0;
        while (Storage.getValue(EVT_PREFIX + chunk) != null) {
            Storage.deleteValue(EVT_PREFIX + chunk);
            chunk += 1;
        }
    }

    // ---- sync (Phase 4a) : pointeur d'acquittement ----

    // Première séquence non acquittée (meta["pf"]). 1 par défaut.
    function getPendingFrom() as Number {
        var meta = Storage.getValue(META_KEY) as Dictionary;
        if (meta == null || meta["pf"] == null) { return 1; }
        return meta["pf"];
    }

    // ACK backend : les events de séquence ≤ seq sont acquittés (spec sync §7).
    // Sans effet si la meta a disparu (match purgé) ou si seq recule.
    function ackUntil(seq as Number) as Void {
        var meta = Storage.getValue(META_KEY) as Dictionary;
        if (meta != null) {
            var pf = meta["pf"];
            if (pf != null && seq >= pf) {
                meta["pf"] = seq + 1;      // pf = 1re séquence non acquittée
                Storage.setValue(META_KEY, meta);
            }
        }
    }
}
