# Pay Wallet Connectivity P0 checkpoint — 2026-08-21

Scope is `apps/pay/**` under lease
`P0-WALLET-CONNECTIVITY-2026-08-pay-source-build-install-20260820T191521Z`.

## Consumed contracts

- Wallet/Auth root-factory source: `203be5e108be468350591615a64d5d36ab87a8f1`.
- Wallet/Auth archive SHA-256: `8d0e8e35d8f387948d44666efdc6322e9b57968b5987728dffbddd11b54928eb`.
- DApp Connect SDK archive SHA-256: `4a3c47f017a6932015686f20adfd29990a8c317ffdbb3f6fc5c4c9f16be5bc53`.
- Bundled endpoint manifest identity: Integration `fa0ffd9bbbcc831438078be8e19cebff51b07e5e`, payload SHA-256 `3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5`.

`connectStandardWallet` is independent from the optional root-factory Product
Session. Missing provider, wrong chain, RPC, relay, Gateway, session and retired
client conditions are classified separately. A private-session failure yields
`PRIVATE_SERVICE_DEGRADED` and never clears Standard Wallet state. Pay's endpoint
is `PENDING` in the accepted manifest, so no Pay API, Gateway completion, local
device secret, callback payload or local Product Session fallback is used.

## Evidence boundary

- Type check, 13 focused tests, Android/iOS/Web Expo export and 2 web UI tests passed.
- Product-source release scan passed with test and accepted-manifest fixtures excluded.
- Android emulator `emulator-5560` was present. Native Gradle installation failed
  before APK creation because the local Android SDK has duplicate Android 36
  system-image package directories; there is no install, cold-start, screenshot
  or signed-package claim.
- No public deployment, hosted download, production signing, store release or
  migrated-v2 claim is made. Product Session runtime/public-v2/visible lifecycle
  evidence remains absent.

## Rollback

Revert this checkpoint. That restores the prior Pay source; it does not change
Wallet/Auth, Integration contracts, remote endpoints, on-device Wallet state or
any chain asset.
