# Next Action

Highest-priority bounded delivery (2026-07-15):

Turn the remotely verified native protocol into an installed, lifecycle-safe iOS and Android client path. The Web/PWA remains online as fallback; mobile is the intended primary user window.

Current single action: run the native application on one iOS simulator or device and one Android emulator or device against the public App Gateway, then close the background/foreground, offline, timeout, expiry, revocation, corrupted SecureStore, reinstall, and recovery lifecycle evidence. Produce installable development artifacts only after the corresponding native toolchain succeeds.

Why this action:

- `apps/mobile` now contains real React Native iOS/Android controls, not a WebView, and implements live Square/Network reads plus a SecureStore-backed `ynx1...` wallet create/import flow.
- The mobile signer and App Gateway native-client protocol pass canonical address/signature, session, signed-post-request, device-revocation, and secret non-disclosure tests.
- `make mobile-check` passes strict TypeScript, seven tests, prohibited-storage scanning, and both iOS/Android Hermes exports. Expo Doctor passes 20/20.
- Public Gateway release `ynx-chain-ae3e0457c082` now exposes the separately bound `ynx-mobile-v1` protocol while preserving exact browser-origin enforcement.
- A disposable operator-controlled remote smoke completed ownership proof, device registration, device revocation, and session revocation without creating a Square post. Public active sessions returned to zero and the feed hash remained unchanged.
- This machine has Java and `adb`, but lacks full Xcode/simulator and Android Emulator/SDK Manager, so device lifecycle proof remains unavailable rather than silently skipped.

Required implementation:

- Preserve the deployed exact browser-origin and separately bound `ynx-mobile-v1` enforcement. Mixed browser/native requests must continue to fail closed.
- Keep public Gateway health and the no-post disposable native-protocol revoke smoke as regression gates. Do not submit a public Square post without explicit owner content approval.
- Add mobile lifecycle handling for background/foreground, expired/revoked sessions, offline/timeout, corrupted SecureStore state, and safe local removal.
- Add biometric unlock only with explicit platform support and fallback behavior; do not claim biometrics from SecureStore storage alone.
- Install or use a full Xcode simulator and Android emulator environment, then capture one iOS and one Android smoke. If toolchains remain unavailable, retain this as an explicit blocker.
- Verify reinstall and recovery behavior without logging, uploading, or screenshotting the 64-hex recovery key.
- Build installable development artifacts through the native toolchains before making any IPA, APK, or AAB claim.
- Keep the mobile recovery format truthful: current 64-hex export is not a mnemonic, hardware wallet, social recovery, or completed custody solution.
- Track the 10 moderate Expo build-chain advisories. Do not apply npm's incompatible Expo 46 downgrade merely to clear the report.

Files to touch:

- `apps/mobile` for lifecycle/session/recovery hardening and focused tests
- `internal/appgateway` and `cmd/ynx-app-gatewayd` only if a real installed-client compatibility defect is found
- deployment and remote verification scripts only where regression evidence requires them
- `docs/api/API_REFERENCE.md` only after matching code and tests exist
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, `docs/acceptance/PROJECT_STATE.md`, and this file after installed-client evidence

Validation commands:

- `go test ./...`
- `make app-account-ownership-check`
- `make mobile-check`
- `make browser-signer-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`
- production Gateway health and disposable no-post native-protocol revoke regression smoke
- iOS simulator/device and Android emulator/device installed-client smoke
- native development artifact build commands from the installed Xcode and Android toolchains

Completion standard:

- The public Gateway continues to report exact release `ynx-chain-ae3e0457c082` and native boundary `ynx-mobile-v1` while existing browser Square behavior remains intact.
- An installed iOS client and an installed Android client each connect to the public Gateway and complete the approved no-post session lifecycle without sending private keys.
- iOS and Android produce valid Hermes bundles and installable development artifacts through their actual native toolchains.
- Mobile offline, expiry, revocation, corrupt-storage, and app-lifecycle states fail safely and visibly.
- No App Store, Google Play, mainnet, exchange listing, stablecoin issuer support, wallet default support, partnership, hardware-wallet, social-recovery, or independent-audit claim is made without external evidence.

Explicitly not doing / truth boundaries:

- Do not expose mnemonics, private keys, recovery secrets, session tokens, service keys, or plaintext private messages to servers, logs, commits, analytics, screenshots, or chain state.
- Do not treat `X-YNX-Client` as authentication; both account and device signatures remain mandatory.
- Do not create a public Square post during infrastructure smoke.
- Do not call local Hermes exports an IPA, APK/AAB, installed application, simulator proof, real-device proof, or store release.
- Do not claim independent public proof from operator-controlled checks.
- Do not repeat the completed Gateway deployment unless a verified compatibility defect requires a scoped release.
- Do not expand Chat, Square interactions, Pay, Trust, Bank, Shop, desktop packaging, or broad website routes before this native deployment/lifecycle slice closes.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
