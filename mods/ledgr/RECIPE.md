# ledgr

A side panel that keeps a two-direction list of asks around one agent conversation. Questions you
park while reading (⌘J, even while the agent is still streaming) sit in the top lane; the asks the
agent made of you at the end of each turn (decide, confirm, do, provide, review) sit in the lane below,
one row each, answerable in place. Every ask has a level: blocking (the agent stopped or cannot finish
without you), needed (the task is not truly done until you act), optional (an offer or suggestion).
Asks below the threshold (`extract.threshold`, set from the ASKED OF YOU head) are kept in a folded
"below threshold" line. A small chip in each
pane header counts what is open. Nothing is ever typed into an agent: answers and `/btw` questions go
to the clipboard and the pane is focused.
(No preview.png is included in this build.)

## Before you add it (disclosure)

- **Runs programs.** The mod calls `hc read <terminal>` (to check a clipboard quote against a working
  agent's screen), `hc keys <terminal> ctrl+o /` (Go to anchor: opens Claude's transcript search on an
  idle agent), and its writer runs `exec("bash", [mods/ledgr/bin/adapters/<agent>/extract.sh,
  "--retry", ...])` (the Retry button on a turn whose extraction failed).
- **Starts agents (Phase 2).** Launch on a Branch confirmation makes the writer run
  `hc run --bg --parent <trunk terminal> --outlive-parent --no-notify ... -- /usr/bin/env
  LEDGR_PARENT=... LEDGR_BRANCH=... claude --resume <sid> --fork-session --session-id <uuid> -n <label>
  <preamble>`: a new Claude Code session (it uses your Claude plan like any session), then
  `terminal.keep` to give it a pane beside the trunk. "isolate in a worktree" opens Herdr's worktree
  dialog, which runs `git worktree add` under `~/.herdr/worktrees/` and a new space. The panel runs
  `git -C <cwd> rev-parse` to know whether that toggle applies, and `which claude` once.
- **Resumes a session.** Resume session…, offered in place of Go to anchor when a Claude session's
  terminal is gone, makes the writer run `hc run --bg --json --no-parent --no-notify --cwd <its folder>
  -- claude --resume <session id>` (no fork, no preamble; it uses your Claude plan), then
  `terminal.keep` beside the focused pane and `pane.focus`. It first checks that the transcript
  (`~/.claude/projects/…/<session id>.jsonl`) still exists.
- **Ends a branch terminal (Phase 3).** Close branch, offered after a branch's confluence reached its
  trunk, makes the writer run `hc kill <branch terminal>` and `hc rm <branch terminal>`. Conclude's
  "Send to trunk" and "Ask for a conclusion" only write the clipboard and focus a pane: nothing is
  typed. The writer appends one line per landed confluence to `ledgr-data/sessions/<sid>/decisions.md`.
- **Runs inside another mod.** The writer (spool ingest, `store.json`, chips) runs in the `my-tabs`
  tab bar, which is always shown; `mods/my-tabs/ledgr/` holds a copy of the engine files.
- **Reads files outside its folder.** The mod reads and writes only `~/.config/herdr-app/ledgr-data/`.
  Its `bin/` hooks (Claude Code hooks, installed separately in `~/.claude/settings.json`) read
  `~/.claude` (session transcripts and session files) and write `ledgr-data/`.
- **Reaches the network.** The mod itself does not. The `bin/` extractor calls the Anthropic API
  (Claude Haiku) at the end of a turn to list the asks, unless the agent emitted a `ledgr-asks` block.
- Nothing reaches outside Herdr's home and `~/.claude`.

## What you see

- **Panel** (the fourth child of the right-hand `panel-body` stack, 280-900 px wide, the column's
  width; toggled by the "ledgr" tab-bar button or ⌘⇧J). Rounded card, `background` fill, 1 px
  `border`, 12.5 px text.
  - Header, 42 px: "ledgr", a session button (agent label pill such as `claude` or `codex`, then the
    session name, a small dim `pane t3`, chevron) that opens the session list (live sessions, then
    ENDED SESSIONS; name first, `pane t3` after it),
    a pin toggle (`pin`/`pin-off` icons), `turn N` (in `working` colour with "· working" while the
    agent works), and a `demo` pill in demo mode.
  - Names a person reads are words: `Ask 9`, `Question 1`, `pane t3` (never a bare `t3`), "branch of
    Question 1" with its short id (`br-q1-c51e`) small beside it. The short forms stay in every
    machine format: the answer sheet's `A9: …` lines and lead-in, the confluence and answer markers,
    `[A9]` / `[Q1]` refs in a prompt, store keys (`words.js`).
  - **YOUR QUESTIONS** lane (top): parked questions, newest first. Each row: status glyph,
    `Question 3`, kind (`question`, `bookmark`), text, and a dim line `turn 14 · re Ask 5 · “quote…”`;
    a question parked mid-turn reads "parked during turn 17; anchors at end of turn" with a hollow
    glyph. Badges: `/btw`, `sent at turn 18`, `branched`.
  - **ASKED OF YOU** lane (second): folded or open only when you click its head (kept across reloads,
    in the copy's localStorage); while the agent works the head says "agent working" in `working`,
    nothing folds. `ui.foldAsksWhileWorking: true` in `config.json` brings back the old rule (folded
    while working, open at each stop). The head carries the threshold control, a quiet `blocking only ▾`
    / `blocking + needed ▾` / `everything ▾` menu that writes `extract.threshold` to `config.json`
    (the writer and the panel follow the file at once). Grouped by turn, newest group open, older groups one line
    (`turn 12 · 2 asks, 1 open, 1 blocking`). Each row: glyph, `Ask 5`, kind, text, `raised again` (in
    `accent`) for an ask you dismissed that the agent raised again; decide rows show option chips, the
    recommended one marked "(rec.)". Blocking asks sort first in their group, with a `◆` glyph and a
    `blocking` tag (both in `blocked`). Asks below the threshold sit in one folded line at the bottom of
    their group, `below threshold (N)`: open, each row is dim with a hollow glyph, its level tag, and a
    `promote` pill (one click: an open row that counts, tagged `promoted`); they never count in the
    lane's "N open" or on the chip. A spinner and "extracting turn N" sit in the lane head while
    extraction runs. A failed turn shows one dim line "asks not extracted for turn N: <error>" with
    Retry.
  - Clicking a row expands it: the quote in italics (over 300 characters it is cut with "…"), then
    "show whole message", which opens the anchoring message, as markdown, at its full height (no
    box cap: the panel's list scrolls to its last line), the paragraph (or list line) holding the
    quote drawn with a 2 px `accent` bar on an `accent` tint ("hide whole message" closes it); for
    asks an Answer field with Copy answer beside it; the buttons (below); a dim
    line in words: `Ask 13 · found by the extractor · needed · turn 19` (origins: found by the
    extractor, declared by the agent, parked by you; the passage hash is its tooltip).
  - Footer, 30 px: `older than a day (n) ›  deferred (n) ›  closed (n) ›` folds.
  - Status line at the bottom for the last action's result.
- **Capture box** (⌘J): a popup at the top of the window, 600 × 236, no dimming, so the stream stays
  visible. Title "Park a question", then `t3 · <name> · turn N (working)` and the agent pill; the
  question field; the clipboard quote with a checkbox when it checks out, else a "Quote (optional):
  paste the passage by hand" field and a one-line reason; key hints; `session: t3 ↻ 1/3` to switch.
- **Header chip** (in `my-pane`, the cloned pane header), 18 px, 10.5 px text: hidden with nothing
  open; `? 2` dim while the agent works and you parked questions this turn; `1 blocking · 2 asks ·
  1 parked` in `blocked` on a faint `blocked` tint while a blocking ask is open and the agent is not
  working; `2 parked · 3 asks` in `accent` on a faint `accent` tint after a turn ends with something
  new; `? 1 · 2` muted once seen; a small spinner while that turn's asks are being extracted.
  Suggestions are not counted. Turning loud (surfaced or blocking, or loud again for a later turn)
  pulses the chip once: a halo under it fades over about 0.9 s.
- **Motion** (`ui.animations`, default true; false stops all of it, spinners included): only on a
  state change, found by comparing the store's items before and after it changed. A row entering
  its lane (a new ask, a parked question, a promoted below-threshold ask, a reopened item) fades in from 6 px
  above under a highlight that decays over about a second (`blocked` tint for a blocking ask,
  `accent` otherwise; several at once are staggered 45 ms). A row leaving (resolved, dismissed,
  deferred) fades out in place and, when you closed it yourself, collapses from its height. An ask
  that becomes answered glows `done` and folds its open details. A new below-threshold ask lights its fold
  line. Lane folds do not ease: the toolkit eases only numeric heights.

## How it behaves

- Agent status: working lets the chip collect and puts "agent working" on the asks lane head; at
  Stop (blocked, done, idle) the chip surfaces (or turns `blocking`). No lane folds by itself unless
  `ui.foldAsksWhileWorking` is true. The panel never opens itself, no toast, no sound.
- Status is not an ask: a statement of what is done, pending or uncommitted yields nothing; an ask
  exists only when the message asks you to do or decide something, or says the agent waits on you.
  `needed` needs the message to say you must do it for the work to be complete; else optional.
- Borderline asks: a closing line that only offers to go on or invites a look ("ready when you are",
  "have a look") is optional unless the message says the agent cannot proceed; a review is needed
  only when one specific thing must be verified by you; a quote is the one or two sentences that make
  the ask, never the whole message.
- Severity: the extractor gives each ask a level (blocking, needed, optional; a `ledgr-asks` block
  item without one is needed). `extract.threshold` in `ledgr-data/config.json` (optional, needed or
  blocking; default needed; the lane head's menu writes it) decides which levels are open rows and
  count on the chip. The writer and
  the panel read `config.json` again whenever it changes: a new threshold or `ui` value applies at
  once, no restart.
- The panel follows the focused agent's session unless pinned; a chip click shows the panel on that
  chip's session.
- ⌘J opens the capture box over a streaming agent; the box takes the keyboard. Enter parks; Enter on
  an empty question with a quote parks a bookmark; Enter with nothing closes. ⌘Enter parks and puts
  `/btw About "<quote>": <question>` on the clipboard, then focuses the agent's pane. Esc cancels. Tab
  moves between the question and the hand quote field.
- A clipboard quote is attached only if it occurs (whitespace-normalised; `*` and backticks ignored on
  both sides) in the session's saved turn text, or, while the agent works, in `hc read` of its screen.
- Row actions, few on purpose: **Done** (resolve; tooltip "Done: you did or decided it"), **Defer ▾**
  (a menu: tomorrow, in a week, next session), the row's own step (Promote below the threshold,
  Branch… on a question, Copy confluence again while one is staged; Reopen on a closed or deferred
  row), and **⋯**, a menu holding **Not needed** (dismiss; "Not needed: close it; the agent may raise
  it again"), Ask about this (opens the box with `re [A5] `), on a question Copy for prompt
  (`[Q3] <question>`) and Stage /btw, Call off for a staged confluence, and Go to anchor (focuses the
  pane; for an idle Claude it puts a 20-40 character slice of the quote on the clipboard and presses
  `ctrl+o /` to open transcript search; disabled while the agent works). When the session's terminal
  is gone (not in Herdr's terminals or agents, or its pane now holds another session), a Claude
  session's button reads **Resume session…** (`claude --resume` in a new pane, focused; its
  SessionStart hook moves the session to that pane, and the button reads "Resuming…" until then), or
  **Transcript gone** (disabled) when the transcript file no longer exists. "Copy answers" builds
  `ledgr answers <session id>`, `Answers to your asks from turn N:`, then `A5: …` lines, copies,
  focuses the pane; when that prompt is sent, the hook's `answers_landed` marks those asks answered.
  Menus are gpui-base `Popup`s (the shipped linear mod's pattern): a choice, a press outside or Esc
  closes them. A branch row keeps one step visible (Conclude… / Edit conclusion…, or Close branch
  after rejoin) and puts Focus, Copy the confluence again, Ask for a conclusion and the preamble in ⋯.
- A prompt that contains `[A5]` marks that ask answered; `[Q3]` marks the question sent, and answered
  at that turn's end.
- Branch rows (Phase 3): Conclude… opens an editor prefilled with the branch's `ledgr-conclusion`
  block (else its last message, else empty) and shows the message as it will be staged plus the
  trunk's live status; Send to trunk copies `ledgr confluence <branch> <item>` + the question +
  "Conclusion:" + your text + a closing line in your voice ("I am adopting this branch's conclusion
  as the answer to Q1; …"), focuses the trunk, and marks the question
  `rejoin_pending` (↩). When the trunk's hook sees that prompt submitted, the question resolves
  ("resolved by branch …"), the branch shows REJOINED, and a line lands in
  `ledgr-data/sessions/<sid>/decisions.md`. Then Close branch (two clicks) ends its terminal.

## Built from

- Layout `layouts/custom.json`: `panel` column → `panel-body` stack → `{ "id": "ledgr", "type": "block",
  "content": { "mod": "ledgr", "props": { "view": "panel" } } }` after `quota`; the tab block's pane
  header `content.mod` is `my-pane`.
- `mods/ledgr/`: `mod.json` (`place: none`, popup overlay at top, 600 × 236); `main.js` routes on props
  (`view: "panel"` → `panel.js`; an `overlay` or `view: "capture"` → `capture.js`); `store.js` (items,
  sessions, event application, chips, snapshot); `spool.js` (spool reader, identity map reader, event
  writer); `nav.js` (focus, search staging, clipboard text builders); `config.js`; `fixtures.js` (demo).
- `writer.js`: the single writer. `mods/my-tabs/main.js` runs it (role `my-tabs`) from a byte-identical
  copy in `mods/my-tabs/ledgr/` (`config.js`, `store.js`, `spool.js`, `writer.js`); the panel runs it
  only as a fallback (role `panel`) when no `my-tabs` writer answers its `ledgr.ping` within 4 s, and
  steps down when one claims the role.
- `mods/my-pane/`: `mod.clone` of the shipped `pane` with the chip. `mods/my-tabs/`: a "ledgr" button
  (`mods/workspace-chrome/file-text.svg`), `toggle-ledgr`, global like Quota, and the writer.
- `keys.json`: `"cmd-j": "mod.open:ledgr"`, `"cmd-shift-j": "my-tabs.toggle-ledgr"`, and
  `"mod:ledgr": { "cmd-enter": "ledgr.btw", "tab": "ledgr.tab", "shift-tab": "ledgr.backtab" }`.
- herdr: `watchFolder`, `readTextFile`, `writeTextFile`, `fs/promises`, `shared`/`setShared`
  (`ledgr.writer` `{id, by, at}`, `ledgr.ping`, `ledgr.chips` (`a` counts at or above the threshold,
  `b` the blocking ones), `ledgr.focus`, `ledgr.ui` `{animations}`), `focused`, `agents`, `panes`, `terminals`, `layout`,
  `run` (`pane.focus`, `layout.select`, `layout.show`, `mod.open`, `terminal.search`), `openOverlay`,
  `closeOverlay`, `nextCommand`, `hc`, `exec`; `cx.read_from_clipboard`, `cx.write_to_clipboard`.
- Data, `~/.config/herdr-app/ledgr-data/`: `store.json` (the store, written only by the writer; the
  panel reads it and watches it), `spool/` (one JSON event per file: the hooks' events, the box's
  `capture`, the panel's `act` and `retry`), `terminals/<t>.json` (identity map), `turns/<sid>/<n>.md`
  (saved turn text), `snapshot.json` (open and recently dismissed items, for the extractor), `archive/`.
  `config.json` belongs to the hooks (they create it); the mod's keys in it are `extract.threshold`
  and `ui.{foldAsksWhileWorking, animations}`, whose defaults `config.js` and `bin/lib/ledgr_config.py`
  both carry.

## Watch out

- A layout block's copy starts only the first time it is shown, which is why the writer lives in the
  always-shown tab bar and not in the panel.
- Herdr refuses imports that resolve outside a mod's folder, symlinks included. After editing
  `mods/ledgr/{config,store,spool,writer,branch,confluence}.js`, copy them to `mods/my-tabs/ledgr/`
  (the repo's `./install.sh` does it); the panel shows a warning line while the two sets differ.
- Only the holder of `shared("ledgr.writer")` writes; it loads `store.json` before touching the spool
  and unlinks a spool file only after `store.json` holds its effect.
- `<mod>.<command>` reaches shown copies only: `herdr-app do ledgr.demo` needs the panel visible.
- Saving any file under `mods/ledgr/` (including `bin/`) reloads every ledgr copy.
- TextView markdown bold is not visibly heavier at panel sizes; the quote's paragraph is highlighted
  with a bar and tint instead.
- Panel text wraps by itself (long tokens break mid-word). Never cap a text box with `max_h` plus
  `overflow_hidden`: the default line height is about 1.6, so the old 34 px cap cut a 12.5 px ask
  inside its second line and the options below drew against it. A row is a meta line (glyph,
  handle, kind, badges) with its text, options, notes and details hung at `IND` (18 px) below it;
  preview boxes that must stay short scroll (`overflow_y_scrollbar`) instead of hiding the rest.
  For shots of the lower lane: `ledgr.fold-mine`, `ledgr.fold-asks`, `ledgr.collapse-all` (the lane
  folds are saved: fold them back afterwards); for the answer path `ledgr.pick:<handle>:<n>`,
  `ledgr.copy-answer:<handle>`, `ledgr.session:<terminal>`; for severity and motion
  `ledgr.below-threshold`, `ledgr.act:<handle>:<resolve|dismiss|reopen|promote>`,
  `ledgr.whole:<handle>`, `ledgr.menu:<handle>:<defer|more>` / `menu:threshold` / `menu:off`,
  `ledgr.threshold:<level>`, in the demo
  `ledgr.demo-ask:<level>` and `ledgr.demo-answer:<handle>`, and `my-pane.demo-chip:<state|off>`
  (a chip state, and its pulse, on every shown header); `app.zoom_out` shows more of the list with
  the same wrapping (zoom back in afterwards).
- Motion is native (`transition`), never a timer. A transition animates changes made after it is
  attached, so an animated element carries it from its first frame and the target changes one frame
  later (16 ms; that frame is the only extra render). Only numeric heights ease (auto height jumps),
  which is why lane folds do not animate and a leaving row collapses only when the pointer measured
  it (`on_mouse_move` bounds); otherwise it fades in place and the list closes up. A config change or
  a store read while the panel was hidden records the new state without motion. An idle panel does
  not render: `herdr-app do ledgr.render-stats` writes the render count to
  `ledgr-data/log/panel-renders-<copy>.json` (one file per panel copy).
- No reduced-motion setting reaches a mod (the toolkit exposes none, and ledgr does not read macOS
  preferences): `ui.animations: false` is the switch.
- A branch shares the trunk's checkout unless isolated: the preamble forbids edits, nothing enforces
  it. The fork is taken at the end of the session, so it also sees every turn after the anchor; the
  manifest says how many. See `BUILD-NOTES-phase2.md`.
- The confluence resolves only when the trunk's Claude UserPromptSubmit hook sees the marker line as
  the first line of a pasted block (Claude Code wraps pastes in `<pasted_content>` lines), or of the
  prompt after at most a one-line lead-in. Type a lead-in such as "Adopt this branch result for Q1:"
  before ⌘V (the panel suggests it): Claude Code presents a bare paste as text the person may not have
  written. A marker inside a code fence, or after text on its line, does not count; the question then
  stays `rejoin_pending` (Copy confluence again, or Resolve by hand). See `BUILD-NOTES-phase3.md`.

## Done when

- `herdr-app check` passes for `mods/ledgr`, `mods/my-pane`, `mods/my-tabs`, also with
  `FORCE_DEMO = true` in `config.js`.
- `herdr-app do ledgr.demo` (panel shown) draws both lanes with every status, an expanded row with
  the highlighted passage, a draft answer and "Copy answers"; the long cases (A10-A12, Q8) wrap in
  full with nothing clipped at 280 and 360 px.
- `shared("ledgr.writer").by` is `my-tabs` a few seconds after Herdr starts, with the panel never shown.
- `herdr-app do mod.open --name ledgr` opens the box over a working agent; `herdr-app do ledgr.submit`
  (or Enter) writes `ledgr-data/spool/<ms>-capture-mod-<rand>.json`, which the writer applies and
  unlinks within a second; the row appears in YOUR QUESTIONS and the chip shows `? 1 · 0`.
- A JSON file moved into `ledgr-data/spool/` from a shell is applied and unlinked in under a second.
- The demo shows A6 first in turn 17 with `◆` and `blocking`, `below threshold (2)` (A13, A14) folded at
  the bottom of the group, and the lane open while the demo session works ("agent working").
- `ledgr.demo-ask:blocking` fades a new row in under a `blocked` highlight that is gone within about a
  second; `ledgr.act:<handle>:resolve` fades it out; `my-pane.demo-chip:seen`, then `:surfaced`,
  pulses the chip once. `ledgr.render-stats` twice, 30 s apart with nothing happening, differs by one
  (the command's own render).
- Editing `extract.threshold` in `ledgr-data/config.json`, or choosing on the lane head's menu,
  changes the chip's count and the lanes within a couple of seconds, with no restart.
- In the demo, `ledgr.session:t7`, `ledgr.whole:A1` opens a 1,511-word message at full height; the
  list scrolls to its last line ("LAST LINE OF THE 1,500-WORD MESSAGE").
