#!/usr/bin/env python3
"""ledgr installer, doctor and uninstaller. Run through ./install.sh, ./install.sh --check and
./uninstall.sh (POSIX sh wrappers that find python3). Standard library only.

  install     preflight, questions (each with a one-line why; defaults in brackets are the
              current values), a plan, then: deploy the mods, write config.json, store the API
              key in the Keychain, merge key bindings, patch one personal layout, register the
              Claude Code hooks, run `herdr-app check` and the offline tests, print a summary.
  check       the doctor: everything the preflight checks, plus whether the hooks fire, whether a
              writer holds the role, whether the Keychain item resolves.
  uninstall   writes the current choices to <state>/last-install.json, then reverses hooks, key
              bindings, layout blocks and mods: it restores the files saved before ledgr first
              touched them when only ledgr's entries differ, and otherwise removes ledgr's entries
              alone. ledgr-data/ only after a separate yes. Never touches the Keychain item.

Answers come from (later wins): built-in defaults, what is installed now, --answers FILE
(ledgr.install.json), and flags. --yes takes every default without asking.
Install state, backups and the saved originals live in ~/.local/state/ledgr (--state-dir)."""
import argparse
import datetime
import getpass
import hashlib
import json
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
AGENTS = [("claude", "Claude Code", True), ("codex", "Codex", False), ("gemini", "Gemini CLI", False),
          ("opencode", "OpenCode", False)]
PROVIDERS = [("anthropic", "Anthropic API (Claude Haiku; an API key in the Keychain)"),
             ("openai-compatible", "an OpenAI-compatible server (base URL and model; key optional)"),
             ("cli", "`claude -p` on your Claude Code subscription (no key; slower; untested end to end)"),
             ("none", "no model: asks come only from a fenced ledgr-asks block the agent writes")]
DEFAULT_MODEL = {"anthropic": "claude-haiku-5-5", "openai-compatible": "", "cli": "haiku", "none": "claude-haiku-5-5"}
THRESHOLDS = [("blocking", "blocking only"), ("needed", "blocking + needed (default)"), ("optional", "everything")]
MOD_KEYS = {"cmd-enter": "ledgr.btw", "tab": "ledgr.tab", "shift-tab": "ledgr.backtab"}
CAPTURE_ALTS = ["cmd-j", "cmd-alt-j", "cmd-ctrl-j", "cmd-shift-k"]
TOGGLE_ALTS = ["cmd-shift-j", "cmd-alt-shift-j", "cmd-ctrl-shift-j", "cmd-alt-l"]
EXCLUDE = {"gpui-kit.d.ts", "jsconfig.json", "__pycache__", ".DS_Store"}
PANEL_BLOCK = {"id": "ledgr", "type": "block", "content": {"mod": "ledgr", "props": {"view": "panel"}}}
DEFAULT_PLACE = {"column": "panel", "stack": "panel-body", "child": "ledgr"}
HOST_ID, HOST_ROW, PANEL_COL = "ledgr-host", "ledgr-host-row", "ledgr-panel"


# ── small helpers ─────────────────────────────────────────────────────────────────────────────
def say(msg=""):
    print(msg, flush=True)


def head(msg):
    say(f"\n== {msg}")


def expand(p):
    return os.path.abspath(os.path.expanduser(os.path.expandvars(p))) if p else p


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
    return {"indent": indent, "nl": raw.endswith("\n"), "ascii": all(ord(c) < 128 for c in raw)}


def dump(data, style=None):
    st = style or {"indent": 2, "nl": True, "ascii": False}
    return json.dumps(data, indent=st["indent"], ensure_ascii=st["ascii"]) + ("\n" if st["nl"] else "")


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


# ── context ───────────────────────────────────────────────────────────────────────────────────
class Ctx:
    def __init__(self, a):
        self.home = expand(a.herdr_home or os.environ.get("HERDR_HOME") or os.environ.get("HERDR_APP_HOME") or "~/.config/herdr-app")
        self.settings = expand(a.claude_settings or os.environ.get("LEDGR_CLAUDE_SETTINGS") or "~/.claude/settings.json")
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
        self.d["herdr_home"], self.d["claude_settings"] = self.ctx.home, self.ctx.settings
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


def derive(ctx, st, f):
    """The answers that reproduce what is installed now."""
    a = {}
    cfg = read_cfg(ctx)
    ex = cfg.get("extract") or {}
    if cfg:
        a["provider"] = "none" if ex.get("mode") == "block-only" else (ex.get("provider") or "anthropic")
        a["model"] = ex.get("model")
        a["base_url"] = ex.get("base_url")
        if ex.get("threshold"):
            a["threshold"] = ex["threshold"]
        ui = cfg.get("ui") or {}
        if "animations" in ui:
            a["animations"] = ui["animations"] is not False
        if "foldAsksWhileWorking" in ui:
            a["fold_asks_while_working"] = ui["foldAsksWhileWorking"] is True
        a["instruct_block"] = cfg.get("instruct_block") is True
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
    sett, _, _ = load_json(ctx.settings) if os.path.exists(ctx.settings) else (None, None, None)
    registered = any(HOOK_MARK in (h.get("command") or "") for lst in ((sett or {}).get("hooks") or {}).values()
                     for e in lst for h in (e.get("hooks") or []))
    if registered:
        a["agents"], a["hooks"] = ["claude"], True
    a["api_key"] = "keep"
    return a


def merge(base, over):
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


DEFAULTS = {
    "agents": ["claude"], "provider": "anthropic", "model": None, "base_url": None, "api_key": "prompt",
    "instruct_block": None, "threshold": "needed", "animations": True, "fold_asks_while_working": False,
    "keys": {"capture": "cmd-j", "toggle": "cmd-shift-j", "toggle_command": None, "replace_conflicts": False},
    "layout": {"name": None, "clone_from": None, "panel": "stack", "panel_stack": "panel-body", "host": "status", "chip": "ledgr-pane"},
    "overlay": None, "hooks": True, "run_tests": True,
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


def gather(ctx, st, f, a, file_answers, flags):
    """Merge defaults, installed values, the answers file and flags; then ask what is still open."""
    ask = Asker(ctx.yes)
    ans = merge(DEFAULTS, st.d["answers"])
    ans = merge(ans, derive(ctx, st, f))
    ans = merge(ans, file_answers)
    ans = merge(ans, flags)
    head("Questions" if not ctx.yes else "Answers")
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
    ib = ans.get("instruct_block")
    ans["instruct_block"] = ask.yesno("Ask Claude to write a ledgr-asks block at the end of each turn?",
                                      "Adds a short instruction to every session's context; with no provider it is the only way asks arrive.",
                                      (prov == "none") if ib is None else bool(ib))
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
        if ov and ov.get("chip"):
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
    if ans["agents"]:
        todo, fix = hook_plan(ctx)
        if todo or fix:
            say(f"\n  Claude Code hooks: ledgr adds these entries to {tilde(ctx.settings)}, exactly:")
            for ev, entry in todo:
                say(f'    "{ev}": [ ..., {json.dumps(entry)} ]')
            for ev, old, new in fix:
                say(f"    {ev}: {old}  ->  {new}  (the mod moved)")
            ans["hooks"] = ask.yesno("Add them?", "Claude Code runs them at session start, at each prompt and at each turn's end; each exits in milliseconds and prints nothing to the model.",
                                     ans.get("hooks") is not False)
        else:
            ans["hooks"] = True
    else:
        ans["hooks"] = False
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


def apply_config(ctx, ans, changes):
    p = os.path.join(ctx.data, "config.json")
    try:
        cfg, style, raw = load_json(p)
    except ValueError:
        raise SystemExit(f"{p} is not valid JSON; fix or move it, then run again.")
    if cfg is None:
        sys.path.insert(0, os.path.join(ctx.mods, MOD, "bin", "lib"))
        os.environ.setdefault("LEDGR_DATA", ctx.data)
        import ledgr_config  # noqa: E402  (the hooks' defaults)
        cfg, style, raw = json.loads(json.dumps(ledgr_config.DEFAULT_CONFIG)), {"indent": 2, "nl": True, "ascii": False}, None
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
    new["instruct_block"] = bool(ans["instruct_block"])
    ui = new.setdefault("ui", {})
    ui["animations"] = bool(ans["animations"])
    ui["foldAsksWhileWorking"] = bool(ans["fold_asks_while_working"])
    place = ans.get("_place")
    if place and place != DEFAULT_PLACE:
        ui["panel"] = place
    elif "panel" in ui and place == DEFAULT_PLACE:
        del ui["panel"]
    if new != cfg or raw is None:
        if raw is not None:
            ctx.backup(p)
        write_atomic(p, dump(new, style))
        changes.append(f"ledgr-data/config.json: {'created' if raw is None else 'updated'} (provider {prov}, threshold {ans['threshold']})")


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


def hook_plan(ctx):
    sett, style, raw = load_json(ctx.settings) if os.path.exists(ctx.settings) else ({}, None, None)
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
    if not ans["agents"]:
        return
    todo, fix = hook_plan(ctx)
    if os.path.exists(ctx.settings):
        st.pristine(ctx.settings, lambda b: HOOK_MARK.encode() in b)
    if not todo and not fix:
        say("  hooks: already registered")
        st.d["hooks"] = [e for _, e, _ in hook_entries(ctx)]
        return
    if not ans.get("hooks"):
        say("  hooks not written (declined): ledgr sees no Claude session until they are (./install.sh again).")
        return
    try:
        sett, style, raw = load_json(ctx.settings) if os.path.exists(ctx.settings) else (None, None, None)
    except ValueError:
        raise SystemExit(f"{ctx.settings} is not valid JSON; nothing written.")
    new = json.loads(json.dumps(sett or {}))
    hooks = new.setdefault("hooks", {})
    for ev, entry in todo:
        hooks.setdefault(ev, []).append(entry)
    for ev, old, cmd in fix:
        for e in hooks.get(ev) or []:
            for h in e.get("hooks") or []:
                if h.get("command") == old:
                    h["command"] = cmd
    ctx.backup(ctx.settings)
    text = dump(new, style or {"indent": 2, "nl": True, "ascii": False})
    write_atomic(ctx.settings, text)
    st.wrote(ctx.settings, text)
    st.d["hooks"] = [e for _, e, _ in hook_entries(ctx)]
    changes.append(f"{tilde(ctx.settings)}: {len(todo)} hook entr{'y' if len(todo) == 1 else 'ies'} added" + (f", {len(fix)} repointed" if fix else ""))


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
    say(f"  config      provider {ans['provider']}{' ' + ans['model'] if ans['provider'] != 'none' and ans.get('model') else ''}; threshold {ans['threshold']}; animations {'on' if ans['animations'] else 'off'}; fold while working {'on' if ans['fold_asks_while_working'] else 'off'}")
    say(f"  keys        {ans['keys']['capture']} park a question; {ans['keys']['toggle']} -> {ans['keys']['toggle_command']}" +
        (f"; replaces {', '.join(f'{s}:{c}' for s, c in ans['keys']['replaced'])}" if ans['keys']['replaced'] else ""))
    say(f"  layout      {('layouts/' + lay['name'] + '.json') if lay.get('name') else 'none'}" +
        (f" (cloned from {lay['clone_from']})" if lay.get("clone_from") else "") +
        (f"; panel {lay.get('panel')}; host {lay.get('host')}; chip {lay.get('chip')}" if lay.get("name") else ""))
    say(f"  hooks       {'Claude Code: SessionStart, UserPromptSubmit, Stop' if ans['agents'] and ans['hooks'] else 'none'}")
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
    apply_config(ctx, ans, changes)
    apply_keys(ctx, st, ans, changes)
    apply_hooks(ctx, st, ans, changes)
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
def cmd_check(ctx, args):
    st = State(ctx)
    f = preflight(ctx)
    bad = list(f["hard"])
    head("ledgr")
    cfg = read_cfg(ctx)
    ex = cfg.get("extract") or {}
    prov = "none" if ex.get("mode") == "block-only" else ex.get("provider") or "anthropic"
    say(f"  config.json     {'ok' if cfg else 'missing (the first hook run creates it)'}; provider {prov}; threshold {ex.get('threshold', 'needed')}")
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
    sett, _, _ = load_json(ctx.settings) if os.path.exists(ctx.settings) else (None, None, None)
    for ev, entry, script in hook_entries(ctx):
        mark = f"mods/ledgr/bin/adapters/claude/{script}"
        cmds = [h.get("command") for e in ((sett or {}).get("hooks") or {}).get(ev) or [] for h in e.get("hooks") or [] if mark in (h.get("command") or "")]
        path = os.path.join(ctx.mods, MOD, "bin", "adapters", "claude", script)
        okx = os.access(path, os.X_OK)
        say(f"  hook {ev:<17} {'registered' if cmds else 'NOT registered'}; script {'executable' if okx else 'missing or not executable'}")
        if not cmds or not okx:
            bad.append(f"hook {ev}")
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
    w = f["shared"].get("ledgr.writer")
    if isinstance(w, dict) and w.get("id"):
        say(f"  writer          held by {w.get('by')} (claimed {ago((w.get('at') or 0) / 1000)})")
    else:
        say("  writer          no claim yet" + (" (Herdr is not running)" if not f["running"] else " (show the panel, or add the host block)"))
        if f["running"]:
            bad.append("no writer holds the role")
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
    head("Result")
    for b in bad:
        say(f"  X {b}")
    say("  healthy" if not bad else f"  {len(bad)} problem(s)")
    return 0 if not bad else 1


# ── uninstall ─────────────────────────────────────────────────────────────────────────────────
def restore_or_surgical(ctx, st, path, surgical, style, label, notes):
    """Writes the saved original when it equals the surgical result (only ledgr's entries differed);
    otherwise writes the surgical result. Says which."""
    rec = st.rec(path)
    if not rec.get("pristine"):
        rec = st.pristine(path, (lambda b: HOOK_MARK.encode() in b) if path == ctx.settings else marked_json)
    pr = st.original(rec)
    cur = read_bytes(path)
    if pr is not None:
        try:
            same = json.loads(pr.decode("utf-8")) == surgical
        except ValueError:
            same = False
        if same:
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
    sett_has = os.path.exists(ctx.settings) and HOOK_MARK.encode() in (read_bytes(ctx.settings) or b"")
    lays = []
    for name, shipped in f["layouts"]:
        p = os.path.join(ctx.home, "layouts", name + ".json")
        b = read_bytes(p) or b""
        if not shipped and (b"ledgr" in b or (ov and ov.get("chip") and f'"{ov["chip"]}"'.encode() in b)):
            lays.append((name, p))
    say("  removes: " + ", ".join(filter(None, [
        "the Claude Code hooks" if sett_has else None, "ledgr's key bindings",
        ("ledgr blocks in " + ", ".join(f"layouts/{n}.json" for n, _ in lays)) if lays else None,
        "mods/ledgr" + (", mods/ledgr-pane" if os.path.isdir(os.path.join(ctx.mods, CHIP)) else ""),
        ("overlay mods " + ", ".join(ov.get("mods") or []) + " (back to their originals)") if ov else None])))
    say("  keeps:   the Keychain item; ledgr-data/ unless you say so below")
    if not ask.yesno("Uninstall ledgr?", "Every file is backed up first.", True):
        raise SystemExit("Nothing changed.")
    notes = []
    # 2. hooks
    if sett_has:
        sett, style, _ = load_json(ctx.settings)
        new = json.loads(json.dumps(sett))
        hooks = new.get("hooks") or {}
        for ev in list(hooks):
            hooks[ev] = [e for e in hooks[ev] if not any(HOOK_MARK in (h.get("command") or "") for h in e.get("hooks") or [])]
            if not hooks[ev]:
                del hooks[ev]
        if "hooks" in new and not new["hooks"]:
            pr = st.original(st.rec(ctx.settings))
            if pr is None or "hooks" not in json.loads(pr.decode("utf-8")):
                del new["hooks"]          # ledgr made the "hooks" object; nothing else is in it
        restore_or_surgical(ctx, st, ctx.settings, new, style, tilde(ctx.settings), notes)
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
        d = os.path.join(ctx.mods, m)
        if not os.path.isdir(d):
            continue
        if os.path.isdir(os.path.join(d, "ledgr")):
            ctx.backup(os.path.join(d, "ledgr"))
            shutil.rmtree(os.path.join(d, "ledgr"))
        unknown, restored, deleted = [], 0, 0
        for key, rec in sorted(st.files.items()):
            path = st.path(key)
            if not path.startswith(d + "/"):
                continue
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
        if unknown and m not in refs:
            ctx.backup(d)
            shutil.rmtree(d)
            notes.append(f"mods/{m}: removed (no layout uses it; no copy from before ledgr of {', '.join(unknown)})")
        elif unknown:
            notes.append(f"mods/{m}: kept {', '.join(unknown)} as they are (no copy from before ledgr, and a layout still uses the mod)")
        elif restored or deleted:
            notes.append(f"mods/{m}: {restored} file(s) back to their originals from before ledgr" + (f", {deleted} added by ledgr removed" if deleted else "") + "; engine copy removed")
        else:
            notes.append(f"mods/{m}: engine copy removed; its other files were already as before ledgr" if any(st.path(k).startswith(d + "/") for k in st.files)
                         else f"mods/{m}: engine copy removed; no record of its originals, files left as they are")
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


# ── main ──────────────────────────────────────────────────────────────────────────────────────
def main(argv):
    ap = argparse.ArgumentParser(prog="install.sh", description="Install, check or uninstall the ledgr Herdr mod.")
    ap.add_argument("command", nargs="?", default="install", choices=["install", "check", "uninstall"])
    ap.add_argument("--yes", "-y", action="store_true", help="take every default and answer; ask nothing")
    ap.add_argument("--answers", metavar="FILE", help="answers file (ledgr.install.json); see setup/answers.example.json")
    ap.add_argument("--save-answers", metavar="FILE", help="write the answers used to FILE")
    ap.add_argument("--herdr-home", metavar="DIR")
    ap.add_argument("--claude-settings", metavar="FILE")
    ap.add_argument("--state-dir", metavar="DIR")
    ap.add_argument("--provider", choices=[p for p, _ in PROVIDERS])
    ap.add_argument("--model")
    ap.add_argument("--base-url")
    ap.add_argument("--api-key", choices=["keep", "prompt", "skip"], help="what to do about the Keychain item (the key itself: prompt, or LEDGR_API_KEY with --yes)")
    ap.add_argument("--threshold", choices=[t for t, _ in THRESHOLDS])
    ap.add_argument("--animations", choices=["on", "off"])
    ap.add_argument("--fold-while-working", choices=["on", "off"])
    ap.add_argument("--instruct-block", choices=["on", "off"])
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
    args = ap.parse_args(argv)
    if args.check:
        args.command = "check"
    flags = {}
    for k in ("provider", "model", "base_url", "threshold", "api_key"):
        if getattr(args, k) is not None:
            flags[k] = getattr(args, k)
    for k, fk in (("animations", "animations"), ("fold_while_working", "fold_asks_while_working"), ("instruct_block", "instruct_block")):
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
    ctx = Ctx(args)
    if args.answers and not args.herdr_home and not os.environ.get("HERDR_HOME"):
        try:
            fa, _, _ = load_json(expand(args.answers))
            if isinstance(fa, dict):
                if fa.get("herdr_home"):
                    ctx.__init__(argparse.Namespace(**dict(vars(args), herdr_home=fa["herdr_home"], claude_settings=args.claude_settings or fa.get("claude_settings"))))
        except ValueError:
            pass
    try:
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
