#!/usr/bin/env python3
"""Block-parser tests (spec 4.3 rules, the five spec inputs plus edge cases), against
fixtures/blocks/*.md. Run: python3 -I -B tests/test_parse_block.py"""
import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "lib"))
import parse_block  # noqa: E402

FX = os.path.join(HERE, "fixtures", "blocks")
fails = 0


def load(name):
    with open(os.path.join(FX, name), encoding="utf-8") as f:
        return f.read()


def check(name, cond, detail=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  {detail}"))
    fails += 0 if cond else 1


r = parse_block.parse(load("valid.md"))
check("valid: found and valid", r["found"] and r["valid"], r)
check("valid: 3 asks (item without text dropped)", len(r["asks"]) == 3, [a["text"] for a in r["asks"]])
a0, a1, a2 = (r["asks"] + [{}, {}, {}])[:3]
check("valid: decide keeps options and recommended", a0.get("kind") == "decide" and a0.get("options") == ["30 days", "90 days"]
      and a0.get("recommended") == "30 days", a0)
check("valid: quote kept (substring of prose)", a0.get("quote") == "Pick the retention rule: keep 30 days or keep 90 days.", a0)
check("valid: confirm blocking true", a1.get("kind") == "confirm" and a1.get("blocking") is True, a1)
check("valid: unknown kind -> do, text whitespace-normalised", a2.get("kind") == "do" and a2.get("text") == "Check the wiki", a2)
check("valid: block removed from prose", "ledgr-asks" not in r["prose"] and "Pick the retention rule" in r["prose"], r["prose"])
want = hashlib.sha1(re.sub(r"\s+", " ", a0["quote"]).strip().encode()).hexdigest()[:12]
check("valid: per-ask hash = sha1(squash(quote))[:12]", a0.get("hash") == want, (a0.get("hash"), want))
check("valid: origin extract_block, repeat_of null, no queue_kind",
      a0.get("origin") == "extract_block" and a0.get("repeat_of") is None and a0.get("repeat_of_handle") is None
      and "queue_kind" not in a0, a0)

check("valid: legacy blocking true -> level blocking; blocking false -> needed",
      a1.get("level") == "blocking" and a0.get("level") == "needed" and a0.get("blocking") is False, (a0, a1))
check("valid: no rejected levels", r["rejected"] == [], r["rejected"])

# Severity (2026-11-05): level blocking | needed | optional; none -> needed; unknown -> the ask is rejected.
r = parse_block.parse(load("levels.md"))
lv = {a["text"]: a["level"] for a in r["asks"]}
check("levels: valid, 5 asks (the unknown level rejected)", r["valid"] and len(r["asks"]) == 5, list(lv))
check("levels: explicit blocking", lv.get("Paste the TRACKER_WEBHOOK_SECRET value") == "blocking", lv)
check("levels: no level -> needed", lv.get("Check the DM on your phone") == "needed", lv)
check("levels: optional", lv.get("Decide whether to add a digest later") == "optional", lv)
check("levels: ' Needed ' -> needed (case and space ignored)", lv.get("Pick the message template") == "needed", lv)
check("levels: legacy blocking true without level -> blocking", lv.get("Approve the Slack app") == "blocking", lv)
check("levels: unknown level 'urgent' rejected with a reason",
      "Rotate the old bot secret" not in lv and any("urgent" in x for x in r["rejected"]), r["rejected"])
check("levels: blocking field follows the level",
      all(a["blocking"] == (a["level"] == "blocking") for a in r["asks"]), r["asks"])
r = parse_block.parse(load("badlevel.md"))
check("only unknown levels: found, invalid, error names them",
      r["found"] and not r["valid"] and r["error"].startswith("no valid items (") and "critical" in r["error"] and len(r["rejected"]) == 2, r)

r = parse_block.parse(load("broken.md"))
check("broken JSON: found, invalid, error set", r["found"] and not r["valid"] and (r["error"] or "").startswith("block:"), r)
check("broken JSON: block still removed from prose", "ledgr-asks" not in r["prose"], r["prose"])

r = parse_block.parse(load("none.md"))
check("no block: not found, prose unchanged", not r["found"] and r["prose"] == load("none.md"), r)

r = parse_block.parse(load("empty4.md"))
check("empty array in 4-backtick fence: found, valid, 0 asks", r["found"] and r["valid"] and r["asks"] == [], r)

r = parse_block.parse(load("unterminated.md"))
check("unterminated fence: ignored", not r["found"] and r["asks"] == [], r)

r = parse_block.parse(load("tilde_object.md"))
check("tilde fence, indented, {asks:[...]} body", r["found"] and r["valid"] and r["asks"][0]["kind"] == "provide", r)

r = parse_block.parse(load("twoblocks.md"))
check("two blocks: the last wins", r["valid"] and [a["text"] for a in r["asks"]] == ["Second block ask"], r["asks"])
check("two blocks: the earlier block stays in prose", "First block ask" in r["prose"], r["prose"])

r = parse_block.parse(load("badquote.md"))
check("quote not in prose dropped; recommended not in options -> null",
      r["valid"] and r["asks"][0]["quote"] is None and r["asks"][0]["recommended"] is None, r["asks"])
check("hash falls back to text when no quote",
      r["asks"][0]["hash"] == hashlib.sha1(b"Choose").hexdigest()[:12], r["asks"])

r = parse_block.parse(load("shortclose.md"))
check("shorter closing fence does not close", not r["found"], r)

r = parse_block.parse(load("novalid.md"))
check("no valid items: found, invalid, 'no valid items'", r["found"] and not r["valid"] and r["error"] == "no valid items", r)

r = parse_block.parse(load("oldtag.md"))
check("old ledger-asks tag is not recognised", not r["found"], r)

# The readable bullet form (2026-11-06): `- level · kind · text [· "quote"] [· options: a | b]`.
r = parse_block.parse(load("bullets.md"))
check("bullets: found, valid, form bullets, 3 asks", r["found"] and r["valid"] and r["form"] == "bullets" and len(r["asks"]) == 3, r)
b0, b1, b2 = (r["asks"] + [{}, {}, {}])[:3]
check("bullets: level, kind, text, quote, options", b0.get("level") == "blocking" and b0.get("kind") == "decide"
      and b0.get("text") == "Choose the default template" and b0.get("options") == ["compact", "detailed"]
      and b0.get("quote") == "Pick the default template before I wire the export: compact or detailed." and b0.get("blocking") is True, b0)
check("bullets: no quote, no options", b1.get("quote") is None and b1.get("options") == [] and b1.get("kind") == "provide", b1)
check("bullets: '*' marker and options without a quote", b2.get("kind") == "review" and b2.get("options") == ["now", "after the export"], b2)
check("bullets: origin extract_block, hash like JSON asks", b0.get("origin") == "extract_block"
      and b0.get("hash") == hashlib.sha1(re.sub(r"\s+", " ", b0["quote"]).strip().encode()).hexdigest()[:12], b0)
check("bullets: nothing rejected, block removed from prose", r["rejected"] == [] and "ledgr-asks" not in r["prose"], (r["rejected"], r["prose"]))
check("bullets: pointer line read (3 items, 1 blocking)", r["pointer"] == {"line": "ledgr: 3 items for you, 1 blocking", "items": 3, "blocking": 1}, r["pointer"])

r = parse_block.parse(load("bullets_curly.md"))
c0, c1 = (r["asks"] + [{}, {}])[:2]
check("curly quotes: kept and verified against the prose", r["valid"] and c0.get("quote") == "The cutover runs Saturday at 06:00.", c0)
check("options before the quote: both read; optional level", c1.get("options") == ["Friday", "Saturday morning"]
      and c1.get("quote") == "Everything else is staged." and c1.get("level") == "optional", c1)
check("pointer without blocking: 'ledgr: 2 items for you'", r["pointer"] == {"line": "ledgr: 2 items for you", "items": 2, "blocking": 0}, r["pointer"])

r = parse_block.parse(load("bullets_missing_level.md"))
check("missing level: that bullet rejected with a reason, the other kept",
      r["valid"] and [a["text"] for a in r["asks"]] == ["Restart the worker on PRODAPP"]
      and len(r["rejected"]) == 1 and r["rejected"][0].startswith("ask 1: missing level"), r)
check("pointer 'ledgr: 1 item for you'", r["pointer"] and r["pointer"]["items"] == 1 and r["pointer"]["blocking"] == 0, r["pointer"])

r = parse_block.parse(load("bullets_bad_level.md"))
rj = " | ".join(r["rejected"])
check("bad level: 'urgent' rejected, 'Blocking' read as blocking",
      r["valid"] and [(a["text"], a["level"]) for a in r["asks"]] == [("Approve release 1.17", "blocking")] and "ask 1: unknown level 'urgent'" in rj, (r["asks"], rj))
check("bad kind, a quote where the text goes, two quotes: each rejected with its reason",
      "ask 3: unknown kind 'approve'" in rj and "ask 4: missing text" in rj and "ask 5: field" in rj, rj)
check("a stray line is reported, not fatal", "line 1: not a bullet" in rj, rj)
check("no pointer line: null", r["pointer"] is None, r["pointer"])

r = parse_block.parse(load("bullets_mixed.md"))
check("JSON mixed with bullets: found, invalid, whole block rejected",
      r["found"] and not r["valid"] and r["asks"] == [] and "mixes a JSON array and bullets" in (r["error"] or "") and r["form"] == "mixed", r)
r = parse_block.parse(load("bullets_xml.md"))
check("<ledgr-asks> ... </ledgr-asks> (XML tags, seen live from Haiku): read like a fence",
      r["found"] and r["valid"] and len(r["asks"]) == 2 and "<ledgr-asks>" not in r["prose"] and r["asks"][1]["options"] == ["tomllib", "tomlkit"], r)
r = parse_block.parse(load("valid.md"))
check("JSON blocks still parse (form json)", r["valid"] and r["form"] == "json" and r["pointer"] is None, r["form"])
check("no summary given: no summary key (records stay lean, no null)", all("summary" not in a for a in r["asks"]), r["asks"])

# The ask's summary (2026-11-23): an optional last bullet field `summary: ...` taking the rest of the line,
# or a `summary` key in the JSON form; ledgr_asks.summary_of normalises it.
r = parse_block.parse(load("bullets_summary.md"))
s = {a["text"]: a for a in r["asks"]}
rj = " | ".join(r["rejected"])
check("summary: found, valid, 7 asks, one stray line rejected", r["valid"] and len(r["asks"]) == 7 and len(r["rejected"]) == 1, (list(s), rj))
d0 = s.get("Confirm the pipeline changes", {})
check("summary after quote and options: read, and a ' · ' inside it is part of the summary",
      d0.get("summary") == "A yes applies all five rows · the rename, the policy and the branch delete among them. "
                           "Deleting release/5.4 cannot be undone."
      and d0.get("quote") == "What I'll change, once you confirm." and d0.get("options") == ["yes", "no"], d0)
check("summary right after the text: read; no quote, no options",
      s.get("Paste the staging API token", {}).get("summary") == "The token from the staging Key Vault; I need it to run the migration."
      and s["Paste the staging API token"].get("quote") is None, s.get("Paste the staging API token"))
check("'SUMMARY:' in any case, its outer space dropped", s.get("Check the dashboard", {}).get("summary")
      == "Open it on your phone and say if the totals line wraps.", s.get("Check the dashboard"))
check("an empty summary: accepted, no summary key", "Rotate the old secret" in s and "summary" not in s["Rotate the old secret"],
      s.get("Rotate the old secret"))
check("a quote after the summary is part of the summary (it takes the rest of the line)",
      s.get("Pick the region", {}).get("summary") == "West, unless latency matters more than cost. · \"What I'll change, once you confirm.\""
      and s["Pick the region"].get("quote") is None, s.get("Pick the region"))
q3 = s.get("Summary: review the Q3 numbers before Friday", {})
check("review 7.2: a text that begins 'Summary:' is the text, as before the field (needed, review, no summary key)",
      q3.get("level") == "needed" and q3.get("kind") == "review" and "summary" not in q3, (list(s), q3))
check("review 7.3: a summary is one line; the line under it is a stray line, reported, and the bullet keeps its first line",
      s.get("Pick the cutover night", {}).get("summary") == "Friday or Saturday; I recommend Saturday."
      and r["rejected"] == ["line 8: not a bullet (- level · kind · text)"], (s.get("Pick the cutover night"), rj))
r2 = parse_block.parse("Plan. It is late.\n\n```ledgr-asks\n- needed · review · Summary: review X · \"It is late.\" · summary: real one\n```\n")
check("a text that begins 'Summary:' with a quote and a summary field after it: each in its place",
      r2["valid"] and r2["asks"][0]["text"] == "Summary: review X" and r2["asks"][0]["quote"] == "It is late."
      and r2["asks"][0].get("summary") == "real one", r2["asks"])

import json  # noqa: E402
long_s = "word " * 300
body = json.dumps([{"text": "Confirm the plan", "kind": "confirm", "level": "blocking",
                    "summary": "\r\n  Confirm these:\r\n\r\n\r\n- rename the pipeline\n  \n\t\n- delete release/5.4\r\rDone.  \n\n"},
                   {"text": "Cut me", "kind": "do", "level": "needed", "summary": long_s},
                   {"text": "Blank", "kind": "do", "level": "needed", "summary": " \n\t\n "},
                   {"text": "Not text", "kind": "do", "level": "needed", "summary": ["a list"]}])
r = parse_block.parse("Plan.\n\n```ledgr-asks\n" + body + "\n```\n")
j = {a["text"]: a for a in r["asks"]}
check("JSON summary: CR LF and CR read as LF, blank-line runs (whitespace-only lines too) made one, outer space dropped, markdown kept",
      j.get("Confirm the plan", {}).get("summary") == "Confirm these:\n\n- rename the pipeline\n\n- delete release/5.4\n\nDone.",
      j.get("Confirm the plan"))
check("JSON summary over 1,000 characters: cut at 1,000, trailing space dropped, never rejected",
      j.get("Cut me", {}).get("summary") == long_s[:1000].rstrip() and len(r["asks"]) == 4, j.get("Cut me"))
check("JSON summary blank or not a string: the ask kept, no summary key",
      "summary" not in j.get("Blank", {"summary": 1}) and "summary" not in j.get("Not text", {"summary": 1}), r["asks"])

# Review 7.4: whitespace is JavaScript's, as store.js cleanSummary reads it: U+FEFF counts, U+001C and U+0085 do not.
import ledgr_asks  # noqa: E402
cs = lambda v: ledgr_asks.summary_of({"summary": v})  # noqa: E731
check("review 7.4: a summary of only U+FEFF is none (the tool refuses it, as the store keeps none)", cs("\ufeff") is None, repr(cs("\ufeff")))
check("review 7.4: U+FEFF lines are blank lines, and U+FEFF is outer space",
      cs("\ufeff\n\ufeff\n\n x \ufeff") == "x" and cs("a\n \ufeff\nb\ufeff") == "a\n\nb", [cs("\ufeff\n\ufeff\n\n x \ufeff"), cs("a\n \ufeff\nb\ufeff")])
check("review 7.4: U+001C and U+0085 are kept, as JavaScript's trim keeps them; U+3000 and U+00A0 go",
      cs("\x1cx\x1c") == "\x1cx\x1c" and cs("\x85y") == "\x85y" and cs("\u3000\xa0z\xa0") == "z", [cs("\x1cx\x1c"), cs("\x85y")])

print(f"\n{'OK' if not fails else 'FAILED'}: parse_block, {fails} failure(s)")
sys.exit(1 if fails else 0)
