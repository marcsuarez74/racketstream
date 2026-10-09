import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleChatAnnounce, type AnnounceDb, type ChannelCfg, type ScoreRow } from "./handler.ts";
import { makeSeSender } from "../_shared/announce.ts";
import type { Db as ScoreDb } from "../score-text/handler.ts";

// Service role : la fonction lit devices (se_channel_id, noms) et écrit
// chat_announce — tables sans lecture publique.
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function toScoreRow(m: Record<string, unknown> | null): ScoreRow | null {
  if (!m) return null;
  const ms = m.match_state as Record<string, unknown> | undefined;
  if (!ms) return null;
  return {
    status: String(ms.status),
    currentSet: Number(ms.current_set),
    scoreMe: Number(ms.score_me),
    scoreOpp: Number(ms.score_opp),
    setsMe: Number(ms.sets_me),
    setsOpp: Number(ms.sets_opp),
    config: ms.config as ScoreRow["config"] ?? null,
  };
}

const scoreDb: ScoreDb = {
  async latestMatch(channel, activeOnly) {
    let req = supabase.from("matches")
      .select("started_at, match_state!inner(status, current_set, score_me, score_opp, sets_me, sets_opp, config)")
      .eq("channel", channel)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (activeOnly) req = req.eq("match_state.status", "active");
    const { data, error } = await req;
    if (error || !data || data.length === 0) return null;
    return toScoreRow(data[0]);
  },
  async getNames(channel) {
    const { data, error } = await supabase.from("devices")
      .select("format, name1, name1b, name2, name2b").eq("channel", channel).maybeSingle();
    if (error || !data) return null;
    return {
      format: String(data.format ?? "simple"),
      name1: String(data.name1 ?? ""),
      name1b: String(data.name1b ?? ""),
      name2: String(data.name2 ?? ""),
      name2b: String(data.name2b ?? ""),
    };
  },
};

const db: AnnounceDb = {
  async channels() {
    const { data, error } = await supabase.from("devices")
      .select("channel, se_channel_id, se_jwt, name1, name2");
    if (error || !data) return [];
    return data.map((d) => ({
      channel: String(d.channel),
      seChannelId: (d.se_channel_id as string | null) ?? null,
      seJwt: (d.se_jwt as string | null) ?? null,
      name1: String(d.name1 ?? "MOI"),
      name2: String(d.name2 ?? "LUI"),
    })) as ChannelCfg[];
  },
  latestMatch: (channel, activeOnly) => scoreDb.latestMatch(channel, activeOnly),
  async lastAnnounced(channel) {
    const { data } = await supabase.from("chat_announce")
      .select("last_text").eq("channel", channel).maybeSingle();
    return data ? String(data.last_text) : null;
  },
  async saveAnnounced(channel, text) {
    await supabase.from("chat_announce")
      .upsert({ channel, last_text: text, updated_at: new Date().toISOString() });
  },
};

const env = { announceKey: Deno.env.get("CHAT_ANNOUNCE_KEY") ?? undefined };

Deno.serve((req: Request) => handleChatAnnounce(req, db, makeSeSender(), env));
