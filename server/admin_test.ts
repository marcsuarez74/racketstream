import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createInvites, renewClubKey } from "./admin.ts";
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
