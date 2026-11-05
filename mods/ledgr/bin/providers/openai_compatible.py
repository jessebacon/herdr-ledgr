"""OpenAI-compatible chat completions: POST {base_url}/chat/completions with response_format
json_schema (Ollama, OpenRouter, xAI and others). The schema is also put in the system prompt for
servers that ignore response_format. The key (account `openai-compatible`) is optional: without
one no Authorization header is sent (local Ollama). Set extract.model to the server's model id."""
import json

from ._http import http_error, post, result

MAX_TOKENS = 4000


def complete(system, user_text, schema, opts):
    model, base_url = opts["model"], opts.get("base_url")
    if not base_url:
        return result(error="extract.base_url is not set", model=model)
    body = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "messages": [
            {"role": "system", "content": system + "\n\nJSON schema of the reply:\n" + json.dumps(schema)},
            {"role": "user", "content": user_text},
        ],
        "response_format": {"type": "json_schema",
                            "json_schema": {"name": "ledgr_asks", "strict": True, "schema": schema}},
    }
    headers = ["content-type: application/json"] + ([f"authorization: Bearer {opts['key']}"] if opts.get("key") else [])
    code, text, err = post(base_url.rstrip("/") + "/chat/completions", headers, body, opts["timeout"])
    if err:
        return result(error=err, model=model)
    if code != 200:
        return result(error=http_error(code, text), model=model)
    try:
        resp = json.loads(text)
        ch = (resp.get("choices") or [{}])[0]
        msg = ch.get("message") or {}
    except Exception:
        return result(error="response is not chat-completions JSON", model=model)
    u = resp.get("usage") or {}
    base = dict(usage={"input_tokens": u.get("prompt_tokens"), "output_tokens": u.get("completion_tokens")},
                model=resp.get("model") or model, request_id=resp.get("id"))
    if msg.get("refusal"):
        return result(error=f"refusal: {str(msg['refusal'])[:200]}", **base)
    if ch.get("finish_reason") == "length":
        return result(error="max_tokens", **base)
    content = msg.get("content")
    if isinstance(content, list):          # some servers return content parts
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    if not isinstance(content, str) or not content.strip():
        return result(error="no content in reply", **base)
    return result(ok=True, text=content, **base)
