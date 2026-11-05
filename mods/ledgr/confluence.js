// ledgr confluence (Phase 3): the one message a concluded branch returns to the end of its trunk,
// the answer sheet's message, the "ask the branch for a conclusion" prompt, and the line the writer
// appends to ledgr-data/sessions/<trunk sid>/decisions.md. Pure: no files, no UI, no Herdr calls,
// so store.js, writer.js and panel.js share one definition.
//
// Both messages start with a machine-detectable first line. The Claude UserPromptSubmit hook
// (bin/lib/ledgr_landing.py, called from bin/adapters/claude/claude_hook.py) parses them when the
// person submits the pasted text, and emits `confluence_landed` / `answers_landed`; the writer then
// resolves the question or marks the asks answered. Nothing here types into a terminal: the panel
// puts the text on the clipboard and focuses the pane.
//   ledgr confluence <branch id> <item id>
//   ledgr answers <session id>
// The Python parser and these composers must agree (tests/test-store.sh checks one against the other).
//
// SOURCE OF TRUTH: mods/ledgr/confluence.js. mods/my-tabs/ledgr/confluence.js is a byte-identical copy
// (Herdr refuses imports from outside a mod's folder).

export const CONFLUENCE_MARK = "ledgr confluence";
export const ANSWERS_MARK = "ledgr answers";
const BLOCK = /```ledgr-conclusion[^\n]*\n([\s\S]*?)```/;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// The body of the last fenced ledgr-conclusion block in a message, or null.
export function extractConclusion(text) {
  let last = null, m;
  const re = new RegExp(BLOCK.source, "g");
  while ((m = re.exec(String(text ?? ""))) !== null) last = m[1];
  const t = last === null ? "" : last.trim();
  return t ? t : null;
}

// The first meaningful line of a conclusion, for the decisions file ("answer: " label dropped).
export function conclusionHead(text, max = 200) {
  const line = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("```")) ?? "";
  return clip(squash(line.replace(/^answer\s*:\s*/i, "")), max);
}

// The fork turn the branch saw the trunk up to.
export const forkTurnOf = (br) => num(br?.forkTurn ?? br?.manifest?.forkTurn ?? br?.forkTurnObserved, 0);

export function questionText(item) {
  const q = squash(item?.text);
  if (q) return q;
  const quote = squash(item?.anchor?.quote);
  return quote ? `(bookmark) “${clip(quote, 160)}”` : "(no text)";
}

// The confluence message (under 200 words plus the conclusion): marker line, the question and the
// turn it was parked at, "Conclusion:" and the person's edited text, and one closing line in the
// person's voice: Claude Code presents a paste as text that may hold instructions the person did not
// write, so the line asserts what the person is doing rather than instructing the model. No transcript
// and no tool output.
export function confluenceMessage({ branch, item, text }) {
  const h = item?.handle ?? "the question";
  const A = num(item?.anchor?.turn ?? branch?.anchorTurn, 0);
  const F = forkTurnOf(branch);
  return [
    `${CONFLUENCE_MARK} ${branch.id} ${item.id}`,
    `Parked question ${h}, from turn ${A}: ${clip(questionText(item), 240)}`,
    "Conclusion:",
    String(text ?? "").trim(),
    `I am adopting this branch's conclusion as the answer to ${h}; the branch (${branch.name ?? branch.id}, a fork of this conversation) saw the trunk through turn ${F}.`,
  ].join("\n");
}

// The one-line lead-in the panel suggests the person type before pasting, so the pasted message
// arrives under words the person wrote (the hook finds the marker as the paste's first line).
export const leadIn = (item) => `Adopt this branch result for ${item?.handle ?? "the question"}:`;

// Words in the message outside the conclusion (the "under 200 words" rule).
export function wrapperWords(message, text) {
  const body = String(message ?? "").replace(String(text ?? "").trim(), "");
  return body.split(/\s+/).filter(Boolean).length;
}

// The answer sheet (spec 6.4), keyed by handle in ask order: marker, one line for the model, then
// "A5: <answer>" lines. Asks without a typed answer are left out.
export function answersSheet(sessionId, turn, items) {
  const lines = (items ?? []).filter((it) => squash(it.draft)).map((it) => `${it.handle}: ${squash(it.draft)}`);
  if (!lines.length) return "";
  return [`${ANSWERS_MARK} ${sessionId}`, `Answers to your asks from turn ${turn}:`, ...lines].join("\n");
}

// What "Ask for a conclusion" stages for the branch: no [Q1]-style refs (a ref in a prompt marks items).
export function conclusionRequest(item) {
  return [
    `Please conclude on ${item?.handle ?? "the question"} now. End your reply with the fenced block tagged ledgr-conclusion, for example:`,
    "```ledgr-conclusion",
    "answer: one or two sentences",
    "changes: facts or decisions the main thread should update, one per line, or none",
    "```",
  ].join("\n");
}

const pad = (n) => String(n).padStart(2, "0");
export function stamp(ms) {
  const d = new Date(num(ms, Date.now()));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// decisions.md: a header once, then one line per confluence that reached the trunk.
export function decisionsHeader(session) {
  const name = session?.sessionName || session?.repo || String(session?.sessionId ?? "").slice(0, 8);
  return `# ledgr decisions · ${name} (${session?.sessionId ?? "?"})\n\nOne line per branch conclusion that reached this session. Written by the ledgr writer.\n\n`;
}

export function decisionLine({ at, turn, item, branch, head }) {
  return `- ${stamp(at)} · turn ${turn} · ${item?.handle ?? "?"} “${clip(questionText(item), 120)}” → ${head || "(no conclusion text)"} · branch ${branch?.name ?? "?"} (${branch?.id ?? "?"})`;
}
