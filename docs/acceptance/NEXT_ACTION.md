# Next Action

Highest-priority bounded delivery (2026-07-15):

Add a real, testable biometric authorization gate for local mobile key use after closing the Android Release build boundary. The Web/PWA remains online as fallback; mobile is the intended primary user window.

Current single action: integrate platform biometric capability/enrollment/authentication into the native wallet and require a successful local authorization before ownership proof, signed post, recovery-key reveal, or destructive key removal, with explicit safe handling for unavailable, not enrolled, cancelled, failed, and locked-out states.

Why this action:

- `apps/mobile` now contains real React Native iOS/Android controls, not a WebView, and implements live Square/Network reads plus a SecureStore-backed `ynx1...` wallet create/import flow.
- The mobile signer and App Gateway native-client protocol pass canonical address/signature, session, signed-post-request, device-revocation, and secret non-disclosure tests.
- Commit `1437771` adds immediate local lock plus best-effort remote session revocation on foreground exit, Square unmount, or identity change; expiry/`401`/`403` invalidation; compose clearing; strict SecureStore decoding; and confirmed unreadable-record cleanup.
- `make mobile-check` passes strict TypeScript, 13 tests, prohibited-storage scanning, and both iOS/Android Hermes exports. Expo Doctor passes 20/20.
- Public Gateway release `ynx-chain-ae3e0457c082` now exposes the separately bound `ynx-mobile-v1` protocol while preserving exact browser-origin enforcement.
- A disposable operator-controlled remote smoke completed ownership proof, device registration, device revocation, and session revocation without creating a Square post. Public active sessions returned to zero and the feed hash remained unchanged.
- Android SDK/Emulator is now installed. Package `com.ynxweb4.mobile` was built and installed on Android 16 arm64 emulator `YNX_API_36`; SecureStore identity, public session `0 -> 1`, background lock/revocation `1 -> 0`, return messaging, and safe removal were observed without posting.
- The recovery screen had a real immediate-capture race; generation now awaits native screen-capture protection. Immediate and settled Android captures are black and the windows report `SECURE`.
- The rebuilt debug APK SHA-256 is `c889263e0026c233ca443ef0fed913f5df77384b0210d622b5f5c2046ac5428d`, and `make mobile-android-native-check` reproduces its native project/build/package checks.
- Full Xcode/simulator remains unavailable, and no real-device, owner-production-signing, IPA, owner-signed production AAB, or store proof exists.
- Expo Release no longer uses the debug keystore. A disposable external certificate produced verified APK/AAB artifacts, tamper and false-claim checks passed, and the test-signed Release APK cold-launched on Android 16 with the live empty Square feed. This is not owner production signing.

Required implementation:

- Preserve the deployed exact browser-origin and separately bound `ynx-mobile-v1` enforcement. Mixed browser/native requests must continue to fail closed.
- Keep public Gateway health and the no-post disposable native-protocol revoke smoke as regression gates. Do not submit a public Square post without explicit owner content approval.
- Add the platform local-authentication module with pinned dependency/lockfile versions and no WebView or server biometric data.
- Centralize authorization so protected ownership, signing, recovery reveal, and destructive removal cannot bypass it through alternate UI paths.
- Test capability unavailable, enrollment absent, user cancel, authentication failure, lockout, and success without weakening existing AppState/session locks.
- Use Android emulator biometric enrollment/fingerprint commands for installed-app evidence; retain iOS as an explicit Xcode/toolchain gap.
- Keep the external Android signing pipeline, disposable-test mode, and owner-approved clean-tree/key-custody gates green.
- Never log, upload, screenshot, or persist biometric results or recovery secrets outside SecureStore.
- Keep the mobile recovery format truthful: current 64-hex export is not a mnemonic, hardware wallet, social recovery, or completed custody solution.
- Track the 10 moderate Expo build-chain advisories. Do not apply npm's incompatible Expo 46 downgrade merely to clear the report.

Files to touch:

- `apps/mobile` for lifecycle/session/recovery hardening and focused tests
- `apps/mobile/src` and focused tests for the authorization boundary
- `internal/appgateway` and `cmd/ynx-app-gatewayd` only if a real installed-client compatibility defect is found
- deployment and remote verification scripts only where regression evidence requires them
- `docs/api/API_REFERENCE.md` only after matching code and tests exist
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, `docs/acceptance/PROJECT_STATE.md`, and this file after installed-client evidence

Validation commands:

- `go test ./...`
- `make app-account-ownership-check`
- `make mobile-check`
- `make mobile-android-native-check`
- `make mobile-android-release-check`
- `ANDROID_SERIAL=<emulator> make mobile-android-release-installed-check`
- `make browser-signer-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`
- production Gateway health and disposable no-post native-protocol revoke regression smoke
- Android emulator biometric enrollment/success/cancel/lockout smoke and Release regression smoke

Completion standard:

- The public Gateway continues to report exact release `ynx-chain-ae3e0457c082` and native boundary `ynx-mobile-v1` while existing browser Square behavior remains intact.
- Protected mobile key operations require one explicit successful local authorization when biometrics are available and enrolled; all failure modes remain local, visible, and fail closed.
- Android debug and disposable-test-signed Release builds preserve the public Gateway/no-post lifecycle and official Logo.
- Android Release APK/AAB verification remains green; owner production signing fields stay false without ceremony evidence.
- Mobile offline, expiry, revocation, corrupt-storage, and app-lifecycle states fail safely and visibly.
- No App Store, Google Play, mainnet, exchange listing, stablecoin issuer support, wallet default support, partnership, hardware-wallet, social-recovery, or independent-audit claim is made without external evidence.

Explicitly not doing / truth boundaries:

- Do not expose mnemonics, private keys, recovery secrets, session tokens, service keys, or plaintext private messages to servers, logs, commits, analytics, screenshots, or chain state.
- Do not treat `X-YNX-Client` as authentication; both account and device signatures remain mandatory.
- Do not create a public Square post during infrastructure smoke.
- Do not call local Hermes exports an IPA, APK/AAB, installed application, simulator proof, real-device proof, or store release. Do not call the disposable-test-signed Release APK/AAB owner production-signed, real-device, or store proof.
- Do not claim independent public proof from operator-controlled checks.
- Do not repeat the completed Gateway deployment unless a verified compatibility defect requires a scoped release.
- Do not expand Chat, Square interactions, Pay, Trust, Bank, Shop, desktop packaging, or broad website routes before this biometric authorization slice closes.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
