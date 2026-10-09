// Serveur HTTP du backend VPS (phase 8) : mêmes routes /functions/v1/* que
// Supabase (la montre et le portail ne changent que d'URL de base), plus
// /api/score et /api/stream (SSE) qui remplacent REST + Realtime pour
// l'overlay, le widget et le renderer. Écoute en local derrière Caddy.
import { openDb, type Store } from "./db.ts";
import { Hub } from "./hub.ts";
import { pickScore, sqliteAnnounceDb, sqliteNamesDb, sqliteRegisterDb, sqliteScoreDb, sqliteSyncDb } from "./stores.ts";
import { handleSync } from "../supabase/functions/sync/handler.ts";
import { handleScoreText } from "../supabase/functions/score-text/handler.ts";
import { handleChatAnnounce } from "../supabase/functions/chat-announce/handler.ts";
import { handleNamesGet, handleNamesPost } from "../supabase/functions/names/handler.ts";
import { handleRegisterPost } from "../supabase/functions/register/handler.ts";
import { type Announcer, makeSeSender } from "../supabase/functions/_shared/announce.ts";

export interface Options {
  sender?: Announcer;
  announceKey?: string;
  hub?: Hub;
  pingMs?: number;
}

const MAX_BODY = 64 * 1024;
const CHANNEL_RE = /^[A-Za-z0-9_-]{1,32}$/;
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "X-Device-Key, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function stream(store: Store, hub: Hub, channel: string, pingMs: number): Response {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (chunk: string) => ctrl.enqueue(enc.encode(chunk));
      const unsub = hub.subscribe(channel, send);
      if (!unsub) { ctrl.close(); return; }
      // État courant tout de suite : l'overlay n'attend pas le prochain point.
      send(`data: ${JSON.stringify(pickScore(store, channel))}\n\n`);
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
      const res = await handleSync(req, db, sender);
      if (res.status === 200 && channel) hub.publish(channel, pickScore(store, channel));
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
        return stream(store, hub, channel, pingMs);
      }
      return new Response(JSON.stringify(pickScore(store, channel)), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
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
  const stop = async () => { await server.shutdown(); store.close(); Deno.exit(0); };
  Deno.addSignalListener("SIGTERM", stop);
  Deno.addSignalListener("SIGINT", stop);
}
