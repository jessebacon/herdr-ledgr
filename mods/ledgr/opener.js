// ledgr opener (2026-11-10): the only file of ledgr's reading copies that starts a process (writer.js keeps
// its own: the extractor, the branch launcher, `which claude`). Three calls, each from the detail dialog
// and only after the person clicked (detail.js openLink, its Reveal in Finder, and the Branch
// confirmation's worktree check):
//   openPath(path, setting, {line, col}): a path the person clicked, with links.editor (links.js openerArgv:
//     open, zed, code or their own command; never a shell, never a terminal, never a line break), once it is
//     known to be there; with the `open` preset, judged by where it really leads (realPathOf: a link named
//     notes.md to an app is revealed, never launched);
//   revealPath(path): open -R (Finder shows it, nothing is launched);
//   gitToplevel(cwd): git -C <cwd> rev-parse --show-toplevel (where a relative path is looked for second,
//     and whether a branch may take a worktree).
// Each has a 5 s limit, and so has realpath(1) (realPathOf, which only reads). Nothing here types into a
// terminal or runs one: bin/tests/test_no_keystrokes.py rule 13 holds every exec( of the mod's reading
// copies to this file and to these four argv shapes. Not an engine file.
import { exec } from "herdr";
import * as fs from "fs/promises";
import { openerArgv, usesOpenPreset, isAbs } from "./links.js";

export const OPEN_TIMEOUT = 5000;

// Is something at p, and is it a folder? {exists: true | false | null (could not look), dir: true | false |
// null}. Herdr's fs/promises (exists, stat where it has it), or Node's (stat, access) under the tests.
export async function statAt(p) {
  if (!isAbs(p)) return { exists: false, dir: null };
  if (typeof fs.stat === "function") {
    try {
      const s = await fs.stat(p);
      const d = typeof s?.isDirectory === "function" ? s.isDirectory() : typeof s?.isDirectory === "boolean" ? s.isDirectory : null;
      return { exists: true, dir: d === null ? null : Boolean(d) };
    } catch (e) { if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return { exists: false, dir: null }; }
  }
  try {
    if (typeof fs.exists === "function") return { exists: Boolean(await fs.exists(p)), dir: null };
    if (typeof fs.access === "function") { await fs.access(p); return { exists: true, dir: null }; }
  } catch (e) { return { exists: e?.code === "ENOENT" || e?.code === "ENOTDIR" ? false : null, dir: null }; }
  return { exists: null, dir: null };
}

// Where an absolute path really leads, every symbolic link followed: a path, or null (not known: no answer,
// an error, a line break). Node's fs.realpath where it is (the tests); Herdr's fs/promises has none, so
// realpath(1) (it only reads).
export async function realPathOf(path) {
  if (!isAbs(path) || /[\r\n\0]/.test(path)) return null;
  if (typeof fs.realpath === "function") {
    try { const r = await fs.realpath(path); return isAbs(r) ? r : null; } catch { return null; }
  }
  try {
    const r = await exec("realpath", [path], { timeout: OPEN_TIMEOUT });
    const out = r?.code === 0 ? String(r.stdout ?? "").replace(/\n$/, "") : "";
    return isAbs(out) && !/[\r\n\0]/.test(out) ? out : null;
  } catch { return null; }
}

// Why a process did not do it, in words.
const why = (e, prog) => {
  const m = String(e?.message ?? e ?? "").trim();
  if (/timed? ?out/i.test(m)) return `${prog} did not finish within ${OPEN_TIMEOUT / 1000} s`;
  if (/not found|no such file|ENOENT|cannot start|can't start|could not start|failed to start|spawn/i.test(m)) return `${prog} did not start (is it on your login shell's PATH?)`;
  return m.slice(0, 160) || `${prog} failed`;
};

// The clicked path opened with links.editor: {ok, how, argv} or {ok: false, missing?, how?, why}. A path
// known not to be there is not handed to any program.
export async function openPath(path, setting, { line = null, col = null } = {}) {
  const at = await statAt(path);
  if (at.exists === false) return { ok: false, missing: true, why: "it is not there" };
  const real = usesOpenPreset(setting) ? await realPathOf(path) : undefined;
  const a = openerArgv(setting, { path, line, col, dir: at.dir, real });
  if (a.error) return { ok: false, why: a.error };
  try {
    const r = await exec(a.argv[0], a.argv.slice(1), { timeout: OPEN_TIMEOUT });
    if (r?.code === 0) return { ok: true, how: a.how, argv: a.argv };
    return { ok: false, how: a.how, argv: a.argv, why: String(r?.stderr ?? "").trim().split("\n")[0].slice(0, 160) || `${a.argv[0]} exited with ${r?.code}` };
  } catch (e) { return { ok: false, how: a.how, argv: a.argv, why: why(e, a.argv[0]) }; }
}

// Finder shows the path, selected in its folder: open -R. Nothing is launched.
export async function revealPath(path) {
  if (!isAbs(path) || /[\r\n\0]/.test(path)) return { ok: false, why: "not an absolute path" };
  try {
    const r = await exec("open", ["-R", path], { timeout: OPEN_TIMEOUT });
    return r?.code === 0 ? { ok: true } : { ok: false, why: String(r?.stderr ?? "").trim().split("\n")[0].slice(0, 160) || `open exited with ${r?.code}` };
  } catch (e) { return { ok: false, why: why(e, "open") }; }
}

// The top of the git checkout holding cwd, or null (not a checkout, no git, no answer within 5 s).
export async function gitToplevel(cwd) {
  if (!isAbs(cwd)) return null;
  try {
    const r = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: OPEN_TIMEOUT });
    const top = r?.code === 0 ? String(r.stdout ?? "").trim().split("\n")[0] : "";
    return isAbs(top) ? top : null;
  } catch { return null; }
}
