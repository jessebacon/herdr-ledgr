#!/bin/bash
# ledgr retention Phase 2 (cold sessions) across its seams (Node, with python3 for the MCP server, the Python
# readers and the doctor): tests/test_seams.mjs. The real writer, panel, Reader, settings writer, MCP server and
# doctor on one scratch ledgr-data of its own (removed at the end). No Herdr window, no Claude, no Keychain read.
# One summary line last (run-all.sh shows the last line).   bash tests/test-seams.sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.." || exit 1
NODE=$(command -v node) || { echo "SKIP: seams test (no node on PATH)"; exit 0; }
PY="${LEDGR_PYTHON:-}"
if [ -z "$PY" ] || [ ! -x "$PY" ]; then for PY in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do [ -x "$PY" ] && break; done; fi
export LEDGR_PYTHON="$PY"
out=$("$NODE" tests/test_seams.mjs 2>&1); rc=$?
if [ "$rc" = 0 ]; then printf '%s\n' "$out" | tail -1; else printf '%s\n' "$out" | grep -v '^    at ' | tail -25; echo "FAIL: seams"; fi
exit $rc
