# Next Action

Current implementation baseline: `7935cedb57ab`.

Completed and protected local Testnet slices:

- four-validator identical genesis, fixed-height Block Hash/AppHash and 3/4 precommit;
- signed YNXT transfer, all-node account equality and replay rejection;
- one-validator stop, recovery, State Sync, backup, restore and rollback replay;
- EVM committed block transaction count and transaction-by-block-index lookups (`7b59af3`);
- durable Indexer checkpoint/WAL validation, atomic persistence, tamper rejection and restart recovery (`bf08b68`);
- fail-closed EVM block-transaction lookup classification: invalid parameters return `-32602`, CometBFT or evidence failures return `-32603`, and pending, missing or out-of-range lookups return `null` (`7935ced`).

Current single action: finish freezing and validating machine-readable EVM block-transaction lookup vectors against `7935cedb57ab`, then commit and push the evidence-only slice while preserving every unsupported release boolean as false.

Files in the current slice:

- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `scripts/verify/integration-contract-check.mjs`
- `scripts/verify/bft-evm-receipt-check.sh`
- `release/product-release.json`
- `release/integration/chain-core-contract.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `.ai-bridge/full-goal-coverage.json` and handoff state

Validation commands:

- `make integration-contract-check`
- `make bft-evm-receipt-check`
- `go test -race ./internal/bftgateway`
- `go test ./cmd/... ./internal/...`
- `make static-check`
- `make no-placeholder-check`
- `make secret-scan`

Completion standard:

- vectors are machine-readable, source-commit-bound and cover positive, pending or missing, out-of-range, malformed quantity or hash, wrong parameter count and upstream evidence failure cases;
- runtime, contract, vectors and verification gates agree exactly;
- Release Record, Contract, Handoff and coverage matrix remain truthful;
- the slice is committed, pushed, Local SHA equals Remote SHA and the worktree is clean.

Next runtime slice after this evidence checkpoint:

- evaluate and implement standard Ethereum signed transaction envelope compatibility behind the existing committed-state boundary;
- do not claim Ethereum RLP, EIP-155, EIP-1559 or arbitrary EVM execution support until exact decode, chain binding, signature recovery, replay rejection, execution and receipt vectors pass.

Explicitly not doing:

- no public deployment, production signing, Mainnet claim or public BFT cutover without direct evidence and authority;
- no changes to other product Worktrees or conflicting central Wallet, Oracle, Data Fabric, Security, Governance, Website or Integration ownership.
