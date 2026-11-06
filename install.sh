#!/bin/sh
# ledgr: install, update or check the Herdr mod. One entry point for people and agents.
#   ./install.sh                                   asks each question; [defaults] are what is installed now
#   ./install.sh --yes --answers ledgr.install.json   no questions (schema: setup/answers.example.json)
#   ./install.sh --check                           the doctor: hooks, writer, Keychain, checks
#   ./install.sh --help                            every flag
# Undo with ./uninstall.sh. Needs python3 3.9+ (standard library only).
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
exec "$PY" -I -B "$REPO/setup/ledgr_setup.py" install "$@"
