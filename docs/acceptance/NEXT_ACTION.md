# Next Action

Current single action: expose node-local validator identity and peer-sync freshness through runtime status/identity APIs for the persisted `ynx_6423-1` validator topology. Remote deployment remains blocked, so the next useful chain-construction work is to make each running validator prove its own role and stale/lagging peer-sync state through API evidence, not only through remote env inspection.

Why this action:

- Validator metadata, block rotation, local peer-readiness heartbeat, expected bootstrap peer records, observed peer records, persisted source/target peer sync records, automatic peer-sync polling from configured peer RPC `/status`, `/validators`, `/validators/peers`, `/validators/peer-sync`, `/status` readiness/discovery/sync summaries, snapshot persistence, role-specific deploy env files, remote verifier hardening, and public-proof readiness checks now exist.
- The current peer sync implementation proves automated local polling, role-aware deploy packaging, and strict remote verifier expectations, but it still does not expose a first-class node identity/freshness API and is still not remotely deployed or publicly proven.
- Remote public deployment is still blocked by SSH/host-key and public endpoint evidence, so local code must continue moving toward deployable multi-validator runtime rather than only tuning blocker reports.
- First-class node identity and peer-sync freshness are the next smallest runtime gaps between deployable validator sync code and remote multi-validator public proof.

Files to touch:

- `internal/chain`
- `internal/api`
- `cmd/ynx-chaind`
- `scripts/verify`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`

Validation commands:

- `go test ./...`
- `make test`
- `make smoke-test`
- `make validator-peer-readiness-check`
- `make verify-testnet-check`
- `make env-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make preflight`
- `make objective-state-check`

Completion standard:

- `/status` and/or a dedicated local node identity endpoint exposes the node's configured validator identity, role, expected validator count, peer-sync target count, sync freshness, and stale/lagging peer summary without exposing secrets.
- Local tests prove identity/freshness status for primary and peer nodes, including stale or missing peer-sync records.
- `verify-testnet` can prefer runtime identity/freshness evidence while still keeping safe env inspection as a fallback after deploy-readiness clears.
- Remote verification remains gated behind host-key/deploy-readiness blockers and fails honestly while public endpoints still show old-chain evidence.
- Feature tracker keeps remote deployed/public proof as `no` until real public endpoints pass.
- Remote deployment is attempted only after deploy-readiness blockers clear.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
