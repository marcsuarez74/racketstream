// Import Supabase → SQLite (phase 8, tâche 6). Lit les tables via PostgREST
// avec la service role et écrit un fichier .db neuf ou existant, en une
// transaction, de façon idempotente (INSERT OR REPLACE). Les id des devices
// sont conservés ; matches.owner_id est déduit de matches.channel.
//
//   SUPABASE_SERVICE_ROLE_KEY=… deno run --allow-net=bzdbnptnubkkagmmxhyi.supabase.co \
//     --allow-read --allow-write --allow-env server/tools/import-supabase.ts out.db
import { openDb } from "../db.ts";

const BASE = Deno.env.get("SUPABASE_SOURCE_URL") ?? "https://bzdbnptnubkkagmmxhyi.supabase.co";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const out = Deno.args[0];
if (!KEY || !out) {
  console.error("usage : SUPABASE_SERVICE_ROLE_KEY=… import-supabase.ts <sortie.db>");
  Deno.exit(2);
}

type Row = Record<string, unknown>;
const PAGE = 1000;

async function fetchAll(table: string, order: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let off = 0; ; off += PAGE) {
    const res = await fetch(`${BASE}/rest/v1/${table}?select=*&order=${order}&limit=${PAGE}&offset=${off}`, {
      headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) throw new Error(`${table} : HTTP ${res.status}`);
    const page = await res.json() as Row[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

// timestamptz ISO → epoch ms ; nombres laissés tels quels ; null conservé.
function ms(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const t = Date.parse(String(v));
  if (Number.isNaN(t)) throw new Error(`date invalide : ${v}`);
  return t;
}
const jsonText = (v: unknown) => typeof v === "string" ? v : JSON.stringify(v ?? {});

const [devices, matches, events, states, announces] = await Promise.all([
  fetchAll("devices", "id"),
  fetchAll("matches", "match_id"),
  fetchAll("events", "id"),
  fetchAll("match_state", "match_id"),
  fetchAll("chat_announce", "channel"),
]);

// Canaux qui ne diffèrent que par la casse : signalés (pas bloquants, SQLite
// compare en binaire comme Postgres).
const lower = new Map<string, string[]>();
for (const d of devices) {
  const k = String(d.channel).toLowerCase();
  lower.set(k, [...(lower.get(k) ?? []), String(d.channel)]);
}
const caseDup = [...lower.values()].filter((v) => v.length > 1);

const owner = new Map(devices.map((d) => [String(d.channel), Number(d.id)]));
const orphans = matches.filter((m) => !owner.has(String(m.channel)));
if (orphans.length) {
  console.error(`matchs sans canal connu : ${orphans.map((m) => `${m.match_id}(${m.channel})`).join(", ")}`);
  Deno.exit(1);
}

const store = openDb(out);
const q = store.sql;
await store.atomic(async () => {
  const insD = q.prepare(`INSERT OR REPLACE INTO devices
    (id, device_key_hash, channel, label, se_channel_id, se_jwt, format, name1, name1b, name2, name2b, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const d of devices) {
    insD.run(Number(d.id), String(d.device_key_hash), String(d.channel), d.label as string | null,
      d.se_channel_id as string | null, d.se_jwt as string | null, String(d.format ?? "simple"),
      String(d.name1 ?? "MOI"), String(d.name1b ?? ""), String(d.name2 ?? "LUI"), String(d.name2b ?? ""),
      ms(d.created_at) ?? Date.now());
  }
  const insM = q.prepare(`INSERT OR REPLACE INTO matches
    (match_id, owner_id, device_id, channel, config, status, started_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const m of matches) {
    const created = ms(m.created_at) ?? Date.now();
    insM.run(String(m.match_id), owner.get(String(m.channel))!, String(m.device_id ?? ""), String(m.channel),
      jsonText(m.config), String(m.status), ms(m.started_at), created, ms(m.updated_at) ?? created);
  }
  const insE = q.prepare(`INSERT OR REPLACE INTO events
    (id, match_id, sequence, type, arg, prev_me, prev_opp, ts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const e of events) {
    insE.run(String(e.id), String(e.match_id), Number(e.sequence), Number(e.type), Number(e.arg ?? 0),
      e.prev_me as number | null, e.prev_opp as number | null, e.ts as number | null, ms(e.created_at) ?? Date.now());
  }
  const insS = q.prepare(`INSERT OR REPLACE INTO match_state
    (match_id, status, current_set, score_me, score_opp, sets_me, sets_opp, last_sequence, config, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const s of states) {
    insS.run(String(s.match_id), String(s.status), Number(s.current_set), Number(s.score_me), Number(s.score_opp),
      Number(s.sets_me), Number(s.sets_opp), Number(s.last_sequence), jsonText(s.config), ms(s.updated_at) ?? Date.now());
  }
  const insA = q.prepare("INSERT OR REPLACE INTO chat_announce (channel, last_text, updated_at) VALUES (?, ?, ?)");
  for (const a of announces) insA.run(String(a.channel), String(a.last_text), ms(a.updated_at) ?? Date.now());
});

const count = (t: string) => Number((q.prepare(`SELECT count(*) AS n FROM ${t}`).get() as Row).n);
const src: Record<string, number> = {
  devices: devices.length, matches: matches.length, events: events.length,
  match_state: states.length, chat_announce: announces.length,
};
let ok = true;
for (const [t, n] of Object.entries(src)) {
  const m = count(t);
  if (m !== n) ok = false;
  console.log(`${t.padEnd(14)} supabase ${String(n).padStart(5)}   sqlite ${String(m).padStart(5)}${m === n ? "" : "   ≠"}`);
}
if (caseDup.length) console.log(`canaux ne différant que par la casse : ${caseDup.map((v) => v.join("/")).join(", ")}`);
const fk = q.prepare("PRAGMA foreign_key_check").all();
console.log(`clés étrangères : ${fk.length ? `${fk.length} erreur(s)` : "ok"}`);
store.close();
Deno.exit(ok && !fk.length ? 0 : 1);
