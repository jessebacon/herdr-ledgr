// ledgr navigation (spec 6.6): the passage comes to the panel first (the row opens on its whole
// message); then the agent's pane is focused and a distinctive slice of the quote goes on the
// clipboard, with a note saying how to search for it.
// ledgr never sends keystrokes to a terminal: no `hc keys`, no `hc send` (it presses Enter), and it
// opens no find bar. Every staging (answers, /btw, a confluence, a search slice) is clipboard plus
// `pane.focus`; the person types and pastes. Until 2026-11-06 Go to anchor pressed `ctrl+o /` in an
// idle Claude pane. Removed: ctrl+o toggles Claude Code's transcript viewer, so what those keys did
// depended on a screen state the mod cannot see (bin/tests/test_no_keystrokes.py guards this).
import { run, agents, terminals } from "herdr";

export function agentOf(t) {
  return t ? agents().find((a) => a.address === t) ?? null : null;
}

export function isLive(t) {
  if (!t) return false;
  if (agentOf(t)) return true;
  return terminals().some((x) => x.address === t && (x.state === undefined || x.state === "live"));
}

export function busy(t) {
  const st = agentOf(t)?.status;
  return st === "working" || st === "blocked";
}

// A distinctive 20-40 character slice of the quote, cut at word boundaries.
export function searchSlice(quote) {
  const s = String(quote ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= 40) return s.length >= 3 ? s : "";
  const words = s.split(" ");
  // The longest word run starting near the middle that fits in 40 characters.
  let best = "";
  for (let i = 0; i < words.length; i++) {
    let run = "";
    for (let j = i; j < words.length; j++) {
      const next = run ? `${run} ${words[j]}` : words[j];
      if (next.length > 40) break;
      run = next;
    }
    if (run.length > best.length) best = run;
    if (best.length >= 34) break;
  }
  return best.length >= 20 ? best : s.slice(0, 40);
}

const isClaude = (app) => app === "claude-code" || app === "claude";

// Go to anchor: the search slice on the clipboard, then the agent's pane focused (if live). Nothing
// is sent to the terminal. Must be called from an event handler: the clipboard is written with that
// call's cx. Returns a one-line note for the panel's status line saying what to do next.
export function goToAnchor(item, session, cx) {
  const t = session?.terminal ?? item?.terminal ?? null;
  if (!t || !isLive(t)) return "Agent terminal is not live: the passage is shown here.";
  const slice = searchSlice(item?.anchor?.quote);
  if (slice) cx.write_to_clipboard(slice);
  run("pane.focus", { terminal: t });
  if (!slice) return `Pane ${t} focused. No quote saved for this item: the passage is shown here.`;
  const app = agentOf(t)?.app ?? session?.agent ?? null;
  const how = isClaude(app)
    ? "in Claude press ctrl+o (transcript), then /, ⌘V, Enter; q goes back to the prompt"
    : "paste it into the agent's own search, or Herdr's terminal search (command palette)";
  const wait = busy(t) ? " The agent is working: search once it is idle." : "";
  return `Passage shown here; pane ${t} focused and “${slice}” copied. To find it there, ${how}.${wait}`;
}

// Clipboard + focus, never typed (spec 5.5, 6.4 and the build brief).
export function stageText(text, terminal, cx) {
  cx.write_to_clipboard(text);
  if (terminal && isLive(terminal)) run("pane.focus", { terminal });
}

// The answer sheet's one message (spec 6.4) moved to confluence.js (answersSheet) in Phase 3: it now
// starts with the marker line "ledgr answers <session id>" the UserPromptSubmit hook detects.

// "/btw About "<first 120 of quote>": <question>" (spec 5.5).
export function btwText(question, quote) {
  const q = String(question ?? "").trim();
  const head = String(quote ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return head ? `/btw About "${head}": ${q}` : `/btw ${q}`;
}
