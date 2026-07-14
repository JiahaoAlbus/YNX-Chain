# Next Action

Highest-priority bounded delivery (2026-07-14):

Build the first native YNX mobile client for iOS and Android. The deployed Web/PWA remains a fallback and proof surface; it is not the final primary user window.

Current single action: create a React Native mobile application that reuses the verified YNX account/signature formats while replacing browser storage with platform Keychain/Keystore custody. Deliver one real native Square workflow: local account create/import, backup acknowledgement, lock/unlock, ownership-bound Gateway session, live persisted feed, signed composition, and device/session revocation. Do not use a WebView and do not create a public post without owner approval.

Why this action:

- Website commit `9967633` and Vercel deployment `dpl_3BBSTkc6Q5eb6nLaacfnMLmo9oxG` now provide a production-verified signed Square Web/PWA window.
- Production browser proof completed disposable account creation, encrypted backup, ownership verification, device registration, session establishment, composition enablement, device/session revocation, and local cleanup. Gateway active sessions returned to zero and the feed remained empty.
- Users need a primary mobile interaction model for iOS and Android. Expanding more website routes now would not close native custody, biometric lock, mobile navigation, or app lifecycle gaps.
- Chain signer formats are already cross-language verified. The mobile client must preserve those canonical formats and add platform-specific secure storage instead of forking protocol rules.

Required implementation:

- Create a narrowly scoped React Native application under a dedicated mobile workspace with reproducible dependency locks and no WebView-based product UI.
- Implement platform adapters for iOS Keychain and Android Keystore. Account and device secrets must never enter AsyncStorage, logs, analytics, screenshots, repository state, Gateway payloads, or build artifacts.
- Preserve shared `ynx1...` derivation, low-S secp256k1 ownership proof, Ed25519 device proof, exact Square request signatures, stable device identity, and Go/JavaScript vectors.
- Provide native create and import flows, explicit encrypted backup acknowledgement, lock/unlock, optional biometric gate where platform support is available, and visible recovery limitations.
- Implement live sessionless Square feed reads and account-bound challenge/verify/device registration against `https://api.ynxweb4.com`.
- Implement signed post composition but do not submit a public post during smoke. Add signed device/session revocation and safe local removal.
- Cover cold start, background/foreground, offline, timeout, wrong password, corrupted storage, expired/revoked session, rejected signature, and reinstall/recovery boundaries.
- Add focused unit/component tests and at least one iOS simulator plus one Android emulator smoke when local toolchains are available. Report any unavailable toolchain honestly.
- Keep Web/PWA online as the fallback route. Do not start Bank, Shop, broad route expansion, macOS/Windows packaging, or bounded EVM/IDE expansion in this slice.

Files to touch:

- new dedicated native mobile workspace and reproducible package lock
- shared signer/vector adapters under `sdk/browser` only where platform-neutral reuse requires it
- platform Keychain/Keystore adapters and native Square screens
- focused mobile verification scripts and Makefile targets
- `docs/api/API_REFERENCE.md` only after matching mobile code and tests exist
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, `docs/acceptance/PROJECT_STATE.md`, and `docs/acceptance/NEXT_ACTION.md` after verification

Validation commands:

- `make browser-signer-check`
- `go test ./...`
- new mobile signer/vector check
- new mobile unit/component test command
- iOS simulator build/smoke
- Android emulator build/smoke
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`
- production read-only Square and Gateway health checks

Completion standard:

- The same native project produces working iOS and Android application builds, not just mock screens or a web wrapper.
- A user can create or import a YNX-native account, see its `ynx1...` identity, protect it with platform secure storage, unlock it, establish an ownership-bound session, view the live Square feed, compose a signed post, and revoke the device/session without sending private material to a server.
- Mobile lifecycle and failure states are visible and safe. Tests prove canonical parity with the chain signer vectors.
- No App Store, Google Play, hardware-wallet, social-recovery, custody, wallet-default, or independent-audit claim is made until external evidence exists.

Explicitly not doing / truth boundaries:

- Do not expose mnemonics, private keys, recovery secrets, session tokens, Chat/Square service keys, or plaintext private messages to servers, logs, commits, analytics, screenshots, or chain state.
- Do not treat a generated mobile key as completed custody, backup, recovery, or owner handover.
- Do not claim an owner-approved public post until exact content and signing account are deliberately approved and observed in the persisted feed.
- Do not claim independent public proof from operator-controlled checks.
- Do not claim WeChat-equivalent completeness, wallet default support, mainnet, exchange listing, stablecoin issuer support, third-party partnership, automated punishment, or native YNXT freeze authority.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
