# Next Action

Current single action: implement deterministic Resource Market BFT state transitions for delegation, rental settlement, provider/protocol income, and analytics while keeping bounded EVM/IDE work paused.

Why this action:

- AI permission/action state is now remotely candidate-verified and safely rolled back.
- Pay state transitions are locally verified and remotely candidate-proven across all four applications; the temporary candidate, Gateway, tunnel, and Pay process were removed and the authoritative rollback gate passed.
- Complete Trust/Chain Law state is remotely candidate-proven, promoted to implemented, safely rolled back, and still not publicly routed.
- Gateway health now reports twelve implemented and three missing capabilities with `publicCutoverReady=false`.
- Resource Market is the highest-priority remaining non-EVM application-state gap and already has authoritative policy, quote, delegation, rental, income, and analytics contracts to preserve.
- Public Resource, RPC, DNS, Caddy, Trust, and website routing must remain untouched.

Required proof and follow-on work:

- Define canonical signed Resource delegation, rental, and income/settlement actions using the shared signer/chain/nonce/fee envelope.
- Persist policy identity, quotes or quote commitments, capacity changes, rental terms, provider income, protocol fees, and append-only Resource audit events in AppHash.
- Preserve YNXT supply, provider/renter ownership, capacity bounds, fee split invariants, idempotency, expiry, and rollback compatibility.
- Add BFT Gateway handlers plus explicit `ynx-resourced` authoritative/BFT modes with process-local signer custody and committed-response verification.
- Add race, restart, authorization, replay, accounting, overflow, policy-mismatch, and four-application equality tests plus a focused Make target.
- Run full local gates, then use a fresh private candidate for four-application/four-signer proof and rollback before capability promotion.

Files to touch:

- `internal/consensus` action types, state, execution, hashing, and queries
- `internal/bftgateway`
- `internal/resourcegateway`, `cmd/ynx-resourced`, `internal/chain`, and `internal/api`
- focused env examples, checks, and API docs after handlers exist
- acceptance files only after verified evidence
- no signer key, PEM, mnemonic, real `.env`, private evidence body, or customer secret in Git/evidence/logs

Validation commands:

- `go test -race ./internal/consensus ./internal/bftgateway ./internal/resourcegateway`
- `make consensus-abci-check`
- `make consensus-signed-transfer-check`
- `make resource-api-check`
- `make bft-gateway-check`
- add and run `make bft-resource-action-check`
- `make consensus-public-cutover-check`
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Signed delegation, rental, and settlement mutations commit deterministically, survive restart, and agree across all ABCI applications while preserving YNXT supply and prior AI/Pay/Trust state.
- Unauthorized provider/renter use, stale or mismatched policy/quote, duplicate settlement, overflow, invalid fee split, wrong chain, malformed payload, nonce collision, and inconsistent Gateway evidence fail closed.
- Resource capacity, provider income, protocol fees, and analytics reconcile exactly with append-only audit records.
- Temporary services/tunnels/candidate state are removed, authoritative public services remain online, and public BFT is not claimed.

Explicitly not doing:

- Do not route public Resource, Trust, RPC, DNS, Caddy, or website traffic to the candidate.
- Do not expand EVM opcode, Counter, Hardhat artifact, or IDE execution coverage in this slice.
- Do not weaken Resource authentication, YNXT accounting, fee policy, native YNXT protections, or existing Trust/Chain Law boundaries.
- Do not claim mainnet, exchange listing, stablecoin issuer support, wallet default support, partnerships, public BFT, or goal completion.
