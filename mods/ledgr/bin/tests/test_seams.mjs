// ledgr retention Phase 2 (cold sessions), across the seams no one builder's test could hold (integration,
// 2026-11-19). The real writer (writer.js, spool.js, store.js), the real panel and its Reader (panel.js,
// reader.js), the settings dialog's config writer (settings.js editFor, reader.js editConfig), the Python MCP
// server (bin/mcp/ledgr_mcp.py over stdio), the Python readers (bin/lib/ledgr_extract.py) and the doctor
// (setup/ledgr_setup.py cold_report), all on the same scratch ledgr-data, one herdr stub that writes real files
// with Herdr's 1 MiB cap and compare-and-swap:
//   a. the writer's freeze run on the live-shape fixture (fixture_cold.mjs) -> the panel lists OLDER SESSIONS
//      (20) with the counts each had warm -> shown, a session is read from exactly the file the writer wrote ->
//      an act on one of its items (the panel's Done) -> the writer brings the session back before it applies ->
//      the panel shows it warm, with the same rows and handles;
//   b. a cold file removed -> the next event for its session is held (a byte-identical copy in cold/held/, the
//      spool file gone, the session faulted) -> the MCP server's declare_asks and open_asks for that session
//      say so in their words, against the real held layout and the real snapshot.json -> the doctor reports it
//      -> the file put back -> the panel's Try again (cold_retry) -> the held events replay in name order, once;
//   c. Phase 1 and Phase 2 together: a session with archived items goes cold and comes back; the dialog's
//      Reopen from the archive while it is cold thaws it first; housekeeping never archives from a cold file;
//      the archived count survives the round trip;
//   d. retention.coldDays 0 written by the settings dialog's writer while a freeze run is in flight: nothing
//      commits; written after a run committed: every session comes back, and the panel lists none as older;
//   e. Python's snapshot_copy and cold_record_error (bin/lib) and the doctor's cold_days_of agree with store.js
//      snapshot(), coldRecordError and config.js coldDaysOf on shared fixtures; and (2026-11-23) an ask's summary:
//      neither snapshot keeps it, and bin/lib ledgr_asks.summary_of makes the same text as store.js cleanSummary.
//   node tests/test_seams.mjs        (tests/test-seams.sh; a scratch folder of its own, removed at the end)
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(HERE, "../..");                 // mods/ledgr
const BIN = path.join(MOD, "bin");
const SETUP = path.resolve(MOD, "../../setup");
// The doctor is the repository's (setup/), not the installed mod's: run from an install (install.sh runs every
// suite there), its two checks are left out and the summary says so.
const HAVE_SETUP = fs.existsSync(path.join(SETUP, "ledgr_setup.py"));
const PY = [process.env.LEDGR_PYTHON, "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"].find((p) => p && fs.existsSync(p));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgr-seams."));
const APP = path.join(dir, "app"), DATA = path.join(APP, "ledgr-data"), HOME = path.join(dir, "home");
const COLD = path.join(DATA, "cold"), HELD = path.join(COLD, "held"), SPOOL = path.join(DATA, "spool"), ARCH = path.join(DATA, "archive");
const DAY = 86400e3, CAP = 1048576;
let checks = 0;
const A = new Proxy(assert, { get: (t, k) => (...a) => { checks++; return t[k](...a); } });

// ── the scratch folder: the mod's modules, one herdr stub for the writer and the reading copies, gpui stubs ──
for (const f of fs.readdirSync(MOD)) if (f.endsWith(".js")) fs.copyFileSync(path.join(MOD, f), path.join(dir, f));
fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
const nm = (name, body) => {
  fs.mkdirSync(path.join(dir, "node_modules", name), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, type: "module", main: "index.js" }));
  fs.writeFileSync(path.join(dir, "node_modules", name, "index.js"), body);
};
nm("herdr", `
import * as fs from "node:fs";
const H = () => (globalThis.__herdr ??= { props: {}, shared: {}, runs: [], overlays: [], closed: [], n: 0 });
const never = () => new Promise(() => {});
const CAP = ${CAP};
const big = () => new Error("Text file exceeds 1 MiB");
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
export const readTextFile = (p) => (H().readTextFile ? H().readTextFile(p, realRead) : realRead(p));
export const writeTextFile = (p, t, e) => (H().writeTextFile ? H().writeTextFile(p, t, e, realWrite) : realWrite(p, t, e));
import { spawnSync } from "node:child_process";
// The writer's own mv (writeLarge, Phase 1's one-time copy) runs; nothing else does (no extractor, no launcher).
export const exec = async (cmd, args) => {
  if (cmd !== "mv" && cmd !== "/bin/mv") return { code: 1, stdout: "", stderr: "not run in this test" };
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
export const hc = async () => ({ code: 1, stdout: "", stderr: "" });
export const props = () => H().props;
export const shared = (k) => H().shared[k] ?? null;
// Herdr saves shared state to shared.json in its home as it changes (the MCP server and the installer read it there).
export const setShared = (k, v) => { H().shared[k] = v; try { fs.writeFileSync(${JSON.stringify(path.join(APP, "shared.json"))}, JSON.stringify(H().shared)); } catch {} return null; };
export const run = (name, args) => { H().runs.push([name, args ?? null]); return null; };
export const openOverlay = (spec) => { const id = "ov-" + (++H().n); H().overlays.push([id, spec]); return id; };
export const closeOverlay = (id) => { H().closed.push(id); return null; };
export const focused = () => null;
export const agents = () => [];
export const terminals = () => [];
export const panes = () => [];
export const spaces = () => [];
export const layout = () => null;
export const placement = () => null;
export const theme = () => new Proxy({}, { get: (_t, k) => (typeof k === "string" ? "#778899" : undefined) });
export const home = () => ${JSON.stringify(HOME)};
export const appHome = () => ${JSON.stringify(APP)};
export const watchFolder = never;
export const nextCommand = never;
`);
const UI_SRC = `
const R = () => (globalThis.__ui ??= { ids: new Map(), md: new Map() });
export function el(kind, extra = {}) {
  const node = { _kind: kind, _id: null, _h: {}, _kids: [], ...extra };
  const p = new Proxy(node, { get(t, k) {
    if (typeof k === "symbol" || k.startsWith("_")) return t[k];
    if (k === "then") return undefined;
    if (k === "when") return (c, f) => (c ? (f(p) ?? p) : p);
    if (k === "child" || k === "content") return (x) => { t._kids.push(x); return p; };
    if (k === "children") return (xs) => { for (const x of xs ?? []) t._kids.push(x); return p; };
    if (k === "id") return (v) => { t._id = v; R().ids.set(v, t); return p; };
    if (k === "hover") return (f) => { f(el("style")); return p; };
    if (k.startsWith("on_")) return (f) => { t._h[k] = f; return p; };
    return () => p;
  } });
  return p;
}
`;
nm("gpui-kit", `${UI_SRC}
export class View {}
export const div = () => el("div");
export const svg = (src) => el("svg", { _src: src });
export const img = (src) => el("img", { _src: src });
export const image = (src) => el("image", { _src: src });
`);
nm("gpui-base", `${UI_SRC}
export const v_flex = () => el("v_flex");
export const h_flex = () => el("h_flex");
const state = (o = {}) => { const s = { _value: String(o.value ?? ""), _on: {} };
  return Object.assign(s, { value: () => s._value, set_value: (v) => { s._value = String(v); }, on: (e, f) => { s._on[e] = f; return true; },
    focus: () => {}, release: () => true, set_auto_grow() {}, set_rows() {}, set_soft_wrap() {}, set_selected_range() {}, replace(v) { s._value = String(v); } }); };
export const InputState = { new: (o) => state(o) };
export const TextareaState = { new: (o) => state(o) };
export const EditorState = { new: (o) => state(o) };
export const Input = { new: (st) => el("input", { _state: st }) };
export const Textarea = { new: (st) => el("textarea", { _state: st }) };
export const Editor = { new: (st) => el("editor", { _state: st }) };
export const TextView = { markdown: (id, md) => { R().md.set(id, md); return el("textview", { _md: md, _tv: id }); },
  html: (id, html) => { R().md.set(id, html); return el("textview", { _md: html, _tv: id }); } };
export const Popup = { new: (id, trigger) => el("popup", { _kids: [trigger] }) };
export const ScrollHandle = { new: () => ({ scroll_to_item() {}, release: () => true }) };
export const VirtualListScrollHandle = ScrollHandle;
export const Scrollbar = { new: () => el("scrollbar") };
export const v_virtual_list = () => el("list");
`);
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(APP, "AGENTS.md"), "x");      // config.js liveHome: in the app
globalThis.__herdr = { props: {}, shared: {}, runs: [], overlays: [], closed: [], n: 0 };
globalThis.localStorage = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })();

const { Store, coldRecordError, cleanSummary } = await import(`${dir}/store.js`);
const C = await import(`${dir}/config.js`);
const SP = await import(`${dir}/spool.js`);
const { Writer } = await import(`${dir}/writer.js`);
const { Reader, editConfig } = await import(`${dir}/reader.js`);
const { Panel } = await import(`${dir}/panel.js`);
const { editFor } = await import(`${dir}/settings.js`);
const W = await import(`${dir}/words.js`);
const { liveShape } = await import(path.join(HERE, "fixture_cold.mjs"));

// ── helpers ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((n) => !n.startsWith(".")).sort() : []);
const coldFiles = () => ls(COLD).filter((n) => C.COLD_NAME.test(n));
const spoolFiles = () => ls(SPOOL).filter((n) => n.endsWith(".json"));
const heldOf = (sid) => ls(path.join(HELD, C.safeName(sid)));
const storeOf = () => Store.fromText(fs.readFileSync(path.join(DATA, "store.json"), "utf8"));
const snapOf = () => JSON.parse(fs.readFileSync(path.join(DATA, "snapshot.json"), "utf8"));
async function until(cond, what, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(5)) if (await cond()) return true;
  throw new Error(`timed out waiting for: ${what}`);
}
// The writer's cx (as test_writer.mjs's): tasks at once, its timers left alone (each step is driven here).
const wcx = { spawn: (f) => Promise.resolve().then(() => f(wcx)).catch(() => {}), timer: { after: () => {}, every: () => {} }, notify: () => {}, sleep: async () => {} };
// The panel's cx (as test_detail.mjs's): tasks and timers queued, run by drain.
function mkcx() {
  const cx = { tasks: [], timers: [], clip: null };
  Object.assign(cx, {
    focus_handle: () => ({ focus() {}, is_focused: () => false, release: () => true }),
    spawn: (f) => { cx.tasks.push(f); }, timer: { after: (ms, f) => { cx.timers.push([ms, f]); }, every: () => {} },
    notify: () => {}, write_to_clipboard: (s) => { cx.clip = s; }, read_from_clipboard: () => cx.clip, stop_propagation: () => {}, sleep: async () => {},
  });
  return cx;
}
async function drain(cx, upTo = 1000) {
  const running = [], errors = [];
  for (let i = 0; i < 50; i++) {
    const due = cx.timers.filter(([ms]) => ms <= upTo);
    if (!cx.tasks.length && !due.length) {
      await Promise.race([Promise.all(running), sleep(30)]);
      if (!cx.tasks.length && !cx.timers.some(([ms]) => ms <= upTo)) break;
      continue;
    }
    while (cx.tasks.length) { const f = cx.tasks.shift(); running.push(Promise.resolve().then(() => f(cx)).catch((e) => errors.push(e))); }
    cx.timers = cx.timers.filter(([ms]) => ms > upTo);
    for (const [, f] of due) f(cx);
    await Promise.race([Promise.all(running), sleep(30)]);
  }
  if (errors.length) throw errors[0];
}
const UI = () => globalThis.__ui;
const texts = (node, out = []) => { if (node == null) return out; if (typeof node === "string") { out.push(node); return out; } if (node._md) out.push(node._md); for (const k of node._kids ?? []) texts(k, out); return out; };
const draw = (pn, cx) => { globalThis.__ui = { ids: new Map(), md: new Map() }; const tree = pn.render(cx); return { tree, all: texts(tree).join("\n") }; };
const menuIndex = (id) => (UI().ids.get("lg-menu")?._kids ?? []).findIndex((k) => k?._id === id);

// A fresh home: store.json and config.json as given, no spool, no cold/, no archive/, no snapshot.
const CFG = { v: 1, retention_days: 3, retention: { turns: 12, coldDays: 7 }, extract: { threshold: "needed" } };
function home(data, cfg = CFG) {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(SPOOL, { recursive: true });
  fs.writeFileSync(path.join(DATA, "config.json"), JSON.stringify(cfg));
  fs.writeFileSync(path.join(DATA, "store.json"), typeof data === "string" ? data : JSON.stringify(data));
  globalThis.__herdr.shared = {};
}
async function writer(role) { const w = new Writer(role); w.booted = true; await w.start(wcx); A.ok(w.amWriter(), `${role}: holds the role`); return w; }
// The tick's cold run, due now (writer.js houseKick from the tick): {cold: {freeze, sweep}}.
const coldRun = (w) => { w.coldAt = 0; return w.houseKick(wcx, { tick: true }); };
async function panel(sid) {
  globalThis.__herdr.props = { view: "panel" };
  const cx = mkcx(), pn = new Panel({}, cx);
  await drain(cx);
  await until(async () => { await drain(cx); return pn.liveText !== null; }, "the panel to read store.json");
  pn.held = sid;
  return { pn, cx };
}
// Which store.js applied which event, in order (the held replays' order).
const appliedIds = [];
const realApply = Store.prototype.apply;
Store.prototype.apply = function (ev) { const r = realApply.call(this, ev); if (r?.applied && ev?.id) appliedIds.push(ev.id); return r; };
let evn = 0;
const putEvent = (ev) => { const name = `${ev.at}-${ev.type}-mod-${String(++evn).padStart(5, "0")}.json`; const text = JSON.stringify(ev); fs.writeFileSync(path.join(SPOOL, name), text); return { name, text }; };
// Python: a script run with the mod's bin/lib and the setup on its path; its stdout as JSON.
function python(code, input = null) {
  const r = spawnSync(PY, ["-I", "-B", "-c", code], { input: input === null ? undefined : JSON.stringify(input), encoding: "utf8",
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME, LEDGR_DATA: DATA, LEDGR_BIN: BIN, LEDGR_SETUP: SETUP } });
  if (r.status !== 0) throw new Error(`python failed (${r.status}): ${r.stderr.slice(-1500)}`);
  return JSON.parse(r.stdout);
}
const PYPATH = "import sys, os, json; sys.path[:0] = [os.path.join(os.environ['LEDGR_BIN'], 'lib'), os.environ['LEDGR_SETUP']]\n";
// The MCP server over stdio (as tests/test_mcp.py drives it), with HC_TERMINAL_ID naming a mapped terminal.
class Mcp {
  constructor(terminal, waitMs = 5000) {
    this.p = spawn(PY, ["-I", "-B", path.join(BIN, "mcp", "ledgr_mcp.py")], { stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME, LEDGR_DATA: DATA, LEDGR_KEYCHAIN_SERVICE: "ledgr-test-missing-service",
        LEDGR_MCP_WAIT_MS: String(waitMs), HC_TERMINAL_ID: terminal } });
    this.buf = ""; this.waiters = new Map(); this.nid = 0; this.err = "";
    this.p.stderr.on("data", (d) => { this.err += d; });
    this.p.stdout.on("data", (d) => {
      this.buf += d;
      for (let i; (i = this.buf.indexOf("\n")) >= 0;) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        const m = JSON.parse(line), w = this.waiters.get(m.id);
        if (w) { this.waiters.delete(m.id); w(m); }
      }
    });
  }
  req(method, params) { const id = ++this.nid; const pr = new Promise((r) => this.waiters.set(id, r)); this.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); return pr; }
  async init() {
    await this.req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "test" } });
    this.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }
  async call(name, args = {}) { const m = await this.req("tools/call", { name, arguments: args }); return m.result ?? m; }
  close() { this.p.stdin.end(); }
}
const mtext = (r) => (r.content ?? [{}])[0]?.text ?? "";
// A call answered while the writer keeps draining (the server waits for it to take its event).
async function whileWriting(w, pr) {
  let done = false;
  pr.then(() => { done = true; }, () => { done = true; });
  while (!done) { await w.reader.drain(wcx); await sleep(20); }
  return pr;
}
const mapTerminal = (t, sid, turn) => {
  fs.mkdirSync(path.join(DATA, "terminals"), { recursive: true });
  fs.writeFileSync(path.join(DATA, "terminals", `${t}.json`), JSON.stringify({ v: 1, terminal: t, agent: "claude-code", session_id: sid, turn, prompt_id: `p${turn}`, state: "working" }));
};

let oldRan = false;
try {
  // ══ a. freeze (writer) -> OLDER SESSIONS (panel) -> read the writer's file -> act -> thaw first -> warm ══
  const now = Date.now();
  const fx = liveShape({ now });
  fx.data.houseAt = now;                                      // Phase 1 not due: the tick's run is the cold run alone
  const ref = new Store(JSON.parse(JSON.stringify(fx.data)));
  ref.threshold = "needed";
  const before = Object.fromEntries(Object.keys(ref.d.sessions).map((sid) => [sid, ref.countsOf(sid)]));
  const idleBefore = Object.fromEntries(Object.keys(ref.d.sessions).map((sid) => [sid, ref.touchedAt(sid)]));
  home(fx.data);
  const w = await writer("seam-a");
  const tally = (await coldRun(w))?.cold;
  A.ok(tally?.freeze, "the tick's cold run ran a freeze");
  A.deepEqual([...tally.freeze.frozen].sort(), [...fx.sids.cold].sort(), "the writer froze exactly the 20 sessions idle a week with something to move");
  A.equal(tally.freeze.saved, true, "...and saved the stubs");
  const disk = storeOf();
  A.deepEqual(disk.coldSessions().sort(), [...fx.sids.cold].sort(), "store.json names them cold");
  const named = Object.fromEntries(fx.sids.cold.map((sid) => [sid, disk.d.sessions[sid].cold.file]));
  A.deepEqual(coldFiles(), Object.values(named).sort(), "cold/ holds exactly the files the stubs name, one each");
  A.ok(fx.sids.cold.every((sid) => disk.itemsOf(sid).length === 0 && !disk.d.turns[sid]), "none of their items or turn records left in store.json");
  A.ok(fx.sids.cold.every((sid) => disk.touchedAt(sid) === idleBefore[sid]), "each stub's idle clock reads as it did warm (touchedAt carried at the freeze)");
  // The Python readers on the writer's real files: session_items reads a cold session from its file, filtered as
  // store.js snapshot() would have written it warm, and a warm one from snapshot.json as it is.
  {
    const tNow = Date.now(), warmSnap = ref.snapshot(tNow).items;
    const want = (sid) => JSON.parse(JSON.stringify(warmSnap.filter((it) => it.sessionId === sid)));
    const probe = [fx.sids.cold[0], fx.sids.cold[3], fx.sids.active[0]];
    const got = python(PYPATH + `import ledgr_extract as X
d = json.load(sys.stdin)
print(json.dumps({sid: X.session_items(sid, now_ms=d["now"]) for sid in d["sids"]}, ensure_ascii=False))`, { sids: probe, now: tNow });
    for (const sid of probe) {
      const [items, cold] = got[sid];
      const byId = (l) => Object.fromEntries(l.map((it) => [it.id, it]));
      A.deepEqual(byId(items), byId(want(sid)), `session_items ${sid.slice(0, 13)}: what snapshot() would hold for it warm`);
      A.deepEqual(cold, fx.sids.cold.includes(sid) ? { file: named[sid], fault: null, error: null } : null, "...cold names the writer's file, or none");
    }
  }
  const snap0 = snapOf();
  A.deepEqual(Object.keys(snap0.cold ?? {}).sort(), [...fx.sids.cold].sort(), "snapshot.json names the cold sessions (the Python readers' map)");

  // The panel: the session menu lists exactly those under OLDER SESSIONS (20), each with its warm counts, its
  // ◆, its idle clock; the other 22 above the fold; nothing read for the menu.
  const { pn, cx } = await panel(fx.sids.active[0]);
  pn.menu = true; pn.olderOpen = true; draw(pn, cx);
  A.equal(texts(UI().ids.get("lg-older")).join(""), W.olderSessionsWords(20, true), "the panel: OLDER SESSIONS (20)");
  let rowsOk = 0;
  for (const sid of fx.sids.cold) {
    const tx = texts(UI().ids.get(`lg-s-${sid}`)), c = before[sid];
    const want = [...(c.open ? [`${c.open} open`] : []), ...(c.b ? [`◆ ${c.b}`] : []), W.idleWords(Date.now() - idleBefore[sid])];
    if (want.every((x) => tx.includes(x)) && menuIndex(`lg-s-${sid}`) > menuIndex("lg-older")) rowsOk++;
    else A.fail(`${sid.slice(0, 13)}: ${tx.join("|")} lacks ${want.join(", ")}`);
  }
  A.equal(rowsOk, 20, "each older row: its counts as they were warm (from the writer's stub), ◆ when blocking, its idle clock");
  A.ok([...fx.sids.active, ...fx.sids.empty].every((sid) => menuIndex(`lg-s-${sid}`) >= 0 && menuIndex(`lg-s-${sid}`) < menuIndex("lg-older")), "the 22 others above the fold");
  A.equal(pn.coldCache.size, 0, "nothing read for the menu");
  // Shown: read from exactly the file the writer wrote, merged, counted as it was warm.
  const S = fx.sids.cold[0], file = named[S];
  pn.held = S; pn.menu = false; draw(pn, cx);
  A.ok(UI().ids.has("cold-reading"), "shown: Reading this session's items…");
  await until(async () => { await drain(cx); return pn.live.isMerged(S); }, "the panel to read the cold file");
  A.deepEqual([...pn.coldCache.keys()], [file], "the panel read one file: the one the writer's stub names");
  A.equal(JSON.stringify(pn.coldCache.get(file).record), fs.readFileSync(path.join(COLD, file), "utf8"), "...and its record is that file's text, as the writer wrote it");
  A.deepEqual(pn.live.countsOf(S), before[S], "merged: its counts from its items, as they were warm");
  const wasRows = pn.live.itemsOf(S).map((it) => [it.id, it.handle, it.status]);
  A.deepEqual(wasRows, ref.itemsOf(S).map((it) => [it.id, it.handle, it.status]), "its items, ids, handles and statuses in their order, as they were warm");
  draw(pn, cx);
  const openIds = pn.live.itemsOf(S).filter((it) => it.status === "open").map((it) => it.id);
  A.ok(openIds.length > 0 && openIds.every((id) => UI().ids.has(`row-${id}`)), `each open item a row (${openIds.length})`);
  A.equal(storeOf().isCold(S), true, "showing it brought nothing back (store.json: still cold)");
  // The act: the panel's Done on its first open ask (Reader act: one spool event naming the cold session).
  const target = pn.live.itemsOf(S).find((it) => it.status === "open" && it.direction === "agent_to_human");
  pn.act(target.id, "resolve", null, cx); await drain(cx);
  const acts = spoolFiles().map((n) => JSON.parse(fs.readFileSync(path.join(SPOOL, n), "utf8")));
  A.deepEqual(acts.map((e) => [e.type, e.session_id, e.item, e.action]), [["act", S, target.id, "resolve"]], "the panel posted one act naming the cold session");
  const fileText = fs.readFileSync(path.join(COLD, file), "utf8");
  const pstepsBefore = [];
  const realStep = SP.SpoolReader.prototype.step;
  SP.SpoolReader.prototype.step = function (pass, s) { pstepsBefore.push(s); return realStep.call(this, pass, s); };
  await w.reader.drain(wcx);
  SP.SpoolReader.prototype.step = realStep;
  A.deepEqual(spoolFiles(), [], "the writer took it");
  // spool.js names its pass "apply" before it hands the batch over; the writer names its own apply loop "apply" too, last.
  const coldStep = pstepsBefore.findIndex((s) => s.startsWith(`apply: cold ${S.slice(0, 8)}`)), applyStep = pstepsBefore.lastIndexOf("apply");
  A.ok(coldStep >= 0 && applyStep > coldStep, "the pass brought the session back (apply: cold <sid8>) before its apply loop");
  const back = storeOf();
  A.equal(back.isCold(S), false, "store.json: the session warm");
  A.deepEqual(back.itemsOf(S).map((it) => [it.id, it.handle]), wasRows.map(([id, h]) => [id, h]), "every item back, same ids, same handles, same order");
  A.equal(back.item(target.id).status, "resolved", "the act applied after the thaw"); A.equal(back.itemsOf(S).filter((it) => it.id !== target.id).every((it) => it.status === ref.item(it.id).status), true, "the rest as they were");
  A.deepEqual(back.d.turns[S], ref.d.turns[S], "its turn records back as they were");
  A.deepEqual(back.d.sessions[S].nextHandle, ref.d.sessions[S].nextHandle, "nextHandle unchanged");
  A.equal(fs.readFileSync(path.join(COLD, file), "utf8"), fileText, "the cold file stays on disk, unchanged (the sweep's, after the grace)");
  A.ok(!(S in (snapOf().cold ?? {})) && snapOf().items.some((it) => it.sessionId === S), "snapshot.json: the session warm, its items in it");
  // The panel, reloaded: warm, the same rows and handles; no older pill; 19 older sessions.
  await pn.reload(); await drain(cx);
  A.equal(pn.coldOf(S), null, "the panel: warm"); A.equal(pn.live.isMerged(S), false);
  A.deepEqual(pn.live.itemsOf(S).map((it) => [it.id, it.handle]), wasRows.map(([id, h]) => [id, h]), "the panel's items: the same ids and handles, in order");
  draw(pn, cx);
  A.ok(openIds.filter((id) => id !== target.id).every((id) => UI().ids.has(`row-${id}`)), "the same rows (the one closed aside): its OLDER THAN A DAY fold stays open a day after the thaw");
  A.ok(!UI().ids.has("lg-older-pill"), "no older pill");
  pn.menu = true; draw(pn, cx);
  A.equal(texts(UI().ids.get("lg-older")).join(""), W.olderSessionsWords(19, true), "OLDER SESSIONS (19), still open as the person left it");
  A.equal(pn.coldCache.has(file), false, "the record dropped from the panel's cache (no stub names it)");
  w.retire?.();

  // ══ b. a lost cold file: held (byte-identical), the MCP server's words, the doctor, Try again, replay ══
  {
    home(fx.data);
    const wb = await writer("seam-b");
    await coldRun(wb);
    const S2 = fx.sids.cold[1], st0 = storeOf(), file2 = st0.d.sessions[S2].cold.file;
    const saved = fs.readFileSync(path.join(COLD, file2), "utf8");
    const rec2 = JSON.parse(saved), openAsk = rec2.items.find((it) => it.status === "open" && it.direction === "agent_to_human");
    fs.unlinkSync(path.join(COLD, file2));
    const ev1 = { v: 1, id: "seam-b-act", type: "act", at: Date.now(), session_id: S2, item: openAsk.id, action: "resolve", arg: null };
    const p1 = putEvent(ev1);
    await wb.reader.drain(wcx);
    A.deepEqual(spoolFiles(), [], "held: the spool file gone (nothing waits)");
    A.deepEqual(heldOf(S2), [p1.name], "...kept in cold/held/<session>/ under the spool file's own name");
    A.equal(fs.readFileSync(path.join(HELD, C.safeName(S2), p1.name), "utf8"), p1.text, "...byte-identical");
    const f1 = storeOf().d.sessions[S2].cold.fault;
    A.ok(f1 && f1.error === `cold/${file2} is missing` && f1.held === 1 && f1.tries === 1, `the stub faulted, saved: ${JSON.stringify(f1)}`);
    A.equal(snapOf().cold[S2]?.fault, `cold/${file2} is missing`, "snapshot.json carries the fault for the Python readers");
    A.equal(appliedIds.includes("seam-b-act"), false, "not applied");
    // The MCP server, against the real held layout and snapshot.json.
    mapTerminal("t77", S2, 12);
    const mcp = new Mcp("t77");
    await mcp.init();
    // (2026-11-23: every declared item carries a summary, or the server refuses the call)
    const SEAM_SUMMARY = "Pick this weekend or next for the seam test.\n\n- this weekend: I run it on Saturday\n- next: I wait for the release";
    const r1 = await whileWriting(wb, mcp.call("declare_asks", { items: [{ level: "blocking", kind: "decide", text: "Pick the window for the seam test", summary: SEAM_SUMMARY }] }));
    const sc1 = r1.structuredContent ?? {}, tx1 = mtext(r1);
    A.equal(sc1.ok, true, `declare_asks on a faulted session: ok (${tx1.slice(0, 300)})`); A.ok(!r1.isError);
    A.equal(sc1.writer, "held", "writer: held (its copy found in cold/held/)");
    A.deepEqual(sc1.cold, { file: file2, fault: `cold/${file2} is missing`, error: `cold/${file2} is missing` }, "cold in the data: the file, the writer's fault, and missing here too");
    A.ok(tx1.includes(`ledgr cannot read this session's earlier items (cold/${file2} is missing); what you sent is kept and applied once that is fixed (the user's panel offers Try again).`), "D's words");
    A.ok(tx1.includes("Tell the user in your reply, and list these items there."), "...and the second line");
    const held2 = heldOf(S2);
    A.equal(held2.length, 2, "the declaration held beside the act"); A.equal(held2[0], p1.name, "name order: the act first");
    const asksName = held2[1], asksEv = JSON.parse(fs.readFileSync(path.join(HELD, C.safeName(S2), asksName), "utf8"));
    A.equal(asksEv.type, "asks"); A.equal(asksEv.id, sc1.event_id, "the held copy is the server's event");
    A.equal(storeOf().d.sessions[S2].cold.fault.held, 2, "the stub counts 2 events held");
    const r2 = await mcp.call("open_asks");
    const sc2 = r2.structuredContent ?? {}, tx2 = mtext(r2);
    A.ok(sc2.ok && Array.isArray(sc2.open) && sc2.open.length === 0 && sc2.cold?.error === `cold/${file2} is missing`, "open_asks: nothing listed, cold in the data");
    A.ok(tx2.includes("its earlier asks are not listed here, and what you declare or close is kept and applied once that is fixed"), "open_asks: says it cannot list them (not \"no open asks\")");
    // The doctor, on the same files (from the repository only).
    if (HAVE_SETUP) {
    const doc = python(PYPATH + `import types, ledgr_setup as L
ctx = types.SimpleNamespace(data=os.environ["LEDGR_DATA"])
cfg = json.load(open(os.path.join(ctx.data, "config.json")))
lines, problems = L.cold_report(ctx, cfg, running=True)
print(json.dumps({"lines": lines, "problems": problems}))`);
    const docText = [...doc.lines, ...doc.problems].join("\n");
    A.ok(doc.lines.some((l) => l.includes("20 sessions cold in ledgr-data/cold/ (19 files")), `the doctor: 20 sessions cold, 19 files (${doc.lines[0]})`);
    A.ok(doc.lines.some((l) => l.includes("held events") && l.includes("2 kept")), "the doctor: 2 held events");
    const fp = doc.problems.find((p) => p.includes(S2.slice(0, 8)));
    A.ok(fp && fp.includes(`cold/${file2} is missing`) && fp.includes("2 new events") && fp.includes("Try again") && fp.includes("Use without its older items") && fp.includes("Forget"),
      `the doctor names the faulted session, its error, its held events and what to do: ${fp}`);
    A.ok(fp.includes(`ledgr-data/cold/held/${C.safeName(S2)}/`), "...and the folder its events wait in");
    A.ok(!docText.includes("names cold/"), "no stub named as missing a file: the faulted one is reported as faulted, once");
    }
    // The file put back; the panel's Try again posts cold_retry; the held events replay in name order, once.
    fs.writeFileSync(path.join(COLD, file2), saved);
    const { pn: pb, cx: cxb } = await panel(S2);
    draw(pb, cxb);
    A.ok(UI().ids.has("cold-fault") && UI().ids.has("cold-retry"), "the panel: the writer's words and Try again");
    const mark = appliedIds.length;
    pb.coldRetry(pb.live.d.sessions[S2], cxb); await drain(cxb);
    const retries = spoolFiles().map((n) => JSON.parse(fs.readFileSync(path.join(SPOOL, n), "utf8"))).filter((e) => e.type === "cold_retry");
    A.deepEqual(retries.map((e) => [e.session_id, e.file]), [[S2, file2]], "Try again: one cold_retry {session_id, file}");
    await wb.reader.drain(wcx);
    const after = storeOf(), done = appliedIds.slice(mark);
    A.equal(after.isCold(S2), false, "the session back");
    A.deepEqual(done.filter((id) => id === "seam-b-act" || id === sc1.event_id), ["seam-b-act", sc1.event_id], "the held events replayed in name order, each once");
    A.equal(after.item(openAsk.id).status, "resolved", "the held act applied");
    const declared = after.itemsOf(S2).filter((it) => it.text === "Pick the window for the seam test");
    A.equal(declared.length, 1, "the held declaration applied once"); A.match(declared[0].handle, /^A\d+$/);
    A.equal(declared[0].summary, SEAM_SUMMARY, "...with the summary the agent declared (the server's event, held, replayed, applied)");
    A.equal(asksEv.asks?.[0]?.summary, SEAM_SUMMARY, "(the server's spool event carries it on the item)");
    A.ok(Number(declared[0].handle.slice(1)) >= rec2.session.nextHandle.A, "its handle past every one the session had (nextHandle kept on the stub)");
    A.equal(after.d.ingested.filter((id) => id === "seam-b-act").length, 1); A.equal(after.d.ingested.filter((id) => id === sc1.event_id).length, 1);
    A.deepEqual(heldOf(S2), [], "the held copies gone"); A.equal(fs.existsSync(path.join(HELD, C.safeName(S2))), false, "...and the folder");
    A.deepEqual(spoolFiles(), []);
    await wb.reader.drain(wcx);
    A.equal(appliedIds.filter((id) => id === sc1.event_id).length, 1, "a second pass replays nothing");
    const r3 = await mcp.call("open_asks");
    A.ok((r3.structuredContent?.open ?? []).some((o) => o.handle === declared[0].handle) && !r3.structuredContent?.cold, "open_asks after: the declared ask listed with its handle, warm");
    mcp.close();
    wb.retire?.();
  }

  // ══ c. Phase 1 and Phase 2: archived, cold, Reopen from the archive while cold, the count kept ══
  {
    const t = Date.now(), P = "c0dec0de-0000-4000-8000-000000000001", idle = t - 9 * DAY;
    const items = {}, turns = {};
    for (let i = 0; i < 8; i++) {
      const id = `rq_seamc${i}`, closed = i < 4;
      items[id] = { id, key: id, handle: `A${i + 1}`, direction: "agent_to_human", text: `ask ${i + 1}`, kind: "decide", level: "needed", options: [], blocking: false,
        anchor: { sessionId: P, turn: 1 + (i % 3), hash: `h${i}`, settled: true, quote: "" }, status: closed ? "resolved" : "open", origin: "tool",
        createdTurn: 1, createdAt: idle - 3600e3, updatedAt: idle - i * 1000, ...(closed ? { resolvedAt: idle - i * 1000, resolvedBy: "user" } : {}) };
    }
    for (let k = 1; k <= 3; k++) turns[k] = { stopAt: idle - (3 - k) * 60e3, asks: { source: "tool", count: 2, at: idle - (3 - k) * 60e3 } };
    const data = { v: 1, items, sessions: { [P]: { sessionId: P, agent: "claude-code", turn: 3, turnSource: "hooks", state: "idle", cwd: "/tmp/c", nextHandle: { A: 9, Q: 1, P: 1 },
      startedAt: idle - DAY, updatedAt: idle, promptAt: idle, lastStopAt: idle, surfaced: false } }, branches: {}, terminals: {}, turns: { [P]: turns }, ingested: [], forgotten: {}, pins: {} };
    home(data);
    const wc = await writer("seam-c");                         // no d.retention: Phase 1's first run, from the start
    const t1 = await wc.houseRun;
    A.ok(t1 && storeOf().d.retention?.v === 1, "Phase 1's first run done");
    const archived = Number(storeOf().d.sessions[P].archived);
    A.equal(archived, 4, "the four closed asks archived (session.archived 4)");
    const archList = () => ls(path.join(ARCH, C.safeName(P)));
    const archFiles0 = archList();
    A.ok(archFiles0.some((n) => n.startsWith("items-")), "in archive/<session>/");
    const tc = (await coldRun(wc))?.cold;
    A.deepEqual(tc?.freeze?.frozen, [P], "then the cold run moves the session out");
    const stub = storeOf().d.sessions[P], fileP = stub.cold.file;
    A.equal(stub.archived, archived, "the stub keeps session.archived");
    A.equal(stub.cold.n.items, 4, "its file holds the four open asks");
    // Housekeeping again (Phase 1 forced due): nothing archived from a cold session's file.
    wc.live.d.houseAt = 0; wc.houseTry = 0;
    const t2 = await wc.houseKick(wcx);
    A.ok(t2, "Phase 1 ran again");
    A.deepEqual(archList(), archFiles0, "no new archive file for the cold session");
    A.equal(storeOf().d.sessions[P].cold?.file, fileP, "still cold, the same file"); A.equal(storeOf().d.sessions[P].archived, archived, "archived count unchanged");
    A.equal(fs.readFileSync(path.join(COLD, fileP), "utf8").length > 0, true);
    // The dialog's Reopen, from a reading copy, while the session is cold: the archive read, the restore posted.
    const rd = new Reader(wcx, {});
    await rd.reload();
    A.equal(rd.live.isCold(P), true, "the reading copy sees it cold");
    const rows = await rd.loadArchive(P);
    A.deepEqual(rows.map((r) => r.handle).sort(), ["A1", "A2", "A3", "A4"], "loadArchive lists the four archived asks of the cold session");
    const pick = rows.find((r) => r.handle === "A2");
    let wrote = null;
    rd.post("restore", { session_id: P, item: pick.id, file: pick.archiveFile, reopen: true }, null, wcx, (ok) => { wrote = ok; });
    await until(() => wrote !== null, "the restore event written");
    const mark = appliedIds.length;
    await wc.reader.drain(wcx);
    const after = storeOf();
    A.equal(after.isCold(P), false, "the restore brought the session back first (thaw before apply)");
    A.equal(after.item(pick.id)?.status, "open", "A2 reopened, in the store"); A.equal(after.item(pick.id).handle, "A2", "...under its own handle");
    A.equal(after.itemsOf(P).length, 5, "the four open asks back from the cold file, and A2");
    A.equal(after.d.sessions[P].archived, archived - 1, "archived count: kept through freeze and thaw, one fewer for the reopened ask");
    A.deepEqual(Object.keys(after.d.turns[P] ?? {}).sort(), ["1", "2", "3"], "its turn records back");
    A.equal(appliedIds.slice(mark).length, 1, "one event applied");
    wc.retire?.();
  }

  // ══ d. retention.coldDays 0 through the settings dialog's writer: during a run, and after one ══
  {
    const t = Date.now(), Q = "c0dec0de-0000-4000-8000-000000000002", idle = t - 9 * DAY;
    const items = { rq_seamd0: { id: "rq_seamd0", key: "k", handle: "A1", direction: "agent_to_human", text: "d", kind: "decide", level: "blocking", blocking: true, options: [],
      anchor: { sessionId: Q, turn: 1, hash: "h", settled: true, quote: "" }, status: "open", origin: "tool", createdTurn: 1, createdAt: idle, updatedAt: idle } };
    const data = { v: 1, items, sessions: { [Q]: { sessionId: Q, agent: "claude-code", turn: 1, turnSource: "hooks", state: "idle", nextHandle: { A: 2, Q: 1, P: 1 },
      updatedAt: idle, promptAt: idle, lastStopAt: idle } }, branches: {}, terminals: {}, turns: { [Q]: { 1: { stopAt: idle } } }, ingested: [], forgotten: {}, pins: {},
      retention: { v: 1, at: t - DAY }, houseAt: t };
    home(data);
    const wd = await writer("seam-d");
    let paused = null;
    globalThis.__herdr.readTextFile = (p, real) => (!paused && p.startsWith(`${COLD}/`) ? new Promise((res) => { paused = { go: () => real(p).then(res) }; }) : real(p));
    const run = coldRun(wd);
    await until(() => paused, "the freeze to wait on its read-back");
    await editConfig(editFor("coldDays", 0));                 // the settings dialog's one writer of config.json
    A.equal(JSON.parse(fs.readFileSync(path.join(DATA, "config.json"), "utf8")).retention.coldDays, 0, "config.json: retention.coldDays 0, retention.turns kept");
    paused.go();
    const td = (await run)?.cold?.freeze;
    delete globalThis.__herdr.readTextFile;
    A.deepEqual(td?.frozen, [], "the run in flight commits nothing"); A.equal(td.removed, 1, "...and removes its file");
    A.equal(storeOf().isCold(Q), false); A.deepEqual(coldFiles(), [], "no cold file left");
    // After a run that committed: 0 written; the writer brings it back (its config watch: applyConfig, a poke).
    await editConfig(editFor("coldDays", 7));
    wd.applyConfig(await C.loadConfig());
    const t2 = (await coldRun(wd))?.cold?.freeze;
    A.deepEqual(t2?.frozen, [Q], "coldDays 7: frozen");
    await editConfig(editFor("coldDays", 0));
    wd.applyConfig(await C.loadConfig());
    await until(async () => { await wd.reader.drain(wcx); return !storeOf().isCold(Q); }, "every session back");
    A.equal(storeOf().itemsOf(Q).length, 1, "its item back");
    const t3 = (await coldRun(wd))?.cold?.freeze;
    A.ok(t3?.skipped === "coldDays 0" || (t3?.frozen ?? []).length === 0, "coldDays 0: the next run freezes nothing");
    const { pn: pd, cx: cxd } = await panel(Q);
    pd.menu = true; draw(pd, cxd);
    A.equal(UI().ids.has("lg-older"), false, "the panel: no OLDER SESSIONS");
    wd.retire?.();
  }

  // ══ e. Python and JavaScript agree: snapshot_copy and snapshot(), cold_record_error and coldRecordError, coldDaysOf ══
  {
    const t = Date.now(), Z = "c0dec0de-0000-4000-8000-000000000003";
    const long = "q".repeat(199) + "😀";                       // 201 UTF-16 units: over 200 as JavaScript counts
    const mk = (i, o) => ({ id: `rq_e${i}`, handle: `A${i}`, direction: "agent_to_human", text: `t${i}`, anchor: { sessionId: Z, turn: 1, quote: "short" }, status: "open",
      createdAt: t - DAY, updatedAt: t - DAY, draft: "typed", pins: ["pn_x"], ...o });
    const items = [
      mk(1, { summary: "Say yes to apply the five changes.\n\n- one\n- two" }), mk(2, { status: "answered", summary: "Pick a night." }), mk(3, { status: "deferred" }), mk(4, { status: "rejoin_pending" }), mk(5, { status: "resolved" }),
      mk(6, { status: "dismissed", resolvedAt: t - 2 * DAY }), mk(7, { status: "dismissed", resolvedAt: t - 8 * DAY }), mk(8, { status: "dismissed", resolvedAt: null, updatedAt: t - DAY }),
      mk(9, { status: "dismissed", updatedAt: String(t - DAY) }), mk(10, { anchor: { sessionId: Z, turn: 1, quote: long } }), mk(11, { anchor: { sessionId: Z, quote: "q".repeat(200) } }),
      mk(12, { anchor: { sessionId: Z, quote: "é".repeat(150) + "😀".repeat(26) } }), mk(13, { status: "dismissed", resolvedAt: t - 7 * DAY + 60e3 }), mk(14, { anchor: { sessionId: Z, quote: null } }),
    ];
    const st = new Store({ v: 1, items: Object.fromEntries(items.map((it) => [it.id, it])), sessions: { [Z]: { sessionId: Z, turn: 1 } }, branches: {}, terminals: {}, turns: {},
      ingested: [], forgotten: {}, pins: {} });
    const js = st.snapshot(t).items;
    const rec = { ledgr: "ledgr-cold", v: 1, sessionId: Z, at: t, session: { sessionId: Z }, items: [mk(1, {})], turns: { 1: { stopAt: t } }, n: {} };
    const bad = [null, [], 7, "x", { ...rec, ledgr: "ledgr-store" }, { ...rec, ledgr: undefined }, { ...rec, v: 2 }, { ...rec, v: "1" }, { ...rec, v: true }, { ...rec, v: null },
      { ...rec, sessionId: "someone-else" }, { ...rec, sessionId: undefined }, { ...rec, items: {} }, { ...rec, items: null }, { ...rec, turns: [1] }, { ...rec, turns: null }, { ...rec, turns: undefined },
      { ...rec, items: [{ text: "no id" }] }, { ...rec, items: [{ id: "" }] }, { ...rec, items: [{ id: "__proto__", anchor: { sessionId: Z } }] }, { ...rec, items: [7] },
      { ...rec, items: [{ id: "rq_o", anchor: { sessionId: "other" } }] }, { ...rec, items: [{ id: "rq_n" }] }, { ...rec, turns: { 1: 5 } }, { ...rec, turns: { 2: null } }, rec,
      { ...rec, ledgr: "x".repeat(60) }, { ...rec, sessionId: "y".repeat(60) }];
    const sids = [Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z, Z];
    const errs = bad.map((r, i) => coldRecordError(JSON.parse(JSON.stringify(r ?? null)), sids[i]));
    const days = [7, 0, "0", 3, "3", 2.4, 2.5, 0.4, -1, 366, 365, "x", "", null, undefined, true, "  9 ", 1e400, 60, 0.5];
    const jsDays = days.map((v) => C.coldDaysOf({ retention: { coldDays: v } }));
    // An ask's summary (2026-11-23): the hooks' validator (bin/lib ledgr_asks.summary_of) and the store's (cleanSummary)
    // make one text of the same input, so the store's second pass changes nothing a producer sent.
    const sums = ["", "   ", "\n\n\t \r\n", "  Do this.\r\n\r\n\r\n- a\r\n- b \n\n", "one\n  \n\t\n \ntwo", "one\ntwo", "one\n\ntwo", "x\ry",
      "**bold**, `code`  \nhard break\n  - indented", "\u00a0nbsp\u00a0", "x".repeat(1000), "x".repeat(1500), `${" ".repeat(10)}${"y".repeat(1000)} `,
      `${"z".repeat(999)} ${"w".repeat(50)}`, "😀".repeat(1001), "😀".repeat(600), `${"é".repeat(998)}\n\n\nab`, 42, null, true, ["a"], { a: 1 }];
    const py = python(PYPATH + `import ledgr_extract as X, ledgr_asks as K
d = json.load(sys.stdin)
snap = [c for c in (X.snapshot_copy(it, d["now"]) for it in d["items"]) if c is not None]
errs = [X.cold_record_error(r, s) for r, s in zip(d["bad"], d["sids"])]
sums = [K.summary_of({"summary": s}) for s in d["sums"]] if hasattr(K, "summary_of") else None
days = None
if os.path.exists(os.path.join(os.environ["LEDGR_SETUP"], "ledgr_setup.py")):
    import ledgr_setup as L
    days = [L.cold_days_of({"retention": {"coldDays": v}} if v != "__undef__" else {"retention": {}}) for v in d["days"]]
print(json.dumps({"snap": snap, "errs": errs, "days": days, "sums": sums}, ensure_ascii=False))`,
      { now: t, items: JSON.parse(JSON.stringify(items)), bad: bad.map((r) => JSON.parse(JSON.stringify(r ?? null))), sids,
        days: days.map((v) => (v === undefined ? "__undef__" : Number.isFinite(v) || typeof v !== "number" ? v : null)), sums });
    A.deepEqual(py.snap, JSON.parse(JSON.stringify(js)), "snapshot_copy keeps, drops and shapes every item as store.js snapshot() does");
    A.ok(items.filter((it) => it.summary).length === 2 && !js.some((c) => "summary" in c), "(two of them carry a summary, which neither snapshot keeps)");
    A.deepEqual(py.sums, sums.map(cleanSummary), "ledgr_asks.summary_of and store.js cleanSummary make the same summary of every input");
    A.ok(py.sums.every((s) => s === null || cleanSummary(s) === s), "...and the store's second pass changes none of the validator's");
    A.equal(js.length, 12, `(${js.length} kept of ${items.length}: the resolved one and the dismissal past 7 days left out)`);
    A.ok(js.some((c) => c.id === "rq_e10" && c.anchor.quote === undefined) && js.some((c) => c.id === "rq_e11" && c.anchor.quote.length === 200), "(a quote of 201 UTF-16 units dropped, one of 200 kept)");
    A.deepEqual(py.errs, errs, "cold_record_error refuses the same records, word for word, as store.js coldRecordError");
    A.equal(errs.filter((e) => e === null).length, 3, "(three good records among them: the record, and with turn records null or absent)");
    A.ok(new Set(errs.filter(Boolean)).size >= 15, `(${new Set(errs.filter(Boolean)).size} different refusals compared)`);
    // 1e400 is Infinity: JSON carries it as null on both sides, so the JavaScript side reads null too.
    const jsDaysJson = days.map((v, i) => (v === 1e400 ? C.coldDaysOf({ retention: { coldDays: null } }) : jsDays[i]));
    if (HAVE_SETUP) A.deepEqual(py.days, jsDaysJson, "the doctor's cold_days_of reads retention.coldDays as config.js coldDaysOf does");
  }
  // ══ f. the review's blocker across the seam: a store.json the writer could not parse at a start; the session
  // used again; the sweep keeps its file for good and the doctor lists it as recoverable ══
  {
    const t = Date.now(), R = "c0dec0de-0000-4000-8000-000000000004", idle = t - 9 * DAY;
    const items = {};
    for (let i = 0; i < 3; i++) items[`rq_seamf${i}`] = { id: `rq_seamf${i}`, key: `k${i}`, handle: `A${i + 1}`, direction: "agent_to_human", text: `f ${i}`, kind: "decide",
      level: "needed", options: [], anchor: { sessionId: R, turn: 1, hash: `h${i}`, settled: true, quote: "" }, status: "open", origin: "tool", createdTurn: 1, createdAt: idle, updatedAt: idle };
    const data = { v: 1, items, sessions: { [R]: { sessionId: R, agent: "claude-code", turn: 1, turnSource: "hooks", state: "idle", nextHandle: { A: 4, Q: 1, P: 1 }, updatedAt: idle } },
      branches: {}, terminals: {}, turns: { [R]: { 1: { stopAt: idle } } }, ingested: [], forgotten: {}, pins: {}, retention: { v: 1, at: t - DAY }, houseAt: t };
    home(data);
    const w1 = await writer("seam-f1");
    await coldRun(w1);
    const FR = storeOf().d.sessions[R].cold.file;
    w1.release();
    fs.writeFileSync(path.join(DATA, "store.json"), fs.readFileSync(path.join(DATA, "store.json"), "utf8").slice(0, -3));   // a bad copy, a hand edit
    globalThis.__herdr.shared = {};
    const w2 = await writer("seam-f2");
    await w2.houseRun;
    A.ok(ls(DATA).some((n) => n.startsWith("store.corrupt-")) && storeOf().d.retention?.v === 1, "the store set aside, the writer started empty, Phase 1's first run done");
    putEvent({ v: 1, id: "seam-f-prompt", type: "prompt", at: Date.now(), session_id: R, terminal: "t5", turn: 2, prompt_head: "back again" });
    await w2.reader.drain(wcx);
    A.ok(storeOf().d.sessions[R] && !storeOf().isCold(R) && storeOf().itemsOf(R).length === 0, "the session made again, warm, without the file's items");
    const sw = await w2.coldSweep(w2.gen, Date.now() + 3 * DAY);
    A.ok(fs.existsSync(path.join(COLD, FR)), "the sweep three days on: the only copy of its items stays"); A.deepEqual(sw.kept, [FR]);
    if (HAVE_SETUP) {
      const doc = python(PYPATH + `import types, ledgr_setup as L
ctx = types.SimpleNamespace(data=os.environ["LEDGR_DATA"])
lines, problems = L.cold_report(ctx, {}, running=True)
print(json.dumps({"lines": lines, "problems": problems}))`);
      const pr = doc.problems.find((p) => p.includes(FR)) ?? "";
      A.ok(pr.includes("holds 3 items and 1 turn record store.json lacks") && pr.includes("keeps it for good") && pr.includes("Retention.md 10.8"),
        `the doctor lists it as recoverable, with what store.json lacks: ${pr}`);
    }
    w2.release();
  }

  // ══ g. ./install.sh --thaw-all against the real writer: config.json written to 0, the writer brings every session
  // back (through applyConfig, as its config watch does), its claim in shared.json renews, the installer says
  // "no cold sessions" ══
  if (HAVE_SETUP) {
    home(fx.data);
    const wg = await writer("seam-g");
    await coldRun(wg);
    A.equal(storeOf().coldSessions().length, 20, "20 sessions cold");
    const thaw = new Promise((resolve) => {
      const p = spawn(PY, ["-I", "-B", "-c", PYPATH + `import argparse, ledgr_setup as L
L.THAW_POLL_S, L.THAW_SAY_S, L.THAW_CONFIRM_S, L.THAW_WAIT_S = 0.1, 5, 0.3, 30
L.herdr_running = lambda ctx: True
out = []
L.say = lambda m="": out.append(m)
ctx = L.Ctx(argparse.Namespace(herdr_home=os.environ["HERDR_APP_HOME"], claude_settings=None, state_dir=os.environ["LEDGR_STATE_DIR"], yes=True))
rc = L.cmd_thaw_all(ctx, argparse.Namespace())
print(json.dumps({"rc": rc, "out": out}))`], { env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME, LEDGR_BIN: BIN, LEDGR_SETUP: SETUP, HERDR_APP_HOME: APP, LEDGR_STATE_DIR: path.join(dir, "state") } });
      let outText = "", errText = "";
      p.stdout.on("data", (d) => { outText += d; }); p.stderr.on("data", (d) => { errText += d; });
      p.on("close", () => resolve({ outText, errText }));
    });
    let done = false;
    thaw.then(() => { done = true; });
    while (!done) {                                           // the writer: its config watch and its tick, as Herdr runs them
      wg.applyConfig(await C.loadConfig());
      await wg.reader.drain(wcx);
      wg.claim();
      await sleep(50);
    }
    const { outText, errText } = await thaw;
    let res = null;
    try { res = JSON.parse(outText); } catch { A.fail(`the installer's output: ${outText} ${errText.slice(-800)}`); }
    A.equal(res.rc, 0, `--thaw-all exit 0: ${res.out.join(" / ")}`);
    A.ok(res.out.some((l) => l.includes("no cold sessions: every session's items are back in store.json")), "...\"no cold sessions\"");
    A.equal(JSON.parse(fs.readFileSync(path.join(DATA, "config.json"), "utf8")).retention.coldDays, 0, "config.json: retention.coldDays 0");
    A.deepEqual(storeOf().coldSessions(), [], "store.json: none cold");
    A.ok(fx.sids.cold.every((sid) => storeOf().itemsOf(sid).length === ref.itemsOf(sid).length), "every session's items back");
    wg.release();
  }

  // ══ h. an older build (optional: LEDGR_OLD_BUILD names a folder with its store.js and the modules it imports, a
  // build before cold sessions) takes a store with stubs, then the re-upgrade: nothing lost, handles unique, turn
  // records merged ══
  const OLD = process.env.LEDGR_OLD_BUILD;
  if (OLD && fs.existsSync(path.join(OLD, "store.js"))) {
    const od = path.join(dir, "old");
    fs.mkdirSync(od, { recursive: true });
    for (const f of fs.readdirSync(OLD)) if (f.endsWith(".js")) fs.copyFileSync(path.join(OLD, f), path.join(od, f));
    const Old = await import(path.join(od, "store.js"));
    const t = Date.now(), S = "c0dec0de-0000-4000-8000-000000000005", at = t - 9 * DAY;
    const st = Store.fromText(null);
    st.d.retention = { v: 1, at: t - 5 * DAY };
    st.apply({ v: 1, id: "h-ss", type: "session_start", at, terminal: "t1", session_id: S, source: "startup", agent: "claude-code", cwd: "/tmp/h" });
    st.apply({ v: 1, id: "h-a1", type: "asks", at: at + 1, session_id: S, turn: 1, source: "tool", asks: [{ text: "Pick the database", level: "blocking", kind: "decide" }, { text: "Approve the plan", level: "needed", kind: "review" }] });
    st.apply({ v: 1, id: "h-st", type: "stop", at: at + 2, session_id: S, turn: 1, message_uuid: "u1" });
    const items0 = st.itemsOf(S).map((it) => it.id);
    const p0 = st.planFreeze(7, t)[0], fh = C.coldName(S, p0.record.at, "old001");
    A.deepEqual(st.commitFreeze([{ ...p0, file: fh }], t), [S]);
    const old = Old.Store.fromText(st.toText());
    for (const e of [{ v: 1, id: "h-o1", type: "session_start", at: t - 900, session_id: S, terminal: "t9", source: "resume", agent: "claude-code", cwd: "/tmp/h" },
      { v: 1, id: "h-o2", type: "asks", at: t - 800, session_id: S, turn: 2, source: "tool", asks: [{ text: "A new one", level: "needed", kind: "do" }] },
      { v: 1, id: "h-o3", type: "stop", at: t - 700, session_id: S, turn: 2, message_uuid: "u2" }]) old.apply(e);
    const nw = Store.fromText(old.toText());
    A.deepEqual(nw.mixedCold(), [S], "re-upgrade: the session is mixed (the older build's items beside its stub)");
    A.equal(nw.thaw(S, JSON.parse(JSON.stringify(p0.record)), fh, t).ok, true, "...and comes back");
    const hs = nw.itemsOf(S).map((it) => it.handle);
    A.ok(items0.every((id) => nw.item(id)), "every item of the file back"); A.equal(new Set(hs).size, hs.length, "handles unique");
    A.ok(nw.itemsOf(S).some((it) => it.text === "A new one"), "the older build's new ask kept"); A.deepEqual(Object.keys(nw.d.turns[S] ?? {}).sort(), ["1", "2"], "turn records merged");
    oldRan = true;
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`OK: seams, ${checks} checks (cold sessions across the writer, the panel and its Reader, the settings writer, the MCP server, the Python readers and the doctor: a freeze read back and thawed by an act; a lost file held, said by the MCP server and the doctor, replayed in order once; archived, cold, reopened while cold; coldDays 0 during and after a run; Python and JavaScript agree (an ask's summary too: held, replayed, out of both snapshots, one cleaning); a corrupt store's restart keeps the only copy and the doctor lists it; --thaw-all against the real writer; ${oldRan ? "an older build's round trip" : "no older build given (LEDGR_OLD_BUILD)"}${HAVE_SETUP ? "" : "; the doctor's checks left out: no setup/ beside this mod"}), 0 failure(s)`);
process.exit(0);
