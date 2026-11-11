// ledgr list unit test (docs/design/Detail.md 6.1): listing.js, the panel's one-line rows and its keyboard
// cursor. firstLine; glyphOf for every status; stateOf for every row of 1.3, each kind, the first match
// winning; rowModel's handle, pill, text, quick actions and tooltip; entryKey; moveCursor and keepPlace.
// Then, as text: listing.js is pure (no herdr, no gpui), reader.js holds every Reader member of 5.2, and
// panel.js extends Reader, defines no `stage` of its own and opens the dialog with detailSpec.
// Pure: no Herdr window, no files outside a temp folder.
//   node tests/test_list.mjs                 (builds its own scratch folder with a stub `herdr`)
//   node tests/test_list.mjs <folder>        (a folder holding the modules and node_modules/herdr)
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(HERE, "../..");                 // mods/ledgr (repo or live install)
const FILES = ["listing.js", "words.js", "store.js", "config.js", "branch.js", "confluence.js"];
let dir = process.argv[2] ?? null, own = false;
if (!dir) {
  own = true;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgr-list."));
  for (const f of FILES) fs.copyFileSync(path.join(MOD, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, "node_modules/herdr"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules/herdr/package.json"), '{"name":"herdr","type":"module","main":"index.js"}');
  fs.writeFileSync(path.join(dir, "node_modules/herdr/index.js"), [
    "export const appHome = () => \"/tmp/nowhere\";", "export const readTextFile = async () => null;", "export const layout = () => null;",
    "export const run = () => null;", "export const shared = () => null;", "export const agents = () => [];", "export const terminals = () => [];",
    "export const focused = () => null;",
  ].join("\n"));
}

let checks = 0;
const A = new Proxy(assert, { get: (t, k) => (...a) => { checks++; return t[k](...a); } });
const src = (f) => fs.readFileSync(path.join(MOD, f), "utf8");
try {
  const LS = await import(`${dir}/listing.js`);
  const { Store } = await import(`${dir}/store.js`);

  // ── fixtures ─────────────────────────────────────────────────────────────
  const SID = "aaaaaaaa-1111-4222-8333-000000000001", NOW = new Date(2026, 10, 10, 12, 0).getTime(), DAY = 86400e3;
  const ask = (handle, o = {}) => ({ id: `rq_${handle.toLowerCase()}`, handle, direction: "agent_to_human", kind: "decide", status: "open", level: "needed",
    text: `Ask text ${handle}`, anchor: { sessionId: SID, turn: 7, quote: `the quote of ${handle}`, settled: true }, ...o });
  const q = (handle, o = {}) => ({ id: `rq_${handle.toLowerCase()}`, handle, direction: "human_to_agent", kind: "question", status: "open",
    text: `Question text ${handle}`, anchor: { sessionId: SID, turn: 7, settled: true }, ...o });
  const pin = (handle, o = {}) => ({ id: `pn_test-pin-000${handle.slice(1)}`, handle, sessionId: SID, status: "open", text: `Pinned passage ${handle}`, note: null,
    anchor: { sessionId: SID, turn: 5, verified: "turn" }, createdAt: NOW - 3 * DAY, usedIn: [], answeredIn: [], ...o });
  const items = {};
  const add = (it) => { items[it.id] = it; return it; };
  const qBr = add(q("Q1")), qDefBr = add(q("Q2", { status: "deferred" })), qBrBlocked = add(q("Q3")), qBrFailed = add(q("Q4"));
  const qSent = add(q("Q5", { askedAtTurn: 9 })), qPins = add(q("Q6", { pins: ["pn_test-pin-0001", "pn_test-pin-0002"], pinsAsked: { turn: 9, at: NOW } }));
  const branches = {
    br_1: { id: "br_1", requestId: qBr.id, parentSessionId: SID, name: "br-q1-aaaa", status: "running", live: "working", createdAt: NOW - 1000 },
    br_2: { id: "br_2", requestId: qDefBr.id, parentSessionId: SID, name: "br-q2-bbbb", status: "running", live: "idle", createdAt: NOW - 1000 },
    br_3: { id: "br_3", requestId: qBrBlocked.id, parentSessionId: SID, name: "br-q3-cccc", status: "running", live: "blocked", createdAt: NOW - 1000 },
    br_4a: { id: "br_4a", requestId: qBrFailed.id, parentSessionId: SID, name: "br-q4-dddd", status: "failed", live: "failed", createdAt: NOW - 500 },
    br_4b: { id: "br_4b", requestId: qBrFailed.id, parentSessionId: SID, name: "br-q4-eeee", status: "concluded", live: "concluded", createdAt: NOW - 2000 },
  };
  const pins = {};
  for (const p of [pin("P1"), pin("P2")]) pins[p.id] = p;
  const st = new Store({ v: 1, items, sessions: { [SID]: { sessionId: SID, terminal: "t3", turn: 9 } }, branches, pins });
  const ctx = { threshold: "needed", now: NOW, here: SID, store: st, branchLive: (b) => b.live ?? b.status };
  const S = (kind, x, c = ctx) => LS.stateOf(kind, x, c);
  const W = (kind, x, c) => { const r = S(kind, x, c); return `${r.word}|${r.tone}`; };

  // ── firstLine ────────────────────────────────────────────────────────────
  A.equal(LS.firstLine("\n\n   \n  Hello   there\tworld  \nsecond line"), "Hello there world", "the first non-empty line, whitespace collapsed");
  A.equal(LS.firstLine(""), ""); A.equal(LS.firstLine(null), ""); A.equal(LS.firstLine("   \n \n"), "");
  A.equal(LS.firstLine("x".repeat(160)), "x".repeat(160), "160 characters stay whole");
  const long = LS.firstLine("word ".repeat(60));
  A.equal(long.length, 160, "cut at 160 with the ellipsis inside"); A.ok(long.endsWith("…"));
  A.equal(LS.firstLine("abcdefghij", 5), "abcd…", "n given");

  // ── glyphOf ──────────────────────────────────────────────────────────────
  const G = (it, sug) => LS.glyphOf(it, sug).join("|");
  A.equal(G(ask("A1")), "●|accent", "open");
  A.equal(G(ask("A1", { status: "answered" })), "◐|accent");
  A.equal(G(ask("A1", { status: "resolved" })), "✓|done");
  A.equal(G(ask("A1", { status: "dismissed" })), "✕|dim");
  A.equal(G(ask("A1", { status: "deferred" })), "◷|muted");
  A.equal(G(q("Q1", { status: "rejoin_pending" })), "↩|accent");
  A.equal(G(ask("A1", { status: "weird" })), "·|dim", "an unknown status");
  A.equal(G(q("Q1", { anchor: { sessionId: SID, turn: 7, settled: false } })), "○|dim", "a question still anchoring");
  A.equal(G(ask("A1", { level: "blocking" })), "◆|blocked", "an open blocking ask");
  A.equal(G(ask("A1", { level: "blocking", status: "resolved" })), "✓|done", "a closed blocking ask is just closed");
  A.equal(G(ask("A1", { level: "optional" }), true), "○|dim", "a suggestion: hollow");
  A.equal(G(ask("A1", { level: "optional", status: "answered" }), true), "◐|accent", "a suggestion answered keeps its status glyph");

  // ── stateOf: asks ────────────────────────────────────────────────────────
  A.equal(W("ask", ask("A1", { status: "resolved", resolvedBy: "answer" })), "answered by you|done");
  A.equal(W("ask", ask("A1", { status: "resolved", resolvedBy: "agent" })), "closed by agent|done");
  A.equal(W("ask", ask("A1", { status: "resolved", resolvedBy: "branch" })), "resolved by branch|done");
  A.equal(W("ask", ask("A1", { status: "resolved" })), "done|done");
  A.equal(W("ask", ask("A1", { status: "dismissed", dismissedBy: "clear" })), "cleared|dim");
  A.equal(W("ask", ask("A1", { status: "dismissed" })), "not needed|dim");
  A.equal(W("ask", ask("A1", { status: "deferred", draft: "yes" })), "deferred|muted", "deferred wins over a draft");
  A.equal(W("ask", ask("A1", { status: "answered", draft: "yes" })), "answered|accent", "the sheet landed");
  A.equal(W("ask", ask("A1", { level: "optional", draft: "yes", repeatOf: "rq_x" })), "below threshold|dim", "below the threshold wins over a draft");
  A.equal(W("ask", ask("A1", { level: "optional" }), { ...ctx, threshold: "optional" }), "open|accent", "the same ask at threshold optional is an open row");
  A.equal(W("ask", ask("A1", { draft: "  fast  ", repeatOf: "rq_x" })), "answer ready|accent", "a draft wins over raised again");
  A.equal(W("ask", ask("A1", { draft: "   " })), "open|accent", "a blank draft is no answer");
  A.equal(W("ask", ask("A1", { repeatOf: "rq_x" })), "raised again|accent");
  A.equal(W("ask", ask("A1", { level: "blocking" })), "open|blocked", "open blocking");
  A.equal(W("ask", ask("A1", { blocking: true, level: undefined })), "open|blocked", "a legacy blocking: true");
  A.equal(W("ask", ask("A1")), "open|accent");
  A.equal(W("item", ask("A1")), "open|accent", "kind item resolves an ask by its direction");

  // ── stateOf: questions ───────────────────────────────────────────────────
  A.equal(W("question", q("Q9", { status: "resolved", resolvedBy: "branch" })), "resolved by branch|done");
  A.equal(W("question", q("Q9", { status: "resolved", resolvedBy: "agent" })), "done|done", "a question has no closed-by-agent word");
  A.equal(W("question", q("Q9", { status: "resolved" })), "done|done");
  A.equal(W("question", q("Q9", { status: "dismissed", dismissedBy: "clear" })), "cleared|dim");
  A.equal(W("question", q("Q9", { status: "dismissed" })), "not needed|dim");
  A.equal(W("question", qDefBr), "deferred|muted", "a deferred question with a branch is deferred");
  A.equal(W("question", { ...qBr, status: "rejoin_pending" }), "rejoining|accent", "rejoining wins over its branch");
  A.equal(W("question", { ...qBr, status: "answered" }), "answered|accent", "answered wins over its branch");
  A.equal(W("question", qBr), "branch working|working", "its branch working");
  A.equal(W("question", qBrBlocked), "branch needs you|blocked", "its branch blocked");
  A.equal(W("question", { ...qBr }, { ...ctx, branchLive: () => "idle" }), "branch idle|accent");
  A.equal(W("question", qBrFailed), "branch concluded|accent", "a failed branch is passed over for the next one");
  A.equal(W("question", { ...qBr, askedAtTurn: 9 }), "branch working|working", "a branch wins over sent");
  A.equal(W("question", qSent), "sent at turn 9|muted");
  A.equal(W("question", q("Q9", { anchor: { sessionId: SID, turn: 7, settled: false } })), "anchoring|dim");
  A.equal(W("question", q("Q9")), "parked|accent");
  A.equal(W("question", q("Q9"), { threshold: "needed" }), "parked|accent", "no store in ctx: no branch looked up");

  // ── stateOf: pins ────────────────────────────────────────────────────────
  A.equal(W("pin", pin("P7", { status: "archived", answeredIn: [{ question: qPins.id }] })), "archived|dim", "archived first");
  A.equal(W("pin", pin("P7", { answeredIn: [{ question: qPins.id }], usedIn: [{ question: qPins.id }] })), "answered|done");
  A.equal(W("pin", pin("P7", { usedIn: [{ question: qSent.id }, { question: qPins.id }] })), "sent|muted", "a question it was used in has pinsAsked");
  A.equal(W("pin", pin("P7", { usedIn: [{ question: qSent.id }] })), "used|muted");
  A.equal(W("pin", pin("P7", { usedIn: [{ question: "rq_gone" }] })), "used|muted", "a question no longer in the store");
  A.equal(W("pin", pin("P7", { anchor: { sessionId: SID, turn: 5, verified: null } })), "unverified|dim");
  A.equal(W("pin", pin("P7")), "3 days ago|dim", "else how long ago");
  A.equal(W("pin", pin("P7", { createdAt: NOW - 30e3 })), "just now|dim");

  // ── stateOf: branches ────────────────────────────────────────────────────
  A.equal(W("branch", branches.br_1), "working|working");
  A.equal(W("branch", branches.br_3), "needs you|blocked");
  A.equal(W("branch", branches.br_4a), "launch failed|blocked");
  A.equal(W("branch", { ...branches.br_1, live: "nostart" }), "did not start|blocked", "one line: the dialog's status line keeps the toast hint");
  A.equal(S("question", qBr, { ...ctx, branchLive: () => "nostart" }).word, "branch did not start", "a question whose branch did not start");
  A.equal(W("branch", { ...branches.br_1, live: "refused" }), "refused|dim");
  A.equal(W("branch", { ...branches.br_1, live: "closed" }), "closed|dim");
  A.equal(W("branch", { ...branches.br_1, live: "done" }), "done|done");
  A.equal(W("branch", { ...branches.br_1, live: "rejoined" }), "rejoined|muted");
  A.equal(W("branch", { ...branches.br_1, live: "concluded" }), "concluded|muted");
  A.equal(W("branch", { ...branches.br_1, live: "somethingnew" }), "somethingnew|muted", "an unknown live word as it is");
  A.equal(W("branch", { id: "br_x", status: "launching" }, { now: NOW }), "launching…|muted", "no branchLive: its status");
  A.equal(LS.BR_WORD.blocked, "needs you"); A.equal(LS.BR_WORD.failed, "launch failed");

  // ── rowModel ─────────────────────────────────────────────────────────────
  const M = (kind, x, c = ctx) => LS.rowModel(kind, x, c);
  let m = M("ask", ask("A5", { level: "blocking", kind: "decide" }));
  A.deepEqual(Object.keys(m).sort(), ["glyph", "handle", "id", "key", "kind", "pill", "quick", "sessionId", "state", "text", "tip"].sort(), "the model's fields");
  A.equal(m.key, "item:rq_a5"); A.equal(m.kind, "ask"); A.equal(m.id, "rq_a5"); A.equal(m.sessionId, SID); A.equal(m.handle, "Ask 5");
  A.deepEqual(m.pill, { text: "blocking", tone: "blocked" }, "blocking pill");
  A.deepEqual(m.glyph, ["◆", "blocked", null]);
  A.deepEqual(M("ask", ask("A5", { level: "optional", kind: "do" })).pill, { text: "optional", tone: "dim" }, "a suggestion: its level");
  A.deepEqual(M("ask", ask("A5", { level: "needed", kind: "do" }), { ...ctx, threshold: "blocking" }).pill, { text: "needed", tone: "dim" }, "needed below a blocking threshold");
  A.deepEqual(M("ask", ask("A5", { level: "optional", kind: "do", promoted: true })).pill, { text: "do", tone: "dim" }, "promoted: no longer a suggestion, its kind");
  for (const k of ["decide", "provide", "confirm", "do", "review"]) A.deepEqual(M("ask", ask("A5", { kind: k })).pill, { text: k, tone: "dim" }, `kind ${k}`);
  A.equal(M("ask", ask("A5", { kind: undefined })).pill, null, "no kind, no pill");
  A.equal(M("question", q("Q2")).handle, "Question 2");
  A.deepEqual(M("question", qPins).pill, { text: "2 pins", tone: "accent" }, "with pins");
  A.deepEqual(M("question", q("Q2", { pins: ["pn_test-pin-0001"] })).pill, { text: "1 pin", tone: "accent" });
  A.deepEqual(M("question", q("Q2", { pins: ["pn_test-pin-0001", "pn_test-pin-0099"] })).pill, { text: "1 pin", tone: "accent" }, "pins the store still has");
  A.deepEqual(M("question", q("Q2", { pins: ["a", "b", "c"] }), { threshold: "needed" }).pill, { text: "3 pins", tone: "accent" }, "no store: the ids");
  A.deepEqual(M("question", q("Q2", { kind: "bookmark", text: "", anchor: { sessionId: SID, turn: 7, quote: "  The old view\n is present.  \nmore" } })).pill, { text: "bookmark", tone: "dim" });
  A.equal(M("question", q("Q2", { kind: "bookmark", text: "", anchor: { sessionId: SID, turn: 7, quote: "  The old   view is present.  \nmore" } })).text, "“The old view is present.”", "a bookmark: the first line of its quote");
  A.deepEqual(M("question", q("Q2", { origin: "btw" })).pill, { text: "/btw", tone: "muted" });
  A.deepEqual(M("question", q("Q2", { btwStagedAt: NOW })).pill, { text: "/btw", tone: "muted" });
  A.deepEqual(M("question", { ...qPins, origin: "btw" }).pill, { text: "2 pins", tone: "accent" }, "pins win over /btw");
  A.equal(M("question", q("Q2")).pill, null, "a plain question: none");
  A.equal(M("question", q("Q2", { text: "first line\nsecond line" })).text, "first line");
  // quick actions
  A.deepEqual(M("ask", ask("A5")).quick, { done: true, paste: false, promote: false }, "open, no answer");
  A.deepEqual(M("ask", ask("A5", { draft: "fast" })).quick, { done: true, paste: true, promote: false }, "an answer ready: Paste");
  // Answered (the sheet landed, the draft stays) or deferred: no Paste (a second paste would repeat an answer
  // already sent), and the row keeps its state word, which the panel draws whenever Paste is not shown.
  for (const [status, word] of [["answered", "answered|accent"], ["deferred", "deferred|muted"]]) {
    const am = M("ask", ask("A5", { draft: "fast", status }));
    A.deepEqual(am.quick, { done: true, paste: false, promote: false }, `${status} with a draft: Done, no Paste`);
    A.equal(`${am.state.word}|${am.state.tone}`, word, `${status} with a draft: its state word`);
  }
  A.equal(M("ask", ask("A5", { draft: "fast" })).state.word, "answer ready", "Paste shows only where the word is answer ready");
  A.deepEqual(M("ask", ask("A5", { draft: "fast", status: "resolved" })).quick, { done: false, paste: false, promote: false }, "closed: nothing");
  A.deepEqual(M("ask", ask("A5", { draft: "fast", status: "dismissed" })).quick, { done: false, paste: false, promote: false });
  A.deepEqual(M("ask", ask("A5", { level: "optional", draft: "fast" })).quick, { done: true, paste: false, promote: true }, "below the threshold: Promote stands in for Paste");
  A.deepEqual(M("ask", ask("A5", { level: "optional", status: "dismissed" })).quick, { done: false, paste: false, promote: false });
  A.deepEqual(M("question", q("Q2", { draft: "x" })).quick, { done: true, paste: false, promote: false }, "a question never pastes");
  A.deepEqual(M("question", q("Q2", { status: "rejoin_pending" })).quick, { done: true, paste: false, promote: false }, "rejoin_pending keeps Done");
  A.deepEqual(M("question", q("Q2", { status: "resolved" })).quick, { done: false, paste: false, promote: false });
  // the tooltip
  A.equal(M("ask", ask("A5", { text: "Pick one", anchor: { sessionId: SID, turn: 7, quote: "  Which   pool mode?  " } })).tip, "Pick one\n“Which pool mode?”", "text, then the quote");
  const tl = M("ask", ask("A5", { text: "t".repeat(400), anchor: { sessionId: SID, turn: 7, quote: "q".repeat(200) } })).tip.split("\n");
  A.equal(tl[0].length, 300); A.ok(tl[0].endsWith("…")); A.equal(tl[1].length, 122, "the quote's first 120 in quotes"); A.ok(tl[1].startsWith("“") && tl[1].endsWith("”"));
  A.equal(M("question", q("Q2", { text: "Why?", anchor: { sessionId: SID, turn: 7 } })).tip, "Why?", "no quote");
  // pins
  m = M("pin", pins["pn_test-pin-0001"]);
  A.equal(m.key, "pin:pn_test-pin-0001"); A.equal(m.kind, "pin"); A.equal(m.handle, "Pin 1"); A.equal(m.pill, null); A.equal(m.text, "Pinned passage P1");
  A.deepEqual(m.quick, { done: false, paste: false, promote: false }, "pins have no quick action");
  A.deepEqual(m.glyph, ["•", "accent", "pin"]);
  A.deepEqual(M("pin", pin("P3", { status: "archived" })).glyph, ["•", "dim", "pin"]);
  A.equal(M("pin", pin("P3", { note: "the key one" })).tip, "Pinned passage P3\nNote: the key one", "a pin's tooltip adds its note");
  // branches
  m = M("branch", branches.br_1);
  A.equal(m.key, "branch:br_1"); A.equal(m.kind, "branch"); A.equal(m.sessionId, SID);
  A.equal(m.handle, "branch of Question 1"); A.deepEqual(m.pill, { text: "br-q1-aaaa", tone: "dim" }); A.equal(m.text, "Question text Q1");
  A.deepEqual(m.state, { word: "working", tone: "working" });
  A.deepEqual(m.glyph, ["↳", "working", "spinner"], "a working branch spins");
  A.deepEqual(M("branch", branches.br_3).glyph, ["↳", "blocked", "git-branch"]);
  A.deepEqual(m.quick, { done: false, paste: false, promote: false }, "branches have no quick action");
  A.equal(M("branch", { id: "br_z", requestId: "rq_gone", name: null, status: "launching" }).handle, "branch of a question", "its question gone");

  // ── the row at 280 px (Detail.md 6.1): the state word capped and truncated, the text kept ───────
  A.deepEqual(LS.ROW, { stateMaxW: 104, textMinW: 48, stateChars: 20 });
  const words = new Set();
  const addW = (kind, x, c = ctx) => words.add(S(kind, x, c).word);
  for (const status of ["open", "answered", "resolved", "dismissed", "deferred"]) {
    for (const o of [{}, { draft: "x" }, { repeatOf: "rq_x" }, { level: "blocking" }, { level: "optional" }, { resolvedBy: "answer" }, { resolvedBy: "agent" },
      { resolvedBy: "branch" }, { dismissedBy: "clear" }]) addW("ask", ask("A1", { status, ...o }));
  }
  for (const status of ["open", "answered", "resolved", "dismissed", "deferred", "rejoin_pending"]) {
    for (const o of [{}, { askedAtTurn: 1234 }, { resolvedBy: "branch" }, { dismissedBy: "clear" }, { anchor: { sessionId: SID, turn: 7, settled: false } }]) addW("question", q("Q9", { status, ...o }));
  }
  for (const live of Object.keys(LS.BR_WORD)) { addW("branch", { ...branches.br_1, live }); addW("question", qBr, { ...ctx, branchLive: () => live }); }
  for (const o of [{ status: "archived" }, { answeredIn: [{ question: qPins.id }] }, { usedIn: [{ question: qPins.id }] }, { usedIn: [{ question: qSent.id }] },
    { anchor: { sessionId: SID, turn: 5, verified: null } }, { createdAt: NOW - 59 * 60e3 }, { createdAt: NOW - 23 * 3600e3 }, { createdAt: NOW - 29 * DAY }, { createdAt: NOW - 400 * DAY }]) addW("pin", pin("P7", o));
  const longest = [...words].sort((a, b) => b.length - a.length)[0];
  A.ok(words.size > 30, `the words of every known status (${words.size})`);
  A.ok(longest.length <= LS.ROW.stateChars, `every state word fits ROW.stateChars (${LS.ROW.stateChars}); the longest: “${longest}” (${longest.length})`);
  const lrow = (src("panel.js").match(/^  listRow\([^)]*\) \{[\s\S]*?^  \}$/m) ?? [""])[0];
  A.ok(/\.flex_1\(\)\.min_w\(ROW\.textMinW\)\.truncate\(\)/.test(lrow), "panel.js listRow: the text keeps ROW.textMinW");
  A.ok(/\.flex_shrink_1\(\)\.min_w\(0\)\.max_w\(ROW\.stateMaxW\)\.truncate\(\)[^\n]*m\.state\.word/.test(lrow), "panel.js listRow: the state word is capped at ROW.stateMaxW and truncates");
  A.ok(!/flex_none\(\)[^\n]*m\.state\.word/.test(lrow), "panel.js listRow: the state word is no longer flex_none");

  // ── entryKey ─────────────────────────────────────────────────────────────
  A.equal(LS.entryKey("ask", "rq_1"), "item:rq_1"); A.equal(LS.entryKey("question", "rq_1"), "item:rq_1"); A.equal(LS.entryKey("item", "rq_1"), "item:rq_1");
  A.equal(LS.entryKey("pin", "pn_1"), "pin:pn_1"); A.equal(LS.entryKey("branch", "br_1"), "branch:br_1");

  // ── moveCursor ───────────────────────────────────────────────────────────
  const K = ["lane:pins", "pin:a", "lane:mine", "item:1", "item:2", "branch:b", "lane:asks", "group:7", "item:3", "sheet:7", "sug:7", "item:4"];
  A.equal(LS.moveCursor(K, null, 1), "lane:pins", "down from none: the first");
  A.equal(LS.moveCursor(K, null, -1), "item:4", "up from none: the last");
  A.equal(LS.moveCursor(K, "gone", 1), "lane:pins", "a cursor no longer listed counts as none");
  A.equal(LS.moveCursor(K, "item:1", 1), "item:2"); A.equal(LS.moveCursor(K, "item:1", -1), "lane:mine");
  A.equal(LS.moveCursor(K, "lane:pins", -1), "lane:pins", "clamped at the top"); A.equal(LS.moveCursor(K, "item:4", 1), "item:4", "clamped at the bottom");
  A.equal(LS.moveCursor(K, "pin:a", 8), "sheet:7"); A.equal(LS.moveCursor(K, "item:2", 8), "item:4", "+8 clamped");
  A.equal(LS.moveCursor(K, "sheet:7", -8), "pin:a"); A.equal(LS.moveCursor(K, "item:2", -8), "lane:pins", "-8 clamped");
  A.equal(LS.moveCursor(K, "item:2", "home"), "lane:pins"); A.equal(LS.moveCursor(K, null, "end"), "item:4");
  A.equal(LS.moveCursor([], null, 1), null, "no entries"); A.equal(LS.moveCursor([], "x", "home"), null);

  // ── keepPlace ────────────────────────────────────────────────────────────
  A.equal(LS.keepPlace(K, K, "item:2"), "item:2", "still present");
  A.equal(LS.keepPlace(K, ["item:2", ...K.filter((k) => k !== "item:2")], "item:2"), "item:2", "a key that moved keeps itself");
  A.equal(LS.keepPlace(K, K.filter((k) => k !== "item:2"), "item:2"), "branch:b", "removed: the next one present");
  A.equal(LS.keepPlace(K, K.filter((k) => !["item:2", "branch:b", "lane:asks"].includes(k)), "item:2"), "group:7", "the first of the following still present");
  A.equal(LS.keepPlace(K, K.filter((k) => k !== "item:4"), "item:4"), "sug:7", "the last one gone: the one before");
  A.equal(LS.keepPlace(K, ["lane:pins"], "item:4"), "lane:pins", "only an earlier one left");
  A.equal(LS.keepPlace(K, [], "item:2"), null, "everything gone");
  A.equal(LS.keepPlace(K, K, null), null, "no cursor");
  A.equal(LS.keepPlace(["a"], ["b"], "zzz"), null, "a cursor never listed");
  A.equal(LS.keepPlace(["a", "zzz"], ["zzz", "b"], "zzz"), "zzz");

  // ── the contract, as text (5.2) ──────────────────────────────────────────
  const lsrc = src("listing.js");
  A.ok(!/from "herdr"|from "gpui-|from "\.\/(nav|reader|panel|detail|views|fixtures|writer|spool)\.js"/.test(lsrc), "listing.js is pure: store.js and words.js only");
  for (const e of ["BR_WORD", "firstLine", "glyphOf", "stateOf", "rowModel", "entryKey", "moveCursor", "keepPlace"]) A.ok(new RegExp(`^export (const|function) ${e}\\b`, "m").test(lsrc), `listing.js exports ${e}`);
  const rsrc = src("reader.js");
  A.ok(/^export class Reader \{/m.test(rsrc), "reader.js exports class Reader");
  for (const name of ["constructor", "startReading", "fallback", "viewStore", "reload", "bump", "overlayLocal", "watchStore", "tickRead", "post", "act", "typeDraft",
    "flushPending", "answerOf", "pasteOn", "demoHow", "stage", "stageAnswers", "copyAnswers", "copyAnswer", "trunkWord", "parentLive", "branchable", "branchLive",
    "terminalGone", "transcriptOk", "loadPassage", "pinAct", "resume", "pastePending"]) {
    A.ok(new RegExp(`^  (async )?${name}\\(`, "m").test(rsrc), `Reader.${name}`);
  }
  A.ok(/^  constructor\(_?cx, \{ demo/m.test(rsrc), "constructor(cx, {demo})");
  A.ok(/^  async startReading\(cx\)/m.test(rsrc) && /^  async flushPending\(\)/m.test(rsrc), "startReading and flushPending are async");
  A.ok(/this\.onConfig\?\.\(cx\)/.test(rsrc) && /this\.afterStage\?\.\(r, text, terminal, cx\)/.test(rsrc), "the onConfig and afterStage hooks");
  A.ok(/this\.unwritten = new Map\(\)/.test(rsrc), "unwritten: evId -> {type, payload}");
  A.ok(/^  post\(type, payload, local, cx, after = null\) \{/m.test(rsrc) && /after\?\.\(ok, cx\)/.test(rsrc), "post(type, payload, local, cx, after): after(ok, cx) once the write resolved (the dialog's closing acts)");
  A.ok(/if \(ok\) this\.staged = \{ terminal:/.test(rsrc), "stage keeps the staged terminal and words (a dialog closed mid-paste)");
  const psrc = src("panel.js");
  A.ok(/^export class Panel extends Reader \{/m.test(psrc), "Panel extends Reader");
  A.ok(!/^  stage\(/m.test(psrc), "panel.js defines no stage of its own");
  for (const name of ["post", "act", "typeDraft", "reload", "overlayLocal", "watchStore", "stageAnswers", "copyAnswers", "copyAnswer", "loadPassage", "pinAct"]) {
    A.ok(!new RegExp(`^  ${name}\\(`, "m").test(psrc), `panel.js does not define ${name} again`);
  }
  A.ok(/openOverlay\(detailSpec\(\{ session: sid, kind, id, open: o\.open \?\? null, sel, opener: this\.panelId, demo: this\.demo \}\)\)/.test(psrc), "openDetail opens detailSpec with the props of 5.2");
  A.ok(/track_focus\(this\.keys\)\.on_key_down\(/.test(psrc) && /track_scroll\(this\.listScroll\)/.test(psrc), "the root tracks the list's focus, the list its scroll");

  console.log(`OK: list, ${checks} checks (firstLine, glyphOf, every state word, rowModel pills, text, quick actions and tooltips, the row's widths at 280 px, entryKey, moveCursor, keepPlace; Reader and panel contract as text), 0 failure(s)`);
} finally {
  if (own) fs.rmSync(dir, { recursive: true, force: true });
}
