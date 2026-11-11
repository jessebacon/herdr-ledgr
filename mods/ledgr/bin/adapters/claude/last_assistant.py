#!/usr/bin/env python3
"""last_assistant.py <transcript.jsonl> <expected-text-file>
Prints {"uuid", "api_id"} of the last main-thread assistant record that carries text, if its
text and the end of the expected text (Stop's last_assistant_message) agree; else {} (spec 4.2).
whole_turn() (2026-11-10) gives Stop part A the whole turn's assistant text for turns/<sid>/<turn>.md:
every text block since the person's prompt, so a reply that called a tool between two texts (the
declare_asks path) is saved whole, not only the part after the last tool call. Its `consistent` says
whether the transcript already holds Stop's final message (holds_final): Claude Code appends records
in order but writes them after Stop fires, so only then is the turn read whole (2026-11-10, the race).

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


CHUNK = 262_144
ASSISTANT = (b'"type":"assistant"', b'"type": "assistant"')
USER = (b'"type":"user"', b'"type": "user"')


def _lines_backward(f, size, limit):
    """The file's non-empty lines, last first, from its last `limit` bytes (a line the limit cuts is
    left out)."""
    pos, carry = size, b""
    while pos > 0:
        n = min(CHUNK, pos, limit - (size - pos))
        if n <= 0:
            return
        pos -= n
        f.seek(pos)
        lines = (f.read(n) + carry).split(b"\n")
        carry = lines[0]
        for ln in reversed(lines[1:]):
            if ln.strip():
                yield ln
    if carry.strip():
        yield carry


def _is_prompt(r, content):
    """A user record that starts a turn: what the person sent (a string, or text blocks with no tool
    result); not a meta record (a hook's or a tool loader's note) or a compaction summary."""
    if r.get("isMeta") or r.get("isCompactSummary"):
        return False
    if isinstance(content, str):
        return True
    return isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "text" for b in content) \
        and not any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content)


def _turn_read(path, limit):
    """(blocks, prompt): turn_blocks' list (None when the transcript cannot be read) and the prompt
    record the turn starts at (None when the file's start or the read limit came first)."""
    if not path:
        return None, None
    out, prompt = [], None
    try:
        with open(path, "rb") as f:
            for ln in _lines_backward(f, os.fstat(f.fileno()).st_size, limit):
                if any(k in ln for k in ASSISTANT):
                    if b'"text"' not in ln:
                        continue                          # thinking or a tool call only
                elif any(k in ln for k in USER):
                    if b'"tool_result"' in ln:
                        continue                          # a tool's result: inside the turn
                else:
                    continue
                try:
                    r = json.loads(ln)
                except ValueError:
                    continue
                if not isinstance(r, dict) or r.get("isSidechain"):
                    continue
                msg = r.get("message") if isinstance(r.get("message"), dict) else {}
                content = msg.get("content")
                if r.get("type") == "user":
                    if _is_prompt(r, content):
                        prompt = r
                        break
                elif r.get("type") == "assistant" and isinstance(content, list):
                    texts = [b["text"] for b in content if isinstance(b, dict) and b.get("type") == "text"
                             and isinstance(b.get("text"), str) and b["text"].strip()]
                    if texts:
                        out.append({"uuid": r.get("uuid"), "message_id": msg.get("id"), "text": "\n\n".join(texts)})
    except OSError:
        return None, None
    out.reverse()
    return out, prompt


def turn_blocks(path, limit=TAIL):
    """The main-thread assistant text of the transcript's last turn (everything after the last prompt
    the person sent), oldest first: [{"uuid", "message_id", "text"}], one per record that carries
    text; thinking, tool_use and tool_result are left out. None when the transcript cannot be read.
    Read backward from the end, at most `limit` bytes, and only the lines that can matter are parsed
    (an assistant record with a text block, a user record that is not a tool result), so a turn's
    large tool results cost a substring test each. A turn longer than `limit` keeps its later part."""
    return _turn_read(path, limit)[0]


def holds_final(blocks, msg):
    """True when the transcript already holds Stop's final message (msg): its last assistant text
    record, or the trailing text records of its last API message joined, equals msg or ends with it,
    after whitespace normalisation. Records are appended in order, so a transcript that holds the
    final message holds every record of the turn before it."""
    m = " ".join((msg or "").split())
    if not m or not blocks:
        return False
    mid, tail = blocks[-1].get("message_id"), ""
    for b in reversed(blocks):
        if tail and (mid is None or b.get("message_id") != mid):
            break
        tail = " ".join((b["text"] + " " + tail).split())
        if tail == m or tail.endswith(m):
            return True
    return False


def _split_final(blocks, msg):
    """(the blocks before the final message, its {uuid, message_id}). The final message is Stop's
    last_assistant_message; when the transcript holds it already, its records (the trailing text
    records of the last API message, each found in msg) are left out, since msg is written in their
    place, and the last one's uuid is kept. Otherwise every block is earlier and the uuid is null."""
    m = " ".join(msg.split())
    none = {"uuid": None, "message_id": None}
    if not m or not blocks:
        return blocks, none
    mid = blocks[-1].get("message_id")
    i, uuid = len(blocks), None
    while i > 0:
        b = blocks[i - 1]
        t = " ".join(b["text"].split())
        if not t or t not in m or (mid is not None and b.get("message_id") != mid):
            break
        uuid = uuid or b.get("uuid")
        i -= 1
    return (blocks, none) if i == len(blocks) else (blocks[:i], {"uuid": uuid, "message_id": mid})


def whole_turn(path, msg, prompt_id=None):
    """Stop part A, and part B's re-read of a lagged turn: what turns/<sid>/<turn>.md holds. Every
    main-thread assistant text block of the turn, in order, with Stop's final message (msg, verbatim)
    as the last part instead of the transcript's copy of it; parts joined by one blank line.
    Returns {"text", "blocks": [{"uuid", "message_id"}] (one per part, the final message last: its
    uuid null until the transcript holds it), "source", "consistent", "prompt_id"}. source is
    "transcript" when the transcript was read, "last_message" when it could not be (text is then msg
    alone). consistent: the transcript holds the final message (holds_final) and, when both are
    known, the turn starts at the prompt whose promptId is prompt_id (the hooks' prompt_id), so a
    transcript that has not yet written this turn's prompt is not read as the earlier turn. Only a
    consistent read is the whole turn; prompt_id in the result is the starting prompt's promptId."""
    msg = msg if isinstance(msg, str) else ""
    final = [{"uuid": None, "message_id": None}] if msg.strip() else []
    blocks, prompt = _turn_read(path, TAIL)
    if blocks is None:
        return {"text": msg, "blocks": final, "source": "last_message", "consistent": False, "prompt_id": None}
    pid = prompt.get("promptId") if isinstance(prompt, dict) and isinstance(prompt.get("promptId"), str) else None
    ok = holds_final(blocks, msg) and not (prompt_id and pid and pid != prompt_id)
    earlier, last = _split_final(blocks, msg)
    if ok and len(earlier) == len(blocks):      # the last record ends with msg: its own copy is the final part
        b = blocks[-1]
        earlier, last, msg = blocks[:-1], {"uuid": b.get("uuid"), "message_id": b.get("message_id")}, b["text"].strip()
    parts = [b["text"].strip() for b in earlier] + ([msg] if msg.strip() else [])
    metas = [{"uuid": b.get("uuid"), "message_id": b.get("message_id")} for b in earlier] + ([last] if msg.strip() else [])
    return {"text": "\n\n".join(parts), "blocks": metas, "source": "transcript", "consistent": ok, "prompt_id": pid}


if __name__ == "__main__":
    with open(sys.argv[2], encoding="utf-8") as f:
        expected_text = f.read()
    print(json.dumps(find(sys.argv[1], expected_text)))
