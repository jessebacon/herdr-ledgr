// ledgr links (2026-11-10), under Node, self-contained: links.js (pure) and opener.js (with a recording `herdr`
// stub: every exec is kept, none is run) in a scratch folder, and checks
//   findPaths on a corpus: paths with and without :line, :line:col and #L12, under ~, ./ and ../, absolute,
//     relative with a slash, bare names with a known extension, code spans (linked whole, the code kept as
//     the label; a command left alone), fenced and indented code skipped, existing links, autolinks, HTML
//     and URLs untouched, and the false positives the policy keeps out (and/or, TCP/IP, 1.5, e.g., a.m.,
//     Node.js, example.com, github.com/a/b, /btw, 24/7, 2026/11/10, @types/node, v0.1.0, …);
//   linkify: every hit a link whose label reads as the path and whose URL parses back to it; a text with no
//     path unchanged; parseLink for the private form, web links, file://, a markdown link's relative path,
//     other schemes; resolvePath's candidates and their order; shownPath; editorOf, editorValue;
//   openerArgv per preset (open's guards: an app revealed, a script as text, a folder in Finder) and for a
//     command of your own ({path}, {line}, {col}; a shell, a terminal, the file as the program refused);
//   opener.js: statAt on a file, a folder and nothing; openPath runs one exec with the preset's argv and the
//     5 s limit, and none for a path that is not there; revealPath is open -R; gitToplevel reads git's answer.
//   node tests/test_links.mjs
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(HERE, "../..");                 // mods/ledgr (repo or live install)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgr-links."));
let checks = 0;
const A = new Proxy(assert, { get: (t, k) => (...a) => { checks++; return t[k](...a); } });

for (const f of ["links.js", "opener.js"]) fs.copyFileSync(path.join(MOD, f), path.join(dir, f));
fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
fs.mkdirSync(path.join(dir, "node_modules/herdr"), { recursive: true });
fs.writeFileSync(path.join(dir, "node_modules/herdr/package.json"), '{"name":"herdr","type":"module","main":"index.js"}');
fs.writeFileSync(path.join(dir, "node_modules/herdr/index.js"), `
const H = () => (globalThis.__herdr ??= { execs: [], execFn: null });
export const exec = async (cmd, args, o) => { H().execs.push([cmd, args ?? [], o ?? null]); return H().execFn ? H().execFn(cmd, args ?? [], o) : { code: 0, stdout: "", stderr: "" }; };
`);
const H = () => globalThis.__herdr;

try {
  const L = await import(`${dir}/links.js`);
  const O = await import(`${dir}/opener.js`);

  // ── findPaths: the corpus ──────────────────────────────────────────────
  const one = (text) => L.findPaths(text).map((h) => [h.raw, h.path, h.line, h.col, h.code]);
  const YES = [
    ["see src/app.js today", ["src/app.js", "src/app.js", null, null, false]],
    ["see src/app.js:12.", ["src/app.js:12", "src/app.js", 12, null, false]],
    ["at src/app.js:12:5, then", ["src/app.js:12:5", "src/app.js", 12, 5, false]],
    ["github style foo/bar.py#L12-L20 here", ["foo/bar.py#L12-L20", "foo/bar.py", 12, null, false]],
    ["home ~/.claude/settings.json", ["~/.claude/settings.json", "~/.claude/settings.json", null, null, false]],
    ["here ./x and", ["./x", "./x", null, null, false]],
    ["up ../y/z.txt.", ["../y/z.txt", "../y/z.txt", null, null, false]],
    ["abs /etc/hosts and", ["/etc/hosts", "/etc/hosts", null, null, false]],
    ["abs /x.md too", ["/x.md", "/x.md", null, null, false]],
    ["a folder mods/ledgr/ here", ["mods/ledgr/", "mods/ledgr/", null, null, false]],
    ["three mods/ledgr/bin deep", ["mods/ledgr/bin", "mods/ledgr/bin", null, null, false]],
    ["bare README.md and", ["README.md", "README.md", null, null, false]],
    ["python __init__.py too", ["__init__.py", "__init__.py", null, null, false]],
    ["types index.d.ts:3", ["index.d.ts:3", "index.d.ts", 3, null, false]],
    ["(in docs/design/Detail.md)", ["docs/design/Detail.md", "docs/design/Detail.md", null, null, false]],
    ["“quoted ledgr-data/config.json”", ["ledgr-data/config.json", "ledgr-data/config.json", null, null, false]],
    ["the export at `reports/pool-settings.md` now", ["`reports/pool-settings.md`", "reports/pool-settings.md", null, null, true]],
    ["code `src/app.js:12` here", ["`src/app.js:12`", "src/app.js", 12, null, true]],
    ["a capitalized js in code `App.js` links", ["`App.js`", "App.js", null, null, true]],
    ["- list item src/list.js", ["src/list.js", "src/list.js", null, null, false]],
    ["| a | src/t.ts | b |", ["src/t.ts", "src/t.ts", null, null, false]],
    ["**bold src/b.go**", ["src/b.go", "src/b.go", null, null, false]],
    ["emphasis _src/it.js_ here", ["src/it.js", "src/it.js", null, null, false]],
    ["strong __docs/x.md__ here", ["docs/x.md", "docs/x.md", null, null, false]],
    ["a dash src/a.js- here", ["src/a.js", "src/a.js", null, null, false]],
    ["home dir /Users/jesse/notes now", ["/Users/jesse/notes", "/Users/jesse/notes", null, null, false]],
    ["brew /opt/homebrew/bin here", ["/opt/homebrew/bin", "/opt/homebrew/bin", null, null, false]],
  ];
  for (const [text, want] of YES) A.deepEqual(one(text), [want], `found in ${JSON.stringify(text)}`);
  const NO = ["and/or", "TCP/IP", "km/h", "w/o", "24/7", "1/2", "2026/11/10", "@types/node", "1.5", "v0.1.0", "127.0.0.1:8080", "e.g.", "i.e.", "a.m.", "etc.",
    "Node.js", "Next.js", "D3.js", "example.com", "jesse@example.com", "github.com/jessebacon/herdr-ledgr", "www.example.com/a/b.js", "/btw", "/mcp", "/tmp",
    "localhost:8080/api", "$HOME/x.js", "…/16.md", "x:src/a.js", "ab", "a.md", "plain words only", "client-server", "12:30", "#L12", "src/",
    "/api/v1/users", "/v1/users", "/users/42", "GET /api/items/", "_", "__"];
  for (const text of NO) A.deepEqual(one(`see ${text} here`), [], `nothing in “see ${text} here”`);
  A.deepEqual(one("```\nsrc/inside.js\n```\nafter src/out.js"), [["src/out.js", "src/out.js", null, null, false]], "fenced code skipped");
  A.deepEqual(one("~~~js\nconst p = 'src/a.js';\n~~~"), [], "a tilde fence too");
  A.deepEqual(one("text\n\n    src/indented.js\n    more/code.py\n\nafter"), [], "an indented code paragraph skipped");
  A.equal(one("    - nested item src/n.js").length, 1, "an indented list item is not code");
  A.deepEqual(one("[the spec](docs/design/Detail.md) and ![img](a/b.png) and [ref][docs/x.md]"), [], "existing links and images untouched");
  A.deepEqual(one("[docs/x.md]: https://example.com/x"), [], "a reference definition untouched");
  A.deepEqual(one("[`src/a.js`](src/a.js)"), [], "a code span inside a link is not linked again");
  A.deepEqual(one("<https://x.y/z.md> and <b>src/c.js</b>"), [["src/c.js", "src/c.js", null, null, false]], "an autolink and a tag untouched, the text between tags kept");
  A.deepEqual(one("https://example.com/a/b.js and http://h/c.md, file://x/y.md"), [], "URLs untouched");
  A.deepEqual(one("`cd mods/ledgr/bin && bash tests/run-all.sh`"), [], "a code span holding a command left alone");
  A.deepEqual(one("`orders_legacy` and `public`"), [], "code spans that are not paths");
  A.deepEqual(one("\\`src/a.js`"), [], "an escaped backtick opens no code span, and a path right after a backtick is not linked");
  A.deepEqual(one("a\r\nsrc/r.js").map((h) => h[0]), ["src/r.js"], "\\r\\n line breaks");
  A.deepEqual(one("moved src/a.js->src/b.js today").map((h) => h[0]), ["src/a.js", "src/b.js"], "an arrow between two paths: two paths, no dash");
  { const t = "x _src/it.js_ y"; const [h] = L.findPaths(t); A.equal(t.slice(h.start, h.end), "src/it.js", "the emphasis marks stay outside the link's offsets");
    A.equal(L.linkify(t), "x _[src/it\\.js](https://ledgr.invalid/path/src%2Fit.js)_ y", "linkify: the link inside the emphasis"); }
  A.deepEqual(one("python __init__.py and _private.py_ too").map((h) => h[0]), ["__init__.py", "private.py"], "a name's own underscores kept, emphasis ones dropped");
  { const t = "x src/a.js y `b/c.md` z"; const hs = L.findPaths(t); A.deepEqual(hs.map((h) => t.slice(h.start, h.end)), ["src/a.js", "`b/c.md`"], "offsets index the text"); }

  // ── linkify, parseLink ─────────────────────────────────────────────────
  const unesc = (s) => s.replace(/\\([\\`*_{}[\]()#+\-.!|<>~=&$^:@])/g, "$1");
  const LINK = /\[((?:\\.|`[^`]*`|[^\]\\])*)\]\((https:\/\/ledgr\.invalid\/path\/[^)\s]*)\)/g;
  for (const [text, want] of YES) {
    const md = L.linkify(text), links = [...md.matchAll(LINK)];
    A.equal(links.length, 1, `one link in ${JSON.stringify(md)}`);
    const [, label, url] = links[0];
    A.equal(want[4] ? label : unesc(label), want[0], `the label reads as written: ${label}`);
    A.deepEqual(L.parseLink(url), { kind: "path", path: want[1], line: want[2], col: want[3] }, `the URL parses back: ${url}`);
    A.ok(!/[()\s]/.test(url.slice(8)), "no parenthesis or space in the destination");
  }
  A.equal(L.linkify("__init__.py"), "[\\_\\_init\\_\\_\\.py](https://ledgr.invalid/path/__init__.py)", "a label is escaped (no bold)");
  A.equal(L.linkify("x (a/b(c).md)"), "x (a/b(c).md)", "parentheses end a path");
  const PLAIN = "No paths: and/or, 1.5, e.g. Node.js.\n\n```\nsrc/a.js\n```\n[x](y/z.md) https://e.com/a.js";
  A.equal(L.linkify(PLAIN), PLAIN, "a text with no path comes back unchanged");
  A.equal(L.linkify("a\r\nb"), "a\nb", "line breaks normalized");
  A.equal(L.linkify(null), "");
  // Linear (2026-11-10): unbalanced brackets, open links, backtick runs and many spans stay fast; linkify keeps
  // its last LINKIFY_CACHE results by text.
  const timed = (text) => { const t0 = performance.now(); L.findPaths(text); return performance.now() - t0; };
  for (const [name, text] of [["20k unbalanced [", "[".repeat(20000)], ["10k open links", "[a](".repeat(10000)], ["20k lone backticks", "` ".repeat(20000)],
    ["backtick runs", "`` ` ```` ".repeat(5000)], ["many links and paths", "x `a` [b](c) src/a.js <b>t</b> ".repeat(3000)], ["20k <a", "<a ".repeat(20000)]]) {
    const ms = Math.min(timed(text), timed(text));
    A.ok(ms < 150, `findPaths on ${name} (${text.length} characters): ${ms.toFixed(1)} ms, under 150`);
  }
  { const big = "see src/app.js:12 and `docs/x.md`, ".repeat(1500), t0 = performance.now(); const a = L.linkify(big), t1 = performance.now(); const b = L.linkify(big), t2 = performance.now();
    A.equal(a, b, "the cached result is the same"); A.ok(t2 - t1 < Math.max(1, (t1 - t0) / 5), `the second linkify of the same text comes from the cache (${(t1 - t0).toFixed(1)} ms, then ${(t2 - t1).toFixed(2)} ms)`);
    A.equal(L.LINKIFY_CACHE, 32);
    for (let i = 0; i < 40; i++) L.linkify(`n${i} src/a${i}.js`);
    A.equal(L.linkify("n39 src/a39.js"), "n39 [src/a39\\.js](https://ledgr.invalid/path/src%2Fa39.js)", "a newer text is linked as before (the cache holds the last 32)"); }
  { const t = "one src/a.js\n\n```\nsrc/b.js\n```\ntwo `c/d.md`  \nthree"; const md = L.linkify(t);
    A.equal(md.split("\n").length, t.split("\n").length, "the lines stay where they were (hardBreaks runs after)"); A.ok(md.includes("```\nsrc/b.js\n```"), "the fence unchanged"); A.ok(md.endsWith("  \nthree"), "a hard break kept"); }
  A.equal(L.linkFor({ path: "a b/(c).md", line: 3, col: 4 }), "https://ledgr.invalid/path/a%20b%2F%28c%29.md?line=3&col=4");
  A.deepEqual(L.parseLink(L.linkFor({ path: "a b/(c).md", line: 3, col: 4 })), { kind: "path", path: "a b/(c).md", line: 3, col: 4 });
  A.deepEqual(L.parseLink(L.linkFor({ path: "x.md", line: null, col: 9 })), { kind: "path", path: "x.md", line: null, col: null }, "a column needs a line");
  A.deepEqual(L.parseLink("https://example.com/a?b=1"), { kind: "web", url: "https://example.com/a?b=1" });
  A.deepEqual(L.parseLink("HTTP://Example.com"), { kind: "web", url: "HTTP://Example.com" });
  A.deepEqual(L.parseLink("docs/design/Detail.md#L12"), { kind: "path", path: "docs/design/Detail.md", line: 12, col: null }, "a markdown link's relative path, #L12");
  A.deepEqual(L.parseLink("./a.js:3:4"), { kind: "path", path: "./a.js", line: 3, col: 4 });
  A.deepEqual(L.parseLink("docs/x.md#heading-2"), { kind: "path", path: "docs/x.md", line: null, col: null }, "another fragment dropped");
  A.deepEqual(L.parseLink("file:///Users/x/a%20b.md"), { kind: "path", path: "/Users/x/a b.md", line: null, col: null });
  A.deepEqual(L.parseLink("mailto:a@b.c"), { kind: "other", url: "mailto:a@b.c", scheme: "mailto" });
  A.equal(L.parseLink("javascript:alert(1)").kind, "other"); A.equal(L.parseLink("vscode://file/x").kind, "other");
  A.deepEqual(L.parseLink("#heading"), { kind: "none" }); A.deepEqual(L.parseLink(""), { kind: "none" }); A.deepEqual(L.parseLink(null), { kind: "none" });

  // ── resolvePath, shownPath ─────────────────────────────────────────────
  const ctx = { cwd: "/r/sub", root: "/r", home: "/h" };
  A.deepEqual(L.resolvePath("src/a.js", ctx), ["/r/sub/src/a.js", "/r/src/a.js"], "the folder first, then the repository's top");
  A.deepEqual(L.resolvePath("./a.js", ctx), ["/r/sub/a.js", "/r/a.js"]);
  A.deepEqual(L.resolvePath("../a.js", ctx), ["/r/a.js", "/a.js"], "../ resolved");
  A.deepEqual(L.resolvePath("src/a.js", { cwd: "/r", root: "/r" }), ["/r/src/a.js"], "each once");
  A.deepEqual(L.resolvePath("src/a.js", { cwd: "/r" }), ["/r/src/a.js"], "no root: the folder alone");
  A.deepEqual(L.resolvePath("src/a.js", {}), [], "no folder: nowhere to look");
  A.deepEqual(L.resolvePath("/etc/./hosts", ctx), ["/etc/hosts"], "absolute: as given");
  A.deepEqual(L.resolvePath("~/.claude/x.json", ctx), ["/h/.claude/x.json"], "~: under home only");
  A.deepEqual(L.resolvePath("~/x", { cwd: "/r" }), [], "~ with no home known");
  A.deepEqual(L.resolvePath("mods/ledgr/", { cwd: "/r/" }), ["/r/mods/ledgr"]);
  A.equal(L.normPath("/a/./b/../c/"), "/a/c"); A.equal(L.normPath("/.."), "/");
  A.equal(L.isRelative("a.js"), true); A.equal(L.isRelative("/a"), false); A.equal(L.isRelative("~/a"), false);
  A.equal(L.shownPath("/h/x/a.js", { line: 3, col: 2, home: "/h" }), "~/x/a.js:3:2"); A.equal(L.shownPath("/r/a.js", { home: "/h" }), "/r/a.js");
  A.equal(L.shownPath("/hx/a.js", { home: "/h" }), "/hx/a.js", "a sibling of home is not under it");

  // ── links.editor ───────────────────────────────────────────────────────
  A.equal(L.editorOf({}), "open"); A.equal(L.editorOf({ links: { editor: " Zed " } }), "zed"); A.equal(L.editorOf({ links: { editor: "subl {path}" } }), "subl {path}");
  A.deepEqual(L.editorOf({ links: { editor: ["a", "{path}"] } }), ["a", "{path}"]); A.equal(L.editorOf({ links: { editor: [] } }), "open"); A.equal(L.editorOf({ links: { editor: 3 } }), "open");
  A.equal(L.editorValue("CODE"), "code"); A.equal(L.editorValue(""), "open"); A.equal(L.editorValue("subl {path}"), "subl {path}");
  for (const bad of ["sh -c {path}", "zsh {path}", "/usr/bin/env subl", "osa" + "script -e x", "sudo subl {path}", "hc send t1", "open -a iTerm {path}", "open -a Terminal.app {path}",
    "{path}", "{path}:{line}", "a\nb", "x".repeat(301), 3, ["bash", "{path}"]]) A.equal(L.editorValue(bad), null, `refused: ${JSON.stringify(bad).slice(0, 40)}`);
  // Every argument is looked at (2026-11-10): a wrapper, a versioned interpreter, open -a/-b naming a launcher,
  // shell or terminal, open -a {path}, open --env.
  for (const bad of ["arch sh -c x", "arch -arm64 bash {path}", "python3.12 {path}", "ruby2.7 {path}", "node22 {path}", "perl5.30 {path}", "swift {path}", "java {path}",
    "caffeinate {path}", "nice subl {path}", "/usr/bin/time subl {path}", "xcrun swift {path}", "code --with=python3 {path}", "subl --x=/bin/sh {path}",
    "open -a 'Python Launcher' {path}", "open -a \"/Applications/Python 3.12/Python Launcher.app\" {path}", "open -b org.python.PythonLauncher {path}",
    "open -b dev.warp.Warp-Stable {path}", "open -b com.mitchellh.ghostty {path}", "open -b net.kovidgoyal.kitty {path}", "open -na Terminal {path}", "open -aTerminal {path}",
    "open -a iTerm2 {path}", "open -a {path}", "open -b {path}", "open -a 'Jar Launcher' {path}", "open -a Installer {path}", "open --env X=1 -a Typora {path}",
    ["/usr/bin/env", "subl"], ["subl", "--", "sh"]])
    A.equal(L.editorValue(bad), null, `refused: ${JSON.stringify(bad)}`);
  for (const good of ["subl {path}:{line}", "open -a Typora {path}", "open -a 'Visual Studio Code' {path}", "open -b com.microsoft.VSCode {path}", "open -e {path}",
    "emacsclient -n +{line} {path}", "mate -l {line} {path}", "/Applications/My\\ Editor.app/Contents/MacOS/ed {path}", "idea --line {line} {path}"])
    A.equal(L.editorValue(good), good, `taken: ${good}`);
  A.match(L.editorRefusal("arch sh -c x"), /^arch is a shell, an interpreter or a program that runs another/, "the refusal names the part refused");
  A.match(L.editorRefusal("open -a 'Python Launcher' {path}"), /names Python Launcher, a launcher, shell or terminal/);
  A.equal(L.editorRefusal("x".repeat(301)), "it is over 300 characters"); A.equal(L.editorRefusal("subl\n{path}"), "it holds a line break"); A.equal(L.editorRefusal(7), "it is not a command");
  A.equal(L.editorRefusal("subl {path}"), null, "a taken command has no refusal");
  A.deepEqual(L.openerArgv("subl {path}", { path: "/r/env" }).argv, ["subl", "/r/env"], "a clicked file named env is no program (after the path is put in, the program only)");
  A.deepEqual(L.openerArgv("subl {path}", { path: "/r/sh" }).argv, ["subl", "/r/sh"]);
  // Shell-style quoting, no shell: split and joined back to the same argv.
  A.equal(L.editorWords("zed"), "zed"); A.equal(L.editorWords(["a", "b"]), "a b"); A.deepEqual(L.splitCommand(`"/A B/ed" --g '{path}:{line}'`), ["/A B/ed", "--g", "{path}:{line}"]);
  A.equal(L.editorWords(["/Apps/My Ed", "-g", "{path}"]), "'/Apps/My Ed' -g {path}", "an argv array shown quoted");
  A.deepEqual(L.splitCommand(`a\\ b --x="c d" 'it'"'"'s' "q\\"x" ''`), ["a b", "--x=c d", "it's", 'q"x', ""], "backslash, joined pieces, both quotes, an empty argument");
  A.deepEqual(L.splitCommand("  subl   {path}  "), ["subl", "{path}"]); A.deepEqual(L.splitCommand(""), []); A.deepEqual(L.splitCommand(`"open end`), ["open end"], "an unclosed quote runs to the end");
  for (const argv of [["/Apps/My Ed", "-g", "{path}:{line}"], ["a'b", 'c"d', "e\\f", "", "plain"], ["x y", "it's \"both\""]])
    A.deepEqual(L.splitCommand(L.joinCommand(argv)), argv, `joinCommand reads back: ${JSON.stringify(argv)}`);
  A.deepEqual(L.openerArgv(L.joinCommand(["/Apps/My Ed", "-g", "{path}"]), { path: "/r/a.js" }).argv, ["/Apps/My Ed", "-g", "/r/a.js"], "a quoted program keeps its space");

  // ── openerArgv ─────────────────────────────────────────────────────────
  const argv = (s, t) => L.openerArgv(s, t).argv ?? L.openerArgv(s, t).error;
  A.deepEqual(argv("open", { path: "/r/a.js", line: 12, col: 3 }), ["open", "/r/a.js"], "open: the default app, no line");
  A.equal(L.openerArgv("open", { path: "/r/a.md" }).how, "the default app");
  A.deepEqual(argv("open", { path: "/r/X.app" }), ["open", "-R", "/r/X.app"], "an app is revealed, never launched");
  for (const e of ["pkg", "dmg", "jar", "workflow"]) A.deepEqual(argv("open", { path: `/r/x.${e}` }), ["open", "-R", `/r/x.${e}`], `.${e} revealed`);
  for (const e of ["command", "sh", "py", "rb", "terminal", "applescript", "pyc", "pyo", "pyz", "jnlp", "tcl", "exe"]) A.deepEqual(argv("open", { path: `/r/x.${e}` }), ["open", "-t", `/r/x.${e}`], `.${e} as text, never run`);
  for (const e of ["appex", "xpc", "mobileconfig", "shortcut", "xip", "sparseimage", "img"]) A.deepEqual(argv("open", { path: `/r/x.${e}` }), ["open", "-R", `/r/x.${e}`], `.${e} revealed`);
  // Judged by where the path really leads (opener.js realPathOf): a link named notes.md to an app, a .command
  // or a .pyc.
  A.deepEqual(argv("open", { path: "/r/notes.md", real: "/Applications/Calculator.app" }), ["open", "-R", "/r/notes.md"], "a link to an app: revealed");
  A.deepEqual(argv("open", { path: "/r/notes.md", real: "/r/run.command" }), ["open", "-t", "/r/notes.md"], "a link to a .command: as text");
  A.deepEqual(argv("open", { path: "/r/notes.md", real: "/r/x.pyc" }), ["open", "-t", "/r/notes.md"], "a link to a .pyc: as text");
  A.deepEqual(argv("open", { path: "/r/x.app", real: "/r/notes.md" }), ["open", "-R", "/r/x.app"], "a name that says app is revealed whatever it leads to");
  A.deepEqual(argv("open", { path: "/r/notes.md", real: null }), ["open", "-R", "/r/notes.md"], "where it leads not known: revealed");
  A.deepEqual(argv("open", { path: "/r/notes.md", real: "/r/notes.md" }), ["open", "/r/notes.md"], "not a link: the default app");
  A.deepEqual(argv("open {path}", { path: "/r/notes.md", real: "/A/B.app" }), ["open", "-R", "/r/notes.md"], "your own `open {path}` too");
  A.equal(L.usesOpenPreset("open"), true); A.equal(L.usesOpenPreset("open {path}"), true); A.equal(L.usesOpenPreset(["open", "-n", "{path}"]), true);
  A.equal(L.usesOpenPreset("open -a Typora {path}"), false); A.equal(L.usesOpenPreset("open -e {path}"), false); A.equal(L.usesOpenPreset("zed"), false);
  A.equal(L.usesOpenPreset("subl {path}"), false); A.equal(L.usesOpenPreset(""), true, "empty is the default, open");
  A.deepEqual(argv("open", { path: "/r/Makefile", dir: false }), ["open", "-t", "/r/Makefile"], "a file with no extension as text (an executable would run)");
  A.deepEqual(argv("open", { path: "/r/bin", dir: null }), ["open", "-R", "/r/bin"], "no extension, kind unknown: revealed");
  A.deepEqual(argv("open", { path: "/r/bin", dir: true }), ["open", "/r/bin"], "a folder: Finder");
  A.deepEqual(argv("zed", { path: "/r/a.js", line: 12, col: 3 }), ["zed", "/r/a.js:12:3"]); A.deepEqual(argv("zed", { path: "/r/a.js", line: 12 }), ["zed", "/r/a.js:12"]);
  A.deepEqual(argv("zed", { path: "/r/a.js", col: 3 }), ["zed", "/r/a.js"], "a column alone is dropped");
  A.deepEqual(argv("code", { path: "/r/a.js", line: 12, col: 3 }), ["code", "-g", "/r/a.js:12:3"]); A.deepEqual(argv("code", { path: "/r/a.js" }), ["code", "-g", "/r/a.js"]);
  A.equal(L.openerArgv("code", { path: "/r/a.js" }).how, "VS Code"); A.equal(L.openerArgv("zed", { path: "/r/a.js" }).how, "Zed");
  A.deepEqual(argv("subl {path}:{line}:{col}", { path: "/r/a b.js", line: 7, col: 2 }), ["subl", "/r/a b.js:7:2"], "a path with a space stays one argument");
  A.deepEqual(argv("subl {path}:{line}:{col}", { path: "/r/a.js" }), ["subl", "/r/a.js"], "no line: :{line} and :{col} dropped");
  A.deepEqual(argv("subl {path}:{line}:{col}", { path: "/r/a.js", line: 4 }), ["subl", "/r/a.js:4"]);
  A.deepEqual(argv("idea --line {line} {path}", { path: "/r/a.js" }), ["idea", "--line", "1", "/r/a.js"], "a lone {line} with no line: 1");
  A.deepEqual(argv("mate", { path: "/r/a.js" }), ["mate", "/r/a.js"], "no {path}: the path last");
  A.deepEqual(argv(["/Apps/My Ed", "-g", "{path}#L{line}"], { path: "/r/a.js" }), ["/Apps/My Ed", "-g", "/r/a.js"], "an argv array; #L{line} dropped with no line");
  A.deepEqual(argv("open {path}", { path: "/r/x.command" }), ["open", "-t", "/r/x.command"], "your own `open {path}` is the preset, guards included");
  A.deepEqual(argv("open -a Typora {path}", { path: "/r/a.md" }), ["open", "-a", "Typora", "/r/a.md"], "open -a an editor is yours");
  A.equal(L.openerArgv("open -a Terminal {path}", { path: "/r/a.md" }).error, "links.editor is refused: it names a terminal, and ledgr opens none");
  A.match(L.openerArgv("bash -c 'subl {path}'", { path: "/r/a.md" }).error, /bash is a shell/);
  A.match(L.openerArgv("{path}", { path: "/r/a.sh" }).error, /program would be the clicked file/);
  A.match(L.openerArgv("open", { path: "a.js" }).error, /not an absolute path/, "only absolute paths");
  A.match(L.openerArgv("zed", { path: "/r/a\n.js" }).error, /line break/, "never a line break");
  A.match(L.openerArgv("subl {path}", { path: "/r/x" }).how, /^subl$/);

  // ── opener.js ──────────────────────────────────────────────────────────
  const W = path.join(dir, "work");
  fs.mkdirSync(path.join(W, "src"), { recursive: true });
  fs.writeFileSync(path.join(W, "src/app.js"), "x");
  fs.writeFileSync(path.join(W, "Makefile"), "x");
  A.deepEqual(await O.statAt(path.join(W, "src/app.js")), { exists: true, dir: false });
  A.deepEqual(await O.statAt(path.join(W, "src")), { exists: true, dir: true });
  A.deepEqual(await O.statAt(path.join(W, "nope.js")), { exists: false, dir: null });
  A.deepEqual(await O.statAt("relative.js"), { exists: false, dir: null }, "only absolute paths are looked at");
  globalThis.__herdr = { execs: [], execFn: null };
  { const r = await O.openPath(path.join(W, "src/app.js"), "zed", { line: 12, col: 3 });
    A.equal(r.ok, true); A.equal(r.how, "Zed");
    A.deepEqual(H().execs, [["zed", [`${W}/src/app.js:12:3`], { timeout: 5000 }]], "one exec: zed path:line:col, 5 s"); }
  H().execs = [];
  { const r = await O.openPath(path.join(W, "Makefile"), "open"); A.deepEqual(H().execs[0].slice(0, 2), ["open", ["-t", `${W}/Makefile`]], "a file with no extension (stat: a file) as text"); A.equal(r.ok, true); }
  H().execs = [];
  { const r = await O.openPath(path.join(W, "src"), "open"); A.deepEqual(H().execs[0].slice(0, 2), ["open", [`${W}/src`]], "a folder (stat: a folder) in Finder"); A.equal(r.how, "Finder"); }
  // A symbolic link: the open preset judges where it leads (fs.realpath under Node; realpath(1) in Herdr).
  fs.mkdirSync(path.join(W, "Calc.app/Contents"), { recursive: true });
  fs.writeFileSync(path.join(W, "run.command"), "x"); fs.writeFileSync(path.join(W, "mod.pyc"), "x"); fs.writeFileSync(path.join(W, "real.md"), "x");
  fs.symlinkSync(path.join(W, "Calc.app"), path.join(W, "notes.md"));
  fs.symlinkSync(path.join(W, "run.command"), path.join(W, "todo.md"));
  fs.symlinkSync(path.join(W, "mod.pyc"), path.join(W, "readme.txt"));
  fs.symlinkSync(path.join(W, "real.md"), path.join(W, "alias.md"));
  A.equal(await O.realPathOf(path.join(W, "notes.md")), fs.realpathSync(path.join(W, "Calc.app")), "realPathOf follows the link");
  A.equal(await O.realPathOf(path.join(W, "nope.md")), null, "nothing there: null"); A.equal(await O.realPathOf("rel.md"), null); A.equal(await O.realPathOf("/r/a\nb"), null);
  for (const [link, want] of [["notes.md", "-R"], ["todo.md", "-t"], ["readme.txt", "-t"]]) {
    H().execs = [];
    const r = await O.openPath(path.join(W, link), "open");
    A.deepEqual(H().execs.map((e) => e.slice(0, 2)), [["open", [want, `${W}/${link}`]]], `a link ${link}: open ${want}, never launched`); A.equal(r.ok, true);
  }
  H().execs = [];
  { await O.openPath(path.join(W, "alias.md"), "open"); A.deepEqual(H().execs[0].slice(0, 2), ["open", [`${W}/alias.md`]], "a link to a document: the default app"); }
  H().execs = [];
  { await O.openPath(path.join(W, "notes.md"), "zed"); A.deepEqual(H().execs.map((e) => e[0]), ["zed"], "another editor: no realpath asked, the editor only"); }
  H().execs = [];
  { const r = await O.openPath(path.join(W, "gone.js"), "open"); A.deepEqual(r, { ok: false, missing: true, why: "it is not there" }); A.deepEqual(H().execs, [], "nothing run for a path that is not there"); }
  { const r = await O.openPath(path.join(W, "src/app.js"), "bash -c x"); A.equal(r.ok, false); A.match(r.why, /refused/); A.deepEqual(H().execs, [], "nothing run for a refused command"); }
  H().execFn = () => { throw new Error("program not found: zed"); };
  { const r = await O.openPath(path.join(W, "src/app.js"), "zed"); A.equal(r.ok, false); A.match(r.why, /^zed did not start \(is it on your login shell's PATH\?\)$/); }
  H().execFn = () => ({ code: 1, stdout: "", stderr: "The file does not exist.\nmore" });
  { const r = await O.openPath(path.join(W, "src/app.js"), "open"); A.equal(r.ok, false); A.equal(r.why, "The file does not exist."); }
  H().execFn = null; H().execs = [];
  { const r = await O.revealPath(path.join(W, "src/app.js")); A.equal(r.ok, true); A.deepEqual(H().execs, [["open", ["-R", `${W}/src/app.js`], { timeout: 5000 }]], "Reveal: open -R"); }
  A.deepEqual(await O.revealPath("rel"), { ok: false, why: "not an absolute path" });
  H().execs = []; H().execFn = (cmd) => (cmd === "git" ? { code: 0, stdout: `${W}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "" });
  A.equal(await O.gitToplevel(path.join(W, "src")), W); A.deepEqual(H().execs, [["git", ["-C", `${W}/src`, "rev-parse", "--show-toplevel"], { timeout: 5000 }]]);
  H().execFn = () => ({ code: 128, stdout: "", stderr: "not a git repository" }); A.equal(await O.gitToplevel(W), null, "not a checkout: null");
  H().execFn = () => { throw new Error("timed out"); }; A.equal(await O.gitToplevel(W), null);
  A.equal(await O.gitToplevel("rel"), null);

  // As text: links.js imports nothing; opener.js imports exec from herdr and links.js only.
  const ls = fs.readFileSync(path.join(MOD, "links.js"), "utf8"), os_ = fs.readFileSync(path.join(MOD, "opener.js"), "utf8");
  A.ok(!/^import /m.test(ls), "links.js imports nothing (it loads in Node as in Herdr)");
  A.deepEqual([...os_.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]), ["herdr", "fs/promises", "./links.js"], "opener.js imports herdr, fs/promises, links.js");
  A.match(os_, /exec\("realpath", \[path\], \{ timeout: OPEN_TIMEOUT \}\)/, "opener.js: realpath(1) where fs has no realpath (Herdr), with the 5 s limit");

  console.log(`OK: links, ${checks} checks (findPaths on ${YES.length} paths and ${NO.length} false positives, fences, indented code, code spans, links and URLs; linkify round trips; parseLink; resolvePath; links.editor; openerArgv per preset and custom, the open guards; opener.js with a recording exec), 0 failure(s)`);
} catch (e) {
  console.log(String(e?.stack ?? e).split("\n").slice(0, 8).join("\n"));
  console.log(`FAIL: links, after ${checks} checks`);
  process.exitCode = 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
