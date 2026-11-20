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
//   - cold sessions (retention Phase 2, 2026-11-19): a session nobody touched for retention.coldDays (7) moves
//     its items and turn records into ledgr-data/cold/<safe sid>.<ms>-<rand6>.json, written once and read back
//     before the store names it (freezeRun, from the tick's housekeeping only); a pass brings back every cold
//     session its events need before it applies them (applyBatch: thaw); a file that cannot be read faults its
//     session, whose events are kept in cold/held/<safe sid>/ and replayed once it is back, reset or forgotten
//     (holdEvent, heldIn; coldTick retries); the sweep deletes a file only once the store.json on disk no
//     longer names it, after a grace (coldSweep). Only this file writes or deletes under cold/;
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
import { DEFAULTS, LIMITS, loadConfig, dataDir, spoolDir, turnPath, storePath, binDir, agentLabel, panelPlace, panelShown, showPanel, liveHome, disabledSpaces, terminalSpace, textScaleOf, retentionDaysOf,
  coldDaysOf, coldDir, coldPath, heldDir, coldName, COLD_NAME, safeName } from "./config.js";
import { Store, isHuman, thresholdOf, coldRecordError } from "./store.js";
import { SpoolReader, readMap, writeAtomic, writeAtomicWith, writeNew, isThere, notFound, overCap, byteLength, archiveDir, archiveFileOf, archivedRecord, countFailed, listSpool, within, spanWords, ARCHIVE_ITEMS } from "./spool.js";
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

// Cold sessions (retention Phase 2, 2026-11-19; docs/design/Retention.md). A freeze run moves at most
// COLD_RUN_MAX sessions and starts none after COLD_RUN_MS (each await within it limited to saveTimeout); one is
// due every COLD_EVERY_MS from the tick (coldDue). A pass brings back at most COLD_THAW_MAX sessions and pokes
// the next pass for the rest. A session whose file could not be read is tried again every COLD_RETRY_MS (and at
// once on the panel's Try again, `cold_retry`). The sweep keeps a file at least COLD_GRACE_MS after its session
// came back (a reading copy may be loading it, and the snapshot.json the thaw wrote may still name it) and
// COLD_KEEP_MS after its session was forgotten, or when a freeze nobody committed left it.
export const COLD_RUN_MAX = 40;
export const COLD_RUN_MS = 60000;
export const COLD_THAW_MAX = 50;
export const COLD_RETRY_MS = 600000;
export const COLD_GRACE_MS = 3600000;
export const COLD_KEEP_MS = 86400000;
export const COLD_EVERY_MS = 3600000;
// The unnamed files the sweep reads in one run to prove them redundant (coldSweep step 2), oldest first.
export const COLD_CHECK_MAX = 4;
// Reads of one session's cold file that got no answer in a row before the session is faulted (coldPhase).
export const COLD_TIMEOUT_MAX = 3;
// The sessions an event names, warm or cold (canFreeze keeps every one of them warm while its pass runs).
const evSessions = (ev) => [ev?.session_id, ev?.session, ev?.request?.anchor?.sessionId, ev?.parent_session_id, ev?.for_session]
  .filter((x) => typeof x === "string" && x);
const sidOf = (ev) => [ev?.session_id, ev?.session, ev?.request?.anchor?.sessionId].find((x) => typeof x === "string" && x) ?? null;
// A spool file's own name (held copies keep it): an event file, not hidden, not set aside.
// A map of lists: push v under k.
const pushTo = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
// A Phase 1 turns file's name (writer.js archiveLines: turns-<ms>-<rand6>.jsonl).
const ARCHIVE_TURNS = /^turns-\d{1,16}-[a-z0-9]{1,16}\.jsonl$/;
const isEventName = (n) => typeof n === "string" && n.endsWith(".json") && !n.startsWith(".") && !n.startsWith("bad-") && !n.includes("/");

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
    // Cold sessions (Phase 2). wantThaw: sessions to bring back with no event asking (coldDays 0, a "mixed" one
    // an older build added items beside, a fault whose retry is due). heldSids: the folders under cold/held/
    // (safe names) that hold events, as last listed or written. heldSkip: held files that do not parse (kept where
    // they are, not read again; writer.log says so once). coldTried: when each faulted session's file was last tried. passSids:
    // the sessions the running pass names (canFreeze). coldAt: when the tick's last cold run began.
    this.wantThaw = new Set();
    this.heldSids = new Set();
    this.heldSkip = new Set();
    this.coldTried = new Map();
    this.passSids = new Set();
    this.coldAt = 0;
    // Cold files the sweep keeps for good (they cannot be read, or hold what store.json lacks): name -> why.
    this.coldKept = new Map();
    // Reads of a session's cold file that got no answer, in a row: sid -> {n, at (the last)} (coldPhase;
    // COLD_TIMEOUT_MAX; forgotten after COLD_RETRY_MS without one).
    this.coldTimeouts = new Map();
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
    this.passSids = new Set();       // the given-up pass keeps no session warm
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
      // Cold sessions (Phase 2): the folders of held events, so the first pass replays the ones that may go; a
      // "mixed" session (an older build added items beside its stub) comes back in that pass too (coldTick). An
      // unanswered listing keeps the last one known (each cold run lists again).
      this.mark("cold/held listing");
      await this.listHeld(gen);
      if (!live()) return;
      this.mark("save");
      await this.saveStore();
      if (!live()) return;
      this.mark("drain");
      const applied = this.reader.applied;
      await (this.coldTick(cx, gen) ? this.reader.poke(cx) : this.reader.drain(cx));
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
    // retention.coldDays 0 (Settings "never", install.sh --thaw-all): every cold session comes back in the next
    // pass, poked here (a start pokes its own first pass).
    if (coldDaysOf(cfg) === 0 && this.thawAll() && this.amWriter() && !this.starting && this.cx?.spawn) this.reader.poke(this.cx);
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
      const snap = await writeWhole(`${dataDir()}/snapshot.json`, JSON.stringify(this.live.snapshot()),
        { cx: this.cx, ms: this.saveTimeout, ok, step: (s) => { if (ok()) this.saving(`snapshot.json ${s}`); } }).catch(() => false);
      if (gen === this.gen) { this.saveStep = null; this.snapOk = snap === true; }
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
  // Cold sessions (retention Phase 2): every session the batch names stays warm while the pass runs (passSids,
  // canFreeze); before anything applies, the held events that may go are read (replayFolders) and every cold
  // session the events need is brought back, or faulted and its events held (coldPhase); right before the apply
  // loop, with no await between, no event may need a session still cold (a third round at most, else false and
  // a poke); after the save, the held copies replayed go (coldDone).
  async applyBatch(batch, cx, pass = null) {
    if (!this.current(this.gen)) return false;
    const sids = this.passSids = new Set(batch.flatMap(({ ev }) => evSessions(ev)));
    try { return await this.applyPass(batch, cx, pass, sids); }
    finally { if (this.passSids === sids) this.passSids = new Set(); }
  }

  async applyPass(batch, cx, pass, sids) {
    const gen = this.gen;
    const live = () => this.current(gen);
    if (!live()) return false;
    if (cx) this.cx = cx;
    const step = (s) => this.reader.step(pass, s);
    const settles = [], retries = [], launches = [], decisions = [], closes = [], resumes = [];
    let newAsks = false, pending = false;
    // ps: the pass's cold state. replays: held events to apply, in name order, ahead of `own` (the batch's).
    // held: [{e, sid, fresh}] events held this pass. folders: the held folders read. budget: sessions it may
    // still read (COLD_THAW_MAX). attached: the restores given their record.
    const ps = { replays: [], own: batch.slice(), held: [], thawed: [], faulted: [], folders: new Set(), tried: new Set(), budget: COLD_THAW_MAX,
      round: 0, more: false, attached: new WeakSet(), cfgRead: false, sids, batchNames: new Set(batch.map((b) => b.name)) };
    if (!(await this.replayFolders(ps, gen, step))) return false;
    let entries;
    for (;;) {
      if (!(await this.coldPhase(ps, gen, step))) return false;
      entries = [...ps.replays, ...ps.own];
      // branch.maxDepth is read again when a branch is asked for (watchConfig also follows the file).
      if (!ps.cfgRead && entries.some(({ ev }) => ev?.type === "branch")) {
        ps.cfgRead = true;
        step("apply: config.json");
        const cfg = await this.bounded(loadConfig(), "reading config.json").catch(() => this.cfg);
        if (!live()) return false;
        this.applyConfig(cfg);
      }
      if (!(await this.attachRestores(entries, ps.attached, step, live))) return false;
      // From here to the apply loop nothing awaits: no event may need a session still cold (one gone cold during
      // the awaits above, which passSids rules out, or one past this pass's COLD_THAW_MAX). A cold_retry whose
      // read failed is the store's to drop.
      const left = this.live.coldNeeded(entries.filter(({ ev }) => ev?.type !== "cold_retry").map(({ ev }) => ev));
      if (!left.size) break;
      if (ps.round >= 2 || ps.budget <= 0) {
        this.note = `${left.size} session(s) to bring back from cold/ first; the next pass goes on`;
        cx?.timer?.after?.(50, (cx) => { if (this.current(gen)) this.reader.poke(cx); });
        return false;
      }
      ps.round += 1;
    }
    step("apply");
    const failed = [], before = this.live.toText();
    let done;
    for (;;) {
      done = [];
      let threw = false;
      for (const b of entries) {
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
    // snapshot.json follows in the save, before the reader unlinks anything. A pass that brought sessions back
    // tries a snapshot that failed once more: a stale one still names those sessions cold, so the extractor and
    // the MCP server read them from their files (kept an hour after the thaw) without what this pass applied
    // (the MCP server says held only when it finds the event's copy in cold/held/, never from the snapshot).
    if (ps.thawed.length && this.snapOk === false) {
      step("save: snapshot.json again");
      const again = await writeWhole(`${dataDir()}/snapshot.json`, JSON.stringify(this.live.snapshot()), { cx: this.cx, ms: this.saveTimeout, ok: live }).catch(() => false);
      if (!live()) return false;
      this.snapOk = again === true;
      if (!this.snapOk) this.note = "snapshot.json not written after sessions came back from cold/; the extractor and the MCP server read them from their files until the next save";
    }
    this.publish();
    if (pending) cx.timer.after(30500, (cx) => { this.publish(); cx.notify(); });   // pending times out
    this.scheduleSnapshot(cx);
    for (const r of retries) this.runRetry(r, cx);
    for (const id of launches) this.launchBranch(id, cx);
    for (const id of closes) this.closeBranch(id, cx);
    for (const sid of resumes) this.resumeSession(sid, cx);
    if (newAsks && this.cfg.surface?.openPanelOnAsks && this.panelShown() === false) showPanel(panelPlace(this.cfg));
    // Cold, now that store.json holds what this pass applied and held (coldDone).
    if (!(await this.coldDone(ps, failed, cx, gen, step))) return false;
    cx.notify();
    // The reader's own files only: a replayed held event that threw went to spool/failed in coldDone.
    const mine = failed.filter((f) => ps.batchNames.has(f.name));
    return mine.length ? { failed: mine } : true;
  }

  // A `restore` (the dialog's Reopen on an archived item) gets its record here, before the batch
  // applies: the last line of archive/<sid>/<file> (or a legacy archive/<yyyy-mm>.jsonl) whose id is
  // ev.item, as ev.record; else ev.record_error. Either way it applies and leaves the spool (store.js
  // on_restore changes nothing without a record): an event that waited would be one the passes never
  // apply. Read with fs.readFile (a legacy month file may pass the text-file cap), once per file per batch.
  // `attached`: the events already given theirs (a held restore replayed in a later round of the pass gets
  // its own then). False when the pass was given up.
  async attachRestores(entries, attached, step, live) {
    const restores = entries.filter(({ ev }) => ev?.type === "restore" && !attached.has(ev) && !(ev.id && this.live.d.ingested.includes(ev.id)));
    if (!restores.length) return true;
    const texts = new Map();
    for (const { ev } of restores) {
      attached.add(ev);
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
    return true;
  }

  // ── cold sessions in a pass (retention Phase 2) ───────────────────────
  // The held events that may replay now, before the pass's first round: every folder under cold/held/
  // (heldSids) whose session is not faulted (back, reset, forgotten, or never cold). False when given up or a
  // read got no answer.
  async replayFolders(ps, gen, step) {
    if (!this.heldSids.size) return true;
    const faulted = new Set(this.live.coldFaults().map((f) => safeName(f.sid)));
    for (const folder of [...this.heldSids].sort()) {
      if (faulted.has(folder)) continue;
      if ((await this.heldIn(folder, ps, gen, step)) === null) return false;
    }
    return true;
  }

  // One round of a pass's cold work. Every cold session the events need (store.js coldNeeded), and in the first
  // round every one in wantThaw, is read (readCold) and brought back (store.js thaw), at most COLD_THAW_MAX in the
  // pass; one whose file cannot be read is faulted (store.js coldFault), and a faulted one is read again only
  // when its retry is due (COLD_RETRY_MS since coldTried) or the batch carries its cold_retry. A session brought
  // back has its held events read and put ahead of the batch (heldIn). Then every event that needs a faulted
  // session is held (holdEvent): copied to cold/held/<that session>/, confirmed, and left out of the apply; the
  // reader still unlinks its spool file, the copy being its keeper now (a replayed one held again under another
  // session loses its old copy in coldDone). False (nothing applied, every spool file stays) when a read got no
  // answer, a copy could not be made, or the pass was given up.
  async coldPhase(ps, gen, step) {
    const live = () => this.current(gen), st = this.live, now = Date.now();
    // A cold_retry (the panel's Try again) asks for a read now; one naming a file the stub no longer names (a thaw
    // or a newer freeze since the panel looked) is already answered, and asks for nothing.
    const stale = ({ ev }) => ev?.type === "cold_retry" && typeof ev.file === "string" && ev.file !== st.d.sessions[sidOf(ev)]?.cold?.file;
    const all = () => [...ps.replays, ...ps.own].filter((e) => !stale(e));
    const retry = new Set(all().filter(({ ev }) => ev?.type === "cold_retry").map(({ ev }) => sidOf(ev)).filter(Boolean));
    const due = (sid) => {
      const f = st.d.sessions[sid]?.cold?.fault;
      return !f || retry.has(sid) || now - (this.coldTried.get(sid) ?? (Number(f.at) || 0)) >= COLD_RETRY_MS;
    };
    for (const sid of [...this.wantThaw]) if (!st.isCold(sid)) this.wantThaw.delete(sid);
    const evNeed = st.coldNeeded(all().map(({ ev }) => ev)), need = [...evNeed];
    if (ps.round === 0) for (const sid of this.wantThaw) if (!evNeed.has(sid)) need.push(sid);
    for (const sid of need) {
      if (!st.isCold(sid)) continue;
      if (ps.wantStop && !evNeed.has(sid)) continue;           // a wanted read got no answer this pass
      if (!due(sid)) { this.wantThaw.delete(sid); continue; }   // the tick brings it back when its retry is due
      if (ps.budget <= 0) { ps.more = true; break; }
      ps.budget -= 1;
      ps.sids.add(sid);
      ps.tried.add(sid);
      const file = st.d.sessions[sid].cold.file, sid8 = sid.slice(0, 8);
      step(`apply: cold ${sid8}`);
      let r = await this.readCold(sid, file, (s) => step(`apply: cold ${sid8} ${s}`));
      if (!live()) return false;
      this.coldTried.set(sid, Date.now());
      // Reads that get no answer, in a row, for this session (integration, 2026-11-19, second review): the third
      // faults it like any unreadable file, so its events are held and the rest of the spool moves. Three bounded
      // reads (saveTimeout each, 20 s) a pass or more apart: a slow disk gets two more chances, and the batch waits
      // about as long as the watchdog's one restart (PASS_STUCK_MS) before it moves.
      // A count whose last timeout is older than COLD_RETRY_MS starts again (two today and one next week are not
      // three in a row).
      if (r.transient) {
        const was = this.coldTimeouts.get(sid), t0 = Date.now();
        const n = (was && t0 - was.at <= COLD_RETRY_MS ? was.n : 0) + 1;
        this.coldTimeouts.set(sid, { n, at: t0 });
        if (n >= COLD_TIMEOUT_MAX) r = { error: `cold/${file} got no answer to ${n} reads in a row (${r.transient})` };
      }
      if (!r.transient) this.coldTimeouts.delete(sid);
      if (r.transient) {
        this.note = `${r.transient}; tried again at the next pass`;
        if (evNeed.has(sid)) return false;   // an event needs it: the pass waits, every spool file stays
        // Only wanted (wantThaw): the events go on, and no other wanted read this pass (integration, 2026-11-19:
        // up to COLD_THAW_MAX reads timing out one after another would hold the pass for minutes); the tick
        // (coldTick) tries again.
        ps.wantStop = true;
        continue;
      }
      // The stub is the one read: only a pass changes it, and this is the pass.
      const t = r.record ? st.thaw(sid, r.record, file, Date.now()) : null;
      if (!t?.ok) {
        const error = String(r.error ?? t?.error ?? "not brought back");
        const was = st.d.sessions[sid].cold?.fault?.error ?? null;
        st.coldFault(sid, error, Date.now());
        this.wantThaw.delete(sid);
        ps.faulted.push({ sid, file, error });
        if (was !== error) {
          this.log(`cold: ${sid8}'s cold/${file} cannot be read (${error}); its events are kept in cold/held/${safeName(sid)}/ `
            + "until Try again, Use without its older items, or Forget (tried again every 10 min)");
        }
        continue;
      }
      this.coldTried.delete(sid);
      ps.thawed.push({ sid, file, items: Number(t.items) || 0, turns: Number(t.turns) || 0, why: retry.has(sid) ? "Try again" : null });
      if ((await this.heldIn(safeName(sid), ps, gen, step)) === null) return false;
    }
    const faulted = (sid) => st.isCold(sid) && Boolean(st.d.sessions[sid]?.cold?.fault);
    for (const list of [ps.replays, ps.own]) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.ev?.type === "cold_retry") continue;   // never held: its read was tried (the store drops it)
        const c = [...st.coldNeeded([e.ev])];
        const own = sidOf(e.ev);
        const f = own && c.includes(own) && faulted(own) ? own : c.find(faulted);
        if (!f) continue;   // cold, not faulted: the next round brings it back
        const r = await this.holdEvent(f, e, gen, step);
        if (!live()) return false;
        if (!r) { this.note = `${e.name} could not be kept in cold/held/${safeName(f)}/; it stays in the spool`; return false; }
        list.splice(i--, 1);
        ps.held.push({ e, sid: f, fresh: r === "new" });
        this.heldSids.add(safeName(f));
        if (r === "new") st.coldFault(f, null, Date.now(), 1);   // held alone: no try
      }
    }
    return true;
  }

  // The events held under cold/held/<folder>/ (heldEvents) into the pass (ps.replays, name order); one whose
  // spool file is in the batch too (a copy made before a save that failed, or a crash before the spool file
  // went) is one event, applied once, and so is the same name in two folders (`also`: its other copies). The
  // list read, [] for a folder already read this pass, or null (given up, or a read got no answer).
  async heldIn(folder, ps, gen, step) {
    if (ps.folders.has(folder)) return [];
    ps.folders.add(folder);
    const got = await this.heldEvents(folder, gen, step);
    if (got === null) return null;
    for (const e of got) {
      const twin = ps.replays.find((x) => x.name === e.name);
      if (twin) { twin.also.push(e.path); continue; }
      const i = ps.own.findIndex((b) => b.name === e.name);
      if (i >= 0) { ps.own.splice(i, 1); e.spool = true; }
      ps.replays.push(e);
      for (const sid of evSessions(e.ev)) ps.sids.add(sid);
    }
    ps.replays.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return got;
  }

  // After the pass's save (store.json holds what it applied, and the held counts). The held copies it replayed go:
  // applied (or dropped by the store, a forgotten session's), or held again under another session (that copy is
  // confirmed); one that threw goes to spool/failed first (the reader's quarantine, with the held copy's path),
  // unless its spool twin is the reader's to keep there (this copy replays and follows it next time). Emptied
  // folders are removed. The sessions brought back leave wantThaw. Sessions still to bring back that this pass
  // did not try (past its COLD_THAW_MAX), or a held folder that may replay now (a Forget or a reset in this pass):
  // a poke (the next round of the reader's loop). One it tried and could not read in time waits for the tick
  // (coldTick), so a host that does not answer reads gets one try a minute, not a loop. False when given up
  // meanwhile (what is left replays later and is skipped as ingested).
  async coldDone(ps, failed, cx, gen, step) {
    const live = () => this.current(gen);
    const threw = new Map(failed.map((f) => [f.name, f]));
    const gone = [];
    for (const e of ps.replays) {
      if (!threw.has(e.name)) { gone.push(e.path, ...e.also); continue; }
      if (e.spool) continue;
      step(`apply: held ${e.name} to spool/failed`);
      const kept = await this.bounded(this.reader.quarantine(e, threw.get(e.name), live), `keeping ${e.name} in spool/failed`).catch(() => false);
      if (!live()) return false;
      if (kept) gone.push(...e.also);
    }
    for (const { e, sid } of ps.held) {
      if (!e.held) continue;
      const keep = `${heldDir(sid)}/${e.name}`;
      gone.push(...[e.path, ...e.also].filter((p) => p !== keep));
    }
    for (const p of gone) {
      step(`apply: held ${base(p)} done`);
      await this.bounded(fs.unlink(p), `removing ${base(p)} from cold/held`).catch(() => {});
      if (!live()) return false;
    }
    for (const folder of ps.folders) {
      step(`apply: held ${folder.slice(0, 8)} done`);
      if (await this.bounded(fs.rmdir(`${coldDir()}/held/${folder}`), "removing a held folder").then(() => true, () => false)) this.heldSids.delete(folder);
      if (!live()) return false;
    }
    for (const t of ps.thawed) this.wantThaw.delete(t.sid);
    const fresh = ps.held.filter((h) => h.fresh);
    if (ps.thawed.length || fresh.length || ps.replays.length) {
      const bits = [];
      if (ps.thawed.length) bits.push(`${ps.thawed.length} session(s) back from cold/ (${ps.thawed.slice(0, 6).map((t) => `${t.sid.slice(0, 8)}: ${t.items} item(s), ${t.turns} turn record(s)${t.why ? `, ${t.why}` : ""}`).join("; ")})`);
      if (ps.replays.length) bits.push(`${ps.replays.length} held event(s) replayed${threw.size ? ` (${ps.replays.filter((e) => threw.has(e.name)).length} threw: spool/failed)` : ""}`);
      if (fresh.length) bits.push(`${fresh.length} event(s) held for ${[...new Set(fresh.map((h) => h.sid.slice(0, 8)))].join(", ")}`);
      this.log(`cold: ${bits.join("; ")}`);
    }
    const st = this.live, faulted = new Set(st.coldFaults().map((f) => safeName(f.sid)));
    // A wanted read that got no answer this pass (ps.wantStop) leaves the other wanted ones to the tick, too.
    const more = ps.more || (!ps.wantStop && [...this.wantThaw].some((sid) => st.isCold(sid) && !st.d.sessions[sid].cold.fault && !ps.tried.has(sid)))
      || [...this.heldSids].some((n) => !faulted.has(n) && !ps.folders.has(n));
    if (more && cx) this.reader.poke(cx);
    return true;
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
      // A cold session (Phase 2) gets no turn record beside its stub: its `asks` event brings it back.
      if (!this.amWriter() || this.live.isCold(sid)) return;
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
  // Cold sessions (Phase 2): from the tick only ({tick: true}), a cold run (coldHouse: freeze, then sweep) is due
  // every COLD_EVERY_MS (coldDue); it goes in the same run, after Phase 1's when both are due, so one run holds
  // the housekeeping at a time (this.house) and the watchdog sees it move (kind "house"). Its result is the
  // tally's `cold` ({cold} alone when Phase 1 was not due).
  houseKick(cx, { tick = false } = {}) {
    const now = Date.now(), why = this.houseDue(now), cold = tick && this.coldDue(now);
    if ((!why && !cold) || !cx?.spawn) return null;
    const gen = this.gen;
    if (why) this.houseTry = now;
    if (cold) this.coldAt = now;
    this.house = { gen, at: now, step: "queued", since: now, why: why ?? "cold" };
    let end = null;
    const run = this.houseRun = new Promise((r) => { end = r; });
    cx.spawn(async (cx) => {
      let tally = null;
      try {
        if (why) tally = await this.housekeep(cx, gen, why);
        if (cold && this.current(gen) && !this.starting) {
          const c = await this.coldHouse(cx, gen);
          tally = tally ? Object.assign(tally, { cold: c }) : { cold: c };
        }
      } catch (e) {
        if (gen === this.gen) { this.note = `housekeeping: ${String(e?.message ?? e)}`; this.log(`housekeeping (${why ?? "cold"}) failed: ${String(e?.message ?? e)}`); }
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

  // ── cold sessions: files, holding, freezing, the sweep (retention Phase 2) ──
  // A session's cold file, read and checked (store.js coldRecordError: the format, the version, the session,
  // its items): {record}; {error} when it is missing, unreadable, unparseable or not this session's (the
  // session is then faulted); {transient} when the read, or the listing that tells missing from unreadable, got
  // no answer within saveTimeout (the pass waits and tries again). fs.readFile: no 1 MiB cap. A name that is
  // not a cold file's (a hand-edited store) is an error, never a path.
  async readCold(sid, file, step = null) {
    const mark = (s) => { try { step?.(s); } catch { /* diagnostics only */ } };
    // A name beginning with "." only as this session's own (one frozen before freezeBlocker refused such ids).
    const m = typeof file === "string" ? COLD_NAME.exec(file) : null;
    if (!m || file.includes("/") || file.includes("\\") || (file.startsWith(".") && m[1] !== safeName(sid))) {
      return { error: `not a cold file name: ${JSON.stringify(file ?? null).slice(0, 80)}` };
    }
    const path = coldPath(file);
    let text;
    try { mark("read"); text = await this.bounded(fs.readFile(path, "utf8"), `reading cold/${file}`); }
    catch (e) {
      // Only a read that got no answer is transient (the pass waits and tries again; coldPhase faults the session
      // after COLD_TIMEOUT_MAX of them in a row). Any other error faults the session, which holds its events and
      // lets every other session's apply (integration, 2026-11-19, second review: a lasting error, a file at mode
      // 000, an I/O error, or a "not found" in words notFound does not know, must not hold the whole spool). A
      // listing tells "missing" from "there but not readable", so the words never invite "Use without its older
      // items" for a file that is there; Try again and the tick's retry read it again.
      if (e?.timedOut) return { transient: String(e.message) };
      const why = String(e?.message ?? e).slice(0, 160);
      let there = null;
      try { mark("listing"); there = await isThere(path, { cx: this.cx, ms: this.saveTimeout }); }
      catch (e2) { if (e2?.timedOut) return { transient: String(e2.message) }; }
      if (there === false) return { error: `cold/${file} is missing` };
      return { error: there ? `cold/${file} is there but could not be read (${why})` : `cold/${file} could not be read (${why})` };
    }
    let record;
    try { record = JSON.parse(text); } catch (e) { return { error: `cold/${file} does not parse (${String(e?.message ?? e).slice(0, 120)})` }; }
    const bad = coldRecordError(record, sid);
    return bad ? { error: `cold/${file}: ${bad}` } : { record };
  }

  // Event b (a spool file's {name, ev, text}, or a replayed held one) kept under cold/held/<safe sid>/<its own
  // name>: created (spool.js writeNew, create-only), read back. "new"; "same" when the copy is there already with
  // the same text (made before a save that failed, or b is that copy); false when it could not be made (the pass
  // stops, the spool keeps the file). A copy there that is not the event and does not parse was never confirmed
  // (its spool file still exists): removed and written again, once. Each await limited, a step `apply: hold <name>`.
  async holdEvent(sid, b, gen = this.gen, mark = null) {
    const ok = () => this.current(gen);
    const step = (s) => { try { mark?.(s); } catch { /* diagnostics only */ } };
    const folder = safeName(sid), dir = heldDir(sid), path = `${dir}/${b?.name}`;
    if (b?.held && b.path === path) return "same";
    if (!isEventName(b?.name) || typeof b.text !== "string") return false;
    step(`apply: hold ${b.name}`);
    await this.bounded(fs.mkdir(dir, { recursive: true }), `making cold/held/${folder}`).catch(() => {});
    if (!ok()) return false;
    for (let i = 0; i < 2; i++) {
      const err = await writeNew(path, b.text, { cx: this.cx, ms: this.saveTimeout, ok, drop: true, step: (s) => step(`apply: hold ${b.name}: ${s}`) });
      if (!ok()) return false;
      if (!err) return "new";
      const cur = await this.bounded(fs.readFile(path, "utf8"), `reading cold/held/${folder}/${b.name}`).catch(() => null);
      if (!ok()) return false;
      if (cur === b.text) return "same";
      let parses = false;
      try { JSON.parse(cur); parses = true; } catch { /* a broken copy */ }
      if (cur === null || parses || i) { this.note = `${b.name} not kept in cold/held/${folder}/: ${err}`; return false; }
      step(`apply: hold ${b.name}: removing a broken copy`);
      await this.bounded(fs.unlink(path), `removing cold/held/${folder}/${b.name}`).catch(() => {});
      if (!ok()) return false;
    }
    return false;
  }

  // The events held for a session (its id, or its folder's safe name: safeName keeps a safe name as it is), in
  // name order: [{name, ev, text, held: true, path, folder, also: []}]; [] for no folder; null when given up or
  // a read got no answer. Each read is a step `apply: held <name>`. A file that does not parse is skipped and
  // kept (heldSkip; writer.log says so once); a folder with nothing to replay leaves heldSids.
  async heldEvents(sid, gen = this.gen, mark = null) {
    const step = (s) => { try { mark?.(s); } catch { /* diagnostics only */ } };
    const folder = safeName(sid), dir = `${coldDir()}/held/${folder}`;
    step(`apply: held ${folder.slice(0, 8)}`);
    let names;
    try { names = await this.bounded(fs.readdir(dir), `listing cold/held/${folder}`); }
    catch (e) { if (!this.current(gen) || e?.timedOut) return null; this.heldSids.delete(folder); return []; }
    if (!this.current(gen)) return null;
    const out = [];
    for (const name of names.map(base).filter(isEventName).sort()) {
      if (this.heldSkip.has(`${folder}/${name}`)) continue;
      const path = `${dir}/${name}`;
      step(`apply: held ${name}`);
      let text;
      try { text = await this.bounded(fs.readFile(path, "utf8"), `reading cold/held/${folder}/${name}`); }
      catch (e) { if (!this.current(gen) || e?.timedOut) return null; continue; }   // gone meanwhile
      if (!this.current(gen)) return null;
      let ev = null;
      try { ev = JSON.parse(text); } catch { /* below */ }
      if (!ev || typeof ev !== "object" || Array.isArray(ev)) {
        this.heldSkip.add(`${folder}/${name}`);
        this.log(`cold: cold/held/${folder}/${name} does not parse; kept there, not replayed`);
        continue;
      }
      out.push({ name, ev, text, held: true, path, folder, also: [] });
    }
    if (!out.length) this.heldSids.delete(folder);
    return out;
  }

  // The folders under cold/held/ (heldSids): at start and in each cold run. True when listed (none: an empty set);
  // false when the listing got no answer (the last known stays) or this generation was given up.
  async listHeld(gen = this.gen) {
    let names;
    try { names = await this.bounded(fs.readdir(`${coldDir()}/held`), "listing cold/held"); }
    catch (e) { if (e?.timedOut || !this.current(gen)) return false; names = []; }
    if (!this.current(gen)) return false;
    // Hidden entries (.DS_Store and the like) are skipped, but not a known session's folder (an id beginning with
    // "." frozen before freezeBlocker refused it: its held events must still replay).
    const known = new Set([...Object.keys(this.live.d.sessions), ...Object.keys(this.live.d.forgotten)].map(safeName));
    this.heldSids = new Set(names.map(base).filter((n) => n && (!n.startsWith(".") || known.has(n))));
    return true;
  }

  // The writer's own reasons a session stays warm (store.js planFreeze and commitFreeze ask, with the store's):
  // an agent in a live pane mapped to it (terminals() lists its terminal live, and the store maps that terminal
  // to it); the open detail dialog shows it (shared("ledgr.detail").open: its typed answer lives in that copy);
  // the running pass names it (passSids); or it is to be brought back (wantThaw). And none while
  // retention.coldDays is 0 in the config in hand: asked again at the commit, so a run planned before Settings
  // "never" or install.sh --thaw-all wrote 0 commits nothing (its files are removed at once), and --thaw-all's
  // "no cold sessions" stays true.
  canFreeze(sid) {
    if (coldDaysOf(this.cfg) === 0) return false;
    if (this.passSids.has(sid) || this.wantThaw.has(sid)) return false;
    const open = shared("ledgr.detail")?.open;
    if (open && typeof open === "object" && open.session === sid) return false;
    const s = this.live.d.sessions[sid], t = s?.terminal;
    if (t && this.live.d.terminals[t]?.sessionId === sid) {
      const k = (terminals() ?? []).find((x) => x?.address === t);
      if (k && (!k.state || k.state === "live")) return false;
    }
    return true;
  }

  // Due from the tick (houseKick): the holder, no run of this generation going, not starting, Phase 1's first run
  // done (d.retention v 1), and none begun for COLD_EVERY_MS (in memory: after a relaunch the first tick runs one).
  coldDue(now = Date.now()) {
    if (this.retired || !this.amWriter() || this.starting || (this.house && this.house.gen === this.gen)) return false;
    if (this.live.d.retention?.v !== 1) return false;
    return now - this.coldAt >= COLD_EVERY_MS;
  }

  // The tick's cold run (houseKick, after Phase 1's when both are due): cold/held listed again, a freeze run,
  // the sweep. {freeze, sweep}, or null when given up.
  async coldHouse(cx, gen) {
    if (cx) this.cx = cx;
    this.houseStep(gen, "cold/held listing");
    await this.listHeld(gen);
    if (!this.current(gen) || this.starting) return null;
    const freeze = await this.freezeRun(gen);
    if (!this.current(gen)) return null;
    const sweep = await this.coldSweep(gen);
    if (!this.current(gen)) return null;
    return { freeze, sweep };
  }

  // A freeze run (coldHouse, from the tick's housekeeping only; never in a start, never in a pass, and it never
  // holds a pass back: drains apply meanwhile). Skipped while starting, with retention.coldDays 0, before Phase 1's
  // first run, and on a config.json not read as it is (its defaults could freeze where the person said never).
  // 1. The plan, synchronously (store.js planFreeze: idle past coldDays, the store's rules and canFreeze, oldest
  //    idle first, at most COLD_RUN_MAX). 2. cold/ made. 3. Per session, none begun after COLD_RUN_MS: its file
  //    cold/<safe sid>.<ms>-<rand6>.json written once (spool.js writeNew: create-only, or past the cap fs.writeFile
  //    to that new name; read back; a file not confirmed removed). 4. Synchronously, right after the last await
  //    and still this generation's (config.json read again just before: coldDays 0 meanwhile commits nothing):
  //    store.js commitFreeze checks each session again (rules, canFreeze, and its
  //    items and turn records serialized as planned: a drain that applied an event meanwhile keeps it warm) and
  //    only then takes them out and names the file; the files not committed are removed. 5. Saved.
  // Abandoned at any await: nothing names a file before step 4, so a file that landed (or lands late) is an
  // orphan the sweep deletes only once a read finds an identical copy of all of it (coldSweep); after step 4
  // the commit lives in a store the restart does not use (it reads store.json, where the sessions are warm). A
  // save that fails leaves memory ahead of disk, and the next save writes the stubs. Returns its tally, or null
  // when given up.
  async freezeRun(gen) {
    const ok = () => this.current(gen);
    const step = (s) => this.houseStep(gen, s);
    if (!ok() || this.starting) return null;
    const days = coldDaysOf(this.cfg);
    const cfgOk = this.cfg?._source === "file" || (this.cfg?._source === "defaults" && !this.cfg?._error);
    if (!days || !cfgOk || this.live.d.retention?.v !== 1) return { skipped: !days ? "coldDays 0" : !cfgOk ? "config.json not read" : "retention not run yet" };
    const canFreeze = (sid) => this.canFreeze(sid);
    step("freeze: plan");
    const plan = this.live.planFreeze(days, Date.now(), { canFreeze, max: COLD_RUN_MAX });
    const t = { planned: plan.length, frozen: [], files: 0, bytes: 0, largest: 0, failed: [], removed: 0, left: 0, saved: false, before: this.storeText?.length ?? 0 };
    if (!plan.length) return t;
    step("freeze: making cold/");
    await this.bounded(fs.mkdir(coldDir(), { recursive: true }), "making cold/").catch(() => {});
    if (!ok()) return null;
    const begun = Date.now(), written = [];
    for (const p of plan) {
      if (Date.now() - begun > COLD_RUN_MS) { t.left = plan.length - written.length - t.failed.length; break; }
      const file = coldName(p.sid, p.record.at, rand6()), text = JSON.stringify(p.record), sid8 = String(p.sid).slice(0, 8);
      step(`freeze ${sid8}`);
      const err = await writeNew(coldPath(file), text, { cx: this.cx, ms: this.saveTimeout, ok, drop: true, step: (s) => step(`freeze ${sid8}: ${s}`) });
      if (!ok()) return null;   // a file that landed is an unreferenced orphan (the sweep's)
      if (err) { t.failed.push(`${file}: ${err}`); continue; }
      written.push({ ...p, file });
      const n = byteLength(text);
      t.files += 1; t.bytes += n; t.largest = Math.max(t.largest, n);
    }
    // config.json read again before the commit (D, install.sh --thaw-all): a coldDays 0 written while the files were
    // written makes canFreeze say no, so nothing commits after --thaw-all saw no cold session. A read that fails
    // keeps the config in hand.
    if (written.length) {
      step("freeze: config.json");
      const cfg = await this.bounded(loadConfig(), "reading config.json").catch(() => null);
      if (!ok()) return null;
      if (cfg && !cfg._error) this.applyConfig(cfg);
    }
    // Nothing awaited since the last ok(): the commit is this generation's, on the store the plan was made from.
    t.frozen = this.live.commitFreeze(written, Date.now(), { canFreeze }) ?? [];
    for (const w of written.filter((x) => !t.frozen.includes(x.sid))) {
      step(`freeze: removing ${w.file}`);
      await this.bounded(fs.unlink(coldPath(w.file)), `removing cold/${w.file}`).then(() => { t.removed += 1; }, () => {});
      if (!ok()) return null;
    }
    if (t.frozen.length) {
      step("save");
      t.saved = await this.saveStore();
      if (!ok()) return null;
    }
    if (t.files || t.failed.length) {
      this.log(`cold: ${t.frozen.length} session(s) moved out of store.json into cold/ (${t.files} file(s), ${t.bytes} bytes, the largest ${t.largest}); `
        + `store.json ${t.before} -> ${this.storeText?.length ?? "?"} characters${t.saved || !t.frozen.length ? "" : " (not saved yet)"}`
        + `${t.removed ? `; ${t.removed} changed meanwhile, kept warm, their files removed` : ""}${t.left ? `; ${t.left} left for the next run (${COLD_RUN_MS / 1000} s)` : ""}`
        + `${t.failed.length ? `; ${t.failed.length} file(s) not written, those sessions stay (${t.failed[0]})` : ""}`);
    }
    return t;
  }

  // The sweep (coldHouse, after the freeze). cold/ listed. Memory ahead of disk (a thaw or a freeze not saved, or
  // simply the chips' diag, which publish() adds after every pass's save): saved first, and decided only if memory
  // is still the text written (a save that failed, or a pass that changed memory meanwhile: no sweep this run).
  // Then (integration, 2026-11-19: a cold file goes only when it is provably redundant; store.json can go back in
  // time, a corrupt one set aside or one restored from a copy, and an unnamed file may then hold the only copy):
  // 1. By name, synchronously (store.js coldGarbage): a file its session's record lists as thawed, COLD_GRACE_MS
  //    after the thaw; a forgotten session's, COLD_KEEP_MS after the Forget. Each removed (limited); the thawed
  //    lists then trimmed (trimThawed).
  // 2. By content, at most COLD_CHECK_MAX a run (store.js coldUnproven: any other unnamed file of one recorded
  //    session that is not faulted, written over COLD_KEEP_MS ago, oldest first): the file read and checked
  //    (readCold), then compared with store.json as on disk (storeText), the session's named cold file and its
  //    Phase 1 archive files (store.js coldLacks); removed only when nothing in it is missing there. A file that
  //    cannot be read, or holds items or turn records store.json lacks, stays for good ("recoverable": writer.log
  //    says so once, ./install.sh --check lists it; Retention.md 10.8 says how to bring it back).
  // cold/held/ is never swept. `now` for the tests. Returns {removed, kept, skipped?}, or null when given up.
  async coldSweep(gen, now = null) {
    const ok = () => this.current(gen);
    const step = (s) => this.houseStep(gen, s);
    step("cold sweep");
    let names;
    try { names = await this.bounded(fs.readdir(coldDir()), "listing cold/"); }
    catch { return ok() ? { removed: [], kept: [], skipped: "no cold/" } : null; }
    if (!ok()) return null;
    const t = { removed: [], kept: [] };
    // store.json read again first (integration, 2026-11-19, second review): storeText is the text this writer last
    // read or wrote; a store.json replaced by hand while Herdr runs is not it. Then nothing is saved or decided this
    // run (a save first would write memory over it, and memory is not what the person put there).
    step("cold sweep: store.json");
    const onDisk = this.storeText === null ? null : await this.bounded(fs.readFile(storePath(), "utf8"), "reading store.json").catch(() => null);
    if (!ok()) return null;
    if (onDisk === null || onDisk !== this.storeText) {
      t.skipped = "store.json on disk is not the store this writer last read or wrote";
      this.note = `cold sweep: nothing removed this run (${t.skipped}); tried again at the next`;
      if (!this.sweepSaid) { this.sweepSaid = true; this.log(`cold sweep: nothing removed: ${t.skipped}`); }
      return t;
    }
    this.sweepSaid = false;
    if (this.live.toText() !== this.storeText) {
      step("save");
      await this.saveStore();
      if (!ok()) return null;
    }
    // From here to the decision nothing awaits.
    if (this.live.toText() !== this.storeText) { t.skipped = "the store in memory is not store.json"; return t; }
    const at = now ?? Date.now();
    const listed = names.map(base).filter((n) => COLD_NAME.test(n));
    const del = this.live.coldGarbage(listed, at, { graceMs: COLD_GRACE_MS, keepMs: COLD_KEEP_MS }) ?? [];
    const unproven = (this.live.coldUnproven(listed, at, { keepMs: COLD_KEEP_MS }) ?? []).filter((c) => !this.coldKept.has(c.name)).slice(0, COLD_CHECK_MAX);
    const diskText = this.storeText;
    const named = (name) => Object.values(this.live.d.sessions).some((s) => s?.cold?.file === name || s?.coldLost?.file === name);
    for (const name of del) {
      if (named(name)) continue;
      step(`cold sweep ${name}`);
      await this.bounded(fs.unlink(coldPath(name)), `removing cold/${name}`).then(() => t.removed.push(name), () => {});
      if (!ok()) return null;
    }
    // 2. By content. Compared with store.json as read from disk when this run decided (diskText), never with the
    // live store, which a pass may change during the reads: what a later save adds only makes a file more
    // redundant, and a file no record names is never named again (a freeze makes a new name). Each item and turn
    // record of the file must be found as it is (or, for an item, in a later version) in that store, the session's
    // named cold file or its archive (store.js coldLacks).
    let disk = null;
    for (const c of unproven) {
      if (named(c.name)) continue;
      step(`cold sweep: reading ${c.name}`);
      const r = await this.readCold(c.sid, c.name, (s) => step(`cold sweep: reading ${c.name} ${s}`));
      if (!ok()) return null;
      if (r.transient) continue;                       // tried again next run
      if (!r.record) { this.keepCold(c, { error: r.error }); t.kept.push(c.name); continue; }
      try { disk ??= Store.fromText(diskText); } catch { break; }
      const also = { copies: new Map(), turnCopies: new Map(), heads: new Map() };
      const ds = disk.d.sessions[c.sid];
      if (!ds) continue;                                // not in store.json on disk yet: next run
      if (ds.cold?.file && ds.cold.file !== c.name) {
        step(`cold sweep: reading ${ds.cold.file}`);
        const rn = await this.readCold(c.sid, ds.cold.file, (s) => step(`cold sweep: reading ${ds.cold.file} ${s}`));
        if (!ok()) return null;
        if (!rn.record) continue;                      // its own file not readable now: nothing proven
        for (const it of rn.record.items) pushTo(also.copies, it.id, it);
        for (const [k, rec] of Object.entries(rn.record.turns ?? {})) pushTo(also.turnCopies, k, rec);
      }
      let lack = disk.coldLacks(c.sid, r.record, also);
      if (lack.items || lack.turns) {
        const arch = await this.archiveCopies(c.sid, gen, step);
        if (arch === null) { if (!ok()) return null; continue; }
        for (const [id, list] of arch.copies) for (const x of list) pushTo(also.copies, id, x);
        for (const [k, list] of arch.turnCopies) for (const x of list) pushTo(also.turnCopies, k, x);
        for (const [k, h] of arch.heads) also.heads.set(k, h);
        lack = disk.coldLacks(c.sid, r.record, also);
      }
      if (lack.items || lack.turns) { this.keepCold(c, lack); t.kept.push(c.name); continue; }
      // Named meanwhile? Nothing names an unnamed file again today (a freeze makes a new name); checked all the same.
      if (named(c.name)) continue;
      step(`cold sweep ${c.name}`);
      await this.bounded(fs.unlink(coldPath(c.name)), `removing cold/${c.name}`).then(() => t.removed.push(c.name), () => {});
      if (!ok()) return null;
    }
    const left = listed.filter((n) => !t.removed.includes(n));
    if (this.live.trimThawed(left, at, { keepMs: COLD_KEEP_MS })) this.commit(this.cx);
    if (t.removed.length) this.log(`cold sweep: ${t.removed.length} file(s) no session needs removed from cold/ (${t.removed.slice(0, 4).join(", ")}${t.removed.length > 4 ? ", …" : ""})`);
    return t;
  }

  // A cold file the sweep keeps for good (it cannot be read, or holds what store.json lacks): remembered for this
  // writer's life (not read again each hour) and said once in writer.log.
  keepCold(c, why) {
    if (this.coldKept.has(c.name)) return;
    this.coldKept.set(c.name, { sid: c.sid, ...why });
    this.log(why.error
      ? `cold sweep: cold/${c.name} could not be read (${why.error}): kept, never deleted`
      : `cold sweep: cold/${c.name} holds ${why.items} item(s) and ${why.turns} turn record(s) store.json lacks (session ${String(c.sid).slice(0, 8)}): `
        + "kept, never deleted; ./install.sh --check lists it, and Retention.md 10.8 says how to bring it back");
  }

  // A session's Phase 1 archive as the sweep's proof needs it (archive/<safe sid>/): its items files' lines by id,
  // its turns files' cut records and moved heads by turn, each line only when it names this session (as Phase 1's
  // reading rule does). Each read bounded and a step. null when a listing or a read got no answer or was given up.
  async archiveCopies(sid, gen, step) {
    const dir = archiveDir(sid), out = { copies: new Map(), turnCopies: new Map(), heads: new Map() };
    if (!dir) return out;
    let names;
    try { names = await this.bounded(fs.readdir(`${dataDir()}/archive/${dir}`), "listing archive/"); }
    catch (e) { return !this.current(gen) || e?.timedOut ? null : out; }
    if (!this.current(gen)) return null;
    for (const n of names.map(base).filter((x) => ARCHIVE_ITEMS.test(x) || ARCHIVE_TURNS.test(x))) {
      step(`cold sweep: archive ${n}`);
      let text;
      try { text = await this.bounded(fs.readFile(`${dataDir()}/archive/${dir}/${n}`, "utf8"), `reading archive/${n}`); }
      catch { return null; }
      if (!this.current(gen)) return null;
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let r = null;
        try { r = JSON.parse(line); } catch { continue; }    // a bad line proves nothing
        if (!r || typeof r !== "object") continue;
        if (ARCHIVE_ITEMS.test(n)) { if (typeof r.id === "string" && r.anchor?.sessionId === sid) pushTo(out.copies, r.id, r); continue; }
        if (r.sessionId !== sid || r.turn === undefined || r.turn === null) continue;
        if (r.rec && typeof r.rec === "object") pushTo(out.turnCopies, String(r.turn), r.rec);
        else if (typeof r.textHead === "string") out.heads.set(String(r.turn), r.textHead);
      }
    }
    return out;
  }

  // From the tick before its drain, and the start before its first: what the next pass has to do with no event
  // asking (wantThaw): with retention.coldDays 0 every cold session not faulted (thawAll), a faulted one whose
  // retry is due (COLD_RETRY_MS since it was last tried), a "mixed" one (store.js mixedCold: an older build added
  // items beside its stub; not faulted). True when that pass is wanted (the caller pokes): wantThaw not empty, or
  // a held folder whose session is not faulted (back, reset, forgotten) waits to replay.
  coldTick(cx, gen = this.gen) {
    if (!this.current(gen)) return false;
    const st = this.live, now = Date.now();
    for (const sid of [...this.wantThaw]) if (!st.isCold(sid)) this.wantThaw.delete(sid);
    if (coldDaysOf(this.cfg) === 0) this.thawAll();
    const faults = st.coldFaults();
    for (const f of faults) if (now - (this.coldTried.get(f.sid) ?? (Number(f.at) || 0)) >= COLD_RETRY_MS) this.wantThaw.add(f.sid);
    for (const sid of st.mixedCold()) if (!st.d.sessions[sid]?.cold?.fault) this.wantThaw.add(sid);
    const faulted = new Set(faults.map((f) => safeName(f.sid)));
    return this.wantThaw.size > 0 || [...this.heldSids].some((n) => !faulted.has(n));
  }

  // retention.coldDays 0 (Settings "never", install.sh --thaw-all): every cold session the writer can read comes
  // back (wantThaw); a faulted one's retry brings it. True when one was added.
  thawAll() {
    let added = false;
    for (const sid of this.live.coldSessions()) {
      if (this.live.d.sessions[sid]?.cold?.fault || this.wantThaw.has(sid)) continue;
      this.wantThaw.add(sid);
      added = true;
    }
    return added;
  }

  // The host's 60 s timer: a back-off first (cooling), then the watchdog (a pass or a start stuck in one
  // step: restarted, nothing else this tick), then the safety rescan (a poke when there is cold work: coldTick),
  // the waiting check, the heartbeat (the
  // claim renewed with the writer's health and its pass), deferred items waking, config.json and every
  // identity-map record read again (the safety net for watchConfig), housekeeping when due (its own task,
  // houseKick; the cold run from here only). After each await nothing more unless this tick's generation is still the writer's. A host
  // that does not hold the role checks instead that the holder is alive (probe).
  tick(cx) {
    this.cx = cx;
    if (this.cooling(cx)) return;
    if (this.watchdog(cx)) return;
    if (!this.amWriter()) { this.probe(cx); return; }
    const gen = this.gen;
    cx.spawn(async (cx) => {
      // Cold sessions (Phase 2): a pass even with nothing in the spool when there is cold work (coldTick).
      await (this.coldTick(cx, gen) ? this.reader.poke(cx) : this.reader.drain(cx));
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
      this.houseKick(cx, { tick: true });
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
      // A cold session (Phase 2) is not tracked: its items are in its file. A status turn of a hookless one is
      // not counted until an event brings it back (an agent in a live pane keeps its session warm: canFreeze).
      if (!s.terminal || s.cold) continue;
      const now = live.get(s.terminal) ?? null, prev = this.lastStatus.get(s.terminal);
      this.lastStatus.set(s.terminal, now);
      if (s.turnSource === "herdr-status") {
        if (now && now !== prev && this.live.d.terminals[s.terminal]?.sessionId === s.sessionId) {
          this.pendingStatus.push([s.sessionId, now]);
          if (this.pendingStatus.length === 1) cx.timer.after(0, (cx) => {
            const list = this.pendingStatus.splice(0).filter(([sid]) => !this.live.isCold(sid));
            if (list.map(([sid, st]) => this.live.statusTurn(sid, st)).some(Boolean)) this.commit(cx);
          });
        }
        continue;
      }
      if (prev === "working" && (now === "idle" || now === "done") && s.state === "working") {
        const sid = s.sessionId;
        cx.timer.after(6000, (cx) => {
          if (!this.amWriter() || this.live.d.sessions[sid]?.state !== "working" || this.live.isCold(sid)) return;
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
