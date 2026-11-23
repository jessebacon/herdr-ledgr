"""ledgr extraction pipeline (spec 4), agent-agnostic: the asks in an agent's final message.

extract(msg, cfg, rec, sid, snapshot_path=None, turn=None, turn_text=None) -> {source, asks, model,
provider, usage, ms, error, block_error, extract_request_id, [error_detail], [truncated], [rejected]}
  Every ask carries `level` (blocking | needed | optional, ledgr_asks.LEVELS); asks of every level
  are returned. Which levels become open rows is the mod's choice (config extract.threshold).
  `summary` (2026-11-23): what the user must do, readable without the reply. The model writes one for
  every ask (required in asks.schema.json); a block item or a tool declaration carries its own, which
  goes through unchanged (ledgr_asks.summary_of); none, and the key is left out.
  `rejected`: why asks were dropped for an unknown level (block or model), when any were.
  0. the turn was declared by tool (bin/mcp's declare_asks left ledgr-data/mcp/<session>/<turn>.json)
     and the reply has no valid non-empty block (a block is the newer statement and wins): source
     "tool", no model call, no re-injection. The declared asks are validated again with their quotes
     checked against the whole turn's text (`turn_text`: every assistant text of the turn, since the
     agent may write the quoted sentence before the call: the adapter's turn file; msg is added only
     when the turn text lacks it, whole_text), and go out with
     replaces_turn true, so the writer settles them with the turn's message uuid;
  1. under 40 characters: source "skip";
  2. parse_block: only a valid NON-EMPTY ledgr-asks block settles it (block-first mode, no model
     call); an empty or invalid block falls through to the model;
  3. otherwise the configured provider (bin/providers) on the message with the block removed, with
     the session's open and recently dismissed asks listed so a re-raised ask comes back with
     repeat_of instead of as a new item;
  4. every result goes through ledgr_asks.validate (quotes checked against the message, repeat_of
     checked against the listed handles);
  5. always-model: union, block asks win; block-only: never calls a model.
Adapters add the agent-specific parts (message ids, emitting the events).

session_items(sid) is how every Python reader (this module, bin/mcp) reads a session's items:
snapshot.json, or, for a session the writer moved out of store.json (retention Phase 2, "cold": idle for
retention.coldDays), the file snapshot.json's `cold` map names, filtered as the snapshot is. Read-only.
"""
import json
import os
import random
import re
import sys
import time

_LIB = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [p for p in (_LIB, os.path.dirname(_LIB)) if p not in sys.path]
import ledgr_core as C  # noqa: E402
import ledgr_asks as A  # noqa: E402
import parse_block  # noqa: E402
import providers  # noqa: E402

MIN_CHARS = 40
MAX_OPEN = 30
MAX_DISMISSED = 15
DISMISSED_DAYS = 7
OPEN_STATES = (None, "open", "deferred", "answered")
# Retention Phase 2 (cold sessions): the names the mod writes (config.js COLD_NAME, store.js COLD_FORMAT)
# and what store.js snapshot() keeps of an item (OPEN_STATES there, plus dismissed within 7 days).
COLD_NAME = re.compile(r"^(.+)\.(\d{13})-([0-9a-z]{6})\.json$")
COLD_FORMAT = "ledgr-cold"
SNAPSHOT_STATES = ("open", "answered", "deferred", "rejoin_pending")
SNAPSHOT_QUOTE = 200


def session_of(it):
    anc = it.get("anchor") if isinstance(it.get("anchor"), dict) else {}
    return anc.get("sessionId") or it.get("sessionId")


def _num(v):
    """store.js num(): a finite number (a numeric string included), else 0."""
    if isinstance(v, bool):
        return int(v)
    try:
        n = float(v) if isinstance(v, (int, float)) else float(v.strip() or 0) if isinstance(v, str) else 0.0
    except ValueError:
        return 0.0
    return n if n == n and n not in (float("inf"), float("-inf")) else 0.0


def snapshot_copy(it, now_ms):
    """One store.json item as store.js snapshot() writes it, or None when the snapshot leaves it out: kept
    are open, answered, deferred and rejoin_pending items, and dismissed ones within 7 days; the copy gets
    `sessionId` from its anchor, loses a quote over 200 characters (counted as JavaScript counts), and its
    draft, pins and summary (2026-11-23: the snapshot stays small; nothing that reads it needs one)."""
    st = it.get("status")
    when = it.get("resolvedAt") if it.get("resolvedAt") is not None else it.get("updatedAt")
    if st not in SNAPSHOT_STATES and not (st == "dismissed" and _num(when) >= now_ms - DISMISSED_DAYS * 86400_000):
        return None
    c = dict(it)
    anc = dict(it["anchor"]) if isinstance(it.get("anchor"), dict) else {}
    c["sessionId"] = anc.get("sessionId")
    q = anc.get("quote")
    if isinstance(q, str) and q and len(q.encode("utf-16-le")) // 2 > SNAPSHOT_QUOTE:
        del anc["quote"]
    c["anchor"] = anc
    c.pop("draft", None)
    c.pop("pins", None)
    c.pop("summary", None)
    return c


def _js(v, n):
    """JSON.stringify(v ?? null).slice(0, n), as store.js words a value."""
    return json.dumps(v, ensure_ascii=False)[:n]


def cold_record_error(rec, sid):
    """None, or why `rec` is not `sid`'s cold file: store.js coldRecordError, check for check and word for word
    (the writer's thaw and the reading copies refuse the same files)."""
    if not isinstance(rec, dict):
        return "not a cold file (no JSON object)"
    if rec.get("ledgr") != COLD_FORMAT:
        return f"not a cold file (ledgr {_js(rec.get('ledgr'), 40)})"
    v = rec.get("v")
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != 1:
        return f"cold file version {_js(v, 20)}, not 1"
    if not isinstance(sid, str) or not sid or rec.get("sessionId") != sid:
        sv = rec.get("sessionId")
        return f"the file is session {str('?' if sv is None else sv)[:40]}'s, not {str(sid)[:40]}"
    items, turns = rec.get("items"), rec.get("turns")
    if not isinstance(items, list):
        return "the file holds no item list"
    if turns is not None and not isinstance(turns, dict):
        return "the file's turn records are not a map"
    for i, it in enumerate(items):
        if not isinstance(it, dict) or not isinstance(it.get("id"), str) or not it["id"] or it["id"] == "__proto__":
            return f"item {i + 1} of the file has no id"
        if (it.get("anchor") if isinstance(it.get("anchor"), dict) else {}).get("sessionId") != sid:
            return f"item {it['id'][:40]} in the file is another session's"
    for k, r in (turns or {}).items():
        if k == "__proto__" or not isinstance(r, dict):
            return f"turn record {k[:20]} of the file is not a record"
    return None


def cold_record(sid, file, data_dir=None):
    """(record, None), or (None, why) when ledgr-data/cold/<file> cannot be read as `sid`'s cold file, in the
    writer's words (writer.js readCold): the name (config.js COLD_NAME, no folder), the read (any size: open()
    has no cap), the JSON, then the record (cold_record_error)."""
    m = COLD_NAME.match(file) if isinstance(file, str) else None
    # A name beginning with "." only as this session's own (writer.js readCold: one frozen before such ids were refused).
    if not (m and "/" not in file and "\\" not in file and (not file.startswith(".") or m.group(1) == safe_name(sid))):
        return None, f"not a cold file name: {_js(file, 80)}"
    try:
        with open(os.path.join(data_dir or C.DATA, "cold", file), encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        return None, f"cold/{file} is missing"
    except (OSError, ValueError) as ex:
        return None, f"cold/{file} could not be read ({str(getattr(ex, 'strerror', None) or ex)[:160]})"
    try:
        rec = json.loads(text)
    except ValueError as ex:
        return None, f"cold/{file} does not parse ({str(ex)[:120]})"
    bad = cold_record_error(rec, sid)
    return (None, f"cold/{file}: {bad}") if bad else (rec, None)


def session_items(sid, snapshot_path=None, now_ms=None):
    """-> (items, cold): this session's items as snapshot.json carries them (store.js snapshot()).

    A warm session's come from the snapshot's `items`. A cold one (retention Phase 2: the writer moved its
    items and turn records to ledgr-data/cold/<file> and kept its record in store.json; the snapshot's
    `cold` map names it) reads that file, filtered as snapshot() filters (snapshot_copy); items the
    snapshot itself carries for it (a "mixed" session an older build left) come first and win by id.
    `cold` is None for a warm session, else {"file", "fault" (the writer's s.cold.fault.error: it cannot
    read the file and holds the session's events; else None), "error" (why it could not be read here;
    else None)}. A read that fails reads snapshot.json once more first: a thaw may have moved on (the
    file then stays at least an hour after it, so a snapshot that names it finds it). With no sid, every
    item of the snapshot, as before. Read-only."""
    path = snapshot_path or C.path("snapshot.json")
    now_ms = now_ms or C.now_ms()
    for attempt in range(2):
        snap = C.read_json(path, {})
        snap = snap if isinstance(snap, dict) else {}
        items = snap.get("items")
        items = list(items.values()) if isinstance(items, dict) else items if isinstance(items, list) else []
        items = [it for it in items if isinstance(it, dict)]
        if not sid:
            return items, None
        mine = [it for it in items if session_of(it) == sid]
        ent = (snap.get("cold") if isinstance(snap.get("cold"), dict) else {}).get(sid)
        if not isinstance(ent, dict):
            return mine, None
        file = ent.get("file") if isinstance(ent.get("file"), str) else None
        fault = ent.get("fault") if isinstance(ent.get("fault"), str) and ent.get("fault") else None
        rec, error = cold_record(sid, file, os.path.dirname(os.path.abspath(path)))
        if error and attempt == 0:
            continue                          # read the snapshot again once: it may have moved on
        cold = {"file": file, "fault": fault, "error": error}
        have = {it.get("id") for it in mine}
        for it in (rec or {}).get("items") or []:
            if isinstance(it, dict) and it.get("id") not in have and session_of(it) == sid:
                c = snapshot_copy(it, now_ms)
                if c is not None:
                    mine.append(c)
        return mine, cold
    return [], None                           # not reached


def recorded_asks(sid, snapshot_path=None, now_ms=None, items=None):
    """This session's agent asks from the mod's snapshot.json (through session_items, so a cold session's
    come from its file; `items`: that list when the caller has read it already):
    (open [(handle, text)], recently dismissed [(handle, text)], known {handle: {id, status}})."""
    now_ms = now_ms or C.now_ms()
    if items is None:
        items = session_items(sid, snapshot_path, now_ms)[0]
    open_, dismissed, known = [], [], {}
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict) or it.get("direction") != "agent_to_human":
            continue
        anc = it.get("anchor") if isinstance(it.get("anchor"), dict) else {}
        if sid and anc.get("sessionId") != sid:
            continue
        h, text, st = it.get("handle"), it.get("text"), it.get("status")
        if not (isinstance(h, str) and A.HANDLE.match(h) and isinstance(text, str)):
            continue
        if st in OPEN_STATES and len(open_) < MAX_OPEN:
            open_.append((h, C.squash(text)[:200]))
        elif st == "dismissed" and len(dismissed) < MAX_DISMISSED:
            when = it.get("resolvedAt") or it.get("updatedAt")
            if isinstance(when, (int, float)) and now_ms - when > DISMISSED_DAYS * 86400_000:
                continue
            dismissed.append((h, C.squash(text)[:200]))
        else:
            continue
        known[h] = {"id": it.get("id"), "status": st or "open"}
    return open_, dismissed, known


def safe_name(name):
    """A session id as bin/mcp names its folder: every character outside A-Za-z0-9._- becomes _."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", str(name))


def tool_declaration(sid, turn):
    """The turn's declare_asks state (bin/mcp writes ledgr-data/mcp/<session>/<turn>.json), or None."""
    if turn is None or not sid:
        return None
    try:
        d = C.read_json(C.path("mcp", safe_name(sid), f"{int(turn)}.json"))
    except (TypeError, ValueError):
        return None
    if isinstance(d, dict) and d.get("session_id") == sid and d.get("turn") == int(turn) and isinstance(d.get("asks"), list):
        return d
    return None


def tool_asks(decl, sid, turn, text, snapshot_path=None):
    """A turn's declared asks, validated again at Stop: quotes against the turn's text, repeat_of
    against the session's recorded asks (this turn's own left out: they are the declaration itself).
    Options and the recommendation come from the declaration, else from the writer's item in
    snapshot.json (a cold session's from its file, session_items); when neither has them the key is left
    out, so the writer keeps the item's own. The summary comes from the declaration alone, unchanged (the
    snapshot carries none); a declaration without one (an older server) leaves the key out, and the writer
    keeps the item's own."""
    items = session_items(sid, snapshot_path)[0]
    mine = {}
    for it in items:
        anc = it.get("anchor") if isinstance(it, dict) and isinstance(it.get("anchor"), dict) else {}
        if anc.get("sessionId") == sid and it.get("direction") == "agent_to_human" and it.get("origin") == "tool" \
                and turn in (it.get("createdTurn"), anc.get("turn")) and isinstance(it.get("text"), str):
            mine[A.norm_key(it["text"])] = it
    _, _, known = recorded_asks(sid, snapshot_path, items=items)
    known = {h: v for h, v in known.items() if not any(x.get("handle") == h for x in mine.values())}
    raw, keep_opts = [], set()
    for a in decl.get("asks") or []:
        if not isinstance(a, dict):
            continue
        r = {k: a.get(k) for k in ("text", "level", "kind", "quote", "summary")}
        r["repeat_of"] = a.get("repeat_of_handle") or a.get("repeat_of")
        src = a if isinstance(a.get("options"), list) else mine.get(A.norm_key(a.get("text") or ""))
        if isinstance(src, dict) and isinstance(src.get("options"), list):
            r["options"], r["recommended"] = src.get("options"), src.get("recommended")
            keep_opts.add(A.norm_key(a.get("text") or ""))
        raw.append(r)
    out = A.validate(raw, text, "tool", known)
    for v in out:
        v["quote_verified"] = True if v["quote"] else None
        if A.norm_key(v["text"]) not in keep_opts:
            v.pop("options", None)
            v.pop("recommended", None)
    return out


def whole_text(turn_text, msg):
    """The text a declared quote is checked against: the turn's text (the turn file, which ends with
    the final message since 2026-11-10), with msg added only when it is not in it already, so no
    passage is there twice."""
    if turn_text and (not (msg or "").strip() or C.squash(msg) in C.squash(turn_text)):
        return turn_text
    return "\n\n".join(x for x in (turn_text, msg) if x)


def user_text(prose, rec, open_, dismissed, max_chars):
    lines = [f"SESSION: {rec.get('session_name') or 'unnamed'} ({rec.get('repo') or '?'}, {rec.get('cwd') or '?'})"]
    lines.append("OPEN ASKS (already recorded for this session):" if open_ else "OPEN ASKS: none")
    lines += [f"{h}: {t}" for h, t in open_]
    lines.append("RECENTLY DISMISSED ASKS (closed by the user; list one again only if this message raises it again):"
                 if dismissed else "RECENTLY DISMISSED ASKS: none")
    lines += [f"{h}: {t}" for h, t in dismissed]
    body = prose
    if len(body) > max_chars:
        body = body[-max_chars:]
        lines.append("(message truncated at the start)")
    lines += ["MESSAGE:", "<message>", body, "</message>"]
    return "\n".join(lines)


def model_asks(prose, cfg, rec, sid, snapshot_path=None):
    """Call the configured provider; returns (asks, provider_result)."""
    max_chars = int((cfg.get("extract") or {}).get("max_chars") or 60000)
    system = C.read_text(os.path.join(C.LIB, "extract-system.txt"))
    open_, dismissed, known = recorded_asks(sid, snapshot_path)
    r = providers.call(cfg, system, user_text(prose, rec, open_, dismissed, max_chars), A.schema())
    r["truncated"] = len(prose) > max_chars
    if not r.get("ok"):
        return [], r
    try:
        data = r["data"] if r.get("data") is not None else A.parse_json_text(r["text"])
        items = A.container(data)
    except Exception as ex:
        r["ok"], r["error"] = False, f"invalid JSON from model: {ex}"[:300]
        return [], r
    rejected = []
    asks = A.validate(items, prose, "extract_model", known, rejected=rejected)
    if rejected:
        r["rejected"] = rejected
    return asks, r


def extract(msg, cfg, rec, sid, snapshot_path=None, turn=None, turn_text=None):
    t0 = time.monotonic()
    ex = cfg.get("extract") or {}
    mode = ex.get("mode") or "block-first"
    res = {"source": None, "asks": [], "model": None, "provider": None, "usage": None, "ms": 0,
           "error": None, "block_error": None, "extract_request_id": None}

    def done():
        res["ms"] = int((time.monotonic() - t0) * 1000)
        return res

    def take(r):
        res.update(model=r.get("model"), provider=r.get("provider"), usage=r.get("usage") or None,
                   extract_request_id=r.get("request_id"))
        if r.get("truncated"):
            res["truncated"] = True
        if r.get("detail"):
            res["error_detail"] = r["detail"]
        if r.get("rejected"):
            res["rejected"] = (res.get("rejected") or []) + r["rejected"][:10]

    decl = tool_declaration(sid, turn)
    pb = parse_block.parse(msg or "")
    if decl is not None and not (pb["found"] and pb["valid"] and pb["asks"]):
        res.update(source="tool", provider="mcp", replaces_turn=True, quotes="verified", tool_calls=decl.get("calls"))
        res["asks"] = tool_asks(decl, sid, turn, whole_text(turn_text, msg), snapshot_path)
        if pb.get("pointer"):
            res["pointer"] = pb["pointer"]
        if pb["found"]:
            res["block_found"], res["block_error"] = True, pb["error"]
        return done()
    if len((msg or "").strip()) < MIN_CHARS:
        res["source"] = "skip"
        return done()
    res["block_found"] = pb["found"]                                    # the agent wrote a block (any)
    if pb.get("form"):
        res["block_form"] = pb["form"]                                  # bullets | json | mixed
    if pb.get("pointer"):
        res["pointer"] = pb["pointer"]                                  # "ledgr: N items for you, M blocking"
    block_ok = pb["found"] and pb["valid"] and len(pb["asks"]) > 0     # only a non-empty block counts
    if pb["found"] and not pb["valid"]:
        res["block_error"] = pb["error"]
    if pb.get("rejected"):
        res["rejected"] = pb["rejected"][:10]

    if mode == "block-only":
        res["source"], res["asks"] = ("block", pb["asks"]) if block_ok else ("skip", [])
        return done()

    if block_ok and mode != "always-model":                 # block-first (the default)
        res["source"], res["asks"] = "block", pb["asks"]
        rate = float(ex.get("audit_rate") or 0)
        if rate > 0 and random.random() < rate:
            asks, r = model_asks(pb["prose"], cfg, rec, sid, snapshot_path)
            if r.get("ok"):
                have = {A.norm_key(a["text"]) for a in pb["asks"]}
                C.log(json.dumps({"session_id": sid, "turn": rec.get("turn"),
                                  "block": [a["text"] for a in pb["asks"]],
                                  "model": [a["text"] for a in asks],
                                  "missing_in_block": [a["text"] for a in asks if A.norm_key(a["text"]) not in have]},
                                 ensure_ascii=False), name="extract-audit.jsonl")
        return done()

    asks, r = model_asks(pb["prose"], cfg, rec, sid, snapshot_path)
    take(r)
    if not r.get("ok"):
        res["error"] = r.get("error") or "model call failed"
        if block_ok:                                          # always-model: the block still counts
            res["source"], res["asks"] = "block", pb["asks"]
        else:
            res["source"] = "error"
        return done()
    if block_ok:                                              # always-model union: block wins
        keys = {A.norm_key(a["text"]) for a in pb["asks"]}
        quotes = {C.squash(a["quote"]) for a in pb["asks"] if a.get("quote")}
        extra = [a for a in asks if A.norm_key(a["text"]) not in keys
                 and not (a.get("quote") and C.squash(a["quote"]) in quotes)]
        res["source"], res["asks"] = "block", pb["asks"] + extra
    else:
        res["source"], res["asks"] = "model", asks
    return done()
