The notifier is on staging. I cannot finish the production rollout without the webhook secret.

Please paste the LINEAR_WEBHOOK_SECRET value. Before we call it done, check the DM on your phone.
Want me to also add a digest later? Pick the template: compact or detailed.
Also rotate the old bot secret.

```ledgr-asks
[{"text": "Paste the LINEAR_WEBHOOK_SECRET value", "kind": "provide", "level": "blocking", "options": [], "recommended": null, "quote": "Please paste the LINEAR_WEBHOOK_SECRET value."},
 {"text": "Check the DM on your phone", "kind": "review", "quote": "check the DM on your phone"},
 {"text": "Decide whether to add a digest later", "kind": "confirm", "level": "optional", "quote": "Want me to also add a digest later?"},
 {"text": "Pick the message template", "kind": "decide", "level": " Needed ", "options": ["compact", "detailed"], "quote": "Pick the template: compact or detailed."},
 {"text": "Rotate the old bot secret", "kind": "do", "level": "urgent", "quote": "Also rotate the old bot secret."},
 {"text": "Approve the Teams app", "kind": "do", "blocking": true}]
```
