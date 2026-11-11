#!/usr/bin/env python3
"""uuid-lookup tests (spec 4.2) and the whole turn's text (whole_turn, 2026-11-10) against
fixtures/transcript.jsonl and small generated transcripts, plus one run against a real transcript
under ~/.claude/projects (skipped if none). Run: python3 -I -B tests/test_last_assistant.py"""
import json
import glob
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ADAPTER = os.path.join(os.path.dirname(HERE), "adapters", "claude")
sys.path.insert(0, ADAPTER)
import last_assistant  # noqa: E402

TP = os.path.join(HERE, "fixtures", "transcript.jsonl")
FINAL = "The build is green.\n\nPlease confirm the deploy to staging before 5 pm."
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  {detail}"))
    fails += 0 if cond else 1


r = last_assistant.find(TP, FINAL)
check("final text -> uuid of the last main-thread text record", r == {"uuid": "c2", "api_id": "msg_C"}, r)
r = last_assistant.find(TP, "  The build   is green. Please confirm the deploy to staging before 5 pm.\n")
check("whitespace differences ignored", r.get("uuid") == "c2", r)
r = last_assistant.find(TP, "Preamble the hook saw from an earlier block. " + FINAL)
check("expected text longer than the record (endswith) still matches", r.get("uuid") == "c2", r)
r = last_assistant.find(TP, "Earlier answer.")
check("an older message does not match the last record", r == {}, r)
r = last_assistant.find(TP, "Subagent text that must be ignored.")
check("sidechain records are ignored", r == {}, r)
r = last_assistant.find(os.path.join(HERE, "fixtures", "missing.jsonl"), FINAL)
check("missing transcript -> {}", r == {}, r)
r = last_assistant.find(TP, "")
check("empty expected text -> {}", r == {}, r)

with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
    f.write(FINAL)
    exp = f.name
out = subprocess.run([sys.executable, "-I", "-B", os.path.join(ADAPTER, "last_assistant.py"), TP, exp],
                     capture_output=True, text=True).stdout.strip()
os.unlink(exp)
check("CLI prints the same JSON", json.loads(out or "{}") == {"uuid": "c2", "api_id": "msg_C"}, out)

# The whole turn (2026-11-10): what Stop part A writes to turns/<sid>/<turn>.md.
b = last_assistant.turn_blocks(TP)
check("turn_blocks: the last turn only (after 'Now deploy it.'), thinking, tool_use, tool_result and sidechain left out",
      [x["uuid"] for x in b or []] == ["c2"] and b[0]["message_id"] == "msg_C", b)
w = last_assistant.whole_turn(TP, FINAL)
check("whole_turn: the final message already in the transcript is written once (Stop's copy)",
      w["text"] == FINAL and w["blocks"] == [{"uuid": "c2", "message_id": "msg_C"}] and w["source"] == "transcript", w)
w = last_assistant.whole_turn(os.path.join(HERE, "fixtures", "missing.jsonl"), FINAL)
check("whole_turn: no transcript -> the final message alone, source last_message, not consistent",
      w == {"text": FINAL, "blocks": [{"uuid": None, "message_id": None}], "source": "last_message",
            "consistent": False, "prompt_id": None}, w)


def transcript(recs):
    f = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
    f.write("\n".join(json.dumps(r, separators=(",", ":")) for r in recs) + "\n")
    f.close()
    return f.name


def A(uuid, mid, text=None, tool=False, side=False):
    c = [{"type": "tool_use", "id": "t" + uuid, "name": "mcp__ledgr__declare_asks", "input": {"text": "not this"}}] if tool \
        else [{"type": "text", "text": text}] if text is not None else [{"type": "thinking", "thinking": "", "signature": "s"}]
    return {"type": "assistant", "uuid": uuid, "isSidechain": side, "message": {"id": mid, "role": "assistant", "content": c}}


def U(uuid, content, **kw):
    return dict({"type": "user", "uuid": uuid, "isSidechain": False, "message": {"role": "user", "content": content}}, **kw)


RES = lambda u: U(u, [{"type": "tool_result", "tool_use_id": "x", "content": "{\"type\":\"text\",\"text\":\"a result\"}"}])  # noqa: E731
LAST = "Everything else is ready.\n\nledgr: 2 items for you, 1 blocking"
shape = [U("u0", "first prompt"), A("e1", "m0", "Old turn text."), U("u1", "second prompt"), A("k1", "m1"),
         A("a1", "m1", "I stopped before the migration because the staging token is missing."), A("a2", "m1", tool=True),
         RES("r1"), U("meta", "Being added to this conversation: a tool.", isMeta=True), A("s1", "ms", "Subagent noise.", side=True),
         A("a3", "m2", LAST)]
p = transcript(shape)
w = last_assistant.whole_turn(p, LAST)
check("tool path (text, declare_asks, text): both texts in order, a blank line between, the earlier turn left out",
      w["text"] == "I stopped before the migration because the staging token is missing.\n\n" + LAST, w["text"])
check("...one {uuid, message_id} per part, the final message's last (a3)",
      w["blocks"] == [{"uuid": "a1", "message_id": "m1"}, {"uuid": "a3", "message_id": "m2"}], w["blocks"])
check("...consistent: the transcript holds the final message", w["consistent"] is True, w)
w = last_assistant.whole_turn(p, "")
check("...no final message from Stop: the transcript's texts alone",
      w["text"] == "I stopped before the migration because the staging token is missing.\n\n" + LAST, w["text"])
os.unlink(p)
p = transcript(shape[:-1])
w = last_assistant.whole_turn(p, LAST)
check("final message not in the transcript yet: the earlier text, then Stop's message, uuid null, not consistent",
      w["text"] == "I stopped before the migration because the staging token is missing.\n\n" + LAST
      and w["blocks"][-1] == {"uuid": None, "message_id": None} and w["consistent"] is False, w)
os.unlink(p)
p = transcript([U("u1", "go"), A("o1", "m1", "Only the last message.")])
w = last_assistant.whole_turn(p, "Only the last message.")
check("only the last message in the turn: the file is that message, once", w["text"] == "Only the last message." and len(w["blocks"]) == 1, w)
os.unlink(p)
p = transcript([U("u1", "go"), A("b1", "m1", "Before the tool."), A("b2", "m1", tool=True), RES("r1"),
                A("f1", "m2", "Line A."), A("f2", "m2", "Line B.")])
w = last_assistant.whole_turn(p, "Line A.\n\nLine B.")
check("a final message over two text records: both left out of the earlier part, the last one's uuid kept",
      w["text"] == "Before the tool.\n\nLine A.\n\nLine B." and w["blocks"][-1] == {"uuid": "f2", "message_id": "m2"}, w)
os.unlink(p)
p = transcript([U("u1", "go"), A("c1", "m1", "Before the compaction."), A("c2", "m1", tool=True), RES("r1"),
                U("cs", "This session is being continued from a previous conversation.", isCompactSummary=True),
                A("c3", "m2", "After it.")])
w = last_assistant.whole_turn(p, "After it.")
check("a compaction summary inside the turn does not end it", w["text"] == "Before the compaction.\n\nAfter it.", w["text"])
os.unlink(p)
p = transcript([U("u1", "go"), A("l1", "m1", "x" * 300), A("l2", "m1", tool=True), RES("r1"), A("l3", "m2", "End.")])
w = last_assistant.turn_blocks(p, limit=200)
check("a turn longer than the read limit keeps its later part", [x["uuid"] for x in w] == ["l3"], w)
os.unlink(p)

# The race (2026-11-10): Claude Code writes the turn's records after Stop fires; only a transcript
# that holds the final message (holds_final) is read as the whole turn.
p = transcript(shape[:2] + [U("u1", "second prompt", promptId="g1")])
w = last_assistant.whole_turn(p, LAST, "g1")
check("truncated before the plan text (only the prompt written): the final message alone, not consistent, prompt g1",
      w["text"] == LAST and w["consistent"] is False and w["prompt_id"] == "g1", w)
os.unlink(p)
old = [U("u0", "first prompt", promptId="g0"), A("e0", "m0", "An old sentence."), A("e1", "m0", LAST)]
p = transcript(old)
w = last_assistant.whole_turn(p, LAST, "g1")
check("this turn's prompt not written yet, the earlier reply has the same text: not consistent (promptId g0 is not g1)",
      w["consistent"] is False and w["prompt_id"] == "g0", w)
w = last_assistant.whole_turn(p, LAST)
check("...without a prompt_id to compare, the same transcript reads as consistent", w["consistent"] is True, w)
os.unlink(p)
p = transcript([U("u1", "go", promptId="g1"), A("a1", "m1", "Plan text."), A("a2", "m1", tool=True), RES("r1"), A("a3", "m2", LAST)])
w = last_assistant.whole_turn(p, LAST, "g1")
check("the turn's own prompt (promptId g1): consistent, the whole turn",
      w["consistent"] is True and w["text"] == "Plan text.\n\n" + LAST and w["blocks"][-1]["uuid"] == "a3", w)
os.unlink(p)
p = transcript([U("u1", "go"), A("a1", "m1", "Plan text."), A("a2", "m1", tool=True), RES("r1"), A("a3", "m2", "Lead-in. " + LAST)])
w = last_assistant.whole_turn(p, "  " + LAST.replace("\n\n", "\n") + "\n")
check("the last record ends with the final message (whitespace normalised): consistent, its own copy written once",
      w["consistent"] is True and w["text"] == "Plan text.\n\nLead-in. " + LAST and w["blocks"][-1]["uuid"] == "a3", w)
os.unlink(p)
p = transcript([U("u1", "go"), A("b1", "m1", "Before the tool."), A("b2", "m1", tool=True), RES("r1"), A("f1", "m2", "Line A.")])
w = last_assistant.whole_turn(p, "Line A.\n\nLine B.")
check("a final message over two records, only the first written: not consistent", w["consistent"] is False, w)
check("holds_final: trailing records of one API message joined", last_assistant.holds_final(
    [{"text": "x", "message_id": "m1"}, {"text": "Line A.", "message_id": "m2"}, {"text": "Line B.", "message_id": "m2"}],
    "Line A.\nLine B.") is True)
check("holds_final: not across API messages", last_assistant.holds_final(
    [{"text": "Line A.", "message_id": "m1"}, {"text": "Line B.", "message_id": "m2"}], "Line A. Line B.") is False)
os.unlink(p)

# Real transcript: the newest finished one under any local Claude project, read independently.
# Bounded: only the 20 newest *.jsonl files by mtime are considered, skipping any under 3 MB that
# is still being written (touched in the last minute) or holds no assistant text.
def last_main_text(path):
    last = None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                rr = json.loads(line)
            except Exception:
                continue
            if rr.get("type") == "assistant" and not rr.get("isSidechain"):
                m = rr.get("message") or {}
                txt = "".join(b.get("text", "") for b in m.get("content") or [] if isinstance(b, dict) and b.get("type") == "text")
                if txt.strip():
                    last = (rr.get("uuid"), m.get("id"), txt)
    return last


cands = sorted(glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")), key=os.path.getmtime, reverse=True)[:20]
real = last = None
for p in cands:
    try:
        if os.path.getsize(p) >= 3_000_000 or time.time() - os.path.getmtime(p) < 60:
            continue
        last = last_main_text(p)
    except OSError:
        continue
    if last:
        real = p
        break
if real:
    t0 = time.monotonic()
    r = last_assistant.find(real, last[2]) if last else {}
    ms = int((time.monotonic() - t0) * 1000)
    check(f"real transcript {os.path.basename(real)} ({os.path.getsize(real)//1024} KB, {ms} ms)",
          last and r == {"uuid": last[0], "api_id": last[1]}, (r, last and last[:2]))
    r = last_assistant.find(real, "This sentence was never written by the assistant in that session.")
    check("real transcript, non-matching text -> {}", r == {}, r)
    t0 = time.monotonic()
    w = last_assistant.whole_turn(real, last[2])
    ms = int((time.monotonic() - t0) * 1000)
    check(f"real transcript, whole turn ({len(w['blocks'])} parts, {ms} ms): ends with the final message, its uuid last",
          w["source"] == "transcript" and w["consistent"] and w["text"].endswith(last[2]) and w["blocks"][-1]["uuid"] == last[0], w["blocks"][-2:])
else:
    print("skipped: no local transcripts (real-transcript check; looked in ~/.claude/projects/*/*.jsonl)")

print(f"\n{'OK' if not fails else 'FAILED'}: last_assistant, {fails} failure(s)")
sys.exit(1 if fails else 0)
