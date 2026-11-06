# Staging preview.png

`preview.png` is a real Claude Code pane plus the ledgr panel in authoritative mode (`asks.handoff:
ledgr`, the default): the agent's reply ends with the pointer line and its bullet-form `ledgr-asks`
block, and the panel shows the same items, recorded by the hooks from that reply. Every step is a
Herdr command, so the state can be rebuilt and retaken with any screenshot tool. The session is a
throwaway in a scratch folder; it is forgotten afterwards through the panel's own spool event.
(Until 2026-11-06 the shot was the demo mode's fixtures beside a streaming pane.)

## The state

- The pane: the prompt, a plan in prose that keeps no list for you, then `ledgr: 3 items for you, 2
  blocking` and the block (two `blocking` lines, one `needed`), and "done". The pane header chip
  (`ledgr-pane`) reads `2 blocking`.
- The panel follows that pane: YOUR QUESTIONS empty; ASKED OF YOU (threshold `blocking only`, as the
  maintainer runs it) with Ask 1 (provide) and Ask 2 (decide, its two options) open, each with its
  quote and "declared by the agent", and `below threshold (1)` unfolded on Ask 3 (needed, Promote).
- No capture box, no note line at the bottom.

## Before

- Herdr running with ledgr deployed (`./install.sh`), `asks.handoff` `ledgr` in
  `ledgr-data/config.json`, and `ledgr-pane` as the layout's pane header. The MCP server not
  registered for that config folder (with it, the agent declares by tool and the reply ends with the
  pointer line only, no block). The shot was taken before the maintainer registered the server; since
  2026-11-06 both of his config folders have it, so a retake on his machine shows the tool path
  unless the session runs from a config folder without it.
- A scratch folder Claude Code already trusts (a new one stops at the trust prompt). The maintainer
  used `<scratchpad>/ledgr-live/app` from an earlier live test.
- Note the shown space, tab and focused pane (`herdr-app status`), to come back to them.
- Leave the panel column at the width you want in the shot.

## Commands

```sh
d() { herdr-app do "$@" >/dev/null; }
APP=/path/to/a/trusted/scratch/folder
herdr-app do space.new "$(python3 -c 'import json,sys; print(json.dumps({"name": "ledgr preview", "folder": sys.argv[1],
  "argv": ["claude", "--model", "haiku"],
  "task": "Without using any tools: I want to ship the docs site for my tally CLI this week. Write a short plan, 8 to 12 sentences, for building and deploying it from this folder. You cannot finish without two things from me: the domain name, and whether to host on Netlify or GitHub Pages. After it is live I also have to check the DNS records myself before the work is truly done."}))' "$APP")"
# note the returned "terminal" (t24 here); wait until `herdr-app ls` shows it done, and
# `grep <terminal> ~/.config/herdr-app/ledgr-data/log/hook.log` ends with "extract … source=block asks=3"
d ledgr.below-threshold        # unfold Ask 3 (this session's fold only, in memory)
d ledgr.expand-all             # open the three rows
```

Haiku's wording differs per run; retake if the reply lists the items in prose, or if the block did
not parse (`source=block` in the log line; `source=model` means it fell back to the extractor).

## Take the shot

- Any tool: ⌘⇧4, then Space, then click the Herdr window, and crop to the pane plus the panel.
- Or Herdr's own frame, which needs the window to be repainting (an inactive window returns its last
  painted frame, so check that the text is current):

  ```sh
  herdr-app shot /tmp/ledgr-shot.png
  # pane + panel of a 1745 x 1342 window (Herdr's sidebar and status bar left out); adjust to yours
  sips --cropToHeightWidth 1262 1475 --cropOffset 46 270 /tmp/ledgr-shot.png --out preview.png
  ```

## Undo

```sh
d space.select '{"id":"<your space>"}'; d tab.select '{"id":"<your tab>"}'; d pane.focus '{"pane":"<your pane>"}'
d space.close '{"id":"<the preview space>","confirmed":true}'
# forget the throwaway session (and its items) through the panel's own spool event:
python3 -I -c 'import sys; sys.path[:0]=[sys.argv[1]]; import ledgr_spool as S; S.emit("forget", None, sys.argv[2], {})' \
  ~/.config/herdr-app/mods/ledgr/bin/lib <session id from the hook.log line>
```

The panel follows the focused pane again once the session is gone.
