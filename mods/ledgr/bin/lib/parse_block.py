#!/usr/bin/env python3
"""parse_block.py < message
Prints {"found", "valid", "asks", "prose", "error", "rejected", "form", "pointer"} for the last
```ledgr-asks block (spec 4.3).

- Opening fence: ^ {0,3}(`{3,}|~{3,})[ \t]*ledgr-asks[ \t]*$
- It closes at the next line of only the same fence character, at least as many times.
- Also read: a <ledgr-asks> line closed by a </ledgr-asks> line (a model sometimes writes the tag
  as XML; seen live from Haiku, 2026-11-06). Same rules otherwise.
- The last complete block wins. An unterminated block is ignored, as is anything after it.
- Body, one of two forms (`form`), never both (a block that mixes them is rejected whole):
  - "bullets", the readable form the instruction asks for: one line per item,
      - blocking · decide · Choose the default template · "the sentence it comes from" · options: compact | detailed
    fields separated by " · ": level (blocking | needed | optional, required), kind (decide | confirm
    | do | provide | review, required), text (required), then optionally the quote in straight or
    curly double quotes and `options:` with choices separated by " | ", in either order. A bullet
    that breaks the shape is rejected with a reason ("ask 2: missing level ..."); a non-bullet line
    is reported and skipped.
  - "json": a JSON array, or an object with an `asks` array. An item without `level` is needed; an
    unknown level rejects that item.
  Both go through the one validator, ledgr_asks.validate (levels, kinds, quote check, limits).
- Valid: at least one item survived, or the JSON array was empty ("no asks").
- `prose` is the message with the block removed. `pointer`: the last line of the prose of the form
  "ledgr: N items for you, M blocking" ("ledgr: 1 item for you") as {line, items, blocking}, else null
  (the line authoritative mode, asks.handoff "ledgr", ends the prose with).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ledgr_asks  # noqa: E402

TAG = "ledgr-asks"
OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*" + re.escape(TAG) + r"[ \t]*$")
OPEN_XML = re.compile(r"^ {0,3}<" + re.escape(TAG) + r">[ \t]*$")
CLOSE_XML = re.compile(r"^ {0,3}</" + re.escape(TAG) + r">[ \t]*$")
BULLET = re.compile(r"^\s*[-*\u2022]\s+(.*?)\s*$")
SEP = re.compile(r"\s+\u00b7\s+")                                   # " · "
QUOTED = re.compile(r'^["\u201c](.*)["\u201d]$', re.S)                # "..." or \u201c...\u201d
OPTIONS = re.compile(r"^options\s*:\s*(.*)$", re.I)
JSONISH = re.compile(r"^\s*[\[\]{}]")
POINTER = re.compile(r"^[\s*_`>]*ledgr:\s*(\d+)\s+items?\s+for\s+you(?:\s*,\s*(\d+)\s+blocking)?[\s.*_`]*$", re.I)


def pointer_of(prose):
    """The last "ledgr: N items for you[, M blocking]" line of the prose, or None."""
    for line in reversed(prose.split("\n")):
        m = POINTER.match(line)
        if m:
            return {"line": line.strip(), "items": int(m.group(1)), "blocking": int(m.group(2) or 0)}
    return None


def bullet_items(body, rejected):
    """The bullet form's items as raw dicts for ledgr_asks.validate; a reason per malformed bullet
    (and per stray line) goes to `rejected`."""
    items, n = [], 0
    for ln, line in enumerate(body.split("\n"), 1):
        if not line.strip():
            continue
        m = BULLET.match(line)
        if not m:
            rejected.append(f"line {ln}: not a bullet (- level \u00b7 kind \u00b7 text)")
            continue
        n += 1
        parts = [x.strip() for x in SEP.split(m.group(1))]
        why = None
        lv, kind = (parts + ["", ""])[0].lower(), (parts + ["", ""])[1].lower()
        if lv not in ledgr_asks.LEVELS:
            why = (f"missing level (blocking, needed or optional) before the kind {parts[0]!r}" if lv in ledgr_asks.KINDS
                   else f"unknown level {parts[0]!r}")
        elif len(parts) < 2 or kind not in ledgr_asks.KINDS:
            why = f"unknown kind {parts[1]!r} (decide, confirm, do, provide or review)" if len(parts) > 1 else "missing kind and text"
        elif len(parts) < 3 or not parts[2] or QUOTED.match(parts[2]) or OPTIONS.match(parts[2]):
            why = "missing text (level \u00b7 kind \u00b7 text)"
        it = {"level": lv, "kind": kind, "text": parts[2] if len(parts) > 2 else ""}
        for f in parts[3:] if not why else []:
            q, o = QUOTED.match(f), OPTIONS.match(f)
            if q and "quote" not in it:
                it["quote"] = q.group(1).strip()
            elif o and "options" not in it:
                it["options"] = [x.strip() for x in o.group(1).split("|") if x.strip()]
            else:
                why = f"field {f[:40]!r} is neither a quoted passage nor options, or repeats one"
                break
        if why:
            rejected.append(f"ask {n}: {why}")
        else:
            items.append(it)
    return items


def parse(msg):
    lines = msg.split("\n")
    found, i = None, 0
    while i < len(lines):
        m = OPEN.match(lines[i])
        if m or OPEN_XML.match(lines[i]):
            close = CLOSE_XML if not m else \
                re.compile(r"^ {0,3}" + re.escape(m.group(1)[0]) + "{" + str(len(m.group(1))) + r",}[ \t]*$")
            for j in range(i + 1, len(lines)):
                if close.match(lines[j]):
                    found = (i, j, "\n".join(lines[i + 1:j]))
                    i = j
                    break
            else:
                break                       # unterminated: ignore it and everything after
        i += 1

    out = {"found": bool(found), "valid": False, "asks": [], "prose": msg, "error": None, "rejected": [],
           "form": None, "pointer": None}
    if found:
        s, e, body = found
        out["prose"] = "\n".join(lines[:s] + lines[e + 1:])
        rows = [x for x in body.split("\n") if x.strip()]
        bullets = [x for x in rows if BULLET.match(x)]
        try:
            if bullets and (body.strip()[:1] in "[{" or any(JSONISH.match(x) for x in rows if not BULLET.match(x))):
                out["form"] = "mixed"
                raise ValueError("mixes a JSON array and bullets; use one form")
            if bullets:
                out["form"] = "bullets"
                items = bullet_items(body, out["rejected"])
            else:
                out["form"] = "json"
                items = ledgr_asks.container(json.loads(body))
            out["asks"] = ledgr_asks.validate(items, out["prose"], "extract_block", rejected=out["rejected"])
            out["valid"] = bool(out["asks"]) or (out["form"] == "json" and len(items) == 0)
            if not out["valid"]:
                out["error"] = "no valid items" + (f" ({'; '.join(out['rejected'][:3])})" if out["rejected"] else "")
        except Exception as ex:
            out["error"] = f"block: {ex}"
    out["pointer"] = pointer_of(out["prose"])
    return out


if __name__ == "__main__":
    print(json.dumps(parse(sys.stdin.read()), ensure_ascii=False))
