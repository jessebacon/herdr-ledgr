"""ledgr landing detector (Phase 3, pins): does a submitted prompt carry a ledgr message the panel staged?

The panel never presses Enter. It puts one of three messages on the clipboard, focuses the pane and,
once the focus is confirmed, pastes it into the prompt (terminal.paste; else the person pastes);
the person presses Enter. When that prompt is submitted, the UserPromptSubmit hook
calls detect() on it. A message starts with a marker line (mods/ledgr/confluence.js writes them):

    ledgr confluence <branch id> <item id>      a branch's conclusion returning to its trunk
    ledgr answers <session id>                  the answer sheet, then "A3: <answer>" lines
    ledgr pins <session id> <item id>           a parked question asked in its trunk with its pins
                                                (Ask here): the question line, then each pinned
                                                passage quoted line by line with "> "; the body is
                                                not parsed, the marker is the whole signal

A pinned passage is quoted, so a marker or a fence inside it is inert: both count only at the start
of a stripped line, and every passage line starts with ">".

Where the marker may stand:
  - Pasted blocks. When the adapter names its agent's paste wrapper (Claude Code puts pasted text
    between <pasted_content id="..."> and </pasted_content id="..."> lines, hooks.md "UserPromptSubmit
    input"), the marker counts as the first non-empty line of ANY such block, so a lead-in the person
    typed before pasting ("Adopt this branch result for Q1:") is fine. A block that opens inside a
    code fence the person typed does not count; nor does a block whose first line is a fence.
  - Unwrapped (agents or sessions that do not mark pastes): the marker is the first non-empty line of
    the prompt, or the second when the first is a single lead-in line of at most 200 characters.
  - After a message (several pasted into one prompt, such as two answer sheets): the next line that
    is neither empty nor a paste wrapper line, or the one after it when that line is a single lead-in.
Anything else is not a landing: a marker after text on the same line, after two or more lines of text,
inside a code fence, with a different case, a double space or a trailing word.
Where a message ends: at a pasted block's closing line, at the next marker line, or, for an answer
sheet, at the first empty line after its A<n>: lines that is not followed by another A<n>: line, so
text typed below a sheet is not part of it. An answer of several lines (2026-11-11, the dialog's
multi-line answer box; confluence.js answerLines) goes on in lines indented by two spaces, with no
blank line inside it: an indented line after an A<n>: line belongs to that answer (joined by a line
break) and is never read as another A<n>:, a marker or a fence. An unindented line that is not an
A<n>: line still joins the answer before it with a space (a wrapped answer, as before).
A pins message holds blank lines between its pins, so like a confluence it runs to the block's
closing line, the next marker line or the prompt's end (text typed below it is ignored: its body is
never read). A pins message and an answer sheet in one prompt, in either order, are two messages.
detect_all() returns every message in prompt order; detect() the first, or None; sheet_lines() the
lines an answer sheet holds (the hook's ref scan skips them).
The prompt is never changed. Agent-agnostic and pure (no files, no imports beyond re): the adapter
supplies the wrapper syntax.
"""
import re

CONFLUENCE = re.compile(r"^ledgr confluence (br_[A-Za-z0-9_-]{1,80}) (rq_[A-Za-z0-9_-]{1,80})[ \t]*$")
ANSWERS = re.compile(r"^ledgr answers ([A-Za-z0-9][A-Za-z0-9._:-]{0,127})[ \t]*$")
# The session pattern is ANSWERS's, so a synthetic herdr:t3 session passes; the item is a parked question.
PINS = re.compile(r"^ledgr pins ([A-Za-z0-9][A-Za-z0-9._:-]{0,127}) (rq_[A-Za-z0-9_-]{1,80})[ \t]*$")
HANDLE = re.compile(r"^(A\d{1,6})[ \t]*:[ \t]*(.*)$")
CONCLUSION = re.compile(r"^conclusion\s*:\s*(.*)$", re.I)
FENCE = re.compile(r"^(```|~~~)")
MAX_SCAN = 96_000   # a pins message (Ask here) can run past 40,000 before an answer sheet pasted after it, and a
                    # sheet runs to 24,000 (confluence.js sheetOverCap; 2026-11-11, answers of several lines)
MAX_ANSWER = 4_000  # an answer as the store records it (config.js LIMITS.answer, a draft's cap)
MAX_HANDLES = 60
MAX_LEAD_IN = 200
MAX_MESSAGES = 20


def has_marker_text(text):
    """The fast path: False when no marker can be in `text` (most prompts)."""
    return "ledgr confluence " in text or "ledgr answers " in text or "ledgr pins " in text


def _lines(prompt):
    return prompt[:MAX_SCAN].replace("\r\n", "\n").split("\n")


def _head(text, n=200):
    s = re.sub(r"\s+", " ", text or "").strip()
    s = re.sub(r"^answer\s*:\s*", "", s, flags=re.I)
    return s[:n] or None


def _parse(first, rest):
    """The landing for a marker line `first` followed by the lines `rest` of its message, or None."""
    m = CONFLUENCE.match(first)
    if m:
        head = None
        for j, line in enumerate(rest):
            c = CONCLUSION.match(line.strip())
            if c:
                head = _head(c.group(1)) or next((_head(x) for x in rest[j + 1:] if x.strip() and not FENCE.match(x.strip())), None)
                break
        return {"kind": "confluence", "branch_id": m.group(1), "item_id": m.group(2), "conclusion_head": head}
    m = ANSWERS.match(first)
    if m:
        handles, answers, cur = [], {}, None
        for line in rest:
            if cur and _indented(line):
                answers[cur] = (answers[cur] + "\n" + line.strip()).strip()   # the answer's next line
                continue
            h = HANDLE.match(line.strip())
            if h:
                cur = h.group(1)
                if cur not in answers:
                    if len(handles) >= MAX_HANDLES:
                        break
                    handles.append(cur)
                    answers[cur] = h.group(2).strip()
                else:
                    answers[cur] = (answers[cur] + " " + h.group(2).strip()).strip()
            elif cur and line.strip():
                answers[cur] = (answers[cur] + " " + line.strip()).strip()   # a wrapped answer
        if not handles:
            return None                                       # a marker with no answers: not a sheet
        return {"kind": "answers", "for_session": m.group(1), "handles": handles,
                "answers": {k: v[:MAX_ANSWER] for k, v in answers.items()}}
    m = PINS.match(first)
    if m:                                                     # the body (question, quoted pins) is not read
        return {"kind": "pins", "for_session": m.group(1), "item_id": m.group(2)}
    return None


def _is_marker(s):
    return bool(CONFLUENCE.match(s) or ANSWERS.match(s) or PINS.match(s))


def _indented(line):
    """An answer's next line in a sheet: not empty, and starting with a space or a tab."""
    return bool(line.strip()) and line[:1] in (" ", "\t")


def _end(lines, bound, k):
    """The index just past the message whose marker is lines[k] (see the module doc)."""
    sheet = bool(ANSWERS.match(lines[k].strip()))
    fence, seen, n = False, False, len(lines)
    for j in range(k + 1, n):
        if bound[j]:
            return j
        s = lines[j].strip()
        if sheet and seen and not fence and _indented(lines[j]):
            continue                                          # an answer going on: never a marker or a fence
        if FENCE.match(s):
            fence = not fence
        elif fence:
            continue
        elif _is_marker(s):
            return j
        elif sheet and HANDLE.match(s):
            seen = True
        elif sheet and seen and not s:
            nxt = next((x for x in range(j + 1, n) if bound[x] or lines[x].strip()), None)
            if nxt is None or bound[nxt] or not HANDLE.match(lines[nxt].strip()):
                return j
    return n


def _next(lines, bound, j):
    """The marker line of a message that follows one ending at j, or None."""
    n = len(lines)
    idx = [x for x in range(j, n) if lines[x].strip() and not bound[x]][:2]
    if not idx:
        return None
    first = lines[idx[0]].strip()
    if _is_marker(first):
        return idx[0]
    if len(idx) < 2 or FENCE.match(first) or len(first) > MAX_LEAD_IN:
        return None
    return idx[1] if _is_marker(lines[idx[1]].strip()) else None


def _block_starts(lines, opener, closer):
    """The marker line of every pasted block (outside any fence the person typed) whose first
    non-empty line is a marker."""
    out, fence, i = [], False, 0
    while i < len(lines):
        s = lines[i].strip()
        if opener.match(s):
            j = i + 1
            while j < len(lines) and not closer.match(lines[j].strip()):
                j += 1
            if not fence:
                k = next((x for x in range(i + 1, j) if lines[x].strip()), None)
                if k is not None and _is_marker(lines[k].strip()):
                    out.append(k)
            i = j + 1
            continue
        if FENCE.match(s):
            fence = not fence
        i += 1
    return out


def _unwrapped(lines, bound):
    """Candidates for the prompt's first message: its first non-empty line, then the second after a
    one-line lead-in (paste wrapper lines are skipped)."""
    idx = [i for i, line in enumerate(lines) if line.strip() and not bound[i]][:2]
    if not idx:
        return []
    first = lines[idx[0]].strip()
    if len(idx) < 2 or FENCE.match(first) or len(first) > MAX_LEAD_IN:
        return idx[:1]
    return idx


def _scan(prompt, wrapper):
    """{marker line index: (index just past the message, its landing)} for every ledgr message in the
    prompt (line indexes of _lines(prompt)); {} when there is none."""
    if not isinstance(prompt, str):
        return {}
    head = prompt[:MAX_SCAN]
    if not has_marker_text(head):
        return {}                                             # fast path: most prompts end here
    lines = _lines(prompt)
    opener, closer = wrapper if wrapper else (None, None)
    bound = [bool(wrapper) and bool(opener.match(x.strip()) or closer.match(x.strip())) for x in lines]
    found, tried = {}, set()

    def take(k):
        """Parse the message at k; follow the chain of messages after it."""
        while k is not None and k not in tried and len(found) < MAX_MESSAGES:
            tried.add(k)
            e = _end(lines, bound, k)
            hit = _parse(lines[k].strip(), lines[k + 1:e])
            if not hit:
                return False
            found[k] = (e, hit)
            k = _next(lines, bound, e)
        return True

    for k in _unwrapped(lines, bound):
        if k in tried or take(k):
            break
    for k in (_block_starts(lines, opener, closer) if wrapper else []):
        take(k)
    return found


def detect_all(prompt, wrapper=None):
    """Every ledgr message in the prompt, in order: {"kind": "confluence", "branch_id", "item_id",
    "conclusion_head"}, {"kind": "answers", "for_session", "handles": [...], "answers": {handle:
    text}} or {"kind": "pins", "for_session", "item_id"}. [] when there is none. wrapper:
    (opening-line regex, closing-line regex) of the agent's pasted blocks, or None."""
    found = _scan(prompt, wrapper)
    return [found[k][1] for k in sorted(found)]


def sheet_lines(prompt, wrapper=None):
    """The indexes of the prompt's lines (split at line breaks, CRLF read as LF) that belong to an
    answer sheet detect_all() finds, its marker line through its last answer: the person's answers,
    not refs (lib/ledgr_map.prompt_refs leaves them out, so an [A7] written inside an answer does not
    mark A7 answered). An empty set when there is none."""
    out = set()
    for k, (e, hit) in _scan(prompt, wrapper).items():
        if hit["kind"] == "answers":
            out.update(range(k, e))
    return out


def detect(prompt, wrapper=None):
    """The first ledgr message in the prompt (detect_all), or None."""
    hits = detect_all(prompt, wrapper)
    return hits[0] if hits else None
