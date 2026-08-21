# Pay safe Wallet authorization launcher v2 handoff

Classification: `SOURCE_BUILD_LOCAL_BROWSER_CHECKPOINT_DEVICE_UNVERIFIED`.

This Pay-only follow-up consumes `safeWalletAuthorizeLauncher@2.0.0-p0.0`, source `f1ba5013` / evidence `64910748`, from the exact vendored tarball SHA-256 `fe55665d3bf05f1288728dd3d0528e58bd0fc6dbee4d7ea3b962a14bed3427a4`.

## Result

- Native Pay calls the accepted `launchCanonicalAuthorization` factory with `platform: 'android'`. It persists the fully validated pending request first, invokes `Linking.openURL` only after the package resolver reports the exact request-bearing target, and matches the callback to that persisted request.
- The accepted launcher release is v2; its canonical authorization payload validator is protocol version 1. Pay removed the local incompatible `version: '2'` plus `origin` object that this validator rejects rather than weakening its exact-field validation.
- The package root currently statically exports Node-only Gateway modules, which Expo cannot bundle. Pay imports only the exact packaged `canonical`, `protocol`, and v2 `authorize-launcher` modules, with small TypeScript declarations for their published runtime signatures. No protocol, URI encoder, launcher, or request validation was copied into Pay.
- Pay has no Web/extension authorization surface. The existing Web/PWA remains guest-only; native authorization is resolver-first. The scanner rejects bare/manual authorize URIs and Web iframe/window-open/top-level authorization navigation.
- Standard EIP-1193/EIP-6963 connectivity remains independent. Unsupported authorization leaves the product page available with launcher-supplied official YNX Wallet and MetaMask actions. Private-service degradation does not clear the standard wallet connection.

## Evidence

- Typecheck: pass.
- Unit tests: 15/15 pass.
- Authorization scanner: pass; 10 non-test Pay source files.
- Expo export: Android, iOS and Web pass. Bundle SHA-256 values and local Chrome screenshot hash are in `evidence/p0-pay-safe-launcher-v2-20260821.json`.
- Playwright Web/PWA: 2/2 pass on dedicated port 4175.
- Chrome visibly rendered the local guest shell at `http://127.0.0.1:4175/`; this did not execute authorization or payment and is not public deployment evidence.

## Truth and rollback

No APK installation, Wallet approval/rejection/callback, cold start, payment, Product Session, public deployment, hosted download, production signing, store release, or ComputerControl evidence exists. All associated gates including `migratedV2` remain `false`.

Rollback is a normal revert of this checkpoint after Integration review. Do not restore the rejected version-2 payload, root Node-only import, bare URI, Web custom-scheme navigation, direct Product Session call, or fabricated payment state.

## Provider connection-state repair — 2026-08-21

Pay now consumes the accepted Provider Discovery connection-state source `98c6d5d784d212df8981a53b17118a511e246ad2` through its own hash-pinned archive. It retains the accepted DApp Connect transport and uses the shared reducer as the sole state transition authority: a completed Standard Wallet requires a selected provider, a non-empty approved `0x` account, and the provider-reported `0x1917` chain.

Refresh is limited to prompt-free `eth_accounts` and `eth_chainId`. No browser RPC fetch can establish connection; the accepted CORS-safe RPC annotation may be DEGRADED without clearing CONNECTED or changing the independent private-service boundary. The full source/build truth, including the occupied-port Web E2E blocker, is in [p0-pay-provider-connect-state-20260821.json](evidence/p0-pay-provider-connect-state-20260821.json). No payment, install, account approval, callback, public deployment, hosted installer, signing, or store gate is promoted.
