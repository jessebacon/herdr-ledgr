# Changelog

## 0.1.0 (unreleased)

First public shape of the mod. Built on Herdr 0.1.13, hc 0.1.18, Claude Code 2.1.311.

### Asks declared first (this release)

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

### Packaging (this release)

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
