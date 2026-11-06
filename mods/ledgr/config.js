// ledgr settings: paths under <Herdr home>/ledgr-data, the defaults of ledgr-data/config.json, and
// where the panel sits in the person's layout. The mod only reads config.json; the hooks and
// install.sh create it.
import { appHome, readTextFile, layout, run, shared } from "herdr";

// true: every copy draws the fixture store (fixtures.js) instead of live data.
// Used for `herdr-app check` with populated lanes. Keep false in normal use.
export const FORCE_DEMO = false;

// The hooks own ledgr-data/config.json (bin/lib/ledgr_config.py creates it on the first hook
// run). These are the hooks' defaults, used only when the file is missing or invalid.
export const DEFAULTS = {
  v: 1,
  instruct_block: true,
  instruct_reinject: true,
  // Who owns the closing list the agent gives you (handoffOf): "ledgr" (blocking and needed items only
  // in the ledgr-asks block; the reply ends with one pointer line, "ledgr: N items for you, M
  // blocking"), "both" (the prose list as usual plus the block), "prose" (no instruction, extractor only).
  asks: { handoff: "ledgr" },
  extract: { mode: "block-first", provider: "anthropic", model: "claude-haiku-5-5", base_url: null,
    audit_rate: 0, cli_fallback: false, max_chars: 60000, timeout_s: 20,
    // The mod's: asks at or above this level (optional < needed < blocking) are open rows and count on
    // the chip; lower ones are kept as "suggestions" (store.js isSuggestion). Applied again whenever
    // config.json changes (writer.js watchConfig, panel.js watchStore).
    threshold: "needed" },
  surface: { openPanelOnAsks: false },
  btw: { autoSend: false },
  nav: { autoSearch: false },
  branch: { maxDepth: 2 },
  // The panel's own preferences. foldAsksWhileWorking: true brings back the Phase 1 behaviour (the
  // ASKED OF YOU lane folds while the agent works and opens at the end of each turn); false (the
  // default) leaves every fold to the person. animations: false turns off every ledgr motion (rows
  // entering and leaving, highlights, the chip's pulse, ledgr's spinners spin no more).
  // pasteIntoPrompt: true (the default) makes Paste answer(s) and Paste into trunk put the message
  // into the target's prompt with Herdr's terminal.paste once that pane has the focus (nav.js
  // stageIntoPrompt; never Enter); false keeps them clipboard plus focus, and the person pastes.
  // panel: the layout node ids the panel lives in (install.sh writes them when it puts the block
  // somewhere else): `column` is shown and hidden, `stack` (null: none) selects `child`. The default
  // is the right-hand panel stack of Herdr's `main` layout and its clones.
  ui: { foldAsksWhileWorking: false, animations: true, pasteIntoPrompt: true, panel: { column: "panel", stack: "panel-body", child: "ledgr" } },
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

// The effective asks.handoff, as the hooks read it (bin/lib/ledgr_config.py handoff()): "prose" when
// instruct_block, the master switch, is not true; else asks.handoff, "ledgr" when missing or unknown.
export const HANDOFF_MODES = ["ledgr", "both", "prose"];
export function handoffOf(cfg) {
  if (cfg?.instruct_block !== true) return "prose";
  const m = String(cfg?.asks?.handoff ?? "").trim().toLowerCase();
  return HANDOFF_MODES.includes(m) ? m : "ledgr";
}

// The mode as a person reads it, for the asks lane's tooltip.
export const HANDOFF_WORDS = {
  ledgr: "closing list: ledgr (the agent lists blocking and needed items only here; its reply ends with one line, \"ledgr: N items for you\")",
  both: "closing list: both (the agent lists its items in the reply and declares them here too)",
  prose: "closing list: prose (no instruction; the extractor finds the asks in each reply)",
};

// Agent kind -> the short label drawn on each session group ("claude", "codex"). With the session's
// config profile (the hooks record it: a Claude Code started with CLAUDE_CONFIG_DIR=~/.claude-work is
// "work") it reads "claude · work"; the default profile, or none recorded, adds nothing. One argument
// gives the bare kind, which the writer also uses to find an adapter's folder.
export function agentLabel(agent, profile) {
  const p = profileWord(profile);
  if (!agent) return p ? `agent · ${p}` : "agent";
  const a = String(agent).toLowerCase();
  const base = a === "claude-code" || a === "claude" ? "claude" : a.replace(/[^a-z0-9-]/g, "").slice(0, 12) || "agent";
  return p ? `${base} · ${p}` : base;
}

// A recorded profile as shown: trimmed, at most 16 characters; null for "default" or none.
export function profileWord(profile) {
  const p = String(profile ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 16);
  return p && p.toLowerCase() !== "default" ? p : null;
}

// Running in the app, not in `herdr-app check`? check refuses reads outside the mod's folder, and
// it shares the running window's shared state, so a copy that claimed the writer role or pinged
// from a check would leave a claim nobody holds. Every Herdr home has AGENTS.md.
export async function liveHome() {
  try { return (await readTextFile(`${appHome()}/AGENTS.md`)) !== null; } catch { return false; }
}

// ── where the panel lives ─────────────────────────────────────────────
// The writer publishes config.json's ui.panel as shared("ledgr.ui").panel, so every copy (the host
// block, the panel, the pane-header chip) shows and hides the same node.
export function panelPlace(cfg) {
  const d = DEFAULTS.ui.panel;
  const p = cfg?.ui?.panel ?? shared("ledgr.ui")?.panel ?? null;
  if (!p || typeof p !== "object") return d;
  const column = typeof p.column === "string" && p.column ? p.column : d.column;
  const stack = p.stack === null ? null : typeof p.stack === "string" && p.stack ? p.stack : d.stack;
  const child = typeof p.child === "string" && p.child ? p.child : d.child;
  return { column, stack, child };
}

export function findNode(node, id) {
  if (!id) return null;
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = findNode(c, id); if (f) return f; }
  return null;
}

// true or false; null when the layout has no such column (then nothing can show or hide it).
export function panelShown(place = panelPlace()) {
  const root = layout(), col = findNode(root, place.column);
  if (!col) return null;
  if (col.hidden) return false;
  if (!place.stack) return true;
  const stack = findNode(root, place.stack);
  return stack ? stack.active === place.child : null;
}

export function showPanel(place = panelPlace()) {
  if (place.stack) run("layout.select", { stack: place.stack, child: place.child });
  run("layout.show", { id: place.column });
}

export function togglePanel(place = panelPlace()) {
  if (panelShown(place)) run("layout.hide", { id: place.column });
  else showPanel(place);
}
