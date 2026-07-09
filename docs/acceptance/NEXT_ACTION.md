# Next Action

Current single action: implement local cross-node peer handshake / sync semantics for the persisted `ynx_6423-1` validator topology. Remote deployment remains blocked, so the next useful chain-construction work is to make configured validators exchange or record height/status evidence through a runtime API that can later be wired to real remote node-to-node networking.

Why this action:

- Validator metadata, block rotation, local peer-readiness heartbeat, expected bootstrap peer records, observed peer records, `/validators`, `/validators/peers`, `/status` readiness/discovery summaries, snapshot persistence, and public-proof readiness checks now exist.
- The current peer discovery implementation proves local expected/observed topology, but it is still not real cross-node peer sync.
- Remote public deployment is still blocked by SSH/host-key and public endpoint evidence, so local code must continue moving toward deployable multi-validator runtime rather than only tuning blocker reports.
- Persistent peer handshake/sync is the next smallest real chain-runtime gap between local peer discovery records and remote multi-validator network operation.

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

- A validator can submit peer handshake/sync evidence for another configured validator without fabricating remote public proof.
- Sync evidence records source validator, target validator, source height, target height, lag, status, evidence, and timestamps.
- Sync evidence persists across restart and is exposed through RPC/API.
- Local tests prove persistence, restart recovery, API output, and config refresh behavior.
- Feature tracker keeps remote deployed/public proof as `no` until real public endpoints pass.
- Remote deployment is attempted only after deploy-readiness blockers clear.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
