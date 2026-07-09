# Next Action

Current single action: implement automated validator peer-sync polling / transport wiring for the persisted `ynx_6423-1` validator topology. Remote deployment remains blocked, so the next useful chain-construction work is to move from manually submitted local source/target sync records toward derived height/status evidence from configured validator RPC peers.

Why this action:

- Validator metadata, block rotation, local peer-readiness heartbeat, expected bootstrap peer records, observed peer records, persisted source/target peer sync records, `/validators`, `/validators/peers`, `/validators/peer-sync`, `/status` readiness/discovery/sync summaries, snapshot persistence, and public-proof readiness checks now exist.
- The current peer sync implementation proves persisted local source/target height evidence, but it is still not automated remote node-to-node sync.
- Remote public deployment is still blocked by SSH/host-key and public endpoint evidence, so local code must continue moving toward deployable multi-validator runtime rather than only tuning blocker reports.
- Automated peer-sync polling is the next smallest real chain-runtime gap between local sync evidence records and remote multi-validator network operation.

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

- A node can derive peer handshake/sync evidence from configured validator RPC peers without fabricating remote public proof.
- Derived sync evidence records source validator, target validator, source height, target height, lag, status, evidence, and timestamps.
- Derived sync evidence persists across restart and is exposed through RPC/API.
- Local tests prove polling behavior, persistence, restart recovery, API output, and config refresh behavior.
- Feature tracker keeps remote deployed/public proof as `no` until real public endpoints pass.
- Remote deployment is attempted only after deploy-readiness blockers clear.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
