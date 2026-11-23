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
//
// Retention (2026-11-19, Phase 1): what the writer's housekeeping takes out of store.json, all pure and
// synchronous here; the writer writes the archive files (ledgr-data/archive/<sid>/items-*.jsonl and
// turns-*.jsonl), confirms them, then calls the removals, which check again that nothing changed since the
// plan. archivable(): closed items past `retention_days` (a dismissed one never before 7 days); removeItems()
// counts each on its session's `archived`. planSlim() / applySlim(): turn records past the newest
// `retention.turns` per session go to a turns file, and so does the `textHead` of every kept record past the
// newest LIMITS.turnHeads; records also lose what every reader takes as given (leanTurn: the default
// `textPath`, null fields), as new ones do from now on. `restore` (the dialog's Reopen on an archived row)
// puts an archived item back under its own id and handle (restoreItem). Pins never leave the store; open
// items are never touched; handles are never reused (nextHandle is not derived from items).
//
// Cold sessions (2026-11-19, retention Phase 2): a session nobody touched for `retention.coldDays` (config.js
// coldDaysOf, default 7, 0 = never) moves its items and turn records into ledgr-data/cold/<safe sid>.<ms>-
// <rand6>.json; its session record stays here as the stub (`s.cold = {file, at, n, fault?}`, with its counts by
// level in `n`), so the menu, the chips (countsOf), Forget, resume and the pins read it as before. Pins,
// branches, terminals and nextHandle never leave. All pure here, as for Phase 1: planFreeze() / commitFreeze()
// (the writer writes and confirms the file between them; commit checks the session again against the plan),
// thaw() (back in, the store's copy winning), coldNeeded() (which cold sessions a batch needs warm: the writer
// thaws them first, and apply() throws ColdError rather than apply an event to a cold session), coldFault()
// (a file the writer could not read), on_cold_reset (use the session without it: `coldLost`), coldGarbage()
// and coldUnproven() / coldLacks() (the files the sweep may delete: by name only a thawed or a forgotten
// session's; any other only after a read proves store.json holds all of it), mergeCold() (a reading copy's view with the file's items added; what it
// adds never reaches toText() or snapshot()).
//
// The ask's summary (2026-11-23): an agent ask may carry `summary`, what the user must do, precisely (markdown,
// at most LIMITS.summary; cleanSummary). on_asks keeps it on a new item, replaces it when a later event for the
// same item brings a usable one, keeps it when the event brings none (as options); an item without one has no
// key. snapshot() leaves it out; the archive, cold files, thaw, merge and restore carry the item whole.
import { createHash, randomUUID } from "crypto";
import { LIMITS, DEFAULTS, agentLabel, turnPath, retentionDays, ARCHIVE_LEGACY, safeName, COLD_NAME } from "./config.js";
import { DEFAULT_MAX_DEPTH, manifest, preamble, branchName, branchLabel, depthOf } from "./branch.js";
import { conclusionHead, decisionLine, decisionsHeader, pinText } from "./confluence.js";
// A session id as a folder name (archive/<sid>/, mcp/<sid>/): config.js's one mapping, for the store's readers.
export { safeName } from "./config.js";

const EMPTY = () => ({ v: 1, items: {}, sessions: {}, branches: {}, terminals: {}, turns: {}, ingested: [], forgotten: {}, pins: {} });
const OPEN_STATES = new Set(["open", "answered", "deferred", "rejoin_pending"]);
const AGENT = "agent_to_human", HUMAN = "human_to_agent";
const ASK_KINDS = new Set(["decide", "confirm", "do", "provide", "review"]);
const Q_KINDS = new Set(["question", "note", "bookmark"]);
// The panel's own pin events: applied by pin id (a pin outlives its session), never creating one.
const PIN_OPS = new Set(["pin_note", "pin_archive", "pin_restore", "pin_delete"]);
const OWN_EVENTS = new Set(["act", "retry", "branch", "forget", "conclude", "close_branch", "resume", "clear_questions", "restore",
  "cold_retry", "cold_reset", ...PIN_OPS]);
// Cold sessions (Phase 2): the events that never need a cold session warm. The pin ops go by pin id (pins
// stay); Forget removes the stub (and its descendants) and never reads a file; cold_reset is the way out of a
// file that cannot be read. Every other event needs its own session warm (coldNeeded).
export const COLD_FREE = new Set([...PIN_OPS, "forget", "cold_reset"]);
export const COLD_FORMAT = "ledgr-cold";
// apply() was handed an event for a session still cold (a coldNeeded gap): thrown rather than applied, so the
// writer's quarantine keeps the event in spool/failed. `.cold`: the sessions it needs.
export class ColdError extends Error {
  constructor(sids) {
    const list = [...(sids ?? [])].map(String);
    super(`the event needs ${list.length === 1 ? "a cold session" : "cold sessions"} brought back first (${list.map((x) => x.slice(0, 8)).join(", ")})`);
    this.name = "ColdError";
    this.cold = list;
  }
}
// A branch in one of these states keeps both its parent and its child session warm (a launch, a run or a
// confluence waiting to land).
const BRANCH_ACTIVE = new Set(["launching", "launched", "running", "concluded"]);
// The files a session record lists as thawed (`coldThawed`, the sweep's proof that a file is redundant): the
// newest this many; the sweep also trims an entry once its file is gone or a day old (trimThawed).
export const COLD_THAWED_MAX = 8;
export const PIN_ID = /^pn_[A-Za-z0-9-]{8,64}$/;
// An item id as the store makes them (newId("rq"); the demo's rq_demo_N): what a restored record must carry.
const ITEM_ID = /^rq_[A-Za-z0-9_-]{1,80}$/;
// A key the map itself holds: `__proto__`, `constructor` or `toString` would otherwise reach
// Object.prototype through a plain lookup (a pin id comes from a spool event or a Request).
const own = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
const DAY_MS = 86400e3;
// A dismissed item stays this long at least: the extractor's dismissed list and snapshot() look back 7
// days, so a re-raise still finds (and names) the item it repeats.
const DISMISSED_DAYS = 7;
// A copy as store.json holds it (what an archive line is).
const copy = (o) => JSON.parse(JSON.stringify(o));
// A count or a number of days from config or a caller: a number (or a numeric string) not below 0, else `d`.
const nonNeg = (v, d) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : d;
};
// A session's `archived` count as read: absent (or anything but a positive number) is 0.
const tally = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

// ── turn records, leaner (retention, 2026-11-19) ──────────────────────────
// A turn's text file is ledgr-data/turns/<sid>/<turn>.md (config.js turnPath; the hooks send it as
// `text_path`, absolute). Every reader of a record's `textPath` falls back to that path when it has none
// (reader.js loadPassage, detail.js branchText and pumpBranch, writer.js reanchor through on_stop's settle
// entry), so the record need not hold it. A relative path counts from ledgr-data/, as those readers read it.
const slashes = (p) => String(p).replace(/\/{2,}/g, "/");
function isDefaultTextPath(sid, turn, p) {
  if (typeof p !== "string" || !p) return false;
  if (slashes(p) === `turns/${sid}/${turn}.md`) return true;
  try { return slashes(p) === slashes(turnPath(sid, turn)); } catch { return false; }
}
const dropNulls = (o) => { for (const k of Object.keys(o)) if (o[k] === null || o[k] === undefined) delete o[k]; };
// What every reader already takes as given leaves the record (lossless): an empty or default `textPath`,
// and null fields at its top and in its `asks` and `retry` sub-records (readers use ?. and ??, or test
// them for truth: panel.js errorLine reads asks.error and asks.errorDetail so). Mutates and returns rec.
function leanTurn(sid, turn, rec) {
  if (!rec || typeof rec !== "object") return rec;
  if (own(rec, "textPath") && (!rec.textPath || isDefaultTextPath(sid, turn, rec.textPath))) delete rec.textPath;
  dropNulls(rec);
  for (const k of ["asks", "retry"]) if (rec[k] && typeof rec[k] === "object" && !Array.isArray(rec[k])) dropNulls(rec[k]);
  return rec;
}

// ── cold files (Phase 2) ──────────────────────────────────────────────────
const isObj = (o) => Boolean(o) && typeof o === "object" && !Array.isArray(o);
// What is wrong with a cold file's record for session sid (its parsed JSON), or null: the format, the version,
// the session, and every item an object of that session with an id, every turn record an object. One check
// for thaw(), mergeCold() and the reading copies (reader.js validates a loaded file with it): a record that
// fails it is never partly used. `__proto__` is refused as an id or a turn key (it would reach the prototype).
export function coldRecordError(record, sid) {
  if (!isObj(record)) return "not a cold file (no JSON object)";
  if (record.ledgr !== COLD_FORMAT) return `not a cold file (ledgr ${JSON.stringify(record.ledgr ?? null).slice(0, 40)})`;
  if (record.v !== 1) return `cold file version ${JSON.stringify(record.v ?? null).slice(0, 20)}, not 1`;
  if (typeof sid !== "string" || !sid || record.sessionId !== sid) return `the file is session ${String(record.sessionId ?? "?").slice(0, 40)}'s, not ${String(sid).slice(0, 40)}`;
  if (!Array.isArray(record.items)) return "the file holds no item list";
  if (record.turns !== undefined && record.turns !== null && !isObj(record.turns)) return "the file's turn records are not a map";
  for (const [i, it] of record.items.entries()) {
    if (!isObj(it) || typeof it.id !== "string" || !it.id || it.id === "__proto__") return `item ${i + 1} of the file has no id`;
    if (it.anchor?.sessionId !== sid) return `item ${it.id.slice(0, 40)} in the file is another session's`;
  }
  for (const [k, r] of Object.entries(record.turns ?? {})) {
    if (k === "__proto__" || !isObj(r)) return `turn record ${k.slice(0, 20)} of the file is not a record`;
  }
  return null;
}

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

// An agent ask's summary (2026-11-23): what the user must do, precisely, readable without the reply
// (`summary` on the asks event's item and on the store's item; bin/lib/ledgr_asks.py applies the same rule
// first, and the store trusts no producer, so it applies it again). A string, else none; CR and CRLF become
// LF; a run of blank lines (whitespace-only lines among them) becomes one blank line; the outer whitespace
// goes; then a cut at LIMITS.summary code points (as Python counts; never a lone surrogate), never a refusal.
// Line breaks and markdown are kept. Empty is none: null, and the caller leaves the key out (lean records, no
// null field).
export function cleanSummary(v) {
  if (typeof v !== "string") return null;
  let s = v.replace(/\r\n?/g, "\n").replace(/\n(?:[^\S\n]*\n)+/g, "\n\n").trim();
  if (s.length > LIMITS.summary) s = Array.from(s).slice(0, LIMITS.summary).join("").trimEnd();
  return s || null;
}

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
    // Cold sessions a reading copy merged (mergeCold): sid -> {file, items: Set<id>, turns: Set<key>}, what the
    // merge added. On the instance, never in `d`: toText() and snapshot() leave it out.
    this.merged = new Map();
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

  // store.json's text. What a reading copy merged from cold files is left out (unmerged), so a merged store
  // written by mistake still names its cold sessions' files and holds none of their items.
  toText() { return JSON.stringify(this.merged.size ? this.unmerged() : this.d); }

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
  // close the branch terminals to end (all async, done by the writer). A `restore` event also returns
  // `restore: {item, ok, error?}`, whatever became of it, so the writer can say so (on_restore).
  // Cold sessions (Phase 2): an event that needs a cold session warm (coldNeeded) throws ColdError and changes
  // nothing; the writer thaws first. A cold_retry is the exception: it changes nothing, so one whose read failed
  // (the session still cold) is recorded and dropped. Every event of a warm session but the pin ops moves its
  // `touchedAt` (the idle clock) to the event's time.
  apply(ev) {
    const out = { applied: false, settle: [], retry: [], launch: [], decisions: [], close: [], resume: [] };
    if (!ev || typeof ev !== "object" || !ev.type) return out;
    if (ev.id && this.d.ingested.includes(ev.id)) return out;
    if (!COLD_FREE.has(ev.type) && ev.type !== "cold_retry") {
      const c = this.coldOf(ev);
      if (c.length) throw new ColdError(c);
    }
    const sid = str(ev.session_id) ?? str(ev.session) ?? str(ev.request?.anchor?.sessionId);
    const at = num(ev.at, Date.now());
    // The panel's own events (act, retry, branch, forget, conclude, close_branch, restore) never create a session.
    const own = OWN_EVENTS.has(ev.type);
    // A restore dropped below (a forgotten or unknown session) says why; on_restore replaces it.
    if (ev.type === "restore") out.restore = { item: str(ev.item), ok: false, error: sid ? "its session is not in the store" : "the event names no session" };
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
    // The idle clock (touchedAt): the session still recorded and warm (Forget removed it; a cold_retry whose
    // read failed leaves the stub as it was; cold_reset sets it itself), pin ops aside, and an act "seen" aside:
    // a session that is only looked at is not in use (the panel posts one whenever it shows a surfaced session).
    if (sid && !PIN_OPS.has(ev.type) && !(ev.type === "act" && ev.action === "seen")
      && Object.prototype.hasOwnProperty.call(this.d.sessions, sid) && !this.d.sessions[sid].cold && !this.isForgotten(sid)) {
      const s = this.d.sessions[sid];
      if (!(num(s.touchedAt) >= at)) s.touchedAt = at;
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
    leanTurn(s.sessionId, turn, ti);   // no default textPath, no nulls (every reader falls back)
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
    out.settle.push({ sid: s.sessionId, turn, textPath: ti.textPath ?? null });
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
    leanTurn(s.sessionId, turn, ti);   // the asks sub-record without its null fields
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
      // The summary (2026-11-23): in `fields` only when the event brings a usable one, so every Object.assign
      // below replaces a stored summary with a new one and keeps it when the event has none (as options are
      // kept); a new item gets it from `fields` or goes without the key.
      const summary = cleanSummary(a.summary);
      if (summary) fields.summary = summary;
      // Quote source: the block's, the model's, or the tool's ("tool_unverified" until the Stop hook
      // has checked the quote against the turn's text).
      const quoteSource = tool ? (a.quote_verified === false ? "tool_unverified" : "tool") : ev.source === "block" ? "block" : "model";
      const anchor = { sessionId: s.sessionId, turn, promptId: ev.prompt_id ?? null, uuid, apiMessageId: ev.api_message_id ?? null,
        quote, quoteSource, hash, settled: true };
      const mine = this.itemsOf(s.sessionId).filter(isAgentAsk);
      // Same turn and passage: the same item (a replayed or re-run extraction).
      // A tool ask declared again (or settled at Stop) keeps its item whatever its quote became.
      // Either way `fields` lands on it: a usable summary replaces the stored one, none keeps it.
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
        // Answered: reopened as it was (its text, options and summary unchanged; the person's answer stands).
        if (prior.status === "answered") {
          prior.lastSeenTurn = turn; prior.note = `asked again at turn ${turn}`; prior.anchor = { ...prior.anchor, ...anchor };
          this.setStatus(prior, "open", at);
          if (this.counts(prior)) created++;
          return;
        }
        // resolved or dismissed: the agent raised it again — a new item pointing at the old one (its own text
        // and summary, the event's; nothing carried from the old item).
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
  on_act(ev, s, at, out) {
    if (ev.action === "seen") { this.markSeen(s.sessionId, at); return; }
    const it = this.item(ev.item) ?? (str(ev.handle) ? this.byHandle(s.sessionId, ev.handle) : null);
    // An item no longer in the store (archived by housekeeping while the act waited in the spool, 2026-11-19):
    // the act is dropped, and the writer's note says so; the archive's Reopen brings the item back.
    if (!it && str(ev.item) && out) out.note = `${String(ev.item).slice(0, 60)} is not in the store (archived?): ${String(ev.action ?? "act").slice(0, 20)} not applied`;
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
  // A cold session (Phase 2) goes the same way, its stub and those of its descendants (found through the
  // stubs' parentSessionId and the branch records): no file is read, so a lost one cannot stop it; the sweep
  // deletes the files a day later (coldGarbage: a forgotten session's).
  on_forget(_ev, s, at) {
    const gone = new Set([s.sessionId]);
    for (let grew = true; grew;) {
      grew = false;
      const add = (sid) => { if (sid && !gone.has(sid)) { gone.add(sid); grew = true; } };
      for (const x of Object.values(this.d.sessions)) if (x.parentSessionId && gone.has(x.parentSessionId)) add(x.sessionId);
      for (const b of Object.values(this.d.branches)) if (gone.has(b.parentSessionId)) add(b.sessionId);
    }
    for (const sid of gone) { delete this.d.sessions[sid]; delete this.d.turns[sid]; this.d.forgotten[sid] = at; this.merged.delete(sid); }
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
    // The Request is spread, so the fields only the store sets are never taken from it. A parked question has no
    // summary (2026-11-23: an agent ask's field alone).
    delete it.askedVia; delete it.pinsAsked; delete it.summary;
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
  // config.js terminalSpace). A cold session's chip (Phase 2) counts from its stub (countsOf, `n.qNew` for
  // "collecting") and has no `o`: the same chip as before the freeze otherwise.
  chips(now = Date.now(), live = null) {
    const out = {};
    for (const [t, m] of Object.entries(this.d.terminals)) {
      const s = this.d.sessions[m.sessionId];
      if (!s || s.state === "ended") continue;
      if (this.isOff(t, s, live)) continue;
      const mine = this.itemsOf(s.sessionId).filter((it) => this.counts(it));
      const cold = Boolean(s.cold) && !this.isMerged(s.sessionId);
      const newQ = (list) => list.filter((it) => isHuman(it) && num(it.createdAt) >= num(s.promptAt)).length;
      let q = mine.filter(isHuman).length, a = mine.filter(isAgentAsk).length, b = mine.filter(isBlocking).length;
      if (cold) ({ q, a, b } = this.countsOf(s.sessionId));
      const p = this.pendingTurn(s.sessionId, now);
      if (!q && !a && p === null) continue;
      const parked = cold ? tally(s.cold.n?.qNew) + newQ(mine) : newQ(mine);
      const working = s.state === "working";
      const st = b ? "blocking" : working && parked ? "collecting" : s.surfaced ? "surfaced" : "seen";
      const via = cold ? [] : [...new Set(mine.filter(isAgentAsk).map((it) => it.origin).filter(Boolean))];
      out[t] = { s: s.sessionId, q, a, st, t: s.turn, ag: agentLabel(m.agent ?? s.agent), ...(b ? { b } : {}), ...(p !== null ? { p } : {}),
        ...(via.length === 1 ? { o: via[0] } : {}), ...(working ? { w: 1 } : {}) };
    }
    return out;
  }

  pendingTurn(sid, now = Date.now()) {
    const pd = this.d.sessions[sid]?.pending;
    return pd && now - num(pd.at) < 30000 ? num(pd.turn) : null;
  }

  // ── retention (2026-11-19) ───────────────────────────────────────────
  // Closed items past retention (config.json retention_days, default 3, as config.js retentionDays reads it:
  // whole days from 1 to 30): a resolved one whose `resolvedAt` (else `updatedAt`) is older than `days`, a
  // dismissed one only past max(days, 7) days (DISMISSED_DAYS). Pins are not items, so never. Each is a
  // copy, as store.json holds it now: the line its archive file gets, and what removeItems compares the
  // store with once that file is confirmed.
  archivable(days, now = Date.now()) {
    const d = retentionDays(days);
    const before = now - d * DAY_MS, beforeDismissed = now - Math.max(d, DISMISSED_DAYS) * DAY_MS;
    return this.items()
      .filter((it) => isClosed(it) && num(it.resolvedAt ?? it.updatedAt) < (it.status === "dismissed" ? beforeDismissed : before))
      .map(copy);
  }

  // The archived items leave the store (the writer, once their lines are confirmed in an archive file):
  // each only if the store still holds it closed and exactly as the list gives it (the same JSON text as
  // archivable's copy, the line in the file: a change that set no `updatedAt`, such as a confluence landing
  // again or Forget's branch mark, counts too); one reopened or changed while the file was written stays for
  // the next run. Each removal counts on its session's `archived` (absent means 0) when the session is
  // recorded. Returns the items removed.
  removeItems(list) {
    const out = [];
    for (const x of Array.isArray(list) ? list : []) {
      const id = x?.id;
      if (typeof id !== "string" || !own(this.d.items, id)) continue;
      const it = this.d.items[id];
      if (!isClosed(it) || JSON.stringify(it) !== JSON.stringify(x)) continue;
      delete this.d.items[id];
      const sid = it.anchor?.sessionId;
      if (typeof sid === "string" && own(this.d.sessions, sid)) this.d.sessions[sid].archived = tally(this.d.sessions[sid].archived) + 1;
      out.push(it);
    }
    return out;
  }

  // What housekeeping takes from the turn records, planned and not applied: `cut`, per session, every
  // record past the newest `keep` (by turn number), each with a copy of the record as it is; `heads`, the
  // `textHead` of every kept record past the newest `heads` that still has one. Both go to a turns file
  // before applySlim takes them out. Each entry carries the record's own `key` in the map (a hand-edited
  // "07" stays "07"; `turn` is its number). Mutates nothing.
  planSlim(keep, heads = LIMITS.turnHeads) {
    const k = Math.floor(nonNeg(keep, DEFAULTS.retention.turns)), h = Math.floor(nonNeg(heads, LIMITS.turnHeads));
    const cut = [], hd = [];
    for (const [sessionId, all] of Object.entries(this.d.turns)) {
      if (!all || typeof all !== "object") continue;
      const turns = Object.keys(all).filter((n) => Number.isFinite(Number(n))).sort((a, b) => Number(b) - Number(a));
      turns.forEach((n, i) => {
        const rec = all[n];
        if (i >= k) cut.push({ sessionId, turn: Number(n), key: n, rec: copy(rec ?? null) });
        else if (i >= h && typeof rec?.textHead === "string" && rec.textHead) hd.push({ sessionId, turn: Number(n), key: n, textHead: rec.textHead });
      });
    }
    return { cut, heads: hd };
  }

  // A plan from planSlim, applied once its turns file is confirmed: each cut record goes only if it is
  // still as planned (the same JSON text; one that changed since stays for the next run), each listed
  // `textHead` only if the record still holds that text. Then every record left is made lean (leanTurn:
  // the default textPath and null fields, lossless, so no archive line), and a session left with no
  // record loses its empty map. Returns what was taken: { cut, heads }.
  applySlim(plan) {
    let cut = 0, heads = 0;
    // The record's key as planned (planSlim's `key`), else its turn number.
    const keyOf = (x) => (typeof x?.key === "string" ? x.key : String(x?.turn));
    for (const c of Array.isArray(plan?.cut) ? plan.cut : []) {
      const all = this.d.turns[c?.sessionId];
      const n = keyOf(c);
      if (!all || !own(this.d.turns, c.sessionId) || !own(all, n) || JSON.stringify(all[n] ?? null) !== JSON.stringify(c.rec ?? null)) continue;
      delete all[n];
      cut++;
    }
    for (const x of Array.isArray(plan?.heads) ? plan.heads : []) {
      const all = own(this.d.turns, x?.sessionId) ? this.d.turns[x.sessionId] : null;
      const rec = all && own(all, keyOf(x)) ? all[keyOf(x)] : null;
      if (!rec || typeof x.textHead !== "string" || rec.textHead !== x.textHead) continue;
      delete rec.textHead;
      heads++;
    }
    for (const [sid, all] of Object.entries(this.d.turns)) {
      if (!all || typeof all !== "object") continue;
      for (const [n, rec] of Object.entries(all)) leanTurn(sid, n, rec);
      if (!Object.keys(all).length) delete this.d.turns[sid];
    }
    return { cut, heads };
  }

  // An archived item back in the store, under its own id and, as a rule, its own handle: only a record that
  // is an item (an item id, a session in its anchor) of a session not forgotten, and only when its id is not
  // in the store. Handles are never reused, so a handle below the session's nextHandle that no item holds is
  // still its own. One the session's counter could hand out again (at or above nextHandle: the session
  // record was made again, after Forget's memory let it go or a corrupt store was set aside) or another item
  // holds gets a fresh one from nextHandle, the old one kept as `handleWas`. `counted` (the line came from
  // an items file, not a legacy month file, which no count ever held) lowers the session's `archived` by one
  // (never below 0; 0 leaves the field out). Returns the item put back, the one already there, or null.
  restoreItem(record, { counted = true } = {}) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const id = record.id, sid = record.anchor?.sessionId;
    if (typeof id !== "string" || !ITEM_ID.test(id) || typeof sid !== "string" || !sid) return null;
    if (own(this.d.items, id)) return this.d.items[id];
    if (this.isForgotten(sid)) return null;
    // A cold session's items live in its file (Phase 2): never one beside its stub. apply() thaws the
    // session before a restore reaches here; this is the defensive half.
    if (own(this.d.sessions, sid) && this.d.sessions[sid].cold) return null;
    const it = copy(record);
    delete it.archiveFile;   // a reading copy's note of where it read the record, never the item's
    const s = own(this.d.sessions, sid) ? this.d.sessions[sid] : null;
    if (s) {
      const m = /^([AQ])(\d+)$/.exec(String(it.handle ?? ""));
      const k = m?.[1] ?? (it.direction === AGENT ? "A" : "Q");
      const nh = (s.nextHandle ??= { A: 1, Q: 1, P: 1 });
      if (!Number.isFinite(Number(nh[k])) || Number(nh[k]) < 1) nh[k] = 1;
      if (!m || Number(m[2]) >= Number(nh[k]) || this.byHandle(sid, it.handle)) {
        const fresh = `${k}${nh[k]++}`;
        if (it.handle && it.handle !== fresh) it.handleWas = String(it.handle).slice(0, 16);
        it.handle = fresh;
      }
    }
    this.d.items[id] = it;
    if (s && counted) {
      const left = tally(s.archived) - 1;
      if (left > 0) s.archived = left; else delete s.archived;
    }
    return it;
  }

  // {type: "restore", session_id, item, file, reopen, record | record_error}: the dialog's Reopen on an
  // archived row. The writer reads the line from archive/<sid>/<file> (or a legacy <yyyy-mm>.jsonl) and
  // attaches it as `record` (the parsed item), or `record_error` when it could not (it drops either when
  // the event brings its own, so `file` is where the record was read). With a record of this session and
  // this id: restoreItem (counted unless `file` is a legacy month file), then, when the item is closed, the
  // reopen act's own change (act "reopen": setStatus, so resolvedBy, resolvedNote and the dismiss marks go;
  // a staged confluence is called off). A restore always reopens: a closed item put back would be past
  // retention and leave again at the next run, so `reopen` (the dialog sends true) is not read. Anything
  // else changes nothing. Either way `out.restore` = {item, ok, error?} (apply() records the event in
  // `ingested` as for any other).
  on_restore(ev, s, at, out) {
    const id = str(ev.item);
    const say = (ok, error = null) => { out.restore = { item: id, ok, ...(error ? { error: String(error).slice(0, 300) } : {}) }; };
    if (ev.record_error !== undefined && ev.record_error !== null) return say(false, str(ev.record_error) ?? "the archive file could not be read");
    const rec = ev.record;
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) return say(false, "no record was read from the archive");
    if (!id || rec.id !== id) return say(false, `the archive line is not ${id ?? "the item asked for"}`);
    if (rec.anchor?.sessionId !== s.sessionId) return say(false, "the archived item belongs to another session");
    const it = this.restoreItem(rec, { counted: !ARCHIVE_LEGACY.test(String(ev.file ?? "")) });
    if (!it) return say(false, "the archive line is not an item");
    if (isClosed(it)) this.act(it.id, "reopen", null, at);
    say(true);
  }

  // ledgr-data/snapshot.json, read by the extractor: open, answered and deferred items, plus
  // items dismissed in the last 7 days (so the model can mark a re-raise with repeat_of);
  // quotes over 200 characters dropped; no draft, no pin ids, no summary. Pins never reach it (they are not items), nor do a
  // question's pin ids: the extractor and the MCP server see no pin this round.
  // Cold sessions (Phase 2): `cold` names each one's file and the writer's fault (its error, or null), and
  // their items are not here (the readers read the file: bin/lib ledgr_extract.session_items, with this
  // filter); what a reading copy merged is left out too.
  snapshot(now = Date.now()) {
    const recent = (it) => it.status === "dismissed" && num(it.resolvedAt ?? it.updatedAt) >= now - 7 * 86400e3;
    const merged = this.mergedIds();
    const items = this.items().filter((it) => !merged.has(it.id) && (OPEN_STATES.has(it.status) || recent(it))).map((it) => {
      const c = { ...it, sessionId: it.anchor?.sessionId ?? null, anchor: { ...it.anchor } };
      if (c.anchor.quote && c.anchor.quote.length > 200) delete c.anchor.quote;
      delete c.draft;
      delete c.pins;
      delete c.summary;   // an ask's summary (2026-11-23): the extractor and open_asks do not need it (bin/lib snapshot_copy drops it too)
      return c;
    });
    const cold = {};
    for (const [sid, s] of Object.entries(this.d.sessions)) {
      if (!s?.cold) continue;
      const f = s.cold.fault;
      cold[sid] = { file: str(s.cold.file), fault: f ? str(f.error) ?? "the file cannot be read" : null };
    }
    return { v: 1, updatedAt: now, items, cold };
  }

  // ── cold sessions (retention Phase 2, 2026-11-19) ────────────────────
  // Lookups. A session is cold while its record carries `cold`; merged while a reading copy holds its file's
  // items beside the stub (mergeCold); mixed when it is cold yet the store holds items or turn records of it
  // (an older build added them beside the stub, or a merge reached the writer): the writer thaws those.
  isCold(sid) { return own(this.d.sessions, sid) && Boolean(this.d.sessions[sid]?.cold); }
  isMerged(sid) { return this.merged.has(sid) && this.isCold(sid) && this.merged.get(sid).file === this.d.sessions[sid].cold.file; }
  coldSessions() { return Object.keys(this.d.sessions).filter((sid) => this.isCold(sid)); }
  coldFaults() {
    return this.coldSessions().filter((sid) => isObj(this.d.sessions[sid].cold.fault)).map((sid) => {
      const c = this.d.sessions[sid].cold, f = c.fault;
      return { sid, file: str(c.file), at: num(f.at), error: str(f.error) ?? "the file cannot be read", tries: tally(f.tries), held: tally(f.held) };
    });
  }
  mixedCold() {
    const has = new Set(this.items().map((it) => it.anchor?.sessionId));
    return this.coldSessions().filter((sid) => has.has(sid) || (isObj(this.d.turns[sid]) && Object.keys(this.d.turns[sid]).length > 0));
  }
  // The ids a merge added (every merged session's), for toText() and snapshot().
  mergedIds() {
    const out = new Set();
    for (const m of this.merged.values()) for (const id of m.items) out.add(id);
    return out;
  }
  // `d` without what mergeCold added: a shallow copy, its keys in their order; a turn map the merge alone
  // made is left out whole.
  unmerged() {
    const ids = this.mergedIds();
    const items = {};
    for (const [id, it] of Object.entries(this.d.items)) if (!ids.has(id)) items[id] = it;
    const turns = { ...this.d.turns };
    for (const [sid, m] of this.merged) {
      if (!isObj(turns[sid]) || !m.turns.size) continue;
      const all = {};
      for (const [k, r] of Object.entries(turns[sid])) if (!m.turns.has(k)) all[k] = r;
      if (Object.keys(all).length || !m.madeTurns) turns[sid] = all; else delete turns[sid];
    }
    return { ...this.d, items, turns };
  }

  // The idle clock: the latest time anything happened to the session. The record's own times (touchedAt,
  // updatedAt, thawedAt, promptAt, lastStopAt, resume.at and resumedAt, lastClear.at), every item's
  // updatedAt and every turn record's stopAt, asks.at and retry.at (Phase 1's slimming keeps all three). The
  // panel's own events set no updatedAt on the record; they reach the items and records, or touchedAt. Not
  // seenAt: a session only looked at is not in use (the contract listed it; a cold session's menu row then
  // said "idle 1 min" after a look, and a session shown every day never went cold). A stub carries the clock
  // it had at the freeze in its touchedAt (commitFreeze), since its items and turn records are in the file.
  touchedAt(sid) {
    let t = 0;
    const see = (v) => { const x = Number(v); if (Number.isFinite(x) && x > t) t = x; };
    const s = own(this.d.sessions, sid) ? this.d.sessions[sid] : null;
    if (s) for (const v of [s.touchedAt, s.updatedAt, s.thawedAt, s.promptAt, s.lastStopAt, s.resume?.at, s.resume?.resumedAt, s.lastClear?.at]) see(v);
    for (const it of this.itemsOf(sid)) see(it.updatedAt);
    const all = own(this.d.turns, sid) ? this.d.turns[sid] : null;
    if (isObj(all)) for (const r of Object.values(all)) { see(r?.stopAt); see(r?.asks?.at); see(r?.retry?.at); }
    return t;
  }

  // The counts a stub carries (`s.cold.n`), from the session's items and turn records now: q open parked
  // questions, qNew those created at or after the last prompt (the chip's "collecting"), blocking the open
  // blocking asks (promoted or not), needed and optional the open asks of those levels not promoted, promoted
  // the open promoted asks below blocking, answered, closed (resolved or dismissed), and the totals in the
  // file, items and turns. By level, so any threshold can be counted from them (countsOf).
  coldCounts(sid) {
    const n = { q: 0, qNew: 0, blocking: 0, needed: 0, optional: 0, promoted: 0, answered: 0, closed: 0, items: 0, turns: 0 };
    const s = own(this.d.sessions, sid) ? this.d.sessions[sid] : null;
    for (const it of this.itemsOf(sid)) {
      n.items++;
      if (it.status === "answered") n.answered++;
      else if (isClosed(it)) n.closed++;
      if (it.status !== "open") continue;
      if (isHuman(it)) { n.q++; if (num(it.createdAt) >= num(s?.promptAt)) n.qNew++; }
      else if (isAgentAsk(it)) {
        const lv = levelOf(it);
        if (lv === "blocking") n.blocking++;
        else if (it.promoted === true) n.promoted++;
        else n[lv]++;
      }
    }
    const all = own(this.d.turns, sid) ? this.d.turns[sid] : null;
    n.turns = isObj(all) ? Object.keys(all).length : 0;
    return n;
  }

  // A session's counts at `this.threshold`: q (open parked questions), a (open asks that count), b (the open
  // blocking ones), below (open asks below the threshold, not promoted), answered, closed, open (q + a); a
  // and b are what the chip shows, open what the session menu says. A cold session that is not merged counts
  // from its stub's `n` (plus anything an older build added beside it); any other from its items.
  countsOf(sid) {
    const th = LEVELS.includes(this.threshold) ? this.threshold : DEFAULT_THRESHOLD;
    const out = { q: 0, a: 0, b: 0, below: 0, answered: 0, closed: 0, open: 0 };
    const s = own(this.d.sessions, sid) ? this.d.sessions[sid] : null;
    if (s?.cold && !this.isMerged(sid)) {
      const n = isObj(s.cold.n) ? s.cold.n : {}, c = (k) => tally(n[k]);
      out.q = c("q"); out.b = c("blocking"); out.answered = c("answered"); out.closed = c("closed");
      out.a = out.b + c("promoted") + (th !== "blocking" ? c("needed") : 0) + (th === "optional" ? c("optional") : 0);
      out.below = (th === "blocking" ? c("needed") : 0) + (th !== "optional" ? c("optional") : 0);
    }
    for (const it of this.itemsOf(sid)) {
      if (it.status === "answered") out.answered++;
      else if (isClosed(it)) out.closed++;
      else if (it.status === "open") {
        if (isHuman(it)) out.q++;
        else if (isAgentAsk(it)) {
          if (isSuggestion(it, th)) out.below++;
          else { out.a++; if (isBlocking(it)) out.b++; }
        }
      }
    }
    out.open = out.q + out.a;
    return out;
  }

  // ── freeze ──
  // Why the session cannot go cold whatever its clock says (the store's rules), or null: it is not recorded,
  // forgotten or already cold; its id makes no file name of its own (empty, beginning with ".", or a safe name another
  // recorded or forgotten session shares: its file and held/ folder would be ambiguous); it holds a deferred
  // item (next_session wakes by folder across every session, a time by wake()'s scan of items()), a
  // confluence waiting to land (rejoin_pending, `rejoin`), a branch launching, launched, running or concluded
  // on either side, a resume launching or launched, or a turn whose extraction re-run is requested or running.
  // `safe` (optional): safeName -> how many sessions use it, computed once per plan.
  freezeBlocker(sid, safe = null) {
    if (!own(this.d.sessions, sid)) return "not recorded";
    const s = this.d.sessions[sid];
    if (this.isForgotten(sid)) return "forgotten";
    if (s.cold) return "already cold";
    const nm = safeName(sid);
    // A leading "." (a hidden name) is refused too (integration, 2026-11-19): the readers take such a name only
    // as that session's own, and a listing that skips hidden entries would lose its held folder.
    if (!nm || nm.startsWith(".") || !COLD_NAME.test(`${nm}.1000000000000-aaaaaa.json`)) return "its id makes no file name";
    if ((safe ?? this.safeNames()).get(nm) > 1) return "another session has the same file name";
    for (const it of this.itemsOf(sid)) {
      if (it.status === "deferred") return `${it.handle ?? it.id} is deferred`;
      if (it.status === "rejoin_pending" || it.rejoin) return `${it.handle ?? it.id} waits for its confluence`;
    }
    for (const b of Object.values(this.d.branches)) {
      if ((b?.parentSessionId === sid || b?.sessionId === sid) && BRANCH_ACTIVE.has(b.status)) return `branch ${b.name ?? b.id} is ${b.status}`;
    }
    if (s.resume && (s.resume.state === "launching" || s.resume.state === "launched")) return `a resume is ${s.resume.state}`;
    const all = own(this.d.turns, sid) ? this.d.turns[sid] : null;
    if (isObj(all)) for (const [k, r] of Object.entries(all)) {
      if (r?.retry?.state === "requested" || r?.retry?.state === "running") return `turn ${k}'s extraction is ${r.retry.state}`;
    }
    return null;
  }
  // safeName -> how many recorded or forgotten sessions it names.
  safeNames() {
    const m = new Map();
    for (const sid of new Set([...Object.keys(this.d.sessions), ...Object.keys(this.d.forgotten)])) { const k = safeName(sid); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  }
  // The session's items and turn records as one text: what a plan's `sig` is and commitFreeze compares.
  coldSig(sid) { return JSON.stringify({ items: this.itemsOf(sid), turns: own(this.d.turns, sid) ? this.d.turns[sid] ?? null : null }); }

  // The sessions a freeze run would move, planned and not applied: every session idle more than `days` days
  // (touchedAt), that holds items or turn records, that freezeBlocker() lets go and canFreeze(sid) (the
  // writer's: no live terminal, not in the open dialog, not in the running pass) allows; oldest idle first, at
  // most `max`. Nothing before Phase 1's first run has finished (`d.retention.v` 1), nothing at days 0. Each
  // entry: {sid, record (the cold file's object, `at` now, made of copies), sig}. Mutates nothing.
  planFreeze(days, now = Date.now(), { canFreeze = () => true, max = Infinity } = {}) {
    const dd = nonNeg(days, 0);
    if (!(dd > 0) || this.d.retention?.v !== 1) return [];
    const at = Math.floor(num(now, Date.now()));
    const safe = this.safeNames();
    const due = [];
    for (const sid of Object.keys(this.d.sessions)) {
      if (this.isCold(sid)) continue;
      const items = this.itemsOf(sid), all = own(this.d.turns, sid) ? this.d.turns[sid] : null;
      if (!items.length && !(isObj(all) && Object.keys(all).length)) continue;
      const t = this.touchedAt(sid);
      if (!(at - t > dd * DAY_MS)) continue;
      if (this.freezeBlocker(sid, safe)) continue;
      due.push({ sid, t });
    }
    due.sort((x, y) => x.t - y.t || (x.sid < y.sid ? -1 : 1));
    const out = [], cap = Math.max(0, num(max, Infinity));
    for (const { sid } of due) {
      if (out.length >= cap) break;
      let ok = false;
      try { ok = canFreeze(sid) === true; } catch { ok = false; }
      if (!ok) continue;
      const s = this.d.sessions[sid];
      const turns = own(this.d.turns, sid) && isObj(this.d.turns[sid]) ? this.d.turns[sid] : {};
      const record = { ledgr: COLD_FORMAT, v: 1, sessionId: sid, at, session: copy(s), items: copy(this.itemsOf(sid)), turns: copy(turns), n: this.coldCounts(sid) };
      out.push({ sid, record, sig: this.coldSig(sid) });
    }
    return out;
  }

  // A plan's files written and confirmed: done = [{sid, record, sig, file}]. Each session goes cold only if
  // nothing changed since its plan: it is recorded and warm, freezeBlocker() and canFreeze still let it go,
  // its record is as planned (no event, map record, seen or space reached it), its items and turn records are
  // the plan's `sig` and the record's (so the file holds exactly what leaves), and `file` is its name with the
  // record's `at`. Then, in one step: the record keeps the idle clock it has now (`touchedAt`: the items and
  // turn records it is read from leave), its items and turn records leave the store and the record names the
  // file (`cold: {file, at, n}`). Returns the sessions frozen, in the order given; the writer unlinks the other
  // files. The same list again freezes nothing; neither does a store without Phase 1's mark. `now` is not
  // read (the idle clock cannot have moved back: the record and the items are as planned).
  commitFreeze(done, now = Date.now(), { canFreeze = () => true } = {}) {
    const out = [], safe = this.safeNames();
    if (this.d.retention?.v !== 1) return out;
    for (const x of Array.isArray(done) ? done : []) {
      const sid = x?.sid, rec = x?.record, file = x?.file;
      if (typeof sid !== "string" || !isObj(rec) || typeof file !== "string" || !own(this.d.sessions, sid)) continue;
      const s = this.d.sessions[sid];
      if (s.cold || this.freezeBlocker(sid, safe)) continue;
      const m = COLD_NAME.exec(file);
      if (!m || m[1] !== safeName(sid) || Number(m[2]) !== rec.at || rec.sessionId !== sid || rec.ledgr !== COLD_FORMAT || rec.v !== 1) continue;
      if (x.sig !== this.coldSig(sid)) continue;
      const turnsNow = own(this.d.turns, sid) && isObj(this.d.turns[sid]) ? this.d.turns[sid] : {};
      if (JSON.stringify(rec.session) !== JSON.stringify(s) || JSON.stringify(rec.items) !== JSON.stringify(this.itemsOf(sid))
        || JSON.stringify(rec.turns) !== JSON.stringify(turnsNow) || JSON.stringify(rec.n) !== JSON.stringify(this.coldCounts(sid))) continue;
      let ok = false;
      try { ok = canFreeze(sid) === true; } catch { ok = false; }
      if (!ok) continue;
      const clock = this.touchedAt(sid);
      if (clock > num(s.touchedAt)) s.touchedAt = clock;
      for (const it of this.itemsOf(sid)) delete this.d.items[it.id];
      delete this.d.turns[sid];
      s.cold = { file, at: rec.at, n: copy(rec.n) };
      out.push(sid);
    }
    return out;
  }

  // ── thaw and merge ──
  // The sessions an event needs warm: its own (session_id, else session, else request.anchor.sessionId), a
  // branch_started's parent_session_id too, a pins_asked's for_session too; only those that are cold. None
  // for the COLD_FREE events, for an act "seen" (it marks the record's chip seen, nothing else), and for an
  // event apply() drops (a forgotten session's). The writer leaves out what `ingested` already holds.
  coldOf(ev) {
    if (!isObj(ev) || !ev.type || COLD_FREE.has(ev.type)) return [];
    if (ev.type === "act" && ev.action === "seen") return [];
    const sid = str(ev.session_id) ?? str(ev.session) ?? str(ev.request?.anchor?.sessionId);
    if (!sid || this.isForgotten(sid)) return [];
    const out = [];
    const add = (x) => { if (x && this.isCold(x) && !this.isForgotten(x) && !out.includes(x)) out.push(x); };
    add(sid);
    if (ev.type === "branch_started") add(str(ev.parent_session_id));
    if (ev.type === "pins_asked") add(str(ev.for_session));
    return out;
  }
  // coldOf over a batch: Set<sid> of the cold sessions it needs, the events already in `ingested` left out.
  // It may name a session the same batch later forgets (thawing it is harmless).
  coldNeeded(events) {
    const out = new Set(), ing = new Set(this.d.ingested);
    for (const ev of Array.isArray(events) ? events : []) {
      if (!isObj(ev) || (ev.id && ing.has(ev.id))) continue;
      for (const sid of this.coldOf(ev)) out.add(sid);
    }
    return out;
  }

  // The file's items and turn records back in the store (the writer, once it has read and parsed the file the
  // stub names). Refused (nothing changed) when the record fails coldRecordError, or the session is not
  // recorded, not cold, or names another file. Items go in file order, the ones whose id the store already
  // holds left out (the store's copy wins: a mixed session), then the store's own items of the session after
  // them; turn records the same by key. `it.branch` naming a branch record no longer there goes, as Forget
  // drops it. nextHandle becomes the larger of the stub's, the file's and one past every handle the session's
  // items hold, so no handle is handed out twice. The file stays on disk (the sweep deletes it after the
  // grace). {ok: true, items, turns} (how many came back; `kept`, those the store won) or {ok: false, error}.
  thaw(sid, record, file, now = Date.now()) {
    const s = own(this.d.sessions, sid) ? this.d.sessions[sid] : null;
    if (!s) return { ok: false, error: "the session is not in the store" };
    if (!s.cold) return { ok: false, error: "the session is not cold" };
    if (s.cold.file !== file) return { ok: false, error: `the session names ${String(s.cold.file).slice(0, 80)}, not ${String(file).slice(0, 80)}` };
    const bad = coldRecordError(record, sid);
    if (bad) return { ok: false, error: bad };
    const theirs = this.itemsOf(sid);
    // A handle the store's own items of the session already hold (integration, 2026-11-19): a session that came
    // back warm after store.json lost its stub (a corrupt start, an older copy put back) counts from A1 again, and
    // a file merged into it by hand (Retention.md 10.8) holds A1 too. Such an item of the file takes the next
    // handle once the counters are raised, its own kept as `handleWas` (as restoreItem does).
    const held = new Set(theirs.map((it) => it.handle).filter((h) => typeof h === "string" && h));
    const clash = [];
    let items = 0, turns = 0, keptItems = 0, keptTurns = 0;
    for (const it of record.items) {
      if (own(this.d.items, it.id)) { keptItems++; continue; }
      const c = copy(it);
      if (c.branch && !own(this.d.branches, c.branch.branchId)) delete c.branch;
      this.d.items[c.id] = c;
      if (typeof c.handle === "string" && held.has(c.handle)) clash.push(c); else if (typeof c.handle === "string") held.add(c.handle);
      items++;
    }
    for (const it of theirs) { delete this.d.items[it.id]; this.d.items[it.id] = it; }
    for (const [k, r] of Object.entries(record.turns ?? {})) {
      const all = own(this.d.turns, sid) && isObj(this.d.turns[sid]) ? this.d.turns[sid] : (this.d.turns[sid] = {});
      if (own(all, k)) { keptTurns++; continue; }
      all[k] = copy(r);
      turns++;
    }
    this.raiseHandles(s, record.session?.nextHandle);
    for (const c of clash) {
      const m = /^([AQ])\d+$/.exec(c.handle);
      if (!m) continue;
      if (!isObj(s.nextHandle)) s.nextHandle = { A: 1, Q: 1, P: 1 };
      const k = m[1], next = Math.max(1, Math.floor(Number(s.nextHandle[k]) || 1));
      c.handleWas = c.handle;
      c.handle = `${k}${next}`;
      s.nextHandle[k] = next + 1;
    }
    delete s.cold;
    this.merged.delete(sid);
    s.thawedAt = s.touchedAt = num(now, Date.now());
    // The file is now redundant for this store's history (its items are here, the store's own winning): the
    // sweep may delete it by name, after the grace (coldGarbage), and only because this record lists it.
    const was = Array.isArray(s.coldThawed) ? s.coldThawed.filter((e) => isObj(e) && e.file !== file) : [];
    s.coldThawed = [...was, { file, at: s.thawedAt }].slice(-COLD_THAWED_MAX);
    return { ok: true, items, turns, kept: { items: keptItems, turns: keptTurns } };
  }
  // nextHandle at least `other`'s (the file's copy of the record) and past every A/Q handle the session's
  // items hold; a counter already high enough is left as it is (a missing one stays missing unless raised).
  raiseHandles(s, other) {
    const want = {};
    const up = (k, v) => { const x = Number(v); if (Number.isFinite(x) && x >= 1) want[k] = Math.max(want[k] ?? 0, Math.floor(x)); };
    if (isObj(other)) for (const k of ["A", "Q", "P"]) up(k, other[k]);
    for (const it of this.itemsOf(s.sessionId)) {
      const m = /^([AQ])(\d+)$/.exec(String(it.handle ?? ""));
      if (m) up(m[1], Number(m[2]) + 1);
    }
    for (const [k, v] of Object.entries(want)) {
      const cur = Number(s.nextHandle?.[k]);
      if (Number.isFinite(cur) && cur >= v) continue;
      if (v <= 1 && !Number.isFinite(cur)) continue;
      if (!isObj(s.nextHandle)) s.nextHandle = { A: 1, Q: 1, P: 1 };
      s.nextHandle[k] = v;
    }
  }

  // A reading copy's view of a cold session: copies of the file's items and turn records beside its stub (the
  // store's own winning, as in thaw), `s.cold` unchanged, the session marked merged (countsOf and chips() then
  // count from the items). What it adds stays out of toText() and snapshot(); a writer never merges. The same
  // file again adds nothing. false when the record fails coldRecordError or the stub does not name `file`.
  mergeCold(sid, record, file) {
    if (!this.isCold(sid) || this.d.sessions[sid].cold.file !== file || coldRecordError(record, sid)) return false;
    let m = this.merged.get(sid);
    if (m && m.file !== file) { this.unmerge(sid); m = null; }
    if (!m) { m = { file, items: new Set(), turns: new Set(), madeTurns: false }; this.merged.set(sid, m); }
    for (const it of record.items) {
      if (own(this.d.items, it.id)) continue;
      const c = copy(it);
      if (c.branch && !own(this.d.branches, c.branch.branchId)) delete c.branch;
      this.d.items[c.id] = c;
      m.items.add(c.id);
    }
    for (const [k, r] of Object.entries(record.turns ?? {})) {
      if (!(own(this.d.turns, sid) && isObj(this.d.turns[sid]))) { this.d.turns[sid] = {}; m.madeTurns = true; }
      if (own(this.d.turns[sid], k)) continue;
      this.d.turns[sid][k] = copy(r);
      m.turns.add(k);
    }
    return true;
  }
  // What a merge added, taken out again.
  unmerge(sid) {
    const m = this.merged.get(sid);
    if (!m) return;
    for (const id of m.items) delete this.d.items[id];
    const all = own(this.d.turns, sid) ? this.d.turns[sid] : null;
    if (isObj(all)) { for (const k of m.turns) delete all[k]; if (m.madeTurns && !Object.keys(all).length) delete this.d.turns[sid]; }
    this.merged.delete(sid);
  }

  // ── faults, cold_retry, cold_reset ──
  // The writer could not read the session's file (missing, unparseable, wrong format or session): recorded on
  // the stub as `cold.fault = {at, error, tries, held}`. A try (heldDelta 0, or the first fault) moves `at` and
  // `tries`; a call that only adds held events (heldDelta > 0) adds to `held` alone. false when the session is
  // not cold.
  coldFault(sid, error, now = Date.now(), heldDelta = 0) {
    if (!this.isCold(sid)) return false;
    const c = this.d.sessions[sid].cold, add = Math.max(0, Math.floor(num(heldDelta, 0)));
    const why = error === null || error === undefined || String(error) === "" ? null : String(error).slice(0, 300);
    const f = isObj(c.fault) ? c.fault : null;
    if (!f) c.fault = { at: num(now, Date.now()), error: why ?? "the file cannot be read", tries: 1, held: add };
    else if (add) { f.held = tally(f.held) + add; if (why) f.error = why; }
    else { f.at = num(now, Date.now()); if (why) f.error = why; f.tries = tally(f.tries) + 1; }
    return true;
  }

  // {type: "cold_retry", session_id}: the panel's Try again. The writer has tried the read before the batch
  // applies (a read that worked has thawed the session); nothing to change here.
  on_cold_retry() {}

  // {type: "cold_reset", session_id, file}: the panel's "Use without its older items" (two clicks), on a session
  // whose file the writer could not read. Only a faulted stub that still names `file`: `coldLost` keeps the file's
  // name, the counts and the error ({file, at (now), frozenAt, n, error}); the session is warm again and empty of
  // what the file held (its nextHandle, pins, branches and `archived` stay, so no handle is handed out twice),
  // and its held events replay into it. The file itself is kept on disk (coldGarbage never deletes a file a
  // record names, coldLost included).
  on_cold_reset(ev, s, at) {
    const c = s.cold;
    if (!c || !isObj(c.fault) || typeof ev.file !== "string" || c.file !== ev.file) return;
    s.coldLost = { file: c.file, at, frozenAt: num(c.at), n: copy(isObj(c.n) ? c.n : {}), error: str(c.fault.error) ?? "the file cannot be read" };
    this.unmerge(s.sessionId);   // a reading copy's view: the file's items are not the session's any more
    delete s.cold;
    s.thawedAt = s.touchedAt = at;
  }

  // ── the sweep ──
  // Integration, 2026-11-19 (the review's blocker): a cold file is deleted only when it is provably redundant.
  // A file no record names is not proof by itself: store.json can go back in time (a store.json the writer
  // could not parse at a start, kept aside as store.corrupt-<ms>.json, the writer starting empty; one restored
  // by hand from an older copy), and a session it lost comes back warm with none of the file's items. So by name
  // alone only two kinds go: a file the session's own record lists as thawed (`coldThawed`: its items came back
  // into this store's history, so a store that holds the record holds them), once the thaw is graceMs old; and a
  // file of a session this store forgot, keepMs after the Forget. Every other file a record does not name is the
  // writer's to read (coldUnproven) and to delete only when it holds nothing store.json lacks (coldLacks).

  // The names a record holds (cold.file, coldLost.file) and the sessions each safe name stands for.
  coldNames() {
    const named = new Set();
    for (const s of Object.values(this.d.sessions)) {
      if (typeof s?.cold?.file === "string") named.add(s.cold.file);
      if (typeof s?.coldLost?.file === "string") named.add(s.coldLost.file);
    }
    const bySafe = new Map();
    for (const sid of new Set([...Object.keys(this.d.sessions), ...Object.keys(this.d.forgotten)])) {
      const k = safeName(sid);
      if (!bySafe.has(k)) bySafe.set(k, []);
      bySafe.get(k).push(sid);
    }
    return { named, bySafe };
  }
  // A name's session when it is a cold file's name, no record names it, and its safe name stands for exactly one
  // session (recorded or forgotten): {sid, ms}; else null (kept: unknown sessions, shared safe names).
  coldFileOf(name, { named, bySafe }) {
    if (typeof name !== "string" || named.has(name)) return null;
    const m = COLD_NAME.exec(name);
    const sids = m ? bySafe.get(m[1]) : null;
    return sids && sids.length === 1 ? { sid: sids[0], ms: Number(m[2]) } : null;
  }
  // The session's thawed list entry for a file, or null.
  thawedEntry(s, name) {
    return (Array.isArray(s?.coldThawed) ? s.coldThawed : []).find((e) => isObj(e) && e.file === name) ?? null;
  }

  // Which of `names` (files in cold/, no folder) the writer's sweep may delete by name, decided from a store
  // equal to store.json on disk: (t) one its session's record lists as thawed (`coldThawed`), the thaw more than
  // graceMs ago; (a) one of a session forgotten more than keepMs ago. Never a name that does not match COLD_NAME,
  // that a record names (cold.file, coldLost.file), or whose safe name matches no session or more than one.
  coldGarbage(names, now = Date.now(), { graceMs = 3600e3, keepMs = 86400e3 } = {}) {
    const idx = this.coldNames();
    const t = num(now, Date.now()), grace = nonNeg(graceMs, 3600e3), keep = nonNeg(keepMs, 86400e3);
    const out = [];
    for (const name of new Set(Array.isArray(names) ? names : [])) {
      const f = this.coldFileOf(name, idx);
      if (!f) continue;
      const s = own(this.d.sessions, f.sid) ? this.d.sessions[f.sid] : null;
      if (!s) {
        const at = Number(this.d.forgotten[f.sid]);
        if (Number.isFinite(at) && t - at > keep) out.push(name);
        continue;
      }
      const e = this.thawedEntry(s, name);
      if (e && t - num(e.at) > grace) out.push(name);
    }
    return out;
  }

  // The files of `names` only a read can prove redundant: a cold file's name no record names, of exactly one
  // recorded session that is not faulted (a faulted session keeps every file: one may be what repairs it), not
  // in its thawed list, written more than keepMs ago. [{name, sid, ms}], oldest first. The writer reads each and
  // deletes it only when coldLacks finds nothing in it that store.json lacks; anything else stays for good.
  coldUnproven(names, now = Date.now(), { keepMs = 86400e3 } = {}) {
    const idx = this.coldNames();
    const t = num(now, Date.now()), keep = nonNeg(keepMs, 86400e3);
    const out = [];
    for (const name of new Set(Array.isArray(names) ? names : [])) {
      const f = this.coldFileOf(name, idx);
      if (!f) continue;
      const s = own(this.d.sessions, f.sid) ? this.d.sessions[f.sid] : null;
      if (!s || isObj(s.cold?.fault) || this.thawedEntry(s, name) || !(t - f.ms > keep)) continue;
      out.push({ name, sid: f.sid, ms: f.ms });
    }
    return out.sort((x, y) => x.ms - y.ms || (x.name < y.name ? -1 : 1));
  }

  // What a cold file's record (`record`, already checked by coldRecordError) holds that this store (store.json as
  // read from disk) lacks for session sid: {items, turns}, how many. Integration, 2026-11-19 (second and third
  // review): an id or a turn number found elsewhere is no proof, and neither is a later `updatedAt` (a store put
  // back from a backup and touched once is stamped later while holding less: the file's draft, its resolution).
  // An item counts as held only when a copy of the same id, of this session (`anchor.sessionId`), is identical
  // to the file's (JSON): the store's, or one of `copies` (id -> [items]: the session's named cold file, its
  // archive items files). The cost, accepted: an orphan whose items changed afterwards stays for good. A turn record counts as held only when the store's record of that turn is identical, or `turnCopies`
  // (turn -> [records]: the named file's, the archive's cut ones) holds an identical one, or the store's record
  // is the file's without its head and `heads` (turn -> textHead: the archive's moved heads) holds that head. A
  // store that went back in time never cut a record, so "older than the oldest kept" proves nothing.
  coldLacks(sid, record, { copies = new Map(), turnCopies = new Map(), heads = new Map() } = {}) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const out = { items: 0, turns: 0 };
    for (const it of Array.isArray(record?.items) ? record.items : []) {
      if (!isObj(it) || typeof it.id !== "string") { out.items++; continue; }
      const cand = [...(own(this.d.items, it.id) ? [this.d.items[it.id]] : []), ...(copies.get(it.id) ?? [])].filter((c) => isObj(c) && c.anchor?.sessionId === sid);
      if (!cand.some((c) => same(c, it))) out.items++;
    }
    const mine = own(this.d.turns, sid) && isObj(this.d.turns[sid]) ? this.d.turns[sid] : {};
    for (const [k, r] of Object.entries(isObj(record?.turns) ? record.turns : {})) {
      if (own(mine, k) && same(mine[k], r)) continue;
      if ((turnCopies.get(k) ?? []).some((c) => same(c, r))) continue;
      if (isObj(r) && typeof r.textHead === "string" && own(mine, k) && heads.get(k) === r.textHead) {
        const lean = { ...r };
        delete lean.textHead;
        if (same(mine[k], lean)) continue;
      }
      out.turns++;
    }
    return out;
  }

  // The thawed lists trimmed: an entry goes once its file is no longer in `present` (the sweep removed it) or
  // keepMs after the thaw (a file still there then is the read's to prove). True when anything changed.
  trimThawed(present, now = Date.now(), { keepMs = 86400e3 } = {}) {
    const there = new Set(Array.isArray(present) ? present : []), t = num(now, Date.now()), keep = nonNeg(keepMs, 86400e3);
    let changed = false;
    for (const s of Object.values(this.d.sessions)) {
      if (!Array.isArray(s?.coldThawed)) continue;
      const left = s.coldThawed.filter((e) => isObj(e) && there.has(e.file) && t - num(e.at) <= keep);
      if (left.length === s.coldThawed.length) continue;
      changed = true;
      if (left.length) s.coldThawed = left; else delete s.coldThawed;
    }
    return changed;
  }
}
