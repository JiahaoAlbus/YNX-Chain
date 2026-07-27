# Next Action

Current implementation baseline: `6959df920e71`.

Completed and protected local Testnet slices:

- four-validator identical genesis, fixed-height Block Hash/AppHash and 3/4 precommit;
- signed YNXT transfer, all-node account equality and replay rejection;
- one-validator stop, recovery, State Sync, backup, restore and rollback replay;
- EVM committed block transaction count and transaction-by-block-index lookups (`7b59af3`);
- durable Indexer checkpoint/WAL validation, atomic persistence, tamper rejection and restart recovery (`bf08b68`);
- fail-closed EVM block-transaction lookup classification (`7935ced`);
- bounded chain-6423 EIP-155 legacy type-0 value transfer, dual Ethereum/Comet identity and replay protection (`5469ed2`);
- independent committed EVM receipt audit validation and CometBFT evidence binding (`328ba67`);
- bounded EIP-2930 type-0x01 empty-access-list value transfer, y-parity sender recovery, exact 21000-gas accounting and type-0x1 JSON-RPC mapping (`6959df9`).

Current single action: freeze and validate the machine-readable EIP-2930 contract and 50-vector evidence set against `6959df920e71`, commit and push the evidence checkpoint, and preserve every unsupported release boolean as false.

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
- `make bft-evm-access-list-transfer-check`
- `make bft-evm-legacy-transfer-check`
- `make bft-evm-receipt-check`
- `go test -race ./internal/consensus ./internal/bftgateway`
- `go test ./cmd/... ./internal/...`
- `make static-check`
- `make objective-state-check`
- `make no-placeholder-check`
- `make secret-scan`

Completion standard:

- release record, integration contract v1.6.0, vectors, handoff and full-goal coverage bind to the same exact implementation baseline;
- vectors prove accepted EIP-155 type `0x0` and EIP-2930 type `0x1` empty-access-list transfers;
- vectors reject wrong-chain, replayed, malformed, non-empty-access-list, calldata, contract-creation, EIP-1559 and audit-tampered evidence;
- committed state remains v11, ABCI application version is 16 and State Sync snapshot format remains 1;
- the slice is committed, pushed, Local SHA equals Remote SHA and the worktree is clean.

Next runtime slice after this evidence checkpoint:

- audit EIP-1559 type `0x2` against deterministic YNX fee accounting and the absence of an Ethereum base-fee market;
- implement type `0x2` only if chain binding, sender recovery, nonce, fee debit, replay, block mapping and receipt evidence can be proven without fabricating base-fee semantics;
- preserve canonical YNX, bounded EIP-155 type `0x0` and bounded EIP-2930 type `0x1` behavior during migration.

Explicitly not doing:

- no claim of general Ethereum execution, non-empty access-list, contract creation, calldata or EIP-1559 support;
- no public deployment, production signing, Mainnet claim or public BFT cutover without direct evidence and authority;
- no changes to other product Worktrees or conflicting central Wallet, Oracle, Data Fabric, Security, Governance, Website or Integration ownership.
