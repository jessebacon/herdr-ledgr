"""ledgr Claude Code adapter: drives lib/ledgr_extract.py for Claude sessions and adds the
Claude-specific anchor, the transcript record uuid of the final message. The uuid is optional:
every anchor also carries turn + passage_hash.

  --input <file>          Stop part B, started detached by stop.sh (with LEDGR_INNER=1) after part
                          A accepted the event. <file> holds the Stop hook JSON; it is deleted after
                          reading. A resolver thread looks up the uuid (retries at 0, 1, 2, 4 s) and,
                          for a turn part A saved lagged (the transcript did not hold the final message
                          yet), re-reads the whole turn on the same looks; once the transcript holds it,
                          the turn files are rewritten with it. Then it emits `stop` carrying the uuid;
                          the extraction runs meanwhile (a declared turn of a lagged file waits for the
                          resolver first, its quotes are checked against quote_text); `asks` follows.
  --retry <sid> <turn>    Re-run on the turn's final message (turns/<sid>/<turn>.json "message", else
                          the .md) with the .md as the whole turn (a lagged turn gets one more look at
                          the transcript first), emit `asks`, print a JSON summary.
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


def follow(transcript, msg, t0, lagged, prompt_id=None, offsets=UUID_OFFSETS):
    """Part B's one schedule (UUID_OFFSETS: looks at 0, 1, 2 and 4 s after part B started, so about
    4 s at most): at each look, the final message's uuid until found and, for a lagged turn, the whole
    turn until the transcript holds the final message. A look at a lagged turn whose transcript's
    last prompt is another turn's (its promptId is not prompt_id) skips the uuid lookup, which would
    match an earlier reply with the same text. Returns {"found": {uuid, api_id} or {}, "whole": the
    first consistent whole_turn() or None, "partial": the last read that was not (a whole_turn()
    dict) or None}."""
    out = {"found": {}, "whole": None, "partial": None}
    if not msg:
        return out
    for off in offsets:
        wait = t0 + off - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        other = False
        if lagged and out["whole"] is None:
            w = last_assistant.whole_turn(transcript, msg, prompt_id)
            if w["consistent"]:
                out["whole"] = w
            elif w["source"] == "transcript":
                out["partial"] = w
                other = bool(prompt_id and w["prompt_id"] and w["prompt_id"] != prompt_id)
        if not out["found"].get("uuid") and not other:
            out["found"] = last_assistant.find(transcript, msg)
        if out["found"].get("uuid") and (out["whole"] is not None or not lagged):
            break
    return out


def lagged_turn(sid, turn, msg):
    """True when part A saved this turn's fallback for part B to re-read (its .json says lagged, for
    this final message)."""
    meta = C.read_json(C.path("turns", sid, f"{turn}.json"), {})
    return bool((msg or "").strip()) and isinstance(meta, dict) and meta.get("lagged") is True \
        and meta.get("message") == msg[:M.MAX_TURN_TEXT]


def catch_up(sid, turn, msg, got):
    """A lagged turn whose transcript caught up: both turn files rewritten with the whole turn
    (ledgr_map.rewrite_turn: atomic, the same format, only while still lagged)."""
    w = got.get("whole")
    return bool(w) and M.rewrite_turn(sid, turn, msg, w["text"], w["blocks"])


def quote_text(sid, turn, msg, lagged, got, prompt_id=None):
    """The text a declared turn's quotes are checked against. Not lagged: the turn file part A wrote
    (the whole turn). Lagged and caught up: the whole turn part B read. Lagged to the end of the
    schedule: the union of the fallback (the turn file: the final message, always complete) and what
    the transcript held of this turn (its starting prompt's promptId, when both are known, must be
    the turn's), never that partial turn alone, so a quote in the final message is never dropped."""
    md = C.read_text(C.path("turns", sid, f"{turn}.md"))
    if not lagged:
        return md or None
    if got.get("whole"):
        return got["whole"]["text"]
    p = got.get("partial")
    seen = p["text"] if p and (not prompt_id or not p.get("prompt_id") or p["prompt_id"] == prompt_id) else ""
    return X.whole_text(seen, md or msg) or None


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
    lagged = lagged_turn(sid, turn, msg)
    box = {"found": {}, "whole": None, "partial": None, "stopped": False, "stop_at": 0}

    def resolver():
        try:
            box.update(follow(transcript, msg, t0, lagged, prompt_id))
            if catch_up(sid, turn, msg, box):    # before `stop`: the writer's reanchor reads the whole turn
                C.log(f"{t} turn text {sid} turn={turn} caught up with the transcript")
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
        # A declared turn's quotes are checked against the whole turn; a lagged one's wait for the
        # resolver's re-reads (the schedule's end at most).
        whole = None
        if X.tool_declaration(sid, turn):
            if lagged:
                th.join(timeout=15)
            whole = quote_text(sid, turn, msg, lagged, box, prompt_id)
        res = X.extract(msg, cfg, rec, sid, turn=turn, turn_text=whole)
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
          f"uuid={'yes' if found.get('uuid') else 'no'} err={res.get('error')}"
          + (f" lagged={'caught-up' if box['whole'] else 'kept'}" if lagged else ""))
    if reinject_due(cfg, res) and M.mark_reinject(sid, turn):
        C.log(f"{t} reinject_pending {sid} turn={turn}")


def reinject_due(cfg, res):
    """The hybrid re-injection rule: the instruction is on, and the model (not a block) found a
    blocking ask in a message that carried no ledgr-asks block at all."""
    return (K.handoff(cfg) != "prose" and cfg.get("instruct_reinject") is not False
            and res.get("source") == "model" and not res.get("block_found")
            and any(a.get("level") == "blocking" for a in res.get("asks") or []))


def retry_mode(sid, turn, t):
    cfg = K.load()
    rec = C.read_json(C.path("sessions", sid + ".json"), {}) or {}
    t = t or rec.get("terminal") or C.terminal_id() or "unknown"
    whole = C.read_text(C.path("turns", sid, f"{turn}.md"))
    meta = C.read_json(C.path("turns", sid, f"{turn}.json"), {})
    # The final message, as Stop extracted it; a turn saved before the .json (2026-11-10) is its .md.
    msg = meta["message"] if isinstance(meta, dict) and isinstance(meta.get("message"), str) else whole
    lagged = lagged_turn(sid, turn, msg)
    pid = rec.get("prompt_id") if int(rec.get("turn") or 0) == turn else None
    got = follow(rec.get("transcript_path"), msg, time.monotonic(), lagged, pid, offsets=(0,))   # one look
    catch_up(sid, turn, msg, got)
    whole = quote_text(sid, turn, msg, lagged, got, pid) if lagged else whole
    res = X.extract(msg, cfg, rec, sid, turn=turn, turn_text=whole)   # a declared turn is re-settled, not re-extracted
    found = got["found"]
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
