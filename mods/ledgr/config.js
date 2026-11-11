// ledgr settings: paths under <Herdr home>/ledgr-data, the defaults of ledgr-data/config.json, and
// where the panel sits in the person's layout, the text scale. The hooks and install.sh create
// config.json; the mod writes it only through reader.js editConfig (the settings dialog, the threshold
// menu, the space switch: one compare-and-swap writer).
import { appHome, readTextFile, layout, run, shared, agents, terminals } from "herdr";

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
  branch: { maxDepth: 2 },
  // The panel's own preferences. foldAsksWhileWorking: true brings back the Phase 1 behaviour (the
  // ASKED OF YOU lane folds while the agent works and opens at the end of each turn); false (the
  // default) leaves every fold to the person. animations: false turns off every ledgr motion (rows
  // entering and leaving, highlights, the chip's pulse, ledgr's spinners spin no more).
  // pasteIntoPrompt: true (the default) makes Paste answer(s) and Paste into trunk put the message
  // into the target's prompt with Herdr's terminal.paste once that pane has the focus (nav.js
  // stageIntoPrompt; never Enter); false keeps them clipboard plus focus, and the person pastes.
  // textScale (2026-11-10, TEXT_SCALE): every text size ledgr draws, times this (the panel, the dialogs,
  // the ⌘J box, the host button, the pane chip), 0.8 to 1.6 in steps of 0.05; the settings dialog writes it.
  // panel: the layout node ids the panel lives in (install.sh writes them when it puts the block
  // somewhere else): `column` is shown and hidden, `stack` (null: none) selects `child`. The default
  // is the right-hand panel stack of Herdr's `main` layout and its clones.
  ui: { foldAsksWhileWorking: false, animations: true, pasteIntoPrompt: true, textScale: 1, panel: { column: "panel", stack: "panel-body", child: "ledgr" } },
  // The spaces where ledgr is off (Herdr space ids, `sp` + 32 hex; names change, ids do not). A
  // session in one of them gets no instruction and no extraction (the hooks), no chip (the writer),
  // no ⌘J (capture.js), and the panel shows "ledgr is off in this space" instead of its lanes; its
  // items are kept and come back when the space is on again. The panel's session menu writes it
  // (panel.js setSpaceOff). An array: a config.json value replaces the default whole.
  spaces: { disabled: [] },
  // links.editor (2026-11-10, links.js): what a file path clicked in the detail dialog opens with: "open"
  // (the system's default app; a script opens as text, never run), "zed", "code" (at the path's line), or a
  // command of your own with {path}, {line}, {col} (never a shell or a terminal). Web links open in the
  // browser whatever this says. The settings dialog writes it.
  links: { editor: "open" },
  retention_days: 14,
};

export const LIMITS = {
  text: 400,          // Request.text
  answer: 4000,       // an ask's draft (the answer typed or picked; several lines since 2026-11-11)
  quote: 600,         // Anchor.quote
  ingested: 1000,     // store.ingested ids kept
  parseRetries: 5,    // spool parse retries, 300 ms apart
  turnsSearch: 50,    // saved turns searched backward when re-anchoring a quote
  dupWindowMs: 30000, // human double-capture guard
  conclusion: 8000,   // a branch conclusion as edited for the confluence (Phase 3)
  // Pins (docs/design/Pins.md 7.1)
  pin: 4000,             // a pin's passage: the box's candidate, store.js on_pin (longer: cut, `clipped`)
  pinNote: 200,          // a pin's one-line note
  pinsPerQuestion: 12,   // pins one parked question carries (the panel's selection, the box, on_capture)
  pinsPreamble: 24000,   // characters of pinned passages a branch preamble carries (branch.js manifest)
  pinSearch: 200,        // pins one search shows (store.js searchPins)
};

export const dataDir = () => `${appHome()}/ledgr-data`;
export const spoolDir = () => `${dataDir()}/spool`;
export const terminalsDir = () => `${dataDir()}/terminals`;
export const turnPath = (sid, turn) => `${dataDir()}/turns/${sid}/${turn}.md`;
// Remote-style addresses (vps/t7) are written as vps__t7 (spec 2.5).
export const terminalFile = (t) => `${terminalsDir()}/${String(t).replace(/\//g, "__")}.json`;
export const binDir = () => `${appHome()}/mods/ledgr/bin`;
export const storePath = () => `${dataDir()}/store.json`;
export const configPath = () => `${dataDir()}/config.json`;

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
    const text = await readTextFile(configPath());
    if (!text) return { ...DEFAULTS, _source: "defaults" };
    return { ...merge(DEFAULTS, JSON.parse(text)), _source: "file" };
  } catch (e) {
    return { ...DEFAULTS, _source: "defaults", _error: String(e?.message ?? e) };
  }
}

// ── the text scale (ui.textScale, 2026-11-10) ───────────────────────────
// Every text_size ledgr draws goes through the theme's `ts` (withScale): the size times the scale,
// rounded to a half pixel; so do the fixed heights of the rows and buttons that hold one line of text.
// Each copy reads the scale from its merged config at render time (the chip and the host from
// shared("ledgr.ui").textScale, which the writer publishes), so a change shows at the next render.
export const TEXT_SCALE = { min: 0.8, max: 1.6, step: 0.05, def: 1 };

// ui.textScale as a number in [0.8, 1.6] on a 0.05 step (a number, or a numeric string, clamped, then
// rounded to the step); anything else (missing, null, not a number) is 1. max (optional): a lower ceiling
// for a copy whose box has a fixed size (the ⌘J box: BOX_SCALE_MAX).
export function textScaleOf(cfg, { max = TEXT_SCALE.max } = {}) {
  const raw = cfg?.ui?.textScale;
  const v = typeof raw === "number" || (typeof raw === "string" && raw.trim()) ? Number(raw) : NaN;
  if (!Number.isFinite(v)) return TEXT_SCALE.def;
  const top = Number.isFinite(Number(max)) ? Math.min(TEXT_SCALE.max, Math.max(TEXT_SCALE.min, Number(max))) : TEXT_SCALE.max;
  const c = Math.min(top, Math.max(TEXT_SCALE.min, v));
  return Number((Math.round(c / TEXT_SCALE.step) * TEXT_SCALE.step).toFixed(2));
}

// The ⌘J box is a popup of a fixed size (mod.json overlay, 600 × 320; 340 from the panel's pins): its text
// stops growing at 125 %, so its bottom row (the keys, the session switcher) stays inside it. Its middle
// scrolls when a note or a quote still needs more room (capture.js).
export const BOX_SCALE_MAX = 1.25;

// One step up (dir 1) or down (-1) from scale s, within the range.
export const stepScale = (s, dir) => textScaleOf({ ui: { textScale: textScaleOf({ ui: { textScale: s } }) + (dir < 0 ? -1 : 1) * TEXT_SCALE.step } });

// A size n at scale s, rounded to a half pixel.
export const scaleText = (n, s) => Math.round(Number(n) * Number(s) * 2) / 2;

// The theme a copy draws with: Herdr's theme() as is, plus `ts(n)` (scaleText at this scale) and
// `scale`. Herdr's theme is not changed (a new object on top of it, read through its prototype).
export function withScale(t, s) {
  const scale = Number.isFinite(Number(s)) ? Number(s) : TEXT_SCALE.def;
  return Object.create(t ?? null, { ts: { value: (n) => scaleText(n, scale) }, scale: { value: scale } });
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

// ── spaces where ledgr is off (spaces.disabled) ─────────────────────────
// The ids in config.json spaces.disabled: strings only, each once.
export function disabledSpaces(cfg) {
  const v = cfg?.spaces?.disabled;
  return Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x))] : [];
}

// Is ledgr off in this space? An unknown space (null) never is.
export const spaceOff = (cfg, space) => Boolean(space) && disabledSpaces(cfg).includes(space);

// spaces.disabled with `space` turned off (off true) or back on: a new array, the others in order.
export function withSpaceOff(cfg, space, off) {
  const cur = disabledSpaces(cfg).filter((x) => x !== space);
  return off && space ? [...cur, space] : cur;
}

// The space a terminal is in, live from Herdr: its agent's `space`, else its `herdr.space` label
// (every terminal Herdr starts carries one); null when unknown.
export function terminalSpace(t) {
  if (!t) return null;
  try {
    const a = agents().find((x) => x.address === t);
    if (typeof a?.space === "string" && a.space) return a.space;
    const k = terminals().find((x) => x.address === t);
    const l = k?.labels?.["herdr.space"];
    return typeof l === "string" && l ? l : null;
  } catch { return null; }
}

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

// ── the settings dialog without the panel (2026-11-10) ──────────────────
// `ledgr.settings` reaches shown copies only, so with the panel hidden a host opens the dialog: the ledgr
// host block (host.js, the public install) on ledgr.settings, an overlay host with an engine copy on a
// command of its own (the maintainer's my-tabs: my-tabs.ledgr-settings). What it takes: the open detail
// dialog to close first (one dialog at a time, shared("ledgr.detail")), and the OverlaySpec, the one
// detailing.js settingsSpec gives the panel's gear (bin/tests/test_settings.mjs holds them equal). Pure:
// the caller closes and opens (config.js takes no overlay call from herdr).
export function settingsOpening(detail, { demo = false } = {}) {
  const open = detail && typeof detail === "object" && detail.open && typeof detail.open === "object" ? detail.open.overlay : null;
  return { close: typeof open === "string" && open ? open : null,
    spec: { mod: "ledgr", kind: "dialog", width: 0.5, height: 0.7, props: { view: "settings", opener: null, demo: demo === true } } };
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
