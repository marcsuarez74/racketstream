import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CHANNEL_IDLE_MS, createInvites, deleteChannel, deleteClub, MATCH_RETENTION_MS, purge, renewClubKey } from "./admin.ts";
import type { Store } from "./db.ts";
import { sqliteClubsDb } from "./stores.ts";
import { seeded } from "./test_util.ts";
import { normalizeInvite } from "../supabase/functions/clubs/handler.ts";
import { sha256Hex } from "../supabase/functions/sync/handler.ts";

Deno.test("admin invite : codes lisibles, chacun accepté une seule fois", async () => {
  const store = await seeded();
  const codes = await createInvites(store, 2);
  assertEquals(codes.length, 2);
  assertNotEquals(codes[0], codes[1]);
  for (const c of codes) assert(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/.test(c), c);
  const db = sqliteClubsDb(store);
  const h = await sha256Hex(normalizeInvite(codes[0]));
  assertEquals(await db.createClub("bcparis", "BC Paris", "k1", h), { error: null });
  assertEquals(await db.createClub("autre", "Autre", "k2", h), { error: "invite" });
});

Deno.test("admin club-key : nouvelle clé acceptée, ancienne refusée ; club inconnu → null", async () => {
  const store = await seeded();
  const db = sqliteClubsDb(store);
  const [code] = await createInvites(store, 1);
  await db.createClub("bcparis", "BC Paris", await sha256Hex("ancienne"), await sha256Hex(normalizeInvite(code)));
  const key = await renewClubKey(store, "bcparis");
  assert(key && /^[0-9a-f]{48}$/.test(key));
  assertEquals(await db.clubIdByKey("bcparis", await sha256Hex("ancienne")), null);
  assertNotEquals(await db.clubIdByKey("bcparis", await sha256Hex(key!)), null);
  assertEquals(await renewClubKey(store, "inconnu"), null);
});

const NOW = 1_800_000_000_000;

function addMatch(store: Store, id: string, channel: string, updatedAt: number) {
  const { id: owner } = store.sql.prepare("SELECT id FROM devices WHERE channel = ?").get(channel) as { id: number };
  store.sql.prepare("INSERT INTO matches (match_id, owner_id, device_id, channel, config, updated_at) VALUES (?, ?, 'i', ?, '{}', ?)")
    .run(id, owner, channel, updatedAt);
  store.sql.prepare("INSERT INTO events (id, match_id, sequence, type) VALUES (?, ?, 1, 0)").run(id + "-1", id);
  store.sql.prepare("INSERT INTO match_state (match_id, status, config, updated_at) VALUES (?, 'active', '{}', ?)").run(id, updatedAt);
}
const count = (store: Store, table: string) =>
  (store.sql.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

Deno.test("admin purge : matchs de plus de 12 mois et canaux perso inactifs depuis 24 mois", async () => {
  const store = await seeded();
  store.sql.prepare("UPDATE devices SET created_at = ?").run(NOW - CHANNEL_IDLE_MS - 1);
  addMatch(store, "vieux", "marc", NOW - MATCH_RETENTION_MS - 1);
  addMatch(store, "recent", "marc", NOW - 1000);
  store.sql.prepare("INSERT INTO chat_announce (channel, last_text, updated_at) VALUES ('ami', 'x', ?)").run(NOW - MATCH_RETENTION_MS - 1);
  assertEquals(await purge(store, NOW), { matches: 1, channels: 1 });
  assertEquals(store.sql.prepare("SELECT match_id FROM matches").all().map((r) => r.match_id), ["recent"]);
  assertEquals([count(store, "events"), count(store, "match_state"), count(store, "chat_announce")], [1, 1, 0]);
  // « ami » n'a aucun match depuis 24 mois : supprimé ; « marc » vient de jouer : gardé.
  assertEquals(store.sql.prepare("SELECT channel FROM devices").all().map((r) => r.channel), ["marc"]);
});

Deno.test("admin purge : un canal récent ou un terrain de club n'expire pas", async () => {
  const store = await seeded();
  const db = sqliteClubsDb(store);
  const [code] = await createInvites(store, 1);
  await db.createClub("bcparis", "BC Paris", await sha256Hex("k"), await sha256Hex(normalizeInvite(code)));
  store.sql.prepare("UPDATE devices SET club_id = (SELECT id FROM clubs), created_at = ? WHERE channel = 'ami'").run(0);
  assertEquals(await purge(store, NOW), { matches: 0, channels: 0 });
  assertEquals(count(store, "devices"), 2);
});

Deno.test("admin delete-channel / delete-club : tout ce qui s'y rattache est effacé", async () => {
  const store = await seeded();
  addMatch(store, "m1", "marc", NOW);
  addMatch(store, "m2", "ami", NOW);
  assertEquals(await deleteChannel(store, "marc"), true);
  assertEquals(await deleteChannel(store, "marc"), false);
  assertEquals(store.sql.prepare("SELECT channel FROM devices").all().map((r) => r.channel), ["ami"]);
  assertEquals([count(store, "matches"), count(store, "events"), count(store, "match_state")], [1, 1, 1]);

  const db = sqliteClubsDb(store);
  const [code] = await createInvites(store, 1);
  await db.createClub("bcparis", "BC Paris", await sha256Hex("k"), await sha256Hex(normalizeInvite(code)));
  store.sql.prepare("UPDATE devices SET club_id = (SELECT id FROM clubs) WHERE channel = 'ami'").run();
  assertEquals(await deleteClub(store, "bcparis"), true);
  assertEquals(await deleteClub(store, "bcparis"), false);
  assertEquals([count(store, "clubs"), count(store, "devices"), count(store, "matches"), count(store, "club_invites")], [0, 0, 0, 1]);
});
