# Next Action

Current single action: wire actual pinned Solidity compiler artifact generation and bytecode verifier comparison for IDE contracts.

Why this action:

- IDE compile/deploy/verify now exposes pinned Solidity `0.8.24` compiler configuration, config hash, deterministic source-analyzer artifact metadata, simple pure/view runtime calls, and verifier reproducibility status.
- The remaining IDE gap is production fidelity: executing the pinned compiler, storing actual bytecode artifacts, and comparing deployed bytecode through a verifier path instead of only matching source hash plus config hash.
- This is the next honest developer-platform gap that can advance locally while remote SSH/public ingress blockers and GitHub push TLS failures are handled separately.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/compiler.go`
- `internal/chain/devnet.go`
- `internal/api/server.go`
- `internal/chain/devnet_test.go`
- `internal/api/server_test.go`
- `scripts/verify/developer-quickstart-check.sh`
- `scripts/verify/contract-tooling-check.*`
- `docs/developers/CONTRACT_VERIFICATION.md`
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

- A local build path executes the pinned Solidity compiler or fails closed with a clear missing-tool status.
- Compile output separates `source-analyzer-artifact` from real pinned compiler bytecode artifacts.
- Verification records include compiler identity/version, source hash, compiler config hash, bytecode hash, deployed bytecode comparison status, verifier mode, and reproducibility status.
- Tests/checks prove the bytecode artifact and verifier comparison path without claiming remote public verifier availability.
- Tracker moves IDE compiler/verifier fidelity forward honestly without claiming remote proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
