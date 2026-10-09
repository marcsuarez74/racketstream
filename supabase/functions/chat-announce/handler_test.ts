// Tests chat-announce — logique pure (Db + sender injectés). Le handler
// parcourt les canaux, calcule le texte du score courant et poste dans le
// chat StreamElements quand le texte change depuis la dernière annonce.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleChatAnnounce, type AnnounceDb, type ChannelCfg, type ScoreRow } from "./handler.ts";
import type { Announcer as ChatSender } from "../_shared/announce.ts";

function row(over: Partial<ScoreRow> = {}): ScoreRow {
  return {
    status: "active", currentSet: 2, scoreMe: 5, scoreOpp: 3, setsMe: 1, setsOpp: 0,
    config: { targetScore: 21, winBy: 2, cap: 30, setsToWin: 2 },
    ...over,
  };
}

function makeDb(chans: ChannelCfg[], last: Record<string, string | null>, match: ScoreRow | null): AnnounceDb & { saves: Array<{ channel: string; text: string }> } {
  const saves: Array<{ channel: string; text: string }> = [];
  return {
    saves,
    async channels() {
      return chans;
    },
    async latestMatch(_channel, activeOnly) {
      if (!match) return null;
      return (!activeOnly || match.status === "active") ? match : null;
    },
    async lastAnnounced(channel) {
      return last[channel] ?? null;
    },
    async saveAnnounced(channel, text) {
      last[channel] = text;
      saves.push({ channel, text });
    },
  };
}

function makeSender(fail = false): { sender: ChatSender; calls: Array<{ id: string; msg: string }> } {
  const calls: Array<{ id: string; msg: string }> = [];
  const sender: ChatSender = {
    async send(id, _seJwt, msg) {
      if (fail) throw new Error("SE down");
      calls.push({ id, msg });
    },
  };
  return { sender, calls };
}

function run(url: string, db: AnnounceDb, sender: ChatSender, env: { announceKey?: string } = {}): Promise<Response> {
  return handleChatAnnounce(new Request(url), db, sender, env);
}

Deno.test("annonce la première fois (sender appelé + last_text sauvegardé)", async () => {
  const db = makeDb([{ channel: "marc", seChannelId: "123456", name1: "MOI", name2: "LUI" }], {}, row());
  const { sender, calls } = makeSender();
  const res = await run("https://fn.test/chat-announce", db, sender);
  assertEquals(res.status, 200);
  assertEquals(calls, [{ id: "123456", msg: "MOI 5-3 LUI · SET 2 · Sets 1-0" }]);
  assertEquals(db.saves, [{ channel: "marc", text: "MOI 5-3 LUI · SET 2 · Sets 1-0" }]);
});

Deno.test("pas d'annonce si le texte n'a pas changé", async () => {
  const db = makeDb([{ channel: "marc", seChannelId: "123456", name1: "MOI", name2: "LUI" }], { marc: "MOI 5-3 LUI · SET 2 · Sets 1-0" }, row());
  const { sender, calls } = makeSender();
  const res = await run("https://fn.test/chat-announce", db, sender);
  assertEquals(res.status, 200);
  assertEquals(calls, []);
  assertEquals(db.saves, []);
});

Deno.test("annonce quand le score change (nouveau texte posté)", async () => {
  const db = makeDb([{ channel: "marc", seChannelId: "123456", name1: "MOI", name2: "LUI" }], { marc: "MOI 4-3 LUI · SET 2 · Sets 1-0" }, row({ scoreMe: 5 }));
  const { sender, calls } = makeSender();
  await run("https://fn.test/chat-announce", db, sender);
  assertEquals(calls, [{ id: "123456", msg: "MOI 5-3 LUI · SET 2 · Sets 1-0" }]);
});

Deno.test("skip si aucun match (pas de message d'attente en annonce)", async () => {
  const db = makeDb([{ channel: "marc", seChannelId: "123456", name1: "MOI", name2: "LUI" }], {}, null);
  const { sender, calls } = makeSender();
  await run("https://fn.test/chat-announce", db, sender);
  assertEquals(calls, []);
  assertEquals(db.saves, []);
});

Deno.test("skip si le canal n'a pas de canal StreamElements configuré", async () => {
  const db = makeDb([{ channel: "ami", seChannelId: null, name1: "MOI", name2: "LUI" }], {}, row());
  const { sender, calls } = makeSender();
  await run("https://fn.test/chat-announce", db, sender);
  assertEquals(calls, []);
});

Deno.test("JWT par canal transmise au sender (fallback global = null)", async () => {
  const db = makeDb([
    { channel: "paul", seChannelId: "6abff252", seJwt: "jwt-paul", name1: "MOI", name2: "LUI" },
    { channel: "marc", seChannelId: "123456", name1: "MOI", name2: "LUI" },
  ], {}, row());
  const jwts: Array<string | null | undefined> = [];
  const sender: ChatSender = {
    async send(_id, jwt, _msg) { jwts.push(jwt); },
  };
  await run("https://fn.test/chat-announce", db, sender);
  assertEquals(jwts, ["jwt-paul", null]);
});

Deno.test("annonce aussi la fin de match (suffixe Terminé)", async () => {
  const db = makeDb([{ channel: "marc", seChannelId: "123456", name1: "MOI", name2: "LUI" }], { marc: "MOI 20-3 LUI · SET 2 · Sets 1-0" }, row({ status: "match_finished", scoreMe: 21, currentSet: 2 }));
  const { sender, calls } = makeSender();
  await run("https://fn.test/chat-announce", db, sender);
  assertEquals(calls, [{ id: "123456", msg: "MOI 21-3 LUI · SET 2 · Sets 1-0 · Terminé" }]);
});

Deno.test("noms du canal utilisés dans l'annonce", async () => {
  const db = makeDb([{ channel: "marc", seChannelId: "123456", name1: "Marc", name2: "Paul" }], {}, row());
  const { sender, calls } = makeSender();
  await run("https://fn.test/chat-announce", db, sender);
  assertEquals(calls[0].msg, "Marc 5-3 Paul · SET 2 · Sets 1-0");
});

Deno.test("échec d'envoi : last_text non mis à jour (retentative au prochain passage)", async () => {
  const db = makeDb([{ channel: "marc", seChannelId: "123456", name1: "MOI", name2: "LUI" }], {}, row());
  const { sender, calls } = makeSender(true);
  const res = await run("https://fn.test/chat-announce", db, sender);
  assertEquals(res.status, 200);
  assertEquals(calls, []);
  assertEquals(db.saves, []);
});

Deno.test("401 sans la clé quand CHAT_ANNOUNCE_KEY est configuré", async () => {
  const db = makeDb([{ channel: "marc", seChannelId: "123456", name1: "MOI", name2: "LUI" }], {}, row());
  const { sender, calls } = makeSender();
  const res1 = await run("https://fn.test/chat-announce", db, sender, { announceKey: "secret" });
  const res2 = await run("https://fn.test/chat-announce?key=wrong", db, sender, { announceKey: "secret" });
  assertEquals(res1.status, 401);
  assertEquals(res2.status, 401);
  assertEquals(calls, []);
});

Deno.test("200 avec la bonne clé", async () => {
  const db = makeDb([{ channel: "marc", seChannelId: "123456", name1: "MOI", name2: "LUI" }], {}, row());
  const { sender, calls } = makeSender();
  const res = await run("https://fn.test/chat-announce?key=secret", db, sender, { announceKey: "secret" });
  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
});

Deno.test("sans clé configurée : ouvert (cron simple)", async () => {
  const db = makeDb([{ channel: "marc", seChannelId: "123456", name1: "MOI", name2: "LUI" }], {}, row());
  const { sender, calls } = makeSender();
  const res = await run("https://fn.test/chat-announce", db, sender, {});
  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
});

Deno.test("fallback : dernier match fini annoncé si aucun actif", async () => {
  const db = makeDb([{ channel: "marc", seChannelId: "123456", name1: "MOI", name2: "LUI" }], {}, row({ status: "match_finished", scoreMe: 21, scoreOpp: 15 }));
  const { sender, calls } = makeSender();
  await run("https://fn.test/chat-announce", db, sender);
  assertEquals(calls.length, 1);
});
