I drafted the connection pool config for the shop API database. It routes the app through a pooler, caps the direct connections to the primary, and sets the pool mode.

Two things before I apply it: pick the pool mode (transaction pooling or session pooling; I recommend transaction pooling), and confirm it is OK to restart the API tonight after 9 pm.

```ledgr-asks
[{"text": "Pick the pool mode for the shop API database", "kind": "decide", "options": ["Transaction pooling", "Session pooling"], "recommended": "Transaction pooling", "blocking": true, "quote": "pick the pool mode (transaction pooling or session pooling; I recommend transaction pooling)"},
 {"text": "Confirm the API can restart tonight after 9 pm", "kind": "confirm", "options": [], "recommended": null, "blocking": true, "quote": "confirm it is OK to restart the API tonight after 9 pm"}]
```
