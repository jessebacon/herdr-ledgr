Done. Here is what changed in this pass:

- The ASKED OF YOU lane no longer folds by itself; the fold is yours, and `ui.foldAsksWhileWorking` brings the old behaviour back.
- Every ask now carries a level (blocking, needed or optional), and `extract.threshold` decides which ones count on the chip; the rest sit in a folded suggestions line under their turn.
- Rows fade in when they arrive and fade out when you resolve them; the chip pulses once when a turn ends with something new.
- The store tests grew to 302 checks and all pass, the three mods pass `herdr-app check`, and the install script copied the engine files cleanly.

Nothing is committed yet. Ready to commit when you've had a look.
