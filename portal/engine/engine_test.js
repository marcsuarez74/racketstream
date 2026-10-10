// Tests de parité du moteur JS : chaque test moteur de la montre
// (source/tests/EngineTest.mc, ActivityTest.mc, SyncTest.mc) est porté à
// l'identique (même nom, mêmes assertions), puis des scénarios complets.
// deno test --allow-all portal/engine/
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isSetOver, ScoreEvent, ScorePhase } from "./rules.js";
import * as Sports from "./sports.js";
import { MatchPresets } from "./sports.js";
import { ScoreEngine, server, sideChange } from "./engine.js";
import * as MatchStats from "./stats.js";
import { batchSlice, buildBody, isValidMatchId, MAX_BATCH, newDeviceId, newMatchId, serializeEvent, statusString } from "./sync.js";

// Horloge factice : 1000, 2000, 3000… (la montre utilise System.getTimer()).
function clock() { let t = 0; return () => (t += 1000); }
const mk = (cfg, id = "m1") => new ScoreEngine(cfg, id, clock());

// Compte n points par côté en alternant (helper de test — l'alternance évite
// de déclencher SET_FINISHED prématurément, ex. 11-0 sur le preset 21).
function enginePoints(e, nMe, opp) {
  let i = 0, j = 0;
  while (i < nMe || j < opp) {
    if (i < nMe) { e.pointMe(); i++; }
    if (j < opp) { e.pointOpponent(); j++; }
  }
}

// ---- MatchConfig / presets ----

Deno.test("test_presets_values", () => {
  const c11 = MatchPresets.get(0);
  assertEquals(c11.targetScore, 11, "11 pts target");
  assertEquals(c11.cap, 0, "11 pts sans plafond");
  const c15 = MatchPresets.get(1);
  assertEquals(c15.targetScore, 15, "15 pts target");
  assertEquals(c15.cap, 21, "15 pts cap 21");
  const c21 = MatchPresets.get(2);
  assertEquals(c21.targetScore, 21, "21 pts target");
  assertEquals(c21.cap, 30, "21 pts cap 30");
  assertEquals(MatchPresets.count(), 3, "3 presets");
  assertEquals(c21.winBy, 2, "winBy 2");
  assertEquals(c21.setsToWin, 2, "setsToWin 2");
});

// ---- Rules.isSetOver ----

Deno.test("test_rules_21_points", () => {
  const c = MatchPresets.get(2);
  assertEquals(isSetOver(c, 20, 19), false, "20-19 non fini");
  assertEquals(isSetOver(c, 20, 20), false, "20-20 non fini");
  assertEquals(isSetOver(c, 21, 20), false, "21-20 non fini (deuce)");
  assertEquals(isSetOver(c, 21, 19), true, "21-19 fini");
  assertEquals(isSetOver(c, 29, 29), false, "29-29 non fini");
  assertEquals(isSetOver(c, 30, 29), true, "30-29 fini (cap)");
  assertEquals(isSetOver(c, 19, 21), true, "19-21 fini (adversaire)");
});

Deno.test("test_rules_15_points", () => {
  const c = MatchPresets.get(1);
  assertEquals(isSetOver(c, 14, 14), false, "14-14 non fini");
  assertEquals(isSetOver(c, 15, 14), false, "15-14 non fini (deuce)");
  assertEquals(isSetOver(c, 15, 13), true, "15-13 fini");
  assertEquals(isSetOver(c, 20, 20), false, "20-20 non fini");
  assertEquals(isSetOver(c, 21, 20), true, "21-20 fini (cap 21)");
});

Deno.test("test_rules_11_points", () => {
  const c = MatchPresets.get(0);
  assertEquals(isSetOver(c, 10, 10), false, "10-10 non fini");
  assertEquals(isSetOver(c, 11, 10), false, "11-10 non fini (deuce)");
  assertEquals(isSetOver(c, 11, 9), true, "11-9 fini");
  assertEquals(isSetOver(c, 15, 14), false, "15-14 non fini (sans cap)");
  assertEquals(isSetOver(c, 16, 14), true, "16-14 fini (sans cap, ecart 2)");
});

// ---- ScoreEngine : points + replay + fin de set auto ----

Deno.test("test_engine_initial_state", () => {
  const e = mk(MatchPresets.get(2));
  assertEquals(e.scoreMe, 0, "score me 0-0");
  assertEquals(e.scoreOpp, 0, "score opp 0-0");
  assertEquals(e.setNumber, 1, "set 1");
  assertEquals(e.setsMe, 0, "sets me 0");
  assertEquals(e.setsOpp, 0, "sets opp 0");
  assertEquals(e.phase, 0, "phase PLAYING");
});

Deno.test("test_engine_points_and_replay", () => {
  const e = mk(MatchPresets.get(2));
  e.pointMe();
  assertEquals(e.scoreMe, 1, "1-0 apres POINT_ME");
  e.pointOpponent();
  e.pointOpponent();
  assertEquals(e.scoreMe, 1, "score me 1");
  assertEquals(e.scoreOpp, 2, "1-2 apres 2 POINT_OPPONENT");
  assertEquals(e.events.length, 3, "journal = 3 events");
  assertEquals(e.phase, 0, "toujours PLAYING");
});

Deno.test("test_engine_deuce_21", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 20, 20);
  assertEquals(e.phase, 0, "20-20 pas fini");
  e.pointMe();
  assertEquals(e.scoreMe, 21, "21-20");
  assertEquals(e.phase, 0, "21-20 : set NON fini (deuce)");
});

Deno.test("test_engine_cap_21", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 29, 29);
  e.pointMe();
  assertEquals(e.scoreMe, 30, "30-29");
  assertEquals(e.phase, 1, "cap atteint -> SET_RESULT");
  assertEquals(e.setsMe, 1, "sets 1-0");
});

Deno.test("test_engine_set_finished_normal", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 21, 19);
  assertEquals(e.phase, 1, "21-19 -> SET_RESULT");
  assertEquals(e.setsMe, 1, "sets 1-0");
  assertEquals(e.lastSetScoreMe, 21, "dernier set 21");
  assertEquals(e.lastSetScoreOpp, 19, "dernier set 19");
  assertEquals(e.setNumber, 1, "setNumber toujours 1 tant que pas de transition");
});

Deno.test("test_engine_set_finished_opponent", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 19, 21);
  assertEquals(e.phase, 1, "19-21 -> SET_RESULT");
  assertEquals(e.setsOpp, 1, "sets 0-1");
});

Deno.test("test_engine_deuce_15", () => {
  const e = mk(MatchPresets.get(1));
  enginePoints(e, 14, 14);
  e.pointMe();
  assertEquals(e.scoreMe, 15, "15-14");
  assertEquals(e.phase, 0, "15-14 : set NON fini");
});

Deno.test("test_engine_cap_15", () => {
  const e = mk(MatchPresets.get(1));
  enginePoints(e, 20, 20);
  e.pointMe();
  assertEquals(e.scoreMe, 21, "21-20");
  assertEquals(e.phase, 1, "cap 21 -> SET_RESULT");
});

Deno.test("test_engine_deuce_11", () => {
  const e = mk(MatchPresets.get(0));
  enginePoints(e, 10, 10);
  e.pointMe();
  assertEquals(e.scoreMe, 11, "11-10");
  assertEquals(e.phase, 0, "11-10 : set NON fini");
});

Deno.test("test_engine_no_cap_11", () => {
  const e = mk(MatchPresets.get(0));
  enginePoints(e, 15, 14);
  assertEquals(e.phase, 0, "15-14 non fini (sans plafond)");
  e.pointMe();
  assertEquals(e.scoreMe, 16, "16-14");
  assertEquals(e.phase, 1, "16-14 fini (ecart 2, sans plafond)");
});

Deno.test("test_engine_match_finished_2_sets", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 21, 0);
  e.changeSet();
  enginePoints(e, 21, 0);
  assertEquals(e.setsMe, 2, "sets 2-0");
  assertEquals(e.phase, 2, "MATCH_FINISHED");
  assertEquals(e.events.length, 46, "journal: 42 points + 2 SET_FINISHED + 1 SET_CHANGED + 1 MATCH_FINISHED");
  e.pointMe();   // sans effet : match verrouillé
  assertEquals(e.events.length, 46, "point ignore apres MATCH_FINISHED");
  assertEquals(e.scoreMe, 21, "scores du dernier set figes 21-0");
});

Deno.test("test_engine_manual_set_change_finishes_match", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 21, 0);
  e.changeSet();                    // set 2
  enginePoints(e, 15, 2);
  e.changeSet();                    // changement manuel : leader crédité -> 2-0
  assertEquals(e.setsMe, 2, "sets 2-0 via SET_CHANGED manuel");
  assertEquals(e.phase, 2, "MATCH_FINISHED");
  assertEquals(e.events.length, 42, "journal: 38 points + 1 SET_FINISHED + 2 SET_CHANGED + 1 MATCH_FINISHED");
  e.changeSet();
  assertEquals(e.events.length, 42, "verrou : plus de mutation");
});

// ---- ScoreEngine : transitions de set ----

Deno.test("test_engine_set_result_transition", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 21, 19);
  assertEquals(e.phase, 1, "SET_RESULT apres 21-19");
  e.changeSet();
  assertEquals(e.phase, 0, "PLAYING apres set suivant");
  assertEquals(e.setNumber, 2, "set 2");
  assertEquals(e.scoreMe, 0, "set 2 : 0-0");
  assertEquals(e.scoreOpp, 0, "set 2 : 0-0");
  assertEquals(e.setsMe, 1, "sets 1-0 conserves");
});

Deno.test("test_engine_manual_set_change_leader_credited", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 5, 3);
  e.changeSet();
  assertEquals(e.phase, 0, "PLAYING apres changement manuel");
  assertEquals(e.setNumber, 2, "set 2");
  assertEquals(e.setsMe, 1, "leader (5-3) credite : sets 1-0");
});

Deno.test("test_engine_manual_set_change_tie_not_credited", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 3, 3);
  e.changeSet();
  assertEquals(e.setsMe, 0, "egalite : sets me 0");
  assertEquals(e.setsOpp, 0, "egalite : sets opp 0");
  assertEquals(e.setNumber, 2, "set 2 quand meme");
});

// ---- ScoreEngine : UNDO ----

Deno.test("test_engine_undo_simple", () => {
  const e = mk(MatchPresets.get(2));
  e.pointMe();
  e.undo();
  assertEquals(e.scoreMe, 0, "undo simple : retour 0-0");
  assertEquals(e.scoreOpp, 0, "undo simple : retour 0-0");
  assertEquals(e.phase, 0, "undo simple : PLAYING");
  assertEquals(e.events.length, 0, "journal vide apres undo");
});

Deno.test("test_engine_undo_multi", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 2, 1);
  assertEquals(e.scoreMe, 2, "2-1 avant undo");
  e.undo(); e.undo(); e.undo();
  assertEquals(e.scoreMe, 0, "undo x3 : 0-0");
  assertEquals(e.scoreOpp, 0, "undo x3 : pas de negatif");
  assertEquals(e.events.length, 0, "journal vide");
});

Deno.test("test_engine_undo_empty", () => {
  const e = mk(MatchPresets.get(2));
  e.undo();
  assertEquals(e.scoreMe, 0, "undo vide : 0-0");
  assertEquals(e.events.length, 0, "undo vide : journal intact");
  assertEquals(e.setNumber, 1, "undo vide : set 1");
});

Deno.test("test_engine_undo_match_finished_refused", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 21, 0);
  e.changeSet();
  enginePoints(e, 21, 0);
  assertEquals(e.phase, 2, "MATCH_FINISHED");
  const count = e.events.length;
  e.undo();
  assertEquals(e.events.length, count, "undo refuse sur match fini");
  assertEquals(e.phase, 2, "toujours MATCH_FINISHED");
});

Deno.test("test_engine_undo_set_finished", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 21, 19);
  assertEquals(e.phase, 1, "SET_RESULT apres 21-19");
  assertEquals(e.setsMe, 1, "sets 1-0");
  e.undo();
  assertEquals(e.phase, 0, "set repris : PLAYING");
  assertEquals(e.scoreMe, 21, "score du set restaure : 21");
  assertEquals(e.scoreOpp, 19, "score du set restaure : 19");
  assertEquals(e.setsMe, 0, "sets recalcules : 0-0");
  assertEquals(e.events.length, 40, "journal : 41 - 1");
});

Deno.test("test_engine_undo_set_changed", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 21, 19);
  e.changeSet();
  assertEquals(e.setNumber, 2, "set 2");
  e.undo();
  assertEquals(e.phase, 1, "retour : SET_RESULT");
  assertEquals(e.setNumber, 1, "retour au set 1");
  assertEquals(e.setsMe, 1, "sets 1-0");
  assertEquals(e.lastSetScoreMe, 21, "score du set 1 restaure");
  assertEquals(e.lastSetScoreOpp, 19, "19");
});

// ---- ScoreEngine : protocole d'événements ----

Deno.test("test_engine_events_protocol", () => {
  const e = mk(MatchPresets.get(2));
  e.pointMe(); e.pointOpponent(); e.pointMe();
  assertEquals(e.events.length, 3, "3 events");
  assertEquals(e.eventId(0), "m1:1", "id 1 = m1:1");
  assertEquals(e.eventId(1), "m1:2", "id 2 = m1:2");
  assertEquals(e.eventId(2), "m1:3", "id 3 = m1:3");
  assertEquals(e.events[0][2], 1, "seq 1");
  assertEquals(e.events[1][2], 2, "seq 2");
  assertEquals(e.events[2][2], 3, "seq 3");
  assert(e.events[0][3] > 0, "ts > 0");
  assertEquals(e.events[0][4], 0, "e1 prev me 0");
  assertEquals(e.events[0][5], 0, "e1 prev opp 0");
  assertEquals(e.events[1][4], 1, "e2 prev me 1");
  assertEquals(e.events[1][5], 0, "e2 prev opp 0");
  assertEquals(e.events[2][4], 1, "e3 prev me 1");
  assertEquals(e.events[2][5], 1, "e3 prev opp 1");
  assertEquals(e.scoreMe, 2, "new dernier event : me 2");
  assertEquals(e.scoreOpp, 1, "new dernier event : opp 1");
});

Deno.test("test_engine_events_set_finished_metadata", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 21, 19);
  const n = e.events.length;
  assertEquals(n, 41, "41 events");
  const fin = e.events[n - 1];
  assertEquals(fin[0], ScoreEvent.SET_FINISHED, "dernier = SET_FINISHED");
  assertEquals(fin[2], 41, "seq 41 (les points comptent aussi)");
  assertEquals(fin[4], 21, "prev me 21");
  assertEquals(fin[5], 19, "prev opp 19");
});

Deno.test("test_engine_undo_sequence_monotonic", () => {
  const e = mk(MatchPresets.get(2));
  e.pointMe();
  e.undo();
  e.pointMe();
  assertEquals(e.events.length, 1, "1 event apres undo+nouveau");
  assertEquals(e.events[0][2], 2, "sequence jamais reutilisee : 2, pas 1 (D-2)");
  assertEquals(e.eventId(0), "m1:2", "id m1:2");
});

// ---- ScoreEngine : état de base + restore + purge ----

Deno.test("test_engine_restore_roundtrip", () => {
  const e1 = mk(MatchPresets.get(2));
  enginePoints(e1, 21, 19);
  const e2 = mk(MatchPresets.get(2));
  e2.restore(e1.baseState(), e1.events);
  assertEquals(e2.phase, e1.phase, "restore : phase identique");
  assertEquals(e2.scoreMe, e1.scoreMe, "restore : score me");
  assertEquals(e2.scoreOpp, e1.scoreOpp, "restore : score opp");
  assertEquals(e2.setsMe, e1.setsMe, "restore : sets me");
  assertEquals(e2.setNumber, e1.setNumber, "restore : set number");
  assertEquals(e2.lastSetScoreMe, e1.lastSetScoreMe, "restore : last set me");
  assertEquals(e2.events.length, e1.events.length, "restore : journal");
  e2.undo();
  assertEquals(e2.phase, 0, "restore + undo : set repris (PLAYING)");
  assertEquals(e2.scoreMe, 21, "restore + undo : 21-19");
  assertEquals(e2.setsMe, 0, "restore + undo : sets 0-0");
});

Deno.test("test_engine_restore_then_extend", () => {
  const e1 = mk(MatchPresets.get(2));
  enginePoints(e1, 5, 3);
  const e2 = mk(MatchPresets.get(2));
  e2.restore(e1.baseState(), e1.events);
  e2.pointMe();
  assertEquals(e2.scoreMe, 6, "restore + point : 6-3");
  assertEquals(e2.events.length, 9, "journal 8 + 1");
  assertEquals(e2.eventId(8), "m1:9", "sequence poursuite (9)");
});

Deno.test("test_engine_trim_events", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 21, 0);
  e.changeSet();
  enginePoints(e, 21, 0);
  assertEquals(e.events.length, 46, "46 events avant purge");
  assertEquals(e.setsMe, 2, "sets 2-0");
  e.trimEvents(10);
  assertEquals(e.events.length, 10, "journal purge : 10");
  assertEquals(e.setsMe, 2, "etat derive intact apres purge (sets)");
  assertEquals(e.scoreMe, 21, "etat derive intact apres purge (score)");
  assertEquals(e.phase, 2, "etat derive intact apres purge (phase)");
  assertEquals(e.events[0][2], 37, "premier event retenu : seq 37");
  assertEquals(e.events[9][2], 46, "dernier event : seq 46");
});

Deno.test("test_engine_restore_sequence_monotonic", () => {
  const e1 = mk(MatchPresets.get(2));
  e1.pointMe(); e1.pointOpponent(); e1.pointMe();
  e1.undo();
  assertEquals(e1.lastSequence, 3, "compteur conserve apres undo");
  const e2 = mk(MatchPresets.get(2));
  e2.restore(e1.baseState(), e1.events);
  e2.setLastSequence(e1.lastSequence);
  e2.pointMe();
  assertEquals(e2.events[2][2], 4, "sequence jamais reutilisee apres restore (D-2)");
  assertEquals(e2.eventId(2), "m1:4", "id m1:4");
});

Deno.test("test_engine_undo_after_trim", () => {
  const e = mk(MatchPresets.get(0));
  enginePoints(e, 5, 3);
  e.trimEvents(4);
  assertEquals(e.scoreMe, 5, "etat intact apres purge : 5-3");
  assertEquals(e.scoreOpp, 3, "3");
  e.undo();
  assertEquals(e.scoreMe, 4, "undo apres purge : 4-3");
  assertEquals(e.events.length, 3, "journal 3");
  assertEquals(e.events[0][2], 5, "premier event retenu : seq 5");
});

Deno.test("test_engine_match_locked", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 21, 0);
  e.changeSet();
  enginePoints(e, 21, 0);
  assertEquals(e.phase, 2, "MATCH_FINISHED");
  const count = e.events.length;
  e.changeSet();
  assertEquals(e.events.length, count, "changeSet ignore apres MATCH_FINISHED");
  e.pointMe();
  assertEquals(e.events.length, count, "point ignore apres MATCH_FINISHED");
});

Deno.test("test_engine_new_match_reset", () => {
  const e = mk(MatchPresets.get(2));
  enginePoints(e, 21, 0);
  e.changeSet();
  e.newMatch(MatchPresets.get(0), "m2");
  assertEquals(e.scoreMe, 0, "reset 0-0");
  assertEquals(e.setNumber, 1, "reset set 1");
  assertEquals(e.phase, 0, "reset PLAYING");
  assertEquals(e.events.length, 0, "journal vide");
  assertEquals(e.config.targetScore, 11, "nouvelle config 11 pts");
});

// ---- ActivityTest.mc : sports, undoPoint, stats ----

Deno.test("test_sports_catalogue", () => {
  let c = Sports.config(Sports.BADMINTON, 2);
  assertEquals(c.setsToWin, 1, "set unique 21");
  assertEquals(c.sport, Sports.BADMINTON, "sport porté par la config");
  c = Sports.config(Sports.SQUASH, 0);
  assertEquals(c.setsToWin, 3, "squash 3 jeux gagnants");
  assertEquals(c.cap, 0, "squash sans plafond");
  assertEquals(Sports.formatCount(Sports.PADEL), 4, "4 formats padel");
  assertEquals(Sports.clampFormat(Sports.SQUASH, 3), 0, "format hors bornes");
  assertEquals(Sports.sideAt(Sports.BADMINTON, 1), 8, "côté à 8 en 3 x 15");
});

Deno.test("test_engine_undo_point_fin_de_set", () => {
  const e = mk(Sports.config(Sports.BADMINTON, 0), "U1");
  enginePoints(e, 21, 19);
  e.undoPoint();
  assertEquals(e.phase, ScorePhase.PLAYING, "undo : set repris");
  assertEquals(e.scoreMe, 20, "undo : 20-19");
  e.pointMe();
  e.changeSet();
  e.undoPoint();
  assertEquals(e.phase, ScorePhase.SET_RESULT, "undo du set suivant : fin de set");
});

Deno.test("test_engine_undo_point_fin_de_match", () => {
  const e = mk(Sports.config(Sports.BADMINTON, 2), "U2");
  enginePoints(e, 21, 10);
  assertEquals(e.phase, ScorePhase.MATCH_FINISHED, "match fini");
  e.undo();
  assertEquals(e.phase, ScorePhase.MATCH_FINISHED, "undo() garde le verrou");
  e.undoPoint();
  assertEquals(e.phase, ScorePhase.PLAYING, "undoPoint lève le verrou");
  assertEquals(e.scoreMe, 20, "undoPoint : 20-10");
});

Deno.test("test_match_stats_points_et_series", () => {
  const ev = [[0, 0, 1, 1000, 0, 0], [0, 0, 2, 3000, 1, 0], [1, 0, 3, 5000, 2, 0],
    [0, 0, 4, 7000, 2, 1], [0, 0, 5, 9000, 3, 1], [0, 0, 6, 11000, 4, 1]];
  const p = MatchStats.points(ev);
  assertEquals(p[0], 5, "5 gagnés");
  assertEquals(p[1], 6, "6 joués");
  assertEquals(p[2], 3, "série en cours 3");
  assertEquals(p[3], 3, "meilleure série 3");
  assertEquals(p[4], 2000, "2 s par point");
});

Deno.test("test_match_stats_sets", () => {
  const e = mk(Sports.config(Sports.BADMINTON, 0), "S1");
  enginePoints(e, 21, 15);
  e.changeSet();
  enginePoints(e, 5, 3);
  e.changeSet();
  const rows = e.setRows(0);
  assertEquals(rows.length, 2, "2 sets");
  assertEquals(MatchStats.setText(rows[0]), "21-15", "set 1");
  assertEquals(MatchStats.setText(rows[1]), "5-3", "set manuel");
  assertEquals(rows[1][2], 0, "manuel : leader crédité");
  assertEquals(MatchStats.setsLine(rows, " · "), "21-15 · 5-3", "ligne des sets");
});

// ---- SyncTest.mc : ids et cœur de sync ----

Deno.test("test_matchid_format", () => {
  assert(isValidMatchId(newMatchId()), "format valide");
});

Deno.test("test_matchid_deux_generations_differentes", () => {
  assert(newMatchId() !== newMatchId(), "collision improbable");
});

Deno.test("test_matchid_isvalide_rejete", () => {
  assert(!isValidMatchId("IILOOOXY"), "I/L/O interdits (Crockford)");
  assert(!isValidMatchId("ABC"), "longueur ≠ 8");
  assert(!isValidMatchId(null), "null");
});

Deno.test("test_deviceid_format", () => {
  assert(/^[0-9a-f]{16}$/.test(newDeviceId()), "16 caractères hexadécimaux");
});

const enginePointsMe = (n) => { const e = mk(MatchPresets.get(2), "T1"); for (let i = 0; i < n; i++) e.pointMe(); return e; };

Deno.test("test_core_batchslice_premier_batch", () => {
  const batch = batchSlice(enginePointsMe(8).events, 1, 5);
  assertEquals(batch.length, 5, "attendu 5");
  assertEquals([batch[0][2], batch[4][2]], [1, 5], "seqs 1..5 attendues");
});

Deno.test("test_core_batchslice_deuxieme_batch", () => {
  const batch = batchSlice(enginePointsMe(8).events, 6, 5);
  assertEquals(batch.length, 3, "attendu 3");
  assertEquals([batch[0][2], batch[2][2]], [6, 8], "seqs 6..8 attendues");
});

Deno.test("test_core_batchslice_pf_deja_purge", () => {
  assertEquals(batchSlice(enginePointsMe(4).events, 50, 5).length, 0, "attendu vide");
});

Deno.test("test_core_serialize_event", () => {
  assertEquals(serializeEvent([0, 0, 7, 123, 2, 1]), { type: 0, arg: 0, sequence: 7, ts: 123, prevMe: 2, prevOpp: 1 });
});

Deno.test("test_core_buildbody", () => {
  const engine = enginePointsMe(3);
  const body = buildBody(engine, "dev123", batchSlice(engine.events, 1, 5));
  const snap = body.snapshot;
  assertEquals(body.deviceId, "dev123");
  assertEquals([snap.status, snap.scoreMe, snap.scoreOpp], ["active", 3, 0]);
  assertEquals([snap.currentSet, snap.setsMe, snap.setsOpp], [1, 0, 0]);
  assertEquals(snap.lastSequence, 3);
  assertEquals(body.config.targetScore, 21);
  assertEquals(body.events.length, 3);
  assertEquals(body.stop, undefined, "pas de stop par défaut");
});

Deno.test("test_core_snapshot_match_finished", () => {
  const e = mk(MatchPresets.get(2), "T1");
  for (let i = 0; i < 21; i++) e.pointMe();
  e.changeSet();
  for (let i = 0; i < 21; i++) e.pointMe();
  assertEquals(statusString(e.phase), "match_finished");
});

// ---- Scénarios complets (au-delà des tests montre) ----

Deno.test("scénario : prolongations 20-20 → 29-29 → 30", () => {
  const e = mk(Sports.config(Sports.BADMINTON, 0));
  enginePoints(e, 20, 20);
  for (let i = 0; i < 9; i++) {           // 21-20, 21-21, … jusqu'à 29-29
    e.pointMe();
    assertEquals(e.phase, ScorePhase.PLAYING, `${e.scoreMe}-${e.scoreOpp} : écart 1, set en cours`);
    e.pointOpponent();
    assertEquals(e.phase, ScorePhase.PLAYING, `${e.scoreMe}-${e.scoreOpp} : égalité, set en cours`);
  }
  assertEquals([e.scoreMe, e.scoreOpp], [29, 29]);
  e.pointOpponent();                       // 29-30 : plafond, l'adversaire gagne le set
  assertEquals(e.phase, ScorePhase.SET_RESULT, "30 = plafond");
  assertEquals([e.setsMe, e.setsOpp], [0, 1]);
  assertEquals([e.lastSetScoreMe, e.lastSetScoreOpp], [29, 30]);
  e.pointMe();                             // ignoré hors PLAYING
  assertEquals(e.scoreMe, 29, "point ignoré en SET_RESULT");
});

Deno.test("scénario : undo à travers un changement de set (montre/JS identiques)", () => {
  const e = mk(Sports.config(Sports.BADMINTON, 0));
  enginePoints(e, 21, 17);                 // set 1 : 21-17
  e.changeSet();
  e.pointOpponent();                       // set 2 : 0-1
  assertEquals(server(e), 1, "l'adversaire sert après avoir marqué");
  e.undoPoint();                           // retire le point du set 2
  assertEquals([e.setNumber, e.scoreMe, e.scoreOpp], [2, 0, 0]);
  assertEquals(server(e), 0, "nouveau set : moi au service");
  e.undoPoint();                           // retire le « set suivant »
  assertEquals(e.phase, ScorePhase.SET_RESULT);
  assertEquals(e.setNumber, 1);
  e.undoPoint();                           // retire la fin de set ET le point gagnant
  assertEquals(e.phase, ScorePhase.PLAYING);
  assertEquals([e.scoreMe, e.scoreOpp, e.setsMe], [20, 17, 0]);
  e.pointMe();                             // rejoué : séquence neuve, jamais réutilisée
  const fin = e.events[e.events.length - 1];
  assertEquals(fin[0], ScoreEvent.SET_FINISHED);
  assert(fin[2] > 41, "séquence monotone après les undo");
});

Deno.test("scénario : squash complet (meilleur des 5, 3-1)", () => {
  const e = mk(Sports.config(Sports.SQUASH, 0));
  const jeu = (me, opp) => { enginePoints(e, me, opp); if (e.phase === ScorePhase.SET_RESULT) e.changeSet(); };
  jeu(11, 9);
  jeu(7, 11);
  enginePoints(e, 12, 12);                 // pas de plafond au squash
  assertEquals(e.phase, ScorePhase.PLAYING, "12-12 : on continue");
  e.pointMe(); e.pointMe();                // 14-12
  assertEquals(e.phase, ScorePhase.SET_RESULT);
  e.changeSet();
  assertEquals([e.setsMe, e.setsOpp, e.setNumber], [2, 1, 4]);
  enginePoints(e, 11, 5);
  assertEquals(e.phase, ScorePhase.MATCH_FINISHED);
  assertEquals([e.setsMe, e.setsOpp], [3, 1]);
  assertEquals(MatchStats.setsLine(e.setRows(0), " · "), "11-9 · 7-11 · 14-12 · 11-5");
  const body = buildBody(e, "dev", batchSlice(e.events, e.lastSequence - 1));
  assertEquals(body.config, { targetScore: 11, winBy: 2, cap: 0, setsToWin: 3, sport: "squash" });
  assertEquals(body.snapshot.status, "match_finished");
  assertEquals(Sports.setWord(Sports.SQUASH), "JEU");
  assertEquals(sideChange(e, Sports.SQUASH, 0), false, "pas de changement de côté au squash");
});

Deno.test("scénario : fin de match, nouveau match et arrêt (stop)", () => {
  const e = mk(Sports.config(Sports.BADMINTON, 1));        // 3 × 15
  enginePoints(e, 15, 10);
  e.changeSet();
  enginePoints(e, 10, 15);
  e.changeSet();
  enginePoints(e, 7, 7);
  e.pointMe();                             // 8-7 dans le set décisif
  assert(sideChange(e, Sports.BADMINTON, 1), "changement de côté à 8 en 3 × 15");
  e.pointOpponent();                       // 8-8 : plus d'annonce
  assert(!sideChange(e, Sports.BADMINTON, 1));
  enginePoints(e, 7, 3);                   // 15-11
  assertEquals(e.phase, ScorePhase.MATCH_FINISHED);
  assertEquals(e.events[e.events.length - 1][0], ScoreEvent.MATCH_FINISHED);
  // Le serveur accepte au plus 10 events par envoi.
  const all = [];
  for (let from = 1; ;) {
    const b = batchSlice(e.events, from);
    if (b.length === 0) break;
    assert(b.length <= MAX_BATCH);
    all.push(...b);
    from = b[b.length - 1][2] + 1;
  }
  assertEquals(all.length, e.events.length, "tout le journal part en lots");
  const stop = buildBody(e, "dev", [], true);
  assertEquals([stop.stop, stop.events.length], [true, 0], "stop : 0 event, match archivé");
  e.newMatch(Sports.config(Sports.BADMINTON, 0), newMatchId());
  assertEquals([e.phase, e.lastSequence, e.events.length], [ScorePhase.PLAYING, 0, 0]);
});

Deno.test("persistance : toJSON / fromJSON reprend le match à l'identique", () => {
  const e1 = mk(Sports.config(Sports.BADMINTON, 0));
  enginePoints(e1, 21, 12);
  e1.changeSet();
  enginePoints(e1, 4, 6);
  e1.undo();                               // compteur (lastSequence) en avance sur le journal
  const e2 = ScoreEngine.fromJSON(JSON.parse(JSON.stringify(e1)), clock());
  assertEquals([e2.phase, e2.scoreMe, e2.scoreOpp, e2.setsMe, e2.setNumber],
    [e1.phase, e1.scoreMe, e1.scoreOpp, e1.setsMe, e1.setNumber]);
  assertEquals(e2.startedAtMs, e1.startedAtMs);
  e2.pointMe();
  assertEquals(e2.events[e2.events.length - 1][2], e1.lastSequence + 1, "séquence poursuivie sans réutilisation");
});

Deno.test("padel non pris en charge par le moteur web", () => {
  assertThrows(() => Sports.config(Sports.PADEL, 0));
  assertEquals(Sports.WEB_SPORTS, [Sports.BADMINTON, Sports.SQUASH]);
});
