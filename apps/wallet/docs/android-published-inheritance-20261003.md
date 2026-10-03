# Android published-source transport and receipt inheritance

Owned predecessor: `475cc9224dd68d729e6c607766f2d9876a3950ce`.
Published Android input: `a9fff0d84fe0e4b67a520136ab9c8d4721f6c23e`, 1.0.28/code 34 in A's platform baseline. The website owner's exact mapping is retained in `/Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/website-redesign/wallet-public-version-map-20261003/EXACT_PLATFORM_MAP.md`; its download digest is publisher-declared, not freshly verified here.

## Normal product changes

The Faucet factory inherits the published Expo `requireOptionalNativeModule` platform resolver. It retains the stronger owned primary/legacy route binding and native foreground/task guards. New compiled bridges expose `productionEnabled` and `routeContractVersion: 2`; JavaScript requires both and the exact bridge methods. An older single-route binary cannot be called with the new route signature. Missing/disabled modules stay unavailable with no Fetch fallback. A fresh native package is required, not an OTA-only JS update; these interface constants do not prove public or device acceptance.

Faucet receipt validation now accepts the published embedded `ynxNativeTransaction` identity in addition to existing original and separate-identity forms. All projected system addresses are recomputed from the exact native Faucet identity. Recipient, native amount, zero fee, accepted nonce, chain durability/block binding and identity-projection metadata remain independently checked. Duplicate identity locations, substitutions and extra native fields fail closed. The retained receipt uses the established four-field native transaction representation and original system identity after wire verification, so old journals remain readable without migration or changed request IDs.

The actual `FaucetFlow` journey is tested through review, submit, published-format durable check, close/reopen, mandatory fresh original-hash recheck and completion. It retains one original body/request ID, one POST, no journal deletion and no fabricated balance confirmation.

The Native chain client inherits the published three-attempt bounded RPC read recovery, typed final unavailable state, timeout, fresh request ID and same-origin validation. It does not alter transfer broadcasting: a lost write remains unknown under its exact original signed bytes/hash and is attempted only once. Invalid IDs, wrong chain, redirects and malformed receipts are not transport-retried. Each timed-out/finished RPC attempt is fenced before response-body reads and after body completion; a late old response cannot replace the current result or keep processing a retired attempt. Existing account read cancellation and stored-origin recovery remain intact.

## Current verification

Independent source/dependency test directory: `/tmp/ynx-wallet-android-inheritance-clean-test-20261003-1ZEdhW/apps/wallet`.

- TypeScript: `android-inheritance-typecheck.log`, exit 0.
- Full Native suite: `android-inheritance-native-regression.log`, 870/870, exit 0.
- Native module factory: `android-inheritance-native-module-regression.log`, 4/4, exit 0.
- Real Android Expo module Kotlin compilation: `android-inheritance-native-compile.log`, `:ynx-faucet-transport:compileDebugKotlin`, offline, successful. Java 17 and existing Android SDK/cached dependencies; no installer produced.
- Android engine unit tests: `android-inheritance-native-unit.log`, `:ynx-faucet-transport:testDebugUnitTest`, 18 tests, no failures/errors/skips. No device or Wallet profile operation.
- macOS Foundation bridge: `/tmp/ynx-wallet-ios-inherited-final-bridge-20261003-RKXSDv/result.json`, 14 cases and all loopback wire checks pass.
- macOS Foundation engine: `/tmp/ynx-wallet-ios-inherited-final-host-20261003-8uTcq7/result.json`, 36 cases and all loopback wire checks pass. Neither harness compiles Expo/UIKit or proves iOS installation.
- Android Hermes export: `dist-android-published-inheritance/_expo/static/js/android/index-f4d18ae0d9c1b0e75441d2fdce34a5f7.hbc`, SHA-256 `85374af60b59a89777e0f9a047f2e9ccfcc8ca20936881d53be34176f717d494`.
- iOS Hermes export: `dist-ios-published-inheritance/_expo/static/js/ios/index-21af44b4e7ab26fb2a2c1da5a50f6700.hbc`, SHA-256 `3ffa2eb8bb091bd970141407fdb4192f5e1672538e64a80800cc49bb6db111c9`.

Both exports succeeded; dependency export/deprecation warnings are retained in logs, not suppressed. Native/JS compilation and synthetic unit/loopback journeys do not establish public user business completion.

## Remaining full-product gates

This batch is not full Android published-baseline inheritance or a formal release. Published account/session/recovery/layout deltas still need explicit integration/real UI comparison. Current owned release metadata is still older than public code 34; A alone must compose the actual complete source, retain upgrade certificate/package/account data continuity, choose real forward release metadata, build/sign the package and synchronize catalog/manifests/About. Never publish the old owned metadata or fake-bump it as proof of inheritance.

Shared Auth/SDK/Host/registry, App.tsx, startup assets, formal versions, signing, website and existing user/QA profiles were not modified in this batch. The protected A-issued SDK remains the compatible 955 source. Desktop full Pay review/sign/original journal/one-broadcast/readback/settlement/history integration and A's real authority/business ports remain required. iOS actual native build/device acceptance, final website download/install/upgrade journeys and MONSTER are not verified here. Preserve all prior frozen artifacts and unknown originals.
