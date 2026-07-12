# Next Action

Current single action: implement a canonical signed BFT application-action transaction substrate and use it to complete AI permission and sensitive-action state transitions through CometBFT.

Why this action:

- Native transfer, Faucet, migration-height Indexer, and Explorer paths are now remotely candidate-verified and safely rolled back.
- The remaining AI, Pay, Trust/Chain Law, Resource, and IDE capabilities are persistent application mutations that cannot be truthfully implemented as Gateway-only HTTP metadata.
- A domain-separated signed action envelope, deterministic ABCI execution, persistence, and query model is the reusable chain substrate needed for all five service groups.
- AI permission/action approval is the smallest existing service workflow that exercises create, lookup, list, proposal, approval, and audit state without expanding bounded EVM/IDE execution.

Required implementation work:

- Define a canonical, domain-separated secp256k1-signed application-action envelope with version, chain ID, signer, nonce, action type, typed payload/hash, fee/resource accounting, public key, and signature.
- Keep native transfer and application-action decoding unambiguous and size bounded; reject unknown fields/types, noncanonical JSON, replay, wrong chain, bad signature, malformed payload, and unsupported action before proposal inclusion.
- Extend ABCI state and migration hashing to persist the minimum AI permission and action records required by the existing API contracts; never import secrets or hidden provider data.
- Implement deterministic AI permission create/read/list and sensitive action propose/read/list/approve transitions with signer/subject/permission binding and append-only audit timestamps derived from block time.
- Charge explicit YNXT fee or bounded resource usage under the existing economic rules; do not create a free hidden mutation path.
- Add ABCI query paths for AI records and Gateway compatibility handlers matching the existing AI Gateway upstream contract.
- Add explicit BFT mode to `ynx-ai-gatewayd` so its process-local signer creates canonical action transactions; preserve authoritative mode as rollback compatibility.
- Serialize nonce selection and verify committed hash/type/signer/action IDs before returning success.
- Add unit/race/integration tests for canonical signing, replay/wrong-chain/tamper rejection, proposal ordering, persistence/restart, permission binding, approval authorization, concurrent nonce safety, and Gateway response mismatch.
- Only after code and remote proof move `ai-permission-and-action-state-transitions` from missing to implemented; keep `publicCutoverReady=false` for the other five groups.
- Temporarily deploy candidate/Gateway and a loopback AI Gateway through strict SSH forwarding, prove permission/proposal/approval/query/list state on all four applications, then remove all temporary components and rerun rollback gates.

Files to touch:

- `internal/consensus` transaction, application, state, and migration code
- `internal/bftgateway`
- `internal/aigateway`
- `cmd/ynx-ai-gatewayd` only for explicit BFT signer/mode configuration
- focused config examples and verification scripts
- API documentation only after real handlers exist
- Acceptance state files after verified evidence
- No provider key, signer key, PEM content, mnemonic, real `.env`, prompt content, or secret audit material

Validation commands:

- `go test -race ./internal/consensus ./internal/bftgateway ./internal/aigateway`
- `make consensus-abci-check`
- `make consensus-signed-transfer-check`
- `make ai-gateway-check`
- `make bft-gateway-check`
- `make consensus-public-cutover-check`
- `go test ./...`
- `make no-placeholder-check`
- `make secret-scan`
- `make objective-state-check`

Completion standard:

- Canonical signed AI permission/action transactions commit deterministically through four-validator CometBFT and survive application restart.
- Permission, proposal, approval, lookup, list, and audit evidence agree on all four applications and through Gateway/AI Gateway responses.
- Replay, unauthorized approval, wrong permission/subject, wrong chain, malformed payload, concurrent nonce collision, and inconsistent upstream evidence fail closed.
- Signing keys stay process-local and absent from Git, logs, evidence, and remote transport outside their intended service custody.
- Temporary candidate, Gateway, AI Gateway, and tunnels are removed after proof; authoritative public services remain online.
- Cutover gate remains blocked by EVM receipts/logs, Pay, Trust/Chain Law, Resource, and IDE transitions.

Explicitly not doing:

- Do not route Caddy, DNS, or public AI/RPC services to the candidate yet.
- Do not expand bounded EVM opcode, Counter, Hardhat artifact, or IDE execution work in this slice.
- Do not add AI auto-punishment, hidden freezing, unsupported Trust conclusions, prompt logging, or provider-key transport.
- Do not claim public BFT, mainnet, listing, stablecoin issuer support, wallet default support, partnerships, or goal completion.
