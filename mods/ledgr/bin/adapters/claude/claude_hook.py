"""ledgr Claude Code adapter: maps one Claude Code hook's stdin JSON onto lib/ledgr_map.handle().

Claude-specific parts: the hook field names (hooks.md "Common input fields", "SessionStart input",
"UserPromptSubmit input", "Stop input"), main-conversation-only filtering (an `agent_id` on stdin
means a subagent or teammate; a hook_event_name other than the one this entry handles, such as
SubagentStop, is ignored), the local slash commands that do not start a turn, the session's config
folder and profile (<config> is CLAUDE_CONFIG_DIR, else the folder above projects/ in the transcript
path, else ~/.claude; profile "default" for ~/.claude, else the folder's name without ".claude-", so
~/.claude-work is "work"; recorded on every event, carried by session_start and prompt), the session-name
fallback from <config>/sessions/<pid>.json, and the ledgr-asks instruction on stdout (Claude Code
adds a SessionStart or UserPromptSubmit hook's stdout to the session's context).
Branch lineage (Phase 2) is agent-agnostic and lives in lib/ledgr_map: a SessionStart with source
"fork" in a process carrying LEDGR_PARENT (the ledgr branch launcher's `env` prefix) records it and
emits branch_started; source "compact" emits compacted.
Landing (Phase 3, pins): after the prompt event, a UserPromptSubmit whose prompt carries a ledgr marker
line (lib/ledgr_landing.py: "ledgr confluence <branch> <item>", "ledgr answers <session>", "ledgr pins
<session> <item>") as the first line of a pasted block, or of the prompt (after at most a one-line
lead-in), emits confluence_landed, answers_landed or pins_asked, 1 ms or more after the prompt event so
the mod applies it after the turn has started;
one event per message when several follow one another (two answer sheets pasted into one prompt),
each 1 ms after the one before. The Claude-specific part is the paste wrapper: Claude Code puts pasted
text between <pasted_content id="..."> and </pasted_content id="..."> lines, so a lead-in the person
types before pasting does not hide the marker. Any other prompt is untouched; landing prints nothing.
Disabled spaces: SessionStart and UserPromptSubmit read the terminal's Herdr space (ledgr_map.herdr_space,
one `hc get`); Stop and SessionEnd use the recorded one. A session whose space is in config
spaces.disabled is off and behaves as if ledgr were not installed: the record and the map are still
written (with `space`), but no spool event, no turn text, no landing, no extractor, no instruction.
The session record keeps `ledgr_off`, and a change is told once, at a real prompt: on -> off prints
lib/asks-instruction-space-off.txt (only to a session that had a wording), off -> on prints the mode's
wording. A SessionStart while off prints nothing, except the off text at a resume or compact of a
session that had a wording (its context may still carry it). A Stop is off when the recorded space
is disabled now or the turn began off, so a turn that started off ends off.
The instruction is the wording for the session's handoff mode (ledgr_config.handoff: asks.handoff
"ledgr" -> lib/asks-instruction-ledgr.txt, "both" -> lib/asks-instruction-both.txt, "prose" or
instruct_block false -> nothing). It is printed at every SessionStart (startup, resume, clear,
compact); once more at the next real prompt after a turn whose blocking ask only the extractor's
model found, the message having no ledgr-asks block (config instruct_reinject, default on;
claude_extract.py marks the session); and once at the next real prompt after the mode changed since
the session last got its wording (the record's instruct_mode; a session from before the modes counts
as "both"). A switch to "prose" prints lib/asks-instruction-off.txt once to a session that had a
wording, so it stops; a session that starts in "prose" never gets anything. Nothing else is ever
printed.
Exit status for the shell entry: 0 handled,
10 ignored (stop.sh starts the extractor only on 0). Never raises.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path[:0] = [os.path.join(ROOT, "lib"), ROOT, HERE]
import ledgr_core as C  # noqa: E402
import ledgr_config as K  # noqa: E402
import ledgr_map as M  # noqa: E402
import ledgr_landing as L  # noqa: E402
import ledgr_spool as S  # noqa: E402

AGENT = "claude-code"
LOCAL_CMD = re.compile(r"^/(btw|clear|compact|resume|rewind|model|config|tui|focus|diff|help|status|cost|context"
                       r"|branch|fork|exit)(\s|$)")
FIELDS = ("cwd", "transcript_path", "session_title", "model", "source", "prompt", "prompt_id",
          "last_assistant_message", "reason")
SPOOL_DAYS = 7
# hooks.md, "UserPromptSubmit input": pasted text can arrive between these lines.
PASTE_OPEN = re.compile(r'^<pasted_content(\s+id="[^"]*")?\s*>$')
PASTE_CLOSE = re.compile(r'^</pasted_content(\s+id="[^"]*")?\s*>$')


def config_dir(transcript_path=None):
    """This session's Claude config folder: CLAUDE_CONFIG_DIR (Claude Code passes its environment to
    the hooks; a second account such as `claude-work` sets it), else the folder above projects/ in the
    transcript path, else ~/.claude."""
    d = os.environ.get("CLAUDE_CONFIG_DIR")
    if d:
        return os.path.abspath(os.path.expanduser(d))
    m = re.match(r"^(.+)/projects/[^/]+/[^/]+\.jsonl$", transcript_path or "")
    return os.path.normpath(m.group(1)) if m else os.path.join(C.HOME, ".claude")


def profile_of(cfg_dir):
    """The config folder's short name: "default" for ~/.claude (any folder named .claude), else its
    name without a leading ".claude-" (~/.claude-work -> "work"), else its name as it is."""
    if not cfg_dir:
        return None
    n = os.path.basename(os.path.normpath(cfg_dir))
    if n == ".claude":
        return "default"
    return n[len(".claude-"):] if n.startswith(".claude-") and len(n) > len(".claude-") else (n or None)


def session_name_fallback(sid, cfg_dir=None):
    """Undocumented: the `name` of the matching <config>/sessions/<pid>.json (spec 2.5)."""
    d = os.path.join(cfg_dir or config_dir(), "sessions")
    try:
        for n in os.listdir(d):
            if n.endswith(".json"):
                r = C.read_json(os.path.join(d, n), {})
                if isinstance(r, dict) and r.get("sessionId") == sid and r.get("name"):
                    return r["name"]
    except OSError:
        pass
    return None


def landing(t, sid, rec, prompt):
    """Emit confluence_landed / answers_landed / pins_asked for each ledgr message the prompt carries,
    in order."""
    if not L.has_marker_text(prompt):
        return
    hits = L.detect_all(prompt, wrapper=(PASTE_OPEN, PASTE_CLOSE))
    if not hits:
        return
    turn = int(rec.get("turn") or 0)
    at = max(C.now_ms(), int(rec.get("updated_at") or 0) + 1)    # after the prompt event, in name order
    pid_ = rec.get("prompt_id")
    for i, hit in enumerate(hits):
        if hit["kind"] == "confluence":
            S.confluence_landed(t, sid, turn=turn, branch_id=hit["branch_id"], item_id=hit["item_id"],
                                prompt_id=pid_, conclusion_head=hit.get("conclusion_head"), at=at + i)
            C.log(f"{t} confluence_landed {sid} turn={turn} branch={hit['branch_id']}")
        elif hit["kind"] == "pins":
            S.pins_asked(t, sid, turn=turn, for_session=hit["for_session"], item_id=hit["item_id"],
                         prompt_id=pid_, at=at + i)
            C.log(f"{t} pins_asked {sid} turn={turn} item={hit['item_id']}")
        else:
            S.answers_landed(t, sid, turn=turn, for_session=hit["for_session"], handles=hit["handles"],
                             answers=hit["answers"], prompt_id=pid_, at=at + i)
            C.log(f"{t} answers_landed {sid} turn={turn} handles={','.join(hit['handles'])}")


def recorded(sid):
    cur = C.read_json(C.path("sessions", sid + ".json"), {})
    return cur if isinstance(cur, dict) else {}


def prompt_turn(t, sid, rec, cfg, mode, off, prompt):
    """A real (not local) prompt: tell a change of the space's on/off state once, else as before:
    landing, the reinject reminder, a change of handoff mode. One record write at most."""
    prev_off = rec.get("ledgr_off") is True
    turn = rec.get("turn")
    upd = {}
    if off:
        if not prev_off:                             # on -> off (or never told: a record from before)
            new = rec.get("started_at") == rec.get("updated_at")          # first seen at this prompt
            had = not new and (rec.get("instruct_mode") or "both") != "prose"
            told = had and instruct("space-off")
            C.log(f"{t} space-off {sid} turn={turn} space={rec.get('space')}" + (" (told to stop)" if told else ""))
            upd.update(ledgr_off=True, reinject_pending=None)
    elif prev_off:                                   # off -> on: the prompt event was written; the wording
        landing(t, sid, rec, prompt)
        told = mode != "prose" and instruct(mode)
        C.log(f"{t} space-on {sid} turn={turn} space={rec.get('space')}" + (f" (wording {mode})" if told else ""))
        upd.update(ledgr_off=False, off_skip_logged=None, reinject_pending=None, instruct_mode=mode)
    else:
        landing(t, sid, rec, prompt)
        due = rec.get("reinject_pending") is not None and M.take_reinject(sid) \
            and mode != "prose" and cfg.get("instruct_reinject") is not False
        last = rec.get("instruct_mode")
        switched = (last or "both") != mode and not (last is None and mode == "prose")
        if (due or switched) and instruct("off" if mode == "prose" else mode):
            C.log(f"{t} {'reinject' if due else 'handoff ' + str(last) + '->' + mode} {sid} turn={turn}"
                  + (f" (after turn {rec.get('reinject_pending')})" if due else ""))
        if switched or last is None:
            upd["instruct_mode"] = mode
        if rec.get("ledgr_off") is None:
            upd["ledgr_off"] = False
    if upd:
        M.set_fields(sid, **upd)


def start_session(t, sid, rec, mode, off, src):
    """SessionStart: the mode's wording when on; when off nothing, except the off text at a resume
    or compact of a session that had a wording. One record write at most."""
    upd = {}
    if off:
        told = src in ("resume", "compact") and rec.get("instruct_mode") in ("ledgr", "both") \
            and instruct("space-off")
        C.log(f"{t} space-off {sid} at {src} space={rec.get('space')}" + (" (told to stop)" if told else ""))
        upd.update(ledgr_off=True, reinject_pending=None)
    else:
        if mode != "prose" and instruct(mode) and rec.get("reinject_pending") is not None:
            upd["reinject_pending"] = None          # the instruction is in context again already
        if rec.get("instruct_mode") != mode:
            upd["instruct_mode"] = mode
        if rec.get("ledgr_off") is not False:
            upd.update(ledgr_off=False, off_skip_logged=None)
    if upd:
        M.set_fields(sid, **upd)


def run(event, agent):
    """Returns True when the event was applied."""
    t = C.terminal_id()
    if not t:
        return False
    try:
        inp = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))
    except Exception:
        return False
    if not isinstance(inp, dict) or event not in M.EVENTS:
        return False
    sid = inp.get("session_id")
    if not isinstance(sid, str) or not sid or "/" in sid:
        return False
    if inp.get("agent_id") or (inp.get("hook_event_name") not in (None, event)):
        C.log(f"{t} {event} {sid} ignored: subagent or {inp.get('hook_event_name')}")
        return False
    cfg = K.load()
    fields = {k: inp.get(k) for k in FIELDS}
    tp = inp.get("transcript_path") if isinstance(inp.get("transcript_path"), str) else None
    cdir = config_dir(tp)
    fields.update(config_dir=cdir, profile=profile_of(cdir))
    if event == "UserPromptSubmit":
        p = inp.get("prompt") if isinstance(inp.get("prompt"), str) else ""
        fields["local"] = bool(LOCAL_CMD.match(p))
    if event == "SessionStart":
        fields["session_name_fallback"] = lambda s: session_name_fallback(s, cdir)
    if event in ("SessionStart", "UserPromptSubmit"):
        fields["space"] = M.herdr_space()           # one `hc get`; UNKNOWN keeps the recorded space
        space = fields["space"] if fields["space"] is not M.UNKNOWN else recorded(sid).get("space")
        off = M.space_off(cfg, space)
    else:                                           # Stop, SessionEnd: the recorded space, no `hc` call
        cur = recorded(sid)
        off = M.space_off(cfg, cur.get("space")) or cur.get("ledgr_off") is True
    fields["quiet"] = off
    rec = M.handle(event, sid, t, agent or AGENT, fields)
    if rec is None:
        return False
    mode = K.handoff(cfg)
    if event == "UserPromptSubmit" and not fields.get("local"):
        prompt_turn(t, sid, rec, cfg, mode, off, fields.get("prompt") if isinstance(fields.get("prompt"), str) else "")
    if event == "SessionStart":
        M.prune(C.path("spool"), SPOOL_DAYS * 86400)
        M.prune(C.path("tmp"), 86400)
        M.prune(C.path("locks"), SPOOL_DAYS * 86400)
        start_session(t, sid, rec, mode, off, rec.get("last_source"))
    return not (off and event == "Stop")            # an off Stop starts no extractor (stop.sh)


def instruct(mode):
    """Print the ledgr-asks wording for a handoff mode ("ledgr", "both"; "off" revokes an earlier
    one; "space-off" says ledgr is off in this space). It becomes model context. True when printed."""
    txt = C.read_text(os.path.join(C.LIB, f"asks-instruction-{mode}.txt"))
    if not txt:
        return False
    sys.stdout.write(txt)
    sys.stdout.flush()
    return True


def main(argv):
    event = argv[1] if len(argv) > 1 else ""
    agent = argv[argv.index("--agent") + 1] if "--agent" in argv and argv.index("--agent") + 1 < len(argv) else None
    try:
        return 0 if run(event, agent) else 10
    except BaseException as ex:  # noqa: BLE001 - a hook must never fail loudly
        try:
            import traceback
            C.log(f"error {event}: {ex!r}")
            sys.stderr.write(traceback.format_exc())
        except Exception:
            pass
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
