# Native Product Session v2

`App.tsx` queues the cold-start URL until secure Wallet storage has loaded and sends cold and warm URLs to `src/protocol/productSessionController.ts`. The controller imports the reviewed `packages/wallet-auth/product-session-registry.json` through `src/protocol/registry.ts`; it accepts only the authoritative v2 `ynxwallet://authorize?request=...` envelope. Native requests must match the Wallet operating system. Web requests retain their registered HTTPS callback.

Each review binds product/client/platform/application, origin/callback, device key/ID, nonce/state, requested scopes, expiry and the selected public account. Approval requires an explicit button press and the existing system biometric authorization. Selection and expiry are checked after every asynchronous boundary. The secret returned from the existing OS secure-storage repository must derive the reviewed public account and public key before the authoritative SDK can sign. Account records and custody formats are unchanged.

Both approval and explicit rejection use `createProductSessionReturnURL`. A failed callback can retry only the already completed result; it cannot sign again or change approve to reject. Backgrounding, manual lock and account replacement/switch cancel pending work. Durable request/nonce/state hashes are consumed before secret access or callback dispatch, and remain effective on process restart until expiry. If Wallet exits after consumption but before delivery, the product must start a fresh request. No approval or product session is silently restored.

Historical authorization audit records remain readable under their existing storage schema. New records use the v2 request digest and canonical application identity. A local audit revocation is not a Gateway session revocation.

Validation commands from this directory:

```sh
npm ci
npm run check
cd android
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
```

Use Node 24, pinned npm 11.5.1, JDK 17 and a configured Android SDK for the native build. Debug APKs use the existing local Android debug signing configuration and require Metro. `:app:assembleRelease` embeds Hermes JavaScript and produces an unsigned APK when release signing is unconfigured. A copy signed with the existing local Android debug certificate is a QA candidate, not a production/store build. The unit tests use deterministic synthetic accounts and complete the real SDK v2 approval/challenge contract without network access.

Installed Android/iOS biometric and cold/warm callback acceptance remains a separate device test. This batch does not add WalletConnect, an EIP-1193 transport, Gateway inventory v2, protected iOS builds, relay evidence or store-release evidence.
