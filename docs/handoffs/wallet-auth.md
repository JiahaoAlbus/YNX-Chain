# YNX Wallet and Wallet Auth handoff

## Git identity

- Branch: `codex/ecosystem-wallet-auth`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Wallet Auth`
- Baseline commit: `b281376eac6fe3cf1ffa8c4b5a44e3546302791f`
- Baseline source: refreshed `origin/main` on 2026-07-16. The isolated Wallet commits were rebased onto this exact commit before final verification and push.
- Superseded pre-review branch tip: `bb8ef9924d71c1f991cb1facdfc06ab2d60045c8`
- Corrected code/proof commit: recorded after the protocol correction commit is created.
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
7. `productDeviceAlgorithm`
8. `productDeviceKey`
9. `callback`
10. `scopes`
11. `purpose`
12. `issuedAt`
13. `expiresAt`

Rules:

- `version` must be `1`; `chainId` must be `ynx_6423-1`.
- `productDeviceAlgorithm` must be `p256-sha256`. `productDeviceKey` is the 33-byte compressed SEC1 P-256 public key encoded as unpadded canonical base64url; a hash or opaque key identifier is not accepted.
- Lifetime is positive and no more than five minutes; issued time cannot be materially in the future.
- Product registry binding is exact for requesting product, client ID, bundle/package ID, callback and an ordered allow-list of scopes.
- Scope lists must be unique, sorted and non-empty; an unknown or over-broad scope fails closed.
- Request digest is SHA-256 over canonical JSON. The Wallet approval repeats and signs every security binding, the chosen native account, granted scopes and expiry.
- The callback is created only from the request's already-validated callback origin. Callback substitution and product/bundle/device mismatch fail verification.
- Wallet nonce consumption is persistent and one-time. Product callback nonce consumption is also one-time. A product-device challenge is bound to request digest, client, bundle, device algorithm/key, account, exact ordered scopes, issue time and expiry.
- The Gateway challenge and completion use exact schemas with no unknown fields. Challenge time is canonical millisecond ISO UTC, must be issued within the Wallet approval lifetime, must still be live at verification, and can never expire later than the Wallet approval.
- Device signing bytes are exactly `YNX_PRODUCT_SESSION_CHALLENGE_V1\n<canonical challenge JSON>`. `p256-sha256` means SHA-256 with ECDSA P-256 and a canonical DER-encoded signature. The shared verifier accepts Android Keystore DER signatures and validates the compressed SEC1 public key.
- `verifyGatewayCompletion` compares challenge scopes byte-for-byte in canonical order with `grantedScopes` and refuses scope escalation, reorder, substitution and session-expiry extension even when the product key holder re-signs the mutated challenge.
- A session result is product-client and bundle limited. Cross-App session reuse fails.
- Wallet signs only the account-side approval. Product device private keys stay in their product; Wallet private keys and recovery material are never returned.

## Signer vector

Canonical vector: `packages/wallet-auth/testdata/signer-v1.json`.

- Request digest: `8af8ac0dd31e2aa874ef95d9c22c1aae25d1f42bf661b0427c9553aecc7f701d`
- Test account secret: scalar `1` (test vector only)
- Account: `ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80`
- Compressed public key: `0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798`
- Compact signature: `abefbb30a7e6ac1adfc2ef13d89b71e984b9c07d70db6e7a3f4209ab02c3b2190048628314f5c67eb25f2976421a64cf00f39ea3cbabdface812f2a0b68a2ab5`

Canonical product-device vector: `packages/wallet-auth/testdata/gateway-p256-v1.json`.

- Algorithm: `p256-sha256`
- Compressed SEC1 public key: `AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv`
- Challenge/session vector proves the exact canonical signing domain, DER signature and shared Gateway verification result.

## Threat model and fail-closed boundaries

- Malicious requester: exact schema plus registry binding rejects network, callback, product, bundle and scope substitution.
- Replay: Wallet persistence rejects a reused authorization nonce after restart; the product rejects a reused callback; Gateway completion is bound to a short-lived challenge.
- Callback interceptor: a callback alone cannot complete the product-device challenge because the interceptor does not hold the registered product device private key. This is covered by protocol tests; the emulator also showed Android's competing callback chooser before the intended test product completed its Keystore challenge.
- Cross-App theft: product sessions include exact client and bundle binding and cannot be reused by another App.
- Malicious product-key holder: a valid product device key cannot widen or reorder scopes, substitute a scope, extend challenge/session expiry, change algorithm/key encoding or add schema fields; every mutation fails before session issuance.
- Storage corruption: unknown manifest fields, mismatched account metadata, missing secrets and key/address mismatches fail closed.
- Device loss: only the offline recovery key restores accounts. Product device keys and sessions are deliberately not restored.
- JavaScript memory: an approved operation necessarily materializes the selected secret as a short-lived JS string; this implementation does not claim hardware-backed transaction signing. Production hardening should move signing into a native non-exportable key module where chain compatibility permits.
- Production signing: the checked Android release artifact uses the generated test signing configuration. A production keystore and Apple signing identity are intentionally not stored in the repository.

## AI-native security review

The selected authorization request is the only eligible input. The flow contains request selection, data preview, provider/model status, resource and maximum monetary estimate, explicit user permission, streaming, cancel, result review, apply/reject, audit, retry and provider-unavailable handling.

The runtime provider is injected through the product Gateway session contract; there is no embedded provider secret or canned success. Its interface contains request metadata only. It cannot receive a Wallet key or recovery material, sign, approve, send a transaction, alter permissions or bypass biometrics.

## Validation output

- `packages/wallet-auth`: `npm test` — 17 tests passed. Covers parser, Android/iOS deep links, exact request/challenge/completion schemas, canonical P-256 public-key encoding and vector, wrong network, expiry, product/callback/bundle substitution, scope escalation/reorder/substitution, challenge expiry extension, deterministic Wallet signer vector, tamper, callback interception, replay and cross-App session reuse.
- `apps/wallet`: `npm run typecheck` — passed.
- `apps/wallet`: `npm test` — 13 tests passed. Covers accessibility, AI success/cancel boundary/unavailable/retry/audit, replay persistence/tamper, restart locking, account switching, create/import storage path, migration, deterministic restart and storage tamper.
- `apps/wallet`: `npm run product-check` — passed for independent IDs, network/asset identity, bounded authorization UI, route isolation and accessibility labels.
- Android Hermes export — passed, 4,340,090 bytes.
- iOS Hermes export — passed, 4,334,166 bytes.
- Android native `assembleRelease` with SDK 36 / Java 17 — passed, 352 Gradle tasks, 77,946,214-byte APK.
- Android Social proof harness `assembleDebug` — passed, 3,310,269-byte APK, including Bouncy Castle primitives used only to equivalently verify the Wallet secp256k1 approval inside the proof product.
- Android emulator cold launch — `LaunchState: COLD`, `TotalTime: 450 ms`; persisted account opened locked and required biometrics.
- Android emulator cross-App proof was reproduced after correction. Separate `com.ynxweb4.social` launched `com.ynxweb4.wallet`; Wallet displayed the bound request and the user approved with an enrolled emulator fingerprint. Before nonce consumption, Social recomputed the request digest, checked every response binding and scope, verified the Wallet compact secp256k1 signature, and derived/checked the `ynx1` account from the approval public key. It then created the exact shared challenge schema and signing domain, signed with a non-exportable Android Keystore P-256 key, and ran an equivalent verifier over algorithm, compressed SEC1 key, bindings, scopes, approval-bounded lifetime and DER signature. Only then did it display a product-limited `ynx-social-v1` session. Exact verified callback replay was rejected from persistent product storage.
- iOS native project and bundle ID/deep-link configuration were generated. A native iOS/IPA build could not be run because this host exposes only `/Library/Developer/CommandLineTools`; `xcodebuild` reports that full Xcode is required and CocoaPods is not installed.
- No Go file changed, so `go test ./...` was not required by this task.

## Artifact hashes

Artifacts are local build outputs and intentionally ignored; reproducible evidence screenshots are committed.

- Android test-signed release APK `apps/wallet/android/app/build/outputs/apk/release/app-release.apk`: `64e6af158130e0f01567f12083d05cedbb0bab26b1a4a3cc4f2cfcdb5af366d2`
- Social proof APK `apps/wallet/proof/social-harness/app/build/outputs/apk/debug/app-debug.apk`: `5a58766cd161f69a5ea603776af031ede05ff9f431ea289b79ff2ad0fe73f61b`
- Android Hermes bundle: `753a38d04c8ac4163d3d9f5cb13d6d5e71ee75746ea4f55f141e363dadf01af7`
- iOS Hermes bundle: `4e4da3da45fc474e51866ab000895b53eb2fa541b4eebcc71c963f47feb4de42`
- Cold-launch proof: `2ecf38fa7f4228a8c8933b8034505949b82cd18b5f773e0edfba663342cd5f3b`
- Authorization proof: `44189c275db96e1e1fd276895e7d15f4d15ceb11271b5229ebf24a0fd809d7cc`
- Product-session proof: `5fd5334ad3f4d06051a4eee43e05cf66e6b092e3181980125ed2ae2ddca7dd76`
- Replay-rejected proof: `207ed99095ed77d9274dfad6159fe5f29ee6ec027a96a20759f0d6c63052c7ce`

## Incomplete items and integration requests

1. Central registry: register Wallet `com.ynxweb4.wallet` and the production Social client/bundle/callback/scope allow-list. The local proof binding is `ynx-social-v1`, `com.ynxweb4.social`, `ynxsocial://wallet-auth/callback`, `account:read` and `profile:link`.
2. Central Gateway: call the package's `verifyGatewayCompletion` for `p256-sha256` compressed SEC1 public keys and DER signatures; do not fork the signing domain or relax exact product, device algorithm/key, callback, scope, account, schema or approval-bounded expiry checks.
3. Social: the currently installed parallel Social build observed on the emulator used package `com.ynx.social` and a legacy query-field authorization URL. It was correctly rejected by this strict Wallet. Social must adopt the canonical `request=<base64url JSON>` envelope and registry identity before integration.
4. AI Gateway runtime: inject an authenticated Wallet product session, provider base URL, approved model policy and authoritative usage/fee estimate. The UI fails honestly as unavailable until this exists.
5. Release engineering: provide Android production signing, Apple signing/provisioning, full Xcode/CocoaPods CI, physical-device biometric checks, an IPA/archive, store metadata and distribution endpoints.
6. Security hardening: commission an external audit, add native non-exportable signing where compatible, add device-integrity policy, backup UX localization and a recovery drill before any mainnet claim.
