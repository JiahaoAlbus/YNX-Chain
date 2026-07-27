# Next Action

Current implementation baseline: `57a13bacaaf1`.

Completed local Testnet proof:

- bounded EIP-155, EIP-2930 and zero-base-fee EIP-1559 value-transfer profiles;
- truthful minimum fee suggestions through `eth_gasPrice` and `eth_maxPriorityFeePerGas`;
- secure multi-envelope signer CLI and configurable positive local fixture balance;
- committed-broadcast rebinding to CometBFT block membership, AppHash/DataHash, gas result and audited receipt;
- four-validator EIP-1559 Gateway commit proof, equal AppHash/account/receipt evidence, wrong-chain and replay rejection;
- quorum v2 backup/restore/rollback replay proof including dynamic-fee state.

Current single action: freeze Integration Contract v1.8.0 and 66 unique cross-product vectors against `57a13bacaaf1`, commit and push the evidence checkpoint, and keep every unsupported public or production state false.

Files in the current slice:

- `release/product-release.json`
- `release/integration/chain-core-contract.json`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `FEATURE_COMPLETION_EVIDENCE.md` and `EVIDENCE_INDEX.md`
- `scripts/verify/integration-contract-check.mjs`
- `docs/acceptance/PROJECT_STATE.md` and `docs/acceptance/NEXT_ACTION.md`
- `.ai-bridge/current-plan.md`, `.ai-bridge/agent-status.md`, `.ai-bridge/decisions.md`, `.ai-bridge/execution-log.jsonl` and `.ai-bridge/full-goal-coverage.json`

Validation commands:

- `make integration-contract-check`
- `make bft-evm-fee-suggestion-check`
- `make bft-evm-dynamic-fee-transfer-check`
- `make consensus-eip1559-commit-check`
- `make consensus-quorum-check`
- `go test -race ./internal/bftgateway`
- `go test ./cmd/... ./internal/...`
- `make static-check`
- `make objective-state-check`
- `make no-placeholder-check`
- `make secret-scan`

Completion standard:

- v1.8.0 records, Handoff, `.ai-bridge` and 66 vectors bind to `57a13bacaaf1`;
- committed state remains v11, ABCI application version 17 and snapshot format 1;
- public, central, staging, hosted, signed and store flags remain false;
- Commit and Push complete, Local SHA equals Remote SHA and the worktree is clean.

Next runtime slice:

- implement `eth_feeHistory` only from committed block evidence and only with truthful zero base-fee values;
- otherwise keep the method unsupported rather than fabricate market evidence.

Explicitly not doing:

- no public deployment, production signing, Mainnet claim or public BFT cutover without direct authority and evidence;
- no generalized Ethereum execution, dynamic base-fee market, fabricated reward percentiles or unsupported historical state;
- no changes to other product Worktrees or secrets.
