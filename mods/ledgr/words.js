// ledgr identifiers as a person reads them. "A9" read as "asks-9" and "t3" as "turn 3", so
// everything the panel and the capture box show uses words: "Ask 9", "Question 1", "pane t3", "branch
// of Question 1". The short forms stay in every machine format, unchanged: the answer sheet's
// "A9: ..." lines, the confluence and answer markers, `[A9]` / `[Q1]` refs in a prompt, the lead-ins
// the person types, store keys and hc names (br-q1-c51e). Pure; not an engine file (the writer
// never shows text).

// "A9" -> "Ask 9", "Q1" -> "Question 1"; anything else as it is.
export function handleWords(handle) {
  const m = /^([AQ])(\d+)$/.exec(String(handle ?? ""));
  if (!m) return handle ? String(handle) : "?";
  return `${m[1] === "A" ? "Ask" : "Question"} ${m[2]}`;
}

export const itemWords = (it) => handleWords(it?.handle);

// A Herdr terminal address as a secondary word: "pane t3" (never a bare "t3").
export const paneWords = (t, none = "its pane") => (t ? `pane ${t}` : none);

// The trunk, with its pane when known: "the trunk (pane t3)".
export const trunkWords = (t) => (t ? `the trunk (pane ${t})` : "the trunk");

// Where an item came from.
export function originWords(origin) {
  return {
    extract_model: "found by the extractor",
    extract_block: "declared by the agent",
    capture: "parked by you",
    btw: "parked by you (/btw)",
  }[origin] ?? (origin ? String(origin).replace(/_/g, " ") : "");
}

// A branch by what it is for: "branch of Question 1". Its hc name (br-q1-c51e) is the short id
// shown beside it, small.
export const branchWords = (item) => `branch of ${item ? itemWords(item) : "a question"}`;

// A session by its name; the id prefix only when it has none.
export const sessionWords = (s) => s?.sessionName || s?.repo || (s?.sessionId ? `session ${String(s.sessionId).slice(0, 8)}` : "no session");
