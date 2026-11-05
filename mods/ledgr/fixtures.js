// ledgr demo data: a store with both lanes, every status, a decide with options and a draft,
// a blocking ask, a clarification thread, an unsettled capture, a bookmark, an extraction
// error line, an item older than a day, a deferred and closed fold, a dismissed ask raised
// again, a second agent kind with extraction pending; Phase 2: a branch of Q3 (depth 1, its own
// ask and a ledgr-conclusion), a compaction after the anchor, a refused depth-3 request; Phase 3: a
// branch of Q2 that rejoined (its confluence landed at turn 12, Q2 resolved by it, terminal closed).
// Drawn when props().demo, FORCE_DEMO (config.js) or `herdr-app do ledgr.demo`. Never saved,
// never published to shared(), never written to ledgr-data.
import { passageHash } from "./store.js";

const SID = "88c36d53-demo-4ccd-8fa6-2c260f89cc18";
const SID2 = "0b7f5e21-demo-codex-session";
const SID3 = "5d1c9a40-demo-ended-session";
const SIDB = "7e2a41c0-demo-branch-q3-session";

const T17 = `I checked the scan output against the registry on PRODAPP.

**What I found.** TLS 1.0 is disabled in SChannel, so the scanner result is likely stale: the last Qualys run predates the reboot. RC4 is still enabled under \`Ciphers\\RC4 128/128\`.

**What I need from you.**
1. Pick the TLS cipher order for PRODAPP. I recommend Mozilla intermediate; CIS L1 is stricter but drops two suites the old Crystal runtime still uses.
2. Run the Qualys rescan after the reboot tonight. I am waiting on that result before I close the ticket.
3. OK to remove RC4 from the registry? It is a one-line change and reversible.
4. Review the IIS bindings list I wrote to \`reports/iis-bindings.md\` and tell me if any site is missing.`;

const T12 = `The release branch \`release/5.4\` is two weeks stale and has no open PRs.

Decide whether to keep the stale release branch or delete it after tagging. Also, please send me the PRODAPP service account name when you have it.`;

const T14 = `TLS 1.0 is disabled in SChannel, so the scanner result is likely stale. The next scan will confirm.`;

const TB1 = `Turn 14 said the scanner result was "likely stale". Turns 15 to 18 change that: the Qualys run at turn 16 came after the reboot and still flagged TLS 1.0, so the setting is not what the scanner sees.

The likely cause is the IIS binding on port 8443, which terminates TLS in the Crystal runtime and ignores SChannel.

\`\`\`ledgr-conclusion
answer: The flag is real, not stale: port 8443 is served by the Crystal runtime, which does its own TLS and still offers 1.0.
changes: drop "the scan is stale" from the ticket; add the 8443 binding to the TLS change list
\`\`\``;

export const FIXTURE_TURNS = { [`${SID}:17`]: T17, [`${SID}:12`]: T12, [`${SID}:14`]: T14, [`${SIDB}:1`]: TB1 };

export function demoData(now = Date.now()) {
  const min = 60e3, day = 86400e3;
  const items = {};
  let n = 0;
  const add = (o) => {
    const id = `rq_demo_${++n}`;
    const quote = o.quote ?? null;
    items[id] = {
      id, key: id, status: "open", origin: o.direction === "human_to_agent" ? "capture" : "extract_block",
      terminal: o.sid === SID2 ? "t7" : "t3", createdAt: now - (o.ago ?? 10) * min, updatedAt: now - (o.ago ?? 10) * min, seq: n,
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

  const a5 = ask({ handle: "A5", turn: 17, kind: "decide", text: "Pick the TLS cipher order for PRODAPP",
    options: ["Mozilla intermediate", "CIS L1"], recommended: "Mozilla intermediate", seq: 0,
    quote: "Pick the TLS cipher order for PRODAPP. I recommend Mozilla intermediate", draft: "Mozilla intermediate, as you recommended.", ago: 3 });
  ask({ handle: "A6", turn: 17, kind: "do", text: "Run the Qualys rescan after the reboot tonight", blocking: true, seq: 1,
    quote: "Run the Qualys rescan after the reboot tonight. I am waiting on that result", ago: 3 });
  ask({ handle: "A7", turn: 17, kind: "confirm", text: "OK to remove RC4 from the registry?", status: "answered", answer: "Yes, remove RC4.", seq: 2,
    quote: "OK to remove RC4 from the registry?", ago: 3 });
  ask({ handle: "A8", turn: 17, kind: "review", text: "Review the IIS bindings list in reports/iis-bindings.md for missing sites", origin: "extract_model", seq: 3,
    quote: "Review the IIS bindings list I wrote to `reports/iis-bindings.md`", ago: 3 });
  ask({ handle: "A3", turn: 12, kind: "provide", text: "Send the PRODAPP service account name", seq: 1,
    quote: "please send me the PRODAPP service account name", ago: 2 * 24 * 60 + 30 });
  ask({ handle: "A2", turn: 12, kind: "decide", text: "Decide whether to keep the stale release branch", status: "resolved", resolvedAt: now - 3 * 60 * min, resolvedTurn: 13,
    options: ["keep", "delete after tagging"], recommended: null, quote: "Decide whether to keep the stale release branch", ago: 300 });
  ask({ handle: "A4", turn: 15, kind: "provide", text: "Find the 2019 cipher change ticket number", status: "deferred", deferUntil: "next_session", ago: 120 });
  const a1 = ask({ handle: "A1", turn: 9, kind: "confirm", text: "Shall I restart IIS now?", status: "dismissed", resolvedAt: now - 9 * 60 * min, resolvedTurn: 9, ago: 600 });
  ask({ handle: "A9", turn: 17, kind: "confirm", text: "Shall I restart IIS now?", repeatOf: a1, seq: 4, ago: 3 });

  const q3 = q({ handle: "Q3", turn: 14, kind: "question", text: "Why does the scan still flag TLS 1.0 if SChannel has it off?",
    quote: "TLS 1.0 is disabled in SChannel, so the scanner result is likely stale.", ago: 90 });
  q({ handle: "Q4", turn: 18, kind: "question", text: "Does the reboot also reset the cipher order?", settled: false, capturedDuring: "working", ago: 1 });
  q({ handle: "Q5", turn: 16, kind: "question", text: "What does Crystal need from SChannel?", status: "answered", askedAtTurn: 16, ago: 50 });
  q({ handle: "Q6", turn: 17, kind: "bookmark", text: "", quote: "RC4 is still enabled under `Ciphers\\RC4 128/128`.", ago: 2 });
  q({ handle: "Q7", turn: 17, kind: "question", text: "re [A5] does CIS L1 break the old scanners?", parentId: a5, origin: "btw", btwStagedAt: now - 2 * min, ago: 2 });
  const q2 = q({ handle: "Q2", turn: 11, kind: "question", text: "Is the old cert still bound anywhere?", status: "resolved", resolvedAt: now - 5 * 60 * min, ago: 400,
    resolvedTurn: 12, resolvedBy: "branch", resolution: { branchId: "br_demo_q2_a41b", turn: 12, at: now - 5 * 60 * min } });
  q({ handle: "Q1", sid: SID2, turn: 4, kind: "question", text: "Which changelog format does the release use?", ago: 30 });
  ask({ handle: "A1", sid: SID2, turn: 4, kind: "decide", text: "Choose the release-notes tone", options: ["terse", "narrative"], recommended: "terse", ago: 30 });
  ask({ handle: "A1", sid: SIDB, turn: 1, kind: "confirm", text: "Should I add the 8443 binding to the TLS change list?", ago: 20,
    quote: "add the 8443 binding to the TLS change list" });
  items[q3].branch = { branchId: "br_demo_q3_7c1e" };
  items[q2].branch = { branchId: "br_demo_q2_a41b" };

  const sess = (sid, o) => ({ sessionId: sid, turnSource: "hooks", nextHandle: { A: 9, Q: 8 }, startedAt: now - day, updatedAt: now - 60e3, seenAt: now - 30 * min, promptAt: now - 2 * min, surfaced: false, ...o });
  return {
    v: 1,
    items,
    sessions: {
      [SID]: sess(SID, { agent: "claude-code", terminal: "t3", sessionName: "frozen trunk conversation", cwd: "~/Projects/app", repo: "the project", transcriptPath: null, turn: 18, state: "working",
        compactions: [{ turn: 16, at: now - 60 * min, trigger: "auto" }] }),
      [SID2]: sess(SID2, { agent: "codex", terminal: "t7", sessionName: "release notes", cwd: "~/src/app", repo: "app", turn: 4, state: "idle", surfaced: true, updatedAt: now - 120e3,
        pending: { turn: 4, at: now + 365 * day } }),   // demo only: never times out
      [SID3]: sess(SID3, { agent: "claude-code", terminal: "t5", sessionName: "vpn watchdog", cwd: "~", repo: null, turn: 9, state: "ended", updatedAt: now - day }),
      [SIDB]: sess(SIDB, { agent: "claude-code", terminal: "t8", sessionName: "Q3: Why does the scan still flag TLS 1.0 if SChannel…", cwd: "~/Projects/app",
        repo: "the project", turn: 1, state: "idle", parentSessionId: SID, parentItem: q3, anchorTurn: 14, forkTurn: 18, depth: 1, branchId: "br_demo_q3_7c1e", updatedAt: now - 20 * min }),
    },
    // Manifest and preamble are computed by the panel (enterDemo), as the writer does at launch.
    branches: {
      br_demo_q3_7c1e: { id: "br_demo_q3_7c1e", requestId: q3, parentSessionId: SID, parentTerminal: "t3", sessionId: SIDB, childSid: SIDB, terminal: "t8",
        name: "br-q3-7c1e", label: "Q3: Why does the scan still flag TLS 1.0 if SChannel…", depth: 1, anchorTurn: 14, forkTurn: 18,
        policy: "fork_end_of_session", placement: "split", isolate: false, cwd: "~/Projects/app", status: "running", demoStatus: "idle",
        createdAt: now - 22 * min, launchedAt: now - 22 * min, startedAt: now - 22 * min, updatedAt: now - 20 * min },
      br_demo_q2_a41b: { id: "br_demo_q2_a41b", requestId: q2, parentSessionId: SID, parentTerminal: "t3", sessionId: null, childSid: null, terminal: "t6",
        name: "br-q2-a41b", label: "Q2: Is the old cert still bound anywhere?", depth: 1, anchorTurn: 11, forkTurn: 11,
        policy: "fork_end_of_session", placement: "split", isolate: false, cwd: "~/Projects/app", status: "rejoined", demoStatus: "closed",
        conclusion: { text: "answer: No. The old cert is bound nowhere: the 2019 thumbprint is absent from every IIS binding and from the SQL endpoint.\nchanges: none",
          source: "block", sourceTurn: 1, trunkTurn: 11, at: now - 5 * 60 * min - 2 * min },
        concludedAt: now - 5 * 60 * min - 2 * min, rejoinedTurn: 12, rejoinedAt: now - 5 * 60 * min, closedAt: now - 5 * 60 * min + min,
        createdAt: now - 6 * 60 * min, launchedAt: now - 6 * 60 * min, startedAt: now - 6 * 60 * min, updatedAt: now - 5 * 60 * min },
      br_demo_refused: { id: "br_demo_refused", requestId: null, parentSessionId: SID, name: "br-q9-0d3a", depth: 3, status: "refused",
        error: "depth 3 is beyond branch.maxDepth 2 (ledgr-data/config.json)", createdAt: now - 5 * min, updatedAt: now - 5 * min },
    },
    terminals: { t3: { sessionId: SID, agent: "claude-code", updatedAt: now - 60e3 }, t7: { sessionId: SID2, agent: "codex", updatedAt: now - 120e3 } },
    turns: {
      [SID]: {
        17: { stopAt: now - 3 * min, textHead: T17.slice(0, 400), asks: { source: "block", count: 4, at: now - 3 * min } },
        15: { stopAt: now - 120 * min, asks: { source: "error", error: "no credential", count: 0, at: now - 120 * min } },
        12: { stopAt: now - 2 * day, asks: { source: "model", count: 2, at: now - 2 * day } },
      },
      [SIDB]: { 1: { stopAt: now - 20 * min, textHead: TB1.slice(0, 400), asks: { source: "model", count: 1, at: now - 20 * min } } },
    },
    ingested: [],
  };
}

export const DEMO_SESSION = SID;
