# Exchange Web provider-only successor

Exchange consumes the accepted `safeWalletAuthorizeLauncher@2.0.0-p0.0` source `f1ba5013` from the hash-pinned v2 launcher package (SHA-256 `fe55665d3bf05f1288728dd3d0528e58bd0fc6dbee4d7ea3b962a14bed3427a4`). Web imports only its browser-safe launcher module because the package root exports Node-only gateway modules.

Web uses EIP-6963/EIP-1193 discovery only. It never opens a custom scheme, iframe, window, or top-level navigation. No provider keeps the Exchange guest market visible and supplies official **Download YNX Wallet** and **Use MetaMask** routes. A standard Wallet connection creates no Exchange Product Session, API request, order, deposit, withdrawal, or trading authority.

The standard provider path now calls `wallet_switchEthereumChain` for `0x1917`; only EIP-1193 error `4902` triggers the explicit YNX Testnet `wallet_addEthereumChain` payload followed by a second switch. It then verifies `eth_chainId` before requesting accounts. This is a source/build control, not an account approval result.

Evidence: source gate and bundle passed; unit 11/11 (including deterministic direct-switch and 4902 add/re-switch call sequences); local Chrome browser 3/3. The built browser artifact `web/wallet-connect.js` has SHA-256 `a26451965ba25ca510857dbcdb0d4838fe58f7cc96e103347e67795f884914fb`. [Fallback screenshot](evidence/p0-exchange-web-provider-fallback-20260821.png) SHA-256 `68df37c863bda4f3a7ffd6237b646e70861c890e88f22313d25f35e11c850d77`; it proves only the local no-provider fallback. `installedWallet`, `approval`, `callback`, `productSession`, `deployedPublic`, `computerControl`, and `migratedV2` remain false. Roll back through a normal revert; do not force-push.

## Public artifact preflight

[`p0-exchange-public-artifact-bd5edc66.json`](evidence/p0-exchange-public-artifact-bd5edc66.json) pins the no-secret four-file candidate archive from `bd5edc66` (12,233 bytes, SHA-256 `31c29f7e14fdb1e89c1054a89fb724254409bfcbfc2e5514aabf740821cd017f`) and the exact expected HTTP bytes/hashes. Read-only runtime capture found `https://exchange.ynxweb4.com/` served by Caddy with health commit `443286487e057d78cb6b1a686d14bb37be8b3c23`, while the live homepage remains the older 18,603-byte document and `/wallet-connect.js` falls back to it. The artifact is **not deployed**. A new Exchange-only deployment lease must bind that domain, this source/tree, archive hash, release writer, and a verified static rollback snapshot before any upload.
