import Toybox.Lang;

// Statistiques PURES de la séance (phase 9) : zones FC, FC moyenne/max,
// courbe FC compacte, sets et points des matchs déjà terminés dans la
// séance. Alimenté une fois par seconde (ActivityService) pendant que le
// chrono tourne. Temps = System.getTimer() (comme les ts du journal).
class SessionStats {
    const CAP = 96;          // seaux de la courbe FC (compactés par paires)

    var mZones;              // seuils [min Z1, max Z1, max Z2, max Z3, max Z4, max Z5]
    var mZoneSec;            // secondes passées dans chaque zone
    var mHrSum = 0;
    var mHrN = 0;
    var mHrMax = 0;
    var mT0;                 // début de séance (getTimer)
    var mStep = 5000;        // largeur d'un seau (ms), doublée à chaque compaction
    var mBucketSum;
    var mBucketN;
    var mPastRows;           // sets des matchs terminés : rallySetRows + [fcMoy]
    var mPastWon = 0;
    var mPastN = 0;
    var mPastBest = 0;
    var mMatches = 0;        // matchs terminés et archivés dans la séance

    function initialize(zones, t0 as Number) {
        mZones = validZones(zones) ? zones : [95, 114, 133, 152, 171, 190];
        mT0 = t0;
        mZoneSec = [0, 0, 0, 0, 0];
        mBucketSum = [];
        mBucketN = [];
        mPastRows = [];
    }

    // UserProfile peut renvoyer null ou des zones non renseignées (0).
    function validZones(z) as Boolean {
        if (z == null || !(z instanceof Array) || (z as Array).size() < 6) { return false; }
        for (var i = 1; i < 6; i += 1) {
            if (z[i] == null || z[i] <= z[i - 1]) { return false; }
        }
        return z[0] > 0;
    }

    // Zone 1..5 (sous le seuil de Z1 : zone 1, comme la maquette).
    function zoneOf(hr as Number) as Number {
        for (var i = 4; i >= 1; i -= 1) {
            if (hr >= mZones[i]) { return i + 1; }
        }
        return 1;
    }

    function getZones() as Array { return mZones; }

    // Un échantillon par seconde de chrono actif.
    function addSample(now as Number, hr) as Void {
        if (hr == null || hr <= 0) { return; }
        mZoneSec[zoneOf(hr) - 1] += 1;
        mHrSum += hr;
        mHrN += 1;
        if (hr > mHrMax) { mHrMax = hr; }
        var idx = (now - mT0) / mStep;
        if (idx < 0) { return; }
        while (idx >= CAP) {
            compact();
            idx = (now - mT0) / mStep;
        }
        while (mBucketSum.size() <= idx) {
            mBucketSum.add(0);
            mBucketN.add(0);
        }
        mBucketSum[idx] += hr;
        mBucketN[idx] += 1;
    }

    // Fusionne les seaux deux à deux : la courbe garde toute la séance avec
    // une mémoire bornée.
    function compact() as Void {
        var s = [];
        var n = [];
        for (var i = 0; i < mBucketSum.size(); i += 2) {
            var a = mBucketSum[i];
            var b = mBucketN[i];
            if (i + 1 < mBucketSum.size()) {
                a += mBucketSum[i + 1];
                b += mBucketN[i + 1];
            }
            s.add(a);
            n.add(b);
        }
        mBucketSum = s;
        mBucketN = n;
        mStep *= 2;
    }

    function hrAvg() as Number { return mHrN > 0 ? mHrSum / mHrN : 0; }
    function hrMax() as Number { return mHrMax; }
    function zoneSeconds() as Array { return mZoneSec; }
    function bucketCount() as Number { return mBucketSum.size(); }
    function bucketStep() as Number { return mStep; }
    function startTime() as Number { return mT0; }

    // FC moyenne du seau i (0 = pas de mesure).
    function bucketHr(i as Number) as Number {
        return mBucketN[i] > 0 ? mBucketSum[i] / mBucketN[i] : 0;
    }

    // FC moyenne entre deux instants (seaux chevauchant l'intervalle).
    function hrAvgBetween(t0 as Number, t1 as Number) as Number {
        var a = (t0 - mT0) / mStep;
        var b = (t1 - mT0) / mStep;
        if (a < 0) { a = 0; }
        var sum = 0;
        var n = 0;
        for (var i = a; i <= b && i < mBucketSum.size(); i += 1) {
            sum += mBucketSum[i];
            n += mBucketN[i];
        }
        return n > 0 ? sum / n : 0;
    }

    // Archive un match terminé avant d'en lancer un autre dans la séance.
    function archiveMatch(rows as Array, pts as Array) as Void {
        for (var i = 0; i < rows.size(); i += 1) {
            var r = rows[i] as Array;
            mPastRows.add([r[0], r[1], r[2], r[3], r[4], r[5], hrAvgBetween(r[3], r[4])]);
        }
        while (mPastRows.size() > 20) { mPastRows = mPastRows.slice(1, null); }
        mPastWon += pts[0];
        mPastN += pts[1];
        if (pts[3] > mPastBest) { mPastBest = pts[3]; }
        mMatches += 1;
    }

    // Sets de la séance (archivés + match courant), chacun avec sa FC moyenne.
    function allRows(current as Array) as Array {
        var out = mPastRows.slice(0, null);
        for (var i = 0; i < current.size(); i += 1) {
            var r = current[i] as Array;
            out.add([r[0], r[1], r[2], r[3], r[4], r[5], hrAvgBetween(r[3], r[4])]);
        }
        return out;
    }

    // Points de la séance : [gagnés, joués, meilleure série].
    function totalPoints(current as Array) as Array {
        var best = current[3] > mPastBest ? current[3] : mPastBest;
        return [mPastWon + current[0], mPastN + current[1], best];
    }

    function matchCount() as Number { return mMatches; }
}
