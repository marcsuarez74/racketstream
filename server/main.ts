// Serveur HTTP du backend VPS (phase 8) : mêmes routes /functions/v1/* que
// Supabase (la montre et le portail ne changent que d'URL de base), plus
// /api/score et /api/stream (SSE) qui remplacent REST + Realtime pour
// l'overlay, le widget et le renderer. Écoute en local derrière Caddy.
// Phase 10 : /api/clubs… (clubs multi-terrains) et leur flux SSE par club.
import { openDb, type Store } from "./db.ts";
import { Hub } from "./hub.ts";
import { pickScore, sqliteAnnounceDb, sqliteClubsDb, sqliteNamesDb, sqliteRegisterDb, sqliteScoreDb, sqliteSyncDb } from "./stores.ts";
import { handleSync } from "../supabase/functions/sync/handler.ts";
import { handleScoreText } from "../supabase/functions/score-text/handler.ts";
import { handleChatAnnounce } from "../supabase/functions/chat-announce/handler.ts";
import { handleNamesGet, handleNamesPost } from "../supabase/functions/names/handler.ts";
import { handleRegisterPost } from "../supabase/functions/register/handler.ts";
import { handleClubs } from "../supabase/functions/clubs/handler.ts";
import { type Announcer, makeSeSender } from "../supabase/functions/_shared/announce.ts";

export interface Options {
  sender?: Announcer;
  announceKey?: string;
  hub?: Hub;
  pingMs?: number;
}

const MAX_BODY = 64 * 1024;
const CHANNEL_RE = /^[A-Za-z0-9_-]{1,32}$/;
const CLUB_STREAM_RE = /^\/api\/clubs\/([a-z0-9-]{2,20})\/stream$/;
const CLUB_GET_RE = /^\/api\/clubs\/([a-z0-9-]{2,20})$/;
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "X-Device-Key, X-Club-Key, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
}

function withCors(res: Response): Response {
  // Copie : certaines Response ont des en-têtes immuables.
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

// Relit le corps avec un plafond (Content-Length peut manquer ou mentir).
// null = trop gros.
async function boundedRequest(req: Request): Promise<Request | null> {
  if (req.method === "GET" || req.method === "HEAD" || !req.body) return req;
  const declared = Number(req.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { body.set(c, off); off += c.length; }
  return new Request(req.url, { method: req.method, headers: req.headers, body });
}

function channelParam(url: URL): string | null {
  const c = url.searchParams.get("channel");
  return c && CHANNEL_RE.test(c) ? c : null;
}

// Mesure de latence envoyée par la montre (≥ 0.3.1), horloge montre en ms :
// attente = sentAt - ts du dernier point du lot (créneau, file d'envoi) ;
// rtt = aller-retour de la sync précédente (Bluetooth + téléphone + réseau).
// Latence point → serveur ≈ attente + rtt / 2. Lisible via journalctl.
export function latencyLine(channel: string, body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const evs = Array.isArray(b.events) ? b.events as Record<string, unknown>[] : [];
  const last = evs[evs.length - 1];
  if (typeof b.sentAt !== "number" || !last || typeof last.ts !== "number") return null;
  const wait = Math.max(0, b.sentAt - last.ts);
  const rtt = typeof b.rtt === "number" ? b.rtt : null;
  const est = rtt === null ? "?" : `${Math.round(wait + rtt / 2)}ms`;
  return `[latence] canal=${channel} seq=${last.sequence} attente_montre=${wait}ms rtt=${rtt ?? "?"}ms estimé=${est}`;
}

// Flux SSE d'un sujet du hub : un canal (overlay) ou « club:<slug> » (page
// club). initial() = messages envoyés tout de suite, avant le prochain point.
function stream(hub: Hub, topic: string, initial: () => unknown[], pingMs: number): Response {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (chunk: string) => ctrl.enqueue(enc.encode(chunk));
      const unsub = hub.subscribe(topic, send);
      if (!unsub) { ctrl.close(); return; }
      for (const m of initial()) send(`data: ${JSON.stringify(m)}\n\n`);
      const ping = setInterval(() => { try { send(": ping\n\n"); } catch { cleanup(); } }, pingMs);
      cleanup = () => { clearInterval(ping); unsub(); };
    },
    // Appelé par Deno quand le client se déconnecte (request.signal n'est pas
    // fiable ici : en mode legacy il s'abat aussi sur les réponses réussies).
    cancel() { cleanup(); },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

export function makeHandler(store: Store, opts: Options = {}): (req: Request) => Promise<Response> {
  const hub = opts.hub ?? new Hub();
  const pingMs = opts.pingMs ?? 25_000;
  const sender = opts.sender;
  const scoreDb = sqliteScoreDb(store);
  const announceDb = sqliteAnnounceDb(store);
  const namesDb = sqliteNamesDb(store);
  const registerDb = sqliteRegisterDb(store);
  const syncBase = sqliteSyncDb(store);
  const clubsDb = sqliteClubsDb(store);
  const clubOf = store.sql.prepare("SELECT c.slug FROM devices d JOIN clubs c ON c.id = d.club_id WHERE d.channel = ?");

  async function route(raw: Request): Promise<Response> {
    const url = new URL(raw.url);
    const path = url.pathname;
    if (raw.method === "OPTIONS") return new Response(null, { status: 204 });

    const req = await boundedRequest(raw);
    if (!req) return text(413, "body");

    if (path.startsWith("/functions/v1/sync/")) {
      // On capte le canal résolu par la clé pour notifier ses abonnés SSE.
      let channel: string | null = null;
      const db = {
        ...syncBase,
        async getDeviceHash(h: string) {
          const r = await syncBase.getDeviceHash(h);
          channel = r.channel;
          return r;
        },
      };
      const body = await req.clone().json().catch(() => null);
      const res = await handleSync(req, db, sender);
      if (res.status === 200 && channel) {
        const score = pickScore(store, channel);
        hub.publish(channel, score);
        const club = clubOf.get(channel) as { slug: string } | undefined;
        if (club) hub.publish(`club:${club.slug}`, { channel, score });
        const lat = latencyLine(channel, body);
        if (lat) console.log(lat);
      }
      return res;
    }
    if (path === "/functions/v1/score-text") return handleScoreText(req, scoreDb);
    if (path === "/functions/v1/chat-announce") {
      if (!opts.announceKey || !sender) return text(503, "chat-announce désactivé");
      return handleChatAnnounce(req, announceDb, sender, { announceKey: opts.announceKey });
    }
    if (path === "/functions/v1/names") {
      if (req.method === "GET") return handleNamesGet(req, namesDb);
      if (req.method === "POST") return handleNamesPost(req, namesDb);
      return text(405, "method");
    }
    if (path === "/functions/v1/register") return handleRegisterPost(req, registerDb);

    if (path === "/api/score" || path === "/api/stream") {
      if (req.method !== "GET") return text(405, "method");
      const channel = channelParam(url);
      if (!channel) return text(400, "channel");
      if (path === "/api/stream") {
        if (hub.size >= hub.max) return text(503, "trop de connexions");
        return stream(hub, channel, () => [pickScore(store, channel)], pingMs);
      }
      return new Response(JSON.stringify(pickScore(store, channel)), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    if (path === "/api/clubs" || path.startsWith("/api/clubs/")) {
      const sm = path.match(CLUB_STREAM_RE);
      if (sm && req.method === "GET") {
        const club = await clubsDb.getClub(sm[1]);
        if (!club) return text(404, "club");
        if (hub.size >= hub.max) return text(503, "trop de connexions");
        // Un terrain créé après la connexion n'apparaît qu'à la reconnexion.
        return stream(hub, `club:${sm[1]}`, () => club.terrains.map((t) => ({ channel: t.channel, score: pickScore(store, t.channel) })), pingMs);
      }
      const res = await handleClubs(req, clubsDb);
      // Lecture publique enrichie du score de chaque terrain : la page club
      // n'a besoin que d'une requête.
      if (req.method === "GET" && res.status === 200 && CLUB_GET_RE.test(path)) {
        const c = await res.json() as { terrains: { channel: string }[] };
        for (const t of c.terrains) (t as Record<string, unknown>).score = pickScore(store, t.channel);
        return new Response(JSON.stringify(c), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
      return res;
    }
    if (path === "/healthz") {
      store.sql.prepare("SELECT 1").get();
      return text(200, "ok");
    }
    return text(404, "route");
  }

  return async (req) => {
    try {
      return withCors(await route(req));
    } catch (e) {
      console.error("[server]", e);
      return withCors(text(500, "erreur"));
    }
  };
}

if (import.meta.main) {
  const env = (k: string) => Deno.env.get(k) || undefined;
  const store = openDb(env("RS_DB") ?? "./racketstream.db");
  const handler = makeHandler(store, {
    sender: makeSeSender(),
    announceKey: env("CHAT_ANNOUNCE_KEY"),
  });
  const server = Deno.serve({
    hostname: env("RS_HOST") ?? "127.0.0.1",
    port: Number(env("RS_PORT") ?? 8790),
  }, handler);
  // shutdown() attend la fin des réponses en cours, or les flux SSE (renderer,
  // overlays) ne finissent jamais : sans plafond, systemd attendait 90 s
  // (API injoignable → sync 502 côté montre). On sort au bout de 2 s.
  const stop = async () => {
    setTimeout(() => { store.close(); Deno.exit(0); }, 2_000);
    await server.shutdown();
    store.close();
    Deno.exit(0);
  };
  Deno.addSignalListener("SIGTERM", stop);
  Deno.addSignalListener("SIGINT", stop);
}
