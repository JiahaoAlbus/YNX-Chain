# Next Action

Highest-priority bounded delivery (2026-07-15):

Promote the locally verified native iOS/Android slice into a remotely testable, lifecycle-safe mobile path. The Web/PWA remains online as fallback; mobile is the intended primary user window.

Current single action: commit and remotely deploy the App Gateway `ynx-mobile-v1` binding with scoped backup/rollback, then run a disposable native-protocol ownership/device/session/revocation smoke without publishing a Square post. In parallel, close the missing iOS/Android lifecycle evidence when the required simulator/emulator toolchains are available.

Why this action:

- `apps/mobile` now contains real React Native iOS/Android controls, not a WebView, and implements live Square/Network reads plus a SecureStore-backed `ynx1...` wallet create/import flow.
- The mobile signer and App Gateway native-client protocol pass canonical address/signature, session, signed-post-request, device-revocation, and secret non-disclosure tests.
- `make mobile-check` passes strict TypeScript, seven tests, prohibited-storage scanning, and both iOS/Android Hermes exports. Expo Doctor passes 20/20.
- The currently deployed Gateway release `132b711450f6` supports the browser flow only. Mobile write connectivity must not be claimed until the new binding is remotely deployed and observed.
- This machine has Java and `adb`, but lacks full Xcode/simulator and Android Emulator/SDK Manager, so device lifecycle proof remains unavailable rather than silently skipped.

Required implementation:

- Preserve exact browser-origin enforcement while deploying the separately bound `ynx-mobile-v1` protocol. Mixed browser/native requests must continue to fail closed.
- Use the existing default-disabled deployment gate, strict SSH role mapping, scoped backup, health polling, and rollback path. Do not expose Chat/Square service keys or raw session tokens.
- Verify public Gateway health reports the native boundary and exact new release.
- Run a disposable native-protocol challenge/verify/device-registration/device-revocation/session-revocation lifecycle. Do not submit a public Square post without explicit owner content approval.
- Add mobile lifecycle handling for background/foreground, expired/revoked sessions, offline/timeout, corrupted SecureStore state, and safe local removal.
- Add biometric unlock only with explicit platform support and fallback behavior; do not claim biometrics from SecureStore storage alone.
- Install or use a full Xcode simulator and Android emulator environment, then capture one iOS and one Android smoke. If toolchains remain unavailable, retain this as an explicit blocker.
- Keep the mobile recovery format truthful: current 64-hex export is not a mnemonic, hardware wallet, social recovery, or completed custody solution.
- Track the 10 moderate Expo build-chain advisories. Do not apply npm's incompatible Expo 46 downgrade merely to clear the report.

Files to touch:

- `internal/appgateway` and `cmd/ynx-app-gatewayd` only for the already bounded native binding and deployment correctness
- `apps/mobile` for lifecycle/session/recovery hardening and focused tests
- deployment and remote verification scripts only where native-bound health/smoke evidence requires them
- `docs/api/API_REFERENCE.md` only after matching code and tests exist
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, `docs/acceptance/PROJECT_STATE.md`, and this file after remote/device evidence

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
- production Gateway health and disposable native-protocol revoke smoke
- iOS simulator and Android emulator smoke when toolchains exist

Completion standard:

- The public Gateway reports the exact deployed release and native boundary while existing browser Square behavior remains intact.
- A disposable mobile-protocol client completes ownership proof, device registration, device revocation, and session revocation against the public Gateway without sending private keys or creating a post.
- iOS and Android continue to produce valid Hermes bundles; simulator/emulator evidence is recorded when toolchains exist.
- Mobile offline, expiry, revocation, corrupt-storage, and app-lifecycle states fail safely and visibly.
- No App Store, Google Play, mainnet, exchange listing, stablecoin issuer support, wallet default support, partnership, hardware-wallet, social-recovery, or independent-audit claim is made without external evidence.

Explicitly not doing / truth boundaries:

- Do not expose mnemonics, private keys, recovery secrets, session tokens, service keys, or plaintext private messages to servers, logs, commits, analytics, screenshots, or chain state.
- Do not treat `X-YNX-Client` as authentication; both account and device signatures remain mandatory.
- Do not create a public Square post during infrastructure smoke.
- Do not call local Hermes exports an IPA, APK/AAB, installed application, simulator proof, real-device proof, or store release.
- Do not claim independent public proof from operator-controlled checks.
- Do not expand Chat, Square interactions, Pay, Trust, Bank, Shop, desktop packaging, or broad website routes before this native deployment/lifecycle slice closes.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
