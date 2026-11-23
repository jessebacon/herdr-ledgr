#!/usr/bin/env python3
"""ledgr MCP server: a stdio Model Context Protocol server, the third spool producer (after the
Claude Code hooks and the capture box). An agent declares its asks of the person with a tool call
instead of a fenced ledgr-asks block; the server checks them with the shared validator
(lib/ledgr_asks.py), marks repeats against snapshot.json the way the extractor does
(lib/ledgr_extract.recorded_asks), and drops one `asks` spool event with `source: "tool"` through
lib/ledgr_spool.py. Standard library only, Python 3.9 or newer. README.md beside this file covers
registration, permissions, the Stop hook and what the writer does with the event.

Protocol: newline-delimited JSON-RPC 2.0 on stdin and stdout, dual-era:
  - legacy (2025-11-25 and earlier): `initialize` answers the requested version when it is one of
    LEGACY, else the newest of LEGACY; `notifications/initialized`; `ping`.
  - modern (2026-07-28): no handshake; every request carries `_meta` protocolVersion and
    clientCapabilities; `server/discover`; results carry `resultType` and serverInfo in `_meta`; an
    unknown version is error -32022 with the supported list.
  Methods: initialize, ping, server/discover, tools/list, tools/call, and (modern) subscriptions/listen,
  acknowledged and held open (the tool list never changes, so nothing is ever sent on it) until
  notifications/cancelled. Any other request is -32601; notifications are never answered; a response
  from the client is ignored. Stdout carries protocol
  messages only: the protocol stream is a private duplicate of fd 1, and fd 1 itself is pointed at
  stderr, so a stray print can never corrupt it. The log is ledgr-data/log/mcp.log.

Identity: HC_TERMINAL_ID (else LEDGR_TERMINAL) and CLAUDE_CONFIG_DIR, read at start, plus this
process's ancestry (the agent process that started the server). The session is resolved at every
call from terminals/<t>.json, because the hooks may map it after the server started:
  - the map entry's owner_pid is one of our ancestors: that session, its turn and prompt_id;
  - a nearer ancestor runs the same program as the recorded owner, or the owner is another live
    process: another agent owns the terminal (a child `claude -p` inherits HC_TERMINAL_ID), refused;
  - no entry, or its owner is gone, or (no pid to compare) it names another config folder: the
    terminal's synthetic session `herdr:<t>`, exactly as the capture box does, said in the result.
  No terminal id, or LEDGR_INNER set (a process a ledgr hook started): tools/list is empty.

Tools: declare_asks(items), resolve_asks(handles, note?), open_asks(), parked_questions().
Every declare_asks item needs a summary (2026-11-23: what the user must do, readable without the reply;
ledgr_asks.summary_of): a call with an item that has none is refused whole, with nothing written.
declare_asks writes ledgr-data/mcp/<session>/<turn>.json (the turn's declaration: call count, event
ids, asks, handles); a second call in the same turn sets `replaces_turn: true` on its event. After
emitting it waits up to LEDGR_MCP_WAIT_MS (default 2500) for the writer to ingest the event and reads
the handles from snapshot.json; when an event waits (over 5 s with store.json not written since) it
does not wait: the writer is behind (its claim in Herdr's shared.json shows it at work, or nothing says
more yet) or stalled (over WRITER_STALL_S, or the claim is gone, stale, stuck or backing off), and a
stalled writer is said plainly: the items are queued, not shown, and the agent tells the user and lists
them in its reply (writer_state, 2026-11-19). resolve_asks maps each
handle to this session's agent ask in snapshot.json (the items open_asks lists) and drops one `act`
event per ask still open, deferred or answered (action "resolve", actor "agent", the handle, the turn);
it waits for the writer the same way.

Cold sessions (retention Phase 2): a session nobody touched for retention.coldDays has its items in
ledgr-data/cold/<file>, named by snapshot.json's `cold` map, and its record in store.json. Every read here
goes through ledgr_extract.session_items, so open_asks, the repeats and the handle maps read that file,
filtered as the snapshot is: the same answers as for a warm session, with no wait (the writer thaws the
session at the event's pass, and the file stays at least an hour after). When the session's file cannot be
read (the writer's fault on its record, or this server's own read), declare_asks and resolve_asks still
send their events (the writer holds them in cold/held/<session>/ and applies them once the session is
read, reset or forgotten; resolve_asks sends an ask it cannot look up by handle, item null, which store.js
on_act resolves by handle), stay ok, add `cold` to the data and two lines: what happened, and to tell the
user and list the items. A wait that finds its event held (cold/held/, by event id) ends at once,
`writer: "held"`; an event gone from the spool and not held was applied, even while a snapshot.json the writer
could not write after the thaw still names the session cold (its handles may then read as pending).

Disabled spaces: a session is off when its record (sessions/<sid>.json) has `ledgr_off: true` (the
hooks set it at the prompt that finds its Herdr space disabled, so a turn that began off stays off) or
its `space` is in config.json spaces.disabled (missing: []). The space is the record's, else the map
entry's; a synthetic session with none recorded gets one live `hc get` (ledgr_map.herdr_space), the
lookup the panel makes for it. Every tool then answers ok with `off: true` and its usual fields empty,
writes nothing (no spool event, no mcp/<session>/<turn>.json) and logs one `off` line. The
instructions tell the agent to list what it needs in its reply when a call answers `off: true`.
"""
import json
import os
import re
import subprocess
import sys
import time
import traceback

sys.dont_write_bytecode = True       # never a __pycache__ in the mod folder (a save there reloads the mod)
HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.dirname(HERE)
sys.path[:0] = [p for p in (os.path.join(BIN, "lib"), BIN) if p not in sys.path]
import ledgr_core as C  # noqa: E402
import ledgr_asks as A  # noqa: E402
import ledgr_config as K  # noqa: E402
import ledgr_map as M  # noqa: E402
import ledgr_spool as S  # noqa: E402
import ledgr_extract as X  # noqa: E402

MODERN = ("2026-07-28",)
LEGACY = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
PV = "io.modelcontextprotocol/protocolVersion"
CAPS = "io.modelcontextprotocol/clientCapabilities"
CLIENT = "io.modelcontextprotocol/clientInfo"
SERVER = "io.modelcontextprotocol/serverInfo"
LOG = "mcp.log"
SHELLS = {"sh", "bash", "zsh", "dash", "ksh", "fish", "-sh", "-bash", "-zsh", "nohup", "env"}
KEEP_TURNS = 50
WRITER_STALE_S = 5
# A writer that has written nothing since the oldest waiting spool event arrived, that long ago, is not
# applying events (2026-11-19): mods/ledgr/writer.js PASS_STUCK_MS (test_mcp.py checks they agree).
WRITER_STALL_S = 90
# A claim Herdr saved that no writer renewed for this long: its holder stopped (it beats every 60 s).
CLAIM_STALE_S = 180


def _version():
    m = C.read_json(os.path.join(os.path.dirname(BIN), "mod.json"), {})
    return m.get("version") if isinstance(m, dict) and isinstance(m.get("version"), str) else "0"


SERVER_INFO = {"name": "ledgr", "title": "ledgr", "version": _version()}

INSTRUCTIONS = (
    "ledgr keeps the list of what the user must decide or do beside this conversation. It exists to cut the "
    "back and forth and to clear what blocks you; it is not a way to hand work to the user. Before you "
    "declare anything, do all the task needs that you can do yourself: look it up, run it, test it, and "
    "where a choice is yours to make, make it and say what you chose. Stop before a step the task "
    "needs that cannot be undone, and ask for a go-ahead. When a reply leaves something blocking or needed "
    "that only the user can give (a decision that is theirs, something only they know or hold, an action "
    "or check you cannot make yourself, a review they asked for, that go-ahead), call declare_asks once, "
    "when the work of the reply is done, and end the reply with the pointer line it returns, instead of a "
    "closing list or a ledgr-asks block. Never declare work you could do yourself, and never ask the user "
    "to look up, verify or summarise what you can. A step beyond what you were asked is an offer: do not "
    "take it and do not declare it; a line of prose is enough. Something "
    "you are waiting on from your own subagents, tools, builds, tests or processes is not an ask of the user, "
    "even when you write \"I need\": say it in prose and declare nothing. Give each item a summary that "
    "stands on its own: exactly what you need and in what form, what you have already done or ruled out, "
    "what you will do with each possible answer, the answer you recommend and why, and anything that cannot "
    "be undone. open_asks shows what is already recorded, with "
    "handles such as A7; when the user's message answers or drops one of them, call resolve_asks with its "
    "handle before declaring anything new. When a ledgr tool answers off: true, ledgr is off in this space: "
    "list what you need from the user in your reply instead. When a ledgr tool says its writer is not "
    "applying events, or that ledgr cannot read this session's earlier items, the user cannot see these items "
    "in ledgr yet: say so and list them in your reply as well.")

# A session where ledgr is off (spaces.disabled): (the result's note, its text) per tool.
OFF_WORDS = {
    "declare_asks": ("ledgr is off in this space: declared nothing; list what you need from the user in your reply",
                     "ledgr is off in this space: declared nothing. List what you need from the user in your "
                     "reply, as you would without ledgr, and end it without a pointer line."),
    "resolve_asks": ("ledgr is off in this space: closed nothing; asks are not tracked here",
                     "ledgr is off in this space: closed nothing. Asks are not tracked here."),
    "open_asks": ("ledgr is off in this space: no asks are tracked here; list what you need from the user in your reply",
                  "ledgr is off in this space: no asks are tracked here. List what you need from the user in "
                  "your reply."),
    "parked_questions": ("ledgr is off in this space: no parked questions are released here",
                         "ledgr is off in this space: no parked questions are released here."),
}

MAX_RESOLVE = 30                     # handles per resolve_asks call (the extractor lists at most 30 open asks)
CLOSED = ("resolved", "dismissed")   # store.js isClosed

ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "level": {"type": "string", "enum": ["blocking", "needed"],
                  "description": "blocking: you stopped or cannot finish without it. needed: you went on, "
                                 "but the work is unfinished until the user acts."},
        "kind": {"type": "string", "enum": sorted(A.KINDS)},
        "text": {"type": "string", "description": "One line: what the user must do or decide."},
        # No maxLength: a client that checks the schema would refuse a long summary, which ledgr cuts instead.
        "summary": {"type": "string",
                    "description": "Required. The item standing on its own, so the user can act on it without "
                                   "rereading your reply: exactly what you need from them and in what form, what "
                                   "you have already done or ruled out, what you will do with each possible "
                                   "answer, the answer you recommend and why, and anything that cannot be undone. "
                                   f"Markdown; line breaks are kept; cut at {A.MAX_SUMMARY:,} characters."},
        "quote": {"type": "string", "description": "The sentence of your reply it comes from, verbatim."},
        "options": {"type": "array", "items": {"type": "string"}, "maxItems": A.MAX_OPTIONS,
                    "description": "Only when there is a choice."},
        "recommended": {"type": "string", "description": "The option you recommend, if any."},
        "repeat_of": {"type": "string", "description": "The handle (A7) of an ask from open_asks that this raises again."},
    },
    "required": ["level", "kind", "text", "summary"],
    "additionalProperties": False,
}

# Said when a declare_asks call is refused for an item with no summary (2026-11-23): what a summary holds.
SUMMARY_WORDS = ("A summary says exactly what you need from the user and in what form, so they can act on it "
                 "without rereading your reply. It also says what you have already done or ruled out, what you "
                 "will do with each possible answer, the answer you recommend and why, and anything that cannot "
                 "be undone.")

TOOLS = [
    {
        "name": "declare_asks",
        "title": "Declare asks for the user",
        "description": (
            "Hand ledgr what only the user can give, instead of listing it in your reply. ledgr is there to cut "
            "the back and forth and to clear what blocks you, never to hand the user work: first do all the "
            "task needs that you can do yourself and make the choices that are yours; stop before a step "
            "the task needs that cannot be undone, and declare its go-ahead. Declare only blocking items (you "
            "stopped or cannot finish without it) and needed items (you went on, but the work is unfinished "
            "until the user acts); never suggestions or offers (a step beyond what you were asked is one: do "
            "not take it or declare it, a line of prose at most), never work you could do yourself, never a "
            "request to look up, verify or summarise what you can, and never a wait on your own subagents, "
            "tools, builds or tests, even when you write \"I need\". text: one line. summary: required on every item, so it "
            "stands on its own (a call missing one records nothing). quote: the sentence of your "
            "reply it comes from, verbatim. options: only for a choice. Call it once, when the reply's work is "
            "done; a second call in the turn replaces the first. Then end your reply with the pointer "
            "line it returns, and list nothing in prose."),
        "inputSchema": {"type": "object", "properties": {"items": {"type": "array", "items": ITEM_SCHEMA,
                                                                    "maxItems": A.MAX_ASKS}},
                        "required": ["items"], "additionalProperties": False},
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True,
                        "openWorldHint": False},
        "_meta": {"anthropic/alwaysLoad": True},
    },
    {
        "name": "resolve_asks",
        "title": "Close asks the user settled",
        "description": (
            "Close asks the user has answered or made moot in their latest message, by handle (A4, as "
            "open_asks and declare_asks give them). Call it before declare_asks in the same reply. Never "
            "close an ask the user has not addressed; the user can reopen one in the panel. note: one line "
            "on how it was settled, only if it helps. Unknown or already closed handles are reported, not "
            "errors."),
        "inputSchema": {"type": "object",
                        "properties": {"handles": {"type": "array", "items": {"type": "string"}, "minItems": 1,
                                                   "maxItems": MAX_RESOLVE, "description": "Handles such as A4."},
                                       "note": {"type": "string", "description": "One line, optional."}},
                        "required": ["handles"], "additionalProperties": False},
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True,
                        "openWorldHint": False},
        "_meta": {"anthropic/alwaysLoad": True},
    },
    {
        "name": "open_asks",
        "title": "Open asks",
        "description": (
            "This session's open asks in ledgr and the ones the user dismissed in the last 7 days, with "
            "handles (A7). Check it before declaring so you do not raise one again (pass repeat_of when you "
            "must), and refer to an ask by its handle."),
        "inputSchema": {"type": "object", "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "parked_questions",
        "title": "Parked questions released to you",
        "description": (
            "The questions the user parked in ledgr for this session and released to you, with handles "
            "(Q3). Only released questions are listed; answer them in your reply and name the handle."),
        "inputSchema": {"type": "object", "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
]


def log(line):
    C.log(line, name=LOG)


# ---------- identity ----------

def profile_of(config_dir):
    """The hooks' rule (adapters/claude/claude_hook.py): ~/.claude is "default", ~/.claude-work "work"."""
    base = os.path.basename(config_dir.rstrip("/"))
    if base == ".claude":
        return "default"
    return base[len(".claude-"):] if base.startswith(".claude-") else base


def process_table():
    """{pid: (ppid, comm)} from one ps call; comm is the program's base name."""
    try:
        r = subprocess.run(["/bin/ps", "-A", "-o", "pid=,ppid=,comm="], capture_output=True, timeout=3,
                           stdin=subprocess.DEVNULL)
    except Exception as ex:
        log(f"ps failed: {ex!r}")
        return {}
    out = {}
    for line in r.stdout.decode("utf-8", "replace").splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            out[int(parts[0])] = (int(parts[1]), os.path.basename(parts[2].strip()))
    return out


def ancestors(limit=12):
    """[(pid, comm)] from our parent up, at most `limit`, stopping at pid 1."""
    table, out, p = process_table(), [], os.getppid()
    while p and p > 1 and len(out) < limit:
        ppid, comm = table.get(p, (0, None))
        out.append((p, comm))
        if not ppid or ppid == p:
            break
        p = ppid
    return out


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


class Identity:
    def __init__(self, environ):
        self.terminal = environ.get("HC_TERMINAL_ID") or environ.get("LEDGR_TERMINAL") or ""
        self.inner = bool(environ.get("LEDGR_INNER"))
        cd = environ.get("CLAUDE_CONFIG_DIR")
        self.config_dir_env = bool(cd)
        cd = os.path.abspath(os.path.expanduser(cd)).rstrip("/") if cd else os.path.join(C.HOME, ".claude")
        self.config_dir, self.profile = cd, profile_of(cd)
        self.ancestors = ancestors()
        self.owner = next(((p, c) for p, c in self.ancestors if c not in SHELLS), (None, None))

    @property
    def enabled(self):
        return bool(self.terminal) and not self.inner

    def verdict(self, m):
        """mine | other | stale | elsewhere, for a map entry naming a session."""
        rec_pid, rec_comm = m.get("owner_pid"), m.get("owner_comm")
        if isinstance(rec_pid, int) and not isinstance(rec_pid, bool) and rec_pid > 1 and self.ancestors:
            if not alive(rec_pid):
                return "stale"              # the agent the hooks saw has exited; ours was not mapped
            now_comm = M._comm(rec_pid) if rec_comm else None
            if rec_comm and now_comm and now_comm != rec_comm:
                return "stale"              # its pid now belongs to another program
            for pid, comm in self.ancestors:
                if pid == rec_pid:
                    return "mine"
                if rec_comm and comm == rec_comm:
                    return "other"          # a nearer copy of the same program: we serve a child agent
            return "other"
        if self.config_dir_env and m.get("config_dir") and m.get("config_dir") != self.config_dir:
            return "elsewhere"
        return "mine"

    def resolve(self):
        """The session to write to, read from terminals/<t>.json now."""
        t = self.terminal
        m = C.read_json(C.path("terminals", C.tfile(t) + ".json"))
        note = None
        if isinstance(m, dict) and isinstance(m.get("session_id"), str) and M.SID_OK.match(m["session_id"]):
            v = self.verdict(m)
            sid = m["session_id"]
            if v == "mine":
                turn = m.get("turn") if isinstance(m.get("turn"), int) else 0
                return {"session_id": sid, "terminal": t, "turn": turn, "prompt_id": m.get("prompt_id"),
                        "synthetic": False, "agent": m.get("agent"), "note": None, "state": m.get("state"),
                        "space": m.get("space")}
            if v == "other":
                return {"error": (f"terminal {t} belongs to another agent process (pid {m.get('owner_pid')}, "
                                  f"session {sid}); this server runs under pid {self.owner[0]}. Nothing was "
                                  "recorded: only the terminal's main agent declares asks.")}
            if v == "stale":
                note = (f"terminal {t} was last mapped to session {sid}, whose agent process "
                        f"(pid {m.get('owner_pid')}) is gone, and no ledgr hook has mapped this session yet")
            else:
                note = (f"terminal {t} is mapped to a session of another config folder "
                        f"({m.get('config_dir')}), not {self.config_dir}")
        else:
            note = f"no ledgr hook has mapped terminal {t} to a session yet"
        sid = f"herdr:{t}"
        store = C.read_json(C.path("store.json"), {})
        s = (store.get("sessions") or {}).get(sid) if isinstance(store, dict) and isinstance(store.get("sessions"), dict) else None
        turn = s.get("turn") if isinstance(s, dict) and isinstance(s.get("turn"), int) else 0
        return {"session_id": sid, "terminal": t, "turn": turn, "prompt_id": None, "synthetic": True,
                "in_store": isinstance(s, dict), "note": note, "state": None,
                "space": m.get("space") if isinstance(m, dict) else None}


# ---------- snapshot ----------

def session_items(sid):
    """(items, cold): this session's items in snapshot.json, or in its cold file when the writer moved the
    session out of store.json (ledgr_extract.session_items: the one reader of both)."""
    return X.session_items(sid)


def snapshot_items():
    """Every item snapshot.json carries (warm sessions only)."""
    return X.session_items(None)[0]


def cold_broken(cold):
    """A cold session whose file the writer cannot read (its fault) or this server could not."""
    return bool(cold and (cold.get("fault") or cold.get("error")))


def cold_words(cold, sent="what you sent is kept"):
    """The first of the two lines a result adds for a cold session whose file cannot be read (open_asks:
    its one line, with what it could not list)."""
    return f"ledgr cannot read this session's earlier items ({cold_why(cold)}); {sent} and applied once that is fixed (the user's panel offers Try again)."


def cold_why(cold):
    """"cold/<file>: <why>", or the why alone when it names the file already (the writer's words do)."""
    where = f"cold/{cold['file']}" if cold and cold.get("file") else "its file in ledgr-data/cold/"
    why = (cold or {}).get("fault") or (cold or {}).get("error") or "the ledgr writer could not read it"
    return why if where in why else f"{where}: {why}"


def held_ids(kind, ev_ids):
    """The ids among ev_ids that the writer holds (retention Phase 2): it copies a spool file whose session's
    cold file it cannot read, under the file's own name, to ledgr-data/cold/held/<session>/, and only then
    takes it out of the spool. Matched by event id, among this process's `kind` files."""
    root, mine, found = C.path("cold", "held"), f"-{kind}-{os.getpid()}-", set()
    want = set(x for x in ev_ids or [] if x)
    if not want:
        return found
    try:
        dirs = os.listdir(root)
    except OSError:
        return found
    for d in dirs:
        try:
            names = os.listdir(os.path.join(root, d))
        except OSError:
            continue
        for n in names:
            if mine in n and n.endswith(".json") and not n.startswith("."):
                ev = C.read_json(os.path.join(root, d, n))
                if isinstance(ev, dict) and ev.get("id") in want:
                    found.add(ev["id"])
    return found


def writer_claim():
    """The writer's claim as Herdr last saved it (shared.json in Herdr's home, beside ledgr-data; key
    ledgr.writer): {id, by, at, fault?, pass?, done?, stall?}, else None. Herdr saves shared state as it
    changes, so it is as fresh as the writer's last beat (and, after the machine slept, hours old while
    the writer works: writer_state reads it only when an event waits). False when shared.json cannot be
    read (none, or caught mid-write)."""
    p = os.path.join(os.path.dirname(C.DATA.rstrip("/")), "shared.json")
    try:
        with open(p, encoding="utf-8") as f:
            s = json.load(f)
    except (OSError, ValueError):
        return False                       # none, or caught mid-write by Herdr: not known
    if not isinstance(s, dict):
        return False
    w = s.get("ledgr.writer")
    return w if isinstance(w, dict) and w.get("id") else None


def span_words(s):
    """"20 s", "4 min", "3 h 12 min" (the mod's spool.js spanWords)."""
    s = max(0.0, float(s or 0))
    if s < 120:
        return f"{int(round(s))} s"
    m = int(round(s / 60))
    return f"{m} min" if m < 120 else f"{m // 60} h" + (f" {m % 60} min" if m % 60 else "")


session_of = X.session_of


def level_of(it):
    """store.js levelOf: a recorded level, else blocking for a legacy `blocking: true`, else needed."""
    lv = it.get("level")
    return lv if lv in A.LEVELS else ("blocking" if it.get("blocking") is True else "needed")


def handle_num(h):
    try:
        return int(str(h)[1:])
    except ValueError:
        return 0


def norm_handle(h):
    """store.js byHandle: brackets and spaces dropped, upper case ("[a4]" is A4)."""
    return re.sub(r"[\[\]\s]", "", h).upper() if isinstance(h, str) else ""


def threshold_of(cfg):
    v = str(((cfg or {}).get("extract") or {}).get("threshold") or "").strip().lower()
    return v if v in A.LEVELS else "needed"


def handoff_of(cfg):
    fn = getattr(K, "handoff", None)            # asks.handoff (ledgr | both | prose), when this build has it
    try:
        return fn(cfg) if callable(fn) else "ledgr"
    except Exception:
        return "ledgr"


def pointer_line(n, b):
    """The one closing line, the same wording as lib/asks-instruction-ledgr.txt."""
    if n <= 0:
        return None
    return f"ledgr: {n} item{'' if n == 1 else 's'} for you" + (f", {b} blocking" if b else "")


def items_words(ns, verb=True):
    """"item 2 has", "items 1 and 3 have", "items 1, 2 and 4 have" (verb=False: without has or have)."""
    if len(ns) == 1:
        return f"item {ns[0]}" + (" has" if verb else "")
    return "items " + ", ".join(str(n) for n in ns[:-1]) + f" and {ns[-1]}" + (" have" if verb else "")


def safe(name):
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)


def text_result(text, data, error=False):
    return {"content": [{"type": "text", "text": text}], "structuredContent": data, "isError": bool(error)}


# ---------- the server ----------

class Server:
    def __init__(self, out, environ=None):
        self.out = out
        self.env = os.environ if environ is None else environ
        self.who = Identity(self.env)
        self.client = {}
        self.subscriptions = set()                 # open subscriptions/listen request ids
        try:
            self.wait_ms = max(0, int(self.env.get("LEDGR_MCP_WAIT_MS") or 2500))
        except ValueError:
            self.wait_ms = 2500
        self.handlers = {"ping": self.m_ping, "server/discover": self.m_discover, "tools/list": self.m_tools_list,
                         "tools/call": self.m_tools_call}
        self.tools = {"declare_asks": self.t_declare, "resolve_asks": self.t_resolve, "open_asks": self.t_open,
                      "parked_questions": self.t_parked}
        log(f"start pid={os.getpid()} terminal={self.who.terminal or '-'} inner={self.who.inner} "
            f"config_dir={self.who.config_dir} profile={self.who.profile} owner={self.who.owner} "
            f"data={C.DATA} python={sys.version.split()[0]} tools={'on' if self.who.enabled else 'off'}")

    # ----- framing -----

    def send(self, msg):
        self.out.write(json.dumps(msg, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
        self.out.flush()

    def handle_line(self, raw):
        raw = raw.strip()
        if not raw:
            return
        try:
            msg = json.loads(raw.decode("utf-8"))
        except Exception:
            self.send(err(None, -32700, "Parse error"))
            return
        if isinstance(msg, list):                  # a batch (2025-03-26 allowed them)
            if not msg:
                self.send(err(None, -32600, "Invalid Request: empty batch"))
                return
            out = [r for r in (self.dispatch(m) for m in msg) if r is not None]
            if out:
                self.send(out)
            return
        r = self.dispatch(msg)
        if r is not None:
            self.send(r)

    def dispatch(self, msg):
        if not isinstance(msg, dict):
            return err(None, -32600, "Invalid Request")
        has_id, rid = "id" in msg, msg.get("id")
        id_ok = isinstance(rid, (str, int, float)) and not isinstance(rid, bool)
        if "method" not in msg:
            if "result" in msg or "error" in msg:
                return None                        # a response: this server sends no requests
            return err(rid if id_ok else None, -32600, "Invalid Request")
        method = msg.get("method")
        if msg.get("jsonrpc") != "2.0" or not isinstance(method, str):
            return err(rid if id_ok else None, -32600, "Invalid Request") if has_id else None
        params = msg.get("params")
        params = {} if params is None else params
        if not has_id:
            self.notification(method, params)
            return None
        if not id_ok:
            return err(None, -32600, "Invalid Request: id must be a string or an integer")
        if not isinstance(params, dict):
            return err(rid, -32602, "Invalid params: params must be an object")
        try:
            return self.request(rid, method, params)
        except Exception as ex:
            log(f"{method} failed: {ex!r}\n{traceback.format_exc()}")
            return err(rid, -32603, "Internal error")

    def notification(self, method, params):
        if method == "notifications/cancelled" and isinstance(params, dict):
            self.subscriptions.discard(params.get("requestId"))   # nothing more is sent for it
            log(f"{method} {params.get('requestId')!r}")
        elif method == "notifications/initialized":
            log(method)
        else:
            log(f"notification ignored: {method}")

    def request(self, rid, method, params):
        log(f"request {method}")
        if method == "initialize":
            return ok(rid, self.m_initialize(params))
        meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
        pv = meta.get(PV)
        modern = False
        if pv is not None:
            if pv not in MODERN + LEGACY:
                return err(rid, -32022, "Unsupported protocol version",
                           {"supported": list(MODERN + LEGACY), "requested": pv})
            modern = pv in MODERN
            if modern and not isinstance(meta.get(CAPS), dict):
                return err(rid, -32602, f"Invalid params: _meta is missing {CAPS}")
            if isinstance(meta.get(CLIENT), dict):
                self.client = meta[CLIENT]
        elif method == "server/discover":
            modern = True                          # a probe without a version still learns what we speak
        if method == "subscriptions/listen" and modern:
            return self.listen(rid, params)
        fn = self.handlers.get(method)
        if fn is None:
            return err(rid, -32601, f"Method not found: {method}")
        res = fn(params, modern)
        if isinstance(res, Err):
            return err(rid, res.code, res.message, res.data)
        if modern:
            res = dict({"resultType": "complete"}, **res)
            res["_meta"] = dict(res.get("_meta") or {}, **{SERVER: SERVER_INFO})
        return ok(rid, res)

    # ----- methods -----

    def listen(self, rid, params):
        """2026-07-28 subscriptions/listen: acknowledge the subset we honour (toolsListChanged, which
        never fires: the tool list is fixed for the life of the process) and keep the request open.
        Returns None: the request gets no response until the client cancels it."""
        want = params.get("notifications") if isinstance(params.get("notifications"), dict) else {}
        agreed = {"toolsListChanged": True} if want.get("toolsListChanged") is True else {}
        self.subscriptions.add(rid)
        self.send({"jsonrpc": "2.0", "method": "notifications/subscriptions/acknowledged",
                   "params": {"_meta": {"io.modelcontextprotocol/subscriptionId": rid}, "notifications": agreed}})
        return None

    def capabilities(self, modern):
        return {"tools": {}} if modern else {"tools": {"listChanged": False}}

    def m_initialize(self, params):
        req = params.get("protocolVersion")
        if isinstance(params.get("clientInfo"), dict):
            self.client = params["clientInfo"]
        v = req if req in LEGACY else LEGACY[0]
        log(f"initialize requested={req!r} answered={v} client={self.client.get('name')}")
        res = {"protocolVersion": v, "capabilities": self.capabilities(False), "serverInfo": SERVER_INFO}
        if self.who.enabled:
            res["instructions"] = INSTRUCTIONS
        return res

    def m_ping(self, params, modern):
        return {}

    def m_discover(self, params, modern):
        res = {"supportedVersions": list(MODERN + LEGACY), "capabilities": self.capabilities(True),
               "ttlMs": 3600000, "cacheScope": "private"}
        if self.who.enabled:
            res["instructions"] = INSTRUCTIONS
        return res

    def m_tools_list(self, params, modern):
        res = {"tools": json.loads(json.dumps(TOOLS)) if self.who.enabled else []}
        if modern:
            res.update(ttlMs=3600000, cacheScope="private")
        return res

    def m_tools_call(self, params, modern):
        name, args = params.get("name"), params.get("arguments")
        if not self.who.enabled or name not in self.tools:
            return Err(-32602, f"Unknown tool: {name}")
        args = {} if args is None else args
        if not isinstance(args, dict):
            return Err(-32602, "Invalid params: arguments must be an object")
        t0 = time.monotonic()
        try:
            ctx = self.who.resolve()
            off = None if ctx.get("error") else self.off_state(ctx)
            res = self.off_result(name, ctx, off) if off else self.tools[name](args, ctx)
        except Exception as ex:
            log(f"tool {name} failed: {ex!r}\n{traceback.format_exc()}")
            res = text_result(f"ledgr: internal error in {name} ({ex.__class__.__name__}); see ledgr-data/log/{LOG}.",
                              {"ok": False, "error": repr(ex)[:300]}, error=True)
        log(f"tool {name} {int((time.monotonic() - t0) * 1000)} ms error={res.get('isError')}")
        return res

    # ----- disabled spaces -----

    def off_state(self, ctx):
        """None when ledgr is on for the resolved session, else {space, by}: the session record's
        `ledgr_off: true` (the hooks' state, kept from the prompt that found the space disabled until
        the prompt that finds it on), or the session's space in config spaces.disabled. The space is
        the record's (refreshed at every prompt), else the map entry's; a synthetic session with none
        gets one live lookup (ledgr_map.herdr_space: `hc get`, 0.3 s at most), as the panel does."""
        rec = {} if ctx.get("synthetic") else C.read_json(C.path("sessions", ctx["session_id"] + ".json"), {})
        rec = rec if isinstance(rec, dict) else {}
        space = rec.get("space") if "space" in rec else ctx.get("space")
        if not space and ctx.get("synthetic") and self.env.get("HC_TERMINAL_ID"):
            sp = M.herdr_space()
            space = sp if isinstance(sp, str) else None
        if rec.get("ledgr_off") is True:
            return {"space": space, "by": "ledgr_off"}
        if space and M.space_off(K.load(create=False), space):
            return {"space": space, "by": "spaces.disabled"}
        return None

    def off_result(self, name, ctx, off):
        """Every tool's answer in a session where ledgr is off: ok, `off: true`, its usual fields
        empty, nothing written (no spool event, no mcp/<session>/<turn>.json). One log line."""
        note, words = OFF_WORDS[name]
        data = {"ok": True, "off": True, "session_id": ctx["session_id"], "synthetic": ctx["synthetic"],
                "space": off["space"]}
        if name == "declare_asks":
            data.update(terminal=ctx["terminal"], turn=ctx["turn"], replaces_turn=False, call=0, event_id=None,
                        items=[], handles=[], repeats=[], rejected=[], notes=[], pointer=None, handoff=None,
                        writer=None)
        elif name == "resolve_asks":
            data.update(turn=ctx["turn"], resolved=[], unknown=[], already_closed=[], event_ids=[], writer=None)
        elif name == "open_asks":
            data.update(turn=ctx["turn"], open=[], dismissed=[])
        else:
            data.update(questions=[], flag="releasedToAgent")
        data["note"] = note
        log(f"off {name} {ctx['session_id']} turn={ctx['turn']} space={off['space']} by={off['by']}: nothing written")
        return text_result(words, data)

    # ----- tools -----

    def t_declare(self, args, ctx=None):
        t0 = time.monotonic()
        items = args.get("items")
        if isinstance(items, str):                 # a client that sends the array as JSON text
            try:
                items = A.container(json.loads(items))
            except Exception:
                pass
        if not isinstance(items, list):
            return text_result("ledgr: items must be an array of {level, kind, text, summary, quote?, options?}. "
                               "Nothing recorded.", {"ok": False, "error": "items must be an array"}, error=True)
        ctx = ctx or self.who.resolve()
        if ctx.get("error"):
            return text_result("ledgr: " + ctx["error"], {"ok": False, "error": ctx["error"]}, error=True)
        sid, turn, t = ctx["session_id"], ctx["turn"], ctx["terminal"]
        # 2026-11-23: every item carries a summary, or the call is refused whole (unlike an unknown level, which
        # drops that item alone): nothing written, nothing spooled. Not an object, or past the limit: rejected
        # below as before, so not named here.
        missing = [i + 1 for i, it in enumerate(items[:A.MAX_ASKS]) if isinstance(it, dict) and A.summary_of(it) is None]
        if missing:
            # Review 7.6: a summary that is not a string is said as such (null counts as none), and a refused
            # later call of the turn says the earlier call's items stand, as "recorded nothing" says below.
            not_str = [n for n in missing if items[n - 1].get("summary") is not None
                       and not isinstance(items[n - 1].get("summary"), str)]
            none_ = [n for n in missing if n not in not_str]
            why = ([f"{items_words(none_)} no summary"] if none_ else []) + (
                [f"item {not_str[0]}'s summary is not a string"] if len(not_str) == 1 else
                [f"the summaries of {items_words(not_str, verb=False)} are not strings"] if not_str else [])
            prev = C.read_json(C.path("mcp", safe(sid), f"{turn}.json"))
            stand = isinstance(prev, dict) and prev.get("turn") == turn and prev.get("session_id") == sid \
                and bool(prev.get("asks"))
            log(f"declare {sid} turn={turn}: refused, no summary on item(s) {missing} (not a string: {not_str}); "
                f"nothing written{'; the earlier call of the turn stands' if stand else ''}")
            return text_result("ledgr recorded nothing" + (" (earlier items of this turn stand)" if stand else "")
                               + f": {', and '.join(why)}. Every item needs one, as text. {SUMMARY_WORDS} "
                               "Call declare_asks again with a summary on every item.",
                               {"ok": False, "error": "every item needs a summary", "missing_summary": missing,
                                "summary_not_string": not_str, "earlier_items_stand": stand},
                               error=True)
        mine, cold = session_items(sid)
        _, _, known = X.recorded_asks(sid, items=mine)
        by_handle = {it.get("handle"): it for it in mine if it.get("direction") == "agent_to_human"}
        # Asks created in this turn come from an earlier declare_asks of the same turn: not repeats.
        known = {h: v for h, v in known.items() if (by_handle.get(h) or {}).get("createdTurn") != turn}
        by_text = {}
        for h in sorted(known, key=handle_num):
            k = A.norm_key((by_handle.get(h) or {}).get("text") or "")
            if k and (k not in by_text or known[by_text[k]]["status"] == "dismissed"):
                by_text[k] = h                      # an open ask wins over a dismissed one
        prose = "\n".join(it["quote"] for it in items if isinstance(it, dict) and isinstance(it.get("quote"), str))
        accepted, rejected, notes, seen = [], [], [], {}
        for i, it in enumerate(items):
            n = i + 1
            if i >= A.MAX_ASKS:
                rejected.append({"item": n, "reason": f"over the limit of {A.MAX_ASKS} items per turn"})
                continue
            if not isinstance(it, dict):
                rejected.append({"item": n, "reason": "not an object"})
                continue
            if not isinstance(it.get("text"), str) or not it["text"].strip():
                rejected.append({"item": n, "reason": "text is required (one line: what the user must do or decide)"})
                continue
            rej = []
            v = A.validate([it], prose, "tool", known, rejected=rej)
            if not v:
                why = re.sub(r"^ask \d+: ", "", rej[0]) if rej else "invalid"
                if "level" in why:
                    why += " (use blocking or needed)"
                rejected.append({"item": n, "reason": why})
                continue
            a = v[0]
            k = A.norm_key(a["text"])
            if k in seen:
                rejected.append({"item": n, "reason": f"same text as item {seen[k]}"})
                continue
            seen[k] = n
            if "\n" in it["text"].strip() or len(C.squash(it["text"])) > A.MAX_TEXT:
                notes.append(f"item {n}: text joined into one line" + (f" and cut at {A.MAX_TEXT} characters"
                                                                     if len(C.squash(it["text"])) > A.MAX_TEXT else ""))
            if len(A.summary_text(it["summary"])) > A.MAX_SUMMARY:
                notes.append(f"item {n}: summary cut at {A.MAX_SUMMARY:,} characters")
            if it.get("kind") is not None and it.get("kind") not in A.KINDS:
                notes.append(f"item {n}: unknown kind {it.get('kind')!r}, recorded as do")
            if isinstance(it.get("recommended"), str) and it["recommended"].strip() and a["recommended"] is None:
                notes.append(f"item {n}: recommended is not one of its options, dropped")
            if isinstance(it.get("repeat_of"), str) and it["repeat_of"].strip() and not a["repeat_of_handle"]:
                notes.append(f"item {n}: repeat_of {it['repeat_of'].strip()!r} is not an open or recently dismissed "
                             "ask of this session, ignored")
            match = "handle" if a["repeat_of_handle"] else None
            if not match and k in by_text:
                h = by_text[k]
                a["repeat_of"], a["repeat_of_handle"], match = known[h].get("id") or h, h, "text"
            if a["repeat_of_handle"]:
                a["repeat_status"] = known[a["repeat_of_handle"]].get("status") or "open"
                a["repeat_match"] = match
            a["quote_verified"] = False if a["quote"] else None
            accepted.append((n, a))

        cfg = K.load(create=False)
        threshold, mode = threshold_of(cfg), handoff_of(cfg)
        counted = [a for _, a in accepted if A.LEVELS.index(a["level"]) >= A.LEVELS.index(threshold)]
        counted_ids = {id(a) for a in counted}
        blocking = sum(1 for a in counted if a["level"] == "blocking")
        pointer = pointer_line(len(counted), blocking)
        asks = [a for _, a in accepted]
        state_path = C.path("mcp", safe(sid), f"{turn}.json")
        ev_id, replaces, calls, prev_n = None, False, 0, 0
        with C.Lock("mcp-" + sid):
            prev = C.read_json(state_path)
            replaces = isinstance(prev, dict) and prev.get("turn") == turn and prev.get("session_id") == sid
            prev_n = len(prev.get("asks") or []) if replaces else 0
            calls = (int(prev.get("calls") or 0) if replaces else 0) + 1
            if asks or (replaces and not items):
                res = {"source": "tool", "asks": asks, "model": None, "provider": "mcp", "usage": None,
                       "ms": int((time.monotonic() - t0) * 1000), "error": None, "block_error": None,
                       "extract_request_id": None, "replaces_turn": replaces, "tool_call": calls,
                       "quotes": "unverified", "synthetic": ctx["synthetic"],
                       "client": {k: self.client.get(k) for k in ("name", "version") if isinstance(self.client.get(k), str)} or None}
                if rejected:
                    res["rejected"] = [f"ask {r['item']}: {r['reason']}" for r in rejected][:10]
                if ctx["synthetic"] and not ctx.get("in_store"):
                    res["agent"] = self.client.get("name") if isinstance(self.client.get("name"), str) else "other"
                ev_id = S.asks(t, sid, turn=turn, prompt_id=ctx.get("prompt_id"), message_uuid=None,
                               api_message_id=None, passage_hash=None, result=res)
                C.write_json(state_path, {
                    "v": 1, "session_id": sid, "terminal": t, "turn": turn, "calls": calls,
                    "event_ids": ((prev.get("event_ids") or []) if replaces else []) + [ev_id],
                    "synthetic": ctx["synthetic"], "updated_at": C.now_ms(), "pointer": pointer,
                    "asks": [dict(a) for a in asks],     # the event's asks, whole: the Stop hook re-emits them
                    "handles": None})
                self.prune(os.path.dirname(state_path))
            else:
                calls -= 1                         # nothing written: the turn's call count stands
        handles, applied, wstat = [None] * len(asks), None, None
        if ev_id and asks:
            handles, applied, wstat = self.wait_handles(sid, turn, asks, [ev_id])
            if any(handles):
                st = C.read_json(state_path)
                if isinstance(st, dict) and ev_id in (st.get("event_ids") or []):
                    st["handles"] = handles
                    C.write_json(state_path, st)
        log(f"declare {sid} turn={turn} call={calls} replaces={replaces} accepted={len(asks)} "
            f"rejected={len(rejected)} counted={len(counted)} blocking={blocking} handles={handles} "
            f"applied={applied} event={ev_id}")

        rows = []
        for (n, a), h in zip(accepted, handles):
            row = {"item": n, "handle": h, "level": a["level"], "kind": a["kind"], "text": a["text"],
                   "suggestion": id(a) not in counted_ids}
            if a.get("repeat_of_handle"):
                row.update(repeat_of=a["repeat_of_handle"], repeat_status=a["repeat_status"], repeat_match=a["repeat_match"])
            rows.append(row)
        data = {"ok": bool(asks) or not rejected, "session_id": sid, "terminal": t, "turn": turn,
                "synthetic": ctx["synthetic"], "replaces_turn": replaces, "call": calls, "event_id": ev_id,
                "items": rows, "handles": handles,
                "repeats": [{"item": r["item"], "of": r["repeat_of"], "status": r["repeat_status"], "match": r["repeat_match"]}
                            for r in rows if r.get("repeat_of")],
                "rejected": rejected, "notes": notes, "pointer": pointer, "handoff": mode,
                "writer": applied}
        if wstat:
            data["writer_status"] = wstat
        if ctx.get("note"):
            data["note"] = ctx["note"]
        stalled = applied == "stalled"
        # Retention Phase 2: a cold session whose file cannot be read. The event is kept (held by the writer,
        # or still in the spool) and applied once the session is read again, reset or forgotten: ok, no retry.
        cold, kept, applied = self.cold_now(sid, cold, applied, bool(ev_id and asks))
        if kept:
            data.update(cold=cold, writer=applied)
            log(f"declare {sid} turn={turn}: cold {cold.get('file')} cannot be read "
                f"({cold.get('fault') or cold.get('error') or 'held by the writer'}); event {ev_id} kept ({applied})")

        lines = []
        if items and not asks:
            lines.append("ledgr recorded nothing" + (" (earlier items of this turn stand)." if replaces else "."))
        elif not asks:
            lines.append("ledgr: cleared the items declared earlier in this turn." if replaces
                         else "ledgr: nothing declared. When nothing needs the user, end your reply without a pointer line.")
        else:
            lines.append(f"ledgr recorded {len(asks)} item{'' if len(asks) == 1 else 's'} for the user (turn {turn})"
                         + (f", replacing the {prev_n} declared earlier in this turn." if replaces else "."))
            for r in rows:
                tail = ""
                if r.get("repeat_of"):
                    st = r["repeat_status"]
                    tail = (f" [raises dismissed {r['repeat_of']} again]" if st == "dismissed" else
                            f" [re-opens answered {r['repeat_of']}]" if st == "answered" else
                            f" [same as {st} {r['repeat_of']}: updated, not duplicated]")
                if r["suggestion"]:
                    tail += f" [below the {threshold} threshold: kept as a suggestion, not counted]"
                lines.append(f"- {r['handle'] or '(handle pending)'} {r['level']}/{r['kind']}: {r['text']}{tail}")
        if rejected:
            lines.append("Not recorded:")
            lines += [f"- item {r['item']}: {r['reason']}" for r in rejected]
            lines.append("To fix one, call declare_asks again with the full list; it replaces this turn's items.")
        lines += [f"Note: {x}." for x in notes]
        if ctx.get("note"):
            lines.append(f"Note: {ctx['note']}, so these went to the terminal's synthetic session {sid} "
                         "(no turn text there, so quotes cannot be checked).")
        if stalled:
            # 2026-11-19: the writer held its claim and applied nothing for hours, and this result still said
            # the items would appear in the panel. Not an error (a retry changes nothing): the event waits in
            # the spool and is applied once a writer runs; the agent tells the user and lists the items.
            lines.append(f"ledgr's writer is not applying events ({wstat['why']}). These items are queued, not shown "
                         "to the user: the panel does not have them.")
            lines.append("Tell the user in your reply that ledgr's writer is not applying events (relaunching Herdr "
                         "restarts it; nothing queued is lost), and list these items in your reply this time.")
        if kept:
            lines.append(cold_words(cold))
            lines.append("Tell the user in your reply, and list these items there.")
        if not stalled and not kept and asks and not any(handles):
            lines.append(f"Handles are pending: ledgr's writer is behind (the oldest queued event is {span_words(wstat['oldest_s'])} "
                         "old); they appear in the panel once it applies them." if applied == "idle" and wstat and wstat.get("oldest_s") else
                         "Handles are pending: ledgr's writer has not applied the event yet; they appear in the panel.")
        if any(a["quote"] for a in asks):
            lines.append("Quotes are checked against your reply when the turn ends, so keep them verbatim.")
        if pointer:
            lines.append("Then end your reply with this line:" if stalled or kept else
                         "List them in your reply as usual and end it with this line:" if mode == "both" else
                         "End your reply with this line; do not list these items in prose or in a ledgr-asks block:")
            lines.append(pointer)
        elif asks:
            lines.append("Nothing here counts as needing the user, so end your reply without a pointer line.")
        return text_result("\n".join(lines), data, error=bool(items) and not asks)

    def wait_handles(self, sid, turn, asks, ev_ids=None):
        """(handles, how, status) once the writer has ingested our spool file(s); how is applied, held (the
        writer keeps the event aside until the session's cold file can be read: no handles to wait for),
        timeout, idle (the writer is behind: not waited for) or stalled (not applying: not waited for);
        status is writer_state's, None when applied or held."""
        spool, mine = C.path("spool"), f"-asks-{os.getpid()}-"
        ws = self.writer_state(spool, mine)
        if ws["state"] != "ok":
            return [None] * len(asks), ("stalled" if ws["state"] == "stalled" else "idle"), ws
        deadline = time.monotonic() + self.wait_ms / 1000.0
        while True:
            try:
                pending = any(mine in n for n in os.listdir(spool) if not n.startswith("."))
            except OSError:
                pending = False
            if not pending:
                hs = self.match_handles(sid, turn, asks)
                # Held is known, not inferred: the writer confirms its copy in cold/held/ before the spool file
                # goes, and only a replay that applied it removes the copy. A repeat's handle is still known.
                if held_ids("asks", ev_ids):
                    return hs, "held", None
                if all(hs) or time.monotonic() >= deadline:
                    return hs, "applied", None
            elif time.monotonic() >= deadline:
                ws = self.writer_state(spool, mine, with_mine=True)
                return [None] * len(asks), ("stalled" if ws["state"] == "stalled" else "timeout"), ws
            time.sleep(0.05)

    def wait_applied(self, kind, ev_ids=None):
        """(how, status) once the writer has ingested this process's `kind` spool files: applied, held (kept
        aside by the writer: the session's cold file cannot be read), timeout after LEDGR_MCP_WAIT_MS, or
        without waiting idle (behind) or stalled (writer_state)."""
        spool, mine = C.path("spool"), f"-{kind}-{os.getpid()}-"
        ws = self.writer_state(spool, mine)
        if ws["state"] != "ok":
            return ("stalled" if ws["state"] == "stalled" else "idle"), ws
        deadline = time.monotonic() + self.wait_ms / 1000.0
        while True:
            try:
                pending = any(mine in n for n in os.listdir(spool) if not n.startswith("."))
            except OSError:
                pending = False
            if not pending:
                return ("held" if held_ids(kind, ev_ids) else "applied"), None
            if time.monotonic() >= deadline:
                ws = self.writer_state(spool, mine, with_mine=True)
                return ("stalled" if ws["state"] == "stalled" else "timeout"), ws
            time.sleep(0.05)

    def writer_state(self, spool, mine=None, with_mine=False):
        """What the spool, store.json and the writer's saved claim say about the writer (2026-11-19: it held
        a fresh claim and applied nothing for hours, while this server answered as usual). Read-only, one
        listing and two small reads. {state, queued, oldest_s, store_s, [why], [claim]}. An event *waits*
        when it is older than WRITER_STALE_S and store.json has not been written since it arrived; only then
        does the claim count, because a claim is as old as the writer's last beat: after the machine slept it
        is hours old while the writer works (2026-11-19 review).
          ok       no event waits (none older than WRITER_STALE_S, or store.json written since the oldest
                   arrived: the writer moves, and that event is its own problem);
          behind   an event waits, and either the claim shows a writer at work (fresh, its pass or start in a
                   step for under WRITER_STALL_S: starting, or draining a backlog), or nothing says more yet;
          stalled  an event waits and no writer is at work: it has waited over WRITER_STALL_S, or Herdr's
                   shared.json holds no claim, or the claim was not renewed for CLAIM_STALE_S, or its pass has
                   waited WRITER_STALL_S in one step, or it says the writer is stuck with nothing running.
        `mine` (this process's spool name part) is left out of the waiting times unless with_mine (after a
        wait that timed out), never out of `queued`."""
        now = time.time()
        oldest, queued = None, 0
        try:
            for n in os.listdir(spool):
                if not n.endswith(".json") or n.startswith(".") or n.startswith("bad-"):
                    continue
                try:
                    m = os.path.getmtime(os.path.join(spool, n))
                except OSError:
                    continue
                queued += 1
                if with_mine or not (mine and mine in n):
                    oldest = m if oldest is None else min(oldest, m)
        except OSError:
            pass
        try:
            store_m = os.path.getmtime(C.path("store.json"))
        except OSError:
            store_m = None
        ws = {"state": "ok", "queued": queued, "oldest_s": None if oldest is None else round(now - oldest, 1),
              "store_s": None if store_m is None else round(now - store_m, 1)}
        waited = 0.0 if oldest is None else now - oldest
        moved = oldest is not None and store_m is not None and store_m >= oldest
        w = writer_claim()
        ps, st, at = {}, {}, 0.0
        if w:
            at = (w.get("at") or 0) / 1000.0
            ps = w.get("pass") if isinstance(w.get("pass"), dict) else {}
            st = w.get("stall") if isinstance(w.get("stall"), dict) else {}
            ws["claim"] = {k: v for k, v in (("by", w.get("by")), ("age_s", round(now - at, 1)), ("step", ps.get("step")),
                                             ("step_s", round(now - ps["since"] / 1000.0, 1) if ps.get("since") else None),
                                             ("fault", w.get("fault"))) if v is not None}
        if waited <= WRITER_STALE_S or moved:
            return ws
        step_s = now - ps["since"] / 1000.0 if ps.get("since") else None
        at_work = bool(w) and now - at <= CLAIM_STALE_S and step_s is not None and step_s <= WRITER_STALL_S
        why = None
        if at_work:
            pass
        elif waited > WRITER_STALL_S:
            why = (f"{queued} event{'' if queued == 1 else 's'} queued, the oldest for {span_words(waited)}, and store.json "
                   + ("not written since" if store_m is None else f"last written {span_words(now - store_m)} ago"))
        elif w is None:
            why = "no writer holds the role (show the ledgr panel, or relaunch Herdr)"
        elif w and now - at > CLAIM_STALE_S:
            why = f"its writer ({w.get('by')}) has not renewed its claim for {span_words(now - at)}"
        elif w and step_s is not None and step_s > WRITER_STALL_S:
            why = f"its writer ({w.get('by')}) has waited {span_words(step_s)} in {ps.get('step')}"
        elif w and not ps and st and st.get("ok") is False and st.get("kind") != "spool":
            why = f"its writer ({w.get('by')}) is stuck in {st.get('step')}" + (" and waits before it tries again" if st.get("retryAt") else "")
        if why:
            ws.update(state="stalled", why=why)
        else:
            ws["state"] = "behind"
        return ws

    def cold_now(self, sid, cold, how, sent):
        """(cold, kept, how): kept when a result must say the session's cold file cannot be read: something
        was sent, the writer did not apply it, and either it holds it (how "held": its copy found in
        cold/held/, wait_handles and wait_applied) or the event still waits in the spool while the file could
        not be read when the call began (the writer's fault, or this server's read: the writer will hold it).
        An event gone from the spool and not in cold/held/ was applied, whatever snapshot.json still says: a
        snapshot.json the writer could not write after a thaw may still name the session cold (integration,
        2026-11-19: it is not taken as held, which would claim more than this server knows). For "held" the
        session is read again, so the writer's fault names why."""
        if not sent or not cold and how != "held":
            return cold, False, how
        if how == "held":
            _, now = session_items(sid)
            return now or cold or {"file": None, "fault": None, "error": None}, True, "held"
        if how == "applied":
            return cold, False, how
        return cold, cold_broken(cold), how

    def match_handles(self, sid, turn, asks):
        items = [it for it in session_items(sid)[0] if it.get("direction") == "agent_to_human"
                 and isinstance(it.get("handle"), str)]
        out = []
        for a in asks:
            k = A.norm_key(a["text"])
            c = [it for it in items if A.norm_key(it.get("text") or "") == k]
            c.sort(key=lambda it: ((it.get("anchor") or {}).get("turn") == turn, it.get("updatedAt") or 0))
            out.append(c[-1]["handle"] if c else None)
        return out

    def prune(self, d):
        try:
            files = [os.path.join(d, n) for n in os.listdir(d) if n.endswith(".json")]
        except OSError:
            return
        if len(files) > KEEP_TURNS:
            files.sort(key=os.path.getmtime, reverse=True)
            for p in files[KEEP_TURNS:]:
                try:
                    os.unlink(p)
                except OSError:
                    pass

    def t_resolve(self, args, ctx=None):
        hs, note = args.get("handles"), args.get("note")
        if isinstance(hs, str):                    # one handle, or the array as JSON text
            try:
                v = json.loads(hs)
            except Exception:
                v = hs
            hs = v if isinstance(v, list) else [v]
        if not isinstance(hs, list) or not all(isinstance(h, str) for h in hs):
            return text_result('ledgr: handles must be an array of handles such as ["A4"]. Nothing closed.',
                               {"ok": False, "error": "handles must be an array of strings"}, error=True)
        if note is not None and not isinstance(note, str):
            return text_result("ledgr: note must be one line of text. Nothing closed.",
                               {"ok": False, "error": "note must be a string"}, error=True)
        ctx = ctx or self.who.resolve()
        if ctx.get("error"):
            return text_result("ledgr: " + ctx["error"], {"ok": False, "error": ctx["error"]}, error=True)
        sid, t = ctx["session_id"], ctx["terminal"]
        turn = ctx["turn"] if not ctx["synthetic"] or ctx.get("in_store") else None
        note = (C.squash(note)[:200] or None) if note else None
        wanted, notes = [], []
        for raw in hs:
            h = norm_handle(raw)
            if h and h not in wanted:
                wanted.append(h)
        if len(wanted) > MAX_RESOLVE:
            notes.append(f"only the first {MAX_RESOLVE} handles were read")
            wanted = wanted[:MAX_RESOLVE]
        # The handle map open_asks uses: this session's agent asks in snapshot.json (a cold session's from its
        # file), by handle.
        items, cold = session_items(sid)
        mine = [it for it in items if it.get("direction") == "agent_to_human" and isinstance(it.get("id"), str)]
        unreadable = bool(cold and cold.get("error"))
        resolved, unknown, already, ev_ids, unchecked = [], [], [], [], []
        for h in wanted:
            found = [it for it in mine if it.get("handle") == h]
            live = [it for it in found if it.get("status") not in CLOSED]
            if not found and unreadable and re.match(r"^A\d+$", h):
                # Its cold file cannot be read here: the ask is looked up by handle when the writer applies
                # the event (store.js on_act), which it holds until the file reads, a reset or a Forget.
                ev_ids.append(S.act(t, sid, item=None, action="resolve", actor="agent", handle=h, turn=turn, note=note))
                resolved.append(h)
                unchecked.append(h)
            elif not found:
                unknown.append(h)
                if re.match(r"^Q\d+$", h):
                    notes.append(f"{h} is a parked question, not an ask; resolve_asks closes asks only")
            elif not live:
                already.append(h)
            else:
                ev_ids.append(S.act(t, sid, item=live[0]["id"], action="resolve", actor="agent", handle=h,
                                    turn=turn, note=note))
                resolved.append(h)
        how, wstat = self.wait_applied("act", ev_ids) if ev_ids else (None, None)
        cold, kept, how = self.cold_now(sid, cold, how, bool(ev_ids))
        if unchecked and not kept:
            notes.append(f"{', '.join(unchecked)} could not be checked here (this session's earlier items could not be "
                         "read); the writer closes each one that is an open ask of this session")
        log(f"resolve {sid} turn={turn} resolved={resolved} already_closed={already} unknown={unknown} "
            f"note={'yes' if note else 'no'} events={len(ev_ids)} writer={how}"
            + (f" cold={cold.get('file')} kept unchecked={unchecked}" if kept else ""))

        tn = f" (turn {turn})" if turn is not None else ""
        lines = [f"ledgr kept the closing of {', '.join(resolved)}{tn}: it is applied once ledgr can read this "
                 "session's earlier items." if resolved and kept else
                 f"ledgr closed {', '.join(resolved)} as resolved by the agent{tn}; the user can reopen any of them "
                 "in the panel." if resolved else "ledgr closed nothing."]
        if already:
            lines.append(f"Already closed: {', '.join(already)}.")
        if unknown:
            lines.append(f"Not an ask of this session: {', '.join(unknown)} (open_asks lists the handles).")
        lines += [f"Note: {x}." for x in notes]
        if resolved and how == "stalled":
            lines.append(f"ledgr's writer is not applying events ({wstat['why']}). These closures are queued: the "
                         "panel still shows the asks open.")
            lines.append("Tell the user in your reply that ledgr's writer is not applying events (relaunching Herdr "
                         "restarts it; nothing queued is lost).")
        elif resolved and not kept and how == "idle" and wstat and wstat.get("oldest_s"):
            lines.append(f"ledgr's writer is behind (the oldest queued event is {span_words(wstat['oldest_s'])} old); "
                         "the panel shows them closed once it applies them.")
        elif resolved and not kept and how != "applied":
            lines.append("ledgr's writer has not applied this yet; the panel shows them closed once it does.")
        if kept:
            lines.append(cold_words(cold))
            lines.append("Tell the user in your reply, and list there the asks you closed.")
        if ctx.get("note"):
            lines.append(f"Note: {ctx['note']}; this is the terminal's synthetic session {sid}.")
        data = {"ok": True, "session_id": sid, "turn": turn, "synthetic": ctx["synthetic"], "resolved": resolved,
                "unknown": unknown, "already_closed": already, "event_ids": ev_ids, "writer": how}
        if wstat:
            data["writer_status"] = wstat
        if notes:
            data["notes"] = notes
        if kept:
            data["cold"] = cold
        if unchecked:
            data["unchecked"] = unchecked
        if ctx.get("note"):
            data["note"] = ctx["note"]
        return text_result("\n".join(lines), data)

    def t_open(self, args, ctx=None):
        ctx = ctx or self.who.resolve()
        if ctx.get("error"):
            return text_result("ledgr: " + ctx["error"], {"ok": False, "error": ctx["error"]}, error=True)
        sid = ctx["session_id"]
        items, cold = session_items(sid)
        open_, dismissed, _ = X.recorded_asks(sid, items=items)
        by_handle = {it.get("handle"): it for it in items if it.get("direction") == "agent_to_human"}
        threshold = threshold_of(K.load(create=False))

        def row(h):
            it = by_handle.get(h) or {}
            anc = it.get("anchor") if isinstance(it.get("anchor"), dict) else {}
            lv = level_of(it)
            r = {"handle": h, "status": it.get("status") or "open", "level": lv, "kind": it.get("kind") or "do",
                 "text": it.get("text"), "turn": anc.get("turn"), "options": it.get("options") or [],
                 "suggestion": it.get("promoted") is not True and A.LEVELS.index(lv) < A.LEVELS.index(threshold)}
            if it.get("recommended"):
                r["recommended"] = it["recommended"]
            if it.get("status") == "answered" and isinstance(it.get("answer"), str):
                r["answer"] = C.squash(it["answer"])[:300]
            return r

        o = sorted((row(h) for h, _ in open_), key=lambda r: handle_num(r["handle"]))
        d = sorted((row(h) for h, _ in dismissed), key=lambda r: handle_num(r["handle"]))

        def line(r):
            s = f"- {r['handle']} {r['status']} {r['level']}/{r['kind']}: {r['text']}"
            if r["options"]:
                s += " (options: " + " | ".join(r["options"]) + ")"
            if r.get("answer"):
                s += f" (the user answered: {r['answer']})"
            if r["suggestion"]:
                s += " (suggestion)"
            return s

        lines = []
        if o:
            lines.append(f"Open asks for this session (turn {ctx['turn']}):")
            lines += [line(r) for r in o]
        if d:
            lines.append("Dismissed by the user in the last 7 days (raise one again only if it truly blocks you, with repeat_of):")
            lines += [line(r) for r in d]
        # Retention Phase 2: a cold session reads as a warm one (its file). One whose file cannot be read is
        # said: what is listed may lack its earlier asks, and what the agent sends is kept until it reads.
        if cold and cold.get("error"):
            lines.append(cold_words(cold, "its earlier asks are not listed here, and what you declare or close is kept"))
        elif cold_broken(cold):
            lines.append(f"Note: ledgr's writer cannot read this session's earlier items ({cold_why(cold)}); they are "
                         "listed from that file, and what you declare or close is kept and applied once that is fixed "
                         "(the user's panel offers Try again).")
        if not lines:
            lines.append("No open or recently dismissed asks for this session.")
        if ctx.get("note"):
            lines.append(f"Note: {ctx['note']}; this is the terminal's synthetic session {sid}.")
        data = {"ok": True, "session_id": sid, "turn": ctx["turn"], "synthetic": ctx["synthetic"], "open": o,
                "dismissed": d}
        if cold_broken(cold):
            data["cold"] = cold
        if ctx.get("note"):
            data["note"] = ctx["note"]
        return text_result("\n".join(lines), data)

    def t_parked(self, args, ctx=None):
        ctx = ctx or self.who.resolve()
        if ctx.get("error"):
            return text_result("ledgr: " + ctx["error"], {"ok": False, "error": ctx["error"]}, error=True)
        sid = ctx["session_id"]
        items, cold = session_items(sid)              # a cold session's from its file
        flag = any("releasedToAgent" in it for it in snapshot_items() + items if it.get("direction") == "human_to_agent")
        qs = []
        for it in items:
            if it.get("direction") != "human_to_agent" or it.get("releasedToAgent") is not True:
                continue
            if (it.get("status") or "open") not in ("open", "deferred"):
                continue
            anc = it.get("anchor") if isinstance(it.get("anchor"), dict) else {}
            q = {"handle": it.get("handle"), "text": it.get("text"), "kind": it.get("kind") or "question",
                 "turn": anc.get("turn"), "released_at": it.get("releasedAt")}
            if anc.get("quote"):
                q["quote"] = anc["quote"]
            qs.append(q)
        qs.sort(key=lambda q: handle_num(q.get("handle") or "Q0"))
        data = {"ok": True, "session_id": sid, "synthetic": ctx["synthetic"], "questions": qs,
                "flag": "releasedToAgent"}
        if cold and cold.get("error"):
            data["cold"] = cold
            return text_result(cold_words(cold, "its earlier questions are not listed here, and what you declare or close is kept"), data)
        if not flag:
            data["note"] = ("ledgr's store does not expose a release flag yet (expected: releasedToAgent: true on a "
                            "parked question), so no parked question is released to you")
            return text_result(f"No parked questions released to you. Note: {data['note']}.", data)
        if not qs:
            return text_result("No parked questions released to you for this session.", data)
        lines = ["Parked questions the user released to you (answer each in your reply and name its handle):"]
        for q in qs:
            lines.append(f"- {q['handle']}: {q['text']}" + (f" (about: \"{C.squash(q['quote'])[:200]}\")" if q.get("quote") else ""))
        return text_result("\n".join(lines), data)


class Err:
    def __init__(self, code, message, data=None):
        self.code, self.message, self.data = code, message, data


def ok(rid, result):
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def err(rid, code, message, data=None):
    e = {"code": code, "message": message}
    if data is not None:
        e["data"] = data
    return {"jsonrpc": "2.0", "id": rid, "error": e}


def main():
    # The protocol stream is a private copy of stdout; fd 1 then points at stderr, so nothing else
    # this process (or a library) prints can reach the client as a malformed message.
    out = os.fdopen(os.dup(1), "wb")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    server = Server(out)
    inp = sys.stdin.buffer
    try:
        while True:
            line = inp.readline()
            if not line:
                break
            server.handle_line(line)
    except (BrokenPipeError, KeyboardInterrupt):
        pass
    log(f"exit pid={os.getpid()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
