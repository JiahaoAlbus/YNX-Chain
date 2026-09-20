# Finance endpoint authority 1.1 consumer handoff — 2026-09-20

Finance now consumes the shared authority merged at `98a5774ae229acd1a41f7647d95b858d31b73ad2`. The mobile package imports `@ynx-chain/sdk` directly from the repository workspace; it does not copy the shared validator, canonicalization, manifest, or bundle.

The Finance-owned pin binds manifest `1.1.0-weekly-v3.20260920.1` and payload SHA-256 `29f801933e9df4faea58531cb522cc34bfe1028628adfb88227f3d0cae1e4e73`. Runtime validation uses the shared stable recursive-key canonicalization and injects Expo Crypto SHA-256 on native platforms. Release validation uses the same shared validator and separately stored Finance pin.

Only the validated canonical endpoints are selectable:

- RPC and EVM RPC: `https://rpc-testnet.ynxweb4.com`
- Faucet: `https://faucet-testnet.ynxweb4.com`

The authority deliberately leaves Wallet Gateway and `products.finance` at `PENDING`. Accordingly, Finance Wallet start, callback completion, Product Session proof, private API access, and order submission fail closed with `PRIVATE_SERVICE_DEGRADED`. This does not disable the separate Web Standard Wallet connection or guest/public surfaces.

Android/iOS Expo bundles were produced locally as source-build evidence only. They are not installed, signed, hosted, or public releases. Exact hashes and all false gates are recorded in the paired JSON evidence.
