import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRegisterPost, type RegisterDb } from "./handler.ts";

function makeDb(taken: string[] = []): RegisterDb & { createdRows: { channel: string; keyHash: string }[] } {
  const created: { channel: string; keyHash: string }[] = [];
  return {
    async channelTaken(channel) { return taken.includes(channel); },
    async createChannel(channel, keyHash) {
      created.push({ channel, keyHash });
      return { error: null };
    },
    get createdRows() { return created; },
  } as RegisterDb & { createdRows: { channel: string; keyHash: string }[] };
}

const URL_REG = "https://fn.test/register";

function post(body: unknown): Request {
  return new Request(URL_REG, { method: "POST", body: JSON.stringify(body) });
}

Deno.test("405 si GET", async () => {
  const res = await handleRegisterPost(new Request(URL_REG, { method: "GET" }), makeDb());
  assertEquals(res.status, 405);
});

Deno.test("400 si canal invalide", async () => {
  for (const bad of ["", "..%2Fetc", "un-canal-beaucoup-trop-long-pour-la-bd", "espace interdit"]) {
    const res = await handleRegisterPost(post({ channel: bad }), makeDb());
    assertEquals(res.status, 400);
  }
});

Deno.test("409 si canal déjà pris", async () => {
  const res = await handleRegisterPost(post({ channel: "marc" }), makeDb(["marc"]));
  assertEquals(res.status, 409);
});

Deno.test("200 + clé générée, hash stocké (jamais la clé)", async () => {
  const db = makeDb();
  const res = await handleRegisterPost(post({ channel: "paul" }), db);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.channel, "paul");
  // Clé : 48 caractères hexadécimaux.
  assertEquals(/^[0-9a-f]{48}$/.test(body.key), true);
  const row = db.createdRows[0];
  assertEquals(row.channel, "paul");
  // Le hash stocké n'est PAS la clé en clair.
  assertEquals(row.keyHash !== body.key, true);
  assertEquals(row.keyHash.length, 64);
});

Deno.test("400 si body invalide", async () => {
  const res = await handleRegisterPost(post({ nope: 1 }), makeDb());
  assertEquals(res.status, 400);
});

Deno.test("409 si le canal est pris entre la vérification et l'insert", async () => {
  const db = makeDb();
  db.createChannel = async () => ({ error: "taken" });
  const res = await handleRegisterPost(post({ channel: "marc" }), db);
  assertEquals(res.status, 409);
});
