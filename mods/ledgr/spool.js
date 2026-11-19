// ledgr spool: the hooks (and the capture box) drop one JSON event per file into
// ledgr-data/spool/<ms>-<type>-<pid>-<rand>.json; the panel copy (single writer) reads them
// in name order, applies them, then unlinks each file (spec 2.5, 3.3). Dotfiles are writes
// in progress; `bad-*` files are events that never parsed; spool/failed/ holds the events whose
// apply threw (quarantine, 2026-11-12), each with its error beside it. Also reads the identity map
// (ledgr-data/terminals/<t>.json, spec 2.5, 2.8).
// A drain is one pass (2026-11-19): `pass` names the step it is in and since when, which the writer's
// watchdog reads (writer.js PASS_STUCK_MS); abandon() gives a pass up, and an abandoned pass changes
// nothing more, whenever its await settles, if ever.
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { readTextFile, writeTextFile } from "herdr";
import { LIMITS, spoolDir, terminalsDir, terminalFile } from "./config.js";

const base = (p) => String(p).split("/").pop();
const isEvent = (n) => n.endsWith(".json") && !n.startsWith(".") && !n.startsWith("bad-");

// "20 s", "0.5 s", "4 min", "3 h 12 min": a wait as the status line and writer.log say it.
export function spanWords(ms) {
  const s = Math.max(0, Number(ms) || 0) / 1000;
  if (s < 10) return `${Math.round(s * 10) / 10} s`;
  if (s < 120) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  return m < 120 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

// Resolves or rejects as p does, or rejects first once ms pass (an Error with timedOut: true, "<what>: no
// answer in 20 s"). For the awaits that wait on the host with no limit of their own: Herdr leaves a
// cancelled task's promise pending for ever (gpui-kit.d.ts Task), and on 2026-11-19 one await of the
// writer's never settled. The guarded await may still settle later; each caller makes what it would do
// then harmless (a unique temporary file, a compare-and-swap write, the writer's generation). The limit is
// a cx.timer task, cancelled once p settles; without a timer (cx null, or one that gives no task), p alone.
export function within(cx, ms, p, what) {
  let task = null, fire = null;
  const limit = new Promise((_, reject) => { fire = reject; });
  try {
    task = cx?.timer?.after?.(ms, () => {
      const e = new Error(`${what}: no answer in ${spanWords(ms)}`);
      e.timedOut = true;
      fire(e);
    }) ?? null;
  } catch { task = null; }   // a cx whose build was reloaded throws: no limit, the watchdog is the backstop
  if (!task) return Promise.resolve(p);
  return Promise.race([Promise.resolve(p), limit]).finally(() => { try { task.cancel?.(); } catch { /* done */ } });
}

// Herdr's readTextFile and writeTextFile refuse a file over 1 MiB ("Text file exceeds 1 MiB"; probed
// 2026-11-12: 1,048,576 bytes written, 1,048,577 refused). store.json passed it on 2026-11-12 (nine asks
// on a store of 1,041,470 bytes), and every save after that failed, so the spool stopped draining.
export const TEXT_FILE_MAX = 1048576;

// True when text is over max bytes as UTF-8. Cheap for the common cases: a UTF-16 unit is one to three
// bytes (a surrogate pair is four for two units), so only the non-ASCII units are counted.
export function overCap(text, max = TEXT_FILE_MAX) {
  if (text === null || text === undefined) return false;
  const s = String(text);
  if (s.length > max) return true;
  if (s.length * 3 <= max) return false;
  let n = s.length;
  for (const ch of s.match(/[^\x00-\x7f]/g) ?? []) {
    const c = ch.charCodeAt(0);
    n += c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 1 : 2;
  }
  return n > max;
}

// Events whose apply threw: spool/failed/<name>, with <name without .json>.error.txt beside it.
export const failedDir = () => `${spoolDir()}/failed`;

// How many events spool/failed holds (the person removes them once read, or moves one back to apply it).
export async function countFailed() {
  try { return (await fs.readdir(failedDir())).map(base).filter((n) => n.endsWith(".json") && !n.startsWith(".")).length; }
  catch { return 0; }
}

function failedText(b, f, at = Date.now()) {
  const ev = b.ev ?? {};
  return [
    "ledgr writer: this spool event threw while it was applied, so it was moved here and the writer went on",
    "with the next one. The store holds nothing of it (the batch was applied again without it).",
    "",
    `event:   ${b.name}`,
    `type:    ${ev.type ?? "?"}    id: ${ev.id ?? "?"}    session: ${ev.session_id ?? ev.session ?? "?"}    turn: ${ev.turn ?? "?"}`,
    `failed:  ${new Date(at).toISOString()}`,
    `error:   ${f.error}`,
    "",
    f.stack || "(no stack)",
    "",
    `To apply it again once fixed: move ${b.name} back to ledgr-data/spool/ and delete this file.`,
    "",
  ].join("\n");
}

// Event file names in order, or null when the spool folder does not exist yet.
export async function listSpool() {
  let names;
  try { names = await fs.readdir(spoolDir()); } catch { return null; }
  return names.map(base).filter(isEvent).sort();
}

export class SpoolReader {
  // apply(batch: {name, ev, text}[], cx, pass) -> Promise of false (not the writer: leave every file),
  // true (all applied), or {failed: [{name, error, stack}]} (those threw and were left out; the rest
  // applied). Called with parsed events in name order. onFailed(): an event was moved to spool/failed.
  // ok(): may this copy still unlink (the writer's amWriter); checked before every unlink. onDone(): a
  // pass ended (not an abandoned one).
  constructor(apply, onFailed = null, ok = () => true, onDone = null) {
    this.apply = apply;
    this.onFailed = onFailed;
    this.ok = ok;
    this.onDone = onDone;
    this.retries = new Map();
    this.running = false;
    this.again = false;
    this.missing = null;   // true while ledgr-data/spool does not exist
    this.lastRun = 0;
    this.applied = 0;      // events applied since start
    this.failed = 0;       // events in spool/failed (countFailed at start and every tick, +1 per quarantine)
    this.skip = new Set(); // failed events that could not be copied to spool/failed: left in place, not read again
    this.errors = [];
    this.epoch = 0;        // abandon() moves it on: a pass of an older epoch changes nothing more
    this.pass = null;      // the running pass: {epoch, at (its start), step, since (the step's start)}
    this.done = 0;         // when the last pass ended (ms): the writer's progress
    this.abandoned = 0;    // passes given up since start
  }

  // The running pass is about to wait in step s (one await, or one short loop of them).
  step(pass, s) {
    if (pass && pass === this.pass) { pass.step = s; pass.since = Date.now(); }
  }

  // The writer's watchdog gave up on the running pass (writer.js unstick, or a new start): whatever it
  // waits on may never settle, or may settle later; either way it reads, applies, saves and unlinks
  // nothing more (every step checks its epoch), and the next drain starts a fresh pass at once.
  abandon() {
    const p = this.pass;
    this.epoch += 1;
    this.running = false;
    this.again = false;
    this.pass = null;
    if (p) this.abandoned += 1;
    return p;
  }

  // Reads every event file, applies the parsed ones, unlinks them. Re-entrant calls while
  // a pass runs ask for one more pass. A file that does not parse is retried up to 5 times,
  // 300 ms apart, then kept aside as spool/bad-<name>. An event whose apply threw goes to
  // spool/failed (quarantine) and the files after it apply as usual. Each await is a step of
  // `pass`; after each one an abandoned pass returns at once, leaving `running` to the pass after it.
  async drain(cx) {
    if (this.running) { this.again = true; return; }
    this.running = true;
    const now = Date.now();
    const pass = this.pass = { epoch: this.epoch, at: now, step: "list", since: now };
    const mine = () => pass.epoch === this.epoch;
    let retryLater = false;
    try {
      do {
        this.again = false;
        this.step(pass, "list");
        const names = await listSpool();
        if (!mine()) return;
        this.missing = names === null;
        if (!names) break;
        const batch = [];
        this.step(pass, "read");
        for (const name of names.filter((n) => !this.skip.has(n)).slice(0, 500)) {
          const path = `${spoolDir()}/${name}`;
          const text = await readTextFile(path).catch(() => null);
          if (!mine()) return;
          if (text === null) continue;
          let ev;
          try { ev = JSON.parse(text); }
          catch {
            const n = (this.retries.get(name) ?? 0) + 1;
            this.retries.set(name, n);
            if (n > LIMITS.parseRetries) {
              this.retries.delete(name);
              await writeTextFile(`${spoolDir()}/bad-${name}`, text, null).catch(() => {});
              if (!mine()) return;
              await fs.unlink(path).catch(() => {});
              this.errors.push(`unparseable spool file kept as bad-${name}`);
            } else retryLater = true;
            continue;
          }
          this.retries.delete(name);
          batch.push({ name, ev, text });
        }
        if (batch.length) {
          // false: this copy is not the writer, or store.json was not written; leave the files.
          this.step(pass, "apply");
          const r = await this.apply(batch, cx, pass);
          if (!mine()) return;
          if (r === false) break;
          const failed = new Map((Array.isArray(r?.failed) ? r.failed : []).map((f) => [f.name, f]));
          this.step(pass, "unlink");
          let gone = 0, lost = false;
          for (const b of batch) {
            // The role went elsewhere: the files left are the next writer's (its store.json holds them).
            if (!this.ok()) { lost = true; break; }
            if (failed.has(b.name)) await this.quarantine(b, failed.get(b.name), mine);
            else { await fs.unlink(`${spoolDir()}/${b.name}`).catch(() => {}); gone++; }
            if (!mine()) return;
          }
          this.applied += gone;
          if (lost) break;
        }
        if (names.length > 500) this.again = true;
      } while (this.again);
    } catch (e) {
      if (mine()) this.errors.push(String(e?.message ?? e));
    } finally {
      if (mine()) {
        this.running = false;
        this.pass = null;
        this.done = this.lastRun = Date.now();
        if (this.errors.length > 20) this.errors.splice(0, this.errors.length - 20);
        try { this.onDone?.(); } catch { /* health only */ }
      }
    }
    if (retryLater && mine()) cx.timer.after(300, (cx) => this.drain(cx));
  }

  // An event whose apply threw: copied to spool/failed/<name> with the error and stack in
  // <name without .json>.error.txt, and only then unlinked (the writer never loses an event). A copy
  // that cannot be made leaves the file where it is, skipped by this copy until it restarts.
  // mine(): false once the pass was abandoned (nothing more is written or unlinked).
  async quarantine(b, f, mine = () => true) {
    const dir = failedDir(), path = `${dir}/${b.name}`;
    await fs.mkdir(dir, { recursive: true }).catch(() => {});
    if (!mine()) return false;
    let kept;
    try { await writeTextFile(path, b.text, null); kept = true; }
    catch { kept = (await readTextFile(path).catch(() => null)) === b.text; }   // there already, the same
    if (!mine()) return false;
    if (!kept) {
      this.skip.add(b.name);
      this.errors.push(`spool event ${b.name} failed (${f.error}) and could not be kept in spool/failed: left in the spool, not applied`);
      return false;
    }
    await writeAtomic(`${dir}/${b.name.replace(/\.json$/, "")}.error.txt`, failedText(b, f));
    if (!mine()) return false;
    await fs.unlink(`${spoolDir()}/${b.name}`).catch(() => {});
    this.failed += 1;
    this.errors.push(`spool event ${b.name} failed (${f.error}); kept as spool/failed/${b.name}`);
    try { this.onFailed?.(b, f); } catch { /* health only */ }
    return true;
  }
}

// Every identity-map record (ledgr-data/terminals/*.json). Unreadable files are skipped.
export async function readMap() {
  let names;
  try { names = await fs.readdir(terminalsDir()); } catch { return []; }
  const out = [];
  for (const n of names.map(base)) {
    if (!n.endsWith(".json") || n.startsWith(".")) continue;
    const text = await readTextFile(`${terminalsDir()}/${n}`).catch(() => null);
    try { const r = JSON.parse(text); if (r && r.session_id && r.terminal) out.push(r); } catch { /* in progress or broken */ }
  }
  return out.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
}

export async function readMapFor(terminal) {
  if (!terminal) return null;
  const text = await readTextFile(terminalFile(terminal)).catch(() => null);
  try { const r = JSON.parse(text); return r?.session_id ? r : null; } catch { return null; }
}

// Writes one event the way the hooks do (spec 2.5 envelope). The mod has no rename, so it
// writes the final name directly; the reader treats a parse failure as "not finished yet".
// Creates ledgr-data/spool/ when the hooks have not run yet (capture works without hooks).
export async function writeEvent(type, payload) {
  const at = Date.now();
  const ev = { v: 1, id: randomUUID(), type, at, ...payload };
  const rand = Math.floor(Math.random() * 0x100000).toString(16).padStart(5, "0");
  await fs.mkdir(spoolDir(), { recursive: true }).catch(() => {});
  const name = `${at}-${type}-mod-${rand}.json`;
  await writeTextFile(`${spoolDir()}/${name}`, JSON.stringify(ev), null);
  return { name, ev };
}

// Replaces a file atomically with writeTextFile's compare-and-swap (one retry on a race). For a text
// that does not depend on what the file holds (a whole snapshot); an append uses writeAtomicWith.
export async function writeAtomic(path, text) {
  for (let i = 0; i < 2; i++) {
    const cur = await readTextFile(path).catch(() => null);
    try { await writeTextFile(path, text, cur); return true; } catch { /* changed under us: retry */ }
  }
  return false;
}

// The same for a text made from what the file holds (an append): next(cur) is asked again after every
// read, so a retry never writes over lines that landed meanwhile (2026-11-19: writeAtomic's retry wrote the
// text made from the first read). next returns null for nothing to write (the line is there already).
// Resolves true (written, or nothing to write) or false.
export async function writeAtomicWith(path, next) {
  for (let i = 0; i < 2; i++) {
    const cur = await readTextFile(path).catch(() => null);
    const text = next(cur ?? "");
    if (text === null) return true;
    try { await writeTextFile(path, text, cur); return true; } catch { /* changed under us: read again */ }
  }
  return false;
}
