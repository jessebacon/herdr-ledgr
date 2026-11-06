"""`claude -p` on the Claude Code subscription (spec 4.7). UNTESTED end to end (spec 9.6): where
--output-format json puts the structured result (read from `structured_output`, else `result`),
and whether --setting-sources local keeps user-level hooks out. LEDGR_INNER=1 and a scrubbed
HC_* environment keep ledgr's own hooks and Herdr's mapping out of the nested run.
The prompt goes on stdin, so a long message never hits the argument list."""
import json
import os
import shutil
import subprocess

import ledgr_core as C

from ._http import result


def complete(system, user_text, schema, opts):
    model, timeout = opts["model"], max(int(opts["timeout"]), 90)
    exe = shutil.which("claude", path=C.TOOL_PATH + ":" + os.path.join(C.HOME, ".claude/local"))
    if not exe:
        return result(error="claude CLI not found", model=model)
    env = {k: v for k, v in os.environ.items()
           if not k.startswith("HC_") and k not in ("LEDGR_TERMINAL", "ANTHROPIC_API_KEY")}
    env.update(LEDGR_INNER="1", PATH=C.TOOL_PATH)
    args = [exe, "-p", "--model", model, "--output-format", "json", "--json-schema", json.dumps(schema),
            "--system-prompt", system, "--tools", "", "--disable-slash-commands",
            "--no-session-persistence", "--setting-sources", "local"]
    try:
        r = subprocess.run(args, input=user_text.encode("utf-8"), capture_output=True, cwd=C.DATA,
                           env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return result(error="timeout (cli)", model=model)
    try:
        resp = json.loads(r.stdout.decode("utf-8", "replace"))
    except Exception:
        err = r.stderr.decode("utf-8", "replace").strip().splitlines()
        return result(error=f"cli exit {r.returncode}: {err[-1] if err else 'no JSON on stdout'}"[:300], model=model)
    u = resp.get("usage") or {}
    base = dict(usage={"input_tokens": u.get("input_tokens"), "output_tokens": u.get("output_tokens"),
                       "cost_usd_est": resp.get("total_cost_usd")},
                model=model, request_id=resp.get("session_id"))
    if resp.get("is_error"):
        return result(error=f"cli: {str(resp.get('result'))[:200]}", **base)
    if isinstance(resp.get("structured_output"), (dict, list)):
        return result(ok=True, data=resp["structured_output"], **base)
    if isinstance(resp.get("result"), str) and resp["result"].strip():
        return result(ok=True, text=resp["result"], **base)
    return result(error="cli: no result in output", **base)
