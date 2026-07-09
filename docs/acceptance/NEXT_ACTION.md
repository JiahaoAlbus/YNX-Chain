# Next Action

Current single action: implement the next real chain construction slice: persistent validator set and peer-readiness state for the `ynx_6423-1` multi-validator testnet. Remote deployment remains blocked, so the next useful work must improve deployable chain runtime code that can be verified locally now and deployed once host-key/public-ingress blockers clear.

Why this action:

- The Anti-Illegal Request Engine, Request Validity Standard, Appeal, and Transparency APIs now have real data models, persistence, API handlers, unit tests, and smoke/check commands.
- This update tightened Appeal / Dispute behavior so `POST /trust/appeals` cannot create orphaned transparency entries; appeals must reference an existing governance request or existing Trust label.
- Remote public proof is still blocked by SSH/host-key and public endpoint evidence, but the updated objective says remote blockers must not consume unlimited implementation time.
- The user explicitly asked to start chain construction quickly.
- Multi-validator chain runtime, validator peer discovery, validator set persistence, and restart recovery are higher-priority chain foundations for a public multi-validator Web4 L1 than further blocker-report tuning.

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
- `make env-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Validator set state survives restart.
- Validator metadata and peer readiness are exposed through RPC/API without fabricating remote proof.
- Local tests prove persistence, restart recovery, and API output.
- Feature tracker keeps remote deployed/public proof as `no` until real public endpoints pass.
- Remote deployment is attempted only after deploy-readiness blockers clear.

Explicitly not doing:

- Do not keep expanding blocker report or gate logic unless required to prevent unsafe remote mutation.
- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
