# Next Action

Current implementation baseline: `fdb005c936fc`.

Completed local Testnet slice:

- bounded EIP-155, EIP-2930 and zero-base-fee EIP-1559 value-transfer profiles;
- truthful minimum fee suggestions through `eth_gasPrice` and `eth_maxPriorityFeePerGas`;
- committed `eth_feeHistory` from retained CometBFT blocks, `block_results` gas and positive exact-height consensus `max_gas`;
- zero base-fee arrays and evidence-derived `gasUsedRatio`, with no reward-percentile estimates or dynamic fee-market claim;
- secure multi-envelope signer tooling, committed-broadcast evidence binding and local four-validator EIP-1559 commit/rollback proof;
- Release Record and Integration Contract v1.9.0 plus 70 unique vectors bound to `fdb005c936fc`, with every unsupported public or production state false.

Current single action:

1. Configure a disposable local four-validator CometBFT network with a positive consensus `max_gas`.
2. Commit one bounded type-0x02 transfer through the Gateway.
3. Query `eth_feeHistory` for the committed range and bind `oldestBlock`, zero `baseFeePerGas`, `gasUsedRatio` and next-block base fee to exact block, `block_results` and `consensus_params` evidence.
4. Exercise non-positive `max_gas`, tampered gas usage, mismatched consensus-parameter height, pending/pruned history and non-empty reward-percentile rejection.
5. Preserve `-32004` for truthful history unavailability, `-32603` for inconsistent committed evidence and all false central/public/production release flags.

Files in the current slice:

- `internal/consensus/network.go` and the local genesis fixture path for positive consensus `max_gas`;
- `scripts/verify/consensus-fee-history-commit-check.sh` as a new reproducible local evidence gate;
- targeted consensus/Gateway tests and machine evidence for committed fee-history binding;
- Integration Contract, vectors and `.ai-bridge` only after the runtime proof is committed.

Validation commands:

- `make bft-evm-fee-history-check`
- the new local four-validator fee-history evidence gate
- `make consensus-quorum-check`
- `go test -race ./internal/consensus ./internal/bftgateway ./internal/mutationfreeze`
- `go test ./cmd/... ./internal/...`
- `make integration-contract-check`
- `make static-check`
- `make objective-state-check`
- `make no-placeholder-check`
- `make secret-scan`

Completion standard:

- exact committed fee-history evidence is reproducible from a disposable four-validator network with positive `max_gas`;
- negative evidence paths fail closed without fabricated history;
- Commit and Push complete, Local SHA equals Remote SHA and the worktree is clean.

Explicitly not doing:

- no public deployment, production signing, Mainnet claim or public BFT cutover without direct authority and evidence;
- no generalized Ethereum execution, dynamic base-fee market, fabricated reward percentiles or unsupported historical state;
- no changes to other product Worktrees or secrets.
