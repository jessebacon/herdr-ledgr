#!/usr/bin/env python3
"""Offline tests for setup/ledgr_setup.py: the JSON files it writes, and retiring a mod an earlier
install deployed. Everything happens in a scratch folder; nothing under the real home is read or
written. Run from the repo: python3 -I -B setup/tests/test_ledgr_setup.py"""
import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ledgr_setup as L  # noqa: E402

PASS = FAIL = 0


def ok(cond, name):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"FAIL {name}")


def scratch():
    root = tempfile.mkdtemp(prefix="ledgr-setup-test-")
    home = os.path.join(root, "herdr")
    os.makedirs(os.path.join(home, "mods", "ledgr"), exist_ok=True)
    os.makedirs(os.path.join(home, "layouts"), exist_ok=True)
    ns = argparse.Namespace(herdr_home=home, claude_settings=os.path.join(root, "claude", "settings.json"),
                            state_dir=os.path.join(root, "state"), yes=True)
    ctx = L.Ctx(ns)
    return root, ctx, L.State(ctx)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(text.encode("utf-8") if isinstance(text, str) else text)


def read(path):
    with open(path, "rb") as f:
        return f.read()


def quiet(fn, *a, **k):
    say = L.say
    L.say = lambda *_: None
    try:
        return fn(*a, **k)
    finally:
        L.say = say


ANS = {"agents": ["claude"], "hooks": True}


def test_dump():
    ok(L.dump({"a": 1}).endswith("}\n"), "dump: default style ends with a newline")
    ok(L.dump({"a": 1}, L.style_of('{\n    "a": 1\n}')).endswith("}\n"), "dump: a file read without a newline is written with one")
    ok(not L.dump({"a": 1}, L.style_of('{\n  "a": 1\n}\n')).endswith("\n\n"), "dump: exactly one final newline")
    ok(L.dump({"a": 1}, L.style_of('{\n    "a": 1\n}')).startswith('{\n    "a"'), "dump: keeps the file's indent")
    ok(L.with_nl(b"{}") == b"{}\n" and L.with_nl(b"{}\n") == b"{}\n", "with_nl")


def test_settings_write():
    for name, original in (("without", '{\n  "model": "opus"\n}'), ("with", '{\n  "model": "opus"\n}\n')):
        root, ctx, st = scratch()
        try:
            write(ctx.settings, original)
            quiet(L.apply_hooks, ctx, st, ANS, [])
            b = read(ctx.settings)
            d = json.loads(b)
            ok(b.endswith(b"}\n") and not b.endswith(b"\n\n"), f"settings ({name} a newline before): ends with one newline")
            ok(d.get("model") == "opus" and len(d["hooks"]) == 3, f"settings ({name} a newline before): hooks added, the rest kept")
        finally:
            shutil.rmtree(root)
    # no settings file at all
    root, ctx, st = scratch()
    try:
        quiet(L.apply_hooks, ctx, st, ANS, [])
        ok(read(ctx.settings).endswith(b"}\n"), "settings created: ends with a newline")
    finally:
        shutil.rmtree(root)


def test_mend_newline():
    root, ctx, st = scratch()
    try:
        write(ctx.settings, "{}\n")
        quiet(L.apply_hooks, ctx, st, ANS, [])
        # what install.sh did before the fix: ledgr's own write, final newline missing
        stripped = read(ctx.settings).rstrip(b"\n")
        write(ctx.settings, stripped)
        st.wrote(ctx.settings, stripped)
        changes = []
        quiet(L.apply_hooks, ctx, st, ANS, changes)
        ok(read(ctx.settings) == stripped + b"\n", "already registered: ledgr's own write gets its newline back")
        ok(any("final newline" in c for c in changes), "already registered: the summary says so")
        # someone else wrote it since (no newline): left alone
        other = stripped.replace(b"{", b'{\n  "theme": "dark",', 1)
        write(ctx.settings, other)
        quiet(L.apply_hooks, ctx, st, ANS, [])
        ok(read(ctx.settings) == other, "already registered: a file someone else wrote is not touched")
    finally:
        shutil.rmtree(root)


def test_restore_original():
    root, ctx, st = scratch()
    try:
        write(ctx.settings, '{\n  "model": "opus"\n}')          # the original, no final newline
        quiet(L.apply_hooks, ctx, st, ANS, [])
        sett, style, _ = L.load_json(ctx.settings)
        surgical = {k: v for k, v in sett.items() if k != "hooks"}
        notes = []
        L.restore_or_surgical(ctx, st, ctx.settings, surgical, style, "settings", notes)
        b = read(ctx.settings)
        ok(b == b'{\n  "model": "opus"\n}\n', "uninstall: the restored original ends with a newline")
        ok(any("restored the original" in n for n in notes), "uninstall: restored, not rewritten")
    finally:
        shutil.rmtree(root)


def layout(ctx, header):
    root = {"type": "row", "children": [{"id": "main", "type": "block", "content": {"tab": "active", "pane": {"header": {"content": {"mod": header}}}}}]}
    write(os.path.join(ctx.home, "layouts", "custom.json"), json.dumps(root, indent=2) + "\n")


def overlay_mod(ctx, st, name):
    """A mod an earlier install deployed from an overlay into an empty folder (origin absent)."""
    d = os.path.join(ctx.mods, name)
    for fn, text in (("main.js", "export default 1;\n"), ("mod.json", "{}\n")):
        p = os.path.join(d, fn)
        st.pristine(p, lambda b: False)
        write(p, text)
        st.wrote(p, text.encode())
    write(os.path.join(d, "gpui-kit.d.ts"), "// generated\n")
    st.d["mods"].append(name)
    return d


def test_retire():
    # the chip moved from the overlay's my-pane to ledgr-pane: my-pane goes, its records too
    root, ctx, st = scratch()
    try:
        d = overlay_mod(ctx, st, "my-pane")
        layout(ctx, "ledgr-pane")
        ok(L.retired_mods(ctx, st, {"ledgr", "ledgr-pane", "my-tabs"}) == ["my-pane"], "retire: my-pane is found")
        changes = []
        L.retire_mods(ctx, st, {"layout": {"chip": "ledgr-pane"}}, ["ledgr", "ledgr-pane"], changes)
        ok(not os.path.exists(d), "retire: mods/my-pane removed")
        ok("my-pane" not in st.d["mods"] and not any("/my-pane/" in k for k in st.files), "retire: its state records dropped")
        ok(any(c.startswith("mods/my-pane: removed") for c in changes), "retire: the summary names it")
    finally:
        shutil.rmtree(root)
    # a layout still uses it: kept
    root, ctx, st = scratch()
    try:
        d = overlay_mod(ctx, st, "my-pane")
        layout(ctx, "my-pane")
        changes = []
        L.retire_mods(ctx, st, {"layout": {"chip": "ledgr-pane"}}, ["ledgr", "ledgr-pane"], changes)
        ok(os.path.exists(os.path.join(d, "main.js")), "retire: kept while a layout uses it")
        ok(any("kept" in c for c in changes), "retire: the summary says it was kept")
    finally:
        shutil.rmtree(root)
    # edited since ledgr wrote it: kept as it is
    root, ctx, st = scratch()
    try:
        d = overlay_mod(ctx, st, "my-pane")
        write(os.path.join(d, "main.js"), "export default 2;\n")
        layout(ctx, "ledgr-pane")
        L.retire_mods(ctx, st, {"layout": {"chip": "ledgr-pane"}}, ["ledgr", "ledgr-pane"], [])
        ok(read(os.path.join(d, "main.js")) == b"export default 2;\n", "retire: an edited file is kept")
    finally:
        shutil.rmtree(root)
    # the chip turned off: ledgr-pane goes once no layout uses it
    root, ctx, st = scratch()
    try:
        write(os.path.join(ctx.mods, "ledgr-pane", "main.js"), "x\n")
        layout(ctx, "pane")
        changes = []
        L.retire_mods(ctx, st, {"layout": {"chip": "none"}}, ["ledgr"], changes)
        ok(not os.path.exists(os.path.join(ctx.mods, "ledgr-pane")), "retire: ledgr-pane removed when the chip is none")
        ok(os.path.isdir(os.path.join(st.ctx.state_dir)) and ctx.backup_dir and os.path.exists(os.path.join(ctx.backup_dir, "herdr", "mods", "ledgr-pane", "main.js")),
           "retire: ledgr-pane backed up first")
    finally:
        shutil.rmtree(root)


def ns(root, settings=None, answers=None):
    return argparse.Namespace(herdr_home=os.path.join(root, "herdr"), claude_settings=settings, answers=answers,
                              state_dir=os.path.join(root, "state"), yes=True)


def test_settings_list():
    """More than one Claude settings file: a second config folder (CLAUDE_CONFIG_DIR)."""
    root = tempfile.mkdtemp(prefix="ledgr-setup-test-")
    saved = os.environ.pop("CLAUDE_CONFIG_DIR", None)
    try:
        home = os.path.join(root, "home")
        os.makedirs(os.path.join(root, "herdr", "mods"))
        main_s, work_s, x_s = (os.path.join(home, d, "settings.json") for d in (".claude", ".claude-work", ".claude-x"))
        write(main_s, "{}\n")
        write(work_s, '{\n  "model": "opus"\n}')                       # no final newline
        os.makedirs(os.path.dirname(x_s))                              # a config folder with no settings.json yet
        write(os.path.join(home, ".local", "bin", "claude-x"), '#!/bin/sh\nexec env CLAUDE_CONFIG_DIR="$HOME/.claude-x" claude "$@"\n')
        write(os.path.join(home, ".local", "bin", "big"), b"CLAUDE_CONFIG_DIR=/elsewhere " + b"\0" * 300000)
        write(os.path.join(home, ".zshrc"), 'claude-w() { CLAUDE_CONFIG_DIR=~/.claude-work command claude "$@"; }\n'
                                            'claude-y() { CLAUDE_CONFIG_DIR="$HOME/.claude-y" command claude "$@"; }\n')
        # the answers key: one string, or a list; a flag wins over the answers file
        ok(L.Ctx(ns(root, main_s)).settings_all == [main_s], "claude_settings: one string")
        ok(L.Ctx(ns(root, [main_s, work_s])).settings_all == [main_s, work_s], "claude_settings: a list, the first is the primary")
        af = os.path.join(root, "answers.json")
        write(af, json.dumps({"claude_settings": [main_s, work_s]}))
        ok(L.make_ctx(ns(root, None, af)).settings_all == [main_s, work_s], "answers file: a list")
        write(af, json.dumps({"claude_settings": work_s}))
        ok(L.make_ctx(ns(root, None, af)).settings_all == [work_s], "answers file: one string")
        ok(L.make_ctx(ns(root, [main_s], af)).settings_all == [main_s], "a --claude-settings flag wins over the answers file")
        # detection, read-only: ~/.claude-* with a settings.json, wrapper scripts, shell start-up files
        ctx = L.Ctx(ns(root, main_s))
        before = {p: read(p) for p in (main_s, work_s)}
        found = dict(L.claude_configs(ctx, home=home))
        ok(set(found) == {work_s, x_s}, f"detected: ~/.claude-work and ~/.claude-x only (got {sorted(found)})")
        ok("holds a settings.json" in found.get(work_s, ""), "detected: why ~/.claude-work")
        ok("~/.local/bin/claude-x" in found.get(x_s, ""), "detected: why ~/.claude-x (the wrapper)")
        ok(all(read(p) == b for p, b in before.items()) and not os.path.exists(x_s), "detection wrote nothing")
        # the question: with nothing given every config defaults to yes; a given list decides
        f = {"claude_configs": list(found.items())}
        ctx.settings_given = None                                       # as when no flag or answers file names any
        ok(quiet(L.choose_configs, ctx, f, {}, L.Asker(True)) == [main_s, work_s, x_s], "choose: none given, every detected one defaults to yes")
        given = L.Ctx(ns(root, [main_s, work_s]))
        ok(quiet(L.choose_configs, given, f, {}, L.Asker(True)) == [main_s, work_s], "choose: a given list is the default (an unlisted one stays out)")
        # registration in every chosen file, consent per file
        ctx.settings_all = [main_s, work_s, x_s]
        st = L.State(ctx)
        quiet(L.apply_hooks, ctx, st, {"agents": ["claude"], "hooks": True, "_declined": [x_s]}, [])
        ok(L.hooks_in(main_s) and L.hooks_in(work_s), "hooks registered in both chosen files")
        ok(read(work_s).endswith(b"}\n") and json.loads(read(work_s))["model"] == "opus", "the second file keeps its keys and gets a final newline")
        ok(not os.path.exists(x_s), "a declined file is not written")
        st.save()
        ok([L.expand(x) for x in json.load(open(ctx.state_file))["claude_settings"]] == [main_s, work_s, x_s], "install-state keeps the list")
        # uninstall: the second file's original comes back (its state key is abs/...)
        sett, style, _ = L.load_json(work_s)
        notes = []
        L.restore_or_surgical(ctx, st, work_s, {k: v for k, v in sett.items() if k != "hooks"}, style, "work", notes,
                              marked=lambda b: L.HOOK_MARK.encode() in b)
        ok(read(work_s) == b'{\n  "model": "opus"\n}\n' and any("restored the original" in n for n in notes), "uninstall restores the second file's original")
    finally:
        if saved is not None:
            os.environ["CLAUDE_CONFIG_DIR"] = saved
        shutil.rmtree(root)


def test_handoff():
    """asks.handoff: the answer is written to config.json; prose turns the master switch off."""
    root, ctx, st = scratch()
    try:
        p = os.path.join(ctx.data, "config.json")
        write(p, '{"v": 1, "instruct_block": true, "extract": {"threshold": "needed"}}\n')
        base = {"provider": "anthropic", "model": None, "base_url": None, "threshold": "needed", "animations": True,
                "fold_asks_while_working": False}
        for hand, ib in (("prose", False), ("both", True), ("ledgr", True)):
            changes = []
            quiet(L.apply_config, ctx, {**base, "asks_handoff": hand}, changes)
            cfg = json.loads(read(p))
            ok(cfg["asks"]["handoff"] == hand and cfg["instruct_block"] is ib, f"handoff {hand}: asks.handoff and instruct_block {ib}")
            ok(any(f"closing list {hand}" in c for c in changes), f"handoff {hand}: named in the change line")
        quiet(L.apply_config, ctx, {**base, "asks_handoff": "bogus"}, [])
        ok(json.loads(read(p))["asks"]["handoff"] == "ledgr", "an unknown answer writes the default, ledgr")
        ok([v for v, _ in L.HANDOFFS] == ["ledgr", "both", "prose"] and L.DEFAULTS["asks_handoff"] == "ledgr", "three choices, ledgr first and default")
    finally:
        shutil.rmtree(root)


def test_keep_config_edits():
    """--yes and an answers file (2026-11-10): a config.json value the settings dialog changed since the last
    install is kept and named in the summary; an answer changed while config.json was left alone still
    applies; a flag still wins. The whole cmd_install runs in a scratch home (preflight and the herdr-app
    checks stubbed; no tests, no MCP, no claude)."""
    root, ctx, st = scratch()
    saved = (L.preflight, L.herdr_checks)
    try:
        write(os.path.join(ctx.home, "AGENTS.md"), "x\n")
        write(os.path.join(ctx.home, "keys.json"), '{"global": {}}\n')
        f = {"hard": [], "warn": [], "claude": None, "security": None, "layouts": [], "active": None, "claude_configs": [],
             "repo_version": "0.1.0"}
        L.preflight = lambda ctx, quiet=False: json.loads(json.dumps(f))
        L.herdr_checks = lambda ctx, mods: True
        af = os.path.join(root, "answers.json")
        cfgp = os.path.join(ctx.data, "config.json")

        def install(answers, flags=None):
            write(af, json.dumps(answers))
            out = []
            say = L.say
            L.say = lambda m="": out.append(m)
            try:
                L.cmd_install(ctx, argparse.Namespace(answers=af, save_answers=None, no_tests=True), flags or {})
            finally:
                L.say = say
            return json.loads(read(cfgp)), "\n".join(out)

        ans = {"provider": "anthropic", "api_key": "skip", "threshold": "needed", "asks_handoff": "ledgr", "animations": True,
               "fold_asks_while_working": False, "mcp": False, "layout": {"name": None, "panel": "skip", "host": "none", "chip": "none"}}
        cfg, _ = install(ans)
        ok(cfg["extract"]["threshold"] == "needed", "keep: the first install writes the answers' threshold")
        state = json.loads(read(ctx.state_file))
        first = {"threshold": "needed", "asks_handoff": "ledgr", "animations": True, "fold_asks_while_working": False}
        ok(state.get("config_written") == {"wrote": first, "said": first},
           f"keep: install-state records what it wrote to config.json and what the answers said ({state.get('config_written')})")
        # The settings dialog changes the threshold and the closing list; the answers file is unchanged.
        cfg["extract"]["threshold"] = "blocking"
        cfg["asks"]["handoff"] = "prose"
        cfg["instruct_block"] = False
        write(cfgp, json.dumps(cfg, indent=2) + "\n")
        st2 = L.State(ctx)
        cfg, out = install(ans)
        ok(cfg["extract"]["threshold"] == "blocking", "keep: a second --yes install keeps the threshold the dialog wrote")
        ok(cfg["asks"]["handoff"] == "prose" and cfg["instruct_block"] is False, "keep: and the closing list (instruct_block with it)")
        ok("kept your threshold: blocking" in out and "kept your closing list: prose" in out, "keep: the run says what it kept")
        cw = json.loads(read(ctx.state_file))["config_written"]
        ok(cw["wrote"]["threshold"] == "blocking" and cw["said"]["threshold"] == "needed", "keep: the kept value is what the install wrote; the answer is what was said")
        # The same answers file again (the maintainer runs it after every change): the dialog's values stay.
        cfg, out = install(ans)
        ok(cfg["extract"]["threshold"] == "blocking" and cfg["asks"]["handoff"] == "prose", "keep: a third run with the same answers does not revert them")
        # The answers change while config.json stays as the last install wrote it: the answer applies.
        cfg, out = install({**ans, "threshold": "optional", "animations": False})
        ok(cfg["extract"]["threshold"] == "optional", "keep: a changed answer with an unchanged config.json still applies")
        ok(cfg["ui"]["animations"] is False and "kept your threshold" not in out and "kept your animations" not in out,
           "keep: animations from the changed answer too, neither said kept")
        ok(cfg["asks"]["handoff"] == "prose" and "kept your closing list: prose" in out, "keep: the closing list the dialog wrote still stays")
        # A flag wins over a value the dialog changed.
        cfg["extract"]["threshold"] = "needed"
        write(cfgp, json.dumps(cfg, indent=2) + "\n")
        cfg, out = install(ans, {"threshold": "blocking"})
        ok(cfg["extract"]["threshold"] == "blocking" and "kept your threshold" not in out, "keep: a --threshold flag wins over config.json")
        # An older state (no config_written): its answers are what it wrote.
        sd = json.loads(read(ctx.state_file))
        sd.pop("config_written", None)
        sd["answers"]["threshold"] = "blocking"
        write(ctx.state_file, json.dumps(sd))
        cfg["extract"]["threshold"] = "needed"
        write(cfgp, json.dumps(cfg, indent=2) + "\n")
        cfg, out = install({**ans, "threshold": "optional"})
        ok(cfg["extract"]["threshold"] == "needed" and "kept your threshold: needed" in out, "keep: an older state compares against the answers it recorded")
        ok(st2 is not None and L.keep_config_edits(L.Ctx(argparse.Namespace(**{**vars(ns(root)), "yes": False})), L.State(ctx), {}, {}) == [],
           "keep: an interactive run keeps nothing by itself (the current value is its default)")
    finally:
        L.preflight, L.herdr_checks = saved
        shutil.rmtree(root)


def test_mcp():
    """The MCP server: `claude mcp add --scope user` per config folder (a fake claude here), and the
    allow entries; idempotent; a declined folder is left alone. Nothing under the real home."""
    root, ctx, st = scratch()
    calls = []
    saved = (L.run, L.find_claude, L.hook_python)
    def fake_run(args, env=None, timeout=60, cwd=None, inp=None):
        if args[:2] == ["/fake/claude", "mcp"]:
            calls.append((args[2], (env or {}).get("CLAUDE_CONFIG_DIR"), list(args)))
            cj = os.path.join((env or {})["CLAUDE_CONFIG_DIR"], ".claude.json")
            cfg = json.loads(read(cj)) if os.path.exists(cj) else {}
            if args[2] == "add":
                cfg.setdefault("mcpServers", {})["ledgr"] = {"type": "stdio", "command": args[-4], "args": args[-3:], "env": {}}
            elif args[2] == "remove":
                cfg.get("mcpServers", {}).pop("ledgr", None)
            write(cj, json.dumps(cfg))
            return 0, "", ""
        return saved[0](args, env=env, timeout=timeout, cwd=cwd, inp=inp)
    try:
        L.run, L.find_claude, L.hook_python = fake_run, (lambda: "/fake/claude"), (lambda: ("/opt/py3", "3.15.0"))
        work = os.path.join(root, "home", ".claude-work", "settings.json")
        other = os.path.join(root, "home", ".claude-x", "settings.json")
        write(work, '{\n  "model": "opus",\n  "permissions": {"allow": ["Bash(ls:*)"]}\n}\n')
        write(other, "{}\n")
        ctx.settings_all = [work, other]
        ans = {"mcp": True, "agents": ["claude"], "hooks": True, "_declined": [], "_mcp_declined": [other]}
        warn, changes = [], []
        quiet(L.apply_mcp, ctx, st, ans, changes, warn)
        add = [c for c in calls if c[0] == "add"]
        ok(len(add) == 1 and add[0][1] == os.path.dirname(work), "one claude mcp add, with CLAUDE_CONFIG_DIR set to that folder")
        ok(add and add[0][2][1:] == ["mcp", "add", "--scope", "user", "--transport", "stdio", "ledgr", "--", "/opt/py3", "-I", "-B", L.mcp_script(ctx)],
           "the exact argv from the MCP README (installed path, the hooks' python3)")
        ok(L.mcp_registered(ctx, work) == "ok" and L.mcp_registered(ctx, other) is None, "registered for the chosen folder only")
        allow = json.loads(read(work))["permissions"]["allow"]
        ok(allow == ["Bash(ls:*)"] + L.MCP_TOOLS and json.loads(read(work))["model"] == "opus", "the four allow entries added, the rest kept")
        ok(L.MCP_TOOLS == ["mcp__ledgr__declare_asks", "mcp__ledgr__open_asks", "mcp__ledgr__parked_questions", "mcp__ledgr__resolve_asks"]
           and L.mcp_tool_names() == ["declare_asks", "open_asks", "parked_questions", "resolve_asks"], "MCP_TOOLS: resolve_asks added last")
        lines, problem = L.mcp_report(ctx, work, True)
        ok(problem is None and "allow entries present" in lines[0] and len(lines) == 1, "--check: registered with every allow entry is healthy")
        ok(read(work).endswith(b"}\n") and read(other) == b"{}\n", "a final newline; the declined folder's settings untouched")
        ok(warn == [], "no warnings")
        calls.clear(); changes.clear()
        quiet(L.apply_mcp, ctx, st, ans, changes, warn)
        ok(calls == [] and changes == [] and json.loads(read(work))["permissions"]["allow"].count(L.MCP_TOOLS[0]) == 1, "a second run changes nothing")
        argv, d, line = L.mcp_command(ctx, work)
        ok(line.startswith("CLAUDE_CONFIG_DIR=") and " claude mcp add --scope user --transport stdio ledgr -- /opt/py3 -I -B " in line, "the line shown and printed by --check")
        ok(L.config_env(os.path.expanduser("~/.claude/settings.json")) is None and L.mcp_user_json(os.path.expanduser("~/.claude/settings.json")) == os.path.expanduser("~/.claude.json"),
           "the default folder: no CLAUDE_CONFIG_DIR, servers in ~/.claude.json (paths only; nothing read)")
        ok(L.perms_missing(other) == L.MCP_TOOLS, "perms_missing lists all four when none are there")
        lines, problem = L.mcp_report(ctx, other, False)
        ok(problem is None and "not registered" in lines[0], "--check: a folder the person declined is reported, not counted")
        lines, problem = L.mcp_report(ctx, other, True)
        ok(problem and "missing for" in problem and any("register: " in x for x in lines), "--check: chosen but not registered is a problem")
        # an install from before resolve_asks: the server registered, the first three allow entries only
        old = ["mcp__ledgr__declare_asks", "mcp__ledgr__open_asks", "mcp__ledgr__parked_questions"]
        write(work, json.dumps({"model": "opus", "permissions": {"allow": ["Bash(ls:*)"] + old}}, indent=2) + "\n")
        ok(L.perms_missing(work) == ["mcp__ledgr__resolve_asks"], "older install: perms_missing names resolve_asks only")
        lines, problem = L.mcp_report(ctx, work, False)
        ok(problem and "mcp__ledgr__resolve_asks" in problem and "--mcp on" in problem,
           "--check: registered but resolve_asks not allowed is a problem even when the answers did not choose mcp, with the remedy")
        ok(any("would prompt" in x and "earlier install" in x and "./install.sh --mcp on" in x for x in lines), "--check: the line says why and how")
        calls.clear(); changes.clear()
        quiet(L.apply_mcp, ctx, st, ans, changes, warn)
        allow = json.loads(read(work))["permissions"]["allow"]
        ok(calls == [] and allow == ["Bash(ls:*)"] + old + ["mcp__ledgr__resolve_asks"]
           and changes == [f"{L.tilde(work)}: permissions.allow += mcp__ledgr__resolve_asks"],
           "install again (--mcp on): no claude call, resolve_asks appended, the rest kept in place")
        ok(L.mcp_report(ctx, work, True)[1] is None, "--check: healthy afterwards")
        # uninstall's filter takes every ledgr entry, the new one included, and nothing else
        ok([x for x in allow if x not in L.MCP_TOOLS] == ["Bash(ls:*)"], "uninstall: all four ledgr entries removed, the rest kept")
        st.d["mcp"] = []
        quiet(L.apply_mcp, ctx, st, {**ans, "mcp": False}, changes, warn)
        ok(calls == [], "mcp false: nothing run")
    finally:
        L.run, L.find_claude, L.hook_python = saved
        shutil.rmtree(root)


# RECIPE.md: herdr.dev's gallery index skips a recipe of 64 KiB or more (ledgr dropped off the mods page
# on 2026-11-12 at 66,294 bytes), and the manual fixes its six parts. The repo's own file, read relative
# to the repo root, then the guard itself on scratch recipes.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def recipe_text(parts=None, before="", intro="One paragraph of what the person sees.", pad=0, code_in=None):
    parts = parts or L.RECIPE_PARTS
    body = [before + "# ledgr", "", intro, "", "![ledgr](preview.png)", ""]
    for p in parts:
        body += [f"## {p}", "", ("- uses `code` here" if p == code_in else "- plain words") + ("x" * pad if p == parts[-1] else ""), ""]
    return "\n".join(body)


def test_recipe():
    path = os.path.join(REPO_ROOT, "RECIPE.md")
    n, probs, warns = L.recipe_check(path)
    ok(n is not None and n < L.RECIPE_LIMIT, f"RECIPE.md under the gallery's {L.RECIPE_LIMIT:,} bytes (is {n})")
    ok(probs == [], "RECIPE.md: the manual's form (" + "; ".join(probs) + ")")
    for w in warns:
        print(f"WARN {w}")
    ok(L.RECIPE_LIMIT == 65536 and L.RECIPE_WARN == 57344, "limits: 64 KiB fails, 56 KiB warns")
    root = tempfile.mkdtemp(prefix="ledgr-recipe-test-")
    try:
        def check(text):
            f = os.path.join(root, "RECIPE.md")
            write(f, text)
            return L.recipe_check(f)
        n, probs, warns = check(recipe_text())
        ok(probs == [] and warns == [], "a minimal recipe in the manual's form passes")
        n, probs, warns = check(recipe_text(pad=L.RECIPE_LIMIT))
        ok(n >= L.RECIPE_LIMIT and any("gallery skips" in x for x in probs), "64 KiB or more fails")
        n, probs, warns = check(recipe_text(pad=L.RECIPE_WARN + 100 - len(recipe_text().encode())))
        ok(L.RECIPE_WARN <= n < L.RECIPE_LIMIT and probs == [] and len(warns) == 1, "from 56 KiB: a warning, no failure")
        n, probs, _ = check(recipe_text(parts=["What you see", "Built from", "How it behaves", "Watch out", "Done when"]))
        ok(any("parts" in x for x in probs), "parts out of order fail")
        n, probs, _ = check(recipe_text(parts=["Before you add it"] + L.RECIPE_PARTS))
        ok(any("parts" in x for x in probs), "an extra ## section fails")
        n, probs, _ = check(recipe_text(parts=L.RECIPE_PARTS[:-1]))
        ok(any("parts" in x for x in probs), "a missing part fails")
        n, probs, _ = check(recipe_text(before="Read me first.\n\n"))
        ok(any("start with" in x for x in probs), "anything before the title fails")
        n, probs, _ = check(recipe_text(intro="One paragraph.\n\nA second one."))
        ok(any("one paragraph" in x for x in probs), "two paragraphs before the image fail")
        n, probs, _ = check(recipe_text(code_in="How it behaves"))
        ok(any("code in How it behaves" in x for x in probs), "code in How it behaves fails")
        n, probs, _ = check(recipe_text(code_in="Built from"))
        ok(probs == [], "code in Built from is fine")
        n, probs, _ = check(recipe_text().replace("- plain words\n\n## Done when", "```\n## not a heading\n```\n\n## Done when"))
        ok(probs == [], "a ## line inside a code fence is no heading")
        ok(L.recipe_check(os.path.join(root, "missing.md"))[0] is None, "a missing file: bytes None")
    finally:
        shutil.rmtree(root)


def test_writer_report():
    """--check's writer report (2026-11-19): a fresh claim is no proof the writer applies events."""
    root, ctx, _ = scratch()
    try:
        spool = os.path.join(ctx.data, "spool")
        os.makedirs(spool)
        store = os.path.join(ctx.data, "store.json")
        write(store, "{}")
        now = time.time()            # ago() reads the clock itself

        def at(path, t):
            os.utime(path, (t, t))

        def queue(n, oldest, step=1.0):
            for i in range(n):
                p = os.path.join(spool, f"{int((oldest + i * step) * 1000)}-asks-1-{i:06x}.json")
                write(p, "{}")
                at(p, oldest + i * step)

        def clear():
            for n in os.listdir(spool):
                os.unlink(os.path.join(spool, n))

        def report(shared, running=True):
            return L.writer_report(ctx, {"shared": shared, "running": running}, now=now)

        claim = {"ledgr.writer": {"id": "w1", "by": "my-tabs", "at": (now - 20) * 1000, "done": (now - 30) * 1000}}
        ok(L.stall_bound_s() == 90.0, "the stall bound is writer.js PASS_STUCK_MS (90 s)")
        at(store, now - 30)
        lines, probs = report(claim)
        ok(probs == [] and any("held by my-tabs (claimed 20 s ago); last pass ended 30 s ago" in x for x in lines)
           and any("0 events waiting; store.json written 30 s ago" in x for x in lines), f"healthy: {lines} {probs}")
        queue(1, now - 20)
        at(store, now - 60)
        ok(report(claim)[1] == [], "an event 20 s old: behind, not a problem")
        clear()
        # The incident: the claim renewed 20 s ago, 103 events waiting for 3 h, store.json not written since.
        queue(103, now - 3 * 3600, step=60)
        at(store, now - 3 * 3600 - 5)
        lines, probs = report(claim)
        ok(any("held by my-tabs (claimed 20 s ago)" in x for x in lines) and any("103 events waiting, the oldest from 3 h ago; store.json written 3 h ago" in x for x in lines),
           f"the incident: the claim and the numbers: {lines}")
        ok(len(probs) == 1 and probs[0].startswith("the writer is not applying events: 103 events waiting, the oldest for 3 h 0 min, and store.json last written 3 h 0 min ago.")
           and "Relaunch Herdr" in probs[0] and "nothing waiting is lost" in probs[0] and "writer.log" in probs[0], f"the incident is a problem, with what to do: {probs}")
        lines, probs = report(claim, running=False)
        ok(probs == [] and any("Herdr is not running: they wait for its writer" in x for x in lines), f"Herdr not running: they wait, no problem: {lines} {probs}")
        lines, probs = report({}, running=False)
        ok(probs == [] and any("no claim yet (Herdr is not running)" in x for x in lines), "no claim, Herdr not running: no problem")
        clear()
        # An event that waits while the writer moves on: named.
        queue(1, now - 600)
        at(store, now - 30)
        probs = report(claim)[1]
        ok(len(probs) == 1 and "has waited 10 min while the writer applies the rest" in probs[0] and "-asks-1-000000.json" in probs[0],
           f"an event the writer does not apply is named: {probs}")
        clear()
        # The claim itself counts only when an event waits (over 5 s, store.json not written since it
        # arrived): a claim is as old as the writer's last beat, hours old after the machine slept while the
        # writer works (2026-11-19 review). Each case once with nothing waiting (no problem), once with an
        # event 30 s old and store.json older (a problem).
        def waiting(on):
            clear()
            if on:
                queue(1, now - 30)
                at(store, now - 60)
            else:
                at(store, now - 3)
        stuck = {"ledgr.writer": {"id": "w1", "by": "my-tabs", "at": (now - 20) * 1000,
                                  "pass": {"at": (now - 200) * 1000, "step": "save: store.json mv", "since": (now - 200) * 1000},
                                  "fault": "stuck 95 s in save: store.json mv; restarting the writer (log/writer.log)"}}
        restarting = {"ledgr.writer": {"id": "w1", "by": "my-tabs", "at": (now - 5) * 1000,
                                       "stall": {"at": (now - 5) * 1000, "step": "start: store.json", "ms": 95000, "ok": False, "kind": "start"}}}
        backing = {"ledgr.writer": {"id": "w1", "by": "my-tabs", "at": (now - 5) * 1000,
                                    "stall": {"at": (now - 400) * 1000, "step": "save: store.json mv", "ms": 95000, "ok": False, "kind": "pass",
                                              "retryAt": (now + 200) * 1000, "tries": 3}}}
        old = {"ledgr.writer": {"id": "w1", "by": "my-tabs", "at": (now - 600) * 1000}}
        slept = {"ledgr.writer": {"id": "w1", "by": "my-tabs", "at": (now - 7200) * 1000, "done": (now - 7200) * 1000}}
        for name, claim, want in (("a pass stuck in one step", stuck, "my-tabs has waited 3 min in save: store.json mv"),
                                  ("a stall not come back from", restarting, "my-tabs is stuck in start: store.json"),
                                  ("a writer backing off", backing, "my-tabs is stuck in save: store.json mv and waits before it tries again"),
                                  ("a claim nobody renewed", old, "my-tabs's claim has not been renewed for 10 min"),
                                  ("a claim 2 h old (the machine slept)", slept, "my-tabs's claim has not been renewed for 2 h 0 min")):
            waiting(False)
            lines, probs = report(claim)
            ok(probs == [], f"{name}, nothing waiting: no problem (the claim alone proves nothing): {probs}")
            waiting(True)
            lines, probs = report(claim)
            ok(len(probs) == 1 and want in probs[0] and "Relaunch Herdr" in probs[0], f"{name}, an event waiting 30 s: a problem: {probs}")
        waiting(False)
        lines, _ = report(stuck)
        ok(any("in save: store.json mv for 3 min" in x for x in lines) and any("! writer fault  stuck 95 s" in x for x in lines), f"the claim's step and fault are shown: {lines}")
        # Just relaunched with a backlog: events 10 min old, store.json a day old, the writer starting 2 s ago.
        clear()
        queue(3, now - 600)
        at(store, now - 86400)
        starting = {"ledgr.writer": {"id": "w2", "by": "my-tabs", "at": now * 1000, "pass": {"at": (now - 2) * 1000, "step": "start: store.json", "since": (now - 2) * 1000}}}
        lines, probs = report(starting)
        ok(probs == [] and any("at work (start: store.json): 3 events to apply" in x for x in lines), f"a writer at work on a backlog: behind, no problem: {lines} {probs}")
        clear()
        back = {"ledgr.writer": {"id": "w1", "by": "my-tabs", "at": (now - 5) * 1000,
                                 "stall": {"at": (now - 300) * 1000, "back": (now - 299) * 1000, "step": "save: store.json mv", "ms": 95000, "ok": True, "kind": "pass"}}}
        lines, probs = report(back)
        ok(probs == [] and any("restarted 4 min ago after 95 s in save: store.json mv" in x for x in lines), f"a stall it came back from: said, no problem: {lines} {probs}")
        ok(report({})[1] == ["no writer holds the role"], "no claim while Herdr runs: a problem, as before")
    finally:
        shutil.rmtree(root)


def test_retention_migration():
    """retention_days (2026-11-19): an older install's config.json holds 14, the old default the hooks and the
    installer wrote into every new file; the first install that knows the archive moves it to 3, once, says
    so in the Plan and the summary, and records it in install-state, so a 14 chosen in Settings later stays.
    The whole cmd_install runs in a scratch home, as in test_keep_config_edits."""
    root, ctx, st = scratch()
    saved = (L.preflight, L.herdr_checks)
    try:
        lib = os.path.join(L.REPO, "mods", L.MOD, "bin", "lib")
        sys.path.insert(0, lib)
        import ledgr_config as K  # noqa: E402  (the hooks' defaults, from the repo)
        ok(K.DEFAULT_CONFIG["retention_days"] == L.RETENTION_DEFAULTS["retention_days"] == 3
           and K.DEFAULT_CONFIG["retention"] == {"turns": L.RETENTION_DEFAULTS["turns"], "coldDays": L.RETENTION_DEFAULTS["coldDays"]}
           == {"turns": 12, "coldDays": 7},
           f"retention: the installer's defaults are ledgr_config.py's (3 days, 12 turn records, cold after 7 days): {K.DEFAULT_CONFIG['retention']}")
        old = dict(K.defaults(), retention_days=14)
        old.pop("retention")
        ok(K.deep_merge(K.defaults(), old)["retention"] == {"turns": 12, "coldDays": 7}, "retention: the hooks' merge fills retention (turns, coldDays) into an older file")
        ok(K.deep_merge(K.defaults(), {"retention": {"coldDays": 0}})["retention"] == {"turns": 12, "coldDays": 0}, "retention: a partial retention keeps turns")
        write(os.path.join(ctx.home, "AGENTS.md"), "x\n")
        write(os.path.join(ctx.home, "keys.json"), '{"global": {}}\n')
        f = {"hard": [], "warn": [], "claude": None, "security": None, "layouts": [], "active": None, "claude_configs": [],
             "repo_version": "0.1.0"}
        L.preflight = lambda ctx, quiet=False: json.loads(json.dumps(f))
        L.herdr_checks = lambda ctx, mods: True
        af = os.path.join(root, "answers.json")
        cfgp = os.path.join(ctx.data, "config.json")
        ans = {"provider": "anthropic", "api_key": "skip", "threshold": "needed", "asks_handoff": "ledgr", "animations": True,
               "fold_asks_while_working": False, "mcp": False, "layout": {"name": None, "panel": "skip", "host": "none", "chip": "none"}}

        def install():
            write(af, json.dumps(ans))
            out = []
            say = L.say
            L.say = lambda m="": out.append(m)
            try:
                L.cmd_install(ctx, argparse.Namespace(answers=af, save_answers=None, no_tests=True), {})
            finally:
                L.say = say
            return json.loads(read(cfgp)), "\n".join(out)

        # An older install: config.json as the hooks created it, every default written, 14 among them.
        write(cfgp, json.dumps(old, indent=2) + "\n")
        cfg, out = install()
        ok(cfg["retention_days"] == 3, f"migration: the old default 14 becomes 3 ({cfg.get('retention_days')})")
        ok("retention_days 14, the old default, becomes 3 (once)" in out, "migration: the Plan says so before anything is written")
        ok("retention_days 14 (the old default) -> 3" in out and "Closed items stay in the list" in out, "migration: the summary says what it did")
        ok("retention" not in cfg, "migration: nothing else is written (retention.turns comes from the merges)")
        state = json.loads(read(ctx.state_file))
        ok(isinstance((state.get("migrations") or {}).get("retention_days"), str), f"migration: recorded in install-state ({state.get('migrations')})")
        # The person chooses 14 in Settings afterwards: the next install leaves it.
        cfg["retention_days"] = 14
        write(cfgp, json.dumps(cfg, indent=2) + "\n")
        cfg, out = install()
        ok(cfg["retention_days"] == 14 and "the old default" not in out, "migration: a 14 chosen after it stays (once only)")
        # A fresh home: config.json made from the defaults (3), recorded, nothing said.
        root2, ctx2, st2 = scratch()
        try:
            ctx_saved = ctx
            ctx = ctx2
            cfgp = os.path.join(ctx.data, "config.json")
            write(os.path.join(ctx.home, "AGENTS.md"), "x\n")
            write(os.path.join(ctx.home, "keys.json"), '{"global": {}}\n')
            cfg, out = install()
            ok(cfg["retention_days"] == 3 and "the old default" not in out, "migration: a new config.json has 3 and nothing to say")
            ok((json.loads(read(ctx.state_file)).get("migrations") or {}).get("retention_days"), "migration: recorded there too, so a later 14 stays")
            cfg["retention_days"] = 14
            write(cfgp, json.dumps(cfg, indent=2) + "\n")
            cfg, out = install()
            ok(cfg["retention_days"] == 14, "migration: ...and it does")
            ctx = ctx_saved
        finally:
            shutil.rmtree(root2)
        # The pieces: another value is left alone and recorded; no state, no change; a bool is not 14.
        s3 = L.State(ctx)
        s3.d.pop("migrations", None)
        c7 = {"retention_days": 7}
        ok(L.migrate_retention(s3, c7) is None and c7["retention_days"] == 7 and s3.d["migrations"]["retention_days"], "migration: 7 stays, and the look is recorded")
        c14 = {"retention_days": 14}
        ok(L.migrate_retention(None, c14) is None and c14["retention_days"] == 14, "migration: without install-state nothing changes")
        ok(not L.retention_pending(L.State(ctx), {"retention_days": True}) and not L.retention_pending(None, {"retention_days": 14}), "migration: pending only for the number 14 with a state")
    finally:
        L.preflight, L.herdr_checks = saved
        shutil.rmtree(root)


def test_retention_report():
    """--check's retention lines (2026-11-19): the configured values, store.json against the cap and
    housekeeping's threshold, the last run and the first one, the archive and the one-time copy; the old
    default 14 that no install has moved is a problem with what to do. Read-only."""
    root, ctx, st = scratch()
    try:
        ok(L.writer_number("HOUSE_SIZE", 0) == 768 * 1024 and L.writer_number("ARCHIVE_FILE_MAX", 0) == 512 * 1024, "writer.js HOUSE_SIZE and ARCHIVE_FILE_MAX read")
        ok(L.writer_number("NO_SUCH_THING", 5) == 5, "an unknown name: the default")
        ok(L.writer_number("HOUSE_GROWTH", 0) == 64 * 1024, "writer.js HOUSE_GROWTH read")
        # retention_days as the mod reads it (config.js retentionDays): whole days, 1 to 30, half up.
        for v, want in ((0, 1), (0.4, 1), (0.5, 1), (2.5, 3), ("7", 7), (45, 30), (-3, 1), (True, 3), ("x", 3), (None, 3), ("", 3), ([], 3)):
            ok(L.retention_days_of(v) == want, f"retention_days_of({v!r}) == {want} ({L.retention_days_of(v)})")
        lines, _ = L.retention_report(ctx, st, {"retention_days": 0})
        ok(any("closed items stay 0 (read as 1) days" in x for x in lines), f"a hand-written 0 is shown as the mod reads it: {lines}")
        lines, probs = L.retention_report(ctx, st, {})
        txt = "\n".join(lines)
        ok(probs == [] and "closed items stay 3 (the default) days" in txt and "12 (the default)" in txt, f"defaults when config.json says nothing: {lines}")
        ok("store.json      missing" in txt and "housekeeping    not yet" in txt and "archive         empty" in txt, f"no store yet: {lines}")
        lines, probs = L.retention_report(ctx, st, {"retention_days": 14, "retention": {"turns": 20}})
        ok(len(probs) == 1 and "retention_days is 14, the old default" in probs[0] and "./install.sh" in probs[0] and "Settings" in probs[0], f"14, not moved: a problem with what to do: {probs}")
        ok(any("turn records kept per session 20" in x for x in lines), "the configured retention.turns")
        st.d.setdefault("migrations", {})["retention_days"] = "2026-11-19"
        lines, probs = L.retention_report(ctx, st, {"retention_days": 14})
        ok(probs == [] and any("14 chosen since the install moved the old default" in x for x in lines), f"14 after the move: the person's choice: {lines} {probs}")
        # A store past the cap, the first run not done yet.
        now = time.time()
        sp = os.path.join(ctx.data, "store.json")
        write(sp, json.dumps({"v": 1, "items": {}, "sessions": {}, "pad": "x" * (1100 * 1024)}))
        lines, probs = L.retention_report(ctx, st, {"retention_days": 3})
        txt = "\n".join(lines)
        ok(probs == [] and "PAST Herdr's 1 MiB text-file cap" in txt and "over housekeeping's 786,432" in txt, f"past the cap, said: {lines}")
        ok("last ran never; the first run after the upgrade has not finished yet" in txt, "the first run not done")
        ok("still past 1 MiB after housekeeping" not in txt, "...no after-housekeeping warning before it ran")
        # After the first run: the archive, the copy, the counts, a store under the cap.
        sid = "5e550000-0000-4000-8000-000000000001"
        write(sp, json.dumps({"v": 1, "items": {}, "sessions": {sid: {"sessionId": sid, "archived": 5}, "s2": {"archived": 2}},
                              "houseAt": (now - 7200) * 1000, "retention": {"v": 1, "at": (now - 3 * 3600) * 1000}}))
        ad = os.path.join(ctx.data, "archive", sid)
        write(os.path.join(ad, "items-1794700000000-q7w2e9.jsonl"), "a" * 1000 + "\n")
        write(os.path.join(ad, "turns-1794700000000-m3k8z1.jsonl"), "b" * 2000 + "\n")
        write(os.path.join(ad, "notes.txt"), "not an archive file")
        write(os.path.join(ctx.data, "archive", "2026-10.jsonl"), "c" * 999 + "\n")
        write(os.path.join(ctx.data, "store.pre-retention-1794700000000.json"), "{" + " " * 1800 + "}")
        lines, probs = L.retention_report(ctx, st, {"retention_days": 3, "retention": {"turns": 12}})
        txt = "\n".join(lines)
        ok(probs == [], f"healthy: {probs}")
        ok("under Herdr's 1 MiB text-file cap; under housekeeping's 786,432" in txt, f"the store's size: {lines}")
        ok("last ran 2 h ago; the first run after the upgrade finished 3 h ago" in txt, f"the last run and the first: {lines}")
        ok("1 session, 1 items file and 1 turns file, 1 legacy month file(s), 4 KB; 7 items archived (session.archived)" in txt, f"the archive: {lines}")
        ok("store.pre-retention-1794700000000.json (2 KB): the store before the first run, kept, never read by ledgr" in txt, f"the one-time copy: {lines}")
        write(sp, json.dumps({"v": 1, "retention": {"v": 1, "at": now * 1000}, "pad": "x" * (1100 * 1024)}))
        lines, _ = L.retention_report(ctx, st, {})
        ok(any("still past 1 MiB after housekeeping" in x for x in lines), f"past the cap after the first run: said: {lines}")
    finally:
        shutil.rmtree(root)


def test_attachments_report():
    """--check's line for ledgr-data/attachments/ (2026-11-23): how many files and their total size; nothing
    when the folder is absent; hidden files and folders left out. Read-only."""
    root, ctx, _ = scratch()
    try:
        ok(L.attachments_report(ctx) == [], "no attachments/ folder: no line")
        ad = os.path.join(ctx.data, "attachments")
        os.makedirs(ad)
        ok(L.attachments_report(ctx) == ["  attachments     0 files, 0 bytes (images attached to answers; ledgr never deletes them)"],
           f"an empty folder: 0 files: {L.attachments_report(ctx)}")
        write(os.path.join(ad, "20261123-150102-a1b2c3.png"), b"\x89PNG" + b"x" * 1996)
        ok(L.attachments_report(ctx) == ["  attachments     1 file, 2 KB (images attached to answers; ledgr never deletes them)"],
           f"one file: singular: {L.attachments_report(ctx)}")
        write(os.path.join(ad, "20261123-150140-d4e5f6.jpeg"), b"y" * 1_500_000)
        write(os.path.join(ad, ".20261123-150141-zzzzzz.png.tmp"), b"z" * 10_000)
        os.makedirs(os.path.join(ad, "sub"))
        lines = L.attachments_report(ctx)
        ok(lines == ["  attachments     2 files, 1.50 MB (images attached to answers; ledgr never deletes them)"],
           f"two files counted, a hidden file and a folder left out, MB: {lines}")
        before = sorted(os.listdir(ad))
        L.attachments_report(ctx)
        ok(sorted(os.listdir(ad)) == before, "read-only: the folder unchanged")
    finally:
        shutil.rmtree(root)


def test_instruction_words():
    """The handoff question names the instruction's size from the two wordings themselves (2026-11-23: it said
    ~200 to 260 words while they had grown to 268 and 330, and they are about 535 and 597 now)."""
    counts = [len(read(os.path.join(L.REPO, "mods", "ledgr", "bin", "lib", f"asks-instruction-{m}.txt")).decode("utf-8").split())
              for m in ("both", "ledgr")]
    want = f"a ~{min(counts)} to {max(counts)}-word instruction"
    ok(L.instruction_words() == want, f"instruction_words: {L.instruction_words()!r} == {want!r}")
    saved = L.REPO
    try:
        L.REPO = tempfile.mkdtemp(prefix="ledgr-setup-test-")
        ok(L.instruction_words() == "an instruction of a few hundred words", "a wording that cannot be read: no number")
        lib = os.path.join(L.REPO, "mods", "ledgr", "bin", "lib")
        write(os.path.join(lib, "asks-instruction-both.txt"), "one two three\n")
        write(os.path.join(lib, "asks-instruction-ledgr.txt"), b"caf\xe9 not UTF-8\n")
        ok(L.instruction_words() == "an instruction of a few hundred words", "a wording that is not UTF-8: no number, no exception")
        write(os.path.join(lib, "asks-instruction-ledgr.txt"), "one two three\n")
        ok(L.instruction_words() == "a ~3-word instruction", f"two wordings of one size: one number ({L.instruction_words()!r})")
        shutil.rmtree(L.REPO)
    finally:
        L.REPO = saved


COLD_SID = ["c01d0001-0000-4000-8000-000000000001", "c01d0002-0000-4000-8000-000000000002",
            "c01d0003-0000-4000-8000-000000000003", "c01d0004-0000-4000-8000-000000000004"]


def cold_home(ctx, now, sessions, files=(), held=(), items=None, forgotten=None):
    """A scratch ledgr-data with store.json (`sessions`, `items`, `forgotten`), cold files and held events."""
    d = {"v": 1, "items": items or {}, "sessions": sessions, "turns": {}, "forgotten": forgotten or {}}
    write(os.path.join(ctx.data, "store.json"), json.dumps(d))
    for name, size in files:
        write(os.path.join(ctx.data, "cold", name), "x" * size)
    for sid, name, age in held:
        p = os.path.join(ctx.data, "cold", "held", L.safe_name(sid), name)
        write(p, "{}")
        os.utime(p, (now - age, now - age))
    return d


def test_cold_report():
    """--check's cold sessions (retention Phase 2): the line (sessions, files, bytes, the loose ones, the days as the
    mod reads them), held events, mixed sessions; the problems: a faulted session with its held events and what to do,
    a stub naming a missing file, files of sessions store.json does not know, held events nobody replays. Read-only."""
    root, ctx, _ = scratch()
    try:
        for v, want in ((None, 7), (0, 0), ("0", 0), (0.3, 1), (2.5, 3), ("14", 14), (365, 365), (366, 7), (-1, 7), (True, 7),
                        ("x", 7), ("", 7), ([], 7)):
            got = L.cold_days_of({"retention": {"coldDays": v}} if v is not None else {})
            ok(got == want, f"cold_days_of({v!r}) == {want} ({got})")
        ok(L.cold_days_of({"retention": None}) == 7 and L.cold_days_of(None) == 7, "cold_days_of: no retention object, the default")
        ok(L.safe_name("herdr:t4/x") == "herdr_t4_x", "safe_name: config.js safeName")
        lines, probs = L.cold_report(ctx, {})
        ok(probs == [] and lines == ["  cold            none; retention.coldDays 7 (the default) (a session nobody touches for 7 days moves to ledgr-data/cold/)"],
           f"no store, no cold files: none, the default days: {lines} {probs}")
        lines, _ = L.cold_report(ctx, {"retention": {"coldDays": 0}})
        ok(any("retention.coldDays 0 (never: the writer brings every cold session back)" in x for x in lines), f"days 0: {lines}")
        lines, _ = L.cold_report(ctx, {"retention": {"coldDays": "400"}})
        ok(any('retention.coldDays "400" (read as 7)' in x for x in lines), f"a value the mod reads otherwise: {lines}")
        now = time.time()
        s1, s2, s3, s4 = COLD_SID
        f1 = f"{s1}.1794000000000-aaaaaa.json"
        f1old = f"{s1}.1793000000000-bbbbbb.json"
        f2 = f"{s2}.1794000000000-cccccc.json"
        f3 = f"{s3}.1794000000000-dddddd.json"
        gone = "c01d00ff-0000-4000-8000-0000000000ff"
        forgot = "c01d00fe-0000-4000-8000-0000000000fe"
        fault = {"at": (now - 1200) * 1000, "error": f"cold/{f2} is missing", "tries": 3, "held": 2}   # the writer's words
        s5 = "c01d0005-0000-4000-8000-000000000005"
        f5 = f"{s5}.1794000000000-gggggg.json"
        n1 = {"q": 1, "qNew": 0, "blocking": 2, "needed": 3, "optional": 4, "promoted": 0, "answered": 1, "closed": 5, "items": 16, "turns": 12}
        sessions = {s1: {"sessionId": s1, "sessionName": "old work", "cold": {"file": f1, "at": 1794000000000, "n": n1}},
                    s2: {"sessionId": s2, "repo": "ledgr", "cold": {"file": f2, "at": 1794000000000, "n": dict(n1, items=4, blocking=1, q=0), "fault": fault}},
                    s3: {"sessionId": s3, "cold": {"file": f3, "at": 1794000000000, "n": {}}},
                    s4: {"sessionId": s4, "sessionName": "warm one", "touchedAt": now * 1000},
                    s5: {"sessionId": s5, "sessionName": "reset one", "touchedAt": (now - 3 * 3600) * 1000,
                         "coldLost": {"file": f5, "at": (now - 3 * 3600) * 1000, "frozenAt": 1794000000000, "n": {}, "error": f"cold/{f5} does not parse"}}}
        items = {"rq_m1": {"id": "rq_m1", "anchor": {"sessionId": s1}}, "rq_w1": {"id": "rq_w1", "anchor": {"sessionId": s4}}}
        cold_home(ctx, now, sessions, files=[(f1, 1000), (f1old, 500), (f"{gone}.1794000000000-eeeeee.json", 300),
                                            (f"{forgot}.1794000000000-ffffff.json", 200), (f5, 100), ("notes.txt", 50)],
                  held=[(s2, "1794100000000-asks-1-aaaaaa.json", 60), (s2, "1794100000001-act-1-bbbbbb.json", 30),
                        (s4, "1794100000002-prompt-1-cccccc.json", 2 * 3600)],
                  items=items, forgotten={forgot: (now - 100) * 1000})
        # Integration (2026-11-19): an unnamed file goes only when it is provably redundant. f1old: an older copy of
        # s1 whose one item store.json holds (redundant); f4: a file of the warm s4 holding two items store.json lacks
        # (recoverable, a problem); f4bad: one that cannot be read (kept, a problem); f2new: another file of the
        # faulted s2 (said with its problem); a forgotten session's (the writer deletes it a day after the Forget).
        rec = lambda sid, ids, turns=None: json.dumps({"ledgr": "ledgr-cold", "v": 1, "sessionId": sid, "at": 1793000000000, "session": {},
                                                       "items": [{"id": i, "anchor": {"sessionId": sid}} for i in ids], "turns": turns or {}, "n": {}})
        write(os.path.join(ctx.data, "cold", f1old), rec(s1, ["rq_m1"]))
        f4 = f"{s4}.1793000000000-hhhhhh.json"
        f4bad = f"{s4}.1793500000000-iiiiii.json"
        f2new = f"{s2}.1794500000000-jjjjjj.json"
        write(os.path.join(ctx.data, "cold", f4), rec(s4, ["rq_w1", "rq_lost1", "rq_lost2"], {"1": {}}))
        write(os.path.join(ctx.data, "cold", f4bad), "{not json")
        write(os.path.join(ctx.data, "cold", f2new), rec(s2, ["rq_x"]))
        lines, probs = L.cold_report(ctx, {"retention": {"coldDays": 7}})
        txt = "\n".join(lines)
        ok("  cold            3 sessions cold in ledgr-data/cold/ (8 files, 2 KB; 2 thawed, forgotten or redundant copies the writer deletes in time); "
           "retention.coldDays 7" in txt, f"the cold line (a reset session's file is named; an unknown session's is a problem): {lines}")
        prc = next((p for p in probs if f4 in p), "")
        ok(f"cold/{f4} (session {s4[:8]} (warm one)) holds 2 items and 1 turn record store.json lacks" in prc and "keeps it for good" in prc
           and "Retention.md 10.8" in prc, f"a recoverable file: the session, the file, what store.json lacks: {prc}")
        pbad = next((p for p in probs if f4bad in p), "")
        ok("cannot be read" in pbad and "keeps it for good" in pbad, f"an unnamed file that cannot be read: kept, said: {pbad}")
        probs = [p for p in probs if p not in (prc, pbad)]
        ok("                  they hold 20 items: 3 open blocking asks, 1 open question (the panel's OLDER SESSIONS)" in txt,
           f"the stubs' counts (cold.n): {lines}")
        ok(f"  used without    1 session used without its older items (its cold file could not be read): {s5[:8]} (reset one) (cold/{f5}, 3 h ago). "
           "Each file stays in ledgr-data/cold/" in txt, f"a session used without its older items (coldLost): {lines}")
        ok("held events     3 kept in ledgr-data/cold/held/ for 2 sessions" in txt, f"the held line: {lines}")
        ok("1 cold session also holds items or turn records in store.json (an older build wrote them): the writer merges them" in txt,
           f"a mixed session: {lines}")
        ok(len(probs) == 4, f"four problems: {probs}")
        pf = next((p for p in probs if s2[:8] in p), "")
        ok(f"session {s2[:8]} (ledgr) is cold and the writer cannot read its file (cold/{f2} is missing; tried 3 time(s), last 20 min ago); "
           f"2 new events kept in ledgr-data/cold/held/{s2}/" in pf and "Try again" in pf and "Use without its older items" in pf and "Forget" in pf,
           f"a faulted session, its held events (the files on disk) and what to do: {pf}")
        ok(f"Another file of this session is on disk: cold/{f2new}: it may hold what is missing, and it stays whatever you choose" in pf,
           f"...and its other file on disk: {pf}")
        pm = next((p for p in probs if s3[:8] in p), "")
        ok(f"session {s3[:8]} names cold/{f3}, which is missing: its earlier items cannot come back from it." in pm and "Try again" in pm,
           f"a stub that names a missing file: {pm}")
        pu = next((p for p in probs if "does not know" in p), "")
        ok(pu.startswith(f"1 file in ledgr-data/cold/ names sessions store.json does not know ({gone}.1794000000000-eeeeee.json): kept, the writer never deletes them")
           and forgot not in pu, f"a file of an unknown session (a forgotten one's is known): {pu}")
        ph = next((p for p in probs if "not faulted" in p), "")
        ok(ph.startswith(f"1 held event in ledgr-data/cold/held/{s4}/ waits for a session that is not faulted, the oldest for 2 h 0 min")
           and "relaunch Herdr" in ph, f"held events nobody replays: {ph}")
        ok(s1[:8] not in " ".join(probs), "a healthy cold session is no problem")
        lines, probs = L.cold_report(ctx, {}, running=False)
        ok(len(probs) == 5 and not any("not faulted" in p for p in probs), f"Herdr not running: held events that wait are not a problem: {probs}")
        # cold_lacks agrees with store.js coldLacks (second review): the version proves, an id or a turn number does not.
        it_ = lambda i, **o: dict({"id": i, "anchor": {"sessionId": s1}, "status": "open", "updatedAt": 100}, **o)
        dd = {"items": {"rq_same": it_("rq_same"), "rq_newer": it_("rq_newer", updatedAt=200), "rq_older": it_("rq_older", updatedAt=50),
                        "rq_other": dict(it_("rq_other"), anchor={"sessionId": "x"})}, "turns": {s1: {"7": {"stopAt": 1}, "11": {"stopAt": 3}}}}
        rec_ = {"items": [it_("rq_same"), it_("rq_newer", draft="x"), it_("rq_older", status="answered"), it_("rq_other"), it_("rq_lost"), 7],
                "turns": {"3": {"stopAt": 0}, "7": {"stopAt": 1}, "11": {"stopAt": 3, "textHead": "h"}}}
        ok(L.cold_lacks(dd, s1, rec_) == (5, 2), f"cold_lacks: only the identical held; later, older, another session's, absent, not an item lack: {L.cold_lacks(dd, s1, rec_)}")
        ok(L.cold_lacks(dd, s1, rec_, {"rq_lost": [it_("rq_lost")], "rq_older": [it_("rq_older", updatedAt=160)]}, {"3": [{"stopAt": 0}]}, {"11": "h"}) == (4, 0),
           "cold_lacks: an identical copy, cut records and moved heads prove; a later copy does not")
        ok(L.cold_lacks(dd, s4, {"items": [], "turns": {"1": {}}}) == (0, 1), "cold_lacks: no record kept anywhere: every turn record lacks")
        write(os.path.join(ctx.data, "store.json"), "{half")
        lines, probs = L.cold_report(ctx, {})
        ok(probs == [] and lines == ["  cold            store.json could not be read; retention.coldDays 7 (the default)"], f"a store that cannot be read: {lines}")
    finally:
        shutil.rmtree(root)


class ThawWriter:
    """A stand-in writer for --thaw-all: once config.json says retention.coldDays 0, it takes `cold` off one
    session per step (faulted sessions only when `faulted` is true), writing store.json whole each time."""

    def __init__(self, ctx, step=0.1, works=True, faulted=False):
        import threading
        self.ctx, self.step, self.works, self.faulted, self.stop = ctx, step, works, faulted, False
        self.t = threading.Thread(target=self.run, daemon=True)
        self.t.start()

    def run(self):
        sp, cp = os.path.join(self.ctx.data, "store.json"), os.path.join(self.ctx.data, "config.json")
        while not self.stop:
            time.sleep(self.step)
            try:
                cfg = json.loads(read(cp))
            except (OSError, ValueError):
                continue
            if not self.works or (cfg.get("retention") or {}).get("coldDays") != 0:
                continue
            d = json.loads(read(sp))
            for s in d["sessions"].values():
                if "cold" in s and (self.faulted or "fault" not in s["cold"]):
                    del s["cold"]
                    s["thawedAt"] = int(time.time() * 1000)
                    L.write_atomic(sp, json.dumps(d))
                    break

    def end(self):
        self.stop = True
        self.t.join(2)


def test_thaw_all():
    """./install.sh --thaw-all (retention Phase 2, the rollback's first step): config.json's retention.coldDays to 0
    (a backup first, the rest of the file kept, asked unless --yes), then store.json polled until no session is cold;
    exit 0, or 1 with what to do: no writer, or sessions whose file the writer cannot read. Scratch homes only."""
    saved = (L.THAW_WAIT_S, L.THAW_POLL_S, L.THAW_SAY_S, L.herdr_running, L.THAW_CONFIRM_S)
    L.THAW_POLL_S, L.THAW_SAY_S, L.THAW_CONFIRM_S = 0.05, 0.5, 0.1
    L.herdr_running = lambda ctx: False

    def run(ctx, argv=None):
        out = []
        say = L.say
        L.say = lambda m="": out.append(m)
        t0 = time.time()
        try:
            rc = L.main(argv) if argv else L.cmd_thaw_all(ctx, argparse.Namespace())
        finally:
            L.say = say
        return rc, "\n".join(out), time.time() - t0

    s1, s2, s3, _ = COLD_SID
    cfg0 = {"v": 1, "extract": {"threshold": "blocking"}, "retention_days": 3, "retention": {"turns": 12}}
    try:
        # A writer that brings both back.
        root, ctx, _ = scratch()
        try:
            L.THAW_WAIT_S = 10
            cp = os.path.join(ctx.data, "config.json")
            write(cp, json.dumps(cfg0, indent=2) + "\n")
            store = cold_home(ctx, time.time(), {s1: {"sessionId": s1, "cold": {"file": "a", "at": 1, "n": {}}},
                                                 s2: {"sessionId": s2, "cold": {"file": "b", "at": 1, "n": {}}}, s3: {"sessionId": s3}})
            w = ThawWriter(ctx)
            rc, out, dt = run(ctx)
            w.end()
            cfg = json.loads(read(cp))
            ok(rc == 0 and "no cold sessions: every session's items are back in store.json; retention.coldDays stays 0." in out
               and "To roll back now: check out the older build and run its ./install.sh." in out, f"a writer that thaws: exit 0, the words: {rc} {out}")
            ok(cfg == dict(cfg0, retention={"turns": 12, "coldDays": 0}) and read(cp).endswith(b"}\n"),
               f"config.json: retention.coldDays 0, everything else as it was, a final newline: {cfg}")
            bak = os.path.join(ctx.state_dir, f"backup-{ctx.stamp}", "herdr", "ledgr-data", "config.json")
            ok(os.path.exists(bak) and json.loads(read(bak)) == cfg0 and "retention.coldDays (the default, 7) -> 0; the file before: " in out,
               f"the backup first, named: {out}")
            ok("store.json      2 sessions cold" in out and "Herdr is not running: no writer moves anything until it runs" in out
               and "waiting         up to 10 s" in out and re.search(r"\n  cold {12}[12] sessions? \(0 s\)\n", out), f"what it prints while waiting: {out}")
            # Run again: already 0, nothing to back up, nothing cold.
            ctx.backup_dir = None
            rc, out, _ = run(ctx)
            ok(rc == 0 and "retention.coldDays is 0 already" in out and ctx.backup_dir is None and "-> 0" not in out, f"again: {rc} {out}")
            # Through main() (./install.sh --thaw-all --yes passes `install --thaw-all --yes`).
            write(cp, json.dumps(cfg0) + "\n")
            write(os.path.join(ctx.data, "store.json"), json.dumps(store))
            w = ThawWriter(ctx)
            rc, out, _ = run(ctx, ["install", "--thaw-all", "--yes", "--herdr-home", ctx.home, "--state-dir", ctx.state_dir,
                                   "--claude-settings", ctx.settings])
            w.end()
            ok(rc == 0 and json.loads(read(cp))["retention"]["coldDays"] == 0 and "no cold sessions" in out, f"through main: {rc} {out}")
        finally:
            shutil.rmtree(root)
        # Integration (2026-11-19, the review's finding 5): a freeze run whose own read of config.json came before the
        # write of 0 commits and saves after it. Nothing is cold at first; "no cold sessions" waits for the writer's
        # claim to be renewed after the write and out of housekeeping, and is seen twice.
        root, ctx, _ = scratch()
        try:
            L.THAW_WAIT_S = 10
            L.herdr_running = lambda ctx: True
            write(os.path.join(ctx.data, "config.json"), json.dumps(cfg0) + "\n")
            cold_home(ctx, time.time(), {s1: {"sessionId": s1}})
            claim = lambda at, step=None: write(os.path.join(ctx.home, "shared.json"), json.dumps(
                {"ledgr.writer": dict({"id": "w1", "by": "host", "at": int(at * 1000)}, **({"pass": {"at": 0, "step": step, "since": 0}} if step else {}))}))
            claim(time.time() - 5, "housekeeping: freeze c01d0001")
            import threading
            seen = {}

            def late_commit():
                time.sleep(0.4)                         # the commit's save lands after the write of 0
                d = json.loads(read(os.path.join(ctx.data, "store.json")))
                d["sessions"][s1]["cold"] = {"file": "f", "at": 1, "n": {}}
                L.write_atomic(os.path.join(ctx.data, "store.json"), json.dumps(d))
                seen["cold"] = time.time()
                time.sleep(0.4)                         # the writer reads the 0 and brings it back, then its claim renews
                del d["sessions"][s1]["cold"]
                L.write_atomic(os.path.join(ctx.data, "store.json"), json.dumps(d))
                claim(time.time())
                seen["back"] = time.time()
            th = threading.Thread(target=late_commit, daemon=True)
            th.start()
            rc, out, dt = run(ctx)
            t_end = time.time()
            th.join(3)
            ok(rc == 0 and "none cold yet; waiting for the writer to show it has taken the new value" in out and "cold            1 session" in out
               and "no cold sessions: every session's items are back" in out and t_end >= seen.get("back", 1e18),
               f"a freeze committing after the write: seen, waited for, then no cold sessions: {rc} {out}")
            # A writer alive whose claim never renews after the write: no "no cold sessions"; exit 1, say why.
            L.THAW_WAIT_S = 0.6
            write(os.path.join(ctx.data, "config.json"), json.dumps(cfg0) + "\n")
            claim(time.time() - 5)
            rc, out, dt = run(ctx)
            ok(rc == 1 and "the writer has not shown it took retention.coldDays 0" in out, f"no evidence from a live writer: exit 1: {rc} {out}")
            # A claim not renewed for CLAIM_LIVE_S: no writer alive, nothing can freeze.
            claim(time.time() - L.CLAIM_LIVE_S - 10)
            rc, out, _ = run(ctx)
            ok(rc == 0 and "no cold sessions" in out, f"a writer long gone: nothing can freeze: {rc} {out}")
            ok(L.writer_settled(None, 0) and not L.writer_settled({"id": "w", "at": (time.time() + 1) * 1000, "pass": {"step": "housekeeping: save"}}, time.time())
               and L.writer_settled({"id": "w", "at": (time.time() + 1) * 1000, "pass": {"step": "apply"}}, time.time()), "writer_settled")
        finally:
            L.herdr_running = lambda ctx: False
            shutil.rmtree(root)
        # No writer: exit 1 after the wait, with what to do.
        root, ctx, _ = scratch()
        try:
            L.THAW_WAIT_S = 1.0
            write(os.path.join(ctx.data, "config.json"), json.dumps(cfg0) + "\n")
            cold_home(ctx, time.time(), {s1: {"sessionId": s1, "cold": {"file": "a", "at": 1, "n": {}}}})
            w = ThawWriter(ctx, works=False)
            rc, out, dt = run(ctx)
            w.end()
            ok(rc == 1 and 1.0 <= dt < 4 and "X 1 session still cold after 1 s: show the ledgr panel or relaunch Herdr so a writer runs, then run "
               "./install.sh --thaw-all again (retention.coldDays is 0 now; nothing else changed)" in out, f"a writer that never thaws: exit 1: {rc} {dt} {out}")
            # Sessions the writer cannot read: they never thaw by themselves; it stops waiting and says what to do.
            L.THAW_WAIT_S = 10
            fault = {"at": time.time() * 1000, "error": "not valid JSON", "tries": 1, "held": 1}
            cold_home(ctx, time.time(), {s1: {"sessionId": s1, "cold": {"file": "a", "at": 1, "n": {}}},
                                         s2: {"sessionId": s2, "sessionName": "lost", "cold": {"file": f"{s2}.1794000000000-cccccc.json", "at": 1, "n": {}, "fault": fault}}},
                      held=[(s2, "1794100000000-asks-1-aaaaaa.json", 5)])
            w = ThawWriter(ctx)
            rc, out, dt = run(ctx)
            w.end()
            ok(rc == 1 and dt < 5 and f"X session {s2[:8]} (lost) cannot come back: the writer cannot read its file (cold/{s2}.1794000000000-cccccc.json: not valid JSON); 1 event held for it" in out
               and "Try again (after putting the file back), Use without its older items, or Forget" in out and "still cold after" not in out
               and "1 the writer cannot read" in out, f"a faulted session: exit 1 at once, what to do: {rc} {dt} {out}")
            # No store.json: nothing to wait for; the value is written all the same.
            os.unlink(os.path.join(ctx.data, "store.json"))
            write(os.path.join(ctx.data, "config.json"), json.dumps(cfg0) + "\n")
            rc, out, _ = run(ctx)
            ok(rc == 0 and "nothing to wait for" in out and json.loads(read(os.path.join(ctx.data, "config.json")))["retention"]["coldDays"] == 0,
               f"no store: exit 0, the value written: {out}")
            # Asked unless --yes: not a terminal, nothing written; config.json that is not JSON: said, nothing written.
            write(os.path.join(ctx.data, "config.json"), json.dumps(cfg0) + "\n")
            ctx.yes = False
            stdin = sys.stdin
            sys.stdin = type("NoTty", (), {"isatty": lambda self: False})()
            try:
                rc, out, _ = run(ctx)
            finally:
                sys.stdin = stdin
            ok(rc == 2 and "run ./install.sh --thaw-all --yes" in out and json.loads(read(os.path.join(ctx.data, "config.json"))) == cfg0,
               f"not a terminal without --yes: nothing written: {rc} {out}")
            ctx.yes = True
            write(os.path.join(ctx.data, "config.json"), "{nope")
            rc, out, _ = run(ctx)
            ok(rc == 1 and "config.json is not valid JSON" in out and read(os.path.join(ctx.data, "config.json")) == b"{nope", f"invalid config.json: {out}")
            # No config.json at all: made from the hooks' defaults (the installed copy's), coldDays 0.
            os.unlink(os.path.join(ctx.data, "config.json"))
            rc, out, _ = run(ctx)
            made = json.loads(read(os.path.join(ctx.data, "config.json")))
            ok(rc == 0 and made.get("retention", {}).get("coldDays") == 0, f"no config.json: written with coldDays 0: {made}")
        finally:
            shutil.rmtree(root)
    finally:
        L.THAW_WAIT_S, L.THAW_POLL_S, L.THAW_SAY_S, L.herdr_running, L.THAW_CONFIRM_S = saved


if __name__ == "__main__":
    for t in (test_dump, test_settings_write, test_mend_newline, test_restore_original, test_retire, test_settings_list, test_handoff,
              test_keep_config_edits, test_mcp, test_recipe, test_writer_report, test_retention_migration, test_retention_report,
              test_cold_report, test_thaw_all, test_attachments_report, test_instruction_words):
        t()
    print(f"setup: {PASS} passed, {FAIL} failed" + ("" if FAIL else "  OK"))
    sys.exit(1 if FAIL else 0)
