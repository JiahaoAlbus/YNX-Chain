# Current Plan

Phase: `TESTNET` execution and evidence compatibility.

Protected baselines:

- Integration contract and cross-product vectors: `8eb801f`.
- Four-validator Block Hash/AppHash, 3/4 precommit, stop/recovery and replay proof: `f03c93e`.
- ABCI v14 State Sync snapshot runtime and tests: `913f207`.
- Backup, restore and rollback replay to current AppHash: `74fc8dc`.
- Committed EVM block-transaction count and transaction-by-block-index lookups: `7b59af3`.
- Durable Indexer checkpoint/WAL validation, atomic persistence and tamper rejection: `bf08b68`.
- EVM block-transaction lookup error classification and local syntax-first rejection: `7935ced`.

Current recoverable slice:

1. Freeze seven machine-readable EVM block-transaction lookup vectors against implementation baseline `7935cedb57ab`.
2. Bind success, pending or missing, out-of-range, malformed quantity or hash, wrong parameter count and upstream/evidence failure semantics to the receipt gate and integration contract check.
3. Keep Release Record, Integration Contract, Handoff, Project State and full-goal coverage synchronized to the same implementation baseline.
4. Keep `integratedCentral`, staging, public, hosted, production-signed and store states false.
5. Commit and push this evidence slice separately, then verify Local SHA equals Remote SHA and the worktree is clean.

Validation completed for this slice:

- `make integration-contract-check` — 40 vectors, state v11, source `7935cedb57ab`.
- `make bft-evm-receipt-check`.
- `go test -race ./internal/bftgateway`.
- `go test ./cmd/... ./internal/...`.
- `make static-check`.
- `make objective-state-check`.
- `make no-placeholder-check`.
- `make secret-scan`.

Next runtime slice after push:

1. Audit existing transaction decoding and dependencies for standard Ethereum legacy and typed transaction envelopes.
2. Implement only exact, chain-bound, signature-recovering transaction types that can map deterministically into YNX committed execution.
3. Add negative vectors for wrong chain, malformed RLP, invalid signature, replay, unsupported access list or fee semantics and execution mismatch.
4. Preserve current canonical YNX transfer envelope support during migration.
5. Do not claim Ethereum RLP, EIP-155, EIP-1559 or arbitrary EVM compatibility before implementation, execution and receipt proof.
6. Preserve CometBFT as the safety baseline and keep public deployment/BFT cutover false until direct remote evidence and authority exist.
