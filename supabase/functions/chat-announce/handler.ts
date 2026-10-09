// Edge Function chat-announce — déclenchement manuel/rattrapage de l'annonce
// du score dans le chat Twitch (la voie principale est event-driven dans
// sync). Pour chaque canal configuré (devices.se_channel_id), calcule le
// texte du score courant (même format que !score) et poste via la logique
// partagée _shared/announce.ts. Protégé par CHAT_ANNOUNCE_KEY.
import { isSaneScore, maybeAnnounce, type Announcer } from "../_shared/announce.ts";
import type { ScoreRow } from "../score-text/handler.ts";

export type { ScoreRow };

export interface ChannelCfg {
  channel: string;
  seChannelId: string | null;
  seJwt?: string | null;
  name1: string;
  name2: string;
}

export interface AnnounceDb {
  // Canaux à traiter (devices avec/sans se_channel_id).
  channels(): Promise<ChannelCfg[]>;
  // Match actif le plus récent du canal ; fallback : le plus récent tout statut.
  latestMatch(channel: string, activeOnly: boolean): Promise<ScoreRow | null>;
  lastAnnounced(channel: string): Promise<string | null>;
  saveAnnounced(channel: string, text: string): Promise<void>;
}

export interface AnnounceEnv {
  // Si défini, la requête doit porter ?key=<valeur> (protège le endpoint
  // appelé sans JWT).
  announceKey?: string;
}

export async function handleChatAnnounce(
  req: Request,
  db: AnnounceDb,
  sender: Announcer,
  env: AnnounceEnv = {},
): Promise<Response> {
  const u = new URL(req.url);
  if (env.announceKey !== undefined && u.searchParams.get("key") !== env.announceKey) {
    return new Response("unauthorized", { status: 401 });
  }

  const announced: string[] = [];
  for (const cfg of await db.channels()) {
    const active = await db.latestMatch(cfg.channel, true);
    const current = active && isSaneScore(active) ? active : null;
    const fallback = current ? null : await db.latestMatch(cfg.channel, false);
    const row = current ?? (fallback && isSaneScore(fallback) ? fallback : null);
    if (await maybeAnnounce(cfg.channel, cfg, row, db, sender)) announced.push(cfg.channel);
  }

  return new Response(JSON.stringify({ announced, errors: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
