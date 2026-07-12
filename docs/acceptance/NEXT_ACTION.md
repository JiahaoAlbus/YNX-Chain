# Next Action

Current single action: migrate `ynx-faucetd` funding to the proven BFT Gateway native transaction surface without changing the current public Faucet or exposing custody material.

Why this action:

- Native Gateway broadcast, lookup, and paginated history are locally tested and remotely verified against the four-node candidate.
- The current Faucet still depends on the authoritative runtime's privileged `POST /faucet` mutation, so it cannot fund accounts after a CometBFT cutover.
- Faucet is the smallest user-facing state transition unlocked by canonical signed Gateway transactions and is required before Indexer/Explorer can be tested against live BFT-funded activity.
- The candidate is rolled back, authoritative public services remain active, and `/health` correctly reports seven missing cutover capabilities.

Required implementation work:

- Add an explicit BFT upstream mode to `ynx-faucetd`; preserve the existing authoritative mode for rollback compatibility.
- Keep the Faucet private key process-local and environment/file supplied; never send, log, persist, or return it.
- Derive and verify the configured Faucet address from the key at startup.
- Query the Faucet account through `GET /accounts/:address`, compute the exact next nonce, create a canonical chain-`6423` signed YNXT transfer locally, and submit it through `POST /transactions/broadcast`.
- Verify the committed response hash, sender, recipient, amount, fee, nonce, and block height before recording success.
- Serialize or safely retry concurrent requests so two recipients cannot reuse the same nonce; fail closed on stale nonce, insufficient YNXT, malformed Gateway data, or custody mismatch.
- Preserve existing address/IP rate limits, request log redaction, metrics, body bounds, and health/build identity.
- Add fake-Gateway unit tests for success, concurrent nonce safety, wrong sender/hash/amount/nonce, upstream rejection, and restart-safe request logging.
- Update the focused Faucet smoke/check path, but do not mark `faucet-state-transition` implemented until the end-to-end candidate proof passes.
- Temporarily deploy candidate, Gateway, and BFT-mode Faucet on loopback-only ports; prove a real Faucet request commits and appears in Gateway lookup/history, then remove all temporary services and rerun rollback gates.

Files to touch:

- `internal/faucet`
- `cmd/ynx-faucetd` only for explicit mode/custody configuration
- `.env.faucet.example`, systemd/Docker examples only if the contract changes
- `scripts/verify/faucet-check.sh` and focused fixtures
- `internal/bftgateway` capability metadata only after real code, tests, and candidate proof
- Acceptance state files after verified evidence
- No private key, PEM content, mnemonic, real `.env`, or signed transaction fixture containing reusable secret material

Validation commands:

- `go test ./internal/faucet ./cmd/ynx-faucetd`
- `make faucet-check`
- `make bft-gateway-check`
- `make consensus-public-cutover-check`
- `go test ./...`
- `make no-placeholder-check`
- `make secret-scan`
- `make objective-state-check`

Completion standard:

- A real candidate Faucet request is signed locally and commits through the Gateway with exact recipient/amount/nonce/hash evidence.
- Concurrent requests cannot reuse a nonce, and all malformed/inconsistent upstream responses fail closed.
- The private key remains local and absent from logs, evidence, Git, and remote transport outside its intended Faucet process custody.
- Candidate, temporary Gateway, and temporary Faucet are removed after proof; authoritative public services remain online.
- Cutover gate remains blocked by the still-unimplemented EVM, AI, Pay, Trust/Chain Law, Resource, and IDE capabilities.

Explicitly not doing:

- Do not route Caddy, DNS, public Faucet, Indexer, Explorer, or public RPC to the candidate yet.
- Do not remove the authoritative Faucet rollback path before public cutover approval.
- Do not mark `publicCutoverReady=true` or claim public BFT, mainnet, listing, stablecoin issuer support, wallet default support, partnerships, or goal completion.
