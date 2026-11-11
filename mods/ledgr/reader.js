// ledgr Reader (docs/design/Detail.md 1.11): what every reading copy of ledgr shares, moved out of
// panel.js nearly verbatim so the panel (panel.js, `class Panel extends Reader`) and the detail dialog
// (detail.js, `class Detail extends Reader`) run the same code. It reads ledgr-data/store.json and
// follows it with watchFolder; every act is a spool event (post), shown at once until store.json
// carries it (overlayLocal); typed answers are posted 800 ms after the last change (typeDraft), and
// flushPending writes whatever is still waiting (a closing overlay's tasks are cancelled after 250 ms).
// Staging a message for a prompt goes through one door: `stage` here, which hands it to nav.js
// stageMessage (the clipboard, the pane focused, `terminal.paste` once Herdr reports that terminal
// focused; never Enter). No other file stages: bin/tests/test_no_keystrokes.py enforces the chain.
// Never pings, never claims ledgr.writer, never runs a Writer: the panel adds its fallback writer on
// top (fallback, viewStore). The one writer of ledgr-data/config.json is here too (editConfig, through
// saveConfig): the panel's threshold menu and space switch, and the settings dialog (settings.js, a
// Reader too). Not an engine file.
import { readTextFile, writeTextFile, watchFolder, agents, terminals, home } from "herdr";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { DEFAULTS, loadConfig, dataDir, turnPath, storePath, configPath, liveHome } from "./config.js";
import { Store, isAgentAsk, isClosed } from "./store.js";
import { writeEvent } from "./spool.js";
import { stageMessage, promptText, PASTE } from "./nav.js";
import { FIXTURE_TURNS } from "./fixtures.js";
import { liveStatus, transcriptPathOf } from "./branch.js";
import { answersSheet, answersLeadIn, sheetOverCap } from "./confluence.js";
import { itemWords as H, paneWords as P, sessionWords } from "./words.js";

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// ── ledgr-data/config.json, the one writer (2026-11-10) ────────────────────
// Why a write did not happen when the file changed between this copy's read and its write (the hooks
// creating it, another ledgr copy, an editor): nothing was written; the caller reads the file again.
export const CONFIG_STALE = "config.json changed while it was being saved (the hooks, another ledgr copy or an editor); nothing was written and the file was read again, so try once more";
const objOf = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

// One change to config.json: read it, `edit(d)` the parsed object, write it back only if the file still
// holds what was read (writeTextFile's compare-and-swap; a missing or empty file starts from the
// defaults). A file that is not a JSON object is left alone. Resolves with the merged config as written
// (loadConfig's shape); rejects with the reason, `stale: true` when the file changed under it.
export async function editConfig(edit) {
  const path = configPath();
  const cur = await readTextFile(path).catch(() => null);
  let d;
  if (cur) { try { d = JSON.parse(cur); } catch { throw new Error("config.json is not valid JSON: fix it by hand first"); } }
  else d = JSON.parse(JSON.stringify(DEFAULTS));
  if (!objOf(d)) throw new Error("config.json is not a JSON object");
  edit(d);
  try { await writeTextFile(path, JSON.stringify(d, null, 2) + "\n", cur ?? null); }
  catch (e) {
    const now = await readTextFile(path).catch(() => null);
    if (now !== cur) { const err = new Error(CONFIG_STALE); err.stale = true; throw err; }
    throw e;
  }
  return loadConfig();
}

// The pin events a reader posts (store.js PIN_OPS), applied locally until store.json carries them.
export const PIN_ACTS = new Set(["pin_note", "pin_archive", "pin_restore", "pin_delete"]);

export class Reader {
  constructor(_cx, { demo = false } = {}) {
    this.cfg = DEFAULTS;
    this.demo = demo === true;
    this.demoStore = null;
    this.live = new Store(null);   // store.json as read
    this.liveText = null;
    this.localActs = [];           // acts posted but not yet in store.json (shown at once)
    this.drafts = new Map();       // answer text typed but not yet in store.json: id -> {text, sent, seq}
    this.passages = new Map();     // "<session>:<turn>" -> the turn's text (undefined: loading; null: not saved)
    this.txCheck = new Map();      // session id -> {ok, at}: does its transcript exist (Resume session)
    this.pasting = 0;              // when a paste into a prompt started (stage): one at a time
    this.staged = null;            // the last staging: {terminal, what, where, lead} (a dialog closed mid-paste says it)
    this.flash = "";
    this.rev = 0;                  // bumped when the shown store changes (reload, local act, demo act)
    this.revAt = 0;
    this.rcx = null;               // the cx of the copy's last render (transcriptOk)
    this.inApp = false;            // running in the app (not `herdr-app check`)
    this.unwritten = new Map();    // evId -> {type, payload}: posted, its spool write not resolved yet
    this.cfgJobs = [];             // config.json changes waiting to be written (saveConfig), in order
    this.cfgBusy = false;          // a task is writing them (cfgIdle resolves when it is done)
    this.cfgIdle = null;
    this.cfgGen = 0;               // bumped by every queued change: a read of config.json older than one is dropped
  }

  // ── reading ──────────────────────────────────────────────────────────
  // false (nothing read, nothing shared) under `herdr-app check`: it shares the window's shared state
  // and refuses reads outside the mod's folder (config.js liveHome).
  async startReading(cx) {
    if (!(await liveHome())) return false;
    this.inApp = true;
    this.cfg = await loadConfig();
    await this.reload();
    this.watchStore(cx);
    return true;
  }

  // A fallback writer runs in this copy (the panel's, only when no host answers). A reader has none.
  fallback() { return false; }

  viewStore() {
    if (this.demo && this.demoStore) return this.demoStore;
    return this.live;
  }

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

  // The shown store changed: the panel's next render compares item classes (observe).
  bump() { this.rev++; this.revAt = Date.now(); }

  // Acts and drafts this copy posted that store.json does not show yet, applied on top.
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
      else if (a.action === "clear_questions") { const x = this.live.d.sessions[a.sid]; if (x) this.live.on_clear_questions({}, x, a.at); }
      else if (PIN_ACTS.has(a.action)) this.live[`on_${a.action}`]({ pin: a.pin, note: a.note }, a.at, {});
      else this.live.act(a.item, a.action, a.arg, a.at);
    }
    for (const [id, v] of this.drafts) {
      const it = this.live.item(id);
      if (!it) { this.drafts.delete(id); continue; }
      if (it.draft === v.text && v.sent) this.drafts.delete(id); else it.draft = v.text;
    }
    if (this.localActs.length) this.bump();
  }

  // One watchFolder on ledgr-data per copy. config.json edited by hand: the ui.* and extract.threshold
  // choices apply at once (onConfig, the copy's own reaction); store.json: read again.
  watchStore(cx) {
    if (this.watchingStore) return;
    this.watchingStore = true;
    cx.spawn(async (cx) => {
      const root = dataDir().replace(/\/+$/, "");
      try {
        for (;;) {
          const paths = await watchFolder(root);
          const all = paths.some((p) => String(p).replace(/\/+$/, "") === root);
          if (all || paths.some((p) => String(p).split("/").pop() === "config.json")) await this.configChanged(cx);
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

  // config.json changed on disk (watchStore): the copy's cfg becomes the file's, unless this copy's own
  // changes are queued or being written (saveConfig sets cfg from the file once its queue is empty) or one
  // was queued while the file was read (the click's value shown ahead stays, and the next click starts
  // from it). true: cfg is the file's now.
  async configChanged(cx) {
    if (this.cfgBusy) return false;
    const gen = this.cfgGen;
    const next = await loadConfig();
    if (this.cfgBusy || gen !== this.cfgGen) return false;
    this.cfg = next;
    this.onConfig?.(cx);
    cx.notify();
    return true;
  }

  // The 60 s backstop: one reload.
  tickRead(cx) {
    cx.spawn(async (cx) => { if (await this.reload()) cx.notify(); });
  }

  // ── acts ─────────────────────────────────────────────────────────────
  // Every act goes to the writer as a spool event (the same path as a capture). In reader mode it
  // also shows at once, until store.json carries it. The event is kept in `unwritten` until its write
  // resolves, so flushPending can write it again (the same id: the store drops a second copy).
  // after(ok, cx), when given, runs in the same task once the write resolved (ok) or failed (the status
  // line says why; the event stays in `unwritten`): the dialog closes from it (Detail.md 2.5).
  post(type, payload, local, cx, after = null) {
    const evId = randomUUID(), at = Date.now();
    if (local && !this.fallback()) { this.localActs.push({ evId, at, ...local }); this.overlayLocal(); }
    const body = { id: evId, terminal: null, ...payload };
    this.unwritten.set(evId, { type, payload: body });
    cx.spawn(async (cx) => {
      let ok = false;
      try { await writeEvent(type, body); this.unwritten.delete(evId); ok = true; }
      catch (e) { this.flash = `Not sent to the ledgr writer: ${String(e?.message ?? e)}`; }
      after?.(ok, cx);
      cx.notify();
    });
    cx.notify();
    return evId;
  }

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
    if (had !== Boolean(squash(text))) cx.notify();   // the Paste answer(s) buttons follow it
    if (this.demo) return;
    const d = { text, sent: false, seq: (this.drafts.get(id)?.seq ?? 0) + 1 };
    this.drafts.set(id, d);
    const seq = d.seq;
    cx.timer.after(800, (cx) => {
      const cur = this.drafts.get(id);
      if (!cur || cur.seq !== seq || cur.sent) return;
      cur.sent = true;
      this.post("act", { session_id: it.anchor?.sessionId, item: id, action: "draft", arg: cur.text }, null, cx);
    });
  }

  // One ask's draft posted now, when it still waits for its 800 ms (the dialog moving to another item,
  // 2026-11-11): typeDraft's timer then sees another seq and posts nothing. true when one was posted.
  sendDraft(id, cx) {
    const d = this.drafts.get(id);
    if (this.demo || !d || d.sent) return false;
    const it = this.viewStore().item(id);
    if (!it) return false;
    d.sent = true;
    d.seq = (d.seq ?? 0) + 1;
    this.post("act", { session_id: it.anchor?.sessionId, item: id, action: "draft", arg: d.text }, null, cx);
    return true;
  }

  // Everything this copy posted that is not written yet, written now and awaited: the drafts still
  // inside their 800 ms, then every event in `unwritten` (again with its own id). For a closing copy
  // (its tasks are cancelled 250 ms after close), so nothing typed or clicked is lost.
  async flushPending() {
    if (this.demo) return;
    for (const [id, d] of this.drafts) {
      if (d.sent) continue;
      d.sent = true;
      d.seq = (d.seq ?? 0) + 1;     // typeDraft's timer sees another seq and posts nothing
      const it = this.viewStore().item(id);
      if (!it) continue;
      const evId = randomUUID();
      this.unwritten.set(evId, { type: "act", payload: { id: evId, terminal: null, session_id: it.anchor?.sessionId, item: id, action: "draft", arg: d.text } });
    }
    for (const [evId, e] of [...this.unwritten]) {
      try { await writeEvent(e.type, e.payload); this.unwritten.delete(evId); } catch { /* kept: nothing more to do while closing */ }
    }
  }

  // One change to ledgr-data/config.json (editConfig, the compare-and-swap above). Changes queue and are
  // written one after another in one task, each reading the file anew, so quick clicks never collide
  // with each other; the watcher leaves cfg alone meanwhile (configChanged). The flash says `ok`, or
  // `fail: why`; a failed write reads the file again (a stale one says so: CONFIG_STALE). Once the queue
  // is empty the copy's cfg is the file's (a caller may set
  // it ahead, as the clicks do, so the next click starts from it); its onConfig hook runs after each
  // write. after(written, cx), when given, last.
  saveConfig(edit, ok, fail, cx, after = null) {
    this.cfgJobs.push({ edit, ok, fail, after });
    this.cfgGen++;
    cx.notify();
    if (this.cfgBusy) return;
    this.cfgBusy = true;
    this.cfgIdle = new Promise((r) => { this.cfgDone = r; });
    cx.spawn(async (cx) => {
      try {
        while (this.cfgJobs.length) {
          const j = this.cfgJobs.shift();
          let written = false;
          try {
            const next = await editConfig(j.edit);
            written = true;
            this.flash = j.ok;
            if (!this.cfgJobs.length) this.cfg = next;
          } catch (e) {
            this.flash = `${j.fail}: ${String(e?.message ?? e)}`;
            this.cfg = await loadConfig();
          }
          this.onConfig?.(cx);
          j.after?.(written, cx);
          cx.notify();
        }
      } finally { this.cfgBusy = false; this.cfgDone?.(); }
    });
  }

  // Resolves once every queued config.json change is written (a closing copy awaits it: its tasks run
  // until close() resolves, at most 250 ms).
  async settleConfig() {
    if (this.cfgBusy && this.cfgIdle) await this.cfgIdle;
  }

  // An ask's answer is its draft: typed, or the label of the option clicked.
  answerOf(it) { return squash(it?.draft); }

  // ui.pasteIntoPrompt (default on): the paste actions paste into the prompt once the focus is
  // confirmed; off, they are clipboard plus focus as before.
  pasteOn() { return this.cfg.ui?.pasteIntoPrompt !== false; }

  demoHow(lead) {
    return this.pasteOn() ? `in a session it would be pasted into the prompt, not sent, and you would add a word of your own such as “${lead}”, then Enter`
      : `in a session you would type “${lead}”, then ⌘V, Enter`;
  }

  // ── staging (the one door) ───────────────────────────────────────────
  // The answer sheet, one answer, the pins message and the confluence: nav.js stageMessage (the
  // clipboard, the pane focused, `terminal.paste` once Herdr reports that terminal focused; never
  // Enter, never another terminal; a second click while a paste is pending stages nothing). The flash
  // says what happened (words.js stagedWords; w: {what, where, lead, word, tail}); once the result is
  // known, the copy's afterStage(r, text, terminal, cx) hook runs (the dialog closes on it). A staging
  // that went ahead is kept in `staged` (its terminal and words) for a copy closed mid-paste.
  stage(msg, terminal, cx, w) {
    const ok = stageMessage(this, msg, terminal, cx, { ...w, paste: this.pasteOn(), say: (text, r, cx) => { this.flash = text; if (r) this.afterStage?.(r, text, terminal, cx); cx.notify(); } });
    if (ok) this.staged = { terminal: terminal ?? null, what: w?.what ?? "The message", where: w?.where ?? P(terminal, "the pane"), lead: w?.lead ?? "" };
    return ok;
  }

  // A paste into a prompt is still waiting for the focus (stageMessage's gate, at most PASTE.waitMs + 400).
  pastePending() { return Boolean(this.pasting) && Date.now() - this.pasting < PASTE.waitMs + 400; }

  // The answer sheet of a turn: every open ask of it (those below the threshold too) with an answer. own:
  // the id of one more ask of that turn to carry whatever its status (deferred, answered; never closed),
  // the one whose answer box ⌘Enter was pressed in (Detail pasteSheet).
  copyAnswers(s, turn, cx, own = null) {
    const st = this.viewStore();
    const group = st.itemsOf(s.sessionId).filter((it) => isAgentAsk(it) && it.anchor?.turn === turn && (it.status === "open" || (it.id === own && !isClosed(it))))
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    this.stageAnswers(s, turn, group, cx);
  }

  // One ask's answer as a sheet of its own: the same marker line, so the same landing.
  copyAnswer(it, s, cx) { this.stageAnswers(s, it.anchor?.turn, [it], cx); }

  // The answer sheet into the session's prompt (this.stage), and the lead-in hint (as for a confluence).
  stageAnswers(s, turn, group, cx) {
    const items = group.filter((it) => this.answerOf(it));
    const msg = answersSheet(s.sessionId, turn, items);
    if (!msg) { this.flash = group.length === 1 ? `${H(group[0])} has no answer yet: type one or pick an option.` : `No answers typed or picked for turn ${turn}.`; cx.notify(); return; }
    const hs = items.map((it) => it.handle), ws = items.map(H);   // hs: the lead-in's short forms
    const what = ws.length === 1 ? `Answer for ${ws[0]}` : `${ws.length} answers (${ws.join(", ")})`;
    // Over the most one message carries (confluence.js sheetOverCap, the pins message's cap): the hook
    // reads a prompt's first MAX_SCAN characters only, and handles past it would never land.
    const over = sheetOverCap(msg.length);
    if (over) { this.flash = `${what} not staged: ${over}.`; cx.notify(); return; }
    const lead = answersLeadIn(hs);
    if (this.demo) { cx.write_to_clipboard(promptText(msg)); this.flash = `(demo) ${what} copied to the clipboard; ${this.demoHow(lead)}.`; cx.notify(); return; }
    this.stage(msg, s.terminal, cx, { what, where: P(s.terminal, "the pane"), lead, word: this.trunkWord(s),
      tail: `${ws.length === 1 ? `${ws[0]} shows` : "They show"} answered once that prompt is sent.` });
  }

  // ── sessions, branches and the trunk, from Herdr ─────────────────────
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

  parentLive(s) {
    const t = s?.terminal;
    if (!t) return false;
    const k = terminals().find((x) => x.address === t);
    return Boolean(k && (!k.state || k.state === "live"));
  }

  // `claude --resume --fork-session` is Claude Code's; other agents have no fork.
  branchable(s) { return Boolean(s) && (s.agent === "claude-code" || s.agent === "claude") && !String(s.sessionId).startsWith("herdr:"); }

  branchLive(b) {
    if (this.demo) return b.demoStatus ?? b.status;
    return liveStatus(b, agents(), terminals());
  }

  // Conclude is live on a started branch whose question is not closed, until the confluence lands
  // (the panel finds a branch by it for ledgr.conclude; the dialog offers Conclude… by it).
  canConclude(st, br) {
    if (!br || ["refused", "failed", "launching", "rejoined"].includes(br.status)) return false;
    const it = st.item(br.requestId);
    return Boolean(it && !isClosed(it));
  }

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
  // again after 30 s at the next render; the answer arrives with one render. Called while rendering
  // (which has no cx of its own): it uses the render's, kept in this.rcx.
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

  // The text of a session's turn (ledgr-data/turns/<sid>/<turn>.md, or the turn's textPath), read once.
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

  // pin_note, pin_archive, pin_restore, pin_delete: a spool event (session_id: the pin's session), shown
  // at once (overlayLocal); the demo applies it to its own store.
  pinAct(type, p, extra, cx) {
    if (this.demo) { this.demoStore[`on_${type}`]({ pin: p.id, ...extra }, Date.now(), {}); this.bump(); cx.notify(); return; }
    this.post(type, { session_id: p.sessionId, pin: p.id, ...extra }, { action: type, pin: p.id, ...extra }, cx);
  }

  // One `resume` spool event; the writer runs claude --resume in a new pane (writer.js resumeSession).
  resume(s, cx) {
    if (this.demo) { this.flash = "(demo) Would start claude --resume in a new pane."; cx.notify(); return; }
    this.post("resume", { session_id: s.sessionId }, { action: "resume", sid: s.sessionId }, cx);
    this.flash = `Resuming ${sessionWords(s)}: claude --resume in a new pane beside the focused one. Its rows follow the new pane once Claude starts there.`;
    cx.notify();
  }
}
