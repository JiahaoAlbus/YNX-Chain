# Explicit Paper reconciliation input and checked delta

Owner predecessor `58f1fa4156a1ef67ead987f88c0310ab80f1bfc1`.

Before fixing the owned HTTP boundary, six missing/null forms (`{}`, `null`,
missing Cash/Position, null Cash/Position) returned 200 and treated absent
observations as zero. A separate direct service regression proved extreme int64
observations were accepted despite subtraction/absolute-value/sum overflow.
The initial test harness used httptest's non-loopback peer and correctly hit
403 before business logic; it was corrected to the explicit local-Paper peer
contract before reproduction. No permission code was bypassed or changed.

## Fix

The reconcile route now requires both non-null typed int64 observations, while
explicit zero remains valid. The Paper reconciliation service computes exact
absolute differences and sum using existing big-integer support and rejects an
unrepresentable total before risk/audit mutation. This is reconciliation-only;
strategy, backtest, broker, shared permissions and engine execution are unchanged.

Tests prove missing/null/string/fractional observations reject; invalid inputs
leave risk/cash/position unchanged; extreme unrepresentable totals reject without
audit; valid signed-position difference yields exactly 2; MaxInt64 total remains
exactly representable rather than being rounded or rejected.

## Results

- `go test -race ./internal/quantlab -count=1`: PASS, 3.046s.
- `node --test --test-name-pattern='paper requires a saved strategy|actual Chrome reconciliation preview|confirmed actual-service kill' apps/quant-lab/tests/browser.test.mjs`:
  3/3 PASS, 6771.155333ms. Includes twelve-language confirmation cancellation
  with zero writes and real isolated Go risk persistence through network loss.
- `gofmt` / `git diff --check`: PASS.

External optional PostgreSQL tests are not claimed without their environment.
Chrome and Go tests are local, no real account/signature/capital transaction.

## Fresh public read-only release boundary

2026-10-03T15:34:38.853Z–15:34:40.546Z, GET only:

| Product/path | HTTP | Bytes | SHA256 |
| --- | --- | --- | --- |
| Finance /version and /health | 502 | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| Exchange /api/version | 200 | 107 | b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8 |
| Exchange /api/health | 200 | 307 | 9d16623ea43cc49bd257b1043c14bd1f1cd1d68a8df4b8e754a1ff2c5dbdc7de |
| Quant /api/version | 200 | 274 | f82629a1bd63e50f6721611cbf7866f86d7bffd51820b05a417590541c4653df |
| Quant /api/health | 200 | 462 | 9f20f70d5719359683c2f2e4a0dabacd7003072d01b16e1930520ea79b01b4cb |

Exchange public source is `91c1a40587d28ad4c931d4a4d601766bd467ea20`;
Quant public source is `664b80b00ac576317524f25b49fc01d1c0db7196`.
Neither proves deployment of this owner successor. No Host mutation occurred.
Unique release owner must integrate and publish the compatible source graph;
all real Wallet/public/native/full-goal acceptance gates remain distinct.
