# Next Action

Current single action: refresh deploy-readiness source evidence and prepare the next safe deploy gate pass without mutating remote hosts. The release manifest handoff into `public-proof` is now implemented locally; the remaining proof gap is real remote evidence.

Why this action:

- Deploy bundles include `config/release-manifest.json` and `verify-testnet` can emit `release-manifest-evidence.json`.
- `remote-smoke-test` and `public-proof-evidence-check` now require release manifest evidence before `validPublicProof=true`.
- `make public-proof` currently fails correctly because public endpoints still prove old-chain/broken state and no fresh remote release manifest evidence exists.
- The next useful work is to refresh blockers and only proceed toward deploy when strict host-key and source-evidence gates are clean.

Files to touch:

- `scripts/verify/host-key-audit.sh`
- `scripts/ops/host-key-approval-status.mjs`
- `scripts/verify/deploy-readiness-gate.mjs`
- `scripts/verify/remote-blocker-report.mjs`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`

Validation commands:

- `go test ./...`
- `make test`
- `make smoke-test`
- `make validator-peer-readiness-check`
- `make deploy-dry-run`
- `make release-manifest-check`
- `make verify-testnet-check`
- `make public-proof-evidence-check`
- `make env-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Host-key/source-evidence reports are fresh.
- Deploy-readiness gate still fails closed if approval or endpoint proof is unsafe.
- Any locally solvable stale-evidence or classification issue is fixed in code.
- Remote deployed/public proof remains `no` until real public endpoints and strict SSH checks pass.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, missing release identity, missing manifest checksum, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
