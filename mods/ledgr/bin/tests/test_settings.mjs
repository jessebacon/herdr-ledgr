// ledgr settings dialog and text scale (2026-11-10), under Node, self-contained: it copies the mod's .js files
// into a scratch folder with stub `herdr`, `gpui-kit` and `gpui-base` modules (writeTextFile keeps Herdr's
// compare-and-swap: a write whose `expected` is not the file's text is refused) and checks
//   the scale: config.js textScaleOf (the clamp to 0.8-1.6 and the 0.05 step), stepScale, scaleText (half
//     pixels), withScale (Herdr's theme left as it is), the default in config.js and ledgr_config.py;
//   the rows: settings.js settingRows (order, labels, values), spaceRows (Herdr's spaces by name, then an
//     off id Herdr no longer has), editFor (each row's change to config.json, bad values refused; Open files
//     with, links.editor, 2026-11-10: the presets, a command of your own, a shell or a terminal refused);
//   the one writer: reader.js editConfig (a missing file, unknown keys kept, a stale file refused and
//     nothing written, invalid JSON, another failure) and Reader saveConfig (queued clicks, a stale write
//     read again and said);
//   the dialog (settings.js): rows drawn, every control writes config.json through its own clicks, the
//     demo writes nothing, its commands, Esc and its closed record, and it never stages, copies or runs;
//   the panel (panel.js): the gear and ledgr.settings open it with an open detail dialog closed first, a
//     detail dialog opened closes it, its closed record comes back, the threshold and the space switch
//     write through the same saveConfig;
//   every text size: the panel, the detail dialog and the settings dialog drawn at 1 and at 1.6 give the
//     same sizes scaled (scaleText), and, statically, every text_size( in the mod goes through t.ts( in a
//     function that has t; ledgr-pane's chip scales its own text only.
//   node tests/test_settings.mjs
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(HERE, "../..");                 // mods/ledgr (repo or live install)
const PANE = path.resolve(MOD, "../ledgr-pane/main.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgr-settings."));
let checks = 0;
const A = new Proxy(assert, { get: (t, k) => (...a) => { checks++; return t[k](...a); } });

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
const CFG_PATH = `${APP}/ledgr-data/config.json`;

// herdr: every export of herdr.d.ts. Files live in H().files; writeTextFile is Herdr's compare-and-swap (the
// write happens only if the file still holds `expected`, null for a new file); H().beforeWrite(path) runs
// first (another writer, for a stale file); H().failWrites refuses every write with another error.
nm("herdr", `
const H = () => (globalThis.__herdr ??= { props: {}, shared: {}, runs: [], overlays: [], closed: [], writes: [], agents: [], terminals: [], panes: [], spaces: [], focus: null, files: {}, n: 0 });
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
export const spaces = () => H().spaces;
export const machines = () => [];
export const layout = () => H().layout ?? null;
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
export const writeTextFile = async (p, text, expected) => {
  H().beforeWrite?.(p);
  if (H().failWrites) throw new Error("disk full");
  const cur = p in H().files ? H().files[p] : null;
  if (cur !== (expected ?? null)) throw new Error("stale snapshot");
  H().files[p] = text; H().writes.push([p, text]); return null;
};
export const exec = async () => ({ code: 1, stdout: "", stderr: "" });
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

// gpui-kit / gpui-base: elements that record ids, handlers, children and every text_size given (in draw
// order); an element method gpui-kit.d.ts does not declare throws (when the typings are found).
const DTS = [path.join(MOD, "gpui-kit.d.ts"), path.join(os.homedir(), ".config/herdr-app/gpui-kit.d.ts")].find((p) => fs.existsSync(p));
const methods = DTS ? [...new Set([...fs.readFileSync(DTS, "utf8").matchAll(/^\s+(\w+)<Self extends Element>\(this: Self/gm)].map((m) => m[1]))] : [];
if (DTS) methods.push("selectable", "scrollable", "on_link_click");
fs.writeFileSync(path.join(dir, "methods.json"), JSON.stringify(methods));
const UI_SRC = `
import * as fs from "node:fs";
const METHODS = new Set(JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, "methods.json"))}, "utf8")));
const R = () => (globalThis.__ui ??= { ids: new Map(), md: new Map(), scrolls: [], sizes: [] });
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
    if (k === "text_size") return (v) => { R().sizes.push(v); t._size = v; return p; };
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
// Runs the queued tasks (a watchFolder loop never ends: none is awaited past a short wait) and the timers
// due within upTo ms, until nothing new is queued. A task that throws fails the test.
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
const cfgFile = () => JSON.parse(H().files[CFG_PATH]);
const reset = (o = {}) => {
  globalThis.__herdr = { props: {}, shared: {}, runs: [], overlays: [], closed: [], writes: [], agents: [], terminals: [], panes: [], spaces: [], focus: null, files: {}, n: 0, ...o };
  globalThis.__ui = { ids: new Map(), md: new Map(), scrolls: [], sizes: [] };
  globalThis.localStorage = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })();
};
const draw = (v, cx) => { globalThis.__ui = { ids: new Map(), md: new Map(), scrolls: [], sizes: [] }; const tree = v.render(cx); return { tree, all: texts(tree).join("\n"), sizes: [...UI().sizes] }; };

try {
  reset();
  const C = await import(`${dir}/config.js`);
  const R = await import(`${dir}/reader.js`);
  const S = await import(`${dir}/settings.js`);
  const D = await import(`${dir}/detailing.js`);
  const W = await import(`${dir}/words.js`);
  const FX = await import(`${dir}/fixtures.js`);

  // ── the scale ──────────────────────────────────────────────────────────
  const of = (v) => C.textScaleOf({ ui: { textScale: v } });
  A.deepEqual(C.TEXT_SCALE, { min: 0.8, max: 1.6, step: 0.05, def: 1 });
  A.equal(C.DEFAULTS.ui.textScale, 1, "ui.textScale defaults to 1");
  A.equal(C.textScaleOf(C.DEFAULTS), 1); A.equal(C.textScaleOf(null), 1); A.equal(C.textScaleOf({}), 1);
  for (const bad of [undefined, null, "", "  ", "big", NaN, Infinity, {}, [], true]) A.equal(of(bad), 1, `${JSON.stringify(bad)} is 1`);
  A.equal(of(0.5), 0.8, "clamped up to 0.8"); A.equal(of(0), 0.8); A.equal(of(-3), 0.8);
  A.equal(of(2), 1.6, "clamped down to 1.6"); A.equal(of(99), 1.6);
  A.equal(of(1.234), 1.25, "rounded to the 0.05 step"); A.equal(of(1.17), 1.15); A.equal(of(1.03), 1.05); A.equal(of(1.02), 1);
  A.equal(of("1.3"), 1.3, "a numeric string"); A.equal(of(1.15), 1.15, "no float tail");
  let s = 0.8; const seen = [s];
  for (let i = 0; i < 20; i++) { s = C.stepScale(s, 1); seen.push(s); }
  A.equal(seen.indexOf(1.6), 16, "16 steps from 80 % to 160 %"); A.equal(seen.at(-1), 1.6, "and no further");
  A.ok(seen.every((v) => Number(v.toFixed(2)) === v), "every step a clean two-decimal value");
  A.equal(C.stepScale(0.8, -1), 0.8, "not below 80 %"); A.equal(C.stepScale(1, -1), 0.95); A.equal(C.stepScale(1.6, 1), 1.6);
  A.equal(C.scaleText(12.5, 1), 12.5); A.equal(C.scaleText(12.5, 1.15), 14.5, "rounded to a half pixel"); A.equal(C.scaleText(11, 1.6), 17.5);
  A.equal(C.scaleText(10.5, 0.8), 8.5); A.equal(C.scaleText(13, 1.25), 16.5);
  for (const v of seen) for (const n of [9, 10, 10.5, 11, 11.5, 12, 12.5, 12.8, 13, 14]) A.ok(Number.isInteger(C.scaleText(n, v) * 2), `${n} at ${v}: a half pixel`);
  { const base = { accent: "#123456" }, t = C.withScale(base, 1.2);
    A.equal(t.ts(10), 12); A.equal(t.scale, 1.2); A.equal(t.accent, "#123456", "the theme's colours read through");
    A.ok(!("ts" in base), "Herdr's theme object is not changed");
    const px = C.withScale(new Proxy({}, { get: () => "#778899" }), 1.6);
    A.equal(px.ts(10), 16); A.equal(px.border, "#778899", "a proxy theme reads through too"); }
  A.match(fs.readFileSync(path.join(MOD, "bin/lib/ledgr_config.py"), "utf8"), /"textScale": 1\}/, "ledgr_config.py mirrors ui.textScale: 1");
  A.deepEqual(C.DEFAULTS.links, { editor: "open" }, "links.editor defaults to open");
  A.match(fs.readFileSync(path.join(MOD, "bin/lib/ledgr_config.py"), "utf8"), /"links": \{"editor": "open"\}/, "ledgr_config.py mirrors links.editor: open");

  // ── the rows ───────────────────────────────────────────────────────────
  A.deepEqual(S.SETTING_KEYS, ["textScale", "threshold", "handoff", "pasteIntoPrompt", "animations", "foldAsksWhileWorking", "openPanelOnAsks", "maxDepth", "editor", "spaces"], "the rows in the dialog's order");
  for (const k of S.SETTING_KEYS) { A.ok(Array.isArray(W.SETTING_WORDS[k]) && W.SETTING_WORDS[k][0] && W.SETTING_WORDS[k][1].length > 20, `${k}: a label and a line in words.js`); A.ok(S.SETTING_PATHS[k], `${k}: its config.json path`); }
  const rows0 = S.settingRows(C.DEFAULTS, []);
  A.deepEqual(rows0.map((r) => r.key), S.SETTING_KEYS);
  A.deepEqual(Object.fromEntries(rows0.map((r) => [r.key, r.value])), { textScale: 1, threshold: "needed", handoff: "ledgr", pasteIntoPrompt: true, animations: true,
    foldAsksWhileWorking: false, openPanelOnAsks: false, maxDepth: 2, editor: "open", spaces: [] }, "the defaults' values");
  A.equal(rows0[0].label, "Text scale"); A.equal(rows0[2].label, "Who owns the closing list"); A.equal(rows0[8].label, "Open files with"); A.equal(rows0[8].path, "links.editor");
  A.equal(rows0[9].path, "spaces.disabled");
  const cfgX = { ...C.DEFAULTS, instruct_block: false, extract: { threshold: "BLOCKING" }, ui: { textScale: 7, pasteIntoPrompt: false, animations: false, foldAsksWhileWorking: true },
    surface: { openPanelOnAsks: true }, branch: { maxDepth: 6 }, links: { editor: "  ZED " } };
  A.deepEqual(Object.fromEntries(S.settingRows(cfgX, []).filter((r) => r.key !== "spaces").map((r) => [r.key, r.value])), { textScale: 1.6, threshold: "blocking", handoff: "prose",
    pasteIntoPrompt: false, animations: false, foldAsksWhileWorking: true, openPanelOnAsks: true, maxDepth: 6, editor: "zed" }, "values read as the mod and the hooks read them (instruct_block false is prose)");
  A.equal(S.settingRows({ links: { editor: "subl {path}:{line}" } }, []).find((r) => r.key === "editor").value, "subl {path}:{line}", "a command of your own, as written");
  A.equal(S.settingRows({ links: { editor: 7 } }, []).find((r) => r.key === "editor").value, "open", "anything else is the default");
  A.equal(W.THRESHOLD_WORDS.needed, "blocking + needed", "the threshold's words");
  A.match(fs.readFileSync(path.join(MOD, "panel.js"), "utf8"), /const TH_WORDS = THRESHOLD_WORDS;/, "the lane head's menu uses the same words");

  // The off spaces: Herdr's in its order, by name; then an off id Herdr no longer has.
  const SA = "sp" + "a".repeat(32), SB = "sp" + "b".repeat(32), SZ = "sp" + "f".repeat(32);
  const live = [{ id: SA, index: 1, name: "billing" }, { id: SB, index: 0, name: "shop-api" }, { id: "", name: "x" }, null];
  A.deepEqual(S.spaceRows({ spaces: { disabled: [SA, SZ, SA, 7] } }, live), [
    { id: SB, name: "shop-api", off: false, stale: false }, { id: SA, name: "billing", off: true, stale: false }, { id: SZ, name: SZ, off: true, stale: true }],
  "each space Herdr has by name, then the stale id");
  A.deepEqual(S.spaceRows({}, []), [], "no spaces, none off"); A.deepEqual(S.spaceRows({ spaces: { disabled: [SZ] } }, null), [{ id: SZ, name: SZ, off: true, stale: true }]);

  // Each row's change to config.json.
  const ed = (k, v, d = {}) => { const e = S.editFor(k, v); if (!e) return null; e(d); return d; };
  A.deepEqual(ed("textScale", 1.2), { ui: { textScale: 1.2 } }); A.deepEqual(ed("textScale", 9), { ui: { textScale: 1.6 } }, "written clamped"); A.equal(S.editFor("textScale", "x"), null);
  A.deepEqual(ed("textScale", 1.1, { ui: { panel: { column: "c" }, animations: false }, btw: { autoSend: false } }), { ui: { panel: { column: "c" }, animations: false, textScale: 1.1 }, btw: { autoSend: false } }, "other keys kept");
  A.deepEqual(ed("threshold", "blocking", { extract: { model: "m" } }), { extract: { model: "m", threshold: "blocking" } }); A.equal(S.editFor("threshold", "loud"), null);
  A.deepEqual(ed("handoff", "prose"), { asks: { handoff: "prose" }, instruct_block: false }, "prose turns the instruction off, as the installer writes it");
  A.deepEqual(ed("handoff", "both", { instruct_block: false }), { asks: { handoff: "both" }, instruct_block: true }, "ledgr and both turn it on");
  A.equal(S.editFor("handoff", "loud"), null);
  A.deepEqual(ed("pasteIntoPrompt", false), { ui: { pasteIntoPrompt: false } }); A.deepEqual(ed("animations", true), { ui: { animations: true } });
  A.deepEqual(ed("foldAsksWhileWorking", true), { ui: { foldAsksWhileWorking: true } }); A.deepEqual(ed("openPanelOnAsks", true), { surface: { openPanelOnAsks: true } });
  A.equal(S.editFor("animations", "yes"), null, "a switch takes a boolean only");
  A.deepEqual(ed("maxDepth", 3), { branch: { maxDepth: 3 } }); A.deepEqual(ed("maxDepth", 9), { branch: { maxDepth: 4 } }, "0 to 4 here"); A.deepEqual(ed("maxDepth", -2), { branch: { maxDepth: 0 } });
  A.deepEqual(ed("spaces", { id: SA, off: true }, { spaces: { disabled: [SB] } }), { spaces: { disabled: [SB, SA] } });
  A.deepEqual(ed("spaces", { id: SB, off: false }, { spaces: { disabled: [SB, SA] } }), { spaces: { disabled: [SA] } });
  A.deepEqual(ed("spaces", { id: SZ, drop: true }, { spaces: { disabled: [SZ, SA] } }), { spaces: { disabled: [SA] } }, "Drop takes a stale id out");
  A.equal(S.editFor("spaces", {}), null); A.equal(S.editFor("nope", 1), null);
  // Open files with (links.editor): a preset, a command of your own, the default for an empty one; a shell, a
  // terminal, the file as the program, a line break or 301 characters refused.
  A.deepEqual(ed("editor", "zed", { links: { editor: "open" }, ui: { textScale: 1 } }), { links: { editor: "zed" }, ui: { textScale: 1 } });
  A.deepEqual(ed("editor", "CODE"), { links: { editor: "code" } }, "a preset in any case");
  A.deepEqual(ed("editor", "  subl {path}:{line}:{col} "), { links: { editor: "subl {path}:{line}:{col}" } }, "your own, trimmed");
  A.deepEqual(ed("editor", ""), { links: { editor: "open" } }, "empty: back to open");
  A.deepEqual(ed("editor", ["idea", "--line", "{line}", "{path}"]), { links: { editor: ["idea", "--line", "{line}", "{path}"] } }, "an argv array");
  for (const bad of ["bash -c {path}", "/bin/zsh {path}", "open -a Terminal {path}", "{path}", "osa" + "script {path}", "subl\n{path}", "x".repeat(301), 7, null])
    A.equal(S.editFor("editor", bad), null, `refused: ${String(bad).slice(0, 30)}`);
  A.match(S.savedLine("editor", "zed"), /^Open files with: zed \(links\.editor in ledgr-data\/config\.json\)\.$/);
  A.match(S.savedLine("editor", "subl {path}"), /^Open files with: subl \{path\} /);
  A.deepEqual(S.applyEdit({ ui: { textScale: 1 } }, S.editFor("textScale", 1.4)), { ui: { textScale: 1.4 } }, "applyEdit: on a copy");
  A.match(S.savedLine("textScale", 1.2), /^Text scale: 120 % \(ui\.textScale in ledgr-data\/config\.json\)\.$/);
  A.match(S.savedLine("handoff", "prose"), /next prompt/, "the closing list says when running sessions follow");
  A.match(S.savedLine("spaces", { id: SA, off: true }, "billing"), /ledgr is off in billing/); A.match(S.savedLine("spaces", { id: SZ, drop: true }), /^Dropped /);

  // ── settingsProps, settingsSpec ────────────────────────────────────────
  A.deepEqual(D.SETTINGS, { width: 0.5, height: 0.7 });
  A.deepEqual(D.settingsSpec({ opener: "p1", demo: true }), { mod: "ledgr", kind: "dialog", width: 0.5, height: 0.7, props: { view: "settings", opener: "p1", demo: true } });
  A.deepEqual(D.settingsSpec().props, { view: "settings", opener: null, demo: false });
  A.deepEqual(D.settingsProps({ view: "settings", opener: "p1", overlay: "ov-1" }), { ok: true, opener: "p1", demo: false, overlay: "ov-1" });
  A.equal(D.settingsProps({ view: "detail" }).ok, false); A.equal(D.settingsProps(null).ok, false);
  A.equal(D.settingsProps({ view: "settings", demo: "true" }).demo, false, "demo only when true");
  const main = fs.readFileSync(path.join(MOD, "main.js"), "utf8");
  const ctl = main.split("\n").find((l) => l.includes("this.ctl =")) ?? "";
  A.ok(ctl.includes('p.view === "settings"') && ctl.indexOf('p.view === "settings"') < ctl.indexOf("isCapture(p)"), "main.js: the settings view is tested before isCapture");
  A.ok(/import \{ Settings \} from "\.\/settings\.js";/.test(main), "main.js imports Settings");
  A.ok(/\bsettings \(the panel's gear/.test(main) && /settings:scale:/.test(main), "main.js lists ledgr.settings and the dialog's commands");

  // ── the one writer: editConfig ─────────────────────────────────────────
  reset();
  { const got = await R.editConfig((d) => { d.ui.textScale = 1.3; });
    A.equal(got.ui.textScale, 1.3, "a missing file: the defaults with the change, merged back");
    const f = cfgFile(); A.equal(f.ui.textScale, 1.3); A.equal(f.extract.threshold, "needed", "the defaults written whole"); A.ok(H().files[CFG_PATH].endsWith("}\n"), "ends with a newline"); }
  reset({ files: { [CFG_PATH]: JSON.stringify({ v: 1, btw: { autoSend: false }, ui: { animations: false } }) } });
  { const got = await R.editConfig((d) => { d.extract = { threshold: "blocking" }; });
    A.deepEqual(cfgFile(), { v: 1, btw: { autoSend: false }, ui: { animations: false }, extract: { threshold: "blocking" } }, "keys it does not know are kept; nothing else added");
    A.equal(H().files[CFG_PATH].split("\n")[1], '  "v": 1,', "two-space indent"); A.equal(got.ui.animations, false); A.equal(got.ui.pasteIntoPrompt, true, "merged over the defaults"); }
  reset({ files: { [CFG_PATH]: '{"v":1}' } });
  H().beforeWrite = (p) => { if (p === CFG_PATH) { H().files[p] = '{"v":1,"other":"writer"}'; H().beforeWrite = null; } };
  { let err = null; try { await R.editConfig((d) => { d.ui = { textScale: 1.2 }; }); } catch (e) { err = e; }
    A.ok(err?.stale === true, "a file changed between the read and the write: refused as stale"); A.equal(err.message, R.CONFIG_STALE);
    A.equal(H().files[CFG_PATH], '{"v":1,"other":"writer"}', "nothing written over the other writer's file"); }
  reset({ files: { [CFG_PATH]: "{ not json" } });
  { let err = null; try { await R.editConfig(() => {}); } catch (e) { err = e; } A.match(String(err?.message), /not valid JSON/); A.equal(H().writes.length, 0, "nothing written"); }
  reset({ files: { [CFG_PATH]: "[1, 2]" } });
  { let err = null; try { await R.editConfig(() => {}); } catch (e) { err = e; } A.match(String(err?.message), /not a JSON object/); }
  reset({ files: { [CFG_PATH]: "{}" }, failWrites: true });
  { let err = null; try { await R.editConfig((d) => { d.v = 2; }); } catch (e) { err = e; } A.equal(err?.message, "disk full", "another failure is said as it is"); A.equal(err.stale, undefined); }

  // ── the dialog ─────────────────────────────────────────────────────────
  const AGENTS = { [`${APP}/AGENTS.md`]: "x" };
  const open = async (o = {}) => {
    H().props = { view: "settings", overlay: o.overlay ?? "ov-1", opener: "panel-1", demo: o.demo ?? false };
    const cx = mkcx(), v = new S.Settings({}, cx);
    await drain(cx);
    return { v, cx };
  };
  reset({ files: { ...AGENTS, [CFG_PATH]: JSON.stringify({ v: 1, ui: { textScale: 1.1 }, extract: { threshold: "blocking" }, spaces: { disabled: [SA, SZ] } }) },
    spaces: [{ id: SB, index: 0, name: "shop-api" }, { id: SA, index: 1, name: "billing" }], focus: { space: SB } });
  { const { v, cx } = await open();
    A.equal(v.inApp, true); A.equal(v.cfg.ui.textScale, 1.1, "config.json read");
    A.deepEqual(H().shared["ledgr.detail"]?.open, { overlay: "ov-1", opener: "panel-1", session: null, kind: "settings", id: null, at: H().shared["ledgr.detail"].open.at }, "its open record (one dialog at a time)");
    let r = draw(v, cx);
    for (const k of S.SETTING_KEYS) A.ok(UI().ids.has(`st-row-${k}`), `row ${k} drawn`);
    for (const [, [label, words]] of Object.entries(W.SETTING_WORDS)) { A.ok(r.all.includes(label), `“${label}” shown`); A.ok(r.all.includes(words), `${label}: its line shown`); }
    A.ok(r.all.includes("110 %"), "the scale's value"); A.ok(r.all.includes("shop-api") && r.all.includes("billing"), "spaces by name");
    A.ok(r.all.includes(W.staleSpaceWords(SZ)), "the stale id, by id"); A.ok(UI().ids.has(`st-drop-${SZ}`), "with Drop"); A.ok(!UI().ids.has(`st-drop-${SA}`), "a live space has no Drop");
    A.ok(r.all.includes("this space"), "the focused pane's space named");
    A.ok(r.all.includes(W.settingsFootWords(`${APP}/ledgr-data/config.json`)), "the footer: the path, edit anything else there");
    A.equal(UI().ids.get("st-threshold-blocking")._size, C.scaleText(11, 1.1), "the dialog draws at the file's scale (a choice's 11 at 110 %: 12)");

    // Text scale: + twice quickly (queued, both written, no stale), then −, then the reset.
    click("st-scale-up", cx); r = draw(v, cx); click("st-scale-up", cx);
    A.equal(v.cfg.ui.textScale, 1.2, "shown at once, the second click from the first");
    await drain(cx);
    A.equal(cfgFile().ui.textScale, 1.2, "written: 120 %"); A.equal(cfgFile().extract.threshold, "blocking", "the rest of the file kept");
    A.equal(v.flash, S.savedLine("textScale", 1.2)); A.ok(!v.flash.includes("not saved"), "no collision between the two clicks");
    draw(v, cx); click("st-scale-down", cx); await drain(cx); A.equal(cfgFile().ui.textScale, 1.15);
    draw(v, cx); click("st-scale-reset", cx); await drain(cx); A.equal(cfgFile().ui.textScale, 1);
    r = draw(v, cx); A.ok(r.all.includes("100 %"));
    // The others, each through its own control.
    click("st-threshold-optional", cx); await drain(cx); A.equal(cfgFile().extract.threshold, "optional");
    draw(v, cx); click("st-handoff-prose", cx); await drain(cx); A.equal(cfgFile().asks.handoff, "prose"); A.equal(cfgFile().instruct_block, false); A.match(v.flash, /next prompt/);
    draw(v, cx); click("st-handoff-ledgr", cx); await drain(cx); A.equal(cfgFile().instruct_block, true);
    for (const k of ["pasteIntoPrompt", "animations", "foldAsksWhileWorking", "openPanelOnAsks"]) {
      const was = S.settingRows(v.cfg, []).find((x) => x.key === k).value;
      draw(v, cx); click(`st-${k}-${was ? "off" : "on"}`, cx); await drain(cx);
      A.equal(S.settingRows(v.cfg, []).find((x) => x.key === k).value, !was, `${k} switched`);
      A.equal(k === "openPanelOnAsks" ? cfgFile().surface.openPanelOnAsks : cfgFile().ui[k], !was, `${k} written`);
    }
    // Open files with: a preset by its segment; your own by the field's Enter; a refused one is not written.
    draw(v, cx); click("st-editor-zed", cx); await drain(cx); A.equal(cfgFile().links.editor, "zed"); A.match(v.flash, /^Open files with: zed/);
    r = draw(v, cx); A.ok(UI().ids.has("st-editor-box"), "the field for your own command"); A.ok(r.all.includes(W.EDITOR_CUSTOM_HINT), "and its hint");
    v.editorInput.set_value("subl {path}:{line}"); v.editorInput._on.submit({}, cx); await drain(cx);
    A.equal(cfgFile().links.editor, "subl {path}:{line}", "Enter in the field writes it"); r = draw(v, cx); A.ok(r.all.includes("Now your own: subl {path}:{line}"), "shown as your own");
    v.editorInput.set_value("bash -c {path}"); v.editorInput._on.submit({}, cx); await drain(cx);
    A.equal(cfgFile().links.editor, "subl {path}:{line}", "a shell is not written");
    A.equal(v.flash, W.editorRefusedWords("bash -c {path}", "bash is a shell, an interpreter or a program that runs another, and ledgr runs none"), "the status line says what is refused");
    for (const [bad, why] of [["arch sh -c x", /”: arch is a shell/], ["python3.12 {path}", /”: python3\.12 is a shell/], ["open -a 'Python Launcher' {path}", /names Python Launcher, a launcher/],
      ["open -b dev.warp.Warp-Stable {path}", /names a terminal/]]) {
      v.editorInput.set_value(bad); v.editorInput._on.submit({}, cx); await drain(cx);
      A.equal(cfgFile().links.editor, "subl {path}:{line}", `not written: ${bad}`); A.match(v.flash, why, `the dialog says why: ${bad}`);
    }
    // The field follows links.editor: a preset clicked empties it; a hand edit of config.json shows there;
    // an argv array is shown quoted and saved back as the same argv (/Apps/My Ed stays one argument).
    v.editorInput.set_value("half typed");
    draw(v, cx); click("st-threshold-needed", cx); await drain(cx);
    A.equal(v.editorInput.value(), "half typed", "another row's click leaves what is typed in the field");
    draw(v, cx); click("st-threshold-optional", cx); await drain(cx); A.equal(cfgFile().extract.threshold, "optional");
    draw(v, cx); click("st-editor-zed", cx);
    A.equal(v.editorInput.value(), "", "a preset clicked: the field is emptied at once"); await drain(cx);
    H().files[CFG_PATH] = JSON.stringify({ ...cfgFile(), links: { editor: ["/Apps/My Ed", "-g", "{path}:{line}"] } });
    A.equal(await v.configChanged(cx), true, "config.json edited by hand: read again");
    A.equal(v.editorInput.value(), "'/Apps/My Ed' -g {path}:{line}", "the field shows the argv array quoted");
    r = draw(v, cx); A.ok(r.all.includes("Now your own: '/Apps/My Ed' -g {path}:{line}"), "and the hint the same");
    v.editorInput._on.submit({}, cx); await drain(cx);
    { const L = await import(`${dir}/links.js`);
      A.deepEqual(L.openerArgv(cfgFile().links.editor, { path: "/r/a.js", line: 3 }).argv, ["/Apps/My Ed", "-g", "/r/a.js:3"], "saved back: still one argument with its space"); }
    draw(v, cx); click("st-editor-open", cx); await drain(cx); A.equal(cfgFile().links.editor, "open", "back to open");
    draw(v, cx); click("st-depth-up", cx); await drain(cx); A.equal(cfgFile().branch.maxDepth, 3);
    draw(v, cx); click("st-depth-down", cx); draw(v, cx); click("st-depth-down", cx); draw(v, cx); click("st-depth-down", cx); await drain(cx); A.equal(cfgFile().branch.maxDepth, 0, "down to 0: Branch off");
    r = draw(v, cx); A.ok(r.all.includes("0 (off)"));
    click(`st-space-off-${SB}`, cx); await drain(cx); A.deepEqual(cfgFile().spaces.disabled, [SA, SZ, SB], "shop-api off"); A.match(v.flash, /ledgr is off in shop-api/);
    draw(v, cx); click(`st-space-on-${SA}`, cx); await drain(cx); A.deepEqual(cfgFile().spaces.disabled, [SZ, SB], "billing on again");
    draw(v, cx); click(`st-drop-${SZ}`, cx); await drain(cx); A.deepEqual(cfgFile().spaces.disabled, [SB], "the stale id dropped");
    // Commands.
    v.command("settings:scale:1.37", cx); await drain(cx); A.equal(cfgFile().ui.textScale, 1.35, "settings:scale:<n>, on the step");
    v.command("settings:scale:up", cx); await drain(cx); A.equal(cfgFile().ui.textScale, 1.4);
    v.command("settings:scale:bogus", cx); A.match(v.flash, /No text scale bogus/);
    v.command("threshold:needed", cx); v.command("demo", cx); A.equal(cfgFile().extract.threshold, "optional", "the panel's commands are not the dialog's");
    // A stale write: another writer changed the file between the read and the write.
    H().beforeWrite = (p) => { if (p === CFG_PATH) { H().files[p] = JSON.stringify({ v: 1, ui: { textScale: 0.9 } }); H().beforeWrite = null; } };
    draw(v, cx); click("st-scale-up", cx); await drain(cx);
    A.ok(v.flash.startsWith("Text scale not saved: ") && v.flash.includes(R.CONFIG_STALE), "a stale write says so");
    A.equal(v.cfg.ui.textScale, 0.9, "and the file is read again (the other writer's value shows)"); A.equal(cfgFile().ui.textScale, 0.9, "nothing written over it");
    // Never staged, copied or run; only config.json written.
    A.equal(cx.clip, null, "nothing on the clipboard"); A.deepEqual(H().runs, [], "no command run");
    A.ok(H().writes.every(([p]) => p === CFG_PATH), "config.json is the only file written"); A.deepEqual(H().overlays, [], "nothing opened");
    // Esc: closed; the closed record (kind settings, the list takes the keyboard, its last words).
    const { tree } = draw(v, cx); tree._h.on_key_down({ keystroke: "escape" }, cx);
    A.deepEqual(H().closed, ["ov-1"], "Esc closes");
    await v.release();
    const rec = H().shared["ledgr.detail"];
    A.equal(rec.open, null, "its open record cleared"); A.equal(rec.closed.kind, "settings"); A.equal(rec.closed.id, null); A.equal(rec.closed.focus, "list");
    A.equal(rec.closed.opener, "panel-1"); A.equal(rec.closed.flash, v.flash); A.deepEqual(rec.closed.drafts, {}); }
  // The watcher while clicks are queued (2026-11-10): + + + ends at 115 %, never 110 %. A config.json change
  // seen while this copy's own writes are queued leaves the value shown ahead alone; a read that started
  // before a click is dropped; with nothing queued, a hand edit is read.
  reset({ files: { ...AGENTS, [CFG_PATH]: JSON.stringify({ v: 1, ui: { textScale: 1 } }) } });
  { const { v, cx } = await open();
    draw(v, cx); click("st-scale-up", cx);
    A.equal(v.cfgBusy, true, "the first click is queued");
    A.equal(await v.configChanged(cx), false, "the watcher's reload while the queue is busy: skipped");
    A.equal(v.cfg.ui.textScale, 1.05, "the value shown ahead stays");
    draw(v, cx); click("st-scale-up", cx); draw(v, cx); click("st-scale-up", cx);
    A.equal(v.cfg.ui.textScale, 1.15, "the third click starts from the second");
    await drain(cx); A.equal(cfgFile().ui.textScale, 1.15, "+ + + written: 115 %");
    const late = v.configChanged(cx);
    draw(v, cx); click("st-scale-up", cx);
    A.equal(await late, false, "a read that started before a click is dropped"); A.equal(v.cfg.ui.textScale, 1.2);
    await drain(cx); A.equal(cfgFile().ui.textScale, 1.2);
    H().files[CFG_PATH] = JSON.stringify({ v: 1, ui: { textScale: 0.9 } });
    A.equal(await v.configChanged(cx), true, "nothing queued: a hand edit is read"); A.equal(v.cfg.ui.textScale, 0.9); }
  // release waits for a write still queued.
  reset({ files: { ...AGENTS, [CFG_PATH]: "{}" } });
  { const { v, cx } = await open();
    draw(v, cx); click("st-scale-up", cx);
    const task = cx.tasks.shift(); const running = task(cx);
    await v.release(); await running;
    A.equal(cfgFile().ui.textScale, 1.05, "a click just before closing is written before the closed record"); A.equal(H().shared["ledgr.detail"].closed.flash, S.savedLine("textScale", 1.05)); }
  // The demo: the defaults and the demo spaces; a click changes memory only.
  reset({ files: { ...AGENTS } });
  { const { v, cx } = await open({ demo: true });
    let r = draw(v, cx);
    A.ok(r.all.includes("demo") && r.all.includes(W.SETTINGS_DEMO), "the demo says nothing is saved");
    for (const sp of FX.DEMO_SPACES) A.ok(r.all.includes(sp.name), `demo space ${sp.name}`);
    A.ok(UI().ids.has(`st-drop-${FX.DEMO_OFF[1]}`), "the demo's stale id, with Drop");
    click("st-scale-up", cx); await drain(cx);
    A.equal(v.cfg.ui.textScale, 1.05); A.match(v.flash, /^\(demo\) Text scale: 105 %/); A.equal(H().writes.length, 0, "the demo writes nothing");
    r = draw(v, cx); A.equal(UI().ids.get("st-scale-value")._size, C.scaleText(12, 1.05), "the dialog itself redrawn at the new scale"); }
  // Bad props.
  reset();
  { H().props = { view: "settings", overlay: 7 }; const cx = mkcx(), v = new S.Settings({}, cx); A.equal(v.p.ok, true, "an overlay id that is not a string is dropped, the dialog still opens"); }

  // ── the panel: the gear, ledgr.settings, one dialog at a time ──────────
  reset({ files: {} });
  { const P = await import(`${dir}/panel.js`);
    H().props = { view: "panel" };
    const cx = mkcx(), panel = new P.Panel({}, cx);
    await drain(cx);
    panel.command("settings", cx);
    A.equal(H().overlays.length, 1); const [ov1, spec1] = H().overlays[0];
    A.deepEqual(spec1, D.settingsSpec({ opener: panel.panelId, demo: false }), "ledgr.settings: the settings dialog, opened by this panel");
    A.equal(panel.detailId, ov1);
    // The dialog's open record is up; a row's dialog opened now closes it first.
    H().shared["ledgr.detail"] = { open: { overlay: ov1, opener: panel.panelId, session: null, kind: "settings", id: null, at: 1 }, closed: null };
    panel.openDetail("ask", "rq_x", "s1", {}, cx);
    A.ok(H().closed.includes(ov1), "opening a detail dialog closes the settings dialog");
    const ov2 = panel.detailId; A.equal(H().overlays.at(-1)[1].props.view, "detail");
    H().shared["ledgr.detail"] = { open: { overlay: ov2, opener: panel.panelId, session: "s1", kind: "ask", id: "rq_x", at: 2 }, closed: null };
    panel.openSettings(false, cx);
    A.ok(H().closed.includes(ov2), "and the settings dialog closes an open detail dialog"); A.equal(H().overlays.at(-1)[1].props.view, "settings");
    // Its closed record: the status line shows its last words; no row is the cursor's.
    const ov3 = panel.detailId;
    H().shared["ledgr.detail"] = { open: null, closed: { overlay: ov3, opener: panel.panelId, session: null, kind: "settings", id: null, at: Date.now() + 5, flash: "Text scale: 120 % (ui.textScale in ledgr-data/config.json).", focus: "list", terminal: null, drafts: {} } };
    panel.noteDetail(cx);
    A.equal(panel.flash, "Text scale: 120 % (ui.textScale in ledgr-data/config.json).", "the settings' last words in the panel's status line");
    A.equal(panel.pendingCursor, null, "no row to put the cursor on"); A.equal(panel.detailId, null, "the dialog it opened is closed");
    panel.command("demo-settings", cx); A.equal(H().overlays.at(-1)[1].props.demo, true, "demo-settings: the dialog's demo");
    const nOv = H().overlays.length; panel.command("settings:scale:up", cx); A.equal(H().overlays.length, nOv, "settings:* is the dialog's, not the panel's");
    // The header's gear.
    const { all } = draw(panel, cx);
    A.ok(UI().ids.has("lg-settings"), "the header's gear"); const before = H().overlays.length; click("lg-settings", cx);
    A.equal(H().overlays.length, before + 1); A.equal(H().overlays.at(-1)[1].props.view, "settings", "the gear opens the settings dialog");
    A.ok(typeof all === "string");
    // The lane head's threshold and the space switch write through the same saveConfig.
    H().files[CFG_PATH] = JSON.stringify({ v: 1, extract: { threshold: "needed" } });
    panel.setThreshold("blocking", cx); await drain(cx);
    A.equal(cfgFile().extract.threshold, "blocking", "the threshold menu writes through Reader saveConfig");
    panel.setSpaceOff(SA, true, cx); await drain(cx);
    A.deepEqual(cfgFile().spaces.disabled, [SA], "the space switch too");
    H().beforeWrite = (p) => { if (p === CFG_PATH) { H().files[p] = '{"v":1}'; H().beforeWrite = null; } };
    panel.setThreshold("optional", cx); await drain(cx);
    A.ok(panel.flash.includes(R.CONFIG_STALE), "a stale write from the panel says so too"); A.equal(cfgFile().extract?.threshold, undefined, "nothing written over it"); }

  // ── ledgr.settings with the panel hidden (2026-11-10) ───────────────────
  // A ledgr command reaches shown copies only: the host block (the public install) opens the dialog when it
  // holds the writer and the panel is hidden; an overlay host with an engine copy (my-tabs) does it on its
  // own command. Both through config.js settingsOpening, the same spec as the panel's gear.
  { const Hst = await import(`${dir}/host.js`);
    A.deepEqual(C.settingsOpening(null), { close: null, spec: D.settingsSpec({ opener: null }) }, "settingsOpening: the gear's spec, no opener");
    A.deepEqual(C.settingsOpening(undefined, { demo: true }).spec, D.settingsSpec({ opener: null, demo: true }), "and the demo's");
    A.equal(C.settingsOpening({ open: { overlay: "ov-9", kind: "ask" }, closed: null }).close, "ov-9", "an open detail dialog is closed first");
    A.equal(C.settingsOpening({ open: { overlay: 7 } }).close, null); A.equal(C.settingsOpening("x").close, null);
    const host = (o = {}) => { reset({ shared: o.shared ?? {}, layout: o.layout ?? null }); H().props = { view: "host", demo: true };
      const h = new Hst.Host({}, mkcx()); h.writer = { holds: () => o.holds !== false, release() {} }; return h; };
    let h = host({ shared: { "ledgr.detail": { open: { overlay: "ov-det", kind: "ask" }, closed: null } } });
    h.command("settings");
    A.deepEqual(H().closed, ["ov-det"], "host: the open detail dialog closed first"); A.deepEqual(H().overlays.map(([, sp]) => sp), [D.settingsSpec({ opener: null })], "host: the settings dialog opened, panel hidden");
    h = host(); h.command("demo-settings"); A.equal(H().overlays[0]?.[1].props.demo, true, "host: demo-settings, the demo");
    h = host({ holds: false }); h.command("settings"); A.deepEqual(H().overlays, [], "host: a copy that does not hold the writer opens nothing");
    const shown = { id: "root", children: [{ id: "panel", hidden: false, children: [{ id: "panel-body", active: "ledgr", children: [] }] }] };
    h = host({ layout: shown }); h.command("settings"); A.deepEqual(H().overlays, [], "host: the panel shown opens it, not the host");
    const TABS = path.resolve(MOD, "../../examples/personal-overlay/mods/my-tabs/main.js");
    if (fs.existsSync(TABS)) {
      const tabs = fs.readFileSync(TABS, "utf8");
      A.match(tabs, /^import \{ settingsOpening \} from "\.\/ledgr\/config\.js";$/m, "my-tabs takes settingsOpening from its engine copy");
      const branch = (tabs.match(/if \(c === "ledgr-settings" \|\| c === "ledgr-demo-settings"\) \{[\s\S]*?continue;\n\s*\}/) ?? [""])[0];
      A.ok(branch.includes("this.ledgr?.holds?.()") && branch.includes("settingsOpening(shared(\"ledgr.detail\")") && branch.includes("closeOverlay(o.close)")
        && branch.includes("openOverlay(o.spec)"), "my-tabs.ledgr-settings: the writer's tab bar closes an open detail dialog and opens the settings dialog");
    } }

  // ── every text size goes through the scale ─────────────────────────────
  // Drawn at 1 and at 1.6: the same elements, every size scaled (the panel's demo, the detail dialog, the
  // settings dialog).
  const at = async (scale, make) => {
    reset({ files: { ...AGENTS, [CFG_PATH]: JSON.stringify({ v: 1, ui: { textScale: scale } }) } });
    const { v, cx } = await make();
    v.cfg = { ...v.cfg, ui: { ...(v.cfg.ui ?? {}), textScale: scale } };
    return draw(v, cx).sizes;
  };
  const same = async (what, make) => {
    const one = await at(1, make), big = await at(1.6, make);
    A.ok(one.length > 10, `${what}: ${one.length} text sizes drawn`);
    A.deepEqual(big, one.map((n) => C.scaleText(n, 1.6)), `${what}: every size at 160 % is its 100 % size scaled`);
  };
  const P = await import(`${dir}/panel.js`), DT = await import(`${dir}/detail.js`);
  await same("the panel (demo)", async () => { H().props = { view: "panel", demo: true }; const cx = mkcx(), v = new P.Panel({}, cx); await drain(cx); return { v, cx }; });
  await same("the detail dialog (A15)", async () => {
    H().props = { view: "detail", session: FX.DEMO_SESSION, kind: "ask", id: "rq_demo_15", demo: true, overlay: "ov-1" };
    const cx = mkcx(), v = new DT.Detail({}, cx); v.width = 900; await drain(cx); return { v, cx }; });
  await same("the settings dialog", async () => { H().props = { view: "settings", overlay: "ov-1" }; H().spaces = [{ id: SA, index: 0, name: "billing" }]; const cx = mkcx(), v = new S.Settings({}, cx); await drain(cx); return { v, cx }; });

  // The ⌘J box (2026-11-10): its popup has a fixed size, so its scale stops at BOX_SCALE_MAX (125 %); the
  // title and key rows keep their height and the middle scrolls.
  A.equal(C.BOX_SCALE_MAX, 1.25);
  A.equal(C.textScaleOf({ ui: { textScale: 1.6 } }, { max: C.BOX_SCALE_MAX }), 1.25, "capped at 125 %");
  A.equal(C.textScaleOf({ ui: { textScale: 1.1 } }, { max: C.BOX_SCALE_MAX }), 1.1, "below the cap: as set");
  A.equal(C.textScaleOf({ ui: { textScale: 0.5 } }, { max: C.BOX_SCALE_MAX }), 0.8, "the floor stays");
  A.equal(C.textScaleOf({ ui: { textScale: 1.6 } }, { max: "x" }), 1.6, "a max that is not a number: the range's own");
  { const CAP = await import(`${dir}/capture.js`);
    const box = async (scale) => {
      reset({ files: { ...AGENTS }, shared: { "ledgr.ui": { textScale: scale } } });
      H().props = { overlay: "ov-cap" };
      const cx = mkcx(), v = new CAP.Capture({}, cx); await drain(cx);
      return { v, cx, scale: v.scale(), ...draw(v, cx) };
    };
    const small = await box(1), big = await box(1.6);
    A.equal(big.scale, 1.25, "the box at 160 %: drawn at 125 %"); A.equal(small.scale, 1);
    A.equal(big.sizes.length, small.sizes.length, "the same text drawn at both scales");
    A.ok(big.sizes.every((n, i) => Math.abs(n - small.sizes[i] * 1.25) <= 0.5), `every size in the box at 160 % is its 100 % size at 125 % (${small.sizes} / ${big.sizes})`);
    A.ok(big.sizes.every((n, i) => n < C.scaleText(small.sizes[i], 1.6) || small.sizes[i] < 2), "and smaller than at 160 %");
    const kinds = (n, out = []) => { if (n && typeof n === "object") { out.push(n._kind); for (const k of n._kids ?? []) kinds(k, out); } return out; };
    const kids = big.tree._kids.filter((k) => k && typeof k === "object");
    A.deepEqual(kids.map((k) => k._id), ["cap-head", "cap-body", "cap-keys"], "the box: a title row, the middle, the key row last");
    A.ok(kinds(UI().ids.get("cap-body")).includes("input"), "the field is in the middle");
    A.ok(!kinds(UI().ids.get("cap-keys")).includes("input") && texts(UI().ids.get("cap-keys")).some((x) => x === "park"), "the keys are in the last row");
    const src = fs.readFileSync(path.join(MOD, "capture.js"), "utf8");
    A.match(src, /\.id\("cap-body"\)\.flex_1\(\)\.min_h\(0\)\.overflow_y_scrollbar\(\)/, "the middle takes the rest and scrolls");
    A.match(src, /\.id\("cap-keys"\)\.flex_none\(\)/, "the key row keeps its height"); A.match(src, /\.id\("cap-head"\)\.flex_none\(\)/, "and the title row");
    A.match(src, /textScaleOf\(\{ ui: \{ textScale: live \?\? this\.cfg\?\.ui\?\.textScale \} \}, \{ max: BOX_SCALE_MAX \}\)/, "the box's scale goes through the cap"); }

  // Statically: every text_size( in the mod is text_size(t.ts(, in a function or method that has t (a
  // parameter or a const); every theme() a copy draws with is withScale(theme(), …).
  const HEAD = /^(?: {2}(?:async )?(\w+)\(([^)]*)\) \{|export function (\w+)\(([^)]*)\) \{|function (\w+)\(([^)]*)\) \{)/gm;
  let calls = 0;
  for (const f of fs.readdirSync(MOD).filter((x) => x.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(MOD, f), "utf8");
    const all = [...src.matchAll(/text_size\(/g)].length, scaled = [...src.matchAll(/text_size\(t\.ts\(/g)].length;
    calls += all;
    A.equal(scaled, all, `${f}: every text_size( goes through t.ts( (${all - scaled} do not)`);
    if (!scaled) continue;
    const heads = [...src.matchAll(HEAD)];
    heads.forEach((m, i) => {
      const body = src.slice(m.index + m[0].length, i + 1 < heads.length ? heads[i + 1].index : src.length);
      if (!body.includes("t.ts(")) return;
      const params = (m[2] ?? m[4] ?? m[6] ?? "").split(",").map((a) => a.split("=")[0].trim());
      A.ok(params.includes("t") || /\bconst t = /.test(body), `${f}: ${m[1] ?? m[3] ?? m[5]} calls t.ts( with t in scope`);
    });
    for (const m of src.matchAll(/\btheme\(\)/g)) {
      const line = src.slice(src.lastIndexOf("\n", m.index) + 1, src.indexOf("\n", m.index));
      if (/^\s*\/\//.test(line)) continue;
      A.ok(/withScale\(theme\(\), /.test(line), `${f}: theme() drawn through withScale: ${line.trim().slice(0, 80)}`);
    }
  }
  A.ok(calls > 150, `${calls} text sizes in the mod, all scaled`);
  if (fs.existsSync(PANE)) {
    const pane = fs.readFileSync(PANE, "utf8");
    const chip = (pane.match(/^ {2}chip\(t, c, pane\) \{[\s\S]*?^ {2}\}$/m) ?? [""])[0];
    A.ok(chip.includes("const z = chipScale();") && /\.text_size\(sz\(10\.5, z\)\)/.test(chip), "ledgr-pane: the chip's text through its scale (shared(\"ledgr.ui\").textScale)");
    A.ok(!/\.text_size\(\d/.test(chip), "ledgr-pane: no fixed text size in the chip");
    A.equal([...pane.matchAll(/\.text_size\(\d/g)].length, 2, "ledgr-pane: the header's own two sizes stay Herdr's");
    A.match(pane, /shared\("ledgr\.ui"\)\?\.textScale/);
  }
  A.match(fs.readFileSync(path.join(MOD, "writer.js"), "utf8"), /textScale: textScaleOf\(cfg\)/, "the writer publishes ui.textScale in shared(\"ledgr.ui\")");

  console.log(`OK: settings, ${checks} checks (the scale's clamp, step and half pixels; rows, values and edits; editConfig's compare-and-swap with a stale file; the dialog's controls, commands, demo and closed record; the panel's gear and one dialog at a time; every text size scaled at 160 %${DTS ? "; element methods checked against gpui-kit.d.ts" : ""}), 0 failure(s)`);
} catch (e) {
  console.log(String(e?.stack ?? e).split("\n").slice(0, 8).join("\n"));
  console.log(`FAIL: settings, after ${checks} checks`);
  process.exitCode = 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
