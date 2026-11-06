#!/bin/bash
# ledgr nav unit test (Node): mods/ledgr/nav.js outside Herdr with a stub `herdr` module that records
# every run/hc/exec call. Copy answer(s), /btw, Send to trunk and Go to anchor must be clipboard plus
# pane.focus only.   bash tests/test-nav.sh
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
const H = () => (globalThis.__herdr ??= { calls: [], agents: [], terminals: [] });
export const run = (name, args) => { H().calls.push(["run", name, args ?? null]); return null; };
export const hc = async (args) => { H().calls.push(["hc", ...args]); return { code: 0, stdout: "", stderr: "" }; };
export const exec = async (cmd, args) => { H().calls.push(["exec", cmd, ...(args ?? [])]); return { code: 0, stdout: "", stderr: "" }; };
export const agents = () => H().agents;
export const terminals = () => H().terminals;
JS
"$NODE" tests/test_nav.mjs "$TMP" 2>&1 | tail -3; rc=${PIPESTATUS[0]}
rm -rf "$TMP"
exit $rc
