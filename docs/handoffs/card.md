# YNX Card handoff

YNX Card is an independent Expo/React Native product in `apps/card` with service
code in `internal/cardproduct`. Its identity is `ynx-card`, client
`ynx-card-v1`, package `com.ynxweb4.card`, callback
`ynxcard://wallet-auth/callback` and network label `YNX Testnet Sandbox`.

The provider-neutral issuer adapter supports honest unavailable, pending,
rejected and deterministic Testnet sandbox modes. It stores only provider card
reference, network, last four, expiry, status and controls. PAN, CVV/CVC, PIN,
tracks and raw identity documents are rejected recursively at the mobile API
boundary and absent from state, audit, notification and AI schemas.

Implemented paths include application/eligibility, issue/activate/freeze/
unfreeze/close/replace, spend/online/international/ATM/MCC/country controls,
authorization/reversal/clearing/decline/refund provider events, replay-safe
provider signatures, notifications, disputes, tamper-evident audit and
review-only decline/fee/support AI drafts with explicit apply/reject review.
Provider and Gateway nonces survive restart. Store replacement is atomic and
HMAC protected.

The native app uses the canonical Wallet package, SecureStore, a second
biometric gate before revealing even safe details, 12 locales and Arabic RTL.
It does not claim a BIN, real issuer relationship, fiat balance, spendable card,
Apple Pay or Google Pay support.

Current verification at source commit
`bdd5ca02ad42b712db66a5173ecfad09340aa42c`: Card Go tests pass; 8/8
TypeScript tests pass; TypeScript checking passes; Android/iOS Hermes exports
pass; and the Card-local signing/secret/PAN scan passes. The Android native
release assembly command did not return a Gradle result because three MCP calls
failed with an upstream `502`; it is therefore unverified, not failed or passed.
The historical debug-signed APK hash is superseded and is not a current artifact.
No current APK install or post-build cold-launch proof exists, so
`installedLocal` remains false.

Central registry/proxy deployment, product API staging, current install proof,
visual matrix and hosted artifacts remain open. No release-complete claim is
made.
