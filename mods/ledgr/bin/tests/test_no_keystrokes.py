"""ledgr never sends keystrokes to a terminal (no `hc keys`, no `hc send`), and the panel's copy
actions are clipboard plus focus only. A static check over the mod's own source (comments are
stripped first, so the rule may be written down); the runtime half is tests/test_nav.mjs.
    python3 -I -B tests/test_no_keystrokes.py
"""
import os
import re
import sys

BIN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.dirname(BIN)
SKIP_DIRS = {"tests", "fixtures", "__pycache__", "node_modules"}
checks = 0


def ok(cond, msg):
    global checks
    checks += 1
    if not cond:
        print(f"FAIL: {msg}")
        sys.exit(1)


def strip_comments(path, text):
    if path.endswith(".js"):
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        return re.sub(r"(^|[^:\"'`\\])//[^\n]*", r"\1", text)
    return re.sub(r"(^|\s)#[^\n]*", r"\1", text)


def sources():
    for root, dirs, files in os.walk(MOD):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for f in files:
            if f.endswith((".js", ".py", ".sh")):
                p = os.path.join(root, f)
                with open(p, encoding="utf-8") as fh:
                    yield os.path.relpath(p, MOD), strip_comments(p, fh.read())


Q = r"[\"'`]"
FORBIDDEN = [
    # hc(["keys", …]) / hc(["send", …]) through the herdr module
    (re.compile(rf"\bhc\(\s*\[\s*{Q}(keys|send){Q}"), "hc keys/send through the herdr module"),
    # exec("hc", ["keys", …]) or a path to hc
    (re.compile(rf"\bexec\(\s*{Q}[^\"'`]*\bhc{Q}\s*,\s*\[\s*{Q}(keys|send){Q}"), "exec of hc keys/send"),
    # a shell or Python call: hc keys …, ["hc", "keys", …]
    (re.compile(rf"(\bhc\s+(keys|send)\b)|({Q}hc{Q}\s*,\s*{Q}(keys|send){Q})"), "hc keys/send from a script"),
    # anything else that presses keys for the person
    (re.compile(r"System Events|keystroke\s+\"|CGEventPost|osascript"), "synthetic key events"),
]

files = dict(sources())
ok(len(files) > 10, f"found the mod's sources under {MOD}")
for rel, text in files.items():
    for rx, what in FORBIDDEN:
        m = rx.search(text)
        ok(m is None, f"{rel}: {what}: {m.group(0) if m else ''}")

# nav.js: the only door to a terminal is pane.focus; no hc at all, no find bar.
nav = files.get("nav.js", "")
ok(nav, "nav.js present")
ok(re.search(r"\bhc\b", nav) is None, "nav.js does not use hc")
ok("terminal.search" not in nav, "nav.js opens no find bar")
ok(set(re.findall(r"\brun\(\s*\"([^\"]+)\"", nav)) == {"pane.focus"}, "nav.js runs pane.focus only")


def method(text, name):
    """The body of a two-space-indented class method in panel.js, up to its closing brace."""
    m = re.search(rf"^  {name}\([^)]*\) \{{(.*?)^  \}}$", text, flags=re.S | re.M)
    if m:
        return m.group(1)
    m = re.search(rf"^  {name}\([^)]*\) \{{([^\n]*)\}}$", text, flags=re.M)   # a one-line method
    return m.group(1) if m else None


panel = files.get("panel.js", "")
for name in ("copyAnswers", "copyAnswer", "stageAnswers"):
    body = method(panel, name)
    ok(body is not None, f"panel.js has {name}")
    for bad in ("hc(", "run(", "exec(", "openOverlay(", "goTo", "spawn("):
        ok(bad not in body, f"panel.js {name} calls {bad}")
ok("stageText(msg, s.terminal, cx)" in method(panel, "stageAnswers"), "stageAnswers stages through nav.js stageText (clipboard + focus)")
go = method(panel, "goTo")
ok(go is not None and "goToAnchor(" in go, "goTo goes through nav.js goToAnchor")
for bad in ("hc(", "run(", "exec("):
    ok(bad not in go, f"panel.js goTo calls {bad}")

print(f"OK: no keystrokes, {checks} checks")
