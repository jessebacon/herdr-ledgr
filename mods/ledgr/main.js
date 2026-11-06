// ledgr: a two-direction list of asks around one agent conversation (Herdr mod).
//   props { view: "panel" }            the panel block (by default a child of the right-hand
//                                      `panel-body` stack); reads store.json, and runs a fallback
//                                      writer only when no host answers (panel.js)
//   props { view: "host", bar? }       the always-shown host block: runs the writer that ingests
//                                      ledgr-data/spool, shows what is open, toggles the panel (host.js)
//   props { overlay } (mod.open:ledgr) the capture box, ⌘J (capture.js)
//   props { view: "capture", parent, session, terminal, prefill }
//                                      the capture box opened from an item ("Ask about this")
//   props { demo: true } / FORCE_DEMO  fixture data (fixtures.js)
// Commands (keys.json `mod:ledgr`, or `herdr-app do ledgr.<command>`; shown copies only):
//   host: toggle (show or hide the panel; keys.json binds it, ⌘⇧J by default);
//   btw (⌘Enter in the box), submit, escape; panel: demo, capture, rescan, expand-all,
//   branch (open the Branch confirmation on the newest open parked question), branch-split,
//   branch-agent (its placement), launch-branch (its Launch button), expand-branches, sessions
//   (the session menu); Phase 3: conclude (Conclude… on the newest branch that can), conclude-edit:<text>
//   (append a line to the open editor), send-to-trunk, ask-conclusion, copy-confluence, close-branch
//   (twice: the two clicks), copy-answers (the newest turn with typed answers).
//   For scripted looks: fold-mine, fold-asks (fold or unfold a lane), collapse-all (every open row and box);
//   pick:<handle>:<n> (click option n of an ask), copy-answer:<handle> (its Copy answer button),
//   session:<terminal|sid prefix> (show that session, as the session menu does).
//   Severity and motion: act:<handle>:<resolve|dismiss|reopen|promote>, below-threshold (alias
//   suggestions: open or fold every "below threshold (N)" line), whole:<handle> (its whole message),
//   menu:<handle>:<defer|more>, menu:threshold, menu:off (the row and lane menus, as a click opens them),
//   threshold:<blocking|needed|optional> (the threshold menu's choice: writes extract.threshold),
//   demo-ask:<blocking|needed|optional> and demo-answer:<handle> (demo only),
//   render-stats (the render count, to ledgr-data/log/panel-renders-<copy>.json).
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
