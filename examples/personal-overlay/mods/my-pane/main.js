// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "my-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
//
// my-pane: Jesse's clone of the shipped `pane` header, plus the ledgr chip (ledgr spec 6.5).
// The chip reads shared("ledgr.chips")[terminal] = { s, q, a, st, t, ag, b }, written only by
// the ledgr writer: hidden with nothing open; "collecting" (dim "? 2") while the agent
// works and questions were parked this turn; "blocking" (`blocked` colour, "1 blocking · 2 asks")
// while an ask the agent stopped on is open (`b` of the `a` asks); "surfaced" (accent "2 parked ·
// 3 asks") after a turn ends with something new; "seen" (muted "? 2 · 3"). `a` leaves out asks below
// ledgr's extract.threshold (suggestions). `p` (a turn number) means the asks
// of that turn are being extracted: a small native spinner shows until they land (or 30 s).
// When the chip turns loud (surfaced or blocking, or a later turn ends loud) it pulses once: a
// halo under it fades out over ~0.9 s, natively. The pulse fires on that transition only (the
// previous chip is kept per pane); shared("ledgr.ui").animations false (ledgr's ui.animations)
// turns the pulse and the spinner's motion off. No toast, no sound, no periodic timers.
// Click: show the ledgr panel on that session.
// `herdr-app do my-pane.demo-chip:<surfaced|blocking|seen|collecting|off>` draws that chip state on
// every shown header (a scripted look at the states and the pulse; nothing is read or published).

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, shared, setShared, nextCommand } from "herdr";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// true: panes show the four chip states in turn, with sample counts (for checks and shots).
const DEMO_CHIPS = false;
const DEMO_STATES = [{ q: 2, a: 3, st: "surfaced" }, { q: 2, a: 0, st: "collecting" }, { q: 1, a: 3, b: 1, st: "blocking" }, { q: 1, a: 2, st: "seen", p: 18 }, null];

function ledgrChip(p) {
  if (DEMO_CHIPS) {
    const i = panes().findIndex((x) => x.pane === p.pane);
    const d = DEMO_STATES[(i < 0 ? 0 : i) % DEMO_STATES.length];
    return d ? { s: "demo", t: 17, ag: "claude", ...d } : null;
  }
  const c = p?.terminal ? shared("ledgr.chips")?.[p.terminal] : null;
  return c && (c.q || c.a || c.p != null) ? c : null;
}

const loud = (c) => Boolean(c) && (c.st === "surfaced" || (c.st === "blocking" && c.b > 0));

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false; this.lastChip = undefined; this.pulse = null; this.demoChip = null;
    cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); this.command(c); cx.notify(); } });
  }

  command(c) {
    if (!String(c).startsWith("demo-chip:")) return;
    const st = String(c).slice("demo-chip:".length);
    this.demoChip = st === "off" ? null
      : { s: "demo", q: 1, a: st === "blocking" ? 3 : 2, ...(st === "blocking" ? { b: 1 } : {}), st, t: (this.demoChip?.t ?? 17) + 1, ag: "claude" };
  }

  // The chip's one pulse: compares this render's chip with the last one this pane drew. Quiet to
  // loud, or loud again for a later turn, starts it; the second frame (16 ms later) sets the halo's
  // target, and the transition does the rest without the script.
  pulseFor(c, cx) {
    const prev = this.lastChip;
    this.lastChip = c ? { st: c.st, t: c.t ?? 0, b: c.b ?? 0 } : null;
    if (prev === undefined || shared("ledgr.ui")?.animations === false) return;
    if (loud(c) && (!loud(prev) || (c.t ?? 0) > prev.t)) {
      const p = this.pulse = { at: Date.now(), phase: 0, color: c.st === "blocking" ? "blocked" : "accent" };
      cx.timer.after(16, (cx) => { if (this.pulse === p) { p.phase = 1; cx.notify(); } });
    }
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/my-pane/${icon}.svg`).size(14));
  }

  chip(t, c, pane) {
    const motion = shared("ledgr.ui")?.animations !== false;
    const pu = this.pulse && Date.now() - this.pulse.at < 1200 ? this.pulse : null;
    const surfaced = c.st === "surfaced", collecting = c.st === "collecting", blocking = c.st === "blocking" && c.b > 0;
    const pending = c.p != null;
    const more = (c.a ?? 0) - (c.b ?? 0);
    const label = !c.q && !c.a ? "asks" : blocking
      ? [`${c.b} blocking`, more ? `${more} ask${more === 1 ? "" : "s"}` : null, c.q ? `${c.q} parked` : null].filter(Boolean).join(" · ")
      : surfaced
      ? [c.q ? `${c.q} parked` : null, c.a ? `${c.a} ask${c.a === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")
      : collecting ? `? ${c.q}` : `? ${c.q} · ${c.a}`;
    return div()
      .id(`ledgr-chip-${pane}`)
      .flex_none()
      .relative()
      .px(6)
      .h(18)
      .flex()
      .items_center()
      .rounded(5)
      .text_size(10.5)
      .when(blocking, (el) => el.bg(t.blocked + "26").text_color(t.blocked).font_semibold())
      .when(surfaced && !blocking, (el) => el.bg(t.accent + "26").text_color(t.accent).font_semibold())
      .when(collecting, (el) => el.text_color(t.dim))
      .when(!surfaced && !collecting && !blocking, (el) => el.text_color(t.muted))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .gap(4)
      .tooltip(`ledgr: ${c.q} parked, ${c.a} asked of you${c.b ? ` (${c.b} blocking: the agent waits on ${c.b === 1 ? "it" : "them"})` : ""} · turn ${c.t ?? "?"}${pending ? ` · extracting turn ${c.p}` : ""}`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run("layout.select", { stack: "panel-body", child: "ledgr" });
        run("layout.show", { id: "panel" });
        if (c.s && c.s !== "demo") setShared("ledgr.focus", { session: c.s, at: Date.now() });
      })
      .when(Boolean(pu), (el) => el.child(div().id(`ledgr-chip-pulse-${pane}`).absolute().top(0).left(0).size_full().rounded(5)
        .bg(t[pu.color] + "66").opacity(pu.phase ? 0 : 1).transition("opacity", { duration: 900, easing: "ease-out" })))
      .when(pending, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(10).flex_none().text_color(t.working).when(motion, (x) => x.spin(900))))
      .child(label);
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const chip = this.demoChip ?? ledgrChip(p);
    this.pulseFor(chip, cx);
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(Boolean(chip), (el) => el.child(this.chip(t, chip, pane)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
