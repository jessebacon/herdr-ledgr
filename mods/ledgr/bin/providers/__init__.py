"""ledgr extraction providers: one module per provider, one signature.

  complete(system: str, user_text: str, schema: dict, opts: dict) -> result
    opts:   {"model", "timeout", "key" (str|None), "base_url" (str|None)}
    result: {"ok", "text", "data", "usage", "model", "request_id", "error"} (+ "provider")

config.extract.provider picks the module: anthropic (default), openai-compatible, cli.
Keys come from the Keychain, service `ledgr`, account = provider name (or LEDGR_<PROVIDER>_KEY).
Results are never trusted as-is: lib/ledgr_extract.py parses them and runs ledgr_asks.validate.
"""
import ledgr_core as C

from . import anthropic, cli, openai_compatible
from ._http import result

MODULES = {"anthropic": anthropic, "openai-compatible": openai_compatible, "cli": cli}
KEY_REQUIRED = {"anthropic": True, "openai-compatible": False, "cli": False}


def call(cfg, system, user_text, schema):
    """Dispatch on config.extract.provider. No anthropic key: the cli provider when
    extract.cli_fallback is true, else the "no credential" error the panel shows (spec 4.6)."""
    ex = cfg.get("extract") or {}
    name = ex.get("provider") or "anthropic"
    mod = MODULES.get(name)
    opts = {"model": ex.get("model") or "claude-haiku-5-5", "timeout": int(ex.get("timeout_s") or 20),
            "key": None, "base_url": ex.get("base_url")}
    if mod is None:
        return dict(result(error=f"unknown provider {name!r}", model=opts["model"]), provider=name)
    if name != "cli":
        key, why = C.read_key(name)
        opts["key"] = key
        if not key and KEY_REQUIRED[name]:
            if ex.get("cli_fallback") is True:
                return dict(cli.complete(system, user_text, schema, opts), provider="cli")
            return dict(result(error="no credential", model=opts["model"], detail=why), provider=name)
    return dict(mod.complete(system, user_text, schema, opts), provider=name)
