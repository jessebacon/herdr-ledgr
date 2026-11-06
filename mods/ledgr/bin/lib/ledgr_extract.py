"""ledgr extraction pipeline (spec 4), agent-agnostic: the asks in an agent's final message.

extract(msg, cfg, rec, sid, snapshot_path=None) -> {source, asks, model, provider, usage, ms, error,
block_error, extract_request_id, [error_detail], [truncated], [rejected]}
  Every ask carries `level` (blocking | needed | optional, ledgr_asks.LEVELS); asks of every level
  are returned. Which levels become open rows is the mod's choice (config extract.threshold).
  `rejected`: why asks were dropped for an unknown level (block or model), when any were.
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
"""
import json
import os
import random
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


def recorded_asks(sid, snapshot_path=None, now_ms=None):
    """This session's agent asks from the mod's snapshot.json:
    (open [(handle, text)], recently dismissed [(handle, text)], known {handle: {id, status}})."""
    snap = C.read_json(snapshot_path or C.path("snapshot.json"), {})
    items = snap.get("items") if isinstance(snap, dict) else None
    if isinstance(items, dict):
        items = list(items.values())
    now_ms = now_ms or C.now_ms()
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


def extract(msg, cfg, rec, sid, snapshot_path=None):
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

    if len((msg or "").strip()) < MIN_CHARS:
        res["source"] = "skip"
        return done()
    pb = parse_block.parse(msg)
    res["block_found"] = pb["found"]                                    # the agent wrote a block (any)
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
