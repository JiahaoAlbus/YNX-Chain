# Next Action

Highest-priority bounded delivery (2026-07-15):

Current single action: build the first real App-native YNX Chat direct-message window over the existing remotely protected E2EE core. The mobile UI must use native navigation, lists, sheets, composer, keyboard behavior, delivery states, and lifecycle handling rather than website-style sections.

Why this is next:

- Pay consumer settlement, the native Pay window, four-role release `0d31850f74b2`, and three-upstream App Gateway are implemented and deployed. Public settlement remains intentionally unclaimed because no approved public transfer was executed.
- Chat already has signed `ynx1...` devices, encrypted envelopes, persistent two-member conversations, delivery/read acknowledgements, revocation, replay/access/rate bounds, loopback deployment, and protected App Gateway routes.
- The largest missing user-visible step is a real conversation workflow. Adding Bank, Shop, Bridge, groups, or decorative routes before direct messaging works would create placeholders rather than ecosystem capability.

Files to touch:

- `apps/mobile` for native conversation list, create/open flow, message timeline, composer, delivery/read indicators, loading/empty/error/offline states, and focused tests
- `apps/mobile/src/api` for strict Chat route clients integrated with the existing account/device/session signer
- `internal/appgateway` only if a real mobile Chat route or binding gap is found; do not weaken direct-service credential isolation
- `docs/api/API_REFERENCE.md` only after real route behavior exists
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, `docs/acceptance/PROJECT_STATE.md`, and this file after installed-app evidence

Required implementation:

- Reuse the existing SecureStore identity, exact `ynx-mobile-v1` ownership session, Ed25519 device registration, and lifecycle lock/revocation behavior.
- Create or open only two-member direct conversations supported by the backend; do not label them groups.
- Encrypt plaintext locally before upload and decrypt only on the device. Never persist or log plaintext server-side.
- Show bounded conversation/message history, sender/time, sent/delivered/read state, retry-safe idempotency, explicit failed/unknown state, and visible empty/unavailable states.
- Require strong biometric authorization where a new ownership session, device registration, recovery-key use, or protected signing boundary requires it. Do not prompt on every passive read.
- Keep Square, Wallet, Pay, Network, capture protection, key custody, and no-unapproved-write behavior passing.

Validation commands:

- focused mobile Chat/API tests
- `make chat-api-check`
- `make app-account-ownership-check`
- `make app-gateway-check`
- `make mobile-check`
- `make mobile-android-release-check`
- installed Android Release navigation/rendering check on an emulator
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`

Completion standard:

- An installed native App can establish/reuse the account-bound device session, list real direct conversations, create/open a supported two-member conversation, encrypt and submit a message, read/decrypt persisted ciphertext, and display delivery/read state without exposing secrets or plaintext to the server.
- Invalid identity, revoked device/session, replay, timeout, offline, decryption failure, and unknown submission states fail closed and remain visible.
- Existing Wallet, Pay, Square, chain, App Gateway, and release checks remain green.
- No public message is sent without explicit approval of the disposable accounts and content. Remote deployment/proof remains separate from local/installed completion.

Explicitly not doing / truth boundaries:

- Do not add fake Bank, Shop, Bridge, AI, IDE, desktop, group, attachment, contact, or moderation screens.
- Do not claim WeChat equivalence, mainnet, exchange listing, stablecoin issuer support, wallet default support, store acceptance, partnership, public settlement, or independent proof without evidence.
- Do not expose Bridge as usable until external execution and custody/mint-burn authority exist.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
