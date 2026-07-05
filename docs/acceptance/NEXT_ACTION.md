# Next Action

Current single action: add a deployable contract verifier service endpoint or real EVM bytecode execution semantics for IDE contracts.

Why this action:

- IDE compile/deploy/verify now distinguishes ad hoc `source-analyzer-artifact` output from repository `pinned-solc-bytecode-artifact` output backed by Hardhat artifacts and deployed bytecode hash comparison.
- The remaining IDE/EVM production gap is runtime/verifier depth: local devnet still stores bytecode hashes and executes only simple parsed pure/view literals instead of EVM bytecode, and verifier evidence is not yet exposed as a deployable verifier service or remote explorer proof.
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

- Verifier evidence can be queried through an explicit local service/API endpoint, or EVM calls can use real compiled bytecode semantics for at least a narrow supported subset.
- Responses continue to separate `source-analyzer-artifact` from `pinned-solc-bytecode-artifact`.
- Verification records include compiler identity/version, source hash, compiler config hash, bytecode hash, deployed bytecode comparison status, verifier mode, reproducibility status, and service/runtime limitations.
- Tests/checks prove the new verifier service or bytecode execution path without claiming remote public verifier availability.
- Tracker moves IDE/EVM fidelity forward honestly without claiming remote proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
