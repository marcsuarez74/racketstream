// Implémentations SQLite des interfaces Db des handlers (supabase/functions/*).
// Les handlers restent purs ; seul le câblage change par rapport aux index.ts
// Supabase. Toute écriture passe par Store.exclusive / Store.atomic.
import type { Store } from "./db.ts";
import type { Db as SyncDb } from "../supabase/functions/sync/handler.ts";
import { teamName, type Db as ScoreDb, type Names, type ScoreRow } from "../supabase/functions/score-text/handler.ts";
import type { AnnounceDb, ChannelCfg } from "../supabase/functions/chat-announce/handler.ts";
import type { NamesDb } from "../supabase/functions/names/handler.ts";
import type { RegisterDb } from "../supabase/functions/register/handler.ts";
import type { ClubsDb, Terrain } from "../supabase/functions/clubs/handler.ts";
import { sha256Hex } from "../supabase/functions/sync/handler.ts";

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
    async newerMatchExists(ownerId, matchId, startedAt) {
      try {
        const r = q.prepare(`SELECT EXISTS (
                     SELECT 1 FROM matches o
                     WHERE o.owner_id = ? AND o.match_id <> ?
                       AND o.started_at > COALESCE((SELECT started_at FROM matches WHERE match_id = ?), ?)
                   ) AS newer`).get(ownerId, matchId, matchId, startedAt) as Row;
        return { newer: Number(r.newer) === 1, error: null };
      } catch (e) { return { newer: false, error: errMsg(e) }; }
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

// ---------------------------------------------------------------------------
// Pick du match à afficher : UNIQUE implémentation (overlay, widget SE,
// renderer VPS, score-text et chat-announce passent tous par ici).
// Match dont l'état est « active » le plus récent du canal, sinon le plus
// récent tout statut. Tri started_at DESC, NULL en dernier.

export interface Picked {
  match_id: string;
  status: string;
  current_set: number;
  score_me: number;
  score_opp: number;
  sets_me: number;
  sets_opp: number;
  config: ScoreRow["config"];
  updated_at: number;
}

function latest(store: Store, channel: string, activeOnly: boolean): Picked | null {
  const r = store.sql.prepare(`
    SELECT m.match_id, m.status AS match_status, s.status, s.current_set, s.score_me, s.score_opp, s.sets_me, s.sets_opp, s.config, s.updated_at
    FROM matches m JOIN match_state s ON s.match_id = m.match_id
    WHERE m.channel = ? ${activeOnly ? "AND s.status = 'active' AND m.status = 'active'" : ""}
    ORDER BY m.started_at IS NULL, m.started_at DESC
    LIMIT 1`).get(channel) as Row | undefined;
  // Match arrêté depuis la montre (fin de séance, abandon) : plus rien à
  // afficher, ni lui ni un match plus ancien.
  if (!r || r.match_status === "archived") return null;
  return {
    match_id: String(r.match_id),
    status: String(r.status),
    current_set: Number(r.current_set),
    score_me: Number(r.score_me),
    score_opp: Number(r.score_opp),
    sets_me: Number(r.sets_me),
    sets_opp: Number(r.sets_opp),
    config: JSON.parse(String(r.config)),
    updated_at: Number(r.updated_at),
  };
}

export function pickScore(store: Store, channel: string): Picked | null {
  return latest(store, channel, true) ?? latest(store, channel, false);
}

function toScoreRow(p: Picked | null): ScoreRow | null {
  if (!p) return null;
  return {
    status: p.status, currentSet: p.current_set, scoreMe: p.score_me, scoreOpp: p.score_opp,
    setsMe: p.sets_me, setsOpp: p.sets_opp, config: p.config,
  };
}

export function getNames(store: Store, channel: string): Names | null {
  const d = store.sql.prepare("SELECT format, name1, name1b, name2, name2b FROM devices WHERE channel = ?").get(channel) as Row | undefined;
  if (!d) return null;
  return {
    format: String(d.format ?? "simple"),
    name1: String(d.name1 ?? ""),
    name1b: String(d.name1b ?? ""),
    name2: String(d.name2 ?? ""),
    name2b: String(d.name2b ?? ""),
  };
}

export function sqliteScoreDb(store: Store): ScoreDb {
  return {
    latestMatch: async (channel, activeOnly) => toScoreRow(latest(store, channel, activeOnly)),
    getNames: async (channel) => getNames(store, channel),
  };
}

export function sqliteAnnounceDb(store: Store): AnnounceDb {
  return {
    async channels() {
      const rows = store.sql.prepare("SELECT channel, se_channel_id, se_jwt, name1, name2 FROM devices").all() as Row[];
      return rows.map((d) => ({
        channel: String(d.channel),
        seChannelId: (d.se_channel_id as string | null) ?? null,
        seJwt: (d.se_jwt as string | null) ?? null,
        name1: String(d.name1 ?? "MOI"),
        name2: String(d.name2 ?? "LUI"),
      })) as ChannelCfg[];
    },
    latestMatch: async (channel, activeOnly) => toScoreRow(latest(store, channel, activeOnly)),
    lastAnnounced: (channel) => lastAnnounced(store, channel),
    saveAnnounced: (channel, text) => saveAnnounced(store, channel, text),
  };
}

export function sqliteNamesDb(store: Store): NamesDb {
  return {
    async getDeviceHash(key) {
      try {
        const d = store.sql.prepare("SELECT id FROM devices WHERE device_key_hash = ?").get(await sha256Hex(key)) as Row | undefined;
        return { deviceId: d ? String(d.id) : null, error: null };
      } catch (e) { return { deviceId: null, error: errMsg(e) }; }
    },
    getNames: async (channel) => getNames(store, channel),
    async upsertNames(deviceId, f) {
      try {
        await store.exclusive(() => {
          store.sql.prepare("UPDATE devices SET format = ?, name1 = ?, name1b = ?, name2 = ?, name2b = ? WHERE id = ?")
            .run(f.format, f.name1, f.name1b, f.name2, f.name2b, Number(deviceId));
        });
        return { error: null };
      } catch (e) { return { error: errMsg(e) }; }
    },
  };
}

export function sqliteRegisterDb(store: Store): RegisterDb {
  return {
    async channelTaken(channel) {
      return store.sql.prepare("SELECT 1 FROM devices WHERE channel = ?").get(channel) !== undefined;
    },
    async createChannel(channel, keyHash) {
      try {
        await store.exclusive(() => {
          store.sql.prepare("INSERT INTO devices (channel, device_key_hash) VALUES (?, ?)").run(channel, keyHash);
        });
        return { error: null };
      } catch (e) {
        // UNIQUE(channel) : la contrainte tranche la course channelTaken → insert.
        if (/UNIQUE constraint failed/.test(errMsg(e))) return { error: "taken" };
        return { error: errMsg(e) };
      }
    },
  };
}

// Clubs (phase 10) : un terrain est une ligne devices rattachée au club.
export function sqliteClubsDb(store: Store): ClubsDb {
  const q = store.sql;
  return {
    async createClub(slug, name, keyHash, inviteHash) {
      try {
        await store.atomic(async () => {
          const now = Date.now();
          const inv = q.prepare("UPDATE club_invites SET used_at = ? WHERE code_hash = ? AND used_at IS NULL").run(now, inviteHash);
          if (Number(inv.changes) !== 1) throw new Error("invite");
          const c = q.prepare("INSERT INTO clubs (slug, name, club_key_hash) VALUES (?, ?, ?)").run(slug, name, keyHash);
          q.prepare("UPDATE club_invites SET club_id = ? WHERE code_hash = ?").run(Number(c.lastInsertRowid), inviteHash);
        });
        return { error: null };
      } catch (e) {
        const m = errMsg(e);
        if (m === "invite") return { error: "invite" };
        // UNIQUE(slug) : rollback, l'invitation reste libre.
        if (/UNIQUE constraint failed: clubs\.slug/.test(m)) return { error: "taken" };
        return { error: m };
      }
    },
    async getClub(slug) {
      const c = q.prepare("SELECT id, name FROM clubs WHERE slug = ?").get(slug) as Row | undefined;
      if (!c) return null;
      const rows = q.prepare(`SELECT channel, label, position FROM devices WHERE club_id = ?
                              ORDER BY position IS NULL, position, id`).all(Number(c.id)) as Row[];
      const terrains: Terrain[] = rows.map((r) => ({
        channel: String(r.channel), label: String(r.label ?? r.channel), position: Number(r.position ?? 0),
      }));
      return { id: Number(c.id), name: String(c.name), terrains };
    },
    async clubIdByKey(slug, keyHash) {
      const c = q.prepare("SELECT id FROM clubs WHERE slug = ? AND club_key_hash = ?").get(slug, keyHash) as Row | undefined;
      return c ? Number(c.id) : null;
    },
    async createTerrain(clubId, slug, label, keyHash) {
      try {
        const channel = await store.exclusive(() => {
          const r = q.prepare("SELECT COUNT(*) AS n, MAX(position) AS p FROM devices WHERE club_id = ?").get(clubId) as Row;
          const taken = q.prepare("SELECT 1 FROM devices WHERE channel = ?");
          let n = Number(r.n) + 1;
          while (taken.get(`${slug}-t${n}`) !== undefined) n++;
          const ch = `${slug}-t${n}`;
          q.prepare("INSERT INTO devices (channel, device_key_hash, label, club_id, position) VALUES (?, ?, ?, ?, ?)")
            .run(ch, keyHash, label, clubId, r.p === null ? 1 : Number(r.p) + 1);
          return ch;
        });
        return { channel, error: null };
      } catch (e) { return { channel: null, error: errMsg(e) }; }
    },
    async updateTerrain(clubId, channel, f) {
      return await store.exclusive(() => {
        const sets: string[] = [];
        const args: (string | number)[] = [];
        if (f.label !== undefined) { sets.push("label = ?"); args.push(f.label); }
        if (f.position !== undefined) { sets.push("position = ?"); args.push(f.position); }
        const r = q.prepare(`UPDATE devices SET ${sets.join(", ")} WHERE channel = ? AND club_id = ?`).run(...args, channel, clubId);
        return { found: Number(r.changes) === 1 };
      });
    },
    async setTerrainKey(clubId, channel, keyHash) {
      return await store.exclusive(() => {
        const r = q.prepare("UPDATE devices SET device_key_hash = ? WHERE channel = ? AND club_id = ?").run(keyHash, channel, clubId);
        return { found: Number(r.changes) === 1 };
      });
    },
  };
}
