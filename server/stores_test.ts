import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Store } from "./db.ts";
import { pickScore, sqliteClubsDb, sqliteNamesDb, sqliteRegisterDb, sqliteSyncDb } from "./stores.ts";
import { handleNamesGet, handleNamesPost } from "../supabase/functions/names/handler.ts";
import { handleRegisterPost } from "../supabase/functions/register/handler.ts";
import { handleSync, sha256Hex } from "../supabase/functions/sync/handler.ts";
import { bareReq, KEY, KEY_AMI, seeded, syncReq } from "./test_util.ts";

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

Deno.test("pick : un match entre deux sets (set_result) compte comme en cours", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  await handleSync(syncReq("ENTRE001", KEY_AMI, 1, [21, 18], "set_result", 1_000), db);
  await handleSync(syncReq("RECENT01", KEY, 1, [9, 9], "match_finished", 2_000), db);
  store.sql.exec("UPDATE matches SET channel = 'marc'");
  const p = pickScore(store, "marc");
  assertEquals([p?.match_id, p?.status], ["ENTRE001", "set_result"]);
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

Deno.test("pick : nouveau match ouvert à 0-0 → remplace aussitôt l'ancien score", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  await handleSync(syncReq("ANCIEN02", KEY, 1, [11, 0], "active", 1_000), db);
  const res = await handleSync(bareReq("NOUVEAU2", KEY, false, 2_000), db);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).lastAcceptedSequence, undefined);
  const p = pickScore(store, "marc");
  assertEquals([p?.match_id, p?.score_me, p?.status], ["NOUVEAU2", 0, "active"]);
  assertEquals(count(store, "SELECT COUNT(*) AS n FROM events WHERE match_id = ?", "NOUVEAU2"), 0);
  store.close();
});

Deno.test("pick : match arrêté sur la montre → plus rien à afficher, même pas un ancien", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  await handleSync(syncReq("VIEUX003", KEY, 1, [21, 3], "match_finished", 1_000), db);
  await handleSync(syncReq("ARRET003", KEY, 1, [11, 0], "active", 2_000), db);
  const res = await handleSync(bareReq("ARRET003", KEY, true, 2_000), db);
  assertEquals(res.status, 200);
  assertEquals(pickScore(store, "marc"), null);
  // Ses points restent en base (historique).
  assertEquals(count(store, "SELECT COUNT(*) AS n FROM events WHERE match_id = ?", "ARRET003"), 1);
  store.close();
});

function status(store: Store, matchId: string): string {
  return String((store.sql.prepare("SELECT status FROM matches WHERE match_id = ?").get(matchId) as Record<string, unknown>).status);
}

Deno.test("sync : match supplanté qui renvoie un point → reste finished, ne revient pas après stop du récent", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  await handleSync(syncReq("ANCIEN01", KEY, 1, [1, 0], "active", 1_000), db);
  await handleSync(syncReq("RECENT01", KEY, 1, [0, 1], "active", 2_000), db);
  const r = await handleSync(syncReq("ANCIEN01", KEY, 2, [2, 0], "active", 1_000), db);
  assertEquals(r.status, 200);
  assertEquals([status(store, "ANCIEN01"), status(store, "RECENT01")], ["finished", "active"]);
  assertEquals(count(store, "SELECT COUNT(*) AS n FROM events WHERE match_id = 'ANCIEN01'"), 2);
  await handleSync(bareReq("RECENT01", KEY, true, 2_000), db);
  assertEquals(pickScore(store, "marc"), null);
});

Deno.test("sync : match ancien arrivé en retard → ne clôture pas le récent", async () => {
  const store = await seeded();
  const db = sqliteSyncDb(store);
  await handleSync(syncReq("RECENT01", KEY, 1, [0, 1], "active", 2_000), db);
  await handleSync(syncReq("RETARD01", KEY, 1, [5, 0], "active", 1_000), db);
  assertEquals([status(store, "RETARD01"), status(store, "RECENT01")], ["finished", "active"]);
  assertEquals(pickScore(store, "marc")?.match_id, "RECENT01");
});

// ---------------------------------------------------------------------------
// Clubs (phase 10)

async function addInvite(store: Store, code: string): Promise<string> {
  const h = await sha256Hex(code);
  store.sql.prepare("INSERT INTO club_invites (code_hash) VALUES (?)").run(h);
  return h;
}

Deno.test("clubs : l'invitation est consommée une fois ; slug pris → taken sans la consommer", async () => {
  const store = await seeded();
  const db = sqliteClubsDb(store);
  const i1 = await addInvite(store, "i1");
  const i2 = await addInvite(store, "i2");
  assertEquals(await db.createClub("bcparis", "BC Paris", "k1", i1), { error: null });
  assertEquals(await db.createClub("autre", "Autre", "k2", i1), { error: "invite" });
  assertEquals(await db.createClub("bcparis", "Doublon", "k3", i2), { error: "taken" });
  assertEquals(count(store, "SELECT COUNT(*) AS n FROM club_invites WHERE used_at IS NULL"), 1);
  const used = store.sql.prepare("SELECT club_id FROM club_invites WHERE code_hash = ?").get(i1) as Record<string, unknown>;
  assertEquals(used.club_id, (await db.getClub("bcparis"))!.id);
  assertEquals(await db.createClub("autre", "Autre", "k2", "inconnue"), { error: "invite" });
});

Deno.test("clubs : terrains — canal libre suivant, tri par position, clé club vérifiée", async () => {
  const store = await seeded();
  const db = sqliteClubsDb(store);
  await db.createClub("bcparis", "BC Paris", "hk", await addInvite(store, "i"));
  const id = (await db.clubIdByKey("bcparis", "hk"))!;
  assertEquals(await db.clubIdByKey("bcparis", "faux"), null);
  assertEquals(await db.clubIdByKey("inconnu", "hk"), null);
  // Un canal perso porte déjà le nom du premier terrain : on passe au suivant.
  store.sql.prepare("INSERT INTO devices (device_key_hash, channel) VALUES ('perso', 'bcparis-t1')").run();
  assertEquals(await db.createTerrain(id, "bcparis", "Terrain 1", "t1"), { channel: "bcparis-t2", error: null });
  assertEquals(await db.createTerrain(id, "bcparis", "Terrain 2", "t2"), { channel: "bcparis-t3", error: null });
  assertEquals(await db.updateTerrain(id, "bcparis-t3", { position: 0 }), { found: true });
  assertEquals(await db.updateTerrain(id, "bcparis-t2", { label: "Central" }), { found: true });
  assertEquals((await db.getClub("bcparis"))!.terrains, [
    { channel: "bcparis-t3", label: "Terrain 2", position: 0 },
    { channel: "bcparis-t2", label: "Central", position: 1 },
  ]);
  // Canal perso ou d'un autre club : introuvable pour ce club.
  assertEquals(await db.updateTerrain(id, "bcparis-t1", { label: "Volé" }), { found: false });
  assertEquals(await db.setTerrainKey(id, "marc", "x"), { found: false });
  assertEquals(await db.getClub("inconnu"), null);
});

Deno.test("clubs : clé de terrain régénérée → l'ancienne refusée par sync, la nouvelle acceptée", async () => {
  const store = await seeded();
  const db = sqliteClubsDb(store);
  await db.createClub("bcparis", "BC Paris", "hk", await addInvite(store, "i"));
  const id = (await db.clubIdByKey("bcparis", "hk"))!;
  await db.createTerrain(id, "bcparis", "Terrain 1", await sha256Hex("ancienne"));
  const sync = sqliteSyncDb(store);
  assertEquals((await handleSync(syncReq("TERRAIN1", "ancienne", 1, [1, 0]), sync)).status, 200);
  assertEquals(pickScore(store, "bcparis-t1")?.score_me, 1);
  assertEquals(await db.setTerrainKey(id, "bcparis-t1", await sha256Hex("nouvelle")), { found: true });
  assertEquals((await handleSync(syncReq("TERRAIN1", "ancienne", 2, [2, 0]), sync)).status, 401);
  assertEquals((await handleSync(syncReq("TERRAIN1", "nouvelle", 2, [2, 0]), sync)).status, 200);
});
