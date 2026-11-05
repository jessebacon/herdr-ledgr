# ledgr Phase 1: build notes, mod half (2026-11-05)

Scope: the Herdr mod (panel, capture box, store, writer, spool reader, navigation), `my-pane` with
the chip, the `my-tabs` edits (button, toggle, the writer host), the `custom.json` block and the keys.
The hooks and extractor (`mods/ledgr/bin/`) belong to the hooks agent; they were read and run (as
libraries, against a scratch data folder), never edited. Authoritative event contract:
`bin/lib/ledgr_spool.py` docstring and `bin/BUILD-NOTES-hooks.md`. Herdr 0.1.13 at build time.

## 1. Architecture (coordinator decision: option c)

- **Writer** (`writer.js`, role `my-tabs`): runs in the always-shown `my-tabs` tab-bar copy. It claims
  `shared("ledgr.writer") = {id, by, at}`, waits 500 ms when taking over from another holder, loads
  `ledgr-data/store.json` before reading or unlinking any spool file, then ingests `ledgr-data/spool/`
  with `watchFolder` (60 s rescan as a safety net). It writes `store.json` after every change and
  before unlinking the files it applied, writes `snapshot.json` with every store write, publishes
  `shared("ledgr.chips")` only when the value changes, archives closed items after 14 days, runs the
  extractor's `--retry` for `retry` events, and from `my-tabs`' render tracks agent status
  (interrupts; tier-3 status turns) and answers pings.
- **Panel** (`panel.js`): a reader. It loads `store.json` and follows it with `watchFolder` on
  `ledgr-data/` filtered to `store.json`. Every act (resolve, defer, dismiss, reopen, draft, seen,
  btw mark, retry) is posted as a spool event, like the capture box's `capture`. In reader mode an act
  shows at once (an overlay re-applied after each reload until `store.json`'s `ingested` lists the
  event id, at most 30 s); answer drafts are posted 800 ms after the last keystroke.
- **Fallback**: at start (and when shown again, at most once a minute) the panel sets
  `shared("ledgr.ping") = {at, id}`; a live `my-tabs` writer re-claims (claim.at >= ping.at). No answer
  in 4 s: the panel starts its own `Writer("panel")`. The `my-tabs` writer takes the role back
  whenever it sees `by: "panel"`; the panel's writer stops writing the moment it no longer holds the
  key (every write path checks it) and the panel returns to reading.
- **Why a copy of the engine in my-tabs**: Herdr refuses imports that resolve outside a mod's folder
  ("module `../ledgr/store.js` resolves outside the application directory"), and symlinks too (it
  checks the resolved path). So `mods/my-tabs/ledgr/{config,store,spool,writer}.js` are byte-identical
  copies of `mods/ledgr/`'s, which stay the source of truth. The panel compares the two sets at start
  and shows a warning line naming any file that differs. After editing the engine:
  `cp ~/.config/herdr-app/mods/ledgr/{config,store,spool,writer,branch,confluence}.js ~/.config/herdr-app/mods/my-tabs/ledgr/`
  (`branch.js` joined the engine in Phase 2, `confluence.js` in Phase 3; since the repo move, `./install.sh` does this).

## 2. Files

Created, `~/.config/herdr-app/mods/ledgr/`:

| File | What it does |
|---|---|
| `mod.json` | `place: none`, title "ledgr", popup overlay at top, offset 40, 600 × 236 |
| `main.js` | routes on props: `view: "panel"` → panel; an `overlay` or `view: "capture"` → capture box; one `nextCommand()` loop |
| `writer.js` | the single writer (section 1); `writerClaim()`, `engineDrift()` |
| `panel.js` | the reader panel: both lanes, row actions, Retry, demo, the fallback writer |
| `capture.js` | the ⌘J box: target session, validated clipboard quote, hand quote field, `capture` event, `/btw` staging |
| `store.js` | data model and event application, chips, snapshot, archive selection, tier-3 status turns |
| `spool.js` | spool reader (name order, dotfiles and `bad-*` skipped, 5 parse retries, unlink after apply), map reader, event writer, CAS write helper |
| `nav.js` | Go to anchor, clipboard staging, answer-sheet and `/btw` text |
| `config.js` | `FORCE_DEMO`, the hooks' config defaults (fallback only), paths, agent label |
| `fixtures.js` | demo store (every lane and state, raised again, pending) |
| `RECIPE.md`, `BUILD-NOTES-mod.md` | brief and these notes |

Created and deleted: `things.js` (Things removed). Herdr added `gpui-kit.d.ts` and `jsconfig.json`.

Created by `mod.clone` and edited: `~/.config/herdr-app/mods/my-pane/` (the chip; `DEMO_CHIPS` false).

Created: `~/.config/herdr-app/mods/my-tabs/ledgr/{config,store,spool,writer}.js` (engine copies).

Edited:

| File | Change |
|---|---|
| `mods/my-tabs/main.js` | `GLOBAL_PANELS = ["quota", "ledgr"]`; `toggle-ledgr` (alias `toggle-ledger`); "ledgr" button; the writer: started in `init` when `mods/ledgr/main.js` exists, `tick` on a 60 s timer, `respond()` and `track(cx)` in `render`; every ledgr call is wrapped so a ledgr fault cannot break the tab bar |
| `layouts/custom.json` | pane header `my-pane`; fourth `panel-body` child `ledgr` with props `{view: "panel"}`. Kolczyk and `main.json` untouched |
| `keys.json` | `cmd-j` → `mod.open:ledgr`, `cmd-shift-j` → `my-tabs.toggle-ledgr`, `mod:ledgr` {`cmd-enter` → `ledgr.btw`, `tab` → `ledgr.tab`, `shift-tab` → `ledgr.backtab`}; nothing else changed |

Backups, `~/.local/state/ledgr/backup-20261105/`: `mods/my-tabs/main.js`, `layouts/custom.json`,
`layouts/.state-custom.json`, `keys.json`, `shared.json`. Rollback: copy them back, then
`rm -r mods/my-pane mods/my-tabs/ledgr` and the mod files under `mods/ledgr/` (not `bin/`).

Runtime writes by the mod under `ledgr-data/`: `store.json`, `snapshot.json`, `spool/` (created by the
box when missing; the panel's `act`/`retry` events). Test items were cleared from `store.json` before
the hooks went live; it now holds only what the live hooks produced. My shell writes into
`ledgr-data/`: two probe files in `spool/` (one per architecture), both consumed by the writer.
Residue in `shared.json`: a `ledgr.probe` key from the import probe (harmless; a mod cannot delete a
shared key except by overwriting it).

## 3. Event contract as implemented

Envelope `{v, id, type, at, terminal, session_id}`, files `<ms>-<type>-<pid>-<rand>.json`. Per turn:
`pending` → `stop` (up to ~4 s later) → `asks`. No `settle` (still accepted if one arrives).

| type | From | Fields read |
|---|---|---|
| `session_start` | hooks | `agent`, `source`, `model`, `cwd`, `transcript_path`, `session_name`, `repo`, `turn` |
| `prompt` | hooks | `turn`, `prompt_id`, `local`, `prompt_head`, `refs` |
| `pending` | hooks | `turn`, `passage_hash` (also `session` if no `session_id`). Ends the turn (state idle, so the interrupt check does not wait for stop); chip `p` until that turn's `asks`, or 30 s |
| `stop` | hooks | `turn`, `prompt_id`, `text_path`, `text_head`, `passage_hash`, `message_uuid`, `api_message_id`: the uuid goes on every item of that session and turn without one (parked questions settle here) |
| `asks` | hooks | `turn`, `prompt_id`, `message_uuid`, `api_message_id`, `passage_hash`, `source`, `asks[]`, `model`, `provider`, `error`, `error_detail`, `block_error`. Per ask: `text`, `kind`, `options`, `recommended`, `blocking`, `quote`, `hash`, `origin`, `repeat_of` (an `rq_` id), `repeat_of_handle` |
| `session_end` | hooks | envelope |
| `capture` | box | envelope + `agent`, `turn`, `session_name`, `cwd`, `request` (a Request, `handle: null`; the writer assigns `Q<n>`) |
| `act` | panel | `item`, `action` (`resolve`, `dismiss`, `reopen`, `defer`, `draft`, `btw`, `seen`), `arg` |
| `retry` | panel | `turn`, `terminal`: the writer runs `bin/adapters/<agent>/extract.sh --retry <sid> <turn> --terminal <t>` (else `bin/ledgr-extract.sh`); the turn shows Retrying… until the new `asks` arrives |

`act` and `retry` never create a session. Unknown types are recorded in `ingested` and unlinked.

Re-raise rules: `repeat_of`/`repeat_of_handle` (or the same normalised text) names the prior ask.
Open or deferred: updated in place (`lastSeenTurn`, anchor moves to the new turn). Answered: reopened
with "asked again at turn N". Dismissed or resolved: a new open item with `repeatOf` and a "raised
again" badge (`parentId` too when resolved). The newest item with a key decides.

Identity map (`terminals/<t>.json`): read at writer start and by the box. The box uses
`last_assistant_uuid` as the capture's `anchor.uuid` when the agent is idle; while it works the uuid is
left empty and filled from that turn's `stop` (the map's value then still names the previous turn's
message). `owner_pid`, `owner_comm`, `last_passage_hash` are not used by the mod.

`snapshot.json` = `{v, updatedAt, items}`: open, answered and deferred items plus items dismissed in
the last 7 days, with `id`, `handle`, `text`, `status`, `direction`, `anchor.sessionId`,
`resolvedAt`/`updatedAt`; quotes over 200 characters dropped. Written with every store write and once
at writer start.

`config.json` belongs to the hooks; `config.js` mirrors their defaults (`instruct_block` false,
`extract.provider` "anthropic", `cli_fallback` false, `timeout_s` 20, no `things`) for a missing or
invalid file only.

Passage hash: `sha1(whitespace-collapsed passage)[:12]`, passage = quote else text; the hooks' value
always wins. JS and Python agree.

## 4. Coordinator changes applied (all three messages)

1. Anchors do not need a uuid; identity and de-duplication use `anchor.turn` + `anchor.hash`; items are
   shown by turn and passage. The `agent` label is drawn on the panel header, every session-list row
   and the box header.
2. Things removed. `store.json` is the source of truth (atomic CAS writes via `writeTextFile`; the
   mod has no rename). Clipboard quotes are validated (section 5). The stop uuid attaches to the turn's
   items. Questions lane on top; asks lane folded while the agent works, open at end of turn.
   Dismissed asks re-raise as new "raised again" items. `pending` shows a spinner on the chip and the
   asks lane head.
3. Option (c): section 1. Hooks contract: section 3 (no settle, `repeat_of` id + handle, snapshot with
   recent dismissals on every change, map fields, the hooks' config defaults, "no credential" renders
   as "asks not extracted for turn N: no credential" with Retry, confirmed live).

## 5. Readings taken where the text was open

- Quote check: the clipboard text must occur, whitespace-collapsed, in one of the newest 50 saved turns
  of the session, or (agent working) in `hc read <terminal>` taken when the box opens. A second
  comparison drops `*` and backticks from both sides, because fullscreen Claude shows text without
  its markdown marks. A hand-pasted quote is taken as is (`quoteSource: "typed"`).
- Captures get `Q<n>` from the writer. Tier-3 agents (no hooks) park against `herdr:<t>`, with turns
  from Herdr's agent status.
- Not built, by the brief: "Send when idle" and `btw.autoSend` (no `hc send`). Not built:
  `nav.autoSearch`, the classic-renderer `terminal.copy` step.
- Interrupt window is 6 s (stop can trail pending by ~4 s; pending already ends the turn).

## 6. Herdr behaviours hit

| Behaviour | Observed |
|---|---|
| A hidden stack child's copy starts at layout load | No: the ledgr block's copy started only when first shown (no claim, no `data/ledgr/` until then). The reason for option (c) |
| Imports from another mod's folder, or through a symlink | Refused at run time: "resolves outside the application directory" |
| `herdr-app check` file reads outside the mod folder | Refused in check ("outside every granted read root"); allowed in the app. The `my-tabs` install probe treats a refusal as "not installed", so check stays quiet |
| A hidden, already-started copy | Keeps running (its writer consumed spool files with the panel hidden) |
| `cx.read_from_clipboard()` in an overlay's `init` | Works |
| `watchFolder` on `ledgr-data/spool` | Fires: probe consumed in 76 ms (panel writer) and 234 ms (`my-tabs` writer) |
| Overlay vs panel `localStorage` | Separate files per copy; the overlay's persists across opens |
| `herdr-app do <mod>.<command>` | Reaches shown copies only |
| `TextView.markdown` bold | Not visibly heavier; the quote's paragraph or list line gets an accent bar and tint |
| `hc keys <t> ctrl+o /`, focus return after the popup | Not run / not observable without real keys |

## 7. Tests run

- `herdr-app check`: `mods/ledgr` (also with `FORCE_DEMO = true` earlier), `mods/my-pane`,
  `mods/my-tabs`: pass. No `.error` files; `herdr-app status` errors `[]`.
- Demo panel, chips (surfaced, collecting, seen, pending), capture over a working agent with a valid
  and a rejected quote: shots in the session scratchpad `shots/`.
- Live fallback: before the `my-tabs` writer existed, the hidden panel copy took the role (`by:
  "panel"`) and ingested 26 real hook events (3 sessions, every turn "no credential").
- Live `my-tabs` writer: claims the role (`by: "my-tabs"`); with the panel hidden it consumed the shell
  probe in 234 ms and persisted it to `store.json`; the reader panel then showed the live store (session
  `t1g · teams-linear`, "asks not extracted for turn 1: no credential", Retry).
- Layout round trip after option (c): `custom` loads; ledgr, Files, Changes, Quota each render; the
  panel was left hidden with Quota selected, as found.
- Live Stop with the panel hidden (panel `hidden`, Quota selected), `my-tabs` writer holding the role:
  at 15:01:45-48 t1g and t2 ended turns; the writer published `{t1g: {p: 4}}`, then
  `{t1g: {p: 4}, t2: {p: 3}}`, then `{t2: {p: 3}}`, then `t2: {a: 4, st: "surfaced"}` once the model
  extraction (Keychain credential now working) brought asks A1-A4 (turn 3, `hash`, stop-attached uuid,
  `extract_model`), which also reached `snapshot.json`. Evidence: `store.json` `diag.chips` and
  `shared("ledgr.chips")`. Herdr saves `shared.json` in the background, so a file watcher missed the
  sub-second `p` states; `diag.chips` (the last 12 published chip values, with time and role) was
  added to the writer for that reason and is kept as a diagnostic.
- Store unit test (Node, scratchpad `storetest/test.mjs`): all rules in sections 3-4.
- Real-shape test (scratchpad `realtest/`): the hooks' own `ledgr_spool` builders and `ledgr_extract`
  (offline, `LEDGR_DATA` pointed at a scratch folder) produced session_start, prompt, pending, stop
  (uuid), asks (block fixture: 2 asks with `hash`, `origin`, `repeat_of`, `repeat_of_handle`), and a
  "no credential" turn; my store ingested them in name order (uuid from stop/asks, error turn with
  `error_detail`, pending cleared); a panel-style `act` dismissed A1; my `snapshot.json` was read by the
  extractor's own `recorded_asks` (A2 open, A1 dismissed); the hooks' validator turned a model reply
  naming A1 into `repeat_of: rq_…`, which my store opened as A3, raised again.

## 8. For the hooks agent

- The panel's Retry is a `retry` spool event; the writer runs `bin/adapters/claude/extract.sh --retry
  <sid> <turn> --terminal <t>` and reads the last stdout line as `{ok, source, asks, error}`.
- New mod-internal event types in the spool: `act`, `retry`, `capture`. The writer consumes them; the
  hooks' 7-day spool prune is fine with them.
- `snapshot.json` follows every store write.

## 9. Open items

- Cold start not verified: Herdr was not restarted. The `my-tabs` writer starts in `init`, which runs
  when the tab bar first renders; its reload (same code path) claimed the role with the panel hidden.
- Not driven with real keys: ⌘J over a streaming pane, Enter/⌘Enter/Esc/Tab in the box, focus return,
  ⌘⇧J, clicks on row actions (the act path is covered by the store tests and the shared `writeEvent`).
- `hc keys <t> ctrl+o /`; the `bad-*` quarantine; the 14-day archive; `openPanelOnAsks`: coded, not
  exercised.
- Extraction: turns up to 14:55 ended in "no credential"; from 15:01 the model path works (the Keychain
  item was fixed meanwhile). Those older turns still show "asks not extracted" with Retry.
