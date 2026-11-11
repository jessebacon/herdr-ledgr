"""ledgr MCP server (bin/mcp/ledgr_mcp.py) over real stdio: spawns the server with a scratch
LEDGR_DATA (like test-hooks.sh) and speaks newline-delimited JSON-RPC to it. No Claude, no Herdr, no
Keychain read. A small fake writer (this file) stands in for the mod's writer where handles matter.
    python3 -I -B tests/test_mcp.py
"""
import hashlib
import json
import os
import re
import select
import shutil
import subprocess
import sys
import tempfile
import threading
import time

BIN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(BIN, "mcp", "ledgr_mcp.py")
PY = os.environ.get("LEDGR_PYTHON") or sys.executable
sys.path.insert(0, os.path.join(BIN, "lib"))
ROOT = tempfile.mkdtemp(prefix="ledgr-mcp-test.")
DATA = os.path.join(ROOT, "data")
os.environ["LEDGR_DATA"] = DATA            # before importing the lib: ledgr_core reads it at import
sys.dont_write_bytecode = True
import ledgr_asks as A  # noqa: E402

SID = "11111111-2222-3333-4444-555555555555"
SID2 = "22222222-3333-4444-5555-666666666666"
OTHER = "99999999-0000-0000-0000-000000000000"
MODERN = "2026-07-28"
checks = fails = 0
servers = []


def check(name, cond, detail=None):
    global checks, fails
    checks += 1
    if cond:
        print(f"PASS {name}")
    else:
        fails += 1
        print(f"FAIL {name}" + (f"\n     {json.dumps(detail, ensure_ascii=False, default=str)[:900]}" if detail is not None else ""))


def sha12(s):
    s = re.sub(r"\s+", " ", s).strip()
    return hashlib.sha1(s.encode()).hexdigest()[:12]


def wjson(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f)
    os.replace(tmp, path)


def rjson(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def comm_of(pid):
    r = subprocess.run(["/bin/ps", "-o", "comm=", "-p", str(pid)], capture_output=True)
    return os.path.basename(r.stdout.decode().strip()) or None


def set_map(t, sid, turn, owner_pid=None, owner_comm=None, prompt_id=None, **extra):
    pid = os.getpid() if owner_pid is None else owner_pid
    rec = {"v": 1, "terminal": t, "agent": "claude-code", "session_id": sid, "turn": turn,
           "prompt_id": prompt_id or f"p{turn}", "state": "working", "owner_pid": pid,
           "owner_comm": owner_comm if owner_comm is not None else comm_of(pid)}
    rec.update(extra)
    wjson(os.path.join(DATA, "terminals", t.replace("/", "__") + ".json"), rec)


def spool_files():
    d = os.path.join(DATA, "spool")
    return sorted(os.path.join(d, n) for n in os.listdir(d) if n.endswith(".json") and not n.startswith(".")) \
        if os.path.isdir(d) else []


def take_events():
    """Every event in the spool, oldest first; the files are removed (each section starts clean)."""
    out = []
    for p in spool_files():
        ev = rjson(p)
        if ev is not None:
            out.append(ev)
        os.unlink(p)
    return out


class Client:
    def __init__(self, terminal="t99", wait_ms=300, extra=None, drop=(), child=False):
        env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": os.environ.get("HOME", ROOT),
               "LEDGR_DATA": DATA, "LEDGR_KEYCHAIN_SERVICE": "ledgr-test-missing-service",
               "LEDGR_MCP_WAIT_MS": str(wait_ms)}
        if terminal:
            env["HC_TERMINAL_ID"] = terminal
        env.update(extra or {})
        for k in drop:
            env.pop(k, None)
        self.err = open(os.path.join(ROOT, "server.err"), "ab")
        # No -B: the server itself must keep bytecode out of the mod folder.
        # child=True: one more copy of this program between the test and the server, the shape of a
        # child agent (a `claude -p` run from the agent's shell) whose own MCP server inherits the terminal.
        argv = [PY, "-I", SERVER]
        if child:
            argv = [PY, "-I", "-c", "import subprocess, sys; sys.exit(subprocess.call(sys.argv[1:]))"] + argv
        self.p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err, env=env)
        self.buf, self.lines, self.nid = b"", [], 0
        servers.append(self)

    def send(self, msg):
        raw = msg if isinstance(msg, (bytes, str)) else json.dumps(msg)
        raw = raw.encode() if isinstance(raw, str) else raw
        self.p.stdin.write(raw + b"\n")
        self.p.stdin.flush()

    def recv(self, timeout=10.0):
        end = time.monotonic() + timeout
        while b"\n" not in self.buf:
            left = end - time.monotonic()
            if left <= 0:
                raise TimeoutError("no message from the server")
            r, _, _ = select.select([self.p.stdout], [], [], left)
            if r:
                chunk = os.read(self.p.stdout.fileno(), 65536)
                if not chunk:
                    raise EOFError("server closed stdout")
                self.buf += chunk
        line, self.buf = self.buf.split(b"\n", 1)
        self.lines.append(line)
        return json.loads(line)

    def silent(self, timeout=0.4):
        if b"\n" in self.buf:
            return False
        r, _, _ = select.select([self.p.stdout], [], [], timeout)
        return not r

    def req(self, method, params=None, meta=None):
        self.nid += 1
        msg = {"jsonrpc": "2.0", "id": self.nid, "method": method}
        if params is not None or meta is not None:
            msg["params"] = dict(params or {})
            if meta is not None:
                msg["params"]["_meta"] = meta
        self.send(msg)
        m = self.recv()
        assert m.get("id") == self.nid, m
        return m

    def call(self, name, args=None, meta=None):
        m = self.req("tools/call", {"name": name, "arguments": args if args is not None else {}}, meta)
        return m.get("result") or m

    def init(self, version="2025-06-18"):
        r = self.req("initialize", {"protocolVersion": version, "capabilities": {},
                                    "clientInfo": {"name": "claude-code", "version": "test"}})
        self.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return r

    def close(self):
        try:
            self.p.stdin.close()
        except Exception:
            pass
        try:
            return self.p.wait(5)
        except subprocess.TimeoutExpired:
            self.p.kill()
            return None


def text(res):
    return (res.get("content") or [{}])[0].get("text", "")


def modern_meta(version=MODERN, caps=True):
    m = {"io.modelcontextprotocol/protocolVersion": version,
         "io.modelcontextprotocol/clientInfo": {"name": "claude-code", "version": "test"}}
    if caps:
        m["io.modelcontextprotocol/clientCapabilities"] = {}
    return m


# ---------- a fake writer: the semantics README.md asks of the real one ----------

class FakeWriter(threading.Thread):
    """Applies `asks` events with source "tool" to snapshot.json, then unlinks them (the real writer
    saves store.json and snapshot.json before it unlinks). replaces_turn drops this turn's tool asks
    that the new list no longer has; an ask with the text of an open one updates it in place."""

    def __init__(self):
        super().__init__(daemon=True)
        self.stop = False
        self.acts = []


    def run(self):
        while not self.stop:
            for p in spool_files():
                ev = rjson(p)
                if isinstance(ev, dict) and ev.get("type") == "asks" and ev.get("source") == "tool":
                    self.apply(ev)
                elif isinstance(ev, dict) and ev.get("type") == "act" and ev.get("action") == "resolve":
                    self.acts.append(ev)
                    self.resolve(ev)
                try:
                    os.unlink(p)
                except OSError:
                    pass
            time.sleep(0.02)

    def resolve(self, ev):
        """store.js act("resolve") plus the contract: resolvedBy "agent" when actor is "agent"."""
        path = os.path.join(DATA, "snapshot.json")
        snap = rjson(path, {"v": 1, "items": []})
        for it in snap["items"]:
            if it.get("id") == ev["item"] and it["anchor"]["sessionId"] == ev["session_id"]:
                it.update(status="resolved", resolvedAt=ev["at"], updatedAt=ev["at"])
                if ev.get("actor") == "agent":
                    it["resolvedBy"] = "agent"
        wjson(path, snap)

    def apply(self, ev):
        path = os.path.join(DATA, "snapshot.json")
        snap = rjson(path, {"v": 1, "items": []})
        items, sid, turn, now = snap["items"], ev["session_id"], ev["turn"], int(time.time() * 1000)
        mine = [it for it in items if it.get("direction") == "agent_to_human" and it["anchor"]["sessionId"] == sid]
        keys = {A.norm_key(a["text"]) for a in ev["asks"]}
        if ev.get("replaces_turn"):
            items[:] = [it for it in items if not (it in mine and it.get("origin") == "tool" and it.get("createdTurn") == turn
                                                   and it.get("status") == "open" and A.norm_key(it["text"]) not in keys)]
        nxt = max([int(it["handle"][1:]) for it in mine] + [0]) + 1
        for a in ev["asks"]:
            k = A.norm_key(a["text"])
            same = [it for it in items if it in mine and A.norm_key(it["text"]) == k and it.get("status") in ("open", "deferred")]
            if same:
                same[0].update(level=a["level"], kind=a["kind"], updatedAt=now)
                same[0]["anchor"]["turn"] = turn
                continue
            items.append({"id": f"rq_{nxt}", "handle": f"A{nxt}", "direction": "agent_to_human", "text": a["text"],
                          "level": a["level"], "kind": a["kind"], "status": "open", "origin": "tool",
                          "anchor": {"sessionId": sid, "turn": turn, "hash": a["hash"]}, "createdTurn": turn,
                          "createdAt": now, "updatedAt": now})
            nxt += 1
        snap["updatedAt"] = now
        wjson(path, snap)


def main():
    os.makedirs(os.path.join(DATA, "terminals"), exist_ok=True)

    print("== protocol: legacy handshake")
    c = Client()
    r = c.init("2025-06-18")["result"]
    check("initialize: the requested 2025-06-18 is answered as is, serverInfo ledgr, tools capability, instructions",
          r.get("protocolVersion") == "2025-06-18" and r["serverInfo"]["name"] == "ledgr" and "tools" in r["capabilities"]
          and "declare_asks" in (r.get("instructions") or "") and "resultType" not in r, r)
    check("instructions: answered or dropped asks go to resolve_asks, by handle, before declaring",
          "resolve_asks" in r.get("instructions", "") and "answers or drops" in r.get("instructions", "")
          and "before declaring anything new" in r.get("instructions", ""), r.get("instructions"))
    check("instructions: only what the user personally must do; a wait on the agent's own subagents is not an ask",
          "user personally must do, decide, provide or review" in r.get("instructions", "")
          and "your own subagents" in r.get("instructions", "") and "\"I need\"" in r.get("instructions", ""),
          r.get("instructions"))
    check("notifications/initialized: no response", c.silent())
    r = c.req("initialize", {"protocolVersion": "1999-01-01", "capabilities": {}, "clientInfo": {"name": "x"}})["result"]
    check("initialize: an unknown version is answered with the newest legacy one (2025-11-25)", r.get("protocolVersion") == "2025-11-25", r)
    check("ping: empty result", c.req("ping").get("result") == {})
    tl = c.req("tools/list")["result"]["tools"]
    names = [t["name"] for t in tl]
    check("tools/list: declare_asks, resolve_asks, open_asks, parked_questions, in that order",
          names == ["declare_asks", "resolve_asks", "open_asks", "parked_questions"], names)
    tool = {t["name"]: t for t in tl}
    d = tl[0]
    item = d["inputSchema"]["properties"]["items"]["items"]
    check("declare_asks: items schema requires level, kind, text; level enum blocking|needed; loads upfront",
          set(item["required"]) == {"level", "kind", "text"} and item["properties"]["level"]["enum"] == ["blocking", "needed"]
          and d.get("_meta", {}).get("anthropic/alwaysLoad") is True, d)
    check("descriptions are short and carry the rules (blocking, needed, one line, verbatim, options, pointer, no prose list)",
          all(len(t["description"]) < 700 for t in tl) and all(w in d["description"] for w in
                                                                ("blocking", "needed", "one line", "verbatim", "only for a choice", "pointer line", "list nothing in prose")),
          [len(t["description"]) for t in tl])
    check("declare_asks: only what the user personally must do, never a wait on your own subagents",
          "user personally must do, decide, provide or review" in d["description"]
          and "your own subagents" in d["description"] and "\"I need\"" in d["description"], d["description"])
    check("open_asks and parked_questions take no parameters",
          all(tool[n]["inputSchema"] == {"type": "object", "additionalProperties": False} for n in ("open_asks", "parked_questions")))
    ra = tool["resolve_asks"]
    check("resolve_asks: handles (strings) required, note optional, loaded upfront (alwaysLoad, like declare_asks), not read-only, the rules in its description",
          ra["inputSchema"]["required"] == ["handles"] and ra["inputSchema"]["properties"]["handles"]["items"] == {"type": "string"}
          and set(ra["inputSchema"]["properties"]) == {"handles", "note"} and ra.get("_meta", {}).get("anthropic/alwaysLoad") is True
          and ra["annotations"]["readOnlyHint"] is False
          and all(w in ra["description"] for w in ("answered or made moot", "before declare_asks", "Never close", "reopen")), ra)
    m = c.req("resources/list")
    check("unknown method: -32601", m.get("error", {}).get("code") == -32601, m)
    c.send({"jsonrpc": "2.0", "method": "notifications/whatever", "params": {}})
    check("unknown notification: no response", c.silent())
    c.send({"jsonrpc": "2.0", "id": 77, "result": {}})
    check("a response from the client: ignored", c.silent())
    c.send("{not json")
    m = c.recv()
    check("malformed JSON: -32700 with id null", m.get("id") is None and m["error"]["code"] == -32700, m)
    c.send({"id": 5, "method": "ping"})
    m = c.recv()
    check("no jsonrpc 2.0: -32600 Invalid Request", m.get("id") == 5 and m["error"]["code"] == -32600, m)
    m = c.req("tools/call", {"name": "nope", "arguments": {}})
    check("unknown tool: -32602", m.get("error", {}).get("code") == -32602 and "nope" in m["error"]["message"], m)
    c.send([{"jsonrpc": "2.0", "id": "b1", "method": "ping"}, {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": "b2", "method": "ping"}])
    m = c.recv()
    check("a batch: one array with a response per request", isinstance(m, list) and [x["id"] for x in m] == ["b1", "b2"], m)

    print("== protocol: 2026-07-28 (per-request _meta)")
    r = c.req("server/discover", {}, modern_meta())["result"]
    check("server/discover: versions (modern and legacy), tools capability, resultType, serverInfo in _meta",
          r.get("resultType") == "complete" and MODERN in r["supportedVersions"] and "2025-11-25" in r["supportedVersions"]
          and "tools" in r["capabilities"] and r["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "ledgr", r)
    r = c.req("tools/list", {}, modern_meta())["result"]
    check("tools/list (modern): resultType, ttlMs, cacheScope, the four tools",
          r.get("resultType") == "complete" and isinstance(r.get("ttlMs"), int) and r.get("cacheScope") in ("public", "private")
          and len(r["tools"]) == 4, r)
    m = c.req("tools/list", {}, modern_meta("1900-01-01"))
    check("unsupported version: -32022 with supported and requested",
          m.get("error", {}).get("code") == -32022 and MODERN in m["error"]["data"]["supported"]
          and m["error"]["data"]["requested"] == "1900-01-01", m)
    m = c.req("tools/list", {}, modern_meta(caps=False))
    check("modern request without clientCapabilities: -32602", m.get("error", {}).get("code") == -32602, m)
    r = c.call("open_asks", {}, modern_meta())
    check("tools/call (modern): resultType complete, text content", r.get("resultType") == "complete" and text(r), r)
    c.send({"jsonrpc": "2.0", "id": "sub1", "method": "subscriptions/listen",
            "params": {"_meta": modern_meta(), "notifications": {"toolsListChanged": True, "resourcesListChanged": True}}})
    m = c.recv()
    check("subscriptions/listen: acknowledged with its id, toolsListChanged only, and held open (no response)",
          m.get("method") == "notifications/subscriptions/acknowledged" and "id" not in m
          and m["params"]["_meta"]["io.modelcontextprotocol/subscriptionId"] == "sub1"
          and m["params"]["notifications"] == {"toolsListChanged": True} and c.silent(), m)
    c.send({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": "sub1"}})
    check("cancelling the subscription: nothing sent, the server goes on", c.silent() and c.req("ping").get("result") == {})

    print("== declare_asks: a valid declaration")
    take_events()
    set_map("t99", SID, 3, prompt_id="p3")
    q = "I stopped because the retry policy is your call."
    items = [{"level": "blocking", "kind": "decide", "text": "Choose the retry policy", "quote": q,
              "options": ["fast", "safe"], "recommended": "safe"},
             {"level": "needed", "kind": "do", "text": "Rotate the staging key"}]
    r = c.call("declare_asks", {"items": items})
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("valid: no error, mapped session, turn 3, first call", not r.get("isError") and sc.get("session_id") == SID
          and sc.get("turn") == 3 and sc.get("synthetic") is False and sc.get("replaces_turn") is False and sc.get("call") == 1, sc)
    check("valid: the pointer line, and it is the result's last line", sc.get("pointer") == "ledgr: 2 items for you, 1 blocking"
          and tx.splitlines()[-1] == sc["pointer"] and "do not list these items in prose" in tx, tx)
    check("valid: no writer, so handles are pending and said so", sc.get("handles") == [None, None] and "pending" in tx, tx)
    evs = take_events()
    ev = evs[0] if len(evs) == 1 else {}
    check("one asks event: source tool, turn 3, prompt p3, terminal t99, envelope",
          len(evs) == 1 and ev.get("type") == "asks" and ev.get("source") == "tool" and ev.get("turn") == 3
          and ev.get("prompt_id") == "p3" and ev.get("terminal") == "t99" and ev.get("session_id") == SID
          and ev.get("v") == 1 and len(ev.get("id", "")) == 36 and ev.get("message_uuid") is None
          and ev.get("passage_hash") is None and ev.get("replaces_turn") is False and ev.get("tool_call") == 1, ev)
    a0, a1 = (ev.get("asks") or [{}, {}])[:2]
    check("event asks: validator shape, level, origin tool, quote kept unverified, hash of the quote, options, recommended",
          a0.get("level") == "blocking" and a0.get("blocking") is True and a0.get("kind") == "decide" and a0.get("origin") == "tool"
          and a0.get("quote") == q and a0.get("quote_verified") is False and a0.get("hash") == sha12(q)
          and a0.get("options") == ["fast", "safe"] and a0.get("recommended") == "safe" and a0.get("repeat_of") is None, a0)
    check("event asks: no quote, hash of the text", a1.get("level") == "needed" and a1.get("quote") is None
          and a1.get("quote_verified") is None and a1.get("hash") == sha12("Rotate the staging key"), a1)
    st = rjson(os.path.join(DATA, "mcp", SID, "3.json"), {})
    check("state file mcp/<sid>/3.json: call 1, the event id, two asks, the pointer",
          st.get("calls") == 1 and st.get("event_ids") == [ev.get("id")] and len(st.get("asks") or []) == 2
          and st.get("pointer") == sc["pointer"], st)
    check("state file keeps each ask whole, as the event sent it (options, recommended, every validator field)",
          st.get("asks") == ev.get("asks") and st["asks"][0].get("options") == ["fast", "safe"]
          and st["asks"][0].get("recommended") == "safe" and st["asks"][1].get("options") == []
          and st["asks"][1].get("recommended") is None
          and all(set(a) >= {"text", "kind", "level", "options", "recommended", "blocking", "quote", "repeat_of",
                             "repeat_of_handle", "hash", "origin", "quote_verified"} for a in st["asks"]), st.get("asks"))

    print("== declare_asks: rejected items")
    set_map("t99", SID, 4)                       # the map moves on: resolved again at this call
    items = [{"level": "urgent", "kind": "do", "text": "Approve it"}, {"level": "needed", "kind": "do", "text": "  "},
             "just a string", {"level": "needed", "kind": "review", "text": "Check the DM link on your phone"},
             {"level": "needed", "kind": "review", "text": "check the DM link on your phone."},
             {"level": "optional", "kind": "do", "text": "Consider a weekly digest"}]
    r = c.call("declare_asks", {"items": items})
    sc, tx = r.get("structuredContent") or {}, text(r)
    rj = {x["item"]: x["reason"] for x in sc.get("rejected") or []}
    check("rejected: unknown level, empty text, not an object, a duplicate, each with its reason",
          "unknown level 'urgent'" in rj.get(1, "") and "text is required" in rj.get(2, "") and rj.get(3) == "not an object"
          and "same text as item 4" in rj.get(5, "") and len(rj) == 4, sc.get("rejected"))
    check("rejected: the rest is recorded (turn 4); an optional item is a suggestion, not counted",
          not r.get("isError") and sc.get("turn") == 4 and [x["item"] for x in sc["items"]] == [4, 6]
          and sc["items"][1]["suggestion"] is True and sc.get("pointer") == "ledgr: 1 item for you"
          and "kept as a suggestion" in tx and "Not recorded:" in tx, tx)
    evs = take_events()
    check("rejected: one event, two asks, reasons on the event", len(evs) == 1 and len(evs[0]["asks"]) == 2
          and len(evs[0].get("rejected") or []) == 4 and evs[0]["replaces_turn"] is False, evs)
    r = c.call("declare_asks", {"items": [{"level": "critical", "kind": "do", "text": "x"}, {"kind": "do"}]})
    check("all rejected: isError, nothing written", r.get("isError") is True and "recorded nothing" in text(r)
          and not spool_files(), text(r))
    r = c.call("declare_asks", {"items": "not a list"})
    check("items not an array: isError", r.get("isError") is True, text(r))

    print("== declare_asks: a second call in the same turn")
    r = c.call("declare_asks", {"items": [{"level": "blocking", "kind": "provide", "text": "Paste the staging API key"},
                                          {"level": "needed", "kind": "review", "text": "Check the DM link on your phone"}]})
    sc = r.get("structuredContent") or {}
    evs = take_events()
    st = rjson(os.path.join(DATA, "mcp", SID, "4.json"), {})
    check("same turn: replaces_turn true, tool_call 2, said in the result",
          sc.get("replaces_turn") is True and sc.get("call") == 2 and len(evs) == 1 and evs[0].get("replaces_turn") is True
          and evs[0].get("tool_call") == 2 and "replacing the 2 declared earlier" in text(r), [sc, evs])
    check("same turn: the state counts two calls, two event ids, the new list",
          st.get("calls") == 2 and len(st.get("event_ids") or []) == 2 and [a["text"] for a in st["asks"]][0] == "Paste the staging API key", st)
    r = c.call("declare_asks", {"items": []})
    evs = take_events()
    check("same turn, empty list: clears the turn (an event with no asks, replaces_turn)",
          not r.get("isError") and len(evs) == 1 and evs[0]["asks"] == [] and evs[0]["replaces_turn"] is True
          and "cleared" in text(r) and (r["structuredContent"].get("pointer") is None), [text(r), evs])
    set_map("t99", SID, 5)
    r = c.call("declare_asks", {"items": []})
    check("new turn, empty list: nothing written, no pointer", not r.get("isError") and not spool_files()
          and "nothing declared" in text(r), text(r))

    print("== repeats against snapshot.json")
    now = int(time.time() * 1000)

    def ask(h, text_, status, sid=SID, turn=1, **kw):
        it = {"id": "rq_" + h.lower(), "handle": h, "direction": "agent_to_human", "text": text_, "status": status,
              "level": "needed", "kind": "decide", "anchor": {"sessionId": sid, "turn": turn}, "createdTurn": turn,
              "createdAt": now - 3600e3, "updatedAt": now - 3600e3}
        it.update(kw)
        return it

    snap_items = [ask("A5", "Choose the retry policy", "open", options=["fast", "safe"]),
                  ask("A6", "Rotate the staging key", "dismissed", resolvedAt=now - 86400e3),
                  ask("A7", "Old thing", "dismissed", resolvedAt=now - 10 * 86400e3),
                  ask("A8", "Choose the retry policy", "open", sid=OTHER),
                  ask("A9", "Fresh this turn", "open", turn=6),
                  {"id": "rq_q1", "handle": "Q1", "direction": "human_to_agent", "text": "Why is the cache cold?",
                   "status": "open", "anchor": {"sessionId": SID, "turn": 2}}]
    wjson(os.path.join(DATA, "snapshot.json"), {"v": 1, "items": snap_items})
    set_map("t99", SID, 6)
    r = c.call("declare_asks", {"items": [
        {"level": "needed", "kind": "decide", "text": "choose the retry policy."},
        {"level": "blocking", "kind": "do", "text": "Rotate the key now", "repeat_of": "A6"},
        {"level": "needed", "kind": "do", "text": "Old thing"},
        {"level": "needed", "kind": "do", "text": "Something new", "repeat_of": "A99"},
        {"level": "needed", "kind": "do", "text": "Fresh this turn"}]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    evs = take_events()
    ea = evs[0]["asks"] if len(evs) == 1 else [{}] * 5
    check("repeat by text: an open ask (A5) of this session, not another session's (A8)",
          ea[0].get("repeat_of") == "rq_a5" and ea[0].get("repeat_of_handle") == "A5", ea[0])
    check("repeat by handle: repeat_of A6 (dismissed yesterday) is kept", ea[1].get("repeat_of") == "rq_a6"
          and ea[1].get("repeat_of_handle") == "A6", ea[1])
    check("no repeat: dismissed over 7 days ago (A7), an unknown handle (A99), an ask created this turn (A9)",
          all(e.get("repeat_of") is None for e in ea[2:]), ea[2:])
    check("repeats reported: which item, which handle, its status, how it matched",
          sc.get("repeats") == [{"item": 1, "of": "A5", "status": "open", "match": "text"},
                                {"item": 2, "of": "A6", "status": "dismissed", "match": "handle"}], sc.get("repeats"))
    check("repeats in the text; the unknown handle noted", "same as open A5" in tx and "raises dismissed A6 again" in tx
          and "'A99'" in tx, tx)

    print("== open_asks")
    r = c.call("open_asks")
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("open_asks: this session's open (A5, A9) and recently dismissed (A6), handles and levels",
          [x["handle"] for x in sc.get("open", [])] == ["A5", "A9"] and [x["handle"] for x in sc.get("dismissed", [])] == ["A6"]
          and sc["open"][0]["options"] == ["fast", "safe"] and "A5 open needed/decide" in tx and "A8" not in tx and "A7" not in tx, [sc, tx])

    print("== parked_questions")
    r = c.call("parked_questions")
    sc = r.get("structuredContent") or {}
    check("no release flag in the store: an empty list and a note naming the expected flag",
          sc.get("questions") == [] and "releasedToAgent" in sc.get("note", "") and not r.get("isError"), sc)
    snap_items += [{"id": "rq_q2", "handle": "Q2", "direction": "human_to_agent", "text": "Should we pin the SDK?",
                    "status": "open", "releasedToAgent": True, "releasedAt": now, "anchor": {"sessionId": SID, "turn": 3, "quote": "pin it"}},
                   {"id": "rq_q3", "handle": "Q3", "direction": "human_to_agent", "text": "Not yet", "status": "open",
                    "releasedToAgent": False, "anchor": {"sessionId": SID, "turn": 3}},
                   {"id": "rq_q4", "handle": "Q4", "direction": "human_to_agent", "text": "Done one", "status": "resolved",
                    "releasedToAgent": True, "anchor": {"sessionId": SID, "turn": 3}},
                   {"id": "rq_q5", "handle": "Q5", "direction": "human_to_agent", "text": "Elsewhere", "status": "open",
                    "releasedToAgent": True, "anchor": {"sessionId": OTHER, "turn": 3}}]
    wjson(os.path.join(DATA, "snapshot.json"), {"v": 1, "items": snap_items})
    r = c.call("parked_questions")
    sc = r.get("structuredContent") or {}
    check("with the flag: only this session's open questions released to the agent (Q2)",
          [x["handle"] for x in sc.get("questions", [])] == ["Q2"] and "note" not in sc and "Q2: Should we pin the SDK?" in text(r), sc)

    print("== resolve_asks (no writer)")
    take_events()
    snap_items += [ask("A3", "Old closed one", "resolved", resolvedAt=now - 3600e3),
                   ask("A4", "Pick the font", "answered", answer="serif")]
    wjson(os.path.join(DATA, "snapshot.json"), {"v": 1, "items": snap_items})
    r = c.call("resolve_asks", {"handles": ["a5", "[A4]", "A6", "A3", "A99", "A8", "Q1", "A5"],
                                "note": "  The user picked\n  safe.  "})
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("resolve: open A5 and answered A4 resolved; dismissed A6 and resolved A3 already closed; A99, another "
          "session's A8 and a question Q1 unknown; duplicates and case folded; not an error",
          not r.get("isError") and sc.get("ok") is True and sc.get("resolved") == ["A5", "A4"]
          and sc.get("already_closed") == ["A6", "A3"] and sc.get("unknown") == ["A99", "A8", "Q1"]
          and sc.get("session_id") == SID and sc.get("turn") == 6, sc)
    evs = take_events()                          # two files in the same ms sort by their random part
    byh = {e.get("handle"): e for e in evs}
    e5, e4 = byh.get("A5", {}), byh.get("A4", {})
    check("resolve: one act event per resolved ask, with the contract fields (actor agent, handle, turn, note)",
          len(evs) == 2 and all(e.get("type") == "act" and e.get("action") == "resolve" and e.get("arg") is None
                                and e.get("actor") == "agent" and e.get("session_id") == SID and e.get("terminal") == "t99"
                                and e.get("turn") == 6 and e.get("note") == "The user picked safe." and e.get("v") == 1
                                and len(e.get("id", "")) == 36 for e in evs)
          and (e5.get("item"), e5.get("handle"), e4.get("item"), e4.get("handle")) == ("rq_a5", "A5", "rq_a4", "A4")
          and sc.get("event_ids") == [e5.get("id"), e4.get("id")], evs)
    check("resolve: the text names each list, the question, and that no writer has applied it yet",
          "ledgr closed A5, A4 as resolved by the agent (turn 6)" in tx and "Already closed: A6, A3." in tx
          and "Not an ask of this session: A99, A8, Q1" in tx and "Q1 is a parked question" in tx
          and "has not applied" in tx and sc.get("writer") == "timeout", tx)
    r = c.call("resolve_asks", {"handles": ["A99"]})
    sc = r.get("structuredContent") or {}
    check("resolve: only an unknown handle: reported, not an error, nothing written",
          not r.get("isError") and sc.get("resolved") == [] and sc.get("unknown") == ["A99"] and sc.get("writer") is None
          and "closed nothing" in text(r) and not spool_files(), [sc, text(r)])
    r = c.call("resolve_asks", {"handles": [5, "A5"]})
    r2 = c.call("resolve_asks", {})
    check("resolve: handles not an array of strings, or missing: isError, nothing written",
          r.get("isError") is True and r2.get("isError") is True and not spool_files(), [text(r), text(r2)])
    snap_items[:] = [it for it in snap_items if it.get("handle") not in ("A3", "A4")]
    wjson(os.path.join(DATA, "snapshot.json"), {"v": 1, "items": snap_items})
    check("server 1 exits 0 when stdin closes", c.close() == 0)

    print("== handles from the writer")
    take_events()
    fw = FakeWriter()
    fw.start()
    c = Client(wait_ms=3000)
    c.init()
    set_map("t99", SID, 7)
    r1 = c.call("declare_asks", {"items": [{"level": "blocking", "kind": "decide", "text": "Pick the region"},
                                           {"level": "needed", "kind": "do", "text": "Enable billing alerts"}]})
    s1 = r1.get("structuredContent") or {}
    check("the writer applied it: handles A10 and A11 (after A9), in the text", s1.get("handles") == ["A10", "A11"]
          and s1.get("writer") == "applied" and "- A10 blocking/decide: Pick the region" in text(r1), [s1.get("handles"), text(r1)])
    r2 = c.call("declare_asks", {"items": [{"level": "blocking", "kind": "decide", "text": "Pick the region"},
                                           {"level": "needed", "kind": "provide", "text": "Send the invoice address"}]})
    s2 = r2.get("structuredContent") or {}
    snap = rjson(os.path.join(DATA, "snapshot.json"), {})
    open7 = sorted(it["handle"] for it in snap.get("items", []) if it.get("direction") == "agent_to_human"
                   and it["anchor"]["sessionId"] == SID and it.get("createdTurn") == 7)
    check("same turn again: the kept ask keeps its handle (A10), the new one is A12, the dropped one is gone",
          s2.get("handles") == ["A10", "A12"] and s2.get("replaces_turn") is True and open7 == ["A10", "A12"], [s2.get("handles"), open7])
    st = rjson(os.path.join(DATA, "mcp", SID, "7.json"), {})
    check("state file records the handles", st.get("handles") == ["A10", "A12"], st)
    r = c.call("resolve_asks", {"handles": ["A10"]})
    sc = r.get("structuredContent") or {}
    a10 = next((it for it in rjson(os.path.join(DATA, "snapshot.json"), {}).get("items", []) if it.get("handle") == "A10"), {})
    ev = fw.acts[-1] if fw.acts else {}
    check("resolve with a writer: applied, said without the pending line; A10 resolved by the agent",
          sc.get("resolved") == ["A10"] and sc.get("writer") == "applied" and "has not applied" not in text(r)
          and a10.get("status") == "resolved" and a10.get("resolvedBy") == "agent", [sc, a10])
    check("resolve: no note, no note key; the turn is the map's (7)", ev.get("turn") == 7 and "note" not in ev
          and ev.get("handle") == "A10" and ev.get("actor") == "agent", ev)
    r = c.call("resolve_asks", {"handles": ["A10"]})
    sc = r.get("structuredContent") or {}
    check("resolve the same handle again: already closed, no event", sc.get("already_closed") == ["A10"]
          and sc.get("resolved") == [] and len(fw.acts) == 1, sc)
    fw.stop = True
    fw.join(2)
    check("server 2 exits 0", c.close() == 0)
    take_events()

    print("== identity")
    wjson(os.path.join(DATA, "store.json"), {"v": 1, "sessions": {"herdr:t42": {"sessionId": "herdr:t42", "turn": 7}}})
    c = Client(terminal="t42")
    c.init()
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "confirm", "text": "Confirm the deploy window"}]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    evs = take_events()
    check("no map entry: the synthetic session herdr:t42 at the store's turn 7, said in the result",
          not r.get("isError") and sc.get("session_id") == "herdr:t42" and sc.get("synthetic") is True and sc.get("turn") == 7
          and "herdr:t42" in tx and "no ledgr hook has mapped terminal t42" in tx, [sc, tx])
    check("no map entry: the event goes to herdr:t42 on terminal t42, marked synthetic",
          len(evs) == 1 and evs[0]["session_id"] == "herdr:t42" and evs[0]["terminal"] == "t42" and evs[0]["turn"] == 7
          and evs[0].get("synthetic") is True and "agent" not in evs[0], evs)
    set_map("t42", SID2, 2)
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "confirm", "text": "Confirm the deploy window"}]})
    sc = r.get("structuredContent") or {}
    evs = take_events()
    check("the hook maps the terminal later: the next call resolves the real session (no restart)",
          sc.get("session_id") == SID2 and sc.get("synthetic") is False and sc.get("turn") == 2 and "note" not in sc
          and len(evs) == 1 and evs[0]["session_id"] == SID2, sc)
    c.close()

    sleeper = subprocess.Popen(["/bin/sleep", "30"])
    try:
        set_map("t77", SID2, 3, owner_pid=sleeper.pid, owner_comm="sleep")
        c = Client(terminal="t77")
        c.init()
        r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Anything"}]})
        check("another live agent process owns the terminal: refused, nothing written",
              r.get("isError") is True and "another agent process" in text(r) and not spool_files(), text(r))
        c.close()
    finally:
        sleeper.kill()
        sleeper.wait()
    set_map("t76", SID2, 3)                      # owned by this test process
    c = Client(terminal="t76", child=True)
    c.init()
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Anything"}]})
    check("a child agent (the owner's program again between the owner and us): refused, nothing written",
          r.get("isError") is True and "another agent process" in text(r) and not spool_files(), text(r))
    c.close()
    dead = subprocess.Popen(["/usr/bin/true"])
    dead.wait()
    set_map("t78", SID2, 3, owner_pid=dead.pid, owner_comm="claude")
    c = Client(terminal="t78")
    c.init()
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Anything"}]})
    sc = r.get("structuredContent") or {}
    check("the map's agent process is gone: the synthetic session, with the reason",
          sc.get("session_id") == "herdr:t78" and "is gone" in sc.get("note", ""), sc)
    take_events()
    c.close()
    set_map("t79", SID2, 3, owner_pid=0, config_dir="/Users/someone/.claude-work")
    c = Client(terminal="t79", extra={"CLAUDE_CONFIG_DIR": os.path.join(ROOT, ".claude-alt")})
    c.init()
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Anything"}]})
    sc = r.get("structuredContent") or {}
    check("no owner pid to compare and another CLAUDE_CONFIG_DIR: the synthetic session, with the reason",
          sc.get("session_id") == "herdr:t79" and "another config folder" in sc.get("note", ""), sc)
    take_events()
    c.close()

    c = Client(extra={"LEDGR_INNER": "1"})
    r = c.init()["result"]
    tl = c.req("tools/list")["result"]["tools"]
    m = c.req("tools/call", {"name": "declare_asks", "arguments": {"items": []}})
    check("LEDGR_INNER (a process a ledgr hook started): no tools, no instructions, calls refused",
          tl == [] and "instructions" not in r and m.get("error", {}).get("code") == -32602, [tl, m])
    c.close()
    c = Client(terminal=None)
    r = c.init()["result"]
    tl = c.req("tools/list")["result"]["tools"]
    check("no HC_TERMINAL_ID and no LEDGR_TERMINAL: no tools (nothing to attribute asks to)", tl == [] and "instructions" not in r, tl)
    c.close()
    c = Client(terminal=None, extra={"LEDGR_TERMINAL": "iterm-2"})
    c.init()
    tl = c.req("tools/list")["result"]["tools"]
    r = c.call("open_asks")
    check("LEDGR_TERMINAL stands in for HC_TERMINAL_ID", len(tl) == 4 and "herdr:iterm-2" in json.dumps(r.get("structuredContent")), r)
    c.close()

    print("== disabled spaces (spaces.disabled, the record's ledgr_off)")
    take_events()
    cfgp, recp = os.path.join(DATA, "config.json"), os.path.join(DATA, "sessions", SID + ".json")
    logp = os.path.join(DATA, "log", "mcp.log")
    off_re = re.compile(r"^\d+ off (declare_asks|resolve_asks|open_asks|parked_questions) ")

    def off_lines():
        return [ln for ln in (open(logp).read().splitlines() if os.path.exists(logp) else []) if off_re.match(ln)]

    def no_turn_file(sid, turn):
        return not os.path.exists(os.path.join(DATA, "mcp", sid.replace(":", "_"), f"{turn}.json"))

    def off_round(c, why, sid, turn, space, by):
        """All four tools in a session where ledgr is off: ok, off, empty, nothing written, four log lines."""
        n0 = len(off_lines())
        rd = c.call("declare_asks", {"items": [{"level": "blocking", "kind": "decide", "text": "Pick the region"}]})
        rr = c.call("resolve_asks", {"handles": ["A5"]})      # A5 is an open ask of SID
        ro = c.call("open_asks")
        rp = c.call("parked_questions")
        sd, sr, so, sp = (x.get("structuredContent") or {} for x in (rd, rr, ro, rp))
        check(f"off ({why}): declare_asks is ok and off, declares nothing, no pointer, the note, its other fields empty",
              not rd.get("isError") and sd.get("ok") is True and sd.get("off") is True and sd.get("pointer") is None
              and sd.get("items") == [] and sd.get("handles") == [] and sd.get("repeats") == [] and sd.get("rejected") == []
              and sd.get("event_id") is None and sd.get("call") == 0 and sd.get("session_id") == sid and sd.get("space") == space
              and sd.get("note") == "ledgr is off in this space: declared nothing; list what you need from the user in your reply"
              and "end it without a pointer line" in text(rd), [sd, text(rd)])
        check(f"off ({why}): resolve_asks closes nothing (not even the open A5), ok and off, with a note",
              not rr.get("isError") and sr.get("ok") is True and sr.get("off") is True and sr.get("resolved") == []
              and sr.get("unknown") == [] and sr.get("already_closed") == [] and sr.get("event_ids") == []
              and sr.get("note", "").startswith("ledgr is off in this space: closed nothing"), sr)
        check(f"off ({why}): open_asks and parked_questions are empty, ok and off",
              not ro.get("isError") and not rp.get("isError") and so.get("ok") is True and so.get("off") is True
              and so.get("open") == [] and so.get("dismissed") == [] and sp.get("ok") is True and sp.get("off") is True
              and sp.get("questions") == [] and "A5" not in text(ro), [so, sp])
        new = off_lines()[n0:]
        check(f"off ({why}): nothing written (no spool event, no mcp/<session>/{turn}.json), one off line per call (by={by})",
              not spool_files() and no_turn_file(sid, turn) and len(new) == 4
              and all(f" {sid} turn={turn} space={space} by={by}: nothing written" in ln for ln in new), [spool_files(), new])

    wjson(cfgp, {"spaces": {"disabled": ["spOFF"]}})
    set_map("t60", SID, 20, space="spON")
    wjson(recp, {"session_id": SID, "turn": 20, "space": None, "ledgr_off": True})
    c = Client(terminal="t60")
    r = c.init()["result"]
    check("instructions: an answer with off: true means list what the user must do in the reply",
          "answers off: true" in r.get("instructions", "")
          and "list what you need from the user in your reply instead" in r.get("instructions", ""), r.get("instructions"))
    off_round(c, "the record's ledgr_off, no space", SID, 20, None, "ledgr_off")
    wjson(recp, {"session_id": SID, "turn": 20, "space": "spOFF"})
    off_round(c, "the record's space in spaces.disabled, ledgr_off absent", SID, 20, "spOFF", "spaces.disabled")
    wjson(recp, {"session_id": SID, "turn": 20})
    set_map("t60", SID, 20, space="spOFF")
    off_round(c, "no space in the record: the map entry's, in spaces.disabled", SID, 20, "spOFF", "spaces.disabled")

    set_map("t60", SID, 20, space="spON")
    wjson(recp, {"session_id": SID, "turn": 20, "space": "spON", "ledgr_off": False})
    n0 = len(off_lines())
    rd = c.call("declare_asks", {"items": [{"level": "blocking", "kind": "decide", "text": "Pick the region"}]})
    sd = rd.get("structuredContent") or {}
    evs = take_events()
    check("on (space not disabled, ledgr_off false; the same server): declare_asks records as before",
          not rd.get("isError") and "off" not in sd and sd.get("pointer") == "ledgr: 1 item for you, 1 blocking"
          and len(evs) == 1 and evs[0].get("type") == "asks" and evs[0].get("turn") == 20 and not no_turn_file(SID, 20), [sd, evs])
    ro, rr = c.call("open_asks"), c.call("resolve_asks", {"handles": ["A99"]})
    so, sr = ro.get("structuredContent") or {}, rr.get("structuredContent") or {}
    check("on: open_asks lists the open A5, resolve_asks reports as before, no off key, no off log line",
          "off" not in so and "A5" in [x["handle"] for x in so.get("open", [])] and "off" not in sr
          and sr.get("unknown") == ["A99"] and len(off_lines()) == n0, [so, sr])
    c.close()

    fake_hc = os.path.join(ROOT, "fake-hc")
    with open(fake_hc, "w") as f:
        f.write("#!/bin/sh\nprintf '%s\\n' '{\"labels\": {\"herdr.space\": \"spOFF\"}}'\n")
    os.chmod(fake_hc, 0o755)
    c = Client(terminal="t61", extra={"LEDGR_HC": fake_hc})
    c.init()
    off_round(c, "a synthetic session, its space from a live hc get", "herdr:t61", 0, "spOFF", "spaces.disabled")
    wjson(cfgp, {"spaces": {"disabled": []}})
    rd = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Anything"}]})
    evs = take_events()
    check("on again (spaces.disabled emptied): the synthetic session declares as before",
          "off" not in (rd.get("structuredContent") or {}) and len(evs) == 1 and evs[0]["session_id"] == "herdr:t61", evs)
    c.close()
    for p in (cfgp, recp):
        os.unlink(p)

    print("== hygiene")
    bad = []
    for s in servers:
        for line in s.lines:
            try:
                m = json.loads(line)
                ms = m if isinstance(m, list) else [m]
                if not all(isinstance(x, dict) and x.get("jsonrpc") == "2.0" for x in ms):
                    bad.append(line)
            except Exception:
                bad.append(line)
    check(f"stdout: only JSON-RPC messages ({sum(len(s.lines) for s in servers)} lines from {len(servers)} servers)", not bad, bad[:3])
    check("every server exited", all(s.p.poll() is not None for s in servers))
    pyc = [os.path.join(dp, n) for dp, dn, fn in os.walk(BIN) for n in dn + fn if n == "__pycache__" or n.endswith(".pyc")]
    check("no bytecode in the mod folder (the server ran without -B)", not pyc, pyc)
    lg = open(os.path.join(DATA, "log", "mcp.log")).read() if os.path.exists(os.path.join(DATA, "log", "mcp.log")) else ""
    check("log: ledgr-data/log/mcp.log has start, declare, resolve and exit lines", " start pid=" in lg and " declare " in lg
          and " resolve " in lg and "resolved=['A5', 'A4']" in lg and " exit pid=" in lg)


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        fails += 1
    finally:
        for s in servers:
            if s.p.poll() is None:
                s.p.kill()
        err = os.path.join(ROOT, "server.err")
        if fails and os.path.exists(err) and os.path.getsize(err):
            print("server stderr:\n" + open(err).read()[-2000:])
        shutil.rmtree(ROOT, ignore_errors=True)
    print(f"\n{'OK' if not fails else 'FAILED'}: mcp server, {checks} checks, {fails} failure(s)")
    sys.exit(1 if fails else 0)
