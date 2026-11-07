// ledgr writer: the single writer of ledgr-data/store.json (spec 3.3, coordinator decision
// 2026-11-05 option c). It runs in an always-shown host copy: the ledgr host block (props
// {view: "host"}, role "host"), or any other mod that carries a copy of the engine (an overlay's
// tab bar, role = its name). The ledgr panel runs one only as a fallback (role "panel") when no
// host writer answers its ping.
//   - claims shared("ledgr.writer") = {id, by, at}; whoever holds the key writes, nobody else.
//     Hosts elect one writer among themselves: a host that starts later takes over; a host that
//     lost the role takes it back (re-reading store.json first) when the claim is empty or held by
//     a panel fallback; a host that goes away releases it (release(), from the View's close);
//   - loads store.json before reading or unlinking any spool file;
//   - ingests ledgr-data/spool with watchFolder, writes store.json after every change and before
//     unlinking the files it applied; publishes shared("ledgr.chips"); writes snapshot.json and
//     archive/; runs the extractor's --retry for `retry` events;
//   - track(cx) from the host's render: interrupts and tier-3 status turns (spec 6.5, 2.9);
//   - respond(cx) from the host's render: answers a panel's shared("ledgr.ping") by re-claiming;
//   - Phase 2: launches the branches the store accepted from a panel's `branch` event
//     (launchBranch): the only process the mod starts on its own initiative.
//   - Phase 3: appends one line per landed confluence to ledgr-data/sessions/<trunk sid>/decisions.md
//     (appendDecision), and ends a rejoined branch's terminal on the panel's Close branch
//     (closeBranch: hc kill, then hc rm; the Branch record stays).
//   - Resume session: for a session whose terminal is gone, `claude --resume <sid>` in a new pane
//     (resumeSession, branch.js resumeArgs); the session's SessionStart hook re-maps it.
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
import { DEFAULTS, loadConfig, dataDir, spoolDir, turnPath, storePath, binDir, agentLabel, panelPlace, panelShown, showPanel, liveHome, disabledSpaces, terminalSpace } from "./config.js";
import { Store, isHuman, thresholdOf } from "./store.js";
import { SpoolReader, readMap, writeAtomic } from "./spool.js";
import { maxDepthOf, hcRunArgs, claudeArgv, resumeArgs, transcriptPathOf } from "./branch.js";

export const ENGINE_FILES = ["config.js", "store.js", "spool.js", "writer.js", "branch.js", "confluence.js"];
const DAY = 86400e3;
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const plain = (s) => squash(String(s ?? "").replace(/[`*_#>]+/g, ""));

export function writerClaim() {
  const w = shared("ledgr.writer");
  return w && typeof w === "object" && w.id ? w : null;
}

export class Writer {
  constructor(role) {
    this.role = role;
    this.id = randomUUID();
    this.cfg = DEFAULTS;
    this.live = new Store(null);
    this.storeText = null;          // store.json as last read or written (writeTextFile's expected)
    this.writeChain = Promise.resolve(true);
    this.reader = new SpoolReader((batch, cx) => this.applyBatch(batch, cx));
    this.started = false;
    this.retired = false;
    this.passages = new Map();
    this.lastChips = null;
    this.lastStatus = new Map();
    this.pendingStatus = [];
    this.note = null;               // last problem, for a host that shows one
    this.claimAt = 0;
  }

  claim() {
    this.claimAt = Date.now();
    setShared("ledgr.writer", { id: this.id, by: this.role, at: this.claimAt });
  }

  holds() { return !this.retired && writerClaim()?.id === this.id; }
  amWriter() { return this.started && this.holds(); }
  retire() { this.retired = true; }

  // This copy is going away (the View's close): give the role up so another host takes it at once.
  release() {
    const held = this.holds();
    this.retired = true;
    if (held) setShared("ledgr.writer", null);
  }

  // Taking the role: claim, then load store.json before any spool file is read or unlinked.
  // Missing: start empty. Unreadable: keep a copy aside, start empty. Until loaded, amWriter()
  // is false, so the reader leaves every spool file where it is.
  async start(cx) {
    if (!this.booted && !(await liveHome())) { this.retired = true; this.note = "not in the app (herdr-app check): no writer"; return; }
    this.booted = true;
    const before = writerClaim();
    this.claim();
    // Taking over from a live holder: let a store.json write it already started land first.
    if (before && before.id !== this.id) await cx.sleep(500);
    this.cfg = await loadConfig();
    const text = await fs.readFile(storePath(), "utf8").catch(() => null);
    try { this.live = Store.fromText(text); this.storeText = text; }
    catch (e) {
      this.live = new Store(null);
      this.storeText = text;
      const aside = `${dataDir()}/store.corrupt-${Date.now()}.json`;
      await writeTextFile(aside, text, null).catch(() => {});
      this.note = `store.json could not be read (${String(e?.message ?? e)}); kept as ${aside.split("/").pop()}, started empty.`;
    }
    if (!this.holds()) return;            // someone else claimed while we loaded
    this.started = true;
    this.applyConfig(this.cfg);
    // A launch cut short by a restart: say so (a late branch_started still marks it running).
    for (const b of Object.values(this.live.d.branches)) {
      if (b.status === "launching" && Date.now() - (b.createdAt ?? 0) > 60000) this.live.branchLaunched(b.id, { error: "the writer restarted before the launch finished" });
    }
    for (const rec of await readMap()) this.live.applyMap(rec);
    await this.saveStore();
    await this.reader.drain(cx);
    this.publish();
    this.scheduleSnapshot(cx);
    if (this.reader.missing) this.waitForSpool(cx); else this.watch(cx);
    this.watchConfig(cx);
    await this.housekeep();
    cx.notify();
  }

  // The config values the store applies itself (branch.maxDepth, extract.threshold, spaces.disabled),
  // and the ones the chips, the host and the capture box need: shared("ledgr.ui") = {animations,
  // panel, off} (a pane-header chip cannot read ledgr-data itself; `off` is spaces.disabled, read by
  // the capture box before it has read config.json).
  applyConfig(cfg) {
    this.cfg = cfg;
    this.live.maxDepth = maxDepthOf(cfg);
    this.live.threshold = thresholdOf(cfg);
    const off = disabledSpaces(cfg);
    this.live.spacesOff = new Set(off);
    const ui = { animations: cfg?.ui?.animations !== false, panel: panelPlace(cfg), off };
    if (this.holds() && JSON.stringify(shared("ledgr.ui") ?? null) !== JSON.stringify(ui)) setShared("ledgr.ui", ui);
  }

  // What in the config changes the chips: the threshold and the spaces where ledgr is off.
  chipKey() { return `${this.live.threshold}|${[...this.live.spacesOff].sort().join(",")}`; }

  // config.json edited (by hand, by the panel's menus, or by the hooks creating it): read it again and
  // republish the chips, so a new extract.threshold or spaces.disabled applies at once. An identity-map
  // record rewritten by the hooks (ledgr-data/terminals/<t>.json): its space (noteSpace). Wakes on
  // every change under ledgr-data/ (the watch is recursive), reads only those files.
  watchConfig(cx) {
    if (this.watchingConfig) return;
    this.watchingConfig = true;
    cx.spawn(async (cx) => {
      const root = dataDir().replace(/\/+$/, "");
      const mapFile = /\/terminals\/[^/.][^/]*\.json$/;
      let quick = 0, lastAt = 0;
      try {
        while (!this.retired) {
          const paths = await watchFolder(root);
          const now = Date.now();
          quick = now - lastAt < 50 ? quick + 1 : 0;
          lastAt = now;
          if (quick > 20) { quick = 0; await cx.sleep(1000); }
          if (!this.amWriter()) continue;
          const all = paths.some((p) => String(p).replace(/\/+$/, "") === root);
          const cfgHit = all || paths.some((p) => String(p).split("/").pop() === "config.json");
          const maps = all ? null : paths.map(String).filter((p) => mapFile.test(p));
          if (!cfgHit && !all && !maps.length) continue;
          let republish = false;
          if (cfgHit) {
            const before = this.chipKey();
            this.applyConfig(await loadConfig());
            if (this.chipKey() !== before) republish = true;
          }
          if ((all || maps.length) && (await this.refreshSpaces(maps)) && this.amWriter()) { this.commit(cx); continue; }
          if (republish) { this.publish(); cx.notify(); }
        }
      } catch (e) { this.note = `config watch stopped: ${String(e?.message ?? e)}`; }
      finally { this.watchingConfig = false; }
    });
  }

  // The space of each changed identity-map record (null: all of them). True when the store changed.
  async refreshSpaces(paths) {
    let recs;
    if (!paths) recs = await readMap();
    else {
      recs = [];
      for (const p of paths) {
        const text = await readTextFile(p).catch(() => null);
        try { const r = JSON.parse(text); if (r?.terminal && r?.session_id) recs.push(r); } catch { /* in progress */ }
      }
    }
    let changed = false;
    for (const r of recs) if (this.live.noteSpace(r)) changed = true;
    return changed;
  }

  // Writes store.json if it changed: writeTextFile replaces an existing file atomically and only
  // if it still holds what this writer last read or wrote; on a mismatch the current file is
  // re-read and replaced while the role is held. Chained, so writes never overlap.
  saveStore() {
    const go = async () => {
      if (!this.amWriter()) return false;
      const text = this.live.toText();
      if (text === this.storeText) return true;
      await fs.mkdir(dataDir(), { recursive: true }).catch(() => {});
      try { await writeTextFile(storePath(), text, this.storeText); }
      catch {
        const cur = await fs.readFile(storePath(), "utf8").catch(() => null);
        if (!this.amWriter()) return false;
        try { await writeTextFile(storePath(), text, cur); }
        catch (e) { this.note = `store.json not written: ${String(e?.message ?? e)}`; return false; }
      }
      this.storeText = text;
      // snapshot.json follows every store change (the extractor reads it at each Stop).
      await writeAtomic(`${dataDir()}/snapshot.json`, JSON.stringify(this.live.snapshot())).catch(() => false);
      return true;
    };
    this.writeChain = this.writeChain.then(go, go);
    return this.writeChain;
  }

  commit(cx) {
    cx.spawn(async () => { await this.saveStore(); });
    this.publish();
    this.scheduleSnapshot(cx);
    cx.notify();
  }

  watch(cx) {
    if (this.watching) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      let quick = 0, lastAt = 0;
      try {
        while (!this.retired) {
          await watchFolder(spoolDir());
          const now = Date.now();
          quick = now - lastAt < 50 ? quick + 1 : 0;
          lastAt = now;
          if (quick > 20) { quick = 0; await cx.sleep(1000); }   // a watch that never blocks
          if (this.amWriter()) await this.reader.drain(cx);
        }
      } catch (e) { this.note = `spool watch stopped: ${String(e?.message ?? e)}`; }
      finally { this.watching = false; }
    });
  }

  // Until the hooks (or a capture) create ledgr-data/spool, look for it every 5 s.
  waitForSpool(cx) {
    cx.timer.after(5000, async (cx) => {
      if (!this.amWriter()) return;
      await this.reader.drain(cx);
      if (this.reader.missing) this.waitForSpool(cx);
      else { this.watch(cx); cx.notify(); }
    });
  }

  async applyBatch(batch, cx) {
    if (!this.amWriter()) return false;
    const settles = [], retries = [], launches = [], decisions = [], closes = [], resumes = [];
    let newAsks = false, pending = false;
    // branch.maxDepth is read again when a branch is asked for (watchConfig also follows the file).
    if (batch.some(({ ev }) => ev?.type === "branch")) {
      this.applyConfig(await loadConfig());
      if (!this.amWriter()) return false;
    }
    for (const { ev } of batch) {
      const r = this.live.apply(ev);
      settles.push(...r.settle);
      retries.push(...(r.retry ?? []));
      launches.push(...(r.launch ?? []));
      decisions.push(...(r.decisions ?? []));
      closes.push(...(r.close ?? []));
      resumes.push(...(r.resume ?? []));
      // A session in a space where ledgr is off does not open the panel (its asks are kept, hidden).
      if (ev?.type === "asks" && Array.isArray(ev.asks) && ev.asks.length && !this.offEvent(ev)) newAsks = true;
      if (ev?.type === "pending") pending = true;
    }
    for (const s of settles) await this.reanchor(s);
    // decisions.md before store.json: a batch that fails to save is applied again later, and the
    // append skips a branch whose line is already there.
    for (const d of decisions) await this.appendDecision(d);
    // store.json first: the reader unlinks these files only when this resolves true.
    if (!(await this.saveStore())) return false;
    this.publish();
    if (pending) cx.timer.after(30500, (cx) => { this.publish(); cx.notify(); });   // pending times out
    this.scheduleSnapshot(cx);
    for (const r of retries) this.runRetry(r, cx);
    for (const id of launches) this.launchBranch(id, cx);
    for (const id of closes) this.closeBranch(id, cx);
    for (const sid of resumes) this.resumeSession(sid, cx);
    if (newAsks && this.cfg.surface?.openPanelOnAsks && this.panelShown() === false) showPanel(panelPlace(this.cfg));
    cx.notify();
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
  // message, the saved turns are searched backward (spec 5.3).
  async reanchor({ sid, turn, textPath }) {
    const items = this.live.itemsOf(sid).filter((it) => isHuman(it) && it.anchor?.quote && it.anchor.turn === turn && !it.anchor.reanchored);
    if (!items.length) return;
    const read = async (n) => {
      const k = `${sid}:${n}`;
      if (this.passages.has(k)) return this.passages.get(k);
      const p = n === turn && textPath ? (textPath.startsWith("/") ? textPath : `${dataDir()}/${textPath}`) : turnPath(sid, n);
      const txt = await readTextFile(p).catch(() => null);
      this.passages.set(k, txt);
      if (this.passages.size > 120) this.passages.delete(this.passages.keys().next().value);
      return txt;
    };
    for (const it of items) {
      const q = plain(it.anchor.quote);
      for (let n = turn; n >= Math.max(0, turn - 50); n--) {
        const txt = await read(n);
        if (txt && plain(txt).includes(q)) { if (n !== turn) { it.anchor.turn = n; it.anchor.reanchoredFrom = turn; } break; }
      }
      it.anchor.reanchored = true;
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
    const cur = (await readTextFile(path).catch(() => null)) ?? "";
    if (key && cur.includes(key)) return true;
    const ok = await writeAtomic(path, `${cur || header || ""}${line}\n`);
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
    cx.spawn(async () => {
      if (!this.amWriter() || !(await fs.exists(dataDir()).catch(() => false))) return;
      await writeAtomic(`${dataDir()}/snapshot.json`, JSON.stringify(this.live.snapshot()));
    });
  }

  // Once a day: closed items past retention move to archive/<yyyy-mm>.jsonl (spec 3.2).
  async housekeep() {
    const now = Date.now();
    const last = Number(this.live.d.houseAt) || 0;
    if (now - last < DAY || !this.amWriter() || !(await fs.exists(dataDir()).catch(() => false))) return;
    this.live.d.houseAt = now;
    const old = this.live.archivable(Number(this.cfg.retention_days) || 14, now);
    const byMonth = new Map();
    for (const it of old) {
      const d = new Date(it.resolvedAt ?? it.updatedAt ?? now);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      byMonth.set(k, [...(byMonth.get(k) ?? []), it]);
    }
    if (old.length) await fs.mkdir(`${dataDir()}/archive`, { recursive: true }).catch(() => {});
    for (const [k, list] of byMonth) {
      const path = `${dataDir()}/archive/${k}.jsonl`;
      const cur = (await readTextFile(path).catch(() => null)) ?? "";
      if (await writeAtomic(path, cur + list.map((it) => JSON.stringify(it)).join("\n") + "\n")) this.live.removeItems(list);
    }
    await this.saveStore();
  }

  // The host's 60 s timer: safety rescan, deferred items waking, housekeeping. A host that does
  // not hold the role checks instead that the holder is alive (probe).
  tick(cx) {
    if (!this.amWriter()) { this.probe(cx); return; }
    cx.spawn(async (cx) => {
      await this.reader.drain(cx);
      if (!this.watching && this.reader.missing === false) this.watch(cx);
      const changed = this.live.wake();
      // The safety net for watchConfig (a watch that stopped): config.json once a minute.
      const before = this.chipKey();
      this.applyConfig(await loadConfig());
      if (this.chipKey() !== before) this.publish();
      await this.housekeep();
      if (changed) this.commit(cx); else this.publish();
    });
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
    if (this.retired || this.role === "panel" || this.starting) return;
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
  // last refreshed, and takes the role when the claim is not renewed within 4 s.
  probe(cx) {
    if (this.retired || this.role === "panel" || !this.booted || this.starting || !cx) return;
    const w = writerClaim();
    if (!w || w.by === "panel") { this.regain(cx); return; }
    if (w.id === this.id || Date.now() - Number(w.at || 0) < 120000 || this.probing) return;
    const at = Date.now();
    this.probing = true;
    setShared("ledgr.ping", { at, id: this.id });
    cx.timer.after(4000, (cx) => {
      this.probing = false;
      const now = writerClaim();
      if (!this.holds() && !this.starting && (!now || (now.id === w.id && Number(now.at) < at) || now.by === "panel")) this.regain(cx);
    });
  }

  regain(cx) {
    this.starting = true;
    this.started = false;
    cx.spawn(async (cx) => {
      try { await this.start(cx); } finally { this.starting = false; }
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
