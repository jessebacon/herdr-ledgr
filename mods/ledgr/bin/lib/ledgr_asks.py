"""ledgr: the one validator for asks, shared by the ledgr-asks block parser and every model
provider. Provider structured-output modes are never trusted: whatever a provider returns goes
through validate() before it reaches the spool.

Each valid ask: {text, kind, options, recommended, blocking, quote, repeat_of, repeat_of_handle, hash, origin}
  hash = sha1 of the whitespace-collapsed passage (quote, else text), first 12 hex chars.
  repeat_of = the Request id ("rq_...") of an open or recently dismissed item the ask repeats,
  repeat_of_handle = its handle ("A5"); both null unless the model named a listed handle.
"""
import json
import os
import re

from ledgr_core import LIB, passage_hash, squash

KINDS = {"decide", "confirm", "do", "provide", "review"}
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


def validate(items, prose, origin, known=None):
    """Normalise raw ask objects. Drops items without a non-empty string `text`; a quote is kept
    only if it is a whitespace-normalised substring of `prose`. `known` maps the handles shown to
    the model to {"id", "status"}; a repeat_of outside it is dropped (never trust an invented id)."""
    known = known or {}
    norm_prose = squash(prose)
    out = []
    for it in items[:MAX_ASKS]:
        if not isinstance(it, dict) or not isinstance(it.get("text"), str) or not it["text"].strip():
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
            "options": opts,
            "recommended": rec if rec in opts else None,
            "blocking": it.get("blocking") is True,
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
