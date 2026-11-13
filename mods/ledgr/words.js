// ledgr identifiers as a person reads them. "A9" read as "asks-9" and "t3" as "turn 3", so
// everything the panel and the capture box show uses words: "Ask 9", "Question 1", "Pin 4", "pane t3",
// "branch of Question 1". The short forms stay in every machine format, unchanged: the answer sheet's
// "A9: ..." lines, the confluence and answer markers, `[A9]` / `[Q1]` refs in a prompt, the lead-ins
// the person types, store keys and hc names (br-q1-c51e). Pure; not an engine file (the writer
// never shows text).

// "A9" -> "Ask 9", "Q1" -> "Question 1", "P4" -> "Pin 4"; anything else as it is.
export function handleWords(handle) {
  const m = /^([AQP])(\d+)$/.exec(String(handle ?? ""));
  if (!m) return handle ? String(handle) : "?";
  return `${{ A: "Ask", Q: "Question", P: "Pin" }[m[1]]} ${m[2]}`;
}

export const itemWords = (it) => handleWords(it?.handle);

// A Herdr terminal address as a secondary word: "pane t3" (never a bare "t3").
export const paneWords = (t, none = "its pane") => (t ? `pane ${t}` : none);

// The trunk, with its pane when known: "the trunk (pane t3)".
export const trunkWords = (t) => (t ? `the trunk (pane ${t})` : "the trunk");

// Where an item came from.
export function originWords(origin) {
  return {
    extract_model: "found by the extractor",
    extract_block: "declared by the agent",
    tool: "declared by the agent (tool)",
    capture: "parked by you",
    btw: "parked by you (/btw)",
  }[origin] ?? (origin ? String(origin).replace(/_/g, " ") : "");
}

// Who closed an item (its `resolvedBy`), for the Closed list: "resolved by its branch" (the panel adds
// the branch's name), "closed by the agent" (resolve_asks), "answered by you" (the answer took: the
// agent's next reply did not raise it again). None (the person's Done) has no words.
export function resolvedByWords(by) {
  return { branch: "resolved by its branch", agent: "closed by the agent", answer: "answered by you" }[by] ?? null;
}

// Why a dismissed item was closed, when it was not the person's own Not needed: "cleared" (the
// questions lane's Clear N, store.js on_clear_questions). None for Not needed.
export function dismissedByWords(by) {
  return { clear: "cleared" }[by] ?? null;
}

// The questions lane's Clear button (two clicks): "Clear 3"; armed, "Clear 3 questions? 1 branched
// kept"; after, "3 questions cleared, 1 branched kept". The kept part only when something is kept.
const qs = (n) => `${n} question${n === 1 ? "" : "s"}`;
export const clearLabel = (n) => `Clear ${n}`;
export const clearConfirm = (n, kept = 0) => `Clear ${qs(n)}?${kept ? ` ${kept} branched kept` : ""}`;
export const clearedWords = (n, kept = 0) => `${qs(n)} cleared${kept ? `, ${kept} branched kept` : ""}`;

// ledgr off in a space (config.json spaces.disabled): the session menu's toggle for the focused pane's
// space, and the state the panel and the capture box show there.
export const OFF_HERE = "ledgr is off in this space";

// The writer's health on the panel's status line, from its claim (writer.js claim: `fault` while
// store.json cannot be written, `failed` = the events it moved to ledgr-data/spool/failed because
// their apply threw).
export const failedEventsWords = (n) => `${n} event${n === 1 ? "" : "s"} failed, see spool/failed`;
export function writerHealthWords(w) {
  if (!w || typeof w !== "object") return null;
  const out = [];
  if (w.fault) out.push(`ledgr writer: ${String(w.fault).slice(0, 200)}; new events wait in the spool`);
  const n = Math.max(0, Math.floor(Number(w.failed) || 0));
  if (n) out.push(failedEventsWords(n));
  return out.length ? out.join(" · ") : null;
}
export const spaceToggleWords = (off, here = true) => `ledgr ${off ? "on" : "off"} in ${here ? "this space" : "that space"}`;

// A branch by what it is for: "branch of Question 1". Its hc name (br-q1-c51e) is the short id
// shown beside it, small.
export const branchWords = (item) => `branch of ${item ? itemWords(item) : "a question"}`;

// A session by its name; the id prefix only when it has none.
export const sessionWords = (s) => s?.sessionName || s?.repo || (s?.sessionId ? `session ${String(s.sessionId).slice(0, 8)}` : "no session");

// The three actions that stage a message for a prompt (the answer sheet, one answer, the
// confluence), by ui.pasteIntoPrompt: "Paste …" when on (nav.js stageIntoPrompt pastes it, never
// sends it), the older "Copy …" / "Send to trunk" when off (clipboard plus focus). `quick`: the list
// row's own button for an answer that is ready (docs/design/Detail.md 1.4).
export function stageLabels(paste) {
  const n_ = (n) => `${n} answer${n === 1 ? "" : "s"}`;
  return paste
    ? { sheet: (n, t) => `Paste ${n_(n)}${t ? ` into ${paneWords(t)}` : ""}`, one: "Paste answer", send: "Paste into trunk",
        again: "Paste confluence again", againMenu: "Paste the confluence again", how: "pasted into the prompt, never sent", ask: "Ask here", quick: "Paste" }
    : { sheet: (n, t) => `Copy ${n_(n)}${t ? ` for ${paneWords(t)}` : ""}`, one: "Copy answer", send: "Send to trunk",
        again: "Copy confluence again", againMenu: "Copy the confluence again", how: "clipboard + focus the pane; nothing is typed", ask: "Copy to ask here", quick: "Copy" };
}

// ── pins (docs/design/Pins.md 4.7) ──────────────────────────────────────
export const pinsWords = (n) => `${n} pin${n === 1 ? "" : "s"}`;
export const PINS_EMPTY = "No pins in this session. Select a passage in the agent's pane, ⌘J, then ⌘S.";
export const pinsSearchEmpty = (q, n) => `No pin matches “${q}” in ${n} session${n === 1 ? "" : "s"}.`;
export const pinsSelectedWords = (n) => `${n} selected`;
export const askAboutPinsWords = (n) => (n === 1 ? "Ask about this pin…" : `Ask about these ${n} pins…`);

// A pin's passage as one short line: whitespace collapsed, cut at n characters with "…".
export function pinHead(text, n = 40) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

// Where a pin came from, seen from the shown session `here` (its id): "this session", else that
// session's name (from the pin's own `source`, so a forgotten session still has one).
export const pinSourceWords = (pin, here) => (pin?.sessionId && pin.sessionId === here ? "this session" : sessionWords({ ...(pin?.source ?? {}), sessionId: pin?.sessionId }));

// How long ago: "just now", "5 min ago", "3 hours ago", "3 days ago", then the date.
export function agoWords(ms, now = Date.now()) {
  const d = Math.max(0, Number(now) - Number(ms));
  if (!Number.isFinite(d)) return "";
  const n = (v, w) => `${v} ${w}${v === 1 ? "" : "s"} ago`;
  if (d < 60e3) return "just now";
  if (d < 3600e3) return `${Math.floor(d / 60e3)} min ago`;
  if (d < 86400e3) return n(Math.floor(d / 3600e3), "hour");
  if (d < 30 * 86400e3) return n(Math.floor(d / 86400e3), "day");
  const t = new Date(Number(ms));
  return `on ${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

// A pin's anchor as a person reads it: "turn 12 · 3 days ago", "around turn 12 · …" (approx: the
// session's turn when it was taken, not the turn the passage was found in).
export const pinAnchorWords = (pin, now = Date.now()) =>
  `${pin?.anchor?.approx ? "around turn" : "turn"} ${pin?.anchor?.turn ?? "?"} · ${agoWords(pin?.createdAt, now)}`;

// "Pin 4", or "Pin 2 of billing-api" for a pin of another session than `here`.
export const pinNameWords = (pin, here) => `${handleWords(pin?.handle)}${pin?.sessionId === here ? "" : ` of ${pinSourceWords(pin, here)}`}`;

// The box's label for a pin (the panel composes it; the box has no pin words): "Pin 4 · “The gateway
// retries each…”", "Pin 2 of billing-api · “…”".
export const pinLabel = (pin, here) => `${pinNameWords(pin, here)} · “${pinHead(pin?.text, 40)}”`;

// A pin's usage line: per question that used it, the furthest it got ("used in Question 3", "sent in
// Question 3 at turn 14", "answered in Question 3 (turn 14)", "answered in Question 5 (branch
// br-q5-1a2b, turn 16)"), newest first, two at most, then "+N more". A question of another session
// than the pin's adds that session's name. `store` (optional) tells whether a question was sent.
export function pinUseWords(pin, store = null) {
  const used = Array.isArray(pin?.usedIn) ? pin.usedIn : [], answered = Array.isArray(pin?.answeredIn) ? pin.answeredIn : [];
  const of = (sid) => {
    if (!sid || sid === pin.sessionId) return "";
    const s = store?.d?.sessions?.[sid];
    return s ? ` of ${sessionWords(s)}` : "";
  };
  const qs = new Map();
  for (const u of used) if (u?.question && !qs.has(u.question)) qs.set(u.question, { handle: u.handle, session: u.session, at: Number(u.at) || 0 });
  for (const a of answered) if (a?.question && !qs.has(a.question)) qs.set(a.question, { handle: a.handle, session: a.session, at: Number(a.at) || 0 });
  const lines = [...qs].map(([id, q]) => {
    const name = `${handleWords(q.handle)}${of(q.session)}`;
    const a = answered.filter((x) => x?.question === id).sort((x, y) => (Number(y.at) || 0) - (Number(x.at) || 0))[0];
    if (a) return { at: Number(a.at) || q.at, w: a.via === "branch" ? `answered in ${name} (branch ${a.branchName ?? "?"}, turn ${a.turn ?? "?"})` : `answered in ${name} (turn ${a.turn ?? "?"})` };
    const it = typeof store?.item === "function" ? store.item(id) : null;
    if (it?.pinsAsked) return { at: Number(it.pinsAsked.at) || q.at, w: `sent in ${name} at turn ${it.pinsAsked.turn}` };
    return { at: q.at, w: `used in ${name}` };
  }).sort((x, y) => y.at - x.at);
  if (!lines.length) return null;
  return [...lines.slice(0, 2).map((l) => l.w), ...(lines.length > 2 ? [`+${lines.length - 2} more`] : [])].join(" · ");
}

// What a staging did and what is left to the person, from stageIntoPrompt's result r ({pasted} or
// {pasted: false, why}). what: "Answer for Ask 2"; where: "pane t3" or "the trunk (pane t3)"; lead:
// the lead-in suggestion (confluence.js leadIn, answersLeadIn); word: the target's live word
// (working, blocked, gone, idle...). A paste is never sent: the person adds a word and presses Enter.
export function stagedWords(r, { what, where, lead, word }) {
  const typeLead = `type “${lead}”, then ⌘V, Enter`;
  if (r?.pasted) {
    const wait = word === "working" ? " (working: press Enter once it is idle; a prompt sent now joins the running turn)" : "";
    return `${what} pasted into the prompt in ${where}, not sent${wait}: add a word of your own, such as “${lead}”, then press Enter.`;
  }
  switch (r?.why) {
    case "gone": return `${what} copied; ${where} is not live: when it is back, ${typeLead}.`;
    case "plain": return `${what} copied and ${where} focused, not pasted (no agent runs there): ${typeLead}.`;
    case "blocked": return `${what} copied and ${where} focused, not pasted (it waits on its own prompt): answer that first, then type “${lead}”, ⌘V, Enter.`;
    case "focus": return `${what} copied; nothing was pasted (the focus did not reach ${where} in time): paste with ⌘V in the pane, add a word of your own such as “${lead}”, then Enter.`;
    case "clipboard": return `${what} not pasted: the clipboard changed before the paste. Click again to stage it.`;
    case "error": return `${what} copied; nothing was pasted (${String(r.error ?? "error").slice(0, 120)}): paste with ⌘V in ${where}, add a word of your own such as “${lead}”, then Enter.`;
    default: return `${what} copied and ${where} focused${word === "working" ? " (working: wait for idle)" : ""}: ${typeLead}.`;
  }
}

// ── the detail dialog (docs/design/Detail.md 2) ─────────────────────────
// The dialog's item is no longer in the store (its session forgotten, the pin deleted, the item archived
// away by the daily housekeeping): the body says so and offers only Close.
export const DETAIL_GONE = "This is no longer in the ledger: its session was forgotten, or it was deleted or archived away.";

// The anchor turn's text was never saved, or is gone (the dialog's message column).
export const messageGone = (turn) => `Passage not saved for turn ${turn ?? "?"} (ledgr-data/turns/…/${turn ?? "?"}.md).`;
export const PIN_MESSAGE_GONE = "That message is no longer saved; the pin keeps the passage.";

// A Copy button in the dialog (the text, the quote, the message, a passage): what went to the clipboard,
// and that nothing was pasted. what: "The passage", "The quote", "The message"...
export const copiedWords = (what, n) => `${what} copied (${n} character${n === 1 ? "" : "s"}); nothing was pasted.`;

// The dialog closed (Esc, a click outside) while its paste waited for the focus: closing cancels the
// paste, but the message is on the clipboard and its pane was focused (it may also have landed in the
// last moment, hence "if it is not in the prompt"). staged: Reader `staged` ({what, where, lead}).
export const pasteCutWords = ({ what, where, lead } = {}) =>
  `${what || "The message"} is on the clipboard and ${where || "its pane"} is focused; the dialog closed before the paste was confirmed. If it is not in the prompt there, paste with ⌘V, add a word of your own${lead ? ` such as “${lead}”` : ""}, then Enter.`;

// A link clicked in the dialog's message or an ask's text (2026-11-10; detail.js openLink): what the status
// line says. shown: the path as a person reads it (links.js shownPath: ~/…, :line); tried: the places looked.
const clipUrl = (u) => { const s = String(u ?? ""); return s.length > 120 ? `${s.slice(0, 119)}…` : s; };
export const LINK_WORDS = {
  web: (url) => `Opened ${clipUrl(url)} in the browser.`,
  webFailed: (url, why) => `${clipUrl(url)} did not open in the browser: ${why}.`,
  refused: (url) => `Not opened: only web links (http, https) and file paths open from here (${clipUrl(url)}).`,
  noFolder: (p) => `${p}: no folder is recorded for this session to look in; a path from / or ~ opens anyway.`,
  looking: (p) => `Looking for ${p}…`,
  missing: (p, tried) => (tried?.length ? `No file or folder ${p}: looked for ${tried.join(", ")}.` : `No file or folder ${p}.`),
  opened: (shown, how) => `Opened ${shown} with ${how}.`,
  failed: (shown, why) => `${shown} did not open: ${why}.`,
  revealed: (shown) => `Revealed ${shown} in Finder.`,
  copied: (abs) => `${abs} copied; nothing was pasted.`,
  demo: (p, tried, how) => `(demo) Would open ${p} with ${how}${tried?.length ? `, looking for ${tried.join(", ")}` : ""}; nothing is opened in the demo.`,
};

// A branch whose session has not finished a turn yet (its first one is running): the dialog's message column.
export const BRANCH_NO_TURN = "The branch has not finished a turn yet: its last message shows here once a turn ends.";

// The dialog's key hints, at the right of its footer: [key, what] pairs. Esc always; Tab when the dialog
// has a field; the answer box (a Textarea since 2026-11-11): ⌘Enter for the turn's answers, Enter a new
// line; the note: Enter saves it.
export function detailHints({ answer = false, note = false, conclude = false, paste = true } = {}) {
  const out = [["Esc", "close"]];
  if (answer || note || conclude) out.push(["Tab", "next field"]);
  if (answer) out.push(["⌘Enter", paste ? "paste the turn's answers" : "copy the turn's answers"], ["Enter", "newline"]);
  if (note) out.push(["Enter", "save the note"]);
  return out;
}

// Every use of a pin, newest first, one line each (the dialog's USED IN; pinUseWords is the row's two
// line summary): {question, session, handle, at, words}, where words is the furthest that question got
// ("used in Question 3", "sent in Question 3 at turn 14", "answered in Question 3 (turn 14)", "answered
// in Question 5 (branch br-q5-1a2b, turn 16)"), a question of another session than the pin's naming that
// session. `store` (optional) tells whether a question was sent and names the other sessions.
export function pinUseLines(pin, store = null) {
  const used = Array.isArray(pin?.usedIn) ? pin.usedIn : [], answered = Array.isArray(pin?.answeredIn) ? pin.answeredIn : [];
  const of = (sid) => {
    if (!sid || sid === pin.sessionId) return "";
    const s = store?.d?.sessions?.[sid];
    return s ? ` of ${sessionWords(s)}` : "";
  };
  const qs = new Map();
  for (const u of used) if (u?.question && !qs.has(u.question)) qs.set(u.question, { handle: u.handle, session: u.session, at: Number(u.at) || 0 });
  for (const a of answered) if (a?.question && !qs.has(a.question)) qs.set(a.question, { handle: a.handle, session: a.session, at: Number(a.at) || 0 });
  return [...qs].map(([id, q]) => {
    const name = `${handleWords(q.handle)}${of(q.session)}`;
    const line = { question: id, session: q.session ?? null, handle: q.handle ?? null };
    const a = answered.filter((x) => x?.question === id).sort((x, y) => (Number(y.at) || 0) - (Number(x.at) || 0))[0];
    if (a) return { ...line, at: Number(a.at) || q.at, words: a.via === "branch" ? `answered in ${name} (branch ${a.branchName ?? "?"}, turn ${a.turn ?? "?"})` : `answered in ${name} (turn ${a.turn ?? "?"})` };
    const it = typeof store?.item === "function" ? store.item(id) : null;
    if (it?.pinsAsked) return { ...line, at: Number(it.pinsAsked.at) || q.at, words: `sent in ${name} at turn ${it.pinsAsked.turn}` };
    return { ...line, at: q.at, words: `used in ${name}` };
  }).sort((x, y) => y.at - x.at);
}

// ── the settings dialog (settings.js, 2026-11-10) ───────────────────────
// The three thresholds, as the ASKED OF YOU head's menu and the settings dialog both name them.
export const THRESHOLD_WORDS = { blocking: "blocking only", needed: "blocking + needed", optional: "everything" };

// A text scale as a person reads it: 1.2 -> "120 %".
export const scaleWords = (s) => `${Math.round(Number(s) * 100)} %`;

// Each row of the dialog, in its order: [label, one line on what it does]. The keys are settings.js
// SETTINGS' keys.
export const SETTING_WORDS = {
  textScale: ["Text scale", "Every text ledgr draws, times this: the panel, its dialogs, the ⌘J box, the host button and the pane chip. Icons keep their size."],
  threshold: ["Threshold", "Which asks are open rows and count on the chip; the rest wait below the threshold, each one click from Promote."],
  handoff: ["Who owns the closing list", "ledgr: the agent declares blocking and needed items here and ends its reply with one pointer line; both: its reply lists them too; prose: no instruction, the extractor reads each reply. A running session gets the new wording at its next prompt."],
  pasteIntoPrompt: ["Paste into the prompt", "Paste answers, Paste answer and Paste into trunk put the message into the agent's prompt once its pane has the focus, never pressing Enter; off, they copy it and focus the pane, and you paste."],
  animations: ["Animations", "Rows fade in and out, highlights decay, the chip pulses once; off, nothing ledgr draws moves."],
  foldAsksWhileWorking: ["Fold asks while the agent works", "The ASKED OF YOU lane folds while the agent works and opens when its turn ends; off, only your clicks fold it."],
  openPanelOnAsks: ["Open the panel on new asks", "When a turn ends with new asks and the panel is hidden, show it."],
  maxDepth: ["Branch depth", "How deep branches of branches may go; 0 turns Branch off."],
  editor: ["Open files with", "A file path you click in the detail dialog's message opens here: open (the system's default app; a script opens as text, never run), zed or code at its line, or your own command with {path}, {line} and {col}. Web links open in the browser."],
  spaces: ["Off spaces", "Where ledgr does nothing: no chip, no ⌘J, no instruction or extraction for its agents. Their items are kept."],
};

// A config.json change the dialog wrote: "Text scale: 120 % (ui.textScale in ledgr-data/config.json)."
export const savedWords = (label, value, key) => `${label}: ${value} (${key} in ledgr-data/config.json).`;
// The closing list's mode changed: when the running sessions follow.
export const handoffSavedWords = (mode) => `Closing list: ${mode} (asks.handoff in ledgr-data/config.json). A running session gets the new wording at its next prompt.`;
// Open files with (links.editor): the custom command's field, and a command it refuses.
export const EDITOR_PLACEHOLDER = "your own: subl {path}:{line}:{col}";
export const EDITOR_CUSTOM_HINT = "Enter saves your own command; {path}, {line} and {col} are put in; quote an argument with spaces (\"/Apps/My Editor\"). Refused: a shell, an interpreter or a program that runs another (env, arch, sudo, python3.12), a terminal, open -a or -b with a launcher, shell or terminal.";
// why: links.js editorRefusal's words (which part of the command is refused), else the rules in short.
export const editorRefusedWords = (v, why = null) => `Open files with not saved: “${String(v ?? "").slice(0, 80)}”: ${why || "not a command ledgr runs (no shell, no interpreter, no terminal, no program that is the file itself, at most 300 characters)"}.`;
// An off space by id that Herdr no longer has (spaces.disabled keeps it until it is dropped).
export const staleSpaceWords = (id) => `${String(id ?? "").slice(0, 12)}… (no longer in Herdr)`;
export const droppedSpaceWords = (id) => `Dropped ${String(id ?? "").slice(0, 12)}… from spaces.disabled (ledgr-data/config.json).`;
// No spaces at all (Herdr reports none, as under herdr-app check).
export const NO_SPACES = "Herdr reports no spaces.";
// The footer: where the file is, and that the rest is edited there.
export const settingsFootWords = (path) => `${path}: edit anything else there; it applies within a second.`;
// In the demo nothing is written.
export const SETTINGS_DEMO = "(demo) Nothing here is saved; the dialog shows the defaults and two sample spaces.";
