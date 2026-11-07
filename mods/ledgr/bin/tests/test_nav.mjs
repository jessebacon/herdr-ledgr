// ledgr nav unit test: what Paste answer(s) and Paste into trunk (stageIntoPrompt), Copy for prompt
// and /btw (stageText) and Go to anchor (goToAnchor) do to a terminal, with a stub `herdr` module that
// records every call and every look at focused(). The rules: staging is the clipboard and `pane.focus`;
// the paste actions add exactly one `terminal.paste`, and only after Herdr has reported the target
// focused twice in a row; nothing is pasted when the focus is not confirmed, the target is no agent
// or waits on its own prompt, or ui.pasteIntoPrompt is off. Never `hc` (no keys, no send), never a
// find bar, never Enter, "\r" or "\n" in any command's arguments. A staged message goes on the clipboard
// with one empty line at its end (promptText), pasted or not; its first line stays the marker.
//   node tests/test_nav.mjs <folder holding nav.js and node_modules/herdr>   (tests/test-nav.sh)
import assert from "node:assert/strict";
const dir = process.argv[2];
if (!dir) { console.error("usage: test_nav.mjs <module folder>"); process.exit(2); }
const H = (globalThis.__herdr = { calls: [], order: [], agents: [], terminals: [], focus: null, looks: 0 });
const N = await import(`${dir}/nav.js`);
let checks = 0;
const A = new Proxy(assert, { get: (t, k) => (...a) => { checks++; return t[k](...a); } });

const ALL = [];   // every call of every case, for the global rules at the end
const cx = () => {
  const c = { clip: [], board: undefined, spawned: 0, slept: 0, tasks: [], readClip: null };
  c.write_to_clipboard = (t) => { c.clip.push(t); c.board = t; };
  c.read_from_clipboard = () => (c.readClip ? c.readClip() : c.board);
  c.spawn = (f) => { c.spawned++; c.tasks.push(Promise.resolve().then(() => f(c))); return { cancel() {}, is_done: () => false }; };
  c.sleep = async (ms) => { c.slept += ms ?? 0; };
  c.notify = () => {};
  return c;
};
const reset = (agents, terminals = [], focus = null) => {
  ALL.push(...H.calls);
  H.calls.length = 0; H.order.length = 0; H.looks = 0;
  H.agents = agents; H.terminals = terminals; H.focus = focus;
};
const focusOnly = (t) => [["run", "pane.focus", { terminal: t }]];
const PASTE = ["run", "terminal.paste", null];
const noHc = () => A.equal(H.calls.filter((c) => c[0] !== "run").length, 0, `no hc or exec: ${JSON.stringify(H.calls)}`);
const QUOTE = "Confirm whether to commit the current state and then have the agent run the uninstall and reinstall round trip.";
const SHEET = "ledgr answers 88c36d53-35d6-4ccd-8fa6-2c260f89cc18\nAnswers to your asks from turn 27:\nA27: Yes proceed";
const STAGED = `${SHEET}\n\n`;   // what stageIntoPrompt puts on the clipboard

// stageIntoPrompt, its task run to the end. Returns what it returned, the results `done` got, the cx.
async function paste(text, t, opts = {}) {
  const c = cx(), results = [];
  const ret = N.stageIntoPrompt(text, t, c, { paste: opts.paste ?? true, done: (r) => results.push(r) });
  if (opts.clip !== undefined) c.readClip = opts.clip;
  await Promise.all(c.tasks);
  return { ret, results, c };
}
// The order log as [kind, name or terminal]: pane.focus, look t3, look t3, terminal.paste.
const order = () => H.order.map((o) => (o[0] === "look" ? ["look", o[1]] : [o[0], o[1]]));

for (const status of ["idle", "done", "working"]) {
  for (const app of ["claude-code", "codex"]) {
    // Paste answer(s) / Paste into trunk, the focus confirmed at once: clipboard, focus, two looks
    // that agree, one paste. Nothing else.
    reset([{ address: "t3", app, status }], [], { terminal: "t3", pane: "p3" });
    let { ret, results, c } = await paste(SHEET, "t3");
    A.equal(ret, "pasting"); A.deepEqual(c.clip, [STAGED]); A.equal(c.spawned, 1);
    A.deepEqual(H.calls, [...focusOnly("t3"), PASTE], `${app} ${status}: ${JSON.stringify(H.calls)}`);
    A.deepEqual(order(), [["run", "pane.focus"], ["look", "t3"], ["look", "t3"], ["run", "terminal.paste"]], "focus, two confirmations, then the paste");
    A.deepEqual(results, [{ pasted: true, ms: 100 }]); A.equal(c.slept, 100); noHc();

    // Copy for prompt, /btw: the text on the clipboard, the pane focused, nothing else.
    reset([{ address: "t3", app, status }], [], { terminal: "t3" });
    c = cx();
    N.stageText(SHEET, "t3", c);
    A.deepEqual(c.clip, [SHEET]); A.deepEqual(H.calls, focusOnly("t3")); A.equal(c.spawned, 0); noHc();

    // Go to anchor: a slice of the quote on the clipboard, the pane focused, a note; no keys, no paste.
    reset([{ address: "t3", app, status }], [], { terminal: "t3" });
    c = cx();
    const note = N.goToAnchor({ anchor: { quote: QUOTE } }, { terminal: "t3", agent: app }, c);
    A.deepEqual(H.calls, focusOnly("t3"), `${app} ${status}: focus only, got ${JSON.stringify(H.calls)}`);
    A.equal(c.clip.length, 1); A.ok(QUOTE.includes(c.clip[0]) && c.clip[0].length >= 20 && c.clip[0].length <= 40, c.clip[0]);
    A.equal(c.spawned, 0, "nothing deferred (an hc call used to be spawned)"); noHc();
    A.ok(note.includes(c.clip[0]) && note.includes("t3"), note);
    A.equal(note.includes("ctrl+o"), app === "claude-code", `the note says how to search in Claude: ${note}`);
    A.equal(/working/.test(note), status === "working", note);
  }
}

// The focus arrives late (another terminal for three looks): the paste waits for two looks in a row
// on the target, and comes right after them.
reset([{ address: "t3", app: "claude-code", status: "idle" }], [], (n) => ({ terminal: n < 4 ? "t1" : "t3" }));
let r = await paste(SHEET, "t3");
A.deepEqual(H.calls, [...focusOnly("t3"), PASTE]);
let o = order(), at = o.findIndex((x) => x[1] === "terminal.paste");
A.deepEqual(o.slice(at - 2, at), [["look", "t3"], ["look", "t3"]], "the two looks before the paste are on the target");
A.deepEqual(o.slice(1, at - 2), [["look", "t1"], ["look", "t1"], ["look", "t1"]], "no paste while another terminal had the focus");
A.deepEqual(r.results, [{ pasted: true, ms: 250 }]);

// A focus that flickers (never twice in a row on the target): nothing pasted within the wait.
reset([{ address: "t3", app: "claude-code", status: "idle" }], [], (n) => ({ terminal: n % 2 ? "t3" : "t1" }));
r = await paste(SHEET, "t3");
A.deepEqual(H.calls, focusOnly("t3")); A.deepEqual(r.results, [{ pasted: false, why: "focus" }]);
A.equal(r.c.slept, N.PASTE.waitMs, "gives up after the wait"); A.equal(H.looks, N.PASTE.waitMs / N.PASTE.stepMs);

// The focus never reaches the target (another terminal, a mod pane, no window): nothing pasted, the
// text stays on the clipboard.
for (const f of [{ terminal: "t1" }, { terminal: null, pane: "pmod" }, null]) {
  reset([{ address: "t3", app: "claude-code", status: "idle" }], [], f);
  r = await paste(SHEET, "t3");
  A.deepEqual(H.calls, focusOnly("t3"), JSON.stringify(f)); A.deepEqual(r.c.clip, [STAGED]);
  A.deepEqual(r.results, [{ pasted: false, why: "focus" }]); A.ok(r.c.slept <= N.PASTE.waitMs);
}

// Another terminal shown in the target's pane (terminal.show): keyboard input would go there.
reset([{ address: "t3", app: "claude-code", status: "idle" }], [], { terminal: "t3", shown: "t8" });
r = await paste(SHEET, "t3");
A.deepEqual(H.calls, focusOnly("t3")); A.equal(r.results[0].why, "focus");

// The clipboard changed before the paste (the person copied something): not pasted.
for (const clip of [() => "something the person copied", () => undefined]) {
  reset([{ address: "t3", app: "claude-code", status: "idle" }], [], { terminal: "t3" });
  r = await paste(SHEET, "t3", { clip });
  A.deepEqual(H.calls, focusOnly("t3")); A.deepEqual(r.results, [{ pasted: false, why: "clipboard" }]);
}
// The same text back with CRLF line ends is the same text; so is one whose trailing line breaks a
// clipboard dropped or kept.
for (const clip of [() => STAGED.replace(/\n/g, "\r\n"), () => SHEET.replace(/\n/g, "\r\n"), () => SHEET]) {
  reset([{ address: "t3", app: "claude-code", status: "idle" }], [], { terminal: "t3" });
  r = await paste(SHEET, "t3", { clip });
  A.deepEqual(H.calls, [...focusOnly("t3"), PASTE]);
}

// A look that throws: reported, nothing pasted.
reset([{ address: "t3", app: "claude-code", status: "idle" }], [], () => { throw new Error("no window"); });
r = await paste(SHEET, "t3");
A.deepEqual(H.calls, focusOnly("t3")); A.equal(r.results[0].why, "error"); A.match(r.results[0].error, /no window/);

// Known at once, no task: ui.pasteIntoPrompt off (clipboard + focus, as before), an agent waiting on
// its own prompt (blocked), a live terminal with no agent (a shell would run what a paste holds).
for (const [why, agents, terms, opts] of [
  ["off", [{ address: "t3", app: "claude-code", status: "idle" }], [], { paste: false }],
  ["blocked", [{ address: "t3", app: "claude-code", status: "blocked" }], [], {}],
  ["plain", [], [{ address: "t3", state: "live" }], {}],
]) {
  reset(agents, terms, { terminal: "t3" });
  r = await paste(SHEET, "t3", opts);
  A.equal(r.ret, why); A.deepEqual(r.results, [{ pasted: false, why }]); A.equal(r.c.spawned, 0, why);
  A.deepEqual(r.c.clip, [STAGED], `${why}: the blank line too`); A.deepEqual(H.calls, focusOnly("t3"), why); A.equal(H.looks, 0, `${why}: no look, no paste`);
}

// A live plain terminal (no agent): stageText stages the same way.
reset([], [{ address: "t9", state: "live" }]);
let c = cx();
N.stageText("x", "t9", c);
A.deepEqual(c.clip, ["x"]); A.deepEqual(H.calls, focusOnly("t9"));

// No quote: focus only, nothing copied.
reset([{ address: "t3", app: "claude-code", status: "idle" }]);
c = cx();
A.match(N.goToAnchor({ anchor: { quote: null } }, { terminal: "t3" }, c), /No quote saved/);
A.deepEqual(c.clip, []); A.deepEqual(H.calls, focusOnly("t3"));

// A terminal that is gone: the clipboard still gets the text, nothing is focused, nothing pasted.
reset([], [{ address: "t3", state: "finished" }], { terminal: "t3" });
c = cx();
N.stageText(SHEET, "t3", c);
A.deepEqual(c.clip, [SHEET]); A.deepEqual(H.calls, []);
r = await paste(SHEET, "t3");
A.equal(r.ret, "gone"); A.deepEqual(r.c.clip, [STAGED]); A.deepEqual(H.calls, []); A.deepEqual(r.results, [{ pasted: false, why: "gone" }]);
r = await paste(SHEET, null);
A.equal(r.ret, "gone"); A.deepEqual(H.calls, []);
c = cx();
A.match(N.goToAnchor({ anchor: { quote: QUOTE } }, { terminal: "t3" }, c), /not live/);
A.deepEqual(c.clip, []); A.deepEqual(H.calls, []);
N.stageText(SHEET, null, c);
A.deepEqual(H.calls, []);

// The staged message ends with one empty line, so a second paste into the same prompt starts after a
// blank line (Jesse, 2026-11-07: pasted answers ran together). Only the end changes: the first line
// (the marker the hooks find) and everything before the end stay as composed.
const CONF = "ledgr confluence br_00000000-cccc-4bbb-8ccc-000000000001 rq_c3\nParked question Q1, from turn 1: why?\nConclusion:\nYes, 8443  \n\nchanges: none\nI am adopting this branch's conclusion as the answer to Q1.";
for (const msg of [SHEET, CONF]) {
  const out = N.promptText(msg);
  A.ok(out.endsWith("\n\n") && !out.endsWith("\n\n\n"), "ends with exactly one empty line");
  A.equal(out.split("\n")[0], msg.split("\n")[0], "the marker stays the first line");
  A.equal(out.slice(0, msg.length), msg, "everything before the end unchanged (blank lines and spaces inside kept)");
  A.equal(out, `${msg}\n\n`);
}
A.equal(N.promptText(`${SHEET}\n`), STAGED, "a message that ends with a line break: still one empty line");
A.equal(N.promptText(`${SHEET}\r\n\r\n\n`), STAGED);
A.equal(N.promptText(STAGED), STAGED, "staged twice: the same");
A.equal(N.promptText(SHEET) + N.promptText(CONF), `${SHEET}\n\n${CONF}\n\n`, "two pastes in a row: one blank line between them");
// The confluence through stageIntoPrompt, pasted: the clipboard holds it with its blank line.
reset([{ address: "t3", app: "claude-code", status: "idle" }], [], { terminal: "t3" });
r = await paste(CONF, "t3");
A.deepEqual(r.c.clip, [`${CONF}\n\n`]); A.deepEqual(H.calls, [...focusOnly("t3"), PASTE]); A.equal(r.c.clip[0].split("\n")[0], CONF.split("\n")[0]);

// The slice helper still cuts at word boundaries.
A.equal(N.searchSlice("short"), "short");
A.equal(N.searchSlice("ab"), "");
A.ok(N.searchSlice(QUOTE).split(" ").every((w) => QUOTE.split(" ").includes(w)));

// Over every call of every case: no hc, no exec, no find bar, no key names, no Enter, no line break
// in any command's arguments; terminal.paste only ever without arguments; pane.focus and
// terminal.paste the only commands nav.js runs.
reset([]);
A.ok(ALL.length > 20, `calls recorded: ${ALL.length}`);
A.equal(ALL.filter((x) => x[0] !== "run").length, 0, "no hc, no exec");
A.deepEqual([...new Set(ALL.map((x) => x[1]))].sort(), ["pane.focus", "terminal.paste"]);
for (const x of ALL) {
  const args = JSON.stringify(x.slice(2));
  A.ok(!/enter|return|\\r|\\n|keys|send|search/i.test(args), `no Enter, line break or key in ${JSON.stringify(x)}`);
}
A.ok(ALL.filter((x) => x[1] === "terminal.paste").every((x) => x[2] === null), "terminal.paste takes no arguments");

console.log(`OK: nav, ${checks} checks (clipboard + pane.focus; terminal.paste once and only after the focus is confirmed; a staged message ends with one empty line; no hc keys, no hc send, no find bar, no Enter), 0 failure(s)`);
