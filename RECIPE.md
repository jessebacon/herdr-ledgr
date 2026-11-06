# ledgr

A side panel that keeps a two-direction list of asks around one agent conversation. Questions you
park while reading (⌘J, even while the agent is still streaming) sit in the top lane; the asks the
agent made of you at the end of each turn (decide, confirm, do, provide, review) sit in the lane below,
one row each, answerable in place. Every ask has a level: blocking (the agent stopped or cannot finish
without you), needed (the task is not truly done until you act), optional (an offer or suggestion).
Asks below the threshold are kept in a folded "below threshold" line. A small always-visible ledgr
button counts what is open and opens the panel; an optional chip in each pane header counts that
pane's session. A parked question can be branched into its own forked Claude Code session, and its one
approved answer carried back to the end of the trunk. Nothing is ever typed into an agent's prompt:
answers, `/btw` questions and branch results go to the clipboard and the pane is focused.

![ledgr](preview.png)

## Before you add it (disclosure)

Tell the person all of this before copying anything (the manual's step 1).

- **Registers Claude Code hooks.** Three entries in `~/.claude/settings.json` (SessionStart,
  UserPromptSubmit, Stop), each `bash "$HOME/.config/herdr-app/mods/ledgr/bin/adapters/claude/<event>.sh"`
  with a 5 s timeout. They exit 0 at once, print nothing into the model's context, and do nothing
  outside a Herdr terminal (`HC_TERMINAL_ID` unset) or inside a process ledgr started (`LEDGR_INNER`).
- **Reads `~/.claude`.** The hooks read the session's transcript (`~/.claude/projects/…/<id>.jsonl`)
  for the turn's last message and its uuid; the installer reads and writes `~/.claude/settings.json`
  for the hook entries (backup first). Nothing else under `~/.claude`.
- **Calls one network endpoint.** At the end of each turn the hooks' extractor sends that turn's last
  assistant message (at most 60,000 characters) and the session's open asks to the configured
  provider: the Anthropic Messages API (`claude-haiku-5-5`, the default), an OpenAI-compatible server
  you name, or `claude -p` on your Claude Code subscription. A valid fenced `ledgr-asks` block in the
  message skips the call; provider `none` never calls. The API key is read from the macOS Keychain
  (service `ledgr`, account = provider name) at each call and never written to disk: `/usr/bin/curl`
  gets it in a config on stdin, and the message in a 0600 file under `ledgr-data/tmp/`, deleted after.
- **Runs programs.** The mod, through `exec` and `hc`: `hc read <terminal>` (checks a clipboard quote
  against a working agent's screen), `hc keys <terminal> ctrl+o /` (Go to anchor on an idle Claude
  pane: opens Claude's transcript search), `hc run … -- claude --resume <sid> --fork-session …`
  (Launch on a Branch: a new Claude Code session on your plan), `hc run … -- claude --resume <sid>`
  (Resume session), `hc kill` and `hc rm` (Close branch, after its answer landed),
  `git -C <cwd> rev-parse` (whether "isolate in a worktree" applies), `/usr/bin/which claude` once,
  and `bash mods/ledgr/bin/adapters/claude/extract.sh --retry …` (the Retry button). The hooks run
  `python3`, `/usr/bin/security find-generic-password` (the key) and `/usr/bin/curl` (the call).
- **Reads the clipboard.** The capture box reads it when it opens, to offer the copied passage as the
  question's quote (attached only if it matches the agent's saved turn text or screen). The panel
  writes the clipboard for Copy answer, Copy answers, `/btw`, Send to trunk and Go to anchor.
- **Writes under the Herdr home only.** `ledgr-data/` (store, spool, saved turn texts, per-session
  `decisions.md`, logs, `config.json`) and the mod's own files.
- **Never:** types into a terminal's prompt or presses Enter (no `hc send`; the only keystrokes are Go
  to anchor's `ctrl+o /`); reaches the network beyond the one extraction provider; contacts any other
  application; reads files outside the Herdr home and `~/.claude`.

## What you see

- **Host button** (`ledgr` with props `{view: "host"}`), a 96 px block beside the status bar (or the
  tab bar, or floating at the bottom-right of the terminals), drawn on `chrome` with a 1 px `border`
  line on the bar's side. A 22 px pill: the ledgr icon (13 px), "ledgr" (12 px) and, when anything is
  open, a count badge (10.5 px): open asks plus parked questions across sessions, in `blocked` with
  `◆` when a blocking ask is open (`1 ◆ 4`), in `accent` after a turn ends with something new, else
  `muted`. `selected` background while the panel is shown. Its tooltip gives the counts and "click to
  show or hide the panel".
- **Panel** (props `{view: "panel"}`; by default a child of the right-hand `panel-body` stack, the
  column's width, 280-900 px). Rounded card, `background` fill, 1 px `border`, 12.5 px text.
  - Header, 42 px: "ledgr", a session button (agent label pill such as `claude` or `codex`, then the
    session name, a small dim `pane t21`, chevron) that opens the session list (live sessions, then
    ENDED SESSIONS), a pin toggle (`pin`/`pin-off` icons), `turn N` (in `working` colour with
    "· working" while the agent works), and a `demo` pill in demo mode.
  - Names a person reads are words: `Ask 9`, `Question 1`, `pane t21` (never a bare `t21`), "branch of
    Question 1" with its short id (`br-q1-c51e`) small beside it. The short forms stay in every machine
    format: the answer sheet's `A9: …` lines, the confluence and answer markers, `[A9]` / `[Q1]` refs in
    a prompt, store keys.
  - **YOUR QUESTIONS** lane (top): parked questions, newest first. Each row: status glyph,
    `Question 3`, kind (`question`, `bookmark`), text, and a dim line `turn 14 · re Ask 5 · “quote…”`; a
    question parked mid-turn reads "parked during turn 17; anchors at end of turn" with a hollow glyph.
    Badges: `/btw`, `sent at turn 18`, `branched`.
  - **ASKED OF YOU** lane (second): folded or open only when you click its head (kept across reloads);
    while the agent works the head says "agent working" in `working`. The head carries the threshold
    control, a quiet `blocking only ▾` / `blocking + needed ▾` / `everything ▾` menu that writes
    `extract.threshold` to `config.json`. Grouped by turn, newest group open, older groups one line
    (`turn 12 · 2 asks, 1 open, 1 blocking`). Each row: glyph, `Ask 5`, kind, text, `raised again` (in
    `accent`) for an ask you dismissed that the agent raised again; decide rows show option chips, the
    recommended one marked "(rec.)". Blocking asks sort first in their group with a `◆` glyph and a
    `blocking` tag (both `blocked`). Asks below the threshold sit in one folded line at the bottom of
    their group, `below threshold (N)`: open, each row is dim with a hollow glyph, its level tag and a
    `promote` pill; they never count. A spinner and "extracting turn N" sit in the lane head while
    extraction runs; a failed turn shows "asks not extracted for turn N: <error>" with Retry.
  - Clicking a row expands it: the quote in italics (over 300 characters cut with "…"), then "show
    whole message", which opens the anchoring message as markdown at full height, the paragraph holding
    the quote marked with a 2 px `accent` bar on an `accent` tint; for asks an Answer field with Copy
    answer beside it; the buttons; a dim line in words: `Ask 13 · found by the extractor · needed ·
    turn 19`.
  - Footer, 30 px: `older than a day (n) ›  deferred (n) ›  closed (n) ›` folds; a status line below for
    the last action's result.
- **Capture box** (⌘J): a popup at the top of the window, 600 × 236, no dimming, so the stream stays
  visible. Title "Park a question", then `t21 · <name> · turn N (working)` and the agent pill; the
  question field; the clipboard quote with a checkbox when it checks out, else a "Quote (optional)"
  field and a one-line reason; key hints; `session: t21 ↻ 1/3` to switch.
- **Header chip** (optional mod `ledgr-pane`: Herdr's `pane` header plus the chip), 18 px, 10.5 px
  text: hidden with nothing open; `? 2` dim while the agent works and you parked questions this turn;
  `1 blocking · 2 asks · 1 parked` in `blocked` on a faint `blocked` tint while a blocking ask is open
  and the agent is not working; `2 parked · 3 asks` in `accent` on a faint `accent` tint after a turn
  ends with something new; `? 1 · 2` muted once seen; a small spinner while that turn's asks are being
  extracted. Turning loud pulses the chip once: a halo that fades over about 0.9 s.
- **Motion** (`ui.animations`, default true; false stops all of it): only on a state change. A row
  entering its lane fades in from 6 px above under a highlight that decays over about a second
  (`blocked` tint for a blocking ask, `accent` otherwise; several at once staggered 45 ms). A row
  leaving fades out in place and, when you closed it yourself, collapses. An ask that becomes answered
  glows `done`. Lane folds do not ease.

## How it behaves

- Agent status: working lets the counts collect and puts "agent working" on the asks lane head; at
  Stop (blocked, done, idle) the host badge and the chip surface (or turn `blocking`). The panel never
  opens itself; no toast, no sound.
- Status is not an ask: a statement of what is done, pending or uncommitted yields nothing; an ask
  exists only when the message asks you to do or decide something, or says the agent waits on you. A
  closing line that only offers to go on is optional unless the message says the agent cannot proceed.
  A quote is the one or two sentences that make the ask.
- Severity: `extract.threshold` in `ledgr-data/config.json` (optional, needed or blocking; default
  needed) decides which levels are open rows and count. The writer and the panel read `config.json`
  again whenever it changes: no restart.
- The host button and ⌘⇧J (`ledgr.toggle`) show or hide the panel. The panel follows the focused
  agent's session unless pinned; a chip click shows the panel on that chip's session.
- ⌘J opens the capture box over a streaming agent; the box takes the keyboard. Enter parks; Enter on an
  empty question with a quote parks a bookmark; Enter with nothing closes. ⌘Enter parks and puts
  `/btw About "<quote>": <question>` on the clipboard, then focuses the agent's pane. Esc cancels. Tab
  moves between the question and the hand quote field.
- Row actions: **Done**, **Defer ▾** (tomorrow, in a week, next session), the row's own step (Promote,
  Branch… on a question, Copy confluence again, Reopen), and **⋯** holding **Not needed**, Ask about
  this, Copy for prompt (`[Q3] <question>`), Stage /btw, Call off, and Go to anchor (focuses the pane;
  for an idle Claude it puts a 20-40 character slice of the quote on the clipboard and presses
  `ctrl+o /`). A session whose terminal is gone offers **Resume session…** (`claude --resume` in a new
  pane) or **Transcript gone**. "Copy answers" builds `ledgr answers <session id>`, `Answers to your
  asks from turn N:`, then `A5: …` lines; when that prompt is sent, the hook marks those asks answered.
- A prompt that contains `[A5]` marks that ask answered; `[Q3]` marks the question sent.
- Branch… on a parked question: a confirmation shows the context manifest (what the fork knows and does
  not know) and its placement; Launch starts the fork beside the trunk. Conclude… opens an editor
  prefilled with the branch's `ledgr-conclusion` block; Send to trunk copies `ledgr confluence
  <branch> <item>` + the question + "Conclusion:" + your text + a closing line in your voice, focuses
  the trunk and marks the question `rejoin_pending` (↩). When the trunk's hook sees that prompt
  submitted, the question resolves, the branch shows REJOINED, and a line lands in
  `ledgr-data/sessions/<sid>/decisions.md`. Close branch (two clicks) then ends its terminal.

## Built from

- **Layout** (a personal one; a shipped layout is cloned first): the panel block
  `{ "id": "ledgr", "type": "block", "content": { "mod": "ledgr", "props": { "view": "panel" } } }`
  appended to the `panel-body` stack (its parent column `panel` shows and hides), or, with no such
  stack, a hidden `ledgr-panel` column (380 px, 280-900) after the tab block, named in `config.json`
  `ui.panel`. The host block `{ "id": "ledgr-host", "type": "block", "size": { "px": 96 },
  "content": { "mod": "ledgr", "props": { "view": "host", "bar": "status" } } }` beside the `status`
  block in a `ledgr-host-row` row that takes the status block's size (or the same beside `tabs`, or a
  `floating` entry of the tab block, edge `bottom`, align `end`). Optional: the tab block's pane header
  `content.mod` set to `ledgr-pane`. Exact pieces: `setup/layout-blocks.json`.
- **`mods/ledgr/`**: `mod.json` (`place: none`, popup overlay at top, offset 40, 600 × 236, `version`);
  `main.js` routes on props (`view: "host"` → `host.js`; `view: "panel"` → `panel.js`; an `overlay` or
  `view: "capture"` → `capture.js`); `writer.js` (the single writer); `store.js`, `spool.js`, `nav.js`,
  `config.js` (defaults, paths, where the panel lives, `liveHome`), `branch.js`, `confluence.js`,
  `words.js`, `fixtures.js` (demo), `ledgr.svg`; `bin/` (Python 3.9+, standard library only): the
  Claude Code adapter, the extractor and its providers, the offline tests.
- **Writer election**: only the holder of `shared("ledgr.writer")` `{id, by, at}` writes
  `ledgr-data/store.json`. The host block runs a writer (role `host`); a mod that imports an engine
  copy from its own `ledgr/` folder runs one under its own name; the panel runs one only as a fallback
  (role `panel`) when no host answers its `ledgr.ping` within 4 s. A host that starts later takes over;
  a host that lost the role takes it back when the claim is empty or a panel's, or when the holder does
  not answer a ping (checked at most every 2 minutes); a closing copy releases the role.
- **`mods/ledgr-pane/`** (optional): `mod.clone` of the shipped `pane` (0.1.13) plus the chip; it only
  reads `shared("ledgr.chips")` and `shared("ledgr.ui")`, and runs no writer.
- **`keys.json`**: `"cmd-j": "mod.open:ledgr"`, `"cmd-shift-j": "ledgr.toggle"`, and
  `"mod:ledgr": { "cmd-enter": "ledgr.btw", "tab": "ledgr.tab", "shift-tab": "ledgr.backtab" }`.
- **Shipped mods used**: `workspace-chrome` icons (`spinner.svg`, `pin.svg`, `pin-off.svg`, chevrons),
  the `worktree` dialog (Branch's "isolate in a worktree"), and `pane` (what `ledgr-pane` clones).
- **herdr**: `watchFolder`, `readTextFile`, `writeTextFile`, `fs/promises`, `shared`/`setShared`
  (`ledgr.writer`, `ledgr.ping`, `ledgr.chips` (`a` counts at or above the threshold, `b` the blocking
  ones), `ledgr.focus`, `ledgr.ui` `{animations, panel}`), `focused`, `agents`, `panes`, `terminals`,
  `layout`, `placement`, `run` (`pane.focus`, `layout.select`, `layout.show`, `layout.hide`,
  `mod.open`, `terminal.keep`, `terminal.search`, `terminal.peek`), `openOverlay`, `closeOverlay`,
  `nextCommand`, `hc`, `exec`; `cx.read_from_clipboard`, `cx.write_to_clipboard`.
- **Data**, `<Herdr home>/ledgr-data/`: `store.json` (written only by the writer), `spool/` (one JSON
  event per file), `terminals/<t>.json` (identity map), `sessions/<sid>.json` and
  `sessions/<sid>/decisions.md`, `turns/<sid>/<n>.md`, `snapshot.json`, `archive/`, `log/`, `tmp/`,
  `config.json` (`extract.provider`, `model`, `base_url`, `mode`, `threshold`; `instruct_block`;
  `ui.animations`, `ui.foldAsksWhileWorking`, `ui.panel`).
- **Install.** Both paths end in the same files:
  - `./install.sh` asks each question with its reason (defaults in brackets are what is installed
    now); `./install.sh --yes --answers ledgr.install.json` asks nothing (schema:
    `setup/answers.example.json`; an API key comes from `LEDGR_API_KEY`, never from the file). It
    preflights (Herdr home and version, layouts shipped or personal, Claude Code, python3, `security`,
    an existing ledgr, key conflicts), copies the mods, writes `config.json`, stores the key in the
    Keychain, merges `keys.json`, patches the chosen personal layout (cloning a shipped one first),
    adds the hook entries after printing them, runs `herdr-app check` and the offline tests.
    `./install.sh --check` is the doctor; `./uninstall.sh` reverses it.
  - By hand, as the manual describes: copy `mods/ledgr/` (and `mods/ledgr-pane/` if wanted) to `mods/`;
    merge `keys.json`, asking before replacing a key in use; add the blocks from
    `setup/layout-blocks.json` to a personal layout; add the three hook entries above to
    `~/.claude/settings.json`; `chmod +x mods/ledgr/bin/adapters/claude/*.sh`; store the key with
    `security add-generic-password -s ledgr -a anthropic -w`; `herdr-app check mods/ledgr` (and
    `mods/ledgr-pane`).
- **Example integration** (`examples/personal-overlay/`, not part of the mod): a personal tab bar
  (`my-tabs`) that hosts the writer from an engine copy, and a personal pane header (`my-pane`) with
  the chip. `./install.sh --overlay examples/personal-overlay` deploys them and writes the engine copy;
  its `answers.json` is that setup's full answer set.

## Watch out

- A layout block's copy starts only the first time it is shown, which is why the writer lives in the
  always-shown host block and not in the panel. Without a host, nothing is ingested until the panel has
  been shown once; the panel's fallback writer then catches up from the spool.
- Herdr refuses imports that resolve outside a mod's folder, symlinks included. A host in another mod
  needs byte-identical copies of `writer.js` `ENGINE_FILES` in its own `ledgr/` folder; `install.sh`
  writes them, and the panel warns when one differs.
- On Herdr 0.1.13, `herdr-app check` shares the running window's shared state: a copy that claimed the
  writer role during a check left a claim nobody held. ledgr claims and pings only when it can read the
  home's `AGENTS.md`, which check refuses.
- `<mod>.<command>` reaches shown copies only: `ledgr.toggle` needs the host block; `herdr-app do
  ledgr.demo` needs the panel visible.
- Herdr's shipped tab bar remembers the side panel per space and does not know ledgr: switching space
  can hide the ledgr panel. The host button and ⌘⇧J bring it back.
- Saving any file under `mods/ledgr/` (including `bin/`) reloads every ledgr copy; the hooks keep their
  bytecode under `ledgr-data/.pycache` for that reason.
- Panel text wraps by itself. Never cap a text box with `max_h` plus `overflow_hidden`: the default line
  height is about 1.6, so a 34 px cap cut a 12.5 px ask inside its second line. Preview boxes that must
  stay short scroll instead. For shots: `ledgr.fold-mine`, `ledgr.fold-asks`, `ledgr.collapse-all`,
  `ledgr.pick:<handle>:<n>`, `ledgr.copy-answer:<handle>`, `ledgr.session:<terminal>`,
  `ledgr.below-threshold`, `ledgr.act:<handle>:<resolve|dismiss|reopen|promote>`,
  `ledgr.whole:<handle>`, `ledgr.menu:<handle>:<defer|more>` / `menu:threshold` / `menu:off`,
  `ledgr.threshold:<level>`, in the demo `ledgr.demo-ask:<level>` and `ledgr.demo-answer:<handle>`,
  and `ledgr-pane.demo-chip:<state|off>`.
- Motion is native (`transition`), never a timer; an idle panel does not render. No reduced-motion
  setting reaches a mod: `ui.animations: false` is the switch.
- A branch shares the trunk's checkout unless isolated: the preamble forbids edits, nothing enforces it.
  The fork is taken at the end of the session, so it also sees every turn after the anchor; the
  manifest says how many.
- The confluence resolves only when the trunk's UserPromptSubmit hook sees the marker line as the first
  line of a pasted block, or of the prompt after at most a one-line lead-in. Type a lead-in such as
  "Adopt this branch result for Q1:" before ⌘V (the panel suggests it).
- Assumes macOS (Keychain, `security`), Claude Code for the hooks (no asks lane for other agents yet),
  and python3 3.9 or newer at `/opt/homebrew/bin`, `/usr/local/bin` or `/usr/bin` (or `LEDGR_PYTHON`).
  Provider `cli` (`claude -p`) is untested end to end.

## Done when

- `herdr-app check` passes for `mods/ledgr` and `mods/ledgr-pane`, also with `FORCE_DEMO = true` in
  `config.js`; `bin/tests/run-all.sh` reports every suite OK.
- A few seconds after Herdr starts, with the panel never shown, `shared("ledgr.writer").by` is `host`
  (or the overlay mod's name).
- The host button shows "ledgr"; a click and ⌘⇧J each show and hide the panel.
- `herdr-app do mod.open --name ledgr` opens the box over a working agent; Enter writes
  `ledgr-data/spool/<ms>-capture-mod-<rand>.json`, which the writer applies and unlinks within a
  second; the row appears in YOUR QUESTIONS and the chip shows `? 1 · 0`.
- A JSON file moved into `ledgr-data/spool/` from a shell is applied and unlinked in under a second.
- `herdr-app do ledgr.demo` (panel shown) draws both lanes with every status; turn 17 shows Ask 6 ("Run
  the load test after tonight's deploy") first with `◆` and `blocking`, and `below threshold (2)` (A13,
  A14) folded at the bottom; the long cases (A10-A12, Q8) wrap in full at 280 and 360 px.
- In the demo, `ledgr.session:t27`, then `ledgr.whole:A1`, opens the 1,511-word message at full
  height; the list scrolls to its last line ("LAST LINE OF THE 1,500-WORD MESSAGE").
- Editing `extract.threshold` in `ledgr-data/config.json`, or choosing on the lane head's menu, changes
  the counts and the lanes within a couple of seconds, with no restart.
- `./install.sh --check` reports the three hooks registered, a writer holding the role and the Keychain
  item resolving.
