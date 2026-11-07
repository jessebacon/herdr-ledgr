#!/bin/bash
# ledgr Claude Code adapter: Stop hook.
#   Part A (sync): turn text, state idle, map update, `pending` event at once.
#   Part B (detached, only when part A accepted the event): claude_extract.py --input resolves the
#   message uuid (emits `stop` with it), runs the extraction (emits `asks`). It starts in its own
#   session with stdio redirected, so the hook returns at once and the work outlives the hook.
# In a disabled space (the recorded space is in config spaces.disabled, or the turn began off) part A
# only marks the session idle: no turn text, no `pending`, and part B never starts.
# Prints nothing. Always exits 0. Does nothing unless HC_TERMINAL_ID (or LEDGR_TERMINAL) is set,
# or when LEDGR_INNER is set.
case "$0" in */*) . "${0%/*}/_env.sh" ;; *) . ./_env.sh ;; esac || exit 0
ledgr_active || exit 0
F="$(mktemp "$D/tmp/.stop.XXXXXX" 2>/dev/null)" || { cat >/dev/null 2>&1; exit 0; }
cat >"$F"
if "${PYRUN[@]}" "$HERE/claude_hook.py" Stop "$@" <"$F" 2>>"$D/log/hook.err"; then
  nohup "${PYRUN[@]}" "$HERE/claude_extract.py" --input "$F" </dev/null >/dev/null 2>>"$D/log/extract.err" &
else
  rm -f "$F"
fi
exit 0
