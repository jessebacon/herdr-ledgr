// ledgr store unit test: event application (Phase 1, ported from the build session's scratchpad
// storetest/test.mjs) and the Phase 2 branch events, manifest, preamble and launch argv; Phase 3:
// conclude, the confluence and answer-sheet messages, confluence_landed, answers_landed, close_branch.
// Writes the composed messages to <folder>/msg-*.txt so test-store.sh can run the hooks' parser on them.
//   node tests/test_store.mjs <folder holding store.js, branch.js, config.js, confluence.js>   (tests/test-store.sh)
import assert from "node:assert/strict";
const dir = process.argv[2];
if (!dir) { console.error("usage: test_store.mjs <module folder>"); process.exit(2); }
const { Store, passageHash, norm, levelOf, isSuggestion, thresholdOf, LEVELS } = await import(`${dir}/store.js`);
const B = await import(`${dir}/branch.js`);
const CF = await import(`${dir}/confluence.js`);
const fsm = await import("node:fs");
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
st.apply(tev("prompt", { turn: 5, prompt_id: "tp5", local: false, prompt_head: sheet, refs: [] }));
A.equal(a1.status, "open", "the sheet has no [A1] refs: the prompt alone does not answer");
st.apply(tev("answers_landed", { turn: 5, for_session: OTHER, handles: ["A1"], answers: { A1: "x" } }));
A.equal(a1.status, "open", "a sheet for another session is ignored");
st.apply(tev("answers_landed", { turn: 5, for_session: TR, handles: ["A1", "A2", "A3", "A9"], answers: { A1: "a, as you recommended.", A2: "after the reboot", A3: "late" } }));
A.equal(a1.status, "answered"); A.equal(a1.answer, "a, as you recommended."); A.equal(a1.answeredTurn, 5); A.equal(a1.answeredBy, "sheet");
A.equal(a2.status, "answered"); A.equal(a2.answer, "after the reboot");
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
// the blocking state yields to working and to collecting; resolving the blocker ends it
st.apply(vev("prompt", { turn: 2, prompt_id: "vp2", local: false, prompt_head: "next", refs: [] }));
A.notEqual(st.chips()[VT].st, "blocking", "agent working: not the blocking state");
st.apply(vev("stop", { turn: 2, prompt_id: "vp2", text_path: null, text_head: "", passage_hash: "v2" }));
A.equal(st.chips()[VT].st, "blocking", "idle again with the blocker open");
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
const sev = checks - phase1 - phase2 - phase3;

console.log(`OK: store, ${checks} checks (${phase1} phase 1, ${phase2} phase 2, ${phase3} phase 3, ${sev} severity and resume), 0 failure(s)`);
