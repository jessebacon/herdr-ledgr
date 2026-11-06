# ledgr Phase 2: build notes (2026-11-05)

Branch action on a parked question, branch lineage, and the context manifest. Herdr 0.1.13, hc 0.1.18,
Claude Code 2.1.311. Phase 1 notes: `BUILD-NOTES-mod.md`, `BUILD-NOTES-hooks.md`. Spec: Sections 3, 6,
8 and 11 of `~/Repos/ledgr/docs/design/Herdr ledger mod design.md` (moved there from
`~/Documents/reports/` during this build, unchanged; the Phase 2 table is appended to its Section 11).

## 1. What it does

1. Expand a parked question in YOUR QUESTIONS and click **Branch…** (Claude Code sessions only).
2. A confirmation opens under the row with the manifest, before anything starts:

   | Line | Says |
   |---|---|
   | Parent | terminal, session name and short id, the parent's depth |
   | Depth | parent depth + 1, of `branch.maxDepth`; "refused" past the cap |
   | Turns | anchor turn A, fork turn F (the end of the session, "in progress" if the parent is working), and how many turns past the anchor the branch sees (A+1..F) |
   | Compacted | whether a compaction was recorded at or after A (the anchor then reaches the branch only through Claude's summary) |
   | Checkout | the shared folder: the preamble forbids edits, nothing enforces it (or: own worktree from HEAD) |
   | Cache | a fork reuses its parent's prompt cache only if launched within the cache window (5 min by default), and how long ago the parent's last turn ended |
   | Not known | other branches of the parent, other parked questions, /btw answers |
   | Refused | the reason, when there is one; Launch is then disabled |

   Placement: **beside the trunk** (default), **sub-agent only**, or **isolate in a worktree** (only when
   the parent's folder is a git checkout).
3. **Launch branch** posts one `branch` spool event. The writer re-checks the depth cap against the
   current `config.json`, records the Branch (manifest frozen), and runs

   ```
   hc run --bg --json --parent <parent terminal> --outlive-parent --no-notify --name br-q1-7aeb
     --cwd <parent cwd> --label ledgr.branch=<br id> --label ledgr.parent_session=<sid> --label ledgr.item=<rq id>
     -- /usr/bin/env LEDGR_PARENT=<sid>:<rq id>:<A> LEDGR_BRANCH=<br id>:<depth>:<F>:<child sid>
        /opt/homebrew/bin/claude --resume <sid> --fork-session --session-id <child sid> -n "Q1: …" "<preamble>"
   ```

   then, for "beside the trunk", waits until the app sees the new terminal, focuses the parent's pane and
   runs `terminal.keep {terminal, place: "right"}`. Nothing is typed into any terminal.
4. The child's SessionStart hook (`source: "fork"`) finds `LEDGR_PARENT`, writes the lineage into its
   session record and map entry, and emits `branch_started`. The writer links the child session to the
   Branch (status `running`).
5. The branch's first turn is the preamble: the anchor quote and question; "copied from the end of the
   session at turn F, while the question was parked at turn A, so turns A+1..F are included"; answer in
   the context of the anchor and say if later turns change it; a compaction line when one applies; make NO
   file edits (shared checkout); end with a fenced `ledgr-conclusion` block. About 180 words plus the
   quote (203 with the compaction line).
6. Under YOUR QUESTIONS, a **BRANCHES** section lists the session's branches: live status from Herdr
   (`agents()`, else `terminals()` for a pane-less sub-agent), name, question, depth; expanded: the frozen
   manifest, session, terminal and placement, the branch's own open items ("asked in this branch"), its
   `ledgr-conclusion` (or last message), and **Focus** (pane, else a peek), **Conclude** (disabled,
   tooltip "Phase 3"), **Preamble**. A branched question shows a small branch badge.
7. Branch sessions are nested under their parent in the session menu; the header of a branch session
   shows "branch · depth n". Sessions whose terminal is gone offer **forget** (two clicks), which removes
   the session, its items and its branches, recursively.

## 2. Data and events

| Event | From | Payload | Applied |
|---|---|---|---|
| `branch` | panel (Launch) | `session_id` (parent), `item`, `branch_id`, `placement` (`split` \| `agent`), `isolate` | own event (never creates a session). New Branch, status `launching` (or `refused` with the reason); `out.launch` asks the writer to start it |
| `branch_started` | child's SessionStart hook | envelope (child sid, child terminal) + `parent_session_id`, `item_id`, `anchor_turn`, `fork_turn`, `depth`, `branch_id`, `source` | lineage on the child session; Branch found by id (else parent + item), `sessionId`, `terminal`, status `running`; a fork started outside the panel gets a record marked `external` |
| `compacted` | SessionStart `source: "compact"` | `turn`, `trigger` | `session.compactions` (last 10) |
| `forget` | panel (session menu) | `session_id` | own event. Removes the session, its items, turns, terminal mappings and branches, and its branch sessions; ids kept in `store.forgotten` (200) so late events and the map do not bring them back |

Branch record (`store.branches[br_<uuid>]`): `requestId`, `parentSessionId`, `parentTerminal`, `childSid`
(planned, passed as `--session-id`), `sessionId` (confirmed by `branch_started`), `terminal`, `name`
(`br-<handle>-<4 hex>`), `label` (claude `-n`), `depth`, `anchorTurn`, `forkTurn`, `anchorHash`,
`anchorUuid`, `quote`, `policy: "fork_end_of_session"`, `placement`, `isolate`, `cwd`, `manifest` (frozen),
`preamble`, `status` (`launching`, `launched`, `running`, `refused`, `failed`), `error`, `note`,
`createdAt`, `launchedAt`, `startedAt`. Live words in the panel add `working`, `idle`, `done`, `blocked`,
`starting`, `closed`, `ended`, `nostart` (launched, never reported, terminal gone).

Session record additions: `parentSessionId`, `parentItem`, `anchorTurn`, `forkTurn`, `depth`, `branchId`,
`compactions`. The hooks' map entry (`terminals/<t>.json`) and session file carry `parent_session_id`,
`branch_id`, `parent_item`, `anchor_turn`, `fork_turn`, `depth`, `compactions`.

Depth: a session's `depth` (trunk 0). `branch.maxDepth` (default 2) is honoured whatever it is: 0 turns
branching off, 5 allows five levels. Checked on the confirmation and again by the writer.

## 3. Files

Created:

| File | What |
|---|---|
| `mods/ledgr/branch.js` | pure: `manifest`, `manifestLines`, `preamble`, `hcRunArgs`, `claudeArgv`, `liveStatus`, `maxDepthOf`, `branchName`, `branchLabel` |
| `mods/my-tabs/ledgr/branch.js` | byte-identical engine copy |
| `mods/ledgr/bin/tests/test-store.sh`, `test_store.mjs` | the store unit test, now in the mod: Phase 1 rules (ported from the build session's scratchpad) plus Phase 2 |
| `mods/ledgr/BUILD-NOTES-phase2.md` | these notes |

Edited (backups of the originals in `~/.local/state/ledgr/backup-20261105/phase2/<same path>`):

| File | Change |
|---|---|
| `mods/ledgr/store.js` | `branch`, `branch_started`, `compacted`, `forget` handlers; `branchLaunched`, `setLineage`, lookups; `forgotten`; `maxDepth` |
| `mods/ledgr/writer.js` | `launchBranch`, `placeBeside`, `claudePath`; config reload for `branch` batches; stale `launching` marked failed at start; `branch.js` in `ENGINE_FILES` |
| `mods/ledgr/panel.js` | Branch button and confirmation, BRANCHES section, badge, branch header pill, nested session menu, forget, commands |
| `mods/ledgr/fixtures.js` | demo branch of Q3 (with an ask and a conclusion), a compaction, a refused depth-3 request |
| `mods/ledgr/main.js` | command list comment |
| `mods/ledgr/RECIPE.md`, `BUILD-NOTES-mod.md` | disclosure (it now starts agents), engine-copy command |
| `mods/my-tabs/ledgr/{config,store,spool,writer}.js` | re-copied; all five identical (`cmp`) |
| `mods/ledgr/bin/lib/ledgr_map.py` | `branch_env`, `lineage_for`, fork and compact handling in SessionStart, lineage in the map entry |
| `mods/ledgr/bin/lib/ledgr_spool.py` | `branch_started`, `compacted` builders; docstring |
| `mods/ledgr/bin/adapters/claude/claude_hook.py` | docstring only (the lineage code is agent-agnostic, in lib) |
| `mods/ledgr/bin/tests/test-hooks.sh`, `run-all.sh`, `bin/BUILD-NOTES-hooks.md` | 13 new checks; store test in the suite; `pipefail` |
| `~/Repos/ledgr/docs/design/Herdr ledger mod design.md` | Section 11, Phase 2 table appended (backup of the pre-edit file under `phase2/reports/`) |

Not touched: `mods/my-tabs/main.js`, `mods/my-pane/*`, `keys.json`, `layouts/custom.json` (no layout
change was needed), shipped mods, `layouts/main.json`, `~/.claude/settings.json`.

Rollback: copy the `phase2/` backups back, delete `branch.js` from both folders and
`bin/tests/test-store.sh`, `test_store.mjs`; then copy the engine files to `mods/my-tabs/ledgr/` again.

## 4. Unconfirmed behaviours, as observed

| Behaviour | Result |
|---|---|
| `hc run --parent <t>` from a mod (no `HC_TERMINAL_ID`) | **Works.** The `my-tabs` writer's `hc(["run", …])` made `t1r` with `parent: "t1q"`, `notify: false`, `die_with_parent: false`, the three `ledgr.*` labels. Herdr lists it in `t1q`'s `sub_agents` and the agents sidebar draws it under the trunk. `--json` prints `{address, agent, cwd, name, parent, state, turn}` |
| `pane.split` with a multi-argument argv | **Works, without lineage.** `herdr-app do pane.split --argv '["/usr/bin/env","LEDGR_PROBE=a:b:3","/bin/sh","-c",…,"multi word","line1\nline2","--fork-session"]'`: every argument arrived intact (env var, spaces, newline, flags). The terminal has `parent: null` (Herdr's `herdr.space`/`herdr.tab` labels only), so the agents tree would not nest it. Not used |
| `terminal.keep {terminal, place: "right"}` on a sub-agent | **Works** with the address (a name answers "no running terminal"): `{pending: true, terminal, pane, tab}`, a pane right of the focused pane, `keep: true`, parent link kept. **Sent at once after `hc run` it did nothing** (the app had not seen the terminal yet); the writer now waits for it in `terminals()`, then checks the pane came. Re-tested live with the depth-2 launch: pane given, no note |
| `--session-id <uuid>` with `--resume --fork-session` | **Works**, in `-p` and interactive: the child's session id is the planned uuid (`271e5d26…` planned and reported); the fork's transcript holds the parent's messages |
| `--resume <sid> --fork-session` from another cwd | **Works** from a fresh `git worktree` of the same repo (the fork is stored under the worktree's project folder, history intact: it answered with the parent's first word) and from an unrelated folder. So the worktree toggle is offered |
| SessionStart in the child carrying `LEDGR_PARENT` | **Works.** Source `fork`, `LEDGR_PARENT` and `LEDGR_BRANCH` in the hook's environment: map entry `terminals/t1r.json` had `parent_session_id`, `branch_id`, `parent_item`, `anchor_turn: 1`, `fork_turn: 2`, `depth: 1`; `branch_started` applied; branch `running` |
| SessionStart `source: "compact"` | **Confirmed with a real `/compact`** on the scratch trunk: same session id, record `compactions: [{turn: 3}]`, `compacted` applied, the next confirmation said "Compacted: yes, after the anchor (turn 3)". A fork taken afterwards opens at Claude's "Conversation compacted" row and answers from the summary |
| Peek on a pane-less branch | `terminal.peek` (what Focus runs for a branch without a pane) shows the bar "br-q1-d5fa · finished · from t1q" with ↗ keep |

## 5. Live test (scratch only)

Scratch repo `…/scratchpad/ledgr-p2/repo` (git). No live session (t1g, t2, t3) was forked or sent
anything. Model: Haiku for every test session (forks inherit the parent's model).

1. `claude -p` (hooks off) made `d2929184`; the CLI tests above forked it three times.
2. A test space with a trunk tab: `claude --model haiku "Reply with the single word ready."` in `t1q`
   (session `af17adab`, mapped by the hooks, turn 1). Q1 parked through a `capture` spool event against
   turn 1, quote "ready". A second trunk turn ("steady") made F = 2.
3. `herdr-app do ledgr.branch` opened the confirmation (manifest: depth 1 of 2, anchor 1, fork 2, sees 1
   turn beyond the anchor, no compaction, shared checkout, cache note); `herdr-app do ledgr.launch-branch`
   ran the panel's Launch: branch `br-q1-7aeb` in `t1r`, child `271e5d26`, `running`. The child's first turn
   answered Q1, said turn 2 does not change it, and ended with a `ledgr-conclusion` block, which the
   trunk's BRANCHES row shows. This launch hit the keep timing bug (sub-agent, no pane); fixed as above.
4. Depth 2: Q1 parked in the branch session, Launch: `br-q1-2968` in `t1s`, parent `t1r`, given a pane by
   the writer. The agents sidebar drew trunk → `br-q1-7aeb` → `br-q1-2968`.
5. Depth 3 with the default config: the confirmation showed "Depth 3 of branch.maxDepth 2 — refused" and
   "Refused: depth 3 is beyond branch.maxDepth 2 (ledgr-data/config.json)" with Launch disabled; the
   Launch command answered "Branch refused: …". A `branch` event written directly to the spool (a stale
   panel) was refused by the writer too: record `refused`, no process.
6. Compaction: a real `/compact` (typed with `hc keys`; `hc send` wraps text in `<hc from="t3">…</hc>`, so a
   slash command sent that way is an ordinary prompt, which made trunk turn 3), then "Branch again…" as
   sub-agent only: `br-q1-d5fa` in `t1t`, pane-less, its preamble carried the compaction line.
7. Cleanup: terminals killed and removed, test space closed, the trunk forgotten through a `forget` spool
   event (4 sessions, their items and 4 branch records gone; ids in `store.forgotten`). Deleted the test
   terminals' map files, session files, turn folders and locks under `ledgr-data/`; the scratch
   transcripts under `~/.claude/projects/` and the per-session `~/.claude/file-history`, `session-env`
   and `skills/my-queue/.last-check-*` entries of the 8 test sessions; the scratch worktree. Window put
   back: the earlier space, t2's pane, panel hidden with Quota selected, width 360.

Residue: `~/.claude.json` gained project entries for the scratch paths (Claude Code writes them; not
edited). `ledgr-data/store.json` keeps the 4 forgotten ids. Shots in the scratchpad `ledgr-p2/shot-*.png`.

## 6. Deviations from the spec and the brief

| Topic | Built | Why |
|---|---|---|
| Who launches | The panel posts a `branch` event; the writer starts the process | One writer owns `store.json`, so the Branch record, frozen manifest and launch happen together; the depth cap is re-checked against the current config; the fallback writer behaves the same |
| Placement | `hc run --parent` + `terminal.keep place: right` (after a wait), not `pane.split` | `pane.split` carries the argv but gives no hc parent, so the agents tree would not nest the branch; keep gives both |
| Branch environment | `LEDGR_BRANCH=<br id>:<depth>:<fork turn>:<child sid>` beside the specified `LEDGR_PARENT` | The hook can link the exact record and ignore a later `/branch` or `/clear` in the branch's process, whose environment still carries `LEDGR_PARENT` |
| Conclusion | fenced block tagged `ledgr-conclusion` (`answer:`, `changes:`) | The brief; spec 8.2 used `<ledgr-conclusion>` tags |
| Branch status | `launching`, `launched`, `running`, `refused`, `failed`; live words from Herdr | Phase 3 adds concluded/merged; awaiting-human is Herdr's `blocked` |
| Branch fields | `childSid` (planned) and `sessionId` (confirmed); frozen `manifest` object; `preamble` | `--session-id` works, so the id is known before launch; the record is the manifest (spec 8.3) |
| Isolation | Herdr's worktree dialog (`~/.herdr/worktrees/<repo>/<branch>`, new space) with the same argv | The brief asks for Herdr's worktree facility. That path has no hc parent: lineage is ledgr's only |
| Forget | new `forget` event and `forgotten` list | Removing test data through the panel's own events; useful for closed sessions in general |
| Driving commands | `ledgr.branch`, `branch-split`, `branch-agent`, `launch-branch`, `expand-branches`, `sessions` | So `herdr-app do` runs the same code as the clicks (no real clicks in these tests) |
| Not built | Reopen of a closed branch (spec Phase 2), branching from agent asks | Out of the brief; reopen is the same launch without `--fork-session` |
| Turn numbers | ledgr turns | Sessions older than the hooks count from hook install (spec Q8) |
| Cache note | 5-minute default window | The mod cannot tell whether a session uses the 1-hour cache |

## 7. Tests

```sh
cd ~/.config/herdr-app/mods/ledgr/bin && bash tests/run-all.sh
# OK parse_block · OK last_assistant · OK fixtures · 59 passed (hooks) · OK: store, 162 checks (54 + 108)
herdr-app check ~/.config/herdr-app/mods/{ledgr,my-tabs,my-pane}   # pass; ledgr also with FORCE_DEMO = true
```

## 8. Not verified

- The worktree toggle end to end (it would write `~/.herdr/worktrees/`, outside Herdr's home and `~/.claude`).
- Real mouse clicks (Branch…, the placement buttons, Launch, Focus on a pane, forget): driven through the
  panel commands that call the same functions.
- Whether a fork actually reads the parent's prompt cache (the note states the docs' condition; cost not measured).
- A launch while the parent is mid-turn (the manifest says "in progress"), and auto-compaction mid-turn.
- The `nostart` path (no failing launch was produced), a writer restart mid-launch, the panel's fallback
  writer launching, and a cold start of Herdr.
- Sessions older than Phase 2 have no compaction history: their manifest says "no compaction recorded".
