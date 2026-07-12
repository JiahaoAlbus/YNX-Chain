# Next Action

Current single action: make `ynx-indexerd` bootstrap and resume truthfully from a CometBFT candidate's migration/earliest retained height, then prove the BFT Faucet transaction appears through the real Indexer and Explorer stack.

Why this action:

- Gateway native transactions and BFT Faucet funding are now locally tested and remotely candidate-verified.
- A candidate starts after the migrated authoritative height, but an empty Indexer currently assumes height `1`; it therefore requests pruned/nonexistent history and cannot become usable after cutover.
- Indexer/Explorer are the next chain infrastructure layer needed to make candidate block and transaction activity continuously visible without synthetic data.
- Public services remain on the authoritative rollback model; the candidate and all temporary services are currently absent.

Required implementation work:

- Extend Gateway status with CometBFT's real earliest retained block height/hash/time and validate their relationship to latest height.
- Extend Indexer source status decoding with the earliest retained boundary.
- On an empty database, begin at the exact earliest retained height instead of assuming genesis height `1`; never fabricate skipped blocks.
- Persist the source earliest boundary and expose it in Indexer health/summary evidence.
- On resume, require the next block's parent hash to match the last indexed hash; fail closed on source-chain divergence rather than silently mixing histories.
- Detect a stored database whose last indexed height is below a newer pruned boundary and report a deterministic rebuild-required error.
- Add fake-RPC tests for migration-height bootstrap, normal resume, parent mismatch, pruned resume, restart persistence, and the indexed Faucet transaction.
- Preserve authoritative height-`1` behavior and existing public Indexer/Explorer rollback path.
- Temporarily deploy candidate and Gateway, create one BFT Faucet transaction, run a temporary Indexer from an empty store, and prove block/transaction lookup plus restart resume.
- Run a temporary Explorer over the candidate Gateway and Indexer, verify real height/transaction rendering and SSE growth on desktop/mobile loopback, then remove all temporary services and rerun rollback gates.

Files to touch:

- `internal/bftgateway`
- `internal/indexer`
- `cmd/ynx-indexerd` only if configuration/health changes
- `internal/explorer` only for real compatibility defects discovered by the candidate proof
- `scripts/verify/indexer-check.sh`, `scripts/verify/explorer-check.sh`, and focused fixtures
- Acceptance state files after verified evidence
- No private key, PEM content, mnemonic, real `.env`, or fabricated index data

Validation commands:

- `go test ./internal/bftgateway ./internal/indexer ./internal/explorer`
- `make bft-gateway-check`
- `make indexer-check`
- `make explorer-check`
- `go test ./...`
- `make no-placeholder-check`
- `make secret-scan`
- `make objective-state-check`

Completion standard:

- An empty Indexer starts at the exact real candidate earliest retained height and reaches the current source height.
- The BFT Faucet transaction is persisted and returned by Indexer transaction lookup/list APIs with the exact Gateway hash/height.
- Restart resumes without duplicate/missing blocks, while parent mismatch or pruned resume fails closed with explicit rebuild guidance.
- Temporary Explorer shows real candidate/indexed height, transaction activity, and SSE growth without synthetic data.
- Candidate, Gateway, Indexer, Explorer, Faucet, and tunnels are removed after proof; authoritative public services remain online.
- Public cutover remains blocked by the six unimplemented EVM, AI, Pay, Trust/Chain Law, Resource, and IDE capability groups.

Explicitly not doing:

- Do not route Caddy, DNS, public Indexer, Explorer, Faucet, or RPC to the candidate yet.
- Do not expand bounded EVM opcode, Counter, Hardhat artifact, or IDE execution work in this slice.
- Do not claim public BFT, mainnet, listing, stablecoin issuer support, wallet default support, partnerships, or goal completion.
