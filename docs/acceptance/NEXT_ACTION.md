# Next Action

Current single action: implement Resource Market production pricing and governance configuration while remote deployment remains blocked by untrusted host-key fingerprints. Do not mutate remote hosts or repair known_hosts until Singapore and Silicon Valley fingerprints are independently confirmed.

Why this action:

- `FEATURE_COMPLETION_TRACKER.md` now has Native YNXT no-hidden-freeze static and behavioral coverage locally verified.
- `Resource Market` remains local-only and its next implementation gap is production pricing/governance config.
- Resource pricing config is a real chain capability that can be completed locally and later verified remotely without needing SSH host-key approval first.
- Host-key approval is still required before real remote mutation; it remains a blocker, not the current locally actionable engineering slice.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/devnet.go`
- `internal/chain/devnet_test.go`
- `internal/api/server.go`
- `internal/api/server_test.go`
- `scripts/verify/testnet-smoke-test.sh`
- `scripts/verify/remote-smoke-test.mjs`
- `scripts/verify/resource-market-check.sh` if a dedicated check is added
- `Makefile`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`

Validation commands:

- `go test ./...`
- `make test`
- `make native-ynxt-no-hidden-freeze-check`
- `make anti-illegal-request-check`
- `make request-validity-check`
- `make transparency-report-check`
- `make trust-appeal-check`
- `make smoke-test`
- `make resource-market-check` if added
- `make env-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Resource Market exposes inspectable pricing/governance policy, not only hardcoded arithmetic.
- Quote, delegation, rental, income, and analytics use the configured policy and report policy identity/version.
- Invalid fee/share/price settings fail fast in tests or config validation.
- Local tests and smoke/check commands pass.
- Remote deployed/public proof remains `no` until real public endpoints and strict SSH checks pass.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, missing release identity, missing manifest checksum, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
- Do not treat `ssh-keyscan` fingerprints as trusted approval.
