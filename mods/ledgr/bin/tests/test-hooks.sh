#!/bin/bash
# ledgr hook tests (spec 9.2, extended). No Claude, no Herdr window: a temp data folder and fake
# hook inputs through the real entry scripts in adapters/claude/. Never reads the real Keychain
# item (LEDGR_KEYCHAIN_SERVICE names a service that does not exist), so every model path ends in
# the "no credential" result.     bash tests/test-hooks.sh
set -u
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
BIN="$(cd "$(dirname "$0")/.." && pwd)"; AD="$BIN/adapters/claude"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ledgr-test.XXXXXX")"
export LEDGR_DATA="$ROOT/data" HC_TERMINAL_ID=t99 LEDGR_KEYCHAIN_SERVICE=ledgr-test-missing-service
unset LEDGR_TERMINAL LEDGR_INNER LEDGR_ANTHROPIC_KEY HC_SCOPE LEDGR_OWNER_PID LEDGR_OWNER_COMM LEDGR_PARENT LEDGR_BRANCH
D="$LEDGR_DATA"; SID=11111111-2222-3333-4444-555555555555
TP="$ROOT/fake.jsonl"; : >"$TP"
P=0; F=0
ok() { if [ "$1" = 0 ]; then echo "PASS $2"; P=$((P+1)); else echo "FAIL $2"; F=$((F+1)); fi; }
t() { local name="$1"; shift; "$@" >/dev/null 2>&1; ok $? "$name"; }
script() { case "$1" in SessionStart) echo "$AD/session-start.sh";; UserPromptSubmit) echo "$AD/user-prompt-submit.sh";; Stop) echo "$AD/stop.sh";; SessionEnd) echo "$AD/session-end.sh";; esac; }
run() { printf '%s' "$2" | bash "$(script "$1")"; }
base='"session_id":"'$SID'","transcript_path":"'$TP'","cwd":"/tmp"'
PYQ=/opt/homebrew/bin/python3
sha12() { $PYQ -I -c 'import sys,re,hashlib; s=re.sub(r"\s+"," ",sys.stdin.read()).strip(); print(hashlib.sha1(s.encode()).hexdigest()[:12])'; }
J() { $PYQ -I -c 'import json,sys; print(json.dumps({"session_id":sys.argv[1],"transcript_path":sys.argv[2],"cwd":"/tmp","hook_event_name":"Stop","stop_hook_active":False,"last_assistant_message":sys.argv[3]}))' "$@"; }
ev() { jq -s -c --arg s "$1" --arg ty "$2" 'map(select(.session_id==$s and .type==$ty))' "$D"/spool/*.json 2>/dev/null; }
wait_ev() { local i; for i in $(seq 60); do [ "$(ev "$1" "$2" | jq length)" -ge 1 ] 2>/dev/null && return 0; sleep 0.25; done; return 1; }
now() { $PYQ -I -c 'import time; print(time.time())'; }

echo "== core (spec 9.2)"
out=$(run SessionStart "{$base,\"hook_event_name\":\"SessionStart\",\"source\":\"startup\",\"session_title\":\"t\"}")
out+=$(run UserPromptSubmit "{$base,\"hook_event_name\":\"UserPromptSubmit\",\"prompt_id\":\"p1\",\"prompt\":\"re [A2] go\"}")
out+=$(run UserPromptSubmit "{$base,\"hook_event_name\":\"UserPromptSubmit\",\"prompt_id\":\"p2\",\"prompt\":\"/btw why\"}")
out+=$(run Stop "{$base,\"hook_event_name\":\"Stop\",\"stop_hook_active\":false,\"last_assistant_message\":\"Done. Please confirm the deploy.\"}")
t "stdout empty for all hooks (instruct_block defaults to false)" test -z "$out"
t "map: session, turn 1, idle, agent claude-code, name, owner pid recorded" jq -e --arg s "$SID" '.session_id==$s and .turn==1 and .state=="idle" and .agent=="claude-code" and .session_name=="t" and .last_event=="Stop" and (.owner_pid|type)=="number" and (.owner_comm|type)=="string"' "$D/terminals/t99.json"
t "turn text saved" test "$(cat "$D/turns/$SID/1.md")" = "Done. Please confirm the deploy."
t "part A events: session_start, prompt x2, pending" test "$(/bin/ls "$D/spool" | grep -c -E -- '-(session_start|prompt|pending)-')" = 4
t "prompt refs == [A2]" jq -s -e 'map(select(.type=="prompt" and .local==false))[0].refs == ["A2"]' "$D"/spool/*-prompt-*.json
t "/btw is local and does not start a turn" jq -s -e 'map(select(.type=="prompt" and .local==true))[0].turn == 1' "$D"/spool/*-prompt-*.json
H=$(printf '%s' "Done. Please confirm the deploy." | sha12)
t "pending event at once: turn 1, passage_hash" jq -e --arg h "$H" '.[0].turn==1 and .[0].passage_hash==$h' <<<"$(ev $SID pending)"
wait_ev $SID asks
t "stop event from part B: turn, text_path, passage_hash, message_uuid null (no transcript record)" jq -e --arg h "$H" '.[0] | .turn==1 and .passage_hash==$h and (.text_path|endswith("/turns/'$SID'/1.md")) and .message_uuid==null and (has("api_message_id"))' <<<"$(ev $SID stop)"
t "order per turn: pending < stop < asks" jq -s -e --arg s $SID '[.[] | select(.session_id==$s and (.type=="pending" or .type=="stop" or .type=="asks"))] | sort_by(.at) | map(.type) == ["pending","stop","asks"]' "$D"/spool/*.json
t "session record: last_passage_hash, turn_base ledgr, prompt_id p1" jq -e --arg h "$H" '.last_passage_hash==$h and .turn_base=="ledgr" and .prompt_id=="p1"' "$D/sessions/$SID.json"
t "envelope fields on every event" jq -s -e 'all(.v==1 and (.id|length)==36 and (.at|type)=="number" and .terminal=="t99" and .session_id=="'$SID'")' "$D"/spool/*.json
t "config.json created: instruct_block false, provider anthropic, no things" jq -e '.instruct_block==false and .extract.provider=="anthropic" and .extract.audit_rate==0 and (has("things")|not)' "$D/config.json"
t "hook.log: one line per hook run" test "$(grep -c -E 't99 (SessionStart|UserPromptSubmit|Stop) ' "$D/log/hook.log")" = 4
t "no bytecode in the mod folder" test -z "$(find "$BIN" -name '__pycache__' -o -name '*.pyc')"

echo "== atomic and idempotent writes"
for i in $(seq 50); do run UserPromptSubmit "{$base,\"prompt_id\":\"x$i\",\"prompt\":\"q$i\"}" & done; wait
bad=0; for f in "$D"/spool/*.json "$D"/terminals/*.json "$D"/sessions/*.json; do jq -e . "$f" >/dev/null 2>&1 || bad=$((bad+1)); done
t "50 parallel prompts: every file parses" test "$bad" = 0
t "50 parallel prompts: turn 51 (the flock kept every increment)" jq -e '.turn==51' "$D/sessions/$SID.json"
run UserPromptSubmit "{$base,\"prompt_id\":\"dup\",\"prompt\":\"same prompt\"}"; run UserPromptSubmit "{$base,\"prompt_id\":\"dup\",\"prompt\":\"same prompt\"}"
t "same prompt_id delivered twice counts one turn (52)" jq -e '.turn==52' "$D/sessions/$SID.json"
t "no temp files left behind" test -z "$(find "$D/spool" "$D/terminals" "$D/sessions" -name '.tmp.*')"

echo "== guards"
G="$ROOT/guard"
out=$(printf '%s' "{$base,\"source\":\"startup\"}" | env -u HC_TERMINAL_ID LEDGR_DATA="$G" bash "$AD/session-start.sh")
t "no HC_TERMINAL_ID and no LEDGR_TERMINAL: no output, nothing written" test -z "$out" -a ! -e "$G"
out=$(printf '%s' "{$base,\"source\":\"startup\"}" | LEDGR_INNER=1 LEDGR_DATA="$G" bash "$AD/session-start.sh")
t "LEDGR_INNER set: exits at once, nothing written" test -z "$out" -a ! -e "$G"
printf '%s' "{$base,\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"hi\"}" | env -u HC_TERMINAL_ID LEDGR_TERMINAL=iterm-2 bash "$AD/user-prompt-submit.sh"
t "LEDGR_TERMINAL override maps terminal iterm-2" jq -e '.terminal=="iterm-2" and .agent=="claude-code"' "$D/terminals/iterm-2.json"
printf '%s' "{\"session_id\":\"22222222-0000-0000-0000-000000000001\",\"cwd\":\"/tmp\",\"prompt\":\"hi\"}" | HC_TERMINAL_ID=vps/t7 bash "$AD/user-prompt-submit.sh" --agent codex
t "remote address vps/t7 -> vps__t7.json, --agent codex" jq -e '.terminal=="vps/t7" and .agent=="codex" and .transcript_path==null' "$D/terminals/vps__t7.json"
SA=77777777-0000-0000-0000-000000000001
printf '%s' "{\"session_id\":\"$SA\",\"cwd\":\"/tmp\",\"prompt\":\"hi\",\"agent_id\":\"agent-abc\",\"agent_type\":\"Explore\"}" | bash "$AD/user-prompt-submit.sh"
t "stdin with agent_id (subagent): ignored" test ! -e "$D/sessions/$SA.json"
printf '%s' "{\"session_id\":\"$SA\",\"cwd\":\"/tmp\",\"hook_event_name\":\"SubagentStop\",\"last_assistant_message\":\"Subagent finished the search and found 3 files to change.\"}" | bash "$AD/stop.sh"; sleep 1
t "SubagentStop JSON on the Stop entry: ignored, no extractor events" test ! -e "$D/sessions/$SA.json" -a "$(ev $SA asks | jq length)" = 0
printf 'not json' | bash "$AD/stop.sh"; ok $? "invalid stdin: exit 0"
printf '{}' | bash "$AD/stop.sh"; ok $? "no session_id: exit 0"
I="$ROOT/instr"; mkdir -p "$I"; echo '{"instruct_block": true}' >"$I/config.json"
out=$(printf '%s' "{$base,\"source\":\"startup\"}" | LEDGR_DATA="$I" bash "$AD/session-start.sh")
t "instruct_block true: SessionStart prints exactly the instruction" test "$out" = "$(cat "$BIN/lib/asks-instruction.txt")"
B="$ROOT/badcfg"; mkdir -p "$B"; echo '{broken' >"$B/config.json"
out=$(printf '%s' "{$base,\"source\":\"startup\"}" | LEDGR_DATA="$B" bash "$AD/session-start.sh")
t "invalid config.json: defaults used (no output), file left alone, record written" test -z "$out" -a "$(cat "$B/config.json")" = "{broken" -a -f "$B/sessions/$SID.json"

echo "== owner guard (a child agent cannot repoint the terminal)"
sleep 120 & LIVE=$!
OA=88888888-0000-0000-0000-00000000000a; OB=88888888-0000-0000-0000-00000000000b
printf '%s' "{\"session_id\":\"$OA\",\"cwd\":\"/tmp\",\"source\":\"startup\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$LIVE LEDGR_OWNER_COMM=sleep bash "$AD/session-start.sh"
printf '%s' "{\"session_id\":\"$OB\",\"cwd\":\"/tmp\",\"source\":\"startup\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$$ LEDGR_OWNER_COMM=bash bash "$AD/session-start.sh"
t "other session, other pid, owner alive: ignored (map unchanged, no record)" test "$(jq -r .session_id "$D/terminals/t50.json")" = $OA -a ! -e "$D/sessions/$OB.json"
printf '%s' "$(J $OB "$TP" "Child agent says: decide whether to keep the cache warm overnight or not.")" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$$ LEDGR_OWNER_COMM=bash bash "$AD/stop.sh"; sleep 1
t "ignored Stop starts no extractor (no pending/stop/asks)" test "$(ev $OB pending | jq length)$(ev $OB asks | jq length)" = 00
printf '%s' "{\"session_id\":\"$OA\",\"cwd\":\"/tmp\",\"source\":\"clear\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$LIVE LEDGR_OWNER_COMM=sleep bash "$AD/session-start.sh"
OC=88888888-0000-0000-0000-00000000000c
printf '%s' "{\"session_id\":\"$OC\",\"cwd\":\"/tmp\",\"source\":\"clear\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$LIVE LEDGR_OWNER_COMM=sleep bash "$AD/session-start.sh"
t "same pid, new session (/clear): accepted" test "$(jq -r .session_id "$D/terminals/t50.json")" = $OC
kill $LIVE 2>/dev/null; wait $LIVE 2>/dev/null
printf '%s' "{\"session_id\":\"$OB\",\"cwd\":\"/tmp\",\"source\":\"startup\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$$ LEDGR_OWNER_COMM=bash bash "$AD/session-start.sh"
t "owner gone: a new process takes the terminal" test "$(jq -r .session_id "$D/terminals/t50.json")" = $OB
jq '.owner_pid='$$' | .owner_comm="claude" | .session_id="88888888-0000-0000-0000-0000000000dd"' "$D/terminals/t50.json" >"$ROOT/m.json" && mv "$ROOT/m.json" "$D/terminals/t50.json"
OD=88888888-0000-0000-0000-00000000000e
printf '%s' "{\"session_id\":\"$OD\",\"cwd\":\"/tmp\",\"source\":\"startup\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=1234567 LEDGR_OWNER_COMM=claude bash "$AD/session-start.sh"
t "recorded pid alive but now another program (pid reuse): accepted" test "$(jq -r .session_id "$D/terminals/t50.json")" = $OD

echo "== extractor (no key)"
S2=33333333-0000-0000-0000-000000000002; S3=33333333-0000-0000-0000-000000000003; S4=33333333-0000-0000-0000-000000000004
S7=33333333-0000-0000-0000-000000000007; S8=33333333-0000-0000-0000-000000000008
LONG="I finished the migration and the tests pass. Before I merge, decide whether to squash the 14 commits or keep them, and send me the staging URL."
T0=$(now); run Stop "$(J $S2 "$TP" "$LONG")"; T1=$(now)
run Stop "$(J $S3 "$TP" "$(cat "$BIN/tests/fixtures/blocks/valid.md")")"
run Stop "$(J $S4 "$TP" "Short reply.")"
run Stop "$(J $S7 "$TP" "$(cat "$BIN/tests/fixtures/blocks/empty4.md") Then decide whether to keep the old cron job running.")"
run Stop "$(J $S8 "$TP" "$(cat "$BIN/tests/fixtures/blocks/broken.md")")"
ms=$($PYQ -I -c "print(int(($T1-$T0)*1000))")
t "Stop hook returns at once (${ms} ms incl. two python timers)" test "$ms" -lt 600
for s in $S2 $S3 $S4 $S7 $S8; do wait_ev $s asks; done
t "no key, no block: source error, 'no credential', detail names the Keychain item" jq -e '.[0] | .source=="error" and .error=="no credential" and (.error_detail|test("no keychain item")) and .asks==[] and (.passage_hash|length)==12 and .provider=="anthropic"' <<<"$(ev $S2 asks)"
t "no key, valid non-empty block: block asks processed (3, hash, origin)" jq -e '.[0] | .source=="block" and (.asks|length)==3 and all(.asks[]; (.hash|length)==12 and .origin=="extract_block") and .error==null' <<<"$(ev $S3 asks)"
t "short message: source skip" jq -e '.[0].source=="skip"' <<<"$(ev $S4 asks)"
t "empty block falls through to the model (here: no credential)" jq -e '.[0] | .source=="error" and .error=="no credential"' <<<"$(ev $S7 asks)"
t "invalid block falls through to the model, block_error kept" jq -e '.[0] | .source=="error" and .error=="no credential" and (.block_error|startswith("block:"))' <<<"$(ev $S8 asks)"
t "extractor left no temp files" test -z "$(find "$D/tmp" \( -name '.stop.*' -o -name '.req.*' \) 2>/dev/null)"

echo "== message uuid on stop and asks"
S5=44444444-0000-0000-0000-000000000005; TP5="$ROOT/t5.jsonl"; MSG5="The fix is in. Please confirm the deploy to staging before 5 pm today, and review the PR."
$PYQ -I -c 'import json,sys; print(json.dumps({"type":"assistant","uuid":"uuid-five","isSidechain":False,"message":{"id":"msg_five","content":[{"type":"text","text":sys.argv[1]}]}}))' "$MSG5" >"$TP5"
b5='"session_id":"'$S5'","transcript_path":"'$TP5'","cwd":"/tmp"'
run UserPromptSubmit "{$b5,\"prompt_id\":\"p5\",\"prompt\":\"go\"}"; run Stop "$(J $S5 "$TP5" "$MSG5")"; wait_ev $S5 asks
t "stop event carries message_uuid and api_message_id" jq -e '.[0] | .message_uuid=="uuid-five" and .api_message_id=="msg_five" and .turn==1 and .prompt_id=="p5"' <<<"$(ev $S5 stop)"
t "asks event carries them too" jq -e '.[0] | .message_uuid=="uuid-five" and .api_message_id=="msg_five"' <<<"$(ev $S5 asks)"
t "session record and map get last_assistant_uuid" jq -e '.last_assistant_uuid=="uuid-five"' "$D/sessions/$S5.json"
t "no settle events exist" test -z "$(/bin/ls "$D/spool" | grep -- -settle-)"

echo "== branches and compaction (Phase 2)"
PSID=66666666-0000-0000-0000-000000000001; CH=66666666-0000-0000-0000-0000000000c1
ss() { printf '%s' "{\"session_id\":\"$1\",\"cwd\":\"/tmp\",\"hook_event_name\":\"SessionStart\",\"source\":\"$2\",\"session_title\":\"Q1: why\"}"; }
ss $PSID startup | HC_TERMINAL_ID=t61 bash "$AD/session-start.sh"
for i in 1 2 3; do printf '%s' "{\"session_id\":\"$PSID\",\"cwd\":\"/tmp\",\"prompt_id\":\"pp$i\",\"prompt\":\"go $i\"}" | HC_TERMINAL_ID=t61 bash "$AD/user-prompt-submit.sh"; done
ss $CH fork | HC_TERMINAL_ID=t62 LEDGR_PARENT="$PSID:rq_item1:2" LEDGR_BRANCH="br_test1:1:3:$CH" bash "$AD/session-start.sh"
t "fork + LEDGR_PARENT: session record carries the lineage" jq -e --arg p $PSID '.parent_session_id==$p and .parent_item=="rq_item1" and .anchor_turn==2 and .fork_turn==3 and .depth==1 and .branch_id=="br_test1" and .last_source=="fork"' "$D/sessions/$CH.json"
t "fork + LEDGR_PARENT: map entry carries the lineage" jq -e --arg p $PSID '.parent_session_id==$p and .depth==1 and .fork_turn==3 and .anchor_turn==2 and .branch_id=="br_test1" and .parent_item=="rq_item1"' "$D/terminals/t62.json"
t "branch_started: child sid + terminal, parent, item, anchor, fork, depth, branch id" jq -e --arg p $PSID 'length==1 and (.[0] | .terminal=="t62" and .parent_session_id==$p and .item_id=="rq_item1" and .anchor_turn==2 and .fork_turn==3 and .depth==1 and .branch_id=="br_test1" and .source=="fork")' <<<"$(ev $CH branch_started)"
t "branch_started comes after session_start (later ms, so later in name order)" test "$(ev $CH branch_started | jq '.[0].at')" -gt "$(ev $CH session_start | jq '.[0].at')"
ss $CH fork | HC_TERMINAL_ID=t62 LEDGR_PARENT="$PSID:rq_item1:2" LEDGR_BRANCH="br_test1:1:3:$CH" bash "$AD/session-start.sh"
t "a repeated fork SessionStart for the same session: no second branch_started" test "$(ev $CH branch_started | jq length)" = 1
CH2=66666666-0000-0000-0000-0000000000c2
ss $CH2 fork | HC_TERMINAL_ID=t62 LEDGR_PARENT="$PSID:rq_item1:2" LEDGR_BRANCH="br_test1:1:3:$CH" bash "$AD/session-start.sh"
t "fork of another id in the branch's process (planned child differs): no lineage" test "$(ev $CH2 branch_started | jq length)" = 0 -a "$(jq -r .parent_session_id "$D/sessions/$CH2.json")" = null
CH3=66666666-0000-0000-0000-0000000000c3
ss $CH3 clear | HC_TERMINAL_ID=t63 LEDGR_PARENT="$PSID:rq_item1:2" bash "$AD/session-start.sh"
t "source clear with LEDGR_PARENT in the environment: no lineage, no event" test "$(ev $CH3 branch_started | jq length)" = 0 -a "$(jq -r .parent_session_id "$D/sessions/$CH3.json")" = null
CH4=66666666-0000-0000-0000-0000000000c4
ss $CH4 fork | HC_TERMINAL_ID=t64 LEDGR_PARENT="$PSID:rq_item9:1" bash "$AD/session-start.sh"
t "LEDGR_PARENT alone: fork turn from the parent's record (3), depth parent + 1 (1), no branch id" jq -e '.[0] | .fork_turn==3 and .depth==1 and .branch_id==null and .anchor_turn==1' <<<"$(ev $CH4 branch_started)"
CH5=66666666-0000-0000-0000-0000000000c5
ss $CH5 fork | HC_TERMINAL_ID=t65 LEDGR_PARENT="$CH:rq_item2:0" bash "$AD/session-start.sh"
t "a branch of a branch: depth 2 from the parent's record" jq -e '.[0].depth==2 and .[0].fork_turn==0' <<<"$(ev $CH5 branch_started)"
CH6=66666666-0000-0000-0000-0000000000c6
ss $CH6 fork | HC_TERMINAL_ID=t66 LEDGR_PARENT="not:a valid" bash "$AD/session-start.sh"
t "malformed LEDGR_PARENT: ignored (record written, no lineage, no event)" test -f "$D/sessions/$CH6.json" -a "$(ev $CH6 branch_started | jq length)" = 0 -a "$(jq -r .parent_session_id "$D/sessions/$CH6.json")" = null
ss $PSID compact | HC_TERMINAL_ID=t61 bash "$AD/session-start.sh"
t "compact: compacted event with the session's turn (3)" jq -e 'length==1 and .[0].turn==3 and .[0].terminal=="t61"' <<<"$(ev $PSID compacted)"
t "compact: record keeps compactions [{turn 3}], last_source compact, state still working" jq -e '(.compactions|length)==1 and .compactions[0].turn==3 and .last_source=="compact" and .state=="working"' "$D/sessions/$PSID.json"
t "compact: no branch_started for the parent" test "$(ev $PSID branch_started | jq length)" = 0

echo "== landing: confluence and answer sheet (Phase 3)"
LS=77777777-3333-0000-0000-000000000001
up() { $PYQ -I -c 'import json,sys; print(json.dumps({"session_id":sys.argv[1],"cwd":"/tmp","hook_event_name":"UserPromptSubmit","prompt_id":sys.argv[2],"prompt":sys.argv[3]}))' "$@"; }
upr() { up "$@" | HC_TERMINAL_ID=t70 bash "$AD/user-prompt-submit.sh"; }
nland() { ev $LS "$1" | jq length; }
BRID=br_0a1b2c3d-0000-4000-8000-00000000abcd; RQID=rq_0a1b2c3d-0000-4000-8000-00000000ef01
CONF="ledgr confluence $BRID $RQID
Parked question Q1, from turn 1: Why does the scan still flag TLS 1.0?
Conclusion:
answer: Because the binding on 8443 terminates TLS itself.
changes: none
I am adopting this branch's conclusion as the answer to Q1; the branch (br-q1-abcd, a fork of this conversation) saw the trunk through turn 2."
out=$(upr $LS l1 "go"); out+=$(upr $LS l2 "$CONF")
t "confluence prompt: stdout empty (nothing reaches the model's context)" test -z "$out"
t "confluence_landed: turn 2, branch and item ids, prompt id, conclusion head, terminal" jq -e --arg b $BRID --arg r $RQID 'length==1 and (.[0] | .turn==2 and .branch_id==$b and .item_id==$r and .prompt_id=="l2" and .terminal=="t70" and .conclusion_head=="Because the binding on 8443 terminates TLS itself.")' <<<"$(ev $LS confluence_landed)"
t "the confluence prompt still makes its prompt event (turn 2, not local)" jq -e 'map(select(.prompt_id=="l2")) | length==1 and .[0].turn==2 and .[0].local==false' <<<"$(ev $LS prompt)"
t "confluence_landed sorts after its prompt event (later ms, so later by name)" test "$(ev $LS confluence_landed | jq '.[0].at')" -gt "$(ev $LS prompt | jq 'map(select(.prompt_id=="l2"))[0].at')"
WRAP=$(printf '<pasted_content id="p1">\n%s\n</pasted_content id="p1">' "$CONF")
upr $LS l3 "$WRAP"
t "Claude's <pasted_content> wrapper lines around the paste: still detected" jq -e 'sort_by(.at) | length==2 and .[1].prompt_id=="l3" and .[1].turn==3' <<<"$(ev $LS confluence_landed)"
n=4
for p in "please read: ledgr confluence $BRID $RQID" "ledgr confluence $BRID" "ledgr confluence br_bad!id $RQID" "ledgr confluence $BRID $RQID extra" \
         "Ledgr Confluence $BRID $RQID" "two lines
of prose first
ledgr confluence $BRID $RQID" "ledgr confluence  $BRID $RQID" "hello world" "ledgr answers $LS"; do
  upr $LS "m$n" "$p"; n=$((n+1))
done
t "malformed or not-first-line markers, and ordinary prompts: no landing event" test "$(nland confluence_landed)$(nland answers_landed)" = 20
t "...and each still makes its ordinary prompt event (9 more)" test "$(ev $LS prompt | jq 'map(select(.prompt_id|startswith("m"))) | length')" = 9
SHEET="ledgr answers $LS
Answers to your asks from turn 2:
A1: Mozilla intermediate, as you recommended.
A3: after the reboot tonight;
carry on without it.
A12: yes"
out=$(upr $LS s1 "$SHEET")
t "answer sheet: stdout empty" test -z "$out"
t "answers_landed: for_session, handles in order, answers (a wrapped answer joined), turn" jq -e --arg s $LS 'length==1 and (.[0] | .for_session==$s and .handles==["A1","A3","A12"] and .answers.A1=="Mozilla intermediate, as you recommended." and .answers.A3=="after the reboot tonight; carry on without it." and .answers.A12=="yes" and .turn==13 and .prompt_id=="s1")' <<<"$(ev $LS answers_landed)"
upr $LS s2 "ledgr answers 99999999-0000-0000-0000-000000000009
A2: no"
t "a sheet naming another session: emitted with that for_session (the store ignores it)" jq -e 'sort_by(.at) | length==2 and .[1].for_session=="99999999-0000-0000-0000-000000000009" and .[1].handles==["A2"]' <<<"$(ev $LS answers_landed)"
upr $LS s3 "/btw ledgr answers $LS"
t "a local slash command is never a landing" test "$(nland answers_landed)" = 2

echo "== landing: lead-ins, pasted blocks, code fences (Phase 3)"
LF=77777777-3333-0000-0000-000000000002; FN='```'
uprf() { up "$@" | HC_TERMINAL_ID=t71 bash "$AD/user-prompt-submit.sh"; }
nlf() { ev $LF "$1" | jq length; }
out=$(uprf $LF f1 "Adopt this branch result for Q1:
$WRAP")
t "lead-in typed before a wrapped paste: detected (the marker is the block's first line), stdout empty" jq -e --arg b $BRID 'length==1 and .[0].prompt_id=="f1" and .[0].branch_id==$b and .[0].conclusion_head=="Because the binding on 8443 terminates TLS itself."' <<<"$(ev $LF confluence_landed)"
t "...and the hook printed nothing" test -z "$out"
uprf $LF f2 "Adopt this branch result for Q1:
$CONF"
t "lead-in line, then an unwrapped paste (a session that does not mark pastes): detected" jq -e 'sort_by(.at) | length==2 and .[1].prompt_id=="f2"' <<<"$(ev $LF confluence_landed)"
WRAPB=$(printf '<pasted_content id="b">\n%s\n</pasted_content id="b">' "$CONF")
uprf $LF f3 "First a log I pasted:
<pasted_content id=\"a\">
2026-11-05 17:48 deploy ok
</pasted_content id=\"a\">
and the branch result:
$WRAPB"
t "any pasted block counts: the marker in the second block is found" jq -e 'sort_by(.at) | length==3 and .[2].prompt_id=="f3"' <<<"$(ev $LF confluence_landed)"
uprf $LF f4 "Look at what the branch wrote:
$FN
$CONF
$FN"
uprf $LF f5 "Look:
$FN
$WRAP
$FN"
uprf $LF f6 "<pasted_content id=\"c\">
$FN
$CONF
$FN
</pasted_content id=\"c\">"
t "marker inside a code fence (unwrapped, around a wrapped paste, or as a fenced paste): ignored" test "$(nlf confluence_landed)" = 3
uprf $LF f7 "Adopt this: $CONF"
uprf $LF f8 "line one of prose
line two of prose
$CONF"
t "marker after text on its own line, or after two lines of prose (mid-paragraph): ignored" test "$(nlf confluence_landed)" = 3
t "...and the five ignored prompts still make their prompt events" test "$(ev $LF prompt | jq 'map(select(.prompt_id|test("^f[4-8]$"))) | length')" = 5
uprf $LF f9 "My answers:
<pasted_content id=\"d\">
ledgr answers $LF
Answers to your asks from turn 2:
A1: blue
</pasted_content id=\"d\">
A2: typed after the paste, not part of the sheet"
t "lead-in + wrapped answer sheet: answers_landed with the block's handles only" jq -e --arg s $LF 'length==1 and .[0].for_session==$s and .[0].handles==["A1"] and .[0].answers=={"A1":"blue"}' <<<"$(ev $LF answers_landed)"

echo "== layout"
$PYQ -I -B -S -c 'import sys; sys.path[:0]=[sys.argv[1]]; import ledgr_spool; bad=[m for m in sys.modules if m.startswith(("claude_","last_assistant","providers"))]; sys.exit(1 if bad else 0)' "$BIN/lib"
ok $? "lib/ledgr_spool imports with no Claude-specific or provider modules"

echo "== timing (20 runs each, wall time of the entry script)"
$PYQ -I - "$BIN" "$ROOT/timing" <<'PY'
import json, os, subprocess, sys, time
bin_, data = sys.argv[1], sys.argv[2]
env = dict(os.environ, LEDGR_DATA=data, HC_TERMINAL_ID="t98")
sid = "55555555-0000-0000-0000-000000000000"
scripts = {"SessionStart": "session-start.sh", "UserPromptSubmit": "user-prompt-submit.sh", "Stop": "stop.sh"}
conf = "ledgr confluence br_00000000-0000-4000-8000-000000000001 rq_00000000-0000-4000-8000-000000000002\nParked question Q1, from turn 1: why?\nConclusion:\nanswer: because\nThis is the result of branch br-q1-0001."
ins = [("SessionStart", "SessionStart", {"source": "startup"}), ("UserPromptSubmit", "UserPromptSubmit", {"prompt": "hello [A1]"}),
       ("  + confluence", "UserPromptSubmit", {"prompt": conf}), ("Stop", "Stop", {"last_assistant_message": "x" * 4000})]
worst = 0
for label, ev, extra in ins:
    ts = []
    for i in range(20):
        body = json.dumps(dict({"session_id": sid, "cwd": "/tmp", "transcript_path": "/dev/null",
                                "hook_event_name": ev, "prompt_id": f"{label[:4]}{i}"}, **extra)).encode()
        t0 = time.perf_counter()
        subprocess.run(["bash", os.path.join(bin_, "adapters", "claude", scripts[ev])], input=body, env=env,
                       stdout=subprocess.DEVNULL)
        ts.append((time.perf_counter() - t0) * 1000)
    ts.sort()
    print(f"  {label:17s} median {ts[10]:5.1f} ms  max {ts[-1]:5.1f} ms")
    worst = max(worst, ts[10])
print(f"  load average {os.getloadavg()[0]:.1f}")
sys.exit(0 if worst < 100 else 1)
PY
ok $? "median under 100 ms per hook"

for i in $(seq 60); do pgrep -f "$AD/claude_extract.py --input $ROOT" >/dev/null || break; sleep 0.25; done   # detached extractors
echo
echo "$P passed, $F failed   (data: $ROOT)"
[ "$F" = 0 ] && rm -rf "$ROOT"
[ "$F" = 0 ]
