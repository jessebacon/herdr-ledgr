// ledgr settings: paths under ~/.config/herdr-app/ledgr-data and the defaults of
// ledgr-data/config.json. The mod only reads config.json; the hooks create and own it.
import { appHome, readTextFile } from "herdr";

// true: every copy draws the fixture store (fixtures.js) instead of live data.
// Used for `herdr-app check` with populated lanes. Keep false in normal use.
export const FORCE_DEMO = false;

// The hooks own ledgr-data/config.json (bin/lib/ledgr_config.py creates it on the first hook
// run). These are the hooks' defaults, used only when the file is missing or invalid.
export const DEFAULTS = {
  v: 1,
  instruct_block: false,
  extract: { mode: "block-first", provider: "anthropic", model: "claude-haiku-5-5", base_url: null,
    audit_rate: 0, cli_fallback: false, max_chars: 60000, timeout_s: 20 },
  surface: { openPanelOnAsks: false },
  btw: { autoSend: false },
  nav: { autoSearch: false },
  branch: { maxDepth: 2 },
  retention_days: 14,
};

export const LIMITS = {
  text: 400,          // Request.text
  quote: 600,         // Anchor.quote
  ingested: 1000,     // store.ingested ids kept
  parseRetries: 5,    // spool parse retries, 300 ms apart
  turnsSearch: 50,    // saved turns searched backward when re-anchoring a quote
  dupWindowMs: 30000, // human double-capture guard
  conclusion: 8000,   // a branch conclusion as edited for the confluence (Phase 3)
};

export const dataDir = () => `${appHome()}/ledgr-data`;
export const spoolDir = () => `${dataDir()}/spool`;
export const terminalsDir = () => `${dataDir()}/terminals`;
export const turnPath = (sid, turn) => `${dataDir()}/turns/${sid}/${turn}.md`;
// Remote-style addresses (vps/t7) are written as vps__t7 (spec 2.5).
export const terminalFile = (t) => `${terminalsDir()}/${String(t).replace(/\//g, "__")}.json`;
export const binDir = () => `${appHome()}/mods/ledgr/bin`;
export const storePath = () => `${dataDir()}/store.json`;

function merge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

// ledgr-data/config.json merged over the defaults. A missing or broken file means defaults.
export async function loadConfig() {
  try {
    const text = await readTextFile(`${dataDir()}/config.json`);
    if (!text) return { ...DEFAULTS, _source: "defaults" };
    return { ...merge(DEFAULTS, JSON.parse(text)), _source: "file" };
  } catch (e) {
    return { ...DEFAULTS, _source: "defaults", _error: String(e?.message ?? e) };
  }
}

// Agent kind -> the short label drawn on each session group ("claude", "codex").
export function agentLabel(agent) {
  if (!agent) return "agent";
  const a = String(agent).toLowerCase();
  if (a === "claude-code" || a === "claude") return "claude";
  return a.replace(/[^a-z0-9-]/g, "").slice(0, 12) || "agent";
}
