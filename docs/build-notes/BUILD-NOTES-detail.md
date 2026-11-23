# ledgr list and detail dialog: build notes (2026-11-10)

The panel is a scan list: one line per ask, question, pin or branch. A click on a row, or Enter on
the cursor row, opens a centered detail dialog that shows the item whole, its text, quote and message
selectable, with every action the expanded row had. Esc or a click outside closes it, and the list
keeps its place. Herdr 0.1.13, hc 0.1.18, Claude Code 2.1.311. Spec: `docs/design/Detail.md`, the
contract; Section 11 of `docs/design/Herdr ledger mod design.md` points to it and lists where the
build departs. Earlier notes: `BUILD-NOTES-mod.md` (the panel as first built), `BUILD-NOTES-pins.md`
(the PINS lane, whose open row now lives in the dialog), `BUILD-NOTES-phase2.md`,
`BUILD-NOTES-phase3.md` (the confirmation and the Conclude editor, now in the dialog).

Jesse, 2026-11-10: "when trying to view the side bar entries, I can't interact with the text. what if
the sidebar was a bit more simplified list and clicking on an item opened a larger central modal". He
approved the spec's shape the same day.

The cause: a row's text was a plain `div`, which Herdr cannot select, inside the row head whose
`on_click` folded the row (panel.js:2103-2104 before this change), so a drag meant for the text folded
it. Herdr selects text only in a markdown `TextView` with `.selectable(true)` or in a read-only
Editor. `mod.json` declares one overlay (the capture box), so the dialog opens with `openOverlay` and
props; a `kind: "dialog"` overlay is centered, dims the window, takes the keyboard, and closes on Esc
or a click outside. The shipped Linear mod is the nearest pattern (a list, a detail screen with
`TextView.markdown(...).selectable(true)`, Esc back).

Status on 2026-11-10: built by three builders to the spec's ownership table (A: the list and the
Reader; B: the dialog; C: staging and the checks), after Probe P1 (section 8), integrated,
uncommitted. The offline suites pass (section 10) and `herdr-app check` passes. `panel.js` went from
2,454 to 1,592 lines. The manual live check (section 11, spec 6.5) is not done: nothing that needs
real keys, a real pane or a real selection has been tried. `preview.png` and the recipe's look at the
panel predate this change and need a retake (`docs/preview-recipe.md`), not done.

## 1. Files

Line numbers as read on 2026-11-10. None of the new files is an engine file: `ENGINE_FILES`
(`writer.js`) is unchanged and no engine file imports them, so the overlay's `my-tabs` copy is
untouched.

- `mods/ledgr/reader.js` (new, A, 350 lines): `class Reader` (:28), what every reading copy shares,
  moved out of `panel.js` nearly verbatim. `PIN_ACTS` (:26). Reading :51-147, acts :153-223, the one
  staging door `stage` (:231), `copyAnswers` (:235), `copyAnswer` (:242), `stageAnswers` (:245),
  Herdr lookups :260-349. Section 2.
- `mods/ledgr/listing.js` (new, A, pure, 190 lines): `BR_WORD` (:11), `BR_TONE` (:15), `firstLine`
  (:23), `glyphOf` (:31), `rowKind` (:41), `entryKey` (:47), `stateOf` (:59), `rowModel` (:120),
  `moveCursor` (:167), `keepPlace` (:181). Imports `store.js` predicates and `words.js` only; the
  dialog's sub-rows draw the same model.
- `mods/ledgr/panel.js` (A): `class Panel extends Reader` (:98). The list's constants `LIST_KEYS`
  (:90), `NAV_KEYS` (:91), `PANEL_IGNORES` (:94), `DEMO_DETAIL_HANDLE` (:96); the keyboard fields
  (:138-155); `command` (:245; the new and re-routed commands :258-345), `resolveHandle` (:426),
  `render` (:620), `put` (:675), `isCur` (:681), `focusList` (:683), `reveal` (:686), `settleCursor`
  (:694), `onKey` (:710), `listKey` (:721), `focusFirst` (:731), `searchSubmit` (:739), `detailOn`
  (:745), `openDetail` (:751), `closeDetail` (:764), `noteDetail` (:779), `rowEntry` (:808),
  `listRow` (:822), `quickBtn` (:875), `hoverRow` (:884), `runThen` (:1195), `body` (:1424). It keeps
  the writer fallback, the header, session menu, spaces, Clear N, the lane heads and folds, the PINS
  search and selection, motion, and drops every expanded-row renderer and its state (`expanded`,
  `whole`, `inputs`, `confirm`, `conclude`, `closeAsk`, `brOpen`, `preOpen`, `brMsg`, `gitOk`,
  `pinOpen`, `pinWhole`, `pinNote`, `pinDel`).
- `mods/ledgr/detail.js` (new, B, 1,151 lines): `class Detail extends Reader` (:54). Lifecycle:
  `constructor` (:55), `start` (:99), `buildDemo` (:110), `resolve` (:126), `prepare` (:136),
  `makeAnswer` (:145), `track` (:159), `writeOpen` (:166), `isCurrent` (:174), `applyOpen` (:180),
  `runOpenAction` (:195), `focusFirst` (:219), `close` (:231), `closeTo` (:237), `release` (:245),
  `draftsOut` (:258). `command` (:265), `isMine` (:323), `panelBranch` (:332), `tabField` (:343),
  `retarget` (:356). Acts: `postAndClose` (:371), `actClose` (:401), `setDraft` (:407). Staging and
  copies: `afterStage` (:416), `askPinsHere` (:426), `sendToTrunk` (:439), `copyConfluence` (:456),
  `copyPinsMessage` (:465), `copyPin` (:475), `copyText` (:482), `stageQuestion` (:492), `goTo`
  (:503), `goToPin` (:511), `askAbout` (:521). Branches and the confluence, moved from `panel.js`:
  `openConfirm` (:530) to `pumpBranch` (:683), with `readKept`, `saveKept`, `forgetConclude`
  (:652-662). Pins: `pinsFor` (:704), `openPinsBox` (:712), `editPinNote` (:725), `archivePin` (:736),
  `deletePin` (:742). Drawing: `render` (:756), `header` (:820), `itemParts` (:869), `aboutLines`
  (:910), `resultLines` (:930), `pinParts` (:954), `messageParts` (:991), `footer` (:1031),
  `itemActions` (:1052), `pinActions` (:1107).
- `mods/ledgr/views.js` (new, B, 371 lines): the renderers moved out of `panel.js`, each taking the
  dialog as `host`: `ICON`, `IND`, `TEXT_SCROLLABLE` (:27), `tone`, `btn`, `pill`, `badge`, `glyph`,
  `chip` (:58), `menuButton` (:69), `readable` (:103), `section` (:114), `lines`, `messageBlocks`
  (:131), `manifestView` (:146), `optionChips` (:155), `answerBox` (:168), `confirmBox` (:181),
  `confluenceView` (:211), `concludeBox` (:230), `rowCtx` (:266), `subRow` (:271), `branchBody`
  (:290), `branchActions` (:331), `pinNoteBox` (:358), `keyHints` (:367).
- `mods/ledgr/detailing.js` (new, B, pure, imports nothing, 195 lines): `DETAIL` (:10), `KINDS`,
  `VIEW_STATES`, `ACTION_STATES`, `OPEN_STATES` (:11-18), `KEEP_KEY` (:21), `detailProps` (:31),
  `detailSpec` (:45), `twoColumns`, `leftWidth` (:52-53), `kindOf` (:57), `locate` and
  `passageParts` (:72, :88, moved from `panel.js`), `MD_SYNTAX` (:114), `mdVerbatim` (:122),
  `hardBreaks` (:131), `STAGE_CLOSES` and `closesAfterStage` (:152-153), `focusAfter` (:162),
  `mergeClosed` (:170), `keptConclude` (:177), `keepConclude` (:188).
- `mods/ledgr/nav.js` (C): `stageMessage` (:158), the one caller of `stageIntoPrompt` (:122); imports
  `stagedWords` from `words.js`.
- `mods/ledgr/main.js` (B): the detail view routed before `isCapture` (:76), which takes any overlay
  without a `view`; `close` awaits `release` (:93); the header lists the view and the commands.
- `mods/ledgr/words.js` (B): `stageLabels(paste).quick` ("Paste" / "Copy", :74), `DETAIL_GONE` (:171),
  `messageGone` (:174), `PIN_MESSAGE_GONE` (:175), `copiedWords` (:179), `detailHints` (:183),
  `pinUseLines` (:196). Nothing existing changed.
- `mods/ledgr/fixtures.js` (B): an archived Pin 3 of the demo session (:163, `nextHandle.P` 4, :181),
  a pin of a forgotten session (`SIDF`, :29, :165), `DEMO_DETAIL` "A15" (:219).
- Tests: `bin/tests/test_list.mjs` (new, A), `test_detail.mjs` (new, B), `test-detail.sh` (new, C,
  runs both), `run-all.sh` (one line), `test_nav.mjs` and `test-nav.sh` (C), `test_no_keystrokes.py`
  (C, rewritten around the 11 rules), `test_compose.mjs` (one check now reads `askPinsHere` in
  `detail.js`).

`mod.json`, `keys.json`, the installer's `MOD_KEYS`, the store, the writer, the hooks and every spool
event are unchanged: the dialog posts exactly what the panel posted.

## 2. The Reader

`class Panel extends Reader` and `class Detail extends Reader`. A Reader reads `store.json` and
follows it, posts spool events, keeps drafts, stages, and asks Herdr about sessions; it never pings,
never claims `ledgr.writer` and runs no Writer (the panel adds its fallback writer on top).

| Member | Does |
|---|---|
| `constructor(cx, {demo})` | `cfg`, `demo`, `demoStore`, `live`, `liveText`, `localActs`, `drafts`, `passages`, `txCheck`, `pasting`, `flash`, `rev`, `revAt`, `rcx`, `inApp`, `unwritten` (evId to `{type, payload}`) |
| `async startReading(cx)` | `liveHome()` guard: false under `herdr-app check` (nothing read, nothing shared); else `inApp`, `loadConfig`, `reload`, `watchStore`, true |
| `fallback()`, `viewStore()` | false; the demo store, else `live`. The panel overrides both for its fallback writer |
| `reload()`, `bump()`, `overlayLocal()` | read `store.json` when it changed; apply this copy's acts and drafts not yet in it |
| `watchStore(cx)` | one `watchFolder` on `ledgr-data` per copy; a config change calls `this.onConfig?.(cx)` |
| `tickRead(cx)` | the 60 s backstop: one reload |
| `post(type, payload, local, cx, after)` | a spool event, shown at once (`overlayLocal`), kept in `unwritten` until its write resolves; `after(ok, cx)`, when given, runs in the same task once the write resolved or failed |
| `act`, `typeDraft` | an item's act; a typed answer, shown at once, posted 800 ms after the last change |
| `async flushPending()` | posts every draft still inside its 800 ms and writes again every event in `unwritten` (the same id: the store drops a second copy), awaiting each |
| `answerOf`, `pasteOn`, `demoHow` | the ask's answer (its draft); `ui.pasteIntoPrompt !== false`; the demo's words |
| `stage(msg, terminal, cx, w)` | the one staging door: `stageMessage(this, msg, terminal, cx, {...w, paste: this.pasteOn(), say})`; `say` sets the flash and, once the result is known, runs `this.afterStage?.(r, text, terminal, cx)`; a staging that went ahead is kept in `staged` (`{terminal, what, where, lead}`), and `pastePending()` says whether its paste still waits |
| `copyAnswers`, `copyAnswer`, `stageAnswers` | the turn's answer sheet, one ask's sheet; each stages through `this.stage(msg, s.terminal, cx, …)` |
| `trunkWord`, `parentLive`, `branchable`, `branchLive`, `canConclude`, `terminalGone`, `transcriptOk`, `loadPassage`, `pinAct`, `resume` | Herdr lookups and the remaining shared acts; `transcriptOk` uses the cx of the copy's last render (`this.rcx`) |

## 3. The list

### 3.1 The row

`listing.js` `rowModel(kind, x, ctx)` (`ctx = {threshold, now, here, store, branchLive}`) returns
`{key, kind, id, sessionId, handle, pill, text, state, glyph, quick, tip}`; `panel.js` `listRow` draws
it as one `h_flex`, `h(26)`, `px(6)`, `gap(6)`, `rounded(6)`, no wrap. In order: a pin's checkbox; the
glyph column (12 px: the status glyph, or the `pin`, `git-branch` or spinning `spinner` icon named in
`glyph[2]`); the handle in words (11.5, semibold, `muted`: "Ask 5", "Question 3", "Pin 4", "branch of
Question 3"); one pill (10 px on its tone at `22`); the text's first line (`firstLine`, 160
characters, `truncate`; dim when closed or a branch, `muted` for a suggestion, struck through when
dismissed; at least `ROW.textMinW`, 48 px); the state word (10.5, its tone, capped at
`ROW.stateMaxW`, 104 px, and truncated first, so a row fits at 280 px; a branch that did not start
says "did not start", the dialog keeping the toast hint), left out when Paste is shown; the quick
actions. Element ids stay `row-<id>`, `pin-<id>`, `br-<id>`; a child question drawn a second time
(under its ask and in its lane) gets `-dup` and is no entry. The tooltip: the text's first 300 characters, then the
quote's first 120 in quotes; a pin adds its note.

| Kind | Pill | Text |
|---|---|---|
| ask | `blocking` (`blocked`); a suggestion: its level (`dim`); else its kind (`dim`) | the first line |
| question | "2 pins" (`accent`); `bookmark` (`dim`); `/btw` (`muted`); else none | the first line; a bookmark: its quote's first line in quotes |
| pin | none | the passage's first line |
| branch | its hc name, `br-q3-7c1e` (`dim`) | its question's first line |

State words (`stateOf`, first match wins) are exactly the table of spec 1.3: for an ask answered by
you, closed by agent, resolved by branch, done, cleared, not needed, deferred, answered, below
threshold, answer ready, raised again, open; for a question resolved by branch, done, cleared, not
needed, deferred, rejoining, answered, branch working / needs you / idle / concluded, sent at turn N,
anchoring, parked; for a pin archived, answered, sent, used, unverified, else its age; for a branch
its live word (`BR_WORD`).

Quick actions (`quick`), small bordered buttons (`h(18)`) that stop the click's propagation:

| Action | Shown | Does |
|---|---|---|
| Done | an ask or question not closed, on the hovered row and the cursor row only | `act(id, "resolve")` |
| Paste (Copy with `ui.pasteIntoPrompt` off) | an open ask (not answered, deferred or closed: the store keeps the draft after the answer lands) not below the threshold whose answer is typed or picked; it stands for the state word | `copyAnswer`: the one-ask sheet through `Reader.stage` |
| Promote | an ask below the threshold, not closed, always | `act(id, "promote")` |

The row whose dialog is open (`shared("ledgr.detail").open`) is drawn `raised`; the cursor row,
while the list holds the keyboard, `selected` with a 2 px `accent` left edge.

### 3.2 The keyboard

- `this.keys = cx.focus_handle()` (:143); the root `v_flex().id("ledgr")` has
  `.track_focus(this.keys).on_key_down(…)`; `ledgr-list` has `.track_scroll(this.listScroll)`.
- A click on a row, a lane head or a fold line calls `focusList()` first; a row's click also moves
  the cursor to it and opens its dialog.
- Entries are recorded while `body()` builds the list (`put(out, el, key, enter, space)`): every line a
  click acts on, in drawing order, with its index among the direct children of `ledgr-list`. Keys:
  `lane:pins`, `lane:mine`, `lane:asks`, `pin:<id>`, `more:pins`, `arch:pins`, `pgroup:<sid>`,
  `item:<id>`, `branch:<id>`, `group:<turn>`, `sheet:<turn>`, `sug:<…>`, `err:<turn>`. The selection
  bar, the search box, Clear, the threshold menu and the footer are not entries.
- Keys, matched on `e.keystroke`: ↑ ↓ (one), PageUp / PageDown (eight), Home / End, Enter (what the
  entry's click does: a row opens its dialog, a head or fold line toggles, the sheet line stages the
  sheet, Retry retries), Space (a pin row: its checkbox), Esc (clears the cursor). ↑ ↓ and PageUp /
  PageDown also come up from the pins search box; the others act only when `this.keys.is_focused()`,
  so a space typed in the box never checks a pin. An open menu keeps its own keys. Enter in the search
  box opens the cursor's pin, else the first result. Tab, Shift-Tab, ⌘Enter and ⌘S are `mod:ledgr`
  commands and never reach `on_key_down`.
- The cursor is an entry key in memory, reset when the shown session changes. `moveCursor` moves it;
  `reveal` calls `listScroll.scroll_to_item(index)`, which scrolls only as much as needed.
  `settleCursor` runs after each build: a cursor a closed dialog asked for (when listed), then
  `keepPlace`, so a row that left (Done, a store change) hands the cursor to the entry after it.
- `ledgr.focus-list`, bound to no key: the list takes the keyboard, the cursor on its first row.
  `mod.json` has no `"focusable": true`: one `mod.json` serves every copy, so the host block would
  become a pane stop with nothing for the keyboard to do.
- For scripted looks: `cursor:<handle>` (the list takes the keyboard, the cursor on that row) and
  `list-key:<up|down|pageup|pagedown|home|end|enter|space|escape>`.

### 3.3 Opening and the panel's commands

`openDetail(kind, id, sid, o, cx)` (:751) closes the open dialog first (`closeDetail`: this copy's
and the one `ledgr.detail` names; their closed records then move nothing), then
`this.detailId = openOverlay(detailSpec({session: sid, kind, id, open: o.open ?? null, sel,
opener: this.panelId, demo: this.demo}))`, moves the cursor to that row and clears the flash. `sel`
is the panel's pin selection when that pin is in it. A pin opens in the shown session (`rowEntry`
:811, `listRow` :858), from the lane or from search, so a question built from it parks there.
Callers: a row's click, Enter, `open:<handle>`, `demo-detail[:<handle>]`, `runThen` (after the box
parked a question with pins: the question's dialog, or its Branch confirmation), and the re-routed
commands: `branch` (the newest open parked question, `open: "confirm"`), `go:`, `whole:`, `menu:`,
`ask-here:` (that state), `conclude`, `ask-conclusion`, `copy-confluence`, `close-branch` (the
newest fitting branch of the shown session, in state "conclude", "ask-conclusion", "again",
"close"). When the dialog is already open on that item (`detailOn`), the panel leaves the command to
it; `pick:` and `copy-answer:` do the same, else the panel posts the draft or stages the answer
itself. `expand-all` and `expand-branches` now say "Rows open in the detail dialog:
ledgr.open:<handle>"; `collapse-all` closes the open dialog and clears the cursor. `PANEL_IGNORES`
(:94) and every `detail:` and `conclude-edit:` command are the box's or the dialog's.

## 4. The dialog

### 4.1 Props, routing, lifecycle

`main.js` routes `view: "detail"` to `Detail` before `isCapture`. Props, checked by `detailProps(p,
LIMITS.pinsPerQuestion)`: `{view: "detail", session, kind, id, open, sel, opener, demo}` plus
Herdr's `overlay`; a bad view, kind or id renders "Nothing to show (<why>)" with Close; an unknown
`open` is dropped; `sel` keeps `pn_` ids, each once, at most 12; `demo` only when `true`. `kind` is a
hint: the record decides (`pn_` a pin, `br_` a branch, else an ask or a question by its
`direction`). `detailSpec` returns `{mod: "ledgr", kind: "dialog", width: 0.6, height: 0.75, props}`,
never a layout.

1. The constructor checks the props, makes the focus handles and the two `ScrollHandle`s, starts
   the 60 s `tickRead`, and spawns `start`. The demo builds its own store from `demoData()` at once,
   with the branches' manifests and preambles as the writer computes them.
2. `start`: `startReading`; when `inApp`, `writeOpen` (the open record); `prepare` (the answer
   `InputState`, the anchor turn's text); `applyOpen`; `focusFirst` (an open ask's answer, the note,
   the Conclude text, else the dialog; now and again after 400 ms unless a field has it).
3. It never pings, never claims `ledgr.writer`, runs no Writer, and writes no shared key but
   `ledgr.detail`, and that only behind `liveHome()`.
4. `close()` is `closeOverlay(this.overlay)`; `closeTo(terminal)` closes with the keyboard left in
   that pane.
5. `release()` (from `View.close`: Esc, a click outside, a closing act, a staging): writes the closed
   record first with `mergeClosed` (the open record cleared only when it names this overlay), then
   awaits `flushPending()`. `View.close` awaits `release`, since Herdr cancels the copy's tasks once
   `close()` resolves.

The record gone (session forgotten, pin deleted, item archived away): `DETAIL_GONE` and Close only;
"Reading the ledger…" until the first read.

### 4.2 Layout

Root `v_flex().id("ledgr-detail")`, `track_focus`, `on_key_down` (Esc), `on_size_change` (the width),
`popover` background, 12.5 px. Header `dt-head`, 44 px: glyph, the handle in words (13, semibold), the
pill, the facts (`decide · turn 17 · declared by the agent`; a pin's anchor words; a branch's
depth), the state word, the session (agent pill, name, pane; a forgotten pin's `source` and
"forgotten"), a `demo` pill, "Esc". Body: from 760 px wide two columns, `dt-left` at 46 % of the
width and `dt-msg` (`border_l`), each `overflow_y_scrollbar` with its own `ScrollHandle`; narrower,
one column with the message blocks last. Footer `dt-foot`: the status line, the actions (`flex_wrap`),
the key hints (`detailHints`: Esc close; Tab next field when there is a field; Enter "paste the turn's
answers" in the answer, "save the note" in the note). While a closing act is written or a paste is
pending, the body and the actions are dimmed to 0.55.

### 4.3 Readable text

`views.js` `readable(t, id, text, {mode})`: `TextView.markdown(id, md).selectable(true)`, not
scrollable (`TEXT_SCROLLABLE` false, :27: the columns scroll, spec 2.2). Mode "verbatim" (`mdVerbatim`: every ASCII punctuation
character markdown reads as syntax backslash-escaped, line breaks as hard breaks, leading spaces as
no-break spaces) for the person's and pinned text: a question's text and quote, a pin's passage and
note, an answer, `it.note`, the Conclude text. Markdown as written (`hardBreaks`: single line breaks
kept, fences untouched) for an ask's text and quote, the message, a branch's last message and its
preamble. Ids are stable per item and block (`dt-text-<id>`, `dt-quote-<id>`, `dt-pin-<id>`,
`dt-msg-b-<id>`, `dt-msg-h-<id>`, `dt-msg-a-<id>`), so a selection survives a re-render. The message
is three blocks, before (`muted`), the passage (2 px `accent` edge on an `accent` tint) and after,
from `passageParts`; the passage block is scrolled into view once per message view. A selection
cannot run across blocks, so the message head has around / whole and Copy, and TEXT, QUOTE and
PASSAGE have Copy (`copyText`, `copiedWords`: "The passage copied (412 characters); nothing was
pasted.").

### 4.4 Sections

| Kind | Left column | Right column |
|---|---|---|
| ask | TEXT, QUOTE, OPTIONS (a decide), ANSWER (`answerBox`: Answer…, Paste answer, the Enter hint), RESULT (the answer, who closed it, raised again with the earlier ask as a sub-row, the note, deferred), QUESTIONS ABOUT IT (sub-rows), the foot line | THE MESSAGE · turn N, the quote marked |
| question | TEXT, QUOTE (BOOKMARKED PASSAGE for a bookmark), ABOUT (parked at, anchoring, interrupted, re-anchored, sent, /btw; the ask it is about as a sub-row), PINS (N) and BRANCHES (sub-rows), the Branch confirmation, RESULT, the foot line | as for an ask |
| pin | PASSAGE (badges unverified, clipped, archived), NOTE (or the note editor), ANCHOR, USED IN (`pinUseLines`, newest first, each line with a question opens it), the foot line | ITS MESSAGE · turn N, the passage marked; else `PIN_MESSAGE_GONE` |
| branch | `branchBody`: status and facts, errors, QUESTION (a sub-row), MANIFEST, ASKED IN THIS BRANCH, the confluence, CONCLUSION, the Conclude editor, PREAMBLE; the foot line | THE BRANCH'S LAST MESSAGE · its turn N (its newest finished turn), its `ledgr-conclusion` block marked; before its first turn ends, "The branch has not finished a turn yet" (`BRANCH_NO_TURN`) |

A sub-row (`subRow`) is one line from `rowModel`; its click retargets the dialog in place.

### 4.5 Actions and what they post

| Action | Kind | Posts or stages | Then |
|---|---|---|---|
| Done, Not needed, Defer ▾ (Tomorrow, In a week, Next session) | ask, question | `act` resolve / dismiss / defer, through `postAndClose` | closes once written, keyboard to the list |
| Reopen, Call off the confluence, Promote | any closed or deferred; `rejoin_pending`; a suggestion | `act` reopen / promote | stays |
| An option, typing an answer | ask | `act` draft (800 ms after the last change) | stays |
| Paste answer; Enter in the answer | ask | the one-ask sheet; the turn's sheet (`Reader.stage`) | closes once the paste is decided |
| Ask about this | ask | the capture box (`openOverlay`, 600 × 320), then the close | closes, keyboard to the box |
| Copy for prompt, Stage /btw | question without pins | `stageText` (clipboard, pane focused); /btw also `act` btw | closes, keyboard in the pane |
| Copy for prompt | question with pins | clipboard only (`copyPinsMessage`) | stays |
| Ask here | question with pins | the pins message (`askPinsHere`, `Reader.stage`) | closes once decided |
| Go to anchor | ask, question, pin | `goToAnchor`: a search slice, pane focused; the message switches to whole | closes, keyboard in the pane |
| Resume session… | terminal gone | `resume` | stays |
| Branch…, Branch again…, Launch | question | nothing; then `branch` | stays (the branch shows launching) |
| Paste confluence again | `rejoin_pending` question, concluded branch | the confluence (`Reader.stage`) | closes once decided |
| Conclude…, Edit conclusion…, Paste into trunk | branch | nothing; then `conclude` posted, then the confluence staged (posted first: a staging may close the dialog at once) | Paste into trunk closes once decided |
| Ask for a conclusion, Focus the branch | branch | clipboard, branch pane focused (or `terminal.peek`) | closes, keyboard in the pane (a peek: none) |
| Close branch (two clicks) | branch | `close_branch` | stays |
| Ask here…, Branch… | pin | the capture box in pins mode (600 × 340), parking in the panel's session | closes, keyboard to the box |
| Note, Edit note | pin | `pin_note` on Enter | stays |
| Copy | pin | clipboard only (`copyPin`) | stays |
| Archive; Delete (two clicks, archived only) | pin | `pin_archive`; `pin_delete`, through `postAndClose` | closes, keyboard to the list |
| Restore | pin | `pin_restore` | stays |

`postAndClose(type, payload, local, cx)` posts through `Reader.post` (in `unwritten`, so an Esc during
the write cannot lose it) and closes from its `after` once written; a failed write keeps the dialog
open with the error in the status line. The demo applies the act to its own
store and closes at once.

### 4.6 Open states, retarget, keys

- `open` (applied once the record is found; opened before `store.json` has it, the state waits and
  render prepares the record's fields, message and state when a reload brings it): "confirm", "conclude", "note", "whole", "answer", "defer",
  "more" show something; "go", "ask-here", "ask-conclusion", "again", "close" act once in
  `cx.timer.after(0, …)` (scripted commands only; "close" arms Close branch, the next
  `close-branch` ends it).
- `retarget(kind, id, session, cx)`: a sub-row, a usage line, a branch's question. The per-item state
  (inputs, confirmation, Conclude, menus, whole) is reset, the open record rewritten, the overlay
  kept; `release` reports the last target.
- Commands: the dialog acts only when `ledgr.detail`'s open record names it (`isCurrent`), except Tab
  and Shift-Tab (`mod:ledgr` `ledgr.tab` / `ledgr.backtab`), which it takes only while it or one of its
  own fields holds the keyboard, so a Tab in a capture box opened on top is never taken. Its own:
  `detail:close`, `detail:done`, `detail:whole`, `detail:pick:<n>`, `detail:answer:<text>`,
  `launch-branch`, `branch-split`, `branch-agent`, `send-to-trunk`, `conclude-edit:<text>`; and, when
  open on that item, the panel's `pick:`, `copy-answer:`, `go:`, `whole:`, `menu:`, `ask-here:`,
  `conclude`, `ask-conclusion`, `copy-confluence`, `close-branch` (`isMine`: a branch named by its hc
  name or id, as `resolveHandle` names it). It ignores `btw`, `pin`, `submit`
  and `escape` (the box's).
- Esc: the root's `on_key_down` records `closedBy = "esc"` (unless set) and closes; Herdr closes the
  dialog on Esc in any case. A click outside sets nothing, so its record says focus null.
- Nothing typed is lost to Esc or a click outside: drafts are posted by `flushPending`; the Conclude
  text is kept in this copy's `localStorage` under `detail.conclude` (`{[branchId]: {text, at}}`) on
  every change and offered back by `openConclude` while under a day old and newer than the posted
  conclusion, cleared once Paste into trunk stages it or Cancel drops it. A pin note being edited is
  discarded, as Esc discards it.

## 5. `shared("ledgr.detail")`

`{open: {overlay, opener, session, kind, id, at} | null, closed: {overlay, opener, session, kind, id,
at, flash, focus, terminal, drafts} | null}`. The dialog writes `open` at start and on retarget,
`closed` in `release`; `focus` comes from `focusAfter(closedBy)`: "list" after Esc or a closing act,
"pane" after a staging or a pane focus (with its `terminal`), and after any close while a paste still
waits (the staged terminal; the flash says the message is on the clipboard, `pasteCutWords`), null
after a click outside, a peek or the capture box. `drafts` is `{[itemId]: text}`, the answers typed in the dialog.

The panel reads it in `render` (`noteDetail`, :779): the open record marks the raised row. A closed
record newer than the last handled brings its drafts to the rows (from any dialog, so Paste on the
row works at once); for a dialog this copy opened and did not replace, its flash goes to the status
line and the cursor to its row; for the dialog this copy has open, the keyboard: "list" focuses the
list after 30 ms and again at 300 ms if it does not have it (Herdr hands the keyboard to the focused
terminal after a close), "pane" runs `pane.focus` on that terminal after 30 ms when it is live, null
leaves it where the person put it.

## 6. Staging: one door, eleven rules

The chain: nav.js `stageIntoPrompt` (:122) is called only by nav.js `stageMessage` (:158), which only
`Reader.stage` (reader.js:231) calls; the staging methods call `this.stage(`. Neither `panel.js` nor
`detail.js` defines `stage`, and copy methods never stage. `stageMessage(gate, msg, terminal, cx, w)`
keeps one paste at a time per copy (`gate.pasting`, `PASTE.waitMs + 400`; a second call says "Still
pasting into …" and stages nothing), and says what happened through `w.say(text, r, cx)`: once with
the result when it is known at once (off, gone, plain, blocked), else twice ("copied; pasting it…"
with `r` null, then the result from the task), the gate cleared before the result is said.

The dialog stages while open, because closing cancels its tasks: `afterStage(r, text, terminal, cx)`
closes it through `this.close()` when `closesAfterStage(r)` says so (pasted, or on the clipboard with
the pane focused: off, focus, plain, blocked), keyboard in the pane; on gone, clipboard or error it
stays open with the status line saying what to do.

`bin/tests/test_no_keystrokes.py` enforces it, every check run and every failure printed:

1. The forbidden patterns everywhere (`hc keys`, `hc send`, the find bar, Enter or key names handed to
   any `run`); `terminal.paste` only in nav.js, once, with no arguments, inside `stageIntoPrompt`,
   after `focusedOn(terminal)` and the settled-focus and clipboard checks.
2. `stageIntoPrompt(` in no file but nav.js; there exactly twice: its definition and one call, inside
   `stageMessage`.
3. `stageMessage(` outside nav.js only in reader.js, once, inside `stage`, whose body holds
   `paste: this.pasteOn()`; reader.js `pasteOn` holds `pasteIntoPrompt !== false`.
4. No `stage(` method in `panel.js` or `detail.js`.
5. The staging methods stage through `this.stage(` with their target: reader.js `stageAnswers`
   (`s.terminal`); detail.js `askPinsHere` (`s.terminal`), `sendToTrunk` (`ts.terminal`),
   `copyConfluence` (`ts?.terminal`).
6. detail.js `copyPin`, `copyPinsMessage`, `copyText` write the clipboard and call none of `stage(`,
   `stageMessage(`, `stageIntoPrompt(`, `stageText(`, `stageQuestion(`, `run(`, `hc(`, `exec(`,
   `openOverlay(`; `copyPinsMessage` holds `write_to_clipboard(promptText(pinsMessage(`.
7. None of reader.js `stage`, `stageAnswers`, `copyAnswers`, `copyAnswer` and detail.js `askPinsHere`,
   `sendToTrunk`, `copyConfluence`, `copyPin`, `copyPinsMessage`, `copyText` calls `hc(`, `run(`,
   `exec(`, `openOverlay(`, `goTo` or `spawn(`.
8. One "Stage /btw", in detail.js, for a question without pins; with pins, Copy for prompt is
   `copyPinsMessage`.
9. detail.js `goTo` and `goToPin` go through `goToAnchor(` and call no `hc(`, `run(`, `exec(`.
10. `panel.js` calls none of `stageIntoPrompt(`, `stageMessage(`, `stageText(`, `goToAnchor(`.
11. detail.js `afterStage` decides with `closesAfterStage(` and closes only through `this.close(`.

## 7. Engine and imports

`listing.js` and `detailing.js` are pure (no `herdr`, no gpui; `detailing.js` imports nothing), so
both load in Node. `reader.js` imports nav, config, store, spool, fixtures, branch, confluence and
words; `views.js` imports listing, detailing, branch, confluence, words and the store's `isClosed`.
No engine file imports any of the five new modules, `words.js` or `nav.js`.

## 8. Probe P1 (2026-11-10, before the builders started)

Method, as spec 6.4 planned it: a throwaway scratch mod under `~/.config/herdr-app/mods/` (not in
the repo, removed afterwards) whose `mod.json` declared a `kind: "dialog"` overlay at 0.6 × 0.75,
with a view of a selectable TextView, a button and a log, and cat-like throwaway panes as targets.
The button writes the clipboard, runs `pane.focus`, looks at `focused()` every 50 ms, runs
`terminal.paste` after two looks on the target, and closes the overlay from the dialog's own task.

Results: the dialog stayed open through `pane.focus`; `terminal.paste` landed in the target pane while
the dialog was open (1 ms, no CR or LF: nothing submitted); `closeOverlay` from the dialog's task
works; closing cancels the dialog's pending tasks as soon as `close()` resolves, so work after a close
survives only while `close()` awaits (at most 250 ms); after a close the keyboard goes to the focused
terminal. So spec 3.1 stands (no F1 fallback): the dialog stages while open and closes once the
paste is decided; `View.close` awaits `release`; closing acts write first and close after; and the
panel takes the keyboard back itself (30 ms and 300 ms). Whether the root's `on_key_down` sees Esc
before Herdr closes the dialog, and drag-select plus ⌘C inside a dialog, are left to the live check.

## 9. Where the build departs from Detail.md (the code wins)

| Topic | Built | Spec |
|---|---|---|
| Quick actions | Promote is a third quick action, shown on every below-threshold ask row not closed (`listing.js` :119, :151; `panel.js` :840); Paste is not offered on a suggestion, nor on an answered or deferred ask | 1.4 had Done and Paste only (open question 2 recommended two), Paste on any ask not closed |
| Row glyph | `rowModel().glyph` is `[char, tone, icon]`, the icon "pin", "git-branch" or "spinner" (`listing.js` :115-117, :126, :134); `rowKind` exported | `glyphOf` `[char, tone]` |
| Entries | A row drawn twice (a child question under its ask and in its lane) is an entry once, its second drawing `-dup` (`panel.js` :675-678, :825) | not covered |
| Cursor back | The list takes the keyboard at 30 ms and again at 300 ms if it lacks it; drafts from any dialog's closed record reach the rows, flash and cursor only from this copy's own (`panel.js` :779-806) | 30 ms; every step for every record |
| `mdVerbatim` | Also turns leading spaces and tabs into no-break spaces and drops trailing line breaks (`detailing.js` :122-126) | escapes and hard breaks |
| Release order | The closed record is written first, then `flushPending` is awaited (`detail.js` :245-256) | flush first |
| Close reasons | `closedBy` "esc", "act", "stage", "pane", "box"; `focusAfter` maps them (`detailing.js` :162); a peek and the capture box give null | "list", "pane", null |
| Commands | The dialog acts on a command only when the open record names it (`isCurrent`, `detail.js` :174, :268) | not stated |
| detailing.js | Also `VIEW_STATES`, `ACTION_STATES`, `KEEP_KEY`, `STAGE_CLOSES`, `MD_SYNTAX`, `twoColumns`, `leftWidth`, `focusAfter`; `detailProps(p, maxSel = 12)` | the 2.9 list |
| Reader | Also `canConclude` (`reader.js` :287); `setDraft` is the dialog's (`detail.js` :407) | 1.11 table |
| Demo handle | `panel.js` `DEMO_DETAIL_HANDLE` (:96) repeats `fixtures.js` `DEMO_DETAIL` | one constant |
| USED IN | A pin's usage lines are their own clickable lines ("open ›"), not `subRow`s (`detail.js` :969-975) | sub-rows |
| Tests | `test-nav.sh` copies every module of the mod; `test_detail.mjs` also renders `detail.js` with stub gpui modules (every demo case in one and two columns, and the flows through its own clicks); `test_no_keystrokes.py` prints every failure instead of stopping at the first | 6.2, 6.3 |

The spec's three open questions (7), as built: staging from the dialog follows 3.1, since Probe P1
passed (no F1 fallback); Promote is a third quick action on rows below the threshold (above); the way
into the list without the pointer is the `focus-list` command, bound to no key, with no `focusable`
in `mod.json`.

## 10. Tests

All suites one at a time (never concurrently), from `mods/ledgr/bin`: `bash tests/run-all.sh`.

- `test_list.mjs` (new, run by `test-detail.sh`), 242 checks: `firstLine`; `glyphOf` for every status;
  `stateOf` for every row of spec 1.3, each kind, the first match winning; `rowModel` pills, text,
  quick actions and tooltips; `entryKey`; `moveCursor`; `keepPlace`; as text, `listing.js` pure,
  `reader.js` holding every Reader member of spec 5.2, `panel.js` extending Reader with no `stage` or
  other Reader member of its own, `openDetail` opening `detailSpec` with the props of 5.2, the root
  tracking the list's focus and the list its scroll.
- `test_detail.mjs` (new, run by `test-detail.sh`), 566 checks: `detailProps`, `detailSpec`, `kindOf`,
  `focusAfter`, `locate`, `passageParts`, `mdVerbatim` (unescaping gives the input back), `hardBreaks`,
  `closesAfterStage`, `mergeClosed`, `keptConclude`, `keepConclude`; the words.js additions; every demo
  case of spec 2.10; `main.js` as text; the views.js exports; then `detail.js` itself with stub
  `herdr`, `gpui-kit` and `gpui-base`: every demo case renders at 900 and 500 px, the sections and the
  marked passage, and the flows through its own clicks (an option, Paste answer, Done written then
  closed, Esc, a staging closing it, retarget, the Conclude editor, the closed record).
- `test_nav.mjs`, 364 checks (plus `test_compose.mjs` 221, both through `test-nav.sh`): `stageMessage`
  pasted (said twice, the gate clear before the result), known at once (said once, no task), a second
  call while pending (false, nothing written or focused), a stale gate; the global rules hold over
  these calls too.
- `test_no_keystrokes.py`, 459 checks: the 11 rules of section 6.
- Unchanged by this work: store 881, hooks 191, mcp 96, the installer's offline test 69.
- `herdr-app check mods/ledgr` passes.

## 11. Manual live check (not done)

Spec 6.5, as written. Never in a real session: scratch folders, new panes closed at the end, test
items and pins removed through the panel's own events.

1. `mkdir -p /tmp/ledgr-detail-a`; in a new pane `cd /tmp/ledgr-detail-a && claude`; ask it for three
   numbered facts about TCP, then to ask you to choose "fast" or "safe" and to give it a port number,
   and to stop until you answer.
2. The list: one line per item, Done on hover, no wrapping at the panel's width. Click the decide ask:
   the dialog opens centered at about 60 % × 75 %, the message on the right with the passage marked
   and in view. Drag-select a sentence of the message and of the ask's text, ⌘C, ⌘V into the answer
   box: it pastes.
3. Click an option, then Paste answer: the dialog closes, the sheet is in the pane's prompt and not
   sent, and the keyboard is in the pane: type a word, press Enter (the person). The ask reads
   "answered", then closes on its own at the turn's end.
4. Click the list, ↓ ↓, Enter on the other ask; type an answer; Esc: the dialog closes, the cursor is
   on that row, the row shows Paste. Paste on the row: pasted, not sent.
5. ⌘J, park a question; open it; Branch…, Launch; open its branch row; Conclude…; type a line; Esc;
   reopen the branch and Conclude…: the line is still there; Paste into trunk: lands; Close branch.
6. Select a sentence, ⌘J, ⌘S (a pin); open the pin: the passage and the message, the passage marked;
   Note, Enter; Archive (the dialog closes); "archived (1)", open it, Restore, Archive, Delete twice.
7. With a dialog open: ⌘J (does the capture box open on top, or does Herdr close the dialog? Either
   is acceptable; write down which); Tab in the answer box moves to the dialog, not into a capture
   box; ⌘S in the dialog does nothing.
8. `herdr-app status`: no mod errors. `herdr-app do ledgr.collapse-all` closes an open dialog.
9. Clean up: Forget the session after closing its pane; `rm -rf /tmp/ledgr-detail-a`.

Also worth writing down while there: whether Esc leaves the keyboard in the list (the root saw Esc)
or in the focused terminal (it did not: the record then says focus null), and how the dialog looks
at 420 × 320.

## 12. Known limits and out of scope

- One dialog at a time: a second open from the panel closes the first; a sub-row retargets in place.
- The panel does not see the dialog's local acts: its rows follow once the writer has ingested them
  (normally well under a second); typed answers come back at once through the closed record.
- A selection cannot run across the message's three blocks; Copy message copies the turn whole.
- If the live check finds selectable TextViews do not select or copy in a dialog, the spec's fallback
  is a read-only Editor for the verbatim texts (spec 2.3); not built.
- A demo dialog's acts change its own store only; the panel's demo list does not see them.
- The list and `views.js` keep their own atoms (`btn`, `pill`, `menuButton` exist twice this round);
  the meanings (glyph, state words, pills) are shared through `listing.js`.
- `preview.png`, the recipe's What you see and `docs/preview-recipe.md` (its `expand-all` step)
  need a retake against the live look.
- Out of scope (spec 7): moving between items inside the dialog; a draggable window dialog; keys for
  actions in the dialog beyond Esc, Tab and Enter in fields; pinning a selection from the dialog (no
  API reads a TextView's selection); editing a question's text; any store, event, MCP or installer
  change.

## 13. The settings dialog and the text scale (2026-11-10, after the build above)

Jesse, after the list and the dialog: "this is REALLY good. Where is the 'settings' for this? for
example font size, threshold", then "build the settings dialog with text scale". Built the same day by
one builder, uncommitted; offline tests and `herdr-app check` pass (ledgr and ledgr-pane); not tried
live.

**The dialog.** `mods/ledgr/settings.js` (new, 314 lines): `class Settings extends Reader` (:129),
props `{view: "settings", opener, demo}` checked by `detailing.js` `settingsProps` (:56) and opened with
`settingsSpec` (:64; `SETTINGS` 0.5 × 0.7, :52), `kind: "dialog"`; routed in `main.js` (:87) beside the
detail view, before `isCapture`. Opened by the panel's gear (`panel.js` :1245, at the right of the
header) and `ledgr.settings` (`panel.js` :260; `openSettings` :784), `ledgr.demo-settings` (:261), or,
with no panel shown, by the host that holds the writer (`host.js` :44). Rows in order (`SETTING_KEYS`
:36, `SETTING_PATHS` :38; label and line in `words.js` `SETTING_WORDS` :235), each with its value, a
control and one line: Text scale (`−`, the value, `+`, a `100 %` reset), Threshold (three choices,
`words.js` `THRESHOLD_WORDS` :228, which the lane head's menu now uses too: `panel.js` :82), Who owns the
closing list (ledgr / both / prose; `editFor` writes `instruct_block` with it as the installer does, so
prose turns the instruction off), Paste into the prompt, Animations, Fold asks while the agent works,
Open the panel on new asks (on / off), Branch depth (0 to 4, `DEPTH` :42; a hand-written 6 shows as 6
and steps back to 3), Off spaces (`spaceRows` :52: each space Herdr has in its order by name, "this
space" beside the focused pane's, on / off; then each id `spaces.disabled` names that Herdr no longer
has, by id, with Drop). Controls are `views.js` `segment` (:48, new) and `btn`. The footer: the status
line, then `settingsFootWords` with the path under `~`. `settingRows` (:63) reads values the way the
mod and the hooks read them (`thresholdOf`, `handoffOf`, `maxDepthOf`, `textScaleOf`).

**Writes.** Every click: `set` (:198) applies `editFor(key, value)` (:81) to a copy of the shown config
at once (`applyEdit` :103, so the next click starts from it and the dialog redraws at a new scale),
then `this.saveConfig(edit, savedLine(…), "<label> not saved", cx)`. The one writer is `reader.js`:
`editConfig` (:38) reads `config.json`, parses it (a missing or empty file starts from `DEFAULTS`; a
file that is not a JSON object, or not JSON, is refused with words), runs `edit(d)` on the parsed file
(so keys the mod does not know, such as `btw` and `nav` in the maintainer's file, stay as they are),
and writes with `writeTextFile(path, text, cur ?? null)`, Herdr's compare-and-swap. When the write
rejects it reads the file again: changed, it throws `CONFIG_STALE` (:31) with `stale: true` (nothing
written); unchanged, the original error. `Reader.saveConfig` (:257, moved from `panel.js`) queues
changes (`cfgJobs`, :77) and writes them one after another in one task, so two quick clicks never race
each other into a stale write; the flash says the saved words or `<fail>: <why>`, a failed write reads
the file again (`loadConfig`), `onConfig` runs, and once the queue is empty the copy's `cfg` is the
file's. `settleConfig` (:287) lets a closing copy wait for the queue (the dialog's `release` awaits it
before writing its closed record). The panel's `setThreshold` and `setSpaceOff` call the same
`saveConfig`; `panel.js` no longer imports `writeTextFile`. The demo writes nothing ("(demo) … Not
saved."), from `fixtures.js` `DEMO_SPACES` / `DEMO_OFF` (:223, :227).

**One dialog at a time.** The settings dialog reuses `shared("ledgr.detail")` (`writeOpen` :161,
`release` :174: kind "settings", `id: null`, `session: null`, `drafts: {}`) instead of a sibling
record. Simpler: the panel's `closeDetail` already closes whatever overlay the open record names, so
`openDetail` closes an open settings dialog and `openSettings` closes an open detail dialog with no new
code, and `noteDetail` handles its closed record unchanged (its flash goes to the panel's status line,
no cursor moves because there is no id, Esc gives the list the keyboard). `detailOn(id)` never matches
it. The host does the same by hand (it closes the open record's overlay first).

**Never stages.** `settings.js` imports no `run`, `hc`, `exec`, `openOverlay` or `writeTextFile`, and
calls no staging, clipboard, spool or command function; `test_no_keystrokes.py` rule 12 checks it
(and that `panel.js` has no `saveConfig` of its own). It reads `config.json` through `startReading`
and `watchStore`, and overrides `reload` (:147) so it never reads `store.json`.

**The scale.** `ui.textScale`, default 1 (`config.js` :41; `ledgr_config.py` :46). `TEXT_SCALE`
(:102: 0.8 to 1.6, step 0.05), `textScaleOf` (:106: a number or numeric string, clamped, rounded to the
step, two decimals; anything else 1), `stepScale` (:115), `scaleText` (:118: n × scale to a half pixel),
`withScale(t, s)` (:122: `Object.create(theme())` with `ts(n)` and `scale`, so Herdr's theme object is
not touched and a Proxy theme reads through). Every copy's render starts with `const t =
withScale(theme(), …)`: `panel.js` :629 and `detail.js` :781 (`textScaleOf(this.cfg)`), `settings.js`
render, `capture.js` :422 (`scale()`: the writer's `shared("ledgr.ui").textScale`, else the file the
box read), `host.js` :70 (the shared value, else its writer's config). All 176 `text_size(` calls go
through `t.ts(`: panel 68, views 43, detail 29, capture 21, settings 13, host 2. Also scaled, because a
17 px text in an 18 px box clips: the fixed heights of one-line rows and buttons (panel 21 including
the gear and the pin checkbox, views 10, detail 3, capture 2, settings 2), the row glyph columns
(panel 1, views 2), the pin checkbox's width and the box's quote checkbox. Left fixed: every `svg`
icon (10-14 px), paddings, gaps, indents, `listing.js` `ROW` widths and the panel's 280 px minimum. The
host's heights stop at 26 px (`BAR_H`, :21) to stay inside the 28 px host row. The writer publishes
`textScale` in `shared("ledgr.ui")` (`writer.js` :137), which `ledgr-pane` reads for its chip only
(`chipScale`, `sz`, `CHIP_H` 26 in a 30 px header, `main.js` :57-63); the pane header's own name,
folder and "Needs you" stay at Herdr's sizes, since that header is a clone of Herdr's `pane` mod. A
change reaches every copy at its next render: the panel and the dialogs reload `config.json` on change
(`watchStore`), the host, the chip and the box follow `shared("ledgr.ui")`, which the writer republishes
when the file changes. Unlike the rest of this build, two engine files changed (`config.js`: the scale
helpers and `configPath`; `writer.js`: `textScale` in `shared("ledgr.ui")`), so a host in another mod
(the overlay's `my-tabs`) runs the old pair until `install.sh` refreshes its engine copy (the panel
warns on drift meanwhile); `ENGINE_FILES` itself is unchanged and no engine file imports `settings.js`.

**Tests.** `bin/tests/test_settings.mjs` (new, 503 lines, run by `test-detail.sh`), 601 checks: the
scale (bad values, clamps, rounding, 16 steps from 80 % to 160 %, half pixels at every step,
`withScale` leaves the theme alone, the Python default); the rows (order, labels and lines, values for
the defaults and for a hand-edited file, `spaceRows` with a stale id, every `editFor` and its refusals,
`savedLine`); `settingsProps` / `settingsSpec`; `main.js` routing; `editConfig` (a missing file, unknown
keys kept, a stale file refused with nothing written, invalid JSON, not an object, another failure);
the dialog through its own clicks (every control writes its key, two quick clicks both written with no
stale, the commands, a stale write said and the file re-read, nothing staged, copied, run or opened,
Esc and the closed record, `release` waiting for a queued write, the demo writing nothing); the panel
in Node (`ledgr.settings`, a detail dialog closing the settings dialog and the other way round, the
closed record's flash, `demo-settings`, `settings:*` ignored, the gear, the threshold menu and the space
switch through `saveConfig`, a stale write from the panel); the panel's demo, the A15 detail dialog
and the settings dialog drawn at 100 % and 160 % with every size scaled; a static scan that every
`text_size(` in the mod is `text_size(t.ts(` inside a function or method that has `t`, that every
`theme()` is wrapped by `withScale`, and that the chip scales and the header's two sizes do not.
`test_detail.mjs`'s theme for `views.js` is now `withScale(…, 1)`. `test_no_keystrokes.py` 492 (rule
12). Rendered through `herdr-app check` in scratch copies (the scratchpad's `check_settings.sh`): the
settings dialog (demo at 80, 100 and 160 %, defaults, bad props), the demo panel at 100 and 160 %, the
detail dialog (A15, the Q3 branch) at 160 %, the demo host and the box (at 100 %: they read the
scale from the writer's `shared("ledgr.ui")`, which a check has not).

**Live check (not done).** Open the gear: the dialog at about 50 % × 70 %, an open detail dialog
closed first; `+` twice: the dialog, the panel, the host button and the chips grow within a second,
`config.json` holds `ui.textScale: 1.1` and every other key as it was (the maintainer's `btw` and `nav`
too); Threshold "blocking only" moves rows; Off spaces: a space off and on, matching the session
menu's switch; edit `config.json` by hand while the dialog is open: it shows the new values; Esc: the
panel's status line says what was saved. Worth writing down: the capture box (600 × 320) at 160 %
(its text grows inside a fixed box), and the host button's width (96 px in the status row) at 160 %.

## 14. Links in the dialog (2026-11-10, after the settings dialog)

Jesse: "the big modal is working GREAT! any chance it could resolve relative links or weblinks?"
Research (Herdr's typings and docs, not tried live): `TextView.markdown(…).on_link_click((url, cx) => …)`
(gpui-kit.d.ts:20704) takes the click and reports the resolved URL (the shipped Linear mod uses it);
`cx.open_url` (gpui-kit.d.ts:331-343) takes an absolute http or https URL with a host and refuses
everything else, `file://` included; only a real markdown link clicks, so a path has to be rewritten
into one before rendering; `exec(cmd, args, {cwd, on, timeout})` (herdr.d.ts:14) runs a program with
the login shell's PATH.

**Rendering.** `views.js:131` `readable`: markdown mode (never verbatim) always installs
`on_link_click`; with the dialog's handler (`o.onLink`) the text first goes through `links.js:236`
`linkify` (then `hardBreaks`, which sees the same lines) and every click goes to the handler; without
one, `views.js:120` `webOnly` opens a web link and nothing else (the preamble). `views.js:162`
`messageBlocks` passes `onLink` to its three blocks. `detail.js:1027` gives it to an ask's text and
quote, `detail.js:1175` to the message (asks, questions, pins and branches alike: the right column is
markdown for every kind). Questions' text and quote, pins, answers, conclusions and notes are
verbatim (`mdVerbatim` escapes `:` and `.`), so they get no handler and no links this round.

**Finding paths** (`links.js`, pure, imports nothing). `links.js:190` `findPaths` walks the prose
paragraphs (`proseRanges` :111: outside fences, between blank lines; an indented code paragraph is
skipped), marks the spans no path is looked in (`protectedSpans` :142: code spans by CommonMark's
backtick-run rule, `[..](..)`, `[..][..]`, a `[ref]:` definition, `<…>` autolinks and tags, `scheme://`
and `www.` URLs), links a code span whose whole content is a path (the code kept as the label; one
inside an existing link is left alone), and scans the rest with `TOKEN` (:64: an optional `~/`, `./`,
`../` or `/`, segments of `[A-Za-z0-9_.@+%~-]`, a trailing slash, an optional `:line[:col]` or
`#L12[-L20]`). A hit needs a start, a space or one of `( [ { " ' “ ‘ < > * = , ; |` before it;
trailing `. , ; : ! ?` are dropped. `classify` (:78) / `pathLike` (:86) are the policy, written in the
module's header: anchored paths always (but `/x` needs two segments or an extension, so `/btw` and
`/mcp` stay prose); a slash with an extension on the last segment, or a trailing slash with two or
more lettered segments, or three segments with a letter in the last; a bare name only with a known
extension (`KNOWN_EXT` :42) and a two-character name, and not a capitalized `X.js` in prose (Node.js,
D3.js); never a host as the first segment (github.com/x/y). Kept out, tested: and/or, TCP/IP, km/h,
w/o, 24/7, 1/2, 2026/11/10, @types/node, 1.5, v0.1.0, 127.0.0.1:8080, e.g., i.e., a.m., etc., Node.js,
example.com, an email, `/btw`, `/tmp`, `$HOME/x.js`, `…/16.md`, `x:src/a.js`. Accepted false positives:
three lowercase words joined by slashes (read/write/execute) and a lowercase `name.js` library name in
prose; a path with spaces is not linked whole.

**The private URL.** `links.js:224` `linkFor`: `https://ledgr.invalid/path/<encodeURIComponent(path),
( ) ' ! * escaped too>[?line=N[&col=M]]`. `.invalid` is reserved, so a click the handler did not take
leads nowhere. A prose label is escaped like `mdVerbatim` (`labelOf` :232: `__init__.py` is not bold).
`links.js:251` `parseLink` reads it back, and also: a web link (`web`), a `file://` URL, and a relative
or absolute path as a markdown link wrote it (`[the spec](docs/a.md#L12)`, in case the TextView hands
one over unresolved) as `path`; any other scheme is `other` and opens nothing.

**A click** (`detail.js:837` `openLink`). A web link: `cx.open_url`, the status line says so (the demo
opens it too: the person clicked it). A path: the record's folder (`detail.js:789` `cwdOf`: an item's
session's `cwd`; a pin's `source.cwd`, else its session's; a branch's own session's, else `br.cwd`,
else its trunk's); a relative path with no folder says so (`LINK_WORDS.noFolder`). The demo says where
it would look and runs nothing. Otherwise, in a task, `detail.js:811` `findLink` looks in
`links.js:295` `resolvePath`'s order: as given when absolute or under ~ (home); else `<cwd>/<p>`, then,
only if that is not there, `<git toplevel>/<p>` (`detail.js:799` `gitRootOf`, cached per folder). It
checks each with `opener.js:22` `statAt` (Herdr's `fs.stat` where it has one, else `fs.exists`; Node's
`stat`/`access` in the tests; a check that is refused is "unsure" and is tried last). Found nowhere:
"No file or folder docs/missing.md: looked for /w/docs/missing.md, /repo/docs/missing.md." Found:
`opener.js:48` `openPath` (it checks again, then runs `links.js:359` `openerArgv`'s argv with a 5 s
limit), and the status line says "Opened /w/src/app.js:12 with Zed." or why not ("zed did not start (is
it on your login shell's PATH?)"); Reveal in Finder (`detail.js:875`, `opener.js:61` `open -R`) and
Copy path (`detail.js:887`) sit beside it (`detail.js:1203`) while the status line still says it. A newer
click drops an older one's answer (`linkSeq`). The dialog never closes for a link.

**links.editor** (`config.js:52`, `ledgr_config.py:52`, default `"open"`; `links.js:316` `editorOf`).
`openerArgv`: `open` is `open <path>` (no line), but an app, package, disk image or jar is revealed
(`REVEAL_EXT` :51, `open -R`), a script, a Python or Ruby file, a `.command` or `.terminal`
(`TEXT_EXT` :52) or a file with no extension opens as text (`open -t`: an executable would run in
Terminal), a folder opens in Finder, and a path with no extension whose kind is unknown is revealed;
`zed <path>[:line[:col]]`; `code -g <path>[:line[:col]]`; a custom command (a string split at spaces with
quotes kept together, or an argv array) gets `{path}`, `{line}`, `{col}` (no line: `:{line}`, `#L{line}`,
`+{line}` and `:{col}` dropped, a lone `{line}` or `{col}` is 1; no `{path}`: the path last), and is
refused when its program is a shell, an interpreter or a terminal driver (`SHELLS` :56, AppleScript's
`osa…` runners), when any argument names a terminal app, when it holds a line break, or when its
program is the clicked file itself (`refusedCommand` :339). Your own `open {path}` without `-a`/`-b`/`-e`
is the preset, guards included. `links.js:396` `editorValue` is what the settings row may write (at
most 300 characters). The settings dialog's row "Open files with" (`settings.js:39`, `:97`, `:149`):
open | zed | code segments and a field for your own command (an InputState made in the constructor;
Enter saves; a refused one says why and writes nothing; `words.js` `SETTING_WORDS.editor`,
`EDITOR_PLACEHOLDER`, `EDITOR_CUSTOM_HINT`, `editorRefusedWords`).

**The one process door** (`opener.js`, not an engine file; `test_no_keystrokes.py:275` rule 13). Among
the reading copies `exec(` is `opener.js`'s alone, in three shapes, each with `OPEN_TIMEOUT` 5000
(`opener.js:18`): `openerArgv`'s argv (`openPath`), `open -R <path>` (`revealPath`), `git -C <cwd>
rev-parse --show-toplevel` (`gitToplevel` :70). The Branch confirmation's worktree check moved there too
(`detail.js:559` now asks `gitRootOf`); `detail.js` no longer imports `exec`. `detail.js` takes
`openPath`, `revealPath`, `gitToplevel`, `statAt` from it and calls each once, inside `openLink`,
`revealLink` and `gitRootOf`; `cx.open_url` appears only in `openLink` (and `views.js` `webOnly`); no
other file imports `opener.js`; `settings.js` still runs and opens nothing (rule 12). `writer.js` keeps
its own `exec` (the extractor, the branch launcher, `which claude`), outside this rule. CLAUDE.md's
constraint gained its one exception: a link or path the person clicks in the detail dialog opens in
the browser or the chosen editor, never on ledgr's own initiative.

**Status-line words** (`words.js:190` `LINK_WORDS`): web, webFailed, refused ("Not opened: only web
links (http, https) and file paths open from here (…)"), noFolder, looking, missing, opened, failed,
revealed, copied, demo.

**Tests.** `bin/tests/test_links.mjs` (new, run by `test-detail.sh`), 294 checks: 22 paths and 36 false
positives, fences (backtick and tilde), indented code, links, images, a reference definition, a code
span inside a link, autolinks, tags, URLs, commands in code spans, offsets; `linkify` round trips (the
label reads as written, the URL parses back, no parenthesis or space in it, line structure kept);
`parseLink` for every kind; `resolvePath` order and dedupe; `shownPath`; `editorOf`, `editorValue` and
14 refused commands; `openerArgv` per preset (the `open` guards) and custom; `opener.js` with a
recording `exec` and real temp files (`statAt` on a file, a folder and nothing; one exec per open with
the 5 s limit; none for a missing path or a refused command; the PATH message; `open -R`; git's answer,
a non-checkout, a timeout). `test_detail.mjs` 609 (its `herdr` stub's `exec` now records): the demo
A15 message links `reports/pool-settings.md`, the message, text and quote take clicks and a question's
text does not; the demo runs nothing and opens a web link; live, a path from the session's folder with
`open`, Copy path, Reveal in Finder, `zed` at the line, a path only under the git toplevel (git asked
once), a relative markdown link with `#L3`, a path found nowhere, an editor not on PATH, `mailto:`
refused, a session with no folder; the dialog never closes. `test_settings.mjs` 643 (the row, its
edits and refusals, the field's Enter). `test_no_keystrokes.py` 538 (rule 13; a mutation run on a
scratch copy, an `exec` in `detail.js`, `open -a Terminal` in `revealPath` and the shell check removed,
failed five checks). `run-all.sh`, `herdr-app check mods/ledgr` and the installer's test pass.

**Live check (not done).** In `ledgr.demo-detail` (A15): the message's `reports/pool-settings.md` draws
as a link; a click says where it would look. In a real session whose reply names a file in its folder:
the click opens it (default app), the status line says so, Reveal in Finder and Copy path work; with
`links.editor` `zed` or `code`, the editor opens at the line (both need the CLI on the login shell's
PATH: Zed's `zed`, VS Code's "Install 'code' command in PATH"). To find out: whether Herdr's markdown
autolinks a bare `https://…` (if not, wrapping URLs in `<…>` in `linkify` is the fix); whether an
agent's own `[x](docs/a.md)` reaches `on_link_click` raw, resolved against something, or not at all;
whether a click in a `selectable(true)` view fires the handler or starts a selection; whether the
private URL arrives unchanged; and whether Herdr's `fs.stat`/`fs.exists` answer for paths outside
home (an "unsure" path is still opened, and `open` then says if it is missing).

## 15. Review fixes (2026-11-10, uncommitted)

- Installer: `--yes` keeps a `CFG_SHARED` value (threshold, closing list, animations, fold) the person changed in ledgr since the last install, and keeps it while the answers say what they said then; install-state records `config_written` `{wrote, said}` (`setup/ledgr_setup.py` `keep_config_edits`; a flag still wins; the run prints "kept your threshold: …").
- The ⌘J box stops at `config.js` `BOX_SCALE_MAX` (125 %, `textScaleOf(cfg, {max})`); its title and key rows are `flex_none` and its middle (`cap-body`) scrolls, so the session switcher stays inside the 600 × 320 popup.
- `open` judges a path by where it really leads (`opener.js` `realPathOf`: Node's `fs.realpath`, else `realpath(1)`, rule 13's fourth exec shape) and by its own extension; `.pyc`, `.pyo`, `.pyz`, `.jnlp`, `.tcl`, `.exe` and the like open as text, extensions, profiles and more disk-image kinds are revealed.
- A custom `links.editor` is refused for a shell, an interpreter (versioned too: `python3.12`, `node22`) or a program that runs another (`arch`, `caffeinate`, `env`, `xcrun`) in any argument, `open -a`/`-b` naming a launcher, shell or terminal (or `{path}`), and `open --env`; the settings dialog says which part (`links.js` `editorRefusal`, `words.js` `editorRefusedWords(v, why)`).
- `reader.js` `configChanged`: the watcher leaves `cfg` alone while this copy's own writes are queued, and drops a read a click overtook (`cfgGen`), so + + + ends at 115 %.
- `linkify`: trailing `_` and `-` dropped with as many leading `_` (`_src/it.js_`, `src/a.js->src/b.js`); an absolute path with no extension needs a Mac root (`ROOTS`: `/api/v1/users` stays prose); `protectedSpans` pairs backticks and brackets in one pass (20 k unbalanced `[` in about 2 ms); the last 32 results are cached by text.
- "Open files with": `links.js` `splitCommand` splits like a shell (quotes, backslashes, joined pieces) with no shell, `joinCommand` shows an argv array quoted so it saves back the same, and the field follows `links.editor` (`Settings.onConfig`, only when it changed, so typing survives other clicks).
- `ledgr.settings` with the panel hidden: the host block opens the dialog as before; an overlay host opens it on its own command (`my-tabs.ledgr-settings`), both through `config.js` `settingsOpening` (the gear's spec, an open detail dialog closed first), since no ledgr copy is shown to take a ledgr command there.

## 16. Multiline answers, drafted mark, next question (2026-11-11, uncommitted)

Jesse, after a turn of 19 asks answered in the dialog: "usage is going well. I like this solution", then
three requests. Line numbers as of this build.

**The answer box takes several lines.**

| What | Where |
|---|---|
| The answer is a `TextareaState` (2 rows, `set_auto_grow(2, 10)`, then it scrolls); `change` is the draft (`typeDraft`), `submit` pastes only when it carries ⌘ (`e.secondary`) | `mods/ledgr/detail.js:171` `makeAnswer` |
| ⌘Enter: the turn's sheet through `copyAnswers`; the command and the box's own submit of one keypress make one paste (500 ms); an ask that is not open says so | `detail.js:186` `pasteSheet` |
| The `btw` command (keys.json `mod:ledgr` `cmd-enter`, the capture box's /btw) is the dialog's only while it holds the keyboard (`holdsKeys`: a field reported focus, or the dialog's own handle); a question or pin says ⌘Enter is for an ask | `detail.js:324`, `:417` `fieldsOf`, `:422` `holdsKeys` (`tabField` uses `fieldsOf` too) |
| Drawn as `Textarea.new(host.answer)` in a bordered `v_flex`, Paste answer beside it at the top; the hint "⌘Enter pastes the answers for turn N (Enter starts a new line)" | `mods/ledgr/views.js:200-210` `answerBox` |
| Footer hints `⌘Enter paste the turn's answers`, `Enter newline` | `mods/ledgr/words.js:210` `detailHints` |
| The sheet: an answer's blank lines left out, its next lines indented two spaces (own indentation kept, trailing spaces trimmed) | `mods/ledgr/confluence.js:100` `answerLines`, `:109` `answersSheet` |
| The landing parser: an indented line after an `A<n>:` line is that answer going on (joined with `\n`), never another `A<n>:`, a marker or a fence; an unindented one still joins with a space | `mods/ledgr/bin/lib/ledgr_landing.py:90` (`_parse`), `:119` `_indented`, `:132` (`_end`) |
| A draft is cut at `LIMITS.answer` (4,000), not `LIMITS.text` (400): a long answer kept in `store.json` survives a restart | `mods/ledgr/config.js:58`, `mods/ledgr/store.js:1118` |

Since 2026-11-23 the box is no longer 2 rows growing to 10 with Paste answer beside it: it has fixed rows
fitted to the left column's free height (at least eight, no `set_auto_grow`), and Paste answer sits under it
(section 19).

Why indent rather than keep blank lines: `_end` closes a sheet at a blank line no `A<n>:` line
follows (Jesse's prompt of 2026-11-07, where typed text ran into an answer), and that rule stays. The
recorded `answer` is squashed by the store (`on_answers_landed`), so line breaks live in the pasted
message, which is what the agent reads.

**The drafted mark.**

| What | Where |
|---|---|
| `draftPending(it)`: an agent ask, open (a suggestion too) or deferred, with a draft that is not the answer a landed sheet recorded (a reopened ask; compared whole once squashed: review fix 4) | `mods/ledgr/listing.js:34` |
| The state word "drafted" (`dim`) for a suggestion and a deferred ask, in place of "below threshold" / "deferred"; an open ask at the threshold keeps "answer ready", drawn as its Paste button | `listing.js:104`, `:108` |
| `rowModel().drafted`, and the tooltip's last line "Your answer, not sent yet: …" | `listing.js:173` |

The store keeps a draft after its sheet lands (`answers_landed` sets `answered`, then `resolved` with
`resolvedBy: "answer"`), so the mark keys on the status, as the brief asked. Suggestions were already
open: `copyAnswers` (`reader.js`) and the sheet line's count (`panel.js` `body`) take them; a deferred
ask is in neither (deferred means later), so its "drafted" is a reminder only. The panel needed no
change for the mark: `listRow` draws `m.state.word` wherever Paste is not shown.

**Next and previous.**

| What | Where |
|---|---|
| `laneOf(store, kind, x, {threshold, now})`: the ids of x's lane in the panel's drawing order (asks by turn newest first, blocking first then `seq`, suggestions last in their turn; YOUR QUESTIONS by `createdAt` newest first, child questions included; branches newest first, a refused or failed one over an hour old left out unless shown; open pins newest first, archived apart; the OLDER, DEFERRED and CLOSED folds by `updatedAt`). It mirrors `panel.js` `body`, `pinsLane`, `suggestions`, `branchVisible`; a change of order there must follow here | `listing.js:190` |
| `neighbors(ids, id)`: `{at, of, prev, next}`, no wrap | `listing.js:222` |
| `step(d, cx)`: nothing while a paste or a closing act is pending; posts the waiting draft (`sendDraft`), clears the status line, `retarget` (review fix 1: the keyboard on the dialog, below) | `detail.js:493`, `:483` `laneSpot` |
| `retarget(kind, id, session, cx)`: the keyboard on the dialog's own handle, never a field (review fix 1; the build's `o.field`, which put it in the answer box, is gone) | `detail.js:469` |
| Commands `detail-next`, `detail-prev` (keys, only while the dialog holds the keyboard: review fix 3), `detail:next`, `detail:prev` (scripts) | `detail.js:356` |
| Header controls `← prev` (`dt-prev`), `N of M` (`dt-pos`), `next →` (`dt-next`); at an end dimmed (`opacity 0.45`) with no click; none for a lane of one; the session name narrows to 120 px below 760 px | `detail.js:1043` `navBits`, `:1090`, `:1033` |
| `Reader.sendDraft(id, cx)`: one draft posted now (its 800 ms timer then posts nothing) | `mods/ledgr/reader.js:246` |
| The panel ignores `detail-next` / `detail-prev`; its cursor follows the dialog's open record when the overlay is its own (`pendingCursor`, applied by `settleCursor` when the row is listed, so a folded suggestion keeps the cursor where it was) | `mods/ledgr/panel.js:95-96`, `:803` |
| Keys `cmd-down` / `cmd-up` | `keys.json:11-12`, `setup/ledgr_setup.py:61-62` (`MOD_KEYS`, one line: `test_compose.mjs` reads it with a one-line pattern) |

Key choice: ⌘] and ⌘[ are Herdr's global `agent.next` / `agent.prev` (`~/.config/herdr-app/keys.json`);
a `mod:ledgr` binding is more specific than `global`, so it would take them whenever any ledgr copy
has the keyboard, the panel's list included. ⌘↓ / ⌘↑ are bound in no Herdr section (⌘⌥↑ / ⌘⌥↓
are `pane.go`).

**Tests.** `test_detail.mjs` (670, was 610): the TextareaState and its rows, drawn as a Textarea; line
breaks kept in the draft and the sheet; Enter pastes nothing; ⌘Enter not the dialog's without the
keyboard, one paste for its two signals, a suggestion's answer in the sheet, a question refused;
live, the sheet staged with both lines and the dialog closed; "2 of 11", the walk through turn 17's
asks with A13 and A14 last, the ends, `detail-prev` and `detail:next`, the open record, the new
answer box focused, "drafted" and "answer ready" in the header, a question's and a pin's lane, none
for a lane of one; live, the draft posted once before the move and every draft in the closed record.
`test_list.mjs` (299, was 242): "drafted" on suggestion and deferred rows, `drafted` on open ones,
cleared when answered, resolved or dismissed, a reopened ask, the tooltip; `laneOf` on every lane and
threshold; `neighbors`; the panel's `noteDetail` and ignore list as text. `test_store.mjs` and
`test-store.sh` (886): `answerLines`, the 4,000 cap, and the parser on a composed multi-line sheet
(a line reading "A2:" inside an answer, text typed below, a lead-in, a paste wrapper, a fence and a
marker inside an answer). `test-hooks.sh` (224, was 221): the multi-line sheet through the real hook,
unwrapped, wrapped under a lead-in, and before a second sheet. `test_no_keystrokes.py` (558, was 541):
`pasteSheet` and `step` run nothing; `pasteSheet` stages only through `copyAnswers`; `makeAnswer`'s
submit pastes only with ⌘.

**Not tried live.** Which of the textarea and the `mod:ledgr` section takes ⌘Enter and ⌘↓ / ⌘↑
first. gpui's multi-line input binds ⌘↓ / ⌘↑ to its caret (start and end of the text) and may insert
a line on ⌘Enter before reporting it: both paths are handled (the command and the box's submit), a
stray trailing line is dropped from the sheet, and should the box keep ⌘↓ / ⌘↑, they work from the
dialog's body and the header's controls always do. Also to see: that Enter in the box is a new line
(Herdr's typings say nothing about Enter in a `TextareaState`; gpui's multi-line input inserts one).

### 16.1 Review fixes (2026-11-11, uncommitted)

One line per behaviour change; each has its test.

1. A step (⌘↓ / ⌘↑, the header's controls) leaves the keyboard on the dialog's own handle, not the next ask's answer box, whose own ⌘↓ / ⌘↑ (caret moves) run before the dialog's and would swallow the next step; Tab enters the box (`detail.js:469` `retarget`, `:493` `step`). Test: `test_detail.mjs` (the dialog's handle focused, the box not, a second `detail-next` steps, Tab enters the box); `test_no_keystrokes.py` (`retarget` focuses `this.keys`, no `focusFirst`).
2. ⌘Enter in a deferred or answered ask's box carries that ask's own answer: `pasteSheet` passes its id to `copyAnswers(s, turn, cx, own)`, which adds it to the turn's open asks unless it is closed (`detail.js:219`, `reader.js:349`). The dialog's Paste answer already staged the ask alone whatever its status (`copyAnswer`); the panel row of a deferred ask has no Paste by design ("drafted" stands there). Test: `test_detail.mjs` (A4 deferred, A7 answered, A4's Paste answer).
3. `detail-next` / `detail-prev` (⌘↓ / ⌘↑) act only while the dialog holds the keyboard (`holdsKeys`), so a ⌘↓ in a capture box on top no longer steps the dialog behind it and posts its draft; `detail:next` / `detail:prev` and the header's controls are not guarded (`detail.js:356`). Test: `test_detail.mjs`.
4. The landed answer is recorded whole, up to `LIMITS.answer` (store `on_answers_landed`, `store.js:891`; parser `MAX_ANSWER` 4,000, `ledgr_landing.py:56`), and `draftPending` compares the squashed draft and answer for equality (`listing.js:34`), so "No" landed then "No, use the replica" typed after a reopen shows drafted. Answers recorded at 400 before this change read as drafted when their draft is longer. Tests: `test_list.mjs`, `test_store.mjs` (a 3,500-character answer whole, the 4,000 cut), `test-store.sh` (the old 400 cap cut every answer).
5. The hook's ref scan leaves out an answer sheet's lines (`ledgr_landing.py:241` `sheet_lines`, found by the landing's own scan, `_scan`; `ledgr_map.py:319` `prompt_refs(p, wrapper)`; the Claude adapter passes its paste wrapper as `fields["paste_wrapper"]`, `claude_hook.py:225`), so an `[A7]` written inside an answer no longer marks A7 answered. Tests: `test-hooks.sh` (wrapped under a lead-in and unwrapped), `test-store.sh`.
6. A sheet over 24,000 characters (`pinsCap`, the pins message's cap) is not staged: "N answers (…) not staged: the turn's answers are 25,310 characters, over the 24,000 one message carries: paste fewer at once." (`confluence.js:272` `sheetOverCap`, `reader.js:368` in `stageAnswers`, so the panel's Paste N answers too); the parser's `MAX_SCAN` is 96,000 (`ledgr_landing.py:54`), room for a 45,000-character pins message and a full sheet after it. Tests: `test_detail.mjs`, `test_store.mjs`, `test-store.sh` (six answers of about 3,800 after the long pins message land whole; at 64,000 they did not), `test_no_keystrokes.py` (the cap before the one door).
7. The answer box is cut at `LIMITS.answer` in its change handler, the status line saying "Answer cut at 4,000 characters." (`detail.js:179` `makeAnswer`, `:67`). Test: `test_detail.mjs`.
8. A pin note typed and not saved is saved when the dialog moves to another record (`retarget` calls `saveNote`, `detail.js:865`; a note left as it was posts nothing), as an ask's draft is; sub-row moves get it too. Esc still discards it. Test: `test_detail.mjs` (demo and live).
9. Defensive, unverified live: when the answer box's latest change, under 300 ms ago (`STRAY_MS`), only inserted one line break (`detailing.js:218` `strayBreak`), ⌘Enter puts the text before it back into the box and the draft before the sheet is made (`detail.js:204` `unbreak`, from `pasteSheet` on both the command and the box's submit); a one-line-break change arriving under 300 ms after the paste is put back as it arrives (the order of the two signals is not known); an Enter typed on purpose earlier stays. Tests: `test_detail.mjs` (`strayBreak`; mid-text, end and start of text, the command and the submit, the break after the paste, an Enter typed a second before).

Still to see live: whether ⌘↓ from the dialog's handle reaches `detail-next` after a step (and on open, where the keyboard still goes to the answer box first: if the box keeps ⌘↓ / ⌘↑, the first one there moves its caret, and Tab to the dialog or the header's next → steps), and whether ⌘Enter inserts a line break in the box at all, and before or after the command.

## 17. The archive in the reading copies (2026-11-19, uncommitted)

Retention Phase 1 (`docs/design/Retention.md`): closed items past `retention_days` (3 days) leave
`store.json` for `ledgr-data/archive/<session>/items-<ms>-<rand6>.jsonl`, written by the writer's
housekeeping (`BUILD-NOTES-mod.md`). Before this, an archived item vanished from CLOSED and nothing could
read or reopen it. This section is the reading copies' half: the panel lists archived items under CLOSED,
the dialog shows one whole and read-only, and Reopen asks the writer to bring it back. Built by the
reading-copies builder against the contract while the store and the writer were built beside it, then
integrated with an end-to-end test across the seam (`test_writer.mjs` section 28) and an outside review's
fixes. Line numbers are left out: the review fixes moved them.

**Reading the archive.**

| What | Where |
|---|---|
| The reading rule as a pure function: files ordered by name (legacy month files before items files, items files by `<ms>`), the newest file's last line wins for an id, other sessions' lines left out, malformed ones skipped and counted, the store's ids left out through `has`, newest closed first, each with `archiveFile` | `mods/ledgr/listing.js` `archiveRecords`, `closedAtOf` |
| The CLOSED line's number: the rows read, else the store's `session.archived` | `listing.js` `archivedCount` |
| A copy's read: both folders listed (`namesIn`), each items file read once by name (written once, never changed), a legacy month file once per copy, `fs.readFile` (a legacy file may pass 1 MiB), the store's ids left out by `viewStore()`; the panel's and the dialog's read bounded as a whole (`ARCHIVE_READ_MS`, 10 s, the copy's own timer through `spool.js` `within`), said when it fails or gets no answer, and read again after `ARCHIVE_RETRY_MS` (15 s) | `mods/ledgr/reader.js` `loadArchive`, `readArchiveWithin`, `namesIn`; `panel.js` and `detail.js` `readArchive`, `detail.js` `archiveAgain` |
| The demo's archive, at once and with no file: `fixtures.js` `demoArchive` through the same rule | `reader.js` `demoArchiveOf`; `mods/ledgr/fixtures.js` `demoArchive`, `DEMO_ARCHIVE_FILES`, the demo session's `archived: 3` |

The name shapes are the writer's (`ARCHIVE_ITEMS`, `ARCHIVE_LEGACY`, in `config.js` and re-exported by
`spool.js`), passed into `archiveRecords` so `listing.js` stays pure. A turns file is never read here.

**The list.**

| What | Where |
|---|---|
| CLOSED's last line, `archived (N) · show` / `hide`, entry `arch:items` (Enter toggles it), per session in memory (`archShown`); hidden at 0 unless the archive holds rows anyway (read once at a count of 0 to find out) | `mods/ledgr/panel.js` `archivedLines` |
| The rows read in a timer from render, read again when the count changes; meanwhile "Reading the archive…", nothing read: why | `panel.js` `readArchive`; `mods/ledgr/words.js` `ARCHIVE_READING`, `archiveEmptyWords`, `archiveFailedWords`, `archivedLineWords`, `ARCHIVED_LINE_TIP` |
| An archived row: state word "archived" (dim, before every other state), no quick action, `archived: true`, its tooltip's last line | `listing.js` `stateOf`, `rowModel` |
| A click or Enter opens the dialog with `props.archived` | `panel.js` `openOf`, `openDetail` (`o.archived`) |
| `open:<handle>` and `cursor:<handle>` reach an archived row once read; the `archived` command | `panel.js` `resolveHandle`, `command` |

**The dialog.**

| What | Where |
|---|---|
| `props.archived` checked: an ask or a question, a plain `.jsonl` name of at most 128 characters that the writer's shapes take | `mods/ledgr/detailing.js` `detailProps` (its third argument), `detailSpec`; `detail.js` constructor |
| The session's archive read by the dialog itself; `resolve` looks in the store first, then among the records read (`archRecord`); a target that leaves the store while open is looked for in the archive once | `mods/ledgr/detail.js` `readArchive`, `archiveFor`, `lookInArchive`, `resolve` |
| Read-only: no answer box whatever the status, only "whole" of the open states, no open actions; `detail:done`, `detail:pick:`, `detail:answer:` say `ARCHIVED_READONLY` | `detail.js` `prepare`, `applyOpen`, `runOpenAction`, `command` |
| The ARCHIVED section first (`archivedWords`, `archiveFileWords`, a badge), the rest as for a live item, the related ask's sub-row from the archive | `detail.js` `itemParts`, `resultLines` |
| One action, Reopen | `detail.js` `archivedActions`, `reopenArchived`, `settleReopen`; `detailing.js` `RESTORE_WAIT_MS` (15 s); `words.js` `reopeningWords`, `reopenedWords`, `restoreFailedWords` |
| A record that comes back is prepared again as the live item (`prepKey` marks an archived one apart) | `detail.js` `prepKey`, `render` |
| ⌘↓ / ⌘↑ through the archived rows as read | `listing.js` `laneOf` (lane `"archive"`, opts `archive`); `detail.js` `laneSpot`, `step`, `retarget` (its `archived` argument) |
| Why nothing shows: the ledger not read, the archive being read, no file holding the record, else `DETAIL_GONE` | `detail.js` `goneWords`; `words.js` `archiveGoneWords` |

Reopen posts one `restore` event, `{session_id, item, file, reopen: true}`, through `Reader.post` (kept in
`unwritten`, so `release()` writes it again if the dialog closes first), and says "Reopening …". Once
`store.json` holds the id, even late, "… reopened from the archive", and the live item shows. When the
writer has ingested the event and the id is not back, "… was not reopened: the archive file … could not
be read". After 15 s with neither, it keeps waiting and says the writer has not taken the event yet. The
dialog stays open throughout; the demo restores into its own store.

**Settings.** One row, "Closed items stay in the list", N days with − and + (1 to 30), after "Open the
panel on new asks", written to `retention_days` through `Reader.saveConfig`; the value shown is
`config.js` `retentionDaysOf`, the clamp the store and the writer use (`mods/ledgr/settings.js`
`SETTING_KEYS`, `editFor`, `savedLine`, the row's controls `st-days-down`, `st-days-value`,
`st-days-up`; `words.js` `SETTING_WORDS.retentionDays`, `daysWords`).

**Choices.**

- Props, not a shared request: a dialog is opened per record and reads its props once, owned by that
  copy alone; a shared key would be every copy's and racy between two opens.
- Each copy reads the archive itself, as it reads `store.json`: no writer, no claim, no request to the
  writer. An items file is never rewritten, so its parsed lines are kept by name; only new names are
  read. A legacy month file is never written again, so it is read once per copy.
- The rows are read only when shown (and once at a count of 0), never at every render.
- The CLOSED line counts what was read once it was read: the legacy files' rows have no count in the
  store.

**Tests.** `test_list.mjs` (392 checks): the reading rule (newest file, last line,
legacy order, other sessions, malformed lines, the shapes passed in), the archived row (state word, no
quick action, tooltip), `archivedCount`, the `archive` lane, a file given parsed. `test_detail.mjs` (1,003): `props.archived`;
the demo's `archived (3)`; `Reader.loadArchive` over real files in a scratch `ledgr-data/archive/` (a
missing folder, the newest file and the store winning, a legacy month file, the cache); the CLOSED line
(hidden at 0, a legacy file's rows, reading, nothing read) and its rows (no quick action, the cursor and
Enter, `open:<handle>`) and the demo's; the dialog on an archived record (read-only, marked, its lane,
its links) and Reopen (the demo's store; a live one posting exactly the contract's event;
"reopening…"; back as the live item; "could not be read"), and the review's: a slow writer ("not taken
yet", then "reopened" when it comes late), an item archived while its dialog is open, an archived line
that says open, a read that never answers (bounded, said, read again), a `herdr:` session's folder, the
panel's own store-wins filter, each items file read once. `test_settings.mjs` (800): the row, its value
and edits (one clamp: 0 is 1 day, 45 is 30), its saved line, − and +. `test_no_keystrokes.py` rule 14: `loadArchive`, `demoArchiveOf`,
`namesIn` and both `readArchive`s only read; `reopenArchived` posts one restore event and stages, copies,
runs and execs nothing. Across the seam, `test_writer.mjs` section 28: the files the writer's run writes
are exactly the files `loadArchive` reads, and the event Reopen posts is the one the writer restores
from.

**Not tried live.** Everything above (`Retention.md` 8.3): the line and the rows at the panel's width,
the keys on them, the dialog on a real archived record (selection, links, Reopen against a running
writer, the message read from a turn file whose record was cut), and a Reopen while a new reading copy
runs beside an old host engine before Herdr is relaunched (the old writer ignores a `restore`; the dialog
says it could not be read).

## 18. Cold sessions in the reading copies (2026-11-19, uncommitted)

Retention Phase 2 (`docs/design/Retention.md` 10): a session nobody touched for `retention.coldDays` (7
days) keeps only its record in `store.json`, a stub with `cold` `{file, at, n}` (`n`: its counts by level),
and its items and turn records move to `ledgr-data/cold/<safe sid>.<ms>-<rand6>.json`, written once by the
writer; the first event that needs the session warm brings it back there (`BUILD-NOTES-mod.md` 20). This
section is the reading copies' half: the session menu lists cold sessions under OLDER SESSIONS with their
counts from the stub, a shown one is read from its file and merged into the copy's own store without being
brought back, the dialog opens an item of one, and the panel offers Try again and Use without its older
items when a file cannot be read. Built by the reading-copies builder against the Phase 2 contract while the
store, the writer and the Python readers were built beside it; the integration's changes are listed apart
below, and `tests/test_seams.mjs` drives the real writer and the real panel together. Line numbers are left
out.

**Reading a cold file** (the Reader's cold half).

| What | Where |
|---|---|
| `COLD_CACHE` 12 records kept per copy; `COLD_READ_MS` 10 s for one read; `COLD_LOAD_RETRY_MS` 30 s before a failed read is tried again on its own; `COLD_DRAFT_MS` 60 s a typed answer whose item is not in the shown store is kept; `COLD_ARM_MS` 4 s for Use without its older items' second click | `mods/ledgr/reader.js` |
| The cache, file name → `{sid, file, loading, record, error, at, used}`; `coldGen` bumped on every change to it (the panel's fallback clone follows it); `coldResetAsk` `{sid, at}` while Use without is armed | `reader.js` `coldCache`, `coldGen`, `coldResetAsk` (constructor) |
| The store a copy may merge into: its demo store, else `store.json` as it read it (`live`); never a fallback writer's | `reader.js` `ownStore` |
| A session as this copy shows it: null (not cold), else `{file, state, n, error?, held?}`, `state` "fault" when `s.cold.fault` is set (never merged here), "ok" when merged into the shown store, "error" when this copy could not read it (with `retryAt`), else "loading" (being read, or not asked for yet); `n` the stub's counts | `coldOf(sid, st)` |
| Whether to read now (not merged, not faulted, and not read yet, read but not merged, or failed `COLD_LOAD_RETRY_MS` ago); whether any read is going | `coldDue`, `coldLoading` |
| The read, from a timer or a handler, never from render: a record already read is merged at once; else `fs.readFile(coldPath(file), "utf8")` (no 1 MiB cap) bounded by `spool.js` `within(cx, COLD_READ_MS, …)` on the copy's own timer, then `listing.js` `parseCold`. Only a plain name matching `config.js` `COLD_NAME`, read in `ledgr-data/cold/`; anything else is an error and no read. The demo reads `fixtures.js` `FIXTURE_COLD[file]` at once. `force` reads again now (Try again); a failed read asks for a render after `COLD_LOAD_RETRY_MS`. Returns the state | `wantCold(sid, cx, {force})` |
| A record arrived: `coldGen`, `mergeColdAll`, `overlayLocal`, `bump`, the copy's `onCold` hook, a render | `coldLoaded(cx)` |
| Every cold session whose record was read, merged into a store this copy owns (`store.js` `mergeCold`: deep copies beside the stub, the store's own ids and turn records winning, `s.cold` unchanged, the session marked merged on that instance only); a faulted one never; `this.writer.live` refused | `mergeColdAll(st = this.ownStore())` |
| A record no stub names any more (its session came back, was forgotten, or froze again under a new name) leaves the cache, a read still going excepted (not in the demo); the 12 most recently used are kept | `dropColdUnnamed(st)`, `trimColdCache` |
| `reload()`: after `Store.fromText`, `mergeColdAll(st)` then `dropColdUnnamed(st)`, then `overlayLocal` (acts and drafts posted here applied on top of merged items) | `reload` |
| A draft whose item is not in the store is kept while a cold read runs here, else until `COLD_DRAFT_MS` after its `at`, instead of being deleted (a dialog's closed record can name an item of a cold session this panel has not read) | `overlayLocal`; `at` set by `typeDraft` and the panel's `noteDetail` |
| Try again: the cache entry dropped and the file read again now; when the writer cannot read it either (`s.cold.fault`), one `cold_retry` `{session_id, file}` too | `coldRetry(s, cx)` |
| Use without its older items, a faulted session only: the first click arms it for `COLD_ARM_MS`, the second posts one `cold_reset` `{session_id, file}`, shown at once through `overlayLocal`'s `cold_reset` local act (`store.js` `on_cold_reset`: warm, empty, `coldLost` kept on the record); the demo saves nothing. The file stays in `cold/`: `coldLost.file` names it, so the writer's sweep never deletes it, and any other file of the session stays too (the sweep keeps an unnamed file it cannot prove redundant). Returns "armed", "posted" or null | `coldReset(s, cx)`; `overlayLocal` |
| A faulted session's other files in `ledgr-data/cold/` (integration, the review's blocker): names of the session's own shape (`safeName(sid)` before the time) other than the one its stub names, newest first; null until listed. Listed from a timer (never from render), bounded by `COLD_READ_MS`, at most once a minute per session and file, never in the demo; the cache is `coldOtherCache` (`"<sid>\n<file>"` → `{names, at, loading}`). Read-only (rule 15 lists it) | `coldOthers(sid, file, cx)` |

`listing.js` (pure): `parseCold(text, sid, file, named)` checks a cold file's text as the writer's thaw
does, through `store.js` `coldRecordError` (the one check `thaw` and `mergeCold` make too), and answers
`{record}` or `{error}` in words ("the file is empty", "the file is not JSON", the check's own words, "the
session names another file now"). `touchedOf(store, s)` is the idle clock the menu and the loading line say:
`store.js` `touchedAt` when the store has it, else the latest of the record's own times, never `seenAt`.

**The panel.**

| What | Where |
|---|---|
| The fallback writer's store as shown: the writer's own while no cold record read here names one of its sessions; else a clone made from `writer.storeText`, its `threshold`, `maxDepth` and `spacesOff` copied, the records merged (`dropColdUnnamed`, `mergeColdAll`) and the typed answers on top, kept in `coldClone` `{text, gen, st}` and rebuilt when that text or `coldGen` changes. Never a merge into `writer.live`: the writer saves that store, and a merged session would be saved mixed (the contract's risk 3) | `mods/ledgr/panel.js` `viewStore`, `fallbackView` |
| A merge is not a motion (`prevCls`, `obsVer` reset); a kept handle command runs (integration, 1 below) | `onCold` |
| The shown session is cold and not merged: `coldOf`'s record, else null | `coldShown` |
| Shown: its file read from a timer when `coldDue`; nothing else posted but its `seen` | `render` |
| `seen` is still posted for a surfaced cold session shown: the one act that does not thaw (`store.js` `coldOf(ev)` leaves out an act "seen"; it marks the stub's chip seen, and moves no idle clock: integration 3 below), so the host button quiets and showing stays read-only | `render` |
| The session menu: cold sessions leave the agent groups and ENDED for a folded line at the bottom, OLDER SESSIONS (N) (`lg-older`), a cold branch session under its cold parent. The fold is as the person last clicked it (`olderOpen`), until then open while the shown session is cold. Each row: the pill, the name, the pane, "N open" and "◆ b" from `store.js` `countsOf` (the stub's `n` at the panel's threshold, so no file is read for the menu), a dim "idle 9 d" (`idleWords(now - touchedOf(st, s))`), and "can't read" in `blocked` for a faulted one. Every count in the menu is `countsOf`'s | `sessionMenu`, `olderShown` |
| The header: a dim "older" pill (`lg-older-pill`) while the shown session is cold, merged or not, its tooltip naming the file | `header`; `words.js` `olderPillTip` |
| The status line: the sessions the writer cannot read (`store.js` `coldFaults`), after an urgent writer-health line and before the writer's note | `render`; `words.js` `coldFaultsLine` |
| A cold session not merged: its PINS lane (pins stay in the store), then, instead of its lanes, one of three views. Loading: one line, `cold-reading`, "Reading this session's items (idle 9 days; kept in ledgr-data/cold/)… 3 open, 1 blocking." Unreadable here: why and that nothing is lost (`cold-error`), and Try again (`cold-retry`). Faulted: the writer's words and the events it keeps (`cold-fault`, in `blocked`), with "Another file of this session is in ledgr-data/cold/ (<name>[ and N more]): it may hold what is missing; ./install.sh --check says what it holds, and Use without its older items leaves it there." when `coldOthers` lists one (`render` asks for the listing while the shown session is faulted), Try again, Use without its older items (`cold-reset`, two clicks; armed it reads "Go on without its 5 older items? Click again") and Forget (`cold-forget`, two clicks), in `cold-acts`. The buttons' line is the entry `cold:retry` (Enter is Try again). No footer while not merged | `body`, `coldLines` |
| After a `cold_reset`: a dim line above its lanes saying what was lost and when the person chose to go on (`cold-lost`) | `body`; `words.js` `coldLostWords` |
| The footer's OLDER THAN A DAY fold of a cold session opens on its own (its open items are all older than a day) unless the person shut it for that session (`olderShut`); `folds.older` stays the person's choice for every other session | `foldOpen`, `toggleFold`, `olderAuto` (integration, 2 below) |
| Commands, bound to no key: `older-sessions` (the menu opened, its OLDER SESSIONS fold opened or closed, as its click), `cold-retry` (Try again), `cold-reset` (Use without its older items: twice, arm then post); on a warm session "The shown session is not an older one." | `command` |

**The dialog.**

| What | Where |
|---|---|
| The cold session an item target needs read: its session, when cold and not merged here (loading, error or fault); never for a pin or a branch, which stay in the store | `mods/ledgr/detail.js` `coldTarget` |
| Read at the start (`start`; the demo in the constructor), and again from a timer in `render` when `coldDue` | `start`, constructor, `render` |
| No record yet: "Reading this session's items (kept in ledgr-data/cold/)…" (`coldLoadingWords()`), never `DETAIL_GONE`, and the header says "ledgr", not "Gone"; unreadable here, `coldErrorWords`; faulted, `coldFaultWords` with `others` (the session's other files in `cold/`, `coldOthers`, listed from `render` while the target's session is faulted, as the panel does); in both, Try again (`dt-cold-retry`, Reader `coldRetry`) before Close | `goneWords`, `header`, `nothing(t, words, extra)` |
| The record arrives with a render, and the late-record path prepares it (fields, the props' open state, the keyboard as on open) | `render` (`preparedFor`, `prepare`, `applyOpen`, `focusFirst`) |
| `lookInArchive` skipped while the target's session is cold and not read: its item is in the file, not archived | `lookInArchive` |
| ⌘↓ / ⌘↑ and "N of M" walk the merged items as any lane; no change | `laneSpot`, `step` |

Props are unchanged: the dialog finds the file through the stub its own `store.json` read holds.

**Settings.** One row, "Idle sessions move out of store.json", after "Closed items stay in the list" and
before Branch depth: − and + (`st-cold-down`, `st-cold-value`, `st-cold-up`), the value in words
(`coldDaysWords`: "never" or "7 days"). `SETTING_KEYS` gains `coldDays`, `SETTING_PATHS.coldDays` is
`retention.coldDays`; `COLD_RANGE` 0 to 60; `clampColdDays` (0 or less is 0, "never"; any other value
rounded, at least 1, at most 60); the value shown is `config.js` `coldDaysOf` (re-exported), the reading the
writer uses, so a hand-written 100 shows as it is and steps back into the range. `editFor("coldDays", v)`
writes `retention.coldDays` inside `retention`, `retention.turns` kept, through `Reader.saveConfig`; a word is
refused. `savedLine` says "after 7 days" or "never (the writer brings every older session back)". No spool
event: `settings.js` still posts none (rule 12). (`mods/ledgr/settings.js`.)

**Words** (`mods/ledgr/words.js`). `idleWords(ms, long)` ("idle 9 d" in the menu, "idle 9 days" in the
panel's line; minutes under an hour, hours under a day), `olderSessionsWords(n, open)` ("OLDER SESSIONS (3)
›", open "▾"), `coldCountWords` ("3 open, 1 blocking", "nothing open"), `olderPillTip(file)`,
`coldLoadingWords(idleMs, counts)` (both optional: the dialog passes neither), `coldErrorWords(why, file)`,
`coldFaultWords({error, held, file, others})` (`others`: the integration's, the session's other files in
`cold/`, the first named and "and N more"), `COLD_RETRY` ("Try again"), `coldRetryWords(file, fault)`,
`COLD_RESET` ("Use without its older items"), `coldResetConfirm(n)`, `coldResetWords(name)`,
`coldLostWords(lost)`, `coldFaultsLine(faults, nameOf)`, `coldDaysWords(n)`, `SETTING_WORDS.coldDays`; and
the integration's `coldWaitWords(h)` ("Reading this session's older items for A1…") and
`coldUnreadWords(h)`.

**The demo** (`mods/ledgr/fixtures.js`). One more session, "nightly report backfill" (`DEMO_COLD_SESSION`),
idle nine days and cold: `demoData` holds its stub (`cold: {file: DEMO_COLD_FILE, at, n}`, the counts
`demoColdRecord(now).n`) and one pin, `pn_demo-pin-000f`; its items and turn records are
`FIXTURE_COLD[DEMO_COLD_FILE]` (`demoColdRecord`: Ask 1 a blocking provide, Ask 2 a decide with options, Ask 3
optional, Question 1 parked, Ask 4 closed by the agent; turns 4 to 6), which `wantCold` reads in the demo
instead of a file. `DEMO_COLD_FILE` has `COLD_NAME`'s shape. So `ledgr.demo` ends its session menu with
OLDER SESSIONS (1), and the session opens with its lanes.

**Integration** (on top of the builder's work).

1. `panel.js` `coldWait`, called first in `command`: a command naming an item by an `A<n>` or `Q<n>` handle
   (`open:`, `cursor:`, `go:`, `whole:`, `menu:`, `ask-here:`, `act:`, `pick:`, `copy-answer:`) on a cold
   session not merged here reads the file (`wantCold`, forced after an error) and keeps the command in
   `coldThen` `{sid, c, h, at}`, saying `coldWaitWords(h)` meanwhile; `onCold` runs it once the items are
   merged, when that session is still shown and the command is under a minute old, and clears the words.
   When the writer cannot read the file, `coldUnreadWords(h)` and nothing kept. A pin's or a branch's handle
   needs no file. Before, it said "No A1 in this session."
2. `panel.js` `olderAuto`: the OLDER THAN A DAY fold stays open on its own for a cold session and for a day
   after it came back (`s.thawedAt`), unless the person shut it for that session. The first act on a cold
   session thaws it, and its rows would otherwise fold away under the person's hand (found by
   `test_seams.mjs`).
3. `seen` does not move the idle clock, warm or cold: `store.js` `touchedAt` no longer reads `seenAt`,
   `apply()` leaves `touchedAt` alone for an act "seen", and `listing.js` `touchedOf` likewise. A session only
   looked at is not in use; before, a cold session's menu row said "idle 1 min" after a look.
4. `store.js` `commitFreeze` carries the idle clock onto the stub (`touchedAt`), since the items and turn
   records it was read from leave; "idle N d" no longer counts from too early.
5. Reader `coldOthers` and `coldFaultWords`' `others` (the outside review's blocker, `BUILD-NOTES-mod.md`
   20.5): the writer's sweep now keeps for good any unnamed cold file it cannot prove redundant, so a faulted
   session may have another file on disk that holds what its missing one held (a store gone back in time, an
   earlier reset). The panel's fault view names it before the person chooses Use without its older items,
   and says that the doctor tells what it holds and that the reset leaves it there; since the second review
   round the dialog's fault words name it too (`detail.js` lists them from `render` and passes `others`).
6. Tests: `test_detail.mjs` gained the handle-command cases (`open:`, `act:<h>:resolve`, the faulted case)
   and the fault view's other file (named once listed, only the session's own other files, no sentence with
   none); `test_list.mjs`'s `touchedOf` case no longer reads `seenAt`; `test_no_keystrokes.py` rule 15; the
   new `tests/test_seams.mjs` (below).

**Choices.**

- Showing a cold session reads its file and does not bring it back (the contract's default): browsing does
  not refill the store for another week, and no copy but the writer ever thaws. The first act other than
  `seen` posts its event, and the writer thaws before it applies.
- The menu and the loading line count from the stub (`countsOf` over `s.cold.n`, kept by level so any
  threshold can be counted): the menu reads no file.
- The cache is keyed by file name, which the writer never reuses: a session that froze again names a new
  file, so an old record is never merged under it; `mergeColdAll` also checks the record's session, and
  `store.js` `mergeCold` that the stub names the file.
- A merge only into a store the copy owns; in fallback mode the panel shows a clone instead.
- A faulted session is never merged, even when this copy can read the file: what shows is the writer's
  trouble and what to do about it, since its kept events wait at the writer.

**Tests.** `test_list.mjs` (506 checks, was 392): `parseCold`, `touchedOf`, and the Reader and panel contract
as text (`wantCold` reads `cold/<file>` within `COLD_READ_MS` through `parseCold`, the demo's fixture).
`test_detail.mjs` (1,345 at the integration's last run, was 1,003): the demo's cold session and its counts at three thresholds, merged or
not; `parseCold`'s refusals; the words; `pinning.js` `pinsTarget` taking a stub; the Reader over real files in
a scratch `ledgr-data/cold/` (read once when asked twice, merged with `s.cold` kept, deep copies, merged again
from the cache after a reload, an act on a merged item shown and posted naming the cold session, the record
dropped once no stub names it, nothing written but spool events); drafts kept while a read runs and for 60 s;
missing and bad files, the 30 s retry, Try again with no event, the cache at 12, a path instead of a name
refused with no read, a read that gets no answer bounded; faults (never merged, one `cold_retry`, Use without
arming, lapsing, then one `cold_reset`, shown at once with `coldLost`); Phase 1's archive leaving out merged
ids; the fallback clone (the writer's store untouched and refused by `mergeColdAll`, a new clone when the
writer saves, a typed answer on the clone, the writer's own store once warm); the panel's menu, the cold
session shown (Reading…, its pin, no footer, the pill, then its rows under an open OLDER THAN A DAY, no
motion, nothing written), a draft handed back for an unread item, `seen` posted and needing no thaw, the
error and fault views (the fault view naming the session's other file in `cold/`), the commands, the handle commands; the live-shape fixture across `store.js`'s freeze
(OLDER SESSIONS (20)); the dialog (Reading…, never Gone, Try again, faulted). `test_settings.mjs` (864, was
800): the row, `coldDaysOf`, `clampColdDays`, `editFor("coldDays", v)` beside `retention.turns`, its
refusals and saved words, − and +. `test_no_keystrokes.py` rule 15: only `writer.js` and `spool.js` write,
unlink, make or remove anything under `cold/`; the Reader's `coldOf`, `coldDue`, `coldLoading`, `wantCold`,
`coldLoaded`, `mergeColdAll`, `dropColdUnnamed`, `trimColdCache` and `coldOthers` only read; `coldRetry` and `coldReset`
post one event each; `mergeColdAll` guards the writer's store; `wantCold` reads only a name of the writer's
shape; the Python readers open cold files to read only. Across the seam, `tests/test_seams.mjs` (run by
`tests/test-seams.sh`, in `run-all.sh`) runs the real writer and the real panel on one scratch `ledgr-data`:
on the writer's freeze of the live-shape fixture (`fixture_cold.mjs`) the panel lists OLDER SESSIONS (20),
each row with the counts and the idle clock it had warm; shown, a session is read from exactly the file the
writer wrote; the panel's Done on one of its items thaws it at the writer; and the panel then shows it warm
with the same rows and handles. Its other parts (held events, Phase 1 and Phase 2 together, `coldDays` 0,
Python and JavaScript agreeing) are the writer's side (`BUILD-NOTES-mod.md` 20).

**Known limits.**

- Showing a cold session never brings it back: it stays under OLDER SESSIONS with its "older" pill while it
  is browsed, and only an act other than `seen` thaws it.
- `pinUseWords` says "used in Q3" instead of "sent in Q3 at turn N" for a question in a cold session this
  copy has not read (the pin is in the store; the question is in the file).
- A draft for an item of a cold session not read here is kept 60 s, or while a read runs, then dropped if
  its item is still not found.
- In fallback mode, while a cold record is merged, every change of the writer's text costs one parse of it
  for the clone.

**Not tried live** (after the install; `Retention.md` 10.12 has the whole path):

1. The session menu on the live store: OLDER SESSIONS (N) at the bottom, each row's count, ◆ and "idle N d".
2. A cold session shown: "Reading this session's items…", then its lanes and the "older" pill; `store.json`
   still names it cold (nothing brought back).
3. Done on one of its items: it comes back (the pill goes, the menu lists it above OLDER SESSIONS again),
   its rows stay open under OLDER THAN A DAY.
4. The settings row: − and + write `retention.coldDays`.
5. `herdr-app do ledgr.demo`: OLDER SESSIONS (1); open it, its lanes; Enter on Ask 1 opens the dialog.
6. `herdr-app do ledgr.open:<handle>` on a cold session not read yet: "Reading this session's older items
   for …", then the dialog on that item.
7. The fault view, in a throwaway session (`Retention.md` 10.12 step 6): its words, the kept events, the three
   buttons; with a copy of another file of that session in `cold/`, its name in the words.

## 19. An ask's summary and the answer box as the main region (2026-11-23)

Jesse, on Ask 42 in the dialog: the answer box was two rows high and about 630 px wide with Paste answer
beside it and most of the left column empty below, and nothing said precisely what he was asked to do (a
five-row table in the message). Built by the dialog's builder of a three-builder change (contract: a new
optional `summary` on an agent ask, at most 1,000 characters, markdown, line breaks kept; the store keeps it
through `store.js` `cleanSummary`, `BUILD-NOTES-mod.md`; the producers write it, `BUILD-NOTES-hooks.md`).
This half only reads `item.summary`. Line numbers are left out.

**The left column of an ask**, top to bottom (`detail.js` `itemParts`):

| Part | What | Notes |
|---|---|---|
| ARCHIVED | as before | an archived record only |
| TEXT | as before | |
| WHAT TO DO | the summary (`listing.js` `summaryOf`: an agent ask's `summary`, trimmed, else ""), `readable` in markdown mode with the dialog's link handler (paths and web links as in the text: it is the agent's text), behind a 2 px accent edge (`dt-todo-edge-<id>`), the title in accent, a Copy chip (`dt-cp-todo-<id>`, "What to do copied (N characters); nothing was pasted.") | none: no section, no placeholder; shown on a closed and an archived ask too; never on a question (`summaryOf` reads agent asks only) |
| OPTIONS | as before | a decide with options |
| ANSWER | `answerSection` → `views.js` `answerBox(host, t, st, s, it, o)`: the frame (`dt-answer-frame-<id>`, the column's full width, `.h(o.frame)`, `overflow_hidden`, a click on it focuses the textarea unless it has the keyboard: `focusAnswer`), the `Textarea` inside at `.h(frame − 12)`, then `o.below` (empty: the second round's attachments row goes here), then the row `dt-answer-row-<id>`: the ⌘Enter hint (`flex_1`) and Paste answer at its right | open, not archived, its session known (as before) |
| RESULT, QUESTIONS ABOUT IT | as before, now after the answer | |
| QUOTE | after them, dim, italic, 12 px (was muted, above OPTIONS); its Copy chip kept | a question keeps its quote where it was (TEXT, QUOTE, ABOUT, PINS, BRANCHES, the confirmation, RESULT) |
| resume lines, foot | as before (the foot is the provenance line: handle, origin, level, turn, hash); the two resume lines got ids (`dt-resume-failed-<id>`, `dt-resume-note-<id>`) | |

With an answer box the column's direct children are three: `dt-above-<id>` (ARCHIVED to OPTIONS; left out
when empty), `dt-sec-ans-<id>`, `dt-below-<id>` (RESULT to the foot), each a `v_flex` with the column's gap
(`LEFT_GAP` 12) that reports its height. Without one (closed, archived, no session) the parts stay flat, in
the same order. In one column the message's blocks follow the three, and `scroll_to_item` still finds the
passage (its index counts the three).

**Sizing the box** (the pixel route: Herdr's typings say a Textarea is sized by `rows`, `set_auto_grow` or
`.h(...)`, and the app's own feedback form uses `rows` with `.h(130)`; `.h_full()` or `.flex_1()` on a
Textarea is shown nowhere, so it is not used):

| What | Where |
|---|---|
| `ANSWER_BOX` `{minRows 8, floorRows 3, shortShare 0.6, size 12.5, rowEm 1.7, frame 12, inner 8, margin 2, hysteresis 4}`; a row is 12.5 px × the text scale × 1.7 (generous, so the rows the textarea is told never overflow the height it is given) | `detailing.js` |
| `answerMinFrame(scale, col)`: eight rows plus the frame's 12 and the textarea's own 8 (190 px at scale 1, 292 at 1.6, 156 at 0.8); in a column where that is over 0.6 of its height, 0.6 of it, never under three rows | `detailing.js` |
| `answerFrame({col, used, scale, current})`: the column's free height less the margin, at least the minimum; the height drawn now kept when the change is under 4 px; nothing measured, the minimum | `detailing.js` |
| `answerRows(frame, scale)`: the rows that fill a frame, at least three (the TextareaState is made with them and told them again on every fit) | `detailing.js` |
| What is measured: `dt-left`'s height (`on_size_change`, `noteFit("col")`), the two groups (`"above"`, `"below"`) and the ANSWER section (`"ans"`: its height less the frame drawn, `fit.drawn`, is its chrome: title, gaps, the hint row and whatever round 2 puts under the box) | `detail.js` `noteFit`, `this.fit` `{col, id, above, below, chrome, gaps, drawn}` |
| The fit: once all four are in for the item drawn, `used` = 2 × `LEFT_PY` + above + below + chrome + the gaps between the groups; `frameH` set, `set_rows` told, a render; a report for an item no longer drawn is dropped; a new item's measures start again (its frame keeps the last height meanwhile) | `detail.js` `fitAnswer` (a handler, never render) |
| The TextareaState: `rows` from the frame drawn (eight at first), no `set_auto_grow` (it would fight the given height); everything else as 16 (drafts, the cut, Enter, ⌘Enter, `unbreak`, `pasteSheet`) | `detail.js` `makeAnswer` |

Why measured groups rather than a flex-grown box: a box that grows by flex inside a scrolling column sizes
by its content, so it would never shrink when the window does or the text above grows; the groups' heights do
not depend on the box, so the fit converges in one more frame and stays (the margin leaves the column 2 px
short of its viewport, so filling it never shows a scrollbar, whatever the scrollbar's width does to wrapping).

**The list.** `listing.js` `tipOf` gains the summary's first 300 characters, line breaks kept, after "What to
do:", after the text and the quote and before "Your answer, not sent yet: …"; on archived rows too. The panel
draws `m.tip` as before (no change in `panel.js`).

**Tests.** `test_detail.mjs` (1,416, was 1,345): the TextareaState at eight rows and no auto-grow; the three
parts and the order in each group; WHAT TO DO's markdown, its path linkified, selectable, a link handler, Copy;
the frame at 190 and the textarea at 178 before any measure; Paste answer in the row under the box, not beside
it; the frame's click focusing the box once; the fit (nothing on three measures of four; 280 px from a 700 px
column; the same chrome after the redraw, no notify; under the hysteresis; taller, shorter, the minimum; a
report for another item; a 160 px column; scale 1.6 at 1,000, 500 and 420 px); a step keeping the frame and
making the next box with its rows; one column; an ask without a summary; a closed ask (its summary, no
groups, RESULT before QUOTE); a question's order and no summary; an archived ask's summary. The mock records
`.h(...)` (`_hpx`) and `set_rows` (`_rows`). `test_list.mjs` (518, was 506): the tooltip's line, its cut,
its place before the answer, blank and question cases, an archived row, `summaryOf`.

**Not tried live** (nobody opened UI during this build):

1. That the Textarea honours `.h(px)` given after `rows` (the feedback form suggests so) and fills the frame;
   if it is sized by its rows instead, `set_rows` from `fitAnswer` should bring it close, and the frame's click
   focuses it from the space left.
2. That `on_size_change` reports on `dt-left`, the two groups and the section (the typings say div, h_flex and
   v_flex with a stable id), that it fires once per changed size, and that the handlers of one layout all run
   before the render they cause (a wrong order would cost one more frame, not a wrong size).
3. That `set_rows` from a size handler takes effect without a flicker, and that a click inside the text does
   not move the caret when the frame's click then runs (it calls `focus()` only when the box has not reported
   focus).
4. The wheel over a tall box: whether it scrolls the column or only the box (Detail.md 2.2 kept scroll areas
   out of the columns for this reason; the box only scrolls when the column is at its minimum or the answer is
   long).
5. How it reads: the accent edge and title of WHAT TO DO, the dim quote at the bottom, the hint wrapping beside
   Paste answer at 0.8 and 1.6, and the dialog at its 420 × 320 floor.

### 19.1 Review fixes (2026-11-23)

1. 7.7, narrow dialog: under 760 px the message and its marked passage share the scrolling column, so the box
   no longer fills it: in one column it is `answerMinFrame` (eight rows), always (`detail.js` `frameFor`,
   `fitAnswer`); the root's width report refits when the column count flips (`noteWidth`). Test: one column,
   every measure in, the frame stays 190; wider, it fills; narrow again, 190 at once.
2. 7.8, hysteresis overshoot: `answerFrame` keeps the frame drawn only while it still fits (`cur <= want`) and is
   under 4 px short; a column 1 px shorter shrinks it at once. Test: 701 keeps 280, 699 gives 279; the review's
   600/200/398 then 597 gives 395.
3. 7.9, measures by item id: `this.fit` is `{col, id, by: Map(id → {above, below, chrome, gaps, drawn, frame})}`
   (`fitOf`, the newest 32 kept); a step back to an ask draws it at its own fitted frame at once and makes its
   box with those rows, with no report from Herdr; `fitAnswer` redraws only when the frame to draw differs from
   the one drawn (`drawn`), and tells `set_rows` only when the rows change (`rowsTold`).

## 20. An image in an answer (2026-11-23)

Jesse: the answer "needs to accept a photo attachment (from clipboard)". Then, on the clipboard route: "Yes,
allow osascript on ⌘V in the answer box with the pinned exception."

**The model.** No spool event, no store field, no writer change: an attached image is a file under
`ledgr-data/attachments/` named `<yyyymmdd>-<hhmmss>-<rand6>.<ext>` (png, jpg, jpeg, gif, webp; lower case, no
space or bracket for the hook's `[A3]` scan) and one line of the answer's draft, `attached image (read this file):
<absolute path>`, which goes through `typeDraft`, the 4,000 cut, the sheet (`answerLines` indents it under the
answer) and the landing parser unchanged. The agent reads the file from the path. At most 4 images to an answer,
8 MiB each. Nothing under `attachments/` is ever deleted or written over by ledgr (a name is taken only when
nothing is there).

| What | Where |
|---|---|
| The name, the checks, the line, finding and removing lines, the app-relative path for `image()`, sizes in words; `prepareSlot` (the folder made, a free name), `copyIn` (a dropped file: stat where fs has it, else read and measured; `fs.writeFile` of the bytes; read back and compared by length; bounded 10 s by `spool.js` `within`), `fileInfo` (size and header), `imageDims`, `thumbSize`, `cutDraft` (20.1) | `mods/ledgr/attach.js` (new; not an engine file; only `detail.js` imports it) |
| The drop: `on_drop` on the answer's frame → `dropOnAnswer`, each path in turn through `attachDropped` (by its name, then `attachRoom`, then `copyIn`) | `views.js` `answerBox` (`o.onDrop`), `detail.js` |
| The clipboard: the textarea's `paste_other` (⌘V found no text) and the row's Paste image → `pasteImage`: the demo runs nothing; one at a time (`this.attaching`, shared with the drop); `attachRoom` (an open ask, under four, room in 4,000) before anything runs; `prepareSlot("png")`; `opener.js` `clipboardImage(path)` | `detail.js` `makeAnswer` (one handler, no logic), `pasteImage` |
| The seam both routes end in: `attachWritten(id, path, cx, {size, how})`: a file already written directly in `attachments/` (`isOurs`), checked again (open, under four, room), its line at the end of the draft through `setDraft`, the status words | `detail.js` |
| The row under the box (`o.below`): a chip per line the draft holds (thumbnail through `image("ledgr-data/attachments/<name>")`, both sides set, fitted in 112 × 72 from the PNG's or JPEG's header, when `ui.attachmentThumbs` is not false, the file is at most 2 MiB and its header gives at most 4,096 a side (20.1); its name, its size, Reveal (`revealLink`'s open -R), Remove (the line out; the file stays)), then Paste image ("Attaching…" while one runs). A thumbnail `image()` refuses to make is left out (`views.js` `thumb`, try/catch; `image` imported by name) | `views.js` `attachRow`, `thumb`; `detail.js` `attachRowFor`, `attachInfoOf` (size and header read once from a timer) |
| The pinned call: `clipboardImage(outPath)` refuses (runs nothing) a path not absolute, with a line break or NUL, not `.png`, or not directly in `clipDir()` (`<appHome>/ledgr-data/attachments`); then `exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", CLIP_SCRIPT, outPath, String(CLIP_MAX)], { timeout: OPEN_TIMEOUT })`; `clipResult` maps the answer: written (bytes, converted), no image, too large, or why; a timeout and a runner that did not start in words; never throws | `opener.js` |
| `CLIP_SCRIPT` (JXA): the PNG flavour copied as is, else any image the pasteboard holds converted to PNG; no image, throws; over `argv[1]` bytes, throws before writing; its one write creates the file and never writes over one (`writeToFileOptionsError` with `NSDataWritingWithoutOverwriting`, 20.1); it makes no folder (`prepareSlot` does, from `attach.js`); `argv[2]`, a private pasteboard's name, only in `tests/test_clip.mjs` | `opener.js` |
| Words: `ATTACH_WORDS` (each refusal names the file and why); the hint under the box; the footer's `⌘V attach an image` | `words.js`, `views.js` |
| Rules: 1 (the literal once, as the pinned call), 13 (five shapes; the script's words; `clipRefusal` before the call; `clipboardImage` only in `pasteImage`; opener.js takes `exec` and `appHome`), 16 (only `attach.js` writes or makes under `attachments/`, nothing removes there, opener.js writes nothing, only `detail.js` imports `attach.js`, `pasteImage`'s order, `makeAnswer`'s one handler); `attach.js` in `NOT_ENGINE` | `bin/tests/test_no_keystrokes.py` |

**Tests.** `test_detail.mjs` (1,546): `attach.js`'s pure parts; the sheet carrying the line; live (a scratch
`ledgr-data`): a drop copied byte for byte, its line in the draft and the box, the chip and its thumbnail's
app-relative path, thumbnails off and over 2 MiB, a size read once; not an image, over 8 MiB, empty, unreadable,
three more in one drop, the fifth, no room (none writes a file); busy; Remove (the file stays); Reveal (open
-R); the clipboard with a stubbed exec: the exact argv and limit, the PNG named, "converted to PNG", Paste image,
no image, too large, a write error, a timeout, the fifth and no room (nothing run), the seam's refusals; the demo
(nothing copied or run). `test_links.mjs` (459): `clipboardImage`'s argv, each answer mapped, each refused path
(nothing run). `test_clip.mjs` (new, 32, in `test-detail.sh`): the shipped `CLIP_SCRIPT` run by
`/usr/bin/osascript` on private named pasteboards it seeds and releases (a PNG byte for byte, a TIFF converted to
a 16 × 16 PNG, nothing on it, over the limit, an odd path, no folder made, `clipResult` on each real answer), the
general pasteboard's change count unchanged; skipped off macOS. `test_no_keystrokes.py` (1,160; each new rule
checked against a mutation: a `clearContents`, an `Application(`, a `removeItem`, a fourth argument, the refusal
taken out, a second runner literal, an unlink, a write from views.js, a direct call from `paste_other`, a second
importer).

**Not tried live.**

1. Whether `paste_other` fires for a screenshot copied with ⌃⇧⌘4 (an image and no text), and what a browser's
   Copy Image or a Finder copy (text and an image) gives: Paste image is the way in for those.
2. Whether macOS asks for permission when a process Herdr started reads the pasteboard (a paste-permission
   prompt), and whether the first run of the runner is slow.
3. Whether ⌘V reaches the textarea while the dialog holds the keyboard (the box's own ⌘V, not a `mod:ledgr`
   binding: there is none).
4. Whether `on_drop` on the frame gets a drop made on the textarea inside it, and whether Herdr's `fs.readFile`
   reads a dropped file outside the home folder (it says "could not be read" if not).
5. Whether `image("ledgr-data/attachments/<name>")` draws (the path relative to the app's folder), at 72 px high
   with its width following, and what the host does with a picture it cannot load.
6. A paste or drop cut short by the dialog closing leaves its file unnamed in `attachments/` (nothing deletes it).

### 20.1 The second review's fixes (2026-11-23)

The review edited copies of the mod so the script ran a shell, cleared the clipboard and reached the network,
and in another pressed a key through System Events behind a `'a//b'` string, and a third ran `pasteImage` on every
resize: the suite said OK each time. Now it fails each (below).

1. 9.1, the pin. `CLIP_SCRIPT` is pinned by identity: `test_no_keystrokes.py` keeps a full copy
   (`CLIP_SCRIPT_PINNED`) and its sha256 (`CLIP_SHA256`, `9a709cc8f335…`), takes the script from `opener.js` as it
   is on disk, and requires it equal character for character, a plain template (no `${`, no backslash); the word
   checks stay as a second line (now also `setPropertyList`, `prepareForNewContents`, `releaseGlobally`, `NSURL`,
   `ContentsOfURL`, `system(`, an `ObjC.import` other than AppKit). The pinned call and the count of the literal
   `/usr/bin/osascript` (once in the whole mod, comments included) are checked on the raw text; opener.js's comment
   no longer names the runner's path. `strip_comments` respects literals: JavaScript by a small lexer (strings,
   templates with nested `${…}`, regex literals where one may start: after an operator, a bracket, a comma, a
   keyword or the start; after an identifier, a number, `)` or `]` a `/` is a division; a regex never spans a
   line), Python by `tokenize` (COMMENT tokens only), shell as before (a `#` after whitespace inside a quoted shell
   string is still cut). Self-checks of the stripper run first. What it exposed: the old block-comment regex had
   matched a `/*` inside a line comment (`turns/<sid>/*.md`, `terminals/*.json`, `adapters/*/adapter.json`) and run
   to the next `*/`, hiding 56 lines of `capture.js` (its imports and code from line 8 to 104), 7 of `spool.js`
   (381 to 389, `readMap`) and 10 of `adapters.js` (15 to 25) from every rule; no rule fails on them. An argument
   names another copy of the mod to check (`python3 -I -B tests/test_no_keystrokes.py <mod folder>`).
2. 9.2, who calls it. `pasteImage(` appears in detail.js twice (its definition, the `paste_other` handler) and in
   views.js once (Paste image in `attachRow`), nowhere else; `attachRow(` is defined in views.js and called once,
   from `answerSection`.
3. 9.3, create-only. The script writes with `writeToFileOptionsError($(out), $.NSDataWritingWithoutOverwriting,
   null)`: an existing file stays byte for byte and the run fails (`test_clip.mjs`, also when the clipboard holds
   another image); no temporary or partial file is left. Should a write fail part way, the dialog looks
   (`statAt`) and says a partial file may be left at its name, never names it, never deletes it.
   `clipRefusal` requires an attachment's own name, `^\d{8}-\d{6}-[0-9a-z]{6}\.png$` (`CLIP_NAME`). A drop's copy
   (`copyIn`) still writes with Herdr's `fs.writeFile`, which has no create-only flag: `prepareSlot` checks the
   name is free just before (a window remains there).
4. 9.4, one normalisation. `detailing.js` `appRoot(home)`: slashes made single, a trailing one dropped, null unless
   absolute, not "/" and free of "." and ".." segments. `attach.js` `attachDir`, `appRelative` and `opener.js`
   `clipDir` all use it; with no app folder every path is refused and nothing is attached. opener.js now imports
   `appRoot` from detailing.js. (`config.js` `dataDir` still joins `appHome()` as given: a trailing slash there
   gives `…//ledgr-data` for the store, not for attachments.)
5. 9.5, never locked. `pasteImage` bounds the clipboard's run with `within` (`ATTACH.clipMs`, 8 s), and
   `attachBusy()` treats a flag older than `ATTACH.staleMs` (60 s) as stale; each run clears the flag only if it
   is still its own.
6. 9.6, the line. `withAttach` adds the line and a line break after it; the line's pattern is built from the
   folder and ends at the image's extension, so words after it on the same line keep it an attachment; the box's
   cut at 4,000 (`cutDraft`) drops an image's line whole when the cut falls inside it and says so ("…the image
   line it reached was taken out whole (the file stays in ledgr-data/attachments/).").
7. 9.7, thumbnails. Both sides set (`thumbSize`: fitted in 112 × 72), and only for a PNG or JPEG whose header gives
   at most 4,096 pixels a side (`imageDims`); a GIF or WebP shows its chip alone. `fileInfo` reads the file once
   (size and header).
8. 9.8: `views.js` imports `image` by name. `test_detail.mjs` and `test_settings.mjs` stubs export it;
   `test_seams.mjs`'s stub does not (it loads `settings.js`, which imports views.js): it needs
   `export const image = (src) => el("image", { _src: src });` beside its `img`.
9. 9.9: `test_seams.mjs` line 596 writes its two no-break spaces as `\u00a0`.

Run against the review's copies (`scratchpad/review2/modcopy*/ledgr`, older than these fixes), the guard fails
each (11 to 16 failures, among them: the script not the pinned one; `pasteImage(` three times in detail.js; the
System Events words); the same edits applied to a copy of this tree fail on exactly what they change (the script
not the pinned one; `pasteImage(` counted three times in detail.js; the runner word, `Application(`, `System
Events`, `keystroke`, `doShellScript` and the pin); the repo passes.

### 20.2 The live check, and an image that arrives as its file's path (2026-11-23)

The live check, on the installed build: the new answer layout was liked ("LOVE the new answer layout"), and ⌘V
reaches the answer box while the dialog holds the keyboard. No macOS permission prompt appeared, which says
nothing yet (below). The gap: the captures come from CleanShot, not ⌃⇧⌘4, and a capture pasted into the box and a
file dropped on the text both arrived as one plain line of text, the file's absolute path (with spaces:
`…/Application Support/CleanShot/media/media_x/CleanShot 2026-11-23 at 4.09.28 PM.png`), with no attachment line,
so no chip and no thumbnail. The drop putting the file into the answer was liked ("SWEET"), and the agent could read
the file from that path. So a clipboard carrying a file reference is pasted by Herdr's textarea as the path, as
text (`paste_other` never fired and the clipboard script almost certainly never ran), and a file dropped on the
textarea is inserted by the textarea itself (the frame's `on_drop` did not get it).

**The fix: a path that arrived whole becomes an attachment** (`detail.js` `pathsIn`, `attachPathLine`; `attach.js`
`insertedSpan`, `pathOf`, `pastedPaths`, `withAttachAt`, `withoutRaw`, `OTHER_IMAGE_EXTS`).

- "Arrived whole in one change": the change handler hands `pathsIn` the draft before and the box's value after.
  What the change inserted is the new value less the longest prefix, then the longest suffix, it shares with the
  draft before (`insertedSpan`); it must be at least two characters. Each line of that inserted text, trimmed,
  that is exactly an absolute path or a `file://` URL (`file:///…`, `file://localhost/…`, percent-decoded) naming a
  file whose extension is an image's (png, jpg, jpeg, gif, webp in any case; heic, heif, tif, tiff, bmp, svg, avif,
  ico are said and not taken), outside the attachments folder, is taken. A key typed inserts one character, so a
  path typed by hand is never taken, nor one finished by a keystroke; a path pasted after words on a line is taken,
  the words keeping their own line.
- Taken: copied in as a drop is (`copyIn`, the same limits, the same one-at-a-time flag), then the attachment line
  takes the path's place (with a line break after it) and the chip and thumbnail follow; every other line stays as
  it is. Several paths in one paste are taken in order until a limit refuses the next.
- Refused (cannot be read, over 8 MiB, empty, not a type ledgr takes, the fifth, no room under 4,000 characters,
  another attach running, the copy failing): the path stays as text and the status line says why, ending "; its
  path stays in the answer as text, which the agent can read." If the path's line was changed while the file was
  copied, it is not named and the status line says so (the copy stays).
- One file, one attachment: a drop registers its sources at once (`recentSrc`); the same path arriving in the text
  while the drop copies, or within 2 s after, is not taken again: its raw text goes, or the drop's line takes its
  place. The same file dropped within 2 s of its path arriving in the text is skipped by the drop.
- Nothing here reaches the clipboard's reader or any process (rule 16: `makeAnswer` makes one call, `pathsIn`;
  `pathsIn` and `attachPathLine` copy through `copyIn` alone); the callers of `pasteImage(` are unchanged.
- The hint under the box: "pasting or dropping an image attaches it, as a picture or as its file's path".

Assumed about Herdr's textarea, not seen: that a paste or a drop arrives as one `change` holding the whole path
(were it delivered in pieces, no piece would be a whole path and the path would stay text, said by nothing); that a
path is inserted plain, not quoted or with escaped spaces; that one file per line comes when several are pasted.

**Still unseen live:** whether the clipboard script prompts when it does run (Paste image, or a clipboard holding an
image and no file reference); whether a thumbnail draws now that an attachment line exists.

