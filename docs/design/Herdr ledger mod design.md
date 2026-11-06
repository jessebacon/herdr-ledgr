# Herdr "ledgr" mod: design specification

Date: 2026-11-05. Targets: Herdr app 0.1.12 (`layouts/custom.json:3-6`), Claude Code 2.1.311 (`claude --version`), macOS. Status: Phase 1 is build-ready and its hooks half is built (Section 11 lists where the build departs from this text); Phases 2 and 3 are outlined.

The ledger is a side panel plus three small hooks that keep a persistent, two-direction list of requests around one linear agent conversation. Agent to human: at the end of every turn, the asks the agent made of the person (decisions, confirmations, tasks, information) are pulled out of its final message and pinned in the panel, so they stay in view when the person asks a clarifying question about one of them and the terminal scrolls on. Human to agent: one keystroke opens a small box, while the agent is still streaming, where the person parks a question about what they are reading; it is saved against the session and the passage and never reaches the agent until the person sends it. Both directions use one schema. Nothing is surfaced mid-stream: items appear at the end of the turn, on a chip in the pane header, and nothing nags. Branching from a ledger item is Phase 2; carrying a branch's answer back is Phase 3.

## Source key and conventions

- `AGENTS.md`, `herdr.d.ts`, `gpui-kit.d.ts`, `keys.json`, `layouts/custom.json` and `mods/<name>/...` are under `~/.config/herdr-app/`. Line numbers are as read on 2026-11-05. Herdr rewrites `AGENTS.md` and the `.d.ts` files on every start (`AGENTS.md:45-47`), so recheck line numbers after an update.
- `hooks.md` is https://code.claude.com/docs/en/hooks.md and `fullscreen.md` is https://code.claude.com/docs/en/fullscreen.md, both fetched 2026-11-05; sections are named.
- Command output read on 2026-11-05: `herdr-app commands`, `hc run --help`, `hc send --help`, `hc keys --help`, `hc read --help`, `claude --help`.
- `~/.claude/settings.json` was read, not changed.
- "(unconfirmed)" marks an inference that was not tested. Everything else is cited.
- Research inputs: `reports/Branching conversation interfaces for AI.md` (the report), `research_notes/Branching conversation interfaces for AI/herdr_primitives.md` (the audit), `.../discourse_modeling_ux.md` (the UX notes).

## 0. Decisions at a glance

| Topic | Decision | Section |
|---|---|---|
| Center of the design | Agent asks pinned in a side panel, one row each, answerable in place; human questions parked against the passage | 3, 6 |
| Identity | Claude Code hooks write `HC_TERMINAL_ID -> session_id, transcript_path, cwd, turn` to files; no pid chain | 2 |
| Hook to mod transport | Hooks and the capture box write event files to a spool folder; the panel copy ingests them with `watchFolder` | 2.8, 3.3 |
| Item store | `localStorage` of the single panel copy (`data/ledgr/store.json`); two small `shared()` keys for the header chip | 3.2 |
| Agent-ask extraction | Decided by Jesse: a model call over the last assistant message at Stop (Claude Haiku 5.5 by default, behind a provider seam); a valid non-empty fenced `ledgr-asks` block skips the call; the block instruction is off by default | 4 |
| Capture | `cmd-j` runs `mod.open:ledgr`; Enter parks; Cmd-Enter parks and stages a `/btw` | 5 |
| Surfacing | Chip in a cloned pane header (`my-pane`): dim while working, expands at Stop; no auto-open, toast or sound | 6.5 |
| Navigation | The panel shows the passage itself; a button opens Claude's own transcript search; Herdr cannot scroll a terminal to a line | 6.6 |
| Branching | Phase 2: `hc run --parent ... -- claude --resume <sid> --fork-session` from an item, with a context manifest | 8 |

## 1. Scope and non-goals

### Phase 1: identity map and ledger (build now)

In scope:
1. Hook scripts for `SessionStart`, `UserPromptSubmit`, `Stop` (a fast synchronous part and an asynchronous extractor) and an optional `SessionEnd`, writing the identity map, per-turn message text and spool events.
2. Agent-ask extraction at Stop (Section 4).
3. The capture box for human questions, reachable while the agent streams (Section 5).
4. The ledger panel: two lanes, item states, answer sheet, navigation to the anchor (Section 6).
5. A count chip in a cloned pane header, quiet during the turn and expanded at Stop.
6. A Ledger button and toggle in `my-tabs`, two keys in `keys.json`.
7. A minimal path for agents without hooks: the human lane works for any agent terminal; the agent lane needs an adapter (Section 2.9).

Phase 1 is done when: focusing any Claude pane shows its session in the panel with no pid lookup; parking a question during a streaming turn takes one key chord plus typing and does not disturb the agent; at the end of that turn the chip expands and the agent's asks appear in the panel within 5 seconds; every item can be resolved, deferred or dismissed and survives an app restart; `herdr-app check` passes for `ledgr`, `my-pane` and `my-tabs`; the in-app trial in Section 9.5 passes.

Not in Phase 1:
- Branching of any kind, the context manifest, and confluence.
- Anything that writes into the agent's conversation without an explicit click. Hooks never print to the model's context, except the opt-in asks-block instruction at SessionStart (Section 4.3; off by default). `/btw` is staged on the clipboard, not typed (Section 5.5).
- Surfacing during a turn. The chip only counts; the panel never pops open.
- Model-proposed questions for the human, open-question detection across turns, entity or discourse parsing.
- A graph or canvas view.
- Editing or rewriting Claude transcripts.
- Remote machines (`hc run --on`, `machine/t7` addresses). The ledger is local only.
- Reminders, WIP limits or nudges. Jesse holds more in working memory than the study averages; the ledger's value is navigation and keeping the asks in one place, not memory prompts.

### Phase 2: branch launcher and context manifest

In scope: a "Branch" action on a ledger item that forks the session from its end with `claude --resume <sid> --fork-session`, launched as a child terminal of the trunk with `hc run --parent`; a preamble that quotes the anchor and states what the branch inherits; a stored manifest per branch ("knows / does not know"); the branch's status and last message in the panel; reopen of a closed branch with `claude --resume <branch sid>`. Depth cap 2 by default.

Not in Phase 2: forking at an earlier message (no CLI flag exists; `claude --help` has none, audit Q2), summary-seeded branches, background research branches, merging.

### Phase 3: rejoin (confluence)

In scope: on a concluded branch, extract its `<ledgr-conclusion>` block, let the human edit it, and deliver one approved message to the end of the trunk when the trunk is idle; mark the request resolved with `resolvedTurn`.

Not in Phase 3: cherry-pick of individual branch messages, mid-history insertion, automatic merging, a state document with diffs. The report's state-document idea stays for later.

## 2. Identity map

### 2.1 Why hooks, not the pid chain

Herdr's agent and pane records carry no Claude session id or transcript path (`herdr.d.ts:157-203`). The audit traced a chain from `focused().terminal` to a foreground pid to `~/.claude/sessions/<pid>.json`, but it is unconfirmed end to end and the sessions file is undocumented (audit Q2, Q6). Claude Code hook processes inherit the session's environment (hooks.md, "Common input fields": "A hook process inherits the parent environment"), and inside a Herdr terminal that environment has `HC_TERMINAL_ID`, `HC_SCOPE` and `HC_TERMINAL_SOCKET` (established this session: `HC_TERMINAL_ID=t3`). Every hook's stdin carries `session_id`, `transcript_path` and `cwd` (hooks.md, "Common input fields"). So a hook can write the join directly. The "installed by herdr" hook (`~/.claude/hooks/herdr-agent-state.sh`) is inert here because `HERDR_ENV` is unset, and it drops `session_id` anyway (audit Q4); the ledger does not touch it.

### 2.2 Folders

Code lives in the mod folder; data lives beside it in a folder the mod can write, because `fs/promises` writes only under `~/.config/herdr-app` (`AGENTS.md:997-998`). Data must not go inside `mods/ledgr/`: saving any file there reloads every copy of the mod (`AGENTS.md:789-791`).

```
~/.config/herdr-app/mods/ledgr/           code (Section 6.1, Appendix A)
  bin/lib/                                agent-agnostic core: spool writer, map writer, config, ask schema and
                                          validator, block parser, extraction pipeline, prompt texts
  bin/providers/                          extraction providers behind one signature (anthropic, openai-compatible, cli)
  bin/adapters/claude/                    Claude Code adapter: session-start.sh, user-prompt-submit.sh, stop.sh
                                          (the registered hooks), session-end.sh (optional), extract.sh (CLI),
                                          claude_hook.py, claude_extract.py, last_assistant.py
  bin/tests/                              test-hooks.sh, test_parse_block.py, test_last_assistant.py,
                                          run-extract-fixtures.py, run-all.sh
  bin/BUILD-NOTES-hooks.md                every file, how to run the tests, the manual steps
  fixtures/extract/                       extraction fixtures (9.4)

~/.config/herdr-app/ledgr-data/           data (hooks and the mod both write here)
  config.json                             settings shared by hooks and mod (Appendix B); created by the first hook run
  terminals/<t>.json                      identity map: the session now running in terminal <t>
  sessions/<session_id>.json              session record: turn counter, cwd, transcript, name, state
  turns/<session_id>/<turn>.md            the final assistant text of each turn (last 50 kept)
  spool/<ms>-<type>-<pid>-<rand>.json     events for the panel copy to ingest; dotfiles are in progress
  snapshot.json                           read-only copy of open and recently dismissed items, written by the mod
  archive/<yyyy-mm>.jsonl                 closed items moved out of the store after 14 days
  locks/, tmp/, .pycache/                 per-session flock files, Stop hand-off files, Python bytecode
  log/hook.log, log/*.err                 one line per hook run; stderr of the hooks and the extractor
```

Herdr does not document what it does with an unknown folder in its home. It reloads mods on saves under `mods/` and treats `shared.json`, `data/` and its other bookkeeping files as its own (`AGENTS.md:86`); `ledgr-data/` is neither (unconfirmed that Herdr ignores it, see 9.6).

### 2.3 Hook events

| Event (hooks.md section) | Fields read from stdin | What the ledger writes | Sync or async |
|---|---|---|---|
| `SessionStart` ("SessionStart input") | `session_id`, `transcript_path`, `cwd`, `source` (`startup`, `resume`, `clear`, `compact`, `fork`), optional `model`, `session_title` | `sessions/<sid>.json` (created or refreshed), `terminals/<t>.json`, spool `session_start`; prints the asks-block instruction only when `config.instruct_block` is true | sync, timeout 5 |
| `UserPromptSubmit` ("UserPromptSubmit input") | common fields, `prompt`, `prompt_id`, optional `session_title` | turn counter +1 (unless a local slash command), `state: working`, spool `prompt` with the first 2,000 characters and any `[Q3]`/`[A5]` references | sync, timeout 5 |
| `Stop` part A ("Stop input") | common fields, `last_assistant_message`, `stop_hook_active` | `turns/<sid>/<turn>.md`, `state: idle`, spool `pending` at once | sync, timeout 5 |
| `Stop` part B | same stdin | spool `stop` carrying the resolved `message_uuid`, then spool `asks` (Section 4) | detached by `stop.sh` |
| `SessionEnd` ("SessionEnd input"), optional | common fields, `reason` | `state: ended`, spool `session_end` | sync, timeout 2 (the event's budget is 1.5 s unless raised) |

Guards (design review 2026-11-05): the hooks handle the main conversation only (stdin with an `agent_id`, or a `hook_event_name` such as `SubagentStop` that is not the entry's own, is ignored); every process a hook starts carries `LEDGR_INNER=1`, and every hook exits 0 at once when it is set; the map entry records the agent process's pid (`owner_pid`, `owner_comm`), and an event for the same terminal with another session id from another pid is ignored while that owner is alive, so a child `claude` started from the agent's shell cannot repoint the terminal.

Rules that come from the docs:
- Stdout of `SessionStart` and `UserPromptSubmit` is added to the model's context (hooks.md, "Exit code 0"). The ledger hooks print nothing on stdout, except the opt-in instruction. This keeps the model isolated from the ledger.
- An async hook's JSON `additionalContext` and `systemMessage` are delivered to Claude on the next turn (hooks.md, "Run hooks in the background"). The extractor prints nothing, so nothing is delivered.
- `Stop` does not run when the user interrupts; API errors fire `StopFailure` instead (hooks.md, "Stop"). Section 6.5 covers the interrupt case.
- The transcript file is written asynchronously and may not yet hold the final message at Stop; hooks that need the final text should use `last_assistant_message` (hooks.md, "Common input fields" and "Stop input"). The ledger takes the text from `last_assistant_message` and resolves the record uuid from the transcript with retries (Section 4.2).

### 2.4 settings.json entries

Added 2026-11-05, appended after the existing Stop and UserPromptSubmit entries (which stay as they were); backup of the earlier file at `~/.local/state/ledgr/backup-20261105/settings.json`:

```json
"SessionStart": [
  { "matcher": "*", "hooks": [
    { "type": "command", "command": "bash \"$HOME/.config/herdr-app/mods/ledgr/bin/adapters/claude/session-start.sh\"", "timeout": 5 } ] } ],
"UserPromptSubmit": [ ...existing...,
  { "matcher": "*", "hooks": [
    { "type": "command", "command": "bash \"$HOME/.config/herdr-app/mods/ledgr/bin/adapters/claude/user-prompt-submit.sh\"", "timeout": 5 } ] } ],
"Stop": [ ...existing...,
  { "matcher": "*", "hooks": [
    { "type": "command", "command": "bash \"$HOME/.config/herdr-app/mods/ledgr/bin/adapters/claude/stop.sh\"", "timeout": 5 } ] } ]
```

`stop.sh` runs part A and then starts part B itself, detached (own session, stdio redirected), so one Stop entry covers both and no `"async": true` is needed. `adapters/claude/session-end.sh` exists for the optional SessionEnd entry (timeout 2) and is not registered. Part B runs outside any hook timeout, so it bounds itself (`curl --max-time 20`, whole run under about 30 s).

### 2.5 File shapes

`terminals/<t>.json` (the identity map; one file per terminal, replaced on every hook run). Remote-style addresses (`vps/t7`) are written as `vps__t7`.

```json
{
  "v": 1,
  "terminal": "t3",
  "scope": "2493840228-d525b7755a32be889707309b6dd855cb",
  "agent": "claude-code",
  "session_id": "88c36d53-35d6-4ccd-8fa6-2c260f89cc18",
  "session_name": "frozen trunk conversation",
  "transcript_path": "~/.claude/projects/-Users-you-Projects-app/88c36d53-35d6-4ccd-8fa6-2c260f89cc18.jsonl",
  "cwd": "~/Projects/app",
  "repo": "app",
  "turn": 17,
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "state": "working",
  "last_passage_hash": "7d016b835243",
  "last_assistant_uuid": "3b3543fa-37e6-44f9-bf1c-e4b0909bdbfa",
  "owner_pid": 4817,
  "owner_comm": "claude",
  "last_event": "UserPromptSubmit",
  "updated_at": 1793901880000
}
```

`sessions/<session_id>.json` (the session record; same fields plus history):

```json
{
  "v": 1,
  "session_id": "88c36d53-...",
  "agent": "claude-code",
  "terminal": "t3",
  "session_name": "frozen trunk conversation",
  "cwd": "~/Projects/app",
  "repo": "app",
  "transcript_path": "/Users/.../88c36d53-....jsonl",
  "model": "claude-fable-5-1",
  "turn": 17,
  "turn_base": "ledgr",
  "prompt_id": "550e8400-...",
  "state": "idle",
  "last_source": "resume",
  "last_stop_at": 1793901890000,
  "last_assistant_uuid": "6d0e1bd6-...",
  "last_passage_hash": "7d016b835243",
  "owner_pid": 4817,
  "owner_comm": "claude",
  "parent_session_id": null,
  "started_at": 1793889481000,
  "updated_at": 1793901890000
}
```

`session_name` comes from `session_title`, which is present only when the session has a custom title (hooks.md, "SessionStart input"). Fallback, optional and undocumented: the `name` field of the matching `~/.claude/sessions/<pid>.json` (observed: `"name":"frozen trunk conversation"`), found with `grep -l "\"sessionId\":\"$SID\"" ~/.claude/sessions/*.json`. `repo` is the basename of the git top level that holds `cwd` (the nearest folder with a `.git` entry), else of `cwd`. `agent` is always present in the map entry. `last_passage_hash` (sha1 of the whitespace-collapsed final message, first 12 hex chars) and `turn` anchor a message for any agent; `last_assistant_uuid` is the Claude-only transcript id and may be null.

Spool event (one small JSON file per event; the common envelope plus a payload):

```json
{ "v": 1, "id": "c1f0...", "type": "prompt", "at": 1793901880000, "terminal": "t3",
  "session_id": "88c36d53-...", "turn": 17, "prompt_id": "550e...",
  "local": false, "prompt_head": "First 2,000 characters of the prompt", "refs": ["A5", "Q3"] }
```

| `type` | Producer | Payload |
|---|---|---|
| `session_start` | hook | `agent`, `source`, `model`, `cwd`, `transcript_path`, `session_name`, `repo`, `turn` |
| `prompt` | hook | `turn`, `prompt_id`, `local`, `prompt_head`, `refs` |
| `pending` | hook, Stop part A, at once | `turn`, `passage_hash` |
| `stop` | Stop part B, once the uuid lookup ends (retries at 0, 1, 2, 4 s) | `turn`, `prompt_id`, `text_path`, `text_head` (400 chars), `passage_hash`, `message_uuid` (null if unresolved), `api_message_id` |
| `asks` | extractor, after `stop` | `turn`, `prompt_id`, `message_uuid`, `api_message_id`, `passage_hash`, `source` (`block`, `model`, `skip`, `error`), `asks[]`, `model`, `provider`, `usage` (with `cost_usd_est`), `ms`, `error`, `error_detail`, `block_error`, `extract_request_id`, `truncated` |
| `session_end` | hook (optional entry) | `turn`, `reason` |
| `capture` | capture box (mod) | a full `Request` (Section 3.1) |

Each item of `asks[]`: `text`, `kind`, `options`, `recommended`, `blocking`, `quote` (null unless found in the message), `repeat_of` (the Request id of an open or recently dismissed item this ask repeats, else null), `repeat_of_handle` (its handle, `A5`), `hash` (sha1 of the whitespace-collapsed quote, else text, first 12 hex chars), `origin` (`extract_block` or `extract_model`). There is no `settle` event: the turn's uuid travels on `stop`, and the mod attaches it to items parked during that turn. Per turn the order is `pending`, `stop`, `asks`; `asks` always gets a later millisecond than `stop`, so name order is event order. The writer's docstring (`bin/lib/ledgr_spool.py`) is the reference.

### 2.6 Atomic write

Every file the hooks write goes through a temp file in the same folder (dot-named, so the mod ignores it) and a rename, which is atomic on one filesystem (`atomic_write` in `bin/lib/ledgr_core.py`).

The session record is read, changed and written back. Writes are idempotent per event: a prompt whose `prompt_id` is already the record's does not count a second turn, and re-running any event rewrites the same content. A per-session `flock` (`locks/session-<sid>.lock`; kernel-exclusive, released if the holder dies, unlike a `mkdir` lock with a stale timeout) serialises the turn counter; it fails open after 3 s, and the idempotent write keeps a duplicate delivery harmless. Test: 50 parallel prompts give exactly 50 turns.

The mod side has no rename (`fs/promises` declares `readFile`, `writeFile`, `readdir`, `exists`, `unlink`, `rmdir`, `mkdir`: `gpui-kit.d.ts:22126-22138`). The capture box writes its spool file with `writeTextFile(path, text, null)` (`herdr.d.ts:26-28`); the reader treats a JSON parse failure as "not finished yet" and retries (Section 3.3).

### 2.7 Hook scripts

Built as Python (standard library, `/opt/homebrew/bin/python3`) behind thin bash entries, not the bash-and-jq skeleton first sketched here: Homebrew has no `jq` on this machine (`/usr/bin/jq` is Apple's), Python gives a real `flock` and one process per hook, and measured medians are 36 to 82 ms per hook. Each entry in `bin/adapters/claude/` sources `_env.sh` (absolute `PATH`; exit 0 at once when `LEDGR_INNER` is set or no terminal id is known; owner-pid lookup; `export LEDGR_INNER=1`), then runs `claude_hook.py <Event>`, which maps the Claude hook JSON onto `bin/lib/ledgr_map.handle()`. Stdout stays empty, except the instruction on SessionStart when `config.instruct_block` is true. Every path exits 0.

Turn rules:
- The ledger's turn number counts human prompts the ledger has seen in that session (`turn_base: "ledgr"`). Sessions that started before the hooks were installed start at 0. Turn numbers are a reading aid; identity is `session_id` + `prompt_id` + message uuid.
- Local slash commands do not start a turn (`/btw`, `/clear`, `/compact`, `/resume`, `/rewind`, `/model`, `/config`, `/tui`, `/focus`, `/diff`, `/help`, `/status`, `/cost`, `/context`, `/branch`, `/fork`, `/exit`; the regex in `claude_hook.py`), and a `prompt_id` already counted does not count again. Whether `/btw` fires `UserPromptSubmit` at all is not documented (unconfirmed); the regex makes the answer irrelevant.
- `SessionStart` with `source: "clear"` or `"resume"` changes the session in the terminal: the terminal file now points at the new `session_id`; the old session record stays.

### 2.8 How the mod reads the map

The panel copy reads `terminals/*.json` once at start (`fs.readdir`, `gpui-kit.d.ts:22132-22133`; `readTextFile`, `herdr.d.ts:23-25`), then follows the spool with `watchFolder` (`herdr.d.ts:404-414`), the pattern the `changes` mod uses (`mods/changes/main.js:47-58`). Reasons for `watchFolder` over polling:
- It is event-driven. The manual says not to poll live data and to keep timers to what changes (`AGENTS.md:868-871`, `AGENTS.md:893-902`).
- macOS watches recursively (`herdr.d.ts:408`), and the spool folder is tiny.
- The panel copy stays alive while the panel column is hidden or another stack child is shown (`AGENTS.md:795-798`), so the watch keeps running with the panel closed.

Watch details: watch `ledgr-data/spool/` only, never the whole data folder (turn files would add noise). A batch that contains the root path means "rescan everything" (`herdr.d.ts:409`). A 60-second timer re-runs `readdir` as a safety net and calls `cx.notify()` only when it ingested something. The mod cross-checks a map record against live data before trusting it: the address must appear in `terminals()` (`herdr.d.ts:214-217`) or `agents()` with `app === "claude-code"` (`herdr.d.ts:168-169`).

### 2.9 Other agents

The core in `bin/lib/` is agent-agnostic: an adapter turns its agent's events into calls to `ledgr_map.handle(event, session_id, terminal, agent, fields)`, `ledgr_extract.extract(...)` and the `ledgr_spool` builders. The quickest adapter reuses the Claude entries: run `adapters/claude/<event>.sh --agent <kind>` with `HC_TERMINAL_ID` (or `LEDGR_TERMINAL` outside Herdr) in its environment and the Claude-shaped JSON on stdin (`session_id`, `cwd`, optional `transcript_path`, plus `prompt` for UserPromptSubmit and `last_assistant_message` for Stop). An MCP stdio server is planned as another spool producer that imports `ledgr_spool` directly.

| Tier | Agent capability | How it plugs in |
|---|---|---|
| 1 | Native hooks (Claude Code) | Section 2.4 |
| 2 | A turn-complete callback (for example Codex's `notify` program, which receives JSON when a turn ends; unconfirmed for the installed Codex) | A 10-line adapter maps its JSON to the Stop shape and calls both scripts |
| 3 | Nothing | `bin/ledgr-wrap --agent pi -- pi ...` writes a session record with a generated uuid and `turn_source: "herdr-status"`, then `exec`s the agent. The panel copy watches `agents()` status for that terminal: `working` to `idle` or `done` counts as a turn end. For the agent lane it runs `hc read <t> --lines 400` (`hc read --help`) and passes the text to `ledgr-extract.sh --text-file` via `exec` (`herdr.d.ts:10-13`, 30 s limit). History reads return only the screen while an agent is working (audit Q2), which is why this runs after the transition |

The human lane works for every agent terminal from day one, because capture needs only the focused terminal and a session record (tier 3 creates one).

## 3. Ledger data model

### 3.1 Types

```ts
type Direction = "human_to_agent" | "agent_to_human";
type Status = "open" | "answered" | "resolved" | "dismissed" | "deferred";
type AgentKind = "claude-code" | "codex" | "pi" | "other";
type AskKind = "decide" | "confirm" | "do" | "provide" | "review";        // agent to human
type QuestionKind = "question" | "note" | "bookmark";                    // human to agent

interface Anchor {
  sessionId: string;            // trunk session the item belongs to
  turn: number;                 // ledger turn of the message it points at
  promptId?: string;            // hook prompt_id of that turn
  uuid?: string | null;         // optional: transcript uuid of the turn's final message (Claude only; from the stop event)
  hash: string;                 // sha1 of the whitespace-collapsed passage (quote, else text), first 12 hex chars
  apiMessageId?: string;        // message.id ("msg_...") of that record
  quote?: string;               // verbatim span, at most 600 characters
  quoteSource?: "block" | "model" | "clipboard" | "typed";
  settled: boolean;             // false for a capture made while the turn was still streaming
  capturedDuring?: "working" | "idle";
}

interface Request {
  id: string;                   // "rq_" + crypto.randomUUID() (gpui-kit.d.ts:22080)
  key: string;                  // de-duplication key (3.4)
  handle: string;               // per session: "A5" for agent asks, "Q3" for human questions
  direction: Direction;
  text: string;                 // imperative ask, or the human's question; at most 400 characters
  kind: AskKind | QuestionKind;
  options?: string[];           // decide only
  recommended?: string | null;
  blocking?: boolean;           // the agent says it is waiting on this
  anchor: Anchor;
  status: Status;
  answer?: string;              // the human's reply to an ask, or a resolution note
  parentId?: string;            // a human question about an agent ask (clarification thread)
  repeatOf?: string | null;     // the Request id an extracted ask repeats (the extractor's repeat_of)
  origin: "capture" | "btw" | "extract_block" | "extract_model" | "manual";
  terminal?: string;            // terminal at creation
  createdTurn: number;
  resolvedTurn?: number;        // session turn when it was resolved or dismissed
  lastSeenTurn?: number;        // agent re-asked it at this turn
  askedAtTurn?: number;         // human question sent to the agent at this turn
  btwStagedAt?: number;
  deferUntil?: number | "next_session" | null;
  branch?: { branchId: string };            // Phase 2
  createdAt: number; updatedAt: number; resolvedAt?: number;
  seq: number;                  // order within its turn's ask set
}

interface SessionRecord {
  sessionId: string;
  agent: AgentKind;
  terminal: string | null;      // last terminal it ran in
  sessionName?: string;
  cwd: string;
  repo?: string;
  transcriptPath: string | null;
  model?: string;
  turn: number;
  turnSource: "hooks" | "herdr-status";
  state: "working" | "idle" | "ended";
  lastStopAt?: number;
  lastAssistantUuid?: string;
  parentSessionId?: string | null;          // Phase 2: set for branch sessions
  nextHandle: { A: number; Q: number };
  startedAt: number; updatedAt: number;
}

interface Branch {                          // Phase 2; stored now so the shape is stable
  id: string;                               // "br_" + uuid
  requestId: string;
  parentSessionId: string;
  sessionId: string | null;                 // learned from the branch's SessionStart (source "fork")
  terminal: string | null;
  name: string;                             // hc --name, e.g. "br-q7-3f2a"
  label: string;                            // claude -n label
  depth: 1 | 2;
  forkTurn: number;                         // trunk turn when launched: the branch knows turns 1..forkTurn
  anchorTurn: number;
  anchorMessageUuid: string | null;
  quote?: string;
  policy: "fork_end_of_session";
  doesNotKnow: string[];                    // e.g. ["trunk turns after 22", "branch br-q5-91c0", "Q3", "Q5"]
  cwd: string;
  launchedAt: number;
  status: "running" | "awaiting_human" | "concluded" | "merged" | "discarded" | "stale";
  conclusion?: { answer: string; changes: string[]; at: number };
}

interface Store {                           // the localStorage value "store"
  v: 1;
  items: Record<string, Request>;
  sessions: Record<string, SessionRecord>;
  branches: Record<string, Branch>;
  terminals: Record<string, { sessionId: string; updatedAt: number }>;
  ingested: string[];                       // last 1,000 spool event ids
}
```

### 3.2 Persistence: `localStorage` of the panel copy

Choice: the item store is the `localStorage` of the panel copy (on disk `data/ledgr/store.json`; the audit observed the same layout for `data/agents/store.json`, audit Q2). `shared()` carries only two small derived keys. Why:

- One writer. Every item change is made by the panel copy: it ingests the spool and handles every click. `localStorage` is per mod copy (`AGENTS.md:997`), which suits a single writer and nothing else.
- Blast radius. `shared.json` holds every mod's shared state; it is rewritten on each change, the latest change wins, and an invalid file sends the whole app back to empty shared state (`AGENTS.md:86-90`). A store that grows by a few items every turn does not belong there.
- Redraw cost. `setShared` re-renders every mod in the window (`herdr.d.ts:392-393`). The store changes on each spool event; the chip needs to change only when a count changes.
- Hooks never touch either file. They write the spool, which is the only producer path (3.3).

Cross-mod signals in `shared()` (`herdr.d.ts:389-393`), written only by the panel copy, and only when the value changes:

| Key | Shape | Read by |
|---|---|---|
| `ledgr.chips` | `{ [terminal]: { s: sessionId, q: openHuman, a: openAgent, st: "collecting" \| "surfaced" \| "seen", t: turn } }` | `my-pane` header chip |
| `ledgr.focus` | `{ session: string, item?: string, at: number }` | panel copy (set by a chip click or the capture box) |

Bounds: closed items (resolved or dismissed) older than 14 days move to `ledgr-data/archive/<yyyy-mm>.jsonl` (read, append in memory, `writeFile`; there is no `appendFile`, `gpui-kit.d.ts:22126-22138`). `quote` is capped at 600 characters and `text` at 400. A store of 300 live items stays under about 250 KB.

`snapshot.json`: after each change (debounced to 2 s) the panel copy writes `{ updatedAt, items: [open, deferred and answered items, and items dismissed in the last 7 days, without quotes over 200 chars] }` with `writeTextFile` (`herdr.d.ts:26-28`). The extractor reads it for the open and recently dismissed asks (4.4; fields `id`, `handle`, `direction`, `status`, `text`, `anchor.sessionId`, `resolvedAt` or `updatedAt`), and other tools (a shell `ledgr ls`) can read it without touching Herdr's files.

Unconfirmed: whether two copies of the same mod share one `localStorage` file or get one each, and whether a copy that "starts over" after a layout edit (`AGENTS.md:799-800`) keeps its `localStorage`. The design does not depend on sharing (only the panel copy uses it). To guard against loss on a layout edit, the panel copy also writes `ledgr-data/store.backup.json` daily and restores from it when its `localStorage` is empty.

### 3.3 Single writer and the spool

- Writer election: at init, a copy with `props().view === "panel"` sets `shared("ledgr.writer")` to a random copy id; it ingests only while that key holds its id. A newer panel copy (after a layout switch) takes over by overwriting the key.
- Ingest loop: list `spool/` at start and on each `watchFolder` batch, sort by name (names start with the millisecond time), skip dotfiles, `readTextFile`, `JSON.parse`. A parse failure is retried up to 5 times, 300 ms apart (`cx.timer.after`), then the file moves aside as `spool/bad-<name>`. After applying an event, `fs.unlink` deletes the file (`gpui-kit.d.ts:22135`). Event ids go into `store.ingested`, so a replay is harmless.
- Apply is order-tolerant: an `asks` event carries its `turn` and can arrive after the next `prompt`.
- When no panel copy is running (another layout is shown), the spool accumulates and is ingested on return. The `SessionStart` hook prunes spool files older than 7 days.

### 3.4 Keys and de-duplication

| What | Key | Rule |
|---|---|---|
| Spool event | `id` (uuid) | Ignored if already in `store.ingested` |
| Request | `id` = `rq_<uuid>` | Never reused |
| Handle | per session, `A<n>` and `Q<n>` from `SessionRecord.nextHandle` | Stable, shown in the UI, typed by the human as `[A5]` |
| Agent ask | `key = sessionId + "|a|" + norm(text)` | `norm`: strip markdown and list numbering, lower-case, collapse whitespace, drop trailing punctuation, first 160 characters |
| Human question | `key = id` | Double-capture guard: same session and same `norm(text)` within 30 s is dropped |

When an `asks` event brings an ask whose `key` matches, or whose model-supplied `repeat_of` names an existing item in the same session:
- existing `open` or `deferred`: update `lastSeenTurn` and the anchor to the newest message; no new item;
- existing `answered`: set back to `open` with the note "asked again at turn N" (the answer did not land);
- existing `resolved`: create a new item with `parentId` pointing at the old one (the agent needs it again);
- existing `dismissed`, recently (the extractor lists dismissed items of the last 7 days): a new item with `repeatOf` pointing at the old one (the agent raised it again after the human closed it).

## 4. Agent-ask extraction (decided)

Decision (Jesse, 2026-11-05): a small model call over the last assistant message at Stop, with a structured asks block as the fast path when the agent emitted one. Revised the same day (design review): the block instruction is off by default, only a valid non-empty block skips the model, the prompt keeps only asks that need the user, and the model call sits behind a provider seam (4.4).

### 4.1 Pipeline

Stop part B (`adapters/claude/claude_extract.py --input`, started detached by `stop.sh`):
1. Guards: the terminal id is set, `session_id` present, no `agent_id` on stdin, and no live other owner of the terminal (2.3).
2. A resolver thread looks up the message uuid in the transcript (4.2, retries at 0, 1, 2 and 4 s) and emits `stop` with it (or with `message_uuid: null`).
3. Meanwhile `MSG = .last_assistant_message`. Under 40 characters: `source: "skip"`.
4. `parse_block` on `MSG` (4.3). A valid, non-empty block in `block-first` mode (default) is the result; no model call. An empty array or an invalid block falls through.
5. Otherwise the configured provider (4.4) on the message with the block removed, with the session's open and recently dismissed asks listed.
6. Every result, block or model, goes through one validator (`bin/lib/ledgr_asks.py`): quotes must be whitespace-normalised substrings of the message (else dropped, ask kept), `repeat_of` must name a listed handle (else dropped), lengths are capped.
7. Emit one `asks` event, after `stop`, with the asks, `source`, `model`, `provider`, `usage`, `ms` and any `error`.

### 4.2 Reading the last assistant message

Primary source: the Stop hook's `last_assistant_message`, "the text content of Claude's final response" (hooks.md, "Stop input"). Part A of the Stop hook saves it as `turns/<sid>/<turn>.md`, so the panel can show the whole message without reading the transcript (which can pass `readTextFile`'s 1 MiB cap: this session's transcript was 1.2 MB at the time of writing).

Message uuid: the transcript is JSONL; its format is internal and changes between versions (report, citing the sessions docs). Observed in this session's transcript on 2026-11-05: assistant records have `type: "assistant"`, `uuid`, `parentUuid`, `isSidechain`, `sessionId` and `message` (`id`, `content[]`, `stop_reason`); one API message is split over several records that share `message.id` (up to 8 seen), one content block each; the final text sits in the last assistant record with a `text` block. `bin/adapters/claude/last_assistant.py` (as built it also skips lines without `"assistant"` before parsing, which reads a 2.3 MB transcript in about 4 ms):

```python
#!/usr/bin/env python3
"""last_assistant.py <transcript.jsonl> <expected-text-file>
Prints {"uuid", "api_id"} of the last main-thread assistant record that carries text, if its
text and the end of the expected text (Stop's last_assistant_message) agree; else {}."""
import json, os, sys

path, expected_file = sys.argv[1], sys.argv[2]
want = " ".join(open(expected_file, encoding="utf-8").read().split())[-160:]
size = os.path.getsize(path)
with open(path, "rb") as f:
    f.seek(max(0, size - 4_000_000))          # the tail is enough; the first line may be cut
    data = f.read().decode("utf-8", "replace")
best = None
for line in data.splitlines():
    try:
        r = json.loads(line)
    except Exception:
        continue
    if r.get("type") != "assistant" or r.get("isSidechain"):
        continue
    msg = r.get("message") or {}
    text = "".join(b.get("text", "") for b in msg.get("content") or []
                   if isinstance(b, dict) and b.get("type") == "text")
    if text.strip():
        best = (r.get("uuid"), msg.get("id"), " ".join(text.split()))
if best and want and (best[2].endswith(want) or want.endswith(best[2][-160:])):
    print(json.dumps({"uuid": best[0], "api_id": best[1]}))
else:
    print("{}")
```

Run it with `python3 -I`. Tested 2026-11-05 against this session's live 1.2 MB transcript: it returned the uuid and `msg_` id of the final text record, and `{}` for a non-matching expected text. If all retries fail, the `stop` event carries `message_uuid: null` and nothing retries later (there is no `settle` event). Anchors stay usable without a uuid, because they also hold `turn`, `promptId`, the passage `hash` and the quote.

### 4.3 Fast path: the `ledgr-asks` block

Instruction. When `config.instruct_block` is true (default false since the 2026-11-05 design review, see Q2 in Section 10), the SessionStart hook prints `bin/lib/asks-instruction.txt`, which Claude Code adds to the session's context (hooks.md, "Exit code 0"). It is added at session start and again after `/clear` and compaction, so it sits early in the cached prefix:

```text
Ledger convention: when a reply asks the user to decide, confirm, do, provide or review something,
end the reply with a fenced code block whose info string is ledgr-asks, holding a JSON array with one
object per ask, in the order the reply raises them:
{"text": "<one imperative sentence the user can act on without rereading>",
 "kind": "decide|confirm|do|provide|review",
 "options": ["..."], "recommended": "<one of options or null>", "blocking": true|false,
 "quote": "<short verbatim span from the reply that states the ask>"}
Omit the block when the reply asks nothing. Do not mention the block in prose.
```

Delimiter and detection (`bin/parse_block.py`):
- An opening fence is a line matching `^ {0,3}(`{3,}|~{3,})[ \t]*ledgr-asks[ \t]*$`.
- It closes at the next line of only the same fence character, repeated at least as many times: `^ {0,3}F{n,}[ \t]*$`.
- The last complete block in the message wins. An unterminated block is ignored, as is anything after it.
- Body: a JSON array, or an object with an `asks` array. Each element needs a non-empty string `text`. `kind` outside the enum becomes `do`; `options` keeps up to 8 strings; `recommended` is kept only if it is one of `options`; `blocking` is true only if literally `true`; `quote` is kept only if it is a substring of the prose (whitespace-normalised). At most 20 items.
- Valid means: the JSON parsed and at least one element survived, or the array was empty (an explicit "no asks"). Only a valid block with at least one ask skips the model; an empty array or an invalid block falls through to it.
- The block is removed from the text the panel displays and from the text sent to the model.

As built, `bin/lib/parse_block.py` applies these rules and hands each element to the shared validator in `bin/lib/ledgr_asks.py` (the same one the model path uses), which adds `hash`, `origin`, `repeat_of` and `repeat_of_handle` to each ask.

Tested 2026-11-05: `bin/tests/test_parse_block.py`, 22 checks over 11 fixtures (the five original inputs plus a tilde fence with an `asks` object, two blocks, a quote not in the prose, a shorter closing fence, no valid items, and the old tag).

When both are present:

| `config.extract.mode` | Valid block | Model call | Result |
|---|---|---|---|
| `block-first` (default) | yes, non-empty | no | block asks, `origin: extract_block` |
| `block-first` | empty, invalid or none | yes, on the prose | model asks, `origin: extract_model`; `block_error` logged |
| `always-model` | yes | yes | union: block asks win on every field; model asks whose `norm(text)` or quote matches a block ask are dropped; the rest are added as `extract_model` and drawn dimmed (a suggestion the human confirms) |
| `block-only` | either | never | block asks or nothing |

`config.extract.audit_rate` (default 0): the share of block turns on which the model also runs, with disagreements logged to `log/extract-audit.jsonl` and not shown. Set it to 0.2 for the first week to check whether the agent's own block misses asks.

### 4.4 Model call

Provider seam (`config.extract.provider`; one function signature, `complete(system, user_text, schema, opts)`, in `bin/providers/`):

| Provider | Call | Credential |
|---|---|---|
| `anthropic` (default) | Messages API, request below | Keychain service `ledgr`, account `anthropic`, or `LEDGR_ANTHROPIC_KEY` |
| `openai-compatible` | `POST {extract.base_url}/chat/completions` with `response_format: {type: "json_schema", ...}` and the schema also in the system prompt; covers Ollama, OpenRouter, xAI; set `extract.model` to the server's id | Keychain account `openai-compatible` or `LEDGR_OPENAI_COMPATIBLE_KEY`; optional (no key sends no `Authorization`) |
| `cli` | `claude -p` on the subscription (4.7) | none |

No provider's structured-output mode is trusted: every reply is parsed (a stray ```` ```json ```` fence is tolerated) and goes through the same validator as the block (`bin/lib/ledgr_asks.py`).

Default model: `claude-haiku-5-5` (Claude Haiku 5.5), the current Haiku: $0.10 per million input tokens and $0.50 per million output tokens for prompts up to 100K tokens (claude-api skill model table, cached 2026-10-06). Thinking off and effort `low`: Haiku 5.5 accepts `thinking: {type: "disabled"}` at effort `high` or below (claude-api skill, thinking table). Structured output through `output_config.format` with a JSON schema (claude-api skill, structured outputs). Raw HTTP with the system `curl`; no SDK (`python3 -c "import anthropic"` fails on this machine).

Request (`bin/providers/anthropic.py`; the key goes to `curl` in a config on stdin and the body in a 0600 temp file, so neither shows in `ps`):

```json
{ "model": "claude-haiku-5-5", "max_tokens": 4000,
  "thinking": { "type": "disabled" },
  "output_config": { "effort": "low", "format": { "type": "json_schema", "schema": "<bin/lib/asks.schema.json>" } },
  "system": "<bin/lib/extract-system.txt>",
  "messages": [ { "role": "user", "content": "<user content, below>" } ] }
```

Headers: `x-api-key`, `anthropic-version: 2026-10-21`, `content-type: application/json`; `curl --max-time 20` (`extract.timeout_s`).

Read the reply by block type, not position: check `.stop_reason` first (`refusal` or `max_tokens` mean no result; Haiku 5.5 has no server-side refusal fallback, claude-api skill), then take `.content[] | select(.type == "text") | .text` and parse it as JSON. `anthropic-version: 2026-10-21` is the current raw-HTTP version (claude-api skill, `curl/examples.md`); the request sends no sampling parameters, which that version rejects. `usage` is passed through with `cost_usd_est` added.

System prompt (`bin/lib/extract-system.txt`):

```text
You read one message that an AI coding agent has just written to its user, and list the asks in it:
what the USER must act on or decide before the agent's work can continue or be called finished.
Reply with JSON only, matching the schema.

An ask is one of:
- decide: a decision the agent leaves to the user, with the options it offers and the one it recommends;
- confirm: a confirmation the agent needs before it goes on ("Shall I delete X?", "OK to push?"), when
  its progress waits on the answer;
- provide: information only the user has (a value, a location, a name, a preference);
- do: an action outside the agent's reach (a portal step, a sign-in, an approval, contacting a person);
- review: something the agent asks the user to check before it goes further.
Do not include:
- offers and suggestions the user can simply ignore: "Want me to also ...?", "I can also ... if you
  like", "Let me know if you want ...", "Happy to ...";
- work the agent says it will do itself, summaries of finished work, and rhetorical questions;
- generic closers such as "let me know if you have questions";
- instructions for someone other than the user, unless the user must pass them on (then the ask is
  to pass them on).
When in doubt, leave it out.

For each ask:
- text: one imperative sentence the user can act on without rereading the message, at most 140
  characters, naming the thing concretely.
- kind: decide, confirm, provide, do or review.
- quote: the shortest verbatim span of the message, at most 300 characters, that states the ask.
  Copy it exactly.
- options and recommended: only for decide; recommended is null unless the message recommends one.
- blocking: true only if the message says or clearly implies the agent is waiting on it.
- repeat_of: when the ask is the same request as an item listed under OPEN ASKS or RECENTLY
  DISMISSED ASKS (even if worded differently), that item's id, for example "A5"; else null.
  Use only ids from those lists. A dismissed item that the message raises again is still listed,
  with repeat_of set.
Keep the message's order. If the message asks nothing, return an empty asks array.
```

User content template:

```text
SESSION: <session_name or "unnamed"> (<repo>, <cwd>)
OPEN ASKS (already recorded for this session):
A2: Decide whether to keep the stale release branch
A5: Run the Qualys rescan after the reboot
RECENTLY DISMISSED ASKS (closed by the user; list one again only if this message raises it again):
A4: Rotate the staging certificate
MESSAGE:
<message>
...the turn's final message, ledgr-asks block removed, last 60,000 characters...
</message>
```

Both lists come from `snapshot.json` (3.2), filtered to this session: open, deferred and answered items (at most 30), and items dismissed in the last 7 days (at most 15); an empty list reads `none`. The model answers with handles; the extractor keeps a `repeat_of` only if it names a listed handle and emits the item's Request id as `repeat_of` and the handle as `repeat_of_handle`. When the message is longer than 60,000 characters the first part is cut and the user content says `(message truncated at the start)`; asks cluster at the end of a reply.

Schema (`bin/lib/asks.schema.json`). Lengths are enforced in code after parsing, not in the schema; nullable fields use `anyOf`, which the structured-outputs table lists as supported:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["asks"],
  "properties": {
    "asks": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "kind", "quote", "options", "recommended", "blocking", "repeat_of"],
        "properties": {
          "text": { "type": "string" },
          "kind": { "type": "string", "enum": ["decide", "confirm", "do", "provide", "review"] },
          "quote": { "type": "string" },
          "options": { "type": "array", "items": { "type": "string" } },
          "recommended": { "anyOf": [{ "type": "string" }, { "type": "null" }] },
          "blocking": { "type": "boolean" },
          "repeat_of": { "anyOf": [{ "type": "string" }, { "type": "null" }] }
        }
      }
    }
  }
}
```

### 4.5 Cost per turn

Token counts are estimates in Haiku 5.5 tokens (its tokenizer counts the same text as about 30% more tokens than Haiku 4.5's, claude-api skill). Fixed overhead: system prompt about 450, schema and wrapper about 300.

| Turn | Input tokens | Output tokens | Cost |
|---|---|---|---|
| Short reply, no asks | about 1,050 | about 20 | $0.00012 |
| Typical: 600-word reply, 3 asks | about 2,000 | about 250 | $0.00033 |
| Long: 2,000-word reply, 8 asks | about 4,500 | about 700 | $0.00080 |
| Cap: 60,000 characters, 15 asks | about 20,000 | about 1,300 | $0.00265 |
| Fast path (valid block) | 0 | 0 | $0 at Stop |

At 150 turns a day of the typical kind: about $0.05 a day, about $1.50 a month. The block is not free either: it is output from the trunk model. A 150-token block on Claude Fable 5.1 (Jesse's `model: "fable"`, `~/.claude/settings.json:7`; $50 per million output tokens) is about $0.0075 per turn that asks something, counted against the Max plan rather than in dollars. The block buys latency (asks appear at Stop with no call) and precision (the agent states `blocking` and its own options), not savings.

### 4.6 Failures

| Failure | Behaviour |
|---|---|
| No key and no `claude` fallback | `asks` event with `source: "error"`, `error: "no credential"`, `error_detail` naming the missing Keychain item (a valid non-empty block is still used); the panel shows one dim line "asks not extracted for turn 17" with a Retry button that runs the extractor through `exec` |
| HTTP error, timeout, `refusal`, `max_tokens`, invalid JSON | same as above, with the error text; never retried automatically |
| Quote not found in message | quote dropped, ask kept |
| Message uuid not resolved | `message_uuid: null`; settled later (4.2) |

### 4.7 Credential

Default: a personal Anthropic API key in the macOS Keychain, service `ledgr`, account `anthropic` (`security add-generic-password -s ledgr -a anthropic -w`), or `LEDGR_ANTHROPIC_KEY` in the environment. Each provider reads the account named after it (`openai-compatible` for that provider) or `LEDGR_<PROVIDER>_KEY`. The read is `security find-generic-password -s ledgr -a <provider> -w` with a 15 s timeout, so an unanswered access prompt cannot hang the extractor. An item created with `security add-generic-password` trusts `/usr/bin/security`, so no prompt appears; one made in Keychain Access prompts once ("Always Allow"). Do not borrow an `ant` CLI profile (an organisation admin profile, for instance) for this call; the key is the person's own.

The `cli` provider, or the fallback when the anthropic key is missing and `config.extract.cli_fallback` is true (default false): the Claude Code CLI on Jesse's subscription (all flags from `claude --help`), with the prompt on stdin:

```bash
cd "$D" && LEDGR_INNER=1 claude -p --model claude-haiku-5-5 --output-format json \
  --json-schema "$(cat "$BIN/lib/asks.schema.json")" \
  --system-prompt "$(cat "$BIN/lib/extract-system.txt")" \
  --tools "" --disable-slash-commands --no-session-persistence --setting-sources local \
  < user-content.txt
```

`LEDGR_INNER=1` (set for every process a ledgr hook starts) makes ledgr's own hooks exit at once inside that process, and the `HC_*` variables are removed from its environment. `--setting-sources local` is meant to keep the user-level hooks in `~/.claude/settings.json` from firing (unconfirmed). `--bare` would skip hooks but reads only `ANTHROPIC_API_KEY`, never OAuth (`claude --help`), so it does not help here. Where the structured result sits in the `--output-format json` output is unconfirmed; the provider reads `structured_output`, else `result`. The CLI starts slower (seconds), which is acceptable for a detached extractor.

## 5. Human-ask capture

### 5.1 Key and overlay

- `keys.json`, `global`: `"cmd-j": "mod.open:ledgr"`. `mod.open` toggles a mod "as the overlay its mod.json describes; calling again closes it" (`herdr-app commands`; `AGENTS.md:603`). This is the pattern the Linear mod uses on Cmd-L (`keys.json:60`). A `<mod>.<command>` key would not work here, because it reaches only copies on screen (`AGENTS.md:800`), and the panel is often hidden. `cmd-j` is unbound in `keys.json:2-62`. A key bound in `global` and not in `terminal` is Herdr's, not the program's (`AGENTS.md:486-492`), which is how `cmd-l` reaches Linear over a focused terminal today; so it should work while Claude streams and holds the keyboard (confirmed by 9.5 step 1).
- `mods/ledgr/mod.json`:

```json
{ "place": "none", "title": "Ledger",
  "overlay": { "kind": "popup", "at": "top", "offset": 40, "width": 600, "height": 236 } }
```

`place: "none"` keeps Herdr from docking a copy on first sight (`AGENTS.md:787-789`). The overlay object copies the Linear and Picker mods (`mods/linear/mod.json:1`, `mods/picker/mod.json:1`). A popup does not dim the window, so the stream stays visible behind it.

- `keys.json`, new section `"mod:ledgr": { "cmd-enter": "ledgr.btw" }`, delivered to `nextCommand()` (`herdr.d.ts:395-402`), the way `mod:linear` routes its keys (`keys.json:74-78`). Esc closes the top popup by itself (`herdr.d.ts:366-367`).

The overlay copy gets `props().overlay` and closes itself with `closeOverlay(props().overlay)` (`herdr.d.ts:363-368`; `mods/linear/main.js:580`). `main.js` routes on props: `view: "panel"` draws the panel; no `view` with an `overlay` draws the capture box; `view: "capture"` with `parent` is the capture box opened from an item (5.6).

### 5.2 The box

```
+------------------------------------------------------------------------+
| Park a question  .  t3 frozen trunk conversation  .  turn 17 (working)  |
| [ Why does the scan still flag TLS 1.0 if SChannel has it off?       ] |
| Quote (from clipboard)  [x] "TLS 1.0 is disabled in SChannel, so..."   |
| Enter park   Cmd-Enter park + /btw   Esc cancel        session: t3 v   |
+------------------------------------------------------------------------+
```

- The input takes focus on open, with the 600 ms refocus the `prompt` mod uses (`mods/prompt/main.js:9-17`); `InputState`/`Input` from `gpui-base` (`gpui-kit.d.ts:21330-21427`).
- Target session: the session in `terminals/<focused().terminal>.json` (`herdr.d.ts:219-227`), read once at init. If the focused terminal has no record (a shell, a mod pane), the session menu defaults to the most recently active agent session and lists the others.
- Enter on text: park. Enter on an empty input with a quote: park a `bookmark` (a passage to come back to, no question). Enter on an empty input with no quote: close.
- The box never sends anything to the agent.

### 5.3 What gets recorded

The box writes a `capture` spool event (2.5) holding a `Request`:

| Field | Value |
|---|---|
| `direction` | `human_to_agent` |
| `kind` | `question`, or `bookmark` when the text is empty |
| `text` | what was typed |
| `anchor.sessionId`, `anchor.turn`, `anchor.promptId` | from the terminal's map record at open time |
| `anchor.capturedDuring` | the record's `state`: `working` or `idle` |
| `anchor.uuid`, `anchor.hash` | `null` when `working`; the map record's `last_assistant_uuid` and `last_passage_hash` when `idle` |
| `anchor.settled` | `false` when `working`, `true` when `idle` |
| `anchor.quote`, `quoteSource` | the clipboard text, when kept (5.4) |
| `parentId` | the agent ask it is about, when opened from an item |
| `origin` | `capture`, or `btw` after Cmd-Enter |
| `createdTurn` | the record's `turn` |

Settling: a question captured during turn 17 points at the message that turn will end with. At the `stop` event for turn 17, which carries that turn's `message_uuid` and `passage_hash`, the writer sets the anchor's `uuid` and `hash` and `settled: true`. If the item has a quote that is not in turn 17's text (`turns/<sid>/17.md`), the writer searches the saved turns backward (up to 50) and re-anchors to the turn that contains it; the reader may have scrolled up to an older answer.

### 5.4 Selection: Herdr exposes none; the clipboard is the bridge

Herdr's mod API has no call that returns a terminal's selected text (`herdr.d.ts` has none; mods read terminal text only through `hc read`, `AGENTS.md:974`). Two facts make the clipboard workable:
- Jesse's Claude Code runs with `"tui": "fullscreen"` (`~/.claude/settings.json`), where selected text "copies to your clipboard automatically on mouse release" (fullscreen.md, "Use the mouse").
- A mod can read the clipboard: `read_from_clipboard()` on the app context (`gpui-kit.d.ts:345-348`). Whether a mod's `cx` exposes it is unconfirmed.

Rule: on open, the box reads the clipboard. If it holds text of 3 to 600 characters that differs from the clipboard text seen at the previous capture, it is offered as the quote with the checkbox on; otherwise the checkbox starts off. For terminals in the classic renderer, the box first runs `terminal.copy` (`AGENTS.md:571-572`), which acts on "the focused pane or block" when no terminal holds the keyboard (`AGENTS.md:588-590`), then reads the clipboard (unconfirmed that this ordering works from an overlay).

### 5.5 The `/btw` fast path

`/btw` asks a side question while Claude is working; the answer shows in a dismissible overlay and never enters the conversation history (report, Claude Code table, citing Interactive mode). Cmd-Enter in the box:
1. parks the item with `origin: "btw"` and `btwStagedAt`;
2. writes `/btw About "<first 120 characters of the quote>": <question>` (or `/btw <question>` with no quote) to the clipboard;
3. focuses the agent's pane with `pane.focus {terminal}` (`AGENTS.md:555`, `AGENTS.md:561-562`) and closes the box.

Jesse then presses Cmd-V and Enter. The ledger does not type it for him by default: `hc send` pastes and then presses Enter (`hc send --help`), and if Claude's prompt already holds a draft, the paste would join the draft and submit both. `config.btw.autoSend: true` switches to `hc(["send", "--if", "idle", t, text])` for people who never keep drafts. The `/btw` answer is not saved anywhere the ledger can read, so the item stays `open` with a "/btw" badge until Jesse resolves it.

### 5.6 Linking human questions to the conversation

- "Ask about this" on an agent ask opens the box with `{view: "capture", parent: <id>}` and pre-fills `re [A5] `. The question becomes a child row under A5.
- When a prompt is submitted, the `prompt` event's `refs` lists any `[Q3]` or `[A5]` it contains. A referenced human question becomes `askedAtTurn = turn`, then `answered` at that turn's Stop. A referenced agent ask becomes `answered`, with the prompt's first 400 characters as `answer`. The answer sheet (6.4) writes these references for him.
- A parked question whose normalised text appears inside a submitted prompt is treated as referenced too.

## 6. UI

### 6.1 Layout, header, tab bar and keys

1. Clone the header mod: `herdr-app do mod.clone '{"name":"pane","as":"my-pane"}'` (`AGENTS.md:191-192`). Shipped mods are replaced on every start, so edits go in clones (`AGENTS.md:183-208`).
2. Edit `layouts/custom.json` (a personal clone, `custom.json:3-6`, so its tree can change; a deliberate file edit beats a recorded click, `AGENTS.md:213`). Point the pane header at the clone, `custom.json:99-106`:

```json
"header": {
  "content": { "mod": "my-pane" },
  "reveal": "always",
  "height": 30,
  "position": "top"
}
```

   and add a fourth child to the `panel-body` stack after the `quota` block (`custom.json:144-150`):

```json
{
  "id": "ledgr",
  "type": "block",
  "content": {
    "mod": "ledgr",
    "props": { "view": "panel" }
  }
}
```

   A stack shows one child at a time (`AGENTS.md:225-226`), so the ledger shares the 368 px panel (`custom.json:155-160`, min 280, max 900) with Files, Changes and Quota. See Q3 in Section 10 for the own-column alternative. After saving, confirm there is no `layout.error` (`AGENTS.md:51-53`).
3. `mods/my-tabs/main.js` (Jesse's clone of `tabs`):
   - add `toggle-ledgr` to the `nextCommand()` loop next to `toggle-quota` (`main.js:20-30`);
   - add `"ledgr"` to the `enabled` list (`main.js:99`) and a "Ledger" `panelButton` with a ledger icon (`main.js:101-118`);
   - treat `ledgr` like `quota` in `syncPanel` (`main.js:38-43`): it follows the focused agent across spaces, so it is never recorded or replaced per space.
4. `keys.json`, `global`: `"cmd-j": "mod.open:ledgr"` and `"cmd-shift-j": "my-tabs.toggle-ledgr"`. Any edit makes the whole file Jesse's (`AGENTS.md:473-475`); it already is (it holds `cmd-l` and `cmd-shift-u`, `keys.json:60-61`).

### 6.2 The panel

The panel follows the focused agent's session (`focused()`, `herdr.d.ts:219-227`; live data re-renders the mod, `AGENTS.md:868-871`) unless pinned. The `agents` mod's flat row style is the model for rows.

```
+--------------------------------------------------------------+
| Ledger    t3 . frozen trunk conversation v   pin   turn 17   |
|--------------------------------------------------------------|
| ASKED OF YOU                                       3 open    |
|  turn 17 . 4 asks                                            |
|  o A5 decide   Pick the TLS cipher order for PRODAPP         |
|                Mozilla intermediate (rec.) | CIS L1    [ans] |
|  o A6 do       Run the Qualys rescan after the reboot  [blk] |
|  ( A7 confirm  OK to remove RC4 from the registry?  -> yes   |
|  v A4 provide  ...                                           |
|  [Copy answers]  [Send when idle]                            |
|  turn 12 . 2 asks, 1 open                              >     |
|--------------------------------------------------------------|
| YOUR QUESTIONS                                     2 open    |
|  o Q3  Why does the scan still flag TLS 1.0?   t14 "TLS 1.0..|
|  . Q4  (parked during turn 17; anchors at end of turn)       |
|--------------------------------------------------------------|
|  older than a day (5) >   deferred (2) >   closed (9) >      |
+--------------------------------------------------------------+
```

- Two lanes, both visible, agent asks first. Each lane is a `Collapsible` (`gpui-kit.d.ts:21054`) with a count; rows in a `list` (`gpui-kit.d.ts:20297-20345`).
- Agent asks are grouped by the turn whose message raised them, newest first. The newest set is open; older sets are folded to one line.
- A row: handle, status glyph, kind, text (two lines, then truncated), options for `decide` with the recommended one marked, a `blocking` tag, turn marker. Hover actions: resolve, defer, dismiss, ask about this, go to anchor, branch (Phase 2, hidden in Phase 1).
- Clicking a row expands it: the quote, then the anchoring message rendered with `TextView.markdown` (`AGENTS.md:921`) from `turns/<sid>/<turn>.md` with the quote wrapped in bold, then "show whole message".
- Model-only suggestions in `always-model` mode are drawn dimmed with an "add" action (UX notes, "show model-proposed questions only as suggestions").
- Footer folds: items untouched for over a day, deferred, closed. Items from ended sessions sit under the session selector, not in the main lanes.
- Colours from `theme()` (`herdr.d.ts:265-270`): `accent` for open, `done` for resolved, `muted`/`dim` for closed, `blocked` for the blocking tag. Spinners and pulses only with `.spin`/`.loop`, never a timer (`AGENTS.md:893-902`).

### 6.3 Item states

| Status | Glyph | Meaning | Counts in chip |
|---|---|---|---|
| `open` | filled dot | needs attention | yes |
| `answered` | half dot | a reply exists (the human sent an answer, or the agent replied to a human question); waiting for the human to close it | no |
| `resolved` | check | closed by the human | no |
| `dismissed` | cross, struck | closed without action | no |
| `deferred` | clock | parked until `deferUntil` ("next session", "tomorrow", or manual) | no |

Transitions:

```
human -> agent:  open --[sent as prompt with [Q3] / staged as /btw]--> open (badge)
                 open --[stop of the turn it was sent in]--> answered --[resolve]--> resolved
agent -> human:  open --[answer typed + sent, or prompt with [A5]]--> answered --[resolve]--> resolved
any open state   --[dismiss]--> dismissed     --[defer]--> deferred --[deferUntil reached]--> open
any closed state --[reopen]--> open
```

`resolvedTurn` is the session's turn at the moment of resolve or dismiss. Closing is always the human's act; nothing closes on its own.

### 6.4 The answer sheet

Each agent ask row takes a short inline answer (an `Input`; for `decide`, clicking an option fills it). "Copy answers" builds one message, keyed by handle in the order of the asks:

```text
Answers to your asks from turn 17:
[A5] Cipher order: Mozilla intermediate, as you recommended.
[A6] Will run the Qualys rescan after the reboot tonight; carry on without it.
[A7] Yes, remove RC4.
[A4] Deferred; not needed for this change.
```

It goes to the clipboard and the agent's pane is focused (5.5 explains why not typed). "Send when idle" sends it with `hc(["send", "--if", "idle", t, text])` (`hc send --help`) after a one-line confirm. Either way the `prompt` event's `refs` then marks those items `answered`. This is the end-of-turn answer to the problem the ledger exists for: the list stays pinned, each item can be answered or questioned on its own, and the trunk receives one compact message.

### 6.5 End-of-turn surfacing

The chip lives in `my-pane`, the cloned header, which already finds its own pane (`mods/pane/main.js:25-27`) and draws status chips (`main.js:66-68`). It reads `shared("ledgr.chips")[props().terminal]` (`AGENTS.md:355-361`).

| Chip state | When | Looks like |
|---|---|---|
| hidden | no open items for the session | nothing |
| `collecting` | agent working; the human has parked questions this turn | dim `? 2`, no colour, no motion |
| `surfaced` | a `stop` event arrived and there are open items new since the last `seen` | expanded `2 parked . 3 asks`, `accent` text on a faint `accent` tint |
| `seen` | the panel was opened on this session, or the next prompt was submitted | compact `? 2 . 3` in `muted` |

Clicking the chip shows the panel on that session: `run("layout.select", {stack: "panel-body", child: "ledgr"})`, `run("layout.show", {id: "panel"})` (the my-tabs pattern, `mods/my-tabs/main.js:24-27`) and `setShared("ledgr.focus", {session})`. The panel does not open on its own, Herdr's toast is not used, and no sound plays (Herdr already toasts and chimes when an agent finishes, `herdr.d.ts:370-371`). `config.surface.openPanelOnAsks` (default false) opens the panel at Stop when new agent asks arrived and the panel is hidden.

Interrupts: Stop does not run when the user interrupts (hooks.md, "Stop"). The writer copy tracks each mapped terminal's status in `agents()` during render (side effects in render follow `mods/my-tabs/main.js:100`). A `working` to `idle` change with no `stop` event within 3 seconds marks the turn interrupted: parked human questions settle to the last known message and the chip surfaces them; no extraction runs.

### 6.6 Navigation from an item to its anchor

What Herdr can and cannot do:

| Want | Possible? | How, and the limit |
|---|---|---|
| Bring the agent's pane forward | yes | `pane.focus {terminal}` (`AGENTS.md:555`, `AGENTS.md:561-562`); `agent.focus {terminal}` also reaches sub-agents (`herdr.d.ts:66`) |
| Scroll Herdr's view of the terminal to the anchor's line | no | `terminal.scroll` takes only `lines`, `pages` or `to: "top" \| "bottom"` (`herdr.d.ts:65`; `herdr-app commands`); there is no "to line" or "to text". On the alternate screen nothing moves at all (`AGENTS.md:582-585`), and Jesse's Claude runs `tui: "fullscreen"`, whose conversation "lives in the alternate screen buffer" (fullscreen.md) |
| Search the terminal for the quote | partly | `terminal.search` opens the find bar but takes no query (`herdr-app commands` lists no arguments); it covers screen and scrollback (`AGENTS.md:515-519`, `AGENTS.md:571-572`), so in fullscreen Claude it sees only the visible screen |
| Search Claude's own transcript | yes, by keystrokes (unconfirmed) | Fullscreen Claude has transcript mode: `Ctrl+o`, then `/` to search, `Enter` to accept, `n`/`N` for next and previous, `Esc` or `q` to leave (fullscreen.md, "Search and review the conversation"). `hc keys <t> ctrl+o /` presses those keys (`hc keys --help`) |
| Show the passage | yes | The expanded row renders the anchoring turn from `turns/<sid>/<turn>.md` with the quote in bold. This is the primary navigation: the passage comes to the panel |
| Reopen an ended session | yes | `tab.new {argv: ["claude", "--resume", sid], folder: cwd}` (`herdr.d.ts:53-54`; `AGENTS.md:541-548`) |

"Go to anchor" therefore does, in order:
1. expand the row and show the passage (always);
2. `pane.focus` the agent's terminal if it is live;
3. if the agent is `idle` and the session runs fullscreen Claude: put a distinctive 20 to 40 character slice of the quote on the clipboard and run `hc(["keys", t, "ctrl+o", "/"])`, leaving Claude's transcript search open; Jesse presses Cmd-V and Enter, then `q` to return. Typing the slice with `hc send` (paste plus Enter) would make it one action, but whether a paste lands in Claude's search field is unconfirmed, so it ships behind `config.nav.autoSearch` (default false);
4. for classic-renderer and other agents: clipboard plus `terminal.search`, where the find field is pre-selected so the paste replaces it (`AGENTS.md:515-519`).

The button is disabled while the agent is `working` or `blocked`, so keystrokes never land in a permission prompt.

### 6.7 Performance rules

- Everything the panel draws comes from the store in memory; file reads happen in the ingest loop and on row expand.
- `setShared("ledgr.chips", ...)` only when a chip value changes, because it re-renders every mod.
- No animation timers. The only timer is the 60 s spool rescan.

## 7. (Removed: Things 3 feed)

Removed on 2026-11-05 (design review): the ledger does not export to Things 3, and the extractor no longer classifies asks with a queue kind. The section number is kept so later references stay valid.

## 8. Phase 2: branching from a ledger item (brief)

### 8.1 Launch

From a ledger item, "Branch" runs, through `hc(args)` (`herdr.d.ts:15-16`):

```bash
hc run --bg --json --parent t3 --outlive-parent --no-notify \
  --name br-q7-3f2a --cwd "~/Projects/app" \
  --label ledgr.branch=br_<uuid> --label ledgr.parent_session=88c36d53-35d6-4ccd-8fa6-2c260f89cc18 \
  -- claude --resume 88c36d53-35d6-4ccd-8fa6-2c260f89cc18 --fork-session -n "Q7: TLS 1.0 still flagged" "<preamble>"
```

- `--parent` must be explicit: a mod has no `HC_TERMINAL_ID` (audit Q6, Option A). Flags from `hc run --help`: `--outlive-parent` keeps the branch when the trunk's program ends; `--no-notify` stops hc typing notes into the trunk's input; `--name` is 1 to 32 characters of a-z, 0-9, `-`, `_`, unique among live terminals.
- `--fork-session` copies history, not files; the branch edits the same working tree (report, Agent SDK sessions). The preamble forbids edits.
- The fork is taken at the end of the session; no flag forks at an earlier message (`claude --help`).
- The branch session id is unknown at launch. The branch's own SessionStart hook fires with `source: "fork"` (hooks.md, "SessionStart input") in the branch terminal, whose address `hc run --json` returned; the writer joins them and sets `Branch.sessionId` and `SessionRecord.parentSessionId`. Pre-assigning with `--session-id <uuid>` alongside `--fork-session` is untested (audit Q2).
- Alternative placement, beside the trunk: `run("pane.split", {direction: "right", pane, argv: [...]})` (`AGENTS.md:553-555`); this loses the parent link in the agents tree.

### 8.2 Preamble

```text
[ledgr branch br-q7-3f2a of session 88c36d53, depth 1]
This session is a branch, opened to settle one question. Treat the conversation above as background.

Question Q7, parked at turn 14: Why does the scan still flag TLS 1.0 if SChannel has it off?
It refers to this passage of your turn-14 answer:
> TLS 1.0 is disabled in SChannel, so the scanner result is likely stale.

What you know: everything in the session up to turn 22, because this branch was copied from the end
of the session. Turns 15 to 22 came after the question was asked. Answer it as it stood at turn 14,
and say so if those later turns change the answer.
What you do not know: other branches, other parked questions, and side questions asked with /btw.

Scope: answer this question only. Do not edit files, change state or continue the main task unless
I ask. When you are done, end with:
<ledgr-conclusion>
answer: one paragraph
changes: decisions or facts the main thread should update, one per line, or none
</ledgr-conclusion>
```

### 8.3 Manifest

The `Branch` record (3.1) is the manifest. The panel shows it under the item:

```
Branch br-q7-3f2a  running  depth 1
Knows: trunk turns 1 to 22 (copied at end of session, 15:42); state as of turn 22
Does not know: trunk turns after 22; branches br-q5-91c0; parked Q3, Q5; /btw answers
Anchor: turn 14, "TLS 1.0 is disabled in SChannel, so the scanner..."
```

### 8.4 What the Herdr agents tree shows

The branch is a sub-agent of the trunk, so the shipped `agents` mod draws it under the trunk's row with connector lines (`mods/agents/main.js:175-184`), labelled with the hc `--name` (`main.js:208`: `k.name || k.template || ...`). Clicking it peeks (`main.js:203`; `terminal.peek`, `herdr.d.ts:62`), and the peek bar says "from <parent>" and offers keep (audit Q3). Sub-agents belong to the parent's tab without a pane (`AGENTS.md:154-157`). A pane-less sub-agent's `done` shows as idle (audit Q3). The tree lists only live terminals (`main.js:176`, `k.state === "live"`), so a finished branch leaves the tree; the ledger keeps it and offers "reopen" (`tab.new {argv: ["claude", "--resume", branchSid]}`).

### 8.5 Depth

`config.branch.maxDepth` defaults to 2 (trunk, branch, sub-branch), matching the observed maximum in CanvasConvo and Claude Code's rule that a fork cannot fork (report). It is a default, not a limit; raising it is a config change.

### 8.6 Phase 3 in one paragraph

On a branch whose last message has a `<ledgr-conclusion>` block, the item shows "Rejoin". Jesse edits the proposed message, `[ledgr] Q7 (asked at turn 14; answered in branch br-q7-3f2a, copied at turn 22): <answer>. Changes: <list or none>.`, and approves it. The writer delivers it with `hc send --if idle <trunk terminal>` (`hc send --help`), appended at the end of the trunk, which keeps the trunk's cached prefix intact (report). The request becomes `resolved` with `resolvedTurn`, the branch `merged`. If the trunk's turn has moved past `forkTurn` and the conclusion lists changes, the item is marked "check against the current trunk" first.

## 9. Test plan

### 9.1 `herdr-app check`

Run after every change (`AGENTS.md:54-58`, `AGENTS.md:821-828`):

```sh
herdr-app check ~/.config/herdr-app/mods/ledgr
herdr-app check ~/.config/herdr-app/mods/my-pane
herdr-app check ~/.config/herdr-app/mods/my-tabs
```

`check` loads a mod once and checks its initial description; it does not lay it out or run deferred rows or later async states (`AGENTS.md:54-58`). The panel's populated states come after async ingest, so `main.js` imports `fixtures.js` and draws the fixture store synchronously when `props().demo === true` or `FORCE_DEMO` in `config.js` is true. The build runs `check` once with `FORCE_DEMO = true` (all lanes, every status, an expanded row, an answer sheet, each chip state rendered by a demo `my-pane`), then once with it false. After layout and key edits: no `layout.error` or `keys.error` file (`AGENTS.md:51-53`), and `herdr-app status` lists no mod errors (`AGENTS.md:791-794`).

### 9.2 Hook unit test (no Claude, no Herdr window)

`bin/tests/test-hooks.sh` drives the real entry scripts in `bin/adapters/claude/` with a temp data folder and fake inputs, and never reads the real key (`LEDGR_KEYCHAIN_SERVICE` points at a service that does not exist). Its 46 checks cover the original list here (map fields, turn text, event count, `refs`, stdout, 50 parallel prompts giving 50 turns, every file parsing) plus: empty stdout by default and exactly the instruction when `instruct_block` is true; `pending`, `stop`, `asks` in that order; a repeated `prompt_id` counting once; the guards (no terminal id, `LEDGR_INNER`, `LEDGR_TERMINAL`, `vps/t7`, `--agent`, `agent_id`, `SubagentStop`, invalid stdin, invalid config); the owner guard (a live other owner blocks, `/clear` in the same process passes, a dead or reused pid releases the terminal); the no-key, block, empty-block, invalid-block and skip extractor paths; the message uuid on `stop`, `asks` and the records; `ledgr_spool` importing without Claude or provider modules; and hook timing (20 runs per hook, median under 100 ms). `bin/tests/run-all.sh` runs it with the block-parser, uuid-lookup and offline fixture tests. Results on 2026-11-05: all pass; medians 36 to 82 ms per hook under load averages of 12 to 39.

### 9.3 Manual check that the live hook writes the map

In Herdr, open two panes in one tab.

```sh
# Pane A
echo "$HC_TERMINAL_ID"                  # note it, e.g. t5
claude -n "ledgr smoke"                # then in Claude: "Reply with the word ok." and let it finish

# Pane B
T=t5; D=~/.config/herdr-app/ledgr-data
jq . "$D/terminals/$T.json"             # agent "claude-code", session_name "ledgr smoke", turn 1, state "idle"
SID=$(jq -r .session_id "$D/terminals/$T.json")
grep -l "\"sessionId\":\"$SID\"" ~/.claude/sessions/*.json     # exactly one file: the live process agrees
test -f "$(jq -r .transcript_path "$D/terminals/$T.json")" && echo transcript-ok
cat "$D/turns/$SID/1.md"                # the reply text
tail -n 5 "$D/log/hook.log"             # SessionStart, UserPromptSubmit, Stop lines for t5
```

Then, in pane A: send a second prompt and confirm `turn` 2; run `/btw hi` and confirm `turn` stays 2; run `/clear` and confirm `terminals/t5.json` now names a new `session_id` with `last_source` `clear`; ask "Give me two decisions to make" and confirm an `asks` event with two asks reaches the panel within 5 seconds (or sits in `spool/` with the panel closed). Finally ask Claude "Did any hook add context to this conversation?" in a fresh session with `instruct_block` false; the transcript should contain no ledger text.

### 9.4 Extraction fixtures

`mods/ledgr/fixtures/extract/*.md` with expected results in `*.json` (offline and live sections); `bin/adapters/claude/extract.sh --dry-run --text-file <f>` prints the parsed asks without emitting, and `bin/tests/run-extract-fixtures.py [--live NAME...]` runs them all (offline: all seven pass, 2026-11-05):

| Fixture | Expect |
|---|---|
| `tasklist.md`: a closing list of 5 steps for Jesse (portal steps, a decision with options) | 5 asks, kinds right, decide has options and `recommended` |
| `offer.md`: "Want me to also update the README?" and "I can also add an example" | 0 asks (offers are not asks) |
| `none.md`: a summary of finished work ending "let me know if you have questions" | 0 asks |
| `block.md`: prose plus a valid `ledgr-asks` block | block asks, no model call (`source: "block"`) |
| `badblock.md`: block with broken JSON | model asks, `block_error` set |
| `reask.md` with `reask.snapshot.json`: re-raises an open A2 and a dismissed A4 | two asks, `repeat_of` set to the A2 and A4 Request ids |
| `long.md`: 80,000 characters (generated by the runner) | truncation note, asks from the tail, cost under $0.003 in `usage` |

### 9.5 In-app trial

1. With the panel hidden and Claude streaming a long answer, press Cmd-J: the box appears at the top; typing does not reach Claude; the stream keeps going; Enter closes the box.
2. The chip shows a dim `? 1` while the agent works, with no motion.
3. At the end of the turn the chip expands; within 5 seconds the panel (opened from the chip) lists the agent's asks and the parked question anchored to this turn.
4. Ask a clarifying question about one ask with "Ask about this", then Cmd-Enter: `/btw ...` is on the clipboard and Claude's pane is focused; Cmd-V, Enter works mid-stream.
5. Fill the answer sheet; "Copy answers"; paste into Claude; at the end of that turn the referenced asks show `answered`.
6. "Go to anchor" on an idle fullscreen session opens Claude's transcript search; Cmd-V, Enter jumps to the passage.
7. Quit and restart Herdr: items, states and handles are unchanged.
8. Switch to the `main` layout, park a question, switch back: it is ingested.

### 9.6 Unconfirmed behaviours this design depends on

The three from the audit's gap lists (audit Q2 and Q6) that the design relies on:

| # | Behaviour | Where the design uses it | How to confirm | If it fails |
|---|---|---|---|---|
| 1 | `hc run --parent <t>` started from a mod (no `HC_TERMINAL_ID`) makes the fork a sub-agent shown under the trunk in the agents tree | Phase 2 launcher (8.1) | Run the 8.1 command from a scratch mod's button against an idle trunk; check `terminals()[].parent` and the agents sidebar | Launch from a helper shell script started in the trunk's own terminal context, or fall back to `pane.split` and keep lineage only in the ledger |
| 2 | `pane.split` with a multi-argument Claude `argv` carrying the positional prompt | Phase 2 "open beside" | `herdr-app do pane.split --direction right --argv '["claude","--resume","<sid>","--fork-session","-n","t","hello"]'` | Use `tab.new {argv, task}`, which takes the first message as `task` (`AGENTS.md:541-548`) |
| 3 | `terminals()` in the mod runtime includes `foreground` (the pid chain) | Fallback map for Claude sessions that started before the hooks were installed (no SessionStart record) | Log `terminals().find(x => x.address === t)` from a scratch mod | Show "session unknown until its next prompt"; the next `UserPromptSubmit` creates the record |

Introduced by this design and also untested:

| Behaviour | Used in | Check |
|---|---|---|
| `HC_TERMINAL_ID` in a hook equals the string `focused().terminal` and `panes()[].terminal` report for that terminal | the whole join (2.8) | 9.3 plus a scratch mod logging `focused()` |
| `mod.open:ledgr` opens the capture popup over a fullscreen Claude pane mid-stream, the `Input` takes the keyboard, and focus returns to the terminal on close | capture (5.1) | 9.5 step 1 |
| `read_from_clipboard()` is reachable from a mod's `cx`; `terminal.copy` acts on the focused pane while the popup holds the keyboard | quote capture (5.4) | scratch mod |
| Herdr ignores an unknown `ledgr-data/` folder in its home | data layout (2.2) | create it, restart Herdr, check `herdr-app status` |
| Whether two copies of one mod share `localStorage`, and whether it survives a block edit | store (3.2) | inspect `data/ledgr/` after opening the capture popup and after editing the block |
| `hc keys <t> ctrl+o /` opens transcript search in fullscreen Claude; a pasted query lands in the search field | navigation (6.6) | 9.5 step 6 |
| `claude -p --setting-sources local` skips user-level hooks; where `--output-format json` puts the structured result | CLI fallback (4.7) | run once with a hook that logs |
| Claude Haiku 5.5 accepts `thinking: {type: "disabled"}` with `output_config.format` | extraction (4.4) | one curl call; else drop `thinking` and keep effort `low` |
| `--session-id` together with `--resume --fork-session`; `--resume` across folders | Phase 2 (8.1) | one launch each |

## 10. Open questions, with recommended defaults

| # | Question | Default |
|---|---|---|
| Q1 | Which credential pays for extraction: a personal API key in the Keychain, or the Max subscription through `claude -p`? | API key in the Keychain (service `ledgr`, account `anthropic`); `claude -p` is the `cli` provider and an opt-in fallback (`cli_fallback`, default false). Faster start, no hook recursion, about $1.50 a month |
| Q2 | Tell Claude to emit the `ledgr-asks` block through the SessionStart hook? It adds about 150 tokens of context per session, a visible code block on turns that ask something, and trunk-model output cost | Off, `audit_rate` 0 (design review 2026-11-05). The model path covers every turn; turn the block on to save model calls |
| Q3 | Ledger as a fourth child of the `panel-body` stack, or its own column so it can sit beside Files or Changes? | Stack child. It is read at the end of a turn, when switching away from Files costs little; revisit after two weeks |
| Q4 | Open the panel automatically at Stop when new agent asks arrive? | No. The chip expands; the panel opens on click |
| Q5 | Type `/btw` into Claude automatically on Cmd-Enter? | No. Clipboard and focus; `btw.autoSend` exists for people who never keep drafts |
| Q6 | (Removed with the Things feed, Section 7) | |
| Q7 | How long do closed items stay in the store? | 14 days, then `archive/<yyyy-mm>.jsonl` |
| Q8 | Number turns from the transcript for sessions that started before the hooks? | No. Start at 0 (`turn_base: "ledgr"`); numbering is a reading aid |
| Q9 | Extract asks from subagent replies (`SubagentStop`)? | No. Only the main agent speaks to Jesse |
| Q10 | Ever give parked human questions to the model ("address these in passing")? | Never automatically; only through the answer sheet or a prompt Jesse sends |
| Q11 | Global ledger (follows the focused agent across spaces) or per space? | Global, like Quota; pin to hold one session |
| Q12 | Keys | `cmd-j` capture, `cmd-shift-j` panel; both unbound today |
| Q13 | Where the hook scripts live | `mods/ledgr/bin/`, so the mod is one shareable folder; a RECIPE.md must disclose that it runs `exec` and `hc`, reads `~/.claude`, and calls the Anthropic API (`AGENTS.md:427-429`) |
| Q14 | "Go to anchor" fully automatic (paste the query into Claude's search)? | Off until 9.6 confirms the paste lands; semi-automatic meanwhile |
| Q15 | Phase 2 depth cap | 2, configurable |

## Appendix A: build inventory (Phase 1)

| Path | New or edited | Purpose |
|---|---|---|
| `mods/ledgr/mod.json` | new | overlay spec (5.1) |
| `mods/ledgr/main.js` | new | routes on props: panel, capture, demo |
| `mods/ledgr/store.js` | new | load and save `localStorage`, apply events, de-duplication, archive, snapshot, backup |
| `mods/ledgr/spool.js` | new | startup scan, `watchFolder` loop, parse retry, `unlink` |
| `mods/ledgr/panel.js`, `capture.js`, `nav.js` | new | Sections 6, 5, 6.6 |
| `mods/ledgr/config.js`, `fixtures.js`, `fixtures/extract/*` | new | settings defaults, demo data, extraction fixtures |
| `mods/ledgr/bin/lib/`, `bin/providers/`, `bin/adapters/claude/`, `bin/tests/` | new | core, providers, Claude Code adapter, tests (2.2; `bin/BUILD-NOTES-hooks.md`) |
| `mods/my-pane/` | clone of `pane`, edited | chip (6.5) |
| `mods/my-tabs/main.js` | edited | Ledger button, `toggle-ledgr`, global handling in `syncPanel` (6.1) |
| `layouts/custom.json` | edited | header points at `my-pane`; `ledgr` block in `panel-body` (6.1) |
| `keys.json` | edited | `cmd-j`, `cmd-shift-j`, `mod:ledgr` section |
| `~/.claude/settings.json` | edited 2026-11-05; backup in `~/.local/state/ledgr/backup-20261105/` | three hook entries (2.4) |
| `ledgr-data/` | created at first hook run | data (2.2) |

## Appendix B: `ledgr-data/config.json` defaults

```json
{
  "v": 1,
  "instruct_block": false,
  "extract": { "mode": "block-first", "provider": "anthropic", "model": "claude-haiku-5-5", "base_url": null,
               "audit_rate": 0, "cli_fallback": false, "max_chars": 60000, "timeout_s": 20 },
  "surface": { "openPanelOnAsks": false },
  "btw": { "autoSend": false },
  "nav": { "autoSearch": false },
  "branch": { "maxDepth": 2 },
  "retention_days": 14
}
```

The hooks create the file with these values at their first run and never overwrite it; a missing or invalid file means these defaults.

## 11. Build notes: hooks half (2026-11-05)

Where the built hooks, map, spool writer and extractor depart from the text above, and why. The file list, test commands and manual steps are in `mods/ledgr/bin/BUILD-NOTES-hooks.md`.

| Topic | Built | Why |
|---|---|---|
| Name | `ledgr` for the mod, data folder, Keychain service, block tag, env vars; this spec's identifiers follow | Jesse's naming |
| Language | Python 3 standard library behind thin bash entries; system `curl` and `security` | No Homebrew `jq` on the machine; real `flock`; one process per hook; no Node |
| Layout | `bin/lib` core (spool writer importable alone, for a later MCP stdio server), `bin/providers`, `bin/adapters/claude` | Jesse's direction: core plus adapters |
| Hook entries | Three: `session-start.sh`, `user-prompt-submit.sh`, `stop.sh`; `stop.sh` detaches part B itself; SessionEnd entry exists, not registered | One entry per event; detaching survives the hook and `claude -p` teardown |
| Guards | `LEDGR_INNER` on every spawned process and checked by every hook; main conversation only; owner pid in the map entry | Design review |
| Events | `pending` added; `stop` from part B carries `message_uuid`; `settle` removed; `asks` ordered after `stop` | Design review; the mod attaches the uuid to items parked during the turn |
| Anchors | `turn` and a 12-hex sha1 passage hash always; uuid optional | Non-Claude agents have no transcript uuid |
| Writes | Temp + rename; idempotent per event (`prompt_id`); `flock` instead of the `mkdir` lock | Design review; a stale-breaking `mkdir` lock is not exclusive |
| Extraction | Non-empty block only; prompt keeps only asks that need the user; open and recently dismissed asks listed; `repeat_of`; no `queue_kind` | Design review |
| Providers | `anthropic`, `openai-compatible`, `cli` behind one signature; Keychain account = provider name; shared validator | Jesse's direction |
| Defaults | `instruct_block` false, `audit_rate` 0, `cli_fallback` false (and `cli` built, untested), no `things` | Design review; no subscription calls without opting in |
| Request | `max_tokens` 4000 (spec 2000); nullable schema fields as `anyOf` | Room for 20 asks with quotes; `anyOf` is listed as supported |
| Things 3 | Removed (Section 7) | Design review |

Status on 2026-11-05: all offline tests pass (block parser 22, uuid lookup 10, fixtures 7, hooks 46). A simulation with a real transcript resolved the message uuid and produced `pending`, `stop` and `asks` (`no credential`). The live Haiku call has not run: the Keychain item was saved with account `anthripic`, so the read for account `anthropic` fails. Confirmed live after the settings edit: running sessions loaded the hooks at once, the owner pid is the claude process (t3 -> 4817, t2 -> 60575), and the uuid lookup resolves on real Stop events. Still unconfirmed: the `cli` and `openai-compatible` providers against a live endpoint.

### Phase 2: branch launcher, lineage and manifest (2026-11-05)

Built on Herdr 0.1.13, hc 0.1.18, Claude Code 2.1.311. Files, the live test and the open items are in `mods/ledgr/BUILD-NOTES-phase2.md`. Where the build departs from Section 8 and the Phase 2 brief:

| Topic | Built | Why |
|---|---|---|
| Launch path | The panel's Launch posts a `branch` spool event; the writer records the Branch (manifest frozen) and runs `hc run --bg --json --parent <t> --outlive-parent --no-notify --name br-<handle>-<4 hex> --cwd <cwd> --label ledgr.* -- /usr/bin/env LEDGR_PARENT=… LEDGR_BRANCH=… claude --resume <sid> --fork-session --session-id <uuid> -n <label> <preamble>` | One writer owns `store.json`; the depth cap is re-checked against the current `config.json` |
| Placement (8.1) | Sub-agent of the trunk, then `terminal.keep {place: "right"}` once the app sees the terminal; or sub-agent only; or Herdr's worktree dialog | `pane.split` carries a multi-argument argv intact but records no hc parent; keep gives a pane beside the trunk and keeps the parent link. A keep sent at once after `hc run` does nothing, so the writer waits |
| Session id (8.1) | Pre-assigned with `--session-id`; `branch_started` confirms it | `--session-id` works together with `--resume --fork-session` (tested in `-p` and interactive) |
| Lineage | `LEDGR_PARENT=<sid>:<item>:<anchor turn>` plus `LEDGR_BRANCH=<branch id>:<depth>:<fork turn>:<child sid>`; the child's SessionStart (`source: "fork"`) records both in its session record and map entry and emits `branch_started` | The child id lets the hook ignore a later `/branch` or `/clear` in the same process |
| Compaction | SessionStart `source: "compact"` appends `{turn, at}` to the record's `compactions` and emits `compacted`; the manifest and preamble say when the parent was compacted at or after the anchor | Confirmed with a real `/compact` (same session id). A fork taken after it opens at the compaction summary, which settles the open question in the branching report |
| Preamble (8.2) | Quote, question, "copied from the end of the session at turn F while the question was parked at turn A, so turns A+1..F are included", answer in the anchor's context and say if later turns change it, no file edits, a fenced `ledgr-conclusion` block (`answer:`, `changes:`); about 180 words plus the quote | The brief; 8.2's XML tags replaced by a fenced block |
| Manifest (8.3) | Parent, depth of `branch.maxDepth`, anchor and fork turns with the count beyond the anchor, compaction after the anchor, shared checkout, cache window note, not-known list; shown on the confirmation before launch and frozen on the Branch record | The brief |
| Depth (8.5) | `branch.maxDepth` honoured as configured (0 disables); refused on the confirmation and by the writer | Confirmed: depth 3 refused at the default 2, depth 2 launched |
| Worktrees | `--resume <sid> --fork-session` works from a fresh worktree of the same repo and from an unrelated folder, so "isolate in a worktree" is offered (Herdr's worktree dialog: new checkout from HEAD, new space, no hc parent) | Not exercised live: it writes `~/.herdr/worktrees/` |
| Panel (6.2) | A BRANCHES section under each session's questions: live status from Herdr, the manifest, the branch's own items, its conclusion, Focus, Conclude disabled ("Phase 3"); a branch badge on the question; branch sessions nested under their parent in the session menu; Forget for sessions whose terminal is gone | The brief; Forget so test data leaves through the panel's own events |
| Branch record (3.1) | Adds `childSid`, `manifest`, `preamble`, `placement`, `isolate`, `error`, `note`; status `launching`, `launched`, `running`, `refused`, `failed` | Phase 3 adds concluded and merged |
| Not built | Reopen of a closed branch; branching from agent asks | Outside the brief |

Status on 2026-11-05: offline tests pass (hooks 59, store 162); `herdr-app check` passes for `ledgr` (also with `FORCE_DEMO`), `my-tabs`, `my-pane`. Live, on a scratch Haiku session only: three branches launched from the mod (one beside the trunk, one at depth 2 beside its parent, one pane-less after a real `/compact`), each nested under its parent in the agents sidebar, each child's first turn answered with a conclusion block, and a depth-3 request refused. Test data was removed through a `forget` event.

### Phase 3: confluence and answer-sheet landing (2026-11-05)

Built on Herdr 0.1.13, hc 0.1.18, Claude Code 2.1.311. Files, the live test and the open items are in `mods/ledgr/BUILD-NOTES-phase3.md`. Where the build departs from Sections 1 (Phase 3), 6.4 and 8.6:

| Topic | Built | Why |
|---|---|---|
| Delivery (8.6, 6.4) | Clipboard plus focus of the trunk's pane; the person pastes and presses Enter. No `hc send --if idle`, no "Send when idle" | The Grok critique and the brief: a send or a paste joins a draft already in the prompt. ledgr never types into a terminal |
| Landing | The trunk's Claude UserPromptSubmit hook reads the submitted prompt; a marker line `ledgr confluence <branch id> <item id>` emits `confluence_landed`, `ledgr answers <session id>` emits `answers_landed`, after the turn's `prompt` event. The marker counts as the first line of any pasted block, or unwrapped as the prompt's first line or second after a one-line lead-in; not inside a code fence or mid-paragraph. Anything else is untouched; the hook prints nothing | Only the hook can tell the message was actually sent. Claude Code wraps pastes in `<pasted_content id="…">` lines (confirmed live) and presents them as possibly not the person's words, so the panel suggests typing a lead-in ("Adopt this branch result for Q1:") before pasting |
| Conclude (8.6 "Rejoin") | Conclude… on a branch row opens an editor prefilled with the newest `ledgr-conclusion` block of the branch's last 10 turns, else its last message, else empty; "Ask for a conclusion" stages a short request in the branch's pane. The editor shows the message as it will be staged and the trunk's live status | The brief. Status informs; it does not block |
| Message (8.6) | Five parts: the marker line, `Parked question Q1, from turn A: <question>`, `Conclusion:`, the edited text, and one line in the person's voice: "I am adopting this branch's conclusion as the answer to Q1; the branch (br-q1-…, a fork of this conversation) saw the trunk through turn F." Under 200 words besides the conclusion | Replaces 8.6's one-line `[ledgr] Q7 (…): <answer>`; the marker makes the landing detectable; an assertion, not an instruction, because the model sees pasted text as possibly not the person's |
| States (3.1) | Send to trunk: branch `concluded`, question `rejoin_pending`. Landing: question `resolved` with `resolvedBy: "branch"`, `resolvedTurn`, `resolution`; branch `rejoined` with `rejoinedTurn`. Call off returns both | The brief; the research's `merged` is `rejoined` here |
| Decisions | One line per landed confluence in `ledgr-data/sessions/<trunk sid>/decisions.md` (date, turn, question, the conclusion's first line, branch name and id), once per branch | The research's optional per-session state file, kept as an append-only list |
| Staleness (8.6) | When the trunk's turn is past F, the editor says so; the message states F | No blocking mark: the person decides |
| Answer sheet (6.4) | `ledgr answers <sid>`, `Answers to your asks from turn N:`, then `A5: <answer>` lines; `answers_landed` marks those asks `answered` (`answeredBy: "sheet"`). A sheet naming another session is ignored | The brief; the second line keeps the model oriented |
| Close | After rejoin only: Close branch (two clicks) makes the writer run `hc kill` and `hc rm` on the branch terminal; the record and conclusion stay. Branches that end on their own are still read from Herdr status | The brief |
| Engine | `mods/ledgr/confluence.js` (message composers, decisions line) joins `ENGINE_FILES`; `bin/lib/ledgr_landing.py` parses the markers; a test checks the two agree | Pure, shared by store, writer and panel |
| Not built | Send when idle, cherry-pick, mid-history insertion, a state document with diffs, reopen of a closed branch | Section 1's "Not in Phase 3", and the brief |

Status on 2026-11-05: offline tests pass (hooks 78, store 249, the landing parser on both composed messages; the lead-in rule and the closing line's wording were refined after the live run and tested offline); `herdr-app check` passes for `ledgr` (also with `FORCE_DEMO`), `my-tabs`, `my-pane`. Live, on a scratch Haiku trunk and branch only: the branch's block prefilled Conclude, an edit was appended, Send to trunk staged the message and focused the trunk without typing, the simulated paste landed (`confluence_landed`, Q1 resolved by the branch, branch rejoined, one decisions.md line; a second paste wrote no second line), Close branch ended the branch terminal and kept the record, and an answer sheet marked two Haiku-extracted asks answered. Test data was removed through a `forget` event.
