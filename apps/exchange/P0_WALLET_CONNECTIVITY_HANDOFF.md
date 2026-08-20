# Exchange P0 Wallet Connectivity handoff

## Scope and provenance

- Baseline: `d4c5be1c74dfbcd67ad90d435720a8ca456ade79`
- Migration source checkpoint: `bea0f6084051d6af85ec4b9fc3d1e1e4402241ce`
- Changed product scope: `apps/exchange/**` only

## Consumer contract

- Wallet transport and error contract: `p0-wallet-connection-v1`
- DApp SDK: `@ynx/dapp-connect-sdk@0.1.0-p0.0`
- Local SDK tarball SHA-256: `4a3c47f017a6932015686f20adfd29990a8c317ffdbb3f6fc5c4c9f16be5bc53`
- Endpoint manifest: `1.0.0-p0.2`, Integration source `fa0ffd9bbbcc831438078be8e19cebff51b07e5e`
- Manifest payload SHA-256: `3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5`

Exchange mobile now uses `StandardWalletConnection` against a standard EIP-1193 provider and maps wallet errors through the accepted SDK. It creates no P-256 device material, callback authorization, Gateway challenge, Product Session proof, or Exchange API request while the manifest marks Exchange `PENDING`. The failure message for product services is rendered separately from the standard-wallet state.

The web shell is also fail-closed: it contains no `fetch` or `/api/` product route, and explains that standard Wallet connection and a Product Session are different. It is not a public Exchange release.

## Focused evidence

- `npm run check --prefix apps/exchange/mobile`: TypeScript, 8 mobile tests, 12-locale/RTL audit, and Android/iOS Expo export passed.
- `npm test --prefix apps/exchange`: product-scoped UI and release-evidence tests run together, independent of the caller's working directory.
- `npm run test:browser --prefix apps/exchange`: 2 desktop/mobile responsive browser tests passed.
- `node --test apps/exchange/tests/release-evidence.test.mjs`: passed.
- `npm run verify:release-evidence --prefix apps/exchange -- --apk mobile/android/app/build/outputs/apk/release/app-release.apk`: binds the exact accepted manifest and APK hash while rejecting direct product routes and public-release claims.
- Android release build used the local SDK and produced a 29,429,971-byte candidate with SHA-256 `0c5940a4835fb9e141fb51c1f7f9a0cb795d0eb677c6ceae2adb81e45e9efc48`. `apksigner` verified a v2 signature with only the local Android Debug certificate (SHA-256 `10ef77996b2f13f716acea499f674b64abd104ae76929eef6bb52187370755e8`).
- The candidate installed over `com.ynxweb4.exchange` on `emulator-5560` and cold-started into `com.ynxweb4.exchange/.MainActivity` in 840 ms. The screen showed `API_UNAVAILABLE: Exchange product API is PENDING ... No request was sent.` The recorded screen is [`p0-exchange-android-cold-start.png`](evidence/p0-exchange-android-cold-start.png), SHA-256 `def2a75eaf84fc5fa37973924e8f23c8748a8021fff7983e6b84cedf04fc4ee2`.
- The installed **Sign in with YNX Wallet** control was activated using UI-tree coordinates. The installed Wallet was actually opened and reported `WALLET LOCKED`; no credentials were entered. Therefore invocation is proved, but account authorization, connected account, and Product Session are not proved. No signing, order, or Exchange API request was attempted.

## Release boundary and next owner action

This is a local Testnet candidate only. It is not production-signed, hosted for download, publicly deployed, or store released. In particular, a Wallet invocation is not a wallet authorization, and a wallet authorization would still not prove an Exchange Product Session. A Windows installer is not produced by this mobile path; website/download registration remains central Integration and desktop-release work.

Integration must separately authorize production signing and hosting, attach this APK hash and source checkpoint, publish direct Exchange product release evidence, then change the central manifest and release registry together. Do not treat a browser shell, endpoint health, or an installed local APK as public Exchange availability.

## Rollback

After Integration confirms the SDK or manifest rollback, revert `bea0f6084051d6af85ec4b9fc3d1e1e4402241ce` and the subsequent evidence commit. Do not restore the removed callback/Gateway/device-proof runtime, and keep all unproven release states false.
