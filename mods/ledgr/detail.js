// ledgr detail dialog (docs/design/Detail.md 2): one ask, question, pin or branch shown whole, in a
// centered dialog of this mod (props {view: "detail", session, kind, id, open, sel, opener, demo}; the
// panel's openDetail opens it with detailing.js detailSpec, 0.6 × 0.75 of the window). The text, the
// quote and the message are selectable; every action an expanded panel row offered is here.
// Its own copy of the mod: a Reader (reader.js) that reads store.json and the turn files itself and posts
// spool events. It never pings, never claims ledgr.writer, runs no Writer, and writes no shared key but
// ledgr.detail ({open, closed}: the panel draws the open row raised, and when the dialog closes it moves
// its cursor, shows the dialog's last words and takes the keyboard back).
// Staging (3.1): the dialog stays open, dimmed, until nav.js has decided the paste (Reader `stage`, the one
// door), then afterStage closes it (detailing.js closesAfterStage) and the pane keeps the keyboard; closed
// while the paste still waits (Esc, a click outside), its record says focus "pane" and that the message is
// on the clipboard. A posting act that closes it (Done, Not needed, Defer, Archive, Delete) posts through
// Reader `post` and closes once that write resolved (postAndClose): closing cancels the copy's tasks once
// close() resolves, and release() writes again whatever is still unwritten. Nothing typed is lost to Esc
// or a click outside: release() posts waiting drafts (Reader flushPending) and the Conclude text is kept
// in this copy's localStorage (detail.conclude) on every change.
// Keys: Esc closes (Herdr's, and the root's on_key_down); Tab and Shift-Tab (mod:ledgr ledgr.tab /
// ledgr.backtab) move between the dialog's own fields only while it holds the keyboard. ⌘Enter
// (ledgr.btw, the capture box's /btw) means here, while the dialog holds the keyboard on an ask: paste
// the answers of its turn (pasteSheet; 2026-11-11, since the answer box is a Textarea whose Enter is a new
// line). ⌘↓ / ⌘↑ (ledgr.detail-next, ledgr.detail-prev, also only while it holds the keyboard) and the
// header's next → / ← prev show the next or previous record of its lane in the panel's order, in place
// (step; "3 of 19" beside them), the keyboard left on the dialog itself. ⌘S
// (ledgr.pin) is the capture box's and is ignored here.
// An ask's left column (2026-11-23): TEXT, WHAT TO DO (its `summary`, the agent's words, when it has one),
// OPTIONS, the answer box as the column's main region (its height the column's free height, measured with
// on_size_change: noteFit, fitAnswer; at least eight rows; in one column its least, never filling), RESULT,
// QUOTE (dim) and the foot line. An image in the answer (2026-11-23, attach.js): a file dropped on the box
// (dropOnAnswer: copied into ledgr-data/attachments/ by fs) or the clipboard's image on ⌘V with no text, or
// the row's Paste image (pasteImage: opener.js clipboardImage, the owner's pinned exception), named by one line
// of the draft (attachWritten, the one seam both end in); the row under the box shows each, with Reveal and
// Remove (the line out; the file stays).
// Commands (every shown copy gets them; this copy takes only these): detail:close, detail:done,
// detail:whole, detail:pick:<n>, detail:answer:<text>, detail-next and detail-prev (detail:next,
// detail:prev for scripts), btw; launch-branch, branch-split, branch-agent,
// send-to-trunk, conclude-edit:<text>; and, when this dialog is open on that item, pick:<h>:<n>,
// copy-answer:<h>, go:<h>, whole:<h>, menu:<h>:<defer|more>, ask-here:<Q>, and conclude, ask-conclusion,
// copy-confluence, close-branch (twice: arm, then end) on the branch the panel would pick.
// Demo (2.10): its own store from fixtures.js demoData (the demo ids are fixed, so the panel's demo row
// and this record are the same item); acts change that store only.
// Links (2026-11-10): in the message and an ask's text and quote, a web link opens in the browser and a file
// path (links.js linkify) opens with links.editor, found from the record's folder, then its repository's
// top (openLink); Reveal in Finder and Copy path follow on the status line. Only on a click: opener.js is
// the one place a process starts, and this file reaches it through openPath, revealPath and gitToplevel.
// Archived records (retention, 2026-11-19): props.archived names the archive file of a row the panel listed
// under CLOSED; the record is not in store.json, so this copy reads it itself (Reader loadArchive: the
// session's archive, by the same reading rule as the panel, which also gives the lane ⌘↓ / ⌘↑ step
// through). Why props and not a shared request: a dialog is opened per record with its props (openOverlay),
// read once at its start and owned by this copy alone, where a shared key would be every copy's and racy
// between two opens. Shown whole, its text selectable and its links working, marked ARCHIVED with when and
// how it was closed, and read-only: no answer box, no Done, no Defer, no note; one action, Reopen, which posts
// a `restore` event ({session_id, item, file, reopen: true}) through Reader post and says "reopening…" until
// the id is back in store.json (then the live item shows as usual), or that the archive file could not be read.
// Cold sessions (retention Phase 2, 2026-11-19): an item of a session whose items wait in ledgr-data/cold/ is
// not in store.json; this copy reads that session's file itself (Reader wantCold) and merges it into its own
// store, saying "Reading this session's items…" meanwhile, never Gone, then shows the item as usual (the late
// record path), with its lane for ⌘↓ / ⌘↑ from the merged items. Reading never brings the session back; the
// first act here posts its event and the writer does. A file this copy cannot read is said, with Try again; one
// the writer cannot read, its words (the panel offers what to do).
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, TextareaState, ScrollHandle } from "gpui-base";
import { theme, props, shared, setShared, closeOverlay, openOverlay, run, panes, readTextFile, home } from "herdr";
import { randomUUID } from "crypto";
import { Reader, ARCHIVE_RETRY_MS } from "./reader.js";
import { ARCHIVE_ITEMS, ARCHIVE_LEGACY, archiveDir, within } from "./spool.js";
import { FORCE_DEMO, LIMITS, agentLabel, dataDir, turnPath, textScaleOf, withScale } from "./config.js";
import { Store, isAgentAsk, isHuman, isClosed, isSuggestion, levelOf, thresholdOf } from "./store.js";
import { goToAnchor, stageText, promptText, busy, btwText, isLive } from "./nav.js";
import { demoData, FIXTURE_TURNS } from "./fixtures.js";
import { manifest, maxDepthOf, preamble, branchName, transcriptPathOf } from "./branch.js";
import { confluenceMessage, conclusionRequest, extractConclusion, leadIn, pinsMessage, pinsLeadIn, pinQuote, pinsConcludeSkeleton,
  pinsChars, pinsOverCap } from "./confluence.js";
import { itemWords as H, paneWords as P, trunkWords, originWords, branchWords, sessionWords, resolvedByWords, dismissedByWords, stageLabels,
  handleWords, pinsWords, pinSourceWords, pinAnchorWords, pinNameWords, pinLabel, pinUseLines, DETAIL_GONE, messageGone, PIN_MESSAGE_GONE,
  copiedWords, detailHints, pasteCutWords, ATTACH_WORDS, BRANCH_NO_TURN, LINK_WORDS, ARCHIVE_READING, archivedWords, archiveFileWords, reopeningWords, reopenedWords,
  restoreFailedWords, archiveGoneWords, ARCHIVED_READONLY, reopenSlowWords, archiveFailedWords, coldLoadingWords, coldErrorWords, coldFaultWords, COLD_RETRY } from "./words.js";
import { rowModel, stateOf, laneOf, neighbors, archivedCount, summaryOf } from "./listing.js";
import { detailProps, kindOf, closesAfterStage, focusAfter, mergeClosed, keptConclude, keepConclude, KEEP_KEY, twoColumns, leftWidth,
  ACTION_STATES, strayBreak, RESTORE_WAIT_MS, answerFrame, answerMinFrame, answerRows } from "./detailing.js";
import { ICON, btn, pill, badge, glyph, tone, chip, menuButton, readable, section, messageBlocks, optionChips, answerBox, confirmBox,
  branchBody, branchActions, pinNoteBox, subRow, keyHints, rowCtx, attachRow } from "./views.js";
import { parseLink, resolvePath, isRelative, shownPath, editorOf, openerArgv } from "./links.js";
import { openPath, revealPath, gitToplevel, statAt, clipboardImage } from "./opener.js";
import { ATTACH, attachDir, attachName, attachLines, withAttach, withoutAttach, isOurs, baseName, extOf, appRelative, sizeWords, copyIn, prepareSlot,
  fileInfo, thumbSize, cutDraft, pastedPaths, withAttachAt, withoutRaw } from "./attach.js";

const DAY = 86400e3;
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const DONE_TIP = "Done: you did or decided it";
const NOT_NEEDED_TIP = "Not needed: close it; the agent may raise it again";
// How long a pin's Delete waits for its second click (the panel's CLEAR_ARM_MS).
const ARM_MS = 4000;
// The answer box's cap (LIMITS.answer, the store's cut of a draft) on the status line.
const ANSWER_CUT = `Answer cut at ${String(LIMITS.answer).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} characters.`;
// The cut reached an image's line (attach.js cutDraft): that line went whole, never a part of its path.
const ANSWER_CUT_IMAGE = `${ANSWER_CUT.slice(0, -1)}; the image line it reached was taken out whole (the file stays in ledgr-data/attachments/).`;
// How close to a ⌘Enter a one-line-break change counts as that keypress's own (unbreak).
const STRAY_MS = 300;
// How long a source taken in by one route (a drop on the frame, its path pasted or dropped into the text) is not
// taken again by the other: one file, one attachment, whichever way Herdr delivers it, or both.
const SAME_SOURCE_MS = 2000;
// A number as the status line writes it (4,000).
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
// A size over the image limit, in words that differ from the limit's own ("8,388,609 bytes", not "8 MiB").
const overWords = (n) => (sizeWords(n) === sizeWords(ATTACH.maxBytes) ? `${thousands(n)} bytes` : sizeWords(n));
// The left column's vertical padding and the gap between its parts (fitAnswer counts both).
const LEFT_PY = 12, LEFT_GAP = 12;
// How many items' answer-box measures the dialog keeps (fitOf: a step back finds its own).
const FIT_KEEP = 32;

export class Detail extends Reader {
  constructor(view, cx) {
    const raw = props() ?? {};
    // An archived row's file: one of the two names the writer reads a restore event's record from (spool.js).
    const p = detailProps(raw, LIMITS.pinsPerQuestion, (f) => ARCHIVE_ITEMS.test(f) || ARCHIVE_LEGACY.test(f));
    super(cx, { demo: FORCE_DEMO || (p.ok && p.demo) });
    this.view = view;
    this.p = p;
    this.overlay = p.ok ? p.overlay : typeof raw.overlay === "string" ? raw.overlay : null;
    // What is shown: the props' target, then whatever a sub-row retargets to. `session`: the session the
    // panel showed (pin words, where a pin's question parks, the panel's own lookups). `archived`: the archive
    // file of an archived record (read from there, read-only), else null.
    this.target = p.ok ? { kind: p.kind, id: p.id, session: p.session, archived: p.archived ?? null } : null;
    this.arch = null;              // the target session's archive as read: {sid, list, count, loading, error?} (readArchive)
    this.archLooked = null;        // the id of a live record looked for in the archive after it left the store (lookInArchive)
    this.reopening = null;         // Reopen on an archived record, waiting for the writer: {id, file, at, evId}
    this.keys = cx.focus_handle();
    this.ddFocus = cx.focus_handle();
    this.dd = null;                // the open dropdown's key (views.js menuButton)
    this.ddShut = null;
    this.leftScroll = ScrollHandle.new();
    this.msgScroll = ScrollHandle.new();
    this.width = 900;              // from on_size_change; two columns from 760 px
    this.answer = null;            // the ask's answer TextareaState (made in start or retarget, never in render)
    this.answerFor = null;
    // The answer box's height (2026-11-23, fitAnswer): the frame last fitted, any item's (null: none yet; the
    // first guess for an item not measured), and what each item's is fitted from, as on_size_change reported it:
    // the left column's height (col), the item drawn (id), and per item id (fitOf, review fix 7.9: a step back
    // to an item finds its own measures) the groups above and below its ANSWER section (null: not reported
    // yet; 0: none drawn), the section less its frame (chrome), the gaps between the groups, the frame drawn
    // last and the frame fitted (frame). rowsTold: the rows the textarea was last told.
    this.frameH = null;
    this.fit = { col: 0, id: null, by: new Map() };
    this.rowsTold = null;
    // An image in an answer (2026-11-23, attach.js): the drop or paste being attached ({id, at}: one at a time),
    // and each attachment's size and presence as read (path -> {size, gone} | {loading}).
    this.attaching = null;
    this.attachInfo = new Map();
    // A source taken in lately: path -> {at, route: "drop" | "text", path (its copy, once done), raw (the text
    // route's line, when it arrived while the drop was still copying)} (SAME_SOURCE_MS).
    this.recentSrc = new Map();
    this.sheetAt = 0;              // the last ⌘Enter paste of a turn's answers (one per keypress: pasteSheet)
    this.typed = null;             // the answer box's latest change: {id, before, at} (unbreak)
    this.note = null;              // the pin note editor: {pinId, input}
    this.confirm = null;           // the Branch confirmation: {itemId, placement, isolate}
    this.conclude = null;          // the Conclude editor: {branchId, input, text, source, turn, prefill, edited}
    this.closeAsk = null;          // branch id awaiting Close branch's second click
    this.pinDel = null;            // {pinId, at}: Delete armed
    this.gitOk = new Map();        // cwd -> is a git checkout (the worktree toggle)
    this.gitRoot = new Map();      // cwd -> its git toplevel (null: none) or the lookup's promise
    this.linkHit = null;           // the path a link click found: {path, shown, flash} (Reveal, Copy path)
    this.linkSeq = 0;              // the newest link click (an older one's answer is dropped)
    this.linkFn = (url, cx) => this.openLink(url, cx);
    this.brMsg = new Map();        // branch id -> {k, turn, text}: its newest finished turn
    this.preOpen = new Set();      // branches showing their preamble
    this.whole = false;            // the message whole, else around the passage
    this.fieldOn = null;           // the field (InputState, TextareaState) that reported focus last (Tab moves from it)
    this.closedBy = null;          // "esc" | "act" | "stage" | "pane" | "box": what the closed record says (focusAfter)
    this.closedTerminal = null;
    this.closing = false;          // a closing act is being written
    this.released = false;
    this.scrolledTo = null;        // the message view whose passage was last scrolled into view
    this.loaded = this.demo;       // store.json read (the demo store is built at once)
    this.preparing = false;
    this.preparedFor = null;       // the record prepare() last made fields for (null: not found yet)
    if (this.demo) this.buildDemo();
    if (!p.ok) return;
    if (this.demo) {
      // The demo store and its archive are here at once (herdr-app check renders them), and so is a cold
      // session's file (fixtures.js FIXTURE_COLD).
      if (this.target.archived) this.arch = { sid: this.target.session, list: this.demoArchiveOf(this.target.session), count: 0, loading: false };
      const cs = this.coldTarget();
      if (cs) this.wantCold(cs, cx);
      this.prepare(cx);
    }
    cx.spawn(async (cx) => this.start(cx));
    cx.timer.every(60000, (cx) => this.tickRead(cx));
  }

  // ── lifecycle (2.1) ──────────────────────────────────────────────────
  async start(cx) {
    await this.startReading(cx);
    this.loaded = this.loaded || Boolean(this.inApp);
    // An item of a cold session: its file read now (the record comes with a render: the late record path).
    const cs = this.inApp && !this.demo ? this.coldTarget() : null;
    if (cs) this.wantCold(cs, cx);
    if (this.inApp && !this.demo && this.target.archived) await this.readArchive(this.target.session, cx);
    if (this.inApp) this.writeOpen();
    if (!this.demo) this.prepare(cx);
    this.applyOpen(cx);
    this.focusFirst(cx);
    cx.notify();
  }

  // The demo store, with the branches' manifests and preambles as the writer computes them at launch.
  buildDemo() {
    const st = new Store(demoData());
    for (const b of Object.values(st.d.branches)) {
      const it = st.item(b.requestId);
      if (!it) continue;
      const m = manifest(st, it, { now: b.createdAt, maxDepth: 2 });
      m.forkTurn = b.forkTurn; m.later = Math.max(0, b.forkTurn - m.anchorTurn);
      const pins = st.pinsOf(it);
      b.manifest = m; b.preamble = preamble(it, m, b.name, pins);
      if (pins.length) b.pins = pins.map((x) => x.id);
    }
    this.demoStore = st;
  }

  // The record shown: {kind, x} (x the item, pin or branch; the record decides the kind), or null
  // when it is gone. An item the store does not hold is looked for in the archive as read (readArchive):
  // then {kind, x, archived: true}, x the archived record (with its archiveFile). The store wins: an id
  // that is back (Reopen) shows live.
  resolve(st) {
    const tg = this.target;
    if (!tg) return null;
    if (tg.id.startsWith("pn_")) { const p = st.pin(tg.id); return p ? { kind: "pin", x: p } : null; }
    if (tg.id.startsWith("br_")) { const b = st.d.branches[tg.id]; return b ? { kind: "branch", x: b } : null; }
    const it = st.item(tg.id), kind = it ? kindOf(tg.id, it) : null;
    if (kind) return { kind, x: it };
    const rec = it ? null : this.archRecord(tg.id);
    const ak = rec ? kindOf(tg.id, rec) : null;
    return ak ? { kind: ak, x: rec, archived: true } : null;
  }

  // The cold session an item target needs read (retention Phase 2): its session, when that session is cold and
  // its items are not in this copy's store yet (Reader coldOf: loading, error or fault); else null. A pin or a
  // branch is in the store whatever its session is.
  coldTarget() {
    const tg = this.target;
    if (!tg || !tg.session || tg.id.startsWith("pn_") || tg.id.startsWith("br_")) return null;
    const c = this.coldOf(tg.session);
    return c && c.state !== "ok" ? tg.session : null;
  }

  // An archived record of the archive as read, by id (null: none read, or not in it).
  archRecord(id) { return (this.arch?.list ?? []).find((r) => r.id === id) ?? null; }

  // A session's archive (Reader readArchiveWithin: loadArchive, the panel's reading rule, at most
  // ARCHIVE_READ_MS), kept in this.arch: {sid, list, count (session.archived when read), loading, error?,
  // retryAt?}. The rows read before stay meanwhile (the lane does not jump). A read that failed or got no
  // answer keeps them, says why (error) and is read again after ARCHIVE_RETRY_MS (render).
  async readArchive(sid, cx) {
    if (!sid) { this.arch = { sid: null, list: [], count: 0, loading: false }; return; }
    const count = archivedCount(this.viewStore().d.sessions[sid]?.archived);
    const job = { sid, list: this.arch?.sid === sid ? this.arch.list : null, count, loading: true };
    this.arch = job;
    let list = null, error = null;
    try { list = await this.readArchiveWithin(sid, cx); } catch (e) { error = String(e?.message ?? e); }
    if (this.arch !== job) return;
    if (error) {
      job.error = error; job.retryAt = Date.now() + ARCHIVE_RETRY_MS; job.list = job.list ?? [];
      try { cx?.timer?.after?.(ARCHIVE_RETRY_MS + 50, (cx) => { if (!this.released) cx.notify(); }); } catch { /* the next render retries */ }
    } else job.list = list;
    job.loading = false;
  }

  // A session's archive when it is not read yet (a retarget to an archived record; a live item whose earlier
  // ask is archived; the record shown archived while the dialog was open): the demo's at once, a live one in
  // a task; then, with `again` (the record shown is the archived one), the record prepared once it is read,
  // else only redrawn (a live ask's answer box stays).
  archiveFor(sid, cx, again = false) {
    if (this.demo) { this.arch = { sid, list: this.demoArchiveOf(sid), count: 0, loading: false }; return; }
    cx.spawn(async (cx) => { await this.readArchive(sid, cx); if (this.released) return; if (again) this.prepare(cx); cx.notify(); });
  }

  // The live item shown left the store while the dialog was open (housekeeping archived it): the session's
  // archive is read once for it, so the record shows archived, read-only, with Reopen, instead of "gone".
  // From render: through a timer. Only for a record this dialog prepared as a live item.
  lookInArchive(st, cx) {
    const tg = this.target;
    if (!tg || this.demo || !this.loaded || this.released || tg.archived || this.archLooked === tg.id) return;
    // Its session went cold meanwhile (its file not read here yet): not archived, only elsewhere (render reads it).
    if (this.coldTarget()) return;
    if (tg.id.startsWith("pn_") || tg.id.startsWith("br_") || st.item(tg.id) || this.preparedFor !== tg.id) return;
    this.archLooked = tg.id;
    const sid = tg.session;
    cx.timer.after(0, (cx) => this.archiveFor(sid, cx, true));
  }

  // What prepare() last made the fields for: the record's id, an archived one's marked apart, so a record
  // that comes back to the store (Reopen) is prepared again as the live item.
  prepKey(r) { return r ? `${r.archived ? "archived:" : ""}${r.x.id}` : null; }

  // The target's retained state (made here: the start task, a handler or a timer) and its message. false:
  // the record is not in the store yet (render prepares it once a reload brings it). An archived record is
  // read-only: no answer box.
  prepare(cx) {
    const r = this.resolve(this.viewStore());
    if (!r) return false;
    this.preparedFor = this.prepKey(r);
    this.target.kind = r.kind;
    if (r.kind === "ask" && !r.archived) this.makeAnswer(r.x);
    // The ask it repeats or is about, archived since: its sub-row comes from the archive (read once).
    const st = this.viewStore(), rel = [r.x.repeatOf, r.x.parentId].filter(Boolean);
    if ((r.kind === "ask" || r.kind === "question") && !this.arch && rel.some((id) => !st.item(id))) this.archiveFor(r.x.anchor?.sessionId ?? this.target.session, cx);
    if (r.kind === "ask" || r.kind === "question") this.loadPassage(r.x.anchor?.sessionId, r.x.anchor?.turn, cx);
    if (r.kind === "pin") this.loadPassage(r.x.sessionId, r.x.anchor?.turn, cx);
    return true;
  }

  // The ask's answer box (2026-11-11: several lines; 2026-11-23: the column's main region): a TextareaState
  // of fixed rows, as many as the frame fitAnswer sizes holds (eight at first), past which it scrolls; no
  // auto-grow, since the frame gives it its height (views.js answerBox). Each change is the draft (Reader
  // typeDraft: posted 800 ms after the last one; flushPending on
  // close, sendDraft on a move), cut at LIMITS.answer with a word on the status line (the store keeps no
  // more). Enter is a new line; ⌘Enter pastes the turn's answers: the mod:ledgr `btw` command (command),
  // or the textarea's own submit when it carries ⌘ (secondary). pasteSheet takes the first of the two, so
  // one keypress is one paste. `typed` keeps the draft before the latest change and when it came, for
  // unbreak (a line break ⌘Enter itself may have put in).
  makeAnswer(it) {
    const id = it.id, scale = textScaleOf(this.cfg);
    const rows = answerRows(this.frameFor(id, scale), scale);
    this.rowsTold = rows;
    const inp = TextareaState.new({ placeholder: "Answer… (Enter: new line · ⌘Enter: paste the turn's answers)", value: it.draft ?? "", rows });
    inp.on("change", (_e, cx) => {
      let v = inp.value();
      if (v.length > LIMITS.answer) { const c = cutDraft(v, LIMITS.answer); v = c.text; inp.set_value(v); this.flash = c.dropped ? ANSWER_CUT_IMAGE : ANSWER_CUT; cx.notify(); }
      const before = String(this.viewStore().item(id)?.draft ?? "");
      if (v === before) return;                       // nothing new (a set_value of ours echoing back)
      // ⌘Enter's line break arriving after its paste (the command came first): the text goes back.
      if (Date.now() - this.sheetAt < STRAY_MS && strayBreak(before, v)) { inp.set_value(before); return; }
      this.typed = { id, before, at: Date.now() };
      this.typeDraft(id, v, cx);
      this.pathsIn(id, before, v, cx);
    });
    inp.on("submit", (e, cx) => { if (e?.secondary) this.pasteSheet(id, cx); });
    // ⌘V with no text on the clipboard (gpui-kit.d.ts: a paste that found no text): its image, if it holds one.
    inp.on("paste_other", (_e, cx) => this.pasteImage(id, cx));
    this.track(inp);
    this.answer = inp;
    this.answerFor = id;
    this.typed = null;
  }

  // A line break ⌘Enter itself put into the answer box (gpui's multi-line Enter may insert one at the caret
  // before the paste fires; unverified live, so defensive): when the box's latest change, under STRAY_MS
  // ago, did nothing but insert one "\n" (detailing.js strayBreak), the text before it goes back into the
  // box and the draft, so the sheet is not split. An Enter typed on purpose earlier is kept.
  unbreak(id, cx) {
    const k = this.typed;
    if (!k || k.id !== id || this.answerFor !== id || !this.answer || Date.now() - k.at > STRAY_MS) return false;
    if (!strayBreak(k.before, this.answer.value())) return false;
    this.typed = null;
    this.typeDraft(id, k.before, cx);
    this.answer.set_value(k.before);
    return true;
  }

  // ⌘Enter on an ask: the answer sheet of its turn (Reader copyAnswers: every open ask of that turn with
  // an answer typed or picked, those below the threshold too, and this ask whatever its status, deferred
  // or answered, when it has one: its box is what ⌘Enter was pressed in), staged like the sheet line's
  // Paste N answers. The two signals one ⌘Enter may send (the command and the textarea's submit) make
  // one paste: a second within 500 ms is dropped. true when it staged.
  pasteSheet(id, cx) {
    const now = Date.now();
    if (now - this.sheetAt < 500) return false;
    const st = this.viewStore(), it = st.item(id), s = it ? st.d.sessions[it.anchor?.sessionId] ?? null : null;
    if (!it || !s || !isAgentAsk(it) || isClosed(it)) { this.flash = "⌘Enter pastes the answers of an open ask's turn: there is none here."; cx.notify(); return false; }
    this.sheetAt = now;
    this.unbreak(id, cx);
    this.copyAnswers(s, it.anchor?.turn, cx, id);
    return true;
  }

  // The answer box's height (2026-11-23): what on_size_change reported (after a layout, from a handler, never
  // in render): "col" the left column's height, "above" / "below" the groups around an item's ANSWER section,
  // "ans" the section (its frame drawn at that item's `drawn` px: the rest is its chrome, the title and the
  // rows under the box). Kept per item id (fitOf); a report for an id with no record is dropped. Then
  // fitAnswer, when it is the item drawn (or the column).
  noteFit(key, id, h, cx) {
    const v = Number(h), f = this.fit;
    if (!Number.isFinite(v) || v < 0 || this.released) return;
    if (key === "col") { if (Math.abs(f.col - v) < 1) return; f.col = v; }
    else {
      const m = f.by.get(id);
      if (!m) return;
      if (key === "ans") m.chrome = Math.max(0, v - m.drawn);
      else if (key === "above" || key === "below") m[key] = v;
      else return;
      if (id !== f.id) return;
    }
    this.fitAnswer(cx);
  }

  // The dialog's width (the root's on_size_change): two columns from 760 px. When that flips, the answer box
  // is fitted again (one column: its least; two: the column's free height).
  noteWidth(size, cx) {
    const w = Number(size?.width) || 0;
    if (!w || Math.abs(w - this.width) <= 4) return;
    const was = twoColumns(this.width);
    this.width = w;
    if (was !== twoColumns(w)) this.fitAnswer(cx);
    cx.notify();
  }

  // An item's measures (made on its first draw; the newest FIT_KEEP kept).
  fitOf(id) {
    const by = this.fit.by;
    let m = by.get(id);
    if (!m) {
      m = { above: null, below: null, chrome: null, gaps: 0, drawn: 0, frame: null };
      by.set(id, m);
      while (by.size > FIT_KEEP) by.delete(by.keys().next().value);
    }
    return m;
  }

  // The frame an item is drawn at: in one column (review fix 7.7: the message and its marked passage follow in
  // the same scrolling column) its least, never filling; in two, its own fitted frame, else the last one fitted
  // (a guess until its measures are in), never under its least.
  frameFor(id, scale) {
    if (!twoColumns(this.width)) return answerMinFrame(scale);
    const m = this.fit.by.get(id);
    return Math.max(m?.frame ?? this.frameH ?? 0, answerMinFrame(scale, this.fit.col));
  }

  // The frame takes the left column's free height (two columns only): the column less its padding (LEFT_PY),
  // the groups above and below, the section's chrome and the gaps (detailing.js answerFrame: at least eight
  // rows; the frame drawn kept while it fits and is under 4 px short). The textarea is told the rows that fill
  // it too (set_rows: here, a handler, never in render), in case Herdr sizes it by its rows rather than by the
  // height views.js gives it. A redraw only when the frame to draw differs from the one drawn. Nothing until
  // every measure of the drawn item is in.
  fitAnswer(cx) {
    const f = this.fit, m = f.by.get(f.id);
    if (!m || !this.answer || this.answerFor !== f.id || this.released) return;
    const scale = textScaleOf(this.cfg);
    let F;
    if (!twoColumns(this.width)) F = answerMinFrame(scale);
    else {
      if (!(f.col > 0) || m.above === null || m.below === null || m.chrome === null) return;
      F = answerFrame({ col: f.col, used: 2 * LEFT_PY + m.above + m.below + m.chrome + m.gaps, scale, current: m.frame ?? m.drawn });
      m.frame = F;
      this.frameH = F;
    }
    const rows = answerRows(F, scale);
    if (rows !== this.rowsTold) { this.rowsTold = rows; try { this.answer.set_rows(rows); } catch { /* sized by the height alone */ } }
    if (F !== m.drawn) cx.notify();
  }

  // A click on the answer frame outside the textarea (its padding; or the frame's room should Herdr size the
  // textarea by its rows): the keyboard into the textarea, unless it has it already (a click in the text
  // keeps its caret).
  focusAnswer(id) {
    if (this.answerFor !== id || !this.answer || this.fieldOn === this.answer || this.released) return;
    try { this.answer.focus(); } catch { /* typing still needs a click in the text */ }
  }

  // ── an image in an answer (2026-11-23: attach.js; the file under ledgr-data/attachments/, one line of the
  // draft naming it) ──
  // An open agent ask of this dialog's store that can take an image now (not closed, not archived), else null.
  attachTarget(id) {
    const it = this.viewStore().item(id);
    return it && isAgentAsk(it) && !isClosed(it) && !it.archiveFile ? it : null;
  }

  // The checks made before any file is written, so none is written for an image that would be refused: an open
  // ask, under ATTACH.perAnswer images, and room in LIMITS.answer for the line (its length is known before the
  // name is drawn: attachName's shape). null: it may be attached; else the status words. base: what is attached.
  attachRoom(id, base, ext) {
    const it = this.attachTarget(id);
    if (!it) return ATTACH_WORDS.closed(base);
    if (!attachDir()) return ATTACH_WORDS.noFolder(base);
    const draft = String(it.draft ?? "");
    if (attachLines(draft).length >= ATTACH.perAnswer) return ATTACH_WORDS.tooMany(base, ATTACH.perAnswer);
    if (withAttach(draft, `${attachDir()}/${attachName(ext)}`).length > LIMITS.answer) return ATTACH_WORDS.tooLong(base, thousands(LIMITS.answer));
    return null;
  }

  // Another image still being attached (one at a time), unless it began over ATTACH.staleMs ago: a run that never
  // came back (a host call left pending) does not lock the row until the dialog closes (review 9.5).
  attachBusy() {
    return Boolean(this.attaching) && Date.now() - (this.attaching.at ?? 0) < ATTACH.staleMs;
  }

  // The seam both routes end in (and any later one): a file already written directly in ledgr-data/attachments/
  // named in ask id's answer. Its line goes at the end of the draft (setDraft: the draft, the box, the Paste
  // buttons), checked again first (an open ask, the fifth image, the answer's room: the draft may have changed
  // while the file was written; refused, the file stays). o.size: its bytes (the thumbnail rule); o.how: words
  // after its name ("converted to PNG"). Sets the status line; returns its words.
  attachWritten(id, path, cx, o = {}) {
    const name = baseName(path), it = this.attachTarget(id);
    let words;
    if (!isOurs(path)) words = ATTACH_WORDS.notOurs(path);
    else if (!it) words = ATTACH_WORDS.closed(name);
    else {
      // o.replace: the image's path that arrived in the box as text (attach.js pastedPaths: {raw, text, at}), whose
      // place the attachment line takes;
      // when that line is no longer there, o.orAppend (a drop) names it at the end, else it is not named.
      const draft = String(it.draft ?? "");
      let next = o.replace ? withAttachAt(draft, o.replace, path) : withAttach(draft, path);
      if (next === null && o.orAppend) next = withAttach(draft, path);
      if (next === null) words = ATTACH_WORDS.pathGone(name);
      else if (attachLines(draft).length >= ATTACH.perAnswer) words = ATTACH_WORDS.tooMany(name, ATTACH.perAnswer);
      else if (next.length > LIMITS.answer) words = ATTACH_WORDS.tooLong(name, thousands(LIMITS.answer));
      else {
        this.setDraft(it, next, cx);
        if (Number(o.size) > 0 && o.dims) this.attachInfo.set(path, { size: Number(o.size), dims: o.dims, gone: false });
        words = ATTACH_WORDS.attached(name, H(it), o.how ?? "");
      }
    }
    this.flash = words;
    cx.notify();
    return words;
  }

  // Files dropped on the answer's frame (views.js answerBox, on_drop: absolute paths): each one in turn checked,
  // copied in (attach.js copyIn: fs only, bounded) and named in the answer (attachWritten); the status line then
  // says what became of each. One attaching at a time. The demo copies nothing.
  dropOnAnswer(id, ev, cx) {
    // A file the text route took in lately (Herdr's textarea put its path into the box too): not again.
    const paths = (Array.isArray(ev?.paths) ? ev.paths : []).filter((p) => typeof p === "string" && p && !this.tookLately(p, "text"));
    if (!paths.length || this.released) return;
    if (this.demo) { this.flash = ATTACH_WORDS.demo(paths.map((p) => baseName(p) || p).join(", ")); cx.notify(); return; }
    if (this.attachBusy()) { this.flash = ATTACH_WORDS.busy; cx.notify(); return; }
    const mine = this.attaching = { id, at: Date.now() };
    // Known at once, so its path arriving in the text in the same moment is not taken a second time.
    for (const p of paths) this.recentSrc.set(p, { at: Date.now(), route: "drop", path: null, raw: null });
    this.flash = ATTACH_WORDS.copying(paths.length);
    cx.notify();
    cx.spawn(async (cx) => {
      const words = [];
      try { for (const p of paths) { try { words.push(await this.attachDropped(id, p, cx)); } finally { this.settledSrc(p); } } }
      catch (e) { words.push(ATTACH_WORDS.copyFailed(baseName(paths[words.length]) || "The file", String(e?.message ?? e).slice(0, 160))); }
      finally {
        if (this.attaching === mine) this.attaching = null;
        if (!this.released) { this.flash = words.join(" "); cx.notify(); }
      }
    });
  }

  // One dropped file: what needs no file first (an image by its name, attachRoom), then the copy, then
  // attachWritten. Its status words.
  async attachDropped(id, src, cx) {
    const base = baseName(src) || String(src), ext = extOf(src);
    if (!ext) return ATTACH_WORDS.notImage(base);
    const pre = this.attachRoom(id, base, ext);
    if (pre) return pre;
    const seen = this.recentSrc.get(src) ?? { at: Date.now(), route: "drop", path: null, raw: null };
    this.recentSrc.set(src, seen);
    const r = await copyIn(src, cx);
    if (!r.ok) {
      if (r.kind === "type") return ATTACH_WORDS.notImage(base);
      if (r.kind === "large") return ATTACH_WORDS.tooLarge(base, overWords(r.size), sizeWords(ATTACH.maxBytes));
      if (r.kind === "empty") return ATTACH_WORDS.empty(base);
      if (r.kind === "read") return ATTACH_WORDS.unreadable(base, r.why);
      if (r.kind === "back") return ATTACH_WORDS.backShort(base);
      return ATTACH_WORDS.copyFailed(base, r.why ?? "unknown error");
    }
    seen.path = r.path;
    // Its path reached the text meanwhile (the textarea's own insert): the attachment line takes that line's place
    // (or, that line gone, goes at the end as for any drop).
    return this.attachWritten(id, r.path, cx, { size: r.size, dims: r.dims, replace: seen.raw ?? undefined, orAppend: true });
  }

  // Is src being taken in by route, or was it within SAME_SOURCE_MS?
  tookLately(src, route) {
    const r = this.recentSrc.get(src);
    return Boolean(r) && r.route === route && (!r.done || Date.now() - r.at < SAME_SOURCE_MS);
  }

  // A source's attach finished (taken in or refused): its window runs from now; entries a minute old go.
  settledSrc(src) {
    const r = this.recentSrc.get(src);
    if (r) { r.done = true; r.at = Date.now(); }
    for (const [k, v] of this.recentSrc) if (v.done && Date.now() - v.at > 60000) this.recentSrc.delete(k);
  }

  // An image's path that arrived in the answer box in one change (a capture tool's clipboard or a file copied in
  // Finder, pasted; a file dropped on the text: Herdr's textarea inserts its path; attach.js pastedPaths): each
  // copied in as a drop is (copyIn: fs only, the same limits, one at a time) and its line replaced by the
  // attachment line; on any refusal the path stays as text (the agent can read it) and the status line says why.
  // A path typed by hand is never taken. The same file just dropped on the frame is one attachment: its raw line
  // goes, or the drop's line takes its place. Never the clipboard's reader, never a process.
  pathsIn(id, before, now, cx) {
    const found = pastedPaths(before, now);
    if (!found.length || this.released) return;
    const todo = [];
    for (const f of found) {
      const d = this.recentSrc.get(f.src);
      if (d && this.tookLately(f.src, "drop")) {
        if (d.path) { const it = this.attachTarget(id), next = it ? withoutRaw(String(it.draft ?? ""), f) : null; if (next !== null) this.setDraft(it, next, cx); }
        else d.raw = f;
        continue;
      }
      todo.push(f);
    }
    if (!todo.length) return;
    const names = todo.map((f) => baseName(f.src)).join(", ");
    if (this.demo) { this.flash = ATTACH_WORDS.demoPath(names); cx.notify(); return; }
    if (this.attachBusy()) { this.flash = ATTACH_WORDS.stays(`${names}: ${ATTACH_WORDS.busy}`); cx.notify(); return; }
    const mine = this.attaching = { id, at: Date.now() };
    for (const f of todo) this.recentSrc.set(f.src, { at: Date.now(), route: "text", path: null, raw: f });
    this.flash = ATTACH_WORDS.copying(todo.length);
    cx.notify();
    cx.spawn(async (cx) => {
      const words = [];
      try { for (const f of todo) { try { words.push(await this.attachPathLine(id, f, cx)); } finally { this.settledSrc(f.src); } } }
      catch (e) { words.push(ATTACH_WORDS.stays(ATTACH_WORDS.copyFailed(baseName(todo[words.length]?.src) || "The file", String(e?.message ?? e).slice(0, 160)))); }
      finally {
        if (this.attaching === mine) this.attaching = null;
        if (!this.released) { this.flash = words.join(" "); cx.notify(); }
      }
    });
  }

  // One path line (pathsIn): checked (an image ledgr takes, an open ask, the fifth, the answer's room with the
  // attachment line in its place), copied in, then named in place of the line (attachWritten's replace). Its
  // words; every refusal says the path stays as text.
  async attachPathLine(id, f, cx) {
    const base = baseName(f.src) || f.src;
    if (!f.ext) return ATTACH_WORDS.stays(ATTACH_WORDS.notImage(base));
    const it = this.attachTarget(id);
    if (!it) return ATTACH_WORDS.stays(ATTACH_WORDS.closed(base));
    if (!attachDir()) return ATTACH_WORDS.stays(ATTACH_WORDS.noFolder(base));
    const draft = String(it.draft ?? "");
    if (attachLines(draft).length >= ATTACH.perAnswer) return ATTACH_WORDS.stays(ATTACH_WORDS.tooMany(base, ATTACH.perAnswer));
    const probe = withAttachAt(draft, f, `${attachDir()}/${attachName(f.ext)}`);
    if (probe === null) return ATTACH_WORDS.pathEdited(base);
    if (probe.length > LIMITS.answer) return ATTACH_WORDS.stays(ATTACH_WORDS.tooLong(base, thousands(LIMITS.answer)));
    const r = await copyIn(f.src, cx);
    if (!r.ok) {
      if (r.kind === "type") return ATTACH_WORDS.stays(ATTACH_WORDS.notImage(base));
      if (r.kind === "large") return ATTACH_WORDS.stays(ATTACH_WORDS.tooLarge(base, overWords(r.size), sizeWords(ATTACH.maxBytes)));
      if (r.kind === "empty") return ATTACH_WORDS.stays(ATTACH_WORDS.empty(base));
      if (r.kind === "read") return ATTACH_WORDS.stays(ATTACH_WORDS.unreadable(base, r.why));
      if (r.kind === "back") return ATTACH_WORDS.stays(ATTACH_WORDS.backShort(base));
      return ATTACH_WORDS.stays(ATTACH_WORDS.copyFailed(base, r.why ?? "unknown error"));
    }
    const seen = this.recentSrc.get(f.src);
    if (seen) seen.path = r.path;
    const words = this.attachWritten(id, r.path, cx, { size: r.size, dims: r.dims, replace: f, how: "from its path" });
    return / not attached: /.test(words) ? ATTACH_WORDS.stays(words) : words;
  }

  // ⌘V in the answer box with no text on the clipboard (the textarea's paste_other), or the row's Paste image:
  // the clipboard's image written as a PNG in ledgr-data/attachments/ (opener.js clipboardImage, the one process
  // this starts, on the person's paste or click) and named in the answer (attachWritten). One at a time; the
  // fifth image and the answer's room are checked before anything runs, so no file is written for an image that
  // would be refused; the demo runs nothing.
  pasteImage(id, cx) {
    if (this.released) return;
    const what = "The image on the clipboard";
    if (this.demo) { this.flash = ATTACH_WORDS.demo(what); cx.notify(); return; }
    if (this.attachBusy()) { this.flash = ATTACH_WORDS.busy; cx.notify(); return; }
    const pre = this.attachRoom(id, what, "png");
    if (pre) { this.flash = pre; cx.notify(); return; }
    const mine = this.attaching = { id, at: Date.now() };
    this.flash = ATTACH_WORDS.reading;
    cx.notify();
    cx.spawn(async (cx) => {
      let words = null, slot = null;
      try {
        slot = await prepareSlot("png", cx);
        if (!slot.ok) words = ATTACH_WORDS.clipFailed(`ledgr-data/attachments/ could not be made ready (${slot.why})`);
        else {
          // Bounded here too (review 9.5): exec has Herdr's own limit, but a host call can be left pending.
          const r = await within(cx, ATTACH.clipMs, clipboardImage(slot.path), "the clipboard reader")
            .catch((e) => ({ ok: false, why: e?.timedOut ? `it did not finish within ${ATTACH.clipMs / 1000} s` : String(e?.message ?? e).slice(0, 160) }));
          if (r.ok) { if (this.attaching === mine) this.attaching = null; if (!this.released) this.attachWritten(id, slot.path, cx, { size: r.bytes, how: r.converted ? "converted to PNG" : "" }); }
          else if (r.none) words = ATTACH_WORDS.noImage;
          else if (r.large) words = ATTACH_WORDS.clipLarge(overWords(r.bytes), sizeWords(ATTACH.maxBytes));
          else {
            words = ATTACH_WORDS.clipFailed(r.why ?? "unknown error");
            // A write that failed part way may have left a file under that name (the script never writes over
            // one, and nothing here deletes): say so.
            const at = r.refused ? null : await statAt(slot.path).catch(() => null);
            if (at?.exists) words = `${words} ${ATTACH_WORDS.partial(baseName(slot.path))}`;
          }
        }
      } catch (e) { words = ATTACH_WORDS.clipFailed(String(e?.message ?? e).slice(0, 160)); }
      finally {
        if (this.attaching === mine) this.attaching = null;
        if (words && !this.released) { this.flash = words; cx.notify(); }
      }
    });
  }

  // Remove on an attachment's chip: its line out of the draft (the rest as typed). The file stays.
  removeAttach(id, path, cx) {
    const it = this.viewStore().item(id);
    if (!it) return;
    this.setDraft(it, withoutAttach(String(it.draft ?? ""), path), cx);
    this.flash = ATTACH_WORDS.removed(baseName(path));
    cx.notify();
  }

  // Reveal in Finder on an attachment's chip: through the status line's own reveal (revealLink, open -R).
  revealAttach(path, cx) {
    if (this.attachInfo.get(path)?.gone) { this.flash = ATTACH_WORDS.revealGone(baseName(path)); cx.notify(); return; }
    this.linkHit = { path, shown: baseName(path), flash: null };
    this.revealLink(cx);
  }

  // The images the answer names, for the row under the box: [{path, name, rel, tw, th, sizeText, gone}]. rel
  // (image()'s path, relative to the app's folder) and its size tw × th only when thumbnails are on
  // (ui.attachmentThumbs, default on), the file is at most ATTACH.thumbBytes and its header gives a PNG's or a
  // JPEG's size of at most ATTACH.thumbPx a side.
  attachRowFor(it) {
    const thumbs = this.cfg?.ui?.attachmentThumbs !== false;
    return attachLines(it?.draft).map((a) => {
      const info = this.attachInfoOf(a.path);
      const small = Boolean(info) && !info.gone && info.size > 0 && info.size <= ATTACH.thumbBytes;
      // A thumbnail only for a PNG or JPEG whose header gives its size, at most thumbPx a side, both sides set.
      const tz = thumbs && small ? thumbSize(info.dims) : null, rel = tz ? appRelative(a.path) : null;
      return { ...a, rel, tw: rel ? tz.w : 0, th: rel ? tz.h : 0, gone: Boolean(info?.gone), sizeText: info?.size > 0 ? sizeWords(info.size) : "" };
    });
  }

  // An attachment's size, pixel size and presence (attach.js fileInfo), read once from a timer (from render: never awaited
  // there); null until then. The demo reads nothing.
  attachInfoOf(path) {
    const got = this.attachInfo.get(path);
    if (got) return got.loading ? null : got;
    this.attachInfo.set(path, { loading: true });
    const cx = this.rcx;
    if (this.demo || !cx) return null;
    cx.timer.after(0, (cx) => cx.spawn(async (cx) => {
      const r = await fileInfo(path, cx).catch(() => ({ size: null, dims: null, gone: false }));
      this.attachInfo.set(path, r);
      if (!this.released) cx.notify();
    }));
    return null;
  }

  // Which of the dialog's fields has the keyboard (Tab moves from it).
  track(state) {
    state.on("focus", () => { this.fieldOn = state; });
    state.on("blur", () => { if (this.fieldOn === state) this.fieldOn = null; });
  }

  // shared("ledgr.detail").open names this dialog and its target; the closed record already there stays
  // (the panel acts on a closed record once, by its `at`).
  writeOpen() {
    if (!this.inApp || !this.overlay || !this.target) return;
    const cur = shared("ledgr.detail"), tg = this.target;
    setShared("ledgr.detail", { open: { overlay: this.overlay, opener: this.p.opener ?? null, session: tg.session ?? null, kind: tg.kind, id: tg.id, at: Date.now() },
      closed: cur && typeof cur === "object" ? cur.closed ?? null : null });
  }

  // This dialog is the one the panel last opened (outside the app: always).
  isCurrent() {
    if (!this.inApp) return true;
    return shared("ledgr.detail")?.open?.overlay === this.overlay;
  }

  // The `open` state of the props, once the record is found (2.8): a dialog opened before store.json has
  // the record (a question just parked) keeps it until a reload brings the record (render).
  applyOpen(cx) {
    const o = this.p.open;
    const st = this.viewStore(), r = this.resolve(st);
    if (!o || !r) return;
    this.p.open = null;
    const x = r.x;
    if (r.archived) { if (o === "whole") this.whole = true; return; }   // read-only: only the whole message
    if (o === "whole") this.whole = true;
    else if (o === "defer" || o === "more") this.dd = this.menuKey(r, o);
    else if (o === "confirm" && r.kind === "question") { const s = st.d.sessions[x.anchor?.sessionId]; if (s) this.openConfirm(x, s, cx); }
    else if (o === "conclude" && r.kind === "branch") this.openConclude(st, x, cx);
    else if (o === "note" && r.kind === "pin") this.editPinNote(x, cx);
    else if (ACTION_STATES.includes(o)) cx.timer.after(0, (cx) => this.runOpenAction(o, cx));
  }

  // The action states: Go to anchor, Ask here, Ask for a conclusion, the confluence again, Close branch armed.
  runOpenAction(o, cx) {
    const st = this.viewStore(), r = this.resolve(st);
    if (!r || this.released || r.archived) return;
    const x = r.x, s = r.kind === "pin" ? st.d.sessions[x.sessionId] ?? null : r.kind === "branch" ? st.d.sessions[x.parentSessionId] : st.d.sessions[x.anchor?.sessionId];
    if (o === "go" && r.kind === "pin") { if (s) this.goToPin(x, s, cx); }
    else if (o === "go" && s && r.kind !== "branch") this.goTo(x, s, cx);
    else if (o === "ask-here" && r.kind === "question" && s && st.pinsOf(x).length) this.askPinsHere(x, s, cx);
    else if (o === "ask-conclusion" && r.kind === "branch") this.askForConclusion(st, x, cx);
    else if (o === "again") {
      const br = r.kind === "branch" ? x : r.kind === "question" ? st.d.branches[x.rejoin?.branchId] ?? null : null;
      if (br) this.copyConfluence(st, br, cx);
    } else if (o === "close" && r.kind === "branch") this.closeAsk = x.id;
    cx.notify();
  }

  menuKey(r, which) {
    if (r.kind === "pin") return `pinmore-${r.x.id}`;
    if (r.kind === "branch") return `brmore-${r.x.id}`;
    return `${which === "defer" ? "defer" : "more"}-${r.x.id}`;
  }

  // The keyboard on open (2.7): the note or the Conclude text when opened on them, an open ask's answer,
  // else the dialog itself. Once now and once after 400 ms (as the capture box does), unless a field of
  // the dialog has it by then.
  focusFirst(cx) {
    const pick = (late) => {
      if (this.released) return;
      if (late && (this.fieldOn || this.keys.is_focused())) return;
      const st = this.viewStore(), r = this.resolve(st);
      const field = this.note?.input ?? this.conclude?.input ?? (r?.kind === "ask" && !isClosed(r.x) && this.answerFor === r.x.id ? this.answer : null);
      try { (field ?? this.keys).focus(); } catch { /* clicks still work */ }
    };
    cx.timer.after(0, () => pick(false));
    cx.timer.after(400, () => pick(true));
  }

  close() {
    if (this.overlay) closeOverlay(this.overlay);
  }

  // Close with the keyboard left in a pane (a staging, a pane focused): the panel focuses it again if
  // Herdr gave the keyboard back to the panel.
  closeTo(terminal) {
    this.closedBy = "pane";
    this.closedTerminal = terminal ?? null;
    this.close();
  }

  // From the View's close (Esc, a click outside, a closing act, a staging): the closed record first (the
  // panel's cursor, its flash, the drafts typed here), then every event and draft not yet written. A paste
  // still waiting for the focus is cancelled by the close, but its message is on the clipboard and its
  // pane was focused: the record says focus "pane" (that terminal) and to paste with ⌘V there.
  async release() {
    if (this.released) return;
    this.released = true;
    const cut = this.pastePending() && this.staged ? this.staged : null;
    if (cut) {
      const words = pasteCutWords(cut);
      this.flash = this.closedBy === "act" && this.flash ? `${this.flash} ${words}` : words;
      this.closedBy = "stage";
      this.closedTerminal = cut.terminal;
    }
    if (this.inApp && this.p.ok && this.target) {
      const tg = this.target;
      const mine = { overlay: this.overlay, opener: this.p.opener ?? null, session: tg.session ?? null, kind: tg.kind, id: tg.id, at: Date.now(),
        flash: this.flash || null, focus: focusAfter(this.closedBy), terminal: this.closedTerminal ?? null, drafts: this.draftsOut() };
      try { setShared("ledgr.detail", mergeClosed(shared("ledgr.detail"), mine)); } catch { /* closing */ }
    }
    try { await this.flushPending(); } catch { /* closing */ }
  }

  // The answers typed here, {[itemId]: text} (the panel shows them at once, until store.json has them).
  draftsOut() {
    const out = {};
    if (this.drafts instanceof Map) for (const [id, d] of this.drafts) if (typeof d?.text === "string") out[id] = d.text;
    return out;
  }

  // ── commands ─────────────────────────────────────────────────────────
  command(c, cx) {
    if (!this.p.ok || this.released || typeof c !== "string") return;
    if (c === "tab" || c === "backtab") { this.tabField(c === "tab" ? 1 : -1, cx); return; }
    if (!this.isCurrent()) return;
    if (c === "detail:close") { this.closedBy = "esc"; this.close(); return; }
    const st = this.viewStore(), r = this.resolve(st);
    // ⌘↓ / ⌘↑ (keys.json mod:ledgr): the next or previous record in place, only while the dialog holds the
    // keyboard (a capture box opened on top of it has it then, as for ⌘Enter); detail:next and
    // detail:prev (scripts) and the header's controls always.
    if (c === "detail-next" || c === "detail-prev") { if (this.holdsKeys(st, r)) this.step(c === "detail-next" ? 1 : -1, cx); return; }
    if (c === "detail:next" || c === "detail:prev") { this.step(c === "detail:next" ? 1 : -1, cx); return; }
    if (!r) return;
    // An archived record is read-only: the whole message, and Reopen (detail:reopen, for scripts); anything
    // that would change it says so (no answer, no Done); the panel's per-item commands are not for it.
    if (r.archived) {
      if (c === "detail:whole") this.whole = !this.whole;
      else if (c === "detail:reopen") this.reopenArchived(r.x, cx);
      else if (c === "detail:done" || c.startsWith("detail:pick:") || c.startsWith("detail:answer:")) this.flash = ARCHIVED_READONLY;
      return;
    }
    // ⌘Enter: the capture box's /btw, here the turn's answers, only while the dialog holds the keyboard
    // (a capture box opened on top of it has it then, and its ⌘Enter is its own).
    if (c === "btw") {
      if (!this.holdsKeys(st, r)) return;
      if (r.kind === "ask") this.pasteSheet(r.x.id, cx);
      else this.flash = "⌘Enter pastes the answers of an ask's turn; this is not an ask.";
      return;
    }
    const x = r.x;
    const s = r.kind === "pin" ? st.d.sessions[x.sessionId] ?? null : r.kind === "branch" ? st.d.sessions[x.parentSessionId] ?? null : st.d.sessions[x.anchor?.sessionId] ?? null;
    const item = r.kind === "ask" || r.kind === "question";
    if (c === "detail:done") {
      if (item && !isClosed(x)) this.actClose(x, "resolve", null, cx); else this.flash = "Nothing to mark done here.";
    } else if (c === "detail:whole") this.whole = !this.whole;
    else if (c.startsWith("detail:pick:")) {
      const o = r.kind === "ask" ? (x.options ?? [])[Number(c.slice("detail:pick:".length))] : undefined;
      if (o === undefined) this.flash = "No such option here."; else this.setDraft(x, o, cx);
    } else if (c.startsWith("detail:answer:")) {
      if (r.kind === "ask" && !isClosed(x)) this.setDraft(x, c.slice("detail:answer:".length), cx); else this.flash = "No open ask here.";
    } else if (c === "branch-split" || c === "branch-agent") {
      if (this.confirm) { this.confirm.placement = c === "branch-agent" ? "agent" : "split"; this.confirm.isolate = false; }
    } else if (c === "launch-branch") {
      const it = this.confirm ? st.item(this.confirm.itemId) : null, is = it ? st.d.sessions[it.anchor?.sessionId] : null;
      if (it && is) this.launch(it, is, cx); else this.flash = "No Branch confirmation is open.";
    } else if (c === "send-to-trunk") {
      const br = this.conclude ? st.d.branches[this.conclude.branchId] : null;
      if (br) this.sendToTrunk(st, br, cx); else this.flash = "No Conclude editor is open.";
    } else if (c.startsWith("conclude-edit:")) {
      const k = this.conclude;
      if (k) {
        k.text = `${k.input.value().trimEnd()}\n${c.slice("conclude-edit:".length).replace(/\\n/g, "\n")}`;
        k.input.set_value(k.text);
        k.edited = true;
        this.saveKept(k.branchId, k.text);
      } else this.flash = "No Conclude editor is open.";
    }
    // The panel's commands on one item: this dialog does them when it is open on that item (the panel
    // resolves the handle in its shown session, the one it opened this dialog from).
    else if (/^(pick|copy-answer|go|whole|menu|ask-here):/.test(c)) {
      const [kind, h, arg] = c.split(":");
      if (!this.isMine(st, r, h)) return;
      if (kind === "pick" && r.kind === "ask") { const o = (x.options ?? [])[Number(arg)]; if (o === undefined) this.flash = `${h} has no option ${arg}.`; else this.setDraft(x, o, cx); }
      else if (kind === "copy-answer" && r.kind === "ask" && s) this.copyAnswer(x, s, cx);
      else if (kind === "go" && r.kind === "pin") { if (s) this.goToPin(x, s, cx); }
      else if (kind === "go" && item && s) this.goTo(x, s, cx);
      else if (kind === "whole") this.whole = !this.whole;
      else if (kind === "menu") this.dd = this.menuKey(r, arg);
      else if (kind === "ask-here" && r.kind === "question" && s && st.pinsOf(x).length) this.askPinsHere(x, s, cx);
    } else if (c === "conclude" || c === "ask-conclusion" || c === "copy-confluence" || c === "close-branch") {
      if (r.kind !== "branch" || this.panelBranch(st, c)?.id !== x.id) return;
      if (c === "conclude") this.openConclude(st, x, cx);
      else if (c === "ask-conclusion") this.askForConclusion(st, x, cx);
      else if (c === "copy-confluence") this.copyConfluence(st, x, cx);
      else if (this.closeAsk === x.id) this.closeBranch(x, cx);
      else this.closeAsk = x.id;
    }
  }

  // Whether handle h, looked up as the panel looks it up (panel.js resolveHandle), is this dialog's record:
  // a branch by its hc name (br-q3-7c1e) or id; an item or pin by its handle in the panel's session.
  isMine(st, r, h) {
    const k = String(h ?? "").trim();
    if (!k) return false;
    if (r.kind === "branch") return k === r.x.name || k === r.x.id;
    const sid = this.target.session ?? (r.kind === "pin" ? r.x.sessionId : r.x.anchor?.sessionId);
    if (!sid) return false;
    const hit = /^\[?P\d+\]?$/i.test(k) ? st.pinByHandle(sid, k) : st.byHandle(sid, k);
    return hit?.id === r.x.id;
  }

  // The branch the panel's conclude, ask-conclusion, copy-confluence and close-branch pick: the newest of
  // the shown session's branches that fits (as the panel finds it).
  panelBranch(st, c) {
    const brs = this.target.session ? st.branchesOf(this.target.session) : [];
    if (c === "conclude") return brs.find((b) => this.canConclude(st, b)) ?? null;
    if (c === "ask-conclusion") return brs.find((b) => this.canConclude(st, b) && b.terminal) ?? null;
    if (c === "copy-confluence") return brs.find((b) => b.status === "concluded") ?? null;
    return brs.find((b) => b.status === "rejoined" && !b.closedAt) ?? null;
  }

  // Tab / Shift-Tab: the next or previous field of the dialog (the answer, the note, the Conclude text,
  // then the dialog itself), only while the dialog or one of its fields holds the keyboard, so a Tab in a
  // capture box opened on top is never taken.
  tabField(d, cx) {
    const st = this.viewStore(), r = this.resolve(st);
    const fields = this.fieldsOf(r);
    const inField = Boolean(this.fieldOn) && fields.includes(this.fieldOn);
    if (!inField && !this.keys.is_focused()) return;
    const ring = [...fields, this.keys];
    const i = inField ? ring.indexOf(this.fieldOn) : ring.length - 1;
    const next = ring[(i + d + ring.length) % ring.length];
    cx.timer.after(0, () => { try { next.focus(); } catch { /* a click still reaches it */ } });
  }

  // The dialog's fields for record r: the open ask's answer, the pin note, the Conclude text.
  fieldsOf(r) {
    return [r?.kind === "ask" && !isClosed(r.x) && this.answerFor === r.x.id ? this.answer : null, this.note?.input ?? null, this.conclude?.input ?? null].filter(Boolean);
  }

  // The dialog, or one of its fields, holds the keyboard (a field reported focus more recently than blur).
  holdsKeys(st, r) {
    if (Boolean(this.fieldOn) && this.fieldsOf(r ?? this.resolve(st ?? this.viewStore())).includes(this.fieldOn)) return true;
    try { return this.keys.is_focused(); } catch { return false; }
  }

  // Sub-rows, usage lines, the question of a branch, ⌘↓ / ⌘↑: the dialog shows that record instead, in
  // place (2.8). A pin note typed and not saved is saved first (saveNote); the rest of the per-item state
  // goes; the open record follows (the panel's cursor with it). The keyboard goes to the dialog itself,
  // never to a field: the answer box's own bindings (⌘↓ / ⌘↑ move its caret) run before the dialog's, so a
  // second ⌘↓ from inside it would not step. Tab enters it. archived: an archived record's file (a step
  // through CLOSED's archived rows); its session's archive is read first when it is not read yet.
  retarget(kind, id, session, cx, archived = null) {
    if (!id) return;
    const was = this.resolve(this.viewStore());
    if (was?.kind === "pin") this.saveNote(was.x, cx);
    this.target = { kind, id, session: session ?? this.target?.session ?? null, archived: archived ?? null };
    this.answer = null; this.answerFor = null; this.typed = null; this.note = null; this.confirm = null; this.conclude = null; this.closeAsk = null;
    this.pinDel = null; this.whole = false; this.dd = null; this.scrolledTo = null; this.fieldOn = null; this.linkHit = null; this.reopening = null;
    if (archived && this.arch?.sid !== this.target.session) this.archiveFor(this.target.session, cx, true);
    this.prepare(cx);
    if (this.inApp) this.writeOpen();
    cx.timer.after(0, () => { try { this.keys.focus(); } catch { /* clicks still work */ } });
    cx.notify();
  }

  // The lane this record is drawn in, in the panel's order (listing.js laneOf), and where it stands there.
  // An archived record's: the archived rows as read (the store's ids left out, as the panel lists them).
  laneSpot(st, r) {
    if (!r) return neighbors([], null);
    const archive = r.archived ? (this.arch?.list ?? []).filter((x) => !st.item(x.id)) : null;
    return neighbors(laneOf(st, r.kind, r.x, { threshold: thresholdOf(this.cfg), archive }).ids, r.x.id);
  }

  // Next (d 1) or previous (d -1), from ⌘↓ / ⌘↑ or the header: the neighbouring record of its lane,
  // shown in place (retarget), the keyboard on the dialog itself so the next ⌘↓ steps again (Tab enters
  // the answer box). What was typed here goes first: the ask's draft (Reader sendDraft), a pin's note
  // typed and not saved (retarget, saveNote). At either end nothing happens (no wrap); nor while a paste
  // or a closing act is pending (the dialog closes when it is decided). true when it moved.
  step(d, cx) {
    const st = this.viewStore(), r = this.resolve(st);
    if (!r || this.closing || this.pastePending()) return false;
    const nb = this.laneSpot(st, r), id = d > 0 ? nb.next : nb.prev;
    if (!id) return false;
    if (r.kind === "ask" && !r.archived) this.sendDraft(r.x.id, cx);
    // In CLOSED's archived rows the next one is an archived record too (its own file).
    const rec = r.archived && !st.item(id) ? this.archRecord(id) : null;
    const kind = id.startsWith("pn_") ? "pin" : id.startsWith("br_") ? "branch" : kindOf(id, st.item(id) ?? rec) ?? r.kind;
    this.flash = "";
    this.retarget(kind, id, this.target.session, cx, rec?.archiveFile ?? null);
    return true;
  }

  // ── acts ─────────────────────────────────────────────────────────────
  // A posting act that closes the dialog (2.5): posted through Reader `post` (kept in `unwritten`, so an
  // Esc during the write cannot lose it: release() writes it again), and the dialog closes once that
  // write resolved (a close cancels the copy's tasks, so it cannot come first). A failed write keeps the
  // dialog open with the error. The demo applies it to its own store and closes at once.
  postAndClose(type, payload, local, cx) {
    if (this.demo) {
      const st = this.demoStore;
      if (type === "act") st.act(payload.item, payload.action, payload.arg);
      else if (typeof st[`on_${type}`] === "function") st[`on_${type}`]({ pin: payload.pin, note: payload.note }, Date.now(), {});
      this.bump();
      if (this.flash) this.flash = `(demo) ${this.flash} Nothing is saved.`;
      this.closedBy = "act";
      this.close();
      cx.notify();
      return;
    }
    this.closing = true;
    this.post(type, payload, local, cx, (ok) => {
      if (!ok) { this.closing = false; return; }   // post put the error in the status line
      if (this.released) return;
      this.closedBy = "act";
      this.close();
    });
  }

  // Done, Not needed, Defer: the item's act, then the dialog closes (the list keeps its place).
  actClose(it, action, arg, cx) {
    const when = arg === "next_session" ? "to the next session" : typeof arg === "number" ? `until ${new Date(arg).toLocaleString()}` : "";
    this.flash = { resolve: `${H(it)} done.`, dismiss: `${H(it)}: not needed.`, defer: `${H(it)} deferred ${when}.`.replace(" .", ".") }[action] ?? "";
    this.postAndClose("act", { session_id: it.anchor?.sessionId, item: it.id, action, arg: arg ?? null }, { item: it.id, action, arg }, cx);
  }

  setDraft(it, text, cx) {
    this.typeDraft(it.id, text, cx);
    if (this.answerFor === it.id) this.answer?.set_value(text);
    cx.notify();
  }

  // Reopen, the one action on an archived record (retention, 2026-11-19): one `restore` spool event,
  // {session_id, item, file, reopen: true}, through Reader post (kept in `unwritten` until written, so
  // release() writes it again if the dialog closes first). The writer reads the record from that archive file,
  // puts it back under its own id and handle, and reopens it. Until store.json holds the id again the dialog
  // says "reopening…"; then the live item shows as usual (render). When the writer took the event and the id
  // did not come back (it could not read the file), or nothing came back within RESTORE_WAIT_MS, it says the
  // archive file could not be read. The dialog stays open either way. The demo restores it in its own store.
  reopenArchived(it, cx) {
    const file = it?.archiveFile ?? null, sid = it?.anchor?.sessionId ?? this.target?.session ?? null;
    if (!file || !sid || (this.reopening?.id === it.id && !this.reopening.slow)) return;
    if (this.demo) {
      const rec = { ...it };
      delete rec.archiveFile;
      this.demoStore.restoreItem(rec);
      this.demoStore.act(it.id, "reopen", null);
      this.bump();
      this.flash = `(demo) ${reopenedWords(H(it))} Nothing is saved.`;
      cx.notify();
      return;
    }
    const job = { id: it.id, file, at: Date.now(), evId: null };
    this.reopening = job;
    this.flash = reopeningWords(H(it), file);
    job.evId = this.post("restore", { session_id: sid, item: it.id, file, reopen: true }, null, cx, (ok) => { if (!ok && this.reopening === job) this.reopening = null; });
    // The usual wait passed and the writer has not taken the event (it is slow, or not running): the job is
    // kept, marked slow, so a late apply still says "reopened"; only the writer's taking the event without
    // bringing the id back says the file could not be read (settleReopen). Reopen can be pressed again.
    cx.timer.after(RESTORE_WAIT_MS, (cx) => {
      if (this.reopening !== job || this.released || this.viewStore().item(it.id)) return;
      job.slow = true;
      this.flash = reopenSlowWords(H(it));
      cx.notify();
    });
    cx.notify();
  }

  // Where a Reopen stands, at each render: the id is back in store.json (the live item shows from here on),
  // however late; or the writer took the event and it is not back (the record could not be read from its
  // file, or the store refused it: the writer's note says why).
  settleReopen(st) {
    const rj = this.reopening;
    if (!rj) return;
    const back = st.item(rj.id);
    if (back) { this.reopening = null; this.flash = reopenedWords(H(back), back.handleWas ? handleWords(back.handleWas) : null); }
    else if (rj.evId && (st.d.ingested ?? []).includes(rj.evId)) { this.reopening = null; this.flash = restoreFailedWords(H(this.archRecord(rj.id)), rj.file); }
  }

  // ── staging (3.1) ────────────────────────────────────────────────────
  // Reader `stage` reports the decided paste here: pasted, or on the clipboard with the pane focused,
  // closes the dialog and leaves the keyboard in that pane; otherwise it stays open and says why.
  afterStage(r, text, terminal, cx) {
    if (!closesAfterStage(r)) { cx.notify(); return; }
    this.flash = text;
    this.closedBy = "stage";
    this.closedTerminal = terminal ?? null;
    this.close();
  }

  // A question with pins, asked in its trunk: the pins message (confluence.js pinsMessage) staged like the
  // answer sheet. Nothing is posted: the hook's pins_asked is the record.
  askPinsHere(it, s, cx) {
    const st = this.viewStore(), pins = st.pinsOf(it);
    const over = pinsOverCap(pinsChars(pins));
    if (over) { this.flash = `${H(it)} not staged: ${over}.`; cx.notify(); return; }
    const msg = pinsMessage({ sessionId: s.sessionId, item: it, pins });
    if (this.demo) { cx.write_to_clipboard(promptText(msg)); this.flash = `(demo) ${H(it)} with ${pinsWords(pins.length)} copied; ${this.demoHow(pinsLeadIn(it))}.`; cx.notify(); return; }
    this.stage(msg, s.terminal, cx, { what: `${H(it)} with ${pinsWords(pins.length)}`, where: P(s.terminal, "the pane"),
      lead: pinsLeadIn(it), word: this.trunkWord(s), tail: `${H(it)} shows sent once that prompt is sent, answered when the reply ends.` });
  }

  // Paste into trunk (Send to trunk with ui.pasteIntoPrompt off): the `conclude` event first (Reader post,
  // in `unwritten` before the staging can close the dialog: paste off, no agent, or an agent at its own
  // prompt close it at once, and release() writes it again), then the confluence staged for the trunk's
  // prompt. Nothing while another paste still waits. Never sent: the person adds a word and presses Enter.
  sendToTrunk(st, br, cx) {
    const k = this.conclude?.branchId === br.id ? this.conclude : null;
    const text = String(k ? k.input.value() : br.conclusion?.text ?? "").trim();
    const it = st.item(br.requestId), ts = st.d.sessions[br.parentSessionId];
    if (!text) { this.flash = "Write the conclusion first: an empty confluence is not staged."; cx.notify(); return; }
    if (!it || !ts) { this.flash = "The question or its trunk session is no longer in the ledger."; cx.notify(); return; }
    const msg = confluenceMessage({ branch: br, item: it, text, pins: st.branchPins(br) });
    if (this.demo) { this.conclude = null; cx.write_to_clipboard(promptText(msg)); this.flash = `(demo) Confluence for ${H(it)} copied; nothing is saved.`; cx.notify(); return; }
    const w = { what: `Confluence for ${H(it)}`, where: trunkWords(ts.terminal), lead: leadIn(it), word: this.trunkWord(ts), tail: `${H(it)} resolves when that prompt is sent.` };
    if (this.pastePending()) { this.flash = `Still pasting into ${this.staged?.where ?? w.where}…`; cx.notify(); return; }
    this.post("conclude", { session_id: ts.sessionId, branch_id: br.id, item: it.id, text, message: msg, source: k?.source ?? "edited", source_turn: k?.turn ?? null },
      { action: "conclude", sid: ts.sessionId, branchId: br.id, text, message: msg, source: k?.source ?? "edited" }, cx);
    this.conclude = null;
    this.saveKept(br.id, "");
    this.stage(msg, ts.terminal, cx, w);
  }

  // The staged confluence again (a paste that was cleared, or a trunk that was busy): staged the same way.
  copyConfluence(st, br, cx) {
    const ts = st.d.sessions[br.parentSessionId], msg = br.conclusion?.message, it = st.item(br.requestId);
    if (!msg) { this.flash = "No staged confluence for this branch."; cx.notify(); return; }
    if (this.demo) { cx.write_to_clipboard(promptText(msg)); this.flash = `(demo) Confluence copied again; ${this.demoHow(leadIn(it))}.`; cx.notify(); return; }
    this.stage(msg, ts?.terminal, cx, { what: `Confluence for ${it ? H(it) : "the question"} (again)`, where: trunkWords(ts?.terminal), lead: leadIn(it), word: this.trunkWord(ts) });
  }

  // ── copies: the clipboard only, nothing focused, nothing pasted ──────
  // Copy for prompt on a question with pins: the whole pins message, as Ask here would paste it.
  copyPinsMessage(it, s, cx) {
    const pins = this.viewStore().pinsOf(it);
    const over = pinsOverCap(pinsChars(pins));
    if (over) { this.flash = `${H(it)} not copied: ${over}.`; cx.notify(); return; }
    cx.write_to_clipboard(promptText(pinsMessage({ sessionId: s.sessionId, item: it, pins })));
    this.flash = `${this.demo ? "(demo) " : ""}${H(it)} with ${pinsWords(pins.length)} copied, quoted with where each came from; nothing was pasted: in its pane, type “${pinsLeadIn(it)}”, then ⌘V, Enter.`;
    cx.notify();
  }

  // A pin, quoted, with where it came from (confluence.js pinQuote).
  copyPin(p, s, cx) {
    cx.write_to_clipboard(pinQuote(p, { sessionId: s?.sessionId }));
    this.flash = `${this.demo ? "(demo) " : ""}${pinNameWords(p, s?.sessionId)} copied, quoted with where it came from; nothing was pasted.`;
    cx.notify();
  }

  // A text as stored (the ask's text, a quote, a passage, the message).
  copyText(text, what, cx) {
    const s = String(text ?? "");
    cx.write_to_clipboard(s);
    this.flash = copiedWords(what, s.length);
    cx.notify();
  }

  // ── clipboard plus focus ─────────────────────────────────────────────
  // Copy for prompt and Stage /btw on a question without pins: clipboard plus the pane focused (nav.js
  // stageText); the dialog closes and the pane keeps the keyboard.
  stageQuestion(it, s, btw, cx) {
    const text = btw ? btwText(it.text, it.anchor?.quote) : `[${it.handle}] ${it.text}`;
    if (this.demo) cx.write_to_clipboard(text); else stageText(text, s.terminal, cx);
    if (btw) this.act(it.id, "btw", null, cx);
    this.flash = `${this.demo ? "(demo) " : ""}Copied ${btw ? "/btw" : "question"} for ${P(s.terminal, "the session")}: ⌘V, Enter.`;
    if (!this.demo && s.terminal && isLive(s.terminal)) this.closeTo(s.terminal);
    cx.notify();
  }

  // Go to anchor: a search slice of the quote on the clipboard and the pane focused (nav.js goToAnchor;
  // no keys are sent). The dialog closes when the pane was focused.
  goTo(it, s, cx) {
    this.whole = true;
    const t = s?.terminal ?? it.terminal ?? null;
    this.flash = this.demo ? "(demo) Would focus the agent's pane and copy a search slice of the quote; the passage is shown here." : goToAnchor(it, s, cx);
    if (!this.demo && t && isLive(t)) this.closeTo(t);
    cx.notify();
  }

  goToPin(p, ps, cx) {
    this.whole = true;
    const t = ps?.terminal ?? p.anchor?.terminal ?? null;
    this.flash = this.demo ? "(demo) Would focus the agent's pane and copy a slice of the passage; the message is shown here."
      : goToAnchor({ anchor: { quote: p.text }, terminal: p.anchor?.terminal }, ps, cx);
    if (!this.demo && t && isLive(t)) this.closeTo(t);
    cx.notify();
  }

  // Ask about this: the capture box over the dialog's place, then the dialog closes (focus: the box's).
  askAbout(it, s, cx) {
    if (this.demo) { this.flash = `(demo) Would open the capture box with “re [${it.handle}] ”.`; cx.notify(); return; }
    openOverlay({ mod: "ledgr", kind: "dialog", width: 600, height: 320,
      props: { view: "capture", parent: it.id, session: s.sessionId, terminal: s.terminal, prefill: `re [${it.handle}] ` } });
    this.closedBy = "box";
    this.close();
  }

  // ── branches (Phase 2) ───────────────────────────────────────────────
  openConfirm(it, s, cx) {
    this.confirm = { itemId: it.id, placement: "split", isolate: false };
    if (!this.demo && s?.cwd && !this.gitOk.has(s.cwd)) {
      this.gitOk.set(s.cwd, undefined);
      cx.spawn(async (cx) => {
        this.gitOk.set(s.cwd, Boolean(await this.gitRootOf(s.cwd)));
        cx.notify();
      });
    }
    cx.notify();
  }

  confirmManifest(st, it, s) {
    return manifest(st, it, { maxDepth: maxDepthOf(this.cfg), isolate: Boolean(this.confirm?.isolate), parentLive: this.demo ? true : this.parentLive(s) });
  }

  // Launch: one `branch` spool event; the writer re-checks the depth cap and starts the process. The
  // dialog stays: the question's BRANCHES shows it launching.
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
    this.flash = `The ${branchWords(it)} (${name}) is asked for: the writer starts it ${c.isolate ? "in a new worktree and space" : c.placement === "split" ? "beside the trunk" : "as a sub-agent of the trunk (peek it from the agents list)"}.`;
    cx.notify();
  }

  // Focus: the branch's pane if it has one (the dialog closes, the pane keeps the keyboard), else a peek.
  focusBranch(br, cx) {
    const t = br?.terminal;
    if (!t || this.demo) { this.flash = this.demo ? "(demo) Would focus the branch's pane." : "The branch has no terminal yet."; cx.notify(); return; }
    if (panes().some((p) => p.terminal === t)) { run("pane.focus", { terminal: t }); this.closeTo(t); }
    else { run("terminal.peek", { terminal: t }); this.closedBy = null; this.close(); }
  }

  // ── confluence (Phase 3) ─────────────────────────────────────────────
  // The trunk's status plus how the message gets there (panel.js before the dialog): a lead-in typed
  // before ⌘V (paste off), or a word added to the pasted message before Enter (paste on).
  trunkLine(ts, it, staged = false) {
    const w = this.trunkWord(ts), t = trunkWords(ts?.terminal).replace(/^t/, "T"), L = stageLabels(this.pasteOn());
    const how = !this.pasteOn() ? `type a one-line lead-in such as “${leadIn(it)}”, then ⌘V, Enter`
      : staged ? `the message waits in its prompt (if not, ${L.again}); add a word of your own such as “${leadIn(it)}”, then Enter`
      : `${L.send} puts the message in its prompt without sending it; add a word of your own such as “${leadIn(it)}”, then Enter`;
    if (w === "gone") return !this.pasteOn() ? `${t} is not live: the message stays on the clipboard; when it is back, ${how}.`
      : `${t} is not live: when it is back, ${staged ? L.again : L.send}, add a word of your own and press Enter.`;
    if (w === "working") return !this.pasteOn() ? `${t} is working: wait until it is idle (a paste now joins the running turn), then ${how}.`
      : `${t} is working: a prompt sent now joins the running turn; wait until it is idle. ${how[0].toUpperCase()}${how.slice(1)}.`;
    if (w === "blocked") return `${t} is waiting on its own prompt: answer that first${this.pasteOn() ? " (nothing is pasted while it waits)" : ""}, then ${how}.`;
    return `${t} is ${w}: ${how}.`;
  }

  // The prefill: the newest ledgr-conclusion block in the branch's last 10 turns, else its last message,
  // else nothing; a question with pins and no block, one entry per pin (pinsConcludeSkeleton).
  async branchText(st, br) {
    const c = br.sessionId ? st.d.sessions[br.sessionId] : null;
    const it = st.item(br.requestId), pins = st.branchPins(br);
    const withPins = (last) => ({ source: "pins", turn: last?.turn ?? null,
      text: `${pinsConcludeSkeleton(pins, { sessionId: it?.anchor?.sessionId ?? br.parentSessionId })}${last ? `\n\nFrom the branch's last reply:\n${last.text.trim().slice(0, 4000)}` : ""}` });
    if (!c || !c.turn) return pins.length ? withPins(null) : { source: "empty", turn: null, text: "" };
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
    if (pins.length) return withPins(last);
    return last ? { source: "last", turn: last.turn, text: last.text.trim().slice(0, 4000) } : { source: "empty", turn: null, text: "" };
  }

  // Conclude… / Edit conclusion…: the editor, prefilled with the text kept here when it is newer than
  // the posted conclusion (an earlier edit the dialog closed on), else the posted one, else the branch's
  // block or last message once read.
  openConclude(st, br, cx) {
    if (!this.canConclude(st, br)) { this.flash = "This branch cannot conclude: its question is closed or the branch never started."; cx.notify(); return; }
    const kept = this.demo ? null : keptConclude(this.readKept(), br.id, Date.now(), br.conclusion?.at ?? null);
    const prior = kept ?? String(br.conclusion?.text ?? "");
    const k = this.concludeEditor(br, prior, prior ? "edited" : "loading", br.conclusion?.sourceTurn ?? null);
    this.closeAsk = null;
    cx.spawn(async (cx) => {
      const r = await this.branchText(st, br);
      if (this.conclude !== k) return;
      k.found = r;
      if (!prior) { k.source = r.source; k.turn = r.turn; k.prefill = r.text; k.text = r.text; k.input.set_value(r.text); k.edited = false; }
      cx.notify();
    });
    cx.timer.after(30, () => { try { k.input.focus(); } catch { /* a click still reaches it */ } });
    cx.notify();
  }

  // The editor's state (a TextareaState: made in a handler or a task, never in render). Each change is
  // kept in localStorage until it is staged (2.7).
  concludeEditor(br, text, source, turn) {
    const inp = TextareaState.new({ placeholder: "What the trunk should hear: the answer, and any facts or decisions it should update.", value: text, rows: 6 });
    try { inp.set_auto_grow(4, 14); } catch { /* fixed rows */ }
    const k = { branchId: br.id, input: inp, text, source, turn, prefill: text, edited: false };
    inp.on("change", (_e, cx) => {
      if (this.conclude !== k) return;
      k.text = inp.value();
      k.edited = k.text !== k.prefill;
      this.saveKept(br.id, k.edited || k.source === "edited" ? k.text : "");
      cx.notify();
    });
    this.track(inp);
    this.conclude = k;
    return k;
  }

  readKept() {
    try { const v = JSON.parse(localStorage.getItem(KEEP_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
  }

  saveKept(branchId, text) {
    if (this.demo) return;
    try { localStorage.setItem(KEEP_KEY, JSON.stringify(keepConclude(this.readKept(), branchId, text, Date.now()))); } catch { /* memory only */ }
  }

  // The Conclude editor's Cancel: the kept text goes too.
  forgetConclude(branchId) { this.saveKept(branchId, ""); }

  // The branch has no conclusion block: a short request for one on the clipboard, its pane focused.
  askForConclusion(st, br, cx) {
    const it = st.item(br.requestId);
    cx.write_to_clipboard(conclusionRequest(it));
    this.flash = `${this.demo ? "(demo) " : ""}Request copied for the ${branchWords(it)} (${br.name}): ⌘V, Enter in its pane${busy(br.terminal) ? " once it is idle" : ""}; Conclude again when it answers.`;
    if (!this.demo) this.focusBranch(br, cx);
    cx.notify();
  }

  closeBranch(br, cx) {
    this.closeAsk = null;
    if (this.demo) { this.flash = "(demo) Would end the branch terminal (hc kill, hc rm) and keep its record."; cx.notify(); return; }
    this.post("close_branch", { session_id: br.parentSessionId, branch_id: br.id }, { action: "close_branch", branchId: br.id }, cx);
    this.flash = `Closing the ${branchWords(this.viewStore().item(br.requestId))} (${br.name}): the writer ends ${P(br.terminal, "its terminal")}; the record and its conclusion stay.`;
    cx.notify();
  }

  // The branch session's newest finished turn (the last 10 looked at), read once per stop (guarded: a read
  // starts only when that turn's stop time changes). None finished yet (its first turn running, or none
  // begun): {waiting: true}, and the message column says so instead of "Loading the message…".
  pumpBranch(st, br, cx) {
    if (!br?.sessionId) return;
    const c = st.d.sessions[br.sessionId];
    const cur = this.brMsg.get(br.id);
    let n = 0, ti = null;
    if (c?.turn && this.demo) { n = c.turn; ti = st.turnInfo(c.sessionId, n); }
    else if (c?.turn) {
      for (let j = c.turn; j >= Math.max(1, c.turn - 10); j--) { const x = st.turnInfo(c.sessionId, j); if (x?.stopAt) { n = j; ti = x; break; } }
    }
    if (!n) {
      const w = `${br.sessionId}:wait:${c?.turn ?? 0}`;
      if (cur?.k !== w) this.brMsg.set(br.id, { k: w, turn: null, text: null, waiting: true });
      return;
    }
    const k = `${c.sessionId}:${n}:${ti?.stopAt ?? 0}`;
    if (cur?.k === k || cur?.loading === k) return;
    if (this.demo) { this.brMsg.set(br.id, { k, turn: n, text: FIXTURE_TURNS[`${c.sessionId}:${n}`] ?? ti?.textHead ?? null }); return; }
    this.brMsg.set(br.id, { ...(cur?.waiting ? {} : cur ?? {}), loading: k });
    cx.timer.after(0, (cx) => cx.spawn(async (cx) => {
      const p = ti.textPath ? (ti.textPath.startsWith("/") ? ti.textPath : `${dataDir()}/${ti.textPath}`) : turnPath(c.sessionId, n);
      const text = await readTextFile(p).catch(() => null);
      this.brMsg.set(br.id, { k, turn: n, text: text ?? ti.textHead ?? null });
      cx.notify();
    }));
  }

  // ── pins ─────────────────────────────────────────────────────────────
  // This pin, or the panel's whole selection when it was in it (props.sel), in pin creation order.
  pinsFor(st, p) {
    const sel = this.p.sel ?? [];
    if (!sel.includes(p.id)) return [p];
    return sel.map((id) => st.pin(id)).filter(Boolean).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  // Ask here… and Branch… on a pin: the capture box in pins mode for the panel's session (the question
  // parks there), then the dialog closes.
  openPinsBox(st, s, pins, then, cx) {
    const list = [...pins].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)).slice(0, LIMITS.pinsPerQuestion);
    if (!list.length) { this.flash = "No pins to ask about."; cx.notify(); return; }
    if (!s) { this.flash = "No session to park the question in: open a session in the panel first."; cx.notify(); return; }
    if (then === "branch" && !this.branchable(s)) { this.flash = "Branching needs a Claude Code session with the ledgr hooks."; cx.notify(); return; }
    if (this.demo) { this.flash = `(demo) Would open the capture box to ask about ${list.map((p) => pinNameWords(p, s.sessionId)).join(", ")}${then === "branch" ? ", then the Branch confirmation" : ""}.`; cx.notify(); return; }
    openOverlay({ mod: "ledgr", kind: "dialog", width: 600, height: 340,
      props: { view: "capture", session: s.sessionId, terminal: s.terminal, pins: list.map((p) => ({ id: p.id, label: pinLabel(p, s.sessionId) })), then: then ?? null } });
    this.closedBy = "box";
    this.close();
  }

  // A note typed for pin p and not saved yet (the editor open on it, its text not the pin's note), saved now
  // as Enter would: a move to another record (step) keeps it. true when one was posted.
  saveNote(p, cx) {
    const k = this.note;
    if (!k || k.pinId !== p.id) return false;
    const text = k.input.value();
    this.note = null;
    if (squash(text) === squash(p.note)) return false;
    this.pinAct("pin_note", p, { note: text }, cx);
    return true;
  }

  // The note editor: its InputState is made here (a click), never in render. Enter saves; Esc discards.
  editPinNote(p, cx) {
    const input = InputState.new({ placeholder: "A one-line note: Enter saves, Esc cancels", value: p.note ?? "" });
    const k = { pinId: p.id, input };
    input.on("submit", (_e, cx) => { if (this.note !== k) return; this.note = null; this.pinAct("pin_note", p, { note: input.value() }, cx); cx.notify(); });
    this.track(input);
    this.note = k;
    cx.timer.after(30, () => { try { input.focus(); } catch { /* a click still reaches it */ } });
    cx.notify();
  }

  // Archive: out of the lane; the dialog closes.
  archivePin(p, cx) {
    this.flash = `${handleWords(p.handle)} archived: “archived” in the PINS lane brings it back.`;
    this.postAndClose("pin_archive", { session_id: p.sessionId, pin: p.id }, { action: "pin_archive", pin: p.id }, cx);
  }

  // Delete (archived pins only): the first click arms it for ARM_MS, the second posts pin_delete and closes.
  deletePin(p, cx) {
    const now = Date.now();
    if (this.pinDel?.pinId === p.id && now - this.pinDel.at < ARM_MS) {
      this.pinDel = null;
      this.flash = `${handleWords(p.handle)} deleted.`;
      this.postAndClose("pin_delete", { session_id: p.sessionId, pin: p.id }, { action: "pin_delete", pin: p.id }, cx);
      return;
    }
    const ask = this.pinDel = { pinId: p.id, at: now };
    cx.timer.after(ARM_MS + 50, (cx) => { if (this.pinDel === ask) { this.pinDel = null; cx.notify(); } });
    cx.notify();
  }

  // ── links (2026-11-10) ───────────────────────────────────────────────
  // The folder a path in this record is found from: an item's session's; a pin's own (source.cwd, else its
  // session's); a branch's own session's (a worktree branch has its own), else its record's, else its
  // trunk's. null: none recorded.
  cwdOf(st, r) {
    if (!r) return null;
    const x = r.x, ses = (sid) => (sid ? st.d.sessions[sid] ?? null : null);
    if (r.kind === "pin") return x.source?.cwd || ses(x.sessionId)?.cwd || null;
    if (r.kind === "branch") return ses(x.sessionId)?.cwd || x.cwd || ses(x.parentSessionId)?.cwd || null;
    return ses(x.anchor?.sessionId)?.cwd || null;
  }

  // The git toplevel of cwd (opener.js gitToplevel), asked once per folder; null: not a checkout. The demo
  // asks nothing.
  async gitRootOf(cwd) {
    if (this.demo || !cwd) return null;
    if (!this.gitRoot.has(cwd)) this.gitRoot.set(cwd, gitToplevel(cwd).catch(() => null));
    const v = await this.gitRoot.get(cwd);
    this.gitRoot.set(cwd, Promise.resolve(v));
    return v;
  }

  // Where the clicked path is: the first place it exists, in links.js resolvePath's order (as given when
  // absolute or under ~; else the record's folder, then its repository's top, asked only when the folder
  // has no such path). {path, dir, tried}; path null when nothing is there. A place that could not be looked
  // at (the check refused) is opened anyway when nothing else was found (the opener then says).
  async findLink(p, cwd) {
    const h = home(), tried = [];
    let unsure = null;
    const look = async (cands) => {
      for (const c of cands) {
        if (tried.includes(c)) continue;
        tried.push(c);
        const at = await statAt(c);
        if (at.exists === true) return { path: c, dir: at.dir };
        if (at.exists === null) unsure ??= { path: c, dir: null };
      }
      return null;
    };
    let hit = await look(resolvePath(p, { cwd, home: h }));
    if (!hit && cwd && isRelative(p)) {
      const root = await this.gitRootOf(cwd);
      if (root) hit = await look(resolvePath(p, { cwd, root, home: h }));
    }
    return { ...(hit ?? unsure ?? { path: null, dir: null }), tried };
  }

  // A link clicked in the message or an ask's text or quote (views.js readable): a web link opens in the
  // browser (cx.open_url: http and https only); a file path (the private form linkify wrote, a relative
  // markdown link, a file:// URL) is looked for (findLink) and opened with links.editor (opener.js
  // openPath); anything else opens nothing. The status line says what happened, or which places were
  // looked in; a path found offers Reveal in Finder and Copy path there. The dialog stays open.
  openLink(url, cx) {
    const l = parseLink(url), seq = ++this.linkSeq;
    this.linkHit = null;
    if (l.kind === "web") {
      try { cx.open_url(l.url); this.flash = LINK_WORDS.web(l.url); } catch (e) { this.flash = LINK_WORDS.webFailed(l.url, String(e?.message ?? e)); }
      cx.notify();
      return;
    }
    if (l.kind !== "path") { this.flash = LINK_WORDS.refused(url); cx.notify(); return; }
    const st = this.viewStore(), r = this.resolve(st), cwd = this.cwdOf(st, r), h = home();
    const asked = shownPath(l.path, { line: l.line, col: l.col });
    if (isRelative(l.path) && !cwd) { this.flash = LINK_WORDS.noFolder(asked); cx.notify(); return; }
    const setting = editorOf(this.cfg);
    if (this.demo) {
      const how = openerArgv(setting, { path: "/x.txt" }).how ?? String(setting);
      this.flash = LINK_WORDS.demo(asked, resolvePath(l.path, { cwd, home: h }).map((c) => shownPath(c, { home: h })), how);
      cx.notify();
      return;
    }
    this.flash = LINK_WORDS.looking(asked);
    cx.notify();
    cx.spawn(async (cx) => {
      const found = await this.findLink(l.path, cwd);
      if (seq !== this.linkSeq || this.released) return;
      if (!found.path) { this.flash = LINK_WORDS.missing(asked, found.tried.map((c) => shownPath(c, { home: h }))); cx.notify(); return; }
      const shown = shownPath(found.path, { line: l.line, col: l.col, home: h });
      const res = await openPath(found.path, setting, { line: l.line, col: l.col });
      if (seq !== this.linkSeq || this.released) return;
      if (res.missing) this.flash = LINK_WORDS.missing(asked, found.tried.map((c) => shownPath(c, { home: h })));
      else {
        this.flash = res.ok ? LINK_WORDS.opened(shown, res.how) : LINK_WORDS.failed(shown, res.why);
        this.linkHit = { path: found.path, shown: shownPath(found.path, { home: h }), flash: this.flash };
      }
      cx.notify();
    });
  }

  // Reveal in Finder (the status line, after a path was found): open -R, nothing launched.
  revealLink(cx) {
    const hit = this.linkHit;
    if (!hit) return;
    cx.spawn(async (cx) => {
      const r = await revealPath(hit.path);
      this.flash = r.ok ? LINK_WORDS.revealed(hit.shown) : LINK_WORDS.failed(hit.shown, r.why);
      this.linkHit = { ...hit, flash: this.flash };
      cx.notify();
    });
  }

  // Copy path (the status line, after a path was found): the absolute path to the clipboard; nothing pasted.
  copyLinkPath(cx) {
    const hit = this.linkHit;
    if (!hit) return;
    cx.write_to_clipboard(hit.path);
    this.flash = LINK_WORDS.copied(hit.path);
    this.linkHit = { ...hit, flash: this.flash };
    cx.notify();
  }

  // ── render ───────────────────────────────────────────────────────────
  render(cx) {
    this.rcx = cx;
    // The theme with this config's text scale (config.js withScale: t.ts(n) is every text size).
    const t = withScale(theme(), textScaleOf(this.cfg));
    const root = v_flex().id("ledgr-detail").track_focus(this.keys)
      .on_key_down((e, cx) => {
        if ((e?.keystroke ?? e?.key) !== "escape") return;
        this.closedBy ??= "esc";
        this.close();
        cx.stop_propagation();
      })
      .on_size_change((size, cx) => this.noteWidth(size, cx))
      .size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(t.ts(12.5));
    if (!this.p.ok) return root.child(this.nothing(t, `Nothing to show (${this.p.error}).`));
    const st = this.viewStore();
    st.threshold = thresholdOf(this.cfg);
    this.settleReopen(st);
    this.lookInArchive(st, cx);
    const r = this.resolve(st);
    this.archiveAgain(st, r, cx);
    if (!r) {
      // An item of a cold session not read here yet: read now (from a timer), "Reading…" meanwhile; unreadable
      // (here, or by the writer), its words and Try again.
      const cs = this.coldTarget(), c = cs ? this.coldOf(cs) : null;
      if (cs && this.loaded && this.coldDue(cs)) cx.timer.after(0, (cx) => { if (!this.released) this.wantCold(cs, cx); });
      if (c?.state === "fault" && !this.released) this.coldOthers(cs, c.file, cx);   // its other files, named in its words
      const retry = c && c.state !== "loading" ? btn(t, "dt-cold-retry", COLD_RETRY, (_e, cx) => { const s = this.viewStore().d.sessions[cs]; if (s) this.coldRetry(s, cx); cx.notify(); }) : null;
      return root.child(this.header(t, st, null)).child(this.nothing(t, this.goneWords(), retry));
    }
    if (r.kind === "branch") this.pumpBranch(st, r.x, cx);
    // A record that reached the store after the start task (a reload): its fields, its message and the
    // props' open state, made in a timer (never in render); the keyboard as on open, the first time. An
    // archived record that came back (Reopen) is prepared again as the live item.
    if (this.preparedFor !== this.prepKey(r) && !this.preparing) {
      this.preparing = true;
      cx.timer.after(0, (cx) => {
        this.preparing = false;
        const now = this.resolve(this.viewStore());
        if (this.released || !now || this.preparedFor === this.prepKey(now)) return;
        const first = !this.preparedFor;
        this.prepare(cx);
        this.applyOpen(cx);
        if (first) this.focusFirst(cx);
        cx.notify();
      });
    }
    const two = twoColumns(this.width);
    const left = this.leftParts(t, st, r);
    const msg = this.messageParts(t, st, r);
    const busy_ = this.closing || this.pastePending();
    // The marked passage, scrolled into view once per message view.
    const hitIdx = msg.hitAt < 0 ? -1 : two ? msg.hitAt : left.length + msg.hitAt;
    const view = `${r.x.id}:${this.whole}:${two}:${msg.size}`;
    if (hitIdx >= 0 && msg.size && this.scrolledTo !== view) { this.scrolledTo = view; try { (two ? this.msgScroll : this.leftScroll).scroll_to_item(hitIdx); } catch { /* stays at the top */ } }
    // Its height fits an open ask's answer box (noteFit, fitAnswer).
    const leftCol = v_flex().id("dt-left").min_h(0).h_full().overflow_y_scrollbar().track_scroll(this.leftScroll).px(16).py(LEFT_PY).gap(LEFT_GAP)
      .on_size_change((size, cx) => this.noteFit("col", null, size?.height, cx))
      .when(two, (el) => el.flex_none().w(leftWidth(this.width)))
      .when(!two, (el) => el.flex_1().min_w(0))
      .children(two ? left : [...left, ...msg.parts]);
    return root
      .child(this.header(t, st, r))
      .child(h_flex().id("dt-body").flex_1().min_h(0).items_stretch().when(busy_, (el) => el.opacity(0.55))
        .child(leftCol)
        .when(two, (el) => el.child(v_flex().id("dt-msg").flex_1().min_w(0).min_h(0).h_full().overflow_y_scrollbar().track_scroll(this.msgScroll)
          .border_l(1).border_color(t.border).px(16).py(12).gap(6).children(msg.parts))))
      .child(this.footer(t, st, r, busy_));
  }

  // The archive as read, read again for a record shown from it (or looked for in it, lookInArchive): when the
  // session's count moved (an item archived or reopened elsewhere), or ARCHIVE_RETRY_MS after a read that
  // failed or got no answer. From render: through a timer; the next render prepares what it finds.
  archiveAgain(st, r, cx) {
    const a = this.arch, tg = this.target;
    if (!a || a.loading || this.demo || !a.sid || this.released) return;
    if (!(r?.archived || (!r && (tg?.archived || this.archLooked === tg?.id)))) return;
    const moved = a.count !== archivedCount(st.d.sessions[a.sid]?.archived);
    if (!moved && !(a.error && Date.now() >= (a.retryAt ?? 0))) return;
    a.loading = true;
    const sid = a.sid;
    cx.timer.after(0, (cx) => cx.spawn(async (cx) => { await this.readArchive(sid, cx); if (!this.released) cx.notify(); }));
  }

  // Why no record shows: the ledger not read yet; an archived record (or one looked for in the archive after
  // it left the store) whose archive is being read, could not be read, or holds no line for it; else it is gone.
  goneWords() {
    if (!this.loaded) return "Reading the ledger…";
    const tg = this.target;
    // Its session's items wait in ledgr-data/cold/ (retention Phase 2): read here, or why they cannot be.
    const cs = this.coldTarget(), c = cs ? this.coldOf(cs) : null;
    if (c) return c.state === "fault" ? coldFaultWords({ error: c.error, held: c.held, file: c.file, others: this.coldOthers(cs, c.file, null) ?? [] }) : c.state === "error" ? coldErrorWords(c.error, c.file) : coldLoadingWords();
    if (tg?.archived || (tg && this.archLooked === tg.id)) {
      const a = this.arch;
      if (!a || a.loading || a.sid !== tg.session) return ARCHIVE_READING;
      if (a.error) return archiveFailedWords(a.error);
      return tg.archived ? archiveGoneWords(tg.archived) : DETAIL_GONE;
    }
    return DETAIL_GONE;
  }

  // A bad shape or a record that is gone: one line and Close (and `extra`, a button before it: a cold
  // session's Try again).
  nothing(t, words, extra = null) {
    return v_flex().id("dt-nothing").flex_1().min_h(0).px(20).py(18).gap(12)
      .child(div().text_size(t.ts(12.5)).text_color(t.muted).child(words))
      .child(h_flex().gap(8).items_center()
        .when(Boolean(extra), (el) => el.child(extra))
        .child(btn(t, "dt-x", "Close", (_e, cx) => { this.closedBy = "esc"; this.close(); cx.notify(); }, { primary: !extra }))
        .child(div().flex_1())
        .child(keyHints(t, [["Esc", "close"]])));
  }

  // The session's own words in the header: its agent label, name and pane; a pin of a forgotten session
  // names it from the pin's source and says "forgotten".
  sessionBits(t, s, src = null, sid = null) {
    const w = this.width < 760 ? 120 : 220;   // narrow: room for ← prev, "3 of 19", next →
    if (s) return [pill(t, agentLabel(s.agent, s.profile)), div().flex_none().max_w(w).truncate().text_size(t.ts(11.5)).text_color(t.muted).child(sessionWords(s)),
      s.terminal ? div().flex_none().text_size(t.ts(10.5)).text_color(t.dim).child(P(s.terminal)) : null];
    if (src) return [pill(t, agentLabel(src.agent, src.profile)), div().flex_none().max_w(w).truncate().text_size(t.ts(11.5)).text_color(t.muted).child(sessionWords({ ...src, sessionId: sid })),
      div().flex_none().text_size(t.ts(10.5)).text_color(t.dim).child("forgotten")];
    return [];
  }

  // ← prev, "3 of 19", next → (2026-11-11): where this record stands in its lane (laneSpot) and the way to
  // its neighbours (step). At an end its control is dimmed and takes no click; a lane of one shows none.
  navBits(t, st, r) {
    const nb = this.laneSpot(st, r);
    if (!nb.at || nb.of < 2) return [];
    const ctl = (id, label, to, d, tip) => div().id(id).flex_none().px(5).rounded(4).text_size(t.ts(11))
      .when(Boolean(to), (x) => x.text_color(t.muted).cursor_pointer().hover((y) => y.bg(t.hover).text_color(t.foreground)).tooltip(tip)
        .on_click((_e, cx) => { cx.stop_propagation(); this.step(d, cx); cx.notify(); }))
      .when(!to, (x) => x.text_color(t.dim).opacity(0.45))
      .child(label);
    return [ctl("dt-prev", "← prev", nb.prev, -1, "The previous one in the list (⌘↑)"),
      div().id("dt-pos").flex_none().text_size(t.ts(11)).text_color(t.dim).child(`${nb.at} of ${nb.of}`),
      ctl("dt-next", "next →", nb.next, 1, "The next one in the list (⌘↓); what you typed here is kept")];
  }

  header(t, st, r) {
    const el = h_flex().id("dt-head").h(t.ts(44)).flex_none().px(16).gap(8).items_center().border_b(1).border_color(t.border);
    const esc = div().id("dt-esc").flex_none().px(5).rounded(4).text_size(t.ts(11)).text_color(t.dim).cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground))
      .tooltip("Close (Esc)").on_click((_e, cx) => { cx.stop_propagation(); this.closedBy = "esc"; this.close(); }).child("Esc");
    const demo = this.demo ? pill(t, "demo", t.accent) : null;
    if (!r) return el.child(div().flex_1().min_w(0).font_semibold().text_size(t.ts(13)).text_color(t.muted).child(this.loaded && !this.coldTarget() ? "Gone" : "ledgr")).when(Boolean(demo), (x) => x.child(demo)).child(esc);
    const x = r.x, here = this.target.session, ctx = rowCtx(this, st, here);
    const state = stateOf(r.kind, x, ctx), model = rowModel(r.kind, x, ctx);
    let mark, name, facts, sess;
    if (r.kind === "ask" || r.kind === "question") {
      const sug = r.kind === "ask" && isSuggestion(x, st.threshold);
      mark = glyph(t, x, sug);
      name = H(x);
      facts = [x.kind, `turn ${x.anchor?.turn ?? "?"}`, originWords(x.origin)].filter(Boolean).join(" · ");
      sess = this.sessionBits(t, st.d.sessions[x.anchor?.sessionId] ?? null);
    } else if (r.kind === "pin") {
      mark = svg(ICON("pin")).size(12).flex_none().text_color(x.status === "archived" ? t.dim : t.accent);
      name = handleWords(x.handle);
      facts = pinAnchorWords(x);
      sess = this.sessionBits(t, st.d.sessions[x.sessionId] ?? null, x.source ?? {}, x.sessionId);
    } else {
      mark = svg(ICON("git-branch")).size(12).flex_none().text_color(t.accent);
      name = branchWords(st.item(x.requestId));
      facts = `depth ${x.depth ?? "?"}`;
      sess = this.sessionBits(t, st.d.sessions[x.parentSessionId] ?? null);
    }
    return el
      .child(div().w(14).flex_none().flex().items_center().child(mark))
      .child(div().flex_none().font_semibold().text_size(t.ts(13)).child(name))
      .when(Boolean(model?.pill?.text), (y) => y.child(badge(t, model.pill.text, tone(t, model.pill.tone))))
      .child(div().flex_1().min_w(0).truncate().text_size(t.ts(11)).text_color(t.dim).child(facts))
      .when(Boolean(state?.word), (y) => y.child(div().flex_none().text_size(t.ts(11)).text_color(tone(t, state.tone)).child(state.word)))
      .children(sess.filter(Boolean))
      .when(Boolean(demo), (y) => y.child(demo))
      .children(this.navBits(t, st, r))
      .child(esc);
  }

  // ── the left column (2.4) ────────────────────────────────────────────
  leftParts(t, st, r) {
    if (r.kind === "ask" || r.kind === "question") return this.itemParts(t, st, r.kind, r.x);
    if (r.kind === "pin") return this.pinParts(t, st, r.x);
    const ts = st.d.sessions[r.x.parentSessionId] ?? null;
    return [...branchBody(this, t, st, ts, r.x), this.branchFoot(t, st, r.x)];
  }

  copyChip(t, id, text, what) {
    return chip(t, id, "Copy", (_e, cx) => this.copyText(text, what, cx), { tip: `${what} as stored, to the clipboard; nothing is pasted` });
  }

  // The left column of an ask or a question (2.4). An ask (2026-11-23), top to bottom: ARCHIVED (an archived
  // record), TEXT, WHAT TO DO (its summary, the agent's words: markdown, linkified as the text is; none, no
  // section), OPTIONS, ANSWER (open, live, its session known: the column's main region), RESULT, QUESTIONS
  // ABOUT IT, then QUOTE (dim: the message beside it marks the passage) and the foot line (who raised it, its
  // level and turn). With an answer box the parts above and below it are drawn as two groups, each reporting
  // its height, and the section reports its own (noteFit): the box takes what the column leaves free
  // (fitAnswer). A question keeps its order: TEXT, QUOTE, ABOUT, PINS, BRANCHES, the confirmation, RESULT.
  itemParts(t, st, kind, it) {
    const closed = isClosed(it), here = this.target.session ?? it.anchor?.sessionId, ctx = rowCtx(this, st, here);
    const s = st.d.sessions[it.anchor?.sessionId] ?? null;
    const ask = kind === "ask";
    const quote = it.anchor?.quote ? String(it.anchor.quote).trim() : "";
    const mode = ask ? "markdown" : "verbatim";
    const onLink = ask ? this.linkFn : null;   // an ask's text, summary and quote are markdown: their links open (openLink)
    const above = [], below = [];
    // An archived record (retention, 2026-11-19): marked first, with when and how it was closed (its state word
    // as it was in the list) and where it is kept; read-only below (closed: no answer box, no options to click).
    const archived = Boolean(it.archiveFile);
    if (archived) {
      const how = stateOf(kind, { ...it, archiveFile: null }, ctx).word;
      above.push(section(t, `dt-sec-arch-${it.id}`, "ARCHIVED", [
        div().id(`dt-arch-when-${it.id}`).text_size(t.ts(12)).text_color(t.foreground).child(archivedWords(it, how)),
        div().id(`dt-arch-file-${it.id}`).text_size(t.ts(11)).text_color(t.dim).child(archiveFileWords(archiveDir(it.anchor?.sessionId), it.archiveFile)),
      ], { extra: badge(t, "archived", t.dim) }));
    }
    if (it.text) above.push(section(t, `dt-sec-text-${it.id}`, "TEXT",
      readable(t, `dt-text-${it.id}`, it.text, { mode, size: 13, onLink }), { extra: this.copyChip(t, `dt-cp-text-${it.id}`, it.text, "The text") }));
    const quoteSec = quote ? section(t, `dt-sec-quote-${it.id}`, it.kind === "bookmark" ? "BOOKMARKED PASSAGE" : "QUOTE",
      readable(t, `dt-quote-${it.id}`, quote, ask ? { mode, italic: true, dim: true, size: 12, onLink } : { mode, italic: true, muted: true, onLink }),
      { extra: this.copyChip(t, `dt-cp-quote-${it.id}`, quote, "The quote") }) : null;
    let box = null;
    if (ask) {
      const todo = summaryOf(it);
      if (todo) above.push(section(t, `dt-sec-todo-${it.id}`, "WHAT TO DO",
        div().id(`dt-todo-edge-${it.id}`).w_full().min_w(0).pl(8).border_l(2).border_color(t.accent)
          .child(readable(t, `dt-todo-${it.id}`, todo, { mode, size: 12.5, onLink })),
        { tone: t.accent, extra: this.copyChip(t, `dt-cp-todo-${it.id}`, todo, "What to do") }));
      if (it.kind === "decide" && (it.options ?? []).length) above.push(section(t, `dt-sec-opts-${it.id}`, "OPTIONS", optionChips(this, t, it)));
      // Never on an archived record, whatever status its line holds (it is read-only until Reopen).
      if (!closed && !archived && s) box = this.answerSection(t, st, s, it);
    } else {
      if (quoteSec) above.push(quoteSec);
      const about = this.aboutLines(t, st, it);
      if (about.length) above.push(section(t, `dt-sec-about-${it.id}`, "ABOUT", about));
      const pins = st.pinsOf(it);
      if (pins.length) above.push(section(t, `dt-sec-pins-${it.id}`, `PINS (${pins.length})`,
        pins.map((p) => subRow(t, rowModel("pin", p, ctx), (cx) => this.retarget("pin", p.id, here, cx)))));
      const brs = st.branchesFor(it.id);
      if (brs.length) above.push(section(t, `dt-sec-brs-${it.id}`, "BRANCHES",
        brs.map((b) => subRow(t, rowModel("branch", b, ctx), (cx) => this.retarget("branch", b.id, here, cx)))));
      if (this.confirm?.itemId === it.id && !closed && s) above.push(confirmBox(this, t, st, s, it));
    }
    const res = this.resultLines(t, st, s, it, ctx);
    if (res.length) below.push(section(t, `dt-sec-res-${it.id}`, "RESULT", res));
    if (ask) {
      const kids = st.itemsOf(it.anchor?.sessionId).filter((c) => c.parentId === it.id && isHuman(c));
      if (kids.length) below.push(section(t, `dt-sec-kids-${it.id}`, "QUESTIONS ABOUT IT",
        kids.map((c) => subRow(t, rowModel("question", c, ctx), (cx) => this.retarget("question", c.id, here, cx)))));
      if (quoteSec) below.push(quoteSec);
    }
    const gone = !archived && s && this.terminalGone(st, s), rs = s?.resume;
    if (gone && rs?.state === "failed") below.push(div().id(`dt-resume-failed-${it.id}`).text_size(t.ts(10.5)).text_color(t.blocked).child(`Resume did not start: ${rs.error ?? "unknown error"}`));
    if (gone && rs?.state === "launched" && rs.note) below.push(div().id(`dt-resume-note-${it.id}`).text_size(t.ts(10.5)).text_color(t.dim).child(`Resumed in ${P(rs.terminal)}: ${rs.note}`));
    below.push(div().id(`foot-${it.id}`).text_size(t.ts(10)).text_color(t.dim)
      .child([H(it), originWords(it.origin), ask ? levelOf(it) : null, `turn ${it.anchor?.turn ?? "?"}`, it.anchor?.hash ? `#${it.anchor.hash}` : null].filter(Boolean).join(" · ")));
    if (!box) return [...above, ...below];
    // The answer box between two measured groups (the column's direct children: [above,] ANSWER, below).
    const id = it.id, m = this.fitOf(id);
    this.fit.id = id;
    if (!above.length) m.above = 0;
    m.gaps = LEFT_GAP * (above.length ? 2 : 1);
    const group = (key, parts) => v_flex().id(`dt-${key}-${id}`).w_full().flex_none().gap(LEFT_GAP).children(parts)
      .on_size_change((size, cx) => this.noteFit(key, id, size?.height, cx));
    return [above.length ? group("above", above) : null, box, group("below", below)].filter(Boolean);
  }

  // The ANSWER section of an open ask: the box at the frame's height (frameFor: fitAnswer's; its least until
  // the first measures, and always in one column), the section reporting its own height (noteFit "ans").
  // Records the frame drawn (its `drawn`), so the section's report less it is its chrome.
  answerSection(t, st, s, it) {
    const scale = textScaleOf(this.cfg), id = it.id;
    const frame = this.frameFor(id, scale);
    this.fitOf(id).drawn = frame;
    const below = [attachRow(this, t, it, this.attachRowFor(it), { busy: this.attachBusy() })];
    return section(t, `dt-sec-ans-${id}`, "ANSWER", answerBox(this, t, st, s, it, { frame, below, onFrame: () => this.focusAnswer(id),
      onDrop: (ev, cx) => this.dropOnAnswer(id, ev, cx) }))
      .on_size_change((size, cx) => this.noteFit("ans", id, size?.height, cx));
  }

  // A question's about lines: when it was parked and anchors, what it is about, its turn's fate.
  aboutLines(t, st, it) {
    const line = (w) => div().text_size(t.ts(11.5)).text_color(t.muted).child(w);
    const out = [];
    if (it.status === "open" && it.anchor && !it.anchor.settled) out.push(line(`parked during turn ${it.anchor.turn}; anchors at end of turn`));
    else {
      const bits = [`parked at turn ${it.anchor?.turn ?? "?"}`];
      if (it.anchor?.interrupted) bits.push("turn interrupted");
      if (it.anchor?.reanchoredFrom !== undefined) bits.push(`re-anchored from turn ${it.anchor.reanchoredFrom}`);
      if (it.askedAtTurn) bits.push(`sent at turn ${it.askedAtTurn}`);
      if (it.origin === "btw" || it.btwStagedAt) bits.push("staged as /btw");
      out.push(line(bits.join(" · ")));
    }
    // The ask it is about; archived with it, from the archive as read (its sub-row opens it read-only).
    const parent = it.parentId ? st.item(it.parentId) ?? this.archRecord(it.parentId) : null;
    if (parent) out.push(subRow(t, rowModel(kindOf(parent.id, parent) ?? "ask", parent, rowCtx(this, st, this.target.session)),
      (cx) => this.retarget(kindOf(parent.id, parent) ?? "ask", parent.id, this.target.session, cx, parent.archiveFile ?? null)));
    return out;
  }

  // What became of it: the answer, who closed it and when, a staged confluence, raised again, its note,
  // deferred.
  resultLines(t, st, s, it, ctx) {
    const out = [], dim = (w) => div().text_size(t.ts(11.5)).text_color(t.dim).child(w);
    if (isAgentAsk(it) && it.answer && (it.status === "answered" || (it.status === "resolved" && it.resolvedBy === "answer"))) {
      out.push(h_flex().gap(6).items_start().child(div().flex_none().text_size(t.ts(12)).text_color(t.accent).child("→"))
        .child(readable(t, `dt-answer-text-${it.id}`, it.answer, { mode: "verbatim", size: 12 })));
    }
    if (it.status === "rejoin_pending") {
      const rb = st.d.branches[it.rejoin?.branchId];
      out.push(dim(`The confluence from its branch${rb?.name ? ` (${rb.name})` : ""} is staged for ${trunkWords(s?.terminal)}: it resolves when it is sent there.`));
    }
    if (it.status === "resolved" && it.resolvedBy === "branch") { const rn = st.d.branches[it.resolution?.branchId]?.name; out.push(dim(`${resolvedByWords("branch")}${rn ? ` (${rn})` : ""} at turn ${it.resolvedTurn ?? "?"}`)); }
    else if (it.status === "resolved" && resolvedByWords(it.resolvedBy)) out.push(dim(`${resolvedByWords(it.resolvedBy)} at turn ${(it.resolvedBy === "answer" ? it.answeredTurn : null) ?? it.resolvedTurn ?? "?"}${it.resolvedNote ? ` · ${it.resolvedNote}` : ""}`));
    else if (it.status === "resolved") out.push(dim(`Done${it.resolvedTurn ? ` at turn ${it.resolvedTurn}` : ""}.`));
    if (it.status === "dismissed") out.push(dim(`${dismissedByWords(it.dismissedBy) ?? "Not needed"}${it.resolvedTurn ? ` at turn ${it.resolvedTurn}` : ""}; Reopen brings it back.`));
    if (isAgentAsk(it) && it.repeatOf) {
      const prev = st.item(it.repeatOf) ?? this.archRecord(it.repeatOf);   // the earlier ask may be archived
      out.push(dim(`Raised again: the agent asked this before${prev?.status === "dismissed" ? " and it was closed as not needed" : ""}.`));
      if (prev) out.push(subRow(t, rowModel("ask", prev, ctx), (cx) => this.retarget("ask", prev.id, this.target.session, cx, prev.archiveFile ?? null)));
    }
    if (it.note) out.push(readable(t, `dt-note-${it.id}`, it.note, { mode: "verbatim", muted: true, size: 11.5 }));
    if (it.status === "deferred") out.push(dim(it.deferUntil === "next_session" ? "Deferred to the next session." : typeof it.deferUntil === "number" ? `Deferred until ${new Date(it.deferUntil).toLocaleString()}.` : "Deferred."));
    return out;
  }

  pinParts(t, st, p) {
    const out = [], here = this.target.session;
    const badges = [];
    if (!p.anchor?.verified) badges.push(badge(t, "unverified", t.dim));
    if (p.clipped) badges.push(badge(t, "clipped", t.dim));
    if (p.status === "archived") badges.push(badge(t, "archived", t.dim));
    out.push(section(t, `dt-sec-pass-${p.id}`, "PASSAGE", readable(t, `dt-pin-${p.id}`, p.text, { mode: "verbatim", size: 13 }),
      { extra: [...badges, this.copyChip(t, `dt-cp-pin-${p.id}`, p.text, "The passage")] }));
    const nb = pinNoteBox(this, t, p);
    if (nb) out.push(section(t, `dt-sec-note-${p.id}`, "NOTE", nb));
    else if (p.note) out.push(section(t, `dt-sec-note-${p.id}`, "NOTE", readable(t, `dt-pinnote-${p.id}`, p.note, { mode: "verbatim", italic: true, muted: true })));
    out.push(section(t, `dt-sec-anchor-${p.id}`, "ANCHOR", div().text_size(t.ts(11.5)).text_color(t.muted)
      .child(`${p.sessionId !== here ? `${pinSourceWords(p, here)} · ` : ""}${pinAnchorWords(p)}${st.d.sessions[p.sessionId] ? "" : " · its session was forgotten"}`)));
    const uses = pinUseLines(p, st);
    if (uses.length) out.push(section(t, `dt-sec-used-${p.id}`, "USED IN", uses.map((u) => {
      const q = st.item(u.question);
      if (!q) return div().text_size(t.ts(11.5)).text_color(t.dim).child(u.words);
      return h_flex().id(`dt-use-${p.id}-${q.id}`).flex_none().h(t.ts(26)).px(6).gap(6).items_center().rounded(6).cursor_pointer().hover((x) => x.bg(t.hover))
        .tooltip("Open that question in this dialog").on_click((_e, cx) => { cx.stop_propagation(); this.retarget("question", q.id, u.session ?? q.anchor?.sessionId, cx); })
        .child(div().flex_none().text_size(t.ts(11.5)).text_color(t.foreground).child(u.words))
        .child(div().flex_1().min_w(0).truncate().text_size(t.ts(11.5)).text_color(t.dim).child(`“${squash(q.text)}”`))
        .child(div().flex_none().text_size(t.ts(10.5)).text_color(t.accent).child("open ›"));
    })));
    out.push(div().id(`pinf-${p.id}`).text_size(t.ts(10)).text_color(t.dim)
      .child(`${handleWords(p.handle)} · pinned by you · ${p.anchor?.approx ? "around turn" : "turn"} ${p.anchor?.turn ?? "?"}${p.anchor?.hash ? ` · #${p.anchor.hash}` : ""}${p.anchor?.reanchoredFrom !== undefined ? ` · re-anchored from turn ${p.anchor.reanchoredFrom}` : ""}`));
    return out;
  }

  branchFoot(t, st, br) {
    const it = st.item(br.requestId);
    return div().id(`dt-brfoot-${br.id}`).text_size(t.ts(10)).text_color(t.dim)
      .child([branchWords(it), br.name, `depth ${br.depth ?? "?"}`, br.id].filter(Boolean).join(" · "));
  }

  // ── the message column (2.3) ─────────────────────────────────────────
  // {parts: [head, ...blocks], hitAt: the passage block's index in parts (-1: none), size: the text's
  // length (0 while loading)}.
  messageParts(t, st, r) {
    let title, text, quote, gone;
    if (r.kind === "ask" || r.kind === "question") {
      const it = r.x, turn = it.anchor?.turn;
      title = `THE MESSAGE · turn ${turn ?? "?"}`;
      text = this.passages.get(`${it.anchor?.sessionId}:${turn}`);
      quote = it.anchor?.quote;
      gone = messageGone(turn);
    } else if (r.kind === "pin") {
      const p = r.x;
      title = `ITS MESSAGE · turn ${p.anchor?.turn ?? "?"}`;
      text = this.passages.get(`${p.sessionId}:${p.anchor?.turn}`);
      quote = p.text;
      gone = PIN_MESSAGE_GONE;
    } else {
      const br = r.x, m = this.brMsg.get(br.id);
      title = `THE BRANCH'S LAST MESSAGE${m?.turn ? ` · its turn ${m.turn}` : ""}`;
      if (!br.sessionId) return this.messageNote(t, title, "This branch has no session of its own recorded: its conclusion and manifest are on the left.");
      if (m?.waiting) return this.messageNote(t, title, BRANCH_NO_TURN);
      text = m && "text" in m ? m.text : undefined;
      quote = text ? extractConclusion(text) : null;
      gone = messageGone(m?.turn);
    }
    if (text === undefined) return this.messageNote(t, title, "Loading the message…");
    if (!text) return this.messageNote(t, title, gone);
    const id = r.x.id;
    const head = h_flex().id("dt-msg-head").flex_none().gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(t.ts(10.5)).font_semibold().text_color(t.dim).child(title))
      .child(chip(t, `dt-around-${id}`, "around", (_e, cx) => { this.whole = false; cx.notify(); }, { on: !this.whole, tip: "The passage with about 600 characters either side" }))
      .child(chip(t, `dt-whole-${id}`, "whole", (_e, cx) => { this.whole = true; cx.notify(); }, { on: this.whole, tip: "The whole message" }))
      .child(this.copyChip(t, `dt-cp-msg-${id}`, text, "The message"));
    const blocks = messageBlocks(t, id, text, quote, { whole: this.whole, onLink: this.linkFn });
    return { parts: [head, ...blocks], hitAt: blocks.hitAt < 0 ? -1 : 1 + blocks.hitAt, size: text.length };
  }

  messageNote(t, title, words) {
    return { parts: [div().id("dt-msg-head").flex_none().text_size(t.ts(10.5)).font_semibold().text_color(t.dim).child(title),
      div().id("dt-msg-note").text_size(t.ts(11.5)).text_color(t.dim).child(words)], hitAt: -1, size: 0 };
  }

  // ── the footer: the status line, the actions, the key hints ──────────
  footer(t, st, r, busy_) {
    const s = r.kind === "pin" ? null : r.kind === "branch" ? st.d.sessions[r.x.parentSessionId] ?? null : st.d.sessions[r.x.anchor?.sessionId] ?? null;
    let acts = [];
    if (r.archived) acts = this.archivedActions(t, r.x);
    else if (r.kind === "ask" || r.kind === "question") acts = s ? this.itemActions(t, st, s, r.x) : [];
    else if (r.kind === "pin") acts = this.pinActions(t, st, r.x);
    else {
      const br = r.x, live = this.branchLive(br), it = st.item(br.requestId);
      const msg = this.brMsg.get(br.id), concl = msg?.text ? extractConclusion(msg.text) : null;
      const focusOk = Boolean(br.terminal) && !["closed", "ended", "failed", "refused", "nostart"].includes(live);
      acts = [branchActions(this, t, st, s, br, { canC: this.canConclude(st, br), concl, staged: br.status === "concluded" || br.status === "rejoined", focusOk, live, it, anchor: "bottom_right" })];
    }
    const field = { answer: r.kind === "ask" && !isClosed(r.x) && this.answerFor === r.x.id, note: this.note?.pinId === r.x.id, conclude: this.conclude?.branchId === r.x.id };
    // A path a link click found: Reveal in Finder and Copy path beside the status line, while it says so.
    const hit = this.linkHit && this.flash === this.linkHit.flash ? this.linkHit : null;
    return v_flex().id("dt-foot").flex_none().border_t(1).border_color(t.border).px(16).py(8).gap(6)
      .when(Boolean(this.flash) && !hit, (el) => el.child(div().id("dt-flash").text_size(t.ts(11)).text_color(t.muted).child(this.flash)))
      .when(Boolean(hit), (el) => el.child(h_flex().id("dt-flash-row").gap(6).items_center()
        .child(div().id("dt-flash").flex_1().min_w(0).text_size(t.ts(11)).text_color(t.muted).child(this.flash))
        .child(chip(t, "dt-link-reveal", "Reveal in Finder", (_e, cx) => this.revealLink(cx), { tip: `Show ${hit.shown} in its folder (open -R); nothing is launched` }))
        .child(chip(t, "dt-link-copy", "Copy path", (_e, cx) => this.copyLinkPath(cx), { tip: `${hit.path} to the clipboard; nothing is pasted` }))))
      .child(h_flex().gap(10).items_center()
        .child(h_flex().id("dt-acts").flex_1().min_w(0).flex_wrap().gap(6).items_center().when(busy_, (el) => el.opacity(0.55)).children(acts))
        .child(keyHints(t, detailHints({ ...field, paste: this.pasteOn() }))));
  }

  // An archived record's one action (retention, 2026-11-19): Reopen, "Reopening…" while the writer brings it
  // back (reopenArchived). Nothing else: no Done, Defer, Not needed, staging or Go to anchor.
  archivedActions(t, it) {
    const busy = this.reopening?.id === it.id && !this.reopening.slow;   // slow: Reopen can be pressed again
    return [btn(t, `dt-restore-${it.id}`, busy ? "Reopening…" : "Reopen", (_e, cx) => this.reopenArchived(it, cx),
      { primary: true, disabled: busy, tip: `Back to the list, open: the ledgr writer reads ${H(it)} from ${it.archiveFile} and puts it back under its own handle` })];
  }

  // An ask's or a question's buttons (the expanded row's, before the dialog): the primary step, Done,
  // Defer ▾, the kind's own, ⋯ for the rest. Done, Not needed and Defer close the dialog.
  itemActions(t, st, s, it) {
    const agent = isAgentAsk(it), L = stageLabels(this.pasteOn()), closed = isClosed(it);
    const a = [], more = [];
    const b = (id, label, fn, o) => a.push(btn(t, `dt-${id}-${it.id}`, label, fn, o));
    const m = (id, label, fn, o) => more.push([id, label, fn, o]);
    const pend = it.status === "rejoin_pending";
    const pendBr = pend ? st.d.branches[it.rejoin?.branchId] ?? null : null;
    if (pend && pendBr?.conclusion?.message) b("again", L.again, (_e, cx) => this.copyConfluence(st, pendBr, cx), { primary: true });
    const qPins = isHuman(it) ? st.pinsOf(it) : [];
    if (qPins.length && !closed && !pend) b("askhere", L.ask, (_e, cx) => this.askPinsHere(it, s, cx), { primary: true,
      tip: `${H(it)} and its ${pinsWords(qPins.length)}, quoted with where each came from: ${this.pasteOn() ? `pasted into the prompt in ${P(s.terminal, "the pane")} once it has the focus; never sent` : `clipboard + focus ${P(s.terminal, "the pane")}`}` });
    if (closed || it.status === "deferred") b("reopen", "Reopen", (_e, cx) => this.act(it.id, "reopen", null, cx));
    if (!closed) b("done", "Done", (_e, cx) => this.actClose(it, "resolve", null, cx), { tip: DONE_TIP });
    if (!closed && it.status !== "deferred" && !pend) a.push(menuButton(this, t, `defer-${it.id}`, "Defer ▾", [
      ["tomorrow", "Tomorrow", (_e, cx) => this.actClose(it, "defer", Date.now() + DAY, cx)],
      ["week", "In a week", (_e, cx) => this.actClose(it, "defer", Date.now() + 7 * DAY, cx)],
      ["next", "Next session", (_e, cx) => this.actClose(it, "defer", "next_session", cx), { tip: "Opens again when a session starts in the same folder" }],
    ], { width: 150, anchor: "bottom_left" }));
    if (agent && !closed && isSuggestion(it, st.threshold)) b("promote", "Promote", (_e, cx) => this.act(it.id, "promote", null, cx), { tip: "Make it an open ask that counts on the chip" });
    if (isHuman(it) && !closed && !pend) {
      const ok = this.branchable(s);
      const again = st.branchesFor(it.id).some((x) => x.status !== "refused" && x.status !== "failed");
      b("branch", again ? "Branch again…" : "Branch…", (_e, cx) => this.openConfirm(it, s, cx),
        { disabled: !ok, tip: ok ? "Fork this session into a new Claude session to settle this question" : "Branching needs a Claude Code session with the ledgr hooks" });
    }
    if (!closed && !pend) m("dismiss", "Not needed", (_e, cx) => this.actClose(it, "dismiss", null, cx), { tip: NOT_NEEDED_TIP });
    if (pend) m("calloff", "Call off the confluence", (_e, cx) => this.act(it.id, "reopen", null, cx), { tip: "Back to open; the branch keeps your edited conclusion for the next Conclude" });
    if (agent && !closed) m("ask", "Ask about this", (_e, cx) => this.askAbout(it, s, cx));
    // With pins, Copy for prompt copies the whole pins message (the question alone would leave its pins
    // behind), and there is no /btw: a /btw line cannot carry them.
    if (isHuman(it) && !closed && !pend && it.text && qPins.length) {
      m("prompt", "Copy for prompt", (_e, cx) => this.copyPinsMessage(it, s, cx), { tip: `Copies ${H(it)} with its ${pinsWords(qPins.length)}, quoted, as Ask here would paste it; nothing is focused or pasted` });
    } else if (isHuman(it) && !closed && !pend && it.text) {
      m("prompt", "Copy for prompt", (_e, cx) => this.stageQuestion(it, s, false, cx), { tip: `Copies “[${it.handle}] …”: that tag in a prompt marks ${H(it)} sent` });
      m("btw", "Stage /btw", (_e, cx) => this.stageQuestion(it, s, true, cx));
    }
    // Go to anchor needs the session's terminal; when it is gone, a Claude session can be resumed in a new
    // pane instead (the saved message stays on the right either way).
    const gone = this.terminalGone(st, s);
    const rs = s.resume;
    const resuming = Boolean(rs && (rs.state === "launching" || rs.state === "launched") && Date.now() - (rs.at ?? 0) < 60000);
    if (!gone) m("go", "Go to anchor", (_e, cx) => this.goTo(it, s, cx), { tip: "Focus the agent's pane and copy a slice of the quote to search for there (no keys are sent); the dialog closes" });
    else if (!this.branchable(s)) m("go", "Go to anchor", () => {}, { disabled: true, tip: `Its terminal${s.terminal ? ` (${P(s.terminal)})` : ""} is gone, and only a Claude Code session can be resumed. The saved message is here.` });
    else {
      const tx = this.transcriptOk(s);
      if (tx === false) m("resume", "Transcript gone", () => {}, { disabled: true, tip: `No transcript at ${transcriptPathOf(s, home())}: nothing to resume. The saved message is here.` });
      else m("resume", resuming ? "Resuming…" : "Resume session…", (_e, cx) => this.resume(s, cx),
        { disabled: resuming || tx !== true, tip: tx === undefined ? "Checking the transcript…" : `Its terminal${s.terminal ? ` (${P(s.terminal)})` : ""} is gone: start claude --resume ${String(s.sessionId).slice(0, 8)} in ${s.cwd || "its folder"}, in a new pane` });
    }
    if (more.length) a.push(menuButton(this, t, `more-${it.id}`, "⋯", more, { anchor: "bottom_right", tip: "More actions" }));
    return a;
  }

  // A pin's buttons: Ask here… (primary), Branch…, Note, Copy, ⋯ (Go to anchor or Resume, Archive); an
  // archived pin: Restore and Delete (two clicks). Archive and Delete close the dialog.
  pinActions(t, st, p) {
    const archived = p.status === "archived", L = stageLabels(this.pasteOn());
    const here = this.target.session, hs = here ? st.d.sessions[here] ?? null : null;
    const ps = st.d.sessions[p.sessionId] ?? null;   // null: the session was forgotten
    const s = hs ?? ps;                              // where a question about it parks: the panel's session
    const a = [], more = [];
    const b = (id, label, fn, o) => a.push(btn(t, `dt-${id}-${p.id}`, label, fn, o));
    const m = (id, label, fn, o) => more.push([id, label, fn, o]);
    if (archived) {
      b("pinrs", "Restore", (_e, cx) => this.pinAct("pin_restore", p, {}, cx), { tip: "Back to the lane" });
      const armed = this.pinDel?.pinId === p.id && Date.now() - this.pinDel.at < ARM_MS;
      a.push(div().id(`pindel-${p.id}`).flex_none().h(t.ts(22)).px(7).flex().items_center().rounded(6).border_1().text_size(t.ts(11)).cursor_pointer()
        .when(armed, (x) => x.border_color(t.blocked).bg(t.blocked + "26").text_color(t.blocked))
        .when(!armed, (x) => x.border_color(t.border).bg(t.background).text_color(t.foreground).hover((y) => y.opacity(0.85)))
        .tooltip(armed ? "Click again to delete it for good" : "Delete this pin (two clicks); nothing else ever removes one")
        .on_click((_e, cx) => { cx.stop_propagation(); this.deletePin(p, cx); })
        .child(armed ? `Delete ${handleWords(p.handle)}? It cannot come back` : "Delete"));
    } else {
      const sel = this.pinsFor(st, p);
      const what = sel.length > 1 ? `the ${pinsWords(sel.length)} selected` : "this pin";
      b("pinask", "Ask here…", (_e, cx) => this.openPinsBox(st, s, sel, "trunk", cx),
        { primary: true, disabled: !s, tip: s ? `Type a question about ${what}; it is parked in ${sessionWords(s)}, then ${L.ask} stages it with the passages for ${P(s.terminal, "the pane")}` : "No session to park a question in" });
      const ok = this.branchable(s);
      b("pinbr", "Branch…", (_e, cx) => this.openPinsBox(st, s, sel, "branch", cx),
        { disabled: !ok, tip: ok ? `Type a question about ${what}; it is parked and its Branch confirmation opens` : "Branching needs a Claude Code session with the ledgr hooks" });
      b("pinnote", p.note ? "Edit note" : "Note", (_e, cx) => this.editPinNote(p, cx));
    }
    b("pincopy", "Copy", (_e, cx) => this.copyPin(p, hs, cx), { tip: "The passage, quoted, with where it came from, to the clipboard; nothing is pasted" });
    const gone = !ps || this.terminalGone(st, ps);
    const rs = ps?.resume;
    const resuming = Boolean(rs && (rs.state === "launching" || rs.state === "launched") && Date.now() - (rs.at ?? 0) < 60000);
    if (!gone) m("go", "Go to anchor", (_e, cx) => this.goToPin(p, ps, cx), { tip: "Focus its pane and copy a slice of the passage to search for there (no keys are sent); the dialog closes" });
    else if (!ps) m("go", "Go to anchor", () => {}, { disabled: true, tip: "Its session was forgotten: the pin keeps the passage" });
    else if (!this.branchable(ps)) m("go", "Go to anchor", () => {}, { disabled: true, tip: `Its terminal${ps.terminal ? ` (${P(ps.terminal)})` : ""} is gone, and only a Claude Code session can be resumed: the pin keeps the passage` });
    else {
      const tx = this.transcriptOk(ps);
      if (tx === false) m("resume", "Transcript gone", () => {}, { disabled: true, tip: "Transcript gone: the pin keeps the passage" });
      else m("resume", resuming ? "Resuming…" : "Resume session…", (_e, cx) => this.resume(ps, cx),
        { disabled: resuming || tx !== true, tip: tx === undefined ? "Checking the transcript…" : `Its terminal is gone: start claude --resume ${String(ps.sessionId).slice(0, 8)} in ${ps.cwd || "its folder"}, in a new pane` });
    }
    if (!archived) m("pinarch", "Archive", (_e, cx) => this.archivePin(p, cx), { tip: "Out of the lane, into archived (Restore brings it back); the dialog closes" });
    if (more.length) a.push(menuButton(this, t, `pinmore-${p.id}`, "⋯", more, { anchor: "bottom_right", tip: "More actions" }));
    return a;
  }
}
