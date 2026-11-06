// ledgr branches (Phase 2, spec 8): the context manifest, the preamble and the launch argv for a
// branch opened from a parked question. Pure: no files, no UI, no Herdr calls, so store.js,
// writer.js and panel.js share one definition.
//
// A branch is a NEW Claude Code session: `claude --resume <parent sid> --fork-session`, started by
// the writer with `hc run --parent <trunk terminal> --outlive-parent --no-notify`, so Herdr's
// agents tree shows it under the trunk. The child's SessionStart hook reads LEDGR_PARENT and
// LEDGR_BRANCH from its environment (set through `env` in the argv) and emits `branch_started`.
//   LEDGR_PARENT = <parent sid>:<item id>:<anchor turn>
//   LEDGR_BRANCH = <branch id>:<depth>:<fork turn>:<child sid>
// The fork is always taken at the END of the parent session (no CLI flag forks earlier), so a
// question parked at turn A and branched at turn F also carries turns A+1..F: the manifest and
// the preamble say so.
//
// SOURCE OF TRUTH: mods/ledgr/branch.js. A host in another mod imports a byte-identical copy from mods/<name>/ledgr/branch.js
// (Herdr refuses imports from outside a mod's folder). Its one import, config.js, is an engine file too.

import { agentLabel } from "./config.js";

export const DEFAULT_MAX_DEPTH = 2;
export const CACHE_WINDOW_MIN = 5;      // Anthropic's default prompt-cache lifetime
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// config.json `branch.maxDepth`: honored whatever it is (0 turns branching off); a missing or
// non-numeric value means the default.
export function maxDepthOf(cfg) {
  const n = Number(cfg?.branch?.maxDepth);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MAX_DEPTH;
}

export const depthOf = (st, sid) => num(st?.d?.sessions?.[sid]?.depth, 0);

// hc --name: 1-32 of a-z 0-9 - _, unique among live terminals: "br-q7-3f2a".
export function branchName(handle, id) {
  const h = String(handle ?? "q").toLowerCase().replace(/[^a-z0-9]/g, "") || "q";
  const tail = String(id ?? "").replace(/[^a-f0-9]/gi, "").slice(-4).toLowerCase() || "0000";
  return `br-${h}-${tail}`.slice(0, 32);
}

// claude -n: the session's display name (prompt box, /resume picker, terminal title).
export function branchLabel(item) {
  const text = squash(item?.text) || (item?.kind === "bookmark" ? "bookmark" : "question");
  const head = text.length > 48 ? `${text.slice(0, 47)}…` : text;
  return `${item?.handle ?? "Q"}: ${head}`;
}

const shortSid = (sid) => String(sid ?? "").slice(0, 8);

// The manifest: what the branch will know, computed from the store before launch and frozen on
// the Branch record at launch. opts: { now, maxDepth, isolate, parentLive }.
export function manifest(st, item, opts = {}) {
  const now = num(opts.now, Date.now());
  const sid = item?.anchor?.sessionId ?? null;
  const ps = sid ? st.d.sessions[sid] : null;
  const anchorTurn = num(item?.anchor?.turn, 0);
  const forkTurn = num(ps?.turn, anchorTurn);
  const parentDepth = depthOf(st, sid);
  const depth = parentDepth + 1;
  const maxDepth = opts.maxDepth === undefined ? DEFAULT_MAX_DEPTH : num(opts.maxDepth, DEFAULT_MAX_DEPTH);
  // Compactions recorded at or after the anchor turn: the anchor reaches the branch only through
  // Claude's compaction summary (spec 9.6; SessionStart source "compact").
  const comps = Array.isArray(ps?.compactions) ? ps.compactions : [];
  const compactedAfter = comps.filter((c) => num(c.turn, -1) >= anchorTurn).map((c) => num(c.turn));
  const lastAt = num(ps?.lastStopAt, 0) || num(ps?.updatedAt, 0);
  const idleMin = lastAt ? Math.max(0, Math.round((now - lastAt) / 60000)) : null;
  const others = Object.values(st.d.branches ?? {})
    .filter((b) => b.parentSessionId === sid && b.requestId !== item?.id && !["refused", "failed"].includes(b.status))
    .map((b) => b.name);
  const parked = st.itemsOf(sid).filter((it) => it.direction === "human_to_agent" && it.id !== item?.id && (it.status === "open" || it.status === "deferred"))
    .map((it) => it.handle).filter(Boolean);
  let refused = null;
  if (!ps) refused = "the parent session is not in the ledger";
  else if (ps.agent !== "claude-code" || String(sid).startsWith("herdr:")) refused = "branching needs a Claude Code session (claude --resume --fork-session)";
  else if (depth > maxDepth) refused = `depth ${depth} is beyond branch.maxDepth ${maxDepth} (ledgr-data/config.json)`;
  else if (opts.parentLive === false) refused = `the parent's terminal ${ps.terminal ?? "?"} is not live: a branch is started as its sub-agent (resume that session first)`;
  else if (ps.state === "ended") refused = "the parent session has ended";
  return {
    parentSessionId: sid, parentName: ps?.sessionName || ps?.repo || shortSid(sid), parentTerminal: ps?.terminal ?? null,
    parentAgent: ps?.agent ?? null, parentProfile: ps?.profile ?? null, cwd: ps?.cwd ?? "", configDir: configDirOf(ps),
    anchorTurn, forkTurn, later: Math.max(0, forkTurn - anchorTurn),
    parentWorking: ps?.state === "working",
    compactedAfter, compactionsKnown: comps.length,
    parentDepth, depth, maxDepth, refused,
    isolate: Boolean(opts.isolate),
    cache: { idleMin, warm: idleMin !== null && idleMin < CACHE_WINDOW_MIN },
    doesNotKnow: { branches: others, parked, btw: true },
    quote: item?.anchor?.quote ? String(item.anchor.quote) : null,
    at: now,
  };
}

// The manifest as display lines: [label, text] pairs. frozen: the record of a launched branch
// (times are as at the launch), else the confirmation before launch.
export function manifestLines(m, { frozen = false } = {}) {
  const out = [];
  const who = m.parentAgent ? ` (${agentLabel(m.parentAgent, m.parentProfile)})` : "";
  out.push(["Parent", `${m.parentName}${who} · ${m.parentTerminal ? `pane ${m.parentTerminal}` : "no pane"} (session ${shortSid(m.parentSessionId)}), depth ${m.parentDepth}`]);
  out.push(["Depth", `${m.depth} of branch.maxDepth ${m.maxDepth}${m.depth > m.maxDepth ? " — refused" : ""}`]);
  const later = m.later === 0
    ? "no later turns: the question was parked at the last turn"
    : `sees ${m.later} turn${m.later === 1 ? "" : "s"} beyond the anchor (${m.later === 1 ? `turn ${m.forkTurn}` : `${m.anchorTurn + 1}–${m.forkTurn}`})`;
  out.push(["Turns", `anchor turn ${m.anchorTurn} · fork at the end of the session, turn ${m.forkTurn}${m.parentWorking ? " (in progress)" : ""} · ${later}`]);
  out.push(["Compacted", m.compactedAfter.length
    ? `yes, after the anchor (turn ${m.compactedAfter.join(", ")}): turns up to there reach the branch only as Claude's summary; the preamble quotes the anchor`
    : m.compactionsKnown ? "not after the anchor" : "no compaction recorded"]);
  out.push(["Checkout", m.isolate
    ? `own git worktree from HEAD (Herdr's worktree, new space); uncommitted changes in ${m.cwd || "the parent's folder"} are not in it`
    : `shares ${m.cwd || "the parent's folder"} with the parent session: the preamble forbids edits, nothing enforces it`]);
  out.push(["Cache", `a fork reuses its parent's prompt cache only if launched within the cache window (${CACHE_WINDOW_MIN} min by default)` +
    (m.cache.idleMin === null ? "" : `; the parent's last turn ${frozen ? "had ended" : "ended"} ${m.cache.idleMin < 1 ? "under a minute" : `${m.cache.idleMin} min`} ${frozen ? "before the launch" : "ago"}${m.cache.warm ? "" : frozen ? ", so it likely paid a full cache write" : ", so expect a full cache write"}`)]);
  const dnk = [];
  if (m.doesNotKnow.branches.length) dnk.push(`branches ${m.doesNotKnow.branches.join(", ")}`);
  if (m.doesNotKnow.parked.length) dnk.push(`parked ${m.doesNotKnow.parked.map((h) => String(h).replace(/^Q(\d+)$/, "Question $1")).join(", ")}`);
  dnk.push("/btw answers");
  out.push(["Not known", dnk.join("; ")]);
  if (m.refused) out.push(["Refused", m.refused]);
  return out;
}

// The forked session's first prompt: under about 200 words plus the quote.
export function preamble(item, m, name) {
  const q = squash(item?.text) || "Explain this passage further: what does it rest on, and what would change it?";
  const A = m.anchorTurn, F = m.forkTurn;
  const lines = [
    `[ledgr branch ${name} of session ${shortSid(m.parentSessionId)} (${m.parentName}), depth ${m.depth}]`,
    "This session is a branch, opened to settle one parked question. Treat the conversation above as background.",
    "",
    `Question ${item?.handle ?? ""}, parked at turn ${A}: ${q}`,
  ];
  if (m.quote) {
    lines.push(`It refers to this passage of your turn-${A} answer:`);
    for (const l of String(m.quote).trim().split(/\r?\n/)) lines.push(`> ${l}`);
  } else lines.push(`It refers to your turn-${A} answer (no passage was quoted).`);
  lines.push("");
  lines.push(F > A
    ? `What you know: this branch was copied from the end of the session at turn ${F}, while the question was parked at turn ${A}, so ${F === A + 1 ? `turn ${F} is` : `turns ${A + 1} to ${F} are`} included. Answer the question in the context of the passage at turn ${A}, and say so if those later turns change the answer.`
    : `What you know: this branch was copied from the end of the session at turn ${F}, the turn the question was parked at. Answer it in the context of that passage.`);
  if (m.compactedAfter.length) lines.push(`The session was compacted after turn ${A} (at turn ${m.compactedAfter.join(", ")}), so you may see the passage only through the summary; the quote above is verbatim.`);
  lines.push("What you do not know: other branches, other parked questions, and side questions asked with /btw.");
  lines.push("");
  lines.push(m.isolate
    ? "Scope: answer this question only. Make NO file edits and change no state, even though this branch runs in its own worktree. Do not continue the main task."
    : "Scope: answer this question only. Make NO file edits and change no state: this branch shares the main session's checkout. Do not continue the main task.");
  lines.push("End your final answer with a fenced block tagged ledgr-conclusion, for example:");
  lines.push("```ledgr-conclusion");
  lines.push("answer: one or two sentences");
  lines.push("changes: facts or decisions the main thread should update, one per line, or none");
  lines.push("```");
  return lines.join("\n");
}

export const parentEnv = (m, item) => `LEDGR_PARENT=${m.parentSessionId}:${item.id}:${m.anchorTurn}`;
export const branchEnv = (br, m) => `LEDGR_BRANCH=${br.id}:${m.depth}:${m.forkTurn}:${br.childSid ?? ""}`;

// A session started with CLAUDE_CONFIG_DIR (a second account: `claude-work`) keeps its transcript
// under <that folder>/projects/…, and only a claude with the same CLAUDE_CONFIG_DIR can resume or fork
// it. The folder the hooks recorded (configDir), else the one above projects/ in the recorded
// transcript path; null for ~/.claude (the default: profile "default", or any folder named .claude)
// or unknown.
export function configDirOf(s) {
  const rec = typeof s?.configDir === "string" && s.configDir ? s.configDir.replace(/\/+$/, "") : null;
  if (rec) return s?.profile === "default" || /(^|\/)\.claude$/.test(rec) ? null : rec;
  const m = /^(.+)\/projects\/[^/]+\/[^/]+\.jsonl$/.exec(String(s?.transcriptPath ?? ""));
  return m && !/\/\.claude$/.test(m[1]) ? m[1] : null;
}
const configEnv = (dir) => (dir ? [`CLAUDE_CONFIG_DIR=${dir}`] : []);

// The program argv (env prefix + claude). Used by hc run, and by the worktree dialog's space.new.
export function claudeArgv(br, m, item, claudePath = "claude") {
  const argv = ["/usr/bin/env", ...configEnv(m.configDir), parentEnv(m, item), branchEnv(br, m),
    claudePath, "--resume", m.parentSessionId, "--fork-session"];
  if (br.childSid) argv.push("--session-id", br.childSid);
  argv.push("-n", br.label, br.preamble);
  return argv;
}

// `hc run` arguments for a branch beside its trunk: a sub-agent of the trunk's terminal.
export function hcRunArgs(br, m, item, claudePath = "claude") {
  return ["run", "--bg", "--json", "--parent", m.parentTerminal, "--outlive-parent", "--no-notify",
    "--name", br.name, "--cwd", m.cwd || ".",
    "--label", `ledgr.branch=${br.id}`, "--label", `ledgr.parent_session=${m.parentSessionId}`, "--label", `ledgr.item=${item.id}`,
    "--", ...claudeArgv(br, m, item, claudePath)];
}

// Resume session (a session whose terminal is gone): `hc run` of `claude --resume <sid>` in the
// session's folder, in a terminal of its own: no parent, no preamble, nothing typed. Its SessionStart
// hook (source "resume") maps the new terminal to the same session id.
export function resumeArgs(s, claudePath = "claude") {
  const dir = configDirOf(s);
  return ["run", "--bg", "--json", "--no-parent", "--no-notify", "--cwd", s?.cwd || ".",
    "--label", `ledgr.resume=${s?.sessionId}`, "--", ...(dir ? ["/usr/bin/env", ...configEnv(dir)] : []), claudePath, "--resume", String(s?.sessionId)];
}

// Where Claude Code keeps a session's transcript: the recorded path, else <config folder (the
// recorded one, else ~/.claude)>/projects/<cwd with every non-alphanumeric as "-">/<session id>.jsonl.
export function transcriptPathOf(s, homeDir) {
  if (s?.transcriptPath) return s.transcriptPath;
  const cfg = typeof s?.configDir === "string" && s.configDir ? s.configDir.replace(/\/+$/, "") : `${homeDir}/.claude`;
  return `${cfg}/projects/${String(s?.cwd ?? "").replace(/[^A-Za-z0-9]/g, "-")}/${s?.sessionId}.jsonl`;
}

// The live word for a branch: Herdr's agent status for its terminal (a sub-agent without a pane
// is not in agents(), so terminals() is read too), else the stored state. Pure over the lists.
export function liveStatus(br, agentList, terminalList) {
  if (!br) return null;
  if (br.status === "refused" || br.status === "failed" || br.status === "launching") return br.status;
  const t = br.terminal;
  if (!t) return br.status === "running" ? "running" : br.status;
  const a = (agentList ?? []).find((x) => x.address === t);
  if (a?.status) return a.status;
  const k = (terminalList ?? []).find((x) => x.address === t);
  // Launched, but its SessionStart never reported in, and the terminal is gone: it did not start.
  if (br.status === "launched" && (!k || (k.state && k.state !== "live"))) return "nostart";
  if (!k) return "closed";
  if (k.state && k.state !== "live") return "ended";
  const s = k.status ?? null;
  return s === "error" ? "blocked" : s || "starting";
}
