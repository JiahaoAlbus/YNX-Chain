# YNX Card product service

`ynx-card-productd` is the server-side domain service for the independent YNX
Card Testnet Preview. It is provider-neutral and starts fail-closed in
`unavailable` issuer mode. `sandbox` mode produces only `issued_sandbox` cards
on the explicit `YNX Testnet Sandbox` network; it does not claim a BIN, fiat
balance, spendability, card-network relationship, Apple Pay, or Google Pay.

The service persists only opaque `providerCardId`, provider name, sandbox
network, last four, expiry, status, controls, provider events, disputes and
hash-chained audit. PAN, CVV, PIN, magnetic-stripe data and raw KYC materials
are outside the schema and strict JSON decoding rejects them.

All user routes require a server-generated canonical Gateway assertion bound to
chain `ynx_6423-1`, product `ynx-card`, client `ynx-card-v1`, bundle
`com.ynxweb4.card`, callback `ynxcard://wallet-auth/callback`, exact scopes,
account, session, device key identity, request digest, method, path, body hash,
nonce, issued time and expiry. Replays, expiry, tamper, scope escalation and
cross-product reuse fail closed. The browser and mobile app never receive the
Gateway assertion key or provider key.

Provider events accept only authorization, reversal, clearing, decline and
refund. They are timestamped, HMAC-authenticated, replay-protected and mapped by
opaque provider card reference. AI decline/fee/support workflows are draft-only
and require explicit human review; they cannot mutate a card or financial event.
