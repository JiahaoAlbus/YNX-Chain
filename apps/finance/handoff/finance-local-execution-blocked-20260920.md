# Finance local execution-blocked checkpoint

Branch: `codex/finance-local-execution-blocked-20260920`

Implementation: `3ecf196ca495a4d4f533b927dcc9415a7e23da0a`

Implementation tree: `09aa16f8ae7901e0cab65a88809f6d8375eab842`

Predecessor: `cc72c82d5cf56db1cb2d85c3c8eca455645cc5ed`

Remote branch: `codex/finance-local-execution-blocked-20260920`

Pull request: `https://github.com/JiahaoAlbus/YNX-Chain/pull/148`

## Closed gap

The controlled worker no longer records approval expiry or a changed owner-to-provider account mapping as `provider_rejected`. Both are pre-provider local terminal conditions and now persist as `execution_blocked` with the exact local error code, an existing execution request key, a non-zero execution-request timestamp, and no provider order, raw status or provider HTTP request correlation. No provider POST occurs.

Readiness exposes a separate `executionBlocked` count and treats contradictory blocked pairs as inconsistent. Exact legacy v2 records previously written as `provider_rejected` with one of the two local codes, a correlated execution request and no provider evidence migrate in memory to `execution_blocked`. Canonical `PROVIDER_REJECTED`, ambiguous submissions and provider-correlated records are not rewritten. Provider-read preflight failures remain bounded retryable `execution_requested` work.

Restart coverage proves the local block is durable and cannot be redispatched. The workspace API exposes the persisted order/outbox state without inventing provider evidence.

## Verification

- `go test -race ./internal/finance/... ./apps/finance/cmd/...` — PASS.
- `go vet ./internal/finance/... ./apps/finance/cmd/...` — PASS.
- `go build ./apps/finance/cmd/...` — PASS.
- `npm --prefix apps/finance test` — 50/50 PASS.
- `npm --prefix apps/finance run security` — PASS across 198 text files.
- `git diff --check` — PASS.

## Rollback

Source rollback is the predecessor above. If this code has persisted an `execution_blocked` record, restore the authenticated predecessor state snapshot before starting the predecessor binary because that binary does not recognize the added state. No public runtime was deployed in this slice, so no service rollback is authorized or required.

## Truth boundary

This is source and test evidence only. No official Broker credential was available, no provider read or write occurred, no public or installed runtime was changed, and no Wallet account request, approval, signature, securities order or chain transaction was performed. Official Sandbox verification, provider execution, public deployment, installed-runtime proof and production trading remain false.
