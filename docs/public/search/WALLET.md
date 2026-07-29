# YNX Wallet

| Field | Value |
| --- | --- |
| Version | 1.0.0-candidate |
| Effective date | 2026-07-22 |
| Evidence source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Wallet candidate reviewed | `da82c8b07b72b615ccb24b86a2a7ac66ee85b4d8` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Canonical | `https://ynxweb4.com/wallet` |
| Title | YNX Wallet — Testnet Accounts, Signing and Product Permissions |
| Meta description | Learn the YNX Wallet Testnet trust model, transaction review, product-scoped approval, asset boundaries and current release status. |
| H1 | YNX Wallet |

## Direct answer

YNX Wallet is the intended user authority for YNX accounts, transaction review,
signing and product-scoped approval. It must not export a user seed or grant a
product arbitrary withdrawal, owner-change or wildcard permission.

## Account and signing boundary

The native transaction binds chain ID, sender, recipient, positive amount, exact
current fee, next nonce, compressed secp256k1 key and canonical signature. The
Wallet should show those fields before approval, recheck authoritative state,
require appropriate local authorization and track pending, committed, failed and
unknown outcomes.

Receiving should expose only public account/network information. Support, AI,
browser and application services never need a seed phrase or raw private key.

## Product approval

The target common protocol binds product, bundle, device, account, scope, expiry,
challenge, approval, session, introspection, revocation and audit. Replay,
tampering, wrong product/bundle/device, scope widening, expiry and revocation fail
closed. A product candidate is not centrally integrated merely because it vendors
or tests a protocol copy.

## Current status

Wallet/Auth candidate engineering and test evidence exists, including mobile and
protocol work. Production signing, complete central integration, native iOS and
physical-device proof, browser extension, independent audit and store release
require component-specific evidence. This page does not claim those states.

## User safety

- Use an isolated Testnet account.
- Verify chain ID 6423 and YNXT Testnet status.
- Never share seed/private keys.
- Reject unexpected product, scope, device or expiry.
- For unknown submission results, verify hash and nonce before retrying.
- Do not treat Testnet YNXT as money or guaranteed value.

## Evidence and related pages

Evidence: technical whitepaper, Wallet integration guide, product acceptance and
release-state records.

- [YNX Testnet Guide](/testnet)
- [What is YNXT?](/what-is-ynxt)
- [YNX Security](/security)
- [YNX Products](/products)
- [FAQ](/faq)

## Change log

- 1.0.0-candidate (2026-07-22): Initial authority, signing, approval, status and
  safety page.
