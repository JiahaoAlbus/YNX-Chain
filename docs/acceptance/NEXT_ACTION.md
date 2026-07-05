# Next Action

Current single action: expand contract event fidelity beyond deterministic transaction logs.

Why this action:

- EVM receipts now include persisted transaction logs, and `eth_getLogs` filters by block range, address, and topics.
- The remaining logs/events gap is contract-level fidelity: deployed contract records do not yet expose ABI-like event metadata or contract-specific emitted events.
- This is core EVM compatibility work that can advance locally while remote SSH/public ingress blockers prevent safe deployment.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/devnet.go`
- `internal/api/server.go`
- `internal/chain/devnet_test.go`
- `internal/api/server_test.go`
- `scripts/verify/testnet-smoke-test.sh`
- `scripts/verify/exchange-integration-check.sh`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`

Validation commands:

- `make test`
- `make smoke-test`
- `make exchange-integration-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Contract deploy/verify records expose deterministic event metadata for developer tooling.
- Contract-related transactions emit contract-specific logs rather than only generic transaction logs.
- EVM receipt and `eth_getLogs` checks prove contract-address and topic filtering.
- New checks pass locally.
- Tracker moves contract event fidelity forward honestly without claiming remote proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
