# Accounts

`user-operation.schema.json` publishes the version-1 Smart Account operation envelope for chain `ynx_6423-1`. The local native-module candidate supports owner Ed25519 and P-256 signatures, batched calls, exact-scope session keys, per-domain replay protection, bounded Paymaster sponsorship, immediate session revocation, and timelocked threshold guardian recovery.

The schema and `internal/assetauth` implementation are local candidates. They are not active ABCI state, do not expose a public Bundler, and do not prove a sponsored Testnet transaction.
