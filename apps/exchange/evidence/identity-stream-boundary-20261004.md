# Exchange ordinary identity response stream boundary

Predecessor: df4a09fcb758c5603cd520dc46f00a6ecabf395a. Ordinary owner branch: codex/exchange-sso-cookie-binding-20261002.

The existing identity request used response.text() before checking its 262144-byte limit. An undeclared large response therefore consumed its entire body before rejection. The ordinary UI now reads the native response stream incrementally, rejects the first over-limit chunk, cancels without waiting for an uncooperative cancellation promise, and strictly decodes UTF-8 across chunks. The existing five-second total deadline includes body reading. Rejected headers/body abort the request; a late fetch after the deadline cannot start reading its body. Missing body, malformed JSON/UTF-8 and unsupported routes fail closed. Existing config/account/logout routes, CSRF, credentials, private permission and shared SSO contracts are unchanged. No retry or additional request is introduced.

Frozen ordinary files:

| File | Git blob | Bytes | SHA-256 |
|---|---|---:|---|
| apps/exchange/web/app.js | c865acfe9118f2efc75f70135711ccd939952528 | 45301 | 821cf33aa067d2e5b9749e5784d132a88ebace607f1ce764c2f0c66019e31609 |
| apps/exchange/tests/browser-identity-response.test.mjs | e42c7e6d2347ca62d57370bb89d5e26f7d1cb59d | 8491 | b2a9f628d92717f0e554651eae36fb28d2a70a50e97f344962e0dd7bd218959d |

Executed checks:

- Focused response suite after final abort cleanup: 15/15 passed (1159.1885 ms). Exact 256 KiB acceptance; first over-limit chunk rejection; stalled fetch/body; late fetch; non-settling cancel; split multibyte UTF-8; malformed UTF-8; route/header/JSON validation and unchanged HTTP refusal are exercised.
- Combined response, private-account, owned-controls-browser and locale-browser suites: 64 passed, 0 failed, 1 skipped (25965.016667 ms). The skipped opt-in Go cookie QA was not requested in this batch; no new claim about that boundary.
- Actual installed Chrome native Response/ReadableStream test: five 64 KiB chunks, first over-limit rejection, cancellation count 1, correct split UTF-8 HTTP 401 handling, no real network request, no page error, URL about:blank unchanged and one tab. Controlled local evidence, not public or native Wallet/account approval.
- node --check on app/test and git diff --check passed.

Formal asset gate remains failed: EXCHANGE_ASSET_HASH_MISMATCH:styles.css. A read-only run against predecessor HEAD files reproduced this exact pre-existing failure. HTML asset keys already differed from predecessor file bytes; this change does not edit formal pins, Wallet/SDK graph, release manifests or Host. The unique release owner must integrate ordinary hunks into its coherent graph, recompute final assets and run the full formal gate; copying this entire checkout or claiming a deployable bundle is not appropriate.

Separate unresolved UX observation reported to the coordinating chat: the existing identity-only quiet recovery navigates through /sso/start?prompt=none following an unauthenticated account response if the shared config permits it. Prior public inspection saw guest-page navigation without a click. This batch preserves that accepted contract rather than deleting shared restoration behavior unilaterally.

Publication, installed Wallet approval, signatures, private Product Session lifecycle, orders, native installer verification and capital execution remain unproved. No SSH, Host write, account authorization or transaction was performed.
