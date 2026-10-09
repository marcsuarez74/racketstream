import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { openDb } from "./db.ts";

Deno.test("schéma appliqué sur base neuve, user_version = 1", () => {
  const db = openDb(":memory:");
  const v = db.sql.prepare("PRAGMA user_version").get() as { user_version: number };
  assertEquals(v.user_version, 1);
  db.close();
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
