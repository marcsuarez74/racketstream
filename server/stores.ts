// Implémentations SQLite des interfaces Db des handlers (supabase/functions/*).
// Les handlers restent purs ; seul le câblage change par rapport aux index.ts
// Supabase. Toute écriture passe par Store.exclusive / Store.atomic.
import type { Store } from "./db.ts";
import type { Db as SyncDb } from "../supabase/functions/sync/handler.ts";
import { teamName } from "../supabase/functions/score-text/handler.ts";

type Row = Record<string, unknown>;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Les méthodes du Db sync sont appelées dans Store.atomic (verrou déjà pris) :
// elles ne reprennent pas le verrou, sauf saveAnnounced appelée hors transaction.
export function sqliteSyncDb(store: Store): SyncDb {
  const q = store.sql;
  return {
    async getDeviceHash(expected) {
      try {
        const d = q.prepare("SELECT id, channel FROM devices WHERE device_key_hash = ?").get(expected) as Row | undefined;
        return { ownerId: d ? Number(d.id) : null, channel: d ? String(d.channel) : null, error: null };
      } catch (e) { return { ownerId: null, channel: null, error: errMsg(e) }; }
    },
    async getMatchOwner(matchId) {
      try {
        const m = q.prepare("SELECT owner_id FROM matches WHERE match_id = ?").get(matchId) as Row | undefined;
        return { ownerId: m ? Number(m.owner_id) : null, error: null };
      } catch (e) { return { ownerId: null, error: errMsg(e) }; }
    },
    async upsertMatch(matchId, ownerId, deviceId, config, startedAt, status, channel) {
      try {
        // started_at n'est jamais écrasé par null (équivalent defaultToNull: false).
        q.prepare(`INSERT INTO matches (match_id, owner_id, device_id, channel, config, status, started_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(match_id) DO UPDATE SET
                     device_id = excluded.device_id, channel = excluded.channel, config = excluded.config,
                     status = excluded.status, started_at = COALESCE(excluded.started_at, matches.started_at),
                     updated_at = excluded.updated_at`)
          .run(matchId, ownerId, deviceId, channel, JSON.stringify(config), status, startedAt, Date.now());
        return { error: null };
      } catch (e) { return { error: errMsg(e) }; }
    },
    async finishOtherActiveMatches(ownerId, matchId) {
      try {
        q.prepare("UPDATE matches SET status = 'finished', updated_at = ? WHERE owner_id = ? AND status = 'active' AND match_id <> ?")
          .run(Date.now(), ownerId, matchId);
        return { error: null };
      } catch (e) { return { error: errMsg(e) }; }
    },
    async upsertEvents(matchId, events) {
      try {
        // Idempotence : doublons ignorés (UNIQUE (match_id, sequence), spec sync §7).
        const ins = q.prepare(`INSERT INTO events (id, match_id, sequence, type, arg, prev_me, prev_opp, ts)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
        for (const e of events) {
          ins.run(`${matchId}:${e.sequence}`, matchId, e.sequence as number, e.type as number,
            (e.arg as number) ?? 0, (e.prevMe as number) ?? null, (e.prevOpp as number) ?? null, (e.ts as number) ?? null);
        }
        return { error: null };
      } catch (e) { return { error: errMsg(e) }; }
    },
    async upsertState(matchId, s, config) {
      try {
        // Fraîcheur (anti-fantôme) : updated_at sert au pick et au renderer VPS.
        q.prepare(`INSERT INTO match_state (match_id, status, current_set, score_me, score_opp, sets_me, sets_opp, last_sequence, config, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(match_id) DO UPDATE SET
                     status = excluded.status, current_set = excluded.current_set, score_me = excluded.score_me,
                     score_opp = excluded.score_opp, sets_me = excluded.sets_me, sets_opp = excluded.sets_opp,
                     last_sequence = excluded.last_sequence, config = excluded.config, updated_at = excluded.updated_at`)
          .run(matchId, s.status as string, s.currentSet as number, s.scoreMe as number, s.scoreOpp as number,
            s.setsMe as number, s.setsOpp as number, s.lastSequence as number, JSON.stringify(config), Date.now());
        return { error: null };
      } catch (e) { return { error: errMsg(e) }; }
    },
    atomic: (fn) => store.atomic(fn),
    async getAnnounceCfg(channel) {
      const d = q.prepare("SELECT se_channel_id, se_jwt, name1, name1b, name2, name2b FROM devices WHERE channel = ?").get(channel) as Row | undefined;
      if (!d) return null;
      return {
        seChannelId: (d.se_channel_id as string | null) ?? null,
        seJwt: (d.se_jwt as string | null) ?? null,
        name1: teamName(String(d.name1 ?? "MOI"), String(d.name1b ?? "")),
        name2: teamName(String(d.name2 ?? "LUI"), String(d.name2b ?? "")),
      };
    },
    lastAnnounced: (channel) => lastAnnounced(store, channel),
    saveAnnounced: (channel, text) => saveAnnounced(store, channel, text),
  };
}

export async function lastAnnounced(store: Store, channel: string): Promise<string | null> {
  const r = store.sql.prepare("SELECT last_text FROM chat_announce WHERE channel = ?").get(channel) as Row | undefined;
  return r ? String(r.last_text) : null;
}

export async function saveAnnounced(store: Store, channel: string, text: string): Promise<void> {
  await store.exclusive(() => {
    store.sql.prepare(`INSERT INTO chat_announce (channel, last_text, updated_at) VALUES (?, ?, ?)
                       ON CONFLICT(channel) DO UPDATE SET last_text = excluded.last_text, updated_at = excluded.updated_at`)
      .run(channel, text, Date.now());
  });
}
