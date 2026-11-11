The fix agent is still working on `fix/landing-detect`. It has the failing landing test reproduced and is going through the two call sites in `ledgr_landing.py`; main is untouched, and the sandboxed copy still runs yesterday's build.

I need the fix agent's report before anything else moves: no other work can be handed out until it comes back. Once it lands I'll review its diff, fast-forward main, rebuild the sandboxed copy and rerun the full suite there.

Waiting on the report.
