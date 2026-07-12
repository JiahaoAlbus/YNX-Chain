# Next Action

Current single action: commit the locally complete Trust/Chain Law BFT surface, prove label/evidence/tracking plus linked appeals across a fresh temporary four-validator candidate, then remove every temporary component and verify authoritative public services.

Why this action:

- AI permission/action state is now remotely candidate-verified and safely rolled back.
- Pay state transitions are locally verified and remotely candidate-proven across all four applications; the temporary candidate, Gateway, tunnel, and Pay process were removed and the authoritative rollback gate passed.
- Governance request/review/reject, appeal/resolve, correction, and transparency state pass local race/integration checks and temporary remote four-validator proof.
- Nine remote actions converged across all four ABCI applications, four-signer evidence passed, all temporary components were removed, and the post-rollback gate passed.
- Label/evidence/tracking are now implemented locally with deterministic persistence, AppHash, signed Gateway routes, and focused tests, but have not yet received remote candidate proof.
- Existing authoritative governance/appeal/transparency contracts define the required boundary without expanding bounded EVM/IDE work.
- Public Trust, RPC, DNS, Caddy, and website routing must remain untouched.

Required proof and follow-on work:

- Commit and push the locally verified complete Trust implementation after all local gates pass.
- Generate a fresh authoritative migration and deploy the candidate only on private loopback/overlay paths.
- Prove advisory label creation, label-linked appeal/correction, evidence JSON/PDF, purpose-limited tracking, rejected overbroad tracking, transparency, fee/resource accounting, signer injection, and unknown-subject fail-closed behavior.
- Compare labels, evidence, tracking, appeals, corrections, transparency, and signer account state across all four ABCI applications and obtain four-signer evidence.
- Remove the local Trust process, SSH tunnel, runtime key environment, remote Gateway, and candidate; rerun the four-host rollback gate and public RPC/Explorer health checks.
- Promote `trust-and-chain-law-state-transitions` only if the complete remote proof passes; otherwise keep it missing and record the exact failure.

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
