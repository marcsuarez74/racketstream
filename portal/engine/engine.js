// Moteur de score PUR (badminton, squash) : port JS de ScoreEngine.mc.
// Event-sourcing : l'état est le replay du journal ; les mutations poussent
// des événements puis rejouent. État = replay(base + journal) — la base porte
// l'effet des événements purgés. Toute règle modifiée ici doit l'être aussi
// côté Monkey C (et inversement).
import { isSetOver, ScoreEvent, ScorePhase } from "./rules.js";
import { rallySetRows } from "./stats.js";
import { sideAt } from "./sports.js";

const initialBase = () => [ScorePhase.PLAYING, 0, 0, 0, 0, 1, 0, 0];

export class ScoreEngine {
  // now : horloge des horodatages d'événements (ms), injectable pour les tests.
  // La montre utilise System.getTimer() ; ici Date.now(), même horloge que sentAt.
  constructor(config, matchId, now = Date.now) {
    this.now = now;
    this.newMatch(config, matchId);
  }

  // Nouveau match : nouvel id, nouvel espace de séquences.
  newMatch(config, matchId) {
    this.config = config;
    this.matchId = matchId;
    this.startedAtMs = Date.now();
    this.events = [];
    this.lastSequence = 0;
    this.base = initialBase();
    this.replay();
  }

  // ---- mutations ----

  pointMe() {
    if (this.phase !== ScorePhase.PLAYING) return;
    this.appendEvent(ScoreEvent.POINT_ME);
    this.checkAutoSetFinish(0);
  }

  pointOpponent() {
    if (this.phase !== ScorePhase.PLAYING) return;
    this.appendEvent(ScoreEvent.POINT_OPPONENT);
    this.checkAutoSetFinish(1);
  }

  // Transition « set suivant » : depuis SET_RESULT (fin auto, set déjà crédité)
  // ou depuis PLAYING (changement manuel confirmé — leader strict crédité).
  changeSet() {
    if (this.phase === ScorePhase.MATCH_FINISHED) return;
    let winner = -1;
    if (this.phase === ScorePhase.PLAYING) {
      if (this.scoreMe > this.scoreOpp) winner = 0;
      else if (this.scoreOpp > this.scoreMe) winner = 1;
    }
    this.appendEvent(ScoreEvent.SET_CHANGED, winner);
    if (this.phase === ScorePhase.MATCH_FINISHED) this.appendEvent(ScoreEvent.MATCH_FINISHED);
  }

  // Retire le dernier événement (quel qu'il soit) puis rejoue.
  // MATCH_FINISHED ne s'annule jamais ici (verrou) ; journal vide → sans effet.
  undo() {
    if (this.events.length === 0) return;
    if (this.events[this.events.length - 1][0] === ScoreEvent.MATCH_FINISHED) return;
    this.events = this.events.slice(0, -1);
    this.replay();
  }

  // « Annuler le dernier point » : retire d'abord les fins de set/match
  // automatiques puis le point (ou le « set suivant » / changement manuel) qui
  // les a provoquées. Lève le verrou MATCH_FINISHED de undo().
  undoPoint() {
    while (this.events.length > 0) {
      const t = this.events[this.events.length - 1][0];
      if (t !== ScoreEvent.MATCH_FINISHED && t !== ScoreEvent.SET_FINISHED) break;
      this.events = this.events.slice(0, -1);
    }
    if (this.events.length > 0) this.events = this.events.slice(0, -1);
    this.replay();
  }

  // Sets terminés (cf. stats.rallySetRows), t0 = début du match.
  setRows(t0) { return rallySetRows(this.events, t0); }

  // ---- journal + replay ----

  // Journal positionnel compact : [type, arg, seq, ts, prevMe, prevOpp].
  // prev = état dérivé AVANT l'event (append précède replay).
  appendEvent(type, arg = 0) {
    this.lastSequence += 1;
    this.events.push([type, arg, this.lastSequence, this.now(), this.scoreMe, this.scoreOpp]);
    this.replay();
  }

  replay() {
    this.copyBaseToDerived();
    for (const e of this.events) this.applyEvent(e);
  }

  copyBaseToDerived() {
    [this.phase, this.scoreMe, this.scoreOpp, this.setsMe, this.setsOpp,
      this.setNumber, this.lastSetScoreMe, this.lastSetScoreOpp] = this.base;
  }

  applyEvent(e) {
    const c = this.config;
    switch (e[0]) {
      case ScoreEvent.POINT_ME:
        this.scoreMe += 1;
        break;
      case ScoreEvent.POINT_OPPONENT:
        this.scoreOpp += 1;
        break;
      case ScoreEvent.SET_FINISHED:
        this.lastSetScoreMe = this.scoreMe;
        this.lastSetScoreOpp = this.scoreOpp;
        if (e[1] === 0) this.setsMe += 1; else this.setsOpp += 1;
        this.phase = this.setsMe >= c.setsToWin || this.setsOpp >= c.setsToWin
          ? ScorePhase.MATCH_FINISHED : ScorePhase.SET_RESULT;
        break;
      case ScoreEvent.SET_CHANGED:
        if (e[1] === 0) this.setsMe += 1;
        else if (e[1] === 1) this.setsOpp += 1;
        this.setNumber += 1;
        this.scoreMe = 0;
        this.scoreOpp = 0;
        this.phase = this.setsMe >= c.setsToWin || this.setsOpp >= c.setsToWin
          ? ScorePhase.MATCH_FINISHED : ScorePhase.PLAYING;
        break;
      case ScoreEvent.MATCH_FINISHED:
        this.phase = ScorePhase.MATCH_FINISHED;
        break;
    }
  }

  // Fin de set automatique après un point : pousse SET_FINISHED puis,
  // si le match est gagné, MATCH_FINISHED (verrou).
  checkAutoSetFinish(winner) {
    if (!isSetOver(this.config, this.scoreMe, this.scoreOpp)) return;
    this.appendEvent(ScoreEvent.SET_FINISHED, winner);
    if (this.phase === ScorePhase.MATCH_FINISHED) this.appendEvent(ScoreEvent.MATCH_FINISHED);
  }

  // ---- protocole ----

  eventId(i) { return this.matchId + ":" + this.events[i][2]; }

  // ---- restauration et purge (persistance locale) ----

  // Ordre base : [phase, scoreMe, scoreOpp, setsMe, setsOpp, setNumber, lastSetMe, lastSetOpp].
  // La séquence poursuit après restauration : le dernier event porte toujours lastSequence.
  restore(base, events) {
    this.base = base.slice();
    this.events = events.map((e) => e.slice());
    if (events.length > 0) this.lastSequence = events[events.length - 1][2];
    this.replay();
  }

  // Historique borné : au-delà de maxKeep, retire les plus anciens et avance
  // la base de leur effet. Jamais le dernier event.
  trimEvents(maxKeep) {
    const size = this.events.length;
    if (size <= maxKeep) return;
    if (maxKeep < 1) maxKeep = 1;
    const drop = size - maxKeep;
    this.copyBaseToDerived();
    for (let i = 0; i < drop; i++) this.applyEvent(this.events[i]);
    this.base = [this.phase, this.scoreMe, this.scoreOpp, this.setsMe, this.setsOpp,
      this.setNumber, this.lastSetScoreMe, this.lastSetScoreOpp];
    this.events = this.events.slice(drop);
    this.replay();
  }

  baseState() { return this.base.slice(); }

  // Filet D-2 : le compteur ne peut qu'augmenter (l'undo ne décrémente jamais).
  setLastSequence(seq) { if (seq > this.lastSequence) this.lastSequence = seq; }

  // Persistance (localStorage) : tout l'état nécessaire pour reprendre.
  toJSON() {
    return { config: this.config, matchId: this.matchId, startedAtMs: this.startedAtMs,
      base: this.base, events: this.events, lastSequence: this.lastSequence };
  }

  static fromJSON(o, now = Date.now) {
    const e = new ScoreEngine(o.config, o.matchId, now);
    e.startedAtMs = o.startedAtMs;
    e.restore(o.base, o.events);
    e.setLastSequence(o.lastSequence);
    return e;
  }
}

// Serveur au badminton/squash : gagnant du dernier échange, moi au départ
// et à chaque nouveau set (MatchView.server de la montre). 0 = moi, 1 = adversaire.
export function server(engine) {
  const ev = engine.events;
  for (let i = ev.length - 1; i >= 0; i--) {
    const t = ev[i][0];
    if (t === ScoreEvent.SET_CHANGED || t === ScoreEvent.POINT_ME) return 0;
    if (t === ScoreEvent.POINT_OPPONENT) return 1;
  }
  return 0;
}

// Annonce « changement de côté » après un point (MatchView de la montre) :
// set décisif, le leader vient d'atteindre sideAt(sport, format) en premier.
export function sideChange(engine, sport, format) {
  if (engine.phase !== ScorePhase.PLAYING) return false;
  const side = sideAt(sport, format);
  const last = engine.config.setsToWin - 1;
  const a = engine.scoreMe;
  const b = engine.scoreOpp;
  const hi = a > b ? a : b;
  const lo = a > b ? b : a;
  return side > 0 && engine.setsMe === last && engine.setsOpp === last && hi === side && lo < side;
}
