// ledgr pins, the box's decision (docs/design/Pins.md 3.2): what ⌘S in the capture box pins, and its
// anchor. Pure: no files, no UI, no Herdr calls, so tests/test_compose.mjs runs it in Node. capture.js
// does the looking (the session's saved turns, then its screen through `hc read`, which only reads)
// and hands the result here; the `pin` spool event carries what pinDraft returns plus an id.
//
// Not an engine file: confluence.js and branch.js never import it (a host in another mod has no copy).

import { LIMITS } from "./config.js";
import { pinText } from "./confluence.js";

// The box's pin key, in one place for the mod: keys.json (repo root) `mod:ledgr` and the installer's
// MOD_KEYS (setup/ledgr_setup.py) bind `bind` to `ledgr.<command>`, and tests/test_compose.mjs checks
// that both agree with this. ⌘S since the maintainer's live check on 2026-11-07: the first key lost to
// Herdr's own global picker (mod.open:picker), and `cmd-s` is bound in no shipped Herdr section (global or
// terminal). words.js PINS_EMPTY spells the label too.
export const PIN_KEY = { bind: "cmd-s", label: "⌘S", command: "pin" };

// A second ⌘S on a passage found nowhere pins it unverified, if it comes within this window.
export const PIN_CONFIRM_MS = 5000;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const thousands = (n) => String(Math.round(num(n, 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// config.js LIMITS, with the spec's values when a key is missing (7.1).
const PIN_DEFAULTS = { pin: 4000, pinNote: 200, pinsPerQuestion: 12 };
export function pinLimit(key) {
  const n = Number(LIMITS?.[key]);
  return Number.isFinite(n) && n > 0 ? n : PIN_DEFAULTS[key];
}

export const PIN_WORDS = {
  nothing: `Nothing to pin: select the passage in the agent's pane (fullscreen Claude copies it), then ⌘J, ${PIN_KEY.label}.`,
  notFound: `Not in this session's saved turns or on its screen. ${PIN_KEY.label} again pins it unverified.`,
  notOnScreen: `Not on this pane's screen (this agent's turns are not saved). ${PIN_KEY.label} again pins it unverified.`,
  noSession: "No session to pin against yet.",
  tooLong: (n, source) => `The ${source === "typed" ? "quote field" : "clipboard"} holds ${thousands(n)} characters; a pin keeps at most ${thousands(pinLimit("pin"))}. Copy a shorter passage.`,
  alreadyPins: "These are already pins: type the question and press Enter.",
  noBtw: "/btw cannot carry pins: Enter parks the question with them.",
  needText: "Type the question: the pins are its context.",
  sessionGone: "That session is no longer in ledgr's records: nothing is parked. Esc, then ask from a session the panel shows.",
  noPane: "This session has no live pane for Ask here to paste into: nothing is parked. Branch… needs none, and Ask about these… parks it to ask later.",
};

// The note: the box's one line when ⌘S is pressed, squashed and cut; empty is no note.
export const pinNote = (s) => squash(s).slice(0, pinLimit("pinNote")) || null;

// The decision of 3.2. In:
//   cand       the clipboard text as read (any length; checked against the limit here)
//   typed      the quote field's text (wins over the clipboard when not empty)
//   found      where that passage was found: "turn" (a saved turn), "screen" (`hc read`), or null
//   foundTurn  the turn whose saved text holds it (found "turn")
//   working    the agent works now (a screen pin then settles at the turn's Stop)
//   rec        the session's map record (session_id, terminal, turn, prompt_id, last_assistant_uuid, synthetic)
//   confirm    what the last refused ⌘S returned ({session, text, at}), or null
//   now        ms; note: the box's line; hash: passageHash, when the caller has it
// Out: { pin } (the `pin` event's payload without its id: text, note, anchor, createdTurn, createdAt), or
// { error, confirm? } (confirm: keep it and pass it back on the next ⌘S).
export function pinDraft({ cand, typed, found, foundTurn, working, rec, confirm, now, note, hash } = {}) {
  const at = num(now, Date.now());
  const typedText = pinText(typed);
  const source = typedText ? "typed" : "clipboard";
  const text = typedText || pinText(cand);
  if (squash(text).length < 3) return { error: PIN_WORDS.nothing };
  if (text.length > pinLimit("pin")) return { error: PIN_WORDS.tooLong(text.length, source) };
  if (!rec?.session_id) return { error: PIN_WORDS.noSession };
  const sTurn = num(rec.turn, 0);
  let turn = sTurn, verified, settled, approx;
  if (found === "turn" && Number.isFinite(Number(foundTurn)) && foundTurn !== null) {
    turn = num(foundTurn); verified = "turn"; settled = true; approx = false;
  } else if (found === "screen") {
    verified = "screen"; settled = !working; approx = !working;
  } else {
    const again = Boolean(confirm) && confirm.session === rec.session_id && confirm.text === text
      && at >= num(confirm.at, Infinity) && at - num(confirm.at, 0) <= PIN_CONFIRM_MS;
    if (!again) return { error: rec.synthetic ? PIN_WORDS.notOnScreen : PIN_WORDS.notFound, confirm: { session: rec.session_id, text, at } };
    verified = null; settled = true; approx = true;
  }
  const current = turn === sTurn;
  return {
    pin: {
      text, note: pinNote(note),
      anchor: {
        sessionId: rec.session_id, terminal: rec.terminal ?? null, turn,
        uuid: verified === "turn" && current && !working ? rec.last_assistant_uuid ?? null : null,
        promptId: current ? rec.prompt_id ?? null : null,
        hash: typeof hash === "function" ? hash(text) ?? null : null,
        quoteSource: source, verified, settled, approx,
      },
      createdTurn: sTurn, createdAt: at,
    },
  };
}

// The box in pins mode (3.4): the pins the panel handed over ([{id, label}]), valid ids only, each once,
// at most LIMITS.pinsPerQuestion; `then` is "trunk", "branch" or null.
export function boxPins(p) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(p?.pins) ? p.pins : []) {
    const id = typeof x === "string" ? x : x?.id;
    if (typeof id !== "string" || !/^pn_[A-Za-z0-9-]{8,64}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: squash(typeof x === "object" ? x?.label : "") || id });
    if (out.length >= pinLimit("pinsPerQuestion")) break;
  }
  return out;
}
export const boxThen = (p) => (p?.then === "trunk" || p?.then === "branch" ? p.then : null);

// Under the input in pins mode: four labels at most, then "+N more".
export function pinLabels(pins, max = 4) {
  const ls = (pins ?? []).map((x) => x.label);
  return ls.length > max ? [...ls.slice(0, max), `+${ls.length - max} more`] : ls;
}

// The box in pins mode: the session the question parks in, never another one. The panel's session
// (props.session) as its map record when the box has one; else as the store keeps it (it ended, its
// terminal runs a new session after /clear, or the panel held it or reached it from search), built from
// that record with no terminal: an event that named a terminal would map it to this session again.
// Neither: refused, so the question and its pins never park in whatever session comes first.
//   session  props.session      records  the box's map records (capture.js targets())
//   stored   store.json's record of that session, or null
// Out: { at } (its index in records), { add } (a record to put first), or { error }.
export function pinsTarget({ session, records, stored } = {}) {
  if (typeof session !== "string" || !session) return { error: PIN_WORDS.noSession };
  const at = (Array.isArray(records) ? records : []).findIndex((r) => r?.session_id === session);
  if (at >= 0) return { at };
  if (!stored || typeof stored !== "object" || stored.sessionId !== session) return { error: PIN_WORDS.sessionGone };
  return {
    add: { session_id: session, terminal: null, agent: stored.agent ?? null, session_name: stored.sessionName ?? null,
      cwd: stored.cwd ?? null, repo: stored.repo ?? null, profile: stored.profile ?? null, turn: num(stored.turn, 0),
      state: "idle", stored: true },
  };
}

// `then: "trunk"` (Ask here… on a pin) pastes into the session's pane once the question is parked: refused
// when the target has no live pane (its terminal gone, or a record built from the store). A branch needs
// none (the fork starts in a pane of its own), nor does a question parked to ask later (then null).
// live(t): the terminal is live (nav.js isLive). Out: the status line, or null.
export function pinsThenRefusal(rec, then, live = () => false) {
  if (then !== "trunk" || !rec) return null;
  return rec.terminal && !rec.stored && live(rec.terminal) ? null : PIN_WORDS.noPane;
}

// How long the panel's `then` (the box parked a question with pins and a then) waits for the question.
export const THEN_MS = 15000;
// The panel's `then` request from the box's message (shared("ledgr.focus") {item, pins, then, at}), timed
// by the message's own `at`: a panel copy that notices it late (hidden when the box wrote it) finds it
// stale instead of acting on it then. Null when the message asks for nothing.
export function thenRequest(f) {
  if (!f || typeof f.item !== "string" || !f.item || (f.then !== "trunk" && f.then !== "branch")) return null;
  return { item: f.item, then: f.then, pins: num(f.pins, 0), at: num(f.at, 0) };
}
export const thenStale = (r, now = Date.now()) => !r || !(num(now, 0) - num(r.at, 0) <= THEN_MS);
