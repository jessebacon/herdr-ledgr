# ledgr

A side panel that keeps a two-direction list of asks around one agent conversation. Questions you
park while reading (⌘J, even while the agent is still streaming) sit in the top lane; the asks the
agent made of you at the end of each turn (decide, confirm, do, provide, review) sit in the lane below,
one row each, answerable in place. Every ask has a level: blocking (the agent stopped or cannot finish
without you), needed (the task is not truly done until you act), optional (an offer or suggestion).
Asks below the threshold are kept in a folded "below threshold" line. A small always-visible ledgr
button counts what is open and opens the panel; an optional chip in each pane header counts that
pane's session. A parked question can be branched into its own forked Claude Code session, and its one
approved answer carried back to the end of the trunk. ledgr presses no keys in a terminal, and never
Enter: answers and branch results are pasted into the agent's prompt once its pane has the focus, for
the person to send; `/btw` questions and search slices go to the clipboard and the pane is focused.

![ledgr](preview.png)

## Before you add it (disclosure)

Tell the person all of this before copying anything (the manual's step 1).

- **Registers Claude Code hooks.** Three entries (SessionStart, UserPromptSubmit, Stop) in each of
  the Claude settings files you chose: `~/.claude/settings.json`, plus any other Claude config folder
  (a Claude Code started with `CLAUDE_CONFIG_DIR`, such as a second account; the installer lists the
  `~/.claude-*` folders and the `CLAUDE_CONFIG_DIR=` values in `~/.local/bin` wrappers and shell
  start-up files it finds, and asks for each), each `bash "$HOME/.config/herdr-app/mods/ledgr/bin/adapters/claude/<event>.sh"`
  with a 5 s timeout. They exit 0 at once and do nothing outside a Herdr terminal (`HC_TERMINAL_ID`
  unset) or inside a process ledgr started (`LEDGR_INNER`).
- **Prints an instruction into the session's context.** Unless `asks.handoff` is `prose` (or
  `instruct_block` is false), the SessionStart hook prints the ledgr-asks instruction for the chosen
  mode (`mods/ledgr/bin/lib/asks-instruction-ledgr.txt`, about 260 words: keep blocking and needed
  items out of the reply, declare them with ledgr's `declare_asks` tool when it is there, else one
  per line in a fenced `ledgr-asks` block, and end the prose with one line "ledgr: N items for you,
  M blocking"; or `asks-instruction-both.txt`, about 200 words: list them as usual and declare them
  too) once per session and again after `/clear` or
  `/compact`; Claude Code adds it to the context. When the extractor finds a blocking ask in a reply
  that had no block, the session's next prompt carries it once more (`instruct_reinject`); when you
  change `asks.handoff`, each running session's next prompt carries the new wording once (to `prose`:
  two lines telling it to stop, `asks-instruction-off.txt`). In a space where ledgr is off
  (`spaces.disabled`) nothing is printed, except three lines (`asks-instruction-space-off.txt`:
  ignore every earlier ledgr instruction, declare nothing, list needs in the reply as usual) once to
  a session that had a wording, at its first prompt after the space was turned off or at a resume or
  compact while off; when the space is on again, its next prompt carries the mode's wording once.
  Nothing else is ever printed.
- **Registers an MCP server with Claude Code (asked; default yes when you answer the questions, never
  with `--yes` unless the answers or `--mcp on` say so).** For each chosen Claude config folder the
  installer shows and then runs Claude Code's own command,
  `claude mcp add --scope user --transport stdio ledgr -- <python3> -I -B ~/.config/herdr-app/mods/ledgr/bin/mcp/ledgr_mcp.py`
  (with `CLAUDE_CONFIG_DIR` set for a folder other than `~/.claude`; Claude Code writes it into that
  folder's `.claude.json`, `~/.claude.json` for the default; backup first), and adds four allow
  entries, `mcp__ledgr__declare_asks`, `mcp__ledgr__open_asks`, `mcp__ledgr__parked_questions` and
  `mcp__ledgr__resolve_asks`, to that folder's settings file so a call never prompts. The server starts
  with each Claude Code session of that folder and offers tools only inside a Herdr terminal
  (`HC_TERMINAL_ID`; outside it, none). It can: record the items the agent declares for this turn
  (`declare_asks`: an `asks` spool event, its per-turn state in `ledgr-data/mcp/`, and the pointer line
  it returns), close this session's asks your message answered or dropped (`resolve_asks`: one `act`
  spool event per ask, marked as closed by the agent; you can reopen it), list this session's open
  asks (`open_asks`) and the questions you released to the agent (`parked_questions`). It reads and writes
  only `ledgr-data/` (log `log/mcp.log`), makes no network call and runs nothing else. `--check`
  reports the registration and the entries per folder and prints the command when one is missing;
  `./uninstall.sh` runs `claude mcp remove --scope user ledgr` per folder and removes the entries.
- **Reads the Claude config folder.** The hooks read the session's transcript (the path Claude Code
  passes them, `<config>/projects/…/<id>.jsonl`) for the turn's last message and its uuid, and
  `<config>/sessions/<pid>.json` for a session name; the installer reads and writes the Claude
  settings files you chose for the hook and allow entries (backup first), and `claude mcp add` writes
  `.claude.json` (above). Nothing else there.
- **Calls one network endpoint.** At the end of each turn the hooks' extractor sends that turn's last
  assistant message (at most 60,000 characters) and the session's open asks to the configured
  provider: the Anthropic Messages API (`claude-haiku-5-5`, the default), an OpenAI-compatible server
  you name, or `claude -p` on your Claude Code subscription. A declaration skips the call (a
  `declare_asks` call that turn, or a valid fenced `ledgr-asks` block in the message, unless
  `extract.audit_rate`, default 0, samples the block turn for a comparison); provider `none` never
  calls. The MCP server makes no network call. The API key is read from the macOS Keychain
  (service `ledgr`, account = provider name) at each call and never written to disk: `/usr/bin/curl`
  gets it in a config on stdin, and the message in a 0600 file under `ledgr-data/tmp/`, deleted after.
- **Runs programs.** The mod, through `exec` and `hc`: `hc read <terminal>` (checks a clipboard quote
  against a working agent's screen), `hc run … -- claude --resume <sid> --fork-session …`
  (Launch on a Branch: a new Claude Code session on your plan), `hc run … -- claude --resume <sid>`
  (Resume session), `hc kill` and `hc rm` (Close branch, after its answer landed),
  `git -C <cwd> rev-parse` (whether "isolate in a worktree" applies), `/usr/bin/which claude` once,
  and `bash mods/ledgr/bin/adapters/claude/extract.sh --retry …` (the Retry button). The hooks run
  `python3`, `/usr/bin/security find-generic-password` (the key), `/usr/bin/curl` (the call) and,
  at SessionStart and each prompt, `hc get $HC_TERMINAL_ID --json` (read only, killed after 300 ms)
  for the terminal's `herdr.space` label, to know whether ledgr is off in that space.
- **Reads the clipboard and pastes into a prompt.** The capture box reads the clipboard when it opens,
  to offer the copied passage as the question's quote (attached only if it matches the agent's saved
  turn text or screen). The panel writes the clipboard for Paste answer, Paste answers, Paste into
  trunk, `/btw`, Copy for prompt and Go to anchor, and focuses the pane (`pane.focus`). For the Paste
  actions it then runs Herdr's `terminal.paste` (what ⌘V runs: the clipboard into the focused
  terminal, no key names, no Enter) once Herdr reports that terminal focused on two looks in a row
  and the clipboard, read back, still holds ledgr's text: the message waits in the prompt until the
  person sends it. Never into a terminal with no agent (a shell could run the lines) or an agent
  waiting on its own prompt; `ui.pasteIntoPrompt: false` turns the paste off (clipboard plus focus
  only). That is all it does to a terminal.
- **Writes under the Herdr home only.** The mod, its hooks and the MCP server write `ledgr-data/`
  (store, spool, saved turn texts, per-session `decisions.md`, the MCP server's per-turn declarations
  in `mcp/`, logs, `config.json`) and the mod's own files. The installer also writes the Claude files
  named above (backup first) and its own state, backups and the files as they were before ledgr in
  `~/.local/state/ledgr/`.
- **Never:** sends keystrokes to a terminal (no `hc keys`, no `hc send`, no find bar; Enter is never
  pressed, and the one paste above is the only text that reaches a prompt;
  `bin/tests/test_no_keystrokes.py` checks the source and allows `terminal.paste` in one function);
  reaches the network beyond the one extraction provider; contacts any other application; reads files
  outside the Herdr home and the Claude config folders you chose (the installer also reads
  `~/.local/bin` wrappers and shell start-up files to find those folders, and `~/.local/state/ledgr/`).

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
    session name, a small dim `pane t21`, chevron) that opens the session list (live sessions grouped
    by agent and profile, each group headed by how its asks arrive: `declares asks` in `accent`,
    `extractor only` or `no asks`; then ENDED SESSIONS), the pin (a faint outline `pin` while the panel follows focus;
    pinned, an `accent` pill "pinned" whose tooltip says "click to follow focus"), `turn N` (in `working` colour with
    "· working" while the agent works), an `off` pill where ledgr is off, and a `demo` pill in demo mode.
  - The session list's first row is the switch for the focused pane's space: "ledgr off in this
    space" (or "ledgr on in this space", in `accent`) with the space's name small and dim beside it;
    rows of sessions in an off space read "off" instead of "N open".
  - Off in this space: instead of the lanes and the footer, "ledgr is off in this space", a dim line
    (no chips, no ⌘J, no instruction or extraction; items are kept and show again when it is on), a
    primary button "ledgr on in this space", and a line pointing at the session menu. A session
    pinned or picked in another space still shows its lanes; one whose own space is off reads "ledgr
    is off in <space name>".
  - The agent label names the session's Claude profile when it is not the default one: a Claude Code
    started with `CLAUDE_CONFIG_DIR=~/.claude-work` (a second account, `claude-work`) reads `claude · work`
    in the header pill, in its session-list group (`CLAUDE · WORK`, a group of its own) and row pill, in
    the capture box, and on the branch manifest's Parent line (`app (claude · work) · pane t1z …`);
    `~/.claude` (profile `default`) reads `claude` alone. The hooks record the folder and profile at
    each session start and prompt; the header pill's tooltip names the folder. A session from before
    this reads `claude` until its next prompt.
  - Names a person reads are words: `Ask 9`, `Question 1`, `pane t21` (never a bare `t21`), "branch of
    Question 1" with its short id (`br-q1-c51e`) small beside it. The short forms stay in every machine
    format: the answer sheet's `A9: …` lines, the confluence and answer markers, `[A9]` / `[Q1]` refs in
    a prompt, store keys.
  - **YOUR QUESTIONS** lane (top): parked questions, newest first. Each row: status glyph,
    `Question 3`, kind (`question`, `bookmark`), text, and a dim line `turn 14 · re Ask 5 · “quote…”`; a
    question parked mid-turn reads "parked during turn 17; anchors at end of turn" with a hollow glyph.
    Badges: `/btw`, `sent at turn 18`, `branched`. The lane head carries a quiet `Clear 3` (10.5 px,
    `dim`) while the session has open or deferred parked questions without a branch; clicked once it
    reads "Clear 3 questions? 1 branched kept" in `blocked` on a faint `blocked` tint for 4 s, then
    "Clearing 3…" until the writer has applied it. Cleared rows sit in the closed fold with a dim
    `cleared` badge.
  - **ASKED OF YOU** lane (second): folded or open only when you click its head (kept across reloads);
    while the agent works the head says "agent working" in `working`. The head carries the threshold
    control, a quiet `blocking only ▾` / `blocking + needed ▾` / `everything ▾` menu that writes
    `extract.threshold` to `config.json`. Grouped by turn: the newest group and any group holding an
    open blocking ask are open, older groups one line (`turn 12 · 2 asks, 1 open`); your click wins,
    and a group you folded that still holds a blocker adds `◆ 1 blocking` in `blocked`. Each row:
    glyph, `Ask 5`, kind, text, `raised again` (in `accent`) for an ask you dismissed that the agent
    raised again; decide rows show option chips, the
    recommended one marked "(rec.)". Blocking asks sort first in their group with a `◆` glyph and a
    `blocking` tag (both `blocked`). Asks below the threshold sit in one folded line at the bottom of
    their group, `below threshold (N)`: open, each row is dim with a hollow glyph, its level tag and a
    `promote` pill; they never count. A spinner and "extracting turn N" sit in the lane head while
    extraction runs; a failed turn shows "asks not extracted for turn N: <error>" with Retry. Under an
    open group with answers typed or picked: **Paste 2 answers into pane t21** and a dim "pasted into
    the prompt, never sent" ("Copy 2 answers for pane t21" and "clipboard + focus the pane; nothing is
    typed" with `ui.pasteIntoPrompt` off).
  - Clicking a row expands it: the quote in italics (over 300 characters cut with "…"), then "show
    whole message", which opens the anchoring message as markdown at full height, the paragraph holding
    the quote marked with a 2 px `accent` bar on an `accent` tint; for asks an Answer field with Paste
    answer beside it (Copy answer with `ui.pasteIntoPrompt` off); the buttons; a dim line in words:
    `Ask 13 · found by the extractor · needed · turn 19`.
  - Footer, 30 px: `older than a day (n) ›  deferred (n) ›  closed (n) ›` folds; a status line below for
    the last action's result.
- **Capture box** (⌘J): a popup at the top of the window, 600 × 236, no dimming, so the stream stays
  visible. Title "Park a question", then `t21 · <name> · turn N (working)` and the agent pill; the
  question field; the clipboard quote with a checkbox when it checks out, else a "Quote (optional)"
  field and a one-line reason; key hints; `session: t21 ↻ 1/3` to switch. Over a pane in a space
  where ledgr is off: the title, "ledgr is off in this space", "Nothing is parked. The ledgr panel's
  session menu (›) turns it on again for this space." and an Esc hint; no field.
- **Header chip** (optional mod `ledgr-pane`: Herdr's `pane` header plus the chip), 18 px, 10.5 px
  text: hidden with nothing open; `? 2` dim while the agent works and you parked questions this turn;
  `1 blocking · 2 asks · 1 parked` in `blocked` on a faint `blocked` tint while a blocking ask is open,
  also while the agent works (beside the header's own spinner, without pulsing); `2 parked · 3 asks`
  in `accent` on a faint `accent` tint after a turn ends with something new; `? 1 · 2` muted once
  seen; a small spinner while that turn's asks are being extracted. Turning loud pulses the chip once:
  a halo that fades over about 0.9 s.
- **Motion** (`ui.animations`, default true; false stops all of it): only on a state change. A row
  entering its lane fades in from 6 px above under a highlight that decays over about a second
  (`blocked` tint for a blocking ask, `accent` otherwise; several at once staggered 45 ms). A row
  leaving fades out in place and, when you closed it yourself, collapses. An ask that becomes answered
  glows `done`. Lane folds do not ease.

## How it behaves

- Asks arrive two ways. Declared first: the agent, told by the SessionStart instruction, declares a
  blocker or a needed decision with ledgr's `declare_asks` tool when the MCP server is registered (the
  rows appear at once, "declared by the agent (tool)", and are settled at Stop), else ends the reply
  with a fenced `ledgr-asks` block, which ledgr reads at Stop; either way with no model call, and the
  agent says what it needs instead of ledgr guessing. Extracted as the
  fallback: a reply without a block goes to the provider (Haiku by default); a blocking ask found that
  way puts the instruction into the session's next prompt once more. `extract.threshold` applies to
  both. An agent ledgr has no adapter for gets the parked-questions lane only
  (`mods/ledgr/bin/adapters/README.md` is the contract).
- Who owns the closing list (`asks.handoff`, the installer's "Who owns the closing list the agent
  gives you?"). `ledgr` (the default: if ledgr is installed, let it be authoritative): the agent puts
  every blocking and needed item only in the block and ends its prose with exactly one line,
  `ledgr: 3 items for you, 1 blocking` (or `ledgr: 1 item for you`), with no list in prose, so the
  reply's last screen stays the work's and the list is in the panel. `both`: the reply lists them as
  usual and the block declares them too. `prose`: no instruction at all; the extractor reads each
  reply. A change applies to new sessions at once and to running ones at their next prompt. Hover
  "agent working" on the asks lane head to see the mode.
- The block's readable form, whatever the mode: one line per item,
  `- blocking · decide · Choose the default template · "the sentence it comes from" · options: compact | detailed`
  (level and kind required, text required, the quote in straight or curly double quotes and
  optional, options optional). A JSON array is still read; a block that mixes the two is rejected,
  and a malformed bullet is dropped with a reason, as a JSON item with an unknown level is.
- Agent status: working lets the counts collect and puts "agent working" on the asks lane head; at
  Stop (blocked, done, idle) the host badge and the chip surface. An open blocking ask keeps the chip
  `blocking` through prompts and permission waits; it pulses when a turn ends still blocking. The
  panel never opens itself; no toast, no sound.
- Status is not an ask: a statement of what is done, pending or uncommitted yields nothing; an ask
  exists only when the message asks you to do or decide something, or says the agent waits on you. A
  closing line that only offers to go on is optional unless the message says the agent cannot proceed.
  A quote is the one or two sentences that make the ask.
- Severity: `extract.threshold` in `ledgr-data/config.json` (optional, needed or blocking; default
  needed) decides which levels are open rows and count. The writer and the panel read `config.json`
  again whenever it changes: no restart.
- The host button and ⌘⇧J (`ledgr.toggle`) show or hide the panel. The panel follows the focused
  agent's session unless pinned, across spaces too; a chip click shows the panel on that chip's
  session. A focused agent pane with no ledgr session yet says so ("no ledgr session yet", and that it
  joins at its next prompt or turn end; a Claude Code with its own `CLAUDE_CONFIG_DIR` needs the hook
  entries in that folder's settings.json) instead of showing a session from elsewhere; a shell in the
  same space keeps the last session.
- ⌘J opens the capture box over a streaming agent; the box takes the keyboard. Enter parks; Enter on an
  empty question with a quote parks a bookmark; Enter with nothing closes. ⌘Enter parks and puts
  `/btw About "<quote>": <question>` on the clipboard, then focuses the agent's pane. Esc cancels. Tab
  moves between the question and the hand quote field.
- Row actions: **Done**, **Defer ▾** (tomorrow, in a week, next session), the row's own step (Promote,
  Branch… on a question, Paste confluence again, Reopen), and **⋯** holding **Not needed**, Ask about
  this, Copy for prompt (`[Q3] <question>`), Stage /btw, Call off, and Go to anchor (opens the row on
  its whole message with the passage marked, focuses the pane, puts a 20-40 character slice of the
  quote on the clipboard, and says how to search for it: in Claude, ctrl+o for the transcript, then
  `/`, ⌘V, Enter; it presses no keys itself). A session whose terminal is gone offers **Resume
  session…** (`claude --resume` in a new pane) or **Transcript gone**. "Paste answers" (a turn's) and
  "Paste answer" (one ask's) build `ledgr answers <session id>`, `Answers to your asks from turn N:`,
  then `A5: …` lines and paste them into that session's prompt (below); when that prompt is sent, the
  hook marks those asks answered.
- A prompt that contains `[A5]` marks that ask answered; `[Q3]` marks the question sent. An answered
  ask closes by itself when that turn's asks arrive, unless the reply raised it again ("answered by
  you at turn N"); with the MCP server the agent closes the asks your message answered or dropped
  (`resolve_asks`, "closed by the agent at turn N"). Done stays your override, and Reopen undoes either.
- Branch… on a parked question: a confirmation shows the context manifest (what the fork knows and does
  not know) and its placement; Launch starts the fork beside the trunk. Conclude… opens an editor
  prefilled with the branch's `ledgr-conclusion` block; Paste into trunk stages `ledgr confluence
  <branch> <item>` + the question + "Conclusion:" + your text + a closing line in your voice, pastes
  it into the trunk's prompt (below) and marks the question `rejoin_pending` (↩). When the trunk's
  hook sees that prompt submitted, the question resolves, the branch shows REJOINED, and a line lands
  in `ledgr-data/sessions/<sid>/decisions.md`. Close branch (two clicks) then ends its terminal.
- The paste (`ui.pasteIntoPrompt`, default true): Paste answer(s), Paste into trunk and Paste
  confluence again put the message on the clipboard, focus the target's pane and run Herdr's
  `terminal.paste` once Herdr reports that terminal focused on two looks 50 ms apart (within 600 ms)
  and the clipboard still holds the message. Nothing is sent: the status line says "Answer for Ask 2
  pasted into the prompt in pane t3, not sent: add a word of your own, such as “My answer to A2:”,
  then press Enter." Nothing is pasted when the target is not live, runs no agent, or waits on its
  own prompt (a permission menu), or when the focus does not arrive in time; the status line says so
  and how to paste with ⌘V. A second click while a paste is pending is ignored. A paste joins a draft
  already in the prompt. With the switch off the buttons read Copy answers, Copy answer, Send to trunk
  and Copy confluence again, and the person types a lead-in, then ⌘V, Enter. Either way the message
  ends with one empty line (marker line still first), so two pastes into one prompt stay apart; the
  trunk's hook lands each message a prompt holds, one event apiece.
- Clear all questions: Clear N on the YOUR QUESTIONS head, clicked twice within 4 s, sends one
  `clear_questions` event for the shown session. Every open or deferred parked question without a
  branch is dismissed and marked cleared (a launch that was refused or failed counts as no branch);
  a branched or `rejoin_pending` question always stays, so no branch is left with nothing to close
  it. The status line says "3 questions cleared, 1 branched kept". Reopen in the closed fold brings
  one back.
- Off per space (`spaces.disabled`, Herdr space ids): the session menu's first row turns ledgr off or
  on for the focused pane's space, written to `config.json` with the same compare-and-swap as the
  threshold menu. In an off space the hooks send no event, print no instruction (the off text once,
  above), land nothing and start no extraction, and the MCP server records nothing and answers
  `off: true`, so the agent lists its needs in prose as if ledgr were not installed. The writer
  draws no chip there and does not open the panel for it, ⌘J parks nothing, and the panel shows the
  off state. Items are kept, hidden, and return when the space is on again. A space the hooks cannot
  name (no label, no `hc`) counts as on; a lookup that fails or takes over 300 ms keeps the space
  recorded before.

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
  `words.js`, `adapters.js` (reads each `bin/adapters/<name>/adapter.json` capability manifest for
  the session menu's "declares asks / extractor only / no asks"), `fixtures.js` (demo), `ledgr.svg`;
  `bin/` (Python 3.9+, standard library only): `adapters/README.md` (the adapter contract: identity,
  turn signal, instruction injection, turn text, optional fork and resume), the Claude Code adapter,
  the block parser, the extractor and its providers, `mcp/ledgr_mcp.py` (the stdio MCP server:
  `declare_asks`, `resolve_asks`, `open_asks`, `parked_questions`; JSON-RPC over stdin and stdout,
  tools only inside a Herdr terminal: `HC_TERMINAL_ID`, or `LEDGR_TERMINAL`), the offline tests.
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
  ones, `w` the agent working), `ledgr.focus`, `ledgr.ui` `{animations, panel, off}`), `focused`
  (its `space` too), `agents` (their `space`), `panes`, `terminals` (the `herdr.space` label),
  `spaces` (a space's name for the switch), `layout`, `placement`, `run` (`pane.focus`, `layout.select`,
  `layout.show`, `layout.hide`, `mod.open`, `terminal.keep`, `terminal.peek`; `terminal.paste` in
  `nav.js` `stageIntoPrompt` only), `openOverlay`, `closeOverlay`, `nextCommand`, `hc`, `exec`;
  `cx.read_from_clipboard`, `cx.write_to_clipboard`.
- **Data**, `<Herdr home>/ledgr-data/`: `store.json` (written only by the writer), `spool/` (one JSON
  event per file), `terminals/<t>.json` (identity map, with the terminal's `space`),
  `sessions/<sid>.json` (with `space` and `ledgr_off`) and
  `sessions/<sid>/decisions.md`, `turns/<sid>/<n>.md`, `mcp/<sid>/<turn>.json` (tool declarations),
  `snapshot.json`, `archive/`, `log/`, `tmp/`, `config.json` (`extract.provider`, `model`,
  `base_url`, `mode`, `threshold`; `asks.handoff`, `instruct_block`, `instruct_reinject`;
  `ui.animations`, `ui.foldAsksWhileWorking`, `ui.pasteIntoPrompt`, `ui.panel`; `spaces.disabled`;
  the full list with defaults is in the README's Configuration table).
- **Install.** Both paths end in the same files:
  - `./install.sh` asks each question with its reason (defaults in brackets are what is installed
    now); `./install.sh --yes --answers ledgr.install.json` asks nothing (schema:
    `setup/answers.example.json`; an API key comes from `LEDGR_API_KEY`, never from the file). It
    preflights (Herdr home and version, layouts shipped or personal, Claude Code, python3, `security`,
    an existing ledgr, key conflicts), copies the mods, writes `config.json`, stores the key in the
    Keychain, merges `keys.json`, patches the chosen personal layout (cloning a shipped one first),
    adds the hook entries after printing them, registers the MCP server and its allow entries when
    chosen (the command printed first), runs `herdr-app check` and the offline tests.
    `./install.sh --check` is the doctor; `./uninstall.sh` reverses it.
  - By hand, as the manual describes: copy `mods/ledgr/` (and `mods/ledgr-pane/` if wanted) to `mods/`;
    merge `keys.json`, asking before replacing a key in use; add the blocks from
    `setup/layout-blocks.json` to a personal layout; add the three hook entries above to
    `~/.claude/settings.json` (and each other Claude config folder's settings.json you use); optionally
    run the `claude mcp add` command above per config folder and add the four allow entries
    (`mods/ledgr/bin/mcp/README.md`); `chmod +x mods/ledgr/bin/adapters/claude/*.sh`; store the key with
    `security add-generic-password -s ledgr -a anthropic -w`; `herdr-app check mods/ledgr` (and
    `mods/ledgr-pane`).
- **Example integration** (`examples/personal-overlay/`, not part of the mod): a personal tab bar
  (`my-tabs`) that hosts the writer from an engine copy; its pane header is the public `ledgr-pane`.
  `./install.sh --overlay examples/personal-overlay` deploys it and writes the engine copy; its
  `answers.json` is that setup's answer set with only the primary Claude settings file (the owner's
  real one, with a second config folder, is a gitignored `answers.local.json`).

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
  stay short scroll instead. For shots (`docs/preview-recipe.md` stages `preview.png` with them):
  `ledgr.fold-mine`, `ledgr.fold-asks`, `ledgr.expand-all`, `ledgr.collapse-all` (rows, boxes and the note line),
  `ledgr.hide-branch:<hc name>` (demo only),
  `ledgr.pick:<handle>:<n>`, `ledgr.copy-answer:<handle>`, `ledgr.session:<terminal>`,
  `ledgr.below-threshold`, `ledgr.act:<handle>:<resolve|dismiss|reopen|promote>`,
  `ledgr.whole:<handle>`, `ledgr.menu:<handle>:<defer|more>` / `menu:threshold` / `menu:off`,
  `ledgr.threshold:<level>`, `ledgr.space:<off|on|toggle>` (the focused pane's space; in the demo it
  only draws the off state), `ledgr.clear-questions` (a click on Clear N: twice to clear), in the demo
  `ledgr.demo-ask:<level>` and `ledgr.demo-answer:<handle>`, and `ledgr-pane.demo-chip:<state|off>`.
- Off per space has two known gaps: a branch launched into an off space records its lineage but sends
  no `branch_started` event; and the capture box over an off pane stays open until Esc, Enter or a
  click dismisses it.
- Motion is native (`transition`), never a timer; an idle panel does not render. No reduced-motion
  setting reaches a mod: `ui.animations: false` is the switch.
- A branch shares the trunk's checkout unless isolated: the preamble forbids edits, nothing enforces it.
  The fork is taken at the end of the session, so it also sees every turn after the anchor; the
  manifest says how many.
- The confluence resolves only when the trunk's UserPromptSubmit hook sees the marker line as the first
  line of a pasted block, or of the prompt after at most a one-line lead-in. Paste into trunk puts
  the message in the prompt as a paste, marker first; add a word of your own (the panel suggests
  "Adopt this branch result for Q1:") and press Enter. With `ui.pasteIntoPrompt` off, type that
  lead-in before ⌘V.
- Assumes macOS (Keychain, `security`), Claude Code for the hooks (no asks lane for other agents yet),
  and python3 3.9 or newer at `/opt/homebrew/bin`, `/usr/local/bin` or `/usr/bin` (or `LEDGR_PYTHON`).
  Providers `cli` (`claude -p`) and `openai-compatible` are untested end to end.
- The MCP server's `parked_questions` does nothing yet: the panel has no action that releases a parked
  question to the agent, so it returns an empty list with a note. Its tools appear only when the
  agent's client passes `HC_TERMINAL_ID` to stdio servers (Claude Code does unless
  `CLAUDE_CODE_MCP_ALLOWLIST_ENV=1`).

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
  item resolving; when the MCP server was chosen, `ledgr` registered (user scope) and the four allow
  entries present for each chosen config folder.
- With the MCP server registered, a Claude Code turn that leaves something for you ends with the
  pointer line only (no block), and the rows show "declared by the agent (tool)".
