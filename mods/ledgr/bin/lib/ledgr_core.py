"""ledgr core: paths, ids, atomic writes, a flock, the log, passage hashes, the Keychain read.
Standard library only, and nothing agent-specific: every spool producer (the Claude Code hooks
today, an MCP stdio server later) can import it. Nothing here prints to stdout.
"""
import fcntl
import hashlib
import json
import os
import re
import time

HOME = os.path.expanduser("~")
DATA = os.environ.get("LEDGR_DATA") or os.path.join(HOME, ".config/herdr-app/ledgr-data")
LIB = os.path.dirname(os.path.abspath(__file__))       # bin/lib
ROOT = os.path.dirname(LIB)                              # bin/
PYTHON = "/opt/homebrew/bin/python3"
SECURITY = "/usr/bin/security"
CURL = "/usr/bin/curl"
TOOL_PATH = "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
KEYCHAIN_SERVICE = os.environ.get("LEDGR_KEYCHAIN_SERVICE") or "ledgr"

def now_ms():
    return time.time_ns() // 1_000_000


def terminal_id():
    """Herdr's terminal address, else the LEDGR_TERMINAL override (hooks outside Herdr)."""
    return os.environ.get("HC_TERMINAL_ID") or os.environ.get("LEDGR_TERMINAL") or ""


def tfile(t):
    return t.replace("/", "__")


def path(*parts):
    return os.path.join(DATA, *parts)


def new_uuid():
    b = bytearray(os.urandom(16))
    b[6] = (b[6] & 0x0F) | 0x40
    b[8] = (b[8] & 0x3F) | 0x80
    h = b.hex()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


# ---------- files ----------

def atomic_write(dest, data):
    """Write a temp file (dot-named, same folder) and rename it over dest."""
    d = os.path.dirname(dest)
    os.makedirs(d, exist_ok=True)
    if isinstance(data, str):
        data = data.encode("utf-8")
    tmp = os.path.join(d, f".tmp.{os.getpid()}.{os.urandom(4).hex()}")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_json(dest, obj, indent=None):
    atomic_write(dest, json.dumps(obj, ensure_ascii=False, indent=indent,
                                  separators=None if indent else (",", ":")))


def read_json(p, default=None):
    try:
        with open(p, "rb") as f:
            v = json.loads(f.read().decode("utf-8"))
        return v
    except Exception:
        return default


def read_text(p, default=""):
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except Exception:
        return default


# ---------- lock ----------

class Lock:
    """Exclusive flock on locks/<name>.lock. Waits up to `wait` seconds, then fails open
    (a hook must never hang). The kernel drops the lock if the holder dies."""

    def __init__(self, name, wait=3.0):
        self.p = path("locks", re.sub(r"[^A-Za-z0-9_.-]", "_", name) + ".lock")
        self.wait = wait
        self.fd = None

    def __enter__(self):
        try:
            os.makedirs(os.path.dirname(self.p), exist_ok=True)
            self.fd = os.open(self.p, os.O_RDWR | os.O_CREAT, 0o600)
            deadline = time.monotonic() + self.wait
            while True:
                try:
                    fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() > deadline:
                        log(f"lock timeout {self.p}; continuing unlocked")
                        break
                    time.sleep(0.005)
            os.utime(self.p, None)
        except Exception as ex:
            log(f"lock error {ex}; continuing unlocked")
        return self

    def __exit__(self, *a):
        if self.fd is not None:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_UN)
                os.close(self.fd)
            except OSError:
                pass


# ---------- log ----------

def log(line, name="hook.log"):
    try:
        d = path("log")
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, name)
        try:
            if os.path.getsize(p) > 1_000_000:
                os.replace(p, p + ".1")
        except OSError:
            pass
        with open(p, "a", encoding="utf-8") as f:
            f.write(f"{now_ms()} {line}\n")
    except Exception:
        pass


# ---------- text ----------

_WS = re.compile(r"[\s\ufeff]+")


def squash(s):
    """Whitespace-collapsed text, the same rule as the mod's squash() in store.js."""
    return _WS.sub(" ", s or "").strip()


def passage_hash(s):
    """sha1 of the whitespace-collapsed passage, first 12 hex chars (matches store.js passageHash)."""
    s = squash(s)
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12] if s else None


def repo_of(cwd):
    """Basename of the git top level that contains cwd (a .git dir or file), else of cwd."""
    if not cwd:
        return None
    d = os.path.abspath(cwd)
    while True:
        if os.path.exists(os.path.join(d, ".git")):
            return os.path.basename(d) or d
        parent = os.path.dirname(d)
        if parent == d:
            return os.path.basename(os.path.abspath(cwd)) or None
        d = parent


# ---------- credential ----------

def read_key(account, timeout=15):
    """API key for a provider: LEDGR_<ACCOUNT>_KEY env, else Keychain service `ledgr`
    (LEDGR_KEYCHAIN_SERVICE overrides, for tests), account = provider name.
    Returns (key, None) or (None, reason)."""
    env = "LEDGR_" + re.sub(r"[^A-Z0-9]", "_", account.upper()) + "_KEY"
    if os.environ.get(env):
        return os.environ[env].strip(), None
    import subprocess
    try:
        r = subprocess.run([SECURITY, "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
                           stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout,
                           env=dict(os.environ, LEDGR_INNER="1"))
    except subprocess.TimeoutExpired:
        return None, "keychain read timed out (access prompt not answered?)"
    except Exception as ex:
        return None, f"keychain read failed: {ex}"
    if r.returncode == 0:
        key = r.stdout.decode("utf-8", "replace").strip()
        return (key, None) if key else (None, "keychain item is empty")
    if r.returncode == 44:
        return None, f"no keychain item (service {KEYCHAIN_SERVICE}, account {account})"
    msg = r.stderr.decode("utf-8", "replace").strip().splitlines()
    return None, f"keychain read failed (exit {r.returncode}): {msg[0] if msg else ''}"[:200]


def spawn_detached(args, err_log="extract.err"):
    """Start a fully detached background process (own session, no stdio tied to the hook)."""
    import subprocess as sp
    os.makedirs(path("log"), exist_ok=True)
    with open(path("log", err_log), "ab") as err:
        sp.Popen(args, stdin=sp.DEVNULL, stdout=sp.DEVNULL, stderr=err, close_fds=True,
                 start_new_session=True, cwd=DATA, env=dict(os.environ, PATH=TOOL_PATH, LEDGR_INNER="1"))
