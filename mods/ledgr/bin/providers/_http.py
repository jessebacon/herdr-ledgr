"""Shared pieces for HTTP providers: the result shape and a curl POST that keeps the key and the
message off the command line (headers via a curl config on stdin, body via a 0600 temp file)."""
import json
import os
import subprocess

import ledgr_core as C


def result(**kw):
    base = {"ok": False, "text": None, "data": None, "usage": {}, "model": None, "request_id": None, "error": None}
    base.update(kw)
    return base


def post(url, headers, body, timeout):
    """Returns (http_code|None, response_text, error|None)."""
    os.makedirs(C.path("tmp"), exist_ok=True)
    bodyf = C.path("tmp", f".req.{os.getpid()}.{os.urandom(4).hex()}.json")
    fd = os.open(bodyf, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(json.dumps(body, ensure_ascii=False).encode("utf-8"))
    cfg = "".join('header = "%s"\n' % h.replace("\\", "\\\\").replace('"', '\\"') for h in headers)
    try:
        r = subprocess.run([C.CURL, "-sS", "--max-time", str(timeout), "-K", "-", "-X", "POST",
                            "--data-binary", "@" + bodyf, "-w", "\n%{http_code}", url],
                           input=cfg.encode("utf-8"), capture_output=True, timeout=timeout + 5,
                           env=dict(os.environ, LEDGR_INNER="1"))
    except subprocess.TimeoutExpired:
        return None, "", "timeout"
    finally:
        try:
            os.unlink(bodyf)
        except OSError:
            pass
    if r.returncode != 0:
        err = r.stderr.decode("utf-8", "replace").strip().splitlines()
        return None, "", ("timeout" if r.returncode == 28 else f"curl exit {r.returncode}: {err[-1] if err else ''}")[:300]
    body_text, _, code = r.stdout.decode("utf-8", "replace").rpartition("\n")
    try:
        return int(code), body_text, None
    except ValueError:
        return None, body_text, "no http status"


def http_error(code, text):
    try:
        e = json.loads(text).get("error") or {}
        if isinstance(e, dict):
            return f"http {code}: {e.get('type', '')}: {e.get('message', '')}"[:300]
        return f"http {code}: {e}"[:300]
    except Exception:
        return f"http {code}: {text[:200]}"
