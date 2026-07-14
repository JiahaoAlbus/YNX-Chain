# Next Action

Current single action: close the bounded YNX Chat deployment and user-session boundary, then build YNX Square as the next real first-party application.

Why this action:

- Core commit `7c4ecbf` now provides `ynx1...` device identity, Ed25519 request proof, X25519 encrypted envelopes, persistent direct conversations, delivery/read state, revocation, rate/access/replay bounds, tests, and a standalone Chat daemon.
- The deployment package now carries default-disabled Chat release/systemd/backup/health wiring, but the real environment has not enabled it and no remote or public proof exists.
- A browser must never receive `YNX_CHAT_API_KEY`. The public app needs a bounded server-side session/proxy boundary tied to device signatures before Chat can be exposed safely.
- The user explicitly requires YNX Square. It must become a real persistent service and app, not a static website section or an unsupported ecosystem claim.

First close Chat:

- Add the server-side public session boundary and CORS/origin/body/rate controls without weakening device signatures.
- Add key rotation and bounded encrypted backup/recovery metadata; never return or log private keys, mnemonics, recovery secrets, plaintext messages, or service credentials.
- Deploy the exact committed release with `YNX_CHAT_DEPLOY_ENABLED=true`, verify service build/state/backup/restart evidence, then expose a functional Chat window and verify it in production.
- Keep groups, contacts, attachments, voice/video, Pay, Trust, appeals, and moderation incomplete until their own code and tests exist.

Then implement YNX Square:

- Add a standalone persistent Square daemon using normalized `ynx1...` authors and signed device mutations.
- Implement feed pagination, post create/read, comment create/read, reactions, follow/unfollow, report intake, moderation status, and appeal linkage.
- Implement tipping only as a bounded Pay intent through the existing Pay API; Square must never hold a user key or debit assets directly.
- Add exact idempotency, replay/conflict protection, content/body/rate bounds, mode-`0600` persistence, integrity/audit checks, unit/race/HTTP tests, smoke commands, Make targets, mutation-freeze behavior, release/systemd/backup/rollback wiring, and API docs after handlers exist.
- Build the actual Square UI with live records, loading/empty/error states, signed posting, comments, reactions, follows, reports, and truthful availability boundaries.

Files to touch:

- `internal/chat`, `cmd/ynx-chatd`, deployment ingress/session code, and Chat application code for the remaining public boundary
- new `internal/square` and `cmd/ynx-squared` service paths after Chat closure
- `scripts/verify`, `scripts/deploy`, `scripts/ops`, and `Makefile` for checks and lifecycle wiring
- API and ecosystem documentation only after matching handlers exist
- `FEATURE_COMPLETION_TRACKER.md`, `PROJECT_STATE.md`, and `NEXT_ACTION.md` after each verified slice
- the website repository only after the matching remote service is deployed and verified

Validation commands:

- `go test ./...`
- `make native-wallet-check`
- `make chat-api-check`
- future `make square-api-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make deploy-dry-run`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Chat has an exact committed remote release, safe server-side session boundary, restart/backup evidence, functional production UI, and public proof without browser-visible service credentials.
- Square has real service code, persistent signed records, focused and repository-wide passing tests, deployment lifecycle wiring, a functional production UI, and exact public proof.
- Anything not implemented or externally approved remains explicitly incomplete in all public and acceptance surfaces.

Explicitly not doing / truth boundaries:

- Chat is locally verified but not remotely/publicly available yet.
- YNX Square is target state only until code, tests, deployment, UI, and public proof all exist.
- Standard MetaMask remains the `0x...` EVM compatibility adapter; first-party identity remains `ynx1...`.
- Do not claim WeChat-equivalent completeness, wallet default support, mainnet, exchange listing, stablecoin issuer support, third-party partnership, remote Chat, or live Square without exact external evidence.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
