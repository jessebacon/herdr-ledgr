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
also `extract.threshold` "needed" and `ui` `{foldAsksWhileWorking: false, animations: true}`) for a
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
- `hc keys <t> ctrl+o /`; the `bad-*` quarantine; the 14-day archive; `openPanelOnAsks`: coded, not
  exercised.
- Extraction: turns up to 14:55 ended in "no credential"; from 15:01 the model path works (the Keychain
  item was fixed meanwhile). Those older turns still show "asks not extracted" with Retry.

## 10. Fold ownership, ask severity, motion (2026-11-05, after the spacing commit 692dbcb)

Three changes, in this order, deployed with `./install.sh` each time (check green for all three mods,
engine copies identical). Hooks half: `bin/BUILD-NOTES-hooks.md`, "Severity".

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

