# Next Action

Current single action: implement persistent EVM logs/events model for transaction receipts and `eth_getLogs`.

Why this action:

- AI Gateway now has scoped permissions, sensitive action proposals, approval gating, audit hashes, and smoke coverage.
- EVM RPC currently returns receipts, but logs are still an empty local subset and the tracker marks `Logs / events` as incomplete.
- Event persistence is core chain/RPC behavior and can be advanced locally while remote SSH/public ingress blockers prevent safe deployment.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/devnet.go`
- `internal/api/server.go`
- `internal/chain/devnet_test.go`
- `internal/api/server_test.go`
- `scripts/verify/testnet-smoke-test.sh`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`

Validation commands:

- `make test`
- `make ai-gateway-check`
- `make smoke-test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Transactions can persist deterministic EVM-style log records with address, topics, data, block, transaction hash, and log index.
- `eth_getTransactionReceipt` returns persisted logs for known transactions.
- `eth_getLogs` filters persisted logs by block range, address, and topics.
- New checks pass locally.
- Tracker moves Logs / events forward honestly without claiming remote proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
