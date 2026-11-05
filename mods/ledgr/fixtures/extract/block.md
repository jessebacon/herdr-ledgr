I drafted the TLS hardening script for PRODAPP. It disables TLS 1.0 and 1.1 and RC4 in SChannel and sets the cipher suite order.

Two things before I run it: pick the cipher order (Mozilla intermediate or CIS Level 1; I recommend Mozilla intermediate), and confirm it is OK to reboot PRODAPP tonight after 9 pm.

```ledgr-asks
[{"text": "Pick the cipher suite order for PRODAPP", "kind": "decide", "options": ["Mozilla intermediate", "CIS Level 1"], "recommended": "Mozilla intermediate", "blocking": true, "quote": "pick the cipher order (Mozilla intermediate or CIS Level 1; I recommend Mozilla intermediate)"},
 {"text": "Confirm PRODAPP can reboot tonight after 9 pm", "kind": "confirm", "options": [], "recommended": null, "blocking": true, "quote": "confirm it is OK to reboot PRODAPP tonight after 9 pm"}]
```
