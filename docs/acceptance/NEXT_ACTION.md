# Next Action

Highest-priority bounded delivery (2026-07-15):

Current single action: safely deploy and verify the current authoritative Pay consumer-settlement protocol and three-upstream App Gateway on the public testnet. Do not execute a public value transfer without separate explicit approval of the disposable payer, recipient, and amount.

Why this is next:

- Payout-bound invoices, committed native-transfer verification, paid transition, persisted receipts/events, account-session payer binding, and the App-native Pay window now exist and pass local checks.
- The public chain and App Gateway still run older releases. Local completion is not remote completion, and the App cannot use Pay publicly until exact binaries/configuration are deployed.
- Deployment has a bounded existing path with backup, rollback, exact release identity, health checks, and public route verification. This closes more real product value than adding another local placeholder.

Files to touch:

- Commit and push the exact tested source first.
- Run the full local gates, including deployment dry-run and objective-state validation.
- Revalidate the primary host, PEM mapping, current remote release, and rollback boundary from current deployment docs and live read-only evidence. Do not guess SSH targets.
- Deploy through the existing guarded testnet workflow. Preserve authoritative Pay mode; do not cut over BFT or broaden bounded EVM/IDE.
- Confirm `ynx-payd` on `127.0.0.1:6430`, App Gateway Pay loopback configuration, mode-`0600` env/state, service health, exact build identity, chain growth, and unchanged Chat/Square routes.
- Verify bounded public `GET /app/pay/invoices/{id}` behavior only when a real existing payout-bound invoice is available. A `404` for an unknown fixture is acceptable route evidence; synthetic records are not.
- Record any DNS/TLS/SSH/provider failure honestly. Do not claim public consumer settlement until an approved public transfer and receipt have actually completed.

Validation commands:

- `go test ./...`
- `make pay-api-check`
- `make app-account-ownership-check`
- `make mobile-check`
- `make mobile-android-release-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make deploy-dry-run`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`
- guarded deploy/verify commands selected from the current operations runbook after host/key revalidation

Completion standard:

- Exact pushed code is installed with a recoverable backup and all affected services healthy.
- Public App health reports Chat, Square, and Pay upstreams without exposing credentials.
- Existing public chain, Explorer, Square, and Chat reads remain healthy and chain height continues advancing.
- Remote state files truthfully distinguish deployed protocol from absent public payment proof.

After this deployment:

- Build the first real native Chat window over the existing protected direct-message core, including device/session lifecycle, conversation list, encrypted message send/read/delivery state, and visible unavailable/empty states.
- Do not add fake Bank, Shop, Bridge, AI, IDE, or desktop routes. Each window must follow real backend capability and verification.

Explicitly not doing / truth boundaries:

- Do not claim mainnet, exchange listing, stablecoin issuer support, wallet default support, store acceptance, partnership, public settlement, or independent proof without external evidence.
- Do not expose Bridge as usable until external execution and custody/mint-burn authority exist.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
