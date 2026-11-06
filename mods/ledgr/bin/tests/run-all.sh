#!/bin/bash
# ledgr: every offline test (hooks half, the mod's store and nav under Node, the no-keystroke rule, the MCP server). No Claude, no Herdr window,
# no API call, no Keychain read.
#   bash tests/run-all.sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -o pipefail   # a failing test fails the run (not only tail)
cd "$(dirname "$0")/.." || exit 1
# The same python3 the hooks use (adapters/claude/_env.sh).
PY="${LEDGR_PYTHON:-}"
if [ -z "$PY" ] || [ ! -x "$PY" ]; then
  for PY in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do [ -x "$PY" ] && break; done
fi
export LEDGR_PYTHON="$PY"
rc=0
"$PY" -I -B tests/test_parse_block.py | tail -1 || rc=1
"$PY" -I -B tests/test_last_assistant.py | tail -1 || rc=1
"$PY" -I -B tests/run-extract-fixtures.py | tail -1 || rc=1
bash tests/test-hooks.sh | tail -1 || rc=1
bash tests/test-store.sh | tail -1 || rc=1        # the mod's store.js + branch.js under Node (skipped without node)
"$PY" -I -B tests/test_no_keystrokes.py | tail -1 || rc=1   # no hc keys / hc send anywhere; copy = clipboard + focus
bash tests/test-nav.sh | tail -1 || rc=1          # nav.js under Node with a recording herdr stub (skipped without node)
"$PY" -I -B tests/test_mcp.py | tail -1 || rc=1    # the MCP server over stdio (scratch ledgr-data, a fake writer)
exit $rc
