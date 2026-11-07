# ledgr Phase 3: build notes (2026-11-05)

The confluence: a concluded branch returns one human-approved message to the end of its trunk, the
parked question resolves, and ledgr never types into a terminal. The answer sheet for agent asks closes
its loop the same way. Herdr 0.1.13, hc 0.1.18, Claude Code 2.1.311. Earlier notes:
`BUILD-NOTES-mod.md`, `BUILD-NOTES-hooks.md`, `BUILD-NOTES-phase2.md`. Spec: Sections 6.4, 8.6 and
11 of `docs/design/Herdr ledger mod design.md` (the Phase 3 table is appended to Section 11).

## 1. What it does

1. A branch row in BRANCHES (expanded) shows **Conclude…** once the branch has started and its question
   is not closed. It opens an editor under the row:

   | Part | Says |
   |---|---|
   | Header | `Conclude br-q1-c51e: what goes back to t1w` |
   | Source line | "Prefilled from the branch's ledgr-conclusion block (its turn 1). Edit freely." / "No ledgr-conclusion block: prefilled with the branch's last message (its turn N)…" / "The branch has not answered yet: write the conclusion yourself, or ask the branch for one." |
   | Textarea | the prefill (the newest `ledgr-conclusion` block in the branch's last 10 turns, else its last message, capped at 4,000 characters, else empty); the person edits freely |
   | Moved-on line | only when the trunk's turn is past the fork turn F: "The trunk is at turn 5; the branch saw it up to turn 2. Check the conclusion against turns 3–5…" |
   | THE MESSAGE | the confluence exactly as it will be staged, with its word count outside the conclusion |
   | Trunk line | the trunk's live Herdr status and how to paste: "Trunk t1w is idle: type a one-line lead-in such as “Adopt this branch result for Q1:”, then ⌘V, Enter." / "…is working: wait until it is idle (a paste now joins the running turn), then …" / "…is not live…". It informs; nothing blocks |
   | Buttons | **Send to trunk** (primary; disabled while the text is empty), **Ask for a conclusion** (when the prefill is not a block and the branch terminal is live), **Reset** (after an edit), **Cancel** |

2. **Send to trunk** composes the message (`confluence.js`), writes it to the clipboard, focuses the
   trunk's pane (`pane.focus`) and posts one `conclude` spool event. The branch becomes `concluded`, the
   question `rejoin_pending` (glyph ↩, sub-line "confluence from br-q1-c51e on the clipboard: resolves
   when it is sent in t1w"). Nothing is typed, and `hc send` is never used.

   Later (2026-11-06): the button is now **Paste into trunk** and goes one step further. Once Herdr
   reports the trunk's terminal focused, it pastes the message into the prompt with `terminal.paste`
   and never presses Enter; the person adds a word and sends it (`ui.pasteIntoPrompt`, default on;
   off, it is still clipboard plus focus). `BUILD-NOTES-mod.md` section 16.

   ```
   ledgr confluence br_09ba0ba7-6b14-4c0d-ac9e-8ff1a41cc51e rq_83aa6f80-6a4b-4f89-ab29-60dd84cddd24
   Parked question Q1, from turn 1: Which word did you reply with, and is it a complete sentence?
   Conclusion:
   answer: Turn-1 reply was the single word "ready", which is a fragment, not a complete sentence.
   changes: none
   checked: the trunk transcript shows the same single-word reply.
   I am adopting this branch's conclusion as the answer to Q1; the branch (br-q1-c51e, a fork of this conversation) saw the trunk through turn 1.
   ```

   (The live test in section 5 ran with the first wording of the last line, "This is the result of
   branch br-q1-c51e, a fork of this session that saw it up to turn 1 and nothing later. Treat the
   conclusion above as the answer to Q1."; see section 9.)

   54 words outside the conclusion here (the question is clipped at 240 characters, so the wrapper
   stays under 200 words). No transcript, no tool output.
3. While staged, the branch row shows CONFLUENCE STAGED with the conclusion and the trunk line, plus
   **Copy again** and **Edit conclusion…**; the question row offers **Copy confluence again**, **Call
   off** (back to open; the branch returns to running and keeps the edit for the next Conclude) and
   **Resolve** (by hand).
4. The person types a one-line lead-in in the trunk (the panel suggests "Adopt this branch result for
   Q1:"), pastes and presses Enter. The trunk's UserPromptSubmit hook finds the marker as the first
   line of the pasted block (or of the prompt) and emits `confluence_landed` (after the turn's
   `prompt` event, printing nothing). The writer resolves the question (`resolvedBy: "branch"`, `resolvedTurn` =
   the landing turn, `resolution: {branchId, turn, at}`), marks the branch `rejoined` (`rejoinedTurn`),
   and appends one line to `ledgr-data/sessions/<trunk sid>/decisions.md`:

   ```
   # ledgr decisions · repo-20 (71bfee9b-4a20-46a4-8361-974d92a21000)

   One line per branch conclusion that reached this session. Written by the ledgr writer.

   - 2026-11-05 17:48 · turn 2 · Q1 “Which word did you reply with, and is it a complete sentence?” → Turn-1 reply was the single word "ready", which is a fragment, not a complete sentence. · branch br-q1-c51e (br_09ba0ba7-6b14-4c0d-ac9e-8ff1a41cc51e)
   ```

   A second paste of the same confluence records `landedAgain` and writes no second line. A confluence
   submitted in another session puts a note on the branch and resolves nothing.
5. After rejoin, the row shows REJOINED (landing turn and time, the conclusion, "Q1 resolved by this
   branch · line in ledgr-data/sessions/71bfee9b…/decisions.md") and **Close branch**. A click turns it
   into **End t1x** / **Keep**; End posts `close_branch` and the writer runs `hc kill <t>`, then
   `hc rm <t>` (a kept terminal ends too: keep only replaces lost programs). The record stays, with its
   conclusion; the row then reads `Q1 · depth 1 · closed · rejoined t2` and "terminal closed 17:50".
6. **Ask for a conclusion** writes a short request to the clipboard ("Please conclude on Q2 now. End your
   reply with the fenced block tagged ledgr-conclusion, for example: …", no `[Q2]`-style ref) and
   focuses the branch's pane, or peeks a pane-less branch.
7. **Copy answers** (ASKED OF YOU) now stages the answer sheet with a marker:

   ```
   ledgr answers 71bfee9b-4a20-46a4-8361-974d92a21000
   Answers to your asks from turn 4:
   A1: blue
   A2: No, keep it. No tools needed; just acknowledge.
   ```

   When it is submitted, the hook emits `answers_landed` and the writer marks those asks `answered`
   (`answer`, `answeredTurn`, `answeredBy: "sheet"`). A sheet naming another session is ignored; closed
   asks stay closed.

   Later (2026-11-06): **Paste answers** and **Paste answer** paste the sheet into the session's
   prompt the same way (`BUILD-NOTES-mod.md` section 16).

## 2. Data and events

| Event | From | Payload | Applied |
|---|---|---|---|
| `conclude` | panel (Send to trunk) | `session_id` (the trunk), `branch_id`, `item`, `text`, `message`, `source` (`block`, `last`, `empty`, `edited`), `source_turn` | own event. Branch `concluded`, `conclusion: {text, message, source, sourceTurn, trunkTurn, at}`, `concludedAt`; item `rejoin_pending`, `rejoin: {branchId, at}`. Ignored for another session's branch and for `refused`, `failed`, `launching`, `rejoined` |
| `confluence_landed` | trunk's UserPromptSubmit hook | envelope (the session the prompt was submitted in) + `turn`, `branch_id`, `item_id`, `prompt_id`, `conclusion_head` | item `resolved` (`resolvedBy: "branch"`), branch `rejoined`; `out.decisions` gets one line the first time |
| `answers_landed` | the same hook | `turn`, `for_session` (the marker's id), `handles`, `answers` ({handle: text, 400 chars}), `prompt_id` | asks of that session named in `handles`: `answered`, `answer`, `answeredTurn`, `answeredBy: "sheet"` |
| `close_branch` | panel (Close branch, second click) | `session_id` (the trunk), `branch_id` | own event; only for a `rejoined`, unclosed branch: `closeRequestedAt`, `out.close`; the writer reports through `branchClosed` (`closedAt`, or `closeError`) |

Status additions: item `rejoin_pending` (counted active in YOUR QUESTIONS and in `snapshot.json`, not
counted open on the chip); branch `concluded`, `rejoined`. `act reopen` on a `rejoin_pending` item
calls the confluence off (`cancelRejoin`). A prompt never marks a `rejoin_pending` question "sent"
(the confluence names it). Hook ordering: the landing event's `at` is at least the prompt event's + 1,
so name order applies `prompt` (turn +1) first.

Marker grammar (`bin/lib/ledgr_landing.py`): the line is exactly `ledgr confluence br_<id> rq_<id>`
or `ledgr answers <session id>` (ids of `[A-Za-z0-9_-]`; a trailing word, a different case or a double
space means no landing), and it stands either as the first non-empty line of any pasted block (Claude's
`<pasted_content id="…">` … `</pasted_content id="…">`; the adapter passes that syntax as `wrapper`),
or, unwrapped, as the first non-empty line of the prompt or the second after a single lead-in line of
at most 200 characters. Not a landing: a block that opens inside a code fence the person typed, a
block or prompt whose first line is a fence, a marker after text on the same line, a marker after two
or more lines of prose. Answer lines are `A<n>: text`, read only inside the marker's own block; other
lines after an answer continue it.

## 3. Files

Created:

| File | What |
|---|---|
| `mods/ledgr/confluence.js` | pure engine module: `confluenceMessage`, `answersSheet`, `conclusionRequest`, `extractConclusion`, `conclusionHead`, `decisionLine`, `decisionsHeader`, `forkTurnOf`, `wrapperWords` |
| `mods/my-tabs/ledgr/confluence.js` | generated engine copy (`install.sh`) |
| `mods/ledgr/bin/lib/ledgr_landing.py` | pure, agent-agnostic marker parser `detect(prompt)` |
| `mods/ledgr/BUILD-NOTES-phase3.md` | these notes |

Edited:

| File | Change |
|---|---|
| `mods/ledgr/store.js` | `conclude`, `confluence_landed`, `answers_landed`, `close_branch` handlers; `cancelRejoin`, `branchClosed`; `out.decisions`, `out.close`; `rejoin_pending` in the snapshot states; `on_prompt` skips staged questions |
| `mods/ledgr/writer.js` | `appendDecision` (before `store.json`, skips a branch already in the file), `closeBranch` (`hc kill`, `hc rm`); `confluence.js` in `ENGINE_FILES` |
| `mods/ledgr/panel.js` | Conclude editor (`TextareaState`), Send to trunk, Copy again, Call off, Ask for a conclusion, Close branch (two clicks), staged and rejoined views, `rejoin_pending` row, answer sheet with marker; commands `conclude`, `conclude-edit:<text>`, `send-to-trunk`, `ask-conclusion`, `copy-confluence`, `close-branch`, `copy-answers` |
| `mods/ledgr/nav.js` | `answersMessage` moved to `confluence.js` (`answersSheet`) |
| `mods/ledgr/config.js` | `LIMITS.conclusion` 8000 |
| `mods/ledgr/fixtures.js` | a rejoined, closed branch of Q2 (Q2 resolved by it); the demo opens the Conclude editor on the Q3 branch |
| `mods/ledgr/main.js`, `RECIPE.md`, `BUILD-NOTES-mod.md` | command list; disclosure (`hc kill`, `hc rm`); engine list |
| `mods/ledgr/bin/lib/ledgr_spool.py` | builders `confluence_landed`, `answers_landed`; docstring (also lists `conclude`, `close_branch`) |
| `mods/ledgr/bin/adapters/claude/claude_hook.py` | `landing()`: after the prompt event, Claude paste-wrapper lines dropped, `ledgr_landing.detect`, landing event |
| `mods/ledgr/bin/tests/test-hooks.sh` | 19 landing checks (lead-ins, pasted blocks, code fences included), a confluence prompt in the timing table (78 checks) |
| `mods/ledgr/bin/tests/test_store.mjs`, `test-store.sh` | 87 Phase 3 checks; the JS-composed messages parsed by the Python parser |
| `mods/ledgr/bin/BUILD-NOTES-hooks.md` | Phase 3 section |
| `install.sh` | `confluence.js` in `ENGINE_FILES` |
| `CLAUDE.md`, `docs/design/Herdr ledger mod design.md` | status row; Section 11 Phase 3 table |

Not touched: `mods/my-tabs/main.js`, `mods/my-pane/*`, `keys.json`, `layouts/custom.json`, shipped mods,
`~/.claude/settings.json` (no new hook entry: UserPromptSubmit was registered in Phase 1).

`install.sh` backups of the pre-Phase 3 live mods and `settings.json`:
`~/.local/state/ledgr/backup-20261105-174448/`. Rollback: copy `mods/` back from there (and remove
`mods/my-tabs/ledgr/confluence.js`).

## 4. Behaviours observed

| Behaviour | Result |
|---|---|
| The prompt a hook sees for a pasted confluence | **Wrapped.** Claude Code 2.1.311 marks pastes: the transcript's user message was `\n\n<pasted_content id="c9c5">\nledgr confluence br_… rq_…\n…`. `detect` reads each pasted block's first line (hooks.md, "UserPromptSubmit input", says expanded pastes sit between those lines). Without that the marker would never be first |
| The input box after a paste | `[Pasted text #1 +6 lines]` (over 3 lines collapses); Enter submits the full text |
| The trunk model's reading | Haiku answered "The turn-1 reply was the single word "ready". It is a fragment…": it took the conclusion as the answer. The second paste got "That's the same pasted result as before…". Claude Code tells the model a paste may hold instructions the person did not write; with nothing typed, the closing line still worked here |
| `hc keys <t> cmd+v` | Types `v` (the modifier is dropped): hc keys cannot paste. The test used Herdr's own `terminal.paste` (what ⌘V is bound to in `keys.json`) after checking `herdr-app status` showed the scratch trunk focused |
| `hc kill` on a kept terminal | Ends it (`state: finished`, `reason: killed`); `keep` does not restart a killed program. `hc rm` then removes it and its pane; a second `rm` answers `not_found` (rc 3), which Close treats as done |
| `TextareaState` from a `nextCommand` task | Works: created in the command handler, `set_value` from a task after the read, `value()` read back into the staged message |
| `herdr-app do 'ledgr.conclude-edit:<text>'` | Delivered verbatim to `nextCommand()` (the edit reached the staged message) |
| Hook time with a confluence prompt | median 44.5 ms (plain prompt 44.7 ms), load average 3.8 |

## 5. Live test (scratch only)

Scratch repo `<scratchpad>/ledgr-p3/repo` (a Claude Code session scratchpad)
(git). Model: Haiku for every test session. Nothing was sent to t1g, t2, t3 or t4. Evidence in the same
folder: `evidence-store.json`, `evidence-decisions.md`, `evidence-hooklog.txt`, `captured/` (the raw
`confluence_landed`, `answers_landed` and `close_branch` events), `confluence-staged.txt`,
`answers-staged.txt`.

1. Space `ledgr-p3`, tab `trunk`: `claude --model haiku "Reply with the single word ready."` in `t1w`
   (session `71bfee9b`; the folder-trust prompt answered with `hc keys t1w down enter`). Q1 parked
   through a `capture` spool event at turn 1.
2. `herdr-app do ledgr.branch` then `ledgr.launch-branch`: `br-q1-c51e` in `t1x` beside the trunk,
   child `44955b80`, F = 1. Its first turn ended with a `ledgr-conclusion` block.
3. `ledgr.conclude` opened the editor prefilled from the block (`source: "block"`, turn 1);
   `ledgr.conclude-edit:checked: the trunk transcript shows the same single-word reply.` appended a line;
   `ledgr.send-to-trunk`: the clipboard held the message above, the focused agent was `t1w`, the trunk's
   prompt was still empty, the branch `concluded`, Q1 `rejoin_pending`.
4. `terminal.paste` (focus checked) and `hc keys t1w enter`. hook.log:
   `t1w confluence_landed 71bfee9b… turn=2 branch=br_09ba0ba7…`. Store: Q1 `resolved`, `resolvedBy:
   "branch"`, `resolvedTurn: 2`; branch `rejoined`, `rejoinedTurn: 2`; decisions.md line as above.
5. The same paste again (spool watcher running): the captured event

   ```json
   {"v": 1, "type": "confluence_landed", "at": 1793918993010, "terminal": "t1w",
    "session_id": "71bfee9b-4a20-46a4-8361-974d92a21000", "turn": 3,
    "branch_id": "br_09ba0ba7-6b14-4c0d-ac9e-8ff1a41cc51e", "item_id": "rq_83aa6f80-6a4b-4f89-ab29-60dd84cddd24",
    "prompt_id": "58e9a6bf-c284-41b4-94a5-b88f7076d7a1",
    "conclusion_head": "Turn-1 reply was the single word \"ready\", which is a fragment, not a complete sentence."}
   ```

   Store: `landedAgain: {turn: 3}`, `rejoinedTurn` still 2, Q1's `resolvedTurn` still 2, decisions.md
   still one line.
6. `ledgr.close-branch` twice (the two clicks): the first armed it (no event), the second posted
   `close_branch`; `hc get t1x` then answered `not_found`, the tab held only `t1w`, and the record kept
   `status: "rejoined"`, `closedAt`, and the conclusion.
7. Answer sheet: a pasted prompt made the trunk ask two things; Haiku extraction gave A1 (decide, red /
   blue) and A2 (confirm). Drafts posted as the panel's typing does (`act draft`), `ledgr.copy-answers`
   staged the sheet above, paste + Enter: `answers_landed {turn: 5, for_session: 71bfee9b…, handles:
   ["A1","A2"], answers: {…}}`; A1 and A2 `answered`, `answeredBy: "sheet"`. The trunk replied "Got it:
   the logo is blue, and the old CHANGELOG file stays."
8. Ask for a conclusion: Q2 parked, a pane-less branch `br-q2-9bd8` (`t1y`) launched, `ledgr.ask-conclusion`
   put the request on the clipboard and peeked the branch (not pasted).
9. Cleanup: `t1y` killed and removed, the space closed, `t1w` removed; a `forget` spool event for the
   trunk removed the 3 test sessions, 4 items and 2 branches (ids in `store.forgotten`); the live store
   is back to its 4 sessions and 24 items. Deleted the test map files (`t1w`, `t1x`, `t1y`), session
   files and the `sessions/71bfee9b…/` folder (decisions.md, copied to the evidence first), turn
   folders and locks under `ledgr-data/`; the scratch project folder under `~/.claude/projects/` and
   the three sessions' `~/.claude/file-history`, `session-env` and `skills/my-queue/.last-check-*`
   entries. Clipboard restored to what it held before the test. Window put back: homebase, t3 focused,
   panel hidden with Quota selected, width 360.

Residue: `~/.claude.json` gained a project entry for the scratch path and `~/.claude/history.jsonl` the
test prompts (Claude Code writes both; not edited). `store.json` keeps the 3 forgotten ids.

## 6. Deviations from the spec and the brief

| Topic | Built | Why |
|---|---|---|
| Delivery (spec 8.6, 6.4) | Clipboard + focus; never `hc send --if idle` | The brief and the Grok critique: a paste or send joins a draft already in the prompt |
| Landing | The trunk's UserPromptSubmit hook detects a first-line marker and emits `confluence_landed` / `answers_landed` | Without typing, only the hook can tell the message was actually sent |
| Event payloads | `confluence_landed` adds `prompt_id`, `conclusion_head`; `answers_landed` adds `for_session`, `answers`, `prompt_id` | The decisions line uses what actually landed; a sheet pasted into the wrong session is ignored; the row shows the answer text |
| Message (spec 8.6) | Marker line, question line, `Conclusion:`, the text, one closing line in the person's voice ("I am adopting this branch's conclusion as the answer to Q1; the branch … saw the trunk through turn F.") | The brief and the coordinator's refinement; spec 8.6 had a one-line `[ledgr] Q7 (…): <answer>` |
| Lead-in | The panel tells the person to type a one-line lead-in before pasting and suggests "Adopt this branch result for Qn:"; the hook accepts the marker as the first line of any pasted block | Claude Code presents a bare paste as text that may hold instructions the person did not write; typed words carry the person's intent |
| Answer sheet (spec 6.4) | `ledgr answers <sid>`, then the Phase 1 line "Answers to your asks from turn N:", then `A5: …` | The brief's marker and `A5:` lines; the second line keeps the model oriented (it never saw ledgr handles) and the parser skips it |
| Status names | Item `rejoin_pending` then `resolved` + `resolvedBy: "branch"`; branch `concluded` then `rejoined` | The brief; spec and research said `merged` |
| Staleness (spec 8.6) | A warning line in the editor when the trunk's turn is past F, and the message says what the branch saw | No mark that blocks the send; the person decides |
| Who does what | The panel composes and stages (clipboard needs the click's `cx`); the store records; the writer only appends decisions.md and runs Close | One writer owns `store.json`, as in Phase 2 |
| Close | `hc kill`, then `hc rm`; offered only after rejoin | The brief; a branch that ends by itself is still read from Herdr status |
| decisions.md place | `ledgr-data/sessions/<sid>/decisions.md`, beside the hooks' `sessions/<sid>.json` | The brief |
| Engine | New engine module `confluence.js` (store and writer import it) | Pure and shared; `ENGINE_FILES` in `writer.js` and `install.sh` |
| Simulated paste in tests | Herdr's `terminal.paste` on the focused scratch trunk, then `hc keys enter` | `hc keys cmd+v` types `v`; `terminal.paste` is ⌘V's own binding. `hc keys` was used only in scratch sessions (trust prompt, one stray `v`, Enter) |
| Not built | "Send when idle", auto-detected staleness of `changes:`, reopen of a closed branch, a branch map | Outside the brief |

## 7. Tests

```sh
cd ~/.config/herdr-app/mods/ledgr/bin && bash tests/run-all.sh
# OK parse_block · OK last_assistant · OK fixtures · 78 passed (hooks)
# OK: store, 249 checks (54 phase 1, 108 phase 2, 87 phase 3); landing parser reads both messages
herdr-app check mods/ledgr && herdr-app check mods/my-pane && herdr-app check mods/my-tabs   # pass
# also a FORCE_DEMO copy of mods/ledgr (renders the Conclude editor and a rejoined row): pass
```

## 8. Not verified

- What the panel looks like live: `herdr-app shot` returned a stale frame (the window was inactive the
  whole test). The editor, the staged and rejoined rows and the `rejoin_pending` row render without
  error in the FORCE_DEMO check, and `herdr-app status` showed no errors after each command.
- Real clicks and real typing in the Textarea (driven by the panel commands that call the same code).
- A paste while the trunk is working: Claude Code queues it into the running turn; whether
  UserPromptSubmit fires then, and with which turn, is untested.
- Sessions where Claude Code does not mark pastes (no feature-flag fetch): the plain form is covered
  offline; live showed only the wrapped form.
- How larger models treat a confluence pasted with nothing typed (Claude Code flags pasted text as
  possibly not the person's instructions). Haiku took it as the answer.
- Close on a worktree-isolated branch (its space would stay), the panel's fallback writer appending
  decisions or closing, Call off and Copy again live, and Ask for a conclusion followed by the branch's
  reply (only the staging and the peek were run).

## 9. Refinement: lead-ins and the closing line (2026-11-05, after the live test)

Claude Code presents a paste as `pasted_content` that may hold instructions the person did not write,
so the person will often type a short lead-in and then paste. Changed, offline-tested and deployed with
`./install.sh`; the live run in section 5 predates it.

- `lib/ledgr_landing.py`: `detect(prompt, wrapper)` accepts the marker as the first non-empty line of
  any pasted block (not only the prompt's first line), skips blocks that open inside a code fence the
  person typed and blocks whose first line is a fence, and keeps the unwrapped form: first line, or
  second after one lead-in line of at most 200 characters. Answers are read only inside the marker's
  block. `claude_hook.py` passes Claude's `<pasted_content>` opening and closing lines as `wrapper`
  instead of deleting them.
- `confluence.js`: the closing line is the person's assertion, "I am adopting this branch's
  conclusion as the answer to Q1; the branch (br-q1-…, a fork of this conversation) saw the trunk
  through turn F."; `leadIn(item)` gives "Adopt this branch result for Q1:".
- `panel.js`: the editor's and the staged row's trunk line, and the Send / Copy again flash, tell the
  person to type that lead-in, then ⌘V, Enter.
- Tests: `test-hooks.sh` adds 8 checks (lead-in + wrapped paste, lead-in + unwrapped paste, a marker in
  a second pasted block, three code-fence forms ignored, inline and two-line lead-ins ignored with
  their prompt events intact, a lead-in + wrapped answer sheet with typed text after the block):
  78 in all. `test_store.mjs` checks the new closing line, that the message carries no instruction to
  the model, and the lead-in text: 249 in all.
- Not run live: the lead-in form with a real paste (the detector paths are covered offline; the
  wrapped form itself was seen live in section 4), and the model's reading of the new closing line.

