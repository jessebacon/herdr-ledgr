// ledgr settings dialog (2026-11-10, Jesse: "build the settings dialog with text scale"): a centered dialog
// of this mod (props {view: "settings", opener, demo}; the panel's gear, `ledgr.settings` and
// `ledgr.demo-settings` open it with detailing.js settingsSpec, 0.5 × 0.7 of the window) with the choices a
// person changes most, in this order, each with its current value, a control and one line in words
// (words.js SETTING_WORDS): Text scale (ui.textScale, 80 % to 160 %), Threshold (extract.threshold), Who owns
// the closing list (asks.handoff, with instruct_block as the installer writes it), Paste into the prompt,
// Animations, Fold asks while the agent works (ui.*), Open the panel on new asks (surface.openPanelOnAsks),
// Branch depth (branch.maxDepth, 0 to 4), Open files with (links.editor, 2026-11-10: open, zed, code, or a
// command of your own typed in its field with shell-style quoting, no shell (links.js splitCommand; an argv
// array is shown quoted, joinCommand), Enter saves; links.js editorValue refuses a shell, an interpreter, a
// program that runs another or a terminal, and the status line says which; the field follows config.json)
// and the Off spaces (spaces.disabled: one switch per space Herdr has, by name, then each off id Herdr no
// longer has, by id, with Drop). The footer names config.json for the rest.
// Its own copy of the mod: a Reader (reader.js) that reads config.json (startReading, and again whenever it
// changes: watchStore) and writes it only through Reader saveConfig (reader.js editConfig, the one
// compare-and-swap writer the panel's threshold menu and space switch use too). Every click writes at once and
// shows at once; a write that finds the file changed under it writes nothing, reads the file again and says
// so. It reads no store.json, posts no spool event, stages nothing, copies nothing to the clipboard and runs
// no command (bin/tests/test_no_keystrokes.py holds it to that).
// One dialog at a time: it writes shared("ledgr.detail") as the detail dialog does (open, then closed, kind
// "settings", no id), so whoever opens one dialog closes the other first (the panel's closeDetail), and its
// closed record gives the list the keyboard back and the panel's status line its last words.
// Esc or a click outside closes it. Commands (this copy takes only these): settings:close,
// settings:scale:<up|down|reset|0.8…1.6>. Demo (props demo): the defaults, fixtures.js DEMO_SPACES and
// DEMO_OFF; a change stays in memory.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, Input, InputState } from "gpui-base";
import { theme, props, shared, setShared, closeOverlay, spaces, focused, home } from "herdr";
import { Reader } from "./reader.js";
import { FORCE_DEMO, DEFAULTS, TEXT_SCALE, textScaleOf, stepScale, withScale, handoffOf, HANDOFF_MODES, disabledSpaces, withSpaceOff, configPath, liveHome } from "./config.js";
import { LEVELS, thresholdOf } from "./store.js";
import { maxDepthOf } from "./branch.js";
import { EDITOR_PRESETS, editorOf, editorValue, editorRefusal, editorWords, isPreset } from "./links.js";
import { settingsProps, mergeClosed, focusAfter } from "./detailing.js";
import { DEMO_SPACES, DEMO_OFF } from "./fixtures.js";
import { THRESHOLD_WORDS, SETTING_WORDS, scaleWords, savedWords, handoffSavedWords, staleSpaceWords, droppedSpaceWords, NO_SPACES,
  settingsFootWords, SETTINGS_DEMO, EDITOR_PLACEHOLDER, EDITOR_CUSTOM_HINT, editorRefusedWords } from "./words.js";
import { ICON, btn, pill, segment, keyHints } from "./views.js";

// The rows, in the dialog's order (words.js SETTING_WORDS has a label and a line for each).
export const SETTING_KEYS = ["textScale", "threshold", "handoff", "pasteIntoPrompt", "animations", "foldAsksWhileWorking", "openPanelOnAsks", "maxDepth", "editor", "spaces"];
// Where each lives in config.json.
export const SETTING_PATHS = { textScale: "ui.textScale", threshold: "extract.threshold", handoff: "asks.handoff", pasteIntoPrompt: "ui.pasteIntoPrompt",
  animations: "ui.animations", foldAsksWhileWorking: "ui.foldAsksWhileWorking", openPanelOnAsks: "surface.openPanelOnAsks", maxDepth: "branch.maxDepth",
  editor: "links.editor", spaces: "spaces.disabled" };
// Branch depth offered here (config.json may hold more by hand; it is shown as it is and stepped back in).
export const DEPTH = { min: 0, max: 4 };
// The three thresholds, strictest first, as the lane head's menu lists them.
const TH_ORDER = ["blocking", "needed", "optional"];
const BOOLS = new Set(["pasteIntoPrompt", "animations", "foldAsksWhileWorking", "openPanelOnAsks"]);

const objIn = (d, k) => (d[k] = d[k] && typeof d[k] === "object" && !Array.isArray(d[k]) ? d[k] : {});
export const clampDepth = (n) => Math.min(DEPTH.max, Math.max(DEPTH.min, Math.floor(Number(n) || 0)));

// The off-spaces list: every space Herdr has, in its order, by name, with ledgr's state there; then each id
// spaces.disabled names that Herdr no longer has ({stale: true}, shown by id, offered Drop).
export function spaceRows(cfg, live) {
  const off = disabledSpaces(cfg);
  const rows = (Array.isArray(live) ? live : []).filter((sp) => sp && typeof sp.id === "string" && sp.id)
    .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0))
    .map((sp) => ({ id: sp.id, name: String(sp.name || sp.id), off: off.includes(sp.id), stale: false }));
  const known = new Set(rows.map((r) => r.id));
  for (const id of off) if (!known.has(id)) rows.push({ id, name: id, off: true, stale: true });
  return rows;
}

// The rows as shown, from the merged config and Herdr's spaces: {key, path, label, words, value}.
export function settingRows(cfg, live) {
  const value = {
    textScale: textScaleOf(cfg),
    threshold: thresholdOf(cfg),
    handoff: handoffOf(cfg),
    pasteIntoPrompt: cfg?.ui?.pasteIntoPrompt !== false,
    animations: cfg?.ui?.animations !== false,
    foldAsksWhileWorking: cfg?.ui?.foldAsksWhileWorking === true,
    openPanelOnAsks: cfg?.surface?.openPanelOnAsks === true,
    maxDepth: maxDepthOf(cfg),
    editor: editorOf(cfg),
    spaces: spaceRows(cfg, live),
  };
  return SETTING_KEYS.map((key) => ({ key, path: SETTING_PATHS[key], label: SETTING_WORDS[key][0], words: SETTING_WORDS[key][1], value: value[key] }));
}

// The change to config.json that gives one row a value (an `edit(d)` for editConfig), or null for a value
// that row does not take. Spaces: {id, off} switches ledgr off (or on) there, {id, drop: true} drops a
// stale id. The closing list writes instruct_block with it, as the installer does (prose: false).
export function editFor(key, value) {
  if (key === "textScale") {
    const v = Number(value);
    return Number.isFinite(v) ? (d) => { objIn(d, "ui").textScale = textScaleOf({ ui: { textScale: v } }); } : null;
  }
  if (key === "threshold") return LEVELS.includes(value) ? (d) => { objIn(d, "extract").threshold = value; } : null;
  if (key === "handoff") return HANDOFF_MODES.includes(value) ? (d) => { objIn(d, "asks").handoff = value; d.instruct_block = value !== "prose"; } : null;
  if (BOOLS.has(key)) {
    if (typeof value !== "boolean") return null;
    return key === "openPanelOnAsks" ? (d) => { objIn(d, "surface").openPanelOnAsks = value; } : (d) => { objIn(d, "ui")[key] = value; };
  }
  if (key === "maxDepth") return Number.isFinite(Number(value)) ? (d) => { objIn(d, "branch").maxDepth = clampDepth(value); } : null;
  if (key === "editor") { const v = editorValue(value); return v === null ? null : (d) => { objIn(d, "links").editor = v; }; }
  if (key === "spaces") {
    const id = typeof value?.id === "string" && value.id ? value.id : null;
    if (!id) return null;
    if (value.drop === true) return (d) => { objIn(d, "spaces").disabled = disabledSpaces(d).filter((x) => x !== id); };
    return (d) => { objIn(d, "spaces").disabled = withSpaceOff(d, id, value.off === true); };
  }
  return null;
}

// The same change on a copy of the shown config (the dialog shows it at once; the next click starts from it).
export function applyEdit(cfg, edit) {
  const next = JSON.parse(JSON.stringify(cfg ?? DEFAULTS));
  edit(next);
  return next;
}

// What the status line says once a row's value is saved.
export function savedLine(key, value, name = null) {
  const label = SETTING_WORDS[key]?.[0] ?? key, path = SETTING_PATHS[key] ?? key;
  if (key === "textScale") return savedWords(label, scaleWords(textScaleOf({ ui: { textScale: value } })), path);
  if (key === "threshold") return savedWords(label, THRESHOLD_WORDS[value] ?? value, path);
  if (key === "handoff") return handoffSavedWords(value);
  if (BOOLS.has(key)) return savedWords(label, value ? "on" : "off", path);
  if (key === "maxDepth") { const n = clampDepth(value); return savedWords(label, n === 0 ? "0 (Branch is off)" : String(n), path); }
  if (key === "editor") return savedWords(label, editorWords(editorValue(value) ?? value), path);
  if (key === "spaces") {
    if (value?.drop) return droppedSpaceWords(value.id);
    return value?.off ? `ledgr is off in ${name ?? "that space"}: no chips, no ⌘J, no instruction or extraction for its agents. Their items are kept.`
      : `ledgr is on in ${name ?? "that space"} again.`;
  }
  return savedWords(label, String(value), path);
}

// The config the demo shows: the defaults, with ledgr off in the second demo space and in one Herdr no
// longer has.
export const demoConfig = () => ({ ...JSON.parse(JSON.stringify(DEFAULTS)), spaces: { disabled: [...DEMO_OFF] }, _source: "demo" });

export class Settings extends Reader {
  constructor(view, cx) {
    const raw = props() ?? {};
    const p = settingsProps(raw);
    super(cx, { demo: FORCE_DEMO || (p.ok && p.demo) });
    this.view = view;
    this.p = p;
    this.overlay = p.ok ? p.overlay : typeof raw.overlay === "string" ? raw.overlay : null;
    this.keys = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.closedBy = null;          // "esc": the closed record gives the list the keyboard back (focusAfter)
    this.released = false;
    if (this.demo) this.cfg = demoConfig();
    // Open files with: the field for a command of your own (made here, never in render); Enter saves it.
    this.editorInput = InputState.new({ placeholder: EDITOR_PLACEHOLDER, value: "" });
    this.editorShown = undefined;  // the links.editor the field last showed (showEditor): typing survives other changes
    this.editorInput.on("submit", (_e, cx) => this.setEditor(this.editorInput.value(), cx));
    this.showEditor();
    if (!p.ok) return;
    cx.spawn(async (cx) => this.start(cx));
  }

  // It reads config.json (Reader startReading and watchStore), never store.json.
  async reload() { return false; }

  async start(cx) {
    if (this.demo) this.inApp = await liveHome();
    else await this.startReading(cx);
    this.showEditor();
    if (this.inApp) this.writeOpen();
    const pick = (late) => { if (this.released || (late && this.keys.is_focused())) return; try { this.keys.focus(); } catch { /* clicks still work */ } };
    cx.timer.after(0, () => pick(false));
    cx.timer.after(400, () => pick(true));
    cx.notify();
  }

  // shared("ledgr.detail").open names this dialog (kind "settings", no id): the panel closes it before it
  // opens a detail dialog, and the other way round. The closed record already there stays.
  writeOpen() {
    if (!this.inApp || !this.overlay) return;
    const cur = shared("ledgr.detail");
    setShared("ledgr.detail", { open: { overlay: this.overlay, opener: this.p.opener ?? null, session: null, kind: "settings", id: null, at: Date.now() },
      closed: cur && typeof cur === "object" ? cur.closed ?? null : null });
  }

  close() {
    if (this.overlay) closeOverlay(this.overlay);
  }

  // From the View's close (Esc, a click outside): the writes still queued go first (Reader settleConfig),
  // then the closed record (its last words for the panel's status line; Esc gives the list the keyboard).
  async release() {
    if (this.released) return;
    this.released = true;
    try { await this.settleConfig(); } catch { /* closing */ }
    if (this.inApp && this.p.ok) {
      const mine = { overlay: this.overlay, opener: this.p.opener ?? null, session: null, kind: "settings", id: null, at: Date.now(),
        flash: this.flash || null, focus: focusAfter(this.closedBy), terminal: null, drafts: {} };
      try { setShared("ledgr.detail", mergeClosed(shared("ledgr.detail"), mine)); } catch { /* closing */ }
    }
  }

  // ── commands (this copy takes only its own) ──────────────────────────
  command(c, cx) {
    if (!this.p.ok || this.released || typeof c !== "string") return;
    if (c === "settings:close") { this.closedBy = "esc"; this.close(); return; }
    if (c.startsWith("settings:scale:")) {
      const v = c.slice("settings:scale:".length), cur = textScaleOf(this.cfg);
      const next = v === "up" ? stepScale(cur, 1) : v === "down" ? stepScale(cur, -1) : v === "reset" ? TEXT_SCALE.def : Number(v);
      if (Number.isFinite(next) && v !== "") this.set("textScale", next, cx); else this.flash = `No text scale ${v}: up, down, reset or ${TEXT_SCALE.min} to ${TEXT_SCALE.max}.`;
    }
  }

  // ── changing a value ─────────────────────────────────────────────────
  // One row's new value: shown at once, written through Reader saveConfig (the demo keeps it in memory).
  set(key, value, cx, name = null) {
    const edit = editFor(key, value);
    if (!edit) return;
    this.cfg = applyEdit(this.cfg, edit);
    if (key === "editor") this.showEditor();
    const words = savedLine(key, value, name);
    if (this.demo) { this.flash = `(demo) ${words} Not saved.`; cx.notify(); return; }
    this.saveConfig(edit, words, `${SETTING_WORDS[key]?.[0] ?? key} not saved`, cx);
  }

  // The field shows the custom command when links.editor is one (a preset leaves it empty), quoted so it
  // reads back as the same argv (links.js editorWords). Only when links.editor changed since the field last
  // showed it (a preset clicked, Enter, config.json edited by hand), so typing survives other rows' clicks.
  showEditor() {
    const v = editorOf(this.cfg), key = JSON.stringify(v);
    if (key === this.editorShown) return;
    this.editorShown = key;
    try { this.editorInput?.set_value(isPreset(v) ? "" : editorWords(v)); } catch { /* the field keeps its text */ }
  }

  // config.json changed (the watcher, or this dialog's own write): the field follows links.editor.
  onConfig(_cx) { this.showEditor(); }

  // Enter in the field: the typed command, when links.js editorValue takes it (empty: back to open); else
  // the status line says why (links.js editorRefusal).
  setEditor(text, cx) {
    if (editorValue(text) === null) { this.flash = editorRefusedWords(text, editorRefusal(text)); cx.notify(); return; }
    this.set("editor", text, cx);
    cx.notify();
  }

  // The spaces Herdr has now (the demo's own).
  liveSpaces() {
    if (this.demo) return DEMO_SPACES;
    try { return spaces() ?? []; } catch { return []; }
  }

  // config.json as a person finds it: under ~ when it is.
  pathWords() {
    const p = configPath();
    let h = "";
    try { h = String(home() ?? ""); } catch { /* none */ }
    return h && p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
  }

  // ── render ───────────────────────────────────────────────────────────
  render(cx) {
    this.rcx = cx;
    const t = withScale(theme(), textScaleOf(this.cfg));
    const root = v_flex().id("ledgr-settings").track_focus(this.keys)
      .on_key_down((e, cx) => {
        if ((e?.keystroke ?? e?.key) !== "escape") return;
        this.closedBy = "esc";
        this.close();
        cx.stop_propagation();
      })
      .size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(t.ts(12.5));
    if (!this.p.ok) return root.child(this.header(t)).child(div().id("st-nothing").px(18).py(14).text_size(t.ts(12.5)).text_color(t.muted).child(`Nothing to show (${this.p.error}).`));
    const rows = settingRows(this.cfg, this.liveSpaces());
    return root
      .child(this.header(t))
      .child(v_flex().id("st-body").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).px(18).py(12).gap(16)
        .children(rows.map((r) => this.row(t, r))))
      .child(this.footer(t));
  }

  header(t) {
    return h_flex().id("st-head").h(t.ts(44)).flex_none().px(16).gap(8).items_center().border_b(1).border_color(t.border)
      .child(svg(ICON("settings")).size(13).flex_none().text_color(t.accent))
      .child(div().flex_none().font_semibold().text_size(t.ts(13)).child("ledgr settings"))
      .when(this.demo, (el) => el.child(pill(t, "demo", t.accent)))
      .child(div().flex_1())
      .child(div().id("st-esc").flex_none().px(5).rounded(4).text_size(t.ts(11)).text_color(t.dim).cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground))
        .tooltip("Close (Esc)").on_click((_e, cx) => { cx.stop_propagation(); this.closedBy = "esc"; this.close(); }).child("Esc"));
  }

  // One row: its label and control on one line (wrapping when narrow), its line in words below; the off
  // spaces list one line per space under that.
  row(t, r) {
    const el = v_flex().id(`st-row-${r.key}`).flex_none().gap(5)
      .child(h_flex().flex_wrap().gap(10).items_center()
        .child(div().flex_1().min_w(160).font_semibold().text_size(t.ts(12.5)).child(r.label))
        .when(r.key !== "spaces", (x) => x.child(this.control(t, r))))
      .child(div().text_size(t.ts(11)).text_color(t.dim).child(r.words))
      .when(r.key === "editor", (x) => x.child(div().id("st-editor-hint").text_size(t.ts(10.5)).text_color(t.dim)
        .child(isPreset(r.value) ? EDITOR_CUSTOM_HINT : `Now your own: ${editorWords(r.value)}. ${EDITOR_CUSTOM_HINT}`)));
    return r.key === "spaces" ? el.child(this.spacesList(t, r.value)) : el;
  }

  control(t, r) {
    const seg = (id, label, on, value, tip) => segment(t, `st-${r.key}-${id}`, label, on, (_e, cx) => { if (!on) this.set(r.key, value, cx); cx.notify(); }, { tip });
    const group = (kids) => h_flex().id(`st-ctl-${r.key}`).flex_none().flex_wrap().gap(4).items_center().children(kids);
    if (r.key === "textScale") {
      const v = r.value;
      return group([
        btn(t, "st-scale-down", "−", (_e, cx) => this.set("textScale", stepScale(v, -1), cx), { disabled: v <= TEXT_SCALE.min, tip: `Smaller (down to ${scaleWords(TEXT_SCALE.min)})` }),
        div().id("st-scale-value").flex_none().min_w(t.ts(44)).flex().justify_center().text_size(t.ts(12)).font_semibold().text_color(t.accent).child(scaleWords(v)),
        btn(t, "st-scale-up", "+", (_e, cx) => this.set("textScale", stepScale(v, 1), cx), { disabled: v >= TEXT_SCALE.max, tip: `Larger (up to ${scaleWords(TEXT_SCALE.max)})` }),
        btn(t, "st-scale-reset", scaleWords(TEXT_SCALE.def), (_e, cx) => this.set("textScale", TEXT_SCALE.def, cx), { disabled: v === TEXT_SCALE.def, tip: "Back to the default size" }),
      ]);
    }
    if (r.key === "threshold") return group(TH_ORDER.map((lv) => seg(lv, THRESHOLD_WORDS[lv], r.value === lv, lv, `extract.threshold "${lv}"`)));
    if (r.key === "handoff") return group(HANDOFF_MODES.map((m) => seg(m, m, r.value === m, m, `asks.handoff "${m}"`)));
    if (BOOLS.has(r.key)) return group([seg("on", "on", r.value === true, true, `${r.path} true`), seg("off", "off", r.value === false, false, `${r.path} false`)]);
    if (r.key === "maxDepth") {
      const n = r.value;
      return group([
        btn(t, "st-depth-down", "−", (_e, cx) => this.set("maxDepth", Math.min(DEPTH.max, n) - 1, cx), { disabled: n <= DEPTH.min, tip: "Shallower" }),
        div().id("st-depth-value").flex_none().min_w(t.ts(44)).flex().justify_center().text_size(t.ts(12)).font_semibold().text_color(n ? t.accent : t.dim).child(n ? String(n) : "0 (off)"),
        btn(t, "st-depth-up", "+", (_e, cx) => this.set("maxDepth", n + 1, cx), { disabled: n >= DEPTH.max, tip: `Deeper (up to ${DEPTH.max} here)` }),
      ]);
    }
    if (r.key === "editor") {
      const custom = !isPreset(r.value);
      return group([
        ...EDITOR_PRESETS.map((m) => seg(m, m, r.value === m, m, `links.editor "${m}"`)),
        h_flex().id("st-editor-box").flex_none().w(t.ts(220)).h(t.ts(24)).px(6).items_center().rounded(6).border_1()
          .border_color(custom ? t.accent : t.input).bg(t.background)
          .child(Input.new(this.editorInput).flex_1().h_full().text_size(t.ts(11.5)).text_color(t.foreground)),
      ]);
    }
    return div();
  }

  // One line per space: its name ("this space" for the focused pane's), and on | off for ledgr there; an off
  // id Herdr no longer has, by id, with Drop.
  spacesList(t, list) {
    if (!list.length) return div().id("st-spaces-none").text_size(t.ts(11.5)).text_color(t.dim).child(NO_SPACES);
    let here = null;
    try { here = this.demo ? DEMO_SPACES[0].id : focused()?.space ?? null; } catch { /* none */ }
    return v_flex().id("st-spaces").gap(2).children(list.map((sp) => {
      const line = h_flex().id(`st-space-${sp.id}`).flex_none().h(t.ts(28)).px(8).gap(8).items_center().rounded(6).hover((x) => x.bg(t.hover))
        .child(div().flex_1().min_w(0).truncate().text_size(t.ts(12)).text_color(sp.stale ? t.dim : t.foreground).child(sp.stale ? staleSpaceWords(sp.id) : sp.name))
        .when(sp.id === here, (x) => x.child(div().flex_none().text_size(t.ts(10.5)).text_color(t.dim).child("this space")));
      if (sp.stale) return line.child(btn(t, `st-drop-${sp.id}`, "Drop", (_e, cx) => this.set("spaces", { id: sp.id, drop: true }, cx), { tip: `Take ${sp.id} out of spaces.disabled` }));
      const sw = (on) => segment(t, `st-space-${on ? "on" : "off"}-${sp.id}`, on ? "on" : "off", on ? !sp.off : sp.off,
        (_e, cx) => { if (on === sp.off) this.set("spaces", { id: sp.id, off: !on }, cx, sp.name); cx.notify(); },
        { tip: on ? `ledgr on in ${sp.name}` : `ledgr off in ${sp.name}: no chips, no ⌘J, no instruction or extraction; items kept` });
      return line.child(h_flex().flex_none().gap(4).child(sw(true)).child(sw(false)));
    }));
  }

  footer(t) {
    return v_flex().id("st-foot").flex_none().border_t(1).border_color(t.border).px(16).py(8).gap(6)
      .when(Boolean(this.flash) || this.demo, (el) => el.child(div().id("st-flash").text_size(t.ts(11)).text_color(t.muted).child(this.flash || SETTINGS_DEMO)))
      .child(h_flex().gap(10).items_center()
        .child(div().id("st-path").flex_1().min_w(0).text_size(t.ts(11)).text_color(t.dim).child(settingsFootWords(this.pathWords())))
        .child(keyHints(t, [["Esc", "close"]])));
  }
}
