"""ledgr never sends keystrokes to a terminal (no `hc keys`, no `hc send`, no find bar, no Enter).
Staging is clipboard plus focus; the one thing beyond it is Herdr's `terminal.paste` (what ⌘V runs:
the clipboard into the focused terminal, no Enter, no key names), allowed in exactly one place,
nav.js stageIntoPrompt, with no arguments. One door leads there (docs/design/Detail.md 3.3):
nav.js stageIntoPrompt <- nav.js stageMessage <- reader.js `stage` (the Reader the panel and the
detail dialog both extend) <- `this.stage(` in the staging methods (Paste answer(s), Paste into trunk,
the confluence again, Ask here with pins). A copy only copies. The settings dialog (settings.js,
2026-11-10) stages, copies, runs and opens nothing: it only writes config.json through Reader
saveConfig (rule 12). A process starts only from opener.js, and only on a click in the detail dialog
(2026-11-10, rule 13): a link or path the person clicks opens in the browser or the chosen editor (open,
zed, code or their own command), never a shell, never a terminal, never with a line break. Only the writer
writes under ledgr-data/archive/, each file new (spool.js writeNew), and the dialog's Reopen on an archived
record posts one restore event and nothing else (2026-11-19, rule 14). Only the writer writes, unlinks,
makes or removes anything under ledgr-data/cold/ (retention Phase 2, rule 15); the reading copies and the
Python readers only read a cold file, and post only Try again and Use without its older items. An image in an
answer (2026-11-23, rule 16): only attach.js writes or makes anything under ledgr-data/attachments/, nothing
removes anything there, and only detail.js imports it; the clipboard's image is written by one pinned call,
the owner's exception to rule 1's ban (rules 1 and 13): /usr/bin/osascript running opener.js CLIP_SCRIPT, a
fixed script that reads the pasteboard and writes one PNG and can do nothing else, on the person's ⌘V in the
answer box or click on Paste image. A static check over the mod's own source (comments are stripped first, so
the rule may be written down); the runtime half is tests/test_nav.mjs, tests/test_links.mjs and
tests/test_clip.mjs (the shipped script run on private named pasteboards).

Every check runs and every failure is printed (a file not written yet is named once, with the rules
that wait on it); the last line is the summary run-all.sh shows. An argument names another copy of the mod
to check (its folder, holding opener.js), so an edited copy can be shown to fail.
    python3 -I -B tests/test_no_keystrokes.py [mod folder]

Comments are stripped with string literals respected (2026-11-23, the second review: the old regex cut a line
at any // even inside a string, which hid the rest of that line from every rule): JavaScript by a small lexer
that keeps '…', "…" and `…` (with ${…} nested), regex literals where a regex may start (after an operator,
a bracket, a comma, a keyword or the start; never after an identifier, a number, ")" or "]", where / is a
division), and block and line comments out; Python by the tokenize module (only COMMENT tokens removed);
shell as before (a # after whitespace ends the line: a # inside a quoted shell string is still cut).
"""
import hashlib
import io
import json
import os
import re
import sys
import tokenize

BIN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(BIN)
SKIP_DIRS = {"tests", "fixtures", "__pycache__", "node_modules"}
checks = 0
failures = []


def ok(cond, msg):
    global checks
    checks += 1
    if not cond:
        failures.append(msg)
        print(f"FAIL: {msg}")
    return bool(cond)


REGEX_AFTER_WORDS = {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"}
REGEX_AFTER_PUNCT = set("(,=:[!&|?{};+-*%<>~^")


def _quoted(text, i, q):
    """The end (exclusive) of a '…' or "…" literal starting at i; at a line break when it is not closed."""
    j, n = i + 1, len(text)
    while j < n:
        ch = text[j]
        if ch == "\\":
            j += 2
            continue
        if ch == q:
            return j + 1
        if ch == "\n":
            return j
        j += 1
    return n


def _regex(text, i):
    """The end (exclusive, flags included) of a regex literal starting at i, or -1 (a line break first: no regex)."""
    j, n, cls = i + 1, len(text), False
    while j < n:
        ch = text[j]
        if ch == "\n":
            return -1
        if ch == "\\":
            j += 2
            continue
        if cls:
            if ch == "]":
                cls = False
        elif ch == "[":
            cls = True
        elif ch == "/":
            j += 1
            while j < n and (text[j].isalnum() or text[j] == "_"):
                j += 1
            return j
        j += 1
    return -1


def strip_js(text):
    """JavaScript with its comments taken out and every string, template and regex literal kept whole."""
    out, i, n = [], 0, len(text)
    last = ""            # the last significant token: a word, a punctuation character, "lit" (a literal)
    braces, holes = 0, []  # brace depth; the depths at which a template's ${ opened
    tmpl = False
    while i < n:
        c = text[i]
        if tmpl:
            if c == "\\":
                out.append(text[i:i + 2])
                i += 2
            elif c == "`":
                out.append(c)
                i += 1
                tmpl, last = False, "lit"
            elif c == "$" and text.startswith("${", i):
                out.append("${")
                i += 2
                braces += 1
                holes.append(braces)
                tmpl, last = False, "{"
            else:
                out.append(c)
                i += 1
            continue
        if c == "/" and text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and text.startswith("/*", i):
            j = text.find("*/", i + 2)
            end = n if j < 0 else j + 2
            out.append("\n" * text.count("\n", i, end) or " ")
            i = end
            continue
        if c in "'\"":
            j = _quoted(text, i, c)
            out.append(text[i:j])
            i, last = j, "lit"
            continue
        if c == "`":
            out.append(c)
            i += 1
            tmpl = True
            continue
        if c == "/" and (last == "" or last in REGEX_AFTER_PUNCT or last in REGEX_AFTER_WORDS):
            j = _regex(text, i)
            if j > 0:
                out.append(text[i:j])
                i, last = j, "lit"
                continue
        if c == "{":
            braces += 1
        elif c == "}":
            if holes and holes[-1] == braces:
                holes.pop()
                braces -= 1
                out.append(c)
                i += 1
                tmpl = True
                continue
            braces -= 1
        if c.isalnum() or c in "_$":
            m = re.match(r"[A-Za-z0-9_$]+", text[i:])
            w = m.group(0) if m else c
            out.append(w)
            i += len(w)
            last = w if not w[0].isdigit() else "num"
            continue
        out.append(c)
        i += 1
        if not c.isspace():
            last = c
    return "".join(out)


def strip_py(text):
    """Python with its COMMENT tokens taken out (strings, docstrings and f-strings kept)."""
    lines = text.splitlines(keepends=True)
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, SyntaxError):
        return re.sub(r"(^|\s)#[^\n]*", r"\1", text)
    for tok in reversed(toks):
        if tok.type == tokenize.COMMENT:
            (sr, sc), (er, ec) = tok.start, tok.end
            ln = lines[sr - 1]
            lines[sr - 1] = ln[:sc] + ln[ec:]
    return "".join(lines)


def strip_comments(path, text):
    if path.endswith(".js"):
        return strip_js(text)
    if path.endswith(".py"):
        return strip_py(text)
    return re.sub(r"(^|\s)#[^\n]*", r"\1", text)


def sources():
    for root, dirs, files in os.walk(MOD):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for f in files:
            if f.endswith((".js", ".py", ".sh")):
                p = os.path.join(root, f)
                with open(p, encoding="utf-8") as fh:
                    t = fh.read()
                RAW[os.path.relpath(p, MOD)] = t
                yield os.path.relpath(p, MOD), strip_comments(p, t)


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

RAW = {}   # every file as it is on disk (the pinned script and call are checked on these)
files = dict(sources())
ok(len(files) > 10, f"found the mod's sources under {MOD}")

# The stripper itself (2026-11-23): what the second review hid behind a // inside a string now shows, and a comment
# still goes. Each sample: its source, text that must survive, text that must go.
STRIP_CASES = [
    ("var tag = 'a//b'; app.doShellScript('x');", ["doShellScript('x')"], []),
    ('const u = "http://x"; run(1); // a comment', ['"http://x"', "run(1);"], ["a comment"]),
    ("const q = /[\"'`]/g; exec('hc'); // c", ["exec('hc')"], ["// c"]),
    ("const t = `a ${b + `c // d`} e`; f(); // g", ["`a ${b + `c // d`} e`", "f();"], ["// g"]),
    ("x = a / b / c; y(); // z", ["x = a / b / c; y();"], ["// z"]),
    ("// turns/<sid>/*.md\ncode(); /* gone */ more();", ["code();", "more();"], ["turns/", "gone"]),
    ('s = "/*"; keep(); /* x */', ['"/*"', "keep();"], ["x */"]),
    ("if (x) { y(); } /re/.test(z); w();", ["w();"], []),
]
for src_, keep, gone in STRIP_CASES:
    got = strip_js(src_)
    ok(all(k in got for k in keep) and not any(g in got for g in gone), f"stripper: {src_!r} -> {got!r}")
ok(strip_py('s = "# not a comment"  # a comment\n') == 's = "# not a comment"  \n', "stripper: a Python # inside a string kept, the comment gone")

# ── rule 1: the forbidden patterns everywhere; terminal.paste is nav.js's alone ──────────────────
# The owner's pinned exception (2026-11-23: "Yes, allow osascript on ⌘V in the answer box with the pinned
# exception"): the literal /usr/bin/osascript may appear exactly once in the mod, in opener.js, as this one call
# (inside clipboardImage, rule 13); with that call taken out, opener.js meets the whole pattern like every other
# file (System Events, keystroke, CGEventPost and osascript anywhere else, CLIP_SCRIPT included).
PINNED_CALL = 'exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", CLIP_SCRIPT, outPath, String(CLIP_MAX)], { timeout: OPEN_TIMEOUT })'
# The script it runs, pinned whole (rule 13 compares opener.js CLIP_SCRIPT with this, character for character).
CLIP_SHA256 = "9a709cc8f335930899de523f1fa59c46323dbfc70df6e84a9b6e2dded8983d2f"
CLIP_SCRIPT_PINNED = r"""ObjC.import('AppKit');
function run(argv) {
  var out = argv[0], max = Number(argv[1]), name = argv[2];
  if (!out || !(max > 0)) throw new Error('bad arguments');
  var pb = name ? $.NSPasteboard.pasteboardWithName(name) : $.NSPasteboard.generalPasteboard;
  var data = pb.dataForType($.NSPasteboardTypePNG), how = 'png';
  if (!data || data.isNil()) {
    var img = $.NSImage.alloc.initWithPasteboard(pb);
    if (!img || img.isNil()) throw new Error('no image on the clipboard');
    var rep = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation);
    if (!rep || rep.isNil()) throw new Error('the image could not be read');
    data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
    if (!data || data.isNil()) throw new Error('the image could not be made a PNG');
    how = 'converted';
  }
  var n = Number(data.length);
  if (n > max) throw new Error('too large: ' + n + ' bytes');
  if (!data.writeToFileOptionsError($(out), $.NSDataWritingWithoutOverwriting, null)) throw new Error('the file could not be written (it is there already, or its folder is not)');
  return JSON.stringify({ how: how, bytes: n });
}"""
# Counted on the files as they are on disk (comments included), so no comment or string can hide a second one.
pinned_in = sorted(rel for rel, t in RAW.items() if "/usr/bin/osascript" in t)
ok(pinned_in == ["opener.js"] and RAW["opener.js"].count("/usr/bin/osascript") == 1 and RAW["opener.js"].count(PINNED_CALL) == 1
   and files["opener.js"].count(PINNED_CALL) == 1,
   f"rule 1: /usr/bin/osascript appears once in the mod as it is on disk, in opener.js, as the pinned call (in code): {pinned_in}")
for rel, text in files.items():
    if rel == "opener.js":
        text = text.replace(PINNED_CALL, "", 1)
    for rx, what in FORBIDDEN:
        m = rx.search(text)
        ok(m is None, f"rule 1: {rel}: {what}: {m.group(0) if m else ''}")
    for name in BANNED_COMMANDS:
        ok(name not in text, f"rule 1: {rel}: runs {name}")
    if rel.endswith(".js"):
        for cmd, args in RUN.findall(text):
            # No Enter, no key names, no line break handed to any command.
            ok(not re.search(r"enter|\\r|\\n|\bkeys\b|\bsend\b", args or "", re.I), f"rule 1: {rel}: run(\"{cmd}\", {args.strip()}) passes a key or a line break")
        if rel != "nav.js":
            ok("terminal.paste" not in text, f"rule 1: {rel}: terminal.paste outside nav.js stageIntoPrompt")

# nav.js: the doors to a terminal are pane.focus and, in stageIntoPrompt only, one terminal.paste with
# no arguments; no hc at all, no find bar.
nav = files.get("nav.js")
ok(nav is not None, "nav.js present")
nav = nav or ""
ok(re.search(r"\bhc\b", nav) is None, "rule 1: nav.js does not use hc")
ok("terminal.search" not in nav, "rule 1: nav.js opens no find bar")
ok(set(re.findall(r"\brun\(\s*\"([^\"]+)\"", nav)) == {"pane.focus", "terminal.paste"}, "rule 1: nav.js runs pane.focus and terminal.paste only")
ok(nav.count("terminal.paste") == 1 and 'run("terminal.paste");' in nav, "rule 1: one terminal.paste, with no arguments")


def function(text, name):
    """The body of a top-level `export function name(...) {` in nav.js, up to its closing brace."""
    m = re.search(rf"^export function {name}\([^)]*\) \{{(.*?)^\}}$", text, flags=re.S | re.M)
    return m.group(1) if m else None


sip = function(nav, "stageIntoPrompt")
ok(sip is not None, "rule 1: nav.js exports stageIntoPrompt")
sip = sip or ""
ok('run("terminal.paste");' in sip, "rule 1: terminal.paste lives in stageIntoPrompt")
ok("focusedOn(terminal)" in sip and 'run("terminal.paste")' in sip and sip.index("focusedOn(terminal)") < sip.index('run("terminal.paste")'),
   "rule 1: stageIntoPrompt looks at the focus before it pastes")
ok("PASTE.settle" in sip and "read_from_clipboard" in sip, "rule 1: it pastes only after the settled focus and its own text on the clipboard")
ok(re.search(r"\bf\.terminal === t\b", function(nav, "focusedOn") or "") is not None, "rule 1: focusedOn compares Herdr's focused terminal with the target")


def method(text, name):
    """The body of a two-space-indented class method (`  name(args) {`, `async` allowed; args may hold one
    level of parentheses, a default `st = this.viewStore()`), one line or many: from its opening brace to the brace that closes it (counted, so a one-line method never runs
    on into the next). None when the file or the method is not there."""
    if text is None:
        return None
    m = re.search(rf"^  (?:async )?{name}\((?:[^()]|\([^()]*\))*\) \{{", text, flags=re.M)
    if not m:
        return None
    depth, i = 1, m.end()
    while i < len(text) and depth:
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        i += 1
    return text[m.end():i - 1] if depth == 0 else None


# The files of the list and detail change (Detail.md 5.1): a missing one fails once, by name, and the
# checks over its methods wait for it (they are not run, so nothing crashes on its absence).
OWNER = {"reader.js": "Builder A, rules 3, 5, 7", "panel.js": "Builder A, rules 4, 10",
         "detail.js": "Builder B, rules 4-9, 11"}
src = {}
for rel, who in OWNER.items():
    src[rel] = files.get(rel)
    ok(src[rel] is not None, f"{rel} present ({who} wait on it)")
reader, panel, detail = src["reader.js"], src["panel.js"], src["detail.js"]

bodies = {}


def body(rel, name, rules):
    """The method's body, looked up once; its absence (in a file that is there) fails once, naming the
    rules that need it."""
    key = (rel, name)
    if key not in bodies:
        b = method(src[rel], name)
        if src[rel] is not None:
            ok(b is not None, f"rule {rules}: {rel} has the method {name} (a two-space-indented `{name}(args) {{` line)")
        bodies[key] = b
    return bodies[key]


def order(text, *parts):
    """Every part is in text, each after the one before (never raises: a missing part is a failed check)."""
    at = -1
    for p_ in parts:
        i = (text or "").find(p_, at + 1)
        if i < 0 or i <= at:
            return False
        at = i
    return True


def holds(b, cond, msg):
    """A check over a method body; skipped (its absence already failed) when there is none."""
    if b is not None:
        ok(cond(b), msg)


# ── rule 2: stageIntoPrompt( only in nav.js: its definition and one call, inside stageMessage ─────
outside = sorted(rel for rel, t in files.items() if rel != "nav.js" and "stageIntoPrompt(" in t)
ok(outside == [], f"rule 2: stageIntoPrompt( appears in no file but nav.js: {outside}")
ok(nav.count("stageIntoPrompt(") == 2, f"rule 2: nav.js holds stageIntoPrompt( twice (its definition and one call), not {nav.count('stageIntoPrompt(')}")
sm = function(nav, "stageMessage")
ok(sm is not None, "rule 2: nav.js exports stageMessage (Detail.md 3.2)")
holds(sm, lambda b: b.count("stageIntoPrompt(") == 1, "rule 2: the one call of stageIntoPrompt is inside stageMessage")
holds(sm, lambda b: "stageIntoPrompt(msg, terminal, cx, { paste: w.paste" in b, "rule 2: stageMessage hands the paste switch (w.paste) to stageIntoPrompt")
holds(sm, lambda b: "gate.pasting" in b and "PASTE.waitMs + 400" in b, "rule 2: stageMessage keeps one paste at a time per copy (gate.pasting, PASTE.waitMs + 400)")

# ── rule 3: stageMessage( outside nav.js only in reader.js, once, inside `stage` ───────────────────
outside = sorted(rel for rel, t in files.items() if rel != "nav.js" and "stageMessage(" in t)
ok([r for r in outside if r != "reader.js"] == [], f"rule 3: stageMessage( outside nav.js only in reader.js: {outside}")
ok(nav.count("stageMessage(") == 1, "rule 3: nav.js only defines stageMessage (no caller there)")
if reader is not None:
    ok(reader.count("stageMessage(") == 1, f"rule 3: reader.js calls stageMessage( exactly once, not {reader.count('stageMessage(')}")
st = body("reader.js", "stage", "3")
holds(st, lambda b: "stageMessage(this, msg, terminal, cx" in b, "rule 3: reader.js stage calls stageMessage(this, msg, terminal, cx, …): the copy is the gate")
holds(st, lambda b: "paste: this.pasteOn()" in b, "rule 3: reader.js stage passes paste: this.pasteOn() (ui.pasteIntoPrompt)")
holds(body("reader.js", "pasteOn", "3"), lambda b: "pasteIntoPrompt !== false" in b, "rule 3: reader.js pasteOn: ui.pasteIntoPrompt is on unless set false")

# ── rule 4: neither panel.js nor detail.js defines a stage( method: both stage through Reader's ────
for rel in ("panel.js", "detail.js"):
    if src[rel] is not None:
        ok(re.search(r"^  (?:async )?stage\(", src[rel], flags=re.M) is None, f"rule 4: {rel} defines no stage( method: it stages through Reader's")

# ── rule 5: the staging methods stage through this.stage( with their target ────────────────────────
holds(body("reader.js", "stageAnswers", "5, 7"), lambda b: "this.stage(msg, s.terminal, cx" in b, "rule 5: reader.js stageAnswers stages through this.stage(msg, s.terminal, cx, …)")
for name, target in (("askPinsHere", "s.terminal"), ("sendToTrunk", "ts.terminal"), ("copyConfluence", "ts?.terminal")):
    holds(body("detail.js", name, "5, 7"), lambda b, t=target: f"this.stage(msg, {t}, cx" in b, f"rule 5: detail.js {name} stages through this.stage(msg, {target}, cx, …)")

# sendToTrunk posts its `conclude` before it stages: paste off, no agent or an agent at its own prompt close
# the dialog inside the staging, and the event must already be in Reader `unwritten` for release() to write.
holds(body("detail.js", "sendToTrunk", "5, 7"), lambda b: 'this.post("conclude"' in b and b.index('this.post("conclude"') < b.index("this.stage(msg, ts.terminal, cx"),
      "rule 5: detail.js sendToTrunk posts conclude before this.stage( (a staging may close the dialog at once)")

# ── rule 6: the copy methods only copy ─────────────────────────────────────────────────────────────
COPY_BANNED = ("stage(", "stageMessage(", "stageIntoPrompt(", "stageText(", "stageQuestion(", "run(", "hc(", "exec(", "openOverlay(")
for name in ("copyPin", "copyPinsMessage", "copyText"):
    b = body("detail.js", name, "6, 7")
    holds(b, lambda b: "write_to_clipboard(" in b, f"rule 6: detail.js {name} writes the clipboard")
    for bad in COPY_BANNED:
        holds(b, lambda b, bad=bad: bad not in b, f"rule 6: detail.js {name} only copies, but calls {bad}")
holds(body("detail.js", "copyPinsMessage", "6, 7"), lambda b: "write_to_clipboard(promptText(pinsMessage(" in b,
      "rule 6: detail.js copyPinsMessage copies the whole pins message (marker first), as Ask here would paste it")

# ── rule 7: the staging and copy methods run nothing, open nothing, spawn nothing ──────────────────
SIDE = ("hc(", "run(", "exec(", "openOverlay(", "goTo", "spawn(")
for rel, names in (("reader.js", ("stage", "stageAnswers", "copyAnswers", "copyAnswer")),
                   ("detail.js", ("askPinsHere", "sendToTrunk", "copyConfluence", "copyPin", "copyPinsMessage", "copyText", "pasteSheet", "step",
                                  "unbreak", "saveNote", "retarget"))):
    for name in names:
        b = body(rel, name, "7")
        for bad in SIDE:
            holds(b, lambda b, bad=bad: bad not in b, f"rule 7: {rel} {name} calls {bad}")
# ⌘Enter in the dialog's answer box (2026-11-11): the turn's sheet through Reader copyAnswers (so through
# stageAnswers and the one door), nothing of its own; the box's Enter is a new line, never a paste.
holds(body("detail.js", "pasteSheet", "7"), lambda b: "this.copyAnswers(" in b and "stage(" not in b and "write_to_clipboard(" not in b,
      "rule 7: detail.js pasteSheet stages only through this.copyAnswers(")
holds(body("detail.js", "makeAnswer", "7"), lambda b: "TextareaState.new(" in b and re.search(r'on\("submit", \(e, cx\) => \{ if \(e\?\.secondary\) this\.pasteSheet\(', b) is not None,
      "rule 7: detail.js makeAnswer: a TextareaState whose submit pastes only with ⌘ (e.secondary), through pasteSheet")
# Review fixes (2026-11-11): ⌘Enter carries the box's own ask (copyAnswers' own id) after putting back a line
# break the keypress itself typed (unbreak: the box and the draft only); a sheet over the cap is refused
# before the one door; the answer box's change handler pastes nothing; a step leaves the keyboard on the
# dialog (retarget focuses this.keys, never a field: no focusFirst).
holds(body("detail.js", "pasteSheet", "7"), lambda b: "this.unbreak(" in b and b.index("this.unbreak(") < b.index("this.copyAnswers(")
      and "this.copyAnswers(s, it.anchor?.turn, cx, id)" in b, "rule 7: detail.js pasteSheet: unbreak first, then copyAnswers with its own ask")
holds(body("detail.js", "unbreak", "7"), lambda b: "set_value(" in b and "typeDraft(" in b and "copyAnswers(" not in b and "write_to_clipboard(" not in b,
      "rule 7: detail.js unbreak only sets the box and the draft back")
holds(body("detail.js", "makeAnswer", "7"), lambda b: "pasteSheet(" in b and b.count("pasteSheet(") == 1 and "copyAnswers(" not in b and "stage(" not in b,
      "rule 7: detail.js makeAnswer's change handler pastes nothing (pasteSheet only on ⌘ submit)")
holds(body("detail.js", "retarget", "7"), lambda b: "this.keys.focus()" in b and "focusFirst(" not in b and "answer.focus(" not in b,
      "rule 7: detail.js retarget (and so a step) puts the keyboard on the dialog itself, never in its answer box")
holds(body("reader.js", "stageAnswers", "7"), lambda b: "sheetOverCap(" in b and b.index("sheetOverCap(") < b.index("this.stage("),
      "rule 7: reader.js stageAnswers refuses a sheet over the cap before the one door")

# ── rule 8: one Stage /btw, in detail.js, for a question without pins; with pins, copyPinsMessage ──
BTW = re.compile(r"[\"'`]Stage /btw[\"'`]")
where = {rel: len(BTW.findall(t)) for rel, t in files.items() if BTW.search(t)}
ok(where == {"detail.js": 1}, f"rule 8: one Stage /btw, in detail.js: {where or 'none'}")
if detail is not None:
    i_pins, m_btw = detail.find("this.copyPinsMessage("), BTW.search(detail)
    i_btw = m_btw.start() if m_btw else -1
    if ok(0 <= i_pins < i_btw, "rule 8: detail.js offers Copy for prompt as this.copyPinsMessage( before, and apart from, Stage /btw"):
        cond = detail[detail.rfind("if (", 0, i_pins):i_pins]
        ok(re.search(r"[pP]ins\w*\.length", cond) is not None, f"rule 8: the branch that calls copyPinsMessage is the one for a question with pins: {cond.strip()[:120]}")
        ok(re.search(r"\}\s*else\b", detail[i_pins:i_btw]) is not None, "rule 8: Stage /btw is in the other branch (else): a question with pins offers no /btw")
        ok("stageQuestion(" in detail[i_btw:detail.find(";", i_btw)], "rule 8: Stage /btw goes through stageQuestion (clipboard plus focus)")

# ── rule 9: detail.js goTo and goToPin go through goToAnchor( and run nothing themselves ───────────
for name in ("goTo", "goToPin"):
    b = body("detail.js", name, "9")
    holds(b, lambda b: "goToAnchor(" in b, f"rule 9: detail.js {name} goes through nav.js goToAnchor")
    for bad in ("hc(", "run(", "exec("):
        holds(b, lambda b, bad=bad: bad not in b, f"rule 9: detail.js {name} calls {bad}")

# ── rule 10: panel.js stages nothing and goes to no anchor itself ──────────────────────────────────
if panel is not None:
    for bad in ("stageIntoPrompt(", "stageMessage(", "stageText(", "goToAnchor("):
        ok(bad not in panel, f"rule 10: panel.js calls {bad} (the list stages through Reader; the rest is the dialog's)")

# ── rule 11: detail.js afterStage decides with closesAfterStage( and closes only through this.close( ─
b = body("detail.js", "afterStage", "11")
holds(b, lambda b: "closesAfterStage(" in b, "rule 11: detail.js afterStage decides with closesAfterStage(")
holds(b, lambda b: "this.close(" in b, "rule 11: detail.js afterStage closes through this.close(")
holds(b, lambda b: "closeOverlay(" not in b, "rule 11: detail.js afterStage closes only through this.close(, never closeOverlay( itself")

# ── rule 12: the settings dialog only writes config.json (2026-11-10) ───────────────────────────────
# settings.js is held to the dialog's rules and more: no staging of any kind, nothing copied to or read from
# the clipboard, no command run, no overlay opened, no spool event; its one effect is config.json, through
# Reader saveConfig (reader.js editConfig, the compare-and-swap writer).
settings = files.get("settings.js")
ok(settings is not None, "rule 12: settings.js present")
if settings is not None:
    for bad in ("stage(", "stageMessage(", "stageIntoPrompt(", "stageText(", "stageQuestion(", "stageAnswers(", "copyAnswer", "copyText(",
                "write_to_clipboard(", "read_from_clipboard(", "goToAnchor(", "hc(", "run(", "exec(", "openOverlay(", "this.post(", "writeEvent(",
                "writeTextFile(", "terminal."):
        ok(bad not in settings, f"rule 12: settings.js calls {bad}")
    ok(re.search(r"^  (?:async )?stage\(", settings, flags=re.M) is None, "rule 12: settings.js defines no stage( method")
    herdr = re.search(r"^import \{([^}]*)\} from \"herdr\";", settings, flags=re.M)
    names = {n.strip() for n in herdr.group(1).split(",")} if herdr else set()
    ok(herdr is not None and not names & {"run", "hc", "exec", "openOverlay", "writeTextFile"}, f"rule 12: settings.js imports none of run, hc, exec, openOverlay, writeTextFile from herdr: {sorted(names)}")
    ok("./nav.js" not in settings, "rule 12: settings.js does not import nav.js")
    ok("this.saveConfig(" in settings, "rule 12: settings.js writes config.json through Reader saveConfig")
    sb = method(settings, "set")
    ok(sb is not None and "this.saveConfig(edit" in sb, "rule 12: settings.js set writes through this.saveConfig(edit, …)")
# The one writer of config.json among the reading copies: reader.js editConfig (panel.js has no saveConfig of its own).
if panel is not None:
    ok(re.search(r"^  saveConfig\(", panel, flags=re.M) is None and "writeTextFile(" not in panel, "rule 12: panel.js writes config.json only through Reader saveConfig")

# ── rule 13: a process starts only from opener.js, and only on a click (2026-11-10) ─────────────────
# Among the reading copies (every .js file but writer.js, whose extractor, branch launcher, `which claude` and
# the `mv` that puts a store.json past 1 MiB in place (writeLarge, 2026-11-12) are the writer's own), exec( is opener.js's alone, in four shapes: the argv links.js openerArgv built
# (openPath: open, zed, code or the person's command; openerArgv refuses a shell, an interpreter, a program
# that runs another, a terminal and a line break, wherever the command names them), open -R <path>
# (revealPath), git -C <cwd> rev-parse --show-toplevel (gitToplevel) and realpath <path> (realPathOf, which
# only reads: the open preset judges a link by where it leads), each with the 5 s limit. detail.js reaches them only through openPath (inside openLink, the link handler), revealPath
# (inside revealLink, the status line's Reveal in Finder) and gitToplevel (inside gitRootOf); no other file
# imports opener.js, and settings.js still runs nothing (rule 12).
# Since 2026-11-23, five shapes: the fifth is the pinned call of rule 1, /usr/bin/osascript -l JavaScript -e
# CLIP_SCRIPT <outPath> <CLIP_MAX> (clipboardImage), which runs only on the person's paste into the answer box
# (its paste_other) or their click on Paste image, never on ledgr's own initiative: clipboardImage refuses an
# outPath that is not absolute, holds a line break or NUL, is not a .png or is not directly in
# ledgr-data/attachments/ (clipRefusal) before it runs anything; detail.js calls it once, inside pasteImage. CLIP_SCRIPT
# is a constant (no interpolation) whose words cannot drive another application, press a key, run a shell,
# launch anything, change a pasteboard or reach the network, and whose one write creates its file and never
# writes over one. Since the second review (9.1) the script is pinned by identity: the copy below
# (CLIP_SCRIPT_PINNED, with its sha256) must equal opener.js's character for character, taken from the file as it
# is on disk; the word checks are the second line. opener.js takes exec and appHome from herdr and appRoot from
# detailing.js (clipDir and attach.js attachDir normalise Herdr's app folder one way).
EXEC = re.compile(r"(?<![.\w])exec\(")


def fn(text, name):
    """The body of a top-level function (exported or not, async or not), up to its closing brace."""
    m = re.search(rf"^(?:export )?(?:async )?function {name}\([^)]*\) \{{(.*?)^\}}$", text or "", flags=re.S | re.M)
    return m.group(1) if m else None


js = {rel: t for rel, t in files.items() if rel.endswith(".js")}
where = sorted(rel for rel, t in js.items() if EXEC.search(t))
ok(set(where) <= {"opener.js", "writer.js"}, f"rule 13: exec( only in opener.js (and writer.js's own launcher): {where}")
opener = files.get("opener.js")
ok(opener is not None, "rule 13: opener.js present")
if opener is not None:
    calls = sorted(opener[m.start():opener.find(")", opener.find("}", m.start())) + 1] for m in EXEC.finditer(opener))
    SHAPES = sorted(['exec(a.argv[0], a.argv.slice(1), { timeout: OPEN_TIMEOUT })', 'exec("open", ["-R", path], { timeout: OPEN_TIMEOUT })',
                     'exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: OPEN_TIMEOUT })',
                     'exec("realpath", [path], { timeout: OPEN_TIMEOUT })', PINNED_CALL])
    ok(calls == SHAPES, f"rule 13: opener.js runs openerArgv's argv, open -R, git rev-parse, realpath and the pinned clipboard call only, each with OPEN_TIMEOUT: {calls}")
    ok("export const OPEN_TIMEOUT = 5000;" in opener, "rule 13: the 5 s limit")
    op = fn(opener, "openPath") or ""
    ok("const a = openerArgv(setting, " in op and "if (a.error) return" in op and "exec(a.argv[0]" in op
       and op.index("await statAt(path)") < op.index("const a = openerArgv(") < op.index("if (a.error) return") < op.index("exec(a.argv[0]"),
       "rule 13: openPath looks for the path, takes its argv from links.js openerArgv, runs nothing when it refuses, then opens")
    ok("usesOpenPreset(setting) ? await realPathOf(path)" in op and op.index("await realPathOf(path)") < op.index("const a = openerArgv(")
       and "real });" in op, "rule 13: with the open preset, openPath asks where the path really leads before openerArgv judges it")
    rp = fn(opener, "realPathOf") or ""
    ok('exec("realpath", [path]' in rp and "isAbs(path)" in rp and "[\\r\\n\\0]" in rp, "rule 13: realPathOf runs realpath on an absolute path with no line break")
    rv = fn(opener, "revealPath") or ""
    ok('exec("open", ["-R", path]' in rv and "isAbs(path)" in rv, "rule 13: revealPath is open -R on an absolute path")
    herdr_imp = re.search(r'^import \{([^}]*)\} from "herdr";', opener, flags=re.M)
    ok(herdr_imp is not None and {n.strip() for n in herdr_imp.group(1).split(",")} == {"exec", "appHome"}, "rule 13: opener.js takes exec and appHome (clipDir) alone from herdr")
    # The script is pinned by identity (the second review, 9.1): taken from opener.js as it is on disk, it must be
    # CLIP_SCRIPT_PINNED below, character for character (sha256 CLIP_SHA256), and a plain template (no ${, no
    # backslash: its source is its value). Changing the script means changing this copy in the same commit. The
    # word checks after it are the second line. Its JavaScript (entry point `function run(argv)`) is taken out of
    # opener.js before the rest is checked for the calls below.
    cs = re.search(r"^export const CLIP_SCRIPT = `([^`]*)`;$", RAW.get("opener.js", ""), flags=re.M)
    script = cs.group(1) if cs else ""
    ok(cs is not None and RAW["opener.js"].count("export const CLIP_SCRIPT = `") == 1 and "${" not in script and "\\" not in script,
       "rule 13: CLIP_SCRIPT is one plain constant template in opener.js (nothing interpolated, no escape)")
    ok(hashlib.sha256(CLIP_SCRIPT_PINNED.encode("utf-8")).hexdigest() == CLIP_SHA256, "rule 13: the pinned copy is the one its sha256 names")
    ok(script == CLIP_SCRIPT_PINNED and hashlib.sha256(script.encode("utf-8")).hexdigest() == CLIP_SHA256,
       f"rule 13: CLIP_SCRIPT is the pinned script, character for character (sha256 {hashlib.sha256(script.encode('utf-8')).hexdigest()}, pinned {CLIP_SHA256})")
    code = opener.replace(script, "", 1) if script and script in opener else opener
    for bad in ("hc(", "run(", "terminal.", "openOverlay(", "write_to_clipboard(", "open_url("):
        ok(bad not in code, f"rule 13: opener.js calls {bad}")
    for bad in ("Application(", "System Events", "keystroke", "key code", "doShellScript", "do shell script", "NSTask", "NSAppleScript", "NSWorkspace",
                "clearContents", "setString", "setData", "writeObjects", "declareTypes", "http",
                "setPropertyList", "prepareForNewContents", "releaseGlobally", "NSURL", "ContentsOfURL", "NSUserDefaults", "NSProcessInfo"):
        ok(bad not in script, f"rule 13: CLIP_SCRIPT holds {bad}")
    ok(re.findall(r"write\w*", script, flags=re.I) == ["writeToFileOptionsError"] and "$.NSDataWritingWithoutOverwriting" in script and "Atomic" not in script
       and not re.search(r"createDirectory|createFile|removeItem|moveItem|copyItem|linkItem|replaceItem|trashItem|setAttributes|NSFileManager|NSFileHandle|system\(|ObjC\.import\('(?!AppKit')", script),
       "rule 13: CLIP_SCRIPT's one write creates its file and never writes over one (writeToFileOptionsError, NSDataWritingWithoutOverwriting); no folder made, nothing moved, removed or linked, AppKit alone imported")
    ok("dataForType(" in script and "initWithPasteboard(" in script and "pasteboardWithName(name)" in script and "generalPasteboard" in script
       and order(script, "if (n > max) throw", "writeToFileOptionsError"),
       "rule 13: CLIP_SCRIPT reads the pasteboard and refuses an image over the limit before it writes")
    ci = fn(opener, "clipboardImage") or ""
    ok(order(ci, "clipRefusal(outPath)", "if (refused) return", PINNED_CALL),
       "rule 13: clipboardImage refuses a bad outPath (clipRefusal) before it runs the pinned call")
    cr = fn(opener, "clipRefusal") or ""
    ok("isAbs(p)" in cr and "[\\r\\n\\0]" in cr and "\\.png$" in cr and "at = clipDir()" in cr and "if (!at) return" in cr and "dir !== at || !CLIP_NAME.test(name)" in cr,
       "rule 13: clipRefusal: absolute, no line break or NUL, a .png, an attachment's name, directly in clipDir() (none known: refused)")
    ok("const CLIP_NAME = /^\\d{8}-\\d{6}-[0-9a-z]{6}\\.png$/;" in opener, "rule 13: CLIP_NAME is an attachment's PNG name, <yyyymmdd>-<hhmmss>-<rand6>.png")
    ok("export const clipDir = () => { const r = appRoot(appHome()); return r ? `${r}/ledgr-data/attachments` : null; };" in opener,
       "rule 13: clipDir is ledgr-data/attachments/ in the app's folder, normalised by detailing.js appRoot (as attach.js attachDir), none without one")
    imps = [m.group(1) for m in re.finditer(r'^import [^;]* from "([^"]+)";$', opener, flags=re.M)]
    ok(imps == ["herdr", "fs/promises", "./links.js", "./detailing.js"] and 'import { appRoot } from "./detailing.js";' in opener,
       f"rule 13: opener.js imports herdr, fs/promises, links.js and appRoot from detailing.js only: {imps}")
links = files.get("links.js")
ok(links is not None, "rule 13: links.js present")
if links is not None:
    ok(re.search(r"^import ", links, flags=re.M) is None, "rule 13: links.js imports nothing (it runs nothing)")
    shells = re.search(r"export const SHELLS = new Set\((.*?)\.split\(", links, flags=re.S)
    names = set(" ".join(re.findall(r'"([^"]*)"', shells.group(1))).split()) if shells else set()
    ok({"sh", "bash", "zsh", "fish", "env", "hc", "herdr", "sudo", "tmux", "python3", "node"} <= names, "rule 13: links.js SHELLS names the shells, interpreters and terminal drivers it refuses")
    rc = fn(links, "refusedCommand") or ""
    ok("runner(a)" in rc and "for (const a of all ? argv" in rc and "TERMINAL_APP.test(" in rc and "launches(app)" in rc
       and "[\\r\\n\\0]" in rc and "PLACEHOLDER.test(argv[0])" in rc,
       "rule 13: refusedCommand refuses a shell, an interpreter or a runner in any argument, a terminal, open -a/-b naming a launcher, a line break and the clicked file as the program")
    ru = fn(links, "runner") or ""
    ok("SHELLS.has(low)" in ru and "INTERP.test(low)" in ru and "RUNNER.test(low)" in ru, "rule 13: runner checks the shells, versioned interpreters and AppleScript runners")
    oa = fn(links, "openerArgv") or ""
    ok("refusedCommand(tpl)" in oa and "refusedCommand(argv, false)" in oa and "[\\r\\n\\0]" in oa and "isAbs(p)" in oa, "rule 13: openerArgv checks the command before and after the path is put in; only absolute paths, no line break")
    ok(re.search(r'argv: \["open", "-R", p\]', oa) and re.search(r'argv: \["open", "-t", p\]', oa) and "real === null" in oa,
       "rule 13: the open preset reveals an app and opens a script as text, and reveals a path whose real place is not known")
if detail is not None:
    dh = re.search(r'^import \{([^}]*)\} from "herdr";', detail, flags=re.M)
    ok(dh is not None and "exec" not in {n.strip() for n in dh.group(1).split(",")}, "rule 13: detail.js does not import exec")
    do = re.search(r'^import \{([^}]*)\} from "\./opener\.js";', detail, flags=re.M)
    ok(do is not None and {n.strip() for n in do.group(1).split(",")} == {"openPath", "revealPath", "gitToplevel", "statAt", "clipboardImage"},
       "rule 13: detail.js takes openPath, revealPath, gitToplevel, statAt and clipboardImage from opener.js")
    for name, host in (("openPath(", "openLink"), ("revealPath(", "revealLink"), ("gitToplevel(", "gitRootOf"), ("clipboardImage(", "pasteImage")):
        b = body("detail.js", host, "13") or ""
        ok(detail.count(name) == 1 and name in b, f"rule 13: detail.js calls {name} once, inside {host}")
    ol = body("detail.js", "openLink", "13") or ""
    ok('l.kind === "web"' in ol and "cx.open_url(l.url)" in ol and ol.index("cx.open_url(") < ol.index("openPath("), "rule 13: openLink hands a web link to cx.open_url (http and https only)")
    ok(detail.count("open_url(") == 1, "rule 13: cx.open_url only in openLink")
importers = sorted(rel for rel, t in js.items() if re.search(r'from "\./opener\.js"', t))
ok(importers == ["detail.js"], f"rule 13: only detail.js imports opener.js: {importers}")
if settings is not None:
    ok("./opener.js" not in settings and "open_url(" not in settings, "rule 13: settings.js opens nothing (rule 12)")
vw = files.get("views.js") or ""
ok("open_url(" in (re.search(r"^export function webOnly\(url, cx\) \{(.*?)^\}$", vw, flags=re.S | re.M) or [None, ""])[1]
   and vw.count("open_url(") == 1 and 'l.kind === "web"' in vw, "rule 13: views.js opens only a web link, in webOnly, when no handler of the dialog's is given")

# ── rule 14: the archive (retention, 2026-11-19) ───────────────────────────────────────────────────
# Only the writer writes under ledgr-data/archive/, and only new files: spool.js writeNew (create-only, then
# read back) is called from writer.js archiveLines alone, which names each file
# archive/<dir>/<kind>-<ms>-<rand6>.jsonl; the one other write there is housekeep's mkdir of the session's
# folder (the old month-file append is gone). No other file hands a path naming the archive to a write. The
# reading copies only read it: Reader loadArchive, namesIn and demoArchiveOf write, post, stage and run
# nothing, nor do the panel's and the dialog's readArchive; the dialog's Reopen (detail.js reopenArchived)
# posts the one restore event and stages, copies, runs and execs nothing.
WRITE = re.compile(r"\b(writeTextFile|writeFile|writeAtomic|writeAtomicWith|writeLarge|writeNew|writeEvent|mkdir|rename|appendFile|unlink|rm|cp|copyFile)\(([^;\n]*)")
writer_js = files.get("writer.js") or ""
for rel, t in js.items():
    hits = [m for m in WRITE.finditer(t) if "archive" in m.group(2).lower()]
    if rel != "writer.js":
        ok(hits == [], f"rule 14: {rel} writes under archive/: {[m.group(0)[:80] for m in hits]}")
hk = method(writer_js, "housekeep")
ok(hk is not None, "rule 14: writer.js has the method housekeep")
whole = [m.group(0) for m in WRITE.finditer(writer_js) if "archive" in m.group(2).lower()]
inside = [m.group(0) for m in WRITE.finditer(hk or "") if "archive" in m.group(2).lower()]
ok(whole == inside and all(x.startswith("mkdir(") for x in inside), f"rule 14: writer.js names the archive in a write only in housekeep, its folder's mkdir: {whole}")
ok("writeAtomicWith(" not in (hk or "") and "writeAtomic(" not in (hk or ""), "rule 14: housekeep appends to no file (the month files are never written again)")
where = sorted(rel for rel, t in js.items() if "writeNew(" in t)
ok(where == ["spool.js", "writer.js"], f"rule 14: writeNew( only in spool.js (its definition) and writer.js: {where}")
ok((files.get("spool.js") or "").count("writeNew(") == 1 and "export async function writeNew(" in (files.get("spool.js") or ""), "rule 14: spool.js only defines writeNew")
wn = fn(files.get("spool.js"), "writeNew") or ""
ok("writeTextFile(path, text, null)" in wn and "readTextFile(path)" in wn and wn.index("writeTextFile(path, text, null)") < wn.index("readTextFile(path)"),
   "rule 14: writeNew creates only (writeTextFile's expected null) and reads the file back")
al = method(writer_js, "archiveLines")
# writeNew( in writer.js: exactly three calls, one in each of archiveLines (the archive), freezeRun (a cold
# file, retention Phase 2) and holdEvent (a held event's copy under cold/held/); nowhere else.
NEW_CALLERS = ("archiveLines", "freezeRun", "holdEvent")
inside_new = {name: (method(writer_js, name) or "").count("writeNew(") for name in NEW_CALLERS}
ok(writer_js.count("writeNew(") == 3 and inside_new == {name: 1 for name in NEW_CALLERS},
   f"rule 14: writer.js calls writeNew( exactly once in each of archiveLines, freezeRun and holdEvent and nowhere else: {inside_new}, {writer_js.count('writeNew(')} in all")
ok(al is not None and "`archive/${dir}/${kind}-${ms}-${rand6()}.jsonl`" in al, "rule 14: archiveLines names each file archive/<dir>/<kind>-<ms>-<rand6>.jsonl")
READ_ONLY_BANNED = ("writeTextFile(", "writeEvent(", "writeNew(", "this.post(", "writeFile(", "mkdir(", "rename(", "unlink(", "rm(", "appendFile(",
                    "stage(", "stageMessage(", "stageIntoPrompt(", "run(", "exec(", "hc(", "setShared(", "write_to_clipboard(", "openOverlay(")
for rel, name in (("reader.js", "loadArchive"), ("reader.js", "readArchiveWithin"), ("reader.js", "demoArchiveOf"), ("panel.js", "readArchive"),
                  ("detail.js", "readArchive"), ("detail.js", "archiveFor"), ("detail.js", "lookInArchive"), ("detail.js", "archiveAgain")):
    b = body(rel, name, "14")
    for bad in READ_ONLY_BANNED:
        holds(b, lambda b, bad=bad: bad not in b, f"rule 14: {rel} {name} only reads, but calls {bad}")
na = fn(reader, "namesIn")
ok(na is not None and "fs.readdir(" in na and not any(bad in na for bad in READ_ONLY_BANNED), "rule 14: reader.js namesIn only lists a folder")
ra = body("detail.js", "reopenArchived", "14")
holds(ra, lambda b: b.count("this.post(") == 1 and 'this.post("restore", { session_id: sid, item: it.id, file, reopen: true }' in b,
      "rule 14: detail.js reopenArchived posts one event, the contract's restore {session_id, item, file, reopen: true}")
for bad in ("stage(", "stageMessage(", "stageIntoPrompt(", "stageText(", "stageQuestion(", "copyAnswer", "write_to_clipboard(", "run(", "hc(", "exec(",
            "openOverlay(", "writeEvent(", "writeTextFile(", "goTo", "spawn("):
    holds(ra, lambda b, bad=bad: bad not in b, f"rule 14: detail.js reopenArchived calls {bad}")

# ── rule 15: cold sessions (retention Phase 2, 2026-11-19) ─────────────────────────────────────────
# Only the writer writes under ledgr-data/cold/: writer.js and spool.js (writeNew, and quarantine's unlink of a
# replayed held copy) are the only files whose writes, unlinks, mkdirs or rmdirs name it (config.js coldDir,
# coldPath, heldDir, or a cold/ path); config.js only names the paths. In writer.js those calls sit in the
# freeze (freezeRun), the sweep (coldSweep), holding (holdEvent) and the replay's clean-up (coldDone) alone,
# each cold file is written once, under coldName (cold/<safe sid>.<ms>-<rand6>.json), never rewritten, and the
# sweep deletes only what store.js coldGarbage names. The reading copies only read a cold file: Reader's cold
# methods write, post, stage and run nothing, but for Try again (coldRetry, one cold_retry) and Use without its
# older items (coldReset, one cold_reset); heldDir( is the writer's alone. The Python readers (bin/lib,
# bin/mcp) open cold files to read only.
COLDW = re.compile(r"\b(writeTextFile|writeFile|writeAtomic|writeAtomicWith|writeLarge|writeNew|writeEvent|mkdir|rmdir|rename|appendFile|unlink|rm|cp|copyFile)\(([^;\n]*)")
names_cold = lambda a: bool(re.search(r"coldDir\(|coldPath\(|heldDir\(|cold/", a))
for rel, t in js.items():
    hits = [m.group(0)[:80] for m in COLDW.finditer(t) if names_cold(m.group(2))]
    if rel not in ("writer.js", "spool.js"):
        ok(hits == [], f"rule 15: {rel} writes, unlinks, makes or removes under cold/: {hits}")
users = sorted(rel for rel, t in js.items() if "heldDir(" in t)
ok(users == ["writer.js"] and "export const heldDir = (sid) =>" in (files.get("config.js") or ""), f"rule 15: heldDir( called only in writer.js (config.js defines it): {users}")
COLD_WRITERS = ("freezeRun", "coldSweep", "holdEvent", "coldDone", "heldEvents", "listHeld", "readCold")
spans = {name: method(writer_js, name) for name in COLD_WRITERS}
for name, b in spans.items():
    ok(b is not None, f"rule 15: writer.js has the method {name}")
cold_calls = [m.group(0)[:80] for m in COLDW.finditer(writer_js) if names_cold(m.group(2))]
cold_inside = [m.group(0)[:80] for name in ("freezeRun", "coldSweep", "holdEvent", "coldDone") for m in COLDW.finditer(spans[name] or "") if names_cold(m.group(2))]
ok(sorted(cold_calls) == sorted(cold_inside) and cold_calls, f"rule 15: writer.js names cold/ in a write only in freezeRun, coldSweep, holdEvent and coldDone: {cold_calls}")
for name in ("readCold", "heldEvents", "listHeld"):
    holds(spans[name], lambda b: not COLDW.search(b), f"rule 15: writer.js {name} only reads")
fr = spans["freezeRun"] or ""
ok("coldName(" in fr and "writeNew(coldPath(file)" in fr and "commitFreeze(" in fr and fr.index("writeNew(coldPath(file)") < fr.index("commitFreeze("),
   "rule 15: freezeRun writes each file new (writeNew, under coldName) before commitFreeze names it")
sw = spans["coldSweep"] or ""
ok("coldGarbage(" in sw and "this.live.toText() !== this.storeText" in sw and sw.index("coldGarbage(") < sw.index("fs.unlink(coldPath(name))"),
   "rule 15: coldSweep deletes only what coldGarbage names, decided from a store equal to store.json on disk")
ok(writer_js.count("fs.unlink(coldPath(") == 3 and (spans["coldSweep"] or "").count("fs.unlink(coldPath(") == 2,
   f"rule 15: writer.js unlinks a cold file in three places only (a freeze's uncommitted file; the sweep's by name and by content): {writer_js.count('fs.unlink(coldPath(')}")
# Integration (2026-11-19, the review's blocker): the sweep's second unlink comes only after a read and coldLacks
# (a file provably redundant), and coldGarbage, the by-name rule, has no rule that deletes a warm session's file
# for being unnamed and touched since.
sw2 = spans["coldSweep"] or ""
ok("fs.unlink(coldPath(c.name))" in sw2 and "coldLacks(" in sw2 and "readCold(" in sw2
   and sw2.index("readCold(") < sw2.index("coldLacks(") < sw2.index("fs.unlink(coldPath(c.name))") and "lack.items || lack.turns" in sw2,
   "rule 15: coldSweep removes an unnamed file by content only after reading it and finding nothing store.json lacks")
cg = method(files.get("store.js"), "coldGarbage") or ""
ok(cg and "touchedAt(" not in cg and "thawedEntry(" in cg, "rule 15: store.js coldGarbage deletes by name only a thawed (listed) or a forgotten session's file")
holds(method(writer_js, "archiveCopies"), lambda b: not COLDW.search(b), "rule 15: writer.js archiveCopies only reads")
COLD_READERS = ("coldOf", "coldDue", "coldLoading", "wantCold", "coldLoaded", "mergeColdAll", "dropColdUnnamed", "trimColdCache", "coldOthers")
for name in COLD_READERS:
    b = body("reader.js", name, "15")
    for bad in READ_ONLY_BANNED:
        holds(b, lambda b, bad=bad: bad not in b, f"rule 15: reader.js {name} only reads, but calls {bad}")
mca = body("reader.js", "mergeColdAll", "15")
holds(mca, lambda b: "this.writer.live" in b, "rule 15: reader.js mergeColdAll never merges into the fallback writer's live store")
wc = body("reader.js", "wantCold", "15")
holds(wc, lambda b: "fs.readFile(coldPath(file)" in b and "COLD_NAME.test(file)" in b, "rule 15: reader.js wantCold reads only a name of the writer's shape, in cold/")
for name, ev in (("coldRetry", "cold_retry"), ("coldReset", "cold_reset")):
    b = body("reader.js", name, "15")
    holds(b, lambda b, ev=ev: b.count("this.post(") == 1 and f'this.post("{ev}", {{ session_id: sid, file: c.file }}' in b,
          f"rule 15: reader.js {name} posts one event, {ev} {{session_id, file}}")
    for bad in [x for x in READ_ONLY_BANNED if x != "this.post("]:
        holds(b, lambda b, bad=bad: bad not in b, f"rule 15: reader.js {name} calls {bad}")
for rel, t in files.items():
    if not rel.endswith(".py"):
        continue
    for i, ln in enumerate(t.split("\n")):
        if re.search(r"[\"']cold[\"']|cold/|[\"']held[\"']", ln):
            ok(not re.search(r"\bos\.(remove|unlink|makedirs|mkdir|rmdir|replace|rename)\(|shutil\.|\bopen\(.*,\s*(mode\s*=\s*)?[\"'][rbt]*[wax+][rwxab+t]*[\"']", ln),
               f"rule 15: {rel}:{i + 1} changes something under cold/: {ln.strip()[:100]}")

# ── rule 16: an image in an answer (2026-11-23) ───────────────────────────────────────────────────
# Only attach.js writes or makes anything under ledgr-data/attachments/: its two writes are the folder's mkdir
# (prepareSlot) and copyIn's fs.writeFile of a dropped file's bytes to the name prepareSlot found free (it looks
# before it takes a name: nothing is written over); no other file hands a write a path naming the folder. The
# clipboard's PNG is written by opener.js CLIP_SCRIPT (rule 13): opener.js passes it a path and writes nothing
# itself. Nothing anywhere unlinks, removes, renames or overwrites there: attach.js has no unlink, rm, rmdir,
# rename or copy call at all. attach.js starts no process and touches no terminal or clipboard (no exec(, hc(,
# run(, terminal., write_to_clipboard( or read_from_clipboard(), only detail.js imports it, and it is no
# engine file (below).
attach = files.get("attach.js")
ok(attach is not None, "rule 16: attach.js present")
attach = attach or ""
names_att = lambda a: bool(re.search(r"attachDir\(|attachments|ATTACH|slot\.path", a))
for rel, t in js.items():
    if rel == "attach.js":
        continue
    hits = [m.group(0)[:80] for m in COLDW.finditer(t) if names_att(m.group(2))]
    ok(hits == [], f"rule 16: {rel} writes, unlinks, makes or removes under attachments/: {hits}")
ok(sorted(m.group(1) for m in COLDW.finditer(attach)) == ["mkdir", "writeFile"], f"rule 16: attach.js's only writes are one mkdir and one writeFile: {[m.group(0)[:60] for m in COLDW.finditer(attach)]}")
ok("fs.mkdir(attachDir(), { recursive: true })" in attach and "fs.writeFile(slot.path, bytes)" in attach, "rule 16: attach.js makes ledgr-data/attachments/ and writes the copy to the slot prepareSlot found")
ps = fn(attach, "prepareSlot") or ""
ok(order(ps, "`${attachDir()}/${attachName(", "existsAt(path)", "return { ok: true, path }"),
   "rule 16: prepareSlot takes a name in ledgr-data/attachments/ only when nothing is there")
ci_ = fn(attach, "copyIn") or ""
ok(order(ci_, "const slot = await prepareSlot(", "fs.writeFile(slot.path, bytes)", "fs.readFile(slot.path)"),
   "rule 16: copyIn writes only to prepareSlot's path, then reads the copy back")
ok(not EXEC.search(attach), "rule 16: attach.js calls exec( (a RegExp's .exec is not a process)")
for bad in ("hc(", "run(", "terminal.", "write_to_clipboard(", "read_from_clipboard(", "unlink(", "rmdir(", "rename(", "copyFile(", "openOverlay(", "this.post("):
    ok(bad not in attach, f"rule 16: attach.js calls {bad}")
ok(not COLDW.search(opener or ""), "rule 16: opener.js writes nothing itself (CLIP_SCRIPT writes the clipboard's PNG to the path it is given)")
att_importers = sorted(rel for rel, t in js.items() if re.search(r'from "\./attach\.js"', t))
ok(att_importers == ["detail.js"], f"rule 16: only detail.js imports attach.js: {att_importers}")
pi = body("detail.js", "pasteImage", "16") or ""
ok(order(pi, "if (this.demo)", "if (this.attachBusy())", "this.attachRoom(", "clipboardImage("),
   "rule 16: detail.js pasteImage checks the demo, one at a time, the fifth image and the room before the clipboard is read")
ok("within(cx, ATTACH.clipMs, clipboardImage(slot.path)" in pi, "rule 16: detail.js pasteImage bounds the clipboard's run (within)")
# Who may start it (the second review, 9.2): pasteImage( appears in detail.js twice (its definition and the box's
# paste_other handler) and in views.js once (Paste image in attachRow), nowhere else; attachRow( is defined in
# views.js and called once, from detail.js answerSection; clipboardImage( is called once, inside pasteImage
# (rule 13). So nothing but the person's ⌘V in the box or their click on Paste image runs the clipboard's reader.
counts = {rel: t.count("pasteImage(") for rel, t in js.items() if "pasteImage(" in t}
ok(counts == {"detail.js": 2, "views.js": 1}, f"rule 16: pasteImage( only in detail.js (its definition, the paste_other handler) and views.js (Paste image): {counts}")
ok(re.search(r"^  pasteImage\(id, cx\) \{$", detail or "", flags=re.M) is not None, "rule 16: detail.js defines pasteImage(id, cx)")
ar = re.search(r"^export function attachRow\([^)]*\) \{$(.*?)^\}$", files.get("views.js", ""), flags=re.S | re.M)
ok(ar is not None and ar.group(1).count("pasteImage(") == 1 and "(_e, cx) => host.pasteImage(id, cx)" in ar.group(1),
   "rule 16: views.js calls pasteImage only from attachRow, as the Paste image control's click")
ar_calls = {rel: t.count("attachRow(") for rel, t in js.items() if "attachRow(" in t}
asec = body("detail.js", "answerSection", "16") or ""
ok(ar_calls == {"detail.js": 1, "views.js": 1} and asec.count("attachRow(") == 1, f"rule 16: attachRow is defined in views.js and called once, from detail.js answerSection: {ar_calls}")
# An image's path that arrives in the box as text (2026-11-23, after the live check: a capture tool's clipboard or a
# drop on the text puts the file's path there): makeAnswer's change handler makes one call, pathsIn; pathsIn and
# attachPathLine take the file in only through attach.js copyIn (fs: rule 16 above) and reach no clipboard reader,
# no process, no pasteImage and no clipboard.
holds(body("detail.js", "makeAnswer", "16"), lambda b: b.count("this.pathsIn(") == 1 and "this.pathsIn(id, before, v, cx);" in b,
      "rule 16: makeAnswer's change handler makes one call for a path that arrived in the box, pathsIn")
for name in ("pathsIn", "attachPathLine"):
    holds(body("detail.js", name, "16"), lambda b: not EXEC.search(b) and not any(x in b for x in ("clipboardImage(", "pasteImage(", "run(", "hc(", "write_to_clipboard(",
          "read_from_clipboard(", "writeFile(", "mkdir(", "unlink(")), f"rule 16: detail.js {name} reaches no clipboard reader, process or write of its own")
holds(body("detail.js", "attachPathLine", "16"), lambda b: b.count("copyIn(") == 1 and "await copyIn(f.src, cx)" in b, "rule 16: detail.js attachPathLine takes the file in through copyIn alone")
holds(body("detail.js", "makeAnswer", "16"), lambda b: 'inp.on("paste_other", (_e, cx) => this.pasteImage(id, cx));' in b and b.count("pasteImage(") == 1 and "clipboardImage(" not in b,
      "rule 16: makeAnswer's paste_other only calls pasteImage")

# ── the engine rule (Detail.md 5.2): engine files never import the reading or staging modules ──────
m = re.search(r"export const ENGINE_FILES = (\[[^\]]*\])", files.get("writer.js", ""))
engine = json.loads(m.group(1)) if m else None
ok(isinstance(engine, list) and "store.js" in engine, "engine rule: writer.js ENGINE_FILES found")
NOT_ENGINE = {"reader.js", "listing.js", "detailing.js", "views.js", "detail.js", "words.js", "nav.js", "settings.js", "links.js", "opener.js", "attach.js"}
ok("attach.js" not in (engine or []), "engine rule: attach.js is not an engine file")
for f in engine or []:
    imports = re.findall(r"^import\s[^;]*?from\s+[\"']\./([^\"']+)[\"']", files.get(f, ""), flags=re.M)
    bad = sorted(set(imports) & NOT_ENGINE)
    ok(not bad, f"engine rule: {f} imports {bad}")

if failures:
    print(f"FAIL: no keystrokes, {len(failures)} of {checks} checks failed (first: {failures[0]})")
    sys.exit(1)
print(f"OK: no keystrokes, {checks} checks")
