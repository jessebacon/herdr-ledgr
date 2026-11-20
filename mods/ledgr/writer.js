// ledgr writer: the single writer of ledgr-data/store.json (spec 3.3, coordinator decision
// 2026-11-05 option c). It runs in an always-shown host copy: the ledgr host block (props
// {view: "host"}, role "host"), or any other mod that carries a copy of the engine (an overlay's
// tab bar, role = its name). The ledgr panel runs one only as a fallback (role "panel") when no
// host writer answers its ping.
//   - claims shared("ledgr.writer") = {id, by, at, fault?, failed?, pass?, done?, stall?}; whoever holds
//     the key writes, nobody else. The holder renews it every tick (a heartbeat: an `at` older than two
//     minutes means no writer is running) and whenever its health changes: `fault` while store.json cannot
//     be written or the writer is stuck, `failed` = the events kept in spool/failed (the panel's status
//     line says both, words.js); `pass` = {at, step, since}, the pass (or start) running at that beat and
//     the step it waits in, `done` = when the last pass ended, `stall` = the watchdog's last finding.
//     Hosts elect one writer among themselves: a host that starts later takes over; a host that
//     lost the role takes it back (re-reading store.json first) when the claim is empty or held by
//     a panel fallback; a host that goes away releases it (release(), from the View's close);
//   - the watchdog (2026-11-19: a pass hung after saving store.json and held the spool for hours while
//     the tick kept the claim fresh): a pass or a start that has waited in one step longer than
//     PASS_STUCK_MS, or a spool event older than that while no pass runs, is stuck. The holder says so in
//     its claim and writer.log, gives the pass up (a new generation: nothing the old one awaits can apply,
//     save or unlink anything when it settles, if ever) and starts again from store.json on disk
//     (unstick, regain); after MAX_UNSTICKS restarts with no pass finished it backs off, keeping the claim
//     and saying so, and tries again at growing intervals (backOff, cooling). Another host takes over a
//     claim that has not moved for TAKEOVER_STUCK_MS (probe), and so does a shown panel (writerWanted).
//     Every await of a save is limited (SAVE_TIMEOUT_MS, spool.js within): one with no answer is a fault;
//   - loads store.json before reading or unlinking any spool file;
//   - ingests ledgr-data/spool with watchFolder, writes store.json after every change and before
//     unlinking the files it applied (past Herdr's 1 MiB text-file cap through spool.js writeLarge);
//     an event whose apply throws is left out of the store and moved to spool/failed (applyBatch);
//     publishes shared("ledgr.chips"); writes snapshot.json; runs the extractor's --retry for `retry`
//     events;
//   - retention (2026-11-19, housekeep): closed items past retention_days and turn records past
//     retention.turns move out of store.json into new files under archive/<sid>/, each written once,
//     read back, and only then removed from the store; a `restore` event gets its archived record
//     before its batch applies (applyBatch);
//   - track(cx) from the host's render: interrupts and tier-3 status turns (spec 6.5, 2.9);
//   - respond(cx) from the host's render: answers a panel's shared("ledgr.ping") by re-claiming;
//   - Phase 2: launches the branches the store accepted from a panel's `branch` event
//     (launchBranch): the only process the mod starts on its own initiative.
//   - Phase 3: appends one line per landed confluence to ledgr-data/sessions/<trunk sid>/decisions.md
//     (appendDecision), and ends a rejoined branch's terminal on the panel's Close branch
//     (closeBranch: hc kill, then hc rm; the Branch record stays).
//   - Resume session: for a session whose terminal is gone, `claude --resume <sid>` in a new pane
//     (resumeSession, branch.js resumeArgs); the session's SessionStart hook re-maps it.
//   - Pins: re-anchors a pin taken from the screen once its turn ends (reanchor); everything else a
//     pin event does is the store's (store.js on_pin and the pin_* events).
//   - re-reads ledgr-data/config.json whenever it changes (watchConfig): extract.threshold (which
//     asks count on the chips), spaces.disabled (no chip for a terminal in a space where ledgr is off:
//     its space as the hooks recorded it, else config.js terminalSpace) and branch.maxDepth apply
//     without a restart; an identity-map record that changes (ledgr-data/terminals/) brings its space.
//
// SOURCE OF TRUTH: mods/ledgr/{config,store,spool,writer,branch,confluence}.js (ENGINE_FILES). A
// host in another mod (an overlay's tab bar) imports byte-identical copies from its own
// mods/<name>/ledgr/, because Herdr refuses imports that resolve outside a mod's own folder
// (symlinks included); install.sh writes them. The panel compares every such set and says so when
// one differs.
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { shared, setShared, readTextFile, writeTextFile, watchFolder, agents, terminals, panes, run, exec, hc, openOverlay, appHome, home } from "herdr";
import { DEFAULTS, LIMITS, loadConfig, dataDir, spoolDir, turnPath, storePath, binDir, agentLabel, panelPlace, panelShown, showPanel, liveHome, disabledSpaces, terminalSpace, textScaleOf, retentionDaysOf } from "./config.js";
import { Store, isHuman, thresholdOf } from "./store.js";
import { SpoolReader, readMap, writeAtomic, writeAtomicWith, writeNew, overCap, byteLength, archiveDir, archiveFileOf, archivedRecord, countFailed, listSpool, within, spanWords } from "./spool.js";
import { maxDepthOf, hcRunArgs, claudeArgv, resumeArgs, transcriptPathOf } from "./branch.js";

export const ENGINE_FILES = ["config.js", "store.js", "spool.js", "writer.js", "branch.js", "confluence.js"];
const DAY = 86400e3;
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const plain = (s) => squash(String(s ?? "").replace(/[`*_#>]+/g, ""));
const base = (p) => String(p).split("/").pop();
const iso = (ms) => (ms ? new Date(ms).toISOString() : "-");

// A pass (or a start) that has waited in one step longer than this is stuck (2026-11-19). Each step is
// one await that takes milliseconds when the host answers; every await of a save is limited to
// SAVE_TIMEOUT_MS and an exec to Herdr's 30 s by default, so 90 s is three times the longest limited wait
// and still under the two minutes after which a claim nobody renews counts as abandoned. The holder's
// watchdog runs on its 60 s tick, so a stuck pass is seen 90 to 150 s after its step began.
export const PASS_STUCK_MS = 90000;
// Another host takes over a fresh claim whose pass has not moved for this long: the holder's own
// watchdog (above) would have restarted it by 150 s, so it is not running that code, or it cannot.
export const TAKEOVER_STUCK_MS = 240000;
// Each await of a save that waits on the host: writeTextFile, the temporary copy, its read-back, the mv
// (also exec's own timeout), snapshot.json; and the start's reads.
export const SAVE_TIMEOUT_MS = 20000;
// Restarts in a row with no pass finished between them; past this, the copy waits before the next one
// (backOff): BACKOFF_MS after the first wait, doubling to BACKOFF_MAX_MS. It keeps the role and says so
// in its claim meanwhile, because with one host nobody else would take it, and a stuck claim is one
// another host or the panel takes over (claimStuck).
export const MAX_UNSTICKS = 3;
export const BACKOFF_MS = 300000;
export const BACKOFF_MAX_MS = 1800000;
// How often a shown panel looks again for a writer when the claim is gone or stuck (panel.js render).
export const WRITER_CHECK_MS = 15000;
// ledgr-data/log/writer.log keeps its last this many bytes.
export const WRITER_LOG_MAX = 65536;
// The temporary copies writeLarge makes beside store.json and snapshot.json (and beside the one-time
// store.pre-retention-<ms>.json, whose move, should it run late, would only fail).
const LARGE_TMP = /^\.(store|snapshot)(\.pre-retention-\d+)?\.json\.large-/;

// Retention (2026-11-19). store.json had reached 1.76 MB, so every save went through writeLarge, the path
// the writer stalled on. Housekeeping (housekeep) runs once a day, at the first start after the upgrade
// (d.retention v 1 missing), and within the hour once the saved store passes HOUSE_SIZE bytes and has grown
// by HOUSE_GROWTH since the last run ended. No archive file passes ARCHIVE_FILE_MAX bytes, half of Herdr's
// text-file cap, so each is written with writeTextFile (create-only) and read back with readTextFile.
// HOUSE_GROWTH: on the live data the store stays over HOUSE_SIZE after its trim (open items are never
// archived), so the size alone would start a run every hour, each writing small files for every session that
// had a turn; 64 KiB is about fifteen hours of the store's growth (some 100 KB a day), a quarter of the room
// between HOUSE_SIZE and the 1 MiB cap, so a busy day still gets a run or two before the cap and an idle
// one none but the daily run.
export const HOUSE_SIZE = 768 * 1024;
export const HOUSE_GROWTH = 64 * 1024;
export const ARCHIVE_FILE_MAX = 512 * 1024;
const HOUR = 3600e3;

// retention.turns (config.json: the turn records kept per session), checked: a whole number from
// LIMITS.turnHeads (the newest records keep their textHead; fewer would cut the turn a live session is in)
// to 60 (store.js turnRec's cap); not a number, the default (config.js DEFAULTS). retention_days goes to
// store.js archivable, which reads it as config.js retentionDays does (whole days, 1 to 30).
export function turnsKept(cfg) {
  const v = cfg?.retention?.turns;
  const n = v === null || v === undefined || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v)) ? null : Number(v);
  return n === null ? Number(DEFAULTS.retention?.turns) || 12 : Math.min(60, Math.max(Number(LIMITS.turnHeads) || 2, Math.floor(n)));
}

// Lines into archive files: chunks whose text (the lines, each ending in a newline) stays within max bytes.
// {chunks: [{idx, text}], over: [idx]}: idx the lines' indexes; a line alone longer than max is in `over`
// (written nowhere: what it stands for stays in the store).
export function archiveChunks(lines, max = ARCHIVE_FILE_MAX) {
  const chunks = [], over = [];
  let cur = [], size = 0;
  lines.forEach((line, i) => {
    const b = byteLength(line) + 1;
    if (b > max) { over.push(i); return; }
    if (cur.length && size + b > max) { chunks.push(cur); cur = []; size = 0; }
    cur.push(i);
    size += b;
  });
  if (cur.length) chunks.push(cur);
  return { chunks: chunks.map((idx) => ({ idx, text: `${idx.map((i) => lines[i]).join("\n")}\n` })), over };
}
const rand6 = () => Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");

// Replaces path with text past writeTextFile's 1 MiB (spool.js TEXT_FILE_MAX): fs.writeFile to a
// dotfile beside it, read back and compared (a short write never replaces the file), then `mv -f` over
// it (one rename, so a reader sees the old file or the new one, never half of one). The mod has no
// rename of its own; the mv is here, in the writer, because a reading copy starts no process
// (tests/test_no_keystrokes.py rule 13). Resolves null, or the error's text (the temporary file is
// removed and path is left as it was). Each step waits at most `ms` (within, with `cx`'s timer; the mv
// also with exec's own timeout), so a host that never answers is an error, not a hang; `ok()` is asked
// right before the mv, the one step that touches path, so a save its writer gave up never moves in;
// `step(s)` names each wait (the writer's watchdog and writer.log).
export async function writeLarge(path, text, { cx = null, ms = SAVE_TIMEOUT_MS, ok = null, step = null } = {}) {
  const cut = String(path).lastIndexOf("/");
  const rand = Math.floor(Math.random() * 0x100000).toString(16).padStart(5, "0");
  const tmp = `${path.slice(0, cut)}/.${path.slice(cut + 1)}.large-${Date.now()}-${rand}`;
  const mark = (s) => { try { step?.(s); } catch { /* diagnostics only */ } };
  try {
    mark("temporary copy");
    await within(cx, ms, fs.writeFile(tmp, text), "writing the temporary copy");
    mark("read back");
    const back = await within(cx, ms, fs.readFile(tmp, "utf8"), "reading the temporary copy back");
    if (back !== text) throw new Error(`the temporary copy read back ${back.length} of ${text.length} characters`);
    if (ok && !ok()) throw new Error("given up before the move (a newer writer pass owns the file)");
    mark("mv");
    const r = await within(cx, Math.round(ms * 1.1), exec("/bin/mv", ["-f", tmp, path], { timeout: ms }), "mv");   // exec's own limit first
    if (r?.code !== 0) throw new Error(`mv exited ${r?.code}${r?.stderr ? `: ${String(r.stderr).trim().slice(0, 160)}` : ""}`);
    return null;
  } catch (e) {
    await within(cx, ms, fs.unlink(tmp), "removing the temporary copy").catch(() => {});
    return String(e?.message ?? e);
  }
}

// A file the writer derives (snapshot.json) replaced whole, whatever its size: writeAtomic under the
// cap, else (over it, or an old copy over it that writeTextFile cannot compare) writeLarge. opts as
// writeLarge's; the compare-and-swap path is limited to opts.ms as a whole.
export async function writeWhole(path, text, opts = {}) {
  const ms = opts.ms ?? SAVE_TIMEOUT_MS;
  if (!overCap(text) && (await within(opts.cx, ms, writeAtomic(path, text), `writing ${base(path)}`).catch(() => false))) return true;
  if (opts.ok && !opts.ok()) return false;
  return (await writeLarge(path, text, opts)) === null;
}

export function writerClaim() {
  const w = shared("ledgr.writer");
  return w && typeof w === "object" && w.id ? w : null;
}

// How long a claim's holder has not moved, as its claim says (ms; 0 when it is moving or says nothing):
// its pass or start in one step since pass.since; or, with neither running (backing off, or a restart that
// never began), a stall it has not come back from. A restart in progress has a pass of its own, so it is
// moving. A claim is renewed every 60 s, so this can be up to a minute too long; TAKEOVER_STUCK_MS allows
// for that.
export function claimStuck(w, now = Date.now()) {
  if (!w || typeof w !== "object") return 0;
  const p = w.pass && Number(w.pass.since) ? now - Number(w.pass.since) : 0;
  const st = !w.pass && w.stall && typeof w.stall === "object" && !w.stall.ok && w.stall.kind !== "spool"
    ? now - Number(w.stall.at || now) + Number(w.stall.ms || 0) : 0;
  return Math.max(0, p, st);
}

// The watchdog's finding as the claim's `fault` says it (words.js says it on the status line).
export function stallText(st, now = Date.now()) {
  if (!st) return null;
  if (st.kind === "spool") return `${st.name ?? "a spool event"} has waited ${spanWords(st.ms)} in the spool and is not applied (log/writer.log)`;
  if (st.retryAt) return `stuck ${spanWords(st.ms)} in ${st.step}; ${st.tries} restarts in a row finished no pass, the next in ${spanWords(Number(st.retryAt) - now)} (log/writer.log)`;
  return `stuck ${spanWords(st.ms)} in ${st.step}; restarting the writer (log/writer.log)`;
}

// The panel's two writer questions (panel.js, 2026-11-19), pure. fallbackDead: its fallback Writer is
// there, not retired, and neither writing, starting nor waiting out a back-off (a start that threw or
// that its watchdog gave up while another copy held the role): checkWriter replaces it. writerWanted: no
// claim holds the role, or its holder (not the panel's own fallback, whose watchdog the panel ticks) has
// not moved for TAKEOVER_STUCK_MS: the panel looks for a writer (checkWriter), at most every WRITER_CHECK_MS.
export function fallbackDead(fb, now = Date.now()) {
  return Boolean(fb) && !fb.retired && !fb.started && !fb.starting && !(Number(fb.coolUntil) > now);
}
export function writerWanted(w, fb, now = Date.now()) {
  if (fb && !fb.retired && (fb.starting || (w && w.id === fb.id))) return false;
  return !w || claimStuck(w, now) > TAKEOVER_STUCK_MS;
}

export class Writer {
  constructor(role) {
    this.role = role;
    this.id = randomUUID();
    this.cfg = DEFAULTS;
    this.live = new Store(null);
    this.storeText = null;          // store.json as last read or written (writeTextFile's expected)
    this.writeChain = Promise.resolve(true);
    this.reader = new SpoolReader((batch, cx, pass) => this.applyBatch(batch, cx, pass), () => this.beat(),
      () => this.amWriter(), () => { if (this.claimedPass) this.beat(); });
    this.started = false;
    this.retired = false;
    this.passages = new Map();
    this.lastChips = null;
    this.lastStatus = new Map();
    this.pendingStatus = [];
    this.note = null;               // last problem, for a host that shows one
    this.fault = null;              // store.json could not be written (published in the claim)
    this.claimAt = 0;
    this.claimedPass = false;       // the last claim carried a pass: renew it when that pass ends
    // The watchdog (2026-11-19). gen: the generation; a pass, a save or a loop of an older one changes
    // nothing more (current()). starting / startAt / startStep / startSince: a start running, the step it
    // waits in. saveStep: {step, since}, the await the save chain waits in (null when idle). stall: the last
    // finding, {at, step, ms, n, kind: "pass" | "start" | "house" | "spool", ok, back?, name?, retryAt?, tries?}.
    // coolUntil: backing off until then (backOff), no restart before it.
    this.gen = 0;
    this.coolUntil = 0;
    this.cx = null;                 // the latest AsyncContext (start, tick, a pass): the limits' timer
    this.starting = false;
    this.startAt = 0;
    this.startStep = null;
    this.startSince = 0;
    this.saveStep = null;
    this.saveTimeout = SAVE_TIMEOUT_MS;
    this.stall = null;
    this.stalls = 0;
    this.unstickRun = 0;            // restarts since a pass last finished
    this.lastUnstick = 0;
    this.waitedOn = null;           // the spool event a restart was already tried for
    this.logChain = Promise.resolve();
    // Housekeeping (retention, 2026-11-19). house: the run of generation `gen` going, {gen, at, step,
    // since, why} (progress() shows it, so the watchdog sees it move file by file), else null. houseTry: when
    // this copy last began one (none again within the hour: a run the watchdog gave up is not begun again by
    // the restart). houseMs: the last run's <ms> in its file names (each run's larger). houseRun: the last
    // run's promise (tests). preRetention: the one-time copy this copy wrote (not written twice).
    this.house = null;
    this.houseTry = 0;
    this.houseEnd = null;           // store.json's bytes when the last run ended (houseDue's growth; in memory)
    this.houseMs = 0;
    this.houseRun = null;
    this.preRetention = null;
  }

  claim() {
    this.claimAt = Date.now();
    const w = { id: this.id, by: this.role, at: this.claimAt };
    const stuck = this.stall && !this.stall.ok ? stallText(this.stall) : null;
    if (stuck || this.fault) w.fault = stuck ?? this.fault;
    if (this.reader?.failed > 0) w.failed = this.reader.failed;
    const p = this.progress();
    if (p) w.pass = p;
    this.claimedPass = Boolean(p);
    if (this.reader?.done) w.done = this.reader.done;
    if (this.stall) w.stall = { ...this.stall };
    setShared("ledgr.writer", w);
  }

  // The holder's claim again, with its health: every tick, and when the health changes.
  beat() { if (this.amWriter()) this.claim(); }

  setFault(fault) {
    if (fault === this.fault) return;
    if (fault || this.fault) this.log(fault ? `fault: ${fault}` : `fault cleared (was: ${this.fault})`);
    this.fault = fault;
    if (fault) this.note = fault;
    this.beat();
  }

  holds() { return !this.retired && writerClaim()?.id === this.id; }
  amWriter() { return this.started && this.holds(); }
  retire() { this.retired = true; }

  // The pass, or the save of generation gen, may go on: still this copy's latest, and still the writer.
  current(gen) { return gen === this.gen && this.amWriter(); }

  // An await of the save chain or of a start, limited to saveTimeout (a timer of the latest cx).
  bounded(p, what) { return within(this.cx, this.saveTimeout, p, what); }

  // What this copy is waiting in now: the running pass, else a start, else a housekeeping run of this
  // generation. {at, step, since}, or null.
  progress() {
    const p = this.reader?.pass;
    if (p) return { at: p.at, step: p.step, since: p.since };
    if (this.starting) return { at: this.startAt, step: `start: ${this.startStep ?? "?"}`, since: this.startSince || this.startAt };
    const h = this.house;
    if (h && h.gen === this.gen) return { at: h.at, step: `housekeeping: ${h.step}`, since: h.since };
    return null;
  }

  // The housekeeping run of generation gen is about to wait in step s.
  houseStep(gen, s) {
    const h = this.house;
    if (h && h.gen === gen) { h.step = s; h.since = Date.now(); }
  }

  // A start is about to wait in step s.
  mark(s) { this.startStep = s; this.startSince = Date.now(); }

  // The save chain is about to wait in step s; a pass waiting on a save moves to the same step (a save
  // that goes from step to step is moving).
  saving(s) {
    this.saveStep = { step: s, since: Date.now() };
    const p = this.reader.pass;
    if (p && String(p.step).startsWith("save")) this.reader.step(p, `save: ${s}`);
    else if (!p && this.starting && String(this.startStep).startsWith("save")) this.mark(`save: ${s}`);
    const h = this.house;
    if (h && h.gen === this.gen && String(h.step).startsWith("save")) this.houseStep(h.gen, `save: ${s}`);
  }

  // A new generation: the running pass is given up (spool.js abandon), the save chain starts afresh (a
  // save of the old one checks its generation before every write and gives up), and the spool watch is
  // started again by whoever starts next (the old loop ends at its next wake). Returns the generation.
  abandon() {
    this.gen += 1;
    this.reader.abandon();
    this.writeChain = Promise.resolve(true);
    this.saveStep = null;
    this.watching = false;
    this.watchingConfig = false;
    this.house = null;               // a housekeeping run of the old generation writes and removes nothing more
    return this.gen;
  }

  // One line in ledgr-data/log/writer.log, the file the next stall is read from (2026-11-19): this copy
  // taking the role, finding itself stuck, restarting, giving the role up or taking it over, and store.json
  // starting or stopping to be written. Kept to its last WRITER_LOG_MAX bytes (hook.log and mcp.log move to
  // .1 past 1 MB; the mod has no append, so this one is rewritten whole and stays small). Never awaited by
  // the writer's own work; its writes are limited, so one that hangs only delays the lines after it.
  log(line) {
    const at = Date.now();
    const text = `${at} ${iso(at)} ${this.role} ${this.id.slice(0, 8)} ${squash(line).slice(0, 700)}\n`;
    const path = `${dataDir()}/log/writer.log`;
    const write = async () => {
      await this.bounded(fs.mkdir(`${dataDir()}/log`, { recursive: true }), "writer.log").catch(() => {});
      for (let i = 0; i < 2; i++) {
        let cur;
        try { cur = await this.bounded(readTextFile(path), "writer.log"); } catch { return; }
        let next = (cur ?? "") + text;
        if (next.length > WRITER_LOG_MAX) next = next.slice(next.indexOf("\n", next.length - WRITER_LOG_MAX) + 1);
        try { await this.bounded(writeTextFile(path, next, cur ?? null), "writer.log"); return; }
        catch { /* written meanwhile (another copy): once more */ }
      }
    };
    this.logChain = this.logChain.then(write, write).catch(() => {});
    return this.logChain;
  }

  // This copy is going away (the View's close): give the role up so another host takes it at once.
  release() {
    const held = this.holds();
    this.retired = true;
    if (held) setShared("ledgr.writer", null);
  }

  // Taking the role: claim, then load store.json before any spool file is read or unlinked.
  // Missing: start empty. Unreadable: keep a copy aside, start empty. Until loaded, amWriter()
  // is false, so the reader leaves every spool file where it is. Every start is a new generation
  // (abandon): a pass or a save of this copy's earlier tenure, or a stuck one, changes nothing more, and
  // the store is the one on disk, whose `ingested` ids keep an event that pass applied from applying
  // twice. A temporary copy an earlier save left beside store.json is removed before the read, so its mv,
  // if it has not run, fails instead of replacing the file read here; a sweep that cannot prove none is
  // left fails the start (sweep), and the watchdog tries again. Each step is limited and named (mark): a
  // start that waits too long in one is the watchdog's, like a stuck pass. After each await nothing is
  // written to this.live or this.cfg unless this start is still the latest (live()).
  async start(cx) {
    if (!this.booted && !(await liveHome())) { this.retired = true; this.note = "not in the app (herdr-app check): no writer"; return; }
    this.booted = true;
    const gen = this.abandon();
    const live = () => gen === this.gen && !this.retired;
    this.cx = cx;
    this.starting = true;
    this.startAt = Date.now();
    this.mark("claim");
    try {
      const before = writerClaim();
      const why = !before ? "no claim" : before.id === this.id ? (this.stall && !this.stall.ok ? "restart" : "again")
        : `from ${before.by}${claimStuck(before) > PASS_STUCK_MS ? " (stuck)" : ""}`;
      this.claim();
      // Taking over from a live holder: let a store.json write it already started land first.
      if (before && before.id !== this.id) await cx.sleep(500);
      // Lost the race meanwhile: the holder's temporary copies are its own (a sweep here would fail its mv).
      if (!live() || !this.holds()) return;
      this.mark("temporary files");
      await this.sweep();
      if (!live()) return;
      this.mark("config.json");
      const cfg = await this.bounded(loadConfig(), "reading config.json").catch(() => this.cfg);
      if (!live()) return;
      this.cfg = cfg;
      this.mark("store.json");
      let text = null;
      try { text = await this.bounded(fs.readFile(storePath(), "utf8"), "reading store.json"); }
      catch (e) { if (e?.timedOut) throw e; }   // missing (or unreadable: not replaced, writeStoreText)
      if (!live()) return;
      try { this.live = Store.fromText(text); this.storeText = text; }
      catch (e) {
        this.live = new Store(null);
        this.storeText = text;
        const aside = `${dataDir()}/store.corrupt-${Date.now()}.json`;
        await this.bounded(writeLarge(aside, text, { cx, ms: this.saveTimeout }), "keeping store.json aside").catch(() => {});
        this.note = `store.json could not be read (${String(e?.message ?? e)}); kept as ${aside.split("/").pop()}, started empty.`;
      }
      if (!live() || !this.holds()) return;            // someone else claimed while we loaded
      this.started = true;
      this.applyConfig(this.cfg);
      // A launch cut short by a restart: say so (a late branch_started still marks it running).
      for (const b of Object.values(this.live.d.branches)) {
        if (b.status === "launching" && Date.now() - (b.createdAt ?? 0) > 60000) this.live.branchLaunched(b.id, { error: "the writer restarted before the launch finished" });
      }
      this.mark("identity map");
      const recs = await this.bounded(readMap(), "reading the identity map").catch(() => []);
      if (!live()) return;
      for (const rec of recs) this.live.applyMap(rec);
      this.mark("save");
      await this.saveStore();
      if (!live()) return;
      this.mark("drain");
      const applied = this.reader.applied;
      await this.reader.drain(cx);
      if (!live()) return;
      this.mark("spool/failed");
      this.reader.failed = await this.bounded(countFailed(), "counting spool/failed").catch(() => this.reader.failed);
      if (!live()) return;
      // Back from a stuck pass or start: the claim says so (words.js, for STALL_SHOWN_MS), the fault goes.
      const st = this.stall, back = Boolean(st && !st.ok && st.kind !== "spool");
      if (back) { st.ok = true; st.back = Date.now(); }
      this.log(`started (${why}), generation ${gen}: store.json ${text === null ? "missing" : `${text.length} characters`}, `
        + `${this.reader.applied - applied} spool file(s) taken in${back ? `; back after ${spanWords(st.ms)} stuck in ${st.step}` : ""}`);
      this.beat();
      this.publish();
      this.scheduleSnapshot(cx);
      if (this.reader.missing) this.waitForSpool(cx); else this.watch(cx);
      this.watchConfig(cx);
      // Its own task, not a step of the start: a start answers no ping while it runs (respond), and a
      // first run after the upgrade writes dozens of files.
      this.houseKick(cx);
      cx.notify();
    } finally {
      if (gen === this.gen) {
        this.starting = false;               // startStep stays: the step a start that threw ended in
        if (this.claimedPass) this.beat();   // the claim no longer says a start runs
      }
    }
  }

  // The temporary copies an earlier save left beside store.json and snapshot.json (writeLarge's
  // .<name>.large-*): removed, so a move of theirs that has not run yet finds nothing to move. It throws
  // (the start fails, the watchdog tries again) unless it proves none is left: ledgr-data listed, each copy
  // unlinked (an unlink that fails is fine when the copy is gone: its mv ran, and the read sees it), and
  // ledgr-data listed again with none there. Once none is there, none can land later: a save makes its copy
  // before it asks ok(), and ok() is false for every save but the new generation's (2026-11-19 review:
  // a listing that got no answer had counted as "nothing to remove", and an old mv replaced a newer store).
  async sweep() {
    const tmps = async () => {
      let names;
      try { names = await this.bounded(fs.readdir(dataDir()), "listing ledgr-data"); }
      catch (e) {
        let gone = false;   // no ledgr-data yet (the first start): nothing to remove
        if (!e?.timedOut) { try { gone = !(await this.bounded(fs.exists(dataDir()), "ledgr-data")); } catch { gone = false; } }
        if (gone) return [];
        throw e;
      }
      return names.map(base).filter((n) => LARGE_TMP.test(n));
    };
    for (const n of await tmps()) {
      await this.bounded(fs.unlink(`${dataDir()}/${n}`), "removing a temporary copy").catch(() => {});
    }
    const left = await tmps();
    if (left.length) throw new Error(`a temporary copy could not be removed (${left.join(", ")}); its move might still replace store.json`);
  }

  // The config values the store applies itself (branch.maxDepth, extract.threshold, spaces.disabled),
  // and the ones the chips, the host and the capture box need: shared("ledgr.ui") = {animations,
  // panel, off, textScale} (a pane-header chip cannot read ledgr-data itself; `off` is spaces.disabled,
  // read by the capture box before it has read config.json; textScale is ui.textScale, checked, which the
  // chip, the host button and the box draw their text with).
  applyConfig(cfg) {
    // Retention changed (the settings row, or the installer moving the old 14 to 3): the size trigger may run
    // again without waiting for HOUSE_GROWTH (houseDue), so a shorter retention applies within the hour.
    const ret = (c) => `${retentionDaysOf(c)}|${turnsKept(c)}`;
    if (this.cfg && ret(this.cfg) !== ret(cfg)) this.houseEnd = null;
    this.cfg = cfg;
    this.live.maxDepth = maxDepthOf(cfg);
    this.live.threshold = thresholdOf(cfg);
    const off = disabledSpaces(cfg);
    this.live.spacesOff = new Set(off);
    const ui = { animations: cfg?.ui?.animations !== false, panel: panelPlace(cfg), off, textScale: textScaleOf(cfg) };
    if (this.holds() && JSON.stringify(shared("ledgr.ui") ?? null) !== JSON.stringify(ui)) setShared("ledgr.ui", ui);
  }

  // What in the config changes the chips: the threshold and the spaces where ledgr is off.
  chipKey() { return `${this.live.threshold}|${[...this.live.spacesOff].sort().join(",")}`; }

  // config.json edited (by hand, by the panel's menus, or by the hooks creating it): read it again and
  // republish the chips, so a new extract.threshold or spaces.disabled applies at once. An identity-map
  // record rewritten by the hooks (ledgr-data/terminals/<t>.json): its space (noteSpace). Wakes on
  // every change under ledgr-data/ (the watch is recursive), reads only those files. One loop per
  // generation, as the spool watch (abandon clears `watchingConfig`; an old loop ends at its next wake),
  // its reads limited; the tick reads config.json and every map record again once a minute besides.
  watchConfig(cx) {
    if (this.watchingConfig) return;
    this.watchingConfig = true;
    const gen = this.gen;
    cx.spawn(async (cx) => {
      const root = dataDir().replace(/\/+$/, "");
      const mapFile = /\/terminals\/[^/.][^/]*\.json$/;
      let quick = 0, lastAt = 0;
      try {
        while (!this.retired && gen === this.gen) {
          const paths = await watchFolder(root);
          if (gen !== this.gen) return;
          const now = Date.now();
          quick = now - lastAt < 50 ? quick + 1 : 0;
          lastAt = now;
          if (quick > 20) { quick = 0; await cx.sleep(1000); }
          if (!this.current(gen)) continue;
          const all = paths.some((p) => String(p).replace(/\/+$/, "") === root);
          const cfgHit = all || paths.some((p) => String(p).split("/").pop() === "config.json");
          const maps = all ? null : paths.map(String).filter((p) => mapFile.test(p));
          if (!cfgHit && !all && !maps.length) continue;
          let republish = false;
          if (cfgHit) {
            const before = this.chipKey();
            const cfg = await this.bounded(loadConfig(), "reading config.json").catch(() => this.cfg);
            if (!this.current(gen)) continue;
            this.applyConfig(cfg);
            if (this.chipKey() !== before) republish = true;
          }
          if ((all || maps.length) && (await this.refreshSpaces(maps, gen))) { this.commit(cx); continue; }
          if (republish) { this.publish(); cx.notify(); }
        }
      } catch (e) { if (gen === this.gen) this.note = `config watch stopped: ${String(e?.message ?? e)}`; }
      finally { if (gen === this.gen) this.watchingConfig = false; }
    });
  }

  // The space of each changed identity-map record (null: all of them). True when the store changed (and
  // generation gen is still the writer's; its reads are limited, nothing is noted after one for an older).
  async refreshSpaces(paths, gen = this.gen) {
    let recs;
    if (!paths) recs = await this.bounded(readMap(), "reading the identity map").catch(() => []);
    else {
      recs = [];
      for (const p of paths) {
        const text = await this.bounded(readTextFile(p), "reading the identity map").catch(() => null);
        try { const r = JSON.parse(text); if (r?.terminal && r?.session_id) recs.push(r); } catch { /* in progress */ }
      }
    }
    if (!this.current(gen)) return false;
    let changed = false;
    for (const r of recs) if (this.live.noteSpace(r)) changed = true;
    return changed;
  }

  // Writes store.json if it changed: writeTextFile replaces an existing file atomically and only
  // if it still holds what this writer last read or wrote; on a mismatch the current file is
  // re-read and replaced while the role is held. Past writeTextFile's 1 MiB (the new text or the
  // file it replaces) through writeLarge. A failure is the writer's `fault` (the panel shows it)
  // until a write succeeds. Chained, so writes never overlap. Every await is limited (saveTimeout) and
  // named (saving), and a save of an older generation (the watchdog gave its pass up, or the role went
  // elsewhere) writes nothing more, records nothing (storeText, fault) and resolves false.
  saveStore() {
    const gen = this.gen;
    const go = async () => {
      if (!this.current(gen)) return false;
      const text = this.live.toText();
      if (text === this.storeText) return true;
      this.saving("ledgr-data");
      await this.bounded(fs.mkdir(dataDir(), { recursive: true }), "making ledgr-data").catch(() => {});
      if (!this.current(gen)) return false;
      const r = await this.writeStoreText(text, gen);
      if (!this.current(gen)) return false;                 // given up, or the role went elsewhere, meanwhile
      if (r === false) return false;
      if (r !== true) { this.saveStep = null; this.setFault(`store.json not written: ${r}`); return false; }
      this.storeText = text;
      this.setFault(null);
      // snapshot.json follows every store change (the extractor reads it at each Stop).
      this.saving("snapshot.json");
      const ok = () => this.current(gen);
      await writeWhole(`${dataDir()}/snapshot.json`, JSON.stringify(this.live.snapshot()),
        { cx: this.cx, ms: this.saveTimeout, ok, step: (s) => { if (ok()) this.saving(`snapshot.json ${s}`); } }).catch(() => false);
      if (gen === this.gen) this.saveStep = null;
      return this.current(gen);
    };
    this.writeChain = this.writeChain.then(go, go);
    return this.writeChain;
  }

  // true written, false the role was lost (or generation gen given up), else the error's text. A
  // writeTextFile that gets no answer is not tried again here: it may still land, and its compare-and-swap
  // refuses it once store.json has changed; the next pass writes again.
  async writeStoreText(text, gen = this.gen) {
    const ok = () => this.current(gen);
    if (!overCap(text) && !overCap(this.storeText)) {
      if (!ok()) return false;
      this.saving("store.json writeTextFile");
      try { await this.bounded(writeTextFile(storePath(), text, this.storeText), "writing store.json"); return true; }
      catch (e) {
        if (e?.timedOut) return String(e.message);
        this.saving("store.json read again");
        const cur = await this.bounded(fs.readFile(storePath(), "utf8"), "reading store.json again").catch(() => null);
        if (!ok()) return false;
        if (!overCap(cur)) {
          this.saving("store.json writeTextFile again");
          try { await this.bounded(writeTextFile(storePath(), text, cur), "writing store.json"); return true; }
          catch (e2) { return String(e2?.message ?? e2 ?? e?.message ?? e); }
        }
      }
    }
    if (!ok()) return false;
    // Never over a store.json this writer could not read (writeTextFile's expected null refuses that too).
    if (this.storeText === null) {
      this.saving("store.json listing");
      let names;
      try { names = await this.bounded(fs.readdir(dataDir()), "listing ledgr-data"); }
      catch (e) { if (e?.timedOut) return `${e.message}; store.json not replaced`; names = []; }
      if (names.map(base).includes("store.json")) return "store.json is there but was not read when the writer started; not replaced";
      if (!ok()) return false;
    }
    return (await writeLarge(storePath(), text, { cx: this.cx, ms: this.saveTimeout, ok,
      step: (s) => { if (ok()) this.saving(`store.json ${s}`); } })) ?? true;
  }

  commit(cx) {
    cx.spawn(async () => { await this.saveStore(); });
    this.publish();
    this.scheduleSnapshot(cx);
    cx.notify();
  }

  // The spool watch of this generation: a loop that waited on a pass the watchdog gave up ends at its
  // next wake, and the next start begins a new one (abandon clears `watching`).
  watch(cx) {
    if (this.watching) return;
    this.watching = true;
    const gen = this.gen;
    cx.spawn(async (cx) => {
      let quick = 0, lastAt = 0;
      try {
        while (!this.retired && gen === this.gen) {
          await watchFolder(spoolDir());
          if (gen !== this.gen) return;
          const now = Date.now();
          quick = now - lastAt < 50 ? quick + 1 : 0;
          lastAt = now;
          if (quick > 20) { quick = 0; await cx.sleep(1000); }   // a watch that never blocks
          if (this.amWriter()) await this.reader.drain(cx);
        }
      } catch (e) { if (gen === this.gen) this.note = `spool watch stopped: ${String(e?.message ?? e)}`; }
      finally { if (gen === this.gen) this.watching = false; }
    });
  }

  // Until the hooks (or a capture) create ledgr-data/spool, look for it every 5 s.
  waitForSpool(cx, gen = this.gen) {
    cx.timer.after(5000, async (cx) => {
      if (gen !== this.gen || !this.amWriter()) return;
      await this.reader.drain(cx);
      if (gen !== this.gen) return;
      if (this.reader.missing) this.waitForSpool(cx, gen);
      else { this.watch(cx); cx.notify(); }
    });
  }

  // Applies a batch of spool events (SpoolReader). An event whose apply throws is left out whole:
  // the store goes back to what it was before the batch and the batch is applied again without it
  // (an event is never half applied), and the reader moves it to spool/failed. Returns false (not
  // the writer, or store.json not written: every file stays), true, or {failed}. Each await is a step
  // of `pass`, and after each one a pass the watchdog gave up (or a lost role) returns false at once:
  // what it applied lives only in a Store the next start no longer uses.
  async applyBatch(batch, cx, pass = null) {
    const gen = this.gen;
    const live = () => this.current(gen);
    if (!live()) return false;
    if (cx) this.cx = cx;
    const step = (s) => this.reader.step(pass, s);
    const settles = [], retries = [], launches = [], decisions = [], closes = [], resumes = [];
    let newAsks = false, pending = false;
    // branch.maxDepth is read again when a branch is asked for (watchConfig also follows the file).
    if (batch.some(({ ev }) => ev?.type === "branch")) {
      step("apply: config.json");
      const cfg = await this.bounded(loadConfig(), "reading config.json").catch(() => this.cfg);
      if (!live()) return false;
      this.applyConfig(cfg);
    }
    // A `restore` (the dialog's Reopen on an archived item) gets its record here, before the batch
    // applies: the last line of archive/<sid>/<file> (or a legacy archive/<yyyy-mm>.jsonl) whose id is
    // ev.item, as ev.record; else ev.record_error. Either way it applies and leaves the spool (store.js
    // on_restore changes nothing without a record): an event that waited would be one the passes never
    // apply. Read with fs.readFile (a legacy month file may pass the text-file cap), once per file per batch.
    const restores = batch.filter(({ ev }) => ev?.type === "restore" && !(ev.id && this.live.d.ingested.includes(ev.id)));
    if (restores.length) {
      const texts = new Map();
      for (const { ev } of restores) {
        delete ev.record; delete ev.record_error;   // the writer's to attach, never the event's own
        const loc = archiveFileOf(ev.session_id, ev.file);
        let got = loc.error ? { error: loc.error } : null;
        if (!got) {
          if (!texts.has(loc.rel)) {
            step(`apply: ${loc.rel}`);
            texts.set(loc.rel, await this.bounded(fs.readFile(`${dataDir()}/${loc.rel}`, "utf8"), `reading ${loc.rel}`)
              .catch((e) => ({ error: `${loc.rel} could not be read (${String(e?.message ?? e)})` })));
            if (!live()) return false;
          }
          const text = texts.get(loc.rel);
          got = typeof text === "string" ? archivedRecord(text, ev.session_id, ev.item) : text;
        }
        if (got.record) ev.record = got.record;
        else { ev.record_error = got.error; this.note = `restore of ${String(ev.item ?? "?").slice(0, 60)}: ${got.error}`; }
      }
    }
    step("apply");
    const failed = [], before = this.live.toText();
    let done;
    for (;;) {
      done = [];
      let threw = false;
      for (const b of batch) {
        if (failed.some((f) => f.name === b.name)) continue;
        try { done.push({ ev: b.ev, r: this.live.apply(b.ev) }); }
        catch (e) {
          failed.push({ name: b.name, error: String(e?.message ?? e), stack: String(e?.stack ?? "") });
          threw = true;
          break;
        }
      }
      if (!threw) break;
      this.live.d = Store.fromText(before).d;
    }
    for (const { ev, r } of done) {
      settles.push(...r.settle);
      retries.push(...(r.retry ?? []));
      launches.push(...(r.launch ?? []));
      decisions.push(...(r.decisions ?? []));
      closes.push(...(r.close ?? []));
      resumes.push(...(r.resume ?? []));
      // A session in a space where ledgr is off does not open the panel (its asks are kept, hidden).
      if (ev?.type === "asks" && Array.isArray(ev.asks) && ev.asks.length && !this.offEvent(ev)) newAsks = true;
      if (ev?.type === "pending") pending = true;
      if (r.restore && !r.restore.ok) this.note = `restore of ${String(r.restore.item ?? "?").slice(0, 60)}: ${r.restore.error ?? "not restored"}`;
      if (r.note) this.note = r.note;   // an act for an item no longer in the store (store.js on_act)
    }
    for (const s of settles) {
      step("apply: re-anchor");
      await this.reanchor(s, live, () => step("apply: re-anchor"));
      if (!live()) return false;
    }
    // decisions.md before store.json: a batch that fails to save is applied again later, and the
    // append skips a branch whose line is already there.
    for (const d of decisions) {
      step("apply: decisions.md");
      await this.bounded(this.appendDecision(d), "writing decisions.md").catch(() => { this.note = `decisions.md not written for ${String(d.sid).slice(0, 8)}`; });
      if (!live()) return false;
    }
    // store.json first: the reader unlinks these files only when this resolves true.
    step("save");
    if (!(await this.saveStore()) || !live()) return false;
    this.publish();
    if (pending) cx.timer.after(30500, (cx) => { this.publish(); cx.notify(); });   // pending times out
    this.scheduleSnapshot(cx);
    for (const r of retries) this.runRetry(r, cx);
    for (const id of launches) this.launchBranch(id, cx);
    for (const id of closes) this.closeBranch(id, cx);
    for (const sid of resumes) this.resumeSession(sid, cx);
    if (newAsks && this.cfg.surface?.openPanelOnAsks && this.panelShown() === false) showPanel(panelPlace(this.cfg));
    cx.notify();
    return failed.length ? { failed } : true;
  }

  panelShown() { return panelShown(panelPlace(this.cfg)); }

  // An event of a session whose terminal is in a space where ledgr is off.
  offEvent(ev) {
    const s = this.live.d.sessions[ev?.session_id];
    const t = ev?.terminal ?? s?.terminal ?? null;
    return Boolean(t) && this.live.isOff(t, s, terminalSpace);
  }

  // A question parked during turn N points at N's message; if its quote is not in that
  // message, the saved turns are searched backward (spec 5.3). Pins (docs/design/Pins.md 2.4): a pin
  // found on the screen (verified "screen") settled at turn N is looked for the same way; found at n,
  // its anchor moves there (approx false); not found, it stays at N, approx. Either way, once.
  // Each turn read is limited (an unanswered one counts as not found, and is not cached); live() false
  // (the pass was given up) stops at the next read; moved() at each read keeps the pass's step fresh.
  async reanchor({ sid, turn, textPath }, live = () => true, moved = () => {}) {
    const items = this.live.itemsOf(sid).filter((it) => isHuman(it) && it.anchor?.quote && it.anchor.turn === turn && !it.anchor.reanchored);
    const pins = this.live.pinsOfSession(sid).filter((p) => p.anchor?.verified === "screen" && p.anchor.turn === turn && !p.anchor.reanchored);
    if (!items.length && !pins.length) return;
    const read = async (n) => {
      const k = `${sid}:${n}`;
      if (this.passages.has(k)) return this.passages.get(k);
      const p = n === turn && textPath ? (textPath.startsWith("/") ? textPath : `${dataDir()}/${textPath}`) : turnPath(sid, n);
      moved();
      let txt;
      try { txt = await this.bounded(readTextFile(p), `reading turn ${n}`); }
      catch (e) { return e?.timedOut ? null : (this.passages.set(k, null), null); }
      this.passages.set(k, txt);
      if (this.passages.size > 120) this.passages.delete(this.passages.keys().next().value);
      return txt;
    };
    for (const it of items) {
      const q = plain(it.anchor.quote);
      for (let n = turn; n >= Math.max(0, turn - 50); n--) {
        const txt = await read(n);
        if (!live()) return;
        if (txt && plain(txt).includes(q)) { if (n !== turn) { it.anchor.turn = n; it.anchor.reanchoredFrom = turn; } break; }
      }
      it.anchor.reanchored = true;
    }
    for (const p of pins) {
      const q = plain(p.text);
      let found = null;
      for (let n = turn; q && n >= Math.max(0, turn - 50); n--) {
        const txt = await read(n);
        if (!live()) return;
        if (txt && plain(txt).includes(q)) { found = n; break; }
      }
      if (found === null) p.anchor.approx = true;
      else {
        p.anchor.approx = false;
        // Moved: turn N's message uuid (on_stop gave it) is not this passage's; that turn's, if recorded.
        if (found !== turn) { p.anchor.turn = found; p.anchor.reanchoredFrom = turn; p.anchor.uuid = this.live.turnInfo(sid, found)?.uuid ?? null; }
      }
      p.anchor.reanchored = true;
    }
  }

  // The extractor's --retry (the hooks agent's interface: bin/adapters/<agent>/extract.sh,
  // else bin/ledgr-extract.sh). Its new `asks` event arrives through the spool.
  runRetry({ sid, turn, terminal }, cx) {
    cx.spawn(async (cx) => {
      const s = this.live.d.sessions[sid];
      const rec = () => this.live.turnRec(sid, turn);
      let note, ok = false;
      try {
        const adapter = agentLabel(s?.agent);
        let script = `${binDir()}/adapters/${adapter}/extract.sh`;
        if (!(await fs.exists(script).catch(() => false))) script = `${binDir()}/ledgr-extract.sh`;
        if (!(await fs.exists(script).catch(() => false))) throw new Error(`no extractor for agent "${adapter}" under mods/ledgr/bin`);
        const args = [script, "--retry", sid, String(turn)];
        const t = terminal ?? s?.terminal;
        if (t) args.push("--terminal", t);
        const r = await exec("bash", args);
        let j = null;
        try { j = JSON.parse(r.stdout.trim().split("\n").pop() || "null"); } catch { /* not JSON */ }
        ok = Boolean(j?.ok);
        note = j ? (j.ok ? `${j.asks} ask${j.asks === 1 ? "" : "s"} extracted (${j.source})` : j.error || "extraction failed")
          : `exited ${r.code}${r.stderr ? `: ${r.stderr.trim().slice(0, 160)}` : ""}`;
      } catch (e) { note = `could not run: ${String(e?.message ?? e)}`; }
      if (!this.amWriter()) return;
      rec().retry = { at: Date.now(), state: ok ? "done" : "failed", note };
      this.commit(cx);
    });
  }

  // Phase 2: start a branch the store accepted. `hc run --bg --parent <trunk terminal>
  // --outlive-parent --no-notify ... -- /usr/bin/env LEDGR_PARENT=... LEDGR_BRANCH=... claude
  // --resume <parent sid> --fork-session --session-id <child sid> -n <label> <preamble>`, so the
  // agents tree shows it under the trunk; placement "split" then gives it a pane right of the
  // trunk (pane.focus, terminal.keep). Isolated: Herdr's worktree dialog makes the checkout and a
  // new space running the same argv (no hc parent there; ledgr keeps the lineage). Nothing is
  // typed into any terminal.
  launchBranch(id, cx) {
    cx.spawn(async (cx) => {
      const st = this.live, br = st.d.branches[id];
      if (!br || br.status !== "launching") return;
      const it = st.item(br.requestId), ps = st.d.sessions[br.parentSessionId], m = br.manifest;
      let error = null, terminal = null, note = null;
      try {
        if (!it || !ps || !m) throw new Error("the question or its session is no longer in the ledger");
        const t = ps.terminal;
        const k = t ? terminals().find((x) => x.address === t) : null;
        if (!k || (k.state && k.state !== "live")) throw new Error(`the trunk's terminal ${t ?? "?"} is not live`);
        const claude = await this.claudePath();
        if (br.isolate) {
          openOverlay({ mod: "worktree", kind: "dialog", width: 520,
            props: { folder: m.cwd, action: "new", branch: `ledgr/${br.name}`, argv: claudeArgv(br, m, it, claude) } });
          note = "Herdr's worktree dialog: new checkout and space";
        } else {
          const r = await hc(hcRunArgs(br, m, it, claude));
          let j = null;
          try { j = JSON.parse(String(r.stdout ?? "").trim().split("\n").pop() || "null"); } catch { /* not JSON */ }
          if (r.code !== 0 || !j?.address) throw new Error(String(r.stderr || r.stdout || `hc run exited ${r.code}`).trim().slice(0, 300));
          terminal = j.address;
          if (br.placement === "split") note = await this.placeBeside(t, terminal, cx);
        }
      } catch (e) { error = String(e?.message ?? e); }
      if (!this.amWriter()) return;
      st.branchLaunched(id, { terminal, error, note });
      this.commit(cx);
    });
  }

  // A fresh sub-agent gets a pane right of its trunk's pane. The app learns of a terminal hc just
  // started a moment later (a keep sent at once does nothing), so first wait for it in
  // terminals() (up to 5 s); then check that the pane came (up to 3 s). A trunk with no pane of
  // its own (a pane-less sub-agent) leaves the branch a sub-agent. Returns a note, or null.
  async placeBeside(parent, child, cx) {
    for (let i = 0; i < 50 && !terminals().some((x) => x.address === child); i++) await cx.sleep(100);
    if (!terminals().some((x) => x.address === child)) return "the app did not see the new terminal in 5 s: left as a sub-agent";
    if (!panes().some((p) => p.terminal === parent)) return "the trunk has no pane: left as a sub-agent (peek it from the agents list)";
    run("pane.focus", { terminal: parent });
    run("terminal.keep", { terminal: child, place: "right" });
    for (let i = 0; i < 30 && !panes().some((p) => p.terminal === child); i++) await cx.sleep(100);
    return panes().some((p) => p.terminal === child) ? null : "terminal.keep gave no pane within 3 s: left as a sub-agent";
  }

  // Phase 3: one line per confluence that reached a trunk, in ledgr-data/sessions/<sid>/decisions.md
  // (beside the hooks' sessions/<sid>.json). Created with a header; a line whose branch id is already
  // in the file is not written twice.
  async appendDecision({ sid, key, line, header }) {
    if (!this.amWriter() || !sid || /[/\\]|\.\./.test(sid)) return false;
    const dir = `${dataDir()}/sessions/${sid}`, path = `${dir}/decisions.md`;
    await fs.mkdir(dir, { recursive: true }).catch(() => {});
    if (!this.amWriter()) return false;
    // Made again from the file at each try (writeAtomicWith), so a line that landed meanwhile is kept.
    const ok = await writeAtomicWith(path, (cur) => (key && cur.includes(key) ? null : `${cur || header || ""}${line}\n`));
    if (!ok) this.note = `decisions.md not written for ${String(sid).slice(0, 8)}`;
    return ok;
  }

  // Phase 3: Close branch (offered after rejoin). Ends the branch's program with `hc kill` (a kept
  // terminal ends too: keep only replaces programs that are lost, not killed), then `hc rm` so the
  // finished terminal and its pane go. The Branch record and its conclusion stay in the store.
  closeBranch(id, cx) {
    cx.spawn(async (cx) => {
      const st = this.live, br = st.d.branches[id];
      if (!br || br.closedAt) return;
      const t = br.terminal;
      let error = null, note = null;
      const liveT = () => terminals().some((x) => x.address === t && (!x.state || x.state === "live"));
      try {
        if (!t) throw new Error("the branch has no terminal");
        if (liveT()) {
          const r = await hc(["kill", t]);
          if (r.code !== 0 && liveT()) throw new Error(String(r.stderr || r.stdout || `hc kill exited ${r.code}`).trim().slice(0, 300));
          for (let i = 0; i < 30 && liveT(); i++) await cx.sleep(100);
        }
        const r = await hc(["rm", t]);
        if (r.code !== 0 && !/not_found|no terminal/.test(`${r.stdout ?? ""}${r.stderr ?? ""}`)) note = `hc rm ${t}: ${String(r.stderr || r.stdout || r.code).trim().slice(0, 160)}`;
      } catch (e) { error = String(e?.message ?? e); }
      if (!this.amWriter()) return;
      st.branchClosed(id, { error, note });
      this.commit(cx);
    });
  }

  // Resume session: the transcript must still exist; then `hc run` (no parent) in the session's folder,
  // a pane right of the focused one (terminal.keep), focus. The record says what happened; the
  // session's own SessionStart hook moves it to the new terminal.
  resumeSession(sid, cx) {
    cx.spawn(async (cx) => {
      const s = this.live.d.sessions[sid];
      if (!s || s.resume?.state !== "launching") return;
      let error = null, terminal = null, note = null;
      try {
        const tp = transcriptPathOf(s, home());
        if (!(await fs.exists(tp).catch(() => false))) throw new Error(`transcript gone (${tp})`);
        const r = await hc(resumeArgs(s, await this.claudePath()));
        let j = null;
        try { j = JSON.parse(String(r.stdout ?? "").trim().split("\n").pop() || "null"); } catch { /* not JSON */ }
        if (r.code !== 0 || !j?.address) throw new Error(String(r.stderr || r.stdout || `hc run exited ${r.code}`).trim().slice(0, 300));
        terminal = j.address;
        note = await this.givePane(terminal, cx);
      } catch (e) { error = String(e?.message ?? e); }
      if (!this.amWriter()) return;
      this.live.resumeLaunched(sid, { terminal, error, note });
      this.commit(cx);
    });
  }

  // A new pane-less terminal gets a pane right of the focused pane, then the focus (the same waits
  // as placeBeside). Returns a note, or null.
  async givePane(t, cx) {
    for (let i = 0; i < 50 && !terminals().some((x) => x.address === t); i++) await cx.sleep(100);
    if (!terminals().some((x) => x.address === t)) return "the app did not see the new terminal in 5 s: peek it from the agents list";
    run("terminal.keep", { terminal: t, place: "right" });
    for (let i = 0; i < 30 && !panes().some((p) => p.terminal === t); i++) await cx.sleep(100);
    if (!panes().some((p) => p.terminal === t)) {
      run("terminal.keep", { terminal: t });   // no place: a tab of its own
      for (let i = 0; i < 30 && !panes().some((p) => p.terminal === t); i++) await cx.sleep(100);
    }
    if (!panes().some((p) => p.terminal === t)) return "terminal.keep gave no pane within 6 s: peek it from the agents list";
    run("pane.focus", { terminal: t });
    return null;
  }

  // The claude program for a launch: its absolute path in the person's environment, else "claude".
  async claudePath() {
    if (this.claudeBin) return this.claudeBin;
    try {
      const r = await exec("/usr/bin/which", ["claude"]);
      const p = String(r.stdout ?? "").trim().split("\n").pop();
      if (r.code === 0 && p.startsWith("/")) this.claudeBin = p;
    } catch { /* not found: plain name */ }
    return this.claudeBin ?? "claude";
  }

  publish() {
    if (!this.amWriter()) return;
    const chips = this.live.chips(Date.now(), terminalSpace);
    const s = JSON.stringify(chips);
    if (s === this.lastChips) return;
    this.lastChips = s;
    if (JSON.stringify(shared("ledgr.chips") ?? {}) !== s) setShared("ledgr.chips", chips);
    // Diagnostics: the last 12 chip values published, with the time and the writer's role. Saved
    // with the next store write (a chip state can last under a second: pending, then asks).
    const diag = (this.live.d.diag ??= {});
    diag.chips = [...(diag.chips ?? []).slice(-11), { at: Date.now(), by: this.role, chips }];
  }

  // The snapshot is written by saveStore with every store change; at start it is written once
  // even when the store did not change.
  scheduleSnapshot(cx) {
    if (this.snapDone) return;
    this.snapDone = true;
    const gen = this.gen;
    cx.spawn(async () => {
      if (!this.current(gen) || !(await this.bounded(fs.exists(dataDir()), "ledgr-data").catch(() => false))) return;
      const ok = () => this.current(gen);
      await writeWhole(`${dataDir()}/snapshot.json`, JSON.stringify(this.live.snapshot()), { cx: this.cx, ms: this.saveTimeout, ok });
    });
  }

  // ── housekeeping: retention (2026-11-19) ──────────────────────────────
  // Why a run is due now, or null. Only the holder, and one run per generation (this.house). A run this
  // copy began less than an hour ago holds every trigger back. Then: the first start after the upgrade
  // (d.retention v 1 missing), a day since the last run (d.houseAt), or the store as last saved over
  // HOUSE_SIZE bytes with the last run over an hour ago and HOUSE_GROWTH bytes more than when the last run
  // this copy saw ended (houseEnd; none recorded, after a relaunch or a takeover: one run is allowed).
  houseDue(now = Date.now()) {
    if (this.retired || !this.amWriter() || (this.house && this.house.gen === this.gen)) return null;
    if (now - this.houseTry < HOUR) return null;
    const d = this.live.d, last = Number(d.houseAt) || 0;
    if (d.retention?.v !== 1) return "first run";
    if (now - last >= DAY) return "daily";
    if (now - last >= HOUR && overCap(this.storeText, HOUSE_SIZE)
      && (this.houseEnd === null || byteLength(this.storeText) >= this.houseEnd + HOUSE_GROWTH)) return "size";
    return null;
  }

  // From start (at its end) and every tick: a due run as its own task, so neither waits for it. Returns the
  // run's promise (it resolves with the run's tally, or null), or null when none is due.
  houseKick(cx) {
    const now = Date.now(), why = this.houseDue(now);
    if (!why || !cx?.spawn) return null;
    const gen = this.gen;
    this.houseTry = now;
    this.house = { gen, at: now, step: "queued", since: now, why };
    let end = null;
    const run = this.houseRun = new Promise((r) => { end = r; });
    cx.spawn(async (cx) => {
      let tally = null;
      try { tally = await this.housekeep(cx, gen, why); }
      catch (e) {
        if (gen === this.gen) { this.note = `housekeeping: ${String(e?.message ?? e)}`; this.log(`housekeeping (${why}) failed: ${String(e?.message ?? e)}`); }
      } finally {
        if (this.house?.gen === gen) { this.house = null; if (this.claimedPass) this.beat(); }
        end(tally);
      }
    });
    return run;
  }

  // One run (houseKick). Closed items past retention_days (store.js archivable) and turn records past
  // retention.turns, with the textHead of kept records past the newest LIMITS.turnHeads (planSlim), leave
  // store.json for new files under archive/<sid>/ (spool.js archiveDir), per session: items-<ms>-<rand6>.jsonl
  // (each item as it was) and turns-<ms>-<rand6>.jsonl ({sessionId, turn, rec} or {sessionId, turn,
  // textHead}), split so none passes ARCHIVE_FILE_MAX. Each file is created, never written over (spool.js
  // writeNew: a name already taken fails the write), and read back whole; only then, this generation still
  // the writer's, are its items removed (removeItems) and its records cut (applySlim, once, after the last
  // session), and store.json is saved when the run changed it. A file not written or not confirmed leaves
  // what it holds in the store for the next run. The first run after the upgrade first keeps the store as
  // it was in store.pre-retention-<ms>.json (writeLarge: it is over the cap), and without that copy
  // archives nothing.
  // Drains run meanwhile (they are not held back, so no event waits behind a run but for one save in the
  // chain): an item reopened or changed while its file was written is not removed (removeItems takes only
  // one still closed and exactly as planned) and a record changed is not cut (applySlim compares), so
  // the file holds a stale line, harmless (the store wins over any archive line). Every await is limited
  // (bounded, writeNew, writeLarge) and named (houseStep: progress() shows it, so the watchdog sees the run
  // move file by file); after each one, a run whose generation was given up writes and removes nothing
  // more: abandoned at any await, the store is the one on disk and at worst a file holds a duplicate.
  async housekeep(cx, gen, why) {
    if (cx) this.cx = cx;
    const ok = () => this.current(gen);
    const step = (s) => this.houseStep(gen, s);
    const ms = this.houseMs = Math.max(Date.now(), this.houseMs + 1);   // each run's files newer than the last's
    step("ledgr-data");   // none yet (no hook has run): nothing to keep, and no folder made for it
    if (!(await this.bounded(fs.readdir(dataDir()), "listing ledgr-data").then(() => true, () => false)) || !ok()) return null;
    const first = this.live.d.retention?.v !== 1;
    const sizeBefore = this.storeText?.length ?? 0;
    let kept = null;
    if (first && !this.live.empty && !this.preRetention) {
      // store.json as this writer last read or saved it, byte for byte (what is only in memory is not yet the store).
      const name = `store.pre-retention-${ms}.json`, text = this.storeText ?? this.live.toText();
      step(`keeping ${name}`);
      const err = await writeLarge(`${dataDir()}/${name}`, text, { cx: this.cx, ms: this.saveTimeout, ok, step: (s) => step(`keeping ${name}: ${s}`) });
      if (!ok()) return null;
      if (err) {
        this.note = `housekeeping: ${name} not written (${err}); nothing archived, it tries again within the hour`;
        this.log(`housekeeping (${why}): ${name} not written (${err}); nothing archived`);
        return null;
      }
      this.preRetention = kept = name;
    }
    // The plan, from the store as it is now; grouped per session (an item or record with no usable session
    // id stays in the store).
    step("plan");
    const plan = this.live.planSlim(turnsKept(this.cfg));
    const per = new Map();
    const group = (sid) => { let g = per.get(sid); if (!g) per.set(sid, g = { items: [], cut: [], heads: [] }); return g; };
    // archivable's items are copies as the store holds them now: each one's line, and what removeItems
    // compares the store with once its file is confirmed. Only with a config.json read as it is (or none:
    // the defaults are then the config): when its read failed or timed out, this.cfg may be the defaults in
    // place of the person's days (30 read as 3), so this run archives no item (turn records still go).
    const cfgOk = this.cfg?._source === "file" || (this.cfg?._source === "defaults" && !this.cfg?._error);
    const items = cfgOk ? this.live.archivable(this.cfg?.retention_days, Date.now()) : [];
    for (const it of items) if (archiveDir(it.anchor?.sessionId)) group(it.anchor.sessionId).items.push(it);
    for (const c of plan.cut ?? []) if (archiveDir(c.sessionId)) group(c.sessionId).cut.push(c);
    for (const h of plan.heads ?? []) if (archiveDir(h.sessionId)) group(h.sessionId).heads.push(h);
    const t = { items: 0, stayed: 0, cut: 0, heads: 0, files: 0, failed: [], cfgSkipped: !cfgOk };
    const slim = { cut: [], heads: [] };   // confirmed in a turns file: applied once, after the last session
    for (const sid of [...per.keys()].sort()) {
      const g = per.get(sid), dir = archiveDir(sid);
      step(`making archive/${dir}`);
      await this.bounded(fs.mkdir(`${dataDir()}/archive/${dir}`, { recursive: true }), `making archive/${dir}`).catch(() => {});
      if (!ok()) return null;
      if (g.items.length) {
        const done = await this.archiveLines(gen, dir, "items", ms, g.items.map((it) => [JSON.stringify(it), it]), t);
        if (done === null || !ok()) return null;
        if (done.length) { const gone = this.live.removeItems(done) ?? []; t.items += gone.length; t.stayed += done.length - gone.length; }
      }
      const lines = [...g.cut.map((c) => [JSON.stringify({ sessionId: c.sessionId, turn: c.turn, rec: c.rec }), { cut: c }]),
        ...g.heads.map((h) => [JSON.stringify({ sessionId: h.sessionId, turn: h.turn, textHead: h.textHead }), { head: h }])];
      if (lines.length) {
        const done = await this.archiveLines(gen, dir, "turns", ms, lines, t);
        if (done === null || !ok()) return null;
        for (const x of done) (x.cut ? slim.cut.push(x.cut) : slim.heads.push(x.head));
      }
    }
    if (!ok()) return null;
    // Once, for every session: applySlim makes every record it leaves lean (a default textPath, null fields:
    // lossless), so a call per session would leave the next session's planned records changed, not cut.
    const pre = this.live.toText();
    const r = this.live.applySlim(slim);
    t.cut = Number(r?.cut) || 0;
    t.heads = Number(r?.heads) || 0;
    // Saved when this run changed the store: items removed, records cut or made lean, or the first run's
    // d.retention. A run that found nothing writes no file and saves nothing; its houseAt (and whatever else
    // waits unsaved, the chips' diag) goes with the next save. houseEnd, the store's bytes now, is what the
    // size trigger measures growth from (on today's data the store stays over HOUSE_SIZE after its trim).
    const changed = first || t.items > 0 || this.live.toText() !== pre;
    this.live.d.houseAt = Date.now();
    if (first) this.live.d.retention = { v: 1, at: Date.now() };
    t.saved = false;
    if (changed) {
      step("save");
      t.saved = await this.saveStore();
      if (!ok()) return null;
    }
    this.houseEnd = byteLength(this.storeText ?? "");
    if (t.files || t.failed.length || first || t.cfgSkipped) {
      this.log(`housekeeping (${why}): ${t.items} closed item(s) and ${t.cut} turn record(s) archived, ${t.heads} textHead(s) moved, in ${t.files} file(s); `
        + `store.json ${sizeBefore} -> ${this.storeText?.length ?? "?"} characters${t.saved ? "" : " (not saved yet)"}`
        + `${kept ? `; the store as it was kept in ${kept}` : ""}${t.stayed ? `; ${t.stayed} changed meanwhile, kept` : ""}`
        + `${t.cfgSkipped ? `; config.json not read (${String(this.cfg?._error ?? "no answer").slice(0, 80)}), so no closed item archived` : ""}`
        + `${t.failed.length ? `; ${t.failed.length} file(s) not written, their contents kept in the store (${t.failed[0]})` : ""}`);
    }
    if (t.failed.length) this.note = `housekeeping: ${t.failed.length} archive file(s) not written (${t.failed[0]}); the next run tries again`;
    else if (t.cfgSkipped) this.note = "housekeeping: config.json could not be read, so no closed item was archived this run";
    return t;
  }

  // One kind of a session's lines ([line, payload]) into new archive/<dir>/<kind>-<ms>-<rand6>.jsonl files:
  // the payloads of the lines in files written and read back whole, or null when the run was given up. A
  // file that failed, or a line too long for any file, goes in t.failed; its payloads are not returned.
  async archiveLines(gen, dir, kind, ms, entries, t) {
    const ok = () => this.current(gen);
    const { chunks, over } = archiveChunks(entries.map(([line]) => line), ARCHIVE_FILE_MAX);
    if (over.length) t.failed.push(`${over.length} line(s) of archive/${dir} over ${ARCHIVE_FILE_MAX} bytes`);
    const done = [];
    for (const { idx, text } of chunks) {
      if (!ok()) return null;
      const rel = `archive/${dir}/${kind}-${ms}-${rand6()}.jsonl`;
      const err = await writeNew(`${dataDir()}/${rel}`, text, { cx: this.cx, ms: this.saveTimeout, ok,
        step: (s) => this.houseStep(gen, `${s === "write" ? "writing" : "reading back"} ${rel}`) });
      if (!ok()) return null;
      if (err) { t.failed.push(`${rel}: ${err}`); continue; }
      t.files += 1;
      for (const i of idx) done.push(entries[i][1]);
    }
    return done;
  }

  // The host's 60 s timer: a back-off first (cooling), then the watchdog (a pass or a start stuck in one
  // step: restarted, nothing else this tick), then the safety rescan, the waiting check, the heartbeat (the
  // claim renewed with the writer's health and its pass), deferred items waking, config.json and every
  // identity-map record read again (the safety net for watchConfig), housekeeping when due (its own task,
  // houseKick). After each await nothing more unless this tick's generation is still the writer's. A host
  // that does not hold the role checks instead that the holder is alive (probe).
  tick(cx) {
    this.cx = cx;
    if (this.cooling(cx)) return;
    if (this.watchdog(cx)) return;
    if (!this.amWriter()) { this.probe(cx); return; }
    const gen = this.gen;
    cx.spawn(async (cx) => {
      await this.reader.drain(cx);
      if (!this.current(gen)) return;
      const failed = await this.bounded(countFailed(), "counting spool/failed").catch(() => this.reader.failed);
      if (!this.current(gen)) return;
      this.reader.failed = failed;
      if ((await this.checkWaiting(cx, gen)) || !this.current(gen)) return;
      this.beat();
      if (!this.watching && this.reader.missing === false) this.watch(cx);
      if (!this.watchingConfig) this.watchConfig(cx);
      const changed = this.live.wake();
      const before = this.chipKey();
      const cfg = await this.bounded(loadConfig(), "reading config.json").catch(() => this.cfg);
      if (!this.current(gen)) return;
      this.applyConfig(cfg);
      if (this.chipKey() !== before) this.publish();
      const spaces = await this.refreshSpaces(null, gen);
      if (!this.current(gen)) return;
      if (changed || spaces) this.commit(cx); else this.publish();
      this.houseKick(cx);
    });
  }

  // Backing off (backOff): no restart before coolUntil. Meanwhile a copy that still holds the claim renews
  // it each tick with the finding and when it tries again, so the panel, the doctor and the MCP server say
  // so, and another host or the panel takes a claim that does not move (claimStuck). At coolUntil it starts
  // again if nobody holds the role, it still does, a panel's fallback does (a host takes the role back, as
  // in respond), or the holder has not moved. True while backing off or just done (nothing else this tick).
  cooling(cx) {
    if (!this.coolUntil) return false;
    if (this.retired) return true;
    if (Date.now() < this.coolUntil) { if (this.holds()) this.claim(); return true; }
    this.coolUntil = 0;
    const w = writerClaim();
    if (!w || w.id === this.id || (w.by === "panel" && this.role !== "panel") || claimStuck(w) > TAKEOVER_STUCK_MS) {
      this.log(`back-off over: starting again (${!w ? "no claim" : w.id === this.id ? "the role is still this copy's" : `from ${w.by}`})`);
      this.regain(cx);
    }
    return true;
  }

  // The watchdog, from tick (sync: it runs even while every await of the writer waits). Stuck: this
  // copy's pass, its start, or its housekeeping run (kind "house"), has waited in one step longer than
  // PASS_STUCK_MS (progress()); or a start
  // ended without starting while this copy holds the claim (it threw: a read that got no answer). Then
  // unstick. A start of a copy that does not hold the claim is given up too, without taking the role.
  watchdog(cx) {
    if (this.retired || !this.booted) return false;
    const now = Date.now(), p = this.progress();
    let f = null;
    if (p && now - p.since > PASS_STUCK_MS && (this.starting || this.amWriter())) {
      f = { step: p.step, ms: now - p.since, kind: this.reader.pass ? "pass" : this.starting ? "start" : "house" };
    } else if (!this.starting && !this.started && this.holds() && this.startAt) {
      f = { step: `start: ${this.startStep ?? "?"} (it ended without starting)`, ms: now - this.startAt, kind: "start" };
    }
    if (!f) return false;
    this.unstick(cx, f);
    return true;
  }

  // Stuck (watchdog, checkWaiting): the finding goes in the claim (`stall`, and `fault` until it comes
  // back) and writer.log with what the save chain waits in; the pass is given up (a new generation) and,
  // while this copy holds the claim, it starts again from store.json (regain). The run of restarts with
  // no pass finished between them is counted; past MAX_UNSTICKS this copy backs off before the next.
  unstick(cx, { step, ms, kind, name = null }) {
    const now = Date.now(), p = this.reader.pass;
    if (this.reader.done > this.lastUnstick) this.unstickRun = 0;
    this.unstickRun += 1;
    this.lastUnstick = now;
    this.stalls += 1;
    this.stall = { at: now, step, ms, n: this.stalls, kind, ok: false, ...(name ? { name } : {}) };
    this.log(`stuck ${spanWords(ms)} in ${step} (${kind}; pass started ${iso(p?.at)}; save chain `
      + `${this.saveStep ? `in ${this.saveStep.step} since ${iso(this.saveStep.since)}` : "idle"}; last pass ended ${iso(this.reader.done)}; `
      + `generation ${this.gen}; restart ${this.unstickRun} of ${MAX_UNSTICKS})`);
    const held = this.holds();
    this.abandon();
    this.starting = false;
    this.started = false;
    if (this.unstickRun > MAX_UNSTICKS) { this.backOff(held); return; }
    if (held) this.regain(cx);
  }

  // MAX_UNSTICKS restarts in a row finished no pass: restarting at once does not help. The copy waits
  // BACKOFF_MS before the next, then twice that each time, up to BACKOFF_MAX_MS (cooling), and keeps
  // trying for as long as Herdr runs: with one host (the public install, or an overlay's tab bar) and the
  // panel hidden, nobody else would take the role, and the cause may pass (2026-11-19 review: giving the
  // role up left the chips frozen and the status line silent until a relaunch). It keeps the claim, which
  // says it is stuck and when it tries again (stallText): the status line, the doctor and the MCP server say
  // so, and another host's probe or the panel's check takes over a claim that has not moved. The events
  // wait in the spool meanwhile, nothing lost; relaunching Herdr starts the copy afresh at once.
  backOff(held) {
    const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_MS * 2 ** Math.max(0, this.unstickRun - MAX_UNSTICKS - 1));
    this.coolUntil = Date.now() + wait;
    Object.assign(this.stall, { retryAt: this.coolUntil, tries: this.unstickRun - 1 });
    this.log(`${this.unstickRun - 1} restarts in a row finished no pass; the next in ${spanWords(wait)}. The claim stays and says so; `
      + "another host or the panel takes over a claim that does not move, and relaunching Herdr starts this copy afresh");
    this.note = `the writer is stuck (log/writer.log); it tries again in ${spanWords(wait)}, or relaunch Herdr`;
    if (held) this.claim();
  }

  // The second criterion (2026-11-19): the spool's oldest event (its name starts with the time it was
  // written) older than PASS_STUCK_MS while no pass runs means the passes do not apply it. A save fault is
  // on the status line already and keeps every file waiting, so it is left to that. The first time for a
  // file: unstick (true: restarted). The same file still waiting at a later tick: said in the claim (kind
  // "spool"), not restarted again; gone, or no longer old: the finding comes back (ok).
  async checkWaiting(cx, gen) {
    if (this.fault || this.reader.running) return false;
    const names = await this.bounded(listSpool(), "listing the spool").catch(() => null);
    if (!this.current(gen) || this.reader.running || !names) return false;
    const oldest = names[0] ?? null, now = Date.now();
    const age = oldest ? now - Number(oldest.split("-")[0]) : NaN;
    const st = this.stall;
    if (!(age > PASS_STUCK_MS)) {
      if (st && !st.ok && st.kind === "spool") { st.ok = true; st.back = now; this.log(`${st.name} no longer waits in the spool`); }
      this.waitedOn = null;
      return false;
    }
    if (this.waitedOn !== oldest) {
      this.waitedOn = oldest;
      this.unstick(cx, { step: `the spool (${oldest} waits)`, ms: age, kind: "spool", name: oldest });
      return true;
    }
    if (st && !st.ok && st.kind === "spool" && st.name === oldest) st.ms = age;
    else {
      this.stalls += 1;
      this.stall = { at: now, step: `the spool (${oldest} waits)`, ms: age, n: this.stalls, kind: "spool", ok: false, name: oldest };
      this.log(`${oldest} still waits in the spool after a restart (${spanWords(age)}); not restarted again`);
    }
    return false;
  }

  // From the host's render (it re-renders when agents change). Working -> idle with no stop
  // event within 3 s: the turn was interrupted. Sessions without hooks take their turns from
  // these transitions instead (statusTurn). The hooks' `pending` (sent at once at Stop) ends the
  // turn, so 6 s without pending or stop means the person interrupted it.
  track(cx) {
    if (!this.amWriter()) return;
    const live = new Map(agents().map((a) => [a.address, a.status]));
    for (const s of Object.values(this.live.d.sessions)) {
      if (!s.terminal) continue;
      const now = live.get(s.terminal) ?? null, prev = this.lastStatus.get(s.terminal);
      this.lastStatus.set(s.terminal, now);
      if (s.turnSource === "herdr-status") {
        if (now && now !== prev && this.live.d.terminals[s.terminal]?.sessionId === s.sessionId) {
          this.pendingStatus.push([s.sessionId, now]);
          if (this.pendingStatus.length === 1) cx.timer.after(0, (cx) => {
            const list = this.pendingStatus.splice(0);
            if (list.map(([sid, st]) => this.live.statusTurn(sid, st)).some(Boolean)) this.commit(cx);
          });
        }
        continue;
      }
      if (prev === "working" && (now === "idle" || now === "done") && s.state === "working") {
        const sid = s.sessionId;
        cx.timer.after(6000, (cx) => {
          if (!this.amWriter() || this.live.d.sessions[sid]?.state !== "working") return;
          this.live.interrupted(sid);
          this.commit(cx);
        });
      }
    }
  }

  // From a host's render: a panel asks "is a writer alive?" by setting shared("ledgr.ping"); the
  // holding host answers by claiming again (claim.at > ping.at). A host that does not hold the
  // role takes it when nobody does or a panel fallback does, re-reading store.json first (another
  // writer changed it meanwhile). Without a cx (an older host), it only answers pings.
  respond(cx) {
    if (this.retired || this.role === "panel" || this.starting || this.coolUntil) return;   // backing off: cooling decides
    const w = writerClaim(), ping = shared("ledgr.ping");
    if (this.started && this.holds()) {
      if (ping && Number(ping.at) > this.claimAt) this.claim();
      return;
    }
    if (!this.booted || !cx) return;
    if (!w || w.by === "panel") this.regain(cx);
  }

  // A holder that went away without releasing (a crash, a forced quit) leaves a claim nobody
  // answers. A host that does not hold the role pings, at most every 2 minutes after the claim was
  // last refreshed, and takes the role when the claim is not renewed within 4 s. A fresh claim whose
  // pass has not moved for TAKEOVER_STUCK_MS (claimStuck: its holder is alive but not applying, and its
  // own watchdog did not restart it) is taken at once.
  probe(cx) {
    if (this.retired || this.role === "panel" || !this.booted || this.starting || this.coolUntil || !cx) return;
    const w = writerClaim();
    if (!w || w.by === "panel") { this.regain(cx); return; }
    if (w.id === this.id) return;
    const stuck = claimStuck(w);
    if (stuck > TAKEOVER_STUCK_MS) {
      this.log(`taking the role from ${w.by}: its claim is fresh but it has not moved for ${spanWords(stuck)} (${w.pass?.step ?? w.stall?.step ?? "?"})`);
      this.regain(cx);
      return;
    }
    if (Date.now() - Number(w.at || 0) < 120000 || this.probing) return;
    const at = Date.now();
    this.probing = true;
    setShared("ledgr.ping", { at, id: this.id });
    cx.timer.after(4000, (cx) => {
      this.probing = false;
      const now = writerClaim();
      if (!this.holds() && !this.starting && (!now || (now.id === w.id && Number(now.at) < at) || now.by === "panel")) this.regain(cx);
    });
  }

  // Take the role (again): start, which makes a new generation and reads store.json from disk; it
  // clears `starting` when it ends (a start that hangs is the watchdog's).
  regain(cx) {
    this.starting = true;
    this.started = false;
    this.startAt = this.startSince = Date.now();
    this.startStep = "queued";
    cx.spawn(async (cx) => {
      try { await this.start(cx); }
      catch (e) { this.note = `writer start: ${String(e?.message ?? e)}`; this.log(`start failed: ${String(e?.message ?? e)}`); }
      cx.notify();
    });
  }
}

// Does any host's engine copy (mods/<name>/ledgr/) differ from mods/ledgr's? Resolves
// "<name>/<file>" for each file that differs.
export async function engineDrift() {
  const out = [];
  const mods = await fs.readdir(`${appHome()}/mods`).catch(() => []);
  for (const m of mods) {
    if (m === "ledgr" || m.startsWith(".")) continue;
    if (!(await fs.exists(`${appHome()}/mods/${m}/ledgr/writer.js`).catch(() => false))) continue;
    for (const f of ENGINE_FILES) {
      const a = await readTextFile(`${appHome()}/mods/ledgr/${f}`).catch(() => null);
      const b = await readTextFile(`${appHome()}/mods/${m}/ledgr/${f}`).catch(() => null);
      if (a !== b) out.push(`${m}/${f}`);
    }
  }
  return out;
}
