# Next Action

Current single action: extend canonical signed BFT application actions to Pay intents, invoices, refunds, webhook metadata, and payment events with merchant binding and idempotency.

Why this action:

- AI permission/action state is now remotely candidate-verified and safely rolled back.
- Pay is the next value-sensitive service still backed only by authoritative HTTP persistence.
- Its existing intent, invoice, refund, webhook, event, merchant, idempotency, and audit contracts provide a concrete state-transition boundary for the reusable signed action substrate.
- Moving Pay on-chain closes one of the five remaining cutover capabilities without expanding bounded EVM/IDE work.

Required implementation work:

- Add canonical typed actions for Pay intent create, invoice create, refund create, and webhook-signature metadata record; reject unknown fields, unsupported currencies, unsafe amounts, malformed hashes, wrong merchant binding, replay, and wrong chain before proposal inclusion.
- Persist deterministic Pay records, idempotency keys, append-only Pay events, and block-time audit metadata in ABCI state and AppHash; never persist webhook signing keys or raw webhook bodies.
- Bind every mutation to the BFT signer plus configured merchant identity and enforce object ownership and amount/currency/refund limits.
- Preserve required idempotency semantics: identical replay returns the committed object; key reuse with changed input fails closed without nonce or fee consumption.
- Charge explicit YNXT/resource usage through the shared account nonce and fee path.
- Add ABCI queries and BFT Gateway handlers matching current Pay API lookup/list/event contracts, with committed transaction and record evidence verification.
- Add explicit BFT mode to `ynx-payd`; keep authoritative mode as rollback compatibility. The process-local signer and webhook key must remain separate custody inputs.
- Serialize nonce selection and verify committed hash/action/signer/merchant/object/idempotency/event evidence before returning success.
- Add race/unit/integration tests for restart persistence, concurrent idempotency, replay, amount overflow, unauthorized refund, webhook metadata redaction, nonce safety, and upstream mismatch.
- Only after remote four-application proof move `pay-state-transitions` from missing to implemented; keep cutover false for EVM receipts/logs, Trust/Chain Law, Resource, and IDE.
- Deploy only temporary candidate/Gateway/Pay components through strict SSH forwarding, prove intent/invoice/refund/webhook/event/query/list behavior, then remove them and rerun rollback/public-service gates.

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
