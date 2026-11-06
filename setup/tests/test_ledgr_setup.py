#!/usr/bin/env python3
"""Offline tests for setup/ledgr_setup.py: the JSON files it writes, and retiring a mod an earlier
install deployed. Everything happens in a scratch folder; nothing under the real home is read or
written. Run from the repo: python3 -I -B setup/tests/test_ledgr_setup.py"""
import argparse
import json
import os
import shutil
import sys
import tempfile

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


if __name__ == "__main__":
    for t in (test_dump, test_settings_write, test_mend_newline, test_restore_original, test_retire, test_settings_list):
        t()
    print(f"setup: {PASS} passed, {FAIL} failed" + ("" if FAIL else "  OK"))
    sys.exit(1 if FAIL else 0)
