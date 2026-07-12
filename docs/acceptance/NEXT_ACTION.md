# Next Action

Current single action: safely commit the locally verified Trust/Chain Law governance and appeal BFT slice, prove it across the temporary four-validator candidate, roll it back, then continue with label/evidence/tracking BFT state.

Why this action:

- AI permission/action state is now remotely candidate-verified and safely rolled back.
- Pay state transitions are locally verified and remotely candidate-proven across all four applications; the temporary candidate, Gateway, tunnel, and Pay process were removed and the authoritative rollback gate passed.
- Governance request/review/reject, appeal/resolve, correction, and transparency state now pass local race/integration checks.
- Remote four-application convergence and rollback remain required, and label/evidence/tracking must still be migrated before the full Trust capability can move from missing.
- Existing authoritative governance/appeal/transparency contracts define the required boundary without expanding bounded EVM/IDE work.
- Public Trust, RPC, DNS, Caddy, and website routing must remain untouched.

Required proof and follow-on work:

- Commit and push the local governance/appeal implementation after full local gates.
- Run a fresh temporary candidate plus loopback Gateway and local signer-held `ynx-trustd` through strict SSH forwarding.
- Prove native YNXT rejection, review, manual rejection, appeal, correction, transparency, account fee/resource usage, four-application equality, and four-signer consensus.
- Remove all temporary processes/tunnels/candidate state and rerun rollback/public-service gates.
- Keep `trust-and-chain-law-state-transitions` missing after that proof because labels, evidence packets/exports, trace-affecting advisory label state, and tracking reviews remain authoritative-only.
- Implement those remaining Trust actions and queries, repeat local and remote proof, and only then consider capability promotion.

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
- Illegal, overbroad, evidence-free, wrong-asset, direct native YNXT freeze, reviewer impersonation, wrong chain, malformed payload, nonce collision, and inconsistent Gateway evidence paths fail closed.
- Transparency and appeal state remains bounded and auditable without storing prohibited private evidence bodies.
- Temporary services/tunnels/candidate state are removed, authoritative public services remain online, and public BFT is not claimed.

Explicitly not doing:

- Do not route public Trust, RPC, DNS, Caddy, or website traffic to the candidate.
- Do not expand EVM opcode, Counter, Hardhat artifact, or IDE execution coverage in this slice.
- Do not weaken Trust authentication, evidence limits, appeal rights, native YNXT protections, or Chain Law boundaries.
- Do not claim mainnet, exchange listing, stablecoin issuer support, wallet default support, partnerships, public BFT, or goal completion.
