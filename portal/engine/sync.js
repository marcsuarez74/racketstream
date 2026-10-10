// Cœur pur de la synchronisation : port JS de SyncCore.mc, MatchIds.mc et
// DeviceId.mc. Même contrat que la montre : POST
// {API}/functions/v1/sync/matches/<matchId>/events, en-tête X-Device-Key.
import { ScorePhase } from "./rules.js";
import { key } from "./sports.js";

// Le serveur refuse plus de 10 events par envoi (la montre en envoie 5).
export const MAX_BATCH = 10;

// Batch d'events à envoyer : ≤ max events de séquence ≥ fromSeq.
export function batchSlice(events, fromSeq, max = MAX_BATCH) {
  let start = 0;
  while (start < events.length && events[start][2] < fromSeq) start++;
  return events.slice(start, start + max);
}

export function serializeEvent(e) {
  return { type: e[0], arg: e[1], sequence: e[2], ts: e[3], prevMe: e[4], prevOpp: e[5] };
}

// Phase moteur → statut (active | set_result | match_finished).
export function statusString(phase) {
  if (phase === ScorePhase.MATCH_FINISHED) return "match_finished";
  if (phase === ScorePhase.SET_RESULT) return "set_result";
  return "active";
}

// Snapshot fourni par le scoreur (source de vérité : le serveur ne recalcule jamais).
export function snapshot(engine) {
  return {
    status: statusString(engine.phase),
    currentSet: engine.setNumber,
    scoreMe: engine.scoreMe,
    scoreOpp: engine.scoreOpp,
    setsMe: engine.setsMe,
    setsOpp: engine.setsOpp,
    lastSequence: engine.lastSequence,
  };
}

// Payload complet du POST. stop : le match passe en « archived », l'affichage se vide.
export function buildBody(engine, deviceId, batch, stop = false) {
  const c = engine.config;
  const body = {
    deviceId,
    config: { targetScore: c.targetScore, winBy: c.winBy, cap: c.cap, setsToWin: c.setsToWin, sport: key(c.sport) },
    snapshot: snapshot(engine),
    startedAt: engine.startedAtMs,
    events: batch.map(serializeEvent),
  };
  if (stop) body.stop = true;
  return body;
}

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   // Crockford base32, sans I/L/O/U

// matchId : 8 caractères Crockford base32 (40 bits), comme la montre.
export function newMatchId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (v) => ALPHABET[v & 0x1f]).join("");
}

export function isValidMatchId(id) {
  return typeof id === "string" && id.length === 8 && [...id].every((c) => ALPHABET.includes(c));
}

// deviceId : identifiant d'installation (64 bits en hexadécimal), à garder
// dans le localStorage du navigateur.
export function newDeviceId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (v) => v.toString(16).padStart(2, "0")).join("");
}
