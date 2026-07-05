# Next Action

Current single action: extend IDE/EVM from the current bounded read-only EVM opcode interpreter subset toward fuller bytecode execution semantics, or wire remote verifier/explorer-backed proof if remote safety is cleared first.

Why this action:

- IDE compile/deploy/verify now distinguishes ad hoc `source-analyzer-artifact` output from repository `pinned-solc-bytecode-artifact` output backed by Hardhat artifacts, local deployed bytecode hash comparison, explicit `GET /ide/verifier/{address}` evidence, and `artifacts/ynx-selector-metadata.json` generated from Hardhat ABI through `ethers`.
- Matched Hardhat artifacts now expose real Keccak selectors, selector source, `bytecodeSelectorMatched`, local runtime storage seed, `executionEngine`, and `opcodeStepCount`; local `POST /ide/call` and EVM `eth_call` can execute a bounded read-only EVM opcode subset for supported no-argument getters such as ERC20 `decimals()`.
- The remaining IDE/EVM production gap is runtime/public-proof depth: local devnet still does not support full EVM opcode coverage, constructor args, complex storage layout, arbitrary calldata, state transitions, or remote explorer/verifier proof.
- This is the next honest developer-platform gap that can advance locally while remote SSH/public ingress blockers are handled separately.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/compiler.go`
- `internal/chain/devnet.go`
- `internal/chain/evm_static.go`
- `internal/api/server.go`
- `internal/chain/devnet_test.go`
- `internal/api/server_test.go`
- `scripts/contracts/generate-selector-metadata.mjs`
- `scripts/verify/developer-quickstart-check.sh`
- `scripts/verify/contract-tooling-check.*`
- `artifacts/ynx-selector-metadata.json`
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

- EVM calls advance beyond the current no-argument getter interpreter by supporting a broader bytecode/storage/calldata subset or by using a real remote verifier/explorer response.
- Responses continue to separate `source-analyzer-artifact` from `pinned-solc-bytecode-artifact`.
- Verification records include compiler identity/version, source hash, compiler config hash, bytecode hash, deployed bytecode comparison status, selector source, bytecode selector match status, execution engine, opcode step count where applicable, verifier mode, reproducibility status, service/runtime limitations, and remote proof status.
- Tests/checks prove the new runtime or remote verifier path without claiming broader mainnet or third-party availability.
- Tracker moves IDE/EVM fidelity forward honestly without claiming remote proof unless live public evidence exists.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
