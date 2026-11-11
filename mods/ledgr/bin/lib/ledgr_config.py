"""ledgr config: defaults for ledgr-data/config.json (spec Appendix B plus the provider seam) and
the loader. A missing file is created with the defaults; an invalid one is left alone and the
defaults are used."""
import json
import os

import ledgr_core as C

DEFAULT_CONFIG = {
    "v": 1,
    "instruct_block": True,           # the master switch: print the ledgr-asks instruction at
                                      # SessionStart (startup, resume, clear, compact); false is
                                      # asks.handoff "prose" whatever that says
    "instruct_reinject": True,        # with instruct_block: after a turn whose blocking ask only the
                                      # model found (no block in the message), print it once more
                                      # at that session's next prompt
    "asks": {
        "handoff": "ledgr",             # who owns the closing list the agent gives you (handoff()):
                                        # ledgr = blocking and needed items only in the ledgr-asks block,
                                        # the prose ends with one pointer line "ledgr: N items for you,
                                        # M blocking" and lists nothing; both = the prose list as usual
                                        # plus the block; prose = no instruction at all, extractor only.
                                        # Read at every hook run: a running session gets the new wording
                                        # at its next prompt
    },
    "extract": {
        "mode": "block-first",          # block-first | always-model | block-only
        "provider": "anthropic",        # anthropic | openai-compatible | cli
        "model": "claude-haiku-5-5",    # model id for the chosen provider
        "base_url": None,               # openai-compatible only, e.g. http://localhost:11434/v1
        "audit_rate": 0,
        "cli_fallback": False,          # no anthropic key -> use the cli provider
        "max_chars": 60000,
        "timeout_s": 20,
        "threshold": "needed",          # the mod's: asks at or above this level (optional < needed <
                                        # blocking) are open rows and count on the chip; lower ones
                                        # are kept as suggestions. Read again when the file changes
    },
    "surface": {"openPanelOnAsks": False},
    "branch": {"maxDepth": 2},
    "ui": {"foldAsksWhileWorking": False,     # the panel's: True = the asks lane folds while the agent works
           "animations": True,                # the panel's and chip's: False = no motion at all
           "pasteIntoPrompt": True,           # the panel's: True = Paste answer(s) / Paste into trunk paste
                                              # the message into the target's prompt (terminal.paste, once
                                              # its pane has the focus; never Enter); False = clipboard + focus
           "textScale": 1},                   # the mod's: every text size it draws times this, 0.8 to 1.6 in
                                              # steps of 0.05 (config.js textScaleOf); the settings dialog writes it
    "spaces": {"disabled": []},       # Herdr space ids where ledgr is off: no instruction and no
                                      # extraction for a session there (the hooks), no chip, no capture,
                                      # the panel says so; items are kept. The panel's session menu
                                      # writes it. A list: a config.json value replaces it whole
    "links": {"editor": "open"},      # the mod's: what a file path clicked in the detail dialog opens
                                      # with: open (the default app; a script opens as text, never run),
                                      # zed, code (at its line), or a command of your own with {path},
                                      # {line}, {col}, never a shell or a terminal (links.js openerArgv)
    "retention_days": 14,
}


HANDOFF_MODES = ("ledgr", "both", "prose")


def handoff(cfg):
    """The effective asks.handoff: "prose" when instruct_block (the master switch) is not true;
    else asks.handoff, "ledgr" when missing or unknown."""
    if not isinstance(cfg, dict) or cfg.get("instruct_block") is not True:
        return "prose"
    m = (cfg.get("asks") or {}).get("handoff") if isinstance(cfg.get("asks"), dict) else None
    m = m.strip().lower() if isinstance(m, str) else ""
    return m if m in HANDOFF_MODES else "ledgr"


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
