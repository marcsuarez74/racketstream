// Tests bout en bout du serveur : vrai Deno.serve sur port éphémère, base :memory:.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { latencyLine, makeHandler } from "./main.ts";
import { Hub } from "./hub.ts";
import { KEY, seeded, syncReq } from "./test_util.ts";
import { sha256Hex } from "../supabase/functions/sync/handler.ts";
import type { Store } from "./db.ts";

async function withServer(fn: (base: string, hub: Hub, store: Store) => Promise<void>) {
  const store = await seeded();
  const hub = new Hub(2);
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, makeHandler(store, { hub }));
  const base = `http://127.0.0.1:${server.addr.port}`;
  try { await fn(base, hub, store); } finally { await server.shutdown(); store.close(); }
}

// Lit les messages « data: » successifs d'un flux SSE.
function sseReader(res: Response) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  return {
    async next(): Promise<unknown> {
      for (;;) {
        const m = buf.match(/^data: (.*)\n\n/m);
        if (m) { buf = buf.slice(buf.indexOf(m[0]) + m[0].length); return JSON.parse(m[1]); }
        const { value, done } = await reader.read();
        if (done) throw new Error("flux fermé");
        buf += value;
      }
    },
    cancel: () => reader.cancel(),
  };
}

// Rejoue une Request de test_util contre le vrai serveur.
function send(base: string, r: Request): Promise<Response> {
  const u = new URL(r.url);
  return fetch(base + u.pathname + u.search, { method: r.method, headers: r.headers, body: r.body });
}

Deno.test("serveur : sync puis /api/score reflète le score", () => withServer(async (base) => {
  const res = await send(base, syncReq("M0000001", KEY, 1, [3, 1]));
  assertEquals(res.status, 200);
  await res.body?.cancel();
  const score = await (await fetch(`${base}/api/score?channel=marc`)).json();
  assertEquals([score.match_id, score.score_me, score.score_opp], ["M0000001", 3, 1]);
  assertEquals(await (await fetch(`${base}/api/score?channel=ami`)).json(), null);
}));

Deno.test("serveur : /api/stream pousse l'état initial puis le sync en < 1 s", () => withServer(async (base, hub) => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream?channel=marc`, { signal: ctrl.signal });
  assertEquals(res.headers.get("content-type"), "text/event-stream");
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const nextData = async () => {
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("flux fermé");
      buf += value;
      const m = buf.match(/^data: (.*)$/m);
      if (m) return JSON.parse(m[1]);
    }
  };
  assertEquals(await nextData(), null);
  const t0 = performance.now();
  const s = await send(base, syncReq("M0000002", KEY, 1, [7, 5]));
  await s.body?.cancel();
  const ev = await nextData();
  assert(performance.now() - t0 < 1000);
  assertEquals([ev.score_me, ev.score_opp], [7, 5]);
  assertEquals(hub.size, 1);
  await reader.cancel();
  ctrl.abort();
  // Le désabonnement suit la fermeture côté client.
  for (let i = 0; i < 50 && hub.size > 0; i++) await new Promise((r) => setTimeout(r, 10));
  assertEquals(hub.size, 0);
}));

Deno.test("serveur : plafond SSE → 503, canal invalide → 400", () => withServer(async (base) => {
  const ctrls = [new AbortController(), new AbortController()];
  const open = await Promise.all(ctrls.map((c) => fetch(`${base}/api/stream?channel=marc`, { signal: c.signal })));
  const full = await fetch(`${base}/api/stream?channel=marc`);
  assertEquals(full.status, 503);
  await full.body?.cancel();
  for (const r of open) await r.body?.cancel();
  for (const c of ctrls) c.abort();
  const bad = await fetch(`${base}/api/score?channel=../etc`);
  assertEquals(bad.status, 400);
  await bad.body?.cancel();
}));

Deno.test("serveur : preflight OPTIONS 204 avec en-têtes CORS", () => withServer(async (base) => {
  const res = await fetch(`${base}/functions/v1/names`, { method: "OPTIONS" });
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  assertEquals(res.headers.get("access-control-allow-headers"), "X-Device-Key, X-Club-Key, Content-Type");
  assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, OPTIONS");
  await res.body?.cancel();
}));

Deno.test("serveur : corps de 100 Ko → 413", () => withServer(async (base) => {
  const res = await fetch(`${base}/functions/v1/register`, { method: "POST", body: "x".repeat(100 * 1024) });
  assertEquals(res.status, 413);
  await res.body?.cancel();
}));

Deno.test("serveur : chat-announce sans clé configurée → 503, healthz ok", () => withServer(async (base) => {
  const a = await fetch(`${base}/functions/v1/chat-announce`);
  assertEquals(a.status, 503);
  await a.body?.cancel();
  const h = await fetch(`${base}/healthz`);
  assertEquals([h.status, await h.text()], [200, "ok"]);
}));

Deno.test("latencyLine : attente montre + demi aller-retour", () => {
  const body = { sentAt: 10_400, rtt: 1_800, events: [{ sequence: 4, ts: 9_000 }, { sequence: 5, ts: 10_000 }] };
  assertEquals(latencyLine("marc", body), "[latence] canal=marc seq=5 attente_montre=400ms rtt=1800ms estimé=1300ms");
  assertEquals(latencyLine("marc", { sentAt: 10_000, events: [{ sequence: 1, ts: 10_000 }] }),
    "[latence] canal=marc seq=1 attente_montre=0ms rtt=?ms estimé=?");
});

Deno.test("latencyLine : montre sans mesure (≤ 0.3.0) → pas de ligne", () => {
  assertEquals(latencyLine("marc", { events: [{ sequence: 1, ts: 5 }] }), null);
  assertEquals(latencyLine("marc", null), null);
});

// Club « bcparis » créé par l'API avec un terrain ; renvoie la clé du terrain.
async function clubWithTerrain(base: string, store: Store): Promise<{ clubKey: string; terrainKey: string }> {
  store.sql.prepare("INSERT INTO club_invites (code_hash) VALUES (?)").run(await sha256Hex("abcd"));
  const c = await fetch(`${base}/api/clubs`, { method: "POST", body: JSON.stringify({ slug: "bcparis", name: "BC Paris", invite: "ABCD" }) });
  assertEquals(c.status, 200);
  const { clubKey } = await c.json();
  const t = await fetch(`${base}/api/clubs/bcparis/terrains`, {
    method: "POST", headers: { "X-Club-Key": clubKey }, body: JSON.stringify({ label: "Terrain 1" }),
  });
  assertEquals(t.status, 200);
  const { key } = await t.json();
  return { clubKey, terrainKey: key };
}

Deno.test("serveur : club → terrain → sync avec la clé du terrain → score visible", () => withServer(async (base, _hub, store) => {
  const { clubKey, terrainKey } = await clubWithTerrain(base, store);
  const s = await send(base, syncReq("TERRAIN1", terrainKey, 1, [4, 2]));
  assertEquals(s.status, 200);
  await s.body?.cancel();
  const score = await (await fetch(`${base}/api/score?channel=bcparis-t1`)).json();
  assertEquals([score.score_me, score.score_opp], [4, 2]);
  const club = await (await fetch(`${base}/api/clubs/bcparis`)).json();
  assertEquals(club.name, "BC Paris");
  assertEquals(club.terrains.length, 1);
  assertEquals([club.terrains[0].channel, club.terrains[0].label], ["bcparis-t1", "Terrain 1"]);
  assertEquals([club.terrains[0].score.score_me, club.terrains[0].score.score_opp], [4, 2]);
  // La clé club n'envoie pas de points.
  const refused = await send(base, syncReq("TERRAIN2", clubKey, 1, [1, 0]));
  assertEquals(refused.status, 401);
  await refused.body?.cancel();
  const unknown = await fetch(`${base}/api/clubs/inconnu`);
  assertEquals(unknown.status, 404);
  await unknown.body?.cancel();
}));

Deno.test("serveur : flux SSE du club → état initial des terrains puis le point en < 1 s", () => withServer(async (base, hub, store) => {
  const { terrainKey } = await clubWithTerrain(base, store);
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/clubs/bcparis/stream`, { signal: ctrl.signal });
  assertEquals(res.headers.get("content-type"), "text/event-stream");
  const sse = sseReader(res);
  assertEquals(await sse.next(), { channel: "bcparis-t1", score: null });
  const t0 = performance.now();
  const s = await send(base, syncReq("TERRAIN1", terrainKey, 1, [9, 8]));
  await s.body?.cancel();
  const ev = await sse.next() as { channel: string; score: { score_me: number; score_opp: number } };
  assert(performance.now() - t0 < 1000);
  assertEquals([ev.channel, ev.score.score_me, ev.score.score_opp], ["bcparis-t1", 9, 8]);
  // Un canal perso ne publie rien sur le flux du club.
  const p = await send(base, syncReq("M0000009", KEY, 1, [1, 1]));
  await p.body?.cancel();
  assertEquals(hub.size, 1);
  await sse.cancel();
  ctrl.abort();
  for (let i = 0; i < 50 && hub.size > 0; i++) await new Promise((r) => setTimeout(r, 10));
  assertEquals(hub.size, 0);
  const missing = await fetch(`${base}/api/clubs/inconnu/stream`);
  assertEquals(missing.status, 404);
  await missing.body?.cancel();
}));
