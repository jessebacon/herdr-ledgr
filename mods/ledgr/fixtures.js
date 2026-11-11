// ledgr demo data: a store with both lanes, every status, a decide with options and a draft,
// a blocking ask, a clarification thread, an unsettled capture, a bookmark, an extraction
// error line, an item older than a day, a deferred and closed fold, a dismissed ask raised
// again, a second agent kind with extraction pending; Phase 2: a branch of Q3 (depth 1, its own
// ask and a ledgr-conclusion), a compaction after the anchor, a refused depth-3 request; Phase 3: a
// branch of Q2 that rejoined (its confluence landed at turn 12, Q2 resolved by it, terminal closed).
// Layout cases (nothing may clip at 280-360 px): a long decide with a long recommended option (A10),
// a 600-character ask (A11), a single unbroken 120-character token (A12), a parked question with a
// long URL (Q8). Severity: A6 blocking (sorted first, ◆, the chip's blocking state), A13 and A14
// optional (the folded "suggestions (2)" line of turn 17, each with promote). A15 a blocking decide
// with options, sorted after A6 (the staged preview expands it: docs/preview-recipe.md).
// Pins (docs/design/Pins.md 4.10): three, Pin 1 and Pin 2 (with a note) of the demo session and Pin 1
// of the release-notes session, and Q9, parked with two of them (one from each session), asked in the
// trunk at turn 16 and answered, so the PINS lane, a usage line and a question with pins all show.
// The detail dialog (docs/design/Detail.md 2.10): Pin 3 of the demo session, archived ("archived (1)",
// Restore, Delete), and Pin 1 of a session no longer in `sessions` (a search shows it as forgotten).
// Every section of the dialog has a case: A15 (a blocking decide with options, its passage in turn 17),
// A7 (answered), A9 (raised again), Q3 (a running branch with a ledgr-conclusion), Q2 (rejoined), Q5 (its
// message not saved), Q6 (a bookmark), Q9 (two pins, answered), P2 (a note). DEMO_DETAIL: the dialog
// `ledgr.demo-detail` opens without a handle. The settings dialog (2026-11-10): DEMO_SPACES and DEMO_OFF.
// Drawn when props().demo, FORCE_DEMO (config.js) or `herdr-app do ledgr.demo`. Never saved,
// never published to shared(), never written to ledgr-data.
import { passageHash } from "./store.js";

const SID = "11111111-demo-4aaa-8bbb-000000000001";
const SID2 = "22222222-demo-4aaa-8bbb-000000000002";
const SID3 = "33333333-demo-4aaa-8bbb-000000000003";
const SIDB = "44444444-demo-4aaa-8bbb-000000000004";
const SIDF = "55555555-demo-4aaa-8bbb-000000000005";   // a forgotten session: only its pin is left

const T17 = `I checked the migration output against the staging database for shop-api.

**What I found.** The \`orders\` migration finished cleanly on staging, so the failing load test is likely stale: the last run predates tonight's deploy. The old \`orders_legacy\` view is still present in the \`public\` schema.

**What I need from you.**
1. Pick the connection pool mode for production. I recommend transaction pooling; session pooling is simpler but holds one connection per client and exhausts the pool under load.
2. Run the load test after tonight's deploy. I am waiting on that result before I close the ticket.
3. OK to drop the \`orders_legacy\` view? It is a one-line change and reversible.
4. Review the pool settings export I wrote to \`reports/pool-settings.md\` and tell me if any service is missing.
5. Choose the cutover night for the pool change: tonight after the deploy, or Thursday. I cannot schedule it until you pick one.

Want me to also script the settings export for next time? And you may want to move the reporting job off the primary at some point.`;

const T12 = `The release branch \`release/5.4\` is two weeks stale and has no open PRs.

Decide whether to keep the stale release branch or delete it after tagging. Also, please send me the staging database service account name when you have it.`;

const T14 = `The orders migration finished cleanly on staging, so the load test result is likely stale. The next run will confirm.`;

const TB1 = `Turn 14 said the load test result was "likely stale". Turns 15 to 18 change that: the load test at turn 16 came after the staging deploy and still failed, so the migration is not what the test is hitting.

The likely cause is the legacy gateway on port 8443, which still reads the \`orders_legacy\` view and ignores the new pool.

\`\`\`ledgr-conclusion
answer: The failure is real, not stale: port 8443 is served by the legacy gateway, which still reads the old view and bypasses the new pool.
changes: drop "the load test is stale" from the ticket; add the 8443 gateway to the cutover list
\`\`\``;

// The second session's turn 4: a 1,500-word message (show whole message opens it at full height; the
// panel's list must reach its last line), with the ask in its last paragraph.
const LONG_PARA = "I went through the release notes for every merged pull request since the last tag, grouped them by area, and checked each entry against its pull request description and the linked tracker issue, so that nothing in the notes promises more than the code does and every breaking change names the setting it affects.";
const T4_CODEX = [
  ...Array.from({ length: 27 }, (_, i) => `${i + 1}. ${LONG_PARA}`),
  "Choose the release-notes tone: terse or narrative. I recommend terse, since most readers skim the list.",
  "LAST LINE OF THE 1,500-WORD MESSAGE: the notes end here.",
].join("\n\n");

export const FIXTURE_TURNS = { [`${SID}:17`]: T17, [`${SID}:12`]: T12, [`${SID}:14`]: T14, [`${SIDB}:1`]: TB1, [`${SID2}:4`]: T4_CODEX };

export function demoData(now = Date.now()) {
  const min = 60e3, day = 86400e3;
  const items = {};
  let n = 0;
  const add = (o) => {
    const id = `rq_demo_${++n}`;
    const quote = o.quote ?? null;
    items[id] = {
      id, key: id, status: "open", origin: o.direction === "human_to_agent" ? "capture" : "extract_block",
      terminal: o.sid === SID2 ? "t27" : "t21", createdAt: now - (o.ago ?? 10) * min, updatedAt: now - (o.ago ?? 10) * min, seq: n,
      ...o,
      anchor: { sessionId: o.sid ?? SID, turn: o.turn, uuid: null, quote, quoteSource: quote ? (o.direction === "human_to_agent" ? "clipboard" : "block") : undefined,
        hash: passageHash(quote || o.text), settled: o.settled ?? true, capturedDuring: o.capturedDuring },
      createdTurn: o.turn,
    };
    delete items[id].sid; delete items[id].quote; delete items[id].ago; delete items[id].settled; delete items[id].turn; delete items[id].capturedDuring;
    return id;
  };
  const ask = (o) => add({ direction: "agent_to_human", ...o });
  const q = (o) => add({ direction: "human_to_agent", ...o });

  const a5 = ask({ handle: "A5", turn: 17, kind: "decide", text: "Pick the connection pool mode for production",
    options: ["Transaction pooling", "Session pooling"], recommended: "Transaction pooling", seq: 0,
    quote: "Pick the connection pool mode for production. I recommend transaction pooling", draft: "Transaction pooling, as you recommended.", ago: 3 });
  ask({ handle: "A6", turn: 17, kind: "do", text: "Run the load test after tonight's deploy", level: "blocking", blocking: true, seq: 1,
    quote: "Run the load test after tonight's deploy. I am waiting on that result", ago: 3 });
  ask({ handle: "A15", turn: 17, kind: "decide", text: "Choose the cutover night for the pool change", level: "blocking", blocking: true, seq: 1.5,
    options: ["Tonight, after the deploy", "Thursday night"], recommended: "Thursday night",
    quote: "Choose the cutover night for the pool change: tonight after the deploy, or Thursday. I cannot schedule it until you pick one.", ago: 3 });
  ask({ handle: "A7", turn: 17, kind: "confirm", text: "OK to drop the orders_legacy view?", status: "answered", answer: "Yes, drop it.", seq: 2,
    quote: "OK to drop the `orders_legacy` view?", ago: 3 });
  ask({ handle: "A8", turn: 17, kind: "review", text: "Review the pool settings export in reports/pool-settings.md for missing services", origin: "extract_model", seq: 3,
    quote: "Review the pool settings export I wrote to `reports/pool-settings.md`", ago: 3 });
  ask({ handle: "A10", turn: 17, kind: "decide", seq: 5, ago: 3,
    text: "Decide whether to run the whole cutover tonight (schema change and the 8443 gateway repointing together) or split it across two nights so the nightly reports can be checked in between",
    options: ["Tonight, all at once", "Split it across two nights so the nightly reports can be re-run and checked between the schema change and the gateway repointing"],
    recommended: "Split it across two nights so the nightly reports can be re-run and checked between the schema change and the gateway repointing" });
  ask({ handle: "A11", turn: 17, kind: "review", seq: 6, ago: 3,
    text: "Review the cutover plan before tonight's window. Step one adds the pooler role and grants it read and write on the orders schema, then lowers the direct connection limit on the primary. Step two sets the pool mode to transaction pooling under pool.mode in /etc/pgbouncer/pgbouncer.ini. Step three repoints port 8443 to the new pool so the legacy gateway stops reading the old view. Step four restarts the API and re-runs the load test. If a step fails, the rollback is the dump in /backups/orders-2026-11-05.sql and the old pool config, which I left in place but disabled. Tell me if any step should wait." });
  ask({ handle: "A12", turn: 17, kind: "confirm", seq: 7, ago: 3,
    text: "Confirm the migration checksum: 95F8188C77C9FC12763685BA039867E6F60EAAFCF0BCA19C7231D4152CF02433F21E11EAB2886125C71970ED5D7A3A0D426383B325940EA956D0222A" });
  ask({ handle: "A13", turn: 17, kind: "confirm", level: "optional", seq: 8, ago: 3, origin: "extract_model",
    text: "Decide whether the agent should also script the settings export for next time",
    quote: "Want me to also script the settings export for next time?" });
  ask({ handle: "A14", turn: 17, kind: "do", level: "optional", seq: 9, ago: 3, origin: "extract_model",
    text: "Consider moving the reporting job off the primary later",
    quote: "you may want to move the reporting job off the primary at some point" });
  ask({ handle: "A3", turn: 12, kind: "provide", text: "Send the staging database service account name", seq: 1,
    quote: "please send me the staging database service account name", ago: 2 * 24 * 60 + 30 });
  ask({ handle: "A2", turn: 12, kind: "decide", text: "Decide whether to keep the stale release branch", status: "resolved", resolvedAt: now - 3 * 60 * min, resolvedTurn: 13,
    options: ["keep", "delete after tagging"], recommended: null, quote: "Decide whether to keep the stale release branch", ago: 300 });
  ask({ handle: "A4", turn: 15, kind: "provide", text: "Find the 2019 pool size change ticket number", status: "deferred", deferUntil: "next_session", ago: 120 });
  const a1 = ask({ handle: "A1", turn: 9, kind: "confirm", text: "Shall I restart the legacy gateway now?", status: "dismissed", resolvedAt: now - 9 * 60 * min, resolvedTurn: 9, ago: 600 });
  ask({ handle: "A9", turn: 17, kind: "confirm", text: "Shall I restart the legacy gateway now?", repeatOf: a1, seq: 4, ago: 3 });

  const q3 = q({ handle: "Q3", turn: 14, kind: "question", text: "Why does the load test still fail if the migration finished cleanly?",
    quote: "The orders migration finished cleanly on staging, so the load test result is likely stale.", ago: 90 });
  q({ handle: "Q4", turn: 18, kind: "question", text: "Does the deploy also reset the pool size?", settled: false, capturedDuring: "working", ago: 1 });
  q({ handle: "Q5", turn: 16, kind: "question", text: "What does the legacy gateway need from the pooler?", status: "answered", askedAtTurn: 16, ago: 50 });
  q({ handle: "Q6", turn: 17, kind: "bookmark", text: "", quote: "The old `orders_legacy` view is still present in the `public` schema.", ago: 2 });
  q({ handle: "Q8", turn: 17, kind: "question", ago: 1,
    text: "Is https://grafana.example.com/d/shop-api-pool/connection-pool?orgId=1&var-env=production&var-service=shop-api&from=now-6h&to=now&viewPanel=12 still the dashboard the load test reports to?" });
  q({ handle: "Q7", turn: 17, kind: "question", text: "re [A5] does transaction pooling break prepared statements?", parentId: a5, origin: "btw", btwStagedAt: now - 2 * min, ago: 2 });
  const q2 = q({ handle: "Q2", turn: 11, kind: "question", text: "Is the old database hostname still referenced anywhere?", status: "resolved", resolvedAt: now - 5 * 60 * min, ago: 400,
    resolvedTurn: 12, resolvedBy: "branch", resolution: { branchId: "br_demo_q2_a41b", turn: 12, at: now - 5 * 60 * min } });
  q({ handle: "Q1", sid: SID2, turn: 4, kind: "question", text: "Which changelog format does the release use?", ago: 30 });
  ask({ handle: "A1", sid: SID2, turn: 4, kind: "decide", text: "Choose the release-notes tone", options: ["terse", "narrative"], recommended: "terse", ago: 30,
    quote: "Choose the release-notes tone: terse or narrative." });
  ask({ handle: "A1", sid: SIDB, turn: 1, kind: "confirm", text: "Should I add the 8443 gateway to the cutover list?", ago: 20,
    quote: "add the 8443 gateway to the cutover list" });
  items[q3].branch = { branchId: "br_demo_q3_7c1e" };
  items[q2].branch = { branchId: "br_demo_q2_a41b" };

  // Pins: the passage as fullscreen Claude copies it (markdown marks dropped), its anchor, its source.
  const SRC = {
    [SID]: { sessionName: "shop-api migration", repo: "shop-api", cwd: "/Users/example/src/shop-api", agent: "claude-code", profile: null, configDir: null },
    [SID2]: { sessionName: "release notes", repo: "shop-web", cwd: "/Users/example/src/shop-web", agent: "codex", profile: null, configDir: null },
    [SIDF]: { sessionName: "billing retries spike", repo: "billing", cwd: "/Users/example/src/billing", agent: "claude-code", profile: null, configDir: null },
  };
  const TERM = { [SID]: "t21", [SID2]: "t27", [SIDF]: "t19" };
  const pins = {};
  const pin = (id, handle, sid, turn, text, o = {}) => {
    pins[id] = { id, handle, sessionId: sid, text, note: o.note ?? null,
      anchor: { sessionId: sid, terminal: TERM[sid] ?? "t21", turn, uuid: null, promptId: null, hash: passageHash(text), quoteSource: "clipboard",
        verified: "turn", settled: true, approx: false },
      source: SRC[sid], status: "open", createdAt: now - o.ago * min, createdTurn: turn, updatedAt: now - o.ago * min, usedIn: [], answeredIn: [] };
    return id;
  };
  const pA = pin("pn_demo-pin-000a", "P1", SID, 12, "The release branch release/5.4 is two weeks stale and has no open PRs.", { ago: 2 * 24 * 60 });
  pin("pn_demo-pin-000b", "P2", SID, 14, "The orders migration finished cleanly on staging, so the load test result is likely stale. The next run will confirm.",
    { ago: 88, note: "the claim turn 16 overturned" });
  const pC = pin("pn_demo-pin-000c", "P1", SID2, 4, "Choose the release-notes tone: terse or narrative. I recommend terse, since most readers skim the list.", { ago: 31 });
  // Pin 3, archived; a pin whose session was forgotten (its `source` still names it).
  const pD = pin("pn_demo-pin-000d", "P3", SID, 12, "Decide whether to keep the stale release branch or delete it after tagging.", { ago: 2 * 24 * 60 - 5, note: "settled at turn 13: kept until tagging" });
  Object.assign(pins[pD], { status: "archived", archivedAt: now - 24 * 60 * min, updatedAt: now - 24 * 60 * min });
  pin("pn_demo-pin-000e", "P1", SIDF, 7, "Retries are capped at two per request; the third failure surfaces to the caller at once.", { ago: 9 * 24 * 60 });
  const QT = "If release/5.4 is stale, do the release notes still need writing before the cutover?";
  const q9 = q({ handle: "Q9", turn: 15, kind: "question", text: QT, status: "answered", askedAtTurn: 16, askedVia: "pins", pins: [pA, pC], ago: 28,
    pinsAsked: { turn: 16, at: now - 27 * min, promptId: null, answeredAt: now - 25 * min } });
  for (const id of [pA, pC]) {
    pins[id].usedIn.push({ question: q9, session: SID, handle: "Q9", head: QT.slice(0, 80), at: now - 28 * min });
    pins[id].answeredIn.push({ question: q9, session: SID, handle: "Q9", turn: 16, via: "trunk", at: now - 25 * min });
  }

  const sess = (sid, o) => ({ sessionId: sid, turnSource: "hooks", nextHandle: { A: 16, Q: 10, P: 3 }, startedAt: now - day, updatedAt: now - 60e3, seenAt: now - 30 * min, promptAt: now - 2 * min, surfaced: false, ...o });
  return {
    v: 1,
    items,
    pins,
    sessions: {
      [SID]: sess(SID, { agent: "claude-code", terminal: "t21", sessionName: "shop-api migration", cwd: "/Users/example/src/shop-api", repo: "shop-api", transcriptPath: null, turn: 18, state: "working",
        compactions: [{ turn: 16, at: now - 60 * min, trigger: "auto" }], nextHandle: { A: 16, Q: 10, P: 4 } }),
      [SID2]: sess(SID2, { agent: "codex", terminal: "t27", sessionName: "release notes", cwd: "/Users/example/src/shop-web", repo: "shop-web", turn: 4, state: "idle", surfaced: true, updatedAt: now - 120e3,
        nextHandle: { A: 2, Q: 2, P: 2 }, pending: { turn: 4, at: now + 365 * day } }),   // demo only: never times out
      [SID3]: sess(SID3, { agent: "claude-code", terminal: "t25", sessionName: "flaky test hunt", cwd: "/Users/example", repo: null, turn: 9, state: "ended", updatedAt: now - day }),
      [SIDB]: sess(SIDB, { agent: "claude-code", terminal: "t28", sessionName: "Q3: Why does the load test still fail if the…", cwd: "/Users/example/src/shop-api",
        repo: "shop-api", turn: 1, state: "idle", parentSessionId: SID, parentItem: q3, anchorTurn: 14, forkTurn: 18, depth: 1, branchId: "br_demo_q3_7c1e", updatedAt: now - 20 * min }),
    },
    // Manifest and preamble are computed by the panel (enterDemo), as the writer does at launch.
    branches: {
      br_demo_q3_7c1e: { id: "br_demo_q3_7c1e", requestId: q3, parentSessionId: SID, parentTerminal: "t21", sessionId: SIDB, childSid: SIDB, terminal: "t28",
        name: "br-q3-7c1e", label: "Q3: Why does the load test still fail if the…", depth: 1, anchorTurn: 14, forkTurn: 18,
        policy: "fork_end_of_session", placement: "split", isolate: false, cwd: "/Users/example/src/shop-api", status: "running", demoStatus: "idle",
        createdAt: now - 22 * min, launchedAt: now - 22 * min, startedAt: now - 22 * min, updatedAt: now - 20 * min },
      br_demo_q2_a41b: { id: "br_demo_q2_a41b", requestId: q2, parentSessionId: SID, parentTerminal: "t21", sessionId: null, childSid: null, terminal: "t26",
        name: "br-q2-a41b", label: "Q2: Is the old database hostname still referenced anywhere?", depth: 1, anchorTurn: 11, forkTurn: 11,
        policy: "fork_end_of_session", placement: "split", isolate: false, cwd: "/Users/example/src/shop-api", status: "rejoined", demoStatus: "closed",
        conclusion: { text: "answer: No. The old database hostname is referenced nowhere: it is absent from every service config and from the job scheduler.\nchanges: none",
          source: "block", sourceTurn: 1, trunkTurn: 11, at: now - 5 * 60 * min - 2 * min },
        concludedAt: now - 5 * 60 * min - 2 * min, rejoinedTurn: 12, rejoinedAt: now - 5 * 60 * min, closedAt: now - 5 * 60 * min + min,
        createdAt: now - 6 * 60 * min, launchedAt: now - 6 * 60 * min, startedAt: now - 6 * 60 * min, updatedAt: now - 5 * 60 * min },
      br_demo_refused: { id: "br_demo_refused", requestId: null, parentSessionId: SID, name: "br-q9-0d3a", depth: 3, status: "refused",
        error: "depth 3 is beyond branch.maxDepth 2 (ledgr-data/config.json)", createdAt: now - 5 * min, updatedAt: now - 5 * min },
    },
    terminals: { t21: { sessionId: SID, agent: "claude-code", updatedAt: now - 60e3 }, t27: { sessionId: SID2, agent: "codex", updatedAt: now - 120e3 } },
    turns: {
      [SID]: {
        17: { stopAt: now - 3 * min, textHead: T17.slice(0, 400), asks: { source: "block", count: 5, at: now - 3 * min } },
        15: { stopAt: now - 120 * min, asks: { source: "error", error: "no credential", count: 0, at: now - 120 * min } },
        12: { stopAt: now - 2 * day, asks: { source: "model", count: 2, at: now - 2 * day } },
      },
      [SIDB]: { 1: { stopAt: now - 20 * min, textHead: TB1.slice(0, 400), asks: { source: "model", count: 1, at: now - 20 * min } } },
    },
    ingested: [],
  };
}

export const DEMO_SESSION = SID;
// The demo item `ledgr.demo-detail` opens the dialog on when no handle is given (a blocking decide).
export const DEMO_DETAIL = "A15";

// The settings dialog's demo (settings.js, 2026-11-10): two spaces Herdr has, the first one the focused
// pane's, ledgr off in the second, and an off space Herdr no longer has (shown by its id, with Drop).
export const DEMO_SPACES = [
  { id: "spa1b2c3d4e5f60718293a4b5c6d7e8f90", index: 0, name: "shop-api", named: true },
  { id: "spb2c3d4e5f60718293a4b5c6d7e8f90a1", index: 1, name: "release-notes", named: true },
];
export const DEMO_OFF = ["spb2c3d4e5f60718293a4b5c6d7e8f90a1", "spdead000000000000000000000000beef"];
