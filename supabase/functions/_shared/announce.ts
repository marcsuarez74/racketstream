// Logique partagée d'annonce du score dans le chat Twitch (StreamElements).
// Utilisée par sync (annonce instantanée à chaque point, event-driven) et
// chat-announce (déclenchement manuel / rattrapage).
import { formatScore, type ScoreRow } from "../score-text/handler.ts";

export interface AnnounceCfg {
  seChannelId: string | null;
  // JWT API StreamElements propre au canal ; absent/null = JWT globale
  // (secret de fonction SE_JWT, ancien comportement mono-canal).
  seJwt?: string | null;
  name1: string;
  name2: string;
}

export interface AnnounceState {
  lastAnnounced(channel: string): Promise<string | null>;
  saveAnnounced(channel: string, text: string): Promise<void>;
}

export interface Announcer {
  send(seChannelId: string, seJwt: string | null, message: string): Promise<void>;
}

export function isSaneScore(row: ScoreRow): boolean {
  return [row.currentSet, row.scoreMe, row.scoreOpp, row.setsMe, row.setsOpp].every((v) => v !== null);
}

// Poste le texte du score s'il diffère du dernier annoncé. true si posté.
// Aucune annonce sans canal StreamElements ni score exploitable ; en cas
// d'échec d'envoi, last_text n'est pas sauvegardé → retentative au prochain
// passage (prochain point pour sync, prochain déclenchement pour
// chat-announce).
export async function maybeAnnounce(
  channel: string,
  cfg: AnnounceCfg | null,
  row: ScoreRow | null,
  state: AnnounceState,
  sender: Announcer,
): Promise<boolean> {
  if (!row || !cfg || !cfg.seChannelId || !isSaneScore(row)) return false;
  const text = formatScore(row, cfg.name1, cfg.name2);
  if (text === await state.lastAnnounced(channel)) return false;
  try {
    await sender.send(cfg.seChannelId, cfg.seJwt ?? null, text);
    await state.saveAnnounced(channel, text);
    return true;
  } catch {
    return false;
  }
}

// Sender StreamElements partagé (JWT du canal, sinon secret de fonction SE_JWT).
export function makeSeSender(): Announcer {
  return {
    async send(seChannelId, seJwt, message) {
      const jwt = seJwt ?? Deno.env.get("SE_JWT");
      if (!jwt) throw new Error("SE_JWT missing");
      // Endpoint validé en live : /kappa/v2/bot/{channelId}/say — le bot
      // StreamElements écrit le message dans le chat Twitch du compte
      // (/kappa/v2/chat/{id} renvoie 404).
      const res = await fetch(`https://api.streamelements.com/kappa/v2/bot/${seChannelId}/say`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error(`SE ${res.status}`);
      console.log("[se] status=", res.status, "channel=", seChannelId, "msg=", message.slice(0, 60));
    },
  };
}
