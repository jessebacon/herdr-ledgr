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
//
// Who closed an ask (2026-11-06): `resolvedBy` "branch" (a confluence landed), "agent" (the agent's
// resolve_asks, bin/mcp: an `act` event with `actor: "agent"` and the ask's `handle`), "answer" (the
// person answered it, by an [A3] ref or the answer sheet, and the agent's next reply did not raise it
// again: settled at that turn's asks event, settleAnswered); none: the person closed it. The chip's
// blocking state no longer yields to working: an open blocking ask is "blocking" while the agent works
// too (`w: 1` marks a working session), so a prompt or a permission wait never hides it.
//
// Spaces (2026-11-07): config.json spaces.disabled lists the Herdr spaces where ledgr is off. The
// hooks record a terminal's space as `space` (identity map, session_start and prompt events, when
// they send it); the store keeps it on the session and on the terminal mapping. chips() leaves out
// every terminal whose space is off (`spacesOff`, set by the writer): the recorded space, else the
// live one the caller passes (config.js terminalSpace). Items are kept, only hidden.
//
// Clear all questions (2026-11-07): {type: "clear_questions", session_id, keep: ["branched",
// "rejoin_pending"]} (the panel's Clear N) dismisses every open or deferred parked question of the
// session that has no branch, with `dismissedBy: "clear"` and `clearedAt`; branched and rejoin_pending
// questions always stay. Reopen works per item (setStatus drops both marks).
//
// Pins (2026-11-07, docs/design/Pins.md): a passage the person keeps verbatim from an agent's reply.
// Pins live in their own map, `d.pins` ({[pn_id]: Pin}), beside `items`, so nothing that reads items
// (the chips, the snapshot, the archive, on_prompt's refs, Forget) ever treats one as waiting on
// someone. `pin` (the box: ⌘J, ⌘S) creates one (P1, P2… per session; the same passage again in the
// same session restores or re-dates the one pin); `pin_note`, `pin_archive`, `pin_restore`,
// `pin_delete` (the panel) are applied by pin id whatever became of its session (PIN_OPS); only an
// archived pin can be deleted, and Forget keeps a session's pins (each carries its `source`). A
// parked question may carry pins (`capture`'s `request.pins`, validated); asked in the trunk its
// `pins_asked` (the hook saw the `ledgr pins <session> <item>` marker) marks it sent, and that turn's
// Stop records `answeredIn` on each pin; a confluence that lands does the same with its branch.
import { createHash, randomUUID } from "crypto";
import { LIMITS, agentLabel } from "./config.js";
import { DEFAULT_MAX_DEPTH, manifest, preamble, branchName, branchLabel, depthOf } from "./branch.js";
import { conclusionHead, decisionLine, decisionsHeader, pinText } from "./confluence.js";

const EMPTY = () => ({ v: 1, items: {}, sessions: {}, branches: {}, terminals: {}, turns: {}, ingested: [], forgotten: {}, pins: {} });
const OPEN_STATES = new Set(["open", "answered", "deferred", "rejoin_pending"]);
const AGENT = "agent_to_human", HUMAN = "human_to_agent";
const ASK_KINDS = new Set(["decide", "confirm", "do", "provide", "review"]);
const Q_KINDS = new Set(["question", "note", "bookmark"]);
// The panel's own pin events: applied by pin id (a pin outlives its session), never creating one.
const PIN_OPS = new Set(["pin_note", "pin_archive", "pin_restore", "pin_delete"]);
const OWN_EVENTS = new Set(["act", "retry", "branch", "forget", "conclude", "close_branch", "resume", "clear_questions", ...PIN_OPS]);
export const PIN_ID = /^pn_[A-Za-z0-9-]{8,64}$/;
// A key the map itself holds: `__proto__`, `constructor` or `toString` would otherwise reach
// Object.prototype through a plain lookup (a pin id comes from a spool event or a Request).
const own = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);

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
// A turn group of the asks lane (panel.js): open when the person opened it; else when it is the newest
// group or holds an open blocking ask (`blocking`, a count), unless the person folded it. Folds are the
// person's: a click always wins over both defaults.
export const groupOpen = ({ newest = false, blocking = 0, unfolded = false, folded = false } = {}) =>
  Boolean(unfolded || ((newest || blocking > 0) && !folded));

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

// Pin search folding (capture.js unmark, plus `_` and case): lower case, `*`, backtick and `_`
// dropped, whitespace collapsed. Applied to the query's terms and to every field searched.
export const foldPin = (s) => String(s ?? "").toLowerCase().replace(/[*`_]+/g, "").replace(/\s+/g, " ").trim();
// The query's terms: words split on whitespace, "double-quoted phrases" (straight or curly) kept whole.
export function pinTerms(query) {
  const out = [], re = /["“]([^"”]*)["”]|(\S+)/g;
  let m;
  while ((m = re.exec(String(query ?? ""))) !== null) {
    const t = foldPin(m[1] ?? String(m[2]).replace(/^["“”]+|["“”]+$/g, ""));
    if (t) out.push(t);
  }
  return out;
}
// What a pin is searched by: its text, note, session name, repo and the last part of its folder.
// Folded once per pin and kept while its `updatedAt` holds (every change to a pin sets it), so a render
// that searches does not fold every pin again; a WeakMap, so nothing reaches store.json.
const HAYSTACKS = new WeakMap();
export function pinHaystack(p) {
  const c = p && typeof p === "object" ? HAYSTACKS.get(p) : null;
  if (c && c.at === p.updatedAt) return c.h;
  const h = [p?.text, p?.note, p?.source?.sessionName, p?.source?.repo, String(p?.source?.cwd ?? "").split("/").filter(Boolean).pop()]
    .map(foldPin).filter(Boolean).join(" \u0001 ");
  if (p && typeof p === "object") HAYSTACKS.set(p, { at: p.updatedAt, h });
  return h;
}

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
// A record or event that says which space its terminal is in (`space`: an id, or null for unknown).
const hasSpace = (r) => Boolean(r) && typeof r === "object" && Object.prototype.hasOwnProperty.call(r, "space");
// A terminal mapping's `space` field: the event's (or record's) when it carries one, else the old one's.
const spaceField = (r, cur) => (hasSpace(r) ? { space: str(r.space) } : cur?.space !== undefined ? { space: cur.space } : {});

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
    // config.json spaces.disabled (config.js disabledSpaces); the writer sets it, chips() reads it.
    this.spacesOff = new Set();
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
  // ── pins ──
  pins() { return Object.values(this.d.pins); }
  // A pin by id: only an id of the pin pattern that the map itself holds (never a prototype key).
  pin(id) { return typeof id === "string" && PIN_ID.test(id) && own(this.d.pins, id) ? this.d.pins[id] : null; }
  // Every pin of a session, whatever its status.
  pinsOfSession(sid) { return this.pins().filter((p) => p.sessionId === sid); }
  // A parked question's pins in its order; ids of pins since deleted are skipped.
  pinsOf(item) { return (Array.isArray(item?.pins) ? item.pins : []).map((id) => this.pin(id)).filter(Boolean); }
  // A branch's pins as its preamble numbered them at launch (`br.pins`, the ids frozen then): a pin
  // deleted since stays as null, so pin 2 is still pin 2 in the Conclude skeleton and the confluence.
  // A branch launched before the ids were kept: the question's pins now.
  branchPins(br) {
    if (Array.isArray(br?.pins)) return br.pins.map((id) => this.pin(id));
    return this.pinsOf(this.item(br?.requestId));
  }
  // A session's pins, newest first: open ones (archived false, the default), archived ones (true), or
  // both ("all").
  pinsIn(sid, { archived = false } = {}) {
    return this.pinsOfSession(sid).filter((p) => archived === "all" || (archived ? p.status === "archived" : p.status !== "archived"))
      .sort((a, b) => num(b.createdAt) - num(a.createdAt));
  }
  pinByHandle(sid, handle) {
    const h = String(handle ?? "").replace(/[[\]]/g, "").toUpperCase();
    return this.pinsOfSession(sid).find((p) => p.handle === h) ?? null;
  }
  // Search over every session's pins (the panel's PINS search box), pure and in memory: the store is
  // the whole corpus (pins never move to archive/). Metadata first (scope "all" or "here", the shown
  // session; status open, or open and archived with `archived`), then literal terms (pinTerms: words,
  // "quoted phrases" whole), each of which must occur in the pin's folded text, note, session name, repo
  // or folder name. Newest first, at most `limit`, grouped by session: the shown session's group
  // first, the others by their newest match. Returns {total, groups: [{sessionId, pins}]}.
  searchPins(query, { here = null, scope = "all", archived = false, limit = LIMITS.pinSearch } = {}) {
    const terms = pinTerms(query);
    const hit = this.pins()
      .filter((p) => p.status === "open" || (archived === true && p.status === "archived"))
      .filter((p) => scope !== "here" || p.sessionId === here)
      .filter((p) => { const h = pinHaystack(p); return terms.every((t) => h.includes(t)); })
      .sort((a, b) => num(b.createdAt) - num(a.createdAt));
    const groups = [], by = new Map();
    for (const p of hit.slice(0, Math.max(0, num(limit, LIMITS.pinSearch)))) {
      let g = by.get(p.sessionId);
      if (!g) { g = { sessionId: p.sessionId, pins: [] }; by.set(p.sessionId, g); groups.push(g); }
      g.pins.push(p);
    }
    groups.sort((a, b) => Number(b.sessionId === here) - Number(a.sessionId === here));
    return { total: hit.length, groups };
  }
  // A parked question with a branch: a branch record that started or is starting (not refused, not
  // failed), or a confluence staged. Clear all questions never clears one.
  isBranched(it) {
    return Boolean(it?.rejoin) || it?.status === "rejoin_pending"
      || this.branchesFor(it?.id).some((b) => b.status !== "refused" && b.status !== "failed");
  }
  // The parked questions Clear all would dismiss (open or deferred, no branch) and the ones it keeps
  // (open, deferred or rejoin_pending, with a branch): { clear: [items], kept: [items] }.
  clearable(sid) {
    const clear = [], kept = [];
    for (const it of this.itemsOf(sid)) {
      if (!isHuman(it)) continue;
      const active = it.status === "open" || it.status === "deferred";
      if (this.isBranched(it)) { if (active || it.status === "rejoin_pending") kept.push(it); }
      else if (active) clear.push(it);
    }
    return { clear, kept };
  }
  // The space terminal t (session s) is in: what the hooks recorded (the terminal's, else the
  // session's), else what `live(t)` says (config.js terminalSpace); null when unknown.
  spaceOf(t, s, live = null) {
    const rec = str(this.d.terminals[t]?.space) ?? str(s?.space);
    if (rec) return rec;
    try { return t && live ? str(live(t)) : null; } catch { return null; }
  }
  // Is ledgr off for terminal t (session s): its space is in spaces.disabled.
  isOff(t, s, live = null) {
    if (!this.spacesOff.size) return false;
    const sp = this.spaceOf(t, s, live);
    return Boolean(sp) && this.spacesOff.has(sp);
  }
  isForgotten(sid) { return Boolean(sid && this.d.forgotten[sid]); }
  sessionForTerminal(t) { return this.d.terminals[t]?.sessionId ?? null; }

  session(sid, ev = {}) {
    let s = this.d.sessions[sid];
    if (!s) {
      s = this.d.sessions[sid] = {
        sessionId: sid, agent: ev.agent ?? "claude-code", terminal: ev.terminal ?? null, sessionName: null,
        cwd: ev.cwd ?? "", repo: null, transcriptPath: null, model: null, turn: 0, turnSource: "hooks",
        state: "idle", nextHandle: { A: 1, Q: 1, P: 1 }, startedAt: ev.at ?? Date.now(), updatedAt: ev.at ?? Date.now(),
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
    this.setProfile(s, rec);
    this.setSpace(s, rec);
    if (num(rec.turn) > s.turn) s.turn = num(rec.turn);
    if (rec.parent_session_id && !s.parentSessionId) this.setLineage(s, { parent_session_id: rec.parent_session_id, branch_id: rec.branch_id,
      item_id: rec.parent_item, anchor_turn: rec.anchor_turn, fork_turn: rec.fork_turn, depth: rec.depth });
    if (rec.state && num(rec.updated_at) >= num(s.updatedAt)) s.state = rec.state;
    s.updatedAt = Math.max(num(s.updatedAt), num(rec.updated_at));
    const cur = this.d.terminals[rec.terminal];
    if (!cur || num(rec.updated_at) >= num(cur.updatedAt)) {
      this.d.terminals[rec.terminal] = { sessionId: rec.session_id, agent: rec.agent ?? s.agent, updatedAt: num(rec.updated_at),
        ...spaceField(rec, cur) };
    }
    return true;
  }

  // An identity-map record changed on disk (the writer watches ledgr-data/terminals/): only its space
  // is taken, onto the terminal's mapping and its session. Returns true when something changed.
  noteSpace(rec) {
    if (!rec?.terminal || !hasSpace(rec)) return false;
    const sp = str(rec.space);
    let changed = false;
    const m = this.d.terminals[rec.terminal];
    if (m && (m.space ?? null) !== sp) { m.space = sp; changed = true; }
    const s = rec.session_id && !this.isForgotten(rec.session_id) ? this.d.sessions[rec.session_id] : null;
    if (s && (s.space ?? null) !== sp) { s.space = sp; changed = true; }
    return changed;
  }

  // The agent's config folder and profile, when the hooks report them (session_start, prompt and the
  // map entry; a Claude Code with CLAUDE_CONFIG_DIR=~/.claude-work is "work", ~/.claude "default").
  // A session recorded before profiles existed picks them up at its next such event.
  setProfile(s, r) {
    if (typeof r?.config_dir === "string" && r.config_dir) s.configDir = r.config_dir;
    if (typeof r?.profile === "string" && r.profile) s.profile = r.profile;
  }

  // The Herdr space the hooks recorded for the session's terminal (`space`: an id, or null when they
  // could not tell). An event or record without the key leaves it as it was.
  setSpace(s, r) {
    if (hasSpace(r)) s.space = str(r.space);
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
    // The panel's pin events go by pin id, before the session checks: a pin outlives its session, so
    // a forgotten (or never recorded) session's pin can still be noted, archived or deleted. Each
    // handler finds its pin through pin(), so an id that is no pin (`__proto__`) changes nothing.
    if (PIN_OPS.has(ev.type)) this[`on_${ev.type}`](ev, at, out);
    else if (sid && this.isForgotten(sid)) { /* a forgotten session: recorded and dropped */ }
    else if (sid && own && !this.d.sessions[sid]) { /* unknown session: recorded and dropped */ }
    else if (sid && own) {
      const fn = this[`on_${ev.type}`];
      fn.call(this, ev, this.d.sessions[sid], at, out);
    } else if (sid) {
      const s = this.session(sid, { ...ev, at });
      if (ev.terminal) {
        s.terminal = ev.terminal;
        const cur = this.d.terminals[ev.terminal];
        if (!cur || at >= num(cur.updatedAt)) this.d.terminals[ev.terminal] = { sessionId: sid, agent: ev.agent ?? s.agent, updatedAt: at, ...spaceField(ev, cur) };
      }
      if (ev.agent) s.agent = ev.agent;
      this.setProfile(s, ev);
      this.setSpace(s, ev);
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
        it.answeredTurn = turn;   // settleAnswered: this turn's reply decides whether the answer took
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
    // A pin taken from the screen while the agent worked settles here; the settle entry below makes
    // the writer look for its passage in the saved turns (writer.js reanchor).
    const pins = this.pinsOfSession(s.sessionId);
    for (const p of pins) {
      if (p.anchor?.settled === false && num(p.anchor.turn) <= turn) { p.anchor.turn = turn; p.anchor.settled = true; p.updatedAt = at; }
    }
    // The stop event's uuid (optional) goes on every item and pin of this turn that has none.
    const uuid = str(ev.message_uuid) ?? str(ev.uuid) ?? str(ev.last_assistant_uuid);
    if (uuid) {
      ti.uuid = uuid;
      for (const it of this.itemsOf(s.sessionId)) {
        if (it.anchor && num(it.anchor.turn) === turn && !it.anchor.uuid) { it.anchor.uuid = uuid; if (ev.api_message_id) it.anchor.apiMessageId = ev.api_message_id; }
      }
      for (const p of pins) if (p.anchor && num(p.anchor.turn) === turn && !p.anchor.uuid) p.anchor.uuid = uuid;
    }
    // A question asked with its pins at this turn (pins_asked): the reply ended, so each pin records
    // where it was answered (once per question and turn). The question itself became answered above.
    for (const it of this.itemsOf(s.sessionId)) {
      if (!isHuman(it) || !it.pinsAsked || num(it.pinsAsked.turn, -1) !== turn || it.pinsAsked.answeredAt) continue;
      it.pinsAsked.answeredAt = at;
      it.updatedAt = at;
      this.markPinsAnswered(it, { question: it.id, session: s.sessionId, handle: it.handle, turn, via: "trunk", at },
        (a) => a.question === it.id && a.via === "trunk" && num(a.turn) === turn);
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
    // ...and on the session's settled pins of that turn (an unsettled screen pin waits for its Stop).
    if (uuid) for (const p of this.pinsOfSession(s.sessionId)) if (p.anchor && p.anchor.settled !== false && num(p.anchor.turn) === turn && !p.anchor.uuid) p.anchor.uuid = uuid;
    // A declare_asks call (source "tool", bin/mcp) arrives mid-turn with its call number; the turn's
    // own asks event (the Stop hook's, which re-emits the declaration with verified quotes and the
    // message uuid) has none and settles the turn like a block's.
    const midTurn = ev.source === "tool" && num(ev.tool_call, 0) > 0;
    if (!midTurn && s.pending && num(s.pending.turn) <= turn) delete s.pending;
    // A reply too short to extract ("skip") raised nothing: answered asks settle. An error says nothing.
    if (ev.source === "skip" && !midTurn) this.settleAnswered(s, turn, new Set(), at);
    if (ev.source === "skip" || ev.source === "error" || !Array.isArray(ev.asks)) return;
    const tool = ev.source === "tool";
    const origin = tool ? "tool" : ev.source === "block" ? "extract_block" : "extract_model";
    // replaces_turn: a later declaration of the same turn is the turn's whole list. This turn's tool
    // asks it no longer names go, unless the person has touched them (not open, promoted, answered
    // or drafted); one it still names keeps its handle (matched below by turn and text, then key).
    if (tool && ev.replaces_turn === true) {
      const keep = new Set(ev.asks.map((a) => norm(squash(a?.text))));
      for (const it of this.itemsOf(s.sessionId)) {
        if (isAgentAsk(it) && it.origin === "tool" && num(it.createdTurn) === turn && it.status === "open" && it.promoted !== true
          && !it.answer && !it.draft && !keep.has(norm(it.text))) delete this.d.items[it.id];
      }
    }
    let created = 0;
    const raised = new Set();   // items this turn's asks named again (settleAnswered leaves them)
    ev.asks.forEach((a, i) => {
      const text = squash(a?.text).slice(0, LIMITS.text);
      if (!text) return;
      const quote = str(a.quote) ? String(a.quote).slice(0, LIMITS.quote) : null;
      const hash = str(a.hash) ?? (quote ? passageHash(quote) : passageHash(text));
      const key = `${s.sessionId}|a|${norm(text)}`;
      // No `options` key at all (the Stop hook's re-emit of a declaration that did not keep them):
      // an existing item keeps its options and recommendation.
      const hasOpts = Array.isArray(a.options);
      const options = hasOpts ? a.options.filter((o) => typeof o === "string").slice(0, 8) : [];
      // The hooks' validator always sends a level; an older event has only `blocking`.
      const level = LEVELS.includes(a.level) ? a.level : a.blocking === true ? "blocking" : "needed";
      const fields = {
        text, kind: ASK_KINDS.has(a.kind) ? a.kind : "do", level, options,
        recommended: options.includes(a.recommended) ? a.recommended : null,
        blocking: level === "blocking",
      };
      if (!hasOpts) { delete fields.options; delete fields.recommended; }
      // Quote source: the block's, the model's, or the tool's ("tool_unverified" until the Stop hook
      // has checked the quote against the turn's text).
      const quoteSource = tool ? (a.quote_verified === false ? "tool_unverified" : "tool") : ev.source === "block" ? "block" : "model";
      const anchor = { sessionId: s.sessionId, turn, promptId: ev.prompt_id ?? null, uuid, apiMessageId: ev.api_message_id ?? null,
        quote, quoteSource, hash, settled: true };
      const mine = this.itemsOf(s.sessionId).filter(isAgentAsk);
      // Same turn and passage: the same item (a replayed or re-run extraction).
      // A tool ask declared again (or settled at Stop) keeps its item whatever its quote became.
      const same = mine.find((it) => num(it.anchor?.turn) === turn && norm(it.text) === norm(text)
        && (it.anchor?.hash === hash || (tool && it.origin === "tool")));
      if (same) {
        raised.add(same.id);
        Object.assign(same, fields); same.updatedAt = at;
        if (tool) {
          same.anchor = { ...same.anchor, ...anchor, uuid: uuid ?? same.anchor?.uuid ?? null, promptId: anchor.promptId ?? same.anchor?.promptId ?? null };
          if (!midTurn && same.status === "open" && this.counts(same)) created++;   // the turn ended with it: surface the chip
        }
        return;
      }
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
        raised.add(prior.id);
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
      if (!hasOpts) Object.assign(this.d.items[id], { options: [], recommended: null });
      if (this.counts(this.d.items[id])) created++;   // a new suggestion alone does not surface the chip
    });
    // After the re-raise rules (a re-raised answered ask has reopened in place): the rest settle.
    if (!midTurn) this.settleAnswered(s, turn, raised, at);
    if (created && s.state !== "working" && !midTurn) s.surfaced = true;
  }

  // Answered, then settled: an agent ask the person answered (an [A3] ref in a prompt, or the answer
  // sheet) at this turn or an earlier one, that this turn's asks did not raise again, is done: resolved,
  // `resolvedBy: "answer"` ("answered by you"). Runs on the turn's own asks event (the Stop settle; never
  // a mid-turn declaration), after the re-raise rules. An ask answered after this turn (a prompt that
  // beat a slow extraction, or a re-run of an older turn) waits for its own turn's reply. An answer
  // recorded before answeredTurn existed counts as given the turn after the ask's own (its anchor's)
  // turn, the earliest it can have been. Parked questions the agent answered keep their status.
  settleAnswered(s, turn, raised, at) {
    for (const it of this.itemsOf(s.sessionId)) {
      if (!isAgentAsk(it) || it.status !== "answered" || raised.has(it.id)) continue;
      const answered = it.answeredTurn !== undefined && it.answeredTurn !== null ? num(it.answeredTurn) : num(it.anchor?.turn) + 1;
      if (answered > turn) continue;
      this.setStatus(it, "resolved", at);
      it.resolvedBy = "answer";
    }
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
  // The agent's resolve_asks (bin/mcp, ledgr_spool.act) posts {type: "act", session_id, item, handle:
  // "A4", action: "resolve", arg: null, actor: "agent", turn, [note]}, one per handle: only resolve, only
  // an agent ask still open, answered or deferred; it gets `resolvedBy: "agent"`, `resolvedTurn` from
  // `turn` when given and `resolvedNote` from `note` (one line). Anything else the agent sends is
  // dropped. Any other actor (none, "person", unknown) is the person. `handle` finds the item when
  // `item` is absent or unknown.
  on_act(ev, s, at) {
    if (ev.action === "seen") { this.markSeen(s.sessionId, at); return; }
    const it = this.item(ev.item) ?? (str(ev.handle) ? this.byHandle(s.sessionId, ev.handle) : null);
    if (!it || it.anchor?.sessionId !== s.sessionId) return;
    if (ev.actor === "agent") {
      if (ev.action !== "resolve" || !isAgentAsk(it) || isClosed(it)) return;
      this.setStatus(it, "resolved", at);
      it.resolvedBy = "agent";
      if (ev.turn !== null && ev.turn !== undefined && Number.isFinite(Number(ev.turn))) it.resolvedTurn = num(ev.turn);
      const note = squash(ev.note).slice(0, 200);
      if (note) it.resolvedNote = note;
      return;
    }
    this.act(it.id, ev.action, ev.arg, at);
  }

  // {type: "clear_questions", session_id, keep: ["branched", "rejoin_pending"]}: the panel's Clear N
  // (two clicks). Every open or deferred parked question of the session without a branch becomes
  // dismissed, `dismissedBy: "clear"`, `clearedAt`; the Closed list labels it "cleared" and Reopen
  // brings it back. Questions with a branch and rejoin_pending ones are never cleared, whatever `keep`
  // says. The counts go on the session as `lastClear`.
  on_clear_questions(_ev, s, at) {
    const { clear, kept } = this.clearable(s.sessionId);
    for (const it of clear) {
      this.setStatus(it, "dismissed", at);
      it.dismissedBy = "clear";
      it.clearedAt = at;
    }
    s.lastClear = { at, cleared: clear.length, kept: kept.length };
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
    // The pins the preamble quotes, numbered 1 to n: their ids are frozen on the record (branchPins), so
    // the Conclude skeleton and the confluence keep those numbers whatever happens to a pin later.
    const pins = this.pinsOf(it);
    this.d.branches[bid] = {
      id: bid, requestId: it?.id ?? str(ev.item), parentSessionId: s.sessionId, parentTerminal: s.terminal ?? null,
      sessionId: null, childSid: refused ? null : randomUUID(), terminal: null, name, label: it ? branchLabel(it) : name,
      depth: m?.depth ?? depthOf(this, s.sessionId) + 1, anchorTurn: m?.anchorTurn ?? null, forkTurn: m?.forkTurn ?? null,
      anchorHash: it?.anchor?.hash ?? null, anchorUuid: it?.anchor?.uuid ?? null, quote: it?.anchor?.quote ?? null,
      policy: "fork_end_of_session", placement: ev.placement === "agent" ? "agent" : "split", isolate: ev.isolate === true,
      cwd: s.cwd ?? "", manifest: m, preamble: refused ? null : preamble(it, m, name, pins), ...(pins.length ? { pins: pins.map((p) => p.id) } : {}),
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
  // Its pins stay (each keeps its `source`, and its usedIn/answeredIn keep handle and head).
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
      // The question's pins were answered by this branch (once per question and branch).
      this.markPinsAnswered(it, { question: it.id, session: s.sessionId, handle: it.handle, turn, via: "branch", branch: br.id, branchName: br.name ?? null, at },
        (a) => a.question === it.id && a.via === "branch" && a.branch === br.id);
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
      if (a) it.answer = a.slice(0, LIMITS.answer);   // the whole answer (the draft's cap), so a draft is compared whole (listing.js draftPending)
      it.answeredTurn = turn;
      it.answeredBy = "sheet";
      if (it.status !== "answered") this.setStatus(it, "answered", at); else it.updatedAt = at;
    }
  }

  // {type: "pins_asked", session_id, terminal, turn, for_session, item_id, prompt_id}: the hook saw a
  // submitted prompt holding the pins message's marker (`ledgr pins <session> <item>`): the question
  // was asked in its trunk with its pins. Sent there, it shows "sent at turn N" (askedAtTurn) and
  // becomes answered at that turn's Stop (on_stop, which also records answeredIn on each pin); pasted
  // again, pinsAsked moves to the new turn. Sent in another session: noted on the question, nothing
  // marked. Not a parked question (or unknown): nothing.
  on_pins_asked(ev, s, at) {
    const it = this.item(ev.item_id);
    if (!it || !isHuman(it)) return;
    const own = it.anchor?.sessionId;
    if (own !== s.sessionId || (str(ev.for_session) && ev.for_session !== own)) {
      it.note = `the pins message for ${it.handle ?? "this question"} was sent in session ${String(s.sessionId).slice(0, 8)}, not its own; nothing marked`;
      it.updatedAt = at;
      return;
    }
    const turn = num(ev.turn, s.turn);
    it.askedAtTurn = turn;
    it.askedVia = "pins";
    it.pinsAsked = { turn, at, promptId: str(ev.prompt_id) };
    it.updatedAt = at;
  }

  // ── pins ─────────────────────────────────────────────────────────────
  // {type: "pin", session_id, terminal, agent, turn, session_name, cwd, pin: {id, text, note, anchor:
  // {sessionId, terminal, turn, uuid, promptId, hash, quoteSource, verified, settled, approx},
  // createdTurn, createdAt}}: the box's ⌘S. Like `capture` it may create its session (a herdr:<t> one
  // too); a forgotten session's is dropped by apply(). The text is kept verbatim (pinText: line breaks
  // kept, only CR/CRLF and the outer whitespace change), cut at LIMITS.pin (`clipped`). The same
  // passage again in the same session (its anchor hash) makes no second pin: an archived one is
  // restored, and either takes the new note when it has none and `repinnedAt`.
  on_pin(ev, s, at) {
    const p = ev.pin;
    if (!p || typeof p !== "object" || !PIN_ID.test(String(p.id ?? "")) || own(this.d.pins, p.id)) return;
    let text = pinText(p.text);
    if (!text) return;
    let clipped = false;
    if (text.length > LIMITS.pin) { text = text.slice(0, LIMITS.pin); clipped = true; }
    const a = p.anchor && typeof p.anchor === "object" ? p.anchor : {};
    const hash = str(a.hash) ?? passageHash(text);
    const note = squash(p.note).slice(0, LIMITS.pinNote) || null;
    const same = this.pinsOfSession(s.sessionId).find((x) => x.anchor?.hash === hash);
    if (same) {
      if (same.status === "archived") { same.status = "open"; delete same.archivedAt; }
      if (!same.note && note) same.note = note;
      same.repinnedAt = at;
      same.updatedAt = at;
      return;
    }
    // No hooks (herdr:<t>): the box cannot know the status-driven turn; the store does.
    const noHooks = s.turnSource === "herdr-status";
    const turn = noHooks ? num(s.turn) : num(a.turn, s.turn);
    const anchor = {
      sessionId: s.sessionId, terminal: str(a.terminal) ?? str(ev.terminal) ?? s.terminal ?? null, turn,
      uuid: str(a.uuid) ?? str(a.messageUuid), promptId: str(a.promptId), hash,
      quoteSource: a.quoteSource === "typed" ? "typed" : "clipboard",
      verified: a.verified === "turn" || a.verified === "screen" ? a.verified : null,
      settled: a.settled !== false, approx: noHooks || a.approx === true,
    };
    if (anchor.settled && !anchor.uuid) anchor.uuid = str(this.d.turns[s.sessionId]?.[turn]?.uuid);
    const nh = (s.nextHandle ??= { A: 1, Q: 1 });
    if (!Number.isFinite(Number(nh.P)) || Number(nh.P) < 1) nh.P = 1;
    this.d.pins[p.id] = {
      id: p.id, handle: `P${nh.P++}`, sessionId: s.sessionId, text, ...(clipped ? { clipped: true } : {}), note, anchor,
      source: { sessionName: s.sessionName ?? str(ev.session_name), repo: s.repo ?? null, cwd: s.cwd || str(ev.cwd) || "",
        agent: s.agent ?? str(ev.agent), profile: s.profile ?? null, configDir: s.configDir ?? null },
      status: "open", createdAt: num(p.createdAt, at), createdTurn: noHooks ? turn : num(p.createdTurn, turn), updatedAt: at,
      usedIn: [], answeredIn: [],
    };
  }

  // {type: "pin_note", session_id: the pin's session, pin, note}: the panel's Note; empty clears it.
  on_pin_note(ev, at) {
    const p = this.pin(ev.pin);
    if (!p) return;
    p.note = squash(ev.note).slice(0, LIMITS.pinNote) || null;
    p.updatedAt = at;
  }

  // {type: "pin_archive", session_id, pin}: out of the lane, into "archived (N)"; nothing is moved.
  on_pin_archive(ev, at) {
    const p = this.pin(ev.pin);
    if (!p || p.status === "archived") return;
    p.status = "archived";
    p.archivedAt = at;
    p.updatedAt = at;
  }

  // {type: "pin_restore", session_id, pin}: back to the lane.
  on_pin_restore(ev, at) {
    const p = this.pin(ev.pin);
    if (!p || p.status === "open") return;
    p.status = "open";
    delete p.archivedAt;
    p.updatedAt = at;
  }

  // {type: "pin_delete", session_id, pin}: the panel's Delete (two clicks), on an archived pin only;
  // an open one is left as it is. Nothing else ever removes a pin.
  on_pin_delete(ev) {
    const p = this.pin(ev.pin);
    if (p && p.status === "archived") delete this.d.pins[p.id];
  }

  // Each pin of a parked question gains `entry` in its answeredIn, unless `same(entry)` already holds
  // for one there.
  markPinsAnswered(it, entry, same) {
    for (const p of this.pinsOf(it)) {
      const list = Array.isArray(p.answeredIn) ? p.answeredIn : (p.answeredIn = []);
      if (list.some(same)) continue;
      list.push({ ...entry });
      p.updatedAt = entry.at;
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
    const it = this.d.items[r.id] = {
      ...r, text, key: r.id, handle: `Q${s.nextHandle.Q++}`, direction: HUMAN,
      kind: Q_KINDS.has(r.kind) ? r.kind : text ? "question" : "bookmark", anchor, status: "open",
      createdTurn: s.turnSource === "herdr-status" ? s.turn : num(r.createdTurn, anchor.turn), createdAt: num(r.createdAt, at), updatedAt: at, seq: 0,
    };
    // The Request is spread, so the fields only the store sets are never taken from it.
    delete it.askedVia; delete it.pinsAsked;
    // Its pins (the box in pins mode): the ids that name a pin (open or archived), each once, in the
    // order given, at most LIMITS.pinsPerQuestion; none left drops the field. Each pin records the
    // question in usedIn, with its handle and head, so the pin can say so after the question is gone.
    const ids = [...new Set((Array.isArray(r.pins) ? r.pins : []).filter((x) => this.pin(x)))].slice(0, LIMITS.pinsPerQuestion);
    if (!ids.length) { delete it.pins; return; }
    it.pins = ids;
    const head = (text || squash(anchor.quote)).slice(0, 80);
    for (const id of ids) {
      const p = this.pin(id);
      const used = Array.isArray(p.usedIn) ? p.usedIn : (p.usedIn = []);
      if (!used.some((u) => u.question === it.id)) used.push({ question: it.id, session: s.sessionId, handle: it.handle, head, at });
      p.updatedAt = at;
    }
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
    delete it.resolvedBy; delete it.resolvedNote;   // who closed it (and why): set after by the caller that closes it on someone's behalf
    delete it.dismissedBy; delete it.clearedAt;     // Clear all's marks (on_clear_questions sets them after)
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
    else if (action === "draft") { it.draft = String(arg ?? "").slice(0, LIMITS.answer); it.updatedAt = at; }
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
    for (const p of this.pinsOfSession(sid)) if (p.anchor?.settled === false) { p.anchor.settled = true; p.anchor.interrupted = true; p.updatedAt = now; }
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
      for (const p of this.pinsOfSession(sid)) if (p.anchor?.settled === false) { p.anchor.turn = s.turn; p.anchor.settled = true; p.updatedAt = now; }
      if (this.itemsOf(sid).some((it) => this.counts(it) && num(it.updatedAt) > num(s.seenAt))) s.surfaced = true;
      return true;
    }
    return false;
  }

  // ── derived ──────────────────────────────────────────────────────────
  // shared("ledgr.chips"): { [terminal]: { s, q, a, st, t, ag, [b], [p], [o], [w] } } (spec 3.2, 6.5).
  // `a` counts open asks at or above extract.threshold (suggestions do not count); `b` the open
  // blocking ones among them. `st`: "blocking" (an open blocking ask, whether or not the agent works:
  // a prompt or a permission wait never hides it), else "collecting" (working, questions parked this
  // turn), else "surfaced" or "seen". `w: 1`: the agent is working (the chip quiets its pulse).
  // `p`: the turn whose asks are being extracted (a pending event under 30 s old). `o`: how the
  // counted asks arrived when they all arrived one way ("tool": declare_asks, "extract_block",
  // "extract_model"), for the chip's tooltip. A terminal in a space where ledgr is off (spaces.disabled)
  // has no chip; `live(t)` names a terminal's space when the hooks recorded none (the writer passes
  // config.js terminalSpace).
  chips(now = Date.now(), live = null) {
    const out = {};
    for (const [t, m] of Object.entries(this.d.terminals)) {
      const s = this.d.sessions[m.sessionId];
      if (!s || s.state === "ended") continue;
      if (this.isOff(t, s, live)) continue;
      const mine = this.itemsOf(s.sessionId).filter((it) => this.counts(it));
      const q = mine.filter(isHuman).length, a = mine.filter(isAgentAsk).length, b = mine.filter(isBlocking).length;
      const p = this.pendingTurn(s.sessionId, now);
      if (!q && !a && p === null) continue;
      const parked = mine.filter((it) => isHuman(it) && num(it.createdAt) >= num(s.promptAt)).length;
      const working = s.state === "working";
      const st = b ? "blocking" : working && parked ? "collecting" : s.surfaced ? "surfaced" : "seen";
      const via = [...new Set(mine.filter(isAgentAsk).map((it) => it.origin).filter(Boolean))];
      out[t] = { s: s.sessionId, q, a, st, t: s.turn, ag: agentLabel(m.agent ?? s.agent), ...(b ? { b } : {}), ...(p !== null ? { p } : {}),
        ...(via.length === 1 ? { o: via[0] } : {}), ...(working ? { w: 1 } : {}) };
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
  // quotes over 200 characters dropped. Pins never reach it (they are not items), nor do a
  // question's pin ids: the extractor and the MCP server see no pin this round.
  snapshot(now = Date.now()) {
    const recent = (it) => it.status === "dismissed" && num(it.resolvedAt ?? it.updatedAt) >= now - 7 * 86400e3;
    const items = this.items().filter((it) => OPEN_STATES.has(it.status) || recent(it)).map((it) => {
      const c = { ...it, sessionId: it.anchor?.sessionId ?? null, anchor: { ...it.anchor } };
      if (c.anchor.quote && c.anchor.quote.length > 200) delete c.anchor.quote;
      delete c.draft;
      delete c.pins;
      return c;
    });
    return { v: 1, updatedAt: now, items };
  }
}
