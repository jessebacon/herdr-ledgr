// ledgr store: the item list, sessions and identity map of the panel copy (the single
// writer), spec 3.1. Its source of truth is ledgr-data/store.json, which the panel writes
// after every change (panel.js saveStore); localStorage is not used for it. apply(event)
// folds one spool event in. Pure data: no files, no UI.
//
// Contract change (2026-11-05, the owner via the coordinator): anchors do not require a Claude
// message uuid. `anchor.uuid` is optional (spec name `messageUuid` is read too); identity
// and de-duplication use `anchor.turn` plus `anchor.hash`, a short hash of the passage.
//
// Phase 2 (2026-11-05): branches. `branch` (panel) asks the writer to launch a fork of the
// session from a parked question; `branch_started` (the child's SessionStart hook, from
// LEDGR_PARENT) links the child session to its Branch record; `compacted` (SessionStart source
// "compact") records where a session's context was summarised; `forget` (panel) removes a
// session, its items and its branches. See branch.js for the manifest and the launch argv.
//
// Phase 3 (2026-11-05): the confluence. `conclude` (panel, Send to trunk) records the person's
// edited conclusion and the staged message: branch `concluded`, question `rejoin_pending`.
// `confluence_landed` (the trunk's UserPromptSubmit hook saw the message's marker line) resolves the
// question (`resolvedBy: "branch"`), marks the branch `rejoined` and asks the writer to append a line
// to ledgr-data/sessions/<sid>/decisions.md (out.decisions). `answers_landed` (the answer sheet's
// marker) marks the listed asks answered. `close_branch` (panel, after rejoin) asks the writer to end
// the branch terminal (out.close); the record stays. See confluence.js for the message formats.
//
// Severity (2026-11-05): every agent ask has a `level`, blocking > needed > optional (bin/lib/
// ledgr_asks.py; legacy items without one read as needed, or blocking when `blocking` is true).
// `extract.threshold` (config.json, default needed; the writer sets `store.threshold`) splits them:
// at or above it an ask is an open row and counts on the chip; below it the ask is a "suggestion",
// kept, shown folded under its turn and not counted, until the person promotes it (act "promote",
// `promoted: true`). An open blocking ask gives the chip its own state, "blocking".
import { createHash, randomUUID } from "crypto";
import { LIMITS, agentLabel } from "./config.js";
import { DEFAULT_MAX_DEPTH, manifest, preamble, branchName, branchLabel, depthOf } from "./branch.js";
import { conclusionHead, decisionLine, decisionsHeader } from "./confluence.js";

const EMPTY = () => ({ v: 1, items: {}, sessions: {}, branches: {}, terminals: {}, turns: {}, ingested: [], forgotten: {} });
const OPEN_STATES = new Set(["open", "answered", "deferred", "rejoin_pending"]);
const AGENT = "agent_to_human", HUMAN = "human_to_agent";
const ASK_KINDS = new Set(["decide", "confirm", "do", "provide", "review"]);
const Q_KINDS = new Set(["question", "note", "bookmark"]);
const OWN_EVENTS = new Set(["act", "retry", "branch", "forget", "conclude", "close_branch", "resume"]);

export const isAgentAsk = (it) => it?.direction === AGENT;
export const isHuman = (it) => it?.direction === HUMAN;
export const isClosed = (it) => it?.status === "resolved" || it?.status === "dismissed";

// Severity, lowest first (the same names as bin/lib/ledgr_asks.py LEVELS).
export const LEVELS = ["optional", "needed", "blocking"];
export const DEFAULT_THRESHOLD = "needed";
export const levelRank = (lv) => LEVELS.indexOf(lv);
export const levelOf = (it) => (LEVELS.includes(it?.level) ? it.level : it?.blocking === true ? "blocking" : "needed");
// config.json extract.threshold, checked: anything but the three names means the default.
export const thresholdOf = (cfg) => {
  const v = String(cfg?.extract?.threshold ?? "").trim().toLowerCase();
  return LEVELS.includes(v) ? v : DEFAULT_THRESHOLD;
};
// An agent ask below the threshold that the person has not promoted: kept, folded, not counted.
export const isSuggestion = (it, threshold = DEFAULT_THRESHOLD) =>
  isAgentAsk(it) && it.promoted !== true && levelRank(levelOf(it)) < levelRank(LEVELS.includes(threshold) ? threshold : DEFAULT_THRESHOLD);
export const isBlocking = (it) => isAgentAsk(it) && levelOf(it) === "blocking";

// Spec 3.4 norm(): strip markdown and list numbering, lower-case, collapse whitespace,
// drop trailing punctuation, first 160 characters.
export function norm(s) {
  return String(s ?? "")
    .replace(/^\s*(?:\d+[.)]|[-*+])\s+/gm, "")
    .replace(/[`*_~>#]+/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.,;:!?]+$/, "")
    .slice(0, 160);
}

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// The passage hash: sha1 of the whitespace-collapsed passage (quote, else text), first 12
// hex chars. Events that carry `hash` win; this is the fallback (docs/build-notes/BUILD-NOTES-mod.md in the repo).
export function passageHash(passage) {
  const s = squash(passage);
  if (!s) return null;
  try { return String(createHash("sha1").update(s).digest("hex")).slice(0, 12); }
  catch {
    let h = 0x811c9dc5; // FNV-1a when crypto.createHash is unavailable
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return "f" + h.toString(16).padStart(8, "0");
  }
}

export const newId = (prefix) => `${prefix}_${randomUUID()}`;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v) => (typeof v === "string" && v ? v : null);

export class Store {
  constructor(data) {
    const d = data && typeof data === "object" && data.v === 1 ? data : EMPTY();
    for (const [k, v] of Object.entries(EMPTY())) if (!d[k] || typeof d[k] !== typeof v) d[k] = v;
    for (const s of Object.values(d.sessions)) if (String(s.sessionId).startsWith("herdr:")) s.turnSource = "herdr-status";
    this.d = d;
    // branch.maxDepth from config.json; the writer sets it before applying `branch` events.
    this.maxDepth = DEFAULT_MAX_DEPTH;
    // extract.threshold from config.json (thresholdOf); the writer sets it and re-reads it on change.
    this.threshold = DEFAULT_THRESHOLD;
  }

  // An open item that counts: on the chip, for "surfaced", in the lanes' "N open" (not a suggestion).
  counts(it) { return it?.status === "open" && !isSuggestion(it, this.threshold); }

  // From store.json text. Throws on text that is not a store (the caller keeps it aside).
  static fromText(text) {
    if (text === null || text === undefined || text === "") return new Store(null);
    const d = JSON.parse(text);
    if (!d || typeof d !== "object" || d.v !== 1) throw new Error("not a ledgr store (v != 1)");
    return new Store(d);
  }

  get empty() { return !Object.keys(this.d.items).length && !Object.keys(this.d.sessions).length; }

  toText() { return JSON.stringify(this.d); }

  // ── lookups ──────────────────────────────────────────────────────────
  items() { return Object.values(this.d.items); }
  itemsOf(sid) { return this.items().filter((it) => it.anchor?.sessionId === sid); }
  item(id) { return this.d.items[id] ?? null; }
  sessionsList() { return Object.values(this.d.sessions).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)); }
  byHandle(sid, handle) {
    const h = String(handle ?? "").replace(/[[\]]/g, "").toUpperCase();
    return this.itemsOf(sid).find((it) => it.handle === h) ?? null;
  }
  turnInfo(sid, turn) { return this.d.turns[sid]?.[turn] ?? null; }
  branchesOf(sid) { return Object.values(this.d.branches).filter((b) => b.parentSessionId === sid).sort((a, b) => num(b.createdAt) - num(a.createdAt)); }
  branchesFor(itemId) { return Object.values(this.d.branches).filter((b) => b.requestId === itemId).sort((a, b) => num(b.createdAt) - num(a.createdAt)); }
  branchOfSession(sid) { return Object.values(this.d.branches).find((b) => b.sessionId === sid) ?? null; }
  isForgotten(sid) { return Boolean(sid && this.d.forgotten[sid]); }
  sessionForTerminal(t) { return this.d.terminals[t]?.sessionId ?? null; }

  session(sid, ev = {}) {
    let s = this.d.sessions[sid];
    if (!s) {
      s = this.d.sessions[sid] = {
        sessionId: sid, agent: ev.agent ?? "claude-code", terminal: ev.terminal ?? null, sessionName: null,
        cwd: ev.cwd ?? "", repo: null, transcriptPath: null, model: null, turn: 0, turnSource: "hooks",
        state: "idle", nextHandle: { A: 1, Q: 1 }, startedAt: ev.at ?? Date.now(), updatedAt: ev.at ?? Date.now(),
        seenAt: 0, promptAt: 0, surfaced: false,
      };
    }
    return s;
  }

  // An identity-map record (ledgr-data/terminals/<t>.json, spec 2.5) seeds a session.
  applyMap(rec) {
    if (!rec?.terminal || !rec?.session_id || this.isForgotten(rec.session_id)) return false;
    const s = this.session(rec.session_id, { at: rec.updated_at, terminal: rec.terminal, agent: rec.agent });
    s.agent = rec.agent ?? s.agent;
    s.terminal = rec.terminal;
    s.sessionName = rec.session_name ?? s.sessionName;
    s.cwd = rec.cwd ?? s.cwd;
    s.repo = rec.repo ?? s.repo;
    s.transcriptPath = rec.transcript_path ?? s.transcriptPath;
    if (num(rec.turn) > s.turn) s.turn = num(rec.turn);
    if (rec.parent_session_id && !s.parentSessionId) this.setLineage(s, { parent_session_id: rec.parent_session_id, branch_id: rec.branch_id,
      item_id: rec.parent_item, anchor_turn: rec.anchor_turn, fork_turn: rec.fork_turn, depth: rec.depth });
    if (rec.state && num(rec.updated_at) >= num(s.updatedAt)) s.state = rec.state;
    s.updatedAt = Math.max(num(s.updatedAt), num(rec.updated_at));
    const cur = this.d.terminals[rec.terminal];
    if (!cur || num(rec.updated_at) >= num(cur.updatedAt)) {
      this.d.terminals[rec.terminal] = { sessionId: rec.session_id, agent: rec.agent ?? s.agent, updatedAt: num(rec.updated_at) };
    }
    return true;
  }

  // ── events (spec 2.5, 3.3) ───────────────────────────────────────────
  // Returns { applied, settle: [{sid, turn, textPath}], retry: [{sid, turn, terminal}], launch: [branchId],
  // decisions: [{sid, key, line, header}], close: [branchId] }: settle lists turns whose parked
  // questions should be re-anchored by quote, retry the turns whose extraction the person asked to
  // re-run, launch the branches to start, decisions the lines to append to a trunk's decisions.md,
  // close the branch terminals to end (all async, done by the writer).
  apply(ev) {
    const out = { applied: false, settle: [], retry: [], launch: [], decisions: [], close: [], resume: [] };
    if (!ev || typeof ev !== "object" || !ev.type) return out;
    if (ev.id && this.d.ingested.includes(ev.id)) return out;
    const sid = str(ev.session_id) ?? str(ev.session) ?? str(ev.request?.anchor?.sessionId);
    const at = num(ev.at, Date.now());
    // The panel's own events (act, retry, branch, forget, conclude, close_branch) never create a session.
    const own = OWN_EVENTS.has(ev.type);
    if (sid && this.isForgotten(sid)) { /* a forgotten session: recorded and dropped */ }
    else if (sid && own && !this.d.sessions[sid]) { /* unknown session: recorded and dropped */ }
    else if (sid && own) {
      const fn = this[`on_${ev.type}`];
      fn.call(this, ev, this.d.sessions[sid], at, out);
    } else if (sid) {
      const s = this.session(sid, { ...ev, at });
      if (ev.terminal) {
        s.terminal = ev.terminal;
        const cur = this.d.terminals[ev.terminal];
        if (!cur || at >= num(cur.updatedAt)) this.d.terminals[ev.terminal] = { sessionId: sid, agent: ev.agent ?? s.agent, updatedAt: at };
      }
      if (ev.agent) s.agent = ev.agent;
      if (!s.sessionName && ev.session_name) s.sessionName = ev.session_name;
      if (!s.cwd && ev.cwd) s.cwd = ev.cwd;
      if (String(s.sessionId).startsWith("herdr:")) s.turnSource = "herdr-status";
      s.updatedAt = Math.max(num(s.updatedAt), at);
      const fn = this[`on_${ev.type}`];
      if (typeof fn === "function") fn.call(this, ev, s, at, out);
    }
    if (ev.id) {
      this.d.ingested.push(ev.id);
      if (this.d.ingested.length > LIMITS.ingested) this.d.ingested.splice(0, this.d.ingested.length - LIMITS.ingested);
    }
    out.applied = true;
    return out;
  }

  on_session_start(ev, s, at) {
    // A Resume session launch landed: the hook ran in the new terminal (apply() has mapped it).
    if (s.resume && s.resume.state !== "resumed" && ev.terminal) s.resume = { ...s.resume, state: "resumed", terminal: ev.terminal, resumedAt: at };
    s.sessionName = ev.session_name ?? s.sessionName;
    s.cwd = ev.cwd ?? s.cwd;
    s.repo = ev.repo ?? s.repo;
    s.transcriptPath = ev.transcript_path ?? s.transcriptPath;
    s.model = ev.model ?? s.model;
    s.lastSource = ev.source ?? null;
    s.state = "idle";
    // Items deferred to "next session" wake when a session starts in the same folder.
    for (const it of this.items()) {
      if (it.status !== "deferred" || it.deferUntil !== "next_session" || it.anchor?.sessionId === s.sessionId) continue;
      const o = this.d.sessions[it.anchor?.sessionId];
      if (o && o.cwd && o.cwd === s.cwd) this.setStatus(it, "open", at);
    }
  }

  on_prompt(ev, s, at) {
    if (ev.local) return;
    const turn = num(ev.turn, s.turn + 1);
    s.turn = Math.max(s.turn, turn);
    s.state = "working";
    s.promptId = ev.prompt_id ?? s.promptId;
    s.promptAt = at;
    s.seenAt = at;          // the next prompt marks the chip seen (spec 6.5)
    s.surfaced = false;
    const head = String(ev.prompt_head ?? "");
    const refs = new Set((Array.isArray(ev.refs) ? ev.refs : []).map((r) => String(r).replace(/[[\]]/g, "").toUpperCase()));
    const nh = norm(head);
    for (const it of this.itemsOf(s.sessionId)) {
      if (isClosed(it) || it.status === "rejoin_pending") continue;   // a confluence names its question
      const referenced = refs.has(it.handle) || (isHuman(it) && it.text && norm(it.text).length > 8 && nh.includes(norm(it.text)));
      if (!referenced) continue;
      if (isHuman(it)) { it.askedAtTurn = turn; it.updatedAt = at; }
      else if (it.status === "open" || it.status === "deferred") {
        it.answer = head.slice(0, LIMITS.text);
        this.setStatus(it, "answered", at);
      }
    }
  }

  on_stop(ev, s, at, out) {
    const turn = num(ev.turn, s.turn);
    s.turn = Math.max(s.turn, turn);
    if (turn >= s.turn) s.state = "idle";
    s.lastStopAt = at;
    const ti = this.turnRec(s.sessionId, turn);
    ti.stopAt = at;
    ti.textPath = ev.text_path ?? ti.textPath ?? null;
    ti.textHead = ev.text_head ?? ti.textHead ?? null;
    ti.promptId = ev.prompt_id ?? ti.promptId ?? null;
    for (const it of this.itemsOf(s.sessionId)) {
      if (isHuman(it) && it.status === "open" && it.askedAtTurn === turn) this.setStatus(it, "answered", at);
      if (isHuman(it) && it.anchor && !it.anchor.settled && num(it.anchor.turn) <= turn) {
        it.anchor.turn = turn;
        it.anchor.settled = true;
        it.updatedAt = at;
      }
    }
    // The stop event's uuid (optional) goes on every item of this turn that has none.
    const uuid = str(ev.message_uuid) ?? str(ev.uuid) ?? str(ev.last_assistant_uuid);
    if (uuid) {
      ti.uuid = uuid;
      for (const it of this.itemsOf(s.sessionId)) {
        if (it.anchor && num(it.anchor.turn) === turn && !it.anchor.uuid) { it.anchor.uuid = uuid; if (ev.api_message_id) it.anchor.apiMessageId = ev.api_message_id; }
      }
    }
    out.settle.push({ sid: s.sessionId, turn, textPath: ti.textPath });
    if (this.itemsOf(s.sessionId).some((it) => this.counts(it) && num(it.updatedAt) > num(s.seenAt))) s.surfaced = true;
  }

  on_asks(ev, s, at) {
    const turn = num(ev.turn, s.turn);
    const ti = this.turnRec(s.sessionId, turn);
    const uuid = str(ev.message_uuid) ?? str(ev.uuid);
    ti.asks = { source: ev.source ?? null, error: ev.error ?? null, errorDetail: ev.error_detail ?? null, blockError: ev.block_error ?? null,
      count: Array.isArray(ev.asks) ? ev.asks.length : 0, at, model: ev.model ?? null, provider: ev.provider ?? null };
    if (ti.retry) ti.retry = { ...ti.retry, state: ev.source === "error" ? "failed" : "done", note: ti.retry.note ?? ev.error ?? null };
    if (uuid) ti.uuid = uuid;
    if (uuid) for (const it of this.itemsOf(s.sessionId)) if (it.anchor && num(it.anchor.turn) === turn && !it.anchor.uuid) it.anchor.uuid = uuid;
    if (s.pending && num(s.pending.turn) <= turn) delete s.pending;
    if (ev.source === "skip" || ev.source === "error" || !Array.isArray(ev.asks)) return;
    const origin = ev.source === "block" ? "extract_block" : "extract_model";
    let created = 0;
    ev.asks.forEach((a, i) => {
      const text = squash(a?.text).slice(0, LIMITS.text);
      if (!text) return;
      const quote = str(a.quote) ? String(a.quote).slice(0, LIMITS.quote) : null;
      const hash = str(a.hash) ?? (quote ? passageHash(quote) : passageHash(text));
      const key = `${s.sessionId}|a|${norm(text)}`;
      const options = Array.isArray(a.options) ? a.options.filter((o) => typeof o === "string").slice(0, 8) : [];
      // The hooks' validator always sends a level; an older event has only `blocking`.
      const level = LEVELS.includes(a.level) ? a.level : a.blocking === true ? "blocking" : "needed";
      const fields = {
        text, kind: ASK_KINDS.has(a.kind) ? a.kind : "do", level, options,
        recommended: options.includes(a.recommended) ? a.recommended : null,
        blocking: level === "blocking",
      };
      const anchor = { sessionId: s.sessionId, turn, promptId: ev.prompt_id ?? null, uuid, apiMessageId: ev.api_message_id ?? null,
        quote, quoteSource: ev.source === "block" ? "block" : "model", hash, settled: true };
      const mine = this.itemsOf(s.sessionId).filter(isAgentAsk);
      // Same turn and passage: the same item (a replayed or re-run extraction).
      const same = mine.find((it) => num(it.anchor?.turn) === turn && it.anchor?.hash === hash && norm(it.text) === norm(text));
      if (same) { Object.assign(same, fields); same.updatedAt = at; return; }
      // The newest item with this key decides (an older one may be resolved, a newer dismissed).
      const byKey = mine.filter((it) => it.key === key).sort((x, y) => num(y.createdAt) - num(x.createdAt))[0] ?? null;
      // repeat_of (a Request id) / repeat_of_handle ("A5") from the extractor: the same request
      // as a recorded ask. Open: updated in place. Dismissed or resolved: a new open item marked
      // "raised again" (dismiss is not permanent across re-raises).
      const rid = str(a.repeat_of), rh = str(a.repeat_of_handle);
      let repeat = rid ? this.item(rid) : null;
      if (repeat && repeat.anchor?.sessionId !== s.sessionId) repeat = null;
      if (!repeat && rh) repeat = this.byHandle(s.sessionId, rh);
      const prior = repeat ?? byKey;
      if (prior && isAgentAsk(prior)) {
        if (prior.status === "open" || prior.status === "deferred") {
          prior.lastSeenTurn = turn; prior.anchor = { ...prior.anchor, ...anchor }; Object.assign(prior, fields); prior.updatedAt = at;
          return;
        }
        if (prior.status === "answered") {
          prior.lastSeenTurn = turn; prior.note = `asked again at turn ${turn}`; prior.anchor = { ...prior.anchor, ...anchor };
          this.setStatus(prior, "open", at);
          if (this.counts(prior)) created++;
          return;
        }
        // resolved or dismissed: the agent raised it again — a new item pointing at the old one.
      }
      const again = prior && isAgentAsk(prior) && (prior.status === "resolved" || prior.status === "dismissed") ? prior : null;
      const id = newId("rq");
      this.d.items[id] = {
        id, key, handle: `A${s.nextHandle.A++}`, direction: AGENT, ...fields, anchor, status: "open",
        parentId: again?.status === "resolved" ? again.id : undefined,
        repeatOf: again ? again.id : rid ?? undefined,
        origin, terminal: ev.terminal ?? s.terminal ?? undefined, createdTurn: turn, createdAt: at, updatedAt: at, seq: i,
      };
      if (this.counts(this.d.items[id])) created++;   // a new suggestion alone does not surface the chip
    });
    if (created && s.state !== "working") s.surfaced = true;
  }

  // The turn ended and extraction is running (hooks contract: pending, then stop up to ~4 s
  // later with the message uuid, then asks). The turn counts as ended here, so the interrupt
  // check does not wait for stop. Cleared by that turn's asks event, or after 30 s (chips()).
  on_pending(ev, s, at) {
    const turn = num(ev.turn, s.turn);
    s.pending = { turn, at };
    if (turn >= s.turn) { s.turn = turn; s.state = "idle"; s.lastStopAt = Math.max(num(s.lastStopAt), at); }
    if (ev.passage_hash) this.turnRec(s.sessionId, turn).passageHash = ev.passage_hash;
  }

  // The panel is a reader: every act of the person arrives as a spool event
  // {type: "act", session_id, item, action, arg}; action "seen" marks the session's chip seen.
  on_act(ev, s, at) {
    if (ev.action === "seen") { this.markSeen(s.sessionId, at); return; }
    const it = this.item(ev.item);
    if (it && it.anchor?.sessionId === s.sessionId) this.act(ev.item, ev.action, ev.arg, at);
  }

  // {type: "retry", session_id, turn, terminal}: re-run extraction for a turn.
  on_retry(ev, s, at, out) {
    const turn = num(ev.turn, -1);
    if (turn < 0) return;
    this.turnRec(s.sessionId, turn).retry = { at, state: "running" };
    out.retry.push({ sid: s.sessionId, turn, terminal: ev.terminal ?? s.terminal ?? null });
  }

  on_settle(ev, s) {
    const turn = num(ev.turn, -1), uuid = str(ev.message_uuid);
    if (turn < 0 || !uuid) return;
    this.turnRec(s.sessionId, turn).uuid = uuid;
    for (const it of this.itemsOf(s.sessionId)) if (it.anchor && num(it.anchor.turn) === turn && !it.anchor.uuid) it.anchor.uuid = uuid;
  }

  on_session_end(_ev, s) { s.state = "ended"; }

  // ── branches (Phase 2) ───────────────────────────────────────────────
  // {type: "branch", session_id: parent sid, item, branch_id, placement: "split" | "agent",
  // isolate}: the panel's Branch confirmation. Creates the Branch record with the manifest frozen
  // now and asks the writer to launch it (out.launch). A refusal (depth cap, an unknown or closed
  // item, an ended parent) is kept on the record as status "refused" with the reason.
  on_branch(ev, s, at, out) {
    if (str(ev.branch_id) && this.d.branches[ev.branch_id]) return;
    const it = this.item(ev.item);
    const bid = /^br_[A-Za-z0-9-]{8,64}$/.test(String(ev.branch_id ?? "")) ? ev.branch_id : newId("br");
    const m = it ? manifest(this, it, { now: at, maxDepth: this.maxDepth, isolate: ev.isolate === true }) : null;
    let refused = null;
    if (!it || it.anchor?.sessionId !== s.sessionId) refused = "the question is not in this session";
    else if (!isHuman(it)) refused = "only parked questions can branch";
    else if (isClosed(it)) refused = "the question is closed";
    else refused = m.refused;
    const name = branchName(it?.handle, bid);
    this.d.branches[bid] = {
      id: bid, requestId: it?.id ?? str(ev.item), parentSessionId: s.sessionId, parentTerminal: s.terminal ?? null,
      sessionId: null, childSid: refused ? null : randomUUID(), terminal: null, name, label: it ? branchLabel(it) : name,
      depth: m?.depth ?? depthOf(this, s.sessionId) + 1, anchorTurn: m?.anchorTurn ?? null, forkTurn: m?.forkTurn ?? null,
      anchorHash: it?.anchor?.hash ?? null, anchorUuid: it?.anchor?.uuid ?? null, quote: it?.anchor?.quote ?? null,
      policy: "fork_end_of_session", placement: ev.placement === "agent" ? "agent" : "split", isolate: ev.isolate === true,
      cwd: s.cwd ?? "", manifest: m, preamble: refused ? null : preamble(it, m, name),
      status: refused ? "refused" : "launching", error: refused, createdAt: at, updatedAt: at,
    };
    if (refused) return;
    it.branch = { branchId: bid };
    it.updatedAt = at;
    out.launch.push(bid);
  }

  // The writer's launch result: { terminal } or { error }. A branch_started that came first
  // (the child's hook can beat hc's reply) is not downgraded.
  branchLaunched(id, { terminal = null, error = null, at = Date.now(), note = null } = {}) {
    const b = this.d.branches[id];
    if (!b) return false;
    if (error) { b.status = "failed"; b.error = String(error).slice(0, 400); }
    else {
      if (terminal && !b.terminal) b.terminal = terminal;
      if (b.status === "launching") b.status = "launched";
      b.launchedAt = at;
      if (note) b.note = String(note).slice(0, 200);
    }
    b.updatedAt = at;
    return true;
  }

  setLineage(s, e) {
    const psid = str(e.parent_session_id);
    if (!psid || psid === s.sessionId) return;
    s.parentSessionId = psid;
    s.parentItem = str(e.item_id) ?? s.parentItem ?? null;
    if (e.anchor_turn !== undefined && e.anchor_turn !== null) s.anchorTurn = num(e.anchor_turn);
    if (e.fork_turn !== undefined && e.fork_turn !== null) s.forkTurn = num(e.fork_turn);
    s.depth = e.depth !== undefined && e.depth !== null ? num(e.depth, 1) : depthOf(this, psid) + 1;
    if (str(e.branch_id)) s.branchId = e.branch_id;
  }

  // {type: "branch_started", session_id: child sid, terminal, parent_session_id, item_id,
  // anchor_turn, fork_turn, depth, branch_id, source}: the child's SessionStart hook found
  // LEDGR_PARENT in its environment. Links the child session to its Branch record (by id, else by
  // parent and item); a fork started outside the panel gets a record of its own.
  on_branch_started(ev, s, at) {
    this.setLineage(s, ev);
    let br = str(ev.branch_id) ? this.d.branches[ev.branch_id] ?? null : null;
    if (br && br.sessionId && br.sessionId !== s.sessionId) br = null;   // a second fork in the branch's process
    if (!br) br = Object.values(this.d.branches).find((b) => b.parentSessionId === ev.parent_session_id && b.requestId === ev.item_id
      && !b.sessionId && (b.status === "launching" || b.status === "launched")) ?? null;
    if (!br) {
      const it = this.item(ev.item_id);
      const id = str(ev.branch_id) && !this.d.branches[ev.branch_id] ? ev.branch_id : newId("br");
      const ps = this.d.sessions[ev.parent_session_id];
      const m = it && ps ? manifest(this, it, { now: at, maxDepth: this.maxDepth }) : null;
      if (m && ev.fork_turn !== undefined) { m.forkTurn = num(ev.fork_turn, m.forkTurn); m.later = Math.max(0, m.forkTurn - m.anchorTurn); }
      br = this.d.branches[id] = {
        id, requestId: str(ev.item_id), parentSessionId: str(ev.parent_session_id), parentTerminal: ps?.terminal ?? null,
        sessionId: null, childSid: null, terminal: null, name: branchName(it?.handle, id), label: s.sessionName ?? "",
        depth: num(ev.depth, 1), anchorTurn: num(ev.anchor_turn, 0), forkTurn: num(ev.fork_turn, 0),
        anchorHash: it?.anchor?.hash ?? null, anchorUuid: it?.anchor?.uuid ?? null, quote: it?.anchor?.quote ?? null,
        policy: "fork_end_of_session", placement: "unknown", isolate: false, cwd: s.cwd ?? "", manifest: m, preamble: null,
        status: "running", external: true, createdAt: at, updatedAt: at,
      };
      if (it) it.branch = { branchId: id };
    }
    br.sessionId = s.sessionId;
    if (ev.terminal) br.terminal = ev.terminal;
    br.status = "running";
    br.startedAt = at;
    br.updatedAt = at;
    if (ev.fork_turn !== undefined && ev.fork_turn !== null) br.forkTurnObserved = num(ev.fork_turn);
    if (s.cwd) br.cwd = s.cwd;
    s.branchId = br.id;
  }

  // {type: "compacted", session_id, turn, trigger}: SessionStart with source "compact". The
  // manifest of a later branch says the anchor reaches it only through the summary.
  on_compacted(ev, s, at) {
    const turn = num(ev.turn, s.turn);
    const list = Array.isArray(s.compactions) ? s.compactions : [];
    if (!list.some((c) => num(c.turn) === turn && Math.abs(num(c.at) - at) < 2000)) list.push({ turn, at, trigger: ev.trigger ?? null });
    s.compactions = list.slice(-10);
  }

  // {type: "forget", session_id}: the panel's Forget. The session goes with its items, turns,
  // terminal mapping and branches, and its branch sessions with theirs (recursively). Its id is
  // remembered (200 most recent) so a late hook event or the identity map does not bring it back.
  on_forget(_ev, s, at) {
    const gone = new Set([s.sessionId]);
    for (let grew = true; grew;) {
      grew = false;
      const add = (sid) => { if (sid && !gone.has(sid)) { gone.add(sid); grew = true; } };
      for (const x of Object.values(this.d.sessions)) if (x.parentSessionId && gone.has(x.parentSessionId)) add(x.sessionId);
      for (const b of Object.values(this.d.branches)) if (gone.has(b.parentSessionId)) add(b.sessionId);
    }
    for (const sid of gone) { delete this.d.sessions[sid]; delete this.d.turns[sid]; this.d.forgotten[sid] = at; }
    for (const [id, it] of Object.entries(this.d.items)) if (gone.has(it.anchor?.sessionId)) delete this.d.items[id];
    for (const [id, b] of Object.entries(this.d.branches)) if (gone.has(b.parentSessionId) || gone.has(b.sessionId)) delete this.d.branches[id];
    for (const [t, m] of Object.entries(this.d.terminals)) if (gone.has(m.sessionId)) delete this.d.terminals[t];
    for (const it of this.items()) if (it.branch && !this.d.branches[it.branch.branchId]) delete it.branch;
    const keys = Object.entries(this.d.forgotten).sort((a, b) => num(a[1]) - num(b[1])).map(([k]) => k);
    while (keys.length > 200) delete this.d.forgotten[keys.shift()];
  }

  // ── confluence (Phase 3) ─────────────────────────────────────────────
  // {type: "conclude", session_id: the trunk (the branch's parent), branch_id, item, text, message,
  // source, source_turn}: the panel's Send to trunk. The message is already on the clipboard and the
  // trunk's pane focused; nothing is typed. The branch becomes `concluded`, the question
  // `rejoin_pending` until the trunk's hook reports the message submitted (confluence_landed).
  on_conclude(ev, s, at) {
    const br = this.d.branches[ev.branch_id];
    if (!br || br.parentSessionId !== s.sessionId || br.status === "rejoined") return;
    if (["refused", "failed", "launching"].includes(br.status)) return;
    const it = this.item(br.requestId);
    br.conclusion = {
      text: String(ev.text ?? "").trim().slice(0, LIMITS.conclusion),
      message: String(ev.message ?? "").slice(0, LIMITS.conclusion + 2000),
      source: str(ev.source), sourceTurn: ev.source_turn ?? null, trunkTurn: s.turn, at,
    };
    br.status = "concluded";
    br.concludedAt = at;
    br.updatedAt = at;
    delete br.note;
    if (it && !isClosed(it)) {
      it.status = "rejoin_pending";
      it.rejoin = { branchId: br.id, at };
      it.updatedAt = at;
    }
  }

  // A rejoin_pending question reopened by the person: the confluence is called off. The branch goes
  // back to running; its edited conclusion is kept for the next Conclude.
  cancelRejoin(it, at) {
    const br = it.rejoin ? this.d.branches[it.rejoin.branchId] : null;
    delete it.rejoin;
    if (br && br.status === "concluded") { br.status = br.sessionId ? "running" : "launched"; br.updatedAt = at; }
  }

  // {type: "confluence_landed", session_id, terminal, turn, branch_id, item_id, prompt_id,
  // conclusion_head}: the hook saw a submitted prompt whose first line is the confluence marker.
  // In the branch's own trunk: the question is resolved by the branch, the branch rejoined, and one
  // line goes to the trunk's decisions.md (once per branch). Submitted elsewhere: noted, no change.
  on_confluence_landed(ev, s, at, out) {
    const br = this.d.branches[ev.branch_id];
    if (!br || (str(ev.item_id) && br.requestId !== ev.item_id)) return;
    if (br.parentSessionId !== s.sessionId) {
      br.note = `a confluence for this branch was submitted in session ${String(s.sessionId).slice(0, 8)}, not its trunk; nothing resolved`;
      br.updatedAt = at;
      return;
    }
    const turn = num(ev.turn, s.turn);
    const it = this.item(br.requestId);
    const first = br.status !== "rejoined";
    if (first) { br.status = "rejoined"; br.rejoinedTurn = turn; br.rejoinedAt = at; }
    else br.landedAgain = { turn, at };
    br.updatedAt = at;
    delete br.note;
    if (it) {
      if (it.status !== "resolved") {
        this.setStatus(it, "resolved", at);
        it.resolvedBy = "branch";
        it.resolvedTurn = turn;
      }
      it.resolution = { branchId: br.id, turn, at };
      delete it.rejoin;
    }
    if (first) {
      const head = str(ev.conclusion_head) ? conclusionHead(ev.conclusion_head) : conclusionHead(br.conclusion?.text);
      out.decisions.push({ sid: s.sessionId, key: `(${br.id})`, header: decisionsHeader(s),
        line: decisionLine({ at, turn, item: it ?? { handle: "?", text: "" }, branch: br, head }) });
    }
  }

  // {type: "answers_landed", session_id, terminal, turn, for_session, handles: ["A3"], answers:
  // {A3: "text"}, prompt_id}: the answer sheet (its marker line names the session) was submitted.
  // The listed asks of this session become answered; a sheet for another session is ignored.
  on_answers_landed(ev, s, at) {
    if (str(ev.for_session) && ev.for_session !== s.sessionId) return;
    const turn = num(ev.turn, s.turn);
    const answers = ev.answers && typeof ev.answers === "object" ? ev.answers : {};
    for (const h of Array.isArray(ev.handles) ? ev.handles : []) {
      const it = this.byHandle(s.sessionId, h);
      if (!it || !isAgentAsk(it) || isClosed(it)) continue;
      const a = squash(answers[it.handle]);
      if (a) it.answer = a.slice(0, LIMITS.text);
      it.answeredTurn = turn;
      it.answeredBy = "sheet";
      if (it.status !== "answered") this.setStatus(it, "answered", at); else it.updatedAt = at;
    }
  }

  // {type: "close_branch", session_id: the trunk, branch_id}: the panel's Close branch (offered after
  // rejoin). The writer ends the branch terminal (hc kill, hc rm); the record and its conclusion stay.
  on_close_branch(ev, s, at, out) {
    const br = this.d.branches[ev.branch_id];
    if (!br || br.parentSessionId !== s.sessionId || br.status !== "rejoined" || br.closedAt) return;
    br.closeRequestedAt = at;
    br.updatedAt = at;
    out.close.push(br.id);
  }

  // The writer's result for close_branch: { error } or { note }.
  branchClosed(id, { error = null, note = null, at = Date.now() } = {}) {
    const b = this.d.branches[id];
    if (!b) return false;
    if (error) b.closeError = String(error).slice(0, 300);
    else { b.closedAt = at; delete b.closeError; }
    if (note) b.note = String(note).slice(0, 200);
    b.updatedAt = at;
    return true;
  }

  // {type: "resume", session_id}: the panel's Resume session (the session's terminal is gone). The
  // writer starts `claude --resume <sid>` in a new pane (out.resume, branch.js resumeArgs); the
  // session's SessionStart hook then maps the new terminal. One launch at a time per session.
  on_resume(_ev, s, at, out) {
    if (s.resume && (s.resume.state === "launching" || s.resume.state === "launched") && at - num(s.resume.at) < 60000) return;
    s.resume = { at, state: "launching" };
    out.resume.push(s.sessionId);
  }

  // The writer's result for resume: { terminal, note } or { error }.
  resumeLaunched(sid, { terminal = null, error = null, note = null, at = Date.now() } = {}) {
    const s = this.d.sessions[sid];
    if (!s || !s.resume) return false;
    if (s.resume.state === "resumed") return true;      // the hook beat hc's reply
    s.resume = { ...s.resume, state: error ? "failed" : "launched", terminal, launchedAt: at,
      ...(error ? { error: String(error).slice(0, 300) } : {}), ...(note ? { note: String(note).slice(0, 200) } : {}) };
    return true;
  }

  on_capture(ev, s, at) {
    const r = ev.request;
    if (!r || typeof r !== "object" || !r.id || this.d.items[r.id]) return;
    const text = squash(r.text).slice(0, LIMITS.text);
    const n = norm(text);
    // Double-capture guard: same session, same text, within 30 s.
    if (n && this.itemsOf(s.sessionId).some((it) => isHuman(it) && norm(it.text) === n && Math.abs(num(it.createdAt) - num(r.createdAt, at)) < LIMITS.dupWindowMs)) return;
    const anchor = { ...(r.anchor ?? {}), sessionId: s.sessionId };
    if (!anchor.uuid && anchor.messageUuid) anchor.uuid = anchor.messageUuid;
    delete anchor.messageUuid;
    if (anchor.quote) anchor.quote = String(anchor.quote).slice(0, LIMITS.quote);
    if (!anchor.hash) anchor.hash = passageHash(anchor.quote || text);
    anchor.turn = num(anchor.turn, s.turn);
    // No hooks: the box cannot know the status-driven turn; the store does.
    if (s.turnSource === "herdr-status") anchor.turn = s.turn;
    if (anchor.settled === undefined) anchor.settled = s.state !== "working";
    this.d.items[r.id] = {
      ...r, text, key: r.id, handle: `Q${s.nextHandle.Q++}`, direction: HUMAN,
      kind: Q_KINDS.has(r.kind) ? r.kind : text ? "question" : "bookmark", anchor, status: "open",
      createdTurn: s.turnSource === "herdr-status" ? s.turn : num(r.createdTurn, anchor.turn), createdAt: num(r.createdAt, at), updatedAt: at, seq: 0,
    };
  }

  turnRec(sid, turn) {
    const all = (this.d.turns[sid] ??= {});
    const rec = (all[turn] ??= {});
    const keys = Object.keys(all).map(Number).sort((a, b) => a - b);
    while (keys.length > 60) delete all[keys.shift()];
    return rec;
  }

  // ── the human's acts (spec 6.3) ──────────────────────────────────────
  setStatus(it, status, at = Date.now()) {
    if (!it) return;
    it.status = status;
    it.updatedAt = at;
    const s = this.d.sessions[it.anchor?.sessionId];
    if (status === "resolved" || status === "dismissed") { it.resolvedAt = at; it.resolvedTurn = s?.turn ?? it.resolvedTurn; }
    else { delete it.resolvedAt; delete it.resolvedTurn; }
    if (status !== "deferred") delete it.deferUntil;
  }

  act(id, action, arg, at = Date.now()) {
    const it = this.item(id);
    if (!it) return false;
    if (action === "resolve") this.setStatus(it, "resolved", at);
    else if (action === "dismiss") this.setStatus(it, "dismissed", at);
    else if (action === "reopen") { const was = it.status; this.setStatus(it, "open", at); delete it.note; if (was === "rejoin_pending" || it.rejoin) this.cancelRejoin(it, at); }
    else if (action === "defer") { this.setStatus(it, "deferred", at); it.deferUntil = arg ?? "next_session"; }
    else if (action === "draft") { it.draft = String(arg ?? "").slice(0, LIMITS.text); it.updatedAt = at; }
    else if (action === "btw") { it.btwStagedAt = at; it.updatedAt = at; }
    // A suggestion (below extract.threshold) becomes an open row that counts; it stays so whatever
    // the threshold later is. Only agent asks have a level.
    else if (action === "promote") { if (!isAgentAsk(it)) return false; it.promoted = true; it.promotedAt = at; it.updatedAt = at; }
    else return false;
    return true;
  }

  // Deferred items whose time has come open again. Returns true when something changed.
  wake(now = Date.now()) {
    let changed = false;
    for (const it of this.items()) {
      if (it.status === "deferred" && typeof it.deferUntil === "number" && it.deferUntil <= now) { this.setStatus(it, "open", now); changed = true; }
    }
    return changed;
  }

  // The panel was shown on this session: its chip goes to "seen".
  markSeen(sid, now = Date.now()) {
    const s = this.d.sessions[sid];
    if (!s || (!s.surfaced && num(s.seenAt) >= now - 1000)) return false;
    const was = s.surfaced;
    s.surfaced = false; s.seenAt = now;
    return was;
  }

  // An agent went working -> idle with no stop event (interrupt, spec 6.5).
  interrupted(sid, now = Date.now()) {
    const s = this.d.sessions[sid];
    if (!s || s.state !== "working") return false;
    s.state = "idle";
    for (const it of this.itemsOf(sid)) if (isHuman(it) && it.anchor && !it.anchor.settled) { it.anchor.settled = true; it.anchor.interrupted = true; it.updatedAt = now; }
    if (this.itemsOf(sid).some((it) => this.counts(it) && num(it.updatedAt) > num(s.seenAt))) s.surfaced = true;
    return true;
  }

  // Tier 3 (spec 2.9): a session without hooks ("herdr:<t>", turnSource "herdr-status") takes
  // its turns from Herdr's agent status: idle -> working starts one, working -> idle/done ends it.
  statusTurn(sid, status, now = Date.now()) {
    const s = this.d.sessions[sid];
    if (!s || s.turnSource !== "herdr-status" || s.state === "ended") return false;
    if (status === "working" && s.state !== "working") {
      s.turn += 1; s.state = "working"; s.promptAt = now; s.seenAt = now; s.surfaced = false;
      return true;
    }
    if ((status === "idle" || status === "done") && s.state === "working") {
      s.state = "idle"; s.lastStopAt = now;
      for (const it of this.itemsOf(sid)) if (isHuman(it) && it.anchor && !it.anchor.settled) { it.anchor.turn = s.turn; it.anchor.settled = true; it.updatedAt = now; }
      if (this.itemsOf(sid).some((it) => this.counts(it) && num(it.updatedAt) > num(s.seenAt))) s.surfaced = true;
      return true;
    }
    return false;
  }

  // ── derived ──────────────────────────────────────────────────────────
  // shared("ledgr.chips"): { [terminal]: { s, q, a, st, t, ag, [b], [p] } } (spec 3.2, 6.5).
  // `a` counts open asks at or above extract.threshold (suggestions do not count); `b` the open
  // blocking ones among them. `st`: "collecting" (working, questions parked this turn), else
  // "blocking" (an open blocking ask, agent not working), else "surfaced" or "seen".
  // `p`: the turn whose asks are being extracted (a pending event under 30 s old).
  chips(now = Date.now()) {
    const out = {};
    for (const [t, m] of Object.entries(this.d.terminals)) {
      const s = this.d.sessions[m.sessionId];
      if (!s || s.state === "ended") continue;
      const mine = this.itemsOf(s.sessionId).filter((it) => this.counts(it));
      const q = mine.filter(isHuman).length, a = mine.filter(isAgentAsk).length, b = mine.filter(isBlocking).length;
      const p = this.pendingTurn(s.sessionId, now);
      if (!q && !a && p === null) continue;
      const parked = mine.filter((it) => isHuman(it) && num(it.createdAt) >= num(s.promptAt)).length;
      const st = s.state === "working" && parked ? "collecting" : b && s.state !== "working" ? "blocking" : s.surfaced ? "surfaced" : "seen";
      out[t] = { s: s.sessionId, q, a, st, t: s.turn, ag: agentLabel(m.agent ?? s.agent), ...(b ? { b } : {}), ...(p !== null ? { p } : {}) };
    }
    return out;
  }

  pendingTurn(sid, now = Date.now()) {
    const pd = this.d.sessions[sid]?.pending;
    return pd && now - num(pd.at) < 30000 ? num(pd.turn) : null;
  }

  // Closed items older than `days` (spec 3.2). The caller appends them to
  // ledgr-data/archive/<yyyy-mm>.jsonl, then removes them with removeItems().
  archivable(days, now = Date.now()) {
    const cut = now - days * 86400e3;
    return this.items().filter((it) => isClosed(it) && num(it.resolvedAt ?? it.updatedAt) < cut);
  }

  removeItems(list) {
    for (const it of list) delete this.d.items[it.id];
  }

  // ledgr-data/snapshot.json, read by the extractor: open, answered and deferred items, plus
  // items dismissed in the last 7 days (so the model can mark a re-raise with repeat_of);
  // quotes over 200 characters dropped.
  snapshot(now = Date.now()) {
    const recent = (it) => it.status === "dismissed" && num(it.resolvedAt ?? it.updatedAt) >= now - 7 * 86400e3;
    const items = this.items().filter((it) => OPEN_STATES.has(it.status) || recent(it)).map((it) => {
      const c = { ...it, sessionId: it.anchor?.sessionId ?? null, anchor: { ...it.anchor } };
      if (c.anchor.quote && c.anchor.quote.length > 200) delete c.anchor.quote;
      delete c.draft;
      return c;
    });
    return { v: 1, updatedAt: now, items };
  }
}
