# Finance Web provider-only Wallet successor

## Scope

This Finance-only checkpoint replaces the obsolete Web custom-scheme/hidden-frame class with `safeWalletAuthorizeLauncher@2.0.0-p0.0`, accepted source `f1ba5013` and evidence `64910748`. The hash-pinned local package is `web/vendor/ynx-chain-wallet-auth-1.1.0-safe-launcher-v2.tgz` (SHA-256 `fe55665d3bf05f1288728dd3d0528e58bd0fc6dbee4d7ea3b962a14bed3427a4`).

The package root statically exports Node-only gateway modules and is not browser-bundleable. Finance therefore imports only that same vendored package's browser-safe `src/authorize-launcher.js`; this preserves the accepted v2 launcher rather than copying its protocol.

## Runtime contract

- Web calls the v2 `launchWebAuthorization` provider discovery path. It performs EIP-6963 discovery, then accepted injected EIP-1193 fallback; it never navigates a custom scheme.
- `eth_requestAccounts` and `eth_chainId` are requested only after a provider candidate is found. A non-YNX-Testnet chain fails closed; Finance does not request an arbitrary network switch.
- No provider leaves the user on Finance and visibly provides **Download YNX Wallet** and **Use MetaMask** links.
- A standard wallet connection is an unverified injected-provider connection only. It creates no Finance browser session, Product Session, API call, strategy authority, transaction, or balance claim.
- The native code remains separate from the Web transport; it has not been promoted by this browser-only checkpoint.

## Evidence

- `web` source verification and bundle build passed. Bundle SHA-256: `9074a96a14f831cf422e190656777214a23d3732307f2a6fb13c028dc702ed78`.
- Finance test suite: 11 passed, 0 failed. Security gate and release-evidence gate passed.
- Local browser at `http://127.0.0.1:4174/` showed the no-provider fallback while remaining on the Finance page. Screenshot: [p0-finance-web-provider-fallback-20260821.png](evidence/p0-finance-web-provider-fallback-20260821.png), SHA-256 `ca5c3d3ebf2c0d7ad66dcdb0552bdadba7df60720cccb7b65276d8abfd2170ad`.

## Deployment boundary

`https://finance.ynxweb4.com/` returned HTTP 200 during this checkpoint, but served an older Caddy response last modified on 2026-08-15. The local Vercel account is authenticated, but this worktree has no linked Finance project and `vercel inspect https://finance.ynxweb4.com` cannot resolve a corresponding deployment. No owner-safe canonical deployment target is proven, so no deploy was attempted.

All installed-wallet, approval, callback, Product Session, public-deployment, ComputerControl, and `migratedV2` gates remain false. Roll back with a normal `git revert` of this checkpoint; do not force-push.
