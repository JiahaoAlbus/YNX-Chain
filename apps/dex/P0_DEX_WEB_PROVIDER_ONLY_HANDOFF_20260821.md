# DEX Web provider-only Wallet handoff

DEX consumes `safeWalletAuthorizeLauncher@2.0.0-p0.0` from the vendored tarball SHA-256 `fe55665d3bf05f1288728dd3d0528e58bd0fc6dbee4d7ea3b962a14bed3427a4`.

The Web Connect YNX Wallet action performs EIP-6963/EIP-1193 provider discovery only. On an explicit user click, it calls `eth_requestAccounts` and adds/switches to `0x1917`; it never navigates to `ynxwallet://authorize`, opens a frame/window, creates a Product Session, or starts a DEX action. MetaMask remains a separate EIP-1193 route. No provider leaves the DEX page available with the official YNX Wallet download and MetaMask install actions.

## Provider connection-state repair — 2026-08-21

DEX consumes the accepted `98c6d5d784d212df8981a53b17118a511e246ad2` Provider Discovery connection reducer (commit tree `51a60a362d4ad5dd748bcdefb101f71b1d9e0cee`; Wallet/Auth package tree `69ba84eaef503932ba1b66f42a9caa0a125e0608`) from a hash-pinned DEX archive. It records connected only after selected provider, approved account, and provider `eth_chainId` `0x1917`; `eth_accounts` plus `eth_chainId` is the only refresh path. A direct browser RPC fetch is forbidden, and accepted CORS-safe degradation cannot clear a completed Standard Wallet state. DEX private authorization and all swap/liquidity/approval/action paths remain independently unavailable.

Tests/build and all false gates are recorded in [p0-dex-provider-connect-state-20260821.json](evidence/p0-dex-provider-connect-state-20260821.json).

Verification: 24/24 unit tests, v2 authorization scan, and production Vite build pass locally. Deployment, installed/browser provider connection, approval/callback, Product Session, swap/liquidity, public verification, ComputerControl, and `migratedV2` remain false pending direct evidence.
