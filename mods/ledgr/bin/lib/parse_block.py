#!/usr/bin/env python3
"""parse_block.py < message
Prints {"found", "valid", "asks", "prose", "error", "rejected"} for the last ```ledgr-asks block (spec 4.3).

- Opening fence: ^ {0,3}(`{3,}|~{3,})[ \t]*ledgr-asks[ \t]*$
- It closes at the next line of only the same fence character, at least as many times.
- The last complete block wins. An unterminated block is ignored, as is anything after it.
- Body: a JSON array, or an object with an `asks` array; items go through ledgr_asks.validate.
  Each item may carry `level` (blocking | needed | optional); none means needed, any other value
  rejects that item (listed in `rejected`).
- Valid: the JSON parsed and at least one item survived, or the array was empty ("no asks").
- `prose` is the message with the block removed.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ledgr_asks  # noqa: E402

TAG = "ledgr-asks"
OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*" + re.escape(TAG) + r"[ \t]*$")


def parse(msg):
    lines = msg.split("\n")
    found, i = None, 0
    while i < len(lines):
        m = OPEN.match(lines[i])
        if m:
            fence = m.group(1)
            close = re.compile(r"^ {0,3}" + re.escape(fence[0]) + "{" + str(len(fence)) + r",}[ \t]*$")
            for j in range(i + 1, len(lines)):
                if close.match(lines[j]):
                    found = (i, j, "\n".join(lines[i + 1:j]))
                    i = j
                    break
            else:
                break                       # unterminated: ignore it and everything after
        i += 1

    out = {"found": bool(found), "valid": False, "asks": [], "prose": msg, "error": None, "rejected": []}
    if found:
        s, e, body = found
        out["prose"] = "\n".join(lines[:s] + lines[e + 1:])
        try:
            items = ledgr_asks.container(json.loads(body))
            out["asks"] = ledgr_asks.validate(items, out["prose"], "extract_block", rejected=out["rejected"])
            out["valid"] = bool(out["asks"]) or len(items) == 0
            if not out["valid"]:
                out["error"] = "no valid items" + (f" ({'; '.join(out['rejected'][:3])})" if out["rejected"] else "")
        except Exception as ex:
            out["error"] = f"block: {ex}"
    return out


if __name__ == "__main__":
    print(json.dumps(parse(sys.stdin.read()), ensure_ascii=False))
