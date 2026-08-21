# Finance P0-103 canonical Wallet authorization handoff

## Scope and source

- Owner scope: `apps/finance/**` only.
- Accepted dependency: `canonicalWalletAuthorize@1.0.0-p0.0` from Wallet/Auth source `46386ae8eeaa7633923ae762a5a9634b5eac98d9`.
- Contract SHA-256: `e572042f18c1e32dfe86da26ee2ab52f9372c9803eae3b492c26932e50251c03`.
- Vendored package: `apps/finance/mobile/vendor/ynx-chain-wallet-auth-1.0.0.tgz`, 71 files, 128859 bytes, SHA-256 `55abb0c23dfdcefc9c53d0d7682b0f01126384380f4f73122b87cb28b8fa0e97`.

## Consumer contract

- `apps/finance/mobile/src/wallet.ts` uses the package-root `encodeRequestDeepLink` to create the only Finance-launched Wallet authorization URL. Finance does not concatenate or open `ynxwallet://authorize` itself.
- The complete canonical request is protected under `ynx.finance.wallet-authorize.v1.pending` before external launch. The callback uses package-root `parseAuthorizationCallbackURL` against that exact request, then removes it so a replay does not become a session.
- A cold start restores protected pending metadata and processes `Linking.getInitialURL`; a callback without a matching protected request fails closed.
- `connectStandardWallet` remains an independent EIP-1193 flow. Canonical authorization and any Product Session failure are private-service states only and do not disconnect Standard Wallet.
- `verify:canonical-authorize` scans Finance TypeScript source and fails on naked or manually composed Finance Wallet authorization launchers.

## Verified source/build evidence

- `npm run typecheck`: passed.
- `npm test`: 11 passed, 0 failed, including canonical request-bearing route, approval, rejection, and mismatched-request tests.
- `node --test ../tests/contracts.test.mjs`: 3 passed, 0 failed.
- `npm run verify:canonical-authorize`: passed; 8 source files scanned with no naked/manual launcher.
- `npm run verify:endpoints`: passed against manifest hash `3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5`.
- `npm run bundle-check`: passed for Android and iOS exports.
- `./gradlew :app:assembleDebug` passed locally using JDK 17. Local debug APK SHA-256: `6430c61aa5e50c5dc50d11800abccae1d5d2943f0a88edf10ed396faf245a010` (155433678 bytes).

## Non-claims and remaining evidence

During the active P0-103 UTC lease, the existing `YNX_WALLET_FINAL` AVD was started twice (including a 1 GB temporary-memory retry) and existing `YNX_WALLET_101_QA` was started once as a controlled fallback. All three emulator processes exited before `sys.boot_completed`; the fallback briefly appeared in ADB but never booted. No AVD was created, wiped, or modified. The preserved local launch-log SHA-256 values are `fc3d30d5cc1e17611d9c58cba6c9eed72d5168016c43ae96e899bcc131ea2f13`, `6d978369865fdb5d35df100abe32cff7269b5954ac6a19d2b0731d7989036abb`, and `55a653ba7129ccf149d71fce19e7d0129a2f19314d4d4825640b4be2a811906f`.

Accordingly, the exact Finance debug APK was not installed and no Wallet presence, cold-start, approval, rejection, callback, revoke, or network-loss Retry claim is made. This is an emulator-runtime limitation, not evidence of a Finance or Wallet compatibility result. `migratedV2`, `publicVerified`, `publicDeployed`, `downloadHosted`, `productionSigned`, `storePublished`, and `productSessionActivated` remain `false`.

The local APK is a debug build only and must not be offered as a public download. The package is a source-pinned local consumer artifact, not an npm-public publication.

## Rollback

Revert the Finance checkpoint commit that adds this handoff. This restores the previous vendored Wallet/Auth package and does not mutate Wallet/Auth, Gateway, or central integration state. Do not force-push.

## Next authorized validation

With a connected Android emulator or device containing a real YNX Wallet, install the recorded APK, then capture a visible request page and approve/reject callback across both first launch and cold start. Verify network-loss Retry and revocation separately. Only after the three distinct proofs (runtime factory/builder use, public v2 route proof, visible installed/browser lifecycle) are directly recorded may Central consider a migrated flag.
