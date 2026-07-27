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
- Bounded EIP-2930 type-0x01 empty-access-list transfers, deterministic fee accounting and JSON-RPC type mapping: `6959df9`.

Current recoverable slice:

1. Bind Release Record, Integration Contract v1.6.0, Handoff, full-goal coverage and 50 unique cross-product vectors to implementation baseline `6959df920e71`.
2. Freeze accepted EIP-2930 empty-access-list behavior and wrong-chain, non-empty-access-list, calldata, contract-creation, replay and EIP-1559 rejection semantics.
3. Record ABCI application version 16 while retaining committed-state v11 and State Sync snapshot format 1.
4. Keep `integratedCentral`, staging, public, hosted, production-signed and store states false.
5. Run integration, EIP-2930, EIP-155, receipt, race, full regression, static, objective, placeholder and secret gates; then Commit, Push and verify Local SHA equals Remote SHA.

Next runtime slice after this evidence checkpoint:

1. Audit EIP-1559 type-0x02 fee fields against deterministic YNX fee accounting and the absence of an Ethereum base-fee market.
2. Implement only if signature recovery, nonce, maximum and effective fee debit, replay protection, block mapping and receipt evidence can be proven exactly without fabricating base-fee semantics.
3. Preserve canonical YNX, bounded EIP-155 type-0x0 and bounded EIP-2930 type-0x1 behavior during migration.
4. Do not claim general Ethereum execution, non-empty access lists, contract creation, calldata or EIP-1559 support before those gates pass.
