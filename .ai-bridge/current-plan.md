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
- Committed bounded `eth_getStorageAt` runtime and capability gate: `c89b6f9`, `9155c76`.

Completed recoverable slice:

1. Added current-committed `eth_getStorageAt` for the bounded pinned-contract runtime.
2. Bound reads to canonical lowercase addresses, canonical storage-position quantities and current committed state only.
3. Return exact AppHash-persisted 32-byte storage words, with zero words for unknown contracts or slots.
4. Reject malformed/historical requests and fail closed on malformed ABCI storage keys or values.
5. Proved slot mutation, unknown slot/contract behavior, invalid input rejection, bounded IDE persistence and regression behavior.
6. Pushed runtime `c89b6f97dc1d` and capability checkpoint `9155c76`; local and remote SHAs matched after each push.

Next runtime slice:

1. Continue the next autonomous TESTNET EVM RPC compatibility or recovery gap using committed evidence only.
2. Prefer bounded read compatibility that can be proved against current CometBFT/ABCI state without fabricating Ethereum trie or historical-state semantics.
3. Prepare remote-current-source deployment and follower-first recovery adapters, but do not claim deployment until real authority and infrastructure exist.
4. Preserve fail-closed evidence binding and do not claim generalized Ethereum execution, a dynamic fee market, production signing, central integration or public deployment.
