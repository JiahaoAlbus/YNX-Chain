# Next Action

Current implementation baseline: `bf08b68a1835`.

Completed and protected local Testnet slices:

- four-validator identical genesis, fixed-height Block Hash/AppHash and 3/4 precommit;
- signed YNXT transfer, all-node account equality and replay rejection;
- one-validator stop, recovery, State Sync, backup, restore and rollback replay;
- EVM committed block transaction count and transaction-by-block-index lookups (`7b59af3`);
- durable Indexer checkpoint/WAL validation, atomic persistence, tamper rejection and restart recovery (`bf08b68`).

Current single action: freeze machine-readable EVM block-transaction lookup vectors against the current implementation, including success, pending or missing block, out-of-range index, malformed quantity or hash, wrong parameter count and upstream evidence failure semantics.

Files to touch:

- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `scripts/verify/bft-evm-receipt-check.sh`
- EVM Gateway tests only when the frozen vectors expose a missing runtime case
- `.ai-bridge/full-goal-coverage.json`, `release/product-release.json` and the Integration Handoff for evidence-only synchronization

Validation commands:

- `go test -race ./internal/bftgateway`
- `make bft-evm-receipt-check`
- `make static-check`
- `make no-placeholder-check`
- `make secret-scan`

Completion standard:

- vectors are machine-readable, source-commit-bound and cover all positive and fail-closed EVM block-transaction lookup cases;
- runtime and vectors agree exactly;
- targeted and scanner gates pass;
- Release Record, Contract, Handoff and coverage matrix remain truthful;
- the slice is committed, pushed, Local SHA equals Remote SHA and the worktree is clean.

Explicitly not doing:

- no public deployment, production signing, Mainnet claim or public BFT cutover without direct evidence and authority;
- no native Ethereum RLP or arbitrary EVM compatibility claim beyond implemented and tested methods;
- no changes to other product Worktrees or conflicting central Wallet, Oracle, Data Fabric, Security, Governance, Website or Integration ownership.
