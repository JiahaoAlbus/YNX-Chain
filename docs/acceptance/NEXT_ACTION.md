# Next Action

Highest-priority bounded delivery (2026-07-14):

1. Finish exact-commit full gates for the locally implemented chain-account ownership/session candidate, then deploy only `ynx-app-gatewayd` with its state env/systemd boundary after a scoped backup. Do not widen the current remote read-only release before those gates pass.
2. Verify the exact remote build, restart persistence, mode-`0600` token-hash-only state, challenge replay/expiry/revocation, `ynx1...` account/device mismatch denial, protected Chat/Square registration, signed Square mutation, public read continuity, chain-height continuity, and rollback path. Record source-bound and independent-public evidence separately.
3. Add write-capable Square and Chat Web/PWA workflows only after the widened remote release is proven; then package the shared shell for macOS and Windows with platform-native CI verification.
4. Continue the shared clean YNX brand system: one reviewed logo/wordmark, Klein blue and white core tokens, typography, icon treatment, and one truthful ecosystem tagline reused by website, Explorer, Wallet, Square, Chat, IDE, and Pay.
5. Keep IDE, Pay, Chat, Bank, Shop, AI, Wallet, Explorer, and future ecosystem apps as separately testable products with `live`, `local verified`, or `planned` status. Do not use empty screens to imply completion.

Current single action: pass full exact-commit gates and remotely deploy/verify the ownership-bound App Gateway candidate. The current remote gateway stays read-only until the candidate release, restart, protected flow, rollback, and chain continuity are proven.

Why this action:

- Chat core commit `7c4ecbf` and packaging commit `01a2477` provide signed `ynx1...` devices, encrypted direct conversations, persistent acknowledgements, checks, and default-disabled deployment wiring.
- The current Square slice provides signed devices, persistent feed/posts/comments/reactions/follows/reports, exact idempotency, rate/access bounds, checks, and default-disabled deployment wiring.
- Exact Chat and Square daemons are remotely installed on loopback. Their service keys remain server-only and direct service ingress is not public.
- The first device model proves possession of a newly supplied device key, not ownership of the claimed chain account. The local App Gateway candidate now adds canonical secp256k1 chain-account proof, Ed25519 device binding, exact-origin sessions, one-time challenges, token-hash-only persistence, expiry/revocation, and registration-body binding. Focused race, restart, tamper, high-S, replay, real daemon smoke, and release dry-run checks pass; no remote proof exists yet.
- Square reports currently stop at `pending_review`; the Trust appeal route is metadata only, and Pay tipping is not implemented. Those boundaries must be real before the UI exposes them.
- Website commit `c9759e9` and production deployment `dpl_4p2AUTFL5ouSB3mVdN9XC7MeHe6K` already provide the Apps directory, searchable in-site Docs, and a real read-only Square window. More website routes are deferred while the chain ownership gap is higher priority.

Required implementation:

- Commit only after full gates pass, then install the exact candidate binary, env, and systemd unit with `/var/lib/ynx-chain/app-gateway` mode `0700` and state mode `0600`; preserve and verify the prior binary/config backup and rollback command.
- Exercise the remote session flow with disposable smoke-only keys: chain-account proof, device binding, Chat/Square registration, signed Square mutation, public feed read, replay denial, revocation denial, restart recovery, and state inspection without printing tokens or private material.
- Add Square moderation review records with evidence references, explicit status transitions, reviewer separation, report transparency metadata, and appeal linkage without direct YNXT freeze/seize authority.
- Add Square tips only by creating a bounded intent through the existing Pay API. Square must never hold a user private key, sign for a user, or debit assets directly.
- Add functional Chat and signed Square windows only after the ownership/session gate passes and the exact widened release is remotely verified.

Files to touch:

- shared first-party session/proxy package and daemon following existing `internal/*` and `cmd/*` patterns
- `internal/chat`, `internal/square`, and explicit Trust/Pay adapter boundaries
- `scripts/verify`, `scripts/deploy`, `scripts/ops`, and `Makefile`
- API documentation only after matching handlers and tests exist
- `FEATURE_COMPLETION_TRACKER.md`, `PROJECT_STATE.md`, and `NEXT_ACTION.md` after every verified slice
- `/Users/huangjiahao/Desktop/YNX-Chain-website` only after matching remote endpoints are verified

Validation commands:

- `go test ./...`
- `make native-wallet-check`
- `make chat-api-check`
- `make square-api-check`
- `make app-account-ownership-check`
- `make app-gateway-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make deploy-dry-run`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Browser code contains no Chat/Square service credentials and all user mutations remain device-signature bound.
- Moderation and tip operations use real tested Trust/Pay adapters with explicit failure states and no hidden asset authority.
- Exact remote service releases, restart/backup checks, application UIs, and public proof are recorded before either product is described as live.
- Every still-absent group/media/recovery/moderation/payment capability remains explicitly incomplete.

Explicitly not doing / truth boundaries:

- Do not claim Chat or Square is remote/public before exact deployment and public proof.
- Do not expose service keys, mnemonics, private keys, recovery secrets, or plaintext private messages to browsers, logs, commits, or chain state.
- Do not claim WeChat-equivalent completeness, wallet default support, mainnet, exchange listing, stablecoin issuer support, third-party partnership, automated punishment, or native YNXT freeze authority.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
