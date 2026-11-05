"""Anthropic Messages API (raw HTTP; no SDK on this machine). claude-haiku-5-5 by default:
structured output through output_config.format, thinking disabled (accepted on Haiku 5.5 at
effort high or below), effort low, no sampling parameters (rejected on 2026-10-21).
Source: claude-api skill (curl/examples.md, model table and Haiku 5.5 notes, cached 2026-10-06)."""
import json

from ._http import http_error, post, result

URL = "https://api.anthropic.com/v1/messages"
VERSION = "2026-10-21"
MAX_TOKENS = 4000
# $ per million tokens: (input, output) for prompts <= 100K tokens, then above.
PRICES = {"claude-haiku-5-5": ((0.10, 0.50), (0.50, 2.50))}


def cost_usd(model, inp, out):
    p = PRICES.get(model)
    if not p or inp is None or out is None:
        return None
    rate = p[0] if inp <= 100_000 else p[1]
    return round((inp * rate[0] + out * rate[1]) / 1_000_000, 7)


def request_body(system, user_text, schema, model):
    return {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "thinking": {"type": "disabled"},
        "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        "system": system,
        "messages": [{"role": "user", "content": user_text}],
    }


def complete(system, user_text, schema, opts):
    model = opts["model"]
    headers = [f"x-api-key: {opts['key']}", f"anthropic-version: {VERSION}", "content-type: application/json"]
    code, text, err = post(URL, headers, request_body(system, user_text, schema, model), opts["timeout"])
    if err:
        return result(error=err, model=model)
    if code != 200:
        return result(error=http_error(code, text), model=model)
    try:
        resp = json.loads(text)
    except Exception:
        return result(error="response is not JSON", model=model)
    u = resp.get("usage") or {}
    usage = {k: u[k] for k in ("input_tokens", "output_tokens", "cache_read_input_tokens",
                               "cache_creation_input_tokens") if k in u}
    usage["cost_usd_est"] = cost_usd(resp.get("model") or model, u.get("input_tokens"), u.get("output_tokens"))
    base = dict(usage=usage, model=resp.get("model") or model, request_id=resp.get("id"))
    stop = resp.get("stop_reason")
    if stop == "refusal":                     # check stop_reason before reading content
        cat = (resp.get("stop_details") or {}).get("category")
        return result(error=f"refusal ({cat})" if cat else "refusal", **base)
    if stop == "max_tokens":
        return result(error="max_tokens", **base)
    out = "".join(b.get("text", "") for b in resp.get("content") or []
                  if isinstance(b, dict) and b.get("type") == "text")     # by block type, not position
    if not out.strip():
        return result(error=f"no text in reply (stop_reason {stop})", **base)
    return result(ok=True, text=out, **base)
