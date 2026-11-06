# Example integration: a personal tab bar that hosts ledgr

The repo owner's own setup, kept as an example of fitting ledgr into a window you already customised.
It is not part of the mod; a stranger never needs it.

- `mods/my-tabs/`: a personal tab bar (cloned from Herdr's `tabs`) with a "ledgr" button beside
  Files and Changes, a `toggle-ledgr` command (⌘⇧J here), and the ledgr writer: it imports
  `./ledgr/writer.js`, a byte-identical copy of ledgr's engine that `install.sh` writes into
  `mods/my-tabs/ledgr/` (Herdr refuses imports from another mod's folder). Because this tab bar is
  always shown, it replaces ledgr's own host block.
- `mods/my-pane/`: a personal pane header (cloned from Herdr's `pane`) with the ledgr chip, in place
  of `ledgr-pane`.
- `overlay.json`: which mods to deploy, which one hosts the writer, which one draws the chip, and
  what the toggle key runs.
- `answers.json`: the owner's full answers: `./install.sh --yes --answers examples/personal-overlay/answers.json`.

To make your own: copy this folder, put your mods under `mods/`, edit `overlay.json`, and run
`./install.sh --overlay <your folder>`. The installer backs up every file it replaces and keeps the
original from before ledgr for `./uninstall.sh`, and writes engine copies only into mods that import
`./ledgr/…`.
