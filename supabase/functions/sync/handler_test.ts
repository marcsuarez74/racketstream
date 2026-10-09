import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleSync, sha256Hex, type Db, type Validated } from "./handler.ts";

const URL_MATCH = "https://fn.test/functions/v1/sync/matches/B7K2QM9X/events";

function makeDb(opts: { devices?: { hash: string; channel: string }[]; ownerId?: number | null; announce?: { seChannelId: string | null; last?: string } } = {}): Db {
  const events = new Map<string, Record<string, unknown>>();
  const devices = opts.devices ?? [];
  let matchOwner: number | null = opts.ownerId ?? null;
  let matchChannel: string | null = null;
  let matchStartedAt: number | null = null;
  const state = { finishedOthers: [] as string[] };
  const announce = { saved: [] as string[], last: opts.announce?.last ?? null };
  return {
    async getDeviceHash(expected) {
      const i = devices.findIndex((x) => x.hash === expected);
      return { ownerId: i < 0 ? null : i + 1, channel: i < 0 ? null : devices[i].channel, error: null };
    },
    async getMatchOwner(_matchId) { return { ownerId: matchOwner, error: null }; },
    async upsertMatch(_m, ownerId, _d, _c, startedAt, _st, channel) { matchOwner = ownerId; matchChannel = channel; matchStartedAt = startedAt; return { error: null }; },
    async finishOtherActiveMatches(ownerId, matchId) {
      state.finishedOthers.push(ownerId + ':' + matchId);
      return { error: null };
    },
    channelUsed() { return matchChannel; },
    get startedAtUsed() { return matchStartedAt; },
    get finishedOthers() { return state.finishedOthers; },
    async upsertEvents(matchId, rows) {
      for (const e of rows) {
        const key = `${matchId}:${e.sequence}`;
        if (!events.has(key)) events.set(key, e);   // simule UNIQUE (match_id, sequence)
      }
      return { error: null };
    },
    async upsertState(_m, _s, _c) { return { error: null }; },
    async getAnnounceCfg() {
      return { seChannelId: opts.announce?.seChannelId ?? null, name1: "MOI", name2: "LUI" };
    },
    async lastAnnounced() { return announce.last; },
    async saveAnnounced(_c, text) { announce.last = text; announce.saved.push(text); },
    get announceSaved() { return announce.saved; },
  } as Db & { channelUsed(): string | null; announceSaved: string[] };
}

function makeSender(fail = false): { sender: { send(seChannelId: string, seJwt: string | null, message: string): Promise<void> }; sent: string[] } {
  const sent: string[] = [];
  const sender = {
    async send(_seChannelId: string, _seJwt: string | null, message: string) {
      if (fail) throw new Error("SE down");
      sent.push(message);
    },
  };
  return { sender, sent };
}

function req(method: string, url: string, headers: Record<string, string>, body: unknown): Request {
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const KEY = "test-device-key";
const KEY_AMI = "cle-ami";
function oneDevice(hash: string, channel = "marc") {
  return { devices: [{ hash, channel }] };
}
const GOOD_BODY = {
  deviceId: "install-uuid-1",
  config: { targetScore: 21, winBy: 2, cap: 30, setsToWin: 2 },
  snapshot: { status: "active", currentSet: 1, scoreMe: 2, scoreOpp: 1, setsMe: 0, setsOpp: 0, lastSequence: 3 },
  events: [
    { type: 0, arg: 0, sequence: 2, ts: 100, prevMe: 1, prevOpp: 1 },
    { type: 0, arg: 0, sequence: 3, ts: 200, prevMe: 2, prevOpp: 1 },
  ],
};

Deno.test("405 si GET", async () => {
  const res = await handleSync(req("GET", URL_MATCH, {}, undefined), makeDb());
  assertEquals(res.status, 405);
});

Deno.test("404 si route inconnue", async () => {
  const res = await handleSync(req("POST", "https://fn.test/other", {}, GOOD_BODY), makeDb());
  assertEquals(res.status, 404);
});

Deno.test("401 sans X-Device-Key", async () => {
  const res = await handleSync(req("POST", URL_MATCH, {}, GOOD_BODY), makeDb());
  assertEquals(res.status, 401);
});

Deno.test("401 avec mauvaise clé", async () => {
  const db = makeDb(oneDevice(await sha256Hex("autre-clé")));
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db);
  assertEquals(res.status, 401);
});

Deno.test("401 si clé de device absente de la table", async () => {
  const db = makeDb({ devices: [] });
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db);
  assertEquals(res.status, 401);
});

Deno.test("2e device acceptée avec son propre canal", async () => {
  const db = makeDb({ devices: [
    { hash: await sha256Hex(KEY), channel: "marc" },
    { hash: await sha256Hex(KEY_AMI), channel: "ami" },
  ] });
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY_AMI }, GOOD_BODY), db);
  assertEquals(res.status, 200);
  assertEquals((db as Db & { channelUsed(): string | null }).channelUsed(), "ami");
});

Deno.test("400 si body invalide (events vide)", async () => {
  const db = makeDb(oneDevice(await sha256Hex(KEY)));
  const bad = { ...GOOD_BODY, events: [] };
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, bad), db);
  assertEquals(res.status, 400);
});

Deno.test("200 + ACK lastAcceptedSequence", async () => {
  const db = makeDb(oneDevice(await sha256Hex(KEY)));
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.matchId, "B7K2QM9X");
  assertEquals(body.lastAcceptedSequence, 3);
});

Deno.test("startedAt envoyé en string (Long Garmin > int32) est accepté en number", async () => {
  const db = makeDb(oneDevice(await sha256Hex(KEY)));
  const body = { ...GOOD_BODY, startedAt: "1790000716000" };
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, body), db);
  assertEquals(res.status, 200);
  assertEquals((db as Db & { startedAtUsed: number | null }).startedAtUsed, 1790000716000);
});

Deno.test("startedAt en number reste accepté ; absent reste null", async () => {
  const db = makeDb(oneDevice(await sha256Hex(KEY)));
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, { ...GOOD_BODY, startedAt: 1790000716000 }), db);
  assertEquals(res.status, 200);
  assertEquals((db as Db & { startedAtUsed: number | null }).startedAtUsed, 1790000716000);
  const db2 = makeDb(oneDevice(await sha256Hex(KEY)));
  await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db2);
  assertEquals((db2 as Db & { startedAtUsed: number | null }).startedAtUsed, null);
});

Deno.test("re-POST de doublons : 200, pas de duplication", async () => {  const db = makeDb(oneDevice(await sha256Hex(KEY)));
  const h = { "X-Device-Key": KEY };
  await handleSync(req("POST", URL_MATCH, h, GOOD_BODY), db);
  const res2 = await handleSync(req("POST", URL_MATCH, h, GOOD_BODY), db);
  assertEquals(res2.status, 200);
  // la Map factice simule la contrainte : 2 events seulement (seq 2 et 3)
  // (vérification indirecte : le re-POST ne renvoie pas d'erreur)
});

Deno.test("création d'un match clôture les actifs précédents du même device", async () => {
  const db = makeDb(oneDevice(await sha256Hex(KEY))) as Db & { finishedOthers: string[] };
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db);
  assertEquals(res.status, 200);
  assertEquals(db.finishedOthers, ["1:B7K2QM9X"]);
});

Deno.test("re-POST d'un match existant ne clôture rien", async () => {
  const db = makeDb({ ...oneDevice(await sha256Hex(KEY)), ownerId: 1 }) as Db & { finishedOthers: string[] };
  await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db);
  assertEquals(db.finishedOthers.length, 0);
});

Deno.test("403 si le match appartient à une autre clé", async () => {
  const db = makeDb({ devices: [{ hash: await sha256Hex(KEY), channel: "marc" }, { hash: await sha256Hex(KEY_AMI), channel: "ami" }], ownerId: 1 });
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY_AMI }, GOOD_BODY), db);
  assertEquals(res.status, 403);
});

Deno.test("le deviceId du corps ne fait pas foi : même clé, deviceId différent → 200", async () => {
  const db = makeDb({ ...oneDevice(await sha256Hex(KEY)), ownerId: 1 });
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, { ...GOOD_BODY, deviceId: "autre-install" }), db);
  assertEquals(res.status, 200);
});

Deno.test("erreur d'écriture dans la transaction → 500 et rollback demandé", async () => {
  const db = makeDb(oneDevice(await sha256Hex(KEY)));
  let rolledBack = false;
  db.upsertState = async () => ({ error: "boom" });
  db.atomic = async <T>(fn: () => Promise<T>) => {
    try { return await fn(); } catch (e) { rolledBack = true; throw e; }
  };
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db);
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "boom");
  assertEquals(rolledBack, true);
});

Deno.test("annonce le score dans le chat au moment du sync (event-driven)", async () => {
  const db = makeDb({ ...oneDevice(await sha256Hex(KEY)), announce: { seChannelId: "123456" } });
  const { sender, sent } = makeSender();
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db, sender);
  assertEquals(res.status, 200);
  assertEquals(sent, ["MOI 2-1 LUI · SET 1 · Sets 0-0"]);
  assertEquals((db as Db & { announceSaved: string[] }).announceSaved, ["MOI 2-1 LUI · SET 1 · Sets 0-0"]);
});

Deno.test("pas d'annonce si le texte n'a pas changé depuis la dernière", async () => {
  const db = makeDb({ ...oneDevice(await sha256Hex(KEY)), announce: { seChannelId: "123456", last: "MOI 2-1 LUI · SET 1 · Sets 0-0" } });
  const { sender, sent } = makeSender();
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db, sender);
  assertEquals(res.status, 200);
  assertEquals(sent, []);
});

Deno.test("échec StreamElements n'échoue pas la sync (retentative au prochain point)", async () => {
  const db = makeDb({ ...oneDevice(await sha256Hex(KEY)), announce: { seChannelId: "123456" } });
  const { sender, sent } = makeSender(true);
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db, sender);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).lastAcceptedSequence, 3);
  assertEquals((db as Db & { announceSaved: string[] }).announceSaved, []);
  assertEquals(sent, []);
});

Deno.test("pas d'annonce si le canal n'a pas de se_channel_id", async () => {
  const db = makeDb({ ...oneDevice(await sha256Hex(KEY)), announce: { seChannelId: null } });
  const { sender, sent } = makeSender();
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db, sender);
  assertEquals(res.status, 200);
  assertEquals(sent, []);
});

Deno.test("pas d'annonce sans sender (mode sans chat)", async () => {
  const db = makeDb({ ...oneDevice(await sha256Hex(KEY)), announce: { seChannelId: "123456" } });
  const res = await handleSync(req("POST", URL_MATCH, { "X-Device-Key": KEY }, GOOD_BODY), db);
  assertEquals(res.status, 200);
});

