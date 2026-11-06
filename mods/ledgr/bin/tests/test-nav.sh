#!/bin/bash
# ledgr nav unit test (Node): mods/ledgr/nav.js outside Herdr with a stub `herdr` module that records
# every run/hc/exec call and every look at focused(). Go to anchor, /btw and Copy for prompt must be
# clipboard plus pane.focus only; Paste answer(s) and Paste into trunk add one terminal.paste, and
# only after the target is confirmed focused. Never hc, never Enter.   bash tests/test-nav.sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.." || exit 1
NODE=$(command -v node) || { echo "SKIP: nav test (no node on PATH)"; exit 0; }
MOD="$(cd .. && pwd)"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/ledgr-nav.XXXXXX")
cp "$MOD/nav.js" "$TMP/"
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
JS
"$NODE" tests/test_nav.mjs "$TMP" 2>&1 | tail -3; rc=${PIPESTATUS[0]}
rm -rf "$TMP"
exit $rc
