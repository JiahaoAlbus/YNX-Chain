# Next Action

Current single action: implement deterministic label, evidence packet/export, lineage-affecting advisory label, and tracking-review BFT state so the remaining Trust/Chain Law capability can be tested as one complete surface.

Why this action:

- AI permission/action state is now remotely candidate-verified and safely rolled back.
- Pay state transitions are locally verified and remotely candidate-proven across all four applications; the temporary candidate, Gateway, tunnel, and Pay process were removed and the authoritative rollback gate passed.
- Governance request/review/reject, appeal/resolve, correction, and transparency state pass local race/integration checks and temporary remote four-validator proof.
- Nine remote actions converged across all four ABCI applications, four-signer evidence passed, all temporary components were removed, and the post-rollback gate passed.
- Label/evidence/tracking must still be migrated before the full Trust capability can move from missing.
- Existing authoritative governance/appeal/transparency contracts define the required boundary without expanding bounded EVM/IDE work.
- Public Trust, RPC, DNS, Caddy, and website routing must remain untouched.

Required proof and follow-on work:

- Define canonical signed actions and deterministic ABCI persistence for Trust labels, bounded evidence metadata/exports, advisory lineage state, and tracking-review decisions without storing prohibited evidence bodies.
- Preserve appeal linkage, expiration, confidence, purpose, minimum-necessary-data, reviewer, native YNXT no-freeze, and advisory-only asset-effect boundaries.
- Add BFT Gateway handlers and enable the corresponding `ynx-trustd` BFT routes while retaining signer injection, serialized nonce selection, and committed-evidence verification.
- Add restart, AppHash, authorization, replay, size-bound, expiry, correction, lineage, tracking, and race tests plus a focused check target.
- Run complete local gates, then repeat fresh temporary four-application/four-signer remote proof and rollback before considering capability promotion.

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

- Signed label, evidence/export, lineage, and tracking-review mutations commit deterministically, survive restart, and agree across all ABCI applications while preserving the already-proven governance/appeal state.
- Illegal, overbroad, evidence-free, wrong-asset, direct native YNXT freeze, reviewer impersonation, wrong chain, malformed payload, nonce collision, and inconsistent Gateway evidence paths fail closed.
- Transparency, appeal, label, tracking, and evidence metadata remain bounded and auditable without storing prohibited private evidence bodies.
- Temporary services/tunnels/candidate state are removed, authoritative public services remain online, and public BFT is not claimed.

Explicitly not doing:

- Do not route public Trust, RPC, DNS, Caddy, or website traffic to the candidate.
- Do not expand EVM opcode, Counter, Hardhat artifact, or IDE execution coverage in this slice.
- Do not weaken Trust authentication, evidence limits, appeal rights, native YNXT protections, or Chain Law boundaries.
- Do not claim mainnet, exchange listing, stablecoin issuer support, wallet default support, partnerships, public BFT, or goal completion.
