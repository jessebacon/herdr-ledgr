# Outside critique of the research report and the Phase 1 spec

Source: Grok, pasted by Jesse on 2026-11-05 after reading the research report and the ledger spec.
Disposition: see the "Design decisions log" in `CLAUDE.md` and Section 11 of `docs/design/Herdr ledger mod design.md`. Adopted: store durability, clipboard quote validation, child-process guards, pending event, re-raisable dismissals, instruction injection off by default, narrower extractor prompt, parked questions as the top lane. Rejected: deferring the agent-ask lane (Jesse wants it addressed directly); the claim that `subagent_type: "fork"` is unconfirmed (it is confirmed by the Claude Code harness); "a fork is a free interruption" as a rule (forking is a free deferral; stopping generation is not free).

---

The research is right about the shape of the problem. The ledger spec is buildable, and it builds a different product than the one the research argued for. Build the identity join and a thin park first. Hold the agent-ask extractor until you have used the park for a week.

## What holds

The report's thesis is the right one. Keep a linear trunk. Put four cheap moves around it: a side question that never enters history, a question you park while the model is still talking, a branch opened from a copy of the trunk, and one short message you approve that carries the branch's result back to the end of the trunk. A canvas comes last, after a list has actually run out of room.

Three distinctions in the report are worth keeping as design rules.

*   The stack and the tree are different objects. The stack is which questions are open right now. The tree is the record of what was opened, answered, or dropped. A transcript shows neither, so you carry the stack. Text already lets you re-read, so the case against linear chat is navigation and attachment, not raw memory for what was said.
*   A fork is a free interruption. Between people, cutting in costs the speaker their place. A model pays nothing to lose its place, so the only cost left is yours: capturing the question, and knowing what the branch inherited.
*   A confluence delivers water, not the watershed. The trunk gets a result. It does not get the branch transcript. That matches git squash, Slack's "also send to channel," and Clark and Schaefer's present-then-accept. Claude's `/subtask` already posts a result and skips the accept. Cursor's side chats are closer to what you want: opened from a passage, parent kept as hidden context, pulled back only when you say so.

The product survey is the strongest section. `/btw`, `/branch`, `/fork`, and `/subtask` are four verbs, split on what they inherit and what comes back. The market has settled on a fork that sends nothing home. Amp deleting fork in favor of handoff is a real counter-signal, and the report keeps it. Herdr's fit is also right: it already has the panel, the pane header, and a parent-child agent tree, and it has no Claude session id. Hooks are the correct join. The pid chain should stay rejected.

The constructal-law demolition is fair. Your river image was about shape. Bejan's law is about flow systems changing form, and nobody has applied it to talk. Talk splits off a trunk and rejoins, which is an anabranch, and it also cross-refers, which water cannot do. The report kept the one lesson that matters and threw out the physics. Good.

## Where the research overreaches

The body is careful. The lede and the conclusion are not. Einstein and Altmann show that deferred intentions and place-keeping fail under interruption in lab tasks. They do not show that a 600-word answer erases your questions. TED-Q forced a question every two sentences. That is a probe, not a natural rate. The report itself says no study has tested the claim that listeners bundle context around each pending question, and that text has no 200 ms floor-taking pressure. Then the conclusion calls the question inbox the most novel and most defensible thing to build, because that is where the memory evidence is strongest.

That substitutes an easier problem. Your prompt was about morphology. While the answer is still arriving, each question carries its own bundle: the passage, the assumption it challenges, and not the rest of the firehose. You want to explore that bundle and come back with a result. A reminder list at `Stop` solves "I might forget." It does not solve "this question is about that paragraph, and the eight turns after it should not be in the branch."

The theory section specifies the bundle correctly: a byte-identical prefix up to the anchor, plus a preamble, blind to later trunk turns and to siblings. The build plan cannot do it. `claude --resume --fork-session` copies the live end of the session. A question parked at turn 14 and opened at turn 22 inherits turns 15–22. A preamble that says "answer as of turn 14, and say if later turns change the answer" is a sticky note on a contaminated copy. The model has already seen the later turns. The report's `/branch` then `/rewind` workaround is an untested inference. Do not inherit it as a recipe.

A few other claims should not travel into the build:

*   `subagent_type: "fork"` is not in the docs. The notes left it unconfirmed. The report upgrades it.
*   The prompt-cache arithmetic (0.1× reads, a branch opened 30 minutes later paying one rewrite) is API `cache_control` behavior. It is not established for a new `claude` process started with `--fork-session`.
*   "Never nest past two" is an observation from CanvasConvo (24 people, five days) plus Claude's rule that a forked subagent cannot spawn another fork. That rule is about the Agent tool. It does not bind `claude --resume --fork-session`.
*   Confluence through `hc`'s note channel types into the parent session's input. The notes treat that channel as a hazard. `--no-notify` exists because of it.

The interface evidence is honestly weak, and that honesty should survive. Branching widens exploration. It has not been shown to lower load. People keep chat as the main surface. Max observed depth was 2. The new burden is "I don't know what the branch knows." That is the finding to design against.

## What the ledger spec actually is

Phase 1 is not a branching tool. It is a session identity map plus a two-lane inbox. Hooks write `HC_TERMINAL_ID` to `session_id`, transcript path, cwd, and turn. A single panel copy ingests a spool. You park a question with Cmd-J while the stream continues, and it does not reach the agent. At `Stop`, a Haiku call, or a `ledger-asks` block the trunk model was told to emit, turns the agent's last message into rows you answer in place. The chip counts during the turn and expands at the end. Nothing auto-opens. Branching is Phase 2. One approved rejoin message is Phase 3.

The engineering around that is unusually careful, and three choices should stay:

*   Hooks as the join. The pid chain stays unused.
*   The spool, atomic rename, silence on stdout, and `shared()` limited to the chip. A growing store in `shared()` would redraw every mod and could wipe `shared.json`.
*   The trunk-protection rules that are already specific. Do not type `/btw`. Do not auto-open the panel. Do not pretend Herdr can scroll a fullscreen transcript to a line. Show the saved turn in the row. Say in the preamble that the fork was taken at the end. Confluence stays one approved message at the tail.

The center of the spec faces the other direction from the brief. "ASKED OF YOU" is the top lane. Your questions are underneath. The four moves in the research are all yours: peek, park, branch, accept a result. Here the default path promotes the agent's asks straight to open rows that count in the chip. You decided that on 2026-11-05, and the spec says the ledger is for navigation, not memory prompts. That is a real product, and it matches the rest of your workflow. Agents already hand you decisions, confirmations, and tenant steps, and `my-queue` exists because those scroll away. It is a decision inbox beside a coding agent. It is not the constructal listener.

Both pains are real. They should not share a first build. An agent ask is born at the end of a turn, is often blocking, and wants a batched reply. A question of yours is born mid-stream, is about a passage, and wants a peek or a branch. One `Request` type makes the storage tidy and the panel face the agent's homework.

The answer sheet is the best original idea in the spec, and it is the agent-ask version of confluence: one compact message, keyed by handle, sent only when you click. Keep it. Sequence it after the agent lane has earned a place.

## Do not build Phase 1 as written

Three things should change before any code.

**1. The store handoff.** `localStorage` on the panel copy is the item store, and whether that file survives a layout edit is unconfirmed. A new panel copy that wins `ledger.writer` with an empty store will ingest the spool and delete the files. Events the old copy already applied are gone. The daily backup does not cover today, and `snapshot.json` is not a store. Write the full store into `ledger-data` on every change. A copy that takes the writer role restores that file before it reads or deletes anything.

**2. Leave the trunk alone.** `instruct_block` defaults on. `SessionStart` stdout is added to model context, again after `/clear` and compaction, and the model then emits a fenced JSON block into the transcript you are trying to navigate. Forks copy it. An empty `ledger-asks` array counts as "no asks" and skips the model, so a compliant agent can hide real asks. The non-goal says hooks never print into the model's context. This default breaks it. Turn the instruction off. An extractor, if you build one, runs beside the trunk. It does not recruit the trunk.

The Haiku path also misses the Phase 1 exit bar. The done-when says asks appear within 5 seconds. The extractor emits only after uuid retries at 0, 1, 2, and 4 seconds, with `curl --max-time 20`. The 5-second bar is the block path. Every Stop of 40 characters or more with no valid block sends the last 60,000 characters, plus cwd, repo, session name, and open asks, to the API on a personal key. That is a second copy of [project] content, outside the Max subscription. Cost is negligible. The boundary is not. If you extract, the CLI-on-subscription fallback is the safer default, and ordinary "want me to update the README?" confirms should not land as open rows. Dismiss is currently final even when the agent later raises the same ask for real.

**3. Cut the first build down to the join, the park, the chip, and the passage in the row.** Then one launcher. Things 3, the answer sheet's send path, tier-2 and tier-3 adapters, archive policy, and transcript-search key injection wait. So does Haiku-on-every-Stop.

The park's "bundle" is still a timestamp plus an optional clipboard quote. Herdr exposes no selection. Fullscreen Claude copies on mouse release, and the box offers whatever clipboard text is 3–600 characters and differs from the last capture, checkbox already on. Your clipboard is busy. A copied token becomes the anchor, and if you later branch that item, the preamble quotes it. Accept clipboard text only when it occurs in the current turn's saved text, or in what `hc read` shows while the agent is working. If it does not match, store the question with no quote.

A few holes matter once you do build past that:

*   Compaction. Anchors survive in `turns/`. Claude's transcript may not, because the model is looking at a summary. A later "knows turns 1 to N" line is false after compact. The manifest has to say so.
*   Same working tree. `--fork-session` copies history, not files. The preamble forbids edits. The branch still has tools, and a session with a tools allowlist cannot be forked, so you cannot fork and restrict tools in one launch. A research branch can write into the trunk's checkout. Treat that as a known risk on the Branch button.
*   `hc send --if idle` is the confluence and answer-sheet path. You already refused to auto-type `/btw` because a paste joins a draft and submits both. The same join happens to an approved rejoin message. Stage confluence on the clipboard too, unless you have confirmed that `--if idle` means the input is empty.
*   A subagent `Stop` or `SessionStart` that inherits the parent's `HC_TERMINAL_ID` and a different `session_id` would repoint `terminals/<t>.json`. The panel would follow the child until the parent's next hook. Main-conversation events only.
*   Capture reads the map at open. If that spool file is ingested after the turn's `stop`, the spec never re-walks the item to attach a uuid. The `settle` event is described and does not appear in the hook skeleton.
*   The mkdir lock can be broken after about 2 seconds. Two waiters can then both write the session record.
*   Q2 says `audit_rate` 0.2 for the first week. Appendix B sets it to 0.

Phase 2's manifest wording is honest and should stay. It is still a full-session copy with a label, not a branch of the passage. Ship it only after the park exists, and show `anchorTurn` against `forkTurn` on the button so the contamination is visible before you launch. Depth 2 is your cap. Claude will not enforce it on this launcher.

## Order

The report's order was resolver, launcher, inbox, manifest, confluence, graph last. The spec inverts the middle: a fat ledger, then a branch, then a rejoin. Graph-last is the part to keep.

| Step | Build | Stop when |
|---|---|---|
| 1 | Identity map only. The 9.3 two-pane check. | Focusing a Claude pane shows its session id with no pid lookup. |
| 2 | Cmd-J park, chip, passage rendered in the row. Quote accepted only if it matches the turn. | You park during a real stream for a week. Nothing is sent. |
| 3 | One Branch action on a parked item, with the preamble and the knows / does-not-know lines. | You can see, before launch, that the fork includes turns after the anchor. |
| 4 | Confluence as clipboard plus focus, one approved message, trunk idle. | The trunk grows by that message and nothing else. |
| 5 | Agent asks, only if the week of use was you hunting the agent's questions rather than your own. Instruction stays off. Blocking decides and confirms only. Answer sheet after that. | The chip is something you open. It is not a nag. |

Things 3 stays off and out of the first code. `queue_kind` does not belong in the extractor prompt.

You can do most of steps 3 and 4 by hand today, and the report's last table is the right cheat sheet. `/btw` while it streams. `/branch` when you will steer and come back. Paste a three-line conclusion yourself. The thing nobody ships, and the thing worth building in Herdr, is the park attached to the passage, held outside the transcript, with an honest manifest when you do branch. The extractor is a second product. It can wait until the first one has been in your way for a week.
