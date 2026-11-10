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
# agents(), terminals() and readTextFile() answer from globalThis.__herdr (config.js terminalSpace, loadConfig).
cat >"$TMP/node_modules/herdr/index.js" <<'JS'
const H = () => globalThis.__herdr ?? {};
export const appHome = () => "/tmp/nowhere";
export const readTextFile = async (p) => H().files?.[p] ?? null;
export const layout = () => null;
export const run = () => {};
export const shared = () => null;
export const agents = () => H().agents ?? [];
export const terminals = () => H().terminals ?? [];
JS
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
# A staged message ends with one empty line (nav.js promptText): the parser reads it the same.
assert L.detect(open(f"{d}/msg-confluence.txt").read() + "\n\n") == c
assert L.detect(open(f"{d}/msg-answers.txt").read() + "\n\n") == a
assert L.detect(open(f"{d}/msg-answer-one.txt").read() + "\n\n") == o
# Pins: Ask here's message (confluence.js pinsMessage, written by test_store.mjs) lands as one pins
# message, with the marker first or after the panel's lead-in line; its quoted passages add none.
pm = open(f"{d}/msg-pins.txt").read()
w = pm.split("\n", 1)[0].split(" ")
assert len(w) == 4 and w[:2] == ["ledgr", "pins"] and w[3].startswith("rq_"), w
want = {"kind": "pins", "for_session": w[2], "item_id": w[3]}
assert L.detect(pm) == want and L.detect_all(pm) == [want], L.detect_all(pm)
assert L.detect(pm + "\n\n") == want
pl = open(f"{d}/msg-pins-lead.txt").read()
lead, mark = pl.split("\n")[:2]
wl = mark.split(" ")
assert lead.strip() and not lead.startswith("ledgr ") and wl[:2] == ["ledgr", "pins"], (lead, mark)
want_l = {"kind": "pins", "for_session": wl[2], "item_id": wl[3]}
assert L.detect(pl) == want_l and L.detect_all(pl) == [want_l], L.detect_all(pl)
assert L.detect(pl + "\n\n") == want_l
# A pins message over 45,000 characters, then an answer sheet: both land (MAX_SCAN 64,000; at the old
# 40,000 the sheet was never read).
lm = open(f"{d}/msg-pins-long.txt").read()
assert len(lm) > 45000, len(lm)
both = lm + "\n\n" + open(f"{d}/msg-answers.txt").read()
got = L.detect_all(both)
assert [h["kind"] for h in got] == ["pins", "answers"] and got[1]["handles"] == ["A1", "A2"], got
was = L.MAX_SCAN; L.MAX_SCAN = 40_000
assert [h["kind"] for h in L.detect_all(both)] == ["pins"], "the old scan length misses the sheet"
L.MAX_SCAN = was
# The hooks' ref scan reads no [A3]/[Q3] in it: the composer writes none outside the quoted lines,
# and quoted lines are left out of the scan when the pins marker is there (lib/ledgr_map.prompt_refs).
import ledgr_map as M
assert M.prompt_refs(pm) == [] and M.prompt_refs(pl) == [], (M.prompt_refs(pm), M.prompt_refs(pl))
# The hooks' config defaults agree with config.js on the panel's paste switch (ui.pasteIntoPrompt)
# and on the spaces where ledgr is off (spaces.disabled, none by default).
import ledgr_config as K
assert K.DEFAULT_CONFIG["ui"]["pasteIntoPrompt"] is True, K.DEFAULT_CONFIG["ui"]
assert K.DEFAULT_CONFIG["spaces"] == {"disabled": []}, K.DEFAULT_CONFIG.get("spaces")
merged = K.deep_merge(K.defaults(), {"spaces": {"disabled": ["spA"]}})
assert merged["spaces"]["disabled"] == ["spA"], merged["spaces"]
PY
fi
# The store's summary line last (run-all.sh shows the last line), with the parser check on it.
if [ "$rc" = 0 ]; then echo "${OUT%, 0 failure(s)}; landing parser reads the confluence, the answer sheets and the pins message (and with their blank line; a sheet after a 45,000-character pins message), 0 failure(s)"; else echo "$OUT"; echo "FAIL: store or landing parser"; fi
rm -rf "$TMP"
exit $rc
