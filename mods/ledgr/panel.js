// ledgr panel (spec 6): a layout block, props {view: "panel"}, by default a child of the right-hand
// `panel-body` stack (config.json ui.panel says where; config.js panelPlace).
// A reader (reader.js Reader, which this class extends): it loads ledgr-data/store.json and follows it
// with watchFolder. The writer (spool ingest, store.json, chips) runs in an always-shown host copy
// (writer.js: the ledgr host block, or an overlay's tab bar); every act here (resolve, promote, draft,
// seen, retry, clear, the pin events) is posted as a spool event. Only when no host writer answers does
// this copy run a fallback Writer. localStorage holds UI prefs only.
// It follows the focused agent's session unless held (the header's hold control, 2026-11-07: it was
// "pinned" before pins existed; localStorage keeps the key "pinned"); lanes: pins, your questions
// (parked human asks, then the session's branches) and asks of you (agent asks, grouped by turn).
// The list and the detail dialog (2026-11-10, docs/design/Detail.md 1): one line per item, pin or
// branch (listing.js rowModel: glyph, handle, one pill, the text's first line, a state word). Done (on
// the hovered row and the cursor row) and Paste answer (an answer is ready; Promote on a row below the
// threshold) are the only buttons on a row. A click on a row, or Enter on it, opens the detail dialog
// (detail.js, its own copy of ledgr: openOverlay with {view: "detail", …}), which shows the item whole,
// its text selectable, with every action the expanded rows had: answering, Branch… and the manifest,
// Conclude… and Paste into trunk, the pins' Ask here…, Note, Archive, Delete. When the dialog closes,
// its record in shared("ledgr.detail") brings the cursor back to that row, its last words to the
// status line and its typed answers to the rows, and gives the keyboard back to the list (or leaves it
// in the pane a message was pasted into). Keyboard: a click gives the list the keyboard (so does the
// unbound ledgr.focus-list); ↑ ↓, PageUp/PageDown, Home/End move a cursor over every line a click acts
// on, Enter does what its click does, Space checks a pin, Esc clears the cursor.
// Phase 2 and 3 (branches, the confluence) live in the dialog: the panel lists a session's branches
// under its questions (one line each, with their live word from Herdr), and ledgr.branch, conclude,
// ask-conclusion, copy-confluence and close-branch open the dialog in that state. The session menu
// nests branch sessions under their parent and offers Forget for sessions whose terminal is gone.
// "Paste N answers" (a turn group's sheet line) and a row's Paste answer stage the answer sheet through
// Reader.stage (the clipboard, the pane focused, `terminal.paste` once Herdr reports that pane
// focused; never Enter). ui.pasteIntoPrompt false: clipboard plus focus only (words.js stageLabels).
// Severity: asks below extract.threshold (config.json) sit in a folded "below threshold (N)" line at
// the bottom of their turn group, uncounted, each with Promote; blocking asks sort first with ◆ and a
// pill. Turn groups: the newest is open, and so is every group that holds an open blocking ask; the
// person's click wins over both (groupOpen). A folded group with a blocker shows "◆ N blocking".
// A closed row's state word says who closed it when it was not the person's Done: its branch, the
// agent (resolve_asks), or "answered by you" (the answer took at the next turn's end).
// Motion (ui.animations): only on state transitions, found by comparing the classes of the store's
// items before and after a change (observe): a row entering its lane fades and slides in under a
// highlight that decays over about a second; a row leaving (resolved, dismissed, deferred) fades,
// and collapses when its height is known; an answered ask glows in `done`; a new suggestion lights its
// fold line. All of it native (`transition`): no timer redraws, and an idle panel does not render
// (ledgr.render-stats counts renders).
// Spaces (2026-11-07): the session menu's first row turns ledgr off (or on) in the focused pane's space
// (config.json spaces.disabled, setSpaceOff). Where it is off, the panel shows "ledgr is off in this
// space" with the switch instead of that session's lanes (offState); a session picked in another space
// (held, or from the menu) still shows. Items are kept, only hidden.
// Clear N (2026-11-07): the YOUR QUESTIONS head clears the shown session's open and deferred parked
// questions in two clicks (one `clear_questions` event); branched and rejoin_pending ones stay, the rest
// go to Closed as "cleared", each reopenable from its dialog.
// Pins (2026-11-07, docs/design/Pins.md 4): the PINS lane, above YOUR QUESTIONS, lists the shown
// session's pins (passages kept verbatim with ⌘J, ⌘S), newest first, five then "N more", archived ones
// behind "archived (N)". Its head holds a search box over every session's pins (store.js searchPins, in
// memory: nothing is read or posted while typing). Checkboxes gather pins from any session into a
// selection (pinSel, at most LIMITS.pinsPerQuestion); Ask about these… opens the capture box in pins
// mode (props.pins, props.then); a pin's dialog carries the selection when the pin is in it.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Popup, ScrollHandle } from "gpui-base";
import { theme, props, shared, setShared, focused, run, openOverlay, closeOverlay, agents, panes, spaces, home } from "herdr";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { FORCE_DEMO, LIMITS, loadConfig, dataDir, agentLabel, panelPlace, panelShown, handoffOf, HANDOFF_WORDS, spaceOff, withSpaceOff, terminalSpace, textScaleOf, withScale } from "./config.js";
import { Store, isAgentAsk, isHuman, isClosed, isSuggestion, isBlocking, thresholdOf, LEVELS, groupOpen } from "./store.js";
import { Writer, writerClaim, engineDrift } from "./writer.js";
import { isLive } from "./nav.js";
import { demoData, DEMO_SESSION } from "./fixtures.js";
import { THRESHOLD_WORDS, itemWords as H, paneWords as P, sessionWords, stageLabels, clearLabel, clearConfirm, clearedWords, OFF_HERE, spaceToggleWords, handleWords,
  pinsWords, PINS_EMPTY, pinsSearchEmpty, pinsSelectedWords, askAboutPinsWords, pinNameWords, pinLabel } from "./words.js";
import { loadAdapters, adapterOf, asksMode } from "./adapters.js";
import { thenRequest, thenStale } from "./pinning.js";
import { Reader } from "./reader.js";
import { rowModel, entryKey, moveCursor, keepPlace, ROW } from "./listing.js";
import { detailSpec, settingsSpec } from "./detailing.js";

const ICON = (n) => `mods/workspace-chrome/${n}.svg`;
// The panel's one indent: a child question's row (under the ask it is about) hangs here, the status
// glyph's width plus its gap.
const IND = 18;
const DAY = 86400e3;
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const HOUR = 3600e3;
// extract.threshold as the ASKED OF YOU control names it.
// The three thresholds in words (words.js THRESHOLD_WORDS: the settings dialog names them alike).
const TH_WORDS = THRESHOLD_WORDS;
const DONE_TIP = "Done: you did or decided it";
// How long Clear N waits for its second click.
const CLEAR_ARM_MS = 4000;
// The PINS lane shows this many open pins before "N more".
const PINS_SHOWN = 5;
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
// The list's keys (docs/design/Detail.md 1.6), as GPUI spells e.keystroke. ↑ ↓ and PageUp/PageDown also
// reach the list from the pins search box; the others act only while the list itself has the keyboard.
const LIST_KEYS = new Set(["up", "down", "pageup", "pagedown", "home", "end", "enter", "space", "escape"]);
const NAV_KEYS = new Set(["up", "down", "pageup", "pagedown"]);
// Commands every shown copy gets that are not the panel's: the capture box's keys (keys.json mod:ledgr)
// and the detail dialog's own (they need its state). detail:* and conclude-edit:* too (command()).
const PANEL_IGNORES = new Set(["tab", "backtab", "btw", "pin", "submit", "escape", "launch-branch", "branch-split", "branch-agent", "send-to-trunk"]);
// ledgr.demo-detail without a handle opens the dialog on this demo ask (fixtures.js DEMO_DETAIL).
const DEMO_DETAIL_HANDLE = "A15";

export class Panel extends Reader {
  constructor(view, cx) {
    const p = props() ?? {};
    super(cx, { demo: FORCE_DEMO || p.demo === true });
    this.view = view;
    this.panelId = randomUUID();
    this.writer = null;            // a fallback Writer, only when no host writer answers
    this.unfolded = new Set();
    this.folded = new Set();
    this.sugOpen = new Set();      // turn groups whose "below threshold (N)" line is open
    this.folds = { older: false, deferred: false, closed: false };
    // Lane folds are the person's alone: changed only by a click (or the fold-* commands), kept
    // across reloads. ui.foldAsksWhileWorking brings back the Phase 1 auto-fold (asksOpen).
    this.collapsed = { pins: false, asks: false, mine: false };
    try {
      const saved = JSON.parse(localStorage.getItem("lanes") || "{}");
      for (const k of ["pins", "asks", "mine"]) if (typeof saved?.[k] === "boolean") this.collapsed[k] = saved[k];
    } catch { /* defaults */ }
    this.forgetAsk = null;         // session id awaiting a second click on Forget
    this.clearAsk = null;          // {sid, at}: Clear N armed, awaiting its second click
    this.clearing = null;          // {sid, evId, at, n}: a clear_questions event not yet in store.json
    this.demoOff = false;          // demo only: draw the "ledgr is off in this space" state
    this.dd = null;                // the open dropdown's key (menuButton): one at a time
    this.ddShut = null;            // {key, at}: closed by a press outside (that press may be its own trigger)
    this.ddFocus = cx.focus_handle();
    this.menu = false;
    this.seenSent = new Map();
    this.override = null;
    this.last = null;
    this.wasShown = false;
    this.checkedAt = 0;
    // Motion state (observe): `fx` id -> {kind: enter|answered|sug, at, k, phase}; `ghosts` id -> {item
    // (as it was), at, h, phase} for rows that just left a lane; `rowH` id -> {h, at}, a row's height
    // from the pointer passing over it (so a row the person closes can collapse).
    this.fx = new Map();
    this.ghosts = new Map();
    this.rowH = new Map();
    this.prevCls = null;           // id -> {c, status, sid, turn} as last observed; null: record only
    this.obsVer = undefined;
    this.renders = 0;
    // The list's keyboard (docs/design/Detail.md 1.6-1.9): its focus handle (the root tracks it), the
    // scroll handle of `ledgr-list` (the cursor row revealed), the cursor (an entry key, per session, in
    // memory), the entries of the last render ({key, index among ledgr-list's children, enter, space}),
    // the hovered row (its Done), the dialog this copy opened (its overlay id), the overlay ids it closed
    // to open another (their closed records move nothing), and the newest closed record handled.
    this.keys = cx.focus_handle();
    this.listScroll = ScrollHandle.new();
    this.cursor = null;
    this.cursorSid = null;
    this.pendingCursor = null;
    this.entries = [];
    this.entryKeys = [];
    this.entrySeen = new Set();
    this.listFocused = false;
    this.hoverKey = null;
    this.openKey = null;
    this.detailId = null;
    this.replaced = new Set();
    this.closedAt = Number(shared("ledgr.detail")?.closed?.at) || 0;
    this.ctx = { threshold: "needed", now: Date.now(), here: null, store: null, branchLive: (b) => this.branchLive(b) };
    // Pins (docs/design/Pins.md 4): the selection (pin ids, any session; in memory only: the overlay's
    // and the panel's localStorage are separate files), "N more" and "archived (N)" open, the search (its
    // InputState is made here, never in render; Enter opens the cursor's pin, else the first result),
    // its "archived too" and "this session only" toggles, and a focus request's `then` waiting for its
    // question ({item, then, at, pins}).
    this.pinSel = new Set();
    this.pinsMore = false;
    this.pinsArch = false;
    this.pinQuery = "";
    this.pinArchToo = false;
    this.pinHereOnly = false;
    this.thenReq = null;
    this.pinSearch = InputState.new({ placeholder: "Search pins, every session" });
    this.pinSearch.on("change", (_e, cx) => { this.pinQuery = this.pinSearch.value(); cx.notify(); });
    this.pinSearch.on("submit", (_e, cx) => { this.searchSubmit(cx); cx.notify(); });
    // The header's hold: the panel stays on one session instead of following the focused pane.
    try { this.held = localStorage.getItem("pinned") || null; } catch { this.held = null; }
    // A focus request older than this copy is not a request to it.
    this.focusAt = Number(shared("ledgr.focus")?.at) || 0;
    if (this.demo) this.enterDemo();
    if (!FORCE_DEMO) cx.spawn(async (cx) => this.start(cx));
    cx.timer.every(60000, (cx) => this.tick(cx));
  }

  // ── reader lifecycle ─────────────────────────────────────────────────
  // The panel reads ledgr-data/store.json and follows it with watchFolder (Reader); the writer is a
  // host copy (writer.js). If none answers a ping within 4 s, this copy runs a fallback writer, and
  // hands the role back as soon as a host writer claims it.
  async start(cx) {
    if (!(await this.startReading(cx))) return;   // herdr-app check: no ping, no fallback writer
    this.adapters = await loadAdapters();
    try { localStorage.removeItem("store"); } catch { /* the pre-store.json cache, unused now */ }
    this.checkWriter(cx);
    const drift = await engineDrift();
    if (drift.length) {
      const warn = this.flash = `An engine copy differs from mods/ledgr/ (${drift.join(", ")}): run install.sh again so every writer runs the same code.`;
      // install.sh syncs mods/ledgr (which reloads this copy) a moment before it copies the engine
      // into a host's ledgr/ folder: look once more before keeping the warning.
      cx.timer.after(5000, (cx) => cx.spawn(async (cx) => {
        if (this.flash === warn && !(await engineDrift()).length) { this.flash = ""; cx.notify(); }
      }));
    }
    cx.notify();
  }

  fallback() { return Boolean(this.writer?.amWriter()); }

  viewStore() {
    if (this.demo && this.demoStore) return this.demoStore;
    return this.fallback() ? this.writer.live : this.live;
  }

  // config.json changed (Reader.watchStore): the fallback writer follows it, and a new threshold moves
  // rows between lanes, which is not a motion.
  onConfig(_cx) {
    if (this.fallback()) this.writer.applyConfig(this.cfg);
    this.prevCls = null;
    this.obsVer = undefined;
  }

  // Ask whether a host writer is alive (it re-claims on a newer ping); none in 4 s: fallback.
  checkWriter(cx) {
    if (FORCE_DEMO || this.fallback() || !this.inApp) return;
    const at = Date.now();
    this.checkedAt = at;
    setShared("ledgr.ping", { at, id: this.panelId });
    cx.timer.after(4000, (cx) => {
      const w = writerClaim();
      if (w && w.by !== "panel" && Number(w.at) >= at) { this.writerNote = null; cx.notify(); return; }
      if (this.writer && !this.writer.retired) return;
      this.writer = new Writer("panel");
      this.writerNote = "No host writer answered: this panel is ingesting (fallback writer). Add the ledgr host block to the layout for live chips.";
      cx.spawn(async (cx) => { await this.writer.start(cx); cx.notify(); });
    });
  }

  tick(cx) {
    if (FORCE_DEMO) return;
    if (this.writer?.amWriter()) { this.writer.tick(cx); return; }
    this.tickRead(cx);
  }

  // ── commands (`herdr-app do ledgr.<command>`, shown copies only) ────
  // Every command reaches every shown copy, the detail dialog's too (docs/design/Detail.md 1.10): the
  // panel leaves the capture box's keys and the dialog's own commands alone, and hands an item's actions
  // to the dialog: it opens the dialog on that item in a state, or, when the dialog is already open on
  // it, leaves the command to the dialog.
  command(c, cx) {
    if (PANEL_IGNORES.has(c) || c.startsWith("detail:") || c.startsWith("conclude-edit:") || c.startsWith("settings:")) return;
    if (c === "demo") {
      if (this.demo && !FORCE_DEMO) {
        if (this.detailId) this.closeDetail();
        this.demo = false; this.demoStore = null; this.flash = ""; this.prevCls = null; this.cursor = null;
        this.pinSel.clear(); this.thenReq = null;
        // A threshold picked in the demo was held in memory only: read config.json again.
        cx.spawn(async (cx) => { this.cfg = await loadConfig(); this.obsVer = undefined; cx.notify(); });
      } else this.enterDemo();
    }
    else if (c === "capture") run("mod.open", { name: "ledgr" });
    // The settings dialog (settings.js), as the header's gear opens it; demo-settings: with the defaults
    // and sample spaces, nothing saved (the panel's own demo is left as it is).
    else if (c === "settings") this.openSettings(this.demo, cx);
    else if (c === "demo-settings") this.openSettings(true, cx);
    else if (c === "rescan") { if (this.fallback()) this.writer.tick(cx); else cx.spawn(async (cx) => { await this.reload(); cx.notify(); }); }
    else if (c === "check-writer") this.checkWriter(cx);
    // Rows no longer open in place.
    else if (c === "expand-all" || c === "expand-branches") this.flash = "Rows open in the detail dialog: ledgr.open:<handle>";
    // The Branch confirmation on the newest open parked question of the shown session, in its dialog.
    else if (c === "branch") {
      const st = this.viewStore(), sid = this.current(st), s = sid ? st.d.sessions[sid] : null;
      const it = s ? st.itemsOf(sid).filter((x) => isHuman(x) && !isClosed(x)).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0] : null;
      if (it) this.openDetail("question", it.id, sid, { open: "confirm" }, cx); else this.flash = "No open parked question to branch from in this session.";
    }
    // Phase 3, on the newest branch of the shown session that fits: its dialog, in that state (Conclude…,
    // Ask for a conclusion, Paste confluence again, Close branch armed). The dialog already open on that
    // branch does it itself (close-branch twice: arm, then end).
    else if (c === "conclude" || c === "ask-conclusion" || c === "copy-confluence" || c === "close-branch") {
      const st = this.viewStore(), sid = this.current(st), brs = sid ? st.branchesOf(sid) : [];
      const [fits, open, none] = {
        "conclude": [(b) => this.canConclude(st, b), "conclude", "No branch to conclude in this session."],
        "ask-conclusion": [(b) => this.canConclude(st, b) && Boolean(b.terminal), "ask-conclusion", "No running branch to ask in this session."],
        "copy-confluence": [(b) => b.status === "concluded", "again", "No staged confluence in this session."],
        "close-branch": [(b) => b.status === "rejoined" && !b.closedAt, "close", "No rejoined branch to close in this session."],
      }[c];
      const br = brs.find(fits);
      if (!br) this.flash = none;
      else if (!this.detailOn(br.id)) this.openDetail("branch", br.id, sid, { open }, cx);
    }
    else if (c === "copy-answers") {
      const st = this.viewStore(), sid = this.current(st), s = sid ? st.d.sessions[sid] : null;
      const g = s ? st.itemsOf(sid).filter((it) => isAgentAsk(it) && !isClosed(it) && String(it.draft ?? "").trim()) : [];
      if (g.length) this.copyAnswers(s, Math.max(...g.map((it) => it.anchor?.turn ?? 0)), cx); else this.flash = "No typed answers in this session.";
    }
    else if (c === "sessions") this.menu = !this.menu;
    // `session:<terminal or session id prefix>`: show that session, as a click in the session menu does.
    else if (c.startsWith("session:")) {
      const k = c.slice("session:".length), st = this.viewStore();
      const s = st.sessionsList().find((x) => x.terminal === k || x.sessionId.startsWith(k));
      if (s) { this.menu = false; this.override = { sid: s.sessionId, terminal: focused()?.terminal ?? null }; } else this.flash = `No session ${k}.`;
    }
    // For scripted looks at the lower lane: fold or unfold a lane.
    else if (c === "fold-mine") this.setCollapsed("mine", !this.collapsed.mine);
    // `pick:<handle>:<n>` posts option n (from 0) of that ask as its answer; `copy-answer:<handle>` is its
    // Paste answer (Copy answer when ui.pasteIntoPrompt is off). The dialog open on that ask does both.
    else if (c.startsWith("pick:") || c.startsWith("copy-answer:")) {
      const st = this.viewStore(), sid = this.current(st), s = sid ? st.d.sessions[sid] : null;
      const [, h, n] = c.split(":");
      const it = s ? st.byHandle(sid, h) : null;
      if (!it || !isAgentAsk(it)) this.flash = `No ask ${h} in this session.`;
      else if (this.detailOn(it.id)) { /* the dialog does it */ }
      else if (c.startsWith("pick:")) { const o = (it.options ?? [])[Number(n)]; if (o === undefined) this.flash = `${h} has no option ${n}.`; else this.typeDraft(it.id, o, cx); }
      else this.copyAnswer(it, s, cx);
    }
    // `open:<handle>`: the dialog on that item or pin of the shown session (A3, Q2, P4) or branch (its hc
    // name, br-q3-7c1e). `cursor:<handle>`: the list takes the keyboard, its cursor on that row.
    else if (c.startsWith("open:") || c.startsWith("cursor:")) {
      const st = this.viewStore(), sid = this.current(st), h = c.slice(c.indexOf(":") + 1), r = this.resolveHandle(st, sid, h);
      if (!r) this.flash = `No ${h} in this session.`;
      else if (c.startsWith("open:")) this.openDetail(r.kind, r.id, r.sid, {}, cx);
      else { this.focusList(); this.cursor = entryKey(r.kind, r.id); this.reveal(this.cursor); }
    }
    // `list-key:<up|down|pageup|pagedown|home|end|enter|space|escape>`: the list's keys, for scripted
    // looks (whatever has the keyboard); `focus-list` (no key bound): the list takes the keyboard.
    else if (c.startsWith("list-key:")) {
      const k = c.slice("list-key:".length);
      if (LIST_KEYS.has(k)) this.listKey(k, cx); else this.flash = `No list-key:${k}; one of ${[...LIST_KEYS].join(", ")}.`;
    }
    else if (c === "focus-list") this.focusFirst();
    // `demo-detail[:<handle>]`: the demo (entered if it is off), then the dialog on that demo item.
    else if (c === "demo-detail" || c.startsWith("demo-detail:")) {
      const h = c.startsWith("demo-detail:") ? c.slice("demo-detail:".length) : DEMO_DETAIL_HANDLE;
      if (!this.demo) this.enterDemo();
      const r = this.resolveHandle(this.demoStore, DEMO_SESSION, h);
      if (r) this.openDetail(r.kind, r.id, r.sid, {}, cx); else this.flash = `No ${h} in the demo.`;
    }
    // menu:threshold and menu:off open the lane's menu as a click does.
    else if (c === "menu:threshold" || c === "menu:off") this.dd = c === "menu:off" ? null : "threshold";
    // go:<handle>, whole:<handle>, menu:<handle>:<defer|more>, ask-here:<Q handle> (a question with pins):
    // the dialog on that item with Go to anchor done, the whole message, that menu open, or Ask here
    // done; the dialog already open on it does it itself.
    else if (/^(go|whole|menu|ask-here):/.test(c)) {
      const [kind, h, which] = c.split(":");
      const st = this.viewStore(), sid = this.current(st), r = this.resolveHandle(st, sid, h);
      const it = r && r.kind !== "pin" && r.kind !== "branch" ? st.item(r.id) : null;
      if (!r) this.flash = `No ${h} in this session.`;
      else if (kind === "ask-here" && (!it || !isHuman(it) || !st.pinsOf(it).length)) this.flash = `No question ${h} with pins in this session.`;
      else if (!this.detailOn(r.id)) this.openDetail(r.kind, r.id, r.sid, { open: kind === "menu" ? (which === "defer" ? "defer" : "more") : kind }, cx);
    }
    else if (c === "fold-asks") { const st = this.viewStore(), sid = this.current(st), s = sid ? st.d.sessions[sid] : null; if (s) this.setAsksOpen(s, !this.asksOpen(s)); }
    // Closes the open dialog and clears the cursor.
    else if (c === "collapse-all") { this.closeDetail(); this.cursor = null; this.dd = null; this.flash = ""; }
    // Demo only, for a staged shot: hide-branch:<hc name> (br-q2-a41b) drops that branch from the demo store.
    else if (this.demo && c.startsWith("hide-branch:")) {
      const name = c.slice("hide-branch:".length), st = this.demoStore;
      const id = Object.keys(st.d.branches).find((k) => st.d.branches[k].name === name);
      if (id) { delete st.d.branches[id]; this.bump(); } else this.flash = `No branch ${name} in the demo.`;
    }
    // For scripted checks of the severity and motion paths, the same code as the clicks:
    // act:<handle>:<resolve|dismiss|reopen|promote> on the shown session; suggestions (every
    // "below threshold (N)" line of the shown session, open or fold); demo only: demo-ask:<level>
    // (a new ask on the newest turn), demo-answer:<handle> (as if its answer sheet landed).
    else if (c.startsWith("act:")) {
      const [, h, action] = c.split(":");
      const st = this.viewStore(), sid = this.current(st), it = sid ? st.byHandle(sid, h) : null;
      if (!it || !["resolve", "dismiss", "reopen", "promote"].includes(action)) this.flash = `No ${h} in this session, or not one of resolve, dismiss, reopen, promote.`;
      else this.act(it.id, action, null, cx);
    }
    // threshold:<blocking|needed|optional>: the lane head's menu choice (writes config.json).
    else if (c.startsWith("threshold:")) { const lv = c.slice("threshold:".length); if (LEVELS.includes(lv)) this.setThreshold(lv, cx); else this.flash = `No threshold ${lv}.`; }
    else if (c === "suggestions" || c === "below-threshold") {
      const st = this.viewStore(), sid = this.current(st);
      const ks = [...new Set((sid ? st.itemsOf(sid) : []).filter((it) => isSuggestion(it, st.threshold)).map((it) => `${sid}:${it.anchor?.turn}`))];
      const open = ks.some((k) => !this.sugOpen.has(k));
      for (const k of ks) { if (open) this.sugOpen.add(k); else this.sugOpen.delete(k); }
    }
    else if (this.demo && c.startsWith("demo-ask:")) {
      const st = this.demoStore, s = st.d.sessions[DEMO_SESSION], level = c.slice("demo-ask:".length);
      const turn = Math.max(...st.itemsOf(DEMO_SESSION).filter(isAgentAsk).map((it) => it.anchor?.turn ?? 0));
      const n = s.nextHandle.A;
      const text = { blocking: `Send the staging database password (demo ask ${n})`, optional: `Decide whether the agent should also tidy the old migrations (demo ask ${n})` }[level] ?? `Confirm the maintenance window for the cutover (demo ask ${n})`;
      st.apply({ v: 1, id: `demo-${n}`, type: "asks", at: Date.now(), terminal: s.terminal, session_id: DEMO_SESSION, turn, source: "model",
        asks: [{ text, kind: level === "blocking" ? "provide" : "confirm", level: ["blocking", "needed", "optional"].includes(level) ? level : "needed", options: [], recommended: null, quote: null }] });
      this.bump();
    }
    else if (this.demo && c.startsWith("demo-answer:")) {
      const st = this.demoStore, it = st.byHandle(DEMO_SESSION, c.slice("demo-answer:".length));
      if (it && isAgentAsk(it) && !isClosed(it)) { it.answer = squash(it.draft) || "yes"; it.answeredBy = "sheet"; st.setStatus(it, "answered"); this.bump(); }
    }
    // Writes ledgr-data/log/panel-renders-<copy>.json: how many times this copy rendered, and its motion
    // state (an idle panel shows the same count twice, give or take the command's own render).
    else if (c === "render-stats") {
      const out = { at: Date.now(), renders: this.renders, fx: this.fx.size, ghosts: this.ghosts.size, animations: this.animOn(), shown: this.isShown(),
        transcripts: Object.fromEntries([...this.txCheck].map(([k, v]) => [k.slice(0, 24), v])) };
      // One file per copy (several shown copies can answer the same command).
      out.copy = this.panelId.slice(0, 8);
      cx.spawn(async () => { await fs.mkdir(`${dataDir()}/log`, { recursive: true }).catch(() => {}); await fs.writeFile(`${dataDir()}/log/panel-renders-${out.copy}.json`, JSON.stringify(out) + "\n").catch(() => {}); });
    }
    // space:<off|on|toggle>: the session menu's switch for the focused pane's space (writes
    // spaces.disabled; demo: draws the off state, nothing saved).
    else if (c.startsWith("space:")) {
      const want = c.slice("space:".length), fsp = focused()?.space ?? null;
      if (!["off", "on", "toggle"].includes(want)) this.flash = `No space:${want}; space:off, space:on or space:toggle.`;
      else this.setSpaceOff(fsp, want === "toggle" ? !(this.demo ? this.demoOff : spaceOff(this.cfg, fsp)) : want === "off", cx);
    }
    // clear-questions: the YOUR QUESTIONS head's Clear N, as a click (twice: arm, then clear).
    else if (c === "clear-questions") {
      const st = this.viewStore(), sid = this.current(st), s = sid ? st.d.sessions[sid] : null;
      if (s) this.clearQuestions(s, cx); else this.flash = "No session shown.";
    }
    // Pins (docs/design/Pins.md 4.8), the same code as the clicks, on the shown session: fold-pins;
    // pins-search:<text> (empty clears); pin-select:<P handle>; ask-pins (Ask about these…);
    // pin-note:<P handle>:<text>; pin-archive / pin-restore:<P handle> (posted without any UI).
    else if (c === "fold-pins") this.setCollapsed("pins", !this.collapsed.pins);
    else if (c.startsWith("pins-search:")) this.setPinQuery(c.slice("pins-search:".length));
    else if (c === "ask-pins" || /^(pin-select|pin-note|pin-archive|pin-restore):/.test(c)) {
      const st = this.viewStore(), sid = this.current(st), s = sid ? st.d.sessions[sid] : null;
      const [kind, h, ...rest] = c.split(":");
      if (!s) this.flash = "No session shown.";
      else if (kind === "ask-pins") this.askAboutSelection(st, s, cx);
      else {
        const p = st.pinByHandle(sid, h);
        if (!p) this.flash = `No pin ${h} in this session.`;
        else if (kind === "pin-select") this.togglePinSel(st, p);
        else if (kind === "pin-note") this.pinAct("pin_note", p, { note: rest.join(":") }, cx);
        else if (kind === "pin-archive") this.pinAct("pin_archive", p, {}, cx);
        else this.pinAct("pin_restore", p, {}, cx);
      }
    }
  }

  // A handle of the shown session (A3, Q2, P4) or a branch's hc name (br-q3-7c1e, or its id): {kind, id,
  // sid} (the record's own session) or null.
  resolveHandle(st, sid, h) {
    const k = String(h ?? "").trim();
    if (!st || !k) return null;
    if (/^\[?[AQ]\d+\]?$/i.test(k)) {
      const it = sid ? st.byHandle(sid, k) : null;
      return it ? { kind: isAgentAsk(it) ? "ask" : "question", id: it.id, sid: it.anchor?.sessionId ?? sid } : null;
    }
    if (/^\[?P\d+\]?$/i.test(k)) {
      const p = sid ? st.pinByHandle(sid, k) : null;
      return p ? { kind: "pin", id: p.id, sid: p.sessionId } : null;
    }
    const br = Object.values(st.d.branches).find((b) => b.name === k || b.id === k);
    return br ? { kind: "branch", id: br.id, sid: br.parentSessionId } : null;
  }

  enterDemo() {
    this.demo = true;
    this.prevCls = null;
    this.demoStore = new Store(demoData());
    this.override = null;
    this.cursor = null;
    this.flash = "Demo data: nothing here is saved or sent.";
    this.asksManual = { sid: DEMO_SESSION, stopAt: this.demoStore.d.sessions[DEMO_SESSION]?.lastStopAt ?? 0, open: true };
  }

  // ── which session ────────────────────────────────────────────────────
  current(st) {
    const f = shared("ledgr.focus");
    const ft = focused()?.terminal ?? null;
    this.away = null;
    if (f?.session && Number(f.at) > this.focusAt) {
      this.focusAt = Number(f.at);
      this.override = { sid: f.session, terminal: ft };
      // The box parked a question with pins: the selection is spent; `then` (trunk, branch) waits for
      // the question to reach the store (runThen).
      if (f.item && Number(f.pins) > 0) this.pinSel.clear();
      // Timed by the box's message itself (f.at), so a copy that notices it late lets it go stale.
      const tr = thenRequest(f);
      if (tr) this.thenReq = tr;
    }
    if (this.held && st.d.sessions[this.held]) return this.held;
    if (this.override && st.d.sessions[this.override.sid]) {
      if (!ft || ft === this.override.terminal) return this.override.sid;
      this.override = null;
    }
    if (this.demo) return DEMO_SESSION;
    const sid = ft ? st.sessionForTerminal(ft) : null;
    if (sid && st.d.sessions[sid]) { this.last = sid; return sid; }
    const keep = this.last && st.d.sessions[this.last] ? this.last
      : st.sessionsList().find((s) => s.state !== "ended")?.sessionId ?? st.sessionsList()[0]?.sessionId ?? null;
    // The focused pane has no ledgr session: its hooks have not reported it yet (it joins at its
    // next prompt or turn end), or never will (a Claude Code with another CLAUDE_CONFIG_DIR). An agent
    // pane, or any pane in another space, says so instead of showing a session from elsewhere; a
    // shell or editor in the same space as the last session keeps that session.
    if (ft && !this.besides(ft, keep ? st.d.sessions[keep] : null)) { this.away = this.awayOf(ft); return null; }
    return keep;
  }

  // Whether the focused pane ft (no ledgr session of its own) may keep showing session s: only a
  // pane that runs no agent, in the same space as s's terminal.
  besides(ft, s) {
    if (this.awayOf(ft).agent || !s?.terminal) return false;
    const space = focused()?.space ?? null;
    const home = agents().find((a) => a.address === s.terminal)?.space ?? null;
    return Boolean(space && home && space === home);
  }

  // The focused pane as the header names it when it has no session: its agent's name, if any.
  awayOf(ft) {
    const a = agents().find((x) => x.address === ft);
    const p = panes().find((x) => x.terminal === ft);
    const prog = a?.program ?? p?.program ?? null;
    const agent = Boolean(a || p?.status || prog?.agent);
    return { terminal: ft, agent, name: agent ? (prog?.name || a?.app || "agent") : null };
  }

  isShown() {
    return panelShown(panelPlace(this.cfg)) !== false;
  }

  // The View's close: a fallback writer gives the role up so a host takes it at once.
  release() {
    try { this.writer?.release(); } catch { /* closing */ }
  }

  // Asks the writer to re-run extraction for a turn (a `retry` spool event; the writer runs the
  // hooks agent's --retry and the new `asks` event arrives through the spool).
  retry(s, turn, cx) {
    if (this.demo) return;
    this.post("retry", { session_id: s.sessionId, turn, terminal: s.terminal ?? null }, { action: "retry", sid: s.sessionId, turn }, cx);
  }

  forget(s, cx) {
    if (this.demo) { this.flash = "(demo) Would forget the session."; this.forgetAsk = null; cx.notify(); return; }
    this.forgetAsk = null;
    this.post("forget", { session_id: s.sessionId }, { action: "forget", sid: s.sessionId }, cx);
    if (this.held === s.sessionId) { this.held = null; try { localStorage.setItem("pinned", ""); } catch { /* none */ } }
    if (this.override?.sid === s.sessionId) this.override = null;
    this.flash = `Forgot ${s.sessionName || s.sessionId.slice(0, 8)} and its branches.`;
  }

  branchVisible(b) {
    return !((b.status === "refused" || b.status === "failed") && Date.now() - (b.updatedAt ?? b.createdAt ?? 0) > HOUR);
  }

  // ── motion (ui.animations) ───────────────────────────────────────────
  animOn() { return this.cfg.ui?.animations !== false; }

  // Where an item is drawn: in its lane, as a suggestion, answered, or out of the lanes. Staleness
  // (older than a day) moves rows by the clock, not by a state change: it never animates.
  classOf(st, it, now) {
    if (isClosed(it)) return "closed";
    if (it.status === "deferred") return "deferred";
    if (it.status === "open" && now - (it.updatedAt ?? 0) > DAY) return "stale";
    if (isAgentAsk(it) && isSuggestion(it, st.threshold)) return "sug";
    if (it.status === "answered") return "answered";
    return "lane";
  }

  // Called from render only when the shown store changed (this.rev, or the fallback writer's text).
  // Compares every item's class with the last observation; a change is a transition, and only a
  // transition starts motion. The first look, a store read while the panel was hidden (not fresh),
  // demo on or off and a config change record without moving anything.
  observe(st, shown, fallback, cx) {
    const now = Date.now();
    const cls = new Map();
    for (const it of st.items()) cls.set(it.id, { c: this.classOf(st, it, now), status: it.status, sid: it.anchor?.sessionId, turn: it.anchor?.turn });
    const prev = this.prevCls;
    this.prevCls = cls;
    this.pruneFx(now);
    if (!prev || !shown || !this.animOn() || !(fallback || now - this.revAt < 1500)) return;
    let k = 0, phase = false;
    const ends = new Set();       // when a render is needed after the motion: a ghost goes
    for (const [id, n] of cls) {
      const p = prev.get(id);
      if (p && p.c === n.c) continue;
      if (n.c === "stale" || p?.c === "stale") continue;
      if (n.c === "lane" && (!p || p.c === "sug" || p.c === "closed" || p.c === "deferred")) {
        if (k < 8) { this.fx.set(id, { kind: "enter", at: now, k: k++, phase: 0 }); phase = true; }
      } else if (n.c === "answered" && p?.c === "lane") {
        this.fx.set(id, { kind: "answered", at: now, k: 0, phase: 0 });
        phase = true;
      } else if (n.c === "sug" && !p) {
        this.fx.set(`sug:${n.sid}:${n.turn}`, { kind: "sug", at: now, k: 0, phase: 0 });
        phase = true;
      } else if ((n.c === "closed" || n.c === "deferred") && (p?.c === "lane" || p?.c === "answered")) {
        const it = st.item(id), r = this.rowH.get(id);
        // Collapse from the height the pointer last measured, if it is fresh; otherwise fade only.
        const h = r && now - r.at < 15000 ? r.h : null;
        this.ghosts.set(id, { item: { ...it, status: p.status, __ghost: true }, at: now, h, phase: 0 });
        phase = true;
        ends.add(h ? 380 : 200);
      }
    }
    // The second frame sets the targets the transitions run to (they are attached in the first).
    if (phase) cx.timer.after(16, (cx) => { for (const f of [...this.fx.values(), ...this.ghosts.values()]) f.phase = 1; cx.notify(); });
    // One render when a motion is over: ghosts go (the list closes up). The highlights need none:
    // they end at opacity 0, and their entries lapse after 1.5 s.
    for (const ms of ends) cx.timer.after(ms + 20, (cx) => { this.pruneFx(); cx.notify(); });
  }

  pruneFx(now = Date.now()) {
    for (const [id, g] of this.ghosts) if (now - g.at >= (g.h ? 380 : 200)) this.ghosts.delete(id);
    for (const [id, f] of this.fx) if (now - f.at >= 1500) this.fx.delete(id);
    if (this.rowH.size > 300) this.rowH.clear();
  }

  fxOf(id) {
    const f = this.fx.get(id);
    return f && Date.now() - f.at < 1500 ? f : null;
  }

  // A tint over a row (first child, under its content) that holds briefly and decays over ~0.9 s.
  glow(id, color, f, radius) {
    const hold = f.kind === "enter" ? 220 + f.k * 45 : 120;
    return div().id(id).absolute().top(0).left(0).size_full().rounded(radius).bg(color)
      .opacity(f.phase ? 0 : 1).transition("opacity", { duration: 900, delay: hold, easing: "ease-out" });
  }

  // A row that just left its lane, drawn as it was: it fades, then (height known) collapses.
  ghostRow(t, st, s, it) {
    const g = this.ghosts.get(it.id);
    return div().id(`ghost-${it.id}`).flex_none().overflow_hidden()
      .opacity(g?.phase ? 0 : 1).transition("opacity", { duration: 160, easing: "ease-out" })
      .when(g?.h != null, (el) => el.h(g.phase ? 0 : g.h).transition("height", { duration: 220, delay: 110, easing: "ease-in-out" }))
      .child(this.listRow(t, st, s, rowModel("item", it, this.ctx), it, { inert: true }));
  }

  ghostItems(sid) {
    const now = Date.now();
    return [...this.ghosts.values()].filter((g) => g.item.anchor?.sessionId === sid && now - g.at < 400).map((g) => g.item);
  }

  // ── render ───────────────────────────────────────────────────────────
  render(cx) {
    this.renders++;
    this.rcx = cx;
    // The theme with this config's text scale (config.js withScale: t.ts(n) is every text size).
    const t = withScale(theme(), textScaleOf(this.cfg));
    // A fallback writer steps down when a host writer claims the role.
    if (this.writer && this.writer.started && !this.writer.holds() && !this.writer.retired) {
      this.writer.retire();
      this.writerNote = null;
      cx.timer.after(0, (cx) => cx.spawn(async (cx) => { this.liveText = null; await this.reload(); cx.notify(); }));
    }
    if (this.writer?.amWriter()) this.writer.track(cx);
    const shown = this.isShown();
    // Shown again after a while: make sure a writer is alive (at most once a minute).
    if (shown && !this.wasShown && !this.demo && !FORCE_DEMO && Date.now() - this.checkedAt > 60000) cx.timer.after(0, (cx) => this.checkWriter(cx));
    this.wasShown = shown;
    const st = this.viewStore();
    st.threshold = thresholdOf(this.cfg);   // the writer applies the same value to the chips
    // Motion starts only here, and only when the store changed since the last look.
    const ver = this.fallback() ? this.writer.storeText : `${this.demo ? "d" : "r"}${this.rev}`;
    if (ver !== this.obsVer) { this.obsVer = ver; this.observe(st, shown, this.fallback(), cx); }
    const sid = this.current(st);
    const s = sid ? st.d.sessions[sid] : null;
    // The cursor belongs to one session's list: another session starts without one.
    if (sid !== this.cursorSid) { this.cursorSid = sid; this.cursor = null; this.entryKeys = []; }
    this.noteDetail(cx);
    // ledgr off in this space (spaces.disabled): the lanes are hidden, nothing is marked seen.
    const off = this.offState(st, s);
    if (s && !off && !this.demo && s.surfaced && shown && this.seenSent.get(sid) !== (s.lastStopAt ?? 0)) {
      this.seenSent.set(sid, s.lastStopAt ?? 0);
      cx.timer.after(0, (cx) => this.post("act", { session_id: sid, action: "seen" }, { action: "seen", sid }, cx));
    }
    if (this.thenReq) this.runThen(st, cx);
    try { this.listFocused = this.keys.is_focused(); } catch { this.listFocused = false; }
    this.ctx = { threshold: st.threshold, now: Date.now(), here: sid, store: st, branchLive: (b) => this.branchLive(b) };
    this.entries = [];
    this.entrySeen = new Set();
    const list = off ? [this.offView(t, off)] : s ? this.body(t, st, s)
      : [this.away && st.sessionsList().length ? this.awayState(t, this.away) : this.emptyState(t)];
    this.settleCursor(cx);
    const note = this.flash || this.writerNote || (this.fallback() ? this.writer.note : null);
    return v_flex().id("ledgr").track_focus(this.keys).on_key_down((e, cx) => this.onKey(e, cx))
      .size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(t.ts(12.5))
      .child(this.header(t, st, s, off))
      .when(this.menu, (el) => el.child(this.sessionMenu(t, st, sid)))
      .child(v_flex().id("ledgr-list").track_scroll(this.listScroll).flex_1().min_h(0).overflow_y_scrollbar().px(8).py(8).gap(4).children(list))
      .when(Boolean(s) && !off, (el) => el.child(this.footer(t, st, s)))
      .when(Boolean(note), (el) => el.child(
        div().flex_none().px(12).py(6).border_t(1).border_color(t.border).text_size(t.ts(11)).text_color(t.muted).child(note)));
  }

  // ── the list's keyboard and the detail dialog (docs/design/Detail.md 1.6-1.9) ──
  // A line of the list (a direct child of `ledgr-list`), and, with a key, an entry of the cursor: Enter
  // runs `enter` (what its click does), Space `space` (a pin's checkbox). A key drawn twice (a child
  // question under its ask and in its own lane) is an entry once, where it is first drawn.
  put(out, el, key = null, enter = null, space = null) {
    if (key && !this.entrySeen.has(key)) { this.entrySeen.add(key); this.entries.push({ key, index: out.length, enter, space }); }
    out.push(el);
  }

  // The cursor row or line, drawn as such only while the list itself has the keyboard.
  isCur(key) { return this.listFocused === true && this.cursor === key; }

  focusList() { try { this.keys.focus(); } catch { /* no keyboard: clicks still work */ } }

  // Brings an entry into view with only the scroll needed (a visible one stays where it is).
  reveal(key) {
    const e = key ? this.entries.find((x) => x.key === key) : null;
    if (e) try { this.listScroll.scroll_to_item(e.index); } catch { /* not laid out yet */ }
  }

  // After the list is built: the cursor a closed dialog asked for (when its row is listed), then
  // keepPlace (a row that left hands the cursor to the entry that followed it). A moved cursor is
  // revealed and drawn at the next frame.
  settleCursor(cx) {
    const keys = this.entries.map((e) => e.key);
    let want = this.cursor;
    if (this.pendingCursor && keys.includes(this.pendingCursor)) want = this.pendingCursor;
    this.pendingCursor = null;
    const next = keepPlace(this.entryKeys, keys, want);
    this.entryKeys = keys;
    if (next === this.cursor) return;
    this.cursor = next;
    this.reveal(next);
    cx.timer.after(0, (cx) => cx.notify());
  }

  // The root's keys (1.6). ↑ ↓ and PageUp/PageDown also come up from the pins search box; Home, End,
  // Enter, Space and Esc only while the list itself has the keyboard (typing a space in the box never
  // checks a pin). An open menu keeps its own keys.
  onKey(e, cx) {
    const k = String(e?.keystroke ?? "");
    if (!LIST_KEYS.has(k) || this.dd) return;
    let mine = false;
    try { mine = this.keys.is_focused(); } catch { /* none */ }
    if (!mine && !NAV_KEYS.has(k)) return;
    cx.stop_propagation();
    this.listKey(k, cx);
    cx.notify();
  }

  listKey(k, cx) {
    if (k === "escape") { this.cursor = null; return; }
    const delta = { up: -1, down: 1, pageup: -8, pagedown: 8, home: "home", end: "end" }[k];
    if (delta !== undefined) { this.cursor = moveCursor(this.entries.map((e) => e.key), this.cursor, delta); this.reveal(this.cursor); return; }
    const e = this.entries.find((x) => x.key === this.cursor);
    if (k === "enter") e?.enter?.(cx);
    else if (k === "space") e?.space?.(cx);
  }

  // ledgr.focus-list: the list takes the keyboard, the cursor on its first row.
  focusFirst() {
    this.focusList();
    const first = this.entries.find((e) => /^(item|pin|branch):/.test(e.key)) ?? this.entries[0] ?? null;
    this.cursor = first?.key ?? null;
    this.reveal(this.cursor);
  }

  // Enter in the pins search box: the cursor's pin opens, else the first result.
  searchSubmit(cx) {
    const e = this.entries.find((x) => x.key === this.cursor && x.key.startsWith("pin:")) ?? this.entries.find((x) => x.key.startsWith("pin:"));
    e?.enter?.(cx);
  }

  // Whether the detail dialog is open on that item, pin or branch (its commands are then the dialog's).
  detailOn(id) { return Boolean(id) && shared("ledgr.detail")?.open?.id === id; }

  // The detail dialog (detail.js, its own copy of ledgr) on one item, pin or branch (1.8); the open one,
  // if any, is closed first. o.open: a state the dialog applies once after it loads (detailing.js
  // OPEN_STATES). A pin in the selection carries the whole selection (props.sel). From a handler or a
  // timer, never from render. The demo dialog builds its own demo store.
  openDetail(kind, id, sid, o = {}, cx) {
    const st = this.viewStore();
    this.closeDetail();
    const sel = kind === "pin" && this.pinSel.has(id) ? this.selPins(st).map((p) => p.id) : [];
    this.detailId = openOverlay(detailSpec({ session: sid, kind, id, open: o.open ?? null, sel, opener: this.panelId, demo: this.demo }));
    this.cursor = entryKey(kind, id);
    this.reveal(this.cursor);
    this.flash = "";
    cx?.notify();
  }

  // Closes the dialog this copy opened and the one shared("ledgr.detail") says is open (closing a gone
  // overlay is harmless). Their closed records then move no cursor and no keyboard.
  closeDetail() {
    const open = shared("ledgr.detail")?.open?.overlay ?? null;
    for (const id of new Set([this.detailId, open].filter(Boolean))) {
      if (this.replaced.size > 50) this.replaced.clear();
      this.replaced.add(id);
      try { closeOverlay(id); } catch { /* already gone */ }
    }
    this.detailId = null;
  }

  // The settings dialog (settings.js, its own copy of ledgr), from the header's gear or ledgr.settings. One
  // dialog at a time: whatever shared("ledgr.detail") says is open (a detail dialog, or settings already) is
  // closed first, and its closed record comes back here as a detail dialog's does (the panel's status line
  // shows its last words; after Esc the list takes the keyboard). From a handler, never from render.
  openSettings(demo, cx) {
    this.closeDetail();
    this.detailId = openOverlay(settingsSpec({ opener: this.panelId, demo: demo === true }));
    this.flash = "";
    cx?.notify();
  }

  // What the dialog left in shared("ledgr.detail") (1.9): the row whose dialog is open is drawn raised;
  // a closed record newer than the last one handled brings its typed answers to the rows (every one),
  // and, for a dialog this copy opened, its last words to the status line, the cursor to its row, and
  // the keyboard: back to the list ("list": after Herdr hands it to the focused terminal), into the pane
  // a message was pasted into ("pane", when it is live), or left where a click outside put it (null).
  noteDetail(cx) {
    const d = shared("ledgr.detail");
    const open = d?.open && typeof d.open === "object" ? d.open : null;
    this.openKey = open?.id ? entryKey(open.kind, open.id) : null;
    const c = d?.closed && typeof d.closed === "object" ? d.closed : null;
    const at = Number(c?.at) || 0;
    if (!c || at <= this.closedAt) return;
    this.closedAt = at;
    if (!this.demo && c.drafts && typeof c.drafts === "object") {
      let n = 0;
      for (const [id, text] of Object.entries(c.drafts)) if (typeof text === "string") { this.drafts.set(id, { text, sent: true, seq: 0 }); n++; }
      if (n) { this.overlayLocal(); this.bump(); }
    }
    if (c.opener !== this.panelId || this.replaced.has(c.overlay)) return;
    if (c.flash) this.flash = String(c.flash);
    if (c.id) this.pendingCursor = entryKey(c.kind, c.id);
    if (!this.detailId || c.overlay !== this.detailId) return;
    this.detailId = null;
    if (c.focus === "list") {
      cx.timer.after(30, (cx) => { this.focusList(); cx.notify(); });
      cx.timer.after(300, (cx) => { let has = false; try { has = this.keys.is_focused(); } catch { /* none */ } if (!has) { this.focusList(); cx.notify(); } });
    } else if (c.focus === "pane" && c.terminal && isLive(c.terminal)) {
      const terminal = c.terminal;
      cx.timer.after(30, () => run("pane.focus", { terminal }));
    }
  }

  // One row (1.2), its model from listing.js, its entry recorded: a click or Enter opens its dialog;
  // Space (and the checkbox) puts a pin in the selection.
  rowEntry(out, t, st, s, kind, x, o = {}) {
    const m = rowModel(kind, x, this.ctx);
    // A pin opens in the shown session (spec 1.8): a question built from it parks there, even from search.
    const sid = m.kind === "pin" ? s.sessionId : (m.sessionId ?? s.sessionId);
    // A second drawing of the same row (a child question also in its lane) is no entry: not the cursor.
    this.put(out, this.listRow(t, st, s, m, x, { ...o, dup: this.entrySeen.has(m.key) }), m.key, (cx) => this.openDetail(m.kind, m.id, sid, {}, cx),
      m.kind === "pin" ? () => this.togglePinSel(st, x) : null);
  }

  // The row: one line, h(26). A pin's checkbox; the glyph (a pin, a branch's icon or spinner); the handle
  // in words; one pill; the text's first line; the state word (left out when Paste answer is the
  // state); the quick actions: Done (hovered or cursor row), Promote (below the threshold), Paste
  // answer (an open ask whose answer is ready). The row whose dialog is open is raised; the cursor row
  // is `selected` with an accent edge. At the 280 px minimum the text keeps ROW.textMinW and the state
  // word, capped at ROW.stateMaxW, truncates first. `o.child`: a question about the ask above it
  // (indented); `o.inert`: a ghost.
  listRow(t, st, s, m, x, o = {}) {
    const inert = Boolean(o.inert), isItem = m.kind === "ask" || m.kind === "question";
    // A second drawing of a row (a child question also in its lane) gets an id of its own.
    const domId = `${m.kind === "pin" ? "pin" : m.kind === "branch" ? "br" : "row"}-${m.id}${o.dup ? "-dup" : ""}`;
    const cur = !inert && !o.dup && this.isCur(m.key), open = !inert && this.openKey === m.key, hov = !inert && this.hoverKey === m.key;
    const f = inert || !isItem ? null : this.fxOf(m.id);
    const closed = isItem && isClosed(x);
    const sug = m.kind === "ask" && isSuggestion(x, st.threshold);
    const dimmed = m.kind === "ask" && x.origin === "extract_model" && this.cfg.extract?.mode === "always-model";
    const tone = (n) => t[n] ?? t.muted;
    const [ch, gt, icon] = m.glyph;
    const glyph = div().w(t.ts(12)).flex_none().flex().items_center().text_size(t.ts(11)).text_color(tone(gt))
      .child(icon === "spinner" ? svg(ICON("spinner")).size(11).text_color(t.working).when(this.animOn(), (y) => y.spin(900))
        : icon ? svg(ICON(icon)).size(11).text_color(tone(gt)) : ch);
    const quick = [];
    if (!inert && isItem) {
      const L = stageLabels(this.pasteOn()), ses = st.d.sessions[x.anchor?.sessionId] ?? s;
      if (m.quick.done && (hov || cur)) quick.push(this.quickBtn(t, `qdone-${m.id}`, "Done", DONE_TIP, (cx) => this.act(m.id, "resolve", null, cx)));
      if (m.quick.promote) quick.push(this.quickBtn(t, `promote-${m.id}`, "Promote", "Make it an open ask: it leaves the below-threshold line and counts on the chip",
        (cx) => this.act(m.id, "promote", null, cx)));
      if (m.quick.paste) quick.push(this.quickBtn(t, `qpaste-${m.id}`, L.quick,
        `${H(x)}'s answer alone: ${this.pasteOn() ? `pasted into the prompt in ${P(ses?.terminal, "the pane")}, never sent` : `clipboard + focus ${P(ses?.terminal, "the pane")}`}`,
        (cx) => this.copyAnswer(x, ses, cx), true));
    }
    // Motion: entering, the row fades in from 6 px above (staggered when several arrive) under a
    // highlight (blocked colour for a blocking ask, else accent); answered, a `done` highlight. The
    // pointer passing over records the row's height, so a row closed by a click can collapse from it.
    const glowColor = f?.kind === "answered" ? t.done + "2e" : isBlocking(x) ? t.blocked + "2e" : t.accent + "26";
    const ease = (ms) => ({ duration: ms, delay: (f?.k ?? 0) * 45, easing: "ease-out" });
    return h_flex().id(domId).flex_none().relative().h(t.ts(26)).px(6).gap(6).items_center().rounded(6)
      .when(Boolean(o.child), (el) => el.ml(IND).border_l(1.5).border_color(t.input))
      .when(open, (el) => el.bg(t.raised))
      .when(cur, (el) => el.bg(t.selected).border_l(2).border_color(t.accent))
      .when(!inert && !open && !cur, (el) => el.hover((y) => y.bg(t.hover)))
      .when(Boolean(m.tip), (el) => el.tooltip(m.tip))
      .when(!inert, (el) => el.cursor_pointer()
        .on_click((_e, cx) => { this.focusList(); this.openDetail(m.kind, m.id, m.kind === "pin" ? s.sessionId : (m.sessionId ?? s.sessionId), {}, cx); })
        .on_hover((on, cx) => this.hoverRow(m.key, on, cx)))
      .when(!inert && isItem && this.animOn(), (el) => el.on_mouse_move((e) => { const h = e?.bounds?.height; if (h > 0) this.rowH.set(m.id, { h, at: Date.now() }); }))
      .when(f?.kind === "enter", (el) => el.opacity(f.phase ? 1 : 0).top(f.phase ? 0 : -6).transition("opacity", ease(200)).transition("top", ease(260)))
      .when(Boolean(f), (el) => el.child(this.glow(`glow-${m.id}`, glowColor, f, 6)))
      .when(m.kind === "pin" && !inert, (el) => el.child(this.pinCheck(t, st, x, m.key)))
      .child(glyph)
      .child(div().flex_none().font_semibold().text_size(t.ts(11.5)).text_color(t.muted).child(m.handle))
      .when(Boolean(m.pill), (el) => el.child(div().flex_none().px(5).rounded(4).bg(tone(m.pill.tone) + "22").text_size(t.ts(10)).text_color(tone(m.pill.tone)).child(m.pill.text)))
      .child(div().flex_1().min_w(ROW.textMinW).truncate().text_size(t.ts(12.5))
        .text_color(m.kind === "branch" || closed ? t.dim : dimmed || sug ? t.muted : t.foreground)
        .when(isItem && x.status === "dismissed", (y) => y.line_through()).child(m.text || " "))
      .when(inert || !m.quick.paste, (el) => el.child(div().flex_shrink_1().min_w(0).max_w(ROW.stateMaxW).truncate().text_size(t.ts(10.5)).text_color(tone(m.state.tone)).child(m.state.word)))
      .children(quick);
  }

  // A row's quick action: a small bordered button whose click never opens the dialog.
  quickBtn(t, id, label, tip, fn, strong = false) {
    return div().id(id).flex_none().h(t.ts(18)).px(5).flex().items_center().rounded(5).border_1()
      .border_color(strong ? t.accent : t.border).bg(t.background).text_size(t.ts(10.5)).text_color(strong ? t.accent : t.foreground)
      .cursor_pointer().hover((y) => y.bg(t.hover)).tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); })
      .child(label ?? "");
  }

  // The hovered row (its Done shows); a render only when it changes.
  hoverRow(key, on, cx) {
    const next = on ? key : this.hoverKey === key ? null : this.hoverKey;
    if (next === this.hoverKey) return;
    this.hoverKey = next;
    cx.notify();
  }

  // A small menu under a trigger: gpui-base's Popup (a choice, a press outside or Esc closes it).
  // One open at a time (this.dd); a choice, a press outside or Esc closes it. Items are
  // [id, label, fn, {tip, disabled, danger, hint}]; o.small draws a quiet trigger for a lane head.
  menuButton(t, key, label, items, o = {}) {
    const open = this.dd === key;
    const trigger = div().id(`ddt-${key}`).flex_none().flex().items_center().rounded(o.small ? 5 : 6).cursor_pointer()
      .when(o.small, (el) => el.h(t.ts(18)).px(5).text_size(t.ts(10.5)).text_color(open ? t.foreground : t.dim).hover((x) => x.bg(t.hover).text_color(t.foreground)))
      .when(!o.small, (el) => el.h(t.ts(22)).px(7).border_1().border_color(open ? t.accent : t.border).bg(t.background).text_size(t.ts(11)).text_color(t.foreground).hover((x) => x.opacity(0.85)))
      .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        const justShut = this.ddShut?.key === key && Date.now() - this.ddShut.at < 300;
        this.dd = open || justShut ? null : key;
        this.ddShut = null;
        if (this.dd) cx.timer.after(30, () => { try { this.ddFocus.focus(); } catch { /* no keyboard: clicks still work */ } });
        cx.notify();
      })
      .child(label);
    const list = v_flex().id(`ddl-${key}`).min_w(o.width ?? 190).p(4).gap(1).rounded(8).border_1().border_color(t.border).bg(t.popover ?? t.surface).shadow_md()
      .text_color(t.foreground)
      .track_focus(this.ddFocus)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.dd = null; cx.stop_propagation(); cx.notify(); } })
      .on_mouse_down_out((_e, cx) => { if (this.dd === key) { this.dd = null; this.ddShut = { key, at: Date.now() }; cx.notify(); } })
      .children(items.filter(Boolean).map(([id, text, fn, io = {}]) => h_flex().id(`ddi-${key}-${id}`).h(t.ts(26)).px(8).gap(8).items_center().rounded(5).text_size(t.ts(11.5))
        .text_color(io.disabled ? t.dim : io.danger ? t.blocked : t.foreground)
        .when(Boolean(io.tip), (el) => el.tooltip(io.tip))
        .when(!io.disabled, (el) => el.cursor_pointer().hover((x) => x.bg(t.hover))
          .on_click((e, cx) => { cx.stop_propagation(); this.dd = null; fn(e, cx); cx.notify(); }))
        .child(div().flex_1().min_w(0).child(text))
        .when(Boolean(io.hint), (el) => el.child(div().flex_none().text_size(t.ts(10.5)).text_color(t.dim).child(io.hint)))));
    return Popup.new(`ddp-${key}`, trigger).anchor(o.anchor ?? "top_left").when(open, (el) => el.content(list));
  }

  // The ASKED OF YOU threshold: written to ledgr-data/config.json (extract.threshold) through Reader
  // saveConfig (reader.js editConfig, the compare-and-swap writer the settings dialog uses too); the
  // writer watches the file (chips) and this panel re-reads it. Not a motion: rows just move. The demo
  // keeps it in memory.
  setThreshold(level, cx) {
    if (!LEVELS.includes(level)) return;
    this.cfg = { ...this.cfg, extract: { ...(this.cfg.extract ?? {}), threshold: level } };
    this.prevCls = null;
    this.obsVer = undefined;
    if (this.demo) { this.flash = `(demo) Threshold: ${TH_WORDS[level]}; not saved.`; cx.notify(); return; }
    this.saveConfig((d) => { d.extract = { ...obj(d.extract), threshold: level }; },
      `Threshold: ${TH_WORDS[level]} (extract.threshold "${level}" in ledgr-data/config.json).`, "Threshold not saved", cx);
  }

  // ── spaces where ledgr is off (config.json spaces.disabled) ──────────
  // A session's space: as the hooks recorded it, else live from Herdr (config.js terminalSpace).
  sessionSpace(st, s) { return s ? st.spaceOf(s.terminal, s, terminalSpace) : null; }

  // A space as the person reads it: its name from spaces() (names change; the id is the key).
  spaceName(id) {
    if (!id) return "this space";
    try { const sp = spaces().find((x) => x.id === id); if (sp?.name) return sp.name; } catch { /* none */ }
    return `space ${String(id).slice(0, 10)}`;
  }

  // What the panel shows instead of lanes ({space, here}), or null: the shown session's space is off;
  // else, unless that session was picked (held, or from the session menu), the focused pane's space
  // is off. `here`: the off space is the focused pane's.
  offState(st, s) {
    if (this.demo) return this.demoOff ? { space: null, here: true } : null;
    const fsp = focused()?.space ?? null;
    if (s) {
      const sp = this.sessionSpace(st, s);
      if (spaceOff(this.cfg, sp)) return { space: sp, here: !fsp || sp === fsp };
      if (this.held === s.sessionId || this.override?.sid === s.sessionId) return null;
    }
    return spaceOff(this.cfg, fsp) ? { space: fsp, here: true } : null;
  }

  // The session menu's switch and the off state's button: spaces.disabled in ledgr-data/config.json,
  // the same compare-and-swap as the threshold. The writer follows the file (no chip there), the hooks
  // read it at every run (no instruction, no extraction), this panel re-reads it. Demo: memory only.
  setSpaceOff(space, off, cx) {
    if (this.demo) { this.demoOff = off; this.flash = `(demo) ${off ? OFF_HERE : "ledgr is on in this space again"}; not saved.`; cx.notify(); return; }
    if (!space) { this.flash = "No space to switch: Herdr names no focused space."; cx.notify(); return; }
    const name = this.spaceName(space);
    this.cfg = { ...this.cfg, spaces: { ...obj(this.cfg.spaces), disabled: withSpaceOff(this.cfg, space, off) } };
    this.prevCls = null;
    this.obsVer = undefined;
    const ok = off ? `ledgr is off in ${name}: no chips, no ⌘J, no instruction or extraction for its agents. Their items are kept; the session menu turns it on again.`
      : `ledgr is on in ${name} again.`;
    this.saveConfig((d) => { d.spaces = { ...obj(d.spaces), disabled: withSpaceOff(d, space, off) }; }, ok, "Not saved", cx);
  }

  // ── Clear all questions ──────────────────────────────────────────────
  // The YOUR QUESTIONS head's Clear N: every open or deferred parked question of the shown session that
  // has no branch goes to Closed by one `clear_questions` event (store.js on_clear_questions); branched
  // and rejoin_pending ones stay. Two clicks: the first arms it for CLEAR_ARM_MS ("Clear 3 questions? 1
  // branched kept"), the second sends it; "Clearing…" until store.json has it. Reopen works per item.
  clearQuestions(s, cx) {
    const st = this.viewStore(), now = Date.now();
    const { clear, kept } = st.clearable(s.sessionId);
    if (!clear.length) { this.clearAsk = null; this.flash = "No open or deferred parked question to clear in this session."; cx.notify(); return; }
    const armed = this.clearAsk?.sid === s.sessionId && now - this.clearAsk.at < CLEAR_ARM_MS;
    if (!armed) {
      const ask = this.clearAsk = { sid: s.sessionId, at: now };
      cx.timer.after(CLEAR_ARM_MS + 50, (cx) => { if (this.clearAsk === ask) { this.clearAsk = null; cx.notify(); } });
      cx.notify();
      return;
    }
    this.clearAsk = null;
    const words = clearedWords(clear.length, kept.length);
    if (this.demo) { st.on_clear_questions({}, st.d.sessions[s.sessionId], now); this.bump(); this.flash = `(demo) ${words}; not saved.`; cx.notify(); return; }
    const evId = this.post("clear_questions", { session_id: s.sessionId, keep: ["branched", "rejoin_pending"] }, { action: "clear_questions", sid: s.sessionId }, cx);
    this.clearing = { sid: s.sessionId, evId, at: now, n: clear.length };
    this.flash = words;
    cx.notify();
  }

  // The Clear control for the lane head: idle "Clear N", armed "Clear N questions? M branched kept",
  // pending "Clearing N…"; null when nothing is clearable.
  clearButton(t, st, s) {
    const now = Date.now(), c = this.clearing;
    if (c && c.sid === s.sessionId && now - c.at < 15000 && !st.d.ingested.includes(c.evId)) {
      return div().id("clear-q").flex_none().h(t.ts(18)).px(5).flex().items_center().rounded(5).text_size(t.ts(10.5)).text_color(t.dim).child(`Clearing ${c.n}…`);
    }
    const { clear, kept } = st.clearable(s.sessionId);
    if (!clear.length) return null;
    const armed = this.clearAsk?.sid === s.sessionId && now - this.clearAsk.at < CLEAR_ARM_MS;
    return div().id("clear-q").flex_none().h(t.ts(18)).px(5).flex().items_center().rounded(5).text_size(t.ts(10.5)).cursor_pointer()
      .when(armed, (el) => el.font_semibold().bg(t.blocked + "26").text_color(t.blocked))
      .when(!armed, (el) => el.text_color(t.dim).hover((x) => x.bg(t.hover).text_color(t.foreground)))
      .tooltip(armed ? "Click again to clear them; each one can be reopened from closed"
        : `Close the ${clear.length} open or deferred parked question${clear.length === 1 ? "" : "s"} of this session${kept.length ? `; ${kept.length} with a branch stay` : ""}. Reopen any from closed.`)
      .on_click((_e, cx) => { cx.stop_propagation(); this.clearQuestions(s, cx); })
      .child(armed ? clearConfirm(clear.length, kept.length) : clearLabel(clear.length));
  }

  // ── pins (docs/design/Pins.md 4) ─────────────────────────────────────
  // The PINS lane: its head (fold, search box, "N pins"), the selection bar while anything is
  // selected, then the shown session's open pins (five, then "N more"), "archived (N)", or, while a
  // query is typed, the search results of every session instead. One line per pin: a click (or Enter)
  // opens it in the detail dialog; its checkbox (or Space) puts it in the selection.
  pinsLane(out, t, st, s) {
    const open = !this.collapsed.pins;
    const mine = st.pinsIn(s.sessionId);
    const tog = (o) => this.setCollapsed("pins", !o);
    this.put(out, this.laneHead(t, "pins", "PINS", mine.length, open, tog, null, null, this.pinSearchBox(t), null, pinsWords, true),
      "lane:pins", () => tog(this.collapsed.pins));
    if (this.selPins(st).length) this.put(out, this.pinSelBar(t, st, s));
    if (!open) return;
    const q = this.pinQuery.trim();
    if (q) { this.pinResults(out, t, st, s, q); return; }
    for (const p of this.pinsMore ? mine : mine.slice(0, PINS_SHOWN)) this.rowEntry(out, t, st, s, "pin", p);
    if (!mine.length) this.put(out, div().px(6).py(3).text_size(t.ts(11.5)).text_color(t.dim).child(PINS_EMPTY));
    if (mine.length > PINS_SHOWN) this.pinFoldLine(out, t, "pins-more", "more:pins", this.pinsMore ? "fewer ‹" : `${mine.length - PINS_SHOWN} more ›`, () => { this.pinsMore = !this.pinsMore; });
    const arch = st.pinsIn(s.sessionId, { archived: true });
    if (arch.length) {
      this.pinFoldLine(out, t, "pins-arch", "arch:pins", `archived (${arch.length}) ${this.pinsArch ? "▾" : "›"}`, () => { this.pinsArch = !this.pinsArch; });
      if (this.pinsArch) for (const p of arch) this.rowEntry(out, t, st, s, "pin", p);
    }
  }

  pinFoldLine(out, t, id, key, label, fn) {
    this.put(out, div().id(id).flex_none().px(6).py(2).text_size(t.ts(11)).text_color(t.dim).cursor_pointer().rounded(5)
      .when(this.isCur(key), (el) => el.bg(t.selected))
      .hover((x) => x.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { this.focusList(); fn(); cx.notify(); }).child(label), key, () => fn());
  }

  // The search box in the lane head: typing filters at once (the store is in memory; nothing is read or
  // posted). A click in it does not fold the lane; Esc clears the query.
  pinSearchBox(t) {
    return h_flex().id("pins-search").flex_1().min_w(80).h(t.ts(20)).px(5).gap(4).items_center().rounded(5).border_1().border_color(t.input).bg(t.background)
      .on_click((_e, cx) => cx.stop_propagation())
      .on_key_down((e, cx) => { if (e.key === "escape" && this.pinQuery) { this.setPinQuery(""); cx.stop_propagation(); cx.notify(); } })
      .child(svg(ICON("search")).size(10).flex_none().text_color(t.dim))
      .child(Input.new(this.pinSearch).flex_1().h_full().text_size(t.ts(11)).text_color(t.foreground));
  }

  setPinQuery(q) {
    this.pinQuery = String(q ?? "");
    try { this.pinSearch.set_value(this.pinQuery); } catch { /* the box follows at its next change */ }
  }

  // The selection, as pins that still exist, in pin creation order.
  selPins(st) {
    return [...this.pinSel].map((id) => st.pin(id)).filter(Boolean).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  togglePinSel(st, p) {
    if (this.pinSel.has(p.id)) { this.pinSel.delete(p.id); return; }
    if (this.selPins(st).length >= LIMITS.pinsPerQuestion) { this.flash = `A question carries at most ${LIMITS.pinsPerQuestion} pins: ${handleWords(p.handle)} was not added.`; return; }
    this.pinSel.add(p.id);
  }

  // "3 selected · Ask about these 3 pins… · clear".
  pinSelBar(t, st, s) {
    const n = this.selPins(st).length;
    return h_flex().id("pins-sel").flex_none().flex_wrap().px(6).gap(8).items_center()
      .child(div().flex_none().text_size(t.ts(11)).text_color(t.accent).child(pinsSelectedWords(n)))
      .child(this.btn(t, "pins-ask", askAboutPinsWords(n), (_e, cx) => this.askAboutSelection(st, s, cx),
        { primary: true, tip: `Opens the capture box: the question you type there is parked here with the ${pinsWords(n)} as its context` }))
      .child(div().id("pins-sel-x").flex_none().px(4).rounded(4).text_size(t.ts(10.5)).text_color(t.dim).cursor_pointer()
        .hover((x) => x.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { this.pinSel.clear(); cx.notify(); }).child("clear"));
  }

  // While a query is typed: every session's matches (store.js searchPins), grouped by session, the
  // shown one first; two toggles (archived too, this session only) and the count. The results are pin
  // rows like the lane's; a group head's Enter is its "open session".
  pinResults(out, t, st, s, q) {
    const scope = this.pinHereOnly ? "here" : "all";
    const r = st.searchPins(q, { here: s.sessionId, scope, archived: this.pinArchToo, limit: LIMITS.pinSearch });
    const tog = (id, label, on, fn) => div().id(id).flex_none().px(5).rounded(4).text_size(t.ts(10.5)).cursor_pointer()
      .when(on, (x) => x.bg(t.accent + "22").text_color(t.accent)).when(!on, (x) => x.text_color(t.dim).hover((y) => y.bg(t.hover)))
      .on_click((_e, cx) => { fn(); cx.notify(); }).child(label);
    const shown = r.groups.reduce((n, g) => n + g.pins.length, 0);
    this.put(out, h_flex().id("pins-found").flex_none().flex_wrap().px(6).gap(6).items_center()
      .child(div().flex_1().min_w(0).text_size(t.ts(10.5)).text_color(t.dim).child(r.total > shown ? `first ${shown} of ${r.total}` : `${r.total} match${r.total === 1 ? "" : "es"}`))
      .child(tog("pins-arch-too", "archived too", this.pinArchToo, () => { this.pinArchToo = !this.pinArchToo; }))
      .child(tog("pins-here-only", "this session only", this.pinHereOnly, () => { this.pinHereOnly = !this.pinHereOnly; })));
    if (!r.total) {
      const n = scope === "here" ? 1 : new Set(st.pins().filter((p) => p.status === "open" || (this.pinArchToo && p.status === "archived")).map((p) => p.sessionId)).size;
      this.put(out, div().px(6).py(3).text_size(t.ts(11.5)).text_color(t.dim).child(pinsSearchEmpty(q, n)));
    }
    for (const g of r.groups) {
      const x = st.d.sessions[g.sessionId] ?? null, here = g.sessionId === s.sessionId;
      this.put(out, this.pinGroupHead(t, st, s, g), `pgroup:${g.sessionId}`, () => { if (x && !here) this.showSession(g.sessionId); });
      for (const p of g.pins) this.rowEntry(out, t, st, s, "pin", p);
    }
  }

  // A search group's head: the session's name and agent label, "forgotten" when it is gone (the pins'
  // own `source` names it), and "open session" (as the session menu's click; it clears the query).
  pinGroupHead(t, st, s, g) {
    const x = st.d.sessions[g.sessionId] ?? null, src = g.pins[0]?.source ?? {};
    const here = g.sessionId === s.sessionId;
    return h_flex().id(`pins-g-${g.sessionId}`).flex_none().px(6).pt(4).gap(6).items_center().rounded(5)
      .when(this.isCur(`pgroup:${g.sessionId}`), (el) => el.bg(t.selected))
      .child(this.pill(t, agentLabel(x?.agent ?? src.agent, x?.profile ?? src.profile)))
      .child(div().flex_1().min_w(0).truncate().text_size(t.ts(11)).font_semibold().text_color(t.muted)
        .child(`${sessionWords(x ?? { ...src, sessionId: g.sessionId })}${here ? " (this session)" : ""}`))
      .when(!x, (el) => el.child(div().flex_none().text_size(t.ts(10.5)).text_color(t.dim).child("forgotten")))
      .when(Boolean(x) && !here, (el) => el.child(div().id(`pins-go-${g.sessionId}`).flex_none().px(5).rounded(4).text_size(t.ts(10.5)).text_color(t.accent).cursor_pointer()
        .hover((y) => y.bg(t.hover)).tooltip("Show that session in the panel, as the session menu does")
        .on_click((_e, cx) => { cx.stop_propagation(); this.showSession(g.sessionId); cx.notify(); }).child("open session")));
  }

  // What a click in the session menu does: show that session (held: hold it instead); clears the query.
  showSession(sid) {
    this.menu = false;
    if (this.held) { this.held = sid; try { localStorage.setItem("pinned", sid); } catch { /* none */ } }
    else this.override = { sid, terminal: focused()?.terminal ?? null };
    this.setPinQuery("");
  }

  // A pin row's checkbox: in or out of the selection (any session; at most LIMITS.pinsPerQuestion). Its
  // click gives the list the keyboard with the cursor on that row, and never opens the dialog.
  pinCheck(t, st, p, key) {
    const on = this.pinSel.has(p.id);
    return div().id(`pinc-${p.id}`).w(t.ts(12)).h(t.ts(12)).flex_none().flex().items_center().justify_center().rounded(3).border_1()
      .border_color(on ? t.accent : t.border).bg(on ? t.accent : t.background).text_size(t.ts(9)).text_color(t.solid_foreground ?? t.background).cursor_pointer()
      .tooltip(on ? "In the selection: click to take it out" : `Add it to a question (${LIMITS.pinsPerQuestion} pins at most)`)
      .on_click((_e, cx) => { cx.stop_propagation(); this.focusList(); this.cursor = key; this.togglePinSel(st, p); cx.notify(); })
      .when(on, (x) => x.child("✓"));
  }

  // Ask about these… (the selection), Ask here… and Branch… (a pin row): the capture box in pins mode
  // (docs/design/Pins.md 3.4) for the shown session; the box composes nothing about pins but the labels
  // given here. `then` ("trunk", "branch" or null) comes back through shared("ledgr.focus") (runThen).
  openPinsBox(st, s, pins, then, cx) {
    const list = [...pins].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)).slice(0, LIMITS.pinsPerQuestion);
    if (!list.length) { this.flash = "No pins selected."; cx.notify(); return; }
    if (then === "branch" && !this.branchable(s)) { this.flash = "Branching needs a Claude Code session with the ledgr hooks."; cx.notify(); return; }
    if (this.demo) { this.flash = `(demo) Would open the capture box to ask about ${list.map((p) => pinNameWords(p, s.sessionId)).join(", ")}${then === "branch" ? ", then the Branch confirmation" : ""}.`; cx.notify(); return; }
    openOverlay({ mod: "ledgr", kind: "dialog", width: 600, height: 340,
      props: { view: "capture", session: s.sessionId, terminal: s.terminal, pins: list.map((p) => ({ id: p.id, label: pinLabel(p, s.sessionId) })), then: then ?? null } });
  }

  askAboutSelection(st, s, cx) {
    const sel = this.selPins(st);
    if (!sel.length) { this.flash = "No pins selected: check one or more in the PINS lane or in a search."; cx.notify(); return; }
    this.openPinsBox(st, s, sel, null, cx);
  }

  // A question parked from the box with `then` (Ask here…, Branch… on a pin): once it is in the store
  // (within pinning.js THEN_MS of the box's message), its dialog opens; "trunk" says how to send it,
  // "branch" opens the dialog on its Branch confirmation.
  runThen(st, cx) {
    const r = this.thenReq;
    if (thenStale(r)) { this.thenReq = null; return; }
    const it = st.item(r.item), s = it ? st.d.sessions[it.anchor?.sessionId] : null;
    if (!it || !s) return;
    this.thenReq = null;
    cx.timer.after(0, (cx) => {
      if (r.then === "branch") this.openDetail("question", it.id, s.sessionId, { open: "confirm" }, cx);
      else {
        this.openDetail("question", it.id, s.sessionId, {}, cx);
        const n = st.pinsOf(it).length || r.pins, L = stageLabels(this.pasteOn());
        this.flash = `${H(it)} parked with ${pinsWords(n)}. ${L.ask} ${this.pasteOn() ? "pastes it into the prompt" : "copies it and focuses the pane"}; nothing is sent.`;
      }
      cx.notify();
    });
  }

  pill(t, text, color) {
    return div().flex_none().px(5).py(0.5).rounded(4).border_1().border_color(t.border).text_size(t.ts(10)).text_color(color ?? t.muted).child(text);
  }

  header(t, st, s, off = null) {
    const away = !s ? this.away : null;
    const name = s ? sessionWords(s) : away ? (away.agent ? "no ledgr session yet" : "no agent here") : "no session";
    const held = Boolean(this.held && s && this.held === s.sessionId);
    return h_flex().h(t.ts(42)).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_semibold().text_size(t.ts(13)).child("ledgr"))
      .child(h_flex().id("lg-session").flex_1().min_w(0).h(t.ts(26)).px(6).gap(5).items_center().rounded(6).cursor_pointer()
        .hover((x) => x.bg(t.hover)).on_click((_e, cx) => { this.menu = !this.menu; cx.notify(); })
        .when(Boolean(s), (el) => el.child(div().id("lg-agent").flex_none().tooltip(this.asksTip(s)).child(this.pill(t, agentLabel(s.agent, s.profile)))))
        .when(Boolean(away?.agent), (el) => el.child(this.pill(t, away.name)))
        .when(Boolean(s?.parentSessionId), (el) => el.child(h_flex().id("lg-br-pill").flex_none().gap(3).px(5).py(0.5).rounded(4).items_center().bg(t.accent + "22")
          .tooltip(`Branch of ${st.d.sessions[s.parentSessionId]?.sessionName || String(s.parentSessionId).slice(0, 8)}${s.forkTurn !== undefined && s.forkTurn !== null ? `, forked at its turn ${s.forkTurn}` : ""}`)
          .child(svg(ICON("git-branch")).size(10).text_color(t.accent)).child(div().text_size(t.ts(10)).text_color(t.accent).child(`branch · depth ${s.depth ?? 1}`))))
        .child(div().flex_1().min_w(0).truncate().text_size(t.ts(12)).text_color(t.muted).child(name))
        .when(Boolean(s?.terminal || away), (el) => el.child(div().flex_none().text_size(t.ts(10.5)).text_color(t.dim).child(P(s?.terminal ?? away.terminal))))
        .child(svg(ICON(this.menu ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim)))
      // Held: an accent "held" pill, unmistakable. Following focus: a faint "hold". Text only: the pin
      // icon belongs to the PINS lane (docs/design/Pins.md 4.9).
      .when(Boolean(s), (el) => el.child(h_flex().id("lg-hold").h(t.ts(22)).flex_none().px(6).items_center().justify_center().rounded(6).cursor_pointer()
        .when(held, (x) => x.bg(t.accent + "26"))
        .when(!held, (x) => x.opacity(0.6))
        .tooltip(held ? "Held on this session; click to follow focus" : "Following the focused pane; click to hold this session")
        .hover((x) => x.bg(t.hover).opacity(1))
        .on_click((_e, cx) => {
          this.held = held ? null : s.sessionId;
          try { localStorage.setItem("pinned", this.held ?? ""); } catch { /* none */ }
          cx.notify();
        })
        .child(div().text_size(t.ts(10.5)).when(held, (x) => x.font_semibold()).text_color(held ? t.accent : t.dim).child(held ? "held" : "hold"))))
      .when(Boolean(s), (el) => el.child(div().flex_none().text_size(t.ts(11)).text_color(s.state === "working" ? t.working : t.dim)
        .child(`turn ${s.turn}${s.state === "working" ? " · working" : s.state === "ended" ? " · ended" : ""}`)))
      .when(Boolean(off), (el) => el.child(this.pill(t, "off", t.dim)))
      .when(this.demo, (el) => el.child(this.pill(t, "demo", t.accent)))
      // The settings dialog (text scale, threshold, closing list, the switches, branch depth, off spaces).
      .child(div().id("lg-settings").flex_none().w(t.ts(24)).h(t.ts(22)).flex().items_center().justify_center().rounded(6).cursor_pointer()
        .tooltip("Settings: text size, threshold, closing list, paste, motion, branch depth, off spaces")
        .hover((x) => x.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); this.openSettings(this.demo, cx); })
        .child(svg(ICON("settings")).size(13).text_color(t.dim)));
  }

  // How this session's agent declares or yields its asks (adapters.js): a tooltip line, then the
  // config folder the hooks recorded for it (the profile in "claude · work").
  asksTip(s) {
    const m = asksMode(adapterOf(this.adapters, s), this.cfg);
    const h = String(home() ?? ""), d = s?.configDir ? String(s.configDir) : "";
    const dir = d && h && d.startsWith(`${h}/`) ? `~${d.slice(h.length)}` : d;
    return `${m.word}: ${m.tip}${dir ? ` Config folder: ${dir} (profile ${s.profile ?? "unknown"}).` : ""}`;
  }

  // Branch sessions are listed under their parent, indented, not at the top level. Live sessions are
  // grouped by agent, each group headed by how that agent's asks arrive (declares asks, extractor
  // only, no asks). Sessions whose terminal is gone offer Forget (two clicks): the session, its items
  // and its branches go.
  sessionMenu(t, st, sid) {
    const list = st.sessionsList();
    const ids = new Set(list.map((s) => s.sessionId));
    const kids = new Map();
    for (const s of list) if (s.parentSessionId && ids.has(s.parentSessionId)) kids.set(s.parentSessionId, [...(kids.get(s.parentSessionId) ?? []), s]);
    const flat = (s, d) => [[s, d], ...(d < 6 ? (kids.get(s.sessionId) ?? []).flatMap((c) => flat(c, d + 1)) : [])];
    const roots = list.filter((s) => !(s.parentSessionId && ids.has(s.parentSessionId)));
    const groups = [];
    for (const s of roots.filter((x) => x.state !== "ended")) {
      const k = `${String(s.sessionId).startsWith("herdr:") ? "herdr:" : ""}${agentLabel(s.agent, s.profile)}`;
      let g = groups.find((x) => x.k === k);
      if (!g) groups.push(g = { k, s, rows: [] });
      g.rows.push(...flat(s, 0));
    }
    const groupHead = (g) => {
      const m = asksMode(adapterOf(this.adapters, g.s), this.cfg);
      return h_flex().id(`lg-g-${g.k}`).px(8).pt(6).pb(2).gap(6).items_center().tooltip(m.tip)
        .child(div().text_size(t.ts(10.5)).font_semibold().text_color(t.dim).child(`${agentLabel(g.s.agent, g.s.profile).toUpperCase()}${g.k.startsWith("herdr:") ? " (NO HOOKS)" : ""}`))
        .child(div().text_size(t.ts(10.5)).text_color(m.word === "declares asks" ? t.accent : t.dim).child(m.word));
    };
    const ended = roots.filter((s) => s.state === "ended").flatMap((s) => flat(s, 0));
    const row = ([s, depth]) => {
      const open = st.itemsOf(s.sessionId).filter((it) => st.counts(it)).length;
      const offThere = !this.demo && spaceOff(this.cfg, this.sessionSpace(st, s));
      const gone = !this.demo && !this.parentLive(s);
      const asking = this.forgetAsk === s.sessionId;
      return h_flex().id(`lg-s-${s.sessionId}`).h(t.ts(26)).pr(8).pl(8 + depth * 14).gap(6).items_center().rounded(6).cursor_pointer()
        .when(s.sessionId === sid, (el) => el.bg(t.selected)).hover((x) => x.bg(t.hover))
        .on_click((_e, cx) => {
          this.menu = false;
          if (this.held) { this.held = s.sessionId; try { localStorage.setItem("pinned", s.sessionId); } catch { /* none */ } }
          else this.override = { sid: s.sessionId, terminal: focused()?.terminal ?? null };
          cx.notify();
        })
        .when(depth > 0, (el) => el.child(svg(ICON("git-branch")).size(11).flex_none().text_color(t.accent)))
        .child(this.pill(t, agentLabel(s.agent, s.profile)))
        .child(div().flex_1().min_w(0).truncate().text_size(t.ts(12)).child(sessionWords(s)))
        .when(Boolean(s.terminal), (el) => el.child(div().flex_none().text_size(t.ts(10.5)).text_color(t.dim).child(P(s.terminal))))
        .child(div().flex_none().text_size(t.ts(11)).text_color(open && !offThere ? t.accent : t.dim).child(offThere ? "off" : open ? `${open} open` : gone ? "gone" : s.state))
        .when(gone && !asking, (el) => el.child(div().id(`lg-f-${s.sessionId}`).flex_none().px(5).rounded(4).text_size(t.ts(10.5)).text_color(t.dim)
          .hover((x) => x.bg(t.hover).text_color(t.foreground)).tooltip("Forget this session, its items and its branches")
          .on_click((_e, cx) => { cx.stop_propagation(); this.forgetAsk = s.sessionId; cx.notify(); }).child("forget")))
        .when(asking, (el) => el
          .child(div().id(`lg-fy-${s.sessionId}`).flex_none().px(5).rounded(4).text_size(t.ts(10.5)).bg(t.blocked + "26").text_color(t.blocked)
            .on_click((_e, cx) => { cx.stop_propagation(); this.forget(s, cx); this.menu = false; cx.notify(); }).child("forget + branches"))
          .child(div().id(`lg-fn-${s.sessionId}`).flex_none().px(5).rounded(4).text_size(t.ts(10.5)).text_color(t.dim)
            .on_click((_e, cx) => { cx.stop_propagation(); this.forgetAsk = null; cx.notify(); }).child("keep")));
    };
    const sw = this.spaceSwitch(t);
    return v_flex().flex_none().max_h(220).id("lg-menu").overflow_y_scrollbar().px(6).py(4).gap(1).border_b(1).border_color(t.border).bg(t.surface)
      .when(Boolean(sw), (el) => el.child(sw))
      .children(groups.flatMap((g) => [groupHead(g), ...g.rows.map(row)]))
      .when(ended.length > 0, (el) => el.child(div().px(8).pt(6).pb(2).text_size(t.ts(10.5)).font_semibold().text_color(t.dim).child("ENDED SESSIONS")))
      .children(ended.map(row))
      .when(!list.length, (el) => el.child(div().px(8).py(6).text_size(t.ts(11.5)).text_color(t.dim).child("No sessions yet.")));
  }

  // The focused pane has no ledgr session (current()): say so, and why it may not have one yet.
  awayState(t, away) {
    const line = (s) => div().text_size(t.ts(11.5)).text_color(t.dim).child(s);
    return away.agent
      ? v_flex().p(8).gap(6)
        .child(div().text_size(t.ts(12.5)).text_color(t.muted).child(`No ledgr session for ${P(away.terminal)} (${away.name}) yet.`))
        .child(line("It joins at its next prompt or turn end, when ledgr's hooks report it. ⌘J already parks a question for it."))
        .child(line("Still nothing after a turn? That agent may read another settings file than the one ledgr's hooks are in: a Claude Code started with its own CLAUDE_CONFIG_DIR (a second account, say) needs the three hook entries in that folder's settings.json: ./install.sh offers each Claude config folder it finds."))
        .child(line("The session menu (›) shows the others."))
      : v_flex().p(8).gap(6)
        .child(div().text_size(t.ts(12.5)).text_color(t.muted).child(`${P(away.terminal)} runs no agent ledgr knows.`))
        .child(line("Focus an agent's pane, or pick a session from the menu (›)."));
  }

  // The session menu's first row: ledgr off (or on) in the focused pane's space, by its name.
  spaceSwitch(t) {
    const fsp = this.demo ? null : focused()?.space ?? null;
    if (!fsp && !this.demo) return null;
    const isOff = this.demo ? this.demoOff : spaceOff(this.cfg, fsp), name = this.demo ? "demo space" : this.spaceName(fsp);
    return h_flex().id("lg-space").h(t.ts(26)).px(8).gap(6).items_center().rounded(6).cursor_pointer().hover((x) => x.bg(t.hover))
      .tooltip(isOff ? `Turn ledgr on again in ${name}: chips, ⌘J, the instruction and extraction come back, with the items kept`
        : `Turn ledgr off in ${name}: no chips, no ⌘J, no instruction or extraction for its agents; items are kept (ledgr-data/config.json spaces.disabled)`)
      .on_click((_e, cx) => { this.menu = false; this.setSpaceOff(fsp, !isOff, cx); })
      .child(div().flex_1().min_w(0).text_size(t.ts(12)).text_color(isOff ? t.accent : t.foreground).child(spaceToggleWords(isOff)))
      .child(div().flex_none().max_w(140).truncate().text_size(t.ts(10.5)).text_color(t.dim).child(name));
  }

  // ledgr is off where the panel looks (offState): the state, and the switch to turn it on.
  offView(t, off) {
    const line = (x) => div().text_size(t.ts(11.5)).text_color(t.dim).child(x);
    const name = this.spaceName(off.space);
    return v_flex().p(8).gap(6)
      .child(div().text_size(t.ts(12.5)).text_color(t.muted).child(off.here ? OFF_HERE : `ledgr is off in ${name}`))
      .child(line(`${off.here ? `In this space${off.space ? ` (${name})` : ""}` : `In ${name}`}: no chips, no ⌘J, and no ledgr instruction or extraction for the agents. Items recorded before are kept and show again when it is on.`))
      .child(h_flex().gap(6).items_center()
        .child(this.btn(t, "space-on", spaceToggleWords(true, off.here), (_e, cx) => this.setSpaceOff(off.space, false, cx),
          { primary: true, tip: `Take ${name} out of spaces.disabled in ledgr-data/config.json` })))
      .child(line("The session menu (›) has the same switch and the sessions in other spaces."));
  }

  emptyState(t) {
    const line = (s) => div().text_size(t.ts(11.5)).text_color(t.dim).child(s);
    return v_flex().p(8).gap(6)
      .child(div().text_size(t.ts(12.5)).text_color(t.muted).child("No ledgr sessions yet."))
      .child(line(this.liveText === null && !this.fallback()
        ? "ledgr-data/store.json does not exist yet: no writer has run. ⌘J still parks a question for any agent pane."
        : "Sessions appear when a Claude session with the ledgr hooks starts, prompts or stops."))
      .child(line("⌘J park a question · ⌘⇧J this panel · herdr-app do ledgr.demo shows sample data"));
  }

  // `note`: extraction running (spinner). `status`: a quiet word in the header, never a fold
  // (the asks lane says "agent working" while the turn runs).
  // `extra`: a control drawn before the count (the asks lane's threshold menu). `statusTip`: the
  // status word's tooltip (the asks lane: who owns the closing list, asks.handoff). `countWord`: how
  // the count reads ("N open" by default; the PINS lane's "N pins"); `grow`: the extra, not the title,
  // takes the free width (the PINS lane's search box). A click gives the list the keyboard; the cursor
  // on a lane head (`lane:<key>`) draws it `selected`, and Enter folds it as the click does.
  laneHead(t, key, title, count, open, onToggle, note, status, extra, statusTip, countWord = (n) => `${n} open`, grow = false) {
    return h_flex().id(`lane-${key}`).flex_none().h(t.ts(24)).px(4).mt(4).gap(6).items_center().rounded(5).cursor_pointer()
      .when(this.isCur(`lane:${key}`), (el) => el.bg(t.selected))
      .on_click((_e, cx) => { this.focusList(); onToggle(!open); cx.notify(); })
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
      .child(div().when(!grow, (x) => x.flex_1()).when(grow, (x) => x.flex_none()).text_size(t.ts(10.5)).font_semibold().text_color(t.dim).child(title))
      .when(Boolean(note), (el) => el.child(h_flex().flex_none().gap(4).items_center()
        .child(svg(ICON("spinner")).size(11).text_color(t.working).when(this.animOn(), (x) => x.spin(900)))
        .child(div().text_size(t.ts(10.5)).text_color(t.working).child(note))))
      .when(!note && Boolean(status), (el) => el.child(div().id(`lane-${key}-status`).flex_none().text_size(t.ts(10.5)).text_color(t.working).opacity(0.75)
        .when(Boolean(statusTip), (x) => x.tooltip(statusTip)).child(status)))
      .when(Boolean(extra), (el) => el.child(extra))
      .child(div().flex_none().text_size(t.ts(11)).text_color(count ? t.accent : t.dim).child(countWord(count)));
  }

  // The threshold control on the ASKED OF YOU head: which levels are open rows that count on the chip.
  thresholdMenu(t, st) {
    const th = st.threshold;
    const item = (lv) => [lv, TH_WORDS[lv], (_e, cx) => this.setThreshold(lv, cx), { hint: lv === th ? "✓" : "" }];
    return this.menuButton(t, "threshold", `${TH_WORDS[th]} ▾`, [item("blocking"), item("needed"), item("optional")],
      { small: true, anchor: "top_right", width: 170, tip: "Which asks are open rows and count on the chip; the rest wait below the threshold (saved to ledgr-data/config.json)" });
  }

  // The asks lane's fold belongs to the person: only a click (or ledgr.fold-asks) changes it, and it
  // is kept across reloads. ui.foldAsksWhileWorking: true restores the Phase 1 rule (folded while
  // the agent works, open at each stop; a click holds until the next stop).
  asksOpen(s) {
    if (this.cfg.ui?.foldAsksWhileWorking !== true) return !this.collapsed.asks;
    const m = this.asksManual;
    if (m && m.sid === s.sessionId && m.stopAt === (s.lastStopAt ?? 0)) return m.open;
    return s.state !== "working";
  }

  setAsksOpen(s, open) {
    if (this.cfg.ui?.foldAsksWhileWorking === true) this.asksManual = { sid: s.sessionId, stopAt: s.lastStopAt ?? 0, open };
    else this.setCollapsed("asks", !open);
  }

  setCollapsed(key, folded) {
    this.collapsed[key] = Boolean(folded);
    try { localStorage.setItem("lanes", JSON.stringify(this.collapsed)); } catch { /* memory only */ }
  }

  // The lanes (docs/design/Detail.md 1.5): every line is a direct child of `ledgr-list`, and every line a
  // click acts on is an entry of the keyboard cursor (put): lane heads, rows, fold lines, turn group
  // heads, a turn's sheet line, its error line and its "below threshold (N)" line.
  body(t, st, s) {
    const now = Date.now(), L = stageLabels(this.pasteOn());
    const items = st.itemsOf(s.sessionId);
    const stale = (it) => it.status === "open" && now - (it.updatedAt ?? 0) > DAY;
    const active = (it) => (it.status === "open" || it.status === "answered" || it.status === "rejoin_pending") && !stale(it);
    const asks = items.filter((it) => isAgentAsk(it) && active(it));
    const mine = items.filter((it) => isHuman(it) && active(it));
    // Rows that just left a lane are drawn in place for their fade (ghostRow), never counted.
    const gh = this.ghostItems(s.sessionId);
    const out = [];
    const put = (el, key, enter) => this.put(out, el, key, enter);
    const draw = (it, child = false) => (it.__ghost ? put(this.ghostRow(t, st, s, it)) : this.rowEntry(out, t, st, s, "item", it, { child }));
    const real = (list) => list.filter((it) => !it.__ghost);
    const rule = () => put(div().h(1).mx(4).my(6).bg(t.border));

    this.pinsLane(out, t, st, s);
    rule();
    const togMine = (open) => this.setCollapsed("mine", !open);
    put(this.laneHead(t, "mine", "YOUR QUESTIONS", mine.filter((it) => it.status === "open").length,
      !this.collapsed.mine, togMine, null, null, this.clearButton(t, st, s)), "lane:mine", () => togMine(this.collapsed.mine));
    if (!this.collapsed.mine) {
      const sorted = [...mine, ...gh.filter(isHuman)].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      for (const it of sorted) draw(it);
      if (!sorted.length) put(div().px(6).py(3).text_size(t.ts(11.5)).text_color(t.dim).child("No parked questions. ⌘J parks one, even mid-stream."));
      const brs = st.branchesOf(s.sessionId).filter((b) => this.branchVisible(b));
      if (brs.length) {
        const live = brs.filter((b) => !["refused", "failed", "closed", "ended", "nostart"].includes(this.branchLive(b))).length;
        put(h_flex().id("lane-branches").flex_none().h(t.ts(22)).px(6).mt(6).gap(6).items_center()
          .child(svg(ICON("git-branch")).size(11).flex_none().text_color(t.dim))
          .child(div().flex_1().text_size(t.ts(10.5)).font_semibold().text_color(t.dim).child("BRANCHES"))
          .child(div().flex_none().text_size(t.ts(11)).text_color(live ? t.accent : t.dim).child(`${live} live`)));
        for (const br of brs) this.rowEntry(out, t, st, s, "branch", br);
      }
    }

    rule();
    const pend = st.pendingTurn(s.sessionId);
    const asksOpen = this.asksOpen(s);
    const togAsks = (open) => this.setAsksOpen(s, open);
    put(this.laneHead(t, "asks", "ASKED OF YOU", asks.filter((it) => st.counts(it)).length, asksOpen, togAsks,
      pend !== null ? `extracting turn ${pend}` : null, s.state === "working" ? "agent working" : null, this.thresholdMenu(t, st),
      HANDOFF_WORDS[handoffOf(this.cfg)]), "lane:asks", () => togAsks(!this.asksOpen(s)));
    if (asksOpen) {
      const turnsRec = st.d.turns[s.sessionId] ?? {};
      const errTurns = Object.entries(turnsRec).filter(([n, r]) => r?.asks?.source === "error" && Number(n) >= s.turn - 10).map(([n]) => Number(n));
      const asksAll = [...asks, ...gh.filter(isAgentAsk)];
      const turns = [...new Set([...asksAll.map((it) => it.anchor.turn), ...errTurns])].sort((a, b) => b - a);
      const newest = turns[0];
      const th = st.threshold;
      for (const turn of turns) {
        const all = asksAll.filter((it) => it.anchor.turn === turn);
        // Blocking asks first, then the message's order; asks below the threshold fold at the bottom.
        const g = all.filter((it) => !isSuggestion(it, th))
          .sort((a, b) => (isBlocking(b) ? 1 : 0) - (isBlocking(a) ? 1 : 0) || (a.seq ?? 0) - (b.seq ?? 0));
        const sug = all.filter((it) => isSuggestion(it, th)).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        const k = `${s.sessionId}:${turn}`;
        const nOpen = real(g).filter((it) => it.status === "open").length;
        const nBlock = real(g).filter((it) => it.status === "open" && isBlocking(it)).length;
        // The newest group is open, and so is any group holding an open blocking ask (the agent waits
        // on it); a click of the person's wins over both (groupOpen, store.js).
        const open = groupOpen({ newest: turn === newest, blocking: nBlock, unfolded: this.unfolded.has(k), folded: this.folded.has(k) });
        const nAll = real(g).length, nSug = real(sug).length;
        const ti = st.turnInfo(s.sessionId, turn);
        if (!all.length) { if (ti?.asks?.source === "error") this.errorLine(out, t, s, turn, ti); continue; }
        const label = [
          nAll ? `${nAll} ask${nAll === 1 ? "" : "s"}${open ? "" : `, ${nOpen} open`}` : null,
          nSug && (!open || !nAll) ? `${nSug} below threshold` : null,
        ].filter(Boolean).join(" · ");
        const tog = () => { if (open) { this.unfolded.delete(k); this.folded.add(k); } else { this.folded.delete(k); this.unfolded.add(k); } };
        put(h_flex().id(`grp-${turn}`).flex_none().h(t.ts(24)).px(6).gap(6).items_center().rounded(5).cursor_pointer().hover((x) => x.bg(t.hover))
          .when(this.isCur(`group:${turn}`), (el) => el.bg(t.selected))
          .on_click((_e, cx) => { this.focusList(); tog(); cx.notify(); })
          .child(div().flex_1().text_size(t.ts(11)).text_color(t.muted).child(`turn ${turn} · ${label}`))
          // Folded by the person with a blocker inside: the blocker still shows, in its own colour.
          .when(!open && nBlock > 0, (el) => el.child(div().flex_none().text_size(t.ts(11)).font_semibold().text_color(t.blocked).child(`◆ ${nBlock} blocking`)))
          .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(10).flex_none().text_color(t.dim)), `group:${turn}`, () => tog());
        if (ti?.asks?.source === "error") this.errorLine(out, t, s, turn, ti);
        if (!open) continue;
        for (const it of g) {
          draw(it);
          for (const c of items.filter((c) => c.parentId === it.id && isHuman(c) && !isClosed(c))) draw(c, true);
        }
        if (real(g).some((it) => !isClosed(it)) || real(sug).some((it) => this.answerOf(it))) {
          const n = real([...g, ...sug]).filter((it) => it.status === "open" && this.answerOf(it)).length;
          const sheet = (cx) => { if (n > 0) this.copyAnswers(s, turn, cx); };
          put(h_flex().id(`sheet-${turn}`).flex_none().pl(6 + IND).pr(6).py(3).gap(8).items_center().rounded(5)
            .when(this.isCur(`sheet:${turn}`), (el) => el.bg(t.selected))
            .child(this.btn(t, `copy-${turn}`, L.sheet(n, s.terminal), (_e, cx) => sheet(cx),
              { primary: n > 0, disabled: n === 0, tip: n ? `The answer sheet for turn ${turn}: ${this.pasteOn() ? `pasted into the prompt in ${P(s.terminal, "the pane")} once it has the focus; never sent` : `clipboard + focus ${P(s.terminal, "the pane")}`}` : "Type an answer or pick an option on an ask first" }))
            .child(div().flex_1().min_w(0).text_size(t.ts(10.5)).text_color(t.dim).child(n ? L.how : "type an answer or pick an option first")), `sheet:${turn}`, sheet);
        }
        if (sug.length) this.suggestions(out, t, st, s, turn, sug);
      }
      if (!turns.length) put(div().px(6).py(3).text_size(t.ts(11.5)).text_color(t.dim).child("Nothing asked of you in this session."));
    }

    for (const [key, title, pick] of [
      ["older", "OLDER THAN A DAY", (it) => stale(it)],
      ["deferred", "DEFERRED", (it) => it.status === "deferred"],
      ["closed", "CLOSED", (it) => isClosed(it)],
    ]) {
      if (!this.folds[key]) continue;
      const list = items.filter(pick).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      rule();
      put(div().px(4).py(2).text_size(t.ts(10.5)).font_semibold().text_color(t.dim).child(`${title} (${list.length})`));
      for (const it of list) this.rowEntry(out, t, st, s, "item", it);
    }
    return out;
  }

  // Asks below the threshold: one folded line at the bottom of the turn group, "below threshold (N)";
  // open, each row offers Promote (one click: an open row that counts). Folded again on a click, per turn.
  suggestions(out, t, st, s, turn, sug) {
    const k = `${s.sessionId}:${turn}`;
    const open = this.sugOpen.has(k);
    const th = st.threshold;
    const f = this.fxOf(`sug:${k}`);   // a suggestion just arrived: the line lights up once
    const n = sug.filter((it) => !it.__ghost).length;
    const tog = () => { if (open) this.sugOpen.delete(k); else this.sugOpen.add(k); };
    this.put(out, h_flex().id(`sug-${turn}`).flex_none().h(t.ts(24)).px(6).gap(6).items_center().rounded(5).relative().cursor_pointer().hover((x) => x.bg(t.hover))
      .when(this.isCur(`sug:${turn}`), (el) => el.bg(t.selected))
      .tooltip(`Asks below the threshold (now ${TH_WORDS[th]}, set on the ASKED OF YOU head): kept, not counted on the chip`)
      .on_click((_e, cx) => { this.focusList(); tog(); cx.notify(); })
      .when(Boolean(f), (el) => el.child(this.glow(`sug-glow-${turn}`, t.accent + "26", f, 5)))
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(10).flex_none().text_color(t.dim))
      .child(div().flex_1().text_size(t.ts(11)).text_color(t.dim).child(`below threshold (${n})`)), `sug:${turn}`, () => tog());
    if (open) for (const it of sug) { if (it.__ghost) this.put(out, this.ghostRow(t, st, s, it)); else this.rowEntry(out, t, st, s, "item", it); }
  }

  // A turn whose asks were not extracted: why, and Retry (Enter on the line retries too).
  errorLine(out, t, s, turn, ti) {
    const r = ti.retry;
    const busyRetry = Boolean(r && (r.state === "requested" || r.state === "running") && Date.now() - (r.at ?? 0) < 60000);
    const why = r?.state === "failed" && r.note ? ` (retry: ${r.note})` : "";
    const retry = (cx) => { if (!busyRetry) this.retry(s, turn, cx); };
    this.put(out, h_flex().id(`errl-${turn}`).flex_none().px(6).py(3).gap(8).items_center().rounded(5)
      .when(this.isCur(`err:${turn}`), (el) => el.bg(t.selected))
      .child(div().id(`err-${turn}`).flex_1().min_w(0).text_size(t.ts(11)).text_color(t.dim).when(Boolean(ti.asks.errorDetail), (el) => el.tooltip(String(ti.asks.errorDetail)))
        .child(`asks not extracted for turn ${turn}${ti.asks.error ? `: ${ti.asks.error}` : ""}${why}`))
      .when(!this.demo, (el) => el.child(this.btn(t, `retry-${turn}`, busyRetry ? "Retrying…" : "Retry", (_e, cx) => retry(cx), { disabled: busyRetry }))), `err:${turn}`, retry);
  }

  footer(t, st, s) {
    const now = Date.now();
    const items = st.itemsOf(s.sessionId);
    const counts = {
      older: items.filter((it) => it.status === "open" && now - (it.updatedAt ?? 0) > DAY).length,
      deferred: items.filter((it) => it.status === "deferred").length,
      closed: items.filter(isClosed).length,
    };
    const fold = (key, label) => div().id(`fold-${key}`).px(5).py(1).rounded(5).cursor_pointer()
      .text_color(this.folds[key] ? t.foreground : t.dim).when(this.folds[key], (el) => el.bg(t.selected))
      .hover((x) => x.bg(t.hover)).on_click((_e, cx) => { this.folds[key] = !this.folds[key]; cx.notify(); })
      .child(`${label} (${counts[key]}) ${this.folds[key] ? "▾" : "›"}`);
    return h_flex().flex_none().h(t.ts(30)).px(8).gap(4).items_center().border_t(1).border_color(t.border).text_size(t.ts(11))
      .child(fold("older", "older than a day")).child(fold("deferred", "deferred")).child(fold("closed", "closed"));
  }

  btn(t, id, label, onClick, o = {}) {
    const off = Boolean(o.disabled);
    return div().id(id).flex_none().h(t.ts(22)).px(7).flex().items_center().rounded(6).border_1()
      .border_color(o.primary && !off ? t.solid : t.border).bg(o.primary && !off ? t.solid : t.background)
      .text_size(t.ts(11)).text_color(o.primary && !off ? t.solid_foreground : off ? t.dim : t.foreground)
      .when(off, (el) => el.opacity(0.5))
      .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
      .when(!off, (el) => el.cursor_pointer().hover((x) => x.opacity(0.85)).on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); }))
      .child(label);
  }
}
