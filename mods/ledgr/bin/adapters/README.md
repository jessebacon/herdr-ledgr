# ledgr adapters

An adapter connects one agent engine to ledgr. The agent declaring its own asks, in a fenced
`ledgr-asks` block at the end of a reply, is the primary channel; the model extractor is the fallback
for a reply without one. So an adapter's main job is to get the ledgr-asks instruction into the
engine's context and to report its turns. Everything else in ledgr is agent-neutral.

## The contract: five capabilities

Each adapter folder holds an `adapter.json` that names its mechanism for each capability, or `false`.
The panel reads it to say, per agent, how asks arrive: **declares asks**, **extractor only** or
**no asks**.

| Capability | What ledgr needs | Claude Code (the reference, `claude/`) |
|---|---|---|
| `identity` | Herdr terminal to session id, transcript, cwd, turn number | `session-start.sh` and `user-prompt-submit.sh` hooks, which inherit `HC_TERMINAL_ID`; `lib/ledgr_map.py` writes `terminals/<t>.json` and `sessions/<sid>.json` |
| `turn_signal` | the moment a turn ends | `stop.sh` (Stop hook): part A at once, then the detached extractor |
| `instruction` | the ledgr-asks instruction (`lib/asks-instruction.txt`) in the model's context | SessionStart hook stdout (startup, resume, clear, compact), plus one UserPromptSubmit reminder after a turn whose blocking ask only the extractor found (`instruct_reinject`) |
| `turn_text` | the turn's last assistant message, where the block is read | Stop hook `last_assistant_message`; the record uuid from the transcript JSONL (`last_assistant.py`) |
| `fork`, `resume` (optional) | Branch and Resume session | `claude --resume <sid> --fork-session`, `claude --resume <sid>` |

Without `turn_text` the block cannot be read: the session gets the parked-questions lane only.
Without `instruction` but with `turn_text`, the extractor is the only channel.

## Agent-neutral, never per adapter

- The spool contract: `lib/ledgr_spool.py` builds every event; the writer applies them.
- The block grammar and the levels: `lib/parse_block.py`, `lib/ledgr_asks.py` (blocking, needed,
  optional; `extract.threshold` applies to declared and extracted asks alike).
- The extractor and its providers: `lib/ledgr_extract.py`, `providers/`.
- The landing markers: `lib/ledgr_landing.py` (`ledgr confluence …`, `ledgr answers …`).
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
