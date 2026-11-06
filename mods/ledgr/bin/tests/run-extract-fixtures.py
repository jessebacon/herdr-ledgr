#!/usr/bin/env python3
"""Extraction fixtures (spec 9.4): mods/ledgr/fixtures/extract/<name>.md with expectations in
<name>.json ("offline" and "live" sections). Level checks (severity, 2026-11-05): "levels" (exact
count per level), "level_min" (at least), "levels_only" (no other level), "level_by_text" ({"a|b":
level}: an ask whose text or quote contains a or b, case-insensitive, has that level), "rejected_min";
"quote_max" (no quote longer than that many characters); "none_matching" (no ask whose text or quote
contains any of these, case-insensitive). Runs adapters/claude/extract.sh --dry-run per fixture
with a throwaway LEDGR_DATA (default config).

  python3 -I -B tests/run-extract-fixtures.py                 offline: the real key is never read
                                                              (missing Keychain service), so model
                                                              paths must end in "no credential"
  python3 -I -B tests/run-extract-fixtures.py --live NAME...  live: real Keychain key, real calls;
                                                              prints latency, usage and cost
"""
import glob
import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.dirname(HERE)
FX = os.path.join(os.path.dirname(BIN), "fixtures", "extract")
EXTRACT = os.path.join(BIN, "adapters", "claude", "extract.sh")


def long_fixture(dirpath):
    para = ("I went through the remaining modules, moved the shared helpers into lib, renamed the "
            "config keys, updated the call sites, and reran the suite after each step; every run "
            "passed and nothing else needed to change in this area. ")
    body = (para * (80_000 // len(para) + 1))[:79_800]
    tail = ("\n\nOne thing needs you: confirm whether I should delete the 12 stale feature branches "
            "listed above, or keep them until the release closes.")
    p = os.path.join(dirpath, "long.md")
    with open(p, "w", encoding="utf-8") as f:
        f.write(body + tail)
    return p


def check(res, exp):
    errs = []
    asks = res.get("asks") or []
    if "source" in exp and res.get("source") != exp["source"]:
        errs.append(f"source {res.get('source')!r} != {exp['source']!r} (error {res.get('error')!r})")
    if "error" in exp and res.get("error") != exp["error"]:
        errs.append(f"error {res.get('error')!r} != {exp['error']!r}")
    if "count" in exp and len(asks) != exp["count"]:
        errs.append(f"count {len(asks)} != {exp['count']}: {[a['text'] for a in asks]}")
    if "count_min" in exp and len(asks) < exp["count_min"]:
        errs.append(f"count {len(asks)} < {exp['count_min']}")
    if exp.get("block_error") and not res.get("block_error"):
        errs.append("block_error missing")
    if exp.get("truncated") and not res.get("truncated"):
        errs.append("truncated flag missing")
    if exp.get("no_model_call") and res.get("provider"):
        errs.append(f"a model was called ({res.get('provider')})")
    decides = [a for a in asks if a["kind"] == "decide"]
    if exp.get("decide_has_options") and not any(len(a["options"]) >= 2 for a in decides):
        errs.append("no decide ask with options")
    if exp.get("decide_has_recommended") and not any(a["recommended"] for a in decides):
        errs.append("no decide ask with recommended")
    for k in exp.get("kinds_include", []):
        if not any(a["kind"] == k for a in asks):
            errs.append(f"no {k} ask")
    if "quotes_present_min" in exp and sum(1 for a in asks if a.get("quote")) < exp["quotes_present_min"]:
        errs.append(f"only {sum(1 for a in asks if a.get('quote'))} quotes verified")
    if "repeat_of" in exp and sorted(a.get("repeat_of") for a in asks if a.get("repeat_of")) != sorted(exp["repeat_of"]):
        errs.append(f"repeat_of {[a.get('repeat_of') for a in asks]} != {exp['repeat_of']}")
    by_level = {}
    for a in asks:
        by_level[a.get("level")] = by_level.get(a.get("level"), 0) + 1
    if "levels" in exp and any(by_level.get(k, 0) != v for k, v in exp["levels"].items()):
        errs.append(f"levels {by_level} != {exp['levels']}")
    for k, v in (exp.get("level_min") or {}).items():
        if by_level.get(k, 0) < v:
            errs.append(f"{by_level.get(k, 0)} {k} < {v} ({by_level})")
    if "levels_only" in exp and any(k not in exp["levels_only"] for k in by_level):
        errs.append(f"levels {by_level} outside {exp['levels_only']}")
    for pat, want in (exp.get("level_by_text") or {}).items():
        alts = [x.lower() for x in pat.split("|")]
        hits = [a for a in asks if any(x in (a.get("text") or "").lower() or x in (a.get("quote") or "").lower() for x in alts)]
        if not hits:
            errs.append(f"no ask matching {pat!r}")
        elif not any(a.get("level") == want for a in hits):
            errs.append(f"{pat!r}: {[(a['text'], a.get('level')) for a in hits]} not {want}")
    for pat in exp.get("none_matching") or []:
        hits = [a["text"] for a in asks if pat.lower() in (a.get("text") or "").lower() or pat.lower() in (a.get("quote") or "").lower()]
        if hits:
            errs.append(f"an ask matches {pat!r}: {hits}")
    if "quote_max" in exp and any(len(a.get("quote") or "") > exp["quote_max"] for a in asks):
        errs.append(f"a quote over {exp['quote_max']} characters: {[len(a.get('quote') or '') for a in asks]}")
    if "rejected_min" in exp and len(res.get("rejected") or []) < exp["rejected_min"]:
        errs.append(f"rejected {res.get('rejected')} has fewer than {exp['rejected_min']}")
    if any(a.get("level") not in ("blocking", "needed", "optional") for a in asks):
        errs.append("an ask without a valid level")
    cost = ((res.get("usage") or {}).get("cost_usd_est"))
    if "max_cost" in exp and (cost is None or cost > exp["max_cost"]):
        errs.append(f"cost {cost} not under {exp['max_cost']}")
    if any(len(a.get("hash") or "") != 12 for a in asks):
        errs.append("an ask without a 12-char hash")
    return errs


def main(argv):
    live = "--live" in argv
    names = [a for a in argv[1:] if not a.startswith("--")]
    tmp = tempfile.mkdtemp(prefix="ledgr-fx.")
    env = dict(os.environ, LEDGR_DATA=os.path.join(tmp, "data"))
    for k in ("LEDGR_ANTHROPIC_KEY", "LEDGR_INNER", "LEDGR_OPENAI_COMPATIBLE_KEY"):
        env.pop(k, None)
    if not live:
        env["LEDGR_KEYCHAIN_SERVICE"] = "ledgr-test-missing-service"
    exps = sorted(glob.glob(os.path.join(FX, "*.json")))
    fails = 0
    for ep in exps:
        name = os.path.basename(ep)[:-5]
        if name.endswith(".snapshot") or (names and name not in names):
            continue
        exp = json.load(open(ep))
        md = long_fixture(tmp) if name == "long" else os.path.join(FX, name + ".md")
        args = [a if not a.endswith(".json") else os.path.join(FX, a) for a in exp.get("args", [])]
        t0 = time.monotonic()
        r = subprocess.run(["bash", EXTRACT, "--dry-run", "--text-file", md] + args, capture_output=True,
                           text=True, env=env, timeout=120)
        wall = int((time.monotonic() - t0) * 1000)
        try:
            res = json.loads(r.stdout)
        except Exception:
            print(f"FAIL {name}: no JSON ({r.stderr.strip()[-300:]})")
            fails += 1
            continue
        errs = check(res, exp["live" if live else "offline"])
        u = res.get("usage") or {}
        info = (f"source={res.get('source')} asks={len(res.get('asks') or [])} wall={wall}ms extract_ms={res.get('ms')}"
                + (f" in={u.get('input_tokens')} out={u.get('output_tokens')} cost=${u.get('cost_usd_est')}" if u else "")
                + (f" error={res.get('error')!r}" if res.get("error") else ""))
        print(("PASS " if not errs else "FAIL ") + f"{name}: {info}")
        for e in errs:
            print(f"     - {e}")
        if live:
            for a in res.get("asks") or []:
                print(f"     [{a.get('level')}/{a['kind']}] {a['text']}" + (f"  options={a['options']} rec={a['recommended']!r}" if a["options"] else "")
                      + (f"  repeat_of={a['repeat_of_handle']}" if a.get("repeat_of") else "")
                      + (f"  quote({len(a['quote'])}): “{a['quote'][:90]}{'…' if len(a['quote']) > 90 else ''}”" if a.get("quote") else "  (quote dropped)"))
        fails += bool(errs)
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{'OK' if not fails else 'FAILED'}: extraction fixtures ({'live' if live else 'offline'}), {fails} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
