#!/bin/bash
# ledgr: every offline test (hooks half, and the mod's store under Node). No Claude, no Herdr window,
# no API call, no Keychain read.
#   bash tests/run-all.sh
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -o pipefail   # a failing test fails the run (not only tail)
cd "$(dirname "$0")/.." || exit 1
rc=0
/opt/homebrew/bin/python3 -I -B tests/test_parse_block.py | tail -1 || rc=1
/opt/homebrew/bin/python3 -I -B tests/test_last_assistant.py | tail -1 || rc=1
/opt/homebrew/bin/python3 -I -B tests/run-extract-fixtures.py | tail -1 || rc=1
bash tests/test-hooks.sh | tail -1 || rc=1
bash tests/test-store.sh | tail -1 || rc=1        # the mod's store.js + branch.js under Node (skipped without node)
exit $rc
