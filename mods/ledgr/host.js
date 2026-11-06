// ledgr host (props {view: "host"}): a small block that is always on screen and hosts the writer
// (writer.js, role "host"): spool ingest, store.json, the chips. A panel block's copy starts only
// the first time it is shown, so without a host the writer would wait for the panel. Put it where
// it never hides: beside the status bar ({bar: "status"}), beside the tab bar ({bar: "tabs"}), or
// as a floating block. It shows "ledgr" and what is open across sessions (asks that count at
// extract.threshold plus parked questions; blocking in `blocked`, new in `accent`); a click, or
// `ledgr.toggle` from keys.json, shows or hides the panel (config.json ui.panel says where it is).
// props {view: "host", demo: true}: sample counts, no writer (for shots and checks).
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, props, shared, placement } from "herdr";
import { Writer } from "./writer.js";
import { panelPlace, panelShown, togglePanel } from "./config.js";

const DEMO_CHIPS = { t21: { q: 2, a: 3, b: 1, st: "blocking" }, t27: { q: 1, a: 1, st: "seen" } };

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
    const t = theme();
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
        .h(floating ? 24 : 22)
        .px(7)
        .gap(5)
        .items_center()
        .rounded(6)
        .text_size(12)
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
          .h(16)
          .flex()
          .items_center()
          .rounded(4)
          .text_size(10.5)
          .when(n.b > 0 || n.loud, (x) => x.font_semibold().bg(tone + "26"))
          .text_color(tone)
          .child(n.b ? `${n.b} ◆ ${open}` : String(open)))));
  }
}
