#!/bin/bash
# ledgr Claude Code adapter: UserPromptSubmit hook. Turn +1 (not for local slash commands, and once
# per prompt_id), state working, prompt event with refs. Prints nothing, except the ledgr-asks
# instruction once after a turn whose blocking ask only the model found (instruct_reinject).
# Always exits 0. Does nothing unless HC_TERMINAL_ID (or LEDGR_TERMINAL) is set, or when LEDGR_INNER is set.
case "$0" in */*) . "${0%/*}/_env.sh" ;; *) . ./_env.sh ;; esac || exit 0
ledgr_active || exit 0
"${PYRUN[@]}" "$HERE/claude_hook.py" UserPromptSubmit "$@" 2>>"$D/log/hook.err"
exit 0
