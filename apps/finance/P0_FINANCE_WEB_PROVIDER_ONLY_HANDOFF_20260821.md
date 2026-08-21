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

## Android installer candidate — 2026-08-21

The current Finance source produced a local Android App Bundle, SHA-256 `ea919c537c2666df3e96e0bde7c80f574f39a12a520b4734cb67854d77757784` (51,717,204 bytes). A local universal APK validation output was derived from that bundle and its v2/v3 signature verified; it uses the Android Debug certificate and is therefore **not** production-signed or downloadable.

The universal APK installed successfully on the pre-existing `YNX_WALLET_101_QA` emulator as `com.ynxweb4.finance` v1.2.0. The emulator required its existing PIN immediately after reboot, so cold start and second launch were not attempted by guessing, changing, or bypassing that PIN. The visible locked-device capture and complete candidate metadata are in [p0-finance-android-aab-install-20260821.json](evidence/p0-finance-android-aab-install-20260821.json).

Finance currently has no verified hosted Android installer URL, macOS DMG, Windows EXE/MSIX, public deployment, or store release. It also contains no owner-scoped official ZIP installer claim. A future release must preserve the recorded AAB SHA, use a production signing workflow, prove install/cold start/second start/network on an authorized unlocked device, publish through an owner-authorized target, and verify the served bytes before restoring any official download link.

## Provider connection-state repair — 2026-08-21

Finance now consumes the accepted Wallet/App Gateway Provider Discovery repair (`98c6d5d784d212df8981a53b17118a511e246ad2`, complete source-commit tree `51a60a362d4ad5dd748bcdefb101f71b1d9e0cee`, Wallet/Auth package subtree `69ba84eaef503932ba1b66f42a9caa0a125e0608`, evidence `c3ab255c32bdeb9c8e056882c315f8ad43c29c7f`) from the hash-pinned Finance vendor archive. The Finance contract test now binds these as distinct identities, preventing the historical package-subtree value from being recorded as the source tree. The shared reducer is the sole state authority for the Web chooser lifecycle. A standard Wallet is connected only after one selected EIP-6963/EIP-1193 provider returns an approved `0x` account and `eth_chainId` reports `0x1917`.

The 4902 flow remains exact: switch, add only on 4902, re-switch, verify chain, then request accounts. Refresh uses `eth_accounts` plus `eth_chainId` without re-opening a chooser. Empty accounts, provider disconnect, wrong chain, and explicit disconnect invalidate the state. The Web code never calls a browser `fetch` to `rpc.ynxweb4.com/evm`; the accepted CORS-safe probe state can become DEGRADED without clearing a completed standard connection, reopening the chooser, or changing the optional Product Session's independent degraded boundary.

Finance tests include this transition directly and reject an unsafe direct-browser-RPC probe. Full source, package, test, and release truth are recorded in [p0-finance-provider-connect-state-20260821.json](evidence/p0-finance-provider-connect-state-20260821.json). There is no source-bound public runtime, real account approval, callback, chooser-close, refresh, disconnect, signature, or transaction evidence yet; all remain false.
