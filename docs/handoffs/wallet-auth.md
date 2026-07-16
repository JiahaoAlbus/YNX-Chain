# YNX Wallet and Wallet Auth handoff

## Git identity

- Branch: `codex/ecosystem-wallet-auth`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Wallet Auth`
- Baseline commit: `b281376eac6fe3cf1ffa8c4b5a44e3546302791f`
- Baseline source: refreshed `origin/main` on 2026-07-16. The isolated Wallet commits were rebased onto this exact commit before final verification and push.
- Superseded pre-review branch tip: `bb8ef9924d71c1f991cb1facdfc06ab2d60045c8`
- Corrected code/proof commit: `bf09b976b74a27e6d6489f071b8e6347ab156584`
- Current return-work code commit: `e114f7999b528e05ff485fb7c1f3374a2b150ac7`.
- Final branch-tip commit: reported to the integration controller after the handoff commit is created. A commit cannot contain its own hash.

## Changed paths

- `apps/wallet/**`: independent Expo/React Native Wallet, generated Android and iOS native projects, lifecycle, secure storage, authorization UI, AI security review, tests and emulator evidence.
- `packages/wallet-auth/**`: strict version 1 protocol parser, canonicalization, deep links, account signer/verifier, replay store, product-device Gateway challenge/session binding, types, vectors and tests.
- `docs/handoffs/wallet-auth.md`: this integration contract.
- No central Gateway policy, registry, root Makefile, acceptance document, long-term objective or other product directory was changed.

## Latest main compatibility

- Compatibility target fetched on 2026-07-17: `origin/main` `719e1018267ed5a53e6fae5211c5fd8a1503c35c`.
- The branch merge-base remains the recorded baseline `b281376eac6fe3cf1ffa8c4b5a44e3546302791f`. Main changes since that baseline do not touch `apps/wallet/**`, `packages/wallet-auth/**`, or this handoff.
- `git merge-tree` reported no conflict markers between the current Wallet branch and that main tip. The branch was not rebased or merged because main's intervening changes are central operations/acceptance work outside Wallet ownership; integration control can apply the Wallet commits onto the current main without an owned-path conflict.

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
- Offline recovery imports only the native account key on a replacement device. Replay records, product device keys, product sessions and authorization audit history are intentionally device-local and are not reconstructed from the recovery key.
- Authorization decisions are stored without secrets in a strict, persistent SHA-256 hash chain. Intent approval is recorded before key access/signing, callback return is recorded separately, explicit rejection is recorded, and biometric revocation appends an approval-digest tombstone. Unknown fields, reordered chain links, binding edits and hash tamper fail closed.

## Internationalization

- Runtime locales: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Russian, Arabic and Bahasa Indonesia.
- System locale is detected on first launch. Manual selection is available from the native Wallet header and is persisted in device-only secure storage across restart.
- Authorization identity, permission, purpose, expiry, approve/reject, privacy, recovery, audit/revoke and core accessibility copy are locale keyed. No translation key may be blank. Arabic applies RTL layout direction.
- Dates use `Intl.DateTimeFormat`; numbers and YNXT amounts use `Intl.NumberFormat`; plural selection uses `Intl.PluralRules`. The locale test covers all twelve catalogs, persistence, locale detection, RTL, missing keys and bounded label lengths.
- AI output language is an independent selector. It is included in the safe provider context and prompt, while Wallet keys, recovery material, signing and approval remain outside the provider interface.

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
- Callback envelopes require the exact sole `response` query field and no fragment, credentials or mutable callback query state. Extra query fields fail closed.
- Wallet nonce consumption is persistent and one-time. Product callback nonce consumption is also one-time. A product-device challenge is bound to request digest, client, bundle, device algorithm/key, account, exact ordered scopes, issue time and expiry.
- The Gateway challenge and completion use exact schemas with no unknown fields. Challenge time is canonical millisecond ISO UTC, must be issued within the Wallet approval lifetime, must still be live at verification, and can never expire later than the Wallet approval.
- Device signing bytes are exactly `YNX_PRODUCT_SESSION_CHALLENGE_V1\n<canonical challenge JSON>`. `p256-sha256` means SHA-256 with ECDSA P-256 and a canonical DER-encoded signature. The shared verifier accepts Android Keystore DER signatures and validates the compressed SEC1 public key.
- `verifyGatewayCompletion` compares challenge scopes byte-for-byte in canonical order with `grantedScopes` and refuses scope escalation, reorder, substitution and session-expiry extension even when the product key holder re-signs the mutated challenge.
- A session result is product-client and bundle limited. Cross-App session reuse fails.
- Wallet signs only the account-side approval. Product device private keys stay in their product; Wallet private keys and recovery material are never returned.

## Central verifier and registry interface

- Exact runnable contract: `packages/wallet-auth/CENTRAL_INTEGRATION.md`.
- Registry v2 fields are exactly `schemaVersion`, `productClientId`, `requestingProduct`, `bundleId`, `callbacks`, `scopes`, `maxScopes`, and `productDeviceAlgorithms`. The local Wallet uses this same parsed v2 entry rather than a second ad-hoc registry shape.
- `migrateCentralRegistryEntry` converts the exact legacy single-callback v1 entry to v2 and is idempotent for v2. Unknown migration fields, unsupported algorithms, unsorted lists and invalid limits fail closed.
- Central Gateway calls `verifyCentralWalletSession({registryEntry, authorizationRequest, walletApproval, gatewayCompletion}, now)`. That single call verifies registry/request, Wallet secp256k1 approval and account derivation, then the P-256 product-device completion; it returns versioned, request-digest-bound product session claims.
- The integrated verifier also requires the Wallet approval issue time to fall inside the authorization request and verification clock-skew window; early or future approvals fail closed even when correctly signed.
- Before each use, Gateway calls `assertCentralWalletSessionActive(session, {revokedSessionBindings, revokedRequestDigests}, now)`. The first list revokes one session; the second revokes every session derived from a Wallet approval. Expiry and revocation are mandatory fail-closed checks.

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

The runtime provider is injected through the product Gateway session contract; there is no embedded provider secret or canned success. Its interface contains request metadata only and sends that selected context in an authenticated POST JSON body, never a URL query. It cannot receive a Wallet key or recovery material, sign, approve, send a transaction, alter permissions or bypass biometrics.

## Validation output

- `packages/wallet-auth`: `npm test` — 21 tests passed. Covers parser, Android/iOS deep links, exact request/callback/challenge/completion schemas, canonical P-256 vector, central registry v1-to-v2 migration, integrated central verifier, approval issue-time bounds, session/approval revocation, expiry, product/callback/bundle substitution, scope escalation/reorder/substitution, deterministic Wallet signer vector, tamper, callback interception, replay and cross-App session reuse.
- `apps/wallet`: `npm run typecheck` — passed.
- `apps/wallet`: `npm test` — 20 tests passed. Covers accessibility, 12-locale completeness/persistence/RTL/formatting/layout bounds, independent AI output language, authenticated POST-body AI transport, AI success/cancel/unavailable/retry/audit, persistent authorization intent/reject/revoke audit and tamper, replay persistence/tamper, restart locking, account switching, create/import, storage migration, deterministic restart, offline replacement-device recovery and storage tamper.
- `apps/wallet`: `npm run product-check` — passed for independent IDs, network/asset identity, bounded authorization UI, audit/revocation, twelve locales, route isolation and accessibility labels.
- Android Hermes export — passed, 4,384,114 bytes.
- iOS Hermes export — passed, 4,378,423 bytes.
- Android native `assembleRelease` with SDK 36 / Java 17 — passed, 352 Gradle tasks, 77,983,526-byte APK.
- Android Social proof harness `assembleDebug` — passed, 31 Gradle tasks, 3,296,249-byte APK, including Bouncy Castle primitives used only to equivalently verify the Wallet secp256k1 approval inside the proof product.
- Committed Android emulator cold-launch evidence from the P-256 correction run — `LaunchState: COLD`, `TotalTime: 450 ms`; persisted account opened locked and required biometrics.
- Android emulator cross-App proof was reproduced after correction. Separate `com.ynxweb4.social` launched `com.ynxweb4.wallet`; Wallet displayed the bound request and the user approved with an enrolled emulator fingerprint. Before nonce consumption, Social recomputed the request digest, checked every response binding and scope, verified the Wallet compact secp256k1 signature, and derived/checked the `ynx1` account from the approval public key. It then created the exact shared challenge schema and signing domain, signed with a non-exportable Android Keystore P-256 key, and ran an equivalent verifier over algorithm, compressed SEC1 key, bindings, scopes, approval-bounded lifetime and DER signature. Only then did it display a product-limited `ynx-social-v1` session. Exact verified callback replay was rejected from persistent product storage.
- The current return-work APK installed successfully on API 36 `emulator-5554`. A force-stop followed by exact MainActivity launch returned `Status: ok`, `LaunchState: COLD`, `TotalTime: 27602 ms`, `WaitTime: 28807 ms`, and `topResumedActivity=com.ynxweb4.wallet/.MainActivity`. The overloaded emulator then raised unrelated Digital Wellbeing and System UI ANR dialogs, so this run records the command evidence but does not claim a clean refreshed post-launch screenshot or cross-App interaction; the prior committed authorization, Gateway session and replay screenshots remain the latest clean cross-App evidence.
- iOS native project and bundle ID/deep-link configuration remain present; `Info.plist`, Expo.plist, entitlements and workspace plist pass `plutil -lint`, and the iOS Hermes export passes. A native Simulator/IPA build still cannot run because this host exposes only `/Library/Developer/CommandLineTools`; `xcodebuild` requires full Xcode, `simctl` is absent, and CocoaPods is not installed. Simulator/Xcode evidence is therefore pending, not claimed.
- No Go file changed, so `go test ./...` was not required by this task.

## Artifact hashes

Artifacts are local build outputs and intentionally ignored; reproducible evidence screenshots are committed.

- Android test-signed release APK `apps/wallet/android/app/build/outputs/apk/release/app-release.apk`: `74444a519d81d426986e7cdf0f80dc0d1f5fb35fffd73da0655a0c7d64509da6`
- Social proof APK `apps/wallet/proof/social-harness/app/build/outputs/apk/debug/app-debug.apk`: `8234bdb7fed6694d03e91888b4843024f5becab5b27a116eef1a200061660bae`
- Android Hermes bundle: `ad83d43fffaa82687b1e2dd9217b2d89099d3b5854f0a482f87260f90fa56a00`
- iOS Hermes bundle: `13eb1c5f06211c064bb7af4131e43127d1c8e47ca6d2295ecb38e6f120acb020`
- Cold-launch proof: `811341e9a21d34c671168775a3466ee796e208b4e335ea95e9198d76efd2e18c`
- Authorization proof: `44189c275db96e1e1fd276895e7d15f4d15ceb11271b5229ebf24a0fd809d7cc`
- Product-session proof: `5fd5334ad3f4d06051a4eee43e05cf66e6b092e3181980125ed2ae2ddca7dd76`
- Replay-rejected proof: `207ed99095ed77d9274dfad6159fe5f29ee6ec027a96a20759f0d6c63052c7ce`

## Incomplete items and integration requests

1. Central registry: apply the exact v2 entry in `packages/wallet-auth/CENTRAL_INTEGRATION.md` for Wallet `com.ynxweb4.wallet` and the reviewed Social client/bundle/callback/scope allow-list. This branch supplies code and migration tests but does not claim central registry deployment.
2. Central Gateway: use `verifyCentralWalletSession` and `assertCentralWalletSessionActive`, persist approval-digest revocation tombstones, and make challenge/replay consume plus session write transactional. Do not call only the lower-level device verifier or fork the canonical signing domains.
3. Social: the currently installed parallel Social build observed on the emulator used package `com.ynx.social` and a legacy query-field authorization URL. It was correctly rejected by this strict Wallet. Social must adopt the canonical `request=<base64url JSON>` envelope and registry identity before integration.
4. AI Gateway runtime: inject an authenticated Wallet product session, provider base URL, approved model policy and authoritative usage/fee estimate. The UI fails honestly as unavailable until this exists.
5. Release engineering: provide Android production signing, Apple signing/provisioning, full Xcode/CocoaPods CI, physical-device biometric checks, an IPA/archive, store metadata and distribution endpoints.
6. Security hardening: commission an external audit, add native non-exportable signing where compatible, add device-integrity policy, backup UX localization and a recovery drill before any mainnet claim.
7. Revocation transport: Wallet now creates a biometric, persistent approval-digest revocation record. Central Gateway must provide the authenticated sync endpoint and retry contract before cross-device revocation can be claimed online; until then the UI record is a local revocation intent and central verification tests prove the required enforcement semantics.
