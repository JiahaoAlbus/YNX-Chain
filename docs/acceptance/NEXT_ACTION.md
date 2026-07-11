# Next Action

Current single action: implement and verify a dedicated approval-gated transition from the remotely proven parallel CometBFT candidate to the public YNX Testnet service boundary, with automatic rollback to the current authoritative network on any failed health or state check.

Why this action:

- Four owner-controlled host-local validator/node key pairs match the exact public manifest and remain mode restricted.
- The encrypted four-server overlay has three reachable private peers per role.
- Fresh authoritative state at height `16165` was packaged for `ynx_6423-1` with 14 accounts and four validators.
- Remote candidate proof passed with four signers, owner-signed YNXT transaction convergence, 3-of-4 progress, stopped-node recovery, and clean rollback.
- The candidate is intentionally absent after rollback; public ingress still serves authoritative replication and `publicCutoverAuthorized=false`.

Required implementation work:

- Add a separate cutover command; do not overload `deploy-consensus-candidate` or silently change public ingress.
- Re-export a final authoritative state only inside a bounded maintenance transition, after recording height/hash/state hash and confirming follower convergence.
- Build and verify a fresh package against the existing host-local public keys and private overlay.
- Back up authoritative chain state, candidate state, service units, Caddy configuration, and current release identity before mutation.
- Start and verify the four-node candidate on private/loopback ports before stopping any authoritative producer.
- Define explicit gates for exact chain ID, genesis/AppHash, four-validator set, common height/hash, greater-than-two-thirds signatures, peer count, signed account query, RPC growth, indexer catch-up, Explorer health, and current public service health.
- Switch only the primary local service boundary needed by RPC/indexer/explorer; keep DNS and TLS identity stable.
- Automatically restore authoritative services and previous ingress if any gate fails within the bounded observation window.
- Collect redacted cutover/rollback evidence with `publicCutoverAuthorized` remaining false until the actual approval variable is present.
- Add self-tests, dry-run fixtures, Makefile targets, and documentation before any live public cutover.

Files to touch:

- New scoped cutover and rollback scripts under `scripts/deploy`, `scripts/ops`, and `scripts/verify`
- Candidate/public service unit or proxy templates only where the transition requires them
- Makefile targets and focused tests
- Acceptance state files after real evidence
- No private validator key, owner key, mnemonic, PEM content, real `.env`, or raw secret output

Validation commands:

- `go test ./...`
- `make consensus-quorum-check`
- `make consensus-production-package-check`
- new cutover self-test and dry-run targets
- `make no-placeholder-check`
- `make secret-scan`
- `ENV_FILE=.env.deploy make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Dry-run proves backup, candidate start, every pre-cutover gate, service transition, observation window, and rollback on injected failures.
- The real command refuses mutation without an explicit approval variable, a current clean `main`, strict SSH, a verified package, live overlay, and current backups.
- Public services cannot be labeled BFT until remote public RPC exposes the CometBFT-backed chain and cross-region evidence verifies block growth, validator signatures, indexer catch-up, Explorer data, and rollback readiness.
- Failure at any point leaves the current authoritative public network active and verifiable.

Explicitly not doing:

- Do not relabel the current public authoritative network as BFT.
- Do not reuse old migration height `16165` for a future public cutover; export a final fresh anchor.
- Do not expose candidate RPC, ABCI, metrics, validator keys, or private overlay ports publicly.
- Do not claim mainnet, exchange listing, stablecoin issuer support, wallet default support, partnerships, or full goal completion.
