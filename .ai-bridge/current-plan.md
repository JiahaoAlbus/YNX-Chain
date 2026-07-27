# Current Plan

Phase: `TESTNET` execution and evidence compatibility.

Protected baselines:

- Integration contract and cross-product vectors: `8eb801f`.
- Four-validator Block Hash/AppHash, 3/4 precommit, stop/recovery and replay proof: `f03c93e`.
- ABCI State Sync snapshot runtime and tests: `913f207`.
- Backup, restore and rollback replay to current AppHash: `74fc8dc`.
- Committed EVM block-transaction count and transaction-by-block-index lookups: `7b59af3`.
- Durable Indexer checkpoint/WAL validation, atomic persistence and tamper rejection: `bf08b68`.
- EVM lookup error classification: `7935ced`.
- Bounded chain-6423 EIP-155 legacy type-0 value transfers and dual transaction identity: `5469ed2`.
- Independent committed EVM receipt audit validation and CometBFT evidence binding: `328ba67`.

Current recoverable slice:

1. Bind Release Record, Integration Contract, Handoff, full-goal coverage and 45 cross-product vectors to implementation baseline `328ba67b7284`.
2. Freeze accepted EIP-155 type-0 behavior and wrong-chain, malformed or typed, replay and receipt-audit tamper rejection semantics.
3. Record ABCI application version 15 while retaining committed-state v11 and snapshot format 1.
4. Keep `integratedCentral`, staging, public, hosted, production-signed and store states false.
5. Run integration, EIP-155, race, full regression, static, objective, placeholder and secret gates; then Commit, Push and verify Local SHA equals Remote SHA.

Next runtime slice after this evidence checkpoint:

1. Audit EIP-2718 typed transaction envelopes, EIP-2930 access lists and EIP-1559 fee fields against YNX deterministic fee accounting.
2. Implement only a chain-bound typed envelope whose signature recovery, nonce, fee debit, replay, block mapping and receipt evidence can be proven exactly.
3. Preserve canonical YNX and bounded EIP-155 type-0 envelope compatibility during migration.
4. Do not claim general Ethereum execution, contract creation, calldata, access-list or EIP-1559 support before those gates pass.
