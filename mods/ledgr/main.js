// ledgr: a two-direction list of asks around one agent conversation (Herdr mod).
//   props { view: "panel" }            the panel block (by default a child of the right-hand
//                                      `panel-body` stack): one line per item; reads store.json, and
//                                      runs a fallback writer only when no host answers (panel.js)
//   props { view: "detail", session, kind, id, open?, sel?, opener?, demo? }
//                                      the detail dialog (an overlay the panel opens on a row's click or
//                                      Enter, 0.6 × 0.75 of the window): one ask, question, pin or branch
//                                      whole, its text selectable, every action (detail.js;
//                                      docs/design/Detail.md 2). Its own copy: reads store.json, posts
//                                      spool events, never the writer
//   props { view: "settings", opener?, demo? }
//                                      the settings dialog (the panel's gear, ledgr.settings; 0.5 × 0.7): text
//                                      scale, threshold, closing list, the ui switches, branch depth, off
//                                      spaces, each written to ledgr-data/config.json at once (settings.js).
//                                      Its own copy: reads config.json, writes it only through reader.js
//                                      editConfig; one dialog at a time with the detail dialog
//   props { view: "host", bar? }       the always-shown host block: runs the writer that ingests
//                                      ledgr-data/spool, shows what is open, toggles the panel (host.js)
//   props { overlay } (mod.open:ledgr) the capture box, ⌘J (capture.js): any overlay without a view
//   props { view: "capture", parent, session, terminal, prefill }
//                                      the capture box opened from an item ("Ask about this")
//   props { view: "capture", session, terminal, pins: [{id, label}], then }
//                                      the capture box in pins mode (the panel's Ask about these…,
//                                      Ask here…, Branch… on a pin; then: "trunk" | "branch" | null)
//   props { demo: true } / FORCE_DEMO  fixture data (fixtures.js)
// Commands (keys.json `mod:ledgr`, or `herdr-app do ledgr.<command>`; shown copies only):
//   host: toggle (show or hide the panel; keys.json binds it, ⌘⇧J by default);
//   btw (⌘Enter in the box), submit, escape; panel: demo, capture, rescan,
//   branch (the dialog on the newest open parked question, its Branch confirmation open); the dialog's:
//   branch-split, branch-agent (its placement), launch-branch (its Launch button); sessions
//   (the session menu); Phase 3: conclude (Conclude… on the newest branch that can), conclude-edit:<text>
//   (the dialog's: append a line to the open editor), send-to-trunk (the dialog's Paste into trunk),
//   ask-conclusion, copy-confluence (Paste confluence again), close-branch (twice: the two clicks), copy-answers
//   (Paste answers: the newest turn with typed answers). The paste commands paste into the prompt only as the
//   clicks do (ui.pasteIntoPrompt, focus confirmed; never Enter). expand-all and expand-branches are gone
//   (rows open in the detail dialog).
//   For scripted looks: fold-mine, fold-asks (fold or unfold a lane), collapse-all (closes the open dialog),
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
//   The list and the detail dialog (docs/design/Detail.md 1.10): open:<handle> (the dialog on A3, Q2, P4 or
//   a branch's hc name), cursor:<handle>, list-key:<up|down|pageup|pagedown|home|end|enter|space|escape>,
//   focus-list (the list's keyboard, bound to no key), demo-detail[:<handle>] (the demo, then the dialog on
//   that demo item, A15 by default); collapse-all closes the open dialog. The panel's go:, whole:, menu:,
//   ask-here:, conclude, ask-conclusion, copy-confluence and close-branch open the dialog in that state
//   (the open dialog does them when it is on that item, and pick: and copy-answer: too). The dialog's own:
//   detail:close, detail:done, detail:whole, detail:pick:<n>, detail:answer:<text>, and launch-branch,
//   branch-split, branch-agent, send-to-trunk, conclude-edit:<text> (they need its state). It takes tab and
//   backtab for its own fields only; btw (⌘Enter, the capture box's /btw) on an ask, while it holds the
//   keyboard, as the turn's answers pasted (its answer box is multi-line: Enter is a new line); detail-next
//   and detail-prev (⌘↓ / ⌘↑, keys.json mod:ledgr; detail:next, detail:prev for scripts): the next or
//   previous record of the lane in the panel's order, in place (2026-11-11). It ignores pin, submit and
//   escape (the capture box's); the panel ignores detail-next and detail-prev.
//   The settings dialog (2026-11-10): settings (the panel's gear: the dialog opens, an open detail dialog
//   closes first; the host opens it when the panel is not shown), demo-settings (the dialog with the
//   defaults and sample spaces, nothing saved). The dialog's own: settings:close,
//   settings:scale:<up|down|reset|0.8…1.6> (the text scale's stepper, as a click: written to config.json).
import { View } from "gpui-kit";
import { props, nextCommand } from "herdr";
import { Panel } from "./panel.js";
import { Capture } from "./capture.js";
import { Host } from "./host.js";
import { Detail } from "./detail.js";
import { Settings } from "./settings.js";

function isCapture(p) {
  if (p?.view === "capture") return true;
  if (p?.view === "panel") return false;
  return Boolean(p?.overlay);
}

export default class Ledgr extends View {
  init(_props, cx) {
    const p = props() ?? {};
    // The detail and settings views before isCapture, which takes any overlay without a view.
    this.ctl = p.view === "host" ? new Host(this, cx) : p.view === "detail" ? new Detail(this, cx) : p.view === "settings" ? new Settings(this, cx) : isCapture(p) ? new Capture(this, cx) : new Panel(this, cx);
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

  // The block, tab or overlay goes (or the app quits): a writer in this copy gives its role up; the detail
  // dialog writes its closed record and every event not yet written; the settings dialog its queued
  // config.json changes, then its closed record. Awaited: Herdr cancels the copy's
  // tasks once close() resolves (at most 250 ms).
  async close(_cx) {
    try { await this.ctl?.release?.(); } catch { /* closing */ }
  }
}
