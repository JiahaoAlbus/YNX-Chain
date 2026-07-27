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
- Bounded EIP-2930 type-0x01 empty-access-list transfers and JSON-RPC mapping: `6959df9`.
- Bounded EIP-1559 type-0x02 zero-base-fee transfers, maximum-fee exposure and JSON-RPC mapping: `d6505fb`.

Current recoverable slice:

1. Bind Release Record, Integration Contract v1.7.0, Handoff, full-goal coverage and 56 unique cross-product vectors to implementation baseline `d6505fb40988`.
2. Freeze EIP-1559 compatibility semantics: chain ID 6423, type `0x02`, empty access list, exact 21000 gas, `baseFeePerGas=0`, effective price equal to `maxPriorityFeePerGas`, and upfront value-plus-maximum-fee affordability.
3. Record ABCI application version 17 while retaining committed-state v11 and State Sync snapshot format 1.
4. Keep `integratedCentral`, staging, public, hosted, production-signed and store states false.
5. Run integration, EIP-1559, EIP-2930, EIP-155, receipt, consensus/Gateway and Indexer race, Indexer recovery, full regression, static, objective-state, placeholder and secret gates; then Commit, Push and verify Local SHA equals Remote SHA.

Next runtime slice after this evidence checkpoint:

1. Exercise type `0x02` through the full local CometBFT broadcast, committed block lookup and audited receipt readback path rather than only codec/application and committed-object mapping tests.
2. Fail closed on any mismatch among Ethereum Keccak identity, CometBFT SHA-256 identity, block membership, receipt action, sender, recipient, gas and fee evidence.
3. Preserve canonical YNX, bounded EIP-155 type `0x0`, bounded EIP-2930 type `0x1` and bounded zero-base-fee EIP-1559 type `0x2` behavior.
4. Do not claim general Ethereum execution, non-empty access lists, contract creation, calldata, a dynamic base-fee market or public deployment.
