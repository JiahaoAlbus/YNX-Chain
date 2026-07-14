# YNX Browser Signer

`@ynx-chain/browser-signer` is the client-owned signing boundary for first-party YNX applications. It derives the native `ynx1...` identity from a secp256k1 account key, binds an Ed25519 device key, verifies App Gateway ownership challenges, and signs exact Square request bytes.

The package does not upload account or device private keys. `sealSignerVault` stores only PBKDF2-SHA256/AES-256-GCM ciphertext; `openSignerVault` returns in-memory byte arrays that the caller must clear with `zeroize` when locking. Session tokens remain memory-only inside `YNXSquareAppClient` and are never returned by its public status API.

This package is locally verified and unpublished. It is not a completed wallet, hardware-wallet integration, recovery service, custody system, browser extension, or independent security audit.
