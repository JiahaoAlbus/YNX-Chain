# Native Finance order confidential transport v2 candidate

The v1 native Finance order approval signs an exact, bounded Sandbox order, but its launch and return URLs contain reversible Base64URL of the full order and signed proof. The v2 transport keeps the existing order signature semantics while moving all private material to authenticated HTTPS bodies and durable server storage. These helpers define strict message and URL schemas; they do not deploy the handoff service or change an existing installed Wallet.

## Launch and claim

Finance creates a fresh opaque ticket, stores a server-side ticket to exact existing v1 unsigned challenge mapping, and returns only a URL shaped like ynxwallet://finance-order-approval?ticket=TOKEN. Ticket entropy must be at least 256 random bits; the ticket expires with the challenge, at most 300 seconds, and is one-use. The URL never contains the order, Broker account, subject, or proof. A ticket alone cannot retrieve the order.

Wallet selects its native YNX account and signs YNX_FINANCE_ORDER_TICKET_CLAIM_V2, newline, and canonical JSON of a claim with action claim-order-review, origin https://finance.ynxweb4.com, chain 0x1917, account/public key, ticket hash, fresh nonce, and a lifetime at most 60 seconds. This is explicitly permission to fetch a review, not an order approval. Wallet POSTs ticket and signed claim to /api/broker/order-handoff/claim. Finance checks the account against the ticket's authoritative challenge, consumes claim nonce transactionally, and returns the exact existing v1 unsigned challenge over TLS with no-store. Wallet validates the complete challenge and selected account before display.

## Decision and return

Wallet signs the existing native v1 exact order approval, or signs a separate YNX_FINANCE_ORDER_REJECT_V2 decision bound to ticket hash, request/challenge IDs, order hash, and callback state hash. Unused approval revocation continues to use the exact native v1 revocation proof. Wallet POSTs the complete decision to /api/broker/order-handoff/complete. Finance atomically verifies source ticket, subject/session/account, challenge and decision, persists one result and its idempotency key, and returns an opaque one-time code plus the state whose SHA-256 equals the challenge callbackStateHash. Retrying a stored decision must return the same logical result or a fresh code for that result, never create a second order.

Wallet persists the signed proof and pending handoff state in its secure replay journal before HTTPS delivery. On network failure it keeps the pending result and retries without reopening a full-proof URL. Only after Finance acknowledges stored result does Wallet open https://finance.ynxweb4.com/wallet-auth/callback?financeOrderCode=CODE&state=STATE. The callback URL contains no signature, order, Broker account, or ticket. Finance Web exchanges the code by an authenticated POST to /api/broker/order-handoff/exchange under its current native Product Session v2; the server verifies and consumes code, request, state, subject, account, session and decision once. Old callback URLs must never be interpreted as v2.

## Migration and release boundary

Keep the v1 parser for already-issued requests and existing secure journal rows. Stop issuing new v1 launch URLs at the server cutover. Accept an in-flight v1 callback only if its durable challenge was issued before cutover and remains within its original at-most-five-minute expiry, then remove the URL from browser history immediately and forbid referral/caching/logging. An old installed Wallet cannot speak v2; show update-required and fail closed rather than silently launch a new v1 URL. If a signed v1 journal row is recovered by a new Wallet, upload its proof through the confidential v2 completion endpoint after Finance explicitly supports that migration; do not reopen its old full-result URL.

Provider order submission remains a separate, durable Finance operation. A Wallet signature or stored callback never by itself proves Broker submission. Real backend integration, old-install handling, and public release remain NOT_VERIFIED until exercised end to end.
