// ledgr links (2026-11-10, Jesse: "the big modal is working GREAT! any chance it could resolve relative links
// or weblinks?"): the pure half of the detail dialog's clickable links. A file path in an agent's message
// (src/app.js:12, ./x, ~/x, /abs/x, README.md) becomes a markdown link under a private URL (linkify), so the
// dialog's TextView draws it as a link and its on_link_click hands the URL back (parseLink); the click
// finds the file from the session's folder, then its repository's top (resolvePath), and opens it with
// links.editor (openerArgv: the argv, never a shell). The process calls are opener.js's alone; this module
// imports nothing (no herdr, no gpui): it loads in Node (bin/tests/test_links.mjs) as in Herdr. Not an
// engine file.
//
// What counts as a path (findPaths; decided 2026-11-10, false positives kept rare rather than none):
// - anchored: a leading ~/ ./ ../ is always a path; a leading / needs an extension (/x.md) or, with none, two
//   segments or more under a root a Mac has (ROOTS: /etc/hosts, /Users/x/notes, /opt/homebrew/bin; not
//   /api/v1/users, an endpoint; not /btw, /mcp, /tmp: slash commands read the same);
// - with a slash and no anchor: the last segment has an extension (docs/design/Detail.md), or a trailing slash
//   with two segments or more and a letter in each (mods/ledgr/), or three segments or more with a letter in
//   the last (mods/ledgr/bin). Not: and/or, TCP/IP, km/h, 24/7, 2026/11/10, @types/node, github.com/x/y (a host);
// - a bare name (no slash): a known extension (KNOWN_EXT) and a name of two characters or more (README.md,
//   ledgr_mcp.py). Not: 1.5, v0.1.0, e.g., i.e., a.m., example.com, jesse@example.com; and in prose (not in a
//   code span) not a capitalized word with .js (Node.js, Next.js, D3.js: library names);
// - an optional :line, :line:col or #L12 (#L12-L20 opens at 12) after it;
// - preceded by the start, a space or one of ( [ { " ' “ ‘ < > * = , ; |; trailing . , ; : ! ? _ - are not
//   part of it, and as many leading _ as trailing ones (_src/it.js_ is emphasis; __init__.py keeps its own);
//   no spaces inside (a path with spaces is not linked whole; src/a.js->src/b.js is two).
// Skipped: fenced code, an indented code paragraph, existing links ([a](b), [a][b], <…> autolinks, HTML tags)
// and URLs (scheme:// or www.). A code span that is exactly a path is linked with the code span as the label
// (`src/app.js:12`); a code span holding more (a command) is left alone.
// Cost: linear in the text (protectedSpans pairs brackets and backticks in one pass each), and linkify keeps
// its last LINKIFY_CACHE results by text, since the dialog draws the same message on every render.

// The private URL form: an https URL on the reserved .invalid domain, so a TextView draws it as a link and,
// should the dialog's handler ever not take the click, it leads nowhere. Never fetched: on_link_click
// consumes the click (detail.js openLink).
export const LINK_HOST = "ledgr.invalid";
export const LINK_BASE = `https://${LINK_HOST}/path/`;

// links.editor: "open" (the system's default app, the default), "zed", "code", or a command of your own with
// {path}, {line} and {col} (a string split at spaces, quotes kept together, or an argv array).
export const EDITOR_PRESETS = ["open", "zed", "code"];
export const EDITOR_DEFAULT = "open";
export const EDITOR_WORDS = { open: "open (the default app)", zed: "zed", code: "code" };
const EDITOR_HOW = { zed: "Zed", code: "VS Code" };
// A custom command no longer than this, in characters.
export const EDITOR_MAX = 300;

// Extensions a bare file name (no slash) needs to be linked: source, config, documents, images, logs.
export const KNOWN_EXT = new Set(("md markdown mdx txt rst adoc tex json jsonc jsonl ndjson yaml yml toml ini cfg conf env lock xml plist csv tsv sql "
  + "html htm css scss sass less js mjs cjs jsx ts mts cts tsx vue svelte astro py pyi ipynb rb go rs java kt kts swift m mm h hh hpp c cc cpp cxx "
  + "cs fs php pl lua r jl dart scala clj cljs ex exs erl hs ml zig nim sh bash zsh fish ps1 bat gradle tf tfvars hcl proto graphql gql prisma "
  + "sol nix mk cmake pbxproj xcconfig entitlements strings log diff patch pdf png jpg jpeg gif svg webp ico mov mp4 wasm").split(" "));

// The `open` preset never launches what it opens, judged by where the path really leads (opener.js
// realPathOf: a link named notes.md that leads to an app is an app): an app, a package, an extension, a
// disk image, a profile or a jar is revealed in Finder (open -R); a script or anything macOS would run (a
// .command, a Python file or its bytecode Python Launcher would run, a .jnlp Java would start) opens in the
// default text editor (open -t); a file with no extension too (an executable would run in Terminal), and
// one whose kind is not known (a folder or not), or whose real place is not known, is revealed.
export const REVEAL_EXT = new Set(("app bundle framework prefpane saver kext plugin workflow action scptd pkg mpkg dmg iso jar "
  + "appex xpc service qlgenerator mdimporter osax mobileconfig shortcut xip sparseimage sparsebundle img cdr").split(" "));
export const TEXT_EXT = new Set(("command tool sh bash zsh fish csh tcsh ksh py pyw pyc pyo pyz pyzw rb pl php tcl scpt applescript "
  + "terminal itermcolors url webloc inetloc fileloc desktop jnlp exe msi com bat cmd ps1 vbs").split(" "));
// A custom command that names one of these anywhere in it is refused: ledgr runs no shell, no interpreter
// (a file given to one runs), no wrapper that runs the program after it (arch sh -c, caffeinate, env, sudo,
// time, xcrun), and nothing that drives a terminal. A versioned interpreter (python3.12, ruby2.7, node22)
// by INTERP; AppleScript's runners (osascript, osacompile) by their prefix (RUNNER).
export const SHELLS = new Set(("sh bash zsh fish dash ksh csh tcsh nu pwsh powershell env xargs nohup sudo su doas script expect tmux screen "
  + "hc herdr herdr-app python python3 node ruby perl php deno bun npx eval exec "
  + "arch caffeinate nice time timeout gtimeout stdbuf taskpolicy sandbox-exec chroot launchctl watch command builtin xcrun ssh "
  + "swift swiftc java jshell kotlin kotlinc scala groovy julia r rscript lua luajit tclsh wish awk gawk mawk nawk make gmake "
  + "npm pnpm yarn uv uvx pipx poetry pip pip3 rake irb jruby pypy pypy3 elixir iex erl escript runghc runhaskell racket guile sbcl ocaml").split(" "));
const INTERP = /^(?:python|pypy|ruby|jruby|perl|php|node|nodejs|deno|bun|lua|luajit|tclsh|wish|swift|java|julia|rscript|pwsh|bash|zsh|ksh|sh|dash|fish|tcsh|csh)(?:[-_.]?\d[\d.]*[a-z]?)$/;
const RUNNER = /^osa[a-z]*$/;
const TERMINAL_APP = new RegExp("^(?:Terminal|iTerm2?|Warp|Alacritty|kitty|WezTerm|Ghostty|Hyper|Tabby|Rio|com\\.apple\\.Terminal|com\\.googlecode\\.iterm2"
  + "|dev\\.warp\\.Warp(?:-Stable|-Preview|-Beta)?|com\\.mitchellh\\.ghostty|net\\.kovidgoyal\\.kitty|(?:org|io)\\.alacritty|com\\.github\\.wez\\.wezterm"
  + "|co\\.zeit\\.hyper|org\\.tabby|com\\.raphaelamorim\\.rio)(?:\\.app)?$", "i");
// The words of an app name or bundle id that open -a or -b may not name: a terminal, or something that
// runs what it is given (Python Launcher, Jar Launcher, Java Web Start, the Installer, an applet).
const LAUNCH_WORDS = new Set("terminal iterm iterm2 warp alacritty kitty wezterm ghostty hyper tabby rio xterm shell installer applet wish javawebstart".split(" "));

// ── finding paths ──────────────────────────────────────────────────────────
const SEG = "[A-Za-z0-9_.@+%~-]";
// One candidate: an optional anchor, segments, an optional trailing slash, an optional :line[:col] or #L12.
const TOKEN = new RegExp(`(?:~\\/|\\.\\.?\\/|\\/)?${SEG}+(?:\\/${SEG}+)*\\/?(?::\\d+(?::\\d+)?|#L\\d+(?:-L?\\d+)?)?`, "g");
const TOKEN_WHOLE = new RegExp(`^${TOKEN.source}$`);
// What may come right before a path.
const BEFORE = /[\s([{"'“‘<>*=,;|]/;
const TRAIL = /[.,;:!?_-]+$/;
// The first segment of an absolute path with no extension that is linked (a folder every Mac has, or one a
// tool puts at the root); /api/v1/users is an endpoint, not a file.
const ROOTS = new Set("Users Volumes Applications Library System private etc var tmp usr opt bin sbin dev cores home nix Network mnt srv root".split(" "));
// A first segment that is a host (github.com/x/y written without its scheme).
const HOST = /^(?:[A-Za-z0-9-]+\.)+(?:com|org|net|io|dev|ai|app|co|edu|gov|me|sh|xyz|info|us|uk|de|fr|eu|ca|au|jp|cloud|tech|site)$/i;
const EXT = /^(.+)\.([A-Za-z][A-Za-z0-9_+-]{0,11})$/;

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 1e7 ? n : null; };
const hasLetter = (s) => /[A-Za-z]/.test(s);

// A token (no trailing punctuation) as a path: {path, line, col}, or null when it is not one. code: inside
// a code span (a capitalized .js name counts there).
export function classify(token, code = false) {
  const m = /^(.*?)(?::(\d+)(?::(\d+))?|#L(\d+)(?:-L?\d+)?)?$/.exec(String(token ?? ""));
  if (!m || !m[1]) return null;
  const p = m[1], line = posInt(m[2] ?? m[4]), col = line && m[3] ? posInt(m[3]) : null;
  if (!pathLike(p, code)) return null;
  return { path: p, line, col };
}

function pathLike(p, code) {
  if (/\/\//.test(p) || /\s/.test(p)) return false;
  if (p.startsWith("~/") || p.startsWith("./") || p.startsWith("../")) return /[^./~]/.test(p.replace(/^(?:~|\.\.?)\//, ""));
  const segs = p.split("/");
  const dir = p.endsWith("/");
  const parts = segs.filter(Boolean);
  if (!parts.length || parts.some((x) => /^\.+$/.test(x) && x.length > 2)) return false;
  const last = parts[parts.length - 1];
  const ext = EXT.exec(last);
  if (p.startsWith("/")) return Boolean(ext && !dir) || (parts.length >= 2 && ROOTS.has(parts[0]));
  if (parts.length === 1 && !dir) {
    if (!ext || ext[1].length < 2 || !KNOWN_EXT.has(ext[2].toLowerCase())) return false;
    if (!code && ext[2] === "js" && /^[A-Z][A-Za-z0-9]*$/.test(ext[1])) return false;   // Node.js, Next.js
    return true;
  }
  if (HOST.test(parts[0])) return false;
  if (ext && !dir) return true;
  if (dir) return parts.length >= 2 && parts.every(hasLetter);
  return parts.length >= 3 && hasLetter(last);
}

// Text normalized as the markdown is (\r\n and \r as \n): findPaths' offsets index this.
const norm = (text) => String(text ?? "").replace(/\r\n?/g, "\n");

// [start, end) of each paragraph that is prose: outside fenced code, between blank lines.
function proseRanges(s) {
  const out = [];
  let fence = null, at = 0, start = -1, end = -1;
  const close = () => { if (start >= 0) out.push([start, end]); start = -1; };
  for (const l of s.split("\n")) {
    const from = at;
    at += l.length + 1;
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(l);
    if (f) {
      close();
      if (!fence) fence = { ch: f[1][0], n: f[1].length };
      else if (f[1][0] === fence.ch && f[1].length >= fence.n && !f[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    if (!l.trim()) { close(); continue; }
    if (start < 0) start = from;
    end = from + l.length;
  }
  close();
  return out;
}

// An indented code paragraph: every line indented four spaces or a tab, the first not a list item.
const indentedCode = (para) => {
  const ls = para.split("\n");
  return ls.every((l) => /^(?: {4}|\t)/.test(l)) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(ls[0]);
};

// The partner of each opening bracket in s (open/close one character each), in one pass: a backslash
// keeps the next character from counting; partner[i] is the index of the closing one, or -1.
function partners(s, open, close) {
  const partner = new Int32Array(s.length).fill(-1), stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { i++; continue; }
    if (c === open) stack.push(i);
    else if (c === close && stack.length) partner[stack.pop()] = i;
  }
  return partner;
}

// The spans of a paragraph no path is looked for in: code spans ({code: inner text}), links and images,
// autolinks and HTML tags, URLs. Linear: each run of backticks finds the next run of its length through a
// cursor per length, and brackets and parentheses are paired once (partners).
function protectedSpans(para) {
  const spans = [];
  const inCode = new Uint8Array(para.length + 1);
  // Code spans: a run of n backticks to the next run of exactly n (CommonMark); an unmatched run is literal.
  const runs = [...para.matchAll(/`+/g)].map((m) => [m.index, m[0].length]);
  const byLen = new Map();
  runs.forEach(([, n], k) => { if (!byLen.has(n)) byLen.set(n, []); byLen.get(n).push(k); });
  const cursor = new Map();
  const nextRun = (i, n) => {
    const list = byLen.get(n);
    let c = cursor.get(n) ?? 0;
    while (c < list.length && list[c] <= i) c++;
    cursor.set(n, c);
    return c < list.length ? list[c] : -1;
  };
  for (let i = 0; i < runs.length; i++) {
    const [a, n] = runs[i];
    if (a > 0 && para[a - 1] === "\\") continue;
    const j = nextRun(i, n);
    if (j < 0) continue;
    const b = runs[j][0];
    spans.push({ start: a, end: b + n, code: para.slice(a + n, b) });
    inCode.fill(1, a, b + n);
    i = j;
  }
  const add = (start, end) => { if (!inCode[start]) spans.push({ start, end }); };
  // Links and images: [text](dest), [text][ref], and a reference definition [ref]: dest at a line's start.
  const sq = partners(para, "[", "]"), par = partners(para, "(", ")");
  for (let i = para.indexOf("["); i >= 0; i = para.indexOf("[", i + 1)) {
    if (inCode[i] || (i > 0 && para[i - 1] === "\\")) continue;
    const j = sq[i];
    if (j < 0) continue;
    const start = i > 0 && para[i - 1] === "!" ? i - 1 : i;
    const next = para[j + 1];
    if (next === "(" || next === "[") {
      const k = next === "(" ? par[j + 1] : sq[j + 1];
      if (k >= 0) { add(start, k + 1); i = k; }
    } else if (next === ":" && (i === 0 || para[i - 1] === "\n")) {
      const eol = para.indexOf("\n", j);
      add(start, eol < 0 ? para.length : eol);
    }
  }
  for (const m of para.matchAll(/<[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*>|<\/?[A-Za-z][^<>\n]*>/g)) add(m.index, m.index + m[0].length);
  for (const m of para.matchAll(/(?:\b[A-Za-z][A-Za-z0-9+.-]*:\/\/|\bwww\.)[^\s<>]*/g)) add(m.index, m.index + m[0].length);
  return spans.sort((x, y) => x.start - y.start);
}

// Spans merged where they overlap or nest, in order: [[start, end]] (a path overlapping one is skipped).
function merged(spans) {
  const out = [];
  for (const sp of [...spans].sort((x, y) => x.start - y.start)) {
    const last = out[out.length - 1];
    if (last && sp.start < last[1]) last[1] = Math.max(last[1], sp.end);
    else out.push([sp.start, sp.end]);
  }
  return out;
}

// Every path in a text: [{start, end, raw, path, line, col, code}] in order, offsets into the text with its
// line breaks normalized (\r\n as \n). code: the hit is a whole code span (raw keeps its backticks).
export function findPaths(text) {
  const s = norm(text), hits = [];
  for (const [a, b] of proseRanges(s)) {
    const para = s.slice(a, b);
    if (indentedCode(para)) continue;
    const spans = protectedSpans(para);
    // A code span inside a link is not linked again (the link's merged ranges, walked with a cursor).
    const links = merged(spans.filter((sp) => sp.code === undefined));
    let li = 0;
    for (const sp of spans) {
      if (sp.code === undefined) continue;
      while (li < links.length && links[li][1] <= sp.start) li++;
      if (li < links.length && sp.start >= links[li][0] && sp.end <= links[li][1]) continue;
      const inner = sp.code.length > 2 && sp.code.startsWith(" ") && sp.code.endsWith(" ") && sp.code.trim() ? sp.code.slice(1, -1) : sp.code;
      if (!TOKEN_WHOLE.test(inner)) continue;
      const c = classify(inner, true);
      if (c) hits.push({ start: a + sp.start, end: a + sp.end, raw: para.slice(sp.start, sp.end), ...c, code: true });
    }
    // Every protected range, merged; tokens come in order, so a cursor finds the one a token may overlap.
    const ranges = merged(spans);
    let ri = 0;
    TOKEN.lastIndex = 0;
    for (let m = TOKEN.exec(para); m; m = TOKEN.exec(para)) {
      const i = m.index;
      if (!m[0]) { TOKEN.lastIndex++; continue; }
      while (ri < ranges.length && ranges[ri][1] <= i) ri++;
      if (ri < ranges.length && ranges[ri][0] < i + m[0].length) { TOKEN.lastIndex = Math.max(TOKEN.lastIndex, ranges[ri][1]); continue; }
      if (i > 0 && !BEFORE.test(para[i - 1])) continue;
      // Trailing punctuation, _ and - are not part of it; as many leading _ as trailing ones (emphasis).
      const cut = m[0].replace(TRAIL, "");
      const under = (m[0].slice(cut.length).match(/_/g) ?? []).length;
      const lead = Math.min(under, (/^_*/.exec(cut)?.[0].length ?? 0));
      const raw = cut.slice(lead);
      const c = raw ? classify(raw, false) : null;
      if (c) hits.push({ start: a + i + lead, end: a + i + lead + raw.length, raw, ...c, code: false });
    }
  }
  return hits.sort((x, y) => x.start - y.start);
}

// ── the private URL ────────────────────────────────────────────────────────
// encodeURIComponent leaves ( ) ' ! * as they are; a markdown link destination needs ( and ) escaped.
const enc = (s) => encodeURIComponent(s).replace(/[()'!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// A path's link: https://ledgr.invalid/path/<the path, percent-encoded>[?line=N[&col=M]].
export function linkFor({ path, line = null, col = null }) {
  const L = posInt(line), C = L ? posInt(col) : null;
  return `${LINK_BASE}${enc(String(path ?? ""))}${L ? `?line=${L}${C ? `&col=${C}` : ""}` : ""}`;
}

// The ASCII punctuation markdown reads as syntax (detailing.js MD_SYNTAX): a prose path as a link label shows
// exactly as written (__init__.py is not bold).
const LABEL_ESC = /[\\`*_{}[\]()#+\-.!|<>~=&$^:@]/g;
export const labelOf = (raw) => String(raw ?? "").replace(LABEL_ESC, "\\$&");

// The text with every path a link under the private URL (findPaths): a prose path as [escaped path](url), a
// code span as [`code`](url). Everything else is left as it is; line breaks normalized. The last
// LINKIFY_CACHE results are kept by text (the dialog draws the same message on every render).
export const LINKIFY_CACHE = 32;
const linkified = new Map();
export function linkify(text) {
  const key = String(text ?? "");
  const hit = linkified.get(key);
  if (hit !== undefined) { linkified.delete(key); linkified.set(key, hit); return hit; }
  const s = norm(key), hits = findPaths(s);
  let out = s;
  if (hits.length) {
    let at = 0;
    out = "";
    for (const h of hits) {
      out += s.slice(at, h.start) + `[${h.code ? h.raw : labelOf(h.raw)}](${linkFor(h)})`;
      at = h.end;
    }
    out += s.slice(at);
  }
  linkified.set(key, out);
  if (linkified.size > LINKIFY_CACHE) linkified.delete(linkified.keys().next().value);
  return out;
}

// A URL a TextView reports on a click: {kind: "web", url} (http, https), {kind: "path", path, line, col}
// (the private form, a file:// URL, or a relative or absolute path as a markdown link wrote it: [the
// spec](docs/design/Detail.md#L12)), {kind: "other", url, scheme} (mailto:, …: never opened) or
// {kind: "none"}.
export function parseLink(url) {
  const u = String(url ?? "").trim();
  if (!u) return { kind: "none" };
  const own = /^https?:\/\/ledgr\.invalid\/path\/([^?#]*)(?:\?([^#]*))?/i.exec(u);
  if (own) {
    const q = new Map((own[2] ?? "").split("&").filter(Boolean).map((kv) => kv.split("=")));
    const path = dec(own[1]), line = posInt(q.get("line")), col = line ? posInt(q.get("col")) : null;
    return path ? { kind: "path", path, line, col } : { kind: "none" };
  }
  if (/^https?:\/\/[^\s/?#]+/i.test(u)) return { kind: "web", url: u };
  if (/^file:\/\//i.test(u)) return pathRef(dec(u.replace(/^file:\/\/(?:localhost)?/i, "")));
  const sch = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(u);
  if (sch) return { kind: "other", url: u, scheme: sch[1].toLowerCase() };
  return pathRef(dec(u));
}

// A path as a link destination wrote it: #L12 or :12[:3] at its end gives the line; any other #fragment or
// ?query is dropped.
function pathRef(p) {
  const m = /^([^?#]*?)(?::(\d+)(?::(\d+))?)?(?:\?[^#]*)?(?:#L(\d+)(?:-L?\d+)?|#[^#]*)?$/.exec(p);
  if (!m || !m[1]) return { kind: "none" };
  const line = posInt(m[2] ?? m[4]), col = line && m[3] ? posInt(m[3]) : null;
  return { kind: "path", path: m[1], line, col };
}

// ── resolving ──────────────────────────────────────────────────────────────
export const isAbs = (p) => typeof p === "string" && p.startsWith("/");
// A path that needs a folder to be found from (not /…, not ~…).
export const isRelative = (p) => { const s = String(p ?? ""); return Boolean(s) && !s.startsWith("/") && s !== "~" && !s.startsWith("~/"); };

// "/a/./b/../c/" as "/a/c".
export function normPath(p) {
  const abs = String(p ?? "").startsWith("/"), out = [];
  for (const seg of String(p ?? "").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { if (out.length) out.pop(); continue; }
    out.push(seg);
  }
  return (abs ? "/" : "") + out.join("/") || (abs ? "/" : ".");
}

// Where a path may be, in the order the click looks: as given when absolute or under ~ (home); else under
// the session's folder (cwd), then under its repository's top (root, the git toplevel). Absolute paths, each
// once; [] when there is nothing to look under.
export function resolvePath(p, { cwd = null, root = null, home = null } = {}) {
  const s = String(p ?? "").trim(), out = [];
  const add = (x) => { if (x && !out.includes(x)) out.push(x); };
  if (!s) return out;
  if (s === "~" || s.startsWith("~/")) { if (isAbs(home)) add(normPath(home + s.slice(1))); return out; }
  if (isAbs(s)) { add(normPath(s)); return out; }
  for (const base of [cwd, root]) if (isAbs(base)) add(normPath(`${base}/${s}`));
  return out;
}

// A path as a person reads it: under ~ when it is in home; ":12" or ":12:3" after it.
export function shownPath(p, { line = null, col = null, home = null } = {}) {
  const s = String(p ?? ""), h = isAbs(home) ? home.replace(/\/+$/, "") : null;
  const short = h && (s === h || s.startsWith(`${h}/`)) ? `~${s.slice(h.length)}` : s;
  const L = posInt(line), C = L ? posInt(col) : null;
  return `${short}${L ? `:${L}${C ? `:${C}` : ""}` : ""}`;
}

// ── links.editor ───────────────────────────────────────────────────────────
// The setting as found in config.json, normalized: a preset name, a custom command (a trimmed string, or an
// argv array of strings), else the default.
export function editorOf(cfg) {
  const v = cfg?.links?.editor;
  if (Array.isArray(v)) return v.length && v.every((x) => typeof x === "string") && v[0].trim() ? v.map(String) : EDITOR_DEFAULT;
  if (typeof v !== "string" || !v.trim()) return EDITOR_DEFAULT;
  const t = v.trim();
  return EDITOR_PRESETS.includes(t.toLowerCase()) ? t.toLowerCase() : t;
}

export const isPreset = (v) => typeof v === "string" && EDITOR_PRESETS.includes(v);
// The setting in words (the settings row, its field, the status line): a preset's name, a custom command as
// written, an argv array as one command line that splitCommand reads back the same (joinCommand).
export const editorWords = (v) => (isPreset(v) ? v : Array.isArray(v) ? joinCommand(v) : String(v ?? EDITOR_DEFAULT));

// A command line split into argv as a shell splits words, with no shell: blanks separate; 'single' quotes
// keep everything as it is; "double" quotes keep blanks, with \" and \\ inside; a backslash outside quotes
// keeps the next character; pieces side by side join (--a="b c" is one argument); '' is an empty one.
export function splitCommand(s) {
  const out = [], str = String(s ?? "");
  let cur = "", has = false, q = null;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === "\\" && (str[i + 1] === '"' || str[i + 1] === "\\")) cur += str[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === "\\" && i + 1 < str.length) { cur += str[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ""; has = false; } continue; }
    cur += c; has = true;
  }
  if (has) out.push(cur);
  return out;
}

// argv as one command line that splitCommand reads back as the same argv: an argument holding a blank, a
// quote or a backslash, or an empty one, is quoted ('…'; "…" with \" and \\ when it holds a single quote).
export function joinCommand(argv) {
  return (Array.isArray(argv) ? argv : []).map((a) => {
    const x = String(a);
    if (x && !/[\s'"\\]/.test(x)) return x;
    return x.includes("'") ? `"${x.replace(/["\\]/g, "\\$&")}"` : `'${x}'`;
  }).join(" ");
}

const base = (p) => String(p ?? "").split("/").pop();
const extOf = (p) => { const m = /\.([A-Za-z0-9]+)$/.exec(base(String(p ?? "").replace(/\/+$/, ""))); return m ? m[1].toLowerCase() : ""; };
const PLACEHOLDER = /\{(?:path|line|col)\}/;

// The program an argument names that runs commands or files (a shell, an interpreter, a wrapper that runs
// the program after it), or null. Both the argument and what follows its last "=" are looked at.
function runner(a) {
  const x = String(a ?? "").trim();
  for (const part of new Set([x, x.slice(x.lastIndexOf("=") + 1)])) {
    const b = base(part), low = b.toLowerCase().replace(/\.exe$/, "");
    if (low && (SHELLS.has(low) || INTERP.test(low) || RUNNER.test(low))) return b;
  }
  return null;
}

// The apps `open -a` and bundle ids `open -b` name in an open command (getopt: the rest of the flag group,
// else the next argument).
function openApps(argv) {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === "--") break;
    if (!/^-[^-]/.test(a)) continue;
    const k = a.slice(1).search(/[ab]/);
    if (k < 0) continue;
    const rest = a.slice(k + 2);
    if (rest) out.push(rest); else if (i + 1 < argv.length) out.push(String(argv[++i]));
  }
  return out;
}

// An app name, path or bundle id that runs or drives what it is given: a shell or interpreter, a terminal,
// a launcher (Python Launcher, Jar Launcher, Java Web Start), the Installer, an applet.
function launches(app) {
  const name = base(String(app ?? "").trim().replace(/\/+$/, "")).replace(/\.app$/i, ""), low = name.toLowerCase();
  if (!low) return false;
  if (runner(low) || TERMINAL_APP.test(name)) return true;
  if (/launcher|python|javawebstart|installer|terminal|iterm|applet/.test(low.replace(/[\s._-]+/g, ""))) return true;
  return low.split(/[\s._-]+/).some((w) => LAUNCH_WORDS.has(w));
}

// Does an open command bring its own app (-a, -b, or TextEdit's -e)? Without, it is the `open` preset.
const openOwnApp = (tpl) => openApps(tpl).length > 0 || tpl.slice(1).some((a) => /^-[A-Za-z]*e[A-Za-z]*$/.test(String(a)));

// Why a custom command is refused, in words the settings dialog shows (editorRefusal), or null. all: every
// argument is looked at (the command as written); false: the program only (after the path is put in, so a
// clicked file named env is no program).
function refusedCommand(argv, all = true) {
  if (!argv.length || !argv[0].trim()) return "it is empty";
  if (PLACEHOLDER.test(argv[0])) return "its program would be the clicked file";
  if (argv.some((a) => /[\r\n\0]/.test(a))) return "it holds a line break";
  for (const a of all ? argv : argv.slice(0, 1)) {
    const name = runner(a);
    if (name) return `${name} is a shell, an interpreter or a program that runs another, and ledgr runs none`;
  }
  if (argv.some((a) => TERMINAL_APP.test(a.trim()))) return "it names a terminal, and ledgr opens none";
  if (base(argv[0]) === "open") {
    if (argv.some((a) => a === "--env" || a.startsWith("--env="))) return "open --env sets what the opened app runs with, and ledgr sets nothing";
    for (const app of openApps(argv)) {
      if (PLACEHOLDER.test(app)) return "open -a or -b would launch the clicked file as an app";
      if (launches(app)) return `open -a or -b names ${app}, a launcher, shell or terminal, and ledgr opens none`;
    }
  }
  return null;
}

// Does links.editor open with the `open` preset's guards ("open", or a command `open {path}` with no app of
// its own)? opener.js then looks where the path really leads first (realPathOf).
export function usesOpenPreset(setting) {
  const v = Array.isArray(setting) ? setting : typeof setting === "string" && setting.trim() ? setting.trim() : EDITOR_DEFAULT;
  if (v === "open") return true;
  if (v === "zed" || v === "code") return false;
  const tpl = Array.isArray(v) ? v.map(String) : splitCommand(v);
  return base(tpl[0] ?? "") === "open" && !openOwnApp(tpl);
}

// The argv that opens a path with links.editor, or {error}. {argv, how}: how names what opens it, for the
// status line. target: {path (absolute), line, col, dir (true: a folder; false: a file; null: not known),
// real (where the path really leads, opener.js realPathOf: a string; null: not known; left out: not looked)}.
//   open: open <path> (no line); an app, package, extension or disk image (by its own extension or its real
//         one): open -R; a script or a file with no extension: open -t (the default text editor: never
//         run); a path whose kind is not known and has no extension, or whose real place is not known:
//         open -R.
//   zed:  zed <path>[:line[:col]]
//   code: code -g <path>[:line[:col]]
//   custom: its argv with {path}, {line}, {col} put in ({path} added last when it has none; with no line,
//         ":{line}" and ":{col}" are dropped and a lone {line} or {col} is 1). Never a shell, an
//         interpreter, a program that runs another, a terminal, open -a/-b naming a launcher, or a line
//         break, wherever it is named.
export function openerArgv(setting, { path, line = null, col = null, dir = null, real } = {}) {
  const p = String(path ?? "");
  if (!isAbs(p)) return { error: "not an absolute path" };
  if (/[\r\n\0]/.test(p)) return { error: "the path holds a line break" };
  const L = posInt(line), C = L ? posInt(col) : null;
  const at = L ? `${p}:${L}${C ? `:${C}` : ""}` : p;
  const v = Array.isArray(setting) ? setting : typeof setting === "string" && setting.trim() ? setting.trim() : EDITOR_DEFAULT;
  if (v === "open") {
    if (real === null) return { argv: ["open", "-R", p], how: "Finder (revealed: where it leads is not known)" };
    const exts = [extOf(p), ...(typeof real === "string" && isAbs(real) && real !== p ? [extOf(real)] : [])];
    const e = exts[exts.length - 1];
    if (exts.some((x) => REVEAL_EXT.has(x))) return { argv: ["open", "-R", p], how: "Finder (revealed: an app, package or disk image is never launched)" };
    if (dir === true) return { argv: ["open", p], how: "Finder" };
    if (exts.some((x) => TEXT_EXT.has(x)) || (!e && dir === false)) return { argv: ["open", "-t", p], how: "the default text editor (a script is never run)" };
    if (!e) return { argv: ["open", "-R", p], how: "Finder (revealed)" };
    return { argv: ["open", p], how: "the default app" };
  }
  if (v === "zed") return { argv: ["zed", at], how: EDITOR_HOW.zed };
  if (v === "code") return { argv: ["code", "-g", at], how: EDITOR_HOW.code };
  const tpl = Array.isArray(v) ? v.map(String) : splitCommand(v);
  // `open {path}` with no -a, -b or -e is the preset (its guards included).
  if (base(tpl[0]) === "open" && !openOwnApp(tpl)) return openerArgv("open", { path: p, line: L, col: C, dir, real });
  const why = refusedCommand(tpl);
  if (why) return { error: `links.editor is refused: ${why}` };
  const fill = (a) => {
    let x = a;
    if (!L) x = x.replace(/(?::|#L|\+)\{line\}/g, "").replace(/:\{col\}/g, "");
    else if (!C) x = x.replace(/:\{col\}/g, "");
    return x.replace(/\{path\}/g, p).replace(/\{line\}/g, String(L ?? 1)).replace(/\{col\}/g, String(C ?? 1));
  };
  const argv = tpl.map(fill).filter((a) => a !== "");
  if (!tpl.some((a) => a.includes("{path}"))) argv.push(p);
  const again = refusedCommand(argv, false);
  if (again) return { error: `links.editor is refused: ${again}` };
  return { argv, how: base(argv[0]) };
}

// A value the settings dialog may write to links.editor: a preset, or a custom command openerArgv accepts
// (at most EDITOR_MAX characters). null: refused. An empty one is the default.
export function editorValue(v) {
  if (Array.isArray(v)) return v.length && v.every((x) => typeof x === "string") && !openerArgv(v, { path: "/x" }).error ? v.map(String) : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return EDITOR_DEFAULT;
  if (EDITOR_PRESETS.includes(t.toLowerCase())) return t.toLowerCase();
  if (t.length > EDITOR_MAX || /[\r\n\0]/.test(t)) return null;
  return openerArgv(t, { path: "/x" }).error ? null : t;
}

// Why the settings dialog does not save v as links.editor, in words (words.js editorRefusedWords), or null
// when editorValue takes it.
export function editorRefusal(v) {
  if (editorValue(v) !== null) return null;
  if (Array.isArray(v) ? !v.length || !v.every((x) => typeof x === "string") : typeof v !== "string") return "it is not a command";
  if (!Array.isArray(v) && v.trim().length > EDITOR_MAX) return `it is over ${EDITOR_MAX} characters`;
  if (!Array.isArray(v) && /[\r\n\0]/.test(v.trim())) return "it holds a line break";
  const e = openerArgv(v, { path: "/x" }).error;
  return e ? e.replace(/^links\.editor is refused: /, "") : "it is not a command ledgr runs";
}
