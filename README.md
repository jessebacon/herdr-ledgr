# ledgr

A Herdr mod for non-linear conversations with coding agents: park questions while the agent is still talking, keep the agent's asks of you from scrolling away, branch a parked question into its own forked session with an honest manifest, and bring one approved result back to the trunk.

- Why it exists and what the evidence says: `docs/research/Branching conversation interfaces for AI.md`
- How it is built: `docs/design/Herdr ledger mod design.md` (Section 11 lists deviations from the original spec)
- Working rules for agents and humans editing this repo: `CLAUDE.md`

## Install

```bash
./install.sh
```

Copies the mods into `~/.config/herdr-app/mods/`, generates the engine copies `my-tabs` needs, registers the Claude Code hooks in `~/.claude/settings.json` (backup taken first), and runs `herdr-app check`. The layout block and key bindings are verified, not edited; `setup/` holds reference copies of a working `keys.json` and `layouts/custom.json`.

Then add the extraction credential once:

```bash
security add-generic-password -s ledgr -a anthropic -w
```

## Keys

- `cmd-j` park a question (works while the agent is streaming)
- `cmd-shift-j` toggle the ledgr panel
- inside the box: `enter` park, `cmd-enter` copy as a `/btw`, `esc` cancel
