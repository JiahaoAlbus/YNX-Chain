# Next Action

Current single action: add real compiler/runtime integration depth for IDE contract compile, deploy, call, and verification.

Why this action:

- Contract records now expose deterministic event metadata, and local contract deployment receipts emit contract-address logs filterable by topic.
- The remaining IDE/EVM gap is that compile/deploy/verify still use source preflight metadata rather than a pinned compiler, bytecode artifact, callable runtime, or production verifier.
- This is core developer-platform work that can advance locally while remote SSH/public ingress blockers prevent safe deployment.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/devnet.go`
- `internal/api/server.go`
- `internal/chain/devnet_test.go`
- `internal/api/server_test.go`
- `scripts/verify/testnet-smoke-test.sh`
- `scripts/verify/developer-quickstart-check.sh`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`

Validation commands:

- `make test`
- `make smoke-test`
- `make developer-quickstart-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Compile output exposes a deterministic artifact with source hash, bytecode hash, ABI/events, compiler mode, and truthful limitations.
- Deploy records link to that artifact and preserve enough runtime metadata for a local `eth_call` or IDE call endpoint to return deterministic results for simple pure functions.
- Verification checks artifact/source consistency and exposes verifier status without pretending a production verifier exists.
- Smoke or quickstart checks prove compile, deploy, verify, contract lookup, and simple call behavior.
- Tracker moves IDE compiler/runtime fidelity forward honestly without claiming remote proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
