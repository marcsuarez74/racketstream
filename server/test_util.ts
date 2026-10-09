// Helpers partagés par les tests du serveur : base :memory: avec deux canaux.
import { openDb, type Store } from "./db.ts";
import { sha256Hex } from "../supabase/functions/sync/handler.ts";

export const KEY = "cle-marc";
export const KEY_AMI = "cle-ami";
export const CONFIG = { targetScore: 21, winBy: 2, cap: 30, setsToWin: 2 };

export async function seeded(): Promise<Store> {
  const store = openDb(":memory:");
  const ins = store.sql.prepare("INSERT INTO devices (device_key_hash, channel) VALUES (?, ?)");
  ins.run(await sha256Hex(KEY), "marc");
  ins.run(await sha256Hex(KEY_AMI), "ami");
  return store;
}

export function syncReq(matchId: string, key: string, seq: number, score: [number, number], status = "active", startedAt = 1_790_000_000_000): Request {
  return new Request(`http://x/functions/v1/sync/matches/${matchId}/events`, {
    method: "POST",
    headers: { "X-Device-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: "install-1", config: CONFIG, startedAt,
      snapshot: { status, currentSet: 1, scoreMe: score[0], scoreOpp: score[1], setsMe: 0, setsOpp: 0, lastSequence: seq },
      events: [{ type: 0, arg: 0, sequence: seq, ts: 1, prevMe: 0, prevOpp: 0 }],
    }),
  });
}
