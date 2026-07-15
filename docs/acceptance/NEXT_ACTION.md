# Next Action

Highest-priority bounded delivery (2026-07-15):

Current single action: build the first real native Pay consumer window on top of the existing authenticated Pay API. Keep mobile as the primary user surface and use App-native screens, navigation, sheets, system share/clipboard, and biometric confirmation rather than reusing the website's long-page composition.

Current state entering this action:

- Native Wallet now has separate Assets, Activity, and Account routes, real public-testnet balance/nonce/history reads, public-address QR receive, exact `1 YNXT` fee preview, canonical Go-compatible transfer signing, strong-biometric authorization, bounded broadcast/finality tracking, and visible unknown-result handling.
- Thirty-three mobile tests, strict TypeScript, Android/iOS Hermes bundles, the shared Go/TypeScript transaction vector, and Android 16 arm64 installed rendering for Assets, Account, Activity, and Receive pass locally.
- The installed disposable public account was genuinely unfunded. No owner-approved public transfer was executed, so installed Send review/biometric/broadcast/receipt evidence remains incomplete and must not be described as completed.
- Cross-chain remains visibly `Not active`. Bridge coordinator/readiness code is not a usable bridge: no external adapter, mint/burn authority, public Bridge deployment, or real cross-chain transfer exists.
- Chat has a protected bounded protocol/core but no finished App. Bank and Shop are not implemented products. Do not represent them as available.

Required Pay implementation:

- Audit and reuse the actual Pay API contract, persistence, idempotency, account ownership, fee/resource, status, and receipt semantics. Do not invent a parallel client protocol.
- Add a native Pay route/window with merchant or payment-request discovery, recipient and amount validation, exact YNXT debit plus fee/resource preview, explicit review, strong-biometric authorization, submission, status tracking, receipt/history, retry safety, and visible rejected/unknown states.
- Keep `ynx1...` primary and expose `0x...` only where EVM compatibility is technically required.
- Use real API data only. Empty, unavailable, unsupported, and not-deployed states must remain distinguishable.
- Preserve SecureStore custody, capture protection, AppState/session locking, canonical Wallet signing, external Android Release signing, official Logo identity, and no-post/no-unapproved-transfer behavior.
- Add routes only for real workflows. Do not add Bank, Shop, Bridge, Chat, AI, or IDE placeholders merely to make the App look complete.

Files to touch:

- `apps/mobile` for native Pay routes, request/review/receipt UI, ownership authorization, and focused tests
- `apps/mobile/src/api` for the existing Pay API client and strict response validation
- `internal/paygateway`, `internal/appgateway`, or public API documentation only if a verified contract defect requires a matching code change
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, `docs/acceptance/PROJECT_STATE.md`, and this file after installed-app evidence

Wallet follow-up still required:

- Exercise Send review and biometric denial/success against deterministic local chain fixtures without broadcasting real public value, or obtain explicit owner approval for a disposable public-testnet recipient and amount.
- Then verify broadcast binding, receipt/finality display, duplicate-submit prevention, and app-restart history reconciliation in the installed Android app.
- Keep iOS installation, Android/iOS real devices, owner production signing/recovery/handover, store distribution, audit, and independent proof explicitly incomplete until separately evidenced.

Completion standard:

- A user can open an independent native Pay screen, inspect a real payment request, review exact recipient/amount/fee/resource impact, authorize with strong biometrics, submit through the verified account-bound protocol, and observe persisted status and receipt history.
- Invalid, stale, duplicate, rejected, timed-out, and unknown-result states fail closed and remain visible; no synthetic merchant, balance, payment, or receipt data is shown.
- Existing Wallet, Square, secure key custody, release packaging, and truth-boundary tests remain green.

Validation commands:

- `go test ./...`
- `make pay-api-check`
- `make wallet-integration-check`
- `make address-codec-check`
- `make app-account-ownership-check`
- `make mobile-check`
- `make mobile-android-native-check`
- `ANDROID_SERIAL=<enrolled-emulator> make mobile-biometric-installed-check`
- `make mobile-android-release-check`
- `ANDROID_SERIAL=<emulator> make mobile-android-release-installed-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`

Explicitly not doing / truth boundaries:

- Do not describe the current Wallet as Binance-class, production custody, hardware wallet, mnemonic/social recovery, or a complete payment product.
- Do not submit a public Square post or real value transfer without explicit owner approval of content, recipient, and amount.
- Do not expose Bridge as usable until external execution, custody/mint-burn authority, monitoring, rollback, audit, deployment, and real transaction evidence exist.
- Do not claim mainnet launch, exchange listing, stablecoin issuer support, wallet default support, store acceptance, partnership, or independent proof without external evidence.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
