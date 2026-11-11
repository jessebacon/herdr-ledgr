// ledgr detail dialog, its renderers (docs/design/Detail.md 2.9): what an expanded panel row drew before
// the list and detail change, moved out of panel.js and drawn by the dialog (detail.js). Each takes the
// dialog instance as `host` for its state and actions:
//   state:   demo, cfg, flash, answer (the answer InputState), note ({pinId, input}), confirm, conclude,
//            closeAsk, gitOk, brMsg, preOpen, pinDel, dd, ddShut, ddFocus
//   actions: act, setDraft, copyAnswer, copyAnswers, launch, openConclude, sendToTrunk, copyConfluence,
//            askForConclusion, closeBranch, focusBranch, trunkWord, trunkLine, branchLive, pasteOn,
//            confirmManifest, canConclude, retarget (and answerOf, forgetConclude)
// The meanings a row and a sub-row share (the glyph, the state word, the pill) come from listing.js; the
// list keeps its own atoms (btn, pill, menuButton exist twice this round, Detail.md 7). Reading text is a
// selectable TextView (readable): markdown as written, or the person's and pinned text escaped so it
// shows exactly as stored (detailing.js mdVerbatim). Markdown takes link clicks (2026-11-10): a web link
// opens in the browser; given the dialog's handler (o.onLink), file paths become links too (links.js
// linkify) and every click goes to it (detail.js openLink). Not an engine file.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, Textarea, TextView, Popup } from "gpui-base";
import { isClosed } from "./store.js";
import { manifestLines } from "./branch.js";
import { confluenceMessage, extractConclusion, forkTurnOf, wrapperWords } from "./confluence.js";
import { itemWords as H, paneWords as P, trunkWords, branchWords, stageLabels } from "./words.js";
import { glyphOf, rowModel, BR_WORD } from "./listing.js";
import { passageParts, mdVerbatim, hardBreaks } from "./detailing.js";
import { linkify, parseLink } from "./links.js";

export const ICON = (n) => `mods/workspace-chrome/${n}.svg`;
// The indent under a row's head line (the status glyph's width plus its gap).
export const IND = 18;
// Reading text is selectable, not scrollable (Detail.md 2.2, decided 2026-11-10): the dialog's columns
// scroll, and a scroll area nested in one may swallow the wheel. true would make each TextView scroll.
export const TEXT_SCROLLABLE = false;
// A branch's live word in the dialog's status line where the list's one-line word (listing.js BR_WORD)
// leaves out the hint.
const BR_LONG = { nostart: "did not start (see its terminal's error toast)" };

// A theme colour by its name (listing.js tones are theme() names), a colour as given, else dim.
export const tone = (t, name) => t[name] ?? (typeof name === "string" && name.startsWith("#") ? name : t.dim);

export function btn(t, id, label, onClick, o = {}) {
  const off = Boolean(o.disabled);
  return div().id(id).flex_none().h(t.ts(22)).px(7).flex().items_center().rounded(6).border_1()
    .border_color(o.primary && !off ? t.solid : t.border).bg(o.primary && !off ? t.solid : t.background)
    .text_size(t.ts(11)).text_color(o.primary && !off ? t.solid_foreground : off ? t.dim : t.foreground)
    .when(off, (el) => el.opacity(0.5))
    .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
    .when(!off, (el) => el.cursor_pointer().hover((x) => x.opacity(0.85)).on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); }))
    .child(label);
}

// One choice of a row of choices (the settings dialog's): the chosen one in accent; a click on it or on
// another runs onClick. o.tip, o.disabled.
export function segment(t, id, label, on, onClick, o = {}) {
  const off = Boolean(o.disabled);
  return div().id(id).flex_none().h(t.ts(22)).px(8).flex().items_center().rounded(6).border_1()
    .border_color(on ? t.accent : t.border).bg(on ? t.accent + "1f" : t.background).text_size(t.ts(11))
    .text_color(on ? t.accent : off ? t.dim : t.foreground).when(on, (el) => el.font_semibold())
    .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
    .when(off, (el) => el.opacity(0.5))
    .when(!off, (el) => el.cursor_pointer().hover((x) => x.bg(t.hover)).on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); }))
    .child(label);
}

export function pill(t, text, color) {
  return div().flex_none().px(5).py(0.5).rounded(4).border_1().border_color(t.border).text_size(t.ts(10)).text_color(color ?? t.muted).child(text);
}

export function badge(t, text, color) {
  return div().flex_none().px(5).rounded(4).bg(color + "22").text_size(t.ts(10)).text_color(color).child(text);
}

// An item's status glyph (listing.js glyphOf: [char, tone]).
export function glyph(t, it, sug = false) {
  const [ch, tn] = glyphOf(it, sug);
  return div().w(t.ts(12)).flex_none().text_size(t.ts(11)).text_color(tone(t, tn)).child(ch);
}

// A small quiet button beside a section title or the message head ("Copy", "whole").
export function chip(t, id, label, onClick, o = {}) {
  return div().id(id).flex_none().px(5).rounded(4).border_1().border_color(o.on ? t.accent : t.border).text_size(t.ts(10))
    .text_color(o.on ? t.accent : t.muted).cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground))
    .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
    .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); }).child(label);
}

// A small menu under a trigger: gpui-base's Popup. One open at a time (host.dd); a choice, a press
// outside or Esc closes it. Items are [id, label, fn, {tip, disabled, danger, hint}]; o.small draws a
// quiet trigger; o.anchor the corner of the list pinned to the trigger ("bottom_left" opens upward,
// as the dialog's footer wants).
export function menuButton(host, t, key, label, items, o = {}) {
  const open = host.dd === key;
  const trigger = div().id(`ddt-${key}`).flex_none().flex().items_center().rounded(o.small ? 5 : 6).cursor_pointer()
    .when(o.small, (el) => el.h(t.ts(18)).px(5).text_size(t.ts(10.5)).text_color(open ? t.foreground : t.dim).hover((x) => x.bg(t.hover).text_color(t.foreground)))
    .when(!o.small, (el) => el.h(t.ts(22)).px(7).border_1().border_color(open ? t.accent : t.border).bg(t.background).text_size(t.ts(11)).text_color(t.foreground).hover((x) => x.opacity(0.85)))
    .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      const justShut = host.ddShut?.key === key && Date.now() - host.ddShut.at < 300;
      host.dd = open || justShut ? null : key;
      host.ddShut = null;
      if (host.dd) cx.timer.after(30, () => { try { host.ddFocus.focus(); } catch { /* no keyboard: clicks still work */ } });
      cx.notify();
    })
    .child(label);
  const list = v_flex().id(`ddl-${key}`).min_w(o.width ?? 190).p(4).gap(1).rounded(8).border_1().border_color(t.border).bg(t.popover ?? t.surface).shadow_md()
    .text_color(t.foreground)
    .track_focus(host.ddFocus)
    .on_key_down((e, cx) => { if ((e.keystroke ?? e.key) === "escape") { host.dd = null; cx.stop_propagation(); cx.notify(); } })
    .on_mouse_down_out((_e, cx) => { if (host.dd === key) { host.dd = null; host.ddShut = { key, at: Date.now() }; cx.notify(); } })
    .children(items.filter(Boolean).map(([id, text, fn, io = {}]) => h_flex().id(`ddi-${key}-${id}`).h(t.ts(26)).px(8).gap(8).items_center().rounded(5).text_size(t.ts(11.5))
      .text_color(io.disabled ? t.dim : io.danger ? t.blocked : t.foreground)
      .when(Boolean(io.tip), (el) => el.tooltip(io.tip))
      .when(!io.disabled, (el) => el.cursor_pointer().hover((x) => x.bg(t.hover))
        .on_click((e, cx) => { cx.stop_propagation(); host.dd = null; fn(e, cx); cx.notify(); }))
      .child(div().flex_1().min_w(0).child(text))
      .when(Boolean(io.hint), (el) => el.child(div().flex_none().text_size(t.ts(10.5)).text_color(t.dim).child(io.hint)))));
  return Popup.new(`ddp-${key}`, trigger).anchor(o.anchor ?? "top_left").when(open, (el) => el.content(list));
}

// A link clicked in markdown that has no handler of the dialog's: a web link opens in the browser
// (cx.open_url takes http and https only); anything else opens nothing.
export function webOnly(url, cx) {
  const l = parseLink(url);
  if (l.kind === "web") { try { cx.open_url(l.url); } catch { /* refused: nothing opens */ } }
}

// Text to read and select: a TextView (markdown) in a div that sets its size and colour. o.mode
// "verbatim" shows the text exactly as stored (the person's words, a pin, an answer, a conclusion: no
// links); else markdown as written with its single line breaks kept, its links clickable: with o.onLink
// (url, cx) (the dialog's openLink) file paths are links too (links.js linkify) and every click goes to it,
// else a web link alone opens (webOnly). o.italic, o.muted, o.dim, o.size. The id is stable per item and
// block, so a selection survives the re-render a store change causes.
export function readable(t, id, text, o = {}) {
  const verbatim = o.mode === "verbatim", links = !verbatim && typeof o.onLink === "function";
  const md = verbatim ? mdVerbatim(text) : hardBreaks(links ? linkify(text) : text);
  let tv = TextView.markdown(id, md).selectable(true);
  if (!verbatim) tv = tv.on_link_click((url, cx) => (links ? o.onLink(url, cx) : webOnly(url, cx)));
  return div().id(`${id}-box`).w_full().min_w(0).text_size(t.ts(o.size ?? 12.5))
    .text_color(o.muted ? t.muted : o.dim ? t.dim : t.foreground)
    .when(Boolean(o.italic), (el) => el.italic())
    .child(TEXT_SCROLLABLE ? tv.scrollable(true) : tv);
}

// A left-column section: its title (with o.extra at the right: a Copy chip, say), then its body (one
// element or a list).
export function section(t, id, title, body, o = {}) {
  const kids = (Array.isArray(body) ? body : [body]).filter(Boolean);
  return v_flex().id(id).flex_none().gap(5)
    .child(h_flex().gap(6).items_center()
      .child(div().flex_1().min_w(0).text_size(t.ts(10.5)).font_semibold().text_color(o.tone ?? t.dim).child(title))
      .children((Array.isArray(o.extra) ? o.extra : [o.extra]).filter(Boolean)))
    .children(kids);
}

// Text with line breaks, one div per line (a plain div does not break at "\n"; nothing to select).
export function lines(text) {
  return String(text ?? "").split(/\r?\n/).map((l) => div().child(l || " "));
}

// The message as three blocks, before (muted), the passage (an accent edge and tint) and after (muted),
// each a direct child of the message column so the passage can be scrolled into view
// (ScrollHandle.scroll_to_item). The array's `hitAt` is the passage block's index in it (-1: none). onLink:
// the dialog's link handler (readable), so the message's paths and web links open on a click.
export function messageBlocks(t, id, text, quote, { whole = false, onLink = null } = {}) {
  const { before, hit, after } = passageParts(String(text ?? ""), quote, whole);
  const out = [];
  if (before) out.push(div().id(`dt-msg-bw-${id}`).flex_none().child(readable(t, `dt-msg-b-${id}`, before, { muted: true, onLink })));
  out.hitAt = -1;
  if (hit) {
    out.hitAt = out.length;
    out.push(div().id(`dt-msg-hw-${id}`).flex_none().pl(7).py(2).border_l(2).border_color(t.accent).bg(t.accent + "14").rounded(3)
      .child(readable(t, `dt-msg-h-${id}`, hit, { onLink })));
  }
  if (after) out.push(div().id(`dt-msg-aw-${id}`).flex_none().child(readable(t, `dt-msg-a-${id}`, after, { muted: true, onLink })));
  return out;
}

// A branch's manifest: what it knows and does not know (branch.js manifestLines).
export function manifestView(t, m, frozen = false) {
  if (!m) return div().text_size(t.ts(11)).text_color(t.dim).child("No manifest recorded (started outside the panel).");
  return v_flex().gap(3).children(manifestLines(m, { frozen }).map(([k, v]) => h_flex().gap(6).items_start()
    .child(div().w(66).flex_none().text_size(t.ts(10.5)).text_color(t.dim).child(k))
    .child(div().flex_1().min_w(0).text_size(t.ts(11.5)).text_color(k === "Refused" ? t.blocked : t.foreground).child(v))));
}

// A decide's options: a wrapped set of buttons; the chosen one (the draft) in accent, "(rec.)" on the
// recommended one. A click makes it the answer (host.setDraft).
export function optionChips(host, t, it) {
  const closed = isClosed(it);
  return h_flex().id(`dt-opts-${it.id}`).flex_wrap().gap(6).children((it.options ?? []).map((o, i) => {
    const chosen = String(it.draft ?? "").trim() === o;
    return div().id(`dt-opt-${it.id}-${i}`).min_w(0).px(8).py(2).rounded(6).border_1().border_color(chosen ? t.accent : t.border)
      .text_size(t.ts(11.5)).text_color(chosen ? t.accent : t.muted).when(!closed, (d) => d.cursor_pointer().hover((x) => x.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); host.setDraft(it, o, cx); }))
      .child(o === it.recommended ? `${o} (rec.)` : o);
  }));
}

// The answer: the Answer… input (host.answer, an InputState: Enter stages the turn's answer sheet),
// Paste answer (this ask's answer alone) and how it reaches the agent.
export function answerBox(host, t, st, s, it) {
  const paste = host.pasteOn(), L = stageLabels(paste), ans = host.answerOf(it);
  return v_flex().id(`dt-answer-${it.id}`).gap(4)
    .child(h_flex().gap(6).items_center()
      .child(h_flex().flex_1().min_w(0).h(t.ts(30)).px(8).items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
        .when(Boolean(host.answer), (el) => el.child(Input.new(host.answer).flex_1().h_full().text_size(t.ts(12.5)).text_color(t.foreground))))
      .child(btn(t, `dt-copy1-${it.id}`, L.one, (_e, cx) => host.copyAnswer(it, s, cx),
        { primary: Boolean(ans), disabled: !ans, tip: ans ? `${H(it)}'s answer alone: ${paste ? `pasted into the prompt in ${P(s?.terminal, "the pane")}, never sent` : `clipboard + focus ${P(s?.terminal, "the pane")}`}` : "Type an answer or pick an option first" })))
    .child(div().text_size(t.ts(10.5)).text_color(t.dim)
      .child(`Enter ${paste ? "pastes" : "copies"} the answers for turn ${it.anchor?.turn ?? "?"}; drafts reach the agent only that way, and Done only records it here.`));
}

// The Branch confirmation: the manifest BEFORE launch, the placement, the worktree toggle.
export function confirmBox(host, t, st, s, it) {
  const m = host.confirmManifest(st, it, s);
  const c = host.confirm;
  const git = host.demo ? true : host.gitOk.get(s.cwd);
  const seg = (id, label, on, fn, o = {}) => div().id(id).flex_none().h(t.ts(22)).px(7).flex().items_center().rounded(6).border_1()
    .border_color(on ? t.accent : t.border).bg(on ? t.accent + "1f" : t.background).text_size(t.ts(11))
    .text_color(on ? t.accent : o.disabled ? t.dim : t.foreground)
    .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
    .when(Boolean(o.disabled), (el) => el.opacity(0.5))
    .when(!o.disabled, (el) => el.cursor_pointer().hover((x) => x.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); fn(); cx.notify(); }))
    .child(label);
  return v_flex().id(`brc-${it.id}`).gap(8).p(8).rounded(7).border_1().border_color(m.refused ? t.blocked : t.accent).bg(t.background)
    .child(h_flex().gap(6).items_center()
      .child(svg(ICON("git-branch")).size(12).flex_none().text_color(m.refused ? t.blocked : t.accent))
      .child(div().flex_1().min_w(0).font_semibold().text_size(t.ts(12)).child(`Branch ${H(it)}: what the branch will know`)))
    .child(manifestView(t, m))
    .child(h_flex().flex_wrap().gap(6).items_center()
      .child(seg(`brc-split-${it.id}`, m.parentDepth ? "beside its parent" : "beside the trunk", !c.isolate && c.placement === "split", () => { c.placement = "split"; c.isolate = false; },
        { tip: "A sub-agent of the parent's terminal, given a pane right of it" }))
      .child(seg(`brc-agent-${it.id}`, "sub-agent only", !c.isolate && c.placement === "agent", () => { c.placement = "agent"; c.isolate = false; },
        { tip: "No pane: peek it from the agents list (peek's keep gives it one)" }))
      .child(seg(`brc-wt-${it.id}`, "isolate in a worktree", Boolean(c.isolate), () => { c.isolate = !c.isolate; },
        { disabled: git !== true, tip: git === true ? "Herdr's worktree: a new checkout from HEAD in a new space; the agents tree will not nest it under the trunk" : git === false ? "The trunk's folder is not a git checkout" : "Checking for git…" })))
    .child(h_flex().flex_wrap().gap(6).items_center()
      .child(btn(t, `brc-go-${it.id}`, "Launch branch", (_e, cx) => host.launch(it, s, cx), { primary: true, disabled: Boolean(m.refused) }))
      .child(btn(t, `brc-x-${it.id}`, "Cancel", (_e, cx) => { host.confirm = null; cx.notify(); })))
    .child(div().text_size(t.ts(10.5)).text_color(t.dim).child("starts one process, claude --resume … --fork-session; nothing is typed into the trunk"));
}

// A concluded (staged) or rejoined branch: the conclusion as sent, and where it stands. s: the trunk.
export function confluenceView(host, t, st, s, br) {
  const it = st.item(br.requestId);
  const rejoined = br.status === "rejoined";
  const when = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
  return v_flex().id(`dt-confl-${br.id}`).gap(4)
    .child(div().text_size(t.ts(10.5)).font_semibold().text_color(rejoined ? t.done : t.accent).child(rejoined
      ? `REJOINED · landed in ${trunkWords(s?.terminal)} at turn ${br.rejoinedTurn ?? "?"} (${when(br.rejoinedAt)})`
      : `CONFLUENCE STAGED ${when(br.concludedAt)} · waiting for the paste`))
    .child(div().rounded(5).border_1().border_color(rejoined ? t.done : t.accent).bg(t.background).px(7).py(4)
      .child(readable(t, `dt-confl-text-${br.id}`, br.conclusion?.text ?? "(no conclusion text recorded)", { mode: "verbatim", size: 12 })))
    .when(!rejoined, (x) => x.child(div().text_size(t.ts(10.5)).text_color(host.trunkWord(s) === "working" ? t.working : t.dim).child(host.trunkLine(s, it, true))))
    .when(rejoined, (x) => x.child(div().text_size(t.ts(10.5)).text_color(t.dim).child(
      `${it ? H(it) : "The question"} resolved by this branch · line in ledgr-data/sessions/${String(s?.sessionId ?? "").slice(0, 8)}…/decisions.md${br.closedAt ? ` · terminal closed ${when(br.closedAt)}` : ""}`)))
    .when(Boolean(br.closeError), (x) => x.child(div().text_size(t.ts(10.5)).text_color(t.blocked).child(`Close failed: ${br.closeError}`)));
}

// The Conclude editor: the prefilled, editable conclusion; the message as it will be staged; the trunk's
// live status. Paste into trunk pastes after the focus is confirmed, or copies; it never presses Enter.
// s: the trunk. The editor's state is host.conclude (made in a handler, never here).
export function concludeBox(host, t, st, s, br) {
  const k = host.conclude, it = st.item(br.requestId), L = stageLabels(host.pasteOn());
  const F = forkTurnOf(br);
  const text = String(k.text ?? "").trim();
  const msg = it ? confluenceMessage({ branch: br, item: it, text: text || "…", pins: st.branchPins(br) }) : "";
  const src = k.source === "loading" ? "Reading the branch's messages…"
    : k.source === "block" ? `Prefilled from the branch's ledgr-conclusion block (its turn ${k.turn}). Edit freely.`
    : k.source === "pins" ? `No ledgr-conclusion block: one entry per pinned passage, each to clarify${k.turn ? `; the branch's last reply (its turn ${k.turn}) is below it to draw from` : ""}. Edit freely.`
    : k.source === "last" ? `No ledgr-conclusion block: prefilled with the branch's last message (its turn ${k.turn}). Trim it, or ask the branch for a conclusion.`
    : k.source === "edited" ? "Your earlier edit (kept while the dialog was closed, or the confluence was called off)."
    : "The branch has not answered yet: write the conclusion yourself, or ask the branch for one.";
  const moved = s && s.turn > F ? `The trunk is at turn ${s.turn}; the branch saw it up to turn ${F}. Check the conclusion against turns ${F + 1}–${s.turn}: the message tells the trunk what the branch saw.` : null;
  const ask = k.source !== "block" && k.source !== "loading" && Boolean(br.terminal) && !["closed", "ended", "nostart"].includes(host.branchLive(br));
  return v_flex().id(`brk-box-${br.id}`).gap(8).p(8).rounded(7).border_1().border_color(t.accent).bg(t.background)
    .child(h_flex().gap(6).items_center()
      .child(svg(ICON("git-branch")).size(12).flex_none().text_color(t.accent))
      .child(div().flex_1().min_w(0).font_semibold().text_size(t.ts(12)).child(`Conclude the ${branchWords(it)}: what goes back to ${trunkWords(s?.terminal)}`)))
    .child(div().text_size(t.ts(10.5)).text_color(t.dim).child(src))
    .child(v_flex().rounded(7).border_1().border_color(t.input).bg(t.background).px(6).py(4)
      .child(Textarea.new(k.input).w_full().text_size(t.ts(12)).text_color(t.foreground)))
    .when(Boolean(moved), (el) => el.child(div().text_size(t.ts(10.5)).text_color(t.blocked).child(moved)))
    .child(div().text_size(t.ts(10.5)).font_semibold().text_color(t.dim).child(`THE MESSAGE · ${wrapperWords(msg, text || "…")} words around your text; no transcript`))
    .child(div().id(`brk-msg-${br.id}`).rounded(5).border_1().border_color(t.border).bg(t.surface).px(7).py(4)
      .child(readable(t, `dt-brk-msg-${br.id}`, msg, { mode: "verbatim", muted: true, size: 11 })))
    .child(div().text_size(t.ts(10.5)).text_color(host.trunkWord(s) === "working" ? t.working : t.dim).child(host.trunkLine(s, it)))
    .child(h_flex().flex_wrap().gap(6).items_center()
      .child(btn(t, `brk-send-${br.id}`, L.send, (_e, cx) => host.sendToTrunk(st, br, cx),
        { primary: true, disabled: !text || !it, tip: host.pasteOn() ? "Pastes the message into the trunk's prompt once its pane has the focus; never sent. The question resolves when you send it there." : "Clipboard + focus the trunk's pane; nothing is typed. The question resolves when you send it there." }))
      .when(ask, (el) => el.child(btn(t, `brk-ask-${br.id}`, "Ask for a conclusion", (_e, cx) => host.askForConclusion(st, br, cx))))
      .when(k.edited && k.source !== "edited" && Boolean(k.prefill), (el) => el.child(btn(t, `brk-reset-${br.id}`, "Reset",
        (_e, cx) => { k.input.set_value(k.prefill); k.text = k.prefill; k.edited = false; cx.notify(); })))
      .child(btn(t, `brk-x-${br.id}`, "Cancel", (_e, cx) => { host.forgetConclude?.(br.id); host.conclude = null; cx.notify(); })));
}

// What a sub-row needs from listing.js rowModel: the threshold, the clock, the session shown, the store,
// and the branches' live words.
export const rowCtx = (host, st, here) => ({ threshold: st.threshold, now: Date.now(), here: here ?? null, store: st, branchLive: (b) => host.branchLive(b) });

// One line from a rowModel (listing.js): its glyph ([char, tone, icon]: the icon, "pin", "git-branch" or
// "spinner", drawn instead of the char), handle, pill, the text's first line, the state word. A click
// opens it in this dialog (onOpen(cx): host.retarget).
export function subRow(t, m, onOpen) {
  const g = Array.isArray(m.glyph) ? m.glyph : null;
  const icon = g?.[2] ?? (m.kind === "pin" ? "pin" : m.kind === "branch" ? "git-branch" : null);
  const color = g ? tone(t, g[1]) : t.accent;
  return h_flex().id(`dt-sub-${m.key ?? m.id}`).flex_none().h(t.ts(26)).px(6).gap(6).items_center().rounded(6).cursor_pointer()
    .hover((x) => x.bg(t.hover)).tooltip(m.tip || "Open it in this dialog")
    .on_click((_e, cx) => { cx.stop_propagation(); onOpen(cx); })
    .child(div().w(t.ts(12)).flex_none().flex().items_center().text_size(t.ts(11)).text_color(color)
      .child(icon ? svg(ICON(icon)).size(11).text_color(color).when(icon === "spinner", (x) => x.spin(900)) : g ? g[0] : "·"))
    .child(div().flex_none().font_semibold().text_size(t.ts(11.5)).text_color(t.muted).child(m.handle ?? ""))
    .when(Boolean(m.pill?.text), (el) => el.child(div().flex_none().px(5).rounded(4).bg(tone(t, m.pill.tone) + "22").text_size(t.ts(10)).text_color(tone(t, m.pill.tone)).child(m.pill.text)))
    .child(div().flex_1().min_w(0).truncate().text_size(t.ts(12)).text_color(t.foreground).child(m.text ?? ""))
    .when(Boolean(m.state?.word), (el) => el.child(div().flex_none().text_size(t.ts(10.5)).text_color(tone(t, m.state.tone)).child(m.state.word)));
}

// A branch's left-column sections (from the open branch row): its status and facts, errors, the
// question it settles, the manifest, what was asked in it (sub-rows), the confluence once staged, its
// ledgr-conclusion block, the Conclude editor, the preamble. Its last message is the right column.
// s: the trunk. Returns a list (the column's direct children).
export function branchBody(host, t, st, s, br) {
  const live = host.branchLive(br);
  const child = br.sessionId ? st.d.sessions[br.sessionId] ?? null : null;
  const it = st.item(br.requestId);
  const kids = child ? st.itemsOf(child.sessionId).filter((x) => !isClosed(x)) : [];
  const msg = host.brMsg?.get(br.id);
  const concl = msg?.text ? extractConclusion(msg.text) : null;
  const staged = br.status === "concluded" || br.status === "rejoined";
  const color = { working: t.working, blocked: t.blocked, done: t.done, failed: t.blocked, nostart: t.blocked, refused: t.dim, closed: t.dim, ended: t.dim }[live] ?? t.muted;
  const when = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null);
  const facts = [
    child ? `session ${child.sessionId.slice(0, 8)}${child.turn ? ` · its turn ${child.turn}` : ""}` : br.childSid ? `session ${br.childSid.slice(0, 8)} (planned)` : null,
    br.terminal ? P(br.terminal) : null,
    br.placement === "split" ? "pane beside the trunk" : br.placement === "agent" ? "sub-agent" : null,
    br.isolate ? "own worktree" : null,
    when(br.startedAt ?? br.launchedAt ?? br.createdAt) ? `started ${when(br.startedAt ?? br.launchedAt ?? br.createdAt)}` : null,
    br.external ? "launched outside the panel" : null,
  ].filter(Boolean).join(" · ");
  const ctx = rowCtx(host, st, s?.sessionId);
  const out = [];
  out.push(v_flex().id(`dt-brstat-${br.id}`).flex_none().gap(3)
    .child(div().text_size(t.ts(12)).text_color(color)
      .child(`depth ${br.depth ?? "?"} · ${BR_LONG[live] ?? BR_WORD[live] ?? live ?? "?"}${br.status === "rejoined" && live !== "rejoined" ? ` · rejoined at turn ${br.rejoinedTurn ?? "?"}` : br.status === "concluded" && live !== "concluded" ? " · concluded" : ""}`))
    .when(Boolean(facts), (x) => x.child(div().text_size(t.ts(10.5)).text_color(t.dim).child(facts))));
  if (br.error) out.push(div().text_size(t.ts(11)).text_color(br.status === "refused" ? t.dim : t.blocked).child(`${br.status === "refused" ? "Refused" : "Not started"}: ${br.error}`));
  if (it) out.push(section(t, `dt-sec-q-${br.id}`, "QUESTION", subRow(t, rowModel("question", it, ctx), (cx) => host.retarget("question", it.id, s?.sessionId ?? null, cx))));
  out.push(section(t, `dt-sec-man-${br.id}`, "MANIFEST", manifestView(t, br.manifest, true)));
  if (kids.length) out.push(section(t, `dt-sec-kids-${br.id}`, "ASKED IN THIS BRANCH", kids.map((k) =>
    subRow(t, rowModel(k.direction === "agent_to_human" ? "ask" : "question", k, rowCtx(host, st, child.sessionId)), (cx) => host.retarget(k.direction === "agent_to_human" ? "ask" : "question", k.id, child.sessionId, cx)))));
  if (staged) out.push(confluenceView(host, t, st, s, br));
  if (!staged && concl) out.push(section(t, `dt-sec-concl-${br.id}`, `CONCLUSION (its turn ${msg.turn}; Conclude… carries it back)`,
    div().rounded(5).border_1().border_color(t.border).bg(t.background).px(7).py(4).child(readable(t, `dt-concl-${br.id}`, concl, { mode: "verbatim", size: 12 }))));
  if (host.conclude?.branchId === br.id) out.push(concludeBox(host, t, st, s, br));
  if (host.preOpen.has(br.id) && br.preamble) out.push(section(t, `dt-sec-pre-${br.id}`, "PREAMBLE",
    div().rounded(5).border_1().border_color(t.border).bg(t.background).px(7).py(4).child(readable(t, `dt-pre-${br.id}`, br.preamble, { muted: true, size: 11.5 }))));
  return out;
}

// A branch's buttons: the one primary step (Conclude… / Edit conclusion…, or Close branch after rejoin,
// with its End / Keep) and ⋯ for Focus, the confluence again, Ask for a conclusion and the preamble.
// o: {canC, concl, staged, focusOk, live, it}; o.anchor the ⋯ menu's corner.
export function branchActions(host, t, st, s, br, o) {
  const { canC, concl, staged, focusOk, it } = o;
  const more = [], L = stageLabels(host.pasteOn());
  more.push(["focus", "Focus the branch", (_e, cx) => host.focusBranch(br, cx),
    { disabled: !focusOk, tip: focusOk ? "Focus the branch's pane (a peek when it has none)" : "The branch has no live terminal" }]);
  if (br.status === "concluded" && br.conclusion?.message) more.push(["again", L.againMenu, (_e, cx) => host.copyConfluence(st, br, cx),
    { tip: host.pasteOn() ? "The staged message into the trunk's prompt again (never sent)" : "The staged message to the clipboard again, and focus the trunk" }]);
  if (canC && !concl && !staged && focusOk && host.conclude?.branchId !== br.id) more.push(["ask", "Ask for a conclusion", (_e, cx) => host.askForConclusion(st, br, cx),
    { tip: "Stage a short request for a ledgr-conclusion block in the branch's pane" }]);
  if (!canC && br.status !== "rejoined") more.push(["conclude", "Conclude…", () => {}, { disabled: true,
    tip: it && isClosed(it) ? `${H(it)} is ${it.status}: nothing to carry back` : "The branch has not started" }]);
  if (br.preamble) more.push(["pre", host.preOpen.has(br.id) ? "Hide the preamble" : "Show the preamble",
    (_e, cx) => { if (host.preOpen.has(br.id)) host.preOpen.delete(br.id); else host.preOpen.add(br.id); cx.notify(); }]);
  return h_flex().flex_wrap().gap(6).items_center()
    .when(canC && host.conclude?.branchId !== br.id, (x) => x.child(btn(t, `brk-${br.id}`, br.status === "concluded" ? "Edit conclusion…" : "Conclude…",
      (_e, cx) => host.openConclude(st, br, cx), { primary: br.status !== "concluded" && Boolean(concl), tip: "Edit what goes back to the trunk, then stage it for the trunk's prompt" })))
    .when(br.status === "rejoined" && !br.closedAt && host.closeAsk !== br.id && o.live !== "closed", (x) => x.child(btn(t, `brx-${br.id}`, "Close branch",
      (_e, cx) => { host.closeAsk = br.id; cx.notify(); }, { tip: "End the branch's terminal; its record and conclusion stay" })))
    .when(host.closeAsk === br.id, (x) => x
      .child(div().id(`brxy-${br.id}`).flex_none().h(t.ts(22)).px(7).flex().items_center().rounded(6).bg(t.blocked + "26").text_size(t.ts(11)).text_color(t.blocked).cursor_pointer()
        .on_click((_e, cx) => { cx.stop_propagation(); host.closeBranch(br, cx); }).child(`End ${P(br.terminal, br.name)}`))
      .child(btn(t, `brxn-${br.id}`, "Keep", (_e, cx) => { host.closeAsk = null; cx.notify(); })))
    .child(menuButton(host, t, `brmore-${br.id}`, "⋯", more, { anchor: o.anchor ?? "bottom_right", tip: "More actions" }));
}

// The pin note editor (host.note = {pinId, input}: made in a click, never here): Enter saves, Esc
// discards. null when this pin's note is not being edited.
export function pinNoteBox(host, t, p) {
  const k = host.note?.pinId === p.id ? host.note : null;
  if (!k) return null;
  return h_flex().id(`pinn-${p.id}`).h(t.ts(28)).px(8).items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
    .on_key_down((e, cx) => { if ((e.keystroke ?? e.key) === "escape" && host.note === k) { host.note = null; cx.notify(); } })
    .child(Input.new(k.input).flex_1().h_full().text_size(t.ts(12)).text_color(t.foreground));
}

// Key hints, as the capture box draws them: [key, what] pairs.
export function keyHints(t, hints) {
  return h_flex().flex_none().gap(12).items_center().children(hints.map(([k, what]) => h_flex().gap(4).items_center()
    .child(div().px(5).rounded(4).border_1().border_color(t.border).text_size(t.ts(10.5)).text_color(t.muted).child(k))
    .child(div().text_size(t.ts(11)).text_color(t.dim).child(what))));
}
