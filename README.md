# ledgr

A [Herdr](https://herdr.dev) mod for long conversations with coding agents.

- Park a question with ⌘J while the agent is still writing; it waits in a side panel, anchored to the passage it came from.
- At the end of every turn, the things the agent asked of you (decide, confirm, do, provide, review) land in a second lane, each marked blocking, needed or optional.
- A small ledgr button and an optional chip in each pane header count what is open, so nothing scrolls away.
- Branch a parked question into its own forked Claude Code session, with an honest list of what the fork knows.
- Bring the branch's one approved answer back to the end of the main conversation; ledgr notices it land and closes the question.

![ledgr](preview.png)

## Requirements

- Herdr 0.1.13 or newer, on macOS.
- Claude Code (the hooks are written for it; 2.1.311 when this was built). Other agents get the parked-questions lane but no asks yet.
- python3 3.9 or newer (Homebrew's, `/usr/local/bin`'s or the system's; `LEDGR_PYTHON` picks another). Standard library only.
- The macOS Keychain (`/usr/bin/security`) for the extraction provider's API key, unless you choose `cli` or `none`.
- Optional: Node, for one offline store test.

## Install

From a clone of this repo:

```sh
./install.sh
```

It checks your setup first (Herdr home and version, which layouts are Herdr's own and which are yours, Claude Code, python3, `security`, an existing ledgr, keys that would clash), then asks each question with a one-line reason, defaults in brackets: the extraction provider and its key (typed hidden, stored in the Keychain), the threshold, animations, the asks fold, which personal layout gets the panel (it offers to clone a shipped layout first; Herdr's own are read-only), where the panel and the host button go, the optional pane-header chip, the two keys (with clash detection), and the exact Claude Code hook entries it will add. Nothing is written until you confirm the plan. Then it deploys, runs `herdr-app check` on every mod it touched and the offline tests, and prints what changed, where the backups are, and the keys to try.

- No questions: `./install.sh --yes --answers ledgr.install.json` (every key is optional; see `setup/answers.example.json`). With `--yes` an API key comes only from `LEDGR_API_KEY`.
- Every question also has a flag: `./install.sh --help`. `--claude-settings FILE` repeats, one per Claude config folder (the answers key `claude_settings` is a list).
- Run it again any time: it is idempotent and shows what is installed as the defaults.
- The doctor: `./install.sh --check` (hooks registered and firing, which copy holds the writer role, the Keychain item, engine copies, checks).
- Remove it: `./uninstall.sh`. It first saves your choices to `~/.local/state/ledgr/last-install.json` (reinstall with `./install.sh --yes --answers ~/.local/state/ledgr/last-install.json`), restores the files saved before ledgr first touched them where only ledgr's entries differ, removes ledgr's entries alone where something else changed since, asks separately before deleting `ledgr-data/`, and never deletes the Keychain item.

**With an agent.** Ask your agent to add this mod to Herdr. Following Herdr's manual it reads `RECIPE.md` and every file, tells you what the mod touches (below), and then either runs `./install.sh --yes --answers …` with your answers or does the same steps by hand: copy `mods/ledgr/` (and `mods/ledgr-pane/`) into `~/.config/herdr-app/mods/`, merge `keys.json` asking before replacing a key you use, add the blocks from `setup/layout-blocks.json` to one of your own layouts, add the three hook entries to `~/.claude/settings.json`, store the key with `security add-generic-password -s ledgr -a anthropic -w`, and run `herdr-app check` on each mod.

## Keys

| Key | Where | Does |
|---|---|---|
| ⌘J | anywhere | park a question (opens the capture box over the agent) |
| ⌘⇧J | anywhere | show or hide the ledgr panel |
| ⏎ | capture box | park it |
| ⌘⏎ | capture box | park it and copy `/btw About "<quote>": <question>` for the agent |
| ⇥ / ⇧⇥ | capture box | move between the question and the quote |
| Esc | capture box | cancel |

The installer offers free alternatives when ⌘J or ⌘⇧J is taken.

## How asks are found

1. **Declared, the primary channel.** Each Claude Code session gets a short instruction (about 120 words, at start and after `/clear` or `/compact`): when something blocks the agent, or needs you to decide or act before the work is truly done, it ends the reply with a fenced `ledgr-asks` block, one JSON object per item with its level. ledgr reads the block when the turn ends; no model call is made. The agent says what it needs instead of ledgr guessing.
2. **Extracted, the fallback.** A reply without a block goes to the extraction provider (Claude Haiku by default), which lists what the reply asks of you. When it finds a blocking ask the agent did not declare, that session's next prompt carries the instruction once more.
3. **One threshold for both.** `extract.threshold` decides which levels are open rows and count; asks below it are kept, folded as suggestions.

Other agents need an adapter: something that gets the instruction into that engine's context and reports its turns (`mods/ledgr/bin/adapters/README.md`). A session without one gets the parked-questions lane only; the session menu says which each agent has (declares asks, extractor only, no asks).

## Configuration

`~/.config/herdr-app/ledgr-data/config.json` (the installer writes it; edits apply within a second, no restart):

| Key | Values | Default |
|---|---|---|
| `extract.threshold` | `blocking`, `needed`, `optional`: which asks are open rows and count; lower ones fold as suggestions (also on the lane head's menu) | `needed` |
| `extract.provider` | `anthropic`, `openai-compatible` (with `extract.base_url`), `cli` (`claude -p` on your subscription, untested end to end) | `anthropic` |
| `extract.model` | the provider's model id | `claude-haiku-5-5` |
| `extract.mode` | `block-first`, `always-model`, `block-only` (provider `none` in the installer) | `block-first` |
| `instruct_block` | the agent declares its asks in a `ledgr-asks` block (the primary channel; a ~120-word instruction in the session's context at start, `/clear` and `/compact`) | `true` |
| `instruct_reinject` | with `instruct_block`: after a turn whose blocking ask only the extractor found, the instruction once more at that session's next prompt | `true` |
| `ui.animations` | rows fade, the chip pulses; `false` stops all motion | `true` |
| `ui.foldAsksWhileWorking` | fold the asks lane while the agent works | `false` |
| `ui.panel` | the layout ids the panel lives in: `{column, stack, child}` | `panel` / `panel-body` / `ledgr` |
| `branch.maxDepth` | how deep branches of branches may go | `2` |

## Branching and confluence

**Branching.** Branch… on a parked question forks the conversation (`claude --resume <id> --fork-session`) into a new pane beside it, with a preamble that tells the fork which question it exists to answer. Before you launch, a manifest says what the fork knows and does not know: the fork is taken at the end of the session, so it also sees the turns after the question's anchor, and it shares the folder unless you isolate it in a git worktree. Branches of branches stop at `branch.maxDepth`.

**Confluence.** When the branch has its answer, Conclude… opens an editor prefilled with the branch's conclusion, and Send to trunk puts one message on the clipboard (a marker line, the question, your edited conclusion, and a closing line in your voice) and focuses the main conversation. You paste it and send it yourself; nothing is typed for you. The main session's hook sees the marker arrive, resolves the question as answered by the branch, and writes one line to that session's `decisions.md`; Close branch then ends the branch's terminal.

## What this mod touches

- **Claude Code hooks:** three entries (SessionStart, UserPromptSubmit, Stop) in each Claude settings file you choose: `~/.claude/settings.json`, and the settings.json of any other Claude config folder (a Claude Code started with `CLAUDE_CONFIG_DIR`, such as a second account; the installer lists the ones it finds and asks) that run `mods/ledgr/bin/adapters/claude/*.sh`. They do nothing outside a Herdr terminal. Their only output into the model's context is the ledgr-asks instruction (about 120 words): at session start, after `/clear` and `/compact`, and once at the next prompt after a turn whose blocking ask the agent did not declare (`instruct_block`, `instruct_reinject`; both on by default).
- **The Claude config folders:** the hooks read the session's transcript (the path Claude Code gives them) for the turn's last message; the installer edits the chosen `settings.json` files (after a backup). Nothing else.
- **Network:** one call per finished turn to the extraction provider you chose (the Anthropic API by default), carrying that turn's last assistant message and the session's open asks. None with provider `none`, or when the agent wrote a `ledgr-asks` block.
- **Keychain:** the API key, service `ledgr`, account = provider, read at each call; never on disk.
- **Programs:** `hc read`, `hc run … claude --resume …` for branches and Resume session, `hc kill`/`hc rm` when you close a branch, `git rev-parse`, `which claude`, the extractor's retry script; the hooks run `python3`, `security` and `curl`.
- **Clipboard and focus:** the clipboard is read when the capture box opens (to offer the copied passage as a quote) and written when you copy answers, a `/btw`, a branch's answer or an anchor slice; those actions also focus the agent's pane. That is all the mod does to a terminal.
- **Files:** only under the Herdr home: `ledgr-data/` and the mod's folders. Install state and backups in `~/.local/state/ledgr/`.
- **Never:** sends keystrokes to a terminal (no `hc keys`, no `hc send`: nothing is typed into an agent's prompt and Enter is never pressed; a test checks the source), calls anything but the one provider, or touches other applications.

## Repository

```
mods/ledgr/             the mod (panel, capture box, host button, writer, Python hooks in bin/)
mods/ledgr/bin/adapters/   the adapter contract (README.md) and the Claude Code adapter
mods/ledgr-pane/        optional: Herdr's pane header plus the ledgr chip
keys.json               the keys the mod expects (merged into yours)
RECIPE.md               the brief Herdr's manual asks for: what you see, how it behaves, built from, watch out, done when
setup/                  the installer (ledgr_setup.py), answers example, layout snippets
examples/personal-overlay/   an example integration: the owner's personal tab bar, which hosts the writer
docs/                   research, design, reviews, build notes, publishing-requirements.md
install.sh, uninstall.sh, sync-from-live.sh
```

## License

MIT, see `LICENSE`.
