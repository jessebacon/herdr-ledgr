# ledgr

A [Herdr](https://herdr.dev) mod for long conversations with coding agents.

- Park a question with ⌘J while the agent is still writing; it waits in a side panel, anchored to the passage it came from.
- Pin a passage with ⌘J, then ⌘S, before you have a question: it is kept verbatim for good, searchable across every session, and becomes the context of a question you ask later.
- At the end of every turn, the things the agent asked of you (decide, confirm, do, provide, review) land in a second lane, each marked blocking, needed or optional.
- A small ledgr button and an optional chip in each pane header count what is open, so nothing scrolls away.
- Branch a parked question into its own forked Claude Code session, with an honest list of what the fork knows.
- Bring the branch's one approved answer back to the end of the main conversation; ledgr notices it land and closes the question.

![ledgr](preview.png)

## Status

0.1.0, not yet released. Built on Herdr 0.1.13, hc 0.1.18 and Claude Code 2.1.311, on macOS.

| Part | State |
|---|---|
| Phase 1: the two lanes, ⌘J park, the chip, asks at the end of every turn | shipped 2026-11-05 |
| Phase 2: Branch a parked question into a forked session, with its manifest | shipped 2026-11-05 |
| Phase 3: confluence (the branch's answer back to the trunk) and the answer sheet | shipped 2026-11-05 |
| The MCP server: agents declare asks by tool instead of a block, and close the ones you answered | built 2026-11-06, optional at install |
| Off per space, Clear all questions, a blank line after each paste | built 2026-11-07 |
| Pins: passages kept verbatim, searched across sessions, asked about in the trunk or a branch | built 2026-11-07, not yet tried live |
| Providers `openai-compatible` and `cli`; adapters for agents other than Claude Code | built (providers) or sketched (adapters), not tested end to end |

## Requirements

- Herdr 0.1.13 or newer, on macOS.
- Claude Code (the hooks are written for it; 2.1.311 when this was built). Other agents get the parked-questions lane but no asks yet.
- python3 3.9 or newer (Homebrew's, `/usr/local/bin`'s or the system's; `LEDGR_PYTHON` picks another). Standard library only.
- The macOS Keychain (`/usr/bin/security`) for the extraction provider's API key, unless you choose `cli` or `none`.
- Optional: Node, for one offline store test.

## Install

From a clone of this repo:

```sh
git clone https://github.com/jessebacon/herdr-ledgr.git && cd herdr-ledgr
./install.sh
```

It checks your setup first (Herdr home and version, which layouts are Herdr's own and which are yours, Claude Code, python3, `security`, an existing ledgr, keys that would clash), then asks each question with a one-line reason, defaults in brackets: whether to hook Claude Code and which Claude settings files (one per config folder it finds), the extraction provider and its key (typed hidden, stored in the Keychain), who owns the closing list (`asks.handoff`), the threshold, animations, the asks fold, which personal layout gets the panel (it offers to clone a shipped layout first; Herdr's own are read-only), where the panel and the host button go, the optional pane-header chip, the two keys (with clash detection), the exact Claude Code hook entries it will add, and whether to register ledgr's MCP server (the exact `claude mcp add` command and allow entries, per config folder). Nothing is written until you confirm the plan. Then it deploys, runs `herdr-app check` on every mod it touched and the offline tests, and prints what changed, where the backups are, and the keys to try.

- No questions: `./install.sh --yes --answers ledgr.install.json` (every key is optional; see `setup/answers.example.json`). With `--yes` an API key comes only from `LEDGR_API_KEY`.
- Every question also has a flag: `./install.sh --help`. `--claude-settings FILE` repeats, one per Claude config folder (the answers key `claude_settings` is a list).
- Run it again any time: it is idempotent and shows what is installed as the defaults.
- The doctor: `./install.sh --check` (hooks registered and firing, which copy holds the writer role, the Keychain item, engine copies, checks).
- Remove it: `./uninstall.sh`. It first saves your choices to `~/.local/state/ledgr/last-install.json` (reinstall with `./install.sh --yes --answers ~/.local/state/ledgr/last-install.json`), restores the files saved before ledgr first touched them where only ledgr's entries differ, removes ledgr's entries alone where something else changed since, asks separately before deleting `ledgr-data/`, and never deletes the Keychain item.

**With an agent.** Ask your agent to add this mod to Herdr. Following Herdr's manual it reads `RECIPE.md` and every file, tells you what the mod touches (below), and then either runs `./install.sh --yes --answers …` with your answers or does the same steps by hand: copy `mods/ledgr/` (and `mods/ledgr-pane/`) into `~/.config/herdr-app/mods/`, merge `keys.json` asking before replacing a key you use, add the blocks from `setup/layout-blocks.json` to one of your own layouts, add the three hook entries to `~/.claude/settings.json` (and to each other Claude config folder's settings.json you use), optionally register the MCP server (below), store the key with `security add-generic-password -s ledgr -a anthropic -w`, and run `herdr-app check` on each mod.

## Keys

| Key | Where | Does |
|---|---|---|
| ⌘J | anywhere | park a question (opens the capture box over the agent) |
| ⌘⇧J | anywhere | show or hide the ledgr panel |
| ⏎ | capture box | park it |
| ⌘⏎ | capture box | park it and copy `/btw About "<quote>": <question>` for the agent |
| ⌘S | capture box | pin the copied passage; the line you typed becomes its note |
| ⇥ / ⇧⇥ | capture box | move between the question and the quote |
| Esc | capture box | cancel |

The installer offers free alternatives when ⌘J or ⌘⇧J is taken. ⌘S lives in the box's own key section (`mod:ledgr`), so it pins only while the box is open; no Herdr section binds it (Herdr's picker and palette keep their own keys).

## How asks are found

1. **Declared, the primary channel.** Each Claude Code session gets a short instruction (about 250 words, at start and after `/clear` or `/compact`; its wording follows `asks.handoff`): when something blocks the agent, or needs you to decide or act before the work is truly done, it calls ledgr's `declare_asks` tool when the MCP server is registered, else ends the reply with a fenced `ledgr-asks` block, one line per item (`- blocking · decide · Choose the template · options: compact | detailed`; a JSON array is read too). In the default mode its prose then ends with one line, `ledgr: 2 items for you, 1 blocking`, and lists nothing. ledgr reads the declaration when the turn ends; no model call is made. The agent says what it needs instead of ledgr guessing.
2. **Extracted, the fallback.** A reply with no declaration (no `declare_asks` call that turn, no valid non-empty block) goes to the extraction provider (Claude Haiku by default), which lists what the reply asks of you. When it finds a blocking ask the agent did not declare, that session's next prompt carries the instruction once more.
3. **One threshold for both.** `extract.threshold` decides which levels are open rows and count; asks below it are kept, folded as suggestions.

An open blocking ask keeps the chip red while the agent works, and its turn stays unfolded in the panel until you fold it. To answer from the panel, type an answer or pick an option on an ask, then Paste answer (or Paste N answers for the whole turn): ledgr pastes the answer sheet into that agent's prompt once its pane has the focus and does not send it; add a word of your own and press Enter. Every pasted message ends with an empty line, so a second paste into the same prompt starts on its own line, and each one lands. You rarely need Done for an ask you answered in your prompt: the agent closes it with `resolve_asks` when the MCP server is registered ("closed by the agent"), and an ask you answered with an `[A5]` ref or the answer sheet closes by itself at the end of that turn unless the reply asks it again ("answered by you"). Done stays yours, and Reopen brings any of them back.

Other agents need an adapter: something that gets the instruction into that engine's context and reports its turns (`mods/ledgr/bin/adapters/README.md`). A session without one gets the parked-questions lane only; the session menu says which each agent has (declares asks, extractor only, no asks).

## The MCP server

`mods/ledgr/bin/mcp/ledgr_mcp.py` is a small stdio MCP server (Python standard library) that lets an agent declare its asks with a tool call instead of printing a block on the terminal's last screen. It offers four tools: `declare_asks` (record this turn's blocking and needed items; it returns the pointer line the reply ends with), `resolve_asks` (close the asks your latest message answered or dropped, by handle; the instruction tells the agent to call it before declaring anything new), `open_asks` (this session's open asks, with handles such as `A7`) and `parked_questions` (the questions you released to the agent; the panel has no release action yet, so it returns an empty list for now). The Stop hook settles a tool declaration at the end of the turn: quotes are checked against the turn's text and no model call is made.

The installer asks whether to register it, and then runs `claude mcp add --scope user --transport stdio ledgr -- <python3> -I -B ~/.config/herdr-app/mods/ledgr/bin/mcp/ledgr_mcp.py` once per chosen Claude config folder (with `CLAUDE_CONFIG_DIR` set for a folder other than `~/.claude`) and adds the four `mcp__ledgr__*` allow entries to that folder's settings file. `./install.sh --check` shows whether each folder has both, and flags a folder from an earlier install that lacks `mcp__ledgr__resolve_asks` (run `./install.sh` again with `--mcp on`, then `/mcp` or a restart in running sessions); `./uninstall.sh` removes both. Without it the instruction falls back to the fenced block. Details, including registering by hand: `mods/ledgr/bin/mcp/README.md`.

## Parked questions and spaces

**Clear all.** The YOUR QUESTIONS head shows Clear N while the shown session has open or deferred parked questions. The first click asks "Clear 3 questions? 1 branched kept", the second closes them: each moves to Closed as "cleared" and can be reopened there. A question with a branch, or with its branch's answer on the way back, always stays.

**Off in a space.** The session menu's first row turns ledgr off in the focused pane's Herdr space ("ledgr off in this space", with its name), and on again. There the agents get no instruction and no extraction (one that had the instruction is told once to ignore it and to list what it needs in its reply as usual; the MCP server records nothing), the pane has no chip, ⌘J parks nothing, and the panel shows "ledgr is off in this space" with a button to turn it on. Items recorded before are kept and come back. The switch is stored by space id in `spaces.disabled`, so renaming a space keeps it.

## Pins

A pin is a passage of an agent's reply that you keep before you have a question about it. It keeps the passage word for word (line breaks too, up to 4,000 characters), your one-line note, the turn it came from and the session's name, folder and agent, so it outlives the session in the panel (Forget keeps pins) and the transcript (Claude Code deletes old ones). Nothing removes a pin but you.

**Taking one.** Select the passage in the agent's pane (fullscreen Claude copies a selection), press ⌘J, type a note if you like, then ⌘S. ledgr looks for the passage in the session's saved replies, then on its screen; found nowhere, it says so, and a second ⌘S within 5 seconds pins it marked "unverified". Pinning the same passage again does not make a second pin.

**The PINS lane.** The first lane of the panel lists the shown session's pins, newest first: five, then "N more", and "archived (N)" at the bottom. Each pin shows its passage, note, turn and age, and where it was used ("answered in Question 3 (turn 14)"). Open one for Ask here…, Branch…, Note, Copy (the passage quoted with where it came from, on the clipboard), and in ⋯ Go to anchor and Archive. An archived pin can be restored, or deleted with two clicks.

**Search.** The box in the lane's head searches every session's pins as you type: each word (or "quoted phrase") must appear in the passage, the note, the session's name, repo or folder; newest first, grouped by session, with "archived too" and "this session only" switches. Pins of a forgotten session are still found, under its name.

**Ask here.** Check up to 12 pins, from any sessions, and click Ask about these… (or Ask here… on one pin): type your question in the box and press Enter, and it is parked with the pins. Its Ask here button then pastes one message into the session's prompt: a marker line, your question, each pin quoted line by line with where it came from (a pin from another session is marked as not written in this conversation), and a closing line in your voice. Nothing is sent: add a word and press Enter. ledgr notices the prompt, marks the question sent, and when the reply ends records on each pin that it was answered.

**Ask in a branch.** Branch… on a pin, or on a question with pins, forks the session as usual; the fork's first prompt quotes the pins verbatim and asks for one line per pin in its conclusion, and the manifest says how many pins it is given. Over 24,000 pinned characters the branch is refused (ask here instead, or attach fewer). Conclude… prefills one entry per pin when the branch wrote no conclusion block, and once the confluence lands each pin records the branch that answered it.

Agents do not see your pins: no MCP tool reads them yet, and they never reach the extractor.

## Configuration

`~/.config/herdr-app/ledgr-data/config.json` (the installer writes it; edits apply within a second, no restart):

| Key | Values | Default |
|---|---|---|
| `extract.threshold` | `blocking`, `needed`, `optional`: which asks are open rows and count; lower ones fold as suggestions (also on the lane head's menu) | `needed` |
| `extract.provider` | `anthropic`, `openai-compatible` (with `extract.base_url`), `cli` (`claude -p` on your subscription, untested end to end) | `anthropic` |
| `extract.model` | the provider's model id | `claude-haiku-5-5` |
| `extract.mode` | `block-first`, `always-model`, `block-only` (provider `none` in the installer) | `block-first` |
| `extract.base_url` | `openai-compatible` only: the server's base URL, such as `http://localhost:11434/v1` | `null` |
| `extract.timeout_s` | seconds before a provider call gives up | `20` |
| `extract.max_chars` | the most characters of a reply sent to the provider (the end is kept) | `60000` |
| `extract.cli_fallback` | with provider `anthropic` and no key in the Keychain, use `cli` (`claude -p`) instead of failing with "no credential" | `false` |
| `extract.audit_rate` | the share of turns (0 to 1) with a valid `ledgr-asks` block that also go to the provider, to compare the two in `ledgr-data/log/extract-audit.jsonl`; each is one more network call (tool declarations are never audited) | `0` |
| `asks.handoff` | who owns the closing list the agent gives you. `ledgr`: the agent keeps blocking and needed items out of its reply, declares them (with the `declare_asks` tool when the MCP server is registered, else one per line in a `ledgr-asks` block) and ends its prose with one line, `ledgr: 3 items for you, 1 blocking`; the list lives in the panel. `both`: the reply lists them as usual and the block declares them too. `prose`: no instruction at all, the extractor reads each reply. A ~260-word (`ledgr`) or ~200-word (`both`) instruction in the session's context at start, `/clear` and `/compact`; a change reaches running sessions at their next prompt. The installer asks: "Who owns the closing list the agent gives you?" | `ledgr` |
| `instruct_block` | the master switch for the instruction, kept for compatibility: `false` is `asks.handoff: prose` whatever that says (the installer writes it from the handoff answer) | `true` |
| `instruct_reinject` | with an instruction on: after a turn whose blocking ask only the extractor found, the mode's wording once more at that session's next prompt | `true` |
| `ui.animations` | rows fade, the chip pulses; `false` stops all motion | `true` |
| `ui.foldAsksWhileWorking` | fold the asks lane while the agent works | `false` |
| `ui.pasteIntoPrompt` | Paste answers, Paste answer and Paste into trunk paste the message into the agent's prompt once its pane has the focus (Herdr's `terminal.paste`), never pressing Enter; nothing is pasted into a plain shell or an agent waiting on its own prompt. `false`: they only copy it and focus the pane (Copy answers, Copy answer, Send to trunk), and you paste. The installer does not ask | `true` |
| `ui.panel` | the layout ids the panel lives in: `{column, stack, child}` | `panel` / `panel-body` / `ledgr` |
| `branch.maxDepth` | how deep branches of branches may go (`0` turns Branch off) | `2` |
| `spaces.disabled` | the Herdr space ids where ledgr is off: no instruction or extraction for a session there, no chip, no ⌘J, the panel says so; items are kept. The session menu writes it; a value here replaces the list whole | `[]` |
| `surface.openPanelOnAsks` | show the panel when a turn ends with new asks and it is hidden | `false` |
| `retention_days` | closed items older than this move from `store.json` to `ledgr-data/archive/<yyyy-mm>.jsonl` (checked once a day) | `14` |
| `v` | the file's format version | `1` |

Pins add no key here. Their limits are constants in `mods/ledgr/config.js` `LIMITS`: a passage of at most 4,000 characters, a note of 200, 12 pins per question, 24,000 pinned characters in a branch's first prompt, 200 search results.

## Branching and confluence

**Branching.** Branch… on a parked question forks the conversation (`claude --resume <id> --fork-session`) into a new pane beside it, with a preamble that tells the fork which question it exists to answer. Before you launch, a manifest says what the fork knows and does not know: the fork is taken at the end of the session, so it also sees the turns after the question's anchor, and it shares the folder unless you isolate it in a git worktree. Branches of branches stop at `branch.maxDepth`.

**Confluence.** When the branch has its answer, Conclude… opens an editor prefilled with the branch's conclusion, and Paste into trunk puts one message (a marker line, the question, your edited conclusion, and a closing line in your voice) into the main conversation's prompt once its pane has the focus. ledgr pastes it and never presses Enter: add a word of your own (the panel suggests one, such as "Adopt this branch result for Q1:") and send it yourself. If the focus does not arrive, or the main session waits on its own prompt, the message stays on the clipboard for ⌘V. The main session's hook sees the marker arrive, resolves the question as answered by the branch, and writes one line to that session's `decisions.md`; Close branch then ends the branch's terminal.

## What this mod touches

- **Claude Code MCP server (optional, asked):** `claude mcp add --scope user --transport stdio ledgr -- <python3> -I -B ~/.config/herdr-app/mods/ledgr/bin/mcp/ledgr_mcp.py` per chosen config folder, and four allow entries (`mcp__ledgr__declare_asks`, `mcp__ledgr__open_asks`, `mcp__ledgr__parked_questions`, `mcp__ledgr__resolve_asks`) in that folder's settings file. The server offers its tools only inside a Herdr terminal, writes only `ledgr-data/`, and makes no network call. With `--yes` it is registered only when the answers (`"mcp": true`) or `--mcp on` say so, or kept when it is registered already; `./install.sh --check` prints the command for any folder that lacks it. Details: `mods/ledgr/bin/mcp/README.md`.
- **Claude Code hooks:** three entries (SessionStart, UserPromptSubmit, Stop) in each Claude settings file you choose: `~/.claude/settings.json`, and the settings.json of any other Claude config folder (a Claude Code started with `CLAUDE_CONFIG_DIR`, such as a second account; the installer lists the ones it finds and asks) that run `mods/ledgr/bin/adapters/claude/*.sh`. They do nothing outside a Herdr terminal. Their only output into the model's context is the ledgr-asks instruction for the `asks.handoff` mode (about 200 to 260 words; none in `prose`): at session start, after `/clear` and `/compact`, once at the next prompt after a turn whose blocking ask the agent did not declare (`instruct_reinject`), and once after you change the mode. In a space where ledgr is off they print nothing, except three lines telling a session that had the instruction to ignore it (once, when the space is turned off).
- **The Claude config folders:** the hooks read the session's transcript (the path Claude Code gives them) for the turn's text, and `<config>/sessions/<pid>.json` for a session name; the installer edits the chosen `settings.json` files (after a backup), and `claude mcp add` writes that folder's `.claude.json` (`~/.claude.json` for the default folder) when you register the MCP server. To find the folders, the installer reads `~/.claude-*`, the wrappers in `~/.local/bin` and your shell start-up files. Nothing else.
- **Network:** one call per finished turn to the extraction provider you chose (the Anthropic API by default), carrying that turn's last assistant message and the session's open asks. None with provider `none`, or when the agent declared its asks (the `declare_asks` tool, or a valid `ledgr-asks` block unless `extract.audit_rate` is above 0).
- **Keychain:** the API key, service `ledgr`, account = provider, read at each call; never on disk.
- **Programs:** `hc read`, `hc run … claude --resume …` for branches and Resume session, `hc kill`/`hc rm` when you close a branch, `git rev-parse`, `which claude`, the extractor's retry script; the hooks run `python3`, `security`, `curl`, and `hc get <terminal> --json` (read only, at session start and each prompt, for the terminal's space); Claude Code starts the MCP server (`python3`) with each session of a folder that registered it; the installer runs `herdr-app` (checks, `layout.clone`), `python3` and `claude --version` (preflight), `security` (to store the key), the offline tests, and `claude mcp add` / `claude mcp remove` only for the MCP server you chose.
- **Clipboard, focus and one paste:** the clipboard is read when the capture box opens (to offer the copied passage as a quote, or to pin it with ⌘S; `hc read` then checks it against the agent's screen) and before a paste (to check it still holds ledgr's text), and written when you paste answers, a branch's answer, a question with its pins, a `/btw` or an anchor slice; those actions also focus the agent's pane. A pin's Copy only writes the clipboard. Paste answers, Paste answer, Paste into trunk and Ask here then run Herdr's `terminal.paste` (what ⌘V runs) once Herdr reports that terminal focused: the text lands in the prompt and is not sent, never in a plain shell or an agent waiting on its own prompt (`ui.pasteIntoPrompt: false` turns this off). That is all the mod does to a terminal.
- **Files:** only under the Herdr home: `ledgr-data/` and the mod's folders. Install state and backups in `~/.local/state/ledgr/`.
- **Never:** sends keystrokes to a terminal (no `hc keys`, no `hc send`, no Enter: the one paste above waits in the prompt until you send it; a test checks the source), calls anything but the one provider, or touches other applications.

## Repository

```
mods/ledgr/             the mod (panel, capture box, host button, writer, Python hooks in bin/)
mods/ledgr/bin/adapters/   the adapter contract (README.md) and the Claude Code adapter
mods/ledgr/bin/mcp/     the MCP server (declare_asks, resolve_asks, open_asks, parked_questions) and its README
mods/ledgr-pane/        optional: Herdr's pane header plus the ledgr chip
keys.json               the keys the mod expects (merged into yours)
RECIPE.md               the brief Herdr's manual asks for: what you see, how it behaves, built from, watch out, done when
setup/                  the installer (ledgr_setup.py), answers example, layout snippets
examples/personal-overlay/   an example integration: the owner's personal tab bar, which hosts the writer
docs/                   research, design, reviews, build notes, publishing-requirements.md
install.sh, uninstall.sh, sync-from-live.sh
```

How it came to be: the research report (`docs/research/`), the build spec with every deviation in its Section 11 (`docs/design/`), the outside critique (`docs/reviews/`), and the builders' notes (`docs/build-notes/`). Changes by release: `CHANGELOG.md`.

## License

MIT, see `LICENSE`.
