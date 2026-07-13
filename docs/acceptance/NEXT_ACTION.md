# Next Action

Current single action: promote sponsored resource pools into deterministic CometBFT state without taking custody of owner or user keys.

Why this action:

- Commit `6571cf34afac` completes the persistent authoritative merchant/dApp pool and sponsored-resource slice locally.
- The largest remaining implementation boundary for this feature is consensus: pool and sponsorship state is not in AppHash and BFT mode truthfully returns `501`.
- Public BFT cutover remains externally gated, but local deterministic consensus code, signed clients, ABCI queries, and four-application equality tests can advance without remote secrets or approvals.

Required behavior:

- Add canonical signed application actions for pool create, fund, policy update, pause/resume/revoke, and sponsorship consumption.
- Require the actual pool owner to sign lifecycle actions and the actual beneficiary to sign sponsored actions; never let `ynx-resourced` or another service signer impersonate them.
- Bind chain ID, action, canonical typed payload, policy hash, next account nonce, idempotency key, and action reference in the signed envelope.
- Commit pools, allowance/consumption, exact replay snapshots, action-reference uniqueness, audit events, and sponsorship records into deterministic AppHash state.
- Preserve resource-only accounting: no YNXT transfer, hidden fee payer, sender replacement, arbitrary third-party signing, auto-debit, or admin seizure.
- Reject stale nonce/policy, wrong owner/beneficiary, invalid signature, expired/paused/revoked pool, disallowed scope/beneficiary/type, per-action/cumulative exhaustion, overflow, changed replay, duplicate action reference, and concurrent/deterministic ordering conflicts.
- Expose ABCI queries and bounded BFT Gateway/Resource Gateway routes for pool, sponsorship, audit, analytics, transaction, and Explorer source evidence.
- Keep authoritative rollback mode compatible and fail closed when BFT sponsor capability is absent.
- Add unit/race/AppHash/four-application/restart/query/Gateway/Explorer tests, a dedicated check target, package wiring, and truthful docs only after code exists.

Files to touch:

- `internal/consensus` action, application, state, query, digest, and migration models
- `internal/bftgateway` and `internal/resourcegateway`
- `internal/explorer` and relevant indexer transaction evidence
- verification/package scripts and acceptance/API docs after implementation

Validation commands:

- focused signed-action, deterministic-state, replay, policy, accounting, query, and four-application equality tests
- a dedicated BFT sponsor/resource-pool Make target
- `go test ./...`
- `make test`
- `make resource-sponsor-check`
- `make bft-resource-action-check`
- `make resource-api-check`
- `make explorer-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Direct owner/beneficiary-signed pool and sponsorship actions produce identical committed state/AppHash across independent applications, survive restart/query, preserve resource and asset invariants, and expose real indexed sponsor evidence.
- BFT mode no longer returns `501` only after all deterministic state, signed relay, query, idempotency, and Explorer tests pass.
- Status remains local/not remotely proven until an exact approved release is deployed and public transaction/Explorer evidence is independently verified.

Explicitly not doing:

- No Gateway-owned key may sign pool-owner or beneficiary actions.
- No public BFT freeze, signer install, ingress switch, or cutover without the existing custody, recovery, independent-review, and transaction approvals.
- No arbitrary account abstraction, sponsored token transfer, hidden balance movement, Stablecoin execution, Bridge external adapter, or mainnet/exchange/wallet-default/partnership claim.
- No expansion of bounded EVM opcodes, Counter/Hardhat artifacts, or IDE execution.
- Do not modify or replace the long-term goal file.
