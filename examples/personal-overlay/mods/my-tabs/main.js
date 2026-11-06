import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings, nextCommand, appHome } from "herdr";
import * as fs from "fs/promises";
// The ledgr writer (spool ingest, ledgr-data/store.json, the header chips) runs here because this
// copy is always shown: this tab bar is a ledgr host, in place of ledgr's own host block.
// mods/my-tabs/ledgr/ is a byte-identical copy of mods/ledgr's engine (writer.js ENGINE_FILES),
// written by ledgr's install.sh: Herdr refuses imports from outside a mod's folder.
import { Writer } from "./ledgr/writer.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Panels that follow the focused agent across spaces: never recorded or replaced per space.
const GLOBAL_PANELS = ["quota", "ledgr"];

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    // ledgr: only when the ledgr mod is installed. Failures stay inside ledgr.
    this.ledgr = null;
    cx.spawn(async (cx) => {
      let installed = false;
      try { installed = await fs.exists(`${appHome()}/mods/ledgr/main.js`); } catch { /* not readable here (herdr-app check) */ }
      if (!installed) return;
      try {
        const w = new Writer("my-tabs");
        this.ledgr = w;
        await w.start(cx);
      } catch (e) { console.warn("ledgr writer:", String(e?.message ?? e)); }
    });
    cx.timer.every(60000, (cx) => { try { this.ledgr?.tick(cx); } catch { /* ledgr only */ } });
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // Quota and ledgr are global, never a per-space choice: drop any recorded from before.
    for (const k of Object.keys(this.panels)) if (GLOBAL_PANELS.includes(this.panels[k])) delete this.panels[k];
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        // toggle-ledgr (keys.json cmd-shift-j); toggle-ledger is accepted as the spec's spelling.
        const child = c === "toggle-quota" ? "quota" : c === "toggle-ledgr" || c === "toggle-ledger" ? "ledgr" : null;
        if (!child) continue;
        const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
        const on = panel && !panel.hidden && body?.active === child;
        if (on) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel-body", child }); run("layout.show", { id: "panel" }); }
        cx.notify();
      }
    });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    // Quota tracks every account and ledgr follows the focused agent, so while either is the
    // shown panel it stays across spaces and is neither recorded for a space nor replaced by
    // that space's Files/Changes choice.
    if (GLOBAL_PANELS.includes(now)) {
      if (space.id !== this.space) { this.space = space.id; this.pending = null; }
      return;
    }
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = !GLOBAL_PANELS.includes(stored) && enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render(cx) {
    try { this.ledgr?.respond(cx); this.ledgr?.track(cx); } catch { /* ledgr only */ }
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = [...new Set([...(shared("workspace.panels") ?? ["files", "changes"]), "quota", "ledgr"])];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(enabled.includes("quota"), el => el.child(panelButton("quota", "Quota", "mods/quota/quota.svg")))
      .when(enabled.includes("ledgr"), el => el.child(panelButton("ledgr", "ledgr", "mods/workspace-chrome/file-text.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/my-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/my-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/my-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
