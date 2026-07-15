# Next Action

Highest-priority bounded delivery (2026-07-15):

Current single action: commit and guarded-deploy the exact new Chat daemon/App Gateway source, then verify the new signed conversation-list and member-device-directory routes through public ingress without sending a public message.

Why this is next:

- Pay consumer settlement, the native Pay window, four-role release `0d31850f74b2`, and three-upstream App Gateway are implemented and deployed. Public settlement remains intentionally unclaimed because no approved public transfer was executed.
- Chat already has signed `ynx1...` devices, encrypted envelopes, persistent two-member conversations, delivery/read acknowledgements, revocation, replay/access/rate bounds, loopback deployment, and protected App Gateway routes.
- The App-native direct-message window, mobile E2EE client, Go-compatible envelope vector, five-tab Release rendering, and local protocol tests now exist.
- The remote Chat daemon is still the older release and cannot serve the new list/directory calls required by the App. This deployment mismatch is now the highest bounded gap.

Files to touch:

- exact source commit/release package for `ynx-chatd` and `ynx-app-gatewayd`
- existing primary-host Chat/App Gateway environment, state, backup, systemd, and health paths
- public `api.ynxweb4.com/app/chat/*` ingress with native ownership/session/device signatures
- acceptance files after exact remote release and route evidence

Required implementation:

- Preserve existing Chat/Square/Pay credentials and state server-side; do not download or print secrets.
- Back up current binaries, env, units, and state before replacement, run config checks, restart only scoped services, poll health, and retain rollback.
- Prove exact build/release identity and verify `GET /app/chat/conversations` requires a native account/device session.
- If using disposable registered accounts for route proof, stop before conversation or message creation unless exact public write content/accounts are separately approved.
- Keep authoritative chain, Square, Pay, Explorer, and public testnet continuity unchanged.

Validation commands:

- `make chat-api-check`
- `make app-account-ownership-check`
- `make app-gateway-check`
- `make mobile-check`
- `make mobile-android-release-check`
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`

Completion standard:

- The exact pushed release is active for Chat and App Gateway with recoverable scoped backups and exact build evidence.
- Public ingress accepts only properly bound native sessions/device signatures for the new read routes and rejects unauthenticated calls.
- Existing Wallet, Pay, Square, chain, Explorer, and App Gateway health remain green.
- No public conversation/message write occurs without explicit approval of disposable accounts and content.

Explicitly not doing / truth boundaries:

- Do not add fake Bank, Shop, Bridge, AI, IDE, desktop, group, attachment, contact, or moderation screens.
- Do not claim WeChat equivalence, mainnet, exchange listing, stablecoin issuer support, wallet default support, store acceptance, partnership, public settlement, or independent proof without evidence.
- Do not expose Bridge as usable until external execution and custody/mint-burn authority exist.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
