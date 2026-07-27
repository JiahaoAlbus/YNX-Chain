# Current Plan

Phase: `TESTNET` execution and evidence compatibility.

Protected baselines:

- Integration contract and cross-product vectors: `8eb801f`.
- Four-validator Block Hash/AppHash, 3/4 precommit, stop/recovery and replay proof: `f03c93e`.
- ABCI v14 State Sync snapshot runtime and tests: `913f207`.
- Backup, restore and rollback replay to current AppHash: `74fc8dc`.
- Committed EVM block-transaction count and transaction-by-block-index lookups: `7b59af3`.
- Durable Indexer checkpoint/WAL validation, atomic persistence and tamper rejection: `bf08b68`.

Current recoverable slice:

1. Keep Release Record, Integration Contract, Handoff, Project State and the full-goal coverage matrix bound to implementation baseline `bf08b68a1835`.
2. Validate all machine JSON and objective-state gates.
3. Keep `integratedCentral`, staging, public, hosted, production-signed and store states false.
4. Commit and push the metadata/coverage/security-gate slice separately from runtime changes.

Next runtime slice after push:

1. Freeze machine-readable EVM block-transaction lookup vectors in `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`.
2. Cover success, missing/pending block, out-of-range index, malformed quantity/hash, wrong parameter count and upstream evidence failure.
3. Bind the vectors to `scripts/verify/bft-evm-receipt-check.sh` and current Gateway tests.
4. Continue standard Ethereum raw transaction envelope compatibility only after the frozen vector slice; do not claim native Ethereum RLP or EIP-1559 transaction support before implementation and proof.
5. Preserve CometBFT as the safety baseline and keep public deployment/BFT cutover false until remote direct evidence exists.
