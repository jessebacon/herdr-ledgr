#!/usr/bin/env python3
"""ledgr installer, doctor and uninstaller. Run through ./install.sh, ./install.sh --check and
./uninstall.sh (POSIX sh wrappers that find python3). Standard library only.

  install     preflight, questions (each with a one-line why; defaults in brackets are the
              current values), a plan, then: deploy the mods, write config.json, store the API
              key in the Keychain, merge key bindings, patch one personal layout, register the
              Claude Code hooks, run `herdr-app check` and the offline tests, print a summary.
  check       the doctor: everything the preflight checks, plus whether the hooks fire, whether a
              writer holds the role and applies events, store.json's size and retention (the archive,
              housekeeping's last run, the one-time copy, the cold sessions and their held events),
              whether the Keychain item resolves.
  --thaw-all  writes retention.coldDays 0 to ledgr-data/config.json (after a backup; asks first unless
              --yes) and waits up to 120 s until no session is cold (every session's items back in
              store.json): the first step of a rollback to a build before cold sessions. Reads the
              rest; exits 1 with what to do when sessions stay cold.
  uninstall   writes the current choices to <state>/last-install.json, then reverses hooks, key
              bindings, layout blocks and mods: it restores the files saved before ledgr first
              touched them when only ledgr's entries differ, and otherwise removes ledgr's entries
              alone. ledgr-data/ only after a separate yes. Never touches the Keychain item.

Answers come from (later wins): built-in defaults, what is installed now, --answers FILE
(ledgr.install.json), and flags. --yes takes every default without asking.
Claude settings: ~/.claude/settings.json, plus every other Claude config folder chosen (a Claude Code
started with CLAUDE_CONFIG_DIR, such as a second account, reads that folder's settings.json). The
answers key `claude_settings` is a list (a single string is accepted); `--claude-settings` repeats.
Install state, backups and the saved originals live in ~/.local/state/ledgr (--state-dir)."""
import argparse
import datetime
import getpass
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser("~")
MOD, CHIP = "ledgr", "ledgr-pane"
MIN_HERDR = (0, 1, 13)
MIN_PY = (3, 9)
HOOKS = [("SessionStart", "session-start.sh"), ("UserPromptSubmit", "user-prompt-submit.sh"), ("Stop", "stop.sh")]
HOOK_MARK = "mods/ledgr/bin/adapters/"
# ledgr's MCP server (mods/ledgr/bin/mcp/README.md): registered with Claude Code at user scope, once per
# chosen config folder, plus these allow entries in that folder's settings file so a call never prompts.
# A tool added later goes at the end: an earlier install's file gains it there (apply_mcp appends the
# missing ones), so a fresh file and an upgraded one read the same; --check names a missing one.
MCP_NAME = "ledgr"
MCP_TOOLS = ["mcp__ledgr__declare_asks", "mcp__ledgr__open_asks", "mcp__ledgr__parked_questions",
             "mcp__ledgr__resolve_asks"]
AGENTS = [("claude", "Claude Code", True), ("codex", "Codex", False), ("gemini", "Gemini CLI", False),
          ("opencode", "OpenCode", False)]
PROVIDERS = [("anthropic", "Anthropic API (Claude Haiku; an API key in the Keychain)"),
             ("openai-compatible", "an OpenAI-compatible server (base URL and model; key optional)"),
             ("cli", "`claude -p` on your Claude Code subscription (no key; slower; untested end to end)"),
             ("none", "no model: asks come only from a fenced ledgr-asks block the agent writes")]
DEFAULT_MODEL = {"anthropic": "claude-haiku-5-5", "openai-compatible": "", "cli": "haiku", "none": "claude-haiku-5-5"}
THRESHOLDS = [("blocking", "blocking only"), ("needed", "blocking + needed (default)"), ("optional", "everything")]
# asks.handoff in config.json: who owns the closing list the agent gives you.
HANDOFFS = [("ledgr", "ledgr (default): the agent keeps blocking and needed items out of its reply and ends with one line, "
                      "\"ledgr: N items for you, M blocking\"; the list lives in the panel, the terminal's last screen stays the work's"),
            ("both", "both: the reply lists them as usual and the agent declares them to ledgr as well; more lines in the terminal"),
            ("prose", "prose: no instruction in the agent's context; ledgr's extractor reads each reply (one model call per turn)")]
# The detail dialog's next / previous record (2026-11-11) are cmd-down / cmd-up: cmd-[ and cmd-] are Herdr's agent.prev / agent.next.
MOD_KEYS = {"cmd-enter": "ledgr.btw", "tab": "ledgr.tab", "shift-tab": "ledgr.backtab", "cmd-s": "ledgr.pin", "cmd-down": "ledgr.detail-next", "cmd-up": "ledgr.detail-prev"}
CAPTURE_ALTS = ["cmd-j", "cmd-alt-j", "cmd-ctrl-j", "cmd-shift-k"]
TOGGLE_ALTS = ["cmd-shift-j", "cmd-alt-shift-j", "cmd-ctrl-shift-j", "cmd-alt-l"]
EXCLUDE = {"gpui-kit.d.ts", "jsconfig.json", "__pycache__", ".DS_Store"}
GENERATED = {"gpui-kit.d.ts", "jsconfig.json", ".DS_Store"}   # Herdr (or Finder) writes these in every mod folder
PANEL_BLOCK = {"id": "ledgr", "type": "block", "content": {"mod": "ledgr", "props": {"view": "panel"}}}
DEFAULT_PLACE = {"column": "panel", "stack": "panel-body", "child": "ledgr"}
HOST_ID, HOST_ROW, PANEL_COL = "ledgr-host", "ledgr-host-row", "ledgr-panel"
# RECIPE.md, the brief herdr.dev lists the mod by. The gallery's index (assets.herdr.dev/mods/index.json)
# skips a recipe of 64 KiB or more (2026-11-12: ledgr dropped off the mods page at 66,294 bytes), and
# the manual ("Layouts and mods other people made") fixes its parts and their order. Checked by
# setup/tests/test_ledgr_setup.py (fails) and reported by --check (not counted: the install is unaffected).
RECIPE = os.path.join(REPO, "RECIPE.md")
RECIPE_LIMIT, RECIPE_WARN = 64 * 1024, 56 * 1024
RECIPE_PARTS = ["What you see", "How it behaves", "Built from", "Watch out", "Done when"]
# Retention (2026-11-19): closed items past retention_days move out of store.json into
# ledgr-data/archive/<session>/ (the writer's housekeeping, mods/ledgr/writer.js). The default was 14 until
# then, and a new config.json got every default written into it (the hooks' ledgr_config.load on their
# first run, apply_config here), so an older install holds 14, which wins over the new default of 3:
# nothing would be archived for two weeks and store.json would stay past 1 MiB. No dialog offered the value
# before the settings dialog's row, so a 14 the installer finds is the old default, not a choice: it becomes
# 3, once (migrate_retention). install-state records that an install looked (migrations.retention_days), so
# a 14 the person sets later in Settings stays. RETENTION_DEFAULTS mirror mods/ledgr/config.js DEFAULTS and
# bin/lib/ledgr_config.py (setup/tests checks them); --check reports them (retention_report).
RETENTION_OLD = 14
RETENTION_DEFAULTS = {"retention_days": 3, "turns": 12, "coldDays": 7}
STORE_CAP = 1024 * 1024                    # Herdr's writeTextFile refuses a larger file (writer.js writeLarge past it)
# Retention Phase 2 (cold sessions): a session nobody touched for retention.coldDays moves its items and
# turn records to ledgr-data/cold/<safe sid>.<ms>-<rand6>.json (written once by the writer; the session's
# record stays in store.json with `cold`); an event for one whose file the writer cannot read is held in
# cold/held/<safe sid>/ under its spool name until the session is read, reset or forgotten. --check reports
# them (cold_report); --thaw-all writes retention.coldDays 0 and waits until no session is cold (the
# rollback's first step). COLD_NAME is mods/ledgr/config.js COLD_NAME.
COLD_NAME = re.compile(r"^(.+)\.(\d{13})-([0-9a-z]{6})\.json$")
COLD_DAYS_MAX = 365
THAW_WAIT_S, THAW_POLL_S, THAW_SAY_S = 120, 1.0, 15
# --thaw-all's "no cold sessions" (integration, 2026-11-19): seen twice THAW_CONFIRM_S apart, and only once the writer
# shows it has taken the 0 (its claim renewed after the write, out of housekeeping: a freeze run whose own read of
# config.json came before the write may still commit and save), or no writer is alive (no claim renewed for
# CLAIM_LIVE_S, or Herdr not running).
THAW_CONFIRM_S, CLAIM_LIVE_S = 2.0, 300
HELD_STALE_S = 3600                        # held events of a session that is not faulted: the writer replays them at its tick


# ── small helpers ─────────────────────────────────────────────────────────────────────────────
def say(msg=""):
    print(msg, flush=True)


def head(msg):
    say(f"\n== {msg}")


def expand(p):
    return os.path.abspath(os.path.expanduser(os.path.expandvars(p))) if p else p


def as_list(v):
    """A list of non-empty strings from a string, a list, or nothing."""
    if not v:
        return []
    return [v] if isinstance(v, str) else [x for x in v if isinstance(x, str) and x]


def tilde(p):
    return "~" + p[len(HOME):] if p and (p == HOME or p.startswith(HOME + "/")) else p


def sha(b):
    if isinstance(b, str):
        b = b.encode("utf-8")
    return hashlib.sha256(b).hexdigest()


def read_bytes(p):
    try:
        with open(p, "rb") as f:
            return f.read()
    except OSError:
        return None


def write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.ledgr-tmp-{os.getpid()}"
    with open(tmp, "wb") as f:
        f.write(data.encode("utf-8") if isinstance(data, str) else data)
    os.replace(tmp, path)


def style_of(raw):
    indent = 2
    for line in raw.splitlines()[1:]:
        s = line.lstrip(" ")
        if s[:1] in ('"', "{", "["):
            indent = len(line) - len(s) or 2
            break
    return {"indent": indent, "ascii": all(ord(c) < 128 for c in raw)}


def dump(data, style=None):
    """JSON text as ledgr writes every file: the file's own indent and escaping, and always a final
    newline (a file that had one keeps it; one that lacked it gets one)."""
    st = style or {"indent": 2, "ascii": False}
    return json.dumps(data, indent=st["indent"], ensure_ascii=st["ascii"]) + "\n"


def with_nl(b):
    """Bytes of a JSON file with a final newline (a saved original may lack one)."""
    return b if not b or b.endswith(b"\n") else b + b"\n"


def load_json(path):
    """(data, style, raw) or (None, None, None) when missing. Raises on invalid JSON."""
    raw = read_bytes(path)
    if raw is None:
        return None, None, None
    text = raw.decode("utf-8")
    return json.loads(text), style_of(text), text


def run(args, env=None, timeout=60, cwd=None, inp=None):
    try:
        r = subprocess.run(args, capture_output=True, text=True, env=env, timeout=timeout, cwd=cwd, input=inp)
        return r.returncode, r.stdout, r.stderr
    except (OSError, subprocess.TimeoutExpired) as ex:
        return 127, "", str(ex)


def vtuple(s):
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", s or "")
    return tuple(int(x) for x in m.groups()) if m else None


def ago(ts):
    if not ts:
        return "never"
    d = max(0, time.time() - ts)
    return f"{int(d)} s ago" if d < 120 else f"{int(d // 60)} min ago" if d < 7200 else f"{int(d // 3600)} h ago" if d < 172800 else f"{int(d // 86400)} days ago"


# ── the layout tree ───────────────────────────────────────────────────────────────────────────
def walk(node, parent=None):
    if not isinstance(node, dict):
        return
    yield node, parent
    for c in node.get("children") or []:
        yield from walk(c, node)
    for f in node.get("floating") or []:
        yield from walk(f, node)


def by_id(root, nid):
    for n, p in walk(root):
        if n.get("id") == nid:
            return n, p
    return None, None


def mod_of(n):
    c = n.get("content") if isinstance(n, dict) else None
    return c.get("mod") if isinstance(c, dict) else None


def tab_block(root):
    for n, p in walk(root):
        c = n.get("content")
        if isinstance(c, dict) and c.get("tab") == "active":
            return n, p
    return None, None


def header_mod(root):
    t, _ = tab_block(root)
    try:
        return t["content"]["pane"]["header"]["content"]["mod"]
    except (TypeError, KeyError):
        return None


def ledgr_nodes(root):
    return [(n, p) for n, p in walk(root) if mod_of(n) == MOD]


def panel_node(root):
    for n, p in ledgr_nodes(root):
        props = (n.get("content") or {}).get("props") or {}
        if props.get("view") == "panel" or (not props.get("view") and n.get("id") != HOST_ID):
            return n, p
    return None, None


def unique_id(root, want):
    ids = {n.get("id") for n, _ in walk(root)}
    if want not in ids:
        return want
    i = 2
    while f"{want}-{i}" in ids:
        i += 1
    return f"{want}-{i}"


def remove_child(parent, node):
    for key in ("children", "floating"):
        lst = parent.get(key)
        if isinstance(lst, list) and any(x is node for x in lst):
            parent[key] = [x for x in lst if x is not node]
            if key == "floating" and not parent[key]:
                del parent[key]
            return True
    return False


def replace_child(parent, old, new):
    for key in ("children", "floating"):
        lst = parent.get(key)
        if isinstance(lst, list):
            for i, x in enumerate(lst):
                if x is old:
                    lst[i] = new
                    return True
    return False


# ── RECIPE.md ─────────────────────────────────────────────────────────────────────────────────
def recipe_check(path=RECIPE, name=MOD):
    """(bytes, problems, warnings) for a RECIPE.md. Problems: 64 KiB or more (the gallery skips it); not
    the manual's form, which is `# <name>` on the first line, one paragraph, `![<name>](preview.png)`,
    then exactly the five `##` parts of RECIPE_PARTS in that order, with code (backticks) only in Built
    from and Watch out. A warning from 56 KiB. bytes is None when the file cannot be read."""
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
    except OSError as e:
        return None, [f"RECIPE.md cannot be read: {e}"], []
    n, probs, warns = len(raw), [], []
    if n >= RECIPE_LIMIT:
        probs.append(f"RECIPE.md is {n:,} bytes: the gallery skips a recipe of {RECIPE_LIMIT:,} bytes or more")
    elif n >= RECIPE_WARN:
        warns.append(f"RECIPE.md is {n:,} bytes, {RECIPE_LIMIT - n:,} under the gallery's {RECIPE_LIMIT:,}")
    lines, fence, heads = raw.decode("utf-8", "replace").split("\n"), False, []
    for i, ln in enumerate(lines):
        if ln.startswith("```"):
            fence = not fence
        elif not fence and re.match(r"#{1,2} ", ln):
            heads.append((i, ln))
    if lines[0] != f"# {name}":
        probs.append(f"RECIPE.md must start with `# {name}`, nothing before it")
    if [ln for _, ln in heads if ln.startswith("# ")] != [f"# {name}"]:
        probs.append(f"RECIPE.md must have one `# ` heading, `# {name}`")
    parts = [(i, ln[3:].strip()) for i, ln in heads if ln.startswith("## ")]
    if [p for _, p in parts] != RECIPE_PARTS:
        probs.append(f"RECIPE.md parts {[p for _, p in parts]} are not the manual's {RECIPE_PARTS}, in that order, and nothing else")
    first = parts[0][0] if parts else len(lines)
    intro = [b.strip() for b in "\n".join(lines[1:first]).split("\n\n") if b.strip()]
    if len(intro) != 2 or intro[1] != f"![{name}](preview.png)":
        probs.append(f"RECIPE.md: after the title, one paragraph and then `![{name}](preview.png)`, nothing else")
    ends = [i for i, _ in parts[1:]] + [len(lines)]
    prose = {"the opening paragraph": lines[1:first]}
    prose.update({p: lines[i + 1:e] for (i, p), e in zip(parts, ends) if p in ("What you see", "How it behaves")})
    for where, body in prose.items():
        if "`" in "\n".join(body):
            probs.append(f"RECIPE.md: code in {where} (the manual keeps code to Built from and Watch out)")
    return n, probs, warns


# ── context ───────────────────────────────────────────────────────────────────────────────────
class Ctx:
    def __init__(self, a):
        self.home = expand(a.herdr_home or os.environ.get("HERDR_HOME") or os.environ.get("HERDR_APP_HOME") or "~/.config/herdr-app")
        # The Claude settings files: the first is the primary (~/.claude/settings.json unless given);
        # gather() adds the other config folders the person chooses.
        given = as_list(getattr(a, "claude_settings", None)) or [x for x in (os.environ.get("LEDGR_CLAUDE_SETTINGS") or "").split(os.pathsep) if x]
        self.settings_given = list(dict.fromkeys(expand(x) for x in given)) or None
        self.settings_all = list(self.settings_given or [expand("~/.claude/settings.json")])
        self.settings = self.settings_all[0]
        self.state_dir = expand(a.state_dir or os.environ.get("LEDGR_STATE_DIR") or "~/.local/state/ledgr")
        self.keychain = os.environ.get("LEDGR_KEYCHAIN") or None   # a keychain file, for tests only
        self.yes = a.yes
        self.stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        self.herdr_app = shutil.which("herdr-app") or next((p for p in ("/Applications/Herdr.app/Contents/MacOS/herdr-app",) if os.path.exists(p)), None)
        self.env = dict(os.environ, HERDR_APP_HOME=self.home)
        self.backup_dir = None

    @property
    def mods(self):
        return os.path.join(self.home, "mods")

    @property
    def data(self):
        return os.path.join(self.home, "ledgr-data")

    @property
    def state_file(self):
        return os.path.join(self.state_dir, "install-state.json")

    def rel(self, path):
        if path == self.settings:
            return "claude/settings.json"
        if path.startswith(self.home + "/"):
            return "herdr/" + path[len(self.home) + 1:]
        if path.startswith(HOME + "/"):
            return "home/" + path[len(HOME) + 1:]       # another Claude config folder's settings.json
        return "abs/" + path.lstrip("/")

    def legacy_rel(self, path):
        """Where install.sh 0.0.x put a copy of this file inside backup-<stamp>/."""
        if path == self.settings:
            return "settings.json"
        if path.startswith(self.home + "/"):
            return path[len(self.home) + 1:]
        return None

    def herdr(self, *args, timeout=60):
        if not self.herdr_app:
            return 127, "", "herdr-app not found"
        return run([self.herdr_app, *args], env=self.env, timeout=timeout, cwd=self.home)

    def backup(self, path):
        """Copy a file or folder into this run's backup folder before it changes."""
        if not os.path.exists(path):
            return
        if not self.backup_dir:
            self.backup_dir = os.path.join(self.state_dir, f"backup-{self.stamp}")
        dst = os.path.join(self.backup_dir, self.rel(path))
        if os.path.exists(dst):
            return
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.isdir(path):
            shutil.copytree(path, dst, ignore=shutil.ignore_patterns(*EXCLUDE))
        else:
            shutil.copy2(path, dst)


class State:
    """install-state.json: the answers, what ledgr added, and where each touched file's original is."""

    def __init__(self, ctx):
        self.ctx = ctx
        d, _, _ = load_json(ctx.state_file) if os.path.exists(ctx.state_file) else (None, None, None)
        self.d = d if isinstance(d, dict) else {}
        self.d.setdefault("v", 1)
        for k in ("files", "keys", "layouts", "answers"):
            self.d.setdefault(k, {})
        self.d.setdefault("mods", [])
        self.d.setdefault("hooks", [])
        self.d.setdefault("cloned", [])
        # Keys are relative ("herdr/<path in the Herdr home>", "claude/settings.json") and originals
        # relative to the state folder, so a moved home or a copied state still resolves. Older
        # states used absolute paths: convert them.
        sd = ctx.state_dir + "/"
        rel = lambda k: ctx.rel(k) if isinstance(k, str) and k.startswith("/") else k
        for rec in self.d["files"].values():
            if isinstance(rec, dict) and isinstance(rec.get("pristine"), str) and rec["pristine"].startswith(sd):
                rec["pristine"] = rec["pristine"][len(sd):]
        self.d["files"] = {rel(k): v for k, v in self.d["files"].items()}
        self.d["layouts"] = {rel(k): v for k, v in self.d["layouts"].items()}
        self.d["cloned"] = [rel(k) for k in self.d["cloned"]]

    @property
    def files(self):
        return self.d["files"]

    def path(self, key):
        """A state key back to an absolute path."""
        if key == "claude/settings.json":
            return self.ctx.settings
        if key.startswith("herdr/"):
            return os.path.join(self.ctx.home, key[6:])
        if key.startswith("home/"):
            return os.path.join(HOME, key[5:])
        return key[3:] if key.startswith("abs/") else key

    def rec(self, path):
        return self.files.get(self.ctx.rel(path)) or {}

    def original(self, rec):
        """The bytes of the saved original, or None."""
        p = rec.get("pristine") if rec else None
        return read_bytes(os.path.join(self.ctx.state_dir, p)) if p else None

    def layout(self, path):
        return self.d["layouts"].setdefault(self.ctx.rel(path), {})

    def save(self):
        self.d["herdr_home"], self.d["claude_settings"] = self.ctx.home, [tilde(p) for p in self.ctx.settings_all]
        write_atomic(self.ctx.state_file, dump(self.d))

    def pristine(self, path, marked):
        """Record (once) where the version of `path` from before ledgr is: absent, a copy taken now,
        a copy found in an older install.sh backup, or unknown."""
        key = self.ctx.rel(path)
        rec = self.files.get(key)
        if rec and "pristine" in rec:
            return rec
        rec = rec or {}
        cur = read_bytes(path)
        pdir = os.path.join(self.ctx.state_dir, "pristine")
        if cur is None:
            rec.update(pristine=None, origin="absent")
        elif not marked(cur):
            dst = os.path.join(pdir, key)
            write_atomic(dst, cur)
            rec.update(pristine=os.path.relpath(dst, self.ctx.state_dir), origin="captured " + datetime.date.today().isoformat())
        else:
            rec.update(pristine=None, origin="unknown")
            lrel = self.ctx.legacy_rel(path)
            if lrel and os.path.isdir(self.ctx.state_dir):
                for name in sorted(os.listdir(self.ctx.state_dir)):
                    if not name.startswith("backup-"):
                        continue
                    old = read_bytes(os.path.join(self.ctx.state_dir, name, lrel))
                    if old is not None and not marked(old):
                        dst = os.path.join(pdir, key)
                        write_atomic(dst, old)
                        rec.update(pristine=os.path.relpath(dst, self.ctx.state_dir), origin=f"from {name}")
                        break
        self.files[key] = rec
        return rec

    def wrote(self, path, data):
        self.files.setdefault(self.ctx.rel(path), {})["written"] = sha(data)


def marked_json(b):
    return b"ledgr" in b


# ── preflight ─────────────────────────────────────────────────────────────────────────────────
def find_claude():
    for c in [shutil.which("claude"), os.path.join(HOME, ".local/bin/claude"), "/opt/homebrew/bin/claude",
              "/usr/local/bin/claude", os.path.join(HOME, ".claude/local/claude")]:
        if c and os.path.exists(c):
            return c
    return None


def hook_python():
    """The python3 the hooks will use (same order as bin/adapters/claude/_env.sh)."""
    for c in [os.environ.get("LEDGR_PYTHON"), "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]:
        if c and os.access(c, os.X_OK):
            rc, out, err = run([c, "-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"], timeout=20)
            if rc == 0:
                return c, out.strip()
    return None, None


RC_FILES = (".zshrc", ".zprofile", ".zshenv", ".bashrc", ".bash_profile", ".profile")
CONFIG_DIR_RX = re.compile(r"""CLAUDE_CONFIG_DIR=(["']?)([^"'\s;)]+)\1""")


def claude_configs(ctx, home=None):
    """Other Claude Code config folders (read-only detection): ~/.claude-* folders that hold a
    settings.json, this shell's CLAUDE_CONFIG_DIR, and CLAUDE_CONFIG_DIR=... in the wrapper scripts
    under ~/.local/bin and in the shell start-up files. [(settings.json path, why)], the primary
    excluded. A folder that does not exist is skipped."""
    home = home or HOME
    primary = os.path.realpath(ctx.settings)
    found = {}

    def add(d, why):
        d = d.replace("${HOME}", home).replace("$HOME", home)
        d = home + d[1:] if d == "~" or d.startswith("~/") else d
        d = d if os.path.isabs(d) else os.path.join(home, d)
        if not os.path.isdir(d):
            return
        p = os.path.join(os.path.abspath(d), "settings.json")
        if os.path.realpath(p) != primary and os.path.realpath(p) not in {os.path.realpath(x) for x in found}:
            found[p] = why

    try:
        names = sorted(os.listdir(home))
    except OSError:
        names = []
    for n in names:
        if n.startswith(".claude-") and os.path.isfile(os.path.join(home, n, "settings.json")):
            add(os.path.join(home, n), f"~/{n} holds a settings.json")
    if os.environ.get("CLAUDE_CONFIG_DIR"):
        add(os.environ["CLAUDE_CONFIG_DIR"], "CLAUDE_CONFIG_DIR in this shell")
    bindir = os.path.join(home, ".local", "bin")
    srcs = [os.path.join(bindir, n) for n in (sorted(os.listdir(bindir)) if os.path.isdir(bindir) else [])]
    srcs += [os.path.join(home, n) for n in RC_FILES]
    for f in srcs:
        try:
            if not os.path.isfile(f) or os.path.getsize(f) > 262144:
                continue                     # binaries and the like
        except OSError:
            continue
        text = (read_bytes(f) or b"").decode("utf-8", "replace")
        for m in CONFIG_DIR_RX.finditer(text):
            add(m.group(2), f"CLAUDE_CONFIG_DIR in ~/{os.path.relpath(f, home)}")
    return list(found.items())


def hooks_in(path):
    """True when this Claude settings file carries a ledgr hook entry."""
    try:
        sett, _, _ = load_json(path)
    except (ValueError, OSError):
        return False
    hooks = (sett or {}).get("hooks") if isinstance(sett, dict) else None
    return any(HOOK_MARK in (h.get("command") or "") for lst in (hooks or {}).values() if isinstance(lst, list)
               for e in lst if isinstance(e, dict) for h in (e.get("hooks") or []) if isinstance(h, dict))


def layouts_of(ctx):
    out = []
    ldir = os.path.join(ctx.home, "layouts")
    inst, _, _ = load_json(os.path.join(ctx.home, "installed.json")) if os.path.exists(os.path.join(ctx.home, "installed.json")) else (None, None, None)
    shipped = {k.split(":", 1)[1] for k in (inst or {}) if k.startswith("layout:")} or {"main", "terminals", "win98"}
    if os.path.isdir(ldir):
        for f in sorted(os.listdir(ldir)):
            if f.endswith(".json") and not f.startswith("."):
                out.append((f[:-5], f[:-5] in shipped))
    return out


def preflight(ctx, quiet=False):
    f = {"hard": [], "warn": []}
    f["home_ok"] = os.path.isdir(ctx.mods) and os.path.exists(os.path.join(ctx.home, "AGENTS.md"))
    if not f["home_ok"]:
        f["hard"].append(f"No Herdr home at {ctx.home} (needs mods/ and AGENTS.md). Start Herdr once, or pass --herdr-home.")
    f["herdr_version"] = None
    if not ctx.herdr_app:
        f["hard"].append("herdr-app is not on PATH (it ships with the Herdr app).")
    else:
        rc, out, _ = ctx.herdr("--version", timeout=20)
        f["herdr_version"] = vtuple(out)
        if f["herdr_version"] and f["herdr_version"] < MIN_HERDR:
            f["warn"].append(f"Herdr {'.'.join(map(str, f['herdr_version']))} is older than {'.'.join(map(str, MIN_HERDR))}, the version ledgr was built on.")
    rc, out, _ = ctx.herdr("status", timeout=20) if ctx.herdr_app and f["home_ok"] else (1, "", "")
    status = None
    if rc == 0:
        try:
            status = json.loads(out)
        except ValueError:
            status = None
    f["running"] = status is not None
    shared, _, _ = load_json(os.path.join(ctx.home, "shared.json")) if os.path.exists(os.path.join(ctx.home, "shared.json")) else (None, None, None)
    f["shared"] = shared if isinstance(shared, dict) else {}
    f["active"] = (status or {}).get("layout") or f["shared"].get("layout")
    f["layouts"] = layouts_of(ctx) if f["home_ok"] else []
    f["python"] = "%d.%d.%d" % sys.version_info[:3]
    if sys.version_info < MIN_PY:
        f["hard"].append(f"python3 {f['python']} is older than 3.9.")
    f["hook_python"], f["hook_python_v"] = hook_python()
    if not f["hook_python"]:
        f["hard"].append("No python3 for the hooks at /opt/homebrew/bin, /usr/local/bin or /usr/bin (set LEDGR_PYTHON).")
    elif vtuple(f["hook_python_v"]) and vtuple(f["hook_python_v"]) < MIN_PY + (0,):
        f["hard"].append(f"The hooks' python3 ({f['hook_python']}, {f['hook_python_v']}) is older than 3.9 (set LEDGR_PYTHON).")
    f["security"] = shutil.which("security") or ("/usr/bin/security" if os.path.exists("/usr/bin/security") else None)
    f["claude"] = find_claude()
    f["claude_configs"] = claude_configs(ctx)
    f["claude_version"] = None
    if f["claude"]:
        rc, out, _ = run([f["claude"], "--version"], timeout=20)
        f["claude_version"] = out.strip().split("\n")[0] if rc == 0 else None
    f["node"] = shutil.which("node")
    mj, _, _ = load_json(os.path.join(ctx.mods, MOD, "mod.json")) if os.path.exists(os.path.join(ctx.mods, MOD, "mod.json")) else (None, None, None)
    f["installed"] = None if mj is None else (mj.get("version") or "unversioned (before 0.1.0)")
    rj, _, _ = load_json(os.path.join(REPO, "mods", MOD, "mod.json"))
    f["repo_version"] = rj.get("version")
    if not quiet:
        report_preflight(ctx, f)
    return f


def report_preflight(ctx, f):
    head("Preflight")
    v = ".".join(map(str, f["herdr_version"])) if f["herdr_version"] else "unknown"
    say(f"  Herdr home      {tilde(ctx.home)}  (Herdr {v}; window {'running' if f['running'] else 'not running'})")
    for name, shipped in f["layouts"]:
        tag = "shipped, read-only" if shipped else "personal"
        say(f"  layout          {name:<14} {tag}{'  <- shown now' if name == f['active'] else ''}")
    say(f"  Claude Code     {(f['claude_version'] or 'found') + '  ' + tilde(f['claude']) if f['claude'] else 'not found'}")
    say(f"  Claude config   {tilde(ctx.settings)}{'  (hooked)' if hooks_in(ctx.settings) else ''}")
    for p, why in f["claude_configs"]:
        say(f"  Claude config   {tilde(p)}  ({why}){'  (hooked)' if hooks_in(p) else ''}")
    say(f"  python3         installer {f['python']}; hooks {f['hook_python'] or 'none'} {f['hook_python_v'] or ''}")
    say(f"  security        {f['security'] or 'not found (macOS Keychain CLI)'}")
    say(f"  node            {f['node'] or 'not found (optional: one offline store test is skipped)'}")
    say(f"  ledgr           {'installed: ' + f['installed'] if f['installed'] else 'not installed'}; this repo: {f['repo_version']}")
    for w in f["warn"]:
        say(f"  ! {w}")
    for h in f["hard"]:
        say(f"  X {h}")


# ── what is installed now (defaults for a re-run, and the uninstall's answers file) ──────────
def read_cfg(ctx):
    try:
        d, _, _ = load_json(os.path.join(ctx.data, "config.json"))
        return d if isinstance(d, dict) else {}
    except (ValueError, OSError):
        return {}


def overlay_manifest(path):
    if not path:
        return None
    p = expand(path) if os.path.isabs(os.path.expanduser(path)) else os.path.join(REPO, path)
    try:
        m, _, _ = load_json(os.path.join(p, "overlay.json"))
    except ValueError as ex:
        raise SystemExit(f"overlay.json in {p} is not valid JSON: {ex}")
    if not isinstance(m, dict):
        raise SystemExit(f"No overlay.json in {p}.")
    m["_dir"] = p
    return m


def host_mods(ctx):
    """Mods (other than ledgr) that carry an engine copy: they host the writer."""
    out = []
    if os.path.isdir(ctx.mods):
        for m in sorted(os.listdir(ctx.mods)):
            if m != MOD and os.path.exists(os.path.join(ctx.mods, m, "ledgr", "writer.js")):
                out.append(m)
    return out


# The config.json choices the installer writes that ledgr's settings dialog (and the panel's threshold
# menu) write too, in answers terms, with their words for the summary. A --yes run keeps the value
# config.json holds when the person changed it there since the last install (keep_config_edits).
CFG_SHARED = {"threshold": "threshold", "asks_handoff": "closing list", "animations": "animations",
              "fold_asks_while_working": "fold while working"}


def cfg_answers(cfg):
    """The CFG_SHARED values a config.json holds, in answers terms (a key it lacks is left out)."""
    a = {}
    if not isinstance(cfg, dict) or not cfg:
        return a
    ex = cfg.get("extract") if isinstance(cfg.get("extract"), dict) else {}
    if ex.get("threshold"):
        a["threshold"] = ex["threshold"]
    ui = cfg.get("ui") if isinstance(cfg.get("ui"), dict) else {}
    if "animations" in ui:
        a["animations"] = ui["animations"] is not False
    if "foldAsksWhileWorking" in ui:
        a["fold_asks_while_working"] = ui["foldAsksWhileWorking"] is True
    h = cfg["asks"].get("handoff") if isinstance(cfg.get("asks"), dict) else None
    if cfg.get("instruct_block") is False:
        a["asks_handoff"] = "prose"
    elif h in [v for v, _ in HANDOFFS]:
        a["asks_handoff"] = h
    return a


def keep_config_edits(ctx, st, ans, flags, file_answers=None):
    """--yes (2026-11-10): for each CFG_SHARED key, config.json's value wins over the answers when the person
    changed it since the last install (in the settings dialog or the threshold menu: it differs from what
    that install wrote, install-state config_written.wrote), and stays while the answers still say what
    they said then (config_written.said), so a stale answers file never reverts it on a later run. An
    answer changed since then applies; a flag on the command line always wins. An older state (no
    config_written): its answers are what it wrote and what was said. Returns [(key, value)] for each
    value kept over a different answer (the run says so); ans["_said"] holds what the answers said there."""
    ans["_said"] = {}
    if not ctx.yes:
        return []
    rec = st.d.get("config_written")
    if isinstance(rec, dict) and isinstance(rec.get("wrote"), dict):
        wrote, said_then = rec["wrote"], rec.get("said") if isinstance(rec.get("said"), dict) else rec["wrote"]
    else:
        wrote = said_then = {k: st.d["answers"][k] for k in CFG_SHARED if k in st.d["answers"]}
    now = cfg_answers(read_cfg(ctx))
    given = set(flags or {})
    if "instruct_block" in given:
        given.add("asks_handoff")
    fa = file_answers or {}
    kept = []
    for k in CFG_SHARED:
        if k in given or k not in now:
            continue
        # What the answers would write: an answers file's instruct_block false with no asks_handoff is prose.
        said = "prose" if k == "asks_handoff" and fa.get("instruct_block") is False and not fa.get("asks_handoff") else ans.get(k)
        changed_here = k in wrote and now[k] != wrote[k]
        answers_same = k in said_then and said == said_then[k]
        if now[k] == said or not (changed_here or answers_same):
            continue
        kept.append((k, now[k]))
        ans["_said"][k] = said
        ans[k] = now[k]
    return kept


def kept_words(k, v):
    shown = ("on" if v else "off") if isinstance(v, bool) else v
    return f"kept your {CFG_SHARED[k]}: {shown} (changed in ledgr since the last install; config.json wins over the answers)"


def derive(ctx, st, f):
    """The answers that reproduce what is installed now."""
    a = {}
    cfg = read_cfg(ctx)
    ex = cfg.get("extract") or {}
    if cfg:
        a["provider"] = "none" if ex.get("mode") == "block-only" else (ex.get("provider") or "anthropic")
        a["model"] = ex.get("model")
        a["base_url"] = ex.get("base_url")
        a["instruct_block"] = cfg.get("instruct_block") is True
        a.update(cfg_answers(cfg))
    keys, _, _ = load_json(os.path.join(ctx.home, "keys.json")) if os.path.exists(os.path.join(ctx.home, "keys.json")) else (None, None, None)
    g = (keys or {}).get("global") or {}
    for k, v in g.items():
        if v == "mod.open:ledgr":
            a.setdefault("keys", {})["capture"] = k
        elif v == "ledgr.toggle" or str(v).endswith(".toggle-ledgr") or v in (st.d.get("toggle_command"),):
            a.setdefault("keys", {})["toggle"] = k
            a["keys"]["toggle_command"] = v
    if st.d["answers"].get("overlay"):
        a["overlay"] = st.d["answers"]["overlay"]
    else:
        hm = host_mods(ctx)
        exdir = os.path.join(REPO, "examples")
        for name in sorted(os.listdir(exdir)) if os.path.isdir(exdir) else []:
            m = overlay_manifest(os.path.join(exdir, name)) if os.path.exists(os.path.join(exdir, name, "overlay.json")) else None
            if m and m.get("host") in hm:
                a["overlay"] = os.path.join("examples", name)
                break
    ov = overlay_manifest(a["overlay"]) if a.get("overlay") else None
    # the layout that holds the panel (the shown one first)
    names = [n for n, shipped in f["layouts"] if not shipped]
    if f.get("active") in names:
        names.remove(f["active"])
        names.insert(0, f["active"])
    for name in names:
        try:
            root, _, _ = load_json(os.path.join(ctx.home, "layouts", name + ".json"))
        except ValueError:
            continue
        if not isinstance(root, dict):
            continue
        pn, pp = panel_node(root)
        hn, hp = by_id(root, HOST_ID)
        if not pn and not hn:
            continue
        lay = {"name": name}
        if pn is not None:
            lay["panel"] = "stack" if pp and pp.get("type") == "stack" else "column"
            if lay["panel"] == "stack":
                lay["panel_stack"] = pp.get("id")
        else:
            lay["panel"] = "skip"
        if hn is not None:
            if hp and hp.get("id") == HOST_ROW:
                other = next((c for c in hp.get("children") or [] if c is not hn), None)
                lay["host"] = "tabs" if other and other.get("id") == "tabs" else "status" if other and other.get("id") == "status" else "beside:" + str((other or {}).get("id"))
            else:
                lay["host"] = "floating"
        else:
            hm = host_mods(ctx)
            lay["host"] = hm[0] if hm else "none"
        hdr = header_mod(root)
        lay["chip"] = hdr if hdr == CHIP or (ov and hdr == ov.get("chip")) else "none"
        a["layout"] = lay
        break
    cands = list(dict.fromkeys(ctx.settings_all + [expand(x) for x in as_list(st.d.get("claude_settings"))]
                               + [p for p, _ in f.get("claude_configs") or []]))
    hooked = [p for p in cands if hooks_in(p)]
    if hooked:
        a["agents"], a["hooks"] = ["claude"], True
        a["claude_settings"] = [tilde(p) for p in hooked]
    a["api_key"] = "keep"
    return a


def merge(base, over):
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


DEFAULTS = {
    "agents": ["claude"], "provider": "anthropic", "model": None, "base_url": None, "api_key": "prompt",
    "instruct_block": True, "asks_handoff": "ledgr", "threshold": "needed", "animations": True, "fold_asks_while_working": False,
    "keys": {"capture": "cmd-j", "toggle": "cmd-shift-j", "toggle_command": None, "replace_conflicts": False},
    "layout": {"name": None, "clone_from": None, "panel": "stack", "panel_stack": "panel-body", "host": "status", "chip": "ledgr-pane"},
    "overlay": None, "hooks": True, "run_tests": True, "claude_settings": None, "mcp": None,
}


# ── questions ─────────────────────────────────────────────────────────────────────────────────
class Asker:
    def __init__(self, yes):
        self.yes = yes
        if not yes and not sys.stdin.isatty():
            raise SystemExit("Not a terminal: run with --yes (and --answers FILE) to install without questions.")

    def choose(self, title, why, choices, default):
        """choices: [(value, label)]. Returns a value."""
        vals = [v for v, _ in choices]
        if default not in vals:
            default = vals[0]
        if self.yes:
            say(f"  {title}: {default}")
            return default
        say(f"\n{title}\n  why: {why}")
        for i, (v, l) in enumerate(choices, 1):
            say(f"   {i}) {l}")
        while True:
            raw = input(f"  [{vals.index(default) + 1}: {default}] > ").strip()
            if not raw:
                return default
            if raw.isdigit() and 1 <= int(raw) <= len(vals):
                return vals[int(raw) - 1]
            if raw in vals:
                return raw
            say("  pick a number from the list")

    def text(self, title, why, default, check=None):
        if self.yes:
            say(f"  {title}: {default}")
            return default
        say(f"\n{title}\n  why: {why}")
        while True:
            raw = input(f"  [{default if default not in (None, '') else 'none'}] > ").strip()
            val = raw or default
            err = check(val) if check else None
            if not err:
                return val
            say(f"  {err}")

    def yesno(self, title, why, default):
        if self.yes:
            say(f"  {title}: {'yes' if default else 'no'}")
            return default
        say(f"\n{title}\n  why: {why}")
        while True:
            raw = input(f"  [{'Y/n' if default else 'y/N'}] > ").strip().lower()
            if not raw:
                return default
            if raw in ("y", "yes"):
                return True
            if raw in ("n", "no"):
                return False


def key_ok(k):
    return None if k and re.fullmatch(r"(?:(?:cmd|ctrl|alt|shift|fn)-)*[a-z0-9\[\];',./`=\\-]+|f\d{1,2}", k) else f"not a key spelling Herdr uses (e.g. cmd-j, cmd-shift-j): {k!r}"


def conflicts(keys, key, value, layout, ours):
    out = []
    for sec in ("global", "terminal", f"layout:{layout}" if layout else None):
        cur = (keys or {}).get(sec, {}).get(key) if sec else None
        if cur is not None and cur != value and cur not in ours:
            out.append((sec, cur))
    return out


def resolve_key(ask, keys, layout, role, want, value, alts, ours, replace):
    """Pick a free key for one binding (asks on a conflict). Returns (key, replaced: [(sec, old)])."""
    key = want
    while True:
        cs = conflicts(keys, key, value, layout, ours)
        if not cs:
            return key, []
        desc = "; ".join(f"{sec}: {cur}" for sec, cur in cs)
        free = [k for k in alts if k != key and not conflicts(keys, k, value, layout, ours)]
        if replace:
            say(f"  {key} is bound ({desc}); replacing it, as the answers say.")
            return key, cs
        if ask.yes:
            if not free:
                raise SystemExit(f"{key} is taken ({desc}) and no alternative is free: pass --{role}-key.")
            say(f"  {key} is taken ({desc}); using {free[0]} instead.")
            key = free[0]
            continue
        choices = ([(free[0], f"use {free[0]} instead (free)")] if free else []) + [
            ("replace", f"replace it ({desc} stops working)"), ("other", "type another key")]
        pick = ask.choose(f"{key} is already bound ({desc}).", "Herdr runs one action per key; the manual asks before replacing yours.", choices, choices[0][0])
        if pick == "replace":
            return key, cs
        if pick == "other":
            key = ask.text(f"Key for {role}", "Any key Herdr can bind.", "", key_ok)
            continue
        key = pick


def choose_configs(ctx, f, ans, ask):
    """The Claude settings files to hook: the primary always, and each other config folder found (or
    given, or hooked before) on a yes. Given ones (--claude-settings, the answers file) decide the
    defaults; with none given, every one defaults to yes."""
    given = ctx.settings_given
    found = dict(f.get("claude_configs") or [])
    prior = [p for p in (expand(x) for x in as_list(ans.get("claude_settings"))) if os.path.isdir(os.path.dirname(p))]
    extras = [p for p in dict.fromkeys((given or [])[1:] + prior + list(found))
              if os.path.realpath(p) != os.path.realpath(ctx.settings)]
    chosen = [ctx.settings]
    if extras:
        say("\nAlso hook these Claude configs?" if not ask.yes else "  Also hook these Claude configs?")
        for p in extras:
            why = found.get(p) or ("given" if given and p in given else "hooked by an earlier install")
            if ask.yesno(f"  {tilde(p)}  ({why})", "A Claude Code started with CLAUDE_CONFIG_DIR reads that folder's settings.json, not "
                         "~/.claude's; without ledgr's hooks there, its sessions never join the ledger.", (p in given) if given else True):
                chosen.append(p)
    return chosen


def gather(ctx, st, f, a, file_answers, flags):
    """Merge defaults, installed values, the answers file and flags; then ask what is still open."""
    ask = Asker(ctx.yes)
    ans = merge(DEFAULTS, st.d["answers"])
    ans = merge(ans, derive(ctx, st, f))
    ans = merge(ans, file_answers)
    ans = merge(ans, flags)
    head("Questions" if not ctx.yes else "Answers")
    ans["_kept"] = keep_config_edits(ctx, st, ans, flags, file_answers)
    for k, v in ans["_kept"]:
        say(f"  {kept_words(k, v)}")
    ov = overlay_manifest(ans.get("overlay"))
    if ov:
        say(f"  overlay: {tilde(ov['_dir'])} (mods {', '.join(ov.get('mods') or [])}; host {ov.get('host')}; chip {ov.get('chip')})")
    # agents
    for name, label, ready in AGENTS:
        if not ready:
            say(f"  {label}: not yet available (ledgr's hooks exist for Claude Code only)")
    want_claude = "claude" in (ans.get("agents") or [])
    if f["claude"] or want_claude:
        want_claude = ask.yesno("Hook Claude Code sessions?", "The hooks map each Herdr terminal to its Claude session and report each turn's end; without them ledgr sees no session.", want_claude)
    ans["agents"] = ["claude"] if want_claude else []
    if want_claude and not f["claude"]:
        f["warn"].append("Claude Code was not found; the hooks are registered and start working once it is installed.")
    ctx.settings_all = choose_configs(ctx, f, ans, ask) if want_claude else [ctx.settings]
    ans["claude_settings"] = [tilde(p) for p in ctx.settings_all]
    # provider
    ans["provider"] = ask.choose("Extraction provider", "At the end of each turn a small model lists what the agent asked of you.", PROVIDERS, ans.get("provider") or "anthropic")
    prov = ans["provider"]
    if prov == "openai-compatible":
        ans["base_url"] = ask.text("Base URL", "The server's OpenAI-compatible endpoint, e.g. http://localhost:11434/v1.", ans.get("base_url") or "",
                                   lambda v: None if v and re.match(r"https?://", v) else "a URL starting with http:// or https://")
        ans["model"] = ask.text("Model id", "The server's model name, e.g. llama3.1:8b.", ans.get("model") if ans.get("model") and ans.get("model") != DEFAULT_MODEL["anthropic"] else "",
                                lambda v: None if v else "a model id is required")
    elif prov in ("anthropic", "cli"):
        cur = ans.get("model")
        if not cur or (prov == "cli" and cur == DEFAULT_MODEL["anthropic"]) or (prov == "anthropic" and cur == DEFAULT_MODEL["cli"]):
            cur = DEFAULT_MODEL[prov]
        ans["model"] = ask.text("Model", "Haiku is fast and cheap enough for one short call per turn.", cur, lambda v: None if v else "required")
        ans["base_url"] = None
    else:
        ans["base_url"] = ans.get("base_url") if ans.get("base_url") else None
    if prov in ("anthropic", "openai-compatible"):
        exists = kc_exists(ctx, prov) if f["security"] else False
        if exists:
            ans["api_key"] = "keep" if ask.yesno(f"Keep the API key already in the Keychain (service ledgr, account {prov})?",
                                                 "It is read at each extraction; nothing else stores it.", True) else "prompt"
        elif ans.get("api_key") == "keep":
            ans["api_key"] = "prompt"
        if ans["api_key"] == "prompt" and not ctx.yes:
            say(f"\nAPI key for {prov} (input hidden; Enter to skip{'; optional for a local server' if prov == 'openai-compatible' else ''})\n"
                f"  why: stored in the macOS Keychain (service ledgr, account {prov}) when you confirm the plan; never written to disk or shown.")
            ans["_key"] = getpass.getpass("  key: ").strip()
            if not ans["_key"]:
                ans["api_key"] = "skip"
        elif ans["api_key"] == "prompt":
            ans["_key"] = os.environ.get("LEDGR_API_KEY", "").strip()
            if not ans["_key"]:
                ans["api_key"] = "skip"
        if ans["api_key"] == "skip" and prov == "anthropic":
            f["warn"].append(f"No API key in the Keychain for {prov}: extraction reports 'no credential' until you run ./install.sh again or "
                             f"`security add-generic-password -s ledgr -a {prov} -w`.")
    # Who owns the closing list (asks.handoff). instruct_block stays the master switch: "prose" writes it
    # off, and an older answers file or flag that turns instruct_block off (with no asks_handoff) means prose.
    given = {**(file_answers or {}), **(flags or {})}
    hand = "prose" if given.get("instruct_block") is False and not given.get("asks_handoff") else ans.get("asks_handoff")
    if any(k == "asks_handoff" for k, _ in ans["_kept"]):
        hand = ans["asks_handoff"]
    ans["asks_handoff"] = ask.choose("Who owns the closing list the agent gives you?",
                                     "If ledgr is installed, let it be authoritative: the end of a reply is the terminal's most valuable "
                                     "screen. ledgr and both add a ~200 to 260-word instruction to each session's context (at start, clear and "
                                     "compact, plus one reminder after a missed blocker); the extractor stays the fallback. Changeable "
                                     "later in ledgr-data/config.json (asks.handoff); running sessions follow at their next prompt.",
                                     HANDOFFS, hand if hand in [v for v, _ in HANDOFFS] else "ledgr")
    ans["instruct_block"] = ans["asks_handoff"] != "prose"
    ans["threshold"] = ask.choose("Which asks count on the chip and as open rows?", "Asks below the line are kept as folded suggestions.", THRESHOLDS, ans.get("threshold") or "needed")
    ans["animations"] = ask.yesno("Animations?", "Rows fade in and out and the chip pulses once on a change; no reduced-motion setting reaches a mod.", ans.get("animations") is not False)
    ans["fold_asks_while_working"] = ask.yesno("Fold the asks lane while the agent works?", "Off leaves every fold to you; on is the old automatic fold.", bool(ans.get("fold_asks_while_working")))
    # layout
    lay = dict(ans.get("layout") or {})
    personal = [n for n, s in f["layouts"] if not s]
    shipped = [n for n, s in f["layouts"] if s]
    cur = lay.get("name") or (f["active"] if f["active"] in personal else (personal[0] if personal else None))
    choices = [(n, f"{n} (personal{', shown now' if n == f['active'] else ''})") for n in personal]
    choices += [(f"clone:{n}", f"clone the shipped {n} as a personal layout and patch the clone{' (shown now)' if n == f['active'] else ''}") for n in shipped]
    choices += [("skip", "skip: change no layout (add the blocks by hand from setup/layout-blocks.json)")]
    if lay.get("clone_from") and not cur:
        cur = f"clone:{lay['clone_from']}"
    if not cur:
        cur = f"clone:{f['active']}" if f["active"] in shipped else (f"clone:main" if "main" in shipped else "skip")
    pick = ask.choose("Which layout gets the ledgr panel?", "Herdr's own layouts are read-only and replaced on every start, so ledgr patches a personal one (the manual's rule: clone first).", choices, cur)
    if pick.startswith("clone:"):
        src = pick[6:]
        lay["clone_from"] = src
        lay["name"] = ask.text("Name for the clone", "A new file in layouts/; Herdr switches to it, and ctrl-shift-l switches back.",
                               lay.get("name") if lay.get("name") and lay.get("name") not in personal + shipped else "my-layout",
                               lambda v: None if v and re.fullmatch(r"[a-z0-9][a-z0-9_-]*", v) and v not in personal + shipped else "a new lowercase name, not taken")
    elif pick == "skip":
        lay.update(name=None, clone_from=None, panel="skip", host="none")
    else:
        lay.update(name=pick, clone_from=None)
    if lay.get("name"):
        root = layout_root(ctx, lay)
        has_stack = bool(root) and by_id(root, lay.get("panel_stack") or "panel-body")[0] is not None
        pchoices = ([("stack", f"in the right-hand panel stack `{lay.get('panel_stack') or 'panel-body'}`, beside Files and Changes")] if has_stack else []) + [
            ("column", "in a new right-hand column of its own"), ("skip", "nowhere (add it by hand)")]
        lay["panel"] = ask.choose("Where does the panel go?", "The panel is a layout block; ledgr shows and hides that node.", pchoices,
                                  lay.get("panel") if lay.get("panel") != "stack" or has_stack else "column")
        hchoices = []
        for nid, label in (("status", "beside the status bar"), ("tabs", "beside the tab bar")):
            if root and by_id(root, nid)[0] is not None or (root and by_id(root, HOST_ID)[0] is not None and lay.get("host") == nid):
                hchoices.append((nid, f"a small ledgr button {label} (always visible; recommended)"))
        hchoices.append(("floating", "a small floating ledgr button over the terminals"))
        if ov and ov.get("host"):
            hchoices.append((ov["host"], f"{ov['host']} from the overlay hosts it (that mod imports ledgr's engine)"))
        hchoices.append(("none", "none: the panel ingests only while it has been shown once (chips lag)"))
        lay["host"] = ask.choose("Which always-visible block hosts ledgr's writer?", "A panel block's copy starts only the first time it is shown; the writer must run all the time.",
                                 hchoices, lay.get("host") if lay.get("host") in [v for v, _ in hchoices] else hchoices[0][0])
        cchoices = [(CHIP, "ledgr-pane: Herdr's pane header plus the chip (the layout's pane header switches to it)")]
        if ov and ov.get("chip") and ov["chip"] != CHIP:
            cchoices.append((ov["chip"], f"{ov['chip']} from the overlay"))
        cchoices.append(("none", "none: no chip; the host button and the panel still count"))
        lay["chip"] = ask.choose("Pane-header chip?", "A chip in each pane's header counts what is open for that session.", cchoices,
                                 lay.get("chip") if lay.get("chip") in [v for v, _ in cchoices] else CHIP)
    ans["layout"] = lay
    # keys
    keys, _, _ = load_json(os.path.join(ctx.home, "keys.json")) if os.path.exists(os.path.join(ctx.home, "keys.json")) else (None, None, None)
    k = dict(ans.get("keys") or {})
    host = lay.get("host")
    tcmd = "ledgr.toggle" if host in ("status", "tabs", "floating") else (ov.get("toggle_command") if ov and host == ov.get("host") else None)
    if not tcmd:
        tcmd = f"layout.toggle:{PANEL_COL if lay.get('panel') == 'column' else 'panel'}"
    k["toggle_command"] = tcmd
    ours = {"mod.open:ledgr", tcmd, "ledgr.toggle"} | ({ov.get("toggle_command")} if ov else set())
    k["capture"] = ask.text("Key to park a question (opens the capture box)", "It works while the agent is still streaming.", k.get("capture") or "cmd-j", key_ok)
    k["capture"], rep1 = resolve_key(ask, keys, lay.get("name"), "capture", k["capture"], "mod.open:ledgr", CAPTURE_ALTS, ours, bool(k.get("replace_conflicts")))
    k["toggle"] = ask.text("Key to show or hide the panel", f"It runs {tcmd}.", k.get("toggle") or "cmd-shift-j", key_ok)
    k["toggle"], rep2 = resolve_key(ask, keys, lay.get("name"), "toggle", k["toggle"], tcmd, TOGGLE_ALTS, ours, bool(k.get("replace_conflicts")))
    if k["toggle"] == k["capture"]:
        raise SystemExit("The two keys must differ.")
    k["replaced"] = rep1 + rep2
    ans["keys"] = k
    # hooks: the exact entries, before anything is written
    # hooks: the exact entries, file by file, before anything is written
    ans["_declined"] = []
    if ans["agents"]:
        want = ans.get("hooks") is not False
        yes = False
        for path in ctx.settings_all:
            todo, fix = hook_plan(ctx, path)
            if not todo and not fix:
                yes = True
                continue
            say(f"\n  Claude Code hooks: ledgr adds these entries to {tilde(path)}, exactly:")
            for ev, entry in todo:
                say(f'    "{ev}": [ ..., {json.dumps(entry)} ]')
            for ev, old, new in fix:
                say(f"    {ev}: {old}  ->  {new}  (the mod moved)")
            if ask.yesno(f"Add them to {tilde(path)}?", "Claude Code runs them at session start, at each prompt and at each turn's end; each exits "
                         "in milliseconds and prints nothing to the model but the ledgr-asks instruction (asks.handoff ledgr or both).", want):
                yes = True
            else:
                ans["_declined"].append(path)
        ans["hooks"] = yes
    else:
        ans["hooks"] = False
    # The MCP server: the exact command and allow entries, folder by folder, before anything is written.
    # A run with --yes registers it only when the answers or --mcp say so, or it is registered already.
    ans["_mcp_declined"] = []
    files = [p for p in ctx.settings_all if p not in ans["_declined"]] if ans["agents"] and ans["hooks"] else []
    have = any(mcp_registered(ctx, p) == "ok" for p in files)
    want = ans.get("mcp") if isinstance(ans.get("mcp"), bool) else (have or not ctx.yes)
    if files and os.path.exists(os.path.join(REPO, "mods", MOD, "bin", "mcp", "ledgr_mcp.py")):
        ans["mcp"] = ask.yesno("Register ledgr's MCP server with Claude Code so agents can declare asks without printing a block?",
                               "The agent calls ledgr's declare_asks tool instead of writing a ledgr-asks block at the end of its reply, "
                               "so the terminal's last screen stays the work's; the block stays the fallback. Registered at user scope "
                               "in each chosen Claude config folder (claude mcp add), with an allow entry per tool so a call never prompts.", want)
        if ans["mcp"]:
            for path in files:
                argv, d, line = mcp_command(ctx, path)
                miss = perms_missing(path)
                if mcp_registered(ctx, path) == "ok" and not miss:
                    continue
                say(f"\n  MCP server for {tilde(os.path.dirname(path))}: ledgr runs, exactly:")
                if mcp_registered(ctx, path) != "ok":
                    say(f"    {line}")
                if miss:
                    say(f'    and adds to {tilde(path)}: "permissions": {{"allow": [ ..., {", ".join(json.dumps(x) for x in miss)} ]}}')
                if not ask.yesno(f"Do that for {tilde(os.path.dirname(path))}?", "The server reads and writes only ledgr-data; it "
                                 f"starts with each Claude Code session of that folder and offers {len(MCP_TOOLS)} tools "
                                 f"({', '.join(mcp_tool_names())}).", True):
                    ans["_mcp_declined"].append(path)
    else:
        ans["mcp"] = False
    return ans


def layout_root(ctx, lay):
    src = lay.get("clone_from") or lay.get("name")
    if not src:
        return None
    p = os.path.join(ctx.home, "layouts", src + ".json")
    try:
        root, _, _ = load_json(p)
    except ValueError:
        return None
    return root


# ── Keychain ──────────────────────────────────────────────────────────────────────────────────
def kc_tail(ctx):
    return [ctx.keychain] if ctx.keychain else []


def kc_exists(ctx, account):
    rc, _, _ = run(["security", "find-generic-password", "-s", "ledgr", "-a", account] + kc_tail(ctx), timeout=20)
    return rc == 0


def kc_store(ctx, account, key):
    """Stores the key through `security -i` on stdin: never in an argument list, never on disk."""
    if not re.fullmatch(r"[A-Za-z0-9._~+/=:-]{8,512}", key):
        raise SystemExit("That does not look like an API key (letters, digits and ._~+/=:- only); nothing stored.")
    cmd = f'add-generic-password -U -s ledgr -a {account} -w "{key}"' + (f' "{ctx.keychain}"' if ctx.keychain else "") + "\n"
    rc, out, err = run(["security", "-i"], inp=cmd, timeout=30)
    if rc != 0 or "error" in (out + err).lower():
        raise SystemExit("The Keychain refused the key: " + (err or out).strip().splitlines()[-1:][0] if (err or out).strip() else "unknown error")
    return kc_exists(ctx, account)


# ── apply ─────────────────────────────────────────────────────────────────────────────────────
def copy_mod(ctx, st, src, name, own, changes):
    """Copy mods/<name> from src. own: ledgr's own mods (stale files are removed); otherwise an
    overlay mod (the person's): files are added or replaced, never removed, and the original of
    each replaced file is kept for the uninstall."""
    dst = os.path.join(ctx.mods, name)
    existed = os.path.isdir(dst)
    if not existed and name not in st.d["mods"]:
        st.d["mods"].append(name)
    want = {}
    for dp, dns, fns in os.walk(src):
        dns[:] = [d for d in dns if d not in EXCLUDE and not (not own and dp == src and d == "ledgr")]
        for fn in fns:
            if fn in EXCLUDE or fn.endswith(".pyc"):
                continue
            full = os.path.join(dp, fn)
            want[os.path.relpath(full, src)] = full
    touched = 0
    for rel, full in sorted(want.items()):
        target = os.path.join(dst, rel)
        data = read_bytes(full)
        if read_bytes(target) == data:
            if not own:
                st.pristine(target, lambda b: b"ledgr" in b)
                st.wrote(target, data)
            continue
        if not own:
            st.pristine(target, lambda b: b"ledgr" in b)
        ctx.backup(target)
        write_atomic(target, data)
        if os.access(full, os.X_OK):
            os.chmod(target, 0o755)
        if not own:
            st.wrote(target, data)
        touched += 1
    removed = 0
    if own and existed:
        for dp, dns, fns in os.walk(dst, topdown=False):
            for fn in fns:
                full = os.path.join(dp, fn)
                rel = os.path.relpath(full, dst)
                if rel in want or fn in ("gpui-kit.d.ts", "jsconfig.json", ".DS_Store"):
                    continue
                if "__pycache__" in rel.split(os.sep) or fn.endswith(".pyc"):
                    os.remove(full)          # stray bytecode (the hooks cache it under ledgr-data/.pycache)
                    continue
                ctx.backup(full)
                os.remove(full)
                removed += 1
            for d in dns:
                p = os.path.join(dp, d)
                if os.path.isdir(p) and not os.listdir(p):
                    os.rmdir(p)
    if touched or removed:
        changes.append(f"mods/{name}: {touched} file(s) written" + (f", {removed} stale removed" if removed else "") + ("" if existed else " (new)"))
    return touched + removed


def engine_files():
    s = open(os.path.join(REPO, "mods", MOD, "writer.js"), encoding="utf-8").read()
    m = re.search(r"export const ENGINE_FILES = \[([^\]]*)\]", s)
    return re.findall(r'"([^"]+)"', m.group(1))


def needs_engine(moddir):
    for dp, _, fns in os.walk(moddir):
        if os.path.basename(dp) == "ledgr":
            continue
        for fn in fns:
            if fn.endswith(".js") and "./ledgr/" in (read_bytes(os.path.join(dp, fn)) or b"").decode("utf-8", "replace"):
                return True
    return False


def write_engine(ctx, name, changes):
    dst = os.path.join(ctx.mods, name, "ledgr")
    n = 0
    for fn in engine_files():
        src = os.path.join(ctx.mods, MOD, fn)
        data = read_bytes(src)
        if read_bytes(os.path.join(dst, fn)) != data:
            write_atomic(os.path.join(dst, fn), data)
            n += 1
        if read_bytes(os.path.join(dst, fn)) != data:
            raise SystemExit(f"engine copy differs after writing: {name}/ledgr/{fn}")
    if n:
        changes.append(f"mods/{name}/ledgr/: {n} engine file(s) copied")


def retention_pending(st, cfg):
    """True when migrate_retention would change this config.json: retention_days is the old default and no
    install has looked yet (the Plan says so before anything is written)."""
    done = (st.d.get("migrations") or {}).get("retention_days") if st is not None else True
    v = cfg.get("retention_days") if isinstance(cfg, dict) else None
    return not done and not isinstance(v, bool) and v == RETENTION_OLD


def migrate_retention(st, cfg):
    """The one-time move of retention_days from the old default (14) to 3 in cfg (changed in place),
    recorded in install-state either way (migrations.retention_days: the date), so only the first install
    that knows the archive decides and a 14 chosen in Settings later stays. Returns the change's words,
    or None."""
    if st is None:
        return None
    pending = retention_pending(st, cfg)
    if not (st.d.get("migrations") or {}).get("retention_days"):
        st.d.setdefault("migrations", {})["retention_days"] = datetime.date.today().isoformat()
    if not pending:
        return None
    cfg["retention_days"] = RETENTION_DEFAULTS["retention_days"]
    return (f"ledgr-data/config.json: retention_days {RETENTION_OLD} (the old default) -> {RETENTION_DEFAULTS['retention_days']}: "
            "closed items move to ledgr-data/archive/ after 3 days, where the panel's Closed fold still reads and reopens them "
            "(once; ledgr's Settings, Closed items stay in the list, changes it)")


def apply_config(ctx, ans, changes, st=None):
    p = os.path.join(ctx.data, "config.json")
    try:
        cfg, style, raw = load_json(p)
    except ValueError:
        raise SystemExit(f"{p} is not valid JSON; fix or move it, then run again.")
    if cfg is None:
        sys.path.insert(0, os.path.join(ctx.mods, MOD, "bin", "lib"))
        os.environ.setdefault("LEDGR_DATA", ctx.data)
        import ledgr_config  # noqa: E402  (the hooks' defaults)
        cfg, style, raw = json.loads(json.dumps(ledgr_config.DEFAULT_CONFIG)), None, None
    new = json.loads(json.dumps(cfg))
    ex = new.setdefault("extract", {})
    prov = ans["provider"]
    if prov == "none":
        ex["mode"] = "block-only"
    else:
        if ex.get("mode") == "block-only":
            ex["mode"] = "block-first"
        ex["provider"] = prov
        ex["model"] = ans.get("model") or DEFAULT_MODEL[prov]
        ex["base_url"] = ans.get("base_url") if prov == "openai-compatible" else None
    ex["threshold"] = ans["threshold"]
    hand = ans.get("asks_handoff") if ans.get("asks_handoff") in [v for v, _ in HANDOFFS] else "ledgr"
    new["instruct_block"] = hand != "prose"
    if not isinstance(new.get("asks"), dict):
        new["asks"] = {}
    new["asks"]["handoff"] = hand
    ui = new.setdefault("ui", {})
    ui["animations"] = bool(ans["animations"])
    ui["foldAsksWhileWorking"] = bool(ans["fold_asks_while_working"])
    place = ans.get("_place")
    if place and place != DEFAULT_PLACE:
        ui["panel"] = place
    elif "panel" in ui and place == DEFAULT_PLACE:
        del ui["panel"]
    moved = migrate_retention(st, new)
    if moved:
        changes.append(moved)
    if new != cfg or raw is None:
        if raw is not None:
            ctx.backup(p)
        write_atomic(p, dump(new, style))
        changes.append(f"ledgr-data/config.json: {'created' if raw is None else 'updated'} (provider {prov}, threshold {ans['threshold']}, closing list {hand})")
    # What this install wrote there (install-state config_written): the next --yes run keeps a value the
    # person changed since (keep_config_edits).
    return cfg_answers(new)


def apply_keys(ctx, st, ans, changes):
    p = os.path.join(ctx.home, "keys.json")
    try:
        keys, style, raw = load_json(p)
    except ValueError:
        raise SystemExit(f"{p} is not valid JSON (see keys.error); fix it, then run again.")
    if keys is None:
        raise SystemExit(f"No {p}: start Herdr once so it writes the default keys, then run again.")
    rec = st.pristine(p, marked_json)
    pristine = None
    if st.original(rec) is not None:
        try:
            pristine = json.loads(st.original(rec).decode("utf-8"))
        except ValueError:
            pristine = None
    k = ans["keys"]
    new = json.loads(json.dumps(keys))
    owned = st.d["keys"]
    ours_values = {"mod.open:ledgr", k["toggle_command"]} | {v.get("value") for sec in owned.values() for v in sec.values() if isinstance(v, dict)}
    want = {("global", k["capture"]): "mod.open:ledgr", ("global", k["toggle"]): k["toggle_command"]}
    want.update({("mod:ledgr", kk): vv for kk, vv in MOD_KEYS.items()})
    # bindings ledgr made earlier that the new answers no longer want
    for sec, entries in list(owned.items()):
        for key, info in list(entries.items()):
            if (sec, key) in want:
                continue
            if new.get(sec, {}).get(key) == info.get("value"):
                if info.get("prev") is None:
                    del new[sec][key]
                else:
                    new[sec][key] = info["prev"]
            del owned[sec][key]
    for (sec, key), value in want.items():
        cur = new.get(sec, {}).get(key)
        if cur != value:
            prev = cur if cur not in ours_values else None
            new.setdefault(sec, {})[key] = value
            owned.setdefault(sec, {})[key] = {"value": value, "prev": prev}
        else:
            old = owned.setdefault(sec, {}).get(key)
            prev = old.get("prev") if old else ((pristine or {}).get(sec) or {}).get(key)
            owned[sec][key] = {"value": value, "prev": prev}
    for sec in list(owned):
        if not owned[sec]:
            del owned[sec]
    if new != keys:
        ctx.backup(p)
        text = dump(new, style)
        write_atomic(p, text)
        st.wrote(p, text)
        changes.append(f"keys.json: {k['capture']} -> mod.open:ledgr, {k['toggle']} -> {k['toggle_command']}, mod:ledgr section")
    else:
        st.wrote(p, raw)


def clone_layout(ctx, st, f, src, name, changes):
    dst = os.path.join(ctx.home, "layouts", name + ".json")
    if os.path.exists(dst):
        return
    if ctx.rel(dst) not in st.d["cloned"]:
        st.d["cloned"].append(ctx.rel(dst))
    rc = 1
    if f["running"]:
        rc, out, err = ctx.herdr("do", "layout.clone", json.dumps({"name": src, "as": name}), timeout=30)
        for _ in range(20):
            if os.path.exists(dst):
                break
            time.sleep(0.25)
    if rc != 0 or not os.path.exists(dst):
        root, style, _ = load_json(os.path.join(ctx.home, "layouts", src + ".json"))
        root = dict(root)
        root["cloned_from"] = {"name": src, "version": ".".join(map(str, f["herdr_version"] or (0, 0, 0)))}
        write_atomic(dst, dump(root, style))
        changes.append(f"layouts/{name}.json: cloned from {src} (file copy; Herdr was not running)")
    else:
        f["active"] = name
        changes.append(f"layouts/{name}.json: cloned from {src} with layout.clone (Herdr now shows it)")


def place_panel(root, lay):
    """Adds the panel block. Returns the ui.panel place, or None (skip / not possible)."""
    mode = lay.get("panel")
    pn, pp = panel_node(root)
    if pn is not None:
        if pp and pp.get("type") == "stack":
            col = next((p for n, p in walk(root) if n is pp), None)
            return {"column": (col or {}).get("id"), "stack": pp.get("id"), "child": pn.get("id")}
        col = pp if pp and pp.get("type") == "column" else None
        return {"column": (col or pn).get("id"), "stack": None, "child": pn.get("id")}
    if mode == "skip":
        return None
    if mode == "stack":
        sid = lay.get("panel_stack") or "panel-body"
        stack, col = by_id(root, sid)
        if stack is not None and stack.get("type") == "stack" and col and col.get("id"):
            blk = json.loads(json.dumps(PANEL_BLOCK))
            blk["id"] = unique_id(root, "ledgr")
            stack.setdefault("children", []).append(blk)
            return {"column": col["id"], "stack": sid, "child": blk["id"]}
        say(f"  ! no stack `{sid}` in this layout: the panel gets a column of its own")
    tb, tp = tab_block(root)
    if tb is None or tp is None:
        say("  ! no tab block found: add the panel by hand (setup/layout-blocks.json)")
        return None
    blk = json.loads(json.dumps(PANEL_BLOCK))
    blk["id"] = unique_id(root, "ledgr")
    colnode = {"id": PANEL_COL, "type": "column", "size": {"px": 380}, "min": 280, "max": 900, "hidden": True, "children": [blk]}
    if tp.get("type") == "row":
        tp["children"].insert(tp["children"].index(tb) + 1, colnode)
    else:
        say("  ! the tab block's parent is not a row: add the panel by hand (setup/layout-blocks.json)")
        return None
    return {"column": PANEL_COL, "stack": None, "child": blk["id"]}


def host_node(bar):
    return {"id": HOST_ID, "type": "block", "size": {"px": 96}, "content": {"mod": "ledgr", "props": {"view": "host", "bar": bar}}}


def remove_host(root, st_layout):
    """Removes ledgr's host block (unwrapping its row). True when something changed."""
    hn, hp = by_id(root, HOST_ID)
    if hn is None:
        return False
    if hp and hp.get("id") == HOST_ROW:
        others = [c for c in hp.get("children") or [] if c is not hn]
        orig = (st_layout or {}).get("wrapped")
        if orig and others and others[0].get("id") == orig.get("id"):
            node = json.loads(json.dumps(orig))
            node.update({k: v for k, v in others[0].items() if k not in ("size",)})
            if "size" in orig:
                node["size"] = orig["size"]
        else:
            node = others[0] if others else None
            if node is not None and "size" in hp:
                node["size"] = hp["size"]
        _, gp = by_id(root, HOST_ROW)
        if node is not None and gp is not None:
            replace_child(gp, hp, node)
        elif gp is not None:
            remove_child(gp, hp)
    elif hp is not None:
        remove_child(hp, hn)
    return True


def place_host(root, lay, st_layout):
    host = lay.get("host")
    hn, hp = by_id(root, HOST_ID)
    if hn is not None:
        cur = "floating" if not (hp and hp.get("id") == HOST_ROW) else None
        if cur is None:
            other = next((c for c in hp.get("children") or [] if c is not hn), {})
            cur = other.get("id")
        if cur == host:
            return False
        remove_host(root, st_layout)
    if host in ("status", "tabs"):
        node, parent = by_id(root, host)
        if node is None or parent is None:
            say(f"  ! no `{host}` block in this layout: no host block added")
            return hn is not None
        st_layout["wrapped"] = json.loads(json.dumps(node))
        inner = dict(node)
        size = inner.pop("size", None)
        row = {"id": HOST_ROW, "type": "row", "resizable": False, "children": [inner, host_node(host)]}
        if size is not None:
            row["size"] = size
        replace_child(parent, node, row)
        return True
    if host == "floating":
        tb, _ = tab_block(root)
        target = tb if tb is not None else root
        target.setdefault("floating", []).append({"id": HOST_ID, "content": {"mod": "ledgr", "props": {"view": "host"}}, "edge": "bottom", "align": "end"})
        return True
    return hn is not None


def set_chip(root, lay, st_layout, pristine_root):
    chip = lay.get("chip")
    tb, _ = tab_block(root)
    if tb is None:
        return False
    cur = header_mod(root)
    if chip in (None, "none", "keep"):
        if cur == CHIP or (cur and cur == st_layout.get("chip")):
            prev = st_layout.get("header_prev")
            if prev is None and pristine_root is not None:
                prev = header_mod(pristine_root)
            pane = tb["content"].setdefault("pane", {})
            if prev:
                pane["header"]["content"]["mod"] = prev
            else:
                pane.pop("header", None)
            return True
        return False
    if cur == chip:
        st_layout["chip"] = chip
        return False
    st_layout.setdefault("header_prev", cur)
    st_layout["chip"] = chip
    pane = tb["content"].setdefault("pane", {})
    hdr = pane.setdefault("header", {"height": 30, "position": "top", "reveal": "always"})
    hdr.setdefault("content", {})["mod"] = chip
    return True


def apply_layout(ctx, st, f, ans, changes):
    lay = ans["layout"]
    if not lay.get("name"):
        ans["_place"] = None
        return None
    if lay.get("clone_from"):
        clone_layout(ctx, st, f, lay["clone_from"], lay["name"], changes)
    p = os.path.join(ctx.home, "layouts", lay["name"] + ".json")
    if lay["name"] in [n for n, s in f["layouts"] if s]:
        raise SystemExit(f"layouts/{lay['name']}.json is Herdr's own (read-only): choose a personal layout or clone it.")
    try:
        root, style, raw = load_json(p)
    except ValueError:
        raise SystemExit(f"{p} is not valid JSON; fix it, then run again.")
    if root is None:
        raise SystemExit(f"No layout {p}.")
    rec = st.pristine(p, lambda b: b"ledgr" in b or (lay.get("chip") not in (None, "none", CHIP) and f'"{lay["chip"]}"'.encode() in b))
    pristine_root = None
    if st.original(rec) is not None:
        try:
            pristine_root = json.loads(st.original(rec).decode("utf-8"))
        except ValueError:
            pristine_root = None
    st_layout = st.layout(p)
    new = json.loads(json.dumps(root))
    place = place_panel(new, lay)
    place_host(new, lay, st_layout)
    set_chip(new, lay, st_layout, pristine_root)
    ans["_place"] = place
    if new != root:
        ctx.backup(p)
        text = dump(new, style)
        write_atomic(p, text)
        st.wrote(p, text)
        changes.append(f"layouts/{lay['name']}.json: panel {lay.get('panel')}, host {lay.get('host')}, chip {lay.get('chip')}")
    else:
        st.wrote(p, raw)
    st.d["layout_name"] = lay["name"]
    return place


def hook_command(ctx, script):
    path = os.path.join(ctx.mods, MOD, "bin", "adapters", "claude", script)
    if path.startswith(HOME + "/"):
        path = "$HOME/" + path[len(HOME) + 1:]
    return f'bash "{path}"'


def hook_entries(ctx):
    return [(ev, {"matcher": "*", "hooks": [{"type": "command", "command": hook_command(ctx, s), "timeout": 5}]}, s) for ev, s in HOOKS]


def hook_plan(ctx, path=None):
    path = path or ctx.settings
    sett, style, raw = load_json(path) if os.path.exists(path) else ({}, None, None)
    hooks = (sett or {}).get("hooks") or {}
    todo, fix = [], []
    for ev, entry, script in hook_entries(ctx):
        mark = f"mods/ledgr/bin/adapters/claude/{script}"
        found = [h for e in hooks.get(ev) or [] for h in e.get("hooks") or [] if mark in (h.get("command") or "")]
        if not found:
            todo.append((ev, entry))
        elif all(h.get("command") != entry["hooks"][0]["command"] for h in found):
            fix.append((ev, found[0].get("command"), entry["hooks"][0]["command"]))
    return todo, fix


def apply_hooks(ctx, st, ans, changes):
    """Registers the hooks in every chosen Claude settings file (ctx.settings_all)."""
    if not ans["agents"]:
        return
    for path in ctx.settings_all:
        apply_hooks_to(ctx, st, ans, path, changes)
    st.d["hooks"] = [e for _, e, _ in hook_entries(ctx)]


def apply_hooks_to(ctx, st, ans, path, changes):
    todo, fix = hook_plan(ctx, path)
    st.pristine(path, lambda b: HOOK_MARK.encode() in b)
    if not todo and not fix:
        say(f"  hooks: already registered in {tilde(path)}")
        mend_newline(ctx, st, path, changes)
        return
    if not ans.get("hooks") or path in (ans.get("_declined") or []):
        say(f"  hooks not written to {tilde(path)} (declined): ledgr sees no session that reads it until they are (./install.sh again).")
        return
    try:
        sett, style, raw = load_json(path) if os.path.exists(path) else (None, None, None)
    except ValueError:
        raise SystemExit(f"{path} is not valid JSON; nothing written.")
    new = json.loads(json.dumps(sett or {}))
    hooks = new.setdefault("hooks", {})
    for ev, entry in todo:
        hooks.setdefault(ev, []).append(entry)
    for ev, old, cmd in fix:
        for e in hooks.get(ev) or []:
            for h in e.get("hooks") or []:
                if h.get("command") == old:
                    h["command"] = cmd
    ctx.backup(path)
    text = dump(new, style)
    write_atomic(path, text)
    st.wrote(path, text)
    changes.append(f"{tilde(path)}: {len(todo)} hook entr{'y' if len(todo) == 1 else 'ies'} added" + (f", {len(fix)} repointed" if fix else ""))


# ── MCP server ────────────────────────────────────────────────────────────────────────────────
def mcp_script(ctx):
    return os.path.join(ctx.mods, MOD, "bin", "mcp", "ledgr_mcp.py")


def config_env(settings_path):
    """The CLAUDE_CONFIG_DIR a `claude` command needs for the config folder of a settings file:
    None for ~/.claude (the default), else that folder."""
    d = os.path.dirname(os.path.abspath(settings_path))
    return None if os.path.normpath(d) == os.path.normpath(expand("~/.claude")) else d


def mcp_user_json(settings_path):
    """Where Claude Code keeps that folder's user-scope MCP servers: ~/.claude.json for ~/.claude,
    else <folder>/.claude.json."""
    d = config_env(settings_path)
    return expand("~/.claude.json") if d is None else os.path.join(d, ".claude.json")


def mcp_command(ctx, settings_path, py=None):
    """The exact registration for one config folder: (argv, CLAUDE_CONFIG_DIR or None, the line to show)."""
    import shlex
    py = py or hook_python()[0] or "/usr/bin/python3"
    argv = [find_claude() or "claude", "mcp", "add", "--scope", "user", "--transport", "stdio", MCP_NAME,
            "--", py, "-I", "-B", mcp_script(ctx)]
    d = config_env(settings_path)
    line = (f"CLAUDE_CONFIG_DIR={shlex.quote(d)} " if d else "") + " ".join(shlex.quote(a) for a in ["claude"] + argv[1:])
    return argv, d, line


def mcp_registered(ctx, settings_path):
    """'ok' when the folder's user-scope config has a `ledgr` server pointing at this install's
    script, 'other' when it points elsewhere, None when there is none (read from the JSON; no claude call)."""
    try:
        cfg, _, _ = load_json(mcp_user_json(settings_path))
    except (ValueError, OSError):
        return None
    srv = ((cfg or {}).get("mcpServers") or {}).get(MCP_NAME) if isinstance(cfg, dict) else None
    if not isinstance(srv, dict):
        return None
    return "ok" if mcp_script(ctx) in [srv.get("command")] + list(srv.get("args") or []) else "other"


def perms_missing(path):
    """Which of MCP_TOOLS the settings file does not allow yet (a "mcp__ledgr" or "mcp__ledgr__*" entry allows all)."""
    try:
        sett, _, _ = load_json(path) if os.path.exists(path) else (None, None, None)
    except ValueError:
        return list(MCP_TOOLS)
    allow = (((sett or {}).get("permissions") or {}).get("allow") or []) if isinstance(sett, dict) else []
    if "mcp__ledgr" in allow or "mcp__ledgr__*" in allow:
        return []
    return [x for x in MCP_TOOLS if x not in allow]


def mcp_tool_names():
    return [x.split("__")[-1] for x in MCP_TOOLS]


def mcp_report(ctx, p, chose):
    """--check's lines for one settings file, and the problem to count (None when healthy). A server
    registered here whose allow entries lack a tool (usually an install from before that tool, such as
    resolve_asks, was added) would prompt on its calls, so that is a problem whatever the answers say;
    the remedy is to run the installer again with --mcp on, which appends the missing entries."""
    reg, miss = mcp_registered(ctx, p), perms_missing(p)
    folder = tilde(os.path.dirname(p))
    lines = [f"  MCP server      {folder}: "
             + {"ok": "ledgr registered (user scope)", "other": "ledgr registered at ANOTHER path"}.get(reg, "not registered")
             + f"; allow entries {'present' if not miss else 'missing: ' + ', '.join(miss)}"]
    if reg == "ok" and not miss:
        return lines, None
    _, _, line = mcp_command(ctx, p)
    if reg != "ok":
        lines.append(f"                  register: {line}")
    if miss:
        lines.append(f'                  allow: add {", ".join(json.dumps(x) for x in miss)} to "permissions.allow" in {tilde(p)}')
    if reg == "ok" and miss:
        why = "allow entries from an earlier install" if len(miss) < len(MCP_TOOLS) else "no ledgr allow entries in this file"
        lines.append(f"                  the server is registered, but calls to {', '.join(miss)} would prompt ({why}): run "
                     "./install.sh again with --mcp on (./install.sh --mcp on, or --yes --answers FILE --mcp on)")
        return lines, f"MCP allow entries missing for {folder}: {', '.join(miss)} (run ./install.sh again with --mcp on)"
    if chose:
        return lines, f"MCP server or its allow entries missing for {folder}"
    return lines, None


def claude_env(d):
    env = dict(os.environ)
    env.pop("CLAUDE_CONFIG_DIR", None)
    if d:
        env["CLAUDE_CONFIG_DIR"] = d
    return env


def apply_mcp(ctx, st, ans, changes, warn):
    """Registers the MCP server and adds the allow entries, per chosen settings file the person agreed to."""
    if not ans.get("mcp") or not ans["agents"] or not ans.get("hooks"):
        return
    done = list(st.d.get("mcp") or [])
    for path in ctx.settings_all:
        if path in (ans.get("_declined") or []) or path in (ans.get("_mcp_declined") or []):
            continue
        argv, d, line = mcp_command(ctx, path)
        state = mcp_registered(ctx, path)
        if state == "ok":
            say(f"  MCP server: already registered for {tilde(os.path.dirname(path))}")
        elif not find_claude():
            warn.append(f"Claude Code not found: register ledgr's MCP server yourself: {line}")
        else:
            env = claude_env(d)
            ctx.backup(mcp_user_json(path))
            if state == "other":
                run([argv[0], "mcp", "remove", "--scope", "user", MCP_NAME], env=env, timeout=60)
            rc, out, err = run(argv, env=env, timeout=60)
            if rc == 0:
                changes.append(f"{tilde(mcp_user_json(path))}: MCP server ledgr registered, user scope ({line})")
            else:
                warn.append(f"claude mcp add failed for {tilde(os.path.dirname(path))} ({(err or out).strip()[:160]}); run it yourself: {line}")
        if mcp_registered(ctx, path) == "ok" and tilde(path) not in done:
            done.append(tilde(path))
        missing = perms_missing(path)
        if missing:
            try:
                sett, style, _ = load_json(path) if os.path.exists(path) else (None, None, None)
            except ValueError:
                raise SystemExit(f"{path} is not valid JSON; nothing written.")
            new = json.loads(json.dumps(sett or {}))
            perms = new.setdefault("permissions", {})
            perms["allow"] = list(perms.get("allow") or []) + missing
            st.pristine(path, lambda b: HOOK_MARK.encode() in b or b"mcp__ledgr__" in b)
            ctx.backup(path)
            text = dump(new, style)
            write_atomic(path, text)
            st.wrote(path, text)
            changes.append(f"{tilde(path)}: permissions.allow += {', '.join(missing)}")
    st.d["mcp"] = done


def mend_newline(ctx, st, path, changes):
    """A JSON file ledgr itself wrote last without a final newline (install.sh before this fix kept a
    missing one) gets it back. A file someone else has written since is left alone."""
    cur = read_bytes(path)
    if not cur or cur.endswith(b"\n") or sha(cur) != st.rec(path).get("written"):
        return
    ctx.backup(path)
    write_atomic(path, cur + b"\n")
    st.wrote(path, cur + b"\n")
    changes.append(f"{tilde(path)}: final newline restored")


def mod_named(ctx, st, key):
    """The mod folder a state key is in (herdr/mods/<name>/...), or None."""
    p, pre = st.path(key), ctx.mods + "/"
    return p[len(pre):].split("/", 1)[0] if p.startswith(pre) else None


def revert_overlay_mod(ctx, st, m, used, drop_edited):
    """Takes an overlay mod back to before ledgr: its engine copy goes, files ledgr added go, files
    ledgr replaced get their originals back, and a folder left with only Herdr's generated files
    goes. A file with no original, or changed since ledgr wrote it, stays as it is, unless
    drop_edited and no layout uses the mod: then the whole folder goes, after a backup.
    Returns one line for the summary."""
    d = os.path.join(ctx.mods, m)
    if os.path.isdir(os.path.join(d, "ledgr")):
        ctx.backup(os.path.join(d, "ledgr"))
        shutil.rmtree(os.path.join(d, "ledgr"))
    keys = sorted(k for k in st.files if st.path(k).startswith(d + "/"))
    unknown, restored, deleted = [], 0, 0
    for key in keys:
        rec, path = st.files[key], st.path(key)
        cur = read_bytes(path)
        if cur is None:
            continue
        if rec.get("origin") == "absent" and sha(cur) == rec.get("written"):
            ctx.backup(path)
            os.remove(path)
            deleted += 1
        elif st.original(rec) is not None and sha(cur) == rec.get("written"):
            pr = st.original(rec)
            if pr != cur:
                ctx.backup(path)
                write_atomic(path, pr)
                restored += 1
        elif rec.get("origin") == "unknown" or (rec.get("written") and sha(cur) != rec.get("written")):
            unknown.append(os.path.relpath(path, d))
    if unknown and drop_edited and m not in used:
        ctx.backup(d)
        shutil.rmtree(d)
        return f"mods/{m}: removed (no layout uses it; no copy from before ledgr of {', '.join(unknown)})"
    if unknown:
        why = "a layout still uses the mod" if m in used else "changed since ledgr wrote them"
        return f"mods/{m}: kept {', '.join(unknown)} as they are (no copy from before ledgr, or {why})"
    left = [fn for _, _, fns in os.walk(d) for fn in fns if fn not in GENERATED]
    if deleted and not left:
        shutil.rmtree(d)             # nothing but Herdr's generated files: ledgr had added all of it
        return f"mods/{m}: removed ({deleted} file(s) ledgr had added, nothing else in it)"
    if restored or deleted:
        return (f"mods/{m}: {restored} file(s) back to their originals from before ledgr" + (f", {deleted} added by ledgr removed" if deleted else "")
                + "; engine copy removed")
    return (f"mods/{m}: engine copy removed; its other files were already as before ledgr" if keys
            else f"mods/{m}: engine copy removed; no record of its originals, files left as they are")


def retired_mods(ctx, st, keep):
    """Mods an earlier install deployed that these answers no longer do: ledgr-pane after a chip
    change, a mod an overlay dropped (the owner's my-pane after he moved to ledgr-pane)."""
    known = set(st.d["mods"]) | {CHIP} | {mod_named(ctx, st, k) for k in st.files}
    return sorted(m for m in known if m and m != MOD and m not in keep and os.path.isdir(os.path.join(ctx.mods, m)))


def retire_mods(ctx, st, ans, deployed, changes):
    """Removes what retired_mods finds, once the layout no longer uses it: ledgr-pane is ledgr's own
    and goes (after a backup); an overlay mod goes back to before ledgr (revert_overlay_mod), which
    removes it when ledgr had added all of it. A mod some layout still uses is kept and named."""
    used = layout_refs(ctx)
    for m in retired_mods(ctx, st, set(deployed)):
        d = os.path.join(ctx.mods, m)
        if m in used:
            changes.append(f"mods/{m}: kept (ledgr no longer deploys it, but a layout still uses it)")
            continue
        if m == CHIP:
            ctx.backup(d)
            shutil.rmtree(d)
            changes.append(f"mods/{m}: removed (the chip is now {(ans.get('layout') or {}).get('chip') or 'none'})")
        else:
            changes.append(revert_overlay_mod(ctx, st, m, used, drop_edited=False))
        if not os.path.isdir(d):
            st.d["mods"] = [x for x in st.d["mods"] if x != m]
            for k in [k for k in st.files if mod_named(ctx, st, k) == m]:
                del st.files[k]


def herdr_checks(ctx, mods):
    ok = True
    for m in mods:
        rc, out, err = ctx.herdr("check", os.path.join("mods", m), timeout=120)
        line = (out or err).strip().splitlines()[-1:] or ["?"]
        say(f"  {'ok ' if rc == 0 else 'FAIL'} herdr-app check mods/{m}: {line[0]}")
        ok = ok and rc == 0
    return ok


def offline_tests(ctx):
    script = os.path.join(ctx.mods, MOD, "bin", "tests", "run-all.sh")
    rc, out, err = run(["bash", script], timeout=600, env=dict(os.environ, LEDGR_DATA=os.path.join(ctx.state_dir, "test-data")))
    for line in (out + err).strip().splitlines():
        say(f"    {line}")
    say(f"  {'ok ' if rc == 0 else 'FAIL'} offline tests (bin/tests/run-all.sh)")
    return rc == 0


def cmd_install(ctx, args, flags):
    st = State(ctx)
    f = preflight(ctx)
    if f["hard"]:
        raise SystemExit("\nStopped: fix the X lines above, then run ./install.sh again.")
    file_answers = {}
    if args.answers:
        try:
            file_answers, _, _ = load_json(expand(args.answers))
        except ValueError as ex:
            raise SystemExit(f"{args.answers}: not valid JSON ({ex})")
        if file_answers is None:
            raise SystemExit(f"No answers file at {args.answers}.")
        file_answers = {k: v for k, v in file_answers.items() if not k.startswith("$") and k not in ("herdr_home", "claude_settings")}
    ans = gather(ctx, st, f, None, file_answers, flags)
    ov = overlay_manifest(ans.get("overlay"))
    lay = ans["layout"]
    ask = Asker(ctx.yes)
    head("Plan")
    say(f"  mods        ledgr {f['repo_version']}" + (", ledgr-pane" if lay.get("chip") == CHIP else "") +
        (f", overlay {', '.join(ov.get('mods') or [])} from {tilde(ov['_dir'])}" if ov else ""))
    say(f"  config      provider {ans['provider']}{' ' + ans['model'] if ans['provider'] != 'none' and ans.get('model') else ''}; closing list {ans['asks_handoff']}; threshold {ans['threshold']}; animations {'on' if ans['animations'] else 'off'}; fold while working {'on' if ans['fold_asks_while_working'] else 'off'}")
    kept = [CFG_SHARED[k] for k, _ in ans.get("_kept") or []]
    if kept:
        say(f"              (kept from config.json, changed in ledgr since the last install: {', '.join(kept)})")
    if retention_pending(st, read_cfg(ctx)):
        say(f"              retention_days {RETENTION_OLD}, the old default, becomes {RETENTION_DEFAULTS['retention_days']} (once): closed items move to the archive after 3 days")
    say(f"  keys        {ans['keys']['capture']} park a question; {ans['keys']['toggle']} -> {ans['keys']['toggle_command']}" +
        (f"; replaces {', '.join(f'{s}:{c}' for s, c in ans['keys']['replaced'])}" if ans['keys']['replaced'] else ""))
    say(f"  layout      {('layouts/' + lay['name'] + '.json') if lay.get('name') else 'none'}" +
        (f" (cloned from {lay['clone_from']})" if lay.get("clone_from") else "") +
        (f"; panel {lay.get('panel')}; host {lay.get('host')}; chip {lay.get('chip')}" if lay.get("name") else ""))
    say(f"  hooks       {'Claude Code: SessionStart, UserPromptSubmit, Stop in ' + ', '.join(tilde(p) for p in ctx.settings_all if p not in ans['_declined']) if ans['agents'] and ans['hooks'] else 'none'}")
    mfiles = [p for p in ctx.settings_all if p not in ans["_declined"] and p not in ans["_mcp_declined"]] if ans.get("mcp") else []
    say(f"  MCP server  {'ledgr (claude mcp add, user scope) and its allow entries for ' + ', '.join(tilde(os.path.dirname(p)) for p in mfiles) if mfiles else 'not registered (./install.sh --mcp on offers it)'}")
    retiring = retired_mods(ctx, st, {MOD} | ({CHIP} if lay.get("chip") == CHIP else set()) | set((ov or {}).get("mods") or []) | set(host_mods(ctx)))
    if retiring:
        say(f"  retires     {', '.join('mods/' + m for m in retiring)} (an earlier install deployed it; removed once no layout uses it)")
    if ans.get("_key"):
        say(f"  Keychain    store the API key you gave (typed, or LEDGR_API_KEY; service ledgr, account {ans['provider']})")
    say(f"  backups     {tilde(ctx.state_dir)}/backup-{ctx.stamp}/")
    if not ask.yesno("Go ahead?", "Nothing has been written yet.", True):
        raise SystemExit("Nothing changed.")
    changes = []
    os.makedirs(ctx.state_dir, exist_ok=True)
    head("Deploy")
    copy_mod(ctx, st, os.path.join(REPO, "mods", MOD), MOD, True, changes)
    deployed = [MOD]
    if lay.get("chip") == CHIP:
        copy_mod(ctx, st, os.path.join(REPO, "mods", CHIP), CHIP, True, changes)
        deployed.append(CHIP)
    for x in (os.path.join(ctx.mods, MOD, "bin", "adapters", "claude"), os.path.join(ctx.mods, MOD, "bin", "tests")):
        for fn in os.listdir(x) if os.path.isdir(x) else []:
            if fn.endswith(".sh"):
                os.chmod(os.path.join(x, fn), 0o755)
    if ov:
        for m in ov.get("mods") or []:
            copy_mod(ctx, st, os.path.join(ov["_dir"], "mods", m), m, False, changes)
            deployed.append(m)
    for m in os.listdir(ctx.mods):
        if m != MOD and os.path.isdir(os.path.join(ctx.mods, m)) and (os.path.exists(os.path.join(ctx.mods, m, "ledgr")) or (m in deployed and needs_engine(os.path.join(ctx.mods, m)))):
            write_engine(ctx, m, changes)
            if m not in deployed:
                deployed.append(m)
    # the answers, the API key, keys, layout, config, hooks
    if ans["provider"] in ("anthropic", "openai-compatible") and ans.get("api_key") == "prompt" and ans.get("_key"):
        if kc_store(ctx, ans["provider"], ans.pop("_key")):
            changes.append(f"Keychain: ledgr / {ans['provider']} stored")
            ans["api_key"] = "keep"
    apply_layout(ctx, st, f, ans, changes)
    st.d["config_written"] = {"wrote": apply_config(ctx, ans, changes, st),
                              "said": {**{k: ans[k] for k in CFG_SHARED if k in ans}, **(ans.get("_said") or {})}}
    for k, v in ans.get("_kept") or []:
        changes.append(kept_words(k, v))
    apply_keys(ctx, st, ans, changes)
    apply_hooks(ctx, st, ans, changes)
    apply_mcp(ctx, st, ans, changes, f["warn"])
    retire_mods(ctx, st, ans, deployed, changes)
    st.d["toggle_command"] = ans["keys"]["toggle_command"]
    st.d["version"] = f["repo_version"]
    st.d["installed_at"] = datetime.datetime.now().isoformat(timespec="seconds")
    st.d["answers"] = public_answers(ans)
    st.save()
    if args.save_answers:
        write_atomic(expand(args.save_answers), dump(public_answers(ans)))
    head("Checks")
    ok = herdr_checks(ctx, [m for m in deployed if os.path.isdir(os.path.join(ctx.mods, m))])
    if ans.get("run_tests", True) and not args.no_tests:
        ok = offline_tests(ctx) and ok
    head("Done" if ok else "Done, with failures above")
    for c in changes or ["nothing changed: already installed as answered"]:
        say(f"  - {c}")
    if ctx.backup_dir:
        say(f"  backups: {tilde(ctx.backup_dir)}")
    say(f"  state:   {tilde(ctx.state_file)} (./uninstall.sh reverses all of it)")
    for w in f["warn"]:
        say(f"  ! {w}")
    if lay.get("name") and f["active"] and lay["name"] != f["active"]:
        say(f"  the panel is in layouts/{lay['name']}.json; Herdr shows {f['active']}: `herdr-app do layout.switch --name {lay['name']}` (ctrl-shift-l switches back)")
    say("\nTry it:")
    say(f"  {ans['keys']['capture']:<16} park a question over a working agent")
    say(f"  {ans['keys']['toggle']:<16} show or hide the ledgr panel")
    say(f"  {'cmd-enter':<16} in the capture box: park it and copy a /btw for the agent")
    return 0 if ok else 1


def public_answers(ans):
    out = {k: v for k, v in ans.items() if not k.startswith("_") and k not in ("hooks_declined",)}
    out = json.loads(json.dumps(out))
    out.get("keys", {}).pop("replaced", None)
    if out.get("api_key") not in ("keep", "skip"):
        out["api_key"] = "keep"
    return out


# ── doctor ────────────────────────────────────────────────────────────────────────────────────
def stall_bound_s():
    """Seconds after which a writer that has not moved is stuck: mods/ledgr/writer.js PASS_STUCK_MS
    (read from the repo's copy), else 90."""
    try:
        m = re.search(r"^export const PASS_STUCK_MS = (\d+);$", open(os.path.join(REPO, "mods", MOD, "writer.js"), encoding="utf-8").read(), re.M)
        return int(m.group(1)) / 1000.0 if m else 90.0
    except OSError:
        return 90.0


def span(s):
    s = max(0, s)
    return f"{int(s)} s" if s < 120 else f"{int(s // 60)} min" if s < 7200 else f"{int(s // 3600)} h {int(s % 3600 // 60)} min"


def writer_report(ctx, f, now=None):
    """--check's writer lines and its problems ([] when it applies events). Read-only: the claim Herdr saved
    in shared.json (f["shared"]), the spool's event files and store.json's time. 2026-11-19: the writer held
    a claim renewed every minute and applied nothing for hours, and --check said "healthy", so the claim's
    freshness alone proves nothing, and neither does its age. An event waits when it is older than 5 s and
    store.json was not written since it arrived. Then the writer is stalled unless its claim shows it at work
    (fresh, a pass or start in one step for under stall_bound_s(): starting, or draining a backlog): the event
    has waited past the bound, or the claim is stale, or its step is that old, or it is stuck with nothing
    running. An event older than the bound while store.json moves on is one the writer does not apply."""
    now = now or time.time()
    lines, problems = [], []
    w = f["shared"].get("ledgr.writer")
    w = w if isinstance(w, dict) and w.get("id") else None
    bound = stall_bound_s()
    spool = os.path.join(ctx.data, "spool")
    waiting = []
    try:
        for n in sorted(os.listdir(spool)):
            if n.endswith(".json") and not n.startswith(".") and not n.startswith("bad-"):
                try:
                    waiting.append((os.path.getmtime(os.path.join(spool, n)), n))
                except OSError:
                    pass
    except OSError:
        pass
    try:
        store_m = os.path.getmtime(os.path.join(ctx.data, "store.json"))
    except OSError:
        store_m = None
    oldest_m, oldest_n = min(waiting) if waiting else (None, None)
    ps = w.get("pass") if w and isinstance(w.get("pass"), dict) else {}
    st = w.get("stall") if w and isinstance(w.get("stall"), dict) else {}
    if w:
        at = (w.get("at") or 0) / 1000
        extra = []
        if ps.get("step"):
            extra.append(f"in {ps['step']} for {span(now - (ps.get('since') or 0) / 1000)}")
        if w.get("done"):
            extra.append(f"last pass ended {ago(w['done'] / 1000)}")
        if st:
            extra.append(("restarted" if st.get("ok") else "STUCK") + f" {ago((st.get('back') or st.get('at') or 0) / 1000)} after {span((st.get('ms') or 0) / 1000)} in {st.get('step')}")
        lines.append(f"  writer          held by {w.get('by')} (claimed {ago(at)})" + (f"; {'; '.join(extra)}" if extra else ""))
        if w.get("fault"):
            lines.append(f"  ! writer fault  {w['fault']}")
    else:
        lines.append("  writer          no claim yet" + (" (Herdr is not running)" if not f["running"] else " (show the panel, or add the host block)"))
        if f["running"]:
            problems.append("no writer holds the role")
    lines.append(f"  spool           {len(waiting)} event{'' if len(waiting) == 1 else 's'} waiting"
                 + (f", the oldest from {ago(oldest_m)}" if waiting else "") + f"; store.json written {ago(store_m)}"
                 + ("" if f["running"] else " (Herdr is not running: they wait for its writer)"))
    if not f["running"]:
        return lines, problems
    waited = now - oldest_m if oldest_m else 0
    moved = oldest_m is not None and store_m is not None and store_m >= oldest_m
    # An event waits when it is older than 5 s and store.json was not written since it arrived; only then
    # does the claim count (2026-11-19 review: a claim is as old as the writer's last beat, hours old after
    # the machine slept while the writer works). A fresh claim whose pass or start is in a step for under
    # the bound is a writer at work (starting, or draining a backlog): behind, not stalled.
    why = None
    if waited > 5 and not moved:
        at = (w.get("at") or 0) / 1000 if w else 0
        step_s = now - ps["since"] / 1000 if ps.get("since") else None
        if w and now - at <= 180 and step_s is not None and step_s <= bound:
            lines.append(f"  writer          at work ({ps.get('step')}): {len(waiting)} event{'' if len(waiting) == 1 else 's'} to apply")
        elif waited > bound:
            why = (f"{len(waiting)} event{'' if len(waiting) == 1 else 's'} waiting, the oldest for {span(waited)}, and store.json "
                   + ("missing" if store_m is None else f"last written {span(now - store_m)} ago"))
        elif w and now - at > 180:
            why = f"{w.get('by')}'s claim has not been renewed for {span(now - at)}"
        elif step_s is not None and step_s > bound:
            why = f"{w.get('by')} has waited {span(step_s)} in {ps.get('step')}"
        elif w and not ps and st and st.get("ok") is False and st.get("kind") != "spool":
            why = f"{w.get('by')} is stuck in {st.get('step')}" + (" and waits before it tries again" if st.get("retryAt") else "")
    if why:
        problems.append(f"the writer is not applying events: {why}. Relaunch Herdr (quit it and open it again): the writer "
                        "starts again from store.json and applies the queue; nothing waiting is lost. ledgr-data/log/writer.log "
                        "names the step it waited in")
    elif waited > bound and moved:
        problems.append(f"ledgr-data/spool/{oldest_n} has waited {span(waited)} while the writer applies the rest: it is not "
                        "applied (unreadable, or over 1 MiB?). Move it out of the spool and look at it; ledgr-data/log/writer.log")
    return lines, problems


def writer_number(name, default):
    """A number mods/ledgr/writer.js exports as `export const NAME = 768 * 1024;` (digits multiplied), read
    from the repo's copy, else default."""
    try:
        m = re.search(rf"^export const {name} = (\d+(?: \* \d+)*);", open(os.path.join(REPO, "mods", MOD, "writer.js"), encoding="utf-8").read(), re.M)
    except OSError:
        return default
    if not m:
        return default
    n = 1
    for x in m.group(1).split("*"):
        n *= int(x)
    return n


def kb(n):
    return f"{n / 1e6:.2f} MB" if n >= 1e6 else f"{n / 1e3:.0f} KB" if n >= 1e3 else f"{n} bytes"


def retention_days_of(v):
    """retention_days as the mod reads it (mods/ledgr/config.js retentionDays): whole days from 1 to 30, a
    number or a numeric string rounded half up and clamped; anything else the default."""
    if isinstance(v, bool) or not isinstance(v, (int, float, str)):
        return RETENTION_DEFAULTS["retention_days"]
    try:
        n = float(v) if not isinstance(v, str) or v.strip() else float("nan")
    except ValueError:
        return RETENTION_DEFAULTS["retention_days"]
    if n != n or n in (float("inf"), float("-inf")):
        return RETENTION_DEFAULTS["retention_days"]
    return min(30, max(1, int(math.floor(n + 0.5))))


def retention_report(ctx, st, cfg, now=None):
    """--check's retention lines and its problems (2026-11-19). Read-only: config.json's retention_days and
    retention.turns, store.json's size against Herdr's 1 MiB cap and housekeeping's threshold (writer.js
    HOUSE_SIZE: past it a run starts within the hour), when housekeeping last ran (d.houseAt) and whether the
    first run after the upgrade has finished (d.retention), the archive under ledgr-data/archive/ (files and
    bytes: a session's items-*.jsonl and turns-*.jsonl, the legacy <yyyy-mm>.jsonl), and the one-time copy
    store.pre-retention-<ms>.json. A problem: retention_days still at the old default 14 that no install
    has looked at (what to do: ./install.sh, or Settings). A store past the cap is said, not counted."""
    now = now or time.time()
    lines, problems = [], []
    cfg = cfg if isinstance(cfg, dict) else {}
    days = cfg.get("retention_days", None)
    turns = cfg["retention"].get("turns") if isinstance(cfg.get("retention"), dict) else None
    read = retention_days_of(days)
    shown_days = (f"{days}" if read == days and not isinstance(days, bool) else f"{json.dumps(days)} (read as {read})") if days is not None \
        else f"{RETENTION_DEFAULTS['retention_days']} (the default)"
    shown_turns = f"{turns}" if turns is not None else f"{RETENTION_DEFAULTS['turns']} (the default)"
    lines.append(f"  retention       closed items stay {shown_days} days (retention_days; one closed as not needed at least 7), "
                 f"turn records kept per session {shown_turns} (retention.turns)")
    if retention_pending(st, cfg):
        problems.append(f"retention_days is {RETENTION_OLD}, the old default: closed items stay two weeks before they move to the archive, "
                        "and store.json stays past 1 MiB meanwhile. Run ./install.sh (it moves the old default to 3, once), or choose "
                        "the days in ledgr's Settings (Closed items stay in the list)")
    elif days == RETENTION_OLD:
        lines.append(f"                  ({RETENTION_OLD} chosen since the install moved the old default; Settings changes it)")
    sp = os.path.join(ctx.data, "store.json")
    try:
        size = os.path.getsize(sp)
    except OSError:
        size = None
    house = writer_number("HOUSE_SIZE", 768 * 1024)
    d = {}
    if size is not None:
        try:
            with open(sp, encoding="utf-8") as fh:
                d = json.load(fh)
        except (OSError, ValueError):
            d = {}
        d = d if isinstance(d, dict) else {}
        where = ("PAST Herdr's 1 MiB text-file cap (every save takes the slow path)" if size > STORE_CAP else "under Herdr's 1 MiB text-file cap")
        where += (f"; over housekeeping's {house:,} (a run within the hour)" if size > house else f"; under housekeeping's {house:,}")
        lines.append(f"  store.json      {size:,} bytes: {where}")
    else:
        lines.append("  store.json      missing (the writer makes it at its first event)")
    ret = d.get("retention") if isinstance(d.get("retention"), dict) else None
    house_at = d.get("houseAt") if isinstance(d.get("houseAt"), (int, float)) and not isinstance(d.get("houseAt"), bool) else None
    first = (f"the first run after the upgrade finished {ago(ret['at'] / 1000)}" if ret and ret.get("v") == 1 and isinstance(ret.get("at"), (int, float))
             else "the first run after the upgrade has not finished yet (the writer runs it at its next start, after keeping the store as it was)")
    lines.append(f"  housekeeping    last ran {ago(house_at / 1000) if house_at else 'never'}; {first}" if size is not None
                 else "  housekeeping    not yet (no store.json)")
    arch = os.path.join(ctx.data, "archive")
    nitems = nturns = nbytes = nses = 0
    legacy = []
    if os.path.isdir(arch):
        for n in sorted(os.listdir(arch)):
            p = os.path.join(arch, n)
            if os.path.isdir(p):
                fs_ = [f for f in os.listdir(p) if re.match(r"^(items|turns)-\d+-[a-z0-9]+\.jsonl$", f)]
                nses += 1 if fs_ else 0
                for f in fs_:
                    nitems += f.startswith("items-")
                    nturns += f.startswith("turns-")
                    try:
                        nbytes += os.path.getsize(os.path.join(p, f))
                    except OSError:
                        pass
            elif re.match(r"^\d{4}-\d{2}\.jsonl$", n):
                legacy.append(n)
                try:
                    nbytes += os.path.getsize(p)
                except OSError:
                    pass
    counted = sum(int(s.get("archived") or 0) for s in (d.get("sessions") or {}).values() if isinstance(s, dict) and isinstance(s.get("archived"), int))
    lines.append(f"  archive         " + (f"{nses} session{'' if nses == 1 else 's'}, {nitems} items file{'' if nitems == 1 else 's'} and {nturns} turns file{'' if nturns == 1 else 's'}"
                                          f"{f', {len(legacy)} legacy month file(s)' if legacy else ''}, {kb(nbytes)}; {counted} item{'' if counted == 1 else 's'} archived (session.archived)"
                                          if nitems or nturns or legacy else "empty (nothing has left store.json yet)"))
    copies = sorted(n for n in (os.listdir(ctx.data) if os.path.isdir(ctx.data) else []) if re.match(r"^store\.pre-retention-\d+\.json$", n))
    if copies:
        sizes = []
        for n in copies:
            try:
                sizes.append(os.path.getsize(os.path.join(ctx.data, n)))
            except OSError:
                sizes.append(0)
        lines.append(f"  one-time copy   {', '.join(f'{n} ({kb(s)})' for n, s in zip(copies, sizes))}: the store before the first run, kept, never read by ledgr")
    elif ret:
        lines.append("  one-time copy   none in ledgr-data (moved or deleted by hand; ledgr never reads it)")
    if size is not None and size > STORE_CAP and ret and ret.get("v") == 1:
        lines.append("  ! store.json is still past 1 MiB after housekeeping: what is left is open items (never archived), recent closed ones "
                     "and recent turn records; every save takes the slow path (writeLarge) meanwhile")
    return lines, problems


# ── cold sessions (retention Phase 2) ─────────────────────────────────────────────────────────
def cold_days_of(cfg):
    """retention.coldDays as the mod reads it (mods/ledgr/config.js coldDaysOf): a number or a numeric
    string; 0 kept (never; the writer brings every cold session back); any other value rounded half up and at
    least 1; missing, not a number, negative or over 365: the default, 7."""
    r = cfg.get("retention") if isinstance(cfg, dict) else None
    v = r.get("coldDays") if isinstance(r, dict) else None
    n = float("nan")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        n = float(v)
    elif isinstance(v, str) and v.strip():
        try:
            n = float(v)
        except ValueError:
            pass
    if n != n or n in (float("inf"), float("-inf")) or n < 0 or n > COLD_DAYS_MAX:
        return RETENTION_DEFAULTS["coldDays"]
    return 0 if n == 0 else max(1, int(math.floor(n + 0.5)))


def safe_name(sid):
    """mods/ledgr/config.js safeName: every character outside A-Za-z0-9._- becomes _."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", str(sid))


def read_store(ctx):
    """store.json as a dict; {} when there is none; None when it cannot be read (mid-write, or not JSON)."""
    p = os.path.join(ctx.data, "store.json")
    if not os.path.exists(p):
        return {}
    try:
        with open(p, encoding="utf-8") as fh:
            d = json.load(fh)
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) else None


def cold_state(d):
    """[(sid, session record, its cold record)] for every cold session in a store (a session with `cold`)."""
    ss = d.get("sessions") if isinstance(d.get("sessions"), dict) else {}
    return [(sid, s, s["cold"]) for sid, s in sorted(ss.items()) if isinstance(s, dict) and isinstance(s.get("cold"), dict)]


def fault_words(name, err):
    """"cold/<file>: <why>", or the writer's words alone when they name the file already (writer.js readCold)."""
    err = err if isinstance(err, str) and err else "the file cannot be read"
    return err if f"cold/{name}" in err else f"cold/{name}: {err}"


def session_words(sid, s):
    name = (s.get("sessionName") or s.get("repo") or "") if isinstance(s, dict) else ""
    return f"{str(sid)[:8]}" + (f" ({name})" if isinstance(name, str) and name else "")


def held_files(ctx):
    """{safe sid: [(name, mtime)]} under ledgr-data/cold/held/ (events kept for a session whose file the writer
    could not read)."""
    root, out = os.path.join(ctx.data, "cold", "held"), {}
    for d in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        p = os.path.join(root, d)
        if not os.path.isdir(p):
            continue
        fs_ = []
        for n in sorted(os.listdir(p)):
            if n.endswith(".json") and not n.startswith("."):
                try:
                    fs_.append((n, os.path.getmtime(os.path.join(p, n))))
                except OSError:
                    pass
        if fs_:
            out[d] = fs_
    return out


def cold_file(path):
    """(record, None) or (None, why): a cold file read and checked as the writer checks its shape (store.js
    coldRecordError's first checks: a JSON object, ledgr "ledgr-cold", an item list)."""
    try:
        with open(path, encoding="utf-8") as fh:
            rec = json.load(fh)
    except FileNotFoundError:
        return None, "missing"
    except (OSError, ValueError) as ex:
        return None, f"cannot be read ({str(ex)[:120]})"
    if not isinstance(rec, dict) or rec.get("ledgr") != "ledgr-cold" or not isinstance(rec.get("items"), list):
        return None, "not a cold file"
    return rec, None


def archive_copies(ctx, sid):
    """A session's Phase 1 archive as the sweep's proof needs it (writer.js archiveCopies): items lines by id,
    turns files' cut records by turn, moved heads by turn, each line only when it names this session."""
    copies, turns, heads = {}, {}, {}
    d = os.path.join(ctx.data, "archive", safe_name(sid))
    for n in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        kind = "items" if re.match(r"^items-\d{1,16}-[a-z0-9]{1,16}\.jsonl$", n) else "turns" if re.match(r"^turns-\d{1,16}-[a-z0-9]{1,16}\.jsonl$", n) else None
        if not kind:
            continue
        try:
            with open(os.path.join(d, n), encoding="utf-8") as fh:
                lines = fh.read().split("\n")
        except OSError:
            continue
        for line in lines:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if not isinstance(r, dict):
                continue
            if kind == "items":
                if isinstance(r.get("id"), str) and isinstance(r.get("anchor"), dict) and r["anchor"].get("sessionId") == sid:
                    copies.setdefault(r["id"], []).append(r)
            elif r.get("sessionId") == sid and r.get("turn") is not None:
                if isinstance(r.get("rec"), dict):
                    turns.setdefault(str(r["turn"]), []).append(r["rec"])
                elif isinstance(r.get("textHead"), str):
                    heads[str(r["turn"])] = r["textHead"]
    return copies, turns, heads


def _js_text(o):
    """JSON.stringify's text, for comparing two copies as store.js does."""
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def cold_lacks(d, sid, rec, copies=None, turn_copies=None, heads=None):
    """What a cold file's record holds that store.json lacks for the session (store.js coldLacks): (items, turn
    records). An item is held only when a copy of its id, of this session, is identical (never a later one: a
    store put back from a backup and touched once is stamped later while holding less), in the store or in
    `copies` (id -> [items]: the named cold file, the archive); a turn record only
    when the store's record is identical, `turn_copies` (turn -> [records]) holds an identical one, or the store's
    record is the file's without its head and `heads` (turn -> textHead) holds that head."""
    copies, turn_copies, heads = copies or {}, turn_copies or {}, heads or {}
    items = d.get("items") if isinstance(d.get("items"), dict) else {}

    li = 0
    for it in rec.get("items") or []:
        if not (isinstance(it, dict) and isinstance(it.get("id"), str)):
            li += 1
            continue
        cand = ([items[it["id"]]] if it["id"] in items else []) + list(copies.get(it["id"], []))
        cand = [c for c in cand if isinstance(c, dict) and isinstance(c.get("anchor"), dict) and c["anchor"].get("sessionId") == sid]
        if not any(_js_text(c) == _js_text(it) for c in cand):
            li += 1
    mine = (d.get("turns") or {}).get(sid) if isinstance(d.get("turns"), dict) else None
    mine = mine if isinstance(mine, dict) else {}
    lt = 0
    for k, r in (rec.get("turns") if isinstance(rec.get("turns"), dict) else {}).items():
        if k in mine and _js_text(mine[k]) == _js_text(r):
            continue
        if any(_js_text(c) == _js_text(r) for c in turn_copies.get(k, [])):
            continue
        if isinstance(r, dict) and isinstance(r.get("textHead"), str) and k in mine and heads.get(k) == r["textHead"]:
            lean = {x: v for x, v in r.items() if x != "textHead"}
            if _js_text(mine[k]) == _js_text(lean):
                continue
        lt += 1
    return li, lt


def cold_report(ctx, cfg, running=True, now=None):
    """--check's cold-session lines and its problems (retention Phase 2). Read-only: store.json's cold
    sessions (s.cold: {file, at, n, fault?}), the files in ledgr-data/cold/ (COLD_NAME), the held events in
    cold/held/<safe sid>/, and retention.coldDays. Problems: a session the writer cannot read (faulted), with
    its held events and what to do; a session that names a missing file; files that name sessions store.json
    does not know (kept: the writer never deletes them); held events of a session that is not faulted that
    the writer has not replayed for an hour while Herdr runs."""
    now = now or time.time()
    lines, problems = [], []
    days = cold_days_of(cfg)
    r = cfg.get("retention") if isinstance(cfg, dict) else None
    given = isinstance(r, dict) and "coldDays" in r
    shown = (f"{days}" if given and r.get("coldDays") == days and not isinstance(r.get("coldDays"), bool) else
             f"{json.dumps(r.get('coldDays'))} (read as {days})" if given else f"{days} (the default)")
    shown += " (never: the writer brings every cold session back)" if days == 0 else ""
    d = read_store(ctx)
    if d is None:
        lines.append(f"  cold            store.json could not be read; retention.coldDays {shown}")
        return lines, problems
    cold = cold_state(d)
    cdir = os.path.join(ctx.data, "cold")
    files = {}
    for n in sorted(os.listdir(cdir)) if os.path.isdir(cdir) else []:
        if COLD_NAME.match(n):
            try:
                files[n] = os.path.getsize(os.path.join(cdir, n))
            except OSError:
                pass
    ss = d.get("sessions") if isinstance(d.get("sessions"), dict) else {}
    forgotten = d.get("forgotten") if isinstance(d.get("forgotten"), dict) else {}
    lost = [(sid, s, s["coldLost"]) for sid, s in sorted(ss.items()) if isinstance(s, dict) and isinstance(s.get("coldLost"), dict)]
    # The files a record names (cold.file, and coldLost.file: a session used without its older items keeps its
    # old file for good), the sessions each safe name stands for (store.js coldGarbage: one session, recorded or
    # forgotten, else the sweep keeps the file), and the rest: thawed or superseded files the sweep deletes in time.
    named = {c.get("file") for _, _, c in cold} | {x.get("file") for _, _, x in lost}
    by_safe = {}
    for x in list(ss) + list(forgotten):
        by_safe.setdefault(safe_name(x), set()).add(x)
    unknown = [n for n in files if n not in named and COLD_NAME.match(n).group(1) not in by_safe]
    # The rest no record names (integration, 2026-11-19: the writer deletes a cold file only when it is provably
    # redundant). By name: a file its session lists as thawed (coldThawed), or a forgotten session's; a faulted
    # session's other files are said with its problem; every other one is read here as the writer reads it: all
    # of it held in store.json (or the session's named file, or its archive) -> the writer deletes it once it is a
    # day old; anything store.json lacks, or a file that cannot be read -> kept for good, a problem ("recoverable").
    loose, recover, others = [], [], {}
    for n_ in files:
        if n_ in named or n_ in unknown:
            continue
        sids = by_safe.get(COLD_NAME.match(n_).group(1)) or set()
        if len(sids) != 1:
            continue                                  # a safe name two sessions share: the writer keeps it
        sid = next(iter(sids))
        s = ss.get(sid)
        thawed = isinstance(s, dict) and any(isinstance(e, dict) and e.get("file") == n_ for e in (s.get("coldThawed") or []))
        if not isinstance(s, dict) or thawed:
            loose.append(n_)                          # forgotten, or thawed: the writer deletes it in time
            continue
        if isinstance((s.get("cold") or {}).get("fault"), dict):
            others.setdefault(sid, []).append(n_)
            continue
        rec, why = cold_file(os.path.join(cdir, n_))
        if why:
            recover.append((sid, s, n_, None, why))
            continue
        copies, tcopies = {}, {}
        cf = (s.get("cold") or {}).get("file")
        if isinstance(cf, str) and cf != n_:
            nrec, _ = cold_file(os.path.join(cdir, cf))
            if nrec:
                for it in nrec["items"]:
                    if isinstance(it, dict) and isinstance(it.get("id"), str):
                        copies.setdefault(it["id"], []).append(it)
                for k, r in (nrec.get("turns") if isinstance(nrec.get("turns"), dict) else {}).items():
                    tcopies.setdefault(k, []).append(r)
        li, lt = cold_lacks(d, sid, rec, copies, tcopies)
        if li or lt:
            ac, at, ah = archive_copies(ctx, sid)
            for k, v in ac.items():
                copies.setdefault(k, []).extend(v)
            for k, v in at.items():
                tcopies.setdefault(k, []).extend(v)
            li, lt = cold_lacks(d, sid, rec, copies, tcopies, ah)
        if li or lt:
            recover.append((sid, s, n_, (li, lt), None))
        else:
            loose.append(n_)
    n = {k: sum(int(c.get("n", {}).get(k) or 0) for _, _, c in cold if isinstance(c.get("n"), dict)) for k in ("items", "blocking", "q")}
    if cold or files:
        lines.append(f"  cold            {len(cold)} session{'' if len(cold) == 1 else 's'} cold in ledgr-data/cold/ "
                     f"({len(files)} file{'' if len(files) == 1 else 's'}, {kb(sum(files.values()))}"
                     + (f"; {len(loose)} thawed, forgotten or redundant cop{'y' if len(loose) == 1 else 'ies'} the writer deletes in time" if loose else "")
                     + f"); retention.coldDays {shown}")
        if cold:
            lines.append(f"                  they hold {n['items']} item{'' if n['items'] == 1 else 's'}: {n['blocking']} open blocking "
                         f"ask{'' if n['blocking'] == 1 else 's'}, {n['q']} open question{'' if n['q'] == 1 else 's'} (the panel's OLDER SESSIONS)")
    else:
        lines.append(f"  cold            none; retention.coldDays {shown}"
                     + ("" if days == 0 else f" (a session nobody touches for {days} day{'' if days == 1 else 's'} moves to ledgr-data/cold/)"))
    items = d.get("items") if isinstance(d.get("items"), dict) else {}
    turns = d.get("turns") if isinstance(d.get("turns"), dict) else {}
    in_store = set()
    for it in items.values():
        if isinstance(it, dict) and isinstance(it.get("anchor"), dict):
            in_store.add(it["anchor"].get("sessionId"))
    mixed = [sid for sid, _, _ in cold if sid in in_store or turns.get(sid)]
    if mixed:
        lines.append(f"  ! {len(mixed)} cold session{'' if len(mixed) == 1 else 's'} also hold{'s' if len(mixed) == 1 else ''} items or turn "
                     "records in store.json (an older build wrote them): the writer merges them at its next start or tick")
    held = held_files(ctx)
    faulted = {safe_name(sid) for sid, _, c in cold if isinstance(c.get("fault"), dict)}
    if held:
        nh = sum(len(v) for v in held.values())
        lines.append(f"  held events     {nh} kept in ledgr-data/cold/held/ for {len(held)} session{'' if len(held) == 1 else 's'} "
                     "(applied once each session's file is read again, it is used without its older items, or it is forgotten)")
    for sid, s, c in cold:
        f = c.get("fault") if isinstance(c.get("fault"), dict) else None
        name = c.get("file")
        if f:
            nh = len(held.get(safe_name(sid), [])) or int(f.get("held") or 0)
            oth = sorted(others.get(sid, []), reverse=True)
            also = (f". Another file of this session is on disk: cold/{oth[0]}" + (f" and {len(oth) - 1} more" if len(oth) > 1 else "")
                    + ": it may hold what is missing, and it stays whatever you choose") if oth else ""
            there = "is there but could not be read" in str(f.get("error") or "")
            what = ("The file is there but could not be read: check its permissions and the disk, then choose Try again on that session "
                    if there else "Put the file back if you have it and choose Try again on that session ")
            problems.append(f"session {session_words(sid, s)} is cold and the writer cannot read its file ({fault_words(name, f.get('error'))}; "
                            f"tried {int(f.get('tries') or 0)} time(s), last {ago((f.get('at') or 0) / 1000)}); {nh} new event{'' if nh == 1 else 's'} "
                            f"kept in ledgr-data/cold/held/{safe_name(sid)}/. {what}"
                            f"in ledgr's panel; or choose Use without its older items (the held events then apply to it), or Forget{also}")
        elif not isinstance(name, str) or name not in files:
            problems.append(f"session {session_words(sid, s)} names cold/{name}, which is "
                            + ("missing" if isinstance(name, str) and COLD_NAME.match(name) else "not a cold file's name")
                            + ": its earlier items cannot come back from it. Put the file back if you have it; at the session's next event "
                              "the writer reports it and ledgr's panel offers Try again, Use without its older items, and Forget")
    if lost:
        lines.append(f"  {'used without':<16}{len(lost)} session{'' if len(lost) == 1 else 's'} used without {'its' if len(lost) == 1 else 'their'} "
                     "older items (its cold file could not be read): " + "; ".join(f"{session_words(sid, s)} (cold/{x.get('file')}, {ago((x.get('at') or 0) / 1000)})" for sid, s, x in lost[:3])
                     + ("; …" if len(lost) > 3 else "") + ". Each file stays in ledgr-data/cold/")
    for sid, s, n_, lack, why in recover:
        if why:
            problems.append(f"cold/{n_} (session {session_words(sid, s)}) {why}, and store.json does not name it: the writer keeps it for good, "
                            "never deletes it")
        else:
            problems.append(f"cold/{n_} (session {session_words(sid, s)}) holds {lack[0]} item{'' if lack[0] == 1 else 's'} and {lack[1]} turn "
                            f"record{'' if lack[1] == 1 else 's'} store.json lacks as they are there, and does not name it (a store.json set aside as "
                            "corrupt or put back from an older copy, or a session used without its older items; or simply an older version of items "
                            "store.json still has, from a freeze that never finished): the writer keeps it for good. To bring its items back, see "
                            "docs/design/Retention.md 10.8 (recoverable files)")
    if unknown:
        problems.append(f"{len(unknown)} file{'' if len(unknown) == 1 else 's'} in ledgr-data/cold/ name{'s' if len(unknown) == 1 else ''} "
                        f"sessions store.json does not know ({', '.join(unknown[:3])}{', …' if len(unknown) > 3 else ''}): kept, the writer never "
                        "deletes them. Each holds a session's items; a store.json restored from an older copy, or one the writer had to start "
                        "empty (a store.corrupt-*.json beside it), would explain it")
    stale = [(k, v) for k, v in held.items() if k not in faulted and running and any(now - m > HELD_STALE_S for _, m in v)]
    for k, v in stale:
        problems.append(f"{len(v)} held event{'' if len(v) == 1 else 's'} in ledgr-data/cold/held/{k}/ wait{'s' if len(v) == 1 else ''} for a "
                        "session that is not faulted, the oldest for " + span(now - min(m for _, m in v)) + ": the writer replays them at its "
                        "tick, so it is not running or cannot; relaunch Herdr. ledgr-data/log/writer.log names the step")
    return lines, problems


def herdr_running(ctx):
    """Whether Herdr's window answers `herdr-app status` (read-only)."""
    rc, out, _ = ctx.herdr("status", timeout=10) if ctx.herdr_app else (1, "", "")
    try:
        return rc == 0 and json.loads(out) is not None
    except ValueError:
        return False


def write_cold_days(ctx, value):
    """Writes retention.coldDays = value into ledgr-data/config.json the installer's way (a backup first, the
    file's own style, a final newline); a missing file is made from the hooks' defaults, as apply_config does.
    Returns (the value read before, the backup's path or None)."""
    p = os.path.join(ctx.data, "config.json")
    cfg, style, raw = load_json(p)                     # raises ValueError on invalid JSON
    if cfg is None:
        try:
            sys.path.insert(0, os.path.join(ctx.mods, MOD, "bin", "lib"))
            os.environ.setdefault("LEDGR_DATA", ctx.data)
            import ledgr_config  # noqa: E402  (the hooks' defaults)
            cfg = json.loads(json.dumps(ledgr_config.DEFAULT_CONFIG))
        except Exception:
            cfg = {}
    if not isinstance(cfg, dict):
        raise ValueError("config.json is not a JSON object")
    before = cfg["retention"].get("coldDays") if isinstance(cfg.get("retention"), dict) else None
    new = json.loads(json.dumps(cfg))
    new["retention"] = dict(new["retention"] if isinstance(new.get("retention"), dict) else {}, coldDays=value)
    bak = None
    if raw is not None:
        ctx.backup(p)
        bak = os.path.join(ctx.backup_dir, ctx.rel(p)) if ctx.backup_dir else None
    write_atomic(p, dump(new, style))
    return before, bak


def writer_claim_of(ctx):
    """The writer's claim as Herdr last saved it (shared.json, key ledgr.writer), or None."""
    p = os.path.join(ctx.home, "shared.json")
    try:
        sh, _, _ = load_json(p) if os.path.exists(p) else (None, None, None)
    except ValueError:
        return None                                    # caught mid-write: not known this time
    w = sh.get("ledgr.writer") if isinstance(sh, dict) else None
    return w if isinstance(w, dict) and w.get("id") else None


def writer_settled(claim, since, now=None):
    """Whether no freeze begun before `since` can still make a session cold: no writer alive (no claim, or one not
    renewed for CLAIM_LIVE_S), or a claim renewed after `since` whose writer is not in its housekeeping (freezing
    runs there, and its commit and save come right after its own read of config.json)."""
    now = now or time.time()
    if not claim:
        return True
    at = (claim.get("at") or 0) / 1000
    if now - at > CLAIM_LIVE_S:
        return True
    step = str((claim.get("pass") or {}).get("step") or "") if isinstance(claim.get("pass"), dict) else ""
    return at > since and not step.startswith("housekeeping")


def cmd_thaw_all(ctx, args):
    """./install.sh --thaw-all: every cold session back into store.json, and none moved out again, before a
    rollback to a build that does not know cold files (one that shows a cold session with no items). Writes
    retention.coldDays 0 (the writer then thaws every session it can read, within a second through its config
    watch, else at its next tick) and polls store.json every THAW_POLL_S for up to THAW_WAIT_S until no session
    has `cold`. Exit 0 then; 1 when sessions stay cold, with what to do: a writer that is not running, or
    sessions whose file the writer cannot read (they never thaw by themselves: the person chooses Try again,
    Use without its older items, or Forget). Nothing else is written; the value stays 0."""
    head("ledgr: bring every session back into store.json")
    p = os.path.join(ctx.data, "config.json")
    try:
        cfg, _, _ = load_json(p)
    except ValueError as ex:
        say(f"  X ledgr-data/config.json is not valid JSON ({ex}); fix or move it, then run ./install.sh --thaw-all again")
        return 1
    cfg = cfg if isinstance(cfg, dict) else {}
    d = read_store(ctx)
    cold = cold_state(d) if d else []
    say(f"  store.json      {'none (nothing is cold)' if d == {} else 'could not be read' if d is None else f'{len(cold)} session' + ('' if len(cold) == 1 else 's') + ' cold'}")
    ret = cfg.get("retention") if isinstance(cfg.get("retention"), dict) else {}
    t_write = time.time()
    if ret.get("coldDays") == 0 and not isinstance(ret.get("coldDays"), bool):
        say("  config.json     retention.coldDays is 0 already (the writer brings every cold session back and moves none out)")
        try:
            t_write = os.path.getmtime(p)
        except OSError:
            pass
    else:
        if not ctx.yes and not sys.stdin.isatty():
            say("  X not a terminal: run ./install.sh --thaw-all --yes to write retention.coldDays 0 without the question")
            return 2
        ask = Asker(ctx.yes)
        if not ask.yesno("Set retention.coldDays to 0 in ledgr-data/config.json?",
                         "The writer then brings every session it moved to ledgr-data/cold/ back into store.json and moves none out "
                         "again; the value stays 0 until you set the days again in ledgr's Settings. Nothing else changes.", True):
            say("  Nothing changed.")
            return 1
        try:
            before, bak = write_cold_days(ctx, 0)
        except (ValueError, OSError) as ex:
            say(f"  X ledgr-data/config.json not written: {ex}")
            return 1
        t_write = time.time()
        say(f"  config.json     retention.coldDays {json.dumps(before) if before is not None else '(the default, 7)'} -> 0"
            + (f"; the file before: {tilde(bak)}" if bak else ""))
    if d == {}:
        say("\n  no cold sessions: nothing to wait for (retention.coldDays stays 0)")
        return 0
    running = herdr_running(ctx)
    sh, _, _ = load_json(os.path.join(ctx.home, "shared.json")) if os.path.exists(os.path.join(ctx.home, "shared.json")) else (None, None, None)
    w = (sh or {}).get("ledgr.writer") if isinstance(sh, dict) else None
    w = w if isinstance(w, dict) and w.get("id") else None
    say("  writer          " + (f"held by {w.get('by')} (claimed {ago((w.get('at') or 0) / 1000)})" if w and running else
                              "Herdr is not running: no writer moves anything until it runs (open Herdr now; this waits)" if not running else
                              "no claim (show the ledgr panel, or add the host block, so a writer runs)"))
    t0, last, said, confirm, settled_said, confirmed = time.time(), None, 0.0, None, False, False
    say(f"  waiting         up to {THAW_WAIT_S} s for the writer (it reads config.json within a second, else at its next tick)")
    while True:
        d = read_store(ctx)
        el = time.time() - t0
        if d is not None:
            cold = cold_state(d)
            stuck = [x for x in cold if isinstance(x[2].get("fault"), dict)]
            if not cold:
                # None cold now; it counts once the writer has taken the 0 (or none runs), seen twice THAW_CONFIRM_S apart.
                if not running or writer_settled(writer_claim_of(ctx), t_write):
                    if confirm is None:
                        confirm = time.time() + THAW_CONFIRM_S
                    elif time.time() >= confirm:
                        confirmed = True
                        break
                elif not settled_said:
                    say("  writer          none cold yet; waiting for the writer to show it has taken the new value "
                        "(a freeze run it began before may still be saving)")
                    settled_said = True
                if el >= THAW_WAIT_S:
                    break
                time.sleep(THAW_POLL_S)
                continue
            confirm = None
            if cold != last and (last is None or len(cold) != len(last)) or el - said >= THAW_SAY_S:
                say(f"  cold            {len(cold)} session{'' if len(cold) == 1 else 's'}"
                    + (f", {len(stuck)} the writer cannot read" if stuck else "") + f" ({int(el)} s)")
                said, last = el, cold
            if len(stuck) == len(cold):
                break                                  # what is left never thaws by itself
        if el >= THAW_WAIT_S:
            break
        time.sleep(THAW_POLL_S)
    head("Result")
    if d is None:
        say(f"  X store.json could not be read after {int(time.time() - t0)} s; run ./install.sh --thaw-all again (retention.coldDays is 0)")
        return 1
    if not cold and not confirmed:
        say(f"  X no session is cold, but the writer has not shown it took retention.coldDays 0 within {int(time.time() - t0)} s (a freeze run it "
            "began before may still be saving): run ./install.sh --thaw-all again in a minute (retention.coldDays is 0 now)")
        return 1
    if not cold:
        say("  no cold sessions: every session's items are back in store.json; retention.coldDays stays 0.")
        say("  To roll back now: check out the older build and run its ./install.sh. After upgrading again, set the days in "
            "ledgr's Settings (Idle sessions move out of store.json after N days).")
        return 0
    stuck = [x for x in cold if isinstance(x[2].get("fault"), dict)]
    rest = [x for x in cold if x not in stuck]
    if rest:
        say(f"  X {len(rest)} session{'' if len(rest) == 1 else 's'} still cold after {int(time.time() - t0)} s: show the ledgr panel or relaunch "
            "Herdr so a writer runs, then run ./install.sh --thaw-all again (retention.coldDays is 0 now; nothing else changed)")
    for sid, s, c in stuck:
        f = c["fault"]
        nh = len(held_files(ctx).get(safe_name(sid), [])) or int(f.get("held") or 0)
        say(f"  X session {session_words(sid, s)} cannot come back: the writer cannot read its file ({fault_words(c.get('file'), f.get('error'))}); "
            f"{nh} event{'' if nh == 1 else 's'} held for it")
    if stuck:
        say("    In ledgr's panel, open each and choose Try again (after putting the file back), Use without its older items, or Forget; "
            "then run ./install.sh --thaw-all again. An older build shows such a session with no items, and its held events stay in "
            "ledgr-data/cold/held/ until a build that knows them runs.")
    return 1


def cmd_check(ctx, args):
    st = State(ctx)
    f = preflight(ctx)
    bad = list(f["hard"])
    head("ledgr")
    cfg = read_cfg(ctx)
    ex = cfg.get("extract") or {}
    prov = "none" if ex.get("mode") == "block-only" else ex.get("provider") or "anthropic"
    hm = (cfg.get("asks") or {}).get("handoff") if isinstance(cfg.get("asks"), dict) else None
    hm = "prose" if cfg and cfg.get("instruct_block") is not True else hm if hm in [v for v, _ in HANDOFFS] else "ledgr"
    say(f"  config.json     {'ok' if cfg else 'missing (the first hook run creates it)'}; provider {prov}; threshold {ex.get('threshold', 'needed')}; "
        f"closing list {hm} (asks.handoff{', instruct_block off' if cfg and cfg.get('instruct_block') is not True else ''})")
    ov = overlay_manifest(st.d["answers"].get("overlay")) if st.d["answers"].get("overlay") else None
    mods = [m for m in (MOD, CHIP) if os.path.isdir(os.path.join(ctx.mods, m))] + host_mods(ctx)
    mods = list(dict.fromkeys(mods + [m for m in (ov or {}).get("mods") or [] if os.path.isdir(os.path.join(ctx.mods, m))]))
    if MOD not in mods:
        bad.append("mods/ledgr is not installed")
    else:
        if not herdr_checks(ctx, mods):
            bad.append("a herdr-app check failed")
    for m in host_mods(ctx):
        diff = [fn for fn in engine_files() if read_bytes(os.path.join(ctx.mods, m, "ledgr", fn)) != read_bytes(os.path.join(ctx.mods, MOD, fn))]
        say(f"  engine copy     mods/{m}/ledgr: {'identical' if not diff else 'DIFFERS: ' + ', '.join(diff)}")
        if diff:
            bad.append(f"engine copy in mods/{m} differs (run ./install.sh)")
    files = list(dict.fromkeys([expand(x) for x in as_list(st.d.get("claude_settings"))] or ctx.settings_all))
    for ev, entry, script in hook_entries(ctx):
        okx = os.access(os.path.join(ctx.mods, MOD, "bin", "adapters", "claude", script), os.X_OK)
        say(f"  hook {ev:<17} script {'executable' if okx else 'missing or not executable'}")
        if not okx:
            bad.append(f"hook {ev} script")
    for p in files:
        try:
            sett, _, _ = load_json(p) if os.path.exists(p) else (None, None, None)
        except ValueError:
            sett = None
        hooks = (sett or {}).get("hooks") or {}
        missing = [ev for ev, _, script in hook_entries(ctx)
                   if not any(f"mods/ledgr/bin/adapters/claude/{script}" in (h.get("command") or "") for e in hooks.get(ev) or [] for h in e.get("hooks") or [])]
        say(f"  hooks in        {tilde(p)}: {'SessionStart, UserPromptSubmit, Stop registered' if not missing else 'NOT registered: ' + ', '.join(missing)}")
        if missing:
            bad.append(f"hooks missing in {tilde(p)}")
    chose = st.d.get("answers", {}).get("mcp") is True
    for p in files:
        lines, problem = mcp_report(ctx, p, chose)
        for ln in lines:
            say(ln)
        if problem:
            bad.append(problem)
    for p, why in f.get("claude_configs") or []:
        if p not in files and not hooks_in(p):
            say(f"  ! {tilde(p)} ({why}) has no ledgr hooks: sessions started with that CLAUDE_CONFIG_DIR do not join (./install.sh offers it)")
    newest = 0
    for sub in ("terminals", "sessions", "log", "spool"):
        d = os.path.join(ctx.data, sub)
        for dp, _, fns in os.walk(d) if os.path.isdir(d) else []:
            for fn in fns:
                try:
                    newest = max(newest, os.path.getmtime(os.path.join(dp, fn)))
                except OSError:
                    pass
    say(f"  hooks fired     last activity under ledgr-data: {ago(newest)}" + ("  (start a Claude session in a Herdr terminal to see it change)" if not newest else ""))
    # How the last turns' asks arrived (log/hook.log): declared by the agent (a block, or the MCP tool:
    # source=tool counts like block), extracted by the model, skipped, or failed.
    srcs = []
    try:
        with open(os.path.join(ctx.data, "log", "hook.log"), encoding="utf-8", errors="replace") as fh:
            for ln in fh.readlines()[-20000:]:
                m = re.search(r" extract \S+ turn=\d+ source=(\w+)", ln)
                if m:
                    srcs.append(m.group(1))
    except OSError:
        pass
    srcs = srcs[-200:]
    if srcs:
        n = lambda k: srcs.count(k)  # noqa: E731
        say(f"  extraction      last {len(srcs)} turns: {n('block') + n('tool')} declared by the agent (block {n('block')}, tool {n('tool')}), "
            f"{n('model')} extracted by the model, {n('skip')} skipped, {n('error')} failed")
    wlines, wproblems = writer_report(ctx, f)
    for ln in wlines:
        say(ln)
    bad += wproblems
    rlines, rproblems = retention_report(ctx, st, cfg)
    for ln in rlines:
        say(ln)
    bad += rproblems
    clines, cproblems = cold_report(ctx, cfg, f["running"])
    for ln in clines:
        say(ln)
    bad += cproblems
    if prov in ("anthropic", "openai-compatible"):
        okk = f["security"] and kc_exists(ctx, prov)
        say(f"  Keychain        service ledgr, account {prov}: {'resolves' if okk else 'MISSING'}")
        if not okk and prov == "anthropic":
            bad.append(f"no Keychain item for {prov}: security add-generic-password -s ledgr -a {prov} -w")
    keys, _, _ = load_json(os.path.join(ctx.home, "keys.json")) if os.path.exists(os.path.join(ctx.home, "keys.json")) else (None, None, None)
    g = (keys or {}).get("global") or {}
    cap = [k for k, v in g.items() if v == "mod.open:ledgr"]
    say(f"  keys            capture {', '.join(cap) or 'NOT bound'}; mod:ledgr {'present' if (keys or {}).get('mod:ledgr') else 'missing'}")
    if not cap:
        bad.append("no key opens the capture box")
    d = derive(ctx, st, f)
    lay = d.get("layout")
    say(f"  layout          {('layouts/' + lay['name'] + '.json: panel ' + lay['panel'] + ', host ' + lay['host'] + ', chip ' + lay['chip']) if lay else 'no layout holds the ledgr panel'}")
    if not lay:
        bad.append("no layout holds the ledgr panel")
    n, rprobs, rwarns = recipe_check()
    if n is None:
        say("  recipe          RECIPE.md not found beside the installer (only the repo has it)")
    else:
        say(f"  recipe          RECIPE.md {n:,} bytes, the gallery's limit {RECIPE_LIMIT:,}: "
            + ("OVER, herdr.dev/mods skips it" if n >= RECIPE_LIMIT else "near it" if n >= RECIPE_WARN else "ok")
            + ("" if rprobs else "; the manual's six parts in order"))
        for x in rprobs + rwarns:
            say(f"  ! {x}")
    head("Result")
    for b in bad:
        say(f"  X {b}")
    say("  healthy" if not bad else f"  {len(bad)} problem(s)")
    return 0 if not bad else 1


# ── uninstall ─────────────────────────────────────────────────────────────────────────────────
def restore_or_surgical(ctx, st, path, surgical, style, label, notes, marked=None):
    """Writes the saved original when it equals the surgical result (only ledgr's entries differed);
    otherwise writes the surgical result. Says which."""
    rec = st.rec(path)
    if not rec.get("pristine"):
        rec = st.pristine(path, marked or ((lambda b: HOOK_MARK.encode() in b) if path == ctx.settings else marked_json))
    pr = st.original(rec)
    cur = read_bytes(path)
    if pr is not None:
        try:
            same = json.loads(pr.decode("utf-8")) == surgical
        except ValueError:
            same = False
        if same:
            pr = with_nl(pr)
            if pr != cur:
                ctx.backup(path)
                write_atomic(path, pr)
            notes.append(f"{label}: restored the original saved before ledgr ({rec.get('origin')})")
            return
        why = "changed since that copy was saved"
    else:
        why = "no copy from before ledgr"
    text = dump(surgical, style)
    if text.encode("utf-8") != cur:
        ctx.backup(path)
        write_atomic(path, text)
        notes.append(f"{label}: removed ledgr's entries only ({why})")
    else:
        notes.append(f"{label}: nothing of ledgr's left")


def layout_refs(ctx):
    refs = set()
    ldir = os.path.join(ctx.home, "layouts")
    for fn in os.listdir(ldir) if os.path.isdir(ldir) else []:
        if fn.endswith(".json"):
            try:
                root, _, _ = load_json(os.path.join(ldir, fn))
            except ValueError:
                continue
            for n, _ in walk(root):
                m = mod_of(n)
                if m:
                    refs.add(m)
                hdr = ((n.get("content") or {}).get("pane") or {}).get("header") if isinstance(n.get("content"), dict) else None
                if isinstance(hdr, dict) and isinstance(hdr.get("content"), dict) and hdr["content"].get("mod"):
                    refs.add(hdr["content"]["mod"])
    return refs


def cmd_uninstall(ctx, args):
    st = State(ctx)
    f = preflight(ctx)
    if not f["home_ok"]:
        raise SystemExit("No Herdr home: nothing to uninstall.")
    ask = Asker(ctx.yes)
    # 1. the answers that reproduce this install
    a = merge(DEFAULTS, st.d["answers"])
    a = merge(a, derive(ctx, st, f))
    a.pop("_place", None)
    a["api_key"] = "keep"
    out = expand(args.answers_out) if args.answers_out else os.path.join(ctx.state_dir, "last-install.json")
    if a.get("overlay") and not os.path.isabs(os.path.expanduser(a["overlay"])):
        a["overlay"] = os.path.join(REPO, a["overlay"])
    write_atomic(out, dump(public_answers(a)))
    head("Uninstall")
    say(f"  your current choices: {tilde(out)}")
    say(f"  reinstall later with: ./install.sh --yes --answers {tilde(out)}")
    ov = overlay_manifest(a.get("overlay")) if a.get("overlay") else None
    cand = list(dict.fromkeys(ctx.settings_all + [expand(x) for x in as_list(st.d.get("claude_settings"))]
                              + [p for p, _ in f.get("claude_configs") or []]))
    sett_files = [p for p in cand if hooks_in(p) or len(perms_missing(p)) < len(MCP_TOOLS)]
    mcp_files = [p for p in cand if mcp_registered(ctx, p) == "ok"]
    lays = []
    for name, shipped in f["layouts"]:
        p = os.path.join(ctx.home, "layouts", name + ".json")
        b = read_bytes(p) or b""
        if not shipped and (b"ledgr" in b or (ov and ov.get("chip") and f'"{ov["chip"]}"'.encode() in b)):
            lays.append((name, p))
    say("  removes: " + ", ".join(filter(None, [
        ("the Claude Code hooks and MCP allow entries in " + ", ".join(tilde(p) for p in sett_files)) if sett_files else None,
        ("the MCP server registration (claude mcp remove) for " + ", ".join(tilde(os.path.dirname(p)) for p in mcp_files)) if mcp_files else None,
        "ledgr's key bindings",
        ("ledgr blocks in " + ", ".join(f"layouts/{n}.json" for n, _ in lays)) if lays else None,
        "mods/ledgr" + (", mods/ledgr-pane" if os.path.isdir(os.path.join(ctx.mods, CHIP)) else ""),
        ("overlay mods " + ", ".join(ov.get("mods") or []) + " (back to their originals)") if ov else None])))
    say("  keeps:   the Keychain item; ledgr-data/ unless you say so below")
    if not ask.yesno("Uninstall ledgr?", "Every file is backed up first.", True):
        raise SystemExit("Nothing changed.")
    notes = []
    # 2a. the MCP server registration, per config folder (Claude Code's own command)
    for path in mcp_files:
        argv, d, line = mcp_command(ctx, path)
        ctx.backup(mcp_user_json(path))
        rc, out, err = run([argv[0], "mcp", "remove", "--scope", "user", MCP_NAME], env=claude_env(d), timeout=60)
        notes.append(f"{tilde(os.path.dirname(path))}: MCP server ledgr " + ("removed" if rc == 0 else
                     f"NOT removed ({(err or out).strip()[:120]}); run: " + ("CLAUDE_CONFIG_DIR=" + d + " " if d else "") + "claude mcp remove --scope user ledgr"))
    # 2b. hooks and the MCP allow entries, in every Claude settings file that has them
    for path in sett_files:
        sett, style, _ = load_json(path)
        new = json.loads(json.dumps(sett))
        perms = new.get("permissions") if isinstance(new.get("permissions"), dict) else None
        if perms is not None and isinstance(perms.get("allow"), list):
            perms["allow"] = [x for x in perms["allow"] if x not in MCP_TOOLS]
            pr0 = st.original(st.rec(path))
            orig = json.loads(pr0.decode("utf-8")) if pr0 else {}
            if not perms["allow"] and "allow" not in (orig.get("permissions") or {}):
                del perms["allow"]
            if not perms and "permissions" not in orig:
                del new["permissions"]
        hooks = new.get("hooks") or {}
        for ev in list(hooks):
            hooks[ev] = [e for e in hooks[ev] if not any(HOOK_MARK in (h.get("command") or "") for h in e.get("hooks") or [])]
            if not hooks[ev]:
                del hooks[ev]
        if "hooks" in new and not new["hooks"]:
            pr = st.original(st.rec(path))
            if pr is None or "hooks" not in json.loads(pr.decode("utf-8")):
                del new["hooks"]          # ledgr made the "hooks" object; nothing else is in it
        restore_or_surgical(ctx, st, path, new, style, tilde(path), notes, marked=lambda b: HOOK_MARK.encode() in b)
    # 3. layouts
    chips = {CHIP} | ({ov["chip"]} if ov and ov.get("chip") else set())
    for name, p in lays:
        root, style, _ = load_json(p)
        new = json.loads(json.dumps(root))
        stl = st.d["layouts"].get(ctx.rel(p)) or {}
        remove_host(new, stl)
        for n, par in ledgr_nodes(new):
            if par is not None:
                remove_child(par, n)
        col, colp = by_id(new, PANEL_COL)
        if col is not None and not col.get("children") and colp is not None:
            remove_child(colp, col)
        rec = st.pristine(p, marked_json)
        proot = None
        if st.original(rec) is not None:
            try:
                proot = json.loads(st.original(rec).decode("utf-8"))
            except ValueError:
                proot = None
        if header_mod(new) in chips:
            prev = stl.get("header_prev") or (header_mod(proot) if proot is not None else None) or "pane"
            tb, _ = tab_block(new)
            tb["content"]["pane"]["header"]["content"]["mod"] = prev
        restore_or_surgical(ctx, st, p, new, style, f"layouts/{name}.json", notes)
    # layouts install.sh cloned: back to the clone as made, so delete it unless Herdr shows it
    for key in st.d.get("cloned") or []:
        p = st.path(key)
        rec = st.files.get(key) or {}
        if not os.path.exists(p) or st.original(rec) is None or read_bytes(p) != st.original(rec):
            continue
        name = os.path.basename(p)[:-5]
        if name == f.get("active"):
            notes.append(f"layouts/{name}.json: kept (install.sh cloned it; Herdr shows it now). Switch away with ctrl-shift-l, then delete the file if you like.")
        elif ask.yesno(f"Delete layouts/{name}.json, the clone install.sh made?", "It is a copy of a shipped layout with nothing of ledgr's left.", True):
            ctx.backup(p)
            os.remove(p)
            notes.append(f"layouts/{name}.json: deleted (install.sh had cloned it)")
    # 4. keys
    kp = os.path.join(ctx.home, "keys.json")
    if os.path.exists(kp):
        keys, style, _ = load_json(kp)
        new = json.loads(json.dumps(keys))
        owned = st.d["keys"]
        tcmds = {"ledgr.toggle", st.d.get("toggle_command")} | ({ov.get("toggle_command")} if ov else set())
        for sec, entries in owned.items():
            for key, info in entries.items():
                if new.get(sec, {}).get(key) == info.get("value"):
                    if info.get("prev") is None:
                        del new[sec][key]
                    else:
                        new[sec][key] = info["prev"]
        for sec, m in list(new.items()):
            if not isinstance(m, dict):
                continue
            for key, v in list(m.items()):
                if v == "mod.open:ledgr" or v in tcmds or (sec == "mod:ledgr"):
                    del m[key]
            if sec == "mod:ledgr" and not m:
                del new[sec]
        restore_or_surgical(ctx, st, kp, new, style, "keys.json", notes)
    # 5. overlay mods and engine copies
    refs = layout_refs(ctx)
    for m in sorted(set(host_mods(ctx)) | set((ov or {}).get("mods") or [])):
        if os.path.isdir(os.path.join(ctx.mods, m)):
            notes.append(revert_overlay_mod(ctx, st, m, refs, drop_edited=True))
    # 6. ledgr's own mods
    for m in (CHIP, MOD):
        d = os.path.join(ctx.mods, m)
        if os.path.isdir(d):
            ctx.backup(d)
            shutil.rmtree(d)
            notes.append(f"mods/{m}: removed")
    # 7. data
    purge = args.purge_data if ctx.yes else ask.yesno("Also delete ledgr-data/ (your parked questions, asks, sessions and decisions)?",
                                                      "Keeping it lets a reinstall pick up exactly where you left off.", False)
    if purge and os.path.isdir(ctx.data):
        ctx.backup(ctx.data)
        shutil.rmtree(ctx.data)
        notes.append("ledgr-data/: deleted (a copy is in the backup folder)")
    else:
        notes.append("ledgr-data/: kept")
    if os.path.exists(ctx.state_file):
        os.replace(ctx.state_file, os.path.join(ctx.state_dir, f"install-state.uninstalled-{ctx.stamp}.json"))
    head("Done")
    for n in notes:
        say(f"  - {n}")
    if ctx.backup_dir:
        say(f"  backups: {tilde(ctx.backup_dir)}")
    prov = a.get("provider")
    if prov in ("anthropic", "openai-compatible"):
        say(f"  the Keychain item stays; to remove it yourself: security delete-generic-password -s ledgr -a {prov}")
    say(f"  reinstall: ./install.sh --yes --answers {tilde(out)}")
    return 0


def make_ctx(args):
    """The context from the flags, then the answers file's herdr_home and claude_settings (a list or
    one string) where no flag or HERDR_HOME gives them."""
    ctx = Ctx(args)
    if args.answers:
        try:
            fa, _, _ = load_json(expand(args.answers))
        except ValueError:
            fa = None
        if isinstance(fa, dict):
            hh = fa.get("herdr_home") if not args.herdr_home and not os.environ.get("HERDR_HOME") else None
            cs = None if args.claude_settings else (as_list(fa.get("claude_settings")) or None)
            if hh or cs:
                ctx = Ctx(argparse.Namespace(**dict(vars(args), herdr_home=hh or args.herdr_home, claude_settings=cs or args.claude_settings)))
    return ctx


# ── main ──────────────────────────────────────────────────────────────────────────────────────
def main(argv):
    ap = argparse.ArgumentParser(prog="install.sh", description="Install, check or uninstall the ledgr Herdr mod.")
    ap.add_argument("command", nargs="?", default="install", choices=["install", "check", "uninstall"])
    ap.add_argument("--yes", "-y", action="store_true", help="take every default and answer; ask nothing")
    ap.add_argument("--answers", metavar="FILE", help="answers file (ledgr.install.json); see setup/answers.example.json")
    ap.add_argument("--save-answers", metavar="FILE", help="write the answers used to FILE")
    ap.add_argument("--herdr-home", metavar="DIR")
    ap.add_argument("--claude-settings", metavar="FILE", action="append",
                    help="a Claude settings file to hook; repeat for each config folder (the first is the primary)")
    ap.add_argument("--state-dir", metavar="DIR")
    ap.add_argument("--provider", choices=[p for p, _ in PROVIDERS])
    ap.add_argument("--model")
    ap.add_argument("--base-url")
    ap.add_argument("--api-key", choices=["keep", "prompt", "skip"], help="what to do about the Keychain item (the key itself: prompt, or LEDGR_API_KEY with --yes)")
    ap.add_argument("--threshold", choices=[t for t, _ in THRESHOLDS])
    ap.add_argument("--asks-handoff", choices=[v for v, _ in HANDOFFS], help="who owns the closing list: ledgr, both or prose")
    ap.add_argument("--animations", choices=["on", "off"])
    ap.add_argument("--fold-while-working", choices=["on", "off"])
    ap.add_argument("--instruct-block", choices=["on", "off"])
    ap.add_argument("--mcp", choices=["on", "off"], help="register ledgr's MCP server with Claude Code (user scope) and add its allow entries")
    ap.add_argument("--capture-key")
    ap.add_argument("--toggle-key")
    ap.add_argument("--replace-conflicts", action="store_true")
    ap.add_argument("--layout", metavar="NAME")
    ap.add_argument("--clone-from", metavar="SHIPPED")
    ap.add_argument("--panel", choices=["stack", "column", "skip"])
    ap.add_argument("--panel-stack", metavar="ID")
    ap.add_argument("--host", metavar="status|tabs|floating|none|MOD")
    ap.add_argument("--chip", metavar="ledgr-pane|none|MOD")
    ap.add_argument("--overlay", metavar="DIR")
    ap.add_argument("--agents", metavar="claude", help="comma-separated; '' for none")
    ap.add_argument("--no-hooks", action="store_true")
    ap.add_argument("--no-tests", action="store_true")
    ap.add_argument("--answers-out", metavar="FILE", help="uninstall: where to write the current choices")
    ap.add_argument("--purge-data", action="store_true", help="uninstall --yes: also delete ledgr-data/")
    ap.add_argument("--check", action="store_true", help="same as the check command")
    ap.add_argument("--thaw-all", action="store_true",
                    help="write retention.coldDays 0 and wait until every session is back in store.json (before a rollback); with --yes, ask nothing")
    args = ap.parse_args(argv)
    if args.check:
        args.command = "check"
    flags = {}
    for k in ("provider", "model", "base_url", "threshold", "api_key", "asks_handoff"):
        if getattr(args, k) is not None:
            flags[k] = getattr(args, k)
    for k, fk in (("animations", "animations"), ("fold_while_working", "fold_asks_while_working"), ("instruct_block", "instruct_block"), ("mcp", "mcp")):
        if getattr(args, k) is not None:
            flags[fk] = getattr(args, k) == "on"
    keys = {}
    if args.capture_key:
        keys["capture"] = args.capture_key
    if args.toggle_key:
        keys["toggle"] = args.toggle_key
    if args.replace_conflicts:
        keys["replace_conflicts"] = True
    if keys:
        flags["keys"] = keys
    lay = {}
    for k in ("layout", "clone_from", "panel", "panel_stack", "host", "chip"):
        v = getattr(args, k)
        if v is not None:
            lay["name" if k == "layout" else k] = v
    if lay:
        flags["layout"] = lay
    if args.overlay is not None:
        flags["overlay"] = args.overlay or None
    if args.agents is not None:
        flags["agents"] = [x for x in args.agents.split(",") if x]
    if args.no_hooks:
        flags["agents"] = []
    ctx = make_ctx(args)
    try:
        if args.thaw_all:
            return cmd_thaw_all(ctx, args)
        if args.command == "check":
            return cmd_check(ctx, args)
        if args.command == "uninstall":
            return cmd_uninstall(ctx, args)
        return cmd_install(ctx, args, flags)
    except KeyboardInterrupt:
        say("\nStopped. Files already written are listed in the backup folder, if any.")
        return 130


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
