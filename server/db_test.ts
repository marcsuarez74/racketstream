import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "./db.ts";

function version(db: { sql: DatabaseSync }): number {
  return (db.sql.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function columns(db: { sql: DatabaseSync }, table: string): string[] {
  return (db.sql.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

Deno.test("base neuve : schéma puis migrations, user_version = 2", () => {
  const db = openDb(":memory:");
  assertEquals(version(db), 2);
  assertEquals(columns(db, "clubs"), ["id", "slug", "name", "club_key_hash", "created_at"]);
  assertEquals(columns(db, "club_invites"), ["code_hash", "created_at", "used_at", "club_id"]);
  const dev = columns(db, "devices");
  assertEquals([dev.includes("club_id"), dev.includes("position")], [true, true]);
  db.close();
});

Deno.test("base v1 existante : migrée en v2 sans perte", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/v1.db`;
  const v1 = new DatabaseSync(path);
  v1.exec(await Deno.readTextFile(new URL("./schema.sql", import.meta.url)));
  v1.exec(`INSERT INTO devices (id, device_key_hash, channel) VALUES (1, 'h1', 'marc');
           INSERT INTO matches (match_id, owner_id, device_id, channel, config) VALUES ('M1', 1, 'i', 'marc', '{}');`);
  v1.close();
  const db = openDb(path);
  assertEquals(version(db), 2);
  const d = db.sql.prepare("SELECT channel, club_id FROM devices").get() as Record<string, unknown>;
  assertEquals([d.channel, d.club_id], ["marc", null]);
  assertEquals((db.sql.prepare("SELECT count(*) AS n FROM matches").get() as { n: number }).n, 1);
  db.close();
  openDb(path).close(); // la migration ne se rejoue pas (lèverait « duplicate column »)
  await Deno.remove(dir, { recursive: true });
});

Deno.test("réouverture d'une base existante : schéma non rejoué", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/t.db`;
  openDb(path).close();
  const db = openDb(path); // lèverait « table already exists » si rejoué
  db.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("UNIQUE(channel) et UNIQUE(device_key_hash) sur devices", () => {
  const db = openDb(":memory:");
  const ins = db.sql.prepare("INSERT INTO devices (device_key_hash, channel) VALUES (?, ?)");
  ins.run("h1", "marc");
  assertThrows(() => ins.run("h2", "marc"));
  assertThrows(() => ins.run("h1", "autre"));
  db.close();
});

Deno.test("verrou exclusive : exécution sérialisée", async () => {
  const db = openDb(":memory:");
  const log: string[] = [];
  const slow = db.exclusive(async () => { log.push("a1"); await new Promise((r) => setTimeout(r, 20)); log.push("a2"); });
  const fast = db.exclusive(() => { log.push("b"); });
  await Promise.all([slow, fast]);
  assertEquals(log, ["a1", "a2", "b"]);
  db.close();
});
