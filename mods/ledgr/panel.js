// ledgr panel (spec 6): a layout block, props {view: "panel"}, by default a child of the right-hand
// `panel-body` stack (config.json ui.panel says where; config.js panelPlace).
// A reader: it loads ledgr-data/store.json and follows it with watchFolder. The writer (spool
// ingest, store.json, chips) runs in an always-shown host copy (writer.js: the ledgr host block, or
// an overlay's tab bar); every act here (resolve, defer, dismiss, reopen, draft, seen, retry) is
// posted as a spool event. Only when no host writer answers does this copy run a fallback Writer.
// localStorage holds UI prefs only.
// It follows the focused agent's session unless pinned; two lanes: asks of you (agent asks,
// grouped by turn) and your questions (parked human asks).
// Phase 2: "Branch…" on a parked question opens a confirmation with the context manifest; Launch
// posts a `branch` event and the writer starts the fork (branch.js, writer.js launchBranch). The
// branches of a session are listed under its questions with live status from Herdr, the manifest,
// Focus, and Conclude. The session menu nests branch sessions under their parent and offers Forget
// for sessions whose terminal is gone.
// Phase 3: Conclude opens an editor prefilled with the branch's ledgr-conclusion block (else its last
// message, else empty); "Send to trunk" puts the confluence message (confluence.js) on the clipboard,
// focuses the trunk's pane and posts `conclude` (branch concluded, question rejoin_pending). Nothing
// is typed: the person pastes, and the trunk's UserPromptSubmit hook reports the landing. After it
// lands, Close branch (two clicks) posts `close_branch` and the writer ends the branch terminal.
// "Copy answers" stages the answer sheet with its `ledgr answers <session>` marker line.
// Severity: asks below extract.threshold (config.json) sit in a folded "suggestions (N)" line at the
// bottom of their turn group, uncounted, each with Promote; blocking asks sort first with ◆ and a tag.
// Motion (ui.animations): only on state transitions, found by comparing the classes of the store's
// items before and after a change (observe): a row entering its lane fades and slides in under a
// highlight that decays over about a second; a row leaving (resolved, dismissed, deferred) fades,
// and collapses when its height is known; an answered ask glows in `done` and folds its details;
// a new suggestion lights its fold line. All of it native (`transition`): no timer redraws, and an
// idle panel does not render (ledgr.render-stats counts renders).
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView, Popup } from "gpui-base";
import { theme, props, shared, setShared, focused, layout, run, watchFolder, readTextFile, writeTextFile, openOverlay, agents, terminals, panes, exec, home } from "herdr";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { FORCE_DEMO, DEFAULTS, loadConfig, dataDir, turnPath, agentLabel, storePath, panelPlace, panelShown, liveHome } from "./config.js";
import { Store, isAgentAsk, isHuman, isClosed, levelOf, isSuggestion, isBlocking, thresholdOf, LEVELS } from "./store.js";
import { writeEvent } from "./spool.js";
import { Writer, writerClaim, engineDrift } from "./writer.js";
import { goToAnchor, stageText, busy, btwText } from "./nav.js";
import { demoData, FIXTURE_TURNS, DEMO_SESSION } from "./fixtures.js";
import { manifest, manifestLines, liveStatus, maxDepthOf, preamble, branchName, transcriptPathOf } from "./branch.js";
import { itemWords as H, paneWords as P, trunkWords, originWords, branchWords, sessionWords } from "./words.js";
import { loadAdapters, adapterOf, asksMode } from "./adapters.js";
import { confluenceMessage, answersSheet, conclusionRequest, extractConclusion, forkTurnOf, wrapperWords, leadIn, answersLeadIn } from "./confluence.js";

const ICON = (n) => `mods/workspace-chrome/${n}.svg`;
// The panel's one indent: every line under a row's meta line (its text, options, notes, details,
// a branch's status and body) hangs here, the status glyph's width plus its gap.
const IND = 18;
const DAY = 86400e3;
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const plain = (s) => squash(String(s ?? "").replace(/[`*_#>]+/g, ""));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HOUR = 3600e3;
// extract.threshold as the ASKED OF YOU control names it.
const TH_WORDS = { blocking: "blocking only", needed: "blocking + needed", optional: "everything" };
const DONE_TIP = "Done: you did or decided it";
const NOT_NEEDED_TIP = "Not needed: close it; the agent may raise it again";
const BR_WORD = { working: "working", blocked: "needs you", done: "done", idle: "idle", starting: "starting", launching: "launching…",
  launched: "starting", running: "running", closed: "closed", ended: "ended", failed: "launch failed", refused: "refused",
  nostart: "did not start (see its terminal's error toast)", concluded: "concluded", rejoined: "rejoined" };


// [start, end) of the quote in the message text, tolerant of whitespace and markdown marks.
function locate(text, quote) {
  if (!text || !quote) return null;
  const q = String(quote).trim();
  const i = text.indexOf(q);
  if (i >= 0) return [i, i + q.length];
  const words = plain(q).split(" ").filter(Boolean).slice(0, 25);
  if (!words.length) return null;
  try {
    const m = new RegExp(words.map(escapeRe).join("[\\s`*_#>]+")).exec(text);
    return m ? [m.index, m.index + m[0].length] : null;
  } catch { return null; }
}

// The anchoring message split around the paragraph that holds the quote, so that paragraph can
// be drawn highlighted (TextView's bold is not visibly heavier at panel sizes). Not whole: about
// 600 characters of context either side, cut at paragraph breaks.
function passageParts(text, quote, whole) {
  const span = locate(text, quote);
  if (!span) return { before: whole || text.length <= 1400 ? text : text.slice(0, 1400) + "\n\n…", hit: null, after: "" };
  const [a, b] = span;
  const pa = text.lastIndexOf("\n\n", a);
  let start = pa < 0 ? 0 : pa + 2;
  const pb = text.indexOf("\n\n", b);
  let end = pb < 0 ? text.length : pb;
  // A long paragraph with line breaks (a list): highlight only the lines that hold the quote.
  if (end - start > 300 && text.slice(start, end).includes("\n")) {
    start = Math.max(start, text.lastIndexOf("\n", a - 1) + 1);
    const nl = text.indexOf("\n", b);
    end = nl < 0 || nl > end ? end : nl;
  }
  let before = text.slice(0, start), after = text.slice(end);
  if (!whole) {
    if (before.length > 600) { const c = before.indexOf("\n\n", before.length - 600); before = "…\n\n" + before.slice(c < 0 ? before.length - 600 : c + 2); }
    if (after.length > 600) { const c = after.lastIndexOf("\n\n", 600); after = after.slice(0, c > 0 ? c : 600) + "\n\n…"; }
  }
  return { before: before.trim(), hit: text.slice(start, end).trim(), after: after.trim() };
}

export class Panel {
  constructor(view, cx) {
    this.view = view;
    const p = props() ?? {};
    this.demo = FORCE_DEMO || p.demo === true;
    this.cfg = DEFAULTS;
    this.panelId = randomUUID();
    this.live = new Store(null);   // store.json as read (reader mode)
    this.liveText = null;
    this.writer = null;            // a fallback Writer, only when no host writer answers
    this.localActs = [];           // acts posted but not yet in store.json (shown at once)
    this.drafts = new Map();       // answer text typed but not yet posted
    this.demoStore = null;
    this.expanded = new Set();
    this.passages = new Map();
    this.whole = new Set();
    this.unfolded = new Set();
    this.folded = new Set();
    this.sugOpen = new Set();      // turn groups whose "suggestions (N)" line is open
    this.folds = { older: false, deferred: false, closed: false };
    // Lane folds are the person's alone: changed only by a click (or the fold-* commands), kept
    // across reloads. ui.foldAsksWhileWorking brings back the Phase 1 auto-fold (asksOpen).
    this.collapsed = { asks: false, mine: false };
    try {
      const saved = JSON.parse(localStorage.getItem("lanes") || "{}");
      for (const k of ["asks", "mine"]) if (typeof saved?.[k] === "boolean") this.collapsed[k] = saved[k];
    } catch { /* defaults */ }
    this.confirm = null;           // { itemId, placement, isolate }: the open Branch confirmation
    this.brOpen = new Set();       // expanded branch rows
    this.preOpen = new Set();      // branch rows showing their preamble
    this.forgetAsk = null;         // session id awaiting a second click on Forget
    this.conclude = null;          // { branchId, input, text, source, turn, prefill, edited }: the open Conclude editor
    this.closeAsk = null;          // branch id awaiting a second click on Close branch
    this.gitOk = new Map();        // cwd -> is a git checkout (the worktree toggle)
    this.txCheck = new Map();      // session id -> {ok, at}: does its transcript exist (Resume session)
    this.dd = null;                // the open dropdown's key (menuButton): one at a time
    this.ddShut = null;            // {key, at}: closed by a press outside (that press may be its own trigger)
    this.ddFocus = cx.focus_handle();
    this.menu = false;
    this.hover = null;
    this.inputs = new Map();
    this.seenSent = new Map();
    this.flash = "";
    this.override = null;
    this.last = null;
    this.wasShown = false;
    this.checkedAt = 0;
    // Motion state (observe): `fx` id -> {kind: enter|answered|sug, at, k, phase, fold}; `ghosts`
    // id -> {item (as it was), at, h, phase} for rows that just left a lane; `rowH` id -> {h, at,
    // exp}, a row's height from the pointer passing over it (so a row the person closes can collapse).
    this.fx = new Map();
    this.ghosts = new Map();
    this.rowH = new Map();
    this.prevCls = null;           // id -> {c, status, sid, turn} as last observed; null: record only
    this.rev = 0;                  // bumped when the shown store changes (reload, local act, demo act)
    this.revAt = 0;
    this.obsVer = undefined;
    this.renders = 0;
    try { this.pinned = localStorage.getItem("pinned") || null; } catch { this.pinned = null; }
    // A focus request older than this copy is not a request to it.
    this.focusAt = Number(shared("ledgr.focus")?.at) || 0;
    if (this.demo) this.enterDemo();
    if (!FORCE_DEMO) cx.spawn(async (cx) => this.start(cx));
    cx.timer.every(60000, (cx) => this.tick(cx));
  }

  // ── reader lifecycle ─────────────────────────────────────────────────
  // The panel reads ledgr-data/store.json and follows it with watchFolder; the writer is a host
  // copy (writer.js). If none answers a ping within 4 s, this copy runs a fallback writer, and
  // hands the role back as soon as a host writer claims it.
  async start(cx) {
    if (!(await liveHome())) return;      // herdr-app check: no ping, no fallback writer
    this.inApp = true;
    this.cfg = await loadConfig();
    this.adapters = await loadAdapters();
    try { localStorage.removeItem("store"); } catch { /* the pre-store.json cache, unused now */ }
    await this.reload();
    this.watchStore(cx);
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

  async reload() {
    const text = await fs.readFile(storePath(), "utf8").catch(() => null);
    if (text === null || text === this.liveText) return false;
    let st;
    try { st = Store.fromText(text); } catch { return false; }
    this.liveText = text;
    this.live = st;
    this.overlayLocal();
    this.bump();
    return true;
  }

  // The shown store changed: the next render compares item classes (observe).
  bump() { this.rev++; this.revAt = Date.now(); }

  // Acts and drafts this panel posted that store.json does not show yet, applied on top.
  overlayLocal() {
    const ing = new Set(this.live.d.ingested), now = Date.now();
    this.localActs = this.localActs.filter((a) => !ing.has(a.evId) && now - a.at < 30000);
    for (const a of this.localActs) {
      if (a.action === "seen") this.live.markSeen(a.sid, a.at);
      else if (a.action === "retry") this.live.turnRec(a.sid, a.turn).retry = { at: a.at, state: "requested" };
      else if (a.action === "branch") {
        if (!this.live.d.branches[a.branchId]) {
          this.live.d.branches[a.branchId] = { id: a.branchId, requestId: a.item, parentSessionId: a.sid, sessionId: null, terminal: null,
            name: a.name, depth: a.manifest?.depth ?? 1, manifest: a.manifest, placement: a.placement, status: "launching", createdAt: a.at, updatedAt: a.at, local: true };
          const it = this.live.item(a.item);
          if (it) it.branch = { branchId: a.branchId };
        }
      } else if (a.action === "forget") { const fs_ = this.live.d.sessions[a.sid]; if (fs_) this.live.on_forget({}, fs_, a.at); }
      else if (a.action === "conclude") {
        const ts = this.live.d.sessions[a.sid];
        if (ts) this.live.on_conclude({ branch_id: a.branchId, text: a.text, message: a.message, source: a.source }, ts, a.at);
      } else if (a.action === "close_branch") { const b = this.live.d.branches[a.branchId]; if (b) b.closeRequestedAt = a.at; }
      else if (a.action === "resume") { const x = this.live.d.sessions[a.sid]; if (x && x.resume?.state !== "resumed") x.resume = { at: a.at, state: "launching" }; }
      else this.live.act(a.item, a.action, a.arg, a.at);
    }
    for (const [id, v] of this.drafts) {
      const it = this.live.item(id);
      if (!it) { this.drafts.delete(id); continue; }
      if (it.draft === v.text && v.sent) this.drafts.delete(id); else it.draft = v.text;
    }
    if (this.localActs.length) this.bump();
  }

  watchStore(cx) {
    if (this.watchingStore) return;
    this.watchingStore = true;
    cx.spawn(async (cx) => {
      const root = dataDir().replace(/\/+$/, "");
      try {
        for (;;) {
          const paths = await watchFolder(root);
          const all = paths.some((p) => String(p).replace(/\/+$/, "") === root);
          // config.json edited by hand: the ui.* and extract.threshold choices apply at once.
          if (all || paths.some((p) => String(p).split("/").pop() === "config.json")) {
            this.cfg = await loadConfig();
            if (this.fallback()) this.writer.applyConfig(this.cfg);
            this.prevCls = null;         // a new threshold moves rows between lanes: not a motion
            this.obsVer = undefined;
            cx.notify();
          }
          if (this.fallback()) continue;
          if (all || paths.some((p) => String(p).split("/").pop() === "store.json")) {
            if (await this.reload()) cx.notify();
          }
        }
      } catch {
        // ledgr-data does not exist yet: look again in 5 s.
        this.watchingStore = false;
        cx.timer.after(5000, (cx) => this.watchStore(cx));
      }
    });
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
    cx.spawn(async (cx) => { if (await this.reload()) cx.notify(); });
  }

  // Every act goes to the writer as a spool event (the same path as a capture). In reader mode
  // it also shows at once, until store.json carries it.
  post(type, payload, local, cx) {
    const evId = randomUUID(), at = Date.now();
    if (local && !this.fallback()) { this.localActs.push({ evId, at, ...local }); this.overlayLocal(); }
    cx.spawn(async (cx) => {
      try { await writeEvent(type, { id: evId, terminal: null, ...payload }); }
      catch (e) { this.flash = `Not sent to the ledgr writer: ${String(e?.message ?? e)}`; }
      cx.notify();
    });
    cx.notify();
  }

  // ── commands (`herdr-app do ledgr.<command>`, shown copies only) ────
  command(c, cx) {
    if (c === "demo") {
      if (this.demo && !FORCE_DEMO) {
        this.demo = false; this.demoStore = null; this.expanded.clear(); this.flash = ""; this.conclude = null; this.confirm = null; this.prevCls = null;
        // A threshold picked in the demo was held in memory only: read config.json again.
        cx.spawn(async (cx) => { this.cfg = await loadConfig(); this.obsVer = undefined; cx.notify(); });
      } else this.enterDemo();
    }
    else if (c === "capture") run("mod.open", { name: "ledgr" });
    else if (c === "rescan") { if (this.fallback()) this.writer.tick(cx); else cx.spawn(async (cx) => { await this.reload(); cx.notify(); }); }
    else if (c === "check-writer") this.checkWriter(cx);
    else if (c === "expand-all") for (const it of this.viewStore().items()) this.expandItem(it, cx);
    // Opens the Branch confirmation on the newest open parked question of the shown session.
    else if (c === "branch") {
      const st = this.viewStore(), sid = this.current(st), s = sid ? st.d.sessions[sid] : null;
      const it = s ? st.itemsOf(sid).filter((x) => isHuman(x) && !isClosed(x)).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0] : null;
      if (it) { this.expandItem(it, cx); this.openConfirm(it, s, cx); } else this.flash = "No open parked question to branch from in this session.";
    }
    // The confirmation's own buttons, for keys and `herdr-app do` (the same code as the clicks).
    else if (c === "branch-split" || c === "branch-agent") { if (this.confirm) { this.confirm.placement = c === "branch-agent" ? "agent" : "split"; this.confirm.isolate = false; } }
    else if (c === "launch-branch") {
      const st = this.viewStore(), it = this.confirm ? st.item(this.confirm.itemId) : null, s = it ? st.d.sessions[it.anchor?.sessionId] : null;
      if (it && s) this.launch(it, s, cx); else this.flash = "No Branch confirmation is open.";
    }
    // Phase 3, the same code as the clicks: on the newest branch of the shown session that fits.
    else if (c === "conclude" || c === "ask-conclusion" || c === "copy-confluence" || c === "close-branch") {
      const st = this.viewStore(), sid = this.current(st), brs = sid ? st.branchesOf(sid) : [];
      if (c === "conclude") {
        const br = brs.find((b) => this.canConclude(st, b));
        if (br) this.openConclude(st, br, cx); else this.flash = "No branch to conclude in this session.";
      } else if (c === "ask-conclusion") {
        const br = brs.find((b) => this.canConclude(st, b) && b.terminal);
        if (br) this.askForConclusion(st, br, cx); else this.flash = "No running branch to ask in this session.";
      } else if (c === "copy-confluence") {
        const br = brs.find((b) => b.status === "concluded");
        if (br) this.copyConfluence(st, br, cx); else this.flash = "No staged confluence in this session.";
      } else {
        const br = brs.find((b) => b.status === "rejoined" && !b.closedAt);
        if (!br) this.flash = "No rejoined branch to close in this session.";
        else if (this.closeAsk === br.id) this.closeBranch(br, cx);
        else { this.closeAsk = br.id; this.brOpen.add(br.id); }
      }
    }
    else if (c === "send-to-trunk") {
      const st = this.viewStore(), br = this.conclude ? st.d.branches[this.conclude.branchId] : null;
      if (br) this.sendToTrunk(st, br, cx); else this.flash = "No Conclude editor is open.";
    }
    // `herdr-app do 'ledgr.conclude-edit:<text>'` appends a line to the open editor (the person's edit,
    // for scripted tests; "\\n" in <text> is a line break).
    else if (c.startsWith("conclude-edit:")) {
      const k = this.conclude;
      if (k) { const add = c.slice("conclude-edit:".length).replace(/\\n/g, "\n"); k.text = `${k.input.value().trimEnd()}\n${add}`; k.input.set_value(k.text); k.edited = true; }
      else this.flash = "No Conclude editor is open.";
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
    // For scripted looks at the lower lane: fold or unfold a lane, close every open row and box.
    else if (c === "fold-mine") this.setCollapsed("mine", !this.collapsed.mine);
    // `pick:<handle>:<n>` clicks option n (from 0) of that ask; `copy-answer:<handle>` its Copy answer.
    else if (c.startsWith("pick:") || c.startsWith("copy-answer:")) {
      const st = this.viewStore(), sid = this.current(st), s = sid ? st.d.sessions[sid] : null;
      const [, h, n] = c.split(":");
      const it = s ? st.byHandle(sid, h) : null;
      if (!it || !isAgentAsk(it)) this.flash = `No ask ${h} in this session.`;
      else if (c.startsWith("pick:")) { const o = (it.options ?? [])[Number(n)]; if (o === undefined) this.flash = `${h} has no option ${n}.`; else this.setDraft(it, o, cx); }
      else this.copyAnswer(it, s, cx);
    }
    // `go:<handle>`: that item's Go to anchor (the ⋯ menu's), on the shown session.
    else if (c.startsWith("go:")) {
      const st = this.viewStore(), sid = this.current(st), s = sid ? st.d.sessions[sid] : null, h = c.slice("go:".length);
      const it = s ? st.byHandle(sid, h) : null;
      if (!it) this.flash = `No ${h} in this session.`; else this.goTo(it, s, cx);
    }
    else if (c === "fold-asks") { const st = this.viewStore(), sid = this.current(st), s = sid ? st.d.sessions[sid] : null; if (s) this.setAsksOpen(s, !this.asksOpen(s)); }
    else if (c === "collapse-all") { this.expanded.clear(); this.whole.clear(); this.brOpen.clear(); this.preOpen.clear(); this.confirm = null; this.conclude = null; this.dd = null; this.flash = ""; }
    // Demo only, for a staged shot: hide-branch:<hc name> (br-q2-a41b) drops that branch from the demo store.
    else if (this.demo && c.startsWith("hide-branch:")) {
      const name = c.slice("hide-branch:".length), st = this.demoStore;
      const id = Object.keys(st.d.branches).find((k) => st.d.branches[k].name === name);
      if (id) { delete st.d.branches[id]; this.bump(); } else this.flash = `No branch ${name} in the demo.`;
    }
    // For scripted checks of the severity and motion paths, the same code as the clicks:
    // act:<handle>:<resolve|dismiss|reopen|promote> on the shown session; suggestions (every
    // "suggestions (N)" line of the shown session, open or fold); demo only: demo-ask:<level>
    // (a new ask on the newest turn), demo-answer:<handle> (as if its answer sheet landed).
    else if (c.startsWith("act:")) {
      const [, h, action] = c.split(":");
      const st = this.viewStore(), sid = this.current(st), it = sid ? st.byHandle(sid, h) : null;
      if (!it || !["resolve", "dismiss", "reopen", "promote"].includes(action)) this.flash = `No ${h} in this session, or not one of resolve, dismiss, reopen, promote.`;
      else this.act(it.id, action, null, cx);
    }
    // whole:<handle> opens (or closes) that item's whole message; menu:<handle>:<defer|more>,
    // menu:threshold and menu:off open the row's menus as a click does.
    else if (c.startsWith("whole:") || c.startsWith("menu:")) {
      const [kind, h, which] = c.split(":");
      const st = this.viewStore(), sid = this.current(st), it = sid && h !== "threshold" && h !== "off" ? st.byHandle(sid, h) : null;
      if (kind === "menu" && (h === "off" || h === "threshold")) this.dd = h === "off" ? null : "threshold";
      else if (!it) this.flash = `No ${h} in this session.`;
      else if (kind === "whole") { this.expandItem(it, cx); if (this.whole.has(it.id)) this.whole.delete(it.id); else this.whole.add(it.id); }
      else { this.expandItem(it, cx); this.dd = `${which === "defer" ? "defer" : "more"}-${it.id}`; }
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
    else if (c === "expand-branches") { const st = this.viewStore(); for (const b of Object.values(st.d.branches)) this.brOpen.add(b.id); }
  }

  enterDemo() {
    this.demo = true;
    this.prevCls = null;
    this.demoStore = new Store(demoData());
    this.override = null;
    this.flash = "Demo data: nothing here is saved or sent.";
    this.asksManual = { sid: DEMO_SESSION, stopAt: this.demoStore.d.sessions[DEMO_SESSION]?.lastStopAt ?? 0, open: true };
    const a5 = this.demoStore.items().find((it) => it.handle === "A5" && it.anchor.sessionId === DEMO_SESSION);
    if (a5) this.expandItem(a5);
    // Demo branches carry no manifest in fixtures.js: computed here, as the writer would at launch.
    for (const b of Object.values(this.demoStore.d.branches)) {
      const it = this.demoStore.item(b.requestId);
      if (!it) continue;
      const fork = b.forkTurn;
      const m = manifest(this.demoStore, it, { now: b.createdAt, maxDepth: 2 });
      m.forkTurn = fork; m.later = Math.max(0, fork - m.anchorTurn);
      b.manifest = m; b.preamble = preamble(it, m, b.name);
      this.brOpen.add(b.id);
    }
    // And one open Branch confirmation (Q5: two later turns, a compaction after its anchor).
    const q5 = this.demoStore.items().find((it) => it.handle === "Q5" && it.anchor.sessionId === DEMO_SESSION);
    if (q5) { this.expandItem(q5); this.confirm = { itemId: q5.id, placement: "split", isolate: false }; }
    // And the Conclude editor on the Q3 branch (Phase 3), prefilled from its ledgr-conclusion block.
    const bq3 = this.demoStore.d.branches.br_demo_q3_7c1e;
    if (bq3) this.concludeEditor(bq3, extractConclusion(FIXTURE_TURNS[`${bq3.sessionId}:1`]) ?? "", "block", 1);
  }

  viewStore() {
    if (this.demo && this.demoStore) return this.demoStore;
    return this.fallback() ? this.writer.live : this.live;
  }

  // ── which session ────────────────────────────────────────────────────
  current(st) {
    const f = shared("ledgr.focus");
    const ft = focused()?.terminal ?? null;
    this.away = null;
    if (f?.session && Number(f.at) > this.focusAt) { this.focusAt = Number(f.at); this.override = { sid: f.session, terminal: ft }; }
    if (this.pinned && st.d.sessions[this.pinned]) return this.pinned;
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

  // ── acts ─────────────────────────────────────────────────────────────
  act(id, action, arg, cx) {
    const st = this.viewStore();
    if (this.demo) { if (st.act(id, action, arg)) { this.bump(); cx.notify(); } return; }
    const it = st.item(id);
    if (!it) return;
    this.post("act", { session_id: it.anchor?.sessionId, item: id, action, arg: arg ?? null }, { item: id, action, arg }, cx);
  }

  // Typing shows at once; the text is posted 800 ms after the last change.
  typeDraft(id, text, cx) {
    const it = this.viewStore().item(id);
    if (!it) return;
    const had = Boolean(squash(it.draft));
    it.draft = text;
    if (had !== Boolean(squash(text))) cx.notify();   // the Copy answer(s) buttons follow it
    if (this.demo) return;
    const d = { text, sent: false, seq: (this.drafts.get(id)?.seq ?? 0) + 1 };
    this.drafts.set(id, d);
    const seq = d.seq;
    cx.timer.after(800, (cx) => {
      const cur = this.drafts.get(id);
      if (!cur || cur.seq !== seq) return;
      cur.sent = true;
      this.post("act", { session_id: it.anchor?.sessionId, item: id, action: "draft", arg: cur.text }, null, cx);
    });
  }

  expandItem(it, cx) {
    this.expanded.add(it.id);
    if (isAgentAsk(it) && !isClosed(it) && !this.inputs.has(it.id)) {
      const id = it.id;
      const inp = InputState.new({ placeholder: "Answer…", value: it.draft ?? "" });
      inp.on("change", (_e, cx) => this.typeDraft(id, inp.value(), cx));
      inp.on("submit", (_e, cx) => {
        const cur = this.viewStore().item(id);
        const s = cur && this.viewStore().d.sessions[cur.anchor.sessionId];
        if (cur && s) this.copyAnswers(s, cur.anchor.turn, cx);
      });
      this.inputs.set(id, inp);
    }
    if (cx) this.loadPassage(it.anchor?.sessionId, it.anchor?.turn, cx);
    else this.passages.set(`${it.anchor?.sessionId}:${it.anchor?.turn}`, FIXTURE_TURNS[`${it.anchor?.sessionId}:${it.anchor?.turn}`] ?? null);
  }

  toggle(it, cx) {
    if (this.expanded.has(it.id)) this.expanded.delete(it.id);
    else this.expandItem(it, cx);
    cx.notify();
  }

  loadPassage(sid, turn, cx) {
    const k = `${sid}:${turn}`;
    if (this.demo) { this.passages.set(k, FIXTURE_TURNS[k] ?? null); return; }
    if (this.passages.has(k)) return;
    this.passages.set(k, undefined);
    cx.spawn(async (cx) => {
      const ti = this.viewStore().turnInfo(sid, turn);
      const p = ti?.textPath ? (ti.textPath.startsWith("/") ? ti.textPath : `${dataDir()}/${ti.textPath}`) : turnPath(sid, turn);
      this.passages.set(k, await readTextFile(p).catch(() => null));
      cx.notify();
    });
  }

  setDraft(it, text, cx) {
    this.typeDraft(it.id, text, cx);
    this.inputs.get(it.id)?.set_value(text);
    cx.notify();
  }

  // An ask's answer is its draft: typed, or the label of the option clicked (setDraft fills it).
  answerOf(it) { return squash(it?.draft); }

  copyAnswers(s, turn, cx) {
    const st = this.viewStore();
    const group = st.itemsOf(s.sessionId).filter((it) => isAgentAsk(it) && it.anchor?.turn === turn && !isClosed(it)).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    this.stageAnswers(s, turn, group, cx);
  }

  // One ask's answer as a sheet of its own: the same marker line, so the same landing.
  copyAnswer(it, s, cx) { this.stageAnswers(s, it.anchor?.turn, [it], cx); }

  // The answer sheet on the clipboard, the pane focused, and the lead-in hint (as for a confluence).
  stageAnswers(s, turn, group, cx) {
    const items = group.filter((it) => this.answerOf(it));
    const msg = answersSheet(s.sessionId, turn, items);
    if (!msg) { this.flash = group.length === 1 ? `${H(group[0])} has no answer yet: type one or pick an option.` : `No answers typed or picked for turn ${turn}.`; cx.notify(); return; }
    if (this.demo) cx.write_to_clipboard(msg);
    else stageText(msg, s.terminal, cx);
    const hs = items.map((it) => it.handle), ws = items.map(H);   // hs: the lead-in's short forms
    const what = ws.length === 1 ? `Answer for ${ws[0]}` : `${ws.length} answers (${ws.join(", ")})`;
    const word = this.trunkWord(s);
    const how = `type “${answersLeadIn(hs)}”, then ⌘V, Enter`;
    this.flash = this.demo
      ? `(demo) ${what} copied to the clipboard; in a session you would ${how}.`
      : `${what} copied and ${P(s.terminal, "the pane")} focused${word === "working" ? " (working: wait for idle)" : word === "gone" ? " (not live)" : ""}: ${how}. ${ws.length === 1 ? `${ws[0]} shows` : "They show"} answered once that prompt is sent.`;
    cx.notify();
  }

  // Go to anchor: the row opens on its whole message (the passage, highlighted), the pane is focused
  // and a search slice of the quote is copied (nav.js). No keys are sent to the terminal.
  goTo(it, s, cx) {
    this.expandItem(it, cx);
    this.whole.add(it.id);
    this.flash = this.demo ? "(demo) Would focus the agent's pane and copy a search slice of the quote; the passage is shown here." : goToAnchor(it, s, cx);
    cx.notify();
  }

  askAbout(it, s, cx) {
    if (this.demo) { this.flash = "(demo) Would open the capture box with “re [" + it.handle + "] ”."; cx.notify(); return; }
    openOverlay({ mod: "ledgr", kind: "dialog", width: 600, height: 236,
      props: { view: "capture", parent: it.id, session: s.sessionId, terminal: s.terminal, prefill: `re [${it.handle}] ` } });
  }

  stageQuestion(it, s, btw, cx) {
    const text = btw ? btwText(it.text, it.anchor?.quote) : `[${it.handle}] ${it.text}`;
    if (this.demo) cx.write_to_clipboard(text); else stageText(text, s.terminal, cx);
    if (btw) this.act(it.id, "btw", null, cx);
    this.flash = `${this.demo ? "(demo) " : ""}Copied ${btw ? "/btw" : "question"} for ${P(s.terminal, "the session")}: ⌘V, Enter.`;
    cx.notify();
  }

  // Asks the writer to re-run extraction for a turn (a `retry` spool event; the writer runs the
  // hooks agent's --retry and the new `asks` event arrives through the spool).
  retry(s, turn, cx) {
    if (this.demo) return;
    this.post("retry", { session_id: s.sessionId, turn, terminal: s.terminal ?? null }, { action: "retry", sid: s.sessionId, turn }, cx);
  }

  // ── branches (Phase 2) ───────────────────────────────────────────────
  parentLive(s) {
    const t = s?.terminal;
    if (!t) return false;
    const k = terminals().find((x) => x.address === t);
    return Boolean(k && (!k.state || k.state === "live"));
  }

  // `claude --resume --fork-session` is Claude Code's; other agents have no fork.
  branchable(s) { return Boolean(s) && (s.agent === "claude-code" || s.agent === "claude") && !String(s.sessionId).startsWith("herdr:"); }

  openConfirm(it, s, cx) {
    this.confirm = { itemId: it.id, placement: "split", isolate: false };
    this.expanded.add(it.id);
    if (!this.demo && s?.cwd && !this.gitOk.has(s.cwd)) {
      this.gitOk.set(s.cwd, undefined);
      cx.spawn(async (cx) => {
        let ok = false;
        try { ok = (await exec("git", ["-C", s.cwd, "rev-parse", "--show-toplevel"])).code === 0; } catch { /* no git */ }
        this.gitOk.set(s.cwd, ok);
        cx.notify();
      });
    }
    cx.notify();
  }

  confirmManifest(st, it, s) {
    return manifest(st, it, { maxDepth: maxDepthOf(this.cfg), isolate: Boolean(this.confirm?.isolate), parentLive: this.demo ? true : this.parentLive(s) });
  }

  // Launch: one `branch` spool event; the writer re-checks the depth cap and starts the process.
  launch(it, s, cx) {
    const st = this.viewStore();
    const m = this.confirmManifest(st, it, s);
    if (m.refused) { this.flash = `Branch refused: ${m.refused}.`; cx.notify(); return; }
    const c = this.confirm ?? { placement: "split", isolate: false };
    this.confirm = null;
    if (this.demo) { this.flash = "(demo) Would start claude --resume … --fork-session as a sub-agent of the trunk."; cx.notify(); return; }
    const branchId = `br_${randomUUID()}`, name = branchName(it.handle, branchId);
    this.post("branch", { session_id: s.sessionId, item: it.id, branch_id: branchId, placement: c.placement, isolate: c.isolate === true },
      { action: "branch", sid: s.sessionId, item: it.id, branchId, name, manifest: m, placement: c.placement }, cx);
    this.brOpen.add(branchId);
    this.flash = `The ${branchWords(it)} (${name}) is asked for: the writer starts it ${c.isolate ? "in a new worktree and space" : c.placement === "split" ? "beside the trunk" : "as a sub-agent of the trunk (peek it from the agents list)"}.`;
    cx.notify();
  }

  // Focus: the branch's pane if it has one, else a peek (a sub-agent without a pane).
  focusBranch(br, cx) {
    const t = br?.terminal;
    if (!t || this.demo) { this.flash = this.demo ? "(demo) Would focus the branch's pane." : "The branch has no terminal yet."; cx.notify(); return; }
    if (panes().some((p) => p.terminal === t)) run("pane.focus", { terminal: t });
    else run("terminal.peek", { terminal: t });
  }

  // ── Resume session ───────────────────────────────────────────────────
  // The session's terminal is gone: not among terminals() (live) or agents(), or the identity map
  // now gives it to another session. Demo sessions never are.
  terminalGone(st, s) {
    if (this.demo || !s || String(s.sessionId).startsWith("herdr:")) return false;
    const t = s.terminal;
    if (!t) return true;
    const owner = st.d.terminals[t]?.sessionId;
    if (owner && owner !== s.sessionId) return true;
    return !this.parentLive(s) && !agents().some((a) => a.address === t);
  }

  // Does the session's transcript still exist? true | false | undefined (being checked). Checked once,
  // again after 30 s at the next render; the answer arrives with one render. Called while rendering a
  // row (which has no cx of its own): it uses the render's, kept in this.rcx.
  transcriptOk(s) {
    const cx = this.rcx;
    if (this.demo) return true;
    const c = this.txCheck.get(s.sessionId);
    if (c && (c.ok === undefined || Date.now() - c.at < 30000)) return c.ok;
    if (!cx) return c?.ok;
    this.txCheck.set(s.sessionId, { ok: c?.ok, at: Date.now() });
    cx.timer.after(0, (cx) => cx.spawn(async (cx) => {
      const ok = Boolean(await fs.exists(transcriptPathOf(s, home())).catch(() => false));
      this.txCheck.set(s.sessionId, { ok, at: Date.now() });
      cx.notify();
    }));
    return c?.ok;
  }

  // One `resume` spool event; the writer runs claude --resume in a new pane (writer.js resumeSession).
  resume(s, cx) {
    if (this.demo) { this.flash = "(demo) Would start claude --resume in a new pane."; cx.notify(); return; }
    this.post("resume", { session_id: s.sessionId }, { action: "resume", sid: s.sessionId }, cx);
    this.flash = `Resuming ${sessionWords(s)}: claude --resume in a new pane beside the focused one. Its rows follow the new pane once Claude starts there.`;
    cx.notify();
  }

  forget(s, cx) {
    if (this.demo) { this.flash = "(demo) Would forget the session."; this.forgetAsk = null; cx.notify(); return; }
    this.forgetAsk = null;
    this.post("forget", { session_id: s.sessionId }, { action: "forget", sid: s.sessionId }, cx);
    if (this.pinned === s.sessionId) { this.pinned = null; try { localStorage.setItem("pinned", ""); } catch { /* none */ } }
    if (this.override?.sid === s.sessionId) this.override = null;
    this.flash = `Forgot ${s.sessionName || s.sessionId.slice(0, 8)} and its branches.`;
  }

  branchVisible(b) {
    return !((b.status === "refused" || b.status === "failed") && Date.now() - (b.updatedAt ?? b.createdAt ?? 0) > HOUR);
  }

  branchLive(b) {
    if (this.demo) return b.demoStatus ?? b.status;
    return liveStatus(b, agents(), terminals());
  }

  // ── confluence (Phase 3) ─────────────────────────────────────────────
  // A branch's trunk is its parent session. Its live word from Herdr (working, idle, done, blocked),
  // "gone" when its terminal is not live. Shown so the person can wait for idle; nothing blocks.
  trunkWord(ts) {
    if (this.demo) return "idle";
    const t = ts?.terminal;
    if (!t) return "gone";
    const a = agents().find((x) => x.address === t);
    if (a?.status) return a.status;
    const k = terminals().find((x) => x.address === t);
    return k && (!k.state || k.state === "live") ? k.status || "idle" : "gone";
  }

  // The trunk's status plus how to paste: type a one-line lead-in first (Claude Code presents a bare
  // paste as text that may hold instructions the person did not write), then ⌘V, Enter.
  trunkLine(ts, it) {
    const w = this.trunkWord(ts), t = trunkWords(ts?.terminal).replace(/^t/, "T");
    const how = `type a one-line lead-in such as “${leadIn(it)}”, then ⌘V, Enter`;
    if (w === "gone") return `${t} is not live: the message stays on the clipboard; when it is back, ${how}.`;
    if (w === "working") return `${t} is working: wait until it is idle (a paste now joins the running turn), then ${how}.`;
    if (w === "blocked") return `${t} is waiting on its own prompt: answer that first, then ${how}.`;
    return `${t} is ${w}: ${how}.`;
  }

  // Conclude is live on a started branch whose question is not closed, until the confluence lands.
  canConclude(st, br) {
    if (!br || ["refused", "failed", "launching", "rejoined"].includes(br.status)) return false;
    const it = st.item(br.requestId);
    return Boolean(it && !isClosed(it));
  }

  // The prefill: the newest ledgr-conclusion block in the branch's last 10 turns, else its last
  // message, else nothing.
  async branchText(st, br) {
    const c = br.sessionId ? st.d.sessions[br.sessionId] : null;
    if (!c || !c.turn) return { source: "empty", turn: null, text: "" };
    let last = null;
    for (let n = c.turn; n >= Math.max(1, c.turn - 10); n--) {
      const ti = st.turnInfo(c.sessionId, n);
      let txt;
      if (this.demo) txt = FIXTURE_TURNS[`${c.sessionId}:${n}`] ?? null;
      else {
        const p = ti?.textPath ? (ti.textPath.startsWith("/") ? ti.textPath : `${dataDir()}/${ti.textPath}`) : turnPath(c.sessionId, n);
        txt = await readTextFile(p).catch(() => null);
      }
      if (!txt) continue;
      last ??= { turn: n, text: txt };
      const block = extractConclusion(txt);
      if (block) return { source: "block", turn: n, text: block };
    }
    return last ? { source: "last", turn: last.turn, text: last.text.trim().slice(0, 4000) } : { source: "empty", turn: null, text: "" };
  }

  openConclude(st, br, cx) {
    if (!this.canConclude(st, br)) { this.flash = "This branch cannot conclude: its question is closed or the branch never started."; cx.notify(); return; }
    const prior = String(br.conclusion?.text ?? "");
    const k = this.concludeEditor(br, prior, prior ? "edited" : "loading", br.conclusion?.sourceTurn ?? null);
    const inp = k.input;
    this.closeAsk = null;
    this.brOpen.add(br.id);
    cx.spawn(async (cx) => {
      const r = await this.branchText(st, br);
      if (this.conclude !== k) return;
      k.found = r;
      if (!prior) { k.source = r.source; k.turn = r.turn; k.prefill = r.text; k.text = r.text; inp.set_value(r.text); }
      cx.notify();
    });
    cx.notify();
  }

  // The editor's state (a TextareaState: created in init, a handler or a task, never in render).
  concludeEditor(br, text, source, turn) {
    const inp = TextareaState.new({ placeholder: "What the trunk should hear: the answer, and any facts or decisions it should update.", value: text, rows: 6 });
    try { inp.set_auto_grow(4, 14); } catch { /* fixed rows */ }
    const k = { branchId: br.id, input: inp, text, source, turn, prefill: text, edited: false };
    inp.on("change", (_e, cx) => { if (this.conclude === k) { k.text = inp.value(); k.edited = k.text !== k.prefill; cx.notify(); } });
    this.conclude = k;
    return k;
  }

  // Send to trunk: the message goes on the clipboard and the trunk's pane is focused; the `conclude`
  // event records it. Never typed (a paste the person makes joins nothing they did not see).
  sendToTrunk(st, br, cx) {
    const k = this.conclude?.branchId === br.id ? this.conclude : null;
    const text = String(k ? k.input.value() : br.conclusion?.text ?? "").trim();
    const it = st.item(br.requestId), ts = st.d.sessions[br.parentSessionId];
    if (!text) { this.flash = "Write the conclusion first: an empty confluence is not staged."; cx.notify(); return; }
    if (!it || !ts) { this.flash = "The question or its trunk session is no longer in the ledger."; cx.notify(); return; }
    const msg = confluenceMessage({ branch: br, item: it, text });
    const word = this.trunkWord(ts);
    this.conclude = null;
    if (this.demo) { cx.write_to_clipboard(msg); this.flash = `(demo) Confluence for ${H(it)} copied; nothing is saved.`; cx.notify(); return; }
    stageText(msg, ts.terminal, cx);
    this.post("conclude", { session_id: ts.sessionId, branch_id: br.id, item: it.id, text, message: msg, source: k?.source ?? "edited", source_turn: k?.turn ?? null },
      { action: "conclude", sid: ts.sessionId, branchId: br.id, text, message: msg, source: k?.source ?? "edited" }, cx);
    this.flash = `Confluence for ${H(it)} copied and ${trunkWords(ts.terminal)} focused${word === "working" ? " (working: wait for idle)" : word === "gone" ? " (not live)" : ""}: type “${leadIn(it)}”, then ⌘V, Enter. ${H(it)} resolves when that prompt is sent.`;
    cx.notify();
  }

  copyConfluence(st, br, cx) {
    const ts = st.d.sessions[br.parentSessionId], msg = br.conclusion?.message;
    if (!msg) { this.flash = "No staged confluence for this branch."; cx.notify(); return; }
    if (this.demo) cx.write_to_clipboard(msg); else stageText(msg, ts?.terminal, cx);
    this.flash = `${this.demo ? "(demo) " : ""}Confluence copied again for ${trunkWords(ts?.terminal)}: type “${leadIn(st.item(br.requestId))}”, then ⌘V, Enter.`;
    cx.notify();
  }

  // The branch has no conclusion block: stage a short request for one in the branch's pane.
  askForConclusion(st, br, cx) {
    const it = st.item(br.requestId);
    const text = conclusionRequest(it);
    cx.write_to_clipboard(text);
    if (!this.demo) this.focusBranch(br, cx);
    this.flash = `${this.demo ? "(demo) " : ""}Request copied for the ${branchWords(it)} (${br.name}): ⌘V, Enter in its pane${busy(br.terminal) ? " once it is idle" : ""}; Conclude again when it answers.`;
    cx.notify();
  }

  closeBranch(br, cx) {
    this.closeAsk = null;
    if (this.demo) { this.flash = "(demo) Would end the branch terminal (hc kill, hc rm) and keep its record."; cx.notify(); return; }
    this.post("close_branch", { session_id: br.parentSessionId, branch_id: br.id }, { action: "close_branch", branchId: br.id }, cx);
    this.flash = `Closing the ${branchWords(this.viewStore().item(br.requestId))} (${br.name}): the writer ends ${P(br.terminal, "its terminal")}; the record and its conclusion stay.`;
    cx.notify();
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
    const ends = new Set();       // when a render is needed after the motion: a ghost goes, a row folds
    for (const [id, n] of cls) {
      const p = prev.get(id);
      if (p && p.c === n.c) continue;
      if (n.c === "stale" || p?.c === "stale") continue;
      if (n.c === "lane" && (!p || p.c === "sug" || p.c === "closed" || p.c === "deferred")) {
        if (k < 8) { this.fx.set(id, { kind: "enter", at: now, k: k++, phase: 0 }); phase = true; }
      } else if (n.c === "answered" && p?.c === "lane") {
        const fold = this.expanded.has(id);
        this.fx.set(id, { kind: "answered", at: now, k: 0, phase: 0, fold });
        phase = true;
        if (fold) ends.add(200);
      } else if (n.c === "sug" && !p) {
        this.fx.set(`sug:${n.sid}:${n.turn}`, { kind: "sug", at: now, k: 0, phase: 0 });
        phase = true;
      } else if ((n.c === "closed" || n.c === "deferred") && (p?.c === "lane" || p?.c === "answered")) {
        const it = st.item(id), r = this.rowH.get(id);
        // Collapse from the height the pointer last measured, if it is fresh and the row has not
        // been opened or closed since; otherwise fade only.
        const h = r && now - r.at < 15000 && r.exp === this.expanded.has(id) ? r.h : null;
        this.ghosts.set(id, { item: { ...it, status: p.status, __ghost: true }, at: now, h, phase: 0 });
        phase = true;
        ends.add(h ? 380 : 200);
      }
    }
    // The second frame sets the targets the transitions run to (they are attached in the first).
    if (phase) cx.timer.after(16, (cx) => { for (const f of [...this.fx.values(), ...this.ghosts.values()]) f.phase = 1; cx.notify(); });
    // One render when a motion is over: ghosts go (the list closes up), answered rows fold. The
    // highlights need none: they end at opacity 0, and their entries lapse after 1.5 s.
    for (const ms of ends) cx.timer.after(ms + 20, (cx) => { this.pruneFx(); cx.notify(); });
  }

  pruneFx(now = Date.now()) {
    for (const [id, g] of this.ghosts) if (now - g.at >= (g.h ? 380 : 200)) this.ghosts.delete(id);
    for (const [id, f] of this.fx) {
      if (f.fold && now - f.at >= 200) { this.expanded.delete(id); f.fold = false; }
      if (now - f.at >= 1500) this.fx.delete(id);
    }
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
      .child(this.row(t, st, s, it, false, true));
  }

  ghostItems(sid) {
    const now = Date.now();
    return [...this.ghosts.values()].filter((g) => g.item.anchor?.sessionId === sid && now - g.at < 400).map((g) => g.item);
  }

  // ── render ───────────────────────────────────────────────────────────
  render(cx) {
    this.renders++;
    this.rcx = cx;
    const t = theme();
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
    if (s && !this.demo && s.surfaced && shown && this.seenSent.get(sid) !== (s.lastStopAt ?? 0)) {
      this.seenSent.set(sid, s.lastStopAt ?? 0);
      cx.timer.after(0, (cx) => this.post("act", { session_id: sid, action: "seen" }, { action: "seen", sid }, cx));
    }
    if (s) this.pumpBranchMessages(st, s, cx);
    const note = this.flash || this.writerNote || (this.fallback() ? this.writer.note : null);
    return v_flex().id("ledgr").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(12.5)
      .child(this.header(t, st, s))
      .when(this.menu, (el) => el.child(this.sessionMenu(t, st, sid)))
      .child(v_flex().id("ledgr-list").flex_1().min_h(0).overflow_y_scrollbar().px(8).py(8).gap(4)
        .children(s ? this.body(t, st, s) : [this.away && st.sessionsList().length ? this.awayState(t, this.away) : this.emptyState(t)]))
      .when(Boolean(s), (el) => el.child(this.footer(t, st, s)))
      .when(Boolean(note), (el) => el.child(
        div().flex_none().px(12).py(6).border_t(1).border_color(t.border).text_size(11).text_color(t.muted).child(note)));
  }

  // A small menu under a trigger: gpui-base's Popup (a choice, a press outside or Esc closes it).
  // One open at a time (this.dd); a choice, a press outside or Esc closes it. Items are
  // [id, label, fn, {tip, disabled, danger, hint}]; o.small draws a quiet trigger for a lane head.
  menuButton(t, key, label, items, o = {}) {
    const open = this.dd === key;
    const trigger = div().id(`ddt-${key}`).flex_none().flex().items_center().rounded(o.small ? 5 : 6).cursor_pointer()
      .when(o.small, (el) => el.h(18).px(5).text_size(10.5).text_color(open ? t.foreground : t.dim).hover((x) => x.bg(t.hover).text_color(t.foreground)))
      .when(!o.small, (el) => el.h(22).px(7).border_1().border_color(open ? t.accent : t.border).bg(t.background).text_size(11).text_color(t.foreground).hover((x) => x.opacity(0.85)))
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
      .children(items.filter(Boolean).map(([id, text, fn, io = {}]) => h_flex().id(`ddi-${key}-${id}`).h(26).px(8).gap(8).items_center().rounded(5).text_size(11.5)
        .text_color(io.disabled ? t.dim : io.danger ? t.blocked : t.foreground)
        .when(Boolean(io.tip), (el) => el.tooltip(io.tip))
        .when(!io.disabled, (el) => el.cursor_pointer().hover((x) => x.bg(t.hover))
          .on_click((e, cx) => { cx.stop_propagation(); this.dd = null; fn(e, cx); cx.notify(); }))
        .child(div().flex_1().min_w(0).child(text))
        .when(Boolean(io.hint), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(io.hint)))));
    return Popup.new(`ddp-${key}`, trigger).anchor(o.anchor ?? "top_left").when(open, (el) => el.content(list));
  }

  // The ASKED OF YOU threshold: written to ledgr-data/config.json (extract.threshold), which the
  // writer watches (chips) and this panel re-reads. Not a motion: rows just move. The demo keeps it
  // in memory.
  setThreshold(level, cx) {
    if (!LEVELS.includes(level)) return;
    this.cfg = { ...this.cfg, extract: { ...(this.cfg.extract ?? {}), threshold: level } };
    this.prevCls = null;
    this.obsVer = undefined;
    if (this.demo) { this.flash = `(demo) Threshold: ${TH_WORDS[level]}; not saved.`; cx.notify(); return; }
    cx.spawn(async (cx) => {
      const path = `${dataDir()}/config.json`;
      try {
        const cur = await readTextFile(path).catch(() => null);
        let d;
        if (cur) { try { d = JSON.parse(cur); } catch { throw new Error("config.json is not valid JSON: fix it by hand first"); } }
        else { d = JSON.parse(JSON.stringify(DEFAULTS)); }
        if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("config.json is not a JSON object");
        d.extract = { ...(d.extract && typeof d.extract === "object" ? d.extract : {}), threshold: level };
        await writeTextFile(path, JSON.stringify(d, null, 2) + "\n", cur ?? null);
        this.flash = `Threshold: ${TH_WORDS[level]} (extract.threshold "${level}" in ledgr-data/config.json).`;
      } catch (e) {
        this.flash = `Threshold not saved: ${String(e?.message ?? e)}`;
        this.cfg = await loadConfig();
      }
      cx.notify();
    });
    cx.notify();
  }

  pill(t, text, color) {
    return div().flex_none().px(5).py(0.5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(color ?? t.muted).child(text);
  }

  header(t, st, s) {
    const away = !s ? this.away : null;
    const name = s ? sessionWords(s) : away ? (away.agent ? "no ledgr session yet" : "no agent here") : "no session";
    const pinned = Boolean(this.pinned && s && this.pinned === s.sessionId);
    return h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_semibold().text_size(13).child("ledgr"))
      .child(h_flex().id("lg-session").flex_1().min_w(0).h(26).px(6).gap(5).items_center().rounded(6).cursor_pointer()
        .hover((x) => x.bg(t.hover)).on_click((_e, cx) => { this.menu = !this.menu; cx.notify(); })
        .when(Boolean(s), (el) => el.child(div().id("lg-agent").flex_none().tooltip(this.asksTip(s)).child(this.pill(t, agentLabel(s.agent)))))
        .when(Boolean(away?.agent), (el) => el.child(this.pill(t, away.name)))
        .when(Boolean(s?.parentSessionId), (el) => el.child(h_flex().id("lg-br-pill").flex_none().gap(3).px(5).py(0.5).rounded(4).items_center().bg(t.accent + "22")
          .tooltip(`Branch of ${st.d.sessions[s.parentSessionId]?.sessionName || String(s.parentSessionId).slice(0, 8)}${s.forkTurn !== undefined && s.forkTurn !== null ? `, forked at its turn ${s.forkTurn}` : ""}`)
          .child(svg(ICON("git-branch")).size(10).text_color(t.accent)).child(div().text_size(10).text_color(t.accent).child(`branch · depth ${s.depth ?? 1}`))))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(name))
        .when(Boolean(s?.terminal || away), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(P(s?.terminal ?? away.terminal))))
        .child(svg(ICON(this.menu ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim)))
      // Pinned: an accent "pinned" pill, unmistakable. Following focus: a faint outline pin.
      .when(Boolean(s), (el) => el.child(h_flex().id("lg-pin").h(22).flex_none().gap(3).items_center().justify_center().rounded(6).cursor_pointer()
        .when(pinned, (x) => x.px(6).bg(t.accent + "26"))
        .when(!pinned, (x) => x.w(22).opacity(0.6))
        .tooltip(pinned ? "Pinned to this session; click to follow focus" : "Following the focused pane; click to pin this session")
        .hover((x) => x.bg(t.hover).opacity(1))
        .on_click((_e, cx) => {
          this.pinned = pinned ? null : s.sessionId;
          try { localStorage.setItem("pinned", this.pinned ?? ""); } catch { /* none */ }
          cx.notify();
        })
        .child(svg(ICON("pin")).size(12).text_color(pinned ? t.accent : t.dim))
        .when(pinned, (x) => x.child(div().text_size(10.5).font_semibold().text_color(t.accent).child("pinned")))))
      .when(Boolean(s), (el) => el.child(div().flex_none().text_size(11).text_color(s.state === "working" ? t.working : t.dim)
        .child(`turn ${s.turn}${s.state === "working" ? " · working" : s.state === "ended" ? " · ended" : ""}`)))
      .when(this.demo, (el) => el.child(this.pill(t, "demo", t.accent)));
  }

  // How this session's agent declares or yields its asks (adapters.js): a tooltip line.
  asksTip(s) {
    const m = asksMode(adapterOf(this.adapters, s), this.cfg);
    return `${m.word}: ${m.tip}`;
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
      const k = `${String(s.sessionId).startsWith("herdr:") ? "herdr:" : ""}${agentLabel(s.agent)}`;
      let g = groups.find((x) => x.k === k);
      if (!g) groups.push(g = { k, s, rows: [] });
      g.rows.push(...flat(s, 0));
    }
    const groupHead = (g) => {
      const m = asksMode(adapterOf(this.adapters, g.s), this.cfg);
      return h_flex().id(`lg-g-${g.k}`).px(8).pt(6).pb(2).gap(6).items_center().tooltip(m.tip)
        .child(div().text_size(10.5).font_semibold().text_color(t.dim).child(`${agentLabel(g.s.agent).toUpperCase()}${g.k.startsWith("herdr:") ? " (NO HOOKS)" : ""}`))
        .child(div().text_size(10.5).text_color(m.word === "declares asks" ? t.accent : t.dim).child(m.word));
    };
    const ended = roots.filter((s) => s.state === "ended").flatMap((s) => flat(s, 0));
    const row = ([s, depth]) => {
      const open = st.itemsOf(s.sessionId).filter((it) => st.counts(it)).length;
      const gone = !this.demo && !this.parentLive(s);
      const asking = this.forgetAsk === s.sessionId;
      return h_flex().id(`lg-s-${s.sessionId}`).h(26).pr(8).pl(8 + depth * 14).gap(6).items_center().rounded(6).cursor_pointer()
        .when(s.sessionId === sid, (el) => el.bg(t.selected)).hover((x) => x.bg(t.hover))
        .on_click((_e, cx) => {
          this.menu = false;
          if (this.pinned) { this.pinned = s.sessionId; try { localStorage.setItem("pinned", s.sessionId); } catch { /* none */ } }
          else this.override = { sid: s.sessionId, terminal: focused()?.terminal ?? null };
          cx.notify();
        })
        .when(depth > 0, (el) => el.child(svg(ICON("git-branch")).size(11).flex_none().text_color(t.accent)))
        .child(this.pill(t, agentLabel(s.agent)))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(sessionWords(s)))
        .when(Boolean(s.terminal), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(P(s.terminal))))
        .child(div().flex_none().text_size(11).text_color(open ? t.accent : t.dim).child(open ? `${open} open` : gone ? "gone" : s.state))
        .when(gone && !asking, (el) => el.child(div().id(`lg-f-${s.sessionId}`).flex_none().px(5).rounded(4).text_size(10.5).text_color(t.dim)
          .hover((x) => x.bg(t.hover).text_color(t.foreground)).tooltip("Forget this session, its items and its branches")
          .on_click((_e, cx) => { cx.stop_propagation(); this.forgetAsk = s.sessionId; cx.notify(); }).child("forget")))
        .when(asking, (el) => el
          .child(div().id(`lg-fy-${s.sessionId}`).flex_none().px(5).rounded(4).text_size(10.5).bg(t.blocked + "26").text_color(t.blocked)
            .on_click((_e, cx) => { cx.stop_propagation(); this.forget(s, cx); this.menu = false; cx.notify(); }).child("forget + branches"))
          .child(div().id(`lg-fn-${s.sessionId}`).flex_none().px(5).rounded(4).text_size(10.5).text_color(t.dim)
            .on_click((_e, cx) => { cx.stop_propagation(); this.forgetAsk = null; cx.notify(); }).child("keep")));
    };
    return v_flex().flex_none().max_h(220).id("lg-menu").overflow_y_scrollbar().px(6).py(4).gap(1).border_b(1).border_color(t.border).bg(t.surface)
      .children(groups.flatMap((g) => [groupHead(g), ...g.rows.map(row)]))
      .when(ended.length > 0, (el) => el.child(div().px(8).pt(6).pb(2).text_size(10.5).font_semibold().text_color(t.dim).child("ENDED SESSIONS")))
      .children(ended.map(row))
      .when(!list.length, (el) => el.child(div().px(8).py(6).text_size(11.5).text_color(t.dim).child("No sessions yet.")));
  }

  // The focused pane has no ledgr session (current()): say so, and why it may not have one yet.
  awayState(t, away) {
    const line = (s) => div().text_size(11.5).text_color(t.dim).child(s);
    return away.agent
      ? v_flex().p(8).gap(6)
        .child(div().text_size(12.5).text_color(t.muted).child(`No ledgr session for ${P(away.terminal)} (${away.name}) yet.`))
        .child(line("It joins at its next prompt or turn end, when ledgr's hooks report it. ⌘J already parks a question for it."))
        .child(line("Still nothing after a turn? That agent may read another settings file than the one ledgr's hooks are in: a Claude Code started with its own CLAUDE_CONFIG_DIR (a second account, say) needs the three hook entries in that folder's settings.json: ./install.sh offers each Claude config folder it finds."))
        .child(line("The session menu (›) shows the others."))
      : v_flex().p(8).gap(6)
        .child(div().text_size(12.5).text_color(t.muted).child(`${P(away.terminal)} runs no agent ledgr knows.`))
        .child(line("Focus an agent's pane, or pick a session from the menu (›)."));
  }

  emptyState(t) {
    const line = (s) => div().text_size(11.5).text_color(t.dim).child(s);
    return v_flex().p(8).gap(6)
      .child(div().text_size(12.5).text_color(t.muted).child("No ledgr sessions yet."))
      .child(line(this.liveText === null && !this.fallback()
        ? "ledgr-data/store.json does not exist yet: no writer has run. ⌘J still parks a question for any agent pane."
        : "Sessions appear when a Claude session with the ledgr hooks starts, prompts or stops."))
      .child(line("⌘J park a question · ⌘⇧J this panel · herdr-app do ledgr.demo shows sample data"));
  }

  // `note`: extraction running (spinner). `status`: a quiet word in the header, never a fold
  // (the asks lane says "agent working" while the turn runs).
  // `extra`: a control drawn before the count (the asks lane's threshold menu).
  laneHead(t, key, title, count, open, onToggle, note, status, extra) {
    return h_flex().id(`lane-${key}`).flex_none().h(24).px(4).mt(4).gap(6).items_center().cursor_pointer()
      .on_click((_e, cx) => { onToggle(!open); cx.notify(); })
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
      .child(div().flex_1().text_size(10.5).font_semibold().text_color(t.dim).child(title))
      .when(Boolean(note), (el) => el.child(h_flex().flex_none().gap(4).items_center()
        .child(svg(ICON("spinner")).size(11).text_color(t.working).when(this.animOn(), (x) => x.spin(900)))
        .child(div().text_size(10.5).text_color(t.working).child(note))))
      .when(!note && Boolean(status), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.working).opacity(0.75).child(status)))
      .when(Boolean(extra), (el) => el.child(extra))
      .child(div().flex_none().text_size(11).text_color(count ? t.accent : t.dim).child(`${count} open`));
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

  body(t, st, s) {
    const now = Date.now();
    const items = st.itemsOf(s.sessionId);
    const stale = (it) => it.status === "open" && now - (it.updatedAt ?? 0) > DAY;
    const active = (it) => (it.status === "open" || it.status === "answered" || it.status === "rejoin_pending") && !stale(it);
    const asks = items.filter((it) => isAgentAsk(it) && active(it));
    const mine = items.filter((it) => isHuman(it) && active(it));
    // Rows that just left a lane are drawn in place for their fade (ghostRow), never counted.
    const gh = this.ghostItems(s.sessionId);
    const draw = (it, child = false) => (it.__ghost ? this.ghostRow(t, st, s, it) : this.row(t, st, s, it, child));
    const real = (list) => list.filter((it) => !it.__ghost);
    const out = [];

    out.push(this.laneHead(t, "mine", "YOUR QUESTIONS", mine.filter((it) => it.status === "open").length,
      !this.collapsed.mine, (open) => this.setCollapsed("mine", !open)));
    if (!this.collapsed.mine) {
      const sorted = [...mine, ...gh.filter(isHuman)].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      for (const it of sorted) out.push(draw(it));
      if (!sorted.length) out.push(div().px(6).py(3).text_size(11.5).text_color(t.dim).child("No parked questions. ⌘J parks one, even mid-stream."));
      const brs = st.branchesOf(s.sessionId).filter((b) => this.branchVisible(b));
      if (brs.length) {
        const live = brs.filter((b) => !["refused", "failed", "closed", "ended", "nostart"].includes(this.branchLive(b))).length;
        out.push(h_flex().id("lane-branches").flex_none().h(22).px(6).mt(6).gap(6).items_center()
          .child(svg(ICON("git-branch")).size(11).flex_none().text_color(t.dim))
          .child(div().flex_1().text_size(10.5).font_semibold().text_color(t.dim).child("BRANCHES"))
          .child(div().flex_none().text_size(11).text_color(live ? t.accent : t.dim).child(`${live} live`)));
        for (const br of brs) out.push(this.branchRow(t, st, s, br));
      }
    }

    out.push(div().h(1).mx(4).my(6).bg(t.border));
    const pend = st.pendingTurn(s.sessionId);
    const asksOpen = this.asksOpen(s);
    out.push(this.laneHead(t, "asks", "ASKED OF YOU", asks.filter((it) => st.counts(it)).length, asksOpen,
      (open) => this.setAsksOpen(s, open),
      pend !== null ? `extracting turn ${pend}` : null, s.state === "working" ? "agent working" : null, this.thresholdMenu(t, st)));
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
        const open = this.unfolded.has(k) || (turn === newest && !this.folded.has(k));
        const nOpen = real(g).filter((it) => it.status === "open").length;
        const nBlock = real(g).filter((it) => it.status === "open" && isBlocking(it)).length;
        const nAll = real(g).length, nSug = real(sug).length;
        const ti = st.turnInfo(s.sessionId, turn);
        if (!all.length) { if (ti?.asks?.source === "error") out.push(this.errorLine(t, s, turn, ti)); continue; }
        const label = [
          nAll ? `${nAll} ask${nAll === 1 ? "" : "s"}${open ? "" : `, ${nOpen} open${nBlock ? `, ${nBlock} blocking` : ""}`}` : null,
          nSug && (!open || !nAll) ? `${nSug} below threshold` : null,
        ].filter(Boolean).join(" · ");
        out.push(h_flex().id(`grp-${turn}`).flex_none().h(24).px(6).gap(6).items_center().rounded(5).cursor_pointer().hover((x) => x.bg(t.hover))
          .on_click((_e, cx) => {
            if (open) { this.unfolded.delete(k); this.folded.add(k); } else { this.folded.delete(k); this.unfolded.add(k); }
            cx.notify();
          })
          .child(div().flex_1().text_size(11).text_color(t.muted).child(`turn ${turn} · ${label}`))
          .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(10).flex_none().text_color(t.dim)));
        if (ti?.asks?.source === "error") out.push(this.errorLine(t, s, turn, ti));
        if (!open) continue;
        for (const it of g) {
          out.push(draw(it));
          for (const c of items.filter((c) => c.parentId === it.id && isHuman(c) && !isClosed(c))) out.push(this.row(t, st, s, c, true));
        }
        if (real(g).some((it) => !isClosed(it)) || real(sug).some((it) => this.answerOf(it))) {
          const n = real([...g, ...sug]).filter((it) => !isClosed(it) && this.answerOf(it)).length;
          out.push(h_flex().flex_none().pl(6 + IND).pr(6).py(3).gap(8).items_center()
            .child(this.btn(t, `copy-${turn}`, `Copy ${n} answer${n === 1 ? "" : "s"}${s.terminal ? ` for ${P(s.terminal)}` : ""}`, (_e, cx) => this.copyAnswers(s, turn, cx),
              { primary: n > 0, disabled: n === 0, tip: n ? `The answer sheet for turn ${turn}: clipboard + focus ${P(s.terminal, "the pane")}` : "Type an answer or pick an option on an ask first" }))
            .child(div().flex_1().min_w(0).text_size(10.5).text_color(t.dim).child(n ? "clipboard + focus the pane; nothing is typed" : "type an answer or pick an option first")));
        }
        if (sug.length) out.push(...this.suggestions(t, st, s, turn, sug));
      }
      if (!turns.length) out.push(div().px(6).py(3).text_size(11.5).text_color(t.dim).child("Nothing asked of you in this session."));
    }

    for (const [key, title, pick] of [
      ["older", "OLDER THAN A DAY", (it) => stale(it)],
      ["deferred", "DEFERRED", (it) => it.status === "deferred"],
      ["closed", "CLOSED", (it) => isClosed(it)],
    ]) {
      if (!this.folds[key]) continue;
      const list = items.filter(pick).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      out.push(div().h(1).mx(4).my(6).bg(t.border));
      out.push(div().px(4).py(2).text_size(10.5).font_semibold().text_color(t.dim).child(`${title} (${list.length})`));
      for (const it of list) out.push(this.row(t, st, s, it));
    }
    return out;
  }

  // Asks below the threshold: one folded line at the bottom of the turn group, "below threshold (N)";
  // open, each row offers Promote (one click: an open row that counts). Folded again on a click, per turn.
  suggestions(t, st, s, turn, sug) {
    const k = `${s.sessionId}:${turn}`;
    const open = this.sugOpen.has(k);
    const th = st.threshold;
    const f = this.fxOf(`sug:${k}`);   // a suggestion just arrived: the line lights up once
    const n = sug.filter((it) => !it.__ghost).length;
    const out = [h_flex().id(`sug-${turn}`).flex_none().h(24).px(6).gap(6).items_center().rounded(5).relative().cursor_pointer().hover((x) => x.bg(t.hover))
      .tooltip(`Asks below the threshold (now ${TH_WORDS[th]}, set on the ASKED OF YOU head): kept, not counted on the chip`)
      .on_click((_e, cx) => { if (open) this.sugOpen.delete(k); else this.sugOpen.add(k); cx.notify(); })
      .when(Boolean(f), (el) => el.child(this.glow(`sug-glow-${turn}`, t.accent + "26", f, 5)))
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(10).flex_none().text_color(t.dim))
      .child(div().flex_1().text_size(11).text_color(t.dim).child(`below threshold (${n})`))];
    if (open) for (const it of sug) out.push(it.__ghost ? this.ghostRow(t, st, s, it) : this.row(t, st, s, it));
    return out;
  }

  errorLine(t, s, turn, ti) {
    const r = ti.retry;
    const busyRetry = Boolean(r && (r.state === "requested" || r.state === "running") && Date.now() - (r.at ?? 0) < 60000);
    const why = r?.state === "failed" && r.note ? ` (retry: ${r.note})` : "";
    return h_flex().flex_none().px(6).py(3).gap(8).items_center()
      .child(div().id(`err-${turn}`).flex_1().min_w(0).text_size(11).text_color(t.dim).when(Boolean(ti.asks.errorDetail), (el) => el.tooltip(String(ti.asks.errorDetail)))
        .child(`asks not extracted for turn ${turn}${ti.asks.error ? `: ${ti.asks.error}` : ""}${why}`))
      .when(!this.demo, (el) => el.child(this.btn(t, `retry-${turn}`, busyRetry ? "Retrying…" : "Retry", (_e, cx) => this.retry(s, turn, cx), { disabled: busyRetry })));
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
    return h_flex().flex_none().h(30).px(8).gap(4).items_center().border_t(1).border_color(t.border).text_size(11)
      .child(fold("older", "older than a day")).child(fold("deferred", "deferred")).child(fold("closed", "closed"));
  }

  glyph(t, it, sug = false) {
    let g = { open: ["●", t.accent], answered: ["◐", t.accent], resolved: ["✓", t.done], dismissed: ["✕", t.dim], deferred: ["◷", t.muted], rejoin_pending: ["↩", t.accent] }[it.status] ?? ["·", t.dim];
    if (isHuman(it) && it.status === "open" && it.anchor && !it.anchor.settled) g = ["○", t.dim];
    // An open blocking ask: its own shape and colour (the agent stopped on it). A suggestion: hollow.
    else if (it.status === "open" && isBlocking(it) && !sug) g = ["◆", t.blocked];
    else if (it.status === "open" && sug) g = ["○", t.dim];
    return div().w(12).flex_none().text_size(11).text_color(g[1]).child(g[0]);
  }

  btn(t, id, label, onClick, o = {}) {
    const off = Boolean(o.disabled);
    return div().id(id).flex_none().h(22).px(7).flex().items_center().rounded(6).border_1()
      .border_color(o.primary && !off ? t.solid : t.border).bg(o.primary && !off ? t.solid : t.background)
      .text_size(11).text_color(o.primary && !off ? t.solid_foreground : off ? t.dim : t.foreground)
      .when(off, (el) => el.opacity(0.5))
      .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
      .when(!off, (el) => el.cursor_pointer().hover((x) => x.opacity(0.85)).on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); }))
      .child(label);
  }

  // `inert`: drawn for a ghost (a row that just left its lane): compact, nothing clickable.
  row(t, st, s, it, child = false, inert = false) {
    const exp = !inert && this.expanded.has(it.id);
    const f = inert ? null : this.fxOf(it.id);
    const closed = isClosed(it);
    const agent = isAgentAsk(it);
    const dimmed = agent && it.origin === "extract_model" && this.cfg.extract?.mode === "always-model";
    const q = it.anchor?.quote ? squash(it.anchor.quote) : "";
    const parent = it.parentId ? st.item(it.parentId) : null;
    const text = it.text || (it.kind === "bookmark" ? `bookmark: “${q.slice(0, 120)}”` : "");
    const badges = [];
    const brOf = isHuman(it) ? st.branchesFor(it.id).find((b) => b.status !== "refused" && b.status !== "failed") ?? null : null;
    const sug = agent && isSuggestion(it, st.threshold);
    const level = agent ? levelOf(it) : null;
    if (agent && level === "blocking") badges.push(["blocking", t.blocked]);
    else if (agent && (sug || level !== "needed")) badges.push([level, t.dim]);
    if (agent && it.promoted && !sug) badges.push(["promoted", t.muted]);
    if (agent && it.repeatOf) badges.push(["raised again", t.accent]);
    if (it.origin === "btw" || it.btwStagedAt) badges.push(["/btw", t.muted]);
    if (isHuman(it) && it.askedAtTurn) badges.push([`sent at turn ${it.askedAtTurn}`, t.muted]);
    const sub = [];
    if (isHuman(it)) {
      if (it.status === "open" && it.anchor && !it.anchor.settled) sub.push(`parked during turn ${it.anchor.turn}; anchors at end of turn`);
      else {
        const bits = [`turn ${it.anchor?.turn ?? "?"}`];
        if (parent && !child) bits.push(`re ${H(parent)}`);
        if (q && it.kind !== "bookmark") bits.push(`“${q.slice(0, 48)}${q.length > 48 ? "…" : ""}”`);
        if (it.anchor?.interrupted) bits.push("turn interrupted");
        if (it.anchor?.reanchoredFrom !== undefined) bits.push(`re-anchored from turn ${it.anchor.reanchoredFrom}`);
        sub.push(bits.join(" · "));
      }
    }
    if (agent && it.status === "answered" && it.answer) sub.push(`→ ${squash(it.answer).slice(0, 140)}`);
    if (it.status === "rejoin_pending") {
      const rb = st.d.branches[it.rejoin?.branchId];
      sub.push(`the confluence from its branch${rb?.name ? ` (${rb.name})` : ""} is on the clipboard: resolves when it is sent in ${trunkWords(s?.terminal)}`);
    }
    if (it.status === "resolved" && it.resolvedBy === "branch") { const rn = st.d.branches[it.resolution?.branchId]?.name; sub.push(`resolved by its branch${rn ? ` (${rn})` : ""} at turn ${it.resolvedTurn ?? "?"}`); }
    if (it.note) sub.push(it.note);
    if (it.status === "deferred") sub.push(it.deferUntil === "next_session" ? "deferred to next session" : typeof it.deferUntil === "number" ? `deferred until ${new Date(it.deferUntil).toLocaleString()}` : "deferred");

    // The glyph, handle, kind and badges are a line of their own, so the text keeps the row's whole
    // width and wraps in full. No height cap anywhere in a row: a capped, overflow-hidden text box
    // cut its second line and let the options below draw against it.
    const head = v_flex().id(`rowh-${it.id}`).gap(2).cursor_pointer()
      .when(!inert, (el) => el.on_click((_e, cx) => this.toggle(it, cx)))
      .child(h_flex().flex_wrap().gap(6).items_center()
        .child(this.glyph(t, it, sug))
        .child(div().flex_none().font_semibold().text_size(11.5).text_color(t.muted).child(H(it)))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(it.kind ?? ""))
        .children(badges.map(([b, c]) => div().flex_none().px(5).rounded(4).bg(c + "22").text_size(10).text_color(c).child(b)))
        .when(Boolean(brOf), (el) => el.child(h_flex().id(`brb-${it.id}`).flex_none().gap(3).px(5).rounded(4).items_center().bg(t.accent + "22")
          .tooltip(`Branched: its branch ${brOf.name} is ${BR_WORD[this.branchLive(brOf)] ?? brOf.status}`)
          .child(svg(ICON("git-branch")).size(10).flex_none().text_color(t.accent)).child(div().text_size(10).text_color(t.accent).child("branched"))))
        // A suggestion's one-click way out of the fold.
        .when(sug && !closed && !inert, (el) => el.child(div().id(`promote-${it.id}`).flex_none().px(5).rounded(4).border_1().border_color(t.border)
          .text_size(10).text_color(t.muted).cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground))
          .tooltip("Make it an open ask: it leaves the below-threshold line and counts on the chip")
          .on_click((_e, cx) => { cx.stop_propagation(); this.act(it.id, "promote", null, cx); }).child("promote"))))
      .when(Boolean(text), (el) => el.child(div().pl(IND).text_size(12.5)
        .text_color(closed ? t.dim : dimmed || sug ? t.muted : t.foreground).when(it.status === "dismissed", (x) => x.line_through()).child(text)));

    // Motion: entering, the row fades in from 6 px above (staggered when several arrive) under a
    // highlight (blocked colour for a blocking ask, else accent); answered, a `done` highlight, and
    // an open row folds its details (fading first). The pointer passing over records the row's
    // height, so a row closed by a click can collapse from it (observe, ghostRow).
    const glowColor = f?.kind === "answered" ? t.done + "2e" : isBlocking(it) ? t.blocked + "2e" : t.accent + "26";
    const ease = (ms) => ({ duration: ms, delay: (f?.k ?? 0) * 45, easing: "ease-out" });
    return v_flex().id(`row-${it.id}`).flex_none().relative().rounded(7).px(6).py(6).gap(5).when(child, (el) => el.ml(IND).border_l(1.5).border_color(t.input))
      .when(exp, (el) => el.bg(t.raised)).hover((x) => x.bg(exp ? t.raised : t.hover))
      .when(!inert && this.animOn(), (el) => el.on_mouse_move((e) => { const h = e?.bounds?.height; if (h > 0) this.rowH.set(it.id, { h, at: Date.now(), exp }); }))
      .when(f?.kind === "enter", (el) => el.opacity(f.phase ? 1 : 0).top(f.phase ? 0 : -6).transition("opacity", ease(200)).transition("top", ease(260)))
      .when(Boolean(f), (el) => el.child(this.glow(`glow-${it.id}`, glowColor, f, 7)))
      .child(head)
      // Options: a wrapped set of buttons under the text; a long one shrinks to the row and wraps.
      .when(agent && it.kind === "decide" && (it.options ?? []).length > 0, (el) => el.child(
        h_flex().flex_wrap().gap(6).pl(IND).children(it.options.map((o, i) => {
          const chosen = (it.draft ?? "").trim() === o;
          return div().id(`opt-${it.id}-${i}`).min_w(0).px(8).py(2).rounded(6).border_1().border_color(chosen ? t.accent : t.border)
            .text_size(11.5).text_color(chosen ? t.accent : t.muted).when(!closed && !inert, (d) => d.cursor_pointer().hover((x) => x.bg(t.hover))
              .on_click((_e, cx) => { cx.stop_propagation(); this.setDraft(it, o, cx); }))
            .child(o === it.recommended ? `${o} (rec.)` : o);
        }))))
      .children(sub.map((line) => div().pl(IND).text_size(11).text_color(t.dim).child(line)))
      .when(exp, (el) => el.child(this.details(t, st, s, it)
        .when(Boolean(f?.fold), (d) => d.opacity(f.phase ? 0 : 1).transition("opacity", { duration: 160, easing: "ease-out" }))));
  }

  passageView(t, it, text, whole) {
    const { before, hit, after } = passageParts(text, it.anchor?.quote, whole);
    const md = (k, body) => TextView.markdown(`ps-${k}-${it.id}`, body);
    // No height cap: the panel's own list scrolls (a capped box inside it neither scrolled nor showed a bar).
    return v_flex().id(`ps-box-${it.id}`).rounded(6).border_1().border_color(t.border).bg(t.background).px(8).py(6).gap(4).text_size(12)
      .when(Boolean(before), (el) => el.child(div().text_color(t.muted).child(md("b", before))))
      .when(Boolean(hit), (el) => el.child(div().pl(7).py(2).border_l(2).border_color(t.accent).bg(t.accent + "14").rounded(3).child(md("h", hit))))
      .when(Boolean(after), (el) => el.child(div().text_color(t.muted).child(md("a", after))));
  }

  details(t, st, s, it) {
    const agent = isAgentAsk(it);
    const closed = isClosed(it);
    const k = `${it.anchor?.sessionId}:${it.anchor?.turn}`;
    const text = this.passages.get(k);
    // Only the quote shows by default; the anchoring message waits behind "show whole message" and
    // opens at its full height (the panel's list scrolls), the quote's paragraph highlighted.
    const whole = this.whole.has(it.id);
    const toggle = div().id(`whole-${it.id}`).text_size(10.5).text_color(t.accent).cursor_pointer()
      .on_click((_e, cx) => { whole ? this.whole.delete(it.id) : this.whole.add(it.id); cx.notify(); })
      .child(whole ? "hide whole message" : "show whole message");
    const passage = !whole ? toggle
      : text === undefined
        ? v_flex().gap(3).child(div().text_size(11).text_color(t.dim).child("Loading passage…")).child(toggle)
        : text === null
          ? v_flex().gap(3).child(div().text_size(11).text_color(t.dim).child(`Passage not saved for turn ${it.anchor?.turn} (ledgr-data/turns/…/${it.anchor?.turn}.md).`)).child(toggle)
          : v_flex().gap(3).child(this.passageView(t, it, text, true)).child(toggle);
    const quote = it.anchor?.quote ? squash(it.anchor.quote) : "";
    const input = this.inputs.get(it.id);
    // Few buttons: Done, Defer ▾ (tomorrow, in a week, next session), the row's own primary action
    // (Promote, Branch…, Copy confluence again) and ⋯ for the rest (Not needed, Ask about this, the
    // question's copy actions, Go to anchor or Resume session).
    const a = [], more = [];
    const b = (id, label, fn, o) => a.push(this.btn(t, `${id}-${it.id}`, label, fn, o));
    const m = (id, label, fn, o) => more.push([id, label, fn, o]);
    const pend = it.status === "rejoin_pending";
    const pendBr = pend ? st.d.branches[it.rejoin?.branchId] ?? null : null;
    if (closed || it.status === "deferred") b("reopen", "Reopen", (_e, cx) => this.act(it.id, "reopen", null, cx));
    if (pend && pendBr?.conclusion?.message) b("again", "Copy confluence again", (_e, cx) => this.copyConfluence(st, pendBr, cx), { primary: true });
    if (!closed) b("done", "Done", (_e, cx) => this.act(it.id, "resolve", null, cx), { tip: DONE_TIP });
    if (!closed && it.status !== "deferred" && !pend) a.push(this.menuButton(t, `defer-${it.id}`, "Defer ▾", [
      ["tomorrow", "Tomorrow", (_e, cx) => this.act(it.id, "defer", Date.now() + DAY, cx)],
      ["week", "In a week", (_e, cx) => this.act(it.id, "defer", Date.now() + 7 * DAY, cx)],
      ["next", "Next session", (_e, cx) => this.act(it.id, "defer", "next_session", cx), { tip: "Opens again when a session starts in the same folder" }],
    ], { width: 150 }));
    if (agent && !closed && isSuggestion(it, st.threshold)) b("promote", "Promote", (_e, cx) => this.act(it.id, "promote", null, cx), { tip: "Make it an open ask that counts on the chip" });
    if (isHuman(it) && !closed && !pend) {
      const ok = this.branchable(s);
      const again = st.branchesFor(it.id).some((x) => x.status !== "refused" && x.status !== "failed");
      b("branch", again ? "Branch again…" : "Branch…", (_e, cx) => this.openConfirm(it, s, cx),
        { disabled: !ok, tip: ok ? "Fork this session into a new Claude session to settle this question" : "Branching needs a Claude Code session with the ledgr hooks" });
    }
    if (!closed && !pend) m("dismiss", "Not needed", (_e, cx) => this.act(it.id, "dismiss", null, cx), { tip: NOT_NEEDED_TIP });
    if (pend) m("calloff", "Call off the confluence", (_e, cx) => this.act(it.id, "reopen", null, cx), { tip: "Back to open; the branch keeps your edited conclusion for the next Conclude" });
    if (agent && !closed) m("ask", "Ask about this", (_e, cx) => this.askAbout(it, s, cx));
    if (isHuman(it) && !closed && !pend && it.text) {
      m("prompt", "Copy for prompt", (_e, cx) => this.stageQuestion(it, s, false, cx), { tip: `Copies “[${it.handle}] …”: that tag in a prompt marks ${H(it)} sent` });
      m("btw", "Stage /btw", (_e, cx) => this.stageQuestion(it, s, true, cx));
    }
    // Go to anchor needs the session's terminal; when it is gone, a Claude session can be resumed in a
    // new pane instead (the saved passage above stays either way).
    const gone = this.terminalGone(st, s);
    const rs = s.resume;
    const resuming = Boolean(rs && (rs.state === "launching" || rs.state === "launched") && Date.now() - (rs.at ?? 0) < 60000);
    if (!gone) m("go", "Go to anchor", (_e, cx) => this.goTo(it, s, cx), { tip: "Show the passage here, focus the pane and copy a slice of the quote to search for (no keys are sent)" });
    else if (!this.branchable(s)) m("go", "Go to anchor", () => {}, { disabled: true, tip: `Its terminal${s.terminal ? ` (${P(s.terminal)})` : ""} is gone, and only a Claude Code session can be resumed. The saved passage is above.` });
    else {
      const tx = this.transcriptOk(s);
      if (tx === false) m("resume", "Transcript gone", () => {}, { disabled: true, tip: `No transcript at ${transcriptPathOf(s, home())}: nothing to resume. The saved passage is above.` });
      else m("resume", resuming ? "Resuming…" : "Resume session…", (_e, cx) => this.resume(s, cx),
        { disabled: resuming || tx !== true, tip: tx === undefined ? "Checking the transcript…" : `Its terminal${s.terminal ? ` (${P(s.terminal)})` : ""} is gone: start claude --resume ${String(s.sessionId).slice(0, 8)} in ${s.cwd || "its folder"}, in a new pane` });
    }
    if (more.length) a.push(this.menuButton(t, `more-${it.id}`, "⋯", more, { anchor: "top_right", tip: "More actions" }));
    return v_flex().id(`det-${it.id}`).pl(IND).pt(4).gap(8)
      // The quote, capped: an over-long one (a whole message taken as the ask) ends in "…".
      .when(Boolean(quote) && it.kind !== "bookmark", (el) => el.child(div().text_size(11.5).italic().text_color(t.muted)
        .child(`“${quote.length > 300 ? `${quote.slice(0, 280).trimEnd()}…` : quote}”`)))
      .child(passage)
      .when(agent && !closed && Boolean(input), (el) => el.child(v_flex().gap(4)
        .child(h_flex().gap(6).items_center()
          .child(h_flex().flex_1().min_w(0).h(28).px(8).items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
            .child(Input.new(input).flex_1().h_full().text_size(12).text_color(t.foreground)))
          .child(this.btn(t, `copy1-${it.id}`, "Copy answer", (_e, cx) => this.copyAnswer(it, s, cx),
            { primary: Boolean(this.answerOf(it)), disabled: !this.answerOf(it), tip: this.answerOf(it) ? `${H(it)}'s answer alone: clipboard + focus ${P(s.terminal, "the pane")}` : "Type an answer or pick an option first" })))
        .child(div().text_size(10.5).text_color(t.dim).child("Drafts reach the agent via Copy answer(s); Resolve only records it here."))))
      .child(h_flex().flex_wrap().gap(6).children(a))
      .when(gone && rs?.state === "failed", (el) => el.child(div().text_size(10.5).text_color(t.blocked).child(`Resume did not start: ${rs.error ?? "unknown error"}`)))
      .when(gone && rs?.state === "launched" && Boolean(rs.note), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(`Resumed in ${P(rs.terminal)}: ${rs.note}`)))
      .when(this.confirm?.itemId === it.id && isHuman(it) && !closed, (el) => el.child(this.confirmBox(t, st, s, it)))
      .child(div().id(`foot-${it.id}`).text_size(10).text_color(t.dim).when(Boolean(it.anchor?.hash), (el) => el.tooltip(`passage #${it.anchor.hash}`))
        .child([H(it), originWords(it.origin), agent ? levelOf(it) : null, `turn ${it.anchor?.turn ?? "?"}`].filter(Boolean).join(" · ")));
  }

  // ── branch rendering (Phase 2) ───────────────────────────────────────
  manifestView(t, m, frozen = false) {
    if (!m) return div().text_size(11).text_color(t.dim).child("No manifest recorded (started outside the panel).");
    return v_flex().gap(3).children(manifestLines(m, { frozen }).map(([k, v]) => h_flex().gap(6).items_start()
      .child(div().w(66).flex_none().text_size(10.5).text_color(t.dim).child(k))
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(k === "Refused" ? t.blocked : t.foreground).child(v))));
  }

  // The Branch confirmation: the manifest BEFORE launch, the placement, the worktree toggle.
  confirmBox(t, st, s, it) {
    const m = this.confirmManifest(st, it, s);
    const c = this.confirm;
    const git = this.demo ? true : this.gitOk.get(s.cwd);
    const seg = (id, label, on, fn, o = {}) => div().id(id).flex_none().h(22).px(7).flex().items_center().rounded(6).border_1()
      .border_color(on ? t.accent : t.border).bg(on ? t.accent + "1f" : t.background).text_size(11)
      .text_color(on ? t.accent : o.disabled ? t.dim : t.foreground)
      .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
      .when(Boolean(o.disabled), (el) => el.opacity(0.5))
      .when(!o.disabled, (el) => el.cursor_pointer().hover((x) => x.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); fn(); cx.notify(); }))
      .child(label);
    return v_flex().id(`brc-${it.id}`).gap(8).p(8).rounded(7).border_1().border_color(m.refused ? t.blocked : t.accent).bg(t.background)
      .child(h_flex().gap(6).items_center()
        .child(svg(ICON("git-branch")).size(12).flex_none().text_color(m.refused ? t.blocked : t.accent))
        .child(div().flex_1().min_w(0).font_semibold().text_size(12).child(`Branch ${H(it)}: what the branch will know`)))
      .child(this.manifestView(t, m))
      .child(h_flex().flex_wrap().gap(6).items_center()
        .child(seg(`brc-split-${it.id}`, m.parentDepth ? "beside its parent" : "beside the trunk", !c.isolate && c.placement === "split", () => { c.placement = "split"; c.isolate = false; },
          { tip: "A sub-agent of the parent's terminal, given a pane right of it" }))
        .child(seg(`brc-agent-${it.id}`, "sub-agent only", !c.isolate && c.placement === "agent", () => { c.placement = "agent"; c.isolate = false; },
          { tip: "No pane: peek it from the agents list (peek's keep gives it one)" }))
        .child(seg(`brc-wt-${it.id}`, "isolate in a worktree", Boolean(c.isolate), () => { c.isolate = !c.isolate; },
          { disabled: git !== true, tip: git === true ? "Herdr's worktree: a new checkout from HEAD in a new space; the agents tree will not nest it under the trunk" : git === false ? "The trunk's folder is not a git checkout" : "Checking for git…" })))
      .child(h_flex().flex_wrap().gap(6).items_center()
        .child(this.btn(t, `brc-go-${it.id}`, "Launch branch", (_e, cx) => this.launch(it, s, cx), { primary: true, disabled: Boolean(m.refused) }))
        .child(this.btn(t, `brc-x-${it.id}`, "Cancel", (_e, cx) => { this.confirm = null; cx.notify(); })))
      .child(div().text_size(10.5).text_color(t.dim).child("starts one process, claude --resume … --fork-session; nothing is typed into the trunk"));
  }

  // The latest finished turn of each expanded branch's session, read once per stop (render
  // side effect, guarded: a read starts only when that turn's stop time changes).
  pumpBranchMessages(st, s, cx) {
    this.brMsg ??= new Map();
    for (const b of st.branchesOf(s.sessionId)) {
      if (!this.brOpen.has(b.id) || !b.sessionId) continue;
      const c = st.d.sessions[b.sessionId];
      if (!c || !c.turn) continue;
      const ti = st.turnInfo(c.sessionId, c.turn);
      const k = `${c.sessionId}:${c.turn}:${ti?.stopAt ?? 0}`;
      const cur = this.brMsg.get(b.id);
      if (cur?.k === k || cur?.loading === k) continue;
      if (this.demo) { this.brMsg.set(b.id, { k, turn: c.turn, text: FIXTURE_TURNS[`${c.sessionId}:${c.turn}`] ?? ti?.textHead ?? null }); continue; }
      if (!ti?.stopAt) continue;
      this.brMsg.set(b.id, { ...(cur ?? {}), loading: k });
      cx.timer.after(0, (cx) => cx.spawn(async (cx) => {
        const p = ti.textPath ? (ti.textPath.startsWith("/") ? ti.textPath : `${dataDir()}/${ti.textPath}`) : turnPath(c.sessionId, c.turn);
        const text = await readTextFile(p).catch(() => null);
        this.brMsg.set(b.id, { k, turn: c.turn, text: text ?? ti.textHead ?? null });
        cx.notify();
      }));
    }
  }

  branchRow(t, st, s, br) {
    const live = this.branchLive(br);
    const open = this.brOpen.has(br.id);
    const child = br.sessionId ? st.d.sessions[br.sessionId] ?? null : null;
    const it = st.item(br.requestId);
    const kids = child ? st.itemsOf(child.sessionId).filter((x) => !isClosed(x)) : [];
    const color = { working: t.working, blocked: t.blocked, done: t.done, failed: t.blocked, nostart: t.blocked, refused: t.dim, closed: t.dim, ended: t.dim }[live] ?? t.muted;
    const spin = live === "working" || live === "launching" || live === "launched" || live === "starting";
    const msg = this.brMsg?.get(br.id);
    const concl = msg?.text ? extractConclusion(msg.text) : null;
    const staged = br.status === "concluded" || br.status === "rejoined";
    const when = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null);
    const facts = [
      child ? `session ${child.sessionId.slice(0, 8)}${child.turn ? ` · its turn ${child.turn}` : ""}` : br.childSid ? `session ${br.childSid.slice(0, 8)} (planned)` : null,
      br.terminal ? P(br.terminal) : null,
      br.placement === "split" ? "pane beside the trunk" : br.placement === "agent" ? "sub-agent" : null,
      br.isolate ? "own worktree" : null,
      when(br.startedAt ?? br.launchedAt ?? br.createdAt) ? `started ${when(br.startedAt ?? br.launchedAt ?? br.createdAt)}` : null,
      br.external ? "launched outside the panel" : null,
    ].filter(Boolean).join(" · ");
    const head = v_flex().id(`brh-${br.id}`).gap(2).cursor_pointer()
      .on_click((_e, cx) => { if (open) this.brOpen.delete(br.id); else this.brOpen.add(br.id); cx.notify(); })
      .child(h_flex().gap(6).items_center()
        .child(div().w(12).flex_none().flex().items_center()
          .child(spin ? svg(ICON("spinner")).size(11).text_color(t.working).when(this.animOn(), (x) => x.spin(900)) : svg(ICON("git-branch")).size(11).text_color(color)))
        .child(div().flex_none().font_semibold().text_size(11.5).text_color(t.foreground).child(branchWords(it)))
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(br.name ?? br.id.slice(0, 11)))
        .when(kids.length > 0, (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.accent + "22").text_size(10).text_color(t.accent)
          .child(`${kids.length} open`)))
        .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(10).flex_none().text_color(t.dim)))
      .child(div().pl(IND).text_size(11).text_color(t.muted)
        .child(`depth ${br.depth ?? "?"} · ${BR_WORD[live] ?? live ?? "?"}${br.status === "rejoined" && live !== "rejoined" ? ` · rejoined at turn ${br.rejoinedTurn ?? "?"}` : br.status === "concluded" && live !== "concluded" ? " · concluded" : ""}`));
    const focusOk = Boolean(br.terminal) && !["closed", "ended", "failed", "refused", "nostart"].includes(live);
    const canC = this.canConclude(st, br);
    return v_flex().id(`br-${br.id}`).flex_none().rounded(7).px(6).py(6).gap(5).ml(4).border_l(1.5).border_color(t.input)
      .when(open, (el) => el.bg(t.raised)).hover((x) => x.bg(open ? t.raised : t.hover))
      .child(head)
      .when(Boolean(br.error), (el) => el.child(div().pl(IND).text_size(11).text_color(br.status === "refused" ? t.dim : t.blocked).child(`${br.status === "refused" ? "Refused" : "Not started"}: ${br.error}`)))
      .when(open, (el) => el.child(v_flex().pl(IND).gap(8)
        .child(this.manifestView(t, br.manifest, true))
        .when(Boolean(facts), (x) => x.child(div().text_size(10.5).text_color(t.dim).child(facts)))
        .when(kids.length > 0, (x) => x.child(div().text_size(10.5).font_semibold().text_color(t.dim).child("ASKED IN THIS BRANCH")))
        .children(kids.map((k) => this.row(t, st, child, k, true)))
        .when(staged, (x) => x.child(this.confluenceView(t, st, s, br)))
        .when(!staged && Boolean(concl), (x) => x.child(v_flex().gap(3)
          .child(div().text_size(10.5).font_semibold().text_color(t.dim).child(`CONCLUSION (its turn ${msg.turn}; Conclude… carries it back)`))
          .child(div().rounded(5).border_1().border_color(t.border).bg(t.background).px(7).py(4).text_size(11.5).children(this.lines(concl)))))
        .when(!staged && !concl && Boolean(msg?.text), (x) => x.child(v_flex().gap(3)
          .child(div().text_size(10.5).font_semibold().text_color(t.dim).child(`LAST MESSAGE (turn ${msg?.turn})`))
          .child(div().id(`brm-box-${br.id}`).max_h(160).overflow_y_scrollbar().rounded(5).border_1().border_color(t.border).bg(t.background).px(7).py(4).text_size(11.5)
            .child(TextView.markdown(`brm-${br.id}`, String(msg?.text ?? "").slice(0, 1200))))))
        .when(this.conclude?.branchId === br.id, (x) => x.child(this.concludeBox(t, st, s, br)))
        .when(this.preOpen.has(br.id) && Boolean(br.preamble), (x) => x.child(div().rounded(5).border_1().border_color(t.border).bg(t.background).px(7).py(4)
          .text_size(11).text_color(t.muted).child(TextView.markdown(`brp-${br.id}`, br.preamble))))
        .child(this.branchActions(t, st, s, br, { canC, concl, staged, focusOk, live, it }))));
  }

  // A branch row's buttons, reduced like an item's: the one primary step (Conclude… / Edit
  // conclusion…, or Close branch after rejoin, with its End / Keep) and ⋯ for Focus, Copy again,
  // Ask for a conclusion and the preamble.
  branchActions(t, st, s, br, { canC, concl, staged, focusOk, live, it }) {
    const more = [];
    more.push(["focus", "Focus the branch", (_e, cx) => this.focusBranch(br, cx),
      { disabled: !focusOk, tip: focusOk ? "Focus the branch's pane (a peek when it has none)" : "The branch has no live terminal" }]);
    if (br.status === "concluded" && br.conclusion?.message) more.push(["again", "Copy the confluence again", (_e, cx) => this.copyConfluence(st, br, cx),
      { tip: "The staged message to the clipboard again, and focus the trunk" }]);
    if (canC && !concl && !staged && focusOk && this.conclude?.branchId !== br.id) more.push(["ask", "Ask for a conclusion", (_e, cx) => this.askForConclusion(st, br, cx),
      { tip: "Stage a short request for a ledgr-conclusion block in the branch's pane" }]);
    if (!canC && br.status !== "rejoined") more.push(["conclude", "Conclude…", () => {}, { disabled: true,
      tip: it && isClosed(it) ? `${H(it)} is ${it.status}: nothing to carry back` : "The branch has not started" }]);
    if (br.preamble) more.push(["pre", this.preOpen.has(br.id) ? "Hide the preamble" : "Show the preamble",
      (_e, cx) => { if (this.preOpen.has(br.id)) this.preOpen.delete(br.id); else this.preOpen.add(br.id); cx.notify(); }]);
    return h_flex().flex_wrap().gap(6)
      .when(canC && this.conclude?.branchId !== br.id, (x) => x.child(this.btn(t, `brk-${br.id}`, br.status === "concluded" ? "Edit conclusion…" : "Conclude…",
        (_e, cx) => this.openConclude(st, br, cx), { primary: br.status !== "concluded" && Boolean(concl), tip: "Edit what goes back to the trunk, then stage it on the clipboard" })))
      .when(br.status === "rejoined" && !br.closedAt && this.closeAsk !== br.id && live !== "closed", (x) => x.child(this.btn(t, `brx-${br.id}`, "Close branch",
        (_e, cx) => { this.closeAsk = br.id; cx.notify(); }, { tip: "End the branch's terminal; its record and conclusion stay" })))
      .when(this.closeAsk === br.id, (x) => x
        .child(div().id(`brxy-${br.id}`).flex_none().h(22).px(7).flex().items_center().rounded(6).bg(t.blocked + "26").text_size(11).text_color(t.blocked).cursor_pointer()
          .on_click((_e, cx) => { cx.stop_propagation(); this.closeBranch(br, cx); }).child(`End ${P(br.terminal, br.name)}`))
        .child(this.btn(t, `brxn-${br.id}`, "Keep", (_e, cx) => { this.closeAsk = null; cx.notify(); })))
      .child(this.menuButton(t, `brmore-${br.id}`, "⋯", more, { anchor: "top_right", tip: "More actions" }));
  }

  // Text with line breaks, one div per line (a div does not break at "\n").
  lines(text) {
    return String(text ?? "").split(/\r?\n/).map((l) => div().child(l || " "));
  }

  // A concluded (staged) or rejoined branch: the conclusion as sent, and where it stands.
  confluenceView(t, st, s, br) {
    const it = st.item(br.requestId);
    const rejoined = br.status === "rejoined";
    const when = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
    return v_flex().gap(3)
      .child(div().text_size(10.5).font_semibold().text_color(rejoined ? t.done : t.accent).child(rejoined
        ? `REJOINED · landed in ${trunkWords(s.terminal)} at turn ${br.rejoinedTurn ?? "?"} (${when(br.rejoinedAt)})`
        : `CONFLUENCE STAGED ${when(br.concludedAt)} · waiting for the paste`))
      .child(div().rounded(5).border_1().border_color(rejoined ? t.done : t.accent).bg(t.background).px(7).py(4).text_size(11.5).children(this.lines(br.conclusion?.text ?? "(no conclusion text recorded)")))
      .when(!rejoined, (x) => x.child(div().text_size(10.5).text_color(this.trunkWord(s) === "working" ? t.working : t.dim).child(this.trunkLine(s, it))))
      .when(rejoined, (x) => x.child(div().text_size(10.5).text_color(t.dim).child(
        `${it ? H(it) : "The question"} resolved by this branch · line in ledgr-data/sessions/${String(s.sessionId).slice(0, 8)}…/decisions.md${br.closedAt ? ` · terminal closed ${when(br.closedAt)}` : ""}`)))
      .when(Boolean(br.closeError), (x) => x.child(div().text_size(10.5).text_color(t.blocked).child(`Close failed: ${br.closeError}`)));
  }

  // The Conclude editor: the prefilled, editable conclusion; the message as it will be staged; the
  // trunk's live status. Send to trunk never types.
  concludeBox(t, st, s, br) {
    const k = this.conclude, it = st.item(br.requestId);
    const F = forkTurnOf(br);
    const text = String(k.text ?? "").trim();
    const msg = it ? confluenceMessage({ branch: br, item: it, text: text || "…" }) : "";
    const src = k.source === "loading" ? "Reading the branch's messages…"
      : k.source === "block" ? `Prefilled from the branch's ledgr-conclusion block (its turn ${k.turn}). Edit freely.`
      : k.source === "last" ? `No ledgr-conclusion block: prefilled with the branch's last message (its turn ${k.turn}). Trim it, or ask the branch for a conclusion.`
      : k.source === "edited" ? "Your earlier edit (the confluence was called off or is being changed)."
      : "The branch has not answered yet: write the conclusion yourself, or ask the branch for one.";
    const moved = s.turn > F ? `The trunk is at turn ${s.turn}; the branch saw it up to turn ${F}. Check the conclusion against turns ${F + 1}–${s.turn}: the message tells the trunk what the branch saw.` : null;
    const ask = k.source !== "block" && k.source !== "loading" && Boolean(br.terminal) && !["closed", "ended", "nostart"].includes(this.branchLive(br));
    return v_flex().id(`brk-box-${br.id}`).gap(8).p(8).rounded(7).border_1().border_color(t.accent).bg(t.background)
      .child(h_flex().gap(6).items_center()
        .child(svg(ICON("git-branch")).size(12).flex_none().text_color(t.accent))
        .child(div().flex_1().min_w(0).font_semibold().text_size(12).child(`Conclude the ${branchWords(it)}: what goes back to ${trunkWords(s.terminal)}`)))
      .child(div().text_size(10.5).text_color(t.dim).child(src))
      .child(v_flex().rounded(7).border_1().border_color(t.input).bg(t.background).px(6).py(4)
        .child(Textarea.new(k.input).w_full().text_size(12).text_color(t.foreground)))
      .when(Boolean(moved), (el) => el.child(div().text_size(10.5).text_color(t.blocked).child(moved)))
      .child(div().text_size(10.5).font_semibold().text_color(t.dim).child(`THE MESSAGE · ${wrapperWords(msg, text || "…")} words around your text; no transcript`))
      .child(v_flex().id(`brk-msg-${br.id}`).max_h(170).overflow_y_scrollbar().rounded(5).border_1().border_color(t.border).bg(t.surface).px(7).py(4).text_size(11).text_color(t.muted).children(this.lines(msg)))
      .child(div().text_size(10.5).text_color(this.trunkWord(s) === "working" ? t.working : t.dim).child(this.trunkLine(s, it)))
      .child(h_flex().flex_wrap().gap(6).items_center()
        .child(this.btn(t, `brk-send-${br.id}`, "Send to trunk", (_e, cx) => this.sendToTrunk(st, br, cx),
          { primary: true, disabled: !text || !it, tip: "Clipboard + focus the trunk's pane; nothing is typed. The question resolves when you send it there." }))
        .when(ask, (el) => el.child(this.btn(t, `brk-ask-${br.id}`, "Ask for a conclusion", (_e, cx) => this.askForConclusion(st, br, cx))))
        .when(k.edited && k.source !== "edited" && Boolean(k.prefill), (el) => el.child(this.btn(t, `brk-reset-${br.id}`, "Reset",
          (_e, cx) => { k.input.set_value(k.prefill); k.text = k.prefill; k.edited = false; cx.notify(); })))
        .child(this.btn(t, `brk-x-${br.id}`, "Cancel", (_e, cx) => { this.conclude = null; cx.notify(); })));
  }
}
