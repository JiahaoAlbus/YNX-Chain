# Next Action

Current single action: complete the native transaction surface of `ynx-bft-gatewayd` using real CometBFT RPC: signed transaction broadcast, transaction lookup, and paginated transaction history, with canonical YNX response mapping and fail-closed tests.

Why this action:

- The Gateway already maps real CometBFT status, blocks, accounts, four validators, node identity, `eth_chainId`, and `eth_blockNumber`.
- Remote candidate verification passed, but `/health` correctly reports nine missing public-cutover capabilities.
- Native HTTP broadcast and transaction history are the smallest core-chain gap that unlocks Faucet/Indexer/Explorer integration without pretending ecosystem state is already migrated.
- Public cutover remains blocked and the candidate is currently rolled back.

Required implementation work:

- Add an authenticated-size-bounded `POST /transactions/broadcast` accepting only canonical signed YNXT envelopes; submit through CometBFT `broadcast_tx_commit` and return committed height/hash/code.
- Add `GET /txs/:hash` using CometBFT `tx` proof data and canonical signed envelope decoding.
- Add bounded, paginated `GET /txs` using CometBFT `tx_search`, with deterministic newest-first ordering and no fabricated entries.
- Preserve lowercase `0x` YNX transaction hashes while verifying the CometBFT hash refers to the exact submitted bytes.
- Map failed CheckTx/DeliverTx results honestly and reject malformed, oversized, wrong-chain, or unsupported transactions before broadcast.
- Add fake-Comet unit tests plus a daemon smoke check; then verify the routes against a temporary remote candidate and roll it back.
- Mark only the two completed capability IDs as implemented; keep `publicCutoverReady=false` while any other capability remains missing.

Files to touch:

- `internal/bftgateway`
- `cmd/ynx-bft-gatewayd` only if daemon configuration changes
- `scripts/verify/bft-gateway-check.sh` and focused fixtures
- Acceptance state files after verified evidence
- No validator key, owner private key, PEM content, mnemonic, real `.env`, or secret transaction material

Validation commands:

- `go test ./internal/bftgateway ./cmd/ynx-bft-gatewayd`
- `make bft-gateway-check`
- `make consensus-public-cutover-check`
- `go test ./...`
- `make no-placeholder-check`
- `make secret-scan`
- `make objective-state-check`

Completion standard:

- A canonical owner-signed transaction broadcasts through the Gateway and commits through CometBFT.
- Lookup and paginated history return the same transaction bytes/hash/height and reject unsupported envelopes.
- Unit and remote candidate evidence pass without exposing the owner key.
- Candidate and temporary Gateway are removed after proof; authoritative public services remain online.
- Cutover gate remains blocked by the still-unimplemented EVM, Faucet, AI, Pay, Trust/Chain Law, Resource, and IDE capabilities.

Explicitly not doing:

- Do not route Caddy, DNS, Indexer, Explorer, Faucet, or public RPC to the Gateway yet.
- Do not mark `publicCutoverReady=true` by editing metadata without real code and tests.
- Do not claim public BFT, mainnet, listing, stablecoin issuer support, wallet default support, partnerships, or goal completion.
