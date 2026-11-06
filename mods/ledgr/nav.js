// ledgr navigation (spec 6.6): the passage comes to the panel first; then the agent's pane
// is focused; then, for an idle agent, a slice of the quote goes on the clipboard and the
// agent's own search is opened (Claude fullscreen transcript search via `hc keys <t> ctrl+o /`,
// else Herdr's find bar). Nothing is ever typed into an agent: text goes to the clipboard and
// the person pastes. `hc send` is never used (it presses Enter).
import { run, hc, agents, terminals } from "herdr";

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

// Focus the agent's pane (if live), stage the search. Must be called from an event handler:
// the clipboard is written with that call's cx before anything is awaited.
// Returns a one-line note for the panel's status line.
export function goToAnchor(item, session, cx) {
  const t = session?.terminal ?? item?.terminal ?? null;
  if (!t || !isLive(t)) return "Agent terminal is not live: the passage is shown here.";
  run("pane.focus", { terminal: t });
  if (busy(t)) return "Agent is busy: pane focused, search not opened.";
  const slice = searchSlice(item?.anchor?.quote);
  if (!slice) return "Pane focused. No quote saved for this item, so no search.";
  cx.write_to_clipboard(slice);
  const app = agentOf(t)?.app ?? session?.agent ?? null;
  if (app === "claude-code" || app === "claude") {
    cx.spawn(async () => { await hc(["keys", t, "ctrl+o", "/"]).catch(() => null); });
    return `Claude transcript search opened in pane ${t}: ⌘V, Enter (q to return). Copied: “${slice}”`;
  }
  run("terminal.search");
  return `Find bar opened in pane ${t}: ⌘V to search. Copied: “${slice}”`;
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
