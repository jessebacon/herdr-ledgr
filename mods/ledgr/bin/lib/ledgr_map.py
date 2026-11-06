"""ledgr map writer: the session record (sessions/<sid>.json) and the identity map
(terminals/<t>.json), plus the per-turn text, for the four lifecycle events. Agent-agnostic:
an adapter turns its agent's hook input into `fields` and calls handle().

fields (all optional strings unless noted): cwd, transcript_path, session_title, model, source,
prompt, prompt_id, last_assistant_message, reason; local (bool, prompt only);
session_name_fallback (callable sid -> name|None, SessionStart only).

Writes are atomic (temp file + rename) and idempotent per event: a prompt whose prompt_id is
already the record's does not count a second turn, and re-running any event rewrites the same
content. A per-session flock serialises the read-modify-write of the turn counter; it fails open
after 3 s, and the idempotent write keeps a retry or duplicate delivery harmless.

Branches (Phase 2): a SessionStart with source "fork" in a process whose environment carries
LEDGR_PARENT (set by the ledgr branch launcher through `env` in the argv; see branch_env) records
the lineage in the session record and the map entry (parent_session_id, branch_id, parent_item,
anchor_turn, fork_turn, depth) and emits `branch_started` after `session_start`. Only once per
session, and only for the child id the launcher planned when it named one, so a later /branch or
/clear inside the branch's process is not mistaken for it. A SessionStart with source "compact"
appends {turn, at} to the record's `compactions` (last 10) and emits `compacted`.

Owner guard: the map entry records the pid (and command name) of the agent process the hooks run
under. An event for the same terminal with a different session_id, from a different pid, while the
recorded owner is still alive and still the same program, is ignored: a child agent process (a
`claude -p` run from the agent's shell inherits the terminal id) cannot repoint the terminal.
"""
import os
import re

import ledgr_core as C
import ledgr_spool as S

REF = re.compile(r"\[([AQ]\d{1,6})\]")
SID_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
LINEAGE = ("parent_session_id", "branch_id", "parent_item", "anchor_turn", "fork_turn", "depth")
MAX_TURN_TEXT = 500_000
KEEP_TURNS = 50
EVENTS = ("SessionStart", "UserPromptSubmit", "Stop", "SessionEnd")


def _prune_turns(sid):
    d = C.path("turns", sid)
    try:
        files = [os.path.join(d, n) for n in os.listdir(d) if n.endswith(".md")]
    except OSError:
        return
    if len(files) > KEEP_TURNS:
        files.sort(key=os.path.getmtime, reverse=True)
        for p in files[KEEP_TURNS:]:
            try:
                os.unlink(p)
            except OSError:
                pass


def _comm(pid):
    import subprocess
    try:
        r = subprocess.run(["/bin/ps", "-o", "comm=", "-p", str(pid)], capture_output=True, timeout=2)
        return os.path.basename(r.stdout.decode().strip()) or None
    except Exception:
        return None


def owner():
    """(pid, comm) of the agent process, as the adapter's shell entry found it."""
    try:
        pid = int(os.environ.get("LEDGR_OWNER_PID") or 0) or None
    except ValueError:
        pid = None
    return pid, os.environ.get("LEDGR_OWNER_COMM") or None


def owner_conflict(t, sid):
    """The recorded owner of terminal t if another live process owns it with another session;
    else None."""
    m = C.read_json(C.path("terminals", C.tfile(t) + ".json"))
    if not isinstance(m, dict) or not m.get("session_id") or m.get("session_id") == sid:
        return None
    rec_pid, rec_comm = m.get("owner_pid"), m.get("owner_comm")
    pid, _ = owner()
    if not isinstance(rec_pid, int) or rec_pid <= 1 or rec_pid == pid:
        return None
    try:
        os.kill(rec_pid, 0)
    except ProcessLookupError:
        return None                                  # the recorded owner is gone
    except PermissionError:
        pass
    if rec_comm and _comm(rec_pid) != rec_comm:      # pid reused by another program
        return None
    return {"pid": rec_pid, "session_id": m.get("session_id")}


def _int(v, default=None):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return default


def branch_env(environ=None):
    """The branch launcher's environment, or None when absent or malformed.
    LEDGR_PARENT = <parent sid>:<item id>:<anchor turn>;
    LEDGR_BRANCH = <branch id>:<depth>:<fork turn>:<child sid> (optional, parts may be empty)."""
    env = os.environ if environ is None else environ
    parts = (env.get("LEDGR_PARENT") or "").strip().split(":")
    if len(parts) != 3:
        return None
    psid, item, aturn = parts
    if not SID_OK.match(psid) or not item or "/" in item or _int(aturn) is None:
        return None
    b = (env.get("LEDGR_BRANCH") or "").strip().split(":")
    b += [""] * (4 - len(b))
    bid, depth, fturn, child = b[:4]
    return {"parent_session_id": psid, "item_id": item, "anchor_turn": _int(aturn),
            "branch_id": bid if bid and SID_OK.match(bid) else None, "depth": _int(depth),
            "fork_turn": _int(fturn), "child_session_id": child if child and SID_OK.match(child) else None}


def lineage_for(sid, rec, b):
    """The lineage to record for session sid from branch_env() b, or None (not a branch start)."""
    if not b or rec.get("parent_session_id") or b["parent_session_id"] == sid:
        return None
    if b.get("child_session_id") and b["child_session_id"] != sid:
        return None
    parent = C.read_json(C.path("sessions", b["parent_session_id"] + ".json"), {})
    parent = parent if isinstance(parent, dict) else {}
    fork_turn = b["fork_turn"] if b["fork_turn"] is not None else _int(parent.get("turn"), 0)
    depth = b["depth"] if b["depth"] is not None and b["depth"] >= 1 else (_int(parent.get("depth"), 0) or 0) + 1
    return {"parent_session_id": b["parent_session_id"], "branch_id": b.get("branch_id"), "parent_item": b["item_id"],
            "anchor_turn": b["anchor_turn"], "fork_turn": fork_turn, "depth": depth}


def map_record(t, rec, event, now):
    """The terminals/<t>.json shape. `agent` is always present."""
    return {"v": 1, "terminal": t, "scope": rec.get("scope"), "agent": rec.get("agent") or "other",
            "session_id": rec["session_id"], "session_name": rec.get("session_name"),
            "transcript_path": rec.get("transcript_path"), "cwd": rec.get("cwd"), "repo": rec.get("repo"),
            "turn": rec.get("turn"), "prompt_id": rec.get("prompt_id"), "state": rec.get("state"),
            "last_passage_hash": rec.get("last_passage_hash"),
            "last_assistant_uuid": rec.get("last_assistant_uuid"),
            "owner_pid": rec.get("owner_pid"), "owner_comm": rec.get("owner_comm"),
            **{k: rec.get(k) for k in LINEAGE},
            "last_event": event, "updated_at": now}


def write_map(t, rec, event, now):
    C.write_json(C.path("terminals", C.tfile(t) + ".json"), map_record(t, rec, event, now))


def handle(event, sid, t, agent, fields):
    """Apply one lifecycle event. Returns the new session record, or None when the event was
    ignored by the owner guard."""
    now = C.now_ms()
    f = lambda k: fields.get(k) if isinstance(fields.get(k), str) and fields.get(k) else None  # noqa: E731
    with C.Lock("session-" + sid):
        conflict = owner_conflict(t, sid)
        if conflict:
            C.log(f"{t} {event} {sid} ignored: terminal owned by pid {conflict['pid']} "
                  f"session {conflict['session_id']}")
            return None
        sf = C.path("sessions", sid + ".json")
        cur = C.read_json(sf, {})
        cur = cur if isinstance(cur, dict) else {}
        rec = dict(cur)
        pid, comm = owner()
        rec.update(v=1, session_id=sid, agent=agent or cur.get("agent") or "other", terminal=t,
                   scope=os.environ.get("HC_SCOPE") or cur.get("scope"))
        if pid:
            rec.update(owner_pid=pid, owner_comm=comm)
        if f("session_title"):
            rec["session_name"] = f("session_title")
        cwd = f("cwd") or cur.get("cwd")
        if cwd and (cwd != cur.get("cwd") or not cur.get("repo")):
            rec["repo"] = C.repo_of(cwd)
        rec["cwd"] = cwd
        if f("transcript_path"):
            rec["transcript_path"] = f("transcript_path")
        for k, v in (("session_name", None), ("repo", None), ("transcript_path", None), ("model", None),
                     ("turn", 0), ("turn_base", "ledgr"), ("turn_source", "hooks"), ("prompt_id", None),
                     ("state", "idle"), ("last_source", None), ("last_stop_at", None),
                     ("last_assistant_uuid", None), ("last_passage_hash", None), ("parent_session_id", None),
                     ("owner_pid", None), ("owner_comm", None), ("started_at", now)):
            rec.setdefault(k, v)
        rec.pop("pending_settle", None)                 # older builds kept a settle retry here
        rec["updated_at"] = now
        turn = int(rec.get("turn") or 0)

        if event == "SessionStart":
            src = f("source") or "startup"
            if f("model"):
                rec["model"] = f("model")
            fb = fields.get("session_name_fallback")
            if not rec.get("session_name") and callable(fb):
                rec["session_name"] = fb(sid)
            rec["last_source"] = src
            if src != "compact":                    # compaction can happen mid-turn: keep the state
                rec["state"] = "idle"
            lineage = lineage_for(sid, rec, branch_env()) if src == "fork" else None
            if lineage:
                rec.update(lineage)
            if src == "compact":
                comps = [c for c in (rec.get("compactions") or []) if isinstance(c, dict)][-9:]
                comps.append({"turn": turn, "at": now})
                rec["compactions"] = comps
            S.session_start(t, sid, agent=rec["agent"], source=src, model=rec.get("model"), cwd=rec.get("cwd"),
                            transcript_path=rec.get("transcript_path"), session_name=rec.get("session_name"),
                            repo=rec.get("repo"), turn=turn, at=now)
            # 1 ms later, so name order (the mod's apply order) puts them after session_start.
            if lineage:
                S.branch_started(t, sid, parent_session_id=lineage["parent_session_id"], item_id=lineage["parent_item"],
                                 anchor_turn=lineage["anchor_turn"], fork_turn=lineage["fork_turn"],
                                 depth=lineage["depth"], branch_id=lineage["branch_id"], source=src, at=now + 1)
            if src == "compact":
                S.compacted(t, sid, turn=turn, trigger=None, at=now + 1)

        elif event == "UserPromptSubmit":
            p = fields.get("prompt") if isinstance(fields.get("prompt"), str) else ""
            local = fields.get("local") is True
            pid_ = f("prompt_id")
            if not local and not (pid_ and pid_ == cur.get("prompt_id")):    # idempotent per prompt_id
                turn += 1
                rec.update(turn=turn, prompt_id=pid_)
            if not local:
                rec["state"] = "working"
            refs = []
            for r in REF.findall(p):
                if r not in refs:
                    refs.append(r)
            S.prompt(t, sid, turn=turn, prompt_id=pid_, local=local, prompt_head=p, refs=refs, at=now)

        elif event == "Stop":
            msg = fields.get("last_assistant_message")
            msg = msg if isinstance(msg, str) else ""
            C.atomic_write(C.path("turns", sid, f"{turn}.md"), msg[:MAX_TURN_TEXT])
            ph = C.passage_hash(msg)
            rec.update(state="idle", last_stop_at=now, last_passage_hash=ph)
            if rec.get("last_uuid_hash") != ph:     # the extractor resolves this turn's uuid;
                rec["last_assistant_uuid"] = None   # keep it if the extractor got there first
            S.pending(t, sid, turn=turn, passage_hash=ph, at=now)
            _prune_turns(sid)

        elif event == "SessionEnd":
            rec["state"] = "ended"
            S.session_end(t, sid, turn=turn, reason=f("reason"), at=now)

        C.write_json(sf, rec)
        write_map(t, rec, event, now)
    C.log(f"{t} {event} {sid} turn={rec.get('turn')}")
    return rec


# The hybrid re-injection of the ledgr-asks instruction (config instruct_reinject). The extractor
# marks the session after a turn whose blocking ask only the model found (the message had no block);
# the session's next real prompt prints the instruction once and clears the mark. SessionStart,
# which prints it anyway, clears it too.
def mark_reinject(sid, turn):
    with C.Lock("session-" + sid):
        sf = C.path("sessions", sid + ".json")
        rec = C.read_json(sf)
        if not isinstance(rec, dict):
            return False
        rec["reinject_pending"] = int(turn or 0)
        C.write_json(sf, rec)
    return True


def take_reinject(sid):
    """True once after mark_reinject: clears the mark."""
    with C.Lock("session-" + sid):
        sf = C.path("sessions", sid + ".json")
        rec = C.read_json(sf)
        if not isinstance(rec, dict) or rec.get("reinject_pending") is None:
            return False
        rec.pop("reinject_pending", None)
        C.write_json(sf, rec)
    return True


def prune(folder, max_age_s):
    import time
    cutoff = time.time() - max_age_s
    try:
        for n in os.listdir(folder):
            p = os.path.join(folder, n)
            try:
                if os.path.isfile(p) and os.path.getmtime(p) < cutoff:
                    os.unlink(p)
            except OSError:
                pass
    except OSError:
        pass
