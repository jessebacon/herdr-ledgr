# Discourse Modeling for Branching Human-AI Conversation: Representations, Context Bundling, Merge Semantics, and UX

Scope note: "Cited Findings" sections are the established material, each with a source. "Inferences" sections hold my proposed design synthesis, labeled **[Synthesis]** where it goes beyond the sources. The prototype-level data model, event list, and UI states are in the Inferences of the context-bundling, merge, and interaction sections.

---

## 1. Representations: what structures exist for modeling a conversation as a non-linear object, and which have 2023-2026 LLM-era implementations?

### Takeaway
There are five main families: (a) question-centric models (Roberts' QUD, Ginzburg's KoS gameboard, QUD dependency parsing); (b) attention/intention stacks (Grosz-Sidner focus stack); (c) rhetorical/discourse-relation structures (RST trees, SDRT graphs that can have more than one parent, PDTB's shallow local relations); (d) state-centric models (dialogue state tracking, common-ground/commitment tracking); and (e) thread/segment models (topic segmentation, multi-party disentanglement). Every family except the Grosz-Sidner stack has LLM-era implementations. Fine-tuned LLMs reach or beat the state of the art on RST, SDRT, and disentanglement. Zero-shot LLMs are noticeably weaker on disentanglement and on generating QUDs that meet all their constraints. That gap matters for deciding what to compute live and what to leave to the human.

### Cited Findings
**Question-centric (QUD / KoS)**
- Roberts models discourse as a game whose context is "a scoreboard organized around the questions under discussion by the interlocutors". An utterance is Relevant iff it addresses the current QUD. The 2012 Semantics & Pragmatics article reissues a 1996 working paper. — [Roberts 2012, S&P 5](https://semprag.org/index.php/sp/article/download/sp.5.6/pdf); [Wikipedia: Question under discussion](https://en.wikipedia.org/wiki/Question_under_discussion)
- In formal and computational theories, "the QUD (or an ordered set of QUD's)" is one element of a tuple called the conversational scoreboard. — [Wikipedia: QUD](https://en.wikipedia.org/wiki/Question_under_discussion)
- Ginzburg's KoS splits each participant's information state into a private part and a public "Dialogue Gameboard" (DGB). The DGB holds shared commitments (FACTS), a list of ungrounded/pending moves, and a QUD list with the most recent/maximal question first. MAX-QUD acts as the current discourse topic. — [Lean formalization of KoS (linglib)](https://hawkrobe.github.io/linglib/docs/Linglib/Theories/Pragmatics/Dialogue/KOS/Basic.html); [Gregoromichelaki review of *The Interactive Stance*](https://elenigregor.github.io/files/review_gregoromichelaki_Upload.pdf); [course slides on KoS FACTS/QUD](https://api.sambuz.com/doc/computational-semantics-and-pragmatics-ppt-presentation-975349) (secondary slide deck, lower reliability)
- Sources disagree on QUD's data structure. Some formalizations use a partially ordered set; information-state dialogue systems (TRINDI/GoDiS line) use a shared QUD **stack** whose top element is popped when resolved. — [Bohlin et al., information-state dialogue systems](https://dfki.de/etai/SpecialIssues/Dia99/bohlin/isdme_html/node5.html); [linglib KoS](https://hawkrobe.github.io/linglib/docs/Linglib/Theories/Pragmatics/Dialogue/KOS/Basic.html)
- LLM era: Ko et al. built the first QUD *dependency* parser, a two-model pipeline trained on the crowdsourced DCQA dataset. Each sentence is linked to an anchor sentence in earlier context via an implicit question. — [Ko et al., ACL 2023 Findings](https://ar5iv.labs.arxiv.org/html/2210.05905); [ACL 2023 virtual page](https://virtual2023.aclweb.org/paper_P4813.html)
- QUDeval (EMNLP 2023) evaluated 2,190 generated QUD questions from fine-tuned systems and LLMs. GPT-3.5, Alpaca-7B, and GPT-4 produced fluent questions but did poorly on **answer compatibility, givenness, and anchor relevance**. Existing automatic metrics were weak proxies for parser quality. — [QUDeval, Wu et al. 2023](https://arxiv.org/pdf/2310.14520)
- A 2024 follow-up, "QUDSelect: Selective Decoding for QUD Parsing" (EMNLP 2024), exists, but I confirmed only its title. — [QUDeval citation context / NSF PAR](https://par.nsf.gov/biblio/10521345)

**Attention / intention (Grosz-Sidner)**
- Grosz and Sidner split discourse structure into linguistic structure (segments), intentional structure (segment purposes and how they relate), and an attentional state. The attentional state is a stack of focus spaces: opening a segment pushes a space, closing it pops one. The split is meant to explain cue phrases, referring expressions, and **interruptions**. — [Grosz & Sidner 1986, Computational Linguistics 12(3)](https://aclanthology.org/J86-3001.pdf)

**Rhetorical / discourse-relation structures**
- SDRT is described as "the only framework to date that handles multiparty conversation". In multiparty and situated dialogue a single discourse unit can have **two parents**, which most earlier SDRT parsers could not handle. The structure is therefore a graph, not a tree. — [Llamipa, arXiv 2406.18256](https://arxiv.org/html/2406.18256v3)
- Llamipa (2024) fine-tunes LLaMA3 as an **incremental** SDRT parser: it predicts links and relations for each new unit from the structure inferred so far. It reports 0.775 link F1 and 0.607 link+relation F1 on STAC, beating prior SOTA. A SIGdial 2024 paper (Li, Yin, Carenini) treats dialogue discourse parsing as LLM seq2seq generation and reports near-SOTA results on STAC/Molweni. — [Llamipa](https://arxiv.org/html/2406.18256v3); [Li et al. SIGdial 2024 slides](https://chuyuanli.github.io/assets/files/paper/24sigdial-slides-V3.pdf)
- RST tree parsing with LLMs: Llama 2 70B, fine-tuned with QLoRA using a bottom-up strategy, reached SOTA on RST-DT, Instr-DT, and GUM (EACL 2024). Models trained on GUM generalized to RST-DT. — [Maekawa et al., EACL 2024](https://arxiv.org/abs/2403.05065v1)
- PDTB 3.0 annotates discourse relations (explicit, implicit, AltLex, entity) anchored on connectives or adjacency, stored as standoff annotations over the WSJ text. It adds ~13K mostly intra-sentential relations over PDTB 2.0. Its approach is connective-anchored and local; it does not build a whole-document hierarchy. — [LDC PDTB 3.0 catalog](https://catalog.ldc.upenn.edu/LDC2019T05); [PDTB 3.0 annotation manual](https://catalog.ldc.upenn.edu/docs/LDC2019T05/PDTB3-Annotation-Manual.pdf). (Note: I found no source explicitly calling PDTB "theory-neutral". The "no full tree" characterization rests on the connective-anchored design and a related PDTB-inspired corpus.)

**State-centric (DST, common ground, commitments)**
- Zero-shot ChatGPT (research preview, Jan 2023) reached state-of-the-art *zero-shot* dialogue state tracking on MultiWOZ from prompts alone. The authors caution that general-purpose models are limited as replacements for specialized trackers. An aggregator lists JGA 31.5 on MultiWOZ 2.1. — [Heck et al., ACL 2023](https://arxiv.org/abs/2306.01386)
- S3-DST uses zero-shot structured prompting to do **segmentation and state tracking jointly** for open-domain dialogue, and reports SOTA zero-shot segmentation on DialSeg711. — [S3-DST, arXiv 2309.08827](https://arxiv.org/pdf/2309.08827.pdf)
- "Common ground tracking", meaning identifying beliefs shared by all participants, is defined as distinct from DST and benchmarked on multimodal collaborative dialogue (LREC-COLING 2024). It was extended to live multimodal group tracking in the TRACE demo (NAACL 2025). — [Khebour et al., LREC-COLING 2024](https://aclanthology.org/2024.lrec-main.318); [TRACE, NAACL 2025 demo](https://preview.aclanthology.org/setup/2025.naacl-demo.5)
- Even when LLM generations contain grounding acts, they differ from human grounding behavior, with poor human-LM agreement (NAACL 2024). — [NAACL 2024 long paper 348](https://aclanthology.org/2024.naacl-long.348.pdf)
- Detecting unanswerable questions in conversational information seeking is described as a "novel, still unsolved task", with no public dataset as of 2024. A sentence-level classifier aggregated upward beat ChatGPT-3.5. — [Łajewska & Balog 2024](https://arxiv.org/pdf/2401.11452)

**Thread / segment models**
- Kummerfeld et al. (ACL 2019) annotated 77,563 Ubuntu IRC messages with reply-structure graphs. That is 16x larger than all prior disentanglement data combined. They found that a widely used dialogue corpus derived from IRC had missing or extra messages in about 80% of its conversations. — [Kummerfeld et al., ACL 2019](https://aclanthology.org/P19-1374/); [arXiv 1810.11118](https://arxiv.org/abs/1810.11118)
- LLM-era disentanglement: fine-tuned decoder LLMs predict reply-to links and then cluster them into threads, scoring 0.90 Shen F and 0.87 one-to-one when applied zero-shot to Discord developer chat (CASCON 2025). Out-of-the-box GPT-4o performs poorly; fine-tuned GPT-4o-mini roughly matches small models trained from scratch (LREC 2026). Zero-shot ChatGPT/GPT-4 fell well short of supervised models on Ubuntu IRC (EMNLP 2023). — [CASCON 2025](https://conf.researchr.org/details/cascon-2025/technical-papers-track/38/Revisiting-Thread-Disentanglement-in-Technical-Chat-with-Fine-Tuned-LLMs-and-Graph-Ba); [LREC 2026](https://preview.aclanthology.org/ingest-lrec/2026.lrec-main.229/); [Tan et al., EMNLP 2023](https://arxiv.org/abs/2310.16301v1); [CEUR workshop 2026](https://ceur-ws.org/Vol-4178/paper2.pdf)
- Zero-shot ChatGPT topic segmentation reached 91.33% and 80.46% of SOTA F1 on CNTD and TIAGE. It does well when topic shifts are clear and worse on "aimless" chat or domain-specific transitions. — [ChatGPT discourse analysis study, arXiv 2305.08391](https://arxiv.org/pdf/2305.08391)
- F1-style boundary metrics for dialogue topic segmentation often reflect annotation **granularity mismatch** more than boundary quality (Dec 2025). — [Coen, arXiv 2512.17083](https://arxiv.org/abs/2512.17083v2)

### Inferences
- In a branching chat, the human creates the threads explicitly by branching, so the system does **not** need to solve disentanglement. That avoids the area where zero-shot LLMs are weakest. Disentanglement-style link prediction is still useful for one narrow job: suggesting "this trunk message actually answers parked question Q3".
- The representations are complementary layers, not competitors. **[Synthesis]** Recommended layered model:
  1. **Transcript graph** (ground truth): an append-only message log. Each message has a `parent` pointer, which makes it a tree of branches. A typed **cross-reference edge** overlay turns it into a DAG, following SDRT's multi-parent units.
  2. **Issue graph** (QUD layer): questions as first-class nodes with status, anchored to text spans, arranged as question/sub-question (Roberts-style strategy). The *active* path is a focus stack per branch (Grosz-Sidner push/pop, GoDiS QUD stack).
  3. **Commitment store / state doc** (KoS FACTS, common ground): decisions, facts, assumptions, open issues. Versioned and owned by the trunk.
  4. **Entity registry**: stable IDs for co-referring entities (see the Graphologue `$N1` scheme in Q2).
- A QUD-style issue graph is the best fit for "branch thoughts while keeping a central context". A branch is literally "a sub-question pushed onto the stack", and a merge is "the sub-question resolved, with its answer added to the commitment store". RST/SDRT relation labels are useful for analytics but are not needed for the UX loop.

### Gaps
- I found no LLM-era implementation of Grosz-Sidner focus-stack tracking specifically.
- I found no benchmark for "open loop / pending question" detection in human-AI chat. The closest is answerability detection in conversational search ([Łajewska & Balog](https://arxiv.org/pdf/2401.11452)). Detecting that "the user asked X three turns ago and it was never answered" appears unstudied as a named task.
- I could not access the QUDSelect (EMNLP 2024) content or the primary text of *The Interactive Stance*. The KoS details come from secondary formalizations.

---

## 2. Live modeling during generation: can a model emit structural markers alongside prose so the UI can hang branch points on them?

### Takeaway
Yes. There is direct, peer-reviewed precedent. Graphologue (UIST 2023) had GPT-4 annotate entities, co-reference IDs, relationships, and saliency **inline while streaming**, and parsed the partial stream in real time to build diagrams. Its documented failure modes are format drift and redundant tokens, which are fixable with prompting and a correction pass. Modern APIs also offer a structured side channel: Anthropic's fine-grained tool streaming streams tool-input JSON fragments as they are generated, with the caveat that partial or invalid JSON can arrive. Incremental discourse parsing (Llamipa) shows that richer structure can be updated turn by turn, but it requires a fine-tuned model and is better run asynchronously.

### Cited Findings
- Graphologue "constructs an interactive diagram in real-time as GPT-4 text responses are streamed in". It "employs novel prompting strategies to have LLMs recognize and annotate entities and relationships inline within the generated responses". — [Graphologue, Jiang et al., UIST 2023 (PDF)](https://hci.ucsd.edu/papers/graphologue.pdf); [arXiv 2305.11473](https://arxiv.org/pdf/2305.11473)
- Inline format examples: entity `[AI systems ($N1)]`; relationship `[divided into ($H, $N1, $N9, $H, $N1, $N10)]`, where `$H`/`$L` mark high/low saliency. GPT-4 assigned one identifier per co-referent concept ("Artificial Intelligence (AI)", "AI systems", and "It" all became `$N1`). The client "parses them in real-time, removes inline annotations for the interface, extracts entities and relationships". — [Graphologue](https://hci.ucsd.edu/papers/graphologue.pdf)
- GPT-4 sometimes annotated a relationship with an entity's ID *before* that entity appeared, so the UI drew a **placeholder node** that filled in as text arrived. — [Graphologue](https://hci.ucsd.edu/papers/graphologue.pdf)
- Observed annotation errors included assistant-style preambles, inconsistent format (missing brackets), conjunctive adverbs tagged as entities, and tokens repeated inside and outside annotations. The authors fixed these with prompt rules plus a second-round re-annotation pass for dead-end relationships and orphan entities. — [Graphologue](https://hci.ucsd.edu/papers/graphologue.pdf)
- Graphologue also prompted the model to structure responses as **separate paragraphs, each focused on a single theme**, mapping one diagram per paragraph. That is a section-anchor scheme. — [Graphologue](https://hci.ucsd.edu/papers/graphologue.pdf)
- In Graphologue's formative study (10 participants), users found responses long-winded and often hit "Stop generating". They wanted to ask directly about a specific line ("Oh, what does this line mean?") and to bookmark/annotate parts of responses. — [Graphologue](https://hci.ucsd.edu/papers/graphologue.pdf)
- Anthropic fine-grained tool streaming (`eager_input_streaming: true` per tool) "delivers a tool's input to your client as Claude generates it, without server-side buffering or JSON validation". Fragments arrive as `input_json_delta` events. Caveat: "you might receive partial or invalid JSON", and `max_tokens` can cut a parameter midway. — [Claude docs: Fine-grained tool streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming)
- Llamipa parses SDRT **incrementally**, using previously inferred structure to attach each new unit. That is the right shape for live, turn-by-turn updates. — [Llamipa](https://arxiv.org/html/2406.18256v3)
- QUD generation by LLMs is unreliable on anchor relevance and givenness. — [QUDeval](https://arxiv.org/pdf/2310.14520)

### Inferences
- **[Synthesis] Two-channel emission.** (a) Lightweight **inline anchors** in the prose stream, Graphologue-style, e.g. `⟦a:7 kind=claim⟧ … ⟦/a⟧`, with kinds `section | claim | definition | conclusion | open_question | assumption`. These give stable span IDs while text is still streaming. (b) Optionally, an end-of-turn **structural tool call** such as `record_structure({open_questions[], conclusions[], commitments_delta[], entities[]})`, streamed with fine-grained tool streaming. The prose stays clean, and the structure arrives as validated JSON at the turn boundary.
- Anchors that the *model* emits are cheap and reliable for segmentation (sections and paragraphs). Model-proposed *open questions* should be shown as **suggestions** the human confirms, because QUDeval shows LLM-generated questions often fail anchor relevance and givenness.
- Keep markers in the API-side history and strip them only for display. The model can then refer back to `a:7` in later turns, and the cached prefix stays byte-identical across requests. This is an inference from the exact-prefix rule in Q3.
- The human can select arbitrary text while it streams. A UI anchor therefore needs a fallback: `messageId + char offsets + quoted text`, re-resolved once the message completes. Model anchors become the "snap targets".
- Run heavy parsing (SDRT/RST, entity linking, commitment extraction) **asynchronously after each turn** with a small or cheap model. Do not block the stream on it.

### Gaps
- I found no study measuring how inline annotation affects answer quality or latency for current-generation (2025-2026) models. Graphologue's results are GPT-4-era.
- I found no published "anchorable response" standard or API feature beyond Graphologue's approach and generic structured or tool streaming.

---

## 3. Context bundling: what must a branch inherit, what should it not see, and how do prompt-caching economics shape this?

### Takeaway
There are three bundling policies. **Full-prefix fork** inherits everything up to the branch point (Claude Code fork, Agent SDK `fork_session`, ChatGPT "Branch in new chat"). **Ancestor-path only** gives a branch its own path to the root (ChatGraPhT). **Summary-seeded** branches start from a summary or a selected subset (Conversation Tree Architecture's ϕ↓; fresh subagents). Prompt caching strongly favors the full-prefix fork: a branch that reuses the trunk's exact prefix reads it at 0.1x base input price (0.05x on Opus 5.5 / Sonnet 5.5), while any rewritten or summarized prefix pays a fresh cache write. Isolation research says branches should *not* see siblings or exploratory noise. ContextBranch cut context by 58% and improved quality, and multi-turn LLMs degrade about 39% on average because early assumptions get locked in. Users also report not knowing "what the branch knows". The recommended default is therefore **byte-identical trunk prefix up to the anchor, plus an explicit branch preamble**, with a visible context manifest.

### Cited Findings
**Caching mechanics (Anthropic API)**
- The cache keys on the full prompt (`tools` → `system` → `messages`) up to and including the block marked `cache_control`. "Cache hits require 100 percent identical prompt segments." Changing an earlier level invalidates that level and everything after it. — [Claude docs: Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Up to 4 breakpoints are allowed. Marking a block writes exactly one entry, for the prefix ending at that block. On a miss, the system walks backward up to **20 blocks** looking for entries that earlier requests wrote. Automatic caching moves the breakpoint to the last cacheable block of each request. — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- TTL is 5 minutes by default, refreshed at no cost on each use, or 1 hour via `"ttl": "1h"`. Pricing: 5-min write 1.25x base input, 1-hour write 2x, read 0.1x (Opus 5.5 / Sonnet 5.5: 0.05x). Minimum cacheable length is 512 tokens on current models. "A cache entry only becomes available after the first response starts." — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Changing thinking parameters or `output_config.effort` always invalidates the message cache. — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Fork semantics in Anthropic tooling**
- Agent SDK: "Fork … creates a new session that starts with a copy of the original's history. The original stays unchanged." It is set with `resume=<id>, fork_session=True` (Python) or `forkSession: true` (TS). "Forking branches the conversation history, not the filesystem." — [Agent SDK: Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- The same page recommends an alternative to shipping transcripts: "Capture the results you need (analysis output, decisions, file diffs) as application state and pass them into a fresh session's prompt". That is the summary-seeded policy. — [Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- Claude Code forked subagent: "A fork is a subagent that inherits the entire conversation so far … same system prompt, tools, model, and message history". "The fork's own tool calls still stay out of your conversation and only its final result comes back". In the comparison table, prompt cache is "Shared with main session" (fork) vs "Separate cache" (non-fork subagent). "Its first request reuses the parent's prompt cache … a fork costs less than a fresh subagent". "A fork can't spawn further forks." — [Claude Code: Subagents, "Fork the current conversation"](https://code.claude.com/docs/en/sub-agents)
- Claude Code commands split branching into distinct verbs. `/branch` creates a branch and switches you into it, with the original recoverable via `/resume`. `/fork` copies the conversation into a new background session. `/subtask` spawns a forked subagent whose result returns to this conversation. `/btw` asks a side question without adding to history. `/rewind` can "summarize from a selected message". — [Claude Code: Commands](https://code.claude.com/docs/en/commands). (Note: third-party posts describe earlier versions where `/fork` was an alias of `/branch`. The current official docs supersede them; see [claudelog](https://claudelog.com/faqs/what-is-branch-command-in-claude-code/) and [wmedia.es](https://wmedia.es/en/tips/claude-code-fork-vs-branch-en).)
- `/btw` side questions see "your messages, its replies, and the tool results", but "The question and answer never enter the conversation history". They replay the newest 20 side exchanges. They are available **while Claude is responding** and see "everything in the conversation so far, except the reply Claude is still writing". They have no tool access. They are "Low cost: while the conversation's prompt cache is warm". Pressing `f` forks the side Q&A into a background subagent with full tools. — [Claude Code: Interactive mode, "Side questions with /btw"](https://code.claude.com/docs/en/interactive-mode)

**Other branch-context policies**
- ChatGPT's "Branch in new chat" (Sept 2025) forks at a chosen reply with prior context carried over. The original stays intact, and branches can be branched again. (Secondary reporting.) — [TechRadar](https://www.techradar.com/ai-platforms-assistants/chatgpt/chatgpt-has-added-a-great-new-feature-and-its-one-i-know-ill-be-using-a-lot); [BGR](https://bgr.com/1959993/chatgpt-branch-conversations-new-feature-now-available/)
- In ChatGraPhT's first prototype (ChatGPTree), each branch receives only its own path back to the root. (Search-result summary; the abstract page does not detail this.) — [ChatGraPhT, arXiv 2512.22790](https://arxiv.org/abs/2512.22790)
- CanvasConvo: "A branch duplicates the conversation history up to a chosen message". — [CanvasConvo, arXiv 2605.15848](https://arxiv.org/html/2605.15848v2)
- Conversation Tree Architecture (Mar 2026) defines a downstream selection function ϕ↓ for initializing a child. It lists as open questions which units to pass, and whether to pass them verbatim, as extractive summaries, or as abstractive compressions. The prototype supports only full-parent or empty context. — [CTA, arXiv 2603.21278](https://arxiv.org/html/2603.21278v1)

**Why isolate**
- LLMs show an average ~39% performance drop in multi-turn, underspecified conversations vs single-turn. Models "make assumptions in early turns and prematurely attempt to generate final solutions, on which they overly rely", and "when LLMs take a wrong turn … they get lost and do not recover". (The abstract says 200,000+ simulated conversations; one mirror says 20,000+.) — [Laban et al., arXiv 2505.06120](https://arxiv.org/abs/2505.06120)
- ContextBranch (Dec 2025) uses checkpoint, branch, switch, and inject primitives. On 30 software-engineering scenarios, branched conversations scored 2.5% higher overall quality (Cohen's d≈0.73), with focus +4.6% and context awareness +6.8% (peak +13.2% in complex scenarios), and **reduced context size by 58.1% (31.0→13.0 messages)**. It also cites prior work finding that adding 10% irrelevant content cut accuracy by 23%. — [ContextBranch, arXiv 2512.13914](https://arxiv.org/abs/2512.13914)
- CanvasConvo field study participant P23: "I didn't know what the branch knows and what it doesn't know." — [CanvasConvo](https://arxiv.org/html/2605.15848v2)

### Inferences
- **[Synthesis] Default policy: "frozen trunk prefix + branch preamble".**
  - Branch request = `system` + `tools` (identical to trunk) + trunk messages `[0 … forkPoint]` **byte-identical** + one new user block (the *branch preamble*) + branch turns.
  - The preamble contains: the quoted anchor passage, the question, a scope contract ("answer this sub-question; do not advance the main task; end with a `conclusion` block"), and a snapshot pointer to the commitment-store version at fork time.
  - Branch semantics are **ancestor-path**: the branch does *not* see trunk turns after the fork point, sibling branches, other parked questions, or `/btw` chatter. This follows ContextBranch and CTA isolation and avoids Laban-style assumption lock-in from unrelated threads.
  - The UI shows a **context manifest** per branch ("Knows: trunk through turn 14, state doc v6. Doesn't know: turns 15-22, branches B2 and B4"). This directly answers CanvasConvo P23's confusion.
- **Cache economics.** Branches that share the trunk prefix pay about 0.1x (0.05x on Opus 5.5) for the shared part on each turn while the cache is warm. A summary-seeded branch pays a full write (1.25x/2x) for a new prefix and loses the trunk's detail. Summary seeding only wins when the trunk is huge *and* the branch question is narrow and self-contained.
- **Cache nuance for lazy branches.** Old prefix entries expire after 5 minutes without use. Reading the trunk's *longer* prefix does not refresh the *shorter* entry at the fork point, because each entry is a separate hash. A branch opened 30 minutes after pinning will usually pay a full rewrite of the prefix up to the fork point, once, and then read from cache. Options: (a) accept it, since one write is cheap relative to long branch sessions; (b) use the 1-hour TTL for sessions with parked questions (2x write); (c) note that the 20-block lookback means a branch whose breakpoint is within 20 blocks of a still-warm trunk entry gets a partial hit.
- **Thinking/effort settings.** Changing thinking or effort invalidates the message cache. Branches should therefore inherit the trunk's model, thinking, and effort settings unless the user deliberately changes them, and the UI should warn that doing so "re-reads the whole trunk at full price".
- **Trunk centrality.** Nothing from a branch enters the trunk except through an explicit confluence (Q4). New trunk content is always **appended at the tail**, never inserted mid-history (see Q4 on why ContextBranch's mid-history injection is cache-hostile).
- **`/btw` as tier 0.** A `/btw`-style ephemeral question needs no branch at all: it sees the whole prefix, writes nothing to history, and costs little with a warm cache. Escalating it with `f` to a fork is a clean promotion path: **ephemeral → parked → branch**.

### Gaps
- I found no empirical comparison of full-prefix vs ancestor-path vs summary-seeded branch context on answer quality. CTA explicitly lists this as open; ContextBranch compares only branch vs linear.
- I found no public data on real-world cache-hit rates for branching chat UIs.

---

## 4. Merge semantics: how should a finished branch's conclusion return to the trunk?

### Takeaway
Every precedent teaches one lesson. Git distinguishes **merge** (join histories), **squash** (one combined change), **cherry-pick** (selected commits), and **rebase** (replay onto a newer base). ContextBranch implements cherry-pick-style "inject" with a coherence check. Zulip and Google Docs model conclusion as a **resolution status** on the thread: a ✔ topic or resolved comment that stays retrievable and can be reopened. Slack lets an author **broadcast one thread reply** into the main channel. Peer review uses a **point-by-point** response that quotes each item and points to where the document changed. Wikum shows that **recursive summaries** let readers explore at several levels. Research prototypes (CanvasConvo, CTA) admit merging is the weakest part: users found merging and comparing branches hard, and CTA's upstream merge is manual. The recommended default is a squash-style confluence: a resolution record on the anchor, plus one compact confluence message appended to the trunk tail, plus a human-approved diff to the trunk's state doc.

### Cited Findings
- Git: `git merge` joins two or more development histories. `git merge --squash` produces the combined working-tree change without recording a merge commit. `git cherry-pick` applies the changes introduced by selected existing commits. `git rebase` reapplies commits on top of another base tip. — [git-merge](https://git-scm.com/docs/git-merge); [git-cherry-pick](https://git-scm.com/docs/git-cherry-pick); [git-rebase](https://git-scm.com/docs/git-rebase)
- ContextBranch maps "merge commits ↔ insight injection". Users explicitly choose messages to inject (no CRDT-style auto-merge). Injected assistant messages are validated against the target's context: "injecting 'Let's use Rust' into a Python-focused branch would fail validation if the target has already committed to a Python-only solution". Injected messages are inserted "after the shared checkpoint history but before target-specific messages". — [ContextBranch](https://arxiv.org/abs/2512.13914)
- CTA: the upstream merge function ψ↑ is parameterized by merge position (end-append vs chronological), relevance filtering, and condensation granularity, and all of these are unresolved. "Upstream merging is currently manual, the user specifies what to carry back." CTA also defines **volatile** nodes that "carry no persistent state" and must be merged upward or purged at session end. — [CTA](https://arxiv.org/html/2603.21278v1)
- CanvasConvo: users "found merging or comparing branches difficult, and the tree structure supports divergence but not merging". — [CanvasConvo](https://arxiv.org/html/2605.15848v2)
- ChatGraPhT lets users "branch and merge ideas, edit past messages", with agentic assistants suggesting ways to combine ideas. It is an early exploratory prototype without quantitative results. — [ChatGraPhT](https://arxiv.org/abs/2512.22790)
- Claude Code `/subtask`: "When it finishes, its result arrives as a message in your main conversation". Only the fork's final result returns; its tool calls stay out. — [Claude Code: Subagents](https://code.claude.com/docs/en/sub-agents)
- Zulip: "Each conversation within a channel is labeled with a topic". Messages can be moved and topics renamed, split, or moved, so misplaced content can be corrected after the fact. New messages in a long-running topic bring it back to the top. — [Why Zulip](https://zulip.com/why-zulip/); [Move content to another topic](https://zulip.com/help/move-content-to-another-topic)
- Zulip resolve: a resolved topic gets a ✔ prefix. Notification Bot posts a notice. Topics are filterable via `is:resolved` / `-is:resolved`. Topics can be unresolved, and the notice is removed if unresolved immediately. Purpose: "Resolving topics makes it easy to track the status of each question, investigation, or notification." — [Zulip: Resolve a topic](https://zulip.com/help/resolve-a-topic)
- Slack: threads "help you create organized discussions around specific messages … without adding clutter". To show a reply in the main view, "check the box below your message" before sending, or use "Send reply to this channel" afterward. The Threads view lists threads with unread replies at the top. — [Slack Help: Use threads](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions-)
- Google Docs: "When a discussion is finished, you can resolve a comment to close it". Resolved comments "remain accessible" and can be **Re-opened**. Comments can assign action items to a person; a follow-up count shows open items on the file. — [Google Docs Help: comments](https://support.google.com/docs/answer/65129)
- Peer review responses: quote each reviewer comment verbatim, number them (R1.1, R1.2), answer each directly, and indicate the corresponding manuscript changes with page and line references. Editors check the revised manuscript against the letter. — [CASRAI guide](https://casrai.org/guides/how-to-write-a-response-to-reviewers-letter); [Editage](https://www.editage.com/insights/tips-for-responding-to-peer-reviewers)
- Wikum (CSCW 2017): readers or editors recursively summarize parts of a thread, then summarize the summaries. The resulting hierarchy "enables a reader to explore distinct subtopics at multiple levels of detail". The summary tree helped readers find and explore main topics better than the original discussion. MIT News reported faster reading, more accurate recall, and 40% faster edits. — [Wikum paper](https://homes.cs.washington.edu/~axz/papers/wikum.pdf); [MIT News](https://news.mit.edu/2017/cutting-down-clutter-in-online-conversations-0309)
- Tilda (CSCW 2018 Best Paper): lets participants tag and summarize chat *while conversing*. Users catching up with Tilda-enriched summaries "felt less hurried". Interviewees valued structured signals such as discourse acts. — [Tilda paper](https://homes.cs.washington.edu/~axz/papers/cscw_tilda.pdf); [project page](https://homes.cs.washington.edu/~axz/tilda.html)

### Inferences
- **What each precedent teaches (synthesis mapping):**
  | Precedent | Lesson for confluence |
  |---|---|
  | git merge (full) | Do **not** merge whole branch transcripts into the trunk. That reintroduces the pollution that branching avoided (ContextBranch, Laban). |
  | git squash | Default: one compact **confluence message** at the trunk tail. |
  | git cherry-pick / ContextBranch inject | Advanced: pick specific claims or messages to carry back, with a coherence check against trunk commitments. |
  | git rebase | When the trunk has moved since the fork, offer "re-check against current trunk" before merging. That means a cheap LLM pass over commitments added after the fork point. |
  | Zulip ✔ / Google Docs resolve | The branch gets a **status** and stays retrievable and reopenable. Resolution is a state change, not a deletion. |
  | Slack "send to channel" | The human explicitly chooses what crosses into the main flow. |
  | Peer review point-by-point | The confluence is keyed by question, quotes the question, gives the answer, and says *where the state doc changed*. |
  | Wikum | A collapsed branch shows its summary. Expanding reveals sub-summaries, then the transcript (multi-level). |
- **[Synthesis] Recommended confluence = squash + annotate + state-diff:**
  1. **Resolution record** attached to the anchor/question. Status becomes `resolved` (✔). It holds a one-paragraph answer, confidence, and a link to the branch. It is visible as a chip on the anchored passage, like a resolved comment.
  2. **Confluence message** appended to the **trunk tail** as a user-role (or system-annotated) block: `Q3 (anchored at a:7) resolved: <answer>. Changes: <state-doc diff summary>. Based on trunk@turn14.` Appending at the tail preserves the trunk's cached prefix. ContextBranch-style mid-history insertion would change the prefix at the insertion point and force a full cache rewrite of everything after it (inference from the exact-prefix rule).
  3. **State-doc diff** (commitments added, changed, or retracted), proposed by the model and accepted, edited, or rejected by the human, point-by-point.
  - Merge modes offered: `squash` (default), `cherry_pick` (select claims), `note_only` (resolution record, nothing in trunk context), `discard` (abandon, like CTA volatile purge), and `defer`.
- The trunk model learns about branch outcomes only through confluence messages and the state doc. The trunk context stays central and grows by about one compact message per resolved branch.
- **Conflict handling:** if a branch conclusion contradicts a trunk commitment made *after* the fork point, mark the confluence `stale/conflict` and offer "rebase" (re-ask the branch question against the current trunk prefix) or "override" (the human edits the state doc).

### Gaps
- I found no user study comparing merge styles (summary message vs anchored note vs state-doc edit) in LLM chat. CTA conjectures chronological insertion beats end-append but has not tested it.
- I could not confirm a published Slack-threads usability study (CSCW) beyond Slack's own help text and third-party comparisons.

---

## 5. Interaction design: cataloging questions while the speaker is talking, parked questions, navigation, collapse, parallel vs lazy, cognitive load

### Takeaway
The building blocks already exist and are partly validated. Claude Code's `/btw` lets a user ask *while the model is still writing*, without touching history. Interruption research says deferring to coarse task breakpoints cuts interruption cost. Branching UIs (Branchat, CanvasConvo) improve perceived workload and overview when the structure sits **beside** a primary linear chat rather than replacing it. Field data shows people keep chat as the main mode, use the canvas selectively, and nest at most about two levels deep. The known cliffs are "a graveyard of half-finished ideas", dozens of parallel tabs, not knowing what a branch knows, the cost of switching between canvas and chat, and the classic hypertext disorientation and cognitive overhead.

### Cited Findings
- `/btw` is "Available while Claude is working … The side question runs independently and doesn't interrupt the main turn". Q&A appear in a dismissible overlay. The five newest earlier side questions show as a dimmed list. Users can step between earlier answers. — [Claude Code: Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Claude Code forks appear "in a panel below your prompt" with one row per fork. A finished successful fork's row is removed. The user can open a fork's transcript to steer it. — [Claude Code: Subagents](https://code.claude.com/docs/en/sub-agents)
- Interruptions at task breakpoints lower interruption cost (resumption lag, frustration, errors). **Coarser breakpoints give larger reductions.** Fine, medium, and coarse breakpoints can be reliably perceived, and OASIS scheduled notifications at detected breakpoints. — [Iqbal & Bailey, TOCHI 2010](https://www.interruptions.net/literature/Iqbal-TOCHI10.pdf); [Iqbal & Bailey, CHI 2008](https://www.interruptions.net/literature/Iqbal-CHI08.pdf); [Iqbal & Bailey, CHI 2007](https://www.interruptions.net/literature/Iqbal_Bailey-CHI07.pdf)
- Branchat: a tree-structured interface beside the linear transcript. In a within-subject study (n=12) vs linear chat, participants reported **lower perceived workload** and higher usability, trust, and self-efficacy. (From the ACM DL abstract via search; full text returned 403.) — [Branchat, ACM DOI 10.1145/3772363.3798792](https://dl.acm.org/doi/full/10.1145/3772363.3798792)
- CanvasConvo formative study (8 heavy users): 6/8 kept separate documents to preserve outputs ("I spend half my time scrolling up…"). 7/8 struggled to explore alternatives; one kept "15 to 20 ChatGPT tabs open at any time"; another said, "My chat looks like a graveyard of half-finished ideas." — [CanvasConvo](https://arxiv.org/html/2605.15848v2)
- CanvasConvo field study (24 participants, 5 days, 165 conversations, 1,225 messages): chat accounted for 47.2% of events, canvas 28.3%, sidebar 11.4%. There were 79 branches (M=3.29 per participant), including 15 sub-branches, with a **maximum nesting depth of two**. Zoom was the most frequent canvas action (881), then node selection (246) and search (94). SUS was 78.9. NASA-TLX was low-moderate, with mental demand and effort the highest subscales. 96% said they could maintain an overview. Pain points: "Switching between canvas and chat was confusing"; "I didn't know what the branch knows"; "I never ended up using the canvas due to force of habits". The canvas features were semantic zoom (4 levels), a minimap, a timeline, and auto-generated branch summaries and labels. — [CanvasConvo](https://arxiv.org/html/2605.15848v2)
- Sensecape (UIST 2023) offered canvas and hierarchy views for moving between levels of abstraction. Users explored more topics and structured knowledge hierarchically. — [Sensecape, arXiv 2305.11483](https://arxiv.org/pdf/2305.11483)
- Hypertext "lost in hyperspace" (Conklin 1987) splits the problem into **disorientation** (knowing where you are, where you came from, and how to get elsewhere) and **cognitive overhead** (the effort of deciding which links to follow, and of keeping several tasks or trails in mind). — [Wikipedia: Lost in hyperspace](https://en.wikipedia.org/wiki/Lost_in_hyperspace); [Theng & Thimbleby, J.UCS](https://www.jucs.org/jucs_4_11/addressing_design_and_usability/Theng_Y_L.html)
- Tilda showed that lightweight in-flow markup (tags, summaries) during group chat makes later catch-up feel less hurried. — [Tilda](https://homes.cs.washington.edu/~axz/papers/cscw_tilda.pdf)
- Google Docs surfaces open action items as a follow-up count on the file. — [Google Docs Help](https://support.google.com/docs/answer/65129)

### Inferences
**[Synthesis] Core interaction loop**
1. **Pin while streaming.** The user selects any text in the in-progress reply (or clicks a model anchor's gutter dot) and types a question. It is saved as a `Question` in the **Question Inbox** with status `parked`. Nothing is sent to the trunk model and the stream is not interrupted. Graphologue's formative finding that users want to ask "what does this line mean?" is the motivating need.
2. **Optional instant peek (tier 0).** A "peek" button runs a `/btw`-style ephemeral answer from the warm cache: no history write, no tools, single response. If the peek answers it, the user marks it resolved (note_only). Otherwise they promote it.
3. **Surface at coarse breakpoints.** Parked questions are shown at the **end of the trunk turn** (the coarse breakpoint), never mid-stream. That means a compact inbox chip ("3 parked") plus inline gutter markers on the anchored spans. The model may *optionally* receive "unresolved parked questions" as a short end-of-prompt list only if the user opts in ("let the assistant address these in passing").
4. **Open branch (lazy by default).** Selecting a parked question opens a branch at its anchor's message using the frozen-prefix policy from Q3. Breadcrumb: `Trunk › Q3 "why TLS 1.0 …"`. A context manifest sits at the top of the branch.
5. **Conclude → confluence review.** The user (or the model, via a `conclusion` anchor) proposes a conclusion. A point-by-point review panel shows the answer, the state-doc diff, and the merge mode. On accept, a ✔ chip appears on the anchor, a confluence message is appended to the trunk, and the branch collapses.
6. **Return.** The user jumps back to the trunk tail. The trunk shows a one-line confluence card that expands Wikum-style: summary → sub-summaries → full branch.

**Navigation recommendation**
- The primary surface is a **linear chat**, with a **narrow tree/outline sidebar** (Branchat pattern) and **breadcrumbs**. A spatial canvas is an *optional overview mode*, not the main mode, because CanvasConvo shows chat stays primary, the canvas is used selectively, and switching modes costs effort.
- **Depth cap of 2** (trunk → branch → sub-branch). This matches observed behavior (max depth 2) and Claude Code's "a fork can't spawn further forks".
- A "river position" indicator in the header: `MAIN` vs `TRIBUTARY Q3 (forked at turn 14 · trunk now at turn 22)`.

**Parallel vs lazy**
- **Lazy** is the default for *thinking* questions that need human steering. It costs nothing until visited; the one-time cache rewrite is noted in Q3.
- **Background (parallel)** is opt-in per question for *research* questions that need no steering ("look up X", "check Y against the docs"). It is modeled on `/subtask`: the result returns as a confluence *proposal*, not auto-merged.
- Cap concurrent background branches (e.g., 3). The rest queue. Every background result adds review load.

**Cognitive-load cliffs and mitigations (synthesis, based on the findings above)**
| Cliff | Evidence | Mitigation |
|---|---|---|
| Too many open branches | "graveyard of half-finished ideas", 15-20 tabs | Inbox WIP limit; stale-question nudges at session end ("4 parked, 2 older than 1h: resolve, discard, or keep?"); CTA-style volatile branches auto-purge unless kept |
| Not knowing what a branch knows | CanvasConvo P23 | Context manifest per branch; "stale" badge when trunk advanced past a conflicting commitment |
| Orientation loss on canvas | Conklin disorientation; CanvasConvo mode-switch confusion | Chat-first; synchronized selection between views; timeline; breadcrumb always visible |
| Decision overhead | Conklin cognitive overhead | Model-suggested questions appear dimmed and opt-in; never auto-branch |
| Interrupting the speaker | Iqbal & Bailey breakpoints | Pin silently; surface only at turn end |

**[Synthesis] Data model sketch (TypeScript-ish)**
```ts
type Id = string;
interface Session { id: Id; trunkBranchId: Id; stateDocId: Id; model: string; thinkingCfg: object; cacheTtl: '5m'|'1h'; }
interface Branch {
  id: Id; sessionId: Id; parentBranchId: Id | null;       // null = trunk
  forkPointMessageId: Id | null; questionId: Id | null;
  contextPolicy: 'frozen_prefix' | 'path_only' | 'summary_seeded';
  baseTrunkTurn: number; stateDocVersionAtFork: number;
  mode: 'lazy' | 'background'; depth: 0|1|2;
  status: 'idle'|'running'|'awaiting_human'|'concluded'|'merged'|'discarded'|'stale';
}
interface Message {
  id: Id; branchId: Id; parentId: Id | null; role: 'user'|'assistant'|'confluence';
  rawContent: string;        // includes inline anchor markup; sent to API verbatim (cache-stable)
  displayContent: string;    // markup stripped
  anchors: Anchor[]; turnIndex: number; createdAt: string;
}
interface Anchor { id: Id; messageId: Id; source: 'model'|'user';
  kind: 'section'|'claim'|'definition'|'conclusion'|'open_question'|'assumption'|'selection';
  charStart: number; charEnd: number; quote: string; }
interface Question { id: Id; anchorId: Id | null; text: string; origin: 'human'|'model_suggested';
  status: 'draft'|'parked'|'peeked'|'active'|'resolved'|'discarded'|'reopened';
  branchId?: Id; createdAtTurn: number; priority?: number; }
interface Confluence { id: Id; branchId: Id; questionId: Id;
  mergeMode: 'squash'|'cherry_pick'|'note_only'|'discard'|'defer';
  answer: string; confidence: 'low'|'med'|'high'; pickedMessageIds?: Id[];
  stateDiff: StateOp[]; basedOnTrunkTurn: number; conflict?: string;
  appendedTrunkMessageId?: Id; status: 'proposed'|'accepted'|'edited'|'rejected'; }
interface StateDoc { id: Id; version: number; entries: StateEntry[]; }
interface StateEntry { id: Id; kind: 'decision'|'fact'|'assumption'|'open_issue'|'definition';
  text: string; sourceAnchorIds: Id[]; status: 'active'|'retracted'; }
type StateOp = { op: 'add'|'update'|'retract'; entry: StateEntry };
interface CrossRef { from: Id; to: Id; type: 'answers'|'elaborates'|'contradicts'|'refers_to'; } // DAG overlay
```

**[Synthesis] Event list**
`stream.anchor.opened/closed` (model markup parsed mid-stream) · `stream.turn.completed` (coarse breakpoint) · `selection.made` · `question.pinned` · `question.peeked` · `question.parked` · `question.suggested` (model) · `question.promoted` · `branch.opened` · `branch.turn.completed` · `branch.background.started/finished` · `branch.conclusion.proposed` · `confluence.proposed` · `confluence.accepted/edited/rejected` · `state.diff.applied` · `branch.collapsed` · `branch.marked_stale` (trunk commitment conflict) · `branch.rebased` · `question.reopened` · `crossref.added` · `inbox.surface` (fires on `stream.turn.completed` / session end) · `session.end.review`.

**[Synthesis] UI states**
- Trunk view: `streaming` (selection pinning enabled, inbox chip silent) → `idle` (inbox chip shows count, gutter markers visible) → `reviewing_confluence` (point-by-point panel).
- Question chip: `draft → parked → (peeked) → active → resolved ✔ | discarded`, with `resolved → reopened → active`.
- Branch panel: `idle | running | awaiting_human | concluded | merged (collapsed card) | stale (amber, rebase CTA)`.
- Overview: `outline sidebar (default) | canvas (opt-in) | timeline`.

### Gaps
- I found no study of "pin a question mid-stream" for LLM output specifically. The design rests on `/btw` as a shipped precedent plus interruption research.
- I found no quantitative threshold ("N open branches") for cognitive overload in branching chat. The only behavioral data is CanvasConvo's M≈3.3 branches per participant and max depth 2.
- Branchat's full results (effect sizes, the exact NASA-TLX values) were not accessible (ACM 403).

---

## 6. The river-basin metaphor (Bejan's constructal law): useful, and where does it break?

### Takeaway
Use it as a metaphor, not a model. Constructal law frames tree-shaped flow networks (river basins) as architectures that evolve to ease flow. That gives useful vocabulary: main channel, tributary, confluence, and "the tributary contributes its discharge, not its watershed". But constructal law is contested as a law, and conversational branching is topologically different. Branches **split from** the trunk and **rejoin** it, which is closer to an *anabranching* river (channels divided by islands) than a dendritic basin. Conversations also cross-reference laterally and flow "upstream" when a resolved question reopens.

### Cited Findings
- Bejan & Lorente's review "Constructal law of design and evolution: Physics, biology, technology, and society" (J. Appl. Phys. 113, 151301, 2013, DOI 10.1063/1.4798429) presents the constructal law as a physics principle linking design and evolution, from fluid flow to technology and social organization. — [Duke Scholars record](https://scholars.duke.edu/individual/pub952426)
- Supportive: Reis (2006, *Geomorphology*) argues that river-basin scaling laws (Horton, Hack) can be anticipated from constructal theory, with drainage networks as flow architectures minimizing overall resistance. — [Reis 2006 record](https://rc.cplp.org/Record/rcaap_b382572ab073f15daa1938cbb9b346f5/Description)
- Critical (HESS-D 2006 open discussion comments): a scientific law needs a clear meaning, a stated domain, and an application rule, and the constructal law "presents significant problems in this regard". Travertine streams self-organize with drag effectively *maximized*, which is offered as a counterexample. Commenters say the law cannot deduce actual patterns, and that process-based or maximum-entropy-production views explain cases better. These are discussion-stage comments, not peer-reviewed rebuttals, and I did not map each claim to a specific commenter. — [HESS-D S499](https://hess.copernicus.org/preprints/3/S499/2006/hessd-3-S499-2006.pdf); [HESS-D S503](https://hess.copernicus.org/preprints/3/S503/2006/hessd-3-S503-2006.pdf); [HESS-D S769](https://hess.copernicus.org/preprints/3/S769/2006/hessd-3-S769-2006.pdf)
- Real rivers are not only dendritic. Anabranches form as erosional channels in floodplains, or from mid-channel bars growing into long-lived islands "that divide previously wider channels". They can also form from delta distributary systems. Braided channels form progressively through migration and avulsion. — [Nanson, Anabranching and anastomosing rivers](https://ro.uow.edu.au/smhpapers/1940); [Baghmati River anabranching study](https://ui.adsabs.harvard.edu/abs/2004Geomo..60..147J/abstract)
- Discourse structure in multiparty dialogue is a graph in which units can have two parents (SDRT), not a strict tree. — [Llamipa](https://arxiv.org/html/2406.18256v3)

### Inferences
- **Where the metaphor helps (synthesis):**
  - *Main channel = trunk context.* It carries the accumulated flow, and everything downstream depends on it, so protect it.
  - *Confluence returns discharge, not the watershed.* The trunk receives the branch's *result* (squash / confluence message), not its whole transcript. This is the strongest and most actionable use of the metaphor.
  - *Flow economy.* Constructal "ease of flow" maps loosely onto cache economics: shared upstream prefixes are cheap (0.1x reads), and every new channel (new prefix) costs construction (a cache write).
- **Where it breaks:**
  1. **Direction of branching.** Drainage tributaries originate *outside* the main channel and only converge. Conversational branches *diverge from* the trunk and then rejoin. The right hydrological analog is the **anabranch** (split around an island, rejoin downstream) or a **distributary** that later reconnects. Use "anabranch" if a precise term is needed.
  2. **Cross-references.** Rivers don't send water sideways between non-adjacent tributaries. Conversations do: "as we found in Q2…". This calls for the DAG overlay (SDRT multi-parent; CTA's lateral transfer ξ).
  3. **Time reversal.** Water never flows upstream, but a resolved question can be **reopened** (Zulip unresolve, Google Docs re-open) and a branch can be **rebased** onto a later trunk. Rivers have no equivalent of rebase.
  4. **Optimization target.** Constructal theory is about minimizing resistance to flow. A conversation optimizes for *understanding and decisions*, and sometimes deliberately adds resistance (critique branches, devil's-advocate branches).
  5. **Scientific status.** The law's universality is disputed (HESS-D critiques). Present the river idea in product language as a *design metaphor*, not as a physical justification.
- **UI vocabulary suggestion:** "Main" / "Side channel" / "Rejoin" for normal users; "trunk / branch / confluence" in developer docs.

### Gaps
- I found no HCI literature that evaluates river or constructal metaphors for conversation UIs specifically.
- I did not retrieve Bejan's direct responses to the HESS-D critiques.
