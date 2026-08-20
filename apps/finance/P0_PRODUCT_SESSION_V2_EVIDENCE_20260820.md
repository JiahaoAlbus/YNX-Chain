# Finance Product Session v2 evidence — 2026-08-20

Scope: `apps/finance/**` only. This checkpoint consumes Wallet/Auth source
`203be5e108be468350591615a64d5d36ab87a8f1` and router binding
`f74ef430d11111bf47aa047341faf38c10684277`; it does **not** claim an npm publication.

## 1. Runtime root-factory evidence

- Finance imports only `createProductWalletConnection` from the vendored 69-file,
  123903-byte `@ynx-chain/wallet-auth@1.0.0` package. Package SHA-256:
  `8d0e8e35d8f387948d44666efdc6322e9b57968b5987728dffbddd11b54928eb`.
- The Android bridge owns an Android Keystore `secp256r1` private key; JavaScript
  receives only the compressed public key and DER signatures. Standard EIP-1193
  connection stays separate from optional Product Session state.
- `npm test` passes 9/9, including a dynamic root-factory lifecycle vector.

## 2. Exact Gateway v2 evidence

- The dynamic lifecycle vector observes only:
  `https://wallet-auth.ynxweb4.com/v2/product-sessions/{challenge,complete,introspect,revoke}`.
- Direct public mount probe: `POST /v2/product-sessions/challenge` returned a
  controlled `400 UNKNOWN_OR_MISSING_FIELD`, `schemaVersion=2`, `stateCreated=false`.
  This proves mount/routing only; it is not a Finance session.

## 3. Installed visible evidence

- Local Android candidate SHA-256:
  `c830de2665d11d685b26f0c01dfd6ed5098cefba6f708d460a0993f5df0600f1`.
  It is signed by the local Android Debug certificate, not production signing.
- On `emulator-5560`, Finance first launch rendered the truthful unsigned state:
  `evidence/p0-finance-v2-first-launch-20260820.png`
  (`e2411f784a69e09c2f0c9d6d8b963e46542e1e57dd36ee83139eeea5e50bd182`).
- Finance's root-factory button opened installed `com.ynxweb4.wallet`. That Wallet
  rejected the authorization request with `Wallet authorization request fields do
  not match the protocol schema` while locked:
  `evidence/p0-finance-v2-wallet-rejection-20260820.png`
  (`2ad1f80253fe85d8758d65b8bcce08f3cf1c7311b9fd99e6d8a240378361274b`).

## Truth and remaining prerequisites

`migrated-v2=false`. No approved session, reject callback, timeout, revoke,
second-launch restore, network-loss retry, browser flow, hosted download, public
deployment, production signature, or store release is asserted. The next proof
requires an unlocked Wallet runtime that accepts the v2 registry schema and can
return the Finance callback; Finance must then exercise approval/rejection,
revoke, second launch and network recovery against that real runtime.
