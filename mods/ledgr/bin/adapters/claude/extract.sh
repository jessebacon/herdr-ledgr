#!/bin/bash
# ledgr extractor CLI (foreground):
#   extract.sh --dry-run --text-file <f> [--snapshot <f>] [--session <sid>] [--mode m] [--provider p]
#   extract.sh --retry <session_id> <turn> [--terminal t]    (the panel's Retry button)
case "$0" in */*) . "${0%/*}/_env.sh" ;; *) . ./_env.sh ;; esac || exit 1
export LEDGR_INNER=1
exec "${PYRUN[@]}" "$HERE/claude_extract.py" "$@"
