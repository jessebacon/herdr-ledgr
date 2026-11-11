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
declare_asks writes ledgr-data/mcp/<session>/<turn>.json (the turn's declaration: call count, event
ids, asks, handles); a second call in the same turn sets `replaces_turn: true` on its event. After
emitting it waits up to LEDGR_MCP_WAIT_MS (default 2500) for the writer to ingest the event and reads
the handles from snapshot.json; when the writer is not running (spool files older than 5 s) it does
not wait. resolve_asks maps each handle to this session's agent ask in snapshot.json (the items
open_asks lists) and drops one `act` event per ask still open, deferred or answered (action
"resolve", actor "agent", the handle, the turn); it waits for the writer the same way.

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


def _version():
    m = C.read_json(os.path.join(os.path.dirname(BIN), "mod.json"), {})
    return m.get("version") if isinstance(m, dict) and isinstance(m.get("version"), str) else "0"


SERVER_INFO = {"name": "ledgr", "title": "ledgr", "version": _version()}

INSTRUCTIONS = (
    "ledgr keeps the list of what the user must decide or do beside this conversation. When a reply leaves "
    "something blocking or needed for the user, call declare_asks once, when the work of the reply is done, "
    "and end the reply with the pointer line it returns, instead of a closing list or a ledgr-asks block. "
    "Declare only what the user personally must do, decide, provide or review. Something you are waiting on "
    "from your own subagents, tools, builds, tests or processes is not an ask of the user, even when you "
    "write \"I need\": say it in prose and declare nothing. open_asks shows what is already recorded, with "
    "handles such as A7; when the user's message answers or drops one of them, call resolve_asks with its "
    "handle before declaring anything new. When a ledgr tool answers off: true, ledgr is off in this space: "
    "list what you need from the user in your reply instead.")

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
        "quote": {"type": "string", "description": "The sentence of your reply it comes from, verbatim."},
        "options": {"type": "array", "items": {"type": "string"}, "maxItems": A.MAX_OPTIONS,
                    "description": "Only when there is a choice."},
        "recommended": {"type": "string", "description": "The option you recommend, if any."},
        "repeat_of": {"type": "string", "description": "The handle (A7) of an ask from open_asks that this raises again."},
    },
    "required": ["level", "kind", "text"],
    "additionalProperties": False,
}

TOOLS = [
    {
        "name": "declare_asks",
        "title": "Declare asks for the user",
        "description": (
            "Hand what you need from the user to ledgr instead of listing it in your reply. Declare only "
            "blocking items (you stopped or cannot finish without it) and needed items (you went on, but the "
            "work is unfinished until the user acts); never suggestions or offers. Only what the user "
            "personally must do, decide, provide or review: never a wait on your own subagents, tools, builds "
            "or tests, even when you write \"I need\". text: one line. quote: the sentence of your reply it "
            "comes from, verbatim. options: only for a choice. Call it once, when the work of the reply is "
            "done; a second call in the same turn replaces the first. Then end your reply with the pointer "
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

def snapshot_items():
    snap = C.read_json(C.path("snapshot.json"), {})
    items = snap.get("items") if isinstance(snap, dict) else None
    if isinstance(items, dict):
        items = list(items.values())
    return [it for it in items if isinstance(it, dict)] if isinstance(items, list) else []


def session_of(it):
    anc = it.get("anchor") if isinstance(it.get("anchor"), dict) else {}
    return anc.get("sessionId") or it.get("sessionId")


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
            return text_result("ledgr: items must be an array of {level, kind, text, quote?, options?}. Nothing recorded.",
                               {"ok": False, "error": "items must be an array"}, error=True)
        ctx = ctx or self.who.resolve()
        if ctx.get("error"):
            return text_result("ledgr: " + ctx["error"], {"ok": False, "error": ctx["error"]}, error=True)
        sid, turn, t = ctx["session_id"], ctx["turn"], ctx["terminal"]
        _, _, known = X.recorded_asks(sid)
        by_handle = {it.get("handle"): it for it in snapshot_items()
                     if session_of(it) == sid and it.get("direction") == "agent_to_human"}
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
        handles, applied = [None] * len(asks), None
        if ev_id and asks:
            handles, applied = self.wait_handles(sid, turn, asks)
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
        if ctx.get("note"):
            data["note"] = ctx["note"]

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
        if asks and not any(handles):
            lines.append("Handles are pending: ledgr's writer has not applied the event yet; they appear in the panel.")
        if any(a["quote"] for a in asks):
            lines.append("Quotes are checked against your reply when the turn ends, so keep them verbatim.")
        if pointer:
            lines.append("List them in your reply as usual and end it with this line:" if mode == "both" else
                         "End your reply with this line; do not list these items in prose or in a ledgr-asks block:")
            lines.append(pointer)
        elif asks:
            lines.append("Nothing here counts as needing the user, so end your reply without a pointer line.")
        return text_result("\n".join(lines), data, error=bool(items) and not asks)

    def wait_handles(self, sid, turn, asks):
        """(handles, how) once the writer has ingested our spool file(s); how is applied, timeout or idle."""
        spool, mine = C.path("spool"), f"-asks-{os.getpid()}-"
        if self.writer_idle(spool):
            return [None] * len(asks), "idle"
        deadline = time.monotonic() + self.wait_ms / 1000.0
        while True:
            try:
                pending = any(mine in n for n in os.listdir(spool) if not n.startswith("."))
            except OSError:
                pending = False
            if not pending:
                hs = self.match_handles(sid, turn, asks)
                if all(hs) or time.monotonic() >= deadline:
                    return hs, "applied"
            elif time.monotonic() >= deadline:
                return [None] * len(asks), "timeout"
            time.sleep(0.05)

    def wait_applied(self, kind):
        """applied once the writer has ingested this process's `kind` spool files; timeout after
        LEDGR_MCP_WAIT_MS; idle when no writer is ingesting (writer_idle), without waiting."""
        spool, mine = C.path("spool"), f"-{kind}-{os.getpid()}-"
        if self.writer_idle(spool):
            return "idle"
        deadline = time.monotonic() + self.wait_ms / 1000.0
        while True:
            try:
                pending = any(mine in n for n in os.listdir(spool) if not n.startswith("."))
            except OSError:
                pending = False
            if not pending:
                return "applied"
            if time.monotonic() >= deadline:
                return "timeout"
            time.sleep(0.05)

    def writer_idle(self, spool):
        """True when the spool holds an event older than WRITER_STALE_S: no writer is ingesting."""
        cut = time.time() - WRITER_STALE_S
        try:
            for n in os.listdir(spool):
                if n.endswith(".json") and not n.startswith("."):
                    try:
                        if os.path.getmtime(os.path.join(spool, n)) < cut:
                            return True
                    except OSError:
                        pass
        except OSError:
            pass
        return False

    def match_handles(self, sid, turn, asks):
        items = [it for it in snapshot_items() if session_of(it) == sid and it.get("direction") == "agent_to_human"
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
        # The handle map open_asks uses: this session's agent asks in snapshot.json, by handle.
        mine = [it for it in snapshot_items() if session_of(it) == sid and it.get("direction") == "agent_to_human"
                and isinstance(it.get("id"), str)]
        resolved, unknown, already, ev_ids = [], [], [], []
        for h in wanted:
            found = [it for it in mine if it.get("handle") == h]
            live = [it for it in found if it.get("status") not in CLOSED]
            if not found:
                unknown.append(h)
                if re.match(r"^Q\d+$", h):
                    notes.append(f"{h} is a parked question, not an ask; resolve_asks closes asks only")
            elif not live:
                already.append(h)
            else:
                ev_ids.append(S.act(t, sid, item=live[0]["id"], action="resolve", actor="agent", handle=h,
                                    turn=turn, note=note))
                resolved.append(h)
        how = self.wait_applied("act") if ev_ids else None
        log(f"resolve {sid} turn={turn} resolved={resolved} already_closed={already} unknown={unknown} "
            f"note={'yes' if note else 'no'} events={len(ev_ids)} writer={how}")

        lines = [f"ledgr closed {', '.join(resolved)} as resolved by the agent"
                 + (f" (turn {turn})" if turn is not None else "") + "; the user can reopen any of them in the panel."
                 if resolved else "ledgr closed nothing."]
        if already:
            lines.append(f"Already closed: {', '.join(already)}.")
        if unknown:
            lines.append(f"Not an ask of this session: {', '.join(unknown)} (open_asks lists the handles).")
        lines += [f"Note: {x}." for x in notes]
        if resolved and how != "applied":
            lines.append("ledgr's writer has not applied this yet; the panel shows them closed once it does.")
        if ctx.get("note"):
            lines.append(f"Note: {ctx['note']}; this is the terminal's synthetic session {sid}.")
        data = {"ok": True, "session_id": sid, "turn": turn, "synthetic": ctx["synthetic"], "resolved": resolved,
                "unknown": unknown, "already_closed": already, "event_ids": ev_ids, "writer": how}
        if notes:
            data["notes"] = notes
        if ctx.get("note"):
            data["note"] = ctx["note"]
        return text_result("\n".join(lines), data)

    def t_open(self, args, ctx=None):
        ctx = ctx or self.who.resolve()
        if ctx.get("error"):
            return text_result("ledgr: " + ctx["error"], {"ok": False, "error": ctx["error"]}, error=True)
        sid = ctx["session_id"]
        open_, dismissed, _ = X.recorded_asks(sid)
        by_handle = {it.get("handle"): it for it in snapshot_items()
                     if session_of(it) == sid and it.get("direction") == "agent_to_human"}
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
        if not lines:
            lines.append("No open or recently dismissed asks for this session.")
        if ctx.get("note"):
            lines.append(f"Note: {ctx['note']}; this is the terminal's synthetic session {sid}.")
        data = {"ok": True, "session_id": sid, "turn": ctx["turn"], "synthetic": ctx["synthetic"], "open": o,
                "dismissed": d}
        if ctx.get("note"):
            data["note"] = ctx["note"]
        return text_result("\n".join(lines), data)

    def t_parked(self, args, ctx=None):
        ctx = ctx or self.who.resolve()
        if ctx.get("error"):
            return text_result("ledgr: " + ctx["error"], {"ok": False, "error": ctx["error"]}, error=True)
        sid = ctx["session_id"]
        items = snapshot_items()
        flag = any("releasedToAgent" in it for it in items if it.get("direction") == "human_to_agent")
        qs = []
        for it in items:
            if it.get("direction") != "human_to_agent" or session_of(it) != sid or it.get("releasedToAgent") is not True:
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
