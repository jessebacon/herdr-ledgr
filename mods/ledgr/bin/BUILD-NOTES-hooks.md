# ledgr hooks half: build notes (2026-11-05)

The Claude Code hooks, the identity map, the spool writer and the agent-ask extractor for the ledgr mod. The panel, capture box and chip (the `.js` files one level up) are the mod half and are documented in `BUILD-NOTES-mod.md`. The design is `~/Repos/ledgr/docs/design/Herdr ledger mod design.md` (the spec); section 11 of the spec lists where this build departs from it.

Standard library Python 3 (`/opt/homebrew/bin/python3`), system `/usr/bin/curl` and `/usr/bin/security`, bash 3.2. No Node and no pip packages. Every entry script sets `PATH` itself, so the hooks work from Herdr's GUI login-shell PATH. Python bytecode is cached in `ledgr-data/.pycache`, never in the mod folder, because a save under `mods/` reloads every copy of the mod.

## Layout: core plus adapters

```
bin/
  lib/                      agent-agnostic core; no Claude-specific imports
    ledgr_core.py           paths, ids, atomic write (temp + rename), flock, log, passage hash, Keychain read, detached spawn
    ledgr_config.py         config.json defaults and loader (missing: created; invalid: left alone, defaults used)
    ledgr_spool.py          the spool-event writer and one builder per event type; the event contract is its docstring.
                            Importable on its own (only ledgr_core), for the later MCP stdio server
    ledgr_map.py            session record + identity map writer for the four lifecycle events; owner-pid guard
    ledgr_asks.py           the one ask validator, shared by the block parser and every provider
    ledgr_landing.py        Phase 3: is a submitted prompt a staged confluence or answer sheet (marker line)?
    asks.schema.json        the ask JSON schema (sent to providers; never trusted without ledgr_asks.validate)
    parse_block.py          the ledgr-asks fenced-block parser (also a CLI: parse_block.py < message)
    ledgr_extract.py        the extraction pipeline: block, provider, validate
    extract-system.txt      the extraction system prompt
    asks-instruction.txt    the opt-in SessionStart instruction (printed only when instruct_block is true)
  providers/                extraction providers, one signature: complete(system, user_text, schema, opts) -> result
    __init__.py             dispatch on config.extract.provider; key lookup; "no credential" result
    _http.py                result shape; curl POST with the key in a curl config on stdin, body in a 0600 temp file
    anthropic.py            Messages API, claude-haiku-5-5, structured output, thinking disabled, effort low
    openai_compatible.py    {base_url}/chat/completions with response_format json_schema (Ollama, OpenRouter, xAI)
    cli.py                  claude -p on the subscription (untested end to end, see below)
  adapters/claude/          the Claude Code adapter
    _env.sh                 shared preamble: PATH, guards (LEDGR_INNER, terminal id), owner-pid lookup
    session-start.sh        registered: SessionStart
    user-prompt-submit.sh   registered: UserPromptSubmit
    stop.sh                 registered: Stop. Part A sync; part B (extraction) detached
    session-end.sh          optional SessionEnd entry, not registered
    extract.sh              extractor CLI: --dry-run (fixtures), --retry <sid> <turn> (the panel's Retry button)
    claude_hook.py          Claude hook JSON -> lib/ledgr_map; subagent filter; local slash commands; session-name fallback
    claude_extract.py       Stop part B: uuid lookup -> stop event, extraction -> asks event
    last_assistant.py       transcript uuid lookup (spec 4.2); also a CLI
  tests/                    see "Tests"
../fixtures/extract/        spec 9.4 extraction fixtures (*.md) with expectations (*.json); long.md is generated
```

`~/.claude/settings.json` registers the three entry scripts (shell form, `timeout: 5`, matcher `*`, appended after the existing hooks). Backup of the previous file: `~/.local/state/ledgr/backup-20261105/settings.json`.

## Runtime behaviour

- Each hook runs only when `HC_TERMINAL_ID` (or the `LEDGR_TERMINAL` override, for terminals outside Herdr) is set, and exits 0 at once when `LEDGR_INNER` is set. A running hook exports `LEDGR_INNER=1`, so everything it starts (the Python core, the extractor, `curl`, `security`, a `claude -p` provider run) carries it.
- Main conversation only: stdin with an `agent_id` (a subagent or teammate), or a `hook_event_name` other than the entry's own (such as `SubagentStop`), is ignored.
- Owner guard: the map entry records the pid and command name of the agent process (the first non-shell ancestor of the hook). An event for the same terminal with a different session id, from a different pid, while the recorded owner is alive and still the same program, is ignored. `/clear` and `/resume` in the same process are accepted.
- Writes are temp file + rename. The session record is idempotent per event (a repeated `prompt_id` does not count a second turn); a per-session `flock` serialises the turn counter and fails open after 3 s.
- Stdout is empty for every hook, except SessionStart when `config.instruct_block` is true (default false).
- Per turn the spool gets `pending` (at once, from Stop part A), then `stop` carrying the message uuid once the transcript lookup finishes (retries at 0, 1, 2 and 4 s), then `asks`. There is no `settle` event.
- Extraction: only a valid, non-empty `ledgr-asks` block skips the model; an empty or invalid block falls through to it. The prompt lists the session's open and recently dismissed asks (from the mod's `snapshot.json`); a re-raised ask comes back with `repeat_of`.
- Every ask carries `hash` (sha1 of the whitespace-collapsed quote, else text, first 12 hex chars, the same rule as `store.js` `passageHash`), `origin`, `repeat_of` (the Request id `rq_...`) and `repeat_of_handle` (`A5`). Events carry the turn's `passage_hash`; `message_uuid` is optional.
- No key: when a model call is needed, `asks` has `source: "error"`, `error: "no credential"` and `error_detail` naming the missing Keychain item. A valid non-empty block is still processed.

Config (`ledgr-data/config.json`, created by the first hook run):

```json
{ "v": 1, "instruct_block": false,
  "extract": { "mode": "block-first", "provider": "anthropic", "model": "claude-haiku-5-5", "base_url": null,
               "audit_rate": 0, "cli_fallback": false, "max_chars": 60000, "timeout_s": 20 },
  "surface": { "openPanelOnAsks": false }, "btw": { "autoSend": false }, "nav": { "autoSearch": false },
  "branch": { "maxDepth": 2 }, "retention_days": 14 }
```

Providers: `anthropic` (key: Keychain service `ledgr`, account `anthropic`, or `LEDGR_ANTHROPIC_KEY`); `openai-compatible` (set `extract.base_url` and `extract.model`; key optional, account `openai-compatible` or `LEDGR_OPENAI_COMPATIBLE_KEY`); `cli` (`claude -p`, no key). `cli_fallback: true` uses `cli` when the anthropic key is missing.

## Tests

```sh
cd ~/.config/herdr-app/mods/ledgr/bin
bash tests/run-all.sh                                         # everything offline (no API call, no Keychain read)
/opt/homebrew/bin/python3 -I -B tests/test_parse_block.py     # block parser, 22 checks
/opt/homebrew/bin/python3 -I -B tests/test_last_assistant.py  # uuid lookup, 10 checks (one on a real transcript)
/opt/homebrew/bin/python3 -I -B tests/run-extract-fixtures.py # spec 9.4 fixtures, offline expectations
bash tests/test-hooks.sh                                      # spec 9.2 extended, 46 checks, hook timing
/opt/homebrew/bin/python3 -I -B tests/run-extract-fixtures.py --live tasklist   # one real Haiku call
```

Offline runs point `LEDGR_KEYCHAIN_SERVICE` at a service that does not exist, so they never read the real key. `--live` reads the real key and prints latency, tokens and cost per fixture.

## Manual steps for Jesse

1. Fix the Keychain item. It was saved with account `anthripic`; the hooks read account `anthropic`, so every model call currently ends in "no credential". In Terminal:
   ```sh
   security delete-generic-password -s ledgr -a anthripic
   security add-generic-password -s ledgr -a anthropic -w     # paste the key at the prompt
   ```
   An item created with `security add-generic-password` trusts `/usr/bin/security`, so the hooks read it without a prompt. An item made in Keychain Access prompts on the first read: choose "Always Allow".
2. Run the live check once: `python3 -I -B tests/run-extract-fixtures.py --live tasklist` (from `bin/`).
3. Nothing to restart: running sessions picked up the new entries at once (2026-11-05: terminals t1g, t2 and t3 were mapped within minutes, and every live extraction so far ended in "no credential").
4. Optional: register `adapters/claude/session-end.sh` for `SessionEnd` (timeout 2) to mark sessions `ended`.

## Notes for the mod half (contract changes since the spec)

- `pending` is new; `stop` now comes from Stop part B (up to about 4 s after `pending`) and carries `message_uuid` and `api_message_id`; `settle` is gone.
- Per ask: `repeat_of` (Request id) and `repeat_of_handle` replace `same_as`; `queue_kind` is gone; `hash` and `origin` are set by the hooks.
- The extractor reads `snapshot.json` items with `direction`, `anchor.sessionId`, `handle`, `text`, `status`, `id`, and `resolvedAt` or `updatedAt`; dismissed items count as "recently dismissed" for 7 days, so the snapshot should include dismissed items from at least that long.
- Map entries add `owner_pid`, `owner_comm`, `last_passage_hash`, `last_assistant_uuid`.
- `config.js` defaults differ from the hooks' (`instruct_block`, `cli_fallback`, `things`, and no `provider`); `config.json` is now written by the hooks, so the merged result follows the hooks.

## Phase 2 additions (2026-11-05)

- `lib/ledgr_map.py`: SessionStart with source `fork` in a process carrying `LEDGR_PARENT` (and
  optionally `LEDGR_BRANCH`) records `parent_session_id`, `branch_id`, `parent_item`, `anchor_turn`,
  `fork_turn`, `depth` in the session record and the map entry and emits `branch_started` (1 ms after
  `session_start`). Once per session, and only for the planned child id when one is given. Source
  `compact` appends `{turn, at}` to `compactions` (last 10) and emits `compacted`. `branch_env()` parses
  the two variables (format in `lib/ledgr_spool.py`'s docstring).
- `lib/ledgr_spool.py`: builders `branch_started`, `compacted`; the docstring lists them and the
  mod-written `branch` and `forget` events.
- Tests: `tests/test-hooks.sh` adds 13 checks (59 in all); `tests/test-store.sh` runs the mod's store
  and branch engine under Node (`tests/test_store.mjs`, 162 checks); `run-all.sh` runs both, with
  `pipefail` so a failing test fails the run.
- Confirmed live: a real `/compact` fires SessionStart `source: "compact"` with the same session id; a
  branch launched by the mod fires SessionStart `source: "fork"` with `LEDGR_PARENT` in the hook's
  environment. Details: `../BUILD-NOTES-phase2.md`.

## Phase 3 additions (2026-11-05)

- `lib/ledgr_landing.py` (new, pure, agent-agnostic): `detect(prompt, wrapper)` finds a marker line as
  the first non-empty line of any pasted block (`wrapper` = the agent's opening and closing line
  regexes; blocks opening inside a typed code fence, or starting with a fence, do not count) or,
  unwrapped, as the prompt's first non-empty line or its second after one lead-in line (at most 200
  characters). `ledgr confluence <br_id> <rq_id>` gives `{kind: "confluence", branch_id, item_id, conclusion_head}`
  (the first line after `Conclusion:`); `ledgr answers <session id>` followed by `A<n>: text` lines gives
  `{kind: "answers", for_session, handles, answers}` (a line that is not `A<n>:` continues the previous
  answer; a marker with no answer lines is not a sheet; answers are read only inside the marker's
  block). Anything else, including a marker after text on its line, after two lines of prose, inside
  a code fence, a different case, a double space or a trailing word, returns None. Fast path: neither
  `"ledgr confluence "` nor `"ledgr answers "` in the prompt, no parsing.
- `adapters/claude/claude_hook.py`: after `ledgr_map.handle` writes the turn's `prompt` event, a
  non-local UserPromptSubmit calls `landing()`: it passes Claude Code's `<pasted_content id="…">` /
  `</pasted_content id="…">` lines to `detect` as the wrapper (hooks.md, "UserPromptSubmit input";
  confirmed live: a pasted confluence arrives as `\n\n<pasted_content id="c9c5">\nledgr confluence …`),
  so a lead-in the person typed before pasting does not hide the marker, and
  emits `confluence_landed` or `answers_landed` with `at` at least the prompt event's + 1 (so the mod
  applies the prompt first). The hook still prints nothing; every other prompt is untouched.
- `lib/ledgr_spool.py`: builders `confluence_landed` (`turn`, `branch_id`, `item_id`, `prompt_id`,
  `conclusion_head`) and `answers_landed` (`turn`, `for_session`, `handles`, `answers`, `prompt_id`);
  the docstring also lists the mod's `conclude` and `close_branch`.
- Tests: `tests/test-hooks.sh` adds 19 landing checks (marker found, wrapped paste found, stdout empty,
  ordering after the prompt event, 9 malformed or misplaced markers ignored with their prompt events
  intact, the answer sheet with a wrapped answer, a sheet for another session, a local `/btw`; then
  lead-in + wrapped paste, lead-in + unwrapped paste, a marker in a second pasted block, three
  code-fence forms ignored, inline and two-line lead-ins ignored, a lead-in + wrapped answer sheet)
  and a confluence prompt in the timing table (78 checks). `tests/test-store.sh` also parses the messages
  `confluence.js` composes with `ledgr_landing.detect`.
- No settings change: UserPromptSubmit was already registered. Details: `../BUILD-NOTES-phase3.md`.

## Confirmed live (2026-11-05)

- The owner pid is the claude process: live map entries show t3 -> 4817 and t2 -> 60575, both `claude`, matching `~/.claude/sessions/<pid>.json` for those sessions.
- Running sessions load new hook entries without a restart.
- The uuid lookup resolves on live Stop events (`uuid=yes` in `log/hook.log`).

## Unconfirmed

- The live Anthropic call (blocked by the Keychain account name). Request shape is from the claude-api skill: `thinking: {type: "disabled"}` with `output_config.effort: "low"` and `output_config.format` on `claude-haiku-5-5`, `anthropic-version: 2026-10-21`, nullable fields as `anyOf`.
- `cli` provider: where `--output-format json` puts the structured result (read from `structured_output`, else `result`), and whether `--setting-sources local` keeps user-level hooks out.
- `openai-compatible` provider: built to the chat-completions shape; not run against a server.
- Hook timing: medians 36 to 82 ms per hook at load averages of 12 to 39 (target 100 ms).
