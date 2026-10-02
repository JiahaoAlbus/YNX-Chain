# Social audience independent-negative repairs

Baseline: dc6c71c58321b19c736499b57121d4841fa0f879,
tree 4655221c6e2a6f29189d9c5ad74e104cca9da4b3.

Source and local regression checkpoint only. Deployment remains NO_GO.
No production data, account authorization, wallet signing or transaction was used.

## Changes

- Unknown audience work is fenced by original actor/action/transaction, independently of fresh nonce, session, expiry or restart. Prepared ledger records remain durable and capacity-limited; unresolved work requires explicit settlement, not automatic redispatch.
- Top-level index ownership and event-ID syntax are checked before external work.
- Original policy, role and writer availability are checked again after room confirmation and before private event observation; existing final store checks remain.
- HTTP requests recheck actual browser authority and original browser binding after remote awaits, with original session/action expiry. This does not replay the already consumed introspection proof.
- Missing encrypted Matrix audience authority yields HTTP 503.
- Audience HTTP adapter tests now use a real Response and the fetch input contract. Adapter remains a fail-closed integration component, not a claim of mounted/public UI completion.

## Executed evidence

- `go test -race -v ./internal/social -run '^TestIndependentAudience'`: seven independent cases passed. Fixture copied from the independent archive into the owned Social test package; its synthetic identities and HS observations are not installed/public evidence.
- `go test ./internal/social ./cmd/ynx-sociald`: both packages passed.
- `npm test` in `apps/social`: 94 passed, zero failed/skipped.
- `npm run typecheck`: passed.
- Go runtime: local go1.25.13, GOPROXY=off and GOSUMDB=off. Logs accompany this document. Go formatting occurred after the tests; no semantic changes were made by formatting.

## Still not established

Browser grant revalidation is real BrowserSSO authority checking in the regression fixture. Full remote ProductSession revocation/liveness after each await is NOT established: shared owner A must supply an approved live-session revalidation contract that does not reuse the one-time introspection proof. Native authority requires that same real contract; expiry alone is not revocation checking.

No real homeserver adapter, deployment, browser source-bound wallet lifecycle, installed user flow, durable composer recovery, encrypted attachment flow or full Social v2 acceptance is proved by these local tests. Keep those gates separate and false until directly verified. Unknown-operation settlement must preserve the original intent and original remote result; no new nonce/session may be used to conceal uncertainty.
