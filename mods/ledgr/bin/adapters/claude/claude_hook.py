"""ledgr Claude Code adapter: maps one Claude Code hook's stdin JSON onto lib/ledgr_map.handle().

Claude-specific parts: the hook field names (hooks.md "Common input fields", "SessionStart input",
"UserPromptSubmit input", "Stop input"), main-conversation-only filtering (an `agent_id` on stdin
means a subagent or teammate; a hook_event_name other than the one this entry handles, such as
SubagentStop, is ignored), the local slash commands that do not start a turn, the session-name
fallback from <config>/sessions/<pid>.json (<config> is CLAUDE_CONFIG_DIR, else ~/.claude), and the
ledgr-asks instruction on stdout (Claude Code
adds a SessionStart or UserPromptSubmit hook's stdout to the session's context).
Branch lineage (Phase 2) is agent-agnostic and lives in lib/ledgr_map: a SessionStart with source
"fork" in a process carrying LEDGR_PARENT (the ledgr branch launcher's `env` prefix) records it and
emits branch_started; source "compact" emits compacted.
Landing (Phase 3): after the prompt event, a UserPromptSubmit whose prompt carries a ledgr marker line
(lib/ledgr_landing.py: "ledgr confluence <branch> <item>", "ledgr answers <session>") as the first
line of a pasted block, or of the prompt (after at most a one-line lead-in), emits confluence_landed or
answers_landed, 1 ms or more after the prompt event so the mod applies it after the turn has started.
The Claude-specific part is the paste wrapper: Claude Code puts pasted text between
<pasted_content id="..."> and </pasted_content id="..."> lines, so a lead-in the person types before
pasting does not hide the marker. Any other prompt is untouched; landing prints nothing.
The instruction (lib/asks-instruction.txt, config instruct_block, default on) is printed at every
SessionStart (startup, resume, clear, compact), and once more at the next real prompt after a turn
whose blocking ask only the extractor's model found, the message having no ledgr-asks block (config
instruct_reinject, default on; claude_extract.py marks the session). Nothing else is ever printed.
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
        return os.path.expanduser(d)
    m = re.match(r"^(.+)/projects/[^/]+/[^/]+\.jsonl$", transcript_path or "")
    return m.group(1) if m else os.path.join(C.HOME, ".claude")


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
    """Emit confluence_landed / answers_landed when the prompt carries a ledgr marker line."""
    if "ledgr confluence " not in prompt and "ledgr answers " not in prompt:
        return
    hit = L.detect(prompt, wrapper=(PASTE_OPEN, PASTE_CLOSE))
    if not hit:
        return
    turn = int(rec.get("turn") or 0)
    at = max(C.now_ms(), int(rec.get("updated_at") or 0) + 1)    # after the prompt event, in name order
    pid_ = rec.get("prompt_id")
    if hit["kind"] == "confluence":
        S.confluence_landed(t, sid, turn=turn, branch_id=hit["branch_id"], item_id=hit["item_id"],
                            prompt_id=pid_, conclusion_head=hit.get("conclusion_head"), at=at)
        C.log(f"{t} confluence_landed {sid} turn={turn} branch={hit['branch_id']}")
    else:
        S.answers_landed(t, sid, turn=turn, for_session=hit["for_session"], handles=hit["handles"],
                         answers=hit["answers"], prompt_id=pid_, at=at)
        C.log(f"{t} answers_landed {sid} turn={turn} handles={','.join(hit['handles'])}")


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
    if event == "UserPromptSubmit":
        p = inp.get("prompt") if isinstance(inp.get("prompt"), str) else ""
        fields["local"] = bool(LOCAL_CMD.match(p))
    if event == "SessionStart":
        tp = inp.get("transcript_path") if isinstance(inp.get("transcript_path"), str) else None
        fields["session_name_fallback"] = lambda s: session_name_fallback(s, config_dir(tp))
    rec = M.handle(event, sid, t, agent or AGENT, fields)
    if rec is None:
        return False
    if event == "UserPromptSubmit" and not fields.get("local"):
        landing(t, sid, rec, fields.get("prompt") if isinstance(fields.get("prompt"), str) else "")
        if rec.get("reinject_pending") is not None and M.take_reinject(sid):
            if cfg.get("instruct_block") is True and cfg.get("instruct_reinject") is not False and instruct():
                C.log(f"{t} reinject {sid} turn={rec.get('turn')} (after turn {rec.get('reinject_pending')})")
    if event == "SessionStart":
        M.prune(C.path("spool"), SPOOL_DAYS * 86400)
        M.prune(C.path("tmp"), 86400)
        M.prune(C.path("locks"), SPOOL_DAYS * 86400)
        if cfg.get("instruct_block") is True and instruct() and rec.get("reinject_pending") is not None:
            M.take_reinject(sid)                    # the instruction is in context again already
    return True


def instruct():
    """Print the ledgr-asks instruction (it becomes model context). True when printed."""
    txt = C.read_text(os.path.join(C.LIB, "asks-instruction.txt"))
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
