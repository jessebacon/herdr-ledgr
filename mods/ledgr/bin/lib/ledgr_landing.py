"""ledgr landing detector (Phase 3): does a submitted prompt carry a ledgr message the panel staged?

The panel never types into a terminal. It puts one of two messages on the clipboard and focuses the
pane; the person pastes and presses Enter. When that prompt is submitted, the UserPromptSubmit hook
calls detect() on it. A message starts with a marker line (mods/ledgr/confluence.js writes them):

    ledgr confluence <branch id> <item id>      a branch's conclusion returning to its trunk
    ledgr answers <session id>                  the answer sheet, then "A3: <answer>" lines

Where the marker may stand:
  - Pasted blocks. When the adapter names its agent's paste wrapper (Claude Code puts pasted text
    between <pasted_content id="..."> and </pasted_content id="..."> lines, hooks.md "UserPromptSubmit
    input"), the marker counts as the first non-empty line of ANY such block, so a lead-in the person
    typed before pasting ("Adopt this branch result for Q1:") is fine. A block that opens inside a
    code fence the person typed does not count; nor does a block whose first line is a fence.
  - Unwrapped (agents or sessions that do not mark pastes): the marker is the first non-empty line of
    the prompt, or the second when the first is a single lead-in line of at most 200 characters.
Anything else is not a landing and returns None: a marker after text on the same line, after two or
more lines of text, inside a code fence, with a different case, a double space or a trailing word.
The prompt is never changed. Agent-agnostic and pure (no files, no imports beyond re): the adapter
supplies the wrapper syntax.
"""
import re

CONFLUENCE = re.compile(r"^ledgr confluence (br_[A-Za-z0-9_-]{1,80}) (rq_[A-Za-z0-9_-]{1,80})[ \t]*$")
ANSWERS = re.compile(r"^ledgr answers ([A-Za-z0-9][A-Za-z0-9._:-]{0,127})[ \t]*$")
HANDLE = re.compile(r"^(A\d{1,6})[ \t]*:[ \t]*(.*)$")
CONCLUSION = re.compile(r"^conclusion\s*:\s*(.*)$", re.I)
FENCE = re.compile(r"^(```|~~~)")
MAX_SCAN = 40_000
MAX_ANSWER = 400
MAX_HANDLES = 60
MAX_LEAD_IN = 200


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
    return None


def _from_block(body):
    """A pasted block: its first non-empty line must be the marker."""
    k = next((i for i, line in enumerate(body) if line.strip()), None)
    return None if k is None else _parse(body[k].strip(), body[k + 1:])


def _pasted(lines, opener, closer):
    """The first pasted block (outside any fence the person typed) that is a ledgr message."""
    fence, i = False, 0
    while i < len(lines):
        s = lines[i].strip()
        if opener.match(s):
            j = i + 1
            while j < len(lines) and not closer.match(lines[j].strip()):
                j += 1
            if not fence:
                hit = _from_block(lines[i + 1:j])
                if hit:
                    return hit
            i = j + 1
            continue
        if FENCE.match(s):
            fence = not fence
        i += 1
    return None


def _unwrapped(lines):
    """The marker as the first non-empty line, or the second after a one-line lead-in."""
    idx = [i for i, line in enumerate(lines) if line.strip()][:2]
    if not idx:
        return None
    first = lines[idx[0]].strip()
    hit = _parse(first, lines[idx[0] + 1:])
    if hit or len(idx) < 2 or FENCE.match(first) or len(first) > MAX_LEAD_IN:
        return hit
    return _parse(lines[idx[1]].strip(), lines[idx[1] + 1:])


def detect(prompt, wrapper=None):
    """{"kind": "confluence", "branch_id", "item_id", "conclusion_head"} or
    {"kind": "answers", "for_session", "handles": [...], "answers": {handle: text}} or None.
    wrapper: (opening-line regex, closing-line regex) of the agent's pasted blocks, or None."""
    if not isinstance(prompt, str):
        return None
    head = prompt[:MAX_SCAN]
    if "ledgr confluence " not in head and "ledgr answers " not in head:
        return None                                           # fast path: most prompts end here
    lines = _lines(prompt)
    if wrapper:
        opener, closer = wrapper
        hit = _pasted(lines, opener, closer)
        if hit:
            return hit
        lines = [line for line in lines if not (opener.match(line.strip()) or closer.match(line.strip()))]
    return _unwrapped(lines)
