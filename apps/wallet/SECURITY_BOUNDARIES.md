# YNX Wallet security boundaries

Android Release builds do not inherit the debug signing key. Expo prebuild applies `plugins/withYnxAndroidReleaseSigning.js`; a Release is signed only when the external keystore path, alias, store password and key password are all present, while partial configuration fails during Gradle evaluation. Credentials stay outside the repository and must be supplied by the protected release process. Debug builds use the standard user-level Android debug keystore (or an explicit debug-only override) and are never production artifacts.

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
- Smart Account sponsorship evaluates an exact operation digest, EntryPoint, Product Session, anti-Sybil subject, target/selector allowlist and three nested budgets. Disabled, expired, mismatched or exhausted policies return zero approved cost.
- The on-chain Paymaster starts disabled. EIP-712 authorization binds the full operation core, Product, anti-Sybil subject, policy, sponsor type, target, authorization ID, cost cap and validity. Validation reserves worst-case cost atomically; postOp records observed cost without refunding the reservation. Risk Officer authority can disable a product or global sponsorship but cannot re-enable, withdraw funds, rotate signers or widen budgets.
- Quant mandates structurally prohibit withdrawals, owner changes, arbitrary transfers and unlimited approvals. Exchange authority is subaccount-only; DEX authority requires exact contract and method allowlists.
- Selective-disclosure candidates carry one bounded eligibility/classification result plus issuer, expiry, proof digest, status-list reference and audit ID. Raw identity-document fields are outside the accepted schema.
- Sensitive execution can be wrapped in a five-minute secp256k1 Signed Intent that binds Product Session, product/bundle/account, action, exact parameter digest, Evidence, Trust decision, human approval and AI explain-only metadata. Canonical export re-verifies the signature; execution checks expiry and the revoke digest set.

## Protocol controls

The exact request binds version, nonce, chain, product, client, bundle, callback, P-256 device algorithm/key, scopes, purpose, issue time, and expiry. The Wallet approval additionally binds the native account/public key and request digest. The canonical central session additionally binds approval digest, device binding, session binding, and exact expiry.

All parsers reject missing/unknown fields, non-canonical encodings, unsorted/duplicate scopes, callback state, unsupported chains/algorithms, lifetime extension, and tuple substitution. Nonce, request digest, and Gateway challenge consumption plus session creation are a single reference lifecycle transition. Restart verifies consumed-record coverage and a hash-chained central audit.

Revocation is four-level: one session, every session from one approval, every session for one product device, and all account sessions issued at or before an account logout. Introspection binds the exact client, bundle, device key, and required scopes and rejects cross-App reuse.

## Explicit non-claims

- JavaScript must materialize the approved account scalar briefly to sign. This is not a claim of hardware-backed non-exportable chain signing.
- The local approval-revocation event is not synchronized until central Gateway provides the authenticated endpoint.
- The 25-product registry is a disabled candidate. It is not centrally reviewed, integrated, staged, or deployed.
- The Android APK is locally test-signed and the iOS asset is an unsigned Simulator build. Both engineering artifacts are hosted with hashes; no production keystore, Apple distribution identity, store review, or production release is claimed.
- Native sends query the authoritative balance/nonce, require a `ynx1` recipient, show the fixed fee, require strong biometrics, sign the exact Go-compatible canonical payload and accept only a strictly matching broadcast response. The public-testnet scalar-1 vector advanced from nonce 1 to nonce 2, proving the live path. This remains a software-held, local-testnet signing implementation rather than a hardware-backed production claim.

## Required production hardening

External cryptographic/mobile review, native non-exportable signing where chain-compatible, central durable transaction isolation, deployed EntryPoint/Bundler/Paymaster contracts, installed-device passkey/Guardian drills, device integrity policy, production key custody, authenticated revocation sync, physical-device biometric testing, and public privacy/accessibility review remain release gates.
