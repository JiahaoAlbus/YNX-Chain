# Finance Weekly v3 — Wallet approval and durable Broker core

Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/24-finance-flow-20260912`.
Branch: `codex/finance-wallet-flow-20260912`.
Predecessor: `4dbe99498d628c0f64354858d5f84de266cf6a91`.
Owner scope: `apps/finance/**` and `internal/finance/**` only.

## Delivered source boundary

- Imports the four frozen Finance order-approval contract artifacts only after exact SHA-256 verification. The import manifest binds Wallet authority commit `ab4dfa927be3d16fde3048b72d705d90c770dcd3` and the exact verifier and transport source identities.
- Implements the cross-language canonical order hash, derived Finance subject, compact secp256k1 signature verification, low-S enforcement, account/public-key binding, five-minute approval lifetime, 32 KiB canonical callback limit, and strict duplicate/unknown-key rejection.
- Uses Finance server time as authority. Approval verify is separate from persistent consume. Consume, revoke and expiry use the same authenticated compare-and-swap state transition boundary.
- Adds deterministic manual and reviewed-AI order drafts with exact decimal arithmetic. An AI result can only be copied into the visible order form; the user must still request a server challenge and approve the exact Wallet payload. AI text is never execution authority; the server supplies fee evidence and all signed bounds.
- Adds persistent per-user/provider/sandbox mapping, challenges, order records, outbox and audit journal. A concurrent two-instance consume produces one provider client-order ID, one outbox item and one consumed audit event; replay and consume-vs-revoke races fail closed.
- Migrates authenticated state lazily from schema v1 to v2 while retaining old-hash verification. Rollback to a v1-only binary after a v2 write is unsupported unless the pre-migration snapshot is restored.
- Extends the Broker adapter with read-only account, cash, orders, positions, latest IEX quote and reconciliation normalization. Missing market data remains unknown and a quote never changes the limit-price field.
- Implements exact Sandbox Broker POST and cancel adapter calls behind a double fail-closed gate: server configuration plus a 64-hex activation receipt. There is still no public submit/cancel route and no worker is automatically started.
- Implements persistent dispatch claims, one-attempt submit, explicit `submitted_unknown` recovery, restart recovery, cancellation state, client-order reconciliation, and deterministic cursor persistence. Transport ambiguity is reconciled by stable client order ID; it is never blindly retried.
- Adds a bounded strict parser for the documented v2 trade-event SSE shape. Every event is tied to the persistent owner mapping before it can update an order; unknown fields, duplicate cursors, tenant mismatch, truncation and oversized batches fail closed. Network streaming remains unactivated.
- Imports Wallet authority `ab4dfa927be3d16fde3048b72d705d90c770dcd3` as the exact npm archive `web/vendor/ynx-chain-wallet-auth-1.1.0.tgz` (240104 bytes; SHA-256 `080a9b3b5bf460a0704b3f0d7128b9fdedb2cdc4eab0f129e3853b4ee4f4b605`). The browser bundle uses the package-root Finance request builder, URL encoder and callback parser; it does not hand-build a Wallet URI.
- Adds an operator `activation-plan` that reports readiness without provider I/O. It cannot submit or cancel an order, and missing activation evidence is a hard failure.
- Adds an operator-only `broker-worker dispatch-one` executable. It has no HTTP route or automatic service startup, accepts one exact absolute state path/account/order/activation receipt, refuses symlinks and mismatched receipts, performs restart recovery first, uses one bounded provider attempt, and declares ambiguous results non-retryable for reconciliation.

## Verification

- `go test -race ./internal/finance/... ./apps/finance/cmd/broker-tools` — PASS.
- `go vet ./internal/finance/... ./apps/finance/cmd/broker-tools` — PASS.
- `npm run build:order-wallet --prefix apps/finance/web` — PASS; 76442-byte bundle SHA-256 `6b31276287483b28e1eda1ddbe813a361a370b63dd6e94c1f161fd45ec311f18`.
- `npm test --prefix apps/finance` — 54/54 PASS.
- `npm run security --prefix apps/finance` — PASS across 379 text files.
- Linux amd64 reproducible build — 28,799,108 bytes; SHA-256 `461b164f8a94f9f8682060206e573630600ecd93c2b86f9ed6010b91643a0b43`.
- `go test ./...` reached and passed Finance, then failed only in unrelated `internal/bftgateway` and `internal/consensus` tests because `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json` is absent from this worktree.

## Truth boundary

This is a source/build checkpoint. Official Broker credentials were not provided; no provider write was attempted; no public submit route was enabled; no account approval, signature, securities order, public deployment or installed-app result is claimed. The adapter code being activation-gated does not make the runtime activated. `officialSandboxVerified`, `providerWriteEnabled`, `publicDeployed`, `walletApprovalVisible`, `orderSubmitted`, `productionApproved` all remain `false`.

The remaining external boundary is official Sandbox credentials, an operator-created per-user provider account mapping, read-only entitlement verification, and an explicit later authorization to invoke the controlled worker for a Sandbox write. Those are not inferred from source tests.

Rollback is source rollback plus restoration of the authenticated pre-v2 snapshot. No service, public runtime, Wallet source or other product directory was changed.
