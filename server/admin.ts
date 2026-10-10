// Commandes d'administration, lancées sur le VPS avec la même base que le
// service (scripts/club-invite.sh, scripts/club-key.sh) :
//   deno run … server/admin.ts invite [n]       codes d'invitation club
//   deno run … server/admin.ts club-key <slug>  nouvelle clé club (clé perdue)
// Les codes et clés sont affichés UNE seule fois ; seul leur hash est stocké.
import { openDb, type Store } from "./db.ts";
import { normalizeInvite } from "../supabase/functions/clubs/handler.ts";
import { newKey, sha256Hex } from "../supabase/functions/_shared/keys.ts";

// Sans 0/O, 1/I/L : le code se dicte et se recopie sans erreur.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function inviteCode(): string {
  const out: string[] = [];
  while (out.length < 12) {
    // Tirage par rejet : pas de biais modulo.
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && out.length < 12) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join("").toUpperCase().replace(/(.{4})(?=.)/g, "$1-");
}

export async function createInvites(store: Store, n: number): Promise<string[]> {
  const codes = Array.from({ length: n }, inviteCode);
  const ins = store.sql.prepare("INSERT INTO club_invites (code_hash) VALUES (?)");
  for (const c of codes) ins.run(await sha256Hex(normalizeInvite(c)));
  return codes;
}

// null si le club n'existe pas.
export async function renewClubKey(store: Store, slug: string): Promise<string | null> {
  const key = newKey();
  const r = store.sql.prepare("UPDATE clubs SET club_key_hash = ? WHERE slug = ?").run(await sha256Hex(key), slug);
  return Number(r.changes) === 1 ? key : null;
}

if (import.meta.main) {
  const [cmd, arg] = Deno.args;
  const store = openDb(Deno.env.get("RS_DB") ?? "./racketstream.db");
  try {
    if (cmd === "invite") {
      const n = arg === undefined ? 1 : Number(arg);
      if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error("usage : invite [1-20]");
      for (const c of await createInvites(store, n)) console.log(c);
    } else if (cmd === "club-key" && arg) {
      const key = await renewClubKey(store, arg);
      if (!key) { console.error(`club inconnu : ${arg}`); Deno.exitCode = 1; }
      else console.log(key);
    } else {
      console.error("usage : admin.ts invite [n] | club-key <slug>");
      Deno.exitCode = 2;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    Deno.exitCode = 1;
  } finally {
    store.close();
  }
}
