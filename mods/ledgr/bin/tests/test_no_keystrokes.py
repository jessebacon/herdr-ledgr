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
zed, code or their own command), never a shell, never a terminal, never with a line break. A static check
over the mod's own source (comments are stripped first, so the rule may be written down); the runtime
half is tests/test_nav.mjs and tests/test_links.mjs.

Every check runs and every failure is printed (a file not written yet is named once, with the rules
that wait on it); the last line is the summary run-all.sh shows.
    python3 -I -B tests/test_no_keystrokes.py
"""
import json
import os
import re
import sys

BIN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.dirname(BIN)
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

# ── rule 1: the forbidden patterns everywhere; terminal.paste is nav.js's alone ──────────────────
for rel, text in files.items():
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
    """The body of a two-space-indented class method (`  name(args) {`, `async` allowed), one line or
    many: from its opening brace to the brace that closes it (counted, so a one-line method never runs
    on into the next). None when the file or the method is not there."""
    if text is None:
        return None
    m = re.search(rf"^  (?:async )?{name}\([^)]*\) \{{", text, flags=re.M)
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
                     'exec("realpath", [path], { timeout: OPEN_TIMEOUT })'])
    ok(calls == SHAPES, f"rule 13: opener.js runs openerArgv's argv, open -R, git rev-parse and realpath only, each with OPEN_TIMEOUT: {calls}")
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
    ok(herdr_imp is not None and {n.strip() for n in herdr_imp.group(1).split(",")} == {"exec"}, "rule 13: opener.js takes exec alone from herdr")
    for bad in ("hc(", "run(", "terminal.", "openOverlay(", "write_to_clipboard(", "open_url("):
        ok(bad not in opener, f"rule 13: opener.js calls {bad}")
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
    ok(do is not None and {n.strip() for n in do.group(1).split(",")} == {"openPath", "revealPath", "gitToplevel", "statAt"}, "rule 13: detail.js takes openPath, revealPath, gitToplevel and statAt from opener.js")
    for name, host in (("openPath(", "openLink"), ("revealPath(", "revealLink"), ("gitToplevel(", "gitRootOf")):
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

# ── the engine rule (Detail.md 5.2): engine files never import the reading or staging modules ──────
m = re.search(r"export const ENGINE_FILES = (\[[^\]]*\])", files.get("writer.js", ""))
engine = json.loads(m.group(1)) if m else None
ok(isinstance(engine, list) and "store.js" in engine, "engine rule: writer.js ENGINE_FILES found")
NOT_ENGINE = {"reader.js", "listing.js", "detailing.js", "views.js", "detail.js", "words.js", "nav.js", "settings.js", "links.js", "opener.js"}
for f in engine or []:
    imports = re.findall(r"^import\s[^;]*?from\s+[\"']\./([^\"']+)[\"']", files.get(f, ""), flags=re.M)
    bad = sorted(set(imports) & NOT_ENGINE)
    ok(not bad, f"engine rule: {f} imports {bad}")

if failures:
    print(f"FAIL: no keystrokes, {len(failures)} of {checks} checks failed (first: {failures[0]})")
    sys.exit(1)
print(f"OK: no keystrokes, {checks} checks")
