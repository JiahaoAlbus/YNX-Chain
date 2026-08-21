# Merchant Console safe Wallet authorization handoff

Campaign: `P0-WALLET-CONNECTIVITY-2026-08`

Task: `P0-113`

Owner: `integration`

Merchant Console no longer assigns a custom Wallet scheme to the browser's top-level location. Its product-bound authorization request is now v2 with the exact registered HTTPS origin, and the shared controlled launcher keeps the console visible when no handler is available. Standard EVM Wallet state and anonymous capability preview remain independent from the unavailable private App Gateway.

Verification:

- Node tests: 15/15 passed.
- Production build: passed.
- Chromium flows: 2/2 passed.
- `git diff --check`: passed.
- Wallet/Auth artifact SHA-256: `dd80cf3d8fda3b35b89ddae6f3848dc420358b9c10d1879ed33a33f567585acb`.

Truth boundary: public deployment, a real installed-Wallet approval/callback, Product Session v2, settlement and Computer Control remain false.
