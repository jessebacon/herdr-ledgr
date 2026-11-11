// ledgr host (props {view: "host"}): a small block that is always on screen and hosts the writer
// (writer.js, role "host"): spool ingest, store.json, the chips. A panel block's copy starts only
// the first time it is shown, so without a host the writer would wait for the panel. Put it where
// it never hides: beside the status bar ({bar: "status"}), beside the tab bar ({bar: "tabs"}), or
// as a floating block. It shows "ledgr" and what is open across sessions (asks that count at
// extract.threshold plus parked questions; blocking in `blocked`, new in `accent`); a click, or
// `ledgr.toggle` from keys.json, shows or hides the panel (config.json ui.panel says where it is).
// props {view: "host", demo: true}: sample counts, no writer (for shots and checks).
// Its text follows ui.textScale (shared("ledgr.ui").textScale, which the writer publishes), its heights
// capped so it stays inside the 28 px bar the installer gives it (BAR_H). `ledgr.settings` with the panel
// hidden opens the settings dialog from here (the host holding the writer only; a shown panel opens it):
// config.js settingsOpening, which an overlay host (my-tabs.ledgr-settings) uses too, since a ledgr
// command reaches no ledgr copy there while the panel is hidden.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, props, shared, placement, openOverlay, closeOverlay } from "herdr";
import { Writer } from "./writer.js";
import { panelPlace, panelShown, togglePanel, textScaleOf, withScale, settingsOpening } from "./config.js";

const DEMO_CHIPS = { t21: { q: 2, a: 3, b: 1, st: "blocking" }, t27: { q: 1, a: 1, st: "seen" } };
// The tallest the button may grow with the text scale: the host row is 28 px (setup/layout-blocks.json).
const BAR_H = 26;

export class Host {
  constructor(view, cx) {
    const p = props() ?? {};
    this.demo = p.demo === true;
    this.bar = p.bar ?? null;
    this.writer = null;
    this.note = null;
    if (this.demo) return;
    this.writer = new Writer("host");
    cx.spawn(async (cx) => {
      try { await this.writer.start(cx); }
      catch (e) { this.note = `writer: ${String(e?.message ?? e)}`; }
      cx.notify();
    });
    cx.timer.every(60000, (cx) => { try { this.writer?.tick(cx); } catch { /* the writer notes its own faults */ } });
  }

  command(c) {
    if (c === "toggle" || c === "toggle-ledgr") togglePanel(panelPlace());
    // The settings dialog when no panel is shown to open it (one host: the writer's); an open detail
    // dialog closes first (one dialog at a time, shared("ledgr.detail")).
    else if ((c === "settings" || c === "demo-settings") && this.writer?.holds?.() && panelShown(panelPlace()) !== true) {
      const o = settingsOpening(shared("ledgr.detail"), { demo: c === "demo-settings" });
      if (o.close) { try { closeOverlay(o.close); } catch { /* already gone */ } }
      openOverlay(o.spec);
    }
  }

  release() {
    try { this.writer?.release(); } catch { /* closing */ }
  }

  totals() {
    const chips = this.demo ? DEMO_CHIPS : shared("ledgr.chips") ?? {};
    const out = { a: 0, b: 0, q: 0, loud: false, sessions: 0 };
    for (const c of Object.values(chips)) {
      if (!c || typeof c !== "object") continue;
      out.a += Number(c.a) || 0; out.b += Number(c.b) || 0; out.q += Number(c.q) || 0;
      if (c.st === "surfaced") out.loud = true;
      if (c.a || c.q) out.sessions++;
    }
    return out;
  }

  render(cx) {
    try { this.writer?.respond(cx); this.writer?.track(cx); } catch { /* ledgr only */ }
    // ui.textScale as the writer publishes it (this copy's writer's own config before the first publish).
    const t = withScale(theme(), textScaleOf({ ui: { textScale: shared("ledgr.ui")?.textScale ?? this.writer?.cfg?.ui?.textScale } }));
    const n = this.totals();
    const open = n.a + n.q;
    const on = panelShown(panelPlace()) === true;
    const floating = Boolean(placement());
    const tone = n.b ? t.blocked : n.loud ? t.accent : t.muted;
    const tip = [`ledgr: ${n.a} ask${n.a === 1 ? "" : "s"} of you${n.b ? ` (${n.b} blocking)` : ""}, ${n.q} parked question${n.q === 1 ? "" : "s"}`,
      n.sessions > 1 ? ` across ${n.sessions} sessions` : "", " · click to show or hide the panel",
      this.note ? ` · ${this.note}` : ""].join("");
    return h_flex()
      .id("ledgr-host")
      .when(!floating, (el) => el.size_full().bg(t.chrome)
        .when(this.bar === "status", (x) => x.border_t(1).border_color(t.border))
        .when(this.bar === "tabs", (x) => x.border_b(1).border_color(t.border)))
      .justify_center()
      .items_center()
      .child(h_flex()
        .id("ledgr-host-button")
        .h(Math.min(BAR_H, t.ts(floating ? 24 : 22)))
        .px(7)
        .gap(5)
        .items_center()
        .rounded(6)
        .text_size(t.ts(12))
        .cursor_pointer()
        .bg(on ? t.selected : t.chrome)
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .tooltip(tip)
        .on_click((_e, cx) => { togglePanel(panelPlace()); cx.notify(); })
        .child(svg("mods/ledgr/ledgr.svg").size(13).flex_none().text_color(open ? tone : t.dim))
        .child("ledgr")
        .when(open > 0, (el) => el.child(div()
          .flex_none()
          .px(5)
          .h(Math.min(BAR_H - 6, t.ts(16)))
          .flex()
          .items_center()
          .rounded(4)
          .text_size(t.ts(10.5))
          .when(n.b > 0 || n.loud, (x) => x.font_semibold().bg(tone + "26"))
          .text_color(tone)
          .child(n.b ? `${n.b} ◆ ${open}` : String(open)))));
  }
}
