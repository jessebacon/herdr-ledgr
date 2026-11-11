// ledgr detail dialog, the pure half (docs/design/Detail.md 2.9): the dialog's props and its overlay
// spec (and the settings dialog's, settings.js: SETTINGS, settingsProps, settingsSpec), which kind a record is, the message split around its passage (moved from panel.js), text shown
// exactly as stored through a markdown TextView, and the close rules: which staging results close the
// dialog, how its closed record merges into shared("ledgr.detail"), and the Conclude text it keeps in
// localStorage. Imports nothing (no herdr, no gpui): it loads in Node (bin/tests/test_detail.mjs) as in
// Herdr. Not an engine file.

// The dialog's size (shares of the window; Herdr has no minimum), where it turns into two columns, the
// left column's share of the width then, and the narrowest width it is laid out for.
export const DETAIL = { width: 0.6, height: 0.75, twoColumnsAt: 760, leftShare: 0.46, minWidth: 420 };
export const KINDS = ["ask", "question", "pin", "branch"];
// Opened in a state (2.8), applied once after load. The view states show something (the Branch
// confirmation, the Conclude editor, the note editor, the whole message, the answer focused, a menu
// open); the action states act once (scripted commands only): Go to anchor, Ask here, Ask for a
// conclusion, the confluence again, Close branch armed.
export const VIEW_STATES = ["confirm", "conclude", "note", "whole", "answer", "defer", "more"];
export const ACTION_STATES = ["go", "ask-here", "ask-conclusion", "again", "close"];
export const OPEN_STATES = [...VIEW_STATES, ...ACTION_STATES];
// The dialog copy's localStorage key for unsent Conclude texts ({[branchId]: {text, at}}). Keys start
// with "detail.": the capture box is also an overlay of ledgr and keeps "lastClip" (BUILD-NOTES-mod.md).
export const KEEP_KEY = "detail.conclude";

const PIN_ID = /^pn_[A-Za-z0-9-]{8,64}$/;   // store.js PIN_ID (this module imports nothing)
const DAY = 86400e3;
const str = (v, max = 128) => (typeof v === "string" && v.length >= 1 && v.length <= max ? v : null);

// The dialog's props as given to openOverlay (plus Herdr's `overlay`), checked: {ok: true, session, kind,
// id, open, sel, opener, demo, overlay} or {ok: false, error}. A bad view, kind or id refuses; an unknown
// `open` is dropped; `sel` keeps pin ids only, each once, at most maxSel (LIMITS.pinsPerQuestion, passed
// in); `demo` only when it is true.
export function detailProps(p, maxSel = 12) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, error: "no props" };
  if (p.view !== "detail") return { ok: false, error: `not a detail view (${String(p.view ?? "none").slice(0, 20)})` };
  if (!KINDS.includes(p.kind)) return { ok: false, error: `unknown kind ${String(p.kind ?? "none").slice(0, 20)}` };
  const id = str(p.id);
  if (!id) return { ok: false, error: "no id, or one longer than 128 characters" };
  const max = Math.max(0, Math.floor(Number(maxSel) || 0));
  const sel = [];
  for (const x of Array.isArray(p.sel) ? p.sel : []) if (typeof x === "string" && PIN_ID.test(x) && !sel.includes(x)) sel.push(x);
  return { ok: true, session: str(p.session), kind: p.kind, id, open: OPEN_STATES.includes(p.open) ? p.open : null,
    sel: sel.slice(0, max), opener: str(p.opener), demo: p.demo === true, overlay: str(p.overlay, 256) };
}

// The OverlaySpec the panel opens the dialog with (2.2): a centered dialog of this mod, never a layout.
export function detailSpec(p = {}) {
  return { mod: "ledgr", kind: "dialog", width: DETAIL.width, height: DETAIL.height,
    props: { view: "detail", session: p?.session ?? null, kind: p?.kind ?? null, id: p?.id ?? null, open: p?.open ?? null,
      sel: Array.isArray(p?.sel) ? [...p.sel] : [], opener: p?.opener ?? null, demo: p?.demo === true } };
}

// The settings dialog (settings.js, 2026-11-10): half the window's width, 0.7 of its height.
export const SETTINGS = { width: 0.5, height: 0.7 };

// Its props as given to openOverlay (plus Herdr's `overlay`), checked: {ok: true, opener, demo, overlay}
// or {ok: false, error}.
export function settingsProps(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, error: "no props" };
  if (p.view !== "settings") return { ok: false, error: `not the settings view (${String(p.view ?? "none").slice(0, 20)})` };
  return { ok: true, opener: str(p.opener), demo: p.demo === true, overlay: str(p.overlay, 256) };
}

// The OverlaySpec the panel's gear, ledgr.settings and ledgr.demo-settings open it with: a centered
// dialog of this mod (Esc or a click outside closes it), never a layout.
export function settingsSpec(p = {}) {
  return { mod: "ledgr", kind: "dialog", width: SETTINGS.width, height: SETTINGS.height,
    props: { view: "settings", opener: p?.opener ?? null, demo: p?.demo === true } };
}

// Two columns from this width up (2.2); the left column's width then.
export const twoColumns = (width) => Number(width) >= DETAIL.twoColumnsAt;
export const leftWidth = (width) => Math.round(Math.max(DETAIL.minWidth, Number(width) || 0) * DETAIL.leftShare);

// What a record is, whatever the props' hint said (2.1): a pin by its pn_ id, a branch by br_, an item by
// its direction. null: nothing known.
export function kindOf(id, item = null) {
  const s = String(id ?? "");
  if (s.startsWith("pn_")) return "pin";
  if (s.startsWith("br_")) return "branch";
  if (item?.direction === "agent_to_human") return "ask";
  if (item?.direction === "human_to_agent") return "question";
  return null;
}

// ── the message and its passage (moved from panel.js, unchanged) ─────────
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const plain = (s) => squash(String(s ?? "").replace(/[`*_#>]+/g, ""));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// [start, end) of the quote in the message text, tolerant of whitespace and markdown marks.
export function locate(text, quote) {
  if (!text || !quote) return null;
  const q = String(quote).trim();
  const i = text.indexOf(q);
  if (i >= 0) return [i, i + q.length];
  const words = plain(q).split(" ").filter(Boolean).slice(0, 25);
  if (!words.length) return null;
  try {
    const m = new RegExp(words.map(escapeRe).join("[\\s`*_#>]+")).exec(text);
    return m ? [m.index, m.index + m[0].length] : null;
  } catch { return null; }
}

// The anchoring message split around the paragraph that holds the quote, so that paragraph can
// be drawn highlighted (TextView's bold is not visibly heavier at panel sizes). Not whole: about
// 600 characters of context either side, cut at paragraph breaks.
export function passageParts(text, quote, whole) {
  const span = locate(text, quote);
  if (!span) return { before: whole || text.length <= 1400 ? text : text.slice(0, 1400) + "\n\n…", hit: null, after: "" };
  const [a, b] = span;
  const pa = text.lastIndexOf("\n\n", a);
  let start = pa < 0 ? 0 : pa + 2;
  const pb = text.indexOf("\n\n", b);
  let end = pb < 0 ? text.length : pb;
  // A long paragraph with line breaks (a list): highlight only the lines that hold the quote.
  if (end - start > 300 && text.slice(start, end).includes("\n")) {
    start = Math.max(start, text.lastIndexOf("\n", a - 1) + 1);
    const nl = text.indexOf("\n", b);
    end = nl < 0 || nl > end ? end : nl;
  }
  let before = text.slice(0, start), after = text.slice(end);
  if (!whole) {
    if (before.length > 600) { const c = before.indexOf("\n\n", before.length - 600); before = "…\n\n" + before.slice(c < 0 ? before.length - 600 : c + 2); }
    if (after.length > 600) { const c = after.lastIndexOf("\n\n", 600); after = after.slice(0, c > 0 ? c : 600) + "\n\n…"; }
  }
  return { before: before.trim(), hit: text.slice(start, end).trim(), after: after.trim() };
}

// ── text through a markdown TextView (2.3) ───────────────────────────────
// The ASCII punctuation markdown (CommonMark and GFM) reads as syntax somewhere: emphasis, code, links,
// images, headings, lists, quotes, tables, strikethrough, entities, autolinks, setext lines, math.
// CommonMark lets a backslash escape any ASCII punctuation, so each one shows as itself.
export const MD_SYNTAX = /[\\`*_{}[\]()#+\-.!|<>~=&$^:@]/g;
const NBSP = " ";

// The person's text, a pin's passage and note, a question's quote, an answer, a conclusion: shown
// exactly as stored. Every syntax character backslash-escaped, each line break a hard break (a
// backslash at the end of the line), leading spaces as no-break spaces (markdown would strip them, or
// read four as code; a tab counts four). Trailing line breaks are dropped (a last hard break would show
// its backslash).
export function mdVerbatim(text) {
  const t = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return t.split("\n").map((l) => l.replace(MD_SYNTAX, "\\$&")
    .replace(/^[ \t]+/, (w) => w.replace(/ /g, NBSP).replace(/\t/g, NBSP.repeat(4)))).join("\\\n");
}

// Markdown as written (an ask's text and quote, the message, a branch's last message and preamble) with
// its single line breaks kept: two spaces end every line that another line of the same paragraph
// follows. Blank lines, lines already ending in a hard break and fenced code are left alone.
export function hardBreaks(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let fence = null;   // {ch, n}: inside a fenced block opened by n of ch
  return lines.map((l, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(l);
    if (f) {
      if (!fence) fence = { ch: f[1][0], n: f[1].length };
      else if (f[1][0] === fence.ch && f[1].length >= fence.n && !f[2].trim()) fence = null;
      return l;
    }
    if (fence) return l;
    const next = lines[i + 1];
    if (next === undefined || !l.trim() || !next.trim() || /^ {0,3}(`{3,}|~{3,})/.test(next)) return l;
    return / {2}$|\\$/.test(l) ? l : `${l}  `;
  }).join("\n");
}

// ── closing (2.1, 2.7, 3.1) ──────────────────────────────────────────────
// After a staging (nav.js stageIntoPrompt's result r): pasted, or on the clipboard with the target's
// pane focused (off, focus, plain, blocked), the dialog closes and the pane keeps the keyboard; gone,
// clipboard and error focused nothing, so it stays open with the status line saying what to do.
export const STAGE_CLOSES = { pasted: true, off: true, focus: true, plain: true, blocked: true, gone: false, clipboard: false, error: false };
export function closesAfterStage(r) {
  if (!r || typeof r !== "object") return false;
  if (r.pasted === true) return true;
  return STAGE_CLOSES[r.why] === true;
}

// Where the keyboard goes after the dialog closed, by what closed it: Esc and a closing act give it back
// to the list ("list"); a staging or a pane focused leave it in that pane ("pane"); anything else (a
// click outside, the capture box opened) leaves it where the person put it (null).
export function focusAfter(by) {
  if (by === "esc" || by === "act") return "list";
  if (by === "stage" || by === "pane") return "pane";
  return null;
}

// shared("ledgr.detail") after this dialog closed: its closed record, and the open record cleared only
// when it names this dialog, so a newer dialog's open record survives an older one closing.
export function mergeClosed(cur, mine) {
  const open = cur && typeof cur === "object" && cur.open && typeof cur.open === "object" ? cur.open : null;
  return { open: open && open.overlay !== mine?.overlay ? open : null, closed: mine ?? null };
}

// The Conclude text kept for a branch (localStorage KEEP_KEY, the plain object read from it): offered
// back when it is under a day old and newer than the branch's posted conclusion (postedAt), else null.
export function keptConclude(kept, branchId, now = Date.now(), postedAt = null) {
  const k = kept && typeof kept === "object" ? kept[branchId] : null;
  if (!k || typeof k.text !== "string" || !k.text.trim()) return null;
  const at = Number(k.at);
  if (!Number.isFinite(at) || now - at >= DAY) return null;
  if (postedAt !== null && postedAt !== undefined && Number(postedAt) >= at) return null;
  return k.text;
}

// The kept texts with this branch's set to `text` (at `now`), or dropped when the text is empty; entries
// a day old or more go.
export function keepConclude(kept, branchId, text, now = Date.now()) {
  const out = {};
  for (const [k, v] of Object.entries(kept && typeof kept === "object" ? kept : {})) {
    if (k !== branchId && v && typeof v.text === "string" && Number.isFinite(Number(v.at)) && now - Number(v.at) < DAY) out[k] = v;
  }
  if (typeof text === "string" && text.trim()) out[branchId] = { text, at: now };
  return out;
}
