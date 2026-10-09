// Edge Function score-text — logique pure testable (Db injecté), même
// discipline que sync (ADR-007). Lecture seule publique (RLS SELECT anon) :
// renvoie le score du match actif le plus récent du canal, en texte pour un
// bot Twitch (commande custom API de StreamElements/Nightbot).
export interface ScoreRow {
  status: string;
  currentSet: number;
  scoreMe: number;
  scoreOpp: number;
  setsMe: number;
  setsOpp: number;
  config: { targetScore: number; winBy: number; cap: number; setsToWin: number; sport?: string; deuce?: number } | null;
  // Phase 9 : état padel envoyé par la montre (snapshot.padel). Absent pour
  // le badminton/squash et pour les montres 0.2.x.
  padel?: PadelSnapshot | null;
}

export interface PadelSnapshot {
  gamesMe: number;
  gamesOpp: number;
  tieBreak: number; // 0 = jeu normal, 1 = tie-break, 2 = super tie-break
}

// Points d'un jeu de padel (miroir de PadelRules.labels côté montre) :
// 0/15/30/40, AV en avantages, 40-40 sinon ; en tie-break, points bruts.
export function padelPoints(a: number, b: number, tieBreak: number): [string, string] {
  if (tieBreak > 0) return [String(a), String(b)];
  if (a >= 3 && b >= 3) {
    if (a === b) return ["40", "40"];
    return a > b ? ["AV", "40"] : ["40", "AV"];
  }
  const pts = ["0", "15", "30", "40"];
  return [pts[a] ?? String(a), pts[b] ?? String(b)];
}

export interface Db {
  // Match actif le plus récent du canal ; fallback : le plus récent tout statut.
  latestMatch(channel: string, activeOnly: boolean): Promise<ScoreRow | null>;
  // Réglages d'affichage du canal (format + noms) ; null si canal inconnu.
  getNames(channel: string): Promise<Names | null>;
}

export interface Names {
  format: string;
  name1: string;
  name1b: string;
  name2: string;
  name2b: string;
}

// "MARC/JULES" en double-mixte, "MARC" en simple.
export function teamName(a: string, b: string): string {
  return b ? `${a}/${b}` : a;
}

export function plain(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function normalizeSet(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

// "Marc 5-3 Paul · SET 2 · Sets 1-0" — compact, lisible dans un chat Twitch.
// Padel : "Marc 30-15 Paul · Jeux 3-2 · Sets 1-0" (TB : "· Tie-break").
export function formatScore(row: ScoreRow, name1: string, name2: string): string {
  const sets = `Sets ${row.setsMe}-${row.setsOpp}`;
  const p = row.padel;
  if (p && row.status !== "match_finished") {
    const [a, b] = padelPoints(row.scoreMe, row.scoreOpp, p.tieBreak);
    const tb = p.tieBreak === 2 ? " · Super tie-break" : (p.tieBreak === 1 ? " · Tie-break" : "");
    return `${name1} ${a}-${b} ${name2} · Jeux ${p.gamesMe}-${p.gamesOpp}${tb} · ${sets}`;
  }
  if (p) return `${name1} ${row.setsMe}-${row.setsOpp} ${name2} · Terminé`;
  const base = `${name1} ${row.scoreMe}-${row.scoreOpp} ${name2} · SET ${row.currentSet} · ${sets}`;
  return row.status === "match_finished" ? `${base} · Terminé` : base;
}

export async function handleScoreText(req: Request, db: Db): Promise<Response> {
  if (req.method !== "GET") return plain(405, "method");
  const u = new URL(req.url);
  const channel = (u.searchParams.get("channel") || "marc").slice(0, 32);
  if (!/^[A-Za-z0-9_-]+$/.test(channel)) return plain(400, "channel");
  // Noms : URL d'abord (compat StreamElements sans &), sinon réglages du
  // canal en base — c'est ce qui permet de changer d'adversaire en plein
  // tournoi depuis la page portail.
  let name1 = u.searchParams.get("name1");
  let name2 = u.searchParams.get("name2");
  if (name1 == null || name2 == null) {
    const cfg = await db.getNames(channel);
    name1 = name1 ?? teamName(cfg?.name1 ?? "MOI", cfg?.name1b ?? "");
    name2 = name2 ?? teamName(cfg?.name2 ?? "LUI", cfg?.name2b ?? "");
  } else {
    name1 = name1.slice(0, 24);
    name2 = name2.slice(0, 24);
  }

  const active = await db.latestMatch(channel, true);
  if (active) {
    const sane = [active.currentSet, active.scoreMe, active.scoreOpp, active.setsMe, active.setsOpp].every((v) => v !== null);
    if (sane) return plain(200, formatScore(active as ScoreRow, name1, name2));
  }
  const any = await db.latestMatch(channel, false);
  if (any) {
    const sane = [any.currentSet, any.scoreMe, any.scoreOpp, any.setsMe, any.setsOpp].every((v) => v !== null);
    if (sane) return plain(200, formatScore(any as ScoreRow, name1, name2));
  }
  return plain(200, "Pas de match en cours");
}

// Garde-fou de forme utilisé par les tests : rejette les lignes incomplètes.
export function isValidRow(r: Record<string, unknown>): boolean {
  return normalizeSet(r.currentSet) !== null && normalizeSet(r.scoreMe) !== null &&
         normalizeSet(r.scoreOpp) !== null && normalizeSet(r.setsMe) !== null &&
         normalizeSet(r.setsOpp) !== null && typeof r.status === "string";
}
