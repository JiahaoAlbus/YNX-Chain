# Next Action

Current single action: extend canonical signed BFT application actions to Trust and Chain Law governance requests, review/rejection, appeals, and transparency records.

Why this action:

- AI permission/action state is now remotely candidate-verified and safely rolled back.
- Pay state transitions are locally verified and remotely candidate-proven across all four applications; the temporary candidate, Gateway, tunnel, and Pay process were removed and the authoritative rollback gate passed.
- Trust and Chain Law is the next policy-sensitive public service still outside the BFT application state.
- Existing authoritative governance/appeal/transparency contracts define the required boundary without expanding bounded EVM/IDE work.
- Public Pay, RPC, DNS, Caddy, and website routing must remain untouched.

Required implementation work:

- Add canonical typed actions for governance request creation, review, rejection, Trust appeal creation/resolution, and transparency recording.
- Preserve Anti-Illegal Request classification, evidence requirements, overbroad detection, asset boundaries, and the rule that native YNXT cannot be directly frozen.
- Persist deterministic request, review, appeal, correction, and append-only transparency state in ABCI/AppHash using consensus block time.
- Bind mutations to signer/requester/reviewer roles and reject unauthorized or inconsistent transitions before proposal inclusion.
- Add ABCI queries, BFT Gateway handlers, and explicit rollback-compatible BFT mode for `ynx-trustd` with process-local signer custody and committed evidence verification.
- Add race/unit/integration tests for restart persistence, replay, invalid transitions, native YNXT protection, false-positive correction, nonce safety, and upstream mismatch.
- Only after remote four-application proof move `trust-and-chain-law-state-transitions` from missing to implemented; keep cutover false for EVM receipts/logs, Resource, and IDE.

Files to touch:

- `internal/consensus` action types, state, execution, hashing, and queries
- `internal/bftgateway`
- `internal/trustgateway`, `cmd/ynx-trustd`, `internal/chain`, and `internal/api`
- focused env examples, checks, and API docs after handlers exist
- acceptance files only after verified evidence
- no signer key, PEM, mnemonic, real `.env`, private evidence body, or customer secret in Git/evidence/logs

Validation commands:

- `go test -race ./internal/consensus ./internal/bftgateway ./internal/trustgateway`
- `make consensus-abci-check`
- `make consensus-signed-transfer-check`
- `make trust-api-check`
- `make bft-gateway-check`
- add and run `make bft-trust-action-check`
- `make consensus-public-cutover-check`
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Signed governance, rejection, appeal, correction, and transparency mutations commit deterministically through four-validator CometBFT, survive restart, and agree across all four ABCI applications.
- Illegal, overbroad, evidence-free, wrong-asset, direct native YNXT freeze, unauthorized review, wrong chain, malformed payload, nonce collision, and inconsistent Gateway evidence paths fail closed.
- Transparency and appeal state remains bounded and auditable without storing prohibited private evidence bodies.
- Temporary services/tunnels/candidate state are removed, authoritative public services remain online, and public BFT is not claimed.

Explicitly not doing:

- Do not route public Trust, RPC, DNS, Caddy, or website traffic to the candidate.
- Do not expand EVM opcode, Counter, Hardhat artifact, or IDE execution coverage in this slice.
- Do not weaken Trust authentication, evidence limits, appeal rights, native YNXT protections, or Chain Law boundaries.
- Do not claim mainnet, exchange listing, stablecoin issuer support, wallet default support, partnerships, public BFT, or goal completion.
