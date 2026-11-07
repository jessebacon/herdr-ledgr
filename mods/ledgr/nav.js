// ledgr navigation (spec 6.6): the passage comes to the panel first (the row opens on its whole
// message); then the agent's pane is focused and a distinctive slice of the quote goes on the
// clipboard, with a note saying how to search for it.
// ledgr never sends keystrokes to a terminal: no `hc keys`, no `hc send` (it presses Enter), and it
// opens no find bar. Until 2026-11-06 Go to anchor pressed `ctrl+o /` in an idle Claude pane.
// Removed: ctrl+o toggles Claude Code's transcript viewer, so what those keys did depended on a
// screen state the mod cannot see (bin/tests/test_no_keystrokes.py guards this).
// Staging: Go to anchor, Copy for prompt, /btw and Ask for a conclusion are clipboard plus
// `pane.focus` (stageText); the person pastes. The answer sheet, Copy answer and the confluence go
// one step further (2026-11-06, Jesse): stageIntoPrompt also runs Herdr's `terminal.paste` (the
// command ⌘V is bound to: the clipboard into the focused terminal, no Enter, no key names), and only
// after Herdr reports the target terminal focused. It never presses Enter: the person reads what
// landed, adds a word of their own and sends it (ui.pasteIntoPrompt false: clipboard plus focus).
import { run, agents, terminals, focused } from "herdr";

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

// How long stageIntoPrompt waits for Herdr to report the target focused, how often it looks, and
// how many looks in a row must agree before it pastes (two: never in the click's own tick, and not
// on a focus that is still moving).
export const PASTE = { waitMs: 600, stepMs: 50, settle: 2 };

// Whether keyboard input now goes to terminal t: Herdr's actual focus is t, and no other terminal
// is shown in its place (terminal.show).
export function focusedOn(t) {
  const f = focused();
  return Boolean(t && f && f.terminal === t && (!f.shown || f.shown === t));
}

// Why stageIntoPrompt will not paste into terminal t (null: it may). "off": ui.pasteIntoPrompt is
// false; "gone": not live; "plain": no agent runs there (a shell may run what a paste holds);
// "blocked": the agent waits on its own prompt (a permission menu, not the input box).
export function pasteBlock(t, paste = true) {
  if (!t || !isLive(t)) return "gone";
  if (!paste) return "off";
  const a = agentOf(t);
  if (!a) return "plain";
  return a.status === "blocked" ? "blocked" : null;
}

// A message staged for a prompt (the answer sheet, one answer, a confluence) ends with one empty line,
// so a second paste into the same prompt starts after a blank line instead of running into the first
// (Jesse, 2026-11-07). Only the end changes: trailing line breaks become exactly "\n\n"; the first
// line (the marker the hooks look for) and everything else stay as composed.
export function promptText(text) {
  return `${String(text ?? "").replace(/[\r\n]+$/, "")}\n\n`;
}

// The one-click paste. Must be called from an event handler (the clipboard is written with that
// call's cx). In order: the text on the clipboard; the target's pane focused; then, if pasteBlock
// allows it, a task looks at Herdr's focus every PASTE.stepMs, and once the target has been the
// focused terminal PASTE.settle looks in a row (and the clipboard still holds this text) runs
// `terminal.paste` once. No Enter, no key names, no other terminal: if the focus is not confirmed
// within PASTE.waitMs nothing is pasted and the text stays on the clipboard (today's ⌘V by hand).
// Returns "pasting" (the task decides) or the pasteBlock reason; `done(result, cx)` gets
// {pasted: true, ms} or {pasted: false, why} ("off", "gone", "plain", "blocked", "focus",
// "clipboard", "error"), synchronously for a reason known at once. The clipboard gets
// promptText(text): the message plus one empty line, pasted or not.
export function stageIntoPrompt(text, terminal, cx, { paste = true, done } = {}) {
  const msg = promptText(text);
  cx.write_to_clipboard(msg);
  const why = pasteBlock(terminal, paste);
  if (why !== "gone") run("pane.focus", { terminal });
  if (why) { done?.({ pasted: false, why }, cx); return why; }
  // CRLF and LF are one; so is a clipboard that lost or gained trailing line breaks.
  const norm = (a) => String(a ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  const same = (a) => norm(a) === norm(msg);
  cx.spawn(async (cx) => {
    let seen = 0, r = { pasted: false, why: "focus" };
    try {
      for (let ms = PASTE.stepMs; ms <= PASTE.waitMs; ms += PASTE.stepMs) {
        await cx.sleep(PASTE.stepMs);
        seen = focusedOn(terminal) ? seen + 1 : 0;
        if (seen < PASTE.settle) continue;
        if (!same(cx.read_from_clipboard())) { r = { pasted: false, why: "clipboard" }; break; }
        run("terminal.paste");
        r = { pasted: true, ms };
        break;
      }
    } catch (e) {
      r = { pasted: false, why: "error", error: String(e?.message ?? e) };
    }
    done?.(r, cx);
  });
  return "pasting";
}

// The answer sheet's one message (spec 6.4) moved to confluence.js (answersSheet) in Phase 3: it now
// starts with the marker line "ledgr answers <session id>" the UserPromptSubmit hook detects.

// "/btw About "<first 120 of quote>": <question>" (spec 5.5).
export function btwText(question, quote) {
  const q = String(question ?? "").trim();
  const head = String(quote ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return head ? `/btw About "${head}": ${q}` : `/btw ${q}`;
}
