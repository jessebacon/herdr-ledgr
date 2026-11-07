"""ledgr map writer: the session record (sessions/<sid>.json) and the identity map
(terminals/<t>.json), plus the per-turn text, for the four lifecycle events. Agent-agnostic:
an adapter turns its agent's hook input into `fields` and calls handle().

fields (all optional strings unless noted): cwd, transcript_path, session_title, model, source,
prompt, prompt_id, last_assistant_message, reason; config_dir and profile (the agent's config
folder and its short name, when the adapter knows them: Claude's CLAUDE_CONFIG_DIR, "default" or
"work"; recorded on any event, carried by session_start and prompt); local (bool, prompt only);
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

Disabled spaces: the session record and the map entry carry `space`, the Herdr space id of the
terminal (its `herdr.space` label, read by herdr_space() with one `hc get <t> --json` at SessionStart
and UserPromptSubmit; a Stop or SessionEnd keeps the recorded value). null outside Herdr or when no
label is found; a lookup that fails (timeout, non-zero exit, bad output) keeps the recorded value, so
a slow `hc` does not flip a session on and off. A session whose space is in config
`spaces.disabled` is off (space_off()): the adapter passes fields["quiet"] and handle() still writes
the record and the map but emits no spool event and saves no turn text (a Stop only marks the state
idle and logs the first skip of an off period). The adapter records `ledgr_off` with set_fields().
"""
import json
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
SPACE_LABEL = "herdr.space"
SPACE_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
HC_TIMEOUT_S = 0.3
UNKNOWN = object()          # herdr_space(): the lookup failed; keep the recorded value


def _which(name):
    for d in (os.environ.get("PATH") or C.TOOL_PATH).split(os.pathsep):
        p = os.path.join(d or ".", name)
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def _read_cmd(argv, timeout):
    """(exit code, stdout) of argv (stdin and stderr /dev/null), or None when it did not finish within
    `timeout` seconds (it is killed). posix_spawn and a pipe rather than subprocess, whose import
    alone costs a hook about 4 ms. Raises OSError when argv[0] cannot be run."""
    import select
    import time
    r, w = os.pipe()                                 # both close-on-exec; dup2 makes the child's fd 1
    try:
        pid = os.posix_spawn(argv[0], argv, os.environ, file_actions=[
            (os.POSIX_SPAWN_OPEN, 0, os.devnull, os.O_RDONLY, 0), (os.POSIX_SPAWN_DUP2, w, 1),
            (os.POSIX_SPAWN_OPEN, 2, os.devnull, os.O_WRONLY, 0)])
    except BaseException:
        os.close(r)
        os.close(w)
        raise
    os.close(w)
    deadline, out = time.monotonic() + timeout, []
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([r], [], [], max(0.0, deadline - time.monotonic()))
            if not ready:
                break
            chunk = os.read(r, 65536)
            if chunk:
                out.append(chunk)
                continue
            while time.monotonic() < deadline:       # end of output: reap it
                done, status = os.waitpid(pid, os.WNOHANG)
                if done:
                    return os.waitstatus_to_exitcode(status), b"".join(out)
                time.sleep(0.002)
            break
    finally:
        os.close(r)
    try:
        os.kill(pid, 9)                              # SIGKILL
        os.waitpid(pid, 0)
    except OSError:
        pass
    return None


def herdr_space(timeout=HC_TIMEOUT_S):
    """The Herdr space id of this hook's terminal: labels["herdr.space"] of `hc get $HC_TERMINAL_ID
    --json` (one call, about 6 ms). None when there is no space to find: no HC_TERMINAL_ID (outside
    Herdr, the LEDGR_TERMINAL override), a remote address (t contains "/"), no `hc` binary (LEDGR_HC
    names another one; set and empty, the lookup is off), or a terminal without the label. UNKNOWN
    when the lookup failed: a timeout, a non-zero exit, output that is not a JSON object."""
    t = os.environ.get("HC_TERMINAL_ID") or ""
    if not t or "/" in t or t.startswith("-"):
        return None
    hc = os.environ.get("LEDGR_HC")
    if hc is None:
        hc = _which("hc")
    if not hc:
        return None
    try:
        res = _read_cmd([hc, "get", t, "--json"], timeout)
    except OSError:
        return None                                  # cannot be run: as if missing
    if res is None:
        C.log(f"{t} space lookup: hc get timed out after {int(timeout * 1000)} ms")
        return UNKNOWN
    if res[0] != 0:
        return UNKNOWN
    try:
        d = json.loads(res[1].decode("utf-8", "replace"))
    except ValueError:
        return UNKNOWN
    if not isinstance(d, dict):
        return UNKNOWN
    labels = d.get("labels")
    sp = labels.get(SPACE_LABEL) if isinstance(labels, dict) else None
    return sp if isinstance(sp, str) and SPACE_OK.match(sp) else None


def spaces_disabled(cfg):
    """config spaces.disabled: the space ids where ledgr is off ([] when absent or not a list)."""
    sp = cfg.get("spaces") if isinstance(cfg, dict) else None
    lst = sp.get("disabled") if isinstance(sp, dict) else None
    return [x for x in lst if isinstance(x, str) and x] if isinstance(lst, list) else []


def space_off(cfg, space):
    """True when ledgr is off for a session in this space (a null space is on)."""
    return isinstance(space, str) and bool(space) and space in spaces_disabled(cfg)


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
    return {"v": 1, "terminal": t, "scope": rec.get("scope"), "space": rec.get("space"),
            "agent": rec.get("agent") or "other",
            "session_id": rec["session_id"], "session_name": rec.get("session_name"),
            "transcript_path": rec.get("transcript_path"), "cwd": rec.get("cwd"), "repo": rec.get("repo"),
            "config_dir": rec.get("config_dir"), "profile": rec.get("profile"),
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
    ignored by the owner guard. fields["space"] (when present: a space id or None; UNKNOWN keeps the
    recorded one) refreshes the record's space; fields["quiet"] True (the session's space is
    disabled) writes the record and the map but no spool event and no turn text."""
    now = C.now_ms()
    f = lambda k: fields.get(k) if isinstance(fields.get(k), str) and fields.get(k) else None  # noqa: E731
    quiet = fields.get("quiet") is True
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
        for k in ("config_dir", "profile"):
            if f(k):
                rec[k] = f(k)
        if "space" in fields and fields["space"] is not UNKNOWN:
            rec["space"] = f("space")
        for k, v in (("session_name", None), ("repo", None), ("transcript_path", None), ("model", None),
                     ("turn", 0), ("turn_base", "ledgr"), ("turn_source", "hooks"), ("prompt_id", None),
                     ("state", "idle"), ("last_source", None), ("last_stop_at", None),
                     ("last_assistant_uuid", None), ("last_passage_hash", None), ("parent_session_id", None),
                     ("owner_pid", None), ("owner_comm", None), ("config_dir", None), ("profile", None),
                     ("space", None), ("started_at", now)):
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
            if not quiet:
                S.session_start(t, sid, agent=rec["agent"], source=src, model=rec.get("model"), cwd=rec.get("cwd"),
                                transcript_path=rec.get("transcript_path"), session_name=rec.get("session_name"),
                                repo=rec.get("repo"), turn=turn, config_dir=rec.get("config_dir"),
                                profile=rec.get("profile"), at=now)
            # 1 ms later, so name order (the mod's apply order) puts them after session_start.
            if lineage and not quiet:
                S.branch_started(t, sid, parent_session_id=lineage["parent_session_id"], item_id=lineage["parent_item"],
                                 anchor_turn=lineage["anchor_turn"], fork_turn=lineage["fork_turn"],
                                 depth=lineage["depth"], branch_id=lineage["branch_id"], source=src, at=now + 1)
            if src == "compact" and not quiet:
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
            if not quiet:
                S.prompt(t, sid, turn=turn, prompt_id=pid_, local=local, prompt_head=p, refs=refs,
                         config_dir=rec.get("config_dir"), profile=rec.get("profile"), at=now)

        elif event == "Stop" and quiet:              # ledgr is off here: no turn text, no pending
            rec.update(state="idle", last_stop_at=now)
            if not rec.get("off_skip_logged"):
                rec["off_skip_logged"] = True
                C.log(f"{t} Stop {sid} skipped: ledgr is off in space {rec.get('space')} (no pending, no extraction,"
                      f" no tool settlement; logged once until it is on again)")

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
            if not quiet:
                S.session_end(t, sid, turn=turn, reason=f("reason"), at=now)

        C.write_json(sf, rec)
        write_map(t, rec, event, now)
    C.log(f"{t} {event} {sid} turn={rec.get('turn')}" + (" (ledgr off)" if quiet else ""))
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


def set_fields(sid, **kv):
    """One locked read-modify-write of the session record; a None value removes the key."""
    with C.Lock("session-" + sid):
        sf = C.path("sessions", sid + ".json")
        rec = C.read_json(sf)
        if not isinstance(rec, dict):
            return False
        for k, v in kv.items():
            if v is None:
                rec.pop(k, None)
            else:
                rec[k] = v
        C.write_json(sf, rec)
    return True


def set_instruct_mode(sid, mode):
    """Record the handoff mode whose wording the session last got ("ledgr", "both", "prose"), so a
    later change of asks.handoff reaches it once at its next prompt."""
    return set_fields(sid, instruct_mode=mode)


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
