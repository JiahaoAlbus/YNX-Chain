# Next Action

Current single action: add a deploy-time config check mode for generated `ynx_6423-1` validator env packages. Remote deployment remains blocked, so the next useful chain-construction work is to prove each role-specific env file would pass the same chain binary startup guards before any remote restart or host mutation happens.

Why this action:

- Validator metadata, block rotation, local peer-readiness heartbeat, expected bootstrap peer records, observed peer records, persisted source/target peer sync records, automatic peer-sync polling from configured peer RPC `/status`, `/validators`, `/validators/peers`, `/validators/peer-sync`, `/status` readiness/discovery/sync summaries, `/node/identity` runtime identity/freshness evidence, snapshot persistence, role-specific deploy env files, startup configuration guards, remote verifier hardening, and public-proof readiness checks now exist.
- The current peer sync implementation proves automated local polling, role-aware deploy packaging, strict remote verifier expectations, node identity/freshness evidence, and unsafe startup rejection, but the generated deploy env packages are not yet validated by the same binary guard before remote deployment.
- Remote public deployment is still blocked by SSH/host-key and public endpoint evidence, so local code must continue moving toward deployable multi-validator runtime rather than only tuning blocker reports.
- A binary-level config check mode is the next smallest runtime gap between role-aware deploy packaging and reliable remote multi-validator operation.

Files to touch:

- `internal/chain`
- `cmd/ynx-chaind`
- `scripts/deploy`
- `scripts/verify`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`

Validation commands:

- `go test ./...`
- `make test`
- `make smoke-test`
- `make validator-peer-readiness-check`
- `make deploy-dry-run`
- `make verify-testnet-check`
- `make env-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make preflight`
- `make objective-state-check`

Completion standard:

- `ynx-chaind` exposes a non-server config check mode, or equivalent safe command path, that loads the same environment fields used by remote validator nodes and runs the same startup guards without binding ports, writing state, or starting peer polling.
- `make deploy-dry-run` validates every generated role-specific env package with that config check and fails if primary, Singapore, Silicon Valley, or Seoul env files have missing local identity, incomplete peer target coverage, duplicate targets, self targets, or targets outside `YNX_VALIDATOR_SET`.
- Local unit tests cover valid primary/secondary role configs, invalid unsafe configs, and the safe check mode without mutating remote hosts.
- Remote verification remains gated behind host-key/deploy-readiness blockers and fails honestly while public endpoints still show old-chain evidence.
- Feature tracker keeps remote deployed/public proof as `no` until real public endpoints pass.
- Remote deployment is attempted only after deploy-readiness blockers clear.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
