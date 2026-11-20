# ledgr Phase 1: build notes, mod half (2026-11-05)

Scope: the Herdr mod (panel, capture box, store, writer, spool reader, navigation), `my-pane` with
the chip, the `my-tabs` edits (button, toggle, the writer host), the `custom.json` block and the keys.
The hooks and extractor (`mods/ledgr/bin/`) belong to the hooks agent; they were read and run (as
libraries, against a scratch data folder), never edited. Authoritative event contract:
`bin/lib/ledgr_spool.py` docstring and `BUILD-NOTES-hooks.md`. Herdr 0.1.13 at build time.
(Sections 1 to 9 describe Phase 1 as built. Since 0.1.0 the chip is the public `ledgr-pane`, `my-pane`
is retired and `my-tabs` is the maintainer's overlay; later sections say so where it matters.)
(Since 2026-11-10 the panel is a one-line list, rows open in a detail dialog, and the panel's reading
half is `reader.js`, so the `panel.js` line numbers here predate it: `BUILD-NOTES-detail.md`.)
(Since 2026-11-19 the 14-day month-file archive of section 1 is replaced: closed items after 3 days and
old turn records go to files under `archive/<session>/`, written once and read back: section 19.)

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
| `asks` | hooks | `turn`, `prompt_id`, `message_uuid`, `api_message_id`, `passage_hash`, `source`, `asks[]`, `model`, `provider`, `error`, `error_detail`, `block_error`, `rejected` (section 10). Per ask: `text`, `kind`, `level` (blocking, needed, optional; an older event without it: `blocking` true means blocking, else needed), `options`, `recommended`, `blocking` (= level blocking), `quote`, `hash`, `origin`, `repeat_of` (an `rq_` id), `repeat_of_handle` |
| `session_end` | hooks | envelope |
| `capture` | box | envelope + `agent`, `turn`, `session_name`, `cwd`, `request` (a Request, `handle: null`; the writer assigns `Q<n>`) |
| `act` | panel | `item`, `action` (`resolve`, `dismiss`, `reopen`, `defer`, `draft`, `btw`, `seen`, `promote`), `arg` |
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
`extract.provider` "anthropic", `cli_fallback` false, `timeout_s` 20, no `things`; since section 10
also `extract.threshold` "needed" and `ui` `{foldAsksWhileWorking: false, animations: true}`; since
2026-11-06 `instruct_block` and `instruct_reinject` true and `asks.handoff` "ledgr", section 14) for a
missing or invalid file, and for keys the file does not have.

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
- `hc keys <t> ctrl+o /` (removed 2026-11-06: ledgr sends no keystrokes); the `bad-*` quarantine; the
  14-day archive; `openPanelOnAsks`: coded, not exercised.
- Extraction: turns up to 14:55 ended in "no credential"; from 15:01 the model path works (the Keychain
  item was fixed meanwhile). Those older turns still show "asks not extracted" with Retry.

## 10. Fold ownership, ask severity, motion (2026-11-05, after the spacing commit 692dbcb)

Three changes, in this order, deployed with `./install.sh` each time (check green for all three mods,
engine copies identical). Hooks half: `BUILD-NOTES-hooks.md`, "Severity".

### 10.1 The asks lane's fold is the person's

- `panel.js`: `asksOpen` returns `!collapsed.asks` unless `ui.foldAsksWhileWorking` is true (then the
  Phase 1 rule: folded while working, open at each stop, a click holds until the next stop).
  `collapsed` (both lanes) is saved in the copy's `localStorage` (`lanes`) and changed only by a click
  or `ledgr.fold-mine` / `ledgr.fold-asks`. While the agent works the asks lane head shows "agent
  working" (`working`, 0.75 opacity), unless the extraction spinner is showing.
- `config.js` and `bin/lib/ledgr_config.py`: `ui.foldAsksWhileWorking: false`. The panel re-reads
  `config.json` when its `ledgr-data/` watch reports that file (or the root).
- Seen live, reader path (a throwaway session made of spool events, section 10.4): working with the
  default keeps the lane open with "agent working"; with the option true the lane folds.

### 10.2 Severity and the threshold

- Every agent ask has `level`: `blocking` > `needed` > `optional` (`store.js` `LEVELS`, `levelOf`; a
  legacy item without one is needed, or blocking when `blocking` is true). `blocking` is kept, derived.
- `extract.threshold` (config.json, default needed; `thresholdOf` turns anything else into needed).
  The writer sets `store.threshold` (`applyConfig`) at start, on every `config.json` change
  (`watchConfig`: a `watchFolder` on `ledgr-data/` filtered to that file, the 60 s tick as the safety
  net) and before a `branch` batch; the panel sets the shown store's threshold in every render from
  its own copy of the config.
- `isSuggestion(it, threshold)`: an agent ask below the threshold, not promoted. Suggestions stay
  `open` items (stored, in `snapshot.json` with their level so a re-raise still matches), but
  `store.counts(it)` is false: not in `chips()` `a`, not in the lanes' "N open" or the session menu,
  and a new suggestion alone does not set `surfaced`.
- `act promote` sets `promoted: true` (`promotedAt`); a promoted ask counts whatever the threshold.
- `chips()`: `a` counts open asks that count, `b` the blocking ones among them (only when > 0). `st`:
  `collecting` (working with questions parked this turn), else `blocking` (b > 0, not working), else
  `surfaced` / `seen`. `my-pane` draws `blocking` in `blocked` on a `blocked` tint: "1 blocking ·
  2 asks · 1 parked". A seen panel does not quiet it; resolving, answering or dismissing the blocker does.
- `panel.js`: in each turn group, blocking asks first (then `seq`), `◆` glyph and `blocking` tag in
  `blocked`; suggestions in one folded line at the bottom of the group, `suggestions (N)` (per turn
  in `sugOpen`), each row dim with a hollow glyph, its level tag and a `promote` pill; Promote also in
  the expanded row's buttons. Group lines read `turn 17 · 8 asks, 6 open, 1 blocking · 2 suggestions`
  when folded. The detail line names the level.
- `fixtures.js`: A6 blocking; A13 and A14 optional (turn 17 has `suggestions (2)`).
- Tests: `test_store.mjs` 46 severity checks (levels, threshold reclassifying, chips `a`/`b`/`st`,
  promote by act and spool, re-run keeps `promoted`, blocking yields to working, suggestions neither
  surface nor show a chip, legacy items); two Phase 1 checks changed (A2 is blocking, so the chip's
  state is `blocking`, also after `seen`). 302 checks in all.
- Live (writer `my-tabs`): the throwaway session's chip went `{a: 2, b: 1, st: "blocking"}` with one
  suggestion stored; `extract.threshold` set to optional in `config.json` gave `{a: 3}` and an open A3
  row within 3.5 s, no restart; back to needed, `{a: 2}`.

### 10.3 Motion

What the toolkit offers (`gpui-kit.d.ts`, `herdr.d.ts`, `AGENTS.md` "Animate natively"):
`.transition(property, ms | {duration, delay, easing})` and `.spring(property, {response, damping,
epsilon})` for later target changes of `opacity`, `width`, `height`, `left`, `top`, easing linear,
ease-in, ease-out or ease-in-out; `.loop(property, {from, to, period, easing})` forever at about
30 fps; `.frames(list, ms)` (text spinner); `.spin(ms)` (svg). All native, all only while drawn. No
reduced-motion preference: `window()` has `active`, `Window` has `appearance()`, `settings()` has
none. No shipped mod uses `transition` or `spring` (only `spin`, `frames` in peek, `loop` in win98).

A probe (a temporary panel command, removed; shots 75 ms apart) showed:

| Case | Result |
|---|---|
| `opacity` 0.1 ↔ 1, linear 1.2 s | eases |
| `h(10)` ↔ `h(50)` | eases (also `spring`) |
| auto height ↔ `h(0)` | jumps, both directions |
| `relative().top(0)` ↔ `top(20)` | eases |
| new element, transition attached only on the frame its target changes | no motion |
| new element carrying the transition from its first frame, target changed 16 ms later | eases |

Built (`panel.js` `observe`, `classOf`, `glow`, `ghostRow`, `pruneFx`; `my-pane` `pulseFor`):

- Detection: render calls `observe` only when the shown store changed (`rev`, bumped by `reload`, by
  `overlayLocal` with local acts, by demo acts; or the fallback writer's `storeText`). It classes every
  item (`lane`, `answered`, `sug`, `deferred`, `closed`, `stale`) and compares with the last look.
  Not fresh (the read happened over 1.5 s before the render: the panel was hidden), the first look,
  demo on or off, a config change, `ui.animations` false: record only. Staleness moves rows by the
  clock and never animates.
- Enter (new, promoted, reopened; at most 8 per change, staggered 45 ms): the row carries
  `opacity` and `top` transitions from its first frame (0 and -6 px), set to 1 and 0 a frame later
  (200 and 260 ms ease-out), under a tint (first child, absolute) that holds 220 ms and fades over
  900 ms: `blocked` for a blocking ask, else `accent`.
- Answered: a `done` tint; an open row's details fade (160 ms) and the row folds at 200 ms.
- Leave (resolved, dismissed, deferred): the row is drawn in place as it was (`ghostRow`, inert, not
  counted) and fades over 160 ms; if the pointer measured its height in the last 15 s (`on_mouse_move`
  bounds, no render) and it was not opened or closed since, it also collapses from that height
  (220 ms, after 110 ms). Then one render removes it.
- New suggestion: its `suggestions (N)` line gets the tint.
- Chip (`my-pane`): each header keeps the chip it last drew; quiet to loud (surfaced or blocking), or
  loud again for a later turn, draws a halo (accent or blocked, first child) that fades over 900 ms.
  The first render of a copy records only. `shared("ledgr.ui").animations` (published by the writer)
  turns it and the chip spinner's motion off; the panel's own spinners follow `ui.animations` too.
- Renders caused by motion: one 16 ms later (targets), one when a ghost goes or a row folds. Nothing
  periodic. `ledgr.render-stats` writes `{renders, fx, ghosts, animations, shown}` to
  `ledgr-data/log/panel-renders-<copy>.json` (one file per panel copy).
- Not built: lane fold easing (content-sized heights do not ease); reading macOS Reduce Motion (it
  lives outside Herdr's home and `~/.claude`).

Seen (shots in the session scratchpad `sev/`): a demo blocking ask fading in under a red tint gone
within about 1 s; its resolve fading in place with the counts already updated, then the list
closing up; a promoted A13 entering the main rows, an answered A8 glowing `done`, a new suggestion
lighting its line; the reader path with the throwaway session: pending spinner, then three asks
arriving (blocking tinted red, needed accent, the suggestions line lit), settled at 1.5 s; the chip
via `my-pane.demo-chip`: seen, then surfaced with one halo fading out, then blocking (a later turn)
with a red halo, settled.

Idle cost: `ledgr.render-stats` twice 32 s apart, nothing happening: 17, then 18 renders (the one is
the first command's own render). Herdr's CPU (`top -l 7 -s 5 -pid 16639`): 4.0-4.8 % after, 4.4-4.8 %
before the change (19:22), both with Herdr's own working spinners on (the build agent was running).

### 10.4 Live test (scratch only)

A throwaway session made only of spool events (`ledgr_spool` builders from the live `bin/lib`,
terminal `ledgr-test-sev`, session `ledgrtest-sev-…0002`; script in the session scratchpad
`sev/e2e/ev.py`): `session_start`, `prompt`, `pending`, `stop`, then `asks` (one blocking, one
needed, one optional, through `ledgr_asks.validate`); shown with `ledgr.session:ledgr-test-sev`;
two more turns for the fold check; removed with a `forget` event. The first attempt
(`…0001`) ran while the panel was still in demo mode and was forgotten the same way. Nothing was sent
to any real session. `store.json` keeps both ids in `forgotten`. `config.json` gained
`extract.threshold` and `ui` with their defaults (backup:
`~/.local/state/ledgr/backup-20261105-config/config.json`).

### 10.5 Also

- The panel's engine-drift warning was a race with `install.sh` (the `mods/ledgr` sync reloads the
  panel before the engine is copied into `my-tabs`): the panel now looks again after 5 s and drops
  the warning when the sets match.
- Not verified: a real Claude turn ending with asks (the chip pulse and the enter motion were seen
  from spool events and the demo, not from the hooks); the collapse-from-height of a row closed by a
  real click (commands do not move the pointer); motion with the window inactive (it does not paint);
  the panel's fallback writer path for motion.

## 11. Polish: words for identifiers, Resume session, borderline asks (2026-11-05, same evening)

### 11.1 Identifiers as words

Jesse read `t3` as "turn 3" and `A9` as "asks-9". `words.js` (new; panel and capture box only, not an
engine file) turns them into words wherever a person reads them: `Ask 9`, `Question 1`, `pane t3`
(never bare), "branch of Question 1" with its hc name (`br-q1-c51e`) small and dim beside it, "the
trunk (pane t3)", the session name first with `pane t3` after it (header, session menu, capture
box). The detail line is `Ask 13 · found by the extractor · needed · turn 19` (origins: found by the
extractor, declared by the agent, parked by you, parked by you (/btw)); the passage hash moved to
its tooltip ("passage #5abb…"). Sub-lines read `turn 14 · re Ask 5`, badges `sent at turn 18` and
`branched`, the manifest's Parent line `<name> · pane t3 (session 88c36d53)` and its parked
questions as `Question 4`. Unchanged on purpose (machine formats; tests and landing detection read
them): the answer sheet's `A9: …` lines and its lead-in, the confluence message, markers and its
lead-in, `[A9]` / `[Q1]` refs and the `re [A5] ` prefill, store keys, hc names, decisions.md.

### 11.2 Resume session

- `panel.js` `terminalGone(st, s)`: the session's terminal is not in `terminals()` (live) nor
  `agents()`, or the identity map now gives that terminal to another session. Then Go to anchor
  becomes **Resume session…** for a Claude Code session (else Go to anchor disabled, "its terminal is
  gone"); **Transcript gone** (disabled) when the transcript file does not exist (`transcriptOk`:
  `fs.exists` of `transcriptPathOf`, once, again after 30 s; the result arrives with one render);
  **Resuming…** while a launch is under a minute old. A failed launch shows its error under the
  buttons. The saved passage stays in the row either way.
- A click posts `resume` (own event; `store.js` `on_resume`: `s.resume = {at, state: "launching"}`,
  `out.resume`, one launch per minute). `writer.js` `resumeSession`: transcript check, then `hc`
  with `branch.js` `resumeArgs` (`run --bg --json --no-parent --no-notify --cwd <cwd> --label
  ledgr.resume=<sid> -- claude --resume <sid>`: no parent, no fork, no preamble), then `givePane`
  (wait for the terminal, `terminal.keep` place right, else a tab of its own, `pane.focus`), then
  `resumeLaunched` (`launched` with terminal and note, or `failed`). The session's SessionStart hook
  (source resume) carries the new terminal: `apply()` re-maps it and `on_session_start` marks
  `s.resume.state = "resumed"`; a late hc reply does not undo that.
- `branch.js` `transcriptPathOf(s, home)`: the recorded `transcriptPath`, else
  `~/.claude/projects/<cwd, every non-alphanumeric as "-">/<sid>.jsonl`.
- Tests: 21 store checks (the event, one at a time, unknown sessions dropped, launched, re-mapped by
  SessionStart, a late reply, retry after a minute, failed; `resumeArgs`, `transcriptPathOf`).
- Seen live: two throwaway sessions made of spool events with terminals that do not exist showed
  **Resume session…** in place of Go to anchor (detection works). The first try threw "cx is not
  defined" (the transcript check ran in `details`, which has no cx; it now uses the render's,
  `this.rcx`), fixed and redeployed. Not seen: the transcript check's answer turning the button on,
  or **Transcript gone**: Herdr went to the background (VMware Fusion in front) and stopped
  repainting; `ledgr.render-stats` showed 0 renders since the reload. Not run: a real resume launch
  (it would start a Claude session in Jesse's window).

### 11.3 Borderline and oversized asks

- `bin/lib/extract-system.txt` (hooks notes, "Borderline asks"): a go-ahead or "have a look" closer is
  optional unless the agent says it cannot proceed; review is needed only for one specific thing to
  verify; the quote is the one or two sentences that make the ask, never the whole message.
- `panel.js` `details`: only the quote shows (cut at 300 characters with "…"); "show whole message"
  opens the anchoring message in the 260 px scroll box, highlighted, and "hide whole message" closes
  it. Before, the passage box was always open, and a whole message taken as the quote filled it.

### 11.4 Also

- `ledgr.render-stats` writes one file per panel copy, `ledgr-data/log/panel-renders-<copy>.json`,
  with the copy's transcript checks.

## 12. Status lines, the threshold on the lane, the uncapped message, fewer buttons (2026-11-06)

From Jesse's screenshot: Ask 15, "Review the uncommitted changes in the repo…", was extracted as
needed/review from a statement of state ("Two batches are now uncommitted in the repo").

- Extraction (hooks notes, "Status lines"): a statement of what is done, pending or uncommitted is
  not an ask; `needed` needs the message to say the user must do it for the work to be complete.
- Threshold on the panel: the ASKED OF YOU head carries a quiet menu, `blocking only ▾` /
  `blocking + needed ▾` / `everything ▾` (`thresholdMenu`, `setThreshold`). A choice writes
  `extract.threshold` into `ledgr-data/config.json` (read, parse, set, `writeTextFile` against what
  was read; an invalid file is refused, a missing one is written from the defaults); the writer's
  `watchConfig` republishes the chips and the panel re-reads the file. A threshold change records
  without motion. The demo keeps it in memory. `ledgr.threshold:<level>` is the same code.
- The fold is now "below threshold (N)" (group lines "· 2 below threshold"; command
  `ledgr.below-threshold`, `ledgr.suggestions` kept as an alias).
- Jesse's live config is set to `"threshold": "blocking"` (through `ledgr.threshold:blocking`;
  backup `~/.local/state/ledgr/backup-20261106-config/config.json`; other keys untouched). The
  writer republished at once: t1g `{a: 1, b: 1}`, t2 `{a: 2, b: 2}`.
- Whole message: no height cap (and no inner scroll box) once opened; the panel's list scrolls.
  The 260 px box inside the scrolling list neither scrolled nor showed a bar. The quote-only default
  stays. Demo: the second session's turn 4 is a 1,511-word message with the ask in its last
  paragraph (`fixtures.js` `T4_CODEX`); `ledgr.session:t7`, `ledgr.whole:A1`.
- Buttons. A row shows **Done** (tooltip "Done: you did or decided it"), **Defer ▾** (tomorrow, in a
  week, next session), its own step when it has one (Promote, Branch…, Copy confluence again;
  Reopen when closed or deferred) and **⋯**: **Not needed** (tooltip "Not needed: close it; the agent
  may raise it again"), Ask about this, Copy for prompt and Stage /btw on a question, Call off for a
  staged confluence, Go to anchor or Resume session / Transcript gone. Copy answer stays beside the
  draft field. A branch row shows Conclude… / Edit conclusion… or Close branch (End / Keep) and ⋯
  (Focus, Copy the confluence again, Ask for a conclusion, the preamble, a disabled Conclude… with
  its reason). Menus are `menuButton`: gpui-base `Popup` anchored to its trigger, as the shipped
  linear mod opens its project picker (`Popup.new(id, trigger).anchor(…).when(open, el =>
  el.content(list))`, `on_mouse_down_out` to close); a focus handle on the list takes Esc; one menu
  open at a time; a press outside that lands on the same trigger does not reopen it. Scripted:
  `ledgr.menu:<handle>:<defer|more>`, `ledgr.menu:threshold`, `ledgr.menu:off`.
- Tests: `run-all.sh` green (323 store checks; `status`, `statusask` fixtures offline). Checks green
  for the three mods and a FORCE_DEMO copy.
- Not verified on screen: Herdr was in the background (the TV app in front) for this round, so the
  menus opening, the threshold control's look at 280 px, and the 1,511-word message's last line in
  the list were not seen. The code paths ran: `ledgr.threshold:blocking` wrote the file and the
  writer followed it.

## 13. Which Claude profile a session belongs to (2026-11-06)

Jesse runs two Claude Code accounts through `CLAUDE_CONFIG_DIR`: `~/.claude` and a second folder
(`~/.claude-work` in these notes, started by a `claude-work` wrapper). Every session read "claude".

- The hooks record `config_dir` and `profile` (hooks notes, "Profiles"); `session_start` and `prompt`
  carry them, the map entry too. `Store.setProfile` takes them from any hook event and from
  `applyMap` into `s.configDir` / `s.profile`; an event without them keeps what is recorded, so a
  session from before this picks them up at its next prompt.
- One label: `config.js` `agentLabel(agent, profile)` ("claude · work"; "default" or none adds
  nothing; at most 16 characters of profile; one argument is the bare kind, which the writer still
  uses to find `bin/adapters/<agent>/extract.sh`). It lives in `config.js`, not `words.js`, because
  `branch.js` is an engine file and needs it for the manifest: an engine file can only import engine
  files (`branch.js` now imports `./config.js`; the host copies carry both).
- Where it shows: the header pill (tooltip adds "Config folder: ~/.claude-work (profile work)."), the
  session menu's group key and head (`CLAUDE · WORK`, a group apart from `CLAUDE`) and each row's pill,
  the capture box's pill (from the map entry), and the manifest's Parent line:
  `app (claude · work) · pane t1z (session f5c4026f), depth 0`. The manifest records
  `parentProfile`; a manifest frozen before this shows `(claude)` from `parentAgent`, none if absent.
  The chip's `ag` is unchanged (`ledgr-pane` does not draw it).
- Branch and Resume: `configDirOf` prefers the recorded `configDir` (null when it is the default
  folder: profile "default" or a folder named `.claude`), else the transcript-path derivation as
  before. `transcriptPathOf` without a recorded transcript looks under the recorded folder.
- Tests: `test_store.mjs` "profiles" (31 checks: the label, the store picking a profile up from
  session_start, prompt (also local) and the map, keeping it across an event without one, surviving a
  save; the Parent line for the work profile and the default; recorded beats derived; resume argv and transcript path).

## 14. Closing-list mode on the lane, tool asks in the writer, the installer's MCP step (2026-11-06)

- The ASKED OF YOU head's "agent working" has a tooltip naming the mode (`HANDOFF_WORDS[handoffOf(cfg)]`,
  config.js; `laneHead` takes a `statusTip`). `adapters.js` `asksMode` reads `handoffOf` instead of
  `instruct_block`. `config.js` DEFAULTS carry `asks: {handoff: "ledgr"}`.
- `store.js` `on_asks`, `source: "tool"` (bin/mcp): `origin: "tool"` (words.js: "declared by the
  agent (tool)"), `quoteSource` `tool_unverified` until the Stop hook's re-emit, then `tool`. A
  mid-turn event (`tool_call` > 0) neither clears the turn's pending nor surfaces the chip; the Stop
  re-emit (no `tool_call`) does both. `replaces_turn: true` drops this turn's tool asks the new list
  no longer names unless touched (open, not promoted, no answer, no draft) - the rule of
  `tests/test_mcp.py` FakeWriter, plus the draft. A tool ask matches its item by turn and text
  whatever its quote became; an ask without an `options` key keeps the item's options and
  recommendation. Store tests: 21 checks ("tool asks").
- The chip record gains `o` (how the counted asks arrived, when one way); `ledgr-pane`'s tooltip adds
  ", declared by the agent (tool)".
- Installer: `HANDOFFS` question and `asks_handoff` answer (config `asks.handoff`, `instruct_block` =
  not prose; an older answers file or `--instruct-block off` without `asks_handoff` means prose;
  `--asks-handoff`), `--check` prints "closing list <mode>". The MCP step: "Register ledgr's MCP server
  with Claude Code so agents can declare asks without printing a block?" (default yes interactively;
  with `--yes` only when `mcp: true`, `--mcp on`, or it is registered already), then per chosen
  config folder the exact `claude mcp add --scope user --transport stdio ledgr -- <python3> -I -B
  <home>/mods/ledgr/bin/mcp/ledgr_mcp.py` (with `CLAUDE_CONFIG_DIR` for a non-default folder) and
  the three allow entries, each consented to; `apply_mcp` backs up `.claude.json` and the settings
  file first. `--check`: per folder "ledgr registered (user scope)" (read from `~/.claude.json` or
  `<folder>/.claude.json`, no claude call) and the allow entries, printing the command for a missing
  one (a failure only when the install chose MCP). The doctor also counts the last turns' sources from
  hook.log: block and tool together as "declared by the agent". Uninstall: `claude mcp remove --scope
  user ledgr` per registered folder and the allow entries with the hooks (original restored when only
  ledgr's entries differ). Installer tests: `test_handoff`, `test_mcp` (a fake claude; scratch only).
- Deployed with `--mcp off`: nothing registered, no Claude settings file written (mtimes unchanged).
  Later the same evening Jesse ran `./install.sh --yes --answers ~/.local/state/ledgr/last-install.json
  --mcp on`: `ledgr` registered for `~/.claude` and the second config folder (`~/.claude-work` here), both shown connected, the allow
  entries in both settings files, `--check` healthy.
- Live, writer path for tool asks: a throwaway session made of spool events (fake terminal
  `lt-tool1`): a mid-turn `asks` with `source: "tool"`, `tool_call: 1`, then `pending` and the Stop
  re-emit without options. The panel showed "Ask 1 · declared by the agent (tool) · blocking · turn 1"
  with its options while "agent working", then idle with the options kept, quote source `tool` and
  the uuid on both items; forgotten through a `forget` spool event, and the panel went back to
  following focus.
- preview.png retaken in authoritative mode (docs/preview-recipe.md rewritten): a throwaway Haiku
  session in a new space, its reply ending with `ledgr: 3 items for you, 2 blocking` and the bullet
  block, the panel with the same three asks; space closed and session forgotten afterwards.

## 15. Blocking while working, who closed an ask, answered then settled (2026-11-06)

Jesse: the blocking chip "doesn't consistently show", and clicking Done felt redundant after
answering an ask in the prompt.

- Chip (`store.js` `chips()`): `st` is `blocking` whenever `b` > 0, ahead of `collecting`; the old
  rule (`b && s.state !== "working"`) muted it on every prompt and through every permission wait. A
  working session adds `w: 1` to the record (`{s, q, a, st, t, ag, [b], [p], [o], [w]}`).
  `mods/ledgr-pane/main.js`: `pulseFor` skips the pulse while `w` is set and pulses when a loud chip
  stops working (`prev.w`), so a turn that ends still blocking pulses once; the header's own spinner
  shows beside the red chip; the tooltip adds " · agent working".
  `ledgr-pane.demo-chip:blocking-working` draws it. `host.js` reads `b`, which was never muted, and is
  unchanged.
- Folds (`store.js` `groupOpen({newest, blocking, unfolded, folded})`, pure; used by the asks lane in
  `panel.js`): open when the person opened the group, else when it is the newest or holds an open
  blocking ask, unless the person folded it. The group line drops its ", N blocking"; a folded group
  with a blocker shows a separate "◆ N blocking" in `blocked`, semibold.
- `on_act` (`store.js`): the item comes from `item`, else from `handle` (`byHandle`), and must belong
  to the event's session. `actor: "agent"` (the MCP server's `resolve_asks`, hooks notes "Closed by the
  agent"): only `resolve`, only an agent ask not yet closed (open, answered, deferred); it sets
  `resolvedBy: "agent"`, `resolvedTurn` from `turn` when it is a number, and `resolvedNote` from
  `note` (one line, 200 characters). Anything else from the agent is dropped. Any other actor (none,
  "person", unknown) is the person and goes through `act()` as before, so Done and Reopen still win.
- `setStatus` deletes `resolvedBy` and `resolvedNote` on every status change; the caller that closes
  an item on someone's behalf sets them after (`on_confluence_landed` sets `"branch"`). Before this, an
  item reopened and then closed with Done kept "resolved by its branch".
- `settleAnswered(s, turn, raised, at)`: called from `on_asks` after the re-raise rules, for any asks
  event that is not mid-turn (`tool_call` > 0), and for `skip`; `pending` and `error` never reach it.
  `raised` holds the items this turn's asks named again (a same-turn match, or a prior found by
  `repeat_of` or key); an answered ask among them has reopened in place as before. Every other agent
  ask still `answered` with `answeredTurn` at or before this turn becomes `resolved`,
  `resolvedBy: "answer"`; one answered later (a prompt that beat a slow extraction) waits for its own
  turn. An answer from before `answeredTurn` existed counts as given at its anchor's turn + 1.
  `on_prompt` now records `answeredTurn` for an `[A3]` ref (`on_answers_landed` already did). Parked
  questions keep `answered`.
- Words (`words.js` `resolvedByWords`): "resolved by its branch" (the panel adds the branch's name),
  "closed by the agent", "answered by you"; none for the person's Done. The Closed row reads
  "closed by the agent at turn N · note" or "answered by you at turn N" (the `answeredTurn`), and an
  ask settled by its answer keeps its `→ answer` line.
- `store.js` is an engine file: the overlay's `my-tabs` copy follows at the next `install.sh`.
- Tests: `test_store.mjs` "blocking while working, closed by the agent, answered then settled" (69
  checks; 458 in all): the chip blocking over working and collecting, `w`, the fold rule, agent acts
  (resolve only; never a parked question, an item already closed or another session's handle; the
  note; Reopen clears who closed it; an unknown actor is the person), answered asks settling at the
  turn's own asks event, a re-raise reopening in place, `skip` settling, a mid-turn declaration and an
  `error` not settling, a late answer waiting, a legacy answer settling, parked questions kept, and a
  settled ask raised again becoming a new item that points at it.

## 16. Paste into the prompt (2026-11-06)

Research earlier the same day: Claude Code offers no way for an outside process to type into a
running session, and a UserPromptSubmit hook adds context only the model sees. Jesse: "yes, build it:
focus the pane, confirm focus, paste, no Enter, lead-in kept". The answer sheet, one answer and the
confluence now land in the target's prompt; clipboard plus focus stays the fallback, and the rule for
everything else (Go to anchor, Copy for prompt, `/btw`, Ask for a conclusion: `stageText`).

- `nav.js` `stageIntoPrompt(text, terminal, cx, {paste, done})`, called from an event handler (the
  clipboard is written with that call's `cx`):
  1. `cx.write_to_clipboard(text)`.
  2. `pasteBlock(t, paste)` names a reason not to paste: `gone` (no terminal, or not live), `off`
     (`ui.pasteIntoPrompt` false), `plain` (no agent in `agents()`: a shell may run what a paste
     holds), `blocked` (the agent waits on its own prompt, such as a permission menu, not the input
     box). `pane.focus` runs unless `gone`. With a reason, `done({pasted: false, why})` is called at
     once and the reason returned; nothing else happens.
  3. Otherwise a `cx.spawn` task sleeps `PASTE.stepMs` (50) at a time up to `PASTE.waitMs` (600) and
     counts looks in a row where `focusedOn(t)` holds: `focused().terminal === t` and `shown` empty
     or `t` (no other terminal shown in that pane through `terminal.show`). At `PASTE.settle` (2) it
     reads the clipboard back (CRLF and LF compared as one); if it still holds the text it runs
     `run("terminal.paste")` once, with no arguments, and reports `{pasted: true, ms}`. The earliest
     paste is 100 ms after the click: never in the click's own tick, never on a focus still moving.
  4. Otherwise `{pasted: false, why}`: `focus` (never two looks in a row on the target within the
     wait), `clipboard` (it changed: the person copied something), `error` (a look threw). The text
     stays on the clipboard. The function returns `"pasting"`.
- `terminal.paste` is the command ⌘V is bound to: the clipboard into the focused terminal as a
  bracketed paste, no key names, no Enter. It takes no target, which is why the focus is confirmed
  first. `terminal.paste_image` (Ctrl+V's, which may hand the key to the program) is banned.
- `panel.js` `stage(msg, terminal, cx, w)` is the only caller (`w`: `{what, where, lead, word,
  tail}`). It sets `this.pasting`, ignores a second click within `PASTE.waitMs + 400` ms ("Still
  pasting into …"), shows "… copied; pasting it into the prompt in …" while the task runs, and the
  result's words after. Callers: `stageAnswers` (the group's Paste N answers and, through
  `copyAnswer`, Paste answer), `sendToTrunk` (Paste into trunk; it posts `conclude` only when `stage`
  took the click), `copyConfluence` (Paste confluence again). Demo mode writes the clipboard only
  (`demoHow`). `pasteOn()` is `ui.pasteIntoPrompt !== false`.
- `trunkLine(ts, it, staged)`: the Conclude editor's and the staged row's trunk line follow the
  setting. On: "Paste into trunk puts the message in its prompt without sending it; add a word of
  your own such as “Adopt this branch result for Q1:”, then Enter"; staged, "the message waits in its
  prompt (if not, Paste confluence again); …"; blocked adds "(nothing is pasted while it waits)";
  working says a prompt sent now joins the running turn. Off: the old lead-in-before-⌘V wording.
- `words.js` `stageLabels(paste)`: on, "Paste 2 answers into pane t3", "Paste answer", "Paste into
  trunk", "Paste confluence again" (menu: "Paste the confluence again"), the group's dim line "pasted
  into the prompt, never sent"; off, "Copy 2 answers for pane t3", "Copy answer", "Send to trunk",
  "Copy confluence again", "clipboard + focus the pane; nothing is typed". `stagedWords(r, w)`:
  pasted, "Answer for Ask 2 pasted into the prompt in pane t3, not sent: add a word of your own, such
  as “My answer to A2:”, then press Enter." (a working target adds "(working: press Enter once it is
  idle; a prompt sent now joins the running turn)"); one wording each for `gone`, `plain`, `blocked`,
  `focus`, `clipboard` and `error`, each saying nothing was pasted and how to go on; `off` keeps the
  old "copied and pane t3 focused: type “…”, then ⌘V, Enter."
- Config: `ui.pasteIntoPrompt`, default `true`, in `config.js` `DEFAULTS` and `ledgr_config.py`
  `DEFAULT_CONFIG` (the panel reads it; the Python copy keeps the defaults in step). The installer
  asks nothing; set it in `config.json`. `config.js` is an engine file: the overlay's `my-tabs` copy
  follows at the next `install.sh`.
- Unchanged: the marker lines and the landing (`ledgr_landing.py`); the lead-in, now a word the
  person adds to the pasted message before Enter (Claude Code presents a paste as possibly not the
  person's words; the message's closing line is already in their voice). A paste joins any draft
  already in the prompt: known and accepted, since nothing is sent. A working agent still gets the
  paste; the words say to press Enter once it is idle.
- Tests. `test-nav.sh`'s stub `herdr` gains `focused()` (a value, or a function of the look's number)
  and logs every look in call order with the commands. `test_nav.mjs`, 233 checks: for idle, done and
  working Claude Code and Codex targets, clipboard, `pane.focus`, two looks on the target, one
  `terminal.paste` (at 100 ms); a late focus (three looks elsewhere, then the paste right after two on
  the target); a flickering focus (nothing after the full wait); no focus (another terminal, a mod
  pane, no window); another terminal shown in the pane; a changed or empty clipboard; CRLF line ends
  taken as the same text; a look that throws; `off`, `blocked`, `plain` and `gone` with no task and no
  look; and over every call of every case, no `hc` or `exec`, only `pane.focus` and `terminal.paste`,
  no Enter, line break or key name in any argument, `terminal.paste` only without arguments.
  `test_no_keystrokes.py`, 313 checks: `terminal.paste` in `nav.js` alone, once, without arguments,
  inside `stageIntoPrompt` and after its `focusedOn(terminal)`, `PASTE.settle` and clipboard check;
  `terminal.search` and `terminal.paste_image` nowhere; no `run(...)` argument holding Enter, a line
  break, `keys` or `send`; `stageAnswers`, `sendToTrunk`, `copyConfluence` and `stage` call no `run`,
  `hc` or `exec` themselves; `stageIntoPrompt` has one caller, the panel's `stage`, which honours
  `ui.pasteIntoPrompt`. `test_store.mjs`: the default and every wording, on and off (20 checks, 478 in
  all); `test-store.sh` checks that `ledgr_config.py` agrees. `herdr-app check mods/ledgr` passes.
- Live probe (2026-11-06, throwaway panes, the primitives only): `pane.focus` returned in 15 ms,
  `focused()` named the target at 24 ms, `terminal.paste` succeeded, and `hc read` showed the probe
  text once, not submitted. A raw-byte probe received exactly `ESC[200~ … \n … ESC[201~`: a line break
  stays inside the bracketed paste rather than arriving as a bare Enter.

## 17. Off per space, Clear all questions, a blank line after a staged message (2026-11-07)

Jesse: "enable/disable per space" (he chose the full version: the hooks and the MCP server go quiet
too; their side is in `BUILD-NOTES-hooks.md` "Off per space"), "clear all questions" (scope: "shown
session, skip branched and rejoining questions"), and "when pasting an answer, you should add an empty
line. When I'm trying to paste multiple answers, they run together".

Files: `config.js`, `store.js`, `writer.js` (all three engine files: the overlay's `my-tabs` copy
follows at the next `install.sh`), `panel.js`, `capture.js`, `nav.js`, `words.js`; the spool
docstring (`bin/lib/ledgr_spool.py`) lists the new mod-written event.

### 17.1 Off per space

- Config: `spaces: {disabled: []}` in `config.js` `DEFAULTS` and `ledgr_config.py` `DEFAULT_CONFIG`
  (Herdr space ids, `sp` + 32 hex; names change, ids do not). An array, so a `config.json` value
  replaces the default whole. `test-store.sh` checks that the two defaults agree.
- `config.js` helpers: `disabledSpaces(cfg)` (strings only, each once), `spaceOff(cfg, space)` (a null
  space is never off), `withSpaceOff(cfg, space, off)` (a new list, the others kept in order),
  `terminalSpace(t)` (live: the `agents()` entry's `space`, else the `terminals()` entry's
  `herdr.space` label; null when unknown or when either call throws).
- Where a terminal's space comes from (`store.js` `spaceOf(t, s, live)`), in order: the terminal
  mapping's `space` (`d.terminals[t].space`, from the hooks' map record or events), else the session's
  `space`, else `live(t)` (the writer and the panel pass `terminalSpace`), else null, which is on.
  `isOff(t, s, live)` is true only when that space is in `spacesOff` (a `Set` the writer fills from
  `spaces.disabled`; empty means nothing is looked up).
- Store: `setSpace(s, r)` takes `space` from a `session_start` or `prompt` event, or a map record,
  only when the key is present (`hasSpace`); `spaceField(r, cur)` carries it onto the terminal mapping
  and keeps the old value when the new record has no key. `noteSpace(rec)` takes only the space from
  an identity-map record, onto the mapping and its session, and says whether anything changed.
  `chips(now, live)` skips every terminal for which `isOff` holds; items are never touched.
- Writer: `applyConfig` sets `live.spacesOff` and publishes `shared("ledgr.ui")` as `{animations,
  panel, off}` (`off` is the list, for the capture box before it has read `config.json`).
  `chipKey()` (threshold plus the sorted list) decides whether a config change republishes the chips,
  both in `watchConfig` and in the minute's safety net. `watchConfig` now also reacts to
  `ledgr-data/terminals/<t>.json` (not dotfiles, which are temp files): `refreshSpaces(paths)` reads
  those records (all of them, through `readMap()`, when the watch names only the root) and calls
  `noteSpace`; a change commits the store. `offEvent(ev)`: an `asks` event from a session whose
  terminal is in an off space does not set `newAsks`, so `surface.openPanelOnAsks` never opens the
  panel for it. `publish()` passes `terminalSpace` to `chips()`.
- Panel (`panel.js`):
  - `offState(st, s)` returns `{space, here}` or null. Demo: `demoOff`. With a session shown: its
    space (`sessionSpace`: recorded, else live) off gives the off state (`here` when the focused space
    is the same or unknown); a session pinned or picked from the menu (`override`) in an on space
    shows its lanes. Otherwise the focused pane's space (`focused().space`) decides.
  - Off: the header adds an `off` pill (`dim`); the list holds `offView` instead of `body`, the footer
    is hidden, nothing is marked seen and no branch messages are pumped. `offView`: "ledgr is off in
    this space" (or "ledgr is off in <name>" when it is not the focused space), a dim line (no chips,
    no ⌘J, no instruction or extraction; items kept), the primary button "ledgr on in this space"
    (`space-on`), and a line pointing at the session menu.
  - `spaceSwitch(t)`: the session menu's first row, only when Herdr names a focused space (always in
    the demo): `spaceToggleWords(isOff)` ("ledgr off in this space", or "ledgr on in this space" in
    `accent`), the space's name beside it (`spaceName`: `spaces()` by id, else `space <first 10
    characters of the id>`), a tooltip saying what goes and that items are kept. Session rows in an
    off space read "off" instead of "N open".
  - `setSpaceOff(space, off, cx)` updates `this.cfg` at once, then `saveConfig(edit, ok, fail, cx)`:
    the threshold menu's read, edit, `writeTextFile(…, cur)` compare-and-swap, now one helper for
    both (`setThreshold` uses it too); a file that is not a JSON object is left alone and the panel
    re-reads it. Flash on: "ledgr is off in <name>: no chips, no ⌘J, no instruction or extraction for
    its agents. Their items are kept; the session menu turns it on again." Off: "ledgr is on in <name>
    again." Demo: memory only, "(demo) … not saved."
  - Commands: `space:off`, `space:on`, `space:toggle` (the focused pane's space).
- Capture (`capture.js`): the box's space is the item's terminal's (Ask about this), else
  `focused().space`, else the focused terminal's live space. `off` is decided first from
  `shared("ledgr.ui").off`, then from `config.json` once read (the file decides). Off: `offBox`
  replaces the form (title, `OFF_HERE`, "Nothing is parked. The ledgr panel's session menu (›) turns
  it on again for this space.", an Esc hint), the keyboard goes to the box itself (`focusBox`), Esc,
  Enter or a click closes it, `park()` closes without writing, and no quote validation runs. Sessions
  in an off space (recorded space, else live) are dropped from the target list for every box.
- Words (`words.js`): `OFF_HERE` ("ledgr is off in this space"), `spaceToggleWords(off, here)`.
- Known: a branch launched into an off space records lineage (hooks) but sends no `branch_started`;
  the capture box over an off pane stays until dismissed.

### 17.2 Clear all questions

- Event: `{type: "clear_questions", session_id, keep: ["branched", "rejoin_pending"]}` (plus `id`,
  `at`, `terminal: null` from `post`), in `OWN_EVENTS`, so it never creates a session and is dropped
  for a forgotten or unknown one.
- `store.js` `isBranched(it)`: `it.rejoin`, status `rejoin_pending`, or a branch record for the item
  that is not `refused` or `failed`. `clearable(sid)`: `{clear, kept}` over the session's parked
  questions; `clear` is open or deferred without a branch, `kept` is open, deferred or
  `rejoin_pending` with one. `on_clear_questions` dismisses each of `clear` through `setStatus`, then
  sets `dismissedBy: "clear"` and `clearedAt`, and records `s.lastClear = {at, cleared, kept}`.
  Branched and `rejoin_pending` questions are kept whatever `keep` says. `setStatus` deletes
  `dismissedBy` and `clearedAt` on every change, so Reopen drops them. Closed, the archive and the
  snapshot treat a cleared item as any dismissed one.
- Panel: `clearButton(t, st, s)` in the YOUR QUESTIONS lane head (`laneHead`'s `extra`
  slot): idle `clearLabel(n)` "Clear 3" (`dim`, hover `foreground`), null when nothing is
  clearable; armed for `CLEAR_ARM_MS` (4000) `clearConfirm(n, kept)` "Clear 3 questions? 1 branched
  kept" (semibold, `blocked` on a `blocked` tint); then "Clearing 3…" until `store.json` has ingested
  the event (at most 15 s). `clearQuestions(s, cx)` arms, then posts and sets the status line to
  `clearedWords(n, kept)` "3 questions cleared, 1 branched kept"; with nothing to clear it says so.
  The panel overlays its own pending `clear_questions` (`localActs`) so the rows move at once; the
  demo applies it to the fixture store and saves nothing. Closed rows add the badge
  `dismissedByWords("clear")` "cleared". Command `clear-questions` (a click: twice to clear).

### 17.3 A blank line after a staged message

- `nav.js` `promptText(text)`: trailing line breaks become exactly `"\n\n"`; nothing else changes, so
  the marker stays the first line. `stageIntoPrompt` writes `promptText(text)` to the clipboard,
  pasted or not (also with `ui.pasteIntoPrompt` off and for every reason nothing is pasted), and its
  clipboard check compares with CRLF as LF and trailing whitespace ignored, so a clipboard that
  dropped or kept the trailing breaks still counts as ledgr's text. Demo copies use `promptText` too.
  `stageText` (Go to anchor, Copy for prompt, `/btw`) is unchanged, as is the stored conclude message.
- The landing parser reads a message with its blank line the same (`test-store.sh`), and two staged
  messages in one prompt land as two events (`ledgr_landing.detect_all`, hooks notes).

### 17.4 Tests

- `test_store.mjs`, 574 checks: the config helpers (default, the list as read, the switch, a
  terminal's live space, `loadConfig` replacing the list whole), the capture box's rule, the recorded
  space on sessions and mappings from map records and events, `chips()` leaving out a terminal in an
  off space (recorded, else live), `noteSpace` moving a terminal out of an off space, a null recorded
  space decided live; Clear all: what is cleared and kept (branched, `rejoin_pending`, a failed
  launch counting as none), the marks, Reopen dropping them, a second clear, the event dropped for
  an unknown or forgotten session, Closed, the archive and the snapshot. `test-store.sh`'s stub
  `herdr` gains `agents()`, `terminals()` and `readTextFile()` answering from `globalThis.__herdr`.
- `test_nav.mjs`, 256 checks: `promptText` (one empty line, CRLF and repeated breaks, idempotent, two
  pastes one blank line apart), every staged clipboard ending with it, the clipboard check taking the
  text with or without its trailing breaks.
- `test_no_keystrokes.py` 313, unchanged. `herdr-app check mods/ledgr` passes.

## 18. A writer that holds its claim but does not move (2026-11-19)

The incident: one drain applied its events, saved `store.json` (1.63 MB, through `writeLarge`) and
never returned. Its `finally` never ran, so `SpoolReader.running` stayed true and every later drain
returned at its first line; the 60 s tick still called `beat()`, so the claim stayed fresh, no host's
`probe()` (which only took a claim older than two minutes) and no panel fallback took over. 103 events
queued for hours, none lost. Which await hung is unknown. Herdr leaves a cancelled task's promise
pending for ever (`gpui-kit.d.ts` Task), and `writeLarge`'s `fs.writeFile`, read-back and `mv` had no
limit of their own. The rule since then: liveness is progress, not a timer.

### 18.1 What the claim carries

`shared("ledgr.writer") = {id, by, at, fault?, failed?, pass?, done?, stall?}` (`writer.js` `claim`):

| Field | Meaning |
|---|---|
| `at` | the beat, as before: every tick, on a health change, on a ping |
| `fault` | `store.json` cannot be written (as before), or, while the watchdog's finding has not come back, `stallText(stall)` |
| `pass` | `{at, step, since}`: the pass running at that beat (its start, the step it waits in, since when), else a start's (`start: <step>`); absent when idle. A claim that carried one is renewed when that pass or start ends (`claimedPass`), so it never goes stale by a minute |
| `done` | when the last pass ended (`SpoolReader.done`) |
| `stall` | the last finding: `{at, step, ms, n, kind: pass, start, house or spool, ok, back?, name?, retryAt?, tries?}` (`retryAt`, `tries`: backing off; `house`: a housekeeping run, section 19) |

Steps (`SpoolReader.step`, `Writer.saving`, `Writer.mark`): a pass is `list`, `read`, `apply`, `apply:
config.json`, `apply: re-anchor`, `apply: decisions.md`, `save`, then the save's own (`save: store.json
writeTextFile`, `… read again`, `… listing`, `… temporary copy`, `… read back`, `… mv`, `save:
snapshot.json`), `unlink`; a start is `start: claim`, `temporary files`, `config.json`, `store.json`,
`identity map`, `save[: …]`, `drain`, `spool/failed`. Housekeeping is no longer a step of a start
(2026-11-19, section 19): the start kicks it as its own task and returns; a run shows as `housekeeping:
<step>` (`plan`, `making archive/<dir>`, `writing archive/<dir>/<file>`, `reading back …`, `keeping
store.pre-retention-<ms>.json: …`, `save: …`) while no pass or start runs. A save step a pass waits on moves
the pass's `since`, so only one await that lasts too long is stuck, never a slow series.

### 18.2 Constants (`writer.js`)

| Constant | Value | Why |
|---|---|---|
| `PASS_STUCK_MS` | 90 000 | Every step is one await of milliseconds when the host answers; the limited ones stop at `SAVE_TIMEOUT_MS` (20 s) or exec's 30 s default, so 90 s is three times the longest and under the two minutes after which a claim nobody renews counts as abandoned. On the 60 s tick a stuck step is seen 90 to 150 s after it began. `words.js` `WRITER_STUCK_MS` and `ledgr_mcp.py` `WRITER_STALL_S` mirror it (tests check) |
| `TAKEOVER_STUCK_MS` | 240 000 | another host takes a fresh claim whose pass has not moved this long: the holder's own watchdog would have restarted it by 150 s, and a claim can be a minute old |
| `SAVE_TIMEOUT_MS` | 20 000 | each await of a save and of a start (`Writer.bounded`, `spool.js` `within`); the `mv` gets exec's `timeout` of the same and a limit 10 % longer so exec answers first |
| `MAX_UNSTICKS` | 3 | restarts in a row with no pass finished; the fourth finding backs off |
| `BACKOFF_MS`, `BACKOFF_MAX_MS` | 300 000, 1 800 000 | the first wait before the next restart, doubling each time up to the second |
| `WRITER_CHECK_MS` | 15 000 | how often a shown panel looks for a writer while the claim is gone or stuck |
| `WRITER_LOG_MAX` | 65 536 | bytes `ledgr-data/log/writer.log` keeps |

### 18.3 The watchdog and the recovery

- `watchdog(cx)`, first in `tick` and synchronous (it runs while every await waits): this copy's pass or
  start (`progress()`) in one step longer than `PASS_STUCK_MS`, or a start that ended without starting
  while this copy holds the claim (it threw: a read that got no answer). Then `unstick`.
- `checkWaiting`, in the tick after its drain: the spool's oldest event (its name begins with the time it
  was written) older than `PASS_STUCK_MS` while no pass runs and no save fault stands (that fault keeps
  every file waiting and is said already). The first time for a file: `unstick` (kind `spool`). Still
  there at a later tick: the finding stays (`fault` names the file), no second restart; gone: `ok`.
- `unstick`: the finding into `stall` (and `fault`), one `writer.log` line (the step, the pass's start,
  what the save chain waits in and since when, the last pass, the generation, the restart count),
  `abandon()`, and `regain()` while this copy holds the claim (a stuck start of a copy that does not:
  given up, the role left to `respond`/`probe`). `unstickRun` counts restarts since a pass last ended;
  past `MAX_UNSTICKS`, `backOff()`: `coolUntil` = now + `BACKOFF_MS`, doubling at each further finding up
  to `BACKOFF_MAX_MS`; the claim stays, renewed each tick (`cooling`), with `stall.retryAt` and `tries`
  and a fault that says when it tries again; no restart meanwhile (`respond` and `probe` wait too); at
  `coolUntil` it starts again if nobody holds the role, it still does, a panel's fallback does, or the
  holder has not moved. Why not give the role up (the first build did): with one host and the panel
  hidden or already shown, nobody takes it, the chips freeze until a relaunch and the status line says
  nothing (`writerHealthWords(null)`); a back-off keeps it visible, lets another host or the panel take a
  claim that does not move (`claimStuck` counts a stall with nothing running), and recovers by itself if
  the cause passes. Relaunching Herdr starts the copy afresh at once.
- `abandon()` is a new generation: `gen += 1`, `SpoolReader.abandon()` (`epoch += 1`, `running` and the
  pass cleared), a fresh `writeChain`, `watching` and `watchingConfig` cleared. Every `start()` calls it.
- `start()` checks it still holds the claim after its 500 ms wait before it sweeps (a copy that lost the
  race would fail the holder's `mv`), and writes `this.cfg` and the identity map to `this.live` only after
  checking it is still the latest. `sweep()` lists `ledgr-data`, unlinks each copy, and lists again; a
  listing that fails or a copy still there throws, so the start fails and the watchdog starts again. Once
  a listing shows none, none can land later: a save makes its copy before it asks `ok()`, and `ok()` is
  false for every save but the new generation's. (The review's case: a listing with no answer had
  counted as "nothing to remove", the restart applied and unlinked an event, and the old `mv` then put
  the old store back.)
- Why a given-up pass can do no harm, whenever its await settles: the reader returns after every await
  of a pass whose epoch is old (no unlink, no quarantine, no `running = false` for the pass after it);
  `applyBatch` returns false after every await when `current(gen)` is false (`gen` the latest and still
  `amWriter()`), so it applies nothing to the new store; a save of an old generation writes nothing more,
  sets no `storeText` and no fault (`saveStore`'s `go` and `writeStoreText` check `current(gen)` around
  every await; `writeLarge` asks `ok()` right before the `mv`, the only step that touches the file); a
  `writeTextFile` that lands late is refused by its own compare-and-swap once the file moved on; a late
  `mv` finds nothing, because `start()` removes `.store.json.large-*` and `.snapshot.json.large-*`
  (`sweep`) before it reads `store.json`. The unlink loop also checks `amWriter()` before each file: a
  role lost mid-loop leaves the rest to the next writer, whose store holds them (they were saved before
  the loop began).
- Why nothing applies twice and nothing is lost: the restart reads `store.json` from disk; an event the
  given-up pass saved is in its `ingested` ids and is skipped and unlinked; one it did not save is still
  in the spool and applied. A file is unlinked only after a save of the current generation resolved true.
- Takeover: `probe()` takes a fresh claim whose `claimStuck(w)` (a pass's `since`; or, with no pass
  running, an unrecovered stall: a restart in progress has a pass of its own) exceeds
  `TAKEOVER_STUCK_MS` at once (logged); the panel's `checkWriter` counts such a claim as no answer and
  starts its fallback. The new holder's `start()` (500 ms wait, sweep, read) is the same path as any
  takeover.
- The panel (`panel.js`): `tick` ticks its fallback whenever it is there and not retired, so its
  watchdog runs while it restarts or backs off (it read only while `amWriter()` before, and a fallback
  whose restart threw was never watched again); `checkWriter` retires and replaces a fallback that is
  neither writing, starting nor backing off (`writer.js` `fallbackDead`); `render` calls `checkWriter`
  whenever `writerWanted(claim, fallback)` (no claim, or a holder other than its own fallback stuck past
  `TAKEOVER_STUCK_MS`), at most every `WRITER_CHECK_MS`, not only when the panel is shown again. The
  status line says `words.js` `NO_WRITER` when there is no claim, and a fault or a stall before the
  fallback's own note.

### 18.4 Diagnostics

`ledgr-data/log/writer.log`: `<ms> <ISO> <role> <id8> <line>`, written by `Writer.log` (read, append,
compare-and-swap write; the mod has no append), never awaited by the writer's own work, each write
limited; kept to its last `WRITER_LOG_MAX` bytes on a line boundary. Lines: a start (why: no claim,
again, restart, from `<by>` (stuck); generation; store.json size; spool files taken in; back after …),
a stuck finding, a file still waiting after a restart, a takeover, a back-off and its end, a start that
failed, a save fault set or cleared. Nothing per event.

### 18.5 Also

- The corrupt-store copy at start (`store.corrupt-<ms>.json`) goes through `writeLarge`, so a store over
  1 MiB is kept too (`writeTextFile` refused it).
- `housekeep`, `scheduleSnapshot`, `watchConfig`'s reads (`loadConfig`, `refreshSpaces`) and the tick's
  reads are limited too; a housekeeping failure no longer ends a start (since 2026-11-19 housekeeping is
  not part of a start at all: section 19). The config and identity-map watch
  is one loop per generation, and the tick reads every map record's space again once a minute
  (`refreshSpaces(null)`), so a watch that stopped loses nothing for long. The tick checks its generation
  after every await before it writes.
- Appends (`decisions.md`; `archive/<month>.jsonl` until section 19 replaced the month files with files
  written once) go through `spool.js` `writeAtomicWith(path, next)`, which makes the text again from each read: `writeAtomic`'s retry wrote the text made from the
  first read, over a line that landed meanwhile. An archived item whose line is already in the month's
  file is not added again (a write that got no answer and landed late), and `decisions.md` skips a branch
  whose key is there, at each try. `writeAtomic` stays for whole files (`snapshot.json`), where its
  compare-and-swap refuses a late write once a newer one landed.
- Known limit: a batch's side effects (a branch launch, close or resume, an extractor retry: `launch`,
  `close`, `resume`, `retry` in `applyBatch`) are started after its save. If the pass dies after the save
  and before them, the restart skips the event as already ingested, so they are not started again; the
  start's fix-up then marks a branch still `launching` after 60 s as failed ("the writer restarted
  before the launch finished"). Starting them again could launch a second Claude session for one
  branch, so they are not; a branch that did launch sends its own `branch_started`, which marks it
  running again, and Retry, Close branch and Resume can be pressed again.
- Outside the mod: `ledgr_mcp.py` `writer_state` and `setup/ledgr_setup.py` `writer_report` read the same
  signals (spool times, `store.json`'s time, the claim Herdr keeps in `shared.json`), see
  `bin/mcp/README.md` and CLAUDE.md's decision log.

### 18.6 Tests

`test_writer.mjs` (252 checks; the herdr stub's hooks get the real function as their last argument,
and Node's `fs/promises` is patched through `syncBuiltinESMExports` where an await of the writer's own
fs must hang): `within` and the words; the reader alone (`abandon` with a late apply, a role lost
between unlinks); the incident's shape (the `mv` ran, its answer never came: the claim names the step,
the status line says no progress, the watchdog restarts from `store.json`, the event applied once, the
status line and `writer.log` say so); a given-up save whose `mv` runs late (nothing lands, nothing
recorded); a timed-out large write (`writeLarge` directly, and through a drain: a fault, the store
whole, the event applied once the host answers); an unreadable event that waits (one restart, then
named); restarts that never finish a pass (the back-off, the claim kept and said, doubling, then a
restart that works); a takeover by a second host with the old holder's `mv` settling late; `writer.log`'s
bound; the review's cases (12-17 in the file): a sweep that cannot list fails the start and a writer
starting from disk afterwards has every event; an old pass whose copy lands after the generation
changed moves nothing in (with an event applied after the restart, so the texts differ); a lost start
race; the config watch per generation and the map rescan; `writeAtomicWith` and `decisions.md`; a
panel-role fallback whose start hangs, restarted by its own tick. `test_settings.mjs` (743) drives a real
`Panel` with fake fallbacks: ticked while restarting, a dead one replaced, a starting or backing-off one
kept, `NO_WRITER` and a check from render, the stuck claim's words before the fallback's note.
Mutations checked by hand, a test failing for each: without the sweep, a lenient sweep, the epoch check,
the save's generation check, the unlink guard, `ok()` before the `mv` (section 13 alone), the claim check
before the sweep, `watchingConfig` in `abandon`, the tick's map rescan, `writeAtomicWith`'s re-made text,
the back-off; in the panel, ticking only a writing fallback, keeping a dead one, no check from render, no
`NO_WRITER`.

## 19. Retention: closed items and old turn records leave store.json (2026-11-19, uncommitted)

The spec is `docs/design/Retention.md`; this section is the store's and the writer's half as built (the
reading copies' half is `BUILD-NOTES-detail.md` 17). `store.json` was 1.76 MB (closed items 46 %, turn
records 30 %, open asks below the threshold 18 %), growing about 100 KB a day, so every save took
`writeLarge`. Three builders worked in parallel against one contract (A the store, B the writer and the
spool, C the reading copies), each in its own worktree with stand-ins for the others' files; the
integration put their files together, added a test across the seam and the installer's and the doctor's
parts, and took an outside review's fixes. Function names, not line numbers.

### 19.1 The store (`store.js`, `config.js`)

| What | Where |
|---|---|
| Closed items past `retention_days`, a dismissed one never before 7 days (the extractor's dismissed list and `snapshot()` look back 7), as copies | `archivable(days, now)`; `DISMISSED_DAYS` |
| `retention_days` read one way everywhere: whole days 1 to 30, rounded and clamped, else the default 3 | `config.js` `retentionDays`, `retentionDaysOf`, `RETENTION_DAYS` (the store, the writer, `settings.js`; the doctor's `retention_days_of` mirrors it) |
| Removal after the file is confirmed: only an item still closed and still the planned JSON (a confluence landing again or Forget's branch mark sets no `updatedAt`), counted on `session.archived` | `removeItems(list)` |
| Turn records past the newest `retention.turns`, and the heads of kept records past the newest `LIMITS.turnHeads`, planned with each record's own key, then cut only if still as planned; every record left made lean, an empty map dropped | `planSlim(keep, heads)`, `applySlim(plan)`, `leanTurn` |
| Leaner records from now on (no default `textPath`, no null field) | `on_stop`, `on_asks` through `leanTurn`; the settle entry's `textPath` is null for the default |
| An archived item back: its own id; its own handle unless another item holds it or it is at or above `nextHandle` (a session record made again), then the next handle and `handleWas`; `session.archived` lowered only for an items file's line | `restoreItem(record, {counted})` |
| The `restore` event: one of the panel's own events (never makes a session); always reopens (its `reopen` field is not read); `restore: {item, ok, error?}` in `apply()`'s result | `on_restore`, `OWN_EVENTS` |
| An act for an item no longer in the store: dropped, and said (`out.note`, the writer's note) | `on_act` |
| One safe name for a folder named after a session; the archive's name shapes | `config.js` `safeName` (re-exported by `store.js`), `ARCHIVE_ITEMS`, `ARCHIVE_LEGACY` (re-exported by `spool.js`) |

### 19.2 The writer (`writer.js`, `spool.js`)

| Constant | Value | Why |
|---|---|---|
| `HOUSE_SIZE` | 768 KiB | past it, a run within the hour (with `HOUSE_GROWTH`): room under the 1 MiB cap |
| `HOUSE_GROWTH` | 64 KiB | the growth since the last run's end a size run also needs: on the live data the store stays over `HOUSE_SIZE` after its trim, and an hourly run would write small files for ever; 64 KiB is about fifteen hours of growth, a quarter of the room to the cap |
| `ARCHIVE_FILE_MAX` | 512 KiB | the most text in one archive file, half the cap, so `writeTextFile` and `readTextFile` take it |

- `houseDue(now)`: the holder only, one run per generation (`this.house`), none within an hour of the
  last one begun (`houseTry`); then "first run" (`d.retention?.v !== 1`), "daily" (`d.houseAt` a day
  old), "size" (an hour old, the saved store over `HOUSE_SIZE` and `HOUSE_GROWTH` bytes past `houseEnd`,
  the store's bytes when the last run ended; none recorded after a relaunch: one run allowed).
  `applyConfig` forgets `houseEnd` when `retention_days` or `retention.turns` changes, so the installer's
  move of 14 to 3 or the settings row takes effect within the hour.
- `houseKick(cx)`, from the end of `start()` and of every tick: a due run as its own task, never awaited
  (a start answers no ping while it runs, and the first run writes dozens of files); `houseRun` is its
  promise, for tests. Housekeeping is therefore no longer one of a start's steps (18.1).
- `housekeep(cx, gen, why)`: the one-time copy on the first run (`store.pre-retention-<ms>.json` through
  `writeLarge`; without it nothing is archived), the plan, per session an items file and a turns file
  through `archiveLines` (split by `archiveChunks`; each file through `spool.js` `writeNew`: created with
  `writeTextFile`'s expected null, read back whole), removals after each confirmed file, one `applySlim`
  after the last session, `d.houseAt`, `d.retention = {v: 1, at}` on the first run, one save when
  something changed, one writer.log line when files were written or failed. A config that is not
  `config.json` as read (`_error`, or the built-in defaults after a read that got no answer) archives no
  item that run. Every await is bounded, named (`houseStep`: `progress()` shows `housekeeping: <step>`,
  stall kind `house`) and followed by `current(gen)`; `abandon()` clears `this.house`.
- Alongside drains, not under their guard: a spool event never waits behind a run, and the removals check
  again (`removeItems`, `applySlim`), so a change applied meanwhile costs at most a stale line in a file.
  Chosen over holding the drains back because a run's waits are file writes, and a drain held back that
  long is what the watchdog calls a stall.
- A `restore` gets its record before the batch applies (`applyBatch`): `ev.record` and `ev.record_error`
  dropped first (never the event's own), `spool.js` `archiveFileOf` (a plain items or legacy name only),
  `fs.readFile` bounded, once per file per batch, `archivedRecord` (the last line for the item, the
  session's). The event is always consumed; a failure is the writer's note.
- `LARGE_TMP` also matches the one-time copy's temporary file, so a start's sweep removes it.
- `spool.js` `within`'s limit promise is marked handled: a timer whose task came back empty (a test cx)
  still fires later, and nothing then listens to the limit.

### 19.3 Config, the installer, the doctor

- `retention` is a nested object in `config.js` `DEFAULTS` and `ledgr_config.py` `DEFAULT_CONFIG`
  (`turns: 12`), so Phase 2's keys sit beside it; both merges fill it into an older file.
- The hooks and the installer wrote every default into a new `config.json`, so older installs hold
  `retention_days: 14`. `setup/ledgr_setup.py` `migrate_retention` (from `apply_config`) moves 14 to 3
  once, records `migrations.retention_days` in install-state either way (a later 14 stays), and the Plan
  (`retention_pending`) and the summary say so.
- `--check`'s `retention_report`: the values as configured (and as the mod reads them), the store against
  the cap and `HOUSE_SIZE` (`writer_number` reads `writer.js`), the last run and the first, the archive
  (files, bytes, `session.archived`), the one-time copy; the unmoved 14 is its one problem.

### 19.4 The dry run

On a copy of the live `store.json` and `config.json` (offline, read-only on the live side), the real
`store.js` functions as housekeeping calls them: 1.80 MB to 0.87 MB; 387 closed items archived (384
resolved, 3 dismissed), 442 turn records cut, 210 heads moved; 48 files for 29 sessions, 918 KB, the
largest 116 KB; all 715 `textPath` values were the default turn file (builder A could not check that)
and none was left; nothing threw; the reading rule gave back all 387. At 14 days nothing would have been
archived, hence the migration. After the trim the store is still over `HOUSE_SIZE` (0.87 MB), hence
`HOUSE_GROWTH`.

### 19.5 Tests

`test_store.mjs` 1,120 checks (225 retention: the floor and the clamp, the re-check by JSON, plan and
slim with keys, leaner records, restore with handles and the legacy count, a re-raise after archiving, a
store of realistic size slimmed by exactly what goes, Phase 2's seams); `test-store.sh`'s Python block
(the hooks' defaults and merge, `DISMISSED_DAYS`, `safe_name` equal to `safeName`); `test_writer.mjs` 714
(sections 18 to 29: the first run on a 1.7 MB store, create-only names, a given-up run, a late write, an
item reopened meanwhile, the triggers with `HOUSE_GROWTH` and a retention change, a copy that cannot be
written, restore, no run outside the holder; 28, across the seam, with `reader.js` loaded beside the
writer; 29, a failed config read, an act for an archived item, an archive write timed out on a timer that
fires); `test_no_keystrokes.py` rule 14; `setup/tests` (the migration through a whole install, the
doctor). Mutations checked by hand against section 28, each failing it: the first file's line winning,
the count not lowered on a restore. The outside review ran its own mutations; two of its survivors were
real gaps and are tests now (the reader naming the folder by the raw id, the panel's own store-wins
filter on archived rows).

### 19.6 Known limits, not tried live

- On the live data the store stays over `HOUSE_SIZE` after the first run; with `HOUSE_GROWTH` a size run
  comes about once per 64 KiB of growth, so a session's folder gains a file or two a day.
- An act still in the spool for an item a run has just removed is dropped (the note says so).
- Forget leaves `archive/<session>/` on disk, as it leaves `sessions/`, `turns/` and `mcp/`: an open
  question for the maintainer; nothing is deleted.
- Not tried live: `writeTextFile(path, text, null)` refusing an existing file (`writeNew` relies on the
  typings); the first run on the real store; a new reading copy beside an old host engine before a
  relaunch (the old writer ignores a `restore`); the live check list is `Retention.md` 8.3.

## 20. Retention Phase 2: cold sessions (2026-11-19, uncommitted)

The spec is `docs/design/Retention.md` 10; this section is the store's, the writer's and the Python side's
half as built (the reading copies' half is `BUILD-NOTES-detail.md` 18). A session idle more than
`retention.coldDays` (7) moves its items and turn records to `ledgr-data/cold/<safe sid>.<ms>-<rand6>.json`
and keeps its record in `store.json` as a stub with its counts. Four builders worked in parallel against
one contract (A the store, B the writer and the spool, C the reading copies, D the Python readers, the
installer and the doctor); the integration put their files together, fixed what crossed the seams, closed
the design holes they reported, and wrote `tests/test_seams.mjs`. Function names, not line numbers.

### 20.1 The store (`store.js`, `config.js`, `ledgr_config.py`)

| What | Where |
|---|---|
| `retention.coldDays`, read one way: a whole number, 0 kept (never; every cold session comes back), any other value rounded and at least 1, a number or a numeric string; missing, not a number, negative or over 365: 7 | `config.js` `coldDaysOf`, `COLD_DAYS`; `DEFAULTS.retention.coldDays`; `ledgr_config.py` `DEFAULT_CONFIG["retention"]["coldDays"]`; the doctor's `cold_days_of` |
| The names | `config.js` `coldDir`, `coldPath`, `heldDir`, `COLD_NAME`, `coldName` |
| The record check every reader makes (format, version, session, items of that session with ids, turn records a map) | `coldRecordError` (Python's `cold_record_error` word for word) |
| The events that never need a session warm; the error `apply()` throws rather than apply to a cold session | `COLD_FREE` (the pin ops, `forget`, `cold_reset`), `ColdError` (`.cold`: the sessions); `OWN_EVENTS` gains `cold_retry`, `cold_reset` |
| Lookups | `isCold`, `isMerged`, `coldSessions`, `coldFaults`, `mixedCold` |
| The idle clock: the record's times (not `seenAt`), every item's `updatedAt`, every turn record's `stopAt`, `asks.at`, `retry.at`; `apply()` moves `touchedAt` for every event of a warm session but the pin ops and an act `seen` | `touchedAt(sid)` |
| Counts by level, and the counts at the threshold (from the stub's `n` for a cold session not merged) | `coldCounts(sid)`, `countsOf(sid)`; `chips()` reads `countsOf` and `n.qNew`, and leaves out `o` |
| Why a session cannot go cold, whatever its clock | `freezeBlocker(sid)`, `safeNames()` |
| The plan (changes nothing; oldest idle first; each `{sid, record, sig}`) | `planFreeze(days, now, {canFreeze, max})`, `coldSig` |
| The commit: everything checked again, then in one step the clock carried onto the stub (`touchedAt`), the items and turn records out, `cold: {file, at, n}` in | `commitFreeze(done, now, {canFreeze})` |
| Which cold sessions an event or a batch needs (an act `seen` needs none) | `coldOf(ev)`, `coldNeeded(events)` |
| Back: the store's copies win, a gone branch's mark dropped, `nextHandle` raised past the file's and every handle held, a file item whose handle the store's own items hold renumbered (`handleWas`), `thawedAt = touchedAt = now`, the file added to `coldThawed` (the newest `COLD_THAWED_MAX`, 8) | `thaw(sid, record, file, now)`, `raiseHandles` |
| A reading copy's view (copies beside the stub, `cold` unchanged, out of `toText()` and `snapshot()`) | `mergeCold`, `unmerge`, `unmerged`, `mergedIds`; `this.merged` on the instance, never in `d` |
| A file the writer could not read | `coldFault(sid, error, now, heldDelta)` |
| Try again; Use without its older items (`coldLost: {file, at, frozenAt, n, error}`) | `on_cold_retry` (changes nothing), `on_cold_reset` |
| The sweep's proof: by name only a file the record lists as thawed (past the grace) or a forgotten session's (past the keep time); the unnamed rest a read must prove (one recorded session, not faulted, not listed, over the keep time, oldest first); what a file holds that the store lacks (items by id, also in `ids`; turn records by key, also in `turns`, or older than the oldest kept); the thawed lists trimmed | `coldGarbage`, `coldUnproven`, `coldLacks(sid, record, {ids, turns})`, `trimThawed(present, now, {keepMs})`, `coldNames`, `coldFileOf`, `thawedEntry` |
| `snapshot()` gains `cold: {sid: {file, fault}}`; `restoreItem` returns null for a cold session; Forget drops a merge | `snapshot`, `restoreItem`, `on_forget` |

### 20.2 The writer (`writer.js`, `spool.js`)

| Constant | Value | What |
|---|---|---|
| `COLD_RUN_MAX` | 40 | sessions per freeze run |
| `COLD_RUN_MS` | 60 000 | no session begun in a freeze run after this |
| `COLD_THAW_MAX` | 50 | sessions read per pass; the rest go to the next, which the writer pokes |
| `COLD_RETRY_MS` | 600 000 | how often a faulted session's file is tried again |
| `COLD_GRACE_MS` | 3 600 000 | a thawed file kept at least this long after the thaw |
| `COLD_KEEP_MS` | 86 400 000 | a forgotten session's file, or a stale one nobody committed, kept at least this long |
| `COLD_EVERY_MS` | 3 600 000 | one cold run (freeze, then sweep) an hour, from the tick (in memory: the first tick after a relaunch runs one) |
| `COLD_CHECK_MAX` | 4 | unnamed files the sweep reads in one run to prove them redundant |
| `COLD_TIMEOUT_MAX` | 3 | reads of one session's file that got no answer, in a row, before it is faulted (three bounded reads a pass or more apart: about the watchdog's one restart) |

- `spool.js` `writeNew(path, text, {cx, ms, ok, step, drop})`: create-only through `writeTextFile`'s
  expected null at or under the cap; past it, `isThere` (a listing) then `fs.writeFile` to the new name and
  `fs.readFile` back. `drop` removes a file this call may have written and could not confirm. Called in
  exactly three places: `archiveLines` (Phase 1), `freezeRun`, `holdEvent` (`test_no_keystrokes.py` rule
  14). `SpoolReader.poke(cx)`: a pass even with nothing in the spool (`want`). `quarantine` takes a held
  event's own `path`.
- State on the `Writer`: `wantThaw`, `heldSids` (the folders under `cold/held/`), `heldSkip` (held files
  that do not parse), `coldTried`, `passSids`, `coldAt`, `snapOk`, `coldKept` (files the sweep keeps for good:
  read once per writer, said once).
- The freeze: `houseKick(cx, {tick: true})` → `coldHouse` (`listHeld`, `freezeRun`, `coldSweep`), after
  Phase 1's run when both are due, in the same `this.house` so one run holds the housekeeping at a time.
  `coldDue` (the holder, not starting, no run of this generation, Phase 1's first run done, an hour since
  `coldAt`). `freezeRun` and `canFreeze` as `Retention.md` 10.2 and 10.4.
- The pass: `applyBatch` sets `passSids` and calls `applyPass`: `replayFolders`, then rounds of
  `coldPhase` (`readCold`, `store.js` `thaw` or `coldFault`, `heldIn`, `holdEvent`), the config read for a
  `branch`, `attachRestores` (Phase 1's restore pre-read, now per round), the synchronous `coldNeeded`
  check (at most three rounds), the apply loop, the save, a second `snapshot.json` write when a session came
  back and the first failed, then `coldDone`. `readCold` → `{record}`, `{error}` or `{transient}`;
  `heldEvents(folder)` → the held events in name order.
- The sweep: `coldSweep` (`Retention.md` 10.8): `store.json` read again first (not the text last read or
  written: nothing saved or removed), by name, then by content (`readCold` of the file, of the session's named
  file, `archiveCopies` of its archive, `store.js` `coldLacks`, version by version, against `store.json` as
  read), then `trimThawed`; `keepCold` logs a file kept for good once. `readCold`: only a read with no answer
  is transient (`coldTimeouts` counts them; the third in a row is an error); any other read error is an error,
  worded "missing" only when a listing (`spool.js` `isThere`) shows the file is not there, else "is there but
  could not be read". A wanted read that is transient sets `ps.wantStop`: no other wanted read that pass, and
  no poke for them (the tick tries again).
- The tick and the start: `coldTick` (`wantThaw` from `coldDays` 0 through `thawAll`, due retries and
  `mixedCold`; true when a pass is wanted, then a `poke` instead of a `drain`); the start lists `cold/held/`
  and pokes once. `applyConfig` with `coldDays` 0 pokes at once.
- Left alone while cold: `track` (and its pending status turns), the interrupt check, `runRetry`'s result.
- Step names (the claim's `pass`, `progress()`): in a start `start: cold/held listing`; in a pass `apply:
  cold <sid8>` (` read`, ` listing`), `apply: held <folder8>`, `apply: held <name>`, `apply: hold <name>`
  (`: write`, `: read back`, `: removing a broken copy`), `apply: held <name> to spool/failed`, `apply: held
  <name> done`, `apply: held <folder8> done`, `save: snapshot.json again`; in housekeeping (shown as
  `housekeeping: …`) `cold/held listing`, `freeze: plan`, `freeze: making cold/`, `freeze <sid8>` (`: write`,
  `: read back`, `: listing`, `: removing`), `freeze: config.json`, `freeze: removing <file>`, `save`,
  `cold sweep`, `cold sweep <name>`, `cold sweep: reading <name>` (` read`, ` listing`), `cold sweep: archive
  <items file>`.
- `writer.log` lines: `Retention.md` 10.13. The writer's note (the fallback panel's status line): `N
  session(s) to bring back from cold/ first; the next pass goes on`, `<name> could not be kept in
  cold/held/<folder>/; it stays in the spool`, `<why>; tried again at the next pass` (a read with no answer),
  `snapshot.json not written after sessions came back from cold/; the extractor and the MCP server read them
  from their files until the next save`.

### 20.3 The Python side (`ledgr_extract.py`, `ledgr_mcp.py`, `setup/ledgr_setup.py`)

- `ledgr_extract.session_items(sid)` → `(items, cold)`, `snapshot_copy`, `cold_record_error`,
  `cold_record`, `session_of`; `recorded_asks` and `tool_asks` read through it.
- `ledgr_mcp.py`: every session read through `session_items`; `held_ids(kind, ev_ids)` (the server's own
  event copies in `cold/held/`, by id); `wait_handles` and `wait_applied` return `held` when found there;
  `cold_now`, `cold_broken`, `cold_words`, `cold_why`; `resolve_asks` sends an ask it cannot look up by
  handle (`item: null`, `unchecked`). The instructions' sentence covers "ledgr cannot read this session's
  earlier items". `bin/mcp/README.md`, Cold sessions.
- `setup/ledgr_setup.py`: `cold_report` in `--check` (with `cold_file`, `cold_lacks`, `archive_ids`: every
  unnamed file classified as the writer would, recoverable ones as problems); `--thaw-all` (`cmd_thaw_all`,
  `write_cold_days`, `writer_claim_of`, `writer_settled`, `THAW_WAIT_S` 120, `THAW_POLL_S` 1, `THAW_CONFIRM_S` 2,
  `CLAIM_LIVE_S` 300, `HELD_STALE_S` 3600); `RETENTION_DEFAULTS` gains `coldDays` 7.

### 20.4 What the integration changed

- `test_no_keystrokes.py`: rule 14's `writeNew` check names its three callers; rule 15 is new (only
  `writer.js` and `spool.js` write, unlink, make or remove anything under `cold/`, and in `writer.js` only in
  `freezeRun`, `coldSweep`, `holdEvent` and `coldDone`; `readCold`, `heldEvents`, `listHeld` only read; a cold
  file is unlinked in two places; `heldDir(` is the writer's; the Reader's cold methods only read and
  `coldRetry`/`coldReset` post one event each; the Python readers open cold files to read only). Its method
  finder now takes one level of parentheses in a parameter list (`st = this.viewStore()`).
- `test-store.sh`: the Python defaults hold `coldDays` 7, and the merge fills and keeps it.
- The idle clock (`store.js` `touchedAt`, `apply()`, `listing.js` `touchedOf`): `seenAt` and an act `seen`
  no longer move it; `commitFreeze` carries the clock onto the stub. Builder C found both: a stub read only
  its record's times, and a look at a cold session made its menu row say "idle 1 min".
- `panel.js` `coldWait`: a handle command on a cold session not read yet reads the file and then runs,
  instead of "No A1 in this session" (C); `olderAuto`: the OLDER THAN A DAY fold stays open a day after a
  thaw, found by `test_seams.mjs` (the first act folded every row away).
- `ledgr_mcp.py` `wait_handles` and `cold_now`: `held` only from the event's copy in `cold/held/`. Builders
  B and D found that a `snapshot.json` the writer could not write after a thaw (twice) still names the
  session cold, and the server then called an applied event held. The writer's note says what it means now.
- `bin/mcp/README.md`: the held rule, the repeat limit, the count.
- `tests/test_seams.mjs` and `tests/test-seams.sh` (in `run-all.sh`): `Retention.md` 10.12.

### 20.5 The outside review's findings (2026-11-19, the same day)

| Finding | As built | Tests |
|---|---|---|
| Blocker: the sweep deleted the only copy of a cold session's items once `store.json` had lost its stub (a corrupt store at a start, a store put back from an older copy, a reset with another file on disk) | `Retention.md` 10.8: by name only a file the record lists as thawed (`coldThawed`, new) after the grace, or a forgotten session's after the keep time; every other unnamed file read and deleted only when nothing in it is missing from `store.json` as on disk, the session's named file or its archive; otherwise kept for good, said once in writer.log, listed by the doctor; a reset lists nothing; the fault view and the doctor name a faulted session's other files; the manual recovery documented, and a merged file's clashing handles renumbered | `test_store.mjs` 13; `test_writer.mjs` 52a (the three triggers, an orphan proven through the store and the archive, a self-mutation of `coldLacks`); `test_seams.mjs` f; `test_detail.mjs` (the fault view's other file); `setup/tests` (`cold_report`, `cold_lacks`) |
| A safe name beginning with "." could be frozen but never read back | `freezeBlocker` refuses it; `readCold` and `ledgr_extract.cold_record` take such a name only as its own session's; `listHeld` keeps a known session's dot folder | `test_store.mjs`; `test_writer.mjs` 52b; `test-store.sh` |
| An fs error other than "not found" faulted the session as missing | after the second review: every read error but a timeout faults that session alone, worded "is there but could not be read" when a listing finds the file; three timeouts in a row fault too | `test_writer.mjs` 38, 52c |
| Third review: a later `updatedAt` counted as proof, so a backup put back and touched once (Done, Promote) deleted the file holding the draft and the resolution | identical copies only, in `coldLacks` and `cold_lacks`; the doctor's line says such a file may also be an older version of items the store still has; the skip note says "tried again at the next"; a timeout count forgotten after `COLD_RETRY_MS` | `test_store.mjs` 13; `test_writer.mjs` 38, 52a, 52f (the reviewer's two, the later version flipped to kept); `setup/tests` |
| Second review: the proof checked ids, not versions; turn records "older than the oldest kept" counted as cut; archive lines of other sessions counted; the sweep decided from the text last written, not store.json as on disk | `coldLacks`/`cold_lacks` version by version (identical copies only since the third review), turn records only by an identical copy or the turns archive, per-session lines, store.json read again first | `test_store.mjs` 13; `test_writer.mjs` 52f (the reviewer's state loss, a later version, turn records, another session's line, a replaced store, the two content-step guards each killing its mutant); `setup/tests` |
| Wanted-only thaws could hold a pass for minutes | the first transient wanted read stops the others and their poke | `test_writer.mjs` 52d (it also caught the poke loop the first version of the fix made) |
| `--thaw-all` could say "no cold sessions" while a freeze commit was still saving | `writer_settled`: the claim renewed after the write and out of housekeeping, or no writer alive; none cold seen twice | `setup/tests` (a late commit, a live writer that never renews, a writer long gone); `test_seams.mjs` g (against the real writer) |
| Rollback without `--thaw-all`: an `[A1]` answer to a cold ask dropped, a re-raised ask duplicated | documented (`Retention.md` 10.11) | `test_seams.mjs` h with `LEDGR_OLD_BUILD` (nothing lost, handles unique, turns merged) |
| Two guards masked by others (`heldIn`'s spool-twin dedupe, by `ingested`; `parent_session_id` and `for_session` in `passSids`, by the pre-apply check) | unchanged | `test_writer.mjs` 52e, each killing its mutant |

### 20.6 Tests

`test_store.mjs` 1,809 checks (689 cold sessions); `test_writer.mjs` 1,151 (sections 30 to 52);
`test_seams.mjs` 136 (143 with `LEDGR_OLD_BUILD`); `test_mcp.py` 162; `test_no_keystrokes.py` 1,082;
`setup/tests` 217. The reading copies' counts are in `BUILD-NOTES-detail.md` 18. Mutations checked by hand: a
reading-copy method that unlinks under `cold/`, a write in `canFreeze`, and a Python cold read opened for
writing each fail rule 15; D's `cold_now` restored fails the two stale-snapshot cases of `test_mcp.py`;
`coldLacks` switched off fails 52a; the two masked guards removed fail 52e; `writer_settled` always true fails
the late-commit case of `setup/tests`.

### 20.7 Known limits, not tried live

`Retention.md` 10.12 (not tried live) and 10.14 (known limits). The dry run of 10.12 found that the live
`config.json` still says `retention_days` 14 and Phase 1 has not run on the live store: Phase 2 freezes
nothing before Phase 1's first run has finished, and the installer's move to 3 days decides how far under
the cap the store lands.

Pins (2026-11-07: the PINS lane, search, Ask here, the hold control, the box's ⌘S): `BUILD-NOTES-pins.md`.
