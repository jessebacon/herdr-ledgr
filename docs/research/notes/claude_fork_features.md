# Branching and forking in Claude Code, Agent SDK, claude.ai and Claude Desktop (as of 2026-11-05)

Scope: every documented way to branch, fork or run a parallel line of work from a Claude conversation without losing the parent context. Sources were read on 2026-11-05. Where a source has no date, that is stated. "Documented" means stated in a page I read. "Inferred" means my reading, not stated by the source.

Terminology used below:
- **Branch** (`/branch`, `--fork-session`): a new session ID holding a copy of the transcript; you switch into it, the original stays on disk.
- **Fork subagent** (`/subtask`, fork mode): a background subagent that inherits the parent conversation; its final result returns to the parent.
- **Background copy** (`/fork`): a new background session holding a copy of the conversation; it runs separately and does not return results to the parent on its own.
- **Side question** (`/btw`, Desktop side chat): answers from context without entering history.

## Claude Code: session branching (`/branch`, `--fork-session`)

### Takeaway
A branch is a copy of the transcript under a new session ID. You switch into it, and the original stays intact and resumable. Nothing flows back to the original automatically, and no merge exists.

### Cited Findings
- `/branch [name]` creates a branch of the current conversation at this point, switches you into it, and preserves the original, which you can return to with `/resume`. Source: [Commands](https://code.claude.com/docs/en/commands.md) (accessed 2026-11-05, undated page).
- `claude --continue --fork-session` and `--resume ... --fork-session` produce a new session from the copied history. Source: [Manage sessions](https://code.claude.com/docs/en/sessions.md) ("Branch a session").
- The `/branch` confirmation prints two session IDs, the new branch and the original. The original "is unchanged on disk and remains in the session picker". Source: [Manage sessions](https://code.claude.com/docs/en/sessions.md).
- Inherited state after `/branch`: conversation history up to that point; "Allow for this session" permission grants (same process); in-flight background subagents and background Bash keep running and their output appears in the branch you switched into, not the original; Remote Control connection follows into the branch. Source: [Manage sessions](https://code.claude.com/docs/en/sessions.md).
- With `--fork-session` into a separate process, the new process "starts without them and you re-approve there" (permission grants). Source: [Manage sessions](https://code.claude.com/docs/en/sessions.md).
- Session picker: branches get their own rows; entries for the same session are grouped under one row when the picker finds more than one; `→` expands. Source: [Manage sessions](https://code.claude.com/docs/en/sessions.md).
- Plan-mode caveat: with `--fork-session`, Claude Code does not restore plan mode on resume. Source: [Manage sessions](https://code.claude.com/docs/en/sessions.md) ("Permission mode on resume").
- Worktree caveat: "the forked session starts in the directory you launched Claude from, and Claude Code leaves the original session's worktree untouched." Source: [Run parallel sessions with worktrees](https://code.claude.com/docs/en/worktrees.md).
- Version fix (secondary, changelog): 2.1.311 fixed `/branch` writing to the original session's task list. Source: [Claude Code CHANGELOG (raw)](https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md) (entries 2.1.304 to 2.1.318 read; the file has no per-entry dates).
- Introduction version of `/branch`: not found in primary sources. A third-party page says `/branch` was added in v2.1.77 and renamed from `/fork` (secondary, unverified): [ClaudeLog FAQ](https://claudelog.com/faqs/what-is-branch-command-in-claude-code/).

### Inferences
- A branch made from a conversation that has been compacted presumably starts from the compacted state, because resumed sessions continue from the last compaction summary (documented for resume in [Manage sessions](https://code.claude.com/docs/en/sessions.md)). The branch-specific case is not documented.
- Branches do not share a live transcript: two sessions resumed in two terminals without forking interleave into one transcript (documented in [Manage sessions](https://code.claude.com/docs/en/sessions.md)), so a branch is the supported way to diverge.

### Gaps
- No documented merge, cherry-pick, or "bring result back" for `/branch` sessions. Only `/resume` returns you to the original.
- Whether `/branch` records a parent-session reference in the transcript is not documented (see the transcript section below).

## Claude Code: rewind and checkpoints (linear, not a branch)

### Takeaway
`/rewind` (or Esc Esc) moves the conversation and/or files back to an earlier prompt inside the same session. It truncates; it does not create a second line you can return to, though rewound messages persist until your next prompt.

### Cited Findings
- Checkpoints are created before each prompt that starts a turn; Claude Code keeps snapshots for the 100 most recent checkpoints. Source: [Checkpointing](https://code.claude.com/docs/en/checkpointing.md).
- Menu actions: Restore code and conversation; Restore conversation; Restore code; Summarize from here; Summarize up to here; Never mind. Source: [Checkpointing](https://code.claude.com/docs/en/checkpointing.md).
- "Summarize keeps you in the same session and compresses context, like a targeted `/compact`. To branch off and try a different approach while preserving the original session intact, use `/branch` or `claude --continue --fork-session` instead." Source: [Checkpointing](https://code.claude.com/docs/en/checkpointing.md).
- "Rewound messages can return if you exit before your next prompt." Source: [Checkpointing](https://code.claude.com/docs/en/checkpointing.md).
- Checkpoints survive resume: "Claude Code saves checkpoints with the conversation, so you can still run `/rewind` after you resume a session." Source: [Checkpointing](https://code.claude.com/docs/en/checkpointing.md).
- Rewind past `/clear`: the menu gets a `/resume <session-id> (previous session)` entry until you exit or resume a different session. Source: [Checkpointing](https://code.claude.com/docs/en/checkpointing.md).
- Limitations: Bash-only file changes are not tracked after an edit tool has touched the file; subagent edits in background forks and most subagents are not restored; external and concurrent-session edits are not captured; symlinked and hard-linked files are skipped; snapshots are deleted after about 30 days by the retention sweep. Source: [Checkpointing](https://code.claude.com/docs/en/checkpointing.md).
- Fix (changelog 2.1.311): the `/rewind` confirmation wrongly said the conversation "will be forked" when later messages were removed, so the documented behavior is removal, not forking. Source: [Claude Code CHANGELOG (raw)](https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md).
- Digest, Week 20 (May 11–15, 2026): Rewind menu can compress earlier context with "Summarize up to here". Source: [What's new](https://code.claude.com/docs/en/whats-new.md).
- Digest, Week 26 (June 22–26, 2026): `/rewind` can resume a conversation from before `/clear` was run. Source: [What's new](https://code.claude.com/docs/en/whats-new.md).

### Inferences
- Rewinding to an earlier prompt and then sending a new prompt effectively abandons the later messages in the conversation; to keep both paths, you need `/branch` before rewinding. This follows from "Restore conversation" plus "Rewound messages can return" but is not stated as a recipe.

### Gaps
- Whether a rewind that is followed by a new prompt leaves the abandoned path retrievable anywhere (other than the transcript file) is not documented.

## Claude Code: `/compact` and summaries relative to branches

### Takeaway
`/compact` and "Summarize" compress the same session. Neither creates a branch. The docs steer branching to `/branch` or `--fork-session`.

### Cited Findings
- `/compact [instructions]`: "replace history with a summary, optionally focused on what you specify." Source: [Manage sessions](https://code.claude.com/docs/en/sessions.md) ("Manage context within a session").
- Compaction invalidates the conversation cache layer but keeps system prompt and project context cached. Source: [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching.md) ("Compacting the conversation").
- Subagent auto-compaction runs against the subagent's own window. Source: [Manage sessions / Subagents](https://code.claude.com/docs/en/sub-agents.md) (subagent auto-compaction section).

### Inferences
- A fork started after a compaction presumably inherits the compacted history, not the discarded messages. Not documented for forks specifically.

### Gaps
- Whether `/subtask` or `/fork` copies the pre-compaction transcript or only the post-compaction state is not documented.

## Claude Code: fork subagents (`/subtask`, fork mode, the Agent tool)

### Takeaway
A fork is a subagent that inherits the whole parent conversation, shares the parent prompt cache, runs in the background, and returns only its final result. Claude can start forks on its own when fork mode is on (default). The docs do not describe the Agent-tool parameter as `subagent_type: "fork"`; I could not confirm that value exists.

### Cited Findings
- "A fork is a subagent that inherits the entire conversation so far instead of starting fresh... a fork sees the same system prompt, tools, model, and message history as the main session." Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md) ("Fork the current conversation").
- Fork's own tool calls stay out of the parent; only the final result returns. Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md).
- Prompt cache: "Prompt cache: Shared with main session" for forks; "its first request reuses the parent's prompt cache." Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md) ("How forks differ from other subagents"); [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching.md) ("Subagents and the cache").
- `/subtask <task>`: "Spawn a forked subagent: a background subagent that inherits the full conversation and works on the task while you keep working. Its result returns to this conversation when it finishes." Source: [Commands](https://code.claude.com/docs/en/commands.md).
- Panel controls: forks appear in a panel below the prompt; `↑`/`↓` move; `Enter` opens the fork's transcript and sends follow-ups; `x` stops it; `Esc` returns focus. Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md) ("Observe and steer running forks").
- Fork mode: Claude can start a fork on its own "while fork mode is on, as it is by default"; stop with `permissions.deny` entry `"Agent(fork)"`, or `CLAUDE_CODE_FORK_SUBAGENT=0`. Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md) ("Turn fork mode off").
- Fork mode is on by default from Claude Code v2.1.302 and in interactive terminal sessions from v2.1.232. Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md).
- A fork can pass `isolation: "worktree"` when Claude spawns it through the Agent tool; "A fork can't spawn further forks." Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md).
- Limit behavior: "A fork at the limit keeps `Agent` in its inherited tool list, but the tool returns an error instead of spawning. An in-session fork you start with `/subtask` takes a slot while it runs and is never blocked by the limit." Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md). The numeric limit was not in the portion I read.
- `/btw` press `f` starts a forked subagent with the parent conversation plus that question and answer (local sessions only). Source: [Interactive mode](https://code.claude.com/docs/en/interactive-mode.md) ("Side questions with /btw").
- Agent tool: "wherever fork mode is on, the tool can launch a forked subagent, which inherits the full parent conversation instead of starting fresh." Source: [Tools reference](https://code.claude.com/docs/en/tools-reference.md) ("Agent tool behavior").
- Digest, Week 29 (July 13–17, 2026): `/fork` copies the conversation into a new background session. Digest, Week 33 (Aug 10–14, 2026): fork mode on by default in interactive sessions. Source: [What's new](https://code.claude.com/docs/en/whats-new.md).
- Changelog 2.1.307: forks launched together are told which launch is theirs. Changelog 2.1.317: fixed VS Code forked conversations dropping parallel tool-call results. Source: [Claude Code CHANGELOG (raw)](https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md).

### Inferences
- Because forks are prompt-cache-shared, running several forks from one parent should be cheaper than fresh subagents with the same context, but the docs do not quantify it.
- "subagent_type: 'fork'" is probably how the user's own tooling or an older/newer build names the mode. The documented control is fork mode plus the `Agent(fork)` permission rule.

### Gaps
- The Agent-tool parameter schema (name of the field that selects fork) is not in the pages I read; only the `name` field (teammate) and `isolation` are described.
- The concurrency limit number for forks and background subagents is not stated in the portion I read.

## Claude Code: `/fork` (background copy) and agent view

### Takeaway
`/fork` copies the whole conversation into a new background session with its own row in agent view, and you keep working in the original. The two are independent; a copy's results do not return automatically.

### Cited Findings
- "Run `/fork` to copy the current conversation into a new background session while the original keeps running... It also carries over the model, permission mode, effort level, and any directories or 'don't ask again' permission grants you added during the session." Source: [Agent view](https://code.claude.com/docs/en/agent-view.md) ("/fork").
- "After the fork, the two conversations are independent: nothing the copy does enters the original conversation on its own, though in sessions where cross-session messaging is enabled, either session's Claude can explicitly message the other." Source: [Agent view](https://code.claude.com/docs/en/agent-view.md).
- Isolation: "Except when the copy edits in place, Claude Code instructs it to create a worktree of its own before making code changes." Source: [Commands](https://code.claude.com/docs/en/commands.md); isolation details at [Agent view](https://code.claude.com/docs/en/agent-view.md) ("How file edits are isolated"). The changelog says this isolation instruction and branch base came in v2.1.221 (secondary summary in version history).
- Sessions started with launch flags the copy would not inherit (a replaced system prompt or `--tools` allowlist) "can't be forked; Claude Code says so instead of making a partial copy." Source: [Agent view](https://code.claude.com/docs/en/agent-view.md).
- Prompt-cache note: a copy receives its isolation instruction as a message at the end of the copied conversation, so the original's cache stays intact. Source: [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching.md).
- With agent view off, `/fork` starts a forked subagent instead, and `/subtask` is unavailable. Source: [Commands](https://code.claude.com/docs/en/commands.md).
- Navigation: select a row with arrow keys; `Space` peeks; `Enter` or `→` attaches; `←` on an empty prompt detaches; `Esc` returns to shell; `Alt+1`..`Alt+9` attaches to sessions 1–9 in the directory. Source: [Agent view](https://code.claude.com/docs/en/agent-view.md).
- `/background` (alias `/bg`) moves the current conversation into a background session. Source: [Agent view](https://code.claude.com/docs/en/agent-view.md).
- Version history: `/fork` became "copy the session" in v2.1.212 and the forked-subagent behavior moved to `/subtask`; isolation instruction in v2.1.221; copy-of-copy fix in v2.1.246. Source: [Agent view](https://code.claude.com/docs/en/agent-view.md) ("Version history"). Date of 2.1.212 is only available from a secondary write-up dated 2026-07-17: [Classmethod, Claude Code v2.1.212](https://dev.classmethod.jp/en/articles/20260717-cc-updates-v2-1-212/).
- Limits: "Rate limits apply... running ten agents in parallel uses quota roughly ten times as fast"; "Sessions are local"; "Claude-created worktrees are deleted with the session in agent view". Source: [Agent view](https://code.claude.com/docs/en/agent-view.md) ("Limitations").
- Agent view was introduced in v2.1.139 as a research preview. Source: [Agent view](https://code.claude.com/docs/en/agent-view.md) ("Version history").

### Inferences
- A `/fork` copy and its original have distinct session IDs, so `claude --resume` and `/resume` work on each independently.

### Gaps
- Maximum number of concurrent background sessions is not stated in the portion I read (the Limitations section lists quota, not a cap).
- Whether a copy's result is surfaced back to the original is not documented beyond "nothing... enters the original on its own".

## Claude Code: resume, session picker, and transcript lineage

### Takeaway
Resume reopens the same session ID. Branch and background copy create new IDs. The docs do not document a parent-session field in the transcript; I found one in a subagent transcript record in the local corpus only.

### Cited Findings
- Entry points: `claude --continue`, `claude --resume`, `claude --resume <name>`, `claude --resume <transcript-path>`, `claude --from-pr <number>`, `/resume`. Source: [Manage sessions](https://code.claude.com/docs/en/sessions.md).
- Resume restores conversation history, interrupted tool calls are not rerun, model, agent, permission mode (terminal), and active goal. Source: [Manage sessions](https://code.claude.com/docs/en/sessions.md) ("What a resumed session restores").
- Transcripts: JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`; "The entry format is internal to Claude Code and changes between versions." Source: [Manage sessions](https://code.claude.com/docs/en/sessions.md) ("Where transcripts are stored").
- "Resuming a session with `claude --continue` or `claude --resume` reopens it under the same session ID and appends new messages... Forking with `--fork-session` or `/branch` copies the history into a new session ID, leaving the original unchanged." Source: [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works.md) ("Resume or fork sessions").
- Local transcript check (my inspection of the user's `~/.claude/projects`, key names only): user, assistant and system records carry `sessionId` and `parentUuid` (the message chain), and no parent-session field. One record of type `fork-context-ref` carries `parentSessionId`, `parentLastUuid`, `contextLength` and `agentId`; it appears in a subagent transcript (`.../subagents/agent-*.jsonl`) and nowhere else I found. Source: local files; no public doc describes these fields.
- Session picker: `Ctrl+W` widens to worktrees, `Ctrl+A` to all projects; `Ctrl+B` filters to the current git branch; `Ctrl+R` renames. Source: [Manage sessions](https://code.claude.com/docs/en/sessions.md).
- Digest, Week 21 (May 18–22, 2026): background sessions appear in `/resume`. Digest, Week 35 (Aug 24–28, 2026): `/resume` in Desktop picks up CLI sessions. Source: [What's new](https://code.claude.com/docs/en/whats-new.md).

### Inferences
- Lineage between a `/branch` or `/fork` copy and its parent is not recorded in a documented field. Tools that need it must infer it from shared message UUIDs or from the names you gave the sessions.

### Gaps
- Whether `/branch` or `--fork-session` writes any parent-session reference in the main transcript is not documented. My local sample of main transcripts showed none.

## Claude Code: worktree isolation (`--worktree`, `EnterWorktree`, `isolation: worktree`)

### Takeaway
Worktrees isolate files, not conversations. A worktree session starts a new branch in `.claude/worktrees/<name>`; subagents can run in temporary worktrees that branch from the default branch.

### Cited Findings
- `claude --worktree feature-auth` creates `.claude/worktrees/<name>/` on a new branch `worktree-<name>`. Source: [Run parallel sessions with worktrees](https://code.claude.com/docs/en/worktrees.md).
- Claude can create or enter a worktree with `EnterWorktree`. Source: [Worktrees](https://code.claude.com/docs/en/worktrees.md) and [Tools reference](https://code.claude.com/docs/en/tools-reference.md).
- Subagent `isolation: worktree` runs in a temporary worktree that "branched by default from your default branch rather than the parent session's HEAD"; removed automatically if no changes. Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md) (frontmatter) and [Worktrees](https://code.claude.com/docs/en/worktrees.md) ("Isolate subagents with worktrees").
- `worktree.baseRef`: `"fresh"` (default, default branch) or `"head"` (current local HEAD, so a subagent can see unpushed work). Source: [Worktrees](https://code.claude.com/docs/en/worktrees.md) ("Choose the base branch").
- Resume: a session that ended inside a worktree returns to it on `--resume`, `--continue`, and SDK resumes; `--fork-session` starts the fork in the launch directory. Source: [Worktrees](https://code.claude.com/docs/en/worktrees.md) ("Resume a worktree session").
- Worktrees share the `.git` directory, plugins at project scope, and permission approvals with the main checkout. Source: [Worktrees](https://code.claude.com/docs/en/worktrees.md) ("What worktrees share").
- Digest, Week 19 (May 4–8, 2026): `worktree.baseRef` added. Source: [What's new](https://code.claude.com/docs/en/whats-new.md).

### Inferences
- A `/fork` copy edits its own worktree, so two sessions can edit the same repository safely in parallel. The file-level result (merge) is a git operation, not a Claude feature.

### Gaps
- How `isolation: worktree` behaves across a subagent resume (reuse or recreate) is not stated in what I read.

## Claude Code: SendMessage, background subagents, Monitor, cross-session messaging

### Takeaway
Within one session, `SendMessage` resumes a completed subagent by ID or name and can reach a running background agent. Across sessions, messaging passes plain text only; it does not copy history. To move a conversation, resume it.

### Cited Findings
- Background subagents: "With nothing configured, a subagent that Claude spawns from your main conversation starts in the background." Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md). Digest, Week 27 (June 29–July 3, 2026): background by default. Source: [What's new](https://code.claude.com/docs/en/whats-new.md).
- A background subagent's result "reach[es] Claude as a completion notification in a later turn." Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md). Set `CLAUDE_CODE_FORK_SUBAGENT` to `0` to make Claude wait instead (per that page).
- `SendMessage` with the agent ID or name in `to` "resumes it." "Resumed subagents retain their full conversation history." Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md) ("Resuming subagents").
- A subagent you stopped yourself "doesn't auto-resume" and a message to it is refused. The built-in Explore and Plan agents are one-shot and cannot be resumed. Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md).
- Names survive a restart only from names given since the last compaction; a message by agent ID works after restart. Source: [Subagents](https://code.claude.com/docs/en/sub-agents.md) ("Message a subagent by name after a restart").
- Changelog 2.1.317: a message to a running background agent arrives earlier; its running command moves to background. Source: [Claude Code CHANGELOG (raw)](https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md).
- Cross-session messaging: "A message is a piece of text one Claude writes to another, never the sender's conversation history or files. To move a whole conversation or its context, resume the session instead." Source: [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging.md). Available from v2.1.224 (macOS/Linux) and v2.1.234 (native Windows). Digest, Week 32 (Aug 3–7, 2026). Source: [What's new](https://code.claude.com/docs/en/whats-new.md).
- Cross-session limits: same-machine messages capped at about one million characters; rapid bursts refused at sender; held messages capped at 100; `notify_when_idle` notices expire after 12 hours; `crossSessionInbound` setting (`accept`, `hold`, `refuse`). Source: [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging.md).
- Listing: `/list-agents` (alias `/peers`) shows the sessions Claude can reach on this machine and, under Remote Control, cloud and other-machine sessions. Source: [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging.md).
- Monitor: runs a command in the background and feeds each output line back to Claude; "When you stop a subagent that started monitors... those monitors stop with it." Source: [Tools reference](https://code.claude.com/docs/en/tools-reference.md) ("Monitor tool").
- Digest, Week 33 (Aug 10–14, 2026): typing `@` in the prompt mentions another session by name. Source: [What's new](https://code.claude.com/docs/en/whats-new.md).

### Inferences
- Sibling sessions can see each other's names and can message each other, but there is no documented way for one session to read another's transcript through cross-session messaging.

### Gaps
- Whether a message can quote or attach a sibling's transcript (not summary text) is not documented; the docs say messages are Claude-written text.

## Agent SDK (`@anthropic-ai/claude-agent-sdk`, `claude-agent-sdk`)

### Takeaway
The SDK has `resume` and `fork_session` / `forkSession` options. A fork returns a new session ID and leaves the original unchanged. The SDK docs do not state whether a forked session shares the prompt cache, and I could not confirm it.

### Cited Findings
- "Fork is different: it creates a new session that starts with a copy of the original's history. The original stays unchanged." Source: [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md) ("Continue, resume, and fork").
- Python example: `ClaudeAgentOptions(resume=session_id, fork_session=True)`; TypeScript: `resume: sessionId, forkSession: true`; the forked ID is read from the result's `session_id` (TS: from the init system message). Source: [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md) ("Fork to explore alternatives").
- "Forking branches the conversation history, not the filesystem. If a forked agent edits files, those changes are real and visible to any session working in the same directory." Source: [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md).
- Continue vs resume: `continue` picks the most recent session in the directory; `resume` takes an ID. Source: [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md).
- `persistSession: false` (TypeScript only) keeps a session in memory only; Python uses `CLAUDE_CODE_SKIP_PROMPT_HISTORY`. Source: [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md).
- Cross-host: resume requires a `SessionStore` adapter or moving the `.jsonl` file. Source: [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md) ("Resume across hosts").
- The v2 TypeScript session API (`createSession()`) was removed in 0.3.142. Source: [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md).
- Shared prompt cache for SDK forks: not stated on the sessions page. The prompt-caching page covers `/fork` copies and subagent forks, not `fork_session`. Source: [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching.md).

### Inferences
- Because a fork's history is a copy of the original's prefix, a cache hit is plausible within the TTL if the system prompt and tools match, but this is my inference, not documented.

### Gaps
- Whether `fork_session` shares the prompt cache with the original, and how it is billed, are not documented on the pages I read.
- No SDK option to merge a fork's result back into its parent.

## Claude Desktop (Code tab)

### Takeaway
Desktop runs multiple sessions side by side, with a side chat for questions and a per-session worktree option. It documents no fork or branch command for sessions.

### Cited Findings
- Each Code-tab conversation is a session; Cmd+N / Ctrl+N starts one; Ctrl+Tab switches; split view via Option/Alt-click or "Open in > Split view". Source: [Desktop](https://code.claude.com/docs/en/desktop.md) ("Parallel sessions").
- Side chat: "A side chat lets you ask Claude a question that uses your session's context but doesn't add anything back to the main conversation." "The side chat can read everything in the main thread up to that point." Open with Cmd+; / Ctrl+; or `/btw`. Source: [Desktop](https://code.claude.com/docs/en/desktop.md) ("Ask a side question without derailing the session").
- Side chats are not saved: "The desktop app doesn't save side chats to disk, so you can't return to one after you close the app." Available in local, SSH and WSL sessions only. Source: [Desktop](https://code.claude.com/docs/en/desktop.md).
- Side chat tool use: the page does not say whether a side chat can run tools or edit files. Source: [Desktop](https://code.claude.com/docs/en/desktop.md).
- Worktree per session: turn on Worktree before starting; "Session isolation requires Git." Source: [Desktop](https://code.claude.com/docs/en/desktop.md).
- "By default it sees the 20 most recently active sessions"; Claude does not see cloud sessions or sessions started from the terminal CLI or VS Code, even in worktrees. Source: [Desktop](https://code.claude.com/docs/en/desktop.md).
- "Open in Cloud" moves the conversation to a cloud session with the conversation "carried over as a summary." Source: [Desktop](https://code.claude.com/docs/en/desktop.md).
- Digest, Week 35 (Aug 24–28, 2026): `/resume` in Desktop picks up CLI sessions. Source: [What's new](https://code.claude.com/docs/en/whats-new.md).
- Desktop does not state a maximum number of simultaneous sessions. Source: [Desktop](https://code.claude.com/docs/en/desktop.md).

### Inferences
- A Desktop side chat is the closest documented equivalent of "ask about this without changing the thread"; it is read-only in the sense that it adds nothing back.

### Gaps
- Whether a side chat can use tools, and whether it can be promoted to a session, are not documented.

## claude.ai (web and chat)

### Takeaway
claude.ai supports editing an earlier message to create a different version of the chat. The official help center does not document how to switch between those versions, and it states that branching from an earlier point is not available. I found no "branch in new chat" feature in 2025–2026 official material.

### Cited Findings
- "Edit an earlier message to create a different version of the chat, with its own artifacts, so you can explore another direction without losing previous work." Source: [What are artifacts and how do I use them?](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them) (no date; "Updated this week").
- "Branching a conversation from an earlier point isn't available." Listed under "Current limitations." Source: [Claude Cowork and chat are one Claude](https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude) (no date; "Updated this week").
- Claude.ai release notes (Aug 2025 to Oct 21, 2026, read on 2026-11-05): no entry mentions branching, forking, retry, or regenerate; June 12, 2026 "Edit Claude's drafts in place" concerns drafts in chat or Cowork. Source: [Release notes](https://support.claude.com/en/articles/12138966-release-notes).
- Projects: each has its own chat history and knowledge base; uploaded knowledge informs all chats in that project; project memory is separate. Source: [What are projects?](https://support.claude.com/en/articles/9517075-what-are-projects) (via search snippet; the page itself was not fetched). The same snippet says a new Projects beta, starting with Claude Code, lets "a project works as one conversation, and Claude runs parallel threads in the cloud" for some Pro, Max and Ultra users.
- Desktop-style "reply to selection" or "branch from here" in claude.ai chat: not found in official help material. Claude Science, Claude for Word and Claude Code in VS Code have selection features, but those are other products.

### Third-party (secondary, unverified)
- Version arrows (for example ◀ 1/2 ▶) after editing a message and retry arrows on replies are described by third-party guides, not Anthropic: [claudetopdf.vercel.app](https://claudetopdf.vercel.app/branch-conversations-in-claude), [Nodea guide](https://www.nodea.ai/blog/branching-ai-chat-guide), [GuideFlow retry](https://www.guideflow.com/tutorial/how-to-retry-a-response-in-a-chat-in-claudeai). These claims could not be checked against an Anthropic source.

### Inferences
- The "edit creates a version" feature and the "branching isn't available" limitation may describe the same mechanism from two sides: an edited message keeps a sibling version rather than a separate conversation. That is an inference from the wording.

### Gaps
- Official navigation controls for edited-message versions, and whether retries are kept, are not documented on the help pages I could read.
- No official "branch in new chat" (the ChatGPT-style feature) was found.

## Recent changes (May to November 2026) touching branching

### Takeaway
The main additions are `/fork` (July 2026), fork mode as default (August 2026), cross-session messaging (August 2026), `/resume` in Desktop for CLI sessions (August 2026), and a steady set of fork, rewind, and resume bug fixes through v2.1.318.

### Cited Findings (dated by week digest)
- Week 19 (May 4–8): `worktree.baseRef` added. [What's new](https://code.claude.com/docs/en/whats-new.md)
- Week 20 (May 11–15): agent view; Rewind menu "Summarize up to here". [What's new](https://code.claude.com/docs/en/whats-new.md)
- Week 21 (May 18–22): background sessions appear in `/resume`. [What's new](https://code.claude.com/docs/en/whats-new.md)
- Week 24 (June 8–12): sub-agents can spawn their own sub-agents (background chains capped at five levels). [What's new](https://code.claude.com/docs/en/whats-new.md)
- Week 26 (June 22–26): `/rewind` can resume a conversation from before `/clear`. [What's new](https://code.claude.com/docs/en/whats-new.md)
- Week 27 (June 29–July 3): subagents run in the background by default. [What's new](https://code.claude.com/docs/en/whats-new.md)
- Week 29 (July 13–17): `/fork` copies the conversation into a new background session. [What's new](https://code.claude.com/docs/en/whats-new.md)
- Week 32 (Aug 3–7): cross-session messaging. [What's new](https://code.claude.com/docs/en/whats-new.md)
- Week 33 (Aug 10–14): fork mode on by default in interactive sessions; `@` mentions another session. [What's new](https://code.claude.com/docs/en/whats-new.md)
- Week 35 (Aug 24–28): `/resume` in Desktop picks up CLI sessions. [What's new](https://code.claude.com/docs/en/whats-new.md)
- Changelog 2.1.304 to 2.1.318 (newest read; no per-entry dates; one entry references Oct 30, 2026): fork, resume, rewind and `/branch` fixes, including 2.1.318 (fork effort option for mods; "Name (fork 2)" naming for Remote Control forks) and 2.1.304 (warning when resuming an inactive conversation would use a large share of the 5-hour limit on Pro/Max). [Claude Code CHANGELOG (raw)](https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md)
- Agent view version history (no dates in the table) lists 2.1.212 (`/fork` becomes copy; `/subtask` introduced), 2.1.216, 2.1.221 (copy isolation), 2.1.232 (fork mode interactive), 2.1.246 (copy-of-copy fix), 2.1.302 (fork mode default). [Agent view](https://code.claude.com/docs/en/agent-view.md); [Subagents](https://code.claude.com/docs/en/sub-agents.md)
- Claude.ai release notes (May 28 to Oct 21, 2026): no branch, fork, retry, or regenerate entries. [Release notes](https://support.claude.com/en/articles/12138966-release-notes)

### Gaps
- The CHANGELOG file was read in part (the newest 100 KB); earlier 2026 entries (May to early Aug) for `/subtask`, `/fork` and `/branch` introduction were not read in full. Introduction dates should be checked in the raw file.

## Explicit gaps (answers to the key questions)

- **Pin a question to a passage while Claude streams?** Not documented. `/btw` answers from context and does not add to history; Desktop side chat reads the thread up to that point. Neither pins to a passage. Queued messages (Enter during a turn) are delivered within the same turn. Sources: [Interactive mode](https://code.claude.com/docs/en/interactive-mode.md), [Desktop](https://code.claude.com/docs/en/desktop.md).
- **Merge two branches?** Not supported. No merge command for sessions is documented. Git branches are separate. Source: [Checkpointing](https://code.claude.com/docs/en/checkpointing.md) ("Not a replacement for version control").
- **Can a branch see sibling branches?** Not documented. A `/branch` copy holds only history up to the branch point. Cross-session messaging can message live sibling sessions, but messages are Claude-written text, not transcripts. Source: [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging.md).
- **Is there a parent field in transcripts?** Not documented. Local key inspection found `parentSessionId` only in a subagent `fork-context-ref` record.
- **Does `subagent_type: "fork"` exist?** Not in the pages I read. The documented controls are fork mode, `CLAUDE_CODE_FORK_SUBAGENT`, `/subtask`, and the `Agent(fork)` permission rule.
- **Does an SDK fork share the prompt cache?** Not documented.
- **Limit on concurrent forks or background agents?** The number is not in the pages I read.
- **claude.ai branch navigation?** Not in official help pages.

## Sources (accessed 2026-11-05)

- Manage sessions: https://code.claude.com/docs/en/sessions.md
- How Claude Code works: https://code.claude.com/docs/en/how-claude-code-works.md
- Checkpointing: https://code.claude.com/docs/en/checkpointing.md
- Subagents: https://code.claude.com/docs/en/sub-agents.md
- Agent view: https://code.claude.com/docs/en/agent-view.md
- Worktrees: https://code.claude.com/docs/en/worktrees.md
- Commands: https://code.claude.com/docs/en/commands.md
- Interactive mode: https://code.claude.com/docs/en/interactive-mode.md
- Tools reference: https://code.claude.com/docs/en/tools-reference.md
- Cross-session messaging: https://code.claude.com/docs/en/cross-session-messaging.md
- Prompt caching: https://code.claude.com/docs/en/prompt-caching.md
- Desktop: https://code.claude.com/docs/en/desktop.md
- What's new (weekly digest index): https://code.claude.com/docs/en/whats-new.md
- Agent SDK, work with sessions: https://code.claude.com/docs/en/agent-sdk/sessions.md
- Claude Code CHANGELOG (raw, newest part read): https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md
- claude.ai: https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them ; https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude ; https://support.claude.com/en/articles/12138966-release-notes ; https://support.claude.com/en/articles/9517075-what-are-projects
- Secondary (unverified): https://claudelog.com/faqs/what-is-branch-command-in-claude-code/ ; https://dev.classmethod.jp/en/articles/20260717-cc-updates-v2-1-212/
