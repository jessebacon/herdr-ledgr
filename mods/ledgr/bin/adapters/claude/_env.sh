# ledgr Claude Code adapter: shared preamble, sourced by the hook entry scripts.
# Absolute tool paths, so the hooks work from Herdr's GUI login-shell PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
case "$0" in */*) HERE="${0%/*}" ;; *) HERE=. ;; esac
# python3 (3.9 or newer): LEDGR_PYTHON, else Homebrew's, /usr/local's, then the system's.
PY="${LEDGR_PYTHON:-}"
if [ -z "$PY" ] || [ ! -x "$PY" ]; then
  for PY in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do [ -x "$PY" ] && break; done
fi
# ledgr-data: LEDGR_DATA, else beside the mods folder these hooks are installed in
# (<Herdr home>/mods/ledgr/bin/adapters/claude), else ~/.config/herdr-app/ledgr-data.
if [ -z "${LEDGR_DATA:-}" ]; then
  _LH="$(cd "$HERE/../../../../.." 2>/dev/null && pwd)"
  if [ -n "$_LH" ] && [ -f "$_LH/AGENTS.md" ] && [ -d "$_LH/mods" ]; then LEDGR_DATA="$_LH/ledgr-data"
  else LEDGR_DATA="$HOME/.config/herdr-app/ledgr-data"; fi
fi
export LEDGR_DATA
D="$LEDGR_DATA"
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
