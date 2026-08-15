# YNX Wallet macOS engineering download handoff

Website Owner may list this exact public asset only as a **Testnet engineering preview**:

- Download: `https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-macos-native-ad-hoc-a5a563b1/YNX-Wallet-macOS-ad-hoc.zip`
- Source/implementation commit: `a5a563b1d1d4563dccf26142130a2f41a60925e3`
- Bytes: `220324`
- SHA-256: `dab37d037ae5fe78e8bec509a5b5fc435e310e25e55f709e2bf0f5caad1938e3`
- Minimum OS: macOS 13.0
- Architectures: x86_64 and arm64; hosted runtime launch evidence is arm64 only
- Bundle ID: `com.ynxweb4.wallet.macos`
- Signing: ad-hoc; TeamIdentifier not set
- Not Developer ID signed, not notarized, not App Store, not production signed

The anonymous public URL returned HTTP 200 with all 220324 bytes, the exact SHA-256 above, and a clean ZIP integrity check. Hosted run `31857537620` installed and cold-launched the app, launched it a second time, verified native Keychain round-trip, RPC chain ID `0x1917`, REST health HTTP 200, malformed callback fail-closed behavior, and an enabled canonical registry request rejected visibly with `CANONICAL_AUTH_BRIDGE_UNAVAILABLE`.

Do not describe this asset as authorization-complete. It has no account, authorization, signing, send, successful callback, recovery, or physical-biometric proof. The Core associated-domain contract is still not frozen, so do not add an AASA appID, associated-domain entitlement, or Universal Link success claim.

Until Website Owner publishes and directly backreads the official page, keep `officialWebsiteDownloadListed`, product-level `public`, and product-level `downloadHosted` false. The machine-readable source of truth is `release/integration/wallet-macos-engineering-public-download-evidence-2026-08-15.json`.
