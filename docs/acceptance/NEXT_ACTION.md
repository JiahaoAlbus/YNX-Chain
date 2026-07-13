# Next Action

Current single action: implement persistent sponsored transactions plus merchant and dApp resource pools.

Why this action:

- Public BFT remains externally gated by recovery, handover, rotation, independent custody review, and transaction approval.
- Provider-backed AI proof remains externally blocked by quota.
- Bridge and Stablecoin control planes now have real local code and default-disabled deployment packages; neither may be promoted without external evidence.
- Resource delegation/rental exists, but the goal still requires sponsor transaction readiness, merchant resource pools, dApp resource pools, and Explorer payer/sponsor/resource-source evidence. The current Explorer sponsor field is always empty.

Required behavior:

- Add persistent merchant and dApp pool records owned by canonical accounts.
- Require explicit owner authorization for create, fund/delegate, policy update, pause/resume, and revoke actions.
- Bind each pool to type, owner, allowed beneficiaries or public policy, allowed operation scopes, resource types, per-action limit, cumulative allowance, expiry, and policy hash.
- Sponsor only declared resource consumption or fee offset; never transfer a user's assets, change transaction sender/nonce/signature ownership, or create hidden balance movement.
- Select a pool deterministically, reserve/consume allowance atomically, record payer, sponsor, pool, resource type/source, amount, policy, transaction/action reference, and exact idempotency.
- Reject wrong owner, expired/paused/revoked pools, disallowed scope/beneficiary/resource, over-limit or exhausted allowance, changed idempotency reuse, overflow, and concurrent double spend without state corruption.
- Persist pool, sponsorship, idempotency, and append-only audit state across restart.
- Expose bounded authenticated API handlers plus read-only pool/sponsorship/analytics lookup.
- Populate Explorer fee detail from real sponsorship records; unsponsored transactions must remain explicitly direct payer/resource source.
- Add unit/race/restart/tamper/HTTP tests, smoke/check command, Makefile target, mutation-freeze/deploy package wiring, and truthful docs only after code exists.

Files to touch:

- `internal/chain` and `internal/consensus` resource/accounting models
- `internal/api` and `internal/resourcegateway`
- `internal/explorer`
- relevant daemon/deployment/verification scripts
- API/resource/acceptance docs after implementation

Validation commands:

- focused race tests for pool lifecycle, sponsorship accounting, concurrency, idempotency, restart, revocation, and tamper rejection
- a dedicated sponsor/resource-pool Make target
- `go test ./...`
- `make test`
- `make resource-market-check`
- `make explorer-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Merchant/dApp resource pools and sponsored resource consumption have real persistent code, strict authorization/accounting, API handlers, Explorer evidence, tests, smoke target, and deployment wiring.
- Sponsored actions charge only the approved pool allowance/resource source, preserve user ownership/signature/nonce semantics, and survive restart without replay or double-spend.
- Status remains local/not remotely proven until an exact release is safely deployed and public sponsor evidence is verified.

Explicitly not doing:

- No arbitrary third-party transaction signing, account abstraction claim, hidden fee payer, token transfer, auto-debit, or admin seizure.
- No Stablecoin mint/burn execution, issuer-support claim, Bridge external adapter, or remote deployment of either default-disabled service.
- No public BFT freeze, signer install, ingress switch, or cutover without the existing external approvals.
- No expansion of bounded EVM opcodes, Counter/Hardhat artifacts, or IDE execution.
- Do not modify or replace the long-term goal file.
