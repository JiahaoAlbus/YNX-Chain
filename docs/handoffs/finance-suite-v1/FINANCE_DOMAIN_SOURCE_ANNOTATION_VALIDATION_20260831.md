# Finance-domain source annotation validation — source-only checkpoint

Date: 2026-08-31

## Purpose

Finance's `DomainSource` now emits bounded `coverage`, `syncStatus`, and
opaque `error` values.  The shared Finance-domain consumer validator now
validates those optional annotations when they are present.  This prevents a
consumer from silently accepting a free-form diagnostic, URL, object, or other
unbounded source metadata as provenance.

Accepted annotations are short semicolon-separated identifier labels.  The
Finance API emits only fixed codes such as `aggregated-partial` and
`pay-unavailable`; it must never use this field for upstream error text or
credentials.

## Exact source

- Commit: `13acd27e5586fe2b47a0220395ac3f4f3c42a3af`
- Tree: `1c6864b1efbe3b0956aff914e23b240efa0505ef`
- `packages/finance-domain/src/index.js`: blob
  `c324c9f04a77d71ecad7b80a2fdca7d33b866a9c`, 23,685 bytes, SHA-256
  `ca7432f96c53fcced5aabec93a6e93dc32bbf993d6be5adfa006bcb861837d21`
- `packages/finance-domain/src/index.d.ts`: blob
  `bdd839957b0075e3fef56a96161027dc1386dc61`, 4,237 bytes, SHA-256
  `1c9b9b5e3c623a64891d0a8e86af87ac4a2fd143a795cf15c8ceed642db23f2b`
- `packages/finance-domain/test/domain.test.mjs`: blob
  `b37888c64b442a6c01ecae7a972970d18479f822`, 14,613 bytes, SHA-256
  `b1a9fe32db76040bcf545498c0c8f798b2e0fc9b1c83edc9a017084997d09769`

## Verification and release truth

`npm test --prefix packages/finance-domain` passed 13/13 tests, including
positive bounded annotations and rejection of free-form error text, URLs, and
object-valued metadata.

This is source/test evidence only.  It makes no public deployment, installed
application, wallet-approval, signature, Testnet trade, or Product Session
claim.  Central runtime binding and product-specific public verification remain
required.
