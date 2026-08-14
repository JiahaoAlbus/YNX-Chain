# Wallet native public-download handoff

The exact macOS native engineering-preview release asset is reachable at:

`https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-macos-native-ad-hoc-9db0e241/YNX-Wallet-macOS-ad-hoc.zip`

Website may list it only with all of these visible facts:

- YNX Wallet macOS Testnet engineering preview
- macOS 13.0 or later
- Universal binary: x86_64 and arm64; runtime acceptance was performed only on arm64
- 114140 bytes
- SHA-256 `4762c10ac9583f632ba41eb5b19554366114cd6ce2adf4f85f211d0f0b264d7b`
- ad-hoc signed; not Developer ID signed, not notarized, not App Store, not production signed
- hosted CI install, cold launch, second launch, Keychain round trip, and malformed callback fail-closed evidence: run `31773884868`
- biometric recovery did not succeed; the runner had no available biometric policy and no recovery material was persisted

The official Website has not yet listed this asset, so the product-level `public` and `downloadHosted` gates remain false. At the audit time, `/wallet` redirected to `/dapp/wallet`, while `/.well-known/apple-app-site-association` returned the SPA HTML fallback rather than an AASA document. Core has not frozen an associated domain, so Website must not deploy an inferred AASA app identifier or claim Universal Link success. Keep `officialWebsiteDownloadListed`, `associatedDomainDeployed`, `universalLinkAccepted`, `developerIDSigned`, `notarized`, `productionSigned`, and `storeReleased` false until direct evidence exists.

The machine-readable source of truth is `release/integration/wallet-native-public-download-2026-08-14.json`.
