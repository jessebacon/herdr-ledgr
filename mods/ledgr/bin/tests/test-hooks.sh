#!/bin/bash
# ledgr hook tests (spec 9.2, extended). No Claude, no Herdr window: a temp data folder and fake
# hook inputs through the real entry scripts in adapters/claude/. Never reads the real Keychain
# item (LEDGR_KEYCHAIN_SERVICE names a service that does not exist), so every model path ends in
# the "no credential" result.     bash tests/test-hooks.sh
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
BIN="$(cd "$(dirname "$0")/.." && pwd)"; AD="$BIN/adapters/claude"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ledgr-test.XXXXXX")"
OUTER_T="${HC_TERMINAL_ID:-}"      # this shell's own Herdr terminal, if any: the timing table's real `hc get`
export LEDGR_DATA="$ROOT/data" HC_TERMINAL_ID=t99 LEDGR_KEYCHAIN_SERVICE=ledgr-test-missing-service
unset LEDGR_TERMINAL LEDGR_INNER LEDGR_ANTHROPIC_KEY HC_SCOPE LEDGR_OWNER_PID LEDGR_OWNER_COMM LEDGR_PARENT LEDGR_BRANCH CLAUDE_CONFIG_DIR
unset FAKE_HC_SLEEP FAKE_HC_BAD
D="$LEDGR_DATA"; SID=11111111-2222-3333-4444-555555555555
TP="$ROOT/fake.jsonl"; : >"$TP"
# A fake `hc` (LEDGR_HC) keeps the run hermetic: `hc get <t> --json` prints $FAKE_HC_DIR/<t>.json, else
# exits 3 as hc does for an unknown terminal; FAKE_HC_SLEEP delays it, FAKE_HC_BAD prints a non-JSON line.
export FAKE_HC_DIR="$ROOT/hc" LEDGR_HC="$ROOT/fake-hc"; mkdir -p "$FAKE_HC_DIR"
cat >"$LEDGR_HC" <<'HC'
#!/bin/bash
[ "$1" = get ] && [ "$3" = --json ] || exit 2
[ -n "${FAKE_HC_SLEEP:-}" ] && sleep "$FAKE_HC_SLEEP" >/dev/null 2>&1
[ -n "${FAKE_HC_BAD:-}" ] && { echo "not json"; exit 0; }
f="$FAKE_HC_DIR/$2.json"
if [ -f "$f" ]; then cat "$f"; else echo '{"error":{"kind":"not_found"}}'; exit 3; fi
HC
chmod +x "$LEDGR_HC"
P=0; F=0
ok() { if [ "$1" = 0 ]; then echo "PASS $2"; P=$((P+1)); else echo "FAIL $2"; F=$((F+1)); fi; }
t() { local name="$1"; shift; "$@" >/dev/null 2>&1; ok $? "$name"; }
script() { case "$1" in SessionStart) echo "$AD/session-start.sh";; UserPromptSubmit) echo "$AD/user-prompt-submit.sh";; Stop) echo "$AD/stop.sh";; SessionEnd) echo "$AD/session-end.sh";; esac; }
run() { printf '%s' "$2" | bash "$(script "$1")"; }
base='"session_id":"'$SID'","transcript_path":"'$TP'","cwd":"/tmp"'
PYQ="${LEDGR_PYTHON:-}"
if [ -z "$PYQ" ] || [ ! -x "$PYQ" ]; then for PYQ in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do [ -x "$PYQ" ] && break; done; fi
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
t "SessionStart prints the instruction (instruct_block defaults to true); the other hooks print nothing" test "$out" = "$(cat "$BIN/lib/asks-instruction-ledgr.txt")"
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
t "config.json created: instruct_block and instruct_reinject true, provider anthropic, no things" jq -e '.instruct_block==true and .instruct_reinject==true and .extract.provider=="anthropic" and .extract.audit_rate==0 and (has("things")|not)' "$D/config.json"
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
printf '%s' "{$base,\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"hi\"}" | env -u HC_TERMINAL_ID LEDGR_TERMINAL=iterm-2 bash "$AD/user-prompt-submit.sh" >/dev/null
t "LEDGR_TERMINAL override maps terminal iterm-2 (no HC_TERMINAL_ID: no space lookup, space null)" jq -e '.terminal=="iterm-2" and .agent=="claude-code" and has("space") and .space==null' "$D/terminals/iterm-2.json"
printf '%s' "{\"session_id\":\"22222222-0000-0000-0000-000000000001\",\"cwd\":\"/tmp\",\"prompt\":\"hi\"}" | HC_TERMINAL_ID=vps/t7 bash "$AD/user-prompt-submit.sh" --agent codex >/dev/null
t "remote address vps/t7 -> vps__t7.json, --agent codex, space null" jq -e '.terminal=="vps/t7" and .agent=="codex" and .transcript_path==null and .space==null' "$D/terminals/vps__t7.json"
SA=77777777-0000-0000-0000-000000000001
printf '%s' "{\"session_id\":\"$SA\",\"cwd\":\"/tmp\",\"prompt\":\"hi\",\"agent_id\":\"agent-abc\",\"agent_type\":\"Explore\"}" | bash "$AD/user-prompt-submit.sh" >/dev/null
t "stdin with agent_id (subagent): ignored" test ! -e "$D/sessions/$SA.json"
printf '%s' "{\"session_id\":\"$SA\",\"cwd\":\"/tmp\",\"hook_event_name\":\"SubagentStop\",\"last_assistant_message\":\"Subagent finished the search and found 3 files to change.\"}" | bash "$AD/stop.sh"; sleep 1
t "SubagentStop JSON on the Stop entry: ignored, no extractor events" test ! -e "$D/sessions/$SA.json" -a "$(ev $SA asks | jq length)" = 0
printf 'not json' | bash "$AD/stop.sh"; ok $? "invalid stdin: exit 0"
printf '{}' | bash "$AD/stop.sh"; ok $? "no session_id: exit 0"
I="$ROOT/instr"; mkdir -p "$I"; echo '{"instruct_block": true}' >"$I/config.json"
out=$(printf '%s' "{$base,\"source\":\"startup\"}" | LEDGR_DATA="$I" bash "$AD/session-start.sh")
t "instruct_block true: SessionStart prints exactly the instruction" test "$out" = "$(cat "$BIN/lib/asks-instruction-ledgr.txt")"
B="$ROOT/badcfg"; mkdir -p "$B"; echo '{broken' >"$B/config.json"
out=$(printf '%s' "{$base,\"source\":\"startup\"}" | LEDGR_DATA="$B" bash "$AD/session-start.sh")
t "invalid config.json: defaults used (the instruction), file left alone, record written" test "$out" = "$(cat "$BIN/lib/asks-instruction-ledgr.txt")" -a "$(cat "$B/config.json")" = "{broken" -a -f "$B/sessions/$SID.json"
O="$ROOT/instr-off"; mkdir -p "$O"; echo '{"instruct_block": false}' >"$O/config.json"
out=$(printf '%s' "{$base,\"source\":\"startup\"}" | LEDGR_DATA="$O" bash "$AD/session-start.sh")
t "instruct_block false: SessionStart prints nothing" test -z "$out"

CF="$ROOT/claude-other"; mkdir -p "$CF/sessions"; SN=77777777-0000-0000-0000-0000000000c1
printf '{"pid": 1, "sessionId": "%s", "name": "second account"}' "$SN" >"$CF/sessions/1.json"
printf '%s' "{\"session_id\":\"$SN\",\"cwd\":\"/tmp\",\"source\":\"startup\"}" | CLAUDE_CONFIG_DIR="$CF" HC_TERMINAL_ID=t56 bash "$AD/session-start.sh" >/dev/null
t "CLAUDE_CONFIG_DIR: the session name comes from that folder's sessions/<pid>.json" jq -e '.session_name=="second account"' "$D/sessions/$SN.json"
SM=77777777-0000-0000-0000-0000000000c2
printf '{"pid": 2, "sessionId": "%s", "name": "from the transcript path"}' "$SM" >"$CF/sessions/2.json"
printf '%s' "{\"session_id\":\"$SM\",\"cwd\":\"/tmp\",\"source\":\"startup\",\"transcript_path\":\"$CF/projects/-tmp/$SM.jsonl\"}" | env -u CLAUDE_CONFIG_DIR HC_TERMINAL_ID=t57 bash "$AD/session-start.sh" >/dev/null
t "no CLAUDE_CONFIG_DIR: the folder above projects/ in the transcript path" jq -e '.session_name=="from the transcript path"' "$D/sessions/$SM.json"

echo "== config folder and profile (claude-work and the default)"
nrm() { $PYQ -I -c 'import os,sys; print(os.path.normpath(sys.argv[1]))' "$1"; }   # $TMPDIR may end in /
FP='{"session_id":"77777777-0000-0000-0000-0000000000f0","cwd":"/tmp","prompt_id":"q1","prompt":"hi"}'
out=$(printf '%s' "$FP" | HC_TERMINAL_ID=t61 bash "$AD/user-prompt-submit.sh")
t "a session first seen at a prompt (no SessionStart) gets the mode's wording there once" test "$out" = "$(cat "$BIN/lib/asks-instruction-ledgr.txt")"
t "default: no CLAUDE_CONFIG_DIR, no projects/ path: ~/.claude, profile default (record and map)" jq -e --arg c "$HOME/.claude" '.config_dir==$c and .profile=="default"' "$D/sessions/$SID.json" "$D/terminals/t99.json"
t "default: session_start and prompt events carry config_dir and profile" jq -s -e --arg s "$SID" --arg c "$HOME/.claude" '[.[] | select(.session_id==$s and (.type=="session_start" or .type=="prompt"))] | length > 0 and all(.config_dir==$c and .profile=="default")' "$D"/spool/*.json
t "pending carries no profile (only session_start and prompt do)" jq -s -e --arg s "$SID" '[.[] | select(.session_id==$s and .type=="pending")] | all(has("profile")|not)' "$D"/spool/*.json
t "a folder without .claude- keeps its name (claude-other)" jq -e --arg c "$(nrm "$CF")" '.config_dir==$c and .profile=="claude-other"' "$D/sessions/$SN.json"
MC="$ROOT/.claude-work"; mkdir -p "$MC"; SX=77777777-0000-0000-0000-0000000000d1
printf '%s' "{\"session_id\":\"$SX\",\"cwd\":\"/tmp\",\"source\":\"startup\",\"transcript_path\":\"$MC/projects/-tmp/$SX.jsonl\"}" | CLAUDE_CONFIG_DIR="$MC/" HC_TERMINAL_ID=t58 bash "$AD/session-start.sh" >/dev/null
printf '%s' "{\"session_id\":\"$SX\",\"cwd\":\"/tmp\",\"prompt_id\":\"m1\",\"prompt\":\"go\",\"transcript_path\":\"$MC/projects/-tmp/$SX.jsonl\"}" | CLAUDE_CONFIG_DIR="$MC/" HC_TERMINAL_ID=t58 bash "$AD/user-prompt-submit.sh" >/dev/null
t "CLAUDE_CONFIG_DIR=~/.claude-work/: config_dir absolute (no trailing slash), profile work, record and map" jq -e --arg c "$(nrm "$MC")" '.config_dir==$c and .profile=="work"' "$D/sessions/$SX.json" "$D/terminals/t58.json"
t "work: session_start and prompt events carry it" test "$(jq -s -c --arg s "$SX" '[.[] | select(.session_id==$s and (.type=="session_start" or .type=="prompt")) | [.type, .profile]] | sort' "$D"/spool/*.json)" = '[["prompt","work"],["session_start","work"]]'
SY=77777777-0000-0000-0000-0000000000d2
printf '%s' "{\"session_id\":\"$SY\",\"cwd\":\"/tmp\",\"prompt_id\":\"m2\",\"prompt\":\"go\",\"transcript_path\":\"$MC/projects/-tmp/$SY.jsonl\"}" | env -u CLAUDE_CONFIG_DIR HC_TERMINAL_ID=t59 bash "$AD/user-prompt-submit.sh" >/dev/null
t "no CLAUDE_CONFIG_DIR: work from the transcript path (folder above projects/)" jq -e --arg c "$(nrm "$MC")" '.config_dir==$c and .profile=="work"' "$D/sessions/$SY.json"
DC="$ROOT/home/.claude"; SZ=77777777-0000-0000-0000-0000000000d3
printf '%s' "{\"session_id\":\"$SZ\",\"cwd\":\"/tmp\",\"source\":\"startup\",\"transcript_path\":\"$DC/projects/-tmp/$SZ.jsonl\"}" | env -u CLAUDE_CONFIG_DIR HC_TERMINAL_ID=t60 bash "$AD/session-start.sh" >/dev/null
t "a .claude folder from the transcript path: profile default" jq -e --arg c "$(nrm "$DC")" '.config_dir==$c and .profile=="default"' "$D/sessions/$SZ.json"
# A session recorded before profiles existed picks them up at its next event.
jq 'del(.config_dir, .profile)' "$D/sessions/$SX.json" >"$ROOT/s.json" && mv "$ROOT/s.json" "$D/sessions/$SX.json"
printf '%s' "{\"session_id\":\"$SX\",\"cwd\":\"/tmp\",\"prompt_id\":\"m3\",\"prompt\":\"again\",\"transcript_path\":\"$MC/projects/-tmp/$SX.jsonl\"}" | CLAUDE_CONFIG_DIR="$MC" HC_TERMINAL_ID=t58 bash "$AD/user-prompt-submit.sh" >/dev/null
t "an older record without a profile gets it at its next prompt (record, map, event)" jq -e --arg c "$(nrm "$MC")" '.config_dir==$c and .profile=="work" and .turn==2' "$D/sessions/$SX.json" "$D/terminals/t58.json"
t "  ... and that prompt event carries it" jq -s -e --arg s "$SX" 'map(select(.session_id==$s and .type=="prompt" and .prompt_id=="m3")) | length==1 and .[0].profile=="work"' "$D"/spool/*.json

echo "== owner guard (a child agent cannot repoint the terminal)"
sleep 120 & LIVE=$!
OA=88888888-0000-0000-0000-00000000000a; OB=88888888-0000-0000-0000-00000000000b
printf '%s' "{\"session_id\":\"$OA\",\"cwd\":\"/tmp\",\"source\":\"startup\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$LIVE LEDGR_OWNER_COMM=sleep bash "$AD/session-start.sh" >/dev/null
printf '%s' "{\"session_id\":\"$OB\",\"cwd\":\"/tmp\",\"source\":\"startup\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$$ LEDGR_OWNER_COMM=bash bash "$AD/session-start.sh" >/dev/null
t "other session, other pid, owner alive: ignored (map unchanged, no record)" test "$(jq -r .session_id "$D/terminals/t50.json")" = $OA -a ! -e "$D/sessions/$OB.json"
printf '%s' "$(J $OB "$TP" "Child agent says: decide whether to keep the cache warm overnight or not.")" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$$ LEDGR_OWNER_COMM=bash bash "$AD/stop.sh"; sleep 1
t "ignored Stop starts no extractor (no pending/stop/asks)" test "$(ev $OB pending | jq length)$(ev $OB asks | jq length)" = 00
printf '%s' "{\"session_id\":\"$OA\",\"cwd\":\"/tmp\",\"source\":\"clear\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$LIVE LEDGR_OWNER_COMM=sleep bash "$AD/session-start.sh" >/dev/null
OC=88888888-0000-0000-0000-00000000000c
printf '%s' "{\"session_id\":\"$OC\",\"cwd\":\"/tmp\",\"source\":\"clear\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$LIVE LEDGR_OWNER_COMM=sleep bash "$AD/session-start.sh" >/dev/null
t "same pid, new session (/clear): accepted" test "$(jq -r .session_id "$D/terminals/t50.json")" = $OC
kill $LIVE 2>/dev/null; wait $LIVE 2>/dev/null
printf '%s' "{\"session_id\":\"$OB\",\"cwd\":\"/tmp\",\"source\":\"startup\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=$$ LEDGR_OWNER_COMM=bash bash "$AD/session-start.sh" >/dev/null
t "owner gone: a new process takes the terminal" test "$(jq -r .session_id "$D/terminals/t50.json")" = $OB
jq '.owner_pid='$$' | .owner_comm="claude" | .session_id="88888888-0000-0000-0000-0000000000dd"' "$D/terminals/t50.json" >"$ROOT/m.json" && mv "$ROOT/m.json" "$D/terminals/t50.json"
OD=88888888-0000-0000-0000-00000000000e
printf '%s' "{\"session_id\":\"$OD\",\"cwd\":\"/tmp\",\"source\":\"startup\"}" | HC_TERMINAL_ID=t50 LEDGR_OWNER_PID=1234567 LEDGR_OWNER_COMM=claude bash "$AD/session-start.sh" >/dev/null
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
run UserPromptSubmit "{$b5,\"prompt_id\":\"p5\",\"prompt\":\"go\"}" >/dev/null; run Stop "$(J $S5 "$TP5" "$MSG5")"; wait_ev $S5 asks
t "stop event carries message_uuid and api_message_id" jq -e '.[0] | .message_uuid=="uuid-five" and .api_message_id=="msg_five" and .turn==1 and .prompt_id=="p5"' <<<"$(ev $S5 stop)"
t "asks event carries them too" jq -e '.[0] | .message_uuid=="uuid-five" and .api_message_id=="msg_five"' <<<"$(ev $S5 asks)"
t "session record and map get last_assistant_uuid" jq -e '.last_assistant_uuid=="uuid-five"' "$D/sessions/$S5.json"
t "no settle events exist" test -z "$(/bin/ls "$D/spool" | grep -- -settle-)"

echo "== branches and compaction (Phase 2)"
PSID=66666666-0000-0000-0000-000000000001; CH=66666666-0000-0000-0000-0000000000c1
ss() { printf '%s' "{\"session_id\":\"$1\",\"cwd\":\"/tmp\",\"hook_event_name\":\"SessionStart\",\"source\":\"$2\",\"session_title\":\"Q1: why\"}"; }
ss $PSID startup | HC_TERMINAL_ID=t61 bash "$AD/session-start.sh" >/dev/null
for i in 1 2 3; do printf '%s' "{\"session_id\":\"$PSID\",\"cwd\":\"/tmp\",\"prompt_id\":\"pp$i\",\"prompt\":\"go $i\"}" | HC_TERMINAL_ID=t61 bash "$AD/user-prompt-submit.sh"; done
ss $CH fork | HC_TERMINAL_ID=t62 LEDGR_PARENT="$PSID:rq_item1:2" LEDGR_BRANCH="br_test1:1:3:$CH" bash "$AD/session-start.sh" >/dev/null
t "fork + LEDGR_PARENT: session record carries the lineage" jq -e --arg p $PSID '.parent_session_id==$p and .parent_item=="rq_item1" and .anchor_turn==2 and .fork_turn==3 and .depth==1 and .branch_id=="br_test1" and .last_source=="fork"' "$D/sessions/$CH.json"
t "fork + LEDGR_PARENT: map entry carries the lineage" jq -e --arg p $PSID '.parent_session_id==$p and .depth==1 and .fork_turn==3 and .anchor_turn==2 and .branch_id=="br_test1" and .parent_item=="rq_item1"' "$D/terminals/t62.json"
t "branch_started: child sid + terminal, parent, item, anchor, fork, depth, branch id" jq -e --arg p $PSID 'length==1 and (.[0] | .terminal=="t62" and .parent_session_id==$p and .item_id=="rq_item1" and .anchor_turn==2 and .fork_turn==3 and .depth==1 and .branch_id=="br_test1" and .source=="fork")' <<<"$(ev $CH branch_started)"
t "branch_started comes after session_start (later ms, so later in name order)" test "$(ev $CH branch_started | jq '.[0].at')" -gt "$(ev $CH session_start | jq '.[0].at')"
ss $CH fork | HC_TERMINAL_ID=t62 LEDGR_PARENT="$PSID:rq_item1:2" LEDGR_BRANCH="br_test1:1:3:$CH" bash "$AD/session-start.sh" >/dev/null
t "a repeated fork SessionStart for the same session: no second branch_started" test "$(ev $CH branch_started | jq length)" = 1
CH2=66666666-0000-0000-0000-0000000000c2
ss $CH2 fork | HC_TERMINAL_ID=t62 LEDGR_PARENT="$PSID:rq_item1:2" LEDGR_BRANCH="br_test1:1:3:$CH" bash "$AD/session-start.sh" >/dev/null
t "fork of another id in the branch's process (planned child differs): no lineage" test "$(ev $CH2 branch_started | jq length)" = 0 -a "$(jq -r .parent_session_id "$D/sessions/$CH2.json")" = null
CH3=66666666-0000-0000-0000-0000000000c3
ss $CH3 clear | HC_TERMINAL_ID=t63 LEDGR_PARENT="$PSID:rq_item1:2" bash "$AD/session-start.sh" >/dev/null
t "source clear with LEDGR_PARENT in the environment: no lineage, no event" test "$(ev $CH3 branch_started | jq length)" = 0 -a "$(jq -r .parent_session_id "$D/sessions/$CH3.json")" = null
CH4=66666666-0000-0000-0000-0000000000c4
ss $CH4 fork | HC_TERMINAL_ID=t64 LEDGR_PARENT="$PSID:rq_item9:1" bash "$AD/session-start.sh" >/dev/null
t "LEDGR_PARENT alone: fork turn from the parent's record (3), depth parent + 1 (1), no branch id" jq -e '.[0] | .fork_turn==3 and .depth==1 and .branch_id==null and .anchor_turn==1' <<<"$(ev $CH4 branch_started)"
CH5=66666666-0000-0000-0000-0000000000c5
ss $CH5 fork | HC_TERMINAL_ID=t65 LEDGR_PARENT="$CH:rq_item2:0" bash "$AD/session-start.sh" >/dev/null
t "a branch of a branch: depth 2 from the parent's record" jq -e '.[0].depth==2 and .[0].fork_turn==0' <<<"$(ev $CH5 branch_started)"
CH6=66666666-0000-0000-0000-0000000000c6
ss $CH6 fork | HC_TERMINAL_ID=t66 LEDGR_PARENT="not:a valid" bash "$AD/session-start.sh" >/dev/null
t "malformed LEDGR_PARENT: ignored (record written, no lineage, no event)" test -f "$D/sessions/$CH6.json" -a "$(ev $CH6 branch_started | jq length)" = 0 -a "$(jq -r .parent_session_id "$D/sessions/$CH6.json")" = null
ss $PSID compact | HC_TERMINAL_ID=t61 bash "$AD/session-start.sh" >/dev/null
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
Parked question Q1, from turn 1: Why does the load test still time out?
Conclusion:
answer: Because the gateway on 8443 opens its own connections.
changes: none
I am adopting this branch's conclusion as the answer to Q1; the branch (br-q1-abcd, a fork of this conversation) saw the trunk through turn 2."
upr $LS l1 "go" >/dev/null; out=$(upr $LS l2 "$CONF")     # the first prompt of a session with no SessionStart gets the mode's wording
t "confluence prompt: stdout empty (nothing reaches the model's context)" test -z "$out"
t "confluence_landed: turn 2, branch and item ids, prompt id, conclusion head, terminal" jq -e --arg b $BRID --arg r $RQID 'length==1 and (.[0] | .turn==2 and .branch_id==$b and .item_id==$r and .prompt_id=="l2" and .terminal=="t70" and .conclusion_head=="Because the gateway on 8443 opens its own connections.")' <<<"$(ev $LS confluence_landed)"
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
uprf $LF f0 "go" >/dev/null      # its first prompt carries the handoff wording (no SessionStart seen); landing adds nothing
out=$(uprf $LF f1 "Adopt this branch result for Q1:
$WRAP")
t "lead-in typed before a wrapped paste: detected (the marker is the block's first line), stdout empty" jq -e --arg b $BRID 'length==1 and .[0].prompt_id=="f1" and .[0].branch_id==$b and .[0].conclusion_head=="Because the gateway on 8443 opens its own connections."' <<<"$(ev $LF confluence_landed)"
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

echo "== landing: several messages in one prompt (two answer sheets)"
LM=77777777-3333-0000-0000-000000000003
uprm() { up "$@" | HC_TERMINAL_ID=t76 bash "$AD/user-prompt-submit.sh"; }
lmev() { ev $LM answers_landed | jq -c --arg p "$1" 'map(select(.prompt_id==$p)) | sort_by(.at)'; }
SH1="ledgr answers $LM
Answers to your asks from turn 18:
A11: Full version is good if that's your recommendation"
SH2="ledgr answers $LM
Answers to your asks from turn 18:
A12: shown session, skip branched and rejoining questions"
TWO='.[0].handles==["A11"] and .[0].answers=={"A11":"Full version is good if that'"'"'s your recommendation"} and .[1].handles==["A12"] and .[1].answers=={"A12":"shown session, skip branched and rejoining questions"}'
uprm $LM g0 "go" >/dev/null
out=$(uprm $LM w1 "$(printf '<pasted_content id="a">\n%s\n</pasted_content id="a">\n\n<pasted_content id="b">\n%s\n</pasted_content id="b">' "$SH1" "$SH2")")
t "two wrapped sheets in one prompt: two answers_landed, A11 then A12, each with its own answer" jq -e "length==2 and $TWO" <<<"$(lmev w1)"
t "...stdout empty" test -z "$out"
t "...both after the prompt event, the second 1 ms or more after the first" jq -e --argjson p "$(ev $LM prompt | jq 'map(select(.prompt_id=="w1"))[0].at')" '.[0].at > $p and .[1].at > .[0].at' <<<"$(lmev w1)"
uprm $LM u1 "$SH1

$SH2


Also, when pasting an answer, you should add an empty line. When I'm trying to paste multiple answers, they run together" >/dev/null
t "two unwrapped sheets with a blank line between (Jesse's prompt of 2026-11-07): both, no marker or typed text in an answer" jq -e "length==2 and $TWO" <<<"$(lmev u1)"
uprm $LM b1 "$SH1"$'\n\n'"$SH2"$'\n\n' >/dev/null
t "sheets that end with a trailing blank line (the mod's paste spacing): both" jq -e "length==2 and $TWO" <<<"$(lmev b1)"
uprm $LM b2 "$SH1"$'\n\n' >/dev/null
t "one sheet with a trailing blank line: one event, answer intact" jq -e 'length==1 and .[0].handles==["A11"] and .[0].answers.A11=="Full version is good if that'"'"'s your recommendation"' <<<"$(lmev b2)"
uprm $LM l1 "My answers to A11, A12:
$SH1

$SH2" >/dev/null
t "a one-line lead-in before the first sheet: both" jq -e "length==2 and $TWO" <<<"$(lmev l1)"
uprm $LM l2 "My answers:
$(printf '<pasted_content id="c">\n%s\n</pasted_content id="c">\n<pasted_content id="d">\n%s\n</pasted_content id="d">' "$SH1" "$SH2")" >/dev/null
t "a lead-in before two wrapped sheets with no blank line between them: both" jq -e "length==2 and $TWO" <<<"$(lmev l2)"
uprm $LM r1 "$SH1
$SH2" >/dev/null
t "two sheets that run together (no blank line, an older mod): both, A11's answer intact" jq -e "length==2 and $TWO" <<<"$(lmev r1)"
uprm $LM a1 "ledgr answers $LM
A3: one

A4: two, after a blank line

thanks" >/dev/null
t "one sheet with a blank line between two answers: one event, A3 and A4, the closing word left out" jq -e 'length==1 and .[0].handles==["A3","A4"] and .[0].answers=={"A3":"one","A4":"two, after a blank line"}' <<<"$(lmev a1)"
uprm $LM x1 "$SH1

some prose
more prose
$SH2" >/dev/null
t "two lines of prose between sheets: only the first (the second is mid-paragraph)" jq -e 'length==1 and .[0].handles==["A11"]' <<<"$(lmev x1)"
uprm $LM c1 "$CONF

$SH1" >/dev/null
t "a confluence then a sheet: both events" test "$(ev $LM confluence_landed | jq 'map(select(.prompt_id=="c1")) | length')$(lmev c1 | jq length)" = 11

echo "== hybrid re-injection (instruct_reinject)"
# A fake OpenAI-compatible server stands in for the model: a message with BLOCKER yields one blocking
# ask, one with NEEDED one needed ask, anything else none.
R="$ROOT/reinject"; RO="$ROOT/reinject-off"; mkdir -p "$R" "$RO"; PORTF="$ROOT/fake-port"
$PYQ -I - "$PORTF" <<'PY' &
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        msg = body["messages"][-1]["content"]
        asks = []
        if "BLOCKER" in msg:
            asks = [{"text": "Give me the production database password.", "kind": "provide", "level": "blocking",
                     "quote": "I need the production database password (BLOCKER)."}]
        elif "NEEDED" in msg:
            asks = [{"text": "Review the migration before release.", "kind": "review", "level": "needed",
                     "quote": "Please review the migration before release (NEEDED)."}]
        out = json.dumps({"id": "fake-1", "model": "fake", "usage": {},
                          "choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"asks": asks})}}]}).encode()
        self.send_response(200); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out))); self.end_headers(); self.wfile.write(out)
srv = HTTPServer(("127.0.0.1", 0), H)
open(sys.argv[1], "w").write(str(srv.server_port)); srv.serve_forever()
PY
FAKE=$!
for i in $(seq 50); do [ -s "$PORTF" ] && break; sleep 0.1; done
CFG='{"instruct_block": true, "extract": {"provider": "openai-compatible", "base_url": "http://127.0.0.1:'"$(cat "$PORTF")"'/v1", "model": "fake", "timeout_s": 5}}'
echo "$CFG" >"$R/config.json"
$PYQ -I -c 'import json,sys; d=json.loads(sys.argv[1]); d["instruct_reinject"]=False; print(json.dumps(d))' "$CFG" >"$RO/config.json"
INSTR="$(cat "$BIN/lib/asks-instruction-ledgr.txt")"
rj() { printf '%s' "$4" | LEDGR_DATA="$1" HC_TERMINAL_ID="$2" bash "$(script "$3")"; }   # rj <data> <terminal> <event> <json>
rstart() { rj "$1" "$2" SessionStart "{\"session_id\":\"$3\",\"cwd\":\"/tmp\",\"source\":\"${4:-startup}\"}"; }
rprompt() { rj "$1" "$2" UserPromptSubmit "{\"session_id\":\"$3\",\"cwd\":\"/tmp\",\"prompt_id\":\"$4\",\"prompt\":\"$5\"}"; }
rstop() { rj "$1" "$2" Stop "$(J "$3" "$TP" "$4")"; }
rev() { jq -s -c --arg s "$2" --arg ty "$3" 'map(select(.session_id==$s and .type==$ty))' "$1"/spool/*.json 2>/dev/null; }
rwait() { local i; for i in $(seq 60); do [ "$(rev "$1" "$2" asks | jq length)" -ge 1 ] 2>/dev/null && return 0; sleep 0.25; done; return 1; }
flag() { jq -r '.reinject_pending // "none"' "$1/sessions/$2.json"; }
flagwait() { local i; for i in $(seq 20); do [ "$(flag "$1" "$2")" != none ] && return 0; sleep 0.1; done; return 1; }
RB=99999999-0000-0000-0000-0000000000b1; RM=99999999-0000-0000-0000-0000000000b2
RN=99999999-0000-0000-0000-0000000000b3; RX=99999999-0000-0000-0000-0000000000b4; RC=99999999-0000-0000-0000-0000000000b5
# block present: the agent declared its blocker, nothing to remind
rstart "$R" t71 $RB >/dev/null; rprompt "$R" t71 $RB b1 "go" >/dev/null
rstop "$R" t71 $RB "$(cat "$BIN/tests/fixtures/blocks/valid.md")"$'\n'"I need the production database password (BLOCKER)."; rwait "$R" $RB
t "block present: source block (no model call)" jq -e '.[0].source=="block" and .[0].block_found==true' <<<"$(rev "$R" $RB asks)"
sleep 0.3; out=$(rprompt "$R" t71 $RB b2 "next")
t "block present: no reinject, the next prompt prints nothing" test -z "$out" -a "$(flag "$R" $RB)" = none
# blocking ask found by the model, no block: one reminder on the next real prompt
rstart "$R" t72 $RM >/dev/null; rprompt "$R" t72 $RM m1 "go" >/dev/null
rstop "$R" t72 $RM "I stopped here. I need the production database password (BLOCKER). Nothing else is left to do."; rwait "$R" $RM
t "model-found blocking, no block: source model, one blocking ask, block_found false" jq -e '.[0] | .source=="model" and .block_found==false and (.asks|length)==1 and .asks[0].level=="blocking"' <<<"$(rev "$R" $RM asks)"
flagwait "$R" $RM; t "...the session is marked for the turn (reinject_pending 1)" test "$(flag "$R" $RM)" = 1
out=$(rprompt "$R" t72 $RM m2 "/btw is it saved")
t "...a local /btw prints nothing and keeps the mark" test -z "$out" -a "$(flag "$R" $RM)" = 1
out=$(rprompt "$R" t72 $RM m3 "here it is")
t "...the next real prompt prints exactly the instruction" test "$out" = "$INSTR"
t "...and clears the mark" test "$(flag "$R" $RM)" = none
out=$(rprompt "$R" t72 $RM m4 "and again")
t "...exactly once: the prompt after prints nothing" test -z "$out"
t "...hook.log records reinject_pending and reinject" test "$(grep -c -E "t72 (reinject_pending|reinject) $RM" "$R/log/hook.log")" = 2
# needed only, no block: no reminder
rstart "$R" t73 $RN >/dev/null; rprompt "$R" t73 $RN n1 "go" >/dev/null
rstop "$R" t73 $RN "Done with the change. Please review the migration before release (NEEDED). The rest is merged."; rwait "$R" $RN
t "needed only, no block: source model, one needed ask" jq -e '.[0] | .source=="model" and (.asks|length)==1 and .asks[0].level=="needed"' <<<"$(rev "$R" $RN asks)"
sleep 0.3; out=$(rprompt "$R" t73 $RN n2 "next")
t "needed only: no reinject, the next prompt prints nothing" test -z "$out" -a "$(flag "$R" $RN)" = none
# instruct_reinject false: no mark
rstart "$RO" t74 $RX >/dev/null; rprompt "$RO" t74 $RX x1 "go" >/dev/null
rstop "$RO" t74 $RX "I stopped here. I need the production database password (BLOCKER). Nothing else is left to do."; rwait "$RO" $RX
sleep 0.3; out=$(rprompt "$RO" t74 $RX x2 "next")
t "instruct_reinject false: blocking found by the model, no reinject" test -z "$out" -a "$(flag "$RO" $RX)" = none
# a SessionStart (compact) prints the instruction anyway and clears a pending mark
rstart "$R" t75 $RC >/dev/null; rprompt "$R" t75 $RC c1 "go" >/dev/null
rstop "$R" t75 $RC "I stopped here. I need the production database password (BLOCKER). Nothing else is left to do."; rwait "$R" $RC; flagwait "$R" $RC
out=$(rstart "$R" t75 $RC compact)
t "SessionStart (compact) with a mark: prints the instruction once and clears the mark" test "$out" = "$INSTR" -a "$(flag "$R" $RC)" = none
out=$(rprompt "$R" t75 $RC c2 "next")
t "...so the next prompt prints nothing" test -z "$out"
kill $FAKE 2>/dev/null; wait $FAKE 2>/dev/null

echo "== handoff modes (asks.handoff: ledgr | both | prose)"
HM="$ROOT/handoff"; mkdir -p "$HM"
hset() { printf '{"instruct_block": %s, "asks": {"handoff": "%s"}, "extract": {"mode": "block-only"}}\n' "$2" "$1" >"$HM/config.json"; }
imode() { jq -r '.instruct_mode // "none"' "$HM/sessions/$1.json"; }
WL="$(cat "$BIN/lib/asks-instruction-ledgr.txt")"; WB="$(cat "$BIN/lib/asks-instruction-both.txt")"; WO="$(cat "$BIN/lib/asks-instruction-off.txt")"
H1=99999999-0000-0000-0000-0000000000e1; H2=99999999-0000-0000-0000-0000000000e2; H3=99999999-0000-0000-0000-0000000000e3
H4=99999999-0000-0000-0000-0000000000e4; H5=99999999-0000-0000-0000-0000000000e5
hset ledgr true; out=$(rstart "$HM" t80 $H1)
t "ledgr: SessionStart prints the ledgr wording, instruct_mode ledgr" test "$out" = "$WL" -a "$(imode $H1)" = ledgr
t "ledgr wording: the pointer line, no prose list, the bullet example" bash -c 'grep -q "ledgr: 3 items for you, 1 blocking" "$1" && grep -q "do not list it in your prose" "$1" && grep -q "^- blocking · decide · " "$1"' _ "$BIN/lib/asks-instruction-ledgr.txt"
out=$(rprompt "$HM" t80 $H1 h1 "go"); t "same mode: the next prompt prints nothing" test -z "$out"
hset both true; out=$(rprompt "$HM" t80 $H1 h2 "go")
t "live switch to both: the next prompt prints the both wording once" test "$out" = "$WB" -a "$(imode $H1)" = both
out=$(rprompt "$HM" t80 $H1 h3 "go"); t "...once" test -z "$out"
out=$(rprompt "$HM" t80 $H1 h3b "/btw what"); t "...a local /btw never prints" test -z "$out"
hset prose true; out=$(rprompt "$HM" t80 $H1 h4 "go")
t "live switch to prose: one line revoking the earlier wording" test "$out" = "$WO" -a "$(imode $H1)" = prose
out=$(rprompt "$HM" t80 $H1 h5 "go"); t "...once" test -z "$out"
out=$(rstart "$HM" t80 $H1 clear); t "prose: SessionStart prints nothing" test -z "$out"
hset ledgr false; out=$(rstart "$HM" t81 $H2)
t "instruct_block false is prose whatever asks.handoff says (the master switch)" test -z "$out" -a "$(imode $H2)" = prose
hset ledgr true; out=$(rprompt "$HM" t81 $H2 p1 "go")
t "a session started in prose gets the ledgr wording at its next prompt after the switch" test "$out" = "$WL"
hset bogus true; out=$(rstart "$HM" t82 $H3); t "unknown asks.handoff: ledgr" test "$out" = "$WL"
hset both true; rstart "$HM" t83 $H4 >/dev/null
jq 'del(.instruct_mode)' "$HM/sessions/$H4.json" >"$ROOT/h.json" && mv "$ROOT/h.json" "$HM/sessions/$H4.json"
out=$(rprompt "$HM" t83 $H4 o1 "go"); t "a session from before the modes counts as both: no print in both" test -z "$out" -a "$(imode $H4)" = both
jq 'del(.instruct_mode)' "$HM/sessions/$H4.json" >"$ROOT/h.json" && mv "$ROOT/h.json" "$HM/sessions/$H4.json"
hset ledgr true; out=$(rprompt "$HM" t83 $H4 o2 "go"); t "...and gets the ledgr wording once in ledgr" test "$out" = "$WL" -a "$(imode $H4)" = ledgr
rstart "$HM" t84 $H5 >/dev/null; rprompt "$HM" t84 $H5 s1 "go" >/dev/null
rstop "$HM" t84 $H5 "$(cat "$BIN/tests/fixtures/blocks/bullets.md")"; rwait "$HM" $H5
t "a bullet block at Stop: source block, form bullets, 3 asks, pointer 3 / 1" jq -e '.[0] | .source=="block" and .block_form=="bullets" and (.asks|length)==3 and .pointer.items==3 and .pointer.blocking==1 and ([.asks[].level]==["blocking","needed","needed"])' <<<"$(rev "$HM" $H5 asks)"

echo "== declared by tool (bin/mcp declare_asks): the Stop hook settles the turn"
TD="$ROOT/tooldecl"; mkdir -p "$TD"; K1=99999999-0000-0000-0000-0000000000f1
KT="$ROOT/tool-transcript.jsonl"
$PYQ -I - "$KT" <<'PY2'
import json, sys
recs = [{"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
        {"type": "assistant", "uuid": "a1", "message": {"id": "m1", "content": [{"type": "text", "text": "I stopped before the migration because the staging token is missing."}]}},
        {"type": "assistant", "uuid": "a2", "message": {"id": "m1", "content": [{"type": "tool_use", "id": "x", "name": "mcp__ledgr__declare_asks", "input": {}}]}},
        {"type": "user", "uuid": "u2", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "x", "content": "ok"}]}},
        {"type": "assistant", "uuid": "a3", "message": {"id": "m2", "content": [{"type": "text", "text": "Everything else is ready.\n\nledgr: 2 items for you, 1 blocking"}]}}]
open(sys.argv[1], "w").write("\n".join(json.dumps(r) for r in recs) + "\n")
PY2
rstart "$TD" t85 $K1 >/dev/null; rprompt "$TD" t85 $K1 k1 "go" >/dev/null
mkdir -p "$TD/mcp/$K1"
printf '%s' '{"v": 1, "session_id": "'$K1'", "terminal": "t85", "turn": 1, "calls": 1, "asks": [{"text": "Paste the staging token", "level": "blocking", "kind": "provide", "hash": "x", "quote": "I stopped before the migration because the staging token is missing.", "repeat_of_handle": null}, {"text": "Pick the release name", "level": "needed", "kind": "decide", "hash": "y", "quote": "A sentence nobody wrote.", "repeat_of_handle": null}]}' >"$TD/mcp/$K1/1.json"
KJ=$($PYQ -I -c 'import json,sys; print(json.dumps({"session_id":sys.argv[1],"transcript_path":sys.argv[2],"cwd":"/tmp","hook_event_name":"Stop","stop_hook_active":False,"last_assistant_message":"Everything else is ready.\n\nledgr: 2 items for you, 1 blocking"}))' $K1 "$KT")
rj "$TD" t85 Stop "$KJ"; rwait "$TD" $K1
t "a tool-declared turn: source tool, no model call, replaces_turn, quotes verified, the pointer read" jq -e '.[0] | .source=="tool" and .provider=="mcp" and .model==null and .replaces_turn==true and .quotes=="verified" and (.asks|length)==2 and .pointer.items==2 and .pointer.blocking==1' <<<"$(rev "$TD" $K1 asks)"
t "...a quote written before the tool call is verified against the whole turn" jq -e '.[0].asks[0] | .quote=="I stopped before the migration because the staging token is missing." and .quote_verified==true and .origin=="tool" and .level=="blocking"' <<<"$(rev "$TD" $K1 asks)"
t "...an invented quote is dropped; options left out for the writer to keep" jq -e '.[0].asks[1] | .quote==null and (has("options")|not)' <<<"$(rev "$TD" $K1 asks)"
t "...settled with the final message's uuid" jq -e '.[0].message_uuid=="a3"' <<<"$(rev "$TD" $K1 asks)"
sleep 0.3; out=$(rprompt "$TD" t85 $K1 k2 "next")
t "...no reinject after a tool-declared turn" test -z "$out" -a "$(jq -r '.reinject_pending // "none"' "$TD/sessions/$K1.json")" = none
t "hook.log counts it: source=tool" grep -q "t85 extract $K1 turn=1 source=tool asks=2" "$TD/log/hook.log"

echo "== disabled spaces (config spaces.disabled; the terminal's herdr.space label)"
SPD="$ROOT/spaces"; mkdir -p "$SPD"
SPA=spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; SPB=spbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
sset() { printf '{"instruct_block": true, "asks": {"handoff": "%s"}, "spaces": {"disabled": [%s]}, "extract": {"mode": "block-only"}}\n' "${2:-ledgr}" "$1" >"$SPD/config.json"; }
hcl() { printf '{"address":"%s","labels":{"herdr.space":"%s","herdr.tab":"tb1"},"state":"live"}\n' "$1" "$2" >"$FAKE_HC_DIR/$1.json"; }
srun() { printf '%s' "$3" | LEDGR_DATA="$SPD" HC_TERMINAL_ID="$1" bash "$(script "$2")"; }      # srun <t> <event> <json>
sstart() { srun "$1" SessionStart "{\"session_id\":\"$2\",\"cwd\":\"/tmp\",\"source\":\"${3:-startup}\"}"; }
sprompt() { srun "$1" UserPromptSubmit "$(up "$2" "$3" "$4")"; }                                    # sprompt <t> <sid> <prompt id> <text>
sstop() { srun "$1" Stop "$(J "$2" "$TP" "$3")"; }
sev() { rev "$SPD" "$1" "$2" | jq length; }
srec() { jq -r "$2" "$SPD/sessions/$1.json"; }
WSO="$(cat "$BIN/lib/asks-instruction-space-off.txt")"
X1=99999999-0000-0000-0000-0000000005a1; X2=99999999-0000-0000-0000-0000000005a2; X3=99999999-0000-0000-0000-0000000005a3
X4=99999999-0000-0000-0000-0000000005a4; X5=99999999-0000-0000-0000-0000000005a5; X6=99999999-0000-0000-0000-0000000005a6
X7=99999999-0000-0000-0000-0000000005a7; X8=99999999-0000-0000-0000-0000000005a8
sset "\"$SPB\""; hcl t90 "$SPA"; hcl t91 "$SPB"
out=$(sstart t90 $X1)
t "an enabled space: SessionStart prints the ledgr wording; record and map carry space, ledgr_off false" test "$out" = "$WL" -a "$(srec $X1 '[.space, .ledgr_off] | @tsv')" = "$SPA	false" -a "$(jq -r .space "$SPD/terminals/t90.json")" = "$SPA"
out=$(sstart t91 $X2)
t "a disabled space: SessionStart prints nothing, records ledgr_off, writes the map with the space" test -z "$out" -a "$(srec $X2 .ledgr_off)" = true -a "$(jq -r '.session_id + " " + .space' "$SPD/terminals/t91.json")" = "$X2 $SPB"
t "...and no spool event (no session_start)" test "$(sev $X2 session_start)" = 0
out=$(sprompt t91 $X2 o1 "go [A1]"); out+=$(sprompt t91 $X2 o2 "$SH1")
t "off: prompts print nothing, make no prompt event, and a pasted answer sheet does not land" test -z "$out" -a "$(sev $X2 prompt)$(sev $X2 answers_landed)" = 00
t "...the record still counts the turns and refreshes the space" test "$(srec $X2 '[.turn, .space, .state] | @tsv')" = "2	$SPB	working"
sstop t91 $X2 "I stopped here. I need the production database password before I go on."
sstop t91 $X2 "A second reply in the same off period, long enough to be extracted if ledgr were on."
sleep 1
t "off Stop: no pending, stop or asks event, no turn text, state idle" test "$(sev $X2 pending)$(sev $X2 stop)$(sev $X2 asks)" = 000 -a ! -e "$SPD/turns/$X2" -a "$(srec $X2 .state)" = idle
t "...hook.log explains it once per off period" test "$(grep -c "t91 Stop $X2 skipped: ledgr is off in space $SPB" "$SPD/log/hook.log")" = 1
sset ""; out=$(sprompt t91 $X2 o3 "/btw still off?")
t "space enabled, a local /btw: prints nothing, keeps the off record" test -z "$out" -a "$(srec $X2 .ledgr_off)" = true
out=$(sprompt t91 $X2 o4 "back on")
t "off -> on at the next real prompt: prints the mode's wording once, ledgr_off false, instruct_mode ledgr" test "$out" = "$WL" -a "$(srec $X2 '[.ledgr_off, .instruct_mode, (.off_skip_logged // "none")] | @tsv')" = "false	ledgr	none"
t "...that prompt makes its prompt event (turn 3: the /btw counted none)" jq -e 'map(select(.prompt_id=="o4")) | length==1 and .[0].turn==3' <<<"$(rev "$SPD" $X2 prompt)"
out=$(sprompt t91 $X2 o5 "next"); t "...once" test -z "$out"
sstop t91 $X2 "Back on, this reply is extracted again: Please confirm the deploy."; wait_sp() { local i; for i in $(seq 40); do [ "$(sev "$1" asks)" -ge "$2" ] 2>/dev/null && return 0; sleep 0.25; done; return 1; }; wait_sp $X2 1
t "...and its Stop makes pending and asks again" test "$(sev $X2 pending)" = 1 -a "$(sev $X2 asks)" = 1
sset "\"$SPB\""; out=$(sprompt t91 $X2 o6 "now off again")
t "on -> off at the next real prompt: prints exactly the space-off text, ledgr_off true, no prompt event" test "$out" = "$WSO" -a "$(srec $X2 .ledgr_off)" = true -a "$(rev "$SPD" $X2 prompt | jq 'map(select(.prompt_id=="o6")) | length')" = 0
out=$(sprompt t91 $X2 o7 "still off"); t "...once" test -z "$out"
t "space-off text: off in this space, no block, no pointer line, no ledgr tools" bash -c 'grep -q "ledgr is off in this space" "$1" && grep -q "no ledgr-asks" "$1" && grep -q "declare_asks, resolve_asks" "$1"' _ "$BIN/lib/asks-instruction-space-off.txt"
out=$(sstart t91 $X2 resume)
t "a resume while off, of a session that had a wording: the space-off text (its context may still carry it)" test "$out" = "$WSO"
out=$(sstart t91 $X2 clear); t "a clear while off: nothing" test -z "$out"
out=$(sstart t90 $X1); sprompt t90 $X1 m1 "go" >/dev/null
sset "\"$SPA\""; sstop t90 $X1 "The space was disabled while I worked. Please confirm the deploy to staging."; sleep 1
t "a space disabled mid-turn: that Stop is skipped (no pending)" test "$(sev $X1 pending)" = 0
sset ""; sstop t90 $X1 "Another Stop of a turn that began on, after the space came back on."; sleep 0.3
t "a turn that began on ends on once the space is on again" test "$(sev $X1 pending)" = 1
sset "\"$SPB\"" prose; sstart t91 $X3 >/dev/null
t "prose mode, a disabled space: nothing printed at start, no wording recorded" test "$(srec $X3 '[.ledgr_off, (.instruct_mode // "none")] | @tsv')" = "true	none"
sset "" prose; out=$(sprompt t91 $X3 p1 "go"); sset "\"$SPB\"" prose; out+=$(sprompt t91 $X3 p2 "go")
t "prose mode: off -> on and on -> off print nothing (no wording to give or revoke)" test -z "$out" -a "$(srec $X3 .ledgr_off)" = true
sset "\"$SPB\""; out=$(sprompt t91 $X4 f1 "first seen here")
t "a session first seen at a prompt in a disabled space: nothing printed, ledgr_off true, no event" test -z "$out" -a "$(srec $X4 .ledgr_off)" = true -a "$(sev $X4 prompt)" = 0
sset ""; sstart t91 $X5 >/dev/null; jq 'del(.ledgr_off)' "$SPD/sessions/$X5.json" >"$ROOT/x.json" && mv "$ROOT/x.json" "$SPD/sessions/$X5.json"
sset "\"$SPB\""; out=$(sprompt t91 $X5 r1 "go")
t "a running session from before this build (no ledgr_off, had the ledgr wording): the space-off text at its next prompt" test "$out" = "$WSO" -a "$(srec $X5 .ledgr_off)" = true
# The lookup: missing, failing, slow or garbled hc.
sset "\"$SPB\""; out=$(LEDGR_HC= sstart t91 $X6)
t "LEDGR_HC empty (no hc): space null, so the session counts as on" test "$out" = "$WL" -a "$(srec $X6 .space)" = null
out=$(LEDGR_HC=/nonexistent/hc sprompt t91 $X6 n1 "go"); t "a missing hc binary: space null, on" test -z "$out" -a "$(srec $X6 '[(.space // "null"), .ledgr_off] | @tsv')" = "null	false"
sstart t91 $X7 >/dev/null; rm -f "$FAKE_HC_DIR/t91.json"
out=$(sprompt t91 $X7 k1 "go"); t "hc exits non-zero: the recorded space is kept (still off, nothing printed)" test -z "$out" -a "$(srec $X7 '[.space, .ledgr_off] | @tsv')" = "$SPB	true"
out=$(FAKE_HC_BAD=1 sprompt t91 $X7 k2 "go"); t "hc prints no JSON: the recorded space is kept" test -z "$out" -a "$(srec $X7 .space)" = "$SPB"
T0=$(now); out=$(FAKE_HC_SLEEP=2 sprompt t91 $X7 k3 "go"); T1=$(now); ms=$($PYQ -I -c "print(int(($T1-$T0)*1000))")
t "hc slower than 300 ms: the hook goes on (${ms} ms), the recorded space is kept, hook.log says so" test "$ms" -lt 1500 -a -z "$out" -a "$(srec $X7 .space)" = "$SPB" -a "$(grep -c "t91 space lookup: hc get timed out" "$SPD/log/hook.log")" -ge 1
printf '{"address":"t92","labels":{"where":"x"}}\n' >"$FAKE_HC_DIR/t92.json"; out=$(sstart t92 $X8)
t "a terminal without the herdr.space label: space null, on" test "$out" = "$WL" -a "$(srec $X8 .space)" = null
t "no hook errors in the disabled-space runs" test ! -s "$SPD/log/hook.err"

echo "== layout"
$PYQ -I -B -S -c 'import sys; sys.path[:0]=[sys.argv[1]]; import ledgr_spool; bad=[m for m in sys.modules if m.startswith(("claude_","last_assistant","providers"))]; sys.exit(1 if bad else 0)' "$BIN/lib"
ok $? "lib/ledgr_spool imports with no Claude-specific or provider modules"

echo "== timing (20 runs each, wall time of the entry script)"
$PYQ -I - "$BIN" "$ROOT/timing" "$OUTER_T" <<'PY'
import json, os, subprocess, sys, time
bin_, data, outer = sys.argv[1], sys.argv[2], sys.argv[3]
# With a Herdr terminal of its own, the run times the real `hc get` (read only) on it; else none.
env = dict(os.environ, LEDGR_DATA=data, HC_TERMINAL_ID=outer or "t98")
env.pop("LEDGR_HC", None)
if not outer:
    env["LEDGR_HC"] = ""
print(f"  space lookup: {'hc get ' + outer + ' --json (real)' if outer else 'none (no Herdr terminal)'}")
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
load = os.getloadavg()[0]
print(f"  load average {load:.1f}")
if worst >= 100 and load > 8:
    print(f"  WARN median {worst:.0f} ms is over 100 ms, but the load average is {load:.1f} (over 8): not counted as a failure")
    sys.exit(0)
sys.exit(0 if worst < 100 else 1)
PY
ok $? "median under 100 ms per hook (a warning instead when the load average is over 8)"

for i in $(seq 60); do pgrep -f "$AD/claude_extract.py --input $ROOT" >/dev/null || break; sleep 0.25; done   # detached extractors
echo
echo "$P passed, $F failed   (data: $ROOT)"
[ "$F" = 0 ] && rm -rf "$ROOT"
[ "$F" = 0 ]
