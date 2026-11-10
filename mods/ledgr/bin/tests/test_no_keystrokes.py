"""ledgr never sends keystrokes to a terminal (no `hc keys`, no `hc send`, no find bar, no Enter).
Staging is clipboard plus focus; the one thing beyond it is Herdr's `terminal.paste` (what ⌘V runs:
the clipboard into the focused terminal, no Enter, no key names), allowed in exactly one place,
nav.js stageIntoPrompt, with no arguments, reached from the panel only through its `stage` method
(Paste answer(s), Paste into trunk, Ask here with pins). A pin's Copy only copies. A static check
over the mod's own source (comments are stripped first, so the rule may be written down); the
runtime half is tests/test_nav.mjs.
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

# Herdr commands no ledgr code may run: the find bar, and the image paste (Ctrl+V's: it may hand the
# key to the program).
BANNED_COMMANDS = {"terminal.search", "terminal.paste_image"}
# A run(...) call on one line: the command and its argument text.
RUN = re.compile(r"\brun\(\s*[\"'`]([^\"'`]+)[\"'`]\s*(?:,([^\n]*?))?\)")

files = dict(sources())
ok(len(files) > 10, f"found the mod's sources under {MOD}")
for rel, text in files.items():
    for rx, what in FORBIDDEN:
        m = rx.search(text)
        ok(m is None, f"{rel}: {what}: {m.group(0) if m else ''}")
    for name in BANNED_COMMANDS:
        ok(name not in text, f"{rel}: runs {name}")
    if rel.endswith(".js"):
        for cmd, args in RUN.findall(text):
            # No Enter, no key names, no line break handed to any command.
            ok(not re.search(r"enter|\\r|\\n|\bkeys\b|\bsend\b", args or "", re.I), f"{rel}: run(\"{cmd}\", {args.strip()}) passes a key or a line break")
        # terminal.paste is nav.js's alone (below).
        if rel != "nav.js":
            ok("terminal.paste" not in text, f"{rel}: terminal.paste outside nav.js stageIntoPrompt")

# nav.js: the doors to a terminal are pane.focus and, in stageIntoPrompt only, one terminal.paste with
# no arguments; no hc at all, no find bar.
nav = files.get("nav.js", "")
ok(nav, "nav.js present")
ok(re.search(r"\bhc\b", nav) is None, "nav.js does not use hc")
ok("terminal.search" not in nav, "nav.js opens no find bar")
ok(set(re.findall(r"\brun\(\s*\"([^\"]+)\"", nav)) == {"pane.focus", "terminal.paste"}, "nav.js runs pane.focus and terminal.paste only")
ok(nav.count("terminal.paste") == 1 and 'run("terminal.paste");' in nav, "one terminal.paste, with no arguments")


def function(text, name):
    """The body of a top-level `export function name(...) {` in nav.js, up to its closing brace."""
    m = re.search(rf"^export function {name}\([^)]*\) \{{(.*?)^\}}$", text, flags=re.S | re.M)
    return m.group(1) if m else None


sip = function(nav, "stageIntoPrompt")
ok(sip is not None and 'run("terminal.paste");' in sip, "terminal.paste lives in stageIntoPrompt")
ok("focusedOn(terminal)" in sip and sip.index("focusedOn(terminal)") < sip.index('run("terminal.paste")'), "stageIntoPrompt looks at the focus before it pastes")
ok("PASTE.settle" in sip and "read_from_clipboard" in sip, "it pastes only after the settled focus and its own text on the clipboard")
ok(re.search(r"\bf\.terminal === t\b", function(nav, "focusedOn") or "") is not None, "focusedOn compares Herdr's focused terminal with the target")


def method(text, name):
    """The body of a two-space-indented class method in panel.js, one line or many: from its opening
    brace to the brace that closes it (counted, so a one-line method never runs on into the next)."""
    m = re.search(rf"^  {name}\([^)]*\) \{{", text, flags=re.M)
    if not m:
        return None
    depth, i = 1, m.end()
    while i < len(text) and depth:
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        i += 1
    return text[m.end():i - 1] if depth == 0 else None


panel = files.get("panel.js", "")
for name in ("copyAnswers", "copyAnswer", "stageAnswers", "sendToTrunk", "copyConfluence", "stage", "askPinsHere", "copyPin", "copyPinsMessage"):
    body = method(panel, name)
    ok(body is not None, f"panel.js has {name}")
    for bad in ("hc(", "run(", "exec(", "openOverlay(", "goTo", "spawn("):
        ok(bad not in body, f"panel.js {name} calls {bad}")
ok("this.stage(msg, s.terminal, cx" in method(panel, "stageAnswers"), "stageAnswers stages through the panel's stage")
ok("this.stage(msg, ts.terminal, cx" in method(panel, "sendToTrunk"), "Paste into trunk stages through the panel's stage")
ok("this.stage(msg, ts?.terminal, cx" in method(panel, "copyConfluence"), "the confluence again: the same stage")
ok("this.stage(msg, s.terminal, cx" in method(panel, "askPinsHere"), "Ask here (a question with its pins) stages through the panel's stage")
ok(re.search(r"\bstage\(|stageIntoPrompt\(", method(panel, "copyPin")) is None, "a pin's Copy only copies: nothing focused, nothing pasted")
# Copy for prompt on a question with pins: the whole pins message, through the copy path only.
cpm = method(panel, "copyPinsMessage")
ok(re.search(r"\bstage\(|stageIntoPrompt\(|stageText\(|stageQuestion\(", cpm) is None, "Copy for prompt with pins only copies: no stage, nothing focused or pasted")
ok("write_to_clipboard(promptText(pinsMessage(" in cpm, "...the whole pins message (marker first), as Ask here would paste it")
i_pins, i_btw = panel.find("this.copyPinsMessage(it, s, cx)"), panel.find('"Stage /btw"')
ok(0 <= i_pins < i_btw and "} else if (isHuman(it)" in panel[i_pins:i_btw] and "qPins.length" in panel[panel.rfind("if (", 0, i_pins):i_pins],
   "a question with pins offers no Stage /btw, and its Copy for prompt is copyPinsMessage")
ok(panel.count('"Stage /btw"') == 1, "one Stage /btw, for a question without pins")
stage = method(panel, "stage")
ok("stageIntoPrompt(msg, terminal, cx, { paste: this.pasteOn()" in stage, "stage goes through nav.js stageIntoPrompt and honours ui.pasteIntoPrompt")
ok("pasteIntoPrompt !== false" in (method(panel, "pasteOn") or ""), "ui.pasteIntoPrompt is on unless set false")
callers = [rel for rel, text in files.items() if rel != "nav.js" and "stageIntoPrompt(" in text]
ok(callers == ["panel.js"] and panel.count("stageIntoPrompt(") == 1, f"one caller of stageIntoPrompt, the panel's stage: {callers}")
go = method(panel, "goTo")
ok(go is not None and "goToAnchor(" in go, "goTo goes through nav.js goToAnchor")
for bad in ("hc(", "run(", "exec("):
    ok(bad not in go, f"panel.js goTo calls {bad}")

print(f"OK: no keystrokes, {checks} checks")
