# Finance owned-save calendar receipt integrity

Predecessor: 4399d25c457781268078e113b964720d2db4d85c.
Scope: ordinary Finance product UI and direct tests only; no authority, shared SDK, release pins, Host or deployment changes.

The new controller regression failed before the fix: a category receipt with createdAt=2026-02-30T00:00:00Z reset the draft and reported success. Save payload and receipt validation now reuse the existing RFC3339/calendar validator, retaining the existing zero-year rejection. Categories still require only their actual createdAt contract, not an invented updatedAt field.

Controlled real Chrome confirms an impossible-date receipt leaves the visible draft and unconfirmed status intact, performs no success refresh, and preserves the exact original request/idempotency key for an explicit retry. A valid leap-day offset receipt confirms and refreshes once. No page errors. Unit cases also reject date-only, zone-free and April 31 receipts.

The first new browser fixture ran on about:blank, where secure-context request-key generation was unavailable. It was corrected to an intercepted HTTPS fixture origin; no product workaround was added. The corrected focused browser test passes. Final combined controller, save-browser and overview-source-browser run: 24/24 PASS, 37.406 seconds. Product/test JavaScript syntax and git diff whitespace checks pass.

All API responses and identities in these browser tests are controlled fixtures. They do not prove public deployment, real Wallet approval, Product Session v2, installed application success or real financial operations. Those gates remain unverified and release remains exclusively with the coordinator's release owner.
