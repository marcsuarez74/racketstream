import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleRegisterPost, type RegisterDb } from "./handler.ts";

// Service role : insertion devices (canal + empreinte de clé) — table sans
// accès anon (le hash ne doit jamais sortir).
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const db: RegisterDb = {
  async channelTaken(channel) {
    const { data } = await supabase.from("devices").select("id").eq("channel", channel).maybeSingle();
    return data != null;
  },
  async createChannel(channel, keyHash) {
    const { error } = await supabase.from("devices").insert({ channel, device_key_hash: keyHash });
    if (error?.code === "23505") return { error: "taken" };
    return { error: error ? String(error.message) : null };
  },
};

// CORS : la page portail (GitHub Pages) appelle cross-origin.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const res = await handleRegisterPost(req, db);
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
});
