// ledgr store unit test: event application (Phase 1, ported from the build session's scratchpad
// storetest/test.mjs) and the Phase 2 branch events, manifest, preamble and launch argv; Phase 3:
// conclude, the confluence and answer-sheet messages, confluence_landed, answers_landed, close_branch.
// Writes the composed messages to <folder>/msg-*.txt so test-store.sh can run the hooks' parser on them.
// Pins (docs/design/Pins.md 8.1): the pin events, a question's pins, pins_asked and its Stop, the
// confluence's answeredIn, the search, the words, and the writer's re-anchor of a screen pin; writes
// msg-pins.txt and msg-pins-lead.txt (confluence.js pinsMessage) for test-store.sh, and msg-pins-long.txt (a
// pins message over 45,000 characters, for the parser's scan length).
//   node tests/test_store.mjs <folder holding store.js, branch.js, config.js, confluence.js>   (tests/test-store.sh)
import assert from "node:assert/strict";
import * as fsm from "node:fs";
const dir = process.argv[2];
if (!dir) { console.error("usage: test_store.mjs <module folder>"); process.exit(2); }
// The writer's re-anchor (pins) runs here too: writer.js and spool.js join the copies in <folder>, and
// the stub `herdr` module gains the calls writer.js imports (re-anchoring uses none of them but
// readTextFile, which answers from globalThis.__herdr.files). Done before the first import.
{
  const mod = new URL("../../", import.meta.url).pathname;
  for (const f of ["writer.js", "spool.js"]) if (!fsm.existsSync(`${dir}/${f}`)) fsm.copyFileSync(`${mod}${f}`, `${dir}/${f}`);
  const stub = `${dir}/node_modules/herdr/index.js`;
  const have = fsm.existsSync(stub) ? fsm.readFileSync(stub, "utf8") : "";
  const add = ["setShared", "writeTextFile", "watchFolder", "panes", "exec", "hc", "openOverlay", "home"]
    .filter((k) => have && !new RegExp(`export (const|function|async function) ${k}\\b`).test(have)).map((k) => `export const ${k} = () => null;`);
  if (add.length) fsm.appendFileSync(stub, `\n${add.join("\n")}\n`);
}
const { Store, passageHash, norm, levelOf, isSuggestion, isBlocking, groupOpen, thresholdOf, LEVELS, pinHaystack } = await import(`${dir}/store.js`);
const B = await import(`${dir}/branch.js`);
const CF = await import(`${dir}/confluence.js`);
const CFG = await import(`${dir}/config.js`);
const WORDS = await import(`${dir}/words.js`);
let checks = 0, keep2;
const A = new Proxy(assert, { get: (t, k) => (...a) => { checks++; return t[k](...a); } });

// ── Phase 1 ─────────────────────────────────────────────────────────────
let st = Store.fromText(null);
const SID = "11111111-2222-3333-4444-555555555555", T = "t99";
let n = 0, at = 1793900000000;
const ev = (type, p) => ({ v: 1, id: `e${++n}`, type, at: (at += 1000), terminal: T, session_id: SID, ...p });
const apply = (e) => st.apply(e);
apply(ev("session_start", { agent: "claude-code", source: "startup", model: "m", cwd: "/tmp/x", transcript_path: "/tmp/x.jsonl", session_name: "smoke", repo: "x", turn: 0 }));
apply(ev("prompt", { turn: 1, prompt_id: "p1", local: false, prompt_head: "go", refs: [] }));
const s = st.d.sessions[SID];
A.equal(s.state, "working"); A.equal(s.turn, 1); A.equal(s.agent, "claude-code");
const req = (id, text, quote, extra = {}, sid = SID, turn = 1) => ({ id, key: id, handle: null, direction: "human_to_agent", text, kind: text ? "question" : "bookmark",
  anchor: { sessionId: sid, turn, promptId: "p1", uuid: null, quote, quoteSource: quote ? "clipboard" : undefined, hash: passageHash(quote || text), settled: false, capturedDuring: "working" },
  status: "open", origin: "capture", terminal: T, createdTurn: turn, createdAt: at, updatedAt: at, seq: 0, ...extra });
apply(ev("capture", { turn: 1, agent: "claude-code", request: req("rq_q1", "why stale?", "The legacy API is disabled") }));
apply(ev("capture", { turn: 1, agent: "claude-code", request: req("rq_q1b", "why stale?", null) }));
A.equal(st.items().filter((i) => i.direction === "human_to_agent").length, 1, "double capture dropped");
let chips = st.chips(); A.equal(chips[T].st, "collecting"); A.equal(chips[T].q, 1);
apply(ev("stop", { turn: 1, prompt_id: "p1", text_path: "/tmp/x/turns/1.md", text_head: "…", passage_hash: "abc", message_uuid: "stop-uuid-1" }));
A.equal(st.item("rq_q1").anchor.settled, true);
A.equal(st.item("rq_q1").anchor.uuid, "stop-uuid-1", "stop uuid attached to the turn's items");
apply(ev("pending", { session: SID, turn: 1 }));
A.equal(st.chips(at + 1)[T].p, 1, "pending shows on the chip");
const ask = (text, kind, extra = {}) => ({ text, kind, options: [], recommended: null, blocking: false, quote: null, repeat_of: null, repeat_of_handle: null, hash: passageHash(text), origin: "extract_block", ...extra });
const asks1 = ev("asks", { turn: 1, prompt_id: "p1", message_uuid: null, api_message_id: null, passage_hash: "abc", source: "block",
  asks: [ask("Pick the pool mode", "decide", { options: ["a", "b"], recommended: "a", quote: "Pick the pool mode. I recommend a", hash: passageHash("Pick the pool mode. I recommend a") }), ask("Run the load test", "do", { blocking: true })],
  model: null, usage: null, ms: 3, error: null, block_error: null });
apply(asks1);
A.equal(st.chips(at + 1)[T].p, undefined, "asks clear pending");
const byH = (h, sid = SID) => st.itemsOf(sid).find((i) => i.handle === h);
A.equal(byH("A1").kind, "decide"); A.equal(byH("A1").recommended, "a"); A.equal(byH("A2").blocking, true);
A.equal(byH("A1").anchor.uuid, null, "uuid optional (asks event had none)"); A.ok(byH("A1").anchor.hash);
// A2 is blocking (the legacy `blocking: true`): the chip takes its own state while it is open.
chips = st.chips(); A.equal(chips[T].st, "blocking"); A.equal(chips[T].b, 1); A.equal(chips[T].a, 2); A.equal(chips[T].ag, "claude");
A.equal(byH("A2").level, "blocking", "legacy blocking: true reads as level blocking"); A.equal(byH("A1").level, "needed", "no level: needed");
A.equal(st.apply(asks1).applied, false, "replay of the same event id ignored");
apply({ ...asks1, id: "e-rerun" }); A.equal(st.itemsOf(SID).filter((i) => i.direction === "agent_to_human").length, 2, "same turn+hash dedup");
st.markSeen(SID, at + 1); A.equal(st.chips()[T].st, "blocking", "seen does not hide an open blocking ask");
A.equal(st.chips()[T].st === "blocking" && !st.d.sessions[SID].surfaced, true, "seen: surfaced cleared underneath");
apply(ev("prompt", { turn: 2, prompt_id: "p2", local: false, prompt_head: "[A1] a please. [Q1] also", refs: ["A1", "Q1"] }));
A.equal(byH("A1").status, "answered"); A.equal(byH("Q1").askedAtTurn, 2);
apply(ev("prompt", { turn: 2, prompt_id: "px", local: true, prompt_head: "/btw hi", refs: [] }));
A.equal(st.d.sessions[SID].turn, 2, "local prompt keeps the turn");
apply(ev("stop", { turn: 2, prompt_id: "p2", text_path: "x", text_head: "", passage_hash: "def" }));
A.equal(byH("Q1").status, "answered", "asked question answered at its turn's stop");
apply(ev("asks", { turn: 2, source: "model", asks: [ask("Run the load test.", "do"), ask("pick the pool mode", "decide")] }));
A.equal(byH("A2").lastSeenTurn, 2); A.equal(byH("A2").anchor.turn, 2);
A.equal(byH("A1").status, "open"); A.match(byH("A1").note, /asked again at turn 2/);
A.equal(st.itemsOf(SID).filter((i) => i.direction === "agent_to_human").length, 2);
apply(ev("asks", { turn: 3, source: "model", asks: [ask("Please run the load test", "do", { repeat_of_handle: "A2" })] }));
A.equal(st.itemsOf(SID).filter((i) => i.direction === "agent_to_human").length, 2, "repeat_of_handle matched");
st.act(byH("A2").id, "resolve"); A.equal(byH("A2").resolvedTurn, 2);
apply(ev("asks", { turn: 4, source: "model", asks: [ask("Run the load test", "do")] }));
A.equal(byH("A3").parentId, byH("A2").id);
st.act(byH("A3").id, "dismiss");
apply(ev("asks", { turn: 5, source: "model", asks: [ask("run the load test", "do", { repeat_of: byH("A3").id })] }));
A.equal(byH("A4").status, "open", "dismiss is not permanent across re-raises");
A.equal(byH("A4").repeatOf, byH("A3").id, "raised again marker");
apply(ev("asks", { turn: 6, source: "model", asks: [ask("run the load test", "do")] }));
A.equal(byH("A5"), undefined, "re-ask of the open repeat updates it"); A.equal(byH("A4").lastSeenTurn, 6);
apply(ev("settle", { turn: 1, message_uuid: "uuid-1", api_message_id: "msg_1", passage_hash: "abc" }));
A.equal(st.item("rq_q1").anchor.uuid, "stop-uuid-1", "settle does not overwrite a uuid");
apply(ev("asks", { turn: 7, source: "error", asks: [], error: "no credential" }));
A.equal(st.turnInfo(SID, 7).asks.error, "no credential");
apply(ev("pending", { session: SID, turn: 8 })); A.equal(st.pendingTurn(SID, at + 31000), null);
st.act(byH("A1").id, "defer", at - 1); A.ok(st.wake(at)); A.equal(byH("A1").status, "open");
const snap = st.snapshot(); A.ok(Array.isArray(snap.items)); A.ok(snap.items.every((i) => i.anchor && i.anchor.sessionId === SID && i.handle));
apply(ev("session_end", { turn: 2, reason: "exit" })); A.equal(st.chips()[T], undefined);
const S3 = "herdr:t5";
st.apply({ v: 1, id: "c3", type: "capture", at, terminal: "t5", session_id: S3, agent: "pi", session_name: "pi", request: { ...req("rq_p", "note this", null), anchor: { ...req("rq_p", "note this", null).anchor, sessionId: S3, settled: false } } });
A.equal(st.d.sessions[S3].turnSource, "herdr-status");
A.ok(st.statusTurn(S3, "working", at + 10)); A.ok(st.statusTurn(S3, "idle", at + 5000));
A.equal(st.item("rq_p").anchor.settled, true); A.equal(st.chips().t5.st, "surfaced"); A.equal(st.chips().t5.ag, "pi");
const st2 = Store.fromText(st.toText()); A.equal(Object.keys(st2.d.items).length, Object.keys(st.d.items).length);
A.equal(norm("1. **Run** the  Load test!"), "run the load test");
A.throws(() => Store.fromText("{\"v\":2}"));
const phase1 = checks;

// ── Phase 2: branches ───────────────────────────────────────────────────
st = Store.fromText(null);
const P = "aaaaaaaa-0000-0000-0000-000000000001", PT = "t20";
const pev = (type, p, sid = P, term = PT) => ({ v: 1, id: `p${++n}`, type, at: (at += 1000), terminal: term, session_id: sid, ...p });
st.apply(pev("session_start", { agent: "claude-code", source: "startup", cwd: "/repo", session_name: "trunk", turn: 0 }));
for (let i = 1; i <= 3; i++) {
  st.apply(pev("prompt", { turn: i, prompt_id: `pp${i}`, local: false, prompt_head: `go ${i}`, refs: [] }));
  st.apply(pev("stop", { turn: i, prompt_id: `pp${i}`, text_path: null, text_head: "", passage_hash: `h${i}` }));
}
const QUOTE = "The orders migration finished cleanly on staging,\nso the load test result is likely stale.";
st.apply(pev("capture", { request: { ...req("rq_b1", "Why does the load test still fail?", QUOTE, {}, P, 1), anchor: { ...req("rq_b1", "x", QUOTE, {}, P, 1).anchor, settled: true } } }));
A.equal(st.item("rq_b1").anchor.turn, 1); A.equal(st.d.sessions[P].turn, 3);

// manifest and preamble before launch
let m = B.manifest(st, st.item("rq_b1"), { now: at, maxDepth: 2 });
A.equal(m.anchorTurn, 1); A.equal(m.forkTurn, 3); A.equal(m.later, 2); A.equal(m.depth, 1); A.equal(m.refused, null);
A.deepEqual(m.compactedAfter, []);
const lines = Object.fromEntries(B.manifestLines(m));
A.match(lines.Turns, /sees 2 turns beyond the anchor \(2–3\)/);
A.match(lines.Checkout, /shares \/repo with the parent session/);
A.match(lines.Cache, /only if launched within the cache window/);
A.equal(lines.Compacted, "no compaction recorded");
const pre = B.preamble(st.item("rq_b1"), m, "br-q1-0001");
A.match(pre, /> The orders migration finished cleanly on staging,\n> so the load test result is likely stale\./, "quote kept verbatim, line by line");
A.match(pre, /copied from the end of the session at turn 3, while the question was parked at turn 1, so turns 2 to 3 are included/);
A.match(pre, /say so if those later turns change the answer/);
A.match(pre, /Make NO file edits/); A.match(pre, /shares the main session's checkout/);
A.match(pre, /```ledgr-conclusion\n/);
A.doesNotMatch(pre, /\[[AQ]\d+\]/, "no [Q1]-style refs (the child's prompt must not mark items)");
const words = pre.split("\n").filter((l) => !l.startsWith("> ")).join(" ").split(/\s+/).filter(Boolean).length;
A.ok(words <= 210, `preamble is ${words} words without the quote`);

// branch event -> record + launch
st.maxDepth = 2;
const BID = "br_00000000-aaaa-4bbb-8ccc-000000000001";
let out = st.apply(pev("branch", { item: "rq_b1", branch_id: BID, placement: "split", isolate: false }));
A.deepEqual(out.launch, [BID]);
let br = st.d.branches[BID];
A.equal(br.status, "launching"); A.equal(br.depth, 1); A.equal(br.anchorTurn, 1); A.equal(br.forkTurn, 3); A.equal(br.parentTerminal, PT);
A.match(br.name, /^br-q1-[a-f0-9]{4}$/); A.ok(br.name.length <= 32); A.match(br.childSid, /^[0-9a-f-]{36}$/);
A.equal(st.item("rq_b1").branch.branchId, BID);
A.equal(st.apply(pev("branch", { item: "rq_b1", branch_id: BID })).launch.length, 0, "same branch id twice: one record");
// launch argv
const args = B.hcRunArgs(br, br.manifest, st.item("rq_b1"), "/opt/homebrew/bin/claude");
const dd = args.indexOf("--");
A.deepEqual(args.slice(0, 8), ["run", "--bg", "--json", "--parent", PT, "--outlive-parent", "--no-notify", "--name"]);
A.ok(args.includes("--cwd") && args[args.indexOf("--cwd") + 1] === "/repo");
A.ok(args.includes(`ledgr.branch=${BID}`));
A.deepEqual(args.slice(dd + 1, dd + 4), ["/usr/bin/env", `LEDGR_PARENT=${P}:rq_b1:1`, `LEDGR_BRANCH=${BID}:1:3:${br.childSid}`]);
A.deepEqual(args.slice(dd + 4, dd + 8), ["/opt/homebrew/bin/claude", "--resume", P, "--fork-session"]);
A.deepEqual(args.slice(dd + 8, dd + 10), ["--session-id", br.childSid]);
A.equal(args[args.length - 1], br.preamble, "the preamble is the last (positional) argument");
A.equal(args[args.length - 3], "-n");
// launch result, then the child's hook
A.ok(st.branchLaunched(BID, { terminal: "t21", at: at += 10 }));
A.equal(br.status, "launched"); A.equal(br.terminal, "t21");
const C = br.childSid;
st.apply(pev("session_start", { agent: "claude-code", source: "fork", cwd: "/repo", session_name: br.label, turn: 0 }, C, "t21"));
st.apply(pev("branch_started", { parent_session_id: P, item_id: "rq_b1", anchor_turn: 1, fork_turn: 3, depth: 1, branch_id: BID, source: "fork" }, C, "t21"));
A.equal(br.status, "running"); A.equal(br.sessionId, C); A.equal(br.terminal, "t21");
const cs = st.d.sessions[C];
A.equal(cs.parentSessionId, P); A.equal(cs.depth, 1); A.equal(cs.forkTurn, 3); A.equal(cs.anchorTurn, 1); A.equal(cs.branchId, BID);
A.equal(st.sessionForTerminal("t21"), C); A.equal(st.branchOfSession(C).id, BID);
A.deepEqual(st.branchesOf(P).map((b) => b.id), [BID]); A.equal(st.branchesFor("rq_b1")[0].id, BID);
st.branchLaunched(BID, { terminal: "t99" });
A.equal(br.status, "running", "a late launch result does not downgrade"); A.equal(br.terminal, "t21");
// the branch's own asks belong to the branch session
st.apply(pev("prompt", { turn: 1, prompt_id: "c1", local: false, prompt_head: br.preamble, refs: [] }, C, "t21"));
st.apply(pev("asks", { turn: 1, source: "model", asks: [ask("Confirm the 8443 gateway route", "confirm")] }, C, "t21"));
A.equal(st.itemsOf(C).length, 1); A.ok(st.itemsOf(P).every((i) => i.anchor.sessionId === P), "child asks not in the trunk's lanes");
A.equal(byH("A1", C).anchor.sessionId, C);

// depth: a branch of the branch (2) is allowed, a third level refused at the default cap
st.apply(pev("capture", { request: { ...req("rq_c1", "And port 8443?", null, {}, C, 1), anchor: { ...req("rq_c1", "x", null, {}, C, 1).anchor, settled: true } } }, C, "t21"));
const BID2 = "br_00000000-aaaa-4bbb-8ccc-000000000002";
out = st.apply(pev("branch", { item: "rq_c1", branch_id: BID2 }, C, "t21"));
A.deepEqual(out.launch, [BID2]); A.equal(st.d.branches[BID2].depth, 2);
const C2 = st.d.branches[BID2].childSid;
st.apply(pev("branch_started", { parent_session_id: C, item_id: "rq_c1", anchor_turn: 1, fork_turn: 1, depth: 2, branch_id: BID2 }, C2, "t22"));
A.equal(st.d.sessions[C2].depth, 2);
st.apply(pev("capture", { request: { ...req("rq_d1", "Deeper?", null, {}, C2, 0), anchor: { ...req("rq_d1", "x", null, {}, C2, 0).anchor, settled: true } } }, C2, "t22"));
const BID3 = "br_00000000-aaaa-4bbb-8ccc-000000000003";
out = st.apply(pev("branch", { item: "rq_d1", branch_id: BID3 }, C2, "t22"));
A.deepEqual(out.launch, [], "depth 3 not launched");
A.equal(st.d.branches[BID3].status, "refused");
A.equal(st.d.branches[BID3].error, "depth 3 is beyond branch.maxDepth 2 (ledgr-data/config.json)");
A.equal(st.item("rq_d1").branch, undefined, "a refused request does not badge the item");
st.maxDepth = 5;
A.deepEqual(st.apply(pev("branch", { item: "rq_d1", branch_id: "br_00000000-aaaa-4bbb-8ccc-000000000004" }, C2, "t22")).launch.length, 1, "maxDepth 5 honoured: depth 3 launches");
st.maxDepth = 0;
A.equal(B.manifest(st, st.item("rq_b1"), { maxDepth: 0 }).refused, "depth 1 is beyond branch.maxDepth 0 (ledgr-data/config.json)");
A.equal(B.maxDepthOf({ branch: { maxDepth: "x" } }), 2); A.equal(B.maxDepthOf({}), 2); A.equal(B.maxDepthOf({ branch: { maxDepth: 0 } }), 0); A.equal(B.maxDepthOf({ branch: { maxDepth: 3.7 } }), 3);
st.maxDepth = 2;
A.equal(B.manifest(st, st.item("rq_b1"), { maxDepth: 2, parentLive: false }).refused.startsWith("the parent's terminal t20 is not live"), true);
// branch from a closed question / an agent ask / an unknown session
st.act("rq_b1", "resolve");
A.equal(st.apply(pev("branch", { item: "rq_b1", branch_id: "br_00000000-aaaa-4bbb-8ccc-000000000005" })).launch.length, 0);
A.equal(st.d.branches["br_00000000-aaaa-4bbb-8ccc-000000000005"].error, "the question is closed");
st.act("rq_b1", "reopen");
const askId = byH("A1", C).id;
st.apply(pev("branch", { item: askId, branch_id: "br_00000000-aaaa-4bbb-8ccc-000000000006" }, C, "t21"));
A.equal(st.d.branches["br_00000000-aaaa-4bbb-8ccc-000000000006"].error, "only parked questions can branch");
const before = Object.keys(st.d.sessions).length;
st.apply(pev("branch", { item: "rq_x" }, "bbbbbbbb-unknown", "t30"));
A.equal(Object.keys(st.d.sessions).length, before, "branch for an unknown session creates nothing");

// compaction: after the anchor -> manifest and preamble say so
st.apply(pev("compacted", { turn: 2, trigger: null }));
st.apply(pev("compacted", { turn: 0, trigger: null }));
m = B.manifest(st, st.item("rq_b1"), { now: at, maxDepth: 2 });
A.deepEqual(m.compactedAfter, [2]); A.equal(st.d.sessions[P].compactions.length, 2);
A.match(Object.fromEntries(B.manifestLines(m)).Compacted, /^yes, after the anchor \(turn 2\)/);
A.match(B.preamble(st.item("rq_b1"), m, "x"), /compacted after turn 1 \(at turn 2\)/);
A.equal(B.manifest(st, st.item("rq_b1"), { maxDepth: 2 }).compactionsKnown, 2);

// a fork launched outside the panel (a shell with LEDGR_PARENT): a record of its own
const X = "cccccccc-0000-0000-0000-00000000000x";
st.apply(pev("branch_started", { parent_session_id: P, item_id: "rq_b1", anchor_turn: 1, fork_turn: 3, depth: 1, branch_id: null }, X, "t25"));
const ext = st.branchOfSession(X);
A.ok(ext && ext.external && ext.status === "running" && ext.terminal === "t25" && ext.parentSessionId === P);
// a second fork in the branch's process with the same branch id does not take the record
st.apply(pev("branch_started", { parent_session_id: P, item_id: "rq_b1", anchor_turn: 1, fork_turn: 3, depth: 1, branch_id: BID }, "dddddddd-0000-0000-0000-00000000000d", "t21"));
A.equal(st.d.branches[BID].sessionId, C);

// live status words
A.equal(B.liveStatus(br, [{ address: "t21", status: "working" }], []), "working");
A.equal(B.liveStatus(br, [], [{ address: "t21", state: "live", status: "idle" }]), "idle");
A.equal(B.liveStatus(br, [], [{ address: "t21", state: "finished" }]), "ended");
A.equal(B.liveStatus(br, [], []), "closed");
A.equal(B.liveStatus(st.d.branches[BID3], [], []), "refused");
A.equal(B.liveStatus({ status: "launching" }, [], []), "launching");
A.equal(B.liveStatus({ status: "launched", terminal: "t50" }, [], [{ address: "t50", state: "finished" }]), "nostart", "launched, never reported, gone");
A.equal(B.liveStatus({ status: "launched", terminal: "t50" }, [], [{ address: "t50", state: "live", status: null }]), "starting");
st.d.sessions[keep2 = "ffffffff-0000-0000-0000-00000000000f"] = { sessionId: keep2, agent: "codex", turn: 1, cwd: "/x" };
st.d.items.rq_cx = { id: "rq_cx", direction: "human_to_agent", text: "q", status: "open", anchor: { sessionId: keep2, turn: 1 } };
A.equal(B.manifest(st, st.item("rq_cx"), { maxDepth: 2 }).refused, "branching needs a Claude Code session (claude --resume --fork-session)");
delete st.d.items.rq_cx; delete st.d.sessions[keep2];

// round trip, then forget the trunk: its branches and branch sessions go too, and stay gone
const st3 = Store.fromText(st.toText());
A.equal(Object.keys(st3.d.branches).length, Object.keys(st.d.branches).length);
const keep = "eeeeeeee-0000-0000-0000-00000000000e";
st.apply(pev("session_start", { agent: "claude-code", source: "startup", cwd: "/other", turn: 0 }, keep, "t40"));
st.apply(pev("forget", {}, P, null));
A.equal(st.d.sessions[P], undefined); A.equal(st.d.sessions[C], undefined); A.equal(st.d.sessions[C2], undefined); A.equal(st.d.sessions[X], undefined);
A.ok(st.d.sessions[keep], "other sessions stay");
A.equal(Object.keys(st.d.branches).length, 0); A.equal(st.items().length, 0);
A.equal(st.d.terminals.t20, undefined); A.equal(st.d.terminals.t21, undefined); A.ok(st.d.terminals.t40);
A.ok(st.d.forgotten[P] && st.d.forgotten[C] && st.d.forgotten[C2]);
st.apply(pev("stop", { turn: 4, prompt_id: "late", text_head: "" }));
A.equal(st.d.sessions[P], undefined, "a late hook event does not bring a forgotten session back");
A.equal(st.applyMap({ terminal: "t20", session_id: P, updated_at: at }), false, "nor does the identity map");
A.ok(Store.fromText(st.toText()).d.forgotten[P], "forgotten survives a save");

const phase2 = checks - phase1;

// ── Phase 3: the confluence ─────────────────────────────────────────────
st = Store.fromText(null);
const TR = "aaaaaaaa-3333-0000-0000-000000000001", TT = "t30", CH = "aaaaaaaa-3333-0000-0000-0000000000c1", CT = "t31";
const tev = (type, p, sid = TR, term = TT) => ({ v: 1, id: `c${++n}`, type, at: (at += 1000), terminal: term, session_id: sid, ...p });
st.apply(tev("session_start", { agent: "claude-code", source: "startup", cwd: "/repo", session_name: "trunk3", turn: 0 }));
for (let i = 1; i <= 2; i++) {
  st.apply(tev("prompt", { turn: i, prompt_id: `tp${i}`, local: false, prompt_head: `go ${i}`, refs: [] }));
  st.apply(tev("stop", { turn: i, prompt_id: `tp${i}`, text_path: null, text_head: "", passage_hash: `h${i}` }));
}
st.apply(tev("capture", { request: { ...req("rq_c3", "Is port 8443 still serving the legacy API?", "The legacy API is disabled", {}, TR, 1), anchor: { ...req("rq_c3", "x", "The legacy API is disabled", {}, TR, 1).anchor, settled: true } } }));
st.apply(tev("capture", { request: { ...req("rq_c4", "Unrelated parked question", null, {}, TR, 2), anchor: { ...req("rq_c4", "x", null, {}, TR, 2).anchor, settled: true } } }));
const CB = "br_00000000-cccc-4bbb-8ccc-000000000001";
st.apply(tev("branch", { item: "rq_c3", branch_id: CB, placement: "split" }));
const cb = st.d.branches[CB];
st.branchLaunched(CB, { terminal: CT });
st.apply(tev("branch_started", { parent_session_id: TR, item_id: "rq_c3", anchor_turn: 1, fork_turn: 2, depth: 1, branch_id: CB }, CH, CT));
A.equal(cb.status, "running");
// the branch answers with a conclusion block
const BRMSG = "Checked the gateway config.\n\n```ledgr-conclusion\nanswer: Yes: 8443 is served by the legacy gateway, which still exposes the v1 API.\nchanges: add 8443 to the cutover list\n```";
A.equal(CF.extractConclusion(BRMSG), "answer: Yes: 8443 is served by the legacy gateway, which still exposes the v1 API.\nchanges: add 8443 to the cutover list");
A.equal(CF.extractConclusion("```ledgr-conclusion\nanswer: old\n```\nlater\n```ledgr-conclusion\nanswer: new\n```"), "answer: new", "the last block wins");
A.equal(CF.extractConclusion("no block here"), null); A.equal(CF.extractConclusion("```ledgr-conclusion\n\n```"), null, "an empty block is no conclusion");
A.equal(CF.conclusionHead("answer: Yes: 8443 is served\nchanges: x"), "Yes: 8443 is served");
// the message
const EDITED = "Yes: 8443 is served by the legacy gateway, which still exposes the v1 API.\nchanges: add 8443 to the cutover list (checked by hand)";
const msg = CF.confluenceMessage({ branch: cb, item: st.item("rq_c3"), text: EDITED });
const ml = msg.split("\n");
A.equal(ml[0], `ledgr confluence ${CB} rq_c3`, "first line is exactly the marker");
A.equal(ml[1], "Parked question Q1, from turn 1: Is port 8443 still serving the legacy API?");
A.equal(ml[2], "Conclusion:");
A.equal(ml.slice(3, 5).join("\n"), EDITED, "the edited conclusion verbatim");
A.match(ml[5], /^I am adopting this branch's conclusion as the answer to Q1; the branch \(br-q1-[a-f0-9]{4}, a fork of this conversation\) saw the trunk through turn 2\.$/, "the closing line is the person's assertion");
A.doesNotMatch(msg, /\bTreat\b|\bYou should\b/, "no instruction to the model in the message");
A.equal(CF.leadIn(st.item("rq_c3")), "Adopt this branch result for Q1:");
A.equal(ml.length, 6, "no transcript, no tool output: six lines for a two-line conclusion");
A.ok(CF.wrapperWords(msg, EDITED) < 200, `wrapper is ${CF.wrapperWords(msg, EDITED)} words`);
const longQ = { ...st.item("rq_c3"), text: "why ".repeat(200) };
A.ok(CF.wrapperWords(CF.confluenceMessage({ branch: cb, item: longQ, text: "x" }), "x") < 200, "a long question is clipped under 200 words");
A.doesNotMatch(CF.conclusionRequest(st.item("rq_c3")), /\[[AQ]\d+\]/, "the conclusion request carries no [Q1]-style ref");
A.match(CF.conclusionRequest(st.item("rq_c3")), /```ledgr-conclusion\nanswer:/);
fsm.writeFileSync(`${dir}/msg-confluence.txt`, msg);
// conclude: wrong session and a refused branch are ignored
st.apply(tev("conclude", { branch_id: CB, item: "rq_c3", text: EDITED, message: msg }, CH, CT));
A.equal(cb.status, "running", "a conclude posted against another session does nothing");
let out3 = st.apply(tev("conclude", { branch_id: CB, item: "rq_c3", text: EDITED, message: msg, source: "block", source_turn: 1 }));
A.equal(cb.status, "concluded"); A.equal(st.item("rq_c3").status, "rejoin_pending");
A.equal(cb.conclusion.text, EDITED); A.equal(cb.conclusion.message, msg); A.equal(cb.conclusion.trunkTurn, 2); A.equal(cb.conclusion.source, "block");
A.equal(st.item("rq_c3").rejoin.branchId, CB);
A.equal(st.chips()[TT].q, 1, "rejoin_pending is not counted open on the chip (rq_c4 is)");
A.ok(st.snapshot().items.some((i) => i.id === "rq_c3"), "rejoin_pending stays in the snapshot");
// call off, then conclude again
st.act("rq_c3", "reopen");
A.equal(st.item("rq_c3").status, "open"); A.equal(cb.status, "running", "call off: the branch runs again"); A.equal(cb.conclusion.text, EDITED, "the edit is kept");
A.equal(st.item("rq_c3").rejoin, undefined);
st.apply(tev("conclude", { branch_id: CB, item: "rq_c3", text: EDITED, message: msg, source: "edited" }));
A.equal(cb.status, "concluded"); A.equal(st.item("rq_c3").status, "rejoin_pending");
// the paste lands: prompt first (the hook emits it first), then confluence_landed
st.apply(tev("prompt", { turn: 3, prompt_id: "tp3", local: false, prompt_head: msg, refs: [] }));
A.equal(st.item("rq_c3").askedAtTurn, undefined, "the confluence's question text does not mark the item sent");
out3 = st.apply(tev("confluence_landed", { turn: 3, branch_id: CB, item_id: "rq_c3", prompt_id: "tp3", conclusion_head: "Yes: 8443 is served by the legacy gateway, which still exposes the v1 API." }));
const it3 = st.item("rq_c3");
A.equal(it3.status, "resolved"); A.equal(it3.resolvedBy, "branch"); A.equal(it3.resolvedTurn, 3); A.equal(it3.resolution.branchId, CB); A.equal(it3.rejoin, undefined);
A.equal(cb.status, "rejoined"); A.equal(cb.rejoinedTurn, 3);
A.equal(out3.decisions.length, 1);
const dl = out3.decisions[0];
A.equal(dl.sid, TR); A.equal(dl.key, `(${CB})`); A.match(dl.header, /^# ledgr decisions · trunk3 \(aaaaaaaa-3333/);
A.match(dl.line, /^- \d{4}-\d\d-\d\d \d\d:\d\d · turn 3 · Q1 “Is port 8443 still serving the legacy API\?” → Yes: 8443 is served by the legacy gateway, which still exposes the v1 API\. · branch br-q1-[a-f0-9]{4} \(br_00000000-cccc-4bbb-8ccc-000000000001\)$/);
A.equal(st.item("rq_c4").status, "open", "other parked questions untouched");
// pasted twice: no second decision line, the status stays
out3 = st.apply(tev("confluence_landed", { turn: 4, branch_id: CB, item_id: "rq_c3" }));
A.equal(out3.decisions.length, 0); A.equal(cb.rejoinedTurn, 3); A.equal(cb.landedAgain.turn, 4); A.equal(it3.resolvedTurn, 3);
// landing elsewhere / unknown branch / item mismatch
const OTHER = "aaaaaaaa-3333-0000-0000-0000000000ee";
st.apply(tev("session_start", { agent: "claude-code", source: "startup", cwd: "/repo", turn: 0 }, OTHER, "t39"));
const nb = Object.keys(st.d.branches).length;
out3 = st.apply(tev("confluence_landed", { turn: 1, branch_id: "br_00000000-cccc-4bbb-8ccc-0000000000ff", item_id: "rq_c3" }, OTHER, "t39"));
A.equal(out3.decisions.length, 0); A.equal(Object.keys(st.d.branches).length, nb, "an unknown branch id creates nothing");
st.act("rq_c3", "reopen"); st.apply(tev("conclude", { branch_id: CB, item: "rq_c3", text: EDITED, message: msg }));
A.equal(cb.status, "rejoined", "a rejoined branch does not conclude again");
st.act("rq_c3", "resolve");
st.apply(tev("confluence_landed", { turn: 1, branch_id: CB, item_id: "rq_c4" }));
A.equal(st.item("rq_c4").status, "open", "branch and item ids must match");
// a fresh branch whose confluence is pasted into another session: noted, nothing resolved
const CB2 = "br_00000000-cccc-4bbb-8ccc-000000000002";
st.apply(tev("branch", { item: "rq_c4", branch_id: CB2, placement: "agent" }));
st.apply(tev("branch_started", { parent_session_id: TR, item_id: "rq_c4", anchor_turn: 2, fork_turn: 3, depth: 1, branch_id: CB2 }, "aaaaaaaa-3333-0000-0000-0000000000c2", "t32"));
st.apply(tev("conclude", { branch_id: CB2, item: "rq_c4", text: "no", message: "m" }));
out3 = st.apply(tev("confluence_landed", { turn: 2, branch_id: CB2, item_id: "rq_c4" }, OTHER, "t39"));
A.equal(st.item("rq_c4").status, "rejoin_pending"); A.equal(st.d.branches[CB2].status, "concluded"); A.match(st.d.branches[CB2].note, /submitted in session aaaaaaaa, not its trunk/);
A.equal(out3.decisions.length, 0);
// close_branch: only after rejoin, once
A.deepEqual(st.apply(tev("close_branch", { branch_id: CB2 })).close, [], "not rejoined: no close");
A.deepEqual(st.apply(tev("close_branch", { branch_id: CB }, OTHER, "t39")).close, [], "another session's close: ignored");
A.deepEqual(st.apply(tev("close_branch", { branch_id: CB })).close, [CB]);
A.ok(cb.closeRequestedAt);
A.ok(st.branchClosed(CB, { note: null }));
A.ok(cb.closedAt); A.equal(cb.status, "rejoined", "the record stays rejoined"); A.equal(cb.conclusion.text, EDITED, "with its conclusion");
A.deepEqual(st.apply(tev("close_branch", { branch_id: CB })).close, [], "closed: not again");
st.branchClosed(CB2, { error: "hc kill exited 3" }); A.equal(st.d.branches[CB2].closeError, "hc kill exited 3"); A.equal(st.d.branches[CB2].closedAt, undefined);
A.equal(B.liveStatus(cb, [], []), "closed"); A.equal(B.liveStatus({ ...cb, terminal: null }, [], []), "rejoined");
A.equal(Store.fromText(st.toText()).d.branches[CB].conclusion.text, EDITED, "survives a save");

// the answer sheet: marker, line for the model, A-lines; answers_landed marks the asks answered
st.apply(tev("asks", { turn: 2, source: "model", asks: [ask("Pick the pool mode", "decide", { options: ["a", "b"] }), ask("Run the load test", "do"), ask("Send the account name", "provide")] }));
const a1 = st.byHandle(TR, "A1"), a2 = st.byHandle(TR, "A2"), a3 = st.byHandle(TR, "A3");
st.act(a1.id, "draft", "a, as you recommended."); st.act(a2.id, "draft", "  after the reboot  "); st.act(a3.id, "dismiss");
const sheet = CF.answersSheet(TR, 2, [a1, a2, a3]);
A.equal(sheet, `ledgr answers ${TR}\nAnswers to your asks from turn 2:\nA1: a, as you recommended.\nA2: after the reboot`);
A.equal(CF.answersSheet(TR, 2, [{ ...a3, draft: "" }]), "", "no typed answers: no sheet");
fsm.writeFileSync(`${dir}/msg-answers.txt`, sheet);
// Copy answer: one ask's sheet alone, under the lead-in the panel suggests
const one = CF.answersSheet(TR, 2, [a2]);
A.equal(one, `ledgr answers ${TR}\nAnswers to your asks from turn 2:\nA2: after the reboot`);
A.equal(CF.answersLeadIn(["A2"]), "My answer to A2:"); A.equal(CF.answersLeadIn(["A1", "A2"]), "My answers to A1, A2:");
fsm.writeFileSync(`${dir}/msg-answer-one.txt`, `${CF.answersLeadIn(["A2"])}\n${one}`);
// A multi-line answer (2026-11-11, the dialog's Textarea): its paragraphs joined by one line break, each line
// after the first indented two spaces (its own indentation kept), so the blank line between paragraphs never
// ends the sheet and a line that looks like "A2: ..." stays part of the answer (tests/test-store.sh parses it).
const multi = CF.answersSheet(TR, 2, [{ ...a1, draft: "Transaction pooling.\n\nA2: is not a handle here,\n    just text\n\n" }, a2]);
A.equal(multi, `ledgr answers ${TR}\nAnswers to your asks from turn 2:\nA1: Transaction pooling.\n  A2: is not a handle here,\n      just text\nA2: after the reboot`);
A.deepEqual(CF.answerLines("A3", "  one\r\n\r\n two  \n"), ["A3: one", "   two"], "CRLF, a blank line, trailing spaces");
A.deepEqual(CF.answerLines("A3", " \n "), [], "blank: no lines");
fsm.writeFileSync(`${dir}/msg-answers-multi.txt`, multi);
// A draft keeps its line breaks and is cut at LIMITS.answer (4,000), not at the 400 of an ask's text.
const keepDraft = a2.draft;
st.act(a2.id, "draft", "line\n".repeat(1000)); A.equal(a2.draft.length, 4000, "a draft is cut at LIMITS.answer"); A.ok(a2.draft.startsWith("line\nline\n"), "with its line breaks");
st.act(a2.id, "draft", keepDraft);
// A sheet near the cap (review fix 6, 2026-11-11): six answers of about 3,800 characters, several lines each,
// under the 24,000 one message carries (sheetOverCap null); tests/test-store.sh lands it after the long pins
// message with every answer whole (ledgr_landing.py MAX_SCAN 96,000, MAX_ANSWER 4,000). Over: refused.
const para = (i) => Array.from({ length: 70 }, (_, k) => `Answer ${i}, line ${k}: the pool goes to forty after the cutover.`).join("\n").slice(0, 3800);
const longSheet = CF.answersSheet(TR, 2, Array.from({ length: 6 }, (_, i) => ({ handle: `A${i + 1}`, draft: para(i + 1) })));
A.ok(longSheet.length > 23000 && longSheet.length <= 24000, `the long sheet is just under the cap (${longSheet.length})`);
A.equal(CF.sheetOverCap(longSheet.length), null, "under the cap: staged");
A.equal(CF.sheetOverCap(24000), null, "at the cap: staged");
A.equal(CF.sheetOverCap(25310), "the turn's answers are 25,310 characters, over the 24,000 one message carries: paste fewer at once", "over: the pins' wording");
fsm.writeFileSync(`${dir}/msg-answers-long.txt`, longSheet);
st.apply(tev("prompt", { turn: 5, prompt_id: "tp5", local: false, prompt_head: sheet, refs: [] }));
A.equal(a1.status, "open", "the sheet has no [A1] refs: the prompt alone does not answer");
st.apply(tev("answers_landed", { turn: 5, for_session: OTHER, handles: ["A1"], answers: { A1: "x" } }));
A.equal(a1.status, "open", "a sheet for another session is ignored");
st.apply(tev("answers_landed", { turn: 5, for_session: TR, handles: ["A1", "A2", "A3", "A9"], answers: { A1: "a, as you recommended.", A2: "after the reboot", A3: "late" } }));
A.equal(a1.status, "answered"); A.equal(a1.answer, "a, as you recommended."); A.equal(a1.answeredTurn, 5); A.equal(a1.answeredBy, "sheet");
A.equal(a2.status, "answered"); A.equal(a2.answer, "after the reboot");
// The recorded answer is whole up to LIMITS.answer (4,000; was LIMITS.text, 400), squashed, so a reopened ask's
// draft is compared whole (listing.js draftPending, review fix 4).
const longAns = `${"word ".repeat(700)}\n  and the end`;
st.apply(tev("answers_landed", { turn: 5, for_session: TR, handles: ["A2"], answers: { A2: longAns } }));
A.equal(a2.answer, longAns.replace(/\s+/g, " ").trim(), "a 3,500-character answer recorded whole, squashed"); A.ok(a2.answer.length > 3000);
st.apply(tev("answers_landed", { turn: 5, for_session: TR, handles: ["A2"], answers: { A2: "z".repeat(5000) } }));
A.equal(a2.answer.length, 4000, "cut at LIMITS.answer");
st.apply(tev("answers_landed", { turn: 5, for_session: TR, handles: ["A2"], answers: { A2: "after the reboot" } }));
A.equal(a2.answer, "after the reboot");
A.equal(a3.status, "dismissed", "a dismissed ask stays dismissed");
A.equal(st.byHandle(TR, "Q1").status, "resolved", "answers do not touch questions");
st.apply(tev("asks", { turn: 6, source: "model", asks: [ask("Pick the pool mode", "decide", { options: ["a", "b"] })] }));
A.equal(a1.status, "open", "re-asked later: open again (Phase 1 rule)");

const phase3 = checks - phase1 - phase2;

// ── Severity: level, extract.threshold, suggestions, promote, the blocking chip ─
st = Store.fromText(null);
const V = "dddddddd-5555-0000-0000-000000000001", VT = "t40";
const vev = (type, p) => ({ v: 1, id: `v${++n}`, type, at: (at += 1000), terminal: VT, session_id: V, ...p });
st.apply(vev("session_start", { agent: "claude-code", source: "startup", cwd: "/v", session_name: "sev", turn: 0 }));
st.apply(vev("prompt", { turn: 1, prompt_id: "vp1", local: false, prompt_head: "go", refs: [] }));
st.apply(vev("pending", { turn: 1 }));
st.apply(vev("stop", { turn: 1, prompt_id: "vp1", text_path: null, text_head: "", passage_hash: "v1" }));
A.deepEqual(LEVELS, ["optional", "needed", "blocking"]);
A.equal(st.threshold, "needed", "default threshold");
A.equal(thresholdOf({ extract: { threshold: "Optional " } }), "optional"); A.equal(thresholdOf({ extract: { threshold: "urgent" } }), "needed", "unknown threshold: default");
A.equal(thresholdOf({}), "needed");
// a message with all three levels
st.apply(vev("asks", { turn: 1, source: "model", asks: [
  ask("Add a digest later?", "confirm", { level: "optional" }),
  ask("Test the DM on your machine", "review", { level: "needed" }),
  ask("Grant the app permission", "do", { level: "blocking" }),
  ask("Pick the template", "decide", { options: ["compact", "detailed"] }),   // no level: needed
] }));
const vh = (h) => st.byHandle(V, h);
A.equal(vh("A1").level, "optional"); A.equal(vh("A2").level, "needed"); A.equal(vh("A3").level, "blocking"); A.equal(vh("A4").level, "needed");
A.equal(vh("A3").blocking, true, "blocking follows the level"); A.equal(vh("A2").blocking, false);
A.equal(isSuggestion(vh("A1"), st.threshold), true, "optional is a suggestion at threshold needed");
A.equal(isSuggestion(vh("A2"), st.threshold), false);
A.equal(st.counts(vh("A1")), false, "a suggestion does not count"); A.equal(st.counts(vh("A3")), true);
let vc = st.chips()[VT];
A.equal(vc.a, 3, "the chip counts needed and blocking, not the suggestion"); A.equal(vc.b, 1); A.equal(vc.st, "blocking");
A.equal(vh("A1").status, "open", "a suggestion is stored as an open item");
A.ok(st.snapshot().items.some((i) => i.id === vh("A1").id && i.level === "optional"), "suggestions reach the snapshot (re-raise matching) with their level");
// threshold changes reclassify at once (the writer sets store.threshold from config.json)
st.threshold = "optional"; A.equal(st.chips()[VT].a, 4, "threshold optional: every ask counts");
st.threshold = "blocking"; vc = st.chips()[VT]; A.equal(vc.a, 1, "threshold blocking: only the blocking ask counts"); A.equal(vc.b, 1);
A.equal(isSuggestion(vh("A2"), "blocking"), true, "needed is a suggestion at threshold blocking");
st.threshold = "needed";
// promote: one act, and the item counts whatever the threshold
A.equal(st.act(vh("A1").id, "promote", null, at), true);
A.equal(vh("A1").promoted, true); A.equal(isSuggestion(vh("A1"), "blocking"), false, "a promoted ask is never a suggestion");
A.equal(st.chips()[VT].a, 4);
A.equal(st.act(st.items().find((i) => i.direction === "human_to_agent")?.id ?? "none", "promote"), false, "only agent asks promote");
st.apply(vev("act", { item: vh("A2").id, action: "promote" })); A.equal(vh("A2").promoted, true, "promote arrives as a spool act");
// a re-run of the same turn keeps promoted and takes the new level
st.apply(vev("asks", { turn: 1, source: "model", asks: [ask("Add a digest later?", "confirm", { level: "needed" })] }));
A.equal(vh("A1").level, "needed"); A.equal(vh("A1").promoted, true); A.equal(vh("A5"), null, "same turn and passage: same item");
// the blocking state holds while the agent works (2026-11-06: it no longer yields); resolving the blocker ends it
st.apply(vev("prompt", { turn: 2, prompt_id: "vp2", local: false, prompt_head: "next", refs: [] }));
vc = st.chips()[VT]; A.equal(vc.st, "blocking", "agent working: still the blocking state"); A.equal(vc.w, 1, "working is marked on the chip");
st.apply(vev("stop", { turn: 2, prompt_id: "vp2", text_path: null, text_head: "", passage_hash: "v2" }));
vc = st.chips()[VT]; A.equal(vc.st, "blocking", "idle again with the blocker open"); A.equal(vc.w, undefined, "idle: no w");
st.act(vh("A3").id, "resolve"); vc = st.chips()[VT]; A.equal(vc.b, undefined, "no open blocking ask: no b"); A.notEqual(vc.st, "blocking");
// suggestions alone neither surface the chip nor show it
const W = "eeeeeeee-6666-0000-0000-000000000001", WT = "t41";
const wev = (type, p) => ({ v: 1, id: `w${++n}`, type, at: (at += 1000), terminal: WT, session_id: W, ...p });
st.apply(wev("session_start", { agent: "claude-code", source: "startup", cwd: "/w", session_name: "w", turn: 0 }));
st.apply(wev("prompt", { turn: 1, prompt_id: "wp1", local: false, prompt_head: "go", refs: [] }));
st.apply(wev("stop", { turn: 1, prompt_id: "wp1", text_path: null, text_head: "", passage_hash: "w1" }));
st.apply(wev("asks", { turn: 1, source: "model", asks: [ask("Want me to also add a README section?", "confirm", { level: "optional" })] }));
A.equal(st.d.sessions[W].surfaced, false, "a new suggestion alone does not surface");
A.equal(st.chips()[WT], undefined, "only suggestions: no chip");
st.apply(wev("asks", { turn: 1, source: "model", asks: [ask("Send the tenant id", "provide", { level: "blocking" })] }));
A.equal(st.d.sessions[W].surfaced, true, "a counted ask surfaces"); A.equal(st.chips()[WT].st, "blocking");
// legacy store items (no level) read as needed, or blocking when `blocking` is true
A.equal(levelOf({ direction: "agent_to_human" }), "needed"); A.equal(levelOf({ direction: "agent_to_human", blocking: true }), "blocking");
A.equal(levelOf({ direction: "agent_to_human", level: "bogus", blocking: false }), "needed");
A.equal(isSuggestion({ direction: "human_to_agent", level: "optional" }), false, "parked questions are never suggestions");
A.equal(Store.fromText(st.toText()).d.items[vh("A1").id].promoted, true, "promoted survives a save");
// Resume session (a session whose terminal is gone): the panel's `resume`, the writer's result,
// and the session's SessionStart in the new terminal re-mapping it.
const R = "ffffffff-7777-0000-0000-000000000001";
const rev_ = (type, p, term = "t50") => ({ v: 1, id: `r${++n}`, type, at: (at += 1000), terminal: term, session_id: R, ...p });
st.apply(rev_("session_start", { agent: "claude-code", source: "startup", cwd: "/Users/x/My Repo.v2", session_name: "old", turn: 0 }));
let ro = st.apply(rev_("resume", {}, null));
A.deepEqual(ro.resume, [R], "resume asks the writer to launch"); A.equal(st.d.sessions[R].resume.state, "launching");
A.deepEqual(st.apply(rev_("resume", {}, null)).resume, [], "one launch at a time");
A.deepEqual(st.apply({ v: 1, id: `r${++n}`, type: "resume", at, terminal: null, session_id: "unknown-session" }).resume, [], "an unknown session is not created");
A.ok(st.resumeLaunched(R, { terminal: "t51" })); A.equal(st.d.sessions[R].resume.state, "launched"); A.equal(st.d.sessions[R].resume.terminal, "t51");
st.apply(rev_("session_start", { agent: "claude-code", source: "resume", cwd: "/Users/x/My Repo.v2", session_name: "old", turn: 3 }, "t51"));
A.equal(st.d.sessions[R].resume.state, "resumed"); A.equal(st.d.sessions[R].terminal, "t51", "re-mapped to the new terminal");
A.equal(st.sessionForTerminal("t51"), R);
A.ok(st.resumeLaunched(R, { terminal: "t51" })); A.equal(st.d.sessions[R].resume.state, "resumed", "a late hc reply does not undo resumed");
st.d.sessions[R].resume = { at: at - 120000, state: "launched" };
A.deepEqual(st.apply(rev_("resume", {}, null)).resume, [R], "a launch older than a minute can be tried again");
st.resumeLaunched(R, { error: "transcript gone (/x.jsonl)" }); A.equal(st.d.sessions[R].resume.state, "failed"); A.match(st.d.sessions[R].resume.error, /transcript gone/);
const ra = B.resumeArgs({ sessionId: R, cwd: "/Users/x/My Repo.v2" }, "/opt/claude");
A.deepEqual(ra.slice(0, 5), ["run", "--bg", "--json", "--no-parent", "--no-notify"]);
A.deepEqual(ra.slice(-4), ["--", "/opt/claude", "--resume", R], "claude --resume <sid>, no preamble, no fork");
A.ok(!ra.includes("--parent") && !ra.includes("--fork-session"));
A.equal(ra[ra.indexOf("--cwd") + 1], "/Users/x/My Repo.v2");
A.equal(B.transcriptPathOf({ sessionId: R, cwd: "/Users/x/My Repo.v2" }, "/Users/x"), `/Users/x/.claude/projects/-Users-x-My-Repo-v2/${R}.jsonl`);
A.equal(B.transcriptPathOf({ sessionId: R, transcriptPath: "/t/r.jsonl" }, "/Users/x"), "/t/r.jsonl", "the recorded path wins");
// A session of another Claude config folder (CLAUDE_CONFIG_DIR) resumes and forks with that folder.
const work = { sessionId: R, cwd: "/w", transcriptPath: `/Users/x/.claude-work/projects/-w/${R}.jsonl` };
A.equal(B.configDirOf(work), "/Users/x/.claude-work");
A.equal(B.configDirOf({ transcriptPath: `/Users/x/.claude/projects/-w/${R}.jsonl` }), null, "the default folder adds nothing");
A.equal(B.configDirOf({}), null);
A.deepEqual(B.resumeArgs(work, "/opt/claude").slice(-6), ["--", "/usr/bin/env", "CLAUDE_CONFIG_DIR=/Users/x/.claude-work", "/opt/claude", "--resume", R]);
const fa = B.claudeArgv({ id: "br_x", label: "L", preamble: "P" }, { parentSessionId: R, anchorTurn: 1, forkTurn: 2, depth: 1, configDir: "/Users/x/.claude-work" }, { id: "rq_1" }, "/opt/claude");
A.deepEqual(fa.slice(0, 2), ["/usr/bin/env", "CLAUDE_CONFIG_DIR=/Users/x/.claude-work"], "a fork of it too");
A.equal(B.claudeArgv({ id: "br_x", label: "L", preamble: "P" }, { parentSessionId: R, anchorTurn: 1, forkTurn: 2, depth: 1, configDir: null }, { id: "rq_1" }, "/opt/claude")[1].startsWith("LEDGR_PARENT="), true);
const sev = checks - phase1 - phase2 - phase3;

// ── Profiles: which Claude config a session belongs to (CLAUDE_CONFIG_DIR) ──
A.equal(CFG.agentLabel("claude-code"), "claude"); A.equal(CFG.agentLabel("claude-code", "default"), "claude", "the default profile adds nothing");
A.equal(CFG.agentLabel("claude-code", null), "claude"); A.equal(CFG.agentLabel("claude", "work"), "claude · work");
A.equal(CFG.agentLabel("claude-code", "work"), "claude · work"); A.equal(CFG.agentLabel("codex", " work "), "codex · work");
A.equal(CFG.agentLabel("claude-code", "a-very-long-profile-name"), "claude · a-very-long-prof", "16 characters at most");
st = Store.fromText(null);
const PM = "cccccccc-0000-0000-0000-00000000000a", PD = "cccccccc-0000-0000-0000-00000000000b", MDIR = "/Users/x/.claude-work";
const mev = (type, p, sid, term) => ({ v: 1, id: `m${++n}`, type, at: (at += 1000), terminal: term, session_id: sid, ...p });
st.apply(mev("session_start", { agent: "claude-code", source: "startup", cwd: "/w", session_name: "app", turn: 0, config_dir: MDIR, profile: "work" }, PM, "t70"));
st.apply(mev("session_start", { agent: "claude-code", source: "startup", cwd: "/h", session_name: "homebase", turn: 0, config_dir: "/Users/x/.claude", profile: "default" }, PD, "t71"));
A.equal(st.d.sessions[PM].profile, "work"); A.equal(st.d.sessions[PM].configDir, MDIR);
A.equal(CFG.agentLabel(st.d.sessions[PM].agent, st.d.sessions[PM].profile), "claude · work", "a work session reads claude · work");
A.equal(CFG.agentLabel(st.d.sessions[PD].agent, st.d.sessions[PD].profile), "claude", "the default session reads claude");
st.apply(mev("prompt", { turn: 1, prompt_id: "m1", local: false, prompt_head: "go", refs: [] }, PM, "t70"));
A.equal(st.d.sessions[PM].profile, "work", "an event without a profile keeps the recorded one");
const PO = "cccccccc-0000-0000-0000-00000000000c";
st.apply(mev("session_start", { agent: "claude-code", source: "startup", cwd: "/w", session_name: "older", turn: 0 }, PO, "t72"));
A.equal(st.d.sessions[PO].profile, undefined, "a session from before profiles has none");
A.equal(CFG.agentLabel(st.d.sessions[PO].agent, st.d.sessions[PO].profile), "claude");
st.apply(mev("prompt", { turn: 1, prompt_id: "o1", local: false, prompt_head: "go", refs: [], config_dir: MDIR, profile: "work" }, PO, "t72"));
A.equal(st.d.sessions[PO].profile, "work", "...and picks it up at its next prompt"); A.equal(st.d.sessions[PO].configDir, MDIR);
st.apply(mev("prompt", { turn: 2, prompt_id: "o2", local: true, prompt_head: "/btw x", refs: [], config_dir: MDIR, profile: "work" }, PO, "t72"));
A.equal(st.d.sessions[PO].profile, "work", "a local prompt carries it too");
A.ok(st.applyMap({ terminal: "t73", session_id: "cccccccc-0000-0000-0000-00000000000d", agent: "claude-code", updated_at: at, config_dir: MDIR, profile: "work", turn: 1 }));
A.equal(st.d.sessions["cccccccc-0000-0000-0000-00000000000d"].profile, "work", "the identity map entry seeds it");
A.equal(Store.fromText(st.toText()).d.sessions[PM].profile, "work", "the profile survives a save");
// The branch manifest's Parent line names the profile; Branch and Resume prefer the recorded folder.
const pmItem = { id: "rq_m1", handle: "Q1", direction: "human_to_agent", text: "why?", kind: "question", anchor: { sessionId: PM, turn: 1 }, status: "open" };
st.d.items[pmItem.id] = pmItem;
let mm = B.manifest(st, pmItem, { now: at });
A.equal(mm.parentProfile, "work"); A.equal(mm.configDir, MDIR, "the recorded config folder");
A.match(Object.fromEntries(B.manifestLines(mm)).Parent, /^app \(claude · work\) · pane t70 \(session cccccccc\), depth 0$/);
const pdItem = { ...pmItem, id: "rq_d1", anchor: { sessionId: PD, turn: 0 } };
st.d.items[pdItem.id] = pdItem;
mm = B.manifest(st, pdItem, { now: at });
A.match(Object.fromEntries(B.manifestLines(mm)).Parent, /^homebase \(claude\) · pane t71 /, "the default profile: claude alone");
A.equal(mm.configDir, null, "the default folder adds no CLAUDE_CONFIG_DIR");
A.match(Object.fromEntries(B.manifestLines({ ...mm, parentAgent: undefined, parentProfile: undefined })).Parent, /^homebase · pane t71 /, "a manifest frozen without an agent: no label");
A.equal(B.configDirOf({ configDir: "/Users/x/.claude-alt/", transcriptPath: `/Users/x/.claude-work/projects/-w/${R}.jsonl` }), "/Users/x/.claude-alt", "recorded beats derived");
A.equal(B.configDirOf({ configDir: "/Users/x/.claude", profile: "default", transcriptPath: `/Users/x/.claude-work/projects/-w/${R}.jsonl` }), null, "recorded default: no env");
A.equal(B.configDirOf({ configDir: "", transcriptPath: `/Users/x/.claude-work/projects/-w/${R}.jsonl` }), "/Users/x/.claude-work", "no recorded folder: derived from the transcript path");
A.deepEqual(B.resumeArgs({ sessionId: R, cwd: "/w", configDir: MDIR, profile: "work" }, "/opt/claude").slice(-6), ["--", "/usr/bin/env", `CLAUDE_CONFIG_DIR=${MDIR}`, "/opt/claude", "--resume", R]);
A.equal(B.transcriptPathOf({ sessionId: R, cwd: "/w", configDir: MDIR }, "/Users/x"), `${MDIR}/projects/-w/${R}.jsonl`, "no recorded transcript: under the recorded folder");
// asks.handoff, as the hooks resolve it (bin/lib/ledgr_config.py handoff()).
A.equal(CFG.handoffOf(CFG.DEFAULTS), "ledgr", "the default is ledgr");
A.equal(CFG.handoffOf({ instruct_block: true, asks: { handoff: "both" } }), "both");
A.equal(CFG.handoffOf({ instruct_block: true, asks: { handoff: " Prose " } }), "prose");
A.equal(CFG.handoffOf({ instruct_block: false, asks: { handoff: "ledgr" } }), "prose", "instruct_block false is prose");
A.equal(CFG.handoffOf({ instruct_block: true, asks: { handoff: "bogus" } }), "ledgr", "unknown: ledgr");
A.equal(CFG.handoffOf({ instruct_block: true }), "ledgr", "missing asks: ledgr");
// ui.pasteIntoPrompt (2026-11-06): on by default; the three paste actions read "Paste …" when on and
// keep their older names when off; the words after a staging say whether it was pasted, never sent.
A.equal(CFG.DEFAULTS.ui.pasteIntoPrompt, true, "ui.pasteIntoPrompt defaults on");
A.equal(CFG.DEFAULTS.ui.animations, true, "the other ui defaults are kept");
{
  const on = WORDS.stageLabels(true), off = WORDS.stageLabels(false);
  A.equal(on.one, "Paste answer"); A.equal(on.send, "Paste into trunk"); A.equal(on.again, "Paste confluence again");
  A.equal(on.sheet(2, "t3"), "Paste 2 answers into pane t3"); A.equal(on.sheet(1, null), "Paste 1 answer");
  A.equal(off.one, "Copy answer"); A.equal(off.send, "Send to trunk"); A.equal(off.again, "Copy confluence again");
  A.equal(off.sheet(2, "t3"), "Copy 2 answers for pane t3");
  const w = { what: "Answer for Ask 2", where: "pane t3", lead: "My answer to A2:", word: "idle" };
  A.match(WORDS.stagedWords({ pasted: true, ms: 100 }, w), /^Answer for Ask 2 pasted into the prompt in pane t3, not sent: add a word of your own, such as “My answer to A2:”, then press Enter\.$/);
  A.match(WORDS.stagedWords({ pasted: true }, { ...w, word: "working" }), /not sent \(working: press Enter once it is idle/);
  A.match(WORDS.stagedWords({ pasted: false, why: "focus" }, w), /^Answer for Ask 2 copied; nothing was pasted \(the focus did not reach pane t3 in time\): paste with ⌘V in the pane/);
  A.match(WORDS.stagedWords({ pasted: false, why: "off" }, w), /^Answer for Ask 2 copied and pane t3 focused: type “My answer to A2:”, then ⌘V, Enter\.$/, "off: the older wording");
  for (const why of ["gone", "plain", "blocked", "clipboard", "error"]) {
    const t = WORDS.stagedWords({ pasted: false, why, error: "x" }, w);
    A.ok(!/pasted into the prompt/.test(t) && /not pasted|nothing was pasted|not live/.test(t), `${why}: says nothing was pasted: ${t}`);
  }
}
const prof = checks - phase1 - phase2 - phase3 - sev;

// ── Asks declared by tool (bin/mcp declare_asks: source "tool") ─────────
st = Store.fromText(null);
const KS = "dddddddd-0000-0000-0000-00000000000a", KT = "t80";
const kev = (type, p) => ({ v: 1, id: `k${++n}`, type, at: (at += 1000), terminal: KT, session_id: KS, ...p });
st.apply(kev("session_start", { agent: "claude-code", source: "startup", cwd: "/w", session_name: "tool", turn: 0 }));
st.apply(kev("prompt", { turn: 1, prompt_id: "k1", local: false, prompt_head: "go", refs: [] }));
const kAsk = (text, level, extra = {}) => ({ text, kind: "decide", level, options: [], recommended: null, blocking: level === "blocking",
  quote: null, repeat_of: null, repeat_of_handle: null, hash: passageHash(text), origin: "tool", quote_verified: null, ...extra });
st.apply(kev("asks", { turn: 1, prompt_id: "k1", message_uuid: null, passage_hash: null, source: "tool", provider: "mcp", replaces_turn: false, tool_call: 1,
  quotes: "unverified", asks: [kAsk("Choose the retry policy", "blocking", { options: ["fast", "safe"], recommended: "safe", quote: "I stopped here.", quote_verified: false, hash: passageHash("I stopped here.") }),
    kAsk("Paste the staging token", "needed", { kind: "provide" }), kAsk("Pick a release name", "needed")] }));
const kv = (h) => st.byHandle(KS, h);
A.equal(kv("A1").origin, "tool"); A.equal(WORDS.originWords(kv("A1").origin), "declared by the agent (tool)", "the panel's words for a tool ask");
A.equal(kv("A1").anchor.quoteSource, "tool_unverified", "a quote not yet checked"); A.deepEqual(kv("A1").options, ["fast", "safe"]);
A.equal(st.d.sessions[KS].surfaced, false, "mid-turn: the chip does not surface while the agent works");
A.equal(st.chips()[KT].o, "tool", "the chip knows the asks were declared by tool");
st.apply(kev("act", { item: kv("A3").id, action: "draft", arg: "maybe 'harbor'" }));
// A second call of the same turn: the whole list. A2 is withdrawn (untouched: it goes), A3 is withdrawn but drafted (stays).
st.apply(kev("asks", { turn: 1, prompt_id: "k1", source: "tool", provider: "mcp", replaces_turn: true, tool_call: 2, quotes: "unverified",
  asks: [kAsk("Choose the retry policy", "blocking", { options: ["fast", "safe"], recommended: "safe", quote: "I stopped here.", quote_verified: false, hash: passageHash("I stopped here.") }),
    kAsk("Confirm the cutover window", "needed", { kind: "confirm" })] }));
A.equal(kv("A1").text, "Choose the retry policy", "a re-declared ask keeps its handle");
A.equal(kv("A2"), null, "replaces_turn: an untouched ask the new list no longer has is dropped");
A.ok(kv("A3"), "...one the person drafted an answer for stays"); A.equal(kv("A4").text, "Confirm the cutover window", "a new one gets the next handle");
// The turn ends: pending, then the Stop hook's re-emit (verified quotes, the message uuid, no options key: the item keeps its own).
st.apply(kev("pending", { turn: 1, passage_hash: "pp" }));
A.ok(st.d.sessions[KS].pending, "pending set at Stop");
const kSettle = { turn: 1, prompt_id: "k1", message_uuid: "uuid-tool-1", passage_hash: "pp", source: "tool", provider: "mcp", replaces_turn: true, quotes: "verified",
  asks: [{ ...kAsk("Choose the retry policy", "blocking", { quote: "I stopped here.", quote_verified: true, hash: passageHash("I stopped here.") }) },
    { ...kAsk("Confirm the cutover window", "needed", { kind: "confirm" }) }] };
delete kSettle.asks[0].options; delete kSettle.asks[0].recommended; delete kSettle.asks[1].options; delete kSettle.asks[1].recommended;
st.apply(kev("asks", kSettle));
A.equal(kv("A1").anchor.quoteSource, "tool", "settled: the quote checked against the turn's text");
A.equal(kv("A1").anchor.uuid, "uuid-tool-1", "settled: the message uuid"); A.deepEqual(kv("A1").options, ["fast", "safe"], "options kept when the re-emit has none");
A.equal(kv("A1").recommended, "safe"); A.equal(st.d.sessions[KS].pending, undefined, "the turn's own asks event clears pending");
A.equal(st.d.sessions[KS].surfaced, true, "the turn ended with tool asks: the chip surfaces");
A.equal(Object.values(st.d.items).filter((it) => it.anchor?.sessionId === KS).length, 3, "no duplicates after the settle (A1, A3, A4)");
const kQuoteless = { ...kSettle, id: undefined, asks: [{ ...kSettle.asks[0], quote: null, quote_verified: null, hash: passageHash("Choose the retry policy") }, kSettle.asks[1]] };
st.apply(kev("asks", kQuoteless));
A.equal(Object.values(st.d.items).filter((it) => it.anchor?.sessionId === KS).length, 3, "a quote dropped at Stop (unverified) still matches its item");
st.apply(kev("asks", { turn: 1, source: "tool", provider: "mcp", replaces_turn: true, tool_call: 3, asks: [] }));
A.equal(kv("A1"), null, "an empty later declaration clears the turn's untouched tool asks"); A.ok(kv("A3"), "...the drafted one stays");
const toolChecks = checks - phase1 - phase2 - phase3 - sev - prof;

// ── Blocking while working, who closed an ask (the agent's resolve_asks), answered then settled ─
st = Store.fromText(null);
const G = "gggggggg-7777-0000-0000-000000000001", GT = "t90";
const gev = (type, p) => ({ v: 1, id: `g${++n}`, type, at: (at += 1000), terminal: GT, session_id: G, ...p });
const gh = (h) => st.byHandle(G, h);
const gturn = (turn, asks, extra = {}) => {   // one whole turn: prompt, pending, stop, the turn's asks
  st.apply(gev("prompt", { turn, prompt_id: `gp${turn}`, local: false, prompt_head: extra.head ?? "go", refs: extra.refs ?? [] }));
  st.apply(gev("pending", { turn }));
  st.apply(gev("stop", { turn, prompt_id: `gp${turn}`, text_path: null, text_head: "", passage_hash: `g${turn}` }));
  if (asks) st.apply(gev("asks", { turn, source: extra.source ?? "model", asks }));
};
st.apply(gev("session_start", { agent: "claude-code", source: "startup", cwd: "/g", session_name: "settle", turn: 0 }));
gturn(1, [ask("Grant the keychain access", "do", { level: "blocking" }), ask("Pick the log format", "decide", { level: "needed" }),
  ask("Name the release", "provide", { level: "needed" })]);
// 1. the chip: blocking whether or not the agent works, and over collecting
let gc = st.chips()[GT]; A.equal(gc.st, "blocking"); A.equal(gc.b, 1); A.equal(gc.w, undefined);
st.apply(gev("prompt", { turn: 2, prompt_id: "gp2", local: false, prompt_head: "carry on", refs: [] }));
gc = st.chips()[GT]; A.equal(gc.st, "blocking", "a prompt does not hide the blocker"); A.equal(gc.w, 1); A.equal(gc.b, 1); A.equal(gc.a, 3);
st.apply(gev("capture", { turn: 2, agent: "claude-code", request: req("rq_gq1", "is the cache warm?", null, {}, G, 2) }));
gc = st.chips()[GT]; A.equal(gc.st, "blocking", "blocking wins over collecting"); A.equal(gc.q, 1, "the parked question still counts");
st.apply(gev("pending", { turn: 2 }));
st.apply(gev("stop", { turn: 2, prompt_id: "gp2", text_path: null, text_head: "", passage_hash: "g2" }));
st.apply(gev("asks", { turn: 2, source: "model", asks: [] }));
gc = st.chips()[GT]; A.equal(gc.st, "blocking"); A.equal(gc.w, undefined, "idle: no w");
// 2. the fold rule (panel.js groupOpen): newest open; a group holding an open blocking ask open too; the person's click wins
A.equal(groupOpen({ newest: true }), true, "the newest group is open"); A.equal(groupOpen({}), false, "an older group folds");
A.equal(groupOpen({ blocking: 1 }), true, "an older group with an open blocker stays open");
A.equal(groupOpen({ blocking: 1, folded: true }), false, "the person's fold wins over a blocker");
A.equal(groupOpen({ newest: true, folded: true }), false, "...and over the newest rule");
A.equal(groupOpen({ unfolded: true }), true, "the person's unfold wins");
const blockersAt = (turn) => st.itemsOf(G).filter((it) => it.anchor?.turn === turn && it.status === "open" && isBlocking(it) && !isSuggestion(it, st.threshold)).length;
A.equal(groupOpen({ newest: false, blocking: blockersAt(1) }), true, "turn 1 (not the newest group) holds the blocker: open");
// 3. the agent's resolve_asks: act events with actor "agent" and a handle, one per handle
A.equal(WORDS.resolvedByWords("agent"), "closed by the agent"); A.equal(WORDS.resolvedByWords("answer"), "answered by you");
A.equal(WORDS.resolvedByWords("branch"), "resolved by its branch"); A.equal(WORDS.resolvedByWords(undefined), null, "the person's Done: no words");
st.apply(gev("act", { item: null, handle: "A1", action: "dismiss", actor: "agent", arg: null }));
A.equal(gh("A1").status, "open", "the agent may only resolve");
st.apply(gev("act", { item: null, handle: "Q1", action: "resolve", actor: "agent", arg: null }));
A.equal(gh("Q1").status, "open", "the agent does not close a parked question");
st.apply(gev("act", { item: null, handle: "A1", action: "resolve", actor: "agent", arg: null }));
A.equal(gh("A1").status, "resolved", "resolved by handle"); A.equal(gh("A1").resolvedBy, "agent"); A.equal(gh("A1").resolvedTurn, 2);
gc = st.chips()[GT]; A.equal(gc.b, undefined, "the agent closed the blocker: no b"); A.notEqual(gc.st, "blocking");
st.apply(gev("act", { item: gh("A2").id, handle: "A2", action: "resolve", arg: null, actor: "agent", turn: 2, note: "  Took JSON,\n as the repo already logs it " }));
A.equal(gh("A2").resolvedBy, "agent", "by item id too"); A.equal(gh("A2").resolvedTurn, 2, "the event's turn");
A.equal(gh("A2").resolvedNote, "Took JSON, as the repo already logs it", "the agent's note, one line");
st.apply(gev("act", { item: gh("A2").id, action: "reopen" }));
A.equal(gh("A2").status, "open"); A.equal(gh("A2").resolvedBy, undefined, "reopened: who closed it goes"); A.equal(gh("A2").resolvedNote, undefined, "...and why");
st.apply(gev("act", { item: gh("A2").id, action: "resolve" }));
A.equal(gh("A2").status, "resolved"); A.equal(gh("A2").resolvedBy, undefined, "the person's Done has no resolvedBy");
st.apply(gev("act", { item: null, handle: "A2", action: "resolve", actor: "agent" }));
A.equal(gh("A2").resolvedBy, undefined, "already closed by the person: the agent does not relabel it");
st.apply(gev("act", { item: gh("A3").id, action: "resolve", actor: "robot" }));
A.equal(gh("A3").status, "resolved", "an unknown actor is the person"); A.equal(gh("A3").resolvedBy, undefined);
st.apply(gev("act", { item: gh("A3").id, action: "reopen" }));
st.apply({ ...gev("act", { item: null, handle: "A3", action: "resolve", actor: "agent" }), session_id: "nobody-0000" });
A.equal(gh("A3").status, "open", "another (unknown) session's handle: nothing");
A.equal(Store.fromText(st.toText()).d.items[gh("A1").id].resolvedBy, "agent", "resolvedBy survives a save");
// 4. answered, then settled at the turn's asks event
gturn(3, [ask("Choose the cache size", "decide", { level: "needed" }), ask("Send the staging URL", "provide", { level: "needed" })]);
gturn(4, [], { head: "[A3] go ahead. [A4] 512 MB", refs: ["A3", "A4"] });   // A3 reopened above; A4 is the cache size
A.equal(gh("A4").answeredTurn, 4, "an [A4] ref records the turn it was answered");
A.equal(gh("A4").status, "resolved", "answered at turn 4, not raised again by turn 4's reply: settled"); A.equal(gh("A4").resolvedBy, "answer");
A.equal(gh("A4").answer, "[A3] go ahead. [A4] 512 MB", "the answer stays on the item"); A.equal(gh("A3").resolvedBy, "answer");
gturn(5, [ask("Send the staging URL", "provide", { level: "needed" })], { head: "[A5] later", refs: ["A5"] });
A.equal(gh("A5").status, "open", "answered, then raised again by the same turn's reply: open in place");
A.match(gh("A5").note, /asked again at turn 5/); A.equal(gh("A6"), null, "...not a new item");
// a mid-turn declaration does not settle; the Stop re-emit does
st.apply(gev("prompt", { turn: 6, prompt_id: "gp6", local: false, prompt_head: "ledgr answers …", refs: [] }));
st.apply(gev("answers_landed", { turn: 6, for_session: G, handles: ["A5"], answers: { A5: "https://staging.example" } }));
A.equal(gh("A5").status, "answered"); A.equal(gh("A5").answeredTurn, 6);
st.apply(gev("asks", { turn: 6, source: "tool", provider: "mcp", tool_call: 1, replaces_turn: false, asks: [kAsk("Rotate the token", "needed")] }));
A.equal(gh("A5").status, "answered", "a mid-turn tool call does not settle");
st.apply(gev("pending", { turn: 6 }));
st.apply(gev("asks", { turn: 6, source: "tool", provider: "mcp", replaces_turn: true, asks: [kAsk("Rotate the token", "needed")] }));
A.equal(gh("A5").status, "resolved", "the Stop re-emit settles it"); A.equal(gh("A5").resolvedBy, "answer");
A.equal(gh("A6").status, "open", "the new tool ask is untouched");
// an answer given after the turn whose asks arrive late (or a re-run of an older turn) waits for its own turn
st.apply(gev("prompt", { turn: 7, prompt_id: "gp7", local: false, prompt_head: "[A6] done", refs: ["A6"] }));
st.apply(gev("asks", { turn: 6, id: "g-late6", source: "model", asks: [] }));
A.equal(gh("A6").status, "answered", "turn 6's late asks do not settle an answer from turn 7");
st.apply(gev("stop", { turn: 7, prompt_id: "gp7", text_path: null, text_head: "", passage_hash: "g7" }));
st.apply(gev("asks", { turn: 7, source: "error", asks: [], error: "no credential" }));
A.equal(gh("A6").status, "answered", "an extraction error says nothing: still answered");
st.apply(gev("asks", { turn: 7, source: "skip", asks: [] }));
A.equal(gh("A6").status, "resolved", "a reply too short to extract raised nothing: settled"); A.equal(gh("A6").resolvedBy, "answer");
// parked questions the agent answered keep their status; a legacy answered ask (no answeredTurn) settles
A.equal(gh("Q1").status, "open");
st.apply(gev("prompt", { turn: 8, prompt_id: "gp8", local: false, prompt_head: "[Q1] about the cache", refs: ["Q1"] }));
st.apply(gev("stop", { turn: 8, prompt_id: "gp8", text_path: null, text_head: "", passage_hash: "g8" }));
A.equal(gh("Q1").status, "answered", "the question was asked and answered at its turn's stop");
const legacy = st.d.items[gh("A2").id]; legacy.status = "answered"; legacy.answer = "old"; delete legacy.answeredTurn;
st.apply(gev("asks", { turn: 1, id: "g-rerun1", source: "model", asks: [] }));
A.equal(legacy.status, "answered", "no answeredTurn: a re-run of the ask's own turn does not settle it");
st.apply(gev("asks", { turn: 8, source: "model", asks: [] }));
A.equal(gh("Q1").status, "answered", "a parked question is not settled by the sweep");
A.equal(legacy.status, "resolved", "an answered ask from before answeredTurn settles"); A.equal(legacy.resolvedBy, "answer");
A.equal(st.snapshot().items.some((i) => i.id === gh("A4").id), false, "a settled ask leaves the snapshot");
gturn(9, [ask("choose the cache size", "decide", { level: "needed" })]);
A.equal(gh("A7").status, "open", "the agent asking a settled ask again: a new item"); A.equal(gh("A7").parentId, gh("A4").id, "...pointing at the settled one");
const settleChecks = checks - phase1 - phase2 - phase3 - sev - prof - toolChecks;

// ── Spaces where ledgr is off (config.json spaces.disabled) ─────────────
// The config helpers (config.js): the default, the list as read, the switch the session menu writes,
// a terminal's live space (its agent's, else its herdr.space label), loadConfig replacing the list whole.
A.deepEqual(CFG.DEFAULTS.spaces, { disabled: [] }, "spaces.disabled: none by default");
A.deepEqual(CFG.disabledSpaces({ spaces: { disabled: ["spA", "", 3, null, "spA", "spB"] } }), ["spA", "spB"], "strings only, each once");
A.deepEqual(CFG.disabledSpaces({}), []); A.deepEqual(CFG.disabledSpaces({ spaces: { disabled: "spA" } }), [], "not a list: none");
A.equal(CFG.spaceOff({ spaces: { disabled: ["spA"] } }, "spA"), true); A.equal(CFG.spaceOff({ spaces: { disabled: ["spA"] } }, "spB"), false);
A.equal(CFG.spaceOff({ spaces: { disabled: ["spA"] } }, null), false, "an unknown space is on");
A.deepEqual(CFG.withSpaceOff({ spaces: { disabled: ["spA"] } }, "spB", true), ["spA", "spB"], "off: added");
A.deepEqual(CFG.withSpaceOff({ spaces: { disabled: ["spA"] } }, "spA", true), ["spA"], "off twice: once");
A.deepEqual(CFG.withSpaceOff({ spaces: { disabled: ["spA", "spB"] } }, "spA", false), ["spB"], "on: removed, the others kept");
A.deepEqual(CFG.withSpaceOff({}, "spA", true), ["spA"], "a config without spaces");
globalThis.__herdr = { agents: [{ address: "t60", space: "spLive" }, { address: "t63", space: "" }],
  terminals: [{ address: "t61", labels: { "herdr.space": "spLabel" } }, { address: "t63", labels: { "herdr.space": "spL3" } }, { address: "t64" }] };
A.equal(CFG.terminalSpace("t60"), "spLive", "an agent's space"); A.equal(CFG.terminalSpace("t61"), "spLabel", "else the herdr.space label");
A.equal(CFG.terminalSpace("t63"), "spL3", "an agent with no space: the label"); A.equal(CFG.terminalSpace("t64"), null); A.equal(CFG.terminalSpace("t65"), null);
A.equal(CFG.terminalSpace(null), null);
// The capture box's rule (capture.js): over a pane in a disabled space ⌘J parks nothing.
A.equal(CFG.spaceOff({ spaces: { disabled: ["spLive"] } }, CFG.terminalSpace("t60")), true, "⌘J over t60 in a disabled space: refused");
A.equal(CFG.spaceOff({ spaces: { disabled: ["spLive"] } }, CFG.terminalSpace("t61")), false, "...over t61 elsewhere: parks");
globalThis.__herdr.files = { "/tmp/nowhere/ledgr-data/config.json": JSON.stringify({ spaces: { disabled: ["spA"] }, extract: { threshold: "blocking" } }) };
let lc = await CFG.loadConfig();
A.deepEqual(lc.spaces.disabled, ["spA"], "loadConfig: the file's list replaces the default whole"); A.equal(lc.extract.provider, "anthropic", "...other defaults merged");
globalThis.__herdr.files = {};
lc = await CFG.loadConfig(); A.deepEqual(lc.spaces.disabled, [], "no file: none off");

// The store: the hooks' recorded space (map record, events) on the session and the terminal mapping;
// chips() leaves out a terminal in a disabled space (recorded, else live); items are kept.
st = Store.fromText(null);
const SPA = "99999999-0000-0000-0000-00000000000a", SPB = "99999999-0000-0000-0000-00000000000b", SPC = "99999999-0000-0000-0000-00000000000c";
const spev = (type, p, sid, term) => ({ v: 1, id: `s${++n}`, type, at: (at += 1000), terminal: term, session_id: sid, ...p });
st.applyMap({ v: 1, terminal: "t60", session_id: SPA, agent: "claude-code", updated_at: at, turn: 0, state: "idle", space: "spOff" });
A.equal(st.d.sessions[SPA].space, "spOff", "the map record's space on the session"); A.equal(st.d.terminals.t60.space, "spOff", "...and on the mapping");
st.apply(spev("session_start", { agent: "claude-code", source: "startup", cwd: "/a", turn: 0 }, SPA, "t60"));
A.equal(st.d.terminals.t60.space, "spOff", "an event without `space` keeps the recorded one"); A.equal(st.d.sessions[SPA].space, "spOff");
st.apply(spev("session_start", { agent: "claude-code", source: "startup", cwd: "/b", turn: 0 }, SPB, "t61"));
st.apply(spev("session_start", { agent: "claude-code", source: "startup", cwd: "/c", turn: 0, space: "spOn" }, SPC, "t62"));
A.equal(st.d.sessions[SPC].space, "spOn", "an event's space is recorded"); A.equal(st.d.terminals.t62.space, "spOn");
A.equal(st.d.sessions[SPB].space, undefined, "nothing recorded");
for (const [sid, term, id] of [[SPA, "t60", "rq_sa"], [SPB, "t61", "rq_sb"], [SPC, "t62", "rq_sc"]]) {
  st.apply(spev("capture", { request: { ...req(id, `question ${id}`, null, {}, sid, 0), anchor: { ...req(id, "x", null, {}, sid, 0).anchor, settled: true } } }, sid, term));
}
const spLive = (t) => ({ t61: "spOff" }[t] ?? null);
A.deepEqual(Object.keys(st.chips(at, spLive)).sort(), ["t60", "t61", "t62"], "nothing off: every chip");
st.spacesOff = new Set(["spOff"]);
A.deepEqual(Object.keys(st.chips(at, spLive)).sort(), ["t62"], "t60 (recorded) and t61 (live) are in the disabled space: no chip");
A.deepEqual(Object.keys(st.chips(at)).sort(), ["t61", "t62"], "no live answer: an unknown space is on");
A.equal(st.isOff("t60", st.d.sessions[SPA]), true); A.equal(st.isOff("t62", st.d.sessions[SPC], spLive), false);
A.equal(st.itemsOf(SPA).length, 1, "the off session's items are kept"); A.equal(st.item("rq_sa").status, "open");
A.equal(st.spaceOf("t60", st.d.sessions[SPA], () => "spElse"), "spOff", "the recorded space wins over the live one");
// a map record rewritten by the hooks (the writer's watch: noteSpace) moves t60 out of the disabled space
A.equal(st.noteSpace({ terminal: "t60", session_id: SPA, space: "spOn" }), true);
A.equal(st.noteSpace({ terminal: "t60", session_id: SPA, space: "spOn" }), false, "unchanged: false");
A.equal(st.noteSpace({ terminal: "t60", session_id: SPA }), false, "a record without `space`: nothing");
A.equal(st.d.sessions[SPA].space, "spOn"); A.ok(st.chips(at, spLive).t60, "on again: its chip comes back, with its item");
A.equal(st.chips(at, spLive).t60.q, 1);
// the hooks could not tell (space null): the live answer decides
st.apply(spev("prompt", { turn: 1, prompt_id: "sp1", local: false, prompt_head: "go", refs: [], space: null }, SPC, "t62"));
A.equal(st.d.terminals.t62.space, null); A.equal(st.d.sessions[SPC].space, null);
A.equal(st.spaceOf("t62", st.d.sessions[SPC], () => "spOff"), "spOff", "recorded unknown: the live space");
A.equal(st.chips(at, () => "spOff").t62, undefined, "...which is off: no chip");
A.equal(Store.fromText(st.toText()).d.sessions[SPA].space, "spOn", "the space survives a save");
st.spacesOff = new Set();

// ── Clear all questions (the questions lane's Clear N) ─────────────────
const CQ = "99999999-0000-0000-0000-0000000000cc", CQT = "t70";
const cev = (type, p) => ({ v: 1, id: `q${++n}`, type, at: (at += 1000), terminal: CQT, session_id: CQ, ...p });
st.apply(cev("session_start", { agent: "claude-code", source: "startup", cwd: "/q", session_name: "clear", turn: 0 }));
st.apply(cev("prompt", { turn: 1, prompt_id: "cq1", local: false, prompt_head: "go", refs: [] }));
st.apply(cev("stop", { turn: 1, prompt_id: "cq1", text_path: null, text_head: "", passage_hash: "cq" }));
const cq = (id, text) => st.apply(cev("capture", { request: { ...req(id, text, null, {}, CQ, 1), anchor: { ...req(id, text, null, {}, CQ, 1).anchor, settled: true } } }));
for (const [id, text] of [["rq_k1", "open question"], ["rq_k2", "deferred question"], ["rq_k3", "branched question"], ["rq_k4", "rejoin question"],
  ["rq_k5", "answered question"], ["rq_k6", "question whose branch failed"], ["rq_k7", "question already done"]]) cq(id, text);
st.act("rq_k2", "defer", "next_session");
st.apply(cev("branch", { item: "rq_k3", branch_id: "br_00000000-dddd-4bbb-8ccc-000000000001", placement: "split" }));
A.equal(st.d.branches["br_00000000-dddd-4bbb-8ccc-000000000001"].status, "launching");
st.apply(cev("branch", { item: "rq_k6", branch_id: "br_00000000-dddd-4bbb-8ccc-000000000006", placement: "split" }));
st.branchLaunched("br_00000000-dddd-4bbb-8ccc-000000000006", { error: "hc run exited 1" });
const k4 = st.item("rq_k4"); k4.status = "rejoin_pending"; k4.rejoin = { branchId: "br_gone", at };
st.setStatus(st.item("rq_k5"), "answered", at); st.act("rq_k7", "resolve");
st.apply(cev("asks", { turn: 1, source: "model", asks: [ask("Pick a port", "decide", { level: "needed" })] }));
A.equal(st.isBranched(st.item("rq_k3")), true); A.equal(st.isBranched(st.item("rq_k4")), true, "rejoin_pending: branched");
A.equal(st.isBranched(st.item("rq_k6")), false, "a failed launch is no branch"); A.equal(st.isBranched(st.item("rq_k1")), false);
const cl = st.clearable(CQ);
A.deepEqual(cl.clear.map((i) => i.id).sort(), ["rq_k1", "rq_k2", "rq_k6"], "open and deferred, no branch");
A.deepEqual(cl.kept.map((i) => i.id).sort(), ["rq_k3", "rq_k4"], "branched and rejoin_pending kept");
A.equal(WORDS.clearLabel(3), "Clear 3"); A.equal(WORDS.clearConfirm(3, 2), "Clear 3 questions? 2 branched kept");
A.equal(WORDS.clearConfirm(1, 0), "Clear 1 question?", "nothing kept: no kept part");
A.equal(WORDS.clearedWords(3, 2), "3 questions cleared, 2 branched kept"); A.equal(WORDS.clearedWords(1), "1 question cleared");
A.equal(WORDS.dismissedByWords("clear"), "cleared"); A.equal(WORDS.dismissedByWords(undefined), null, "Not needed by hand: no label");
A.equal(WORDS.OFF_HERE, "ledgr is off in this space");
A.equal(WORDS.spaceToggleWords(false), "ledgr off in this space"); A.equal(WORDS.spaceToggleWords(true), "ledgr on in this space");
const askBefore = st.byHandle(CQ, "A1").status;
const clearAt = at + 1000;
st.apply(cev("clear_questions", { keep: ["branched", "rejoin_pending"] }));
for (const id of ["rq_k1", "rq_k2", "rq_k6"]) {
  const it = st.item(id);
  A.equal(it.status, "dismissed", id); A.equal(it.dismissedBy, "clear", id); A.equal(it.clearedAt, clearAt, id); A.equal(it.resolvedAt, clearAt, id);
}
A.equal(st.item("rq_k2").deferUntil, undefined, "a cleared deferred question no longer waits");
A.equal(st.item("rq_k3").status, "open", "branched: kept"); A.equal(st.item("rq_k4").status, "rejoin_pending", "rejoin_pending: kept");
A.equal(st.item("rq_k5").status, "answered", "answered: untouched"); A.equal(st.item("rq_k7").status, "resolved"); A.equal(st.item("rq_k7").dismissedBy, undefined);
A.equal(st.byHandle(CQ, "A1").status, askBefore, "agent asks untouched");
A.deepEqual(st.d.sessions[CQ].lastClear, { at: clearAt, cleared: 3, kept: 2 });
A.equal(st.clearable(CQ).clear.length, 0, "nothing left to clear");
// Reopen one: open again, the marks go; a second clear takes it, whatever `keep` says
st.act("rq_k1", "reopen");
A.equal(st.item("rq_k1").status, "open"); A.equal(st.item("rq_k1").dismissedBy, undefined); A.equal(st.item("rq_k1").clearedAt, undefined);
st.apply(cev("clear_questions", { keep: [] }));
A.equal(st.item("rq_k1").dismissedBy, "clear"); A.equal(st.item("rq_k3").status, "open", "keep [] still keeps a branched question");
st.act("rq_k1", "dismiss"); A.equal(st.item("rq_k1").dismissedBy, undefined, "Not needed by hand: not labelled cleared");
// the panel's own event: never creates a session, a forgotten or unknown one is dropped
const nSess = Object.keys(st.d.sessions).length;
st.apply({ ...cev("clear_questions", {}), session_id: "99999999-0000-0000-0000-0000000000ff" });
A.equal(Object.keys(st.d.sessions).length, nSess, "an unknown session: nothing created");
// Closed, the archive and the snapshot treat them as dismissed items
A.ok(st.archivable(0, at + 1).some((i) => i.id === "rq_k2"), "a cleared question archives like other dismissed items");
A.ok(st.snapshot(at).items.some((i) => i.id === "rq_k2" && i.dismissedBy === "clear"), "recent: in the snapshot, as dismissed items are");
A.equal(Store.fromText(st.toText()).item("rq_k6").dismissedBy, "clear", "survives a save");
const spaceChecks = checks - phase1 - phase2 - phase3 - sev - prof - toolChecks - settleChecks;

// ── Pins (docs/design/Pins.md 8.1) ──────────────────────────────────────
st = Store.fromText(null);
const PS = "pppppppp-0000-0000-0000-000000000001", PST = "t95", PS2 = "bbbbbbbb-1111-0000-0000-000000000002", PST2 = "t96";
const piev = (type, p, sid = PS, term = PST) => ({ v: 1, id: `pi${++n}`, type, at: (at += 1000), terminal: term, session_id: sid, ...p });
let pnN = 0;
const pinId = () => `pn_00000000-0000-4000-8000-${String(++pnN).padStart(12, "0")}`;
// A `pin` event as the box writes it (7.4): the anchor's hash left out unless given, so the store computes it.
const pinEv = (text, o = {}, sid = PS, term = PST) => piev("pin", { agent: o.agent ?? "claude-code", turn: o.turn ?? 1, session_name: o.session_name, cwd: o.cwd,
  pin: { id: o.id ?? pinId(), text, note: o.note ?? null, createdTurn: o.turn ?? 1, createdAt: at + 1000,
    anchor: { sessionId: sid, terminal: term, turn: o.turn ?? 1, uuid: null, promptId: null, hash: o.hash, quoteSource: o.quoteSource ?? "clipboard",
      verified: o.verified === undefined ? "turn" : o.verified, settled: o.settled ?? true, approx: o.approx ?? false } } }, sid, term);
const pp = (h, sid = PS) => st.pinByHandle(sid, h);
st.apply(piev("session_start", { agent: "claude-code", source: "startup", cwd: "/src/gateway", session_name: "gateway", repo: "gateway", turn: 0,
  config_dir: "/Users/x/.claude-work", profile: "work" }));
st.apply(piev("prompt", { turn: 1, prompt_id: "pp1", local: false, prompt_head: "go", refs: [] }));
st.apply(piev("stop", { turn: 1, prompt_id: "pp1", text_path: null, text_head: "", message_uuid: "uuid-p1" }));
// 1. a pin: P1, verbatim text, note squashed, source from the session, the turn record's uuid
const T1 = "  The gateway retries each request at most twice,\r\nand only on 502 and 503.\r\n\r\n    Anything else surfaces to the caller at once.  ";
const P1T = "The gateway retries each request at most twice,\nand only on 502 and 503.\n\n    Anything else surfaces to the caller at once.";
st.apply(pinEv(T1, { note: "  the   key\n constraint  " }));
const p1 = pp("P1");
A.ok(p1, "a pin is P1 of its session"); A.equal(p1.text, P1T, "verbatim: CRLF to LF, outer whitespace trimmed, line breaks and inner spacing kept");
A.equal(p1.anchor.hash, passageHash(P1T), "hash = passageHash(text)"); A.equal(p1.note, "the key constraint", "the note squashed");
A.deepEqual(p1.source, { sessionName: "gateway", repo: "gateway", cwd: "/src/gateway", agent: "claude-code", profile: "work", configDir: "/Users/x/.claude-work" }, "provenance from the session");
A.equal(p1.anchor.uuid, "uuid-p1", "settled: the turn record's uuid"); A.equal(p1.anchor.terminal, PST); A.equal(p1.anchor.turn, 1);
A.equal(p1.anchor.verified, "turn"); A.equal(p1.anchor.settled, true); A.equal(p1.anchor.approx, false); A.equal(p1.anchor.quoteSource, "clipboard");
A.equal(p1.status, "open"); A.deepEqual(p1.usedIn, []); A.deepEqual(p1.answeredIn, []); A.equal(p1.clipped, undefined); A.equal(p1.sessionId, PS);
A.equal(st.d.sessions[PS].nextHandle.P, 2);
st.apply(pinEv("x".repeat(4500), { note: "n".repeat(300) }));
A.equal(pp("P2").text.length, 4000, "cut at LIMITS.pin"); A.equal(pp("P2").clipped, true); A.equal(pp("P2").note.length, 200, "the note cut at LIMITS.pinNote");
let nPins = Object.keys(st.d.pins).length;
st.apply(pinEv("a valid passage", { id: "pn_short" }));
st.apply(pinEv("   \r\n  "));
st.apply(pinEv("another passage", { id: p1.id }));
A.equal(Object.keys(st.d.pins).length, nPins, "a bad id, an empty passage, an id already there: no pin");
// 2. the same passage again: one pin per passage per session
st.apply(pinEv(T1, { note: "second note" }));
A.equal(Object.keys(st.d.pins).length, nPins, "the same passage again: no second pin"); A.equal(p1.note, "the key constraint", "a note it has is kept"); A.ok(p1.repinnedAt);
st.apply(pinEv("Pooling is per client.", {}));
st.apply(pinEv("  Pooling   is per client.  ", { note: "late note" }));
A.equal(pp("P3").note, "late note", "...a pin without a note takes the new one"); A.equal(pp("P4"), null);
st.apply(piev("pin_archive", { pin: pp("P3").id }));
A.equal(pp("P3").status, "archived"); A.ok(pp("P3").archivedAt);
st.apply(pinEv("Pooling is per client."));
A.equal(pp("P3").status, "open", "pinned again: an archived pin is restored"); A.equal(pp("P3").archivedAt, undefined); A.equal(pp("P4"), null);
// 3. a session the store does not know is created (as capture does); a herdr:<t> one takes its own turn, approx
st.apply(pinEv("The cache warms in ten minutes.", { session_name: "billing-api", cwd: "/src/billing", turn: 40 }, PS2, PST2));
const pB = pp("P1", PS2);
A.ok(st.d.sessions[PS2], "a pin creates its session"); A.ok(pB); A.equal(pB.source.sessionName, "billing-api"); A.equal(pB.source.cwd, "/src/billing"); A.equal(pB.anchor.turn, 40);
A.equal(st.d.sessions[PS2].nextHandle.P, 2);
st.apply(pinEv("A passage read off a screen.", { turn: 9, verified: "screen" }, "herdr:t97", "t97"));
const ph = pp("P1", "herdr:t97");
A.equal(st.d.sessions["herdr:t97"].turnSource, "herdr-status"); A.equal(ph.anchor.turn, st.d.sessions["herdr:t97"].turn, "no hooks: the session's turn");
A.equal(ph.anchor.approx, true, "...approx"); A.equal(ph.createdTurn, ph.anchor.turn);
const PS3 = "pppppppp-0000-0000-0000-000000000003";
st.apply(piev("session_start", { agent: "claude-code", source: "startup", cwd: "/f", session_name: "gone", turn: 0 }, PS3, "t98"));
st.apply(pinEv("Kept before forgetting.", {}, PS3, "t98"));
const kept = pp("P1", PS3);
st.apply(piev("forget", {}, PS3, null));
A.ok(st.pin(kept.id), "Forget keeps the session's pins"); A.equal(kept.source.sessionName, "gone", "...with their source");
st.apply(pinEv("Pinned after forgetting.", {}, PS3, "t98"));
A.equal(st.pinsOfSession(PS3).length, 1, "a pin for a forgotten session is dropped"); A.equal(st.d.sessions[PS3], undefined, "...and brings no session back");
// 4. pin_note, pin_archive, pin_restore, pin_delete by pin id, whatever became of the session
let ev4 = piev("pin_note", { pin: kept.id, note: "  still   here " }, PS3, null);
st.apply(ev4);
A.equal(st.pin(kept.id).note, "still here", "pin_note for a forgotten session's pin"); A.ok(st.d.ingested.includes(ev4.id), "its event id is ingested");
st.apply(piev("pin_archive", { pin: kept.id }, "not-in-the-store", null));
A.equal(st.pin(kept.id).status, "archived", "pin_archive with a session the store does not know"); A.equal(st.d.sessions["not-in-the-store"], undefined, "...creates none");
st.apply(piev("pin_restore", { pin: kept.id }, PS3, null)); A.equal(st.pin(kept.id).status, "open", "pin_restore");
st.apply(piev("pin_delete", { pin: kept.id }, PS3, null)); A.ok(st.pin(kept.id), "pin_delete leaves an open pin");
st.apply(piev("pin_archive", { pin: kept.id }, PS3, null)); st.apply(piev("pin_delete", { pin: kept.id }, PS3, null));
A.equal(st.pin(kept.id), null, "pin_delete removes an archived pin");
st.apply(piev("pin_note", { pin: pp("P3").id, note: "" })); A.equal(pp("P3").note, null, "an empty note clears it");
st.apply(piev("pin_note", { pin: pp("P3").id, note: "x".repeat(250) })); A.equal(pp("P3").note.length, 200);
st.apply(piev("pin_note", { pin: "pn_00000000-0000-4000-8000-999999999999", note: "x" })); A.equal(st.pin("pn_00000000-0000-4000-8000-999999999999"), null, "an unknown pin: nothing");
// 5. capture with request.pins: validated, never trusted; usedIn once per question
const many = [];
for (let i = 0; i < 12; i++) { st.apply(pinEv(`Fact ${i} about retries.`)); many.push(st.pinsIn(PS)[0].id); }
const QP1 = "Does the retry budget still hold once the gateway pools connections?";
st.apply(piev("capture", { request: { ...req("rq_pq1", QP1, null, {}, PS, 1), anchor: { ...req("rq_pq1", "x", null, {}, PS, 1).anchor, settled: true },
  pins: [p1.id, "pn_00000000-0000-4000-8000-0000000000ff", p1.id, pB.id, ...many], askedVia: "pins", pinsAsked: { turn: 99 } } }));
const pq1 = st.item("rq_pq1");
A.deepEqual(pq1.pins, [p1.id, pB.id, ...many.slice(0, 10)], "known ids, each once, in the order given, LIMITS.pinsPerQuestion at most");
A.equal(pq1.askedVia, undefined); A.equal(pq1.pinsAsked, undefined, "a Request cannot say it was asked");
A.equal(p1.usedIn.length, 1); A.equal(p1.usedIn[0].question, "rq_pq1"); A.equal(p1.usedIn[0].handle, pq1.handle); A.equal(p1.usedIn[0].head, QP1.slice(0, 80));
A.equal(p1.usedIn[0].session, PS); A.equal(pB.usedIn.length, 1, "another session's pin records the question too");
A.equal(st.pin(many[11]).usedIn.length, 0, "a pin cut by the limit is not used");
A.deepEqual(st.pinsOf(pq1).map((p) => p.id), pq1.pins, "pinsOf: the question's order");
st.apply(piev("capture", { request: { ...req("rq_pq2", "A spoofed list", null, {}, PS, 1), pins: ["pn_00000000-0000-4000-8000-0000000000ff", 7, null, "rq_pq1"] } }));
A.equal("pins" in st.item("rq_pq2"), false, "a pins list that names no pin leaves no field");
st.apply(piev("pin_archive", { pin: pp("P2").id }));
st.apply(piev("capture", { request: { ...req("rq_pq3", "Is the clipped one still right?", null, {}, PS, 1), pins: [pp("P2").id, p1.id] } }));
A.deepEqual(st.item("rq_pq3").pins, [pp("P2").id, p1.id], "an archived pin can be attached");
// 6. pins_asked: in the question's own session; in another; for an unknown item or an agent ask
st.apply(piev("prompt", { turn: 2, prompt_id: "pp2", local: false, prompt_head: `ledgr pins ${PS} rq_pq1`, refs: [] }));
st.apply(piev("pins_asked", { turn: 2, for_session: PS, item_id: "rq_pq1", prompt_id: "pp2" }));
A.equal(pq1.askedAtTurn, 2); A.equal(pq1.askedVia, "pins"); A.equal(pq1.pinsAsked.turn, 2); A.equal(pq1.pinsAsked.promptId, "pp2"); A.ok(pq1.pinsAsked.at);
A.equal(pq1.status, "open", "sent, not yet answered");
st.apply(piev("pins_asked", { turn: 41, for_session: PS, item_id: "rq_pq3", prompt_id: "x" }, PS2, PST2));
A.equal(st.item("rq_pq3").note, `the pins message for ${st.item("rq_pq3").handle} was sent in session bbbbbbbb, not its own; nothing marked`);
A.equal(st.item("rq_pq3").askedAtTurn, undefined); A.equal(st.item("rq_pq3").pinsAsked, undefined, "...nothing else");
st.apply(piev("pins_asked", { turn: 2, for_session: PS2, item_id: "rq_pq3" }));
A.equal(st.item("rq_pq3").pinsAsked, undefined, "a marker naming another session: nothing marked");
const itemsBefore = JSON.stringify(st.d.items);
st.apply(piev("pins_asked", { turn: 2, for_session: PS, item_id: "rq_nope" }));
A.equal(JSON.stringify(st.d.items), itemsBefore, "an unknown item: nothing");
// 7. the asked turn's Stop: answered, each pin answeredIn via trunk; replayed, nothing more
st.apply(piev("stop", { turn: 2, prompt_id: "pp2", text_path: null, text_head: "", message_uuid: "uuid-p2" }));
A.equal(pq1.status, "answered", "answered at the end of the turn it was asked in"); A.ok(pq1.pinsAsked.answeredAt);
for (const p of st.pinsOf(pq1)) {
  const a = p.answeredIn.filter((x) => x.question === "rq_pq1");
  A.equal(a.length, 1, `${p.handle}: one answeredIn`); A.equal(a[0].via, "trunk"); A.equal(a[0].turn, 2); A.equal(a[0].session, PS); A.equal(a[0].handle, pq1.handle);
}
st.apply(piev("stop", { turn: 2, prompt_id: "pp2", text_path: null, text_head: "" }));
A.equal(p1.answeredIn.length, 1, "the same Stop replayed adds nothing");
// an interrupted turn adds nothing; pasted again, pinsAsked moves to the new turn
st.apply(piev("capture", { request: { ...req("rq_pq4", "And for idempotent calls?", null, {}, PS, 2), anchor: { ...req("rq_pq4", "x", null, {}, PS, 2).anchor, settled: true }, pins: [p1.id] } }));
st.apply(piev("prompt", { turn: 3, prompt_id: "pp3", local: false, prompt_head: "…", refs: [] }));
st.apply(piev("pins_asked", { turn: 3, for_session: PS, item_id: "rq_pq4", prompt_id: "pp3" }));
A.ok(st.interrupted(PS), "the person interrupts turn 3");
st.apply(piev("prompt", { turn: 4, prompt_id: "pp4", local: false, prompt_head: "go on", refs: [] }));
st.apply(piev("stop", { turn: 4, prompt_id: "pp4", text_path: null, text_head: "" }));
A.equal(p1.answeredIn.some((x) => x.question === "rq_pq4"), false, "an interrupted turn adds nothing"); A.equal(st.item("rq_pq4").status, "open");
st.apply(piev("prompt", { turn: 5, prompt_id: "pp5", local: false, prompt_head: "…", refs: [] }));
st.apply(piev("pins_asked", { turn: 5, for_session: PS, item_id: "rq_pq4", prompt_id: "pp5" }));
A.equal(st.item("rq_pq4").pinsAsked.turn, 5, "a second landing moves pinsAsked"); A.equal(st.item("rq_pq4").pinsAsked.answeredAt, undefined);
st.apply(piev("stop", { turn: 5, prompt_id: "pp5", text_path: null, text_head: "" }));
A.equal(st.item("rq_pq4").status, "answered"); A.equal(p1.answeredIn.filter((x) => x.question === "rq_pq4" && x.turn === 5).length, 1);
// 8. a screen pin taken while the agent works: settled and given the uuid at the Stop; the writer
// finds its passage in an earlier saved turn and moves it there (or leaves it approx when nowhere)
st.apply(piev("settle", { turn: 4, message_uuid: "uuid-p4" }));
st.apply(piev("prompt", { turn: 6, prompt_id: "pp6", local: false, prompt_head: "…", refs: [] }));
st.apply(pinEv("Retries back off by 200 ms, then 800 ms.", { turn: 6, verified: "screen", settled: false }));
const sp = st.pinsIn(PS)[0];
A.equal(sp.anchor.settled, false); A.equal(sp.anchor.uuid, null, "unsettled: no uuid yet"); A.equal(sp.anchor.verified, "screen");
let so = st.apply(piev("stop", { turn: 6, prompt_id: "pp6", text_path: null, text_head: "", message_uuid: "uuid-p6" }));
A.equal(sp.anchor.settled, true, "settled at the Stop"); A.equal(sp.anchor.uuid, "uuid-p6", "...with the stop's uuid"); A.deepEqual(so.settle.map((x) => x.turn), [6]);
const turnFile = (t) => `/tmp/nowhere/ledgr-data/turns/${PS}/${t}.md`;
globalThis.__herdr = { files: { [turnFile(6)]: "Nothing about back-off here.", [turnFile(5)]: "Still nothing.",
  [turnFile(4)]: "First: **Retries** back off by `200 ms`,\nthen 800 ms.\n\nThat is all." } };
const WR = await import(`${dir}/writer.js`);
A.deepEqual(WR.ENGINE_FILES, ["config.js", "store.js", "spool.js", "writer.js", "branch.js", "confluence.js"], "no new engine file");
const wr = new WR.Writer("test");
wr.live = st;
await wr.reanchor(so.settle[0]);
A.equal(sp.anchor.turn, 4, "re-anchored to the turn that holds the passage"); A.equal(sp.anchor.reanchoredFrom, 6); A.equal(sp.anchor.approx, false);
A.equal(sp.anchor.reanchored, true); A.equal(sp.anchor.uuid, "uuid-p4", "...and that turn's uuid");
st.apply(piev("prompt", { turn: 7, prompt_id: "pp7", local: false, prompt_head: "…", refs: [] }));
st.apply(pinEv("Words that are in no saved turn at all.", { turn: 7, verified: "screen", settled: false }));
const sp2 = st.pinsIn(PS)[0];
so = st.apply(piev("stop", { turn: 7, prompt_id: "pp7", text_path: null, text_head: "" }));
await wr.reanchor(so.settle[0]);
A.equal(sp2.anchor.turn, 7, "not found: it stays"); A.equal(sp2.anchor.approx, true, "...approx"); A.equal(sp2.anchor.reanchored, true);
A.equal(p1.anchor.reanchored, undefined, "a pin found in a saved turn is never re-anchored");
globalThis.__herdr = {};
// 9. a branch of a question with pins: the preamble carries every passage verbatim (branch.js), the
// manifest counts them, and a question with more pinned characters than a preamble carries is refused
st.maxDepth = 2;
st.apply(piev("capture", { request: { ...req("rq_pb", "Is the retry budget per client or per pool?", null, {}, PS, 7), anchor: { ...req("rq_pb", "x", null, {}, PS, 7).anchor, settled: true }, pins: [p1.id, pB.id] } }));
const BRP = "br_00000000-pppp-4bbb-8ccc-000000000001";
let bo = st.apply(piev("branch", { item: "rq_pb", branch_id: BRP, placement: "split" }));
const pbr = st.d.branches[BRP];
A.deepEqual(bo.launch, [BRP]); A.equal(pbr.status, "launching");
for (const p of [p1, pB]) for (const l of p.text.split("\n")) A.ok(pbr.preamble.split("\n").includes(l.trim() ? `> ${l}` : ">"), `the preamble quotes ${p.handle} verbatim: ${l}`);
A.match(pbr.preamble, /^pin 1: /m, "the conclusion block asks for one line per pin"); A.match(pbr.preamble, /^pin 2: /m);
A.equal(pbr.manifest.pins.total, 2, "the manifest counts the pins"); A.equal(pbr.manifest.pins.here, 1); A.equal(pbr.manifest.pins.other, 1);
A.deepEqual(pbr.pins, [p1.id, pB.id], "the record keeps the pin ids the preamble numbered");
const bigs = [];
for (let i = 0; i < 7; i++) { st.apply(pinEv(`Long passage ${i}: `.padEnd(3600, "z"))); bigs.push(st.pinsIn(PS)[0].id); }
st.apply(piev("capture", { request: { ...req("rq_pbig", "Do all of these still hold?", null, {}, PS, 7), anchor: { ...req("rq_pbig", "x", null, {}, PS, 7).anchor, settled: true }, pins: bigs } }));
A.equal(st.pinsOf(st.item("rq_pbig")).reduce((k, p) => k + p.text.length, 0), 25200);
bo = st.apply(piev("branch", { item: "rq_pbig", branch_id: "br_00000000-pppp-4bbb-8ccc-000000000002" }));
A.deepEqual(bo.launch, [], "25,200 pinned characters: not launched");
A.equal(st.d.branches["br_00000000-pppp-4bbb-8ccc-000000000002"].status, "refused"); A.match(st.d.branches["br_00000000-pppp-4bbb-8ccc-000000000002"].error, /over the 24,000/);
// 10. the confluence of a question with pins lands: each pin answeredIn via branch, once per branch
const PCH = "pppppppp-0000-0000-0000-0000000000c1";
st.branchLaunched(BRP, { terminal: "t99" });
st.apply(piev("branch_started", { parent_session_id: PS, item_id: "rq_pb", anchor_turn: 7, fork_turn: 7, depth: 1, branch_id: BRP }, PCH, "t99"));
st.apply(piev("conclude", { branch_id: BRP, item: "rq_pb", text: "answer: per client", message: "m", source: "edited" }));
st.apply(piev("prompt", { turn: 8, prompt_id: "pp8", local: false, prompt_head: "…", refs: [] }));
st.apply(piev("confluence_landed", { turn: 8, branch_id: BRP, item_id: "rq_pb", prompt_id: "pp8" }));
A.equal(st.item("rq_pb").status, "resolved"); A.equal(st.item("rq_pb").resolvedBy, "branch");
for (const p of [p1, pB]) {
  const a = p.answeredIn.filter((x) => x.question === "rq_pb");
  A.equal(a.length, 1); A.equal(a[0].via, "branch"); A.equal(a[0].branch, BRP); A.equal(a[0].branchName, pbr.name); A.equal(a[0].turn, 8); A.equal(a[0].session, PS);
}
st.apply(piev("confluence_landed", { turn: 9, branch_id: BRP, item_id: "rq_pb" }));
A.equal(p1.answeredIn.filter((x) => x.question === "rq_pb").length, 1, "landed again: no second entry");
// 11. what pins never touch: the snapshot, the archive, the chips
A.equal(/pn_/.test(JSON.stringify(st.snapshot(at))), false, "snapshot.json carries no pin and no pin id");
A.equal(st.archivable(0, at + 1e13).some((x) => String(x.id).startsWith("pn_") || x.text === p1.text), false, "no pin is ever archivable");
nPins = Object.keys(st.d.pins).length;
st.removeItems(st.archivable(0, at + 1e13));
A.equal(Object.keys(st.d.pins).length, nPins, "the daily archive leaves every pin");
const noPins = Store.fromText(st.toText()); noPins.d.pins = {};
A.deepEqual(st.chips(at), noPins.chips(at), "the chips are the same with and without pins");
// 12. words, and the usage line
A.equal(WORDS.handleWords("P4"), "Pin 4"); A.equal(WORDS.handleWords("Q3"), "Question 3"); A.equal(WORDS.handleWords("A9"), "Ask 9"); A.equal(WORDS.handleWords("X1"), "X1");
A.equal(WORDS.pinsWords(1), "1 pin"); A.equal(WORDS.pinsWords(3), "3 pins");
A.equal(WORDS.stageLabels(true).ask, "Ask here"); A.equal(WORDS.stageLabels(false).ask, "Copy to ask here");
A.equal(WORDS.PINS_EMPTY, "No pins in this session. Select a passage in the agent's pane, ⌘J, then ⌘S.");
A.equal(WORDS.pinsSearchEmpty("pool", 4), "No pin matches “pool” in 4 sessions."); A.equal(WORDS.pinsSelectedWords(3), "3 selected");
A.equal(WORDS.askAboutPinsWords(3), "Ask about these 3 pins…");
A.equal(WORDS.pinSourceWords(p1, PS), "this session"); A.equal(WORDS.pinSourceWords(pB, PS), "billing-api");
A.equal(WORDS.pinNameWords(pB, PS), "Pin 1 of billing-api"); A.equal(WORDS.pinNameWords(p1, PS), "Pin 1");
A.equal(WORDS.pinAnchorWords({ anchor: { turn: 12 }, createdAt: at - 3 * 86400e3 }, at), "turn 12 · 3 days ago");
A.equal(WORDS.pinAnchorWords({ anchor: { turn: 12, approx: true }, createdAt: at - 5 * 60e3 }, at), "around turn 12 · 5 min ago");
A.match(WORDS.pinLabel(pB, PS), /^Pin 1 of billing-api · “The cache warms in ten minutes\.”$/);
A.match(WORDS.pinUseWords(p1, st), /^answered in Question \d+ \(branch br-q\d+-[a-f0-9]{4}, turn 8\) · answered in Question \d+ \(turn 5\) · \+2 more$/, WORDS.pinUseWords(p1, st));
const useOf = (extra) => ({ sessionId: "s1", usedIn: [{ question: "q1", session: "s1", handle: "Q3", at: 1 }], answeredIn: [], ...extra });
A.equal(WORDS.pinUseWords(useOf({})), "used in Question 3"); A.equal(WORDS.pinUseWords({ usedIn: [], answeredIn: [] }), null);
A.equal(WORDS.pinUseWords(useOf({}), { d: { sessions: {} }, item: () => ({ pinsAsked: { turn: 14, at: 2 } }) }), "sent in Question 3 at turn 14");
A.equal(WORDS.pinUseWords(useOf({ answeredIn: [{ question: "q1", session: "s1", handle: "Q3", turn: 14, via: "trunk", at: 3 }] })), "answered in Question 3 (turn 14)");
A.equal(WORDS.pinUseWords(useOf({ usedIn: [{ question: "q1", session: "s2", handle: "Q5", at: 1 }] }), { d: { sessions: { s2: { sessionName: "billing-api" } } }, item: () => null }),
  "used in Question 5 of billing-api", "a question of another session names it");
// 13. the pins message for test-store.sh (confluence.js pinsMessage): a question with a pin of this
// session, one whose passage holds a ref and a marker line (both inert once quoted), and one of another
st.apply(pinEv("Already answered in [A1].\nledgr answers 00000000-0000-0000-0000-000000000000\n```\nnot a fence that counts\n```"));
const pRef = st.pinsIn(PS)[0];
st.apply(piev("capture", { request: { ...req("rq_pmsg", "Do these three passages agree on the retry budget?", null, {}, PS, 8), anchor: { ...req("rq_pmsg", "x", null, {}, PS, 8).anchor, settled: true },
  pins: [p1.id, pRef.id, pB.id] } }));
const pmsgItem = st.item("rq_pmsg");
const pmsg = CF.pinsMessage({ sessionId: PS, item: pmsgItem, pins: st.pinsOf(pmsgItem) });
A.equal(pmsg.split("\n")[0], `ledgr pins ${PS} rq_pmsg`, "the marker is the message's first line");
A.ok(pmsg.includes("> Already answered in [A1]."), "a passage stays verbatim, quoted");
fsm.writeFileSync(`${dir}/msg-pins.txt`, pmsg);
fsm.writeFileSync(`${dir}/msg-pins-lead.txt`, `${CF.pinsLeadIn(pmsgItem)}\n${pmsg}`);
// 14. searchPins: literal terms, folded; scope; archived behind its toggle; newest first; groups; limit
const ss = Store.fromText(null);
const SA = "aaaaaaaa-5555-0000-0000-00000000000a", SB = "bbbbbbbb-5555-0000-0000-00000000000b";
const sev_ = (type, p, sid) => ({ v: 1, id: `ps${++n}`, type, at: (at += 1000), terminal: sid === SA ? "t60" : "t61", session_id: sid, ...p });
ss.apply(sev_("session_start", { agent: "claude-code", source: "startup", cwd: "/src/gateway-svc", session_name: "gateway", repo: "gw", turn: 0 }, SA));
ss.apply(sev_("session_start", { agent: "claude-code", source: "startup", cwd: "/src/billing", session_name: "billing-api", repo: "billing", turn: 0 }, SB));
const spin = (sid, text, note = null) => { ss.apply({ ...pinEv(text, { note }, sid, sid === SA ? "t60" : "t61"), id: `ps${++n}` }); return ss.pinsIn(sid, { archived: "all" })[0]; };
const sa1 = spin(SA, "The **gateway** retries each request at most twice.", "retry budget");
const sa2 = spin(SA, "Pooling is per client, so one slow client can hold every connection.");
const sb1 = spin(SB, "Invoices are retried by the billing_worker nightly.");
const sb2 = spin(SB, "The `gateway` pool is shared with billing.");
const sa3 = spin(SA, "Each retry waits 200 ms.");
ss.apply(sev_("pin_archive", { pin: sb2.id }, SB));
const ids = (r) => r.groups.flatMap((g) => g.pins.map((p) => p.id));
A.deepEqual(ids(ss.searchPins("twice gateway", { here: SA })), [sa1.id], "every term, in any order");
A.deepEqual(ids(ss.searchPins('"per client"', { here: SA })), [sa2.id], "a quoted phrase"); A.equal(ss.searchPins('"client per"', { here: SA }).total, 0, "...kept whole");
A.deepEqual(ids(ss.searchPins("GATEWAY Retries", { here: SA })), [sa1.id], "case and markdown marks ignored");
A.deepEqual(ids(ss.searchPins("billing_worker", { here: SA })), [sb1.id], "underscores folded on both sides");
A.deepEqual(ids(ss.searchPins("budget", { here: SA })), [sa1.id], "the note is searched");
A.deepEqual(ids(ss.searchPins("billing-api", { here: SA })), [sb1.id], "the session name is searched");
A.deepEqual(ids(ss.searchPins("gateway-svc", { here: SB })), [sa3.id, sa2.id, sa1.id], "the folder name is searched, newest first");
A.deepEqual(ids(ss.searchPins("retr", { here: SA, scope: "here" })), [sa3.id, sa1.id], "scope here: the shown session only");
let sr = ss.searchPins("retr", { here: SA });
A.deepEqual(sr.groups.map((g) => g.sessionId), [SA, SB], "all sessions, the shown one's group first"); A.deepEqual(ids(sr), [sa3.id, sa1.id, sb1.id]);
sr = ss.searchPins("retr", { here: SB });
A.deepEqual(sr.groups.map((g) => g.sessionId), [SB, SA], "...whichever is shown"); A.equal(sr.total, 3);
A.deepEqual(ids(ss.searchPins("pool", { here: SA })), [sa2.id], "an archived pin is not searched by default");
A.deepEqual(ids(ss.searchPins("pool", { here: SA, archived: true })).sort(), [sa2.id, sb2.id].sort(), "...only with archived too");
sr = ss.searchPins("", { here: SA, limit: 2 });
A.equal(sr.total, 4, "total counts every match"); A.equal(ids(sr).length, 2, "the limit cuts what is shown"); A.deepEqual(ids(sr), [sa3.id, sb1.id], "the newest");
A.equal(ss.searchPins("nothing-like-this", { here: SA }).groups.length, 0);
A.deepEqual(ss.pinsIn(SA).map((p) => p.id), [sa3.id, sa2.id, sa1.id], "pinsIn: open ones, newest first"); A.deepEqual(ss.pinsIn(SB, { archived: true }).map((p) => p.id), [sb2.id]);
// 15. Forget the trunk: its pins stay, with their source and usage; search lists them under its name
const pq1Handle = pq1.handle;
st.apply(piev("forget", {}, PS, null));
A.equal(st.d.sessions[PS], undefined); A.equal(st.item("rq_pq1"), null, "the questions go with the session");
A.ok(st.pin(p1.id), "the session's pins stay"); A.equal(p1.usedIn[0].handle, pq1Handle, "usedIn keeps the handle"); A.equal(p1.usedIn[0].head, QP1.slice(0, 80), "...and the head");
A.match(WORDS.pinUseWords(p1, st), /answered in Question \d+ \(branch br-q\d+-[a-f0-9]{4}, turn 8\)/, "the usage line still reads");
sr = st.searchPins("retries twice", { here: PS2 });
A.deepEqual(ids(sr), [p1.id], "a forgotten session's pin is found"); A.equal(sr.groups[0].sessionId, PS); A.equal(st.d.sessions[sr.groups[0].sessionId], undefined, "...under a session the store no longer has");
st.apply(piev("pin_note", { pin: p1.id, note: "after forget" }, PS, null)); A.equal(p1.note, "after forget", "and can still be noted");
A.equal(Store.fromText(st.toText()).pin(p1.id).text, P1T, "pins survive a save, verbatim");
// 16. an older store (no pins map, sessions without nextHandle.P) loads and takes a pin as P1
const OS = "oooooooo-0000-0000-0000-000000000001";
const old = Store.fromText(JSON.stringify({ v: 1, items: {}, sessions: { [OS]: { sessionId: OS, agent: "claude-code", terminal: "t1", turn: 3, state: "idle", turnSource: "hooks", cwd: "/o", nextHandle: { A: 4, Q: 2 } } },
  branches: {}, terminals: {}, turns: {}, ingested: [], forgotten: {} }));
A.deepEqual(old.d.pins, {}, "an older store gains an empty pins map");
old.apply({ ...pinEv("An old session's passage.", { turn: 3 }, OS, "t1"), id: "old-1" });
A.equal(old.pinByHandle(OS, "P1")?.handle, "P1", "...and its first pin is P1"); A.deepEqual(old.d.sessions[OS].nextHandle, { A: 4, Q: 2, P: 2 });
// 17. Review fixes (2026-11-07)
// 17a. an id that is no pin (a prototype key) reaches nothing: not the pin events, not request.pins
const rs = Store.fromText(null);
const RS = "rrrrrrrr-0000-0000-0000-000000000001", RT = "t70";
const rev = (type, p, sid = RS, term = RT) => ({ v: 1, id: `rv${++n}`, type, at: (at += 1000), terminal: term, session_id: sid, ...p });
rs.apply(rev("session_start", { agent: "claude-code", source: "startup", cwd: "/src/review", session_name: "review", repo: "review", turn: 0 }));
rs.apply(rev("prompt", { turn: 1, prompt_id: "rp1", local: false, prompt_head: "go", refs: [] }));
rs.apply(rev("stop", { turn: 1, prompt_id: "rp1", text_path: null, text_head: "" }));
for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
  for (const type of ["pin_archive", "pin_note", "pin_restore", "pin_delete", "pin_archive"]) rs.apply(rev(type, { pin: key, note: "leaked" }));
  A.equal(rs.pin(key), null, `pin("${key}") is no pin`);
}
A.equal(Object.prototype.status, undefined, "pin_archive {pin: __proto__} sets nothing on Object.prototype");
for (const k of ["note", "archivedAt", "updatedAt", "usedIn"]) A.equal(Object.prototype[k], undefined, `...no ${k} on Object.prototype`);
A.equal(Object.status, undefined, "...nor on Object (constructor)"); A.equal(Object.note, undefined);
A.equal(typeof Object.prototype.toString, "function", "toString is still Object's own"); A.equal(Object.keys(rs.d.pins).length, 0);
rs.apply(rev("capture", { request: { ...req("rq_rproto", "Prototype keys as pins?", null, {}, RS, 1), pins: ["constructor", "__proto__", "toString", "valueOf"] } }));
A.equal("pins" in rs.item("rq_rproto"), false, "request.pins of prototype keys: no field");
A.deepEqual(rs.pinsOf({ pins: ["constructor", "__proto__"] }), [], "pinsOf: a prototype key is no pin");
A.equal(rs.pinsOf({ pins: ["constructor"] }).includes(Object), false, "...never Object");
const proto = Store.fromText('{"v":1,"pins":{"__proto__":{"id":"__proto__","status":"open"}},"items":{},"sessions":{}}');
A.equal(proto.pin("__proto__"), null, "a store holding the key itself: still no pin (not a pin id)");
// 17b. the turn's message uuid from an asks event reaches its settled pins as it reaches items
rs.apply(rev("prompt", { turn: 2, prompt_id: "rp2", local: false, prompt_head: "go", refs: [] }));
rs.apply(rev("stop", { turn: 2, prompt_id: "rp2", text_path: null, text_head: "" }));
rs.apply(pinEv("The uuid arrives with the asks event.", { turn: 2 }, RS, RT));
const ru = rs.pinByHandle(RS, "P1");
A.equal(ru.anchor.uuid, null, "no uuid at the Stop: none yet");
rs.apply(pinEv("Already has its own uuid.", { turn: 2 }, RS, RT)); const ru2 = rs.pinByHandle(RS, "P2"); ru2.anchor.uuid = "own-uuid";
rs.apply(rev("asks", { turn: 2, prompt_id: "rp2", message_uuid: "uuid-r2", source: "skip", asks: [] }));
A.equal(ru.anchor.uuid, "uuid-r2", "the asks event's uuid goes on the pin of its turn"); A.equal(ru2.anchor.uuid, "own-uuid", "...never over one it has");
rs.apply(rev("prompt", { turn: 3, prompt_id: "rp3", local: false, prompt_head: "go", refs: [] }));
rs.apply(pinEv("Read off the screen while it works.", { turn: 3, verified: "screen", settled: false }, RS, RT));
const ru3 = rs.pinByHandle(RS, "P3");
rs.apply(rev("asks", { turn: 3, prompt_id: "rp3", message_uuid: "uuid-r3-mid", source: "tool", tool_call: 1, asks: [] }));
A.equal(ru3.anchor.uuid, null, "an unsettled screen pin waits for its Stop");
rs.apply(rev("stop", { turn: 3, prompt_id: "rp3", text_path: null, text_head: "" }));
// 17c. a branch keeps the ids its preamble numbered: a pin deleted since keeps its number in the
// Conclude skeleton and the confluence (Store.branchPins)
rs.apply(rev("capture", { request: { ...req("rq_rb", "Do these three still agree?", null, {}, RS, 3), anchor: { ...req("rq_rb", "x", null, {}, RS, 3).anchor, settled: true },
  pins: [ru.id, ru2.id, ru3.id] } }));
const RB = "br_00000000-rrrr-4bbb-8ccc-000000000001";
A.deepEqual(rs.apply(rev("branch", { item: "rq_rb", branch_id: RB, placement: "split" })).launch, [RB]);
const rbr = rs.d.branches[RB];
A.deepEqual(rbr.pins, [ru.id, ru2.id, ru3.id], "the branch record keeps its pin ids"); A.match(rbr.preamble, /^Pin 3 · /m);
A.deepEqual(rs.branchPins(rbr).map((p) => p.id), rbr.pins);
rs.apply(rev("pin_archive", { pin: ru2.id })); rs.apply(rev("pin_delete", { pin: ru2.id }));
A.equal(rs.pin(ru2.id), null, "pin 2 archived and deleted after the launch");
A.deepEqual(rs.branchPins(rbr).map((p) => p?.id ?? null), [ru.id, null, ru3.id], "branchPins: a null where it was, the others keep their places");
A.equal(rs.pinsOf(rs.item("rq_rb")).length, 2, "(pinsOf would renumber pin 3 as pin 2)");
const rsk = CF.pinsConcludeSkeleton(rs.branchPins(rbr), { sessionId: RS }).split("\n");
A.ok(rsk[1].startsWith("pin 1 (this conversation, turn 2): “The uuid arrives")); A.equal(rsk[3], "pin 2: (deleted)");
A.ok(rsk[4].startsWith("pin 3 (this conversation, turn 3): “Read off the screen"), "the skeleton numbers pin 3 as the preamble did");
A.equal(CF.confluenceMessage({ branch: rbr, item: rs.item("rq_rb"), text: "answer: yes", pins: rs.branchPins(rbr) }).split("\n")[2],
  "It was about 3 pinned passages: pin 1 (this conversation, turn 2), pin 2 (deleted), pin 3 (this conversation, turn 3).", "...and so does the confluence");
const oldBr = { ...rbr }; delete oldBr.pins;
A.deepEqual(rs.branchPins(oldBr).map((p) => p.id), [ru.id, ru3.id], "a branch recorded before the ids were kept: the question's pins");
// 17d. search folds a pin once and reuses it while its updatedAt holds
const hp = rs.pin(ru.id), keysBefore = Object.keys(hp).sort().join();
const h1 = pinHaystack(hp);
A.equal(pinHaystack(hp), h1, "the same fold");
hp.text = "Something else entirely";   // a change that skipped updatedAt: the cached fold is what search reads
A.equal(pinHaystack(hp), h1, "reused while updatedAt is unchanged"); A.equal(rs.searchPins("entirely", { here: RS }).total, 0, "...search reads the cached fold");
hp.updatedAt += 1;
A.ok(pinHaystack(hp).includes("something else entirely"), "a new updatedAt folds it again"); A.equal(rs.searchPins("entirely", { here: RS }).total, 1);
rs.apply(rev("pin_note", { pin: hp.id, note: "fresh words for the search" }));
A.equal(rs.searchPins('"fresh words"', { here: RS }).total, 1, "pin_note (it sets updatedAt) is searchable at once");
A.equal(Object.keys(hp).sort().join(), keysBefore, "the cache adds nothing to the pin (nothing reaches store.json)");
// 17e. a pins message over 45,000 characters (12 pins of 3,800, many short lines), for test-store.sh:
// an answer sheet pasted after it must still land (ledgr_landing.py MAX_SCAN)
const longPins = Array.from({ length: 12 }, (_, i) => ({ ...p1, id: `pn_00000000-llll-4000-8000-${String(i).padStart(12, "0")}`, handle: `P${i + 1}`,
  text: Array.from({ length: 95 }, (_, k) => `Line ${k} of the long passage ${i}, about retries.`.padEnd(39, ".")).join("\n").slice(0, 3800) }));
const longMsg = CF.pinsMessage({ sessionId: PS, item: { ...pmsgItem, pins: longPins.map((x) => x.id) }, pins: longPins });
A.ok(longMsg.length > 45000, `the long pins message is over 45,000 characters (${longMsg.length})`);
A.ok(CF.pinsOverCap(CF.pinsChars(longPins)), "(Ask here refuses it now; a hand-made paste can still be this long)");
fsm.writeFileSync(`${dir}/msg-pins-long.txt`, longMsg);
const pinChecks = checks - phase1 - phase2 - phase3 - sev - prof - toolChecks - settleChecks - spaceChecks;

console.log(`OK: store, ${checks} checks (${phase1} phase 1, ${phase2} phase 2, ${phase3} phase 3, ${sev} severity and resume, ${prof} profiles, handoff and paste words, ${toolChecks} tool asks, ${settleChecks} blocking while working, closed by the agent, answered then settled, ${spaceChecks} spaces off and Clear all, ${pinChecks} pins), 0 failure(s)`);
