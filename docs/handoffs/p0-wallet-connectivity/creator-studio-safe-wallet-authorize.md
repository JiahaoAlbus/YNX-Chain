# Creator Studio safe Wallet authorization handoff

Campaign: `P0-WALLET-CONNECTIVITY-2026-08`

Task: `P0-111`

Owner: `integration`

Creator Studio now consumes the shared `@ynx-chain/wallet-auth` safe web launcher. The Connect action no longer assigns an `ynxwallet://authorize?...` URL to the top-level browser location, so an unavailable protocol handler cannot replace the product with a blank browser document. The canonical request is stored before launch, unsupported launch removes that pending request, and the existing official YNX Wallet and MetaMask recovery actions remain visible.

Verified locally:

- `npm run check`: 6/6 passed.
- `npm run build`: passed.
- `npm run smoke`: passed.
- `git diff --check`: passed.
- Vendored accepted Wallet/Auth artifact SHA-256: `dd80cf3d8fda3b35b89ddae6f3848dc420358b9c10d1879ed33a33f567585acb`.

Truth boundary: this is a source/build checkpoint. It does not prove production deployment, an installed Wallet approval screen, callback completion, Product Session v2, payout, or Computer Control. Those states remain false until separately evidenced against the published exact source.
