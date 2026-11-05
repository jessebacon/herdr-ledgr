"""ledgr config: defaults for ledgr-data/config.json (spec Appendix B plus the provider seam) and
the loader. A missing file is created with the defaults; an invalid one is left alone and the
defaults are used."""
import json
import os

import ledgr_core as C

DEFAULT_CONFIG = {
    "v": 1,
    "instruct_block": False,          # print the ledgr-asks instruction at SessionStart
    "extract": {
        "mode": "block-first",          # block-first | always-model | block-only
        "provider": "anthropic",        # anthropic | openai-compatible | cli
        "model": "claude-haiku-5-5",    # model id for the chosen provider
        "base_url": None,               # openai-compatible only, e.g. http://localhost:11434/v1
        "audit_rate": 0,
        "cli_fallback": False,          # no anthropic key -> use the cli provider
        "max_chars": 60000,
        "timeout_s": 20,
    },
    "surface": {"openPanelOnAsks": False},
    "btw": {"autoSend": False},
    "nav": {"autoSearch": False},
    "branch": {"maxDepth": 2},
    "retention_days": 14,
}


def defaults():
    return json.loads(json.dumps(DEFAULT_CONFIG))


def deep_merge(base, over):
    out = dict(base)
    for k, v in over.items():
        out[k] = deep_merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def load(create=True):
    p = C.path("config.json")
    if not os.path.exists(p):
        if create:
            try:
                C.write_json(p, DEFAULT_CONFIG, indent=2)
            except Exception as ex:
                C.log(f"config create failed: {ex}")
        return defaults()
    user = C.read_json(p)
    if not isinstance(user, dict):
        C.log("config.json invalid; using defaults")
        return defaults()
    return deep_merge(defaults(), user)
