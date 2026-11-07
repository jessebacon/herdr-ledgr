"""ledgr spool writer: one small JSON file per event in ledgr-data/spool/, written atomically
(dot-named temp file, then rename), named <ms>-<type>-<pid>-<rand>.json. The panel copy ingests
and deletes them. No agent-specific dependencies: any producer (the Claude Code hooks, a later MCP
stdio server) can import this and call emit() or one of the builders.

Envelope (every event): {v: 1, id: uuid, type, at: ms, terminal, session_id} + payload.

type            when                                  payload
session_start   session starts, resumes, clears       agent, source, model, cwd, transcript_path,
                                                      session_name, repo, turn, config_dir|null,
                                                      profile|null
prompt          a prompt is submitted                 turn, prompt_id, local, prompt_head (2,000
                                                      chars), refs ["A5", "Q3"], config_dir|null,
                                                      profile|null
pending         at once when a turn ends              turn, passage_hash
stop            when the turn's message id is known   turn, prompt_id, text_path, text_head (400
                (or the lookup gave up)               chars), passage_hash, message_uuid|null,
                                                      api_message_id|null
asks            extraction finished                   turn, prompt_id, message_uuid|null,
                                                      api_message_id|null, passage_hash, source
                                                      (block|model|skip|error), asks[], model,
                                                      provider, usage, ms, error, block_error,
                                                      extract_request_id, [error_detail], [truncated]
session_end     session ends (optional hook)          turn, reason
compacted       SessionStart with source "compact"    turn (the session's turn when it was
                (Phase 2)                             compacted), trigger|null
branch_started  SessionStart with source "fork" in a  parent_session_id, item_id, anchor_turn,
                process that carries LEDGR_PARENT     fork_turn, depth, branch_id|null, source
                (Phase 2; the ledgr branch launcher)  ("fork"); the envelope's session_id and
                                                      terminal are the child's
confluence_landed  UserPromptSubmit whose prompt starts  turn (the trunk's new turn), branch_id,
                (Phase 3)                             item_id, prompt_id, conclusion_head|null;
                with "ledgr confluence <branch id>    the envelope's session_id is the session the
                <item id>" (lib/ledgr_landing.py)     prompt was submitted in. Emitted after prompt
answers_landed  UserPromptSubmit whose prompt starts  turn, for_session (the marker's session id),
                (Phase 3)                             handles ["A3"], answers {"A3": text (400)},
                with "ledgr answers <session id>"     prompt_id. Emitted after prompt
act             the agent closes asks the user        item (an item id), action ("resolve"), arg
                answered (bin/mcp resolve_asks)       (null), actor ("agent"), handle ("A4"),
                                                      turn|null, [note] (one line, 200 chars); the
                                                      panel's own act events carry none of actor,
                                                      handle, turn or note
Written by the mod, not here: capture (a full Request), act (the person's), retry, branch (the panel's
Branch confirmation: item, branch_id, placement, isolate), forget (session_id), conclude (Phase 3:
branch_id, item, text, message, source, source_turn), close_branch (Phase 3: branch_id),
clear_questions (the panel's Clear N: session_id, keep ["branched", "rejoin_pending"]; every open or
deferred parked question without a branch is dismissed, dismissedBy "clear").

Branch environment (set by the launcher with `env` in the argv, read by ledgr_map.branch_env):
  LEDGR_PARENT = <parent session id>:<item id>:<anchor turn>
  LEDGR_BRANCH = <branch id>:<depth>:<fork turn>:<child session id>   (optional; any part may be
                 empty: fork turn then comes from the parent's record, depth from its depth + 1)

passage_hash: sha1 of the whitespace-collapsed final message, first 12 hex chars. Each ask also
carries `hash` (the same rule over its quote, else its text), `origin`, `repeat_of` and
`repeat_of_handle`. Order per turn: pending, then stop, then asks.
"""
import os

import ledgr_core as C


def emit(etype, terminal, sid, payload, at=None):
    """Write one event; returns its id."""
    at = at or C.now_ms()
    ev = {"v": 1, "id": C.new_uuid(), "type": etype, "at": at, "terminal": terminal, "session_id": sid}
    ev.update(payload)
    C.write_json(C.path("spool", f"{at}-{etype}-{os.getpid()}-{os.urandom(3).hex()}.json"), ev)
    return ev["id"]


def session_start(t, sid, *, agent, source, model, cwd, transcript_path, session_name, repo, turn,
                  config_dir=None, profile=None, at=None):
    return emit("session_start", t, sid, {"agent": agent, "source": source, "model": model, "cwd": cwd,
                                          "transcript_path": transcript_path, "session_name": session_name,
                                          "repo": repo, "turn": turn, "config_dir": config_dir,
                                          "profile": profile}, at)


def prompt(t, sid, *, turn, prompt_id, local, prompt_head, refs, config_dir=None, profile=None, at=None):
    return emit("prompt", t, sid, {"turn": turn, "prompt_id": prompt_id, "local": local,
                                   "prompt_head": prompt_head[:2000], "refs": refs,
                                   "config_dir": config_dir, "profile": profile}, at)


def pending(t, sid, *, turn, passage_hash, at=None):
    return emit("pending", t, sid, {"turn": turn, "passage_hash": passage_hash}, at)


def stop(t, sid, *, turn, prompt_id, text_path, text_head, passage_hash, message_uuid=None,
         api_message_id=None, at=None):
    return emit("stop", t, sid, {"turn": turn, "prompt_id": prompt_id, "text_path": text_path,
                                 "text_head": (text_head or "")[:400], "passage_hash": passage_hash,
                                 "message_uuid": message_uuid, "api_message_id": api_message_id}, at)


def asks(t, sid, *, turn, prompt_id, message_uuid, api_message_id, passage_hash, result, at=None):
    """`result` is the dict ledgr_extract.extract() returns (source, asks, model, provider, ...)."""
    p = {"turn": turn, "prompt_id": prompt_id, "message_uuid": message_uuid,
         "api_message_id": api_message_id, "passage_hash": passage_hash}
    p.update(result)
    return emit("asks", t, sid, p, at)


def session_end(t, sid, *, turn, reason, at=None):
    return emit("session_end", t, sid, {"turn": turn, "reason": reason}, at)


def compacted(t, sid, *, turn, trigger=None, at=None):
    return emit("compacted", t, sid, {"turn": turn, "trigger": trigger}, at)


def branch_started(t, sid, *, parent_session_id, item_id, anchor_turn, fork_turn, depth, branch_id=None,
                   source="fork", at=None):
    return emit("branch_started", t, sid, {"parent_session_id": parent_session_id, "item_id": item_id,
                                           "anchor_turn": anchor_turn, "fork_turn": fork_turn, "depth": depth,
                                           "branch_id": branch_id, "source": source}, at)


def confluence_landed(t, sid, *, turn, branch_id, item_id, prompt_id=None, conclusion_head=None, at=None):
    return emit("confluence_landed", t, sid, {"turn": turn, "branch_id": branch_id, "item_id": item_id,
                                              "prompt_id": prompt_id, "conclusion_head": conclusion_head}, at)


def answers_landed(t, sid, *, turn, for_session, handles, answers, prompt_id=None, at=None):
    return emit("answers_landed", t, sid, {"turn": turn, "for_session": for_session, "handles": list(handles),
                                           "answers": dict(answers), "prompt_id": prompt_id}, at)


def act(t, sid, *, item, action, actor, handle, turn=None, note=None, arg=None, at=None):
    """An act on one item from outside the panel (the panel writes its own): today only the MCP
    server's resolve_asks, actor "agent". The writer sets resolvedBy from actor."""
    p = {"item": item, "action": action, "arg": arg, "actor": actor, "handle": handle, "turn": turn}
    if note:
        p["note"] = note
    return emit("act", t, sid, p, at)
