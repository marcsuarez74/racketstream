// Règles du score : port JS de Rules.mc et ScoreEvent.mc (montre).
// Toute règle modifiée ici doit l'être aussi côté Monkey C (et inversement).

// Codes des événements du journal (tableaux positionnels).
// Format 6 slots [type, arg, seq, ts, prevMe, prevOpp] — voir ScoreEngine.appendEvent.
// Séquence monotone : jamais réutilisée après undo (décision D-2).
export const ScoreEvent = Object.freeze({
  POINT_ME: 0,
  POINT_OPPONENT: 1,
  SET_FINISHED: 2,    // [SET_FINISHED, winner] winner : 0 = moi, 1 = adversaire
  SET_CHANGED: 3,     // [SET_CHANGED, winner] winner : 0/1 crédité, -1 = déjà crédité ou égalité
  MATCH_FINISHED: 4,  // verrou terminal (ne s'annule pas avec undo())
  UNDO: 5,            // réservé au protocole sync — jamais journalisé
});

// Phases dérivées exposées par le moteur.
export const ScorePhase = Object.freeze({
  PLAYING: 0,         // set en cours, points comptables
  SET_RESULT: 1,      // set terminé (auto), en attente « set suivant »
  MATCH_FINISHED: 2,  // match terminé, verrouillé
});

// Le set est gagné dès que le leader a >= targetScore ET
// (écart >= winBy OU (cap > 0 ET leader >= cap)).
export function isSetOver(config, scoreMe, scoreOpp) {
  const high = scoreMe >= scoreOpp ? scoreMe : scoreOpp;
  const low = scoreMe >= scoreOpp ? scoreOpp : scoreMe;
  if (high < config.targetScore) return false;
  if (high - low >= config.winBy) return true;
  if (config.cap > 0 && high >= config.cap) return true;
  return false;
}
