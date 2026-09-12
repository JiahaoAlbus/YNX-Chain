# Card application verification consumer checkpoint

Wallet source: `ff5b7d49dd515d31d567c352dd049ac7b79d4139`.
Wallet tree: `92bc40205167e80edcf10a31ff83db0fab592d08`.

The Card backend entry now wraps accepted session authentication with the exact
Wallet Owner's Card verifier. A configured session adapter cannot override the
business-approval implementation. Complete persisted challenge, five application
details, current authenticated account, scope and expiry are required. The
sender binding is derived only after signature verification and persisted on
the card. Client/session-provided sender claims are ignored.

The unchanged verification-only bundle is 91073 bytes, SHA-256
`c07e6b1f0beab127187e60a9b7178c03850ac19eb45a2c068746c7be92ac7232`.
Its original 21-input manifest is preserved. No signing helper/private key is
introduced into the production Card adapter.

The Wallet Owner's public synthetic fixture is 2330 bytes, SHA-256
`8db36d9e90bf2b48c66880295ba99e3a74f9afa645df7d7c5428878f3b5183c7`.
It contains a signature from a public test identity, not a user account action.
Fixture tests exercise actual shared verification, changed context/signature,
high-S rejection, expiry, exact five details, scope, fixed implementation,
idempotent backend card creation, SQLite recovery, persisted derived sender,
and no credit when Core is unavailable. The production API has no fixture-state
injection route.

`attempt-01/results.json` records 39 passing backend tests and combined
client/server typecheck, with raw log hashes. This is source/local development
evidence. It is not browser/device E2E, accepted live Session verification,
deployment, real user approval, real ACTIVE card, or real YNXT funding evidence.

The raw native approval domain does not establish MetaMask personal_sign/EIP-712
approval support. Native review and return routing are separate Wallet work.
Unsigned rejection does not become an approval proof. Product Session migration,
real payments, PAN/CVV, real-world merchant processing, and Computer Control
remain false. The existing public alias and frozen native build are unchanged.
