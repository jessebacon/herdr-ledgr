#!/bin/sh
# ledgr: repo -> live Herdr install.
# Copies the three mods, generates the engine copies my-tabs needs, registers the
# Claude Code hooks, verifies keys and layout, and runs herdr-app check.
set -eu

REPO="$(cd "$(dirname "$0")" && pwd)"
HERDR="${HERDR_HOME:-$HOME/.config/herdr-app}"
MODS="$HERDR/mods"
SETTINGS="$HOME/.claude/settings.json"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$HOME/.local/state/ledgr/backup-$STAMP"

# Files my-tabs needs byte-identical copies of (Herdr forbids cross-mod imports).
ENGINE_FILES="config.js store.js spool.js writer.js branch.js confluence.js"

[ -d "$MODS" ] || { echo "Herdr home not found: $HERDR" >&2; exit 1; }
command -v herdr-app >/dev/null || { echo "herdr-app not on PATH" >&2; exit 1; }

echo "== 1. mods -> $MODS"
mkdir -p "$BACKUP/mods"
for m in ledgr my-pane my-tabs; do
  if [ -d "$MODS/$m" ]; then
    cp -R "$MODS/$m" "$BACKUP/mods/$m"
  fi
  mkdir -p "$MODS/$m"
  # Excluded paths are also protected from --delete on the receiver.
  rsync -a --delete \
    --exclude 'gpui-kit.d.ts' --exclude 'jsconfig.json' \
    --exclude '__pycache__' --exclude '.DS_Store' \
    --exclude '/ledgr/' \
    "$REPO/mods/$m/" "$MODS/$m/"
done
chmod +x "$MODS"/ledgr/bin/adapters/*/*.sh "$MODS"/ledgr/bin/tests/*.sh 2>/dev/null || true

echo "== 2. engine copies -> $MODS/my-tabs/ledgr"
mkdir -p "$MODS/my-tabs/ledgr"
for f in $ENGINE_FILES; do
  cp "$MODS/ledgr/$f" "$MODS/my-tabs/ledgr/$f"
  cmp -s "$MODS/ledgr/$f" "$MODS/my-tabs/ledgr/$f" || { echo "engine copy differs: $f" >&2; exit 1; }
done

echo "== 3. hooks -> $SETTINGS"
mkdir -p "$BACKUP"
cp "$SETTINGS" "$BACKUP/settings.json"
MODS="$MODS" SETTINGS="$SETTINGS" python3 -I - <<'PY'
import json, os
settings_path = os.environ["SETTINGS"]
base = os.path.join(os.environ["MODS"], "ledgr", "bin", "adapters", "claude")
wanted = {
    "SessionStart": "session-start.sh",
    "UserPromptSubmit": "user-prompt-submit.sh",
    "Stop": "stop.sh",
}
with open(settings_path) as f:
    s = json.load(f)
hooks = s.setdefault("hooks", {})
changed = []
for event, script in wanted.items():
    marker = f"mods/ledgr/bin/adapters/claude/{script}"
    entries = hooks.setdefault(event, [])
    present = any(marker in h.get("command", "")
                  for e in entries for h in e.get("hooks", []))
    if not present:
        entries.append({"hooks": [{"type": "command",
                                   "command": f'"{os.path.join(base, script)}"',
                                   "timeout": 5}]})
        changed.append(event)
tmp = settings_path + ".ledgr.tmp"
with open(tmp, "w") as f:
    json.dump(s, f, indent=2)
    f.write("\n")
os.replace(tmp, settings_path)
print("   registered:", ", ".join(changed) if changed else "already present")
PY
python3 -I -m json.tool "$SETTINGS" >/dev/null

echo "== 4. keys and layout (verified, not edited)"
MISSING=0
grep -q '"cmd-j": *"mod.open:ledgr"' "$HERDR/keys.json" || { echo "   keys.json: missing cmd-j -> mod.open:ledgr"; MISSING=1; }
grep -q '"cmd-shift-j": *"my-tabs.toggle-ledgr"' "$HERDR/keys.json" || { echo "   keys.json: missing cmd-shift-j -> my-tabs.toggle-ledgr"; MISSING=1; }
grep -q '"mod:ledgr"' "$HERDR/keys.json" || { echo "   keys.json: missing mod:ledgr section"; MISSING=1; }
grep -q '"mod": *"ledgr"' "$HERDR/layouts/custom.json" || { echo "   layouts/custom.json: missing the ledgr panel block"; MISSING=1; }
grep -q '"mod": *"my-pane"' "$HERDR/layouts/custom.json" || { echo "   layouts/custom.json: pane header does not use my-pane"; MISSING=1; }
if [ "$MISSING" = 1 ]; then
  echo "   compare against $REPO/setup/keys.json and $REPO/setup/layouts/custom.json"
else
  echo "   ok"
fi

echo "== 5. herdr-app check"
( cd "$HERDR" && for m in ledgr my-pane my-tabs; do herdr-app check "mods/$m"; done )

echo "== done. backups in $BACKUP"
echo "   credential: security add-generic-password -s ledgr -a anthropic -w   (once)"
