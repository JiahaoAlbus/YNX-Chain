# Evidence index

## Recovery

- Recovery baseline: `ffb528b4971b5849ffb151a018263daf5c0e2cb0` from `codex/ecosystem-pay`.
- Restored uncommitted Merchant Console files and the coupled `internal/payproduct` Merchant/RBAC/Webhook/Settlement implementation from `/Users/huangjiahao/Desktop/YNX Chain Pay` without modifying that source worktree.
- Target branch/worktree: `codex/final-merchant-console`, `05-merchant-console`.

## Local verification (2026-07-22, Apple M2, darwin/arm64)

- `npm ci && npm run check`: 7/7 tests passed; production static bundle built.
- `go test ./internal/payproduct/...`: passed.
- RBAC fuzz: 40,768 executions in 2 seconds after 108 seed cases; passed.
- Webhook fuzz: 8,358 executions in 3 seconds after seed coverage; passed.
- Settlement fuzz: 14,102 executions in 3 seconds after seed coverage; passed.
- `TestMerchantRBACWebhookSettlementSoak`: 100,000 iterations; passed within the normal Go suite.
- Fault test: provider failure leaves invoice pending and membership permissions fail closed.
- Microbenchmarks: RBAC 14.52 ns/op, webhook signing material 280.2 ns/op, settlement evidence validation 16.60 ns/op. These are component benchmarks, not end-to-end capacity claims.

## Truthful release state

See `product-release.json`. No public URL, public Testnet transaction, hosted download, central integration or production signature is claimed.
