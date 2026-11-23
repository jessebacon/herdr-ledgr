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

    def call(self, name, args=None, meta=None, raw=False):
        """A tools/call. declare_asks requires a summary on every item (2026-11-23): unless `raw`, an item
        (an object) without a `summary` key is sent with one made from its text, so the sections written
        before the summary test what they tested; the summary's own section sends its items raw."""
        if name == "declare_asks" and not raw and isinstance(args, dict) and isinstance(args.get("items"), list):
            args = dict(args, items=[dict(it, summary=f"Summary: {it.get('text')}") if isinstance(it, dict) and "summary" not in it
                                     else it for it in args["items"]])
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


class ColdWriter(FakeWriter):
    """The writer's part of retention Phase 2 (docs: the contract's Thaw and Hold), on snapshot.json alone:
    before an event of a session snapshot.json lists as cold is applied, its file is read (ledgr_extract's
    own check) and its items join the snapshot's (the thaw), or, when it cannot be read, the spool file is
    copied under its own name to cold/held/<safe sid>/, the session's fault is set, and only then is the
    spool file removed (the hold). An act with no item resolves by handle (store.js on_act)."""

    def __init__(self, stale=False):
        super().__init__()
        self.held = []
        # stale: a thaw whose snapshot.json write failed (writer.js applyPass tries it twice): the event is applied
        # and its spool file goes, but snapshot.json keeps naming the session cold and gains nothing.
        self.stale = stale

    def run(self):
        import ledgr_extract as X
        while not self.stop:
            for p in spool_files():
                ev = rjson(p)
                if not isinstance(ev, dict):
                    continue
                snap = rjson(os.path.join(DATA, "snapshot.json"), {"v": 1, "items": []})
                sid = ev.get("session_id")
                ent = (snap.get("cold") or {}).get(sid)
                if ent:
                    # A faulted session is not read again until its retry is due (COLD_RETRY_MS): held.
                    rec, why = (None, ent["fault"]) if ent.get("fault") else X.cold_record(sid, ent.get("file"), DATA)
                    if why:
                        d = os.path.join(DATA, "cold", "held", X.safe_name(sid))
                        os.makedirs(d, exist_ok=True)
                        shutil.copyfile(p, os.path.join(d, os.path.basename(p)))
                        ent["fault"] = ent.get("fault") or why
                        wjson(os.path.join(DATA, "snapshot.json"), snap)
                        self.held.append(ev)
                        os.unlink(p)
                        continue
                    if self.stale:
                        self.acts.append(ev)
                        os.unlink(p)
                        continue
                    now = int(time.time() * 1000)
                    snap["items"] += [c for c in (X.snapshot_copy(it, now) for it in rec["items"]) if c]
                    del snap["cold"][sid]
                    wjson(os.path.join(DATA, "snapshot.json"), snap)
                if ev.get("type") == "asks" and ev.get("source") == "tool":
                    self.apply(ev)
                elif ev.get("type") == "act" and ev.get("action") == "resolve":
                    self.acts.append(ev)
                    if ev.get("item") is None:
                        snap = rjson(os.path.join(DATA, "snapshot.json"), {})
                        it = next((x for x in snap.get("items", []) if x.get("handle") == ev.get("handle")
                                   and x["anchor"]["sessionId"] == ev["session_id"]), None)
                        ev = dict(ev, item=it and it["id"])
                    self.resolve(ev)
                try:
                    os.unlink(p)
                except OSError:
                    pass
            time.sleep(0.02)


def cold_section():
    """Retention Phase 2: sessions moved out of store.json into ledgr-data/cold/<file> (snapshot.json's
    `cold` map). The library (session_items, cold_record, snapshot_copy, recorded_asks, tool_asks) in
    process, then the server over stdio: a cold session answers as a warm one; one whose file cannot be
    read (the writer's fault, or this server's read) keeps what it is sent and says so."""
    import ledgr_extract as X
    now = int(time.time() * 1000)
    day = 86400_000
    SC = "33333333-4444-5555-6666-777777777777"
    LIB = os.path.join(ROOT, "lib-data")
    os.makedirs(os.path.join(LIB, "cold"), exist_ok=True)
    snap_p = os.path.join(LIB, "snapshot.json")

    def raw(h, status, direction="agent_to_human", sid=SC, **kw):
        it = {"id": "rq_c" + h.lower(), "handle": h, "direction": direction, "text": f"Cold item {h}", "status": status,
              "level": "needed", "kind": "decide", "anchor": {"sessionId": sid, "turn": 3, "hash": "abc"},
              "createdTurn": 3, "createdAt": now - 9 * day, "updatedAt": now - 9 * day}
        it.update(kw)
        return it

    long_q, q200, emoji_q = "x" * 250, "y" * 200, "\U0001F600" * 150     # 150 emoji: 300 UTF-16 units
    items = [raw("A1", "open", draft="half an answer", pins=["pn_1"], summary="Answer serif or sans.\n\n- serif: the print look"),
             raw("A2", "answered", answer="serif"),
             raw("A3", "resolved", resolvedAt=now - 8 * day),
             raw("A4", "dismissed", resolvedAt=now - 2 * day),
             raw("A5", "dismissed", resolvedAt=now - 10 * day),
             raw("A6", "deferred"),
             raw("Q1", "open", direction="human_to_agent"),
             raw("Q2", "rejoin_pending", direction="human_to_agent"),
             raw("A7", None),
             raw("A8", "dismissed", updatedAt=None),
             raw("A9", "dismissed", resolvedAt=str(now - 2 * day)),
             raw("A10", "open"), raw("A11", "open"), raw("A12", "open")]
    items[-3]["anchor"]["quote"] = long_q
    items[-2]["anchor"]["quote"] = q200
    items[-1]["anchor"]["quote"] = emoji_q
    items[-1].pop("updatedAt")
    # What store.js snapshot() writes for each (written out case by case, not computed by the code under test):
    # open, answered, deferred, rejoin_pending, and dismissed within 7 days (resolvedAt, else updatedAt, as a
    # number: a numeric string counts, no time is 0); sessionId from the anchor; a quote over 200 UTF-16 units
    # dropped; no draft, no pins, no summary (2026-11-23: the snapshot stays small).
    keep = {"A1", "A2", "A4", "A6", "Q1", "Q2", "A9", "A10", "A11", "A12"}
    expected = []
    for it in items:
        if it["handle"] not in keep:
            continue
        c = json.loads(json.dumps(it))
        c["sessionId"] = SC
        c.pop("draft", None)
        c.pop("pins", None)
        c.pop("summary", None)
        if c["handle"] in ("A10", "A12"):
            del c["anchor"]["quote"]
        expected.append(c)
    other = raw("A1", "open", sid=SID2)
    name = f"{X.safe_name(SC)}.{now - 9 * day}-ab12cd.json"
    record = {"ledgr": "ledgr-cold", "v": 1, "sessionId": SC, "at": now - 9 * day, "session": {"sessionId": SC},
              "items": items, "turns": {"3": {"stopAt": now - 9 * day}}, "n": {"q": 1}}
    wjson(os.path.join(LIB, "cold", name), record)
    cold_snap = {"v": 1, "updatedAt": now, "items": [X.snapshot_copy(other, now)], "cold": {SC: {"file": name, "fault": None}}}
    warm_snap = {"v": 1, "updatedAt": now, "items": [X.snapshot_copy(other, now)] + expected}
    wjson(snap_p, cold_snap)
    got, cold = X.session_items(SC, snap_p, now)
    check("session_items, cold: the file's items filtered as store.js snapshot() filters, each as the snapshot writes it",
          got == expected, [[g.get("handle") for g in got], [e["handle"] for e in expected],
                            next((g for g, e in zip(got, expected) if g != e), None)])
    check("session_items, cold: cold names the file, no fault, no error", cold == {"file": name, "fault": None, "error": None}, cold)
    check("session_items: another session's items from the snapshot, warm (cold None)",
          X.session_items(SID2, snap_p, now) == ([X.snapshot_copy(other, now)], None))
    check("session_items with no session: every warm item of the snapshot, as before", X.session_items(None, snap_p, now)[0] == cold_snap["items"])
    rc = X.recorded_asks(SC, snap_p, now)
    wjson(snap_p, warm_snap)
    rw = X.recorded_asks(SC, snap_p, now)
    check("recorded_asks: the same open, dismissed and known handles warm and cold",
          rc == rw and [h for h, _ in rw[0]] == ["A1", "A2", "A6", "A10", "A11", "A12"] and [h for h, _ in rw[1]] == ["A4", "A9"], [rc, rw])
    check("session_items, warm: the snapshot's items, cold None", X.session_items(SC, snap_p, now) == (expected, None))
    decl = {"asks": [{"text": "Cold item A1", "level": "blocking", "kind": "decide", "quote": "Pick it."},
                     {"text": "Something new", "level": "needed", "kind": "do", "repeat_of_handle": "A4"}]}
    tw = X.tool_asks(decl, SC, 5, "Pick it. More.", snap_p)
    wjson(snap_p, cold_snap)
    tc = X.tool_asks(decl, SC, 5, "Pick it. More.", snap_p)
    check("tool_asks (the Stop hook's check of a declaration): the same warm and cold, repeats found in the file",
          tw == tc and tc[1].get("repeat_of_handle") == "A4", [tw, tc])

    # A "mixed" session (an older build put an item beside the stub): the snapshot's copy wins, first.
    mixed = dict(X.snapshot_copy(items[0], now), text="Changed in the store")
    wjson(snap_p, dict(cold_snap, items=cold_snap["items"] + [mixed]))
    got, _ = X.session_items(SC, snap_p, now)
    check("session_items, mixed: the snapshot's copy of an id wins and comes first, the file gives the rest",
          got[0] == mixed and [g["handle"] for g in got] == ["A1"] + [e["handle"] for e in expected[1:]], [g["handle"] for g in got])
    # The writer's fault rides on the cold entry; a file readable here is still read.
    wjson(snap_p, dict(cold_snap, cold={SC: {"file": name, "fault": "the file is missing"}}))
    got, cold = X.session_items(SC, snap_p, now)
    check("session_items, faulted but readable here: its items, the fault kept, no error",
          got == expected and cold == {"file": name, "fault": "the file is missing", "error": None}, cold)

    def bad(fname, rec=None, text=None, why=None, label=None):
        """An unreadable cold file: no items, cold.error in the writer's words (writer.js readCold, store.js
        coldRecordError); `why` ending in "(" is a prefix (the parser's own message follows)."""
        if rec is not None or text is not None:
            p = os.path.join(LIB, "cold", fname)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(text if text is not None else json.dumps(rec))
        wjson(snap_p, dict(cold_snap, cold={SC: {"file": fname, "fault": None}}))
        got, cold = X.session_items(SC, snap_p, now)
        err = (cold or {}).get("error") or ""
        check(f"session_items, {label}: no items, cold.error {why!r}",
              got == [] and cold and cold["file"] == fname and cold["fault"] is None
              and (err.startswith(why) if why.endswith("(") else err == why), [got, cold])

    stem = f"{X.safe_name(SC)}.{now}"
    n = lambda k: f"{stem}-zz000{k}.json"  # noqa: E731
    bad(n(0), why=f"cold/{n(0)} is missing", label="a missing file")
    bad(n(1), text="{not json", why=f"cold/{n(1)} does not parse (", label="a file that is not JSON")
    bad(n(2), rec=dict(record, sessionId=SID2), why=f"cold/{n(2)}: the file is session {SID2}'s, not {SC}", label="another session's record")
    bad(n(3), rec=dict(record, ledgr="ledgr-store"), why=f'cold/{n(3)}: not a cold file (ledgr "ledgr-store")', label="another format")
    bad(n(4), rec=dict(record, v=2), why=f"cold/{n(4)}: cold file version 2, not 1", label="version 2")
    bad(n(5), rec=dict(record, v=True), why=f"cold/{n(5)}: cold file version true, not 1", label="version true")
    bad(n(6), rec=dict(record, items={"a": 1}), why=f"cold/{n(6)}: the file holds no item list", label="no item list")
    bad(n(7), rec=dict(record, items=items + [raw("A20", "open", sid=SID2)]), why=f"cold/{n(7)}: item rq_ca20 in the file is another session's",
        label="an item of another session")
    bad(n(8), rec=dict(record, items=items + [{"text": "no id"}]), why=f"cold/{n(8)}: item {len(items) + 1} of the file has no id", label="an item with no id")
    bad(n(9), rec=dict(record, turns=[1]), why=f"cold/{n(9)}: the file's turn records are not a map", label="turn records not a map")
    bad("../snapshot.json", why='not a cold file name: "../snapshot.json"', label="a name with a folder")
    bad(f"{stem}-ZZ0008.json", rec=record, why=f'not a cold file name: "{stem}-ZZ0008.json"', label="a name off the pattern")
    wjson(os.path.join(LIB, "cold", f"{X.safe_name(SID2)}.{now}-zz0010.json"), record)
    wjson(snap_p, dict(cold_snap, cold={SC: {"file": f"{X.safe_name(SID2)}.{now}-zz0010.json", "fault": None}}))
    check("session_items: a file whose name is not the session's but holds its record reads (the writer checks the record, not the name)",
          X.session_items(SC, snap_p, now)[0] == expected)
    # The snapshot moved on between two reads (a thaw saved meanwhile): read once more, then the new one wins.
    reads = [dict(cold_snap, cold={SC: {"file": n(0), "fault": None}}), warm_snap]
    real = X.C.read_json
    X.C.read_json = lambda p, d=None: reads.pop(0) if p == snap_p and reads else real(p, d)
    try:
        got, cold = X.session_items(SC, snap_p, now)
    finally:
        X.C.read_json = real
    check("session_items: a file gone because the snapshot moved on (thawed) reads snapshot.json again: warm",
          got == expected and cold is None, [got, cold])

    # ---- the server over stdio ----
    print("== cold sessions: the server")
    take_events()
    cold_dir = os.path.join(DATA, "cold")
    os.makedirs(cold_dir, exist_ok=True)
    snap_path = os.path.join(DATA, "snapshot.json")
    saved_snap = rjson(snap_path, {"v": 1, "items": []})
    saved_store = rjson(os.path.join(DATA, "store.json"))
    if os.path.exists(os.path.join(DATA, "store.json")):
        os.unlink(os.path.join(DATA, "store.json"))
    cname = f"{X.safe_name(SC)}.{now - 9 * day}-ab12cd.json"
    wjson(os.path.join(cold_dir, cname), record)
    base_items = [it for it in saved_snap.get("items", []) if X.session_of(it) != SC]

    def put(cold_map=None, extra=()):
        s = {"v": 1, "updatedAt": now, "items": base_items + list(extra)}
        if cold_map is not None:
            s["cold"] = cold_map
        wjson(snap_path, s)

    set_map("t50", SC, 12)
    c = Client(terminal="t50", wait_ms=2500)
    c.init()
    put(extra=expected)
    ow = c.call("open_asks")
    put({SC: {"file": cname, "fault": None}})
    oc = c.call("open_asks")
    check("open_asks, cold: the same result as warm (read from the file, no wait, no cold key)",
          ow.get("structuredContent") == oc.get("structuredContent") and text(ow) == text(oc) and "cold" not in oc["structuredContent"]
          and [x["handle"] for x in oc["structuredContent"]["open"]] == ["A1", "A2", "A6", "A10", "A11", "A12"], [text(ow), text(oc)])
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "decide", "text": "cold item a1."}]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    evs = take_events()
    check("declare_asks, cold and readable, no writer: a repeat of A1 found in the file, its event sent, no cold lines",
          not r.get("isError") and sc.get("ok") and sc.get("repeats") == [{"item": 1, "of": "A1", "status": "open", "match": "text"}]
          and "cold" not in sc and "cannot read" not in tx and len(evs) == 1 and evs[0]["asks"][0]["repeat_of"] == "rq_ca1", [sc, tx])
    r = c.call("resolve_asks", {"handles": ["A2", "A3", "A99"]})
    sc = r.get("structuredContent") or {}
    evs = take_events()
    check("resolve_asks, cold and readable: A2 (answered, in the file) closed by its id; A3 resolved is unknown (the snapshot has no closed item), A99 unknown",
          sc.get("resolved") == ["A2"] and sc.get("unknown") == ["A3", "A99"] and "cold" not in sc and len(evs) == 1
          and evs[0]["item"] == "rq_ca2" and evs[0]["handle"] == "A2", [sc, evs])
    c.close()

    print("== cold sessions: thawed by the writer")
    put({SC: {"file": cname, "fault": None}})
    cw = ColdWriter()
    cw.start()
    c = Client(terminal="t50", wait_ms=3000)
    c.init()
    t0 = time.monotonic()
    r = c.call("declare_asks", {"items": [{"level": "blocking", "kind": "do", "text": "Thaw and add this"}]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("declare_asks, cold, the writer thaws: a handle at once (A13 after the file's A12), applied, no cold lines",
          sc.get("handles") == ["A13"] and sc.get("writer") == "applied" and "cannot read" not in tx and "cold" not in sc
          and time.monotonic() - t0 < 2.5, [sc, tx])
    snap = rjson(snap_path, {})
    check("...and the snapshot holds the session warm (the fake writer's thaw)", SC not in (snap.get("cold") or {})
          and any(it.get("handle") == "A1" and X.session_of(it) == SC for it in snap.get("items", [])))
    r = c.call("resolve_asks", {"handles": ["A1"]})
    sc = r.get("structuredContent") or {}
    check("resolve_asks after the thaw: applied", sc.get("resolved") == ["A1"] and sc.get("writer") == "applied", sc)

    print("== cold sessions: a file the writer cannot read (faulted)")
    lost = f"{X.safe_name(SC)}.{now - 9 * day}-lost00.json"
    missing = f"cold/{lost} is missing"                        # the writer's words (writer.js readCold), and ours
    put({SC: {"file": lost, "fault": missing}})
    held_dir = os.path.join(cold_dir, "held", X.safe_name(SC))
    t0 = time.monotonic()
    r = c.call("declare_asks", {"items": [{"level": "blocking", "kind": "decide", "text": "Pick the cold region"},
                                          {"level": "needed", "kind": "do", "text": "Cold item A1"}]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    held = sorted(os.listdir(held_dir)) if os.path.isdir(held_dir) else []
    check("declare_asks, faulted: ok and not an error (a retry changes nothing), writer held, ended as soon as it was held",
          sc.get("ok") is True and not r.get("isError") and sc.get("writer") == "held" and sc.get("handles") == [None, None]
          and time.monotonic() - t0 < 2.0 and "writer_status" not in sc, [sc, time.monotonic() - t0])
    check("declare_asks, faulted: the event is held under its own spool name (cold/held/<session>/), none left in the spool",
          len(held) == 1 and "-asks-" in held[0] and rjson(os.path.join(held_dir, held[0]), {}).get("id") == sc.get("event_id")
          and not spool_files(), [held, spool_files()])
    check("declare_asks, faulted: cold in the data (file, the writer's fault, and the file missing here too)",
          sc.get("cold") == {"file": lost, "fault": missing, "error": missing}, sc.get("cold"))
    check("declare_asks, faulted: the two lines, then the pointer as when the writer stalls; no pending words",
          f"ledgr cannot read this session's earlier items (cold/{lost} is missing); what you sent is kept and "
          "applied once that is fixed (the user's panel offers Try again)." in tx
          and "Tell the user in your reply, and list these items there." in tx and "Handles are pending" not in tx
          and "do not list these items in prose" not in tx
          and tx.splitlines()[-2:] == ["Then end your reply with this line:", "ledgr: 2 items for you, 1 blocking"], tx)
    st = rjson(os.path.join(DATA, "mcp", SC, "12.json"), {})
    check("declare_asks, faulted: the turn's declaration is still kept (mcp/<session>/<turn>.json), for the Stop hook",
          [a["text"] for a in st.get("asks") or []] == ["Pick the cold region", "Cold item A1"], st)
    r = c.call("resolve_asks", {"handles": ["A1", "A4", "Q1"]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    held = sorted(n for n in os.listdir(held_dir) if "-act-" in n)
    hev = [rjson(os.path.join(held_dir, n), {}) for n in held]
    check("resolve_asks, unreadable: A1 and A4 sent by handle (item null), held; Q1 a question; ok, writer held",
          sc.get("ok") is True and not r.get("isError") and sc.get("resolved") == ["A1", "A4"] and sc.get("unchecked") == ["A1", "A4"]
          and sc.get("unknown") == ["Q1"] and sc.get("writer") == "held" and len(hev) == 2
          and all(e.get("item") is None and e.get("actor") == "agent" and e.get("turn") == 12 for e in hev)
          and sorted(e.get("handle") for e in hev) == ["A1", "A4"], [sc, hev])
    check("resolve_asks, unreadable: the words (kept, why, Try again, tell the user and list the asks closed); cold in the data",
          "ledgr kept the closing of A1, A4 (turn 12): it is applied once ledgr can read this session's earlier items." in tx
          and f"ledgr cannot read this session's earlier items (cold/{lost} is missing); what you sent is kept" in tx
          and "Tell the user in your reply, and list there the asks you closed." in tx and "ledgr closed" not in tx
          and "has not applied" not in tx and sc.get("cold", {}).get("file") == lost, tx)
    r = c.call("open_asks")
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("open_asks, unreadable: says it cannot list the earlier asks (not \"no open asks\"), cold in the data, ok",
          sc.get("ok") is True and sc.get("open") == [] and sc.get("cold", {}).get("error") == missing
          and "No open or recently dismissed asks" not in tx and f"(cold/{lost} is missing)" in tx
          and "its earlier asks are not listed here, and what you declare or close is kept and applied once that is fixed" in tx, [sc, tx])
    r = c.call("parked_questions")
    check("parked_questions, unreadable: said, cold in the data", "cold" in (r.get("structuredContent") or {})
          and "its earlier questions are not listed here" in text(r), text(r))
    # Faulted, but the file reads here: a repeat of a file ask finds its handle at once, yet the session is still
    # cold after the writer took the event: held (the writer never applies to a cold session), said so.
    put({SC: {"file": cname, "fault": "not valid JSON"}})
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "decide", "text": "Cold item A1"}]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("declare_asks, faulted but readable here, a repeat of A1: the handle from the file, yet held and said so",
          sc.get("handles") == ["A1"] and sc.get("writer") == "held" and sc.get("cold", {}).get("fault") == "not valid JSON"
          and f"(cold/{cname}: not valid JSON); what you sent is kept" in tx and "- A1 needed/decide" in tx, [sc, tx])
    cw.stop = True
    cw.join(2)
    for n in os.listdir(held_dir):
        os.unlink(os.path.join(held_dir, n))

    # Integration (2026-11-19): the writer thawed and applied, but its snapshot.json write failed (twice), so the
    # snapshot still names the session cold, no fault. Gone from the spool and not in cold/held/: applied, never
    # called held, and no "cannot read" line (the server claims no more than it knows; its handles may read as
    # pending). The same for resolve_asks.
    print("== cold sessions: applied, snapshot.json stale")
    put({SC: {"file": cname, "fault": None}})
    sw = ColdWriter(stale=True)
    sw.start()
    c2 = Client(terminal="t50", wait_ms=800)
    c2.init()
    r = c2.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Applied behind a stale snapshot"}]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("declare_asks, applied while snapshot.json still names the session cold: writer applied, not held, no cold lines",
          sc.get("ok") is True and sc.get("writer") == "applied" and "cold" not in sc and "cannot read" not in tx
          and not spool_files() and (not os.path.isdir(held_dir) or not os.listdir(held_dir)), [sc, tx])
    r = c2.call("resolve_asks", {"handles": ["A2"]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("resolve_asks, applied behind a stale snapshot: closed, not kept, no cold lines",
          sc.get("resolved") == ["A2"] and sc.get("writer") == "applied" and "cold" not in sc and "cannot read" not in tx
          and "ledgr closed A2" in tx, [sc, tx])
    sw.stop = True
    sw.join(2)
    c2.close()

    print("== cold sessions: no writer running")
    put({SC: {"file": cname, "fault": "not valid JSON"}})
    r = c.call("open_asks")
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("open_asks, faulted but readable here: listed from the file, with a note; cold in the data",
          [x["handle"] for x in sc.get("open", [])] == ["A1", "A2", "A6", "A10", "A11", "A12"] and sc.get("cold", {}).get("fault") == "not valid JSON"
          and f"Note: ledgr's writer cannot read this session's earlier items (cold/{cname}: not valid JSON); they are listed from that file" in tx, tx)
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Kept while nobody writes"}]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    evs = take_events()
    check("declare_asks, faulted, no writer: the event waits in the spool (timeout), the two lines all the same, ok",
          sc.get("ok") is True and sc.get("writer") == "timeout" and len(evs) == 1 and sc.get("cold", {}).get("fault") == "not valid JSON"
          and "what you sent is kept and applied once that is fixed" in tx and "Handles are pending" not in tx, [sc, tx])
    put({SC: {"file": lost, "fault": None}})
    r = c.call("resolve_asks", {"handles": ["A2"]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    evs = take_events()
    check("resolve_asks, unreadable here (the writer has not tried yet), no writer: sent by handle, kept, the two lines",
          sc.get("resolved") == ["A2"] and sc.get("unchecked") == ["A2"] and sc.get("writer") == "timeout"
          and len(evs) == 1 and evs[0]["item"] is None and evs[0]["handle"] == "A2"
          and sc.get("cold") == {"file": lost, "fault": None, "error": missing}
          and f"(cold/{lost} is missing)" in tx, [sc, tx])
    c.close()
    put()
    wjson(snap_path, saved_snap)
    if saved_store is not None:
        wjson(os.path.join(DATA, "store.json"), saved_store)
    shutil.rmtree(cold_dir, ignore_errors=True)
    take_events()


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
    check("instructions: only what only the user can give; a wait on the agent's own subagents is not an ask",
          "only the user can give (a decision that is theirs, something only they know or hold, an action or check you "
          "cannot make yourself, a review they asked for, that go-ahead)" in r.get("instructions", "")
          and "your own subagents" in r.get("instructions", "") and "\"I need\"" in r.get("instructions", ""),
          r.get("instructions"))
    ins = r.get("instructions", "")
    check("instructions (2026-11-23, review 10.1): ledgr cuts the back and forth, never hands work to the user; do all the "
          "task needs yourself, stop before a step the task needs that cannot be undone; a step beyond the task is an offer",
          "cut the back and forth and to clear what blocks you; it is not a way to hand work to the user" in ins
          and "do all the task needs that you can do yourself: look it up, run it, test it" in ins
          and "make it and say what you chose. Stop before a step the task needs that cannot be undone, and ask for a "
              "go-ahead." in ins
          and "Never declare work you could do yourself, and never ask the user to look up, verify or summarise what you can. "
              "A step beyond what you were asked is an offer: do not take it and do not declare it; a line of prose is enough." in ins
          and "find, check or summarise" not in ins and "such a step" not in ins, ins)
    check("instructions (2026-11-23): each item a summary that stands on its own, what it holds",
          "Give each item a summary that stands on its own: exactly what you need and in what form, what you have already "
          "done or ruled out, what you will do with each possible answer, the answer you recommend and why, and anything "
          "that cannot be undone." in ins, ins)
    check("instructions: under 2,048 characters (the cap a client may put on them)", len(ins) < 2048, len(ins))
    check("instructions: a writer that is not applying events, or a session's earlier items ledgr cannot read: say so "
          "and list the items in the reply",
          "When a ledgr tool says its writer is not applying events, or that ledgr cannot read this session's earlier "
          "items, the user cannot see these items in ledgr yet: say so and list them in your reply as well."
          in r.get("instructions", ""), r.get("instructions"))
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
    check("declare_asks: items schema requires level, kind, text, summary; level enum blocking|needed; loads upfront",
          set(item["required"]) == {"level", "kind", "text", "summary"} and item["properties"]["level"]["enum"] == ["blocking", "needed"]
          and d.get("_meta", {}).get("anthropic/alwaysLoad") is True, d)
    sp = item["properties"].get("summary") or {}
    check("declare_asks: summary is a string with no maxLength (ledgr cuts a long one, a client must not refuse it), "
          "its description says what it holds",
          sp.get("type") == "string" and "maxLength" not in sp and sp.get("description", "").startswith("Required.")
          and "without rereading your reply: exactly what you need from them and in what form, what you have already done "
              "or ruled out, what you will do with each possible answer, the answer you recommend and why, and anything "
              "that cannot be undone." in sp.get("description", "")
          and "Markdown" in sp.get("description", "") and "1,000 characters" in sp.get("description", ""), sp)
    check("descriptions are short and carry the rules (blocking, needed, one line, summary, verbatim, options, pointer, no prose list)",
          len(d["description"]) < 1200 and all(len(t["description"]) < 700 for t in tl[1:]) and all(w in d["description"] for w in
                                                                ("blocking", "needed", "one line", "summary: required on every item", "verbatim", "only for a choice", "pointer line", "list nothing in prose")),
          [len(t["description"]) for t in tl])
    check("declare_asks: only what only the user can give, the go-ahead for a step the task needs that cannot be undone "
          "among it; a step beyond the task an offer; never work you could do yourself, a request to look up, verify or "
          "summarise what you can, or a wait on your own subagents",
          "what only the user can give" in d["description"] and "cut the back and forth" in d["description"]
          and "never to hand the user work: first do all the task needs that you can do yourself and make the choices that "
              "are yours; stop before a step the task needs that cannot be undone, and declare its go-ahead." in d["description"]
          and "never suggestions or offers (a step beyond what you were asked is one: do not take it or declare it, a line of "
              "prose at most)" in d["description"]
          and "go-ahead for that" not in d["description"] and "such a step" not in d["description"]
          and "never work you could do yourself, never a request to look up, verify or summarise what you can" in d["description"]
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

    print("== declare_asks: the summary (2026-11-23)")
    import ledgr_extract as X
    set_map("t99", SID, 40, prompt_id="p40")
    st40 = os.path.join(DATA, "mcp", SID, "40.json")
    logp = os.path.join(DATA, "log", "mcp.log")
    log0 = os.path.getsize(logp) if os.path.exists(logp) else 0
    r = c.call("declare_asks", {"items": [
        {"level": "blocking", "kind": "decide", "text": "Pick A", "summary": "Answer A or B."},
        {"level": "needed", "kind": "do", "text": "Do B"},
        {"level": "needed", "kind": "do", "text": "Do C", "summary": "  \n\t\r\n "},
        {"level": "needed", "kind": "do", "text": "Do D", "summary": 42},
        "just a string"]}, raw=True)
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("an item without a usable summary (missing, blank, not a string): the call is refused whole, isError",
          r.get("isError") is True and sc.get("ok") is False and sc.get("missing_summary") == [2, 3, 4]
          and sc.get("summary_not_string") == [4] and sc.get("earlier_items_stand") is False
          and sc.get("error") == "every item needs a summary", sc)
    check("...nothing written: no spool event, no state file, though item 1 was valid", not spool_files() and not os.path.exists(st40),
          [spool_files(), os.path.exists(st40)])
    check("...the text names the items (one whose summary is not a string said so, review 7.6) and says in two sentences "
          "what a summary holds, then what to do",
          tx == "ledgr recorded nothing: items 2 and 3 have no summary, and item 4's summary is not a string. Every item needs "
                "one, as text. A summary says exactly what you need from the user and in what form, so they can act on it "
                "without rereading your reply. It also says what you have already done or ruled out, what you will do with "
                "each possible answer, the answer you recommend and why, and anything that cannot be undone. Call "
                "declare_asks again with a summary on every item.", tx)
    check("...one mcp.log line", "refused, no summary on item(s) [2, 3, 4] (not a string: [4]); nothing written"
          in open(logp).read()[log0:])
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Do B"}]}, raw=True)
    check("one item without one: 'item 1 has no summary'", r.get("isError") is True
          and text(r).startswith("ledgr recorded nothing: item 1 has no summary. Every item needs one, as text.") and not spool_files(), text(r))
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Do B", "summary": None},
                                          {"level": "needed", "kind": "do", "text": "Do C", "summary": ["a list"]},
                                          {"level": "needed", "kind": "do", "text": "Do D", "summary": {"md": "x"}}]}, raw=True)
    check("review 7.6: null is no summary; two that are not strings are said together",
          r.get("isError") is True and text(r).startswith("ledgr recorded nothing: item 1 has no summary, and the summaries of "
                                                          "items 2 and 3 are not strings. Every item needs one, as text.")
          and (r.get("structuredContent") or {}).get("summary_not_string") == [2, 3] and not spool_files(), text(r))
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Do B", "summary": "\ufeff"},
                                          {"level": "needed", "kind": "do", "text": "Do C", "summary": "\ufeff\n \ufeff\n"}]}, raw=True)
    check("review 7.4: a summary of only U+FEFF (and U+FEFF lines) is no summary: refused, as the store would keep none",
          r.get("isError") is True and text(r).startswith("ledgr recorded nothing: items 1 and 2 have no summary.")
          and not spool_files() and not os.path.exists(st40), text(r))
    raw_md = "\r\n  Confirm these rows:\r\n\r\n\r\n- rename `Build-CI` to `ledgr-ci`\n  \n\t\n- delete `release/5.4` (cannot be undone)\r\n"
    long_s = ("A long summary. " * 80).strip()                    # 1,279 characters
    r = c.call("declare_asks", {"items": ["just a string",
                                          {"level": "blocking", "kind": "confirm", "text": "Confirm the pipeline changes",
                                           "summary": raw_md, "quote": "What I'll change, once you confirm."},
                                          {"level": "needed", "kind": "do", "text": "Read the long one", "summary": long_s}]}, raw=True)
    sc, tx = r.get("structuredContent") or {}, text(r)
    evs = take_events()
    ea = evs[0]["asks"] if len(evs) == 1 else [{}, {}]
    want_md = "Confirm these rows:\n\n- rename `Build-CI` to `ledgr-ci`\n\n- delete `release/5.4` (cannot be undone)"
    check("a string among the items is rejected as before, not named as missing a summary: the rest recorded",
          not r.get("isError") and [x["item"] for x in sc.get("items", [])] == [2, 3]
          and [x["reason"] for x in sc.get("rejected", [])] == ["not an object"], sc)
    check("the event's asks carry the summary: line breaks kept, CR LF read as LF, blank-line runs made one, outer space dropped, markdown kept",
          ea[0].get("summary") == want_md, ea[0])
    check("a summary over 1,000 characters: cut at 1,000 and recorded, with a note",
          ea[1].get("summary") == long_s[:1000].rstrip() and "Note: item 3: summary cut at 1,000 characters." in tx, [ea[1].get("summary"), tx])
    st = rjson(st40, {})
    check("the state file keeps each summary as the event sent it", st.get("asks") == ea and st["asks"][0].get("summary") == want_md, st.get("asks"))
    out = X.tool_asks(st, SID, 40, "Here is the table.\n\nWhat I'll change, once you confirm.")
    check("the Stop settle (ledgr_extract.tool_asks) carries each summary through unchanged",
          [a.get("summary") for a in out] == [want_md, long_s[:1000].rstrip()] and out[0].get("quote_verified") is True, out)
    older = [{k: v for k, v in a.items() if k != "summary"} for a in st["asks"][:1]]
    out = X.tool_asks({"asks": older}, SID, 40, "")
    check("...a declaration without one (an older server) settles with no summary key, so the writer keeps the item's own",
          len(out) == 1 and "summary" not in out[0], out)
    st_before = open(st40).read()
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Do E", "summary": 7}]}, raw=True)
    sc = r.get("structuredContent") or {}
    check("review 7.6: a refused later call of the turn says the earlier call's items stand, and they do (state file unchanged)",
          r.get("isError") is True and text(r).startswith("ledgr recorded nothing (earlier items of this turn stand): item 1's "
                                                          "summary is not a string. Every item needs one, as text.")
          and sc.get("earlier_items_stand") is True and not spool_files() and open(st40).read() == st_before, [text(r), sc])
    set_map("t99", SID, 41, prompt_id="p41")
    r = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Do E"}]}, raw=True)
    check("...in the next turn the earlier items are not this turn's: not said",
          r.get("isError") is True and text(r).startswith("ledgr recorded nothing: item 1 has no summary.")
          and (r.get("structuredContent") or {}).get("earlier_items_stand") is False, text(r))

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

    print("== the writer not applying events (2026-11-19)")
    # The writer held a fresh claim and applied nothing for hours, and declare_asks still said the items
    # would appear in the panel. writer_state reads the spool's times, store.json's, and the claim Herdr
    # saved in shared.json (LEDGR_DATA's parent here, as Herdr's home is ledgr-data's).
    spool, store, shared = os.path.join(DATA, "spool"), os.path.join(DATA, "store.json"), os.path.join(ROOT, "shared.json")
    os.makedirs(spool, exist_ok=True)
    wjson(store, {"v": 1})
    src = open(SERVER, encoding="utf-8").read()
    wjs = open(os.path.join(os.path.dirname(BIN), "writer.js"), encoding="utf-8").read()
    m1, m2 = re.search(r"^WRITER_STALL_S = (\d+)$", src, re.M), re.search(r"^export const PASS_STUCK_MS = (\d+);$", wjs, re.M)
    check("WRITER_STALL_S is writer.js PASS_STUCK_MS", m1 and m2 and int(m1.group(1)) * 1000 == int(m2.group(1)), [m1 and m1.group(0), m2 and m2.group(0)])

    def queued(age):
        t = time.time() - age
        p = os.path.join(spool, f"{int(t * 1000)}-prompt-1-{os.urandom(3).hex()}.json")
        wjson(p, {"v": 1, "id": os.urandom(4).hex(), "type": "prompt"})
        os.utime(p, (t, t))

    def store_age(age):
        t = time.time() - age
        os.utime(store, (t, t))

    c = Client(wait_ms=2000)
    c.init()
    set_map("t99", SID, 9)
    ask9 = [{"level": "blocking", "kind": "decide", "text": "Pick the cache size"}]
    queued(20)
    store_age(60)
    t0 = time.monotonic()
    r = c.call("declare_asks", {"items": ask9})
    dt, sc, tx = time.monotonic() - t0, r.get("structuredContent") or {}, text(r)
    check("behind (an event 20 s old, nothing written since): not waited for, said as behind, no word of a stall",
          sc.get("writer") == "idle" and (sc.get("writer_status") or {}).get("state") == "behind" and dt < 1.5
          and "Handles are pending: ledgr's writer is behind (the oldest queued event is 20 s old)" in tx and "not applying" not in tx
          and sc.get("ok") is True and not r.get("isError") and tx.splitlines()[-1] == sc.get("pointer"), [sc, tx, dt])
    take_events()
    queued(300)
    queued(200)
    store_age(400)
    t0 = time.monotonic()
    r = c.call("declare_asks", {"items": ask9})
    dt, sc, tx = time.monotonic() - t0, r.get("structuredContent") or {}, text(r)
    ws = sc.get("writer_status") or {}
    check("stalled (events 5 min old, store.json older): ok and not an error (a retry changes nothing), handles null, not waited for",
          sc.get("ok") is True and not r.get("isError") and sc.get("writer") == "stalled" and sc.get("handles") == [None] and dt < 1.5
          and sc.get("pointer") == "ledgr: 1 item for you, 1 blocking" and len(spool_files()) == 3, [sc, dt])
    check("stalled: writer_status has the numbers (3 queued, ours included; the oldest 300 s; store.json 400 s) and why",
          ws.get("state") == "stalled" and ws.get("queued") == 3 and 299 < (ws.get("oldest_s") or 0) < 330
          and (ws.get("store_s") or 0) > 399 and "the oldest for 5 min" in (ws.get("why") or ""), ws)
    check("stalled: the text says the writer is not applying, the items are queued and not shown, and to tell the user and list them",
          "ledgr's writer is not applying events (3 events queued, the oldest for 5 min, and store.json last written 7 min ago)." in tx
          and "These items are queued, not shown to the user: the panel does not have them." in tx
          and "Tell the user in your reply that ledgr's writer is not applying events (relaunching Herdr restarts it; nothing queued is lost)" in tx
          and "list these items in your reply this time" in tx and "Handles are pending" not in tx and "do not list these items in prose" not in tx
          and tx.splitlines()[-2:] == ["Then end your reply with this line:", "ledgr: 1 item for you, 1 blocking"], tx)
    take_events()
    queued(300)
    store_age(10)
    r = c.call("declare_asks", {"items": ask9})
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("an old event, but store.json written since it arrived (the writer moves): waited for as usual, not stalled",
          sc.get("writer") == "timeout" and (sc.get("writer_status") or {}).get("state") == "ok" and "not applying" not in tx
          and "Handles are pending: ledgr's writer has not applied the event yet" in tx, [sc, tx])
    take_events()
    snap_path = os.path.join(DATA, "snapshot.json")
    snap = rjson(snap_path, {"v": 1, "items": []})
    snap["items"].append({"id": "rq_a30", "handle": "A30", "direction": "agent_to_human", "text": "Pick the port", "level": "blocking",
                          "kind": "decide", "status": "open", "origin": "tool", "anchor": {"sessionId": SID, "turn": 9}})
    wjson(snap_path, snap)
    queued(300)
    store_age(400)
    r = c.call("resolve_asks", {"handles": ["A30"]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("resolve_asks, stalled: closed as asked (its event queued), the text says so and to tell the user; ok, not an error",
          sc.get("resolved") == ["A30"] and sc.get("writer") == "stalled" and (sc.get("writer_status") or {}).get("state") == "stalled"
          and "ledgr's writer is not applying events (2 events queued, the oldest for 5 min" in tx
          and "These closures are queued: the panel still shows the asks open." in tx
          and "Tell the user in your reply that ledgr's writer is not applying events" in tx and "has not applied this yet" not in tx
          and sc.get("ok") is True and not r.get("isError"), [sc, tx])
    take_events()
    queued(20)
    store_age(60)
    r = c.call("resolve_asks", {"handles": ["A30"]})
    sc, tx = r.get("structuredContent") or {}, text(r)
    check("resolve_asks, behind: said as behind, no word of a stall",
          sc.get("writer") == "idle" and "ledgr's writer is behind (the oldest queued event is 20 s old); the panel shows them closed once it applies them." in tx
          and "not applying" not in tx, [sc, tx])
    # The claim counts only when an event waits (over 5 s old, store.json not written since it arrived):
    # a claim is as old as the writer's last beat, hours old after the machine slept while the writer works
    # (2026-11-19 review: a claim 2 h old over an empty spool read as stalled).
    def claim_case(claim, ages=(30,), store=60, raw=None):
        take_events()
        for a in ages:
            queued(a)
        store_age(store)
        if raw is not None:
            open(shared, "w").write(raw)
        elif claim is None:
            wjson(shared, {"layout": "custom"})
        else:
            wjson(shared, {"layout": "custom", "ledgr.writer": claim})
        r = c.call("declare_asks", {"items": ask9})
        return r.get("structuredContent") or {}, text(r)

    now_ms = int(time.time() * 1000)
    sc, tx = claim_case({"id": "w1", "by": "my-tabs", "at": now_ms - 7200000, "done": now_ms - 3000}, ages=(), store=3)
    check("after a sleep: a claim 2 h old, nothing waiting, store.json written 3 s ago: waited for as usual, not stalled",
          sc.get("writer") == "timeout" and (sc.get("writer_status") or {}).get("state") == "ok" and "not applying" not in tx, [sc, tx])
    sc, tx = claim_case({"id": "w1", "by": "my-tabs", "at": now_ms - 7200000}, ages=(1,), store=3)
    check("...and with an event 1 s old: still not stalled", sc.get("writer") != "stalled" and "not applying" not in tx, [sc, tx])
    sc, tx = claim_case({"id": "w2", "by": "my-tabs", "at": now_ms, "pass": {"at": now_ms - 2000, "step": "start: store.json", "since": now_ms - 2000}},
                        ages=(600, 600, 600), store=86400)
    check("just relaunched with a backlog (events 10 min old, store.json a day old, the writer starting 2 s): behind, not stalled",
          sc.get("writer") == "idle" and (sc.get("writer_status") or {}).get("state") == "behind" and "writer is behind" in tx
          and "not applying" not in tx, [sc, tx])
    sc, tx = claim_case(None, raw='{"ledgr.writer": {"id": "w", "by": "my-t')
    check("shared.json caught mid-write, an event waiting 30 s: behind (the claim is not known), not \"no writer\"",
          sc.get("writer") == "idle" and "no writer holds the role" not in tx, [sc, tx])
    sc, tx = claim_case({"id": "w1", "by": "my-tabs", "at": now_ms, "pass": {"at": now_ms - 200000, "step": "save: store.json mv", "since": now_ms - 200000}})
    cl = (sc.get("writer_status") or {}).get("claim") or {}
    check("a fresh claim whose pass has waited 200 s in one step, an event waiting 30 s: stalled, with the step",
          sc.get("writer") == "stalled" and "ledgr's writer is not applying events (its writer (my-tabs) has waited 3 min in save: store.json mv)" in tx
          and cl.get("by") == "my-tabs" and cl.get("step") == "save: store.json mv" and 199 < (cl.get("step_s") or 0) < 230, [sc, tx])
    sc, tx = claim_case({"id": "w1", "by": "my-tabs", "at": now_ms - 400000})
    check("a claim nobody renewed for 7 min, an event waiting 30 s: stalled", sc.get("writer") == "stalled"
          and "its writer (my-tabs) has not renewed its claim for 7 min" in tx, tx)
    sc, tx = claim_case(None)
    check("Herdr's shared state holds no claim, an event waiting 30 s: stalled, no writer", sc.get("writer") == "stalled"
          and "no writer holds the role" in tx, tx)
    sc, tx = claim_case({"id": "w1", "by": "my-tabs", "at": now_ms, "fault": "stuck …",
                         "stall": {"at": now_ms - 300000, "step": "save: store.json mv", "ms": 95000, "ok": False, "kind": "pass", "retryAt": now_ms + 60000, "tries": 3}})
    check("a writer backing off (its claim fresh, no pass), an event waiting 30 s: stalled", sc.get("writer") == "stalled"
          and "its writer (my-tabs) is stuck in save: store.json mv and waits before it tries again" in tx, tx)
    sc, tx = claim_case({"id": "w1", "by": "my-tabs", "at": now_ms - 400000}, ages=())
    check("the same stale claim with nothing waiting: not stalled", sc.get("writer") == "timeout" and "not applying" not in tx, [sc, tx])
    sc, tx = claim_case({"id": "w1", "by": "my-tabs", "at": now_ms, "done": now_ms - 1000,
                         "stall": {"at": now_ms - 300000, "step": "save: store.json mv", "ms": 95000, "ok": True, "kind": "pass"}}, ages=(), store=60)
    check("a fresh, moving claim (a stall it came back from): waited for as usual, not stalled",
          sc.get("writer") == "timeout" and "not applying" not in tx, [sc, tx])
    os.unlink(shared)
    snap["items"] = [it for it in snap["items"] if it.get("handle") != "A30"]
    wjson(snap_path, snap)
    os.unlink(store)
    check("server 3 exits 0", c.close() == 0)
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
        # Sent raw, with no summary: off is answered before the summary is asked for (nothing is recorded either way).
        rd = c.call("declare_asks", {"items": [{"level": "blocking", "kind": "decide", "text": "Pick the region"}]}, raw=True)
        rr = c.call("resolve_asks", {"handles": ["A5"]})      # A5 is an open ask of SID
        ro = c.call("open_asks")
        rp = c.call("parked_questions")
        sd, sr, so, sp = (x.get("structuredContent") or {} for x in (rd, rr, ro, rp))
        check(f"off ({why}): declare_asks (an item without a summary) is ok and off, not refused, declares nothing, no pointer, the note, its other fields empty",
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
    # The live lookup has 300 ms (ledgr_map.HC_TIMEOUT_S); the server's first spawn of the fake hc can miss it
    # under load (seen once in ten runs, 2026-11-23: that call then reads the space as unknown, on). One call
    # first warms the path; off_round counts its log lines from after it.
    c.call("parked_questions")
    off_round(c, "a synthetic session, its space from a live hc get", "herdr:t61", 0, "spOFF", "spaces.disabled")
    wjson(cfgp, {"spaces": {"disabled": []}})
    rd = c.call("declare_asks", {"items": [{"level": "needed", "kind": "do", "text": "Anything"}]})
    evs = take_events()
    check("on again (spaces.disabled emptied): the synthetic session declares as before",
          "off" not in (rd.get("structuredContent") or {}) and len(evs) == 1 and evs[0]["session_id"] == "herdr:t61", evs)
    c.close()
    for p in (cfgp, recp):
        os.unlink(p)

    print("== cold sessions (retention Phase 2): the library")
    cold_section()

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
