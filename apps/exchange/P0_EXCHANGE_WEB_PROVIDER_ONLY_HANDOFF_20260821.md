# Exchange Web provider-only successor

Exchange consumes the accepted `safeWalletAuthorizeLauncher@2.0.0-p0.0` source `f1ba5013` from the hash-pinned v2 launcher package (SHA-256 `fe55665d3bf05f1288728dd3d0528e58bd0fc6dbee4d7ea3b962a14bed3427a4`). Web imports only its browser-safe launcher module because the package root exports Node-only gateway modules.

Web uses EIP-6963/EIP-1193 discovery only. It never opens a custom scheme, iframe, window, or top-level navigation. No provider keeps the Exchange guest market visible and supplies official **Download YNX Wallet** and **Use MetaMask** routes. A standard Wallet connection creates no Exchange Product Session, API request, order, deposit, withdrawal, or trading authority.

The standard provider path now calls `wallet_switchEthereumChain` for `0x1917`; only EIP-1193 error `4902` triggers the explicit YNX Testnet `wallet_addEthereumChain` payload followed by a second switch. It then verifies `eth_chainId` before requesting accounts. This is a source/build control, not an account approval result.

Evidence: source gate and bundle passed; unit 9/9; local Chrome browser 3/3. The built browser artifact `web/wallet-connect.js` has SHA-256 `ee6662ecb73fe2562b2c3436124e948de206f371a2c8faf615c5f0713273c659`. [Fallback screenshot](evidence/p0-exchange-web-provider-fallback-20260821.png) SHA-256 `68df37c863bda4f3a7ffd6237b646e70861c890e88f22313d25f35e11c850d77`; it proves only the local no-provider fallback. `installedWallet`, `approval`, `callback`, `productSession`, `deployedPublic`, `computerControl`, and `migratedV2` remain false. Roll back through a normal revert; do not force-push.
