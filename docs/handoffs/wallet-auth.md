# YNX Wallet and Wallet Auth handoff

## Git identity

- Branch: `codex/ecosystem-wallet-auth`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Wallet Auth`
- Baseline commit: `b281376eac6fe3cf1ffa8c4b5a44e3546302791f`
- Baseline source: refreshed `origin/main` on 2026-07-16. The isolated Wallet commits were rebased onto this exact commit before final verification and push.
- Final code/proof commit: `cdc3f4ed8dd4f091b19ce48c792b35585261cc14`
- Final branch-tip commit: reported to the integration controller after the handoff commit is created. A commit cannot contain its own hash.

## Changed paths

- `apps/wallet/**`: independent Expo/React Native Wallet, generated Android and iOS native projects, lifecycle, secure storage, authorization UI, AI security review, tests and emulator evidence.
- `packages/wallet-auth/**`: strict version 1 protocol parser, canonicalization, deep links, account signer/verifier, replay store, product-device Gateway challenge/session binding, types, vectors and tests.
- `docs/handoffs/wallet-auth.md`: this integration contract.
- No central Gateway policy, registry, root Makefile, acceptance document, long-term objective or other product directory was changed.

## Product and network identity

- Product name: `YNX Wallet`
- Android package: `com.ynxweb4.wallet`
- iOS bundle identifier: `com.ynxweb4.wallet`
- Wallet scheme: `ynxwallet`
- Native network: `ynx_6423-1`
- EVM compatibility chain ID: `6423`
- Native asset: `YNXT`
- Native account display: `ynx1...`; `0x...` is mentioned only as an explicit EVM compatibility view.
- The Wallet has no Social Feed, Shop, Pay or Exchange bottom navigation.

## Wallet lifecycle and storage model

- Creates secp256k1 accounts and derives native `ynx1` accounts.
- Imports a strict 64-hex recovery key behind strong system biometrics.
- Prevents screen capture while showing new recovery material and requires the exact `BACKED UP` confirmation before persistence.
- Always starts locked, locks on background, and requires strong biometrics without device-credential fallback for unlock, authorization, import, recovery access and deletion.
- Supports multiple accounts, deterministic account ordering, selected-account switching, native-address copy, a chain/asset-bound QR URI, account removal confirmation, and lost-device recovery guidance.
- Manifest schema is version 2. Public account metadata is stored in one strict manifest. Each secret is stored under a separate `WHEN_UNLOCKED_THIS_DEVICE_ONLY` Keychain/Keystore entry.
- Migration consumes the old `ynx.mobile.identity.v1` identity, validates the account key, deliberately discards its cross-product device secret, writes v2 storage and removes the old entry.
- Restart validates every referenced secret against its native address, rejects unknown/tampered fields and returns only a locked runtime state.

## Sign in with YNX Wallet protocol version 1

Transport request: `ynxwallet://authorize?request=<base64url(canonical JSON)>`.

The parser requires exactly these fields and rejects missing or unknown fields:

1. `version`
2. `nonce`
3. `chainId`
4. `requestingProduct`
5. `productClientId`
6. `bundleId`
7. `productDeviceKey`
8. `callback`
9. `scopes`
10. `purpose`
11. `issuedAt`
12. `expiresAt`

Rules:

- `version` must be `1`; `chainId` must be `ynx_6423-1`.
- Lifetime is positive and no more than five minutes; issued time cannot be materially in the future.
- Product registry binding is exact for requesting product, client ID, bundle/package ID, callback and an ordered allow-list of scopes.
- Scope lists must be unique, sorted and non-empty; an unknown or over-broad scope fails closed.
- Request digest is SHA-256 over canonical JSON. The Wallet approval repeats and signs every security binding, the chosen native account, granted scopes and expiry.
- The callback is created only from the request's already-validated callback origin. Callback substitution and product/bundle/device mismatch fail verification.
- Wallet nonce consumption is persistent and one-time. Product callback nonce consumption is also one-time. A product-device challenge is bound to request digest, client, bundle, device key, account, scopes and expiry.
- A session result is product-client and bundle limited. Cross-App session reuse fails.
- Wallet signs only the account-side approval. Product device private keys stay in their product; Wallet private keys and recovery material are never returned.

## Signer vector

Canonical vector: `packages/wallet-auth/testdata/signer-v1.json`.

- Request digest: `5997ab438ab75efee14821a97a7dca355a303c54364ae14b54926ee7ebcc0e07`
- Test account secret: scalar `1` (test vector only)
- Account: `ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80`
- Compressed public key: `0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798`
- Compact signature: `c8f0612d92c304662bdee81c12b281457db2be75d753768da0b35cdb5455d72b792abe79133c28335e3bc9b7d3f7b5f24152817cef23bff861dc06da017759cc`

## Threat model and fail-closed boundaries

- Malicious requester: exact schema plus registry binding rejects network, callback, product, bundle and scope substitution.
- Replay: Wallet persistence rejects a reused authorization nonce after restart; the product rejects a reused callback; Gateway completion is bound to a short-lived challenge.
- Callback interceptor: a callback alone cannot complete the product-device challenge because the interceptor does not hold the registered product device private key. This is covered by protocol tests; the emulator also showed Android's competing callback chooser before the intended test product completed its Keystore challenge.
- Cross-App theft: product sessions include exact client and bundle binding and cannot be reused by another App.
- Storage corruption: unknown manifest fields, mismatched account metadata, missing secrets and key/address mismatches fail closed.
- Device loss: only the offline recovery key restores accounts. Product device keys and sessions are deliberately not restored.
- JavaScript memory: an approved operation necessarily materializes the selected secret as a short-lived JS string; this implementation does not claim hardware-backed transaction signing. Production hardening should move signing into a native non-exportable key module where chain compatibility permits.
- Production signing: the checked Android release artifact uses the generated test signing configuration. A production keystore and Apple signing identity are intentionally not stored in the repository.

## AI-native security review

The selected authorization request is the only eligible input. The flow contains request selection, data preview, provider/model status, resource and maximum monetary estimate, explicit user permission, streaming, cancel, result review, apply/reject, audit, retry and provider-unavailable handling.

The runtime provider is injected through the product Gateway session contract; there is no embedded provider secret or canned success. Its interface contains request metadata only. It cannot receive a Wallet key or recovery material, sign, approve, send a transaction, alter permissions or bypass biometrics.

## Validation output

- `packages/wallet-auth`: `npm test` — 13 tests passed. Covers parser, Android/iOS deep links, unknown fields, wrong network, expiry, product/callback/bundle/scope substitution, deterministic signer vector, tamper, callback interception, replay and cross-App session reuse.
- `apps/wallet`: `npm run typecheck` — passed.
- `apps/wallet`: `npm test` — 13 tests passed. Covers accessibility, AI success/cancel boundary/unavailable/retry/audit, replay persistence/tamper, restart locking, account switching, create/import storage path, migration, deterministic restart and storage tamper.
- `apps/wallet`: `npm run product-check` — passed for independent IDs, network/asset identity, bounded authorization UI, route isolation and accessibility labels.
- Android Hermes export — passed, 4,356,864 bytes.
- iOS Hermes export — passed, 4,351,249 bytes.
- Android native `assembleRelease` with SDK 36 / Java 17 — passed, 352 Gradle tasks, 77,958,138-byte APK.
- Android Social proof harness `assembleDebug` — passed, 20,250-byte APK.
- Android emulator cold launch — `LaunchState: COLD`, `TotalTime: 963 ms`; persisted account opened locked and required biometrics.
- Android emulator cross-App proof — separate `com.ynxweb4.social` launched `com.ynxweb4.wallet`; Wallet displayed requester, identity, network, account, permissions, purpose and expiry; user approved with an enrolled emulator fingerprint; callback returned; the Social-owned Android Keystore P-256 device key signed and verified the challenge; a product-limited `ynx-social-v1` session was shown; exact callback replay was rejected.
- iOS native project and bundle ID/deep-link configuration were generated. A native iOS/IPA build could not be run because this host exposes only `/Library/Developer/CommandLineTools`; `xcodebuild` reports that full Xcode is required and CocoaPods is not installed.
- No Go file changed, so `go test ./...` was not required by this task.

## Artifact hashes

Artifacts are local build outputs and intentionally ignored; reproducible evidence screenshots are committed.

- Android test-signed release APK `apps/wallet/android/app/build/outputs/apk/release/app-release.apk`: `721210c09053177f94bbbf375fb976b4e2e3fd07d4849dabdd2782b8e80a9600`
- Social proof APK `apps/wallet/proof/social-harness/app/build/outputs/apk/debug/app-debug.apk`: `1bc0308b4c012ebef9e183f49cd2bd8cc529f9d9ce2764d18e8bfa7539910d74`
- Android Hermes bundle: `e94454687f1b5607787ff35f0501cc5d321bcb4a50a33d5bb89da9770fee7d0e`
- iOS Hermes bundle: `b428895d6e0b2bbb70c3b489967eb831152fc3165bb526ff29903a0742c5201a`
- Cold-launch proof: `718a13bb1dcbcaa4648b3a07292d02636bb23abbf0184ebc7405147f334a16c7`
- Authorization proof: `d73b359f2d1d0dbc4a7cb16b9108b102ade92bf4c3e06bfce61d7cd3d0d3b5ac`
- Product-session proof: `3b1665ae73085d6edb94a1e8a4c84c2c0f9a4d80e585ac829491b22fa9de25a4`
- Replay-rejected proof: `f2033134157284e3ad4593d336b80374749800bf13e79c0dce16311d231f7d71`

## Incomplete items and integration requests

1. Central registry: register Wallet `com.ynxweb4.wallet` and the production Social client/bundle/callback/scope allow-list. The local proof binding is `ynx-social-v1`, `com.ynxweb4.social`, `ynxsocial://wallet-auth/callback`, `account:read` and `profile:link`.
2. Central Gateway: implement the package's challenge verification and session claims without relaxing exact product, device, callback, scope, account or expiry binding.
3. Social: the currently installed parallel Social build observed on the emulator used package `com.ynx.social` and a legacy query-field authorization URL. It was correctly rejected by this strict Wallet. Social must adopt the canonical `request=<base64url JSON>` envelope and registry identity before integration.
4. AI Gateway runtime: inject an authenticated Wallet product session, provider base URL, approved model policy and authoritative usage/fee estimate. The UI fails honestly as unavailable until this exists.
5. Release engineering: provide Android production signing, Apple signing/provisioning, full Xcode/CocoaPods CI, physical-device biometric checks, an IPA/archive, store metadata and distribution endpoints.
6. Security hardening: commission an external audit, add native non-exportable signing where compatible, add device-integrity policy, backup UX localization and a recovery drill before any mainnet claim.
