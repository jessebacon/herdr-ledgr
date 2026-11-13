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
//   node tests/test_writer.mjs <empty scratch folder>      (tests/test-store.sh)
import assert from "node:assert/strict";
import * as fsm from "node:fs";
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
export const readTextFile = async (p) => {
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  if (b.length > CAP) throw big();
  return b.toString("utf8");
};
export const writeTextFile = async (p, text, expected) => {
  if (H().writeTextFile) return H().writeTextFile(p, text, expected);
  if (Buffer.byteLength(text) > CAP) throw big();
  const cur = fs.existsSync(p) ? fs.readFileSync(p) : null;
  if (cur && cur.length > CAP) throw big();
  if ((cur === null ? null : cur.toString("utf8")) !== expected) throw new Error("stale snapshot");
  fs.writeFileSync(p + ".w", text); fs.renameSync(p + ".w", p);
  return null;
};
export const exec = async (cmd, args) => {
  if (H().exec) return H().exec(cmd, args);
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
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
const { Writer, writerClaim } = await import(`${lib}/writer.js`);
const SP = await import(`${lib}/spool.js`);
const W = await import(`${lib}/words.js`);
const H = await import(`${lib}/node_modules/herdr/index.js`);

let checks = 0;
const A = new Proxy(assert, { get: (t, k) => (...a) => { checks++; return t[k](...a); } });
const bytes = (s) => Buffer.byteLength(s);
const ls = (d) => (fsm.existsSync(d) ? fsm.readdirSync(d).filter((n) => !n.startsWith(".")).sort() : []);
const spoolFiles = () => ls(spool).filter((n) => n.endsWith(".json"));
const cx = { spawn: (f) => Promise.resolve().then(() => f(cx)).catch(() => {}), timer: { after: () => {}, every: () => {} }, notify: () => {}, sleep: async () => {} };

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
await new Promise((r) => setTimeout(r, 50));
A.ok(Date.now() - writerClaim().at < 5000, "the tick renewed `at`"); A.equal(writerClaim().id, wr.id); A.equal(writerClaim().failed, 1, "...with the health");

console.log(`OK: writer, ${checks} checks (the 2026-11-12 stalled event past 1 MiB, a fault on the status line, quarantine to spool/failed, the heartbeat), 0 failure(s)`);
