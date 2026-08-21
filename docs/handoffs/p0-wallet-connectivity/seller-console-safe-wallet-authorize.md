# Seller Console safe Wallet authorization handoff

Campaign: `P0-WALLET-CONNECTIVITY-2026-08`

Task: `P0-114`

Owner: `integration`

Seller Console no longer assigns `ynxwallet://authorize` to the browser's top-level location. The shared controlled launcher keeps Seller visible and, when no Wallet handler opens, renders direct `Download YNX Wallet` and `Use MetaMask` actions in the original page. MetaMask remains a standard EIP-1193/EIP-6963 connection and is never sent through the YNX custom scheme. Standard Wallet state and the English-first anonymous Seller preview remain independent from the optional private service.

Verification:

- Node tests: 10/10 passed.
- Production build: passed.
- Chromium flows: 3/3 passed, including unchanged top-level URL and visible recovery choices.
- `git diff --check`: passed.
- Wallet/Auth artifact SHA-256: `dd80cf3d8fda3b35b89ddae6f3848dc420358b9c10d1879ed33a33f567585acb`.
- Controlled fallback screenshot SHA-256: `8c94db06cb11dc584d953ad02be03c967450c82c67fbf1dcace59ff411db330b`.

The existing external Shop smoke remained honestly blocked because the local service at `127.0.0.1:8095` was not running. Public deployment, a real installed-Wallet approval/callback, Product Session v2, seller mutations and Computer Control remain false.
