# Current Plan

Phase: `TESTNET` execution compatibility.

Completed and pushed baselines:

- Integration contract and cross-product vectors: `8eb801f`.
- Four-validator Block Hash/AppHash, 3/4 precommit, fault recovery and replay proof: `f03c93e`.
- ABCI v14 State Sync snapshot runtime and tests: `913f207`.
- Stopped-validator backup, full data deletion, restore to an earlier height and rollback replay to current AppHash: `74fc8dc`.
- Machine release and integration records bound to the recovery baseline: `597ae52`.

Current recoverable slice:

1. Add standard committed-block transaction count lookups by block number and block hash.
2. Add committed transaction lookup by block number/hash plus canonical transaction index.
3. Bind all results to validated CometBFT block, AppHash, DataHash and raw transaction evidence; return `null` for pending, unavailable blocks and out-of-range indexes; reject malformed quantities and hashes.
4. Run focused gateway, race, receipt gate, static and scanner checks.
5. Commit and push only the EVM slice and handoff files. Preserve unrelated concurrent `internal/indexer/indexer.go` dirty work without staging, overwriting or discarding it.

Next slice after push:

- Freeze machine-readable EVM RPC vectors against the implementation SHA.
- Continue standard Ethereum raw transaction envelope compatibility without claiming native Ethereum RLP support until it is implemented and proven.
- Keep public deployment, production signing and public BFT cutover false until direct remote evidence exists.
