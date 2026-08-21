# Search safe Wallet authorization handoff

Campaign: `P0-WALLET-CONNECTIVITY-2026-08`

Task: `P0-112`

Owner: `integration`

Search no longer assigns the returned `ynxwallet://authorize` target to the browser's top-level location. It decodes and validates the exact Search product identity, callback, scopes, nonce, device key and request lifetime, then passes the validated request to the shared controlled web launcher. A missing handler leaves Search visible and exposes the existing official YNX Wallet and MetaMask recovery choices.

Verification:

- Node tests: 21/21 passed.
- Production browser build: passed.
- Service smoke: passed.
- Chromium E2E: 8/8 passed, including guest Search preservation and deterministic standard-Wallet approve/reject boundaries.
- `git diff --check`: passed.
- Wallet/Auth artifact SHA-256: `dd80cf3d8fda3b35b89ddae6f3848dc420358b9c10d1879ed33a33f567585acb`.

Truth boundary: this checkpoint does not prove a public deployment, an installed Wallet handler, real approval/callback, Product Session v2, or Computer Control. Those fields remain false.
