# Next Action

Highest-priority bounded delivery (2026-07-15):

Current single action: build and install the exact test-only native App, then prove one disposable multi-device Chat v2 lifecycle against the exact remote release before expanding Chat features.

Why this is next:

- Exact Chat/Gateway release `ynx-chain-c6a0e908e184` is remotely active with scoped rollback, preserved state/config modes, healthy dependencies, public exact-build health, fail-closed unauthenticated rotation routes, and signed empty conversation/device/rotation reads plus cleanup.
- The native App, Go service, and Gateway agree on fixed multi-device envelope/signature vectors, but current installed Android evidence only proves navigation/rendering. No installed device has authenticated, sent, reloaded, acknowledged, or rotated a v2 message.
- A real installed lifecycle is the smallest remaining proof that connects the native UI, SecureStore/biometric boundary, Gateway ownership session, remote ciphertext-only persistence, and per-device envelope behavior.

Files to touch:

- exact test-only Android package and emulator-only installed verification tooling
- disposable account/device proof harness only where native UI automation cannot safely supply deterministic evidence
- Chat/App Gateway read-only post-proof checks and acceptance documents after evidence exists

Required implementation:

- Build the exact source-bound test-only Release package; keep owner production signing and store claims false.
- Use two disposable `ynx1...` accounts and at least two active devices for one recipient plus sender continuity.
- Through the installed native UI, authenticate with real emulator biometrics, create/open one direct conversation, send one v2 message, verify intended devices can authenticate/decrypt it after reload, and verify per-device acknowledgement state.
- Exercise current-device rotation with system confirmation, strong biometrics, old/new proofs, SecureStore identity switch, re-unlock, and exact replay behavior.
- Confirm Chat health still reports `plaintextStored=false`, exact release identity, and no unexpected active Gateway sessions. Revoke disposable devices/sessions. If immutable conversation/message proof state must remain, record its IDs and explicit retention reason rather than claiming deletion.

Validation commands:

- `go test ./...`
- `make chat-api-check`
- `make app-account-ownership-check`
- `make app-gateway-check`
- `make mobile-check`
- `make mobile-android-release-check`
- `ANDROID_SERIAL=<emulator> make mobile-android-release-installed-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`

Completion standard:

- Exact installed package/source digest and emulator identity are recorded as disposable test evidence.
- One installed v2 message is sender-signed, encrypted separately for all active devices, decrypted after reload on every intended proof device, acknowledged per device, and remains plaintext-invisible to the service.
- Device rotation is proven through the native biometric/SecureStore flow with old-device rejection, new-device access, exact replay, and zero active sessions after cleanup.
- No installed iOS/real-device, production signing, store acceptance, independent proof, or general availability is inferred.

Explicitly not doing / truth boundaries:

- Bounded recovery requires an active authorizing device. All-devices-lost recovery, social recovery, owner custody handover, and hardware custody remain incomplete.
- Do not add fake Bank, Shop, Bridge, AI, IDE, desktop, group, attachment, contact, or moderation screens.
- Do not claim WeChat equivalence, mainnet, exchange listing, stablecoin issuer support, wallet default support, store acceptance, partnership, public settlement, or independent proof without evidence.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
