import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type ClubsDb, handleClubs, normalizeInvite, type Terrain } from "./handler.ts";
import { sha256Hex } from "../_shared/keys.ts";

interface MemClub { id: number; slug: string; name: string; keyHash: string; terrains: (Terrain & { keyHash: string })[] }

// Db en mémoire : mêmes règles que sqliteClubsDb (invitation à usage unique,
// slug unique, canal <slug>-t<n> libre).
function makeDb(invites: string[] = []) {
  const clubs: MemClub[] = [];
  const used = new Set<string>();
  const inviteHashes = new Set<string>();
  const ready = Promise.all(invites.map(async (c) => inviteHashes.add(await sha256Hex(normalizeInvite(c)))));
  const db: ClubsDb & { clubs: MemClub[] } = {
    clubs,
    async createClub(slug, name, keyHash, inviteHash) {
      await ready;
      if (!inviteHashes.has(inviteHash) || used.has(inviteHash)) return { error: "invite" };
      if (clubs.some((c) => c.slug === slug)) return { error: "taken" };
      used.add(inviteHash);
      clubs.push({ id: clubs.length + 1, slug, name, keyHash, terrains: [] });
      return { error: null };
    },
    async getClub(slug) {
      const c = clubs.find((x) => x.slug === slug);
      if (!c) return null;
      const terrains = c.terrains.map(({ channel, label, position }) => ({ channel, label, position }))
        .sort((a, b) => a.position - b.position);
      return { id: c.id, name: c.name, terrains };
    },
    async clubIdByKey(slug, keyHash) {
      return clubs.find((x) => x.slug === slug && x.keyHash === keyHash)?.id ?? null;
    },
    async createTerrain(clubId, slug, label, keyHash) {
      const c = clubs.find((x) => x.id === clubId)!;
      const channel = `${slug}-t${c.terrains.length + 1}`;
      c.terrains.push({ channel, label, position: c.terrains.length + 1, keyHash });
      return { channel, error: null };
    },
    async updateTerrain(clubId, channel, f) {
      const t = clubs.find((x) => x.id === clubId)?.terrains.find((x) => x.channel === channel);
      if (!t) return { found: false };
      if (f.label !== undefined) t.label = f.label;
      if (f.position !== undefined) t.position = f.position;
      return { found: true };
    },
    async setTerrainKey(clubId, channel, keyHash) {
      const t = clubs.find((x) => x.id === clubId)?.terrains.find((x) => x.channel === channel);
      if (!t) return { found: false };
      t.keyHash = keyHash;
      return { found: true };
    },
  };
  return db;
}

const BASE = "https://api.test/api/clubs";

function call(db: ClubsDb, method: string, path: string, body?: unknown, clubKey?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (clubKey) headers["X-Club-Key"] = clubKey;
  return handleClubs(new Request(BASE + path, {
    method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  }), db);
}

// Club « bcparis » créé avec l'invitation ABCD-EFGH-JKMN ; renvoie sa clé.
async function withClub(invites = ["ABCD-EFGH-JKMN"]) {
  const db = makeDb(invites);
  const res = await call(db, "POST", "", { slug: "bcparis", name: "BC Paris 15", invite: invites[0] });
  assertEquals(res.status, 200);
  const { clubKey } = await res.json();
  return { db, clubKey: clubKey as string };
}

Deno.test("création : 200, clé club renvoyée une fois, seul son hash est stocké", async () => {
  const { db, clubKey } = await withClub();
  assert(/^[0-9a-f]{48}$/.test(clubKey));
  assertEquals(db.clubs[0].keyHash, await sha256Hex(clubKey));
  assertEquals([db.clubs[0].slug, db.clubs[0].name], ["bcparis", "BC Paris 15"]);
});

Deno.test("création : invitation en minuscules et sans tirets acceptée", async () => {
  const db = makeDb(["ABCD-EFGH-JKMN"]);
  const res = await call(db, "POST", "", { slug: "bcparis", name: "BC", invite: " abcdefghjkmn " });
  assertEquals(res.status, 200);
});

Deno.test("création : invitation inconnue ou déjà utilisée → 403", async () => {
  const { db } = await withClub();
  const again = await call(db, "POST", "", { slug: "autre", name: "Autre", invite: "ABCD-EFGH-JKMN" });
  assertEquals(again.status, 403);
  const unknown = await call(db, "POST", "", { slug: "autre", name: "Autre", invite: "ZZZZ" });
  assertEquals(unknown.status, 403);
});

Deno.test("création : slug pris → 409", async () => {
  const { db } = await withClub(["AAAA", "BBBB"]);
  const res = await call(db, "POST", "", { slug: "bcparis", name: "Doublon", invite: "BBBB" });
  assertEquals(res.status, 409);
});

Deno.test("création : champs invalides → 400", async () => {
  const db = makeDb(["AAAA"]);
  for (const body of [
    { slug: "BCParis", name: "x", invite: "AAAA" },     // majuscules
    { slug: "b", name: "x", invite: "AAAA" },           // trop court
    { slug: "-bc", name: "x", invite: "AAAA" },         // tiret en tête
    { slug: "bc paris", name: "x", invite: "AAAA" },    // espace
    { slug: "bcparis", name: "  ", invite: "AAAA" },    // nom vide
    { slug: "bcparis", name: "x".repeat(49), invite: "AAAA" },
    { slug: "bcparis", name: "x" },                     // pas d'invitation
  ]) {
    assertEquals((await call(db, "POST", "", body)).status, 400, JSON.stringify(body));
  }
  assertEquals((await call(db, "POST", "", "pas du json")).status, 400);
});

Deno.test("lecture publique : nom et terrains triés, sans hash ni id", async () => {
  const { db, clubKey } = await withClub();
  await call(db, "POST", "/bcparis/terrains", { label: "Terrain 1" }, clubKey);
  await call(db, "POST", "/bcparis/terrains", { label: "Court central" }, clubKey);
  await call(db, "PATCH", "/bcparis/terrains/bcparis-t2", { position: 0 }, clubKey);
  const res = await call(db, "GET", "/bcparis");
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    slug: "bcparis",
    name: "BC Paris 15",
    terrains: [
      { channel: "bcparis-t2", label: "Court central", position: 0 },
      { channel: "bcparis-t1", label: "Terrain 1", position: 1 },
    ],
  });
  assertEquals((await call(db, "GET", "/inconnu")).status, 404);
});

Deno.test("terrain : créé avec sa clé (hash seul stocké)", async () => {
  const { db, clubKey } = await withClub();
  const res = await call(db, "POST", "/bcparis/terrains", { label: " Terrain 1 " }, clubKey);
  assertEquals(res.status, 200);
  const t = await res.json();
  assertEquals([t.channel, t.label], ["bcparis-t1", "Terrain 1"]);
  assert(/^[0-9a-f]{48}$/.test(t.key));
  assertEquals(db.clubs[0].terrains[0].keyHash, await sha256Hex(t.key));
});

Deno.test("terrain : sans clé club ou clé fausse → 401 ; label invalide → 400", async () => {
  const { db, clubKey } = await withClub();
  assertEquals((await call(db, "POST", "/bcparis/terrains", { label: "T" })).status, 401);
  assertEquals((await call(db, "POST", "/bcparis/terrains", { label: "T" }, "mauvaise")).status, 401);
  assertEquals((await call(db, "POST", "/inconnu/terrains", { label: "T" }, clubKey)).status, 401);
  assertEquals((await call(db, "POST", "/bcparis/terrains", { label: "" }, clubKey)).status, 400);
  assertEquals((await call(db, "POST", "/bcparis/terrains", { label: "x".repeat(25) }, clubKey)).status, 400);
});

Deno.test("terrain : 16 au plus → 409 limite", async () => {
  const { db, clubKey } = await withClub();
  for (let i = 1; i <= 16; i++) {
    assertEquals((await call(db, "POST", "/bcparis/terrains", { label: `T${i}` }, clubKey)).status, 200);
  }
  const res = await call(db, "POST", "/bcparis/terrains", { label: "T17" }, clubKey);
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "limite");
});

Deno.test("terrain : renommer ; champs invalides → 400 ; inconnu → 404", async () => {
  const { db, clubKey } = await withClub();
  await call(db, "POST", "/bcparis/terrains", { label: "Terrain 1" }, clubKey);
  assertEquals((await call(db, "PATCH", "/bcparis/terrains/bcparis-t1", { label: "Central" }, clubKey)).status, 200);
  assertEquals(db.clubs[0].terrains[0].label, "Central");
  assertEquals((await call(db, "PATCH", "/bcparis/terrains/bcparis-t1", {}, clubKey)).status, 400);
  assertEquals((await call(db, "PATCH", "/bcparis/terrains/bcparis-t1", { position: -1 }, clubKey)).status, 400);
  assertEquals((await call(db, "PATCH", "/bcparis/terrains/bcparis-t9", { label: "X" }, clubKey)).status, 404);
  assertEquals((await call(db, "PATCH", "/bcparis/terrains/bcparis-t1", { label: "X" })).status, 401);
});

Deno.test("terrain d'un autre club → 404 (renommer comme régénérer)", async () => {
  const db = makeDb(["AAAA", "BBBB"]);
  const a = await (await call(db, "POST", "", { slug: "club-a", name: "A", invite: "AAAA" })).json();
  const b = await (await call(db, "POST", "", { slug: "club-b", name: "B", invite: "BBBB" })).json();
  await call(db, "POST", "/club-a/terrains", { label: "T1" }, a.clubKey);
  assertEquals((await call(db, "PATCH", "/club-b/terrains/club-a-t1", { label: "Volé" }, b.clubKey)).status, 404);
  assertEquals((await call(db, "POST", "/club-b/terrains/club-a-t1/key", undefined, b.clubKey)).status, 404);
});

Deno.test("régénération : nouvelle clé, nouveau hash", async () => {
  const { db, clubKey } = await withClub();
  const t = await (await call(db, "POST", "/bcparis/terrains", { label: "T1" }, clubKey)).json();
  const res = await call(db, "POST", "/bcparis/terrains/bcparis-t1/key", undefined, clubKey);
  assertEquals(res.status, 200);
  const r = await res.json();
  assertEquals(r.channel, "bcparis-t1");
  assertNotEquals(r.key, t.key);
  assertEquals(db.clubs[0].terrains[0].keyHash, await sha256Hex(r.key));
});

Deno.test("méthode ou chemin inconnus → 405 / 404", async () => {
  const { db, clubKey } = await withClub();
  assertEquals((await call(db, "GET", "")).status, 405);
  assertEquals((await call(db, "DELETE", "/bcparis", undefined, clubKey)).status, 405);
  assertEquals((await call(db, "GET", "/bcparis/autre")).status, 404);
  assertEquals((await call(db, "GET", "/bcparis/terrains/bcparis-t1/key/x")).status, 404);
});
