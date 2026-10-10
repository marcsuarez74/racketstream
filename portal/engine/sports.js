// Catalogue des sports et formats : port JS de Sports.mc et MatchConfig.mc.
// Identifiants stables (partagés avec la montre) : ne jamais renuméroter.
// Le padel n'est pas porté (moteur à jeux, traité plus tard avec le tennis) :
// son identifiant est gardé pour rester aligné sur la montre.

// Paramétrage complet d'un match (aucun chiffre codé en dur ailleurs).
export function matchConfig(targetScore, winBy, cap, setsToWin, sport = 0) {
  return { targetScore, winBy, cap, setsToWin, sport };
}

// Presets historiques : index 0 = 11 pts (sans plafond), 1 = 15 pts (cap 21), 2 = 21 pts (cap 30).
export const MatchPresets = {
  count: () => 3,
  get(index) {
    if (index === 0) return matchConfig(11, 2, 0, 2);
    if (index === 1) return matchConfig(15, 2, 21, 2);
    return matchConfig(21, 2, 30, 2);
  },
};

export const BADMINTON = 0;
export const PADEL = 1;
export const SQUASH = 2;

// Sports proposés par le scoreur web, dans l'ordre d'affichage.
export const WEB_SPORTS = [BADMINTON, SQUASH];

export function name(s) {
  if (s === PADEL) return "Padel";
  if (s === SQUASH) return "Squash";
  return "Badminton";
}

// Clé transmise au backend (colonne matches.sport).
export function key(s) {
  if (s === PADEL) return "padel";
  if (s === SQUASH) return "squash";
  return "badminton";
}

// « SET » au badminton, « JEU » au squash.
export const setWord = (s) => (s === SQUASH ? "JEU" : "SET");
export const setsWord = (s) => (s === SQUASH ? "JEUX" : "SETS");

export const formatCount = (s) => (s === PADEL ? 4 : 3);

// Index hors bornes → 0 (anti-corruption de la persistance).
export function clampFormat(s, f) {
  return Number.isInteger(f) && f >= 0 && f < formatCount(s) ? f : 0;
}

export function formatLabel(s, f) {
  if (s === SQUASH) return ["PAR 11 · 3 jeux", "PAR 11 · 2 jeux", "PAR 15 · 3 jeux"][f];
  return ["3 × 21", "3 × 15", "Set unique 21"][f];
}

export function formatDetail(s, f) {
  if (s === SQUASH) return ["meilleur des 5 · écart 2", "meilleur des 3 · écart 2", "meilleur des 5 · écart 2"][f];
  return ["2 sets gagnants · plafond 30", "BWF 2027 · plafond 21", "1 set · plafond 30"][f];
}

// Configuration du moteur pour un sport et un format.
export function config(s, f) {
  if (s === PADEL) throw new Error("padel non pris en charge par le moteur web");
  let c;
  if (s === SQUASH) {
    if (f === 1) c = matchConfig(11, 2, 0, 2);
    else if (f === 2) c = matchConfig(15, 2, 0, 3);
    else c = matchConfig(11, 2, 0, 3);
  } else if (f === 1) c = matchConfig(15, 2, 21, 2);
  else if (f === 2) c = matchConfig(21, 2, 30, 1);
  else c = matchConfig(21, 2, 30, 2);
  c.sport = s;
  return c;
}

// Changement de côté dans le set décisif (badminton : à 11, ou 8 en 3 × 15).
// 0 = pas d'annonce.
export function sideAt(s, f) {
  if (s !== BADMINTON) return 0;
  return f === 1 ? 8 : 11;
}
