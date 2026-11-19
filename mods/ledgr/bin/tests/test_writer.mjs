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
for (const f of ["store.js", "config.js", "branch.js", "confluence.js", "words.js", "writer.js", "spool.js"]) fsm.copyFileSync(`${MOD}${f}`, `${lib}/${f}`);
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

console.log(`OK: writer, ${checks} checks (the 2026-11-12 stalled event past 1 MiB, a fault on the status line, quarantine to spool/failed, the heartbeat; `
  + `2026-11-19: a pass that never returns seen, restarted from store.json, nothing applied twice, a late mv that lands nothing, a timed-out write, `
  + `an event that waits, a back-off that keeps the claim, a takeover, writer.log; the review: a sweep that cannot list fails the start, `
  + `an old pass past the generation moves nothing in, a lost start race, the config watch and the map rescan, appends kept), 0 failure(s)`);
