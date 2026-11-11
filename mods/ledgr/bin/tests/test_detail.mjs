// ledgr detail dialog (docs/design/Detail.md 6.2), under Node, self-contained: it copies the mod's .js files
// into a scratch folder with stub `herdr`, `gpui-kit` and `gpui-base` modules and checks
//   the pure half: detailing.js (detailProps, detailSpec, kindOf, locate, passageParts, mdVerbatim,
//     hardBreaks, closesAfterStage, focusAfter, mergeClosed, keptConclude, keepConclude), the new words.js
//     keys (stageLabels().quick, pinUseLines, copiedWords, detailHints), fixtures.js (every demo case of
//     2.10, P3 archived, the forgotten-session pin, DEMO_DETAIL), main.js as text (the detail view before
//     isCapture, close awaits release);
//   the dialog itself (detail.js with views.js): every demo case renders in one and two columns (each
//     element method is checked against gpui-kit.d.ts when it is found), the sections and the marked
//     passage, and the flows through its own clicks: an option, Paste answer, Done (the act written, then
//     the close), Esc, a staging closing it, retargeting, the Conclude editor, the closed record; Esc while
//     a paste or a closing act's write is pending, Paste into trunk closing at once, a record that reaches
//     the store after the dialog opened, a branch in its first turn, commands naming a branch by hc name;
//   links (2026-11-10): the message's paths linked and every markdown TextView taking the click, a question's
//     verbatim text taking none; a web link to cx.open_url; a path found in the session's folder, then the
//     repository's top (git's answer), opened with links.editor (open, zed) through a recording exec; a
//     path found nowhere says where it looked; Reveal in Finder and Copy path; the demo runs nothing.
// reader.js and listing.js are Builder A's: when one is not in the mod yet, a stub with the contract of
// Detail.md 5.2 stands in, and the summary line says so.
//   node tests/test_detail.mjs
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(HERE, "../..");                 // mods/ledgr (repo or live install)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgr-detail."));
const DAY = 86400e3;
let checks = 0;
const A = new Proxy(assert, { get: (t, k) => (...a) => { checks++; return t[k](...a); } });
const stubs = [];

// ── the scratch folder ─────────────────────────────────────────────────────
for (const f of fs.readdirSync(MOD)) if (f.endsWith(".js")) fs.copyFileSync(path.join(MOD, f), path.join(dir, f));
fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
const nm = (name, body) => {
  fs.mkdirSync(path.join(dir, "node_modules", name), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, type: "module", main: "index.js" }));
  fs.writeFileSync(path.join(dir, "node_modules", name, "index.js"), body);
};
const APP = path.join(dir, "app");
fs.mkdirSync(path.join(APP, "ledgr-data"), { recursive: true });

// herdr: every export of herdr.d.ts, recording what a test looks at (globalThis.__herdr).
nm("herdr", `
const H = () => (globalThis.__herdr ??= { props: {}, shared: {}, runs: [], overlays: [], closed: [], writes: [], agents: [], terminals: [], panes: [], focus: null, files: {}, n: 0 });
const never = () => new Promise(() => {});
export const props = () => H().props;
export const shared = (k) => H().shared[k];
export const setShared = (k, v) => { H().shared[k] = v; return null; };
export const run = (name, args) => { H().runs.push([name, args ?? null]); return null; };
export const openOverlay = (spec) => { const id = "ov-" + (++H().n + 100); H().overlays.push([id, spec]); return id; };
export const closeOverlay = (id) => { H().closed.push(id); return null; };
export const focused = () => H().focus;
export const agents = () => H().agents;
export const terminals = () => H().terminals;
export const panes = () => H().panes;
export const spaces = () => [];
export const machines = () => [];
export const layout = () => null;
export const layouts = () => [];
export const commands = () => [];
export const keys = () => [];
export const settings = () => ({});
export const window = () => ({ platform: "macos", titlebar: "system", buttons: false, maximized: false, fullscreen: false, active: true });
export const placement = () => null;
export const theme = () => new Proxy({}, { get: (_t, k) => (typeof k === "string" ? "#778899" : undefined) });
export const themes = () => [];
export const fonts = () => [];
export const updates = () => ({});
export const presentUpdateNotes = () => null;
export const telemetry = () => ({});
export const notify = () => "n1";
export const home = () => ${JSON.stringify(path.join(dir, "home"))};
export const appHome = () => ${JSON.stringify(APP)};
export const readTextFile = async (p) => (p in H().files ? H().files[p] : null);
export const writeTextFile = async (p, text) => { if (H().failWrites) throw new Error("disk full"); H().writes.push([p, text]); return null; };
export const exec = async (cmd, args, o) => { (H().execs ??= []).push([cmd, args ?? [], o ?? null]); return H().execFn ? H().execFn(cmd, args ?? [], o) : { code: 1, stdout: "", stderr: "" }; };
export const hc = async () => ({ code: 1, stdout: "", stderr: "" });
export const knownAgents = async () => [];
export const pickFolder = async () => null;
export const playSound = () => null;
export const setAgentOrder = () => null;
export const nextCommand = never;
export const watchFolder = never;
export const sendFeedback = async () => null;
export const feedbackPreview = () => ({ body: null, available: false });
export const feedbackPasteImage = () => null;
export const feedbackPickImages = async () => [];
export const feedbackAttachImages = () => [];
export const feedbackClearImages = () => null;
`);

// gpui-kit / gpui-base: elements that record ids, handlers, children and the markdown a TextView gets; an
// element method gpui-kit.d.ts does not declare throws (when the typings are found).
const DTS = [path.join(MOD, "gpui-kit.d.ts"), path.join(os.homedir(), ".config/herdr-app/gpui-kit.d.ts")].find((p) => fs.existsSync(p));
const methods = DTS ? [...new Set([...fs.readFileSync(DTS, "utf8").matchAll(/^\s+(\w+)<Self extends Element>\(this: Self/gm)].map((m) => m[1]))] : [];
if (DTS) methods.push("selectable", "scrollable", "on_link_click");
fs.writeFileSync(path.join(dir, "methods.json"), JSON.stringify(methods));
const UI_SRC = `
import * as fs from "node:fs";
const METHODS = new Set(JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, "methods.json"))}, "utf8")));
const R = () => (globalThis.__ui ??= { ids: new Map(), md: new Map(), scrolls: [] });
export function el(kind, extra = {}) {
  const node = { _kind: kind, _id: null, _h: {}, _kids: [], ...extra };
  const p = new Proxy(node, { get(t, k) {
    if (typeof k === "symbol" || k.startsWith("_")) return t[k];
    if (k === "then") return undefined;
    if (METHODS.size && !METHODS.has(k)) throw new Error("no element method " + k + " (gpui-kit.d.ts)");
    if (k === "selectable" || k === "scrollable") return (v) => { t["_" + k] = v; return p; };
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
`);
nm("gpui-base", `${UI_SRC}
export const v_flex = () => el("v_flex");
export const h_flex = () => el("h_flex");
const state = (o = {}) => { const s = { _value: String(o.value ?? ""), _on: {}, _focused: 0 };
  return Object.assign(s, { value: () => s._value, set_value: (v) => { s._value = String(v); }, on: (e, f) => { s._on[e] = f; return true; },
    focus: () => { s._focused++; }, release: () => true, set_auto_grow() {}, set_rows() {}, set_soft_wrap() {}, set_selected_range() {}, replace(v) { s._value = String(v); } }); };
export const InputState = { new: (o) => state(o) };
export const TextareaState = { new: (o) => state(o) };
export const EditorState = { new: (o) => state(o) };
export const Input = { new: (st) => el("input", { _state: st }) };
export const Textarea = { new: (st) => el("textarea", { _state: st }) };
export const Editor = { new: (st) => el("editor", { _state: st }) };
export const TextView = { markdown: (id, md) => { R().md.set(id, md); return el("textview", { _md: md, _tv: id }); },
  html: (id, html) => { R().md.set(id, html); return el("textview", { _md: html, _tv: id }); } };
export const Popup = { new: (id, trigger) => el("popup", { _kids: [trigger] }) };
export const ScrollHandle = { new: () => { const h = { _to: [] }; return Object.assign(h, { scroll_to_item: (i) => { h._to.push(i); R().scrolls.push(i); }, release: () => true }); } };
export const VirtualListScrollHandle = ScrollHandle;
export const Scrollbar = { new: () => el("scrollbar") };
export const v_virtual_list = () => el("list");
`);

// reader.js and listing.js: Builder A's. Missing, a stub with the 5.2 contract (the panel's code of today).
if (!fs.existsSync(path.join(MOD, "listing.js"))) {
  stubs.push("listing.js");
  fs.writeFileSync(path.join(dir, "listing.js"), `
import { isHuman, isBlocking, isClosed } from "./store.js";
export const BR_WORD = { working: "working", blocked: "needs you", done: "done", idle: "idle", starting: "starting", launching: "launching…",
  launched: "starting", running: "running", closed: "closed", ended: "ended", failed: "launch failed", refused: "refused",
  nostart: "did not start", concluded: "concluded", rejoined: "rejoined" };
export const firstLine = (text, n = 160) => { const l = String(text ?? "").split("\\n").find((x) => x.trim()) ?? ""; const s = l.replace(/\\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
export function glyphOf(it, sug = false) {
  let g = { open: ["●", "accent"], answered: ["◐", "accent"], resolved: ["✓", "done"], dismissed: ["✕", "dim"], deferred: ["◷", "muted"], rejoin_pending: ["↩", "accent"] }[it?.status] ?? ["·", "dim"];
  if (isHuman(it) && it.status === "open" && it.anchor && !it.anchor.settled) g = ["○", "dim"];
  else if (it?.status === "open" && isBlocking(it) && !sug) g = ["◆", "blocked"];
  else if (it?.status === "open" && sug) g = ["○", "dim"];
  return g;
}
export function stateOf(kind, x, ctx) {
  if (kind === "branch") return { word: BR_WORD[ctx.branchLive(x)] ?? String(ctx.branchLive(x)), tone: "muted" };
  if (kind === "pin") return { word: x.status === "archived" ? "archived" : "pinned", tone: "dim" };
  return { word: isClosed(x) ? "done" : x.status, tone: isClosed(x) ? "done" : "accent" };
}
export const entryKey = (kind, id) => (kind === "pin" ? "pin:" : kind === "branch" ? "branch:" : "item:") + id;
export function rowModel(kind, x, ctx) {
  const handle = kind === "branch" ? "branch of " + (ctx.store.item(x.requestId)?.handle ?? "?") : String(x.handle ?? "");
  return { key: entryKey(kind, x.id), kind, id: x.id, sessionId: x.sessionId ?? x.anchor?.sessionId ?? x.parentSessionId ?? null, handle,
    pill: kind === "branch" ? { text: x.name, tone: "dim" } : null, text: firstLine(kind === "branch" ? ctx.store.item(x.requestId)?.text : x.text),
    state: stateOf(kind, x, ctx), glyph: kind === "pin" || kind === "branch" ? null : glyphOf(x, false), quick: { done: false, paste: false }, tip: "" };
}
export const moveCursor = (keys, cursor) => cursor ?? keys[0] ?? null;
export const keepPlace = (_p, keys, cursor) => (keys.includes(cursor) ? cursor : null);
`);
}
if (!fs.existsSync(path.join(MOD, "reader.js"))) {
  stubs.push("reader.js");
  fs.writeFileSync(path.join(dir, "reader.js"), `
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { agents, terminals, readTextFile } from "herdr";
import { DEFAULTS, loadConfig, liveHome, dataDir, turnPath, storePath } from "./config.js";
import { Store, isAgentAsk, isClosed } from "./store.js";
import { writeEvent } from "./spool.js";
import { FIXTURE_TURNS } from "./fixtures.js";
import { liveStatus } from "./branch.js";
import { answersSheet, answersLeadIn } from "./confluence.js";
import { promptText } from "./nav.js";
const squash = (s) => String(s ?? "").replace(/\\s+/g, " ").trim();
export class Reader {
  constructor(cx, { demo = false } = {}) {
    Object.assign(this, { cfg: DEFAULTS, demo, demoStore: null, live: new Store(null), liveText: null, localActs: [], drafts: new Map(), passages: new Map(),
      txCheck: new Map(), pasting: 0, flash: "", rev: 0, revAt: 0, rcx: null, inApp: false, unwritten: new Map() });
  }
  async startReading(cx) { if (!(await liveHome())) return false; this.inApp = true; this.cfg = await loadConfig(); await this.reload(); return true; }
  fallback() { return false; }
  viewStore() { return this.demo && this.demoStore ? this.demoStore : this.live; }
  async reload() { const text = await fs.readFile(storePath(), "utf8").catch(() => null); if (text === null || text === this.liveText) return false; this.liveText = text; this.live = Store.fromText(text); this.overlayLocal(); this.bump(); return true; }
  bump() { this.rev++; this.revAt = Date.now(); }
  overlayLocal() { for (const a of this.localActs) if (a.item && a.action) this.live.act(a.item, a.action, a.arg, a.at); }
  watchStore() {}
  tickRead() {}
  post(type, payload, local, cx) {
    const evId = randomUUID(), at = Date.now();
    if (local) { this.localActs.push({ evId, at, ...local }); this.overlayLocal(); }
    this.unwritten.set(evId, { type, payload });
    cx.spawn(async (cx) => { await writeEvent(type, { id: evId, terminal: null, ...payload }); this.unwritten.delete(evId); cx.notify(); });
    return evId;
  }
  async flushPending() {
    for (const [id, e] of this.unwritten) { await writeEvent(e.type, { id, terminal: null, ...e.payload }); this.unwritten.delete(id); }
    for (const [id, d] of this.drafts) if (!d.sent) { d.sent = true; const it = this.viewStore().item(id); await writeEvent("act", { id: randomUUID(), terminal: null, session_id: it?.anchor?.sessionId, item: id, action: "draft", arg: d.text }); }
  }
  act(id, action, arg, cx) { const st = this.viewStore(); if (this.demo) { if (st.act(id, action, arg)) this.bump(); return; } const it = st.item(id); if (it) this.post("act", { session_id: it.anchor?.sessionId, item: id, action, arg: arg ?? null }, { item: id, action, arg }, cx); }
  typeDraft(id, text, cx) { const it = this.viewStore().item(id); if (!it) return; it.draft = text; if (this.demo) return; this.drafts.set(id, { text, sent: false, seq: 1 }); }
  answerOf(it) { return squash(it?.draft); }
  pasteOn() { return this.cfg.ui?.pasteIntoPrompt !== false; }
  demoHow(lead) { return "in a session it would be pasted (" + lead + ")"; }
  stage(msg, terminal, cx, w) {
    (globalThis.__staged ??= []).push({ msg, terminal, w });
    cx.write_to_clipboard(promptText(msg));
    const text = w.what + " pasted (stub)"; this.flash = text;
    this.afterStage?.({ pasted: true, ms: 100 }, text, terminal, cx);
    return true;
  }
  copyAnswers(s, turn, cx) { const g = this.viewStore().itemsOf(s.sessionId).filter((it) => isAgentAsk(it) && it.anchor?.turn === turn && !isClosed(it)); this.stageAnswers(s, turn, g, cx); }
  copyAnswer(it, s, cx) { this.stageAnswers(s, it.anchor?.turn, [it], cx); }
  stageAnswers(s, turn, group, cx) {
    const items = group.filter((it) => this.answerOf(it)), msg = answersSheet(s.sessionId, turn, items);
    if (!msg) { this.flash = "no answer"; return; }
    if (this.demo) { cx.write_to_clipboard(promptText(msg)); this.flash = "(demo) answers copied"; return; }
    this.stage(msg, s.terminal, cx, { what: "Answer", where: "pane " + s.terminal, lead: answersLeadIn(items.map((i) => i.handle)), word: "idle" });
  }
  trunkWord() { return "idle"; }
  parentLive(s) { return Boolean(s?.terminal && terminals().some((k) => k.address === s.terminal)); }
  branchable(s) { return Boolean(s) && (s.agent === "claude-code" || s.agent === "claude") && !String(s.sessionId).startsWith("herdr:"); }
  branchLive(b) { return this.demo ? b.demoStatus ?? b.status : liveStatus(b, agents(), terminals()); }
  terminalGone(st, s) { return this.demo ? false : !s?.terminal || !agents().some((a) => a.address === s.terminal); }
  transcriptOk() { return true; }
  loadPassage(sid, turn, cx) {
    const k = sid + ":" + turn;
    if (this.demo) { this.passages.set(k, FIXTURE_TURNS[k] ?? null); return; }
    if (this.passages.has(k)) return;
    this.passages.set(k, undefined);
    cx.spawn(async (cx) => { this.passages.set(k, await readTextFile(turnPath(sid, turn)).catch(() => null)); cx.notify(); });
  }
  pinAct(type, p, extra, cx) { if (this.demo) { this.demoStore["on_" + type]({ pin: p.id, ...extra }, Date.now(), {}); this.bump(); return; } this.post(type, { session_id: p.sessionId, pin: p.id, ...extra }, { action: type, pin: p.id, ...extra }, cx); }
  resume(s, cx) { this.flash = "resume " + s.sessionId; }
}
`);
}

// A context as Herdr hands one to a handler: tasks and timers are queued and run by the test.
function mkcx() {
  const cx = { tasks: [], timers: [], clip: null, notified: 0 };
  Object.assign(cx, {
    focus_handle: () => { const h = { _f: 0 }; return Object.assign(h, { focus: () => { h._f++; }, is_focused: () => false, release: () => true }); },
    spawn: (f) => { cx.tasks.push(f); }, timer: { after: (ms, f) => { cx.timers.push([ms, f]); }, every: () => {} },
    notify: () => { cx.notified++; }, write_to_clipboard: (s) => { cx.clip = s; }, read_from_clipboard: () => cx.clip,
    stop_propagation: () => {}, sleep: async () => {},
  });
  return cx;
}
// Runs the queued tasks (each one started, none awaited past a short wait: a watchFolder loop never ends)
// and the timers due within upTo ms, until nothing new is queued. A task that throws fails the test.
async function drain(cx, upTo = 1000) {
  const running = [], errors = [];
  for (let i = 0; i < 50; i++) {
    const due = cx.timers.filter(([ms]) => ms <= upTo);
    if (!cx.tasks.length && !due.length) {
      await Promise.race([Promise.all(running), new Promise((r) => setTimeout(r, 30))]);
      if (!cx.tasks.length && !cx.timers.some(([ms]) => ms <= upTo)) break;
      continue;
    }
    while (cx.tasks.length) { const f = cx.tasks.shift(); running.push(Promise.resolve().then(() => f(cx)).catch((e) => errors.push(e))); }
    cx.timers = cx.timers.filter(([ms]) => ms > upTo);
    for (const [, f] of due) f(cx);
    await Promise.race([Promise.all(running), new Promise((r) => setTimeout(r, 30))]);
  }
  if (errors.length) throw errors[0];
}
const UI = () => globalThis.__ui;
const H = () => globalThis.__herdr;
const click = (id, cx) => { const n = UI().ids.get(id); A.ok(n, `the element ${id} is drawn`); A.ok(n._h.on_click, `${id} has a click`); n._h.on_click({}, cx); };
const texts = (node, out = []) => { if (node == null) return out; if (typeof node === "string") { out.push(node); return out; } if (node._md) out.push(node._md); for (const k of node._kids ?? []) texts(k, out); return out; };

try {
  const D = await import(`${dir}/detailing.js`);
  const W = await import(`${dir}/words.js`);
  const FX = await import(`${dir}/fixtures.js`);
  const { Store } = await import(`${dir}/store.js`);

  // ── detailProps ────────────────────────────────────────────────────────
  const pn = (i) => `pn_00000000-aaaa-4bbb-8ccc-${String(i).padStart(12, "0")}`;
  for (const kind of D.KINDS) {
    const r = D.detailProps({ view: "detail", session: "s1", kind, id: "rq_1", overlay: "ov-1" });
    A.equal(r.ok, true, `kind ${kind}`); A.equal(r.kind, kind); A.equal(r.id, "rq_1"); A.equal(r.session, "s1"); A.equal(r.overlay, "ov-1");
    A.equal(r.open, null); A.deepEqual(r.sel, []); A.equal(r.demo, false); A.equal(r.opener, null);
  }
  A.equal(D.detailProps({ view: "detail", kind: "item", id: "rq_1" }).ok, false, "a bad kind refuses");
  A.equal(D.detailProps({ view: "detail", kind: "ask", id: "" }).ok, false, "an empty id refuses");
  A.equal(D.detailProps({ view: "detail", kind: "ask", id: "x".repeat(200) }).ok, false, "a 200-character id refuses");
  A.equal(D.detailProps({ view: "detail", kind: "ask", id: "x".repeat(128) }).ok, true, "128 characters is fine");
  A.equal(D.detailProps({ view: "panel", kind: "ask", id: "rq_1" }).ok, false, "another view refuses");
  A.equal(D.detailProps(null).ok, false); A.equal(typeof D.detailProps(null).error, "string");
  A.equal(D.detailProps({ view: "detail", kind: "ask", id: "rq_1", open: "explode" }).open, null, "an unknown open is dropped");
  for (const o of D.OPEN_STATES) A.equal(D.detailProps({ view: "detail", kind: "ask", id: "rq_1", open: o }).open, o);
  const sel13 = Array.from({ length: 13 }, (_, i) => pn(i + 1));
  A.deepEqual(D.detailProps({ view: "detail", kind: "pin", id: pn(1), sel: sel13 }).sel, sel13.slice(0, 12), "sel cut at 12");
  A.deepEqual(D.detailProps({ view: "detail", kind: "pin", id: pn(1), sel: sel13 }, 3).sel, sel13.slice(0, 3), "sel cut at the limit passed in");
  A.deepEqual(D.detailProps({ view: "detail", kind: "pin", id: pn(1), sel: ["rq_1", pn(2), 7, "pn_x", pn(2), "br_1"] }).sel, [pn(2)], "non-pin ids dropped, each once");
  A.equal(D.detailProps({ view: "detail", kind: "ask", id: "rq_1", demo: "true" }).demo, false, "demo only when true");
  A.equal(D.detailProps({ view: "detail", kind: "ask", id: "rq_1", demo: true }).demo, true);
  A.equal(D.detailProps({ view: "detail", kind: "ask", id: "rq_1", opener: "panel-uuid" }).opener, "panel-uuid");

  // ── detailSpec, kindOf, layout, focusAfter ─────────────────────────────
  const spec = D.detailSpec({ session: "s1", kind: "pin", id: pn(1), open: "note", sel: [pn(1)], opener: "p", demo: true });
  A.equal(spec.mod, "ledgr"); A.equal(spec.kind, "dialog"); A.equal(spec.width, 0.6); A.equal(spec.height, 0.75);
  A.equal(spec.props.view, "detail"); A.ok(!("layout" in spec), "never a layout");
  A.deepEqual(spec.props, { view: "detail", session: "s1", kind: "pin", id: pn(1), open: "note", sel: [pn(1)], opener: "p", demo: true });
  A.equal(D.detailSpec({ kind: "ask", id: "rq_1" }).props.demo, false); A.deepEqual(D.detailSpec({ kind: "ask", id: "rq_1" }).props.sel, []);
  A.equal(D.detailProps({ ...D.detailSpec({ session: "s", kind: "ask", id: "rq_1" }).props, overlay: "ov" }).ok, true, "a spec's props pass detailProps");
  A.deepEqual(D.DETAIL, { width: 0.6, height: 0.75, twoColumnsAt: 760, leftShare: 0.46, minWidth: 420 });
  A.equal(D.kindOf(pn(1), null), "pin"); A.equal(D.kindOf("br_demo_q3_7c1e", null), "branch");
  A.equal(D.kindOf("rq_1", { direction: "agent_to_human" }), "ask"); A.equal(D.kindOf("rq_1", { direction: "human_to_agent" }), "question");
  A.equal(D.kindOf("rq_1", null), null);
  A.equal(D.twoColumns(760), true); A.equal(D.twoColumns(759), false); A.equal(D.leftWidth(1000), 460);
  A.equal(D.focusAfter("esc"), "list"); A.equal(D.focusAfter("act"), "list"); A.equal(D.focusAfter("stage"), "pane"); A.equal(D.focusAfter("pane"), "pane");
  A.equal(D.focusAfter(null), null); A.equal(D.focusAfter("box"), null);

  // ── locate, passageParts ───────────────────────────────────────────────
  A.deepEqual(D.locate("one two three", "two"), [4, 7], "exact");
  A.equal(D.locate("one two", ""), null); A.equal(D.locate("", "x"), null);
  const T = "Intro line.\n\nThe quote is here, in the middle.\n\nClosing line.";
  A.deepEqual(D.passageParts(T, "The quote is here", false), { before: "Intro line.", hit: "The quote is here, in the middle.", after: "Closing line." }, "exact: the paragraph");
  A.equal(D.passageParts(T, "The  quote\n is   here", false).hit, "The quote is here, in the middle.", "whitespace-tolerant");
  const MDT = "Before.\n\n**What I found.** The `orders` migration finished cleanly.\n\nAfter.";
  A.equal(D.passageParts(MDT, "What I found. The orders migration finished", false).hit, "**What I found.** The `orders` migration finished cleanly.", "markdown marks ignored");
  const items = Array.from({ length: 8 }, (_, i) => `${i + 1}. ${"filler words ".repeat(4)}item ${i + 1}${i === 4 ? " HOLDS THE QUOTE" : ""}`);
  const LIST = `Head.\n\n${items.join("\n")}\n\nTail.`;
  A.equal(D.passageParts(LIST, "HOLDS THE QUOTE", false).hit, items[4], "a long list paragraph: only the line that holds the quote");
  const LONG = `${"word ".repeat(200).trim()}\n\n${"more ".repeat(200).trim()}\n\nThe passage.\n\n${"after ".repeat(300).trim()}`;
  const around = D.passageParts(LONG, "The passage.", false), whole = D.passageParts(LONG, "The passage.", true);
  A.ok(around.before.startsWith("…"), "around: the context before is cut, with …"); A.ok(around.before.length < 700);
  const MID = `${"a ".repeat(100)}\n\n${"b ".repeat(100)}\n\n${"c ".repeat(100)}\n\n${"d ".repeat(100)}\n\nThe passage.\n\ntail`;
  A.ok(D.passageParts(MID, "The passage.", false).before.startsWith("…\n\n"), "around: cut at a paragraph break");
  A.ok(D.passageParts(MID, "The passage.", false).before.includes("d d d"), "around: the paragraphs just before kept");
  A.ok(whole.before.startsWith("word word"), "whole: everything before"); A.equal(whole.hit, "The passage.");
  A.ok(around.after.endsWith("…") || around.after.length <= 600, "around: the context after is cut");
  A.equal(D.passageParts("short text", "absent", false).hit, null); A.equal(D.passageParts("short text", "absent", false).before, "short text");
  A.ok(D.passageParts("x".repeat(2000), "absent", false).before.endsWith("…"), "no match: a long text is cut");
  A.equal(D.passageParts("x".repeat(2000), "absent", true).before.length, 2000, "no match, whole: all of it");
  // The turn file holds the whole turn since 2026-11-10 (Stop joins every text block, a blank line between):
  // on the declare_asks path a quote written before the tool call is found, the pointer line after it.
  const TURN = "Start by confirming the docs source. Add the custom domain once you supply it, since I cannot finish the CNAME without that name.\n\nledgr: 3 items for you, 2 blocking";
  A.deepEqual(D.passageParts(TURN, "Add the custom domain once you supply it", false),
    { before: "", hit: "Start by confirming the docs source. Add the custom domain once you supply it, since I cannot finish the CNAME without that name.", after: "ledgr: 3 items for you, 2 blocking" },
    "whole turn: a quote from the text before the tool call is marked, the final message after it");

  // ── mdVerbatim, hardBreaks ─────────────────────────────────────────────
  const unescape = (s) => s.split("\\\n").map((l) => l.replace(/^ +/, (m) => " ".repeat(m.length)).replace(/\\([\\`*_{}[\]()#+\-.!|<>~=&$^:@])/g, "$1")).join("\n");
  const CASES = ["# h", "1. x", "- x", "> q", "use `code` here", "*x*", "_x_", "[a](b)", "<b>bold</b>", "a | b | c", "ends with a backslash \\", "  indented two",
    "line one\nline two\n\nafter a blank", "https://example.com/a_b?x=1&y=2", "~~gone~~ $x$ ^1 a=b !img", "---", "***", "    four spaces"];
  for (const c of CASES) {
    const v = D.mdVerbatim(c);
    A.equal(unescape(v), c, `mdVerbatim round-trips ${JSON.stringify(c)}`);
    A.ok(!/(^|[^\\])[#*_`[\]<>|]/.test(v.replace(/\\\\/g, "")), `every syntax mark escaped in ${JSON.stringify(v)}`);
  }
  A.equal(D.mdVerbatim("# h"), "\\# h"); A.equal(D.mdVerbatim("1. x"), "1\\. x"); A.equal(D.mdVerbatim("*x*"), "\\*x\\*");
  A.equal(D.mdVerbatim("a\nb"), "a\\\nb", "a line break is a hard break");
  A.equal(D.mdVerbatim("a\n\nb"), "a\\\n\\\nb", "a blank line stays a line");
  A.equal(D.mdVerbatim("ends \\"), "ends \\\\", "a trailing backslash shows as itself");
  A.equal(D.mdVerbatim("a\n"), "a", "trailing line breaks dropped");
  A.equal(D.mdVerbatim("  x"), "  x", "leading spaces kept as no-break spaces");
  A.equal(D.mdVerbatim(null), "");
  A.equal(D.hardBreaks("a\nb\n\nc"), "a  \nb\n\nc", "single breaks kept, paragraphs left alone");
  A.equal(D.hardBreaks("x\n```js\nconst a = 1;\nconst b = 2;\n```\ny"), "x\n```js\nconst a = 1;\nconst b = 2;\n```\ny", "fenced code untouched");
  A.equal(D.hardBreaks("a  \nb"), "a  \nb", "an existing hard break is kept");

  // ── closing ────────────────────────────────────────────────────────────
  A.equal(D.closesAfterStage({ pasted: true, ms: 100 }), true, "pasted: closes");
  for (const why of ["off", "focus", "plain", "blocked"]) A.equal(D.closesAfterStage({ pasted: false, why }), true, `${why}: closes (pane focused)`);
  for (const why of ["gone", "clipboard", "error"]) A.equal(D.closesAfterStage({ pasted: false, why }), false, `${why}: stays open`);
  A.equal(D.closesAfterStage(null), false, "the pending report (no r) never closes"); A.equal(D.closesAfterStage({ pasted: false, why: "?" }), false);
  const mine = { overlay: "ov-1", id: "rq_1", at: 5 };
  A.deepEqual(D.mergeClosed({ open: { overlay: "ov-1", id: "rq_1" }, closed: null }, mine), { open: null, closed: mine }, "its own open record cleared");
  A.deepEqual(D.mergeClosed({ open: { overlay: "ov-2", id: "rq_2" }, closed: { overlay: "ov-0" } }, mine), { open: { overlay: "ov-2", id: "rq_2" }, closed: mine }, "a newer dialog's open record kept");
  A.deepEqual(D.mergeClosed(undefined, mine), { open: null, closed: mine });
  const now = 1_800_000_000_000;
  const kept = D.keepConclude({}, "br_1", "my edit", now);
  A.deepEqual(kept, { br_1: { text: "my edit", at: now } }, "kept");
  A.equal(D.keptConclude(kept, "br_1", now + 1000, null), "my edit", "offered back");
  A.equal(D.keptConclude(kept, "br_1", now + 1000, now - 10), "my edit", "newer than the posted conclusion");
  A.equal(D.keptConclude(kept, "br_1", now + 1000, now + 10), null, "older than the posted conclusion: ignored");
  A.equal(D.keptConclude(kept, "br_1", now + DAY, null), null, "expired after a day");
  A.equal(D.keptConclude(kept, "br_2", now, null), null, "another branch has none");
  A.deepEqual(D.keepConclude(kept, "br_1", "  ", now), {}, "an empty text drops it");
  A.deepEqual(Object.keys(D.keepConclude({ old: { text: "x", at: now - 2 * DAY }, br_9: { text: "y", at: now - 10 } }, "br_1", "z", now)).sort(), ["br_1", "br_9"], "day-old entries go");
  A.equal(D.KEEP_KEY, "detail.conclude");

  // ── words ──────────────────────────────────────────────────────────────
  A.equal(W.stageLabels(true).quick, "Paste"); A.equal(W.stageLabels(false).quick, "Copy");
  A.equal(W.stageLabels(true).one, "Paste answer", "existing labels unchanged");
  A.equal(W.copiedWords("The passage", 412), "The passage copied (412 characters); nothing was pasted.");
  A.equal(W.messageGone(16), "Passage not saved for turn 16 (ledgr-data/turns/…/16.md).");
  A.equal(W.PIN_MESSAGE_GONE, "That message is no longer saved; the pin keeps the passage.");
  A.ok(W.DETAIL_GONE.length > 10);
  A.deepEqual(W.detailHints({}), [["Esc", "close"]]);
  A.deepEqual(W.detailHints({ answer: true }), [["Esc", "close"], ["Tab", "next field"], ["Enter", "paste the turn's answers"]]);
  A.deepEqual(W.detailHints({ note: true, paste: false }).map((h) => h[0]), ["Esc", "Tab", "Enter"]);
  const PS = "aaaa", OS = "bbbb";
  const ustore = { d: { sessions: { [OS]: { sessionId: OS, sessionName: "billing-api" } } },
    item: (id) => (id === "q_sent" ? { id, pinsAsked: { turn: 14, at: 300 } } : null) };
  const upin = { sessionId: PS, usedIn: [
    { question: "q_used", handle: "Q3", session: PS, at: 100 }, { question: "q_sent", handle: "Q4", session: PS, at: 200 },
    { question: "q_br", handle: "Q5", session: OS, at: 150 }],
    answeredIn: [{ question: "q_br", handle: "Q5", session: OS, turn: 16, via: "branch", branchName: "br-q5-1a2b", at: 400 }] };
  A.deepEqual(W.pinUseLines(upin, ustore).map((l) => [l.question, l.words]), [
    ["q_br", "answered in Question 5 of billing-api (branch br-q5-1a2b, turn 16)"],
    ["q_sent", "sent in Question 4 at turn 14"],
    ["q_used", "used in Question 3"]], "pinUseLines: every use, newest first, the furthest each got");
  A.deepEqual(W.pinUseLines({ usedIn: [], answeredIn: [] }), []);
  A.equal(W.pinUseWords(upin, ustore), "answered in Question 5 of billing-api (branch br-q5-1a2b, turn 16) · sent in Question 4 at turn 14 · +1 more", "pinUseWords unchanged");

  // ── fixtures (2.10) ────────────────────────────────────────────────────
  const demo = new Store(FX.demoData()), SID = FX.DEMO_SESSION;
  A.equal(FX.DEMO_DETAIL, "A15");
  const by = (h) => demo.byHandle(SID, h);
  A.ok(by("A15") && by("A15").kind === "decide" && by("A15").level === "blocking" && by("A15").options.length === 2, "A15: a blocking decide with options");
  A.ok(FX.FIXTURE_TURNS[`${SID}:${by("A15").anchor.turn}`].includes(by("A15").anchor.quote.slice(0, 40)), "A15: its passage is in turn 17");
  A.equal(by("A7").status, "answered"); A.ok(by("A9").repeatOf, "A9 raised again");
  A.ok(demo.branchesFor(by("Q3").id).some((b) => b.status === "running"), "Q3: a running branch");
  A.ok(FX.FIXTURE_TURNS[`${demo.d.branches.br_demo_q3_7c1e.sessionId}:1`].includes("```ledgr-conclusion"), "Q3's branch has a ledgr-conclusion");
  A.equal(by("Q2").resolvedBy, "branch"); A.equal(demo.d.branches.br_demo_q2_a41b.status, "rejoined");
  A.equal(FX.FIXTURE_TURNS[`${SID}:${by("Q5").anchor.turn}`], undefined, "Q5: its message not saved");
  A.equal(by("Q6").kind, "bookmark"); A.equal(demo.pinsOf(by("Q9")).length, 2); A.equal(by("Q9").status, "answered");
  const P2 = demo.pinByHandle(SID, "P2"), P3 = demo.pinByHandle(SID, "P3");
  A.ok(P2?.note, "P2 has a note"); A.equal(P3?.status, "archived", "P3 archived"); A.equal(demo.d.sessions[SID].nextHandle.P, 4);
  const lost = demo.pins().filter((p) => !demo.d.sessions[p.sessionId]);
  A.equal(lost.length, 1, "one pin of a forgotten session"); A.ok(lost[0].source?.sessionName, "it keeps its session's name");
  A.ok(demo.searchPins("retries capped", { here: SID }).groups.some((g) => g.sessionId === lost[0].sessionId), "search finds it");
  A.deepEqual(demo.pinsIn(SID, { archived: true }).map((p) => p.handle), ["P3"], "archived (1)");

  // ── main.js, as text ───────────────────────────────────────────────────
  const main = fs.readFileSync(path.join(MOD, "main.js"), "utf8");
  const ctl = main.split("\n").find((l) => l.includes("this.ctl =")) ?? "";
  A.ok(ctl.includes('p.view === "detail"') && ctl.indexOf('p.view === "detail"') < ctl.indexOf("isCapture(p)"), "main.js: the detail view is tested before isCapture");
  A.ok(/import \{ Detail \} from "\.\/detail\.js";/.test(main), "main.js imports Detail");
  A.match(main, /async close\(_cx\) \{\s*try \{ await this\.ctl\?\.release\?\.\(\); \}/, "main.js: close awaits release");

  // ── views.js exports (2.9) ─────────────────────────────────────────────
  const V = await import(`${dir}/views.js`);
  const sig = { ICON: 1, btn: 4, pill: 3, badge: 3, glyph: 2, menuButton: 5, readable: 3, messageBlocks: 4, manifestView: 2, optionChips: 3, answerBox: 5,
    confirmBox: 5, confluenceView: 5, concludeBox: 5, branchBody: 5, branchActions: 6, pinNoteBox: 3, subRow: 3, keyHints: 2 };
  for (const [name, n] of Object.entries(sig)) { A.equal(typeof V[name], "function", `views.js exports ${name}`); A.equal(V[name].length, n, `${name} takes ${n} parameters before its options`); }
  A.equal(V.IND, 18);
  // A theme as the dialog draws with it: config.js withScale's (every text size through t.ts).
  const t0 = (await import(`${dir}/config.js`)).withScale(new Proxy({}, { get: () => "#778899" }), 1);
  globalThis.__ui = { ids: new Map(), md: new Map(), scrolls: [] };
  V.readable(t0, "rv", "# not a heading", { mode: "verbatim" });
  A.equal(UI().md.get("rv"), "\\# not a heading", "readable verbatim escapes");
  V.readable(t0, "rm", "**bold**\nnext");
  A.equal(UI().md.get("rm"), "**bold**  \nnext", "readable markdown keeps its line breaks");
  A.equal(V.TEXT_SCROLLABLE, false, "TEXT_SCROLLABLE false (2.2: the dialog's columns scroll)");
  { const tv = V.readable(t0, "rs", "text")._kids[0];
    A.equal(tv._tv, "rs", "readable draws a TextView"); A.equal(tv._selectable, true, "selectable");
    A.equal(tv._scrollable, undefined, "not scrollable: no scroll area nested in a column"); }
  const mb = V.messageBlocks(t0, "x", T, "The quote is here", { whole: false });
  A.equal(mb.length, 3); A.equal(mb.hitAt, 1); A.equal(UI().md.get("dt-msg-h-x"), "The quote is here, in the middle.");
  A.equal(V.messageBlocks(t0, "y", "nothing", "absent").hitAt, -1);

  // ── the dialog (detail.js) ─────────────────────────────────────────────
  const { Detail } = await import(`${dir}/detail.js`);
  const ids = { A15: by("A15").id, A7: by("A7").id, A9: by("A9").id, A5: by("A5").id, A13: by("A13").id, Q3: by("Q3").id, Q2: by("Q2").id, Q5: by("Q5").id,
    Q6: by("Q6").id, Q7: by("Q7").id, Q8: by("Q8").id, Q9: by("Q9").id, Q4: by("Q4").id, P1: demo.pinByHandle(SID, "P1").id, P2: P2.id, P3: P3.id, LOST: lost[0].id,
    B3: "br_demo_q3_7c1e", B2: "br_demo_q2_a41b", BR: "br_demo_refused" };
  const kindFor = (id) => (id.startsWith("pn_") ? "pin" : id.startsWith("br_") ? "branch" : demo.item(id)?.direction === "agent_to_human" ? "ask" : "question");
  const reset = (o = {}) => {
    globalThis.__herdr = { props: {}, shared: {}, runs: [], overlays: [], closed: [], writes: [], agents: [], terminals: [], panes: [], focus: null, files: {}, n: 0, ...o };
    globalThis.__ui = { ids: new Map(), md: new Map(), scrolls: [] };
    globalThis.__staged = [];
    globalThis.localStorage = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })();
  };
  const open = async (id, o = {}) => {
    H().props = { view: "detail", session: SID, kind: o.kind ?? kindFor(id), id, demo: o.demo ?? true, overlay: o.overlay ?? "ov-1", opener: "panel-1", open: o.open ?? null };
    const cx = mkcx(), d = new Detail({}, cx);
    if (o.width) d.width = o.width;
    await drain(cx, o.upTo ?? 1000);
    return { d, cx };
  };
  const draw = (d, cx) => { globalThis.__ui = { ids: new Map(), md: new Map(), scrolls: [] }; const tree = d.render(cx); return { tree, all: texts(tree).join("\n") }; };

  // Every demo case, one and two columns.
  reset();
  for (const [h, id] of Object.entries(ids)) {
    for (const width of [900, 500]) {
      const { d, cx } = await open(id, { width });
      let r;
      A.doesNotThrow(() => { r = draw(d, cx); }, `${h} renders at ${width} px`);
      A.ok(UI().ids.has("ledgr-detail") && UI().ids.has("dt-head") && UI().ids.has("dt-foot"), `${h}: root, header, footer`);
      A.equal(UI().ids.has("dt-msg"), width >= 760, `${h}: ${width >= 760 ? "two columns" : "one column"}`);
      if (width === 900) ids[`${h}:text`] = r.all;
    }
  }
  const has = (h, s) => A.ok(ids[`${h}:text`].includes(s), `${h} shows “${s}”`);
  has("A15", "Choose the cutover night"); has("A15", "OPTIONS"); has("A15", "ANSWER"); has("A15", "THE MESSAGE · turn 17");
  has("A7", "RESULT"); has("A7", "Yes, drop it\\."); has("A9", "Raised again"); has("A5", "QUESTIONS ABOUT IT");
  has("Q3", "BRANCHES"); has("Q2", "resolved by its branch"); has("Q5", "Passage not saved for turn 16"); has("Q6", "BOOKMARKED PASSAGE");
  has("Q9", "PINS (2)"); has("Q4", "anchors at end of turn"); has("Q7", "re \\[A5\\]"); has("Q8", "https\\://grafana\\.example\\.com");
  has("P2", "NOTE"); has("P2", "the claim turn 16 overturned"); has("P3", "Restore"); has("P3", "Delete"); has("LOST", "forgotten"); has("LOST", "That message is no longer saved");
  has("B3", "MANIFEST"); has("B3", "CONCLUSION"); has("B3", "THE BRANCH'S LAST MESSAGE · its turn 1"); has("B2", "REJOINED"); has("BR", "Refused");
  A.ok(!ids["A15:text"].includes("Stage /btw"), "no /btw on an ask");

  // The marked passage scrolled into view (two columns: the message column's third child).
  reset();
  { const { d, cx } = await open(ids.A15, { width: 900 }); draw(d, cx);
    A.equal(UI().md.get(`dt-msg-h-${ids.A15}`)?.includes("Choose the cutover night"), true, "A15: its passage is the marked block");
    A.deepEqual(d.msgScroll._to, [2], "two columns: the passage block scrolled into view (head, before, passage)");
    draw(d, cx); A.deepEqual(d.msgScroll._to, [2], "once per message view"); }
  { const { d, cx } = await open(ids.A15, { width: 500 }); draw(d, cx);
    A.equal(d.leftScroll._to.length, 1, "one column: the left column scrolls to it"); A.ok(d.leftScroll._to[0] > 3); }
  { const { d, cx } = await open(ids.B3, { width: 900 }); draw(d, cx);
    A.ok(UI().md.get(`dt-msg-h-${ids.B3}`)?.includes("ledgr-conclusion"), "a branch: its ledgr-conclusion block is the marked passage"); }

  // A demo ask: an option, Paste answer, Done (the dialog closes), the closed record.
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const { d, cx } = await open(ids.A15);
    A.equal(d.inApp, true, "in the app (AGENTS.md read)");
    A.equal(H().shared["ledgr.detail"]?.open?.overlay, "ov-1", "the open record names this dialog"); A.equal(H().shared["ledgr.detail"].open.id, ids.A15);
    draw(d, cx);
    A.ok(d.answer && d.answerFor === ids.A15, "the answer field was made (not in render)");
    click(`dt-opt-${ids.A15}-1`, cx);
    A.equal(d.viewStore().item(ids.A15).draft, "Thursday night"); A.equal(d.answer.value(), "Thursday night", "the option fills the answer field");
    draw(d, cx); click(`dt-copy1-${ids.A15}`, cx);
    A.ok(String(cx.clip).startsWith("ledgr answers"), "Paste answer (demo): the sheet on the clipboard");
    draw(d, cx); click(`dt-done-${ids.A15}`, cx);
    A.equal(d.viewStore().item(ids.A15).status, "resolved", "Done (demo): its own store"); A.deepEqual(H().closed, ["ov-1"], "Done closes the dialog");
    await d.release();
    const rec = H().shared["ledgr.detail"];
    A.equal(rec.open, null, "its open record cleared"); A.equal(rec.closed.id, ids.A15); A.equal(rec.closed.focus, "list", "a closing act: the list takes the keyboard");
    A.match(rec.closed.flash, /Ask 15 done/); A.equal(rec.closed.overlay, "ov-1"); A.equal(rec.closed.opener, "panel-1"); }

  // Live (not demo): Done writes its act, then closes; Paste answer stages and closes into the pane; Esc.
  const storeText = JSON.stringify(FX.demoData());
  fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), storeText);
  const agentsLive = [{ address: "t21", status: "idle", app: "claude-code", agent: "claude-code" }];
  reset({ files: { [`${APP}/AGENTS.md`]: "x" }, agents: agentsLive, terminals: [{ address: "t21", state: "live" }], panes: [{ terminal: "t21" }], focus: { terminal: "t21", shown: null } });
  { const { d, cx } = await open(ids.A6 ?? by("A6").id, { demo: false });
    A.equal(d.demo, false); A.ok(d.resolve(d.viewStore()), "the record read from store.json");
    draw(d, cx); click(`dt-done-${by("A6").id}`, cx);
    A.deepEqual(H().closed, [], "Done: not closed before its act is written");
    await drain(cx);
    const w = H().writes.find(([p]) => p.includes("/spool/") && p.includes("-act-"));
    A.ok(w, "the act went to the spool"); const ev = JSON.parse(w[1]);
    A.equal(ev.action, "resolve"); A.equal(ev.item, by("A6").id); A.equal(ev.session_id, SID);
    A.deepEqual(H().closed, ["ov-1"], "then the dialog closed");
    await d.release(); A.equal(H().shared["ledgr.detail"].closed.focus, "list"); }
  reset({ files: { [`${APP}/AGENTS.md`]: "x" }, agents: agentsLive, terminals: [{ address: "t21", state: "live" }], panes: [{ terminal: "t21" }], focus: { terminal: "t21", shown: null } });
  { const { d, cx } = await open(ids.A15, { demo: false });
    draw(d, cx);
    d.setDraft(d.viewStore().item(ids.A15), "Thursday night", cx);
    draw(d, cx); click(`dt-copy1-${ids.A15}`, cx);
    await drain(cx);
    A.ok(String(cx.clip ?? "").includes("ledgr answers"), "Paste answer: the sheet staged");
    A.deepEqual(H().closed, ["ov-1"], "the paste decided: the dialog closed");
    await d.release();
    const rec = H().shared["ledgr.detail"].closed;
    A.equal(rec.focus, "pane", "a staging: the pane keeps the keyboard"); A.equal(rec.terminal, "t21");
    A.equal(rec.drafts[ids.A15], "Thursday night", "the draft typed here goes to the panel");
    A.ok(H().writes.some(([p, txt]) => p.includes("-act-") && JSON.parse(txt).action === "draft"), "release wrote the waiting draft"); }
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const { d, cx } = await open(ids.Q8, { demo: false });
    const { tree } = draw(d, cx);
    tree._h.on_key_down({ keystroke: "escape" }, cx);
    A.deepEqual(H().closed, ["ov-1"], "Esc closes");
    await d.release(); A.equal(H().shared["ledgr.detail"].closed.focus, "list", "Esc: the list takes the keyboard"); }
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const { d, cx } = await open(ids.Q8, { demo: false });
    d.close(); await d.release();
    A.equal(H().shared["ledgr.detail"].closed.focus, null, "a click outside: nothing takes the keyboard"); }
  // A newer dialog's open record survives an older one closing.
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const one = await open(ids.A15, { overlay: "ov-1" }), two = await open(ids.A7, { overlay: "ov-2" });
    await one.d.release();
    A.equal(H().shared["ledgr.detail"].open?.overlay, "ov-2", "the newer open record kept"); A.equal(H().shared["ledgr.detail"].closed.overlay, "ov-1");
    A.equal(one.d.isCurrent(), false); A.equal(two.d.isCurrent(), true); }

  // Retarget: a sub-row shows that record in place; the open record follows.
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const { d, cx } = await open(ids.Q9);
    draw(d, cx);
    const sub = [...UI().ids.keys()].find((k) => k.startsWith("dt-sub-") && k.includes(ids.P1));
    A.ok(sub, "Q9 lists its pins as sub-rows"); click(sub, cx);
    A.equal(d.target.id, ids.P1); A.equal(d.target.kind, "pin"); A.equal(H().shared["ledgr.detail"].open.id, ids.P1, "the open record follows");
    const { all } = draw(d, cx); A.ok(all.includes("PASSAGE") && all.includes("USED IN"), "the pin's sections");
    A.deepEqual(H().closed, [], "in place: the overlay stays"); }

  // Commands: only for this item; detail:pick; Tab only while the dialog holds the keyboard.
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const { d, cx } = await open(ids.A15);
    d.command("pick:A15:0", cx); A.equal(d.viewStore().item(ids.A15).draft, "Tonight, after the deploy", "pick: on this item");
    d.command("pick:A10:0", cx); A.equal(d.viewStore().item(ids.A15).draft, "Tonight, after the deploy", "pick: on another item is the panel's");
    d.command("detail:pick:1", cx); A.equal(d.answer.value(), "Thursday night");
    d.command("detail:answer:Thursday, after the backup", cx); A.equal(d.viewStore().item(ids.A15).draft, "Thursday, after the backup");
    d.command("detail:whole", cx); A.equal(d.whole, true);
    const before = d.answer._focused; d.fieldOn = null; d.command("tab", cx); await drain(cx);
    A.equal(d.answer._focused, before, "Tab: ignored while the dialog does not hold the keyboard");
    d.fieldOn = d.answer; d.command("tab", cx); await drain(cx); A.equal(d.keys._f > 0, true, "Tab from the answer: the dialog itself");
    d.command("btw", cx); d.command("pin", cx); A.deepEqual(H().closed, [], "⌘Enter and ⌘S do nothing here");
    d.command("detail:close", cx); A.deepEqual(H().closed, ["ov-1"], "detail:close"); }

  // The Conclude editor (demo): prefilled from the block, edited, staged; its text kept meanwhile (live).
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const { d, cx } = await open(ids.B3, { open: "conclude" });
    A.ok(d.conclude, "open: conclude"); A.equal(d.conclude.source, "block", "prefilled from the ledgr-conclusion block");
    draw(d, cx); A.ok(UI().ids.has(`brk-box-${ids.B3}`), "the Conclude editor drawn");
    d.command("conclude-edit:one more line", cx); A.ok(d.conclude.input.value().endsWith("one more line"));
    d.command("send-to-trunk", cx); A.ok(String(cx.clip).startsWith("ledgr confluence"), "send-to-trunk (demo): the confluence on the clipboard"); A.equal(d.conclude, null); }
  fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), storeText);
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const { d, cx } = await open(ids.B3, { demo: false, open: "conclude" });
    A.ok(d.conclude, "live: the editor opens");
    d.conclude.input.set_value("my own conclusion"); d.conclude.input._on.change({}, cx);
    A.equal(JSON.parse(localStorage.getItem("detail.conclude"))[ids.B3].text, "my own conclusion", "each change kept in localStorage");
    await d.release();
    const again = await open(ids.B3, { demo: false, open: "conclude", overlay: "ov-3" });
    A.equal(again.d.conclude.input.value(), "my own conclusion", "reopened: the kept text offered back"); A.equal(again.d.conclude.source, "edited"); }

  // The pins: Archive closes; Delete takes two clicks; a pin's Copy only copies.
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const { d, cx } = await open(ids.P2);
    draw(d, cx); click(`dt-pincopy-${ids.P2}`, cx);
    A.ok(String(cx.clip).includes("The orders migration finished"), "Copy: the pin quoted"); A.deepEqual(H().closed, [], "Copy keeps the dialog");
    d.archivePin(d.viewStore().pin(ids.P2), cx); A.equal(d.viewStore().pin(ids.P2).status, "archived"); A.deepEqual(H().closed, ["ov-1"], "Archive closes"); }
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const { d, cx } = await open(ids.P3);
    draw(d, cx); click(`pindel-${ids.P3}`, cx); A.deepEqual(H().closed, [], "Delete: the first click arms");
    draw(d, cx); click(`pindel-${ids.P3}`, cx); A.equal(d.viewStore().pin(ids.P3), null, "the second deletes"); A.deepEqual(H().closed, ["ov-1"]); }

  // Esc while a paste waits for the focus (it never comes here): the close cancels the paste, but the sheet
  // is on the clipboard and pane t21 focused, so the record says focus "pane" and to paste with ⌘V.
  fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), storeText);
  reset({ files: { [`${APP}/AGENTS.md`]: "x" }, agents: agentsLive, terminals: [{ address: "t21", state: "live" }], panes: [{ terminal: "t21" }], focus: null });
  { const { d, cx } = await open(ids.A15, { demo: false });
    draw(d, cx);
    d.setDraft(d.viewStore().item(ids.A15), "Thursday night", cx);
    draw(d, cx); click(`dt-copy1-${ids.A15}`, cx);
    A.equal(d.pastePending(), true, "the paste is pending (its task not run)"); A.match(d.flash, /pasting it into the prompt/);
    A.ok(H().runs.some(([n, a]) => n === "pane.focus" && a?.terminal === "t21"), "its pane was focused");
    A.equal(d.staged?.terminal, "t21", "Reader stage keeps the staged terminal");
    const { tree } = draw(d, cx);
    tree._h.on_key_down({ keystroke: "escape" }, cx);
    A.deepEqual(H().closed, ["ov-1"], "Esc closes");
    await d.release();
    const rec = H().shared["ledgr.detail"].closed;
    A.equal(rec.focus, "pane", "a paste pending: the keyboard stays in its pane, not pulled back to the list"); A.equal(rec.terminal, "t21");
    A.ok(!/pasting it/.test(rec.flash), "the flash no longer says pasting…");
    A.match(rec.flash, /on the clipboard and pane t21 is focused/); A.match(rec.flash, /paste with ⌘V/);
    A.equal(W.pasteCutWords({ what: "X", where: "pane t9", lead: "L" }), "X is on the clipboard and pane t9 is focused; the dialog closed before the paste was confirmed. If it is not in the prompt there, paste with ⌘V, add a word of your own such as “L”, then Enter."); }
  // Not pending (the paste decided): Esc says focus "list" as before.
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const { d, cx } = await open(ids.Q8, { demo: false });
    d.staged = { terminal: "t21", what: "x", where: "pane t21", lead: "" }; d.pasting = 0;
    const { tree } = draw(d, cx); tree._h.on_key_down({ keystroke: "escape" }, cx); await d.release();
    A.equal(H().shared["ledgr.detail"].closed.focus, "list", "no paste pending: Esc gives the list the keyboard"); }

  // Esc while a closing act's write is pending: Done went through Reader post, so release() writes it.
  reset({ files: { [`${APP}/AGENTS.md`]: "x" }, agents: agentsLive, terminals: [{ address: "t21", state: "live" }], panes: [{ terminal: "t21" }] });
  { const { d, cx } = await open(by("A6").id, { demo: false });
    draw(d, cx); click(`dt-done-${by("A6").id}`, cx);
    A.equal([...d.unwritten.values()].filter((e) => e.type === "act" && e.payload.action === "resolve").length, 1, "Done: its act kept in unwritten until written");
    A.deepEqual(H().closed, [], "not closed before the write");
    const { tree } = draw(d, cx); tree._h.on_key_down({ keystroke: "escape" }, cx);
    await d.release();   // the write task never ran: Herdr cancels it once close() resolves
    const w = H().writes.map(([p, txt]) => (p.includes("-act-") ? JSON.parse(txt) : null)).filter(Boolean);
    A.ok(w.some((e) => e.action === "resolve" && e.item === by("A6").id), "release wrote the Done the Esc interrupted");
    A.equal(d.unwritten.size, 0, "nothing left unwritten"); A.equal(H().shared["ledgr.detail"].closed.focus, "list"); }
  // A failed write keeps the dialog open, the act still unwritten (release writes it again).
  reset({ files: { [`${APP}/AGENTS.md`]: "x" }, agents: agentsLive, terminals: [{ address: "t21", state: "live" }], panes: [{ terminal: "t21" }] });
  { const { d, cx } = await open(by("A6").id, { demo: false });
    H().failWrites = true;
    draw(d, cx); click(`dt-done-${by("A6").id}`, cx); await drain(cx);
    A.deepEqual(H().closed, [], "the write failed: the dialog stays open"); A.equal(d.closing, false, "no longer dimmed");
    A.match(d.flash, /^Not sent to the ledgr writer: disk full/); A.equal(d.unwritten.size, 1, "the act kept for release to write again");
    H().failWrites = false; d.close(); await d.release();
    A.ok(H().writes.some(([p, txt]) => p.includes("-act-") && JSON.parse(txt).action === "resolve"), "release wrote it"); }

  // Paste into trunk with paste off (the trunk's pane focused, nothing pasted): the staging closes the dialog
  // at once, so the conclude event is posted first, already in unwritten when the close comes.
  fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), storeText);
  reset({ files: { [`${APP}/AGENTS.md`]: "x" }, agents: agentsLive, terminals: [{ address: "t21", state: "live" }], panes: [{ terminal: "t21" }], focus: { terminal: "t21", shown: null } });
  { const { d, cx } = await open(ids.B3, { demo: false, open: "conclude" });
    A.ok(d.conclude, "the Conclude editor");
    d.cfg = { ...d.cfg, ui: { ...(d.cfg.ui ?? {}), pasteIntoPrompt: false } };
    d.conclude.input.set_value("answer: the pool is capped at 20.");
    d.pasting = Date.now(); d.staged = { terminal: "t21", what: "x", where: "the trunk (pane t21)", lead: "" };
    d.command("send-to-trunk", cx);
    A.equal(d.unwritten.size, 0, "another paste pending: nothing posted"); A.match(d.flash, /^Still pasting into the trunk \(pane t21\)…$/); A.ok(d.conclude, "the editor stays");
    d.pasting = 0;
    let atClose = null; const close = d.close.bind(d);
    d.close = () => { atClose = [...d.unwritten.values()].map((e) => e.type); close(); };
    d.command("send-to-trunk", cx);
    A.deepEqual(H().closed, ["ov-1"], "paste off: the staging closed the dialog at once");
    A.deepEqual(atClose, ["conclude"], "the conclude event was posted before the close");
    A.ok(String(cx.clip).startsWith("ledgr confluence"), "the confluence on the clipboard");
    await d.release();
    const ev = H().writes.map(([p, txt]) => (p.includes("-conclude-") ? JSON.parse(txt) : null)).find(Boolean);
    A.ok(ev, "release wrote the conclude event"); A.equal(ev.branch_id, ids.B3); A.equal(ev.text, "answer: the pool is capped at 20.");
    A.equal(H().shared["ledgr.detail"].closed.focus, "pane"); }

  // Opened before store.json has the record (a question just parked): open "confirm" is kept, then applied
  // once a reload brings it, with its message loaded (not left at "Loading the message…").
  { const early = JSON.parse(storeText); delete early.items[ids.Q3];
    fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), JSON.stringify(early)); }
  reset({ files: { [`${APP}/AGENTS.md`]: "x" }, agents: agentsLive, terminals: [{ address: "t21", state: "live" }], panes: [{ terminal: "t21" }] });
  { const { d, cx } = await open(ids.Q3, { demo: false, open: "confirm" });
    A.equal(d.resolve(d.viewStore()), null, "not in the store yet");
    A.equal(d.p.open, "confirm", "the open state is kept until the record resolves"); A.equal(d.confirm, null);
    const q3 = demo.item(ids.Q3), { turnPath } = await import(`${dir}/config.js`);
    H().files[turnPath(SID, q3.anchor.turn)] = FX.FIXTURE_TURNS[`${SID}:${q3.anchor.turn}`] ?? "The turn's text.";
    fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), storeText);
    A.equal(await d.reload(), true, "the reload brings it");
    draw(d, cx); await drain(cx);
    A.equal(d.confirm?.itemId, ids.Q3, "then the Branch confirmation opens"); A.equal(d.p.open, null, "applied once");
    A.equal(d.preparedFor, ids.Q3);
    const { all } = draw(d, cx);
    A.ok(!all.includes("Loading the message…"), "the question's message is read"); A.ok(UI().md.has(`dt-msg-h-${ids.Q3}`), "its message, the passage marked"); }

  // A branch in its first turn: its message column says it has not finished a turn yet; with turn 2
  // running, the newest finished turn (1) shows.
  { const first = JSON.parse(storeText), bsid = first.branches[ids.B3].sessionId;
    delete first.turns[bsid][1].stopAt;
    fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), JSON.stringify(first)); }
  reset({ files: { [`${APP}/AGENTS.md`]: "x" }, agents: agentsLive, terminals: [{ address: "t21", state: "live" }], panes: [{ terminal: "t21" }] });
  { const { d, cx } = await open(ids.B3, { demo: false });
    draw(d, cx); await drain(cx);
    const { all } = draw(d, cx);
    A.ok(all.includes(W.BRANCH_NO_TURN), "first turn running: not finished a turn yet"); A.ok(!all.includes("Loading the message…"), "not Loading the message…"); }
  { const second = JSON.parse(storeText), bsid = second.branches[ids.B3].sessionId;
    second.sessions[bsid].turn = 2; second.turns[bsid][2] = { textHead: null };
    fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), JSON.stringify(second));
    const { turnPath } = await import(`${dir}/config.js`);
    reset({ files: { [`${APP}/AGENTS.md`]: "x", [turnPath(bsid, 1)]: FX.FIXTURE_TURNS[`${bsid}:1`] }, agents: agentsLive, terminals: [{ address: "t21", state: "live" }], panes: [{ terminal: "t21" }] }); }
  { const { d, cx } = await open(ids.B3, { demo: false });
    draw(d, cx); await drain(cx);
    const { all } = draw(d, cx);
    A.ok(all.includes("THE BRANCH'S LAST MESSAGE · its turn 1"), "turn 2 running: its turn 1 shows"); A.ok(UI().md.get(`dt-msg-h-${ids.B3}`)?.includes("ledgr-conclusion"), "with its conclusion marked"); }
  fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), storeText);

  // Commands naming a branch by its hc name (or id) reach the dialog open on that branch, and only it.
  reset({ files: { [`${APP}/AGENTS.md`]: "x" } });
  { const { d, cx } = await open(ids.B3);
    d.command("menu:br-q3-7c1e:more", cx); A.equal(d.dd, `brmore-${ids.B3}`, "menu:<hc name>: this branch's menu");
    d.command("whole:br-q3-7c1e", cx); A.equal(d.whole, true, "whole:<hc name>");
    d.command(`whole:${ids.B3}`, cx); A.equal(d.whole, false, "whole:<branch id>");
    d.dd = null; d.command("menu:br-q2-a41b:more", cx); A.equal(d.dd, null, "another branch's name: the panel's");
    d.command("whole:A15", cx); A.equal(d.whole, false, "an item handle is not this branch"); }

  // Bad props, a gone record.
  reset();
  { H().props = { view: "detail", kind: "nope", id: "rq_1", overlay: "ov-9" }; const cx = mkcx(), d = new Detail({}, cx); const { all } = draw(d, cx);
    A.ok(all.includes("Nothing to show (unknown kind nope)"), "bad props: Nothing to show (why)"); }
  { const { d, cx } = await open("rq_gone", { kind: "ask" }); const { all } = draw(d, cx); A.ok(all.includes(W.DETAIL_GONE), "a gone record: DETAIL_GONE");
    click("dt-x", cx); A.deepEqual(H().closed, ["ov-1"], "and only Close"); }

  // ── links (2026-11-10) ─────────────────────────────────────────────────
  const LK = await import(`${dir}/links.js`);
  const tvOf = (id) => UI().ids.get(`${id}-box`)?._kids?.[0];
  const withUrls = (cx) => { cx.opened = []; cx.open_url = (u) => { cx.opened.push(u); }; return cx; };
  // The demo: A15's turn 17 holds `reports/pool-settings.md`, a link under the private form; the message, the
  // ask's text and its quote take link clicks; a question's verbatim text takes none. The demo runs nothing.
  reset();
  { const { d, cx } = await open(ids.A15, { width: 900 }); withUrls(cx); draw(d, cx);
    A.ok(UI().md.get(`dt-msg-b-${ids.A15}`).includes(`[\`reports/pool-settings.md\`](${LK.linkFor({ path: "reports/pool-settings.md" })})`), "the message's code span path is a link, the code kept as its label");
    for (const id of [`dt-msg-b-${ids.A15}`, `dt-msg-h-${ids.A15}`, `dt-text-${ids.A15}`, `dt-quote-${ids.A15}`]) A.equal(typeof tvOf(id)?._h.on_link_click, "function", `${id} takes link clicks`);
    tvOf(`dt-msg-b-${ids.A15}`)._h.on_link_click(LK.linkFor({ path: "reports/pool-settings.md" }), cx);
    A.equal(d.flash, W.LINK_WORDS.demo("reports/pool-settings.md", ["/Users/example/src/shop-api/reports/pool-settings.md"], "the default app"), "the demo says where it would look");
    await drain(cx); A.deepEqual(H().execs ?? [], [], "the demo runs nothing");
    tvOf(`dt-msg-b-${ids.A15}`)._h.on_link_click("https://example.com/runbook", cx);
    A.deepEqual(cx.opened, ["https://example.com/runbook"], "a web link: cx.open_url"); A.equal(d.flash, W.LINK_WORDS.web("https://example.com/runbook")); }
  { const { d, cx } = await open(ids.Q8, { width: 900 }); draw(d, cx);
    A.equal(tvOf(`dt-text-${ids.Q8}`)?._h.on_link_click, undefined, "a question's text is verbatim: no links");
    A.ok(!UI().md.get(`dt-text-${ids.Q8}`).includes("ledgr.invalid"), "and no path made a link"); }
  // Live: the session's folder holds src/app.js; the repository's top (git's answer) holds lib/root.js.
  const WK = path.join(dir, "work"), REPO = path.join(dir, "repo");
  fs.mkdirSync(path.join(WK, "src"), { recursive: true }); fs.writeFileSync(path.join(WK, "src/app.js"), "x");
  fs.mkdirSync(path.join(REPO, "lib"), { recursive: true }); fs.writeFileSync(path.join(REPO, "lib/root.js"), "x");
  { const live = JSON.parse(storeText); live.sessions[SID].cwd = WK; fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), JSON.stringify(live)); }
  { const a15 = demo.item(ids.A15), { turnPath } = await import(`${dir}/config.js`);
    const MSG = `Changed \`src/app.js:12\` and lib/root.js; see https://example.com/pr/7 and docs/missing.md.\n\n${a15.anchor.quote}`;
    reset({ files: { [`${APP}/AGENTS.md`]: "x", [turnPath(SID, a15.anchor.turn)]: MSG }, agents: agentsLive, terminals: [{ address: "t21", state: "live" }], panes: [{ terminal: "t21" }] });
    H().execFn = (cmd) => (cmd === "git" ? { code: 0, stdout: `${REPO}\n`, stderr: "" } : { code: 0, stdout: "", stderr: "" }); }
  { const { d, cx } = await open(ids.A15, { demo: false, width: 900 }); withUrls(cx);
    draw(d, cx);
    const md = UI().md.get(`dt-msg-b-${ids.A15}`), click1 = (url) => { draw(d, cx); tvOf(`dt-msg-b-${ids.A15}`)._h.on_link_click(url, cx); };
    for (const [p, line] of [["src/app.js", 12], ["lib/root.js", null], ["docs/missing.md", null]]) A.ok(md.includes(`](${LK.linkFor({ path: p, line })})`), `${p} linked`);
    A.ok(md.includes("https://example.com/pr/7"), "a URL left as written");
    click1("https://example.com/pr/7"); A.deepEqual(cx.opened, ["https://example.com/pr/7"]); A.deepEqual(H().execs ?? [], [], "a web link starts no process");
    // A path in the session's folder, with open (the default).
    click1(LK.linkFor({ path: "src/app.js", line: 12 })); A.equal(d.flash, W.LINK_WORDS.looking("src/app.js:12")); await drain(cx);
    A.deepEqual(H().execs, [["open", [`${WK}/src/app.js`], { timeout: 5000 }]], "found in the session's folder: open <path>, 5 s");
    A.equal(d.flash, W.LINK_WORDS.opened(`${WK}/src/app.js:12`, "the default app"));
    draw(d, cx); A.ok(UI().ids.has("dt-link-reveal") && UI().ids.has("dt-link-copy"), "Reveal in Finder and Copy path on the status line");
    click("dt-link-copy", cx); A.equal(cx.clip, `${WK}/src/app.js`, "Copy path: the absolute path"); A.equal(d.flash, W.LINK_WORDS.copied(`${WK}/src/app.js`));
    draw(d, cx); click("dt-link-reveal", cx); await drain(cx);
    A.deepEqual(H().execs.at(-1), ["open", ["-R", `${WK}/src/app.js`], { timeout: 5000 }], "Reveal in Finder: open -R"); A.equal(d.flash, W.LINK_WORDS.revealed(`${WK}/src/app.js`));
    // zed at the line; a path only under the repository's top (git asked once); a relative markdown link as
    // a TextView may hand it over raw.
    d.cfg = { ...d.cfg, links: { editor: "zed" } }; H().execs = [];
    click1(LK.linkFor({ path: "src/app.js", line: 12 })); await drain(cx); A.deepEqual(H().execs, [["zed", [`${WK}/src/app.js:12`], { timeout: 5000 }]], "zed <path>:<line>");
    H().execs = []; click1(LK.linkFor({ path: "lib/root.js" })); await drain(cx);
    A.deepEqual(H().execs.map((e) => e.slice(0, 2)), [["git", ["-C", WK, "rev-parse", "--show-toplevel"]], ["zed", [`${REPO}/lib/root.js`]]], "not in the folder: the repository's top, then opened");
    A.equal(d.flash, W.LINK_WORDS.opened(`${REPO}/lib/root.js`, "Zed"));
    H().execs = []; click1("src/app.js#L3"); await drain(cx); A.deepEqual(H().execs, [["zed", [`${WK}/src/app.js:3`], { timeout: 5000 }]], "a relative markdown link, #L3");
    // Found nowhere: where it looked, no process, no chips.
    H().execs = []; click1(LK.linkFor({ path: "docs/missing.md" })); await drain(cx);
    A.equal(d.flash, W.LINK_WORDS.missing("docs/missing.md", [`${WK}/docs/missing.md`, `${REPO}/docs/missing.md`]), "the status line names the places looked");
    A.deepEqual(H().execs, [], "git answered once (cached); nothing opened"); draw(d, cx); A.ok(!UI().ids.has("dt-link-reveal"), "no chips for a path not found");
    // The editor not on PATH: said, and the chips still offered.
    H().execFn = () => { throw new Error("program not found"); };
    click1(LK.linkFor({ path: "src/app.js" })); await drain(cx);
    A.equal(d.flash, W.LINK_WORDS.failed(`${WK}/src/app.js`, "zed did not start (is it on your login shell's PATH?)")); draw(d, cx); A.ok(UI().ids.has("dt-link-copy"));
    // Other schemes open nothing; the dialog stayed open throughout.
    H().execs = []; click1("mailto:a@b.c"); A.equal(d.flash, W.LINK_WORDS.refused("mailto:a@b.c")); await drain(cx); A.deepEqual(H().execs, []);
    A.deepEqual(H().closed, [], "a link never closes the dialog"); H().execFn = null; }
  fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), storeText);
  // A session with no folder recorded: a relative path cannot be looked for.
  { const nf = JSON.parse(storeText); nf.sessions[SID].cwd = ""; fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), JSON.stringify(nf)); }
  reset({ files: { [`${APP}/AGENTS.md`]: "x" }, agents: agentsLive, terminals: [{ address: "t21", state: "live" }], panes: [{ terminal: "t21" }] });
  { const { d, cx } = await open(ids.A15, { demo: false }); d.openLink(LK.linkFor({ path: "src/app.js" }), cx);
    A.equal(d.flash, W.LINK_WORDS.noFolder("src/app.js")); await drain(cx); A.deepEqual(H().execs ?? [], []); }
  fs.writeFileSync(path.join(APP, "ledgr-data/store.json"), storeText);

  // The source: no stage method of its own, copies only copy.
  const src = fs.readFileSync(path.join(MOD, "detail.js"), "utf8");
  A.ok(!/^ {2}(async )?stage\(/m.test(src), "detail.js defines no stage method (Reader's is the one door)");
  A.ok(!src.includes("stageIntoPrompt(") && !src.includes("stageMessage("), "detail.js never calls nav.js's paste itself");
  A.ok(!fs.readFileSync(path.join(MOD, "views.js"), "utf8").includes("terminal.paste"), "views.js runs nothing");

  console.log(`OK: detail, ${checks} checks (props, spec, passage, verbatim, close rules, kept Conclude, words, fixtures, main.js, views, the dialog in every demo case and its flows, its links${DTS ? "; element methods checked against gpui-kit.d.ts" : "; gpui-kit.d.ts not found: element methods unchecked"}${stubs.length ? `; stub ${stubs.join(" and ")} (Builder A's, not in the mod yet)` : ""}), 0 failure(s)`);
} catch (e) {
  console.log(String(e?.stack ?? e).split("\n").slice(0, 8).join("\n"));
  console.log(`FAIL: detail, after ${checks} checks${stubs.length ? ` (stub ${stubs.join(" and ")})` : ""}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
