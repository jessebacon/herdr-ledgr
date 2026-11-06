The notifier runs on the staging slot. I can't finish the production rollout until the webhook secret exists.

Please add the `TRACKER_WEBHOOK_SECRET` app setting in the portal. Once it's live, check that the DM arrives on your phone.

Want me to also add a weekly digest later?

```ledgr-asks
[{"text": "Add the TRACKER_WEBHOOK_SECRET app setting in the portal", "kind": "do", "level": "blocking", "options": [], "recommended": null, "quote": "Please add the `TRACKER_WEBHOOK_SECRET` app setting in the portal."},
 {"text": "Check that the DM arrives on your phone", "kind": "review", "options": [], "recommended": null, "quote": "check that the DM arrives on your phone"},
 {"text": "Decide whether the agent should also add a weekly digest", "kind": "confirm", "level": "optional", "options": [], "recommended": null, "quote": "Want me to also add a weekly digest later?"},
 {"text": "Escalate to the vendor", "kind": "do", "level": "urgent", "options": [], "recommended": null, "quote": null}]
```
