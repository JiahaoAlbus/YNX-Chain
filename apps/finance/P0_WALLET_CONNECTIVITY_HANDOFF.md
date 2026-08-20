# Finance P0 Wallet Connectivity handoff

## Scope and provenance

- Recovery checkpoint: `69163f7d586ac63c2ba589ee586a5b3ac2478e75`
- Recovery donor: `codex/finance-public-truth-20260809@4279bb492c450938747cb61b8008a0041420a93f`
- Central scheduler checkpoint consumed before this change: `5c81dbfc7`
- Changed product scope: `apps/finance/**` only

## Consumer contract

- Wallet transport and error contract: `p0-wallet-connection-v1`
- DApp SDK: `@ynx/dapp-connect-sdk@0.1.0-p0.0`
- Local SDK tarball SHA-256: `4a3c47f017a6932015686f20adfd29990a8c317ffdbb3f6fc5c4c9f16be5bc53`
- Endpoint manifest: `1.0.0-p0.2`, Integration source `fa0ffd9bbbcc831438078be8e19cebff51b07e5e`
- Manifest payload SHA-256: `3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5`

Finance uses standard EIP-1193 connection only. It no longer creates a device P-256 key, starts a Wallet authorization callback, completes a Gateway challenge, emits a Product Session proof, or calls a Finance API while the manifest labels Finance `PENDING`. A successful wallet connection remains visible as standard connection; private services show `PRODUCT_SESSION_UNAVAILABLE`.

## Focused evidence

- `npm test --prefix apps/finance`: 8 passed.
- `npm run security --prefix apps/finance`: passed over 192 Finance text files.
- `npm run smoke --prefix apps/finance`: Finance frontend smoke passed. Go backend smoke was explicitly skipped because `internal/finance` is absent from the Finance-only recovery checkout.
- `npm run check --prefix apps/finance/mobile`: TypeScript, 7 mobile tests, manifest hash verification, Android and iOS Expo bundles passed.
- Android Release build: passed.
- Local candidate APK SHA-256: `5f1ca2dc0f7e92232661e7b2ff55e31dd4a844ad0da0a296b52ec22db92e3f86`.
- Candidate installed on `emulator-5560` after removing the old differently signed emulator-only Finance test package. Explicit cold start resolved `com.ynxweb4.finance/.MainActivity` in 303 ms and the app process remained foreground.

## Release-evidence checkpoint (2026-08-20)

Source checkpoint for the evidence build: `0bc77a9427261ca2113ab75d62c40e301598bf56` (`test(finance): add release evidence verification`). This source adds a reusable verifier that checks the exact bundled manifest, keeps all public release states false, rejects the removed Gateway/Product Session routes, and can bind a supplied APK to the declared SHA-256. It also adds a probe that reads endpoint health URLs exclusively from the accepted manifest and explicitly refuses to call the Finance product API while Finance remains `PENDING`.

- `npm test --prefix apps/finance`: 10 passed; `npm run security --prefix apps/finance`: passed over 196 Finance text files.
- `npm run check --prefix apps/finance/mobile`: TypeScript, 8 mobile tests, manifest integrity and Android/iOS bundle export passed.
- A direct manifest-driven probe on 2026-08-20 reached all eight declared non-product health routes (`rpc`, `evmRpc`, `rest`, `walletGateway`, `faucet`, `explorer`, `indexer`, `monitor`) with HTTP 200. This is endpoint-health evidence only. It made no Finance product API call and is not Finance public-release evidence.
- Android release build passed using the local SDK. The resulting candidate is 77,149,970 bytes with SHA-256 `d18771c498fb94c5a5893a5899686e62ce864c72a877bd9f9dde7695033025be`. `apksigner` verified APK Signature Scheme v2 only, using the local Android Debug certificate whose SHA-256 is `5bef19088fb2aaee0cc5dbc3b2fc68b292151abae5832c3ea8f181aee3e2a9bb`.
- The candidate installed over the exact package `com.ynxweb4.finance` on `emulator-5560` (version `1.2.0`, versionCode `3`) and cold-started into `com.ynxweb4.finance/.MainActivity` in 244 ms. The recorded installed-app screen is [`p0-finance-android-cold-start.png`](evidence/p0-finance-android-cold-start.png), SHA-256 `fa12f575693b85dfd5a39efdc79e28825490f936f6e30331c623a72420f42cb8`.
- The installed screen's real **Sign in with YNX Wallet** control was activated from its UI-tree bounds. It opened the installed `com.ynxweb4.wallet` application, which was locked. Returning to Finance restored its unconnected screen. Consequently, Wallet invocation is proved, but account authorization, a connected account, and any Finance Product Session are **not** proved. No Wallet unlock, signing, transaction, or Finance API call was attempted.

Reproduce the evidence locally from this source checkpoint with:

```bash
npm run verify:release-evidence --prefix apps/finance
npm run probe:connectivity --prefix apps/finance
cd apps/finance/mobile/android
ANDROID_HOME=<local-sdk> JAVA_HOME=<local-jbr> ./gradlew assembleRelease --no-daemon --console=plain
cd ../../..
npm run verify:release-evidence --prefix apps/finance -- --apk mobile/android/app/build/outputs/apk/release/app-release.apk
```

## Release boundary and next owner action

The APK is signed only with a local Android Debug certificate (v2 signature). It is a local Testnet candidate, not production-signed, hosted, publicly deployed, store released, or approved for website download. Wallet invocation is not equivalent to Wallet authorization, and neither is equivalent to a Finance Product Session. No Windows Finance installer exists in this product path; its download pipeline remains an Integration/desktop-release concern.

Integration must retain this truth boundary when registering a release: require a separately authorized production signing and hosting transaction, attach the candidate’s hash and source commit, and update the central website/download registry. Do not reintroduce legacy device-proof/Gateway routes as a rollback.

## Rollback

Revert the separate P0 migration commit only after Integration confirms rollback of the accepted SDK or endpoint manifest. The recovery checkpoint remains intact. Rollback must leave Finance’s public/private status fail-closed and must not restore the deleted legacy Wallet protocol implementation.
