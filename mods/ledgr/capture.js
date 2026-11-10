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
//
// Spaces (2026-11-07): over a pane in a space where ledgr is off (config.json spaces.disabled) the box
// parks nothing and says "ledgr is off in this space"; Esc, Enter or a click closes it. The writer's
// shared("ledgr.ui").off answers before config.json is read; the file decides. Sessions in such a
// space are not offered as targets either.
//
// Pins (docs/design/Pins.md 3): ⌘S in the box (`mod:ledgr` "cmd-s": "ledgr.pin", command `pin`; the key
// is pinning.js PIN_KEY) pins the copied passage, up to LIMITS.pin characters, as a `pin` spool event;
// the box's line is its note. The passage is looked for in the session's saved turns (the turn that
// holds it is the anchor), else on its screen (`hc read`, which only reads, whether or not the agent
// works); found nowhere, a second ⌘S within 5 s pins it unverified. pinning.js pinDraft decides. A
// question keeps the old quote rule: the clipboard attaches up to LIMITS.quote characters, when found in
// a saved turn, or on the screen while the agent works.
// Pins mode: the panel opens the box with props { view: "capture", session, terminal, pins: [{id,
// label}], then } (Ask about these, Ask here…, Branch… on a pin). The clipboard is not read; Enter parks
// the question with `request.pins`; ⌘Enter and ⌘S only say why not. The question parks in the panel's
// session and no other (pinning.js pinsTarget): without a map record, as store.json keeps it, with no
// terminal; then "trunk" needs a live pane (pinsThenRefusal), a branch does not.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import * as fs from "fs/promises";
import { props, closeOverlay, focused, agents, panes, run, theme, shared, setShared, hc, readTextFile } from "herdr";
import { LIMITS, agentLabel, dataDir, loadConfig, spaceOff, terminalSpace, storePath } from "./config.js";
import { readMap, writeEvent } from "./spool.js";
import { passageHash, newId } from "./store.js";
import { btwText, isLive } from "./nav.js";
import { pinText } from "./confluence.js";
import { PIN_KEY, PIN_WORDS, pinDraft, pinLimit, boxPins, boxThen, pinLabels, pinsTarget, pinsThenRefusal } from "./pinning.js";
import { paneWords, OFF_HERE } from "./words.js";

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// Fullscreen Claude renders **bold** and `code` without their marks, so a copied passage lacks
// them; both sides drop them before the second comparison (docs/build-notes/BUILD-NOTES-mod.md in the repo).
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
    // Pins mode (Pins.md 3.4): the question is about these pins; no clipboard quote.
    this.pins = boxPins(p);
    this.pinsMode = this.pins.length > 0;
    this.then = boxThen(p);
    this.status = null;        // one line: why ⌘S or Enter did nothing, what the next press does
    this.pinConfirm = null;    // the last refused ⌘S (pinDraft's confirm), for the unverified second press
    // The space the box was opened over: the item's terminal's ("Ask about this"), else the focused one.
    this.space = p.terminal ? terminalSpace(p.terminal) : (focused()?.space ?? terminalSpace(this.terminal));
    this.off = spaceOff({ spaces: { disabled: shared("ledgr.ui")?.off } }, this.space);
    this.field = "q";
    this.input = InputState.new({ value: p.prefill ?? "", placeholder: this.pinsMode ? "Your question about these pins…"
      : `Park a question about what you are reading… (${PIN_KEY.label} pins the passage; this line is its note)` });
    if (p.prefill) this.input.set_selected_range({ start: p.prefill.length, end: p.prefill.length });
    this.input.on("submit", (e, cx) => this.park(cx, Boolean(e?.secondary)));
    this.input.on("focus", () => { this.field = "q"; });
    this.quoteInput = InputState.new({ placeholder: "Quote (optional): paste the passage by hand" });
    this.quoteInput.on("submit", (e, cx) => this.park(cx, Boolean(e?.secondary)));
    this.quoteInput.on("focus", () => { this.field = "quote"; });
    this.handle = cx.focus_handle();
    if (this.off) cx.timer.after(0, () => this.focusBox());
    else this.input.focus();
    cx.timer.after(600, () => { if (!this.done && !this.off && this.field === "q") this.input.focus(); });

    // The clipboard is the bridge for a selection (spec 5.4): fullscreen Claude copies on
    // mouse release. A candidate is 3 to LIMITS.pin characters; over LIMITS.quote it can only be
    // pinned (quoteState "pinOnly"). As a quote it starts checked if it also differs from the
    // clipboard at the last capture. Pins mode reads no clipboard.
    this.clip = null; this.cand = null; this.useQuote = false; this.long = false;
    this.found = null; this.foundTurn = null; this.foundWorking = false;
    this.quoteState = "none";   // none | checking | ok | rejected | pinOnly | unreadable
    this.quoteNote = null;
    if (!this.pinsMode) {
      try {
        const c = cx.read_from_clipboard();
        this.clip = typeof c === "string" ? c : null;
      } catch {
        this.quoteState = "unreadable";
        this.quoteNote = "Clipboard not readable from a mod here: no quote attached.";
      }
    }
    if (this.clip !== null) {
      const sq = squash(this.clip);
      const len = pinText(this.clip).length;
      let last = null;
      try { last = localStorage.getItem("lastClip"); } catch { /* no storage */ }
      if (sq.length >= 3 && len <= pinLimit("pin")) {
        this.cand = this.clip.trim();
        this.long = sq.length > LIMITS.quote;
        this.useQuote = this.clip !== last;
        this.quoteState = "checking";
      } else this.quoteNote = sq.length > LIMITS.quote
        ? `Clipboard is over ${LIMITS.quote} characters: not used as a quote${len > pinLimit("pin") ? `, and over the ${pinLimit("pin")} a pin keeps` : ""}.` : null;
    }

    this.validation = null;
    cx.spawn(async (cx) => {
      this.cfg = await loadConfig();
      const was = this.off;
      this.off = spaceOff(this.cfg, this.space);
      if (this.off && !was) this.focusBox();
      const recs = await readMap();
      // A session in a space where ledgr is off is no target (its space as recorded, else live).
      this.records = this.targets(recs).filter((r) => !spaceOff(this.cfg, (typeof r.space === "string" && r.space) || terminalSpace(r.terminal)));
      if (this.pinsMode) {
        // Pins mode parks in the panel's session only: no map record, the store's; neither, refused.
        const known = this.records.some((r) => r.session_id === p.session);
        const pt = pinsTarget({ session: p.session, records: this.records, stored: known ? null : await this.storedSession(p.session) });
        if (pt.add) { this.records.unshift(pt.add); this.at = 0; }
        else this.at = pt.error ? -1 : pt.at;
        this.pinsError = pt.error ?? null;
        this.status = this.pinsError ?? pinsThenRefusal(this.target(), this.then, isLive);
      } else {
        const want = p.session ? this.records.findIndex((r) => r.session_id === p.session) : this.records.findIndex((r) => r.terminal === this.terminal);
        this.at = Math.max(0, want);
      }
      this.loaded = true;
      if (!this.off) this.validate(cx);
      cx.notify();
    });
  }

  // The store's record of session sid (store.json, read only), or null: unknown, or in a space where
  // ledgr is off. Pins mode only, for a session no map record names.
  async storedSession(sid) {
    if (!sid) return null;
    const text = await readTextFile(storePath()).catch(() => null);
    let s = null;
    try { s = JSON.parse(text)?.sessions?.[sid] ?? null; } catch { return null; }
    if (!s || typeof s !== "object" || s.sessionId !== sid) return null;
    return spaceOff(this.cfg, typeof s.space === "string" ? s.space : null) ? null : s;
  }

  // Off: the keyboard goes to the box itself (Esc, Enter close it); there is no field to type in.
  focusBox() {
    try { this.handle.focus(); } catch { /* a click closes it too */ }
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

  // Where a passage is in the session: its newest LIMITS.turnsSearch saved turns ("turn", with the
  // turn of the file that holds it), else its screen ("screen", `hc read`: it only reads, and is read
  // whether or not the agent works), else nowhere (null). working: the agent works now.
  async find(rec, cand) {
    let found = null, foundTurn = null;
    const sources = [];
    if (!rec.synthetic) {
      sources.push("saved turns");
      const dir = `${dataDir()}/turns/${rec.session_id}`;
      const names = (await fs.readdir(dir).catch(() => []))
        .map((n) => String(n).split("/").pop()).filter((n) => /^\d+\.md$/.test(n))
        .sort((a, b) => parseInt(b, 10) - parseInt(a, 10)).slice(0, LIMITS.turnsSearch);
      for (const n of names) {
        if (occursIn(await readTextFile(`${dir}/${n}`).catch(() => null), cand)) { found = "turn"; foundTurn = parseInt(n, 10); break; }
      }
    }
    const working = this.working(rec);
    if (!found && rec.terminal) {
      sources.push("screen");
      const r = await hc(["read", rec.terminal]).catch(() => null);
      if (r && r.code === 0 && occursIn(r.stdout, cand)) found = "screen";
    }
    return { found, foundTurn, working, sources };
  }

  // Checks the clipboard candidate against the target session's text (see the header). A question's
  // quote keeps the old rule: found in a saved turn, or on the screen while the agent works, and at
  // most LIMITS.quote characters. Where it was found is kept for ⌘S.
  // Runs in its own task (a click's cx must not be used after an await); park() and pin() await it.
  validate(cx) {
    const rec = this.target();
    if (!this.cand || !rec) return;
    this.quoteState = "checking";
    this.found = null; this.foundTurn = null; this.foundWorking = false;
    const cand = this.cand;
    let done;
    this.validation = new Promise((r) => { done = r; });
    cx.spawn(async (cx) => {
      try {
        const r = await this.find(rec, cand);
        if (this.target() !== rec) return;   // the person switched sessions meanwhile
        this.found = r.found; this.foundTurn = r.foundTurn; this.foundWorking = r.working;
        const attach = r.found === "turn" || (r.found === "screen" && r.working);
        if (this.long) {
          this.quoteState = "pinOnly";
          this.quoteNote = `${pinText(cand).length} characters: over the ${LIMITS.quote} a question's quote keeps, so Enter parks without it; ${PIN_KEY.label} pins it${r.found ? "" : " (not found in this session)"}.`;
        } else {
          this.quoteState = attach ? "ok" : "rejected";
          this.quoteNote = attach ? null
            : r.found === "screen" ? `Clipboard text is on this pane's screen but not in its saved turns: not attached. ${PIN_KEY.label} pins it.`
            : `Clipboard text is not in this session's ${r.sources.join(" or ") || "text"}: not attached. Paste a quote by hand if you want one.`;
        }
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
    if (this.off) { this.close(); return; }   // ledgr is off in this space: nothing is parked
    if (this.pinsMode) { this.parkPins(cx, btw); return; }
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

  // Pins mode, Enter (Pins.md 3.4): the question as today, without a quote, plus `pins` (the ids in the
  // order the panel gave). No text: nothing parks. ⌘Enter: nothing (/btw cannot carry pins).
  parkPins(cx, btw) {
    if (btw) { this.status = PIN_WORDS.noBtw; cx.notify(); return; }
    const text = squash(this.input.value()).slice(0, LIMITS.text);
    if (!text) { this.status = PIN_WORDS.needText; cx.notify(); return; }
    const rec = this.target();
    if (!rec) { this.status = this.pinsError ?? PIN_WORDS.noSession; cx.notify(); return; }
    const refused = pinsThenRefusal(rec, this.then, isLive);
    if (refused) { this.status = refused; cx.notify(); return; }
    this.saving = true;
    this.status = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const now = Date.now();
      const working = rec.state === "working";
      const id = newId("rq");
      const turn = Number(rec.turn) || 0;
      const pins = this.pins.map((x) => x.id);
      const request = {
        id, key: id, handle: null, direction: "human_to_agent", text, kind: "question",
        anchor: {
          sessionId: rec.session_id, turn, promptId: rec.prompt_id ?? null, uuid: working ? null : rec.last_assistant_uuid ?? null,
          hash: passageHash(text), settled: !working, capturedDuring: working ? "working" : "idle",
        },
        status: "open", parentId: this.parent ?? undefined, origin: "capture", terminal: rec.terminal ?? undefined,
        createdTurn: turn, createdAt: now, updatedAt: now, seq: 0, pins,
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
      setShared("ledgr.focus", { session: rec.session_id, item: id, pins: pins.length, then: this.then, at: now });
      this.close();
    });
  }

  // ⌘S (Pins.md 3.2): pin the copied passage (or the one typed in the quote field) with the box's line as
  // its note, as a `pin` spool event. pinning.js pinDraft decides what is pinned and its anchor; a refusal
  // stays in the box as its status line. Nothing is sent to any terminal (`hc read` only reads).
  pin(cx) {
    if (this.done || this.saving) return;
    if (this.off) { this.close(); return; }   // ledgr is off in this space: nothing is pinned
    if (this.pinsMode) { this.status = PIN_WORDS.alreadyPins; cx.notify(); return; }
    const rec = this.target();
    this.saving = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (this.validation) await this.validation.catch(() => {});
        const typed = pinText(this.quoteInput.value());
        const look = typed && rec ? await this.find(rec, typed) : { found: this.found, foundTurn: this.foundTurn };
        const now = Date.now();
        const draft = pinDraft({ cand: this.clip ?? "", typed, found: look.found, foundTurn: look.foundTurn,
          working: rec ? this.working(rec) : false, rec, confirm: this.pinConfirm, now, note: this.input.value(), hash: passageHash });
        if (draft.error) {
          this.status = draft.error;
          this.pinConfirm = draft.confirm ?? null;
          this.saving = false;
          cx.notify();
          return;
        }
        this.pinConfirm = null;
        const id = newId("pn");
        const turn = Number(rec.turn) || 0;
        await writeEvent("pin", { terminal: rec.terminal ?? null, session_id: rec.session_id, agent: rec.agent ?? null, turn,
          session_name: rec.session_name ?? null, cwd: rec.cwd ?? null, pin: { id, ...draft.pin } });
        try { localStorage.setItem("lastClip", this.clip ?? ""); } catch { /* no storage */ }
        setShared("ledgr.focus", { session: rec.session_id, pin: id, at: now });
        this.close();
      } catch (e) {
        this.saving = false;
        this.error = `Not saved: ${String(e?.message ?? e)}`;
        cx.notify();
      }
    });
  }

  command(c, cx) {
    if (c === "btw") this.park(cx, true);
    else if (c === "submit") this.park(cx, false);
    else if (c === PIN_KEY.command) this.pin(cx);
    else if (c === "escape") this.close();
    else if (c === "tab" || c === "backtab") {
      const next = this.field === "q" && this.showQuoteField() ? this.quoteInput : this.input;
      cx.timer.after(0, () => next.focus());
    }
  }

  showQuoteField() { return !this.pinsMode && !["ok", "checking", "pinOnly"].includes(this.quoteState); }

  // ledgr is off in this space: one status line, nothing to type, nothing parked.
  offBox(t, key) {
    return v_flex().id("ledgr-capture").track_focus(this.handle).cursor_pointer()
      .on_key_down((e, cx) => { if (e.key === "escape" || e.key === "enter") { this.close(); cx.stop_propagation(); } })
      .on_click(() => this.close())
      .size_full().min_h(0).px(20).py(18).gap(10).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().text_size(14).font_semibold().child(this.title()))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_size(12.5).text_color(t.muted).child(OFF_HERE))
      .child(div().text_size(11).text_color(t.dim).child("Nothing is parked. The ledgr panel's session menu (›) turns it on again for this space."))
      .child(div().flex_1())
      .child(h_flex().gap(12).items_center().child(key("Esc", "close")));
  }

  title() {
    if (this.pinsMode) return `Ask about ${this.pins.length} pin${this.pins.length === 1 ? "" : "s"}`;
    return this.parent ? "Ask about this" : "Park a question";
  }

  render() {
    const t = theme();
    const key = (k, what) => h_flex().gap(4).items_center()
      .child(div().px(5).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.muted).child(k))
      .child(div().text_size(11).text_color(t.dim).child(what));
    if (this.off) return this.offBox(t, key);
    const rec = this.target();
    const label = rec
      ? `${rec.session_name || rec.repo || "unnamed"} · ${paneWords(rec.terminal, "no pane")} · turn ${rec.turn ?? 0}${this.working(rec) ? " (working)" : ""}`
      : this.loaded ? "no session" : "…";
    const ok = this.quoteState === "ok";
    const pinOnly = this.quoteState === "pinOnly";
    const quoteRow = this.cand && (ok || pinOnly || this.quoteState === "checking")
      ? h_flex().id("cap-quote").gap(8).items_start().cursor_pointer()
        .on_click((_e, cx) => { if (ok) { this.useQuote = !this.useQuote; cx.notify(); } })
        .child(div().flex_none().size(14).mt(1).rounded(3).border_1().border_color(ok && this.useQuote ? t.accent : t.input)
          .bg(ok && this.useQuote ? t.accent : t.background).text_size(10).text_color(t.accent_foreground).flex().items_center().justify_center()
          .child(ok && this.useQuote ? "✓" : ""))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ok ? "Quote (from clipboard)" : pinOnly ? `Pin only (${PIN_KEY.label})` : "Checking quote…"))
        .child(div().flex_1().min_w(0).max_h(48).overflow_hidden().text_size(11.5).italic().text_color(ok && this.useQuote ? t.foreground : t.dim)
          .child(`“${squash(this.cand).slice(0, 220)}”`))
      : null;
    const labels = this.pinsMode ? pinLabels(this.pins) : [];
    const note = this.status ?? (this.pinsMode ? null : this.quoteNote);
    return v_flex().id("ledgr-capture").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(); cx.stop_propagation(); } })
      .size_full().min_h(0).px(20).py(18).gap(10).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().text_size(14).font_semibold().child(this.title()))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(label))
        .when(Boolean(rec), (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).child(agentLabel(rec.agent, rec.profile))))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().h(34).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .when(labels.length > 0, (el) => el.child(v_flex().id("cap-pins").gap(3).children(labels.map((l) =>
        div().truncate().text_size(11).text_color(t.muted).child(l)))))
      .when(Boolean(quoteRow) && !this.pinsMode, (el) => el.child(quoteRow))
      .when(this.showQuoteField(), (el) => el.child(h_flex().h(28).flex_none().px(10).items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(this.quoteInput).flex_1().h_full().text_size(11.5).italic().text_color(t.foreground))))
      .when(Boolean(note), (el) => el.child(div().text_size(10.5).text_color(this.status ? t.foreground : t.dim).child(note)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().gap(12).items_center()
        .child(key("Enter", this.saving ? "saving…" : "park"))
        .when(!this.pinsMode, (el) => el.child(key("⌘Enter", "park + /btw")).child(key(PIN_KEY.label, "pin")))
        .child(key("Esc", "cancel"))
        .child(div().flex_1())
        .when(this.records.length > 1, (el) => el.child(div().id("cap-session").px(6).py(1).rounded(5).cursor_pointer()
          .text_size(11).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => {
            this.at = (this.at + 1) % this.records.length;
            if (this.pinsMode) this.status = pinsThenRefusal(this.target(), this.then, isLive);   // a session the person chose
            this.validate(cx); cx.notify(); this.input.focus();
          })
          .child(`session: ${rec?.session_name || rec?.repo || paneWords(rec?.terminal, "?")} ↻ ${this.at + 1}/${this.records.length}`))));
  }
}
