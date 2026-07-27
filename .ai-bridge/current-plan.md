# Current Plan

Phase: `TESTNET` execution and evidence compatibility.

Protected baselines:

- Integration contract and cross-product vectors: `8eb801f`.
- Four-validator Block Hash/AppHash, 3/4 precommit, stop/recovery and replay proof: `f03c93e`.
- ABCI State Sync snapshot runtime and tests: `913f207`.
- Backup, restore and rollback replay to current AppHash: `74fc8dc`.
- Committed EVM block-transaction count and transaction-by-block-index lookups: `7b59af3`.
- Durable Indexer checkpoint/WAL validation and tamper rejection: `bf08b68`.
- Bounded EIP-155, EIP-2930 and zero-base-fee EIP-1559 transfers: `5469ed2`, `6959df9`, `d6505fb`.
- Zero-base-fee gas suggestions and read-only freeze classification: `acb8c47`, `c6c013c`.
- Bounded signer CLI and configurable local consensus fixture funding: `27c52eb`, `3c5c0c8`.
- Committed EIP-1559 Gateway/Comet evidence and four-validator rollback proof: `57a13ba`.
- Committed zero-base-fee `eth_feeHistory` with positive CometBFT `max_gas` evidence: `fdb005c`.

Current recoverable slice:

1. Prove `eth_feeHistory` against a real local four-validator CometBFT network configured with a positive consensus `max_gas`, including a committed type-0x02 transaction and evidence-derived `gasUsedRatio`.
2. Bind the returned oldest block, zero base-fee array, per-block gas ratios and next-block base fee to exact committed block, block-results and consensus-parameter evidence.
3. Add negative drills for non-positive `max_gas`, tampered gas usage, mismatched consensus-parameter height, pending/pruned history and non-empty reward percentiles.
4. Preserve fail-closed `-32004` and `-32603` classifications and keep all central, public and production release booleans false.
5. Run focused, quorum, race, regression and security gates; then Commit, Push and verify Local SHA equals Remote SHA.
