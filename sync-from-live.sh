#!/bin/sh
# ledgr: live Herdr install -> repo, for the repo's maintainer.
# Use once after a build that edited the installed copy in place, then review `git status` /
# `git diff` and go back to editing the repo + ./install.sh. Pulls mods/ledgr, mods/ledgr-pane
# (when installed) and the mods of the overlay recorded in the install state (none for most
# people). Never pulls keys.json or layouts: those are the person's own files.
set -eu

REPO="$(cd "$(dirname "$0")" && pwd)"
HERDR="${HERDR_HOME:-$HOME/.config/herdr-app}"
STATE="${LEDGR_STATE_DIR:-$HOME/.local/state/ledgr}"
MODS="$HERDR/mods"

[ -d "$MODS/ledgr" ] || { echo "no live ledgr mod at $MODS/ledgr" >&2; exit 1; }

pull() {  # pull <live mod dir> <repo mod dir>
  mkdir -p "$2"
  rsync -a --delete \
    --exclude 'gpui-kit.d.ts' --exclude 'jsconfig.json' \
    --exclude '__pycache__' --exclude '.DS_Store' \
    --exclude '/ledgr/' \
    "$1/" "$2/"
}

pull "$MODS/ledgr" "$REPO/mods/ledgr"
[ -d "$MODS/ledgr-pane" ] && pull "$MODS/ledgr-pane" "$REPO/mods/ledgr-pane"

# The overlay (an answers' "overlay" folder holding overlay.json and mods/<name>/).
OVERLAY=$(python3 -I -c 'import json,os,sys
try: a = json.load(open(sys.argv[1])).get("answers", {})
except Exception: a = {}
o = a.get("overlay") or ""
print(o if not o or os.path.isabs(o) else os.path.join(sys.argv[2], o))' "$STATE/install-state.json" "$REPO")
if [ -n "$OVERLAY" ] && [ -f "$OVERLAY/overlay.json" ]; then
  for m in $(python3 -I -c 'import json,sys; print(" ".join(json.load(open(sys.argv[1])).get("mods", [])))' "$OVERLAY/overlay.json"); do
    [ -d "$MODS/$m" ] && pull "$MODS/$m" "$OVERLAY/mods/$m"
  done
fi

cd "$REPO"
git status --short | sed 's/^/   /' || true
echo "synced from $MODS. Review, then edit here and run ./install.sh."
