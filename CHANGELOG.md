# Changelog

## 0.1.0 (unreleased)

First public shape of the mod. Built on Herdr 0.1.13, hc 0.1.18, Claude Code 2.1.311.

### Multiline answers, drafted mark, next question (2026-11-11)

- The detail dialog's answer box takes several lines: a `Textarea`, two lines growing to ten, then it
  scrolls (`detail.js` `makeAnswer`, `views.js` `answerBox`). Enter is a new line; the paste of the
  turn's answers moved to ⌘Enter, the `mod:ledgr` `btw` command, which in the dialog (while it holds
  the keyboard on an ask) means the turn's answers; the box's own ⌘ submit does the same, one paste
  per keypress (`pasteSheet`). Footer hints "⌘Enter paste the turn's answers", "Enter newline". In the
  sheet an answer's blank lines are left out and its next lines indented two spaces (`confluence.js`
  `answerLines`); the landing parser reads an indented line as the same answer, joined by a line
  break, never as another `A<n>:`, a marker or a fence (`ledgr_landing.py`). A draft is cut at
  `LIMITS.answer` (4,000) instead of 400. Tests: detail +60 (670), store +5 with the parser on a
  multi-line sheet (886), hooks +3 (224), no keystrokes +17 (558: `pasteSheet` and `step` run
  nothing; `makeAnswer` pastes only with ⌘).
- An answer typed or picked and not sent shows on its row (`listing.js` `draftPending`): an open ask
  keeps its Paste button; an ask below the threshold or deferred says "drafted" in `dim` in place of
  its state word, and the row's tooltip ends with the answer. It follows the status (answered or
  resolved: gone), since the store keeps the draft after the sheet lands; an ask reopened after its
  sheet landed is drafted again only for a new answer. Suggestions with answers already count in
  Paste N answers and go into the sheet (`copyAnswers` takes every open ask of the turn). Tests: list
  +57 (299, with `laneOf` below).
- Next and previous in the dialog: ⌘↓ / ⌘↑ (`ledgr.detail-next`, `ledgr.detail-prev`, added to
  `keys.json` `mod:ledgr` and the installer's `MOD_KEYS`; ⌘] and ⌘[ stay Herdr's `agent.next` /
  `agent.prev`) and the header's `← prev`, `3 of 19`, `next →`, dimmed at either end (no wrap). The
  order is the panel's (`listing.js` `laneOf`: the session's asks by turn, newest first, blocking first,
  those below the threshold last; YOUR QUESTIONS; the pins; a fold's items). A move posts the waiting
  draft (`Reader.sendDraft`), shows the record in place (`retarget`), leaves the keyboard on the dialog
  (Tab enters the answer box) and rewrites `ledgr.detail`'s open record, so the panel's cursor follows (`noteDetail`). Tests:
  detail (the order with suggestions, the ends, the draft posted once before a move), list (`laneOf`
  on every lane, `neighbors`). Not tried live yet: which of the textarea and the `mod:ledgr` section
  takes ⌘Enter and ⌘↓ / ⌘↑ first.
- Review fixes (`docs/build-notes/BUILD-NOTES-detail.md` 16.1): a step leaves the keyboard on the dialog;
  ⌘Enter carries a deferred or answered ask's own answer; ⌘↓ / ⌘↑ only while the dialog holds the
  keyboard; the landed answer recorded whole (4,000) and compared whole for "drafted"; an `[A7]` inside a
  sheet is no ref (`ledgr_landing.sheet_lines`); a sheet over 24,000 refused, `MAX_SCAN` 96,000; the box
  cut at 4,000 with a word; a pin note saved on a move; ⌘Enter's own line break put back (defensive).

### c049075: preview retake and whole-turn text

- Preview retaken for the list and the dialog: `preview.png` is the scan list (a pin, Ask 1 and Ask 2
  as one-line rows, Ask 3 below the threshold) and `docs/preview-dialog.png` the same state with the
  detail dialog open on Ask 2, linked from the README; both from a throwaway Claude Code session on
  Haiku in a neutral folder, on the tool path (`docs/preview-recipe.md`, with the steps for the pin,
  the picked option, the cursor row, the window size and the crop).
- The saved turn text is the whole turn. Found in that retake: on the tool path (text, the
  `declare_asks` call, the pointer line) `turns/<sid>/<turn>.md` held only Stop's
  `last_assistant_message`, the text after the last tool call, so the dialog's THE MESSAGE showed only
  `ledgr: 3 items for you, 2 blocking` with no passage marked, and a pin from the plan was verified
  from the screen instead of the saved turn. Stop part A now writes every main-thread assistant text
  block since the prompt, a blank line between them, with `last_assistant_message` as the last part
  (`last_assistant.py` `whole_turn`, which reads the transcript backward from its end and parses only
  text and prompt lines; about 2 ms on a 5 MB transcript whose last turn has 40 tool calls), and
  `last_assistant_message` alone when the transcript cannot be read. `turns/<sid>/<turn>.json` beside
  it keeps the final message (what `--retry` extracts from, so a retried turn sees what its Stop saw),
  the source and one `{uuid, message_id}` per part; the turn's `passage_hash` stays the final
  message's. A declared turn's quotes are checked against the turn file, the final message added only
  when it is not in it (`ledgr_extract.whole_text`). No reader changed: the file is still plain text.
  Takes effect from the next Stop in any session after `./install.sh`. Tests: last_assistant +12,
  hooks +11 (203), detail +1 (610).
- The race in that retake (one run in four saved only the pointer line and dropped all three quotes:
  Claude Code writes the turn's records after Stop fires, and `whole_turn` read a transcript that held
  the prompt but not the plan) is closed: part A writes the whole turn only when the transcript
  already holds `last_assistant_message` (`last_assistant.holds_final`, and the turn's prompt is this
  turn's), else the final message alone with `lagged: true`; part B re-reads on the uuid lookup's
  schedule (0, 1, 2, 4 s), rewrites both turn files once the transcript catches up, before it emits
  `stop`, and a declared turn that never catches up checks its quotes against the final message plus
  this turn's partial text, so a quote in the final message is never dropped. Tests: last_assistant
  +9, hooks +18 (221).

### 21d4d1f: list and detail dialog, settings, links

- Jesse: "when trying to view the side bar entries, I can't interact with the text. what if the
  sidebar was a bit more simplified list and clicking on an item opened a larger central modal".
  The cause: a row's text was a plain element, which Herdr cannot select, inside the row head whose
  click folded the row. Herdr selects text only in a markdown view with `.selectable(true)` or a
  read-only Editor. Spec: `docs/design/Detail.md`; notes: `docs/build-notes/BUILD-NOTES-detail.md`.
- The panel is a scan list: one line per ask, question, pin or branch (glyph, handle, one pill, the
  text's first line, a state word such as "answer ready", "sent at turn 14" or "branch working";
  `listing.js` `rowModel`). Only Done (on the hovered and the cursor row), Paste answer (an answer is
  ready) and Promote (a row below the threshold) stay on a row. A click gives the list the keyboard:
  ↑ ↓, PageUp / PageDown, Home / End move a cursor over every line a click acts on, Enter does what
  its click does, Space checks a pin, Esc clears. `ledgr.focus-list` (bound to no key) does the same
  without the pointer; `mod.json` gains no `focusable`, so the host block is no pane stop.
- A click on a row, or Enter, opens the detail dialog (`detail.js`, props `{view: "detail", session,
  kind, id, …}`, opened with `openOverlay`; `mod.json` still declares one overlay): centered, 0.6 ×
  0.75 of the window, the window dimmed, two scrolling columns from 760 px (the item; the message with
  the passage marked and scrolled into view). Every reading text is a selectable, scrollable markdown
  view, the person's and pinned text escaped so it shows as stored, with Copy beside it. It holds
  every action the expanded row had: answering, Defer, Branch… and its manifest, Conclude… and Paste
  into trunk, a pin's Ask here…, Note, Archive, Delete. One at a time: a second open replaces the
  first; a sub-row retargets it in place. Esc or a click outside closes it, and nothing typed is
  lost (drafts flushed, the Conclude text kept in `localStorage` `detail.conclude`).
- The dialog is its own copy of the mod. `reader.js` `Reader` is the panel's reading and acting half
  moved out (store.json reading, acts, drafts, `flushPending`, staging, Herdr lookups), extended by
  `Panel` and by `Detail`, which reads store.json and the turn files itself and never pings or claims
  the writer. It writes `shared("ledgr.detail")` on open and close, so the panel draws the open row
  raised, restores its cursor, shows the dialog's last words and takes the keyboard back (30 ms, again
  at 300 ms). The renderers moved to `views.js`, the pure parts to `listing.js` and `detailing.js`;
  `panel.js` went from 2,454 to 1,592 lines. No engine file, store, spool event or key changed.
- One staging door: nav.js `stageIntoPrompt` is called only by nav.js `stageMessage` (one paste at a
  time, the words of what happened), which only `Reader.stage` calls; neither `panel.js` nor
  `detail.js` defines `stage`, and copy methods never stage. The dialog stays open until the paste is
  decided, then closes and leaves the keyboard in the pane; acts that close it (Done, Not needed,
  Defer, Archive, Delete) write their spool event first. `test_no_keystrokes.py` enforces 11 rules
  and prints every failure.
- Probe P1 first, on a throwaway scratch mod and cat-like panes: a dialog survives `pane.focus`,
  `terminal.paste` lands while it is open (1 ms, no CR or LF), `closeOverlay` from the dialog's own
  task works, closing cancels the dialog's pending tasks once `close()` resolves (work after a close
  lives only while `close()` awaits, at most 250 ms; `main.js` now awaits `release`), and the keyboard
  goes to the focused terminal after a close.
- Tests: list 242 and detail 609 (new `test_list.mjs`, `test_detail.mjs`, run by the new
  `test-detail.sh` in `run-all.sh`), nav 364 plus compose 221, no keystrokes 541, store 881, hooks
  191, mcp 96, installer 69. `herdr-app check` passes. The live check (`Detail.md` 6.5, the parts
  that need real keys, panes and selection) is not done.
- `preview.png`, the recipe's look at the panel and `docs/preview-recipe.md` (its `expand-all` step,
  which now only says where rows open) show the expanded rows; a retake is pending.
- Asks of the user only. Jesse's panel showed Ask 50 (provide, blocking, found by the extractor)
  built from "I need only the agent's fix report now, and nothing else can be requested until it
  lands": an orchestrator waiting on its own subagent. "The agent didn't need something _from me_ it
  was just stating that it was waiting on something." Both instruction wordings
  (`asks-instruction-ledgr.txt`, `-both.txt`), the MCP server's `instructions` and the `declare_asks`
  description now say to declare only what the user personally must do, decide, provide or review:
  a wait on the agent's own subagents, tools, builds, tests or processes is not an ask, even when it
  writes "I need". `extract-system.txt` gives the fallback model the same rule, with that sentence as
  the worked example (no ask) against "I need the domain name from you before I can configure DNS"
  (provide, blocking); the JSON schema is unchanged. New fixture `subagentwait` (an orchestrator's
  reply waiting on a fix agent's report, paraphrased, "I need" in it): offline PASS; live, one call,
  zero asks (2,500 in, 9 out, $0.00025). Hooks 192, mcp 98. After an install, a running session gets
  the wording at its next SessionStart (resume, clear, compact) and the server's text after `/mcp`.
- Settings dialog. Jesse, after "this is REALLY good. Where is the 'settings' for this? for example
  font size, threshold": "build the settings dialog with text scale". `settings.js` (`class Settings
  extends Reader`, props `{view: "settings", opener, demo}`, `kind: "dialog"`, 0.5 × 0.7) opens from a
  gear at the right of the panel's header, `ledgr.settings` (the host opens it when no panel is shown)
  and `ledgr.demo-settings`. Rows, each with its value, a control and one line (`words.js`
  `SETTING_WORDS`): Text scale (− 120 % + and 100 %), Threshold (the lane head's three words), Who owns
  the closing list (ledgr / both / prose, writing `instruct_block` as the installer does; running
  sessions follow at their next prompt), Paste into the prompt, Animations, Fold asks while the agent
  works, Open the panel on new asks (on / off), Branch depth (0 to 4), and Off spaces (on / off per
  space Herdr has, by name; an off id Herdr no longer has, by id, with Drop); the footer names
  `config.json` for everything else. Every click writes at once through `Reader.saveConfig`, now the
  one writer of `config.json` (`reader.js` `editConfig`, moved from the panel's `saveConfig`, which
  the lane head's threshold menu and the space switch now share): changes queue so quick clicks never
  collide, and a write that finds the file changed under it writes nothing, reads it again and says
  so. One dialog at a time: it writes `shared("ledgr.detail")` like the detail dialog (kind
  "settings", no id), so whichever is open closes before the other opens, and its closed record puts
  its last words in the panel's status line. It stages, copies, runs and opens nothing
  (`test_no_keystrokes.py` rule 12).
- `ui.textScale` (default 1, 0.8 to 1.6 in steps of 0.05; `config.js`, `ledgr_config.py`): every
  copy draws with `withScale(theme(), textScaleOf(cfg))`, whose `t.ts(n)` is n times the scale to a
  half pixel. All 176 `text_size(` calls go through it (panel 68, views 43, detail 29, capture 21,
  settings 13, host 2), and so do the heights of the rows and buttons that hold a line of text, the
  row glyph column and the checkboxes; icons keep their size. The writer publishes the scale as
  `shared("ledgr.ui").textScale` for the host button, the pane chip (ledgr-pane scales its chip only;
  the header's own text stays Herdr's) and the ⌘J box; the host's and the chip's heights stop at 26 px
  to stay inside their bars. A change shows at the next render of every copy.
- Tests: settings 711 (new `test_settings.mjs`, run by `test-detail.sh`: the clamp and step, half
  pixels, rows and edits, `editConfig` with a stale file, every control through its click, the demo,
  the panel's gear and one dialog at a time, the panel, detail and settings dialogs drawn at 100 and
  160 % with every size scaled, and a static scan that every `text_size(` goes through `t.ts(` with `t`
  in scope), no keystrokes 492 (rule 12). `herdr-app check` passes for ledgr and ledgr-pane; in
  scratch copies it also rendered the settings dialog (80, 100 and 160 %), the demo panel (100 and
  160 %), the detail dialog (160 %), the demo host and the box (both at 100 %: they take the scale
  from the writer's `shared("ledgr.ui")`, which a check has not). Not tried live.
- Links. Jesse: "the big modal is working GREAT! any chance it could resolve relative links or
  weblinks?" In the dialog's message (the whole turn, every block) and an ask's text and quote, a web
  link opens in the browser (`on_link_click` in `views.js` `readable`, `cx.open_url`: http and https
  only), and a file path becomes a link: `links.js` `findPaths` / `linkify` (pure) rewrite
  `src/app.js:12`, `./x`, `~/x`, `/abs/x`, `docs/a.md`, `#L12` and a code span that is exactly a path
  to `https://ledgr.invalid/path/<the path, encoded>[?line=N&col=M]` (never fetched: the handler
  takes the click), and leave fences, indented code, existing links and URLs alone; the false
  positives kept out are listed in its header (and/or, 1.5, e.g., Node.js, /btw, github.com/a/b, …).
  A click (`detail.js` `openLink`) looks for the path as given when absolute or under ~, else in the
  record's folder (the session's `cwd`; a pin's `source.cwd`; a branch's own session), then in its
  git toplevel, and opens the first that exists with `links.editor` (new, default `"open"`; also
  `"zed"`, `"code"` at the line, or a command of your own with `{path}`, `{line}`, `{col}`; a row in
  the settings dialog, "Open files with"; `config.js`, `ledgr_config.py`). The `open` preset never
  launches: an app, package, disk image or jar is revealed, a script or a file with no extension opens
  as text (`open -t`). Found nowhere, the status line names the places it looked; found, it offers
  Reveal in Finder (`open -R`) and Copy path. `opener.js` holds the mod's reading copies' only process
  calls (`openPath`, `revealPath`, and `gitToplevel`, which the Branch confirmation's worktree check
  now uses too), each with a 5 s limit; a custom command naming a shell, an interpreter, a terminal or
  the file itself is refused. This carves one exception into "no other applications": a link or path
  the person clicks in the dialog opens in the browser or the chosen editor, never on ledgr's own
  initiative. Pins, questions, answers and conclusions render verbatim (escaped), so they stay
  unlinked this round.
- Tests: links 436 (new `test_links.mjs`, run by `test-detail.sh`: the path corpus and its false
  positives, `linkify` round trips, `parseLink`, `resolvePath`, `openerArgv` per preset and custom,
  `opener.js` through a recording `exec`), detail 609 (the handler: a web link, a path from the
  folder and from the git toplevel with `open` and `zed`, a path found nowhere, Reveal, Copy path, the
  demo running nothing), settings 643 (the new row), no keystrokes 538 (rule 13: `exec(` only in
  `opener.js` among the reading copies, in three argv shapes; `detail.js` reaches it only through
  `openPath`, `revealPath`, `gitToplevel`). `run-all.sh`, `herdr-app check` and the installer's test
  pass. Not tried live: whether Herdr's markdown autolinks a bare URL, how a relative markdown link
  reaches `on_link_click`, whether a click in a selectable view fires it, `zed` and `code` on the
  login shell's PATH, and Herdr's `fs.stat` / `fs.exists` on paths outside home.
- An independent review of the settings, scale and links found two medium and six low issues, all
  fixed: the installer no longer reverts what the settings dialog or the threshold menu wrote (it
  keeps a value config.json changed since the last install and says so); the ⌘J box caps its scale
  at 125 % and scrolls its middle; the `open` preset judges by where a path really leads and opens
  byte-code and scripts as text; the custom editor command is checked in every argument, with
  shell-style quoting in the field; fast stepper clicks are not lost; `linkify` strips trailing `_`
  and `-`, needs a known root for bare absolute paths, is linear and cached; the overlay's tab bar
  gets `my-tabs.ledgr-settings` for a hidden panel. Setup 82 checks.

### 4433d65: pins

- A pin is a passage kept verbatim from an agent's reply before any question exists (Jesse: pins
  "should actually live"; Claude Code deletes transcripts after about a month). Pins live in their
  own `pins` map in `store.json`, beside `items`, so chips, counts, the snapshot (extractor and MCP
  server), refs, the daily archive and Forget never touch one. Each keeps its text (line breaks
  kept, at most 4,000 characters, `clipped` beyond), a one-line note, an anchor (turn and passage
  hash, uuid when known, never a position) and its session's `source`, so it outlives Forget and the
  transcript. Handles `P1`, `P2`… per session ("Pin 4"). Archived only by the person, deleted only
  once archived (two clicks). Spec: `docs/design/Pins.md`; notes:
  `docs/build-notes/BUILD-NOTES-pins.md`.
- Taking one: select the passage, ⌘J, then ⌘S in the box (`mod:ledgr` `"cmd-s": "ledgr.pin"`, in
  `keys.json` and the installer's `MOD_KEYS`); the box's line becomes the note. The passage is looked
  for in the session's saved turns (that turn is the anchor), else on its screen (`hc read`, read
  only); found nowhere, a second ⌘S within 5 s pins it "unverified". The same passage again in the
  same session makes no second pin. A screen pin taken mid-turn settles at Stop and the writer
  re-anchors it to the saved turn that holds it. A clipboard over 600 characters can now be pinned,
  never attached as a question's quote.
- The PINS lane, above YOUR QUESTIONS: the shown session's pins, newest first, five then "N more",
  "archived (N)" with Restore and Delete; per pin Ask here…, Branch…, Note, Copy, and in ⋯ Go to
  anchor and Archive; a usage line ("answered in Question 3 (turn 14)"). One search box over every
  session's pins, in memory: literal terms and "quoted phrases" over text, note, session name, repo
  and folder, newest first, grouped by session, "archived too" and "this session only" toggles, a
  forgotten session still named. Checkboxes gather up to 12 pins from any session; "Ask about these…"
  opens the box in pins mode, where the typed question is parked with `request.pins`.
- Ask here: a question with pins pastes one message into its trunk's prompt (never sent): the marker
  `ledgr pins <session> <item>`, the question, each pin quoted line by line with `> ` and where it
  came from (another session's pin says "you did not write this in this conversation"), and a
  closing line in the person's voice. The UserPromptSubmit hook emits `pins_asked`; the question
  shows "sent at turn N", is answered at that turn's Stop, and each pin records `answeredIn`. Quoted
  lines land nothing and are left out of the prompt's `[A3]` / `[Q3]` refs (`ledgr_map.prompt_refs`).
- Ask in a branch: the preamble carries the pins verbatim with provenance and asks for one `pin i:`
  line per pin in the conclusion; the manifest's Given row says "2 pins, verbatim in the preamble";
  over 24,000 pinned characters the branch is refused. Conclude without a block prefills one entry
  per pin, the confluence names the pins, and a landed confluence records `answeredIn` via the
  branch. No new `config.json` key: five `LIMITS` in `config.js`. No MCP `pins` tool this round.
- The header's session pin is now "hold" / "held" (text only), so "pin" means one thing; the
  `localStorage` key stays "pinned". The demo gains three pins and Q9, asked with two of them.
- An independent review found two medium seams and five low ones, all fixed: pin ids are checked
  against the store's own keys (a `__proto__` id used to reach `Object.prototype`); the box in pins
  mode never falls back to another session (an ended session parks from its store record, trunk
  refused, branch allowed); a `then` carries the box's own time; a branch keeps its pin ids so the
  numbers match the confluence ("pin 2: (deleted)"); Ask here and Copy for prompt share the
  branch's size cap and the landing parser scans 64,000 characters; search caches folded text;
  settled pins get the turn's uuid; a question with pins has no `/btw` and its Copy carries the pins.
- The box key was ⌘P (`cmd-p`) as built. In his live check the same day the maintainer found it in
  conflict with Herdr's own global ⌘P (`mod.open:picker`), so it switched to the planned fallback
  ⌘S (`cmd-s`, bound in no shipped Herdr section, global or terminal; ⌘⇧P is Herdr's palette) in
  `pinning.js` `PIN_KEY`, `keys.json`, `MOD_KEYS`, `words.js` `PINS_EMPTY` and the docs. The same
  check found the ⌘J box cramped: it is now 600 × 320 (was 236; the panel's Ask about this the same,
  pins mode 340, was 300), with more padding (20 by 18, was 16), a 10 px gap (was 8) and three lines
  of the clipboard quote (was two). Behaviour unchanged.
- Tests: store 881 checks (307 pins), hooks 191, no keystrokes 347, nav 269 plus compose 221 (new
  `test_compose.mjs`, run by `test-nav.sh`), mcp 96, installer 69. `herdr-app check` passes. Of the manual
  live check (spec 8.4), step 3 settled the key (above); the other steps are not recorded yet.

### 904cba0: no names in the repo

- The example of a second Claude config folder is neutral everywhere: `~/.claude-work`, profile
  `claude · work` (docs, comments, tests; two tests that compare two folders use `.claude-alt` for
  the other). Nothing in the code ever depended on the literal name: the profile label is derived
  from the folder name.
- The maintainer's real install answers moved to a gitignored `examples/personal-overlay/
  answers.local.json` (`*.local.json` is ignored); the shipped `answers.json` names only
  `~/.claude/settings.json`. CLAUDE.md, the overlay README and the RECIPE point at the local file.

### 69d4c3e: ready for the public repo

- `preview.png` retaken on the tool path from a throwaway `claude --model haiku` session in a neutral
  folder: the reply ends with the pointer line and no block, the panel shows the three asks
  "declared by the agent (tool)", the chip reads `2 blocking`. `docs/preview-recipe.md` describes
  that state as the current one and keeps the block path for a machine without the server. Found on
  the way: the pointer line `declare_asks` returns counts only items at or above `extract.threshold`
  (with `blocking`, "2 items for you" for three declared); the frame's "3 items" line is the model's
  own wording.
- Personal paths are gone from the design doc, the research report and the primitives note (`~`
  paths and neutral example folders; `file://` links became code paths), and from the build notes;
  the one employer and project name left in notes and a test fixture are neutral now. The exported
  conversation stays gitignored.
- The two config keys nothing read, `btw.autoSend` and `nav.autoSearch`, are removed from the
  defaults, the README table and the design doc (Section 5.5, 6.6, Q5, Appendix B).
- README: the clone line; the public repository is `github.com/jessebacon/herdr-ledgr` (topic
  `herdr-mod`).

### e9bc29a: off per space, Clear all questions, room between pastes

- Off per space (Jesse: "enable/disable per space"; he chose the full version). `config.json`
  `spaces.disabled` lists Herdr space ids (default `[]`; names change, ids do not; defaults in
  `config.js` and `ledgr_config.py`). The session menu's first row, "ledgr off in this space" or
  "ledgr on in this space" beside the space's name, writes it with the threshold menu's
  compare-and-swap (`panel.js` `saveConfig`, now shared). Where the focused pane's space is off the
  panel shows an `off` pill and "ledgr is off in this space" with a button to turn it on, instead of
  the lanes; a session pinned or picked in another space still shows, and the session list marks
  sessions in an off space "off". Items are kept, only hidden. The writer draws no chip for a
  terminal in an off space (its space as the hooks recorded it, else live from `agents()` or the
  terminal's `herdr.space` label), publishes the list as `shared("ledgr.ui").off`, does not open
  the panel on asks from such a session (`offEvent`), and takes a terminal's new space from its
  rewritten identity-map record. ⌘J over an off pane says "ledgr is off in this space" and parks
  nothing; sessions in off spaces are not offered as targets. Commands `ledgr.space:<off|on|toggle>`.
- The hooks in an off space behave as if ledgr were not installed. `ledgr_map.herdr_space()` runs
  one `hc get $HC_TERMINAL_ID --json` (`posix_spawn`, 300 ms limit) at SessionStart and each prompt
  and records `space` on the session record and the map; no space (no terminal id, no `hc`, no
  label) counts as on, and a failed lookup (timeout, bad exit, bad JSON) keeps the recorded value.
  Off: no spool event at all, no instruction, no landing; Stop part A only marks the session idle and
  exits 10, so no `pending`, extraction, settlement or reinject (one `hook.log` line per off
  period). A running session is told once, at a real prompt: on to off prints the new
  `lib/asks-instruction-space-off.txt` (to a session that had a wording), off to on the mode's
  wording; a SessionStart while off prints nothing, except the off text at a resume or compact of a
  session that had a wording. The record keeps `ledgr_off`. Medians: SessionStart 43-45 to 51-52 ms,
  UserPromptSubmit 42-45 to 52-54 ms, Stop unchanged.
- The MCP server, for a calling session in an off space: `declare_asks` and `resolve_asks` write
  nothing and answer `off: true` with a note to list needs in prose; `open_asks` and
  `parked_questions` answer empty with `off: true`. Known limits: a branch launched into an off space
  records its lineage but sends no `branch_started`; the capture box over an off pane stays until
  dismissed (Esc, Enter or a click).
- Clear all questions (Jesse; scope as he chose: "shown session, skip branched and rejoining
  questions"). The YOUR QUESTIONS head shows "Clear N" while the shown session has open or deferred
  parked questions; a first click arms it for 4 s ("Clear N questions? M branched kept"), a second
  posts one `clear_questions {session_id, keep: ["branched", "rejoin_pending"]}` event ("Clearing
  N…" until the store has it). The writer dismisses each open or deferred parked question with no
  branch (a refused or failed launch counts as none), with `dismissedBy: "clear"` and `clearedAt`;
  branched and `rejoin_pending` ones always stay. Closed rows read "cleared", Reopen works per item
  (`setStatus` drops both marks), and the archive treats them as dismissed. Status line "N questions
  cleared, M branched kept"; command `ledgr.clear-questions`.
- A blank line after every staged message (Jesse: "when pasting an answer, you should add an empty
  line. When I'm trying to paste multiple answers, they run together"). `nav.js` `promptText` ends
  the text `stageIntoPrompt` handles (one answer, the answer sheet, the confluence) with exactly one
  empty line, pasted or not, and demo copies the same; the marker line stays first and the stored
  conclude message is unchanged. The clipboard check before the paste ignores trailing line breaks.
- Landing fix, found in Jesse's own prompt of the day: two answer sheets in one prompt were misread.
  Wrapped, only the first landed; unwrapped, A11's answer swallowed the second marker line and A12's
  took the sentence he typed below the sheets. `ledgr_landing.detect_all()` ends a sheet at a paste
  wrapper line, the next marker, or a blank line not followed by an `A<n>:` line, and follows one
  message to the next; the hook sends one landing event per message, 1 ms apart. `detect()` still
  returns the first.
- Tests: store 574 checks (spaces off and Clear all), nav 256 (`promptText`), no keystrokes 313,
  hooks 169 (a fake `hc` through `LEDGR_HC`; 30 disabled-space checks; two sheets wrapped, two
  unwrapped with a blank line, a trailing blank line, a one-line lead-in, prose between sheets, a
  confluence then a sheet), mcp 76 plus the off checks. `herdr-app check` passes.

### bba05b1: blocking survives working, the agent closes answered asks, paste into the prompt

- The pane chip keeps its `blocking` state while the agent works: an open blocking ask at or above
  `extract.threshold` no longer yields to `working` on every prompt and through every permission
  wait. A working chip stays in `blocked` beside Herdr's own spinner and does not pulse; it pulses
  once the turn ends still blocking. The chip record gains `w: 1` for a working session, the tooltip
  adds "agent working", and `ledgr-pane.demo-chip:blocking-working` draws the look. (The host
  button's `◆` count reads `b`, which was never muted, and is unchanged.)
- ASKED OF YOU: a turn group holding an open blocking ask stays unfolded with its `◆` rows, as the
  newest group does; the person's own click still wins (`groupOpen()` in `store.js`), and a folded
  group that still holds a blocker shows "◆ N blocking" in `blocked`.
- `resolve_asks`, a fourth MCP tool, loaded upfront like `declare_asks`: `{handles: ["A4", …],
  note?}` maps handles to this session's agent asks through `snapshot.json`, as `open_asks` does, and
  drops one `act` spool event per ask still open, deferred or answered (`action: "resolve"`,
  `actor: "agent"`, `handle`, `turn`, `note`; built by `ledgr_spool.act()`); it returns `resolved`,
  `unknown` and `already_closed`. The writer's `on_act` takes only `resolve` from the agent and sets
  `resolvedBy: "agent"` and `resolvedNote`; the Closed list reads "closed by the agent at turn N ·
  note". Done stays the person's override and Reopen still works. Both instruction wordings and the
  server's `instructions` gain one sentence: when the user's message answers or drops an open ask,
  call `resolve_asks` with its handles before declaring anything new.
- Answered, then settled: an ask marked answered (an `[A3]` ref in a prompt, which now records
  `answeredTurn`, or the answer sheet) becomes `resolved` with `resolvedBy: "answer"` ("answered by
  you at turn N") when the writer applies that turn's `asks` event, after the re-raise rules; a reply
  that raised it again reopens it in place, as before. `skip` settles too; `pending`, a mid-turn tool
  call and `error` do not. Parked questions are untouched. `setStatus` clears `resolvedBy` and
  `resolvedNote` on every status change, so a reopened item no longer keeps "resolved by its branch".
- Installer: `MCP_TOOLS` gains `mcp__ledgr__resolve_asks`, appended last so an earlier install's
  settings file gains it in place (install, `--check` and uninstall follow). `--check` counts a
  settings file whose server is registered but lacks an allow entry as a problem, whatever the
  answers say, with the remedy "run ./install.sh again with --mcp on". Running sessions see the new
  tool after `/mcp` reconnects the server, or a restart; the new instruction sentence reaches a
  session at its next SessionStart.
- Paste into the prompt (Jesse, 2026-11-06: "yes, build it: focus the pane, confirm focus, paste, no
  Enter, lead-in kept"). The answer sheet, one answer and the confluence are now pasted into the
  target's prompt instead of left on the clipboard. `nav.js` `stageIntoPrompt` writes the clipboard,
  runs `pane.focus`, then looks at Herdr's `focused()` every 50 ms for up to 600 ms and runs
  `terminal.paste` (the command behind ⌘V; no arguments) once the target terminal has had the focus,
  with no other terminal shown in its pane, on two looks in a row (100 ms at the earliest) and the
  clipboard still holds the same text. It pastes nothing into a terminal that is not live, runs no
  agent (a shell could run a pasted line) or whose agent waits on its own prompt (`blocked`, a
  permission menu), nor when the focus is not confirmed in time; the text then stays on the
  clipboard. Enter is never sent, and `hc keys`, `hc send` and `terminal.search` stay banned. The
  panel's `stage()` is the only caller and ignores a second click while a paste is pending.
- Words and the switch: the buttons read "Paste 2 answers into pane t3", "Paste answer", "Paste into
  trunk" and "Paste confluence again" (`words.js` `stageLabels`), and the status line says what
  happened (`stagedWords`): "Answer for Ask 2 pasted into the prompt in pane t3, not sent: add a word
  of your own, such as “My answer to A2:”, then press Enter.", with its own wording for each case
  that pasted nothing (not live, no agent, waiting on its own prompt, focus not confirmed, clipboard
  changed, an error). The lead-in stays (Claude Code presents a paste as possibly not the person's
  words), and the person sends the prompt. `ui.pasteIntoPrompt` (`config.js`, `ledgr_config.py`;
  default `true`, no installer question) set to `false` brings back clipboard plus focus and the old
  labels ("Copy answers", "Copy answer", "Send to trunk", "Copy confluence again"). Go to anchor,
  Copy for prompt, `/btw` and Ask for a conclusion stay clipboard plus focus.
- Paste tests and the live probe: `test_nav.mjs` 233 checks (the focus confirmed at once, late,
  flickering or never; another terminal shown in the pane; the clipboard changed; a look that throws;
  every case that pastes nothing; over every call, no `hc`, no Enter or line break in any argument,
  `terminal.paste` only without arguments); `test_no_keystrokes.py` 313 (`terminal.paste` only in
  `stageIntoPrompt`, after its focus check, reached only from the panel's `stage`;
  `terminal.paste_image` banned); `test_store.mjs` the default and the words. `herdr-app check`
  passes. Live, on throwaway panes: `pane.focus` returned in 15 ms, the focus was confirmed at 24 ms,
  `terminal.paste` succeeded and `hc read` showed the probe once, not submitted; a raw-byte probe
  received exactly `ESC[200~ … \n … ESC[201~`, so a line break stays inside the bracketed paste. A
  paste joins a draft already in the prompt (known and accepted: the person still presses Enter).
- Tests: store 478 checks (69 new: blocking while working, the fold rule, closed by the agent,
  answered then settled; 20 for the paste default and words), nav 233, no keystrokes 313, mcp 76,
  hooks 127, installer 69.

### ccdaa4f: who owns the closing list, declare by tool, honest profiles

- `asks.handoff` (`ledgr` default, `both`, `prose`; installer: "Who owns the closing list the agent
  gives you?", `--asks-handoff`, answers key `asks_handoff`): in `ledgr` mode the agent keeps blocking
  and needed items out of its prose and ends with one line, `ledgr: N items for you, M blocking`;
  `prose` injects nothing; a change reaches running sessions at their next prompt. `instruct_block`
  stays the master switch.
- The block has a readable bullet form (`- blocking · decide · text · "quote" · options: a | b`); the
  JSON array still parses, a block mixing both is rejected, malformed bullets are dropped with reasons.
  `bin/lib/parse_block.py` also reads the block written as a `<ledgr-asks>` line closed by a
  `</ledgr-asks>` line (seen live from Haiku). The extractor's `asks` event carries `block_form`
  (bullets, json or mixed) and `pointer` (the reply's `ledgr: N items for you` line).
- An MCP server (`mods/ledgr/bin/mcp/`, `declare_asks`, `open_asks`, `parked_questions`) lets an agent
  declare without printing a block; the writer labels such asks "declared by the agent (tool)" and
  the Stop hook settles them (quotes checked against the whole turn, message uuid). The installer
  offers to register it (`claude mcp add --scope user`) with three allow entries; `--check` and
  `uninstall.sh` follow, and both answers files (`setup/answers.example.json`,
  `examples/personal-overlay/answers.json`) set `mcp: true`. `--check` also tallies how the last
  turns' asks arrived (block, tool, model, skipped, failed) from `ledgr-data/log/hook.log`.
- Sessions name their Claude profile: `claude · work` for a Claude Code started with
  `CLAUDE_CONFIG_DIR=~/.claude-work`, `claude` for `~/.claude`, in the header, the session menu, the
  capture box and the branch manifest; Branch and Resume use the recorded config folder.
- The session menu says how each agent's asks arrive from the effective `asks.handoff`, and the asks
  lane head's "agent working" tooltip names the mode. The chip's tooltip says when its asks were
  declared by tool.
- The offline suite (`bin/tests/run-all.sh`) runs the MCP server's test (`test_mcp.py`); the installer
  test covers the handoff question and the MCP step (with a fake `claude`).
- `preview.png` retaken in authoritative mode from a real throwaway session (`docs/preview-recipe.md`
  rewritten). The exported design conversation stays local and gitignored (`docs/history/`, not in the
  repo). Docs audited against the code and the live install (README status, MCP section and full
  configuration table; RECIPE disclosure; the design spec's Section 11). The earlier sections of this
  file are headed by their commit hash, and 4f76521 got its section after the fact.

### 8d8a7e5: asks declared first, adapter contract, multi-config installer

- The agent-declared `ledgr-asks` block is the primary channel, the model extractor the fallback.
  `instruct_block` defaults on with a new, shorter instruction (blocking and needed items only, never
  suggestions or offers); a blocking ask the extractor found in a reply without a block puts the
  instruction into that session's next prompt once (`instruct_reinject`, default on).
- `mods/ledgr/bin/adapters/README.md` defines the adapter contract (identity, turn signal, instruction
  injection, turn text, optional fork and resume); `adapters/claude/adapter.json` is its manifest, and
  the session menu groups sessions by agent with "declares asks", "extractor only" or "no asks".
- The panel follows the focused pane across spaces and says "no ledgr session yet" for an agent pane
  the hooks have not reported, instead of keeping another session; pinning shows as a "pinned" pill.
- The owner's overlay uses the public `ledgr-pane`; `my-pane` is gone. `install.sh` retires a mod an
  earlier install deployed that the answers no longer want, and every JSON file it writes ends with a
  newline (a missing one in its own earlier write of `~/.claude/settings.json` is restored).
- `install.sh` hooks more than one Claude config: `~/.claude/settings.json` plus each other config
  folder it finds (`~/.claude-*`, `CLAUDE_CONFIG_DIR=` in `~/.local/bin` wrappers and shell start-up
  files) or is given (`--claude-settings` repeats; `claude_settings` in an answers file is a list),
  asked and consented per file; `--check` and `uninstall.sh` cover every file. Branch and Resume keep
  a session's `CLAUDE_CONFIG_DIR`; the session-name fallback reads that folder.
- The installer's offline test (`setup/tests/test_ledgr_setup.py`, scratch folders only). A first
  `preview.png` candidate (demo mode) and `docs/preview-recipe.md`.

### 4f76521: never send keystrokes

- Go to anchor no longer presses `ctrl+o /` in a Claude pane (`hc keys`): `ctrl+o` toggles Claude
  Code's transcript viewer, so the same keys could leave a pane in transcript mode. Every keystroke
  path (`hc keys`, `terminal.search`) is removed. Go to anchor opens the row's whole message with the
  passage marked, focuses the pane, copies a search slice, and says how to search by hand.
- Tests: `test_no_keystrokes.py` (no keystroke call anywhere in the mod source) and `test_nav.mjs`
  (copy and go-to produce only a clipboard write and `pane.focus`), both in `run-all.sh`. Disclosure
  updated.

### e14a347: packaging

- The `ledgr` mod installs on its own. A host view inside the mod (props `{view: "host"}`, a 96 px
  ledgr button beside the status bar, the tab bar, or floating) runs the writer, so no personal tab
  bar is needed and no engine copy either; `ledgr.toggle` shows and hides the panel. Writers elect
  one holder among hosts, take the role back from a panel fallback or a holder that stopped
  answering, and release it on close. `herdr-app check` no longer claims or pings.
- The pane-header chip moved to an optional mod, `ledgr-pane` (a clone of Herdr's `pane` 0.1.13).
- The owner's tab bar (`my-tabs`) and pane header (`my-pane`) moved to `examples/personal-overlay/`
  as an example integration; the installer deploys an overlay as one answer to the host and chip
  questions.
- Where the panel lives is configurable (`config.json` `ui.panel`), published to the chip and host.
- `install.sh` rewritten: preflight, questions with reasons and current values as defaults, `--yes`
  with an answers file, a flag per question, Keychain storage of the key through stdin, key-clash
  detection, layout patching that never edits a shipped layout (clone first), hook entries printed
  before they are written, `herdr-app check` and offline tests, a summary. `--check` is a doctor.
  `uninstall.sh` saves the current answers, restores the pre-ledgr files where only ledgr's entries
  differ, removes only ledgr's entries otherwise, keeps `ledgr-data/` unless asked, never touches the
  Keychain item.
- Hooks and tests find python3 (Homebrew, `/usr/local`, system, or `LEDGR_PYTHON`; 3.9+) and the data
  folder beside the mods folder they are installed in, instead of fixed paths.
- `RECIPE.md` moved to the repo root in the manual's six-part order with a disclosure; README,
  LICENSE (MIT), this changelog, `keys.json` at the root, layout snippets in `setup/`; build notes
  moved to `docs/build-notes/`; demo and test fixtures made generic.

### 1f86586: ask severity and threshold, user-owned fold, animations, polish

- Every ask has one level (blocking, needed, optional) with a decision order and a politeness rule in
  the extraction prompt; status lines are never asks. A threshold menu on the lane head writes
  `extract.threshold`; asks below it fold and do not count; blocking asks sort first and give the
  chip its own state.
- The asks lane's fold is the person's alone (`ui.foldAsksWhileWorking` restores the old rule).
- Motion only on state changes (row enter and leave, answered glow, chip pulse); `ui.animations`.
- Names in words (Ask 9, Question 1, pane t3), Resume session when a terminal is gone, the whole
  message at full height, a smaller action row (Done, Defer menu, overflow menu); new extraction
  fixtures for mixed levels, polite blockers, closers, verification and pure status.

### e7c177d: panel layout fixes; per-item Copy answer

- Ask text no longer cut at a 34 px cap; meta on its own line, text and options wrap at full width;
  one indent constant and looser spacing; preview boxes scroll.
- Demo cases for a 600-character ask, a 120-character token, a long URL and a long option.
- Copy answer per ask, with the same marker and landing detection as Copy answers.

### 1849c0f: research, design, and phases 1 to 3

- Phase 1: identity map through Claude Code hooks, ⌘J park, the two-lane panel, the pane-header chip,
  Haiku extraction of the agent's asks at Stop.
- Phase 2: Branch a parked question into a forked session with lineage, a context manifest, a depth
  cap, and placement beside the trunk.
- Phase 3: the Conclude editor, the clipboard-staged confluence detected by the UserPromptSubmit hook,
  `decisions.md`, Close branch, the answer sheet.
- The deep-research report and notes, the build spec with its deviations log, an outside critique.
