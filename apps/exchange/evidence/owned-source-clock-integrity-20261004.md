# Exchange owned-source timestamp integrity

Predecessor: `54c873373637cc360cf133b548670c17484a9889`, tree `ccb04340467d957c86d11aa37e1ddd947fa65fd5`.
Owner branch: `codex/exchange-sso-cookie-binding-20261002`.

The private business snapshot validator now reuses the ordinary public venue RFC3339/calendar validator. Browser-local dates, missing timezone, invalid calendar days, non-string dates and invalid offsets cannot label an account snapshot verified. The past observation limit remains 120 seconds; future skew is capped at 5 seconds rather than the old symmetric 120-second tolerance. Valid RFC3339 UTC, offsets and nanosecond fractions remain compatible. Existing private failure recovery clears unverified private data without disconnecting Standard Wallet.

Deterministic clock regressions cover invalid September 31 normalized to October 1, local date formats, wrong types, invalid offset, stale/too-future observations and exact inclusive boundary values. No shared SDK, permission, identity/proof/session authority, endpoint, formal build graph or release pin changed.

Executed:

```
YNX_EXCHANGE_CONTROLLER_HTTP_QA=1 node --test apps/exchange/tests/private-account.test.mjs apps/exchange/tests/account-response-stream.test.mjs apps/exchange/tests/owned-record-integrity.test.mjs apps/exchange/tests/market-data.test.mjs apps/exchange/tests/order-preview.test.mjs
```

81/81 PASS, no failures/skips, 6867.148959 ms. Actual isolated Chromium + Go account-cookie/linked-logout/reload and independent account boundary case passed in 6692.229667 ms. The test uses isolated fixture proofs/identities, not public Wallet approval. Market reconnect/stale/source revision integrity, account stream bounds/retirement, duplicate JSON recovery, exact advisory price/fee/reservation arithmetic and order risk preview gates passed in the same run. Changed controller Node syntax and Git diff checks passed.

Release truth: source and local test checkpoint only; no formal build/public deployment/install/real signature/order/transaction occurred. Public source mismatch and formal graph integration remain recorded in `public-guest-release-gap-20261004.md`; release owner integration is required before repeating exact public workflows. No multi-instance PostgreSQL claim is made.
