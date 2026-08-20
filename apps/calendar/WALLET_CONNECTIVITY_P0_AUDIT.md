# Calendar Wallet connectivity — P0 audit

Source baseline: `ab2db4a4c07dc153fc10a42686ef7cdad6715820`

## Current behavior

- Web guest trial is real and local-only. It creates no Wallet account, Product Session, shared data, AI request, or chain write.
- The Web `Sign in with YNX Wallet` action currently only explains that callbacks require an installed Calendar client. It does not establish a Standard EVM connection and must not be reported as a working connect button.
- Android and iOS construct the registered `ynx-calendar-v1` authorization envelope and return through `ynxcalendar://wallet-auth/callback`.
- The server completes private Calendar authentication through the legacy `/v1/wallet/sessions/complete` verifier. A missing or rejected verifier fails closed and creates no Calendar session.

## Required migration

1. Add the accepted DApp Connect SDK as the single consumer implementation for EIP-1193, EIP-6963 and WalletConnect. Calendar must not copy a second provider implementation.
2. Keep Standard Wallet Connection independent from the Calendar private Product Session. Standard account/chain state must remain connected when the private Calendar service is degraded.
3. Replace the legacy Calendar `/v1/wallet/sessions/complete` path with the accepted Product Session v2 root factory only after the Gateway successor is deployed and its endpoint manifest is accepted.
4. Persist the pending callback request across cold start, bind it to the exact product/client/platform/application/callback/device/scopes tuple, and reject replay, expiry, wrong bundle, wrong device and scope widening.
5. Provide visible Web and installed Android/iOS evidence for approve, reject, timeout, revoke, second launch and network retry. Web success cannot stand in for an installed client.

## Truth boundary

`standardWalletConnected=false`, `productSessionV2=false`, `installedApprovalVerified=false`, `deployedPublic=false`, `publicVerified=false`, and `computerControlVerified=false` remain unchanged by this audit.

