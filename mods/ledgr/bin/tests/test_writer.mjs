// ledgr writer test (Node): the 2026-11-12 stall and the writer's robustness. store.json had reached
// 1,041,470 bytes; a declare_asks event of nine blocking asks took it past Herdr's 1 MiB text-file cap
// ("Text file exceeds 1 MiB"), every save failed, applyBatch returned false and the spool stopped
// draining while the in-memory store (and the chips) moved on. Checked here, against a herdr stub whose
// readTextFile and writeTextFile refuse a file over 1 MiB as Herdr's do:
//   1. the exact stalled event (fixtures/spool-stall/) on a store just under the cap: applied, nine
//      blocking asks with handles, the chip counts them, store.json written past 1 MiB (writeLarge),
//      snapshot.json too, the spool file gone;
//   2. a store.json that cannot be written: the writer's `fault` is in its claim (the panel's status
//      line), the event stays in the spool, and applies once writing works again;
//   3. an event whose apply throws: moved to spool/failed with its error and stack beside it, nothing of
//      it in the store, the event after it applied, `failed` in the claim ("1 event failed, see spool/failed");
//   4. the heartbeat: every tick renews the claim's `at`.
// And the 2026-11-19 stall (a pass that saved store.json and never returned, while the tick kept the claim
// fresh), with stub awaits that never settle, or settle late (docs/build-notes/BUILD-NOTES-mod.md 18):
//   the reader alone: abandon() with a late apply, a role lost between unlinks;
//   5. the mv ran, its answer never came: the claim names the step, the watchdog restarts from store.json,
//      the event applied once, the status line and writer.log say so;
//   6. a given-up save whose mv runs late: nothing lands (the start removed its copy), nothing recorded;
//   7. a timed-out large write: an error, then a fault through a drain; the store whole; applied later;
//   8. an event the passes do not apply (unreadable): one restart, then named, not restarted again;
//   9. restarts that never finish a pass: after MAX_UNSTICKS a back-off that keeps the claim and says so,
//      doubling, then a restart that works once the host answers; the event kept;
//   10. a takeover of a fresh but stuck claim by a second host; the old holder's mv settles late, harmlessly;
//   11. writer.log keeps its last WRITER_LOG_MAX bytes.
// And the review's findings (Node's fs/promises patched through syncBuiltinESMExports where an await of
// the writer's own fs must hang):
//   12. a restart whose sweep cannot list ledgr-data fails, reads nothing, starts again; the late mv lands
//       nothing and no event is lost (a writer starting from disk has them all);
//   13. an old pass whose temporary copy lands after the generation changed asks ok() and moves nothing in;
//   14. a start that lost its race does not sweep the holder's copy;
//   15. the config watch is one per generation, and the tick brings map records' spaces in;
//   16. writeAtomicWith keeps a line that landed between its read and its write; decisions.md once;
//   17. a panel's fallback whose start hangs is restarted by its own tick while it is not the writer.
// And retention (2026-11-19, writer.js housekeep; a home of its own):
//   18. the pure parts: turnsKept, archiveChunks, the archive names, a restore's file and record;
//   19. the first run after the upgrade on a 1.7 MB store: the one-time copy, archive files per session
//       under the cap (one session split), each created (expected null) and named a step, the store under
//       1 MiB, its first save through writeLarge and the next on writeTextFile; no month file;
//   20. a name already taken fails its write (create-only) and a read-back that differs: both keep their
//       items in the store, the next run archives them (a harmless duplicate);
//   21. a run given up between writing a file and saving (the watchdog, kind "house"): the store whole,
//       the file a duplicate once the next run archives the items again;
//   22. an archive write of a given-up run that lands late: under its own name, older than the next run's;
//   23. an item reopened while its archive file was being written stays in the store;
//   24. the triggers: the size and the hourly limit, a day, the first run, one run at a time;
//   25. a one-time copy that cannot be written: nothing archived, d.retention not set;
//   26. restore: a good file (reopened), a legacy month file, a missing file, a bad name, an item not in it;
//   27. no housekeeping in a copy that does not hold the role, nor in a herdr-app check copy;
//   28. across the seam, end to end: the writer's run writes the archive files, a reading copy (reader.js
//       loadArchive) lists exactly the archived items from exactly those files, the dialog's Reopen event
//       (posted through Reader post) is applied by the writer (its pre-read, store.js restore): the item is
//       back, open, same id and handle, session.archived one fewer, and the archived row is gone;
//   29. the review's fixes: a failed config.json read archives no item (turn records still go); an act for an
//       item the run took is said in the note; an archive write that gets no answer, on a timer that fires,
//       keeps its items. (24 also: the size trigger waits for HOUSE_GROWTH since the last run's end, and a
//       retention change lets it run again.)
//   node tests/test_writer.mjs <empty scratch folder>      (tests/test-store.sh)
import assert from "node:assert/strict";
import * as fsm from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
const dir = process.argv[2];
if (!dir) { console.error("usage: test_writer.mjs <scratch folder>"); process.exit(2); }
const MOD = new URL("../../", import.meta.url).pathname, FIX = new URL("./fixtures/spool-stall/", import.meta.url).pathname;
const CAP = 1048576;

// The modules and a herdr stub with Herdr's cap (herdr.d.ts: readTextFile "up to 1 MiB"; probed: 1,048,577 refused).
const lib = `${dir}/lib`, home = `${dir}/home`, data = `${home}/ledgr-data`, spool = `${data}/spool`;
fsm.mkdirSync(`${lib}/node_modules/herdr`, { recursive: true });
fsm.mkdirSync(spool, { recursive: true });
// reader.js and what it imports (nav.js, fixtures.js, listing.js): section 28 reads the archive back as the panel does.
for (const f of ["store.js", "config.js", "branch.js", "confluence.js", "words.js", "writer.js", "spool.js", "reader.js", "nav.js", "fixtures.js", "listing.js"]) fsm.copyFileSync(`${MOD}${f}`, `${lib}/${f}`);
fsm.writeFileSync(`${lib}/package.json`, '{"type":"module"}');
fsm.writeFileSync(`${lib}/node_modules/herdr/package.json`, '{"name":"herdr","type":"module","main":"index.js"}');
fsm.writeFileSync(`${lib}/node_modules/herdr/index.js`, `
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
const H = () => globalThis.__herdr ?? {};
const S = (globalThis.__shared ??= {});
const CAP = ${CAP};
const big = () => new Error("Text file exceeds 1 MiB");
export const appHome = () => H().home ?? "/tmp/nowhere";
export const home = () => "/tmp";
// Each can be replaced by a hook in globalThis.__herdr, which gets the real one as its last argument.
const realRead = async (p) => {
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  if (b.length > CAP) throw big();
  return b.toString("utf8");
};
const realWrite = async (p, text, expected) => {
  if (Buffer.byteLength(text) > CAP) throw big();
  const cur = fs.existsSync(p) ? fs.readFileSync(p) : null;
  if (cur && cur.length > CAP) throw big();
  if ((cur === null ? null : cur.toString("utf8")) !== expected) throw new Error("stale snapshot");
  fs.writeFileSync(p + ".w", text); fs.renameSync(p + ".w", p);
  return null;
};
const realExec = async (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
export const readTextFile = (p) => (H().readTextFile ? H().readTextFile(p, realRead) : realRead(p));
export const writeTextFile = (p, text, expected) => (H().writeTextFile ? H().writeTextFile(p, text, expected, realWrite) : realWrite(p, text, expected));
export const exec = (cmd, args, opts) => (H().exec ? H().exec(cmd, args, opts, realExec) : realExec(cmd, args));
export const shared = (k) => S[k] ?? null;
export const setShared = (k, v) => { S[k] = v; };
export const watchFolder = () => new Promise(() => {});
export const agents = () => [];
export const terminals = () => [];
export const panes = () => [];
export const focused = () => null;
export const layout = () => null;
export const run = () => {};
export const hc = async () => ({ code: 1, stdout: "", stderr: "" });
export const openOverlay = () => null;
`);
globalThis.__herdr = { home };
const { Store, passageHash } = await import(`${lib}/store.js`);
const WR = await import(`${lib}/writer.js`);
const { Writer, writerClaim } = WR;
const SP = await import(`${lib}/spool.js`);
const W = await import(`${lib}/words.js`);
const H = await import(`${lib}/node_modules/herdr/index.js`);

let checks = 0;
const A = new Proxy(assert, { get: (t, k) => (...a) => { checks++; return t[k](...a); } });
const bytes = (s) => Buffer.byteLength(s);
const ls = (d) => (fsm.existsSync(d) ? fsm.readdirSync(d).filter((n) => !n.startsWith(".")).sort() : []);
const spoolFiles = () => ls(spool).filter((n) => n.endsWith(".json"));
const cx = { spawn: (f) => Promise.resolve().then(() => f(cx)).catch(() => {}), timer: { after: () => {}, every: () => {} }, notify: () => {}, sleep: async () => {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, what, ms = 10000) {   // a bound for a hang, not a timing claim
  for (const end = Date.now() + ms; Date.now() < end; await sleep(5)) if (cond()) return true;
  throw new Error(`timed out waiting for: ${what}`);
}

// overCap counts UTF-8 bytes, not characters.
A.equal(SP.overCap("x".repeat(CAP)), false); A.equal(SP.overCap("x".repeat(CAP + 1)), true);
A.equal(SP.overCap("é".repeat(CAP / 2)), false, "two bytes each: exactly 1 MiB"); A.equal(SP.overCap("é".repeat(CAP / 2) + "x"), true);
A.equal(SP.overCap("€".repeat(349526)), true, "three bytes each"); A.equal(SP.overCap("😀".repeat(CAP / 4)), false, "a surrogate pair is four bytes");
A.equal(SP.overCap(null), false);

// ── 1. the stalled event on a store just under the cap ─────────────────────
const SID = "86ab3881-1c67-47b9-83ca-00bffc6b3226", NAME = "1794515705629-asks-30111-1ef35b.json";
const stallText = fsm.readFileSync(`${FIX}${NAME}`, "utf8");
const stall = JSON.parse(stallText);
A.equal(stall.type, "asks"); A.equal(stall.source, "tool"); A.equal(stall.asks.length, 9);
// A filler session of closed asks, like the live store's (1,041,470 bytes on 2026-11-12).
const st0 = Store.fromText(null);
// Sections 1 to 17 test the stalls, not retention: housekeeping is not due in them (run just now, and not the
// first after the upgrade); sections 18 to 27 test it on stores of their own.
st0.d.retention = { v: 1, at: Date.now() }; st0.d.houseAt = Date.now();
const FS = "ffffffff-0000-4000-8000-000000000001";
st0.apply({ v: 1, id: "f0", type: "session_start", at: 1794400000000, terminal: "t90", session_id: FS, source: "startup", turn: 0, agent: "claude-code" });
for (let i = 0; bytes(st0.toText()) < 1041470; i++) {
  const text = `Filler ask ${i}: ${"a long closed ask of an old session, kept until housekeeping archives it. ".repeat(12)}`.slice(0, 400);
  st0.d.items[`aq_fill-${i}`] = { id: `aq_fill-${i}`, key: `${FS}|a|${i}`, handle: `A${i + 1}`, direction: "agent_to_human", text, kind: "decide",
    options: ["one", "two"], recommended: "one", blocking: false, level: "needed", status: "resolved", origin: "tool", terminal: "t90",
    anchor: { sessionId: FS, turn: 1, promptId: "p1", uuid: null, quote: text.slice(0, 300), hash: passageHash(text), settled: true },
    createdTurn: 1, createdAt: 1794400000000, updatedAt: 1794400000000, seq: i, resolvedAt: 1794400000000 };
}
const startText = st0.toText();
A.ok(bytes(startText) >= 1041470 && !SP.overCap(startText), `the store starts just under the cap (${bytes(startText)} bytes)`);
fsm.writeFileSync(`${data}/store.json`, startText);
const probe = Store.fromText(startText); probe.apply(stall);
A.ok(SP.overCap(probe.toText()), `the nine asks take it past 1 MiB (${bytes(probe.toText())} bytes)`);
await A.rejects(H.writeTextFile(`${data}/store.json`, probe.toText(), startText), /Text file exceeds 1 MiB/, "what stalled the writer: writeTextFile refuses it");

const wr = new Writer("test");
wr.booted = true; wr.claim(); wr.started = true;
wr.live = Store.fromText(startText); wr.storeText = startText; wr.live.threshold = "blocking";   // the maintainer's extract.threshold
fsm.writeFileSync(`${spool}/${NAME}`, stallText);
await wr.reader.drain(cx);
A.deepEqual(spoolFiles(), [], "the stalled event left the spool");
const disk1 = fsm.readFileSync(`${data}/store.json`, "utf8");
A.ok(SP.overCap(disk1), `store.json written past 1 MiB (${bytes(disk1)} bytes)`);
A.ok(disk1 === wr.storeText, "store.json is what the writer last wrote (publish's diag follows with the next write)");
A.deepEqual(ls(data).filter((n) => n.includes(".large-")), [], "no temporary file left");
A.deepEqual(fsm.readdirSync(data).filter((n) => n.includes(".large-")), [], "...dotfiles included");
const st1 = Store.fromText(disk1);
const nine = st1.itemsOf(SID).filter((it) => it.direction === "agent_to_human" && it.createdTurn === 98).sort((a, b) => a.seq - b.seq);
A.equal(nine.length, 9, "nine asks");
A.deepEqual(nine.map((it) => it.handle), ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"], "handles assigned");
A.ok(nine.every((it) => it.level === "blocking" && it.status === "open" && it.origin === "tool" && it.kind === "decide"), "blocking, open, declared by tool");
A.ok(nine.every((it, i) => it.text.startsWith(`Q${i + 1} `)), "in order, Q1 to Q9");
A.deepEqual(nine.map((it) => it.options.length), [2, 2, 2, 2, 2, 2, 2, 2, 2], "options kept");
A.equal(nine[0].recommended, "coding agents in a terminal only", "recommendation kept");
st1.threshold = "blocking";
const chip = st1.chips(stall.at + 1000)[stall.terminal];
A.equal(chip.s, SID); A.equal(chip.b, 9, "the chip counts nine blocking"); A.equal(chip.a, 9); A.equal(chip.st, "blocking");
A.equal(wr.fault, null, "no fault"); A.equal(writerClaim().fault, undefined); A.equal(W.writerHealthWords(writerClaim()), null, "nothing on the status line");
await wr.writeChain;
const snap = JSON.parse(fsm.readFileSync(`${data}/snapshot.json`, "utf8"));
A.ok(JSON.stringify(snap).includes("Q9 Model, time and cost"), "snapshot.json follows (what the MCP server reads the handles from)");

// ── 2. store.json that cannot be written: a visible fault, the event waits, then applies ───
const ev2 = { v: 1, id: "ev2-prompt", type: "prompt", at: stall.at + 60000, terminal: "t26", session_id: SID, turn: 99, prompt_id: "p99", local: false, prompt_head: "next", refs: [] };
const N2 = `${ev2.at}-prompt-1-aaaaa.json`;
fsm.writeFileSync(`${spool}/${N2}`, JSON.stringify(ev2));
globalThis.__herdr.exec = async () => ({ code: 1, stdout: "", stderr: "mv: rename: Operation not permitted" });
await wr.reader.drain(cx);
A.deepEqual(spoolFiles(), [N2], "not written: the event stays in the spool");
A.ok(fsm.readFileSync(`${data}/store.json`, "utf8") === disk1, "store.json untouched");
A.match(writerClaim().fault ?? "", /^store\.json not written: mv exited 1/, "the fault is in the claim");
A.match(W.writerHealthWords(writerClaim()), /^ledgr writer: store\.json not written: mv exited 1.*; new events wait in the spool$/, "...and on the status line");
delete globalThis.__herdr.exec;
await wr.reader.drain(cx);
A.deepEqual(spoolFiles(), [], "written once mv works: the event applied");
A.equal(Store.fromText(fsm.readFileSync(`${data}/store.json`, "utf8")).d.sessions[SID].turn, 99);
A.equal(writerClaim().fault, undefined, "the fault clears"); A.equal(wr.fault, null);
// A store.json the writer could not read at start (storeText null) is never replaced past the cap.
const onDisk = fsm.readFileSync(`${data}/store.json`, "utf8"), kept = wr.storeText;
wr.storeText = null;
A.match(String(await wr.writeStoreText(wr.live.toText() + " ")), /not read when the writer started; not replaced/);
A.ok(fsm.readFileSync(`${data}/store.json`, "utf8") === onDisk, "...and it is untouched");
wr.storeText = kept;

// ── 3. an event that throws: quarantined, nothing of it kept, the next one applies ───
const real = wr.live.on_asks;
wr.live.on_asks = function (ev, s, at) {
  if (ev.id === "ev-boom") { s.boomMark = true; this.d.items.junk = { id: "junk" }; throw new Error("synthetic: on_asks blew up"); }
  return real.call(this, ev, s, at);
};
const boom = { v: 1, id: "ev-boom", type: "asks", at: stall.at + 120000, terminal: "t26", session_id: SID, turn: 99, source: "tool", tool_call: 1,
  asks: [{ text: "Never applied", kind: "decide", level: "blocking" }] };
const ev3 = { v: 1, id: "ev3-stop", type: "stop", at: stall.at + 121000, terminal: "t26", session_id: SID, turn: 99, prompt_id: "p99", text_path: null, text_head: "done", passage_hash: "abc", message_uuid: "u99" };
const NB = `${boom.at}-asks-2-bbbbb.json`, N3 = `${ev3.at}-stop-3-ccccc.json`;
const boomText = JSON.stringify(boom);
fsm.writeFileSync(`${spool}/${NB}`, boomText);
fsm.writeFileSync(`${spool}/${N3}`, JSON.stringify(ev3));
await wr.reader.drain(cx);
A.deepEqual(spoolFiles(), [], "both files left the spool");
const fdir = `${spool}/failed`;
A.deepEqual(ls(fdir), [NB.replace(/\.json$/, ".error.txt"), NB], "the throwing event is in spool/failed, its error beside it");
A.equal(fsm.readFileSync(`${fdir}/${NB}`, "utf8"), boomText, "kept byte for byte (never lost)");
const err = fsm.readFileSync(`${fdir}/${NB.replace(/\.json$/, ".error.txt")}`, "utf8");
A.match(err, /error: {3}synthetic: on_asks blew up/); A.match(err, /\n\s+at /, "with the stack"); A.match(err, /move .* back to ledgr-data\/spool\//);
const st3 = Store.fromText(fsm.readFileSync(`${data}/store.json`, "utf8"));
A.equal(st3.d.sessions[SID].boomMark, undefined, "nothing of the throwing event in the store");
A.equal(st3.d.items.junk, undefined); A.ok(!st3.d.ingested.includes("ev-boom"), "...not even its id");
A.ok(!st3.items().some((it) => it.text === "Never applied"));
A.ok(st3.d.ingested.includes("ev3-stop"), "the event after it applied"); A.equal(st3.d.turns[SID][99].uuid, "u99");
A.equal(wr.live.d.sessions[SID].boomMark, undefined, "...nor in the live store");
A.equal(wr.reader.failed, 1); A.equal(writerClaim().failed, 1, "the claim counts it");
A.equal(W.writerHealthWords(writerClaim()), "1 event failed, see spool/failed", "the status line");
A.equal(W.failedEventsWords(2), "2 events failed, see spool/failed");
A.equal(await SP.countFailed(), 1);
await wr.reader.drain(cx);
A.deepEqual(ls(fdir).length, 2, "a later pass leaves spool/failed alone");
// A batch whose first event throws and whose others apply, in one pass.
const ev4 = { ...ev2, id: "ev4-prompt", at: stall.at + 180000, turn: 100, prompt_id: "p100" };
const boom2 = { ...boom, id: "ev-boom", at: stall.at + 179000 };   // the same id: it throws again
const NB2 = `${boom2.at}-asks-4-ddddd.json`, N4 = `${ev4.at}-prompt-5-eeeee.json`;
fsm.writeFileSync(`${spool}/${NB2}`, JSON.stringify(boom2)); fsm.writeFileSync(`${spool}/${N4}`, JSON.stringify(ev4));
const r4 = await wr.applyBatch([{ name: NB2, ev: boom2, text: JSON.stringify(boom2) }, { name: N4, ev: ev4, text: JSON.stringify(ev4) }], cx);
A.deepEqual(r4.failed.map((f) => f.name), [NB2], "applyBatch names the event that threw");
A.equal(wr.live.d.sessions[SID].turn, 100, "...and applied the one after it");
fsm.unlinkSync(`${spool}/${NB2}`); fsm.unlinkSync(`${spool}/${N4}`);
wr.live.on_asks = real;

// ── 4. the heartbeat: a tick renews the claim ───
H.setShared("ledgr.writer", { ...writerClaim(), at: 1 });
wr.live.d.houseAt = Date.now();   // housekeeping not due
wr.tick(cx);
await until(() => Date.now() - writerClaim().at < 5000, "the tick's beat").catch(() => {});
A.ok(Date.now() - writerClaim().at < 5000, "the tick renewed `at`"); A.equal(writerClaim().id, wr.id); A.equal(writerClaim().failed, 1, "...with the health");
A.ok(writerClaim().done > 0 && writerClaim().pass === undefined, "the claim says when the last pass ended, and that none runs");

// ── 2026-11-19: a writer that holds the claim but does not move ─────────────
// The incident: one pass applied its events, saved store.json past 1 MiB and never returned; its
// `running` stayed true, every later drain returned at once, and the tick kept the claim fresh. Herdr
// leaves a cancelled task's promise pending for ever, so a stub await that never settles stands in for it.
const storeNow = () => Store.fromText(fsm.readFileSync(`${data}/store.json`, "utf8"));
const largeTmps = () => fsm.readdirSync(data).filter((n) => /\.large-/.test(n));
const logText = () => (fsm.existsSync(`${data}/log/writer.log`) ? fsm.readFileSync(`${data}/log/writer.log`, "utf8") : "");
// How many times each event id was applied (not skipped as already ingested), on any Store.
const appliedN = new Map();
const realApply = Store.prototype.apply;
Store.prototype.apply = function (ev) {
  const r = realApply.call(this, ev);
  if (r?.applied && ev?.id) appliedN.set(ev.id, (appliedN.get(ev.id) ?? 0) + 1);
  return r;
};
const ingestedN = (st, id) => st.d.ingested.filter((x) => x === id).length;
const promptEv = (id, turn, at) => ({ v: 1, id, type: "prompt", at, terminal: "t26", session_id: SID, turn, prompt_id: `p${turn}`, local: false, prompt_head: `turn ${turn}`, refs: [] });
const spoolName = (ev, n) => `${ev.at}-prompt-${n}-${String(n).padStart(5, "0")}.json`;
// A cx whose timer is real (the limits of spool.js within fire).
const rcx = { spawn: (f) => Promise.resolve().then(() => f(rcx)).catch(() => {}), notify: () => {}, sleep: (ms) => sleep(Math.min(ms, 20)),
  timer: { after: (ms, f) => { const h = setTimeout(() => f(rcx), ms); return { cancel: () => clearTimeout(h), is_done: () => false }; }, every: () => {} } };

// within(): a limit on an await, from the cx's timer; none without one.
A.equal(await SP.within(rcx, 1000, Promise.resolve(7), "x"), 7, "within: passes a value through");
await A.rejects(SP.within(rcx, 1000, Promise.reject(new Error("boom")), "x"), /boom/, "...and a rejection");
await A.rejects(SP.within(rcx, 20, new Promise(() => {}), "waiting on the host"), (e) => e.timedOut === true && /^waiting on the host: no answer in 0 s$/.test(e.message), "...and gives up on a promise that never settles");
A.equal(await SP.within(cx, 20, Promise.resolve(8), "x"), 8, "a cx whose timer gives no task: the promise alone");
A.equal(SP.spanWords(95000), "95 s"); A.equal(SP.spanWords(12 * 60e3), "12 min"); A.equal(SP.spanWords(192 * 60e3), "3 h 12 min"); A.equal(SP.spanWords(500), "0.5 s");
A.equal(W.waitWords(95000), "95 s", "words.js says a wait the same way"); A.equal(W.waitWords(192 * 60e3), "3 h 12 min");
A.equal(W.WRITER_STUCK_MS, WR.PASS_STUCK_MS, "words.js WRITER_STUCK_MS is writer.js PASS_STUCK_MS");
A.ok(WR.PASS_STUCK_MS >= 3 * 30000 && WR.PASS_STUCK_MS < 120000, "the bound: three times Herdr's default exec limit, under the claim's two minutes");
A.ok(WR.TAKEOVER_STUCK_MS > WR.PASS_STUCK_MS + 60000, "a takeover only after the holder's own watchdog had its tick");
A.equal(WR.claimStuck(null), 0); A.equal(WR.claimStuck({ id: "x", at: 1 }), 0, "a claim that says nothing: not stuck");
A.equal(WR.claimStuck({ pass: { since: 1000 } }, 61000), 60000, "a pass: since its step began");
A.equal(WR.claimStuck({ stall: { at: 1000, ms: 95000, ok: false, kind: "pass" } }, 11000), 105000, "a stall not come back from: its time stuck so far");
A.equal(WR.claimStuck({ stall: { at: 1000, ms: 95000, ok: true, kind: "pass" } }, 11000), 0, "...come back: 0");
A.equal(WR.claimStuck({ stall: { at: 1000, ms: 95000, ok: false, kind: "spool" } }, 11000), 0, "an event that waits is not the holder being stuck");

// The reader alone: a pass given up (abandon) unlinks nothing when its apply settles late, and leaves the
// pass after it running; a role lost between unlinks leaves the rest to the next writer.
{
  const names = ["1000-prompt-1-aaaaa.json", "1001-prompt-1-bbbbb.json", "1002-prompt-1-ccccc.json"];
  for (const [i, n] of names.entries()) fsm.writeFileSync(`${spool}/${n}`, JSON.stringify(promptEv(`rd-${i}`, 1, 1000 + i)));
  let release = null, calls = 0;
  const rd = new SP.SpoolReader(() => { calls++; return calls === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(true); });
  const d1 = rd.drain(cx);
  await until(() => release && rd.pass?.step === "apply", "the reader's pass to wait in apply");
  A.equal(rd.pass.epoch, 0); A.ok(rd.running);
  const given = rd.abandon();
  A.equal(given.step, "apply", "abandon returns the pass it gave up"); A.equal(rd.running, false); A.equal(rd.pass, null); A.equal(rd.epoch, 1);
  let release2 = null;
  rd.apply = () => new Promise((r) => { release2 = r; });
  rd.drain(cx);
  await until(() => release2, "the next pass to start at once");
  const next = rd.pass;
  release(true);                                            // the given-up pass's apply settles, late
  await d1;
  A.deepEqual(spoolFiles(), names, "the given-up pass unlinked nothing");
  A.ok(rd.running && rd.pass === next, "...and left the pass after it running");
  release2(true);
  await until(() => !rd.running, "the second pass to end");
  A.deepEqual(spoolFiles(), [], "the second pass unlinked them"); A.ok(rd.done > 0 && rd.pass === null);
  for (const [i, n] of names.entries()) fsm.writeFileSync(`${spool}/${n}`, JSON.stringify(promptEv(`rd-${i}`, 1, 1000 + i)));
  let oks = 0;
  const rd2 = new SP.SpoolReader(async () => true, null, () => ++oks <= 1);
  await rd2.drain(cx);
  A.deepEqual(spoolFiles(), names.slice(1), "the role lost after the first unlink: the rest stay for the next writer");
  A.equal(rd2.running, false, "...and the pass ends"); A.equal(rd2.applied, 1);
  for (const n of names.slice(1)) fsm.unlinkSync(`${spool}/${n}`);
}

// ── 5. the incident's shape: the mv runs, its answer never comes ──
let execOpts = null, hung = 0;
globalThis.__herdr.exec = (cmd, args, opts, real) => {
  execOpts = opts;
  if (cmd === "/bin/mv" && args[2] === `${data}/store.json` && hung === 0) { hung++; real(cmd, args); return new Promise(() => {}); }
  return real(cmd, args);
};
const ev5 = promptEv("ev5-prompt", 101, stall.at + 240000), N5 = spoolName(ev5, 6);
fsm.writeFileSync(`${spool}/${N5}`, JSON.stringify(ev5));
const gen0 = wr.gen;
wr.reader.drain(cx);                                        // never settles
await until(() => wr.reader.pass?.step === "save: store.json mv", "the pass to wait in the mv");
A.ok(ingestedN(storeNow(), "ev5-prompt") === 1, "the mv ran: store.json holds the event");
A.deepEqual(spoolFiles(), [N5], "...and its spool file is still there (the unlink loop was never reached)");
A.equal(execOpts?.timeout, WR.SAVE_TIMEOUT_MS, "the mv is given exec's own timeout");
await wr.reader.drain(cx);
A.deepEqual(spoolFiles(), [N5], "a later drain returns at once (the pass is still running)");
wr.beat();
A.equal(writerClaim().pass?.step, "save: store.json mv", "the claim names the step the pass waits in");
A.ok(writerClaim().pass.since <= Date.now() && writerClaim().pass.at <= writerClaim().pass.since, "...since when, and when the pass began");
A.equal(W.writerHealthWords(writerClaim()), "1 event failed, see spool/failed", "a few seconds in: nothing said yet");
wr.reader.pass.since -= 95000; wr.reader.pass.at -= 96000;   // 95 s later
wr.beat();
A.match(W.writerHealthWords(writerClaim()), /^ledgr writer: no progress for 95 s \(in save: store\.json mv\); new events wait in the spool/, "the claim alone says no progress (a holder without the watchdog)");
const abandoned0 = wr.reader.abandoned;
wr.tick(cx);                                                 // the watchdog
A.equal(wr.stall?.kind, "pass"); A.equal(wr.stall?.step, "save: store.json mv"); A.ok(wr.stall.ms >= 95000);
A.equal(wr.reader.abandoned, abandoned0 + 1, "the pass is given up"); A.ok(wr.gen > gen0, "...a new generation");
await until(() => !wr.starting && wr.started, "the restart");
A.deepEqual(spoolFiles(), [], "restarted from store.json: the waiting file is gone");
const st5 = storeNow();
A.equal(ingestedN(st5, "ev5-prompt"), 1, "the event once in store.json"); A.equal(st5.d.sessions[SID].turn, 101);
A.equal(appliedN.get("ev5-prompt"), 1, "applied once: the restart read store.json and skipped it as ingested");
A.equal(wr.stall.ok, true, "the stall came back"); A.equal(writerClaim().fault, undefined, "no fault in the claim");
A.equal(writerClaim().stall?.ok, true, "the claim keeps the finding");
A.match(W.writerHealthWords(writerClaim()), /^ledgr writer restarted just now after 95 s stuck in save: store\.json mv \(log\/writer\.log\) · 1 event failed/, "the status line says it restarted");
A.equal(W.writerHealthWords(writerClaim(), Date.now() + W.STALL_SHOWN_MS + 1000), "1 event failed, see spool/failed", "...for ten minutes");
await wr.logChain;
A.match(logText(), /stuck 95 s in save: store\.json mv \(pass; pass started .*save chain in store\.json mv since .*restart 1 of 3\)/, "writer.log names the await, the pass and the save chain");
A.match(logText(), /started \(restart\), generation \d+: store\.json \d+ characters, 1 spool file\(s\) taken in; back after 95 s stuck in save: store\.json mv/, "...and the restart");
A.deepEqual(largeTmps(), [], "no temporary file left");

// ── 6. a given-up save that settles late: its mv never lands, nothing of it is recorded ──
let late = null;
globalThis.__herdr.exec = (cmd, args, opts, real) => {
  if (cmd === "/bin/mv" && args[2] === `${data}/store.json` && !late) return new Promise((resolve) => { late = { cmd, args, resolve, real }; });
  return real(cmd, args);
};
const ev6 = promptEv("ev6-prompt", 102, stall.at + 300000), N6 = spoolName(ev6, 7);
fsm.writeFileSync(`${spool}/${N6}`, JSON.stringify(ev6));
const before6 = fsm.readFileSync(`${data}/store.json`, "utf8");
const d6 = wr.reader.drain(cx);
await until(() => late && wr.reader.pass?.step === "save: store.json mv", "the pass to wait in an mv that has not run");
A.equal(largeTmps().length, 1, "its temporary copy is there, not moved"); A.ok(fsm.readFileSync(`${data}/store.json`, "utf8") === before6, "store.json untouched");
const tmp6 = largeTmps()[0];
wr.reader.pass.since -= 100000;
wr.tick(cx);
await until(() => !wr.starting && wr.started, "the restart");
A.ok(!fsm.existsSync(`${data}/${tmp6}`), "the restart removed the old temporary copy before reading store.json");
A.deepEqual(spoolFiles(), [], "the restart applied the event");
const mid6 = fsm.readFileSync(`${data}/store.json`, "utf8");
A.equal(ingestedN(Store.fromText(mid6), "ev6-prompt"), 1);
const faultBefore = wr.fault, textBefore = wr.storeText;
late.resolve(await late.real(late.cmd, late.args));         // the old mv runs now, late
await d6;                                                    // the given-up pass returns
A.ok(fsm.readFileSync(`${data}/store.json`, "utf8") === mid6, "the late mv found nothing to move: store.json is the restart's");
A.equal(wr.fault, faultBefore, "the given-up save set no fault"); A.ok(wr.storeText === textBefore, "...and recorded no text");
A.equal(writerClaim().fault, undefined); A.deepEqual(largeTmps(), [], "and left no temporary file");
delete globalThis.__herdr.exec;

// ── 7. a timed-out large write: a fault, not a hang; the store whole; the event applies later ──
const big = JSON.stringify({ x: "y".repeat(CAP + 10) });
globalThis.__herdr.exec = (cmd, args, opts, real) => (cmd === "/bin/mv" ? new Promise(() => {}) : real(cmd, args));
const t0 = Date.now();
const e7 = await WR.writeLarge(`${dir}/big.json`, big, { cx: rcx, ms: 400 });
A.match(String(e7), /^mv: no answer in 0\.4 s$/, "writeLarge: an mv that never answers is an error"); A.ok(Date.now() - t0 < 5000, "...within its limit (0.4 s here; without one it would wait for ever)");
A.ok(!fsm.existsSync(`${dir}/big.json`) && fsm.readdirSync(dir).every((n) => !n.includes(".large-")), "...the file not made, the temporary copy removed");
let steps = [];
A.equal(await WR.writeLarge(`${dir}/big.json`, big, { cx: rcx, ms: 400, ok: () => false, step: (s) => steps.push(s) }), "given up before the move (a newer writer pass owns the file)",
  "writeLarge asks ok() right before the mv");
A.deepEqual(steps, ["temporary copy", "read back"], "...and names each wait");
A.ok(fsm.readdirSync(dir).every((n) => !n.includes(".large-")), "...and removes its copy");
wr.saveTimeout = 400;
const ev7 = promptEv("ev7-prompt", 103, stall.at + 360000), N7 = spoolName(ev7, 8);
fsm.writeFileSync(`${spool}/${N7}`, JSON.stringify(ev7));
const before7 = fsm.readFileSync(`${data}/store.json`, "utf8");
await wr.reader.drain(rcx);                                  // a pass whose cx has a real timer
A.deepEqual(spoolFiles(), [N7], "the save got no answer: the event waits"); A.equal(wr.reader.running, false, "...and the pass ended");
A.ok(fsm.readFileSync(`${data}/store.json`, "utf8") === before7, "store.json whole, untouched"); A.deepEqual(largeTmps(), []);
A.match(writerClaim().fault ?? "", /^store\.json not written: mv: no answer in 0\.4 s/, "the fault is in the claim");
A.match(W.writerHealthWords(writerClaim()), /^ledgr writer: store\.json not written: mv: no answer in 0\.4 s; new events wait in the spool/, "...and on the status line");
delete globalThis.__herdr.exec;
await wr.reader.drain(cx);
A.deepEqual(spoolFiles(), [], "the host answers again: applied"); A.equal(writerClaim().fault, undefined, "the fault clears");
A.equal(ingestedN(storeNow(), "ev7-prompt"), 1);
wr.saveTimeout = WR.SAVE_TIMEOUT_MS; wr.cx = cx;
await wr.logChain;
A.match(logText(), /fault: store\.json not written: mv: no answer in 0\.4 s/); A.match(logText(), /fault cleared/);

// ── 8. an event the passes do not apply (unreadable: over 1 MiB): restarted once, then said, not again ──
const oldAt = Date.now() - 200000, NB8 = `${oldAt}-asks-9-fffff.json`;
fsm.writeFileSync(`${spool}/${NB8}`, JSON.stringify({ v: 1, id: "ev-huge", type: "asks", at: oldAt, pad: "z".repeat(CAP) }));
const ev8 = promptEv("ev8-prompt", 104, Date.now()), N8 = spoolName(ev8, 9);
fsm.writeFileSync(`${spool}/${N8}`, JSON.stringify(ev8));
const n8 = wr.stalls;
wr.tick(cx);
await until(() => wr.stalls === n8 + 1 && !wr.starting && wr.started, "the restart for the waiting event");
A.equal(wr.stall.kind, "spool"); A.equal(wr.stall.name, NB8); A.ok(wr.stall.ms >= 200000);
A.deepEqual(spoolFiles(), [NB8], "the event after it applied; the unreadable one still waits");
A.equal(ingestedN(storeNow(), "ev8-prompt"), 1);
A.match(writerClaim().fault ?? "", new RegExp(`^${NB8.replace(/\./g, "\\.")} has waited \\d+ min in the spool and is not applied`), "the claim's fault names it");
const lu8 = wr.lastUnstick, gen8 = wr.gen, ms8 = wr.stall.ms;
wr.tick(cx);
await until(() => wr.stall.ms > ms8, "the next tick's check");
A.equal(wr.stalls, n8 + 1, "a later tick: still waiting, the same finding"); A.equal(wr.lastUnstick, lu8, "...not restarted again"); A.equal(wr.gen, gen8);
A.match(W.writerHealthWords(writerClaim()), new RegExp(`^ledgr writer: ${NB8.replace(/\./g, "\\.")} has waited \\d+ min in the spool and is not applied \\(log/writer\\.log\\)`), "the status line names it");
fsm.unlinkSync(`${spool}/${NB8}`);
wr.tick(cx);
await until(() => wr.stall.ok === true, "the finding to come back").catch(() => {});
A.equal(wr.stall.ok, true, "gone: the finding comes back"); A.equal(writerClaim().fault, undefined);

// ── 9. restarts that never finish a pass: MAX_UNSTICKS restarts, then a back-off that keeps the claim ──
// (2026-11-19 review: giving the role up left one host's chips frozen and the status line silent.)
let hang9 = true;
globalThis.__herdr.exec = (cmd, args, opts, real) => (hang9 && cmd === "/bin/mv" && args[2] === `${data}/store.json` ? new Promise(() => {}) : real(cmd, args));
const ev9 = promptEv("ev9-prompt", 105, Date.now()), N9 = spoolName(ev9, 10);
fsm.writeFileSync(`${spool}/${N9}`, JSON.stringify(ev9));
wr.reader.drain(cx);
const stuckAgain = async (what) => {
  await until(() => wr.progress() && /mv$/.test(wr.progress().step), what);
  if (wr.reader.pass) wr.reader.pass.since -= 100000; else wr.startSince -= 100000;
  wr.tick(cx);
};
for (let i = 1; i <= WR.MAX_UNSTICKS; i++) {
  await stuckAgain(`stuck again (${i})`);
  A.equal(wr.unstickRun, i, `restart ${i} counted`); A.equal(wr.coolUntil, 0, "...and done at once");
}
await stuckAgain("stuck a fourth time");
A.ok(Math.abs(wr.coolUntil - Date.now() - WR.BACKOFF_MS) < 5000, "the fourth time: it backs off BACKOFF_MS before the next restart");
A.equal(wr.retired, false, "...and keeps trying, not retired"); A.equal(wr.starting, false, "nothing restarts meanwhile");
A.equal(writerClaim()?.id, wr.id, "the claim stays this copy's");
A.equal(writerClaim().stall.tries, 3); A.equal(writerClaim().stall.retryAt, wr.coolUntil);
A.match(writerClaim().fault ?? "", /^stuck \d+ s in .*mv; 3 restarts in a row finished no pass, the next in 5 min \(log\/writer\.log\)$/, "the claim's fault says when it tries again");
A.match(W.writerHealthWords(writerClaim()), /^ledgr writer stuck in .*mv: 3 restarts in a row did not help; it tries again in 5 min, or relaunch Herdr \(log\/writer\.log\); new events wait in the spool/, "...and the status line");
A.ok(WR.claimStuck(writerClaim(), Date.now() + 200000) > WR.TAKEOVER_STUCK_MS, "a backing-off claim is one another host or the panel takes over");
A.deepEqual(spoolFiles(), [N9], "the event waits in the spool, not lost");
H.setShared("ledgr.writer", { ...writerClaim(), at: 1 });
const g9 = wr.gen;
wr.tick(cx);
A.ok(Date.now() - writerClaim().at < 5000, "a tick while backing off renews the claim"); A.equal(wr.gen, g9, "...and restarts nothing"); A.equal(wr.starting, false);
wr.respond(cx); wr.probe(cx); A.equal(wr.gen, g9, "neither respond nor probe restarts it meanwhile");
wr.coolUntil = Date.now() - 1;                               // the wait is over; the host still does not answer
wr.tick(cx);
A.equal(wr.starting, true, "the back-off over: it starts again");
await stuckAgain("stuck after the back-off");
A.ok(Math.abs(wr.coolUntil - Date.now() - 2 * WR.BACKOFF_MS) < 5000, "stuck again: twice as long");
const fault9 = writerClaim().fault;
hang9 = false;                                               // the host answers again
wr.coolUntil = Date.now() - 1;
wr.tick(cx);
await until(() => !wr.starting && wr.started, "the restart after the back-off");
A.deepEqual(spoolFiles(), [], "it starts again and applies the waiting event"); A.equal(ingestedN(storeNow(), "ev9-prompt"), 1);
A.equal(wr.stall.ok, true); A.equal(wr.coolUntil, 0); A.equal(writerClaim().fault, undefined, "the fault goes"); A.ok(fault9 && /the next in 10 min/.test(fault9));
await wr.logChain;
A.match(logText(), /3 restarts in a row finished no pass; the next in 5 min\. The claim stays and says so/, "writer.log says it backs off");
A.match(logText(), /4 restarts in a row finished no pass; the next in 10 min/);
A.match(logText(), /back-off over: starting again \(the role is still this copy's\)/);
A.deepEqual(largeTmps(), [], "no temporary file left");
delete globalThis.__herdr.exec;

// ── 10. another host takes over a fresh claim that has not moved; the old pass settles late, harmlessly ──
const hA = new Writer("hostA"), hB = new Writer("hostB");
hA.booted = true; hB.booted = true;
await hA.start(cx);
A.ok(hA.amWriter(), "host A takes the role"); A.deepEqual(spoolFiles(), []); A.equal(ingestedN(storeNow(), "ev9-prompt"), 1);
let lateA = null;
globalThis.__herdr.exec = (cmd, args, opts, real) => {
  if (cmd === "/bin/mv" && args[2] === `${data}/store.json` && !lateA) return new Promise((resolve) => { lateA = { cmd, args, resolve, real }; });
  return real(cmd, args);
};
const ev10 = promptEv("ev10-prompt", 106, Date.now()), N10 = spoolName(ev10, 11);
fsm.writeFileSync(`${spool}/${N10}`, JSON.stringify(ev10));
const dA = hA.reader.drain(cx);
await until(() => lateA, "host A's mv");
// A holder without the watchdog (an older engine copy) beats with a pass stuck for five minutes.
hA.reader.pass.since -= 300000;
hA.beat();
hB.probe(cx);
A.equal(hB.starting, true, "host B takes the fresh but stuck claim at once, without a ping");
await until(() => !hB.starting && hB.started, "host B's start");
A.equal(writerClaim().id, hB.id, "host B holds the role"); A.equal(hA.amWriter(), false, "host A no longer writes");
A.deepEqual(spoolFiles(), [], "host B applied the waiting event"); A.equal(ingestedN(storeNow(), "ev10-prompt"), 1);
const mid10 = fsm.readFileSync(`${data}/store.json`, "utf8");
const ev11 = promptEv("ev11-prompt", 107, Date.now()), N11 = spoolName(ev11, 12);
globalThis.__herdr.writeTextFile = (p, text, expected, real) => (p === `${data}/store.json` ? Promise.reject(new Error("disk full")) : real(p, text, expected));
globalThis.__herdr.exec = (cmd, args, opts, real) => (cmd === "/bin/mv" && args[2] === `${data}/store.json` ? Promise.resolve({ code: 1, stdout: "", stderr: "disk full" }) : real(cmd, args));
fsm.writeFileSync(`${spool}/${N11}`, JSON.stringify(ev11));
await hB.reader.drain(cx);
A.deepEqual(spoolFiles(), [N11], "host B cannot save: the event waits");
lateA.resolve(await lateA.real(lateA.cmd, lateA.args));     // host A's old mv, late
await dA;                                                    // host A's old pass returns
A.ok(fsm.readFileSync(`${data}/store.json`, "utf8") === mid10, "host A's late mv landed nothing (host B's start removed its copy)");
A.deepEqual(spoolFiles(), [N11], "...and host A's old pass unlinked nothing");
delete globalThis.__herdr.writeTextFile; delete globalThis.__herdr.exec;
await hB.reader.drain(cx);
A.deepEqual(spoolFiles(), [], "host B saves again: applied"); A.equal(ingestedN(storeNow(), "ev11-prompt"), 1);
hA.tick(cx);
A.equal(writerClaim().id, hB.id, "host A's tick leaves host B's claim alone"); A.equal(hA.starting, false);
await hB.logChain;
A.match(logText(), /hostB .* taking the role from hostA: its claim is fresh but it has not moved for 5 min \(save: store\.json mv\)/, "writer.log says who took over and why");
A.match(logText(), /hostB .* started \(from hostA \(stuck\)\)/);

// ── 11. writer.log stays small ──
for (let i = 0; i < 700; i++) hB.log(`line ${i} ${"x".repeat(100)}`);
await hB.logChain;
const lg = logText();
A.ok(lg.length <= WR.WRITER_LOG_MAX && lg.length > WR.WRITER_LOG_MAX - 400, `writer.log kept to its last ${WR.WRITER_LOG_MAX} bytes (${lg.length})`);
A.match(lg, /line 699 x+\n$/, "...ending with the newest line"); A.match(lg, /^\d{13} \d{4}-/, "...and starting on a whole line");
// ── 12. review finding 1: a restart that cannot prove no temporary copy is left does not read store.json ──
// The given-up pass's mv (past its ok()) is pending in the host while the restart's listing of ledgr-data
// gets no answer. Before: the sweep counted that as "nothing to remove", the restart applied and unlinked a
// new event, and the old mv then put the old store back: the event was lost. Now the start fails, the
// watchdog starts again once the listing answers, and the late mv finds nothing to move.
const fsp = createRequire(import.meta.url)("fs/promises");
const realReaddir = fsp.readdir, realWriteFile = fsp.writeFile;
const patchFs = (o) => { Object.assign(fsp, o); syncBuiltinESMExports(); };
let late12 = null;
globalThis.__herdr.exec = (cmd, args, opts, real) => {
  if (cmd === "/bin/mv" && args[2] === `${data}/store.json` && !late12) return new Promise((resolve) => { late12 = { cmd, args, resolve, real }; });
  return real(cmd, args);
};
const ev12 = promptEv("ev12-prompt", 108, Date.now()), N12 = spoolName(ev12, 13);
fsm.writeFileSync(`${spool}/${N12}`, JSON.stringify(ev12));
const d12 = hB.reader.drain(cx);
await until(() => late12 && hB.reader.pass?.step === "save: store.json mv", "host B's pass to wait in an mv that has not run");
patchFs({ readdir: async (p, ...r) => { if (String(p).replace(/\/+$/, "") === data) throw Object.assign(new Error("listing ledgr-data: no answer in 20 s"), { timedOut: true }); return realReaddir(p, ...r); } });
hB.reader.pass.since -= 100000;
hB.tick(cx);
await until(() => !hB.starting, "the restart to end");
A.equal(hB.started, false, "the sweep could not list ledgr-data: the start fails, store.json is not read");
A.match(hB.note ?? "", /listing ledgr-data: no answer in 20 s/, "...and says why");
A.deepEqual(spoolFiles(), [N12], "the event waits (nothing read, nothing unlinked)");
patchFs({ readdir: realReaddir });
hB.tick(cx);                                                 // the watchdog: a start that ended without starting
A.equal(hB.stall.kind, "start"); A.match(hB.stall.step, /^start: temporary files \(it ended without starting\)$/);
await until(() => !hB.starting && hB.started, "the next restart");
A.deepEqual(spoolFiles(), [], "the listing answers: the copy removed, the event applied");
const ev13 = promptEv("ev13-prompt", 109, Date.now()), N13 = spoolName(ev13, 14);
fsm.writeFileSync(`${spool}/${N13}`, JSON.stringify(ev13));
await hB.reader.drain(cx);
A.deepEqual(spoolFiles(), [], "a new event applied and unlinked");
const mid12 = fsm.readFileSync(`${data}/store.json`, "utf8");
late12.resolve(await late12.real(late12.cmd, late12.args)); // the given-up pass's mv runs now
await d12;
A.ok(fsm.readFileSync(`${data}/store.json`, "utf8") === mid12, "the late mv found nothing to move");
const hD = new Writer("hostD"); hD.booted = true;
await hD.start(cx);
A.ok(hD.live.d.ingested.includes("ev12-prompt") && hD.live.d.ingested.includes("ev13-prompt"), "a writer starting from disk has both events: none lost");
hB.booted = true; await hB.start(cx);                         // host B takes the role back for what follows
delete globalThis.__herdr.exec;

// ── 13. an old pass that reaches the mv after the generation changed: ok() says no ──
// Its temporary copy is written late (after the restart's sweep found none), read back, and then ok(),
// asked right before the mv, is false: nothing moves in. (The sweep cannot help here; only ok() can.)
let late13 = null;
patchFs({ writeFile: (p, d) => (String(p).includes("/.store.json.large-") && !late13 ? new Promise((res) => { late13 = { p, d, res }; }) : realWriteFile(p, d)) });
const ev14 = promptEv("ev14-prompt", 110, Date.now()), N14 = spoolName(ev14, 15);
fsm.writeFileSync(`${spool}/${N14}`, JSON.stringify(ev14));
const d13 = hB.reader.drain(cx);
await until(() => late13 && hB.reader.pass?.step === "save: store.json temporary copy", "host B's pass to wait writing its temporary copy");
A.deepEqual(largeTmps(), [], "the copy is not there yet");
hB.reader.pass.since -= 100000;
hB.tick(cx);
await until(() => !hB.starting && hB.started, "the restart");
A.deepEqual(spoolFiles(), [], "the restart applied the event");
patchFs({ writeFile: realWriteFile });
// One more event after the restart, so the old pass's text (the store before it) differs from the file.
const ev15 = promptEv("ev15-prompt", 111, Date.now()), N15 = spoolName(ev15, 16);
fsm.writeFileSync(`${spool}/${N15}`, JSON.stringify(ev15));
await hB.reader.drain(cx);
A.deepEqual(spoolFiles(), [], "a new event applied and unlinked");
const mid13 = fsm.readFileSync(`${data}/store.json`, "utf8");
await realWriteFile(late13.p, late13.d); late13.res();      // the old copy lands now, late
await d13;
A.ok(fsm.readFileSync(`${data}/store.json`, "utf8") === mid13, "the old pass read its copy back, asked ok(), and moved nothing in");
A.deepEqual(largeTmps(), [], "...and removed its copy");
A.equal(ingestedN(storeNow(), "ev14-prompt"), 1); A.equal(ingestedN(storeNow(), "ev15-prompt"), 1, "the event after the restart kept");

// ── 14. a start that lost the race does not sweep the holder's temporary copy (review minor 8) ──
const hC = new Writer("hostC"); hC.booted = true;
const held14 = writerClaim(), tmp14 = `${data}/.store.json.large-1-aaaaa`;
fsm.writeFileSync(tmp14, "in flight");
await hC.start({ ...cx, sleep: async () => { H.setShared("ledgr.writer", held14); } });   // the holder claims again meanwhile
A.ok(fsm.existsSync(tmp14), "the holder's copy is left alone"); A.equal(hC.started, false); A.equal(writerClaim().id, hB.id);
fsm.unlinkSync(tmp14);

// ── 15. the config watch is one per generation, and the tick reads every map record again (review minor 9) ──
A.equal(hB.watchingConfig, true);
hB.abandon(); A.equal(hB.watchingConfig, false, "abandon lets the next start begin a config watch");
await hB.start(cx); A.equal(hB.watchingConfig, true, "...which it does");
fsm.mkdirSync(`${data}/terminals`, { recursive: true });
fsm.writeFileSync(`${data}/terminals/t26.json`, JSON.stringify({ v: 1, terminal: "t26", session_id: SID, space: "space-15", updated_at: Date.now() }));
hB.tick(cx);
await until(() => storeNow().d.terminals.t26?.space === "space-15", "the tick's rescan of the identity map");
A.equal(storeNow().d.sessions[SID].space, "space-15", "the tick brings a map record's space in without the watch");
fsm.unlinkSync(`${data}/terminals/t26.json`);

// ── 16. an append made again from the file at each try (review item 7) ──
const ap = `${dir}/append.txt`;
fsm.writeFileSync(ap, "one\n");
let raced = false;
globalThis.__herdr.writeTextFile = (p, text, expected, real) => {
  if (p === ap && !raced) { raced = true; fsm.appendFileSync(ap, "landed meanwhile\n"); }   // another write lands between the read and this one
  return real(p, text, expected);
};
A.equal(await SP.writeAtomicWith(ap, (cur) => `${cur}two\n`), true);
A.equal(fsm.readFileSync(ap, "utf8"), "one\nlanded meanwhile\ntwo\n", "writeAtomicWith: the retry keeps the line that landed (writeAtomic's wrote over it)");
A.equal(await SP.writeAtomicWith(ap, (cur) => (cur.includes("two") ? null : `${cur}two\n`)), true, "nothing to write: true");
A.equal(fsm.readFileSync(ap, "utf8"), "one\nlanded meanwhile\ntwo\n");
delete globalThis.__herdr.writeTextFile;
const dsid = "dddddddd-0000-4000-8000-000000000001", dpath = `${data}/sessions/${dsid}/decisions.md`;
fsm.mkdirSync(`${data}/sessions/${dsid}`, { recursive: true });
fsm.writeFileSync(dpath, "# decisions\n- br_1 adopted\n");
A.equal(await hB.appendDecision({ sid: dsid, key: "br_2", line: "- br_2 adopted", header: "# decisions\n" }), true);
A.equal(await hB.appendDecision({ sid: dsid, key: "br_2", line: "- br_2 adopted", header: "# decisions\n" }), true);
A.equal(fsm.readFileSync(dpath, "utf8"), "# decisions\n- br_1 adopted\n- br_2 adopted\n", "decisions.md: appended once, nothing lost");

// ── 17. a panel's fallback whose start hangs: its own tick (panel.js ticks it while it is not the writer) restarts it ──
const pw = new Writer("panel"); pw.booted = true;
patchFs({ readdir: (p, ...r) => (String(p).replace(/\/+$/, "") === data ? new Promise(() => {}) : realReaddir(p, ...r)) });   // the sweep's listing never answers
pw.start(cx);
await until(() => pw.startStep === "temporary files", "the fallback's start to wait in its sweep");
A.equal(pw.amWriter(), false, "starting, it is not the writer yet"); A.equal(writerClaim().id, pw.id);
pw.startSince -= 100000;
const gen17 = pw.gen;
pw.tick(cx);
A.equal(pw.stall.kind, "start"); A.equal(pw.stall.step, "start: temporary files"); A.ok(pw.gen > gen17, "the tick's watchdog gave the hung start up");
patchFs({ readdir: realReaddir });
await until(() => !pw.starting && pw.started, "the fallback's restart");
A.ok(pw.amWriter(), "and the fallback writes"); A.equal(pw.stall.ok, true);
hB.booted = true; await hB.start(cx);                         // a host takes the role back

Store.prototype.apply = realApply;

// ══ Retention (2026-11-19): writer.js housekeep, in a home of its own ══════════
delete globalThis.__herdr.exec; delete globalThis.__herdr.writeTextFile; delete globalThis.__herdr.readTextFile;
patchFs({ readdir: realReaddir, writeFile: realWriteFile });
const C = await import(`${lib}/config.js`);
const home2 = `${dir}/home2`, data2 = `${home2}/ledgr-data`, spool2 = `${data2}/spool`, arch = `${data2}/archive`, store2 = `${data2}/store.json`;
globalThis.__herdr.home = home2;
const DAYMS = 86400e3, T0 = Date.now(), HOURMS = 3600e3;
const sidN = (n) => `5e55${String(n).padStart(4, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SIDS = Array.from({ length: 30 }, (_, n) => sidN(n));
const longText = (tag) => `${tag}: ${"an ask of an old session, long enough to weigh what the live ones weigh. ".repeat(8)}`.slice(0, 400);
// Item ids as the store makes them (newId("rq"), store.js ITEM_ID: what a restored record must carry).
const itemId = (sid, i, dir = "agent_to_human") => `rq_${sid.slice(0, 8)}-${dir === "agent_to_human" ? "a" : "q"}${i}`;
function mkItem(sid, n, i, { status = "resolved", age = 10, dir = "agent_to_human", level = "needed" } = {}) {
  const at = T0 - age * DAYMS, text = longText(`S${n} item ${i}`);
  return { id: itemId(sid, i, dir), key: `${sid}|${i}`, handle: `${dir === "agent_to_human" ? "A" : "Q"}${i + 1}`, direction: dir, text,
    kind: dir === "agent_to_human" ? "decide" : "question", options: ["one", "two"], recommended: "one", blocking: false, level, status, origin: "tool",
    terminal: `t${n}`, anchor: { sessionId: sid, turn: 1 + (i % 20), promptId: "p1", uuid: null, quote: text.slice(0, 300), hash: passageHash(text), settled: true },
    createdTurn: 1, createdAt: at, updatedAt: at, seq: i, ...(status === "resolved" || status === "dismissed" ? { resolvedAt: at, resolvedBy: "agent" } : {}) };
}
// A store like the live one on 2026-11-19 (1.76 MB: closed items 46 %, turn records 30 %, open asks below the
// threshold, the rest): per session `closed` items resolved 10 days ago (the first session `heavy`, so its items
// split over files), a closed parked question and an ask dismissed 8 days ago (archived), one dismissed 5 days
// ago and one resolved yesterday (kept), `open` open asks (kept however old), a pin, and `turns` turn records.
// Returns {st, archive: ids that leave the store, keep: ids that stay}.
function bigStore({ sessions = SIDS, heavy = 440, closed = 7, open = 8, turns = 20, head = 500 } = {}) {
  const st = Store.fromText(null), archive = new Set(), keep = new Set();
  for (const [n, sid] of sessions.entries()) {
    st.apply({ v: 1, id: `ss-${sid}`, type: "session_start", at: T0 - 20 * DAYMS, terminal: `t${n}`, session_id: sid, source: "startup", turn: 0, agent: "claude-code", cwd: "/tmp/work" });
    let i = 0;
    const add = (set, o = {}) => { const it = mkItem(sid, n, i++, o); st.d.items[it.id] = it; set.add(it.id); };
    for (let k = 0; k < (n === 0 ? heavy : closed); k++) add(archive);
    add(archive, { dir: "human_to_agent" });
    add(archive, { status: "dismissed", age: 8 });
    add(keep, { status: "dismissed", age: 5 });
    add(keep, { status: "resolved", age: 1 });
    for (let k = 0; k < open; k++) add(keep, { status: "open", level: "optional" });
    st.d.sessions[sid].nextHandle = { A: i + 1, Q: i + 1, P: 2 };   // past every handle given (store.js restoreItem keeps one below it)
    const pid = `pn_${sid.slice(0, 8)}-pin1`;
    st.d.pins[pid] = { id: pid, sessionId: sid, handle: "P1", text: "a pinned passage", status: "open", createdAt: T0 - 30 * DAYMS, anchor: { sessionId: sid, turn: 1 } };
    const recs = (st.d.turns[sid] ??= {});
    for (let k = 1; k <= turns; k++) {
      recs[k] = { stopAt: T0 - (turns - k) * HOURMS, textPath: `turns/${sid}/${k}.md`, textHead: `turn ${k}: ${"y".repeat(head)}`, promptId: `p${k}`, uuid: `u-${n}-${k}`,
        asks: { source: "tool", error: null, errorDetail: null, blockError: null, count: 1, at: T0, model: null, provider: null } };
    }
    st.d.sessions[sid].turn = turns;
  }
  return { st, archive, keep };
}
const due = (st) => { st.d.retention = { v: 1, at: T0 - 5 * DAYMS }; st.d.houseAt = T0 - 2 * DAYMS; return st; };   // a daily run, not the first
const storeOf = () => Store.fromText(fsm.readFileSync(store2, "utf8"));
const archFiles = (sid, kind = "") => ls(`${arch}/${SP.archiveDir(sid)}`).filter((n) => n.startsWith(kind));
const fileLines = (p) => fsm.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const msOf = (name) => Number(String(name).split("-")[1]);
const base = (p) => String(p).split("/").pop();
const spool2Files = () => ls(spool2).filter((n) => n.endsWith(".json"));
const log2 = () => (fsm.existsSync(`${data2}/log/writer.log`) ? fsm.readFileSync(`${data2}/log/writer.log`, "utf8") : "");
// A clean ledgr-data holding this store, retention_days 3 and retention.turns 12 in config.json.
function freshHome(st) {
  fsm.rmSync(data2, { recursive: true, force: true });
  fsm.mkdirSync(spool2, { recursive: true });
  fsm.writeFileSync(`${data2}/config.json`, JSON.stringify({ v: 1, retention_days: 3, retention: { turns: 12 } }));
  const text = st.toText();
  fsm.writeFileSync(store2, text);
  return text;
}
// A host that takes the role (start: claim, sweep, store.json, drain, then housekeeping when due, its own task).
async function houseWriter(role = "house") { const w = new Writer(role); w.booted = true; await w.start(cx); return w; }
const hsteps = [];
const realHouseStep = Writer.prototype.houseStep;
Writer.prototype.houseStep = function (gen, s) { hsteps.push(s); return realHouseStep.call(this, gen, s); };
const unhook = () => { delete globalThis.__herdr.exec; delete globalThis.__herdr.writeTextFile; delete globalThis.__herdr.readTextFile; };

// ── 18. the pure parts ──
{
  A.equal(WR.HOUSE_SIZE, 768 * 1024); A.equal(WR.ARCHIVE_FILE_MAX, 512 * 1024); A.ok(WR.ARCHIVE_FILE_MAX < CAP, "an archive file stays under Herdr's text-file cap");
  A.equal(WR.turnsKept({ retention: { turns: 12 } }), 12); A.equal(WR.turnsKept({ retention: { turns: "20" } }), 20);
  A.equal(WR.turnsKept({ retention: { turns: 0 } }), C.LIMITS.turnHeads, "clamped: never fewer than the head records (the live turn is kept)");
  A.equal(WR.turnsKept({ retention: { turns: 99.7 } }), 60, "...nor more than turnRec's cap");
  A.equal(WR.turnsKept({}), C.DEFAULTS.retention.turns, "absent: the default"); A.equal(WR.turnsKept({ retention: { turns: "x" } }), 12); A.equal(WR.turnsKept(null), 12);
  const { chunks, over } = WR.archiveChunks(["a".repeat(10), "b".repeat(10), "é".repeat(5), "c".repeat(30), "d"], 22);
  A.deepEqual(chunks.map((c) => c.idx), [[0, 1], [2, 4]], "lines into chunks of at most max bytes (UTF-8, each with its newline)");
  A.equal(chunks[0].text, `${"a".repeat(10)}\n${"b".repeat(10)}\n`); A.ok(chunks.every((c) => bytes(c.text) <= 22));
  A.deepEqual(over, [3], "a line alone over max is written nowhere");
  A.equal(SP.byteLength("é€😀x"), 2 + 3 + 4 + 1);
  A.equal(SP.archiveDir("5e550000-0000-4000-8000-000000000000"), "5e550000-0000-4000-8000-000000000000");
  A.equal(SP.archiveDir("herdr:t3/x y"), "herdr_t3_x_y", "safe_name's mapping");
  A.equal(SP.archiveDir(".."), null); A.equal(SP.archiveDir("."), null); A.equal(SP.archiveDir(""), null); A.equal(SP.archiveDir(null), null);
  A.deepEqual(SP.archiveFileOf("s1", "items-1794-abc123.jsonl"), { rel: "archive/s1/items-1794-abc123.jsonl", legacy: false });
  A.deepEqual(SP.archiveFileOf("s1", "2026-10.jsonl"), { rel: "archive/2026-10.jsonl", legacy: true }, "a legacy month file");
  for (const bad of ["../store.json", "a/items-1-abc123.jsonl", "items-1-abc123.jsonl/..", ".items-1-abc123.jsonl", "turns-1-abc123.jsonl",
    "items-1-ABC123.jsonl", "items-1-abc123.jsonl\n", "2026-10.jsonl/../x", "", null, 7]) A.ok(SP.archiveFileOf("s1", bad).error, `refused: ${JSON.stringify(bad)}`);
  A.ok(SP.archiveFileOf("..", "items-1-abc123.jsonl").error, "a session id that names .. is refused");
  const l1 = JSON.stringify({ id: "rq_1", text: "older", anchor: { sessionId: "s1" } }), l2 = JSON.stringify({ id: "rq_1", text: "newer", anchor: { sessionId: "s1" } });
  A.equal(SP.archivedRecord(`${l1}\n{broken\n${l2}\n`, "s1", "rq_1").record.text, "newer", "the last line for the id");
  A.match(SP.archivedRecord(`${l1}\n`, "s2", "rq_1").error, /another session's/);
  A.match(SP.archivedRecord(`${l1}\n`, "s1", "rq_10").error, /rq_10 is not in that file/, "an id that only contains another's is not it");
  A.match(SP.archivedRecord(l1, "s1", "").error, /names no item/);
}

// ── 19. the first run after the upgrade, on a 1.7 MB store ──
{
  const { st, archive, keep } = bigStore();
  const text0 = freshHome(st), orig = JSON.parse(text0);
  A.ok(bytes(text0) > 1.65e6 && bytes(text0) < 1.85e6, `a 1.7 MB store (${bytes(text0)} bytes), no d.retention`); A.equal(orig.retention, undefined);
  const writes = [], mvs = [];
  globalThis.__herdr.writeTextFile = (p, text, expected, real) => { writes.push({ p, expected }); return real(p, text, expected); };
  globalThis.__herdr.exec = (cmd, args, opts, real) => { if (cmd === "/bin/mv") mvs.push(args[2]); return real(cmd, args); };
  hsteps.length = 0;
  const w = await houseWriter();
  A.ok(w.amWriter() && !w.starting, "the start ends without waiting for housekeeping");
  A.ok(w.houseRun && w.house?.why === "first run", "...which runs as its own task: the first run after the upgrade");
  const t = await w.houseRun;
  A.equal(t.failed.length, 0, `no file failed (${t.failed[0] ?? ""})`);
  A.equal(t.items, archive.size, `${archive.size} closed items archived`); A.equal(t.cut, 30 * 8, "8 turn records cut per session (20, 12 kept)");
  A.equal(t.heads, 30 * 10, "10 textHeads moved per session (the newest 2 keep theirs)"); A.equal(t.stayed, 0);
  // The one-time copy: the store as it was, kept.
  const copies = ls(data2).filter((n) => /^store\.pre-retention-\d+\.json$/.test(n));
  A.equal(copies.length, 1, "store.pre-retention-<ms>.json written"); A.ok(fsm.readFileSync(`${data2}/${copies[0]}`, "utf8") === text0, "...holding the store as it was");
  A.ok(mvs.includes(`${data2}/${copies[0]}`), "...through writeLarge (it is over the cap)");
  A.deepEqual(fsm.readdirSync(data2).filter((n) => n.includes(".large-")), [], "no temporary file left");
  const s = storeOf(), disk = fsm.readFileSync(store2, "utf8");
  A.equal(s.d.retention?.v, 1, "d.retention v 1 saved"); A.ok(s.d.retention.at >= T0); A.ok(s.d.houseAt >= T0, "houseAt saved");
  // The store: what stays, stays as it was.
  A.ok([...archive].every((id) => !s.item(id)), "every archived item left the store");
  A.ok([...keep].every((id) => JSON.stringify(s.item(id)) === JSON.stringify(orig.items[id])), "open, recently closed and recently dismissed items stay untouched");
  A.equal(s.pins().length, 30, "pins never leave the store"); A.ok(s.pins().every((p) => p.status === "open"));
  for (const sid of SIDS) {
    const recs = s.d.turns[sid], ks = Object.keys(recs).map(Number).sort((a, b) => a - b);
    A.deepEqual(ks, Array.from({ length: 12 }, (_, i) => 9 + i), `${sid.slice(0, 8)}: the newest 12 turn records kept`);
    A.deepEqual(ks.filter((k) => recs[k].textHead), [19, 20], "...the newest 2 with their textHead");
    A.equal(Number(s.d.sessions[sid].archived), [...archive].filter((id) => orig.items[id].anchor.sessionId === sid).length, "session.archived counts them");
  }
  A.ok(!SP.overCap(disk), `store.json under 1 MiB (${bytes(disk)} bytes)`); A.ok(bytes(disk) < WR.HOUSE_SIZE, "...and under HOUSE_SIZE");
  A.equal(mvs.filter((p) => p === store2).length, 1, "the first save after the trim went through writeLarge (the old text was over the cap)");
  // The archive files: per session, new, under the cap, each line as it was.
  A.deepEqual(ls(arch).filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)), [], "no month file (the old append is gone)");
  A.deepEqual(ls(arch).sort(), SIDS.map((sid) => SP.archiveDir(sid)).sort(), "one folder per session");
  const all = SIDS.flatMap((sid) => archFiles(sid).map((n) => `${arch}/${SP.archiveDir(sid)}/${n}`));
  A.ok(all.every((p) => /\/(items|turns)-\d+-[a-z0-9]{6}\.jsonl$/.test(p)), "named <kind>-<ms>-<rand6>.jsonl");
  A.ok(all.every((p) => fsm.statSync(p).size <= WR.ARCHIVE_FILE_MAX), `every file at most ARCHIVE_FILE_MAX (largest ${Math.max(...all.map((p) => fsm.statSync(p).size))})`);
  A.ok(archFiles(SIDS[0], "items-").length >= 2, `the heavy session's items split over ${archFiles(SIDS[0], "items-").length} files`);
  A.equal(all.length, t.files, "t.files counts them");
  const archWrites = writes.filter((c) => c.p.includes("/archive/"));
  A.equal(archWrites.length, all.length, "one write per file"); A.ok(archWrites.every((c) => c.expected === null), "...each create-only (writeTextFile's expected null)");
  const itemLines = all.filter((p) => /\/items-/.test(p)).flatMap(fileLines);
  A.equal(itemLines.length, archive.size); A.deepEqual(new Set(itemLines.map((it) => it.id)), archive, "every archived item has its line");
  A.ok(itemLines.every((it) => JSON.stringify(it) === JSON.stringify(orig.items[it.id])), "...the item exactly as it was in the store");
  A.ok(all.filter((p) => /\/items-/.test(p)).every((p) => fileLines(p).every((it) => p.includes(`/${SP.archiveDir(it.anchor.sessionId)}/`))), "...in its own session's folder");
  const turnLines = all.filter((p) => /\/turns-/.test(p)).flatMap(fileLines);
  const cuts = turnLines.filter((l) => l.rec), heads = turnLines.filter((l) => "textHead" in l);
  A.equal(cuts.length, 240); A.equal(heads.length, 300); A.equal(turnLines.length, 540, "a turn line is a cut record or a head");
  A.ok(cuts.every((l) => l.turn <= 8 && JSON.stringify(l.rec) === JSON.stringify(orig.turns[l.sessionId][l.turn])), "a cut record as it was");
  A.ok(heads.every((l) => l.turn >= 9 && l.turn <= 18 && l.textHead === orig.turns[l.sessionId][l.turn].textHead && !l.rec), "a head: {sessionId, turn, textHead}");
  // Every file was a named step (the watchdog sees the run move), and the copy too.
  for (const p of all) {
    const rel = p.slice(data2.length + 1);
    A.ok(hsteps.includes(`writing ${rel}`) && hsteps.includes(`reading back ${rel}`), `a step per file: ${rel.slice(-40)}`);
  }
  A.ok(hsteps.some((x) => /^keeping store\.pre-retention-\d+\.json: mv$/.test(x)), "the copy's hsteps named too");
  await w.logChain;
  A.match(log2(), /housekeeping \(first run\): \d+ closed item\(s\) and 240 turn record\(s\) archived, 300 textHead\(s\) moved, in \d+ file\(s\); store\.json \d+ -> \d+ characters; the store as it was kept in store\.pre-retention-\d+\.json/, "writer.log says what the run did");
  A.equal(w.house, null, "the run is over"); A.equal(w.progress(), null); w.beat(); A.equal(writerClaim().pass, undefined, "...and the claim says no pass runs");
  // The next save is on writeTextFile again.
  writes.length = 0; mvs.length = 0;
  const ev = promptEv("house-next", 21, Date.now()); ev.session_id = SIDS[1];
  fsm.writeFileSync(`${spool2}/${spoolName(ev, 30)}`, JSON.stringify(ev));
  await w.reader.drain(cx);
  A.deepEqual(spool2Files(), [], "the next event applied");
  A.ok(!mvs.includes(store2), "...and saved without writeLarge"); A.ok(writes.some((c) => c.p === store2 && c.expected !== null), "...with writeTextFile's compare-and-swap");
  A.equal(storeOf().d.sessions[SIDS[1]].turn, 21);
  A.equal(w.houseDue(), null, "not due again: run just now");
  w.houseTry = 0; A.equal(w.houseDue(), null, "...nor by size (under HOUSE_SIZE), nor by day, nor as the first run");
  unhook();
}

// ── 20. create-only: a name already taken fails its write; a read-back that differs; both kept, archived next run ──
{
  const S = SIDS.slice(0, 3), { st } = bigStore({ sessions: S, heavy: 7, open: 1, turns: 14 });
  due(st); freshHome(st);
  const orig = JSON.parse(st.toText());
  const [dA, dB, dC] = S.map((sid) => SP.archiveDir(sid));
  let taken = null, garbled = null;
  globalThis.__herdr.writeTextFile = (p, text, expected, real) => {
    if (!taken && p.includes(`/archive/${dA}/items-`)) { taken = p; fsm.writeFileSync(p, "taken by another write\n"); }   // the same name, there first
    return real(p, text, expected);
  };
  globalThis.__herdr.readTextFile = (p, real) => {
    if (!garbled && p.includes(`/archive/${dB}/items-`)) { garbled = p; return real(p).then((x) => x.slice(0, -40)); }   // read back short
    return real(p);
  };
  const w = await houseWriter();
  const t = await w.houseRun;
  A.equal(w.house, null); A.ok(taken && garbled);
  A.equal(fsm.readFileSync(taken, "utf8"), "taken by another write\n", "the file already there is not written over");
  const s = storeOf();
  const idsOf = (sid) => Object.values(orig.items).filter((it) => it.anchor.sessionId === sid && it.status !== "open" && it.updatedAt < T0 - 7.5 * DAYMS).map((it) => it.id);
  A.ok(idsOf(S[0]).every((id) => s.item(id)), "its items stay in the store");
  A.ok(idsOf(S[1]).every((id) => s.item(id)), "a file whose read-back differs: its items stay in the store");
  A.ok(fsm.existsSync(garbled), "...though the file is there");
  A.ok(idsOf(S[2]).every((id) => !s.item(id)), "the third session's items archived");
  A.equal(Object.keys(s.d.turns[S[0]]).length, 12, "the first session's turn file was its own: its records cut");
  A.equal(t.failed.length, 2); A.match(t.failed[0], /not written: stale snapshot/); A.match(t.failed[1], /read back other text/);
  A.match(w.note ?? "", /^housekeeping: 2 archive file\(s\) not written .*; the next run tries again$/, "the note says so");
  await w.logChain; A.match(log2(), /2 file\(s\) not written, their contents kept in the store/);
  A.equal(s.d.retention.v, 1, "d.retention as it was");
  unhook();
  w.houseTry = 0; w.live.d.houseAt = Date.now() - 2 * DAYMS;
  const t2 = await w.houseKick(cx);
  A.equal(t2.failed.length, 0); A.equal(t2.items, idsOf(S[0]).length + idsOf(S[1]).length, "the next run archives them");
  const s2 = storeOf();
  A.ok([...idsOf(S[0]), ...idsOf(S[1])].every((id) => !s2.item(id)));
  const bFiles = archFiles(S[1], "items-");
  A.equal(bFiles.length, 2, "the second session has two item files: the unconfirmed one and the new one");
  A.ok(msOf(bFiles[1]) > msOf(bFiles[0]) && bFiles[1] !== base(garbled), "...the new one newer (the reading rule takes its lines)");
  A.deepEqual(new Set(fileLines(`${arch}/${dB}/${bFiles[1]}`).map((it) => it.id)), new Set(idsOf(S[1])), "...holding every item: a harmless duplicate");
  A.deepEqual(archFiles(S[0], "items-").filter((n) => n !== base(taken)).length, 1, "the first session's items in a file of their own name");
}

// ── 21. a run given up between writing a file and saving: the store whole, a duplicate later ──
{
  const S = SIDS.slice(3, 5), { st, archive } = bigStore({ sessions: S, heavy: 7, open: 1, turns: 14 });
  due(st); const text0 = freshHome(st);
  let held = null;
  globalThis.__herdr.readTextFile = (p, real) => (!held && p.includes("/archive/") ? new Promise((res) => { held = { p, res, real }; }) : real(p));
  const w = await houseWriter();
  const run1 = w.houseRun;
  await until(() => held, "the run to wait reading its first file back");
  A.ok(fsm.existsSync(held.p), "the file is written");
  A.match(w.progress().step, /^housekeeping: reading back archive\/[^/]+\/items-\d+-[a-z0-9]{6}\.jsonl$/, "progress() names the run's step");
  w.beat(); A.match(writerClaim().pass?.step ?? "", /^housekeeping: reading back archive\//, "...and so does the claim");
  w.house.since -= 100000;
  const gen = w.gen;
  w.tick(cx);                                                // the watchdog
  A.equal(w.stall?.kind, "house", "the watchdog finds the run stuck"); A.match(w.stall.step, /^housekeeping: reading back archive\//); A.ok(w.gen > gen);
  await until(() => !w.starting && w.started, "the restart");
  A.ok(w.houseRun === run1, "the restart begins no run (one began within the hour)");
  held.res(await held.real(held.p));                         // the read-back answers, late
  A.equal(await run1, null, "the given-up run stops");
  A.ok(fsm.readFileSync(store2, "utf8") === text0, "store.json as it was: nothing removed, nothing saved");
  A.ok([...archive].every((id) => w.live.item(id)), "...and the restarted writer holds every item");
  A.equal(w.stall.ok, true, "the finding came back");
  w.houseTry = 0;
  const t = await w.houseKick(cx);
  A.equal(t.items, archive.size, "the next run archives them all");
  const s = storeOf();
  A.ok([...archive].every((id) => !s.item(id)));
  const firstIds = fileLines(held.p).map((it) => it.id);
  const dirOf = held.p.slice(0, held.p.lastIndexOf("/"));
  const others = ls(dirOf).filter((n) => n.startsWith("items-") && n !== base(held.p));
  A.equal(others.length, 1); A.ok(msOf(others[0]) > msOf(base(held.p)), "the new file is newer");
  const again = new Set(fileLines(`${dirOf}/${others[0]}`).map((it) => it.id));
  A.ok(firstIds.length && firstIds.every((id) => again.has(id)), "the given-up run's file is a duplicate, nothing lost");
  unhook();
}

// ── 22. an archive write of a given-up run that lands late: under its own name, older, harmless ──
{
  const S = SIDS.slice(5, 7), { st, archive } = bigStore({ sessions: S, heavy: 7, open: 1, turns: 14 });
  due(st); freshHome(st);
  let held = null;
  globalThis.__herdr.writeTextFile = (p, text, expected, real) => (!held && p.includes("/archive/")
    ? new Promise((res, rej) => { held = { p, text, expected, res, rej, real }; }) : real(p, text, expected));
  const w = await houseWriter();
  const run1 = w.houseRun;
  await until(() => held, "the run to wait in its first write");
  A.equal(held.expected, null, "create-only"); A.ok(!fsm.existsSync(held.p), "not on disk yet");
  A.match(w.progress().step, /^housekeeping: writing archive\/[^/]+\/items-\d+-[a-z0-9]{6}\.jsonl$/);
  w.house.since -= 100000;
  w.tick(cx);
  await until(() => !w.starting && w.started, "the restart");
  w.houseTry = 0;
  const t = await w.houseKick(cx);
  A.equal(t.items, archive.size, "the next run archives everything");
  const after = fsm.readFileSync(store2, "utf8");
  await held.real(held.p, held.text, held.expected); held.res(null);   // the old write lands now
  A.equal(await run1, null, "the old run stops after it");
  A.ok(fsm.readFileSync(store2, "utf8") === after, "store.json unchanged by the late file");
  A.ok(fsm.existsSync(held.p) && fsm.readFileSync(held.p, "utf8") === held.text, "the late file landed under its own name, overwriting nothing");
  const dirOf = held.p.slice(0, held.p.lastIndexOf("/")), lateIds = fileLines(held.p).map((it) => it.id);
  const newer = ls(dirOf).filter((n) => n.startsWith("items-") && n !== base(held.p));
  A.ok(newer.length === 1 && msOf(newer[0]) > msOf(base(held.p)), "the next run's file is newer: the reading rule takes its lines");
  A.ok(lateIds.every((id) => fileLines(`${dirOf}/${newer[0]}`).some((it) => it.id === id)), "...and holds the same items");
  A.ok([...archive].every((id) => !storeOf().item(id)));
  unhook();
}

// ── 23. an item reopened while its archive file was being written stays in the store ──
{
  const S = SIDS[7], { st } = bigStore({ sessions: [S], heavy: 7, open: 1, turns: 4 });
  due(st); freshHome(st);
  let held = null;
  globalThis.__herdr.writeTextFile = (p, text, expected, real) => (!held && p.includes("/archive/") && p.includes("/items-")
    ? new Promise((res, rej) => { held = { p, text, expected, res, rej, real }; }) : real(p, text, expected));
  const w = await houseWriter();
  const run = w.houseRun;
  await until(() => held, "the run to wait writing the items file");
  const X = itemId(S, 0);
  A.ok(held.text.includes(`"id":"${X}"`), "the file being written holds the item");
  const act = { v: 1, id: "reopen-23", type: "act", at: Date.now(), session_id: S, item: X, action: "reopen", arg: null };
  fsm.writeFileSync(`${spool2}/${act.at}-act-mod-aaaaa.json`, JSON.stringify(act));
  await w.reader.drain(cx);
  A.deepEqual(spool2Files(), [], "a drain applies the reopen while the run waits (no event waits behind a run)");
  A.equal(storeOf().item(X)?.status, "open", "...and saves it");
  await held.real(held.p, held.text, held.expected); held.res(null);
  const t = await run;
  A.equal(t.stayed, 1, "the run counts one item changed meanwhile");
  const s = storeOf();
  A.equal(s.item(X)?.status, "open", "the reopened item stays in the store, open");
  A.ok(!s.item(itemId(S, 1)), "the others of its file archived");
  A.ok(fileLines(held.p).some((it) => it.id === X && it.status === "resolved"), "the file keeps its stale line (the store wins over it)");
  unhook();
}

// ── 24. the triggers: size and the hourly limit, a day, the first run, one run at a time ──
{
  const w = new Writer("house24"); w.booted = true; w.claim(); w.started = true;
  w.live = Store.fromText(null); w.live.d.retention = { v: 1, at: T0 };
  const now = Date.now();
  w.storeText = "x".repeat(WR.HOUSE_SIZE + 1); w.live.d.houseAt = now - 2 * HOURMS;
  A.equal(w.houseDue(now), "size", "over HOUSE_SIZE, the last run 2 h ago, no run seen by this copy (a relaunch): one is allowed");
  // The growth since the last run's end (review, 2026-11-19): the live store stays over HOUSE_SIZE after its
  // trim, and an hourly run would write small files for ever.
  A.equal(WR.HOUSE_GROWTH, 64 * 1024);
  w.houseEnd = WR.HOUSE_SIZE + 1 - 10;
  A.equal(w.houseDue(now), null, "grown 10 bytes since the last run ended: not by size");
  w.storeText = "x".repeat(WR.HOUSE_SIZE + 1 - 10 + WR.HOUSE_GROWTH); A.equal(w.houseDue(now), "size", "grown HOUSE_GROWTH: by size again");
  w.storeText = "x".repeat(WR.HOUSE_SIZE + 1); w.houseEnd = null;
  w.live.d.houseAt = now - 30 * 60e3; A.equal(w.houseDue(now), null, "...30 min ago: not before the hour");
  w.storeText = "x".repeat(WR.HOUSE_SIZE); w.live.d.houseAt = now - 2 * HOURMS; A.equal(w.houseDue(now), null, "at HOUSE_SIZE, under a day: not due");
  w.live.d.houseAt = now - 25 * HOURMS; A.equal(w.houseDue(now), "daily", "a day since the last run");
  delete w.live.d.retention; w.live.d.houseAt = now; A.equal(w.houseDue(now), "first run", "no d.retention: the first run after the upgrade");
  w.houseTry = now - 10 * 60e3; A.equal(w.houseDue(now), null, "a run begun 10 min ago holds every trigger back");
  w.houseTry = now - 61 * 60e3; A.equal(w.houseDue(now), "first run");
  w.house = { gen: w.gen, at: now, step: "x", since: now }; A.equal(w.houseDue(now), null, "one run at a time");
  w.house = { gen: w.gen - 1, at: now, step: "x", since: now }; A.equal(w.houseDue(now), "first run", "a run of a given-up generation does not count");
  A.equal(w.progress(), null, "...nor show as this copy's");
  w.house = null;
  // One run through the tick, by size.
  const { st, archive } = bigStore();
  st.d.retention = { v: 1, at: T0 - 5 * DAYMS }; st.d.houseAt = Date.now();
  freshHome(st);
  const w2 = await houseWriter();
  A.equal(w2.houseRun, null, "run just now: none at the start");
  w2.live.d.houseAt = Date.now() - 2 * HOURMS;               // two hours later, the store still 1.7 MB
  A.ok(SP.overCap(w2.storeText, WR.HOUSE_SIZE));
  w2.tick(cx);
  await until(() => w2.houseRun, "the tick to begin a run");
  A.equal(w2.house?.why, "size", "the size trigger");
  const t = await w2.houseRun;
  A.equal(t.items, archive.size); A.ok(bytes(fsm.readFileSync(store2, "utf8")) < WR.HOUSE_SIZE, "the store under HOUSE_SIZE after it");
  A.equal(ls(data2).filter((n) => n.includes("pre-retention")).length, 0, "not the first run: no copy");
  await w2.logChain; A.match(log2(), /housekeeping \(size\): /);
  w2.houseTry = 0; w2.live.d.houseAt = Date.now() - 2 * HOURMS;
  A.equal(w2.houseDue(), null, "under HOUSE_SIZE: the hour passing is not enough");
  // A run that finds nothing: a store over HOUSE_SIZE with nothing past retention and lean records, as on
  // the live data after its first run (0.84 MB). The size trigger fires each hour; no file, no save.
  const { st: st3, archive: a3 } = bigStore({ sessions: SIDS.slice(12, 14), heavy: 0, closed: 0, open: 330, turns: 2 });
  for (const id of a3) delete st3.d.items[id];
  st3.applySlim({ cut: [], heads: [] });
  st3.d.retention = { v: 1, at: T0 - DAYMS }; st3.d.houseAt = Date.now();
  const text3 = freshHome(st3);
  A.ok(SP.overCap(text3, WR.HOUSE_SIZE), `a store over HOUSE_SIZE with nothing to archive (${bytes(text3)} bytes)`);
  const w3 = await houseWriter();
  A.equal(w3.houseRun, null);
  await w3.logChain;                                          // the start's own writer.log line
  const touched = [];
  globalThis.__herdr.writeTextFile = (p, text, expected, real) => { touched.push(p); return real(p, text, expected); };
  globalThis.__herdr.exec = (cmd, args, opts, real) => { touched.push(args[2]); return real(cmd, args); };
  const log0 = log2();
  w3.live.d.houseAt = Date.now() - 2 * HOURMS;
  A.equal(w3.houseDue(), "size");
  const t3 = await w3.houseKick(cx);
  A.deepEqual([t3.files, t3.items, t3.cut, t3.heads, t3.saved], [0, 0, 0, 0, false], "the run found nothing");
  A.deepEqual(touched, [], "no file written, store.json not saved"); A.ok(!fsm.existsSync(arch), "no archive folder made");
  A.ok(fsm.readFileSync(store2, "utf8") === text3, "store.json as it was");
  A.ok(Date.now() - w3.live.d.houseAt < 120000, "houseAt in memory, for the next save"); A.equal(w3.houseDue(), null, "none again within the hour");
  await w3.logChain; A.equal(log2(), log0, "and nothing in writer.log (one line an hour would say nothing)");
  A.equal(w3.houseEnd, bytes(text3), "the run's end recorded: the store's bytes");
  w3.houseTry = 0; w3.live.d.houseAt = Date.now() - 2 * HOURMS;
  A.equal(w3.houseDue(), null, "an hour later, still over HOUSE_SIZE but not grown by HOUSE_GROWTH: no run (no small files every hour)");
  // retention changed (the settings row; the installer's 14 to 3): the size trigger may run again at once.
  w3.applyConfig({ ...w3.cfg, retention_days: 5 });
  A.equal(w3.houseEnd, null, "a retention change forgets the recorded size"); A.equal(w3.houseDue(), "size", "...so a run by size is due");
  w3.applyConfig({ ...w3.cfg, ui: { animations: false } }); w3.houseEnd = 1;
  w3.applyConfig({ ...w3.cfg, ui: { animations: true } }); A.equal(w3.houseEnd, 1, "another config change keeps it");
  unhook();
}

// ── 25. a one-time copy that cannot be written: nothing archived, d.retention not set ──
{
  const S = SIDS[8], { st, archive } = bigStore({ sessions: [S], heavy: 7, open: 1, turns: 14 });
  freshHome(st);
  const stray = `${data2}/.store.pre-retention-1.json.large-1-aaaaa`;   // a given-up copy's temporary file
  fsm.writeFileSync(stray, "in flight");
  globalThis.__herdr.exec = (cmd, args, opts, real) => (cmd === "/bin/mv" && /store\.pre-retention-/.test(args[2]) ? Promise.resolve({ code: 1, stdout: "", stderr: "denied" }) : real(cmd, args));
  const w = await houseWriter();
  A.ok(!fsm.existsSync(stray), "the start's sweep removes a one-time copy's temporary file too");
  A.equal(await w.houseRun, null, "the run stops");
  A.ok(!fsm.existsSync(arch), "nothing archived");
  A.equal(storeOf().d.retention, undefined, "d.retention not set"); A.ok([...archive].every((id) => storeOf().item(id)));
  A.match(w.note ?? "", /^housekeeping: store\.pre-retention-\d+\.json not written \(mv exited 1: denied\); nothing archived/);
  A.deepEqual(fsm.readdirSync(data2).filter((n) => n.includes("pre-retention")), [], "no copy, no temporary file");
  A.equal(w.houseDue(), null, "not again within the hour");
  unhook();
  w.houseTry = 0;
  const t = await w.houseKick(cx);
  A.equal(t.items, archive.size, "an hour later it is written and the run goes on");
  A.equal(ls(data2).filter((n) => /^store\.pre-retention-\d+\.json$/.test(n)).length, 1); A.equal(storeOf().d.retention.v, 1);
}

// ── 26. restore: the record attached before the batch, the event always consumed ──
{
  const S = SIDS[9], S2 = SIDS[10], { st } = bigStore({ sessions: [S, S2], heavy: 7, open: 1, turns: 4 });
  due(st); freshHome(st);
  const w = await houseWriter();
  await w.houseRun;
  const files = archFiles(S, "items-"), X = itemId(S, 0), Y = itemId(S, 1), Z = itemId(S, 2), Q = itemId(S, 7, "human_to_agent");
  A.ok(files.length === 1 && !storeOf().item(X) && !storeOf().item(Y));
  const archived0 = Number(storeOf().d.sessions[S].archived);
  let k = 0;
  const put = (o) => { const ev = { v: 1, id: `rs-${++k}`, type: "restore", at: Date.now() + k, session_id: S, reopen: true, ...o }; fsm.writeFileSync(`${spool2}/${ev.at}-restore-mod-${String(k).padStart(5, "0")}.json`, JSON.stringify(ev)); return ev; };
  const e1 = put({ item: X, file: files[0] });
  await w.reader.drain(cx);
  A.deepEqual(spool2Files(), [], "consumed");
  let s = storeOf();
  A.equal(s.item(X)?.status, "open", "a good file: the item is back, reopened"); A.equal(s.item(X).resolvedBy, undefined, "...through setStatus (resolvedBy cleared)");
  A.equal(s.item(X).handle, "A1", "...under its own handle"); A.equal(Number(s.d.sessions[S].archived), archived0 - 1, "session.archived one fewer");
  A.ok(s.d.ingested.includes(e1.id));
  const e1b = put({ item: Q, file: files[0], reopen: false });
  await w.reader.drain(cx);
  A.equal(storeOf().item(Q)?.status, "open", "reopen false is not read: a restore always reopens"); A.ok(storeOf().d.ingested.includes(e1b.id));
  A.equal(Number(storeOf().d.sessions[S].archived), archived0 - 2, "...one fewer again");
  // A legacy month file: the last line for the id, which must be this session's.
  fsm.writeFileSync(`${arch}/2026-10.jsonl`, [{ ...mkItem(S, 9, 900), id: "rq_legacy-1", text: "older" }, { ...mkItem(S2, 10, 901), id: "rq_legacy-2" },
    { ...mkItem(S, 9, 900), id: "rq_legacy-1", text: "newer" }].map((x) => JSON.stringify(x)).join("\n") + "\n");
  put({ item: "rq_legacy-1", file: "2026-10.jsonl" });
  const e3 = put({ item: "rq_legacy-2", file: "2026-10.jsonl" });
  await w.reader.drain(cx);
  s = storeOf();
  A.equal(s.item("rq_legacy-1")?.text, "newer", "a legacy month file: the last line restored"); A.equal(s.item("rq_legacy-1").status, "open");
  A.equal(Number(s.d.sessions[S].archived), archived0 - 2, "a legacy line was never counted: session.archived as it was");
  A.ok(!s.item("rq_legacy-2"), "another session's line is not restored"); A.ok(s.d.ingested.includes(e3.id), "...and the event consumed");
  A.match(w.note ?? "", /^restore of rq_legacy-2: rq_legacy-2 in that file is another session's$/, "the note says why");
  // A missing file, bad names, an item not in the file: consumed, nothing changes, the note says why.
  const before = JSON.stringify(storeOf().d.items);
  const bad = [
    [{ item: Y, file: "items-1-abcdef.jsonl" }, new RegExp(`^restore of ${Y}: archive/${SP.archiveDir(S)}/items-1-abcdef\\.jsonl could not be read`)],
    [{ item: Y, file: "../store.json", record: { ...mkItem(S, 9, 1), text: "forged" } }, /not an archive file name: "\.\.\/store\.json"/],
    [{ item: Y, file: `${SP.archiveDir(S)}/${files[0]}` }, /not an archive file name/],
    [{ item: Y, file: files[0], session_id: ".." }, /: (the event names no session|its session is not in the store)$/],
    [{ item: "rq_nope", file: files[0] }, /rq_nope is not in that file/],
  ];
  for (const [o, re] of bad) {
    const ev = put(o);
    await w.reader.drain(cx);
    A.deepEqual(spool2Files(), [], `consumed: ${JSON.stringify(o.file)}`);
    A.match(w.note ?? "", re, `...the note: ${re}`);
    if (ev.session_id === S) A.ok(storeOf().d.ingested.includes(ev.id), "...recorded as ingested");
  }
  A.equal(JSON.stringify(storeOf().d.items), before, "none of them changed an item (the event's own `record` is never used)");
  A.ok(!storeOf().item(Y) && !storeOf().item(Z));
}

// ── 27. no housekeeping in a copy that does not hold the role, nor in a herdr-app check copy ──
{
  const S = SIDS[11], { st } = bigStore({ sessions: [S], heavy: 7, open: 1, turns: 14 });
  const text0 = freshHome(st);
  const holder = await houseWriter("holder27");
  await holder.houseRun;                                    // the holder's own first run
  const after = fsm.readFileSync(store2, "utf8"), files = archFiles(S);
  const nh = new Writer("nonholder"); nh.booted = true; nh.started = true;
  nh.live = Store.fromText(text0); nh.storeText = text0;    // a store with everything to do
  A.equal(nh.holds(), false); A.equal(nh.houseDue(), null, "not the holder: never due"); A.equal(nh.houseKick(cx), null);
  const ck = new Writer("check");                           // not booted: liveHome() looks for AGENTS.md, which this home has not
  await ck.start(cx);
  A.equal(ck.retired, true); A.match(ck.note ?? "", /herdr-app check/); A.equal(ck.houseDue(), null); A.equal(ck.houseKick(cx), null);
  A.equal(writerClaim().id, holder.id, "the claim is the holder's still");
  A.ok(fsm.readFileSync(store2, "utf8") === after && JSON.stringify(archFiles(S)) === JSON.stringify(files), "no file written, store.json unchanged");
}

// ── 28. across the seam: the writer's run, a reading copy's archive, the dialog's Reopen, the writer's restore ──
// What no one builder's test could hold: the files housekeeping writes are the files Reader.loadArchive reads,
// by the same names and the same reading rule; the event the dialog's Reopen posts (detail.js reopenArchived:
// Reader post of {session_id, item, file, reopen: true}) is the one the writer's pre-read and store.js restore
// take; and the reading copy then lists the item open in the store and no longer archived.
{
  const { Reader } = await import(`${lib}/reader.js`);
  const S = SIDS[12], S2 = SIDS[13], { st, archive } = bigStore({ sessions: [S, S2], heavy: 7, open: 2, turns: 16 });
  due(st);
  const orig = JSON.parse(freshHome(st));
  const w = await houseWriter("seam28");
  const t = await w.houseRun;
  A.equal(t.failed.length, 0, "the run wrote every file");
  const mine = [...archive].filter((id) => orig.items[id].anchor.sessionId === S), dir = SP.archiveDir(S);
  const itemFiles = archFiles(S, "items-"), turnFiles = archFiles(S, "turns-");
  A.ok(itemFiles.length >= 1 && turnFiles.length >= 1, `the run wrote items and turns files for the session (${itemFiles.length}, ${turnFiles.length})`);
  A.equal(Number(storeOf().d.sessions[S].archived), mine.length, "session.archived counts them");
  // The reading copy (the panel's and the dialog's Reader): which files it reads, and what it lists.
  const realReadFile = fsp.readFile, reads = [];
  patchFs({ readFile: (p, ...r) => { reads.push(String(p)); return realReadFile(p, ...r); } });
  const rd = new Reader(cx, {});
  A.equal(await rd.reload(), true, "the reading copy reads store.json");
  reads.length = 0;
  const rows = await rd.loadArchive(S);
  const archReads = reads.filter((p) => p.includes("/archive/"));
  patchFs({ readFile: realReadFile });
  A.deepEqual(archReads.map(base).sort(), [...itemFiles].sort(), "loadArchive read exactly the items files the run wrote (no turns file, no other session's)");
  A.ok(archReads.every((p) => p.startsWith(`${arch}/${dir}/`)), "...in the session's folder, named by the writer's archiveDir");
  A.deepEqual(rows.map((r) => r.id).sort(), [...mine].sort(), "and listed exactly the session's archived items");
  A.equal(rows.skipped, 0, "no line skipped");
  A.ok(rows.every((r) => itemFiles.includes(r.archiveFile) && fileLines(`${arch}/${dir}/${r.archiveFile}`).some((l) => l.id === r.id)), "each with the file that holds its line");
  A.ok(rows.every(({ archiveFile, ...it }) => JSON.stringify(it) === JSON.stringify(orig.items[it.id])), "each the item exactly as it was in the store");
  A.ok(rows.every((r, i) => i === 0 || (rows[i - 1].resolvedAt ?? 0) >= (r.resolvedAt ?? 0)), "newest closed first");
  A.ok(rows.some((r) => r.direction === "human_to_agent") && rows.some((r) => r.direction === "agent_to_human"), "closed parked questions and closed asks both");
  // Reopen, as the dialog posts it, for an ask and for a parked question.
  for (const r of [rows.find((x) => x.direction === "agent_to_human"), rows.find((x) => x.direction === "human_to_agent")]) {
    const before = Number(storeOf().d.sessions[S].archived);
    let wrote = null;
    const evId = rd.post("restore", { session_id: S, item: r.id, file: r.archiveFile, reopen: true }, null, cx, (ok) => { wrote = ok; });
    await until(() => wrote !== null, "the restore event written");
    A.equal(wrote, true, "Reader post wrote the event to the spool");
    const names = spool2Files();
    A.equal(names.length, 1);
    const ev = JSON.parse(fsm.readFileSync(`${spool2}/${names[0]}`, "utf8"));
    A.deepEqual({ id: ev.id, type: ev.type, session_id: ev.session_id, item: ev.item, file: ev.file, reopen: ev.reopen, record: ev.record },
      { id: evId, type: "restore", session_id: S, item: r.id, file: r.archiveFile, reopen: true, record: undefined }, "the contract's restore event, no record of its own");
    w.note = null;
    await w.reader.drain(cx);
    A.deepEqual(spool2Files(), [], "the writer consumed it");
    const s = storeOf(), back = s.item(r.id), was = orig.items[r.id];
    A.ok(back, `${was.handle} is back in store.json`);
    A.equal(back.status, "open", "...open"); A.equal(back.id, r.id, "...under its own id"); A.equal(back.handle, was.handle, "...and handle");
    A.equal(back.text, was.text); A.deepEqual(back.anchor, was.anchor, "...its anchor as it was");
    A.equal(back.resolvedBy, undefined, "...reopened through setStatus"); A.equal(back.resolvedAt, undefined); A.equal(back.archiveFile, undefined, "...without the reading copy's note");
    A.equal(Number(s.d.sessions[S].archived || 0), before - 1, "session.archived one fewer");
    A.ok(s.d.ingested.includes(evId), "the event recorded"); A.equal(w.note, null, "no restore note: it worked");
    A.equal(s.itemsOf(S).filter((x) => x.handle === was.handle).length, 1, "one item with that handle");
    await rd.reload();
    A.equal(rd.live.item(r.id)?.status, "open", "the reading copy sees it open");
    const now = await rd.loadArchive(S);
    A.ok(!now.some((x) => x.id === r.id), `${was.handle} is no longer an archived row (the store wins over its stale line)`);
    A.equal(now.length, Number(s.d.sessions[S].archived || 0), "the rows and the count agree");
  }
  // Closed again, then archived again by a later run: a newer items file, whose line wins.
  const again = rows.find((x) => x.direction === "agent_to_human");
  const close = { v: 1, id: "seam28-close", type: "act", at: T0 - 9 * DAYMS, session_id: S, item: again.id, action: "resolve", arg: null };
  fsm.writeFileSync(`${spool2}/${close.at}-act-mod-00001.json`, JSON.stringify(close));
  await w.reader.drain(cx);
  A.equal(storeOf().item(again.id).status, "resolved", "closed again");
  w.live.d.houseAt = 0; w.houseTry = 0;
  const t2 = await w.houseKick(cx);
  A.equal(t2.items, 1, "the next run archives it again");
  const newer = archFiles(S, "items-").filter((n) => !itemFiles.includes(n));
  A.equal(newer.length, 1, "in a new items file"); A.ok(msOf(newer[0]) > Math.max(...itemFiles.map(msOf)), "...newer than the first run's");
  await rd.reload();
  const last = await rd.loadArchive(S);
  const row = last.find((x) => x.id === again.id);
  A.equal(row?.archiveFile, newer[0], "the newest file's line wins over the first file's");
  A.equal(row.status, "resolved"); A.equal(row.updatedAt, T0 - 9 * DAYMS, "...the item as it was closed the second time");
  A.equal(last.length, Number(storeOf().d.sessions[S].archived), "rows and count agree again");
}

// ── 29. the review's fixes (2026-11-19): a config.json read that failed archives no item; an act for an
// item housekeeping took is said, not dropped in silence; an archive write that gets no answer, with a
// timer that fires (the stub cx's timer never does), keeps its items in the store ──
{
  const S = SIDS[14], { st, archive } = bigStore({ sessions: [S], heavy: 6, open: 1, turns: 16 });
  due(st); freshHome(st);
  const w = await houseWriter("review29");
  await w.houseRun;                                          // the day's run, with config.json read
  A.ok([...archive].every((id) => !storeOf().item(id)), "config.json read: the items archived");
  // A failed read of config.json (here: it does not parse) leaves the defaults in this.cfg: 3 days where the
  // person may have 30. That run archives no item, and turn records still go.
  const { st: st2, archive: a2 } = bigStore({ sessions: [SIDS[15]], heavy: 6, open: 1, turns: 16 });
  due(st2); freshHome(st2);
  fsm.writeFileSync(`${data2}/config.json`, "{ not json");
  const w2 = await houseWriter("review29b");
  const t2 = await w2.houseRun;
  A.ok(w2.cfg._error, "the writer's config is the defaults, with the read's error");
  A.equal(t2.items, 0, "no item archived on a config read that failed"); A.ok(t2.cfgSkipped);
  A.ok([...a2].every((id) => storeOf().item(id)), "...every closed item still in the store");
  A.equal(t2.cut, 4, "turn records still cut (16, 12 kept)");
  A.match(w2.note ?? "", /config\.json could not be read, so no closed item was archived/);
  await w2.logChain; A.match(log2(), /config\.json not read \(.*\), so no closed item archived/);
  fsm.writeFileSync(`${data2}/config.json`, JSON.stringify({ v: 1, retention_days: 3, retention: { turns: 12 } }));
  w2.applyConfig(await C.loadConfig());
  w2.houseTry = 0; w2.live.d.houseAt = 0;
  const t2b = await w2.houseKick(cx);
  A.equal(t2b.items, a2.size, "read again: the next run archives them");
  // An act still in the spool for an item the run took: dropped, and the note says so (store.js on_act).
  const gone = [...a2][0];
  const ev = { v: 1, id: "rv29-act", type: "act", at: Date.now(), session_id: SIDS[15], item: gone, action: "reopen", arg: null };
  fsm.writeFileSync(`${spool2}/${ev.at}-act-mod-29001.json`, JSON.stringify(ev));
  w2.note = null;
  await w2.reader.drain(cx);
  A.deepEqual(spool2Files(), [], "the act consumed");
  A.match(w2.note ?? "", new RegExp(`^${gone} is not in the store \\(archived\\?\\): reopen not applied$`), "the writer's note names it");
  A.ok(storeOf().d.ingested.includes(ev.id));
  // An archive write that never answers, with a working timer: the file fails within saveTimeout, its items
  // stay in the store, the run goes on and saves.
  const { st: st3, archive: a3 } = bigStore({ sessions: [SIDS[16]], heavy: 6, open: 1, turns: 16 });
  due(st3); freshHome(st3);
  const w3 = await houseWriter("review29c");
  await w3.houseRun;                                         // its own day's run first: everything archived
  const { st: st4, archive: a4 } = bigStore({ sessions: [SIDS[17]], heavy: 6, open: 1, turns: 16 });
  due(st4); freshHome(st4);
  const tcx = { notify: () => {}, sleep: async () => {} };
  tcx.spawn = (f) => Promise.resolve().then(() => f(tcx)).catch(() => {});
  tcx.timer = { after: (ms, f) => { const h = setTimeout(() => f(tcx), ms); return { cancel: () => clearTimeout(h) }; }, every: () => ({ cancel: () => {} }) };
  const w4 = new Writer("review29d"); w4.booted = true; w4.saveTimeout = 150;
  await w4.start(tcx);
  globalThis.__herdr.writeTextFile = (p, text, expected, real) => (p.includes("/archive/") && p.includes("/items-") ? new Promise(() => {}) : real(p, text, expected));
  const t4 = await w4.houseRun;
  A.ok(t4, "the run ended"); A.equal(t4.items, 0, "no item removed");
  A.equal(t4.failed.length, 1); A.match(t4.failed[0], /items-\d+-[a-z0-9]{6}\.jsonl not written: writing items-[^:]*: no answer in/, "the write timed out on the timer");
  A.ok([...a4].every((id) => storeOf().item(id)), "...its items still in store.json");
  A.ok(t4.cut > 0 && t4.saved, "the turns file was written and the store saved");
  A.match(w4.note ?? "", /archive file\(s\) not written/);
  unhook();
  void a3;
}
Writer.prototype.houseStep = realHouseStep;

console.log(`OK: writer, ${checks} checks (the 2026-11-12 stalled event past 1 MiB, a fault on the status line, quarantine to spool/failed, the heartbeat; `
  + `2026-11-19: a pass that never returns seen, restarted from store.json, nothing applied twice, a late mv that lands nothing, a timed-out write, `
  + `an event that waits, a back-off that keeps the claim, a takeover, writer.log; the review: a sweep that cannot list fails the start, `
  + `an old pass past the generation moves nothing in, a lost start race, the config watch and the map rescan, appends kept; `
  + `retention: a 1.7 MB store's first run (the one-time copy, files per session under the cap and create-only, under 1 MiB, the fast save after), `
  + `a taken name and a bad read-back kept, a given-up run and a late write harmless, an item reopened meanwhile kept, the triggers, `
  + `restore from a file, a legacy month and bad names, none in a non-holder or a check copy; `
  + `across the seam: the run's files read back by Reader.loadArchive, the dialog's Reopen restored by the writer, archived again in a newer file; `
  + `the review's: growth before a run by size, a failed config read, an act for an archived item, an archive write timed out), 0 failure(s)`);
