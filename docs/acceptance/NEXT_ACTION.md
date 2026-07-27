# Next Action

Current implementation baseline: `328ba67b7284`.

Completed and protected local Testnet slices:

- four-validator identical genesis, fixed-height Block Hash/AppHash and 3/4 precommit;
- signed YNXT transfer, all-node account equality and replay rejection;
- one-validator stop, recovery, State Sync, backup, restore and rollback replay;
- EVM committed block transaction count and transaction-by-block-index lookups (`7b59af3`);
- durable Indexer checkpoint/WAL validation, atomic persistence, tamper rejection and restart recovery (`bf08b68`);
- fail-closed EVM block-transaction lookup classification (`7935ced`);
- bounded chain-6423 EIP-155 legacy type-0 value-transfer decoding, sender recovery, zero-based nonce execution, 21000-gas fee mapping, dual Ethereum/Comet transaction identity and committed receipt lookup (`5469ed2`);
- independent committed EVM receipt audit validation and CometBFT transaction-evidence binding (`328ba67`).

Current single action: freeze and validate the machine-readable EIP-155 and receipt-audit vectors against `328ba67b7284`, commit and push the evidence checkpoint, and preserve every unsupported release boolean as false.

Files in the current slice:

- `release/product-release.json`
- `release/integration/chain-core-contract.json`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `scripts/verify/integration-contract-check.mjs`
- `docs/acceptance/PROJECT_STATE.md` and `docs/acceptance/NEXT_ACTION.md`
- `.ai-bridge/full-goal-coverage.json` and handoff state

Validation commands:

- `make integration-contract-check`
- `make bft-evm-legacy-transfer-check`
- `go test -race ./internal/consensus ./internal/bftgateway`
- `go test ./cmd/... ./internal/...`
- `make static-check`
- `make objective-state-check`
- `make no-placeholder-check`
- `make secret-scan`

Completion standard:

- release record, integration contract, vectors, handoff and full-goal coverage bind to the same exact implementation baseline;
- vectors prove the accepted type-0 profile and rejection of wrong-chain, replayed, malformed, typed and audit-tampered evidence;
- the contract explicitly denies access-list, contract-creation, calldata and EIP-1559 support;
- the slice is committed, pushed, Local SHA equals Remote SHA and the worktree is clean.

Next runtime slice after this evidence checkpoint:

- audit EIP-2718 typed envelopes, beginning with exact EIP-2930 and EIP-1559 chain, signature, access-list and fee semantics;
- implement a typed envelope only when deterministic YNX fee accounting, replay protection, block mapping and receipt evidence are complete;
- preserve the existing canonical YNX envelope and bounded EIP-155 type-0 transfer behavior during migration.

Explicitly not doing:

- no claim of general Ethereum execution, contract creation, calldata, access-list or EIP-1559 support;
- no public deployment, production signing, Mainnet claim or public BFT cutover without direct evidence and authority;
- no changes to other product Worktrees or conflicting central Wallet, Oracle, Data Fabric, Security, Governance, Website or Integration ownership.
