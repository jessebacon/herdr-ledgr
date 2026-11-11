# ledgr adapters

An adapter connects one agent engine to ledgr. The agent declaring its own asks, with the MCP
server's `declare_asks` tool (`bin/mcp/`) or else in a fenced `ledgr-asks` block at the end of a
reply, is the primary channel; the model extractor is the fallback for a reply with neither. So an adapter's main job is to get the ledgr-asks instruction into the
engine's context and to report its turns. Everything else in ledgr is agent-neutral.

## The contract: five capabilities

Each adapter folder holds an `adapter.json` that names its mechanism for each capability, or `false`.
The panel reads it to say, per agent, how asks arrive: **declares asks**, **extractor only** or
**no asks**.

| Capability | What ledgr needs | Claude Code (the reference, `claude/`) |
|---|---|---|
| `identity` | Herdr terminal to session id, transcript, cwd, turn number; optionally the agent's config folder and profile (`config_dir`, `profile`: the panel shows "claude · work") | `session-start.sh` and `user-prompt-submit.sh` hooks, which inherit `HC_TERMINAL_ID`; `lib/ledgr_map.py` writes `terminals/<t>.json` and `sessions/<sid>.json`; profile from `CLAUDE_CONFIG_DIR` (else the transcript path): `~/.claude` is "default", `~/.claude-work` is "work" |
| `turn_signal` | the moment a turn ends | `stop.sh` (Stop hook): part A at once, then the detached extractor |
| `instruction` | the ledgr-asks instruction (`lib/asks-instruction-ledgr.txt` or `-both.txt`, by `asks.handoff`; none in `prose`) in the model's context. Its preferred partner is the MCP server (`bin/mcp/`): an engine that can call tools declares with `declare_asks` and ends with the pointer line it returns; the block is the fallback | SessionStart hook stdout (startup, resume, clear, compact), plus one UserPromptSubmit reminder after a turn whose blocking ask only the extractor found (`instruct_reinject`) |
| `turn_text` | the turn's last assistant message, where the block is read; when it can, the whole turn's assistant text for `turns/<sid>/<turn>.md` (`fields` `turn_text`, `turn_blocks`, `turn_source` to `lib/ledgr_map.handle`; else the last message is saved, with `turn_lagged` when the whole turn may still come: the adapter's own Stop part B re-reads it and calls `ledgr_map.rewrite_turn`) | Stop hook `last_assistant_message`; the whole turn and the record uuid from the transcript JSONL (`last_assistant.py` `whole_turn`, `find`) |
| `fork`, `resume` (optional) | Branch and Resume session | `claude --resume <sid> --fork-session`, `claude --resume <sid>` |

Without `turn_text` the block cannot be read: the session gets the parked-questions lane only.
Without `instruction` but with `turn_text`, the extractor is the only channel.

## Agent-neutral, never per adapter

- The spool contract: `lib/ledgr_spool.py` builds every event; the writer applies them.
- The MCP server (`bin/mcp/ledgr_mcp.py`, any MCP client): `declare_asks` writes an `asks` event with
  `source: "tool"` mid-turn (`replaces_turn` on a later call of the same turn), and the turn's Stop
  re-emits the declaration from `ledgr-data/mcp/<session>/<turn>.json` with its quotes checked against
  the whole turn's text and the message uuid (`lib/ledgr_extract.tool_declaration`). `resolve_asks`
  closes asks the user's message answered or dropped (one `act` event each, `actor: "agent"`); both
  instruction wordings tell the agent to call it before declaring anything new. An adapter's only
  part is giving `extract()` the turn and, when it can, the turn's full assistant text.
- The block grammar and the levels: `lib/parse_block.py`, `lib/ledgr_asks.py` (blocking, needed,
  optional; `extract.threshold` applies to declared and extracted asks alike).
- The extractor and its providers: `lib/ledgr_extract.py`, `providers/`.
- The landing markers: `lib/ledgr_landing.py` (`ledgr confluence …`, `ledgr answers …`, `ledgr pins
  <session id> <item id>`); `detect_all` finds every message in a prompt (two answer sheets pasted
  together land as two events; a pins message and an answer sheet, two). A pins message quotes its
  pinned passages with `> `, so a marker inside one never lands, and the prompt event's refs leave
  those lines out (`lib/ledgr_map.prompt_refs`), as they leave out an answer sheet's lines (an `[A7]`
  inside an answer is not a ref; `ledgr_landing.sheet_lines`). An adapter's part is the paste wrapper
  syntax (passed to `detect_all` and, as `fields["paste_wrapper"]`, to the ref scan) and emitting the
  event per hit (`pins_asked` for a pins message).
- Disabled spaces (config `spaces.disabled`): `lib/ledgr_map.py` `herdr_space()` reads the terminal's
  `herdr.space` label with one `hc get $HC_TERMINAL_ID --json` (300 ms limit; a failed lookup keeps the
  recorded space) and `space_off()` compares it. An adapter passes `fields["space"]` at its start and
  prompt events and `fields["quiet"]` when the session is off, so `handle()` writes the map (with
  `space`) but no spool event; it prints `lib/asks-instruction-space-off.txt` once on an on-to-off
  change, its mode's wording on off-to-on (recorded as `ledgr_off` with `set_fields()`), skips landing
  while off, and starts no extraction for a turn that began off or whose space is off now.
- The store, the writer, the panel, the chip.

## Sketches (not built)

- **Codex.** Instruction: append it to the project's `AGENTS.md` or a system-prompt file Codex reads
  at start (a file, so no per-turn reminder unless its notify hook can print into context). Turns: the
  `notify` hook (`agent-turn-complete`) as `turn_signal`; identity from the hook's session id plus
  `HC_TERMINAL_ID`. Text: the session JSONL under `~/.codex/sessions/`.
- **Gemini CLI.** Instruction: `GEMINI.md` context file, or a SessionStart-style hook if its hooks
  print into context. Turns and identity: its hooks, mapped like Claude's. Text: the hook payload or
  its session log.
- **Generic.** `ledgr-run <cmd>`: a wrapper that records terminal to process for identity and uses
  Herdr's working-to-idle agent status as `turn_signal`. Instruction: whatever file the engine reads
  (`AGENTS.md`, a rules file). Text: at best `hc read <t>` at idle, which has no reliable message
  boundary, so the generic adapter is block-only (a declared block is parsed, the extractor is never
  called). With no text at all: parked questions only, like today's synthetic `herdr:<t>` sessions,
  which the panel shows as "no asks".
