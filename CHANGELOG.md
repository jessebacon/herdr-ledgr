# Changelog

## 0.1.0 (unreleased)

First public shape of the mod. Built on Herdr 0.1.13, hc 0.1.18, Claude Code 2.1.311.

### An ask's summary, no work handed back, the answer box, an image in an answer (2026-11-23)

- Jesse, on an ask in the detail dialog that asked him to confirm the changes in a table: the answer box was
  two rows high with most of the column empty, nothing said precisely what he was to do (a five-row table in
  the message), and the prompt should make clear that ledgr is not a way for the agent to push work back to
  him but a way to cut the back and forth and clear blockers; and the answer "needs to accept a photo
  attachment (from clipboard)". Built by three builders in parallel against one contract (the Python side;
  the store and the writer; the dialog and the list), integrated, reviewed, then a second round for the
  image, a second outside review and its fixes. Built 2026-11-23; the offline suites and
  `herdr-app check mods/ledgr` pass. Installed the same day and checked live by the owner (below), which
  led to one fix, built 2026-11-23 after the live check and installed the same day.
- `summary` on an agent ask, named so at every layer: what the user must do, precisely, readable without the
  reply; at most 1,000 characters (`ledgr_asks.py` `MAX_SUMMARY`, `config.js` `LIMITS.summary`), cut, never
  refused for length; line breaks kept (CR LF read as LF), a run of blank lines made one, the outer
  whitespace dropped (JavaScript's whitespace on both sides, U+FEFF included), markdown kept; empty is none
  and the key is left out. `ledgr_asks.summary_of` and `summary_text`; `validate` keeps it and never drops
  an ask for lacking one.
- MCP `declare_asks`: `summary` joins `ITEM_SCHEMA` and its `required` (no `maxLength`, so a client that
  checks the schema does not refuse a long one). A call with an item whose summary is missing, null, blank
  or not a string is refused whole: `isError`, no spool event, no `mcp/<session>/<turn>.json`, one
  `mcp.log` line, `{ok: false, error: "every item needs a summary", missing_summary, summary_not_string,
  earlier_items_stand}` and words naming the items, saying which summary is not a string, saying when an
  earlier call of the turn stands, and saying in two sentences what a summary holds (`SUMMARY_WORDS`). An
  off space still answers `off: true` first. A summary over 1,000 is recorded cut, with a note. The Stop
  settle carries each summary through unchanged (`ledgr_extract.tool_asks`).
- The block: an optional last bullet field `summary: …` (any case) that takes the rest of the line, a " · "
  inside it included, found only after level, kind and text (a text that begins "Summary:" is the text, as
  before); one line (a line under it is a stray line, reported); the JSON form reads a `summary` key; an
  item without one is accepted (`parse_block.py` `SUMMARY`).
- The extractor: `asks.schema.json` requires `summary`; `extract-system.txt` says what it holds, from the
  message alone: the request first, addressed to the user, with the form of the answer, then what the agent
  says it did, will do with the answer, recommends and why, and what cannot be undone; for a list or table,
  each thing a yes approves; never a fact the message does not state; what is unclear said, not guessed; at
  most 800 characters, one sentence for an optional ask. Which sentences are asks and their levels are
  unchanged. `providers/anthropic.py` `MAX_TOKENS` 4000 to 8000 (the `mixed` fixture went from 487 to 772
  output tokens); `openai_compatible.py` stays at 4000. New fixture `tableconfirm` (a table of five changes
  to confirm: the summary names each, and the one that cannot be undone).
- The rule, in `asks-instruction-ledgr.txt` and `-both.txt` (the reinject prints the same files), the
  server's `instructions`, the `declare_asks` description and the `summary` property's: ledgr exists to cut
  the back and forth and to clear what blocks the agent, not to hand the user work; do all the task needs
  that you can do yourself; stop before a step the task needs that cannot be undone, and ask for a
  go-ahead; declare only what is left that only the user can give (a decision that is theirs, something
  only they know or hold, an action or check you cannot make yourself, a review they asked for, that
  go-ahead); never declare work you could do yourself or ask the user to look up, verify or summarise what
  you can; "A step beyond what you were asked is an offer: do not take it and do not declare it; a line of
  prose is enough."; give each item a summary that stands on its own. It replaces 2026-11-10's "Declare
  only what the user personally must do, decide, provide or review."; the rule on waits for the agent's
  own subagents, tools, builds and tests stays. The block's example is now a decision plainly the user's
  ("Choose how many approvals a production release needs", options one | two, with a summary). Sizes:
  `ledgr` 330 to 596 words, `both` 268 to 534, in every session's context; the server's instructions
  1,991 characters, the `declare_asks` description 1,186. The installer's handoff question counts the words
  when it runs (`instruction_words`; it said ~200 to 260).
- The store (`store.js` `cleanSummary`, `on_asks`): an item made from an `asks` event keeps `summary`,
  cleaned again; a later event for the same item (a re-run extraction, the Stop settle, a later call of the
  turn, an open ask named again) replaces it with a usable one and keeps it when the event brings none, as
  options; an answered ask raised again keeps its own; a new item for a resolved or dismissed one carries
  only the event's; a parked question has none. `snapshot()` and `snapshot_copy` leave it out; the archive,
  cold files, thaw, merge, restore and the sweep's proofs carry and compare the item whole. Demo: A15 and A8
  carry summaries (`fixtures.js` `DEMO_SUMMARY_A15`, `DEMO_SUMMARY_A8`).
- The dialog (`detail.js` `itemParts`): an ask's left column is TEXT, WHAT TO DO (the summary, `listing.js`
  `summaryOf`, markdown linkified as the text is, behind a 2 px accent edge, with Copy; none, no section; on
  a closed and an archived ask too), OPTIONS, ANSWER, RESULT, QUESTIONS ABOUT IT, QUOTE (dim, 12 px), the
  foot line. The answer box is the column's full width and, in two columns, its free height: `detail.js`
  `noteFit` and `fitAnswer` from `on_size_change` reports (the column, the groups above and below the box,
  the ANSWER section), kept per item id; `detailing.js` `ANSWER_BOX`, `answerMinFrame` (8 rows of 12.5 px ×
  the text scale × 1.7, plus the frame: 190 px at scale 1; in a short column 0.6 of it, never under 3 rows),
  `answerFrame` (the drawn height kept only while it fits and is under 4 px short), `answerRows`; the
  textarea `.h(px)` and `set_rows`, no auto-grow, so a long answer scrolls inside. In one column (under 760
  px) it stays at 8 rows, so the message and its marked passage stay in reach. Under the box: the
  attachments row, then the hint and Paste answer (no longer beside the box). A click on the frame's
  padding puts the keyboard in the box. The list's row tooltip gains "What to do:" and the summary's first
  300 characters, before the drafted answer.
- An image in an answer (`attach.js`, new, not an engine file, imported by `detail.js` alone): a file
  `ledgr-data/attachments/<yyyymmdd>-<hhmmss>-<rand6>.<ext>` (png, jpg, jpeg, gif, webp; the folder from
  Herdr's app folder normalised once, `detailing.js` `appRoot`, for `attachDir` and `clipDir` alike, and
  nothing attached when that folder is not known) and one line at the end of the draft, `attached image
  (read this file): <absolute path>`, followed by a line break (`withAttach`); its pattern ends at the
  image's extension, so words typed after it do not unmake it, and the box's cut at 4,000 never leaves part
  of one (`cutDraft`: the line goes whole, and the status line says so); no event, no store field, no writer
  change: the sheet (`answerLines` indents it), the landing
  parser and the `[A3]` ref scan take it as they are (`test-hooks.sh`), and the agent reads the file. A drop
  on the box (`on_drop`, `dropOnAnswer`, `copyIn`: `fs.readFile`, `fs.writeFile`, read back and compared by
  length, 10 s each); ⌘V in the box when the clipboard holds no text (the textarea's `paste_other`) or the
  row's Paste image (`pasteImage`, `prepareSlot`, then `opener.js` `clipboardImage`). Both end in
  `attachWritten`; the ask open, under 4 images (`ATTACH.perAnswer`) and the draft within 4,000 are checked
  before anything is written and again after; 8 MiB an image (`ATTACH.maxBytes`, `CLIP_MAX`); one at a time,
  an "attaching" older than `ATTACH.staleMs` (60 s) no longer holding the next back. The row: a chip per
  line (a thumbnail through `image("ledgr-data/attachments/<name>")`, `image` imported by name, both sides
  set, fitted in 112 × 72, only for a PNG or JPEG of at most 2 MiB whose header gives at most
  `ATTACH.thumbPx`, 4,096, pixels a side, and unless `ui.attachmentThumbs` is false, so a GIF or WebP is its
  chip alone; the name, the size, Reveal, Remove: the line out, the file kept), then Paste image. Nothing
  under `attachments/` is ever deleted by ledgr, nor written over: the clipboard's script only creates, and
  a drop's copy, through `fs.writeFile`, which has no create-only flag, takes a name `prepareSlot` found
  free just before the write. Words: `words.js` `ATTACH_WORDS`; the hint and the footer's `⌘V attach an
  image`. The demo copies and runs nothing.
- The pinned call (the owner's exception: "Yes, allow osascript on ⌘V in the answer box with the pinned
  exception."): `clipboardImage(outPath)` refuses, running nothing, a path not absolute, with a line break
  or NUL, not a `.png`, not directly in `clipDir()` or without an attachment's own name (`CLIP_NAME`), and
  everything when Herdr's app folder is not known; then `exec("/usr/bin/osascript", ["-l", "JavaScript",
  "-e", CLIP_SCRIPT, outPath, String(CLIP_MAX)], { timeout: OPEN_TIMEOUT })`, which `pasteImage` also
  bounds with `within` (`ATTACH.clipMs`, 8 s). `CLIP_SCRIPT` is a constant: the pasteboard's PNG as it is,
  else any image it holds converted to PNG; no image, or over the limit, it throws before writing; its one
  write creates the file and never writes over one (`writeToFileOptionsError` with
  `NSDataWritingWithoutOverwriting`: an existing file is left as it was and the run fails); it makes no
  folder, drives no application, presses no key and changes no pasteboard. `clipResult` words each outcome.
  `opener.js` now imports `exec` and `appHome` from herdr and `appRoot` from `detailing.js`.
- `test_no_keystrokes.py`: rule 1 lets `/usr/bin/osascript` appear once in the whole mod, counted on the
  files as they are on disk (comments included), in `opener.js`, as the pinned call; rule 13 holds five
  shapes, pins `CLIP_SCRIPT` by identity (a full copy, `CLIP_SCRIPT_PINNED`, and its sha256, `CLIP_SHA256`,
  compared with `opener.js`'s raw text character for character; the word checks kept as a second line),
  `clipRefusal` before the call and `clipboardImage` only in `pasteImage`; rule 16 (new): among the mod's
  files only `attach.js` writes or makes anything under `attachments/`, nothing removes or renames there,
  `opener.js` writes nothing itself, only `detail.js` imports `attach.js`, `pasteImage` checks before it
  reads and bounds the run, `pasteImage(` appears in `detail.js` twice (its definition, the `paste_other`
  handler) and in `views.js` once (Paste image in `attachRow`), `attachRow(` is called once, from
  `answerSection`; `attach.js` in `NOT_ENGINE`. The comment stripper respects literals (JavaScript by a
  small lexer: strings, templates with nested `${…}`, regex literals where one may start; Python by
  `tokenize`; shell as before, so a `#` after whitespace inside a quoted shell string is still cut): the old
  one cut a line at any `//` even inside a string, and its block pattern ran from a `/*` inside a line
  comment to the next `*/`, hiding lines of `capture.js`, `spool.js` and `adapters.js` from every rule; no
  rule fails on them. An argument names another copy of the mod to check.
- The installer: `--check` gains one line for `ledgr-data/attachments/` (`attachments_report`: how many
  files, their size; nothing when the folder is absent); uninstall's data question names "attached images"
  and treats the folder as the rest of `ledgr-data/`.
- `store.js` and `config.js` are engine files: until a writer's host reloads, an old writer applies new
  `asks` events and drops their summaries for good. Running sessions get the new wording at their next
  SessionStart, and the server's text and schema after `/mcp` or a resume.
- The first review (no blocker): the wording, major (it forbade a check only the user can make and left no
  door for a go-ahead before a step that cannot be undone; the example contradicted the rule); the narrow
  dialog, major (a filling box pushed the message out of view in one column); and minor ones: a "Summary:"
  text, a multi-line block summary, U+FEFF, the OpenAI-compatible cap, the refusal's words, the box's
  hysteresis overhanging a shrinking column, the fit's measures lost on ⌘↓ then ⌘↑.
- The second review (no blocker in the shipped code; three major findings, two in the guard): edited copies
  of the mod passed every check with a script that also ran a shell, cleared the clipboard and reached the
  network, with one that pressed a key through System Events behind a `//` inside a string, and with a
  dialog that ran the script on every resize (now the pin by identity, the string-aware stripper and the
  callers' counts above; the guard fails on each copy); and the wording, where "a go-ahead for such a step"
  also covered a step beyond the task, so an agent would declare a go-ahead for an unrelated refactor (now
  the step beyond the task is an offer, above; the builder's "Stop only before" lost "only", which read as
  never stopping for a decision that is the user's). Minor: the script could replace an existing
  attachment; `clipRefusal` took any `[0-9a-z-]+.png`; `clipDir` and `attachDir` disagreed on a trailing
  slash and let an empty or "/" app folder through; the "attaching" flag never expired; typing after the
  line or the cut could break it; thumbnails cropped or past a texture limit; `image` through a namespace
  import; two literal no-break spaces in `test_seams.mjs`, now escapes.
- Tests (the builders' counts; those the second review's fixes changed are left to the full run):
  `test_store.mjs` 1,900 (87 on the summary); `test_writer.mjs` 1,165 (section 53); `test_list.mjs` 518;
  `test_detail.mjs`, `test_links.mjs`, `test_seams.mjs`, `test_no_keystrokes.py` and `tests/test_clip.mjs`
  (new, in `test-detail.sh`: the shipped `CLIP_SCRIPT` under `/usr/bin/osascript` on private named
  pasteboards, an existing file left byte for byte, the general clipboard's change count unchanged; skipped
  off macOS); `test_parse_block.py` 68 (`fixtures/blocks/bullets_summary.md`); `test_mcp.py` 181;
  `test-hooks.sh` 235 (the wordings, the examples parse, the image's landing; it fails if "such a step",
  "short of a step" or "go-ahead for that" comes back); `run-extract-fixtures.py` `summary_all`,
  `summary_max`, `summary_names`; `setup/tests` 226. Two live Haiku calls passed: `--live tableconfirm`
  (one blocking confirm whose summary named all five rows and the one that cannot be undone) and `--live
  mixed` (five asks, each summary beginning with the request).
- Installed 2026-11-23 on the owner's word ("please install"), with the maintainer's answers file: 51 files
  written, the two changed engine files copied to the overlay host, the installer's own suite run and
  `--check` healthy. The writer's log shows its host restarting two seconds into the install (Herdr reloads
  a mod when its files are saved), so no relaunch was needed for the writer to start again; whether one is
  ever needed for summaries to be stored is not observed either way: relaunch only if a new ask's summary
  does not show.
- The live check, the same day, in the owner's words: the layout, "LOVE the new answer layout"; ⌘V reaching
  the box while the dialog holds the keyboard, "it does!"; no permission prompt, "I just pasted and never
  saw a permission but I think because herdr is already approved"; his capture tool, "I use cleanshot
  actually"; "I don't see a thumbnail"; a file dropped on the text, "SWEET". What his answers showed: a
  capture pasted into the box and a file dropped on its text both arrived as one plain line, the capture
  file's own absolute path (with spaces in it), because Herdr's textarea pastes a clipboard that carries a
  file reference as the file's path and inserts a file dropped on it as its path. So `paste_other` never
  fired, the frame's `on_drop` did not get the drop, no attachment line was made, and there was no chip or
  thumbnail; the agent could read the file from the raw path; and the clipboard script almost certainly
  never ran, so the permission question stays open.
- The fix, built 2026-11-23 after the live check (`docs/build-notes/BUILD-NOTES-detail.md` 20.2): an image's
  path that lands in the box in one change, a paste or a drop, is copied in through the `fs` route and
  replaced by the attachment line; a path typed by hand is left alone; any refusal leaves the raw path as
  text and the status line says why, ending "its path stays in the answer as text, which the agent can
  read". `detail.js` `pathsIn` (the change handler's one new call) and `attachPathLine`; `attach.js`
  `insertedSpan` (what one change inserted: the new text less the longest prefix, then the longest suffix,
  it shares with the text before; at least two characters, so a path typed by hand, or finished by a
  keystroke, is never taken), `pathOf` (exactly an absolute path, or a `file://` URL percent-decoded to one),
  `pastedPaths` (each line of the inserted text that is one, to a png, jpg, jpeg, gif or webp in any case,
  outside the attachments folder; heic, heif, tif, tiff, bmp, svg, avif and ico said and left,
  `OTHER_IMAGE_EXTS`), `withAttachAt` (the attachment line in the path's place, words before and after it
  on their own lines), `withoutRaw`. Copied in as a drop is (`copyIn`, the same limits and one-at-a-time
  flag); several paths in one paste are taken in order until a limit refuses one; a file dropped on the
  frame and its path arriving in the text within 2 s (`SAME_SOURCE_MS`) make one attachment; a path line
  changed while its file was copied is not named, and the status line says so (the copy stays). The hint
  under the box: "pasting or dropping an image attaches it, as a picture or as its file's path".
  `test_no_keystrokes.py` rule 16 gains three checks: `makeAnswer`'s change handler makes one call,
  `pathsIn`; `pathsIn` and `attachPathLine` reach no clipboard reader, process or write of their own;
  `attachPathLine` takes the file in through `copyIn` alone. What it pinned before is unchanged.
- Settled live: the fitted answer box and the layout, and ⌘V reaching the box.
- Later the same day, on the first installed build (before the path fix was installed): the owner attached an
  image to an answer, and the sheet he sent carried the attachment line whole as the answer's first line,
  `attached image (read this file): <his app folder>/ledgr-data/attachments/20261123-171151-ea79b7.png`,
  with "ok thumbnail worked!!!" under it. Seen live: an attachment line made by one of the first build's
  own routes (Paste image, a ⌘V with an image and no file reference, or a drop on the frame; the file's
  name is the same for all three, so which is not known), the thumbnail drawn (an 850 KB PNG), the line
  landing through the answer sheet, the file created under `attachments/` with the designed name. The
  agent then read that file from the path in the answer with its Read tool, in that one session, in the
  permission mode it was running in, with no permission prompt or refusal; another mode may still ask.
  The check of a macOS prompt when the clipboard script runs was dropped by the owner ("I don't think this
  is necessary now?"), not settled by observation.
- The fix installed: asked through ledgr whether to install it now or leave it for the next install (it is
  not needed to attach an image, only to make ⌘V and a drop on the text do it directly), the owner
  answered "install". Installed 2026-11-23, the day's second install: 6 files written, the installer's own
  suite run, `--check` healthy, the installed mod identical to the repo. (The lead's own earlier attempt,
  on the strength of the first "please install", was refused by Claude Code's permission classifier, so
  the fix waited for his word.)
- The fix seen live on the second install: asked to press ⌘V with a capture on the clipboard and,
  separately, to drop a capture file onto the text, and to say which became a chip with a thumbnail, the
  owner answered with an answer whose first line was the attachment line for a new file under
  `attachments/` (`20261123-181836-3d1f74.png`, a valid PNG on disk) and the words "Seems to work!". So an
  image that reached the box became an attachment through the installed fix, a path having arrived whole
  in one change at least once. He did not say which of the two ways he used, or whether he tried both.
- Not seen live: which of the two ways works (the paste, the drop on the text, or both); whether
  `paste_other` ever fires in his workflow; whether agents write good summaries (`docs/design/Detail.md`
  6.5 steps 12 to 14).

### 598416a: retention Phase 2, cold sessions

- Phase 1 cannot reach open items: a session nobody has touched for a week still carries its open asks and
  turn records in every save. On the contract's copy of that day's store, about 0.86 MB after Phase 1 and
  about 0.65 MB with cold sessions (20 sessions, 207 KB in files, the largest 37 KB): a modest gain, since
  most of what stays is the open asks of active sessions, those below the threshold above all. Spec
  `docs/design/Retention.md` 10. Built the same day as Phase 1 by four builders in parallel against one
  contract (the store; the writer and the spool; the reading copies; the Python readers, the installer and
  the doctor), then integrated and reviewed. Not installed: Phase 1 goes live first.
- What goes cold (`store.js`): a session idle more than `retention.coldDays` (default 7; 0 never, and every
  cold session comes back; `config.js` `coldDaysOf`, `COLD_DAYS`: whole days, 0 kept, a numeric string read,
  negative, over 365 or not a number 7; `ledgr_config.py` and the installer's `RETENTION_DEFAULTS` gain it)
  that holds items or turn records. The idle clock (`touchedAt(sid)`): the record's own times (never
  `seenAt`), its items' `updatedAt`, its turn records' `stopAt`, `asks.at`, `retry.at`; `apply()` moves the
  record's `touchedAt` for every event of a warm session but the pin ops and an act `seen`. Never cold
  (`freezeBlocker`): a deferred item, a confluence waiting to land, a branch launching, launched, running or
  concluded on either side, a resume launching or launched, a retry requested or running, an id whose safe
  name is empty, begins with "." or is another session's; nor (`writer.js` `canFreeze`) a session an agent
  in a live pane is mapped to, the open detail dialog's, the running pass's, one to be brought back
  (`wantThaw`), or any at `coldDays` 0. Open blocking asks do not keep a session warm.
- The file and the stub: `cold/<safe sid>.<ms>-<rand6>.json` (`config.js` `coldName`, `COLD_NAME`,
  `coldDir`, `coldPath`), one JSON document `{ledgr: "ledgr-cold", v: 1, sessionId, at, session, items,
  turns, n}`, checked one way by every reader (`store.js` `coldRecordError`, Python's `cold_record_error`),
  created once through `spool.js` `writeNew` (`writeTextFile`'s expected null; past 1 MiB, `fs.writeFile` to a
  name a listing shows free) and read back. The record stays whole in `store.json` with `cold: {file, at,
  n}` (`n` by level: `q`, `qNew`, `blocking`, `needed`, `optional`, `promoted`, `answered`, `closed`, `items`,
  `turns`, so `countsOf` and `chips()` count any threshold without the file; `chips()` equal before and after
  apart from `o`), `touchedAt`, `thawedAt`, `coldThawed` (the files its thaws read back, the newest
  `COLD_THAWED_MAX`, 8) and `coldLost`. `snapshot.json` gains `cold: {<sid>: {file, fault}}`.
- The freeze (`writer.js` `coldHouse`, `freezeRun`): from the tick's housekeeping only (`houseKick` with
  `tick`, `coldDue`), once an hour (`COLD_EVERY_MS`), after Phase 1's run and never before its first has
  finished, never in a start or a pass. The plan (`store.js` `planFreeze`, oldest idle first, `COLD_RUN_MAX`
  40), one file per session (none begun after `COLD_RUN_MS`, 60 s), `config.json` read again, then
  `commitFreeze`, which checks each session again (its record, items, turn records and counts exactly as
  planned) and in one step carries the idle clock onto the stub, takes the items and turn records out and
  names the file; the files not committed are removed at once; one save. A run given up at any await leaves
  only an unnamed file behind.
- Back before apply (`store.js` `coldOf(ev)`, `coldNeeded`, `thaw`; `writer.js` `applyPass`, `coldPhase`,
  `readCold`): a pass reads every cold session its events need (none for the pin ops, `forget`, `cold_reset`
  and an act `seen`; `branch_started` also its parent, `pins_asked` also its `for_session`) and every one in
  `wantThaw`, at most `COLD_THAW_MAX` (50) a pass, and brings it back: the store's copies win, `nextHandle` is
  raised past every handle, a file item whose handle the store's own items hold is renumbered (`handleWas`),
  and the file is listed in `coldThawed`. `apply()` throws `ColdError` rather than apply to a cold session
  (`test_store.mjs` checks every `on_*` handler against the table). `SpoolReader.poke` runs a pass on an
  empty spool; `coldTick` and `applyConfig` (at 0) poke for `wantThaw`, a due retry, a session an older build
  added items to beside its stub (`mixedCold`), or held events to replay.
- Faulted and held (`writer.js` `readCold`, `coldPhase`; `store.js` `coldFault`: `cold.fault {at, error,
  tries, held}`): only a read that gets no answer is transient (the pass waits), and the third in a row for
  one session (`COLD_TIMEOUT_MAX`, 3) faults it; any other read error, an unparseable file or one not the
  session's faults that session alone, and every other session's events in the pass apply. The words say
  "cold/<file> is missing" only when a listing (`spool.js` `isThere`) shows the file gone, else "cold/<file>
  is there but could not be read (<why>)". Each event that needs a faulted session is copied create-only, under its spool name, to `cold/held/<safe sid>/`
  (`holdEvent`) and leaves the spool, so nothing waits and the watchdog sees no stall. The tick tries the file
  every `COLD_RETRY_MS` (10 min); Try again (`cold_retry {session_id, file}`) at once; Use without its older
  items (`cold_reset {session_id, file}`, two clicks: `on_cold_reset` keeps `coldLost {file, at, frozenAt,
  n, error}` and leaves the session warm and empty, `nextHandle` kept) or Forget; then the held events replay
  in name order, once (`heldEvents`, `heldIn`, `coldDone`).
- The sweep (`coldSweep`, after the freeze; `store.js` `coldGarbage`, `coldUnproven`, `coldLacks`,
  `trimThawed`): `store.json` is read again first, and nothing is saved or deleted that run unless it is the
  text the writer last read or wrote (a store replaced by hand while Herdr runs); memory ahead of disk is
  then saved first and the decision made on the text written. A cold file goes only when provably
  redundant: by name, one its session's record lists as thawed, `COLD_GRACE_MS` (1 h) after the thaw, or a
  forgotten session's, `COLD_KEEP_MS` (1 day) after the Forget; any other unnamed file of one recorded
  session that is not faulted, over a day old, at most `COLD_CHECK_MAX` (4) a run, is read and deleted only
  when the proof holds version by version (`coldLacks`, `archiveCopies`): each item has an identical copy
  of the same session in `store.json` on disk, the session's named cold file or its archive, never merely a
  later one (a store put back from a backup and touched once is stamped later while holding less); each turn record an identical copy in the store, the named file or the turns
  archive, or a store copy that differs only by a head the archive holds. An id or a turn number alone, or a
  record older than the oldest kept, proves nothing. Otherwise the file is kept for good (`keepCold`: said once in `writer.log`, listed by
  `--check`; `Retention.md` 10.8 has the manual way back). A file a record names (`cold.file`,
  `coldLost.file`), `cold/held/`, and a file whose safe name matches no session or several are never deleted.
- The reading copies: the session menu ends with a folded OLDER SESSIONS (N) (`panel.js` `sessionMenu`,
  `olderShown`), each row's "N open", "◆ b" and "idle 9 d" from the stub (`countsOf`, `words.js`
  `idleWords`), "can't read" for a faulted one. Shown, a cold session's file is read (`reader.js` `wantCold`:
  from a timer, `COLD_READ_MS` 10 s, `COLD_CACHE` 12 records, a failure tried again after
  `COLD_LOAD_RETRY_MS` 30 s; `listing.js` `parseCold`) and merged into the copy's own store (`store.js`
  `mergeCold`: copies beside the stub, out of `toText()` and `snapshot()`; never the fallback writer's live
  store, the panel then showing a clone, `viewStore`), "Reading this session's items…" meanwhile; a dim
  "older" pill; its OLDER THAN A DAY fold open on its own, and for a day after it comes back (`olderAuto`);
  the fault view, with Try again, Use without its older items and Forget, names the session's other files in
  `cold/` (`Reader.coldOthers`); the status line names a session the writer cannot read (`coldFaultsLine`); a
  handle command on a cold session not read yet waits for the read (`coldWait`); the dialog on one of its
  items says "Reading…", never Gone (`detail.js` `coldTarget`). Showing a session never brings it back, nor
  moves its clock. Commands `ledgr.older-sessions`, `ledgr.cold-retry`, `ledgr.cold-reset`, bound to no key.
  Settings: "Idle sessions move out of store.json", 0 ("never") to 60 days (`settings.js` `COLD_RANGE`,
  `clampColdDays`, `retention.coldDays`). The demo has one cold session, "nightly report backfill"
  (`fixtures.js` `FIXTURE_COLD`).
- The Python readers: `ledgr_extract.session_items(sid)` reads a cold session's items from its file, filtered
  as `snapshot()` filters (`snapshot_copy`), for `recorded_asks`, `tool_asks` and every MCP tool, so a resumed
  cold session's `open_asks` answers as a warm one's. On a session whose file cannot be read, `declare_asks`
  and `resolve_asks` stay `ok`, add `cold` and two lines telling the agent to tell the user and list the
  items; `writer: "held"` only when the server finds its own event's copy in `cold/held/` (`held_ids`,
  `cold_now`).
- The installer: `--check`'s `cold_report` (the cold sessions, their files and held events,
  `retention.coldDays`; problems: a faulted session with what to do and its other files, a stub naming a
  missing file, files naming sessions the store does not know, files the writer keeps for good, held events
  not replayed for an hour); `./install.sh --thaw-all` (`cmd_thaw_all`): backs up `config.json`, writes
  `retention.coldDays` 0, waits up to 120 s, and says "no cold sessions" only once the writer's claim shows
  it took the 0 (`writer_settled`) and it has seen none cold twice, 2 s apart.
- Rollback: `store.json` stays `v: 1` (an older writer sets aside a store of any other version and starts
  empty). Before installing a build older than this: `./install.sh --thaw-all` (with `--yes` when there is
  no terminal) until "no cold sessions"; a session it lists as unable to come back first needs Try again,
  Use without its older items or Forget in the panel; then the older build; after upgrading again, the days
  in Settings (`--thaw-all` leaves 0). Skipped, nothing is lost, but meanwhile cold sessions show empty, an
  `[A1]` answer to a cold ask is dropped and an ask raised again becomes a duplicate after the merge
  (`CLAUDE.md`, Rollback past cold sessions).
- Caught before the review: the contract's sweep would have deleted at once a day-old file whose session had
  just been thawed, and would never have run (memory is always ahead of disk: `publish()` adds the chips'
  diagnostics after every save), so it saves first; the idle clock read `seenAt`, so a glance made a cold
  session's row say "idle 1 min"; a stub counted its idle days from its record alone. The outside review
  (one blocker): the sweep deleted a file once no record named it, which loses the only copy after a corrupt
  store's restart, a store put back from a backup, or a reset with another file on disk (now "provably
  redundant", above); a safe name beginning with "." could be frozen and never read back; any fs error
  faulted a session as missing; wanted thaws could hold a pass for minutes (one that gets no answer now stops
  the others); `--thaw-all` could report "no cold sessions" while a freeze commit was saving; two guards
  masked by others, now tested alone. A second review round: the first fix for fs errors made every error but
  "not found" wait, which would have held every session's events behind one unreadable file (now only a
  read with no answer waits, three in a row fault, and any other error faults that session alone); the
  sweep's proof matched ids and turn numbers, counted a turn record older than the oldest kept as cut, and
  took other sessions' archive lines (now version by version, per session); the sweep decided from the text
  last written, not `store.json` as on disk (now read again first). The detail dialog's fault view names the
  session's other files too.
- A dry run on a newer copy of the live `store.json` (offline, read-only): 1.95 MB; Phase 1 at 3 days,
  1.01 MB; Phase 2 at 7 days, 0.84 MB (15 sessions, 181 KB in files, the largest 39.5 KB), 0.78 MB with every
  mapped terminal treated as gone (21 sessions); nothing threw, and every session thawed back gave the store
  again item for item and handle for handle.
- Tests: `test_store.mjs` 1,809 checks (+689: the freeze's rules one by one, the idle clock and its carry,
  `commitFreeze` refusing every change, `coldNeeded` against every handler, the round trip, `mergeCold`,
  faults and resets, the sweep's proof, the live-shape fixture `fixture_cold.mjs`: 0.81 MB to 0.61 MB);
  `test_writer.mjs` 1,151 (+437, sections 30 to 52: freeze runs given up at every await, thaws, holds and
  replays, faults, the sweep in both "memory ahead of disk" orders, takeovers, a 1.2 MiB file, the review's
  findings, 52f the second round's); `tests/test_seams.mjs` 136, new (`tests/test-seams.sh`, in `run-all.sh`: the real writer, panel,
  settings writer, MCP server, Python readers and doctor on one scratch `ledgr-data`; 143 with
  `LEDGR_OLD_BUILD`, a Phase 1 build's round trip); `test_list.mjs` 506 (+114), `test_detail.mjs` 1,345
  (+342), `test_settings.mjs` 864 (+64); `test_no_keystrokes.py` 1,082 (+290, rule 15: only `writer.js` and
  `spool.js` write, unlink, make or remove anything under `cold/`; the reading copies and the Python readers
  only read); `test_mcp.py` 162; `setup/tests` 217 (+53); `test-store.sh` (the Python default `coldDays` 7).

### 9e02841: retention, closed items and old turn records leave store.json

- `store.json` had reached 1.76 MB and grew about 100 KB a day, so every save went through `writeLarge`,
  the path the writer stalled on (2026-11-12, twice on 2026-11-19). Measured: closed items 46 %, turn
  records 30 %, open asks below the threshold 18 %. The old archive (`writer.js` `housekeep`, 14 days,
  `archive/<yyyy-mm>.jsonl`) had two defects: nothing read it, so an archived item left Closed and could
  not be reopened, and its month file, appended through the capped write, would have passed 1 MiB; with
  14 days nothing on the live store was ever old enough. Spec `docs/design/Retention.md`. Built by three
  builders in parallel against one contract, then integrated.
- What leaves the store (`store.js`): a closed item past `retention_days` (default 3, was 14; whole days
  1 to 30, one reading for the store, the writer and the settings row, `config.js` `retentionDays`; a
  dismissed one never before 7 days, as far as the extractor's dismissed list and `snapshot()` look back),
  as a copy (`archivable`); `removeItems` takes only one still closed and still the planned JSON, and
  counts it on `session.archived`; turn records past the newest `retention.turns` (default 12) per session, and the
  `textHead` of each kept record past the newest `LIMITS.turnHeads` (2) (`planSlim`, `applySlim`, which
  cuts only what is still as planned). Records are leaner from now on (`leanTurn`: no default `textPath`,
  no null field; every reader falls back to the default turn file), and `applySlim` makes the old ones so,
  losslessly. Pins never leave; open items are never touched; handles are never reused.
- The archive files (`spool.js`): `archive/<session>/items-<ms>-<rand6>.jsonl` (an item per line, as it
  was) and `turns-<ms>-<rand6>.jsonl` (a cut record or a moved head), each at most 512 KiB, created once
  and never written again (`writeNew`: `writeTextFile`'s expected null, then read back whole). The folder
  is the session id through `config.js` `safeName`, the one mapping `bin/lib` `safe_name` and the MCP
  server use too (per code point). The legacy month files are read, never written. Reading rule: an id
  the store holds wins; among lines for one id, the newest file's last line.
- Housekeeping (`writer.js` `houseDue`, `houseKick`, `housekeep`, `archiveLines`): the holder runs it at
  the first start after the upgrade, once a day, and within the hour once the saved store passes
  `HOUSE_SIZE` (768 KiB) and has grown `HOUSE_GROWTH` (64 KiB) since the last run ended (on the live data
  the store stays over 768 KiB after its trim; a change of retention lets it run again); as its own task, kicked from the start and the tick and never awaited, so the
  writer keeps answering pings. The first run keeps the store as it was in
  `store.pre-retention-<ms>.json` (through `writeLarge`) and archives nothing without it; then files per
  session, each a named step the watchdog sees (kind `house`), and only after a file is confirmed are its
  items removed and its records cut (one `applySlim` per run), then one save. Drains run meanwhile:
  `removeItems` and `applySlim` check again. A run whose generation was given up writes and removes nothing
  more; a run that found nothing writes and saves nothing; a run whose config is not `config.json` as read
  archives no item. `d.retention` `{v: 1, at}` is set once the first run has finished; `writer.log` says
  what each run did.
- Restore (the dialog's Reopen on an archived item): one spool event `{type: "restore", session_id, item,
  file, reopen: true}`. The writer reads the line before the batch applies (`fs.readFile`, bounded: a
  legacy month file may pass the cap) and attaches `record` or `record_error`; `store.js` puts the item
  back under its own id and handle (`restoreItem`; a handle another item holds now, or one the session's
  counter could hand out again, gives way to the next one, the old kept as `handleWas`), always reopens it
  through the reopen act, lowers `session.archived` for an items file's line (a legacy line was never
  counted), and returns `restore: {item, ok, error?}`. The event is always consumed (a waiting event is
  what the watchdog calls a stall); a failure is the writer's note, and so is an act for an item a run has
  just taken.
- The reading copies: `Reader.loadArchive` (the session's items files and the legacy month files, through
  `listing.js` `archiveRecords`; each items file read and parsed once, by name; the panel's and the
  dialog's read bounded, said and read again after a failure); the CLOSED fold ends with
  `archived (N) · show` and, shown, the archived rows (state word "archived", dim, no quick action; the
  cursor and Enter work on them); the dialog opens one read-only (props `archived`: its file), marked
  ARCHIVED with when and how it closed, its one action Reopen ("reopening…", then back in the list, or
  "could not be read" once the writer took the event without bringing it back; after 15 s with neither, it
  says the writer has not taken it yet and keeps waiting). A dialog open on an item a run archives shows
  it archived. Settings: "Closed items stay in the
  list", 1 to 30 days (`retention_days`). Commands `ledgr.archived` and the dialog's `detail:reopen`; the
  demo counts three archived items (`fixtures.js` `demoArchive`).
- The old default left behind: the hooks (`ledgr_config.load`, on a first run) and the installer
  (`apply_config`) wrote every default into a new `config.json`, so an older install holds
  `"retention_days": 14`, which wins over 3; on the live store nothing would have been archived and the
  store stays past 1 MiB. The installer moves 14 to 3 once (`migrate_retention`; no dialog ever offered
  the value before), says so in the Plan and the summary, and records it in install-state
  (`migrations.retention_days`), so a 14 chosen in Settings later stays. Both config merges fill
  `retention.turns` into a file that lacks it.
- The doctor (`setup/ledgr_setup.py` `retention_report`): `retention_days` and `retention.turns` as
  configured, `store.json` against the 1 MiB cap and `HOUSE_SIZE` (read from `writer.js`), when
  housekeeping last ran and whether the first run has finished, the archive (files, bytes, the archived
  count) and the one-time copy; the old 14 that no install has moved is a problem, with what to do.
- A dry run on a copy of the live store (offline, `store.js` functions only): 1.80 MB to 0.87 MB, 387
  closed items archived, 442 turn records cut and 210 heads moved, in 48 files for 29 sessions (918 KB,
  the largest 116 KB); every `textPath` was the default turn file; nothing threw; the reading rule gave
  every archived item back. At 14 days nothing would have been archived.
- An outside review of the integrated code (no blocker, two major, eleven minor), fixed with a test each:
  the dialog's wait for a slow writer (it said "could not be read" and kept saying it after the item came
  back); the size trigger writing small files every hour (`HOUSE_GROWTH`; each items file read once by the
  readers); one clamp of `retention_days` and no item archived on a config read that failed; a handle
  issued twice after a session record was made again; a change without `updatedAt` lost at removal; a
  legacy restore lowering the count; a closed restore archived again (a restore always reopens); a dialog
  showing "gone" for an item archived while open; an archived line that says open getting an answer box;
  reads with no time limit; a turn key "07". `spool.js` `within` no longer leaves its limit unhandled.
  Documented as known limits: an act for an item a run has just taken (now said in the writer's note),
  Forget leaving `archive/<session>/` (an open question), a new reading copy beside an old host engine
  before a relaunch.
- Tests: `test_store.mjs` 1,120 checks (+226: the floor and the clamp, the re-check by JSON, plan and slim
  with keys, leaner records, restore with handles and the legacy count, a re-raise after archiving, a
  store of realistic size slimmed by exactly what goes; one safe name, the timestamps `applySlim` keeps,
  no `updatedAt` set, `retention.turns` merged in); `test_writer.mjs` 714 (+462: the first run on a 1.7 MB
  store, create-only names, a given-up run, a late write, an item reopened meanwhile, the triggers with
  `HOUSE_GROWTH`, restore, no run in a non-holder or a check copy; section 28 across the seam: the run's
  files read back by `Reader.loadArchive`, the dialog's Reopen event restored by the writer, the item
  archived again in a newer file whose line wins; section 29, the review's: a failed config read, an act
  for an archived item, an archive write timed out on a timer that fires); `test_list.mjs` 392 (+90),
  `test_detail.mjs` 1,003 (+277), `test_settings.mjs` 800 (+63); `test_no_keystrokes.py` 792 (+208, rule
  14: only the writer writes under `archive/`, through `writeNew` in `archiveLines`; the readers only
  read; Reopen posts one event); `test-store.sh` (the hooks' retention defaults and merge, `safe_name`
  agreeing with `safeName`); `setup/tests` 164 (+45: the migration through a whole install, the doctor's
  lines, `retention_days` as the mod reads it).

### c1c7775: a writer that holds its claim but does not move

- ledgr stopped applying the spool at 09:46:20 and stayed so for hours, the second silent freeze in a
  week. One drain applied its events and saved `store.json` (1.63 MB, through `writeLarge`) but never
  returned, so its `running` flag stayed set and every later drain returned at once; the tick still
  renewed the claim, so no host and no panel took over; the MCP server answered `ok: true` with "they
  appear in the panel"; `./install.sh --check` said healthy. 103 events queued, none lost. Which
  await hung is unknown (Herdr leaves a cancelled task's promise pending for ever, and the writer
  kept no diagnostics); the change is for the class of failure, not that one await.
- Progress in the claim: `shared("ledgr.writer")` now carries `pass` (the running pass or start: its
  start, the step it waits in, since when), `done` (when the last pass ended) and `stall` (the
  watchdog's last finding). Every drain is a pass with named steps (`spool.js`: list, read, apply,
  unlink; `writer.js`: apply: config.json, re-anchor, decisions.md, save: store.json writeTextFile /
  temporary copy / read back / mv, snapshot.json; a start's steps).
- The watchdog (`writer.js` `watchdog`, `unstick`, from the 60 s tick): a pass or a start that has
  waited in one step longer than `PASS_STUCK_MS` (90 s), or a spool event older than that while no
  pass runs, is stuck. The holder says so (`fault` and `stall` in the claim, the panel's status line,
  `ledgr-data/log/writer.log` with the step, the pass and what the save chain waits in), gives the pass
  up and starts again from `store.json` on disk. A new generation (`gen`, `SpoolReader.epoch`):
  nothing the given-up pass awaits can apply, save, record or unlink anything when it settles, if
  ever; a start removes the `.store.json.large-*` copies an earlier save left before it reads, so a
  late `mv` finds nothing to move, and fails (the watchdog starts again) unless a second listing proves
  none is left; the `ingested` ids keep an event applied twice from counting twice. After
  `MAX_UNSTICKS` (3) restarts with no pass finished, the copy backs off (`backOff`, `cooling`: 5 min,
  then twice that each time up to 30 min) and keeps the claim, which says it is stuck and when it tries
  again; it never gives the role up on its own, since with one host nobody else would take it. Another
  host takes over a claim that has not moved for `TAKEOVER_STUCK_MS` (240 s), and so does a shown
  panel.
- Limits on the save chain (`SAVE_TIMEOUT_MS`, 20 s per await, `spool.js` `within` on a `cx.timer`;
  the `mv` also with exec's own `timeout`): `writeTextFile`, the temporary copy, its read-back, the
  `mv`, `snapshot.json`, re-anchoring's turn reads, `decisions.md`, the start's reads. A save that gets
  no answer is a fault ("store.json not written: mv: no answer in 22 s"), never a hang, and the store
  stays whole: only the `mv` touches it, one rename, asked `ok()` right before.
- The panel (`panel.js`): it ticks its fallback writer whenever it is there and not retired (its
  watchdog runs while it restarts or backs off), replaces a fallback that is neither writing, starting
  nor backing off (`writer.js` `fallbackDead`), and looks for a writer from render whenever the claim is
  gone or has not moved (`writerWanted`, every `WRITER_CHECK_MS`, 15 s), not only when it is shown.
- The status line (`words.js` `writerHealthWords`, `NO_WRITER`): "ledgr writer stuck 95 s in save:
  store.json mv; restarting it", "… 3 restarts in a row did not help; it tries again in 5 min, or
  relaunch Herdr", an event that waits and is not applied, "no progress for 3 min" from a claim's own
  pass, "none holds the role" when there is no claim, then "restarted 2 min ago after 95 s stuck in …"
  for ten minutes; a fault or a stall before the fallback's own note.
- The MCP server (`ledgr_mcp.py` `writer_state`): the spool's times, `store.json`'s and the claim in
  Herdr's `shared.json` decide ok, behind (`writer: "idle"`, not waited for) or stalled (`writer:
  "stalled"`). An event *waits* when it is over 5 s old and `store.json` has not been written since it
  arrived; only then does the claim count, since a claim is as old as the last beat (hours old after the
  machine slept, while the writer works). Waiting with a writer at work (a fresh claim whose pass or
  start is in a step for under 90 s: starting, or draining a backlog after a relaunch) is behind;
  otherwise stalled when the event has waited over 90 s, or the claim is gone, not renewed for 3 min,
  stuck in one step, or backing off. A `shared.json` caught mid-write counts as not known. Stalled,
  `declare_asks` and `resolve_asks` stay `ok: true` and
  say plainly that the items (or closures) are queued, not shown, and that the agent should tell the
  user the writer is not applying events and list the items in its reply; `writer_status` gives the
  numbers. The server's instructions gain one sentence for it.
- The doctor (`setup/ledgr_setup.py` `writer_report`): the claim's step, last pass and last restart,
  the spool's count and oldest event against `store.json`'s time, by the same rule (the claim counts
  only when an event waits; a writer at work on a backlog is not a problem); a stall (or an event the
  writer does not apply) is a problem with the numbers and what to do (relaunch Herdr).
- From the review, also: `start` writes nothing to the store or the config after an await unless it is
  still the latest, and sweeps only once it knows it still holds the claim (a copy that lost the race no
  longer removes the holder's copy); the tick checks its generation after every await; the config and
  identity-map watch is one per generation with limited reads, and the tick reads every map record's
  space again once a minute; `decisions.md` and `archive/*.jsonl` are appended through
  `spool.js` `writeAtomicWith`, which makes the text again from each read (`writeAtomic`'s retry wrote
  the first read's text over lines that landed meanwhile), and an archived item's line is never added
  twice. Known limit, documented (BUILD-NOTES-mod.md 18.5): a batch's branch launch, close, resume or
  retry is not started again when its pass dies after its save.
- Tests: `test_writer.mjs` 252 checks (+186: a pass whose mv ran and never answered, seen, restarted,
  nothing applied twice; a given-up save whose mv runs late and lands nothing; the reader's
  `abandon` and a role lost between unlinks; a timed-out large write; an event that waits; the
  back-off, doubling, then a restart that works; a takeover with the old pass settling late; writer.log's
  bound; and the review's: a sweep that cannot list fails the start and no event is lost, an old pass
  whose copy lands after the generation changed moves nothing in, a lost start race, the config watch
  and the map rescan, appends kept, a panel's fallback restarted by its own tick); `test_settings.mjs`
  743 (+31: the panel ticks, replaces and looks for its fallback, its status line); `test_mcp.py` 118
  (+20: behind, stalled, an old event while the writer moves, resolve stalled and behind, the claim
  counted only when an event waits: after a sleep, a relaunch backlog, a half-written `shared.json`, a
  stuck pass, a stale, missing or backing-off claim; the instruction, the constant); `setup/tests` 119
  (+22, the same cases for the doctor). The guards were mutated one at a time and a test failed for each
  (BUILD-NOTES-mod.md 18.6).

### f45b5ed: the writer past 1 MiB

- ledgr froze for every session at 15:35: Herdr's `writeTextFile` refuses a file over 1 MiB, and a
  nine-item `asks` event took `store.json` from 1,041,470 to 1,049,830 bytes. The writer caught the
  error into a note nobody showed, kept the events in memory, published chips from them and left
  every spool file in place. Fix: a store or snapshot over 1 MiB is written through `fs.writeFile`
  to a temp file, read back, then moved into place (`writer.js` `writeLarge`); an event that throws
  is quarantined to `spool/failed/` with its error and the batch applied without it; the writer's
  claim renews every tick and carries `fault` and `failed`, which the panel's status line shows.
  Fixture `bin/tests/fixtures/spool-stall/`, writer tests 66.

### e5c9a34: dialog frame as the gallery image

- `preview.png` is now the detail dialog frame (the gallery and the mod page show one image per
  mod, and the page strips images from the recipe body); the scan-list frame is
  `docs/preview-list.png`, linked from the README. Jesse's choice.

### b2f37a1: recipe within the gallery's limit

- ledgr dropped off herdr.dev/mods: the gallery's index (`assets.herdr.dev/mods/index.json`) skips a
  `RECIPE.md` of 64 KiB (65,536 bytes) or more, and ours had grown to 66,294. The recipe is
  rewritten to the manual's form, 47,986 bytes: `# ledgr`, one paragraph, the preview, then exactly
  What you see, How it behaves, Built from, Watch out and Done when. The first two parts are prose
  with no code (key names and labels as words); the 9.3 KB "Before you add it (disclosure)" section
  is folded into the opening of Watch out ("what it assumes about the setup"); repetition, history
  and most of the shot-command list are cut, with the build spec, `Detail.md`, `Pins.md`, the build
  notes and `docs/preview-recipe.md` named in Built from for the detail. No rename: the manual needs
  no match between the mod folder and the repository's name.
- The guard: `setup/ledgr_setup.py` `recipe_check` (`RECIPE_LIMIT` 64 KiB fails, `RECIPE_WARN` 56
  KiB warns) also checks the form (the title first, one paragraph and the image, the five `##` parts
  in order and no others, no code in the opening, What you see or How it behaves). `test_recipe` in
  `setup/tests/test_ledgr_setup.py` runs it on the repo's file and on scratch recipes (+15, 97), and
  `./install.sh --check` prints the recipe's size against the limit (reported, not counted as a
  problem). `docs/publishing-requirements.md` gains the limit's row.

### 8d44cb6: multiline answers, drafted mark, next question

- The detail dialog's answer box takes several lines: a `Textarea`, two lines growing to ten, then it
  scrolls (`detail.js` `makeAnswer`, `views.js` `answerBox`). Enter is a new line; the paste of the
  turn's answers moved to ⌘Enter, the `mod:ledgr` `btw` command, which in the dialog (while it holds
  the keyboard on an ask) means the turn's answers; the box's own ⌘ submit does the same, one paste
  per keypress (`pasteSheet`). Footer hints "⌘Enter paste the turn's answers", "Enter newline". In the
  sheet an answer's blank lines are left out and its next lines indented two spaces (`confluence.js`
  `answerLines`); the landing parser reads an indented line as the same answer, joined by a line
  break, never as another `A<n>:`, a marker or a fence (`ledgr_landing.py`). A draft is cut at
  `LIMITS.answer` (4,000) instead of 400. Tests: detail +60 (670), store +5 with the parser on a
  multi-line sheet (886), hooks +3 (224), no keystrokes +17 (558: `pasteSheet` and `step` run
  nothing; `makeAnswer` pastes only with ⌘).
- An answer typed or picked and not sent shows on its row (`listing.js` `draftPending`): an open ask
  keeps its Paste button; an ask below the threshold or deferred says "drafted" in `dim` in place of
  its state word, and the row's tooltip ends with the answer. It follows the status (answered or
  resolved: gone), since the store keeps the draft after the sheet lands; an ask reopened after its
  sheet landed is drafted again only for a new answer. Suggestions with answers already count in
  Paste N answers and go into the sheet (`copyAnswers` takes every open ask of the turn). Tests: list
  +57 (299, with `laneOf` below).
- Next and previous in the dialog: ⌘↓ / ⌘↑ (`ledgr.detail-next`, `ledgr.detail-prev`, added to
  `keys.json` `mod:ledgr` and the installer's `MOD_KEYS`; ⌘] and ⌘[ stay Herdr's `agent.next` /
  `agent.prev`) and the header's `← prev`, `3 of 19`, `next →`, dimmed at either end (no wrap). The
  order is the panel's (`listing.js` `laneOf`: the session's asks by turn, newest first, blocking first,
  those below the threshold last; YOUR QUESTIONS; the pins; a fold's items). A move posts the waiting
  draft (`Reader.sendDraft`), shows the record in place (`retarget`), leaves the keyboard on the dialog
  (Tab enters the answer box) and rewrites `ledgr.detail`'s open record, so the panel's cursor follows (`noteDetail`). Tests:
  detail (the order with suggestions, the ends, the draft posted once before a move), list (`laneOf`
  on every lane, `neighbors`). Not tried live yet: which of the textarea and the `mod:ledgr` section
  takes ⌘Enter and ⌘↓ / ⌘↑ first.
- Review fixes (`docs/build-notes/BUILD-NOTES-detail.md` 16.1): a step leaves the keyboard on the dialog;
  ⌘Enter carries a deferred or answered ask's own answer; ⌘↓ / ⌘↑ only while the dialog holds the
  keyboard; the landed answer recorded whole (4,000) and compared whole for "drafted"; an `[A7]` inside a
  sheet is no ref (`ledgr_landing.sheet_lines`); a sheet over 24,000 refused, `MAX_SCAN` 96,000; the box
  cut at 4,000 with a word; a pin note saved on a move; ⌘Enter's own line break put back (defensive).

### c049075: preview retake and whole-turn text

- Preview retaken for the list and the dialog: `preview.png` is the scan list (a pin, Ask 1 and Ask 2
  as one-line rows, Ask 3 below the threshold) and `docs/preview-dialog.png` the same state with the
  detail dialog open on Ask 2, linked from the README; both from a throwaway Claude Code session on
  Haiku in a neutral folder, on the tool path (`docs/preview-recipe.md`, with the steps for the pin,
  the picked option, the cursor row, the window size and the crop).
- The saved turn text is the whole turn. Found in that retake: on the tool path (text, the
  `declare_asks` call, the pointer line) `turns/<sid>/<turn>.md` held only Stop's
  `last_assistant_message`, the text after the last tool call, so the dialog's THE MESSAGE showed only
  `ledgr: 3 items for you, 2 blocking` with no passage marked, and a pin from the plan was verified
  from the screen instead of the saved turn. Stop part A now writes every main-thread assistant text
  block since the prompt, a blank line between them, with `last_assistant_message` as the last part
  (`last_assistant.py` `whole_turn`, which reads the transcript backward from its end and parses only
  text and prompt lines; about 2 ms on a 5 MB transcript whose last turn has 40 tool calls), and
  `last_assistant_message` alone when the transcript cannot be read. `turns/<sid>/<turn>.json` beside
  it keeps the final message (what `--retry` extracts from, so a retried turn sees what its Stop saw),
  the source and one `{uuid, message_id}` per part; the turn's `passage_hash` stays the final
  message's. A declared turn's quotes are checked against the turn file, the final message added only
  when it is not in it (`ledgr_extract.whole_text`). No reader changed: the file is still plain text.
  Takes effect from the next Stop in any session after `./install.sh`. Tests: last_assistant +12,
  hooks +11 (203), detail +1 (610).
- The race in that retake (one run in four saved only the pointer line and dropped all three quotes:
  Claude Code writes the turn's records after Stop fires, and `whole_turn` read a transcript that held
  the prompt but not the plan) is closed: part A writes the whole turn only when the transcript
  already holds `last_assistant_message` (`last_assistant.holds_final`, and the turn's prompt is this
  turn's), else the final message alone with `lagged: true`; part B re-reads on the uuid lookup's
  schedule (0, 1, 2, 4 s), rewrites both turn files once the transcript catches up, before it emits
  `stop`, and a declared turn that never catches up checks its quotes against the final message plus
  this turn's partial text, so a quote in the final message is never dropped. Tests: last_assistant
  +9, hooks +18 (221).

### 21d4d1f: list and detail dialog, settings, links

- Jesse: "when trying to view the side bar entries, I can't interact with the text. what if the
  sidebar was a bit more simplified list and clicking on an item opened a larger central modal".
  The cause: a row's text was a plain element, which Herdr cannot select, inside the row head whose
  click folded the row. Herdr selects text only in a markdown view with `.selectable(true)` or a
  read-only Editor. Spec: `docs/design/Detail.md`; notes: `docs/build-notes/BUILD-NOTES-detail.md`.
- The panel is a scan list: one line per ask, question, pin or branch (glyph, handle, one pill, the
  text's first line, a state word such as "answer ready", "sent at turn 14" or "branch working";
  `listing.js` `rowModel`). Only Done (on the hovered and the cursor row), Paste answer (an answer is
  ready) and Promote (a row below the threshold) stay on a row. A click gives the list the keyboard:
  ↑ ↓, PageUp / PageDown, Home / End move a cursor over every line a click acts on, Enter does what
  its click does, Space checks a pin, Esc clears. `ledgr.focus-list` (bound to no key) does the same
  without the pointer; `mod.json` gains no `focusable`, so the host block is no pane stop.
- A click on a row, or Enter, opens the detail dialog (`detail.js`, props `{view: "detail", session,
  kind, id, …}`, opened with `openOverlay`; `mod.json` still declares one overlay): centered, 0.6 ×
  0.75 of the window, the window dimmed, two scrolling columns from 760 px (the item; the message with
  the passage marked and scrolled into view). Every reading text is a selectable, scrollable markdown
  view, the person's and pinned text escaped so it shows as stored, with Copy beside it. It holds
  every action the expanded row had: answering, Defer, Branch… and its manifest, Conclude… and Paste
  into trunk, a pin's Ask here…, Note, Archive, Delete. One at a time: a second open replaces the
  first; a sub-row retargets it in place. Esc or a click outside closes it, and nothing typed is
  lost (drafts flushed, the Conclude text kept in `localStorage` `detail.conclude`).
- The dialog is its own copy of the mod. `reader.js` `Reader` is the panel's reading and acting half
  moved out (store.json reading, acts, drafts, `flushPending`, staging, Herdr lookups), extended by
  `Panel` and by `Detail`, which reads store.json and the turn files itself and never pings or claims
  the writer. It writes `shared("ledgr.detail")` on open and close, so the panel draws the open row
  raised, restores its cursor, shows the dialog's last words and takes the keyboard back (30 ms, again
  at 300 ms). The renderers moved to `views.js`, the pure parts to `listing.js` and `detailing.js`;
  `panel.js` went from 2,454 to 1,592 lines. No engine file, store, spool event or key changed.
- One staging door: nav.js `stageIntoPrompt` is called only by nav.js `stageMessage` (one paste at a
  time, the words of what happened), which only `Reader.stage` calls; neither `panel.js` nor
  `detail.js` defines `stage`, and copy methods never stage. The dialog stays open until the paste is
  decided, then closes and leaves the keyboard in the pane; acts that close it (Done, Not needed,
  Defer, Archive, Delete) write their spool event first. `test_no_keystrokes.py` enforces 11 rules
  and prints every failure.
- Probe P1 first, on a throwaway scratch mod and cat-like panes: a dialog survives `pane.focus`,
  `terminal.paste` lands while it is open (1 ms, no CR or LF), `closeOverlay` from the dialog's own
  task works, closing cancels the dialog's pending tasks once `close()` resolves (work after a close
  lives only while `close()` awaits, at most 250 ms; `main.js` now awaits `release`), and the keyboard
  goes to the focused terminal after a close.
- Tests: list 242 and detail 609 (new `test_list.mjs`, `test_detail.mjs`, run by the new
  `test-detail.sh` in `run-all.sh`), nav 364 plus compose 221, no keystrokes 541, store 881, hooks
  191, mcp 96, installer 69. `herdr-app check` passes. The live check (`Detail.md` 6.5, the parts
  that need real keys, panes and selection) is not done.
- `preview.png`, the recipe's look at the panel and `docs/preview-recipe.md` (its `expand-all` step,
  which now only says where rows open) show the expanded rows; a retake is pending.
- Asks of the user only. Jesse's panel showed Ask 50 (provide, blocking, found by the extractor)
  built from "I need only the agent's fix report now, and nothing else can be requested until it
  lands": an orchestrator waiting on its own subagent. "The agent didn't need something _from me_ it
  was just stating that it was waiting on something." Both instruction wordings
  (`asks-instruction-ledgr.txt`, `-both.txt`), the MCP server's `instructions` and the `declare_asks`
  description now say to declare only what the user personally must do, decide, provide or review:
  a wait on the agent's own subagents, tools, builds, tests or processes is not an ask, even when it
  writes "I need". `extract-system.txt` gives the fallback model the same rule, with that sentence as
  the worked example (no ask) against "I need the domain name from you before I can configure DNS"
  (provide, blocking); the JSON schema is unchanged. New fixture `subagentwait` (an orchestrator's
  reply waiting on a fix agent's report, paraphrased, "I need" in it): offline PASS; live, one call,
  zero asks (2,500 in, 9 out, $0.00025). Hooks 192, mcp 98. After an install, a running session gets
  the wording at its next SessionStart (resume, clear, compact) and the server's text after `/mcp`.
- Settings dialog. Jesse, after "this is REALLY good. Where is the 'settings' for this? for example
  font size, threshold": "build the settings dialog with text scale". `settings.js` (`class Settings
  extends Reader`, props `{view: "settings", opener, demo}`, `kind: "dialog"`, 0.5 × 0.7) opens from a
  gear at the right of the panel's header, `ledgr.settings` (the host opens it when no panel is shown)
  and `ledgr.demo-settings`. Rows, each with its value, a control and one line (`words.js`
  `SETTING_WORDS`): Text scale (− 120 % + and 100 %), Threshold (the lane head's three words), Who owns
  the closing list (ledgr / both / prose, writing `instruct_block` as the installer does; running
  sessions follow at their next prompt), Paste into the prompt, Animations, Fold asks while the agent
  works, Open the panel on new asks (on / off), Branch depth (0 to 4), and Off spaces (on / off per
  space Herdr has, by name; an off id Herdr no longer has, by id, with Drop); the footer names
  `config.json` for everything else. Every click writes at once through `Reader.saveConfig`, now the
  one writer of `config.json` (`reader.js` `editConfig`, moved from the panel's `saveConfig`, which
  the lane head's threshold menu and the space switch now share): changes queue so quick clicks never
  collide, and a write that finds the file changed under it writes nothing, reads it again and says
  so. One dialog at a time: it writes `shared("ledgr.detail")` like the detail dialog (kind
  "settings", no id), so whichever is open closes before the other opens, and its closed record puts
  its last words in the panel's status line. It stages, copies, runs and opens nothing
  (`test_no_keystrokes.py` rule 12).
- `ui.textScale` (default 1, 0.8 to 1.6 in steps of 0.05; `config.js`, `ledgr_config.py`): every
  copy draws with `withScale(theme(), textScaleOf(cfg))`, whose `t.ts(n)` is n times the scale to a
  half pixel. All 176 `text_size(` calls go through it (panel 68, views 43, detail 29, capture 21,
  settings 13, host 2), and so do the heights of the rows and buttons that hold a line of text, the
  row glyph column and the checkboxes; icons keep their size. The writer publishes the scale as
  `shared("ledgr.ui").textScale` for the host button, the pane chip (ledgr-pane scales its chip only;
  the header's own text stays Herdr's) and the ⌘J box; the host's and the chip's heights stop at 26 px
  to stay inside their bars. A change shows at the next render of every copy.
- Tests: settings 711 (new `test_settings.mjs`, run by `test-detail.sh`: the clamp and step, half
  pixels, rows and edits, `editConfig` with a stale file, every control through its click, the demo,
  the panel's gear and one dialog at a time, the panel, detail and settings dialogs drawn at 100 and
  160 % with every size scaled, and a static scan that every `text_size(` goes through `t.ts(` with `t`
  in scope), no keystrokes 492 (rule 12). `herdr-app check` passes for ledgr and ledgr-pane; in
  scratch copies it also rendered the settings dialog (80, 100 and 160 %), the demo panel (100 and
  160 %), the detail dialog (160 %), the demo host and the box (both at 100 %: they take the scale
  from the writer's `shared("ledgr.ui")`, which a check has not). Not tried live.
- Links. Jesse: "the big modal is working GREAT! any chance it could resolve relative links or
  weblinks?" In the dialog's message (the whole turn, every block) and an ask's text and quote, a web
  link opens in the browser (`on_link_click` in `views.js` `readable`, `cx.open_url`: http and https
  only), and a file path becomes a link: `links.js` `findPaths` / `linkify` (pure) rewrite
  `src/app.js:12`, `./x`, `~/x`, `/abs/x`, `docs/a.md`, `#L12` and a code span that is exactly a path
  to `https://ledgr.invalid/path/<the path, encoded>[?line=N&col=M]` (never fetched: the handler
  takes the click), and leave fences, indented code, existing links and URLs alone; the false
  positives kept out are listed in its header (and/or, 1.5, e.g., Node.js, /btw, github.com/a/b, …).
  A click (`detail.js` `openLink`) looks for the path as given when absolute or under ~, else in the
  record's folder (the session's `cwd`; a pin's `source.cwd`; a branch's own session), then in its
  git toplevel, and opens the first that exists with `links.editor` (new, default `"open"`; also
  `"zed"`, `"code"` at the line, or a command of your own with `{path}`, `{line}`, `{col}`; a row in
  the settings dialog, "Open files with"; `config.js`, `ledgr_config.py`). The `open` preset never
  launches: an app, package, disk image or jar is revealed, a script or a file with no extension opens
  as text (`open -t`). Found nowhere, the status line names the places it looked; found, it offers
  Reveal in Finder (`open -R`) and Copy path. `opener.js` holds the mod's reading copies' only process
  calls (`openPath`, `revealPath`, and `gitToplevel`, which the Branch confirmation's worktree check
  now uses too), each with a 5 s limit; a custom command naming a shell, an interpreter, a terminal or
  the file itself is refused. This carves one exception into "no other applications": a link or path
  the person clicks in the dialog opens in the browser or the chosen editor, never on ledgr's own
  initiative. Pins, questions, answers and conclusions render verbatim (escaped), so they stay
  unlinked this round.
- Tests: links 436 (new `test_links.mjs`, run by `test-detail.sh`: the path corpus and its false
  positives, `linkify` round trips, `parseLink`, `resolvePath`, `openerArgv` per preset and custom,
  `opener.js` through a recording `exec`), detail 609 (the handler: a web link, a path from the
  folder and from the git toplevel with `open` and `zed`, a path found nowhere, Reveal, Copy path, the
  demo running nothing), settings 643 (the new row), no keystrokes 538 (rule 13: `exec(` only in
  `opener.js` among the reading copies, in three argv shapes; `detail.js` reaches it only through
  `openPath`, `revealPath`, `gitToplevel`). `run-all.sh`, `herdr-app check` and the installer's test
  pass. Not tried live: whether Herdr's markdown autolinks a bare URL, how a relative markdown link
  reaches `on_link_click`, whether a click in a selectable view fires it, `zed` and `code` on the
  login shell's PATH, and Herdr's `fs.stat` / `fs.exists` on paths outside home.
- An independent review of the settings, scale and links found two medium and six low issues, all
  fixed: the installer no longer reverts what the settings dialog or the threshold menu wrote (it
  keeps a value config.json changed since the last install and says so); the ⌘J box caps its scale
  at 125 % and scrolls its middle; the `open` preset judges by where a path really leads and opens
  byte-code and scripts as text; the custom editor command is checked in every argument, with
  shell-style quoting in the field; fast stepper clicks are not lost; `linkify` strips trailing `_`
  and `-`, needs a known root for bare absolute paths, is linear and cached; the overlay's tab bar
  gets `my-tabs.ledgr-settings` for a hidden panel. Setup 82 checks.

### 4433d65: pins

- A pin is a passage kept verbatim from an agent's reply before any question exists (Jesse: pins
  "should actually live"; Claude Code deletes transcripts after about a month). Pins live in their
  own `pins` map in `store.json`, beside `items`, so chips, counts, the snapshot (extractor and MCP
  server), refs, the daily archive and Forget never touch one. Each keeps its text (line breaks
  kept, at most 4,000 characters, `clipped` beyond), a one-line note, an anchor (turn and passage
  hash, uuid when known, never a position) and its session's `source`, so it outlives Forget and the
  transcript. Handles `P1`, `P2`… per session ("Pin 4"). Archived only by the person, deleted only
  once archived (two clicks). Spec: `docs/design/Pins.md`; notes:
  `docs/build-notes/BUILD-NOTES-pins.md`.
- Taking one: select the passage, ⌘J, then ⌘S in the box (`mod:ledgr` `"cmd-s": "ledgr.pin"`, in
  `keys.json` and the installer's `MOD_KEYS`); the box's line becomes the note. The passage is looked
  for in the session's saved turns (that turn is the anchor), else on its screen (`hc read`, read
  only); found nowhere, a second ⌘S within 5 s pins it "unverified". The same passage again in the
  same session makes no second pin. A screen pin taken mid-turn settles at Stop and the writer
  re-anchors it to the saved turn that holds it. A clipboard over 600 characters can now be pinned,
  never attached as a question's quote.
- The PINS lane, above YOUR QUESTIONS: the shown session's pins, newest first, five then "N more",
  "archived (N)" with Restore and Delete; per pin Ask here…, Branch…, Note, Copy, and in ⋯ Go to
  anchor and Archive; a usage line ("answered in Question 3 (turn 14)"). One search box over every
  session's pins, in memory: literal terms and "quoted phrases" over text, note, session name, repo
  and folder, newest first, grouped by session, "archived too" and "this session only" toggles, a
  forgotten session still named. Checkboxes gather up to 12 pins from any session; "Ask about these…"
  opens the box in pins mode, where the typed question is parked with `request.pins`.
- Ask here: a question with pins pastes one message into its trunk's prompt (never sent): the marker
  `ledgr pins <session> <item>`, the question, each pin quoted line by line with `> ` and where it
  came from (another session's pin says "you did not write this in this conversation"), and a
  closing line in the person's voice. The UserPromptSubmit hook emits `pins_asked`; the question
  shows "sent at turn N", is answered at that turn's Stop, and each pin records `answeredIn`. Quoted
  lines land nothing and are left out of the prompt's `[A3]` / `[Q3]` refs (`ledgr_map.prompt_refs`).
- Ask in a branch: the preamble carries the pins verbatim with provenance and asks for one `pin i:`
  line per pin in the conclusion; the manifest's Given row says "2 pins, verbatim in the preamble";
  over 24,000 pinned characters the branch is refused. Conclude without a block prefills one entry
  per pin, the confluence names the pins, and a landed confluence records `answeredIn` via the
  branch. No new `config.json` key: five `LIMITS` in `config.js`. No MCP `pins` tool this round.
- The header's session pin is now "hold" / "held" (text only), so "pin" means one thing; the
  `localStorage` key stays "pinned". The demo gains three pins and Q9, asked with two of them.
- An independent review found two medium seams and five low ones, all fixed: pin ids are checked
  against the store's own keys (a `__proto__` id used to reach `Object.prototype`); the box in pins
  mode never falls back to another session (an ended session parks from its store record, trunk
  refused, branch allowed); a `then` carries the box's own time; a branch keeps its pin ids so the
  numbers match the confluence ("pin 2: (deleted)"); Ask here and Copy for prompt share the
  branch's size cap and the landing parser scans 64,000 characters; search caches folded text;
  settled pins get the turn's uuid; a question with pins has no `/btw` and its Copy carries the pins.
- The box key was ⌘P (`cmd-p`) as built. In his live check the same day the maintainer found it in
  conflict with Herdr's own global ⌘P (`mod.open:picker`), so it switched to the planned fallback
  ⌘S (`cmd-s`, bound in no shipped Herdr section, global or terminal; ⌘⇧P is Herdr's palette) in
  `pinning.js` `PIN_KEY`, `keys.json`, `MOD_KEYS`, `words.js` `PINS_EMPTY` and the docs. The same
  check found the ⌘J box cramped: it is now 600 × 320 (was 236; the panel's Ask about this the same,
  pins mode 340, was 300), with more padding (20 by 18, was 16), a 10 px gap (was 8) and three lines
  of the clipboard quote (was two). Behaviour unchanged.
- Tests: store 881 checks (307 pins), hooks 191, no keystrokes 347, nav 269 plus compose 221 (new
  `test_compose.mjs`, run by `test-nav.sh`), mcp 96, installer 69. `herdr-app check` passes. Of the manual
  live check (spec 8.4), step 3 settled the key (above); the other steps are not recorded yet.

### 904cba0: no names in the repo

- The example of a second Claude config folder is neutral everywhere: `~/.claude-work`, profile
  `claude · work` (docs, comments, tests; two tests that compare two folders use `.claude-alt` for
  the other). Nothing in the code ever depended on the literal name: the profile label is derived
  from the folder name.
- The maintainer's real install answers moved to a gitignored `examples/personal-overlay/
  answers.local.json` (`*.local.json` is ignored); the shipped `answers.json` names only
  `~/.claude/settings.json`. CLAUDE.md, the overlay README and the RECIPE point at the local file.

### 69d4c3e: ready for the public repo

- `preview.png` retaken on the tool path from a throwaway `claude --model haiku` session in a neutral
  folder: the reply ends with the pointer line and no block, the panel shows the three asks
  "declared by the agent (tool)", the chip reads `2 blocking`. `docs/preview-recipe.md` describes
  that state as the current one and keeps the block path for a machine without the server. Found on
  the way: the pointer line `declare_asks` returns counts only items at or above `extract.threshold`
  (with `blocking`, "2 items for you" for three declared); the frame's "3 items" line is the model's
  own wording.
- Personal paths are gone from the design doc, the research report and the primitives note (`~`
  paths and neutral example folders; `file://` links became code paths), and from the build notes;
  the one employer and project name left in notes and a test fixture are neutral now. The exported
  conversation stays gitignored.
- The two config keys nothing read, `btw.autoSend` and `nav.autoSearch`, are removed from the
  defaults, the README table and the design doc (Section 5.5, 6.6, Q5, Appendix B).
- README: the clone line; the public repository is `github.com/jessebacon/herdr-ledgr` (topic
  `herdr-mod`).

### e9bc29a: off per space, Clear all questions, room between pastes

- Off per space (Jesse: "enable/disable per space"; he chose the full version). `config.json`
  `spaces.disabled` lists Herdr space ids (default `[]`; names change, ids do not; defaults in
  `config.js` and `ledgr_config.py`). The session menu's first row, "ledgr off in this space" or
  "ledgr on in this space" beside the space's name, writes it with the threshold menu's
  compare-and-swap (`panel.js` `saveConfig`, now shared). Where the focused pane's space is off the
  panel shows an `off` pill and "ledgr is off in this space" with a button to turn it on, instead of
  the lanes; a session pinned or picked in another space still shows, and the session list marks
  sessions in an off space "off". Items are kept, only hidden. The writer draws no chip for a
  terminal in an off space (its space as the hooks recorded it, else live from `agents()` or the
  terminal's `herdr.space` label), publishes the list as `shared("ledgr.ui").off`, does not open
  the panel on asks from such a session (`offEvent`), and takes a terminal's new space from its
  rewritten identity-map record. ⌘J over an off pane says "ledgr is off in this space" and parks
  nothing; sessions in off spaces are not offered as targets. Commands `ledgr.space:<off|on|toggle>`.
- The hooks in an off space behave as if ledgr were not installed. `ledgr_map.herdr_space()` runs
  one `hc get $HC_TERMINAL_ID --json` (`posix_spawn`, 300 ms limit) at SessionStart and each prompt
  and records `space` on the session record and the map; no space (no terminal id, no `hc`, no
  label) counts as on, and a failed lookup (timeout, bad exit, bad JSON) keeps the recorded value.
  Off: no spool event at all, no instruction, no landing; Stop part A only marks the session idle and
  exits 10, so no `pending`, extraction, settlement or reinject (one `hook.log` line per off
  period). A running session is told once, at a real prompt: on to off prints the new
  `lib/asks-instruction-space-off.txt` (to a session that had a wording), off to on the mode's
  wording; a SessionStart while off prints nothing, except the off text at a resume or compact of a
  session that had a wording. The record keeps `ledgr_off`. Medians: SessionStart 43-45 to 51-52 ms,
  UserPromptSubmit 42-45 to 52-54 ms, Stop unchanged.
- The MCP server, for a calling session in an off space: `declare_asks` and `resolve_asks` write
  nothing and answer `off: true` with a note to list needs in prose; `open_asks` and
  `parked_questions` answer empty with `off: true`. Known limits: a branch launched into an off space
  records its lineage but sends no `branch_started`; the capture box over an off pane stays until
  dismissed (Esc, Enter or a click).
- Clear all questions (Jesse; scope as he chose: "shown session, skip branched and rejoining
  questions"). The YOUR QUESTIONS head shows "Clear N" while the shown session has open or deferred
  parked questions; a first click arms it for 4 s ("Clear N questions? M branched kept"), a second
  posts one `clear_questions {session_id, keep: ["branched", "rejoin_pending"]}` event ("Clearing
  N…" until the store has it). The writer dismisses each open or deferred parked question with no
  branch (a refused or failed launch counts as none), with `dismissedBy: "clear"` and `clearedAt`;
  branched and `rejoin_pending` ones always stay. Closed rows read "cleared", Reopen works per item
  (`setStatus` drops both marks), and the archive treats them as dismissed. Status line "N questions
  cleared, M branched kept"; command `ledgr.clear-questions`.
- A blank line after every staged message (Jesse: "when pasting an answer, you should add an empty
  line. When I'm trying to paste multiple answers, they run together"). `nav.js` `promptText` ends
  the text `stageIntoPrompt` handles (one answer, the answer sheet, the confluence) with exactly one
  empty line, pasted or not, and demo copies the same; the marker line stays first and the stored
  conclude message is unchanged. The clipboard check before the paste ignores trailing line breaks.
- Landing fix, found in Jesse's own prompt of the day: two answer sheets in one prompt were misread.
  Wrapped, only the first landed; unwrapped, A11's answer swallowed the second marker line and A12's
  took the sentence he typed below the sheets. `ledgr_landing.detect_all()` ends a sheet at a paste
  wrapper line, the next marker, or a blank line not followed by an `A<n>:` line, and follows one
  message to the next; the hook sends one landing event per message, 1 ms apart. `detect()` still
  returns the first.
- Tests: store 574 checks (spaces off and Clear all), nav 256 (`promptText`), no keystrokes 313,
  hooks 169 (a fake `hc` through `LEDGR_HC`; 30 disabled-space checks; two sheets wrapped, two
  unwrapped with a blank line, a trailing blank line, a one-line lead-in, prose between sheets, a
  confluence then a sheet), mcp 76 plus the off checks. `herdr-app check` passes.

### bba05b1: blocking survives working, the agent closes answered asks, paste into the prompt

- The pane chip keeps its `blocking` state while the agent works: an open blocking ask at or above
  `extract.threshold` no longer yields to `working` on every prompt and through every permission
  wait. A working chip stays in `blocked` beside Herdr's own spinner and does not pulse; it pulses
  once the turn ends still blocking. The chip record gains `w: 1` for a working session, the tooltip
  adds "agent working", and `ledgr-pane.demo-chip:blocking-working` draws the look. (The host
  button's `◆` count reads `b`, which was never muted, and is unchanged.)
- ASKED OF YOU: a turn group holding an open blocking ask stays unfolded with its `◆` rows, as the
  newest group does; the person's own click still wins (`groupOpen()` in `store.js`), and a folded
  group that still holds a blocker shows "◆ N blocking" in `blocked`.
- `resolve_asks`, a fourth MCP tool, loaded upfront like `declare_asks`: `{handles: ["A4", …],
  note?}` maps handles to this session's agent asks through `snapshot.json`, as `open_asks` does, and
  drops one `act` spool event per ask still open, deferred or answered (`action: "resolve"`,
  `actor: "agent"`, `handle`, `turn`, `note`; built by `ledgr_spool.act()`); it returns `resolved`,
  `unknown` and `already_closed`. The writer's `on_act` takes only `resolve` from the agent and sets
  `resolvedBy: "agent"` and `resolvedNote`; the Closed list reads "closed by the agent at turn N ·
  note". Done stays the person's override and Reopen still works. Both instruction wordings and the
  server's `instructions` gain one sentence: when the user's message answers or drops an open ask,
  call `resolve_asks` with its handles before declaring anything new.
- Answered, then settled: an ask marked answered (an `[A3]` ref in a prompt, which now records
  `answeredTurn`, or the answer sheet) becomes `resolved` with `resolvedBy: "answer"` ("answered by
  you at turn N") when the writer applies that turn's `asks` event, after the re-raise rules; a reply
  that raised it again reopens it in place, as before. `skip` settles too; `pending`, a mid-turn tool
  call and `error` do not. Parked questions are untouched. `setStatus` clears `resolvedBy` and
  `resolvedNote` on every status change, so a reopened item no longer keeps "resolved by its branch".
- Installer: `MCP_TOOLS` gains `mcp__ledgr__resolve_asks`, appended last so an earlier install's
  settings file gains it in place (install, `--check` and uninstall follow). `--check` counts a
  settings file whose server is registered but lacks an allow entry as a problem, whatever the
  answers say, with the remedy "run ./install.sh again with --mcp on". Running sessions see the new
  tool after `/mcp` reconnects the server, or a restart; the new instruction sentence reaches a
  session at its next SessionStart.
- Paste into the prompt (Jesse, 2026-11-06: "yes, build it: focus the pane, confirm focus, paste, no
  Enter, lead-in kept"). The answer sheet, one answer and the confluence are now pasted into the
  target's prompt instead of left on the clipboard. `nav.js` `stageIntoPrompt` writes the clipboard,
  runs `pane.focus`, then looks at Herdr's `focused()` every 50 ms for up to 600 ms and runs
  `terminal.paste` (the command behind ⌘V; no arguments) once the target terminal has had the focus,
  with no other terminal shown in its pane, on two looks in a row (100 ms at the earliest) and the
  clipboard still holds the same text. It pastes nothing into a terminal that is not live, runs no
  agent (a shell could run a pasted line) or whose agent waits on its own prompt (`blocked`, a
  permission menu), nor when the focus is not confirmed in time; the text then stays on the
  clipboard. Enter is never sent, and `hc keys`, `hc send` and `terminal.search` stay banned. The
  panel's `stage()` is the only caller and ignores a second click while a paste is pending.
- Words and the switch: the buttons read "Paste 2 answers into pane t3", "Paste answer", "Paste into
  trunk" and "Paste confluence again" (`words.js` `stageLabels`), and the status line says what
  happened (`stagedWords`): "Answer for Ask 2 pasted into the prompt in pane t3, not sent: add a word
  of your own, such as “My answer to A2:”, then press Enter.", with its own wording for each case
  that pasted nothing (not live, no agent, waiting on its own prompt, focus not confirmed, clipboard
  changed, an error). The lead-in stays (Claude Code presents a paste as possibly not the person's
  words), and the person sends the prompt. `ui.pasteIntoPrompt` (`config.js`, `ledgr_config.py`;
  default `true`, no installer question) set to `false` brings back clipboard plus focus and the old
  labels ("Copy answers", "Copy answer", "Send to trunk", "Copy confluence again"). Go to anchor,
  Copy for prompt, `/btw` and Ask for a conclusion stay clipboard plus focus.
- Paste tests and the live probe: `test_nav.mjs` 233 checks (the focus confirmed at once, late,
  flickering or never; another terminal shown in the pane; the clipboard changed; a look that throws;
  every case that pastes nothing; over every call, no `hc`, no Enter or line break in any argument,
  `terminal.paste` only without arguments); `test_no_keystrokes.py` 313 (`terminal.paste` only in
  `stageIntoPrompt`, after its focus check, reached only from the panel's `stage`;
  `terminal.paste_image` banned); `test_store.mjs` the default and the words. `herdr-app check`
  passes. Live, on throwaway panes: `pane.focus` returned in 15 ms, the focus was confirmed at 24 ms,
  `terminal.paste` succeeded and `hc read` showed the probe once, not submitted; a raw-byte probe
  received exactly `ESC[200~ … \n … ESC[201~`, so a line break stays inside the bracketed paste. A
  paste joins a draft already in the prompt (known and accepted: the person still presses Enter).
- Tests: store 478 checks (69 new: blocking while working, the fold rule, closed by the agent,
  answered then settled; 20 for the paste default and words), nav 233, no keystrokes 313, mcp 76,
  hooks 127, installer 69.

### ccdaa4f: who owns the closing list, declare by tool, honest profiles

- `asks.handoff` (`ledgr` default, `both`, `prose`; installer: "Who owns the closing list the agent
  gives you?", `--asks-handoff`, answers key `asks_handoff`): in `ledgr` mode the agent keeps blocking
  and needed items out of its prose and ends with one line, `ledgr: N items for you, M blocking`;
  `prose` injects nothing; a change reaches running sessions at their next prompt. `instruct_block`
  stays the master switch.
- The block has a readable bullet form (`- blocking · decide · text · "quote" · options: a | b`); the
  JSON array still parses, a block mixing both is rejected, malformed bullets are dropped with reasons.
  `bin/lib/parse_block.py` also reads the block written as a `<ledgr-asks>` line closed by a
  `</ledgr-asks>` line (seen live from Haiku). The extractor's `asks` event carries `block_form`
  (bullets, json or mixed) and `pointer` (the reply's `ledgr: N items for you` line).
- An MCP server (`mods/ledgr/bin/mcp/`, `declare_asks`, `open_asks`, `parked_questions`) lets an agent
  declare without printing a block; the writer labels such asks "declared by the agent (tool)" and
  the Stop hook settles them (quotes checked against the whole turn, message uuid). The installer
  offers to register it (`claude mcp add --scope user`) with three allow entries; `--check` and
  `uninstall.sh` follow, and both answers files (`setup/answers.example.json`,
  `examples/personal-overlay/answers.json`) set `mcp: true`. `--check` also tallies how the last
  turns' asks arrived (block, tool, model, skipped, failed) from `ledgr-data/log/hook.log`.
- Sessions name their Claude profile: `claude · work` for a Claude Code started with
  `CLAUDE_CONFIG_DIR=~/.claude-work`, `claude` for `~/.claude`, in the header, the session menu, the
  capture box and the branch manifest; Branch and Resume use the recorded config folder.
- The session menu says how each agent's asks arrive from the effective `asks.handoff`, and the asks
  lane head's "agent working" tooltip names the mode. The chip's tooltip says when its asks were
  declared by tool.
- The offline suite (`bin/tests/run-all.sh`) runs the MCP server's test (`test_mcp.py`); the installer
  test covers the handoff question and the MCP step (with a fake `claude`).
- `preview.png` retaken in authoritative mode from a real throwaway session (`docs/preview-recipe.md`
  rewritten). The exported design conversation stays local and gitignored (`docs/history/`, not in the
  repo). Docs audited against the code and the live install (README status, MCP section and full
  configuration table; RECIPE disclosure; the design spec's Section 11). The earlier sections of this
  file are headed by their commit hash, and 4f76521 got its section after the fact.

### 8d8a7e5: asks declared first, adapter contract, multi-config installer

- The agent-declared `ledgr-asks` block is the primary channel, the model extractor the fallback.
  `instruct_block` defaults on with a new, shorter instruction (blocking and needed items only, never
  suggestions or offers); a blocking ask the extractor found in a reply without a block puts the
  instruction into that session's next prompt once (`instruct_reinject`, default on).
- `mods/ledgr/bin/adapters/README.md` defines the adapter contract (identity, turn signal, instruction
  injection, turn text, optional fork and resume); `adapters/claude/adapter.json` is its manifest, and
  the session menu groups sessions by agent with "declares asks", "extractor only" or "no asks".
- The panel follows the focused pane across spaces and says "no ledgr session yet" for an agent pane
  the hooks have not reported, instead of keeping another session; pinning shows as a "pinned" pill.
- The owner's overlay uses the public `ledgr-pane`; `my-pane` is gone. `install.sh` retires a mod an
  earlier install deployed that the answers no longer want, and every JSON file it writes ends with a
  newline (a missing one in its own earlier write of `~/.claude/settings.json` is restored).
- `install.sh` hooks more than one Claude config: `~/.claude/settings.json` plus each other config
  folder it finds (`~/.claude-*`, `CLAUDE_CONFIG_DIR=` in `~/.local/bin` wrappers and shell start-up
  files) or is given (`--claude-settings` repeats; `claude_settings` in an answers file is a list),
  asked and consented per file; `--check` and `uninstall.sh` cover every file. Branch and Resume keep
  a session's `CLAUDE_CONFIG_DIR`; the session-name fallback reads that folder.
- The installer's offline test (`setup/tests/test_ledgr_setup.py`, scratch folders only). A first
  `preview.png` candidate (demo mode) and `docs/preview-recipe.md`.

### 4f76521: never send keystrokes

- Go to anchor no longer presses `ctrl+o /` in a Claude pane (`hc keys`): `ctrl+o` toggles Claude
  Code's transcript viewer, so the same keys could leave a pane in transcript mode. Every keystroke
  path (`hc keys`, `terminal.search`) is removed. Go to anchor opens the row's whole message with the
  passage marked, focuses the pane, copies a search slice, and says how to search by hand.
- Tests: `test_no_keystrokes.py` (no keystroke call anywhere in the mod source) and `test_nav.mjs`
  (copy and go-to produce only a clipboard write and `pane.focus`), both in `run-all.sh`. Disclosure
  updated.

### e14a347: packaging

- The `ledgr` mod installs on its own. A host view inside the mod (props `{view: "host"}`, a 96 px
  ledgr button beside the status bar, the tab bar, or floating) runs the writer, so no personal tab
  bar is needed and no engine copy either; `ledgr.toggle` shows and hides the panel. Writers elect
  one holder among hosts, take the role back from a panel fallback or a holder that stopped
  answering, and release it on close. `herdr-app check` no longer claims or pings.
- The pane-header chip moved to an optional mod, `ledgr-pane` (a clone of Herdr's `pane` 0.1.13).
- The owner's tab bar (`my-tabs`) and pane header (`my-pane`) moved to `examples/personal-overlay/`
  as an example integration; the installer deploys an overlay as one answer to the host and chip
  questions.
- Where the panel lives is configurable (`config.json` `ui.panel`), published to the chip and host.
- `install.sh` rewritten: preflight, questions with reasons and current values as defaults, `--yes`
  with an answers file, a flag per question, Keychain storage of the key through stdin, key-clash
  detection, layout patching that never edits a shipped layout (clone first), hook entries printed
  before they are written, `herdr-app check` and offline tests, a summary. `--check` is a doctor.
  `uninstall.sh` saves the current answers, restores the pre-ledgr files where only ledgr's entries
  differ, removes only ledgr's entries otherwise, keeps `ledgr-data/` unless asked, never touches the
  Keychain item.
- Hooks and tests find python3 (Homebrew, `/usr/local`, system, or `LEDGR_PYTHON`; 3.9+) and the data
  folder beside the mods folder they are installed in, instead of fixed paths.
- `RECIPE.md` moved to the repo root in the manual's six-part order with a disclosure; README,
  LICENSE (MIT), this changelog, `keys.json` at the root, layout snippets in `setup/`; build notes
  moved to `docs/build-notes/`; demo and test fixtures made generic.

### 1f86586: ask severity and threshold, user-owned fold, animations, polish

- Every ask has one level (blocking, needed, optional) with a decision order and a politeness rule in
  the extraction prompt; status lines are never asks. A threshold menu on the lane head writes
  `extract.threshold`; asks below it fold and do not count; blocking asks sort first and give the
  chip its own state.
- The asks lane's fold is the person's alone (`ui.foldAsksWhileWorking` restores the old rule).
- Motion only on state changes (row enter and leave, answered glow, chip pulse); `ui.animations`.
- Names in words (Ask 9, Question 1, pane t3), Resume session when a terminal is gone, the whole
  message at full height, a smaller action row (Done, Defer menu, overflow menu); new extraction
  fixtures for mixed levels, polite blockers, closers, verification and pure status.

### e7c177d: panel layout fixes; per-item Copy answer

- Ask text no longer cut at a 34 px cap; meta on its own line, text and options wrap at full width;
  one indent constant and looser spacing; preview boxes scroll.
- Demo cases for a 600-character ask, a 120-character token, a long URL and a long option.
- Copy answer per ask, with the same marker and landing detection as Copy answers.

### 1849c0f: research, design, and phases 1 to 3

- Phase 1: identity map through Claude Code hooks, ⌘J park, the two-lane panel, the pane-header chip,
  Haiku extraction of the agent's asks at Stop.
- Phase 2: Branch a parked question into a forked session with lineage, a context manifest, a depth
  cap, and placement beside the trunk.
- Phase 3: the Conclude editor, the clipboard-staged confluence detected by the UserPromptSubmit hook,
  `decisions.md`, Close branch, the answer sheet.
- The deep-research report and notes, the build spec with its deviations log, an outside critique.
