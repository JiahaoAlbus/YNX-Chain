# Next Action

Current single action: add pinned Solidity compiler and verifier integration depth for IDE contracts.

Why this action:

- IDE compile/deploy/verify now exposes deterministic local artifact metadata and simple pure/view runtime calls.
- The remaining IDE gap is production fidelity: a pinned compiler, actual bytecode artifact generation, deployable bytecode/runtime semantics, and verifier status that can be reproduced outside the local source analyzer.
- This is core developer-platform work that can advance locally while remote SSH/public ingress blockers and GitHub push TLS failures are handled separately.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/devnet.go`
- `internal/api/server.go`
- `internal/chain/devnet_test.go`
- `internal/api/server_test.go`
- `scripts/verify/developer-quickstart-check.sh`
- `scripts/verify/contract-tooling-check.*`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`

Validation commands:

- `make test`
- `make smoke-test`
- `make developer-quickstart-check`
- `make contract-tooling-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Compiler configuration is pinned and inspectable.
- Compile output can distinguish deterministic source-analyzer artifacts from pinned compiler artifacts.
- Verification records include compiler identity/version, source hash, bytecode hash, verifier mode, and reproducibility status.
- Tests or checks prove the compiler/verifier path without claiming production remote verifier availability.
- Tracker moves IDE compiler/verifier fidelity forward honestly without claiming remote proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
