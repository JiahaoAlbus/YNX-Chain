# Wallet Web mobile routing P0 handoff

Source `b9b7ce00054b3ed8d4f149b4471aab088d60c902` consumes Central endpoint/launcher commit `d0f89797d13c7667cc187b0c64d5c9e1cb1d8f59` and Core Web companion commit `39c80021b87730a20569b61f6ccd3f80092523c4` without defining another authorization protocol.

Mobile Chrome no longer treats an installed external wallet as an injected EIP-1193 provider. An injected provider is used only when it is actually announced or present. The mobile surface exposes the canonical YNX Wallet authorization choice, the official YNX Wallet download, and the official MetaMask mobile DApp link. Canonical YNX routes are checked for the exact `ynxwallet://authorize?request=...` shape before opening. Returning to external Chrome cannot create provider, account, signature, transaction, or session authority.

The PWA and both extension builds now consume `https://rpc.ynxweb4.com/evm` separately from `https://rest.ynxweb4.com`. Extension migration v3 removes the legacy `https://evm.ynxweb4.com/*` permission and retains only `https://rpc.ynxweb4.com/*`.

Local gates passed: 90 source tests, 76 package tests, three ZIP integrity checks, extension permission and migration gates, built mobile routing gate, and a visible 390x844 Pixel 9-sized fail-closed browser run. The exact artifact hashes and screenshot are in `release/integration/wallet-web-mobile-routing-p0-20260815.json`.

Public promotion remains prohibited. Public audit `b9d77a5b5c64c60ec62a96befb807252c0e701e9` shows that the deployed registry lacks the exact Web companion product, the callback is still the generic SPA runtime, the Wallet page CSP omits RPC/REST, Wallet-origin Product Session preflight is 403, and EVM preflight is 405. Do not broaden origin allowlists: deploy only the exact Core product/client/bundle/origin/callback binding, then rerun real mobile callback and RPC acceptance before changing any public boolean.
