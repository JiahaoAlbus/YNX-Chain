# Wallet/Auth Public Endpoint and Mobile Discovery Contract

The authoritative machine-readable contract is `release/integration/wallet-auth-public-endpoint-service-discovery-matrix.json`. It freezes chain ID 6423 (`0x1917`), the canonical public URL set, direct availability/CORS/mobile facts, and fail-closed behavior. Missing evidence is `false`.

Mobile discovery has exactly three routes:

1. Injected EIP-1193/EIP-6963 is valid only in a desktop browser with an installed provider or a Wallet built-in browser.
2. External mobile browsers launch YNX Wallet with `ynxwallet://authorize?request=<base64url-canonical-authorization-request>` and require an exact registered HTTPS/app callback plus Product Session completion. Returning to Chrome does not create `window.ethereum`.
3. MetaMask mobile uses its DApp link to open the official Wallet page inside MetaMask's built-in browser, where an injected provider must then be observed.

Opening an app is never account, signing, sending, callback, or Testnet success. Until the requested operation completes with direct public mobile-visible evidence, every such boolean remains false.

The current public boundary is fail-closed: Website, Chain RPC/REST and Gateway services 6437/6439/6441 are reachable, but browser CORS is absent on both observed RPC hosts and Product Session v2 OPTIONS/CORS is absent. Faucet returns HTTP 502, Explorer has no current direct proof, the authoritative Wallet callback is not frozen, and clients split between `https://rpc.ynxweb4.com/evm` and `https://evm.ynxweb4.com`. Therefore mobile discovery, account, sign, send, aggregate public deployment and central integration remain false.
