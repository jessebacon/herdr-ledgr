// ledgr list rows (docs/design/Detail.md 1.2-1.7): what one line of the panel's list says about an
// ask, a question, a pin or a branch (rowModel: handle, one pill, the text's first line, a state word,
// the quick actions), and the keyboard cursor over the list's entries (moveCursor, keepPlace). Pure: no
// Herdr, no gpui, nothing read or written; the panel draws the model, and the detail dialog's sub-rows
// (views.js subRow) draw the same one. Tones are theme() color names ("accent", "dim", …), never
// colors. Not an engine file.
import { isAgentAsk, isHuman, isClosed, isSuggestion, isBlocking, levelOf } from "./store.js";
import { handleWords, branchWords, agoWords, pinsWords } from "./words.js";

// A branch's live word (branch.js liveStatus, or the demo's), as the list and the dialog say it.
export const BR_WORD = { working: "working", blocked: "needs you", done: "done", idle: "idle", starting: "starting", launching: "launching…",
  launched: "starting", running: "running", closed: "closed", ended: "ended", failed: "launch failed", refused: "refused",
  nostart: "did not start", concluded: "concluded", rejoined: "rejoined" };
// A branch row's tone by its live word (the old row's color map).
const BR_TONE = { working: "working", blocked: "blocked", done: "done", failed: "blocked", nostart: "blocked", refused: "dim", closed: "dim", ended: "dim" };
// A branch still starting or running: its glyph is the spinner.
const BR_SPIN = new Set(["working", "launching", "launched", "starting"]);
// The row at the panel's 280 px minimum (Detail.md 6.1): the state word is capped at stateMaxW and
// truncates; the text's first line keeps at least textMinW. stateChars: the longest word stateOf gives
// for a known status (bin/tests/test_list.mjs holds every word to it).
export const ROW = { stateMaxW: 104, textMinW: 48, stateChars: 20 };

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const DAY = 86400e3, HOUR = 3600e3;

// An agent ask with an answer typed or picked that has not reached the agent (2026-11-11, "answered but
// not sent to prompt"): open (a suggestion below the threshold too) or deferred, with a draft that is not
// the answer a landed sheet recorded. The store keeps the draft after the sheet lands, so the mark keys
// on the status (answered, resolved: gone) and, for an ask reopened after its sheet landed, on the
// recorded answer (store.js on_answers_landed keeps it squashed, whole up to LIMITS.answer, the draft's
// own cap): equal once both are squashed (the sheet drops blank lines and indents), so an answer edited
// after it landed ("No" landed, "No, use the replica" typed) is drafted again.
export function draftPending(it) {
  if (!isAgentAsk(it) || (it.status !== "open" && it.status !== "deferred")) return false;
  const d = squash(it.draft);
  if (!d) return false;
  return d !== squash(it.answer);
}

// The first non-empty line of a text, whitespace collapsed, cut at n characters (the last one "…").
export function firstLine(text, n = 160) {
  const line = String(text ?? "").split(/\r?\n/).map(squash).find(Boolean) ?? "";
  return cut(line, n);
}

// An item's status glyph as [char, tone]: the old row's mapping, as data. `sug`: drawn as a suggestion
// (an ask below the threshold): hollow. An open blocking ask: ◆ in `blocked`. A parked question whose
// anchor waits for its turn's end: hollow.
export function glyphOf(it, sug = false) {
  let g = { open: ["●", "accent"], answered: ["◐", "accent"], resolved: ["✓", "done"], dismissed: ["✕", "dim"], deferred: ["◷", "muted"],
    rejoin_pending: ["↩", "accent"] }[it?.status] ?? ["·", "dim"];
  if (isHuman(it) && it.status === "open" && it.anchor && !it.anchor.settled) g = ["○", "dim"];
  else if (it?.status === "open" && isBlocking(it) && !sug) g = ["◆", "blocked"];
  else if (it?.status === "open" && sug) g = ["○", "dim"];
  return [...g];
}

// The kind of a store record as the list names it: "ask", "question", "pin" or "branch".
export function rowKind(x, kind = "item") {
  if (kind === "pin" || kind === "branch") return kind;
  return isAgentAsk(x) ? "ask" : "question";
}

// The entry key of a row (1.7): items by id (an ask and a question are both `item:`), pins, branches.
export function entryKey(kind, id) {
  if (kind === "ask" || kind === "question" || kind === "item") return `item:${id}`;
  return `${kind}:${id}`;
}

// The branch that speaks for a question in its state word: its newest that was not refused and did
// not fail (branchesFor sorts newest first).
const branchOf = (it, store) => (typeof store?.branchesFor === "function" ? store.branchesFor(it.id) : [])
  .find((b) => b.status !== "refused" && b.status !== "failed") ?? null;
const liveOf = (br, ctx) => (typeof ctx?.branchLive === "function" ? ctx.branchLive(br) : br?.status) ?? null;

// The state word and its tone (1.3); the first match wins. ctx: {threshold, now, here, store, branchLive}.
export function stateOf(kind, x, ctx = {}) {
  const k = rowKind(x, kind);
  const w = (word, tone) => ({ word, tone });
  if (k === "pin") {
    if (x?.status === "archived") return w("archived", "dim");
    if (Array.isArray(x?.answeredIn) && x.answeredIn.length) return w("answered", "done");
    const used = Array.isArray(x?.usedIn) ? x.usedIn : [];
    if (used.some((u) => (typeof ctx.store?.item === "function" ? ctx.store.item(u?.question) : null)?.pinsAsked)) return w("sent", "muted");
    if (used.length) return w("used", "muted");
    if (!x?.anchor?.verified) return w("unverified", "dim");
    return w(agoWords(x?.createdAt, ctx.now ?? Date.now()), "dim");
  }
  if (k === "branch") {
    const live = liveOf(x, ctx);
    return w(BR_WORD[live] ?? live ?? "?", BR_TONE[live] ?? "muted");
  }
  const it = x ?? {};
  if (it.status === "resolved") {
    if (it.resolvedBy === "branch") return w("resolved by branch", "done");
    if (k === "ask" && it.resolvedBy === "answer") return w("answered by you", "done");
    if (k === "ask" && it.resolvedBy === "agent") return w("closed by agent", "done");
    return w("done", "done");
  }
  if (it.status === "dismissed") return it.dismissedBy === "clear" ? w("cleared", "dim") : w("not needed", "dim");
  // An answer typed or picked and not sent (draftPending): "drafted", dim, where no Paste button stands
  // for it (a deferred ask, a suggestion: Promote is their quick action); the glyph and the pill still say
  // deferred or below the threshold.
  if (it.status === "deferred") return k === "ask" && draftPending(it) ? w("drafted", "dim") : w("deferred", "muted");
  if (k === "ask") {
    if (it.status === "answered") return w("answered", "accent");
    if (it.status === "open") {
      if (isSuggestion(it, ctx.threshold)) return draftPending(it) ? w("drafted", "dim") : w("below threshold", "dim");
      if (squash(it.draft)) return w("answer ready", "accent");
      if (it.repeatOf) return w("raised again", "accent");
      return w("open", isBlocking(it) ? "blocked" : "accent");
    }
    return w(String(it.status ?? "?"), "dim");
  }
  if (it.status === "rejoin_pending") return w("rejoining", "accent");
  if (it.status === "answered") return w("answered", "accent");
  const br = branchOf(it, ctx.store);
  if (br) {
    const live = liveOf(br, ctx);
    return w(`branch ${BR_WORD[live] ?? live ?? "?"}`, live === "working" ? "working" : live === "blocked" ? "blocked" : "accent");
  }
  if (it.askedAtTurn) return w(`sent at turn ${it.askedAtTurn}`, "muted");
  if (it.status === "open") return it.anchor && !it.anchor.settled ? w("anchoring", "dim") : w("parked", "accent");
  return w(String(it.status ?? "?"), "dim");
}

// The row's tooltip: the text's first 300 characters, then the quote's first 120 in quotes; a pin's
// adds its note.
function tipOf(text, quote, note) {
  const t = String(text ?? "").trim(), q = squash(quote);
  return [t ? cut(t, 300) : null, q ? `“${cut(q, 120)}”` : null, note ? `Note: ${cut(squash(note), 200)}` : null].filter(Boolean).join("\n");
}

// One list row (1.2). kind: "ask", "question", "pin", "branch" ("item": an ask or a question by its
// direction). ctx: {threshold, now, here, store, branchLive: (br) => live word}. Returns {key, kind, id,
// sessionId, handle, pill: {text, tone} | null, text, state: {word, tone}, glyph: [char, tone, icon],
// quick: {done, paste, promote}, drafted, tip}. glyph[2] names an icon the drawer may use instead of the
// char ("pin", "git-branch", "spinner"; null for items). quick.done: an ask or question not closed (shown
// on hover and on the cursor row); quick.paste: an open ask (not answered, deferred or closed: an answer
// that landed is not pasted twice), not below the threshold, with an answer typed or picked;
// quick.promote: an ask below the threshold, not closed (it stands in for Paste). drafted: an answer
// typed or picked and not sent (draftPending): Paste (an open row) or the word "drafted" (a suggestion, a
// deferred ask) shows it, and the tooltip ends with the answer.
export function rowModel(kind, x, ctx = {}) {
  const k = rowKind(x, kind);
  const none = { done: false, paste: false, promote: false };
  if (k === "pin") {
    const p = x ?? {};
    return { key: entryKey("pin", p.id), kind: "pin", id: p.id, sessionId: p.sessionId ?? null, handle: handleWords(p.handle), pill: null,
      text: firstLine(p.text), state: stateOf("pin", p, ctx), glyph: ["•", p.status === "archived" ? "dim" : "accent", "pin"],
      quick: { ...none }, drafted: false, tip: tipOf(p.text, null, p.note) };
  }
  if (k === "branch") {
    const br = x ?? {}, it = typeof ctx.store?.item === "function" ? ctx.store.item(br.requestId) : null;
    const st = stateOf("branch", br, ctx), live = liveOf(br, ctx);
    return { key: entryKey("branch", br.id), kind: "branch", id: br.id, sessionId: br.parentSessionId ?? null, handle: branchWords(it),
      pill: br.name ? { text: br.name, tone: "dim" } : null, text: it ? itemText(it) : "", state: st,
      glyph: ["↳", st.tone, BR_SPIN.has(live) ? "spinner" : "git-branch"], quick: { ...none }, drafted: false,
      tip: tipOf(it?.text || it?.anchor?.quote || "", null, null) };
  }
  const it = x ?? {}, ask = k === "ask", closed = isClosed(it);
  const sug = ask && isSuggestion(it, ctx.threshold);
  let pill = null;
  if (ask) {
    const level = levelOf(it);
    pill = level === "blocking" ? { text: "blocking", tone: "blocked" } : sug ? { text: level, tone: "dim" } : it.kind ? { text: it.kind, tone: "dim" } : null;
  } else {
    const n = typeof ctx.store?.pinsOf === "function" ? ctx.store.pinsOf(it).length : Array.isArray(it.pins) ? it.pins.length : 0;
    if (n) pill = { text: pinsWords(n), tone: "accent" };
    else if (it.kind === "bookmark") pill = { text: "bookmark", tone: "dim" };
    else if (it.origin === "btw" || it.btwStagedAt) pill = { text: "/btw", tone: "muted" };
  }
  const drafted = ask && draftPending(it);
  const tip = tipOf(it.text, it.anchor?.quote, null);
  return { key: entryKey(k, it.id), kind: k, id: it.id, sessionId: it.anchor?.sessionId ?? null, handle: handleWords(it.handle), pill,
    text: itemText(it), state: stateOf(k, it, ctx), glyph: [...glyphOf(it, sug), null],
    quick: { done: !closed, paste: ask && it.status === "open" && !sug && Boolean(squash(it.draft)), promote: ask && !closed && sug },
    drafted, tip: drafted ? [tip, `Your answer, not sent yet: ${cut(squash(it.draft), 120)}`].filter(Boolean).join("\n") : tip };
}

// ── the panel's lanes as sequences (the dialog's previous and next, 2026-11-11) ──
// The record ids of the lane x is drawn in, in the order panel.js draws them (body, pinsLane,
// suggestions), whatever is folded there: the asks lane by turn, newest first, each turn's asks blocking
// first then in the message's order, then its asks below the threshold; YOUR QUESTIONS newest first; the
// session's branches newest first (a refused or failed one an hour old is not drawn); a session's pins
// newest first, the archived ones apart; the OLDER THAN A DAY, DEFERRED and CLOSED folds, asks and
// questions together, the most recently changed first. Child questions are in YOUR QUESTIONS only.
// {lane, ids}: lane "asks", "mine", "branches", "pins", "archived", "older", "deferred", "closed", or
// null (nothing to step through). opts: {threshold, now}.
export function laneOf(store, kind, x, { threshold, now = Date.now() } = {}) {
  if (!store || !x) return { lane: null, ids: [] };
  const k = rowKind(x, kind);
  const ids = (list) => list.map((r) => r.id);
  if (k === "pin") {
    const archived = x.status === "archived";
    return { lane: archived ? "archived" : "pins", ids: ids(store.pinsIn(x.sessionId, { archived })) };
  }
  if (k === "branch") {
    const shown = (b) => b.id === x.id || !((b.status === "refused" || b.status === "failed") && now - (b.updatedAt ?? b.createdAt ?? 0) > HOUR);
    return { lane: "branches", ids: ids(store.branchesOf(x.parentSessionId).filter(shown)) };
  }
  const items = store.itemsOf(x.anchor?.sessionId);
  const stale = (it) => it.status === "open" && now - (it.updatedAt ?? 0) > DAY;
  const active = (it) => (it.status === "open" || it.status === "answered" || it.status === "rejoin_pending") && !stale(it);
  const changed = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  if (stale(x)) return { lane: "older", ids: ids(items.filter(stale).sort(changed)) };
  if (x.status === "deferred") return { lane: "deferred", ids: ids(items.filter((it) => it.status === "deferred").sort(changed)) };
  if (isClosed(x)) return { lane: "closed", ids: ids(items.filter(isClosed).sort(changed)) };
  if (k === "question") return { lane: "mine", ids: ids(items.filter((it) => isHuman(it) && active(it)).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))) };
  const asks = items.filter((it) => isAgentAsk(it) && active(it));
  const out = [];
  for (const turn of [...new Set(asks.map((it) => it.anchor?.turn))].sort((a, b) => b - a)) {
    const all = asks.filter((it) => it.anchor?.turn === turn);
    out.push(...all.filter((it) => !isSuggestion(it, threshold)).sort((a, b) => (isBlocking(b) ? 1 : 0) - (isBlocking(a) ? 1 : 0) || (a.seq ?? 0) - (b.seq ?? 0)),
      ...all.filter((it) => isSuggestion(it, threshold)).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)));
  }
  return { lane: "asks", ids: ids(out) };
}

// Where id stands in a lane's ids: {at, of, prev, next} (at counts from 1; prev and next null at the
// ends: no wrap). An id not in the list: at 0, no neighbours.
export function neighbors(ids, id) {
  const list = Array.isArray(ids) ? ids : [], i = list.indexOf(id);
  if (i < 0) return { at: 0, of: list.length, prev: null, next: null };
  return { at: i + 1, of: list.length, prev: i > 0 ? list[i - 1] : null, next: i < list.length - 1 ? list[i + 1] : null };
}

// An item's one line: its text's first line; a bookmark (no text), the first line of its quote in quotes.
function itemText(it) {
  if (it.kind === "bookmark" || !squash(it.text)) {
    const q = firstLine(it.anchor?.quote);
    if (q) return `“${q}”`;
  }
  return firstLine(it.text);
}

// The cursor after a key (1.7): delta ±1, ±8, "home" or "end" over the entry keys in drawing order.
// From no cursor (or one no longer listed), down goes to the first entry and up to the last; it stops
// at both ends. No entries: null.
export function moveCursor(keys, cursor, delta) {
  const list = Array.isArray(keys) ? keys : [];
  if (!list.length) return null;
  if (delta === "home") return list[0];
  if (delta === "end") return list[list.length - 1];
  const d = Number(delta) || 0;
  const i = cursor == null ? -1 : list.indexOf(cursor);
  if (i < 0) return d < 0 ? list[list.length - 1] : list[0];
  return list[Math.max(0, Math.min(list.length - 1, i + d))];
}

// The cursor after a render (1.7): a key still listed stays, wherever it moved; a key that left goes to
// the entry that followed it (the first of those still listed), else to the one before it; nothing
// left, or a cursor that was never listed: null.
export function keepPlace(prevKeys, keys, cursor) {
  if (cursor == null) return null;
  const now = Array.isArray(keys) ? keys : [], prev = Array.isArray(prevKeys) ? prevKeys : [];
  if (now.includes(cursor)) return cursor;
  const here = new Set(now), i = prev.indexOf(cursor);
  if (i < 0) return null;
  for (let j = i + 1; j < prev.length; j++) if (here.has(prev[j])) return prev[j];
  for (let j = i - 1; j >= 0; j--) if (here.has(prev[j])) return prev[j];
  return null;
}
