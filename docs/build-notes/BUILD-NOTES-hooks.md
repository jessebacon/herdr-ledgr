# ledgr hooks half: build notes (2026-11-05)

The Claude Code hooks, the identity map, the spool writer and the agent-ask extractor for the ledgr mod. The panel, capture box and chip (the `.js` files in `mods/ledgr/`) are the mod half and are documented in `BUILD-NOTES-mod.md`. The design is `~/Repos/ledgr/docs/design/Herdr ledger mod design.md` (the spec); section 11 of the spec lists where this build departs from it.

Standard library Python 3 (`/opt/homebrew/bin/python3`), system `/usr/bin/curl` and `/usr/bin/security`, bash 3.2. No Node and no pip packages. Every entry script sets `PATH` itself, so the hooks work from Herdr's GUI login-shell PATH. Python bytecode is cached in `ledgr-data/.pycache`, never in the mod folder, because a save under `mods/` reloads every copy of the mod.

## Layout: core plus adapters

```
bin/
  lib/                      agent-agnostic core; no Claude-specific imports
    ledgr_core.py           paths, ids, atomic write (temp + rename), flock, log, passage hash, Keychain read, detached spawn
    ledgr_config.py         config.json defaults and loader (missing: created; invalid: left alone, defaults used)
    ledgr_spool.py          the spool-event writer and one builder per event type; the event contract is its docstring.
                            Importable on its own (only ledgr_core); the MCP server (bin/mcp/, 2026-11-06) uses it
    ledgr_map.py            session record + identity map writer for the four lifecycle events; owner-pid guard
    ledgr_asks.py           the one ask validator, shared by the block parser and every provider
    ledgr_landing.py        Phase 3: is a submitted prompt a staged confluence or answer sheet (marker line)?
    asks.schema.json        the ask JSON schema (sent to providers; never trusted without ledgr_asks.validate)
    parse_block.py          the ledgr-asks fenced-block parser (also a CLI: parse_block.py < message)
    ledgr_extract.py        the extraction pipeline: block, provider, validate
    extract-system.txt      the extraction system prompt
    asks-instruction.txt    the opt-in SessionStart instruction (printed only when instruct_block is true);
                            since 2026-11-06 asks-instruction-ledgr.txt, -both.txt, -off.txt, on by default
                            ("Who owns the closing list" below); -space-off.txt since 2026-11-07
                            ("Off per space" below)
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
- Stdout is empty for every hook, except SessionStart when `config.instruct_block` is true (default false at this build; true since 2026-11-06, with the wording chosen by `asks.handoff` and the UserPromptSubmit reminders described below).
- Per turn the spool gets `pending` (at once, from Stop part A), then `stop` carrying the message uuid once the transcript lookup finishes (retries at 0, 1, 2 and 4 s), then `asks`. There is no `settle` event.
- Extraction: only a valid, non-empty `ledgr-asks` block skips the model; an empty or invalid block falls through to it. Every ask carries a `level` (blocking, needed, optional; see "Severity" below); the extractor returns asks of every level, and the mod decides which count (`extract.threshold`). The prompt lists the session's open and recently dismissed asks (from the mod's `snapshot.json`); a re-raised ask comes back with `repeat_of`.
- Every ask carries `hash` (sha1 of the whitespace-collapsed quote, else text, first 12 hex chars, the same rule as `store.js` `passageHash`), `origin`, `repeat_of` (the Request id `rq_...`) and `repeat_of_handle` (`A5`). Events carry the turn's `passage_hash`; `message_uuid` is optional.
- No key: when a model call is needed, `asks` has `source: "error"`, `error: "no credential"` and `error_detail` naming the missing Keychain item. A valid non-empty block is still processed.

Config (`ledgr-data/config.json`, created by the first hook run):

```json
{ "v": 1, "instruct_block": false,
  "extract": { "mode": "block-first", "provider": "anthropic", "model": "claude-haiku-5-5", "base_url": null,
               "audit_rate": 0, "cli_fallback": false, "max_chars": 60000, "timeout_s": 20,
               "threshold": "needed" },
  "surface": { "openPanelOnAsks": false }, "btw": { "autoSend": false }, "nav": { "autoSearch": false },
  "branch": { "maxDepth": 2 }, "ui": { "foldAsksWhileWorking": false, "animations": true },
  "retention_days": 14 }
```

(The defaults at this build. Since 2026-11-06: `instruct_block` true, `instruct_reinject` true, `asks.handoff` "ledgr"; `lib/ledgr_config.py` is authoritative.)

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

(Steps 1 and 2 were done on 2026-11-05: model extraction works from 15:01, and the live fixture runs are under "Severity".)

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
  environment. Details: `BUILD-NOTES-phase2.md`.

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
- No settings change: UserPromptSubmit was already registered. Details: `BUILD-NOTES-phase3.md`.

## Severity (2026-11-05)

- `lib/asks.schema.json`: `level` (enum `blocking`, `needed`, `optional`) is required, placed after
  `quote`; `blocking` (boolean) is gone from the schema. `lib/ledgr_asks.py`: `LEVELS`, `level_of`;
  a missing or null level is `needed` (a legacy `"blocking": true` is `blocking`), case and outer
  space are ignored, any other value drops the ask with a reason in the optional `rejected` list.
  Each valid ask now has `level`, and `blocking` = (level == blocking) for older readers.
- `lib/parse_block.py`: returns `rejected`; a block whose every ask was rejected is invalid with
  `no valid items (ask 1: unknown level 'critical'; …)`. `lib/ledgr_extract.py`: the block's and
  the model's `rejected` go on the result (and so on the `asks` event) when there are any.
- `lib/extract-system.txt`: the asks now include offers and suggestions (they were excluded); each
  ask gets exactly one level, defined with one example each, a decision order (stopped or stalls
  until the user acts: blocking; otherwise finished if ignored: optional, else needed; follow the
  message when it says what blocks it), and the rule that polite or tentative wording never lowers
  a level, with an example of an offer wrapping a blocker. `lib/asks-instruction.txt` (the opt-in
  block instruction) carries `level` and a one-line definition of each.
- `lib/ledgr_config.py`: `extract.threshold` "needed" and `ui` `{foldAsksWhileWorking: false,
  animations: true}` (the mod's keys; the hooks only carry the defaults).
- Fixtures: `mixed` (all three levels in one message), `politeblocker` (an offer, "If you're able to
  share … I'd be happy to … No rush!", wrapping the credential the work waits on, beside a true
  optional), `levels` (the block fast path: explicit blocking and optional, a missing level, an
  unknown level rejected); `offer` now expects its two offers as optional (live), `tasklist` at least
  two blocking, `block` its legacy `blocking: true` asks as blocking. The runner checks `levels`,
  `level_min`, `levels_only`, `level_by_text`, `rejected_min`, and prints `[level/kind]` live.
  `tests/test_parse_block.py`: 11 more checks (`tests/fixtures/blocks/levels.md`, `badlevel.md`).
- Live, `python3 -I -B tests/run-extract-fixtures.py --live mixed` (2026-11-05 19:31, one call,
  2192 tokens in, 487 out, $0.00046, 3.0 s): blocking/do "Grant the TeamsAppInstallation.ReadWriteForUser
  application permission in the Teams Admin Center"; needed/review "Send a test ticket from your
  machine and confirm the DM arrives with a working link"; needed/decide "Choose the default message
  template, compact or detailed" (options compact, detailed; rec. detailed); optional/confirm
  "Decide whether the agent should add a weekly digest of closed tickets later"; optional/do
  "Consider rotating the old bot's client secret, since nothing uses it anymore". PASS.
- Not run live: `politeblocker`, and `offer`, `tasklist`, `none`, `reask`, `long` against the new prompt.

### Borderline asks (same evening)

- Jesse's screenshot: a closing line, "Ready to commit when you've had a look", came back as a
  needed/review ask whose quote was the whole 300-word message. `lib/extract-system.txt` now decides
  in three steps: (1) a closing line that only offers to go on, waits for a go-ahead or invites a
  look ("ready when you are", "let me know", "have a look", "say the word") is optional unless the
  message states the agent cannot proceed without the answer; (2) stopped or stalled on something
  only the user can give: blocking; (3) otherwise finished-if-ignored: optional, else needed, and a
  review is needed only when the user must verify one specific thing (this file, this output, this
  behaviour on their machine). quote: "the one or two sentences of the message that make the ask, at
  most 300 characters, copied exactly. Never the whole message, and never the summary of work around
  the ask." The prompt does not quote the fixture's sentence.
- Fixtures: `closer` (a summary of finished work, then "Nothing is committed yet. Ready to commit
  when you've had a look."; live: only optional, no quote over 120 characters) and `verify` (run
  `npm test -- date-picker` on the Mac and confirm three snapshot tests; live: a needed review, quote
  at most 300). The runner gained `quote_max` and prints each quote's length live.
- Live, `--live closer` (one call, 2312 in, 100 out, $0.00028, 2.6 s): one ask, optional/review
  "Review the ASKED OF YOU lane changes and decide whether to commit them", quote (65 characters)
  "Nothing is committed yet. Ready to commit when you've had a look." PASS. `verify` not run live.

### Status lines (2026-11-06)

- Jesse's screenshot: "Two batches are now uncommitted in the repo" became a needed/review ask.
  `lib/extract-system.txt` now says, above the level rules: "A statement of what is done, pending,
  or uncommitted is not an ask. An ask exists only when the message asks the user to do or decide
  something, explicitly or by saying the agent is waiting on them. Do not infer an ask from a status
  line." `needed` is now "the message itself says the user must do it for the work to be complete,
  and the agent carried on without it … Otherwise the ask is optional", and step 3 of the order
  asks the same question.
- Fixtures: `status` (a pure status message: deployed, two batches uncommitted, checks pass; live:
  zero asks) and `statusask` (a status line, "Two commits are uncommitted", beside one real needed
  ask, check the DM link on the phone before it ships; live: exactly one ask, needed, nothing
  matching "uncommitted" or "commit"). The runner gained `none_matching`.
- Live, `--live status` (one call, 2274 in, 9 out, $0.00023, 1.1 s): zero asks. PASS. `statusask`
  not run live.

### Profiles (2026-11-06)

- `claude_hook.py` computes the session's config folder on every event: `CLAUDE_CONFIG_DIR`
  (absolute, normalised: a trailing slash goes), else the folder above `projects/` in the transcript
  path, else `~/.claude`; and `profile_of()`: "default" for a folder named `.claude`, else the name
  without a leading `.claude-` (`~/.claude-work` is "work"), else the name as it is. Both go into
  `fields` (agent-neutral names: another adapter may report its own, say `CODEX_HOME`).
- `ledgr_map.handle` records `config_dir` and `profile` in `sessions/<sid>.json` and
  `terminals/<t>.json` on any event that has them; `session_start` and `prompt` events carry them
  (`ledgr_spool.py`, null when unknown). `pending`, `stop`, `asks` do not.
- Tests (`test-hooks.sh`, "config folder and profile", 10): default (no env, no projects/ path),
  both events carry it, pending does not, a folder without `.claude-` keeps its name, `~/.claude-work/`
  from the env (record, map, events), the same profile from the transcript path alone, a `.claude` folder from the
  transcript path, and a record stripped of both (an older build) regaining them at its next prompt.

### Who owns the closing list (2026-11-06)

- `ledgr_config.handoff(cfg)`: "prose" when `instruct_block` is not true, else `asks.handoff`
  ("ledgr" when missing or unknown). Wordings: `lib/asks-instruction-ledgr.txt` (~260 words with the
  tool sentence), `-both.txt` (~195), `-off.txt` (two lines, printed once to a running session
  switched to prose). `asks-instruction.txt` is gone.
- `claude_hook.py`: SessionStart prints the mode's wording and records `instruct_mode` in the session
  record (`ledgr_map.set_instruct_mode`). At a real prompt, a recorded mode other than the current
  one prints the new wording once (a session with no `instruct_mode` counts as "both", the old
  instruction; one first seen at a prompt, with no SessionStart, gets the wording there). The reminder
  after a model-found blocker prints the mode's wording; `prose` never reminds.
- `parse_block.py`: bullets or JSON (`form`), never both (`mixed`, rejected whole); bullet reasons
  `ask N: missing level …`, `unknown level 'urgent'`, `unknown kind 'approve' …`, `missing text`,
  `field … is neither a quoted passage nor options`, `line N: not a bullet`; the quote in "…" or
  “…”, options split on `|`; `-`, `*` or `•` as the marker. Also read: a `<ledgr-asks>` …
  `</ledgr-asks>` pair (Haiku wrote that once in `both` mode before the wording showed the fence).
  `pointer` = the last `ledgr: N item(s) for you[, M blocking]` line of the prose; the extractor's
  `asks` event carries `block_form` and `pointer`.
- Tests: parse_block +18 (fixtures `bullets*.md`, 6 new); hooks "handoff modes" (16) and the
  first-prompt case; installer `test_handoff`.
- Live, Haiku through `claude -p` in a scratch folder with only the ledgr hooks (`--setting-sources
  project,local --settings`), a scratch `LEDGR_DATA` and a fake terminal (nothing reached the live
  store), the site plan prompt and a list-inducing one ("end with a checklist of everything you need
  from me"): in `ledgr` mode every reply had no list in prose, one pointer line whose counts matched
  the parsed block (3 / 2, 4 / 1, 4 / 1), and a bullet block read with `source=block`; in `both`
  mode the prose checklist came back (9 numbered items) with the block too. The first `both` run
  wrote `<ledgr-asks>` tags and fell back to the model (7 asks, reinject marked): fixed by showing the
  fence in the wording and by reading the tag form. Invented quotes are dropped by the validator, as
  for JSON. The throwaway transcripts stay under `~/.claude/projects/-private-tmp-…-scratchpad-lt-site/`.
- Live on the owner's sessions: the deploy set `asks.handoff: ledgr`; the second account's
  session (`claude-work` here) got the ledgr wording at its next prompt (`handoff None->ledgr` in hook.log) and its next
  reply ended with `ledgr: 2 items for you, 1 blocking` and a bullet block.

### Declared by tool, settled at Stop (2026-11-06)

- `ledgr_extract.tool_declaration(sid, turn)` reads `ledgr-data/mcp/<session>/<turn>.json` (bin/mcp).
  When it exists and the reply has no valid non-empty block, `extract()` returns `source: "tool"`
  before the under-40-characters skip (a reply can be the pointer line alone): no model call, no
  reinject, `replaces_turn: true`, `quotes: "verified"`. `tool_asks()` validates the declared asks
  again with the turn's text: `last_assistant.turn_text(transcript)` (every main-thread assistant text
  since the last real user prompt; a tool_result record is not a prompt) plus the last message.
  Options come from the declaration, else from the writer's item in `snapshot.json`; when neither has
  them the key is left out and the writer keeps the item's own (the state file keeps text, level,
  kind, hash, quote and repeat_of_handle only). `--retry` re-settles such a turn.
- Tests (hooks, 6): a transcript whose quoted sentence comes before the tool call is verified, an
  invented quote dropped, the final message's uuid used, no reinject, `source=tool` in hook.log.
- `test-hooks.sh` timing: over 100 ms with a load average over 8 is a warning, not a failure.

### Closed by the agent: resolve_asks (2026-11-06)

Jesse found Done redundant after answering an ask in the prompt. The reference is
`mods/ledgr/bin/mcp/README.md` "resolve_asks"; the writer's part is `BUILD-NOTES-mod.md` section 15.

- `bin/mcp/ledgr_mcp.py` `t_resolve`: `resolve_asks(handles, note?)`, second in `tools/list` and
  loaded upfront (`_meta["anthropic/alwaysLoad"]`) like `declare_asks`. Handles are normalised as
  `store.js` `byHandle` does (`norm_handle`: brackets and spaces dropped, upper case), deduplicated,
  at most 30 (`MAX_RESOLVE`); a single string or the array as JSON text is read as the list. The map is
  `open_asks`'s: this session's agent asks in `snapshot.json`. Open, deferred or answered: one event
  each; resolved or dismissed: `already_closed`; anything else (another session's, a typo, a `Q`
  handle, with a note): `unknown`. Neither is an error. It then waits for the writer as
  `declare_asks` does (`wait_applied("act")`: `applied`, `timeout`, `idle`) and logs one `resolve`
  line in `mcp.log`.
- `bin/lib/ledgr_spool.py` `act(t, sid, *, item, action, actor, handle, turn=None, note=None,
  arg=None)`: the first `act` built outside the panel, `{item, action: "resolve", arg: null, actor:
  "agent", handle, turn, [note]}`; `turn` is null on a synthetic session the store does not hold yet. The panel's own
  `act` events carry none of `actor`, `handle`, `turn` or `note`, so the writer reads them as the
  person's.
- The instruction: `lib/asks-instruction-ledgr.txt` and `-both.txt` end with "When the user's message
  answers or drops an open ask (open_asks lists them with handles such as A4), call resolve_asks with
  those handles before declaring anything new." The server's `instructions` string carries the same
  clause. The hooks print a wording again only at SessionStart or on a mode change, so a running
  session gets the sentence at its next SessionStart.
- Installer: `MCP_TOOLS` ends with `mcp__ledgr__resolve_asks`, so `apply_mcp` appends it to an earlier
  install's allow list and leaves the rest in place; uninstall's filter removes all four. `mcp_report`
  (new, used by `--check`) counts a settings file whose server is registered but lacks an allow entry
  as a problem whatever the answers say, and says to run `./install.sh` again with `--mcp on`. The
  interactive MCP question names the tools from `MCP_TOOLS`.
- After the install, running sessions need `/mcp` to reconnect the server (or a restart) to see the
  tool.
- Tests: `test_mcp.py` 76 checks (13 new: the schema and `alwaysLoad`, the `instructions` clause,
  open and answered asks closed with the contract fields, closed and unknown handles reported, bad
  input refused with nothing written, and through the fake writer `resolvedBy: "agent"` and a second
  call finding it closed); installer 69 (`test_mcp`: the fourth entry, `mcp_report` healthy, declined,
  missing, and an earlier install's three entries upgraded in place). `test-hooks.sh` (127) is
  unchanged.

### Off per space (2026-11-07)

Jesse: "enable/disable per space", the full version: a session in a space listed in config
`spaces.disabled` behaves as if ledgr were not installed. The mod's side (the switch, the panel, the
chip, ⌘J) is `BUILD-NOTES-mod.md` section 17; the contract is `bin/adapters/README.md` "Disabled
spaces".

- The lookup, `ledgr_map.herdr_space(timeout=0.3)`: one `hc get $HC_TERMINAL_ID --json`, the label
  `labels["herdr.space"]` (about 6 ms). Run with `os.posix_spawn` and a pipe (`_read_cmd`: stdin and
  stderr `/dev/null`, `select` up to the deadline, then `waitpid`; killed with SIGKILL past it),
  because importing `subprocess` alone costs a hook about 4 ms. `hc` is found on `PATH` (else the
  core's tool path); `LEDGR_HC` names another binary, and set but empty turns the lookup off.
- Two answers that are not a space. None, which counts as on: no `HC_TERMINAL_ID` (outside Herdr, or
  the `LEDGR_TERMINAL` override), a remote address (`/` in it) or one starting with `-`, no `hc` or one
  that cannot be run, a terminal without the label, a label that is not an id
  (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`). `UNKNOWN`, which keeps the recorded space: a timeout (logged
  "space lookup: hc get timed out after 300 ms"), a non-zero exit, output that is not a JSON object.
  So a slow or failing `hc` never flips a session on and off.
- When: SessionStart and UserPromptSubmit look up (`fields["space"]`); Stop and SessionEnd make no
  `hc` call and use the record (`recorded(sid)`). `ledgr_map.handle` stores `space` on the session
  record and the map entry (`map_record` always carries the key), unless the lookup was `UNKNOWN`.
  `spaces_disabled(cfg)` reads the list (strings only), `space_off(cfg, space)` compares (a null
  space is on). `ledgr_config.py` `DEFAULT_CONFIG` gains `"spaces": {"disabled": []}`.
- Off (`fields["quiet"]`): `handle` still takes the lock, counts turns, records the prompt id and
  state, and writes the record and the map, but emits no spool event: no `session_start`,
  `branch_started`, `compacted`, `prompt` or `session_end`. A Stop while off saves no turn text and
  emits no `pending`: it marks the session idle (`last_stop_at`) and logs "Stop … skipped: ledgr is
  off in space …" once per off period (`off_skip_logged`). `run()` then returns False, `main` exits
  10, and `stop.sh` never starts part B: no extraction, no tool settlement, no reinject. A Stop is
  off when the recorded space is disabled now or the record says `ledgr_off` (the turn began off).
- What the agent is told (`claude_hook.py`; `ledgr_off` on the record, written with the new
  `ledgr_map.set_fields()`, one locked read-modify-write; `set_instruct_mode` now uses it):
  - At a real prompt (`prompt_turn`), on to off: `lib/asks-instruction-space-off.txt` once ("ledgr is
    off in this space: ignore every earlier ledgr instruction. Declare nothing: no ledgr-asks block,
    no "ledgr:" line, and no calls to the ledgr tools (declare_asks, resolve_asks). List what you
    need from the user in your reply as you normally would."), only to a session that had a wording
    (`instruct_mode` other than `prose`; none recorded counts as `both`) and not to one first seen at
    this prompt. Records `ledgr_off: true` and drops `reinject_pending`. No landing, no reinject, no
    handoff switch while off. A record from before this build (no `ledgr_off`) in an off space is
    treated as on to off.
  - Off to on: the prompt event is written, landing runs, the mode's wording prints once (none in
    `prose`), and the record gets `ledgr_off: false`, `instruct_mode`, and loses `off_skip_logged` and
    `reinject_pending`.
  - On and staying on: as before (landing, the reinject, a handoff change); `ledgr_off: false` is
    written when missing. A local command (`/btw`) changes nothing.
  - SessionStart (`start_session`): on, the mode's wording as before; off, nothing, except the off
    text at a `resume` or `compact` of a session whose `instruct_mode` is `ledgr` or `both` (its
    context may still carry the instruction). `startup` and `clear` while off print nothing.
- Landing is skipped while off: an answer sheet or confluence pasted into an off session's prompt
  does not land.
- Known: a branch launched into an off space records its lineage on the record and the map, but no
  `branch_started` is sent.
- Timing, medians of 20 runs (`test-hooks.sh` timing table; it times the real `hc get` on the suite's
  own Herdr terminal when it runs in one, else no lookup):

  | Hook | Before | After |
  |---|---|---|
  | SessionStart | 43-45 ms | 51-52 ms |
  | UserPromptSubmit | 42-45 ms | 52-54 ms |
  | Stop | | unchanged (no lookup) |

- Tests. `test-hooks.sh` (169 checks) now runs against a fake `hc` (`LEDGR_HC`, a bash script):
  `hc get <t> --json` prints `$FAKE_HC_DIR/<t>.json`, else exits 3 with a `not_found` error as `hc`
  does; `FAKE_HC_SLEEP` delays it and `FAKE_HC_BAD` prints a line that is not JSON. "disabled spaces"
  (30): an enabled space (wording, `space` on the record and the map); a disabled one (nothing printed,
  `ledgr_off`, the map written, no `session_start`); prompts in it (no output, no `prompt` event, a
  pasted sheet does not land, turns still counted); off Stops (no `pending`, `stop`, `asks` or turn
  text, one log line); a local `/btw` after the space is enabled; off to on (the wording once, the
  prompt event, then `pending` and `asks` again); on to off (exactly the off text, once); the file's
  content; a resume while off (the off text) and a clear (nothing); a space disabled mid-turn (that
  Stop skipped) and enabled again (the next Stop runs); `prose` (nothing either way); a session
  first seen in a disabled space; a record from before this build; `LEDGR_HC` empty, a missing
  binary, a non-zero exit, bad output, a 2 s `hc` (the hook goes on well under 1.5 s and keeps the
  space), a terminal without the label; no hook errors. The LEDGR_TERMINAL and remote-address checks
  now also expect `space: null`.

### Several messages in one prompt (2026-11-07)

Found in Jesse's own prompt of the day, which carried two answer sheets (A11, A12) and a sentence he
typed below them. Wrapped (each sheet a `<pasted_content>` block), only the first landed; unwrapped,
one sheet was read in which A11's answer swallowed the second marker line and A12's took his
sentence.

- `ledgr_landing.detect_all(prompt, wrapper)` returns every message in prompt order (at most 20);
  `detect()` returns the first, or None. Paste wrapper lines are marked (`bound`) and never part of
  a message. Candidates: the unwrapped first message (the first non-empty line, or the second after
  a one-line lead-in of at most 200 characters that is not a fence), then the first non-empty line of
  every pasted block outside a typed fence.
- Where a message ends (`_end`): at a wrapper line; at the next marker line outside a code fence; for
  an answer sheet, at the first empty line after its `A<n>:` lines that is not followed by another
  `A<n>:` line (a blank line between two answers stays inside; text typed below the sheet does not).
  A confluence still runs to the next wrapper line or marker.
- After a message (`_next`): the next line that is neither empty nor a wrapper line is the next
  marker, or the one after it when that line is a single lead-in. Two lines of prose end the chain.
- `claude_hook.py` `landing()`: one `confluence_landed` or `answers_landed` per message, `at` 1 ms
  apart after the prompt event, one `hook.log` line each.
- The mod now ends every staged message with one empty line (`nav.js` `promptText`), so pasted
  sheets arrive a blank line apart; the parser also reads two that run together (an older mod).
- Tests (`test-hooks.sh` "landing: several messages in one prompt", 12): two wrapped sheets (two
  events, each with its own answer, after the prompt event and 1 ms apart, stdout empty); two
  unwrapped with a blank line and Jesse's sentence below; sheets ending in a trailing blank line; one
  sheet with one; a one-line lead-in before the first; a lead-in before two wrapped sheets with no blank line between;
  two sheets that run together; one sheet with a blank line between two answers and a closing word
  left out; two lines of prose between sheets (only the first); a confluence then a sheet (both).
  `test-store.sh`: each message `confluence.js` composes, with its blank line, parses as before.

## Confirmed live (2026-11-05)

- The owner pid is the claude process: live map entries show t3 -> 4817 and t2 -> 60575, both `claude`, matching `~/.claude/sessions/<pid>.json` for those sessions.
- Running sessions load new hook entries without a restart.
- The uuid lookup resolves on live Stop events (`uuid=yes` in `log/hook.log`).

## Unconfirmed

- The live Anthropic call (blocked by the Keychain account name; confirmed later on 2026-11-05 once the item was fixed, see "Severity"). Request shape is from the claude-api skill: `thinking: {type: "disabled"}` with `output_config.effort: "low"` and `output_config.format` on `claude-haiku-5-5`, `anthropic-version: 2026-10-21`, nullable fields as `anyOf`.
- `cli` provider: where `--output-format json` puts the structured result (read from `structured_output`, else `result`), and whether `--setting-sources local` keeps user-level hooks out.
- `openai-compatible` provider: built to the chat-completions shape; not run against a server.
- Hook timing: medians 36 to 82 ms per hook at load averages of 12 to 39 (target 100 ms).
