# Latest market timestamp boundary

Owner predecessor: `5b6daf4eb153c9e3a95b5c515826ddf49d11e3b7`.

The existing History adapter rejects zero trade timestamps, but Latest accepted
missing, null and explicit zero timestamps as valid ticks. Three actual local HTTP
fixtures reproduced this before the fix: error was nil and tick.At was year 1.

Latest now applies the same zero-time boundary as History. All three variants
must return ErrUnavailable and an empty tick. Existing dated-price fixtures remain
unchanged. This does not assert source authentication, freshness or a real fill.

Validation commands:

- `go test -race ./internal/quantlab ./apps/quant-lab/server -count=1`
- `go vet ./internal/quantlab ./apps/quant-lab/server`
- `git diff --check`

Results: race PASS (internal 3.176s, server 1.325s), vet PASS, diff PASS.
Optional database-dependent tests are not promoted to multi-instance proof when
the independent QA PostgreSQL connection is unavailable.

Public integration, installed runtime, account approval, signing and transactions
remain unverified. No shared authority, business permissions or schema changes.
Rollback source changes by reverting this owner checkpoint through normal review;
no production change has been made.
