# Staging preview.png

`preview.png` is a real Claude Code pane plus the ledgr panel in authoritative mode (`asks.handoff:
ledgr`, the default) on the tool path: the MCP server is registered, so the agent declares its asks
with `declare_asks` and its reply ends with the pointer line only, no fenced block; the panel shows
the same items, labelled "declared by the agent (tool)". Every step is a Herdr command, so the state
can be rebuilt and retaken with any screenshot tool. The session is a throwaway in a scratch folder;
it is forgotten afterwards through the panel's own spool event. (Until 2026-11-06 the shot was the
demo mode's fixtures beside a streaming pane; on 2026-11-06 it was the block path, retaken on the
tool path on 2026-11-07.)

## The state

- The pane: the prompt, a plan in prose that keeps no list for you, Claude Code's folded tool call
  (`Called ledgr`), then the pointer line `ledgr: 3 items for you, 2 blocking` and "done". No
  `ledgr-asks` block. The pane header chip (`ledgr-pane`) reads `2 blocking`.
- The panel follows that pane: YOUR QUESTIONS empty; ASKED OF YOU (threshold `blocking only`, as the
  maintainer runs it) with Ask 1 (provide) and Ask 2 (decide, its two options) open, each with its
  quote and "declared by the agent (tool)", and `below threshold (1)` unfolded on Ask 3 (needed,
  Promote).
- No capture box, no note line at the bottom.
- Nothing personal in the frame: the pane header and Claude Code's banner both print the folder, so
  use a neutral one (`/private/tmp/claude-501/tally` in the 2026-11-07 take; the 2026-11-06 take
  showed a scratchpad path with a user and employer name in it).

The pointer line the tool returns counts only items at or above `extract.threshold`, so with
`blocking` it reads `ledgr: 2 items for you, 2 blocking`; in the 2026-11-07 take Haiku wrote `3
items` itself, counting the folded one. Either is the tool path; the panel and the chip are the same.

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
- Note the shown space, tab and focused pane (`herdr-app status`), to come back to them.
- Leave the panel column at the width you want in the shot.

## Commands

```sh
d() { herdr-app do "$@" >/dev/null; }
APP=/private/tmp/claude-501/tally      # a trusted scratch folder with a neutral name
herdr-app do space.new "$(python3 -c 'import json,sys; print(json.dumps({"name": "ledgr preview", "folder": sys.argv[1],
  "argv": ["claude", "--model", "haiku"],
  "task": "Do not read or change any files: I want to ship the docs site for my tally CLI this week. Write a short plan in prose, 8 to 12 sentences, for building and deploying it from this folder. You cannot finish without two things from me: the domain name, and whether to host on Netlify or GitHub Pages. After it is live I also have to check the DNS records myself before the work is truly done. Declare all three with ledgr'"'"'s declare_asks tool, each with its quote."}))' "$APP")"
# note the returned "terminal" (t2g here); wait until `herdr-app ls` shows it done, and
# `grep <terminal> ~/.config/herdr-app/ledgr-data/log/hook.log` ends with "extract … source=tool asks=3"
d ledgr.below-threshold        # unfold Ask 3 (this session's fold only, in memory)
d ledgr.expand-all             # open the three rows
```

Haiku's wording differs per run; retake if the reply lists the items in prose or ends with a block
(the server is not connected for that config folder), or if the log line is not `source=tool asks=3`.
The last sentence of the task is there for a reason: without it, the 2026-11-07 first try declared
the asks with no quotes, so the rows had none. "Without using any tools", the block path's wording,
would keep the agent off the tool.

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
  # pane + panel of a 1745 x 1342 window (Herdr's sidebar and status bar left out); adjust to yours
  sips --cropToHeightWidth 1262 1475 --cropOffset 46 270 /tmp/ledgr-shot.png --out preview.png
  ```

  The sidebar left out of the crop lists the other spaces and their folders; check that none of it
  shows.

## Undo

```sh
hc kill <the preview terminal>; hc rm <the preview terminal>   # the space closes with its last terminal
d space.close '{"id":"<the preview space>","confirmed":true}'  # only if it is still there
d space.select '{"id":"<your space>"}'; d tab.select '{"id":"<your tab>"}'; d pane.focus '{"pane":"<your pane>"}'
# forget the throwaway session (and its items) through the panel's own spool event:
python3 -I -c 'import sys; sys.path[:0]=[sys.argv[1]]; import ledgr_spool as S; S.emit("forget", None, sys.argv[2], {})' \
  ~/.config/herdr-app/mods/ledgr/bin/lib <session id from the hook.log line>
```

The panel follows the focused pane again once the session is gone. The forget does not remove the
hooks' own files for that session (`ledgr-data/sessions/<sid>.json`, `turns/<sid>/`, `mcp/<sid>/`),
and the retention sweep archives closed items only.
