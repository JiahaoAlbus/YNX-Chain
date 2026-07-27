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
- Zero-base-fee gas suggestions and committed `eth_feeHistory`: `acb8c47`, `fdb005c`.
- Committed EIP-1559 Gateway/Comet evidence and four-validator rollback proof: `57a13ba`.
- Real four-validator positive-`max_gas` fee-history proof: `5c08b24`.

Current recoverable slice:

1. Freeze Release Record and Integration Contract v1.10.0 to runtime source `5c08b24462a2`.
2. Freeze 71 unique cross-product vectors, including the four-validator `max_gas=42000`, committed gas `21000`, zero-base-fee and `gasUsedRatio=0.5` proof.
3. Update Handoff, evidence indexes, acceptance state and `.ai-bridge` without changing unsupported public or production booleans.
4. Run integration, real consensus fee-history, objective-state, static, placeholder and secret gates.
5. Commit, push and verify Local SHA equals Remote SHA.

Next runtime slice after this evidence checkpoint:

1. Continue the next autonomous TESTNET compatibility or recovery gap using committed evidence only.
2. Prepare remote-current-source deployment and follower-first recovery adapters, but do not claim deployment until real authority and infrastructure exist.
3. Preserve fail-closed EVM evidence binding and do not claim generalized Ethereum execution, a dynamic fee market, production signing, central integration or public deployment.
