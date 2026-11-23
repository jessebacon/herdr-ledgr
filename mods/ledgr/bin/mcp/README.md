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
be switched on mid-session), and the server's `instructions` say: when a ledgr tool answers
`off: true`, list what you need from the user in your reply instead. Their last sentence (2026-11-19)
covers a writer that is not applying events and a cold session whose file cannot be read: "When a ledgr
tool says its writer is not applying events, or that ledgr cannot read this session's earlier items, the
user cannot see these items in ledgr yet: say so and list them in your reply as well." It is in the
server's instructions only, not in `lib/asks-instruction-*.txt`: only a tool result can say the writer
is stalled or a session's file cannot be read, and it says what to do itself; the sentence keeps the
instructions' "instead of a closing list" from contradicting that result.

## Cold sessions

A session nobody touched for `retention.coldDays` (7 days by default; retention Phase 2) has its items
and turn records in `ledgr-data/cold/<safe sid>.<ms>-<rand6>.json`, named by `snapshot.json`'s `cold`
map (`{"<sid>": {"file", "fault"}}`), while its record stays in `store.json`. Every read here goes through
`lib/ledgr_extract.session_items(sid)`, which reads that file when the map names the session (checked as
the writer checks it: `ledgr: "ledgr-cold"`, `v: 1`, the session's id) and filters it as the snapshot is
filtered, so `open_asks`, the repeats, `resolve_asks`' handle map and the handles after a wait are the same
as for a warm session, with no wait: the writer thaws the session in the pass that applies the event, and
keeps the file at least an hour after. When the file cannot be read (the map's `fault`, the writer's
error, or this server's own read, in the writer's words: `cold/<file> is missing`, `… does not parse`,
`cold/<file>: <store.js coldRecordError>`), the tools still send
their events, which the writer holds in `cold/held/<safe sid>/` and applies once the session is read again
(Try again in the panel), used without its older items, or forgotten: nothing is lost, and a retry changes
nothing. `declare_asks` and `resolve_asks` then stay `ok: true`, add `cold: {file, fault, error}` to the
data, `writer: "held"` once the writer has held the event (found in `cold/held/` by event id: the writer
confirms that copy before the spool file goes, and only a replay that applied it removes it), and two lines: "ledgr cannot read
this session's earlier items (cold/<file>: <why>); what you sent is kept and applied once that is fixed
(the user's panel offers Try again)." (the why alone when it names the file, as `cold/<file> is
missing` does) and "Tell the user in your reply, and list these items there." (for
`resolve_asks`: "…and list there the asks you closed."); the pointer line follows "Then end your reply
with this line:". A handle `resolve_asks` cannot look up there is sent by handle (`item: null`, listed in
`unchecked`; `store.js` `on_act` finds it by handle when the event is applied). `open_asks` says which
asks it could not list instead of "No open or recently dismissed asks", and the server's instructions
cover both cases in one sentence ("…or that ledgr cannot read this session's earlier items…"). An event
gone from the spool and not in `cold/held/` was applied: a `snapshot.json` the writer could not write after
the thaw may still name the session cold (the writer tries it twice, and its status line says so), and the
result then says `writer: "applied"`, with handles possibly pending, never the two lines (integration,
2026-11-19: it used to read that as held). A known limit: while the file cannot be read here, a repeat cannot be
linked to the earlier ask it repeats (its `repeat_of` is noted as ignored and left out); once the session is
back, the writer still merges one whose text matches an earlier ask of the session (`store.js` `on_asks`, by
key), but a reworded repeat arrives as a new ask.

## declare_asks

Input: `{"items": [{level, kind, text, summary, quote?, options?, recommended?, repeat_of?}]}`. This is the
ledgr-asks item schema. `level` is `blocking` or `needed`; an `optional` item is accepted the way the
validator accepts it, kept as a suggestion and not counted. `kind` is one of decide, confirm, do,
provide, review. `repeat_of` takes a handle from `open_asks`. There are at most 20 items.

- `summary` (2026-11-23) is required on every item: what the user must do, precisely, readable without
  the reply (exactly what is needed and in what form, what the agent already did or ruled out, what it
  will do with each answer, its recommendation and why, anything that cannot be undone). Markdown; it
  goes through `ledgr_asks.summary_of`: line breaks kept (CR LF read as LF), a run of blank lines made
  one, the outer whitespace dropped (JavaScript's whitespace, U+FEFF included, as `store.js`
  `cleanSummary` reads it), cut at 1,000 characters (`MAX_SUMMARY`; a note says so), never refused for
  length. The schema has no `maxLength`, so a client that checks it does not refuse a long one. A call
  with an item (an object, within the 20) whose summary is missing, null, blank or not a string is
  refused whole, unlike the per-item rejections below: `isError`, nothing written (no spool event, no
  state file), `{ok: false, error: "every item needs a summary", missing_summary: [2, 3, 4],
  summary_not_string: [4], earlier_items_stand: false}`, and a text that names the items, says which
  summary is not a string, says when an earlier call of the turn stands ("ledgr recorded nothing
  (earlier items of this turn stand): …"), and says in two sentences what a summary holds.
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
  `snapshot.json` by normalised text, preferring this turn's anchor. Before it waits, `writer_state`
  reads what the spool's file times, `store.json`'s time and the writer's claim (as Herdr keeps it in
  `shared.json`, in Herdr's home beside `ledgr-data`) say (2026-11-19, when a writer held a fresh claim
  and applied nothing for hours):
  An event *waits* when it is over 5 s old (not counting this call's own file) and `store.json` has not
  been written since it arrived. Only then does the claim count: a claim is as old as the writer's last
  beat, so after the machine slept it is hours old while the writer works (2026-11-19 review: a claim
  2 h old over an empty spool read as stalled). A `shared.json` that does not parse (caught mid-write)
  counts as not known.
  - `ok`: no event waits. The server waits; `writer` is `applied` or `timeout` ("Handles are pending:
    ledgr's writer has not applied the event yet; they appear in the panel.").
  - `behind`: an event waits, and either the claim shows a writer at work (fresh, its pass or start in
    a step for under 90 s: starting, or draining a backlog after a relaunch) or nothing says more yet.
    No wait; `writer: "idle"`; "Handles are pending: ledgr's writer is behind (the oldest queued event
    is 20 s old); they appear in the panel once it applies them."
  - `stalled`: an event waits and no writer is at work: it has waited over `WRITER_STALL_S` (90 s, the
    writer's `PASS_STUCK_MS`); or `shared.json` holds no claim, or one nobody renewed for 3 minutes, or
    one whose pass has waited 90 s in one step, or one that says the writer is stuck with nothing
    running (backing off). After a wait that timed out, the same test with this call's own event. No wait;
    `writer: "stalled"`. The result stays `ok: true` (a retry changes nothing; the event waits in the
    spool and is applied once a writer runs) and says it plainly: "ledgr's writer is not applying
    events (3 events queued, the oldest for 5 min, and store.json last written 7 min ago). These items
    are queued, not shown to the user: the panel does not have them." and "Tell the user in your reply
    that ledgr's writer is not applying events (relaunching Herdr restarts it; nothing queued is lost),
    and list these items in your reply this time.", then "Then end your reply with this line:" and the
    pointer line.
  A cold session whose file cannot be read gives `writer: "held"` (see "Cold sessions").
  Unless `writer` is `applied` or `held`, the result carries `writer_status`: `{state, queued, oldest_s, store_s,
  why?, claim?: {by, age_s, step?, step_s?, fault?}}`. The server's instructions say what to do with a
  stalled writer in one sentence: say so and list the items in the reply as well.
- The turn's declaration is kept in `ledgr-data/mcp/<session>/<turn>.json` (the last 50 turns per
  session): `{v, session_id, terminal, turn, calls, event_ids, synthetic, pointer, asks, handles}`.
  `asks` holds the asks exactly as the last event sent them, every field included: `text`, `kind`,
  `level`, `options`, `recommended`, `blocking`, `quote`, `repeat_of`, `repeat_of_handle`, `hash`,
  `origin`, `quote_verified`, `summary`, and on a repeat `repeat_status` and `repeat_match`. The Stop
  hook can re-validate and re-emit them without reading `snapshot.json` (which carries no summary), and
  carries each summary through unchanged.

The event (`ledgr_spool.asks`, so the envelope and the order rules are the usual ones):

```json
{"v": 1, "id": "<uuid>", "type": "asks", "at": 1793993068292, "terminal": "t5", "session_id": "<sid>",
 "turn": 14, "prompt_id": "<from the map>", "message_uuid": null, "api_message_id": null, "passage_hash": null,
 "source": "tool", "asks": [{"text": "Choose the retry policy", "kind": "decide", "level": "blocking",
   "options": ["fast", "safe"], "recommended": "safe", "blocking": true, "quote": "I stopped here.",
   "repeat_of": null, "repeat_of_handle": null, "hash": "111b4f0d27af", "origin": "tool", "quote_verified": false,
   "summary": "Answer fast or safe. The client is built; I stopped before wiring its retries. Fast retries 5 times in 2 s, safe 3 times over 30 s. I recommend safe: the API rate-limits bursts."}],
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
  `writer_state` says behind or stalled) and says `writer`: `applied`, `timeout`, `idle` (behind),
  `stalled`, or `held` (a cold session's file cannot be read: see "Cold sessions") (null when nothing
  was sent), with `writer_status` unless applied or held. Timeout or behind, the
  text says the panel shows the asks closed once the writer applies them; stalled, that the closures are
  queued, the panel still shows the asks open, and to tell the user the writer is not applying events.
- One `mcp.log` line per call: `resolve <sid> turn=… resolved=[…] already_closed=[…] unknown=[…]
  note=yes|no events=N writer=…`.

The result: `{ok, session_id, turn, synthetic, resolved: ["A4"], unknown: ["A99"], already_closed:
["A3"], event_ids, writer, [writer_status], [notes], [note]}`, and a text such as `ledgr closed A4 as resolved by the
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
change, with three gaps (the fourth item is `resolve_asks`'s `act`, the fifth the summary):

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

5. **`summary`** (2026-11-23). Every tool ask carries one. `on_asks` keeps it on a new item (cleaned
   again by `store.js` `cleanSummary`), a later event for the same item (the Stop settle, a
   `replaces_turn` call) replaces it with a non-empty one and keeps it when the event has none, and
   `snapshot()` leaves it out.

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
returns." The server's own `instructions` field says the same for clients that show it. Since
2026-11-23 the server's `instructions`, the `declare_asks` description, the `summary` property's
description and both `lib/asks-instruction-*.txt` also carry one rule in one wording family: ledgr
exists to cut the back and forth and to clear what blocks the agent, never to hand work to the user, so
the agent first does all the task needs that it can do itself, declares only what is left that only
the user can give, never declares work it could do itself or asks the user to look up, verify or
summarise what it can, and gives each item a summary that stands on its own. It stops before a step
the task needs that cannot be undone and asks for a go-ahead, which is one of the things only the user
can give; a step beyond what it was asked is an offer, neither taken nor declared, a line of prose at most.
(Two reviews the same day: 7.1 found that the first wording forbade "check the DM link on your phone"
and left no door for a go-ahead before a destructive step; 10.1 found that the second, "a go-ahead
for such a step", also covered a step beyond the task, so an agent would declare a go-ahead for an
unrelated refactor.) Both
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

`tests/test_mcp.py` (181 checks, in `tests/run-all.sh`) spawns the server over real stdio with a
scratch `LEDGR_DATA` and covers the following:

- both handshakes, `tools/list`, the error codes, a batch;
- a valid declaration and its event;
- the summary (2026-11-23): the schema (required, no `maxLength`) and the rule's wording in the
  instructions and descriptions; a call with an item whose summary is missing, blank or not a string
  refused whole (nothing written, the items named, one not a string said so, an earlier call of the
  turn said to stand, U+FEFF alone as none, the two sentences); one cleaned (CR LF, blank-line
  runs, outer space) and one cut at 1,000 with a note, on the event and the state file; `tool_asks`
  carrying both through unchanged, and none from an older declaration; an off space answering off
  before asking for one; `snapshot_copy` leaving it out. The test client adds a summary to every other
  section's items (`Client.call`, unless `raw`);
- rejected items, and every item rejected;
- a second and an empty call in the same turn;
- repeats by text and by handle (an old dismissal, another session and this turn's own asks are not
  repeats);
- `open_asks`, and `parked_questions` without and with the flag;
- `resolve_asks`: open and answered asks closed with the contract fields, dismissed and resolved ones
  reported as already closed, unknown handles (another session's, a question) reported, bad input,
  and through the fake writer `resolvedBy: "agent"` and a second call finding it closed;
- handles through a fake writer, including `replaces_turn` keeping a handle;
- the writer not applying events (2026-11-19): behind (not waited for, said as behind), stalled by the
  spool (ok, not an error, `writer: "stalled"`, `writer_status` with the numbers, the text that says the
  items are queued and to tell the user and list them), an old event while `store.json` moves on (waited
  for as usual), `resolve_asks` stalled and behind, and by the claim in a scratch `shared.json`, counted
  only when an event waits (after a sleep: a claim 2 h old over nothing waiting, or a 1 s old event; a
  relaunch backlog with the writer starting; a half-written `shared.json`; a pass stuck in one step, a
  claim nobody renewed, no claim, a writer backing off, each with an event waiting 30 s; a moving claim);
  `WRITER_STALL_S` agrees with `writer.js` `PASS_STUCK_MS`; the instructions' sentence;
- the no-map fallback, and the map appearing later;
- a live other owner, a child agent, a dead owner, another config folder;
- `LEDGR_INNER`, no terminal id, `LEDGR_TERMINAL`;
- disabled spaces: all four tools off by the record's `ledgr_off`, by the record's `space` in
  `spaces.disabled` (no `ledgr_off`), by the map entry's space, and for a synthetic session by a live
  lookup (a fake `hc`), each writing nothing and logging one line; the same server back on records
  as before;
- cold sessions (retention Phase 2), in process: `session_items` from the snapshot, from a cold file
  (each of the snapshot's filters: states, the 7-day dismissal, a numeric-string time, a quote over 200
  UTF-16 units, draft and pins), a "mixed" session, a faulted one readable here, every unreadable case
  (missing, not JSON, another session, format or version, no item list, a name of another session or off
  the pattern) and a snapshot that moved on; `recorded_asks` and `tool_asks` the same warm and cold. Over
  stdio, with a fake writer that thaws and holds: `open_asks` the same warm and cold; `declare_asks` and
  `resolve_asks` on a cold session (from the file; thawed: handles at once), on a faulted one (held: ok,
  `writer: "held"`, `cold`, the two lines, the pointer; `resolve_asks` by handle, `item: null`), a repeat
  of a file ask while held, `open_asks` and `parked_questions` that cannot list, and with no writer;
- stdout purity, exit on EOF, no bytecode, the log.

```sh
python3 -I -B tests/test_mcp.py
```
