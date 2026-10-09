import Toybox.Lang;

// Catalogue des sports et de leurs formats (phase 9, maquette « activité
// Garmin »). Le sport fixe le sous-sport FIT, la liste des formats et le
// moteur de score (KIND_RALLY = ScoreEngine, KIND_PADEL = PadelEngine).
// Identifiants stables (persistés) : ne jamais renuméroter.
module Sports {
    const BADMINTON = 0;
    const PADEL = 1;
    const SQUASH = 2;
    const COUNT = 3;

    const KIND_RALLY = 0;
    const KIND_PADEL = 1;

    // Ordre d'affichage de la liste « ACTIVITÉ » (maquette).
    function order() as Array {
        return [BADMINTON, PADEL, SQUASH];
    }

    function name(s as Number) as String {
        if (s == PADEL) { return "Padel"; }
        if (s == SQUASH) { return "Squash"; }
        return "Badminton";
    }

    // Clé transmise au backend (colonne matches.sport).
    function key(s as Number) as String {
        if (s == PADEL) { return "padel"; }
        if (s == SQUASH) { return "squash"; }
        return "badminton";
    }

    function color(s as Number) as Number {
        if (s == PADEL) { return 0x4DABF7; }
        if (s == SQUASH) { return 0xF5C542; }
        return 0x3DD68C;
    }

    // Sous-sport FIT (Activity.SUB_SPORT_*, @since 4.1.6 — valeurs brutes
    // pour compiler en API 3.4).
    function subSport(s as Number) as Number {
        if (s == PADEL) { return 85; }
        if (s == SQUASH) { return 94; }
        return 95;
    }

    // « SET » au badminton et au padel, « JEU » au squash.
    function setWord(s as Number) as String {
        return (s == SQUASH) ? "JEU" : "SET";
    }

    function setsWord(s as Number) as String {
        return (s == SQUASH) ? "JEUX" : "SETS";
    }

    function kind(s as Number) as Number {
        return (s == PADEL) ? KIND_PADEL : KIND_RALLY;
    }

    function formatCount(s as Number) as Number {
        return (s == PADEL) ? 4 : 3;
    }

    // Index hors bornes → 0 (anti-corruption de la persistance).
    function clampFormat(s as Number, f) as Number {
        if (f == null || !(f instanceof Number) || f < 0 || f >= formatCount(s)) { return 0; }
        return f;
    }

    function formatLabel(s as Number, f as Number) as String {
        if (s == PADEL) {
            return ["Star Point", "Point en or", "Avantages", "Super tie-break"][f];
        }
        if (s == SQUASH) {
            return ["PAR 11 · 3 jeux", "PAR 11 · 2 jeux", "PAR 15 · 3 jeux"][f];
        }
        return ["3 × 21", "3 × 15", "Set unique 21"][f];
    }

    function formatDetail(s as Number, f as Number) as String {
        if (s == PADEL) {
            return ["2 sets gagnants · FIP 2026", "2 sets gagnants", "2 sets gagnants", "3e set = TB à 10"][f];
        }
        if (s == SQUASH) {
            return ["meilleur des 5 · écart 2", "meilleur des 3 · écart 2", "meilleur des 5 · écart 2"][f];
        }
        return ["2 sets gagnants · plafond 30", "BWF 2027 · plafond 21", "1 set · plafond 30"][f];
    }

    // Configuration du moteur. Padel : targetScore/winBy/cap ne servent pas au
    // moteur, ils portent le mode d'égalité pour le backend (cf. PadelConfig).
    function config(s as Number, f as Number) as MatchConfig {
        var c = rawConfig(s, f);
        c.mSport = s;
        return c;
    }

    function rawConfig(s as Number, f as Number) as MatchConfig {
        if (s == PADEL) {
            return PadelRules.config(f);
        }
        if (s == SQUASH) {
            if (f == 1) { return new MatchConfig(11, 2, 0, 2); }
            if (f == 2) { return new MatchConfig(15, 2, 0, 3); }
            return new MatchConfig(11, 2, 0, 3);
        }
        if (f == 1) { return new MatchConfig(15, 2, 21, 2); }
        if (f == 2) { return new MatchConfig(21, 2, 30, 1); }
        return new MatchConfig(21, 2, 30, 2);
    }

    // Changement de côté dans le set décisif (badminton : à 11, ou 8 en
    // 3 × 15). 0 = pas d'annonce.
    function sideAt(s as Number, f as Number) as Number {
        if (s != BADMINTON) { return 0; }
        return (f == 1) ? 8 : 11;
    }
}
