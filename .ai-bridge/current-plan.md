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
- Committed EIP-1559 Gateway/Comet evidence, duplicate classification and four-validator rollback proof: `57a13ba`.

Current recoverable slice:

1. Freeze Release Record and Integration Contract v1.8.0 to runtime source `57a13bacaaf1`.
2. Freeze 66 unique cross-product vectors covering fee suggestions, signer CLI, configurable fixtures, full four-validator type-0x02 commit/rollback, committed block/receipt/gas binding, evidence mismatch rejection and Comet cache duplicate classification.
3. Update Handoff, full-goal coverage, evidence indexes and bridge state without changing any unsupported release boolean.
4. Run integration, objective-state, EVM, four-validator, race, full regression, static, placeholder and secret gates.
5. Commit, push and verify Local SHA equals Remote SHA.

Next runtime slice after this evidence checkpoint:

1. Implement `eth_feeHistory` only from committed block evidence and only with truthful zero `baseFeePerGas` values; do not fabricate reward percentiles or a dynamic fee market.
2. Preserve committed-only EVM reads and post-broadcast proof binding; never return success when block membership, AppHash/DataHash, gas results or audited receipt evidence disagree.
3. Keep `eth_gasPrice` and `eth_maxPriorityFeePerGas` explicitly identified as protocol minimum suggestions, not market forecasts.
4. Continue remote-current-source deployment adapters and independent evidence preparation only when real deployment authority exists; do not claim production signing, central integration or public deployment.
