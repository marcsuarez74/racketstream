// Edge Function sync — logique pure testable (Db injecté). Le backend ne
// calcule JAMAIS le score : il valide la forme, authentifie la device key et
// upsert de façon idempotente (ADR-007, spec sync §5/§11/§13).
// Bonus event-driven : après un upsert réussi, si un sender StreamElements
// est fourni, annonce le nouveau score dans le chat si le texte a changé
// (latence = délai de sync de la montre, ~5 s). L'échec de l'annonce
// n'échoue JAMAIS la sync.
import { maybeAnnounce, type Announcer, type AnnounceState } from "../_shared/announce.ts";
import type { PadelSnapshot } from "../score-text/handler.ts";

export interface Db {
  // Auth multi-device : le handler hash la clé du header et cherche la ligne
  // correspondante dans `devices`. Le canal (overlay/bot) appartient au device ;
  // `ownerId` (devices.id) identifie la clé, c'est lui qui possède les matchs.
  getDeviceHash(expected: string): Promise<{ ownerId: number | null; channel: string | null; error: string | null }>;
  // Propriétaire du match (devices.id de la clé qui l'a créé), null si nouveau.
  // Le deviceId du corps n'est pas une preuve : n'importe quelle clé valide
  // peut l'envoyer. Seule la clé fait foi.
  getMatchOwner(matchId: string): Promise<{ ownerId: number | null; error: string | null }>;
  upsertMatch(matchId: string, ownerId: number, deviceId: string, config: Record<string, unknown>, startedAt: number | null, status: string, channel: string): Promise<{ error: string | null }>;
  // Invariant « un seul match actif par clé » : à la création d'un match, on
  // clôture les précédents jamais terminés (sinon ils concurrencent le pick
  // « actif le plus récent » de l'overlay et du bot chat).
  finishOtherActiveMatches(ownerId: number, matchId: string): Promise<{ error: string | null }>;
  upsertEvents(matchId: string, events: Record<string, unknown>[]): Promise<{ error: string | null }>;
  upsertState(matchId: string, snapshot: Record<string, unknown>, config: Record<string, unknown>): Promise<{ error: string | null }>;
  // Optionnel : exécute fn dans une transaction (rollback si fn lève). Absent
  // = exécution directe (backend Supabase, Db de test).
  atomic?<T>(fn: () => Promise<T>): Promise<T>;
  // Annonce chat (StreamElements) : config du canal + dédoublonnage.
  getAnnounceCfg(channel: string): Promise<{ seChannelId: string | null; seJwt?: string | null; name1: string; name2: string } | null>;
  lastAnnounced(channel: string): Promise<string | null>;
  saveAnnounced(channel: string, text: string): Promise<void>;
}

// Erreur levée dans la transaction pour provoquer le rollback et porter la
// réponse HTTP.
class SyncAbort extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isInt(n: unknown, min: number, max: number): boolean {
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
}

// snapshot.padel (phase 9) : conservé seulement s'il est bien formé.
function toPadel(p: unknown): PadelSnapshot | null {
  if (typeof p !== "object" || p === null) return null;
  const k = p as Record<string, unknown>;
  if (!isInt(k.gamesMe, 0, 99) || !isInt(k.gamesOpp, 0, 99) || !isInt(k.tieBreak, 0, 2)) return null;
  return { gamesMe: k.gamesMe as number, gamesOpp: k.gamesOpp as number, tieBreak: k.tieBreak as number };
}

function isConfig(c: unknown): boolean {
  if (typeof c !== "object" || c === null) return false;
  const k = c as Record<string, unknown>;
  return isInt(k.targetScore, 1, 99) && isInt(k.winBy, 1, 20) &&
         isInt(k.cap, 0, 200) && isInt(k.setsToWin, 1, 5);
}

function isSnapshot(s: unknown): boolean {
  if (typeof s !== "object" || s === null) return false;
  const k = s as Record<string, unknown>;
  return (k.status === "active" || k.status === "set_result" || k.status === "match_finished") &&
         isInt(k.currentSet, 1, 9) && isInt(k.scoreMe, 0, 199) && isInt(k.scoreOpp, 0, 199) &&
         isInt(k.setsMe, 0, 9) && isInt(k.setsOpp, 0, 9) && isInt(k.lastSequence, 0, 100000);
}

function isEvent(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const k = e as Record<string, unknown>;
  return isInt(k.type, 0, 5) && isInt(k.arg, -1, 9999) && isInt(k.sequence, 1, 100000) &&
         typeof k.ts === "number" && isInt(k.prevMe, 0, 199) && isInt(k.prevOpp, 0, 199);
}

export type Validated =
  | { ok: true; deviceId: string; config: Record<string, unknown>; snapshot: Record<string, unknown>; events: Record<string, unknown>[]; startedAt: number | null; stop: boolean }
  | { ok: false; status: number; message: string };

function parseStartedAt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

export function validateBody(body: unknown): Validated {
  if (typeof body !== "object" || body === null) return { ok: false, status: 400, message: "body" };
  const b = body as Record<string, unknown>;
  if (typeof b.deviceId !== "string" || b.deviceId.length === 0 || b.deviceId.length > 64) {
    return { ok: false, status: 400, message: "deviceId" };
  }
  if (!isConfig(b.config)) return { ok: false, status: 400, message: "config" };
  if (!isSnapshot(b.snapshot)) return { ok: false, status: 400, message: "snapshot" };
  // 0 event : ouverture d'un nouveau match (0-0) ou arrêt (stop: true).
  if (!Array.isArray(b.events) || b.events.length > 10) {
    return { ok: false, status: 400, message: "events" };
  }
  for (const e of b.events) { if (!isEvent(e)) return { ok: false, status: 400, message: "event" }; };
  // Garmin makeWebRequest sérialise les Long > int32 en string (limite
  // documentée du runtime Monkey C) : startedAt (epoch ms) arrive souvent
  // en "1790000716000" → on accepte les deux formes.
  const startedAt = parseStartedAt(b.startedAt);
  return { ok: true, deviceId: b.deviceId, config: b.config as Record<string, unknown>, snapshot: b.snapshot as Record<string, unknown>, events: b.events as Record<string, unknown>[], startedAt, stop: b.stop === true };
}

export async function handleSync(req: Request, db: Db, sender?: Announcer): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const m = new URL(req.url).pathname.match(/\/matches\/([A-Za-z0-9_-]+)\/events$/);
  if (!m) return json(404, { error: "route" });
  const matchId = m[1];
  if (matchId.length < 4 || matchId.length > 32) return json(400, { error: "matchId" });
  const key = req.headers.get("X-Device-Key");
  if (!key) return json(401, { error: "key" });
  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: "json" }); }
  const v = validateBody(body);
  if (!v.ok) return json(v.status, { error: v.message });
  const expected = await sha256Hex(key);
  const dev = await db.getDeviceHash(expected);
  if (dev.error) return json(500, { error: dev.error });
  if (!dev.channel) return json(401, { error: "key" });
  if (dev.ownerId === null) return json(500, { error: "device" });
  const ownerId = dev.ownerId;
  const channel = dev.channel;
  const write = async () => {
    const owner = await db.getMatchOwner(matchId);
    if (owner.error) throw new SyncAbort(500, owner.error);
    if (owner.ownerId !== null && owner.ownerId !== ownerId) throw new SyncAbort(403, "owner");
    if (owner.ownerId === null) {
      const cl = await db.finishOtherActiveMatches(ownerId, matchId);
      if (cl.error) throw new SyncAbort(500, cl.error);
    }
    // archived : match arrêté sur la montre → l'overlay se vide aussitôt.
    const status = v.stop ? "archived" : v.snapshot.status === "match_finished" ? "finished" : "active";
    const up = await db.upsertMatch(matchId, ownerId, v.deviceId, v.config, v.startedAt, status, channel);
    if (up.error) throw new SyncAbort(500, up.error);
    if (v.events.length > 0) {
      const ev = await db.upsertEvents(matchId, v.events);
      if (ev.error) throw new SyncAbort(500, ev.error);
    }
    const st = await db.upsertState(matchId, v.snapshot, v.config);
    if (st.error) throw new SyncAbort(500, st.error);
  };
  try {
    await (db.atomic ? db.atomic(write) : write());
  } catch (e) {
    if (e instanceof SyncAbort) return json(e.status, { error: e.code });
    return json(500, { error: "db" });
  }
  if (sender && v.events.length > 0 && !v.stop) {
    // Annonce chat event-driven : jamais bloquante pour la sync.
    try {
      const cfg = await db.getAnnounceCfg(channel);
      const state: AnnounceState = { lastAnnounced: db.lastAnnounced, saveAnnounced: db.saveAnnounced };
      await maybeAnnounce(channel, cfg, {
        status: String(v.snapshot.status),
        currentSet: Number(v.snapshot.currentSet),
        scoreMe: Number(v.snapshot.scoreMe),
        scoreOpp: Number(v.snapshot.scoreOpp),
        setsMe: Number(v.snapshot.setsMe),
        setsOpp: Number(v.snapshot.setsOpp),
        config: null,
        padel: toPadel(v.snapshot.padel),
      }, state, sender);
    } catch { /* l'annonce ne doit jamais casser la sync */ }
  }
  // Sans event, rien à acquitter (la montre ignore l'absence d'ACK).
  if (v.events.length === 0) return json(200, { matchId });
  const last = Math.max(...v.events.map((e) => e.sequence as number));
  return json(200, { matchId, lastAcceptedSequence: last });
}
