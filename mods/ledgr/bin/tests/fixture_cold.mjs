// The live-shape fixture for retention Phase 2 (cold sessions): store.json as the live store was measured on
// 2026-11-19 after Phase 1 (Retention Phase 2 contract, "Testing against a seam"), synthetic throughout: ids
// cccccccc-00NN-…, padded text, no live content. test_store.mjs builds it (the freeze, the sizes, the round
// trip, the counts and chips); test_writer.mjs can import it for the writer's run on real files.
//   import { liveShape } from "./fixture_cold.mjs";  liveShape({ now }) -> { data, sids: {active, cold, empty}, spec }
// data: a store.json object (v 1, Phase 1 done: `retention.v` 1). Items about 1,000 bytes of JSON each, turn
// records about 315; 1,000 ingested ids; no branches (there are none on the live store). Every session's
// latest time is exactly `now - idle days`, so its idle clock (Store.touchedAt) reads that.

const DAY = 86400e3;
// [items, turn records, idle days, open blocking, needed, optional] (the counts given for the larger sessions
// only). The live list said "7.0" for one session that stays and one that goes: 6.96 and 7.04 here.
export const ACTIVE = [[185, 12, 0.1, 3, 20, 30], [82, 12, 0.1, 1, 6, 10], [50, 12, 0, 0, 17, 24], [36, 12, 0, 0, 8, 7],
  [17, 12, 0, 0, 4, 5], [16, 12, 0, 0, 2, 2], [14, 12, 1.0, 2, 9, 3], [11, 10, 0.9], [11, 12, 6.7], [8, 12, 6.8], [5, 5, 2.6],
  [3, 4, 6.96], [1, 2, 5.7]];
export const COLD = [[34, 12, 8.9, 2, 20, 12], [29, 12, 13.0, 1, 13, 15], [19, 12, 7.04, 2, 10, 7], [16, 12, 8.9, 1, 12, 3],
  [12, 12, 9.0], [11, 12, 7.9], [7, 11, 8.9], [5, 11, 12.1], [4, 9, 14.0], [4, 9, 9.1], [3, 8, 8.7], [2, 8, 8.8], [2, 3, 8.7],
  [2, 1, 7.9], [2, 1, 9.2], [1, 4, 7.1], [1, 2, 10.2], [0, 1, 7.2], [0, 2, 8.8], [0, 3, 13.8]];
// Nine sessions with neither items nor turn records, idle 5 to 10 days: nothing of theirs moves.
export const EMPTY = [5, 5.6, 6.2, 6.9, 7.5, 8.1, 8.7, 9.4, 10];

const WORDS = ["the", "pool", "gateway", "retries", "budget", "client", "worker", "migration", "staging", "cache", "is", "shared", "per", "route"];
const say = (seed, len) => { let s = ""; for (let i = 0; s.length < len; i++) s += `${WORDS[(seed * 7 + i * 3) % WORDS.length]} `; return s.slice(0, len).trim(); };
const hex = (seed, len) => {   // deterministic, distinct per seed
  let x = Math.imul(seed + 1, 2654435761) >>> 0, s = "";
  while (s.length < len) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; s += (x >>> 8).toString(16).padStart(6, "0"); }
  return s.slice(0, len);
};
const sidOf = (k) => `cccccccc-00${String(k).padStart(2, "0")}-4000-8000-${hex(k, 12)}`;
const uuid = (seed) => `${hex(seed, 8)}-${hex(seed + 1, 4)}-4${hex(seed + 2, 3)}-8${hex(seed + 3, 3)}-${hex(seed + 4, 12)}`;

// summaries (2026-11-23, off by default, so every other caller sees the store as before): every third agent ask
// (i % 3 === 1) carries a `summary` (a sentence and a two-line list, about 270 characters), built without touching
// the seed, so every other value is as without it but the quote's padding: the quote pads what is left of
// itemBytes, which a summary on top of these items leaves none of (186 items of about 1.2 KB, the store 0.84 MB
// rather than 0.81).
export function liveShape({ now = 1795100000000, itemBytes = 1000, turnBytes = 315, summaries = false } = {}) {
  const data = { v: 1, items: {}, sessions: {}, branches: {}, terminals: {}, turns: {}, ingested: Array.from({ length: 1000 }, (_, i) => `ev-${uuid(9000 + i * 7)}`),
    forgotten: {}, pins: {}, houseAt: now - 3 * 3600e3, retention: { v: 1, at: now - 2 * DAY } };
  const sids = { active: [], cold: [], empty: [] };
  let seed = 0, k = 0;
  const session = (sid, t, idle, turn) => ({
    sessionId: sid, agent: "claude-code", terminal: `t${k}`, sessionName: `session ${k} ${say(k, 24)}`, cwd: `/Users/x/src/repo-${k}`, repo: `repo-${k}`,
    transcriptPath: `/Users/x/.claude/projects/-Users-x-src-repo-${k}/${sid}.jsonl`, model: "claude-opus-5-5", turn, turnSource: "hooks", state: "idle",
    nextHandle: { A: 1, Q: 1, P: 1 }, startedAt: t - 20 * DAY, updatedAt: t, seenAt: t - 60e3, promptAt: t - 90e3, surfaced: false, lastSource: "startup",
    promptId: uuid(++seed), lastStopAt: t, configDir: "/Users/x/.claude", profile: "default", space: `sp${hex(k, 32)}`,
  });
  const add = (spec, group) => {
    const [nItems, nTurns, idle, blocking = 0, needed = 0, optional = 0] = spec;
    k++;
    const sid = sidOf(k), t = now - Math.round(idle * DAY);
    const s = data.sessions[sid] = session(sid, t, idle, Math.max(nTurns, 1) + 3);
    data.terminals[`t${k}`] = { sessionId: sid, agent: "claude-code", updatedAt: t, space: s.space };
    sids[group].push(sid);
    if (nTurns) {
      const all = data.turns[sid] = {};
      for (let i = 0; i < nTurns; i++) {
        const turn = s.turn - nTurns + 1 + i, at = t - (nTurns - 1 - i) * 600e3;
        all[turn] = { stopAt: at, promptId: uuid(++seed), uuid: uuid(++seed), asks: { source: i % 4 ? "tool" : "model", count: 3, at: at - 5000, ...(i % 4 ? {} : { model: "claude-haiku-5-5" }) },
          passageHash: hex(++seed, 12) };
      }
      // The newest two keep a head (Phase 1), long enough that the session's records average turnBytes.
      const recs = Object.values(all), heads = recs.slice(-2);
      const short = turnBytes * recs.length - recs.reduce((a, r) => a + JSON.stringify(r).length + 14, 0);
      for (const r of heads) r.textHead = say(++seed, Math.max(0, Math.floor(short / heads.length)));
    }
    // Items: the open asks given (blocking, needed, optional), then, in an active session, the rest closed within
    // the last 3 days or answered; in a session to go cold (Phase 1 has archived what closed before), the rest
    // answered asks and open parked questions. Every item's updatedAt at or before t (the newest exactly t).
    const levels = [...Array(blocking).fill("blocking"), ...Array(needed).fill("needed"), ...Array(optional).fill("optional")];
    for (let i = 0; i < nItems; i++) {
      const id = `rq_${uuid(++seed)}`, turn = Math.max(1, s.turn - (i % Math.max(nTurns, 1))), up = i === 0 ? t : t - (i % 40) * 1800e3;
      const lv = levels[i];
      const rest = i - levels.length;
      let status = "open", human = false;
      if (!lv) {
        if (group === "active") status = rest % 4 === 3 ? "answered" : rest % 4 === 2 ? "dismissed" : "resolved";
        else if (rest % 2) { status = "open"; human = true; } else status = "answered";
      }
      const base = human
        ? { id, key: id, handle: `Q${s.nextHandle.Q++}`, direction: "human_to_agent", text: say(++seed, 120), kind: "question",
          anchor: { sessionId: sid, turn, promptId: uuid(++seed), uuid: uuid(++seed), quote: "", quoteSource: "clipboard", hash: hex(++seed, 12), settled: true },
          status, origin: "capture", terminal: `t${k}`, createdTurn: turn, createdAt: up - 3600e3, updatedAt: up, seq: 0 }
        : { id, key: `${sid}|a|${say(seed, 60)}`, handle: `A${s.nextHandle.A++}`, direction: "agent_to_human", text: say(++seed, 160), kind: i % 3 ? "decide" : "do",
          level: lv ?? (i % 2 ? "needed" : "optional"), options: i % 3 ? [] : [say(++seed, 30), say(++seed, 30)], recommended: null, blocking: lv === "blocking",
          anchor: { sessionId: sid, turn, promptId: uuid(++seed), uuid: uuid(++seed), apiMessageId: null, quote: "", quoteSource: "tool", hash: hex(++seed, 12), settled: true },
          status, origin: "tool", terminal: `t${k}`, createdTurn: turn, createdAt: up - 3600e3, updatedAt: up, seq: i % 5,
          ...(status === "answered" ? { answer: say(++seed, 40), answeredTurn: turn + 1 } : {}),
          ...(status === "resolved" || status === "dismissed" ? { resolvedAt: up, resolvedTurn: turn + 1 } : {}) };
      if (summaries && !human && i % 3 === 1) base.summary = `${say(k * 1000 + i, 140)}.\n\n- ${say(k * 1000 + i + 1, 60)}\n- ${say(k * 1000 + i + 2, 60)}`;
      base.anchor.quote = say(++seed, Math.max(0, itemBytes - JSON.stringify(base).length));
      data.items[id] = base;
    }
    // A pin in every fourth session: pins never go cold.
    if (k % 4 === 0) {
      const pid = `pn_${uuid(++seed)}`;
      data.pins[pid] = { id: pid, handle: `P${s.nextHandle.P++}`, sessionId: sid, text: say(++seed, 300), note: null,
        anchor: { sessionId: sid, turn: s.turn, hash: hex(++seed, 12), settled: true }, source: { sessionName: s.sessionName, cwd: s.cwd },
        status: "open", createdAt: t - DAY, updatedAt: t - DAY, usedIn: [], answeredIn: [] };
    }
  };
  for (const x of ACTIVE) add(x, "active");
  for (const x of COLD) add(x, "cold");
  for (const idle of EMPTY) add([0, 0, idle], "empty");
  // The writer's diagnostics (writer.js publish: the last 12 chip values), about 11 KB as measured.
  const chip = Object.fromEntries(sids.active.map((sid, i) => [`t${i + 1}`, { s: sid, q: i % 3, a: 5 + i, st: i % 2 ? "seen" : "surfaced", t: 12, ag: "claude", o: "tool" }]));
  data.diag = { chips: Array.from({ length: 12 }, (_, i) => ({ at: now - (12 - i) * 60e3, by: "my-tabs", chips: chip })) };
  return { data, sids, spec: { ACTIVE, COLD, EMPTY, DAY } };
}
