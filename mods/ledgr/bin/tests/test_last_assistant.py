#!/usr/bin/env python3
"""uuid-lookup tests (spec 4.2) against fixtures/transcript.jsonl, plus one run against a real
transcript under ~/.claude/projects (skipped if none). Run: python3 -I -B tests/test_last_assistant.py"""
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
else:
    print("skipped: no local transcripts (real-transcript check; looked in ~/.claude/projects/*/*.jsonl)")

print(f"\n{'OK' if not fails else 'FAILED'}: last_assistant, {fails} failure(s)")
sys.exit(1 if fails else 0)
