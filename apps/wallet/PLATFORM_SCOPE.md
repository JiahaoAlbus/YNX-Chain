# Wallet platform scope

YNX Wallet is a self-custody identity, device, permission and signing root. Its custody runtime is delivered as native Android and iOS applications so account secrets can remain inside platform-protected storage and sensitive actions can be gated by device authentication.

## Applicable delivery surfaces

- Android native application: applicable and implemented as an engineering Testnet build.
- iOS native application: applicable and implemented as an unsigned Simulator engineering build; physical-device and production signing remain external.
- Shared Wallet/Auth SDK, protocol vectors and Gateway adapter: applicable for independent YNX products.
- Public `/wallet` micro-site: applicable only for documentation, status, support and truthful downloads. It must not host private-key custody or silently sign for users.

## Not currently applicable

- Browser-hosted private-key Wallet: not applicable because it would weaken the established native custody and device-key boundary. Browser products use product-scoped sessions and explicit native Wallet approval instead.
- macOS native companion: a minimal arm64 engineering application is now locally implemented and installed for launch, second-launch and fail-closed custom-URL verification. It deliberately exposes no custody, Keychain, biometric, signing, send, recovery, Gateway or callback-success claim until the frozen Core Wallet/Auth native bridge is integrated. The local bundle is ad-hoc signed, not Developer ID/notarized/store/production signed, and is not hosted.
- Windows custody application: not applicable to the current verified slice. Desktop YNX products consume the canonical Wallet/Auth protocol rather than embedding an unreviewed second custody implementation.

These exclusions do not waive Web documentation, accessibility, metadata, deep-link, SDK or cross-product integration requirements. Any future scope change must update the threat model, release record and full-goal coverage matrix before implementation.
