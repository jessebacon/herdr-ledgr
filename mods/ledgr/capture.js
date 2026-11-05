// ledgr capture box (spec 5): opened by `mod.open:ledgr` (⌘J) as the popup mod.json
// describes, or from an item's "Ask about this" with props { view: "capture", parent, session,
// terminal, prefill }. It never sends anything to the agent: Enter parks the question as a
// `capture` spool event; ⌘Enter parks it and stages `/btw ...` on the clipboard, focusing the
// agent's pane for ⌘V. Esc closes. The panel copy ingests the event.
//
// Quote rule (2026-11-05): a clipboard quote is attached only if it occurs (whitespace-
// normalized) in this session's saved turn text (ledgr-data/turns/<sid>/*.md) or, while the
// agent is working, in `hc read <terminal>` taken when the box opens. Otherwise the question is
// stored without it, and a second field takes a quote pasted by hand (quoteSource "typed").
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import * as fs from "fs/promises";
import { props, closeOverlay, focused, agents, panes, run, theme, setShared, hc, readTextFile } from "herdr";
import { LIMITS, agentLabel, dataDir } from "./config.js";
import { readMap, writeEvent } from "./spool.js";
import { passageHash, newId } from "./store.js";
import { btwText, isLive } from "./nav.js";

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// Fullscreen Claude renders **bold** and `code` without their marks, so a copied passage lacks
// them; both sides drop them before the second comparison (BUILD-NOTES-mod.md).
const unmark = (s) => squash(String(s ?? "").replace(/[*`]+/g, ""));
const occursIn = (text, q) => Boolean(text) && (squash(text).includes(squash(q)) || unmark(text).includes(unmark(q)));

export class Capture {
  constructor(view, cx) {
    this.view = view;
    const p = props() ?? {};
    this.p = p;
    this.parent = p.parent ?? null;
    this.done = false;
    this.error = null;
    this.records = [];
    this.at = 0;
    this.terminal = p.terminal ?? focused()?.terminal ?? null;
    this.field = "q";
    this.input = InputState.new({ placeholder: "Park a question about what you are reading…", value: p.prefill ?? "" });
    if (p.prefill) this.input.set_selected_range({ start: p.prefill.length, end: p.prefill.length });
    this.input.on("submit", (e, cx) => this.park(cx, Boolean(e?.secondary)));
    this.input.on("focus", () => { this.field = "q"; });
    this.quoteInput = InputState.new({ placeholder: "Quote (optional): paste the passage by hand" });
    this.quoteInput.on("submit", (e, cx) => this.park(cx, Boolean(e?.secondary)));
    this.quoteInput.on("focus", () => { this.field = "quote"; });
    this.input.focus();
    cx.timer.after(600, () => { if (!this.done && this.field === "q") this.input.focus(); });
    this.handle = cx.focus_handle();

    // The clipboard is the bridge for a selection (spec 5.4): fullscreen Claude copies on
    // mouse release. A candidate is 3-600 characters; it starts checked if it also differs
    // from the clipboard at the last capture.
    this.clip = null; this.cand = null; this.useQuote = false;
    this.quoteState = "none";   // none | checking | ok | rejected | unreadable
    this.quoteNote = null;
    try {
      const c = cx.read_from_clipboard();
      this.clip = typeof c === "string" ? c : null;
    } catch {
      this.quoteState = "unreadable";
      this.quoteNote = "Clipboard not readable from a mod here: no quote attached.";
    }
    if (this.clip !== null) {
      const sq = squash(this.clip);
      let last = null;
      try { last = localStorage.getItem("lastClip"); } catch { /* no storage */ }
      if (sq.length >= 3 && sq.length <= LIMITS.quote) {
        this.cand = this.clip.trim();
        this.useQuote = this.clip !== last;
        this.quoteState = "checking";
      } else this.quoteNote = sq.length > LIMITS.quote ? "Clipboard is over 600 characters: not used as a quote." : null;
    }

    this.validation = null;
    cx.spawn(async (cx) => {
      const recs = await readMap();
      this.records = this.targets(recs);
      const want = p.session ? this.records.findIndex((r) => r.session_id === p.session) : this.records.findIndex((r) => r.terminal === this.terminal);
      this.at = Math.max(0, want);
      this.loaded = true;
      this.validate(cx);
      cx.notify();
    });
  }

  // Sessions to park against: the focused terminal's first, then live agent sessions by recency.
  // A terminal without a hook record (no hooks, another agent) gets a synthetic session
  // "herdr:<t>" so the human lane works for every agent from day one (spec 2.9).
  targets(recs) {
    const live = recs.filter((r) => isLive(r.terminal));
    const out = [...live, ...recs.filter((r) => !live.includes(r))];
    const t = this.terminal;
    if (t && !out.some((r) => r.terminal === t)) {
      const a = agents().find((x) => x.address === t);
      if (a || !out.length) {
        const cwd = panes().find((p) => p.terminal === t)?.cwd ?? null;
        out.unshift({ session_id: `herdr:${t}`, terminal: t, agent: a?.app ?? "other", session_name: a?.title || t, cwd,
          turn: 0, state: a?.status === "working" ? "working" : "idle", synthetic: true });
      }
    }
    const i = out.findIndex((r) => r.terminal === t);
    if (i > 0) out.unshift(out.splice(i, 1)[0]);
    return out;
  }

  target() { return this.records[this.at] ?? null; }

  working(rec) {
    const st = agents().find((a) => a.address === rec?.terminal)?.status;
    return st === "working" || (st === undefined && rec?.state === "working");
  }

  // Checks the clipboard candidate against the target session's text (see the header).
  // Runs in its own task (a click's cx must not be used after an await); park() awaits it.
  validate(cx) {
    const rec = this.target();
    if (!this.cand || !rec) return;
    this.quoteState = "checking";
    const cand = this.cand;
    let done;
    this.validation = new Promise((r) => { done = r; });
    cx.spawn(async (cx) => {
      try {
        let found = false;
        const sources = [];
        if (!rec.synthetic) {
          sources.push("saved turns");
          const dir = `${dataDir()}/turns/${rec.session_id}`;
          const names = (await fs.readdir(dir).catch(() => []))
            .map((n) => String(n).split("/").pop()).filter((n) => /^\d+\.md$/.test(n))
            .sort((a, b) => parseInt(b, 10) - parseInt(a, 10)).slice(0, LIMITS.turnsSearch);
          for (const n of names) {
            if (occursIn(await readTextFile(`${dir}/${n}`).catch(() => null), cand)) { found = true; break; }
          }
        }
        if (!found && rec.terminal && this.working(rec)) {
          sources.push("screen");
          const r = await hc(["read", rec.terminal]).catch(() => null);
          if (r && r.code === 0 && occursIn(r.stdout, cand)) found = true;
        }
        if (this.target() !== rec) return;   // the person switched sessions meanwhile
        this.quoteState = found ? "ok" : "rejected";
        this.quoteNote = found ? null
          : `Clipboard text is not in this session's ${sources.join(" or ") || "text"}: not attached. Paste a quote by hand if you want one.`;
      } finally {
        done();
        cx.notify();
      }
    });
  }

  close() {
    this.done = true;
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  park(cx, btw) {
    if (this.done || this.saving) return;
    const text = squash(this.input.value()).slice(0, LIMITS.text);
    const rec = this.target();
    this.saving = true;
    cx.notify();
    cx.spawn(async (cx) => {
      if (this.validation) await this.validation.catch(() => {});
      const typed = squash(this.quoteInput.value()).slice(0, LIMITS.quote);
      const clipOk = this.quoteState === "ok" && this.useQuote;
      const quote = clipOk ? this.cand.slice(0, LIMITS.quote) : typed || null;
      const quoteSource = clipOk ? "clipboard" : typed ? "typed" : undefined;
      if (!text && !quote) { this.saving = false; this.close(); return; }
      if (!rec) { this.saving = false; this.error = "No session to park against yet."; cx.notify(); return; }
      const asBtw = btw && Boolean(text);
      const now = Date.now();
      const working = rec.state === "working";
      const id = newId("rq");
      const turn = Number(rec.turn) || 0;
      const request = {
        id, key: id, handle: null, direction: "human_to_agent", text, kind: text ? "question" : "bookmark",
        anchor: {
          sessionId: rec.session_id, turn, promptId: rec.prompt_id ?? null, uuid: working ? null : rec.last_assistant_uuid ?? null,
          quote: quote ?? undefined, quoteSource, hash: passageHash(quote || text),
          settled: !working, capturedDuring: working ? "working" : "idle",
        },
        status: "open", parentId: this.parent ?? undefined, origin: asBtw ? "btw" : "capture", terminal: rec.terminal ?? undefined,
        createdTurn: turn, btwStagedAt: asBtw ? now : undefined, createdAt: now, updatedAt: now, seq: 0,
      };
      try {
        await writeEvent("capture", { terminal: rec.terminal ?? null, session_id: rec.session_id, agent: rec.agent ?? null, turn,
          session_name: rec.session_name ?? null, cwd: rec.cwd ?? null, request });
      } catch (e) {
        this.saving = false;
        this.error = `Not saved: ${String(e?.message ?? e)}`;
        cx.notify();
        return;
      }
      // Clipboard last: /btw replaces what the person copied, so only after the save.
      if (asBtw) cx.write_to_clipboard(btwText(text, quote));
      try { localStorage.setItem("lastClip", this.clip ?? ""); } catch { /* no storage */ }
      setShared("ledgr.focus", { session: rec.session_id, item: id, at: now });
      this.close();
      if (asBtw && rec.terminal && isLive(rec.terminal)) run("pane.focus", { terminal: rec.terminal });
    });
  }

  command(c, cx) {
    if (c === "btw") this.park(cx, true);
    else if (c === "submit") this.park(cx, false);
    else if (c === "escape") this.close();
    else if (c === "tab" || c === "backtab") {
      const next = this.field === "q" && this.showQuoteField() ? this.quoteInput : this.input;
      cx.timer.after(0, () => next.focus());
    }
  }

  showQuoteField() { return this.quoteState !== "ok" && this.quoteState !== "checking"; }

  render() {
    const t = theme();
    const rec = this.target();
    const label = rec
      ? `${rec.terminal ?? "?"} · ${rec.session_name || rec.repo || "unnamed"} · turn ${rec.turn ?? 0}${this.working(rec) ? " (working)" : ""}`
      : this.loaded ? "no session" : "…";
    const key = (k, what) => h_flex().gap(4).items_center()
      .child(div().px(5).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.muted).child(k))
      .child(div().text_size(11).text_color(t.dim).child(what));
    const ok = this.quoteState === "ok";
    const quoteRow = this.cand && (ok || this.quoteState === "checking")
      ? h_flex().id("cap-quote").gap(8).items_start().cursor_pointer()
        .on_click((_e, cx) => { if (ok) { this.useQuote = !this.useQuote; cx.notify(); } })
        .child(div().flex_none().size(14).mt(1).rounded(3).border_1().border_color(ok && this.useQuote ? t.accent : t.input)
          .bg(ok && this.useQuote ? t.accent : t.background).text_size(10).text_color(t.accent_foreground).flex().items_center().justify_center()
          .child(ok && this.useQuote ? "✓" : ""))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ok ? "Quote (from clipboard)" : "Checking quote…"))
        .child(div().flex_1().min_w(0).max_h(32).overflow_hidden().text_size(11.5).italic().text_color(ok && this.useQuote ? t.foreground : t.dim)
          .child(`“${squash(this.cand).slice(0, 220)}”`))
      : null;
    return v_flex().id("ledgr-capture").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(); cx.stop_propagation(); } })
      .size_full().min_h(0).p(16).gap(8).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().text_size(14).font_semibold().child(this.parent ? "Ask about this" : "Park a question"))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(label))
        .when(Boolean(rec), (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).child(agentLabel(rec.agent))))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().h(34).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .when(Boolean(quoteRow), (el) => el.child(quoteRow))
      .when(this.showQuoteField(), (el) => el.child(h_flex().h(28).flex_none().px(10).items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(this.quoteInput).flex_1().h_full().text_size(11.5).italic().text_color(t.foreground))))
      .when(Boolean(this.quoteNote), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(this.quoteNote)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().gap(12).items_center()
        .child(key("Enter", this.saving ? "saving…" : "park"))
        .child(key("⌘Enter", "park + /btw"))
        .child(key("Esc", "cancel"))
        .child(div().flex_1())
        .when(this.records.length > 1, (el) => el.child(div().id("cap-session").px(6).py(1).rounded(5).cursor_pointer()
          .text_size(11).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.at = (this.at + 1) % this.records.length; this.validate(cx); cx.notify(); this.input.focus(); })
          .child(`session: ${rec?.terminal ?? "?"} ↻ ${this.at + 1}/${this.records.length}`))));
  }
}
