# DEX Web provider-only Wallet handoff

DEX consumes `safeWalletAuthorizeLauncher@2.0.0-p0.0` from the vendored tarball SHA-256 `fe55665d3bf05f1288728dd3d0528e58bd0fc6dbee4d7ea3b962a14bed3427a4`.

The Web Connect YNX Wallet action performs EIP-6963/EIP-1193 provider discovery only. On an explicit user click, it calls `eth_requestAccounts` and adds/switches to `0x1917`; it never navigates to `ynxwallet://authorize`, opens a frame/window, creates a Product Session, or starts a DEX action. MetaMask remains a separate EIP-1193 route. No provider leaves the DEX page available with the official YNX Wallet download and MetaMask install actions.

Verification: 24/24 unit tests, v2 authorization scan, and production Vite build pass locally. Deployment, installed/browser provider connection, approval/callback, Product Session, swap/liquidity, public verification, ComputerControl, and `migratedV2` remain false pending direct evidence.
