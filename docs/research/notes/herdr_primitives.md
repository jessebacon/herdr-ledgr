# Herdr desktop app: UI primitives for a "branching conversation" UI (as installed, 2026-11-05)

Source key. Every source is a local file or the output of a read-only `--help`-style command run on 2026-11-05. Line numbers are 1-based. Herdr version 0.1.12 (from `cloned_from` in `layouts/custom.json:3-6`); Claude Code 2.1.311 (`claude --version`).
- `AGENTS.md`, `herdr.d.ts`, `gpui-kit.d.ts`, `layouts/*.json`, `keys.json`, `shared.json`, `data/` are under `~/.config/herdr-app/`. `mods/<name>/main.js` means `~/.config/herdr-app/mods/<name>/main.js`.
- Command-output sources: `herdr-app --help`, `herdr-app commands` (a JSON list of every command and its arguments; prints only), `hc --help`, `hc <cmd> --help`, `hc --skill` (prints the hc manual), `hc schema` (prints the herdr-core API as OpenRPC/JSON Schema), `claude --help`. `herdr-app do --help` is not supported: it returns `{"error": "unknown command \"--help\" ..."}`.
- Nothing under `~/.config/herdr-app` was modified. `herdr-app shot`, `herdr-app status`, `herdr-app ls` and `hc ls/get` were not run.

## Q1. What does a layout JSON control? Can a mod own a right-hand or bottom panel? Can blocks nest?

### Takeaway
A layout file describes the whole window as a tree. `row`, `column` and `stack` containers nest to any depth. The leaves are `block`s, and a block shows a mod, a fixed terminal, the active tab's panes, or the focused agent. Jesse's `custom` layout already has a hidden right-hand `panel` column. It holds a `stack` of mod blocks (files, changes, quota) that the tab-bar mod shows and hides. That is the obvious slot for a "branches" mod. A bottom panel would just be another child of the `work` column.

### Cited Findings
- A layout has four node types. A `block` "shows content": `{ "mod": "<folder>", "props": {...} }`, `{ "terminal": "t7" }`, `{ "tab": "active" }` (the shown tab's terminals), or `{ "agent": "focused" }` (one agent's terminal at full size, chosen by `agent.focus`/`agent.next`, else the focused pane's agent). `row`/`column` put children side by side or stacked. A `stack` shows one child (`"active"`) with an optional `"header"` mod. — `~/.config/herdr-app/AGENTS.md:217-226`
- Node properties: `id`, `size` (`px` or `weight`), `min`/`max`, `hidden`, background/border/radius/shadow/focus, `padding`, and for row/column `gap`/`divider`/`resizable`. Also `movable`, `floating`, `window_drag`, and root-only `titlebar`, `traffic_lights`, `preview` and `terminal_menu`. — `~/.config/herdr-app/AGENTS.md:228-266`
- Per-block look isn't supported yet: "Today only the root's look applies; a block's own look is coming." — `~/.config/herdr-app/AGENTS.md:339`
- Pane frames. The tab block's `pane` object sets gap, radius, background, border, focus and `header`. The header is "a mod drawn on each pane, one copy per pane, with `props().pane` and `props().terminal`", positioned top or bottom, with `reveal: "always" | "hover"`. — `~/.config/herdr-app/AGENTS.md:341-364`
- Floating blocks sit over a node on an edge. They size to their content and can be dragged. `peek` makes a side drawer that slides out on hover. The mod reads `placement()`. — `~/.config/herdr-app/AGENTS.md:366-390`; `~/.config/herdr-app/herdr.d.ts:254-263`
- `custom.json` structure:
  - The root is a `row`, cloned from `main` 0.1.12 (`custom.json:1-8`).
  - The left `sidebar` column holds a `workspace-chrome` brand block, a `sidebar-lists` column (the `kolczyk` mod in place of `spaces`, then the `agents` mod) and a footer (`custom.json:9-73`).
  - The `work` column holds, top to bottom:
    - the `tabs` block, running the `my-tabs` mod, 42 px (`78-88`);
    - the `work-body` row (`89-165`), which contains the `main` block (`{"tab":"active"}` with a `pane` header mod, `93-120`) and a right-hand `panel` column, `size 368 px, min 280, max 900, "hidden": true` (`122-161`). Inside `panel` is a `panel-body` **stack** of `files`, `changes` and `quota` mod blocks, with `"active": "files"` (`127-153`);
    - a `status` block running `workspace-status`, 28 px (`166-175`).

  — `~/.config/herdr-app/layouts/custom.json`
- `main.json` has the same tree with the shipped `spaces`/`tabs` mods and no quota block (`panel` at `main.json:135-167`). — `~/.config/herdr-app/layouts/main.json`
- Mods drive the side panel at run time with `layout.select {stack:"panel-body", child}`, `layout.show {id:"panel"}` and `layout.hide`. — `~/.config/herdr-app/mods/my-tabs/main.js:24-27, 101-109`. Layout commands: `layout.switch|toggle|show|hide|resize|select|set|reset|clone`. — `~/.config/herdr-app/AGENTS.md:598-602`; `~/.config/herdr-app/herdr.d.ts:67-68`
- `layout.set {layout}` is for "personal tree edits; on shipped layouts only click/look fields change". Shipped layouts and mods are read-only and replaced on start, so clone them before editing. — `~/.config/herdr-app/AGENTS.md:183-202, 598-600`
- Clicks (sizes, shown/hidden, which stack child, floating spots) persist in `layouts/.state/`. — `~/.config/herdr-app/AGENTS.md:210-213` (observed `layouts/.state/custom.json`)
- `mod.json` `place`: `"right" | "left" | "top" | "bottom" | "none"`, plus `size`. The first time Herdr sees a mod folder, it docks one copy there; after that the layouts decide. — `~/.config/herdr-app/AGENTS.md:772-789`
- A mod copy stays alive while its block is in the layout, even when hidden or in an inactive stack child. Its timers keep running. — `~/.config/herdr-app/AGENTS.md:795-800`
- Overlays (dialog, popup or draggable `window`) can hold a mod or a whole layout, including `{terminal:"t7"}` blocks. — `~/.config/herdr-app/AGENTS.md:956-970`; `~/.config/herdr-app/herdr.d.ts:332-368`
- A pane can itself be a mod (`pane.split {direction, mod, props}`), saved with its tab. — `~/.config/herdr-app/AGENTS.md:125-130`

### Inferences
- **Right-hand panel a mod owns:** yes. Add `{ "id": "branches", "type": "block", "content": { "mod": "branches" } }` as a fourth child of `panel-body` in `custom.json`, which is a personal clone and so editable. Add a toggle button or key to `my-tabs`, copying the quota pattern.
- **Bottom panel:** insert a block or column between `work-body` and `status` in the `work` column.
- **Nesting:** containers nest freely; blocks are leaves. A block cannot hold children, but a mod inside a block can lay out anything.
- A stack shows one child at a time, so a Branches child would compete with Files, Changes and Quota. Giving it its own column avoids that.
- A layout block with `{ "agent": "focused" }` could serve as a "branch preview" region that follows `agent.focus`.

### Gaps
- No documented way was found for a mod to retarget a `{ "terminal": "tX" }` layout block at run time, other than rewriting the tree with `layout.set` or opening an overlay window with its own `layout`. Unconfirmed.
- What props a stack `header` mod receives is not documented beyond "a mod that draws tabs" (`~/.config/herdr-app/AGENTS.md:225-226`).

## Q2. What does the mod API expose for spawning agents (with a prompt, `--resume`, `--fork-session`), reading the active pane's Claude session id, reacting to agent output, persistent state, keyboard shortcuts, and drawing a tree or list?

### Takeaway
Spawning is first-class. `pane.split`, `tab.new`, `space.new` and `terminal.open` all take an `argv`, so `claude --resume <id> --fork-session "<prompt>"` can open in a split, a tab or a space. `hc run` adds `--parent`, labels and lifecycle flags. The API has **no Claude session id**. It only exposes terminal addresses and pids, so a mod would have to map pid to session through Claude Code's own `~/.claude/sessions/<pid>.json` (unconfirmed end to end). A mod reacts to agent activity through live re-render on status changes, `hc read`, and `watchFolder`. It cannot stream `hc events`. State can live in `localStorage`, `shared()`, files or terminal labels. Keys reach a mod through `keys.json`. Lists are well supported. There is no tree or graph widget, but `PathBuilder` plus `window.paint_path` and absolute positioning are enough to draw one.

### Cited Findings
**Spawning a new terminal or agent pane**
- `run(name, args)` runs the same commands as keys and menus. — `~/.config/herdr-app/herdr.d.ts:44-79`; `~/.config/herdr-app/AGENTS.md:521-530`
- Spawn commands and their arguments:
  - `pane.split {direction: "right" | "down", pane?, argv? | mod?, props?}` (`~/.config/herdr-app/AGENTS.md:553-555`). `herdr-app commands` lists `direction` (required), `pane`, `argv`, `mod`, `props`, and **no `task` or `folder`**. The `herdr.d.ts` comment shows only `{direction, pane?}`, an abbreviation (`~/.config/herdr-app/herdr.d.ts:57`).
  - `tab.new {name?, space?, folder?, argv?, task?}` ("argv: an agent to run, task: its first message"), or `{mod, props}` for a mod-only tab. — `~/.config/herdr-app/AGENTS.md:541-548`; `~/.config/herdr-app/herdr.d.ts:53-54`
  - `space.new {name?, folder?, tab?, argv?, task?, machine?}`. — `~/.config/herdr-app/AGENTS.md:532-537`
  - `terminal.open {argv?, folder?, place: "tab"|"right"|"down", name?}`, with no `task` per `herdr-app commands`. — `~/.config/herdr-app/AGENTS.md:567-568`
- Agents run inside the user's interactive shell, which stays open after the agent exits. A nonzero exit within 2 s of launch shows an error toast. — `~/.config/herdr-app/AGENTS.md:542-545`
- From a shell: `herdr-app do tab.new --name "fix login" --argv '["claude"]' --task "..."`. `do` prints what it made (`{space, tab, terminal}` or `{pane, terminal}`) or `{error}`. — `~/.config/herdr-app/AGENTS.md:622-633`
- How shipped and installed mods launch agents:
  - `new-menu`: `run("tab.new", {name, space, argv: agent.run})`. — `~/.config/herdr-app/mods/new-menu/main.js:34, 60, 66`
  - `linear`: prefers the installed `claude` from `knownAgents()`, sets `spec.argv = agent.run` and `spec.task = res.prompt`, then calls `run("space.new", spec)`. — `~/.config/herdr-app/mods/linear/main.js:736-745`
  - `worktree`: `run("space.new", {folder, machine, tab, argv})`, with no task. — `~/.config/herdr-app/mods/worktree/main.js:192`
- `knownAgents()` returns each startable agent's `run` argv (`~/.config/herdr-app/herdr.d.ts:30-34`). `shared.json` caches `claude → ["claude"]` and a second account's wrapper (`claude-work → ["claude-work"]` in the examples) under `new-menu.agents` (`~/.config/herdr-app/shared.json`; `~/.config/herdr-app/programs.json`).
- Terminals started outside the app are adopted into a space or tab through labels: `hc run --keep --label herdr.space=<id> --label herdr.tab=<id> -- claude`. — `~/.config/herdr-app/AGENTS.md:136-149`
- `hc run` options: `--parent <t>`, `--no-parent`, `--no-notify`, `--outlive-parent`, `--label K=V`, `--keep`, `--bg`, `--name`, `--cwd`. — `hc run --help`
- Mods can call `hc(args)` (`~/.config/herdr-app/herdr.d.ts:15-16`) and `exec` ("30 s limit, 8 MiB output", `~/.config/herdr-app/herdr.d.ts:10-13`).
- Claude Code CLI flags (all from `claude --help`, v2.1.311):
  - Usage is `claude [options] [command] [prompt]`, so the first prompt can be a positional argument.
  - `-r, --resume [value]` resumes "by session ID or name".
  - `--fork-session`: "When resuming, create a new session ID instead of reusing the original (use with --resume or --continue)".
  - `--session-id <uuid>` uses a specific session ID.
  - `-n, --name` sets a display name "(shown in the prompt box, /resume picker, and terminal title)".
  - `-w, --worktree [name]` creates a new git worktree for the session.
- `claude --help` mentions no flag for forking at an earlier message (searches for "rewind", "session-at" and "checkpoint" found nothing).

**Reading the active pane's Claude Code session id**
- `focused()` returns `{space, tab, pane, terminal, shown, agent, cwd}`. — `~/.config/herdr-app/herdr.d.ts:219-227`
- `AgentInfo` has `address, pane, space, tab, status, app` (e.g. `"claude-code"`)`, program, title, seq, pinned, focused`. `PaneInfo` has `pane, terminal, mod, tab, title, cwd, branch, status, app, program, focused, zoomed, movable`. **Neither has a session id or transcript path.** — `~/.config/herdr-app/herdr.d.ts:157-203`
- `terminals()` returns "Every core terminal as `hc ls --json` describes it (address, argv, name, template, parent, labels, state, ...)" plus `status`, `report` and `program`. — `~/.config/herdr-app/herdr.d.ts:214-217`
- The herdr-core `Terminal` schema includes `parent`, `pid`, `foreground {pid, name, argv, cwd}` ("the foreground process group's leader"), `labels`, `records`, `reported` and `created_ms`. — `hc schema`. The hc manual says "JSON keeps `cwd` as the launch folder; `get` also includes the current folder in `foreground.cwd`", which suggests `foreground` may come only from `get`. — `hc --skill` lines 68-71
- Claude Code writes `~/.claude/sessions/<pid>.json`, for example `{"pid":4817,"sessionId":"88c36d53-…","cwd":"~/Projects/app","name":"linear herdr","status":"busy","kind":"interactive",…}`. — `~/.claude/sessions/4817.json` (observed; only live sessions were present, 2 files)
- `ps` shows `claude` pid 4817 is its own process-group leader (pgid 4817), and its parent is `zsh` 4278. So the terminal's `pid` is the shell, and `foreground.pid` would be Claude's pid. — `ps -o pid,pgid,ppid,comm`
- No shipped or installed mod or frame references session ids, transcripts, `.jsonl`, `--resume` or `fork`. A grep found only unrelated hits: win98 icons and linear's agent launch. — grep over `mods/**/*.js` and `frame/`

**Reacting to agent output and activity**
- `render(cx)` "runs again after `cx.notify()` and whenever Herdr's live data changes (spaces, agents, terminals, focus, theme, shared state). Don't poll those." — `~/.config/herdr-app/AGENTS.md:868-871`
- Status words are `working | blocked | done | idle` (`~/.config/herdr-app/herdr.d.ts:81`); hc adds `error`. A 7501 `Status` record carries `app`, `kind` (permission/question/auth), `msg`, `progress`, `state` and `title` (`hc schema`). Tabs expose `changed_at` and `working_since` (`~/.config/herdr-app/herdr.d.ts:103-108`).
- `hc read <t>` gives a terminal's text (`~/.config/herdr-app/AGENTS.md:974`). While the agent is working, blocked or in error, history reads return only the screen (`hc --skill` lines 73-76).
- `hc events` follows fact changes, filtered by `--terminal`, `--children-of` or `--label` (`hc events --help`). The `events.subscribe` event kinds are created, lost, restarted, keep, finished, removed, status, turn, title, labels, size and doc (`hc schema`).
- Limits on streaming from a mod:
  - `exec` stops after 30 s (`~/.config/herdr-app/herdr.d.ts:10`).
  - The mod `net.connect(host, port)` is TCP only (`~/.config/herdr-app/gpui-kit.d.ts:22140-22148`).
  - The core socket is a Unix socket (`HC_TERMINAL_SOCKET=~/.local/state/herdr-core/default/default.sock` in this session's env).
- `watchFolder(path)` resolves with changed paths and watches recursively on macOS (`~/.config/herdr-app/herdr.d.ts:404-414`; `~/.config/herdr-app/AGENTS.md:984-990`). `readTextFile` reads up to 1 MiB (`~/.config/herdr-app/herdr.d.ts:23-25`). `fs/promises` reads anywhere in home (`~/.config/herdr-app/AGENTS.md:998`; `~/.config/herdr-app/gpui-kit.d.ts:22127-22138`).
- `notify({title, body, level, action:{name,args}})` posts a toast that runs a command when clicked. — `~/.config/herdr-app/herdr.d.ts:370-379`

**Persistent per-mod and shared state**
- `localStorage` is per mod copy (`~/.config/herdr-app/AGENTS.md:997`). On disk it is `data/<mod>/store.json`: `data/agents/store.json` holds the `"changed"` key that `~/.config/herdr-app/mods/agents/main.js:82, 103` reads and writes.
- `shared(key)` / `setShared(key, value)` are "persisted", every mod sees them, and setting one re-renders all mods (`~/.config/herdr-app/herdr.d.ts:389-393`). They are stored in `shared.json` (`~/.config/herdr-app/AGENTS.md:86-90`). Observed keys: `layout`, `workspace.panels`, `space.colors`, `agents.sort`, `new-menu.agents`, `kolczyk.*`.
- `writeTextFile(path, text, expected)` does atomic compare-and-swap writes (`~/.config/herdr-app/herdr.d.ts:26-28`). `fs/promises` writes only under `~/.config/herdr-app` (`~/.config/herdr-app/AGENTS.md:998`).
- Terminal labels (`hc label <t> k=v`) persist on the terminal. Herdr itself stores pins as `herdr.pinned`, "gone when the terminal ends". — `~/.config/herdr-app/AGENTS.md:586-588`; `hc --help`
- herdr-core also offers `doc.get`/`doc.set`: an opaque versioned JSON document of up to 1 MiB that emits a `doc` event (`hc schema`). The app keeps its own layout in a core document (`~/.config/herdr-app/AGENTS.md:95-99`). `hc --help` lists no `doc` subcommand.

**Keyboard shortcuts**
- `keys.json` sections are `global`, `layout:<name>`, `terminal` and `mod:<name>`. Actions can be a command, `command:value`, `send:<text>`, `<mod>.<command>` (delivered to that mod's `nextCommand()`) or `terminal`. Object args are supported. — `~/.config/herdr-app/AGENTS.md:471-500`; `~/.config/herdr-app/herdr.d.ts:395-402`
- Live example: `"cmd-shift-u": "my-tabs.toggle-quota"` (`~/.config/herdr-app/keys.json:61`) is handled by a `nextCommand()` loop (`~/.config/herdr-app/mods/my-tabs/main.js:20-30`). `"cmd-p": "mod.open:picker"` and `"cmd-l": "mod.open:linear"` (`~/.config/herdr-app/keys.json:18, 60`) open a mod as the overlay its `mod.json` describes.
- `<mod>.<command>` "reaches shown copies only" (`~/.config/herdr-app/AGENTS.md:800`). `"focusable": true` lets `pane.go` give a mod the keyboard; it then uses `track_focus`/`on_key_down` (`~/.config/herdr-app/AGENTS.md:781-785, 912-913`).

**Drawing a list, tree or graph**
- Rendering is GPUI only: no HTML, CSS, web view or `setTimeout`, and nothing drawn outside the mod's block except through overlays. — `~/.config/herdr-app/AGENTS.md:35-47`
- Available widgets (`~/.config/herdr-app/gpui-kit.d.ts`):
  - lists: `list` (lazy, variable-height rows, 20297-20345), `uniform_list` (20359), `v_virtual_list`/`h_virtual_list` (21276/21285);
  - structure: `Accordion` (20798-20853), `Collapsible` (21054), `Table` (20980-20996), `Tabs`/`Tab` (20716-20718), `h_resizable`/`v_resizable`/`resizable_panel` (21023-21042);
  - popups: `Popover`/`HoverCard`/`Popup` (21072/21081/21106);
  - content: `TextView` (markdown; 20701-20707, `~/.config/herdr-app/AGENTS.md:921`), `Editor` (21430-21459), `Input`/`Textarea` (21330-21427);
  - utilities: `crypto.randomUUID` (22080).
- Vector drawing: `PathBuilder.fill()` / `PathBuilder.stroke(width)` with `move_to`, `line_to`, `curve_to`, `cubic_bezier_to`, `arc_to` and `dash_array` (`~/.config/herdr-app/gpui-kit.d.ts:20366-20382`), painted by `window.paint_path(path, background)` (`~/.config/herdr-app/gpui-kit.d.ts:20464-20473`). Installed mods already use it with `fill()`: `~/.config/herdr-app/mods/win98/kit.js:190-199` and `~/.config/herdr-app/mods/kolczyk/controls.js:29-71`.
- "tree" and "tree_grid" appear only as accessibility role names (`~/.config/herdr-app/gpui-kit.d.ts:206-207`). The grep found no tree widget export.
- The `agents` mod draws a tree from plain `div` rows: border-left and border-bottom connector segments, with a recursive `tree()` over `terminals()[].parent`. — `~/.config/herdr-app/mods/agents/main.js:174-184, 204-206`
- Absolute positioning works: the picker places rows with `.absolute().left(0).right(0).top(y)`. — `~/.config/herdr-app/mods/picker/main.js:139-143`
- "Every redraw of a mod redraws the whole window". Animate natively with `.frames`, `.spin`, `.loop` and `.transition`, not timers. — `~/.config/herdr-app/AGENTS.md:893-902`

### Inferences
- **Fork-launch recipe** (each piece is documented; the combination is untested): `run("pane.split", {direction: "right", pane: focused().pane, argv: ["claude", "--resume", sid, "--fork-session", "-n", label, prompt]})`. The prompt must go in `argv` as Claude's positional prompt, because `pane.split` has no `task`. `tab.new`/`space.new` could pass the prompt as `task` instead.
- **Session-id resolution chain:** `focused().terminal` → `terminals()` entry → `foreground.pid` (or `hc(["get", addr, "--json"])`) → `readTextFile(home() + "/.claude/sessions/" + pid + ".json").sessionId`. Each link was observed separately; the whole chain is unconfirmed.
- **Pre-assigning the child's id:** pass `--session-id <crypto.randomUUID()>` together with `--resume … --fork-session`, so the lineage can be recorded before launch. Whether Claude accepts that combination is unconfirmed.
- **Transcript tracking:** watch `~/.claude/projects/<cwd-slug>/` with `watchFolder` to react to new turns. Read large transcripts through `exec("tail", …)` or `fs/promises`, because `readTextFile` stops at 1 MiB.

### Gaps
- Whether `terminals()` in the mod runtime includes `foreground`, or only `pid` (the shell). Unconfirmed; `hc get` was not run because of the read-only constraint.
- Whether `--session-id` combines with `--resume --fork-session`, and whether `--resume <id>` finds a session started from a different cwd (Claude stores transcripts per project folder). Both are unconfirmed.
- Whether `~/.claude/sessions/<pid>.json` is a stable or documented Claude Code interface. It is an undocumented internal file; unconfirmed.
- Whether a mod can use herdr-core's `doc.get`/`doc.set` (no `hc doc` CLI exists, and the mod API has no direct call). Unconfirmed.
- Whether `PathBuilder.stroke()` (as opposed to `fill()`) renders correctly in Herdr's runtime. It is in the types but no installed mod uses it; unconfirmed.

## Q3. What do the shipped mods do, and which are closest to a branch-launcher or branch-navigator?

### Takeaway
None of the shipped mods is a conversation-branch tool. The closest **navigator** is `agents`, which already draws a parent→child tree of terminals, opens a child in a peek on click, and works with `peek` to promote a child into a pane. The closest **launchers** are the `pane` header (a per-pane button strip that knows its pane and terminal), `new-menu` and `linear` (launch an agent with `argv`/`task`), and `worktree` (launch an agent in a new git checkout and space).

### Cited Findings
- **`pane`** (`mod.json`: `{"place":"none","title":"Pane header"}`):
  - It is the header drawn on every pane: program icon, agent or terminal name, folder, and status (spinner, "Needs you", done dot).
  - On hover it shows split right, split down, zoom and close buttons, each running a command with the pane's own id.
  - Reads its own pane through `panes().find(p => p.pane === props().pane)`.
  - Used by both `custom` and `main` (`~/.config/herdr-app/layouts/custom.json:99-106`).

  — `~/.config/herdr-app/mods/pane/main.js:1-5, 25-27, 29-41, 47, 66-73`
- **`peek`**:
  - It is the bar on top of a peeked terminal overlay, which the agents list opens for a sub-agent.
  - It shows status, name and "from <parent>".
  - "↗ go to" runs `pane.focus`, or "↗ keep" runs `terminal.keep` to give the terminal a pane. ✕ closes.

  — `~/.config/herdr-app/mods/peek/main.js:1-4, 50, 66, 68-74`
- **`agents`**:
  - Views are "grouped" or "priority", and "parents take their most urgent sub-agent's place".
  - `tree(all, addr)` lists live sub-agents depth-first, with connector-line prefixes. Clicking a sub-row runs `terminal.peek`; clicking an agent row runs `pane.focus`.
  - Groups and parents fold; agents can be pinned.
  - It calls `setAgentOrder` so that `agent.next`/`prev` follow the list.
  - The sort menu is a self-opened popup of the same mod (`props: {sortMenu: true}`).
  - Per-agent change times are kept in `localStorage`.
  - A sub-agent without a pane is "never done": its status maps done→idle and error→blocked.

  — `~/.config/herdr-app/mods/agents/main.js:1-2, 49-54, 77-87, 170-184, 186-210, 237-250, 252-276, 351, 433`
- **`worktree`**:
  - A dialog with props `{space, action: "new"|"open"|"remove"}` or `{folder, machine}`, plus optional `{branch, tab, argv}`.
  - It creates `~/.herdr/worktrees/<repo>/<branch>` with `git worktree add`, then calls `run("space.new", {folder, machine, tab, argv})`.
  - When `branch` is passed it does the work at once, without waiting for input.
  - "Open" lists checkouts and jumps to the space that already shows one. "Remove" closes the space, then runs `git worktree remove`.

  — `~/.config/herdr-app/mods/worktree/main.js:1-2, 16, 30-44, 151, 182-194, 201-207, 209-226`; `~/.config/herdr-app/AGENTS.md:808-818`
- **`tabs` / `my-tabs`**:
  - The tab bar draws each tab as a pill with a program icon and status. Tabs can be dragged to reorder and double-clicked to rename; right-click opens the `menu` popup.
  - "+" opens the `new-menu` popup.
  - Files and Changes panel buttons select the `panel-body` stack child and show or hide `panel`; the choice is remembered per space in `localStorage`.
  - `my-tabs` is Jesse's clone. It adds a Quota button and a `nextCommand()` handler for `toggle-quota` (a `diff` against `tabs` shows only these changes).

  — `~/.config/herdr-app/mods/my-tabs/main.js:14-31, 33-65, 74-92, 99-121`
- **`picker`** (`mod.json` overlay: popup at top, 640 px × 0.8):
  - A "Go to…" list of spaces and tabs. Spaces with an agent that needs you come first, and quiet spaces fold into "earlier".
  - Each tab row shows its agents and a recursive sub-agent "team" count, computed by walking `terminals()[].parent`.
  - Type to filter, ↑/↓/Enter to go, ctrl+d to close a tab. The last rows create a new tab or space.

  — `~/.config/herdr-app/mods/picker/main.js:1-5, 63-99, 101-107, 125-143, 227-240`
- **`prompt`**: "A text prompt. Enter saves, Esc cancels." On submit it runs `props.command.name` with `{...props.command.args, name: <text>}`. — `~/.config/herdr-app/mods/prompt/main.js:1, 21-25`
- **`workspace-status`**: the status bar, showing the machine, the active space's branch, the agent count, the "needs you" count and a palette hint. — `~/.config/herdr-app/mods/workspace-status/main.js:17-30`
- Related mods outside the list:
  - **`menu`**: the terminal right-click menu. Items are Split right/down, Zoom, right-click routing, Close, and "Send back to <parent>" (`terminal.park`) for a kept sub-agent (`~/.config/herdr-app/mods/menu/main.js:24-49, 104-110`). A layout root `terminal_menu` replaces the whole menu, not individual items (`~/.config/herdr-app/AGENTS.md:262-289`).
  - **`new-menu`**: launches agents from `knownAgents()` (`~/.config/herdr-app/mods/new-menu/main.js:34, 60, 66`).
  - **`spaces`**: nests worktree spaces under their checkout (`~/.config/herdr-app/mods/spaces/main.js:1-2`). The custom layout replaces it with `kolczyk` (`~/.config/herdr-app/layouts/custom.json:29-38`).

### Inferences
- **Branch-navigator starting point:** clone `agents`. Its tree rendering, fold/peek/focus behavior and `setAgentOrder` integration map directly onto a branch tree, if branches are modeled as child terminals or the tree is fed from a lineage map.
- **Branch-launcher starting point:** clone `pane` into `my-pane` and add a "⑂ branch" button next to split right. The button already has `props().pane`/`props().terminal`, so it can resolve the session and run `pane.split` with a fork `argv`. Then point `custom.json`'s pane `header.content.mod` at `my-pane`.
- **Promote and demote:** `peek`'s keep/go-to and `menu`'s "Send back to <parent>" already give a branch these two moves (sub-agent → pane, and back).
- **Prompt input:** `prompt` passes its text only as a `name` argument, and `nextCommand()` returns a bare string (`~/.config/herdr-app/herdr.d.ts:402`). A branch launcher therefore needs its own input dialog (`InputState`/`Input`, as in `prompt` or `worktree`) rather than reusing `prompt`.

### Gaps
- Whether `kolczyk` nests worktree spaces the way `spaces` does was not checked.

## Q4. Does Herdr know about Claude Code session ids or transcripts? Is there any notion of "child session of this session"?

### Takeaway
No. Herdr's model is spaces, tabs, panes and terminals. For an agent it knows the 7501 status, the `app` name, the terminal title and the hc terminal `parent`. Nothing in the API or the shipped mods refers to a Claude session id or a `~/.claude/projects/*.jsonl` transcript. The only "child" concept is **terminal lineage**: a sub-agent is a terminal another terminal started with `hc run`. The Claude hooks in `~/.claude/settings.json` that say "installed by herdr" do not forward `session_id`, and they are inert in this environment.

### Cited Findings
- `AgentInfo` and `PaneInfo` have no session or transcript field. — `~/.config/herdr-app/herdr.d.ts:157-203`
- "Agents are terminals whose program reports a status (OSC 7501)". — `~/.config/herdr-app/AGENTS.md:150-153`; `hc --skill` lines 199-201
- Sub-agents are terminals an agent started with `hc run`. The core records the starter as `parent`. Sub-agents "belong to their parent's tab without a pane". The `agents` mod shows them, `terminal.peek` opens one and `terminal.keep` gives one a pane. Ctrl/Cmd-clicking a terminal address in terminal text peeks at it. — `~/.config/herdr-app/AGENTS.md:154-160`
- "Terminals you start are your children. They end when you end, unless started with `--outlive-parent`." — `hc --skill` lines 10-11. `--parent <t>` / `--no-parent` override the parent. — `hc run --help`
- hc types notes and `<hc from="t7 review">…</hc>` reports into the parent agent's input. `--no-notify` or `notes = false` turns this off. — `hc --help`; `hc --skill` lines 103-119
- `~/.claude/hooks/herdr-agent-state.sh`:
  - Its header reads "installed by herdr", `HERDR_INTEGRATION_ID=claude`, `HERDR_INTEGRATION_VERSION=3` (lines 1-5).
  - It exits unless `HERDR_ENV=1`, `HERDR_SOCKET_PATH` and `HERDR_PANE_ID` are all set (lines 19-21).
  - It reads `hook_event_name` and `agent_id` from the hook input (lines 50-51).
  - It sends only `pane.report_agent {pane_id, source, agent: "claude", state, seq}` or `pane.release_agent` (lines 63-85), so `session_id` and `transcript_path` are not forwarded.
  - It is wired to PermissionRequest, PreToolUse, SessionEnd, Stop and UserPromptSubmit (`~/.claude/settings.json` lines 15, 27, 39, 51, 63).

  — `~/.claude/hooks/herdr-agent-state.sh`
- This Claude session runs inside Herdr terminal `t3` (`HC_TERMINAL_ID=t3`). Its environment has `HC_SCOPE`, `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET`, and **no** `HERDR_ENV`/`HERDR_SOCKET_PATH`/`HERDR_PANE_ID`. No `herdr` binary is on PATH (`which`). The hc manual notes hc "is not `herdr`, the older terminal multiplexer" (`hc --skill` lines 3-4).
- Herdr still tracks this session's status: `data/agents/store.json` records `"t3":{"s":"working",…}`. So status reaches Herdr by some route other than that hook. — `~/.config/herdr-app/data/agents/store.json`
- On the Claude side, `~/.claude/sessions/<pid>.json` maps a pid to its `sessionId` (observed). Transcripts at `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` carry `uuid`, `parentUuid`, `leafUuid`, `isSidechain` and `sessionId`. A scan of 60 local transcripts found no fork-origin key; the only "fork"-named key was `forkSourceRepositoryId`, whose meaning was not checked. — python key scan and grep over `~/.claude/projects/*/*.jsonl`
- In the shipped mods, the only "parent" features are terminal-level: the agents tree, the picker's "team" count, peek's "from <parent>" and the menu's "Send back to <parent>". — `~/.config/herdr-app/mods/agents/main.js:174-184`; `~/.config/herdr-app/mods/picker/main.js:67-72`; `~/.config/herdr-app/mods/peek/main.js:50, 66`; `~/.config/herdr-app/mods/menu/main.js:29-32, 46`

### Inferences
- A branching UI has to keep its own lineage map (child sessionId → parent sessionId, fork point, label, prompt, terminal address, cwd). Herdr can supply live status and placement for the terminal running each session, but it does not know the conversation graph.
- Launching a branch with `hc run --parent <source terminal>` would make Herdr's existing sub-agent features treat it as a child for free. The lineage would then be terminal-level, not session-level.

### Gaps
- How Claude Code's status actually reaches herdr-core (Claude emitting OSC 7501 natively, or herdr-core detecting it) could not be determined from the files. Unconfirmed.
- Whether a `--fork-session` transcript records its origin session is outside this scope; the claude_fork_features notes cover it.

## Q5. What does AGENTS.md say about adding community mods, and about `herdr-app check` and `herdr-app shot`?

### Takeaway
Community layouts and mods come from herdr.dev or GitHub and ship with a `RECIPE.md` brief. The manual prescribes the install steps: read everything first, disclose network, exec or out-of-folder file access, never overwrite a name, merge keys, and `herdr-app check` each mod. `check` is the required gate before a mod counts as done. `shot` saves the last rendered window frame as a PNG for visual debugging.

### Cited Findings
- `check`:
  - `herdr-app check <mod folder>` "loads a mod once and checks its initial description and eager native elements, including virtual lists and motion. It does not lay out the mod or run deferred rows, nested renders, or later async states. Never call a mod done without a passing check; also try it in the app." — `~/.config/herdr-app/AGENTS.md:54-58`
  - "Loads the mod, renders it once, exits nonzero with the exact error. Run it after every change." — `~/.config/herdr-app/AGENTS.md:821-828`
  - `herdr-app --help` lists it as "load a mod once and report what's wrong".
- `shot`: `herdr-app shot [file.png]` "saves the last rendered window frame as a PNG and prints its absolute path". It is meant for debugging mod UIs (spacing, colors, overlays, popups, floats). It captures the app at physical pixel size even when the window is covered or minimized, needs no screen-recording permission, and requires Herdr to be running. — `~/.config/herdr-app/AGENTS.md:63-72`; `herdr-app --help`
- Other safety nets:
  - An invalid file keeps the last good version, and the reason goes to `<name>.error`. — `~/.config/herdr-app/AGENTS.md:51-53`
  - A broken mod save keeps the old build running and shows in `herdr-app status`. — `~/.config/herdr-app/AGENTS.md:791-794`
  - `ctrl-alt-shift-escape` resets to the `main` layout and sets keys aside. — `~/.config/herdr-app/AGENTS.md:59-61`
- Community install procedure:
  1. Read the recipe and every file, and tell the person if the mod reaches the network, runs programs (`exec`, `hc`) or reads files outside its folder.
  2. Copy the layout to `layouts/` and the mods to `mods/`, without the recipe or preview. Never overwrite: rename on any clash.
  3. Adapt only where assumptions fail.
  4. Merge the mod's `keys.json`, asking before replacing a key the person uses.
  5. `herdr-app check` each mod; for a layout, then `layout.switch`.

  — `~/.config/herdr-app/AGENTS.md:416-442`
- Sharing: put the folder in a public GitHub repo with a `RECIPE.md` and `preview.png`, and add the topic `herdr-mod` or `herdr-layout`. It appears at herdr.dev within the hour. `RECIPE.md` sections: What you see, How it behaves, Built from, Watch out, Done when. — `~/.config/herdr-app/AGENTS.md:444-469`
- Rules for editing shipped files:
  - Shipped mods and layouts are replaced on every start. Clone them (`mod.clone`, `layout.clone`) before editing.
  - An edited shipped file is moved to `<name>-edited`.
  - Clones keep their mod references; point `content.mod` at a cloned mod to change its code.

  — `~/.config/herdr-app/AGENTS.md:183-208`
- "One mod per idea." Don't edit `AGENTS.md` or the `.d.ts` files. "Mods are trusted code: commands and network access … are unrestricted." — `~/.config/herdr-app/AGENTS.md:996, 1017-1019`

### Inferences
- A branch mod built here should follow the clone-first rule. Leave `pane` and `agents` untouched; create `my-pane`, `branches` and so on, and repoint `custom.json`.
- It should ship a `RECIPE.md` if it is to be shared.
- Because it would run `exec`/`hc` and read `~/.claude`, the disclosure step applies to it.

### Gaps
- None for this question.

## Q6. Design sketches: a "branch this thought" UI in Herdr, built from the primitives above

### Takeaway
Three designs are realistic. They range from almost no UI code to a full graph view. **(A)** Branches as hc sub-agents, so the shipped agents sidebar becomes the branch tree. **(B)** A Branches panel in the existing right-hand stack, plus a branch button in the pane header. **(C)** A floating branch-map window that draws a session DAG. All three share one launch recipe (Claude `--resume <sid> --fork-session` in `argv`) and one weak link: Herdr has no session ids, so a mod must resolve pid → session through Claude Code's undocumented `~/.claude/sessions/<pid>.json` and keep its own lineage map.

### Cited Findings
- The shared building blocks are cited in Q1-Q4:
  - spawn commands with `argv` (`~/.config/herdr-app/AGENTS.md:532-568`);
  - Claude's `--resume`, `--fork-session`, `--session-id`, `-n` and positional prompt (`claude --help`);
  - `focused()`/`terminals()` (`~/.config/herdr-app/herdr.d.ts:214-227`);
  - `hc run --parent/--outlive-parent/--no-notify/--label` (`hc run --help`);
  - the agents-mod tree (`~/.config/herdr-app/mods/agents/main.js:174-210`);
  - the right-hand `panel-body` stack (`~/.config/herdr-app/layouts/custom.json:122-161`);
  - pane header mods (`~/.config/herdr-app/AGENTS.md:355-361`);
  - overlay windows with `key`/`keep`/`layout` (`~/.config/herdr-app/herdr.d.ts:332-368`);
  - `PathBuilder` + `window.paint_path` (`~/.config/herdr-app/gpui-kit.d.ts:20366-20382, 20473`);
  - `shared`/`localStorage` persistence (`~/.config/herdr-app/herdr.d.ts:389-393`; `~/.config/herdr-app/AGENTS.md:997`).
- Windows: "A layout switch closes windows; kept ones come back with their layout." — `~/.config/herdr-app/AGENTS.md:961-967`
- Drawing limits: a mod can't draw outside its block except through overlays (`~/.config/herdr-app/AGENTS.md:35-37`), and every mod redraw redraws the whole window (`~/.config/herdr-app/AGENTS.md:893-895`).

### Inferences
**Common building blocks** (inferred; not tested)
1. *Resolve the current session:* `focused().terminal` → `terminals()` entry → `foreground.pid` (fallback `hc(["get", t, "--json"])`) → `~/.claude/sessions/<pid>.json` → `sessionId`, `cwd`, `name`.
2. *Launch a fork:* argv `["claude", "--resume", sid, "--fork-session", "-n", label, prompt]`. The `-n` label shows up as the terminal title, so it appears as `AgentInfo.title` and in the pane header with no extra work. Optionally add `--session-id <randomUUID>` (unconfirmed compatibility) so the child id is known before launch.
3. *Record lineage:* `setShared("branches", {[childSid]: {parent: sid, label, prompt, terminal, cwd, at}})`. Keep it in `shared` rather than `localStorage`, so the agents tree, header and panel can all read it. Optionally mirror the parent on the terminal as labels (`hc label t branch.parent=<sid>`), knowing labels die with the terminal.

**Option A: branches as hc sub-agents (the shipped agents sidebar is the tree)**
- *Built from:*
  - A tiny key-bound mod (`keys.json`: `"cmd-shift-b": "branch.fork"`, handled by a `nextCommand()` loop), or a button in a cloned pane header.
  - The launch: `hc(["run", "--bg", "--parent", <source terminal>, "--outlive-parent", "--no-notify", "--name", "br-…", "--cwd", cwd, "--label", "branch.parent=<sid>", "--", "claude", "--resume", sid, "--fork-session", "-n", label, prompt])`.
  - The shipped `agents` mod then shows the fork nested under the source agent, with connector lines and fold. Click peeks the fork (the `peek` bar shows "from <parent>"). "↗ keep" promotes it to a pane; "Send back to <parent>" demotes it again. `agent.focus` and `agent.next` navigate.
- *Strengths:* almost no UI code; uses Herdr's existing parent/child, peek, keep and park semantics; nested branches work because `tree()` is recursive.
- *Limitations:*
  - Lineage is per terminal, not per session. A branch resumed later in a new terminal loses its parent.
  - `tree()` shows only `state === "live"` children, so finished branches disappear.
  - A pane-less sub-agent's status is folded into its parent's urgency, and done is shown as idle.
  - Without `--outlive-parent`, closing the source kills its branches.
  - Without `--no-notify`, hc types notes into the **parent Claude session's input**.
  - Running `hc run` from a mod has no `HC_TERMINAL_ID`, so `--parent` must be passed explicitly. How adoption interacts with `herdr.space`/`herdr.tab` labels is unconfirmed.
  - The fork prompt must ride in `argv` (Claude's positional prompt). `hc` template launches could deliver it as a first message with readiness checks instead (`hc --skill` lines 48-55).

**Option B: a Branches panel in the right-hand stack, plus a pane-header launcher**
- *Built from:*
  - The panel:
    - A new `branches` block added to `panel-body` in `custom.json`, toggled by a new button in `my-tabs` (copying the quota pattern) or a `my-tabs.toggle-branches` key.
    - The panel follows `focused()` and shows the focused agent's session as a tree: ancestors above, siblings and children below. Rows reuse the agents-mod connector technique (`v_flex` rows with `border_l`/`border_b` segments), and live status comes from `agents()` by terminal address.
    - Clicking a row runs `pane.focus`/`tab.select` if the branch has a live terminal. Otherwise it offers "reopen" (`tab.new {argv: ["claude", "--resume", sid]}`).
    - Hover or select shows a preview: the session's last assistant message, read by tailing its `.jsonl`, rendered with `TextView.markdown`.
  - The launcher:
    - A cloned header, `my-pane`, adds a "⑂" button next to split. It opens a small input dialog (`openOverlay({mod: "branches", kind: "dialog", props: {pane, terminal}})`, using an `InputState`/`Input` like `prompt`).
    - Submitting runs `pane.split {direction: "right", pane, argv: [...fork argv...]}`, so the fork appears beside its parent. Alternatives: `tab.new {name: label, argv, task: prompt}`, or the `worktree` dialog with `{space, branch, argv}` to give the fork its own checkout and space.
  - Lineage lives in `shared("branches")`.
  - `watchFolder` on the project's transcript folder refreshes previews without timers.
- *Strengths:* lineage is per session, so it survives terminal exits; one visible place for "which thought am I in"; splits make side-by-side comparison of the parent and the fork trivial.
- *Limitations:*
  - Forks only from the end of a session. No CLI flag forks at an earlier message, so "branch from this message" would need a transcript-rewriting hack (unsupported and risky).
  - Session resolution relies on undocumented Claude files.
  - `readTextFile` stops at 1 MiB, so large transcripts need `exec`.
  - A stack shows one child at a time, so the panel competes with Files, Changes and Quota, and `my-tabs`' per-space panel memory needs extending.
  - `<mod>.<command>` keys reach only shown copies.
  - The worktree variant may break `--resume`, because Claude keys transcripts by project folder (unconfirmed).

**Option C: a branch-map window (graph view)**
- *Built from:*
  - The window: `openOverlay({mod: "branch-map", kind: "window", key: "branch-map", keep: true, width: 0.5, height: 0.6})`, opened by `mod.open:branch-map` on a key. Alternatively, a `floating` block with `peek` on the right edge of `work-body`, as a hover drawer.
  - The graph: the mod lays out the lineage DAG itself (simple layered layout) and draws node cards as absolutely positioned `div`s (picker pattern). Edges are `PathBuilder.stroke(1.5)` cubic béziers painted with `window.paint_path` (stroke use is unconfirmed; `fill` is proven), with dashed edges via `dash_array` for finished branches. Status colors come from `theme().working`/`blocked`/`done`/`idle`, and spinners use `.spin(900)` rather than timers.
  - Interaction: click focuses, peeks or reopens. A selected live node can be previewed inside the same window by switching the overlay to a `layout` with a `{terminal: tX}` block (as in `~/.config/herdr-app/AGENTS.md:968-970`).
- *Strengths:* the most faithful "tree of thoughts" picture, and it floats over any layout.
- *Limitations:*
  - No graph or tree widget exists, so layout, hit-testing and scrolling are hand-built.
  - Every redraw redraws the whole window, so updates must be event-driven, not animated by timers.
  - A layout switch closes the window (a kept window comes back with its layout).
  - It inherits B's dependencies: session resolution, lineage store and transcript reads.
  - Its effort is clearly the highest of the three.

**Suggested path (inference):** build A first, because it validates the launch recipe and the session-resolution chain with minimal code. Then add B's lineage store and panel. Treat C as a later view over the same `shared("branches")` data.

### Gaps
- None of the launch recipes were executed, because the task was read-only. Unconfirmed points:
  - `pane.split` with a multi-argument Claude `argv` and positional prompt;
  - `hc run --parent` from a mod context;
  - whether `--session-id` is accepted together with `--fork-session`;
  - `--resume` across cwds.
- Whether `PathBuilder.stroke` renders, and how a `kind: "window"` overlay with `layout` behaves when its terminal ends ("Closes itself when its terminal ends", `~/.config/herdr-app/herdr.d.ts:337-338`), would need `herdr-app check` and an in-app trial.
