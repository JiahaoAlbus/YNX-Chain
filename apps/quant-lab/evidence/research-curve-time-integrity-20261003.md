# Research curve observation-time integrity

Reviewed predecessor: 0c85d9c2b00a018ce6a08d8c4b11f0bbeba3178e.
Owner branch: codex/exchange-sso-cookie-binding-20261002.

The existing Go research engine returns an explicit time on each equity point.
The previous display discarded those times and drew uniformly spaced indices,
compressing real missing-time intervals. A fail-first production UI regression
showed the one-minute middle observation plotted at x=360 instead of x=23.60
between observations at minute zero and minute sixty.

The chart now uses actual elapsed observation time. A curve needs two or more
bounded, safe-integer, nonnegative equity/benchmark points with finite strictly
increasing times. Missing, invalid, duplicate or reversed times omit the curve
without inventing samples or losing otherwise valid result metrics. No engine
algorithm, historical state, cost model or trading capability changes.

The existing actual local Go HTTP/two-process fixture now contains an explicit
one-hour source gap. Both tenants' real engine result times equal the supplied
out-of-sample bar times, and the result reports DataGaps >= 1. Persistence/restart
and tenant/Paper idempotency assertions remain intact. These synthetic local
records do not prove actual market performance or Wallet identity.

Validation:

- Business, actual-Chrome and actual local two-process HTTP suites: 65/65 PASS,
  zero failures/skips, 46888.2395 ms.
- Production Chrome page consumes an explicit controlled response with irregular
  times and verifies actual SVG coordinates 12.00, 23.60, 708.00. Existing Arabic
  mobile, English, temporary provenance, source hashes, formula and cost-binding
  regressions pass. No account, signature or chain transaction is performed.
- `go test -race ./internal/quantlab -count=1`: PASS, 2.653 s.
- App/test Node syntax and git diff checks: PASS.

Shared Wallet/Auth, final version pins, Host and public runtime are unchanged.
Final coherent-source public/installed release and real-user/Relay/approval gates
remain unproved. Extreme model-cost arithmetic remains a separate previously
reported engine review boundary, not certified by this display fix. This is not
ecosystem completion or a production/testnet-capital execution claim.
