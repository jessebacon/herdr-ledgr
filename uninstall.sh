#!/bin/sh
# ledgr: remove the mod. Writes your current choices to ~/.local/state/ledgr/last-install.json first
# (reinstall: ./install.sh --yes --answers ~/.local/state/ledgr/last-install.json), restores the files
# saved before ledgr first touched them where only ledgr's entries differ, removes ledgr's entries
# alone where something else changed since, and asks separately before deleting ledgr-data/.
# Never deletes the Keychain item.
#   ./uninstall.sh            asks first
#   ./uninstall.sh --yes      no questions; keeps ledgr-data/ (add --purge-data to delete it)
set -eu
REPO="$(cd "$(dirname "$0")" && pwd)"
PY=""
for c in "${LEDGR_PYTHON:-}" python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  [ -n "$c" ] || continue
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    PY="$c"; break
  fi
done
[ -n "$PY" ] || { echo "ledgr needs python3 3.9 or newer (set LEDGR_PYTHON to one)." >&2; exit 2; }
exec "$PY" -I -B "$REPO/setup/ledgr_setup.py" uninstall "$@"
