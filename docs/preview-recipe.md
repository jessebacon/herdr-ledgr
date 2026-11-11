# Staging preview.png and docs/preview-dialog.png

Two frames of one state. `preview.png` is a real Claude Code pane beside the ledgr panel as a scan
list (one line per item); `docs/preview-dialog.png` is the same state with the detail dialog open on
Ask 2. Both are in authoritative mode (`asks.handoff: ledgr`, the default) on the tool path: the MCP
server is registered, so the agent declares its asks with `declare_asks` and its reply ends with the
pointer line only, no fenced block. Every step is a Herdr command, so the state can be rebuilt and
retaken with any screenshot tool. The session is a throwaway in a scratch folder; its pin is
archived and deleted and the session forgotten afterwards through the panel's own spool events.
(History: until 2026-11-06 the shot was the demo mode's fixtures; on 2026-11-06 the block path; on
2026-11-07 the tool path with expanded rows; on 2026-11-10 the list and the dialog.)

## The state

- The pane: the prompt, a plan in prose that keeps no list for you, Claude Code's folded tool call
  (`Called ledgr`), then the pointer line `ledgr: 3 items for you, 2 blocking` and "done". No
  `ledgr-asks` block. The pane header chip (`ledgr-pane`) reads `2 blocking`.
- The panel follows that pane, text scale 100 %, every lane head showing (chevron, name, count), the
  gear at the right of the header:
  - PINS: one row, `Pin 1`, a sentence of the plan pinned with ⌘J then ⌘S, its note set, its age
    (`1 min ago`) as the state word.
  - YOUR QUESTIONS: empty.
  - ASKED OF YOU (threshold `blocking only`, as the maintainer runs it), group `turn 1 · 2 asks`:
    Ask 1 (provide, `blocking`) as the cursor row, so it shows its state word `open` and Done; Ask 2
    (decide, `blocking`) with an option picked, so its Paste button stands in for the state word; the
    sheet line `Paste 1 answer into pane tNN` with "pasted into the prompt, never sent"; `below
    threshold (1)` open on Ask 3 (`needed`, `below threshold`, Promote).
  - No dialog, no capture box, no status line at the bottom.
- The dialog frame: the same, with the dialog open on Ask 2 and the window dimmed behind it. Header
  (◆ Ask 2, `blocking`, `decide · turn 1 · declared by the agent (tool)`, `answer ready`, the
  session, Esc); left: TEXT, QUOTE (each with Copy), OPTIONS (the picked one in accent), ANSWER (the
  field with the pick, Paste answer, the hint), the foot line; right: THE MESSAGE with around / whole
  / Copy; footer: Done, Defer ▾, ⋯ and the key hints.
- Nothing personal in the frame: the pane header and Claude Code's banner both print the folder, so
  use a neutral one (`/private/tmp/claude-501/tally` since 2026-11-07; the 2026-11-06 take showed a
  scratchpad path with a user and employer name in it). The session gets a neutral generated name
  (`tally-30` in the 2026-11-10 take).

Known in the 2026-11-10 take: THE MESSAGE shows only the pointer line, with no passage marked. The
saved turn text (`ledgr-data/turns/<sid>/<turn>.md`) is Stop's `last_assistant_message`, which on the
tool path is only the text after the tool call; the plan the quotes come from is in the message
before it. For the same reason the pin is verified from the screen (`hc read`), not the saved turn.
Resolved 2026-11-10 by the whole-turn fix (`BUILD-NOTES-hooks.md`, "Whole-turn text"): the turn file
holds every assistant text of the turn, so THE MESSAGE shows the whole reply with the paragraph that
holds the quote marked (a plan in one paragraph is marked whole), and the pin is verified from the
saved turn (`verified: "turn"`). `docs/preview-dialog.png` was retaken the same day from a fresh run
(`tally-05`; the plan's wording and the pin's sentence differ from `preview.png`'s `tally-30`, which
was kept). Of that day's four runs one saved only the pointer line, its quotes dropped: at Stop the
transcript did not hold the plan's text record yet. Resolved the same day: part A writes the whole turn
only once the transcript holds the final message, else the final message with `lagged: true`, and part
B re-reads on its uuid schedule (0, 1, 2, 4 s) and rewrites the turn file before `stop`; a turn that
never catches up checks quotes against the final message plus its partial text (`BUILD-NOTES-hooks.md`,
"The lag"). Retake when the dialog shows only the pointer line or a QUOTE is missing.

The pointer line the tool returns counts only items at or above `extract.threshold`, so with
`blocking` it reads `ledgr: 2 items for you, 2 blocking`; in the 2026-11-07 and 2026-11-10 takes
Haiku wrote `3 items` itself, counting the folded one. Either is the tool path; the panel and the
chip are the same.

## Before

- Herdr running with ledgr deployed (`./install.sh`), `asks.handoff` `ledgr` in
  `ledgr-data/config.json`, `ledgr-pane` as the layout's pane header, and ledgr's MCP server
  registered for the config folder the session runs from (`./install.sh --check` shows it connected,
  with the `mcp__ledgr__*` allow entries). The maintainer's two config folders have it since
  2026-11-06; the `claude` on his PATH uses `~/.claude`.
- A scratch folder with a neutral name that Claude Code already trusts. A new one stops at the trust
  prompt, whose default is "No, exit": in that throwaway pane only, `hc keys <terminal> down` then
  `hc keys <terminal> enter`. Herdr hands the task to `claude` as its argument, so the prompt is sent
  once the folder is trusted, and Claude Code records the trust itself.
- Note what to put back: the shown space, tab and focused pane (`herdr-app status`), the clipboard
  (`pbpaste > <scratch>/clip.txt`), `ui.textScale` in `ledgr-data/config.json`, and the window's
  size and position (`osascript -e 'tell application "System Events" to get {size, position} of
  window 1 of (first process whose name contains "erdr")'`).
- The frame size. The 2026-11-10 take is Herdr at zoom 1.1 (the maintainer's), the window set to
  1787 × 1344 (System Events, below), the panel column at the width the maintainer keeps (about 645
  px drawn): the pane and the panel then fill exactly 1475 × 1262 with an 8 px margin. Another zoom
  or panel width needs other numbers; find the pane's left border and the panel's right border in a
  first shot.

## Commands

```sh
d() { herdr-app do "$@" >/dev/null; }
APP=/private/tmp/claude-501/tally      # a trusted scratch folder with a neutral name
herdr-app do space.new "$(python3 -c 'import json,sys; print(json.dumps({"name": "ledgr preview", "folder": sys.argv[1],
  "argv": ["claude", "--model", "haiku"],
  "task": "Do not read or change any files: I want to ship the docs site for my tally CLI this week. Write a short plan in prose, 8 to 12 sentences, for building and deploying it from this folder. You cannot finish without two things from me: the domain name, and whether to host on Netlify or GitHub Pages. After it is live I also have to check the DNS records myself before the work is truly done. Declare all three with ledgr'"'"'s declare_asks tool, each with its quote."}))' "$APP")"
# note the returned "terminal" (t33 here); wait until `herdr-app ls` shows it done, and
# `grep <terminal> ~/.config/herdr-app/ledgr-data/log/hook.log` ends with "extract … source=tool asks=3"
osascript -e 'tell application "System Events" to tell (first process whose name contains "erdr") to set size of window 1 to {1787, 1344}'

# the pin: a sentence of the plan on the clipboard, the box over the pane, ⌘S, then its note
printf '%s' "Pick a static site generator that fits the content, such as MkDocs or Docusaurus, and pin its version so the build is reproducible." | pbcopy
d pane.focus '{"pane":"<the preview pane>"}'
d mod.open:ledgr                # ⌘J: the capture box
d ledgr.pin                     # ⌘S in the box: pins the copied passage; the box closes
d "ledgr.pin-note:P1:Pin the generator version before the first deploy"

# the look
d ledgr.settings; d ledgr.settings:scale:reset; d ledgr.settings:close   # text scale 100 % for the shot
d ledgr.below-threshold         # unfold Ask 3 (this session's fold only, in memory)
d ledgr.pick:A2:0               # Ask 2: pick Netlify, so its row shows Paste and the sheet line counts 1
d ledgr.open:A2; d ledgr.detail:close   # opening a dialog clears the panel's status line
d ledgr.focus-list; d ledgr.cursor:A1   # the cursor row: Ask 1 shows Done
# take preview.png now (below), then:
d ledgr.open:A2                 # the dialog frame; take docs/preview-dialog.png
```

Haiku's wording differs per run; retake if the reply lists the items in prose or ends with a block
(the server is not connected for that config folder), or if the log line is not `source=tool asks=3`.
The last sentence of the task is there for a reason: without it, the 2026-11-07 first try declared
the asks with no quotes, so the rows had none. "Without using any tools", the block path's wording,
would keep the agent off the tool.

The passage goes on the clipboard with `pbcopy`, not by selecting it in the pane: Herdr's
`terminal.copy` copies a selection only a mouse makes, and with nothing selected its key goes to
the program. The box checks the clipboard against the saved turn, else the screen (`hc read`), so
the pin is the same as one copied by hand. Nothing is typed into the pane.

### Without the MCP server (the block path)

On a machine where the server is not registered, the agent writes the block instead: the reply ends
with the pointer line and its bullet-form `ledgr-asks` block (two `blocking` lines, one `needed`),
and the panel labels the items "declared by the agent". Use the task without its last sentence,
starting "Without using any tools:" instead of "Do not read or change any files:", and look for
`source=block asks=3` in the log line (`source=model` means it fell back to the extractor).

## Take the shot

- Any tool: ⌘⇧4, then Space, then click the Herdr window, and crop to the pane plus the panel.
- Or Herdr's own frame, which needs the window to be repainting (an inactive window returns its last
  painted frame, so check that the text is current):

  ```sh
  herdr-app shot /tmp/ledgr-shot.png
  # pane + panel of the 1787 x 1344 window at zoom 1.1 (Herdr's sidebar, tab bar and status bar left out)
  sips --cropToHeightWidth 1262 1475 --cropOffset 48 311 /tmp/ledgr-shot.png --out preview.png
  # the same crop, with the dialog open, for docs/preview-dialog.png
  ```

  The sidebar left out of the crop lists the other spaces and their folders; check that none of it
  shows.

## Undo

```sh
d ledgr.detail:close
d ledgr.pin-archive:P1          # the dialog's Archive posts the same pin_archive
# Delete: the dialog's two clicks post pin_delete (no command reaches them); the same event by hand:
python3 -I -c 'import sys; sys.path[:0]=[sys.argv[1]]; import ledgr_spool as S; S.emit("pin_delete", None, sys.argv[2], {"pin": sys.argv[3]})' \
  ~/.config/herdr-app/mods/ledgr/bin/lib <session id> <pin id, pn_…>
# forget the throwaway session (and its items) through the panel's own spool event; pins outlive a
# Forget by design, which is why the pin goes first:
python3 -I -c 'import sys; sys.path[:0]=[sys.argv[1]]; import ledgr_spool as S; S.emit("forget", None, sys.argv[2], {})' \
  ~/.config/herdr-app/mods/ledgr/bin/lib <session id from the hook.log line>
hc kill <the preview terminal>; hc rm <the preview terminal>   # the space closes with its last terminal
d space.close '{"id":"<the preview space>","confirmed":true}'  # only if it is still there
osascript -e 'tell application "System Events" to tell (first process whose name contains "erdr") to set size of window 1 to {<w>, <h>}' \
  -e 'tell application "System Events" to tell (first process whose name contains "erdr") to set position of window 1 to {<x>, <y>}'
d space.select '{"id":"<your space>"}'; d tab.select '{"id":"<your tab>"}'; d pane.focus '{"pane":"<your pane>"}'
d ledgr.settings; d ledgr.settings:scale:<your scale>; d ledgr.settings:close
pbcopy < <scratch>/clip.txt
herdr-app status                # space, tab, focused pane as before; no overlays, no errors
```

The panel follows the focused pane again once the session is gone. The forget does not remove the
hooks' own files for that session (`ledgr-data/sessions/<sid>.json`, `turns/<sid>/`, `mcp/<sid>/`),
and the retention sweep archives closed items only.
