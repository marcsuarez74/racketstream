// Commandes d'administration, lancées sur le VPS avec la même base que le
// service (scripts/club-invite.sh, scripts/club-key.sh) :
//   deno run … server/admin.ts invite [n]       codes d'invitation club
//   deno run … server/admin.ts club-key <slug>  nouvelle clé club (clé perdue)
//   deno run … server/admin.ts purge            durées de conservation (timer quotidien)
//   deno run … server/admin.ts delete-channel <canal> | delete-club <slug>
//                                               effacement sur demande (RGPD)
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

// Durées annoncées dans portal/confidentialite.html (§ 4) : à modifier ensemble.
const DAY = 86_400_000;
export const MATCH_RETENTION_MS = 365 * DAY;   // points et résultats : 12 mois
export const CHANNEL_IDLE_MS = 730 * DAY;      // canal perso sans match : 24 mois

function deleteMatches(store: Store, where: string, ...args: (string | number)[]): number {
  const ids = `SELECT match_id FROM matches WHERE ${where}`;
  store.sql.prepare(`DELETE FROM events WHERE match_id IN (${ids})`).run(...args);
  store.sql.prepare(`DELETE FROM match_state WHERE match_id IN (${ids})`).run(...args);
  return Number(store.sql.prepare(`DELETE FROM matches WHERE ${where}`).run(...args).changes);
}

// Supprime un canal et tout ce qui s'y rattache (matchs, points, dernière annonce).
function deleteDevice(store: Store, id: number, channel: string) {
  deleteMatches(store, "owner_id = ?", id);
  store.sql.prepare("DELETE FROM chat_announce WHERE channel = ?").run(channel);
  store.sql.prepare("DELETE FROM devices WHERE id = ?").run(id);
}

export function purge(store: Store, now = Date.now()) {
  return store.atomic(() => {
    const cutoff = now - MATCH_RETENTION_MS;
    const matches = deleteMatches(store, "updated_at < ?", cutoff);
    store.sql.prepare("DELETE FROM chat_announce WHERE updated_at < ?").run(cutoff);
    // Les terrains d'un club suivent le club : seuls les canaux perso expirent.
    const idle = store.sql.prepare(
      `SELECT id, channel FROM devices d WHERE club_id IS NULL AND created_at < ?
         AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.owner_id = d.id AND m.updated_at >= ?)`,
    ).all(now - CHANNEL_IDLE_MS, now - CHANNEL_IDLE_MS) as { id: number; channel: string }[];
    for (const d of idle) deleteDevice(store, d.id, d.channel);
    return Promise.resolve({ matches, channels: idle.length });
  });
}

// false si le canal n'existe pas.
export function deleteChannel(store: Store, channel: string) {
  return store.atomic(() => {
    const d = store.sql.prepare("SELECT id, channel FROM devices WHERE channel = ?").get(channel) as
      | { id: number; channel: string } | undefined;
    if (d) deleteDevice(store, d.id, d.channel);
    return Promise.resolve(!!d);
  });
}

// Le club, ses terrains et leurs matchs ; les codes d'invitation utilisés
// restent (hash seul) pour ne pas pouvoir resservir. false si club inconnu.
export function deleteClub(store: Store, slug: string) {
  return store.atomic(() => {
    const c = store.sql.prepare("SELECT id FROM clubs WHERE slug = ?").get(slug) as { id: number } | undefined;
    if (!c) return Promise.resolve(false);
    const terrains = store.sql.prepare("SELECT id, channel FROM devices WHERE club_id = ?").all(c.id) as
      { id: number; channel: string }[];
    for (const d of terrains) deleteDevice(store, d.id, d.channel);
    store.sql.prepare("UPDATE club_invites SET club_id = NULL WHERE club_id = ?").run(c.id);
    store.sql.prepare("DELETE FROM clubs WHERE id = ?").run(c.id);
    return Promise.resolve(true);
  });
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
    } else if (cmd === "purge") {
      const r = await purge(store);
      console.log(`purge : ${r.matches} match(s), ${r.channels} canal(aux) inactif(s) supprimés`);
    } else if ((cmd === "delete-channel" || cmd === "delete-club") && arg) {
      const ok = cmd === "delete-channel" ? await deleteChannel(store, arg) : await deleteClub(store, arg);
      if (!ok) { console.error(`introuvable : ${arg}`); Deno.exitCode = 1; }
      else console.log(`supprimé : ${arg}`);
    } else {
      console.error("usage : admin.ts invite [n] | club-key <slug> | purge | delete-channel <canal> | delete-club <slug>");
      Deno.exitCode = 2;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    Deno.exitCode = 1;
  } finally {
    store.close();
  }
}
