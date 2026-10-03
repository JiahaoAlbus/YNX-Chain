# Reminder invalid-date recovery

Owner branch: `codex/exchange-sso-cookie-binding-20261002`.
Reviewed predecessor: `ee71c5ca09c0774af21734d609a4b8430d69ad49`.

The production reminder submit handler called `toISOString()` on an invalid
date before entering the guarded asynchronous save controller. The new actual
Chromium regression first failed with uncaught `Invalid time value`.

The handler now checks the date timestamp before serialization. Invalid drafts
reach the existing guarded payload validator without a request, preserve form
contents, release controls, and use existing localized recovery copy. Correcting
the date permits an explicit subsequent save with an exact receipt. No Wallet,
Auth, backend logic, public release graph, or transaction behavior changed.

Validation:

- Four owned controller/browser suites: 25/25 pass, zero skipped (5531.5005 ms).
- Actual reminder submit dispatch, no uncaught page error, no invalid-date write,
  draft retained, all 12 locales, corrected-date save/reset: pass.
- `go test -race ./internal/finance -count=1`: pass (15.713 s).
- Production app and test Node syntax; `git diff --check`: pass.

The browser uses a controlled HTTPS fixture and controlled API receipts. It is
not evidence of a person-owned public save or Wallet approval. Source changes
still require compatible final release integration. Public deployment, installed
build, real account approval, private session and transaction gates remain
unproved. This checkpoint does not complete the financial ecosystem goal.
