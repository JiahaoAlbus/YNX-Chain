# P0-105 Exchange canonical Wallet authorization handoff

Classification: `SOURCE_BUILD_CHECKPOINT_DEVICE_EVIDENCE_PENDING`.

This Exchange-only checkpoint consumes `canonicalWalletAuthorize@1.0.0-p0.0` from Wallet/Auth source `46386ae8eeaa7633923ae762a5a9634b5eac98d9` (contract SHA-256 `e572042f18c1e32dfe86da26ee2ab52f9372c9803eae3b492c26932e50251c03`). It does not change Wallet/Auth, shared protocols, Finance, Pay, DEX, Quant, public deployment, or product endpoint status.

## Contract consumption

- `beginExchangeWalletAuthorization` builds its complete request with the package-root `encodeRequestDeepLink`; it never opens a bare or product-composed `ynxwallet://authorize` URL.
- The exact request is canonicalized and written to OS-protected storage before the external Wallet launch. `handleExchangeWalletReturn` parses the callback with package-root `parseAuthorizationCallbackURL` against that stored request before clearing it.
- The Exchange binding restricts the chain, product/client, bundle, callback, scopes and five-minute request lifetime. The request purpose explicitly states that it does not place an order, move assets, or create a Product Session.
- `connectMetaMaskWallet` only discovers an EIP-6963 provider or accepts a verified EIP-1193 MetaMask provider. It never calls a YNX Wallet route.
- Standard Wallet remains separate from optional private Product Session handling. A private failure is classified as `PRIVATE_SERVICE_DEGRADED` and cannot remove a Standard Wallet connection.

## Verification and artifacts

- Mobile typecheck: pass.
- Mobile tests: pass, 11/11; includes canonical request, rejection, callback matching and naked-route rejection.
- Localization check: pass, 12 locales / 59 keys / Arabic RTL.
- Source gate: pass, 7 Exchange source files scanned with no naked/manual Wallet authorization launcher.
- Mobile export check: pass for Android and iOS.
- Exchange release-evidence test: pass.
- Android Debug assemble: pass. The local-only Debug APK is SHA-256 `8d9c95b0fe908e818cb3bd64e1e9383feea2733023c970ba967d347bbc0d1aa7`, 155,458,696 bytes. It is not production signed, hosted, installed, or submitted to a store.
- The canonical Wallet/Auth tarball copied into the Exchange vendor dependency is SHA-256 `55abb0c23dfdcefc9c53d0d7682b0f01126384380f4f73122b87cb28b8fa0e97`.

## Truth gates and next evidence

`migratedV2`, Product Session activation, public verification/deployment, hosted download, production signing, store publication, order execution verification, browser-visible evidence, ComputerControl evidence, and Android installed/approve/reject/callback/cold-start evidence all remain `false`.

`adb devices -l` reported no connected device at this checkpoint, so no Exchange installation was attempted or claimed. A follow-up needs a bootable device or real product browser host plus a Wallet build compatible with the accepted canonical authorization contract. It must separately capture complete request content, approve and reject callback, app cold-start recovery, a second launch, network loss and Retry. The central endpoint manifest is still `PENDING`, so this source/build result is not public-runtime or real-order evidence.

## Rollback

Revert this single Exchange checkpoint commit after Integration approves the rollback. Do not restore a bare deep link, direct Gateway route, product-composed callback, legacy device proof, or self-hosted Product Session implementation. No force push is needed.
