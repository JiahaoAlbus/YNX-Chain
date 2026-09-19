# Finance Weekly v3 — Wallet approval and durable Broker core

Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/24-finance-flow-20260912`.
Branch: `codex/finance-wallet-flow-20260912`.
Predecessor: `fa3d66b169d22d52b936d57bbf35ab92cb023ec5`.
Owner scope: `apps/finance/**` and `internal/finance/**` only.

## Delivered source boundary

- Imports the four frozen Finance order-approval contract artifacts only after exact SHA-256 verification. The import manifest binds Wallet authority commit `ab4dfa927be3d16fde3048b72d705d90c770dcd3` and the exact verifier and transport source identities.
- Implements the cross-language canonical order hash, derived Finance subject, compact secp256k1 signature verification, low-S enforcement, account/public-key binding, five-minute approval lifetime, 32 KiB canonical callback limit, and strict duplicate/unknown-key rejection.
- Uses Finance server time as authority. Approval verify is separate from persistent consume. Consume, revoke and expiry use the same authenticated compare-and-swap state transition boundary.
- Adds deterministic manual/AI order drafts with exact decimal arithmetic. AI text is never execution authority; the server supplies fee evidence and all signed bounds.
- Adds persistent per-user/provider/sandbox mapping, challenges, order records, outbox and audit journal. A concurrent two-instance consume produces one provider client-order ID, one outbox item and one consumed audit event; replay and consume-vs-revoke races fail closed.
- Migrates authenticated state lazily from schema v1 to v2 while retaining old-hash verification. Rollback to a v1-only binary after a v2 write is unsupported unless the pre-migration snapshot is restored.
- Extends the Broker adapter with read-only account, cash, orders, positions and reconciliation normalization. Provider submit/cancel writes and a public submit route remain deliberately disabled until separately activated and verified.

## Verification

- `go test -race ./internal/finance/... ./apps/finance/cmd/broker-tools` — PASS.
- `go vet ./internal/finance/... ./apps/finance/cmd/broker-tools` — PASS.
- `npm test --prefix apps/finance` — 51/51 PASS.
- `npm run security --prefix apps/finance` — PASS across 368 text files.
- Linux amd64 reproducible build — 28,799,108 bytes; SHA-256 `461b164f8a94f9f8682060206e573630600ecd93c2b86f9ed6010b91643a0b43`.
- `go test ./...` reached and passed Finance, then failed only in unrelated `internal/bftgateway` and `internal/consensus` tests because `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json` is absent from this worktree.

## Truth boundary

This is a source/build checkpoint. Official Broker credentials were not provided; no provider write was attempted; no public submit route was enabled; no account approval, signature, securities order, public deployment or installed-app result is claimed. `officialSandboxVerified`, `providerWriteEnabled`, `publicDeployed`, `walletApprovalVisible`, `orderSubmitted`, `productionApproved` all remain `false`.

Rollback is source rollback plus restoration of the authenticated pre-v2 snapshot. No service, public runtime, Wallet source or other product directory was changed.
