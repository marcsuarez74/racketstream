import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatScore, handleScoreText, teamName, type Db, type Names, type ScoreRow } from "./handler.ts";

function row(over: Partial<ScoreRow> = {}): ScoreRow {
  return {
    status: "active", currentSet: 2, scoreMe: 5, scoreOpp: 3, setsMe: 1, setsOpp: 0,
    config: { targetScore: 21, winBy: 2, cap: 30, setsToWin: 2 },
    ...over,
  };
}

function makeDb(rows: ScoreRow[], names: Names | null = null): Db {
  return {
    async latestMatch(_channel, activeOnly) {
      return rows.find((r) => !activeOnly || r.status === "active") ?? null;
    },
    async getNames(_channel) {
      return names;
    },
  };
}

function get(url: string, db: Db): Promise<Response> {
  return handleScoreText(new Request(url, { method: "GET" }), db);
}

Deno.test("405 si POST", async () => {
  const res = await handleScoreText(new Request("https://fn.test/score-text", { method: "POST" }), makeDb([]));
  assertEquals(res.status, 405);
});

Deno.test("400 si canal invalide", async () => {
  const res = await get("https://fn.test/score-text?channel=..%2Fetc", makeDb([]));
  assertEquals(res.status, 400);
});

Deno.test("200 + texte du match actif", async () => {
  const res = await get("https://fn.test/score-text?channel=marc", makeDb([row()]));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "MOI 5-3 LUI · SET 2 · Sets 1-0");
});

Deno.test("noms personnalisés via URL", async () => {
  const res = await get("https://fn.test/score-text?channel=marc&name1=Marc&name2=Paul", makeDb([row()]));
  assertEquals(await res.text(), "Marc 5-3 Paul · SET 2 · Sets 1-0");
});

Deno.test("fallback sur le dernier match fini si aucun actif", async () => {
  const res = await get("https://fn.test/score-text", makeDb([row({ status: "match_finished", scoreMe: 21, scoreOpp: 15 })]));
  assertEquals(await res.text(), "MOI 21-15 LUI · SET 2 · Sets 1-0 · Terminé");
});

Deno.test("aucun match : message d'attente", async () => {
  const res = await get("https://fn.test/score-text", makeDb([]));
  assertEquals(await res.text(), "Pas de match en cours");
});

Deno.test("formatScore : ligne complète avec sets", async () => {
  assertEquals(formatScore(row({ setsMe: 2, setsOpp: 1, status: "match_finished", currentSet: 3, scoreMe: 21, scoreOpp: 15 }), "A", "B"),
    "A 21-15 B · SET 3 · Sets 2-1 · Terminé");
});

Deno.test("noms depuis la base si absents de l'URL", async () => {
  const names: Names = { format: "simple", name1: "MARC", name1b: "", name2: "PAUL", name2b: "" };
  const res = await get("https://fn.test/score-text?channel=marc", makeDb([row()], names));
  assertEquals(await res.text(), "MARC 5-3 PAUL · SET 2 · Sets 1-0");
});

Deno.test("double : équipes MARC/JULES vs PAUL/HUGO", async () => {
  const names: Names = { format: "double", name1: "MARC", name1b: "JULES", name2: "PAUL", name2b: "HUGO" };
  const res = await get("https://fn.test/score-text?channel=marc", makeDb([row()], names));
  assertEquals(await res.text(), "MARC/JULES 5-3 PAUL/HUGO · SET 2 · Sets 1-0");
});

Deno.test("mixte : même formatage que le double", async () => {
  const names: Names = { format: "mixte", name1: "MARC", name1b: "JULES", name2: "PAUL", name2b: "HUGO" };
  const res = await get("https://fn.test/score-text?channel=marc", makeDb([row()], names));
  assertEquals(await res.text(), "MARC/JULES 5-3 PAUL/HUGO · SET 2 · Sets 1-0");
});

Deno.test("teamName : pas de slash en simple", async () => {
  assertEquals(teamName("MARC", ""), "MARC");
  assertEquals(teamName("MARC", "JULES"), "MARC/JULES");
});

Deno.test("formatScore padel : points, avantage, tie-break, fin", () => {
  const p = (gamesMe: number, gamesOpp: number, tieBreak: number) => ({ gamesMe, gamesOpp, tieBreak });
  assertEquals(formatScore(row({ scoreMe: 0, scoreOpp: 3, setsMe: 1, setsOpp: 0, padel: p(4, 4, 0) }), "A", "B"),
    "A 0-40 B · Jeux 4-4 · Sets 1-0");
  assertEquals(formatScore(row({ scoreMe: 4, scoreOpp: 3, padel: p(1, 0, 0) }), "A", "B"),
    "A AV-40 B · Jeux 1-0 · Sets 1-0");
  assertEquals(formatScore(row({ scoreMe: 5, scoreOpp: 5, padel: p(6, 6, 0) }), "A", "B"),
    "A 40-40 B · Jeux 6-6 · Sets 1-0");
  assertEquals(formatScore(row({ scoreMe: 5, scoreOpp: 3, padel: p(6, 6, 1) }), "A", "B"),
    "A 5-3 B · Jeux 6-6 · Tie-break · Sets 1-0");
  assertEquals(formatScore(row({ scoreMe: 8, scoreOpp: 9, setsMe: 1, setsOpp: 1, padel: p(0, 0, 2) }), "A", "B"),
    "A 8-9 B · Jeux 0-0 · Super tie-break · Sets 1-1");
  assertEquals(formatScore(row({ status: "match_finished", setsMe: 2, setsOpp: 1, padel: p(0, 0, 0) }), "A", "B"),
    "A 2-1 B · Terminé");
});
