# YNX AI decisions

1. The YNX AI product remains an advice/proposal layer. Approval never equals execution.
2. Generation cancellation is account-owned. Wrong-account cancellation returns 404 to avoid existence disclosure.
3. Prompt and attachment content may enter the Gateway only through a strict JSON POST body, never URL/query parameters.
4. Unknown generation fields fail closed.
5. Attachments require explicit `selected_files` context selection.
6. Gateway audit stores the original prompt hash and request metadata, not raw prompt or attachment text.
7. Provider HTTP 429 remains HTTP 429 with stable code `provider_rate_limited`; it is not collapsed into generic 502.
8. Other Provider/Gateway failures remain truthful and redact upstream response bodies.
9. Gateway pre-stream failures use a stable JSON envelope with `code`, `error` and `requestId`.
10. Gateway success SSE owns `metadata`, `token` and `done`; product generation SSE separately owns `metadata`, `token`, `done` and truthful `error`.
11. Local implementation is not central integration, staging deployment, public deployment, hosted download, production signing, store release or live generation.
12. Rollback may disable generation but may not restore legacy prompt-in-query transport.
13. The Integration Contract and cross-product vectors are Release Gate inputs, not passive documentation.
14. `product-release.commit` identifies the exact Runtime source commit; `evidenceCheckpointCommit` identifies the evidence/contract checkpoint.
15. The Product AI Registry must deny unknown products and cross-product private context by default; explicit product identity, approved scope and selected context are required.
16. No unverified dirty slice is committed merely to create apparent progress.
