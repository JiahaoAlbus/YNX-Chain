# Accounts

`user-operation.schema.json` publishes the version-1 Smart Account operation envelope for chain `ynx_6423-1`. The native-module candidate supports owner Ed25519 and P-256 signatures, batched calls, exact-scope session keys, per-domain replay protection, bounded Paymaster sponsorship, immediate session revocation, and timelocked threshold guardian recovery.

Application version 13 / committed-state v11 persists Smart Accounts, locked-budget Paymasters, and UserOperation receipts and exposes them through the branch-local BFT Gateway. `ynx-bundlerd` serializes its outer account nonce, signs only an already user-signed payload, and verifies committed Gateway evidence. Public Bundler deployment, a public sponsored Testnet transaction, on-chain guardian proposal lifecycle, WebAuthn RP/origin verification, and independent audit remain absent.
