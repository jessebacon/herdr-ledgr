# Staging preview.png

`preview.png` is the pane plus the panel in demo mode. Every step below is a Herdr command, so the
state can be rebuilt and retaken with any screenshot tool. Demo mode never writes `ledgr-data/`:
the acts, the threshold and the hidden branches below change only the demo's in-memory store.

## The state

- The pane header chip (`ledgr-pane`) reads `1 blocking · 2 asks · 1 parked`, beside the agent's
  working spinner.
- YOUR QUESTIONS: Question 3 with its quote, and under BRANCHES one row, "branch of Question 3 ·
  depth 1 · idle".
- ASKED OF YOU (threshold blocking + needed): Ask 15 (blocking decide) open on its two options, its
  quote, the answer box and the Done / Defer / ⋯ row; Ask 8 (needed review) collapsed; the folded
  `below threshold (2)` line.
- No capture box, no note line at the bottom.

## Before

- Herdr running with ledgr deployed (`./install.sh`) and `ledgr-pane` as the layout's pane header.
- The shown tab holds a Claude Code pane. For the spinner, give it a long, harmless prompt (a
  throwaway session in a scratch folder, such as "Without using any tools, write a long design note,
  about 4,000 words of plain prose, on …") and stage while it streams.
- Leave the panel column at the width you want in the shot.

## Commands

```sh
d() { herdr-app do "$@" >/dev/null; }
d layout.select '{"stack":"panel-body","child":"ledgr"}'   # the ledgr tab of the right-hand panel
d layout.show '{"id":"panel"}'
d ledgr.demo                                               # demo on (the same command turns it off)
d ledgr.threshold:needed                                   # demo: in memory only, not saved
d ledgr.collapse-all                                       # closes the demo's Branch confirmation, Conclude editor and the note
for h in Q4 Q5 Q6 Q7 Q8 A3 A5 A6 A7 A9 A10 A11 A12; do d "ledgr.act:$h:dismiss"; done
d ledgr.hide-branch:br-q9-0d3a                             # the refused depth-3 request
d ledgr.hide-branch:br-q2-a41b                             # the rejoined branch of Question 2
d ledgr.menu:A15:defer                                     # opens Ask 15 (and its Defer menu) ...
d ledgr.menu:off                                           # ... then closes the menu
d ledgr-pane.demo-chip:blocking                            # the chip on every shown pane header
```

## Take the shot

- Any tool: ⌘⇧4, then Space, then click the Herdr window, and crop to the pane plus the panel.
- Or Herdr's own frame, which needs the window to be repainting (an inactive window returns its last
  painted frame, so check that the spinner and text are current):

  ```sh
  herdr-app shot /tmp/ledgr-shot.png
  # pane + panel of a 1745 x 1342 window (Herdr's sidebar and status bar left out); adjust to yours
  sips --cropToHeightWidth 1262 1475 --cropOffset 46 270 /tmp/ledgr-shot.png --out preview.png
  ```

## Undo

```sh
d ledgr-pane.demo-chip:off
d ledgr.demo                       # demo off: the panel reads config.json again (threshold as saved)
d layout.hide '{"id":"panel"}'     # only if the panel was hidden before
```
