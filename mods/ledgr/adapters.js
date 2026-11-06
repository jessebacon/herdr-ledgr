// ledgr adapters as the panel sees them. Each bin/adapters/<name>/adapter.json is a capability
// manifest (bin/adapters/README.md is the contract): what ledgr can know about that agent's sessions.
// The panel shows one word per agent: "declares asks" (the agent writes a ledgr-asks block, the
// primary channel; the extractor is the fallback), "extractor only", or "no asks" (ledgr cannot read
// the agent's replies: the parked-questions lane only). Not an engine file: the writer never needs it.
import { readTextFile } from "herdr";
import * as fs from "fs/promises";
import { binDir } from "./config.js";

// A session no adapter reports: the synthetic "herdr:<t>" ones (capture.js), driven by Herdr's own
// agent status. It has an identity (the terminal) and a turn signal, nothing else.
export const GENERIC = { agent: "generic", identity: "herdr-terminal", turn_signal: "herdr-status",
  instruction: false, turn_text: false, fork: false, resume: false };

// { [agent]: manifest } from bin/adapters/*/adapter.json; {} when none can be read.
export async function loadAdapters() {
  const out = {};
  const dir = `${binDir()}/adapters`;
  let names = [];
  try { names = await fs.readdir(dir); } catch { return out; }
  for (const n of names) {
    try {
      const m = JSON.parse((await readTextFile(`${dir}/${n}/adapter.json`)) ?? "null");
      if (m && typeof m.agent === "string") out[m.agent] = m;
    } catch { /* not an adapter folder */ }
  }
  return out;
}

export function adapterOf(adapters, s) {
  if (!s || String(s.sessionId).startsWith("herdr:")) return GENERIC;
  const a = s.agent === "claude" ? "claude-code" : s.agent;
  return adapters?.[a] ?? GENERIC;
}

// How an agent's asks arrive, from its manifest and config.json. The threshold applies to both channels.
export function asksMode(m, cfg) {
  const ex = cfg?.extract ?? {};
  const text = Boolean(m?.turn_text);
  const extractor = text && ex.mode !== "block-only";
  if (text && m?.instruction && cfg?.instruct_block === true) {
    return { word: "declares asks", tip: `The agent declares its asks in a ledgr-asks block (the instruction reaches it by ${m.instruction})`
      + `${extractor ? "; the extractor is the fallback for a reply without one" : ""}. extract.threshold applies to both.` };
  }
  if (extractor) return { word: "extractor only", tip: "The extractor finds the asks in each reply; the agent is not asked to declare them (instruct_block is off, or its adapter cannot inject the instruction)." };
  return { word: "no asks", tip: text ? "Neither declared nor extracted: instruct_block is off and extract.mode is block-only."
    : "ledgr cannot read this agent's replies: questions you park work, the asks lane stays empty." };
}
