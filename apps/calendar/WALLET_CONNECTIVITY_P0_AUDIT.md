# Calendar Wallet connectivity — P0 audit

Source baseline: `ab2db4a4c07dc153fc10a42686ef7cdad6715820`

## Current behavior

- Web guest trial is real and local-only. It creates no Wallet account, Product Session, shared data, AI request, or chain write.
- The Web `Sign in with YNX Wallet` action now consumes byte-identical browser-safe modules from accepted DApp Connect SDK source `315897e75c0ffe3e63435fe73cfec42244b851cc`. It discovers EIP-6963 providers, prefers YNX Wallet, permits an explicit standard injected-Wallet fallback, requests a `0x...` account, and verifies YNX Testnet `0x1917`.
- If no provider exists, the UI exposes fixed HTTPS choices for the official YNX Wallet download and MetaMask. The user can still enter the device-only guest trial.
- A Standard Wallet connection does not create a Calendar server session. The private service remains `PRIVATE_SERVICE_DEGRADED` until the accepted Product Session v2 successor is actually deployed and Calendar completes its separate migration.
- P0-075 directly rendered both an approved and rejected deterministic EIP-6963
  provider flow in Google Chrome. Approval showed the exact `0x...` account
  boundary on YNX Testnet while private sync remained unavailable; rejection
  created neither an account view nor a Calendar session. This proves the
  source path, not an installed YNX Wallet or public provider lifecycle.
- Android and iOS construct the registered `ynx-calendar-v1` authorization envelope and return through `ynxcalendar://wallet-auth/callback`.
- The server completes private Calendar authentication through the legacy `/v1/wallet/sessions/complete` verifier. A missing or rejected verifier fails closed and creates no Calendar session.

## Required migration

1. Prove a real installed YNX Wallet or standard EVM extension approval,
   account/chain change, rejection and disconnect lifecycle. The deterministic
   Chrome provider evidence must not be relabeled as installed-Wallet success.
2. Replace the legacy Calendar `/v1/wallet/sessions/complete` path with the accepted Product Session v2 root factory only after the Gateway successor is deployed and its endpoint manifest is accepted.
3. Persist the pending callback request across cold start, bind it to the exact product/client/platform/application/callback/device/scopes tuple, and reject replay, expiry, wrong bundle, wrong device and scope widening.
4. Provide visible installed Android/iOS evidence for approve, reject, timeout, revoke, second launch and network retry. Web success cannot stand in for an installed client.

## Truth boundary

The Standard Wallet source path, deterministic approval and rejection UI, and
guest fallback are browser-verified. No real installed provider account was
approved. Therefore `standardWalletConnected=false`, `productSessionV2=false`,
`installedApprovalVerified=false`, `deployedPublic=false`,
`publicVerified=false`, and `computerControlVerified=false` remain unchanged.
