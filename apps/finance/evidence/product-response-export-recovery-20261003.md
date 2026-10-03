# Finance ordinary API/document recovery — 2026-10-03

Predecessor: `96de9718fc79fbdaf00fd3bb0b0af2920741ca54`. Scope: ordinary product response transport in `apps/finance/web/app.js` and direct tests. No shared Wallet SDK/proof generation, Auth scopes, Finance authority, final served graph, host or production changes.

## Real source changes

The existing private API previously returned any HTTP-success blob as an export, including an HTML fallback, and relied solely on native abort behavior. Ordinary response transport now bounds fetch and body parsing to ten seconds with an explicit rejection race. Even a non-cooperative transport cannot indefinitely retain the caller; late parsing remains account/revision fenced. Each read retry still obtains the existing fresh proof; writes still have exactly one attempt and never auto-replay. No Wallet grant or proof is synthesized or widened.

Successful ordinary JSON APIs require JSON MIME and parseable JSON. Exports require the endpoint's correct JSON/CSV MIME; omitted format retains the existing backend JSON default. JSON exports must parse before a Blob is made. HTML/malformed/oversized documents fail closed instead of downloading as an apparent statement. The 8 MiB body check is buffered, not a streaming memory bound. Existing partial-coverage disclosures, account fences, saved draft/idempotency controls and explicit retry remain intact. Existing translations handle the UI failure category; stable diagnostic codes are `FINANCE_REQUEST_TIMEOUT` and `FINANCE_RESPONSE_INVALID`.

## Executed evidence

- `node --test apps/finance/tests/product-response-recovery.test.mjs apps/finance/tests/owned-read-controller.test.mjs apps/finance/tests/owned-save-controller.test.mjs apps/finance/tests/owned-ai-controller.test.mjs`: final 26/26 PASS, zero skipped/cancelled, 1054.406625 ms.
- New direct-source transport tests cover JSON/CSV/default export, HTML/wrong MIME/corrupt JSON/declared size refusal; stalled fetch and body with one POST only; fresh-proof bounded GET retries; context change during body parsing; no false reachable status.
- Actual local Chrome test invokes the real production API/export source with controlled responses: HTML produces no download; explicit next request downloads the JSON document. The fixture does not authorize a real account and does not claim public integration.
- Browser fixture initially had waiting/origin setup failures (cancelled timeout runs); corrected to a controlled origin, abort unrelated traffic and wait for the retry request to be queued before completing it. Final isolated 5/5 PASS (1257.664875 ms) and combined 26/26 PASS above. Failures are not reported as green evidence.
- `node --test apps/finance/tests/owned-save-browser.test.mjs`: 8/8 PASS, zero skipped, 38371.955708 ms. Includes normal category/privacy/reminder submissions, twelve locales, account-switch fences and download isolation. The existing export test takes roughly 30.5 seconds; no performance claim is inferred.
- `go test -race ./internal/finance -count=1`: PASS, 15.388 s. No server schema/data changes in this delta.
- App/test Node syntax and `git diff --check`: PASS.

## Publication and rollback

The unique release owner must adopt this ordinary app delta into the complete source-bound served graph/pins and actual public release. No compiled shared bundles, authority files or deployment metadata were overwritten. Public and installed runtime/source identity, real Wallet approval/callback/session and complete business journey remain NOT_VERIFIED here. This source commit is not completion of Finance.

Rollback through normal Git history to the predecessor and publish the prior complete graph via the release owner. No account data or stored draft needs deletion; no database migration. Shared proof-generation latency remains a shared adapter concern, not solved by this response-only timeout. Do not interpret an unconfirmed write as rejected/cancelled, and do not automatically re-submit it.
