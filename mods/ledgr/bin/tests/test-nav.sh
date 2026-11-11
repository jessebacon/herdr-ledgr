#!/bin/bash
# ledgr nav unit test (Node): mods/ledgr/nav.js outside Herdr with a stub `herdr` module that records
# every run/hc/exec call and every look at focused(). Go to anchor, /btw and Copy for prompt must be
# clipboard plus pane.focus only; Paste answer(s) and Paste into trunk add one terminal.paste, and
# only after the target is confirmed focused; stageMessage (the one staging door, Detail.md 3.2) keeps
# one paste at a time and says what happened (words.js, which nav.js imports). Never hc, never Enter.
# Then the pins composers and the box's pin decision (tests/test_compose.mjs: confluence.js, branch.js,
# pinning.js, with config.js), in the same folder with the same stub.   bash tests/test-nav.sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.." || exit 1
NODE=$(command -v node) || { echo "SKIP: nav test (no node on PATH)"; exit 0; }
MOD="$(cd .. && pwd)"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/ledgr-nav.XXXXXX")
# nav.js, words.js (nav.js imports it), config.js, confluence.js, branch.js, pinning.js; every module
# of the mod is copied, and only what is imported loads.
cp "$MOD"/*.js "$TMP/"
for f in nav.js words.js config.js confluence.js branch.js pinning.js; do [ -f "$TMP/$f" ] || { echo "FAIL: nav ($f missing in $MOD)"; rm -rf "$TMP"; exit 1; }; done
echo '{"type":"module"}' >"$TMP/package.json"
mkdir -p "$TMP/node_modules/herdr"
echo '{"name":"herdr","type":"module","main":"index.js"}' >"$TMP/node_modules/herdr/package.json"
cat >"$TMP/node_modules/herdr/index.js" <<'JS'
const H = () => (globalThis.__herdr ??= { calls: [], order: [], agents: [], terminals: [], focus: null, looks: 0 });
const rec = (c) => { H().calls.push(c); (H().order ??= []).push(c); };
export const run = (name, args) => { rec(["run", name, args ?? null]); return null; };
export const hc = async (args) => { rec(["hc", ...args]); return { code: 0, stdout: "", stderr: "" }; };
export const exec = async (cmd, args) => { rec(["exec", cmd, ...(args ?? [])]); return { code: 0, stdout: "", stderr: "" }; };
export const agents = () => H().agents;
export const terminals = () => H().terminals;
// focused(): H().focus is a value, or a function of the look's number (1, 2, ...); each look is logged.
export const focused = () => {
  const h = H(); h.looks = (h.looks ?? 0) + 1;
  const f = typeof h.focus === "function" ? h.focus(h.looks) : h.focus;
  (h.order ??= []).push(["look", f?.terminal ?? null, f?.shown ?? null]);
  return f ?? null;
};
// What config.js imports besides (confluence.js and branch.js import it); none of them is called here.
export const appHome = () => "/tmp/nowhere";
export const readTextFile = async () => null;
export const layout = () => null;
export const shared = () => null;
JS
OUT=$("$NODE" tests/test_nav.mjs "$TMP" 2>&1); rc=$?
if [ "$rc" = 0 ]; then
  CMP=$("$NODE" tests/test_compose.mjs "$TMP" 2>&1); rc=$?
  # One summary line last (run-all.sh shows the last line): nav's, then compose's.
  if [ "$rc" = 0 ]; then echo "${OUT%, 0 failure(s)}; ${CMP#OK: }"; else echo "$CMP" | tail -8; echo "FAIL: compose"; fi
else
  echo "$OUT" | tail -8; echo "FAIL: nav"
fi
rm -rf "$TMP"
exit $rc
