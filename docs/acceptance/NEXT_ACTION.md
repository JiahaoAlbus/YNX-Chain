# Next Action

Current single action: implement persistent validator peer discovery / bootstrap identity readiness for the `ynx_6423-1` multi-validator testnet. Remote deployment remains blocked, so the next useful chain-construction work is to make the local node persist expected peers, observed peers, and bootstrap metadata that can be deployed unchanged once host-key/public-ingress blockers clear.

Why this action:

- Validator metadata, block rotation, local peer-readiness heartbeat, `/validators`, `/status` readiness summary, snapshot persistence, and public-proof readiness checks now exist.
- The current validator peer-readiness implementation proves local state and API behavior, but it is not real remote peer networking and is not public proof.
- Remote public deployment is still blocked by SSH/host-key and public endpoint evidence, so local code must continue moving toward deployable multi-validator runtime rather than only tuning blocker reports.
- The user explicitly asked to start chain construction quickly.
- Persistent peer discovery/bootstrap state is the next smallest real chain-runtime gap between local validator readiness and remote multi-validator network operation.

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

- Expected validator peers can be configured, persisted, and restored.
- Observed peer state can be recorded through API/chain runtime without claiming remote proof.
- `/validators` or a dedicated endpoint exposes enough peer discovery state for operators and future public proof.
- Local tests prove persistence, restart recovery, API output, and config refresh behavior.
- Feature tracker keeps remote deployed/public proof as `no` until real public endpoints pass.
- Remote deployment is attempted only after deploy-readiness blockers clear.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
