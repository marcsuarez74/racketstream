// Clubs multi-terrains (phase 10) — logique pure testable (Db injecté).
// Un club possède des terrains ; chaque terrain est un canal (ligne devices)
// avec sa propre clé, la seule qui envoie des points (sync inchangé). La clé
// club ne sert qu'à gérer le club. Création sur invitation à usage unique.
// Les clés sont générées ici, renvoyées UNE seule fois, et seul leur hash est
// stocké. Servi par le VPS uniquement (pas de câblage Supabase).
import { json } from "../sync/handler.ts";
import { newKey, sha256Hex } from "../_shared/keys.ts";

export interface Terrain { channel: string; label: string; position: number }

export interface ClubsDb {
  // Consomme l'invitation si elle est valide et libre, puis crée le club, de
  // façon atomique (slug pris → l'invitation reste libre).
  createClub(slug: string, name: string, keyHash: string, inviteHash: string): Promise<{ error: null | "invite" | "taken" | string }>;
  getClub(slug: string): Promise<{ id: number; name: string; terrains: Terrain[] } | null>;
  clubIdByKey(slug: string, keyHash: string): Promise<number | null>;
  // Canal <slug>-t<n> avec n libre ; position = dernière + 1.
  createTerrain(clubId: number, slug: string, label: string, keyHash: string): Promise<{ channel: string | null; error: string | null }>;
  // found = false si le terrain n'existe pas ou appartient à un autre club.
  updateTerrain(clubId: number, channel: string, f: { label?: string; position?: number }): Promise<{ found: boolean }>;
  setTerrainKey(clubId: number, channel: string, keyHash: string): Promise<{ found: boolean }>;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])$/;
const NAME_MAX = 48;
const LABEL_MAX = 24;
const POSITION_MAX = 99;
export const MAX_TERRAINS = 16;

// Les codes sont affichés groupés en majuscules (ABCD-EFGH-JKMN) : on accepte
// minuscules, espaces et tirets absents.
export function normalizeInvite(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= max ? t : null;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? b as Record<string, unknown> : null;
  } catch { return null; }
}

async function createClub(req: Request, db: ClubsDb): Promise<Response> {
  const b = await readBody(req);
  if (!b) return json(400, { error: "body" });
  const slug = typeof b.slug === "string" ? b.slug.trim() : "";
  if (!SLUG_RE.test(slug)) return json(400, { error: "slug" });
  const name = text(b.name, NAME_MAX);
  if (!name) return json(400, { error: "name" });
  const invite = typeof b.invite === "string" ? normalizeInvite(b.invite) : "";
  if (invite.length < 1 || invite.length > 64) return json(400, { error: "invite" });

  const clubKey = newKey();
  const r = await db.createClub(slug, name, await sha256Hex(clubKey), await sha256Hex(invite));
  if (r.error === "invite") return json(403, { error: "invite" });
  if (r.error === "taken") return json(409, { error: "slug" });
  if (r.error) return json(500, { error: "db" });
  return json(200, { slug, clubKey });
}

async function getClub(slug: string, db: ClubsDb): Promise<Response> {
  const c = await db.getClub(slug);
  if (!c) return json(404, { error: "club" });
  return json(200, { slug, name: c.name, terrains: c.terrains });
}

async function createTerrain(req: Request, clubId: number, slug: string, db: ClubsDb): Promise<Response> {
  const b = await readBody(req);
  if (!b) return json(400, { error: "body" });
  const label = text(b.label, LABEL_MAX);
  if (!label) return json(400, { error: "label" });
  const club = await db.getClub(slug);
  if (club && club.terrains.length >= MAX_TERRAINS) return json(409, { error: "limite" });
  const key = newKey();
  const r = await db.createTerrain(clubId, slug, label, await sha256Hex(key));
  if (r.error || !r.channel) return json(500, { error: "db" });
  return json(200, { channel: r.channel, label, key });
}

async function updateTerrain(req: Request, clubId: number, channel: string, db: ClubsDb): Promise<Response> {
  const b = await readBody(req);
  if (!b) return json(400, { error: "body" });
  const f: { label?: string; position?: number } = {};
  if (b.label !== undefined) {
    const label = text(b.label, LABEL_MAX);
    if (!label) return json(400, { error: "label" });
    f.label = label;
  }
  if (b.position !== undefined) {
    const p = b.position;
    if (typeof p !== "number" || !Number.isInteger(p) || p < 0 || p > POSITION_MAX) return json(400, { error: "position" });
    f.position = p;
  }
  if (f.label === undefined && f.position === undefined) return json(400, { error: "body" });
  const r = await db.updateTerrain(clubId, channel, f);
  return r.found ? json(200, { ok: true }) : json(404, { error: "terrain" });
}

async function renewKey(clubId: number, channel: string, db: ClubsDb): Promise<Response> {
  const key = newKey();
  const r = await db.setTerrainKey(clubId, channel, await sha256Hex(key));
  return r.found ? json(200, { channel, key }) : json(404, { error: "terrain" });
}

// Routes sous /api/clubs (GET /:slug/auth vérifie une clé club ; le flux SSE /api/clubs/:slug/stream est servi par
// server/main.ts, qui détient le hub).
export async function handleClubs(req: Request, db: ClubsDb): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/^\/api\/clubs\/?/, "");
  const seg = path === "" ? [] : path.split("/").map(decodeURIComponent);
  const m = req.method;

  if (seg.length === 0) return m === "POST" ? createClub(req, db) : json(405, { error: "method" });
  const slug = seg[0];
  if (seg.length === 1) return m === "GET" ? getClub(slug, db) : json(405, { error: "method" });
  // Vérification d'une clé club par le portail (« Club existant ») : ne modifie rien.
  if (seg.length === 2 && seg[1] === "auth") {
    if (m !== "GET") return json(405, { error: "method" });
    const k = req.headers.get("X-Club-Key");
    const c = k ? await db.getClub(slug) : null;
    if (!c || await db.clubIdByKey(slug, await sha256Hex(k!)) === null) return json(401, { error: "key" });
    return json(200, { slug, name: c.name });
  }
  if (seg[1] !== "terrains" || seg.length > 4 || (seg.length === 4 && seg[3] !== "key")) return json(404, { error: "route" });

  const wanted = seg.length === 2 ? "POST" : seg.length === 3 ? "PATCH" : "POST";
  if (m !== wanted) return json(405, { error: "method" });

  // Même réponse pour club inconnu et clé fausse : pas d'indice d'existence.
  const key = req.headers.get("X-Club-Key");
  if (!key) return json(401, { error: "key" });
  const clubId = await db.clubIdByKey(slug, await sha256Hex(key));
  if (clubId === null) return json(401, { error: "key" });

  if (seg.length === 2) return createTerrain(req, clubId, slug, db);
  if (seg.length === 3) return updateTerrain(req, clubId, seg[2], db);
  return renewKey(clubId, seg[2], db);
}
