# YNX Wallet security boundaries

Status: implemented and tested locally on the Wallet branch. Central enforcement remains pending review and deployment.

## Assets and trust anchors

- Native account keys are secp256k1 scalars. The public identity is the derived `ynx1` address on `ynx_6423-1`; `0x` is never the default identity.
- Account secrets are separate device-only `WHEN_UNLOCKED_THIS_DEVICE_ONLY` secure-storage entries. Public labels and selection live in a strict versioned manifest.
- Product device keys are P-256 keys owned by each product. Wallet receives only the compressed public key and never the product device secret.
- Wallet approvals are compact secp256k1 signatures over exact canonical request bindings. Product sessions additionally require the product device P-256 proof.
- Recovery material is user-held offline. It is never sent to a Gateway, product, AI provider, log, clipboard by default, or callback.

## Local controls

- Process start and background transitions are locked. Unlock, import, approval, recovery access, revocation, and account deletion require system local authentication.
- New recovery material blocks screen capture and is persisted only after exact `BACKED UP` confirmation.
- Every stored secret is re-derived and matched to its public `ynx1` account on restart. Unknown fields, missing entries, mismatches, and hash-chain tamper fail closed.
- Multi-account selection cannot silently authorize: changing the selected account locks the Wallet again.
- Authorization intent, returned approval, rejection, and local revocation intent are separate immutable audit events without key material.
- AI security review receives only selected request metadata. Its interface cannot read a key, approve, sign, mutate scopes, or bypass local authentication.

## Protocol controls

The exact request binds version, nonce, chain, product, client, bundle, callback, P-256 device algorithm/key, scopes, purpose, issue time, and expiry. The Wallet approval additionally binds the native account/public key and request digest. The canonical central session additionally binds approval digest, device binding, session binding, and exact expiry.

All parsers reject missing/unknown fields, non-canonical encodings, unsorted/duplicate scopes, callback state, unsupported chains/algorithms, lifetime extension, and tuple substitution. Nonce, request digest, and Gateway challenge consumption plus session creation are a single reference lifecycle transition. Restart verifies consumed-record coverage and a hash-chained central audit.

Revocation is four-level: one session, every session from one approval, every session for one product device, and all account sessions issued at or before an account logout. Introspection binds the exact client, bundle, device key, and required scopes and rejects cross-App reuse.

## Explicit non-claims

- JavaScript must materialize the approved account scalar briefly to sign. This is not a claim of hardware-backed non-exportable chain signing.
- The local approval-revocation event is not synchronized until central Gateway provides the authenticated endpoint.
- The 25-product registry is a disabled candidate. It is not centrally reviewed, integrated, staged, or deployed.
- The Android APK is locally test-signed. No production keystore, Apple distribution identity, hosted download, store review, or release is claimed.
- Native sends query the authoritative balance/nonce, require a `ynx1` recipient, show the fixed fee, require strong biometrics, sign the exact Go-compatible canonical payload and accept only a strictly matching broadcast response. The public-testnet scalar-1 vector advanced from nonce 1 to nonce 2, proving the live path. This remains a software-held, local-testnet signing implementation rather than a hardware-backed production claim.

## Required production hardening

External cryptographic/mobile review, native non-exportable signing where chain-compatible, central durable transaction isolation, device integrity policy, production key custody, incident runbooks, authenticated revocation sync, physical-device biometric testing, and public privacy/accessibility review remain release gates.
