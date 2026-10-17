# Wallet platform scope

YNX Wallet is a self-custody identity, device, permission and signing root. Its custody runtime is delivered as native Android and iOS applications so account secrets can remain inside platform-protected storage and sensitive actions can be gated by device authentication.

## Applicable delivery surfaces

- Android native application: applicable and implemented as an engineering Testnet build.
- iOS native application: applicable and implemented as an unsigned Simulator engineering build; physical-device and production signing remain external.
- Shared Wallet/Auth SDK, protocol vectors and Gateway adapter: applicable for independent YNX products.
- Public `/wallet` micro-site: applicable only for documentation, status, support and truthful downloads. It must not host private-key custody or silently sign for users.

## Not currently applicable

- Browser-hosted private-key Wallet: not applicable because it would weaken the established native custody and device-key boundary. Browser products use product-scoped sessions and explicit native Wallet approval instead.
- Separate macOS or Windows custody applications: not applicable to the current product architecture. Desktop YNX products consume the canonical Wallet/Auth protocol rather than embedding a second custody implementation. A future hardware/external-signer companion would require a separately reviewed product scope and threat model.

These exclusions do not waive Web documentation, accessibility, metadata, deep-link, SDK or cross-product integration requirements. Any future scope change must update the threat model, release record and full-goal coverage matrix before implementation.
