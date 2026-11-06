"""ledgr Claude Code adapter: drives lib/ledgr_extract.py for Claude sessions and adds the
Claude-specific anchor, the transcript record uuid of the final message. The uuid is optional:
every anchor also carries turn + passage_hash.

  --input <file>          Stop part B, started detached by stop.sh (with LEDGR_INNER=1) after part
                          A accepted the event. <file> holds the Stop hook JSON; it is deleted after
                          reading. A resolver thread looks up the uuid (retries at 0, 1, 2, 4 s) and
                          emits `stop` carrying it; the extraction runs meanwhile; `asks` follows.
  --retry <sid> <turn>    Re-run on turns/<sid>/<turn>.md, emit `asks`, print a JSON summary.
  --dry-run --text-file <f> [--snapshot <f>] [--session <sid>] [--session-name <n>]
            [--mode <m>] [--provider <p>]      Print the result; writes nothing.
"""
import json
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path[:0] = [os.path.join(ROOT, "lib"), ROOT, HERE]
import ledgr_core as C  # noqa: E402
import ledgr_config as K  # noqa: E402
import ledgr_map as M  # noqa: E402
import ledgr_spool as S  # noqa: E402
import ledgr_extract as X  # noqa: E402
import last_assistant  # noqa: E402

UUID_OFFSETS = (0, 1, 2, 4)        # seconds after start (spec 4.1 step 6)


def resolve_uuid(transcript, msg, t0, offsets=UUID_OFFSETS):
    for off in offsets:
        wait = t0 + off - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        r = last_assistant.find(transcript, msg)
        if r.get("uuid"):
            return r
    return {}


def note_uuid(sid, t, turn, ph, found):
    """Put the uuid on the session record and the map while that message is still the session's
    last one (or Stop part A has not run yet)."""
    if not found.get("uuid"):
        return
    with C.Lock("session-" + sid):
        sf = C.path("sessions", sid + ".json")
        rec = C.read_json(sf)
        if not isinstance(rec, dict):
            return
        if not (rec.get("last_passage_hash") == ph or (rec.get("turn") == turn and rec.get("state") == "working")):
            return
        rec.update(last_assistant_uuid=found["uuid"], last_uuid_hash=ph)
        C.write_json(sf, rec)
        tf = C.path("terminals", C.tfile(t) + ".json")
        term = C.read_json(tf)
        if isinstance(term, dict) and term.get("session_id") == sid and term.get("last_passage_hash") == ph:
            term["last_assistant_uuid"] = found["uuid"]
            C.write_json(tf, term)


def hook_mode(input_file):
    try:
        os.setsid()
    except OSError:
        pass
    t0 = time.monotonic()
    try:
        with open(input_file, "rb") as f:
            raw = f.read()
    finally:
        try:
            os.unlink(input_file)
        except OSError:
            pass
    t = C.terminal_id()
    inp = json.loads(raw.decode("utf-8", "replace"))
    sid = inp.get("session_id") if isinstance(inp, dict) else None
    if not t or not isinstance(sid, str) or not sid or "/" in sid or inp.get("agent_id"):
        return
    if M.owner_conflict(t, sid):
        return
    cfg = K.load()
    rec = C.read_json(C.path("sessions", sid + ".json"), {}) or {}
    turn = int(rec.get("turn") or 0)
    prompt_id = rec.get("prompt_id")
    msg = inp.get("last_assistant_message") if isinstance(inp.get("last_assistant_message"), str) else ""
    ph = C.passage_hash(msg)
    transcript = inp.get("transcript_path") or rec.get("transcript_path")
    box = {"found": {}, "stopped": False, "stop_at": 0}

    def resolver():
        try:
            box["found"] = resolve_uuid(transcript, msg, t0) if msg else {}
        except Exception as ex:
            C.log(f"{t} uuid lookup error {sid}: {ex!r}")
        finally:
            box["stop_at"] = C.now_ms()
            S.stop(t, sid, turn=turn, prompt_id=prompt_id, text_path=C.path("turns", sid, f"{turn}.md"),
                   text_head=msg, passage_hash=ph, message_uuid=box["found"].get("uuid"),
                   api_message_id=box["found"].get("api_id"), at=box["stop_at"])
            box["stopped"] = True

    th = threading.Thread(target=resolver, daemon=True)
    th.start()
    try:
        res = X.extract(msg, cfg, rec, sid)
    finally:
        th.join(timeout=15)
        if not box["stopped"]:              # never leave a turn without its stop event
            box["stop_at"] = C.now_ms()
            S.stop(t, sid, turn=turn, prompt_id=prompt_id, text_path=C.path("turns", sid, f"{turn}.md"),
                   text_head=msg, passage_hash=ph, at=box["stop_at"])
    found = box["found"]
    # Spool files sort by name (<ms>-<type>-...): asks gets a later millisecond than stop.
    S.asks(t, sid, turn=turn, prompt_id=prompt_id, message_uuid=found.get("uuid"),
           api_message_id=found.get("api_id"), passage_hash=ph, result=res,
           at=max(C.now_ms(), box["stop_at"] + 1))
    note_uuid(sid, t, turn, ph, found)
    C.log(f"{t} extract {sid} turn={turn} source={res['source']} asks={len(res['asks'])} ms={res['ms']} "
          f"uuid={'yes' if found.get('uuid') else 'no'} err={res.get('error')}")
    if reinject_due(cfg, res) and M.mark_reinject(sid, turn):
        C.log(f"{t} reinject_pending {sid} turn={turn}")


def reinject_due(cfg, res):
    """The hybrid re-injection rule: the instruction is on, and the model (not a block) found a
    blocking ask in a message that carried no ledgr-asks block at all."""
    return (cfg.get("instruct_block") is True and cfg.get("instruct_reinject") is not False
            and res.get("source") == "model" and not res.get("block_found")
            and any(a.get("level") == "blocking" for a in res.get("asks") or []))


def retry_mode(sid, turn, t):
    cfg = K.load()
    rec = C.read_json(C.path("sessions", sid + ".json"), {}) or {}
    t = t or rec.get("terminal") or C.terminal_id() or "unknown"
    msg = C.read_text(C.path("turns", sid, f"{turn}.md"))
    res = X.extract(msg, cfg, rec, sid)
    found = last_assistant.find(rec.get("transcript_path"), msg) if msg else {}
    S.asks(t, sid, turn=turn, prompt_id=rec.get("prompt_id") if int(rec.get("turn") or 0) == turn else None,
           message_uuid=found.get("uuid"), api_message_id=found.get("api_id"),
           passage_hash=C.passage_hash(msg), result=res)
    print(json.dumps({"ok": res["source"] != "error", "source": res["source"], "asks": len(res["asks"]),
                      "error": res.get("error")}))


def dry_run(args):
    def opt(name, default=None):
        return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else default
    text_file = opt("--text-file")
    with open(text_file, encoding="utf-8") as f:
        msg = f.read()
    cfg = K.load(create=False)
    if opt("--mode"):
        cfg["extract"]["mode"] = opt("--mode")
    if opt("--provider"):
        cfg["extract"]["provider"] = opt("--provider")
    sid = opt("--session", "dry-run")
    rec = {"session_name": opt("--session-name", "fixture"), "repo": "fixtures",
           "cwd": os.path.dirname(os.path.abspath(text_file)), "turn": 1}
    res = X.extract(msg, cfg, rec, sid, snapshot_path=opt("--snapshot"))
    res["chars"] = len(msg)
    res["passage_hash"] = C.passage_hash(msg)
    print(json.dumps(res, ensure_ascii=False, indent=2))


def main(argv):
    a = argv[1:]
    if not a:
        print(__doc__)
        return 0
    if a[0] == "--dry-run":
        dry_run(a)
        return 0
    t = a[a.index("--terminal") + 1] if "--terminal" in a and a.index("--terminal") + 1 < len(a) else None
    try:
        if a[0] == "--input":
            hook_mode(a[1])
        elif a[0] == "--retry":
            retry_mode(a[1], int(a[2]), t)
    except BaseException as ex:  # noqa: BLE001
        import traceback
        C.log(f"extract error {a[0]}: {ex!r}")
        sys.stderr.write(traceback.format_exc())
        if a[0] == "--retry":
            print(json.dumps({"ok": False, "error": repr(ex)[:200]}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
