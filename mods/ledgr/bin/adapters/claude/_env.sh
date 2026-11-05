# ledgr Claude Code adapter: shared preamble, sourced by the hook entry scripts.
# Absolute tool paths, so the hooks work from Herdr's GUI login-shell PATH.
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PY=/opt/homebrew/bin/python3
case "$0" in */*) HERE="${0%/*}" ;; *) HERE=. ;; esac
D="${LEDGR_DATA:-$HOME/.config/herdr-app/ledgr-data}"
# Bytecode is cached under ledgr-data/.pycache, never in the mod folder (a save there reloads the mod).
PYRUN=("$PY" -I -S -X "pycache_prefix=$D/.pycache")

# The agent process this hook runs under: the first ancestor that is not a shell.
ledgr_owner() {
  [ -n "${LEDGR_OWNER_PID:-}" ] && return 0
  local p=$PPID pp="" c="" i line
  for i in 1 2 3 4; do
    line=$(/bin/ps -o ppid=,comm= -p "$p" 2>/dev/null) || break
    [ -n "$line" ] || break
    read -r pp c <<<"$line"
    c="${c##*/}"
    case "$c" in sh|bash|zsh|dash|ksh|-sh|-bash|-zsh|nohup|env) p="$pp" ;; *) break ;; esac
  done
  export LEDGR_OWNER_PID="$p" LEDGR_OWNER_COMM="$c"
}

# True when the hook should run; otherwise drains stdin and returns 1. Not run: inside any process
# a ledgr hook started (LEDGR_INNER), outside Herdr with no LEDGR_TERMINAL override, or with no
# Homebrew python. When it runs, LEDGR_INNER=1 is exported, so everything the hook starts (the
# python core, the extractor, curl, security, a `claude -p` provider run) carries it.
ledgr_active() {
  if [ -n "${LEDGR_INNER:-}" ] || [ -z "${HC_TERMINAL_ID:-${LEDGR_TERMINAL:-}}" ] || [ ! -x "$PY" ]; then
    cat >/dev/null 2>&1
    return 1
  fi
  mkdir -p "$D/log" "$D/tmp" 2>/dev/null
  ledgr_owner
  export LEDGR_INNER=1
  return 0
}
