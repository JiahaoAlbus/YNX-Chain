# Next Action

Highest-priority bounded delivery (2026-07-15):

Turn the native Wallet from an identity-only surface into a real YNXT asset and transfer workflow. The biometric prerequisite is now implemented and Android-emulator verified. The Web/PWA remains online as fallback; mobile is the intended primary user window.

Current single action: implement live testnet balance and transaction history, a clear receive surface, and a biometric-authorized signed YNXT transfer flow with recipient normalization, amount/nonce/balance validation, exact fee/resource preview, explicit confirmation, submission, receipt tracking, and failure recovery.

Why this action:

- The current App visibly exposes only Square, Wallet identity, and Network. It is not yet a full ecosystem or Binance-class wallet experience.
- Strong local biometric authorization now protects ownership proof, signed post, explicit device revocation, recovery-key actions, import, and local identity removal.
- Android emulator evidence covers unavailable enrollment, native cancellation, an unregistered fingerprint, registered-fingerprint success, and the protected recovery panel.
- The chain already has address normalization, balances/nonces, signed transfer semantics, fee/resource accounting, transaction lookup, Indexer, Explorer, EVM compatibility, and public testnet endpoints that can back a real wallet workflow.
- Pay and Bridge must not appear as usable App actions until their consumer protocol and external execution paths are real. `ynx-bridged` currently coordinates bounded intents only; it has no external adapter, mint/burn authority, public Bridge endpoint, or real cross-chain transaction.

Required implementation:

- Preserve `ynx1...` as the primary identity and show `0x...` only inside the explicit EVM compatibility detail.
- Read current YNXT balance, account nonce, recent transactions, confirmations, and receipt/result from real public chain/Indexer/Explorer APIs; no synthetic balances or activity.
- Add receive/copy/share presentation without exposing or regenerating private material. QR support must encode only the public `ynx1...` address and verified chain metadata.
- Add a signed native YNXT transfer builder using the existing canonical chain transaction format and test vectors. Reject malformed recipients, self-confusion, zero/negative/overflow amounts, insufficient liquid balance, stale nonce, wrong chain, replay, and changed-input idempotency conflicts.
- Show an exact fee/resource preview and a final confirmation summary before requesting strong biometric authorization and signing.
- Submit only after successful biometric authorization, then track the real transaction by hash to receipt/finality or a bounded visible timeout. Never convert an unknown result into success.
- Keep AppState/session locks, screen-capture protection, external Android signing, browser/native binding separation, no-post regression, and official Logo checks green.
- Do not add Pay, Bridge, Bank, Shop, Chat, AI, or IDE buttons as placeholders. Add a module only with a real usable protocol, UI, persistence, tests, and deployment evidence.

Files to touch:

- `apps/mobile` and focused tests for Wallet asset, receive, transfer, confirmation, and history UX
- `apps/mobile/src` for canonical chain reads, transaction building/signing, result validation, and biometric integration
- `internal/api`, `internal/consensus`, SDKs, and public metadata only where an existing canonical protocol must be reused or a real compatibility defect is found
- API documentation only after matching code and tests exist
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, `docs/acceptance/PROJECT_STATE.md`, and this file after installed-app evidence

Validation commands:

- `go test ./...`
- `make wallet-integration-check`
- `make address-codec-check`
- `make app-account-ownership-check`
- `make browser-signer-check`
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

Completion standard:

- A user can see a real public-testnet YNXT balance and recent account activity, receive to the correct `ynx1...` identity, preview a deterministic transfer, explicitly confirm, authorize biometrically, submit a canonical signed transaction, and observe a real receipt/finality result.
- Invalid, stale, insufficient-balance, rejected-biometric, network-timeout, rejected transaction, and unknown-result states remain visible and fail closed.
- No private/recovery key, biometric result, session token, or service credential enters logs, analytics, screenshots, commits, network payloads beyond required public key/signature data, or chain state.
- Android installed-app and Release gates remain green. iOS installed-app, real-device, owner production-signing, store, audit, and independent proof remain explicitly incomplete.
- No live Pay, Bridge, exchange listing, stablecoin issuer support, wallet default support, partnership, or mainnet claim is made without external execution and approval evidence.

Explicitly not doing / truth boundaries:

- Do not expose a Bridge action merely because readiness code exists. External-chain adapters, custody/mint-burn authority, live deployment, real cross-chain transactions, monitoring, rollback, audit, and independent proof are still absent.
- Do not describe the current Wallet as Binance-class, production custody, hardware wallet, mnemonic/social recovery, or a complete payment product.
- Do not submit a public Square post or real value transfer without explicit owner approval of content/recipient/amount. Installed checks must use deterministic local fixtures or an explicitly approved disposable testnet transfer.
- Do not call emulator, debug APK, disposable-test-signed APK/AAB, Hermes export, or operator-controlled checks real-device, owner-production, store, or independent proof.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
