import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Store } from "./db.ts";
import { pickScore, sqliteNamesDb, sqliteRegisterDb, sqliteSyncDb } from "./stores.ts";
import { handleNamesGet, handleNamesPost } from "../supabase/functions/names/handler.ts";
import { handleRegisterPost } from "../supabase/functions/register/handler.ts";
import { handleSync, sha256Hex } from "../supabase/functions/sync/handler.ts";
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

// --- Pick, noms, register -------------------------------------------------

Deno.test("pick : un actif ancien l'emporte sur un terminé récent", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  await handleSync(syncReq("ANCIEN01", KEY_AMI, 1, [3, 0], "active", 1_000), db);
  // Un canal = une clé : on rattache le match d'ami à « marc » pour le cas d'école.
  await handleSync(syncReq("RECENT01", KEY, 1, [9, 9], "match_finished", 2_000), db);
  store.sql.exec("UPDATE matches SET channel = 'marc'");
  assertEquals(pickScore(store, "marc")?.match_id, "ANCIEN01");
  store.close();
});

Deno.test("pick : sans actif, le plus récent tout statut", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  await handleSync(syncReq("VIEUX001", KEY, 1, [1, 0], "match_finished", 1_000), db);
  await handleSync(syncReq("NEUF0001", KEY, 1, [2, 0], "match_finished", 2_000), db);
  const p = pickScore(store, "marc");
  assertEquals([p?.match_id, p?.score_me, p?.status], ["NEUF0001", 2, "match_finished"]);
  assertEquals(typeof p?.updated_at, "number");
  assertEquals(p?.config?.targetScore, 21);
  store.close();
});

Deno.test("pick : started_at null classé en dernier ; canal vide → null", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  await handleSync(syncReq("DATE0001", KEY, 1, [1, 0], "match_finished", 1_000), db);
  await handleSync(syncReq("NULL0001", KEY, 1, [5, 0], "match_finished", 2_000), db);
  store.sql.exec("UPDATE matches SET started_at = NULL WHERE match_id = 'NULL0001'");
  assertEquals(pickScore(store, "marc")?.match_id, "DATE0001");
  assertEquals(pickScore(store, "inconnu"), null);
  store.close();
});

Deno.test("noms : POST puis GET, aller-retour", async () => {
  const store = await seeded();
  const db = sqliteNamesDb(store);
  const longKey = "cle-marc-longue-123";
  store.sql.prepare("UPDATE devices SET device_key_hash = ? WHERE channel = 'marc'").run(await sha256Hex(longKey));
  const post = await handleNamesPost(new Request("http://x/functions/v1/names", {
    method: "POST", headers: { "X-Device-Key": longKey },
    body: JSON.stringify({ format: "double", name1: "Marc", name1b: "Léa", name2: "Tom", name2b: "Zoé" }),
  }), db);
  assertEquals(post.status, 200);
  const get = await handleNamesGet(new Request("http://x/functions/v1/names?channel=marc"), db);
  const n = await get.json();
  assertEquals([n.format, n.name1, n.name1b, n.name2, n.name2b], ["double", "Marc", "Léa", "Tom", "Zoé"]);
  store.close();
});

Deno.test("register : canal créé puis 409 ; violation d'unicité → taken", async () => {
  const store = await seeded();
  const db = sqliteRegisterDb(store);
  const mk = () => new Request("http://x/functions/v1/register", { method: "POST", body: JSON.stringify({ channel: "neuf" }) });
  assertEquals((await handleRegisterPost(mk(), db)).status, 200);
  assertEquals((await handleRegisterPost(mk(), db)).status, 409);
  assertEquals(await db.createChannel("marc", "autre-hash"), { error: "taken" });
  store.close();
});
