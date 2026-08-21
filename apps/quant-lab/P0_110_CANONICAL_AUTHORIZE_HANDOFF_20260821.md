# P0-110 Quant canonical authorization checkpoint

## Scope and dependency

Central granted `apps/quant/**`; this baseline has no such directory. The established Quant product is `apps/quant-lab/**`, so this checkpoint changes that directory only. It consumes `canonicalWalletAuthorize@1.0.0-p0.0` and the accepted `safeWalletAuthorizeLauncher` source `4679de8e8d0675e2013254c92ff1935191f87c21` (tree `dd6df66c3a7c8c4b53fbdbdb18b52a3284b7a690`) as the vendored tarball SHA-256 `dd80cf3d8fda3b35b89ddae6f3848dc420358b9c10d1879ed33a33f567585acb`.

## Product behavior

- Quant creates a complete v2 request with fixed product identity, YNX chain, origin, callback, allowed scopes, nonce, issued/expiry, and a platform-provided P-256 public key.
- The request is persisted before the package-root controlled Web launcher is invoked. Quant neither concatenates a Wallet URI nor navigates the top-level page to a custom scheme.
- Callback handling loads the exact pending request and delegates approval/rejection validation to `parseAuthorizationCallbackURL`; missing, stale, mismatched, replayed, or tampered callbacks fail closed.
- MetaMask uses its independent EIP-1193 `eth_requestAccounts` route. A missing or degraded Product Session does not remove an existing standard Wallet connection.
- No protected device key is invented. Without a platform-proven public key, the YNX route remains `PRIVATE_SERVICE_DEGRADED`; `requireProof` remains fail-closed, so this checkpoint creates neither strategy authority nor an order.

## Tests and evidence

- `npm run verify:canonical-authorize`: pass; source scan rejects bare authorization targets, manual URI construction, top-level custom-scheme navigation, and legacy Product Session factory use.
- `npm test`: 6 passed, 0 failed; includes payload-bearing launch and tampered origin/callback/product/scope rejection.
- `npm run test:browser`: 4 passed, 0 failed. The local Chromium fallback capture is [p0-110-wallet-fallback-local-browser-visible.png](evidence/p0-110-wallet-fallback-local-browser-visible.png), SHA-256 `ed774f643b2daf44dc40f2adf703fb524ae51e45df32a7614d502a1037f8c4df`.
- `npm run build:wallet`: pass; `web/wallet-auth.js` SHA-256 `1d28dd22fcbf8eeff5ae3945d182a90ce5dbd358d23a1954d1e0aa85a6686745`.

The browser capture proves only truthful local fallback behavior with no protected device and no MetaMask provider. It does not prove Wallet installation, approval, rejection/callback, cold-start recovery, Product Session, strategy execution, public deployment, or ComputerControl.

## Strategy and execution boundary audit

Research, backtest, Paper, Testnet, risk, and kill-switch pages were retained. This slice did not enable capital execution, create a Product Session, submit a real order, or change the existing execution engine. The current `requireProof` fail-closed boundary means mandate and Testnet order forms cannot turn an authorization response into execution authority.

## Current gates and rollback

`installed=false`, `walletApprove=false`, `walletRejectCallback=false`, `coldStartCallback=false`, `privateProductSession=false`, `realCapitalExecution=false`, `realOrders=false`, `publicDeployment=false`, `computerControl=false`, and `migratedV2=false`.

Rollback is a normal fast-forward revert of this checkpoint on `codex/quant-owner-contract-snapshot`, restoring the previous tarball and source adapter. Do not force-push. Before promoting any gate, obtain separately reproducible installed Wallet approval/rejection/callback/cold-start evidence plus product-owned Gateway/session evidence.
