# Exchange owned JSON ambiguity and explicit recovery

Source predecessor: `03c560d68cd6b0083f67a5b5525fd11664123f99`, tree `843b34499f6522382b78545e6098bc808d585e37`.
Branch: `codex/exchange-sso-cookie-binding-20261002`.

## Implemented ordinary-product delta

The private account controller reuses the existing same-product market document parser rather than silently accepting duplicate JSON keys through JSON.parse. Its tighter 1 MiB streamed private response limit remains unchanged. Root, escaped quantity, account and nested additive duplicates return INVALID_ACCOUNT_RESPONSE, clear unverified private read data, preserve Standard Wallet connection, and recover only through an explicit fresh read. No shared SDK, proof, endpoint, permission or authority implementation changed.

The isolated Chromium module route now serves the reused market-data module. The first full browser run failed because that fixture route was missing; after fixing the route the complete run passed. An earlier abbreviated test invocation named a nonexistent controller test file and is not counted as the browser gate.

## Executed checks

```
YNX_EXCHANGE_CONTROLLER_HTTP_QA=1 node --test apps/exchange/tests/private-account.test.mjs apps/exchange/tests/account-response-stream.test.mjs apps/exchange/tests/owned-record-integrity.test.mjs apps/exchange/tests/market-data.test.mjs
```

72/72 PASS, 0 failures, 0 skipped, 5326.773958 ms. Actual Chromium/local Go boundary case passed in 5171.18075 ms: independent Alice/Bob account read isolation, HttpOnly-cookie reload recovery, linked global logout denial, independent fixture native session unaffected. Fixtures use isolated test authority/proofs, not human Wallet approval or public Product Session evidence.

Node syntax checks for changed product modules and `git diff --check` passed. No account/sign/order/transaction or production action was performed.

## Unchanged release boundary

This is an ordinary source/test checkpoint, not a rebuilt or deployed formal release. The latest direct public guest evidence is retained in `public-guest-release-gap-20261004.md`: public source 91c1a40587d28ad4c931d4a4d601766bd467ea20 did not expose the current chart interval control. Formal graph/build/pins and release belong to the exclusive release owner. That owner must integrate the ordinary source inputs, rebuild coherently, then prove exact public source/runtime and workflows. Public/installed Wallet lifecycle, multi-instance PostgreSQL and complete product acceptance remain unverified.
