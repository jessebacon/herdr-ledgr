"""ledgr: the one validator for asks, shared by the ledgr-asks block parser and every model
provider. Provider structured-output modes are never trusted: whatever a provider returns goes
through validate() before it reaches the spool.

Each valid ask: {text, kind, level, options, recommended, blocking, quote, repeat_of, repeat_of_handle, hash, origin}
  level = how much the work depends on it: "blocking" (the agent stopped or cannot finish without it),
  "needed" (the person must act for the task to be truly done; the agent went on), "optional" (an
  offer or a suggestion). No level: "needed" ("blocking" when a legacy block says "blocking": true).
  Any other value rejects the ask. blocking = (level == "blocking"), kept for older readers.
  hash = sha1 of the whitespace-collapsed passage (quote, else text), first 12 hex chars.
  repeat_of = the Request id ("rq_...") of an open or recently dismissed item the ask repeats,
  repeat_of_handle = its handle ("A5"); both null unless the model named a listed handle.
"""
import json
import os
import re

from ledgr_core import LIB, passage_hash, squash

KINDS = {"decide", "confirm", "do", "provide", "review"}
LEVELS = ("optional", "needed", "blocking")      # lowest to highest; extract.threshold uses the same names
DEFAULT_LEVEL = "needed"
MAX_ASKS = 20
MAX_TEXT = 400
MAX_QUOTE = 600
MAX_OPTIONS = 8
HANDLE = re.compile(r"^A\d{1,6}$")


def schema():
    with open(os.path.join(LIB, "asks.schema.json"), encoding="utf-8") as f:
        return json.load(f)


def container(data):
    """The list of ask objects in a parsed body: a JSON array, or an object with an `asks` array."""
    items = data.get("asks") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise ValueError("not a list")
    return items


def level_of(it):
    """The ask's level, or None when it names one that does not exist (the ask is then rejected).
    Missing or null: "needed", or "blocking" for a legacy `"blocking": true`. Case and surrounding
    space are ignored ("Blocking " is blocking); anything else ("urgent", 2, "") is unknown."""
    lv = it.get("level")
    if lv is None:
        return "blocking" if it.get("blocking") is True else DEFAULT_LEVEL
    if isinstance(lv, str) and lv.strip().lower() in LEVELS:
        return lv.strip().lower()
    return None


def validate(items, prose, origin, known=None, rejected=None):
    """Normalise raw ask objects. Drops items without a non-empty string `text`, and items whose
    `level` is not blocking, needed or optional (a reason per drop goes to `rejected`, a list, when
    given); a quote is kept only if it is a whitespace-normalised substring of `prose`. `known` maps
    the handles shown to the model to {"id", "status"}; a repeat_of outside it is dropped (never
    trust an invented id)."""
    known = known or {}
    norm_prose = squash(prose)
    out = []
    for i, it in enumerate(items[:MAX_ASKS]):
        if not isinstance(it, dict) or not isinstance(it.get("text"), str) or not it["text"].strip():
            continue
        level = level_of(it)
        if level is None:
            if rejected is not None:
                rejected.append(f"ask {i + 1}: unknown level {it.get('level')!r}")
            continue
        text = squash(it["text"])[:MAX_TEXT]
        opts = [squash(o) for o in (it.get("options") or []) if isinstance(o, str) and o.strip()][:MAX_OPTIONS] \
            if isinstance(it.get("options"), list) else []
        rec = it.get("recommended")
        rec = squash(rec) if isinstance(rec, str) else None
        q = it.get("quote") if isinstance(it.get("quote"), str) else None
        q = q if q and squash(q) and squash(q) in norm_prose else None
        if q and len(q) > MAX_QUOTE:
            q = q[:MAX_QUOTE]
        rep = it.get("repeat_of")
        rep = rep.strip() if isinstance(rep, str) and HANDLE.match(rep.strip()) and rep.strip() in known else None
        out.append({
            "text": text,
            "kind": it.get("kind") if it.get("kind") in KINDS else "do",
            "level": level,
            "options": opts,
            "recommended": rec if rec in opts else None,
            "blocking": level == "blocking",
            "quote": q,
            "repeat_of": (known[rep].get("id") or rep) if rep else None,
            "repeat_of_handle": rep,
            "hash": passage_hash(q or text),
            "origin": origin,
        })
    return out


def parse_json_text(text):
    """Parse a model's JSON reply. Tolerates a ```json fence around it (some providers add one)."""
    t = (text or "").strip()
    m = re.match(r"^```[A-Za-z0-9_-]*[ \t]*\n(.*)\n```\s*$", t, re.S)
    if m:
        t = m.group(1)
    return json.loads(t)


def norm_key(s):
    """Spec 3.4 norm(), the same rule as store.js norm(): strip markdown and list numbering,
    lower-case, collapse whitespace, drop trailing punctuation, first 160 characters."""
    s = re.sub(r"(?m)^\s*(?:\d+[.)]|[-*+])\s+", "", s or "")
    s = re.sub(r"[`*_~>#]+", "", s).lower()
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"[\s.,;:!?]+$", "", s)
    return s[:160]
