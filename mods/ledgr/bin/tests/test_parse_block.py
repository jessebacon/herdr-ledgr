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

print(f"\n{'OK' if not fails else 'FAILED'}: parse_block, {fails} failure(s)")
sys.exit(1 if fails else 0)
