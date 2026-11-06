# Publishing a Herdr mod: what the manual requires

Source: the canonical Herdr manual, `defaults/AGENTS.md` on the `master` branch of
`herdrdev/herdr-app` (fetched 2026-11-06), compared with the copy this machine's Herdr wrote,
`~/.config/herdr-app/AGENTS.md` (the 0.1.12 text; the app here reports 0.1.13). Section names below
are the manual's headings. Everything here is what the manual says; where it says nothing, this file
says so instead of guessing.

## 1. The shape of a shared mod

From **Layouts and mods other people made**:

- Shared items are listed at `herdr.dev/layouts` and `herdr.dev/mods`. Each is "a folder laid out
  like this home". A layout has `layouts/<name>.json` plus the `mods/<name>/` it needs. A mod "is a
  piece for the person's own window, so it has only `mods/<name>/` and maybe a `keys.json` with the
  keys it expects".
- Both have a `RECIPE.md` ("the brief to build it from scratch") and a `preview.png`. "The files are
  one build of the recipe."
- To share: "put that folder in a public GitHub repo (one folder each if there are several), write
  its `RECIPE.md`, save a screenshot of it as `preview.png` and add the repo topic `herdr-layout` for
  a layout or `herdr-mod` for a mod. It shows up at herdr.dev/layouts or herdr.dev/mods within the
  hour." That is the whole registry: no manifest, no submission, no version field.
- People ask an agent to add one by `herdr.dev/mods/<owner>/<name>` or a folder on GitHub.

## 2. What the installing agent does (and so what the files must survive)

From **Layouts and mods other people made**, steps 1 to 5:

1. Read the recipe and every file before writing anything. Before adding, tell the person if a mod
   reaches the network, runs programs (`exec`, `hc`) or reads files outside its own folder.
2. Copy each mod folder to `mods/` (and a layout file to `layouts/`). Leave the recipe and preview out.
   Never overwrite: if a name is taken (the person's or Herdr's), rename the new one: its folder, the
   `mod` names in the layout, and the mod's own `mods/<name>/` paths.
3. Adapt only where the files' assumptions do not hold (a missing program, a name clash) or the
   person asks. If the files do not work on this version, build from the recipe instead.
4. A mod's `keys.json`: merge it into the person's. Add its sections and keys, and ask before
   replacing a key they already use.
5. `herdr-app check` each mod (for a layout, then `layout.switch {name}`). The person's own layout
   stays as it was; deleting the files removes it.

Consequences for the files: the recipe and preview sit beside `mods/`, not inside a mod folder;
every asset path inside a mod is `mods/<name>/...` so a rename can rewrite it; nothing may depend on
a mod name other than its own except shipped mods.

## 3. RECIPE.md

From **Layouts and mods other people made** ("A `RECIPE.md` is a brief"): another agent with an
empty folder builds the mod from it. Written from the real files, in this order:

1. `# Name`, one paragraph of what the person sees, `![Name](preview.png)`.
2. **What you see:** the regions top to bottom or left to right, their sizes, colors and type; what
   each shows.
3. **How it behaves:** every agent status (working, blocked, done, idle) and how it looks; what
   clicks, keys and hovers do; what moves.
4. **Built from:** the layout's node tree and blocks, each mod and its `props` roles, the shipped mods
   it uses, the `herdr` functions and commands it calls, any programs it runs, its art.
5. **Watch out:** what tripped the build up and what a fresh build would get wrong; limits (sizes,
   counts); controls that do nothing yet; what it assumes about the setup.
6. **Done when:** checks that prove a build works, each one something the build really does.

"The person and what they see come first; code only in Built from and Watch out. Exact over vague
(`#ab7748`, 29px, `agent.focus`), and nothing the build doesn't do."

## 4. mod.json

From **Mods: `mods/<name>/`**: `main.js` is required; `mod.json` says where the mod first appears:
`{ "place": "right" | "left" | "top" | "bottom" | "none", "size": 320 }`. Also documented:
`"focusable": true` (for `pane.go`), and an `overlay` object whose width and height a popup uses
(**Layouts**, the personal terminal menu example). Shipped mods carry `title`, and `mod.clone` writes
`cloned_from: {name, version}` (**Layouts**).

The manual defines no `name`, `version`, `description`, `keys` or `requires` field. The folder name
is the mod's name; keys travel in a separate `keys.json`; requirements are for the recipe to state.
ledgr adds `version` and `description` to its own `mod.json` as plain extra fields (`herdr-app check`
accepts them); nothing in Herdr reads them.

Behaviour that a shared mod must design around (same section): the first time Herdr sees a folder it
docks one copy per `mod.json` (`"none"`: only where a layout or another mod puts it); "a copy starts
the first time it shows, then stays alive while its block is in the layout, shown or not"; saving any
file reloads every copy; `<mod>.<command>` reaches shown copies only.

## 5. Disclosure

From **Layouts and mods other people made** step 1, and **The `herdr` module**: "Mods are trusted
code: commands and network access (including `fetch`) are unrestricted", and
`fs/promises` reads in the home and writes under `~/.config/herdr-app`. So the manual asks for
disclosure, not permission: the installing agent must tell the person about network use, programs
run through `exec` or `hc`, and files read outside the mod's folder. The manual names no format; the
recipe is where the installing agent reads it.

## 6. Names

The manual has no naming rule beyond collisions: a taken name is renamed on install (step 2); clones
default to `<name>-copy` and an existing name is refused (**Layouts**). Shipped mod names to avoid
(this install's `installed.json`): agents, changes, confirm, files, help, machine-add, menu,
new-menu, pane, peek, picker, prompt, spaces, tabs, terminals-bar, terminals-pane, toast, win98,
workspace-chrome, workspace-status, worktree. Whether `ledgr` is free on herdr.dev/mods cannot be
read from the manual.

## 7. Layouts and keys

- **Layouts: `layouts/<name>.json`**: Herdr's own layouts and mods are read-only and replaced on every
  start. To change a shipped layout's structure, clone it (`layout.clone {name, as}`; it switches to
  the clone) and edit the clone. Editing a shipped file anyway moves it to `<name>-edited` on the
  next start. Clicks live in `layouts/.state/` ("Don't edit those files").
- **Keys: `keys.json`**: sections `global`, `layout:<name>`, `terminal`, `mod:<name>`; the more specific
  section wins (`terminal` over `global`). Any edit makes the whole file the person's. Do not pick
  plain ctrl+letters programs rely on, and on macOS option+letters type characters.

## 8. Checks and versions

- **Check before you finish** and **Changing things safely**: `herdr-app check <mod folder>` loads the
  mod, renders it once and exits nonzero with the error; it does not lay out the mod or run deferred
  work, so also try it in the app. "Never call a mod done without a passing check."
- Versions: nothing beyond `cloned_from {name, version}` on clones. The manual describes no version
  scheme, changelog or compatibility field for shared mods.

## 9. The local 0.1.12 copy against master

Five differences, none about sharing:

| Section | master adds |
|---|---|
| **The files** | "`herdr-app check` uses empty shared state in memory and leaves this file untouched." |
| **The model** | new spaces, tabs and splits retry in the machine's home when an inherited folder fails |
| **Layouts** (terminal menu) | a terminal outside a tab has no pane: leave pane items out there |
| **The person** | the app's toasts use the same agent names |
| **The `herdr` module** | `focused()` for a terminal in a window; `exec(..., { timeout })`, default 30 s, cap 10 min |

The first matters to ledgr: on this machine (Herdr 0.1.13), `herdr-app check` of a copy that called
`setShared` did change the running window's shared state (2026-11-06: a check of the host view left
a writer claim nobody held). ledgr now refuses to claim or ping when it cannot read the home's
`AGENTS.md`, which check forbids (`config.js` `liveHome`).

## 10. Checklist for ledgr

| | Requirement (section) | ledgr |
|---|---|---|
| ☑ | Repo root laid out like a Herdr home: `mods/<name>/` and `keys.json` (Layouts and mods other people made) | `mods/ledgr/`, `mods/ledgr-pane/` (optional), `keys.json` |
| ☑ | `RECIPE.md` beside the mods, six parts in order, person first, code only in Built from and Watch out (same) | `RECIPE.md`; the six parts are in order, with the disclosure as an extra section between part 1 and What you see (it carries commands and paths, so the owner may prefer it after Done when) |
| ☑ | `preview.png`, a screenshot (same) | taken 2026-11-06 in authoritative mode from a real throwaway Claude Code session (`docs/preview-recipe.md`); retake with the same steps when the panel changes |
| ☑ | Disclosure of network, `exec`/`hc`, files outside the folder (step 1; The `herdr` module) | RECIPE "Before you add it", README "What this mod touches": hooks and MCP registration in the chosen Claude config folders, the one provider call, programs run, Keychain, clipboard, the one paste into a confirmed-focused prompt (`terminal.paste`, never Enter), no keystrokes |
| ☑ | Works on its own: no dependency on the owner's personal mods (step 3) | host block inside `ledgr`; `my-tabs` moved to `examples/personal-overlay/`; the owner uses the public `ledgr-pane` (his `my-pane` clone is gone) |
| ☑ | Asset paths are `mods/<name>/...` so a rename can rewrite them (step 2) | `mods/ledgr/ledgr.svg`, `mods/ledgr-pane/*.svg`; shipped assets used are listed in the recipe |
| ☑ | No import from another mod's folder (Mods; observed refusal) | the overlay's engine copies are generated by `install.sh` |
| ☑ | `keys.json` holds only the keys the mod expects; replacing a used key is asked (step 4) | `install.sh` detects conflicts in `global`, `terminal` and `layout:<name>` and asks |
| ☑ | Shipped layouts are never edited; clone first (Layouts) | `install.sh` refuses a shipped layout and offers `layout.clone` |
| ☑ | `herdr-app check` passes for every mod (Check before you finish) | run by `install.sh` and `install.sh --check` |
| ☑ | Folder name not a shipped mod's (Naming, by collision) | `ledgr`, `ledgr-pane` |
| ☑ | The exported design conversation stays out of the published files (not a manual rule) | `docs/history/` is gitignored and never ships (the owner's decision, 2026-11-06) |
| ☐ | Public GitHub repo with topic `herdr-mod` (same) | the owner's: repo name, the topic, pushing |
| ☐ | Name free on herdr.dev/mods | unknown until published |
| ☐ | Nothing private in the published files (not a manual rule; the repo is public once pushed) | the owner's review: the research, design and build notes carry his paths, employer folder names and work-session content (`docs/history/` is gitignored, above) |
| n/a | Version field | none in the manual; `mod.json` `version` 0.1.0 and `CHANGELOG.md` are ledgr's own |
