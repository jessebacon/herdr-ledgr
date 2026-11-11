# ledgr list and detail dialog: design specification

Date: 2026-11-10. Status: built the same day (see Section 11 of the design doc for departures). Written against the repo at commit 4433d65 (pins
committed). Line numbers are as read on 2026-11-10. Builds on `Herdr ledger mod design.md` (Phases 1
to 3), `Pins.md`, and the build notes in `docs/build-notes/`.

The panel becomes a scan list: one line per item, driven by the pointer or by arrows and Enter.
Clicking a row, or Enter on it, opens a centered dialog (`kind: "dialog"`, 0.6 × 0.75 of the
window) that shows the item whole, with its text, quote and message selectable, and every action
the expanded row offers today. Esc or a click outside closes it, and the list keeps its place.

Jesse's words, 2026-11-10: "when trying to view the side bar entries, I can't interact with the text.
what if the sidebar was a bit more simplified list and clicking on an item opened a larger central
modal". He approved this shape the same day.

Research facts this spec rests on: plain `div` text cannot be selected in Herdr; a row head's
`on_click` folds the row today (panel.js:2103-2104), so a click meant for the text folds it;
`mod.json` declares one overlay (the capture box), so the dialog opens through `openOverlay` with
props; `main.js` treats any overlay without a `view` as the capture box; a dialog takes the keyboard
and the mod focuses its own handle; the shipped Linear mod is the nearest pattern (a list, a detail
screen with `TextView.markdown(...).selectable(true)`, Esc back).

## 0. Decisions at a glance

| Topic | Decision | Section |
|---|---|---|
| Row | One line: glyph, handle, one pill, the text's first line, a state word; Done (on hover and on the cursor row) and Paste answer (when an answer is ready) are the only buttons on it | 1.2-1.4 |
| Keyboard in the list | A click gives the list the keyboard; ↑ ↓ move a cursor, Enter opens, Space checks a pin, Esc clears. No `focusable` in mod.json; a `focus-list` command, unbound | 1.6-1.7 |
| The dialog | A new view `{view: "detail", session, kind, id}` of the same mod, its own copy: `detail.js` | 2 |
| Kinds | `ask`, `question`, `pin`, `branch`: one dialog, sections per kind | 2.4 |
| Shared code | A `Reader` base class (`reader.js`, moved out of panel.js) that the panel and the dialog both extend: reading store.json, posting acts, drafts, staging. The expanded-row renderers move to `views.js`; pure helpers to `listing.js` (A) and `detailing.js` (B) | 1.11, 2.9 |
| Size | `width: 0.6, height: 0.75` (shares of the window; Herdr has no minimum); two columns at 760 px wide and up | 2.2 |
| Readable text | `TextView.markdown(id, …).selectable(true)`; the person's and pinned text escaped so it shows verbatim (`mdVerbatim`); a read-only Editor only if the live check finds selection broken | 2.3 |
| Staging from the dialog | One staging door: nav.js `stageMessage`, called only by `Reader.stage`. The dialog stays open until the paste is decided, then closes | 3 |
| Esc and click outside | Herdr closes the dialog; nothing typed is lost (drafts written in `close`, the Conclude text kept) | 2.7 |
| Back to the list | `shared("ledgr.detail")` carries the dialog's open and closed records; the panel moves its cursor, takes the keyboard back (or focuses the pane a message was pasted into) and shows the dialog's last words | 1.9 |
| Second open | From inside the dialog: in place (`retarget`). From the panel: the open one is closed first | 2.8 |
| Files | mod.json, keys.json, the installer, the store and every engine file unchanged | 4 |
| Must happen first | Probe P1 (staging with a dialog open, where the keyboard goes after it closes) | 6.4, 7 |

## 1. The list (Builder A)

### 1.1 What stays in the panel, what moves to the dialog

| Stays in the panel | Moves to the dialog |
|---|---|
| Header, session menu, hold, space switch, off, away and empty states, footer folds, the flash line | The expanded row bodies: `details` (panel.js:2157-2251), `pinDetails` (:1494-1551), the open part of `branchRow` (:2349-2369) |
| Lane heads: PINS (fold, search box, count), the selection bar ("3 selected · Ask about these… · clear"), YOUR QUESTIONS (fold, Clear N in two clicks, count), ASKED OF YOU (fold, "extracting turn N", "agent working", threshold menu, count) | The answer input and the option chips (:2134-2141, :2238-2244) |
| Fold lines: "N more ›" and "fewer ‹", "archived (N)", turn group heads with "◆ N blocking", "below threshold (N)", the BRANCHES sub-head | Defer ▾, Not needed, Reopen, Promote (the row's "promote" pill too, :2114-2117), Ask about this, Copy for prompt, Stage /btw, Go to anchor, Resume session… |
| The turn group's sheet line "Paste N answers into pane t3" and the error line with Retry | Branch… / Branch again…, the Branch confirmation and its manifest, Ask here (a question with pins), Call off the confluence, Paste confluence again |
| Pin checkboxes and the selection; search results grouped by session with "open session" | Conclude… / Edit conclusion…, the Conclude editor, Paste into trunk, Ask for a conclusion, Close branch, Focus the branch, Show the preamble |
| Row quick actions: Done, Paste answer | A pin's Ask here… / Branch… / Note / Copy / Go to anchor / Archive / Restore / Delete, "show whole message", the "Copy" pill on search results (:1479-1481) |
| Motion: a row entering, the answered glow, a row leaving (ghost) | The answered fold of an open row (`f.fold`, :1080-1083) goes: rows no longer open |

### 1.2 The row

One `h_flex` per item, `h(26)`, `px(6)`, `gap(6)`, `items_center`, `rounded(6)`, one line, no wrap.
Element ids stay as today (`row-<id>`, `pin-<id>`, `br-<id>`) so scripted looks keep working.
Children, in order:

1. Pin rows only: the checkbox (today's `pinCheck`, :1451-1460, without the "add to question"
   label; its tooltip says it).
2. The glyph column, 12 px: `glyphOf(it, sug)` (1.3) for items; the pin icon for pins; the
   git-branch icon or the spinner for branches (as :2338-2339).
3. The handle in words, `flex_none`, 11.5, semibold, muted: "Ask 5", "Question 3", "Pin 4",
   "branch of Question 3".
4. One pill, `flex_none`, text 10, `tone + "22"` background (1.3, `rowModel().pill`), or none.
5. The text's first line: `flex_1`, `min_w(0)`, `truncate`, 12.5; dim when closed, struck through
   when dismissed, muted for a suggestion (as :2118-2119).
6. The state word, `flex_none`, 10.5, in its tone (1.3). Left out when the row shows Paste answer
   (the button is the state).
7. Quick actions, `flex_none` (1.4).

The row's tooltip is `rowModel().tip`: the text's first 300 characters, then the quote's first 120
in quotes; a pin's tooltip adds its note. A child question (`parentId` of an ask) keeps today's
`ml(IND)` and left border (:2127). Search results are pin rows like the lane's.

The row whose dialog is open is drawn `bg(t.raised)` (from `shared("ledgr.detail").open`). The cursor
row, while the list holds the keyboard, is `bg(t.selected)` with `border_l(2)` in `t.accent`.

| Kind | Handle | Pill | Text |
|---|---|---|---|
| ask | "Ask 5" | blocking: "blocking" (`blocked`); a suggestion: its level, "needed" or "optional" (`dim`); else its kind: decide, provide, confirm, do, review (`dim`) | `firstLine(it.text)` |
| question | "Question 3" | with pins: "2 pins" (`accent`); a bookmark: "bookmark" (`dim`); /btw: "/btw" (`muted`); else none | `firstLine(it.text)`; a bookmark: “first line of its quote” |
| pin | "Pin 4" | none | `firstLine(p.text)` |
| branch | "branch of Question 3" | its hc name, `br-q3-7c1e` (`dim`) | the question's first line, dim |

`firstLine(text, n = 160)`: the first non-empty line, whitespace collapsed, cut at n with "…".

### 1.3 State words

First match wins. Tones are `theme()` color names.

| Kind | When | Word | Tone |
|---|---|---|---|
| ask | resolved, `resolvedBy` answer | answered by you | done |
| ask | resolved, `resolvedBy` agent | closed by agent | done |
| ask | resolved, `resolvedBy` branch | resolved by branch | done |
| ask | resolved | done | done |
| ask | dismissed, `dismissedBy` clear | cleared | dim |
| ask | dismissed | not needed | dim |
| ask | deferred | deferred | muted |
| ask | answered (the sheet landed; the reply has not ended) | answered | accent |
| ask | open, below the threshold | below threshold | dim |
| ask | open, an answer typed or picked (`it.draft`) | answer ready (drawn as the Paste button) | accent |
| ask | open, `repeatOf` | raised again | accent |
| ask | open | open | blocked when blocking, else accent |
| question | resolved, `resolvedBy` branch | resolved by branch | done |
| question | resolved | done | done |
| question | dismissed, `dismissedBy` clear | cleared | dim |
| question | dismissed | not needed | dim |
| question | deferred | deferred | muted |
| question | rejoin_pending | rejoining | accent |
| question | answered | answered | accent |
| question | a branch not refused or failed | "branch " + `BR_WORD[live]`: branch working, branch needs you, branch idle, branch concluded | working, blocked, else accent |
| question | `askedAtTurn` | sent at turn N | muted |
| question | open, `anchor.settled` false | anchoring | dim |
| question | open | parked | accent |
| pin | archived | archived | dim |
| pin | `answeredIn` not empty | answered | done |
| pin | a question in `usedIn` has `pinsAsked` | sent | muted |
| pin | `usedIn` not empty | used | muted |
| pin | `anchor.verified` null | unverified | dim |
| pin | else | `agoWords(createdAt)`: "3 days ago" | dim |
| branch | always | `BR_WORD[live] ?? live` ("working", "needs you", "idle", "concluded", "rejoined", "launch failed", …) | the color map of :2321 |

`glyphOf(it, sug)` is today's `glyph` mapping (:2032-2039) as data: `[char, tone]`.

### 1.4 Quick actions

| Action | On | Shown | Does |
|---|---|---|---|
| Done | asks and questions that are not closed (rejoin_pending included, as today :2186) | on the hovered row and on the cursor row only | `this.act(it.id, "resolve", null, cx)`; tooltip `DONE_TIP` |
| Paste answer | asks that are not closed with `answerOf(it)` | always while an answer is ready | `this.copyAnswer(it, s, cx)` (Reader, 1.11); label `stageLabels(paste).quick`: "Paste", or "Copy" with `ui.pasteIntoPrompt` false |

Both are small bordered buttons (`h(18)`, `px(5)`, text 10.5) that stop the click's propagation, so
they never open the dialog. Hover is tracked per row with `.on_hover((h, cx) => …)` into
`this.hoverKey`, with a render only when it changes. Pins and branches have no quick action.

### 1.5 Unchanged in the list

The lane heads, fold lines, sheet line, error line and selection bar keep their code, their ids and
their clicks. The PINS search, its toggles, group heads and "open session" are unchanged. Motion
(`observe`, `ghostRow`) is unchanged except that `f.fold` and `this.expanded` go.

### 1.6 Keyboard

| Key | Where | Does |
|---|---|---|
| ↑ / ↓ | the list, or the pin search box | moves the cursor over the entries (1.7) |
| PageUp / PageDown | the list, or the search box | 8 entries |
| Home / End | the list | first / last entry |
| Enter | the list | activates the cursor's entry: a row opens its dialog; a lane head, fold line or turn group head toggles as its click does; the sheet line stages the sheet |
| Enter | the search box (the InputState's `submit`) | opens the cursor's pin, else the first result |
| Space | the list, the cursor on a pin row | checks or unchecks it (the checkbox's click) |
| Esc | the list | clears the cursor |
| Esc | the search box | clears the query (unchanged, :1371) |
| Tab, Shift-Tab, ⌘Enter, ⌘S | anywhere | bound in `mod:ledgr` (keys.json) to the capture box's commands, so they never reach `on_key_down`; the panel's `command()` ignores `tab`, `backtab`, `btw` and `pin` |

Keys are matched on `e.keystroke` ("up", "down", "pageup", "pagedown", "home", "end", "enter",
"space", "escape"). ↑ ↓ and PageUp/PageDown work while the search box has the keyboard (they travel
up the focus path to the root's handler, as in the Linear mod). Home, End, Enter, Space and Esc act
only when `this.keys.is_focused()` (the list itself, not the search box), so typing a space or moving
the caret in the box never checks a pin. The existing menus (session menu, threshold menu) keep
their own focus handle and Esc.

### 1.7 Focus, entries and the cursor

- `this.keys = cx.focus_handle()` in the constructor; the panel root (`v_flex().id("ledgr")`, :1171)
  gets `.track_focus(this.keys).on_key_down(…)`.
- The list takes the keyboard on a click: every row, lane head and fold line click calls
  `this.keys.focus()` before doing what it does. A row click also sets the cursor to that row.
- `focus-list` (command, no key bound by default): shows nothing new, focuses `this.keys` and puts
  the cursor on the first row. `mod.json` stays without `"focusable": true` (7, question 3).
- Entries: every line a click acts on, in drawing order, recorded while `body()` builds its
  children: `this.entries = [{key, index}]`, where `index` is the line's position among the
  direct children of `ledgr-list`. Keys: `lane:pins`, `lane:mine`, `lane:asks`, `pin:<id>`,
  `more:pins`, `arch:pins`, `pgroup:<sid>` (a search group head; Enter is "open session"),
  `item:<id>`, `branch:<id>`, `group:<turn>`, `sheet:<turn>`, `sug:<turn>`, `err:<turn>`. The
  selection bar, the search box, Clear, the threshold menu and the footer are not entries.
- `this.cursor` is an entry key, in memory, reset when the shown session changes.
- Moving: `moveCursor(keys, cursor, delta)` (listing.js); then `this.listScroll.scroll_to_item(index)`
  (`ScrollHandle`, made in the constructor, `.track_scroll(this.listScroll)` on `ledgr-list`). It
  moves only as much as needed and leaves a visible row where it is.
- After every render the cursor is checked with `keepPlace(prevKeys, keys, cursor)` (listing.js), so
  a row that left its lane (Done, a store change) hands the cursor to the entry that followed it.

### 1.8 Opening the dialog

```js
openDetail(kind, id, sid, o = {}, cx)   // panel.js
```

1. The open dialog, if any, is closed first: `closeOverlay(this.detailId)` and, when
   `shared("ledgr.detail")?.open?.overlay` names another, that one too (closeOverlay of a gone id is
   harmless).
2. `this.detailId = openOverlay(detailSpec({ session: sid, kind, id, open: o.open ?? null,
   sel: kind === "pin" && this.pinSel.has(id) ? this.selPins(st).map((p) => p.id) : [],
   opener: this.panelId, demo: this.demo }))` (`detailSpec`: detailing.js, 2.9).
3. The cursor moves to that row; `this.flash` is cleared.

Callers: a row's click, Enter on a row, `open:<handle>`, `runThen` (1.10), and the re-routed
commands of 1.10. Never from `render` itself: from a handler, or `cx.timer.after(0, (cx) => …)` as
`runThen` does today (:1585). In the demo the dialog builds its own demo store (2.10).

`runThen` (:1579-1594): `then: "trunk"` opens the question's dialog and keeps today's flash;
`then: "branch"` opens it with `open: "confirm"` (the Branch confirmation).

### 1.9 Keeping its place when the dialog closes

The panel reads `shared("ledgr.detail")` (2.1) in `render`. When `closed.at` is newer than the last
one it handled:

1. `this.flash = closed.flash` when there is one (what a staging said, "Ask 5 closed", …).
2. `closed.drafts` (`{[itemId]: text}`) go into `this.drafts` as sent drafts (`{text, sent: true}`),
   and `overlayLocal()` shows them until store.json carries them, so Paste answer on the row works
   at once.
3. The cursor goes to `entryKey(closed.kind, closed.id)` when that entry is in the list; else it
   stays where it was (`keepPlace`).
4. Keyboard, only when `closed.overlay === this.detailId` (the dialog this copy opened, not one
   replaced by a newer open): `closed.focus === "list"` → `cx.timer.after(30, () =>
   this.keys.focus())`; `closed.focus === "pane"` → `run("pane.focus", { terminal: closed.terminal
   })` when it is live (the pane a message was pasted into keeps the keyboard even if Herdr handed
   it back to the panel; pane.focus is the one terminal command the panel already runs, :849);
   `null` → nothing (a click outside went somewhere the person chose).

The list's scroll position is its own and the dialog never touches it, so nothing moves unless the
cursor row has to be revealed.

### 1.10 Commands

Every command reaches every shown copy, the dialog included (AGENTS.md:826), so each is handled by
exactly one of them.

| Command | Before | After |
|---|---|---|
| demo, capture, rescan, check-writer, sessions, session:, fold-mine, fold-asks, fold-pins, suggestions, below-threshold, threshold:, render-stats, space:, clear-questions, pins-search:, pin-select:, ask-pins, hide-branch:, demo-ask:, demo-answer:, menu:threshold, menu:off, copy-answers | panel | panel, unchanged |
| act:<h>:<a>, pin-note:<P>:<text>, pin-archive:<P>, pin-restore:<P> | panel | panel, unchanged: they post without any UI (Reader `act`, `pinAct`) |
| copy-answer:<h> | panel | panel stages it (Reader `copyAnswer`) unless the dialog is open on that item; then the dialog does |
| pick:<h>:<n> | panel | panel posts the option as the draft (Reader `typeDraft`) unless the dialog is open on that item; then the dialog fills its input |
| open:<handle> | new | panel: opens the dialog on that item, pin (A3, Q2, P4 of the shown session) or branch (its hc name, br-q3-7c1e) |
| cursor:<handle>, list-key:<up\|down\|pageup\|pagedown\|home\|end\|enter\|space\|escape>, focus-list | new | panel: the cursor and the keys of 1.6, for scripted looks |
| demo-detail[:<handle>] | new | panel: enters the demo if it is off, then opens the dialog on that demo item (default A15) |
| branch | panel: Branch confirmation inline | panel: opens the newest open parked question with `open: "confirm"` |
| go:<h>, whole:<h>, menu:<h>:<defer\|more>, ask-here:<Q> | panel | panel: opens that item with `open` "go", "whole", "defer" / "more", "ask-here"; when the dialog is already open on it, the dialog does it |
| conclude, ask-conclusion, copy-confluence, close-branch | panel, on the newest fitting branch | panel: finds that branch as today (:400-417) and opens its dialog with `open` "conclude", "ask-conclusion", "again", "close"; when the dialog is open on it, the dialog does it (close-branch twice: arm, then end) |
| launch-branch, branch-split, branch-agent, send-to-trunk, conclude-edit:<text> | panel | dialog only (they need its state); the panel ignores them |
| expand-all, expand-branches | panel | gone: the panel says "Rows open in the detail dialog: ledgr.open:<handle>" |
| collapse-all | panel | panel: closes the open dialog, clears the cursor |
| detail:close, detail:done, detail:whole, detail:pick:<n>, detail:answer:<text> | new | dialog only |
| tab, backtab, btw, pin, submit, escape | capture box | capture box; the dialog handles tab and backtab only for its own fields (2.7); the panel ignores all six |

"The dialog is open on that item" is `shared("ledgr.detail").open.id === it.id`.

### 1.11 The Reader extraction (`reader.js`, new, Builder A)

What every reading copy of ledgr shares, moved out of panel.js nearly verbatim so the panel and the
dialog run the same code. `class Panel extends Reader`; `class Detail extends Reader` (B).

| Member | From | Notes |
|---|---|---|
| `constructor(cx, { demo })` | :145-231, the reader fields | `cfg` (DEFAULTS), `demo`, `demoStore`, `live`, `liveText`, `localActs`, `drafts`, `passages`, `txCheck`, `pasting`, `flash`, `rev`, `revAt`, `rcx`, `inApp`, `unwritten` (Map evId → {type, payload}) |
| `async startReading(cx)` | :237-244 | `liveHome()` guard (false: returns false, nothing read, nothing shared); `inApp`; `cfg = await loadConfig()`; `reload()`; `watchStore(cx)`; returns true |
| `fallback()` | :258 | `false`; Panel overrides (its fallback writer) |
| `viewStore()` | :584-587 | the demo store, else `live`; Panel overrides |
| `reload()`, `bump()`, `overlayLocal()` | :260-305 | `PIN_ACTS` moves with it |
| `watchStore(cx)` | :307-335 | after a config reload calls `this.onConfig?.(cx)` (Panel: the writer's `applyConfig`, `prevCls`, `obsVer`, :319-321) |
| `tickRead(cx)` | :356 | one reload (the 60 s backstop) |
| `post(type, payload, local, cx)` | :361-371 | also keeps `{type, payload}` in `unwritten` until its write resolves |
| `act`, `typeDraft`, `answerOf`, `pasteOn`, `demoHow` | :650-675, :720, :747-752 | unchanged |
| `async flushPending()` | new | writes again every event still in `unwritten` (same `id`: store.js `apply` drops a second copy by id, store.js:360) and posts every draft not yet sent, awaiting each `writeEvent` |
| `stage(msg, terminal, cx, w)` | :758-767 | `return stageMessage(this, msg, terminal, cx, { ...w, paste: this.pasteOn(), say: (text, r, cx) => { this.flash = text; if (r) this.afterStage?.(r, text, terminal, cx); cx.notify(); } })` (3.2) |
| `stageAnswers`, `copyAnswers`, `copyAnswer` | :722-743 | unchanged; each stages through `this.stage(msg, s.terminal, cx` |
| `trunkWord`, `parentLive`, `branchable`, `branchLive`, `terminalGone`, `transcriptOk`, `loadPassage`, `pinAct`, `resume` | :912-920, :800-808, :904-907, :856-889, :700-711, :1670-1673 | unchanged; `transcriptOk` reads `this.rcx`, which each copy's `render` sets |

Panel keeps: the writer (`checkWriter`, `tick`, `release`, `fallback`, `viewStore` overrides),
`current`, the list, lane heads, motion, the session menu, spaces, Clear N, the pins lane and
selection, `openPinsBox` and `askAboutSelection` (the selection bar), `runThen`, `enterDemo`,
`setThreshold`, `saveConfig`. It drops what 1.1 moves, and the fields only those used (`expanded`,
`whole`, `inputs`, `confirm`, `conclude`, `closeAsk`, `brOpen`, `preOpen`, `brMsg`, `gitOk`,
`pinOpen`, `pinWhole`, `pinNote`, `pinDel`). Its `stage`, `post`, `act` and the rest of the table come
from Reader; panel.js defines none of them again.

## 2. The dialog (Builder B)

### 2.1 Routing and lifecycle

`main.js`: `p.view === "host"` → Host; `p.view === "detail"` → Detail; then `isCapture(p)` →
Capture; else Panel. The detail test comes before `isCapture`, which takes any overlay without a
`view` (main.js:49-53). `close()` awaits the copy's release: `async close(_cx) { try { await
this.ctl?.release?.(); } catch { /* closing */ } }` (main.js:73-75 does not await today).

Props, checked by `detailProps(p)` (detailing.js): `{view: "detail", session, kind, id, open?, sel?,
opener?, demo?}` plus Herdr's `overlay`. `kind` is a hint: the record decides (`pn_` a pin, `br_` a
branch, else an item, an ask or a question by its `direction`).

`class Detail extends Reader`:

1. Constructor: `detailProps`; a bad shape renders "Nothing to show (<why>)" with Esc and nothing
   else. `super(cx, { demo })`. Focus handle `this.keys`, `ScrollHandle`s for each column, menu
   state (`dd`, `ddShut`, `ddFocus`). `cx.timer.every(60000, (cx) => this.tickRead(cx))`.
2. `cx.spawn(start)`: `await this.startReading(cx)` (the demo builds `new Store(demoData())` and the
   demo branches' manifests and preambles as panel.js:565-575 does, in its own code). Only when
   `inApp`: `setShared("ledgr.detail", { open: {overlay, opener, session, kind, id, at}, closed: null })`.
   Then it resolves the target, makes the item's InputStates (2.7), applies `open` (2.8) and
   focuses.
3. It never pings, never claims `ledgr.writer`, never runs a Writer, and writes no shared key but
   `ledgr.detail`.
4. `close()`: `closeOverlay(this.overlay)` (capture.js:241-245 is the model).
5. `release()` (from `View.close`, also after Esc or a click outside): `await this.flushPending()`;
   keeps an unsent Conclude text (2.7); then writes the closed record with `mergeClosed(cur, mine)`
   (detailing.js): `open` becomes null only when it names this overlay, so a newer dialog's open
   record survives an older one closing. `closed = {overlay, opener, session, kind, id, at, flash,
   focus, terminal, drafts}`; `focus` is "list" after Esc or a closing act, "pane" after a staging
   or a pane focus (with its `terminal`), null otherwise (a click outside).

The item is gone (forgotten session, deleted pin, archived away by the daily housekeeping): the
body says `DETAIL_GONE` and offers only Close.

### 2.2 Size and layout

`detailSpec(p)` returns `{ mod: "ledgr", kind: "dialog", width: 0.6, height: 0.75, props: {...} }`.
Shares of the window (herdr.d.ts:364); `OverlaySpec` has no minimum, so the dialog lays itself out
from what `on_size_change` reports and stays usable down to 420 × 320. Herdr's frame (border,
corners, shadow) is kept; the background is `t.popover`, as the capture box's. Non-modal: Esc and a
click outside close it.

```
┌ header ───────────────────────────────────────────────────────────────────────┐
│ ◆ Ask 15  blocking  decide · turn 17 · declared by the agent   open   claude · shop-api migration · pane t21   Esc │
├ left column (the item, scrolls)        │ right column (the message, scrolls) │
│ TEXT                                   │ THE MESSAGE · turn 17   whole ⇄ around · Copy │
│ QUOTE                                  │ before (muted)                      │
│ options / ANSWER                       │ ▌the passage (accent edge)          │
│ sections of the kind (2.4)             │ after (muted)                       │
│ foot line                              │                                     │
├ footer ───────────────────────────────────────────────────────────────────────┤
│ status line (this.flash)                                                     │
│ [primary] [Done] [Defer ▾] … [⋯]                         Esc close · Tab next field │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Root: `v_flex().id("ledgr-detail").track_focus(this.keys).on_key_down(…).on_size_change(…)`,
  `size_full().min_h(0)`, text 12.5.
- Header `dt-head`: `h(44)`, `px(16)`, `border_b`. Glyph, handle words (13, semibold), pill, kind and
  facts (dim), state word (its tone), then the session: `agentLabel` pill, `sessionWords`, pane words;
  for a pin of a forgotten session its `source` name and "forgotten". "Esc" at the right.
- Body: at 760 px wide and up, two columns: left `dt-left` (46 % of the width, from
  `on_size_change`), right `dt-msg` (the rest, `border_l`), each `overflow_y_scrollbar()` with its
  own `ScrollHandle`. Below 760 px, one column `dt-left` with the message blocks appended last.
- Footer `dt-foot`: `border_t`; the status line when `this.flash` is set; the actions row
  (`flex_wrap`, `gap(6)`); the key hints at the right (capture.js:416-418 style).
- No height cap and no scroll area inside a column (panel.js:2150: a capped box inside a scrolling
  list neither scrolled nor showed a bar). `TextView.scrollable` is not used.

### 2.3 Readable text

Everything shown for reading is a `TextView.markdown(id, md).selectable(true)` (gpui-kit.d.ts:
20701-20706), in a `div` that sets size and color. Ids are stable per item and block (`dt-text-<id>`,
`dt-quote-<id>`, `dt-msg-b-<id>`, `dt-msg-h-<id>`, `dt-msg-a-<id>`), so a selection survives the
re-render a store change causes.

| Text | Rendered as |
|---|---|
| An ask's text and quote, the message, a branch's last message, its preamble | markdown as written, single line breaks kept (`hardBreaks`) |
| A pin's passage and note, a question's text and quote, an answer, a conclusion, `it.note` | `mdVerbatim(text)`: every ASCII punctuation character markdown treats as syntax backslash-escaped, line breaks kept as hard breaks, so it shows exactly as stored |
| Labels, buttons, the foot line | plain `div` text (nothing to select) |

The message is three blocks, `before`, `hit` (`pl(7)`, `border_l(2)` in accent, accent `14` tint) and
`after`, from `passageParts(text, quote, whole)` (moved from panel.js:98-134 to detailing.js), each
a direct child of the message column (after its head line). On first load
`msgScroll.scroll_to_item(i)`, `i` the hit block's index among the column's direct children, brings
the marked passage into view (in one column, the same on `dt-left`). A selection cannot run across two blocks, so the column head has Copy message
(the turn's text as saved) and the left column has Copy beside the text and the quote.

Fallback, only if the live check finds `selectable` TextViews do not select or copy in a dialog: the
verbatim texts become a read-only Editor (`EditorState.new({ value, readonly: true, line_numbers:
false, folding: false, soft_wrap: true, font_family: settings().font_family })`, gpui-kit.d.ts:
21452-21474), made in the start task or a handler, never in `render`.

### 2.4 Sections per kind

Left column, top to bottom. "Sub-row" is a one-line row drawn from `rowModel` (listing.js) by
views.js `subRow`; clicking it retargets the dialog (2.8).

**ask**

| Section | Content | Shown when |
|---|---|---|
| TEXT | the ask, whole | always |
| QUOTE | the quote, whole (today's 300-character cap, :2231, goes) | there is one |
| OPTIONS | chips; the chosen one in accent; "(rec.)" | kind decide with options |
| ANSWER | `answerBox`: the Answer… input, Paste answer (`L.one`), the hint "Enter pastes the answers for turn N" | not closed |
| RESULT | "→ answer" (verbatim); who closed it and when (`resolvedByWords`, :2094-2096); "raised again" with the dismissed ask; `it.note`; "deferred until …" | as they apply |
| QUESTIONS ABOUT IT | sub-rows of its child questions | there are some |
| foot | `Ask 15 · declared by the agent · blocking · turn 17 · #hash` (:2249-2250) | always |
| message (right) | its anchor turn (`loadPassage`), the quote marked | always |

**question**

| Section | Content | Shown when |
|---|---|---|
| TEXT, QUOTE | as for an ask | the text; the quote if any |
| about | "parked during turn N; anchors at end of turn", "re Ask 5", "turn interrupted", "re-anchored from turn N" (:2078-2085) | as they apply |
| PINS | sub-rows of its pins, in its order | it has pins |
| BRANCHES | sub-rows of its branches (name, live word) | it has any |
| BRANCH CONFIRMATION | `confirmBox` (:2262-2289): the manifest, placement, worktree toggle, Launch, Cancel | `this.confirm` |
| RESULT | rejoin pending (:2090-2093), resolved by its branch, `it.note`, deferred | as they apply |
| foot, message | as for an ask | always |

**pin**

| Section | Content | Shown when |
|---|---|---|
| PASSAGE | the passage, whole, verbatim; badges unverified, clipped, archived | always |
| NOTE | the note, or the note editor (`pinNoteBox`: Enter saves, Cancel discards) | a note, or editing |
| ANCHOR | `pinAnchorWords`; for another session `pinSourceWords` first | always |
| USED IN | `pinUseLines(pin, store)` (words.js, every use, newest first); each line with an existing question is a sub-row | `usedIn` or `answeredIn` |
| foot | `Pin 4 · pinned by you · turn 12 · #hash · re-anchored from turn N` (:1549-1550) | always |
| message (right) | its turn, the pin's text marked; gone: "That message is no longer saved; the pin keeps the passage." | always |

`props.sel`: the panel's selection when this pin was in it. Ask here… and Branch… then carry the
whole selection, as `pinsFor` does today (:1554-1556); the dialog cannot change the selection.

**branch**

| Section | Content | Shown when |
|---|---|---|
| QUESTION | a sub-row of the question it settles | the question exists |
| status | `depth N · <live word>`, rejoined at turn N (:2345-2346), and the facts line (:2327-2334) | always |
| MANIFEST | `manifestView(t, br.manifest, true)` (:2254-2259) | always |
| ASKED IN THIS BRANCH | sub-rows of the branch session's open items | there are some |
| CONFLUENCE | `confluenceView` (:2405-2418) | concluded or rejoined |
| CONCLUSION | the branch's ledgr-conclusion block | not staged, a block found |
| CONCLUDE | `concludeBox` (:2422-2453) | `this.conclude` |
| PREAMBLE | the preamble, markdown | shown by its toggle |
| errors | refused, not started, close failed | as they apply |
| message (right) | the branch session's newest finished turn (`pumpBranchMessages`, :2293-2313, for this one branch), its ledgr-conclusion block marked | the branch has a session |

### 2.5 Actions and what they post

The footer keeps today's arrangement: a primary button, Done, Defer ▾, the kind's own buttons, ⋯ for
the rest (:2176-2227 for items, :1505-1541 for pins, :2375-2397 for branches). Methods are moved from
panel.js to detail.js unless the Reader column says so.

| Action | Kind | Method | Posts or stages | Then |
|---|---|---|---|---|
| Done | ask, question | `act(id, "resolve")` | `act` resolve | closes, focus list |
| Not needed | ask, question | `act(id, "dismiss")` | `act` dismiss | closes, focus list |
| Defer ▾ Tomorrow, In a week, Next session | ask, question | `act(id, "defer", arg)` | `act` defer | closes, focus list |
| Reopen, Call off the confluence | any closed or deferred; rejoin_pending | `act(id, "reopen")` | `act` reopen | stays |
| Promote | a suggestion | `act(id, "promote")` | `act` promote | stays |
| typing an answer, an option chip | ask | Reader `typeDraft`, `setDraft` | `act` draft (800 ms after the last change) | stays |
| Paste answer | ask | Reader `copyAnswer` | stages the one-ask sheet | closes when the paste is decided (3.1) |
| Enter in the answer box | ask | Reader `copyAnswers(s, turn)` | stages the turn's sheet (today's behaviour, :683-687) | the same |
| Ask about this | ask | `askAbout` (:778-782) | opens the capture box | closes, focus none |
| Copy for prompt; Stage /btw | question without pins | `stageQuestion` (:784-790) | `stageText` (clipboard, pane focused); /btw also `act` btw | closes, focus pane |
| Copy for prompt | question with pins | `copyPinsMessage` (:1613-1620) | clipboard only | stays |
| Ask here | question with pins | `askPinsHere` (:1599-1608) | stages the pins message | closes when decided |
| Go to anchor | ask, question, pin | `goTo`, `goToPin` (:771-776, :1632-1639) | nav.js `goToAnchor`: a search slice, pane focused | closes, focus pane |
| Resume session… | any, terminal gone | Reader `resume` | `resume` | stays |
| Branch…, Branch again… | question | `openConfirm` (:810-823) | nothing (opens the confirmation) | stays |
| Launch branch | question | `launch` (:830-843) | `branch` | stays (the branch shows launching) |
| Paste confluence again | question rejoin_pending, branch concluded | `copyConfluence` (:1020-1025) | stages the confluence | closes when decided |
| Conclude…, Edit conclusion… | branch | `openConclude`, `branchText`, `concludeEditor` (:949-998) | nothing | stays |
| Paste into trunk | branch | `sendToTrunk` (:1004-1017) | stages the confluence, then `conclude` | closes when decided |
| Ask for a conclusion | branch | `askForConclusion` (:1028-1035) | clipboard, branch pane focused | closes, focus pane |
| Close branch (two clicks) | branch | `closeBranch` (:1037-1043) | `close_branch` | stays |
| Focus the branch | branch | `focusBranch` (:846-851) | `pane.focus` or `terminal.peek` | closes, focus pane |
| Show / Hide the preamble, Reset, Cancel | branch | UI | nothing | stays |
| Ask here…, Branch… | pin | `openPinsBox` (:1561-1568) | opens the capture box in pins mode | closes, focus none |
| Note, Edit note | pin | `editPinNote` (:1642-1650) | `pin_note` on Enter | stays |
| Copy | pin | `copyPin` (:1624-1628) | clipboard only | stays |
| Archive | pin | Reader `pinAct("pin_archive")` | `pin_archive` | closes, focus list |
| Restore | pin | Reader `pinAct("pin_restore")` | `pin_restore` | stays |
| Delete (two clicks, archived only) | pin | `deletePin` (:1653-1666) | `pin_delete` | closes, focus list |
| Copy (text, quote), Copy message | any | `copyText(text, what, cx)` | clipboard only | stays |
| a sub-row | any | `retarget(kind, id, session, cx)` | nothing | stays, in place |

"Closes" for a posting act means `postAndClose(type, payload, local, cx)`: it awaits `writeEvent`
in its own task, then closes, so the close cannot cancel the write (AGENTS.md:910-920: cleanup gets
at most 250 ms, then tasks are cancelled). Opening the capture box: `openOverlay` first, then
`close()`. No new spool event: the dialog posts exactly what the panel posts today.

### 2.6 Refresh

Reader's `watchStore` (one `watchFolder` on ledgr-data per copy) and the 60 s `tickRead`. A reload
re-resolves the target; acts the dialog posted show at once through `overlayLocal` until the writer
has them. The anchor turn's text is read once per `(session, turn)` (`loadPassage`); a branch's last
message again when its newest turn's `stopAt` changes. The panel does not see the dialog's local
acts; its rows follow once the writer has ingested them (normally well under a second).

### 2.7 Focus and keys

| Key | In | Does |
|---|---|---|
| Esc | anywhere | Herdr closes the top dialog (AGENTS.md:994). The root's `on_key_down` also sees "escape" when it gets it first: it records `closedBy = "esc"` (so the record says focus "list") and calls `close()` |
| Enter | the answer input | the turn's sheet (2.5) |
| Enter | the note input | saves the note |
| Tab, Shift-Tab | a field of the dialog | `mod:ledgr` binds them to `ledgr.tab` / `ledgr.backtab`; the dialog moves to its next / previous field (answer, note, Conclude text, then the dialog itself), only while `this.keys.is_focused()` or one of its InputStates reported `focus` more recently than `blur`, so a Tab in a capture box opened on top is never taken |
| ⌘Enter, ⌘S | anywhere | `ledgr.btw`, `ledgr.pin`: ignored by the dialog (they are the capture box's) |
| any other | the dialog itself | nothing; actions are clicks |

Focus on open: an open ask → its answer input; `open: "note"` → the note input; `open: "conclude"` →
the Conclude text; else `this.keys`. Each with `cx.timer.after(0, …)` and again after 400 ms (as the
Linear mod and the capture box do). InputStates and the TextareaState are made in the start task or
a handler, never in `render`.

Nothing typed is lost when Esc or a click outside closes the dialog:
- answers: `flushPending()` in `release()` posts any draft still waiting for its 800 ms;
- the Conclude text: kept in the dialog copy's `localStorage` under `detail.conclude`
  (`{[branchId]: {text, at}}`, written on each change); `openConclude` offers it back, as source
  "edited", when it is under a day old and newer than the branch's posted conclusion; cleared once
  Paste into trunk stages it. Keys start with `detail.`: the capture box is also an overlay of
  ledgr, and its `localStorage` keeps `lastClip` (BUILD-NOTES-mod.md:161);
- a pin note being edited is discarded, as Esc discards it today.

### 2.8 Replacing, and opening in a state

- In place: a sub-row, a usage line or "the question of this branch" calls `retarget(kind, id,
  session, cx)`: the per-item state (InputStates, `confirm`, `conclude`, `whole`, menus) is reset,
  the open record is rewritten with the new target, the overlay stays. `release()` reports the last
  target, so the panel's cursor follows it when that item is in its list.
- From outside: the panel closes the open one before it opens another (1.8).
- `open` states applied once after load: "confirm" (`openConfirm`), "conclude" (`openConclude`),
  "note" (`editPinNote`), "whole" (the message switched to whole), "answer" (focus the answer),
  "defer", "more" (that menu open). Action states, from scripted commands only, run once in
  `cx.timer.after(0, (cx) => …)`: "go", "ask-here", "ask-conclusion", "again", "close" (arms Close
  branch; the next `close-branch` ends it).

### 2.9 Modules

`views.js` (new, B): the renderers moved out of panel.js, as functions of the dialog instance
(`host`). It imports gpui-kit, gpui-base, herdr (`theme` only), words.js, listing.js, detailing.js,
confluence.js, branch.js, store.js predicates.

| Export | From | Notes |
|---|---|---|
| `ICON(name)`, `IND` | :72, :75 | |
| `btn(t, id, label, onClick, o)` | :2041-2050 | |
| `pill(t, text, color)`, `badge(t, text, color)` | :1675-1677, :2109 | |
| `glyph(t, it, sug)` | :2032-2039 | draws `glyphOf` (listing.js) |
| `menuButton(host, t, key, label, items, o)` | :1185-1213 | state in `host.dd`, `host.ddShut`, `host.ddFocus` |
| `readable(t, id, text, o)` | new | `o.mode` "verbatim" or "markdown", `o.italic`, `o.muted`, `o.size`; a selectable TextView |
| `messageBlocks(t, id, text, quote, { whole })` | :2147-2155 | returns the three blocks as an array (direct children of the column) |
| `manifestView(t, m, frozen)` | :2254-2259 | |
| `optionChips(host, t, it)` | :2134-2141 | |
| `answerBox(host, t, st, s, it)` | :2238-2244 | `host.answer` is the InputState |
| `confirmBox(host, t, st, s, it)` | :2262-2289 | |
| `confluenceView(host, t, st, s, br)` | :2405-2418 | |
| `concludeBox(host, t, st, s, br)` | :2422-2453 | |
| `branchBody(host, t, st, s, br)`, `branchActions(host, t, st, s, br, o)` | :2349-2369, :2375-2397 | without the kids' full rows (sub-rows instead) |
| `pinNoteBox(host, t, p)` | :1545-1547 | |
| `subRow(t, m, onOpen)` | new | one line from a `rowModel` |
| `keyHints(t, hints)` | capture.js:416-418 | |

`host` provides: `demo`, `cfg`, `flash`, `answer`, `note`, `confirm`, `conclude`, `closeAsk`,
`gitOk`, `brMsg`, `preOpen`, `pinDel`, `dd`, `ddShut`, `ddFocus`; `act`, `setDraft`, `copyAnswer`,
`copyAnswers`, `launch`, `openConclude`, `sendToTrunk`, `copyConfluence`, `askForConclusion`,
`closeBranch`, `focusBranch`, `trunkWord`, `trunkLine`, `branchLive`, `pasteOn`,
`confirmManifest`, `canConclude`, `retarget`.

`detailing.js` (new, B, pure: no herdr, no gpui; loads in Node):

| Export | Does |
|---|---|
| `DETAIL` | `{ width: 0.6, height: 0.75, twoColumnsAt: 760, leftShare: 0.46, minWidth: 420 }` |
| `KINDS`, `OPEN_STATES` | `["ask", "question", "pin", "branch"]`; the states of 2.8 |
| `detailProps(p)` | `{ok: true, session, kind, id, open, sel, opener, demo, overlay}` or `{ok: false, error}`; `id` a string of 1-128 characters; `sel` only `pn_` ids, at most `LIMITS.pinsPerQuestion` (12, passed in, so the module imports nothing) |
| `detailSpec(p)` | the OverlaySpec of 2.2 |
| `kindOf(id, item)` | the record's kind (2.1) |
| `locate`, `passageParts` | moved from panel.js:98-134, unchanged |
| `mdVerbatim(text)`, `hardBreaks(text)` | 2.3 |
| `closesAfterStage(r)` | 3.1 |
| `mergeClosed(cur, mine)` | 2.1 |
| `keptConclude(kept, branchId, now, postedAt)`, `keepConclude(kept, branchId, text, now)` | 2.7, over the plain object read from `localStorage` |

`detail.js` (new, B): `class Detail extends Reader` (2.1), its `command()`, `render()`, and the action
methods of 2.5 moved from panel.js (two-space indented, `name(args) {` on one line: the static test
reads them that way).

### 2.10 Demo

`demo-detail[:<handle>]` (1.10) opens the dialog with `demo: true`. The dialog builds its own demo
store from `demoData()`; the demo ids are fixed (`rq_demo_N`, `pn_demo-pin-000a`, `br_demo_q3_7c1e`),
so the panel's demo row and the dialog's record are the same item. Acts in a demo dialog change its
own store only; the panel's demo list does not see them (accepted: nothing in the demo is saved).

fixtures.js gains (B): an archived pin `P3` of the demo session (`nextHandle.P` 4), a pin of a session
not in `sessions` (search shows it as forgotten), and `DEMO_DETAIL = "A15"`. Every section already has
a demo case: A15 (blocking decide, options, its passage in T17), A7 (answered), A9 (raised again), Q3
(a running branch with a ledgr-conclusion), Q2 (rejoined), Q5 (its message not saved), Q6 (bookmark),
Q9 (two pins, answered), P2 (a note).

## 3. Staging from the dialog (Builder C, with A and B)

### 3.1 The dialog stays open until the paste is decided

`stageIntoPrompt` writes the clipboard, focuses the target pane, and pastes from a task once Herdr
reports the target focused twice in a row (nav.js:118-145). Closing an overlay cancels its tasks
after 250 ms (AGENTS.md:910-920), so a dialog that closed first would cancel its own paste. The
dialog therefore stages while open (dimmed, holding the keyboard), and `afterStage(r, text,
terminal, cx)` closes it once `stageIntoPrompt` reports:

| `r` | Closes | Why |
|---|---|---|
| pasted | yes, focus pane | the person adds a word in the pane |
| off, focus, plain, blocked | yes, focus pane | the text is on the clipboard and the pane is focused: ⌘V there |
| gone, clipboard, error | no | nothing was focused; the status line says what to do |

`closesAfterStage(r)` (detailing.js) holds this table. The words go to the panel through the closed
record (1.9). With a dialog holding the keyboard, `terminal.paste` should reach the focused pane
("with no terminal holding keyboard focus, they use the focused pane", AGENTS.md:608-610); Probe P1
(6.4) confirms it before anyone builds.

### 3.2 `stageMessage` (nav.js, new)

The guard and the words that are panel.js `stage` today (:758-767), moved to nav.js so there is one
door:

```js
// The one staging door (reader.js `stage` is its only caller): one paste at a time per copy, the words
// of what happened. gate: {pasting} (mutated). w: {paste, what, where, lead, word, tail, say(text, r, cx)}.
// Returns false when a paste is still pending (nothing staged), true otherwise.
export function stageMessage(gate, msg, terminal, cx, w) {
  if (gate.pasting && Date.now() - gate.pasting < PASTE.waitMs + 400) { w.say(`Still pasting into ${w.where}…`, null, cx); return false; }
  gate.pasting = Date.now();
  const ret = stageIntoPrompt(msg, terminal, cx, { paste: w.paste, done: (r, cx) => {
    gate.pasting = 0;
    w.say(`${stagedWords(r, w)}${w.tail ? ` ${w.tail}` : ""}`, r, cx);
  } });
  if (ret === "pasting") w.say(`${w.what} copied; pasting it into the prompt in ${w.where}…`, null, cx);
  return true;
}
```

nav.js imports `stagedWords` from words.js (neither is an engine file); `stageIntoPrompt` keeps its
code and its export (test_nav.mjs calls it directly).

### 3.3 The chain, and the rule `test_no_keystrokes.py` enforces afterwards

nav.js `stageIntoPrompt` ← nav.js `stageMessage` ← reader.js `stage` ← `this.stage(` in the staging
methods. The checks (C):

1. Unchanged: the forbidden patterns everywhere; `terminal.paste` only in nav.js, once, with no
   arguments, inside `stageIntoPrompt`, after `focusedOn(terminal)` and the settled-focus and
   clipboard checks.
2. `stageIntoPrompt(` appears in no file but nav.js; in nav.js exactly twice: its definition and one
   call, inside `stageMessage`.
3. `stageMessage(` appears outside nav.js only in reader.js, exactly once, inside the method `stage`,
   whose body holds `paste: this.pasteOn()`. reader.js `pasteOn` holds `pasteIntoPrompt !== false`.
4. No `stage(` method in panel.js or detail.js (`^  stage\(` absent): both copies stage through
   Reader's.
5. The staging methods stage through `this.stage(` with their target: reader.js `stageAnswers`
   `this.stage(msg, s.terminal, cx`; detail.js `askPinsHere` `this.stage(msg, s.terminal, cx`,
   `sendToTrunk` `this.stage(msg, ts.terminal, cx`, `copyConfluence` `this.stage(msg, ts?.terminal, cx`.
6. Copy methods never stage: detail.js `copyPin`, `copyPinsMessage`, `copyText` each write the
   clipboard and contain none of `stage(`, `stageMessage(`, `stageIntoPrompt(`, `stageText(`,
   `stageQuestion(`, `run(`, `hc(`, `exec(`, `openOverlay(`; `copyPinsMessage` holds
   `write_to_clipboard(promptText(pinsMessage(`.
7. None of these calls `hc(`, `run(`, `exec(`, `openOverlay(`, `goTo`, `spawn(`: reader.js `stage`,
   `stageAnswers`, `copyAnswers`, `copyAnswer`; detail.js `askPinsHere`, `sendToTrunk`,
   `copyConfluence`, `copyPin`, `copyPinsMessage`, `copyText`.
8. One "Stage /btw", in detail.js, for a question without pins; with pins, Copy for prompt is
   `copyPinsMessage` (today's ordering check, test_no_keystrokes.py:130-133, pointed at detail.js).
9. detail.js `goTo` and `goToPin` go through `goToAnchor(` and call no `hc(`, `run(`, `exec(`.
10. panel.js calls none of `stageIntoPrompt(`, `stageMessage(`, `stageText(`, `goToAnchor(`.
11. detail.js `afterStage` decides with `closesAfterStage(` and closes only through `this.close(`.

The `method()` helper (test_no_keystrokes.py:102-112) takes the file's text; it is called with
reader.js, panel.js and detail.js.

### 3.4 If Probe P1 fails

If a dialog does not survive `pane.focus`, or the paste does not reach the pane while it is open, the
fallback is F1: the dialog closes first and hands the action to the panel that opened it through
`shared("ledgr.stage") = {opener, at, action, item, text}`; only the panel whose `panelId` is
`opener` acts, once per `at`, through its existing Reader methods. F1 changes A's and B's work, so the
orchestrator runs P1 before the builders start (7, question 1).

## 4. Other files

- `main.js` (B): the routing of 2.1; `close()` awaits `release()`; the header comment gains the
  detail view and the commands of 1.10.
- `mod.json`: unchanged. No `focusable` (7, question 3), no second overlay (Herdr has one per
  mod.json; the dialog's size comes from `openOverlay`).
- `keys.json`, the installer's `MOD_KEYS`: unchanged.
- `words.js` (B): `stageLabels(paste).quick` ("Paste" / "Copy"); `DETAIL_GONE`; `messageGone(turn)`
  (today's :2172 words) and `PIN_MESSAGE_GONE` (:1503); `pinUseLines(pin, store)`; `copiedWords(what,
  n)` ("The passage copied (412 characters); nothing was pasted."); `detailHints({answer, note,
  conclude})`. Nothing existing changes.
- fixtures.js (B): 2.10.
- Engine files: none of reader.js, listing.js, detailing.js, views.js, detail.js is one;
  `ENGINE_FILES` (writer.js:43) is unchanged and no engine file imports them.
- Later, not built now (the orchestrator's, after integration): preview.png retaken (the list, then
  the dialog on an ask; `herdr-app do ledgr.open:A2` in docs/preview-recipe.md); RECIPE.md parts 2,
  3, 5 and 6 (one-line rows, Enter or click opens the dialog, Esc back, dialogs take the keyboard,
  staging closes the dialog); CLAUDE.md (architecture and vocabulary: "detail"); a
  `BUILD-NOTES-detail.md`; CHANGELOG.

## 5. Ownership and contracts

### 5.1 Who owns what

| Builder | Files (sole owner) |
|---|---|
| A: the list | `mods/ledgr/panel.js`, `reader.js` (new), `listing.js` (new), `bin/tests/test_list.mjs` (new). `test_store.mjs` only if store.js changes (not expected) |
| B: the dialog | `mods/ledgr/detail.js` (new), `views.js` (new), `detailing.js` (new), `main.js`, `words.js`, `fixtures.js`, `bin/tests/test_detail.mjs` (new). `mod.json` (no change expected) |
| C: staging and checks | `mods/ledgr/nav.js`, `bin/tests/test_nav.mjs`, `test-nav.sh` (copies words.js, which nav.js now imports), `test_no_keystrokes.py`, `test-detail.sh` (new: runs test_list.mjs and test_detail.mjs, skipped without node, one summary line), `run-all.sh` (one line for it) |

Beyond the brief's lists: `reader.js`, `listing.js` and `test_list.mjs` (A); `detailing.js` and
`test_detail.mjs` (B); `test-nav.sh`, `test-detail.sh` and `run-all.sh` (C). Nobody touches store.js,
writer.js, config.js, confluence.js, branch.js, spool.js, capture.js, pinning.js, host.js, keys.json,
setup/ or the Python hooks; a builder who finds it needs one stops and reports. No spool event
changes, so the Python side and `test_compose.mjs` are untouched. Docs are the orchestrator's.

### 5.2 Shared contracts

| Contract | Defined by | Used by | Shape |
|---|---|---|---|
| `Reader` (reader.js) | A | B (`Detail extends Reader`), C (the static test) | 1.11: `constructor(cx, {demo})`; fields; `startReading`, `fallback`, `viewStore`, `reload`, `bump`, `overlayLocal`, `watchStore` (+ `onConfig` hook), `tickRead`, `post`, `act`, `typeDraft`, `flushPending`, `answerOf`, `pasteOn`, `demoHow`, `stage` (+ `afterStage(r, text, terminal, cx)` hook), `stageAnswers`, `copyAnswers`, `copyAnswer`, `trunkWord`, `parentLive`, `branchable`, `branchLive`, `terminalGone`, `transcriptOk`, `loadPassage`, `pinAct`, `resume` |
| listing.js | A | B | `BR_WORD`; `firstLine(text, n = 160)`; `glyphOf(it, sug) → [char, tone]`; `stateOf(kind, x, ctx) → {word, tone}`; `rowModel(kind, x, ctx) → {key, kind, id, sessionId, handle, pill: {text, tone} \| null, text, state: {word, tone}, glyph, quick: {done, paste}, tip}` with `ctx = {threshold, now, here, store, branchLive: (br) => string}`; `entryKey(kind, id)`; `moveCursor(keys, cursor, delta)` (delta ±1, ±8, "home", "end"); `keepPlace(prevKeys, keys, cursor)` |
| `stageMessage(gate, msg, terminal, cx, w)` | C | A (`Reader.stage`) | 3.2; returns a boolean |
| detailing.js | B | A (`openDetail`) | `DETAIL`, `KINDS`, `OPEN_STATES`, `detailProps`, `detailSpec`, `kindOf`, `closesAfterStage`, `mergeClosed`, … (2.9) |
| Dialog props | A writes | B reads | `{view: "detail", session, kind, id, open: OPEN_STATES \| null, sel: [pn_ ids], opener: panelId, demo: boolean}` |
| `shared("ledgr.detail")` | B writes | A reads | `{open: {overlay, opener, session, kind, id, at} \| null, closed: {overlay, opener, session, kind, id, at, flash, focus: "list" \| "pane" \| null, terminal, drafts: {[itemId]: text}} \| null}` |
| words.js | B | A | `stageLabels(paste).quick`; existing exports unchanged |
| Commands | A (panel), B (dialog) | main.js header (B), scripted checks | 1.10, exact names |
| Method names | A, B | C | reader.js: `stage`, `stageAnswers`, `copyAnswers`, `copyAnswer`, `pasteOn`; detail.js: `askPinsHere`, `sendToTrunk`, `copyConfluence`, `copyPin`, `copyPinsMessage`, `copyText`, `stageQuestion`, `goTo`, `goToPin`, `afterStage`; two-space-indented class methods, `name(args) {` on one line |
| Store | nobody changes it | A, B | `item`, `itemsOf`, `pin`, `pinsOf`, `pinsIn`, `byHandle`, `pinByHandle`, `branchesFor`, `branchesOf`, `branchPins`, `turnInfo`, `searchPins`, `clearable`, `counts`, `threshold`, `d.sessions`, `d.branches` |
| Engine rule | everyone | | engine files never import reader.js, listing.js, detailing.js, views.js, detail.js, words.js, nav.js |

### 5.3 Integration

Merge order C (nav.js, which reader.js imports), A (reader.js, listing.js, panel.js), B. Three checks
pass only when all three are in: `test_no_keystrokes.py` (A's reader.js and panel.js, B's detail.js,
C's rules), `test-detail.sh` (A's and B's Node tests), and `herdr-app check mods/ledgr` (B's
`Detail extends` A's `Reader`). Then `bash tests/run-all.sh` once (never two suites at a time),
`herdr-app check` for `mods/ledgr`, `mods/ledgr-pane` and `mods/my-tabs`, the installer (Jesse runs
it), and the live check (6.5).

## 6. Tests

### 6.1 Builder A (`test_list.mjs`, Node, self-contained like `test_compose.mjs` with no argument)

It copies listing.js, words.js, store.js, config.js, branch.js and confluence.js into a scratch folder
with a stub `herdr` (listing.js takes the store's predicates: `isAgentAsk`, `isClosed`, `isSuggestion`,
`isBlocking`, `levelOf`).

- `firstLine`: the first non-empty line, whitespace collapsed, cut with "…".
- `glyphOf`: every status; an unsettled question; an open blocking ask; a suggestion.
- `stateOf`: every row of 1.3, each kind, first match winning (a deferred question with a branch is
  "deferred"; a resolved ask with `resolvedBy` answer is "answered by you").
- `rowModel`: the pill rules of 1.2; `quick.done` false for closed items, pins and branches;
  `quick.paste` only for an ask not closed with a draft; the bookmark text; the tip.
- `moveCursor`: down from none is the first, up from none the last; clamped at both ends; home, end;
  ±8.
- `keepPlace`: a key still present stays; a removed key goes to the next present one, else the one
  before; everything gone gives null; a key that moved keeps itself.
- By hand: `herdr-app check mods/ledgr`; `herdr-app do ledgr.demo`; the rows at 280 and 360 px
  wide (nothing wraps, Done and Paste fit); `list-key:down`, `list-key:enter`, `list-key:space` on a
  pin, `list-key:escape`.

### 6.2 Builder B (`test_detail.mjs`, Node, self-contained)

It copies detailing.js, words.js and fixtures.js, with what fixtures.js loads (store.js, config.js,
branch.js, confluence.js), into a scratch folder with a stub `herdr`. detailing.js itself imports
nothing.

- `detailProps`: each kind; a bad kind, an empty or 200-character id, an unknown `open`, a `sel` with
  13 ids or non-`pn_` ids (cut, dropped); `demo` only when `true`.
- `detailSpec`: mod ledgr, kind dialog, width 0.6, height 0.75, `props.view` "detail", never a
  `layout`.
- `locate`, `passageParts`: exact, whitespace-tolerant, markdown marks ignored, a long list
  paragraph, whole and around.
- `mdVerbatim`: `# h`, `1. x`, `- x`, `> q`, a backtick span, `*x*`, `_x_`, `[a](b)`, `<b>`, `|`,
  a trailing backslash; unescaping its output gives the input back; line breaks become hard breaks.
- `closesAfterStage`: every row of 3.1.
- `mergeClosed`: its own open record cleared; a newer one kept.
- `keptConclude`, `keepConclude`: kept, offered back, expired after a day, older than the posted
  conclusion ignored.
- words: `stageLabels(true).quick` "Paste", `(false).quick` "Copy"; `pinUseLines` order and wording.
- fixtures: every demo case of 2.10 exists by handle; P3 archived; the forgotten-session pin.
- main.js, as text: `view === "detail"` is tested before `isCapture`; `close` awaits `release`.
- By hand: `herdr-app check mods/ledgr`; `herdr-app do ledgr.demo-detail` and
  `demo-detail:Q3`, `:Q9`, `:P2`, `:br-q3-7c1e`, `:Q5`; one and two columns (resize the window).

### 6.3 Builder C (`test_nav.mjs`, `test_no_keystrokes.py`, runners)

- `stageMessage` with `{pasting: 0}`: a paste says twice (the "copied; pasting it…" line with `r`
  null, then `stagedWords` plus the tail with `r`), returns true, leaves `pasting` at 0; a second call
  while one is pending returns false, says "Still pasting into …", and writes no clipboard and focuses
  nothing; off, blocked, plain and gone say once, at once, with `r`; a gate older than
  `PASTE.waitMs + 400` lets the next one through. The global rules at the end of test_nav.mjs
  (:217-228) hold over these calls too.
- test_no_keystrokes.py: the rules of 3.3.
- test-nav.sh copies words.js; test-detail.sh and its run-all.sh line.

### 6.4 Probe P1 (before the builders start; the orchestrator, throwaway only)

A scratch mod `~/.config/herdr-app/mods/ledgr-probe/` (not in the repo; removed afterwards):
`mod.json` `{"place": "none", "title": "probe", "overlay": {"kind": "dialog", "width": 0.6,
"height": 0.75}}`, and a `main.js` of about 60 lines whose view shows a selectable TextView, a
button and a log. In a new throwaway pane run `cat`; note its terminal; `herdr-app do
mod.open:ledgr-probe`.

1. The button: clipboard "probe text", `run("pane.focus", {terminal})`, `focused()` every 50 ms
   (logged), `run("terminal.paste")` after two looks on the target, `closeOverlay` 200 ms later. Note:
   (a) the dialog stayed open through `pane.focus`; (b) `focused().terminal` after it; (c) the text
   landed on `cat`'s line, not submitted; (d) after the close, a typed `x` lands in `cat`.
2. Esc: the root's `on_key_down` logs "escape" before the dialog goes, or not. A click outside: no
   "escape" logged, `close(cx)` called.
3. Drag-select in the TextView, ⌘C, then ⌘V into `cat`: the selection was copied.
4. Close the pane; remove the probe mod.

(a)-(d) yes: the design of 3.1 stands. (a) or (c) no: F1 (3.4). (d) no: the closed record's
`focus: "pane"` already handles it (1.9). (2) decides whether Esc can be told from a click outside;
if not, `focus` is "list" for every close that was not a staging.

### 6.5 Manual live check (throwaway sessions only, after integration)

Never in a real session. Scratch folders, new panes, closed at the end; test items and pins removed
through the panel's own events.

1. `mkdir -p /tmp/ledgr-detail-a`; in a new pane `cd /tmp/ledgr-detail-a && claude`; ask it for
   three numbered facts about TCP, then to ask you to choose "fast" or "safe" and to give it a port
   number, and to stop until you answer.
2. The list: one line per item, Done on hover, no wrapping at the panel's width. Click the decide
   ask: the dialog opens centered at about 60 % × 75 %, the message on the right with the passage
   marked and in view. Drag-select a sentence of the message and of the ask's text, ⌘C, ⌘V into the
   answer box: it pastes.
3. Click an option, then Paste answer: the dialog closes, the sheet is in the pane's prompt and not
   sent, and the keyboard is in the pane: type a word, press Enter (the person). The ask reads
   "answered", then closes on its own at the turn's end.
4. Click the list, ↓ ↓, Enter on the other ask; type an answer; Esc: the dialog closes, the cursor
   is on that row, the row shows Paste. Paste on the row: pasted, not sent.
5. ⌘J, park a question; open it; Branch…, Launch; open its branch row; Conclude…; type a line; Esc;
   reopen the branch and Conclude…: the line is still there; Paste into trunk: lands; Close branch.
6. Select a sentence, ⌘J, ⌘S (a pin); open the pin: the passage and the message, the passage marked;
   Note, Enter; Archive (the dialog closes); "archived (1)", open it, Restore, Archive, Delete twice.
7. With a dialog open: ⌘J (does the capture box open on top, or does Herdr close the dialog?
   Either is acceptable; write down which); Tab in the answer box moves to the dialog, not into a
   capture box; ⌘S in the dialog does nothing.
8. `herdr-app status`: no mod errors. `herdr-app do ledgr.collapse-all` closes an open dialog.
9. Clean up: Forget the session after closing its pane; `rm -rf /tmp/ledgr-detail-a`.

## 7. Out of scope, and open questions

Out of scope: moving through items inside the dialog (↑ ↓ to the next item in place); a draggable
`window` dialog; keyboard shortcuts for actions in the dialog beyond Esc, Tab and Enter in fields;
pinning a selection from the dialog (no API reads a TextView's selection); editing a question's text;
the panel and views.js sharing their atoms (`btn`, `pill`, `menuButton` exist twice this round; the
meanings, `glyphOf`, state words and pills, are shared through listing.js); any store, event, MCP or
installer change.

Open questions (at most three):

1. Staging from the dialog: the design of 3.1, or F1 (3.4)? It turns on Probe P1, which must run
   before the builders start, since F1 changes A's and B's work.
2. Promote leaves the row. Jesse runs `extract.threshold` at `blocking`, so his needed asks sit below
   the threshold, and promoting one was one click on its row (panel.js:2114-2117); now it is Enter (or
   a click), then Promote. Recommended: keep the decision's two quick actions; the alternative is a
   third, on suggestion rows only.
3. A way into the list without the pointer. Recommended: the `focus-list` command, bound to no key
   unless Jesse names one. `"focusable": true` in mod.json would let `pane.go` reach the panel, but
   also the host block (one mod.json for every copy), where the keyboard would have nothing to do.

## 8. Where the current code shaped this

| Code | What it decided |
|---|---|
| panel.js:2103-2104 | a row head's click folds the row, so a click on its text folds it: rows open a dialog instead (1.2) |
| panel.js:2147-2155 | the message is three TextViews: three selectable blocks, Copy message for the whole (2.3) |
| panel.js:2150; :2364, :2444 | capped scroll boxes inside a scrolling list misbehave: no caps in the dialog, two scrolling columns (2.2) |
| panel.js:144-371 | reading, acting and writing live in one class: the reader half becomes `Reader` (1.11) |
| panel.js:337-351, config.js:159-161 | the panel pings and may run a fallback writer, and `herdr-app check` shares the window's shared state: the dialog never pings, and writes `ledgr.detail` only behind `liveHome()` (2.1) |
| panel.js:658-675; AGENTS.md:910-920 | drafts post after 800 ms and a closing overlay cancels its tasks: `flushPending` in `close`, `postAndClose` (2.5, 2.7) |
| panel.js:758-767; test_no_keystrokes.py:134-138 | one staging door, `panel.stage`: it becomes nav.js `stageMessage` behind `Reader.stage` (3) |
| nav.js:118-145 | the paste waits in a task for the focus: the dialog stays open until it is decided (3.1) |
| panel.js:990-998, :222 | retained state is made in init, a handler or a task, never in render: the dialog's inputs are made in its start task or handlers (2.7) |
| panel.js:1185-1213 | menus keep their state on the panel: views.js `menuButton` takes a host (2.9) |
| panel.js:374-553 | scripted commands act on the panel's own UI state: each is routed to the copy that has the state (1.10) |
| panel.js:555-582 | the demo opens a confirmation and a Conclude editor inside the panel: they live in the dialog now (2.10) |
| main.js:49-53, :73-75 | any overlay without a `view` is the capture box, and `close` does not await `release`: the detail branch first, an awaited close (2.1) |
| keys.json `mod:ledgr`; AGENTS.md:505-507, :826 | Tab, ⌘Enter and ⌘S become commands for every shown copy: the dialog takes Tab only for its own fields, ignores the rest (2.7) |
| herdr.d.ts:344-369; AGENTS.md:994 | sizes are px or shares with no minimum, and Esc closes the top dialog whatever has the keyboard: shares plus a responsive layout, and nothing typed kept only in memory (2.2, 2.7) |
| gpui-kit.d.ts:20406-20411, :21295-21306 | `is_focused()` and `ScrollHandle.scroll_to_item` exist: Space and Enter only when the list itself has the keyboard; the cursor and the passage scrolled into view (1.6, 2.3) |
| BUILD-NOTES-mod.md:161 | overlays keep `localStorage` across opens, possibly shared with the capture box: keys start with `detail.` (2.7) |
