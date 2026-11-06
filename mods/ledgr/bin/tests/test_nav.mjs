// ledgr nav unit test: what Copy answer(s), /btw, Send to trunk (stageText) and Go to anchor
// (goToAnchor) do to a terminal, with a stub `herdr` module that records every call. The rule: the
// clipboard and `pane.focus`, nothing else; never `hc` (no keys, no send), never a find bar.
//   node tests/test_nav.mjs <folder holding nav.js and node_modules/herdr>   (tests/test-nav.sh)
import assert from "node:assert/strict";
const dir = process.argv[2];
if (!dir) { console.error("usage: test_nav.mjs <module folder>"); process.exit(2); }
const H = (globalThis.__herdr = { calls: [], agents: [], terminals: [] });
const N = await import(`${dir}/nav.js`);
let checks = 0;
const A = new Proxy(assert, { get: (t, k) => (...a) => { checks++; return t[k](...a); } });

const cx = () => {
  const c = { clip: [], spawned: 0 };
  c.write_to_clipboard = (t) => c.clip.push(t);
  c.spawn = (f) => { c.spawned++; return f(c); };
  return c;
};
const reset = (agents, terminals = []) => { H.calls.length = 0; H.agents = agents; H.terminals = terminals; };
const focusOnly = (t) => [["run", "pane.focus", { terminal: t }]];
const noHc = () => A.equal(H.calls.filter((c) => c[0] !== "run").length, 0, `no hc or exec: ${JSON.stringify(H.calls)}`);
const QUOTE = "Confirm whether to commit the current state and then have the agent run the uninstall and reinstall round trip.";
const SHEET = "ledgr answers 88c36d53-35d6-4ccd-8fa6-2c260f89cc18\nAnswers to your asks from turn 27:\nA27: Yes proceed";

for (const status of ["idle", "done", "working", "blocked"]) {
  for (const app of ["claude-code", "codex"]) {
    // Copy answer / Copy answers: the sheet on the clipboard, the pane focused, nothing else.
    reset([{ address: "t3", app, status }]);
    let c = cx();
    N.stageText(SHEET, "t3", c);
    A.deepEqual(c.clip, [SHEET]); A.deepEqual(H.calls, focusOnly("t3")); A.equal(c.spawned, 0); noHc();

    // Go to anchor: a slice of the quote on the clipboard, the pane focused, a note; no keys.
    reset([{ address: "t3", app, status }]);
    c = cx();
    const note = N.goToAnchor({ anchor: { quote: QUOTE } }, { terminal: "t3", agent: app }, c);
    A.deepEqual(H.calls, focusOnly("t3"), `${app} ${status}: focus only, got ${JSON.stringify(H.calls)}`);
    A.equal(c.clip.length, 1); A.ok(QUOTE.includes(c.clip[0]) && c.clip[0].length >= 20 && c.clip[0].length <= 40, c.clip[0]);
    A.equal(c.spawned, 0, "nothing deferred (an hc call used to be spawned)"); noHc();
    A.ok(note.includes(c.clip[0]) && note.includes("t3"), note);
    A.equal(note.includes("ctrl+o"), app === "claude-code", `the note says how to search in Claude: ${note}`);
    A.equal(/working/.test(note), status === "working" || status === "blocked", note);
  }
}

// A live plain terminal (no agent): staged the same way.
reset([], [{ address: "t9", state: "live" }]);
let c = cx();
N.stageText("x", "t9", c);
A.deepEqual(c.clip, ["x"]); A.deepEqual(H.calls, focusOnly("t9"));

// No quote: focus only, nothing copied.
reset([{ address: "t3", app: "claude-code", status: "idle" }]);
c = cx();
A.match(N.goToAnchor({ anchor: { quote: null } }, { terminal: "t3" }, c), /No quote saved/);
A.deepEqual(c.clip, []); A.deepEqual(H.calls, focusOnly("t3"));

// A terminal that is gone: the clipboard still gets the text, nothing is focused, nothing sent.
reset([], [{ address: "t3", state: "finished" }]);
c = cx();
N.stageText(SHEET, "t3", c);
A.deepEqual(c.clip, [SHEET]); A.deepEqual(H.calls, []);
c = cx();
A.match(N.goToAnchor({ anchor: { quote: QUOTE } }, { terminal: "t3" }, c), /not live/);
A.deepEqual(c.clip, []); A.deepEqual(H.calls, []);
N.stageText(SHEET, null, c);
A.deepEqual(H.calls, []);

// The slice helper still cuts at word boundaries.
A.equal(N.searchSlice("short"), "short");
A.equal(N.searchSlice("ab"), "");
A.ok(N.searchSlice(QUOTE).split(" ").every((w) => QUOTE.split(" ").includes(w)));

console.log(`OK: nav, ${checks} checks (clipboard + pane.focus only; no hc keys, no hc send, no find bar), 0 failure(s)`);
