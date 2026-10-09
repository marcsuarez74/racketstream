import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Store } from "./db.ts";
import { sqliteSyncDb } from "./stores.ts";
import { handleSync } from "../supabase/functions/sync/handler.ts";
import { KEY, KEY_AMI, seeded, syncReq } from "./test_util.ts";

function count(store: Store, sql: string, ...p: (string | number)[]): number {
  return Number((store.sql.prepare(sql).get(...p) as Record<string, unknown>).n);
}

Deno.test("sync : rejouer le même batch ne crée pas de doublon, ACK identique", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  const r1 = await handleSync(syncReq("MATCH001", KEY, 1, [1, 0]), db);
  const r2 = await handleSync(syncReq("MATCH001", KEY, 1, [1, 0]), db);
  assertEquals(r1.status, 200);
  assertEquals(await r1.json(), await r2.json());
  assertEquals(count(store, "SELECT COUNT(*) AS n FROM events"), 1);
  const st = store.sql.prepare("SELECT score_me, status FROM match_state WHERE match_id = 'MATCH001'").get() as Record<string, unknown>;
  assertEquals([st.score_me, st.status], [1, "active"]);
  store.close();
});

Deno.test("sync : un nouveau match termine l'actif précédent de la même clé, pas celui d'une autre", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  await handleSync(syncReq("MATCH001", KEY, 1, [1, 0]), db);
  await handleSync(syncReq("AMI00001", KEY_AMI, 1, [1, 0]), db);
  await handleSync(syncReq("MATCH002", KEY, 1, [0, 1]), db);
  const st = (id: string) => (store.sql.prepare("SELECT status FROM matches WHERE match_id = ?").get(id) as Record<string, unknown>).status;
  assertEquals([st("MATCH001"), st("MATCH002"), st("AMI00001")], ["finished", "active", "active"]);
  store.close();
});

Deno.test("sync : match de la clé A envoyé avec la clé B → 403, rien d'écrit", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  await handleSync(syncReq("MATCH001", KEY, 1, [1, 0]), db);
  const r = await handleSync(syncReq("MATCH001", KEY_AMI, 2, [2, 0]), db);
  assertEquals(r.status, 403);
  assertEquals(count(store, "SELECT COUNT(*) AS n FROM events"), 1);
  store.close();
});

Deno.test("sync : erreur au milieu de la transaction → rollback complet", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  db.upsertState = async () => ({ error: "boom" });
  const r = await handleSync(syncReq("MATCH001", KEY, 1, [1, 0]), db);
  assertEquals(r.status, 500);
  assertEquals(count(store, "SELECT COUNT(*) AS n FROM matches"), 0);
  assertEquals(count(store, "SELECT COUNT(*) AS n FROM events"), 0);
  store.close();
});

Deno.test("sync : started_at absent au re-POST ne l'efface pas", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  await handleSync(syncReq("MATCH001", KEY, 1, [1, 0]), db);
  const body = await syncReq("MATCH001", KEY, 2, [2, 0]).json();
  delete body.startedAt;
  await handleSync(new Request("http://x/functions/v1/sync/matches/MATCH001/events", { method: "POST", headers: { "X-Device-Key": KEY }, body: JSON.stringify(body) }), db);
  const m = store.sql.prepare("SELECT started_at FROM matches").get() as Record<string, unknown>;
  assertEquals(m.started_at, 1_790_000_000_000);
  store.close();
});
