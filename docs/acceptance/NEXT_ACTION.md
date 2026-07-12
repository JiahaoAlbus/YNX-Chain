# Next Action

Current single action: prove the locally implemented signed BFT Pay path against the temporary four-validator candidate, compare all four applications, and roll it back without changing public routing.

Why this action:

- AI permission/action state is now remotely candidate-verified and safely rolled back.
- Pay intent/invoice/refund/webhook actions, ABCI persistence, Gateway handlers, and `ynx-payd` BFT mode now pass local race/integration checks.
- Remote four-application convergence, four-signer evidence, cleanup, and authoritative rollback are the remaining acceptance boundary before Pay can move from missing to implemented.
- Public Pay, RPC, DNS, Caddy, and website routing must remain untouched.

Required proof work:

- Commit and push the locally verified Pay implementation before deploying candidate binaries.
- Start the existing candidate package and loopback BFT Gateway through the strict deployment boundary.
- Keep the owner signer key and webhook signing key process-local; connect local `ynx-payd` only through strict SSH forwarding.
- Commit one intent, identical replay, changed-input conflict, invoice, bounded refund, and webhook metadata record; query objects, idempotency, events, account nonce/resource usage, and transaction evidence.
- Compare the same final Pay/account state across all four ABCI applications and collect four-signer evidence.
- Only after remote four-application proof move `pay-state-transitions` from missing to implemented; keep cutover false for EVM receipts/logs, Trust/Chain Law, Resource, and IDE.
- Remove local Pay/tunnel and remote Gateway/candidate state, rerun rollback/read-only/public-service gates, then update acceptance records.

Files to touch:

- `internal/consensus` action types, state, execution, hashing, and queries
- `internal/bftgateway`
- `internal/paygateway` and `cmd/ynx-payd`
- focused env examples, checks, and API docs after handlers exist
- acceptance files only after verified evidence
- no merchant key, webhook key, signer key, PEM, mnemonic, real `.env`, raw webhook body, or customer secret in Git/evidence/logs

Validation commands:

- `go test -race ./internal/consensus ./internal/bftgateway ./internal/paygateway`
- `make consensus-abci-check`
- `make consensus-signed-transfer-check`
- `make pay-api-check`
- `make bft-gateway-check`
- add and run `make bft-pay-action-check`
- `make consensus-public-cutover-check`
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Signed Pay mutations commit deterministically through four-validator CometBFT, survive restart, and agree across all four ABCI applications.
- Idempotency replay, changed-input key reuse, unauthorized merchant/refund, wrong chain, malformed payload, nonce collision, and inconsistent Gateway evidence fail closed.
- Webhook signing remains process-local; chain state contains only bounded replay-safe signature metadata and hashes.
- Temporary services/tunnels/candidate state are removed, authoritative public services remain online, and public BFT is not claimed.

Explicitly not doing:

- Do not route public Pay, RPC, DNS, Caddy, or website traffic to the candidate.
- Do not expand EVM opcode, Counter, Hardhat artifact, or IDE execution coverage in this slice.
- Do not weaken merchant authentication, idempotency, webhook secrecy, native YNXT protections, or Chain Law boundaries.
- Do not claim mainnet, exchange listing, stablecoin issuer support, wallet default support, partnerships, public BFT, or goal completion.
