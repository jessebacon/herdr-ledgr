# Changelog

## 0.1.0 (unreleased)

First public shape of the mod. Built on Herdr 0.1.13, hc 0.1.18, Claude Code 2.1.311.

### Who owns the closing list, declare by tool, honest profiles (2026-11-06)

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
