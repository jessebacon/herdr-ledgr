# ledgr

A Herdr desktop-app mod that puts a two-direction request ledger beside a linear agent conversation: questions you park while the agent is still talking, and asks the agent makes of you, both held outside the transcript and anchored to the passage they came from. Phase 2 adds a Branch action that forks a parked question into its own session with an honest manifest of what the branch knows. Phase 3 adds the rejoin ("confluence"): one approved message carried back to the end of the trunk.

Thesis in one line: keep a linear trunk, make non-linearity cheap and visible around it, and let a branch return its result, never its transcript.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Identity map (terminal to session), two-lane ledger, `cmd-j` park, chip in the pane header, Haiku extraction of agent asks at end of turn | Shipped 2026-11-05, live |
| 2 | Branch a parked question into a forked Claude Code session, lineage, context manifest, depth cap | Shipped 2026-11-05, live |
| 3 | Confluence: Conclude editor, one human-approved message staged on the clipboard for the end of the trunk; the trunk's UserPromptSubmit hook detects it landing, resolves the parked question, records decisions.md; Close branch; answer sheet lands the same way | Shipped 2026-11-05, live |
| later | MCP stdio server as a third spool producer (structured asks by protocol, identity for any MCP-capable agent); OpenAI-compatible and CLI providers tested live; branch map view | Planned |

## The one rule that matters

**This repo is the source of truth. The live install is a copy.** Edit here, then run `./install.sh`. Never edit `~/.config/herdr-app/mods/ledgr`, `mods/my-pane` or `mods/my-tabs` in place. If an agent did edit the live copy (it happens during a build), run `./sync-from-live.sh` once to pull the changes back, review the diff, and go back to editing here.

Why a copy and not a symlink: Herdr refuses any import that resolves outside a mod's own folder, symlinks included, and the Claude Code hooks are registered in `~/.claude/settings.json` against the installed path.

## Repo layout

```
mods/ledgr/            the mod: panel, capture, store, spool, writer, branch, nav, config, fixtures
mods/ledgr/bin/        Python core + hooks (no Node): lib/, adapters/claude/, providers/, tests/
mods/my-pane/          clone of Herdr's shipped `pane` mod plus the ledgr chip in the header
mods/my-tabs/          Jesse's personal tab bar; hosts the always-on ledgr WRITER (see below)
setup/                 reference copies of ~/.config/herdr-app/keys.json and layouts/custom.json
docs/research/         the deep-research report and its six note files
docs/design/           the build spec ("Herdr ledger mod design.md"); Section 11 lists every deviation
docs/reviews/          outside critiques that changed the design
install.sh             repo -> live install, engine copies, hook registration, checks
sync-from-live.sh      live install -> repo (one-time pull after an in-place build)
```

Build notes written by the builders live next to the code: `mods/ledgr/BUILD-NOTES-mod.md`, `mods/ledgr/bin/BUILD-NOTES-hooks.md`, `mods/ledgr/BUILD-NOTES-phase2.md`, `mods/ledgr/BUILD-NOTES-phase3.md`. Read the relevant one before touching that half.

## Architecture in six lines

1. Claude Code hooks (SessionStart, UserPromptSubmit, Stop) run `mods/ledgr/bin/adapters/claude/*.sh`. They inherit `HC_TERMINAL_ID` from the Herdr shell, so they can map terminal to session id, transcript path, cwd and turn. They exit 0 fast, print nothing to the model's context by default, and ignore child or subagent processes (`LEDGR_INNER`, owner-pid rule).
2. Everything that changes state is a JSON event dropped into `~/.config/herdr-app/ledgr-data/spool/` with an atomic write: hooks, the capture box, panel actions, and later the MCP server. `bin/lib/ledgr_spool.py` is the contract and has no Claude-specific imports.
3. One writer applies the spool to `ledgr-data/store.json` (source of truth) and `snapshot.json` (what the extractor reads), then deletes the spool file. The writer runs in the always-shown `my-tabs` copy because a panel block's mod copy only starts when first shown. The panel is a reader of `store.json` and falls back to being the writer only if no `my-tabs` writer answers within 4 s.
4. At Stop, the extractor emits `pending`, resolves the turn's message uuid, then calls `claude-haiku-5-5` with forced JSON output (provider seam: `anthropic`, `openai-compatible`, `cli`) and emits `asks`. A valid non-empty fenced `ledgr-asks` block in the message short-circuits the call. Every ask carries a `level` (blocking, needed, optional); `extract.threshold` in `config.json` (default needed) decides which are open rows that count on the chip, and the rest are kept as folded suggestions.
5. Capture (`cmd-j`, `mod.open:ledgr`) opens over a working pane, parks a question with one keystroke, and accepts a clipboard quote only if it matches the saved turn text or `hc read`.
6. Anything that would type into a terminal is staged on the clipboard plus focus. Never `hc send`: it presses Enter and would submit a draft already in the prompt. A staged confluence or answer sheet starts with a marker line (`ledgr confluence <branch> <item>`, `ledgr answers <session>`); the trunk's UserPromptSubmit hook sees it land and emits `confluence_landed` / `answers_landed` (`bin/lib/ledgr_landing.py`, `mods/ledgr/confluence.js`).

## Engine copies (keep in sync)

Because of the import rule, `my-tabs` cannot import from `mods/ledgr/`. `install.sh` copies the engine files into `mods/my-tabs/ledgr/` and verifies they are identical; the panel warns on drift. The list lives in `install.sh` as `ENGINE_FILES`. If the writer gains a module, add it there. `mods/my-tabs/ledgr/` is gitignored and generated.

## Constraints that are not negotiable

- ledgr is a Herdr mod. It never reaches outside Herdr's home and `~/.claude`. No Things 3, no other applications, no outbound calls except the extraction provider.
- Shipped Herdr mods and `layouts/main.json` are read-only. Jesse's layout is `layouts/custom.json`; Kolczyk replaces the spaces block there, leave it alone.
- `herdr-app check mods/<name>` must pass for every touched mod. `herdr-app shot` returns the last painted frame; an inactive window does not repaint, so a stale shot is not evidence of failure.
- Do not fork or exercise large live sessions in tests. Create a throwaway Claude session in a scratch directory and branch from that; close test panes; remove test items through the panel's own spool events, never by editing `store.json` by hand.
- Back up any live file you edit to `~/.local/state/ledgr/backup-<date>/` first.
- Python core, no Node. This machine has no Homebrew jq or curl; use `python3 -I`.
- Depth cap for branches is a default (`branch.maxDepth`, 2), not a law. Honor the config value.

## Runtime locations (never in the repo)

- Data: `~/.config/herdr-app/ledgr-data/` (`store.json`, `snapshot.json`, `spool/`, `terminals/`, `sessions/` (hooks' `<sid>.json`; Phase 3's `<sid>/decisions.md`, written by the writer), `turns/`, `log/`, `config.json`, `.pycache`).
- Hooks: entries in `~/.claude/settings.json` (install.sh registers them idempotently; a backup is taken first).
- Credential: macOS Keychain, service `ledgr`, account = provider name (`anthropic`). Add with `security add-generic-password -s ledgr -a anthropic -w`.
- Key bindings: `cmd-j` capture, `cmd-shift-j` panel toggle, `mod:ledgr` section for in-box keys (`cmd-enter` btw, `tab`, `shift-tab`).

## Testing

```bash
cd ~/.config/herdr-app/mods/ledgr/bin && sh tests/run-all.sh          # hooks, parser, lookup, extraction fixtures
cd ~/.config/herdr-app/mods/ledgr/bin && python3 -I -B tests/run-extract-fixtures.py --live mixed      # one real Haiku call (all three levels)
herdr-app check mods/ledgr && herdr-app check mods/my-pane && herdr-app check mods/my-tabs
herdr-app do ledgr.demo                                                # panel with fixture items in both lanes
```

The store unit test is described in `mods/ledgr/BUILD-NOTES-mod.md`.

## Vocabulary

trunk (the main linear session) · park (capture a question without sending it) · lane (your questions on top, asks of you below) · ask (something the agent needs you to decide or do) · anchor (session + turn + passage hash, uuid optional) · branch (a forked session born from a parked question) · manifest (what a branch knows and does not know) · confluence (the one message a branch returns to the trunk) · landing (the trunk's hook seeing a staged message submitted) · spool (the event inbox) · writer (the single process that applies it).

## Design decisions log

- 2026-11-05 Research report concluded: chat-first trunk with cheap side moves, canvas last; the river metaphor survives only as "a tributary delivers its water, not its watershed". Evidence for lower cognitive load from branching UIs is thin; the value is navigation and model isolation.
- 2026-11-05 Jesse: the agent's asks of the human are a first-class lane, addressed directly in Phase 1 (the critique argued for deferring it; rejected).
- 2026-11-05 Jesse: extraction = model call at Stop with a structured block fast path. The SessionStart instruction that asks Claude to emit the block defaults OFF (it injects into the trunk's context and the block clutters forked transcripts).
- 2026-11-05 Jesse: no Things 3, no external applications, ever.
- 2026-11-05 From the Grok critique, adopted: store.json as source of truth with restore-before-ingest; clipboard quote validation; owner-pid and `LEDGR_INNER` guards; `pending` event; dismissed asks can be re-raised (`repeat_of`); parked questions are the top lane. Rejected: dropping the agent lane; "subagent_type fork is unconfirmed" (it is confirmed by the Claude Code harness itself).
- 2026-11-05 Writer moved to `my-tabs` because a hidden panel's mod copy does not start until shown.
- 2026-11-05 Phase 3: the confluence is clipboard plus focus, never `hc send`; landing is detected by a marker line in the trunk's UserPromptSubmit hook: the first line of any pasted block (Claude Code wraps pastes in `<pasted_content id="…">` lines), or unwrapped the prompt's first line or second after a one-line lead-in; never inside a code fence. The panel suggests typing a lead-in ("Adopt this branch result for Q1:") before pasting, and the message's last line is the person's assertion ("I am adopting this branch's conclusion as the answer to Q1; …"), because Claude Code presents a paste as possibly not the person's words. Item `rejoin_pending` then `resolved` with `resolvedBy: "branch"`; branch `concluded` then `rejoined`; one line per landing in `ledgr-data/sessions/<sid>/decisions.md`. Close branch (after rejoin) runs `hc kill` + `hc rm` and keeps the record.
- 2026-11-05 Jesse: ask severity. Every agent ask has one `level`: `blocking` (the agent stopped or cannot complete the task without this from the human), `needed` (the human must act or decide for the task to be truly finished, but the agent went on), `optional` (a suggestion, an offer, a nice-to-have). Judged by what the task needs, never by tone: a polite offer that wraps something only the human can give is blocking. `kind` stays. A `ledgr-asks` block item without a level is needed; an unknown level is rejected. `extract.threshold` (default needed) splits open rows that count on the chip from suggestions, which are still stored, fold at the bottom of their turn, and promote with one click; open blocking asks sort first and give the chip its own `blocking` state. Offers are now extracted (as optional) instead of dropped. Same day: lane folds are the person's alone (`ui.foldAsksWhileWorking` restores the old auto-fold), and motion runs only on detected state changes (`ui.animations`).
- Naming: "ledgr", in the spirit of "herdr".
