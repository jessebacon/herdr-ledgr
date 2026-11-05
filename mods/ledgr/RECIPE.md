# ledgr

A side panel that keeps a two-direction list of asks around one agent conversation. Questions you
park while reading (⌘J, even while the agent is still streaming) sit in the top lane; the asks the
agent made of you at the end of each turn (decide, confirm, do, provide, review) sit in the lane below,
one row each, answerable in place. A small chip in each pane header counts what is open. Nothing is
ever typed into an agent: answers and `/btw` questions go to the clipboard and the pane is focused.
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
  - Header, 42 px: "ledgr", a session button (agent label pill such as `claude` or `codex`, then
    `t3 · <session name>`, chevron) that opens the session list (live sessions, then ENDED SESSIONS),
    a pin toggle (`pin`/`pin-off` icons), `turn N` (in `working` colour with "· working" while the
    agent works), and a `demo` pill in demo mode.
  - **YOUR QUESTIONS** lane (top): parked questions, newest first. Each row: status glyph, `Q<n>`,
    kind (`question`, `bookmark`), text (two lines), and a dim line `t14 · re A5 · “quote…”`; a
    question parked mid-turn reads "parked during turn 17; anchors at end of turn" with a hollow
    glyph. Badges: `/btw`, `sent t18`.
  - **ASKED OF YOU** lane (second): folded while the agent works, opened at the end of each turn (a
    click holds your choice until the next stop). Grouped by turn, newest group open, older groups one
    line (`turn 12 · 2 asks, 1 open`). Each row: glyph, `A<n>`, kind, text, `blocking` (in
    `blocked`), `raised again` (in `accent`) for an ask you dismissed that the agent raised again;
    decide rows show option chips, the recommended one marked "(rec.)". A spinner and
    "extracting turn N" sit in the lane head while extraction runs. A failed turn shows one dim line
    "asks not extracted for turn N: <error>" with Retry.
  - Clicking a row expands it: the quote in italics, then the anchoring message rendered as markdown
    with the paragraph (or list line) holding the quote drawn with a 2 px `accent` bar on an `accent`
    tint; "show whole message"; for asks an Answer field; action buttons.
  - Footer, 30 px: `older than a day (n) ›  deferred (n) ›  closed (n) ›` folds.
  - Status line at the bottom for the last action's result.
- **Capture box** (⌘J): a popup at the top of the window, 600 × 236, no dimming, so the stream stays
  visible. Title "Park a question", then `t3 · <name> · turn N (working)` and the agent pill; the
  question field; the clipboard quote with a checkbox when it checks out, else a "Quote (optional):
  paste the passage by hand" field and a one-line reason; key hints; `session: t3 ↻ 1/3` to switch.
- **Header chip** (in `my-pane`, the cloned pane header), 18 px, 10.5 px text: hidden with nothing
  open; `? 2` dim while the agent works and you parked questions this turn; `2 parked · 3 asks` in
  `accent` on a faint `accent` tint after a turn ends with something new; `? 1 · 2` muted once seen;
  a small spinner while that turn's asks are being extracted.

## How it behaves

- Agent status: working folds the asks lane and lets the chip collect; at Stop (blocked, done, idle)
  the chip surfaces and the asks lane opens. The panel never opens itself, no toast, no sound.
- The panel follows the focused agent's session unless pinned; a chip click shows the panel on that
  chip's session.
- ⌘J opens the capture box over a streaming agent; the box takes the keyboard. Enter parks; Enter on
  an empty question with a quote parks a bookmark; Enter with nothing closes. ⌘Enter parks and puts
  `/btw About "<quote>": <question>` on the clipboard, then focuses the agent's pane. Esc cancels. Tab
  moves between the question and the hand quote field.
- A clipboard quote is attached only if it occurs (whitespace-normalised; `*` and backticks ignored on
  both sides) in the session's saved turn text, or, while the agent works, in `hc read` of its screen.
- Row actions: Resolve, Defer: tomorrow, Defer: next session, Dismiss, Reopen, Ask about this (opens
  the box with `re [A5] `), Copy for prompt (`[Q3] <question>`), Stage /btw, Go to anchor (focuses the
  pane; for an idle Claude it puts a 20-40 character slice of the quote on the clipboard and presses
  `ctrl+o /` to open transcript search; disabled while the agent works). "Copy answers" builds
  `ledgr answers <session id>`, `Answers to your asks from turn N:`, then `A5: …` lines, copies,
  focuses the pane; when that prompt is sent, the hook's `answers_landed` marks those asks answered.
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
  (`ledgr.writer` `{id, by, at}`, `ledgr.ping`, `ledgr.chips`, `ledgr.focus`), `focused`, `agents`, `panes`, `terminals`, `layout`,
  `run` (`pane.focus`, `layout.select`, `layout.show`, `mod.open`, `terminal.search`), `openOverlay`,
  `closeOverlay`, `nextCommand`, `hc`, `exec`; `cx.read_from_clipboard`, `cx.write_to_clipboard`.
- Data, `~/.config/herdr-app/ledgr-data/`: `store.json` (the store, written only by the writer; the
  panel reads it and watches it), `spool/` (one JSON event per file: the hooks' events, the box's
  `capture`, the panel's `act` and `retry`), `terminals/<t>.json` (identity map), `turns/<sid>/<n>.md`
  (saved turn text), `snapshot.json` (open and recently dismissed items, for the extractor), `archive/`.
  `config.json` belongs to the hooks.

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
  the highlighted passage, a draft answer and "Copy answers".
- `shared("ledgr.writer").by` is `my-tabs` a few seconds after Herdr starts, with the panel never shown.
- `herdr-app do mod.open --name ledgr` opens the box over a working agent; `herdr-app do ledgr.submit`
  (or Enter) writes `ledgr-data/spool/<ms>-capture-mod-<rand>.json`, which the writer applies and
  unlinks within a second; the row appears in YOUR QUESTIONS and the chip shows `? 1 · 0`.
- A JSON file moved into `ledgr-data/spool/` from a shell is applied and unlinked in under a second.
