# Exchange identity document ambiguity rejection

Inherited clean head `3225be3d2fed9490138af747063976308c74a024`. Owner changes only Exchange Web identity consumer and regression tests; no shared Wallet/Auth, permission, Host or business-write change.

The real bounded identity helper previously used JSON.parse, silently choosing the last duplicate field, including Unicode-escaped aliases. A new negative regression first failed with missing expected rejection. The helper now reuses the existing owned `parseMarketDocument` parser from its already hash-bound market module. This preserves the 256 KiB identity stream bound, strict UTF-8, five-second deadline, exact route/credentials and HTTP refusal behavior while rejecting duplicate keys at every object depth and excessive nesting. Parser errors become `IDENTITY_RESPONSE_INVALID`, not inferred account authority. There is no second wallet protocol.

Exact helper SHA-256 `0581a11a9666bca4719219734c04c4983060403c1cfe378281313ec144af430c`; exact app SHA-256 `9d2b9a4e25109b9cc4c18e2f82904f44cee968bcc1083d9dcd5a5bfe87961da6`. HTML and historical release-verifier pins updated to actual reviewed bytes.

Validation:

- Red duplicate-field test before fix: 0 PASS, 1 FAIL as expected.
- Bounded identity suite after source fix: 18/18 PASS, 1620.996459 ms. Final native Chrome fixture additionally tests duplicate account, escaped enabled alias, nested CSRF duplicate and 65-level nesting; every case fails closed, with no real network or navigation.
- Initial full run exposed two extracted DOM fixtures missing the real parser dependency: 206 PASS, 2 FAIL, 2 SKIP. The fixtures now carry the actual parser function and its bounded constants rather than replacing it with permissive JSON.parse. The two originally failing scenarios then passed, 8994.139459 ms.
- Final `node --test --test-concurrency=2 apps/exchange/tests/*.test.mjs`: 210 total, 208 PASS, 0 FAIL, 2 conditional skips, 51156.851792 ms. Controlled UI screenshot directory `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-ui-product-dnXROd`; candle directory `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-candle-display-wdbJlJ`.
- Node syntax and `git diff --check`: PASS.

Conditional skips remain the separately enabled isolated HTTP QA and missing exact Hosted Wallet dist; no real user approval, canonical public lifecycle, signing, trading or installed product is claimed. This source requires a new matching candidate; old immutable candidates remain preserved. Formal publication stays with A, with the prior UNKNOWN channel still protected from blind retransmission. User-directed reporting destination remains 接续测试网生态审计工作; previous messaging failures are not delivery proof.
