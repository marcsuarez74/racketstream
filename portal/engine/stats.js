// Statistiques PURES dérivées du journal : port JS de MatchStats.mc (sports à points).
// Journal plat [type, arg, seq, ts, prevMe, prevOpp].
import { ScoreEvent } from "./rules.js";

// [gagnés, joués, série en cours, meilleure série, temps moyen par point (ms)]
export function points(events) {
  let won = 0, n = 0, run = 0, best = 0, firstTs = 0, lastTs = 0;
  for (const e of events) {
    const t = e[0];
    if (t !== ScoreEvent.POINT_ME && t !== ScoreEvent.POINT_OPPONENT) continue;
    if (n === 0) firstTs = e[3];
    lastTs = e[3];
    n += 1;
    if (t === ScoreEvent.POINT_ME) {
      won += 1;
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  // Division entière, comme en Monkey C.
  let avg = n > 1 ? Math.trunc((lastTs - firstTs) / (n - 1)) : 0;
  if (avg < 0) avg = 0;
  return [won, n, run, best, avg];
}

// Sets terminés : [moi, adv, gagnant (-1 = non crédité), début ts, fin ts, 0].
// Début du 1er set = t0 (lancement du match). Un SET_CHANGED juste après un
// SET_FINISHED = « set suivant ».
export function rallySetRows(events, t0) {
  const rows = [];
  let start = t0;
  let afterFinish = false;
  for (const e of events) {
    if (e[0] === ScoreEvent.SET_FINISHED) {
      rows.push([e[4], e[5], e[1], start, e[3], 0]);
      afterFinish = true;
    } else if (e[0] === ScoreEvent.SET_CHANGED) {
      if (!afterFinish) rows.push([e[4], e[5], e[1], start, e[3], 0]);   // changement manuel
      start = e[3];
      afterFinish = false;
    } else if (e[0] !== ScoreEvent.MATCH_FINISHED) {
      afterFinish = false;
    }
  }
  return rows;
}

// Texte d'un set : « 21-18 » (row[5] réservé aux tie-breaks du padel).
export function setText(row) {
  const s = row[0] + "-" + row[1];
  if (row[5] > 0) return s + " (" + (row[5] - 1) + ")";
  if (row[5] < 0) return "[" + s + "]";
  return s;
}

export const setsLine = (rows, sep) => rows.map(setText).join(sep);
