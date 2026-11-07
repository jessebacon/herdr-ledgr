// ledgr identifiers as a person reads them. "A9" read as "asks-9" and "t3" as "turn 3", so
// everything the panel and the capture box show uses words: "Ask 9", "Question 1", "pane t3", "branch
// of Question 1". The short forms stay in every machine format, unchanged: the answer sheet's
// "A9: ..." lines, the confluence and answer markers, `[A9]` / `[Q1]` refs in a prompt, the lead-ins
// the person types, store keys and hc names (br-q1-c51e). Pure; not an engine file (the writer
// never shows text).

// "A9" -> "Ask 9", "Q1" -> "Question 1"; anything else as it is.
export function handleWords(handle) {
  const m = /^([AQ])(\d+)$/.exec(String(handle ?? ""));
  if (!m) return handle ? String(handle) : "?";
  return `${m[1] === "A" ? "Ask" : "Question"} ${m[2]}`;
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
export const spaceToggleWords = (off, here = true) => `ledgr ${off ? "on" : "off"} in ${here ? "this space" : "that space"}`;

// A branch by what it is for: "branch of Question 1". Its hc name (br-q1-c51e) is the short id
// shown beside it, small.
export const branchWords = (item) => `branch of ${item ? itemWords(item) : "a question"}`;

// A session by its name; the id prefix only when it has none.
export const sessionWords = (s) => s?.sessionName || s?.repo || (s?.sessionId ? `session ${String(s.sessionId).slice(0, 8)}` : "no session");

// The three actions that stage a message for a prompt (the answer sheet, one answer, the
// confluence), by ui.pasteIntoPrompt: "Paste …" when on (nav.js stageIntoPrompt pastes it, never
// sends it), the older "Copy …" / "Send to trunk" when off (clipboard plus focus).
export function stageLabels(paste) {
  const n_ = (n) => `${n} answer${n === 1 ? "" : "s"}`;
  return paste
    ? { sheet: (n, t) => `Paste ${n_(n)}${t ? ` into ${paneWords(t)}` : ""}`, one: "Paste answer", send: "Paste into trunk",
        again: "Paste confluence again", againMenu: "Paste the confluence again", how: "pasted into the prompt, never sent" }
    : { sheet: (n, t) => `Copy ${n_(n)}${t ? ` for ${paneWords(t)}` : ""}`, one: "Copy answer", send: "Send to trunk",
        again: "Copy confluence again", againMenu: "Copy the confluence again", how: "clipboard + focus the pane; nothing is typed" };
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
