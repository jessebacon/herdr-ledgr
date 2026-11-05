I drafted the cleanup plan for the stale branches.

Pick the retention rule: keep 30 days or keep 90 days. I recommend 30 days.
Also, OK to delete `release/5.4` now?

```ledgr-asks
[{"text": "Pick the branch retention rule", "kind": "decide", "options": ["30 days", "90 days"], "recommended": "30 days", "blocking": false, "quote": "Pick the retention rule: keep 30 days or keep 90 days."},
 {"text": "Confirm deleting release/5.4", "kind": "confirm", "options": [], "recommended": null, "blocking": true, "quote": "OK to delete `release/5.4` now?"},
 {"kind": "do"},
 {"text": "   Check   the   wiki  ", "kind": "weird"}]
```
