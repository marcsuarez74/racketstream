// Edge Function register — création de canal (le portail d'enregistrement
// du guide §3). POST {channel} → {channel, key} : la clé est générée par le
// serveur, affichée UNE seule fois, et seule son empreinte (hash) est stockée.
// Création ouverte pendant la beta privée ; 409 si le canal est pris.
import { json } from "../sync/handler.ts";
import { newKey, sha256Hex } from "../_shared/keys.ts";

export interface RegisterDb {
  channelTaken(channel: string): Promise<boolean>;
  // Stocke l'empreinte de la clé — jamais la clé elle-même.
  createChannel(channel: string, keyHash: string): Promise<{ error: string | null }>;
}

export async function handleRegisterPost(req: Request, db: RegisterDb): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  let b: Record<string, unknown>;
  try { b = await req.json() as Record<string, unknown>; } catch { return json(400, { error: "body" }); }
  const channel = (b.channel as string)?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(channel)) return json(400, { error: "channel" });
  if (await db.channelTaken(channel)) return json(409, { error: "canal déjà pris" });

  const key = newKey();
  const hash = await sha256Hex(key);
  const ins = await db.createChannel(channel, hash);
  // Course entre channelTaken et l'insert : la contrainte UNIQUE(channel) tranche.
  if (ins.error === "taken") return json(409, { error: "canal déjà pris" });
  if (ins.error) return json(500, { error: "db" });
  return json(200, { channel, key });
}
