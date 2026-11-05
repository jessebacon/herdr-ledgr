#!/bin/bash
# ledgr Claude Code adapter: SessionEnd hook (optional; not registered in settings.json).
# State ended, session_end event. Prints nothing.
# Always exits 0. Does nothing unless HC_TERMINAL_ID (or LEDGR_TERMINAL) is set, or when LEDGR_INNER is set.
case "$0" in */*) . "${0%/*}/_env.sh" ;; *) . ./_env.sh ;; esac || exit 0
ledgr_active || exit 0
"${PYRUN[@]}" "$HERE/claude_hook.py" SessionEnd "$@" 2>>"$D/log/hook.err"
exit 0
