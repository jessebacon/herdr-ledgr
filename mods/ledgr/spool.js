// ledgr spool: the hooks (and the capture box) drop one JSON event per file into
// ledgr-data/spool/<ms>-<type>-<pid>-<rand>.json; the panel copy (single writer) reads them
// in name order, applies them, then unlinks each file (spec 2.5, 3.3). Dotfiles are writes
// in progress; `bad-*` files are events that never parsed. Also reads the identity map
// (ledgr-data/terminals/<t>.json, spec 2.5, 2.8).
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { readTextFile, writeTextFile } from "herdr";
import { LIMITS, spoolDir, terminalsDir, terminalFile } from "./config.js";

const base = (p) => String(p).split("/").pop();
const isEvent = (n) => n.endsWith(".json") && !n.startsWith(".") && !n.startsWith("bad-");

// Event file names in order, or null when the spool folder does not exist yet.
export async function listSpool() {
  let names;
  try { names = await fs.readdir(spoolDir()); } catch { return null; }
  return names.map(base).filter(isEvent).sort();
}

export class SpoolReader {
  // apply(batch: {name, ev}[], cx) -> Promise; called with parsed events in name order.
  constructor(apply) {
    this.apply = apply;
    this.retries = new Map();
    this.running = false;
    this.again = false;
    this.missing = null;   // true while ledgr-data/spool does not exist
    this.lastRun = 0;
    this.applied = 0;      // events applied since start
    this.errors = [];
  }

  // Reads every event file, applies the parsed ones, unlinks them. Re-entrant calls while
  // a pass runs ask for one more pass. A file that does not parse is retried up to 5 times,
  // 300 ms apart, then kept aside as spool/bad-<name>.
  async drain(cx) {
    if (this.running) { this.again = true; return; }
    this.running = true;
    let retryLater = false;
    try {
      do {
        this.again = false;
        const names = await listSpool();
        this.missing = names === null;
        if (!names) break;
        const batch = [];
        for (const name of names.slice(0, 500)) {
          const path = `${spoolDir()}/${name}`;
          const text = await readTextFile(path).catch(() => null);
          if (text === null) continue;
          let ev;
          try { ev = JSON.parse(text); }
          catch {
            const n = (this.retries.get(name) ?? 0) + 1;
            this.retries.set(name, n);
            if (n > LIMITS.parseRetries) {
              this.retries.delete(name);
              await writeTextFile(`${spoolDir()}/bad-${name}`, text, null).catch(() => {});
              await fs.unlink(path).catch(() => {});
              this.errors.push(`unparseable spool file kept as bad-${name}`);
            } else retryLater = true;
            continue;
          }
          this.retries.delete(name);
          batch.push({ name, ev });
        }
        if (batch.length) {
          // false: this copy is not the writer; leave the files for the one that is.
          if ((await this.apply(batch, cx)) === false) break;
          for (const b of batch) await fs.unlink(`${spoolDir()}/${b.name}`).catch(() => {});
          this.applied += batch.length;
        }
        if (names.length > 500) this.again = true;
      } while (this.again);
    } catch (e) {
      this.errors.push(String(e?.message ?? e));
    } finally {
      this.running = false;
      this.lastRun = Date.now();
      if (this.errors.length > 20) this.errors.splice(0, this.errors.length - 20);
    }
    if (retryLater) cx.timer.after(300, (cx) => this.drain(cx));
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

// Replaces a file atomically with writeTextFile's compare-and-swap (one retry on a race).
export async function writeAtomic(path, text) {
  for (let i = 0; i < 2; i++) {
    const cur = await readTextFile(path).catch(() => null);
    try { await writeTextFile(path, text, cur); return true; } catch { /* changed under us: retry */ }
  }
  return false;
}
