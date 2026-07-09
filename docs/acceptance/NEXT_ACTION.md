# Next Action

Current single action: harden role-specific remote validator deployment verification for the persisted `ynx_6423-1` validator topology. Remote deployment remains blocked, so the next useful chain-construction work is to make the deploy/verify path prove that each remote validator runs with the correct local validator identity and exposes peer-readiness/discovery/sync state after deploy-readiness clears.

Why this action:

- Validator metadata, block rotation, local peer-readiness heartbeat, expected bootstrap peer records, observed peer records, persisted source/target peer sync records, automatic peer-sync polling from configured peer RPC `/status`, `/validators`, `/validators/peers`, `/validators/peer-sync`, `/status` readiness/discovery/sync summaries, snapshot persistence, role-specific deploy env files, and public-proof readiness checks now exist.
- The current peer sync implementation proves automated local polling and role-aware deploy packaging, but it is still not remotely deployed or publicly proven.
- Remote public deployment is still blocked by SSH/host-key and public endpoint evidence, so local code must continue moving toward deployable multi-validator runtime rather than only tuning blocker reports.
- Role-specific deployment verification is the next smallest gap between deployable validator sync code and remote multi-validator network operation.

Files to touch:

- `internal/chain`
- `internal/api`
- `cmd/ynx-chaind`
- `scripts/verify`
- `scripts/deploy`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`

Validation commands:

- `go test ./...`
- `make test`
- `make smoke-test`
- `make validator-peer-readiness-check`
- `make env-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make preflight`
- `make objective-state-check`

Completion standard:

- `verify-testnet` or an equivalent remote-safe verifier can prove each remote node's local validator identity, validator count, peer readiness, peer discovery, and peer sync records without fabricating public proof.
- The deployment package keeps role-specific env files for primary, Singapore, Silicon Valley, and Seoul validators.
- Remote verification remains gated behind host-key/deploy-readiness blockers and fails honestly while public endpoints still show old-chain evidence.
- Local tests prove the verifier logic and deployment package behavior without mutating remote hosts.
- Feature tracker keeps remote deployed/public proof as `no` until real public endpoints pass.
- Remote deployment is attempted only after deploy-readiness blockers clear.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
