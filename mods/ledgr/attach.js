// ledgr attachments (2026-11-23): an image in an answer. The image is a file under ledgr-data/attachments/
// and one line of the answer's draft text naming it:
//   attached image (read this file): <absolute path>
// No spool event, no store field, no writer change: the line is ordinary draft text (Reader typeDraft, the cut
// at LIMITS.answer, the answer sheet, where confluence.js answerLines indents it as a continuation line, and
// the landing parser, all unchanged), and the agent reads the file from the path.
// The name is <yyyymmdd>-<hhmmss>-<rand6>.<ext>, lower case, no space or bracket (the hook's [A3] ref scan),
// ext one of png, jpg, jpeg, gif, webp. At most ATTACH.perAnswer (4) to an answer, each at most 8 MiB.
// Here: the name, the type and size checks, the copy of a dropped file (copyIn: fs.readFile, fs.mkdir,
// fs.writeFile of the bytes, read back and compared by length; no process started), the folder made ready for
// the clipboard's image (prepareSlot: opener.js clipboardImage writes that file, not this module), the line,
// finding the attachment lines in a draft, taking one out. Nothing here deletes or writes over a file: a name is
// taken only when nothing is there. bin/tests/test_no_keystrokes.py rule 16: only this file writes or makes
// anything under attachments/, nothing unlinks or removes there, and only detail.js imports it. Not an engine
// file.
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { appHome } from "herdr";
import { within } from "./spool.js";
import { appRoot } from "./detailing.js";

// maxBytes: an image's limit (a drop and the clipboard's); perAnswer: images to one answer; thumbBytes: the
// largest file drawn as a thumbnail; thumbPx: the largest side, in pixels, of an image drawn as one (a tall
// capture can pass a texture limit no try catches); copyMs: one copy's limit; clipMs: the clipboard's run, all
// told; staleMs: an attaching older than this no longer holds the next one back; thumbH, thumbW: the
// thumbnail's box.
export const ATTACH = { maxBytes: 8 * 1024 * 1024, perAnswer: 4, thumbBytes: 2 * 1024 * 1024, thumbPx: 4096, copyMs: 10000, clipMs: 8000,
  staleMs: 60000, thumbH: 72, thumbW: 112 };
export const ATTACH_EXTS = ["png", "jpg", "jpeg", "gif", "webp"];
export const ATTACH_LEAD = "attached image (read this file): ";
export const ATTACH_NAME = /^\d{8}-\d{6}-[0-9a-z]{6}\.(?:png|jpe?g|gif|webp)$/;
// ledgr-data/attachments/ in Herdr's app folder, normalised as opener.js clipDir is (detailing.js appRoot, review
// 9.4: the two always agree); null when the app folder is not absolute or is "/" (then nothing is attached).
export const attachDir = () => { const r = appRoot(appHome()); return r ? `${r}/ledgr-data/attachments` : null; };

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// An attachment line of dir: the lead, then a path in dir with an attachment's name; the match ends at the
// image's extension (review 9.6), so words typed after it on the same line do not unmake it.
const lineRe = (dir) => new RegExp(`^\\s*attached image \\(read this file\\): (${escRe(dir)}/\\d{8}-\\d{6}-[0-9a-z]{6}\\.(?:png|jpe?g|gif|webp))(?![0-9A-Za-z])`);
export const baseName = (p) => String(p ?? "").split("/").filter(Boolean).pop() ?? "";

// The accepted extension of a path, lower case, or null (judged by the name alone).
export function extOf(p) {
  const m = /\.([A-Za-z0-9]+)$/.exec(baseName(p));
  const e = m ? m[1].toLowerCase() : "";
  return ATTACH_EXTS.includes(e) ? e : null;
}

export const rand6 = () => randomUUID().replace(/-/g, "").slice(0, 6).toLowerCase();
const two = (n) => String(n).padStart(2, "0");

// A new file's name: the local date and time, six random characters, the extension.
export function attachName(ext, now = new Date(), r = rand6()) {
  const d = now instanceof Date ? now : new Date(now);
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}-${r}.${String(ext).toLowerCase()}`;
}

// A path ledgr made: directly in the attachments folder, with a name of attachName's shape.
export function isOurs(p, dir = attachDir()) {
  const s = String(p ?? ""), name = baseName(s);
  return Boolean(dir) && s === `${dir}/${name}` && ATTACH_NAME.test(name);
}

export const attachLine = (path) => `${ATTACH_LEAD}${path}`;

// The path an attachment line names, or null.
export function lineAttach(line, dir = attachDir()) {
  if (!dir) return null;
  const m = lineRe(dir).exec(String(line ?? ""));
  return m ? m[1] : null;
}

// The draft's attachment lines, in order: [{path, name, at}] (at: the line's index), ledgr's own files only.
export function attachLines(draft, dir = attachDir()) {
  const out = [];
  String(draft ?? "").split("\n").forEach((l, at) => {
    const p = lineAttach(l, dir);
    if (p) out.push({ path: p, name: baseName(p), at });
  });
  return out;
}

// The draft with the line added at its end, on a line of its own, and a line break after it (review 9.6: what is
// typed next starts a new line instead of running into the path).
export function withAttach(draft, path) {
  const d = String(draft ?? "").replace(/\s+$/, "");
  return `${d ? `${d}\n` : ""}${attachLine(path)}\n`;
}

// The draft with the first line naming path taken out (the rest kept as typed; blank lines it leaves at the
// end go too). The file stays.
export function withoutAttach(draft, path, dir = attachDir()) {
  const lines = String(draft ?? "").split("\n");
  const i = lines.findIndex((l) => lineAttach(l, dir) === path);
  if (i < 0) return String(draft ?? "");
  lines.splice(i, 1);
  const rest = lines.join("\n");
  return i >= lines.length || !lines.slice(i).some((l) => l.trim()) ? rest.replace(/\s+$/, "") : rest;
}

// ── an image that reaches the box as its file's path (2026-11-23, after the live check) ───────────
// A capture tool's clipboard, a file copied in Finder or a file dropped on the text: Herdr's textarea puts the
// file's absolute path into the box as text. Such a path becomes an attachment when it arrived whole in one
// change (pastedPaths); a path typed character by character never does.

// Image types ledgr does not take, named so a path to one is said rather than passed over in silence.
export const OTHER_IMAGE_EXTS = ["heic", "heif", "tif", "tiff", "bmp", "svg", "avif", "ico"];

// What one change inserted: [start, end) of now, now less the longest prefix and then the longest suffix it
// shares with before.
export function insertedSpan(before, now) {
  const a = String(before ?? ""), b = String(now ?? ""), max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { start: p, end: b.length - s };
}

// The absolute path a line of text is, exactly, or null: an absolute path ("/…"), or a file:// URL (file:///… or
// file://localhost/…) percent-decoded to one; no line break, NUL or control character; not a folder by its end.
export function pathOf(text) {
  let t = String(text ?? "").trim();
  if (/^file:\/\//i.test(t)) {
    t = t.replace(/^file:\/\/(?:localhost)?/i, "");
    try { t = decodeURIComponent(t); } catch { return null; }
  }
  if (!t.startsWith("/") || t.startsWith("//") || t.endsWith("/") || /[\u0000-\u001f\u007f]/.test(t)) return null;
  return t;
}

// The images' paths that arrived whole in the change from before to now: [{raw, text, at, src, ext}] in order.
// The rule: what the change inserted (insertedSpan) must be at least two characters (a key typed inserts one, so
// a path typed by hand is never taken, nor one finished by a keystroke); each line of that inserted text, trimmed,
// that is exactly a path or a file:// URL (pathOf) whose extension is an image's in any case, outside the
// attachments folder, is one. text: that path as it stands in the box; raw: the whole line of the box it is in
// (a paste at the end of a line of words joins it); at: that line's index; src: the path; ext: its accepted
// extension, or null for an image type ledgr does not take (said, not taken).
export function pastedPaths(before, now, dir = attachDir()) {
  const b = String(now ?? ""), { start, end } = insertedSpan(before, b);
  if (end - start < 2) return [];
  const out = [];
  let from = start;
  for (const seg of b.slice(start, end).split("\n")) {
    const segAt = from;
    from += seg.length + 1;
    const t = seg.trim();
    if (!t) continue;
    const src = pathOf(t);
    if (!src) continue;
    const m = /\.([A-Za-z0-9]+)$/.exec(baseName(src)), e = m ? m[1].toLowerCase() : "";
    if (!ATTACH_EXTS.includes(e) && !OTHER_IMAGE_EXTS.includes(e)) continue;
    if (dir && (src === dir || src.startsWith(`${dir}/`))) continue;
    const s0 = segAt + seg.indexOf(t), ls = b.lastIndexOf("\n", s0 - 1) + 1, le = b.indexOf("\n", s0);
    out.push({ raw: b.slice(ls, le < 0 ? b.length : le), text: t, at: b.slice(0, ls).split("\n").length - 1, src, ext: ATTACH_EXTS.includes(e) ? e : null });
  }
  return out;
}

// The index of the box line f names in lines: its own index when that line is still f.raw, else the first line that
// is; -1 when none is (the person changed it).
const lineOf = (lines, f) => (lines[f.at] === f.raw ? f.at : lines.indexOf(f.raw));

// The draft with f's path (pastedPaths) replaced by path's attachment line, on a line of its own with a line
// break after it; words before and after it on that line keep their own lines; the rest as it is. null when the
// line is no longer there.
export function withAttachAt(draft, f, path) {
  const lines = String(draft ?? "").split("\n"), i = lineOf(lines, f), k = i < 0 ? -1 : lines[i].indexOf(f.text);
  if (k < 0) return null;
  const pre = lines[i].slice(0, k).replace(/\s+$/, ""), post = lines[i].slice(k + f.text.length).replace(/^\s+/, "");
  const put = [...(pre ? [pre] : []), attachLine(path), ...(post ? [post] : [])];
  lines.splice(i, 1, ...put);
  if (!post && i + put.length === lines.length) lines.push("");
  return lines.join("\n");
}

// The draft with f's path taken out (its line too when nothing else is on it); null when the line is not there.
export function withoutRaw(draft, f) {
  const lines = String(draft ?? "").split("\n"), i = lineOf(lines, f), k = i < 0 ? -1 : lines[i].indexOf(f.text);
  if (k < 0) return null;
  const rest = `${lines[i].slice(0, k).replace(/\s+$/, "")} ${lines[i].slice(k + f.text.length).replace(/^\s+/, "")}`.trim();
  if (rest) lines[i] = rest; else lines.splice(i, 1);
  return lines.join("\n");
}

// The draft cut at max characters (the answer box's cut, LIMITS.answer) without leaving part of an attachment
// line (review 9.6): when the cut falls inside one, that line goes whole. {text, dropped}.
export function cutDraft(text, max, dir = attachDir()) {
  const s = String(text ?? "");
  if (s.length <= max) return { text: s, dropped: false };
  const cut = s.slice(0, max), at = cut.lastIndexOf("\n") + 1, end = s.indexOf("\n", at);
  const full = s.slice(at, end < 0 ? s.length : end);
  if (cut.length - at < full.length && lineAttach(full, dir)) return { text: cut.slice(0, at).replace(/\n$/, ""), dropped: true };
  return { text: cut, dropped: false };
}

// The path as image() takes it: relative to the app's folder (gpui-kit.d.ts image: the application root, normalised
// as attachDir), or null when it is not under it.
export function appRelative(p, root = appRoot(appHome())) {
  const s = String(p ?? ""), r = appRoot(root);
  return r && s.startsWith(`${r}/`) && !s.slice(r.length + 1).split("/").some((seg) => seg === ".." || seg === "") ? s.slice(r.length + 1) : null;
}

// A PNG's or a JPEG's size in pixels from its header ({w, h, kind}), else null (another type, or not read): only
// these two are drawn as thumbnails (review 9.7).
export function imageDims(bytes) {
  const b = bytes, n = b && typeof b.length === "number" ? b.length : 0, u16 = (i) => (b[i] << 8) | b[i + 1];
  if (n >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52) {
    const w = ((b[16] << 24) >>> 0) + (b[17] << 16) + (b[18] << 8) + b[19], h = ((b[20] << 24) >>> 0) + (b[21] << 16) + (b[22] << 8) + b[23];
    return w > 0 && h > 0 ? { w, h, kind: "png" } : null;
  }
  if (n >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < n) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) { i += 1; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const h = u16(i + 5), w = u16(i + 7);
        return w > 0 && h > 0 ? { w, h, kind: "jpeg" } : null;
      }
      if (m === 0xd9 || m === 0xda) return null;
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

// The thumbnail's size for an image of dims in a box w × h (its aspect kept; both sides set, review 9.7), or null
// when it is not to be drawn (no dims, or a side over ATTACH.thumbPx).
export function thumbSize(dims, w = ATTACH.thumbW, h = ATTACH.thumbH) {
  if (!dims || !(dims.w > 0 && dims.h > 0) || dims.w > ATTACH.thumbPx || dims.h > ATTACH.thumbPx) return null;
  const k = Math.min(w / dims.w, h / dims.h);
  return { w: Math.max(1, Math.round(dims.w * k)), h: Math.max(1, Math.round(dims.h * k)) };
}

// "840 KiB", "12.3 MiB".
export function sizeWords(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MiB`;
  return `${Math.max(1, Math.round(v / 1024))} KiB`;
}

// Is something at p: Herdr's fs.exists, Node's fs.access under the tests.
async function existsAt(p) {
  if (typeof fs.exists === "function") return Boolean(await fs.exists(p));
  try { await fs.access(p); return true; } catch { return false; }
}

const reason = (e) => String(e?.message ?? e ?? "").trim().split("\n")[0].slice(0, 160) || "unknown error";
const lengthOf = (b) => (b && typeof b.length === "number" ? b.length : typeof b?.byteLength === "number" ? b.byteLength : -1);

// The folder made and a free name in it: {ok: true, path} | {ok: false, kind: "copy", why}. A name already taken
// is never written over: another is drawn (three tries).
export async function prepareSlot(ext, cx, o = {}) {
  const now = o.now ?? new Date(), rand = typeof o.rand === "function" ? o.rand : rand6;
  if (!attachDir()) return { ok: false, kind: "copy", why: "Herdr's app folder is not known" };
  try {
    await within(cx, ATTACH.copyMs, fs.mkdir(attachDir(), { recursive: true }), "making ledgr-data/attachments");
    for (let i = 0; i < 3; i++) {
      const path = `${attachDir()}/${attachName(ext, now, rand())}`;
      if (!(await within(cx, ATTACH.copyMs, existsAt(path), "looking at ledgr-data/attachments"))) return { ok: true, path };
    }
    return { ok: false, kind: "copy", why: "no free name" };
  } catch (e) { return { ok: false, kind: "copy", why: reason(e) }; }
}

// A dropped file copied in: {ok: true, path, size, dims} or {ok: false, kind, why?, size?}, kind one of "type" (not an
// image by its name), "large", "empty", "read" (it could not be read), "copy" (it could not be written), "back"
// (the copy did not read back whole). Its size is looked at first where fs has stat (Node's: the tests), so a
// large file is not read; else it is read (bounded) and measured. A copy that fails after its write leaves the
// file (nothing here deletes).
export async function copyIn(src, cx, o = {}) {
  const ext = extOf(src);
  if (!ext) return { ok: false, kind: "type" };
  if (typeof fs.stat === "function") {
    try { const s = await fs.stat(src); if (Number(s?.size) > ATTACH.maxBytes) return { ok: false, kind: "large", size: Number(s.size) }; } catch { /* read below says why */ }
  }
  let bytes;
  try { bytes = await within(cx, ATTACH.copyMs, fs.readFile(src), `reading ${baseName(src)}`); } catch (e) { return { ok: false, kind: "read", why: reason(e) }; }
  const n = lengthOf(bytes);
  if (n < 0) return { ok: false, kind: "read", why: "no bytes came back" };
  if (n === 0) return { ok: false, kind: "empty" };
  if (n > ATTACH.maxBytes) return { ok: false, kind: "large", size: n };
  const slot = await prepareSlot(ext, cx, o);
  if (!slot.ok) return slot;
  try { await within(cx, ATTACH.copyMs, fs.writeFile(slot.path, bytes), `writing ${baseName(slot.path)}`); } catch (e) { return { ok: false, kind: "copy", why: reason(e) }; }
  let back;
  try { back = await within(cx, ATTACH.copyMs, fs.readFile(slot.path), `reading ${baseName(slot.path)} back`); } catch (e) { return { ok: false, kind: "back", why: reason(e) }; }
  if (lengthOf(back) !== n) return { ok: false, kind: "back" };
  return { ok: true, path: slot.path, size: n, dims: imageDims(bytes) };
}

// An attachment as the thumbnail rule needs it: {size, dims, gone}, the file read (bounded; at most 8 MiB, and
// only once per dialog: detail.js attachInfoOf).
export async function fileInfo(p, cx) {
  try { const b = await within(cx, ATTACH.copyMs, fs.readFile(p), `reading ${baseName(p)}`); return { size: lengthOf(b), dims: imageDims(b), gone: false }; }
  catch { return { size: null, dims: null, gone: !(await existsAt(p).catch(() => true)) }; }
}
