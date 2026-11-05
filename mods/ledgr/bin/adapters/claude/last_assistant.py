#!/usr/bin/env python3
"""last_assistant.py <transcript.jsonl> <expected-text-file>
Prints {"uuid", "api_id"} of the last main-thread assistant record that carries text, if its
text and the end of the expected text (Stop's last_assistant_message) agree; else {} (spec 4.2).

The transcript format is internal to Claude Code; observed 2026-11-05: assistant records have
type "assistant", uuid, isSidechain, message.id and message.content[] (one block per record,
records of one API message share message.id)."""
import json
import os
import sys

TAIL = 4_000_000


def find(path, expected):
    want = " ".join((expected or "").split())[-160:]
    if not want or not path:
        return {}
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            f.seek(max(0, size - TAIL))           # the tail is enough; the first line may be cut
            data = f.read().decode("utf-8", "replace")
    except OSError:
        return {}
    best = None
    for line in data.splitlines():
        if '"assistant"' not in line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        if not isinstance(r, dict) or r.get("type") != "assistant" or r.get("isSidechain"):
            continue
        msg = r.get("message") or {}
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, list):
            continue
        text = "".join(b.get("text", "") for b in content
                       if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str))
        if text.strip():
            best = (r.get("uuid"), msg.get("id"), " ".join(text.split()))
    if best and best[0] and (best[2].endswith(want) or want.endswith(best[2][-160:])):
        return {"uuid": best[0], "api_id": best[1]}
    return {}


if __name__ == "__main__":
    with open(sys.argv[2], encoding="utf-8") as f:
        expected_text = f.read()
    print(json.dumps(find(sys.argv[1], expected_text)))
