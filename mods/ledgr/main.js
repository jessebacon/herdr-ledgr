// ledgr: a two-direction list of asks around one agent conversation (Herdr mod).
//   props { view: "panel" }            the panel block (by default a child of the right-hand
//                                      `panel-body` stack); reads store.json, and runs a fallback
//                                      writer only when no host answers (panel.js)
//   props { view: "host", bar? }       the always-shown host block: runs the writer that ingests
//                                      ledgr-data/spool, shows what is open, toggles the panel (host.js)
//   props { overlay } (mod.open:ledgr) the capture box, ⌘J (capture.js)
//   props { view: "capture", parent, session, terminal, prefill }
//                                      the capture box opened from an item ("Ask about this")
//   props { view: "capture", session, terminal, pins: [{id, label}], then }
//                                      the capture box in pins mode (the panel's Ask about these…,
//                                      Ask here…, Branch… on a pin; then: "trunk" | "branch" | null)
//   props { demo: true } / FORCE_DEMO  fixture data (fixtures.js)
// Commands (keys.json `mod:ledgr`, or `herdr-app do ledgr.<command>`; shown copies only):
//   host: toggle (show or hide the panel; keys.json binds it, ⌘⇧J by default);
//   btw (⌘Enter in the box), submit, escape; panel: demo, capture, rescan, expand-all,
//   branch (open the Branch confirmation on the newest open parked question), branch-split,
//   branch-agent (its placement), launch-branch (its Launch button), expand-branches, sessions
//   (the session menu); Phase 3: conclude (Conclude… on the newest branch that can), conclude-edit:<text>
//   (append a line to the open editor), send-to-trunk (Paste into trunk), ask-conclusion, copy-confluence
//   (Paste confluence again), close-branch (twice: the two clicks), copy-answers (Paste answers: the newest
//   turn with typed answers). The paste commands paste into the prompt only as the clicks do
//   (ui.pasteIntoPrompt, focus confirmed; never Enter).
//   For scripted looks: fold-mine, fold-asks (fold or unfold a lane), collapse-all (every open row, box and note),
//   hide-branch:<hc name> (demo only: drop that branch from the demo store);
//   pick:<handle>:<n> (click option n of an ask), copy-answer:<handle> (its Paste answer button),
//   go:<handle> (its ⋯ Go to anchor), session:<terminal|sid prefix> (show that session, as the session
//   menu does).
//   Severity and motion: act:<handle>:<resolve|dismiss|reopen|promote>, below-threshold (alias
//   suggestions: open or fold every "below threshold (N)" line), whole:<handle> (its whole message),
//   menu:<handle>:<defer|more>, menu:threshold, menu:off (the row and lane menus, as a click opens them),
//   threshold:<blocking|needed|optional> (the threshold menu's choice: writes extract.threshold),
//   demo-ask:<blocking|needed|optional> and demo-answer:<handle> (demo only),
//   render-stats (the render count, to ledgr-data/log/panel-renders-<copy>.json).
//   Spaces: space:<off|on|toggle> (the session menu's switch for the focused pane's space: writes
//   spaces.disabled in ledgr-data/config.json; demo: draws the off state, nothing saved),
//   clear-questions (the YOUR QUESTIONS head's Clear N, as a click: twice, arm then clear).
//   Pins (docs/design/Pins.md 4.8), on the shown session, the same code as the clicks: fold-pins (fold or
//   unfold the PINS lane), pins-search:<text> (types into its search box; empty clears), pin-select:<P
//   handle> (checks or unchecks it), ask-pins (Ask about these…), ask-here:<Q handle> (a question with
//   pins: Ask here, pasted, never sent), pin-note:<P handle>:<text> (empty clears), pin-archive:<P handle>,
//   pin-restore:<P handle>. In the box (keys.json mod:ledgr): pin (⌘S, capture.js).
import { View } from "gpui-kit";
import { props, nextCommand } from "herdr";
import { Panel } from "./panel.js";
import { Capture } from "./capture.js";
import { Host } from "./host.js";

function isCapture(p) {
  if (p?.view === "capture") return true;
  if (p?.view === "panel") return false;
  return Boolean(p?.overlay);
}

export default class Ledgr extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.ctl = p.view === "host" ? new Host(this, cx) : isCapture(p) ? new Capture(this, cx) : new Panel(this, cx);
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        this.ctl.command(c, cx);
        cx.notify();
      }
    });
  }

  render(cx) {
    return this.ctl.render(cx);
  }

  // The block, tab or overlay goes (or the app quits): a writer in this copy gives its role up.
  async close(_cx) {
    try { this.ctl?.release?.(); } catch { /* closing */ }
  }
}
