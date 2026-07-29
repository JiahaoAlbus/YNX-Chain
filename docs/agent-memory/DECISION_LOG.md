# Decision Log

## 2026-07-29 — Preserve native EventSource recovery

The frontend no longer closes and recreates `EventSource` from `onerror`. Browsers retain the last delivered SSE event ID only when native reconnection remains active; manual replacement discarded that recovery state. Bounded polling remains a temporary fallback and stops when stream delivery resumes.

## 2026-07-29 — Use monotonic process-local event IDs

Dashboard-derived IDs such as `{rpcHeight}-{indexedHeight}-{txCount}` can repeat when the chain is idle and cannot define an ordered replay interval. The Explorer now assigns monotonically increasing decimal IDs per server process.

A server restart intentionally invalidates the old event-ID sequence. Reconnecting clients receive explicit snapshot recovery rather than a false replay claim.

## 2026-07-29 — Bound replay history to 64 events

The server retains the latest 64 stream events. This is sufficient for short reconnect windows while preventing unbounded memory growth. An unavailable or expired ID causes `stream-reset` plus a full dashboard snapshot.

## 2026-07-29 — Disconnect slow clients instead of dropping silently

When a client channel is full, the server removes and closes that client connection. Native EventSource reconnect then carries the last successfully delivered ID and uses replay-or-snapshot recovery. Silent per-client event loss is prohibited.

## 2026-07-29 — Separate runtime and evidence commits

Runtime behavior is bound to `57b0038312a58e48c97c73f8efaf4473764b9890`. Evidence and release metadata are bound in `0a2c1e15763152398bf67156ace6bd6a60379276`. Documentation commits are not represented as the implementation source.

## Permanent boundaries

- `ynxweb4.com` is the only YNX product website; `huangjeo.com` remains the Founder site.
- Product 12 does not self-approve central integration, public deployment, signing, hosted artifacts or production release.
- Missing owner facts are shown as unavailable/partial; Explorer does not invent market, Quant, economics, solvency or finality facts.
