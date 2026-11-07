# ledgr MCP server

`ledgr_mcp.py` is a stdio MCP server, the third spool producer after the hooks and the capture box.
With it, an agent declares its asks by calling a tool instead of printing a fenced `ledgr-asks`
block. The server checks the items with the shared validator (`lib/ledgr_asks.py`), marks repeats
against `snapshot.json` the way the extractor does (`lib/ledgr_extract.recorded_asks`), and writes one
`asks` spool event with `source: "tool"` through `lib/ledgr_spool.py`. It uses the Python standard
library only and runs on Python 3.9 or newer. It never writes into the mod folder (no bytecode; the log
and its state live in `ledgr-data`).

| Tool (Claude Code name) | What it does |
|---|---|
| `declare_asks(items)` (`mcp__ledgr__declare_asks`) | records this turn's blocking and needed items and returns their handles, the repeats, the rejected items with reasons, and the pointer line |
| `resolve_asks(handles, note?)` (`mcp__ledgr__resolve_asks`) | closes the asks the user answered or made moot in their latest message, by handle, and reports which were closed, already closed or unknown |
| `open_asks()` (`mcp__ledgr__open_asks`) | this session's open asks and the ones dismissed in the last 7 days, with handles (`A7`) |
| `parked_questions()` (`mcp__ledgr__parked_questions`) | the user's parked questions that are released to the agent (see "Parked questions") |

## Register it (for the installer)

Register it once per Claude config folder that gets the hooks, which is the same list as the answers
key `claude_settings`. Claude Code keeps user-scope servers in `<config folder>/.claude.json`:
`~/.claude.json` for the default folder, and `~/.claude-work/.claude.json` when
`CLAUDE_CONFIG_DIR=~/.claude-work`. For each folder, use the installed path (never the repo) and the
same `python3` the hooks use (`setup/ledgr_setup.py` finds it: `LEDGR_PYTHON`, then
`/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, `/usr/bin/python3`):

```sh
# default config folder (~/.claude): run without CLAUDE_CONFIG_DIR
claude mcp add --scope user --transport stdio ledgr -- /opt/homebrew/bin/python3 -I -B /Users/<you>/.config/herdr-app/mods/ledgr/bin/mcp/ledgr_mcp.py
# every other chosen config folder, for example ~/.claude-work
CLAUDE_CONFIG_DIR=/Users/<you>/.claude-work claude mcp add --scope user --transport stdio ledgr -- /opt/homebrew/bin/python3 -I -B /Users/<you>/.config/herdr-app/mods/ledgr/bin/mcp/ledgr_mcp.py
```

- `--` separates Claude's own options from the server command. `-I -B` go to python: isolated mode,
  and no bytecode. The server also turns bytecode off itself.
- Idempotent re-install: check first with `claude mcp get ledgr` (with the same `CLAUDE_CONFIG_DIR`).
  When the entry exists with another command or path, run `claude mcp remove --scope user ledgr`
  first, then add it again.
- Uninstall: `claude mcp remove --scope user ledgr`, once per config folder.
- No `-e` is needed. The server finds `ledgr-data` the way the hooks do (`LEDGR_DATA`, else beside the
  mods folder it is installed in, else `~/.config/herdr-app/ledgr-data`). It gets `HC_TERMINAL_ID` by
  inheriting the agent's environment; see "Identity".
- If the installer edits `.claude.json` itself (with its backup) instead of running the CLI, this is
  the equivalent entry under the top-level `mcpServers`:

  ```json
  "ledgr": {"type": "stdio", "command": "/opt/homebrew/bin/python3",
            "args": ["-I", "-B", "/Users/<you>/.config/herdr-app/mods/ledgr/bin/mcp/ledgr_mcp.py"], "env": {}}
  ```

- A running session does not pick up a newly added server until it restarts (or `/mcp` reconnects
  it). `--check` can run `claude mcp get ledgr` per folder to report it.
- `declare_asks` and `resolve_asks` set `_meta["anthropic/alwaysLoad"]: true`, so Claude Code loads
  them upfront instead of behind tool search: both are called at the moment a reply is being written,
  when a search would be skipped. `open_asks` and `parked_questions` stay deferred. A user who sets
  `"alwaysLoad": false` on the server entry defers all four.

### Permission entries

So that a call never prompts, add these to `permissions.allow` in every settings file the installer
hooks (the same `claude_settings` list), idempotently, with the usual backup:

```json
"permissions": { "allow": ["mcp__ledgr__declare_asks", "mcp__ledgr__open_asks", "mcp__ledgr__parked_questions",
                           "mcp__ledgr__resolve_asks"] }
```

`"mcp__ledgr__*"` covers the same four tools, and any tool added later. The explicit names are
narrower. Uninstall removes exactly these entries. `mcp__ledgr__resolve_asks` came after the first
three: a settings file from an earlier install lacks it, so `resolve_asks` would prompt. `--check`
reports such a file ("the server is registered, but calls to mcp__ledgr__resolve_asks would
prompt"), and running `./install.sh` again with `--mcp on` appends the entry and leaves the rest
alone. A running session sees the new tool after `/mcp` reconnects the server, or a restart.

## Identity

The server reads `HC_TERMINAL_ID` (else `LEDGR_TERMINAL`) and `CLAUDE_CONFIG_DIR` at start, and its
own ancestry from one `ps` call. Claude Code passes its environment to stdio servers, so a Claude Code
started in a Herdr pane hands the server its terminal id. At every call, not only at start (the
SessionStart hook may map the session after the server started, and `/clear` changes it), the server
reads `terminals/<t>.json`:

- When the entry's `owner_pid` (the agent process the hooks recorded) is one of the server's
  ancestors, the server uses that `session_id`, its `turn` and `prompt_id`.
- When that process is alive but is not our agent, or a nearer ancestor runs the same program (a child
  `claude -p` run from the agent's shell inherits `HC_TERMINAL_ID` and starts its own copy of this
  server), the call is refused and nothing is written.
- When there is no entry, or the recorded process is gone, or there is no pid to compare and the
  entry names another config folder than our `CLAUDE_CONFIG_DIR`, the server uses the terminal's
  synthetic session `herdr:<t>`, the same id the capture box uses. The turn comes from that session in
  `store.json`, else 0. The tool result says so.
- With no terminal id, or with `LEDGR_INNER` set (a process a ledgr hook started, such as the `cli`
  provider's `claude -p`), `tools/list` is empty and the server gives no instructions. A Claude Code
  outside Herdr sees no ledgr tools.

## Disabled spaces

ledgr can be off per Herdr space (`config.json` `spaces.disabled`, written by the panel's session
menu). The server asks, at every call, after the identity check: the session is off when its record
(`sessions/<sid>.json`) has `ledgr_off: true` (the hooks set it at the prompt that finds the space
disabled, so a turn that began off stays off) or its `space` is in `spaces.disabled` (a missing key is
`[]`). The space is the record's, else the map entry's; a synthetic `herdr:<t>` session with none
recorded gets one live `hc get` (`ledgr_map.herdr_space`, 0.3 s at most), the lookup the panel makes
for it. When off, every tool answers `ok: true` and `off: true` with its usual fields empty, and writes
nothing: no spool event, no `mcp/<session>/<turn>.json`. `declare_asks` returns `pointer: null`,
`items: []`, `handles: []` and the note `ledgr is off in this space: declared nothing; list what you
need from the user in your reply`; `resolve_asks` closes nothing (`resolved`, `unknown`,
`already_closed` empty); `open_asks` and `parked_questions` list nothing. Each such call logs one
`off <tool> <sid> turn=… space=… by=ledgr_off|spaces.disabled` line. The tools stay listed (a space can
be switched on mid-session), and the server's `instructions` end with: when a ledgr tool answers
`off: true`, list what you need from the user in your reply instead.

## declare_asks

Input: `{"items": [{level, kind, text, quote?, options?, recommended?, repeat_of?}]}`. This is the
ledgr-asks item schema. `level` is `blocking` or `needed`; an `optional` item is accepted the way the
validator accepts it, kept as a suggestion and not counted. `kind` is one of decide, confirm, do,
provide, review. `repeat_of` takes a handle from `open_asks`. There are at most 20 items.

- Every item goes through `ledgr_asks.validate`. Items rejected with a reason: not an object, empty
  text, an unknown level, the same text as an earlier item, and anything past 20. The rest is
  recorded. When every item is rejected, the result is `isError` and nothing is written.
- Quotes cannot be checked when the tool is called, because the reply is not finished. They are kept
  as given (`quote_verified: false`), and the event says `quotes: "unverified"`. The Stop hook checks
  them (below).
- Repeats: `recorded_asks(sid)` from the extractor gives this session's open and recently dismissed
  asks. A `repeat_of` handle is kept only if it is one of them. An item whose text normalises
  (`ledgr_asks.norm_key`, the same as `store.js` `norm()`) to an open or dismissed ask's text is marked
  as its repeat too. An open ask wins over a dismissed one. Asks created in the current turn are left
  out, because they come from an earlier call in this turn.
- The pointer line uses the same wording as `lib/asks-instruction-ledgr.txt`: `ledgr: N items for
  you, M blocking`, singular `1 item`, and no `, 0 blocking`. N counts the items at or above
  `extract.threshold`, which is what the chip counts. With `asks.handoff` set to `both`, the result
  says to list the items in prose as usual and still end with the line. Otherwise it says to list
  nothing in prose and write no block.
- Handles are assigned by the writer, not here. After emitting, the server waits up to
  `LEDGR_MCP_WAIT_MS` (default 2500) for its spool file to disappear. The writer unlinks a file only
  after saving `store.json` and `snapshot.json`. The server then reads the handles from
  `snapshot.json` by normalised text, preferring this turn's anchor. If the writer is not running
  (any spool file older than 5 s), the server does not wait, and the handles come back null and are
  reported as pending.
- The turn's declaration is kept in `ledgr-data/mcp/<session>/<turn>.json` (the last 50 turns per
  session): `{v, session_id, terminal, turn, calls, event_ids, synthetic, pointer, asks, handles}`.
  `asks` holds the asks exactly as the last event sent them, every field included: `text`, `kind`,
  `level`, `options`, `recommended`, `blocking`, `quote`, `repeat_of`, `repeat_of_handle`, `hash`,
  `origin`, `quote_verified`, and on a repeat `repeat_status` and `repeat_match`. The Stop hook can
  re-validate and re-emit them without reading `snapshot.json`.

The event (`ledgr_spool.asks`, so the envelope and the order rules are the usual ones):

```json
{"v": 1, "id": "<uuid>", "type": "asks", "at": 1793993068292, "terminal": "t5", "session_id": "<sid>",
 "turn": 14, "prompt_id": "<from the map>", "message_uuid": null, "api_message_id": null, "passage_hash": null,
 "source": "tool", "asks": [{"text": "Choose the retry policy", "kind": "decide", "level": "blocking",
   "options": ["fast", "safe"], "recommended": "safe", "blocking": true, "quote": "I stopped here.",
   "repeat_of": null, "repeat_of_handle": null, "hash": "111b4f0d27af", "origin": "tool", "quote_verified": false}],
 "model": null, "provider": "mcp", "usage": null, "ms": 3, "error": null, "block_error": null,
 "extract_request_id": null, "replaces_turn": false, "tool_call": 1, "quotes": "unverified",
 "synthetic": false, "client": {"name": "claude-code", "version": "…"},
 "rejected": ["ask 2: unknown level 'urgent' (use blocking or needed)"]}
```

`rejected` is present only when items were rejected. `agent` (the MCP client's name) is present only
when the event creates a synthetic session that `store.json` does not have yet. An ask that repeats a
recorded one also carries `repeat_status` (that ask's status: open, answered, deferred or dismissed)
and `repeat_match` (`handle` or `text`), for information only.

A second call in the same turn writes a new event with `replaces_turn: true` and `tool_call: 2`. Its
asks are the turn's whole list. An explicit empty list in a later call of the same turn writes an
event with `asks: []` and `replaces_turn: true`, which clears the turn. An empty list in a turn with no
earlier call writes nothing.

## resolve_asks

Input: `{"handles": ["A4", …], "note"?: "one line"}`. A handle is matched the way `store.js`
`byHandle` matches it (brackets and spaces dropped, upper case, so `[a4]` is `A4`); duplicates count
once, and at most 30 are read. A single string, or the array sent as JSON text, is read as the list.

- The map is the one `open_asks` shows: this session's agent asks (`direction: "agent_to_human"`,
  `anchor.sessionId` the resolved session) in `snapshot.json`, by `handle`. The session comes from
  the same identity rule as the other tools, so a child agent is refused and an unmapped terminal
  uses `herdr:<t>`.
- An ask whose status is `open`, `deferred` or `answered` is closed: one `act` spool event each,
  through `ledgr_spool.act`. An ask already `resolved` or `dismissed` (`store.js` `isClosed`) is
  reported in `already_closed` with no event. A handle that is not an ask of this session (another
  session's, a typo, a parked question `Q3`) is reported in `unknown`, with a note for a `Q` handle.
  Neither is an error: the result is `isError` only when `handles` is not an array of strings, `note`
  is not a string, or the identity check refuses the call.
- `note` is squashed to one line and cut at 200 characters. It goes on each event only when given.
- The server then waits for the writer the way `declare_asks` does (`LEDGR_MCP_WAIT_MS`, no wait when
  the spool holds a file older than 5 s) and says `writer`: `applied`, `timeout` or `idle` (null when
  nothing was sent). Unless it is `applied`, the text says the panel shows the asks closed once the
  writer applies them.
- One `mcp.log` line per call: `resolve <sid> turn=… resolved=[…] already_closed=[…] unknown=[…]
  note=yes|no events=N writer=…`.

The result: `{ok, session_id, turn, synthetic, resolved: ["A4"], unknown: ["A99"], already_closed:
["A3"], event_ids, writer, [notes], [note]}`, and a text such as `ledgr closed A4 as resolved by the
agent (turn 12); the user can reopen any of them in the panel.`

The event, one per closed ask (`turn` is null on a synthetic session the store does not have yet):

```json
{"v": 1, "id": "<uuid>", "type": "act", "at": 1794001021161, "terminal": "t5", "session_id": "<sid>",
 "item": "rq_…", "action": "resolve", "arg": null, "actor": "agent", "handle": "A4", "turn": 12,
 "note": "The user picked safe."}
```

The writer applies it like the panel's Done (`on_act`, which checks that the item belongs to the
event's session) and, because `actor` is `"agent"`, sets `resolvedBy: "agent"` on the item, so the
panel can say who closed it. The panel stays the person's override: Done closes an ask whatever the
agent did, and Reopen brings back one the agent closed, which `open_asks` then lists as open again.

## For the writer's maintainer (store.js)

The writer applies a `source: "tool"` event like a block event. `on_asks` handles it today without a
change, with three gaps (the fourth item is `resolve_asks`'s `act`):

1. **Origin.** `on_asks` sets `origin = ev.source === "block" ? "extract_block" : "extract_model"`
   and `quoteSource` the same way, so tool asks are labelled as model asks today. Proposed:
   `origin = ev.source === "tool" ? "tool" : …`, and `quoteSource: "tool"`, or `"tool_unverified"`
   while `a.quote_verified === false`.
2. **`replaces_turn: true`.** Before applying the list, drop the asks of this session and turn that an
   earlier tool event created (origin `tool`, `createdTurn === turn`) whose normalised text is not in
   the new list and that the person has not touched (still `open`, not promoted, no answer). Then
   apply the list as usual. The existing match on turn, hash and `norm(text)`, then by key, keeps the
   handle of an item that is still there, so `A10` stays `A10`. An ask the earlier call updated in
   place (a repeat of an older open ask) is not dropped. Without this, re-declared items still
   de-duplicate by text, but an item the agent withdrew stays open. `tests/test_mcp.py` (`FakeWriter`)
   implements exactly this rule.
3. **`ti.asks`.** The Stop hook's own `asks` event for the same turn overwrites the turn record. If it
   re-emits the tool asks (below), the record stays truthful.
4. **`act` from the agent.** `resolve_asks` writes the panel's `act` event with three more fields:
   `actor: "agent"`, `handle` and `turn` (and `note` when given). `on_act` already resolves the item;
   with `actor === "agent"` it also sets `resolvedBy: "agent"`. `tests/test_mcp.py` (`FakeWriter`)
   implements that.

Ordering is unchanged. A tool event's `<ms>` file name is later than the turn's `prompt` and earlier
than its `pending`, `stop` and final `asks`. `on_stop` already puts the message uuid on every item
anchored to the turn that has none, tool asks included.

## The Stop hook (for the hook and extractor maintainer)

The agent calls `declare_asks`, then ends its reply with the pointer line and no block. At Stop the
extractor therefore sees a reply with a pointer and no block. Without a change it calls the model,
which may re-extract the same asks with other wording, and it may set `reinject_pending` for a
blocking ask. Proposed, in `claude_extract.hook_mode` (agent-neutral, so better in `ledgr_extract`):

- If `ledgr-data/mcp/<session>/<turn>.json` exists for this session and turn (the file name replaces
  every character outside `A-Za-z0-9._-` with `_`), the turn was declared by tool. Treat it like a
  valid non-empty block: no model call, no re-injection.
- Re-validate its `asks` with `ledgr_asks.validate(asks, <the turn's assistant text>, "tool", known)`.
  This checks the quotes. Emit them as the turn's `asks` event with `source: "tool"`,
  `replaces_turn: true` and the resolved `message_uuid`. A quote that does not verify is dropped, as
  it is for a block.
- Check quotes against the whole turn's assistant text. `last_assistant_message` is only the text
  after the last tool call, and the agent may have written the quoted sentence before calling
  `declare_asks`.
- If a reply has both a block and a tool declaration, the block should win, since it is the newer
  statement in the reply.

## Instruction text (for its maintainer)

When this server is registered, the SessionStart instruction can say: "If the ledgr `declare_asks`
tool is available, call it instead of writing the block, then end the reply with the pointer line it
returns." The server's own `instructions` field says the same for clients that show it. Both
`lib/asks-instruction-ledgr.txt` and `-both.txt` end with the `resolve_asks` line: "When the user's
message answers or drops an open ask (open_asks lists them with handles such as A4), call
resolve_asks with those handles before declaring anything new." The server's `instructions` carries
the same clause. A running session gets the new line at its next SessionStart (a new session,
`/clear`, resume or compact); the hooks print a wording again only when the mode changes.

## Parked questions

The store has no release flag yet. `parked_questions()` returns `[]` with a note until one exists, and
needs no change once it does. The expected shape, on a human item (`direction: "human_to_agent"`):

- `releasedToAgent: true` and `releasedAt: <ms>`, set and cleared by the panel through the usual act
  event: `{type: "act", session_id, item, action: "release" | "withhold"}`.
- `snapshot.json` copies items whole, so the flag reaches the server without a writer change.
- Listed: this session's released questions with status `open` or `deferred`, as `{handle, text, kind,
  turn, quote, released_at}`.

## Other agents

Any MCP client works. Identity needs `HC_TERMINAL_ID` in the server's environment, which an agent
started in a Herdr pane passes on if its client hands its environment to stdio servers. Outside
Herdr, `LEDGR_TERMINAL=<name>` stands in. Without a hook adapter mapping the terminal, the asks go to
the synthetic session `herdr:<t>`. The panel shows that session and its turns follow Herdr's agent
status, but no turn text exists, so quotes stay unverified. Codex
(`~/.codex/config.toml` `[mcp_servers.ledgr] command = "/opt/homebrew/bin/python3"`, `args = ["-I",
"-B", "<abs>/ledgr_mcp.py"]`) and Gemini CLI (`mcpServers` in `settings.json`) register it the same
way. Both are unverified. A client that strips the environment (Claude Code with
`CLAUDE_CODE_MCP_ALLOWLIST_ENV=1`) leaves the server with no terminal id, so no tools appear.

## Protocol

Newline-delimited JSON-RPC 2.0. The server supports both protocol eras, because Claude Code's v2 MCP
runtime first probes stdio servers for revision 2026-07-28, and the v1 runtime (`MCP_SDK_GENERATION=v1`,
`MCP_PROTOCOL_NEGOTIATION=legacy`) uses the older handshake:

- Legacy: `initialize` answers the requested version when it is 2025-11-25, 2025-06-18, 2025-03-26 or
  2024-11-05, and otherwise answers 2025-11-25. Then `notifications/initialized` and `ping`.
- 2026-07-28: `server/discover`. Every request carries `_meta` `io.modelcontextprotocol/protocolVersion`
  and `clientCapabilities`; a missing `clientCapabilities` is -32602. Results carry `resultType:
  "complete"` and `serverInfo` in `_meta`. An unknown version is -32022 with `{supported, requested}`.
- Both: `tools/list` and `tools/call`. An unknown method is -32601, an unknown tool -32602, bad JSON
  -32700, and an invalid request -32600. Notifications and client responses get no answer. A batch is
  answered with an array. Tool failures come back as `isError` results, so the model can correct
  itself.
- Stdout carries protocol messages only: the server keeps a private copy of fd 1 and points fd 1 at
  stderr. The log is `ledgr-data/log/mcp.log`.

## Tests

`tests/test_mcp.py` (96 checks, in `tests/run-all.sh`) spawns the server over real stdio with a
scratch `LEDGR_DATA` and covers the following:

- both handshakes, `tools/list`, the error codes, a batch;
- a valid declaration and its event;
- rejected items, and every item rejected;
- a second and an empty call in the same turn;
- repeats by text and by handle (an old dismissal, another session and this turn's own asks are not
  repeats);
- `open_asks`, and `parked_questions` without and with the flag;
- `resolve_asks`: open and answered asks closed with the contract fields, dismissed and resolved ones
  reported as already closed, unknown handles (another session's, a question) reported, bad input,
  and through the fake writer `resolvedBy: "agent"` and a second call finding it closed;
- handles through a fake writer, including `replaces_turn` keeping a handle;
- the no-map fallback, and the map appearing later;
- a live other owner, a child agent, a dead owner, another config folder;
- `LEDGR_INNER`, no terminal id, `LEDGR_TERMINAL`;
- disabled spaces: all four tools off by the record's `ledgr_off`, by the record's `space` in
  `spaces.disabled` (no `ledgr_off`), by the map entry's space, and for a synthetic session by a live
  lookup (a fake `hc`), each writing nothing and logging one line; the same server back on records
  as before;
- stdout purity, exit on EOF, no bytecode, the log.

```sh
python3 -I -B tests/test_mcp.py
```
