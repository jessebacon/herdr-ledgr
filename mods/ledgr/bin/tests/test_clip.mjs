// ledgr's clipboard script (2026-11-23), run for real: the SHIPPED opener.js CLIP_SCRIPT (imported from a scratch
// copy of opener.js with a stub `herdr`, so the text tested is the text shipped) under /usr/bin/osascript, as
// clipboardImage runs it, but with its third argument: a private named pasteboard this test makes and seeds
// (a small PNG; the same image as a TIFF only; nothing). Checks: the PNG copied byte for byte; the TIFF converted
// to a valid PNG of the same size in pixels; an empty pasteboard exits 1 with "no image on the clipboard
// (-2700)" and writes nothing; a limit smaller than the image refuses before writing; a path with spaces, quotes
// and $ written (it arrives as argv); a folder that is not there is not made (the script's one write is the
// file); an existing file is never written over (create-only, review 9.3: it stays byte for byte, the run fails,
// and no temporary or partial file is left beside it); opener.js clipResult reads each real answer as the dialog
// will; the script run is the one rule 13 pins (its sha256 printed). It releases its pasteboards, never
// reads or writes the general clipboard (its change count is compared before and after), and writes only under
// its own temporary folder. Without /usr/bin/osascript (not macOS) it says it skipped.
//   node tests/test_clip.mjs
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const RUNNER = "/usr/bin/osascript";
if (process.platform !== "darwin" || !fs.existsSync(RUNNER)) {
  console.log(`OK: clip script, skipped (no ${RUNNER} on this machine: macOS only)`);
  process.exit(0);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(HERE, "../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgr-clip."));
let checks = 0;
const A = new Proxy(assert, { get: (t, k) => (...a) => { checks++; return t[k](...a); } });

for (const f of ["links.js", "opener.js", "detailing.js"]) fs.copyFileSync(path.join(MOD, f), path.join(dir, f));
fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
fs.mkdirSync(path.join(dir, "node_modules/herdr"), { recursive: true });
fs.writeFileSync(path.join(dir, "node_modules/herdr/package.json"), '{"name":"herdr","type":"module","main":"index.js"}');
fs.writeFileSync(path.join(dir, "node_modules/herdr/index.js"), `export const exec = async () => { throw new Error("no exec in this test"); };
export const appHome = () => ${JSON.stringify(path.join(dir, "app"))};
`);

// A 16 × 16 RGBA PNG, made here (zlib and a CRC table: no image library).
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type, "latin1"), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
function makePng(w = 16, h = 16) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  const rows = []; for (let y = 0; y < h; y++) { rows.push(0); for (let x = 0; x < w; x++) rows.push((x * 16) & 255, (y * 16) & 255, 128, 255); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const isPng = (b) => b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.subarray(12, 16).toString("latin1") === "IHDR";
const sizeOf = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];

// The test's own helpers: seed one private named pasteboard (never the general one), release them, and read the
// general pasteboard's change count (a number; its contents are never read).
const SEED = `ObjC.import('AppKit');
function run(argv) {
  var pb = $.NSPasteboard.pasteboardWithName(argv[0]);
  pb.clearContents;
  if (argv[1] === 'none') return 'empty';
  var d = $.NSData.dataWithContentsOfFile(argv[2]);
  if (argv[1] === 'tiff') { d = $.NSImage.alloc.initWithData(d).TIFFRepresentation; pb.setDataForType(d, $.NSPasteboardTypeTIFF); }
  else pb.setDataForType(d, $.NSPasteboardTypePNG);
  return String(Number(d.length));
}`;
const RELEASE = `ObjC.import('AppKit');
function run(argv) { for (var i = 0; i < argv.length; i++) $.NSPasteboard.pasteboardWithName(argv[i]).releaseGlobally; return String(argv.length); }`;
const COUNT = `ObjC.import('AppKit');
function run() { return String(Number($.NSPasteboard.generalPasteboard.changeCount)); }`;
const jxa = (script, args) => spawnSync(RUNNER, ["-l", "JavaScript", "-e", script, ...args], { encoding: "utf8", timeout: 20000 });

const tag = `ledgr-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const PB = { png: `${tag}-png`, tiff: `${tag}-tiff`, none: `${tag}-none` };
let seeded = false;
try {
  const O = await import(`${dir}/opener.js`);
  const run = (out, max, pb) => { const r = jxa(O.CLIP_SCRIPT, [out, String(max), pb]); return { ...r, res: O.clipResult({ code: r.status, stdout: r.stdout, stderr: r.stderr }) }; };
  const before = jxa(COUNT, []).stdout.trim();
  A.match(before, /^\d+$/, "the general pasteboard's change count read (a number)");

  const png = makePng(), src = path.join(dir, "small.png");
  fs.writeFileSync(src, png);
  seeded = true;
  A.equal(jxa(SEED, [PB.png, "png", src]).stdout.trim(), String(png.length), "a private pasteboard holding the PNG");
  A.match(jxa(SEED, [PB.tiff, "tiff", src]).stdout.trim(), /^\d+$/, "one holding the same image as a TIFF only");
  A.equal(jxa(SEED, [PB.none, "none"]).stdout.trim(), "empty", "one holding nothing");

  const out = path.join(dir, "out");
  fs.mkdirSync(out);
  // The PNG flavour, copied byte for byte.
  { const p = path.join(out, "a.png"), r = run(p, O.CLIP_MAX, PB.png);
    A.equal(r.status, 0, `PNG: exit 0 (${r.stderr.trim()})`); A.deepEqual(JSON.parse(r.stdout), { how: "png", bytes: png.length });
    A.deepEqual(fs.readFileSync(p), png, "the PNG copied byte for byte"); A.deepEqual(r.res, { ok: true, bytes: png.length, converted: false }, "clipResult: written"); }
  // A TIFF-only pasteboard, converted to a valid PNG of the same pixels' size.
  { const p = path.join(out, "b.png"), r = run(p, O.CLIP_MAX, PB.tiff);
    A.equal(r.status, 0, `TIFF: exit 0 (${r.stderr.trim()})`); const j = JSON.parse(r.stdout), b = fs.readFileSync(p);
    A.equal(j.how, "converted"); A.equal(j.bytes, b.length); A.ok(isPng(b), "a valid PNG (signature, IHDR)"); A.deepEqual(sizeOf(b), [16, 16], "16 × 16 as the source");
    A.deepEqual(r.res, { ok: true, bytes: b.length, converted: true }, "clipResult: converted"); }
  // Nothing on it: exit 1, "no image on the clipboard (-2700)", nothing written.
  { const p = path.join(out, "c.png"), r = run(p, O.CLIP_MAX, PB.none);
    A.equal(r.status, 1); A.match(r.stderr, /no image on the clipboard \(-2700\)/); A.equal(fs.existsSync(p), false, "nothing written");
    A.deepEqual(r.res, { ok: false, none: true }, "clipResult: no image"); }
  // Over the limit: refused before anything is written.
  { const p = path.join(out, "d.png"), r = run(p, 10, PB.png);
    A.notEqual(r.status, 0); A.match(r.stderr, new RegExp(`too large: ${png.length} bytes`)); A.equal(fs.existsSync(p), false, "nothing written over the limit");
    A.deepEqual(r.res, { ok: false, large: true, bytes: png.length }, "clipResult: too large"); }
  { const r = run(path.join(out, "e.png"), 0, PB.png); A.notEqual(r.status, 0); A.match(r.stderr, /bad arguments/, "no limit: refused"); }
  // A path with spaces, quotes and $ (argv, never script text).
  { const odd = path.join(out, `dir with 'q' "dq" $x`); fs.mkdirSync(odd); const p = path.join(odd, "f.png"), r = run(p, O.CLIP_MAX, PB.png);
    A.equal(r.status, 0, r.stderr.trim()); A.deepEqual(fs.readFileSync(p), png, "an odd path written as given"); }
  // A folder that is not there is not made: the file is the script's one write.
  const WHY = "the file could not be written (it is there already, or its folder is not)";
  { const p = path.join(out, "missing", "g.png"), r = run(p, O.CLIP_MAX, PB.png);
    A.notEqual(r.status, 0); A.match(r.stderr, /the file could not be written/); A.equal(fs.existsSync(path.join(out, "missing")), false, "no folder made");
    A.deepEqual(r.res, { ok: false, why: WHY }, "clipResult: its words"); }
  // Create-only (review 9.3): a file already there is left byte for byte, the run fails, nothing is left beside it.
  { const p = path.join(out, "h.png"), keep = Buffer.from("KEEP: an attachment already here");
    fs.writeFileSync(p, keep); const r = run(p, O.CLIP_MAX, PB.png);
    A.notEqual(r.status, 0, "an existing file: the run fails"); A.deepEqual(fs.readFileSync(p), keep, "...and the file is as it was");
    A.deepEqual(r.res, { ok: false, why: WHY }); }
  { const p = path.join(out, "a.png"), before = fs.readFileSync(p), r = run(p, O.CLIP_MAX, PB.tiff);
    A.notEqual(r.status, 0); A.deepEqual(fs.readFileSync(p), before, "an attachment the clipboard would replace (another image): kept"); }
  // Nothing else written under the scratch folder (no temporary or partial file), and the general clipboard untouched.
  A.deepEqual(fs.readdirSync(out).sort(), ["a.png", "b.png", `dir with 'q' "dq" $x`, "h.png"], "only the files asked for");
  A.deepEqual(fs.readdirSync(path.join(out, `dir with 'q' "dq" $x`)), ["f.png"]);
  A.equal(jxa(COUNT, []).stdout.trim(), before, "the general pasteboard's change count is as it was");
  const sha = createHash("sha256").update(O.CLIP_SCRIPT, "utf8").digest("hex").slice(0, 12);
  console.log(`OK: clip script, ${checks} checks (the shipped CLIP_SCRIPT, sha256 ${sha}…, on private named pasteboards: a PNG copied byte for byte, a TIFF converted, nothing on it, over the limit, an odd path, no folder made, an existing file never written over; clipResult on each answer; the general clipboard untouched), 0 failure(s)`);
} catch (e) {
  console.log(String(e?.stack ?? e).split("\n").slice(0, 8).join("\n"));
  console.log(`FAIL: clip script, after ${checks} checks`);
  process.exitCode = 1;
} finally {
  if (seeded) jxa(RELEASE, [PB.png, PB.tiff, PB.none]);
  fs.rmSync(dir, { recursive: true, force: true });
}
