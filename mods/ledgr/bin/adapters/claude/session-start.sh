#!/bin/bash
# ledgr Claude Code adapter: SessionStart hook. Session record, identity map, session_start event.
# Prints the ledgr-asks instruction when config.instruct_block is true (the default), at startup,
# resume, clear and compact; it becomes model context. Prints nothing else.
# Always exits 0. Does nothing unless HC_TERMINAL_ID (or LEDGR_TERMINAL) is set, or when LEDGR_INNER is set.
case "$0" in */*) . "${0%/*}/_env.sh" ;; *) . ./_env.sh ;; esac || exit 0
ledgr_active || exit 0
"${PYRUN[@]}" "$HERE/claude_hook.py" SessionStart "$@" 2>>"$D/log/hook.err"
exit 0
