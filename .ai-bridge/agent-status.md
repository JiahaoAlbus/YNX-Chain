# Agent Status

- Workspace and branch match Product 01 exactly: `/Users/huangjiahao/Desktop/YNX Final Worktrees/01-chain-core` on `codex/final-chain-core`; CodexPro server modes are bash `full`, write `workspace`, tool `full`.
- Network-interruption Dirty Changes were read and protected. The existing partial EVM error-code propagation was completed rather than overwritten or restarted.
- Runtime commit `7935cedb57ab752b3acc5097303cad672f6f96f1` is pushed to `origin/codex/final-chain-core`; Local and Remote SHA matched immediately after push.
- EVM block-transaction lookup behavior now distinguishes invalid parameters (`-32602`) from CometBFT or committed-evidence failures (`-32603`) and preserves JSON-RPC `null` for pending, missing and out-of-range results.
- Seven machine-readable lookup vectors are frozen in `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json` and source-bound to `7935cedb57ab`.
- `scripts/verify/integration-contract-check.mjs` validates contract v1.4.0, runtime code propagation, rejection-code identity and all required vectors; `scripts/verify/bft-evm-receipt-check.sh` executes the failure-classification test and binds the vector IDs.
- Passed for the vector/evidence slice: machine JSON parse, `make integration-contract-check` with 40 vectors, `make bft-evm-receipt-check`, `go test -race ./internal/bftgateway`, `go test ./cmd/... ./internal/...`, `make static-check`, `make objective-state-check`, `make no-placeholder-check` and `make secret-scan`.
- Release Record, Integration Contract, Handoff, Project State and full-goal coverage remain bound to implementation baseline `7935cedb57ab`; contract version remains `1.4.0` and committed state remains v11 / ABCI v14.
- Current source is not the authoritative public runtime. `integratedCentral`, `deployedStaging`, `deployedPublic`, `downloadHosted`, `productionSigned` and `storeReleased` remain false.
- Current evidence slice is ready for final review, Commit and Push. Next runtime action is standard Ethereum signed transaction envelope compatibility with exact chain, signature, replay, execution and receipt proof; no Ethereum RLP, EIP-155 or EIP-1559 claim exists yet.
