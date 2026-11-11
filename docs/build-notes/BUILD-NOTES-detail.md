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
