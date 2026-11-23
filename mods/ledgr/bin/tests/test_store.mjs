// ledgr store unit test: event application (Phase 1, ported from the build session's scratchpad
// storetest/test.mjs) and the Phase 2 branch events, manifest, preamble and launch argv; Phase 3:
// conclude, the confluence and answer-sheet messages, confluence_landed, answers_landed, close_branch.
// Writes the composed messages to <folder>/msg-*.txt so test-store.sh can run the hooks' parser on them.
// Pins (docs/design/Pins.md 8.1): the pin events, a question's pins, pins_asked and its Stop, the
// confluence's answeredIn, the search, the words, and the writer's re-anchor of a screen pin; writes
// msg-pins.txt and msg-pins-lead.txt (confluence.js pinsMessage) for test-store.sh, and msg-pins-long.txt (a
// pins message over 45,000 characters, for the parser's scan length).
// Retention (2026-11-19, Phase 1): archivable's 7-day floor for dismissed items, removeItems' re-check and
// the per-session `archived` count, planSlim / applySlim, leaner turn records (and the readers' fallback),
// restore, a re-raise after its original was archived, handles never reused, the hooks' defaults equal to
// config.js's (ledgr_config.py through python3), and a store of realistic size slimmed by exactly what goes.
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
A.ok(st.archivable(0, at + 8 * 86400e3).some((i) => i.id === "rq_k2"), "a cleared question archives like other dismissed items");
A.equal(st.archivable(0, at + 1).some((i) => i.id === "rq_k2"), false, "...never before 7 days, as they are (retention, 2026-11-19)");
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

// ── Retention (2026-11-19, Phase 1) ─────────────────────────────────────
let retSizes = "";
{
  const DAY = 86400e3, NOW = 1800000000000;
  const idsOf = (l) => l.map((x) => x.id).sort();
  // The lossless part of slimming, written here on its own (the oracle): the default turn file and null
  // fields (top, asks, retry) leave a record.
  const oracleLean = (turns) => {
    for (const [sid, all] of Object.entries(turns)) {
      for (const [t, r] of Object.entries(all)) {
        if (!r.textPath || r.textPath === CFG.turnPath(sid, t) || r.textPath === `turns/${sid}/${t}.md`) delete r.textPath;
        for (const o of [r, r.asks ?? {}, r.retry ?? {}]) for (const key of Object.keys(o)) if (o[key] === null) delete o[key];
      }
      if (!Object.keys(all).length) delete turns[sid];
    }
    return turns;
  };

  // 1. the settled values; the hooks' defaults (ledgr_config.py) agree with config.js on every key they hold
  A.equal(CFG.DEFAULTS.retention_days, 3, "retention_days: 3 (was 14)");
  A.deepEqual(CFG.DEFAULTS.retention, { turns: 12, coldDays: 7 }, "retention.turns: 12 records per session (and Phase 2's coldDays 7 beside it)");
  A.equal(CFG.LIMITS.turnHeads, 2, "LIMITS.turnHeads: 2");
  {
    const { spawnSync } = await import("node:child_process");
    const lib = new URL("../lib/", import.meta.url).pathname;
    const r = spawnSync(process.env.LEDGR_PYTHON || "python3", ["-I", "-B", "-c",
      "import sys, json; sys.path[:0] = [sys.argv[1]]; import ledgr_config as K; print(json.dumps(K.DEFAULT_CONFIG))", lib], { encoding: "utf8" });
    A.equal(r.status, 0, `ledgr_config.py loads: ${r.error ?? r.stderr}`);
    const py = JSON.parse(r.stdout);
    const leaves = (o, p = []) => (o && typeof o === "object" && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => leaves(v, [...p, k])) : [[p, o]]);
    const atPath = (o, p) => p.reduce((x, k) => (x && typeof x === "object" ? x[k] : undefined), o);
    A.deepEqual(leaves(py).filter(([p, v]) => JSON.stringify(atPath(CFG.DEFAULTS, p)) !== JSON.stringify(v)).map(([p]) => p.join(".")), [],
      "every default ledgr_config.py holds is config.js's");
    A.equal(py.retention_days, 3); A.deepEqual(py.retention, { turns: 12, coldDays: 7 });
  }

  // 2. archivable: closed past `days`; a dismissed item never before 7 days; copies
  const RT = "rtrtrtrt-7777-0000-0000-000000000001";
  const rt = new Store({ v: 1, items: {}, sessions: { [RT]: { sessionId: RT, agent: "claude-code", turn: 9, state: "idle", turnSource: "hooks", cwd: "/rt", nextHandle: { A: 1, Q: 1, P: 1 } } },
    branches: {}, terminals: {}, turns: {}, ingested: [], forgotten: {}, pins: {} });
  const put = (id, status, ageDays, sid = RT) => {
    const closed = status === "resolved" || status === "dismissed";
    rt.d.items[id] = { id, key: id, handle: `A${rt.d.sessions[RT].nextHandle.A++}`, direction: "agent_to_human", text: `item ${id}`, kind: "do", level: "needed",
      anchor: { sessionId: sid, turn: 1, hash: id }, status, createdAt: NOW - 60 * DAY, updatedAt: NOW - ageDays * DAY, ...(closed ? { resolvedAt: NOW - ageDays * DAY } : {}) };
  };
  put("rq_r4", "resolved", 4); put("rq_r2", "resolved", 2); put("rq_d4", "dismissed", 4); put("rq_d8", "dismissed", 8);
  put("rq_o30", "open", 30); put("rq_a30", "answered", 30); put("rq_f30", "deferred", 30); put("rq_j30", "rejoin_pending", 30);
  A.deepEqual(idsOf(rt.archivable(3, NOW)), ["rq_d8", "rq_r4"], "3 days: resolved past 3 days, dismissed past 7; open, answered, deferred, rejoin_pending never");
  A.deepEqual(idsOf(rt.archivable(0, NOW)), ["rq_d8", "rq_r2", "rq_r4"], "0 days reads as 1 (config.js retentionDays): a dismissed item still waits 7 days");
  put("rq_r05", "resolved", 0.2);
  A.ok(!idsOf(rt.archivable(0, NOW)).includes("rq_r05") && !idsOf(rt.archivable(0.4, NOW)).includes("rq_r05"), "a hand-written 0 or 0.4 is one day, never \"archive at once\"");
  A.deepEqual(idsOf(rt.archivable(45, NOW + 31 * DAY)), idsOf(rt.archivable(30, NOW + 31 * DAY)), "45 reads as 30");
  delete rt.d.items.rq_r05; rt.d.sessions[RT].nextHandle.A--;
  A.deepEqual(idsOf(rt.archivable(10, NOW)), [], "10 days: neither is past it");
  A.deepEqual(idsOf(rt.archivable(3, NOW + 4 * DAY)), ["rq_d4", "rq_d8", "rq_r2", "rq_r4"], "four days on, the 4-day dismissal is past 7 days");
  for (const bad of [null, undefined, "x", NaN, true, {}]) A.deepEqual(idsOf(rt.archivable(bad, NOW)), ["rq_d8", "rq_r4"], `days ${String(bad)}: the default, 3`);
  A.deepEqual(idsOf(rt.archivable(-1, NOW)), ["rq_d8", "rq_r2", "rq_r4"], "-1 clamps to 1 day");
  A.equal(CFG.retentionDays(2.5), 3); A.equal(CFG.retentionDays("7"), 7); A.equal(CFG.retentionDays(31), 30); A.equal(CFG.retentionDaysOf({}), 3);
  A.deepEqual(idsOf(rt.archivable("3", NOW)), ["rq_d8", "rq_r4"], "a numeric string reads as its number");
  const copies = rt.archivable(3, NOW);
  copies[0].text = "changed in the copy"; copies[0].anchor.turn = 99;
  A.equal(rt.item(copies[0].id).text, `item ${copies[0].id}`, "archivable gives copies (the archive line as it is now)"); A.equal(rt.item(copies[0].id).anchor.turn, 1);

  // 3. removeItems: only what is still closed and unchanged since the plan; counted per session; returned
  const plan = rt.archivable(3, NOW);
  rt.act("rq_r4", "reopen", null, NOW + 1);   // reopened while the writer wrote the archive file
  const gone = rt.removeItems([...plan, { id: "rq_nope", updatedAt: 1 }, { id: "__proto__" }, { id: "constructor" }, null, 7]);
  A.deepEqual(gone.map((x) => x.id), ["rq_d8"], "only the one still closed and unchanged leaves");
  A.equal(rt.item("rq_d8"), null); A.equal(rt.item("rq_r4").status, "open", "the reopened one stays");
  A.equal(rt.d.sessions[RT].archived, 1, "counted on its session's archived");
  A.equal(typeof Object.prototype.archived, "undefined", "nothing reaches Object.prototype");
  A.deepEqual(rt.removeItems(plan), [], "the same list again removes nothing"); A.equal(rt.d.sessions[RT].archived, 1);
  rt.act("rq_r4", "resolve", null, NOW - 5 * DAY);
  const plan2 = rt.archivable(3, NOW);
  A.deepEqual(idsOf(plan2), ["rq_r4"]);
  rt.act("rq_r4", "draft", "typed while the file was written", NOW - 4 * DAY);   // still closed, but changed
  A.deepEqual(rt.removeItems(plan2), [], "changed since the plan (updatedAt): it stays"); A.equal(rt.item("rq_r4").draft, "typed while the file was written");
  A.deepEqual(rt.removeItems(rt.archivable(3, NOW)).map((x) => x.id), ["rq_r4"], "...and leaves at the next run"); A.equal(rt.d.sessions[RT].archived, 2);
  put("rq_orphan", "resolved", 30, "gone-session");
  A.deepEqual(rt.removeItems(rt.archivable(3, NOW)).map((x) => x.id), ["rq_orphan"], "an item of no recorded session leaves too");
  A.equal(rt.d.sessions["gone-session"], undefined, "...and no session is made for its count");
  A.deepEqual(rt.removeItems(undefined), []); A.deepEqual(rt.removeItems("x"), []);
  // A change that sets no updatedAt (a confluence landing again rewrites `resolution`; Forget drops a branch
  // mark): the item no longer equals its planned line, so it stays (review, 2026-11-19).
  put("rq_rb", "resolved", 10);
  const planB = rt.archivable(3, NOW).filter((x) => x.id === "rq_rb");
  rt.item("rq_rb").resolution = { branchId: "br_00000000-0000-4000-8000-0000000000bb", turn: 9 };   // updatedAt untouched
  A.deepEqual(rt.removeItems(planB), [], "a change that set no updatedAt: it stays (the file's line is stale, the store wins)");
  A.equal(rt.item("rq_rb").resolution.turn, 9);
  A.deepEqual(rt.removeItems(rt.archivable(3, NOW).filter((x) => x.id === "rq_rb")).map((x) => x.id), ["rq_rb"], "...and leaves with its new line at the next run");

  // 4. leaner turn records from now on: no default textPath, no null field; the readers fall back
  const LS = "llllllll-7777-0000-0000-000000000001", LT = "t72";
  const ln = Store.fromText(null);
  const lev = (type, p) => ({ v: 1, id: `ln${++n}`, type, at: (at += 1000), terminal: LT, session_id: LS, ...p });
  ln.apply(lev("session_start", { agent: "claude-code", source: "startup", cwd: "/ln", session_name: "lean", turn: 0 }));
  ln.apply(lev("prompt", { turn: 1, prompt_id: "lp1", local: false, prompt_head: "go", refs: [] }));
  let lr = ln.apply(lev("stop", { turn: 1, prompt_id: "lp1", text_path: CFG.turnPath(LS, 1), text_head: "The head.", passage_hash: "l1", message_uuid: "lu1" }));
  A.equal("textPath" in ln.turnInfo(LS, 1), false, "the default turn file is not stored"); A.equal(lr.settle[0].textPath, null, "...the settle entry falls back to it");
  A.equal(ln.turnInfo(LS, 1).textHead, "The head."); A.equal(ln.turnInfo(LS, 1).promptId, "lp1"); A.equal(ln.turnInfo(LS, 1).uuid, "lu1");
  ln.apply(lev("stop", { turn: 2, prompt_id: null, text_path: `turns/${LS}/2.md`, text_head: "" }));
  A.deepEqual(Object.keys(ln.turnInfo(LS, 2)).sort(), ["stopAt", "textHead"], "a relative default goes too, and every null");
  A.equal(ln.turnInfo(LS, 2).textHead, "", "an empty head is kept as given");
  lr = ln.apply(lev("stop", { turn: 3, prompt_id: "lp3", text_path: "/elsewhere/3.md", text_head: "h" }));
  A.equal(ln.turnInfo(LS, 3).textPath, "/elsewhere/3.md", "a path elsewhere is kept"); A.equal(lr.settle[0].textPath, "/elsewhere/3.md");
  const askAt = at + 1000;
  ln.apply(lev("asks", { turn: 1, source: "model", asks: [], model: null, provider: null, error: null, block_error: null, message_uuid: null }));
  A.deepEqual(ln.turnInfo(LS, 1).asks, { source: "model", count: 0, at: askAt }, "the asks sub-record without its null fields");
  ln.apply(lev("retry", { turn: 3 }));
  ln.apply(lev("asks", { turn: 3, source: "error", asks: [], error: "no credential", error_detail: "Keychain: no item" }));
  A.deepEqual(Object.keys(ln.turnInfo(LS, 3).asks).sort(), ["at", "count", "error", "errorDetail", "source"], "an error keeps what the panel's error line reads");
  A.equal(ln.turnInfo(LS, 3).retry.state, "failed"); A.equal(ln.turnInfo(LS, 3).retry.note, "no credential");
  A.equal(/:null[,}]/.test(JSON.stringify(ln.d.turns)), false, "no null anywhere in the records");
  // writer.js reanchor (through on_stop's settle entry) reads the default file the record no longer names
  ln.apply(lev("prompt", { turn: 4, prompt_id: "lp4", local: false, prompt_head: "go", refs: [] }));
  ln.apply({ ...pinEv("Back-off doubles each time.", { turn: 4, verified: "screen", settled: false }, LS, LT), id: `ln${++n}` });
  lr = ln.apply(lev("stop", { turn: 4, prompt_id: "lp4", text_path: CFG.turnPath(LS, 4), text_head: "" }));
  A.equal("textPath" in ln.turnInfo(LS, 4), false);
  globalThis.__herdr = { files: { [CFG.turnPath(LS, 4)]: "As said: Back-off doubles each time." } };
  wr.live = ln;
  await wr.reanchor(lr.settle[0]);
  const lpin = ln.pinByHandle(LS, "P1");
  A.equal(lpin.anchor.reanchored, true); A.equal(lpin.anchor.approx, false, "found in the default turn file"); A.equal(lpin.anchor.turn, 4);
  globalThis.__herdr = {};

  // 5. planSlim / applySlim: the newest records kept (by turn number), heads beyond the newest 2, copies;
  // nothing changed by the plan; a record changed since is left; slimmed twice; pins untouched
  const S1 = "s1s1s1s1-7777-0000-0000-000000000001", S2 = "s2s2s2s2-7777-0000-0000-000000000002";
  const legacyRec = (sid, t) => ({ stopAt: NOW - t * 1000, textPath: CFG.turnPath(sid, t), textHead: `Turn ${t} said this.`, promptId: null, uuid: `u-${t}`,
    asks: { source: "model", error: null, errorDetail: null, blockError: null, count: 1, at: NOW - t * 1000, model: null, provider: null } });
  const legacyStore = (bySid) => ({ v: 1, items: {}, branches: {}, terminals: {}, ingested: [], forgotten: {},
    sessions: Object.fromEntries(Object.keys(bySid).map((sid) => [sid, { sessionId: sid, agent: "claude-code", turn: 200, state: "idle", turnSource: "hooks", cwd: "/x", nextHandle: { A: 1, Q: 1, P: 1 } }])),
    turns: Object.fromEntries(Object.entries(bySid).map(([sid, list]) => [sid, Object.fromEntries(list.map((t) => [t, legacyRec(sid, t)]))])),
    pins: { "pn_00000000-7777-4000-8000-000000000001": { id: "pn_00000000-7777-4000-8000-000000000001", handle: "P1", sessionId: S1, text: "A pinned passage.", note: null,
      anchor: { sessionId: S1, turn: 1, hash: "p", settled: true }, status: "open", createdAt: NOW, updatedAt: NOW, usedIn: [], answeredIn: [] } } });
  const sl = new Store(legacyStore({ [S1]: Array.from({ length: 20 }, (_, i) => i + 1), [S2]: [1, 2, 9, 10, 100] }));
  sl.d.turns[S1][20].textPath = "/elsewhere/20.md";
  const pinsText = JSON.stringify(sl.d.pins), t0 = sl.toText();
  const p3 = sl.planSlim(3);
  A.deepEqual(p3.cut.filter((c) => c.sessionId === S2).map((c) => c.turn), [2, 1], "by turn number: 100, 10 and 9 are the newest three");
  A.deepEqual(p3.heads.filter((c) => c.sessionId === S2).map((c) => c.turn), [9], "...and 9 is past the newest two");
  const sp_ = sl.planSlim(12);
  A.equal(sl.toText(), t0, "planSlim mutates nothing");
  A.deepEqual(sp_.cut.filter((c) => c.sessionId === S1).map((c) => c.turn), [8, 7, 6, 5, 4, 3, 2, 1], "past the newest 12 of 20");
  A.equal(sp_.cut.filter((c) => c.sessionId === S2).length, 0, "5 records: none cut");
  A.deepEqual(sp_.heads.filter((c) => c.sessionId === S1).map((c) => c.turn), [18, 17, 16, 15, 14, 13, 12, 11, 10, 9], "heads of the kept ones past the newest 2");
  A.deepEqual(sp_.heads.filter((c) => c.sessionId === S2).map((c) => c.turn), [9, 2, 1]);
  A.deepEqual(sp_.cut[0].rec, sl.d.turns[S1][8], "a cut entry carries the record as it is"); A.equal(sp_.heads[0].textHead, "Turn 18 said this.");
  sp_.cut[0].rec.uuid = "edited in the plan";
  A.equal(sl.d.turns[S1][8].uuid, "u-8", "...a copy");
  sp_.cut[0].rec.uuid = "u-8";
  A.equal(sl.planSlim(12, 0).heads.length, 17, "heads 0: every kept record's head (12 + 5)"); A.equal(sl.planSlim("bad", "bad").cut.length, 8, "bad numbers: the defaults");
  sl.d.turns[S1][3].retry = { at: NOW, state: "requested" };   // changed after the plan: stays
  sl.d.turns[S1][9].textHead = "Rewritten.";                   // a head that changed: stays
  A.deepEqual(sl.applySlim(sp_), { cut: 7, heads: 12 }, "what was taken, as counts");
  A.deepEqual(Object.keys(sl.d.turns[S1]).map(Number).sort((a, b) => a - b), [3, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  A.equal(sl.d.turns[S1][9].textHead, "Rewritten."); A.equal(sl.d.turns[S1][10].textHead, undefined); A.equal(sl.d.turns[S1][19].textHead, "Turn 19 said this.");
  A.equal(sl.d.turns[S1][20].textPath, "/elsewhere/20.md", "a textPath elsewhere is kept");
  A.equal(Object.values(sl.d.turns).flatMap((all) => Object.values(all)).filter((r) => "textPath" in r).length, 1, "every default textPath is gone");
  A.equal(/:null[,}]/.test(JSON.stringify(sl.d.turns)), false, "and every null field (lossless)");
  A.deepEqual(sl.d.turns[S2][100], { stopAt: NOW - 100000, textHead: "Turn 100 said this.", uuid: "u-100", asks: { source: "model", count: 1, at: NOW - 100000 } });
  A.deepEqual(sl.applySlim(sp_), { cut: 0, heads: 0 }, "the same plan again takes nothing");
  const sp2 = sl.planSlim(12);   // slimmed twice: the record and the head left last time go now
  A.deepEqual(sp2.cut.map((c) => [c.sessionId, c.turn]), [[S1, 3]]); A.deepEqual(sp2.heads.map((c) => [c.sessionId, c.turn, c.textHead]), [[S1, 9, "Rewritten."]]);
  A.deepEqual(sl.applySlim(sp2), { cut: 1, heads: 1 });
  const t2 = sl.toText(), sp3 = sl.planSlim(12);
  A.deepEqual(sp3, { cut: [], heads: [] }, "a third time: nothing planned"); A.deepEqual(sl.applySlim(sp3), { cut: 0, heads: 0 }); A.equal(sl.toText(), t2, "...and nothing changed");
  A.equal(JSON.stringify(sl.d.pins), pinsText, "pins untouched");
  for (const bad of [null, undefined, {}, { cut: "x", heads: 3 }, { cut: [null, { sessionId: "__proto__", turn: "constructor" }], heads: [{ sessionId: S1, turn: 99 }] }]) A.deepEqual(sl.applySlim(bad), { cut: 0, heads: 0 });
  const z = Store.fromText(sl.toText());
  z.applySlim(z.planSlim(0));
  A.deepEqual(z.d.turns, {}, "keep 0: every record goes, and the empty maps with them");
  // A key that is not its number's own spelling (a hand-edited "07"): planned with that key and cut by it,
  // not looked for as "7" (and archived again at every run).
  const hk = Store.fromText(null);
  hk.d.turns.KS = { "07": { stopAt: 1, textHead: "seven" }, 8: { stopAt: 2, textHead: "eight" }, 9: { stopAt: 3 } };
  const hp7 = hk.planSlim(2, 1);
  A.deepEqual(hp7.cut.map((c) => [c.turn, c.key]), [[7, "07"]], "the plan carries the record's own key");
  A.deepEqual(hp7.heads.map((h) => [h.turn, h.key]), [[8, "8"]]);
  A.deepEqual(hk.applySlim(hp7), { cut: 1, heads: 1 }); A.deepEqual(Object.keys(hk.d.turns.KS).sort(), ["8", "9"], "the \"07\" record cut by its own key");
  A.deepEqual(hk.planSlim(2, 1), { cut: [], heads: [] }, "...and nothing is planned again");

  // 6. restore: back under its id and handle, reopened through setStatus; record_error and neither change
  // nothing; an id already there; an unknown session; a replay; the count never below 0
  const RS_ = "rsrsrsrs-7777-0000-0000-000000000001";
  const ro_ = Store.fromText(null);
  const rv = (type, p, sid = RS_) => ({ v: 1, id: `ro${++n}`, type, at: (at += 1000), terminal: "t73", session_id: sid, ...p });
  ro_.apply(rv("session_start", { agent: "claude-code", source: "startup", cwd: "/ro", session_name: "restore", turn: 0 }));
  ro_.apply(rv("prompt", { turn: 1, prompt_id: "rp1", local: false, prompt_head: "go", refs: [] }));
  ro_.apply(rv("asks", { turn: 1, source: "block", asks: [ask("Pick the retention rule", "decide"), ask("Run the migration", "do")] }));
  const ra1 = ro_.byHandle(RS_, "A1"), ra2 = ro_.byHandle(RS_, "A2");
  ro_.apply(rv("act", { item: ra1.id, handle: "A1", action: "resolve", arg: null, actor: "agent", turn: 1, note: "settled in the chat" }));
  A.equal(ra1.resolvedBy, "agent"); A.equal(ra1.resolvedNote, "settled in the chat");
  ro_.apply(rv("act", { item: ra2.id, action: "dismiss", arg: null }));
  const arch = ro_.archivable(3, at + 30 * DAY);
  A.deepEqual(idsOf(arch), [ra1.id, ra2.id].sort());
  const line = Object.fromEntries(arch.map((x) => [x.id, JSON.parse(JSON.stringify(x))]));   // what the writer reads back
  A.equal(ro_.removeItems(arch).length, 2); A.equal(ro_.d.sessions[RS_].archived, 2);
  ro_.d.retention = { v: 1, at };   // the writer's mark once the first run after the upgrade has finished
  const reread = Store.fromText(ro_.toText());
  A.equal(reread.d.sessions[RS_].archived, 2, "session.archived survives a save and a load"); A.deepEqual(reread.d.retention, { v: 1, at }, "...and so does d.retention");
  // ...and without the sessions' idle clock (Phase 2: every event of a warm session moves its touchedAt).
  const textNoIngested = () => { const d = JSON.parse(ro_.toText()); delete d.ingested; for (const s of Object.values(d.sessions)) delete s.touchedAt; return JSON.stringify(d); };
  const e1 = rv("restore", { item: ra1.id, file: "items-1800000000000-a1b2c3.jsonl", reopen: true, record: line[ra1.id] });
  let rr = ro_.apply(e1);
  A.deepEqual(rr.restore, { item: ra1.id, ok: true }, "the result says it was restored"); A.ok(ro_.d.ingested.includes(e1.id));
  const back = ro_.item(ra1.id);
  A.equal(back.handle, "A1", "under its own handle"); A.equal(back.id, ra1.id, "...and id"); A.notEqual(back, line[ra1.id], "a copy of the record");
  A.equal(back.status, "open", "reopened"); A.equal(back.resolvedBy, undefined, "resolvedBy cleared (setStatus)"); A.equal(back.resolvedNote, undefined); A.equal(back.resolvedAt, undefined);
  A.equal(back.updatedAt, e1.at); A.equal(ro_.d.sessions[RS_].archived, 1, "archived lowered by one");
  A.equal(ro_.archivable(3, at + 30 * DAY).some((x) => x.id === ra1.id), false, "open again: not archivable");
  let txt = textNoIngested();
  const e2 = rv("restore", { item: ra2.id, file: "items-1800000000000-a1b2c3.jsonl", reopen: true, record_error: "no line for this item in items-1800000000000-a1b2c3.jsonl" });
  rr = ro_.apply(e2);
  A.deepEqual(rr.restore, { item: ra2.id, ok: false, error: "no line for this item in items-1800000000000-a1b2c3.jsonl" }); A.equal(rr.applied, true);
  A.equal(textNoIngested(), txt, "record_error: no change"); A.ok(ro_.d.ingested.includes(e2.id), "...still ingested");
  const e3 = rv("restore", { item: ra2.id, file: "x.jsonl", reopen: true });
  rr = ro_.apply(e3);
  A.equal(rr.restore.ok, false); A.match(rr.restore.error, /no record/); A.equal(textNoIngested(), txt, "neither: no change"); A.ok(ro_.d.ingested.includes(e3.id));
  rr = ro_.apply(rv("restore", { item: ra2.id, file: "x.jsonl", reopen: true, record: line[ra1.id] }));
  A.equal(rr.restore.ok, false, "a line of another item"); A.equal(textNoIngested(), txt);
  rr = ro_.apply(rv("restore", { item: ra2.id, file: "x.jsonl", reopen: true, record: { ...line[ra2.id], anchor: { ...line[ra2.id].anchor, sessionId: "another" } } }));
  A.equal(rr.restore.ok, false, "a line of another session"); A.equal(textNoIngested(), txt);
  rr = ro_.apply(rv("restore", { item: ra1.id, file: "x.jsonl", reopen: true, record: line[ra1.id] }));
  A.deepEqual(rr.restore, { item: ra1.id, ok: true }, "an id already in the store: the one there");
  A.equal(ro_.itemsOf(RS_).filter((x) => x.handle === "A1").length, 1, "...no second item"); A.equal(ro_.d.sessions[RS_].archived, 1, "...the count unchanged");
  A.equal(ro_.item(ra1.id).status, "open");
  const e4 = rv("restore", { item: ra2.id, file: "items-1800000000000-a1b2c3.jsonl", reopen: false, record: line[ra2.id] });
  rr = ro_.apply(e4);
  A.deepEqual(rr.restore, { item: ra2.id, ok: true }); A.equal(ro_.item(ra2.id).status, "open", "a restore always reopens (reopen false is not read: a closed item put back would leave again at the next run)");
  A.equal("archived" in ro_.d.sessions[RS_], false, "the count at 0 leaves the field out");
  A.equal(ro_.apply(e4).applied, false, "a replay changes nothing"); A.equal(ro_.apply(e4).restore, undefined, "...and reports no restore");
  ro_.d.items = Object.fromEntries(Object.entries(ro_.d.items).filter(([id]) => id !== ra2.id));
  A.equal(ro_.restoreItem(line[ra2.id]).id, ra2.id, "restoreItem directly"); A.equal("archived" in ro_.d.sessions[RS_], false, "never below 0");
  const nS = Object.keys(ro_.d.sessions).length;
  const e5 = rv("restore", { item: ra1.id, file: "x.jsonl", reopen: true, record: line[ra1.id] }, "99999999-7777-0000-0000-0000000000ff");
  rr = ro_.apply(e5);
  A.deepEqual(rr.restore, { item: ra1.id, ok: false, error: "its session is not in the store" }); A.equal(Object.keys(ro_.d.sessions).length, nS, "an unknown session: none made");
  A.ok(ro_.d.ingested.includes(e5.id));
  for (const bad of [null, [], "rq_x", { id: "__proto__", anchor: { sessionId: RS_ } }, { id: "rq_noanchor" }, { id: "pn_00000000-0000-4000-8000-000000000001", anchor: { sessionId: RS_ } }]) {
    A.equal(ro_.restoreItem(bad), null, `not an item: ${JSON.stringify(bad)}`);
  }
  A.equal(Object.prototype.anchor, undefined, "nothing reaches Object.prototype");
  ro_.d.forgotten["ffffffff-7777-0000-0000-000000000001"] = at;
  A.equal(ro_.restoreItem({ ...line[ra2.id], id: "rq_forgotten-1", anchor: { ...line[ra2.id].anchor, sessionId: "ffffffff-7777-0000-0000-000000000001" } }), null, "a forgotten session's item stays out");

  // 6b. a legacy month file's line was never counted on session.archived: its restore leaves the count; an
  // items file's lowers it; a restore with no `reopen` at all reopens
  const RL = "rlrlrlrl-7777-0000-0000-000000000001";
  const rl = Store.fromText(null);
  const lv = (type, p) => ({ v: 1, id: `rl${++n}`, type, at: (at += 1000), terminal: "t75", session_id: RL, ...p });
  rl.apply(lv("session_start", { agent: "claude-code", source: "startup", cwd: "/rl", session_name: "legacy", turn: 0 }));
  rl.d.sessions[RL].archived = 2; rl.d.sessions[RL].nextHandle = { A: 10, Q: 1, P: 1 };
  const old9 = { id: "rq_legacy-9", key: "k9", handle: "A9", direction: "agent_to_human", text: "from a month file", kind: "do", level: "needed",
    anchor: { sessionId: RL, turn: 1, hash: "x9" }, status: "resolved", createdAt: at - 40 * DAY, updatedAt: at - 40 * DAY, resolvedAt: at - 40 * DAY };
  rr = rl.apply(lv("restore", { item: old9.id, file: "2026-10.jsonl", reopen: true, record: old9 }));
  A.equal(rr.restore.ok, true); A.equal(rl.d.sessions[RL].archived, 2, "a legacy month file's line: the count as it was (it never held it)");
  A.equal(rl.item(old9.id).handle, "A9", "below nextHandle and no other item's: its own handle"); A.equal(rl.item(old9.id).handleWas, undefined);
  rr = rl.apply(lv("restore", { item: "rq_items-8", file: "items-1800000000000-a1b2c3.jsonl", record: { ...old9, id: "rq_items-8", handle: "A8", key: "k8" } }));
  A.equal(rl.d.sessions[RL].archived, 1, "an items file's line: one fewer");
  A.equal(rl.item("rq_items-8").status, "open", "reopened, with no reopen field at all");
  // R5: the session record made again (Forget's memory let it go, or a corrupt store was set aside): its
  // counter starts at 1 and the new A1 is another item, so the archived A1 comes back as the next handle, its
  // old one kept as handleWas; one at or above the counter too (it would be handed out again); the counter
  // moves past both, so nothing is ever issued twice.
  const RH = "rhrhrhrh-7777-0000-0000-000000000001";
  const rh = Store.fromText(null);
  const hv = (type, p) => ({ v: 1, id: `rh${++n}`, type, at: (at += 1000), terminal: "t76", session_id: RH, ...p });
  rh.apply(hv("session_start", { agent: "claude-code", source: "startup", cwd: "/rh", session_name: "again", turn: 0 }));
  rh.apply(hv("prompt", { turn: 1, prompt_id: "hp1", local: false, prompt_head: "go", refs: [] }));
  rh.apply(hv("asks", { turn: 1, source: "block", asks: [ask("A new first ask", "do")] }));
  const newA1 = rh.byHandle(RH, "A1");
  A.equal(rh.d.sessions[RH].nextHandle.A, 2);
  const oldA1 = { ...old9, id: "rq_old-a1", key: "ka1", handle: "A1", anchor: { ...old9.anchor, sessionId: RH } };
  rr = rh.apply(hv("restore", { item: oldA1.id, file: "items-1800000000000-a1b2c3.jsonl", reopen: true, record: oldA1 }));
  A.equal(rr.restore.ok, true);
  A.equal(rh.item(oldA1.id).handle, "A2", "its A1 is the new session's: the next handle"); A.equal(rh.item(oldA1.id).handleWas, "A1", "...the old one kept");
  A.equal(rh.byHandle(RH, "A1").id, newA1.id, "A1 stays the new ask's, once");
  const oldA7 = { ...old9, id: "rq_old-a7", key: "ka7", handle: "A7", anchor: { ...old9.anchor, sessionId: RH } };
  rh.apply(hv("restore", { item: oldA7.id, file: "items-1800000000000-a1b2c3.jsonl", reopen: true, record: oldA7 }));
  A.equal(rh.item(oldA7.id).handle, "A3", "A7 at or above the counter (it would be handed out again): the next handle"); A.equal(rh.item(oldA7.id).handleWas, "A7");
  rh.apply(hv("asks", { turn: 2, source: "block", asks: [ask("Another new ask", "do")] }));
  const hs = rh.itemsOf(RH).map((x) => x.handle).sort();
  A.deepEqual(hs, ["A1", "A2", "A3", "A4"], "no handle twice"); A.equal(rh.d.sessions[RH].nextHandle.A, 5);
  const oldQ = { ...old9, id: "rq_old-q1", key: "kq1", handle: "Q1", direction: "human_to_agent", kind: "question", anchor: { ...old9.anchor, sessionId: RH } };
  rh.apply(hv("restore", { item: oldQ.id, file: "items-1800000000000-a1b2c3.jsonl", record: oldQ }));
  A.equal(rh.item(oldQ.id).handle, "Q1", "a question's counter is its own: Q1 at it is the next Q, itself");
  A.equal(rh.item(oldQ.id).handleWas, undefined, "...so nothing to keep"); A.equal(rh.d.sessions[RH].nextHandle.Q, 2, "...and the counter moves past it");

  // 7. after archiving: a same-text re-raise is a new item (no crash, no parent); handles are never reused
  const RX = "rxrxrxrx-7777-0000-0000-000000000001";
  const rx = Store.fromText(null);
  const xv = (type, p) => ({ v: 1, id: `rx${++n}`, type, at: (at += 1000), terminal: "t74", session_id: RX, ...p });
  rx.apply(xv("session_start", { agent: "claude-code", source: "startup", cwd: "/rx", session_name: "reraise", turn: 0 }));
  rx.apply(xv("prompt", { turn: 1, prompt_id: "xp1", local: false, prompt_head: "go", refs: [] }));
  rx.apply(xv("asks", { turn: 1, source: "model", asks: [ask("Run the load test", "do")] }));
  rx.apply(xv("capture", { turn: 1, request: req("rq_rxq1", "Why is the pool shared?", null, {}, RX, 1) }));
  rx.apply({ ...pinEv("The pool is shared.", { turn: 1 }, RX, "t74"), id: `rx${++n}` });
  const xa1 = rx.byHandle(RX, "A1");
  rx.act(xa1.id, "resolve", null, at); rx.act("rq_rxq1", "resolve", null, at);
  const xPins = JSON.stringify(rx.d.pins);
  A.deepEqual(rx.removeItems(rx.archivable(3, at + 30 * DAY)).map((x) => x.handle).sort(), ["A1", "Q1"]);
  A.equal(rx.d.sessions[RX].archived, 2); A.equal(JSON.stringify(rx.d.pins), xPins, "the pin stays, untouched");
  rx.apply(xv("prompt", { turn: 5, prompt_id: "xp5", local: false, prompt_head: "go", refs: [] }));
  rx.apply(xv("asks", { turn: 5, source: "model", asks: [ask("Run the load test", "do")] }));
  const xa2 = rx.itemsOf(RX).find((x) => x.text === "Run the load test");
  A.equal(xa2.handle, "A2", "a new item, and A1 is never handed out again"); A.equal(xa2.status, "open");
  A.equal(xa2.parentId, undefined, "no parent (the original is archived)"); A.equal(xa2.repeatOf, undefined);
  rx.apply(xv("asks", { turn: 6, source: "model", asks: [ask("Please run the load test now", "do", { repeat_of: xa1.id }), ask("Run it after the reboot", "do", { repeat_of_handle: "A1" })] }));
  const xa3 = rx.byHandle(RX, "A3"), xa4 = rx.byHandle(RX, "A4");
  A.equal(xa3.repeatOf, xa1.id, "repeat_of an archived id: kept as given, nothing looked up"); A.equal(rx.item(xa3.repeatOf), null);
  A.equal(xa4.repeatOf, undefined, "repeat_of_handle of an archived ask: a new item"); A.equal(xa4.status, "open");
  rx.apply(xv("capture", { turn: 6, request: req("rq_rxq2", "Is the reboot needed?", null, {}, RX, 6) }));
  A.equal(rx.item("rq_rxq2").handle, "Q2", "Q1 is never handed out again");
  rx.apply(xv("prompt", { turn: 7, prompt_id: "xp7", local: false, prompt_head: "[A1] yes [Q1] and", refs: ["A1", "Q1"] }));
  A.equal(xa2.status, "open", "a ref to an archived handle marks nothing");
  rx.apply(xv("answers_landed", { turn: 7, for_session: RX, handles: ["A1"], answers: { A1: "yes" } }));
  A.equal(rx.itemsOf(RX).filter((x) => x.status === "answered").length, 0, "...nor does an answer sheet naming it");
  A.deepEqual(rx.removeItems([{ id: xa1.id, updatedAt: xa1.updatedAt }]), [], "already archived: nothing");

  // 8. a store of realistic size, in the live store's proportions (8 sessions, 60 turn records each, 800
  // items, 60 % of them closed long ago, a few pins): slimmed by exactly the archived items and turn lines
  // and the lossless fields, nothing else; past Herdr's 1 MiB text-file cap before, well under it after
  {
    const NS = 8, TURNS = 60, PER = 100, WORDS_ = ["the", "pool", "gateway", "retries", "budget", "client", "worker", "migration", "staging", "cache", "is", "shared", "per"];
    const say = (seed, len) => { let s = ""; for (let i = 0; s.length < len; i++) s += `${WORDS_[(seed * 7 + i * 3) % WORDS_.length]} `; return s.slice(0, len).trim(); };
    const hex = (seed, len) => {   // deterministic, distinct per seed (an LCG)
      let x = Math.imul(seed + 1, 2654435761) >>> 0, s = "";
      while (s.length < len) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; s += (x >>> 8).toString(16).padStart(6, "0"); }
      return s.slice(0, len);
    };
    const uuidOf = (seed) => `${hex(seed, 8)}-${hex(seed + 1, 4)}-4${hex(seed + 2, 3)}-8${hex(seed + 3, 3)}-${hex(seed + 4, 12)}`;
    const sids = Array.from({ length: NS }, (_, i) => uuidOf(1000 + i));
    const data = { v: 1, items: {}, sessions: {}, branches: {}, terminals: {}, turns: {}, ingested: Array.from({ length: 1000 }, (_, i) => `ev-${uuidOf(i)}`), forgotten: {}, pins: {}, houseAt: NOW - 2 * DAY };
    let seed = 0;
    for (const [si, sid] of sids.entries()) {
      data.sessions[sid] = { sessionId: sid, agent: "claude-code", terminal: `t${si + 1}`, sessionName: `session ${si}`, cwd: `/Users/x/src/repo-${si}`, repo: `repo-${si}`,
        transcriptPath: `/Users/x/.claude/projects/-Users-x-src-repo-${si}/${sid}.jsonl`, model: "claude-opus-5-5", turn: TURNS, turnSource: "hooks", state: "idle",
        nextHandle: { A: PER + 1, Q: 1, P: 2 }, startedAt: NOW - 40 * DAY, updatedAt: NOW, seenAt: NOW, promptAt: NOW, surfaced: false };
      data.terminals[`t${si + 1}`] = { sessionId: sid, agent: "claude-code", updatedAt: NOW, space: null };
      data.turns[sid] = {};
      for (let t = 1; t <= TURNS; t++) {
        data.turns[sid][t] = { stopAt: NOW - (TURNS - t) * 3600e3, textPath: CFG.turnPath(sid, t), textHead: say(++seed, 400), promptId: uuidOf(++seed), uuid: uuidOf(++seed),
          asks: { source: t % 9 ? "tool" : "model", error: null, errorDetail: null, blockError: null, count: 3, at: NOW - (TURNS - t) * 3600e3 + 900, model: t % 9 ? null : "claude-haiku-5-5", provider: null },
          passageHash: hex(++seed, 12) };
      }
      for (let i = 0; i < PER; i++) {
        const id = `rq_${uuidOf(++seed)}`, turn = 1 + (i % TURNS), quote = say(++seed, 520), text = say(++seed, 230);
        // 60 % closed long ago (resolved 5 to 40 days, or dismissed 8 to 40 days), 7 % dismissed 4 days ago
        // (the floor keeps them), 7 % resolved a day ago, 26 % open (most of them below the threshold)
        const kind = i % 100 < 50 ? "resolved-old" : i % 100 < 60 ? "dismissed-old" : i % 100 < 67 ? "dismissed-recent" : i % 100 < 74 ? "resolved-recent" : "open";
        const age = kind === "resolved-old" ? 5 + (i % 35) : kind === "dismissed-old" ? 8 + (i % 32) : kind === "dismissed-recent" ? 4 : kind === "resolved-recent" ? 1 : 2;
        const status = kind.startsWith("resolved") ? "resolved" : kind.startsWith("dismissed") ? "dismissed" : "open";
        const options = i % 3 ? [] : [say(++seed, 40), say(++seed, 40)];
        data.items[id] = { id, key: `${sid}|a|${text.toLowerCase()}`, handle: `A${i + 1}`, direction: "agent_to_human", text, kind: "decide", level: i % 4 ? "needed" : "optional",
          options, recommended: options[0] ?? null, blocking: false,
          anchor: { sessionId: sid, turn, promptId: uuidOf(++seed), uuid: uuidOf(++seed), apiMessageId: null, quote, quoteSource: "tool", hash: hex(++seed, 12), settled: true },
          status, origin: "tool", terminal: `t${si + 1}`, createdTurn: turn, createdAt: NOW - (age + 1) * DAY, updatedAt: NOW - age * DAY, seq: i % 5,
          ...(status === "open" ? {} : { resolvedAt: NOW - age * DAY, resolvedTurn: turn + 1 }), ...(i % 5 === 0 ? { answer: say(++seed, 120), answeredTurn: turn + 1 } : {}) };
      }
      const pid = `pn_${uuidOf(++seed)}`;
      data.pins[pid] = { id: pid, handle: "P1", sessionId: sid, text: say(++seed, 900), note: null, anchor: { sessionId: sid, turn: 3, hash: hex(++seed, 12), settled: true },
        source: { sessionName: `session ${si}`, cwd: `/Users/x/src/repo-${si}` }, status: "open", createdAt: NOW - 20 * DAY, updatedAt: NOW - 20 * DAY, usedIn: [], answeredIn: [] };
    }
    const orig = JSON.stringify(data);
    const big = Store.fromText(orig);
    const items_ = big.archivable(CFG.DEFAULTS.retention_days, NOW), turnsPlan = big.planSlim(CFG.DEFAULTS.retention.turns);
    A.equal(items_.length, NS * PER * 0.6, "60 % of the items are past retention (the recent dismissals are kept by the 7-day floor)");
    A.equal(turnsPlan.cut.length, NS * (TURNS - 12), "48 records cut per session"); A.equal(turnsPlan.heads.length, NS * 10, "10 heads per session");
    // the archive lines the writer would write, read back
    const itemLines = items_.map((x) => JSON.stringify(x));
    const turnLines = [...turnsPlan.cut.map((c) => JSON.stringify({ sessionId: c.sessionId, turn: c.turn, rec: c.rec })),
      ...turnsPlan.heads.map((h) => JSON.stringify({ sessionId: h.sessionId, turn: h.turn, textHead: h.textHead }))];
    A.equal(big.toText(), orig, "planning changed nothing");
    const removed = big.removeItems(itemLines.map((l) => JSON.parse(l)));
    A.equal(removed.length, items_.length, "every planned item removed");
    A.deepEqual(big.applySlim(turnsPlan), { cut: turnsPlan.cut.length, heads: turnsPlan.heads.length });
    const slim = big.toText();
    // the oracle: the original less exactly the archived lines and the lossless fields, plus the counts
    const want = JSON.parse(orig);
    for (const it of removed) { delete want.items[it.id]; const s = want.sessions[it.anchor.sessionId]; s.archived = (s.archived ?? 0) + 1; }
    for (const c of turnsPlan.cut) delete want.turns[c.sessionId][c.turn];
    for (const h of turnsPlan.heads) delete want.turns[h.sessionId][h.turn].textHead;
    oracleLean(want.turns);
    A.equal(slim, JSON.stringify(want), "the slimmed store is exactly the expected text");
    A.deepEqual(Object.values(big.d.sessions).map((s) => s.archived), Array(NS).fill(PER * 0.6), "each session counts its archived items");
    // nothing lost: the slimmed store plus the archive lines give back the original (less the lossless fields)
    const rebuilt = JSON.parse(slim);
    for (const l of itemLines) { const it = JSON.parse(l); rebuilt.items[it.id] = it; }
    for (const l of turnLines) { const x = JSON.parse(l); if (x.rec) rebuilt.turns[x.sessionId][x.turn] = x.rec; else rebuilt.turns[x.sessionId][x.turn].textHead = x.textHead; }
    for (const s of Object.values(rebuilt.sessions)) delete s.archived;
    const origData = JSON.parse(orig);
    A.deepEqual(rebuilt.items, origData.items, "every item is in the store or an archive line, as it was");
    A.deepEqual(oracleLean(rebuilt.turns), oracleLean(origData.turns), "every turn record and head is in the store or an archive line");
    A.deepEqual(rebuilt.pins, origData.pins, "pins untouched");
    A.deepEqual({ ...rebuilt, items: null, turns: null }, { ...origData, items: null, turns: null }, "nothing else changed");
    A.ok(orig.length > 1024 * 1024, `the fixture is past Herdr's 1 MiB text-file cap (${orig.length})`);
    A.ok(slim.length < 1024 * 1024, `...and under it after: the fast write path again (${slim.length})`);
    A.ok(slim.length < orig.length * 0.5, `more than half goes (${(slim.length / orig.length * 100).toFixed(0)} % left)`);
    retSizes = `, ${(orig.length / 1e6).toFixed(2)} MB slimmed to ${(slim.length / 1e6).toFixed(2)} MB`;
  }

  // 9. what Phase 2 (cold files for idle sessions) builds on: one safe name for a session's folder; slimming
  // keeps every timestamp an idle clock reads (stopAt, asks.at, retry.at); removeItems, applySlim and
  // restoreItem set no updatedAt on what they do not otherwise change; retention.turns filled into a
  // config.json that lacks it (an older install's)
  {
    const S = await import(`${dir}/store.js`), SPm = await import(`${dir}/spool.js`);
    A.equal(S.safeName, CFG.safeName, "store.js re-exports config.js safeName (one function)");
    const names = ["5e550000-0000-4000-8000-000000000000", "herdr:t3/x y", "..", ".", "a/../b", "ünï cødé", "tab\there", "x".repeat(130), "__proto__", "", "a😀b"];
    A.deepEqual(names.map(CFG.safeName), ["5e550000-0000-4000-8000-000000000000", "herdr_t3_x_y", "..", ".", "a_.._b", "_n__c_d_", "tab_here", "x".repeat(130), "__proto__", "", "a_b"],
      "every character outside A-Za-z0-9._- one _ (per code point)");
    A.deepEqual(names.map(SPm.archiveDir), names.map((n) => (n && n !== "." && n !== ".." ? CFG.safeName(n) : null)), "spool.js archiveDir is safeName, '.' and '..' and empty refused");
    // test-store.sh runs bin/lib's safe_name on the same names and compares.
    fsm.writeFileSync(`${dir}/safe-names.json`, JSON.stringify(names.map((n) => [n, CFG.safeName(n)])));
    // Timestamps through applySlim, kept and cut alike (the cut one is in its turns line as it was).
    const P2 = "p2p2p2p2-7777-0000-0000-000000000001";
    const ts = new Store({ v: 1, items: {}, branches: {}, terminals: {}, ingested: [], forgotten: {}, pins: {},
      sessions: { [P2]: { sessionId: P2, agent: "claude-code", turn: 20, state: "idle", turnSource: "hooks", cwd: "/p2", nextHandle: { A: 3, Q: 1, P: 1 }, updatedAt: NOW - 5 * DAY, stopAt: NOW - 5 * DAY } },
      turns: { [P2]: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, { stopAt: NOW - (20 - i) * 1000, textPath: CFG.turnPath(P2, i + 1), textHead: `h${i + 1}`,
        promptId: null, uuid: null, asks: { source: "model", error: null, count: 0, at: NOW - (20 - i) * 1000 + 5, model: null, provider: null },
        retry: { at: NOW - (20 - i) * 1000 + 9, state: "done", note: null } }])) } });
    for (const [id, status, age] of [["rq_p2a", "resolved", 10], ["rq_p2b", "open", 10]]) {
      ts.d.items[id] = { id, key: id, handle: id === "rq_p2a" ? "A1" : "A2", direction: "agent_to_human", text: id, kind: "do", level: "needed",
        anchor: { sessionId: P2, turn: 1, hash: id }, status, createdAt: NOW - 30 * DAY, updatedAt: NOW - age * DAY, ...(status === "resolved" ? { resolvedAt: NOW - age * DAY } : {}) };
    }
    const sessBefore = JSON.stringify(ts.d.sessions[P2]), openBefore = JSON.stringify(ts.d.items.rq_p2b);
    const plan9 = ts.planSlim(12);
    A.ok(plan9.cut.every((c) => typeof c.rec.stopAt === "number" && c.rec.asks.at && c.rec.retry.at), "a cut record carries its timestamps to its turns line");
    ts.applySlim(plan9);
    const kept = Object.entries(ts.d.turns[P2]);
    A.equal(kept.length, 12);
    A.ok(kept.every(([n, r]) => r.stopAt === NOW - (20 - (n - 1)) * 1000), "applySlim keeps every record's stopAt");
    A.ok(kept.every(([n, r]) => r.asks.at === NOW - (20 - (n - 1)) * 1000 + 5 && r.retry.at === NOW - (20 - (n - 1)) * 1000 + 9), "...and asks.at, retry.at");
    A.ok(kept.every(([, r]) => !("updatedAt" in r)), "...and adds no updatedAt to a record");
    const removed9 = ts.removeItems(ts.archivable(3, NOW));
    A.deepEqual(removed9.map((x) => x.id), ["rq_p2a"]);
    const sAfter = JSON.parse(JSON.stringify(ts.d.sessions[P2]));
    A.equal(sAfter.archived, 1); delete sAfter.archived;
    A.equal(JSON.stringify(sAfter), sessBefore, "removeItems and applySlim change the session only by its archived count (no updatedAt, no stopAt)");
    A.equal(JSON.stringify(ts.d.items.rq_p2b), openBefore, "...and leave an item they do not take as it was");
    const back9 = ts.restoreItem(removed9[0]);
    A.equal(back9.updatedAt, NOW - 10 * DAY, "restoreItem keeps the record's updatedAt");
    const sBack = JSON.parse(JSON.stringify(ts.d.sessions[P2]));
    A.equal("archived" in sBack, false);
    A.equal(JSON.stringify(sBack), sessBefore, "...and changes the session only by its count");
    // A config.json written before retention.turns existed: the mod's merge fills it in.
    globalThis.__herdr = { files: { [CFG.configPath()]: JSON.stringify({ v: 1, retention_days: 14, extract: { threshold: "blocking" } }) } };
    const merged = await CFG.loadConfig();
    A.equal(merged._source, "file"); A.equal(merged.retention_days, 14, "the file's retention_days wins over the default");
    A.deepEqual(merged.retention, { turns: 12, coldDays: 7 }, "retention.turns (and coldDays) filled in from the defaults");
    globalThis.__herdr = { files: { [CFG.configPath()]: JSON.stringify({ retention: { coldDays: 3 } }) } };
    A.deepEqual((await CFG.loadConfig()).retention, { turns: 12, coldDays: 3 }, "a partial retention keeps turns");
    globalThis.__herdr = { files: { [CFG.configPath()]: JSON.stringify({ retention: null }) } };
    A.deepEqual((await CFG.loadConfig()).retention, { turns: 12, coldDays: 7 }, "a null retention: the defaults");
    globalThis.__herdr = {};
  }
}
const retChecks = checks - phase1 - phase2 - phase3 - sev - prof - toolChecks - settleChecks - spaceChecks - pinChecks;

// ── Retention Phase 2: cold sessions (2026-11-19) ───────────────────────
let coldSizes = "";
{
  const SC = await import(`${dir}/store.js`);
  const { ColdError, COLD_FREE, COLD_FORMAT, coldRecordError, COLD_THAWED_MAX } = SC;
  const { liveShape } = await import(new URL("./fixture_cold.mjs", import.meta.url).href);
  const DAY = 86400e3, NOW = 1795100000000;
  let cn = 0;
  const fileFor = (p, r = "a1b2c3") => CFG.coldName(p.sid, p.record.at, r);
  // A plan frozen as the writer does it: each file's text is JSON.stringify(record), read back and parsed.
  const freeze = (store, plan, now = NOW) => {
    const done = plan.map((p) => ({ ...p, file: fileFor(p) }));
    const frozen = store.commitFreeze(done, now);
    const files = Object.fromEntries(done.filter((x) => frozen.includes(x.sid)).map((x) => [x.sid, { file: x.file, record: JSON.parse(JSON.stringify(x.record)) }]));
    return { done, frozen, files };
  };
  const planned = (st, days = 7, o = {}) => st.planFreeze(days, NOW, o).map((p) => p.sid);

  // 1. config: retention.coldDays, the names under cold/
  A.equal(CFG.DEFAULTS.retention.coldDays, 7);
  A.equal(CFG.coldDaysOf({}), 7, "missing: 7"); A.equal(CFG.coldDaysOf(null), 7);
  A.equal(CFG.coldDaysOf({ retention: { coldDays: 0 } }), 0, "0 is kept: never"); A.equal(CFG.coldDaysOf({ retention: { coldDays: "0" } }), 0);
  A.equal(CFG.coldDaysOf({ retention: { coldDays: "14" } }), 14, "a numeric string"); A.equal(CFG.coldDaysOf({ retention: { coldDays: 2.6 } }), 3, "rounded to whole days");
  A.equal(CFG.coldDaysOf({ retention: { coldDays: 0.2 } }), 1, "any positive value is at least one day (only 0 means never)");
  A.equal(CFG.coldDaysOf({ retention: { coldDays: 365 } }), 365); A.equal(CFG.coldDaysOf({ retention: { coldDays: 60 } }), 60);
  for (const bad of [-1, 366, "x", "", " ", true, null, NaN, Infinity, {}, []]) A.equal(CFG.coldDaysOf({ retention: { coldDays: bad } }), 7, `${JSON.stringify(bad)}: the default`);
  A.equal(CFG.coldDir(), "/tmp/nowhere/ledgr-data/cold"); A.equal(CFG.coldPath("x.json"), "/tmp/nowhere/ledgr-data/cold/x.json");
  A.equal(CFG.heldDir("herdr:t3/x"), "/tmp/nowhere/ledgr-data/cold/held/herdr_t3_x", "held/<safeName(sid)>");
  const nm = CFG.coldName("herdr:t3", 1795100000000, "a1b2c3");
  A.equal(nm, "herdr_t3.1795100000000-a1b2c3.json"); A.deepEqual([...CFG.COLD_NAME.exec(nm)].slice(1), ["herdr_t3", "1795100000000", "a1b2c3"]);
  A.deepEqual(CFG.COLD_NAME.exec(CFG.coldName("a.b.1234567890123-abcdef", 1795100000000, "zz9900")).slice(1), ["a.b.1234567890123-abcdef", "1795100000000", "zz9900"], "the last ms-rand6 is the file's");
  for (const bad of ["x.179510000000-a1b2c3.json", "x.1795100000000-A1b2c3.json", "x.1795100000000-a1b2c.json", ".1795100000000-a1b2c3.json",
    "x.1795100000000-a1b2c3.json.tmp", "x.1795100000000-a1b2c3.jsonl", "held"]) A.equal(CFG.COLD_NAME.test(bad), false, `not a cold file name: ${bad}`);
  A.equal(SC.safeName, CFG.safeName, "one safe name (config.js), re-exported by store.js");
  A.equal(COLD_FORMAT, "ledgr-cold");
  A.deepEqual([...COLD_FREE].sort(), ["cold_reset", "forget", "pin_archive", "pin_delete", "pin_note", "pin_restore"], "COLD_FREE: the pin ops, forget, cold_reset");

  // 2. planFreeze: a small store, one session idle 10 days with items and turn records; each rule on its own
  const S0 = "c0c0c0c0-0000-4000-8000-000000000001", T10 = NOW - 10 * DAY;
  const mk = () => {
    const it = (id, handle, extra) => ({ id, key: id, handle, direction: "agent_to_human", text: `ask ${id}`, kind: "decide", level: "needed",
      anchor: { sessionId: S0, turn: 2, hash: id }, status: "open", createdAt: T10 - DAY, updatedAt: T10, ...extra });
    const q = it("rq_c0q", "Q1", { direction: "human_to_agent", kind: "question", text: "Why is the pool shared?" });
    delete q.level;
    return new Store({ v: 1, items: {
      rq_c0a: it("rq_c0a", "A1", { level: "blocking", blocking: true }),
      rq_c0b: it("rq_c0b", "A2", { status: "answered", answer: "a", draft: "a" }),
      rq_c0q: q,
    }, sessions: { [S0]: { sessionId: S0, agent: "claude-code", terminal: "t1", turn: 3, turnSource: "hooks", state: "idle", cwd: "/c0", nextHandle: { A: 3, Q: 2, P: 1 },
      startedAt: T10 - DAY, updatedAt: T10, seenAt: T10, promptAt: T10, surfaced: false, lastStopAt: T10 } },
    branches: {}, terminals: { t1: { sessionId: S0, agent: "claude-code", updatedAt: T10 } }, ingested: [], forgotten: {}, pins: {},
    turns: { [S0]: { 2: { stopAt: T10 - 600e3, asks: { source: "tool", count: 2, at: T10 - 600e3 } }, 3: { stopAt: T10 } } }, retention: { v: 1, at: NOW - 20 * DAY } });
  };
  A.deepEqual(planned(mk()), [S0], "idle 10 days, with items and turn records: planned");
  A.equal(mk().touchedAt(S0), T10);
  A.deepEqual(planned(mk(), 11), [], "11 days: not idle long enough"); A.deepEqual(planned(mk(), 10), [], "exactly 10 days: not past it");
  A.deepEqual(planned(mk(), "7"), [S0], "days as a numeric string");
  for (const d0 of [0, "0", null, undefined, "x", -3]) A.deepEqual(mk().planFreeze(d0, NOW), [], `days ${JSON.stringify(d0)}: never`);
  { const st = mk(); delete st.d.retention; A.deepEqual(planned(st), [], "before Phase 1's first run has finished (no d.retention)");
    st.d.retention = { v: 2 }; A.deepEqual(planned(st), [], "...or another version"); }
  {
    const st = mk(), t0 = st.toText(), plan = st.planFreeze(7, NOW);
    A.equal(st.toText(), t0, "planFreeze mutates nothing");
    const r = plan[0].record;
    A.deepEqual(Object.keys(r), ["ledgr", "v", "sessionId", "at", "session", "items", "turns", "n"], "the cold file's fields, in order");
    A.equal(r.ledgr, "ledgr-cold"); A.equal(r.v, 1); A.equal(r.sessionId, S0); A.equal(r.at, NOW);
    A.deepEqual(r.session, st.d.sessions[S0]); A.notEqual(r.session, st.d.sessions[S0], "copies");
    A.deepEqual(r.items, st.itemsOf(S0), "the items in itemsOf order"); A.notEqual(r.items[0], st.itemsOf(S0)[0]);
    A.deepEqual(r.turns, st.d.turns[S0]); A.notEqual(r.turns, st.d.turns[S0]);
    A.deepEqual(r.n, { q: 1, qNew: 0, blocking: 1, needed: 0, optional: 0, promoted: 0, answered: 1, closed: 0, items: 3, turns: 2 }, "the counts by level");
    const st2 = mk(); st2.d.sessions[S0].promptAt = T10 - 2 * DAY;
    A.equal(st2.coldCounts(S0).qNew, 1, "qNew: the open questions created at or after the last prompt");
    A.equal(plan[0].sig, JSON.stringify({ items: st.itemsOf(S0), turns: st.d.turns[S0] }), "sig: the items and turn records as one text");
    A.equal(coldRecordError(JSON.parse(JSON.stringify(r)), S0), null, "a planned record passes the check thaw makes");
  }
  // The idle clock, field by field: a day ago keeps the session warm; 8 days ago it still goes (and the clock reads it).
  const clock = {
    touchedAt: (st, v) => { st.d.sessions[S0].touchedAt = v; }, updatedAt: (st, v) => { st.d.sessions[S0].updatedAt = v; },
    thawedAt: (st, v) => { st.d.sessions[S0].thawedAt = v; },
    promptAt: (st, v) => { st.d.sessions[S0].promptAt = v; }, lastStopAt: (st, v) => { st.d.sessions[S0].lastStopAt = v; },
    "resume.at": (st, v) => { st.d.sessions[S0].resume = { at: v, state: "resumed" }; },
    "resume.resumedAt": (st, v) => { st.d.sessions[S0].resume = { at: T10 - DAY, state: "resumed", resumedAt: v }; },
    "lastClear.at": (st, v) => { st.d.sessions[S0].lastClear = { at: v, cleared: 1, kept: 0 }; },
    "an item's updatedAt": (st, v) => { st.d.items.rq_c0b.updatedAt = v; },
    "a turn record's stopAt": (st, v) => { st.d.turns[S0][3].stopAt = v; },
    "a turn record's asks.at": (st, v) => { st.d.turns[S0][2].asks.at = v; },
    "a turn record's retry.at": (st, v) => { st.d.turns[S0][3].retry = { at: v, state: "done" }; },
  };
  for (const [k, f] of Object.entries(clock)) {
    const st = mk(); f(st, NOW - DAY);
    A.equal(st.touchedAt(S0), NOW - DAY, `${k} moves the idle clock`); A.deepEqual(planned(st), [], `${k} a day ago: warm`);
    const st8 = mk(); f(st8, NOW - 8 * DAY);
    A.equal(st8.touchedAt(S0), NOW - 8 * DAY); A.deepEqual(planned(st8), [S0], `${k} 8 days ago: still idle past 7`);
  }
  {
    // Integration (2026-11-19): seenAt is not on the clock. A session only looked at is not in use: the panel
    // posts `seen` whenever it shows a surfaced session, and a cold one's menu row then said "idle 1 min".
    const st = mk(); st.d.sessions[S0].seenAt = NOW - DAY;
    A.equal(st.touchedAt(S0), T10, "seenAt does not move the idle clock"); A.deepEqual(planned(st), [S0], "seen a day ago: still goes cold");
  }
  {
    const st = mk();
    st.d.items.rq_other = { id: "rq_other", handle: "A1", direction: "agent_to_human", anchor: { sessionId: "another" }, status: "open", updatedAt: NOW };
    st.d.pins.pn_00000000 = { id: "pn_00000000", sessionId: S0, status: "open", updatedAt: NOW, anchor: { sessionId: S0 } };
    A.equal(st.touchedAt(S0), T10, "another session's items and the session's pins do not move the clock"); A.deepEqual(planned(st), [S0]);
  }
  // What never goes cold, each on its own (the store's rules), and what does not stop it.
  const branch = (st, side, status) => {
    st.d.branches.br_00000000x = { id: "br_00000000x", name: "br-q1-0000", requestId: "rq_c0q", status,
      parentSessionId: side === "parent" ? S0 : "pppppppp-0000-4000-8000-000000000009", sessionId: side === "child" ? S0 : null };
  };
  const never = {
    "an item deferred to the next session": (st) => Object.assign(st.d.items.rq_c0b, { status: "deferred", deferUntil: "next_session" }),
    "an item deferred to a time": (st) => Object.assign(st.d.items.rq_c0b, { status: "deferred", deferUntil: NOW + DAY }),
    "a question rejoin_pending": (st) => { st.d.items.rq_c0q.status = "rejoin_pending"; },
    "a question with it.rejoin": (st) => { st.d.items.rq_c0q.rejoin = { branchId: "br_00000000x", at: T10 }; },
    "a resume launching": (st) => { st.d.sessions[S0].resume = { at: T10, state: "launching" }; },
    "a resume launched": (st) => { st.d.sessions[S0].resume = { at: T10, state: "launched" }; },
    "an extraction re-run requested": (st) => { st.d.turns[S0][2].retry = { at: T10, state: "requested" }; },
    "an extraction re-run running": (st) => { st.d.turns[S0][2].retry = { at: T10, state: "running" }; },
  };
  for (const side of ["parent", "child"]) for (const status of ["launching", "launched", "running", "concluded"]) never[`a branch ${status}, the session its ${side}`] = (st) => branch(st, side, status);
  for (const [k, f] of Object.entries(never)) {
    const st = mk(); f(st);
    A.deepEqual(planned(st), [], `never cold: ${k}`); A.ok(st.freezeBlocker(S0), `freezeBlocker names it: ${k}`);
  }
  const fine = {
    "an open blocking ask (its counts are kept)": () => {}, "an open ask with a draft": (st) => { st.d.items.rq_c0a.draft = "typed, not sent"; },
    "a resume resumed": (st) => { st.d.sessions[S0].resume = { at: T10, state: "resumed" }; },
    "a resume failed": (st) => { st.d.sessions[S0].resume = { at: T10, state: "failed" }; },
    "a re-run done": (st) => { st.d.turns[S0][2].retry = { at: T10, state: "done" }; },
    "a re-run failed": (st) => { st.d.turns[S0][2].retry = { at: T10, state: "failed" }; },
    "an item deferred in another session": (st) => { st.d.items.rq_far = { id: "rq_far", anchor: { sessionId: "far" }, status: "deferred", deferUntil: "next_session", updatedAt: NOW }; },
  };
  for (const side of ["parent", "child"]) for (const status of ["rejoined", "refused", "failed"]) fine[`a branch ${status}, the session its ${side}`] = (st) => branch(st, side, status);
  for (const [k, f] of Object.entries(fine)) { const st = mk(); f(st); A.deepEqual(planned(st), [S0], `still goes cold: ${k}`); A.equal(st.freezeBlocker(S0), null); }
  {
    const st = mk(); st.d.items = {}; delete st.d.turns[S0];
    A.deepEqual(planned(st), [], "no items and no turn records: nothing to move, no file");
    const st2 = mk(); st2.d.items = {}; A.deepEqual(planned(st2), [S0], "turn records only: planned");
    const st3 = mk(); delete st3.d.turns[S0]; A.deepEqual(planned(st3), [S0], "items only: planned");
    A.deepEqual(st3.planFreeze(7, NOW)[0].record.turns, {}, "...with an empty turn map in the file");
  }
  A.deepEqual(planned(mk(), 7, { canFreeze: () => false }), [], "canFreeze false (the writer's: a live terminal, the open dialog, the running pass)");
  A.deepEqual(planned(mk(), 7, { canFreeze: () => { throw new Error("x"); } }), [], "canFreeze throwing: not frozen");
  A.deepEqual(planned(mk(), 7, { canFreeze: () => 1 }), [], "only true lets it go");
  { let asked = []; planned(mk(), 11, { canFreeze: (sid) => { asked.push(sid); return true; } }); A.deepEqual(asked, [], "canFreeze is asked only for sessions the store would move"); }
  {
    // oldest idle first, at most max; ids that make no file of their own stay
    const st = mk();
    const add = (sid, days) => {
      st.d.sessions[sid] = { ...st.d.sessions[S0], sessionId: sid, updatedAt: NOW - days * DAY, seenAt: 0, promptAt: 0, lastStopAt: 0 };
      st.d.turns[sid] = { 1: { stopAt: NOW - days * DAY } };
    };
    add("c1c1c1c1-0000-4000-8000-000000000001", 15); add("c2c2c2c2-0000-4000-8000-000000000001", 12); add("c3c3c3c3-0000-4000-8000-000000000001", 9);
    A.deepEqual(planned(st, 7, { max: 2 }), ["c1c1c1c1-0000-4000-8000-000000000001", "c2c2c2c2-0000-4000-8000-000000000001"], "max 2: the two idle longest");
    A.deepEqual(planned(st, 7), ["c1c1c1c1-0000-4000-8000-000000000001", "c2c2c2c2-0000-4000-8000-000000000001", S0, "c3c3c3c3-0000-4000-8000-000000000001"], "oldest idle first");
    A.deepEqual(planned(st, 7, { max: 0 }), []);
    add("herdr:t9", 20); add("herdr_t9", 20);
    A.equal(planned(st).includes("herdr:t9") || planned(st).includes("herdr_t9"), false, "two sessions with one safe name: neither (their files and held/ folders would be shared)");
    A.match(st.freezeBlocker("herdr:t9"), /same file name/);
    delete st.d.sessions.herdr_t9; delete st.d.turns.herdr_t9;
    A.ok(planned(st).includes("herdr:t9"), "alone: herdr:t9 goes (as herdr_t9.<ms>-<rand6>.json)");
    st.d.forgotten.herdr_t9 = NOW - DAY;
    A.equal(planned(st).includes("herdr:t9"), false, "a forgotten session's safe name counts too");
    for (const odd of [".", "..", ".hidden-session", "..x"]) { add(odd, 20); A.equal(planned(st).includes(odd), false, `the id ${odd} makes no file name`); A.match(st.freezeBlocker(odd), /no file name/); }
    add("x.hidden", 20); A.ok(planned(st).includes("x.hidden"), "a dot inside an id is fine");
  }

  // 3. commitFreeze: one step, only what is still as planned; the same plan twice is a no-op
  {
    const st = mk(), plan = st.planFreeze(7, NOW), file = fileFor(plan[0]);
    const pinsBefore = JSON.stringify(st.d.pins);
    const { frozen } = freeze(st, plan);
    A.deepEqual(frozen, [S0]);
    A.deepEqual(st.itemsOf(S0), [], "its items left the store"); A.equal(S0 in st.d.turns, false, "...and its turn records");
    A.deepEqual(st.d.sessions[S0].cold, { file, at: NOW, n: plan[0].record.n }, "the stub names the file, its time and its counts");
    A.equal(st.isCold(S0), true); A.deepEqual(st.coldSessions(), [S0]); A.deepEqual(st.mixedCold(), []);
    A.deepEqual(st.d.sessions[S0].nextHandle, { A: 3, Q: 2, P: 1 }, "nextHandle stays on the stub");
    A.equal(JSON.stringify(st.d.pins), pinsBefore);
    A.equal(st.d.sessions[S0].touchedAt, T10, "the stub keeps the idle clock it had (its items and turn records left)"); A.equal(st.touchedAt(S0), T10);
    const t1 = st.toText();
    A.deepEqual(st.commitFreeze(plan.map((p) => ({ ...p, file })), NOW), [], "the same plan again: nothing"); A.equal(st.toText(), t1);
    A.deepEqual(planned(st), [], "already cold: never planned again");
    A.equal(st.freezeBlocker(S0), "already cold");
  }
  {
    // Integration (2026-11-19): the clock read from an item past the record's own times survives the freeze. Before,
    // the stub read only its record, so "idle N d" counted from too early (and coldGarbage rule c read it too).
    const st = mk(), late = T10 + 3600e3;
    st.d.items.rq_c0a.updatedAt = late;
    A.equal(st.touchedAt(S0), late, "warm: an item's updatedAt is the latest");
    const { frozen } = freeze(st, st.planFreeze(7, NOW));
    A.deepEqual(frozen, [S0]);
    A.equal(st.d.sessions[S0].touchedAt, late, "the stub carries it in touchedAt"); A.equal(st.touchedAt(S0), late, "...and the clock reads the same after the freeze");
    const before = st.d.sessions[S0].touchedAt;
    st.apply({ v: 1, id: `cs${++cn}`, type: "act", session_id: S0, action: "seen", at: NOW });
    A.equal(st.d.sessions[S0].seenAt, NOW, "seen marks the stub's chip"); A.equal(st.touchedAt(S0), before, "...and leaves its idle clock where it was");
  }
  const changed = {
    "an item updated (a draft)": (st) => st.act("rq_c0b", "draft", "typed while the file was written", NOW),
    "a new item (a capture)": (st) => st.apply({ v: 1, id: `cf${++cn}`, type: "capture", at: NOW, session_id: S0, terminal: "t1",
      request: { id: "rq_new", text: "And the gateway?", anchor: { sessionId: S0, turn: 3, settled: true }, createdAt: NOW } }),
    "a new turn record (a stop)": (st) => st.apply({ v: 1, id: `cf${++cn}`, type: "stop", at: NOW, session_id: S0, turn: 4 }),
    "its record changed (seen)": (st) => st.markSeen(S0, NOW),
    "its record changed (a space)": (st) => st.noteSpace({ terminal: "t1", session_id: S0, space: "spX" }),
    "a branch started from it meanwhile (no item change)": (st) => st.apply({ v: 1, id: `cf${++cn}`, type: "branch_started", at: NOW,
      session_id: "dddddddd-0000-4000-8000-000000000001", terminal: "t9", parent_session_id: S0, depth: 1, fork_turn: 3, anchor_turn: 2 }),
    "a turn record changed (a re-run)": (st) => st.apply({ v: 1, id: `cf${++cn}`, type: "retry", at: NOW, session_id: S0, turn: 2 }),
  };
  for (const [k, f] of Object.entries(changed)) {
    const st = mk(), plan = st.planFreeze(7, NOW);
    f(st);
    const t = st.toText();
    A.deepEqual(freeze(st, plan).frozen, [], `changed since its plan, not frozen: ${k}`);
    A.equal(st.toText(), t, `...and nothing changed: ${k}`);
  }
  {
    const st = mk(), plan = st.planFreeze(7, NOW);
    A.deepEqual(st.commitFreeze(plan.map((p) => ({ ...p, file: fileFor(p) })), NOW, { canFreeze: () => false }), [], "canFreeze false at the commit");
    const bad = (file, rec = plan[0].record) => st.commitFreeze([{ ...plan[0], record: rec, file }], NOW);
    A.deepEqual(bad(CFG.coldName("another", NOW, "a1b2c3")), [], "a file named for another session");
    A.deepEqual(bad(CFG.coldName(S0, NOW + 1, "a1b2c3")), [], "a file whose ms is not the record's at");
    A.deepEqual(bad(`${S0}.json`), [], "not a cold file name"); A.deepEqual(bad(null), []);
    A.deepEqual(bad(fileFor(plan[0]), { ...plan[0].record, items: plan[0].record.items.slice(1) }), [], "a record that does not hold what leaves");
    A.deepEqual(bad(fileFor(plan[0]), { ...plan[0].record, n: { ...plan[0].record.n, q: 9 } }), [], "...or counts other than the items'");
    A.deepEqual(st.commitFreeze([{ ...plan[0], sig: "{}", file: fileFor(plan[0]) }], NOW), [], "a sig other than the store's");
    A.deepEqual(st.commitFreeze("x", NOW), []); A.deepEqual(st.commitFreeze([null, 7, { sid: "__proto__" }], NOW), []);
    const ret = st.d.retention; delete st.d.retention;
    A.deepEqual(st.commitFreeze(plan.map((p) => ({ ...p, file: fileFor(p) })), NOW), [], "no Phase 1 mark: nothing committed"); st.d.retention = ret;
    A.equal(st.isCold(S0), false, "after all of that: still warm");
    A.deepEqual(freeze(st, plan).frozen, [S0], "...and the plan itself commits");
  }

  // 4. coldNeeded, exhaustively: every on_* handler (and restore, an unknown type) has its decision here; a new
  // handler without one fails this test.
  const NEEDS = {
    session_start: "own", prompt: "own", stop: "own", asks: "own", pending: "own", act: "own", clear_questions: "own", retry: "own",
    settle: "own", session_end: "own", branch: "own", branch_started: "own+parent", compacted: "own", forget: "none", conclude: "own",
    confluence_landed: "own", answers_landed: "own", pins_asked: "own+for", pin: "own", pin_note: "none", pin_archive: "none",
    pin_restore: "none", pin_delete: "none", close_branch: "own", resume: "own", capture: "own", restore: "own",
    cold_retry: "own", cold_reset: "none",
  };
  const handlers = Object.getOwnPropertyNames(Store.prototype).filter((k) => k.startsWith("on_") && typeof Store.prototype[k] === "function").map((k) => k.slice(3));
  A.deepEqual(handlers.filter((h) => !(h in NEEDS)), [], "every on_* handler has a coldNeeded decision (add new ones to NEEDS)");
  A.deepEqual(Object.keys(NEEDS).filter((h) => !handlers.includes(h)), [], "...and NEEDS names no handler that is gone");
  A.ok(handlers.includes("restore") && handlers.includes("cold_retry") && handlers.includes("cold_reset"));
  const CC = "cccc0001-0000-4000-8000-000000000001", CP = "cccc0002-0000-4000-8000-000000000001", CF = "cccc0003-0000-4000-8000-000000000001";
  const WW = "wwww0001-0000-4000-8000-000000000001", FG = "ffff0001-0000-4000-8000-000000000001";
  const stub = (sid) => ({ sessionId: sid, agent: "claude-code", terminal: null, turn: 5, turnSource: "hooks", state: "idle", cwd: "/x", nextHandle: { A: 4, Q: 2, P: 1 },
    updatedAt: T10, cold: { file: CFG.coldName(sid, T10, "a1b2c3"), at: T10, n: { q: 0, qNew: 0, blocking: 0, needed: 1, optional: 0, promoted: 0, answered: 0, closed: 0, items: 1, turns: 1 } } });
  const needStore = () => {
    const d = { v: 1, items: {}, sessions: { [CC]: stub(CC), [CP]: stub(CP), [CF]: stub(CF), [WW]: { ...stub(WW), cold: undefined } }, branches: {}, terminals: {}, turns: {},
      ingested: ["seen-before"], forgotten: { [FG]: T10 }, pins: {}, retention: { v: 1, at: T10 } };
    delete d.sessions[WW].cold;
    return new Store(d);
  };
  const evFor = (type, sid, extra = {}) => ({ v: 1, id: `cn${++cn}`, type, at: NOW, session_id: sid, terminal: "t5", parent_session_id: CP, for_session: CF,
    action: "resolve", item: "rq_x", file: CFG.coldName(sid, T10, "a1b2c3"), pin: "pn_00000000-0000-4000-8000-000000000099", ...extra });
  const want = (rule, own_) => [...(rule === "none" ? [] : [own_].filter(Boolean)), ...(rule === "own+parent" ? [CP] : rule === "own+for" ? [CF] : [])];
  for (const type of [...Object.keys(NEEDS), "zz_future_type"]) {
    const rule = NEEDS[type] ?? "own";   // an unknown type that carries a session: the uniform rule
    const ns = needStore();
    A.deepEqual([...ns.coldNeeded([evFor(type, CC)])], want(rule, CC), `coldNeeded ${type}, its session cold: ${rule}`);
    A.deepEqual([...ns.coldNeeded([evFor(type, WW)])], want(rule, null), `coldNeeded ${type}, its session warm`);
    A.deepEqual([...ns.coldNeeded([evFor(type, FG)])], [], `coldNeeded ${type}, its session forgotten: apply() drops it`);
    A.deepEqual([...ns.coldNeeded([evFor(type, CC, { id: "seen-before" })])], [], `coldNeeded ${type}, already ingested`);
    // apply(): an event that needs a cold session throws ColdError and changes nothing; the rest apply to stubs
    const t0 = ns.toText(), e = evFor(type, CC);
    if (rule === "none" || type === "cold_retry") {
      A.doesNotThrow(() => ns.apply(e), `apply ${type} to a stub`);
    } else {
      A.throws(() => ns.apply(e), (err) => err instanceof ColdError && err.name === "ColdError" && JSON.stringify(err.cold) === JSON.stringify(want(rule, CC)), `apply ${type}: ColdError`);
      A.equal(ns.toText(), t0, `apply ${type}: nothing changed`);
      if (rule !== "own") {
        const e2 = evFor(type, WW);
        A.throws(() => ns.apply(e2), (err) => err instanceof ColdError && JSON.stringify(err.cold) === JSON.stringify(want(rule, null)), `apply ${type} with a warm session: ColdError for the other`);
      }
    }
  }
  {
    const ns = needStore();
    A.deepEqual([...ns.coldNeeded([{ v: 1, id: "p1", type: "pending", session: CC, turn: 6 }])], [CC], "`session` (pending) names the session");
    A.deepEqual([...ns.coldNeeded([{ v: 1, id: "c1", type: "capture", request: { id: "rq_n", anchor: { sessionId: CC } } }])], [CC], "...and request.anchor.sessionId (capture)");
    A.deepEqual([...ns.coldNeeded([{ v: 1, id: "a1", type: "act", session_id: CC, action: "seen" }])], [], "an act \"seen\" marks the stub's chip seen: no thaw (showing a session never thaws it)");
    A.deepEqual([...ns.coldNeeded([{ v: 1, id: "b1", type: "branch_started", session_id: WW, parent_session_id: CC }, evFor("prompt", CF), evFor("prompt", CC), evFor("stop", CC)])].sort(), [CC, CF].sort(), "a batch: each cold session once");
    A.deepEqual([...ns.coldNeeded([null, 7, {}, { type: "prompt" }, { session_id: CC }])], [], "nothing for what is not an event");
    A.deepEqual([...ns.coldNeeded("x")], []);
    const seen = ns.apply({ v: 1, id: "a2", type: "act", session_id: CC, action: "seen", at: NOW });
    A.equal(seen.applied, true); A.equal(ns.d.sessions[CC].seenAt, NOW, "seen applied to the stub"); A.ok(ns.isCold(CC), "...which stays cold");
    A.equal(ns.d.sessions[CC].touchedAt, undefined, "a cold stub's touchedAt moves only with a thaw or a reset");
    const r = ns.apply({ v: 1, id: "r1", type: "cold_retry", session_id: CC, at: NOW });
    A.equal(r.applied, true, "a cold_retry whose read failed (still cold): recorded and dropped"); A.ok(ns.d.ingested.includes("r1")); A.ok(ns.isCold(CC));
    ns.apply({ v: 1, id: "f1", type: "forget", session_id: CC, at: NOW });
    A.equal(ns.d.sessions[CC], undefined, "forget a cold session: no file read, the stub goes"); A.equal(ns.d.forgotten[CC], NOW);
    A.deepEqual([...ns.coldNeeded([evFor("prompt", CC)])], [], "its late events need nothing (dropped as forgotten)");
    A.doesNotThrow(() => ns.apply(evFor("prompt", CC)));
  }

  // 5. touchedAt: every event of a warm session moves it (pin ops aside), never back
  {
    const st = mk();
    st.apply({ v: 1, id: `ta${++cn}`, type: "act", session_id: S0, item: "rq_c0a", action: "promote", at: NOW - 3 * DAY });
    A.equal(st.d.sessions[S0].touchedAt, NOW - 3 * DAY, "an act (no updatedAt on the record) moves touchedAt");
    st.apply({ v: 1, id: `ta${++cn}`, type: "close_branch", session_id: S0, branch_id: "br_none", at: NOW - 2 * DAY });
    A.equal(st.d.sessions[S0].touchedAt, NOW - 2 * DAY, "...so does an event that changed nothing else (close_branch)");
    A.equal(st.touchedAt(S0), NOW - 2 * DAY, "the idle clock reads it");
    st.apply({ v: 1, id: `ta${++cn}`, type: "act", session_id: S0, item: "rq_c0a", action: "draft", arg: "x", at: NOW - 5 * DAY });
    A.equal(st.d.sessions[S0].touchedAt, NOW - 2 * DAY, "an older event does not move it back");
    st.apply({ v: 1, id: `ta${++cn}`, type: "pin_note", session_id: S0, pin: "pn_00000000-0000-4000-8000-000000000001", note: "n", at: NOW });
    A.equal(st.d.sessions[S0].touchedAt, NOW - 2 * DAY, "a pin op does not");
    st.d.sessions[S0].surfaced = true;
    st.apply({ v: 1, id: `ta${++cn}`, type: "act", session_id: S0, action: "seen", at: NOW - DAY });
    A.equal(st.d.sessions[S0].seenAt, NOW - DAY, "seen marks the chip seen");
    A.equal(st.d.sessions[S0].touchedAt, NOW - 2 * DAY, "...and does not move touchedAt: a session only looked at is not in use"); A.equal(st.touchedAt(S0), NOW - 2 * DAY);
  }

  // 6. the live-shape fixture: 20 of 42 sessions go cold; counts and chips the same before and after; the store
  // shrinks by exactly what left, less what the stubs gained; the round trip gives every session back
  // (2026-11-23: every third agent ask with a summary, so the round trip below carries the field whole)
  const fx = liveShape({ now: NOW, summaries: true });
  const coldSet = new Set(fx.sids.cold);
  {
    const withSummary = Object.values(fx.data.items).filter((it) => typeof it.summary === "string");
    A.ok(withSummary.some((it) => coldSet.has(it.anchor.sessionId)) && withSummary.some((it) => !coldSet.has(it.anchor.sessionId)), "the fixture's summaries: in sessions that go cold and in ones that stay");
    const plain = liveShape({ now: NOW }).data, bare = (it) => { const c = JSON.parse(JSON.stringify(it)); delete c.summary; delete c.anchor.quote; return JSON.stringify(c); };
    A.ok(Object.keys(plain.items).join() === Object.keys(fx.data.items).join() && Object.entries(plain.items).every(([id, it]) => bare(it) === bare(fx.data.items[id]))
      && JSON.stringify({ ...plain, items: null }) === JSON.stringify({ ...fx.data, items: null }), "(summaries change nothing else in the fixture but the quote's padding)");
  }
  // promoted asks (needed, optional, and a blocking one) and a working session with questions parked this turn
  let pi = 0;
  for (const it of Object.values(fx.data.items)) {
    if (!coldSet.has(it.anchor.sessionId) || it.direction !== "agent_to_human" || it.status !== "open") continue;
    if (++pi % 5 === 0) it.promoted = true;
  }
  const work = fx.sids.cold[4];   // 12 items, idle 9 days, no blocking ask: its chip can say "collecting"
  Object.assign(fx.data.sessions[work], { state: "working", promptAt: NOW - 30 * DAY });
  const orig = JSON.stringify(fx.data);
  const big = Store.fromText(orig);
  const orderCold = [...fx.sids.cold].sort((x, y) => big.touchedAt(x) - big.touchedAt(y) || (x < y ? -1 : 1));
  const planB = big.planFreeze(CFG.DEFAULTS.retention.coldDays, NOW, { max: 40 });
  A.deepEqual(planB.map((p) => p.sid), orderCold, "the 20 sessions idle past 7 days with something to move, oldest idle first; the 9 empty and the 13 active stay");
  A.equal(big.planFreeze(7, NOW, { canFreeze: (sid) => !fx.sids.cold.slice(0, 6).includes(sid) }).length, 14, "with 6 of them on a live terminal: 14");
  const LV = ["optional", "needed", "blocking"];
  const countsAll = (st) => Object.fromEntries(LV.map((th) => { st.threshold = th; return [th, Object.fromEntries(Object.keys(st.d.sessions).map((sid) => [sid, st.countsOf(sid)]))]; }));
  const chipsAll = (st) => Object.fromEntries(LV.map((th) => { st.threshold = th; return [th, st.chips(NOW)]; }));
  const noO = (x) => JSON.parse(JSON.stringify(x), (k, v) => (k === "o" ? undefined : v));
  const c0 = countsAll(big), ch0 = chipsAll(big);
  A.ok(Object.values(c0.needed).some((c) => c.below > 0) && Object.values(c0.blocking).some((c) => c.b > 0), "the fixture has suggestions and blocking asks");
  {
    // countsOf from items means what counts(it) and the chips mean
    big.threshold = "needed";
    for (const sid of fx.sids.cold.slice(0, 4)) {
      const its = big.itemsOf(sid), c = big.countsOf(sid);
      A.equal(c.open, its.filter((it) => big.counts(it)).length, "open: the items counts() counts");
      A.equal(c.below, its.filter((it) => it.status === "open" && isSuggestion(it, "needed")).length, "below: the suggestions");
    }
  }
  const { frozen, files } = freeze(big, planB);
  A.deepEqual(frozen, orderCold, "all 20 committed");
  A.deepEqual(countsAll(big), c0, "countsOf the same before and after the freeze, at all three thresholds (from the stubs' n)");
  const ch1 = chipsAll(big);
  A.deepEqual(noO(ch1), noO(ch0), "chips() the same before and after, apart from o");
  A.ok(Object.values(ch0.needed).some((c) => coldSet.has(c.s) && c.o) && Object.values(ch1.needed).every((c) => !coldSet.has(c.s) || c.o === undefined), "o: there before, left out for a cold session");
  A.equal(ch1.blocking[`t${fx.sids.active.length + 5}`]?.st, "collecting", "a working cold session's chip says collecting, from n.qNew");
  A.ok(Object.values(ch1.needed).some((c) => coldSet.has(c.s) && c.st === "blocking"), "...and one with an open blocking ask says blocking");
  const after = big.toText();
  A.deepEqual(big.mixedCold(), []); A.deepEqual(big.coldSessions().sort(), [...fx.sids.cold].sort());
  // the oracle: the original less the cold items and turn records, plus the stubs' cold field and (integration,
  // 2026-11-19) the idle clock each had, carried in touchedAt when its items or turn records held a later time
  const wantD = JSON.parse(orig), ref = Store.fromText(orig);
  for (const sid of frozen) {
    for (const [id, it] of Object.entries(wantD.items)) if (it.anchor.sessionId === sid) delete wantD.items[id];
    delete wantD.turns[sid];
    if (ref.touchedAt(sid) > (Number(wantD.sessions[sid].touchedAt) || 0)) wantD.sessions[sid].touchedAt = ref.touchedAt(sid);
    wantD.sessions[sid].cold = { file: files[sid].file, at: NOW, n: files[sid].record.n };
  }
  A.equal(after, JSON.stringify(wantD), "the frozen store is exactly the original less what moved, plus the stubs' cold field and idle clock");
  A.ok(frozen.every((sid) => big.touchedAt(sid) === ref.touchedAt(sid)), "every stub's idle clock reads as it did warm");
  const origD = JSON.parse(orig);
  let moved = 0, grew = 0;
  for (const sid of frozen) {
    for (const [id, it] of Object.entries(origD.items)) if (it.anchor.sessionId === sid) moved += JSON.stringify(id).length + 1 + JSON.stringify(it).length + 1;
    if (origD.turns[sid]) moved += JSON.stringify(sid).length + 1 + JSON.stringify(origD.turns[sid]).length + 1;
    grew += JSON.stringify(wantD.sessions[sid]).length - JSON.stringify(origD.sessions[sid]).length;
  }
  A.equal(orig.length - after.length, moved - grew, "store.json shrinks by the cold items and turn records, less the stubs' growth");
  const fileBytes = frozen.map((sid) => JSON.stringify(files[sid].record).length);
  const total = fileBytes.reduce((a, b) => a + b, 0), largest = Math.max(...fileBytes);
  A.ok(largest < 40 * 1024, `the largest cold file is under 40 KB (${largest}): the fast write path, far under 1 MiB`);
  A.ok(grew < 6000, `the stubs grow about 4 KB (${grew})`);
  A.ok(after.length < 0.8 * orig.length, `about a quarter goes (${orig.length} to ${after.length})`);
  coldSizes = `, live shape ${(orig.length / 1e6).toFixed(2)} MB to ${(after.length / 1e6).toFixed(2)} MB (${frozen.length} sessions cold, ${(total / 1e3).toFixed(0)} KB in files, largest ${(largest / 1e3).toFixed(1)} KB)`;
  {
    const snap = big.snapshot(NOW);
    A.deepEqual(Object.keys(snap), ["v", "updatedAt", "items", "cold"]);
    A.equal(snap.items.some((it) => coldSet.has(it.sessionId)), false, "snapshot: no cold session's items");
    A.equal(snap.items.some((it) => "summary" in it), false, "snapshot: no summary (2026-11-23), though warm items hold one");
    A.ok(big.items().some((it) => typeof it.summary === "string"));
    A.deepEqual(Object.keys(snap.cold).sort(), [...fx.sids.cold].sort(), "snapshot.cold names every cold session");
    A.deepEqual(snap.cold[fx.sids.cold[0]], { file: files[fx.sids.cold[0]].file, fault: null });
    A.deepEqual(JSON.stringify(Store.fromText(orig).snapshot(NOW).cold), "{}", "a store with no cold session: an empty map");
    A.equal(JSON.stringify(big.d.pins), JSON.stringify(origD.pins), "pins never go cold");
    A.ok(fx.sids.cold.some((sid) => big.pinsOfSession(sid).length > 0), "...a cold session's pins are still there");
  }
  // the round trip: every file parsed back and thawed
  const big2 = Store.fromText(after);   // what a restart reads
  for (const sid of frozen) {
    const r = big2.thaw(sid, files[sid].record, files[sid].file, NOW + 5);
    A.equal(r.ok, true, `thaw ${sid.slice(0, 13)}`);
  }
  const back = Store.fromText(orig);
  const per = (st) => Object.fromEntries(Object.keys(st.d.sessions).map((sid) => [sid, st.itemsOf(sid)]));
  A.deepEqual(per(big2), per(back), "every session's items back, in itemsOf order, whole");
  A.deepEqual(big2.d.turns, back.d.turns, "every turn record back");
  const strip = (st) => Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(st.d.sessions))).map(([k, s]) => { delete s.thawedAt; delete s.touchedAt; delete s.coldThawed; return [k, s]; }));
  A.deepEqual(strip(big2), strip(back), "every session record as it was, apart from thawedAt, touchedAt and coldThawed");
  A.ok(frozen.every((sid) => big2.d.sessions[sid].thawedAt === NOW + 5 && big2.d.sessions[sid].touchedAt === NOW + 5), "thawedAt and touchedAt: the thaw's time");
  A.ok(frozen.every((sid) => JSON.stringify(big2.d.sessions[sid].coldThawed) === JSON.stringify([{ file: files[sid].file, at: NOW + 5 }])), "coldThawed: the file, the thaw's time (the sweep's proof)");
  A.deepEqual(countsAll(big2), c0, "counts after the round trip as before");
  A.deepEqual(big2.coldSessions(), [], "nothing cold");
  // a thawed session goes cold again only after another idle week
  const again = (t) => big2.planFreeze(7, t).filter((p) => coldSet.has(p.sid)).length;
  A.equal(again(NOW + 6 * DAY), 0, "thawed: warm for the next 7 days"); A.equal(again(NOW + 8 * DAY), 20, "...and idle again after them");

  // 7. handles after a thaw continue from nextHandle; nextHandle is kept as the larger
  {
    const st = Store.fromText(after), sid = fx.sids.cold[0], s = st.d.sessions[sid];
    const nh = { ...s.nextHandle };
    st.thaw(sid, files[sid].record, files[sid].file, NOW);
    st.apply({ v: 1, id: `nh${++cn}`, type: "capture", at: NOW, session_id: sid, terminal: s.terminal, request: { id: "rq_after-thaw", text: "One more question", anchor: { sessionId: sid, turn: s.turn, settled: true }, createdAt: NOW } });
    A.equal(st.item("rq_after-thaw").handle, `Q${nh.Q}`, "the next question takes Q from nextHandle");
    st.apply({ v: 1, id: `nh${++cn}`, type: "asks", at: NOW, session_id: sid, turn: s.turn + 1, source: "block", asks: [{ text: "A brand new ask after the thaw", kind: "do", level: "needed" }] });
    A.equal(st.itemsOf(sid).find((it) => it.text === "A brand new ask after the thaw").handle, `A${nh.A}`, "the next ask takes A from nextHandle");
    A.equal(new Set(st.itemsOf(sid).map((it) => it.handle)).size, st.itemsOf(sid).length, "no handle twice");
    // a stub whose counter fell behind (an older build's, a hand edit): raised past the file's and every handle's
    const s2 = Store.fromText(after), sid2 = fx.sids.cold[1];
    s2.d.sessions[sid2].nextHandle = { A: 1, Q: 1, P: 1 };
    s2.thaw(sid2, files[sid2].record, files[sid2].file, NOW);
    A.deepEqual(s2.d.sessions[sid2].nextHandle, files[sid2].record.session.nextHandle, "nextHandle: the larger, the file's");
    const s3 = Store.fromText(after), rec3 = JSON.parse(JSON.stringify(files[sid2].record));
    s3.d.sessions[sid2].nextHandle = { A: 2, Q: 1, P: 1 }; rec3.session.nextHandle = { A: 1, Q: 1, P: 1 };
    s3.thaw(sid2, rec3, files[sid2].file, NOW);
    const maxA = Math.max(...rec3.items.filter((it) => /^A\d+$/.test(it.handle)).map((it) => Number(it.handle.slice(1))));
    A.equal(s3.d.sessions[sid2].nextHandle.A, maxA + 1, "...past every handle the items hold, whatever both counters said");
  }

  // 8. thaw refuses what is not this session's file, and a mixed session keeps the store's copies
  {
    const sid = fx.sids.cold[2], { file, record } = files[sid];
    const fresh = () => Store.fromText(after);
    const refuse = (rec, f = file, s0 = sid, why) => { const st = fresh(), t = st.toText(); const r = st.thaw(s0, rec, f, NOW); A.equal(r.ok, false, why); A.equal(typeof r.error, "string"); A.equal(st.toText(), t, `${why}: nothing changed`); return r.error; };
    refuse({ ...record, ledgr: "other" }, file, sid, "a wrong format");
    refuse({ ...record, v: 2 }, file, sid, "another version");
    A.match(refuse({ ...record, sessionId: fx.sids.cold[3] }, file, sid, "another session's file"), /not/);
    refuse(record, files[fx.sids.cold[3]].file, sid, "a file the stub does not name");
    refuse(record, file, fx.sids.active[0], "a warm session");
    refuse(record, file, "nobody-0000", "an unknown session");
    refuse({ ...record, items: "x" }, file, sid, "no item list");
    refuse({ ...record, items: [...record.items, { text: "no id" }] }, file, sid, "an item with no id");
    refuse({ ...record, items: [...record.items, { ...record.items[0], id: "rq_elsewhere", anchor: { sessionId: "elsewhere" } }] }, file, sid, "an item of another session");
    refuse({ ...record, turns: [1, 2] }, file, sid, "turn records not a map");
    refuse({ ...record, turns: { ...record.turns, 99: "x" } }, file, sid, "a turn record not a record");
    refuse(JSON.parse(`{"ledgr":"ledgr-cold","v":1,"sessionId":${JSON.stringify(sid)},"items":[{"id":"__proto__","anchor":{"sessionId":${JSON.stringify(sid)}}}],"turns":{}}`), file, sid, "an id __proto__");
    refuse(null, file, sid, "null"); refuse([], file, sid, "an array");
    A.equal(coldRecordError({ ...record, turns: undefined }, sid), null, "no turns key: allowed (no records)");
    // mixed: an older build added an item and a turn record beside the stub, and changed one of the file's ids
    const st = fresh(), sOld = record.items[0], tKey = Object.keys(record.turns)[0];
    st.d.items[sOld.id] = { ...sOld, text: "the store's newer copy" };
    st.d.items.rq_older_build = { ...sOld, id: "rq_older_build", handle: "A999", text: "added by an older build" };
    st.d.turns[sid] = { [tKey]: { stopAt: 1, note: "the store's record" }, 9999: { stopAt: 2 } };
    A.deepEqual(st.mixedCold(), [sid], "mixedCold names it");
    st.threshold = "needed";
    const base = Store.fromText(after); base.threshold = "needed";
    A.equal(sOld.status, "open"); A.equal(st.countsOf(sid).open, base.countsOf(sid).open + 2, "countsOf a mixed stub: n plus the store's own items");
    const r = st.thaw(sid, record, file, NOW);
    A.deepEqual({ ok: r.ok, items: r.items, turns: r.turns, kept: r.kept }, { ok: true, items: record.items.length - 1, turns: Object.keys(record.turns).length - 1, kept: { items: 1, turns: 1 } });
    A.equal(st.item(sOld.id).text, "the store's newer copy", "an id in both: the store's wins");
    A.equal(st.d.turns[sid][tKey].note, "the store's record", "a turn in both: the store's wins"); A.equal(st.d.turns[sid][9999].stopAt, 2);
    const ids = st.itemsOf(sid).map((it) => it.id);
    A.deepEqual(ids.slice(0, record.items.length - 1), record.items.slice(1).map((it) => it.id), "the file's items first, in file order");
    A.deepEqual(ids.slice(-2), [sOld.id, "rq_older_build"], "...then the store's own");
    A.ok(st.d.sessions[sid].nextHandle.A >= 1000, "nextHandle past A999");
    A.deepEqual(st.mixedCold(), []);
    // an item whose branch record is gone loses the mark, as Forget drops it
    const st2 = fresh(), rec2 = JSON.parse(JSON.stringify(record));
    rec2.items[0].branch = { branchId: "br_gone" }; rec2.items[1].branch = { branchId: "br_kept" };
    st2.d.branches.br_kept = { id: "br_kept", parentSessionId: sid, status: "rejoined" };
    st2.thaw(sid, rec2, file, NOW);
    A.equal(st2.item(rec2.items[0].id).branch, undefined, "a branch mark whose record is gone goes"); A.deepEqual(st2.item(rec2.items[1].id).branch, { branchId: "br_kept" });
  }

  // 9. mergeCold: a reading copy's view; s.cold kept; copies; never in toText() or snapshot()
  {
    const st = Store.fromText(after), sid = fx.sids.cold[0], { file, record } = files[sid];
    const t0 = st.toText(), snap0 = JSON.stringify(st.snapshot(NOW)), cold0 = JSON.stringify(st.d.sessions[sid].cold);
    const want0 = Store.fromText(orig).itemsOf(sid);
    st.threshold = "needed"; const cnt0 = st.countsOf(sid);
    A.equal(st.mergeCold(sid, record, file), true);
    A.equal(st.isMerged(sid), true); A.equal(st.isCold(sid), true, "still cold"); A.equal(JSON.stringify(st.d.sessions[sid].cold), cold0, "s.cold unchanged");
    A.deepEqual(st.itemsOf(sid), want0, "the file's items in the view");
    A.deepEqual(st.d.turns[sid], Store.fromText(orig).d.turns[sid]);
    A.deepEqual(st.countsOf(sid), cnt0, "countsOf from the merged items: the same as from n");
    st.itemsOf(sid)[0].text = "changed in the view"; st.d.turns[sid][Object.keys(st.d.turns[sid])[0]].stopAt = 1;
    A.notEqual(record.items[0].text, "changed in the view", "copies: the record is untouched"); A.notEqual(Object.values(record.turns)[0].stopAt, 1);
    A.equal(st.toText(), t0, "toText() leaves the merge out (a merged store written by mistake is still the stubs)");
    A.equal(JSON.stringify(st.snapshot(NOW)), snap0, "...and so does snapshot()");
    A.equal(st.mergeCold(sid, record, file), true, "the same file again"); A.equal(st.itemsOf(sid).length, want0.length, "...adds nothing");
    A.equal(st.mergeCold(sid, record, files[fx.sids.cold[1]].file), false, "a file the stub does not name");
    A.equal(st.mergeCold(fx.sids.cold[1], record, files[fx.sids.cold[1]].file), false, "another session's record");
    A.equal(st.mergeCold(fx.sids.active[0], record, file), false, "a warm session");
    A.equal(st.isMerged(fx.sids.cold[1]), false);
    st.unmerge(sid);
    A.equal(st.isMerged(sid), false); A.deepEqual(st.itemsOf(sid), []); A.equal(st.toText(), t0, "unmerge: as before");
    // a merge that reached a writer's store by mistake: the session reads as mixed, and its thaw makes the copies real
    const w = Store.fromText(after);
    w.mergeCold(sid, record, file);
    A.ok(w.mixedCold().includes(sid)); A.equal(w.coldNeeded([evFor("prompt", sid)]).has(sid), true, "a merged session still needs its thaw");
    A.equal(w.thaw(sid, record, file, NOW).ok, true); A.equal(w.isMerged(sid), false);
    A.equal(JSON.parse(w.toText()).items[want0[0].id]?.id, want0[0].id, "thawed: in toText() for good");
  }

  // 10. Phase 1 holds for cold and thawed sessions: archive, restore, slim; `archived` stays on the stub
  {
    const st = mk();
    st.d.items.rq_c0r = { id: "rq_c0r", key: "k", handle: "A9", direction: "agent_to_human", text: "old", kind: "do", level: "needed",
      anchor: { sessionId: S0, turn: 1, hash: "r" }, status: "resolved", resolvedAt: T10 - 5 * DAY, createdAt: T10 - 6 * DAY, updatedAt: T10 - 5 * DAY };
    st.d.sessions[S0].nextHandle.A = 10; st.d.sessions[S0].archived = 4;
    const line = JSON.parse(JSON.stringify(st.d.items.rq_c0r));
    const { files: f1 } = freeze(st, st.planFreeze(7, NOW));
    A.deepEqual(st.archivable(3, NOW), [], "a cold session's closed items wait in its file"); A.equal(st.d.sessions[S0].archived, 4, "archived stays on the stub");
    A.deepEqual(st.planSlim(0), { cut: [], heads: [] }, "...and its turn records are not slimmed while cold");
    A.equal(st.restoreItem({ ...line, id: "rq_c0z", handle: "A3" }), null, "restoreItem refuses a cold session (never an item beside a stub)"); A.equal(st.item("rq_c0z"), null);
    A.throws(() => st.apply({ v: 1, id: `p1${++cn}`, type: "restore", at: NOW, session_id: S0, item: "rq_c0z", file: "items-1795000000000-a1b2c3.jsonl", record: { ...line, id: "rq_c0z" } }), ColdError, "a restore needs its session thawed");
    st.thaw(S0, f1[S0].record, f1[S0].file, NOW);
    A.deepEqual(st.archivable(3, NOW).map((x) => x.id), ["rq_c0r"], "thawed: archivable again");
    A.deepEqual(st.removeItems(st.archivable(3, NOW)).map((x) => x.id), ["rq_c0r"]); A.equal(st.d.sessions[S0].archived, 5);
    const rr = st.apply({ v: 1, id: `p1${++cn}`, type: "restore", at: NOW, session_id: S0, item: "rq_c0r", file: "items-1795000000000-a1b2c3.jsonl", record: line });
    A.deepEqual(rr.restore, { item: "rq_c0r", ok: true }, "a restore after the thaw"); A.equal(st.item("rq_c0r").handle, "A9"); A.equal(st.d.sessions[S0].archived, 4);
  }

  // 11. Forget of a cold parent takes its cold child (the stub's parentSessionId) and a branch's session
  {
    const P_ = "eeee0001-0000-4000-8000-000000000001", C_ = "eeee0002-0000-4000-8000-000000000001", G_ = "eeee0003-0000-4000-8000-000000000001", X_ = "eeee0004-0000-4000-8000-000000000001";
    const st = new Store({ v: 1, items: { rq_g: { id: "rq_g", handle: "A1", direction: "agent_to_human", anchor: { sessionId: G_ }, status: "open" } },
      sessions: { [P_]: stub(P_), [C_]: { ...stub(C_), parentSessionId: P_, depth: 1 }, [G_]: { ...stub(G_), cold: undefined, parentSessionId: C_, depth: 2 },
        [X_]: stub(X_), [WW]: { ...stub(WW), cold: undefined } },
      branches: { br_x: { id: "br_x", parentSessionId: P_, sessionId: X_, status: "rejoined" } }, terminals: { t7: { sessionId: C_ } }, turns: {}, ingested: [], forgotten: {},
      pins: { "pn_00000000-0000-4000-8000-0000000000c1": { id: "pn_00000000-0000-4000-8000-0000000000c1", sessionId: C_, status: "open", anchor: { sessionId: C_ } } } });
    delete st.d.sessions[G_].cold; delete st.d.sessions[WW].cold;
    st.apply({ v: 1, id: `fg${++cn}`, type: "forget", session_id: P_, at: NOW });
    A.deepEqual(Object.keys(st.d.sessions), [WW], "the cold parent, its cold child, the child's warm child and the branch's session: gone");
    A.deepEqual(Object.keys(st.d.forgotten).sort(), [P_, C_, G_, X_].sort()); A.deepEqual(st.d.branches, {}); A.deepEqual(st.d.terminals, {}); A.deepEqual(st.d.items, {});
    A.equal(Object.keys(st.d.pins).length, 1, "the cold child's pin stays");
  }

  // 12. faults, cold_retry, cold_reset
  {
    const st = mk(), { files: f2 } = freeze(st, st.planFreeze(7, NOW)), file = f2[S0].file;
    A.equal(st.coldFault("nobody", "x", NOW), false); A.equal(st.coldFault(fx.sids.active[0], "x", NOW), false, "a warm session: false");
    A.deepEqual(st.coldFaults(), []);
    A.equal(st.coldFault(S0, "missing: cold/x.json", NOW), true);
    A.deepEqual(st.d.sessions[S0].cold.fault, { at: NOW, error: "missing: cold/x.json", tries: 1, held: 0 }, "the first fault");
    st.coldFault(S0, "missing again", NOW + 600e3);
    A.deepEqual(st.d.sessions[S0].cold.fault, { at: NOW + 600e3, error: "missing again", tries: 2, held: 0 }, "a try: at and tries move");
    st.coldFault(S0, null, NOW + 700e3, 2); st.coldFault(S0, undefined, NOW + 800e3, 1);
    A.deepEqual(st.d.sessions[S0].cold.fault, { at: NOW + 600e3, error: "missing again", tries: 2, held: 3 }, "held events only: held moves, nothing else");
    A.deepEqual(st.coldFaults(), [{ sid: S0, file, at: NOW + 600e3, error: "missing again", tries: 2, held: 3 }]);
    A.deepEqual(st.snapshot(NOW).cold[S0], { file, fault: "missing again" }, "snapshot.cold carries the fault's error");
    const s2 = mk(); freeze(s2, s2.planFreeze(7, NOW)); s2.coldFault(S0, "bad JSON", NOW, 1);
    A.deepEqual(s2.d.sessions[S0].cold.fault, { at: NOW, error: "bad JSON", tries: 1, held: 1 }, "a first fault with a held event");
    // cold_reset: only a faulted stub naming that file
    const ok0 = mk(); freeze(ok0, ok0.planFreeze(7, NOW));
    const tOk = ok0.toText();
    ok0.apply({ v: 1, id: `cr${++cn}`, type: "cold_reset", session_id: S0, file, at: NOW });
    A.equal(JSON.parse(ok0.toText()).sessions[S0].cold.file, file, "not faulted: nothing reset"); A.equal(JSON.stringify(JSON.parse(ok0.toText()).sessions), JSON.stringify(JSON.parse(tOk).sessions));
    const n0 = JSON.parse(JSON.stringify(st.d.sessions[S0].cold.n));
    st.apply({ v: 1, id: `cr${++cn}`, type: "cold_reset", session_id: S0, file: "c0c0c0c0-0000-4000-8000-000000000001.1795000000000-zzzzzz.json", at: NOW });
    A.ok(st.isCold(S0), "another file: nothing reset");
    st.apply({ v: 1, id: `cr${++cn}`, type: "cold_reset", session_id: S0, at: NOW });
    A.ok(st.isCold(S0), "no file: nothing reset");
    st.apply({ v: 1, id: `cr${++cn}`, type: "cold_reset", session_id: S0, file, at: NOW + DAY });
    A.equal(st.isCold(S0), false, "reset: warm");
    A.deepEqual(st.d.sessions[S0].coldLost, { file, at: NOW + DAY, frozenAt: NOW, n: n0, error: "missing again" }, "coldLost: the file, when, its counts and the error");
    A.equal(st.d.sessions[S0].thawedAt, NOW + DAY); A.equal(st.d.sessions[S0].touchedAt, NOW + DAY);
    A.deepEqual(st.itemsOf(S0), [], "empty of what the file held");
    st.apply({ v: 1, id: `cr${++cn}`, type: "capture", at: NOW + DAY, session_id: S0, terminal: "t1", request: { id: "rq_after-reset", text: "Start over?", anchor: { sessionId: S0, turn: 3, settled: true }, createdAt: NOW + DAY } });
    A.equal(st.item("rq_after-reset").handle, "Q2", "the next capture takes Q from nextHandle: the lost file's Q1 is never handed out again");
    st.apply({ v: 1, id: `cr${++cn}`, type: "asks", at: NOW + DAY, session_id: S0, turn: 4, source: "block", asks: [{ text: "Run it again", kind: "do", level: "needed" }] });
    A.equal(st.itemsOf(S0).find((it) => it.text === "Run it again").handle, "A3", "...and A from nextHandle");
    A.deepEqual(st.coldGarbage([file], NOW + 30 * DAY), [], "the lost file stays on disk (coldLost names it)");
    // a reading copy that had merged the file: the reset takes the view's copies out
    const rc = mk(), { files: f3 } = freeze(rc, rc.planFreeze(7, NOW));
    rc.mergeCold(S0, f3[S0].record, f3[S0].file); rc.coldFault(S0, "gone", NOW);
    rc.on_cold_reset({ file: f3[S0].file }, rc.d.sessions[S0], NOW);
    A.deepEqual(rc.itemsOf(S0), [], "reset in a reading copy: its merged copies go too"); A.equal(rc.merged.size, 0);
  }

  // 13. The sweep's rules (integration, 2026-11-19: the review's blocker). By name (coldGarbage) only a file the
  // session's record lists as thawed, past the grace, and a forgotten session's, past the keep time. Every other
  // unnamed file of one recorded, unfaulted session older than the keep time is the writer's to read
  // (coldUnproven) and to delete only when coldLacks finds nothing store.json lacks.
  {
    const H = 3600e3, G = { graceMs: H, keepMs: DAY };
    const nm_ = (sid, ms, r = "a1b2c3") => CFG.coldName(sid, ms, r);
    const sid = (x) => `aaaa${String(x).padStart(4, "0")}-0000-4000-8000-000000000001`;
    const warm = (x, o) => ({ sessionId: sid(x), turn: 1, updatedAt: NOW - 20 * DAY, ...o });
    const thawed = (x, ms, at) => ({ coldThawed: [{ file: nm_(sid(x), ms), at }], thawedAt: at });
    const st = new Store({ v: 1, items: {}, branches: {}, terminals: {}, turns: {}, ingested: [], pins: {}, sessions: {
      [sid(1)]: warm(1, thawed(1, NOW - 3 * DAY, NOW - 2 * H)),
      [sid(2)]: warm(2, thawed(2, NOW - 3 * DAY, NOW - H / 2)),
      [sid(3)]: warm(3, { updatedAt: NOW - DAY }),
      [sid(4)]: warm(4, { updatedAt: NOW - H }),
      [sid(5)]: warm(5, { updatedAt: NOW - 10 * DAY }),
      [sid(6)]: { ...warm(6), cold: { file: nm_(sid(6), NOW - DAY), at: NOW - DAY, n: {} } },
      [sid(7)]: { ...warm(7), cold: { file: nm_(sid(7), NOW - DAY), at: NOW - DAY, n: {}, fault: { at: NOW, error: "missing", tries: 1, held: 0 } } },
      [sid(8)]: warm(8, { coldLost: { file: nm_(sid(8), NOW - 9 * DAY), at: NOW - 8 * DAY, n: {}, error: "x" }, thawedAt: NOW - 8 * DAY }),
      [sid(13)]: warm(13, { thawedAt: NOW - 2 * DAY }),
      "herdr:t9": warm(9), herdr_t9: warm(10),
    }, forgotten: { [sid(11)]: NOW - 2 * DAY, [sid(12)]: NOW - 2 * H } });
    const cases = {
      del: [nm_(sid(1), NOW - 3 * DAY),                    // (t) listed as thawed, the grace past
        nm_(sid(11), NOW - 3 * DAY)],                       // (a) forgotten over a day ago
      keep: [nm_(sid(2), NOW - 3 * DAY),                    // listed as thawed, within the grace
        nm_(sid(3), NOW - 2 * DAY),                         // touched after the file: the old rule (c) deleted it; a read decides now
        nm_(sid(4), NOW - 3 * H),                           // touched after the file, the file under a day old
        nm_(sid(5), NOW - 9 * DAY),                         // a warm session untouched since the file (a freeze given up)
        nm_(sid(6), NOW - 5 * DAY),                         // an older file of a cold session: the old rule (b) deleted it; a read decides now
        nm_(sid(6), NOW - DAY), nm_(sid(6), NOW),           // the file the stub names; a later one
        nm_(sid(7), NOW - 5 * DAY),                         // a faulted session keeps every file
        nm_(sid(8), NOW - 9 * DAY),                         // coldLost names it
        nm_(sid(13), NOW - 3 * DAY),                        // thawed after the file, but not by this file (a reset, a backup): a read decides
        nm_("herdr:t9", NOW - 30 * DAY),                    // a safe name two sessions share
        nm_(sid(12), NOW - 3 * DAY),                        // forgotten under a day ago
        nm_(sid(99), NOW - 30 * DAY),                       // a session the store does not know
        "README", "x.json", "held"],
    };
    const got = st.coldGarbage([...cases.del, ...cases.keep, ...cases.del, 7, null, {}], NOW, G);
    A.deepEqual(got.sort(), [...cases.del].sort(), "by name: a thawed file past the grace and a forgotten session's, nothing else, each once");
    for (const k of cases.keep) A.equal(got.includes(k), false, `kept by name: ${k}`);
    A.deepEqual(st.coldGarbage([nm_(sid(2), NOW - 3 * DAY)], NOW + H, G), [nm_(sid(2), NOW - 3 * DAY)], "...the thawed file once the grace is past");
    A.deepEqual(st.coldGarbage([nm_(sid(12), NOW - 3 * DAY)], NOW + DAY, G), [nm_(sid(12), NOW - 3 * DAY)], "...the forgotten session's a day on");
    A.deepEqual(st.coldGarbage("x", NOW, G), []); A.deepEqual(st.coldGarbage(undefined), []);
    A.deepEqual(st.coldGarbage([nm_(sid(13), NOW - 3 * DAY)], NOW + 30 * DAY, G), [], "a session thawed after a file it does not list: never by name");
    // What only a read can prove: oldest first; not a faulted session's, not a listed one, not one under the keep time.
    const un = st.coldUnproven([...cases.del, ...cases.keep], NOW, { keepMs: DAY });
    A.deepEqual(un.map((c) => c.name), [nm_(sid(5), NOW - 9 * DAY), nm_(sid(6), NOW - 5 * DAY), nm_(sid(13), NOW - 3 * DAY), nm_(sid(3), NOW - 2 * DAY)],
      "unproven: the given-up freeze, the older file of a cold session, the reset one, the touched one; oldest first");
    A.deepEqual(un.map((c) => c.sid), [sid(5), sid(6), sid(13), sid(3)]);
    A.deepEqual(st.coldUnproven(cases.keep, NOW - 2 * DAY + H, { keepMs: DAY }).map((c) => c.name), [nm_(sid(5), NOW - 9 * DAY), nm_(sid(6), NOW - 5 * DAY), nm_(sid(13), NOW - 3 * DAY)], "a file under a day old waits");
    // coldLacks (second and third review): only an identical copy proves. An item is held only by an identical copy of
    // this session (the store's, or `copies`), never a later one (a store put back and touched once is stamped later
    // while holding less); a turn record only by an identical one (the store's, `turnCopies`) or the store's without
    // its head plus that head in `heads`. "Older than the oldest kept" proves nothing.
    const S = sid(3);
    const it_ = (id, o = {}) => ({ id, anchor: { sessionId: S }, status: "open", updatedAt: 100, ...o });
    st.d.items.rq_same = it_("rq_same");
    st.d.items.rq_newer = it_("rq_newer", { status: "resolved", updatedAt: 200 });
    st.d.items.rq_older = it_("rq_older", { status: "resolved", updatedAt: 50 });
    st.d.items.rq_other = { ...it_("rq_other"), anchor: { sessionId: "someone-else" } };
    st.d.turns[S] = { 7: { stopAt: 1 }, 9: { stopAt: 2 }, 11: { stopAt: 3 } };
    const rec = { items: [it_("rq_same"), it_("rq_newer", { draft: "x" }), it_("rq_older", { status: "answered", draft: "kept here only" }), it_("rq_other"), it_("rq_inArch"), it_("rq_lost1")],
      turns: { 3: { stopAt: 0 }, 7: { stopAt: 1 }, 9: { stopAt: 99 }, 10: { stopAt: 5 }, 11: { stopAt: 3, textHead: "head" } } };
    A.deepEqual(st.coldLacks(S, rec), { items: 5, turns: 4 },
      "held: the identical item alone; lacking: the one the store has later (no proof of descent), the older one, another session's, two not anywhere; turns: only 7 identical");
    A.deepEqual(st.coldLacks(S, rec, { copies: new Map([["rq_inArch", [it_("rq_inArch")]], ["rq_lost1", [it_("rq_lost1", { updatedAt: 300 })]], ["rq_older", [{ ...it_("rq_older"), anchor: { sessionId: "x" } }]]]),
      turnCopies: new Map([["3", [{ stopAt: 0 }]], ["10", [{ stopAt: 5 }]]]), heads: new Map([["11", "head"]]) }),
      { items: 4, turns: 1 }, "an identical copy proves the archived one; a later copy does not, nor another session's; turns 3 and 10 by copy, 11 by its head; 9 differs");
    A.deepEqual(st.coldLacks(sid(4), { items: [], turns: { 1: {} } }), { items: 0, turns: 1 }, "no record kept anywhere: every turn record lacks");
    A.deepEqual(st.coldLacks(S, { items: [7, { id: 5 }] }), { items: 2, turns: 0 }, "an item with no id string proves nothing");
    // trimThawed: an entry goes once its file is gone, or a day after the thaw.
    const tt = new Store({ v: 1, items: {}, branches: {}, terminals: {}, turns: {}, ingested: [], pins: {}, forgotten: {}, sessions: {
      [sid(1)]: warm(1, { coldThawed: [{ file: "a", at: NOW - 2 * DAY }, { file: "b", at: NOW - H }, { file: "c", at: NOW - H }] }), [sid(2)]: warm(2, { coldThawed: [{ file: "d", at: NOW }] }) } });
    A.equal(tt.trimThawed(["a", "b", "d"], NOW, { keepMs: DAY }), true);
    A.deepEqual(tt.d.sessions[sid(1)].coldThawed, [{ file: "b", at: NOW - H }], "a day old and gone: dropped; there and fresh: kept");
    A.equal(tt.trimThawed(["b"], NOW, { keepMs: DAY }), true); A.equal(tt.d.sessions[sid(2)].coldThawed, undefined, "an emptied list goes");
    A.equal(tt.trimThawed(["b"], NOW, { keepMs: DAY }), false, "nothing to trim: no change");
    // A thaw lists its file; the newest COLD_THAWED_MAX kept; the same file again is one entry.
    const t2 = mk(), { files: tf } = freeze(t2, t2.planFreeze(7, NOW));
    t2.d.sessions[S0].coldThawed = Array.from({ length: COLD_THAWED_MAX }, (_, i) => ({ file: `old${i}`, at: i }));
    t2.thaw(S0, tf[S0].record, tf[S0].file, NOW + 1);
    A.equal(t2.d.sessions[S0].coldThawed.length, COLD_THAWED_MAX); A.deepEqual(t2.d.sessions[S0].coldThawed.at(-1), { file: tf[S0].file, at: NOW + 1 }, "the thaw's file last");
    A.equal(t2.d.sessions[S0].coldThawed[0].file, "old1", "the oldest dropped");
    A.deepEqual(t2.coldGarbage([tf[S0].file], NOW + 1 + 2 * H, G), [tf[S0].file], "the thawed file goes by name after the grace");
    // cold_reset lists nothing: another file of that session is a read's to prove (it may hold what was lost).
    const r3 = mk(), { files: rf } = freeze(r3, r3.planFreeze(7, NOW));
    r3.coldFault(S0, "missing", NOW);
    r3.apply({ v: 1, id: `cg${++cn}`, type: "cold_reset", session_id: S0, file: rf[S0].file, at: NOW + 1 });
    const other = CFG.coldName(S0, NOW + 5, "zzzzzz");
    A.equal(r3.d.sessions[S0].coldThawed, undefined, "a reset lists no file as thawed");
    A.deepEqual(r3.coldGarbage([other, rf[S0].file], NOW + 30 * DAY, G), [], "after a reset: neither the lost file (coldLost) nor another of the session by name");
    A.deepEqual(r3.coldUnproven([other], NOW + 30 * DAY, G).map((c) => c.name), [other], "...the other one is a read's to prove");
    // A file merged into a session that came back warm counting from A1 again (a corrupt start; the manual recovery
    // of Retention.md 10.8): its clashing items take the next handles, their own kept as handleWas.
    const r4 = mk(), { files: f4 } = freeze(r4, r4.planFreeze(7, NOW));
    delete r4.d.sessions[S0].cold; r4.d.sessions[S0].nextHandle = { A: 1, Q: 1, P: 1 };
    r4.apply({ v: 1, id: `cg${++cn}`, type: "asks", at: NOW, session_id: S0, turn: 9, source: "tool", asks: [{ text: "New after the loss", kind: "do", level: "needed" }] });
    A.equal(r4.itemsOf(S0)[0].handle, "A1");
    r4.d.sessions[S0].cold = { file: f4[S0].file, at: NOW, n: {} };
    A.deepEqual(r4.mixedCold(), [S0]);
    A.equal(r4.thaw(S0, f4[S0].record, f4[S0].file, NOW + 1).ok, true);
    const hs4 = r4.itemsOf(S0).map((it) => it.handle);
    A.equal(new Set(hs4).size, hs4.length, `handles unique after the merge: ${hs4}`);
    A.equal(r4.itemsOf(S0).find((it) => it.text === "New after the loss").handle, "A1", "the store's own item keeps its handle");
    const moved = r4.itemsOf(S0).filter((it) => it.handleWas);
    A.ok(moved.length >= 1 && moved.every((it) => it.handleWas !== it.handle && /^[AQ]\d+$/.test(it.handle)), "the file's clashing items renumbered, handleWas kept");
    A.ok(Number(r4.d.sessions[S0].nextHandle.A) > Math.max(...hs4.filter((h) => h.startsWith("A")).map((h) => Number(h.slice(1)))), "nextHandle past them all");
  }
}
const coldChecks = checks - phase1 - phase2 - phase3 - sev - prof - toolChecks - settleChecks - spaceChecks - pinChecks - retChecks;

// ── An ask's summary (2026-11-23): cleaned, kept on a new item, replaced by a usable one, kept when none comes, ─
// out of snapshot.json, whole in the archive, a cold file, a merge, a thaw and a restore
{
  const { cleanSummary } = await import(`${dir}/store.js`);
  const DAYS = 86400e3;
  // 1. cleanSummary: the contract's rules (bin/lib/ledgr_asks.py applies them first; the store again)
  A.equal(CFG.LIMITS.summary, 1000);
  A.equal(cleanSummary("  Do this.\r\n\r\n\r\n- a\r\n- b \n\n"), "Do this.\n\n- a\n- b", "CRLF to LF, a run of blank lines to one, the outer whitespace gone");
  A.equal(cleanSummary("one\n\n\n\ntwo"), "one\n\ntwo"); A.equal(cleanSummary("one\n  \n\t\n \ntwo"), "one\n\ntwo", "whitespace-only lines are blank lines");
  A.equal(cleanSummary("one\ntwo"), "one\ntwo", "a line break kept"); A.equal(cleanSummary("one\n\ntwo"), "one\n\ntwo", "one blank line kept");
  A.equal(cleanSummary("x\ry"), "x\ny", "a lone CR is a line break");
  A.equal(cleanSummary("**bold**, `code`  \nhard break\n  - indented"), "**bold**, `code`  \nhard break\n  - indented", "markdown kept, and a line's own spaces");
  for (const none of ["", "   ", "\n\n\t \r\n", null, undefined, 7, true, {}, ["a"]]) A.equal(cleanSummary(none), null, `no summary: ${JSON.stringify(none) ?? "undefined"}`);
  A.equal(cleanSummary("x".repeat(1000)), "x".repeat(1000), "exactly the limit: kept");
  A.equal(cleanSummary("x".repeat(1500)), "x".repeat(1000), "over it: cut, never refused");
  A.equal(cleanSummary(`${" ".repeat(10)}${"y".repeat(1000)} `), "y".repeat(1000), "the outer whitespace goes before the cut");
  A.equal(cleanSummary(`${"z".repeat(999)} ${"w".repeat(50)}`), "z".repeat(999), "a cut that ends in whitespace is trimmed");
  A.equal(cleanSummary("😀".repeat(1001)), "😀".repeat(1000), "cut at 1,000 code points (as Python counts), never half a surrogate pair");
  A.equal(cleanSummary("😀".repeat(600)), "😀".repeat(600), "600 code points (1,200 UTF-16 units): under the limit");

  // 2. on_asks: a new item keeps it, cleaned; none, empty, whitespace or not a string: no key, never null
  st = Store.fromText(null);
  const MS = "5a5a5a5a-0000-4000-8000-000000000001", MT = "t70";
  let mn = 0;
  const mev = (type, p) => ({ v: 1, id: `sm${++mn}`, type, at: (at += 1000), terminal: MT, session_id: MS, ...p });
  st.apply(mev("session_start", { agent: "claude-code", source: "startup", cwd: "/s", session_name: "summary", turn: 0 }));
  st.apply(mev("prompt", { turn: 1, prompt_id: "s1", local: false, prompt_head: "go", refs: [] }));
  const mAsk = (text, extra = {}) => ({ text, kind: "confirm", level: "blocking", options: [], recommended: null, blocking: true, quote: null,
    repeat_of: null, repeat_of_handle: null, hash: passageHash(text), ...extra });
  const TABLE = "Confirm the pipeline changes in the table";
  st.apply(mev("asks", { turn: 1, prompt_id: "s1", source: "block", asks: [
    mAsk(TABLE, { summary: "  Approve the five changes below with a yes.\r\n\r\n\r\n- rename the pipeline\n- drop the old branch policy  \n" }),
    mAsk("Send the staging token"), mAsk("Pick the release name", { summary: " \n\t " }), mAsk("Choose a region", { summary: 42 }), mAsk("Say which night", { summary: null })] }));
  const sv = (h) => st.byHandle(MS, h);
  A.equal(sv("A1").summary, "Approve the five changes below with a yes.\n\n- rename the pipeline\n- drop the old branch policy", "a new item: the summary, cleaned");
  const k1 = Object.keys(sv("A1"));
  A.equal(k1.indexOf("summary"), k1.indexOf("blocking") + 1, "(beside the ask's other fields)");
  for (const h of ["A2", "A3", "A4", "A5"]) A.equal(Object.hasOwn(sv(h), "summary"), false, `${h}: no usable summary, no key`);
  A.equal(st.toText().includes('"summary":null'), false, "never a null summary in store.json");
  st.apply(mev("capture", { turn: 1, agent: "claude-code", request: { ...req("rq_sumq", "why five changes?", null, {}, MS, 1), summary: "a parked question's summary" } }));
  A.ok(st.item("rq_sumq") && !("summary" in st.item("rq_sumq")), "a parked question has no summary, whatever its Request carries");

  // 3. a later event for the same item (a re-run of the turn: same text and passage): a usable summary replaces, none keeps
  const rerun = (asks, turn = 1, src = "block") => st.apply(mev("asks", { turn, prompt_id: `s${turn}`, source: src, asks }));
  rerun([mAsk(TABLE, { summary: "Approve the changes, or name the ones to leave out." })]);
  A.equal(sv("A1").summary, "Approve the changes, or name the ones to leave out.", "a re-run: the new summary replaces the old");
  rerun([mAsk(TABLE)]);
  A.equal(sv("A1").summary, "Approve the changes, or name the ones to leave out.", "a re-run with none keeps it");
  rerun([mAsk(TABLE, { summary: "  \n " })]); rerun([{ ...mAsk(TABLE), summary: undefined }]); rerun([mAsk(TABLE, { summary: ["x"] })]);
  A.equal(sv("A1").summary, "Approve the changes, or name the ones to leave out.", "...and so does an empty, absent or broken one");
  rerun([mAsk("Send the staging token", { summary: "Paste the staging token (the one named ci-staging)." })]);
  A.equal(sv("A2").summary, "Paste the staging token (the one named ci-staging).", "an item without one gains it");
  rerun([mAsk(TABLE, { summary: "y".repeat(1200) })]);
  A.equal(sv("A1").summary, "y".repeat(1000), "a replacement is cleaned and cut too");
  rerun([mAsk(TABLE, { summary: "Approve the changes, or name the ones to leave out." })]);
  A.equal(st.itemsOf(MS).filter((it) => it.direction === "agent_to_human").length, 5, "(no duplicates)");

  // 4. declared by tool: a mid-turn call, the same turn's replaces_turn call, the Stop settle without the key
  st.apply(mev("prompt", { turn: 2, prompt_id: "s2", local: false, prompt_head: "next", refs: [] }));
  const tAsk = (text, extra = {}) => ({ ...mAsk(text), origin: "tool", quote_verified: null, ...extra });
  const PLAN = "Approve the migration plan";
  st.apply(mev("asks", { turn: 2, prompt_id: "s2", source: "tool", provider: "mcp", replaces_turn: false, tool_call: 1,
    asks: [tAsk(PLAN, { summary: "Say yes to run all four steps tonight." }), tAsk("Name the owner", { summary: "Who owns the job after the cutover?" })] }));
  A.equal(sv("A6").summary, "Say yes to run all four steps tonight.", "a mid-turn declaration");
  st.apply(mev("asks", { turn: 2, prompt_id: "s2", source: "tool", provider: "mcp", replaces_turn: true, tool_call: 2,
    asks: [tAsk(PLAN, { summary: "Say yes to run steps 1 and 2 tonight; 3 and 4 wait for Thursday." }), tAsk("Name the new owner", { summary: "Name who owns the job." })] }));
  A.equal(sv("A6").summary, "Say yes to run steps 1 and 2 tonight; 3 and 4 wait for Thursday.", "the same turn's replaces_turn call: its summary replaces (the handle kept)");
  A.equal(sv("A7"), null, "(the withdrawn untouched ask went)");
  A.equal(sv("A8").text, "Name the new owner"); A.equal(sv("A8").summary, "Name who owns the job.", "a changed text: a new item with its own summary");
  const settle = { turn: 2, prompt_id: "s2", message_uuid: "u-s2", source: "tool", provider: "mcp", replaces_turn: true, quotes: "verified",
    asks: [tAsk(PLAN, { quote_verified: true }), tAsk("Name the new owner", { summary: "Name who owns the job." })] };
  for (const a of settle.asks) { delete a.options; delete a.recommended; }
  delete settle.asks[0].summary;
  st.apply(mev("asks", settle));
  A.equal(sv("A6").summary, "Say yes to run steps 1 and 2 tonight; 3 and 4 wait for Thursday.", "the Stop settle without a summary keeps the declared one");
  A.equal(sv("A6").anchor.uuid, "u-s2", "(settled: the message uuid)"); A.equal(sv("A8").summary, "Name who owns the job.", "...one carried through is the same");
  st.apply(mev("asks", { ...settle, asks: [tAsk(PLAN, { quote_verified: true, summary: "Say yes to run steps 1 and 2 tonight." }), settle.asks[1]] }));
  A.equal(sv("A6").summary, "Say yes to run steps 1 and 2 tonight.", "a settle that carries one: it replaces");

  // 5. a re-raise follows the text: an open ask named again (repeat_of, or the same text at a later turn) takes
  // the text and a usable summary; an answered one reopens as it was; a resolved or dismissed one gets a new
  // item with the event's summary only
  st.apply(mev("prompt", { turn: 3, prompt_id: "s3", local: false, prompt_head: "more", refs: [] }));
  rerun([mAsk("Approve steps 1 and 2 of the migration plan", { repeat_of: sv("A6").id, summary: "Approve steps 1 and 2 only." })], 3, "model");
  A.equal(sv("A6").text, "Approve steps 1 and 2 of the migration plan", "(repeat_of an open ask: the text replaced)");
  A.equal(sv("A6").summary, "Approve steps 1 and 2 only.", "...and its summary"); A.equal(sv("A6").lastSeenTurn, 3);
  st.apply(mev("prompt", { turn: 4, prompt_id: "s4", local: false, prompt_head: "on", refs: [] }));
  rerun([mAsk("Approve steps 1 and 2 of the plan", { repeat_of_handle: "A6" }), mAsk("Send the staging token")], 4, "model");
  A.equal(sv("A6").text, "Approve steps 1 and 2 of the plan"); A.equal(sv("A6").summary, "Approve steps 1 and 2 only.", "repeat_of with none: the text replaced, the summary kept");
  A.equal(sv("A2").summary, "Paste the staging token (the one named ci-staging).", "the same text at a later turn with none: kept");
  st.apply(mev("prompt", { turn: 5, prompt_id: "s5", local: false, prompt_head: "[A1] yes, all five", refs: ["A1"] }));
  A.equal(sv("A1").status, "answered");
  rerun([mAsk("Confirm the pipeline changes in the table!", { summary: "A different summary the reopen does not take." })], 5, "model");
  A.equal(sv("A1").status, "open", "(answered, raised again: reopened)"); A.equal(sv("A1").text, TABLE, "...its text as it was");
  A.equal(sv("A1").summary, "Approve the changes, or name the ones to leave out.", "...and its summary as it was");
  st.apply(mev("act", { item: sv("A2").id, action: "resolve" })); st.apply(mev("act", { item: sv("A8").id, action: "dismiss" }));
  st.apply(mev("prompt", { turn: 6, prompt_id: "s6", local: false, prompt_head: "again", refs: [] }));
  rerun([mAsk("Send the staging token"), mAsk("Name the new owner", { summary: "Name the job's owner from Monday." })], 6, "model");
  const again2 = st.itemsOf(MS).find((it) => it.repeatOf === sv("A2").id), again8 = st.itemsOf(MS).find((it) => it.repeatOf === sv("A8").id);
  A.ok(again2 && again2.status === "open" && again2.parentId === sv("A2").id, "(resolved, raised again: a new item)");
  A.equal(Object.hasOwn(again2, "summary"), false, "...without the event's summary it has none (nothing carried from the old item)");
  A.equal(again8?.summary, "Name the job's owner from Monday.", "a dismissed one raised again: the new item has the event's summary");
  A.equal(sv("A2").summary, "Paste the staging token (the one named ci-staging).", "(the closed ones keep theirs)");

  // 6. snapshot.json carries none; the store keeps every one
  const snap = st.snapshot(at);
  A.ok(snap.items.some((it) => it.id === sv("A6").id), "(the open ask is in the snapshot)");
  A.equal(snap.items.some((it) => "summary" in it), false, "snapshot.json carries no summary");
  A.equal(st.itemsOf(MS).filter((it) => typeof it.summary === "string").length, 5, "...the store keeps them (A1, A2, A6, A8 and the owner ask raised again)");

  // 7. the archive: the copy holds it; a summary changed between the plan and the removal keeps the item (as any
  // field); the line restored is the item as it was, summary included
  st.apply(mev("act", { item: sv("A6").id, action: "resolve" }));
  const A6 = sv("A6").id, later = at + 10 * DAYS;
  let plan = st.archivable(3, later).filter((x) => x.id === A6);
  A.equal(plan.length, 1); A.equal(plan[0].summary, "Approve steps 1 and 2 only.", "the archive's copy holds the summary");
  rerun([mAsk("Approve steps 1 and 2 of the plan", { summary: "Changed while the file was written." })], 4, "model");
  A.equal(sv("A6").summary, "Changed while the file was written.", "(a re-run of its turn changed the closed item's summary)");
  A.deepEqual(st.removeItems(plan), [], "removeItems: a summary changed since the plan keeps the item for the next run");
  plan = st.archivable(3, later).filter((x) => x.id === A6);
  const line = JSON.stringify(plan[0]);
  A.equal(st.removeItems(plan).length, 1, "the next plan goes"); A.equal(st.item(A6), null);
  const back = st.restoreItem(JSON.parse(line));
  A.equal(JSON.stringify(back), line, "restoreItem: the item as archived, summary and handle included");
  delete st.d.items[A6]; st.d.sessions[MS].archived = 1;
  st.apply(mev("restore", { item: A6, file: "items-1795000000000-abc123.jsonl", reopen: true, record: JSON.parse(line) }));
  A.equal(sv("A6").status, "open", "(the dialog's Reopen: back, open)"); A.equal(sv("A6").summary, "Changed while the file was written.", "...with its summary");

  // 8. a cold file holds it; a reading copy's merge shows it and never saves it; a thaw brings each item back as
  // it was; coldLacks proves an identical copy and not one whose summary differs or is gone
  st.d.retention = { v: 1, at };
  const FN = at + 30 * DAYS, fp = st.planFreeze(7, FN).filter((p) => p.sid === MS);
  A.equal(fp.length, 1, "(the session is idle past a week)");
  const was = JSON.stringify(st.itemsOf(MS)), ids = st.itemsOf(MS).filter((it) => typeof it.summary === "string").map((it) => it.id);
  const file = CFG.coldName(MS, FN, "s0mm4r");
  A.deepEqual(st.commitFreeze([{ ...fp[0], file }], FN), [MS], "(frozen)");
  const rec = JSON.parse(JSON.stringify(fp[0].record));
  A.deepEqual(rec.items.filter((x) => typeof x.summary === "string").map((x) => x.id), ids, "the cold file holds every summary");
  A.equal(JSON.stringify(rec.items), was, "...each item whole");
  A.equal(st.toText().includes("Changed while the file was written."), false, "(store.json holds none of them now)");
  const rd = Store.fromText(st.toText());
  A.equal(rd.mergeCold(MS, rec, file), true);
  A.equal(rd.item(A6)?.summary, "Changed while the file was written.", "a reading copy's merge shows the summary");
  A.equal(rd.toText().includes("Changed while the file was written."), false, "...and never saves it"); A.equal(rd.snapshot(FN).items.some((it) => it.id === A6), false);
  const th = Store.fromText(st.toText());
  A.equal(th.thaw(MS, rec, file, FN + 1).ok, true);
  A.equal(JSON.stringify(th.itemsOf(MS)), was, "a thaw brings every item back as it was, summaries included");
  A.deepEqual(th.coldLacks(MS, rec), { items: 0, turns: 0 }, "coldLacks: identical copies in the store prove the file");
  const other = JSON.parse(JSON.stringify(rec)), gone = JSON.parse(JSON.stringify(rec));
  other.items.find((x) => x.id === A6).summary = "A later wording.";
  delete gone.items.find((x) => x.id === A6).summary;
  A.equal(th.coldLacks(MS, other).items, 1, "...a file whose summary the store does not hold is not proven");
  A.equal(th.coldLacks(MS, gone).items, 1, "...nor one whose item has no summary where the store's has one");
  A.equal(th.coldLacks(MS, other, { copies: new Map([[A6, [other.items.find((x) => x.id === A6)]]]) }).items, 0, "...unless an identical copy is elsewhere (the named file, the archive)");
}
const summaryChecks = checks - phase1 - phase2 - phase3 - sev - prof - toolChecks - settleChecks - spaceChecks - pinChecks - retChecks - coldChecks;

console.log(`OK: store, ${checks} checks (${phase1} phase 1, ${phase2} phase 2, ${phase3} phase 3, ${sev} severity and resume, ${prof} profiles, handoff and paste words, ${toolChecks} tool asks, ${settleChecks} blocking while working, closed by the agent, answered then settled, ${spaceChecks} spaces off and Clear all, ${pinChecks} pins, ${retChecks} retention${retSizes}, ${coldChecks} cold sessions${coldSizes}, ${summaryChecks} ask summary), 0 failure(s)`);
