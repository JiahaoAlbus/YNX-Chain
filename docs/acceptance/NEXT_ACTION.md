# Next Action

Current single action: add a browser-safe first-party session boundary for the locally verified Chat and Square services, complete bounded Square moderation/Trust/Pay adapters, then deploy and expose real application windows.

Why this action:

- Chat core commit `7c4ecbf` and packaging commit `01a2477` provide signed `ynx1...` devices, encrypted direct conversations, persistent acknowledgements, checks, and default-disabled deployment wiring.
- The current Square slice provides signed devices, persistent feed/posts/comments/reactions/follows/reports, exact idempotency, rate/access bounds, checks, and default-disabled deployment wiring.
- Neither service is remotely installed or publicly reachable. A browser must never receive `YNX_CHAT_API_KEY` or `YNX_SQUARE_API_KEY`.
- Square reports currently stop at `pending_review`; the Trust appeal route is metadata only, and Pay tipping is not implemented. Those boundaries must be real before the UI exposes them.

Required implementation:

- Build a server-side session/proxy boundary that issues short-lived, origin-bound sessions after a valid `ynx1...` device challenge signature and forwards only allowed Chat/Square operations with service credentials kept server-side.
- Add CSRF/origin/CORS controls, body and response limits, replay-resistant challenges, session expiry/revocation, per-session/IP rate limits, redacted audit, persistence, tests, health/metrics, and mutation-freeze behavior.
- Add Square moderation review records with evidence references, explicit status transitions, reviewer separation, report transparency metadata, and appeal linkage without direct YNXT freeze/seize authority.
- Add Square tips only by creating a bounded intent through the existing Pay API. Square must never hold a user private key, sign for a user, or debit assets directly.
- Deploy exact committed Chat and Square services only after gates pass, verify build/state/backup/restart behavior, then build functional Chat and Square windows with live data and loading/empty/error/unavailable states.

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
