// ledgr opener (2026-11-10): the only file of ledgr's reading copies that starts a process (writer.js keeps
// its own: the extractor, the branch launcher, `which claude`). Each call comes from the detail dialog and
// only after the person acted (detail.js openLink, its Reveal in Finder, the Branch confirmation's worktree
// check, and since 2026-11-23 their ⌘V of an image into the answer box or their click on Paste image):
//   openPath(path, setting, {line, col}): a path the person clicked, with links.editor (links.js openerArgv:
//     open, zed, code or their own command; never a shell, never a terminal, never a line break), once it is
//     known to be there; with the `open` preset, judged by where it really leads (realPathOf: a link named
//     notes.md to an app is revealed, never launched);
//   revealPath(path): open -R (Finder shows it, nothing is launched);
//   gitToplevel(cwd): git -C <cwd> rev-parse --show-toplevel (where a relative path is looked for second,
//     and whether a branch may take a worktree);
//   clipboardImage(outPath) (2026-11-23, the owner's pinned exception to the ban on that runner): the
//     clipboard's image written as one new PNG by macOS's script runner (its absolute path, in the one call
//     below) running the fixed CLIP_SCRIPT, which reads the pasteboard and creates that one file and does
//     nothing else; outPath only an attachment's name directly in ledgr-data/attachments/.
//     bin/tests/test_no_keystrokes.py holds the script by its text and sha256 and the call by its text (rules
//     1, 13 and 16): any change to either fails until the test is changed with it.
// Each has a 5 s limit, and so has realpath(1) (realPathOf, which only reads). Nothing here types into a
// terminal or runs one: bin/tests/test_no_keystrokes.py rule 13 holds every exec( of the mod's reading
// copies to this file and to these four argv shapes. Not an engine file.
import { exec, appHome } from "herdr";
import * as fs from "fs/promises";
import { openerArgv, usesOpenPreset, isAbs } from "./links.js";
import { appRoot } from "./detailing.js";

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

// ── the clipboard's image (2026-11-23) ───────────────────────────────────────────────────────────────
// The largest image the script writes (attach.js ATTACH.maxBytes, the drop's limit): larger, it writes nothing.
export const CLIP_MAX = 8 * 1024 * 1024;
// JavaScript for Automation, run as given (never built from input): argv[0] the PNG to write, argv[1] the size
// limit, argv[2] a private named pasteboard (bin/tests/test_clip.mjs only; clipboardImage never passes it, so it
// reads the general one). The PNG flavour is copied as it is; any other image the pasteboard holds (a TIFF, a
// PDF) is converted to PNG. No image: it throws and writes nothing; over the limit: the same. Its one write
// creates the file and never writes over one (writeToFileOptionsError with NSDataWritingWithoutOverwriting: an
// existing file is left as it was, and the run fails); it makes no folder, drives no application, presses
// nothing, runs no shell, launches nothing, changes no pasteboard and reaches no network.
export const CLIP_SCRIPT = `ObjC.import('AppKit');
function run(argv) {
  var out = argv[0], max = Number(argv[1]), name = argv[2];
  if (!out || !(max > 0)) throw new Error('bad arguments');
  var pb = name ? $.NSPasteboard.pasteboardWithName(name) : $.NSPasteboard.generalPasteboard;
  var data = pb.dataForType($.NSPasteboardTypePNG), how = 'png';
  if (!data || data.isNil()) {
    var img = $.NSImage.alloc.initWithPasteboard(pb);
    if (!img || img.isNil()) throw new Error('no image on the clipboard');
    var rep = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation);
    if (!rep || rep.isNil()) throw new Error('the image could not be read');
    data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
    if (!data || data.isNil()) throw new Error('the image could not be made a PNG');
    how = 'converted';
  }
  var n = Number(data.length);
  if (n > max) throw new Error('too large: ' + n + ' bytes');
  if (!data.writeToFileOptionsError($(out), $.NSDataWritingWithoutOverwriting, null)) throw new Error('the file could not be written (it is there already, or its folder is not)');
  return JSON.stringify({ how: how, bytes: n });
}`;

// The one folder the script may write in: ledgr-data/attachments/ in Herdr's app folder, normalised as attach.js
// attachDir does (detailing.js appRoot); null, so every path is refused, unless that folder is absolute and not "/".
export const clipDir = () => { const r = appRoot(appHome()); return r ? `${r}/ledgr-data/attachments` : null; };
// An attachment's PNG name (attach.js ATTACH_NAME, png only).
const CLIP_NAME = /^\d{8}-\d{6}-[0-9a-z]{6}\.png$/;

// Why outPath is refused, or null: it must be absolute, hold no line break or NUL, be a .png with an
// attachment's name (<yyyymmdd>-<hhmmss>-<rand6>.png), directly in clipDir().
export function clipRefusal(outPath) {
  const p = typeof outPath === "string" ? outPath : "";
  if (!isAbs(p)) return "not an absolute path";
  if (/[\r\n\0]/.test(p)) return "a line break or NUL in the path";
  if (!/\.png$/.test(p)) return "not a .png file";
  const i = p.lastIndexOf("/"), dir = p.slice(0, i), name = p.slice(i + 1), at = clipDir();
  if (!at) return "Herdr's app folder is not known";
  if (dir !== at || !CLIP_NAME.test(name)) return "not an attachment's name directly in ledgr-data/attachments/";
  return null;
}

// What the script's run came to, as the dialog words it: {ok: true, bytes, converted} | {ok: false, none: true}
// (no image on the clipboard) | {ok: false, large: true, bytes} | {ok: false, why}.
export function clipResult(r) {
  const err = String(r?.stderr ?? "");
  if (r?.code === 0) {
    try {
      const j = JSON.parse(String(r.stdout ?? "").trim());
      const n = Number(j?.bytes);
      if (n > 0) return { ok: true, bytes: n, converted: j.how === "converted" };
    } catch { /* below */ }
    return { ok: false, why: "the clipboard reader's answer could not be read" };
  }
  if (/no image on the clipboard/.test(err)) return { ok: false, none: true };
  const big = /too large: (\d+) bytes/.exec(err);
  if (big) return { ok: false, large: true, bytes: Number(big[1]) };
  const m = /Error: (?:Error: )*(.+?) \(-?\d+\)\s*$/m.exec(err);
  return { ok: false, why: (m ? m[1] : err.trim().split("\n").pop() ?? "").slice(0, 160) || `the clipboard reader exited with ${r?.code}` };
}

// The clipboard's image written to outPath (a PNG), or why not. Refused paths start nothing ({ok: false,
// refused: true, why}); never throws.
export async function clipboardImage(outPath) {
  const refused = clipRefusal(outPath);
  if (refused) return { ok: false, refused: true, why: refused };
  try {
    const r = await exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", CLIP_SCRIPT, outPath, String(CLIP_MAX)], { timeout: OPEN_TIMEOUT });
    return clipResult(r);
  } catch (e) {
    const m = String(e?.message ?? e ?? "").trim();
    if (/timed? ?out/i.test(m)) return { ok: false, why: `the clipboard reader did not finish within ${OPEN_TIMEOUT / 1000} s` };
    if (/not found|no such file|ENOENT|cannot start|can't start|could not start|failed to start|spawn/i.test(m)) return { ok: false, why: "macOS's script runner did not start" };
    return { ok: false, why: m.slice(0, 160) || "the clipboard reader failed" };
  }
}
