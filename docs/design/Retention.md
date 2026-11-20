# ledgr retention: design specification

Date: 2026-11-19. Status: Phase 1 built the same day by three builders working in parallel against one
contract, integrated in the main tree on top of commit c1c7775, uncommitted; the offline suites pass;
the live check (8.3) is pending. Phase 2 (cold sessions: an idle session's items and turn records in a file
of its own, 10) built the same day by four builders against a second contract and integrated on top of
Phase 1, uncommitted; the offline suites pass; its live check (10.12) is pending.
An outside review's fixes of the same day are folded in as built behaviour. Builds on `Herdr ledger mod design.md`
(Phases 1 to 3, the store and the writer), `Detail.md` (the list and the dialog), and the build notes
in `docs/build-notes/` (`BUILD-NOTES-mod.md` for the writer, `BUILD-NOTES-detail.md` 17 for the reading
copies).

`store.json` is the one place a change counts, and the writer writes it whole after every change. It
had grown to 1.76 MB, past the 1 MiB that Herdr's `writeTextFile` takes, so every save went through the
slow path the writer had stalled on. Retention takes out of the store what nobody is waiting on: closed
items past `retention_days` (3 days) and turn records past the newest `retention.turns` (12) of each
session. Each goes first into a new file under `ledgr-data/archive/<session>/`, written once and read
back, and only then out of the store. Nothing is lost and nothing becomes unreachable: the panel's
CLOSED fold still lists archived items, the dialog shows one whole, read-only, and Reopen brings it
back under its own id and handle.

The maintainer's words, 2026-11-19: "now scope the retention work for the store"; then, on the scope,
"parallel the work and do it asap".

## 0. Decisions at a glance

| Topic | Decision | Section |
|---|---|---|
| What leaves the store | Closed items past `retention_days` (default 3, was 14; whole days 1 to 30; a dismissed item never before 7 days); turn records past the newest 12 per session; the `textHead` of kept records past the newest 2 | 2 |
| What never leaves | Open, answered, deferred and rejoining items, however old; pins; sessions, branches; the newest records of each session | 2.3 |
| Where it goes | New files, `archive/<session>/items-<ms>-<rand6>.jsonl` and `turns-<ms>-<rand6>.jsonl`, each written once (create-only), read back, at most 512 KiB; never appended to, never rewritten | 3.1 |
| Leaner records | A turn record no longer stores the default `textPath` or null fields (lossless: every reader falls back), from now on and for the records kept | 2.2 |
| Reading rule | An id the store holds wins over any archive line; for one id, the newest file's last line | 3.2 |
| Before the first run | The store as it was, kept once in `store.pre-retention-<ms>.json`; without that copy nothing is archived | 3.4 |
| When | The first start after the upgrade; then once a day; and within the hour once the saved store is over 768 KiB and has grown 64 KiB since the last run ended | 4.1 |
| How the writer runs it | Its own task, kicked from the start's end and every tick, never awaited; one run per generation, at most one begun an hour; each file a named step the watchdog sees | 4 |
| Removal | Only after the file holding it is confirmed, and only what is still as planned (drains run meanwhile) | 4.2, 4.3 |
| Restore | A `restore` event (the dialog's Reopen); the writer reads the line from the file the row names and attaches it; the item comes back open, under its own handle unless another item took it; always consumed, a failure reported | 5 |
| The list | CLOSED ends with `archived (N) · show`; shown, the archived rows (state word "archived", dim, no quick action) | 6.2 |
| The dialog | An archived record whole, read-only, its one action Reopen | 6.3 |
| Settings | One row, "Closed items stay in the list", 1 to 30 days | 6.4 |
| Old configs | Existing installs hold 14 (the old default was written into every new config.json): the installer moves it to 3 once, recorded in install-state | 7.2 |
| Doctor | `--check` reports the store against the cap and the threshold, the values, the last run, the archive and the copy; 14 not moved is a problem | 7.3 |
| Phase 2: cold sessions | A session idle more than `retention.coldDays` (7) moves its items and turn records to `cold/<safe sid>.<ms>-<rand6>.json`, its record staying as a stub with its counts; it comes back before any event of it applies; showing it reads the file | 10 |

## 1. Why

Measured on the maintainer's store on 2026-11-19: `store.json` 1.76 MB, growing about 100 KB a day.
Closed items were 802 KB (46 %), turn records 526 KB (30 %), open asks below the threshold 308 KB
(18 %), everything else about 107 KB (6 %).

Herdr's `writeTextFile` refuses a file over 1 MiB, so since 2026-11-12 every save has gone through
`writer.js` `writeLarge` (a temporary copy with `fs.writeFile`, read back, then `mv`). That is the path
the writer stalled on (2026-11-12, and twice on 2026-11-19: the watchdog, the save limits and the
progress in the claim came from those). A store under the cap is saved with one `writeTextFile`
compare-and-swap again.

The old archive (`housekeep` until c1c7775: once a day, closed items older than 14 days appended to
`archive/<yyyy-mm>.jsonl`) had two defects and never did anything:

- Nothing read it. An archived item vanished from CLOSED and could not be read or reopened.
- A month file was appended through the capped text write (`writeAtomicWith`), so a busy month would
  have passed 1 MiB and stopped archiving.
- With the default of 14 days nothing on the live store was ever old enough (the dry run of 8.2 finds
  none at 14 days), while turn records, which nothing trimmed but `turnRec`'s cap of 60 per session,
  grew with every turn.

## 2. What leaves the store

### 2.1 Closed items

`Store.archivable(days, now)`: the items `isClosed` (resolved or dismissed) whose
`resolvedAt` (else `updatedAt`) is older than `days`; a dismissed one only past `max(days, 7)` days
(`DISMISSED_DAYS`), because the extractor's dismissed list (`ledgr_extract.py` `DISMISSED_DAYS`, 7) and
`snapshot()` look back 7 days, so a re-raise still finds, and names, the item it repeats. `days` goes
through the one clamp every reader of `retention_days` uses, `config.js` `retentionDays` /
`retentionDaysOf` (the store's `archivable`, the writer's housekeeping, the settings row): whole days
from 1 to 30, a number or numeric string rounded and clamped, anything else the default 3; a
hand-written 0 is one day, never "archive at once". It returns copies, as `store.json` holds them now:
each is the line its archive file gets and what `removeItems` compares the store with afterwards.
Closed parked questions archive like closed asks.

`Store.removeItems(list)` runs once the file holding them is confirmed. It removes an
item only if the store still holds it, still closed and exactly as planned (its JSON equal to the
planned line, not only its `updatedAt`): one reopened or changed in any way while the file was written
stays for the next run, and its line in the file is stale and harmless (3.2). Each removal adds one to
its session's `archived` count (absent means 0; no session record is made for an item whose session is
not recorded). It returns the items removed. `nextHandle` is not derived from items, so a handle is
never handed out again by the store (5 says how a restore keeps it so).

### 2.2 Turn records and heads; leaner records

A turn record (`d.turns[sid][turn]`) carries the turn's stop time, the prompt id, the message uuid, the
extraction's result (`asks`), a retry (`retry`), its text file's path and the reply's first 400
characters (`textHead`, read only when the turn file is gone).

`Store.planSlim(keep, heads = LIMITS.turnHeads)` plans without changing anything: per
session, by turn number, every record past the newest `keep` goes in `cut` (a deep copy of the record);
every kept record past the newest `heads` that still has a `textHead` goes in `heads` (`{sessionId,
turn, textHead}`). Each entry carries the record's own key as the map holds it, so a key written "07" is
found and removed as "07". The writer passes `turnsKept(cfg)`: `retention.turns` as a whole
number from `LIMITS.turnHeads` (2: fewer would cut the turn a live session is in) to 60 (`turnRec`'s
cap), else 12.

`Store.applySlim(plan)` runs once per run, after every session's turns file is
confirmed: a cut record goes only if it is still the planned JSON text, a head only if the record still
holds that text; one that changed since stays for the next run. Then every record left is made lean
and a session left with no record loses its empty map. It returns `{cut, heads}`. One call per run, not
per session: making records lean changes every session's records, so a call per session would leave the
next session's planned records "changed" and keep them.

Leaner records (`leanTurn`): a record does not store `textPath` when it is empty or the
default turn file (`config.js` `turnPath(sid, turn)`, or the relative `turns/<sid>/<turn>.md`), and drops
null fields at its top and in its `asks` and `retry` sub-records. Lossless: every reader falls back to the
default path (`reader.js` `loadPassage`, `detail.js` `branchText` and `pumpBranch`, the writer's re-anchor
through `on_stop`'s settle entry, whose `textPath` is now `null` for the default) and reads those fields
with `?.` and `??` or tests them for truth. `on_stop` and `on_asks` make new records lean; `applySlim`
does the same for the records kept, so nothing needs an archive line for it. A `textPath` elsewhere is
kept. `stopAt`, `asks.at` and `retry.at` are kept, and no `updatedAt` is added.

`turnRec`'s hard cap of 60 records per session stays, a safety net between runs.

### 2.3 What never leaves

- Open, answered, deferred and `rejoin_pending` items, however old. Open asks below the threshold are
  18 % of the measured store; they stay until Phase 2 (10).
- Pins: they are not items (`Pins.md` 1.1), and permanent.
- Sessions, branches, terminals, `ingested`, the newest `retention.turns` records of each session (and the
  newest 2 keep their `textHead`).
- An item or record whose session id names no folder (`archiveDir` null: empty, `.` or `..`).
- `snapshot()` is unchanged: it never held closed items past 7 days.

## 3. The archive files

### 3.1 Names and formats

Under `ledgr-data/archive/`, one folder per session, `<dir>` = `config.js` `safeName(sid)`: every
character outside `A-Za-z0-9._-` becomes `_`, per code point (the `u` flag, as Python's `re.sub` counts),
the same mapping as `bin/lib` `ledgr_extract.safe_name` and the MCP server's folders. `spool.js`
`archiveDir(sid)` refuses an empty id and one that would name `.` or `..`. `store.js`
re-exports `safeName`.

| File | Lines |
|---|---|
| `archive/<dir>/items-<ms>-<rand6>.jsonl` | one item per line, exactly as it was in `store.d.items` (JSON, no wrapper) |
| `archive/<dir>/turns-<ms>-<rand6>.jsonl` | a cut record `{"sessionId", "turn", "rec": {…as it was…}}`, or a moved head `{"sessionId", "turn", "textHead"}` |

`<ms>` is the run's time, larger than the last run's (`houseMs`), so a later run's files sort after an
earlier one's; `<rand6>` six lower-case base-36 characters. The writer's and the readers' check of a name
is `ARCHIVE_ITEMS` (`^items-\d{1,16}-[a-z0-9]{1,16}\.jsonl$`; with `ARCHIVE_LEGACY` in `config.js`,
re-exported by `spool.js`, so the store can tell an items file from a legacy one on a restore). A file
holds at most
`ARCHIVE_FILE_MAX`, 512 KiB of UTF-8 text with its newlines (half Herdr's text-file cap), so it is
written with `writeTextFile` and read back with `readTextFile`; a session's lines are split over as many
files as that takes (`archiveChunks`), and a single line over 512 KiB is written nowhere
(what it stands for stays in the store, and the run says so).

Every file is new: `spool.js` `writeNew(path, text, {cx, ms, ok, step})` creates it with
`writeTextFile(path, text, null)` (expected null: a name already taken, by a late write of an abandoned
run or by chance, fails this write instead of replacing that file), then reads it back and resolves null
only when it holds exactly the text, else the error's words. No archive file is ever appended to or
rewritten. Only the writer writes under `archive/` (`test_no_keystrokes.py` rule 14).

Nothing reads a turns file: they keep what was cut, for a person or a later tool. The readers need none
of it (2.2).

### 3.2 The reading rule

For every reader: an id present in the store wins over any archive line; among the lines for one id, the
one in the newest file wins, and within a file the last line. `listing.js` `archiveRecords(files,
{sessionId, has, items, legacy})` is the rule as code, pure (the name shapes are passed
in from `spool.js`). Files are ordered by their names: every legacy month file before every items file,
months by name, items files by `<ms>`, then name; a name of neither shape is skipped. A line that is not
JSON, or not an object with a string `id` and an item's `direction`, is skipped and counted (`skipped`); a
line of another session (or of none) is left out. It returns copies newest closed first (`closedAtOf`:
`resolvedAt` else `updatedAt`; ties by id), each with `archiveFile`, the file name a restore event sends
back. The writer's own read of one file (`spool.js` `archivedRecord`) takes that file's last line whose id
is the item, which must be the event's session's.

### 3.3 Legacy month files

`archive/<yyyy-mm>.jsonl` (`ARCHIVE_LEGACY`), written by the old housekeeping, any session's items in one
file, are never written again. Readers still read them, filtered by `anchor.sessionId`, and a restore may
name one. They may be past 1 MiB, so they are read with `fs.readFile`, which has no such cap, never
`readTextFile`. None exists on the maintainer's machine: the old housekeeping never archived anything.

### 3.4 The one-time copy

The first run after the upgrade first writes `ledgr-data/store.pre-retention-<ms>.json`: the store text
as this writer last read or saved it (what is only in memory is not the store yet), through `writeLarge`
(it is over the cap). It is kept and never read by code; the person may delete it. A first run that cannot
write it archives nothing, sets nothing, and tries again an hour later. `LARGE_TMP` lets a
start's sweep remove a temporary copy that `writeLarge` left beside it, as for `store.json`.

## 4. Housekeeping

### 4.1 When

`Writer.houseDue(now)` says why a run is due, or null:

- never in a copy that is retired (a `herdr-app check` copy) or does not hold the writer's role, nor while
  a run of this generation is going (`this.house`);
- never within an hour of the last run this copy began (`houseTry`): a run the watchdog gave up is not
  begun again by the restart that follows;
- `"first run"` when `d.retention?.v !== 1` (the first start after the upgrade);
- `"daily"` when a day has passed since `d.houseAt`;
- `"size"` when an hour has passed since `d.houseAt`, the store as last saved is over `HOUSE_SIZE`,
  768 KiB (UTF-8 bytes), and it has grown by `HOUSE_GROWTH`, 64 KiB, over the size recorded at the end
  of the last run. That size is kept in memory; after a restart none is recorded, and one size run is
  allowed; a change of `retention_days` or `retention.turns` (the settings row, the installer's move of
  14 to 3) forgets it too (`applyConfig`), so a shorter retention applies within the hour. Why the growth: on today's data the store stays over 768 KiB after its trim (8.2), so a size
  trigger on the size alone would run every hour and write small files for ever.

`houseKick(cx)` is called at the end of a start and at the end of every tick (after
the drain, the heartbeat, `wake`, the config and the map). A due run becomes its own task (`cx.spawn`),
never awaited: a start answers no ping while it runs (`respond`), and a first run writes dozens of files,
so a start that waited for it would look like a writer that is gone. `houseKick` records `houseTry`, sets
`this.house = {gen, at, step, since, why}`, and returns the run's promise (`houseRun`, for tests), which
resolves with the run's tally or null. When the run ends, `house` goes and the claim is renewed.

### 4.2 One run

`housekeep(cx, gen, why)`, each await bounded, named and followed by `ok()` (this
generation still the writer's):

1. `ms`, larger than the last run's. `ledgr-data` listed (none yet: nothing to do, no folder made).
2. First run, a store that is not empty, no copy from this writer yet: the one-time copy (3.4).
3. The plan, from the store as it is now: `planSlim(turnsKept(cfg))` and `archivable(cfg.retention_days,
   now)`, grouped per session (an item or record whose session names no folder stays). When the writer's
   config is not `config.json` as read (its read failed and the merged config carries `_error`, or the
   first read got no answer and the writer still holds the built-in defaults), the run archives no items:
   it cannot know the person's days, and the default could be shorter than theirs. Turn records are
   still slimmed; writer.log and the note say so.
4. Per session, in sorted order: `mkdir archive/<dir>`; its items through `archiveLines` (items files);
   the items in confirmed files leave the store at once (`removeItems`; those changed meanwhile are
   counted as `stayed`); its cut records and heads through `archiveLines` (turns files), kept for step 5.
5. `applySlim` once, with every confirmed cut and head.
6. `d.houseAt` set; on the first run `d.retention = {v: 1, at}` (only now, after every file of the run,
   so Phase 2 can tell a store that has been through it). Saved through `saveStore` when the run changed
   the store (items removed, records cut or made lean, or the first run's mark). A run that found nothing
   writes no file and saves nothing; its `houseAt` goes with the next save. The saved size is recorded
   for the size trigger's growth (4.1).
7. `writer.log`, when files were written or failed or it was the first run: `housekeeping (first run): N
   closed item(s) and M turn record(s) archived, K textHead(s) moved, in F file(s); store.json A -> B
   characters; the store as it was kept in store.pre-retention-<ms>.json`, plus what changed meanwhile
   and what failed. A failed file also sets the writer's note.

`archiveLines(gen, dir, kind, ms, entries, t)`: the lines split by `archiveChunks`,
each chunk to a new `archive/<dir>/<kind>-<ms>-<rand6>.jsonl` through `writeNew`, its two waits named
`writing archive/…` and `reading back archive/…`. It returns the payloads of the lines in files written
and read back whole, or null when the run was given up. A file that failed, or a line too long for any
file, goes in the tally's `failed`; what it holds stays in the store for the next run (a duplicate line
then is harmless, 3.2).

### 4.3 Alongside drains

A run is not held back by drains, nor drains by it: a spool event never waits behind a run, only behind
one save in the chain. A change applied between the plan and the removal is never lost, because the
removals check again: `removeItems` takes only an item still closed and still the planned line, and
`applySlim` only a record still the planned JSON. The cost is at most a stale line in an archive file,
which the reading rule ignores while the store holds the id.

The other way round: an act the panel or the MCP server posted for an item a run has just removed
(still in the spool when the item left) finds no item and is dropped; the writer's note says "<id> is
not in the store (archived?)". The person reopens it from its archived row.

### 4.4 The watchdog and the start

`progress()` reports a run of this generation, `housekeeping: <step>`, when no pass and no
start is running, so the claim's `pass` shows it and the watchdog sees it move file by file. A step that
has waited longer than `PASS_STUCK_MS` (90 s) is stuck, kind `"house"`: `unstick` gives the generation up
and the writer starts again from `store.json` on disk. From then on the old run writes and removes
nothing more (every step asks `ok()`), and `abandon` clears `this.house`; at worst a file it wrote is a
duplicate of the next run's. `houseStep(gen, s)` names each wait; the save's own steps follow it
(`save: store.json writeTextFile`, …).

Section 18.1 of `BUILD-NOTES-mod.md` lists a start's steps; housekeeping is no longer one of them.

## 5. Restore

The dialog's Reopen on an archived record posts one spool event (detail.js `reopenArchived`):

```
{type: "restore", session_id, item: "<item id>", file: "<items-…jsonl, or a legacy yyyy-mm.jsonl>", reopen: true}
```

(`reopen` stays in the event as the contract wrote it; the store reopens whatever it says.)

The writer, before a batch is applied (`applyBatch`), gives each `restore` it has not
ingested its record: `delete ev.record` and `ev.record_error` (the writer's to attach, never the
event's); `spool.js` `archiveFileOf(sid, file)` takes only a plain name of the two shapes (an items file
in `archive/<dir>/`, a legacy month file in `archive/`; a separator, `..`, a hidden name, a turns file
refused); the file is read with `fs.readFile` (bounded, once per file per batch, named `apply:
archive/…`); `archivedRecord` takes the last line for the item, which must be the session's. Found:
`ev.record`; else `ev.record_error` and the writer's note. The event is always applied and consumed: one
left in the spool would be one the passes never apply, which is what the watchdog calls a stall.

`Store.on_restore(ev, s, at, out)`: with a record of this id and this session,
`restoreItem`, then, when the item is closed, the reopen act's own change (`act "reopen"`: `setStatus`,
so `resolvedBy`, `resolvedNote` and the dismiss marks go, and a staged confluence is called off). A
restore always reopens: the event's `reopen` field (the dialog sends `true`) is not read by the store.
Anything else changes nothing. Either way the event goes into `ingested` and `apply()` returns
`restore: {item, ok, error?}`; a failure sets the writer's note (`restore of <id>: <why>`).

`Store.restoreItem(record, {counted})`: only a record that is an item (an id `^rq_[A-Za-z0-9_-]{1,80}$`
and a session in its anchor) of a session not forgotten; when the id is already in the store it returns
the one there; else it puts a copy back under its own id (without the reading copy's `archiveFile`). Its
handle stays its own unless another item of the session holds it now, or it is at or above the
session's `nextHandle` (a record that was never this store's to number): then it gets a fresh handle
from `nextHandle` and keeps the old one as `handleWas`, and `nextHandle` is raised past any handle a
restore puts back, so no handle is ever held twice or handed out again. A restore from an items file
(`counted`, which `on_restore` sets from the event's `file`: the writer read the record from that file)
lowers its session's `archived` by one (never below 0; at 0 the field goes); one from a legacy month file
does not, since the old housekeeping never counted it. No `updatedAt` is set by the restore itself.

`restore` is one of the panel's own events (`OWN_EVENTS`): it never creates a session, and one for a
forgotten or unknown session is recorded and dropped (`restore.error`: "its session is not in the
store").

## 6. The reading copies

### 6.1 `Reader.loadArchive`

`Reader.loadArchive(sessionId)`, the panel's and the dialog's: it lists the session's
folder (`namesIn`, items files only) and `archive/` (legacy month files), reads them with
`fs.readFile`, applies the reading rule (3.2) and returns the records newest first, each with
`archiveFile`, and the store's ids left out (by `viewStore()`, so whatever the copy shows as in the store
counts). Both folders are listed at each call; an items file's parsed lines are cached by its name and
only a name not seen before is read (a file is written once and never changes), and a legacy file is
read once per copy. The panel and the dialog read through `readArchiveWithin`, the whole read bounded
(`ARCHIVE_READ_MS`, 10 s, on the copy's own timer through `spool.js` `within`); a read that fails or gets
no answer is said ("The archive could not be read: … It is read again in a moment.") and read again
after `ARCHIVE_RETRY_MS`, 15 s. A missing folder is an empty archive. In the demo, `demoArchiveOf(sid)` reads `fixtures.js` `demoArchive` through the same rule and no
file. It claims nothing, posts nothing and writes nothing (rule 14).

### 6.2 The CLOSED fold

The CLOSED fold (the footer's `closed (N)`) ends with one line, `archived (N) · show` (`hide` when
shown), entry key `arch:items`, a click or Enter toggling it per session (in memory). N is the store's
`session.archived` until the archive is read, then the rows read (`archivedCount`: the legacy files'
rows included, which no count holds). The line is hidden at 0 unless the archive holds rows anyway: at a
count of 0 the archive is read once to find out. Shown, the archive is read (`panel.js` `readArchive`, in
a timer from render, as the panel's other reads) and read again when the count changes; meanwhile
"Reading the archive…", and when nothing could be read, why.

Each archived row is an item row (`rowModel`): the state word "archived", dim, the record's glyph and
pill, no quick action (no Done, Paste or Promote), the tooltip ending "Archived: out of the list; its
dialog reads it and can reopen it." The cursor and the list's keys work on them as on any row; a click
or Enter opens the dialog on it with `props.archived` (`panel.js` `openOf`). `open:<handle>` reaches an
archived row once the rows are read.

### 6.3 The dialog

`props.archived` names the archive file of the row (`detailSpec` passes it only when given;
`detailProps` takes it on an ask or a question only, a plain `.jsonl` name the writer's shapes accept,
at most 128 characters, else null). Props rather than a shared request: a dialog is opened per record and
reads its props once, owned by that copy alone, where a shared key would be every copy's and racy
between two opens.

The dialog reads the session's archive itself (`readArchive`, the same `loadArchive`). The store wins:
`resolve` looks in the store first, then among the records read. An archived record shows whole, its
text selectable and an ask's links working, with an ARCHIVED section first (when and how it was closed,
`archivedWords`; where it is kept, `archiveFileWords`; an `archived` badge), then TEXT, QUOTE, ABOUT,
OPTIONS (not clickable), RESULT, the sub-rows of the ask it repeats or is about (read from the archive
when archived too), the foot, and the message on the right as usual. No answer box, whatever status the
record holds, and no Done, Defer, Not needed, staging or Go to anchor; the one action is Reopen
(`archivedActions`). A dialog open on a live item that a run archives meanwhile reads the archive once
when its target leaves the store, and shows the archived record in its place. A command that would
change it (`detail:done`, `detail:pick:`, `detail:answer:`) says "Archived: read-only here; Reopen brings
it back to the list."; `detail:whole` works; `detail:reopen` is Reopen for scripts.

Reopen (`reopenArchived`) posts the restore event of 5 through `Reader.post` (kept in
`unwritten` until written, so `release()` writes it again if the dialog closes first) and says
"Reopening Ask 16: the ledgr writer brings it back from <file>…". `settleReopen`, at each render:
whenever `store.json` holds the id again, even late, "Ask 16 reopened from the archive: it is back in
the list, open." and the live item shows (`prepKey` marks an archived record apart, so it is prepared
again as the live item, answer box and all); when the writer has ingested the event and the id is not
back, "Ask 16 was not reopened: the archive file … could not be read (ledgr-data/archive/). It stays
archived." After `RESTORE_WAIT_MS` (15 s) with neither, the dialog keeps waiting and says the writer has
not taken the event yet (no writer running, or one busy): the event waits in the spool and applies when
a writer does. The dialog stays open throughout. In the demo, Reopen restores into the demo store and
says nothing is saved.

⌘↓ / ⌘↑ step through the archived rows as read (`laneOf` lane `"archive"`, the store's ids left out,
newest first), each opened from its own file. When the session's `archived` count changes while an
archived record is shown, the archive is read again. The words: `ARCHIVE_READING`, `archiveGoneWords`
(the file is gone, or no line of it holds this item), `DETAIL_GONE` for anything else.

### 6.4 Settings

One row, "Closed items stay in the list", N days with − and + (1 to 30, `RETENTION`), among the rows
about what the list shows (after "Open the panel on new asks"), written to `retention_days` through
`Reader.saveConfig`; its line: "After that they move under Closed, archived, where they can still be read
and reopened; one closed as not needed stays at least 7 days." The row shows `retentionDaysOf(cfg)`, the
clamp the store and the writer use (2.1), so what it shows is what housekeeping does. `retention.turns`
has no row: it stays in `config.json`.

### 6.5 Commands and demo

- Panel: `archived` (CLOSED open, the shown session's archived rows shown or hidden, as the line's click).
  `open:<handle>` and `cursor:<handle>` reach an archived row once read.
- Dialog: `detail:reopen`.
- Demo (`fixtures.js`): the demo session counts three archived items (`archived: 3`, `nextHandle.A` 18),
  and `demoArchive()` holds them in two items files with fixed names (`DEMO_ARCHIVE_FILES`): Ask 16 (a
  decide answered by you, its message in turn 6), Ask 17 (not needed in the first file, closed by the
  agent in the newer second file, whose line wins) and Question 1 (cleared). `ledgr.demo`, then
  `ledgr.archived`, shows the three rows; Enter on one opens it read-only.

## 7. Config, the installer and the doctor

### 7.1 Config

| Key | Default | Where | Notes |
|---|---|---|---|
| `retention_days` | 3 (was 14) | `config.js` `DEFAULTS`, `ledgr_config.py` `DEFAULT_CONFIG` | days a closed item stays in the list, whole days 1 to 30 (`retentionDays`); a dismissed one at least 7; the settings row writes it |
| `retention.turns` | 12 | the same, as a nested object | turn records kept per session; clamped by `turnsKept` to 2 to 60 |
| `LIMITS.turnHeads` | 2 | `config.js`, code not config | the newest records that keep their `textHead` |
| `HOUSE_SIZE` | 768 KiB | `writer.js` | past it, and grown by `HOUSE_GROWTH`, a run within the hour |
| `HOUSE_GROWTH` | 64 KiB | `writer.js` | the growth since the last run's end that the size trigger also needs |
| `ARCHIVE_FILE_MAX` | 512 KiB | `writer.js` | the most text in one archive file |

`retention` is an object so Phase 2's keys can sit beside `turns`. Both merges fill it into a
`config.json` that lacks it: `config.js` `merge` (a missing or null `retention` gives the defaults, a
partial one keeps `turns`) and `ledgr_config.py` `deep_merge`. `d.retention` (`{v: 1, at}`) and
`d.houseAt` live in `store.json`.

### 7.2 The installer: 14 becomes 3, once

The hooks' `ledgr_config.load` (on their first run) and the installer's `apply_config` write every
default into a new `config.json`, so an existing install holds `retention_days: 14`, which wins over the
new default: nothing would be archived for two weeks and the store would stay past 1 MiB (the
maintainer's live config holds 14). No dialog offered the value before the settings row, so a 14 the
installer finds is the old default, not a choice.

`setup/ledgr_setup.py` `migrate_retention(st, cfg)`, from `apply_config`: when install-state has no
`migrations.retention_days` and `retention_days` is the number 14, it becomes 3; either way the date is
recorded in `migrations.retention_days`, so only the first install that knows the archive decides, and
a 14 the person sets in Settings later stays. `retention_pending` says so in the Plan, before anything is
written ("retention_days 14, the old default, becomes 3 (once): closed items move to the archive after 3
days"), and the summary carries "ledgr-data/config.json: retention_days 14 (the old default) -> 3: …
(once; ledgr's Settings, Closed items stay in the list, changes it)". Nothing else is written for it:
`retention.turns` comes from the merges. A new `config.json` already has 3 and nothing is said.

The installer deploys the mod before it writes `config.json`. A writer that restarts in between runs its
first run with 14: the one-time copy and the turn records, no items. The writer takes the new 3 from
`config.json` at once (its config watch), and the change of `retention_days` lets the size trigger run
again without waiting for 64 KiB of growth (4.1): a size run within the hour archives with 3 days.

### 7.3 The doctor

`./install.sh --check` adds `retention_report(ctx, st, cfg)`, read-only:

- `retention`: the days and the turn records as configured, or "(the default)";
- `store.json`: its size against Herdr's 1 MiB cap and `HOUSE_SIZE` (read from `writer.js`,
  `writer_number`);
- `housekeeping`: when it last ran (`d.houseAt`) and whether the first run has finished (`d.retention`);
- `archive`: sessions, items and turns files, legacy month files, bytes, and the items the store counts
  as archived (`session.archived`);
- `one-time copy`: each `store.pre-retention-<ms>.json` with its size, or that none is left;
- a warning, not counted, when the store is still past 1 MiB after the first run.

Its one problem: `retention_days` still 14 with no `migrations.retention_days`, with what to do (run
`./install.sh`, or choose the days in Settings). A 14 after the move is shown as the person's choice.

## 8. Tests and the live check

### 8.1 The offline suites

| File | Checks | What retention adds |
|---|---|---|
| `test_store.mjs` | 1,120 (225 retention) | the settled values and the hooks' defaults equal to `config.js`'s; `archivable`'s floor, bad numbers, copies; `removeItems`' re-check and count; leaner records and the readers' fallback (the writer's re-anchor reads the default file); `planSlim` and `applySlim` (by turn number, heads, a changed record left, twice, keep 0); `restore` (record, `record_error`, neither, another item or session, an id already there, a replay, an unknown session, a forgotten one, not an item); a re-raise after archiving and handles never reused; a store of realistic size slimmed by exactly what goes (1.83 MB to 0.64 MB) and rebuilt whole from the lines; Phase 2's seams (one `safeName`, `applySlim` keeping `stopAt`, `asks.at`, `retry.at`, no `updatedAt` from the removals or the restore, `retention.turns` filled into an older `config.json`); the review's: one clamp of `retention_days`, a change that set no `updatedAt` keeps an item, a record keyed "07", a legacy line not counted, a restore always reopening, handles after a session record made again |
| `test-store.sh` (its Python block) | | the hooks' retention defaults and merge; `ledgr_extract.DISMISSED_DAYS` 7; `safe_name` and the MCP server's `safe` equal to `safeName` on the names `test_store.mjs` writes |
| `test_writer.mjs` | 714 | sections 18 to 29: the pure parts; the first run on a 1.7 MB store (the copy, files per session under the cap and create-only, a heavy session split, the store under 1 MiB, the first save through `writeLarge` and the next on `writeTextFile`, every file a named step, writer.log); a taken name and a bad read-back kept and archived next run; a run given up between a file and the save; a late write of a given-up run; an item reopened meanwhile; the triggers and one run at a time; a copy that cannot be written; restore from a file, a legacy month, bad names; none in a copy that does not hold the role or in a check copy; section 28, across the seam; section 29, the review's (a failed config read archives no item, an act for an archived item said in the note, an archive write timed out on a timer that fires) and, in 24, `HOUSE_GROWTH` and a retention change |
| `test_list.mjs` | 392 | the reading rule (newest file, last line, legacy order, other sessions, malformed lines, the shapes passed in), archived rows (state word, no quick action, tooltip), `archivedCount`, the `archive` lane, a file given parsed |
| `test_detail.mjs` | 1,003 | `props.archived`; the demo's `archived (3)`; `Reader.loadArchive` over real files (a missing folder, the newest file and the store winning, a legacy file, the cache); the CLOSED line (hidden at 0, a legacy file's rows, reading, nothing read), its rows (cursor, Enter, `open:<handle>`); the dialog on an archived record (read-only, marked, its lane, its links) and Reopen (the demo's store; a live one posting exactly the contract's event; "reopening…"; back as the live item; "could not be read"); the review's: a slow writer, an item archived while its dialog is open, an archived line that says open, a bounded read and its retry, a `herdr:` session's folder, the panel's own store-wins filter |
| `test_settings.mjs` | 800 | the row, its value and edits (1 to 30, rounded, refused), its saved line, − and + writing `retention_days` |
| `test_no_keystrokes.py` | 792 | rule 14: only `writer.js` names the archive in a write (housekeep's `mkdir`), `writeNew` defined in `spool.js` and called once, in `archiveLines`, create-only and read back; the readers' archive methods only read; `reopenArchived` posts one restore event and stages, copies, runs and execs nothing |
| `setup/tests` | 164 | `test_retention_migration` (the whole install in a scratch home: 14 to 3 with the Plan and summary lines, recorded; a later 14 kept; a new config; 7 left alone); `test_retention_report` (defaults, the problem and its words, the cap and the threshold, the first run, the archive's counts, the copy) |

Section 28 of `test_writer.mjs` is the seam no single builder could test: a store with closed items and
many turn records; the writer's run writes the archive files; `Reader.loadArchive` reads exactly the
items files the run wrote (no turns file, no other session's) and lists exactly the archived items, each
as it was; Reopen, posted through `Reader.post` as the dialog posts it, for an ask and a parked question;
the writer's pre-read and `store.js` restore put each back open under its own id and handle, with
`session.archived` one fewer; the reading copy then lists it open and no longer archived; closed again
and archived by a later run, the newer file's line wins. Two mutations (the first file's line winning;
the count not lowered) each fail it.

### 8.2 The dry run on the live store's shape

On a copy of the maintainer's `store.json` and `config.json` (read-only on the live side), offline, the
real `store.js` functions as housekeeping calls them (`archivable` at 3 days, `planSlim(12)`,
`removeItems`, `applySlim`), counts and sizes only:

- 1.803 MB to 0.866 MB, under the cap; above `HOUSE_SIZE`, which is why the size trigger also needs
  growth (4.1).
- 387 closed items archived (384 resolved, 3 dismissed; all of them asks);
  442 turn records cut, 210 heads moved; 48 files for 29 sessions, 918 KB, the largest 116 KB, none
  near 512 KiB.
- No function threw. All 715 `textPath` values were the default path, and all left the records.
- The reading rule over the produced lines returned all 387, none missing, none extra, none skipped.
- At 14 days, nothing would have been archived: hence the migration of 7.2.
- Left in the store: open items 343 KB (327 KB of them below the threshold), closed items of the last
  3 days 322 KB, turn records 89 KB, sessions 32 KB, `ingested` 39 KB.

### 8.3 The live check (after the install; test items in throwaway sessions only)

Never a test item in a real session; scratch folders, new panes, closed at the end; test items removed
through the panel's own events.

1. Before the install: `./install.sh --check` names `retention_days` 14 as a problem and shows the store
   past the cap.
2. The install (the maintainer runs it): the Plan says 14 becomes 3; the summary says so; install-state
   holds `migrations.retention_days`.
3. Once Herdr runs the new writer: `ledgr-data/log/writer.log` has the first run's line with the copy's
   name; `store.pre-retention-<ms>.json` is there; `archive/<session>/` holds items and turns files, none
   over 512 KiB; `store.json` is under 1 MiB (about 0.87 MB on the data of 8.2).
4. While it runs: the panel's status line never says that no writer holds the role; the claim's `pass`
   names `housekeeping: writing archive/…` steps.
5. The next saves: the claim's save steps name `writeTextFile`, never the temporary copy and `mv`.
6. `./install.sh --check`: the retention lines, the archive, the copy, no problem.
7. The panel on a session with archived items: `closed (N)` open, `archived (N) · show`; a click lists
   the rows, "archived", dim, no Done; ↓ and Enter on one open the dialog: the ARCHIVED section, the text
   selectable, a link in an ask working, no answer box, Reopen alone; ⌘↓ steps to the next archived row.
8. The demo: `herdr-app do ledgr.demo`, `ledgr.archived`: three rows; open Ask 17: the newer file's
   line ("closed by the agent"); Reopen: "(demo) … Nothing is saved."
9. Reopen on a real archived row, in a throwaway session: Settings, "Closed items stay in the list", 1
   day; in a scratch folder a session with one ask, Done; a day later (the daily run) its row
   is under `archived (1)`; Reopen: "Reopening…", then back in the list, open, same handle; Done again.
   Settings back to 3 days.
10. Hours after the first run, with the store still over 768 KiB: no size run until it has grown 64 KiB
    (writer.log quiet); the daily run's line a day later.
11. After the install and before Herdr is relaunched, a new reading copy may run beside an old host
    engine: the old writer does not know `restore`, so a Reopen then is consumed without effect and the
    dialog says the record could not be read. Relaunch Herdr and Reopen again.
12. `herdr-app status`: no mod errors. Clean up: Forget the throwaway session after closing its pane;
    remove its scratch folder.

Not verified offline, for the live check: that `writeTextFile(path, text, null)` refuses an existing
file in Herdr (the typings say so; `writeNew` relies on it); that `fs.readFile` reads a file past 1 MiB
(the typings say so; only a legacy month file would be that large, and none exists).

## 9. Known limits

- On today's data the store stays over `HOUSE_SIZE` after the first run (0.87 MB > 768 KiB). The size
  trigger's growth condition (4.1) keeps that from meaning a run every hour, but every run still writes
  at least one items file per session that has items past retention, so a session's folder gains a file
  a day at most (a size run between daily ones adds one); the reading copies read each file once (6.1).
- The size recorded for the growth condition is in memory: after every restart one size run is allowed
  while the store is over `HOUSE_SIZE`.
- Open items are never archived, however old: open asks below the threshold were 18 % of the store.
  Phase 2 is the answer for sessions nobody touches.
- Forget leaves `archive/<session>/` on disk, as it leaves the hooks' `sessions/`, `turns/` and `mcp/`
  files; nothing reads a forgotten session's archive again. Whether Forget should delete them is an open
  question for the maintainer; nothing is deleted meanwhile.
- An act still in the spool for an item a run has just removed (Done, a draft, `resolve_asks`) finds no
  item and is dropped; the writer's note says "<id> is not in the store (archived?)" (4.3).
- A `[A3]` ref or an answer sheet naming an archived handle marks nothing; `repeat_of` an archived id is
  kept as given; `repeat_of_handle` naming an archived ask makes a new item.
- Restoring a question that had a branch does not touch the branch; a branch whose question is archived
  says its question is no longer in the list and offers no Conclude.
- Turns files are written and never read: a cut record or a moved head comes back only by hand.
- The dialog says "could not be read" for every restore the writer took without bringing the item back,
  whatever its reason (another session's line, no line for the item, an old writer that does not know
  `restore`); the reason is the writer's note, which the panel's status line shows only when the panel
  runs the fallback writer, and writer.log does not record it.
- A restore event for an id the store holds closed (a second Reopen after the item was closed again)
  reopens that item.
- A restored item whose handle another item took meanwhile comes back under a new handle (5); a ref
  or a sheet naming the old one reaches the other item.
- The window of 7.2: a writer that restarts between the installer's copy of the mod and its write of
  `config.json` runs the first run with 14 days; the items wait for the size run of the following hour.
- After the install, until Herdr is relaunched, a new reading copy may run beside an old host engine,
  whose writer ignores a `restore`; the dialog reports it (8.3, 11).
- The demo's first archive file has Ask 17 dismissed 5 days ago, younger than the 7-day floor would
  archive; the newer file's line wins, so nothing shows it.


## 10. Phase 2: cold sessions

Built 2026-11-19, the same day as Phase 1, by four builders working in parallel against one contract (A
the store, B the writer and the spool, C the reading copies, D the Python readers, the installer and the
doctor), integrated on top of Phase 1, uncommitted; the offline suites pass; the live check (10.12) is
pending. The build notes are `BUILD-NOTES-mod.md` 20 (the store and the writer) and
`BUILD-NOTES-detail.md` 18 (the reading copies).

Phase 1 cannot reach open items. A session nobody has touched for a week still carries its open asks
and its turn records in every save. Phase 2 moves such a session's items and turn records into a file of
its own, keeps the session's record (with its counts) in the store, and brings the session back the
moment anything happens to it. Showing it does not bring it back: the reading copies read its file.

| Topic | Decision | Section |
|---|---|---|
| What goes cold | A session idle more than `retention.coldDays` (default 7; 0 = never, and every cold session comes back) that holds items or turn records | 10.2 |
| What moves, what stays | Its items and turn records move; its record stays whole as the stub, plus `cold: {file, at, n, fault?}`; pins, branches, terminals, `nextHandle` and Phase 1's `archived` stay | 10.1 |
| Open blocking asks | Do not keep a session warm: it goes cold, its counts kept on the stub and shown (◆ in the session menu, the chip) | 10.2 |
| The file | `cold/<safe sid>.<ms>-<rand6>.json`, one JSON document, written once (create-only, read back) before the store names it; never rewritten | 10.3, 10.4 |
| Back | Before a pass applies an event that needs the session, the writer reads the file and puts everything back, the store's copy winning; showing a cold session reads its file and does not thaw it | 10.5 |
| A file that cannot be read | The session is faulted; its events are held in `cold/held/<safe sid>/` until Try again works, the person uses it without its older items, or forgets it | 10.6 |
| Deleting files | Only the writer's hourly sweep, only a file provably redundant for the `store.json` on disk: by name, one the session's record lists as thawed (an hour on) or a forgotten session's (a day on); any other only after a read shows the store holds all of it (a day on). Anything else stays for good | 10.8 |
| The list | OLDER SESSIONS (N) folded at the bottom of the session menu; a dim "older" pill; "Reading…" then the usual lanes | 10.9 |
| Settings | "Idle sessions move out of store.json", 0 ("never") to 60 days | 10.9 |
| Rollback | `./install.sh --thaw-all` first; `store.json` stays `v: 1` | 10.11 |

### 10.1 What goes cold, what stays

| Store part | Phase 2 | Why |
|---|---|---|
| The session's items | move, whole, in `itemsOf(sid)` order | the bulk |
| `turns[sid]` | move, whole (at most 12 records, slimmed by Phase 1) | read only for that session |
| `sessions[sid]` | stays whole as the stub, plus `cold`, `touchedAt`, `thawedAt`, `coldLost` | twenty-odd places read it (the menu, the header, the capture box, the MCP server, Resume, the pins, Forget, `depthOf`); kept whole, none of them changes and an older build round-trips it |
| `pins`, `branches`, `terminals` | stay | pins are permanent and searched in memory; branches are cross-session; a cold session keeps its mapping |
| `forgotten`, `ingested`, `diag`, `houseAt`, `retention` | stay | not per session |
| `archive/` (Phase 1) | untouched | `session.archived` stays on the stub, so `archived (N) · show` works on a cold session |

The stub's fields:

```
s.cold = { file, at, n: { q, qNew, blocking, needed, optional, promoted, answered, closed, items, turns },
           fault?: { at, error, tries, held } }     // only while the writer cannot read the file
s.touchedAt   // the idle clock carried: set at the freeze (the clock it had), by every event of a warm
              // session (pin ops and `seen` aside), by a thaw and by a reset
s.thawedAt    // set by a thaw and by a reset
s.coldThawed  // [{file, at}]: the files this record's thaws read back (the newest 8), the sweep's proof (10.8)
s.coldLost    // {file, at, frozenAt, n, error}: set by cold_reset ("Use without its older items")
```

`n` counts by level, so every threshold is computed from it (`store.js` `countsOf`): `q` open parked
questions, `qNew` those created at or after the last prompt (the chip's "collecting"), `blocking` open
blocking asks (promoted or not), `needed` and `optional` open asks of those levels not promoted,
`promoted` open promoted asks below blocking, `answered`, `closed`, and the totals `items` and `turns`.
`countsOf` and `chips()` read the stub's `n` for a cold session that is not merged; `chips()` before and
after a freeze are equal apart from `o` (how the asks arrived).

### 10.2 What goes cold

**The idle clock** (`store.js` `touchedAt(sid)`) is the latest of the record's `touchedAt`, `updatedAt`,
`thawedAt`, `promptAt`, `lastStopAt`, `resume.at`, `resume.resumedAt` and `lastClear.at`; every item's
`updatedAt`; every turn record's `stopAt`, `asks.at` and `retry.at` (Phase 1's slimming keeps all three).
It does not read `seenAt`: a session only looked at is not in use, and the panel posts `seen` whenever it
shows a surfaced session (a cold session's menu row said "idle 1 min" after a look, and a session shown
every day never went cold). For the same reason an act `seen` does not move `touchedAt`. At the freeze
the stub keeps the clock it had in `touchedAt`, because its items and turn records, which the clock read,
leave with the file. A session is idle when `now - touchedAt(sid) > coldDays × 86 400 000`.

**Never cold** (the store's rules, `freezeBlocker`): `coldDays` 0, or Phase 1's first run not finished
(`d.retention.v !== 1`); a session not recorded, forgotten or already cold; one with neither items nor turn
records (nothing to move, no file); an id that makes no file name of its own (empty, beginning with `.`, or a
safe name another recorded or forgotten session shares); an item `deferred` (to the next session or to a time:
both wake by scanning warm items); an item `rejoin_pending` or with `rejoin`; a branch launching,
launched, running or concluded on either side; a resume launching or launched; a turn whose extraction
re-run is requested or running.

**Never cold** (the writer's rules, `writer.js` `canFreeze`, asked at the plan and again at the commit): an
agent in a live pane mapped to the session (`terminals()` lists its terminal live and the store maps that
terminal to it); the open detail dialog shows it (`shared("ledgr.detail").open.session`: its typed answer
lives in that copy); the running pass names it (`passSids`); it is to be brought back (`wantThaw`);
`retention.coldDays` is 0 in the config the writer holds.

**Not a reason to stay warm**: open blocking asks (the maintainer's default: the counts are kept and
shown); a draft (it is part of the item and goes into the file); answered items; being shown or held in
the panel (the writer cannot see that, and nothing is lost: the panel reads the file).

### 10.3 The files

The cold file: `ledgr-data/cold/<safeName(sid)>.<ms>-<rand6>.json` (`config.js` `coldName`, `COLD_NAME =
/^(.+)\.(\d{13})-([0-9a-z]{6})\.json$/`; `ms` is the record's `at`), one JSON document with no
indentation:

```json
{"ledgr": "ledgr-cold", "v": 1, "sessionId": "<sid>", "at": 1795100000000,
 "session": {"...": "the record as it was at the freeze, for repair only"},
 "items": ["...the session's items exactly as in the store, in itemsOf(sid) order..."],
 "turns": {"<turn>": {"...": "the turn record exactly as in the store"}},
 "n": {"...": "the counts the stub carries"}}
```

Every reader checks a file the same way before using any of it (`store.js` `coldRecordError`; Python's
`ledgr_extract.cold_record_error` word for word): a JSON object, `ledgr` `"ledgr-cold"`, `v` 1,
`sessionId` the session's, an item list whose every item is an object of that session with an id (never
`__proto__`), turn records a map of objects. A file of 1 MiB or less is written with
`writeTextFile(path, text, null)` (create-only); a larger one with `fs.writeFile` to its new name after a
listing shows the name free, and read back with `fs.readFile`; nothing names a file until its read-back
matched. Every reader reads with `fs.readFile` or Python's `open` (no cap).

A held event: `ledgr-data/cold/held/<safeName(sid)>/<the spool file's own name>`, the spool file's exact
text. The name keeps its time prefix, so a replay runs in name order. The hooks' 7-day prune of the spool
never reaches it; only a replay that applied it deletes it.

`snapshot.json` gains `cold: {"<sid>": {"file": "<name>", "fault": "<the writer's error>" | null}}`; a
cold session's items are not in its `items`. Readers that do not know the map ignore it.

### 10.4 The freeze, and what is on disk after a run given up

`writer.js` `freezeRun`, from the tick's housekeeping only (`houseKick(cx, {tick: true})`, `coldHouse`:
the held folders listed, the freeze, then the sweep), at most once an hour (`COLD_EVERY_MS`; in memory, so
the first tick after a relaunch runs one), after Phase 1's run when both are due, never inside a start or
a pass, never holding a pass back. Skipped while starting, at `coldDays` 0, before Phase 1's first run,
and on a `config.json` not read as it is (its defaults could freeze where the person said never).

1. The plan, synchronously: `store.js` `planFreeze(days, now, {canFreeze, max: COLD_RUN_MAX})`, oldest idle
   first, each entry `{sid, record, sig}` (the record made of copies; `sig` the items and turn records as
   one text). It changes nothing.
2. `cold/` made (bounded, step `freeze: making cold/`).
3. Per planned session, none begun after `COLD_RUN_MS` (60 s): its name (`coldName` with a fresh rand6), the
   record's text written through `spool.js` `writeNew` (create-only, read back, a file not confirmed
   removed: `drop`), step `freeze <sid8>`.
4. `config.json` read again (step `freeze: config.json`): a `coldDays` 0 written meanwhile (Settings
   "never", `./install.sh --thaw-all`) makes `canFreeze` refuse every session.
5. Synchronously, still this generation's: `store.js` `commitFreeze(written, now, {canFreeze})` checks each
   session again (recorded, warm, the store's and the writer's rules, its record, items, turn records and
   counts exactly as planned, the file named for it with the record's `at`) and only then, in one step,
   carries the idle clock onto the stub, deletes the items and `d.turns[sid]` and sets `cold`. The files
   not committed are unlinked at once (bounded; a failure is left to the sweep).
6. One save; one `writer.log` line (10.13).

On disk after a run given up at any await (the watchdog, a takeover): nothing names a file before step 5,
so a file that landed, or lands late, is an unreferenced orphan; after step 5 the commit lives in a store
the restart does not use, and `store.json` on disk still has the sessions warm. The orphan stays until the
sweep has read it, a day on, and found every item of it in the store, the session's named file or its
archive (10.8). A save that fails leaves memory ahead of disk; the next save writes the
stubs. A drain that applied an event between the plan and the commit changed that session's `sig`, so it
stays warm and its file is removed.

### 10.5 Back in a pass, and what is on disk after a pass given up

**Which events need a session warm** (`store.js` `coldOf(ev)`, `coldNeeded(events)`): an event needs its
own session (`session_id`, else `session`, else `request.anchor.sessionId`) when that session is cold;
`branch_started` also its `parent_session_id`, `pins_asked` also its `for_session`. None for the four pin
events, `forget` and `cold_reset` (`COLD_FREE`), for an act `seen` (it marks the stub's chip seen and
nothing else: showing a cold session posts it and must not thaw it), for an event of a forgotten session,
and for an event already in `ingested`. `apply()` throws `ColdError` rather than apply an event to a cold
session (a `coldNeeded` gap then lands in `spool/failed`, kept and visible); `test_store.mjs` enumerates
every `on_*` handler against this table, so a new handler without a decision fails it. A `cold_retry` never
throws: one whose read failed is recorded and dropped.

**The pass** (`applyBatch`, then `applyPass`):

1. `passSids` = every session the batch names, warm or cold (`canFreeze` keeps them warm while the pass
   runs).
2. The held folders whose session is not faulted (back, reset, forgotten) are read (`replayFolders`,
   `heldIn`): their events join the pass ahead of the batch's own, in name order; a held event whose spool
   file is in the batch too is one event, applied once.
3. `coldPhase`: every cold session the events need, plus `wantThaw` in the first round, at most
   `COLD_THAW_MAX` (50) per pass, is read (`readCold`, step `apply: cold <sid8>`). A faulted session is read
   only when its retry is due (`COLD_RETRY_MS`, 10 min) or the batch carries its `cold_retry`. The result:
   - **transient** (the read, or the listing that tells missing from unreadable, got no answer within the
     save limit): when an event needs the session, the pass returns false and every spool file stays; the
     third such read in a row for the session (`COLD_TIMEOUT_MAX`) is an error instead, so a file that never
     answers cannot hold every session's events; when only wanted, the pass goes on and reads no other
     wanted session (the tick tries again);
   - **error** (any other read error; unparseable; wrong format, version or session): `store.js`
     `coldFault`; the session is faulted (its events held, every other session's applied in the same pass),
     and `writer.log` says so once per error. A listing words it: "cold/<file> is missing" only when the
     listing shows it is not there, "cold/<file> is there but could not be read (<why>)" when it is (no
     permission, an I/O error), so the words never invite "Use without its older items" for a file that is
     there; the tick's retry and Try again read it again;
   - **record**: `store.js` `thaw(sid, record, file, now)` (the store's items and turn records win over the
     file's; a branch mark whose branch is gone dropped; `nextHandle` raised past the file's and every
     handle the session holds, and an item of the file whose handle the store's own items of the session
     hold renumbered past them, its own kept as `handleWas`; `cold` deleted; `thawedAt = touchedAt = now`;
     the file added to the record's `coldThawed`), then its held events join.
4. Each event that needs a faulted session is held (`holdEvent`, step `apply: hold <name>`): the spool
   file's text copied under its own name, create-only, read back (a copy already there with the same text
   counts; a broken one never confirmed is replaced once). A copy that cannot be made: the pass returns
   false and the spool keeps the file. A held event leaves the apply list, the stub's `fault.held` grows by
   one, and the reader still unlinks the spool file after the save (the held copy is its keeper now).
5. With no await between this check and the apply loop, no event may still need a cold session; a session
   frozen during the awaits (which `passSids` prevents) or one past `COLD_THAW_MAX` sends the pass round
   again, at most twice, else it returns false and pokes the next pass. Phase 1's `restore` gets its
   archived record here, in each round (`attachRestores`).
6. The apply loop and the save as before. `snapshot.json` follows in the save; when the pass brought a
   session back and the snapshot write failed, it is tried once more.
7. After the save (`coldDone`): the replayed held copies are unlinked (a replayed event that threw goes to
   `spool/failed` first, through the reader's quarantine, with its held path); emptied held folders are
   removed; the sessions brought back leave `wantThaw`; a pass is poked when more is wanted.

The thaw never deletes the cold file: the sweep does, an hour later, so the `snapshot.json` this save
writes, and a reading copy mid-read, never point at a missing file.

On disk after a pass given up at any await: its thaw lived only in memory of an old generation; the
restart reads `store.json`, where the stub still names the file, and thaws again at the next event. A held
copy made before the save stays beside its spool file: the next pass finds the same text, counts it as
held, and the spool file goes after that pass's save (or it replays and applies once; `ingested` skips a
second apply). Held events are never recorded in `ingested` before they apply, so the cap of 1,000 cannot
evict anything that matters.

### 10.6 Faulted, held, reset: what the person sees

A session is **faulted** when the writer could not read its file (`s.cold.fault = {at, error, tries,
held}`). Its events, and any event that also needs it, are **held**: they leave the spool, so nothing
waits and the watchdog sees no stall. The tick tries the file again every 10 minutes. What follows is the
person's choice:

- **Try again** (`cold_retry {session_id, file}`, from the panel's button, `ledgr.cold-retry`, or Enter on
  its line): the writer reads the file at once; once it can, the session comes back and its held events
  replay in name order, once.
- **Use without its older items** (`cold_reset {session_id, file}`, two clicks, `ledgr.cold-reset` twice):
  only on a faulted stub that still names that file. `s.coldLost = {file, at, frozenAt, n, error}`, `cold`
  deleted; the session is warm and empty of what the file held (its `nextHandle`, pins, branches and
  `archived` stay, so no handle is handed out twice), and its held events replay into it. The file stays
  on disk: a record names it, so the sweep never deletes it.
- **Forget** (two clicks): the stub and its descendants go; no file is read, so a lost file cannot stop
  it; the held events replay and are dropped as forgotten; the file goes a day later (10.8).

Where it shows:

- The panel: the session's own view says "The ledgr writer cannot read this session's older items
  (ledgr-data/cold/<file>: <why>). N new events kept: they apply once the file can be read, or once you go
  on without its older items or forget the session.", with the three actions; when another file of the
  session is in `cold/`, it adds "Another file of this session is in ledgr-data/cold/ (<name>): it may hold
  what is missing; ./install.sh --check says what it holds, and Use without its older items leaves it
  there." (`Reader.coldOthers`); its menu row says "can't read"; the status line names it ("ledgr cannot read the older items of <session> (N new events kept):
  show it from OLDER SESSIONS for Try again"). After a reset, a dim line above its lanes says what was lost
  and when the person chose to go on without it.
- The dialog on one of its items: the same words (the other files too) and Try again, never "Gone".
- The MCP server: `declare_asks` and `resolve_asks` stay `ok`, send their events (the writer holds them),
  add `cold: {file, fault, error}` and `writer: "held"` (only when it finds its event's copy in
  `cold/held/`), and two lines: "ledgr cannot read this session's earlier items (cold/<file>: <why>); what
  you sent is kept and applied once that is fixed (the user's panel offers Try again)." and "Tell the user
  in your reply, and list these items there."; `open_asks` says which asks it could not list
  (`bin/mcp/README.md`, Cold sessions).
- The doctor (`./install.sh --check`): each faulted session as a problem, with its error, its tries, its
  held events, what to do, and any other file of the session on disk.

A file this reading copy alone cannot read (the writer has had no reason to try yet) shows its error,
"Nothing is lost", and Try again, which reads it here again and posts nothing.

### 10.7 The tick

`coldTick` runs before the tick's drain and before a start's first drain, and pokes a pass
(`SpoolReader.poke`: a pass even with an empty spool) when: `coldDays` is 0 and a session not faulted is
cold (all of them into `wantThaw`); a faulted session's retry is due; a held folder's session is not
faulted (back, reset, forgotten: it replays); the store holds a "mixed" session (cold, with items or turn
records beside the stub that an older build wrote: `store.js` `mixedCold`; brought back, the store's copy
winning). `applyConfig` with `coldDays` 0 pokes at once, so Settings "never" brings every session back
within a second through the config watch, else at the next tick.

### 10.8 The sweep

A cold file is deleted only when it is provably redundant. That a record no longer names it is not proof:
`store.json` can go back in time. When the writer cannot parse `store.json` at a start, it keeps the text as
`store.corrupt-<ms>.json` and starts empty; a person can put back an older copy by hand; and a session used
without its older items gives up the file its stub named while another of its files may be on disk. In each
case a session can come back warm with none of a file's items, and that file then holds the only copy.

`writer.js` `coldSweep`, after the freeze in the hourly cold run: `cold/` listed; `store.json` read again
(bounded): when it is not the text this writer last read or wrote (replaced by hand while Herdr runs),
nothing is saved or removed that run, and the note and `writer.log` say so; when memory is ahead of it (a thaw
or a freeze not saved, or the chips' diagnostics `publish()` adds after every save) it saves first, then
decides only if memory is exactly the text written; otherwise no sweep that run.
Never deleted: a file a record names (`cold.file` or `coldLost.file`), a name that is not a cold file's, one
whose safe name matches no session or more than one (recorded or forgotten), anything in `cold/held/`. Then:

1. **By name** (`store.js` `coldGarbage`, synchronously): a file the session's own record lists as thawed
   (`coldThawed`), an hour (`COLD_GRACE_MS`) after the thaw: its items came back into this store's history,
   so a store that holds the record holds them, the store's own copies having won; and a file of a session
   this store forgot, a day (`COLD_KEEP_MS`) after the Forget.
2. **By content**, at most `COLD_CHECK_MAX` (4) files a run, oldest first (`store.js` `coldUnproven`): any other
   unnamed file of one recorded session that is not faulted (a faulted session keeps every file: one may be
   what repairs it), written more than a day ago. The writer reads it (`readCold`, bounded, step `cold sweep:
   reading <name>`) and compares it with `store.json` as read from disk when the run decided (never the live
   store), with the session's named cold file (read too) and with its Phase 1 archive files (`archiveCopies`:
   items lines, cut turn records and moved heads, each line only when it names this session). The version is
   the proof (`store.js` `coldLacks`): an item counts as held only when a copy of it, of this session, is
   identical to the file's, never a later one (a store put back from a backup and touched once, Done or
   Promote, is stamped later while holding less: the draft and the resolution the file kept); a turn record only when an identical one is in
   the store or the turns archive, or the store's is the file's without its head and the archive holds that
   head. Nothing lacking: deleted. Anything lacking, or a file that cannot be read or is not a cold record:
   kept for good. `writer.log` says so once
   ("cold sweep: cold/<file> holds N item(s) and M turn record(s) store.json lacks (session <sid8>): kept, never
   deleted; …"), the writer does not read it again while it runs, and `./install.sh --check` lists it as a
   problem with the session, the file and what `store.json` lacks.

After the deletions, `trimThawed` drops a thawed entry once its file is gone or a day after the thaw (a file
still there then is the read's to prove). A file no record names is never named again (a freeze makes a new
name), and the start's sweep of `.large` copies rules out an older `store.json` coming back through a late
move.

**Recoverable files: bringing their items back.** Nothing does it on its own; it is a manual step, and it uses
the path an older build's re-upgrade already takes. With Herdr quit (no writer runs), back up
`ledgr-data/store.json`, then, in the record of the session the doctor names, add
`"cold": {"file": "<the file's name>", "at": <the 13 digits in its name>, "n": {}}`. Do this only for a warm
session (a cold one names its own file: let an event bring it back first); for a session the store no longer
has, add a record `"<sid>": {"sessionId": "<sid>", "turn": 0, "cold": {…}}`. At the next start the writer
reads the file and brings it back like any cold session, the store's own items and turn records winning over
the file's (a session holding items now comes back at once as a "mixed" one; one holding none at its next
event, or at once with Settings "never"). A session that came back after the loss counts its handles from A1
again; an item of the file whose handle the session's own items hold takes the next free one, its own kept
as `handleWas`, so no handle is held twice. The file then follows the thawed rule
above.

### 10.9 The reading copies

Details in `BUILD-NOTES-detail.md` 18 and `Detail.md`. The panel lists cold sessions under a folded
**OLDER SESSIONS (N)** at the bottom of the session menu, out of the agent groups and ENDED (open while the
shown session is one of them, then as the person clicks it; `ledgr.older-sessions`): each row with its
pill, its name, "N open" and "◆ b" from the stub's counts, and a dim "idle 9 d", or "can't read" when the
writer cannot read its file. Shown, a cold session's file is read (`Reader.wantCold`: from a timer,
bounded by 10 s, the 12 most recently used records kept, a failure tried again after 30 s) and merged
into the copy's own store (`store.js` `mergeCold`: copies beside the stub, `cold` unchanged, never in
`toText()` or `snapshot()`; never into the fallback writer's store, which the panel then shows as a clone
of the text the writer saved). Meanwhile one line: "Reading this session's items (idle 9 days; kept in
ledgr-data/cold/)… 3 open, 1 blocking." Merged, its lanes show as usual, its OLDER THAN A DAY fold open on
its own (it stays open a day after the session comes back, so the first act's thaw folds nothing away);
the header carries a dim "older" pill whose tooltip names the file. A command naming one of its items by
handle (`ledgr.open:A3` and the rest) waits for the read and then runs. The dialog on an item of a cold
session says "Reading this session's items…", never Gone. The first act on any of its items posts its
event as usual, and the writer brings the session back. Settings: one row, "Idle sessions move out of
store.json", 0 ("never") to 60 days, path `retention.coldDays`, written through `Reader.saveConfig`
(never a spool event). The demo has one cold session, so `ledgr.demo` shows OLDER SESSIONS (1).

### 10.10 The Python readers, the installer and the doctor

`bin/lib/ledgr_extract.session_items(sid)` is how every Python reader (the extractor's `recorded_asks` and
`tool_asks`, every MCP tool) reads a session's items: from `snapshot.json`, or, when its `cold` map names
the session, from the file, filtered as `store.js` `snapshot()` filters (`snapshot_copy`: open, answered,
deferred, `rejoin_pending`, dismissed within 7 days; a quote over 200 UTF-16 units, `draft` and `pins`
dropped); a read that fails reads `snapshot.json` once more first. So a resumed cold session's agent sees
the same `open_asks` as a warm one, with no wait. `setup/ledgr_setup.py`: `--check`'s `cold_report` (the
store's size, "N sessions cold in ledgr-data/cold/ (size, files; K thawed, forgotten or redundant copies
the writer deletes in time); retention.coldDays D", the held events; problems: each faulted session with
what to do and its other files on disk, a stub naming a missing file, files naming sessions the store does
not know, every other unnamed file the writer will never delete (it holds what `store.json` lacks, or cannot
be read: the doctor reads it as the writer does, `cold_file`, `cold_lacks`, `archive_ids`), held events of a
session that is not faulted waiting over an hour while Herdr runs), and `./install.sh --thaw-all` (10.11).

### 10.11 Rollback and versioning

`store.json` keeps `v: 1`. `Store.fromText` throws on any other `v`, and an older writer then keeps the
text aside as `store.corrupt-<ms>.json` and starts empty, so its first save would replace the ledger with
an empty one: a version an older build sets aside is no marker. What an older build does with cold
sessions: it keeps the stubs (unknown fields survive), shows them with no items, may add new items or
turn records beside a stub (new ids, handles from `nextHandle`), and its Forget removes a stub (the sweep's
rule a then deletes the file). Nothing in a cold file is lost: on the re-upgrade the writer finds the
mixed sessions and brings them back, the store's copy winning.

The procedure, before installing a build older than Phase 2:

1. `./install.sh --thaw-all` (with `--yes` when there is no terminal). It backs up `config.json`, writes
   `retention.coldDays: 0` and polls `store.json` every second for up to 120 s until no session is cold:
   "no cold sessions". The writer must be running (Herdr open, the ledgr host block or the panel shown). It
   says so only once the writer shows it has taken the 0 (its claim in Herdr's `shared.json` renewed after the
   write and out of housekeeping, or no writer alive) and it has seen none cold twice, two seconds apart: a
   freeze whose own read of `config.json` came just before the write still commits and saves.
2. A session it lists as unable to come back (faulted) needs Try again (after putting its file back), Use
   without its older items, or Forget in the panel first; then run `--thaw-all` again.
3. Only then install the older build. Files left in `cold/` are inert for it.
4. After upgrading again, set the days in Settings: `--thaw-all` leaves `retention.coldDays` at 0.

What happens if the first step is skipped (replayed on the Phase 1 `store.js`, 2026-11-19): nothing is lost,
handles stay unique and turn records merge on the re-upgrade, but two things go wrong meanwhile. An answer typed
to a cold ask in the older build (`[A1]` in the prompt, or the answer sheet) finds no item there and is dropped
without a word. And an ask the agent raises again in the older build is a new item beside the stub, so after
the re-upgrade it sits as a duplicate beside the original from the file.

### 10.12 Tests, the dry run and the live check

The offline suites: `test_store.mjs` (the freeze's rules one by one, the idle clock field by field and its
carry at the freeze, `seen` off the clock, `commitFreeze` refusing every change, `coldNeeded` against every
handler, the round trip, `mergeCold`, faults and resets, `coldGarbage`, the live-shape fixture
`fixture_cold.mjs`: 0.81 MB to 0.61 MB, 20 sessions, 219 KB in files, the largest 38.8 KB);
`test_writer.mjs` sections 30 to 52 (the writer's runs, thaws, holds, replays, faults, the sweep in both
"memory ahead of disk" orders, takeovers and given-up runs at each await, a 1.2 MiB file; 52, the review's
findings: a corrupt store's restart, a store put back from an older copy and a reset each keeping the only
copy, with a self-mutation that switches the content test off; an orphan proven redundant through the store
and the archive; dot-led ids; errors other than "not found" holding nothing; one wanted read a pass; the two
guards the review found masked); `test_list.mjs`,
`test_detail.mjs`, `test_settings.mjs` (the reading copies); `test_mcp.py` and `setup/tests`;
`test_no_keystrokes.py` rule 15 (only `writer.js` and `spool.js` write, unlink, make or remove anything
under `cold/`; the reading copies and the Python readers only read a cold file); and
`tests/test_seams.mjs`, across the seams: the writer's freeze of the live-shape fixture listed by the
panel under OLDER SESSIONS with the counts each had warm, a session read from exactly the file the writer
wrote, the panel's Done thawing it at the writer, the panel then showing it warm with the same rows and
handles; a lost file holding the next event byte for byte, the MCP server's `declare_asks` and
`open_asks` and the doctor saying so against the real files, the panel's Try again replaying the held
events in name order, once; a session with archived items going cold and its Reopen from the archive
thawing it first, the archived count kept; `retention.coldDays` 0 through the settings dialog's writer
during and after a run; Python's `snapshot_copy`, `cold_record_error` and the doctor's `cold_days_of`
equal to `store.js` and `config.js` on shared fixtures, and `session_items` on the writer's real files equal
to what `snapshot()` would hold warm; a corrupt store's restart through the real writer, the file kept and
listed by the doctor; `./install.sh --thaw-all` against the real writer and its claim in `shared.json`; and,
when `LEDGR_OLD_BUILD` names a Phase 1 build's modules, that build taking a store with stubs and the
re-upgrade merging it.

The dry run on a copy of the live `store.json` and `config.json` (2026-11-19, offline, read-only on the
live side, counts and sizes only), with the real `store.js`: the store had grown to 1.95 MB. Phase 1 at 3
days: 1.01 MB (387 items archived, 485 turn records cut). Phase 2 at 7 days, a session whose terminal the
store maps to it treated as live: 15 sessions cold, 0.84 MB, 181 KB in files, the largest 39.5 KB (34
items, 12 turn records), none near 1 MiB, 4 with open blocking asks; with every mapped terminal treated as
gone, 21 sessions and 0.78 MB (the live result lies between, by which terminals are live). Of the 30
sessions idle over a week, 9 had nothing to move and 6 were mapped to a terminal; `freezeBlocker` refused
none; nothing threw. Every session thawed back gave the store again item for item, turn record for turn
record and handle for handle; the only differences were `thawedAt`, `touchedAt` and `coldThawed` on the 15 records
(159 bytes each) and the key order of `d.items` and `d.turns` (what came back is at the end of each map).
The live `config.json` still says `retention_days` 14 and Phase 1 has not run on the live store; at 14
days the same run gives 1.49 MB after Phase 1 and 1.12 MB after Phase 2 (the largest file 95.5 KB), so the
installer's move of 14 to 3 (7.2) is what brings the store under the cap.

The live check, after the install (test items in throwaway sessions only):

1. Phase 1's first run has finished (`d.retention.v` 1); the first tick after it runs the cold run:
   `writer.log` says "cold: N session(s) moved out of store.json into cold/ (…)"; `cold/` holds one file
   per such session; `store.json` is smaller; `snapshot.json` has the `cold` map; the claim showed
   `housekeeping: freeze <sid8>` steps.
2. `./install.sh --check`: the cold lines, no problem.
3. The panel: OLDER SESSIONS (N) with counts and idle days; show one: "Reading…", then its lanes;
   `store.json` still names it cold; the older pill; `ledgr.open:<handle>` on an unread one waits and
   opens.
4. Done on one of its items: `writer.log` "cold: 1 session(s) back from cold/ (…)", the session warm,
   its rows and handles as before, its OLDER THAN A DAY fold open; an hour later the sweep removes its
   file ("cold sweep: …").
5. In a resumed cold session, `open_asks` lists its asks.
6. The fault, in a throwaway session only: move its cold file aside, act on it: the panel's fault view,
   the status line, `--check`'s problem; put it back, Try again: the held events apply once.
7. Settings "Idle sessions move out of store.json": never brings every session back within a second;
   set it to 7 again.
8. `ledgr.demo`: OLDER SESSIONS (1), its session opens.
9. `herdr-app status`: no mod errors.

Not tried live: `writeTextFile(path, text, null)` refusing an existing file and `fs.readFile` and
`fs.writeFile` past 1 MiB (both from the typings); `terminals()` naming live terminals as `canFreeze`
reads them, and whether Herdr reuses terminal addresses; `shared("ledgr.detail").open` going stale after a
dialog crash (it would keep one session warm, harmlessly).

### 10.13 writer.log

- `cold: N session(s) moved out of store.json into cold/ (F file(s), B bytes, the largest L); store.json
  X -> Y characters`, with what changed meanwhile (kept warm, their files removed), what was left for
  the next run (`COLD_RUN_MS`) and files not written.
- `cold: <sid8>'s cold/<file> cannot be read (<why>); its events are kept in cold/held/<folder>/ until Try
  again, Use without its older items, or Forget (tried again every 10 min)`: once per error.
- `cold: N session(s) back from cold/ (<sid8>: I item(s), T turn record(s)[, Try again]; …); N held
  event(s) replayed[ (k threw: spool/failed)]; N event(s) held for <sid8>`.
- `cold sweep: N file(s) no session needs removed from cold/ (…)`.
- `cold sweep: cold/<file> holds N item(s) and M turn record(s) store.json lacks (session <sid8>): kept, never
  deleted; ./install.sh --check lists it, and Retention.md 10.8 says how to bring it back`, or `cold sweep:
  cold/<file> could not be read (<why>): kept, never deleted`: once per file per writer.
- `cold: cold/held/<folder>/<name> does not parse; kept there, not replayed`.

### 10.14 Known limits

- The gain is modest: on the contract's measurement the store went from about 0.86 MB after Phase 1 to
  about 0.65 MB; on today's dry run from 1.01 MB to between 0.84 and 0.78 MB. Most of what stays is the
  open asks of active sessions, those below the threshold above all. The next lever is not cold storage.
- A faulted session's events wait for the person (Try again, Use without its older items, Forget); the
  panel, the MCP server and the doctor all say so. `./install.sh --thaw-all` cannot finish while one is
  faulted, and says what to do.
- While a session's file cannot be read, the MCP server cannot link a repeat to the earlier ask it repeats:
  `repeat_of` is noted as ignored; once the session is back, the writer still merges a repeat with the same
  text, but a reworded one arrives as a new ask.
- The stub's `fault.held` can be one short after a crash between a new hold and its save (the next pass
  finds the copy already there and counts nothing); it is display only: the files are what replays.
- A `snapshot.json` the writer could not write after a thaw (tried twice) still names the session cold:
  the extractor and the MCP server read it from its file, which stays at least an hour, without what that
  pass applied, until the next save; the MCP server then reports the event applied with handles pending,
  never held.
- An older build installed without `--thaw-all` shows cold sessions with no items, and its new items sit
  beside the stubs until the re-upgrade merges them; nothing is lost.
- Tier-3 `herdr:<t>` sessions: `track` skips a cold one, so status turns on its terminal are not counted
  until an event brings it back.
- `pinUseWords` says "used in Q3" instead of "sent in Q3 at turn N" for a question of a cold session.
- Session records accumulate (about 800 B each with `cold`); finished branch records too. A roll-up is for
  later.
- Bringing every session back (`coldDays` 0) can put the store over 1 MiB again (`writeLarge`), by
  design.
- A `store.json` restored by hand from an old backup can name a file the sweep has deleted: the session is
  then faulted and its events held; nothing new is lost.
- A corrupt `store.json` at a start, or one put back from an older copy, leaves the cold sessions it lost in
  files the sweep keeps for good ("recoverable"); their items come back only by the manual step of 10.8. A
  session used without its older items keeps any other file of its own the same way.
- Recoverable and unreadable files are read again by each writer once after it starts (at most four a run),
  and never deleted. Because only an identical copy proves an item, an orphan of a freeze given up whose items
  changed afterwards is one of them: kept for good, though it may only hold older versions.
- A session looked at every day still goes cold (the clock does not read `seenAt`); showing it reads its
  file.
- In fallback mode, while a cold record is merged, the panel parses a clone of the writer's text whenever
  that text changes.

### 10.15 Where the build differs from the contract

- The idle clock does not read `seenAt`, and an act `seen` neither thaws a session nor moves its clock
  (the contract listed `seenAt` among the clock's fields).
- `commitFreeze` carries the idle clock onto the stub; the contract did not, so a stub read only its own
  record's times and counted idle days from too early.
- The sweep's rule (c): a file whose session was thawed after it gets only the grace. As the contract
  wrote it, a file older than a day whose session was just thawed matched the second half of the rule
  (`touchedAt > ms` and the file older than `keepMs`) and would have been deleted at once.
- The sweep saves first when memory is ahead of disk, then decides from the text written. As the contract
  wrote it (skip unless memory equals disk), it would never have run: `publish()` adds the chips'
  diagnostics to memory after every pass's save.
- The third review (same day): an item is proved only by an identical copy, never a later `updatedAt`; the
  cost, accepted, is that an orphan of a freeze given up whose items changed afterwards stays for good (the
  doctor lists it, saying it may simply hold an older version of items the store still has).
- The second review (same day): only a read with no answer is transient, and the third in a row for a session
  faults it; any other read error faults the session with words that say the file is there; the sweep's proof
  is the version of each item and turn record (an id or a turn number proves nothing, "older than the oldest
  kept" neither), lines of another session prove nothing, and the sweep reads `store.json` again before it
  saves or decides.
- The sweep's rules as a whole (the outside review's blocker): the contract's rules (b) and (c) deleted a file
  by name whenever no record named it and its session had moved on, which loses the only copy once
  `store.json` has gone back in time. By name only a file the record lists as thawed (`coldThawed`, new) or a
  forgotten session's goes; any other only after a read proves `store.json` holds all of it.
- Only "not found" (confirmed by a listing) makes a file missing; any other read error is transient. A
  wanted read that times out stops the pass's other wanted reads. An id whose safe name begins with "." is
  never frozen; one frozen before is still read under its own name, and its held folder survives a restart.
- `--thaw-all` waits for the writer's evidence and sees none cold twice before it says "no cold sessions".
- The cold run is hourly (`COLD_EVERY_MS`), not every tick; `canFreeze` also refuses a session in
  `wantThaw` and every session while `coldDays` is 0, and the freeze reads `config.json` again before its
  commit.
- The MCP server says `held` only when it finds its event's copy in `cold/held/`, never from a
  `snapshot.json` that still names the session cold.
- A handle command on a cold session not read yet waits for the read; the OLDER THAN A DAY fold stays open
  a day after a thaw.
