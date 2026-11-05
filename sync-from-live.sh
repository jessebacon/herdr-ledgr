#!/bin/sh
# ledgr: live Herdr install -> repo.
# Use once after a build that edited the installed copy in place, then review
# `git status` / `git diff` and go back to editing the repo + ./install.sh.
set -eu

REPO="$(cd "$(dirname "$0")" && pwd)"
HERDR="${HERDR_HOME:-$HOME/.config/herdr-app}"
MODS="$HERDR/mods"

[ -d "$MODS/ledgr" ] || { echo "no live ledgr mod at $MODS/ledgr" >&2; exit 1; }

for m in ledgr my-pane my-tabs; do
  mkdir -p "$REPO/mods/$m"
  rsync -a --delete \
    --exclude 'gpui-kit.d.ts' --exclude 'jsconfig.json' \
    --exclude '__pycache__' --exclude '.DS_Store' \
    --exclude '/ledgr/' \
    "$MODS/$m/" "$REPO/mods/$m/"
done

mkdir -p "$REPO/setup/layouts"
cp "$HERDR/keys.json" "$REPO/setup/keys.json"
cp "$HERDR/layouts/custom.json" "$REPO/setup/layouts/custom.json"

cd "$REPO"
git status --short | sed 's/^/   /' || true
echo "synced from $MODS. Review, then edit here and run ./install.sh."
