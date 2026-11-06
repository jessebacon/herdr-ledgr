#!/bin/bash
# ledgr store unit test (Node): mods/ledgr/{store,branch,config,confluence}.js run outside Herdr with a stub
# `herdr` module. No Herdr window, no files outside a temp folder.   bash tests/test-store.sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PY="${LEDGR_PYTHON:-}"
if [ -z "$PY" ] || [ ! -x "$PY" ]; then for PY in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do [ -x "$PY" ] && break; done; fi
cd "$(dirname "$0")/.." || exit 1
NODE=$(command -v node) || { echo "SKIP: store test (no node on PATH)"; exit 0; }
MOD="$(cd .. && pwd)"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/ledgr-store.XXXXXX")
cp "$MOD/store.js" "$MOD/config.js" "$MOD/branch.js" "$MOD/confluence.js" "$MOD/words.js" "$TMP/"
echo '{"type":"module"}' >"$TMP/package.json"
mkdir -p "$TMP/node_modules/herdr"
echo '{"name":"herdr","type":"module","main":"index.js"}' >"$TMP/node_modules/herdr/package.json"
echo 'export const appHome = () => "/tmp/nowhere"; export const readTextFile = async () => null; export const layout = () => null; export const run = () => {}; export const shared = () => null;' >"$TMP/node_modules/herdr/index.js"
OUT=$("$NODE" tests/test_store.mjs "$TMP" 2>&1); rc=$?
# Phase 3: the hooks' parser (lib/ledgr_landing.py) must read what confluence.js composes.
if [ "$rc" = 0 ]; then
  "$PY" -I -B - "$(pwd)/lib" "$TMP" <<'PY' || rc=1
import sys; sys.path[:0] = [sys.argv[1]]
import ledgr_landing as L
d = sys.argv[2]
c = L.detect(open(f"{d}/msg-confluence.txt").read())
assert c and c["kind"] == "confluence" and c["branch_id"] == "br_00000000-cccc-4bbb-8ccc-000000000001" and c["item_id"] == "rq_c3", c
assert c["conclusion_head"].startswith("Yes: 8443 is served"), c
a = L.detect(open(f"{d}/msg-answers.txt").read())
assert a and a["kind"] == "answers" and a["for_session"] == "aaaaaaaa-3333-0000-0000-000000000001" and a["handles"] == ["A1", "A2"], a
assert a["answers"] == {"A1": "a, as you recommended.", "A2": "after the reboot"}, a
o = L.detect(open(f"{d}/msg-answer-one.txt").read())   # lead-in line, then one ask's sheet (Copy answer)
assert o and o["kind"] == "answers" and o["handles"] == ["A2"] and o["answers"] == {"A2": "after the reboot"}, o
PY
fi
# The store's summary line last (run-all.sh shows the last line), with the parser check on it.
if [ "$rc" = 0 ]; then echo "${OUT%, 0 failure(s)}; landing parser reads both messages, 0 failure(s)"; else echo "$OUT"; echo "FAIL: store or landing parser"; fi
rm -rf "$TMP"
exit $rc
