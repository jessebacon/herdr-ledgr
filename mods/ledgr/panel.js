// ledgr panel (spec 6): the panel-body stack child in layouts/custom.json, props {view: "panel"}.
// A reader: it loads ledgr-data/store.json and follows it with watchFolder. The writer (spool
// ingest, store.json, chips) runs in the always-shown my-tabs copy (writer.js); every act here
// (resolve, defer, dismiss, reopen, draft, seen, retry) is posted as a spool event. Only when no
// my-tabs writer answers does this copy run a fallback Writer. localStorage holds UI prefs only.
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
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { theme, props, shared, setShared, focused, layout, run, watchFolder, readTextFile, openOverlay, agents, terminals, panes, exec } from "herdr";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { FORCE_DEMO, DEFAULTS, loadConfig, dataDir, turnPath, agentLabel, storePath } from "./config.js";
import { Store, isAgentAsk, isHuman, isClosed } from "./store.js";
import { writeEvent } from "./spool.js";
import { Writer, writerClaim, engineDrift } from "./writer.js";
import { goToAnchor, stageText, busy, btwText } from "./nav.js";
import { demoData, FIXTURE_TURNS, DEMO_SESSION } from "./fixtures.js";
import { manifest, manifestLines, liveStatus, maxDepthOf, preamble, branchName } from "./branch.js";
import { confluenceMessage, answersSheet, conclusionRequest, extractConclusion, forkTurnOf, wrapperWords, leadIn } from "./confluence.js";

const ICON = (n) => `mods/workspace-chrome/${n}.svg`;
const DAY = 86400e3;
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const plain = (s) => squash(String(s ?? "").replace(/[`*_#>]+/g, ""));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HOUR = 3600e3;
const BR_WORD = { working: "working", blocked: "needs you", done: "done", idle: "idle", starting: "starting", launching: "launching…",
  launched: "starting", running: "running", closed: "closed", ended: "ended", failed: "launch failed", refused: "refused",
  nostart: "did not start (see its terminal's error toast)", concluded: "concluded", rejoined: "rejoined" };

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = findNode(c, id); if (f) return f; }
  return null;
}

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
    this.writer = null;            // a fallback Writer, only when no my-tabs writer answers
    this.localActs = [];           // acts posted but not yet in store.json (shown at once)
    this.drafts = new Map();       // answer text typed but not yet posted
    this.demoStore = null;
    this.expanded = new Set();
    this.passages = new Map();
    this.whole = new Set();
    this.unfolded = new Set();
    this.folded = new Set();
    this.folds = { older: false, deferred: false, closed: false };
    this.collapsed = { asks: false, mine: false };
    this.confirm = null;           // { itemId, placement, isolate }: the open Branch confirmation
    this.brOpen = new Set();       // expanded branch rows
    this.preOpen = new Set();      // branch rows showing their preamble
    this.forgetAsk = null;         // session id awaiting a second click on Forget
    this.conclude = null;          // { branchId, input, text, source, turn, prefill, edited }: the open Conclude editor
    this.closeAsk = null;          // branch id awaiting a second click on Close branch
    this.gitOk = new Map();        // cwd -> is a git checkout (the worktree toggle)
    this.menu = false;
    this.hover = null;
    this.inputs = new Map();
    this.seenSent = new Map();
    this.flash = "";
    this.override = null;
    this.last = null;
    this.wasShown = false;
    this.checkedAt = 0;
    try { this.pinned = localStorage.getItem("pinned") || null; } catch { this.pinned = null; }
    // A focus request older than this copy is not a request to it.
    this.focusAt = Number(shared("ledgr.focus")?.at) || 0;
    if (this.demo) this.enterDemo();
    if (!FORCE_DEMO) cx.spawn(async (cx) => this.start(cx));
    cx.timer.every(60000, (cx) => this.tick(cx));
  }

  // ── reader lifecycle ─────────────────────────────────────────────────
  // The panel reads ledgr-data/store.json and follows it with watchFolder; the writer is the
  // my-tabs copy (writer.js). If none answers a ping within 4 s, this copy runs a fallback
  // writer, and hands the role back as soon as a my-tabs writer claims it.
  async start(cx) {
    this.cfg = await loadConfig();
    try { localStorage.removeItem("store"); } catch { /* the pre-store.json cache, unused now */ }
    await this.reload();
    this.watchStore(cx);
    this.checkWriter(cx);
    const drift = await engineDrift();
    if (drift.length) this.flash = `mods/my-tabs/ledgr/ differs from mods/ledgr/ (${drift.join(", ")}): copy those files over so both writers run the same code.`;
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
    return true;
  }

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
      else this.live.act(a.item, a.action, a.arg, a.at);
    }
    for (const [id, v] of this.drafts) {
      const it = this.live.item(id);
      if (!it) { this.drafts.delete(id); continue; }
      if (it.draft === v.text && v.sent) this.drafts.delete(id); else it.draft = v.text;
    }
  }

  watchStore(cx) {
    if (this.watchingStore) return;
    this.watchingStore = true;
    cx.spawn(async (cx) => {
      const root = dataDir().replace(/\/+$/, "");
      try {
        for (;;) {
          const paths = await watchFolder(root);
          if (this.fallback()) continue;
          if (paths.some((p) => String(p).replace(/\/+$/, "") === root || String(p).split("/").pop() === "store.json")) {
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

  // Ask whether a my-tabs writer is alive (it re-claims on a newer ping); none in 4 s: fallback.
  checkWriter(cx) {
    if (FORCE_DEMO || this.fallback()) return;
    const at = Date.now();
    this.checkedAt = at;
    setShared("ledgr.ping", { at, id: this.panelId });
    cx.timer.after(4000, (cx) => {
      const w = writerClaim();
      if (w && w.by === "my-tabs" && Number(w.at) >= at) { this.writerNote = null; cx.notify(); return; }
      if (this.writer && !this.writer.retired) return;
      this.writer = new Writer("panel");
      this.writerNote = "No my-tabs writer answered: this panel is ingesting (fallback writer).";
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
    if (c === "demo") { if (this.demo && !FORCE_DEMO) { this.demo = false; this.demoStore = null; this.expanded.clear(); this.flash = ""; this.conclude = null; this.confirm = null; } else this.enterDemo(); }
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
    else if (c === "expand-branches") { const st = this.viewStore(); for (const b of Object.values(st.d.branches)) this.brOpen.add(b.id); }
  }

  enterDemo() {
    this.demo = true;
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
    if (f?.session && Number(f.at) > this.focusAt) { this.focusAt = Number(f.at); this.override = { sid: f.session, terminal: ft }; }
    if (this.pinned && st.d.sessions[this.pinned]) return this.pinned;
    if (this.override && st.d.sessions[this.override.sid]) {
      if (!ft || ft === this.override.terminal) return this.override.sid;
      this.override = null;
    }
    if (this.demo) return DEMO_SESSION;
    const sid = ft ? st.sessionForTerminal(ft) : null;
    if (sid && st.d.sessions[sid]) { this.last = sid; return sid; }
    if (this.last && st.d.sessions[this.last]) return this.last;
    return st.sessionsList().find((s) => s.state !== "ended")?.sessionId ?? st.sessionsList()[0]?.sessionId ?? null;
  }

  isShown() {
    const root = layout(), panel = findNode(root, "panel"), body = findNode(root, "panel-body");
    if (!panel || !body) return true;
    return !panel.hidden && body.active === "ledgr";
  }

  // ── acts ─────────────────────────────────────────────────────────────
  act(id, action, arg, cx) {
    const st = this.viewStore();
    if (this.demo) { if (st.act(id, action, arg)) cx.notify(); return; }
    const it = st.item(id);
    if (!it) return;
    this.post("act", { session_id: it.anchor?.sessionId, item: id, action, arg: arg ?? null }, { item: id, action, arg }, cx);
  }

  // Typing shows at once; the text is posted 800 ms after the last change.
  typeDraft(id, text, cx) {
    const it = this.viewStore().item(id);
    if (!it) return;
    it.draft = text;
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

  copyAnswers(s, turn, cx) {
    const st = this.viewStore();
    const group = st.itemsOf(s.sessionId).filter((it) => isAgentAsk(it) && it.anchor?.turn === turn && !isClosed(it)).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const msg = answersSheet(s.sessionId, turn, group);
    if (!msg) { this.flash = `No answers typed for turn ${turn}.`; cx.notify(); return; }
    if (this.demo) cx.write_to_clipboard(msg);
    else stageText(msg, s.terminal, cx);
    this.flash = this.demo ? "(demo) Answers copied to the clipboard." : `Answers for turn ${turn} copied: ⌘V in ${s.terminal}. They show answered once that prompt is sent.`;
    cx.notify();
  }

  goTo(it, s, cx) {
    this.expandItem(it, cx);
    this.flash = this.demo ? "(demo) Would focus the agent's pane and open its search with the quote on the clipboard." : goToAnchor(it, s, cx);
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
    this.flash = `${this.demo ? "(demo) " : ""}Copied ${btw ? "/btw" : "question"} for ${s.terminal}: ⌘V, Enter.`;
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
    this.flash = `Branch ${name} asked for: the writer starts it ${c.isolate ? "in a new worktree and space" : c.placement === "split" ? "beside the trunk" : "as a sub-agent of the trunk (peek it from the agents list)"}.`;
    cx.notify();
  }

  // Focus: the branch's pane if it has one, else a peek (a sub-agent without a pane).
  focusBranch(br, cx) {
    const t = br?.terminal;
    if (!t || this.demo) { this.flash = this.demo ? "(demo) Would focus the branch's pane." : "The branch has no terminal yet."; cx.notify(); return; }
    if (panes().some((p) => p.terminal === t)) run("pane.focus", { terminal: t });
    else run("terminal.peek", { terminal: t });
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
    const w = this.trunkWord(ts), t = ts?.terminal ?? "?";
    const how = `type a one-line lead-in such as “${leadIn(it)}”, then ⌘V, Enter`;
    if (w === "gone") return `Trunk ${t} is not live: the message stays on the clipboard; when it is back, ${how}.`;
    if (w === "working") return `Trunk ${t} is working: wait until it is idle (a paste now joins the running turn), then ${how}.`;
    if (w === "blocked") return `Trunk ${t} is waiting on its own prompt: answer that first, then ${how}.`;
    return `Trunk ${t} is ${w}: ${how}.`;
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
    if (this.demo) { cx.write_to_clipboard(msg); this.flash = `(demo) Confluence for ${it.handle} copied; nothing is saved.`; cx.notify(); return; }
    stageText(msg, ts.terminal, cx);
    this.post("conclude", { session_id: ts.sessionId, branch_id: br.id, item: it.id, text, message: msg, source: k?.source ?? "edited", source_turn: k?.turn ?? null },
      { action: "conclude", sid: ts.sessionId, branchId: br.id, text, message: msg, source: k?.source ?? "edited" }, cx);
    this.flash = `Confluence for ${it.handle} copied and ${ts.terminal ?? "the trunk"} focused${word === "working" ? " (working: wait for idle)" : word === "gone" ? " (not live)" : ""}: type “${leadIn(it)}”, then ⌘V, Enter. ${it.handle} resolves when that prompt is sent.`;
    cx.notify();
  }

  copyConfluence(st, br, cx) {
    const ts = st.d.sessions[br.parentSessionId], msg = br.conclusion?.message;
    if (!msg) { this.flash = "No staged confluence for this branch."; cx.notify(); return; }
    if (this.demo) cx.write_to_clipboard(msg); else stageText(msg, ts?.terminal, cx);
    this.flash = `${this.demo ? "(demo) " : ""}Confluence copied again for ${ts?.terminal ?? "the trunk"}: type “${leadIn(st.item(br.requestId))}”, then ⌘V, Enter.`;
    cx.notify();
  }

  // The branch has no conclusion block: stage a short request for one in the branch's pane.
  askForConclusion(st, br, cx) {
    const it = st.item(br.requestId);
    const text = conclusionRequest(it);
    cx.write_to_clipboard(text);
    if (!this.demo) this.focusBranch(br, cx);
    this.flash = `${this.demo ? "(demo) " : ""}Request copied for ${br.name}: ⌘V, Enter in its pane${busy(br.terminal) ? " once it is idle" : ""}; Conclude again when it answers.`;
    cx.notify();
  }

  closeBranch(br, cx) {
    this.closeAsk = null;
    if (this.demo) { this.flash = "(demo) Would end the branch terminal (hc kill, hc rm) and keep its record."; cx.notify(); return; }
    this.post("close_branch", { session_id: br.parentSessionId, branch_id: br.id }, { action: "close_branch", branchId: br.id }, cx);
    this.flash = `Closing ${br.name}: the writer ends ${br.terminal ?? "its terminal"}; the record and its conclusion stay.`;
    cx.notify();
  }

  // ── render ───────────────────────────────────────────────────────────
  render(cx) {
    const t = theme();
    // A fallback writer steps down when a my-tabs writer claims the role.
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
      .child(v_flex().id("ledgr-list").flex_1().min_h(0).overflow_y_scrollbar().px(8).py(6).gap(2)
        .children(s ? this.body(t, st, s) : [this.emptyState(t)]))
      .when(Boolean(s), (el) => el.child(this.footer(t, st, s)))
      .when(Boolean(note), (el) => el.child(
        div().flex_none().px(12).py(5).border_t(1).border_color(t.border).text_size(11).text_color(t.muted).child(note)));
  }

  pill(t, text, color) {
    return div().flex_none().px(5).py(0.5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(color ?? t.muted).child(text);
  }

  header(t, st, s) {
    const name = s ? `${s.terminal ?? "?"} · ${s.sessionName || s.repo || "unnamed"}` : "no session";
    const pinned = Boolean(this.pinned && s && this.pinned === s.sessionId);
    return h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_semibold().text_size(13).child("ledgr"))
      .child(h_flex().id("lg-session").flex_1().min_w(0).h(26).px(6).gap(5).items_center().rounded(6).cursor_pointer()
        .hover((x) => x.bg(t.hover)).on_click((_e, cx) => { this.menu = !this.menu; cx.notify(); })
        .when(Boolean(s), (el) => el.child(this.pill(t, agentLabel(s.agent))))
        .when(Boolean(s?.parentSessionId), (el) => el.child(h_flex().id("lg-br-pill").flex_none().gap(3).px(5).py(0.5).rounded(4).items_center().bg(t.accent + "22")
          .tooltip(`Branch of ${st.d.sessions[s.parentSessionId]?.sessionName || String(s.parentSessionId).slice(0, 8)}${s.forkTurn !== undefined && s.forkTurn !== null ? `, forked at its turn ${s.forkTurn}` : ""}`)
          .child(svg(ICON("git-branch")).size(10).text_color(t.accent)).child(div().text_size(10).text_color(t.accent).child(`branch · depth ${s.depth ?? 1}`))))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(name))
        .child(svg(ICON(this.menu ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim)))
      .when(Boolean(s), (el) => el.child(div().id("lg-pin").size(22).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
        .tooltip(pinned ? "Unpin: follow the focused agent" : "Pin this session")
        .hover((x) => x.bg(t.hover))
        .on_click((_e, cx) => {
          this.pinned = pinned ? null : s.sessionId;
          try { localStorage.setItem("pinned", this.pinned ?? ""); } catch { /* none */ }
          cx.notify();
        })
        .child(svg(ICON(pinned ? "pin" : "pin-off")).size(13).text_color(pinned ? t.accent : t.dim))))
      .when(Boolean(s), (el) => el.child(div().flex_none().text_size(11).text_color(s.state === "working" ? t.working : t.dim)
        .child(`turn ${s.turn}${s.state === "working" ? " · working" : s.state === "ended" ? " · ended" : ""}`)))
      .when(this.demo, (el) => el.child(this.pill(t, "demo", t.accent)));
  }

  // Branch sessions are listed under their parent, indented, not at the top level. Sessions whose
  // terminal is gone offer Forget (two clicks): the session, its items and its branches go.
  sessionMenu(t, st, sid) {
    const list = st.sessionsList();
    const ids = new Set(list.map((s) => s.sessionId));
    const kids = new Map();
    for (const s of list) if (s.parentSessionId && ids.has(s.parentSessionId)) kids.set(s.parentSessionId, [...(kids.get(s.parentSessionId) ?? []), s]);
    const flat = (s, d) => [[s, d], ...(d < 6 ? (kids.get(s.sessionId) ?? []).flatMap((c) => flat(c, d + 1)) : [])];
    const roots = list.filter((s) => !(s.parentSessionId && ids.has(s.parentSessionId)));
    const live = roots.filter((s) => s.state !== "ended").flatMap((s) => flat(s, 0));
    const ended = roots.filter((s) => s.state === "ended").flatMap((s) => flat(s, 0));
    const row = ([s, depth]) => {
      const open = st.itemsOf(s.sessionId).filter((it) => it.status === "open").length;
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
        .child(div().flex_none().w(28).text_size(11).text_color(t.dim).child(s.terminal ?? ""))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(s.sessionName || s.repo || s.sessionId.slice(0, 8)))
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
      .children(live.map(row))
      .when(ended.length > 0, (el) => el.child(div().px(8).pt(6).pb(2).text_size(10.5).font_semibold().text_color(t.dim).child("ENDED SESSIONS")))
      .children(ended.map(row))
      .when(!list.length, (el) => el.child(div().px(8).py(6).text_size(11.5).text_color(t.dim).child("No sessions yet.")));
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

  laneHead(t, key, title, count, open, onToggle, note) {
    return h_flex().id(`lane-${key}`).flex_none().h(24).px(4).mt(4).gap(6).items_center().cursor_pointer()
      .on_click((_e, cx) => { onToggle(!open); cx.notify(); })
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
      .child(div().flex_1().text_size(10.5).font_semibold().text_color(t.dim).child(title))
      .when(Boolean(note), (el) => el.child(h_flex().flex_none().gap(4).items_center()
        .child(svg(ICON("spinner")).size(11).text_color(t.working).spin(900))
        .child(div().text_size(10.5).text_color(t.working).child(note))))
      .child(div().flex_none().text_size(11).text_color(count ? t.accent : t.dim).child(`${count} open`));
  }

  // The asks lane is folded while the agent works and opens at the end of each turn; a click
  // holds the person's choice until the next stop.
  asksOpen(s) {
    const m = this.asksManual;
    if (m && m.sid === s.sessionId && m.stopAt === (s.lastStopAt ?? 0)) return m.open;
    return s.state !== "working";
  }

  body(t, st, s) {
    const now = Date.now();
    const items = st.itemsOf(s.sessionId);
    const stale = (it) => it.status === "open" && now - (it.updatedAt ?? 0) > DAY;
    const active = (it) => (it.status === "open" || it.status === "answered" || it.status === "rejoin_pending") && !stale(it);
    const asks = items.filter((it) => isAgentAsk(it) && active(it));
    const mine = items.filter((it) => isHuman(it) && active(it));
    const out = [];

    out.push(this.laneHead(t, "mine", "YOUR QUESTIONS", mine.filter((it) => it.status === "open").length,
      !this.collapsed.mine, (open) => { this.collapsed.mine = !open; }));
    if (!this.collapsed.mine) {
      const sorted = [...mine].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      for (const it of sorted) out.push(this.row(t, st, s, it));
      if (!sorted.length) out.push(div().px(8).py(2).text_size(11.5).text_color(t.dim).child("No parked questions. ⌘J parks one, even mid-stream."));
      const brs = st.branchesOf(s.sessionId).filter((b) => this.branchVisible(b));
      if (brs.length) {
        const live = brs.filter((b) => !["refused", "failed", "closed", "ended", "nostart"].includes(this.branchLive(b))).length;
        out.push(h_flex().id("lane-branches").flex_none().h(20).px(6).mt(4).gap(6).items_center()
          .child(svg(ICON("git-branch")).size(11).flex_none().text_color(t.dim))
          .child(div().flex_1().text_size(10.5).font_semibold().text_color(t.dim).child("BRANCHES"))
          .child(div().flex_none().text_size(11).text_color(live ? t.accent : t.dim).child(`${live} live`)));
        for (const br of brs) out.push(this.branchRow(t, st, s, br));
      }
    }

    out.push(div().h(1).mx(4).my(4).bg(t.border));
    const pend = st.pendingTurn(s.sessionId);
    const asksOpen = this.asksOpen(s);
    out.push(this.laneHead(t, "asks", "ASKED OF YOU", asks.filter((it) => it.status === "open").length, asksOpen,
      (open) => { this.asksManual = { sid: s.sessionId, stopAt: s.lastStopAt ?? 0, open }; },
      pend !== null ? `extracting turn ${pend}` : null));
    if (asksOpen) {
      const turnsRec = st.d.turns[s.sessionId] ?? {};
      const errTurns = Object.entries(turnsRec).filter(([n, r]) => r?.asks?.source === "error" && Number(n) >= s.turn - 10).map(([n]) => Number(n));
      const turns = [...new Set([...asks.map((it) => it.anchor.turn), ...errTurns])].sort((a, b) => b - a);
      const newest = turns[0];
      for (const turn of turns) {
        const g = asks.filter((it) => it.anchor.turn === turn).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        const k = `${s.sessionId}:${turn}`;
        const open = this.unfolded.has(k) || (turn === newest && !this.folded.has(k));
        const nOpen = g.filter((it) => it.status === "open").length;
        const ti = st.turnInfo(s.sessionId, turn);
        if (!g.length) { if (ti?.asks?.source === "error") out.push(this.errorLine(t, s, turn, ti)); continue; }
        out.push(h_flex().id(`grp-${turn}`).flex_none().h(22).px(6).gap(6).items_center().rounded(5).cursor_pointer().hover((x) => x.bg(t.hover))
          .on_click((_e, cx) => {
            if (open) { this.unfolded.delete(k); this.folded.add(k); } else { this.folded.delete(k); this.unfolded.add(k); }
            cx.notify();
          })
          .child(div().flex_1().text_size(11).text_color(t.muted).child(`turn ${turn} · ${g.length} ask${g.length === 1 ? "" : "s"}${open ? "" : `, ${nOpen} open`}`))
          .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(10).flex_none().text_color(t.dim)));
        if (ti?.asks?.source === "error") out.push(this.errorLine(t, s, turn, ti));
        if (!open) continue;
        for (const it of g) {
          out.push(this.row(t, st, s, it));
          for (const c of items.filter((c) => c.parentId === it.id && isHuman(c) && !isClosed(c))) out.push(this.row(t, st, s, c, true));
        }
        if (g.some((it) => (it.draft ?? "").trim() && !isClosed(it))) {
          out.push(h_flex().flex_none().pl(24).py(3).gap(6)
            .child(this.btn(t, `copy-${turn}`, "Copy answers", (_e, cx) => this.copyAnswers(s, turn, cx), { primary: true }))
            .child(div().text_size(10.5).text_color(t.dim).child("clipboard + focus the pane; nothing is typed")));
        }
      }
      if (!turns.length) out.push(div().px(8).py(2).text_size(11.5).text_color(t.dim).child("Nothing asked of you in this session."));
    }

    for (const [key, title, pick] of [
      ["older", "OLDER THAN A DAY", (it) => stale(it)],
      ["deferred", "DEFERRED", (it) => it.status === "deferred"],
      ["closed", "CLOSED", (it) => isClosed(it)],
    ]) {
      if (!this.folds[key]) continue;
      const list = items.filter(pick).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      out.push(div().h(1).mx(4).my(4).bg(t.border));
      out.push(div().px(4).py(2).text_size(10.5).font_semibold().text_color(t.dim).child(`${title} (${list.length})`));
      for (const it of list) out.push(this.row(t, st, s, it));
    }
    return out;
  }

  errorLine(t, s, turn, ti) {
    const r = ti.retry;
    const busyRetry = Boolean(r && (r.state === "requested" || r.state === "running") && Date.now() - (r.at ?? 0) < 60000);
    const why = r?.state === "failed" && r.note ? ` (retry: ${r.note})` : "";
    return h_flex().flex_none().px(6).py(2).gap(6).items_center()
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

  glyph(t, it) {
    let g = { open: ["●", t.accent], answered: ["◐", t.accent], resolved: ["✓", t.done], dismissed: ["✕", t.dim], deferred: ["◷", t.muted], rejoin_pending: ["↩", t.accent] }[it.status] ?? ["·", t.dim];
    if (isHuman(it) && it.status === "open" && it.anchor && !it.anchor.settled) g = ["○", t.dim];
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

  row(t, st, s, it, child = false) {
    const exp = this.expanded.has(it.id);
    const closed = isClosed(it);
    const agent = isAgentAsk(it);
    const dimmed = agent && it.origin === "extract_model" && this.cfg.extract?.mode === "always-model";
    const q = it.anchor?.quote ? squash(it.anchor.quote) : "";
    const parent = it.parentId ? st.item(it.parentId) : null;
    const text = it.text || (it.kind === "bookmark" ? `bookmark: “${q.slice(0, 120)}”` : "");
    const badges = [];
    const brOf = isHuman(it) ? st.branchesFor(it.id).find((b) => b.status !== "refused" && b.status !== "failed") ?? null : null;
    if (agent && it.blocking) badges.push(["blocking", t.blocked]);
    if (agent && it.repeatOf) badges.push(["raised again", t.accent]);
    if (it.origin === "btw" || it.btwStagedAt) badges.push(["/btw", t.muted]);
    if (isHuman(it) && it.askedAtTurn) badges.push([`sent t${it.askedAtTurn}`, t.muted]);
    const sub = [];
    if (isHuman(it)) {
      if (it.status === "open" && it.anchor && !it.anchor.settled) sub.push(`parked during turn ${it.anchor.turn}; anchors at end of turn`);
      else {
        const bits = [`t${it.anchor?.turn ?? "?"}`];
        if (parent && !child) bits.push(`re ${parent.handle}`);
        if (q && it.kind !== "bookmark") bits.push(`“${q.slice(0, 48)}${q.length > 48 ? "…" : ""}”`);
        if (it.anchor?.interrupted) bits.push("turn interrupted");
        if (it.anchor?.reanchoredFrom !== undefined) bits.push(`re-anchored from t${it.anchor.reanchoredFrom}`);
        sub.push(bits.join(" · "));
      }
    }
    if (agent && it.status === "answered" && it.answer) sub.push(`→ ${squash(it.answer).slice(0, 140)}`);
    if (it.status === "rejoin_pending") {
      const rb = st.d.branches[it.rejoin?.branchId];
      sub.push(`confluence from ${rb?.name ?? "its branch"} on the clipboard: resolves when it is sent in ${s?.terminal ?? "the trunk"}`);
    }
    if (it.status === "resolved" && it.resolvedBy === "branch") sub.push(`resolved by branch ${st.d.branches[it.resolution?.branchId]?.name ?? ""} at turn ${it.resolvedTurn ?? "?"}`);
    if (it.note) sub.push(it.note);
    if (it.status === "deferred") sub.push(it.deferUntil === "next_session" ? "deferred to next session" : typeof it.deferUntil === "number" ? `deferred until ${new Date(it.deferUntil).toLocaleString()}` : "deferred");

    const head = h_flex().id(`rowh-${it.id}`).gap(6).items_start().cursor_pointer()
      .on_click((_e, cx) => this.toggle(it, cx))
      .child(this.glyph(t, it))
      .child(div().w(24).flex_none().font_semibold().text_size(11.5).text_color(t.muted).child(it.handle ?? "?"))
      .child(div().w(52).flex_none().truncate().text_size(10.5).text_color(t.dim).child(it.kind))
      .child(div().flex_1().min_w(0).max_h(34).overflow_hidden().text_size(12.5)
        .text_color(closed ? t.dim : dimmed ? t.muted : t.foreground).when(it.status === "dismissed", (el) => el.line_through()).child(text))
      .children(badges.map(([b, c]) => div().flex_none().px(5).rounded(4).bg(c + "22").text_size(10).text_color(c).child(b)))
      .when(Boolean(brOf), (el) => el.child(h_flex().id(`brb-${it.id}`).flex_none().gap(3).px(5).rounded(4).items_center().bg(t.accent + "22")
        .tooltip(`Branched: ${brOf.name} (${BR_WORD[this.branchLive(brOf)] ?? brOf.status})`)
        .child(svg(ICON("git-branch")).size(10).flex_none().text_color(t.accent)).child(div().text_size(10).text_color(t.accent).child(brOf.name))));

    return v_flex().id(`row-${it.id}`).flex_none().rounded(7).px(4).py(4).gap(3).when(child, (el) => el.ml(22).border_l(1.5).border_color(t.input))
      .when(exp, (el) => el.bg(t.raised)).hover((x) => x.bg(exp ? t.raised : t.hover))
      .child(head)
      .when(agent && it.kind === "decide" && (it.options ?? []).length > 0, (el) => el.child(
        h_flex().flex_wrap().gap(4).pl(94).children(it.options.map((o, i) => {
          const chosen = (it.draft ?? "").trim() === o;
          return div().id(`opt-${it.id}-${i}`).px(6).py(0.5).rounded(5).border_1().border_color(chosen ? t.accent : t.border)
            .text_size(11).text_color(chosen ? t.accent : t.muted).when(!closed, (d) => d.cursor_pointer().hover((x) => x.bg(t.hover))
              .on_click((_e, cx) => { cx.stop_propagation(); this.setDraft(it, o, cx); }))
            .child(o === it.recommended ? `${o} (rec.)` : o);
        }))))
      .children(sub.map((line) => div().pl(94).text_size(11).text_color(t.dim).max_h(30).overflow_hidden().child(line)))
      .when(exp, (el) => el.child(this.details(t, st, s, it)));
  }

  passageView(t, it, text, whole) {
    const { before, hit, after } = passageParts(text, it.anchor?.quote, whole);
    const md = (k, body) => TextView.markdown(`ps-${k}-${it.id}`, body);
    return v_flex().max_h(whole ? 4000 : 260).overflow_hidden().rounded(6).border_1().border_color(t.border).bg(t.background).px(8).py(6).gap(4).text_size(12)
      .when(Boolean(before), (el) => el.child(div().text_color(t.muted).child(md("b", before))))
      .when(Boolean(hit), (el) => el.child(div().pl(7).py(2).border_l(2).border_color(t.accent).bg(t.accent + "14").rounded(3).child(md("h", hit))))
      .when(Boolean(after), (el) => el.child(div().text_color(t.muted).child(md("a", after))));
  }

  details(t, st, s, it) {
    const agent = isAgentAsk(it);
    const closed = isClosed(it);
    const k = `${it.anchor?.sessionId}:${it.anchor?.turn}`;
    const text = this.passages.get(k);
    const whole = this.whole.has(it.id);
    const passage = text === undefined
      ? div().text_size(11).text_color(t.dim).child("Loading passage…")
      : text === null
        ? div().text_size(11).text_color(t.dim).child(`Passage not saved for turn ${it.anchor?.turn} (ledgr-data/turns/…/${it.anchor?.turn}.md).`)
        : v_flex().gap(3)
          .child(this.passageView(t, it, text, whole))
          .child(div().id(`whole-${it.id}`).text_size(10.5).text_color(t.accent).cursor_pointer()
            .on_click((_e, cx) => { whole ? this.whole.delete(it.id) : this.whole.add(it.id); cx.notify(); })
            .child(whole ? "show less" : "show whole message"));
    const input = this.inputs.get(it.id);
    const tBusy = !this.demo && busy(s.terminal);
    const a = [];
    const b = (id, label, fn, o) => a.push(this.btn(t, `${id}-${it.id}`, label, fn, o));
    const pend = it.status === "rejoin_pending";
    const pendBr = pend ? st.d.branches[it.rejoin?.branchId] ?? null : null;
    if (closed || it.status === "deferred") b("reopen", "Reopen", (_e, cx) => this.act(it.id, "reopen", null, cx));
    if (pend) {
      if (pendBr?.conclusion?.message) b("again", "Copy confluence again", (_e, cx) => this.copyConfluence(st, pendBr, cx), { primary: true });
      b("calloff", "Call off", (_e, cx) => this.act(it.id, "reopen", null, cx), { tip: "Back to open; the branch keeps your edited conclusion for the next Conclude" });
    }
    if (!closed) {
      b("resolve", "Resolve", (_e, cx) => this.act(it.id, "resolve", null, cx));
      if (it.status !== "deferred" && !pend) {
        b("defer1", "Defer: tomorrow", (_e, cx) => this.act(it.id, "defer", Date.now() + DAY, cx));
        b("defer2", "Defer: next session", (_e, cx) => this.act(it.id, "defer", "next_session", cx));
      }
      if (!pend) b("dismiss", "Dismiss", (_e, cx) => this.act(it.id, "dismiss", null, cx));
    }
    if (agent && !closed) b("ask", "Ask about this", (_e, cx) => this.askAbout(it, s, cx));
    if (isHuman(it) && !closed && !pend && it.text) {
      b("prompt", "Copy for prompt", (_e, cx) => this.stageQuestion(it, s, false, cx), { tip: `[${it.handle}] in a prompt marks it sent` });
      b("btw", "Stage /btw", (_e, cx) => this.stageQuestion(it, s, true, cx));
    }
    if (isHuman(it) && !closed && !pend) {
      const ok = this.branchable(s);
      const again = st.branchesFor(it.id).some((x) => x.status !== "refused" && x.status !== "failed");
      b("branch", again ? "Branch again…" : "Branch…", (_e, cx) => this.openConfirm(it, s, cx),
        { disabled: !ok, tip: ok ? "Fork this session into a new Claude session to settle this question" : "Branching needs a Claude Code session with the ledgr hooks" });
    }
    b("go", "Go to anchor", (_e, cx) => this.goTo(it, s, cx), { disabled: tBusy, tip: tBusy ? "The agent is working: keys would land in its prompt" : "Focus the pane and open its search" });
    return v_flex().pl(18).pt(3).gap(6)
      .when(Boolean(it.anchor?.quote) && it.kind !== "bookmark", (el) => el.child(div().text_size(11.5).italic().text_color(t.muted).child(`“${squash(it.anchor.quote)}”`)))
      .child(passage)
      .when(agent && !closed && Boolean(input), (el) => el.child(h_flex().h(28).px(8).items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(input).flex_1().h_full().text_size(12).text_color(t.foreground))))
      .child(h_flex().flex_wrap().gap(4).children(a))
      .when(this.confirm?.itemId === it.id && isHuman(it) && !closed, (el) => el.child(this.confirmBox(t, st, s, it)))
      .child(div().text_size(10).text_color(t.dim).child(
        `${it.handle} · ${it.origin ?? ""} · turn ${it.anchor?.turn ?? "?"}${it.anchor?.hash ? ` · #${it.anchor.hash}` : ""}`));
  }

  // ── branch rendering (Phase 2) ───────────────────────────────────────
  manifestView(t, m, frozen = false) {
    if (!m) return div().text_size(11).text_color(t.dim).child("No manifest recorded (started outside the panel).");
    return v_flex().gap(2).children(manifestLines(m, { frozen }).map(([k, v]) => h_flex().gap(6).items_start()
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
    return v_flex().id(`brc-${it.id}`).gap(6).p(8).rounded(7).border_1().border_color(m.refused ? t.blocked : t.accent).bg(t.background)
      .child(h_flex().gap(6).items_center()
        .child(svg(ICON("git-branch")).size(12).flex_none().text_color(m.refused ? t.blocked : t.accent))
        .child(div().flex_1().min_w(0).font_semibold().text_size(12).child(`Branch ${it.handle}: what the branch will know`)))
      .child(this.manifestView(t, m))
      .child(h_flex().flex_wrap().gap(4).items_center()
        .child(seg(`brc-split-${it.id}`, m.parentDepth ? "beside its parent" : "beside the trunk", !c.isolate && c.placement === "split", () => { c.placement = "split"; c.isolate = false; },
          { tip: "A sub-agent of the parent's terminal, given a pane right of it" }))
        .child(seg(`brc-agent-${it.id}`, "sub-agent only", !c.isolate && c.placement === "agent", () => { c.placement = "agent"; c.isolate = false; },
          { tip: "No pane: peek it from the agents list (peek's keep gives it one)" }))
        .child(seg(`brc-wt-${it.id}`, "isolate in a worktree", Boolean(c.isolate), () => { c.isolate = !c.isolate; },
          { disabled: git !== true, tip: git === true ? "Herdr's worktree: a new checkout from HEAD in a new space; the agents tree will not nest it under the trunk" : git === false ? "The trunk's folder is not a git checkout" : "Checking for git…" })))
      .child(h_flex().gap(4).items_center()
        .child(this.btn(t, `brc-go-${it.id}`, "Launch branch", (_e, cx) => this.launch(it, s, cx), { primary: true, disabled: Boolean(m.refused) }))
        .child(this.btn(t, `brc-x-${it.id}`, "Cancel", (_e, cx) => { this.confirm = null; cx.notify(); }))
        .child(div().flex_1().min_w(0).text_size(10.5).text_color(t.dim).child("starts one process, claude --resume … --fork-session; nothing is typed into the trunk")));
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
      br.terminal ? `terminal ${br.terminal}` : null,
      br.placement === "split" ? "pane beside the trunk" : br.placement === "agent" ? "sub-agent" : null,
      br.isolate ? "own worktree" : null,
      when(br.startedAt ?? br.launchedAt ?? br.createdAt) ? `started ${when(br.startedAt ?? br.launchedAt ?? br.createdAt)}` : null,
      br.external ? "launched outside the panel" : null,
    ].filter(Boolean).join(" · ");
    const head = h_flex().id(`brh-${br.id}`).gap(6).items_center().cursor_pointer()
      .on_click((_e, cx) => { if (open) this.brOpen.delete(br.id); else this.brOpen.add(br.id); cx.notify(); })
      .child(spin ? svg(ICON("spinner")).size(11).flex_none().text_color(t.working).spin(900) : svg(ICON("git-branch")).size(11).flex_none().text_color(color))
      .child(div().flex_none().font_semibold().text_size(11.5).text_color(t.foreground).child(br.name ?? br.id.slice(0, 11)))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted)
        .child(`${it?.handle ?? "?"} · depth ${br.depth ?? "?"} · ${BR_WORD[live] ?? live ?? "?"}${br.status === "rejoined" && live !== "rejoined" ? ` · rejoined t${br.rejoinedTurn ?? "?"}` : br.status === "concluded" && live !== "concluded" ? " · concluded" : ""}`))
      .when(kids.length > 0, (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.accent + "22").text_size(10).text_color(t.accent)
        .child(`${kids.length} open`)))
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(10).flex_none().text_color(t.dim));
    const focusOk = Boolean(br.terminal) && !["closed", "ended", "failed", "refused", "nostart"].includes(live);
    const canC = this.canConclude(st, br);
    return v_flex().id(`br-${br.id}`).flex_none().rounded(7).px(4).py(4).gap(4).ml(4).border_l(1.5).border_color(t.input)
      .when(open, (el) => el.bg(t.raised)).hover((x) => x.bg(open ? t.raised : t.hover))
      .child(head)
      .when(Boolean(br.error), (el) => el.child(div().pl(17).text_size(11).text_color(br.status === "refused" ? t.dim : t.blocked).child(`${br.status === "refused" ? "Refused" : "Not started"}: ${br.error}`)))
      .when(open, (el) => el.child(v_flex().pl(17).gap(5)
        .child(this.manifestView(t, br.manifest, true))
        .when(Boolean(facts), (x) => x.child(div().text_size(10.5).text_color(t.dim).child(facts)))
        .when(kids.length > 0, (x) => x.child(div().text_size(10.5).font_semibold().text_color(t.dim).child("ASKED IN THIS BRANCH")))
        .children(kids.map((k) => this.row(t, st, child, k, true)))
        .when(staged, (x) => x.child(this.confluenceView(t, st, s, br)))
        .when(!staged && Boolean(concl), (x) => x.child(v_flex().gap(2)
          .child(div().text_size(10.5).font_semibold().text_color(t.dim).child(`CONCLUSION (its turn ${msg.turn}; Conclude… carries it back)`))
          .child(div().rounded(5).border_1().border_color(t.border).bg(t.background).px(7).py(4).text_size(11.5).children(this.lines(concl)))))
        .when(!staged && !concl && Boolean(msg?.text), (x) => x.child(v_flex().gap(2)
          .child(div().text_size(10.5).font_semibold().text_color(t.dim).child(`LAST MESSAGE (turn ${msg?.turn})`))
          .child(div().max_h(120).overflow_hidden().rounded(5).border_1().border_color(t.border).bg(t.background).px(7).py(4).text_size(11.5)
            .child(TextView.markdown(`brm-${br.id}`, String(msg?.text ?? "").slice(0, 1200))))))
        .when(this.conclude?.branchId === br.id, (x) => x.child(this.concludeBox(t, st, s, br)))
        .when(this.preOpen.has(br.id) && Boolean(br.preamble), (x) => x.child(div().rounded(5).border_1().border_color(t.border).bg(t.background).px(7).py(4)
          .text_size(11).text_color(t.muted).child(TextView.markdown(`brp-${br.id}`, br.preamble))))
        .child(h_flex().flex_wrap().gap(4)
          .child(this.btn(t, `brf-${br.id}`, "Focus", (_e, cx) => this.focusBranch(br, cx),
            { disabled: !focusOk, tip: focusOk ? "Focus the branch's pane (a peek when it has none)" : "The branch has no live terminal" }))
          .when(canC && this.conclude?.branchId !== br.id, (x) => x.child(this.btn(t, `brk-${br.id}`, br.status === "concluded" ? "Edit conclusion…" : "Conclude…",
            (_e, cx) => this.openConclude(st, br, cx), { primary: br.status !== "concluded" && Boolean(concl), tip: "Edit what goes back to the trunk, then stage it on the clipboard" })))
          .when(!canC && br.status !== "rejoined", (x) => x.child(this.btn(t, `brk-${br.id}`, "Conclude…", () => {}, { disabled: true,
            tip: it && isClosed(it) ? `${it.handle} is ${it.status}: nothing to carry back` : "The branch has not started" })))
          .when(br.status === "concluded" && Boolean(br.conclusion?.message), (x) => x.child(this.btn(t, `brc2-${br.id}`, "Copy again",
            (_e, cx) => this.copyConfluence(st, br, cx), { tip: "The staged message to the clipboard again, and focus the trunk" })))
          .when(canC && !concl && !staged && focusOk && this.conclude?.branchId !== br.id, (x) => x.child(this.btn(t, `bra-${br.id}`, "Ask for a conclusion",
            (_e, cx) => this.askForConclusion(st, br, cx), { tip: "Stage a short request for a ledgr-conclusion block in the branch's pane" })))
          .when(br.status === "rejoined" && !br.closedAt && this.closeAsk !== br.id && live !== "closed", (x) => x.child(this.btn(t, `brx-${br.id}`, "Close branch",
            (_e, cx) => { this.closeAsk = br.id; cx.notify(); }, { tip: "End the branch's terminal; its record and conclusion stay" })))
          .when(this.closeAsk === br.id, (x) => x
            .child(div().id(`brxy-${br.id}`).flex_none().h(22).px(7).flex().items_center().rounded(6).bg(t.blocked + "26").text_size(11).text_color(t.blocked).cursor_pointer()
              .on_click((_e, cx) => { cx.stop_propagation(); this.closeBranch(br, cx); }).child(`End ${br.terminal ?? br.name}`))
            .child(this.btn(t, `brxn-${br.id}`, "Keep", (_e, cx) => { this.closeAsk = null; cx.notify(); })))
          .when(Boolean(br.preamble), (x) => x.child(this.btn(t, `brp-b-${br.id}`, this.preOpen.has(br.id) ? "Hide preamble" : "Preamble",
            (_e, cx) => { if (this.preOpen.has(br.id)) this.preOpen.delete(br.id); else this.preOpen.add(br.id); cx.notify(); }))))));
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
    return v_flex().gap(2)
      .child(div().text_size(10.5).font_semibold().text_color(rejoined ? t.done : t.accent).child(rejoined
        ? `REJOINED · landed in ${s.terminal ?? "the trunk"} at turn ${br.rejoinedTurn ?? "?"} (${when(br.rejoinedAt)})`
        : `CONFLUENCE STAGED ${when(br.concludedAt)} · waiting for the paste`))
      .child(div().rounded(5).border_1().border_color(rejoined ? t.done : t.accent).bg(t.background).px(7).py(4).text_size(11.5).children(this.lines(br.conclusion?.text ?? "(no conclusion text recorded)")))
      .when(!rejoined, (x) => x.child(div().text_size(10.5).text_color(this.trunkWord(s) === "working" ? t.working : t.dim).child(this.trunkLine(s, it))))
      .when(rejoined, (x) => x.child(div().text_size(10.5).text_color(t.dim).child(
        `${it?.handle ?? "The question"} resolved by this branch · line in ledgr-data/sessions/${String(s.sessionId).slice(0, 8)}…/decisions.md${br.closedAt ? ` · terminal closed ${when(br.closedAt)}` : ""}`)))
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
    return v_flex().id(`brk-box-${br.id}`).gap(6).p(8).rounded(7).border_1().border_color(t.accent).bg(t.background)
      .child(h_flex().gap(6).items_center()
        .child(svg(ICON("git-branch")).size(12).flex_none().text_color(t.accent))
        .child(div().flex_1().min_w(0).font_semibold().text_size(12).child(`Conclude ${br.name}: what goes back to ${s.terminal ?? "the trunk"}`)))
      .child(div().text_size(10.5).text_color(t.dim).child(src))
      .child(v_flex().rounded(7).border_1().border_color(t.input).bg(t.background).px(6).py(4)
        .child(Textarea.new(k.input).w_full().text_size(12).text_color(t.foreground)))
      .when(Boolean(moved), (el) => el.child(div().text_size(10.5).text_color(t.blocked).child(moved)))
      .child(div().text_size(10.5).font_semibold().text_color(t.dim).child(`THE MESSAGE · ${wrapperWords(msg, text || "…")} words around your text; no transcript`))
      .child(v_flex().max_h(170).overflow_hidden().rounded(5).border_1().border_color(t.border).bg(t.surface).px(7).py(4).text_size(11).text_color(t.muted).children(this.lines(msg)))
      .child(div().text_size(10.5).text_color(this.trunkWord(s) === "working" ? t.working : t.dim).child(this.trunkLine(s, it)))
      .child(h_flex().flex_wrap().gap(4).items_center()
        .child(this.btn(t, `brk-send-${br.id}`, "Send to trunk", (_e, cx) => this.sendToTrunk(st, br, cx),
          { primary: true, disabled: !text || !it, tip: "Clipboard + focus the trunk's pane; nothing is typed. The question resolves when you send it there." }))
        .when(ask, (el) => el.child(this.btn(t, `brk-ask-${br.id}`, "Ask for a conclusion", (_e, cx) => this.askForConclusion(st, br, cx))))
        .when(k.edited && k.source !== "edited" && Boolean(k.prefill), (el) => el.child(this.btn(t, `brk-reset-${br.id}`, "Reset",
          (_e, cx) => { k.input.set_value(k.prefill); k.text = k.prefill; k.edited = false; cx.notify(); })))
        .child(this.btn(t, `brk-x-${br.id}`, "Cancel", (_e, cx) => { this.conclude = null; cx.notify(); })));
  }
}
