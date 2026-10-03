# Exchange account response framing and recovery

Owner branch: `codex/exchange-sso-cookie-binding-20261002`.
Predecessor: `e743227527847fe7b4578427b4f4d448dfe534fa`.

Product-only change: the account response reader rejects identity-encoded
Content-Length mismatches, stopping immediately on excess bytes and rejecting
early EOF. Limits and fatal UTF-8 decoding remain enforced. Fetch may expose
decompressed bytes with compressed Content-Length, so gzip/br representation
lengths are not compared with decoded length; the decoded 1 MiB ceiling remains.

Recovery regression: a previously connected account becomes degraded with no
visible account/snapshot on mismatch. Only an explicit refresh with a fresh
read proof and newly validated owner-bound snapshot recovers it. No automatic
retry, new approval, cancel, order, signing or financial write was added.

Executed local checks:

- `node --test apps/exchange/tests/market-data.test.mjs apps/exchange/tests/order-preview.test.mjs apps/exchange/tests/account-response-stream.test.mjs apps/exchange/tests/private-account.test.mjs`: 76 passed, 1 opt-in browser test skipped, 0 failed (192.739 ms).
- `YNX_EXCHANGE_CONTROLLER_HTTP_QA=1 node --test --test-name-pattern='actual Chromium controller' apps/exchange/tests/private-account.test.mjs`: 1 passed, 0 failed (6019.881 ms). Installed Chrome executed the source reader with exact, short, long and compressed-length fixtures. The existing controlled local Go API journey checked host-only cookies, distinct account isolation, reload, linked logout and independent native read separation.
- `git diff --check`: passed.

Truth: these are local product/source checks and controlled local browser/API
fixtures, not public deployment, real Wallet approval, native installation,
ComputerControl, Product Session lifecycle or real trading completion. No SDK,
permission authority, formal bundle/release pins or production state changed.

Unresolved existing action boundary: cancel/deposit/withdraw/security/support
buttons currently reach only the private-session requirement, and the accepted
account controller has `exchange:read` only. This was reported to
`接续测试网生态审计工作`; no trade/write authority was fabricated. Formal
bundle rebuild and source-bound publication remain with the release owner.
