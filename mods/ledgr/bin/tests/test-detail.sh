#!/bin/bash
# ledgr list and detail unit tests (Node, docs/design/Detail.md 6.1-6.2): tests/test_list.mjs (listing.js:
# rows, state words, the cursor), tests/test_detail.mjs (detailing.js, words.js, fixtures.js: the
# dialog's props, spec, verbatim text, closesAfterStage, mergeClosed) and tests/test_settings.mjs (the
# settings dialog and the text scale, 2026-11-10: the scale's clamp and rounding, the rows, editConfig's
# compare-and-swap, every text size scaled) and tests/test_links.mjs (links.js and opener.js, 2026-11-10: the
# paths found and linked, the links parsed back, where a path is looked for, the opener's argv, a recording
# exec). Each builds its own scratch folder with a stub `herdr` (no argument). No Herdr window, no files
# outside a temp folder, no process started.
# One summary line last (run-all.sh shows the last line).   bash tests/test-detail.sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.." || exit 1
NODE=$(command -v node) || { echo "SKIP: list and detail tests (no node on PATH)"; exit 0; }
rc=0; oks=(); fails=""
for t in list detail settings links; do
  f="tests/test_$t.mjs"
  if [ ! -f "$f" ]; then
    who="the settings dialog's"; [ "$t" = list ] && who="Builder A's"; [ "$t" = detail ] && who="Builder B's"; [ "$t" = links ] && who="the links'"
    echo "$f missing ($who test)"
    fails="${fails:+$fails, }$t (missing)"; rc=1; continue
  fi
  out=$("$NODE" "$f" 2>&1); r=$?
  if [ "$r" = 0 ]; then oks+=("$(printf '%s\n' "$out" | tail -1)"); else printf '%s\n' "$out" | tail -8; fails="${fails:+$fails, }$t"; rc=1; fi
done
# All passed: list's line, then detail's, settings' and links' (as test-nav.sh joins nav's and compose's).
if [ "$rc" = 0 ]; then d="${oks[1]#OK: }"; s="${oks[2]#OK: }"; echo "${oks[0]%, 0 failure(s)}; ${d%, 0 failure(s)}; ${s%, 0 failure(s)}; ${oks[3]#OK: }"; else echo "FAIL: list, detail, settings and links tests: $fails"; fi
exit $rc
